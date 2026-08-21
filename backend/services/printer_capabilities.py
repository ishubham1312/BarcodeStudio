"""
printer_capabilities.py — Printer capability detection layer.

Queries a Windows printer (via the win32 API) for every property required to
build a high-fidelity, high-resolution print pipeline:

  * Supported print resolutions (DPI / dots-per-inch)
  * Maximum supported resolution
  * Colour vs. monochrome capability
  * Physical / printable area (after hardware margins)
  * Paper size
  * Native label size (when detectable)
  * Hardware (unprintable) margins

On non-Windows platforms (or when pywin32 is unavailable) it returns a
sensible mock so the rest of the pipeline keeps working.
"""
import sys
from typing import Any, Dict, List, Optional

from services.logging_service import get_logger

logger = get_logger()

# Candidate resolutions we probe the driver for. The driver is free to clamp
# these to the nearest value it actually supports, which is exactly what we
# want to discover.
_CANDIDATE_DPI: List[int] = [150, 200, 300, 400, 600, 1200, 2400, 4800]

# Quality hint constants accepted by the rest of the pipeline.
QUALITY_AUTO = "auto"
QUALITY_HIGHEST = "highest"
QUALITY_HIGHSPEED = "highspeed"

_THERMAL_KEYWORDS = (
    "zebra", "tsc", "tspl", "zpl", "epl", "kores", "endura", "2801",
    "honeywell", "godex", "citizen", "argox", "thermal", "label",
    "datamax", "intermec", "sato", "postek", "xprinter", "xp-",
    "gprinter", "gp-", "hprt", "bpost", "uniprt", "brother", "ql",
    "td", "pt-", "p-touch",
)


def is_thermal_name(printer_name: str) -> bool:
    """Heuristic: does the printer name look like a thermal/label printer."""
    if not printer_name:
        return False
    low = printer_name.lower()
    return any(k in low for k in _THERMAL_KEYWORDS)


def _win32_available() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import win32print  # noqa: F401
        import win32ui  # noqa: F401
        import win32con  # noqa: F401
        return True
    except ImportError:
        return False


