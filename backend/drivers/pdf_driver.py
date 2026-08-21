"""
pdf_driver.py — PDF printer driver.

Wraps PDF generation and silent spooling using the existing file_service and printLabelPdf flows.
"""
from typing import Any, Dict, List
from drivers.base_driver import PrinterDriverInterface
from services.logging_service import get_logger

logger = get_logger()

class PDFDriver(PrinterDriverInterface):
    """
    Virtual PDF Printer Driver.
    """
    driver_name = "PDF Document Driver"

    @classmethod
    def is_supported(cls, printer_name: str) -> bool:
        name_lower = (printer_name or "").lower()
        # Only support explicit mock file exports, allowing real Windows PDF/XPS printers to spool via GDI
        return name_lower in ["pdf-export", "export-to-pdf", "virtual-pdf"]

    def print_batch(
        self,
        printer_name: str,
        records: List[Dict[str, Any]],
        copies: int,
        template: Dict[str, Any],
        quality: str = "auto",
        dpi_override: Any = None,
    ) -> Dict[str, Any]:
        # Defer import to avoid circular dependency
        from services.file_service import export_to_pdf
        import tempfile
        
        logger.info(f"[PDFDriver] Generating PDF batch print to file...")
        temp_file = tempfile.mktemp(suffix=".pdf")
        
        res = export_to_pdf(temp_file, template, records, copies)
        if res.get("success"):
            is_queue = len(records) > 0 and isinstance(records[0], dict) and "template" in records[0] and "record" in records[0]
            count = len(records) if is_queue else len(records) * copies
            return {
                "success": True, 
                "count": count, 
                "driver": self.driver_name,
                "filePath": temp_file
            }
        return {"success": False, "message": res.get("message", "PDF generation failed.")}
