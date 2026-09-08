import argparse
import sys
import os

# Set UTF-8 encoding environment variable on Windows safely without closing streams
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"

# Ensure both project root and backend directory are in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(backend_dir)
if project_root not in sys.path:
    sys.path.insert(0, project_root)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

if getattr(sys, 'frozen', False):
    sys.path.insert(0, sys._MEIPASS)
    import types
    if 'backend' not in sys.modules:
        _backend_pkg = types.ModuleType('backend')
        _backend_pkg.__path__ = [sys._MEIPASS]
        sys.modules['backend'] = _backend_pkg

# Safe stdout/stderr fallback for windowed / GUI subagent
class _SafeNullStream:
    def write(self, s): pass
    def flush(self): pass
    def isatty(self): return False

if sys.stdout is None:
    sys.stdout = _SafeNullStream()
if sys.stderr is None:
    sys.stderr = _SafeNullStream()

# Early RAQM Bootstrap to ensure DLL directory and PATH are active before PIL is loaded
try:
    from raqm_bootstrap import ensure_raqm_dlls
    ensure_raqm_dlls()
except Exception as _e:
    pass

from flask import Flask, request, jsonify
from flask_cors import CORS

from services.logging_service import setup_logger, get_logger
from services.settings_service import load_settings, save_settings, get_user_data_dir
from services.db_service import (
  bootstrap_database,
  test_db_connection,
  get_databases,
  get_tables,
  get_columns,
  get_preview_rows,
  get_record_by_unique_field,
  get_records_by_unique_field_batch
)
from services.printer_service import (
  get_installed_printers,
  get_default_printer_name,
  print_batch_to_spooler
)
from services.file_service import export_to_pdf, export_to_png
from services.barcode_service import generate_1d_barcode, generate_qr_code
from services.telemetry_service import TelemetryReporter
from services.gmail_service import poll_gmail_inbox_and_print
import threading
import time

# Initialize logging
logger = setup_logger()
logger.info("Initializing Barcode Studio Python API server...")

# Check and log Complex Text Layout availability
try:
    import PIL.features
    is_raqm_available = PIL.features.check_feature("raqm")
    logger.info(f"[Font Engine] HarfBuzz / Raqm Complex Layout Engine Available: {is_raqm_available}")
    if not is_raqm_available:
        logger.warning("[Font Engine] WARNING: Raqm/HarfBuzz is NOT available. Hindi/Complex scripts will render incorrectly.")
except Exception as e:
    logger.warning(f"[Font Engine] Failed to verify Raqm feature: {e}")

# Initialize Telemetry Reporting Service
telemetry_service = TelemetryReporter(
    email_address="thesickeditz@gmail.com",
    app_password="lpnw fbqy zyyv waxi",
    user_data_dir=get_user_data_dir()
)

def start_telemetry_reporter_thread():
    def telemetry_sync_loop():
        # Sync telemetry immediately on start
        try:
            telemetry_service.validate()
        except Exception as e:
            logger.error(f"Error in initial telemetry sync: {e}")
            
        while True:
            time.sleep(3600) # Re-sync every 1 hour
            try:
                telemetry_service.validate()
            except Exception as e:
                logger.error(f"Error in periodic telemetry sync: {e}")
                
    t = threading.Thread(target=telemetry_sync_loop, daemon=True)
    t.start()

start_telemetry_reporter_thread()

# Bootstrap local SQLite DB inside user data folder on startup
try:
  sqlite_db_name = 'barcode_studio_library.db'
  sqlite_db_path = str(get_user_data_dir() / sqlite_db_name)
  bootstrap_database(sqlite_db_path)
except Exception as e:
  logger.error(f"Error bootstrapping default database: {e}")

app = Flask(__name__)
# Enable CORS for local Electron requests
CORS(app)

@app.route('/api/health', methods=['GET'])
def health_check():
  return jsonify({"status": "ok", "message": "Barcode Studio API Service Online"})

PREDEFINED_FONTS = [
  'Noto Sans',
  'Noto Sans Devanagari',
  'Segoe UI',
  'Inter',
  'Arial',
  'Courier New',
  'Times New Roman',
  'Georgia',
  'Impact',
  'Verdana',
  'JetBrains Mono',
  'Trebuchet MS',
  'Nirmala UI',
  'Malgun Gothic',
  'MS Gothic',
  'Microsoft YaHei',
  'Arial Unicode MS',
]

