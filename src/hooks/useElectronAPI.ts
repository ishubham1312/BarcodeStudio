import { useMemo } from 'react';
import { ElectronAPI } from '../types/electron';

// Custom hook to abstract Electron IPC communications and provide web-fallback support.
export function useElectronAPI(): ElectronAPI {
  return useMemo(() => {
    // If running inside Electron desktop shell
    if (window.electronAPI) {
      return window.electronAPI;
    }

    // Web fallback for browser-only development (delegating to server.ts Express endpoints or localStorage)
    console.warn("[Electron API] Running in browser environment. Using HTTP fallbacks.");

    return {
      minimize: () => console.log("[Mock] Minimize window"),
      maximize: () => console.log("[Mock] Maximize window"),
      close: () => console.log("[Mock] Close window"),
      isMaximized: async () => false,

      dbTest: async (config) => {
        const res = await fetch('/api/db/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config })
        });
        return await res.json();
      },
      dbDatabases: async (config) => {
        const res = await fetch('/api/db/databases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config })
        });
        return await res.json();
      },
      dbTables: async (config) => {
        const res = await fetch('/api/db/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config })
        });
        return await res.json();
      },
      dbColumns: async (config, table) => {
        const res = await fetch('/api/db/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, table })
        });
        return await res.json();
      },
      dbQuery: async (config, table, limit) => {
        const res = await fetch('/api/db/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, table, limit })
        });
        return await res.json();
      },
      dbQueryRecord: async (config, table, uniqueField, value) => {
        const res = await fetch('/api/db/query-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, table, uniqueField, value })
        });
        return await res.json();
      },
      dbQueryRecordsBatch: async (config, table, uniqueField, values) => {
        const res = await fetch('/api/db/query-records-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, table, uniqueField, values })
        });
        return await res.json();
      },

      getPrinters: async () => {
        // Fallback mock printers
        return {
          success: true,
          printers: [
            { name: "Microsoft Print to PDF", status: "Ready", type: "Virtual", dpi: 600 },
            { name: "Zebra 1", status: "Ready", type: "Zebra Thermal Label", dpi: 203 }
          ]
        };
      },
      getDefaultPrinter: async () => {
        return { success: true, name: "Microsoft Print to PDF" };
      },
      printBatch: async (printerName, records, copies, template, options) => {
        const quality = options?.quality || 'auto';
        const dpiOverride = options?.dpiOverride;
        console.log(`[Mock Print] Spooling ${records.length * copies} pages to ${printerName} using template ${template?.name} (quality=${quality})`);
        return { success: true, count: records.length * copies, dpi: 600 };
      },
      getPrinterCapabilities: async (printerName: string) => {
        console.log(`[Mock Caps] Detecting capabilities for ${printerName}`);
        const thermal = /zebra|tsc|thermal|label|godex|honeywell|citizen|argox/i.test(printerName || "");
        return {
          success: true,
          name: printerName,
          supportedDpi: thermal ? [203, 300] : [300, 600, 1200],
          maxDpi: thermal ? 300 : 1200,
          minDpi: thermal ? 203 : 300,
          defaultDpi: 300,
          color: !thermal,
          monochrome: thermal,
          isThermal: thermal,
          paperSizeMm: { width: 0, height: 0 },
          printableAreaMm: { width: 0, height: 0 },
          hardwareMarginsMm: { left: 0, top: 0 },
          source: 'mock',
        };
      },
      testPrint: async (printerName) => {
        console.log(`[Mock Print] Spooling calibration test page to ${printerName}`);
        return { success: true, count: 1 };
      },
      getPrinterStatus: async () => {
        return { success: true, status: "Ready" };
      },
      pollGmail: async (params) => {
        const res = await fetch('/api/printers/poll-gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params)
        });
        return await res.json();
      },

      showOpenDialog: async (options) => {
        console.log("[Mock Open Dialog] Config:", options);
        return { canceled: true, filePaths: [] };
      },
      showSaveDialog: async (options) => {
        console.log("[Mock Save Dialog] Config:", options);
        return { canceled: true };
      },

      exportPDF: async (filename) => {
        console.log(`[Mock PDF Export] Saving layout pages into file: ${filename}`);
        return { success: true, path: filename };
      },
      exportPNG: async (filename) => {
        console.log(`[Mock PNG Export] Saving single label preview into file: ${filename}`);
        return { success: true, path: filename };
      },

      saveTemplateFile: async (filePath, content) => {
        console.log(`[Mock Write File] Path: ${filePath}`);
        localStorage.setItem(`template_file_${filePath}`, content);
        return { success: true };
      },
      readTemplateFile: async (filePath) => {
        console.log(`[Mock Read File] Path: ${filePath}`);
        const content = localStorage.getItem(`template_file_${filePath}`) || "";
        return { success: true, content };
      },

      getSettings: async () => {
        const stored = localStorage.getItem("barcode_studio_desktop_settings");
        if (stored) {
          return { success: true, settings: JSON.parse(stored) };
        }
        return { success: false, settings: null };
      },
      saveSettings: async (settings) => {
        localStorage.setItem("barcode_studio_desktop_settings", JSON.stringify(settings));
        return { success: true };
      },

      getTelemetryStatus: async () => {
        const locked = localStorage.getItem("barcode_studio_simulated_lock") === "true";
        return { success: true, locked };
      },
      updateTelemetry: async (lock) => {
        localStorage.setItem("barcode_studio_simulated_lock", lock ? "true" : "false");
        return { success: true, locked: lock };
      },
      syncTelemetry: async () => {
        return { success: true, locked: false };
      },
      printLabelPdf: async (printerName: string, pdfBase64: string) => {
        console.log(`[Mock Print] Would send PDF (${Math.round(pdfBase64.length / 1024)}KB) to printer: ${printerName}`);
        return { success: true, method: 'mock' };
      },

      onOpenFile: () => { },
      onOpenConfigFile: () => { },
      getInitialFile: async () => null,
      getSystemFonts: async () => ({ success: true, fonts: ["Noto Sans", "Noto Sans Devanagari", "Segoe UI", "Inter", "Arial", "Noto Sans UI", "Nirmala UI", "Malgun Gothic", "MS Gothic", "Microsoft YaHei", "Arial Unicode MS"] }),
      checkUpdates: async () => {
        try {
          const response = await fetch("https://api.github.com/repos/ishubham1312/BarCode-Studio/releases/latest");
          if (response.status === 404) {
            return { success: true, noReleases: true };
          }
          if (response.ok) {
            const release = await response.json();
            return { success: true, release };
          }
          return { success: false, message: `GitHub API status ${response.status}` };
        } catch (err: any) {
          return { success: false, message: err.message };
        }
      },
      downloadAndInstallUpdate: async (downloadUrl: string) => {
        console.log(`[Mock Update] Would download from URL: ${downloadUrl}`);
        return { success: true };
      },
      openExternal: async (url: string) => {
        if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
          return await window.electronAPI.openExternal(url);
        }
        if (url.startsWith("mailto:")) {
          const email = url.replace("mailto:", "").split("?")[0];
          const webGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
          try {
            const link = document.createElement("a");
            link.href = url;
            link.target = "_self";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return { success: true };
          } catch (e) {
            window.open(webGmailUrl, "_blank", "noopener,noreferrer");
            return { success: true };
          }
        }
        window.open(url, "_blank", "noopener,noreferrer");
        return { success: true };
      },
      restartApp: async () => {
        if (window.electronAPI && typeof window.electronAPI.restartApp === "function") {
          return await window.electronAPI.restartApp();
        }
        window.location.reload();
      },
    };
  }, []);
}
