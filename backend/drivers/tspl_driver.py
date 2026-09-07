"""
tspl_driver.py — Native TSC TSPL printer driver.

Delivery strategy (attempted in order):
  1. win32print RAW spool    — WritePrinter with RAW data type (primary)
  2. TSCLIB.dll via ctypes   — openport(name) → sendcommand(tspl) → printlabel()
  3. CommSDK TCP fallback    — TcpConnection + Write (for network printers)

TSPL generation strategy:
  - Raw TSPL string builder (primary) — produces standard TSPL commands
  - Translate canvas elements directly to native TSPL commands
  - Multi-column (columns) roll layout pairing
  - Coordinates converted from mm to dots using printer DPI (203/300)
  - Layout offsets (margins, horizontal middle gap) calculated dynamically
"""
import os
import re
import sys
import base64
import io
import ctypes
from pathlib import Path
from typing import Any, Dict, List, Optional
from PIL import Image
from services.printer_service import render_label_image
from drivers.zpl_driver import _resolve_value

from drivers.base_driver import PrinterDriverInterface
from services.logging_service import get_logger

logger = get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# TSPL Manual Alignment Tweaks & Offsets (in Millimeters)
# Modify these constants to fine-tune physical label alignment:
# ─────────────────────────────────────────────────────────────────────────────
# Base manual offsets for normal (0° upright) printing:
# Positive X = shifts right, Negative X = shifts left
# Positive Y = shifts down,  Negative Y = shifts up
TSPL_MANUAL_OFFSET_X_MM = 0.0
TSPL_MANUAL_OFFSET_Y_MM = 0.0

# Manual tweaks for 180° rotated mode (portrait-180 / reverse):
TSPL_180_OFFSET_X_MM = 0.0   # 0.0mm exact canvas match
TSPL_180_OFFSET_Y_MM = 0.0   # 0.0mm exact canvas match

# ─────────────────────────────────────────────────────────────────────────────
# TSPL printer detection
# ─────────────────────────────────────────────────────────────────────────────

_TSPL_KEYWORDS = [
    "tsc", "te200", "te300", "te244", "te310", "ttp", "da-",
    "gainscha", "uniprt", "tspl", "xprinter", "xp-",
    "gprinter", "gp-", "hprt", "bpost"
    # NOTE: 'kores', 'endura', '2801' removed — these brands ship printers with both
    # TSPL and ZPL language firmware. Language is determined by checking printer name
    # for 'zpl'/'tspl' suffix, or by the backing Windows driver name.
]

_TSPL_PATTERNS = re.compile(
    r"(" + "|".join(re.escape(k) for k in _TSPL_KEYWORDS) + r")",
    re.IGNORECASE
)

# ─────────────────────────────────────────────────────────────────────────────
# TSCLIB.dll ctypes interface (fallback delivery method)
# ─────────────────────────────────────────────────────────────────────────────

_TSCLIB: Any = None
_TSCLIB_LOADED: Optional[bool] = None

def _get_tsclib() -> Any:
    """Load and cache TSCLIB.dll. Returns the CDLL or None."""
    global _TSCLIB, _TSCLIB_LOADED
    if _TSCLIB_LOADED is not None:
        return _TSCLIB

    dll_candidates = [
        # Relative to this backend directory
        Path(__file__).parent.parent.parent / "python windows sdk" / "TSCLib.dll",
        Path(__file__).parent.parent.parent / "python windows sdk" / "TSCLIB.dll",
        # Absolute path
        Path(r"D:\project\Barcode Studio v2\React\python windows sdk\TSCLib.dll"),
    ]

    for dll_path in dll_candidates:
        if dll_path.exists():
            try:
                lib = ctypes.windll.LoadLibrary(str(dll_path))
                # Verify core functions
                _ = lib.openport
                _ = lib.closeport
                _ = lib.sendcommand
                _ = lib.printlabel
                _ = lib.setup
                _ = lib.clearbuffer
                _TSCLIB = lib
                _TSCLIB_LOADED = True
                logger.info(f"[TSPL] TSCLIB.dll loaded from: {dll_path}")
                return _TSCLIB
            except Exception as ex:
                logger.warning(f"[TSPL] Could not load TSCLIB.dll: {ex}")

    _TSCLIB_LOADED = False
    logger.warning("[TSPL] TSCLIB.dll not loaded - using win32print RAW delivery")
    return None

# ─────────────────────────────────────────────────────────────────────────────
# DPI detection
# ─────────────────────────────────────────────────────────────────────────────

_TSPL_DPI_MAP = {
    "TE244": 203,
    "TE310": 300,
    "TE200": 203,
    "TE300": 300,
    "TTP-244": 203,
    "TTP-342": 300,
    "2801": 203, # Kores Endura 2801 standard DPI
}

def _detect_printer_dpi(printer_name: str) -> int:
    """Detect printer DPI via Windows DC or fallback lookup."""
    try:
        import win32ui, win32con
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)
        dpi = hdc.GetDeviceCaps(win32con.LOGPIXELSX)
        del hdc
        if dpi and dpi > 0:
            logger.info(f"[TSPL] Detected driver DPI for '{printer_name}': {dpi}")
            return dpi
    except Exception:
        pass

    upper = printer_name.upper()
    for model, dpi in _TSPL_DPI_MAP.items():
        if model in upper:
            return dpi

    return 203  # Default fallback

# ─────────────────────────────────────────────────────────────────────────────
# TSPL string builder
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_value(el: Dict[str, Any], record: Dict[str, Any]) -> str:
    raw = el.get("text", "")
    field = el.get("fieldName")
    if field and record and field in record:
        val = record[field]
        if val is not None:
            raw = str(val)
    # Prevent empty barcode crashes
    if not raw or not raw.strip():
        el_type = el.get("type", "")
        if el_type in ("barcode", "qrcode"):
            raw = "12345678"
        else:
            raw = ""
    return f"{el.get('prefix', '')}{raw}{el.get('suffix', '')}"

def _map_1d_barcode_type(b_type: str) -> str:
    mapping = {
        "code128":          "128",
        "code39":           "39",
        "code93":           "93",
        "ean13":            "EAN13",
        "ean8":             "EAN8",
        "upca":             "UPCA",
        "upc-a":            "UPCA",
        "upce":             "UPCE",
        "i2of5":            "I25",
        "interleaved2of5":  "I25",
        "codabar":          "CODA",
        "msiplessey":       "MSI",
        "postnet":          "POST",
        "pdf417":           "PDF417",
    }
    return mapping.get(b_type.lower(), "128")

