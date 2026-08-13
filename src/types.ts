export type ElementType = 'text' | 'barcode' | 'qrcode' | 'shape' | 'image' | 'line';

export interface LabelElement {
  id: string;
  type: ElementType;
  x: number; // in mm or px (we will use mm as base, mapped to canvas pixels)
  y: number;
  width: number;
  height: number;
  rotation: number; // in degrees
  locked: boolean;
  visible: boolean;
  zValue: number;
  parentId?: string;
  parentSpacing?: number;

  // Text properties
  text?: string;
  fontFamily?: string;
  fontSize?: number; // in pt
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  autoShrink?: boolean;
  smartFit?: boolean;
  wrapText?: boolean;

  // Field binding
  fieldName?: string; // e.g., 'Title', 'AccessionNo', 'Author'
  prefix?: string;
  suffix?: string;

  // Barcode / QR properties
  barcodeType?: 'code128' | 'code39' | 'code93' | 'gs1128' | 'codabar' | 'ean8' | 'ean13' | 'upca' | 'upce' | 'itf' | 'itf14' | 'msi' | 'isbn' | 'issn' | 'qrcode' | string;
  showText?: boolean;
  barHeight?: number;
  barWidth?: number;
  autoSize?: boolean;
  xDimensionMils?: number;
  barcodeDensity?: number;
  barcodeRatio?: string;
  textMargin?: number;

  // Shape properties
  shapeType?: 'rect' | 'ellipse' | 'line';
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export interface LabelTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  marginMm: number;
  elements: LabelElement[];
  uniqueField: string; // The primary lookup field (usually 'AccessionNo')
  lastModified: string;
  shape?: 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'circle';
  orientation?: 'portrait' | 'landscape' | 'portrait-180' | 'landscape-180';
  mirrorImage?: boolean;
  negative?: boolean;
  paddingLeftMm?: number;
  paddingRightMm?: number;
  paddingTopMm?: number;
  paddingBottomMm?: number;

  // Measurement unit and layout settings
  unit?: 'mm' | 'in' | 'cm';
  rows?: number;
  columns?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  setLabelSizeManually?: boolean;
  gapHorizontal?: number;
  gapVertical?: number;
  setGapManually?: boolean;
  startingCorner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  primaryDirection?: 'horizontal' | 'vertical';
  promptForStartNumber?: boolean;
  trackStartNumber?: boolean;
  pageWidthMm?: number;
  pageHeightMm?: number;
  mediaType?: 'continuous' | 'pre-cut' | 'sheet';
  cornerRadiusMm?: number;
  dpi?: number | 'auto';
}

export interface DatabaseRecord {
  AccessionNo: string;
  Title: string;
  Author: string;
  Publisher: string;
  ClassNo: string;
  BookNo: string;
  ISBN: string;
  Edition: string;
  Year: string;
  Price: string;
  Status: string;
  [key: string]: string; // For flexibility
}

export interface Printer {
  name: string;
  status: 'Online' | 'Offline' | 'Ready' | 'Error';
  type: string;
  dpi: number;
  isThermal?: boolean;
  supportedDpi?: number[];
  paperType?: 'single' | 'dual';
  widthMm?: number;
  heightMm?: number;
  leftMarginMm?: number;
  rightMarginMm?: number;
  topMarginMm?: number;
  middleGapMm?: number;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  dbType: 'sqlite' | 'mysql' | 'mssql';
  server: string;
  port?: number;
  instance: string;
  database: string;
  table: string;
  username: string;
  password?: string;
  authMode: 'windows' | 'sql';
  trustCert: boolean;
  encrypt: boolean;
  uniqueField?: string;
  sqlitePath?: string;
  fieldMappings?: Record<string, string>; // Logical field key -> Database physical column name
  customFields?: string[]; // Array of custom logical field keys
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
}

export interface UnitConfig {
  type: 'mm' | 'inch' | 'px';
  scale: number; // pixels per unit
}

export interface RecentFile {
  filePath: string;
  fileName: string;
  templateName: string;
  lastOpened: string;
}

export interface PrintHistoryRecord {
  id: string;
  timestamp: string; // ISO string
  method: "manual" | "email";
  senderEmail?: string;
  accessionNo: string; // Can be comma-separated list of accession numbers printed
  copies: number;
  templates: string[]; // List of template names or IDs used
  printerName: string;
  status: "success" | "failed";
  error?: string;
}
