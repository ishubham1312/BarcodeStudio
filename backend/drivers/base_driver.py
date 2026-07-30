"""
base_driver.py — Abstract printer driver interface.

All printer drivers (TSPL, ZPL, GDI, PDF) must implement this interface.
The driver router selects the appropriate driver at print time.
"""
import sys
from abc import ABC, abstractmethod
from typing import Any, Dict, List

# Alias sys.modules so 'backend.drivers.base_driver' and 'drivers.base_driver' resolve to the exact same ABC class
_mod_name = __name__
if _mod_name == "backend.drivers.base_driver":
    sys.modules["drivers.base_driver"] = sys.modules[_mod_name]
elif _mod_name == "drivers.base_driver":
    sys.modules["backend.drivers.base_driver"] = sys.modules[_mod_name]


class PrinterDriverInterface(ABC):
    """
    Abstract base class for all printer driver implementations.

    Drivers are responsible for:
      - Detecting which printers they support
      - Translating the Print Object Model into printer-specific commands
      - Delivering those commands to the physical printer
    """

    # Human-readable name for logging / diagnostics
    driver_name: str = "base"

    @classmethod
    @abstractmethod
    def is_supported(cls, printer_name: str) -> bool:
        """
        Return True if this driver can handle the given printer.
        Called by the router to select the correct driver.
        """
        ...

    @abstractmethod
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
        """
        Print a batch of label records to the named printer.

        Args:
            printer_name: The Windows printer name (or IP for network printers)
            records: List of data records; each record is a dict of field → value
            copies: Number of copies per record
            template: The label template dict with widthMm, heightMm, elements[]
            quality: "auto" | "highest" | "highspeed" print-quality resolution mode
            dpi_override: Optional explicit DPI to force

        Returns:
            Dict with at least {"success": bool, "count": int} and
            optionally {"message": str, "driver": str}
        """
        ...

    def describe(self) -> str:
        """Short description for logging."""
        return f"{self.driver_name} driver"