def estimate_barcode_modules(b_type: str, value: str) -> int:
    L = len(value)
    bt = b_type.lower()
    if "128" in bt:
        return 11 * L + 55
    elif "39" in bt:
        return 16 * L + 32
    elif "ean13" in bt or "upc" in bt:
        return 95
    elif "ean8" in bt:
        return 67
    return 12 * L + 20

def build_tspl_label_header(template: Dict[str, Any], dpi: int, hw_offset_x_dots: int = 0, has_bitmaps: bool = False) -> List[str]:
    """
    Generates standard page setup header lines for TSPL.
    """
    width_mm = float(template.get("widthMm", 50))
    height_mm = float(template.get("heightMm", 30))
    columns = max(1, int(template.get("columns") or 1))
    
    # Use template margins with sensible dual-column roll defaults (2mm margins & 2mm middle gap)
    margin_left = float(template.get("marginLeft") if template.get("marginLeft") is not None else (2.0 if columns == 2 else 0.0))
    margin_right = float(template.get("marginRight") if template.get("marginRight") is not None else (2.0 if columns == 2 else 0.0))
    margin_top = float(template.get("marginTop") or 0.0)
    margin_bottom = float(template.get("marginBottom") or 0.0)
    gap_horizontal = float(template.get("gapHorizontal") if template.get("gapHorizontal") is not None else (2.0 if columns == 2 else 0.0))
    orientation = str(template.get("orientation", "portrait")).lower()
    template_rot = int(template.get("rotation") or 0)

    # Swap visual width and height of physical sticker if printed in landscape
    if orientation in ("landscape", "landscape-180") or template_rot in (90, 270):
        sticker_w = height_mm
        sticker_h = width_mm
    else:
        sticker_w = width_mm
        sticker_h = height_mm

    calc_page_w = margin_left + columns * sticker_w + max(0, columns - 1) * gap_horizontal + margin_right
    page_w_mm = float(template.get("pageWidthMm") or 0)
    if page_w_mm <= 0 or (columns > 1 and page_w_mm <= sticker_w):
        page_w_mm = calc_page_w

    # Label height in TSPL SIZE defines the physical sticker height between gap detections
    page_h_mm = sticker_h + margin_top + margin_bottom

    gap_mm = float(template.get("gapVertical") or template.get("gapMm") or 2.0)
    if gap_mm <= 0:
        gap_mm = 2.0

    # TSPL DIRECTION:
    # 0,0: Normal feed direction (top to bottom), (0,0) is at top-left
    # 1,0: Inverted 180° direction, (0,0) is at bottom-right
    # For full-page raster BITMAP printing, orientation rotation (including 180° mode)
    # is baked directly into the rendered bitmap via PIL sub-pixel bicubic resampling.
    # Therefore DIRECTION must remain 0,0 so hardware origin stays at top-left (0,0)
    # and feed direction matches standard roll progression without coordinate flipping.
    direction_cmd = "DIRECTION 0,0"
    reference_line = "REFERENCE 0,0"

    lines = [
        f"SIZE {page_w_mm:.1f} mm,{page_h_mm:.1f} mm",
        f"GAP {gap_mm:.1f} mm,0 mm",
        direction_cmd,
        reference_line,
        "SPEED 4",
        "DENSITY 10",
        "SET CUTTER OFF",
        "SET TEAR ON",
    ]
    
    # Only declare CODEPAGE UTF-8 if there are no bitmaps
    # (binary BITMAP data cannot go through UTF-8 encoding)
    if not has_bitmaps:
        lines.append("CODEPAGE UTF-8")
    
    lines.append("CLS")
    
    return lines

