import os
import io
import math
import base64
from typing import List, Dict, Any
from PIL import Image, ImageOps
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import qrcode

from services.logging_service import get_logger
from services.printer_service import get_font_path, render_label_image
from drivers.gdi_driver import calculate_layout_positions

logger = get_logger()

registered_fonts = set()

def get_registered_font_name(font_family: str, bold: bool, italic: bool) -> str:
  font_key = f"{font_family}_{'bold' if bold else 'reg'}_{'italic' if italic else 'reg'}"
  if font_key in registered_fonts:
    return font_key
      
  font_path = get_font_path(font_family, bold, italic)
  if font_path and os.path.exists(font_path):
    try:
      pdfmetrics.registerFont(TTFont(font_key, font_path))
      registered_fonts.add(font_key)
      return font_key
    except Exception as e:
      logger.warning(f"Failed to register font {font_family} in ReportLab: {e}")
      
  # Fallback names
  if font_family.lower() == 'courier new':
    return 'Courier'
  return 'Helvetica'

def get_pdf_shrunk_font_size(c: canvas.Canvas, text: str, font_name: str, initial_size: float, max_width: float) -> float:
  size = initial_size
  min_size = 4.0
  while size > min_size:
    try:
      w = c.stringWidth(text, font_name, size)
    except Exception:
      w = len(text) * size * 0.5
    if w <= max_width:
      break
    size -= 0.5
  return size

