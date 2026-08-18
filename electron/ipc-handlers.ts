import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile, exec } from 'child_process';
import { getPythonPort } from './python-bridge';
import { encrypt, decrypt } from './security';

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,
  keepAliveMsecs: 10000,
});

function httpRequest(method: string, url: string, body?: unknown, timeout = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const parsed = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
      timeout,
      agent: httpAgent,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Helper to get Flask base URL
function getBackendUrl(path: string) {
  return `http://127.0.0.1:${getPythonPort()}${path}`;
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  // Window controls
  ipcMain.on('window-minimize', () => {
    mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    mainWindow.close();
  });

  ipcMain.handle('window-is-maximized', () => {
    return mainWindow.isMaximized();
  });

  // Database operations (routed to Python Flask backend)
  ipcMain.handle('db-test', async (_, config) => {
    try { return await httpRequest('POST', getBackendUrl('/api/db/test'), { config }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('db-databases', async (_, config) => {
    try { return await httpRequest('POST', getBackendUrl('/api/db/databases'), { config }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('db-tables', async (_, config) => {
    try { return await httpRequest('POST', getBackendUrl('/api/db/tables'), { config }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('db-columns', async (_, config, table) => {
    try { return await httpRequest('POST', getBackendUrl('/api/db/columns'), { config, table }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('db-query', async (_, config, table, limit) => {
    try { return await httpRequest('POST', getBackendUrl('/api/db/query'), { config, table, limit }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('db-query-record', async (_, config, table, uniqueField, value) => {
    try { return await httpRequest('POST', getBackendUrl('/api/db/query-record'), { config, table, uniqueField, value }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  // Printer operations (routed to Python Flask backend)
  ipcMain.handle('get-printers', async () => {
    try { return await httpRequest('GET', getBackendUrl('/api/printers/list')); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('get-default-printer', async () => {
    try { return await httpRequest('GET', getBackendUrl('/api/printers/default')); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('print-batch', async (_, printerName, records, copies, template, options) => {
    try {
      const quality = options?.quality || 'auto';
      const dpiOverride = options?.dpiOverride;
      const nativeMode = options?.nativeMode !== undefined ? options.nativeMode : true;
      const calibration = options?.calibration;
      return await httpRequest('POST', getBackendUrl('/api/printers/print-batch'), {
        printerName, records, copies, template, quality, dpiOverride, nativeMode, calibration,
      });
    }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('get-printer-capabilities', async (_, printerName) => {
    try { return await httpRequest('GET', getBackendUrl(`/api/printers/capabilities?name=${encodeURIComponent(printerName)}`)); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('test-print', async (_, printerName) => {
    try { return await httpRequest('POST', getBackendUrl('/api/printers/test-print'), { printerName }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('get-printer-status', async (_, printerName) => {
    try { return await httpRequest('GET', getBackendUrl(`/api/printers/status?name=${encodeURIComponent(printerName)}`)); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('poll-gmail', async (_, params) => {
    try { return await httpRequest('POST', getBackendUrl('/api/printers/poll-gmail'), params, 60000); }
    catch (err: any) { return { success: false, error: err.message, logs: [`[FATAL] IPC Bridge Error: ${err.message}`] }; }
  });

  // Dialog operations (native Electron)
  ipcMain.handle('show-open-dialog', async (_, options) => {
    return await dialog.showOpenDialog(mainWindow, options);
  });

  ipcMain.handle('show-save-dialog', async (_, options) => {
    return await dialog.showSaveDialog(mainWindow, options);
  });

  // Export operations (PDF/PNG via Python backend)
  ipcMain.handle('export-pdf', async (_, filename, template, records, copies) => {
    try { return await httpRequest('POST', getBackendUrl('/api/export/pdf'), { filename, template, records, copies }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('export-png', async (_, filename, template, record) => {
    try { return await httpRequest('POST', getBackendUrl('/api/export/png'), { filename, template, record }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  // File system template operations
  ipcMain.handle('save-template-file', async (_, filePath, content) => {
    try {
      // Handle binary PDF saves encoded as base64 with a special prefix
      if (typeof content === 'string' && content.startsWith('__PDF_BASE64__')) {
        const base64 = content.slice('__PDF_BASE64__'.length);
        const buffer = Buffer.from(base64, 'base64');
        await fs.writeFile(filePath, buffer);
      } else {
        let finalContent = content;
        if (filePath.endsWith('.bcs') || filePath.endsWith('.bcsc')) {
          finalContent = encrypt(content);
        }
        await fs.writeFile(filePath, finalContent, 'utf8');
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('read-template-file', async (_, filePath) => {
    try {
      let content = await fs.readFile(filePath, 'utf8');
      if (filePath.endsWith('.bcs') || filePath.endsWith('.bcsc')) {
        content = decrypt(content);
      }
      return { success: true, content };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('get-system-fonts', async () => {
    try { return await httpRequest('GET', getBackendUrl('/api/fonts')); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  // Settings operations (stored locally via Python or local Electron storage)
  ipcMain.handle('get-settings', async () => {
    try { return await httpRequest('GET', getBackendUrl('/api/settings/get')); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('save-settings', async (_, settings) => {
    try { return await httpRequest('POST', getBackendUrl('/api/settings/save'), { settings }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('get-telemetry-status', async () => {
    try { return await httpRequest('GET', getBackendUrl('/api/telemetry/status')); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('update-telemetry', async (_, lock) => {
    try { return await httpRequest('POST', getBackendUrl('/api/telemetry/update'), { lock }); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  ipcMain.handle('sync-telemetry', async () => {
    try { return await httpRequest('POST', getBackendUrl('/api/telemetry/sync')); }
    catch (err: any) { return { success: false, message: err.message }; }
  });

  // WYSIWYG thermal label print: receives jsPDF-generated base64 PDF, writes to temp file,
  // then spools it silently to the named printer using Windows ShellExecute /p verb.
  ipcMain.handle('print-label-pdf', async (_, printerName: string, pdfBase64: string) => {
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `barcode_studio_print_${Date.now()}.pdf`);

    try {
      // Write the base64 PDF to a temp file
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      fssync.writeFileSync(tmpFile, pdfBuffer);

      // On Windows: use PowerShell to print silently to named printer via Adobe/Sumatra/default app
      // Strategy 1: SumatraPDF silent print (if installed)
      // Strategy 2: PowerShell Start-Process with -Verb Print
      // Strategy 3: shell.openPath fallback (opens PDF viewer, user prints manually)

      if (process.platform === 'win32') {
        // Try Sumatra PDF silent print first (most reliable for label printers)
        const sumatraPaths = [
          'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
          'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
          path.join(os.homedir(), 'AppData\\Local\\SumatraPDF\\SumatraPDF.exe'),
        ];

        const sumatraExe = sumatraPaths.find(p => fssync.existsSync(p));

        if (sumatraExe) {
          // SumatraPDF: -print-to "PrinterName" -print-settings "noscale" file.pdf
          await new Promise<void>((resolve, reject) => {
            execFile(
              sumatraExe,
              ['-print-to', printerName, '-print-settings', 'noscale', '-silent', tmpFile],
              { timeout: 30000 },
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          return { success: true, method: 'sumatra' };
        }

        // Fallback: PowerShell Start-Process with -Verb PrintTo targeting named printer
        // This triggers the default PDF handler to print to the specified printer
        const psCmd = `Start-Process -FilePath "${tmpFile.replace(/\\/g, '\\\\')}" -Verb PrintTo -ArgumentList "${printerName.replace(/"/g, '\\"')}" -Wait`;
        await new Promise<void>((resolve, reject) => {
          exec(
            `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${psCmd}"`,
            { timeout: 30000 },
            (err) => {
              // PrintTo verb may return non-zero even on success; treat errors as warnings
              resolve();
            }
          );
        });

        // Give Windows spooler 3s to accept the job before cleaning up
        await new Promise(res => setTimeout(res, 3000));
        return { success: true, method: 'powershell' };
      } else {
        // Non-windows: open with default viewer
        await shell.openPath(tmpFile);
        return { success: true, method: 'open' };
      }
    } catch (err: any) {
      // Final fallback: open in default viewer so user can print manually
      try { await shell.openPath(tmpFile); } catch { }
      return { success: true, method: 'fallback_open', warning: err.message };
    }
    // Note: temp file cleanup is intentionally deferred — spooler needs the file while printing.
    // OS will clean temp files on reboot. Alternatively we could delay-delete after 60s.
  });

  ipcMain.handle('check-updates', async () => {
    try {
      const response = await fetch('https://api.github.com/repos/ishubham1312/BarCode-Studio/releases/latest', {
        headers: { 'User-Agent': 'Barcode-Studio-App' }
      });
      if (response.status === 404) {
        return { success: true, noReleases: true };
      }
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      const data = await response.json();
      return { success: true, release: data };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('download-and-install-update', async (_, downloadUrl: string) => {
    try {
      const tempPath = path.join(os.tmpdir(), 'Barcode-Studio-Setup-Update.exe');

      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download update: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await fs.writeFile(tempPath, buffer);

      // Execute the installer
      exec(`"${tempPath}"`, (err) => {
        if (err) console.error("Failed to run installer:", err);
      });

      // Quit the app after a delay
      setTimeout(() => {
        app.quit();
      }, 1500);

      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      if (url.startsWith('mailto:')) {
        const email = url.replace('mailto:', '').split('?')[0];
        const webGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
        try {
          await shell.openExternal(url);
          return { success: true };
        } catch (err) {
          try {
            await shell.openExternal(webGmailUrl);
            return { success: true };
          } catch (webErr) {
            return { success: false, message: `Failed to open mail client and web Gmail. ${err}` };
          }
        }
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (err: any) {
      if (url.startsWith('mailto:')) {
        const email = url.replace('mailto:', '').split('?')[0];
        const webGmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
        try {
          await shell.openExternal(webGmailUrl);
          return { success: true };
        } catch {
          return { success: false, message: err.message };
        }
      }
      return { success: false, message: err.message };
    }
  });
}

