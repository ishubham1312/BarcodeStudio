"""
sdk_loader.py — TSC UniPRT SDK path resolution and environment setup.

Resolves the correct path for TSC Python SDK `.pyd` modules at runtime,
whether running in development mode or as a PyInstaller frozen bundle.
Also ensures TSCLIB.dll is accessible from the process working directory.
"""
import os
import sys
import shutil
from pathlib import Path
from backend.services.logging_service import get_logger

logger = get_logger()

# ─────────────────────────────────────────────────────────────────────────────
# Path resolution
# ─────────────────────────────────────────────────────────────────────────────

def _find_sdk_directory() -> Path | None:
    """
    Return the absolute path to the SDK Python pyd directory.

    Search order:
      1. Adjacent to the frozen exe (_MEIPASS) in packed builds
      2. Relative to this source file for development
      3. Common installation paths
    """
    candidates: list[Path] = []

    # 1. PyInstaller frozen bundle
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
        candidates.append(base / "tsc_sdk")

    # 2. Development: walk up from this file to find the project SDK folder
    here = Path(__file__).resolve()
    # this file: backend/utils/sdk_loader.py  →  project root is 2 levels up
    project_root = here.parent.parent.parent  # React/
    candidates.extend([
        project_root / "python windows sdk" / "Example" / "Python_pyd",
        project_root / "python windows sdk" / "SDK" / "Python_pyd",
    ])

    for path in candidates:
        if path.exists() and any(path.glob("LabelMakerSDK.pyd")):
            return path

    return None


def _find_tsclib_dll() -> Path | None:
    """Locate TSCLIB.dll from the project directory."""
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)  # type: ignore[attr-defined]
        p = base / "tsc_sdk" / "TSCLib.dll"
        if p.exists():
            return p
        p = base / "tsc_sdk" / "TSCLIB.dll"
        if p.exists():
            return p

    here = Path(__file__).resolve()
    project_root = here.parent.parent.parent  # React/
    candidates = [
        project_root / "python windows sdk" / "TSCLib.dll",
        project_root / "python windows sdk" / "TSCLIB.dll",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

_sdk_loaded: bool = False
_sdk_path: Path | None = None


def ensure_sdk_available() -> bool:
    """
    Make the TSC SDK Python modules importable by inserting the SDK directory
    at the front of sys.path.  Also copies TSCLIB.dll into the working
    directory (or SDK dir) so the DLL is resolved when pyd modules load it.

    Returns True if the SDK appears to be available, False otherwise.
    """
    global _sdk_loaded, _sdk_path

    if _sdk_loaded:
        return True

    sdk_dir = _find_sdk_directory()
    if sdk_dir is None:
        logger.error(
            "[TSC SDK] Could not locate SDK Python pyd directory. "
            "TSC thermal printing will be unavailable."
        )
        return False

    # Insert SDK path into Python's module search path (idempotent)
    sdk_str = str(sdk_dir)
    if sdk_str not in sys.path:
        sys.path.insert(0, sdk_str)
        logger.info(f"[TSC SDK] Added SDK path to sys.path: {sdk_str}")

    # Ensure TSCLIB.dll is accessible
    dll_src = _find_tsclib_dll()
    if dll_src:
        # Copy DLL next to the SDK pyd files so they can load it
        dll_dst = sdk_dir / dll_src.name
        if not dll_dst.exists():
            try:
                shutil.copy2(str(dll_src), str(dll_dst))
                logger.info(f"[TSC SDK] Copied {dll_src.name} -> {dll_dst}")
            except Exception as ex:
                logger.warning(f"[TSC SDK] Could not copy TSCLIB.dll: {ex}")
        # Also add DLL directory to Windows DLL search path
        if sys.platform == "win32":
            try:
                os.add_dll_directory(str(sdk_dir))  # Python 3.8+
            except (AttributeError, OSError):
                # Older Python or OS - fall back to PATH
                env_path = os.environ.get("PATH", "")
                if sdk_str not in env_path:
                    os.environ["PATH"] = sdk_str + os.pathsep + env_path
    else:
        logger.warning("[TSC SDK] TSCLIB.dll not found - some SDK features may fail.")

    # Quick import probe to confirm modules are loadable
    try:
        import LabelMakerSDK  # noqa: F401
        import CommSDK  # noqa: F401
        _sdk_loaded = True
        _sdk_path = sdk_dir
        logger.info("[TSC SDK] LabelMakerSDK and CommSDK loaded successfully.")
        return True
    except ImportError as ex:
        logger.error(f"[TSC SDK] Import failed after path setup: {ex}")
        return False


def get_sdk_path() -> Path | None:
    """Return the resolved SDK directory path (after ensure_sdk_available())."""
    return _sdk_path
