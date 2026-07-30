import { LabelTemplate, DatabaseRecord } from '../types';

export const mockRecords: DatabaseRecord[] = [];

export const mockPrinters = [
  { 
    name: 'Microsoft Print to PDF', 
    status: 'Ready' as const, 
    type: 'Virtual Office', 
    dpi: 600,
    paperType: 'dual' as const,
    widthMm: 50,
    heightMm: 30,
    leftMarginMm: 2,
    rightMarginMm: 2,
    middleGapMm: 2
  },
  {
    name: 'Zebra Thermal Printer (Generic)',
    status: 'Ready' as const,
    type: 'Zebra Thermal Label',
    dpi: 203,
    paperType: 'single' as const,
    widthMm: 50,
    heightMm: 30,
    leftMarginMm: 0,
    rightMarginMm: 0,
    middleGapMm: 0
  }
];

export const defaultTemplates: LabelTemplate[] = [];