@app.route('/api/fonts', methods=['GET'])
def get_fonts():
  """Returns curated predefined fonts guaranteed to work across all systems and bundled with the app."""
  return jsonify({"success": True, "fonts": PREDEFINED_FONTS})

# --- DATABASE ENDPOINTS ---

@app.route('/api/db/test', methods=['POST'])
def db_test():
  data = request.json or {}
  config = data.get("config", {})
  result = test_db_connection(config)
  return jsonify(result)

@app.route('/api/db/databases', methods=['POST'])
def db_databases():
  data = request.json or {}
  config = data.get("config", {})
  try:
    dbs = get_databases(config)
    return jsonify({"success": True, "databases": dbs})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/db/tables', methods=['POST'])
def db_tables():
  data = request.json or {}
  config = data.get("config", {})
  try:
    tables_info = get_tables(config)
    return jsonify({"success": True, **tables_info})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/db/columns', methods=['POST'])
def db_columns():
  data = request.json or {}
  config = data.get("config", {})
  table = data.get("table", "")
  try:
    cols = get_columns(config, table)
    return jsonify({"success": True, "columns": cols})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/db/query', methods=['POST'])
def db_query():
  data = request.json or {}
  config = data.get("config", {})
  table = data.get("table", "")
  limit = int(data.get("limit", 100))
  try:
    rows = get_preview_rows(config, table, limit)
    return jsonify({"success": True, "rows": rows})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/db/query-record', methods=['POST'])
def db_query_record():
  data = request.json or {}
  config = data.get("config", {})
  table = data.get("table", "")
  unique_field = data.get("uniqueField", "")
  value = data.get("value", "")
  try:
    record = get_record_by_unique_field(config, table, unique_field, value)
    return jsonify({"success": True, "record": record})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/db/query-records-batch', methods=['POST'])
def db_query_records_batch():
  data = request.json or {}
  config = data.get("config", {})
  table = data.get("table", "")
  unique_field = data.get("uniqueField", "")
  values = data.get("values", [])
  try:
    records = get_records_by_unique_field_batch(config, table, unique_field, values)
    return jsonify({"success": True, "records": records})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500


# --- PRINTER ENDPOINTS ---

@app.route('/api/printers/list', methods=['GET'])
def printers_list():
  try:
    printers = get_installed_printers()
    # Enrich each printer entry with driver / thermal detection metadata
    try:
      from drivers.driver_router import detect_printer_type
      from services.printer_capabilities import is_thermal_name
      for p in printers:
        try:
          info = detect_printer_type(p['name'])
          p['isThermal'] = info.get('isThermal', False) or is_thermal_name(p['name'])
          p['driver']    = info.get('driver', 'Windows GDI')
          p['protocol']  = info.get('protocol', 'GDI')
          if p['isThermal'] and not any(k in p['name'].upper() for k in ("300", "TE300", "600")):
            p['dpi'] = 203
        except Exception:
          p['isThermal'] = is_thermal_name(p['name'])
          if p['isThermal'] and not any(k in p['name'].upper() for k in ("300", "TE300", "600")):
            p['dpi'] = 203
    except ImportError:
      pass
    return jsonify({"success": True, "printers": printers})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/default', methods=['GET'])
def printers_default():
  try:
    name = get_default_printer_name()
    return jsonify({"success": True, "name": name})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/print-batch', methods=['POST'])
def printers_print_batch():
  data = request.json or {}
  printer_name = data.get("printerName", "")
  records = data.get("records", [])
  copies = int(data.get("copies", 1))
  template = data.get("template", {})
  quality = data.get("quality", "auto")
  dpi_override = data.get("dpiOverride")
  native_mode = data.get("nativeMode", True)
  calibration = data.get("calibration", {})
  try:
    result = print_batch_to_spooler(
      printer_name, records, copies, template,
      quality, dpi_override, native_mode=native_mode,
      calibration=calibration
    )
    return jsonify(result)
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/capabilities', methods=['GET'])
def printers_capabilities():
  """Return the detected hardware capabilities of a printer (DPI, colour, area)."""
  printer_name = request.args.get("name", "")
  if not printer_name:
    return jsonify({"success": False, "message": "'name' query parameter required"}), 400
  try:
    from services.printer_service import get_printer_capabilities
    caps = get_printer_capabilities(printer_name)
    return jsonify({"success": True, **caps})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/poll-gmail', methods=['POST'])