def _detect_windows(printer_name: str) -> Dict[str, Any]:
    """Real capability detection using the Windows GDI / spooler API."""
    import win32print
    import win32ui
    import win32con

    hprinter = None
    hdc = None
    try:
        hprinter = win32print.OpenPrinter(printer_name)
        # Level-2 printer info carries the current/default DEVMODE.
        printer_info = win32print.GetPrinter(hprinter, 2)
        devmode = printer_info.get("pDevMode")

        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(printer_name)

        dpi_x = hdc.GetDeviceCaps(win32con.LOGPIXELSX) or 300
        dpi_y = hdc.GetDeviceCaps(win32con.LOGPIXELSY) or dpi_x

        is_thermal = is_thermal_name(printer_name)
        if is_thermal:
            upper_name = printer_name.upper()
            has_300_or_600 = any(k in upper_name for k in ("300", "TE300", "TE310", "600"))
            hardware_dpi = 300 if has_300_or_600 else 203
            dpi_x = hardware_dpi
            supported = [hardware_dpi]
            max_dpi = hardware_dpi
            min_dpi = hardware_dpi
        else:
            # ── Resolution probing ────────────────────────────────────────────────
            supported = []
            current_yres = None
            if devmode is not None:
                try:
                    current_yres = getattr(devmode, "YResolution", None)
                except Exception:
                    current_yres = None

                # Map standard quality hints to concrete resolutions where possible.
                quality_constants = {
                    win32con.DMRES_DRAFT if hasattr(win32con, "DMRES_DRAFT") else -2,
                    win32con.DMRES_LOW if hasattr(win32con, "DMRES_LOW") else -3,
                    win32con.DMRES_MEDIUM if hasattr(win32con, "DMRES_MEDIUM") else -4,
                    win32con.DMRES_HIGH if hasattr(win32con, "DMRES_HIGH") else -5,
                }

                def _effective_dpi(candidate: int) -> Optional[int]:
                    try:
                        in_dm = devmode
                        in_dm.Fields |= (
                            win32con.DM_YRESOLUTION | win32con.DM_PRINTQUALITY
                        )
                        in_dm.PrintQuality = candidate
                        in_dm.YResolution = candidate
                        out_dm = win32print.DocumentProperties(
                            0,
                            hprinter,
                            printer_name,
                            None,
                            in_dm,
                            win32con.DM_IN_BUFFER | win32con.DM_OUT_BUFFER,
                        )
                        yres = getattr(out_dm, "YResolution", None)
                        if isinstance(yres, int) and yres > 0:
                            return yres
                    except Exception as ex:
                        logger.debug(
                            f"[Caps] DPI probe {candidate} failed: {ex}"
                        )
                    return None

                seen = set()
                # Seed with the current resolution.
                if isinstance(current_yres, int) and current_yres > 0:
                    supported.append(current_yres)
                    seen.add(current_yres)

                for cand in _CANDIDATE_DPI + list(quality_constants):
                    eff = _effective_dpi(cand)
                    if eff is not None and eff not in seen:
                        seen.add(eff)
                        supported.append(eff)

            # Always guarantee at least a usable value.
            if not supported:
                supported = [max(1, int(dpi_x))]
            supported.sort()

            max_dpi = max(supported)
            min_dpi = min(supported)

        # ── Colour / monochrome detection ──────────────────────────────────────
        bpp = hdc.GetDeviceCaps(win32con.BITSPIXEL)
        num_colors = hdc.GetDeviceCaps(win32con.NUMCOLORS)
        is_mono = (bpp is not None and bpp <= 1) or (
            isinstance(num_colors, int) and 0 < num_colors <= 256
        )
        is_color = not is_mono

        # ── Physical page geometry (device dots at the current DPI) ───────────
        pw = hdc.GetDeviceCaps(win32con.PHYSICALWIDTH)
        ph = hdc.GetDeviceCaps(win32con.PHYSICALHEIGHT)
        ox = hdc.GetDeviceCaps(win32con.PHYSICALOFFSETX)
        oy = hdc.GetDeviceCaps(win32con.PHYSICALOFFSETY)

        ref_dpi = max(1, int(dpi_x))
        mm_per_dot = 25.4 / ref_dpi

        paper_w_mm = round(pw * mm_per_dot, 2) if pw else 0
        paper_h_mm = round(ph * mm_per_dot, 2) if ph else 0
        printable_w_mm = round((pw - ox) * mm_per_dot, 2) if pw and ox else paper_w_mm
        printable_h_mm = round((ph - oy) * mm_per_dot, 2) if ph and oy else paper_h_mm
        margin_left_mm = round(ox * mm_per_dot, 2) if ox else 0
        margin_top_mm = round(oy * mm_per_dot, 2) if oy else 0

        # Try to read the configured paper size from the DEVMODE.
        paper_width_mm = paper_w_mm
        paper_height_mm = paper_h_mm
        if devmode is not None:
            try:
                dm_pw = getattr(devmode, "DMPaperWidth", None)
                dm_pl = getattr(devmode, "DMPaperLength", None)
                if isinstance(dm_pw, int) and dm_pw > 0:
                    # DMPaperWidth is in 1/10 mm.
                    paper_width_mm = round(dm_pw / 10.0, 2)
                if isinstance(dm_pl, int) and dm_pl > 0:
                    paper_height_mm = round(dm_pl / 10.0, 2)
            except Exception:
                pass

        return {
            "success": True,
            "name": printer_name,
            "supportedDpi": supported,
            "maxDpi": max_dpi,
            "minDpi": min_dpi,
            "defaultDpi": int(dpi_x),
            "color": bool(is_color),
            "monochrome": bool(is_mono),
            "isThermal": is_thermal_name(printer_name),
            "paperSizeMm": {
                "width": paper_width_mm,
                "height": paper_height_mm,
            },
            "printableAreaMm": {
                "width": printable_w_mm,
                "height": printable_h_mm,
            },
            "hardwareMarginsMm": {
                "left": margin_left_mm,
                "top": margin_top_mm,
            },
            "source": "windows-gdi",
        }
    except Exception as ex:
        logger.error(
            f"[Caps] Windows capability detection failed for '{printer_name}': {ex}",
            exc_info=True,
        )
        return {
            "success": False,
            "name": printer_name,
            "supportedDpi": [300],
            "maxDpi": 300,
            "minDpi": 300,
            "defaultDpi": 300,
            "color": True,
            "monochrome": False,
            "isThermal": is_thermal_name(printer_name),
            "paperSizeMm": {"width": 0, "height": 0},
            "printableAreaMm": {"width": 0, "height": 0},
            "hardwareMarginsMm": {"left": 0, "top": 0},
            "source": "windows-fallback",
            "message": str(ex),
        }
    finally:
        try:
            if hdc is not None:
                del hdc
        except Exception:
            pass
        try:
            if hprinter is not None:
                win32print.ClosePrinter(hprinter)
        except Exception:
            pass


