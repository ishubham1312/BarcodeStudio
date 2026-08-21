"""
raqm_bootstrap.py — PyInstaller runtime hook.

Pillow's RAQM complex-text-layout engine is what correctly joins Indic
conjuncts and Devanagari/Hindi matras. On the developer machine the RAQM
dependency DLLs (libfribidi-0.dll, etc.) are resolved from PATH (e.g. an
installed Tesseract-OCR), but a frozen PyInstaller build does NOT bundle
them. On a clean target PC RAQM therefore silently fails to initialize and
Hindi/Indic text falls back to unshaped (broken) BASIC layout — every
character and matra prints individually.

This hook runs before ANY user code (and therefore before `from PIL import
...`), locates the bundled RAQM DLL folder and explicitly loads the
dependency chain so RAQM is always available in the frozen executable.
"""
import os
import sys

_RAQM_DLL_NAMES = (
    "libfribidi-0.dll",
    "libharfbuzz-0.dll",
    "libfreetype-6.dll",
    "libglib-2.0-0.dll",
    "libgraphite2.dll",
    "libintl-8.dll",
    "libiconv-2.dll",
    "libffi-8.dll",
    "libpcre2-8-0.dll",
    "libunistring-5.dll",
)


def _walk_up_for(sub_rel):
    candidates = []
    try:
        start = os.path.dirname(os.path.abspath(sys.executable))
    except Exception:
        start = os.getcwd()
    cur = start
    for _ in range(6):
        if not cur:
            break
        cand = os.path.join(cur, sub_rel)
        if os.path.isdir(cand):
            candidates.append(cand)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return candidates


def ensure_raqm_dlls():
    import ctypes

    raqm_dirs = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        for sub in ("backend/assets/raqm", "assets/raqm", "raqm"):
            p = os.path.join(meipass, sub)
            if os.path.isdir(p):
                raqm_dirs.append(p)
    raqm_dirs += _walk_up_for(os.path.join("backend", "assets", "raqm"))
    raqm_dirs += _walk_up_for(os.path.join("assets", "raqm"))

    # Development fallback (script directory based)
    try:
        dev_base = os.path.dirname(os.path.abspath(__file__))
        for _ in range(4):
            cand = os.path.join(dev_base, "assets", "raqm")
            if os.path.isdir(cand):
                raqm_dirs.append(cand)
                break
            parent = os.path.dirname(dev_base)
            if parent == dev_base:
                break
            dev_base = parent
    except Exception:
        pass

    seen = set()
    for d in raqm_dirs:
        abs_d = os.path.abspath(d)
        if abs_d in seen:
            continue
        seen.add(abs_d)

        # 1. Prepend to process PATH so Windows C runtime / LoadLibrary inside PIL extensions finds it
        try:
            current_path = os.environ.get("PATH", "")
            if abs_d not in current_path.split(";"):
                os.environ["PATH"] = abs_d + ";" + current_path
        except Exception:
            pass

        # 2. Windows SetDllDirectoryW for win32 dynamic linking
        try:
            if hasattr(ctypes, "windll") and hasattr(ctypes.windll, "kernel32"):
                ctypes.windll.kernel32.SetDllDirectoryW(abs_d)
        except Exception:
            pass

        # 3. Python 3.8+ DLL directory registration
        try:
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(abs_d)
        except Exception:
            pass

        # 4. Explicitly load dependencies in order
        for dll in _RAQM_DLL_NAMES:
            fp = os.path.join(abs_d, dll)
            if os.path.exists(fp):
                try:
                    ctypes.CDLL(fp)
                except Exception:
                    pass


ensure_raqm_dlls()
