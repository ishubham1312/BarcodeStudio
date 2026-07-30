import os
import re
from pathlib import Path

def get_user_data_dir() -> Path:
  """Get path to application data directory."""
  if os.name == 'nt':
    base = os.environ.get('APPDATA')
  else:
    base = os.path.expanduser('~/.config')
    
  if not base:
    base = os.path.expanduser('~')
    
  path = Path(base) / 'Barcode Studio'
  path.mkdir(parents=True, exist_ok=True)
  return path

def safe_filename(name: str) -> str:
  """Sanitize filename to prevent directory traversal or invalid characters."""
  name = re.sub(r'[\\/*?:"<>|]', '', name)
  return name.replace(' ', '_').lower()

def encrypt_password(password: str) -> str:
  """Simple obfuscation for connection profiles. 
  In a real enterprise environment, use keyring or DPAPI, 
  but simple base64 ensures standard config JSON readability without plain text."""
  import base64
  return base64.b64encode(password.encode('utf-8')).decode('utf-8')

def decrypt_password(encoded: str) -> str:
  """Decode base64 obfuscated password."""
  import base64
  if not encoded:
    return ""
  try:
    return base64.b64decode(encoded.encode('utf-8')).decode('utf-8')
  except Exception:
    return encoded
