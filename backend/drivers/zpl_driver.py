"""
zpl_driver.py — Native Zebra ZPL printer driver for thermal label printers.

Supports:
  - Zebra ZPL / ZPL II compatible thermal label printers (Zebra, Kores Endura ZPL, Godex ZPL, etc.)
  - Direct Windows API raw printing via win32print (pDatatype="RAW")
  - Network socket TCP delivery (port 9100)
  - Multi-column sticker roll rendering & native ZPL elements (^FO, ^BC, ^BQ, ^GB, ^A0, ^GF)
"""
import re
import socket
from typing import Any, Dict, List
from typing import Tuple
from PIL import Image, ImageDraw, ImageFont

from backend.drivers.base_driver import PrinterDriverInterface
from backend.services.logging_service import get_logger

logger = get_logger()

_ZPL_KEYWORDS = [
    "zpl", "zebra", "endura", "zd", "gk", "gx", "zt", "zm",
    "tlp", "lp2844", "intermec", "datamax", "sato", "bixolon", "godex"
]

_ZPL_PATTERNS = re.compile(
    r"(" + "|".join(re.escape(k) for k in _ZPL_KEYWORDS) + r")",
    re.IGNORECASE
)

_ZPL_DPI_MAP = {
    "2801": 203,
    "GK420": 203,
    "GX420": 203,
    "ZD420": 203,
    "ZD220": 203,
    "ZD230": 203,
    "ZT230": 203,
    "ZT410": 203,
    "300": 300,
    "600": 600,
}

def _detect_printer_dpi(printer_name: str) -> int:
    """Detect printer DPI via Windows DC or model keyword lookup, strictly defaulting to physical 203 DPI for thermal drivers."""
    upper = printer_name.upper()

    # 1. Model keyword matching (highest priority for thermal hardware precision)
    for model, dpi in _ZPL_DPI_MAP.items():
        if model in upper:
            logger.info(f"[ZPL] Hardware model '{model}' matched -> using native {dpi} DPI calibration")
            return dpi

    # 2. Query Windows Device Capabilities
    try:
        import win32ui, win32con
        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)
        dpi = hdc.GetDeviceCaps(win32con.LOGPIXELSX)
        del hdc
        if dpi and dpi > 0:
            # Generic Windows GDI spooler returns 96 or 300 when no driver override is present.
            # Thermal label printers (ZPL/TSPL) require native 203 DPI (8 dots/mm) printhead resolution.
            if dpi in (96, 300) and any(k.upper() in upper for k in ("ZPL", "ZEBRA", "ENDURA", "2801", "KORES", "TSC", "GODEX")):
                logger.info(f"[ZPL] Overriding generic GDI spooler DPI {dpi} -> using native 203 DPI for '{printer_name}'")
                return 203
            logger.info(f"[ZPL] Detected driver DPI for '{printer_name}': {dpi}")
            return dpi
    except Exception:
        pass

    return 203  # Native thermal printhead resolution (8 dots/mm)


def _deliver_via_win32print_raw(printer_name: str, zpl_bytes: bytes) -> bool:
    """Send raw ZPL bytes to Windows Print Spooler with pDatatype="RAW"."""
    try:
        import win32print
        hprinter = win32print.OpenPrinter(printer_name)
        try:
            win32print.StartDocPrinter(hprinter, 1, ("Barcode Studio ZPL Native Spool", None, "RAW"))
            win32print.StartPagePrinter(hprinter)
            
            CHUNK_SIZE = 4096
            total_written = 0
            for offset in range(0, len(zpl_bytes), CHUNK_SIZE):
                chunk = zpl_bytes[offset:offset + CHUNK_SIZE]
                written = win32print.WritePrinter(hprinter, chunk)
                total_written += written
            
            win32print.EndPagePrinter(hprinter)
            win32print.EndDocPrinter(hprinter)
            logger.info(f"[ZPL] Delivered {total_written} raw bytes to printer '{printer_name}' via win32print RAW")
            return True
        finally:
            win32print.ClosePrinter(hprinter)
    except Exception as ex:
        logger.error(f"[ZPL] win32print RAW delivery failed: {ex}")
        return False


