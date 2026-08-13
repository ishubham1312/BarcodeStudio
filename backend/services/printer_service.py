import io
import os
import sys
import json
import base64
import subprocess
from typing import List, Dict, Any, Optional
from PIL import Image, ImageDraw, ImageFont, ImageOps
from backend.services.logging_service import get_logger
from backend.services.barcode_service import generate_1d_barcode, generate_qr_code

logger = get_logger()

try:
    _RAQM_LAYOUT = getattr(ImageFont.Layout, "RAQM", None)
    _HAVE_RAQM = _RAQM_LAYOUT is not None
except Exception:
    _RAQM_LAYOUT = None
    _HAVE_RAQM = False

# Setup win32print imports
WIN32_PRINT_AVAILABLE = False
if sys.platform == 'win32':
  try:
    import win32print
    import win32ui
    import win32con
    from PIL import ImageWin
    WIN32_PRINT_AVAILABLE = True
    logger.info("win32print is loaded successfully for Windows native printing.")
  except ImportError:
    logger.warning("pywin32 / win32print is not installed. Native printing is mock-only.")

def get_bundled_fonts_dir() -> str:
  if getattr(sys, 'frozen', False):
    # Packaged build: executable is in 'resources/backend'
    base_dir = os.path.dirname(sys.executable)
    return os.path.join(base_dir, 'assets', 'fonts')
  else:
    # Development mode: printer_service.py is in 'backend/services'
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, 'assets', 'fonts')

# Helper to find a font path on Windows
def get_font_path(font_name: str, bold: bool = False, italic: bool = False) -> str:
  font_name_clean = font_name.strip().lower()

  # Check bundled directory first
  bundled_dir = get_bundled_fonts_dir()
  if os.path.exists(bundled_dir):
    is_nirmala = any(k in font_name_clean for k in ['nirmala', 'nirmala-bold', 'mangal', 'hindi', 'marathi', 'tamil', 'telugu', 'bengali', 'gujarati', 'punjabi', 'devanagari', 'indic'])
    is_arial = 'arial' in font_name_clean
    is_segoe = 'segoe' in font_name_clean
    is_msgothic = 'ms gothic' in font_name_clean or 'msgothic' in font_name_clean
    is_msyh = 'microsoft yahei' in font_name_clean or 'msyh' in font_name_clean or 'yahei' in font_name_clean
    is_malgun = 'malgun' in font_name_clean
    is_arialuni = 'arial unicode ms' in font_name_clean or 'arialuni' in font_name_clean or 'unicode' in font_name_clean

    filename = None
    if is_nirmala:
      filename = 'nirmala-bold.ttf' if bold else 'nirmala.ttf'
    elif is_msgothic:
      filename = 'msgothic.ttf'
    elif is_msyh:
      filename = 'msyh.ttf'
    elif is_malgun:
      filename = 'malgunbd.ttf' if bold else 'malgun.ttf'
    elif is_arialuni:
      filename = 'arialuni.ttf'
    elif is_arial:
      if bold and italic:
        filename = 'arialbi.ttf'
      elif bold:
        filename = 'arialbd.ttf'
      elif italic:
        filename = 'ariali.ttf'
      else:
        filename = 'arial.ttf'
    elif is_segoe:
      if bold and italic:
        filename = 'segoeuiz.ttf'
      elif bold:
        filename = 'segoeuib.ttf'
      elif italic:
        filename = 'segoeuii.ttf'
      else:
        filename = 'segoeui.ttf'
    else:
      # Default fallback to Arial Unicode MS locally if available, else Segoe UI
      if os.path.exists(os.path.join(bundled_dir, 'arialuni.ttf')):
        filename = 'arialuni.ttf'
      elif bold and italic:
        filename = 'segoeuiz.ttf'
      elif bold:
        filename = 'segoeuib.ttf'
      elif italic:
        filename = 'segoeuii.ttf'
      else:
        filename = 'segoeui.ttf'

    if filename:
      path = os.path.join(bundled_dir, filename)
      if os.path.exists(path):
        return path

  font_name_clean = font_name.strip()
  windir = os.environ.get('WINDIR', 'C:\\Windows')
  fonts_dir = os.path.join(windir, 'Fonts')
  
  # Try looking in registry first
  try:
    import winreg
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts")
    ]
    
    best_match = None
    best_match_score = 0
    
    for root, subkey in keys:
      try:
        reg_key = winreg.OpenKey(root, subkey)
        num_values = winreg.QueryInfoKey(reg_key)[1]
        
        for i in range(num_values):
          val_name, val_data, _ = winreg.EnumValue(reg_key, i)
          val_name_lower = val_name.lower()
          
          if font_name_clean.lower() in val_name_lower:
            score = 1
            if bold and "bold" in val_name_lower:
              score += 2
            if not bold and "bold" not in val_name_lower:
              score += 1
            if italic and ("italic" in val_name_lower or "oblique" in val_name_lower):
              score += 2
            if not italic and ("italic" not in val_name_lower and "oblique" not in val_name_lower):
              score += 1
              
            if score > best_match_score:
              best_match_score = score
              best_match = val_data
      except Exception:
        pass
                
    if best_match:
      if not os.path.isabs(best_match):
        # Check standard system fonts directory and local AppData fonts directories
        paths = [
            os.path.join(fonts_dir, best_match),
            os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft\\Windows\\Fonts', best_match),
            os.path.join(os.environ.get('USERPROFILE', ''), 'AppData\\Local\\Microsoft\\Windows\\Fonts', best_match)
        ]
        for p in paths:
          if os.path.exists(p):
            return p
      else:
        if os.path.exists(best_match):
          return best_match
  except Exception as reg_ex:
    pass

  font_name_lower = font_name.lower()
  font_map = {
    'courier new': {
      'regular': 'cour.ttf',
      'bold': 'courbd.ttf',
      'italic': 'couri.ttf',
      'bold_italic': 'courbi.ttf'
    },
    'segoe ui': {
      'regular': 'segoeui.ttf',
      'bold': 'segoeuib.ttf',
      'italic': 'segoeuii.ttf',
      'bold_italic': 'segoeuiz.ttf'
    },
    'arial': {
      'regular': 'arial.ttf',
      'bold': 'arialbd.ttf',
      'italic': 'ariali.ttf',
      'bold_italic': 'arialbi.ttf'
    },
    'times new roman': {
      'regular': 'times.ttf',
      'bold': 'timesbd.ttf',
      'italic': 'timesi.ttf',
      'bold_italic': 'timesbi.ttf'
    },
     'nirmala': {
      'regular': 'nirmala.ttf',
      'bold': 'nirmala-bold.ttf',
      'italic': 'nirmala.ttf',
      'bold_italic': 'nirmala-bold.ttf'
    }
  }
  
  mapped = font_map.get(font_name_lower, font_map['segoe ui'])
  
  if bold and italic:
    filename = mapped.get('bold_italic', mapped['regular'])
  elif bold:
    filename = mapped.get('bold', mapped['regular'])
  elif italic:
    filename = mapped.get('italic', mapped['regular'])
  else:
    filename = mapped['regular']
    
  font_path = os.path.join(fonts_dir, filename)
  if os.path.exists(font_path):
    return font_path
    
  fallback_paths = [
    os.path.join(fonts_dir, 'arial.ttf'),
    os.path.join(fonts_dir, 'segoeui.ttf')
  ]
  for path in fallback_paths:
    if os.path.exists(path):
      return path
      
  return 'arial.ttf'