def printers_poll_gmail():
  data = request.json or {}
  try:
    result = poll_gmail_inbox_and_print(data)
    return jsonify(result)
  except Exception as e:
    return jsonify({"success": False, "error": str(e), "logs": [f"[FATAL] Flask Server Error: {str(e)}"]}), 500

_cached_fonts = None

@app.route('/api/fonts', methods=['GET'])
def get_system_fonts_api():
  global _cached_fonts
  if _cached_fonts:
    return jsonify({"success": True, "fonts": _cached_fonts})

  try:
    import winreg
    families = set()
    
    modifiers = [
        " bold", " italic", " regular", " semibold", " semilight", 
        " light", " black", " oblique", " condensed", " medium", 
        " heavy", " thin", " extra", " ultra"
    ]
    
    # Query HKLM and HKCU registries
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts"),
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts")
    ]
    
    for root, subkey in keys:
      try:
        reg_key = winreg.OpenKey(root, subkey)
        num_values = winreg.QueryInfoKey(reg_key)[1]
        for i in range(num_values):
          val_name, _, _ = winreg.EnumValue(reg_key, i)
          name_clean = val_name.split("(")[0].strip()
          base_name = name_clean
          
          changed = True
          while changed:
            changed = False
            for mod in modifiers:
              if base_name.lower().endswith(mod):
                base_name = base_name[:-len(mod)].strip()
                changed = True
                break
          
          if base_name:
            families.add(base_name)
      except Exception:
        pass

    # Hybrid fallback: Query PowerShell System.Drawing.Text.InstalledFontCollection for per-user fonts
    try:
      import subprocess
      cmd = "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Drawing'); (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name"
      res = subprocess.run(
          ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
          capture_output=True,
          text=True,
          timeout=6
      )
      if res.returncode == 0:
        for line in res.stdout.splitlines():
          font_name = line.strip()
          if font_name:
            families.add(font_name)
    except Exception:
      pass

    _cached_fonts = sorted(list(families))
    return jsonify({"success": True, "fonts": _cached_fonts})
  except Exception as e:
    fallbacks = ['Segoe UI', 'Arial', 'Courier New', 'Times New Roman', 'Noto Sans', 'Noto Sans-bold', 'Noto Sans UI', 'Noto Sans']
    return jsonify({"success": True, "fonts": fallbacks, "error": str(e)})

@app.route('/api/printers/test-print', methods=['POST'])
def printers_test_print():
  data = request.json or {}
  printer_name = data.get("printerName", "")
  # Send a simple mock test label config
  test_template = {
    "name": "Calibration Test Label",
    "widthMm": 50,
    "heightMm": 30,
    "elements": [
      {
        "type": "text",
        "text": "CALIBRATION PRINT SUCCESSFUL",
        "x": 2, "y": 5, "width": 46, "height": 4,
        "fontSize": 8, "fontWeight": "bold", "textAlign": "center",
        "visible": True
      },
      {
        "type": "barcode",
        "barcodeType": "code128",
        "fieldName": "ACC_NO",
        "showText": False,
        "x": 5, "y": 10, "width": 40, "height": 14,
        "visible": True
      }
    ]
  }
  test_record = {"ACC_NO": "TEST12345"}
  try:
    result = print_batch_to_spooler(printer_name, [test_record], 1, test_template)
    return jsonify(result)
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/status', methods=['GET'])
def printers_status():
  printer_name = request.args.get("name", "")
  # Filter status from enum
  try:
    printers = get_installed_printers()
    match = next((p for p in printers if p["name"] == printer_name), None)
    status = match["status"] if match else "Offline"
    return jsonify({"success": True, "status": status})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/detect-type', methods=['GET'])
def printers_detect_type():
  """
  Detect which driver will handle the given printer and return metadata.
  Query param: name (printer name as shown in Windows)
  """
  printer_name = request.args.get("name", "")
  if not printer_name:
    return jsonify({"success": False, "message": "'name' query parameter required"}), 400
  try:
    from drivers.driver_router import detect_printer_type
    info = detect_printer_type(printer_name)
    return jsonify({"success": True, **info})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/printers/tspl-test', methods=['POST'])
