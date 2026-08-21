"""
gdi_driver.py — Windows GDI rasterized printer driver.

Printing pipeline (bitmap-only, no printer fonts or DrawString):
  1. Detect the printer's native DPI (prefer 600, otherwise highest supported).
  2. Render the complete label into a PIL RGB bitmap at that DPI via
     render_label_image() — all text (Unicode/Indic), barcodes, QR codes,
     shapes and images are composited in Python before anything is sent to
     the printer.
  3. Convert the PIL image to a GDI DIB and draw it onto the printer DC
     using a destination rect sized in printer dots so the bitmap maps 1:1
     to the physical paper (no scaling, no fitting, no automatic margins).
  4. Subtract PHYSICALOFFSET from every draw position so (0,0) = physical
     paper edge, matching the design canvas exactly.
"""
from PIL import ImageColor
from PIL import Image
import sys
import math
from typing import Any, Dict, List, Optional
import ctypes
from ctypes import wintypes

from drivers.base_driver import PrinterDriverInterface
from services.logging_service import get_logger

logger = get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# Optional win32 imports (Windows only)
# ─────────────────────────────────────────────────────────────────────────────

_WIN32_AVAILABLE = False
if sys.platform == "win32":
    try:
        import win32print
        import win32ui
        import win32con
        from PIL import ImageWin
        _WIN32_AVAILABLE = True
    except ImportError:
        pass

try:
    import win32print  # type: ignore
    import win32ui  # type: ignore
    import win32con  # type: ignore
    from PIL import ImageWin  # type: ignore
except ImportError:
    pass

# GDI+ Ctypes wrappers for Windows only
class GdiplusStartupInput(ctypes.Structure):
    _fields_ = [
        ("GdiplusVersion", ctypes.c_uint32),
        ("DebugEventCallback", ctypes.c_void_p),
        ("SuppressBackgroundThread", ctypes.c_bool),
        ("SuppressExternalCodecs", ctypes.c_bool)
    ]

_GDIPLUS_AVAILABLE = False
if sys.platform == "win32":
    try:
        gdiplus = ctypes.windll.gdiplus
        
        gdiplus.GdiplusStartup.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(GdiplusStartupInput),
            ctypes.c_void_p
        ]
        gdiplus.GdiplusStartup.restype = ctypes.c_int

        gdiplus.GdiplusShutdown.argtypes = [
            ctypes.c_void_p
        ]
        gdiplus.GdiplusShutdown.restype = None

        gdiplus.GdipCreateFromHDC.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p)
        ]
        gdiplus.GdipCreateFromHDC.restype = ctypes.c_int

        gdiplus.GdipDeleteGraphics.argtypes = [
            ctypes.c_void_p
        ]
        gdiplus.GdipDeleteGraphics.restype = ctypes.c_int

        gdiplus.GdipSetSmoothingMode.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int
        ]
        gdiplus.GdipSetSmoothingMode.restype = ctypes.c_int

        gdiplus.GdipSetInterpolationMode.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int
        ]
        gdiplus.GdipSetInterpolationMode.restype = ctypes.c_int

        gdiplus.GdipSetTextRenderingHint.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int
        ]
        gdiplus.GdipSetTextRenderingHint.restype = ctypes.c_int

        gdiplus.GdipSetPixelOffsetMode.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int
        ]
        gdiplus.GdipSetPixelOffsetMode.restype = ctypes.c_int

        gdiplus.GdipCreateBitmapFromScan0.argtypes = [
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p)
        ]
        gdiplus.GdipCreateBitmapFromScan0.restype = ctypes.c_int

        gdiplus.GdipDisposeImage.argtypes = [
            ctypes.c_void_p
        ]
        gdiplus.GdipDisposeImage.restype = ctypes.c_int

        gdiplus.GdipDrawImageRectI.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int
        ]
        gdiplus.GdipDrawImageRectI.restype = ctypes.c_int

        _GDIPLUS_AVAILABLE = True
    except Exception as ex:
        logger.warning(f"[GDI] Failed to load GDI+ DLL or bind functions: {ex}")

# Preferred render DPI — high enough for crisp text and barcodes on any printer.
_PREFERRED_RENDER_DPI = 600