def translate_element_to_tspl(
    el: Dict[str, Any],
    record: Dict[str, Any],
    dpi: int,
    offset_x_mm: float,
    offset_y_mm: float,
    sticker_w_mm: float = 50.0,
    sticker_h_mm: float = 30.0,
    orientation: str = "portrait"
) -> List[bytes]:
    """Translates a single layout element to native TSPL commands as bytes."""
    lines: List[bytes] = []
    
    el_type = el.get("type", "")
    el_x = float(el.get("x", 0))
    el_y = float(el.get("y", 0))
    el_w = float(el.get("width", 10))
    el_h = float(el.get("height", 10))
    el_rotation = int(el.get("rotation", 0))

    if orientation == "landscape":
        # Rotate 90 deg clockwise
        x_mm = sticker_h_mm - el_y - el_h
        y_mm = el_x
        w_mm = el_h
        h_mm = el_w
        rotation_deg = (el_rotation + 90) % 360
    elif orientation == "landscape-180":
        # Rotate 270 deg clockwise
        x_mm = el_y
        y_mm = sticker_w_mm - el_x - el_w
        w_mm = el_h
        h_mm = el_w
        rotation_deg = (el_rotation + 270) % 360
    elif orientation == "portrait-180":
        # Rotate 180 deg
        x_mm = sticker_w_mm - el_x - el_w
        y_mm = sticker_h_mm - el_y - el_h
        w_mm = el_w
        h_mm = el_h
        rotation_deg = (el_rotation + 180) % 360
    else:
        # Portrait (default unrotated)
        x_mm = el_x
        y_mm = el_y
        w_mm = el_w
        h_mm = el_h
        rotation_deg = el_rotation

    x_mm += offset_x_mm
    y_mm += offset_y_mm

    dots_per_mm = dpi / 25.4
    x_d = max(0, int(x_mm * dots_per_mm))
    y_d = max(0, int(y_mm * dots_per_mm))
    w_d = max(1, int(w_mm * dots_per_mm))
    h_d = max(1, int(h_mm * dots_per_mm))

    tspl_rot = {0: 0, 90: 90, 180: 180, 270: 270}.get(rotation_deg, 0)
    value = _resolve_value(el, record)
    if el_type in ("text", "barcode", "qrcode") and (not value or not str(value).strip() or str(value).strip() in ("None", "null", "NULL")):
        return []

    # 1. TEXT
    if el_type == "text":
        has_non_ascii = False
        try:
            if value:
                value.encode('ascii')
        except UnicodeEncodeError:
            has_non_ascii = True
            
        has_indic = any(0x0900 <= ord(c) <= 0x0D7F for c in value) if value else False
        wrap_text = bool(el.get("wrapText", False))
        auto_shrink = bool(el.get("autoShrink", False))
        auto_expand = bool(el.get("autoExpand", False))
        is_bold = el.get("fontWeight") == "bold" or el.get("bold") is True or el.get("fontWeight") == 700
        is_italic = el.get("fontStyle") == "italic"
        font_family_raw = str(el.get("fontFamily", "Segoe UI")).strip().lower()
        is_custom_font = font_family_raw not in ("standard", "mono", "tspl_default", "0")
        
        is_full_pil = wrap_text or auto_shrink or auto_expand or has_indic or (has_non_ascii and rotation_deg != 0) or is_custom_font or is_bold or is_italic
        is_mixed_nowrap = has_non_ascii and not is_full_pil and rotation_deg == 0

        if is_full_pil:
            try:
                from PIL import Image
                from drivers.zpl_driver import _render_text_element_to_pil, _trim_text_image

                # Element's native unrotated size in dots
                unrot_w = max(1, int(float(el.get("width", 10)) * dots_per_mm))
                unrot_h = max(1, int(float(el.get("height", 10)) * dots_per_mm))

                pil_img = _render_text_element_to_pil(el, value, unrot_w, unrot_h, dpi)
                cropped_img, offset_x, offset_y = _trim_text_image(pil_img, value)

                has_devnagari = any(0x0900 <= ord(c) <= 0x0D7F for c in value)
                font_size_pt = float(el.get("fontSize", 10))
                font_size_px = int(round(font_size_pt * (dpi / 72.0)))
                pad_top = int(round(font_size_px * 0.15)) if has_devnagari else max(2, int(round(font_size_px * 0.05)))
                pad_side = max(4, int(round(font_size_px * 0.10))) if has_devnagari else 2

                real_x_d = max(0, x_d + offset_x - pad_side)
                real_y_d = max(0, y_d + offset_y - pad_top)

                if rotation_deg != 0:
                    cropped_img = cropped_img.rotate(-rotation_deg, expand=True, resample=Image.Resampling.BICUBIC)

                w_out, h_out, width_bytes, raw_bytes = _pil_image_to_tspl_bitmap_bytes(cropped_img)
                bitmap_cmd = f"BITMAP {real_x_d},{real_y_d},{width_bytes},{h_out},0,".encode('ascii')
                lines.append(bitmap_cmd + raw_bytes + b"\r\n")
            except Exception as tex:
                logger.warning(f"[TSPL] Text BITMAP conversion failed: {tex}")
                is_mixed_nowrap = True # fallback if full PIL failed

        if is_mixed_nowrap:
            try:
                import re
                from PIL import Image, ImageDraw, ImageFont
                from services.printer_service import (
                    get_font_path, _detect_script_kind, _font_candidates_for_script, _load_text_font
                )

                chunks = []
                for match in re.finditer(r'[^\x00-\x7F]+|[\x00-\x7F]+', value):
                    chunk_text = match.group(0)
                    is_ascii = True
                    try:
                        chunk_text.encode('ascii')
                    except UnicodeEncodeError:
                        is_ascii = False
                    chunks.append({"text": chunk_text, "is_ascii": is_ascii})

                font_size_pt = float(el.get("fontSize", 10))
                font_h_d = max(8, int(font_size_pt * dpi / 72.0))
                font_w_d = font_h_d
                char_w_d = font_h_d * 0.55

                total_w_d = 0
                chunk_widths = []
                fonts = []

                for chunk in chunks:
                    if chunk["is_ascii"]:
                        cw = int(len(chunk["text"]) * char_w_d)
                        chunk_widths.append(cw)
                        fonts.append(None)
                        total_w_d += cw
                    else:
                        bold = el.get("fontWeight") == "bold"
                        italic = el.get("fontStyle") == "italic"
                        font_family = "Noto Sans" # Force Noto Sans for Indic chunks
                        script_kind = _detect_script_kind(chunk["text"])
                        font_candidates = _font_candidates_for_script(
                            script_kind, bold, italic, get_font_path(font_family, bold, italic)
                        )
                        
                        font = _load_text_font(font_candidates, font_h_d, True, chunk["text"])
                        if hasattr(font, 'getlength'):
                            cw = int(font.getlength(chunk["text"]))
                        elif hasattr(font, 'getbbox'):
                            bb = font.getbbox(chunk["text"])
                            cw = bb[2] - bb[0]
                        else:
                            cw = int(len(chunk["text"]) * font_h_d * 0.8)
                        
                        chunk_widths.append(cw)
                        fonts.append(font)
                        total_w_d += cw

                text_align = el.get("textAlign", "left")
                curr_x_d = x_d
                if text_align == "center":
                    curr_x_d = max(x_d, int(x_d + (w_d - total_w_d) // 2))
                elif text_align == "right":
                    curr_x_d = max(x_d, int(x_d + w_d - total_w_d))

                for chunk, cw, font in zip(chunks, chunk_widths, fonts):
                    text_str = chunk["text"]
                    if chunk["is_ascii"]:
                        safe_value = text_str.replace('"', '\\"')
                        lines.append(
                            f'TEXT {curr_x_d},{y_d},"0",{tspl_rot},{font_w_d},{font_h_d},"{safe_value}"\r\n'.encode('ascii')
                        )
                    else:
                        img = Image.new("1", (cw, font_h_d), 1)
                        draw = ImageDraw.Draw(img)
                        if hasattr(font, 'getbbox'):
                            bb = font.getbbox(text_str)
                            text_h = bb[3] - bb[1]
                        elif hasattr(font, 'getmetrics'):
                            ascent, descent = font.getmetrics()
                            text_h = ascent + descent
                        else:
                            text_h = font_h_d
                        
                        draw_y = max(0, (font_h_d - text_h) // 2)
                        draw.text((0, draw_y), text_str, font=font, fill=0)
                        
                        bw_d, bh_d, width_bytes, raw_bytes = _pil_image_to_tspl_bitmap_bytes(img)
                        bitmap_cmd = f"BITMAP {curr_x_d},{y_d},{width_bytes},{bh_d},0,".encode('ascii')
                        lines.append(bitmap_cmd + raw_bytes + b"\r\n")
                        
                    curr_x_d += cw

            except Exception as e:
                logger.error(f"[TSPL] Mixed text inline parsing failed: {e}")

        if not is_full_pil and not is_mixed_nowrap:
            # ASCII-only TEXT command — only used for pure ASCII text
            font_size_pt = float(el.get("fontSize", 10))
            font_h_d = max(8, int(font_size_pt * dpi / 72.0))
            font_w_d = font_h_d

            text_align = el.get("textAlign", "left")
            if text_align in ("center", "right"):
                char_w_d = font_h_d * 0.55
                text_w_d = int(len(value) * char_w_d)
                if text_align == "center":
                    x_d = max(x_d, int(x_d + (w_d - text_w_d) // 2))
                elif text_align == "right":
                    x_d = max(x_d, int(x_d + w_d - text_w_d))

            if tspl_rot == 90:
                x_d_tspl = x_d + w_d
                y_d_tspl = y_d
            elif tspl_rot == 180:
                x_d_tspl = x_d + w_d
                y_d_tspl = y_d + h_d
            elif tspl_rot == 270:
                x_d_tspl = x_d
                y_d_tspl = y_d + h_d
            else:
                x_d_tspl = x_d
                y_d_tspl = y_d

            safe_value = value.replace('"', '\\"')
            lines.append(
                f'TEXT {x_d_tspl},{y_d_tspl},"0",{tspl_rot},{font_w_d},{font_h_d},"{safe_value}"\r\n'.encode('ascii')
            )

    # 2. BARCODE 1D
    elif el_type == "barcode":
        bcd_type_str = _map_1d_barcode_type(el.get("barcodeType", "code128"))
        show_text = 1 if el.get("showText", False) else 0
        auto_size = el.get("autoSize", True)

        # Pre-process value for Code 39 to avoid printer parser errors
        if bcd_type_str == "39":
            allowed_chars = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%")
            filtered = "".join([c for c in value.upper() if c in allowed_chars])
            value = filtered if filtered else "12345678"

        if auto_size:
            modules = estimate_barcode_modules(bcd_type_str, value)
            narrow_d = max(2, int(w_d / modules))  # min 2 dots for readability on thermal
        else:
            narrow_d = max(2, int(float(el.get("barWidth", 0.35)) * dots_per_mm))

        # Subtract size of font from bar height
        font_size_pt = float(el.get("fontSize", 10))
        hri_h_d = max(8, int(font_size_pt * dpi / 72.0)) if show_text else 0
        gap_d = 4  # gap in dots between barcode and text
        bar_h_d = max(10, h_d - hri_h_d - gap_d) if show_text else h_d

        # Adjust coordinates based on rotation anchors
        if tspl_rot == 90:
            x_d_tspl = x_d + w_d
            y_d_tspl = y_d
        elif tspl_rot == 180:
            x_d_tspl = x_d + w_d
            y_d_tspl = y_d + h_d
        elif tspl_rot == 270:
            x_d_tspl = x_d
            y_d_tspl = y_d + h_d
        else:
            x_d_tspl = x_d
            y_d_tspl = y_d

        # Calculate wide bar dimension using ratio (default 3:1)
        ratio_str = el.get("barcodeRatio")
        try:
            ratio = float(ratio_str) if ratio_str and ratio_str != "auto" else 3.0
        except (ValueError, TypeError):
            ratio = 3.0
        wide_d = int(narrow_d * ratio)

        safe_value = value.replace('"', '\\"')
        # Disable native human-readable text (set to 0) to avoid firmware overlapping bugs
        lines.append(
            f'BARCODE {x_d_tspl},{y_d_tspl},"{bcd_type_str}",{bar_h_d},0,{tspl_rot},{narrow_d},{wide_d},"{safe_value}"\r\n'.encode('ascii')
        )

        # Manually draw the text below/beside the barcode to guarantee it prints below the barcode
        if show_text:
            font_w_d = hri_h_d
            font_h_d = hri_h_d
            char_w_d = font_h_d * 0.55
            text_w_d = int(len(value) * char_w_d)

            b_align = el.get("textAlign", "left")
            if tspl_rot == 90:
                x_text = x_d + w_d - bar_h_d - gap_d
                y_text = y_d if b_align == "left" else y_d + int((w_d - text_w_d) // 2)
            elif tspl_rot == 180:
                x_text = x_d + w_d if b_align == "left" else x_d + w_d - int((w_d - text_w_d) // 2)
                y_text = y_d + h_d - bar_h_d - gap_d
            elif tspl_rot == 270:
                x_text = x_d + bar_h_d + gap_d
                y_text = y_d if b_align == "left" else y_d + h_d - int((w_d - text_w_d) // 2)
            else:
                x_text = x_d if b_align == "left" else x_d + int((w_d - text_w_d) // 2)
                y_text = y_d + bar_h_d + gap_d

            lines.append(
                f'TEXT {x_text},{y_text},"0",{tspl_rot},{font_w_d},{font_h_d},"{safe_value}"\r\n'.encode('ascii')
            )

    # 3. QR CODE
    elif el_type == "qrcode":
        cell_w = max(2, int(min(w_mm, h_mm) / 25 * dots_per_mm))
        cell_w = min(cell_w, 10)

        # Adjust coordinates based on rotation anchors
        if tspl_rot == 90:
            x_d_tspl = x_d + w_d
            y_d_tspl = y_d
        elif tspl_rot == 180:
            x_d_tspl = x_d + w_d
            y_d_tspl = y_d + h_d
        elif tspl_rot == 270:
            x_d_tspl = x_d
            y_d_tspl = y_d + h_d
        else:
            x_d_tspl = x_d
            y_d_tspl = y_d

        safe_value = value.replace('"', '\\"')
        lines.append(
            f'QRCODE {x_d_tspl},{y_d_tspl},H,{cell_w},A,{tspl_rot},M,"{safe_value}"\r\n'.encode('ascii')
        )

    # 4. SHAPE (Box, Rect, Circle, Ellipse, Line)
    elif el_type == "shape":
        shape = el.get("shapeType", "rect")
        stroke_w = max(1, int(float(el.get("strokeWidth", 0.5)) * dots_per_mm))
        fill = el.get("fillColor", "transparent")
        radius_d = int(float(el.get("cornerRadius", 0)) * dots_per_mm)

        if shape in ("rect", "rectangle"):
            if fill and fill not in ("transparent", "none", ""):
                lines.append(f"BAR {x_d},{y_d},{w_d},{h_d}\r\n".encode('ascii'))
            else:
                if radius_d > 0:
                    lines.append(f"BOX {x_d},{y_d},{x_d + w_d},{y_d + h_d},{stroke_w},{radius_d}\r\n".encode('ascii'))
                else:
                    lines.append(f"BOX {x_d},{y_d},{x_d + w_d},{y_d + h_d},{stroke_w}\r\n".encode('ascii'))
        elif shape == "ellipse":
            # Native ellipse approximation via rounded box
            lines.append(f"BOX {x_d},{y_d},{x_d + w_d},{y_d + h_d},{stroke_w},{min(w_d, h_d) // 2}\r\n".encode('ascii'))
        elif shape == "line":
            if h_d > w_d:
                lines.append(f"BAR {x_d + w_d // 2},{y_d},{stroke_w},{h_d}\r\n".encode('ascii'))
            else:
                lines.append(f"BAR {x_d},{y_d + h_d // 2},{w_d},{stroke_w}\r\n".encode('ascii'))

    # 5. LINE (Divider element)
    elif el_type == "line":
        stroke_w = max(1, int(float(el.get("strokeWidth", 0.5)) * dots_per_mm))
        if h_d > w_d:
            lines.append(f"BAR {x_d + w_d // 2},{y_d},{stroke_w},{h_d}\r\n".encode('ascii'))
        else:
            lines.append(f"BAR {x_d},{y_d + h_d // 2},{w_d},{stroke_w}\r\n".encode('ascii'))

    # 6. IMAGE
    elif el_type == "image":
        _append_image_tspl(lines, el, x_d, y_d, w_d, h_d, dpi, rotation_deg)

    return lines

def _pil_image_to_tspl_bitmap_bytes(img: Any) -> tuple:
    """
    Converts a PIL Image to TSPL BITMAP raw binary bytes with zero stride alignment leaks.
    Returns (w_d, h_d, width_bytes, raw_bytes).

    TSPL Polarity Rules:
      - Pixel 0 (Black dot / ink ON) -> Bit 0 (0b0, Thermal element ON)
      - Pixel 255 / 1 (White background / ink OFF) -> Bit 1 (0b1, Thermal element OFF)
      - Row width in bytes = (width + 7) // 8
      - Mode = 0 (OVERWRITE)
      - End-of-row padding bits MUST be 1 (White background) to prevent black line leaks.
    """
    gray = img.convert("L")
    # Standardize input image mode conversion: Convert img to 1-bit monochrome ("1") using explicit thresholding
    mono = gray.point(lambda p: 0 if p < 128 else 255, mode="1")
    w_d, h_d = mono.size
    width_bytes = (w_d + 7) // 8

    try:
        import numpy as np
        # Convert mono 1-bit PIL image to boolean numpy array:
        # White pixels (255 / True) -> 1 (bit 1, Thermal element OFF)
        # Black pixels (0 / False) -> 0 (bit 0, Thermal element ON)
        arr = np.array(mono, dtype=bool)
        pad_cols = (width_bytes * 8) - w_d
        if pad_cols > 0:
            arr = np.pad(arr, ((0, 0), (0, pad_cols)), mode='constant', constant_values=True)
        raw_bytes = bytes(np.packbits(arr, axis=1).tobytes())
    except ImportError:
        pixels = mono.load()
        out = bytearray()
        for r in range(h_d):
            row_byte = 0
            bit_count = 0
            for c in range(w_d):
                # 0 for black (Thermal element ON), 1 for white (Thermal element OFF)
                bit = 1 if pixels[c, r] != 0 else 0
                row_byte = (row_byte << 1) | bit
                bit_count += 1
                if bit_count == 8:
                    out.append(row_byte)
                    row_byte = 0
                    bit_count = 0
            if bit_count > 0:
                row_byte <<= (8 - bit_count)
                pad_bits = 8 - bit_count
                row_byte |= (1 << pad_bits) - 1
                out.append(row_byte)
        raw_bytes = bytes(out)

    return w_d, h_d, width_bytes, raw_bytes

def _append_image_tspl(
    lines: List[bytes],  # Changed to bytes list for binary BITMAP data
    el: Dict[str, Any],
    x_d: int, y_d: int, w_d: int, h_d: int,
    dpi: int,
    rotation_deg: int = 0
):
    """
    Append BITMAP command to TSPL output.
    """
    img_data = el.get("text", "")
    if not img_data or not img_data.startswith("data:"):
        return

    try:
        from PIL import Image

        header, encoded = img_data.split(",", 1)
        raw = base64.b64decode(encoded)
        img = Image.open(io.BytesIO(raw)).convert("1")  # monochrome
        img = img.resize((w_d, h_d), Image.Resampling.LANCZOS)

        if rotation_deg != 0:
            # Rotate PIL image counter-clockwise to match design view
            img = img.rotate(-rotation_deg, expand=True, resample=Image.Resampling.BICUBIC)

        w_d, h_d, width_bytes, raw_bytes = _pil_image_to_tspl_bitmap_bytes(img)
        bitmap_cmd = f"BITMAP {x_d},{y_d},{width_bytes},{h_d},0,".encode('ascii')
        lines.append(bitmap_cmd + raw_bytes + b"\r\n")
        logger.info(f"[TSPL] Spooled BITMAP image {w_d}x{h_d} ({len(raw_bytes)} bytes)")
    except Exception as ex:
        logger.warning(f"[TSPL] Spooled image element failed to convert: {ex}")
        lines.append(f"BOX {x_d},{y_d},{x_d + w_d},{y_d + h_d},2\r\n".encode('ascii'))

# ─────────────────────────────────────────────────────────────────────────────
# Spooling delivery methods
# ─────────────────────────────────────────────────────────────────────────────

def _deliver_via_win32print_raw(printer_name: str, tspl_bytes: bytes) -> bool:
    """
    Deliver raw TSPL bytes directly to the Windows Spooler.

    IMPORTANT: Data is sent in 4096-byte chunks to avoid overflowing the printer's
    input buffer. TSC thermal printers have limited buffers (~32KB); sending large
    TSPL streams in one shot causes the printer to fall out of command mode and
    print raw text/hex instead of interpreting commands.

    NOTE: Do NOT call StartPagePrinter / EndPagePrinter for RAW TSPL jobs.
    Those calls wrap the data in a GDI page envelope which causes TSPL printers
    to emit an extra blank page before or after the label.
    """
    try:
        import win32print
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            win32print.StartDocPrinter(
                hprinter, 1, ("Barcode Studio TSPL Native Spool", None, "RAW")
            )
            # No StartPagePrinter / EndPagePrinter — raw protocol, no GDI page wrapping
            CHUNK_SIZE = 4096
            total_written = 0
            for offset in range(0, len(tspl_bytes), CHUNK_SIZE):
                chunk = tspl_bytes[offset:offset + CHUNK_SIZE]
                written = win32print.WritePrinter(hprinter, chunk)
                total_written += written

            win32print.EndDocPrinter(hprinter)
            logger.info(
                f"[TSPL] Successfully delivered {total_written} bytes in "
                f"{(len(tspl_bytes) + CHUNK_SIZE - 1) // CHUNK_SIZE} chunks to '{printer_name}'"
            )
            return True
        finally:
            win32print.ClosePrinter(hprinter)
    except Exception as ex:
        logger.error(f"[TSPL] win32print RAW delivery failed: {ex}")
        return False

def _deliver_via_tsclib(printer_name: str, tspl_bytes: bytes) -> bool:
    lib = _get_tsclib()
    if lib is None:
        return False

    try:
        port_bytes = printer_name.encode("utf-8") + b"\x00"
        lib.openport(port_bytes)
        # Send line-by-line (TSCLIB can't handle binary BITMAP data this way, 
        # but for text-only jobs it works as a fallback)
        for line in tspl_bytes.split(b"\r\n"):
            line = line.strip()
            if line:
                cmd_bytes = line + b"\r\n" + b"\x00"
                lib.sendcommand(cmd_bytes)
        lib.closeport()
        logger.info(f"[TSPL] TSCLIB.dll delivered {len(tspl_bytes)} bytes to '{printer_name}'")
        return True
    except Exception as ex:
        logger.error(f"[TSPL] TSCLIB.dll delivery failed: {ex}")
        try:
            lib.closeport()
        except Exception:
            pass
        return False

def _deliver_via_tcp(ip_address: str, tspl_bytes: bytes, port: int = 9100) -> bool:
    import socket
    try:
        with socket.create_connection((ip_address, port), timeout=10) as sock:
            sock.sendall(tspl_bytes)
        logger.info(f"[TSPL] Direct TCP delivered to {ip_address}:{port}")
        return True
    except Exception as ex:
        logger.error(f"[TSPL] Direct TCP delivery to {ip_address}:{port} failed: {ex}")
        return False

def _deliver_tspl(printer_name: str, tspl_bytes: bytes) -> bool:
    """Deliver print bytes in sequence of direct RAW methods."""
    # 1. Direct Win32print RAW Spool (Default on Windows)
    if _deliver_via_win32print_raw(printer_name, tspl_bytes):
        return True

    # 2. TSCLIB.dll Fallback (USB wrapper) - converts back to ASCII for SDK
    if _deliver_via_tsclib(printer_name, tspl_bytes):
        return True

    # 3. IP Network Fallback
    ip_pattern = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
    if ip_pattern.match(printer_name.strip()):
        return _deliver_via_tcp(printer_name, tspl_bytes)

    return False

def _detect_printer_dpi(printer_name: str) -> int:
    """Detect printer DPI via Windows DC or model keyword lookup for TSPL printers."""
    upper = printer_name.upper()

    if "300" in upper or "TE300" in upper or "TE310" in upper or "600" in upper:
        return 300

    try:
        import win32ui, win32con
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)
        dpi = hdc.GetDeviceCaps(win32con.LOGPIXELSX)
        del hdc
        if dpi and dpi > 0:
            if dpi in (96, 300) and any(k.upper() in upper for k in ("TSPL", "TSC", "ENDURA", "2801", "KORES", "GODEX", "TE200")):
                logger.info(f"[TSPL] Overriding generic GDI spooler DPI {dpi} -> using native 203 DPI for '{printer_name}'")
                return 203
            return dpi
    except Exception:
        pass

    return 203


def _get_tspl_render_orientation_and_rotation(requested_orient: str, requested_rot: int) -> tuple:
    """
    Computes the effective PIL render orientation and rotation angle for TSPL.
    
    TSC thermal printers physically feed paper bottom-first under DIRECTION 0,0,
    meaning an unrotated (0°) bitmap prints 180° rotated on the exiting label,
    while a 180° rotated bitmap prints 0° (upright).
    
    To ensure TSPL orientation matches ZPL and the print preview:
      physical_angle = (pil_angle + 180) % 360
      pil_angle      = (target_angle + 180) % 360
    """
    o = str(requested_orient or "").strip().lower()
    r = int(requested_rot or 0) % 360
    
    if r in (90, 180, 270):
        target_angle = r
    elif o in ("landscape", "90"):
        target_angle = 90
    elif o in ("portrait-180", "180", "upside_down", "reverse") or ("180" in o):
        target_angle = 180
    elif o in ("landscape-180", "270"):
        target_angle = 270
    else:
        target_angle = 0

    # Invert by 180° to compensate for TSC physical feed direction
    tspl_render_angle = (target_angle + 180) % 360

    if tspl_render_angle == 180:
        return "portrait-180", 180
    elif tspl_render_angle == 90:
        return "landscape", 90
    elif tspl_render_angle == 270:
        return "landscape-180", 270
    else:
        return "portrait", 0

# ─────────────────────────────────────────────────────────────────────────────
# TSPLDriver Class
# ─────────────────────────────────────────────────────────────────────────────

class TSPLDriver(PrinterDriverInterface):
    """
    Dedicated TSPL printer language driver.
    """
    driver_name = "TSPL (Direct Spooling)"

    @classmethod
    def is_supported(cls, printer_name: str) -> bool:
        """Determines if printer name or driver is TSPL-compatible."""
        p_name = (printer_name or "").lower()
        
        # If the printer name explicitly contains ZPL, EPL or GDI emulations, it is NOT TSPL
        if "zpl" in p_name or "epl" in p_name or "gdi" in p_name:
            return False

        # 1. Check printer name
        if _TSPL_PATTERNS.search(p_name):
            return True

        # 2. Check backing driver name on Windows
        try:
            import win32print
            hprinter = win32print.OpenPrinter(printer_name)
            try:
                info = win32print.GetPrinter(hprinter, 2)
                driver_name = (info.get("pDriverName", "") or "").lower()
                if "zpl" in driver_name or "epl" in driver_name or "gdi" in driver_name:
                    return False
                if _TSPL_PATTERNS.search(driver_name):
                    logger.info(f"[Router] Supported TSPL backing driver detected: '{driver_name}' for printer '{printer_name}'")
                    return True
            finally:
                win32print.ClosePrinter(hprinter)
        except Exception:
            pass

        return False

    def print_batch(
        self,
        printer_name: str,
        records: List[Dict[str, Any]],
        copies: int,
        template: Dict[str, Any],
        quality: str = "auto",
        dpi_override: Any = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Processes and delivers the batch of stickers using TSPL commands.
        """
        dpi = int(dpi_override) if dpi_override else _detect_printer_dpi(printer_name)
        logger.info(f"[TSPL] Spooling using {dpi} DPI calibration scale.")

        # Check if we are passing a unified print queue of (template, record) pairs
        is_queue = len(records) > 0 and isinstance(records[0], dict) and "template" in records[0] and "record" in records[0]

        flat_records = []
        if is_queue:
            # The queue already has copies resolved and flattened by the frontend
            flat_records = records
        else:
            for rec in records:
                for _ in range(copies):
                    flat_records.append({"template": template, "record": rec})

        job_template = dict(template or {})
        first_template = flat_records[0]["template"] if len(flat_records) > 0 else template
        columns = max(1, int(job_template.get("columns") or first_template.get("columns") or 1))
        
        # Dimensions and Margins
        width_mm = float(job_template.get("widthMm") or first_template.get("widthMm") or 50)
        height_mm = float(job_template.get("heightMm") or first_template.get("heightMm") or 30)
        margin_left_mm = float(job_template.get("marginLeft") if job_template.get("marginLeft") is not None else (first_template.get("marginLeft") if first_template.get("marginLeft") is not None else (2.0 if columns == 2 else 0.0)))
        margin_right_mm = float(job_template.get("marginRight") if job_template.get("marginRight") is not None else (first_template.get("marginRight") if first_template.get("marginRight") is not None else (2.0 if columns == 2 else 0.0)))
        margin_top_mm = float(job_template.get("marginTop") if job_template.get("marginTop") is not None else (first_template.get("marginTop") or 0.0))
        margin_bottom_mm = float(job_template.get("marginBottom") if job_template.get("marginBottom") is not None else (first_template.get("marginBottom") or 0.0))
        gap_horizontal_mm = float(job_template.get("gapHorizontal") if job_template.get("gapHorizontal") is not None else (first_template.get("gapHorizontal") if first_template.get("gapHorizontal") is not None else (2.0 if columns == 2 else 0.0)))
        orientation_raw = str(job_template.get("orientation") or first_template.get("orientation") or "portrait").lower()
        template_rot = int(job_template.get("rotation") or first_template.get("rotation") or 0)
        is_180 = ("180" in orientation_raw) or (orientation_raw in ("upside_down", "reverse")) or (template_rot == 180)

        # Swap visual width and height of physical sticker if printed in landscape
        if orientation_raw in ("landscape", "landscape-180") or template_rot in (90, 270):
            sticker_w = height_mm
            sticker_h = width_mm
        else:
            sticker_w = width_mm
            sticker_h = height_mm

        calc_page_w = margin_left_mm + columns * sticker_w + max(0, columns - 1) * gap_horizontal_mm + margin_right_mm
        page_w_mm = float(job_template.get("pageWidthMm") or first_template.get("pageWidthMm") or 0)
        if page_w_mm <= 0 or (columns > 1 and page_w_mm <= sticker_w):
            page_w_mm = calc_page_w

        page_h_mm = sticker_h + margin_top_mm + margin_bottom_mm

        # Detect physical hardware left margin (dots) from Windows printer DC.
        # TSPL REFERENCE command shifts the coordinate origin so that dot (0,0)
        # maps to the physical paper edge, cancelling the printer's built-in
        # unprintable left margin.
        hw_offset_x_dots = 0
        try:
            import win32ui, win32con
            _hdc = win32ui.CreateDC()
            _hdc.CreatePrinterDC(printer_name)
            hw_offset_x_dots = _hdc.GetDeviceCaps(getattr(win32con, "PHYSICALOFFSETX", 112))
            del _hdc
            logger.info(f"[TSPL] Hardware left offset: {hw_offset_x_dots} dots")
        except Exception:
            pass

        # Check if templates have images or non-ASCII text (both produce BITMAP commands,
        # which are incompatible with CODEPAGE UTF-8 declaration)
        def _has_bitmaps_in_template(tmpl):
            for el in tmpl.get("elements", []):
                if not el.get("visible", True):
                    continue
                if el.get("type") == "image":
                    return True
                if el.get("type") == "text":
                    val = _resolve_value(el, {})
                    try:
                        val.encode('ascii')
                    except UnicodeEncodeError:
                        return True
            return False

        has_bitmaps = _has_bitmaps_in_template(job_template) or _has_bitmaps_in_template(first_template)

        # Extract calibration parameters
        calibration = kwargs.get("calibration") or {}
        offset_x_mm = float(calibration.get("offsetX") or 0.0)
        offset_y_mm = float(calibration.get("offsetY") or 0.0)
        scale_x = float(calibration.get("scaleX") or 1.0)
        scale_y = float(calibration.get("scaleY") or 1.0)
        calib_rot = int(calibration.get("rotation") or 0)

        tspl_blocks_bytes: List[bytes] = []
        success_count = 0
        errors: List[str] = []
        dots_per_mm = dpi / 25.4

        # Calculate total combined offsets (API calibration + module constants + 180° mode offsets)
        base_tweak_x_mm = TSPL_180_OFFSET_X_MM if is_180 else TSPL_MANUAL_OFFSET_X_MM
        base_tweak_y_mm = TSPL_180_OFFSET_Y_MM if is_180 else TSPL_MANUAL_OFFSET_Y_MM
        
        total_offset_x_mm = offset_x_mm + base_tweak_x_mm
        total_offset_y_mm = offset_y_mm + base_tweak_y_mm
        
        logger.info(
            f"[TSPL] Alignment offsets: is_180={is_180}, "
            f"offset_x={total_offset_x_mm:.2f}mm (calib={offset_x_mm}, tweak={base_tweak_x_mm}), "
            f"offset_y={total_offset_y_mm:.2f}mm (calib={offset_y_mm}, tweak={base_tweak_y_mm})"
        )

        # Process layouts in chunks based on columns
        for i in range(0, len(flat_records), columns):
            block_bytes = bytearray()
            
            # Header commands - always assume has_bitmaps=True since we send a consolidated bitmap
            header_lines = build_tspl_label_header(job_template if job_template else first_template, dpi, hw_offset_x_dots, has_bitmaps=True)
            for line in header_lines:
                block_bytes.extend(line.encode('ascii') + b"\r\n")
            
            # 1. Render all labels in this row onto a single row-level PIL Image.
            # row_img is sized to the full page (including margins).
            # render_label_image() returns a bitmap sized to sticker_w x sticker_h
            # (the canvas/sticker dimensions only, without any page margins).
            # So we paste each label at the margin offsets to place it correctly
            # within the full-page bitmap.
            row_w_px = max(1, int(round(page_w_mm * dots_per_mm)))
            row_h_px = max(1, int(round(page_h_mm * dots_per_mm)))
            row_img = Image.new("RGB", (row_w_px, row_h_px), "white")
            
            for col in range(columns):
                idx = i + col
                if idx < len(flat_records):
                    item = flat_records[idx]
                    curr_template = item["template"]
                    curr_record = item["record"]
                    
                    curr_orient = str(curr_template.get("orientation") or orientation_raw).lower()
                    curr_rot = int(curr_template.get("rotation") if curr_template.get("rotation") is not None else template_rot)
                    curr_is_landscape = curr_orient in ("landscape", "landscape-180") or curr_rot in (90, 270)

                    col_sticker_w = height_mm if curr_is_landscape else width_mm
                    col_sticker_h = width_mm if curr_is_landscape else height_mm
                    
                    # Compute compensated orientation for TSPL thermal printhead
                    render_orient, render_rot = _get_tspl_render_orientation_and_rotation(curr_orient, curr_rot)

                    tmpl_for_render = dict(curr_template)
                    tmpl_for_render["widthMm"] = width_mm
                    tmpl_for_render["heightMm"] = height_mm
                    tmpl_for_render["orientation"] = render_orient
                    tmpl_for_render["rotation"] = render_rot

                    # Render single label at native printer DPI (render_label_image applies orientation rotation internally)
                    lbl_img = render_label_image(tmpl_for_render, curr_record, dpi)
                    
                    # Paste position: margin + column offset + total offset (page-relative coordinates)
                    lbl_x_mm = margin_left_mm + col * (col_sticker_w + gap_horizontal_mm) + total_offset_x_mm
                    lbl_y_mm = margin_top_mm + total_offset_y_mm
                    lbl_x_dots = int(round(lbl_x_mm * dots_per_mm))
                    lbl_y_dots = int(round(lbl_y_mm * dots_per_mm))
                    
                    row_img.paste(lbl_img, (lbl_x_dots, lbl_y_dots))
            
            # 2. Apply calibration rotation if specified
            if calib_rot != 0:
                row_img = row_img.rotate(-calib_rot, expand=False, resample=Image.Resampling.BICUBIC)
                
            # 3. Apply calibration scaling
            if scale_x != 1.0 or scale_y != 1.0:
                new_w_px = max(1, int(round(row_img.width * scale_x)))
                new_h_px = max(1, int(round(row_img.height * scale_y)))
                row_img = row_img.resize((new_w_px, new_h_px), Image.Resampling.BICUBIC)
                
            # 4. Convert row-level PIL Image to TSPL raw BITMAP bytes
            w_d, h_d, width_bytes, raw_bytes = _pil_image_to_tspl_bitmap_bytes(row_img)

            # Bitmap placed at (0,0) on page since offsets are baked into row_img
            bitmap_cmd = f"BITMAP 0,0,{width_bytes},{h_d},0,".encode('ascii')
            block_bytes.extend(bitmap_cmd + raw_bytes + b"\r\n")
            
            # PRINT 1,1 — print 1 label (set), 1 copy each.
            # The second parameter (copies per set) must always be present for
            # TSC/TSPL firmware; omitting it can cause double-feed on some models.
            block_bytes.extend(b"PRINT 1,1\r\n")
            tspl_blocks_bytes.append(bytes(block_bytes))

        # ── Diagnostic dump ─────────────────────────────────────────────
        # Only dump binary debug blocks when TSPL_DEBUG environment variable is enabled,
        # and always write to the OS temporary folder so it never pollutes the project root
        # or triggers file watchers / app reloads in dev mode.
        if os.environ.get("TSPL_DEBUG") == "1":
            try:
                import tempfile
                debug_path = Path(tempfile.gettempdir()) / "tspl_debug.txt"
                with open(debug_path, "wb") as dbg:
                    dbg.write(f"# TSPL Diagnostic Dump (BINARY)\n".encode('ascii'))
                    dbg.write(f"# Printer: {printer_name}\n".encode('ascii'))
                    dbg.write(f"# DPI: {dpi}\n".encode('ascii'))
                    dbg.write(f"# Template widthMm={width_mm} heightMm={height_mm} columns={columns}\n".encode('ascii'))
                    dbg.write(f"# margin_left={margin_left_mm} margin_top={margin_top_mm} gap_h={gap_horizontal_mm}\n".encode('ascii'))
                    dbg.write(f"# hw_offset_x_dots={hw_offset_x_dots}\n".encode('ascii'))
                    dbg.write(f"# Elements count: {len(first_template.get('elements', []))}\n".encode('ascii'))
                    dbg.write(f"# has_bitmaps: {has_bitmaps}\n\n".encode('ascii'))
                    for i, block_bytes in enumerate(tspl_blocks_bytes[:3]):  # First 3 blocks only
                        dbg.write(f"=== BLOCK {i} ({len(block_bytes)} bytes) ===\n".encode('ascii'))
                        dbg.write(block_bytes)
                        dbg.write(b"\n\n")
                logger.info(f"[TSPL] Debug dump written to: {debug_path}")
            except Exception as _dbg_ex:
                logger.debug(f"[TSPL] Could not write debug dump: {_dbg_ex}")
        # ────────────────────────────────────────────────────────────────

        # Execute jobs
        for idx, tspl_bytes in enumerate(tspl_blocks_bytes):
            ok = _deliver_tspl(printer_name, tspl_bytes)
            if ok:
                labels_in_block = min(len(flat_records), (idx + 1) * columns) - (idx * columns)
                success_count += max(0, labels_in_block)
            else:
                errors.append(f"Spool batch {idx} delivery failed")

        success = success_count > 0
        result = {
            "success": success,
            "count": success_count,
            "total": len(flat_records),
            "driver": self.driver_name,
            "dpi": dpi
        }
        if errors:
            result["warnings"] = errors
            result["message"] = "; ".join(errors)

        return result

    @classmethod
    def get_driver_info(cls) -> Dict[str, Any]:
        lib = _get_tsclib()
        try:
            import win32print
            spooler_ok = True
        except ImportError:
            spooler_ok = False

        return {
            "driver": cls.driver_name,
            "tsclib_loaded": lib is not None,
            "win32print": spooler_ok
        }
