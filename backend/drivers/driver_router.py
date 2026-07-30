"""
driver_router.py - Selects the correct printer driver for a given printer name.

Driver priority order:
  1. TSPLDriver  - TSC/Kores thermal printers (USB, Network or Spool)
  2. ZPLDriver   - Zebra printers (ZPL command direct raw)
  3. EPLDriver   - Eltron/EPL printers (EPL command direct raw)
  4. PDFDriver   - PDF print to file spools
  5. GDIDriver   - All other Windows printers (rasterized GDI fallback)
"""
from typing import Any, Dict, Type

try:
    from backend.drivers.base_driver import PrinterDriverInterface
    from backend.drivers.gdi_driver   import GDIDriver
    from backend.drivers.tspl_driver  import TSPLDriver
    from backend.drivers.zpl_driver   import ZPLDriver
    from backend.drivers.epl_driver   import EPLDriver
    from backend.drivers.pdf_driver   import PDFDriver
    from backend.services.logging_service import get_logger
except ModuleNotFoundError:
    from drivers.base_driver import PrinterDriverInterface
    from drivers.gdi_driver   import GDIDriver
    from drivers.tspl_driver  import TSPLDriver
    from drivers.zpl_driver   import ZPLDriver
    from drivers.epl_driver   import EPLDriver
    from drivers.pdf_driver   import PDFDriver
    from services.logging_service import get_logger

logger = get_logger()

# -----------------------------------------------------------------------------
# Driver registry - ordered by specificity (most specific first)
# -----------------------------------------------------------------------------

DRIVER_PRIORITY: list[Type[PrinterDriverInterface]] = [
    TSPLDriver,   # TSC/Kores TSPL
    ZPLDriver,    # Zebra ZPL
    EPLDriver,    # Eltron EPL
    PDFDriver,    # PDF virtual printer
    GDIDriver,    # Windows GDI fallback
]


def get_driver(printer_name: str, native_mode: bool = True, force_gdi: bool = False) -> PrinterDriverInterface:
    """
    Return the most appropriate driver instance for the named printer.

    Routing Strategy:
    1. If force_gdi is True, route directly to GDIDriver.
    2. If printer is a PDF virtual device, route to PDFDriver.
    3. If native_mode is True (default):
       - Route to native thermal drivers (TSPLDriver, ZPLDriver, EPLDriver) for direct raw command spooling.
    4. GDIDriver is kept strictly as a fallback for document printers (inkjet/laser).
    """
    if force_gdi:
        logger.info(f"[Router] Explicit GDI Force: '{printer_name}' -> GDIDriver")
        return GDIDriver()

    if PDFDriver.is_supported(printer_name):
        logger.info(f"[Router] '{printer_name}' -> PDF Document Driver")
        return PDFDriver()

    # Thermal label printers (TSPL, ZPL, EPL) automatically use native raw hardware commands
    for driver_cls in [TSPLDriver, ZPLDriver, EPLDriver]:
        if driver_cls.is_supported(printer_name):
            logger.info(
                f"[Router] Auto-Forced Native Thermal Spool: '{printer_name}' -> {driver_cls.driver_name}"
            )
            return driver_cls()

    logger.info(f"[Router] '{printer_name}' -> GDIDriver (Default High-Res Bitmap)")
    return GDIDriver()


def detect_printer_type(printer_name: str) -> Dict[str, Any]:
    """
    Return metadata about which driver will be used for a printer.
    Used by the /api/printers/detect-type endpoint.
    """
    driver = get_driver(printer_name, native_mode=True)
    
    # Check if printer is thermal based on name heuristics or selected driver
    from backend.services.printer_capabilities import is_thermal_name
    is_thermal = is_thermal_name(printer_name) or not isinstance(driver, (GDIDriver, PDFDriver))

    protocol = "GDI"
    if isinstance(driver, PDFDriver):
        protocol = "PDF"
    elif isinstance(driver, TSPLDriver):
        protocol = "TSPL"
    elif isinstance(driver, ZPLDriver):
        protocol = "ZPL"
    elif isinstance(driver, EPLDriver):
        protocol = "EPL"

    info: Dict[str, Any] = {
        "printerName": printer_name,
        "driver":      driver.driver_name,
        "isThermal":   is_thermal,
        "protocol":    protocol,
    }

    return info
