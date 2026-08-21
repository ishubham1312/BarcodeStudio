import { contextBridge, ipcRenderer } from 'electron';

// Expose safe Electron APIs to the React renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Window control controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Database operations
  dbTest: (config: any) => ipcRenderer.invoke('db-test', config),
  dbDatabases: (config: any) => ipcRenderer.invoke('db-databases', config),
  dbTables: (config: any) => ipcRenderer.invoke('db-tables', config),
  dbColumns: (config: any, table: string) => ipcRenderer.invoke('db-columns', config, table),
  dbQuery: (config: any, table: string, limit: number) => ipcRenderer.invoke('db-query', config, table, limit),
  dbQueryRecord: (config: any, table: string, uniqueField: string, value: string) => 
    ipcRenderer.invoke('db-query-record', config, table, uniqueField, value),

  // Printer operations
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getDefaultPrinter: () => ipcRenderer.invoke('get-default-printer'),
  printBatch: (
    printerName: string,
    records: any[],
    copies: number,
    template: any,
    options?: {
      quality?: string;
      dpiOverride?: number;
      nativeMode?: boolean;
      calibration?: {
        offsetX: number;
        offsetY: number;
        scaleX: number;
        scaleY: number;
        rotation: number;
      };
    }
  ) => ipcRenderer.invoke('print-batch', printerName, records, copies, template, options),
  getPrinterCapabilities: (printerName: string) => ipcRenderer.invoke('get-printer-capabilities', printerName),
  testPrint: (printerName: string) => ipcRenderer.invoke('test-print', printerName),
  getPrinterStatus: (printerName: string) => ipcRenderer.invoke('get-printer-status', printerName),
  pollGmail: (params: any) => ipcRenderer.invoke('poll-gmail', params),

  // File and Dialog operations
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  
  // Export operations
  exportPDF: (filename: string, template: any, records: any[], copies: number) => 
    ipcRenderer.invoke('export-pdf', filename, template, records, copies),
  exportPNG: (filename: string, template: any, record: any) => 
    ipcRenderer.invoke('export-png', filename, template, record),

  // Template serialization / file systems
  saveTemplateFile: (filePath: string, content: string) => ipcRenderer.invoke('save-template-file', filePath, content),
  readTemplateFile: (filePath: string) => ipcRenderer.invoke('read-template-file', filePath),

  // Settings operations
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getTelemetryStatus: () => ipcRenderer.invoke('get-telemetry-status'),
  updateTelemetry: (lock: boolean) => ipcRenderer.invoke('update-telemetry', lock),
  syncTelemetry: () => ipcRenderer.invoke('sync-telemetry'),
  printLabelPdf: (printerName: string, pdfBase64: string) => ipcRenderer.invoke('print-label-pdf', printerName, pdfBase64),
  
  // Register .bcs file double-click handler / callback
  onOpenFile: (callback: (filePath: string, content: string) => void) => {
    ipcRenderer.on('open-file', (_event, filePath, content) => callback(filePath, content));
  },

  // Register .bcsc config file double-click handler / callback
  onOpenConfigFile: (callback: (filePath: string, content: string) => void) => {
    ipcRenderer.on('open-config-file', (_event, filePath, content) => callback(filePath, content));
  },
  
  // Get initial double-clicked file path if app was closed
  getInitialFile: () => ipcRenderer.invoke('get-initial-file'),
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  downloadAndInstallUpdate: (downloadUrl: string) => ipcRenderer.invoke('download-and-install-update', downloadUrl),
  openExternal: (url: string) => ipcRenderer.invoke('open-external-url', url),
  restartApp: () => ipcRenderer.invoke('restart-app'),
});