def draw_vector_element(c: canvas.Canvas, el: Dict[str, Any], label_w_mm: float, label_h_mm: float, record: Dict[str, Any], negative: bool):
  if not el.get("visible", True):
    return

  # Clamp / shrink coordinates inside design canvas boundaries
  el_x_mm = el.get("x", 0)
  el_y_mm = el.get("y", 0)
  el_w_mm = el.get("width", 10)
  el_h_mm = el.get("height", 10)

  if el_x_mm < 0:
    el_w_mm = max(0.5, el_w_mm + el_x_mm)
    el_x_mm = 0
  if el_y_mm < 0:
    el_h_mm = max(0.5, el_h_mm + el_y_mm)
    el_y_mm = 0
    
  if el_x_mm >= label_w_mm:
    el_x_mm = max(0.0, label_w_mm - 1.0)
    el_w_mm = 1.0
  if el_y_mm >= label_h_mm:
    el_y_mm = max(0.0, label_h_mm - 1.0)
    el_h_mm = 1.0

  if el_x_mm + el_w_mm > label_w_mm:
    el_w_mm = max(0.5, label_w_mm - el_x_mm)
  if el_y_mm + el_h_mm > label_h_mm:
    el_h_mm = max(0.5, label_h_mm - el_y_mm)

  # Coordinates in ReportLab points (1 mm = mm points)
  w = el_w_mm * mm
  h = el_h_mm * mm
  
  # Calculate top-left to bottom-left coordinates conversion
  cx = (el_x_mm + el_w_mm / 2) * mm
  cy = (label_h_mm - (el_y_mm + el_h_mm / 2)) * mm
  
  el_type = el.get("type")
  angle = el.get("rotation", 0)
  
  c.saveState()
  # Translate and rotate around center
  c.translate(cx, cy)
  if angle != 0:
    c.rotate(-angle) # clockwise to counter-clockwise
      
  # Draw in local coordinate space (bounds: -w/2, -h/2 to w/2, h/2)
  # 1. Shape drawing
  if el_type == "shape":
    shape_type = el.get("shapeType", "rect")
    fill = el.get("fillColor", "#ffffff")
    stroke = el.get("strokeColor", "#000000")
    stroke_w = el.get("strokeWidth", 1) * mm
    
    if negative:
      fill = "black" if fill != "transparent" else "transparent"
      stroke = "white"
      
    c.setLineWidth(stroke_w)
    if fill != "transparent":
      c.setFillColor(HexColor(fill))
    c.setStrokeColor(HexColor(stroke))
    
    has_fill = (fill != "transparent")
    has_stroke = (stroke_w > 0 and stroke != "transparent")
    
    if shape_type == "rect":
      c.rect(-w/2, -h/2, w, h, fill=has_fill, stroke=has_stroke)
    elif shape_type == "ellipse":
      c.ellipse(-w/2, -h/2, w/2, h/2, fill=has_fill, stroke=has_stroke)
    elif shape_type == "line":
      if h > w:
        c.line(0, -h/2, 0, h/2)
      else:
        c.line(-w/2, 0, w/2, 0)

  # 2. Line Divider
  elif el_type == "line":
    stroke = el.get("strokeColor", "#000000")
    stroke_w = el.get("strokeWidth", 1) * mm
    if negative:
      stroke = "white"
    c.setLineWidth(stroke_w)
    c.setStrokeColor(HexColor(stroke))
    if h > w:
      c.line(0, -h/2, 0, h/2)
    else:
      c.line(-w/2, 0, w/2, 0)
      
  # 3. Text drawing
  elif el_type == "text":
    text = el.get("text", "")
    field_name = el.get("fieldName")
    if field_name and record and field_name in record:
      text = str(record.get(field_name, ""))
    prefix = el.get("prefix", "")
    suffix = el.get("suffix", "")
    text = f"{prefix}{text}{suffix}"
    
    font_family = el.get("fontFamily", "Segoe UI")
    font_size_pt = el.get("fontSize", 10)
    fw_val = str(el.get("fontWeight", "")).lower()
    bold = fw_val in ("bold", "700", "800", "900") or el.get("bold") is True or el.get("fontWeight") == 700
    italic = el.get("fontStyle") == "italic"
    text_color = el.get("textColor", "#000000")
    text_align = el.get("textAlign", "left")
    
    if negative:
      text_color = "#ffffff"
      
    font_name = get_registered_font_name(font_family, bold, italic)
    
    final_font_size = get_pdf_shrunk_font_size(c, text, font_name, font_size_pt, w)
      
    c.setFont(font_name, final_font_size)
    c.setFillColor(HexColor(text_color))

    # Vertically center the text's ink box within the element (matches the
    # canvas flexbox centering exactly). ReportLab draws text on its baseline,
    # so compute the baseline from the font's real ascent/descent metrics.
    text_y = 0
    try:
      fm = pdfmetrics.getFont(font_name)
      ascent = (fm.face.ascent or 0) * final_font_size / 1000
      descent = (-(fm.face.descent or 0)) * final_font_size / 1000
      text_y = (ascent - descent) / 2
    except Exception:
      text_y = final_font_size * 0.35
    
    if text_align == "center":
      c.drawCentredString(0, text_y, text)
    elif text_align == "right":
      c.drawRightString(w/2, text_y, text)
    else:
      c.drawString(-w/2, text_y, text)

  # 4. Barcode / QR drawing
  elif el_type in ["barcode", "qrcode"]:
    field_name = el.get("fieldName", "AccessionNo")
    value = "12345"
    if field_name and record and field_name in record:
      value = str(record.get(field_name, "12345"))
      
    if el_type == "barcode" or el.get("barcodeType") != "qrcode":
      b_type = el.get("barcodeType", "code128")
      show_text = el.get("showText", False)
      bar_width_mm = el.get("barWidth", 0.35)
      font_size_pt = el.get("fontSize", 10)
      
      try:
        from reportlab.graphics.barcode import code128, code39, ean, upc
        bt_lower = b_type.lower()
        module_w = bar_width_mm * mm
        
        font_size_mm = font_size_pt * 0.352778
        bar_h_mm = el_h_mm - font_size_mm - 2.0 if show_text else el_h_mm
        bar_h_mm = max(1.0, bar_h_mm)
        bar_h = bar_h_mm * mm
        
        bc = None
        if bt_lower in ['code128', 'code128a', 'code128b', 'code128c']:
          bc = code128.Code128(value, barWidth=module_w, barHeight=bar_h)
        elif bt_lower in ['code39', 'code39_full']:
          bc = code39.Standard39(value, barWidth=module_w, barHeight=bar_h)
        elif bt_lower == 'ean13':
          v_digits = ''.join(filter(str.isdigit, value))[:12].zfill(12)
          bc = ean.Ean13(v_digits, barWidth=module_w, barHeight=bar_h)
        elif bt_lower == 'ean8':
          v_digits = ''.join(filter(str.isdigit, value))[:7].zfill(7)
          bc = ean.Ean8(v_digits, barWidth=module_w, barHeight=bar_h)
        elif bt_lower in ['upca', 'upc']:
          v_digits = ''.join(filter(str.isdigit, value))[:11].zfill(11)
          bc = upc.StandardUPC(v_digits, barWidth=module_w, barHeight=bar_h)
        
        auto_size = el.get("autoSize", True)
        
        if bc:
          if hasattr(bc, 'humanReadable'):
            bc.humanReadable = 1 if show_text else 0
          if hasattr(bc, 'fontSize'):
            bc.fontSize = font_size_pt
            
          bc_w = bc.width
          bc_h = bc.height
          
          if auto_size:
            # Stretch vector barcode exactly to fit width/height
            scale_x = w / bc_w if bc_w > 0 else 1.0
            scale_y = h / bc_h if bc_h > 0 else 1.0
            c.saveState()
            c.scale(scale_x, scale_y)
            bc.drawOn(c, -bc_w / 2, -bc_h / 2)
            c.restoreState()
          else:
            # Proportional scale factor
            scale_ratio = 1.0
            if bc_w > w:
              scale_ratio = min(scale_ratio, w / bc_w)
            if bc_h > h:
              scale_ratio = min(scale_ratio, h / bc_h)
                
            if scale_ratio < 1.0:
              c.saveState()
              c.scale(scale_ratio, scale_ratio)
              scaled_w = w / scale_ratio
              scaled_h = h / scale_ratio
              bx = -scaled_w/2 + (scaled_w - bc_w) / 2
              by = -scaled_h/2 + (scaled_h - bc_h) / 2
              bc.drawOn(c, bx, by)
              c.restoreState()
            else:
              bx = -w/2 + (w - bc_w) / 2
              by = -h/2 + (h - bc_h) / 2
              bc.drawOn(c, bx, by)
        else:
          raise ValueError(f"Unsupported ReportLab barcode type: {b_type}")
      except Exception as e:
        logger.warning(f"ReportLab vector barcode failed, falling back to raster: {e}")
        try:
          from services.printer_service import generate_1d_barcode
          dpi = 300
          bar_h_mm = el_h_mm - (font_size_pt * 0.352778) - 2.0 if show_text else el_h_mm
          bar_h_mm = max(1.0, bar_h_mm)
          data_uri = generate_1d_barcode(
            b_type, 
            value, 
            {
              "showText": show_text,
              "fontSize": font_size_pt,
              "barHeight": bar_h_mm,
              "barWidth": bar_width_mm,
              "dpi": dpi,
              "fontWeight": el.get("fontWeight", "normal"),
              "fontStyle": el.get("fontStyle", "normal"),
              "textMargin": el.get("textMargin")
            }
          )
          header, encoded = data_uri.split(",", 1)
          barcode_bytes = base64.b64decode(encoded)
          img = Image.open(io.BytesIO(barcode_bytes)).convert("RGBA")
          if auto_size:
            c.drawImage(ImageReader(img), -w/2, -h/2, width=w, height=h)
          else:
            draw_w, draw_h = img.size
            if draw_w > w:
              scale_ratio = w / draw_w
              draw_w = w
              draw_h = draw_h * scale_ratio
            if draw_h > h:
              scale_ratio = h / draw_h
              draw_w = draw_w * scale_ratio
              draw_h = h
            c.drawImage(ImageReader(img), -draw_w/2, -draw_h/2, width=draw_w, height=draw_h)
        except Exception as ex:
          logger.error(f"Raster barcode fallback failed: {ex}")
          c.rect(-w/2, -h/2, w, h, fill=False, stroke=True)
    else:
      # QR Code vector drawing modules directly
      try:
        qr = qrcode.QRCode(version=1, border=0)
        qr.add_data(value)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        num_modules = len(matrix)
        block_size = min(w / num_modules, h / num_modules)
        
        offset_x = (w - block_size * num_modules) / 2
        offset_y = (h - block_size * num_modules) / 2
        
        c.setFillColor(HexColor("black" if not negative else "white"))
        for row_idx, row in enumerate(matrix):
          for col_idx, active in enumerate(row):
            if active:
              rx = -w/2 + offset_x + col_idx * block_size
              ry = -h/2 + offset_y + (num_modules - 1 - row_idx) * block_size
              c.rect(rx, ry, block_size, block_size, fill=True, stroke=False)
      except Exception as e:
        logger.error(f"Vector QR Code generation failed: {e}")
        c.rect(-w/2, -h/2, w, h, fill=False, stroke=True)

  # 5. Image element
  elif el_type == "image":
    img_text = el.get("text")
    if img_text and img_text.startswith("data:"):
      try:
        header, encoded = img_text.split(",", 1)
        image_bytes = base64.b64decode(encoded)
        img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
        draw_w, draw_h = img.size
        if draw_w > w:
          scale_ratio = w / draw_w
          draw_w = w
          draw_h = draw_h * scale_ratio
        if draw_h > h:
          scale_ratio = h / draw_h
          draw_w = draw_w * scale_ratio
          draw_h = h
        c.drawImage(ImageReader(img), -draw_w/2, -draw_h/2, width=draw_w, height=draw_h)
      except Exception as ex:
        logger.error(f"Image element drawing failed: {ex}")
        c.rect(-w/2, -h/2, w, h, fill=False, stroke=True)

  c.restoreState()

