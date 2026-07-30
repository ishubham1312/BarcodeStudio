import json
import os
from typing import List, Dict, Any, Optional
from pathlib import Path
from backend.utils.helpers import get_user_data_dir, safe_filename
from backend.services.logging_service import get_logger

logger = get_logger()

def get_templates_dir() -> Path:
  path = get_user_data_dir() / 'templates'
  path.mkdir(parents=True, exist_ok=True)
  return path

def save_local_template(template: Dict[str, Any]) -> Dict[str, Any]:
  """Save a template layout to the user's template folder in .bcs (JSON) format."""
  try:
    template_id = template.get("id")
    name = template.get("name", "Untitled Layout")
    
    if not template_id:
      import uuid
      template_id = f"t-{str(uuid.uuid4())[:8]}"
      template["id"] = template_id
      
    filename = f"{safe_filename(name)}_{template_id}.bcs"
    filepath = get_templates_dir() / filename
    
    logger.info(f"Saving template {name} to {filepath}")
    
    with open(filepath, 'w', encoding='utf-8') as f:
      json.dump(template, f, indent=2, ensure_ascii=False)
      
    return {"success": True, "id": template_id, "path": str(filepath)}
  except Exception as e:
    logger.error(f"Failed to save local template: {e}")
    return {"success": False, "message": str(e)}

def load_local_templates() -> List[Dict[str, Any]]:
  """Load all user-designed templates from the templates directory."""
  templates = []
  try:
    templates_dir = get_templates_dir()
    logger.info(f"Loading user templates from {templates_dir}")
    
    for file in templates_dir.glob("*.bcs"):
      try:
        with open(file, 'r', encoding='utf-8') as f:
          tmpl = json.load(f)
          if isinstance(tmpl, dict) and "id" in tmpl and "name" in tmpl:
            templates.append(tmpl)
      except Exception as fe:
        logger.error(f"Error loading template file {file}: {fe}")
  except Exception as e:
    logger.error(f"Failed to scan templates directory: {e}")
    
  return templates

def delete_local_template(template_id: str) -> bool:
  """Delete template file by template ID."""
  try:
    templates_dir = get_templates_dir()
    for file in templates_dir.glob("*.bcs"):
      try:
        with open(file, 'r', encoding='utf-8') as f:
          tmpl = json.load(f)
          if tmpl.get("id") == template_id:
            os.remove(file)
            logger.info(f"Deleted template file {file}")
            return True
      except Exception:
        pass
  except Exception as e:
    logger.error(f"Error deleting template: {e}")
  return False
