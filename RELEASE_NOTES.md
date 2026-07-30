# Release Notes - BarCode Studio v3.0.1

## Key Updates & Fixes

* **Git Tracking:** Removed accidental `%USERPROFILE%/.pyenv` directories from repository tracking and updated `.gitignore` rules.
* **TSC Printer Calibration Issue:** Removed the `ESC !R` printer reset command from the TSPL driver to prevent TSC printers from feeding two blank pages before printing.
* **Driver Stability:** Defined missing parameters (`page_w_mm`, `page_h_mm`, `has_bitmaps`) inside the TSPL `print_batch` function, resolving three runtime compilation errors.
* **Software Updates System:** Integrated an automated, in-app update check and installer delivery system connected to the GitHub repository.