# ─────────────────────────────────────────────────────────────────────────────
# Complex-script (Indic / CJK / Arabic / Thai) font selection
# ─────────────────────────────────────────────────────────────────────────────

_FONT_CMAP_CACHE: Dict[str, Optional[Dict[int, str]]] = {}


def _get_font_cmap(font_path: str) -> Optional[Dict[int, str]]:
    if font_path in _FONT_CMAP_CACHE:
        return _FONT_CMAP_CACHE[font_path]
    cmap: Optional[Dict[int, str]] = None
    try:
        from fontTools.ttLib import TTFont
        if font_path.lower().endswith(".ttc"):
            for idx in range(0, 12):
                try:
                    f = TTFont(font_path, fontNumber=idx)
                except Exception:
                    break
                cm = f.getBestCmap()
                f.close()
                if cm:
                    cmap = cm
                    break
        else:
            f = TTFont(font_path)
            cmap = f.getBestCmap()
            f.close()
    except Exception:
        cmap = None
    _FONT_CMAP_CACHE[font_path] = cmap
    return cmap


def _font_covers_text(font_path: str, text: str) -> bool:
    if not text:
        return True
    cmap = _get_font_cmap(font_path)
    if cmap is None:
        return False
    for ch in text:
        cp = ord(ch)
        if cp in (0x200C, 0x200D):
            continue
        if cp not in cmap:
            return False
    return True


def _detect_script_kind(text: str) -> str:
    if not text:
        return "latin"
    for ch in text:
        cp = ord(ch)
        if 0x0900 <= cp <= 0x0D7F:
            return "indic"
        if 0xAC00 <= cp <= 0xD7AF:
            return "korean"
        if (0x3040 <= cp <= 0x30FF) or (0x1100 <= cp <= 0x11FF) or (0x31F0 <= cp <= 0x31FF):
            return "japanese"
        if 0x4E00 <= cp <= 0x9FFF:
            return "chinese"
        if 0x0600 <= cp <= 0x06FF or 0x0750 <= cp <= 0x077F or 0x08A0 <= cp <= 0x08FF:
            return "arabic"
        if 0x0E00 <= cp <= 0x0E7F:
            return "thai"
    return "latin"


_SCRIPT_FALLBACK_FAMILIES = {
    "indic":    ["Nirmala", "nirmala-bold", "Mangal", "Kokila", "Utsaah", "Arial Unicode MS", "Lohit Devanagari"],
    "arabic":   ["Arial Unicode MS", "Segoe UI", "Tahoma", "Gisha"],
    "korean":   ["Malgun Gothic", "Arial Unicode MS"],
    "japanese": ["MS Gothic", "Yu Gothic", "Arial Unicode MS"],
    "chinese":  ["Microsoft YaHei", "SimSun", "Arial Unicode MS"],
    "thai":     ["Leelawadee UI", "Tahoma", "Arial Unicode MS"],
    "latin":    ["Arial", "Segoe UI"],
}


def _font_candidates_for_script(script_kind: str, bold: bool, italic: bool, preferred_path: str = "") -> List[str]:
    bundled = get_bundled_fonts_dir()
    candidates: List[str] = []

    if preferred_path and os.path.exists(preferred_path):
        candidates.append(preferred_path)

    for fam in _SCRIPT_FALLBACK_FAMILIES.get(script_kind, ["Arial Unicode MS", "Arial"]):
        if fam.lower() == "arial unicode ms":
            uni = os.path.join(bundled, "arialuni.ttf")
            if os.path.exists(uni):
                candidates.append(uni)
            else:
                p = get_font_path("Arial Unicode MS", bold, italic)
                if p:
                    candidates.append(p)
        else:
            p = get_font_path(fam, bold, italic)
            if p:
                candidates.append(p)

    for extra in ("arialuni.ttf", "arial.ttf", "segoeui.ttf"):
        p = os.path.join(bundled, extra)
        if os.path.exists(p):
            candidates.append(p)

    seen = set()
    out: List[str] = []
    for p in candidates:
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _pick_best_candidate(candidates: List[str], text: str) -> Optional[str]:
    if not candidates:
        return None
    if text:
        for path in candidates:
            if _font_covers_text(path, text):
                return path
    return candidates[0]