def calculate_layout_positions(template: Dict[str, Any], count: int) -> List[Dict[str, Any]]:
    """
    Python implementation of LayoutEngine.calculateLayout to position labels on pages.
    """
    media_type = template.get("mediaType", "sheet")
    width_mm = float(template.get("widthMm", 50))
    height_mm = float(template.get("heightMm", 30))
    columns = max(1, int(template.get("columns") or 1))
    rows = max(1, int(template.get("rows") or 1))
    gap_horizontal = float(template.get("gapHorizontal", 0))
    gap_vertical = float(template.get("gapVertical", 0))
    margin_left = float(template.get("marginLeft", 0))
    margin_right = float(template.get("marginRight", 0))
    margin_top = float(template.get("marginTop", 0))
    margin_bottom = float(template.get("marginBottom", 0))
    
    orientation = template.get("orientation", "portrait")
    is_landscape = orientation in ("landscape", "landscape-180")
    sticker_w = height_mm if is_landscape else width_mm
    sticker_h = width_mm if is_landscape else height_mm

    # Page size
    page_w = float(template.get("pageWidthMm") or 0)
    if page_w <= 0:
        page_w = margin_left + columns * sticker_w + (columns - 1) * gap_horizontal + margin_right
        
    page_h = float(template.get("pageHeightMm") or 0)
    if page_h <= 0:
        if media_type == "continuous":
            page_h = margin_top + sticker_h + margin_bottom
        else:
            page_h = margin_top + rows * sticker_h + (rows - 1) * gap_vertical + margin_bottom

    # Now calculate labels per page
    if media_type == "continuous" or media_type == "pre-cut":
        labels_per_page = columns
        total_pages = math.ceil(count / labels_per_page)

        pages = []
        for p in range(total_pages):
            labels = []
            start_idx = p * labels_per_page
            end_idx = min(count, start_idx + labels_per_page)
            for i in range(start_idx, end_idx):
                col = i % columns
                x = margin_left + col * (sticker_w + gap_horizontal)
                y = margin_top
                labels.append({
                    "index": i,
                    "x": x,
                    "y": y,
                    "width": sticker_w,
                    "height": sticker_h
                })
            pages.append({
                "page_width": page_w,
                "page_height": page_h,
                "labels": labels
            })
        return pages
        
    else: # sheet
        labels_per_page = columns * rows
        total_pages = math.ceil(count / labels_per_page)
        
        pages = []
        for p in range(total_pages):
            labels = []
            start_idx = p * labels_per_page
            end_idx = min(count, start_idx + labels_per_page)
            for i in range(start_idx, end_idx):
                local_idx = i - start_idx
                row = local_idx // columns
                col = local_idx % columns
                x = margin_left + col * (sticker_w + gap_horizontal)
                y = margin_top + row * (sticker_h + gap_vertical)
                labels.append({
                    "index": i,
                    "x": x,
                    "y": y,
                    "width": sticker_w,
                    "height": sticker_h
                })
            pages.append({
                "page_width": page_w,
                "page_height": page_h,
                "labels": labels
            })
        return pages


