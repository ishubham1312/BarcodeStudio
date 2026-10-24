"""
Telemetry Service (Legacy stub).
Remote access and deactivation are now handled directly via the Firebase Admin Panel.
"""
from pathlib import Path
from services.logging_service import get_logger

logger = get_logger()

class TelemetryReporter:
    """Legacy telemetry reporter stub maintained for backwards compatibility."""
    
    def __init__(self, email_address: str = "", app_password: str = "", user_data_dir: Path = None):
        self.user_data_dir = user_data_dir
        
    def is_expired(self) -> bool:
        return False
        
    def update_cache(self, expired: bool):
        pass
            
    def validate(self):
        pass