def _load_text_font(candidates: List[str], size: int, complex_layout: bool, text: str = "") -> ImageFont.ImageFont:
    size = max(1, int(size))
    last_err: Optional[Exception] = None

    ordered = list(candidates)
    if text:
        best = _pick_best_candidate(candidates, text)
        if best is not None:
            ordered = [best] + [c for c in candidates if c != best]

    for path in ordered:
        try:
            if complex_layout and _HAVE_RAQM:
                return ImageFont.truetype(path, size, layout_engine=_RAQM_LAYOUT)
            return ImageFont.truetype(path, size)
        except Exception as ex:
            last_err = ex
            continue

    try:
        return ImageFont.load_default()
    except Exception:
        if last_err:
            raise last_err
        raise RuntimeError("No usable font found")

def _execute_powershell_command(command: str) -> Optional[str]:
  try:
    completed = subprocess.run(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
      capture_output=True,
      text=True,
      timeout=20,
      check=True
    )
    return completed.stdout.strip()
  except Exception as ex:
    logger.warning(f"PowerShell command failed: {ex}")
    return None


def _map_printer_status(status_code: int) -> str:
  if status_code & getattr(win32con, 'PRINTER_STATUS_OFFLINE', 0x00000080):
    return 'Offline'
  if status_code & getattr(win32con, 'PRINTER_STATUS_ERROR', 0x00000002) or status_code & getattr(win32con, 'PRINTER_STATUS_PAPER_JAM', 0x00000008):
    return 'Error'
  return 'Ready'


def _get_printers_via_powershell() -> List[Dict[str, Any]]:
  printers = []
  ps_command = (
    "Get-Printer | Select-Object Name,DriverName,PortName,ShareName,ComputerName,Default,PrinterStatus | ConvertTo-Json -Compress"
  )
  output = _execute_powershell_command(ps_command)
  if not output:
    return printers

  try:
    parsed = json.loads(output)
  except json.JSONDecodeError as ex:
    logger.warning(f"Failed to parse PowerShell printer output: {ex}")
    return printers

  if isinstance(parsed, dict):
    printer_records = [parsed]
  elif isinstance(parsed, list):
    printer_records = parsed
  else:
    return printers

  for entry in printer_records:
    name = entry.get('Name') or entry.get('name')
    if not name:
      continue

    description = entry.get('DriverName') or entry.get('PortName') or entry.get('ShareName') or entry.get('ComputerName')
    status_code = entry.get('PrinterStatus') if isinstance(entry.get('PrinterStatus'), int) else 0
    status = 'Ready'
    if status_code in (4, 5, 6, 8):
      status = 'Offline' if status_code == 4 else 'Error'
    elif status_code == 7:
      status = 'Busy'

    printers.append({
      'name': name,
      'status': status,
      'type': description or 'Local Windows Printer',
      'dpi': 300,
      'default': bool(entry.get('Default'))
    })
  return printers


def _get_default_printer_via_powershell() -> str:
  output = _execute_powershell_command(
    "(Get-Printer | Where-Object Default -eq $true | Select-Object -First 1 -ExpandProperty Name) -replace '\\r?\\n', ''"
  )
  return output or ""


def get_installed_printers() -> List[Dict[str, Any]]:
  """Enumerate Windows printers or return mock ones for other platforms."""
  printers = []
  default_printer = ""

  if sys.platform == 'win32':
    default_printer = _get_default_printer_via_powershell() if not WIN32_PRINT_AVAILABLE else ''

  if WIN32_PRINT_AVAILABLE:
    try:
      # PRINTER_ENUM_LOCAL = 2, PRINTER_ENUM_CONNECTIONS = 4
      raw_printers = win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS, None, 2)
      default_printer = default_printer or win32print.GetDefaultPrinter()

      for p in raw_printers:
        name = None
        description = None
        status_code = 0

        if isinstance(p, dict):
          name = p.get('pPrinterName') or p.get('Name')
          description = p.get('pDriverName') or p.get('pPortName') or p.get('pComment')
          status_code = p.get('Status', 0)
        elif isinstance(p, (tuple, list)):
          if len(p) >= 3 and p[2]:
            name = p[2]
          elif len(p) >= 1:
            name = p[0]
          if len(p) >= 5 and p[4]:
            description = p[4]
          elif len(p) >= 4:
            description = p[3]
          if len(p) >= 19:
            status_code = p[18]

        if not name:
          continue

        # Attempt to fetch a stable Level 2 printer info record for better field mapping.
        try:
          hprinter = win32print.OpenPrinter(name)
          detailed = win32print.GetPrinter(hprinter, 2)
          if isinstance(detailed, dict):
            name = detailed.get('pPrinterName') or name
            description = detailed.get('pDriverName') or description or detailed.get('pPortName')
            status_code = detailed.get('Status', status_code)
          win32print.ClosePrinter(hprinter)
        except Exception as ex:
          logger.warning(f"Unable to open printer '{name}' for detailed metadata: {ex}")

        status = _map_printer_status(status_code)

        from backend.services.printer_capabilities import is_thermal_name
        is_thermal = is_thermal_name(name)
        default_dpi = 203 if is_thermal and not any(k in name.upper() for k in ("300", "TE300", "600")) else 300

        printers.append({
          "name": name,
          "status": status,
          "type": description or "Local Windows Printer",
          "dpi": default_dpi,
          "isThermal": is_thermal,
          "default": name == default_printer
        })
    except Exception as e:
      logger.error(f"Error enumerating Windows printers: {e}")

  if not printers and sys.platform == 'win32':
    printers = _get_printers_via_powershell()

  if not printers and sys.platform != 'win32':
    printers = [
      {
        "name": "Microsoft Print to PDF",
        "status": "Ready",
        "type": "Virtual Office",
        "dpi": 600,
        "default": True
      }
    ]

  return printers