def _detect_mock(printer_name: str) -> Dict[str, Any]:
    """Fallback used on non-Windows hosts or when pywin32 is missing."""
    thermal = is_thermal_name(printer_name)
    if thermal:
        supported = [203, 300]
    else:
        supported = [300, 600, 1200]
    return {
        "success": True,
        "name": printer_name,
        "supportedDpi": supported,
        "maxDpi": max(supported),
        "minDpi": min(supported),
        "defaultDpi": 300,
        "color": not thermal,
        "monochrome": thermal,
        "isThermal": thermal,
        "paperSizeMm": {"width": 0, "height": 0},
        "printableAreaMm": {"width": 0, "height": 0},
        "hardwareMarginsMm": {"left": 0, "top": 0},
        "source": "mock",
    }


def detect_printer_capabilities(printer_name: str) -> Dict[str, Any]:
    """
    Return the full capability profile for a printer.

    Always returns a well-formed dict (never raises). When the printer is not
    found by the spooler we still return a usable default so callers can keep
    going.
    """
    if not printer_name:
        return _detect_mock("")

    if _win32_available():
        try:
            return _detect_windows(printer_name)
        except Exception as ex:  # pragma: no cover - defensive
            logger.error(f"[Caps] Unexpected detection error: {ex}")
            return _detect_mock(printer_name)

    return _detect_mock(printer_name)


def resolve_quality_dpi(
    caps: Dict[str, Any],
    quality: str = QUALITY_AUTO,
    dpi_override: Optional[int] = None,
) -> int:
    """
    Pick the concrete DPI to render at, given the detected capabilities and the
    requested quality mode.

      * dpi_override  -> used verbatim (clamped to a supported value)
      * highest       -> the printer's maximum supported DPI
      * highspeed     -> the printer's minimum supported DPI
      * auto          -> the printer's maximum supported DPI (favour fidelity)
    """
    supported = caps.get("supportedDpi") or []
    max_dpi = caps.get("maxDpi") or (max(supported) if supported else 300)
    min_dpi = caps.get("minDpi") or (min(supported) if supported else max_dpi)

    if dpi_override:
        try:
            ov = int(dpi_override)
            if ov > 0:
                if supported:
                    # Clamp to nearest supported value (prefer not exceeding it).
                    if ov in supported:
                        return ov
                    lower = [d for d in supported if d <= ov]
                    higher = [d for d in supported if d > ov]
                    if lower:
                        return max(lower)
                    return min(supported)
                return ov
        except (TypeError, ValueError):
            pass

    quality = (quality or QUALITY_AUTO).lower()
    if quality == QUALITY_HIGHSPEED:
        return int(min_dpi)
    # AUTO and HIGHEST both favour maximum fidelity.
    return int(max_dpi)
