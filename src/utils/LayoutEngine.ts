export type MediaType = 'continuous' | 'pre-cut' | 'sheet';

export class UnitConverter {
  static getUnitSymbol(unit: string): string {
    switch (unit?.toLowerCase()) {
      case 'cm': return 'cm';
      case 'inch':
      case 'inches':
      case 'in': return 'in';
      case 'mm':
      default: return 'mm';
    }
  }

  static convertMmToUnit(mm: number, unit: string): number {
    if (mm === undefined || mm === null || isNaN(mm)) return 0;
    let val = mm;
    switch (unit?.toLowerCase()) {
      case 'cm':
        val = mm / 10;
        break;
      case 'inch':
      case 'inches':
      case 'in':
        val = mm / 25.4;
        break;
      case 'mm':
      default:
        val = mm;
        break;
    }
    return Math.round(val * 1000) / 1000;
  }

  static convertUnitToMm(val: number, unit: string): number {
    if (val === undefined || val === null || isNaN(val)) return 0;
    let mm = val;
    switch (unit?.toLowerCase()) {
      case 'cm':
        mm = val * 10;
        break;
      case 'inch':
      case 'inches':
      case 'in':
        mm = val * 25.4;
        break;
      case 'mm':
      default:
        mm = val;
        break;
    }
    return Math.round(mm * 1000) / 1000;
  }
}

export class PageSettings {
  mediaType: MediaType;
  width: number; // in mm
  height: number; // in mm (can be 0 or Infinity for continuous)
  marginTop: number; // in mm
  marginBottom: number; // in mm
  marginLeft: number; // in mm
  marginRight: number; // in mm
  isInfiniteHeight: boolean;
  dpi: number | 'auto';

  constructor(init?: Partial<PageSettings>) {
    this.mediaType = init?.mediaType || 'sheet';
    this.width = init?.width ?? 210; // A4 default
    this.height = init?.height ?? 297; // A4 default
    this.marginTop = init?.marginTop ?? 0;
    this.marginBottom = init?.marginBottom ?? 0;
    this.marginLeft = init?.marginLeft ?? 0;
    this.marginRight = init?.marginRight ?? 0;
    this.isInfiniteHeight = init?.isInfiniteHeight ?? (this.mediaType === 'continuous');
    this.dpi = init?.dpi ?? 'auto';
  }
}

export class LabelSettings {
  width: number; // in mm
  height: number; // in mm
  columns: number;
  rows: number; // only relevant for sheet
  gapHorizontal: number; // in mm
  gapVertical: number; // in mm
  cornerRadius: number; // in mm

  constructor(init?: Partial<LabelSettings>) {
    this.width = init?.width ?? 50;
    this.height = init?.height ?? 30;
    this.columns = init?.columns ?? 1;
    this.rows = init?.rows ?? 1;
    this.gapHorizontal = init?.gapHorizontal ?? 0;
    this.gapVertical = init?.gapVertical ?? 0;
    this.cornerRadius = init?.cornerRadius ?? 0;
  }
}

export interface LabelPosition {
  index: number; // 0-based index in queue
  row: number; // 0-based row on page
  column: number; // 0-based col on page
  x: number; // mm from page left
  y: number; // mm from page top
  width: number; // mm
  height: number; // mm
}

export interface PageLayout {
  pageIndex: number;
  labels: LabelPosition[];
}

export interface LayoutPlan {
  pageWidth: number; // in mm
  pageHeight: number; // in mm
  printableWidth: number; // in mm
  printableHeight: number; // in mm
  labelsPerPage: number;
  totalPages: number;
  pages: PageLayout[];
}

export class LayoutEngine {
  static calculateLayout(
    page: PageSettings,
    label: LabelSettings,
    totalLabelsCount: number = 1
  ): LayoutPlan {
    const mediaType = page.mediaType;
    const columns = Math.max(1, label.columns);
    const count = Math.max(1, totalLabelsCount);
    
    let pageWidth = page.width;
    let pageHeight = page.height;
    let printableWidth = Math.max(0, pageWidth - page.marginLeft - page.marginRight);
    let printableHeight = Math.max(0, pageHeight - page.marginTop - page.marginBottom);

    if (mediaType === 'continuous') {
      // Continuous roll
      // Calculate how many rows of labels are needed
      const totalRows = Math.ceil(count / columns);
      
      // Page width is fixed to roll width
      // Page height is dynamic if infinite, or fixed if custom height is specified
      if (page.isInfiniteHeight) {
        pageHeight = page.marginTop + totalRows * label.height + (totalRows > 1 ? (totalRows - 1) * label.gapVertical : 0) + page.marginBottom;
      }
      
      printableHeight = Math.max(0, pageHeight - page.marginTop - page.marginBottom);
      
      const labels: LabelPosition[] = [];
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / columns);
        const col = i % columns;
        const x = page.marginLeft + col * (label.width + label.gapHorizontal);
        const y = page.marginTop + row * (label.height + label.gapVertical);
        labels.push({
          index: i,
          row,
          column: col,
          x,
          y,
          width: label.width,
          height: label.height
        });
      }

      return {
        pageWidth,
        pageHeight,
        printableWidth,
        printableHeight,
        labelsPerPage: count,
        totalPages: 1,
        pages: [{
          pageIndex: 0,
          labels
        }]
      };
    } else if (mediaType === 'pre-cut') {
      // Pre-cut roll label
      // One row of labels per page
      const labelsPerPage = columns;
      const totalPages = Math.ceil(count / labelsPerPage);
      
      // Page height is the height of a single label + margins
      pageHeight = label.height + page.marginTop + page.marginBottom;
      printableHeight = label.height;

      const pages: PageLayout[] = [];
      for (let p = 0; p < totalPages; p++) {
        const labels: LabelPosition[] = [];
        const startIndex = p * labelsPerPage;
        const endIndex = Math.min(count, startIndex + labelsPerPage);
        
        for (let i = startIndex; i < endIndex; i++) {
          const col = i % columns;
          const x = page.marginLeft + col * (label.width + label.gapHorizontal);
          const y = page.marginTop;
          labels.push({
            index: i,
            row: 0,
            column: col,
            x,
            y,
            width: label.width,
            height: label.height
          });
        }
        pages.push({
          pageIndex: p,
          labels
        });
      }

      return {
        pageWidth,
        pageHeight,
        printableWidth,
        printableHeight,
        labelsPerPage,
        totalPages,
        pages
      };
    } else {
      // Sheet labels
      const rows = Math.max(1, label.rows);
      const labelsPerPage = columns * rows;
      const totalPages = Math.ceil(count / labelsPerPage);

      const pages: PageLayout[] = [];
      for (let p = 0; p < totalPages; p++) {
        const labels: LabelPosition[] = [];
        const startIndex = p * labelsPerPage;
        const endIndex = Math.min(count, startIndex + labelsPerPage);

        for (let i = startIndex; i < endIndex; i++) {
          const localIndex = i - startIndex;
          const row = Math.floor(localIndex / columns);
          const col = localIndex % columns;
          const x = page.marginLeft + col * (label.width + label.gapHorizontal);
          const y = page.marginTop + row * (label.height + label.gapVertical);
          labels.push({
            index: i,
            row,
            column: col,
            x,
            y,
            width: label.width,
            height: label.height
          });
        }
        pages.push({
          pageIndex: p,
          labels
        });
      }

      return {
        pageWidth,
        pageHeight,
        printableWidth,
        printableHeight,
        labelsPerPage,
        totalPages,
        pages
      };
    }
  }
}