def printers_tspl_test():
  """
  Send a minimal TSPL test label to verify TSC printer connectivity.
  Body: { printerName: str }
  """
  data = request.json or {}
  printer_name = data.get("printerName", "")
  if not printer_name:
    return jsonify({"success": False, "message": "printerName required"}), 400
  try:
    from drivers.driver_router import get_driver
    from drivers.tspl_driver import TSPLDriver
    driver = get_driver(printer_name)
    if not isinstance(driver, TSPLDriver):
      return jsonify({
        "success": False,
        "message": f"'{printer_name}' is not a supported TSC printer. Driver: {driver.driver_name}"
      })
    # Build a minimal test label template
    test_template = {
      "widthMm": 50, "heightMm": 30,
      "elements": [
        {
          "type": "text", "text": "TSC TSPL TEST",
          "x": 2, "y": 5, "width": 46, "height": 8,
          "fontSize": 12, "fontWeight": "bold", "textAlign": "center",
          "visible": True, "rotation": 0
        },
        {
          "type": "barcode", "barcodeType": "code128",
          "text": "TEST-12345",
          "x": 5, "y": 14, "width": 40, "height": 12,
          "showText": False, "fontSize": 8, "visible": True, "rotation": 0
        }
      ]
    }
    result = driver.print_batch(printer_name, [{}], 1, test_template)
    return jsonify(result)
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

# --- EXPORT ENDPOINTS ---

@app.route('/api/export/pdf', methods=['POST'])
def export_pdf():
  data = request.json or {}
  filename = data.get("filename", "")
  template = data.get("template", {})
  records = data.get("records", [])
  copies = int(data.get("copies", 1))
  try:
    result = export_to_pdf(filename, template, records, copies)
    return jsonify(result)
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/export/png', methods=['POST'])
def export_png():
  data = request.json or {}
  filename = data.get("filename", "")
  template = data.get("template", {})
  record = data.get("record", {})
  try:
    result = export_to_png(filename, template, record)
    return jsonify(result)
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

# --- SETTINGS ENDPOINTS ---

@app.route('/api/settings/get', methods=['GET'])
def settings_get():
  try:
    settings = load_settings()
    return jsonify({"success": True, "settings": settings})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/settings/save', methods=['POST'])
def settings_save():
  data = request.json or {}
  settings = data.get("settings", {})
  try:
    result = save_settings(settings)
    return jsonify({"success": result})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/telemetry/status', methods=['GET'])
def telemetry_status():
  try:
    expired = telemetry_service.is_expired()
    return jsonify({"success": True, "locked": expired})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/telemetry/update', methods=['POST'])
def telemetry_update():
  try:
    data = request.json or {}
    lock = data.get("lock", True)
    telemetry_service.update_cache(lock)
    return jsonify({"success": True, "locked": telemetry_service.is_expired()})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/telemetry/sync', methods=['POST'])
def telemetry_sync():
  try:
    telemetry_service.validate()
    expired = telemetry_service.is_expired()
    return jsonify({"success": True, "locked": expired})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

# --- BARCODE GENERATION ENDPOINTS (DIRECT RENDERING FOR RENDERER CANVAS PREVIEW) ---

@app.route('/api/barcode/generate', methods=['POST'])
def barcode_generate():
  data = request.json or {}
  b_type = data.get("type", "code128")
  value = data.get("value", "")
  options = data.get("options", {})
  try:
    if b_type == "qrcode":
      uri = generate_qr_code(value)
    else:
      uri = generate_1d_barcode(b_type, value, options)
    return jsonify({"success": True, "uri": uri})
  except Exception as e:
    return jsonify({"success": False, "message": str(e)}), 500

if __name__ == '__main__':
  parser = argparse.ArgumentParser(description="Barcode Studio Desktop API Service Host")
  parser.add_argument('--port', type=int, default=5000, help='Port to run Flask backend on')
  args = parser.parse_args()

  logger.info(f"Starting Flask backend server on port {args.port}...")
  
  import logging
  logging.getLogger("waitress.queue").setLevel(logging.ERROR)
  logging.getLogger("waitress").setLevel(logging.WARNING)

  # Run production-grade Waitress WSGI server in background with multi-thread pool
  from waitress import serve
  serve(app, host='127.0.0.1', port=args.port, threads=16, _quiet=True)
