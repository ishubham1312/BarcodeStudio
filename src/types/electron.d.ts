export interface ElectronAPI {
  // Window controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  isMaximized: () => Promise<boolean>;

  // Database operations
  dbTest: (config: any) => Promise<{ success: boolean; message: string }>;
  dbDatabases: (config: any) => Promise<{ success: boolean; databases: string[]; message?: string }>;
  dbTables: (config: any) => Promise<{ success: boolean; tables: string[]; views: string[]; message?: string }>;
  dbColumns: (config: any, table: string) => Promise<{ success: boolean; columns: string[]; message?: string }>;
  dbQuery: (config: any, table: string, limit: number) => Promise<{ success: boolean; rows: any[]; message?: string }>;
  dbQueryRecord: (config: any, table: string, uniqueField: string, value: string) => 
    Promise<{ success: boolean; record: any | null; message?: string }>;

  // Printer operations
  getPrinters: () => Promise<{ success: boolean; printers: any[]; message?: string }>;
  getDefaultPrinter: () => Promise<{ success: boolean; name: string; message?: string }>;
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
  ) => Promise<{ success: boolean; count: number; message?: string; driver?: string; dpi?: number; monochrome?: boolean; capabilities?: any }>;
  getPrinterCapabilities: (printerName: string) => Promise<any>;
  testPrint: (printerName: string) => Promise<{ success: boolean; count: number; message?: string }>;
  getPrinterStatus: (printerName: string) => Promise<{ success: boolean; status: string; message?: string }>;
  pollGmail: (params: any) => Promise<{ success: boolean; logs: string[]; error?: string; lastPollTime?: string }>;

  // File and Dialog operations
  showOpenDialog: (options: any) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog: (options: any) => Promise<{ canceled: boolean; filePath?: string }>;

  // Export operations
  exportPDF: (filename: string, template: any, records: any[], copies: number) => 
    Promise<{ success: boolean; path: string; message?: string }>;
  exportPNG: (filename: string, template: any, record: any) => 
    Promise<{ success: boolean; path: string; message?: string }>;

  // Template serialization
  saveTemplateFile: (filePath: string, content: string) => Promise<{ success: boolean; message?: string }>;
  readTemplateFile: (filePath: string) => Promise<{ success: boolean; content: string; message?: string }>;

  // Settings operations
  getSettings: () => Promise<{ success: boolean; settings: any; message?: string }>;
  saveSettings: (settings: any) => Promise<{ success: boolean; message?: string }>;
  getTelemetryStatus: () => Promise<{ success: boolean; locked: boolean; message?: string }>;
  updateTelemetry: (lock: boolean) => Promise<{ success: boolean; locked: boolean; message?: string }>;
  syncTelemetry: () => Promise<{ success: boolean; locked: boolean; message?: string }>;
  printLabelPdf: (printerName: string, pdfBase64: string) => Promise<{ success: boolean; method?: string; warning?: string; message?: string }>;

  // Event deep linking
  onOpenFile: (callback: (filePath: string, content: string) => void) => void;
  onOpenConfigFile: (callback: (filePath: string, content: string) => void) => void;
  getInitialFile: () => Promise<{ filePath: string; content: string } | null>;
  getSystemFonts: () => Promise<{ success: boolean; fonts: string[]; error?: string }>;
  checkUpdates: () => Promise<{ success: boolean; release?: any; noReleases?: boolean; message?: string }>;
  downloadAndInstallUpdate: (downloadUrl: string) => Promise<{ success: boolean; message?: string }>;
  openExternal: (url: string) => Promise<{ success: boolean; message?: string }>;
  restartApp: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
