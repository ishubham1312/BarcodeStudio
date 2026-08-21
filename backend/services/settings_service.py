import json
from pathlib import Path
from utils.helpers import get_user_data_dir
from services.logging_service import get_logger

logger = get_logger()

DEFAULT_SETTINGS = {
  "servers": [
    {
      "id": "srv-default-sqlite",
      "name": "Local SQLite Library DB",
      "dbType": "sqlite",
      "server": "",
      "database": "main",
      "table": "BOOK_MASTER",
      "username": "",
      "password": "",
      "authMode": "sql",
      "trustCert": True,
      "encrypt": False,
      "sqlitePath": "", # Dynamically filled if empty
      "uniqueField": "ACC_NO",
      "isActive": True
    }
  ],
  "activePrinter": {
    "name": "Microsoft Print to PDF",
    "status": "Ready",
    "type": "Virtual Office",
    "dpi": 600,
    "paperType": "dual",
    "widthMm": 50,
    "heightMm": 30,
    "leftMarginMm": 2,
    "rightMarginMm": 2,
    "middleGapMm": 2
  },
  "savedPrinters": [],
  "preferences": {
    "theme": "light",
    "snapToGrid": True,
    "gridSizeMm": 2.5,
    "recentFiles": [],
    "recentTemplates": [],
    "printQuality": "auto"
  }
}

def get_settings_file_path() -> Path:
  return get_user_data_dir() / 'settings.json'

def load_settings() -> dict:
  path = get_settings_file_path()
  logger.info(f"Loading application settings from {path}")
  
  # Set default sqlite db path inside the user data dir
  default_sqlite_path = str(get_user_data_dir() / 'barcode_studio_library.db')
  DEFAULT_SETTINGS["servers"][0]["sqlitePath"] = default_sqlite_path
  
  if not path.exists():
    logger.info("Settings file not found, creating with defaults")
    save_settings(DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS

  try:
    with open(path, 'r', encoding='utf-8') as f:
      data = json.load(f)
      # Ensure key settings exist by merging with defaults
      for key in DEFAULT_SETTINGS:
        if key not in data:
          data[key] = DEFAULT_SETTINGS[key]
      return data
  except Exception as e:
    logger.error(f"Error loading settings file: {e}. Falling back to default settings.")
    return DEFAULT_SETTINGS

def save_settings(settings: dict) -> bool:
  path = get_settings_file_path()
  try:
    # Validate structure slightly
    if "servers" not in settings:
      settings["servers"] = DEFAULT_SETTINGS["servers"]
    if "activePrinter" not in settings:
      settings["activePrinter"] = DEFAULT_SETTINGS["activePrinter"]
      
    with open(path, 'w', encoding='utf-8') as f:
      json.dump(settings, f, indent=2, ensure_ascii=False)
    logger.info("Settings saved successfully")
    return True
  except Exception as e:
    logger.error(f"Error saving settings file: {e}")
    return False
