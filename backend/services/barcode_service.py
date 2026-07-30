import base64
import io
from typing import Dict, Any, Optional
import barcode as barcode_lib
from barcode.writer import ImageWriter
import qrcode
from backend.services.logging_service import get_logger

logger = get_logger()

def generate_1d_barcode(barcode_type: str, value: str, options: Optional[Dict[str, Any]] = None) -> str:
  """
  Generate a 1D barcode and return it as a base64 encoded PNG data URI.
  Supported types: code128, code39, ean13, ean8, upc, isbn, etc.
  """
  try:
    # Ensure value is safe and clean
    safe_val = str(value or "").strip()
    if not safe_val:
      safe_val = "12345678"

    # Map input types to python-barcode types
    bt_lower = barcode_type.lower()
    
    # Defaults in case of type mapping
    if bt_lower in ['code128', 'code128a', 'code128b', 'code128c']:
      btype = 'code128'
      value = safe_val
    elif bt_lower in ['code39', 'code39_full']:
      btype = 'code39'
      # Standard Code 39 character check (convert to uppercase and filter)
      allowed_chars = set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%")
      filtered = "".join([c for c in safe_val.upper() if c in allowed_chars])
      value = filtered if filtered else "12345678"
    elif bt_lower == 'ean13':
      btype = 'ean13'
      value = ''.join(filter(str.isdigit, safe_val))[:12].zfill(12)
    elif bt_lower == 'ean8':
      btype = 'ean8'
      value = ''.join(filter(str.isdigit, safe_val))[:7].zfill(7)
    elif bt_lower in ['upca', 'upc']:
      btype = 'upc'
      value = ''.join(filter(str.isdigit, safe_val))[:11].zfill(11)
    elif bt_lower == 'isbn':
      btype = 'isbn13'
      value = ''.join(filter(str.isdigit, safe_val))[:12].zfill(12)
    elif bt_lower in ['gs1128', 'gs1_128']:
      btype = 'gs1_128'
      value = safe_val
    elif bt_lower in ['itf14', 'ean14']:
      btype = 'ean14'
      value = ''.join(filter(str.isdigit, safe_val))[:13].zfill(13)
    elif bt_lower == 'itf':
      btype = 'itf'
      value = ''.join(filter(str.isdigit, safe_val))
      if len(value) % 2 != 0:
        value = "0" + value
      if not value:
        value = "12345678"
    elif bt_lower == 'codabar':
      btype = 'codabar'
      allowed_chars = set("0123456789-$:/.+")
      chars = safe_val.upper()
      if len(chars) >= 2 and chars[0] in "ABCD" and chars[-1] in "ABCD":
        middle = "".join([c for c in chars[1:-1] if c in allowed_chars])
        value = f"{chars[0]}{middle}{chars[-1]}"
      else:
        middle = "".join([c for c in chars if c in allowed_chars])
        value = f"A{middle}B"
    else:
      btype = 'code128'
      value = safe_val
      
    logger.debug(f"Generating 1D barcode of type {btype} with value {value}")
    
    # Setup options
    options = options or {}
    show_text = options.get('showText', False)
    font_size_pt = options.get('fontSize', 10)
    bar_width_mm = options.get('barWidth', 0.35)
    bar_height_mm = options.get('barHeight', 15.0)
    dpi = options.get('dpi', 300)
    target_width_px = options.get('targetWidthPx')
    font_weight = options.get('fontWeight', 'normal')
    font_style = options.get('fontStyle', 'normal')
    text_margin_mm = options.get('textMargin')
    
    # Create barcode — try with text first, fall back to no text if font not available
    # (python-barcode requires a system font for text; this can fail in frozen/packaged apps)
    encoder = barcode_lib.get(btype, value, writer=ImageWriter())
    
    if target_width_px is not None:
      try:
        code_data = encoder.build()
        num_modules = len(code_data[0])
        if num_modules > 0:
          # Compute exact integer pixel width per module to fit within target
          module_width_px = int(target_width_px) // num_modules
          module_width_px = max(1, module_width_px)
          bar_width_mm = (float(module_width_px) * 25.4) / float(dpi)
          logger.debug(f"[BarcodeService] Calculated exact integer module width: {module_width_px} px ({bar_width_mm:.6f} mm) for {num_modules} modules to fit {target_width_px} px")
      except Exception as ex:
        logger.warning(f"[BarcodeService] Failed to calculate dynamic module width: {ex}")

    write_options = {
      'module_height': bar_height_mm,
      'module_width': bar_width_mm,
      'dpi': int(dpi),
      'quiet_zone': 0.0,
      'margin_top': 0.0,
      'margin_bottom': 0.0,
      'margin_left': 0.0,
      'margin_right': 0.0
    }

    # Try with text rendering first
    if show_text:
      try:
        # Locate standard Windows TrueType font to prevent overlapping/rendering issues
        import os
        is_bold = font_weight == 'bold'
        is_italic = font_style == 'italic'

        font_dir = "C:\\Windows\\Fonts\\"
        font_file = "arial.ttf"
        if is_bold and is_italic:
            font_file = "arialbi.ttf"
        elif is_bold:
            font_file = "arialbd.ttf"
        elif is_italic:
            font_file = "ariali.ttf"

        font_path = os.path.join(font_dir, font_file)
        if not os.path.exists(font_path):
            # Fallback to Segoe UI
            segoe_file = "segoeui.ttf"
            if is_bold and is_italic:
                segoe_file = "segoeuiz.ttf"
            elif is_bold:
                segoe_file = "segoeuib.ttf"
            elif is_italic:
                segoe_file = "segoeuii.ttf"
            font_path = os.path.join(font_dir, segoe_file)

            font_path = os.path.join(font_dir, font_file)
        if not os.path.exists(font_path):
            #Nirmala UI
            nirmala_file = "nirmala.ttf"
            if is_bold and is_italic:
                nirmala_file = "nirmali.ttf"
            elif is_bold:
                nirmala_file = "nirmal-bold.ttf"
            elif is_italic:
                nirmala_file = "nirmali.ttf"

        # Calculate dynamic text distance to compensate for python-barcode's internal point-to-pixel unit mismatch
        base_margin = float(text_margin_mm) if text_margin_mm is not None else 1.5
        font_size_px = float(font_size_pt) * float(dpi) / 72.0
        extra_pixels = max(0.0, font_size_px - float(font_size_pt))
        extra_mm = (extra_pixels * 25.4) / float(dpi)
        text_distance_mm = base_margin + extra_mm

        fp = io.BytesIO()
        encoder.write(fp, options={
          **write_options,
          'write_text': True,
          'font_size': int(font_size_pt),
          'font_path': font_path if os.path.exists(font_path) else None,
          'text_distance': text_distance_mm,
        })
        fp.seek(0)
        base64_data = base64.b64encode(fp.read()).decode('utf-8')
        return f"data:image/png;base64,{base64_data}"
      except OSError as font_err:
        # Font file unavailable — retry without text
        logger.warning(f"[BarcodeService] Font unavailable, generating barcode without text: {font_err}")
        show_text = False

    # Render without text (no font required)
    fp = io.BytesIO()
    encoder.write(fp, options={
      **write_options,
      'write_text': False,
    })
    fp.seek(0)
    base64_data = base64.b64encode(fp.read()).decode('utf-8')
    return f"data:image/png;base64,{base64_data}"
    
  except Exception as e:
    logger.error(f"Error generating 1D barcode: {e}")
    raise ValueError(f"Failed to generate barcode: {str(e)}")