class GDIDriver(PrinterDriverInterface):
    """
    Windows GDI bitmap-only printer driver.

    Pipeline:
      1. Render the complete label into a PIL RGB bitmap at render_dpi
         (prefer 600 DPI, otherwise the printer's highest supported DPI).
         render_label_image() composites ALL elements — text (Unicode/Indic),
         barcodes, QR codes, shapes, images — entirely in Python/PIL.
         No printer fonts, no GDI DrawString, no GDI text commands are used.
      2. Size the GDI destination rect from the label's physical mm dimensions
         converted to printer-DC dots, so the bitmap is scaled from render_dpi
         to dc_dpi and maps 1:1 to the correct physical size on paper.
      3. Subtract PHYSICALOFFSET from every draw position so (0,0) equals the
         physical paper edge — no hidden driver margins.
    """

    driver_name = "Windows GDI"

    @classmethod
    def is_supported(cls, printer_name: str) -> bool:
        return True

    def _build_devmode(self, hprinter, target_dpi: int, force_mono: bool):
        """DEVMODE at 100% scale, exact DPI, no driver auto-scaling."""
        try:
            printer_info = win32print.GetPrinter(hprinter, 2)
            devmode = printer_info.get("pDevMode")
            if devmode is None:
                return None
            devmode.Fields |= (
                win32con.DM_PRINTQUALITY
                | win32con.DM_YRESOLUTION
                | win32con.DM_SCALE
                | win32con.DM_COLOR
            )
            devmode.PrintQuality = int(target_dpi)
            devmode.YResolution  = int(target_dpi)
            devmode.Scale        = 100
            devmode.Color = (
                win32con.DMCOLOR_MONOCHROME if force_mono
                else win32con.DMCOLOR_COLOR
            )
            return devmode
        except Exception as ex:
            logger.warning(f"[GDI] DEVMODE build failed: {ex}")
            return None

    def print_batch(
        self,
        printer_name: str,
        records: List[Dict[str, Any]],
        copies: int,
        template: Dict[str, Any],
        quality: str = "auto",
        dpi_override: Optional[int] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        from services.printer_service import render_label_image
        from services.printer_capabilities import (
            detect_printer_capabilities,
            resolve_quality_dpi,
            is_thermal_name,
        )

        # Flatten records
        is_queue = (
            len(records) > 0
            and isinstance(records[0], dict)
            and "template" in records[0]
            and "record" in records[0]
        )
        flat_records = records if is_queue else [
            {"template": template, "record": rec}
            for rec in records for _ in range(copies)
        ]
        total_jobs = len(flat_records)
        logger.info(f"[GDI] Printing {total_jobs} labels to '{printer_name}'")

        PHYSICALOFFSETX = getattr(win32con, "PHYSICALOFFSETX", 112) if _WIN32_AVAILABLE else 112
        PHYSICALOFFSETY = getattr(win32con, "PHYSICALOFFSETY", 113) if _WIN32_AVAILABLE else 113

        caps       = detect_printer_capabilities(printer_name)
        force_mono = (caps.get("monochrome") is True) or is_thermal_name(printer_name)

        # Extract calibration parameters
        calibration = kwargs.get("calibration") or {}
        offset_x_mm = float(calibration.get("offsetX") or 0.0)
        offset_y_mm = float(calibration.get("offsetY") or 0.0)
        scale_x = float(calibration.get("scaleX") or 1.0)
        scale_y = float(calibration.get("scaleY") or 1.0)
        calib_rot = int(calibration.get("rotation") or 0)

        # Determine native DPI: prefer 600, otherwise detect highest supported automatically
        dpi_guess = 600
        if dpi_override:
            dpi_guess = dpi_override
        else:
            supported_dpis = caps.get("supportedDpi") or []
            if 600 in supported_dpis:
                dpi_guess = 600
            elif supported_dpis:
                dpi_guess = max(supported_dpis)

        hdc      = None
        hprinter = None
        dc_dpi   = dpi_guess

        if _WIN32_AVAILABLE:
            try:
                hprinter = win32print.OpenPrinter(printer_name)
                devmode  = self._build_devmode(hprinter, dpi_guess, force_mono)

                try:
                    if devmode is not None:
                        # Use win32print.CreateDC to successfully pass DEVMODE structure
                        hdc_handle = win32print.CreateDC(None, printer_name, devmode)
                        hdc = win32ui.CreateDCFromHandle(hdc_handle)
                    else:
                        hdc = win32ui.CreateDC()
                        hdc.CreatePrinterDC(printer_name)
                except Exception as ex:
                    logger.warning(f"[GDI] DC with DEVMODE failed ({ex}); retrying default.")
                    hdc = win32ui.CreateDC()
                    hdc.CreatePrinterDC(printer_name)

                dc_dpi = hdc.GetDeviceCaps(win32con.LOGPIXELSX) or dpi_guess
                if dc_dpi <= 96 and any(k.upper() in (printer_name or "").upper() for k in ("TSPL", "TSC", "ZEBRA", "GODEX", "XPRINTER", "HONEYWELL", "CITIZEN", "ARGOX", "ENDURA", "2801", "KORES", "TE200", "TE244", "TE300")):
                    dc_dpi = 203
                    logger.info(f"[GDI] Thermal printer detected with generic GDI 96 DPI -> overriding to native {dc_dpi} DPI for '{printer_name}'")
                else:
                    logger.info(f"[GDI] Printer DC reports {dc_dpi} DPI")
            except Exception as e:
                logger.error(f"[GDI] DC init failed: {e}")
                return {"success": False, "message": f"Device Context Error: {e}"}
        else:
            dc_dpi = dpi_guess

        # Set render resolution exactly to the native DC DPI to achieve pixel-perfect 1:1 output
        render_dpi = dc_dpi
        logger.info(f"[GDI] render_dpi={render_dpi} (force_mono={force_mono})")

        first_template = flat_records[0]["template"] if flat_records else template
        layout_pages   = calculate_layout_positions(first_template, len(flat_records))

        if _WIN32_AVAILABLE and hdc:
            gdiplus_token = ctypes.c_void_p()
            gdiplus_started = False
            if _GDIPLUS_AVAILABLE:
                try:
                    startup_input = GdiplusStartupInput(1, None, False, False)
                    status = gdiplus.GdiplusStartup(ctypes.byref(gdiplus_token), ctypes.byref(startup_input), None)
                    if status == 0:
                        gdiplus_started = True
                        logger.info("[GDI+] GdiplusStartup success")
                    else:
                        logger.warning(f"[GDI+] GdiplusStartup failed with status: {status}")
                except Exception as startup_ex:
                    logger.warning(f"[GDI+] GdiplusStartup exception: {startup_ex}")

            try:
                hw_off_x = hdc.GetDeviceCaps(PHYSICALOFFSETX)
                hw_off_y = hdc.GetDeviceCaps(PHYSICALOFFSETY)
                logger.info(f"[GDI] HW unprintable margin: ({hw_off_x}, {hw_off_y}) DC-dots")

                # Dots-per-mm in the printer DC coordinate space.
                dc_dots_per_mm = dc_dpi / 25.4

                hdc.StartDoc("Barcode Studio Label Print")

                for page in layout_pages:
                    hdc.StartPage()
                    for lbl in page["labels"]:
                        idx = lbl["index"]
                        if idx >= len(flat_records):
                            continue

                        item        = flat_records[idx]
                        curr_tmpl   = item["template"]
                        curr_record = item["record"]

                        # Render the complete label into a high-res PIL bitmap.
                        # Barcodes and QR codes are generated at target printer DPI (render_dpi) 
                        # to maintain sharp edges and reliable scanning.
                        img = render_label_image(curr_tmpl, curr_record, render_dpi)
                        
                        # Apply printer calibration rotation prior to driver spooling
                        if calib_rot != 0:
                            # rotate angle is negative to rotate clockwise in PIL
                            img = img.rotate(-calib_rot, expand=True, resample=Image.Resampling.BICUBIC)

                        # Convert monochrome thermal print jobs to a crisp 1-bit bitmap using balanced threshold
                        if force_mono:
                            img_gray = img.convert("L")
                            img_mono = img_gray.point(lambda p: 255 if p > 128 else 0)
                            img = img_mono.convert("RGB")
                        elif img.mode != "RGB":
                            img = img.convert("RGB")

                        # Apply calibration offsets (in mm converted to dots)
                        offset_x_dots = int(round(offset_x_mm * dc_dots_per_mm))
                        offset_y_dots = int(round(offset_y_mm * dc_dots_per_mm))

                        x_dc = int(round(lbl["x"] * dc_dots_per_mm - hw_off_x)) + offset_x_dots
                        y_dc = int(round(lbl["y"] * dc_dots_per_mm - hw_off_y)) + offset_y_dots

                        # Apply calibration scaling. Swap width and height if rotated 90 or 270 degrees.
                        label_w_mm = lbl["width"]
                        label_h_mm = lbl["height"]
                        if calib_rot in (90, 270):
                            label_w_mm, label_h_mm = label_h_mm, label_w_mm

                        w_dc = int(round(label_w_mm * dc_dots_per_mm * scale_x))
                        h_dc = int(round(label_h_mm * dc_dots_per_mm * scale_y))

                        logger.debug(
                            f"[GDI] Label {idx}: canvas=({lbl['x']:.2f},{lbl['y']:.2f})mm "
                            f"dc_pos=({x_dc},{y_dc}) dc_size=({w_dc}x{h_dc}) "
                            f"bitmap=({img.width}x{img.height}px @{render_dpi}dpi)"
                        )

                        drawn_with_gdiplus = False
                        if gdiplus_started:
                            try:
                                hdc_handle = hdc.GetHandleOutput()
                                graphics = ctypes.c_void_p()
                                status = gdiplus.GdipCreateFromHDC(hdc_handle, ctypes.byref(graphics))
                                if status == 0:
                                    try:
                                        # Use high-precision rendering tuned for label/thermal output
                                        is_thermal_printer = force_mono or (dc_dpi <= 300 and any(k.upper() in (printer_name or "").upper() for k in ("TSPL", "TSC", "ZEBRA", "GODEX", "XPRINTER", "HONEYWELL", "CITIZEN", "ARGOX", "ENDURA", "2801", "KORES", "TE200", "TE244", "TE300")))
                                        if is_thermal_printer:
                                            gdiplus.GdipSetTextRenderingHint(graphics, 4) # TextRenderingHint.AntiAliasGridFit
                                            gdiplus.GdipSetSmoothingMode(graphics, 2)     # SmoothingMode.HighQuality
                                            gdiplus.GdipSetPixelOffsetMode(graphics, 2)    # PixelOffsetMode.HighQuality
                                            gdiplus.GdipSetInterpolationMode(graphics, 6) # InterpolationMode.HighQualityBilinear (prevents fuzzy gray edges)
                                        else:
                                            gdiplus.GdipSetTextRenderingHint(graphics, 5) # TextRenderingHint.ClearTypeGridFit
                                            gdiplus.GdipSetSmoothingMode(graphics, 2)     # SmoothingMode.HighQuality
                                            gdiplus.GdipSetPixelOffsetMode(graphics, 2)    # PixelOffsetMode.HighQuality
                                            gdiplus.GdipSetInterpolationMode(graphics, 3) # InterpolationMode.HighQualityBicubic

                                        # Convert RGB to RGBA before exporting raw BGRA bytes for GDI+
                                        if img.mode != "RGBA":
                                            img_rgba = img.convert("RGBA")
                                        else:
                                            img_rgba = img

                                        bgra_data = img_rgba.tobytes("raw", "BGRA")
                                        char_array = ctypes.create_string_buffer(bgra_data)

                                        bitmap = ctypes.c_void_p()
                                        stride = img_rgba.width * 4
                                        pixel_format = 0x26200A  # PixelFormat32bppARGB
                                        status = gdiplus.GdipCreateBitmapFromScan0(
                                            img_rgba.width, img_rgba.height, stride, pixel_format,
                                            ctypes.cast(char_array, ctypes.c_void_p),
                                            ctypes.byref(bitmap)
                                        )
                                        if status == 0:
                                            try:
                                                status = gdiplus.GdipDrawImageRectI(
                                                    graphics, bitmap,
                                                    x_dc, y_dc, w_dc, h_dc
                                                )
                                                if status == 0:
                                                    drawn_with_gdiplus = True
                                                else:
                                                    logger.error(f"[GDI+] GdipDrawImageRectI failed: {status}")
                                            finally:
                                                gdiplus.GdipDisposeImage(bitmap)
                                        else:
                                            logger.error(f"[GDI+] GdipCreateBitmapFromScan0 failed: {status}")
                                    finally:
                                        gdiplus.GdipDeleteGraphics(graphics)
                                else:
                                    logger.error(f"[GDI+] GdipCreateFromHDC failed: {status}")
                            except Exception as draw_ex:
                                logger.error(f"[GDI+] GDI+ drawing exception: {draw_ex}", exc_info=True)

                        # Fallback to standard GDI DIB drawing if GDI+ drawing failed or was unavailable
                        if not drawn_with_gdiplus:
                            logger.info("[GDI] Falling back to PIL DIB draw")
                            dib = ImageWin.Dib(img)
                            dib.draw(
                                hdc.GetHandleOutput(),
                                (x_dc, y_dc, x_dc + w_dc, y_dc + h_dc),
                            )
                    hdc.EndPage()

                hdc.EndDoc()
                logger.info(
                    f"[GDI] Spooled {len(layout_pages)} page(s), "
                    f"{total_jobs} label(s) @ render={render_dpi} / dc={dc_dpi} DPI"
                )
                return {
                    "success": True,
                    "count": total_jobs,
                    "driver": self.driver_name,
                    "renderDpi": render_dpi,
                    "dcDpi": dc_dpi,
                    "monochrome": bool(force_mono),
                    "capabilities": caps,
                }

            except Exception as e:
                logger.error(f"[GDI] Spooler error: {e}")
                return {"success": False, "message": f"Spooler Error: {e}"}
            finally:
                if gdiplus_started:
                    try:
                        gdiplus.GdiplusShutdown(gdiplus_token)
                        logger.info("[GDI+] GdiplusShutdown completed")
                    except Exception as shut_ex:
                        logger.warning(f"[GDI+] GdiplusShutdown failed: {shut_ex}")
                try:
                    del hdc
                except Exception:
                    pass
                try:
                    if hprinter is not None:
                        win32print.ClosePrinter(hprinter)
                except Exception:
                    pass
        else:
            logger.info("[GDI] Non-Windows / no win32print: mock print.")
            return {
                "success": True,
                "count": total_jobs,
                "mock": True,
                "driver": self.driver_name,
                "renderDpi": render_dpi,
                "capabilities": caps,
            }