def export_to_pdf(filename: str, template: Dict[str, Any], records: List[Dict[str, Any]], copies: int) -> Dict[str, Any]:
  """
  Export batch labels to a custom page-sized PDF file with high sharpness vector
  drawings.

  The label positioning uses the SAME row-major layout engine as the live
  preview and the GDI printer driver (calculate_layout_positions): labels fill
  left-to-right within a row before advancing to the next row, honouring the
  template's columns, rows, gaps and margins so the printed/exported output is
  pixel-perfect and identical in sequence, spacing and positioning to the
  Live Roll Preview.
  """
  try:
    width_mm = float(template.get("widthMm", 75))
    height_mm = float(template.get("heightMm", 38))
    orientation = template.get("orientation", "portrait")
    negative = template.get("negative", False)

    # Build the flat ordered list of items, preserving the template mappings.
    # Each item in `items` will be a dict: {"template": ..., "record": ...}
    items: List[Dict[str, Any]] = []
    is_queue = len(records) > 0 and isinstance(records[0], dict) and "template" in records[0] and "record" in records[0]

    if is_queue:
      # If it's a queue, copies are already resolved in the frontend or gmail poller
      items = records
    else:
      for rec in records:
        for _ in range(int(copies) or 1):
          items.append({"template": template, "record": rec})

    # Use the first item's template (or the master template) as page layout master.
    layout_template = items[0]["template"] if len(items) > 0 else template
    width_mm = float(layout_template.get("widthMm", 75))
    height_mm = float(layout_template.get("heightMm", 38))

    # Use the shared, row-major layout engine so the PDF output matches the
    # preview and the GDI print driver exactly.
    pages = calculate_layout_positions(layout_template, max(1, len(items)))

    logger.info(
      f"Exporting PDF to {filename}: {len(items)} labels across "
      f"{len(pages)} page(s) (row-major, dual-column aware)"
    )

    c = canvas.Canvas(filename)

    for page in pages:
      page_w = float(page.get("page_width", width_mm))
      page_h = float(page.get("page_height", height_mm))
      c.setPageSize((page_w * mm, page_h * mm))

      for lbl in page.get("labels", []):
        idx = lbl.get("index", 0)
        if idx >= len(items):
          continue
        item = items[idx]
        curr_template = item["template"]
        curr_record = item["record"]

        curr_width_mm = float(curr_template.get("widthMm", 75))
        curr_height_mm = float(curr_template.get("heightMm", 38))
        curr_orientation = curr_template.get("orientation", "portrait")
        curr_negative = curr_template.get("negative", False)

        # Physical sticker cell size (accounts for landscape rotation).
        sticker_w = float(lbl.get("width", curr_width_mm))
        sticker_h = float(lbl.get("height", curr_height_mm))
        cell_x = float(lbl.get("x", 0))
        cell_y = float(lbl.get("y", 0))

        c.saveState()
        # Translate to the label cell's BOTTOM-LEFT in ReportLab (bottom-left)
        # page coordinates, then apply the per-label orientation rotation using
        # the same pivot logic as the single-label export.
        origin_x = cell_x * mm
        origin_y = (page_h - cell_y - sticker_h) * mm
        c.translate(origin_x, origin_y)

        if curr_orientation == "landscape":
          c.translate(0, sticker_h * mm)
          c.rotate(-90)
        elif curr_orientation == "landscape-180":
          c.translate(sticker_w * mm, 0)
          c.rotate(90)
        elif curr_orientation == "portrait-180":
          c.translate(sticker_w * mm, sticker_h * mm)
          c.rotate(180)

        # Draw all elements in the (unrotated) design coordinate space of the current template.
        elements = curr_template.get("elements", [])
        elements = sorted(elements, key=lambda e: e.get("zValue", 0))
        for el in elements:
          draw_vector_element(c, el, curr_width_mm, curr_height_mm, curr_record, curr_negative)

        c.restoreState()

      c.showPage()

    c.save()
    logger.info(f"Successfully generated vector PDF at {filename}")
    return {"success": True, "path": filename}

  except Exception as e:
    logger.error(f"Failed to export PDF: {e}", exc_info=True)
    return {"success": False, "message": f"PDF Export Error: {str(e)}"}

def export_to_png(filename: str, template: Dict[str, Any], record: Dict[str, Any]) -> Dict[str, Any]:
  """
  Export a single label layout as a high-fidelity PNG image.
  """
  try:
    logger.info(f"Exporting PNG label to {filename}")
    dpi = 300 # High print preview resolution
    
    # Render label to image
    img = render_label_image(template, record, dpi)
    
    # Ensure parent directory exists
    os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
    
    # Save image
    img.save(filename, "PNG")
    logger.info(f"Successfully saved PNG label to {filename}")
    return {"success": True, "path": filename}
    
  except Exception as e:
    logger.error(f"Failed to export PNG: {e}")
    return {"success": False, "message": f"PNG Export Error: {str(e)}"}

