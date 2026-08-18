import sys
import os
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from backend.utils.helpers import get_user_data_dir

_logger = None

def setup_logger():
  global _logger
  if _logger is not None:
    return _logger

  if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"

  log_dir = get_user_data_dir() / 'logs'
  log_dir.mkdir(parents=True, exist_ok=True)
  log_file = log_dir / 'app.log'

  logger = logging.getLogger('BarcodeStudio')
  logger.setLevel(logging.DEBUG)

  # Formatters
  formatter = logging.Formatter(
    '[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
  )

  # File Handler with Rotation (max 5MB, keep 3 backups)
  file_handler = RotatingFileHandler(log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8')
  file_handler.setFormatter(formatter)
  file_handler.setLevel(logging.INFO)
  logger.addHandler(file_handler)

  # Console Handler (sys.stdout to prevent stderr misidentification by Electron/process managers)
  console_handler = logging.StreamHandler(sys.stdout)
  console_handler.setFormatter(formatter)
  console_handler.setLevel(logging.INFO)
  logger.addHandler(console_handler)

  _logger = logger
  return logger

def get_logger():
  if _logger is None:
    return setup_logger()
  return _logger
