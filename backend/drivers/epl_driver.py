"""
epl_driver.py — Eltron EPL printer driver (Placeholder).

Implements the standard driver interface for future EPL translation and raw printing.
"""
from typing import Any, Dict, List
from drivers.base_driver import PrinterDriverInterface
from services.logging_service import get_logger

logger = get_logger()

class EPLDriver(PrinterDriverInterface):
    """
    Direct Eltron EPL command printing driver.
    """
    driver_name = "Eltron EPL (Direct Spooling)"

    @classmethod
    def is_supported(cls, printer_name: str) -> bool:
        # Since Eltron EPL native printing is not yet implemented, return False
        # so it falls back to the GDI driver.
        return False

    def print_batch(
        self,
        printer_name: str,
        records: List[Dict[str, Any]],
        copies: int,
        template: Dict[str, Any],
        quality: str = "auto",
        dpi_override: Any = None,
        **kwargs,
    ) -> Dict[str, Any]:
        logger.info(f"[EPL] Native EPL printing is not yet implemented. Bypassing to GDI/fallback...")
        return {"success": False, "message": "EPL native printing driver is not implemented. Use GDI fallback."}