def _deliver_via_tcp(ip_address: str, zpl_bytes: bytes, port: int = 9100) -> bool:
    """Send raw ZPL bytes directly to network printer over TCP socket."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(10)
            sock.connect((ip_address, port))
            sock.sendall(zpl_bytes)
        logger.info(f"[ZPL] Direct TCP delivery to {ip_address}:{port} succeeded ({len(zpl_bytes)} bytes)")
        return True
    except Exception as ex:
        logger.error(f"[ZPL] Direct TCP delivery to {ip_address}:{port} failed: {ex}")
        return False


def _deliver_zpl(printer_name: str, zpl_bytes: bytes) -> bool:
    """Deliver ZPL bytes via win32print or network TCP socket."""
    if _deliver_via_win32print_raw(printer_name, zpl_bytes):
        return True

    ip_pattern = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
    if ip_pattern.match(printer_name.strip()):
        return _deliver_via_tcp(printer_name, zpl_bytes)

    return False


def _resolve_value(el: Dict[str, Any], record: Dict[str, Any]) -> str:
    raw = el.get("text", "")
    field = el.get("fieldName")
    if field and record and field in record:
        val = record[field]
        if val is not None:
            raw = str(val)
    if not raw or not raw.strip():
        el_type = el.get("type", "")
        if el_type in ("barcode", "qrcode"):
            raw = "12345678"
        else:
            raw = ""
    return f"{el.get('prefix', '')}{raw}{el.get('suffix', '')}"


def _get_font_for_text(font_family: str, bold: bool, italic: bool, text: str, size_px: int) -> ImageFont.ImageFont:
    """Font loader utility loading local .ttf font files with automatic Nirmala UI fallback for Devnagari/Hindi."""
    has_devnagari = any(0x0900 <= ord(c) <= 0x0D7F for c in text)
    if has_devnagari:
        font_family = "nirmala"

    size_px = max(4, int(size_px))

    try:
        from backend.services.printer_service import (
            get_font_path,
            _font_candidates_for_script,
            _detect_script_kind,
            _load_text_font,
        )
        script_kind = "indic" if has_devnagari else _detect_script_kind(text)
        preferred_path = get_font_path(font_family, bold, italic)
        font_candidates = _font_candidates_for_script(script_kind, bold, italic, preferred_path)
        complex_layout = script_kind != "latin" or has_devnagari

        return _load_text_font(font_candidates, size_px, complex_layout, text)
    except Exception as ex:
        logger.warning(f"[ZPL Font Loader] Font resolution warning: {ex}")

    # Fallback to direct TTF file lookup
    import os
    try:
        from backend.services.printer_service import get_bundled_fonts_dir
        bundled_dir = get_bundled_fonts_dir()
    except Exception:
        bundled_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fonts")

    candidate_paths = []
    if has_devnagari or "nirmala" in font_family.lower():
        nirmala_name = "nirmala-bold.ttf" if bold else "nirmala.ttf"
        candidate_paths.extend([
            os.path.join(bundled_dir, nirmala_name),
            os.path.join(bundled_dir, "NirmalaB.ttf" if bold else "Nirmala.ttf"),
            os.path.join("C:\\Windows\\Fonts", "nirmala-bold.ttf" if bold else "nirmala.ttf"),
            os.path.join("C:\\Windows\\Fonts", "nirmalab.ttf" if bold else "nirmala.ttf"),
            os.path.join("C:\\Windows\\Fonts", "NirmalaB.ttf" if bold else "Nirmala.ttf"),
            "C:\\Windows\\Fonts\\Nirmala.ttc",
        ])
    else:
        candidate_paths.extend([
            os.path.join(bundled_dir, "arialbd.ttf" if bold else "arial.ttf"),
            os.path.join(bundled_dir, "segoeuib.ttf" if bold else "segoeui.ttf"),
            os.path.join("C:\\Windows\\Fonts", "arialbd.ttf" if bold else "arial.ttf"),
            os.path.join("C:\\Windows\\Fonts", "segoeuib.ttf" if bold else "segoeui.ttf"),
        ])

    for font_path in candidate_paths:
        if font_path and os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size_px)
            except Exception:
                continue

    return ImageFont.load_default()


def _render_text_element_to_pil(el: Dict[str, Any], text: str, w_dots: int, h_dots: int, dpi: int) -> Image.Image:
    """Render a text element onto a 1-bit monochrome PIL Image matching canvas typography, font family, weight, and alignment."""
    w_px = max(1, w_dots)
    h_px = max(1, h_dots)

    font_family = str(el.get("fontFamily", "Segoe UI")).strip()
    font_size_pt = float(el.get("fontSize", 10))
    fw_val = str(el.get("fontWeight", "")).lower()
    bold = fw_val in ("bold", "700", "800", "900") or el.get("bold") is True or el.get("fontWeight") == 700
    italic = el.get("fontStyle") == "italic"
    text_align = str(el.get("textAlign", "left")).lower()
    wrap_text = bool(el.get("wrapText", False))
    auto_shrink = bool(el.get("autoShrink", False))

    font_size_px = int(round(font_size_pt * (dpi / 72.0)))
    font = _get_font_for_text(font_family, bold, italic, text, font_size_px)

    has_devnagari = any(0x0900 <= ord(c) <= 0x0D7F for c in text)
    if has_devnagari:
        top_padding = int(round(font_size_px * 0.35))
        bottom_padding = int(round(font_size_px * 0.25))
        side_padding = max(4, int(round(font_size_px * 0.10)))
    else:
        top_padding = 0
        bottom_padding = 0
        side_padding = 0

    canvas_w = max(1, w_px + side_padding * 2)
    canvas_h = max(1, h_px + top_padding + bottom_padding)

    # Grayscale L mode with solid white background (255)
    img = Image.new("L", (canvas_w, canvas_h), 255)
    draw = ImageDraw.Draw(img)

    def _measure_str(s: str, fnt) -> float:
        if hasattr(fnt, 'getlength'):
            return fnt.getlength(s)
        elif hasattr(fnt, 'getbbox'):
            bb = fnt.getbbox(s)
            return bb[2] - bb[0]
        return len(s) * 8.0

    def wrap_text_pil(txt: str, fnt, max_w: int) -> List[str]:
        is_cjk_no_spaces = any(
            (0x4E00 <= ord(c) <= 0x9FFF) or
            (0x3040 <= ord(c) <= 0x30FF) or
            (0xAC00 <= ord(c) <= 0xD7AF)
            for c in txt
        )

        wrapped_lines: List[str] = []
        paragraphs = txt.replace("\r\n", "\n").replace("\r", "\n").split("\n")

        for para in paragraphs:
            if not para.strip():
                wrapped_lines.append("")
                continue

            if is_cjk_no_spaces:
                curr_line = ""
                for char in para:
                    test = curr_line + char
                    if _measure_str(test, fnt) <= max_w:
                        curr_line = test
                    else:
                        if curr_line:
                            wrapped_lines.append(curr_line)
                        curr_line = char
                if curr_line:
                    wrapped_lines.append(curr_line)
            else:
                words = para.split(" ")
                curr_line_words: List[str] = []
                for word in words:
                    test_line = " ".join(curr_line_words + [word]) if curr_line_words else word
                    if _measure_str(test_line, fnt) <= max_w:
                        curr_line_words.append(word)
                    else:
                        if curr_line_words:
                            wrapped_lines.append(" ".join(curr_line_words))
                            curr_line_words = []

                        if _measure_str(word, fnt) > max_w:
                            part = ""
                            for char in word:
                                if _measure_str(part + char, fnt) <= max_w:
                                    part += char
                                else:
                                    if part:
                                        wrapped_lines.append(part)
                                    part = char
                            if part:
                                curr_line_words = [part]
                        else:
                            curr_line_words = [word]
                if curr_line_words:
                    wrapped_lines.append(" ".join(curr_line_words))

        return wrapped_lines if wrapped_lines else [txt]

    fill_color = 0  # 0 = Pure black text on white background in mode L

    if wrap_text:
        min_size_px = max(4, int(round(4.0 * (dpi / 72.0))))
        while font_size_px > min_size_px:
            font = _get_font_for_text(font_family, bold, italic, text, font_size_px)
            lines = wrap_text_pil(text, font, max(1, w_px - 4))
            line_h_px = font.getbbox("A")[3] - font.getbbox("A")[1] if hasattr(font, 'getbbox') else font_size_px
            line_spacing_px = max(1, int(line_h_px * 0.25))
            tot_h = len(lines) * (line_h_px + line_spacing_px) - line_spacing_px
            max_line_w = max(_measure_str(l, font) for l in lines) if lines else 0

            if tot_h <= h_px and max_line_w <= max(1, w_px - 4):
                break
            if not auto_shrink and tot_h <= h_px * 1.05 and max_line_w <= w_px:
                break
            font_size_px -= 1
        else:
            font = _get_font_for_text(font_family, bold, italic, text, font_size_px)
            lines = wrap_text_pil(text, font, max(1, w_px - 4))

        line_h_px = font.getbbox("A")[3] - font.getbbox("A")[1] if hasattr(font, 'getbbox') else font_size_px
        line_spacing_px = max(1, int(line_h_px * 0.25))
        line_height_total = line_h_px + line_spacing_px
        total_text_h = len(lines) * line_height_total - line_spacing_px
        start_y = top_padding + max(0, (h_px - total_text_h) // 2)

        for i, line in enumerate(lines):
            line_w = _measure_str(line, font)
            if text_align == "center":
                cx = side_padding + w_px // 2
            elif text_align == "right":
                cx = side_padding + max(0, int(w_px - line_w / 2.0))
            else:
                cx = side_padding + int(line_w / 2.0)
            cy = start_y + i * line_height_total + line_h_px // 2
            if cy <= canvas_h:
                draw.text((cx, cy), line, font=font, fill=fill_color, anchor="mm")
                if bold:
                    draw.text((cx + 1, cy), line, font=font, fill=fill_color, anchor="mm")
    else:
        # Auto-adjust font size so single-line text fits element width & height
        min_size_px = max(4, int(round(4.0 * (dpi / 72.0))))
        while font_size_px > min_size_px:
            font = _get_font_for_text(font_family, bold, italic, text, font_size_px)
            tw = _measure_str(text, font)
            th = font.getbbox("A")[3] - font.getbbox("A")[1] if hasattr(font, 'getbbox') else font_size_px
            if tw <= max(1, w_px - 4) and (not auto_shrink or th <= h_px):
                break
            font_size_px -= 1
        else:
            font = _get_font_for_text(font_family, bold, italic, text, font_size_px)

        tw = _measure_str(text, font)
        if text_align == "center":
            cx = side_padding + w_px // 2
        elif text_align == "right":
            cx = side_padding + max(0, int(w_px - tw / 2.0))
        else:
            cx = side_padding + int(tw / 2.0)
        cy = top_padding + h_px // 2

        draw.text((cx, cy), text, font=font, fill=fill_color, anchor="mm")
        if bold:
            draw.text((cx + 1, cy), text, font=font, fill=fill_color, anchor="mm")

    # Hard binary thresholding at 128 (values < 128 -> pure black 0, >= 128 -> pure white 255)
    return img.point(lambda p: 0 if p < 128 else 255, mode="1")


def _trim_text_image(img: Image.Image, text: str = "") -> Tuple[Image.Image, int, int]:
    """
    Tightly trim empty white padding surrounding actual rendered text characters in a PIL Image.
    Preserves matra-aware safety padding (6px for Indic / Devanagari text, 4px for Latin).
    Returns (cropped_image, offset_x, offset_y).
    """
    has_devnagari = any(0x0900 <= ord(c) <= 0x0D7F for c in text)
    pad = 6 if has_devnagari else 4

    try:
        from PIL import ImageOps
        gray = img.convert("L") if img.mode != "L" else img
        inverted = ImageOps.invert(gray)
        bbox = inverted.getbbox()  # (left, top, right, bottom) of non-zero (black text) pixels
        if bbox:
            left, top, right, bottom = bbox
            pad_left = max(0, left - pad)
            pad_top = max(0, top - pad)
            pad_right = min(img.width, right + pad)
            pad_bottom = min(img.height, bottom + pad)
            cropped = img.crop((pad_left, pad_top, pad_right, pad_bottom))
            return cropped, pad_left, pad_top
    except Exception as ex:
        logger.warning(f"[ZPL] Tight trim failed: {ex}")
    return img, 0, 0


def _image_to_zpl_gf(img: Image.Image, x_dots: int, y_dots: int) -> str:
    """Convert PIL Image to ZPL ^GF (Graphic Field) hex command with strict 128 binary thresholding."""
    if img.mode != "1":
        mono = img.convert("L").point(lambda p: 0 if p < 128 else 255, mode="1")
    else:
        mono = img

    width_bytes = (mono.width + 7) // 8
    total_bytes = width_bytes * mono.height
    
    hex_lines = []
    for y in range(mono.height):
        byte_val = 0
        bit_count = 0
        row_hex = []
        for x in range(mono.width):
            pixel = mono.getpixel((x, y))
            # In mode 1: 0 = black (print dot), 255 / 1 = white (no dot)
            bit = 1 if pixel == 0 else 0
            byte_val = (byte_val << 1) | bit
            bit_count += 1
            if bit_count == 8:
                row_hex.append(f"{byte_val:02X}")
                byte_val = 0
                bit_count = 0
        if bit_count > 0:
            byte_val = byte_val << (8 - bit_count)
            row_hex.append(f"{byte_val:02X}")
        hex_lines.append("".join(row_hex))
        
    hex_str = "".join(hex_lines)
    return f"^FO{x_dots},{y_dots}^GFA,{total_bytes},{total_bytes},{width_bytes},{hex_str}^FS\n"


def _get_zpl_orient(el_rot: int) -> str:
    rot = int(el_rot) % 360
    if rot == 90:
        return "R"
    elif rot == 180:
        return "I"
    elif rot == 270:
        return "B"
    return "N"


def _clamp_element_bounds(
    x_dots: int,
    y_dots: int,
    w_dots: int,
    h_dots: int,
    min_x: int,
    max_x: int,
    min_y: int,
    max_y: int
) -> Tuple[int, int, int, int]:
    """
    Dynamically clamp element coordinates (X, Y) and dimensions (width, height)
    relative to physical printable label boundaries and inner safe margins.
    """
    clamped_x = max(min_x, min(x_dots, max_x - 1))
    clamped_y = max(min_y, min(y_dots, max_y - 1))

    avail_w = max(1, max_x - clamped_x)
    avail_h = max(1, max_y - clamped_y)

    clamped_w = max(1, min(w_dots, avail_w))
    clamped_h = max(1, min(h_dots, avail_h))

    return clamped_x, clamped_y, clamped_w, clamped_h


class ZPLDriver(PrinterDriverInterface):
    """
    Native ZPL printer language driver with direct win32print RAW delivery.
    """
    driver_name = "Zebra ZPL (Direct Spooling)"

    @classmethod
    def is_supported(cls, printer_name: str) -> bool:
        p_name = (printer_name or "").lower()

        # 1. Direct name match
        if _ZPL_PATTERNS.search(p_name):
            return True

        # 2. Backing driver name match on Windows
        try:
            import win32print
            hprinter = win32print.OpenPrinter(printer_name)
            try:
                info = win32print.GetPrinter(hprinter, 2)
                driver_name = (info.get("pDriverName", "") or "").lower()
                if _ZPL_PATTERNS.search(driver_name):
                    logger.info(f"[Router] Supported ZPL backing driver detected: '{driver_name}' for printer '{printer_name}'")
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
        dpi = int(dpi_override) if dpi_override else _detect_printer_dpi(printer_name)
        logger.info(f"[ZPL] Spooling native ZPL batch for printer '{printer_name}' using {dpi} DPI calibration.")

        # Determine batch records: do NOT duplicate records by copies in Python!
        # Copy count is passed directly to ZPL ^PQ command per label.
        is_queue = len(records) > 0 and isinstance(records[0], dict) and "template" in records[0] and "record" in records[0]
        
        raw_records = []
        if is_queue:
            raw_records = records
        else:
            for rec in records:
                raw_records.append({"template": template, "record": rec})

        if not raw_records:
            return {"success": True, "count": 0, "total": 0, "driver": self.driver_name, "message": "No records to print"}

        first_template = raw_records[0]["template"] if len(raw_records) > 0 else template
        columns = max(1, int(first_template.get("columns") or 1))

        width_mm = float(first_template.get("widthMm", 50))
        height_mm = float(first_template.get("heightMm", 30))
        margin_left_mm = float(first_template.get("marginLeft", 0))
        margin_right_mm = float(first_template.get("marginRight", 0))
        margin_top_mm = float(first_template.get("marginTop", 0))
        margin_bottom_mm = float(first_template.get("marginBottom", 0))
        gap_horizontal_mm = float(first_template.get("gapHorizontal", 0))
        orientation = str(first_template.get("orientation", "portrait")).lower()
        template_rotation = int(first_template.get("rotation", 0))

        # Check for 180 degree rotation / inverted printing
        is_180 = ("180" in orientation) or (orientation in ("upside_down", "reverse")) or (template_rotation == 180)

        if orientation in ("landscape", "landscape-180"):
            sticker_w = height_mm
            sticker_h = width_mm
        else:
            sticker_w = width_mm
            sticker_h = height_mm

        page_w_mm = float(first_template.get("pageWidthMm") or 0)
        if page_w_mm <= 0:
            page_w_mm = margin_left_mm + columns * sticker_w + (columns - 1) * gap_horizontal_mm + margin_right_mm

        page_h_mm = float(first_template.get("pageHeightMm") or 0)
        if page_h_mm <= 0:
            page_h_mm = margin_top_mm + sticker_h + margin_bottom_mm

        dots_per_mm = dpi / 25.4
        page_w_dots = int(round(page_w_mm * dots_per_mm))
        page_h_dots = int(round(page_h_mm * dots_per_mm))

        # Define a safe inner padding margin (1.5mm) to protect thermal printhead edges & sticker corners
        safe_margin_dots = max(2, int(round(1.5 * dots_per_mm)))

        zpl_lines: List[str] = []
        num_copies = max(1, int(copies))

        # Process records in groups of 'columns'
        for i in range(0, len(raw_records), columns):
            col_group = raw_records[i : i + columns]

            # Start label format block with explicit ^LH0,0, ^PW, ^LL, and thermal density settings
            zpl_lines.append("^XA")
            zpl_lines.append("^LH0,0")
            zpl_lines.append("~SD20")         # Set Darkness/Heat Density to 20 (out of 30) for deep black burn
            zpl_lines.append("^MD12")         # Media Darkness adjustment (+12)
            zpl_lines.append("^PR2")          # Set Print Speed to 2 inches/sec (slower speed prevents dot dropouts)
            zpl_lines.append(f"^PW{page_w_dots}")
            zpl_lines.append(f"^LL{page_h_dots}")
            zpl_lines.append("^LS0")

            # Apply orientation: ^POI for 180° inverted, ^PON for normal
            if is_180:
                zpl_lines.append("^POI")
            else:
                zpl_lines.append("^PON")

            for col_idx, item in enumerate(col_group):
                curr_tmpl = item["template"]
                curr_rec = item["record"]

                col_offset_x = margin_left_mm + col_idx * (sticker_w + gap_horizontal_mm)
                col_offset_y = margin_top_mm

                col_left_dots = int(round(col_offset_x * dots_per_mm))
                col_top_dots = int(round(col_offset_y * dots_per_mm))
                col_w_dots = int(round(sticker_w * dots_per_mm))
                col_h_dots = int(round(sticker_h * dots_per_mm))

                # Printable dot boundaries for this sticker column (clamped inside page dimensions)
                min_x = max(0, col_left_dots + safe_margin_dots)
                max_x = min(page_w_dots, col_left_dots + col_w_dots - safe_margin_dots)
                min_y = max(0, col_top_dots + safe_margin_dots)
                max_y = min(page_h_dots, col_top_dots + col_h_dots - safe_margin_dots)

                if max_x <= min_x:
                    max_x = min(page_w_dots, min_x + max(10, col_w_dots))
                if max_y <= min_y:
                    max_y = min(page_h_dots, min_y + max(10, col_h_dots))

                # Track last non-wrapped text element for dynamic inline positioning
                last_text_end_x_dots = -1
                last_text_y_mm = -1.0
                last_text_container_end_x_mm = -1.0

                for el in curr_tmpl.get("elements", []):
                    if not el.get("visible", True):
                        continue

                    el_type = el.get("type", "")
                    el_x = float(el.get("x", 0)) + col_offset_x
                    el_y = float(el.get("y", 0)) + col_offset_y
                    el_w = float(el.get("width", 10))
                    el_h = float(el.get("height", 10))
                    el_rot = int(el.get("rotation", 0))

                    raw_x_dots = int(round(el_x * dots_per_mm))
                    raw_y_dots = int(round(el_y * dots_per_mm))
                    raw_w_dots = int(round(el_w * dots_per_mm))
                    raw_h_dots = int(round(el_h * dots_per_mm))

                    orient_code = _get_zpl_orient(el_rot)

                    if el_type == "text":
                        val = _resolve_value(el, curr_rec)
                        font_family = str(el.get("fontFamily", "Segoe UI")).strip().lower()
                        has_non_ascii = any(ord(c) > 127 for c in val)
                        wrap_text = bool(el.get("wrapText", False))
                        auto_shrink = bool(el.get("autoShrink", False))
                        fw = str(el.get("fontWeight", "")).lower()
                        is_bold = fw in ("bold", "700", "800", "900") or el.get("bold") is True or el.get("fontWeight") == 700
                        is_italic = el.get("fontStyle") == "italic"
                        is_custom_font = font_family not in ("zebra font 0", "standard", "mono", "zpl_default", "font 0", "^a0")

                        # Dynamic inline position adjustment if anchored right after previous text
                        if (not wrap_text and 
                            last_text_end_x_dots > 0 and 
                            abs(el_y - last_text_y_mm) < 3.0 and 
                            el_x <= (last_text_container_end_x_mm + 5.0)):
                            
                            spacing_gap_mm = max(1.0, el_x - last_text_container_end_x_mm) if el_x > last_text_container_end_x_mm else 1.5
                            spacing_gap_dots = int(round(spacing_gap_mm * dots_per_mm))
                            raw_x_dots = last_text_end_x_dots + spacing_gap_dots
                            logger.info(f"[ZPL] Dynamically adjusting inline text X position to {raw_x_dots} dots for val='{val}'")

                        clamped_x, clamped_y, clamped_w, clamped_h = _clamp_element_bounds(
                            raw_x_dots, raw_y_dots, raw_w_dots, raw_h_dots, min_x, max_x, min_y, max_y
                        )

                        # Convert custom fonts, non-ASCII text, wrapped text, auto-shrunk text, or styled text to 1-bit monochrome graphic ^GF
                        use_graphic_text = is_custom_font or has_non_ascii or wrap_text or auto_shrink or is_bold or is_italic

                        if use_graphic_text:
                            pil_img = _render_text_element_to_pil(el, val, clamped_w, clamped_h, dpi)
                            cropped_img, offset_x, offset_y = _trim_text_image(pil_img, val)

                            real_x_dots = clamped_x + offset_x
                            real_y_dots = clamped_y + offset_y

                            real_x_dots = max(min_x, min(real_x_dots, max_x - 1))
                            real_y_dots = max(min_y, min(real_y_dots, max_y - 1))

                            img_max_w = max(1, max_x - real_x_dots)
                            img_max_h = max(1, max_y - real_y_dots)
                            if cropped_img.width > img_max_w or cropped_img.height > img_max_h:
                                cropped_img = cropped_img.crop((0, 0, min(cropped_img.width, img_max_w), min(cropped_img.height, img_max_h)))

                            gf_zpl = _image_to_zpl_gf(cropped_img, real_x_dots, real_y_dots)
                            zpl_lines.append(gf_zpl.strip())

                            if not wrap_text:
                                last_text_end_x_dots = real_x_dots + cropped_img.width
                                last_text_y_mm = el_y
                                last_text_container_end_x_mm = el_x + el_w
                            else:
                                last_text_end_x_dots = -1
                        else:
                            font_size = float(el.get("fontSize", 10))
                            font_h_dots = max(8, int(round((font_size / 72.0 * 25.4) * dots_per_mm)))
                            font_w_dots = int(round(font_h_dots * 0.90))

                            max_lines = max(1, clamped_h // max(1, font_h_dots))
                            text_align = str(el.get("textAlign", "left")).lower()
                            align_char = "C" if text_align == "center" else ("R" if text_align == "right" else ("J" if text_align == "justify" else "L"))

                            # Enforce ^FB (Field Block) so native font text wraps/truncates inside clamped printable width
                            zpl_lines.append(
                                f"^FO{clamped_x},{clamped_y}^A0{orient_code},{font_h_dots},{font_w_dots}"
                                f"^FB{clamped_w},{max_lines},0,{align_char}^FD{val}^FS"
                            )

                            if not wrap_text:
                                tight_w_estimate = int(round(min(len(val) * font_w_dots, clamped_w)))
                                last_text_end_x_dots = clamped_x + tight_w_estimate
                                last_text_y_mm = el_y
                                last_text_container_end_x_mm = el_x + el_w
                            else:
                                last_text_end_x_dots = -1

                    elif el_type == "barcode":
                        clamped_x, clamped_y, clamped_w, clamped_h = _clamp_element_bounds(
                            raw_x_dots, raw_y_dots, raw_w_dots, raw_h_dots, min_x, max_x, min_y, max_y
                        )
                        val = _resolve_value(el, curr_rec)
                        b_type = str(el.get("barcodeType", "code128")).lower()
                        bar_h_dots = max(15, clamped_h)
                        module_w = max(1, int(round(float(el.get("barWidth", 0.35)) * dots_per_mm)))
                        show_txt = "Y" if el.get("showText", False) else "N"

                        # Estimate barcode width and dynamically scale down module_w if width exceeds printable space
                        val_len = len(val)
                        if "39" in b_type:
                            modules_est = val_len * 16 + 30
                        elif "ean" in b_type or "upc" in b_type:
                            modules_est = 95
                        else:
                            modules_est = val_len * 11 + 35

                        while module_w > 1 and (modules_est * module_w) > clamped_w:
                            module_w -= 1

                        if "39" in b_type:
                            zpl_lines.append(f"^FO{clamped_x},{clamped_y}^BY{module_w},3,{bar_h_dots}^B3{orient_code},N,{bar_h_dots},{show_txt},N^FD{val}^FS")
                        elif "ean" in b_type or "upc" in b_type:
                            zpl_lines.append(f"^FO{clamped_x},{clamped_y}^BY{module_w},3,{bar_h_dots}^BE{orient_code},{bar_h_dots},{show_txt}^FD{val}^FS")
                        else:
                            zpl_lines.append(f"^FO{clamped_x},{clamped_y}^BY{module_w},3,{bar_h_dots}^BC{orient_code},{bar_h_dots},{show_txt},N,N^FD{val}^FS")

                    elif el_type == "qrcode":
                        clamped_x, clamped_y, clamped_w, clamped_h = _clamp_element_bounds(
                            raw_x_dots, raw_y_dots, raw_w_dots, raw_h_dots, min_x, max_x, min_y, max_y
                        )
                        val = _resolve_value(el, curr_rec)
                        max_qr_dim = min(clamped_w, clamped_h)
                        magnification = max(1, min(10, int(round(max_qr_dim / 30.0))))
                        zpl_lines.append(f"^FO{clamped_x},{clamped_y}^BQ{orient_code},2,{magnification}^FDQA,{val}^FS")

                    elif el_type in ("shape", "line"):
                        clamped_x, clamped_y, clamped_w, clamped_h = _clamp_element_bounds(
                            raw_x_dots, raw_y_dots, raw_w_dots, raw_h_dots, min_x, max_x, min_y, max_y
                        )
                        shape = el.get("shapeType", "line" if el_type == "line" else "rect")
                        stroke_w = max(1, min(clamped_w, clamped_h, int(round(float(el.get("strokeWidth", 1)) * dots_per_mm))))
                        fill = el.get("fillColor", "transparent")

                        if el_type == "line" or shape == "line":
                            if clamped_h > clamped_w:
                                line_x = clamped_x + clamped_w // 2
                                line_x = max(min_x, min(line_x, max_x - stroke_w))
                                zpl_lines.append(f"^FO{line_x},{clamped_y}^GB{stroke_w},{clamped_h},{stroke_w}^FS")
                            else:
                                line_y = clamped_y + clamped_h // 2
                                line_y = max(min_y, min(line_y, max_y - stroke_w))
                                zpl_lines.append(f"^FO{clamped_x},{line_y}^GB{clamped_w},{stroke_w},{stroke_w}^FS")
                        elif shape == "rect":
                            if fill and fill not in ("transparent", "none", ""):
                                zpl_lines.append(f"^FO{clamped_x},{clamped_y}^GB{clamped_w},{clamped_h},{min(clamped_w, clamped_h)}^FS")
                            else:
                                zpl_lines.append(f"^FO{clamped_x},{clamped_y}^GB{clamped_w},{clamped_h},{stroke_w}^FS")
                        elif shape == "ellipse":
                            zpl_lines.append(f"^FO{clamped_x},{clamped_y}^GE{clamped_w},{clamped_h},{stroke_w}^FS")

                    elif el_type == "image":
                        clamped_x, clamped_y, clamped_w, clamped_h = _clamp_element_bounds(
                            raw_x_dots, raw_y_dots, raw_w_dots, raw_h_dots, min_x, max_x, min_y, max_y
                        )
                        if el.get("text") and str(el.get("text")).startswith("data:"):
                            try:
                                import base64, io
                                raw_b64 = str(el.get("text")).split(",", 1)[-1]
                                img_data = base64.b64decode(raw_b64)
                                pil_img = Image.open(io.BytesIO(img_data)).resize((clamped_w, clamped_h))
                                zpl_lines.append(_image_to_zpl_gf(pil_img, clamped_x, clamped_y))
                            except Exception as img_ex:
                                logger.warning(f"[ZPL] Image element raster conversion failed: {img_ex}")

            # Emit ZPL Print Quantity command: ^PQ{num_copies} for exact quantity
            zpl_lines.append(f"^PQ{num_copies}")
            zpl_lines.append("^XZ")

        full_zpl = "\n".join(zpl_lines).encode("ascii", errors="replace")

        ok = _deliver_zpl(printer_name, full_zpl)
        return {
            "success": ok,
            "count": len(raw_records) * num_copies if ok else 0,
            "total": len(raw_records) * num_copies,
            "driver": self.driver_name,
            "dpi": dpi,
            "message": "Sent via native raw ZPL driver" if ok else "ZPL delivery failed"
        }