def get_default_printer_name() -> str:
  if WIN32_PRINT_AVAILABLE:
    try:
      return win32print.GetDefaultPrinter()
    except Exception as e:
      logger.warning(f"Unable to get default printer: {e}")
      return _get_default_printer_via_powershell() if sys.platform == 'win32' else ""

  if sys.platform == 'win32':
    return _get_default_printer_via_powershell()

  return ""

def render_label_image(template: Dict[str, Any], record: Optional[Dict[str, Any]] = None, dpi: int = 300) -> Image.Image:
  """
  Render a single label into a high-resolution PIL RGB image.

  All elements — text (including Unicode/Indic/CJK), barcodes, QR codes,
  shapes and embedded images — are composited entirely in Python/PIL at the
  requested DPI.  The caller receives a single RGB bitmap; no printer fonts
  or GDI drawing commands are involved.

  Coordinate system: widthMm / heightMm are always the portrait canvas size.
  Orientation rotation is applied as a final step after all elements are drawn.
  """
  dpi = max(1, int(dpi))

  width_mm  = float(template.get("widthMm")  or 75)
  height_mm = float(template.get("heightMm") or 38)
  negative    = template.get("negative",     False)
  mirror      = template.get("mirrorImage",  False)
  orientation = template.get("orientation",  "portrait")

  pixels_per_mm = dpi / 25.4
  width_px  = max(1, int(round(width_mm  * pixels_per_mm)))
  height_px = max(1, int(round(height_mm * pixels_per_mm)))

  # Exact 1:1 millimeter bounds matching canvas coordinate space
  min_x_px = 0
  max_x_px = width_px
  min_y_px = 0
  max_y_px = height_px

  bg_color = "black" if negative else "white"
  image = Image.new("RGB", (width_px, height_px), bg_color)
  draw  = ImageDraw.Draw(image)

  elements = sorted(
    template.get("elements", []),
    key=lambda e: e.get("zValue", 0)
  )

  # Track last non-wrapped text element for dynamic inline positioning (matching ZPL driver standard)
  last_text_end_x_px = -1
  last_text_y_mm = -1.0
  last_text_container_end_x_mm = -1.0
  
  for el in elements:
    if not el.get("visible", True):
      continue
      
    el_x = el.get("x", 0)
    el_y = el.get("y", 0)
    el_w = el.get("width", 10)
    el_h = el.get("height", 10)

    # Exact 1:1 dimension conversion from mm to pixels
    raw_x = int(round(el_x * pixels_per_mm))
    raw_y = int(round(el_y * pixels_per_mm))
    raw_w = int(round(el_w * pixels_per_mm))
    raw_h = int(round(el_h * pixels_per_mm))

    x = max(0, min(raw_x, width_px - 1))
    y = max(0, min(raw_y, height_px - 1))
    w = max(1, min(raw_w, width_px - x))
    h = max(1, min(raw_h, height_px - y))
    el_type = el.get("type")
    
    temp_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    temp_draw = ImageDraw.Draw(temp_img)
    
    # 1. Shape drawing
    if el_type == "shape":
      shape_type = el.get("shapeType", "rect")
      fill = el.get("fillColor", "#ffffff")
      stroke = el.get("strokeColor", "#000000")
      stroke_w = int(round(el.get("strokeWidth", 1) * pixels_per_mm))
      
      # Reverse colors if negative
      if negative:
        fill = "black" if fill != "transparent" else "transparent"
        stroke = "white"
        
      fill_color = None if fill == "transparent" else fill
      
      if shape_type == "rect":
        temp_draw.rectangle([0, 0, w, h], fill=fill_color, outline=stroke, width=stroke_w)
      elif shape_type == "ellipse":
        temp_draw.ellipse([0, 0, w, h], fill=fill_color, outline=stroke, width=stroke_w)
      elif shape_type == "line":
        if h > w:
          temp_draw.line([w // 2, 0, w // 2, h], fill=stroke, width=stroke_w)
        else:
          temp_draw.line([0, h // 2, w, h // 2], fill=stroke, width=stroke_w)
        
    # 2. Line Divider element
    elif el_type == "line":
      stroke = el.get("strokeColor", "#000000")
      stroke_w = max(1, int(round(el.get("strokeWidth", 1) * pixels_per_mm)))
      if negative:
        stroke = "white"
      if h > w:
        temp_draw.line([w // 2, 0, w // 2, h], fill=stroke, width=stroke_w)
      else:
        temp_draw.line([0, h // 2, w, h // 2], fill=stroke, width=stroke_w)
        
    # 3. Text drawing
    elif el_type == "text":
      text = el.get("text", "")
      field_name = el.get("fieldName")
      
      # Case-insensitive data binding replacement
      if field_name and record:
        val = None
        field_name_lower = field_name.lower()
        for k, v in record.items():
          if k.lower() == field_name_lower:
            val = v
            break
        # Heuristic fallbacks for accession numbers
        if val is None and field_name_lower in ['accessionno', 'acc_no', 'accno', 'accession']:
          for k, v in record.items():
            if k.lower() in ['accessionno', 'acc_no', 'accno', 'accession']:
              val = v
              break
        if val is not None:
          text = str(val)
        
      # Text adjustments
      prefix = el.get("prefix", "")
      suffix = el.get("suffix", "")
      text = f"{prefix}{text}{suffix}"
      
      font_family = el.get("fontFamily", "Segoe UI")
      
      # Language-smart font family override
      if text:
        has_indic = False
        has_korean = False
        has_japanese = False
        has_chinese = False
        has_arabic = False
        has_other_unicode = False
        
        for char in str(text):
          cp = ord(char)
          if 0x0900 <= cp <= 0x0D7F:
            has_indic = True
          elif 0xAC00 <= cp <= 0xD7AF:
            has_korean = True
          elif (0x3040 <= cp <= 0x30FF) or (0x1100 <= cp <= 0x11FF) or (0x31F0 <= cp <= 0x31FF):
            has_japanese = True
          elif 0x4E00 <= cp <= 0x9FFF:
            has_chinese = True
          elif 0x0600 <= cp <= 0x06FF:
            has_arabic = True
          elif cp > 0x00FF:
            has_other_unicode = True
            
        if has_indic:
          supported_indic = {'nirmala', 'mangal', 'kokila', 'utsaah', 'sanskrit text', 'aparajita', 'arial unicode ms'}
          if font_family.lower() not in supported_indic:
            font_family = "Nirmala"
        elif has_korean:
          font_family = "Malgun Gothic"
        elif has_japanese:
          font_family = "MS Gothic"
        elif has_chinese:
          font_family = "Microsoft YaHei"
        elif has_arabic:
          font_family = "Arial Unicode MS"
        elif has_other_unicode:
          font_family = "Arial Unicode MS"

      font_size_pt = el.get("fontSize", 10)
      fw_val = str(el.get("fontWeight", "")).lower()
      bold = fw_val in ("bold", "700", "800", "900") or el.get("bold") is True or el.get("fontWeight") == 700
      italic = el.get("fontStyle") == "italic"
      text_color = el.get("textColor", "#000000")
      text_align = el.get("textAlign", "left")
      
      if negative:
        text_color = "#ffffff"
        
      # Scale font size from point to pixels
      font_size_px = int(round(font_size_pt * (dpi / 72.0)))

      # Determine the actual script present in the text and build a font
      # candidate chain that can shape it. Non-Latin scripts (Indic, CJK,
      # Arabic, Thai) need the RAQM complex-text-layout engine so conjuncts,
      # matras and combining marks are positioned correctly instead of
      # printing as broken dashes/boxes.
      script_kind = _detect_script_kind(text if text else "")
      preferred_path = get_font_path(font_family, bold, italic)
      font_candidates = _font_candidates_for_script(script_kind, bold, italic, preferred_path)
      complex_layout = script_kind != "latin"

      def _load_font(size_px: int) -> ImageFont.ImageFont:
        return _load_text_font(font_candidates, size_px, complex_layout, text)

      wrap_text = el.get("wrapText", False)
      auto_shrink = el.get("autoShrink", False)
      smart_fit = el.get("smartFit", False)
      auto_expand = el.get("autoExpand", False) or el.get("auto_expand", False)
      
      # Wrap text helper function — handles both space-separated (Latin) and
      # character-level (Indic/CJK/Arabic) scripts
      def wrap_text_pil(txt: str, fnt: ImageFont.ImageFont, max_w: int) -> list:
        def _measure(s):
          if hasattr(fnt, 'getlength'):
            return fnt.getlength(s)
          elif hasattr(fnt, 'getbbox'):
            bb = fnt.getbbox(s)
            return bb[2] - bb[0]
          return len(s) * 8.0

        is_cjk_no_spaces = any(
          (0x4E00 <= ord(c) <= 0x9FFF) or
          (0x3400 <= ord(c) <= 0x4DBF) or
          (0x20000 <= ord(c) <= 0x2A6DF) or
          (0x3040 <= ord(c) <= 0x30FF) or
          (0xAC00 <= ord(c) <= 0xD7AF)
          for c in txt
        )

        if not is_cjk_no_spaces and " " in txt:
          paragraphs = txt.replace("\r\n", "\n").replace("\r", "\n").split("\n")
          lines = []
          for para in paragraphs:
            if not para:
              lines.append("")
              continue
            words = para.split(" ")
            curr_line_words = []
            for word in words:
              test_line = " ".join(curr_line_words + [word]) if curr_line_words else word
              if _measure(test_line) <= max_w:
                curr_line_words.append(word)
              else:
                if curr_line_words:
                  lines.append(" ".join(curr_line_words))
                  curr_line_words = []
                if _measure(word) > max_w:
                  part = ""
                  for ch in word:
                    if _measure(part + ch) <= max_w:
                      part += ch
                    else:
                      if part: lines.append(part)
                      part = ch
                  if part: curr_line_words = [part]
                else:
                  curr_line_words = [word]
            if curr_line_words:
              lines.append(" ".join(curr_line_words))
          return lines if lines else [txt]
        else:
          lines = []
          curr = ""
          for char in txt:
            if char == "\n":
              lines.append(curr)
              curr = ""
              continue
            if _measure(curr + char) <= max_w:
              curr += char
            else:
              if curr:
                lines.append(curr)
              curr = char
          if curr:
            lines.append(curr)
          return lines if lines else [txt]

      is_indic_text = any((0x0900 <= ord(c) <= 0x0D7F) or (0x0600 <= ord(c) <= 0x06FF) for c in (text or ""))
      line_spacing_ratio = 0.35 if is_indic_text else 0.20

      def _get_line_h_px(f, fs):
        if hasattr(f, 'getmetrics'):
          asc, dsc = f.getmetrics()
          h = asc + dsc
          return max(h, int(round(fs * 1.35))) if is_indic_text else max(h, fs)
        elif hasattr(f, 'getbbox'):
          test_s = "अिैौ्ग्यीÅgjyq|" if is_indic_text else "Ågjyq|"
          b = f.getbbox(test_s)
          return max(fs, b[3] - b[1])
        return fs
        
      max_w_bound = max(1, w - 4)

      # 1. Determine font_size_px based on flags (auto_expand, smart_fit, auto_shrink)
      if auto_expand:
        # Auto-scale up to +3pt max boost over base font size
        max_boost_px = int(round(3.0 * (dpi / 72.0)))
        start_size_px = font_size_px + max_boost_px
        min_size_floor_px = int(round(4.0 * (dpi / 72.0))) if auto_shrink else font_size_px

        cand_sz = start_size_px
        while cand_sz >= min_size_floor_px:
          cand_fnt = _load_font(cand_sz)
          cand_lines = wrap_text_pil(text, cand_fnt, max_w_bound) if wrap_text else [text]
          lh_px = _get_line_h_px(cand_fnt, cand_sz)
          lh_mm = lh_px / pixels_per_mm
          tot_h_mm = len(cand_lines) * (lh_mm * (1.0 + line_spacing_ratio)) - (lh_mm * line_spacing_ratio)
          max_w_px = max(cand_fnt.getlength(l) if hasattr(cand_fnt, 'getlength') else (cand_fnt.getbbox(l)[2] - cand_fnt.getbbox(l)[0] if hasattr(cand_fnt, 'getbbox') else len(l) * 8) for l in cand_lines) if cand_lines else 0

          if max_w_px <= max_w_bound and tot_h_mm <= el_h:
            font_size_px = cand_sz
            break
          cand_sz -= 1
        else:
          font_size_px = min_size_floor_px

      elif smart_fit:
        # Moderate boost (+2pt to +4pt) for short text
        base_font = _load_font(font_size_px)
        base_lines = wrap_text_pil(text, base_font, max_w_bound) if wrap_text else [text]
        base_line_count = len(base_lines)
        base_lh_px = _get_line_h_px(base_font, font_size_px)
        base_tot_h_mm = base_line_count * (base_lh_px / pixels_per_mm * (1.0 + line_spacing_ratio)) - (base_lh_px / pixels_per_mm * line_spacing_ratio)
        base_max_w_px = max(base_font.getlength(l) if hasattr(base_font, 'getlength') else (base_font.getbbox(l)[2] - base_font.getbbox(l)[0] if hasattr(base_font, 'getbbox') else len(l) * 8) for l in base_lines) if base_lines else 0

        if base_tot_h_mm <= el_h and base_max_w_px <= max_w_bound:
          boost_px = max(2, int(round(4.0 * (dpi / 72.0))))
          for frac in [1.0, 0.75, 0.5, 0.25]:
            cand_size = font_size_px + max(1, int(round(boost_px * frac)))
            cand_font = _load_font(cand_size)
            cand_lines = wrap_text_pil(text, cand_font, max_w_bound) if wrap_text else [text]
            if wrap_text and len(cand_lines) > base_line_count:
              continue
            cand_lh_px = _get_line_h_px(cand_font, cand_size)
            cand_tot_h_mm = len(cand_lines) * (cand_lh_px / pixels_per_mm * (1.0 + line_spacing_ratio)) - (cand_lh_px / pixels_per_mm * line_spacing_ratio)
            cand_max_w_px = max(cand_font.getlength(l) if hasattr(cand_font, 'getlength') else (cand_font.getbbox(l)[2] - cand_font.getbbox(l)[0] if hasattr(cand_font, 'getbbox') else len(l) * 8) for l in cand_lines) if cand_lines else 0
            if cand_tot_h_mm <= el_h and cand_max_w_px <= max_w_bound:
              font_size_px = cand_size
              break

      elif auto_shrink:
        # Standard auto-shrink down if text overflows
        min_size_px = int(round(4.0 * (dpi / 72.0)))
        while font_size_px > min_size_px:
          font = _load_font(font_size_px)
          lines = wrap_text_pil(text, font, max_w_bound) if wrap_text else [text]
          lh_px = _get_line_h_px(font, font_size_px)
          lh_mm = lh_px / pixels_per_mm
          tot_h_mm = len(lines) * (lh_mm * (1.0 + line_spacing_ratio)) - (lh_mm * line_spacing_ratio)
          max_w_px = max(font.getlength(l) if hasattr(font, 'getlength') else (font.getbbox(l)[2] - font.getbbox(l)[0] if hasattr(font, 'getbbox') else len(l) * 8) for l in lines) if lines else 0

          if tot_h_mm <= el_h and max_w_px <= max_w_bound:
            break
          font_size_px -= 1

      # 2. Render text at final computed font_size_px
      font = _load_font(font_size_px)
      lines_to_draw = wrap_text_pil(text, font, max_w_bound) if wrap_text else [text]
      line_h_px = _get_line_h_px(font, font_size_px)
      line_h_mm = line_h_px / pixels_per_mm
      line_spacing_mm = line_h_mm * line_spacing_ratio
      line_height_total_mm = line_h_mm + line_spacing_mm
      total_text_h_mm = len(lines_to_draw) * line_height_total_mm - line_spacing_mm

      start_y_mm = max(0.0, (el_h - total_text_h_mm) / 2.0)

      for i, line in enumerate(lines_to_draw):
        if hasattr(font, 'getlength'):
          line_w_px = font.getlength(line)
        elif hasattr(font, 'getbbox'):
          b = font.getbbox(line)
          line_w_px = b[2] - b[0]
        else:
          line_w_px = len(line) * 8.0

        line_w_mm = line_w_px / pixels_per_mm

        if text_align == "center":
          draw_cx_mm = el_w / 2.0
        elif text_align == "right":
          draw_cx_mm = el_w - line_w_mm / 2.0
        else:
          draw_cx_mm = line_w_mm / 2.0

        draw_cy_mm = start_y_mm + i * line_height_total_mm + line_h_mm / 2.0

        cx_px = int(round(draw_cx_mm * pixels_per_mm))
        cy_px = int(round(draw_cy_mm * pixels_per_mm))

        if cy_px <= h:
          temp_draw.text((cx_px, cy_px), line, font=font, fill=text_color, anchor="mm")
          if bold:
            temp_draw.text((cx_px + 1, cy_px), line, font=font, fill=text_color, anchor="mm")

      image.paste(temp_img, (x, y), temp_img)
      
    # 4. Barcode / QR drawing
    elif el_type in ["barcode", "qrcode"]:
      field_name = el.get("fieldName", "AccessionNo")
      value = "12345"  # fallback sample
      
      if field_name and record:
        value = str(record.get(field_name, "") or "12345").strip() or "12345"
      
      # Also check static text value for barcodes
      if value == "12345" and el.get("text"):
        value = str(el.get("text", "")).strip() or "12345"
        
      try:
        if el_type == "barcode":
          show_text = el.get("showText", False)
          b_type = el.get("barcodeType", "code128")
          auto_size = el.get("autoSize", True)
          
          # Calculate physical bar height in mm using clamped el_h
          font_size_pt = float(el.get("fontSize", 10))
          font_size_mm = font_size_pt * 0.352778
          element_height_mm = float(el_h)
          # textMargin: mirror the text_distance_mm formula in barcode_service.py
          text_margin_mm = float(el.get("textMargin") if el.get("textMargin") is not None else 1.5)
          font_size_px = font_size_pt * dpi / 72.0
          extra_px = max(0.0, font_size_px - font_size_pt)
          extra_mm = (extra_px * 25.4) / float(dpi)
          text_distance_mm = text_margin_mm + extra_mm
          bar_height_mm = max(3.0, element_height_mm - (font_size_mm + text_distance_mm) if show_text else element_height_mm)
          bar_width_mm = float(el.get("barWidth") or 0.35)
          
          logger.debug(f"[Render] Barcode type={b_type} value={value!r} bar_h={bar_height_mm:.1f}mm bar_w={bar_width_mm:.2f}mm auto_size={auto_size} dpi={dpi}")
          
          barcode_opts = {
            "showText": show_text,
            "fontSize": font_size_pt,
            "barHeight": bar_height_mm,
            "barWidth": bar_width_mm,
            "dpi": dpi,
            "fontWeight": el.get("fontWeight", "normal"),
            "fontStyle": el.get("fontStyle", "normal"),
            "textMargin": el.get("textMargin")
          }
          if auto_size:
            # Pass the target bounding box width in pixels to calculate the exact module width
            barcode_opts["targetWidthPx"] = w
            
          data_uri = generate_1d_barcode(
            b_type,
            value,
            barcode_opts
          )
        else:  # qrcode
          # Regenerate the QR at the printer DPI using exact module sizing so it
          # can be pasted 1:1 — no bitmap scaling, perfectly square modules.
          qr_opts = {
            "dpi": dpi,
            "targetWidthPx": w,
            "targetHeightPx": h,
            "border": int(el.get("border", 1)),
          }
          data_uri = generate_qr_code(value, qr_opts)
          
        # Convert base64 data URI back to PIL Image
        header, encoded = data_uri.split(",", 1)
        barcode_bytes = base64.b64decode(encoded)
        buf = io.BytesIO(barcode_bytes)
        barcode_img = Image.open(buf).convert("RGBA")
        barcode_img.load()
        buf.close()

        # Invert colors for negative template
        if negative:
          r, g, b, a = barcode_img.split()
          rgb_img = Image.merge("RGB", (r, g, b))
          inverted_rgb = ImageOps.invert(rgb_img)
          r2, g2, b2 = inverted_rgb.split()
          barcode_img = Image.merge("RGBA", (r2, g2, b2, a))

        src_w, src_h = barcode_img.size
        
        if el_type == "barcode":
          # Maintain barcode module width and aspect ratio (no horizontal stretch/interpolation)
          new_w = src_w
          new_h = min(h, src_h)
          if new_h != src_h:
            barcode_img = barcode_img.resize((new_w, new_h), Image.Resampling.NEAREST)
          
          # Align horizontally inside the bounding box using textAlign (default: "left")
          text_align = el.get("textAlign") or "left"
          if text_align == "center":
            paste_x = max(0, (w - new_w) // 2)
          elif text_align == "right":
            paste_x = max(0, w - new_w)
          else:  # left (default)
            paste_x = 0
          paste_y = (h - new_h) // 2
          
          temp_img.paste(barcode_img, (paste_x, paste_y), barcode_img)
          
        else:  # qrcode
          # QR is now generated at the exact target pixel size, so paste it 1:1
          # with no scaling. Center it inside the bounding box.
          new_w = min(w, src_w)
          new_h = min(h, src_h)
          paste_x = max(0, (w - new_w) // 2)
          paste_y = max(0, (h - new_h) // 2)
          temp_img.paste(barcode_img, (paste_x, paste_y), barcode_img)
          
      except Exception as ex:
        logger.error(f"Error rendering barcode on image: {ex}", exc_info=True)
        temp_draw.rectangle([0, 0, w, h], outline="red", width=2)
        try:
          temp_draw.text((2, 2), str(ex)[:40], fill="red")
        except Exception:
          pass

    # 5. Graphic Image
    elif el_type == "image":
      img_text = el.get("text")
      if img_text and img_text.startswith("data:"):
        try:
          header, encoded = img_text.split(",", 1)
          image_bytes = base64.b64decode(encoded)
          buf = io.BytesIO(image_bytes)
          graphic_img = Image.open(buf).convert("RGBA")
          graphic_img.load()
          buf.close()
          
          # Resize maintaining aspect ratio
          draw_w, draw_h = graphic_img.size
          if draw_w > w:
            scale_ratio = w / draw_w
            draw_w = w
            draw_h = int(draw_h * scale_ratio)
          if draw_h > h:
            scale_ratio = h / draw_h
            draw_w = int(draw_w * scale_ratio)
            draw_h = h
          
          graphic_img = graphic_img.resize((draw_w, draw_h), Image.Resampling.LANCZOS)
          paste_x = (w - draw_w) // 2
          paste_y = (h - draw_h) // 2
          temp_img.paste(graphic_img, (paste_x, paste_y), graphic_img)
        except Exception as ex:
          logger.error(f"Error rendering graphic image: {ex}")
          temp_draw.rectangle([0, 0, w, h], outline="red", width=2)

    # Apply rotation and paste temp_img onto the main image
    angle = el.get("rotation", 0)
    if angle != 0:
      rotated_img = temp_img.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)
      paste_x = int(x + w / 2 - rotated_img.width  / 2)
      paste_y = int(y + h / 2 - rotated_img.height / 2)
      image.paste(rotated_img, (paste_x, paste_y), rotated_img)
    else:
      image.paste(temp_img, (x, y), temp_img)

  # Final effects
  if mirror:
    image = image.transpose(Image.FLIP_LEFT_RIGHT)

  # Orientation rotation — high-quality bicubic resampling
  if orientation == "landscape":
    image = image.rotate(90,  expand=True, resample=Image.Resampling.BICUBIC)
  elif orientation == "landscape-180":
    image = image.rotate(270, expand=True, resample=Image.Resampling.BICUBIC)
  elif orientation == "portrait-180":
    image = image.rotate(180, expand=True, resample=Image.Resampling.BICUBIC)

  return image


def get_printer_capabilities(printer_name: str) -> Dict[str, Any]:
  """Query a printer's capabilities (DPI, colour, printable area, margins)."""
  try:
    from backend.services.printer_capabilities import detect_printer_capabilities
    return detect_printer_capabilities(printer_name)
  except Exception as ex:
    logger.error(f"[PrintService] Capability detection failed: {ex}")
    return {"success": False, "name": printer_name, "supportedDpi": [300], "maxDpi": 300}


def print_batch_to_spooler(
  printer_name: str,
  records: List[Dict[str, Any]],
  copies: int,
  template: Dict[str, Any],
  quality: str = "auto",
  dpi_override: Optional[int] = None,
  native_mode: bool = True,
) -> Dict[str, Any]:
  """
  Route a batch print job to the appropriate printer driver.

  - TSC / thermal printers  -> TSPLDriver (native TSPL via UniPRT SDK)
  - All other printers       -> GDIDriver  (rasterized Windows GDI, unchanged)

  The driver is selected automatically based on the printer name.
  PDF export and existing GDI printing are not affected.

  ``quality`` controls the resolved print resolution:
    * "auto"     -> printer's highest supported DPI
    * "highest"  -> printer's highest supported DPI
    * "highspeed"-> printer's lowest supported DPI
  ``dpi_override`` forces an explicit DPI (clamped to a supported value).
  """
  total_jobs = len(records) * copies
  logger.info(
    f"[PrintService] Routing {total_jobs} labels "
    f"({len(records)} records x {copies} copies) -> '{printer_name}' "
    f"(quality={quality}, dpi_override={dpi_override}, native_mode={native_mode})"
  )

  try:
    from backend.drivers.driver_router import get_driver
    driver = get_driver(printer_name, native_mode=native_mode)
    logger.info(f"[PrintService] Selected driver: {driver.driver_name}")
    return driver.print_batch(
      printer_name, records, copies, template,
      quality=quality, dpi_override=dpi_override,
      native_mode=native_mode,
    )
  except ImportError as imp_err:
    # Driver module not available - fall back to original GDI implementation
    logger.warning(
      f"[PrintService] Driver router import failed ({imp_err}), "
      f"falling back to legacy GDI path."
    )
    return _legacy_gdi_print(printer_name, records, copies, template, quality, dpi_override)
  except Exception as ex:
    logger.error(f"[PrintService] Driver error: {ex}", exc_info=True)
    return {"success": False, "message": str(ex)}


def _legacy_gdi_print(printer_name: str, records: List[Dict[str, Any]], copies: int, template: Dict[str, Any], quality: str = "auto", dpi_override: Optional[int] = None) -> Dict[str, Any]:
  """
  Legacy GDI print path - used as an emergency fallback if the driver
  architecture cannot be imported. It delegates to the GDIDriver so the
  high-resolution / high-fidelity pipeline is still applied.
  """
  try:
    from backend.drivers.gdi_driver import GDIDriver
    logger.info("[LegacyGDI] Delegating to GDIDriver for high-resolution print.")
    return GDIDriver().print_batch(
      printer_name, records, copies, template,
      quality=quality, dpi_override=dpi_override,
    )
  except Exception as ex:
    logger.error(f"[LegacyGDI] Fallback delegation failed: {ex}", exc_info=True)
    return {"success": False, "message": f"Legacy print error: {str(ex)}"}
    return {"success": True, "count": total_jobs, "mock": True}