def generate_qr_code(value: str, options: Optional[Dict[str, Any]] = None) -> str:
  """
  Generate a QR code and return it as a base64 encoded PNG data URI.

  When ``options.targetWidthPx`` / ``options.targetHeightPx`` (and ``dpi``) are
  supplied the QR is regenerated at the exact module size so that it can be
  pasted 1:1 at the printer resolution — no bitmap scaling is performed, which
  keeps every module perfectly square and scannable.
  """
  try:
    logger.debug(f"Generating QR code for value: {value}")
    options = options or {}

    target_width_px = options.get("targetWidthPx")
    target_height_px = options.get("targetHeightPx")
    dpi = int(options.get("dpi", 300))
    border = int(options.get("border", 1))
    error_level = options.get("errorCorrection", "L")

    error_map = {
      "L": qrcode.constants.ERROR_CORRECT_L,
      "M": qrcode.constants.ERROR_CORRECT_M,
      "Q": qrcode.constants.ERROR_CORRECT_Q,
      "H": qrcode.constants.ERROR_CORRECT_H,
    }
    ec_level = error_map.get(str(error_level).upper(), qrcode.constants.ERROR_CORRECT_L)

    qr = qrcode.QRCode(
      version=1,
      error_correction=ec_level,
      box_size=10,
      border=border,
    )
    qr.add_data(value)
    qr.make(fit=True)

    # Determine the exact integer module pixel size so the rendered QR lands at
    # the requested pixel dimensions with no fractional scaling.
    modules = qr.modules_count
    box_size = 10
    if target_width_px and target_height_px:
      avail_w = max(1, int(target_width_px) - 2 * border)
      avail_h = max(1, int(target_height_px) - 2 * border)
      box_size = max(1, int(min(avail_w, avail_h) / modules))
    elif target_width_px:
      avail_w = max(1, int(target_width_px) - 2 * border)
      box_size = max(1, int(avail_w / modules))

    qr.box_size = box_size
    qr.border = border

    # Render with a transparent background so it composites cleanly over any
    # label background, then convert to RGBA and knock out white pixels.
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    img = img.convert("RGBA")
    datas = img.getdata()
    new_datas = []
    for item in datas:
      # White -> transparent; black -> opaque black.
      if item[0] > 200 and item[1] > 200 and item[2] > 200:
        new_datas.append((0, 0, 0, 0))
      else:
        new_datas.append((0, 0, 0, 255))
    img.putdata(new_datas)

    fp = io.BytesIO()
    img.save(fp, format="PNG")
    fp.seek(0)
    base64_data = base64.b64encode(fp.read()).decode('utf-8')
    return f"data:image/png;base64,{base64_data}"
    
  except Exception as e:
    logger.error(f"Error generating QR code: {e}")
    raise ValueError(f"Failed to generate QR code: {str(e)}")
