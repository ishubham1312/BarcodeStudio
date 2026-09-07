import React, { useState, useEffect, useRef, useCallback } from "react";
import { DatabaseRecord, Printer, LabelTemplate, ConnectionProfile, LabelElement, PrintHistoryRecord } from "../types";
import { PageSettings, LabelSettings, LayoutEngine, MediaType } from "../utils/LayoutEngine";
import { getAutoShrunkFontSize, getAutoShrunkWrappedFontSize } from "../utils/textUtils";
import { mockRecords } from "../data/mockData";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import logoUrl from "@/assets/logo.png";

// --- Embedded Barcode Renderer for Print Preview ---
interface BarcodeRendererProps {
  value: string;
  type: string;
  showText: boolean;
  width: number;
  height: number;
  barHeight: number;
  barWidth: number;
  fontSize?: number;
  elementWidthMm: number;
  elementHeightMm: number;
  mmToPx: number;
  autoSize: boolean;
  fontWeight?: string;
  fontStyle?: string;
  textMargin?: number;
}

const BarcodeRenderer: React.FC<BarcodeRendererProps> = ({
  value,
  type,
  showText,
  width,
  height,
  barHeight,
  barWidth,
  fontSize,
  elementWidthMm,
  elementHeightMm,
  mmToPx,
  autoSize,
  fontWeight,
  fontStyle,
  textMargin,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      setError(null);
      let targetFormat = "CODE128";
      let val = value || "123456789";

      if (type === "code39") {
        targetFormat = "CODE39";
      } else if (type === "code93") {
        targetFormat = "CODE128";
      } else if (type === "gs1128") {
        targetFormat = "CODE128";
      } else if (type === "codabar") {
        targetFormat = "CODABAR";
        if (!/^[A-D][0-9\-$./:+]+[A-D]$/.test(val)) val = "A123456B";
      } else if (type === "ean8") {
        targetFormat = "EAN8";
        if (!/^\d{7,8}$/.test(val)) val = "12345670";
      } else if (type === "ean13") {
        targetFormat = "EAN13";
        if (!/^\d{12,13}$/.test(val)) val = "8901234567897";
      } else if (type === "upca") {
        targetFormat = "UPC";
        if (!/^\d{11,12}$/.test(val)) val = "123456789012";
      } else if (type === "upce") {
        targetFormat = "UPCE";
        if (!/^\d{6,8}$/.test(val)) val = "01234565";
      } else if (type === "itf") {
        targetFormat = "ITF";
        if (!/^\d+$/.test(val) || val.length % 2 !== 0) val = "12345678";
      } else if (type === "itf14") {
        targetFormat = "ITF14";
        if (!/^\d{13,14}$/.test(val)) val = "12345678901231";
      } else if (type === "msi") {
        targetFormat = "MSI";
        if (!/^\d+$/.test(val)) val = "123456";
      } else if (type === "isbn") {
        targetFormat = "EAN13";
        if (!/^\d{12,13}$/.test(val)) val = "9788175257665";
        else if (!val.startsWith("978") && !val.startsWith("979"))
          val = "978" + val.slice(0, 10);
      } else if (type === "issn") {
        targetFormat = "EAN13";
        if (!/^\d{12,13}$/.test(val)) val = "9772582118002";
        else if (!val.startsWith("977")) val = "977" + val.slice(0, 10);
      }

      const scale = mmToPx;
      // Match the same font-size-in-px formula used by barcode_service.py
      const font_size_px = (fontSize || 10) * (25.4 / 72.0) * scale;
      // textMargin in pixels — mirrors the text_distance_mm calculation in barcode_service.py
      const base_text_margin_px = (textMargin !== undefined ? textMargin : 1.5) * scale;
      // Extra pixels added by the python-barcode / JsBarcode unit mismatch (keep in sync with backend)
      const extra_px = Math.max(0, font_size_px - (fontSize || 10));
      const text_margin_px = base_text_margin_px + extra_px;

      // Bar height = total element height minus the text row (font + margin) when text is shown.
      // We use floor to guarantee the generated SVG fits within elementHeightMm * scale.
      const bar_height_px = showText
        ? Math.max(5, Math.floor((elementHeightMm * scale) - font_size_px - text_margin_px))
        : (elementHeightMm * scale);
      const module_width_px = (barWidth || 0.35) * scale;

      let fontOptions = "";
      if (fontWeight === "bold" && fontStyle === "italic") {
        fontOptions = "bold italic";
      } else if (fontWeight === "bold") {
        fontOptions = "bold";
      } else if (fontStyle === "italic") {
        fontOptions = "italic";
      }

      const barcodeOpts: any = {
        format: targetFormat,
        displayValue: showText,
        fontSize: font_size_px,
        height: bar_height_px,
        margin: 0,
        background: "transparent",
        textMargin: text_margin_px,
      };
      if (!autoSize) {
        barcodeOpts.width = module_width_px;
      }
      if (fontOptions) {
        barcodeOpts.fontOptions = fontOptions;
      }

      JsBarcode(svgRef.current, val, barcodeOpts);

      const svg = svgRef.current;
      const svgW = svg.getAttribute("width");
      const svgH = svg.getAttribute("height");
      if (svgW && svgH) {
        svg.setAttribute("viewBox", `0 0 ${svgW} ${svgH}`);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        // Always anchor to top-left: bars start at top, text label sits below — no vertical centering
        // that could push the text row outside the element boundary.
        svg.setAttribute("preserveAspectRatio", autoSize ? "none" : "xMidYMin meet");
        svg.style.width = "100%";
        svg.style.height = "100%";
      }
    } catch (err: any) {
      setError(err.message || "Invalid data");
    }
  }, [value, type, showText, barHeight, barWidth, fontSize, elementWidthMm, elementHeightMm, mmToPx, autoSize, fontWeight, fontStyle, textMargin]);

  return (
    <>
      <svg
        ref={svgRef}
        className="w-full h-full object-contain mx-auto"
        style={{ display: error ? "none" : "block" }}
      />
      {error && (
        <div className="w-full h-full bg-red-50 border border-red-200 flex flex-col items-center justify-center p-2 text-center absolute inset-0">
          <span className="text-[9px] font-bold text-red-600 font-mono block">
            Format Error
          </span>
          <span className="text-[8px] text-red-500 leading-none truncate max-w-full" title={error}>
            {error}
          </span>
        </div>
      )}
    </>
  );
};

// --- Embedded QR Renderer for Print Preview ---
interface QRCodeRendererProps {
  value: string;
  width: number;
  height: number;
}

const QRCodeRenderer: React.FC<QRCodeRendererProps> = ({ value, width, height }) => {
  const [qrUrl, setQrUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(value || "DATA", {
      margin: 1,
      width: 150,
      color: {
        dark: "#000000",
        light: "#00000000",
      },
    })
      .then((url) => setQrUrl(url))
      .catch((err) => console.error(err));
  }, [value]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent">
      {qrUrl ? (
        <img
          src={qrUrl}
          alt="QR Code"
          referrerPolicy="no-referrer"
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="w-full h-full bg-slate-50 flex items-center justify-center text-[10px] text-slate-400">
          Generating QR
        </div>
      )}
    </div>
  );
};
import { useElectronAPI } from "../hooks/useElectronAPI";
import {
  X,
  Printer as PrinterIcon,
  CheckCircle2,
  RotateCw,
  Search,
  ArrowLeft,
  ArrowRight,
  Hash,
  Table,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  Tag,
  Check,
  AlertCircle,
  ChevronDown,
  Target,
} from "lucide-react";

export interface AccessionRowItem {
  id: string;
  accessionNumber: string;
  status: 'idle' | 'loading' | 'found' | 'not_found' | 'error';
  records: DatabaseRecord[];
  loading: boolean;
  error?: string | null;
  validationResult?: any;
  requestVersion: number;
}

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRecord: DatabaseRecord | null;
  activePrinter: Printer;
  onLogMessage: (
    lvl: "info" | "warning" | "error" | "success",
    msg: string,
  ) => void;
  template?: LabelTemplate;
  templates?: LabelTemplate[];
  initialAccessionNumbers?: string[];
  autoStart?: boolean;
  theme?: "light" | "dark";
  dbRecords?: DatabaseRecord[];
  activeProfile?: ConnectionProfile | null;
  printers?: Printer[];
  onSelectPrinter?: (printer: Printer) => void;
  printMethod?: "manual" | "email";
  senderEmail?: string;
}

const dbFields = [
  "AccessionNo",
  "Title",
  "Author",
  "Publisher",
  "ClassNo",
  "BookNo",
  "ISBN",
  "Edition",
  "Year",
  "Price",
  "Status",
];

const addPrintHistory = (record: Omit<PrintHistoryRecord, "id" | "timestamp">) => {
  try {
    const savedStr = localStorage.getItem("print_history");
    const historyList: PrintHistoryRecord[] = savedStr ? JSON.parse(savedStr) : [];
    const newRecord: PrintHistoryRecord = {
      id: `h-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: new Date().toISOString(),
      ...record
    };
    historyList.unshift(newRecord);
    if (historyList.length > 5000) {
      historyList.pop();
    }
    localStorage.setItem("print_history", JSON.stringify(historyList));
    window.dispatchEvent(new CustomEvent("print-history-updated"));
  } catch (e) {
    console.error("Failed to save print history:", e);
  }
};

export const resolveElementContent = (
  el: any,
  record: DatabaseRecord | undefined,
  template?: LabelTemplate,
  activeProfile?: ConnectionProfile | null,
): string => {
  if (!record) return el.text || "";

  let effectiveFieldName = el.fieldName ? String(el.fieldName).trim() : "";

  // Barcodes and QR Codes default to AccessionNo if no fieldName is explicitly specified
  if (!effectiveFieldName && (el.type === "barcode" || el.type === "qrcode")) {
    effectiveFieldName = "AccessionNo";
  }

  // Text elements: check if el.text is a field token like [AccessionNo], {acc_no},
  // or if el.text matches a barcode in the same template (companion human-readable text)
  if (!effectiveFieldName && el.type === "text" && el.text) {
    const trimmed = el.text.trim();
    const tokenMatch = trimmed.match(/^[\[{]([a-zA-Z0-9_-]+)[\]}]$/);
    if (tokenMatch) {
      effectiveFieldName = tokenMatch[1];
    } else if (template) {
      const matchingBarcode = template.elements.find(
        (other: any) =>
          other.id !== el.id &&
          (other.type === "barcode" || other.type === "qrcode") &&
          other.text &&
          other.text.trim() === trimmed
      );
      if (matchingBarcode) {
        effectiveFieldName = matchingBarcode.fieldName || "AccessionNo";
      }
    }
  }

  // If a field is bound:
  if (effectiveFieldName) {
    const lower = effectiveFieldName.toLowerCase();
    let dbVal: string | null = null;

    const isValidVal = (v: any): boolean => {
      if (v === undefined || v === null) return false;
      const s = String(v).trim();
      return s !== "" && s.toLowerCase() !== "null" && s.toLowerCase() !== "none";
    };

    // Priority: direct accession key match if field is accession-related
    if (['accessionno', 'acc_no', 'accno', 'accession', 'id', 'barcode'].includes(lower)) {
      if (isValidVal(record.AccessionNo)) {
        dbVal = String(record.AccessionNo).trim();
      } else if (isValidVal(record.acc_no)) {
        dbVal = String(record.acc_no).trim();
      }
    }

    // 1. Direct or case-insensitive key match in record
    if (dbVal === null) {
      for (const key of Object.keys(record)) {
        if (key.toLowerCase() === lower && isValidVal(record[key])) {
          dbVal = String(record[key]).trim();
          break;
        }
      }
    }

    // 2. Check activeProfile fieldMappings (logical -> physical column)
    if (dbVal === null && activeProfile?.fieldMappings) {
      const physCol = activeProfile.fieldMappings[effectiveFieldName] || activeProfile.fieldMappings[lower];
      if (physCol && isValidVal(record[physCol])) {
        dbVal = String(record[physCol]).trim();
      }
    }

    // 3. Fallback check for reverse mapping (physical column -> logical key)
    if (dbVal === null && activeProfile?.fieldMappings) {
      for (const [logicalKey, physCol] of Object.entries(activeProfile.fieldMappings)) {
        if (
          ((physCol as string).toLowerCase() === lower || logicalKey.toLowerCase() === lower) &&
          isValidVal(record[logicalKey])
        ) {
          dbVal = String(record[logicalKey]).trim();
          break;
        }
      }
    }

    // 4. Common field aliases fallback
    if (dbVal === null) {
      const checkKeys = (keys: string[]) => {
        for (const k of keys) {
          for (const rk of Object.keys(record)) {
            if (rk.toLowerCase() === k.toLowerCase() && isValidVal(record[rk])) {
              return String(record[rk]).trim();
            }
          }
        }
        return null;
      };

      if (['acc_no', 'accessionno', 'accno', 'accession', 'id', 'barcode', 'code'].includes(lower)) {
        dbVal = checkKeys(['ACC_NO', 'AccessionNo', 'Acc_No', 'ACCNO', 'accession', 'acc_num', 'accession_no', 'id', 'barcode', 'code']);
      } else if (['title', 'booktitle', 'book_title'].includes(lower)) {
        dbVal = checkKeys(['TITLE', 'BookTitle', 'Book_Title', 'title', 'name']);
      } else if (['author', 'authorname', 'author_name'].includes(lower)) {
        dbVal = checkKeys(['AUTHOR', 'Author', 'AuthorName', 'Author_Name', 'author', 'writer']);
      } else if (['publisher', 'pub_name', 'pubname'].includes(lower)) {
        dbVal = checkKeys(['PUBLISHER', 'Publisher', 'PublisherName', 'pub_name', 'publisher']);
      } else if (['call_no', 'callno', 'class_no', 'classno', 'bookno', 'book_no'].includes(lower)) {
        dbVal = checkKeys(['CALL_NO', 'CallNo', 'ClassNo', 'Class_No', 'BookNo', 'Book_No', 'call_no']);
      } else if (['year', 'pubyear', 'pub_year'].includes(lower)) {
        dbVal = checkKeys(['YEAR', 'Year', 'PubYear', 'Pub_Year', 'year']);
      } else if (['price', 'cost'].includes(lower)) {
        dbVal = checkKeys(['PRICE', 'Price', 'Cost', 'price']);
      } else if (lower === 'isbn') {
        dbVal = checkKeys(['ISBN', 'Isbn', 'isbn']);
      }
    }

    // If dbVal was found and valid, format with prefix and suffix
    if (dbVal !== null && dbVal !== "") {
      return `${el.prefix || ""}${dbVal}${el.suffix || ""}`;
    }

    // If it's a barcode/qrcode and primary accession was not in the specific field, try primary accession
    if (el.type === "barcode" || el.type === "qrcode") {
      const fallbackAcc = record.AccessionNo || record.acc_no || record.id || Object.values(record)[0];
      if (isValidVal(fallbackAcc)) {
        return `${el.prefix || ""}${String(fallbackAcc).trim()}${el.suffix || ""}`;
      }
      return "";
    }

    // When the bound field value is NULL or empty in the database record,
    // do NOT print anything (return empty string so it never falls back to placeholder text)
    return "";
  }

  return el.text || "";
};

export const PrintModal: React.FC<PrintModalProps> = ({
  isOpen,
  onClose,
  activeRecord,
  activePrinter,
  onLogMessage,
  template,
  templates = [],
  initialAccessionNumbers,
  autoStart,
  theme = "dark",
  dbRecords = [],
  activeProfile,
  printers = [],
  onSelectPrinter,
  printMethod = "manual",
  senderEmail,
}) => {
  const electronAPI = useElectronAPI();
  const recordsSource = dbRecords && dbRecords.length > 0 ? dbRecords : mockRecords;
  // Combine single template and templates array
  const allTemplates = React.useMemo(() => {
    const combined = [...templates];
    if (template && !combined.find((t) => t.id === template.id)) {
      combined.push(template);
    }
    return combined;
  }, [template, templates]);

  // Selected templates for printing
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);

  // Local active printer state for temporary overrides, initialized and synchronized with persisted default
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_active_printer");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.name) return parsed;
      }
    } catch (e) { }
    return activePrinter;
  });

  useEffect(() => {
    if (isOpen) {
      try {
        const stored = localStorage.getItem("barcode_studio_active_printer");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.name) {
            const found = printers.find((p) => p.name === parsed.name);
            setSelectedPrinter(found ? { ...found, ...parsed } : parsed);
            return;
          }
        }
      } catch (e) { }
      if (activePrinter) {
        setSelectedPrinter(activePrinter);
      }
    }
  }, [isOpen, activePrinter, printers]);

  // Paper & Layout Selection states (Derived from active template config to ensure correct layout and spacing)
  const activeTemplates = React.useMemo(() => {
    return allTemplates.filter((t) => selectedTemplateIds.includes(t.id));
  }, [allTemplates, selectedTemplateIds]);

  const primaryTemplate = activeTemplates[0] || template;
  const paperType = (primaryTemplate?.columns || 1) === 2 ? "dual" : "single";

  const customWidthMm = primaryTemplate?.widthMm || 50;
  const customHeightMm = primaryTemplate?.heightMm || 30;
  const leftMarginMm = (primaryTemplate?.marginLeft !== undefined && primaryTemplate.marginLeft > 0) ? primaryTemplate.marginLeft : (paperType === "dual" ? 2 : 0);
  const rightMarginMm = (primaryTemplate?.marginRight !== undefined && primaryTemplate.marginRight > 0) ? primaryTemplate.marginRight : (paperType === "dual" ? 2 : 0);
  const middleGapMm = (primaryTemplate?.gapHorizontal !== undefined && primaryTemplate.gapHorizontal > 0) ? primaryTemplate.gapHorizontal : (paperType === "dual" ? 2 : 0);
  const topMarginMm = (primaryTemplate?.marginTop !== undefined && primaryTemplate.marginTop > 0) ? primaryTemplate.marginTop : 0;

  // Dynamically calculate scale factor so the preview fits perfectly on small or large viewports
  const previewScale = React.useMemo(() => {
    const cols = primaryTemplate?.columns || 1;
    const linerW = leftMarginMm + customWidthMm + (cols === 2 ? middleGapMm + customWidthMm : 0) + rightMarginMm;
    if (linerW <= 0) return 4.5;
    const targetW = typeof window !== 'undefined' && window.innerWidth < 768 ? 250 : 450;
    return Math.min(6.5, targetW / linerW);
  }, [primaryTemplate, leftMarginMm, customWidthMm, middleGapMm, rightMarginMm]);

  useEffect(() => {
    // Select all templates by default when modal opens and reset print session states
    if (isOpen) {
      setSelectedTemplateIds(allTemplates.map((t) => t.id));
      setSuccess(false);
      setProgress(0);
      setPrinting(false);
    }
  }, [isOpen, allTemplates]);

  // Printing Rotation state (0°, 90°, 180°, 270°)
  const initialRotation = React.useMemo<0 | 90 | 180 | 270>(() => {
    const o = String(primaryTemplate?.orientation || "").toLowerCase();
    const r = Number(primaryTemplate?.rotation) || 0;
    if (r === 180 || o === "portrait-180" || o === "180" || o === "upside_down" || o === "reverse") return 180;
    if (r === 90 || o === "landscape") return 90;
    if (r === 270 || o === "landscape-180") return 270;
    return 0;
  }, [primaryTemplate]);

  const [printRotation, setPrintRotation] = useState<0 | 90 | 180 | 270>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_print_rotation");
      if (stored !== null) {
        const parsed = parseInt(stored, 10);
        if ([0, 90, 180, 270].includes(parsed)) return parsed as 0 | 90 | 180 | 270;
      }
    } catch (e) { }
    return initialRotation;
  });

  const handleRotationChange = (deg: 0 | 90 | 180 | 270) => {
    setPrintRotation(deg);
    try {
      localStorage.setItem("barcode_studio_print_rotation", String(deg));
    } catch (e) { }
  };

  useEffect(() => {
    if (isOpen) {
      try {
        const stored = localStorage.getItem("barcode_studio_print_rotation");
        if (stored !== null) {
          const parsed = parseInt(stored, 10);
          if ([0, 90, 180, 270].includes(parsed)) {
            setPrintRotation(parsed as 0 | 90 | 180 | 270);
            return;
          }
        }
      } catch (e) { }
      setPrintRotation(initialRotation);
    }
  }, [isOpen, initialRotation]);

  // Printer dropdown state
  const [isPrinterDropdownOpen, setIsPrinterDropdownOpen] = useState(false);
  const printerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (printerDropdownRef.current && !printerDropdownRef.current.contains(e.target as Node)) {
        setIsPrinterDropdownOpen(false);
      }
    };
    if (isPrinterDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isPrinterDropdownOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsPrinterDropdownOpen(false);
    }
  }, [isOpen]);

  // Helper to parse strings like "1234/a1/b2" into base "1234" and abbreviations
  const parseTermAbbreviation = (rawTerm: string) => {
    const parts = rawTerm.split("/");
    const baseTerm = parts[0];
    const abbreviations: { suffix: string; count: number }[] = [];

    if (parts.length > 1) {
      for (let i = 1; i < parts.length; i++) {
        const match = parts[i].match(/^([a-zA-Z]+)(\d*)$/);
        if (match) {
          abbreviations.push({
            suffix: match[1],
            count: match[2] ? parseInt(match[2], 10) : 1,
          });
        }
      }
    }

    if (abbreviations.length === 0) {
      abbreviations.push({ suffix: "", count: 1 });
    }
    return { baseTerm, abbreviations };
  };

  // Helper to split multi-line, comma, or tab separated accession text
  const splitAccessionText = (text: string): string[] => {
    return text
      .split(/[\r\n,;\t]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  // Accession Number Input State & Async Lookup Cache
  const [accessionText, setAccessionText] = useState<string>(() => {
    if (initialAccessionNumbers && initialAccessionNumbers.length > 0) {
      return initialAccessionNumbers.join("\n");
    }
    return "";
  });

  const latestTextRef = useRef(accessionText);
  const wasOpenRef = useRef(false);

  const [lookupResults, setLookupResults] = useState<
    Map<string, { status: "found" | "not_found"; record: DatabaseRecord | null }>
  >(new Map());
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [showMissingWarning, setShowMissingWarning] = useState(false);
  const [nativeMode, setNativeMode] = useState(true);

  // Per-session lookup cache
  const lookupCache = useRef<Map<string, { success: boolean; record: DatabaseRecord | null; rawRow?: any }>>(new Map());
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lookupVersionRef = useRef(0);

  // Helper to discover the actual physical column for accession lookup in the database table
  const getLookupPhysicalField = useCallback((profile: any): string => {
    if (!profile) return "AccessionNo";
    const mappings = profile.fieldMappings || {};
    if (profile.uniqueField && mappings[profile.uniqueField]) {
      return String(mappings[profile.uniqueField]);
    }
    const candidates = [profile.uniqueField, "AccessionNo", "Accession_No", "acc_no", "accno", "barcode", "id"].filter(Boolean);
    for (const cand of candidates) {
      for (const [logKey, physCol] of Object.entries(mappings)) {
        if (logKey.toLowerCase() === cand!.toLowerCase() && physCol) {
          return String(physCol);
        }
      }
    }
    return profile.uniqueField || "AccessionNo";
  }, []);

  // High-performance in-memory lookup index for 0ms instant record retrieval
  // ONLY index unique accession and primary key columns to prevent false prefix/value matches
  const inMemoryRecordsIndex = React.useMemo(() => {
    const map = new Map<string, DatabaseRecord>();
    const list = (dbRecords && dbRecords.length > 0) ? dbRecords : (recordsSource || []);

    const indexRecord = (rec: DatabaseRecord) => {
      if (!rec) return;
      const logicalUniqueKey = activeProfile?.uniqueField || "AccessionNo";
      const physKey = activeProfile?.fieldMappings?.[logicalUniqueKey];

      if (rec[logicalUniqueKey] !== undefined && rec[logicalUniqueKey] !== null) {
        map.set(String(rec[logicalUniqueKey]).trim().toLowerCase(), rec);
      }
      if (physKey && rec[physKey] !== undefined && rec[physKey] !== null) {
        map.set(String(rec[physKey]).trim().toLowerCase(), rec);
      }
      if (rec.AccessionNo !== undefined && rec.AccessionNo !== null) {
        map.set(String(rec.AccessionNo).trim().toLowerCase(), rec);
      }
      if (rec.acc_no !== undefined && rec.acc_no !== null) {
        map.set(String(rec.acc_no).trim().toLowerCase(), rec);
      }
      if (rec.barcode !== undefined && rec.barcode !== null) {
        map.set(String(rec.barcode).trim().toLowerCase(), rec);
      }
      if (rec.id !== undefined && rec.id !== null) {
        map.set(String(rec.id).trim().toLowerCase(), rec);
      }
    };

    if (activeRecord) indexRecord(activeRecord);
    list.forEach(indexRecord);
    return map;
  }, [dbRecords, recordsSource, activeRecord, activeProfile]);

  // Process and validate lookups for all parsed accession terms
  const processLookups = useCallback(
    async (text: string, version: number) => {
      if (version !== lookupVersionRef.current) return;

      const tokens = splitAccessionText(text);
      if (tokens.length === 0) {
        setIsLookingUp(false);
        setLookupResults(new Map());
        return;
      }

      const distinctBaseTerms = [
        ...new Set(tokens.map((t) => parseTermAbbreviation(t).baseTerm).filter(Boolean)),
      ];

      const newResults = new Map<string, { status: "found" | "not_found"; record: DatabaseRecord | null }>();
      const uncachedTerms: string[] = [];

      distinctBaseTerms.forEach((baseTerm) => {
        const cleanTerm = baseTerm.toLowerCase();

        // 1. In-memory check (0ms)
        const memoryMatch = inMemoryRecordsIndex.get(cleanTerm);
        if (memoryMatch) {
          lookupCache.current.set(cleanTerm, { success: true, record: memoryMatch });
          newResults.set(cleanTerm, { status: "found", record: memoryMatch });
          return;
        }

        // 2. Standalone mode (0ms)
        if (!activeProfile) {
          const synthRecord: DatabaseRecord = {
            AccessionNo: baseTerm,
            acc_no: baseTerm,
            Title: "",
            Author: "",
            Publisher: "",
            ClassNo: "",
            BookNo: "",
            ISBN: "",
            Edition: "",
            Year: "",
            Price: "",
            Status: "",
          };
          lookupCache.current.set(cleanTerm, { success: true, record: synthRecord });
          newResults.set(cleanTerm, { status: "found", record: synthRecord });
          return;
        }

        // 3. Check cache
        if (lookupCache.current.has(cleanTerm)) {
          const cached = lookupCache.current.get(cleanTerm)!;
          if (cached.success && cached.record) {
            newResults.set(cleanTerm, { status: "found", record: cached.record });
          } else {
            newResults.set(cleanTerm, { status: "not_found", record: null });
          }
        } else {
          uncachedTerms.push(baseTerm);
        }
      });

      if (version !== lookupVersionRef.current) return;
      setLookupResults((prev) => new Map([...prev, ...newResults]));

      if (uncachedTerms.length > 0 && activeProfile) {
        setIsLookingUp(true);
        const targetTable = activeProfile.table || (activeProfile as any).selectedTable || (activeProfile as any).tableName || "";
        const lookupField = getLookupPhysicalField(activeProfile);

        try {
          await Promise.all(
            uncachedTerms.map(async (baseTerm) => {
              const cleanTerm = baseTerm.toLowerCase();
              try {
                const data = await electronAPI.dbQueryRecord(activeProfile, targetTable, lookupField, baseTerm);
                if (version !== lookupVersionRef.current) return;
                if (data && data.success && data.record) {
                  const rawRow = data.record;
                  const mappedRecord: any = { ...rawRow };
                  const mappings: Record<string, string> = activeProfile.fieldMappings || {};

                  Object.entries(mappings).forEach(([logicalKey, physCol]) => {
                    if (physCol) {
                      if (rawRow[physCol] !== undefined) {
                        mappedRecord[logicalKey] = String(rawRow[physCol]);
                      } else {
                        for (const [k, v] of Object.entries(rawRow)) {
                          if (k.toLowerCase() === physCol.toLowerCase()) {
                            mappedRecord[logicalKey] = String(v ?? "");
                            break;
                          }
                        }
                      }
                    }
                  });

                  const primaryAcc = mappedRecord.AccessionNo || mappedRecord.acc_no || rawRow[lookupField] || baseTerm;
                  mappedRecord.AccessionNo = primaryAcc;
                  mappedRecord.acc_no = primaryAcc;

                  lookupCache.current.set(cleanTerm, { success: true, record: mappedRecord, rawRow: rawRow });
                  newResults.set(cleanTerm, { status: "found", record: mappedRecord });
                } else {
                  lookupCache.current.set(cleanTerm, { success: false, record: null });
                  newResults.set(cleanTerm, { status: "not_found", record: null });
                }
              } catch (e) {
                lookupCache.current.set(cleanTerm, { success: false, record: null });
                newResults.set(cleanTerm, { status: "not_found", record: null });
              }
            })
          );
        } finally {
          if (lookupVersionRef.current === version) {
            setIsLookingUp(false);
            setLookupResults((prev) => new Map([...prev, ...newResults]));
          }
        }
      } else {
        if (lookupVersionRef.current === version) {
          setIsLookingUp(false);
        }
      }
    },
    [inMemoryRecordsIndex, activeProfile, getLookupPhysicalField, electronAPI]
  );

  const handleAccessionTextChange = (text: string) => {
    setAccessionText(text);
    latestTextRef.current = text;
    const newVersion = lookupVersionRef.current + 1;
    lookupVersionRef.current = newVersion;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!activeProfile) {
      processLookups(text, newVersion);
    } else {
      debounceTimerRef.current = setTimeout(() => {
        processLookups(text, newVersion);
      }, 250);
    }
  };

  // Sync / initialize accession numbers input ONLY when modal first opens or initialAccessionNumbers change
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      const initialText = initialAccessionNumbers && initialAccessionNumbers.length > 0
        ? initialAccessionNumbers.join("\n")
        : "";
      setAccessionText(initialText);
      latestTextRef.current = initialText;
      setShowMissingWarning(false);
      const newVersion = lookupVersionRef.current + 1;
      lookupVersionRef.current = newVersion;
      processLookups(initialText, newVersion);
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
  }, [isOpen, initialAccessionNumbers, processLookups]);

  // Reactive Re-check: when in-memory database records arrive or update from App.tsx, re-check using LATEST text
  useEffect(() => {
    if (!isOpen) return;
    const currentText = latestTextRef.current;
    if (!currentText.trim()) return;
    const newVersion = lookupVersionRef.current + 1;
    lookupVersionRef.current = newVersion;
    processLookups(currentText, newVersion);
  }, [inMemoryRecordsIndex, isOpen, processLookups]);

  // Parsed Accession tokens
  const parsedAccessions = React.useMemo(() => {
    return splitAccessionText(accessionText);
  }, [accessionText]);

  // Preview & Print Data: Generate a record for EVERY parsed accession number.
  // If matched in DB, enrich with DB fields (Title, Author, etc.).
  // If DB hasn't loaded yet or not found, generate an immediate fallback record with AccessionNo = finalAcc
  // Preview & Print Data: Only include valid found records or standalone records.
  // Missing records (status === "not_found") are excluded so they cannot be printed.
  const selectedRecords = React.useMemo(() => {
    const records: DatabaseRecord[] = [];
    parsedAccessions.forEach((rawTerm) => {
      const { baseTerm, abbreviations } = parseTermAbbreviation(rawTerm);
      const cached = lookupResults.get(baseTerm.toLowerCase());
      const baseRec = (cached && cached.status === "found" && cached.record) ? cached.record : null;
      const logicalUniqueKey = activeProfile?.uniqueField || "AccessionNo";
      const lookupField = getLookupPhysicalField(activeProfile);

      // If connected to a database profile and confirmed not found, do NOT add to selectedRecords
      if (activeProfile && cached?.status === "not_found") {
        return;
      }

      abbreviations.forEach(({ suffix, count }) => {
        for (let i = 0; i < count; i++) {
          const finalAcc = baseTerm + suffix;
          if (baseRec) {
            records.push({
              ...baseRec,
              AccessionNo: finalAcc,
              acc_no: finalAcc,
              [logicalUniqueKey]: finalAcc,
              [lookupField]: finalAcc,
            });
          } else {
            // Immediate fallback record using entered accession number (for standalone mode or in-flight query)
            records.push({
              AccessionNo: finalAcc,
              acc_no: finalAcc,
              [logicalUniqueKey]: finalAcc,
              [lookupField]: finalAcc,
              Title: "",
              Author: "",
              Publisher: "",
              ClassNo: "",
              BookNo: "",
              ISBN: "",
              Edition: "",
              Year: "",
              Price: "",
              Status: "",
            });
          }
        }
      });
    });
    return records;
  }, [parsedAccessions, lookupResults, activeProfile, getLookupPhysicalField]);

  const missingAccessionNumbers = React.useMemo(() => {
    if (!activeProfile) return [];
    const list: string[] = [];
    parsedAccessions.forEach((rawTerm) => {
      const { baseTerm } = parseTermAbbreviation(rawTerm);
      const cached = lookupResults.get(baseTerm.toLowerCase());
      if (cached && cached.status === "not_found") {
        if (!list.includes(rawTerm)) {
          list.push(rawTerm);
        }
      }
    });
    return list;
  }, [parsedAccessions, lookupResults, activeProfile]);

  const hasEnteredAccessions = React.useMemo(() => {
    return parsedAccessions.length > 0;
  }, [parsedAccessions]);

  // Synchronized scroll ref for paste-all box with highlighted missing terms
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleTextareaScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const top = e.currentTarget.scrollTop;
    const left = e.currentTarget.scrollLeft;
    if (backdropRef.current) {
      backdropRef.current.scrollTop = top;
      backdropRef.current.scrollLeft = left;
    }
    if (overlayRef.current) {
      overlayRef.current.scrollTop = top;
    }
  };

  const handleRemoveLine = useCallback((indexToRemove: number) => {
    const lines = accessionText.split("\n");
    if (indexToRemove >= 0 && indexToRemove < lines.length) {
      lines.splice(indexToRemove, 1);
      const newText = lines.join("\n");
      handleAccessionTextChange(newText);
    }
  }, [accessionText]);

  // Printing Loop animation states
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [printedCount, setPrintedCount] = useState(0);
  const [success, setSuccess] = useState(false);

  // Success state is shown until the user manually dismisses the modal.
  // (Auto-close was removed — it caused the design canvas to appear closed
  //  because the modal disappeared 2 seconds after a successful print.)

  // General Copies
  const [copies, setCopies] = useState<number | "">((() => {
    try {
      const stored = localStorage.getItem("barcode_studio_print_copies");
      if (stored) {
        const val = parseInt(stored, 10);
        if (!isNaN(val) && val >= 1) return val;
      }
    } catch (e) { }
    return 1;
  })());

  const handleCopiesChange = (val: number | "") => {
    setCopies(val);
    if (typeof val === "number" && val >= 1) {
      try {
        localStorage.setItem("barcode_studio_print_copies", String(val));
      } catch (e) { }
    }
  };

  useEffect(() => {
    if (isOpen) {
      try {
        const stored = localStorage.getItem("barcode_studio_print_copies");
        if (stored) {
          const val = parseInt(stored, 10);
          if (!isNaN(val) && val >= 1) {
            setCopies(val);
          }
        }
      } catch (e) { }
    }
  }, [isOpen]);

  // Printer Calibration States
  const [calibOffsetX, setCalibOffsetX] = useState<number>(0);
  const [calibOffsetY, setCalibOffsetY] = useState<number>(0);
  const [calibScaleX, setCalibScaleX] = useState<number>(1.0);
  const [calibScaleY, setCalibScaleY] = useState<number>(1.0);
  const [calibRotation, setCalibRotation] = useState<number>(0);

  // Sync printer calibration settings on printer change (reset to 0 to strictly match canvas design)
  useEffect(() => {
    if (!isOpen || !selectedPrinter?.name) return;
    try {
      localStorage.removeItem("barcode_studio_printer_calibrations");
    } catch (e) { }
    setCalibOffsetX(0);
    setCalibOffsetY(0);
    setCalibScaleX(1.0);
    setCalibScaleY(1.0);
    setCalibRotation(0);
  }, [isOpen, selectedPrinter?.name]);

  const handleCalibChange = (key: string, value: number) => {
    if (!selectedPrinter?.name) return;
    try {
      const stored = localStorage.getItem("barcode_studio_printer_calibrations");
      const calibs = stored ? JSON.parse(stored) : {};

      const currentCalib = calibs[selectedPrinter.name] || {
        offsetX: 0,
        offsetY: 0,
        scaleX: 1.0,
        scaleY: 1.0,
        rotation: 0,
      };

      currentCalib[key] = value;
      calibs[selectedPrinter.name] = currentCalib;
      localStorage.setItem("barcode_studio_printer_calibrations", JSON.stringify(calibs));

      // Update local state
      if (key === "offsetX") setCalibOffsetX(value);
      if (key === "offsetY") setCalibOffsetY(value);
      if (key === "scaleX") setCalibScaleX(value);
      if (key === "scaleY") setCalibScaleY(value);
      if (key === "rotation") setCalibRotation(value);
    } catch (e) { }
  };

  const [printerCaps, setPrinterCaps] = useState<any>(null);

  // Detect printer capabilities (max DPI, colour/mono, printable area)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const loadCaps = async () => {
      try {
        if (window.electronAPI && selectedPrinter?.name) {
          const caps = await electronAPI.getPrinterCapabilities(selectedPrinter.name);
          if (!cancelled && caps) setPrinterCaps(caps);
        }
      } catch (e) {
        // Non-fatal: capabilities are only used to inform the user.
      }
    };

    loadCaps();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedPrinter?.name]);

  // Helper function to generate PDF matching the layout and dimensions with pixel-perfect precision
  const generateLabelPDF = async (
    queue: { template: LabelTemplate; record: DatabaseRecord; index: number }[],
    pType: "single" | "dual",
    wMm: number,
    hMm: number
  ) => {
    const { jsPDF } = await import("jspdf");

    const isDual = pType === "dual";
    let doc: any = null;

    const drawSticker = async (
      currentDoc: any,
      item: { template: LabelTemplate; record: DatabaseRecord; index: number },
      offsetX: number,
      offsetY: number,
      stickerW: number,
      stickerH: number
    ) => {
      const t = item.template;
      const rec = item.record;

      // Create high-resolution canvas (24 pixels per mm = approx 600 DPI for print quality)
      const scale = 24;

      // If the template orientation is landscape, the raw design dimensions are stickerH x stickerW (before rotation).
      // We render at the unrotated size first, then apply rotation in the post-processing phase.
      const isLandscapeRotated = t.orientation === "landscape" || t.orientation === "landscape-180";
      const renderW = isLandscapeRotated ? stickerH : stickerW;
      const renderH = isLandscapeRotated ? stickerW : stickerH;

      let stickerCanvas = document.createElement("canvas");
      stickerCanvas.width = Math.round(renderW * scale);
      stickerCanvas.height = Math.round(renderH * scale);
      const ctx = stickerCanvas.getContext("2d");
      if (!ctx) return;

      // Draw standard white background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, stickerCanvas.width, stickerCanvas.height);

      for (const el of t.elements) {
        if (!el.visible) continue;

        // Auto-shrink / Clamp coordinates inside design canvas boundaries
        let elX = el.x;
        let elY = el.y;
        let elW = el.width;
        let elH = el.height;

        if (elX < 0) {
          elW = Math.max(0.5, elW + elX);
          elX = 0;
        }
        if (elY < 0) {
          elH = Math.max(0.5, elH + elY);
          elY = 0;
        }
        if (elX >= renderW) {
          elX = Math.max(0, renderW - 1);
          elW = 1;
        }
        if (elY >= renderH) {
          elY = Math.max(0, renderH - 1);
          elH = 1;
        }

        if (elX + elW > renderW) {
          elW = Math.max(0.5, renderW - elX);
        }
        if (elY + elH > renderH) {
          elH = Math.max(0.5, renderH - elY);
        }

        const elPixelW = elW * scale;
        const elPixelH = elH * scale;

        const content = resolveElementContent(el, rec, t, activeProfile);
        if (!content || !content.trim()) {
          continue;
        }

        ctx.save();
        // Translate to element's center coordinate space
        ctx.translate((elX + elW / 2) * scale, (elY + elH / 2) * scale);
        if (el.rotation) {
          ctx.rotate((el.rotation * Math.PI) / 180);
        }
        ctx.translate(-elW / 2 * scale, -elH / 2 * scale);

        if (el.type === "barcode") {
          try {
            let targetFormat = "CODE128";
            let val = content || "123456789";
            const bType = el.barcodeType || "code128";

            if (bType === "code39") targetFormat = "CODE39";
            else if (bType === "codabar") {
              targetFormat = "CODABAR";
              if (!/^[A-D][0-9\-$./:+]+[A-D]$/.test(val)) val = "A123456B";
            } else if (bType === "ean8") {
              targetFormat = "EAN8";
              if (!/^\d{7,8}$/.test(val)) val = "12345670";
            } else if (bType === "ean13") {
              targetFormat = "EAN13";
              if (!/^\d{12,13}$/.test(val)) val = "8901234567897";
            } else if (bType === "upca") {
              targetFormat = "UPC";
              if (!/^\d{11,12}$/.test(val)) val = "123456789012";
            } else if (bType === "upce") {
              targetFormat = "UPCE";
              if (!/^\d{6,8}$/.test(val)) val = "01234565";
            } else if (bType === "itf") {
              targetFormat = "ITF";
              if (!/^\d+$/.test(val) || val.length % 2 !== 0) val = "12345678";
            } else if (bType === "msi") {
              targetFormat = "MSI";
              if (!/^\d+$/.test(val)) val = "123456";
            }

            const showText = Boolean(el.showText);
            const font_size_px = (el.fontSize || 10) * (25.4 / 72.0) * scale;
            // textMargin — mirrors the calculation used in BarcodeRenderer & barcode_service.py
            const textMarginMm = el.textMargin !== undefined ? el.textMargin : 1.5;
            const base_text_margin_px = textMarginMm * scale;
            const extra_px = Math.max(0, font_size_px - (el.fontSize || 10));
            const text_margin_px = base_text_margin_px + extra_px;
            // Use floor so the canvas image height never overflows the element boundary
            const bar_height_px = showText
              ? Math.max(5, Math.floor(elPixelH - font_size_px - text_margin_px))
              : elPixelH;

            const estimateBarcodeModules = (t: string, v: string): number => {
              const L = v.length;
              const low = t.toLowerCase();
              if (low.includes("128") || low.includes("gs1")) return 11 * L + 35;
              if (low.includes("39")) return 12 * L + 20;
              if (low.includes("ean13") || low.includes("upca") || low.includes("upc") || low.includes("isbn") || low.includes("issn")) return 95;
              if (low.includes("ean8")) return 67;
              if (low.includes("itf14")) return 150;
              if (low.includes("itf")) return 9 * L + 18;
              if (low.includes("codabar")) return 14 * L + 18;
              return 12 * L + 20;
            };

            const autoSize = el.autoSize !== false;
            let finalBarWidth = el.barWidth || 0.35;
            if (autoSize) {
              const numModules = estimateBarcodeModules(bType, val);
              // Calculate dynamic integer pixel module width that fits inside container
              const moduleWidthPx = Math.max(1, Math.floor(elPixelW / numModules));
              finalBarWidth = moduleWidthPx / scale;
            }

            const module_width_px = Math.max(1, Math.round(finalBarWidth * scale));

            const bcCanvas = document.createElement("canvas");
            JsBarcode(bcCanvas, val, {
              format: targetFormat,
              displayValue: showText,
              fontSize: font_size_px,
              height: bar_height_px,
              width: module_width_px,
              margin: 0,
              background: "transparent",
              textMargin: text_margin_px,
            });

            let drawW = bcCanvas.width;
            let drawH = bcCanvas.height;

            // Clamp height to element bounding box so text never overflows below
            if (drawH > elPixelH) {
              const scaleRatio = elPixelH / drawH;
              drawW = drawW * scaleRatio;
              drawH = elPixelH;
            }

            // Align horizontally inside elPixelW using textAlign (default center)
            const textAlign = el.textAlign || "center";
            let drawX = 0;
            if (textAlign === "left") {
              drawX = 0;
            } else if (textAlign === "right") {
              drawX = Math.max(0, elPixelW - drawW);
            } else {
              drawX = Math.max(0, (elPixelW - drawW) / 2);
            }

            // Top-align: draw from y=0 so bars start at top and text sits below
            // (mirrors preserveAspectRatio="xMidYMin meet" used in the SVG preview)
            const drawY = 0;

            // Draw barcode into element, clipped to element bounds
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, elPixelW, elPixelH);
            ctx.clip();
            ctx.drawImage(bcCanvas, drawX, drawY, drawW, drawH);
            ctx.restore();
          } catch (err) {
            console.error("Error drawing barcode in PDF canvas:", err);
            ctx.fillStyle = "#ff0000";
            ctx.font = "bold 10px sans-serif";
            ctx.fillText("[Barcode Error]", 0, elPixelH / 2);
          }
        } else if (el.type === "qrcode") {
          try {
            const val = content || "DATA";
            const qrUrl = await QRCode.toDataURL(val, { margin: 1, width: 250 });
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
              const i = new Image();
              i.onload = () => resolve(i);
              i.onerror = reject;
              i.src = qrUrl;
            });
            let drawW = elPixelW;
            let drawH = elPixelH;
            const side = Math.min(drawW, drawH);
            const drawX = (elPixelW - side) / 2;
            const drawY = (elPixelH - side) / 2;
            ctx.drawImage(img, drawX, drawY, side, side);
          } catch (err) {
            console.error("Error drawing QR in PDF canvas:", err);
          }
        } else if (el.type === "shape" || el.type === "line") {
          ctx.strokeStyle = el.strokeColor || "#000000";
          ctx.lineWidth = (el.strokeWidth || 1) * 0.8;
          ctx.fillStyle = el.fillColor || "transparent";
          const isEllipse = el.shapeType === "ellipse";
          const isLine = el.type === "line" || el.shapeType === "line";

          ctx.beginPath();
          if (isLine) {
            if (elPixelH > elPixelW) {
              ctx.moveTo(elPixelW / 2, 0);
              ctx.lineTo(elPixelW / 2, elPixelH);
            } else {
              ctx.moveTo(0, elPixelH / 2);
              ctx.lineTo(elPixelW, elPixelH / 2);
            }
          } else if (isEllipse) {
            ctx.ellipse(elPixelW / 2, elPixelH / 2, elPixelW / 2, elPixelH / 2, 0, 0, 2 * Math.PI);
          } else {
            ctx.rect(0, 0, elPixelW, elPixelH);
          }

          if (!isLine && el.fillColor && el.fillColor !== "transparent") {
            ctx.fill();
          }
          ctx.stroke();
        } else if (el.type === "image") {
          if (el.text && el.text.startsWith("data:")) {
            try {
              const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = el.text;
              });
              let drawW = img.width;
              let drawH = img.height;
              if (drawW > elPixelW) {
                const scaleRatio = elPixelW / drawW;
                drawW = elPixelW;
                drawH = drawH * scaleRatio;
              }
              if (drawH > elPixelH) {
                const scaleRatio = elPixelH / drawH;
                drawW = drawW * scaleRatio;
                drawH = elPixelH;
              }
              const drawX = (elPixelW - drawW) / 2;
              const drawY = (elPixelH - drawH) / 2;
              ctx.drawImage(img, drawX, drawY, drawW, drawH);
            } catch (e) {
              console.error("Error drawing image in PDF canvas", e);
            }
          }
        } else {
          // Text element
          ctx.fillStyle = el.textColor || "#000000";

          const fontStyle = el.fontStyle || "normal";
          const fontWeight = el.fontWeight || "normal";
          const baseFontSizePx = (el.fontSize || 10) * (25.4 / 72.0) * scale;
          const fontFamily = el.fontFamily || "Segoe UI";
          const wrapEnabled = (el as any).wrapText === true || el.autoExpand === true;
          const isAutoSizing = el.autoShrink || el.autoExpand;
          const finalFontSizePx = isAutoSizing
            ? getAutoShrunkWrappedFontSize(
              content,
              fontFamily,
              baseFontSizePx,
              elPixelW,
              elPixelH,
              wrapEnabled,
              fontWeight,
              fontStyle,
              Boolean(el.autoExpand),
              Boolean(el.autoShrink)
            )
            : baseFontSizePx;

          const hasHindi = /[\u0900-\u0D7F]/.test(content || "");
          const effectiveFontFamily = hasHindi ? "Noto Sans" : (fontFamily || "Segoe UI");
          ctx.font = `${fontStyle} ${fontWeight} ${finalFontSizePx}px "${effectiveFontFamily}", "Noto Sans", "Noto Sans Devanagari", "Noto Sans UI", "Segoe UI", system-ui, sans-serif`;

          let textX = 0;
          if (el.textAlign === "center") {
            ctx.textAlign = "center";
            textX = elPixelW / 2;
          } else if (el.textAlign === "right") {
            ctx.textAlign = "right";
            textX = elPixelW;
          } else {
            ctx.textAlign = "left";
            textX = scale * 0.4; // 0.4 mm padding
          }

          if (wrapEnabled) {
            ctx.textBaseline = "top";
            const wrapTextCanvas = (
              c: CanvasRenderingContext2D,
              txt: string,
              maxWidth: number
            ): string[] => {
              const maxW = Math.max(1, maxWidth - 8);
              const rawParagraphs = txt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
              const lines: string[] = [];

              for (const para of rawParagraphs) {
                if (!para) {
                  lines.push("");
                  continue;
                }
                const words = para.split(" ");
                let currentLine = "";

                for (let i = 0; i < words.length; i++) {
                  const word = words[i];
                  const testLine = currentLine ? `${currentLine} ${word}` : word;
                  if (c.measureText(testLine).width <= maxW) {
                    currentLine = testLine;
                  } else {
                    if (currentLine) {
                      lines.push(currentLine);
                      currentLine = "";
                    }
                    if (c.measureText(word).width > maxW) {
                      let part = "";
                      for (let ch = 0; ch < word.length; ch++) {
                        const char = word[ch];
                        if (c.measureText(part + char).width <= maxW) {
                          part += char;
                        } else {
                          if (part) lines.push(part);
                          part = char;
                        }
                      }
                      if (part) currentLine = part;
                    } else {
                      currentLine = word;
                    }
                  }
                }
                if (currentLine) lines.push(currentLine);
              }
              return lines.length > 0 ? lines : [txt];
            };

            const wrappedLines = wrapTextCanvas(ctx, content, elPixelW);
            const lineSpacing = 1.30;
            const lineHeight = finalFontSizePx * lineSpacing;
            const totalH = wrappedLines.length * lineHeight;
            const startY = Math.max(0, (elPixelH - totalH) / 2);

            wrappedLines.forEach((line, index) => {
              const lineY = startY + index * lineHeight;
              if (lineY + finalFontSizePx <= elPixelH) {
                ctx.fillText(line, textX, lineY);
              }
            });
          } else {
            ctx.textBaseline = "middle";
            const textY = elPixelH / 2;
            ctx.fillText(content, textX, textY);
          }
        }
        ctx.restore();
      }

      // Apply Sticker-level Transformations: mirror, negative, orientation
      let finalCanvas = stickerCanvas;

      // 1. Mirror Image
      if (t.mirrorImage) {
        const mirrorCanvas = document.createElement("canvas");
        mirrorCanvas.width = finalCanvas.width;
        mirrorCanvas.height = finalCanvas.height;
        const mCtx = mirrorCanvas.getContext("2d");
        if (mCtx) {
          mCtx.scale(-1, 1);
          mCtx.drawImage(finalCanvas, -finalCanvas.width, 0);
          finalCanvas = mirrorCanvas;
        }
      }

      // 2. Negative
      if (t.negative) {
        const nCtx = finalCanvas.getContext("2d");
        if (nCtx) {
          const imgData = nCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];       // R
            data[i + 1] = 255 - data[i + 1]; // G
            data[i + 2] = 255 - data[i + 2]; // B
          }
          nCtx.putImageData(imgData, 0, 0);
        }
      }

      // 3. Printing Rotation (0°, 90°, 180°, 270°)
      const rotAngle = (t.rotation !== undefined ? t.rotation : (t.orientation === "portrait-180" ? 180 : t.orientation === "landscape" ? 90 : t.orientation === "landscape-180" ? 270 : 0)) || printRotation;
      if (rotAngle !== 0) {
        const rotCanvas = document.createElement("canvas");
        const rCtx = rotCanvas.getContext("2d");
        if (rCtx) {
          if (rotAngle === 180) {
            rotCanvas.width = finalCanvas.width;
            rotCanvas.height = finalCanvas.height;
            rCtx.translate(finalCanvas.width, finalCanvas.height);
            rCtx.rotate(Math.PI);
            rCtx.drawImage(finalCanvas, 0, 0);
          } else if (rotAngle === 90) {
            rotCanvas.width = finalCanvas.height;
            rotCanvas.height = finalCanvas.width;
            rCtx.translate(finalCanvas.height, 0);
            rCtx.rotate(Math.PI / 2);
            rCtx.drawImage(finalCanvas, 0, 0);
          } else if (rotAngle === 270) {
            rotCanvas.width = finalCanvas.height;
            rotCanvas.height = finalCanvas.width;
            rCtx.translate(0, finalCanvas.width);
            rCtx.rotate(-Math.PI / 2);
            rCtx.drawImage(finalCanvas, 0, 0);
          }
          finalCanvas = rotCanvas;
        }
      }

      // Generate Data URL and insert into jsPDF
      const finalImgData = finalCanvas.toDataURL("image/png");
      currentDoc.addImage(finalImgData, "PNG", offsetX, offsetY, stickerW, stickerH, undefined, "FAST");
    };

    const t = queue[0]?.template || template;
    const cleanMediaType = t.mediaType || (((t.columns || 1) === 1 && !t.pageHeightMm) ? 'continuous' : 'sheet');
    const cleanColumns = t.columns || 1;
    const cleanRows = t.rows || 1;

    // Swapped visual width and height of physical sticker if printed in landscape
    const isLandscapeRotated = t.orientation === "landscape" || t.orientation === "landscape-180";
    const stickerW = isLandscapeRotated ? (t.heightMm || 30) : (t.widthMm || 50);
    const stickerH = isLandscapeRotated ? (t.widthMm || 50) : (t.heightMm || 30);

    const rawPageW = t.pageWidthMm || ((t.widthMm || 50) * cleanColumns);
    const rawPageH = t.pageHeightMm || ((t.heightMm || 30) * cleanRows);

    // WYSIWYG: if the explicit page width/height equals the bare label dimensions,
    // the paper IS the label (thermal edge-to-edge) → zero out the margins so the
    // label starts at the paper edge, matching the GDI driver and design canvas.
    const labelsRowW = cleanColumns * stickerW + (cleanColumns - 1) * (t.gapHorizontal || 0);
    const edgeToEdgeW = (t.pageWidthMm || 0) > 0 && Math.abs((t.pageWidthMm || 0) - labelsRowW) < 0.5;
    const edgeToEdgeH = (t.pageHeightMm || 0) > 0 && Math.abs((t.pageHeightMm || 0) - stickerH) < 0.5;
    const effMarginLeft = edgeToEdgeW ? 0 : (t.marginLeft || 0);
    const effMarginRight = edgeToEdgeW ? 0 : (t.marginRight || 0);
    const effMarginTop = edgeToEdgeH ? 0 : (t.marginTop || 0);
    const effMarginBottom = edgeToEdgeH ? 0 : (t.marginBottom || 0);

    const pageSettings = new PageSettings({
      mediaType: cleanMediaType as MediaType,
      width: rawPageW,
      height: cleanMediaType === 'continuous' && !t.pageHeightMm ? 0 : rawPageH,
      marginTop: effMarginTop,
      marginBottom: effMarginBottom,
      marginLeft: effMarginLeft,
      marginRight: effMarginRight,
      isInfiniteHeight: cleanMediaType === 'continuous' && !t.pageHeightMm
    });

    const labelSettings = new LabelSettings({
      width: stickerW,
      height: stickerH,
      columns: cleanColumns,
      rows: cleanMediaType === 'sheet' ? cleanRows : 1,
      gapHorizontal: t.gapHorizontal || 0,
      gapVertical: t.gapVertical || 0,
      cornerRadius: t.cornerRadiusMm || 0
    });

    const layoutPlan = LayoutEngine.calculateLayout(pageSettings, labelSettings, queue.length);

    for (let p = 0; p < layoutPlan.pages.length; p++) {
      const page = layoutPlan.pages[p];
      const pageW = layoutPlan.pageWidth;
      const pageH = layoutPlan.pageHeight;

      if (p === 0) {
        doc = new jsPDF({
          orientation: pageW > pageH ? "landscape" : "portrait",
          unit: "mm",
          format: [pageW, pageH],
        });
      } else {
        doc.addPage([pageW, pageH], pageW > pageH ? "landscape" : "portrait");
      }

      for (const lbl of page.labels) {
        const item = queue[lbl.index];
        if (item) {
          await drawSticker(doc, item, lbl.x, lbl.y, lbl.width, lbl.height);
        }
      }
    }

    if (doc) {
      // Return base64 string for programmatic use (physical printing / temp-file-based flow).
      // The caller decides whether to save to disk or send to printer.
      return doc.output('datauristring').split(',')[1]; // base64 only, no header
    }
    return null;
  };

  // Execute Printing Job
  const handlePrintSubmit = () => {
    if (parsedAccessions.length === 0) {
      alert("Please enter at least one accession number.");
      return;
    }

    // STRICT CHECK: Until all records are found, printing is blocked
    if (missingAccessionNumbers.length > 0) {
      alert(
        `Cannot print: ${missingAccessionNumbers.length} accession record(s) not found in the database. Please remove or correct missing records before printing.`
      );
      return;
    }

    if (isLookingUp) {
      alert("Database lookup is in progress. Please wait a moment for records to be verified.");
      return;
    }

    if (selectedRecords.length === 0) {
      alert("No valid accession records were found. Nothing can be printed.");
      return;
    }

    executePrintJob();
  };

  const executePrintJob = async () => {
    if (selectedRecords.length === 0) {
      alert("No valid accession records were found. Nothing can be printed.");
      return;
    }

    setPrinting(true);
    setProgress(0);
    setPrintedCount(0);
    setSuccess(false);

    // Persist active printer and print settings as the default rule for future prints
    if (selectedPrinter) {
      try {
        localStorage.setItem("barcode_studio_active_printer", JSON.stringify(selectedPrinter));
        onSelectPrinter?.(selectedPrinter);
      } catch (e) { }
    }
    try {
      if (typeof copies === "number" && copies >= 1) {
        localStorage.setItem("barcode_studio_print_copies", String(copies));
      }
      localStorage.setItem("barcode_studio_print_rotation", String(printRotation));
    } catch (e) { }

    const safeCopiesExecute = Number(copies) || 1;
    onLogMessage(
      "info",
      `Preparing print job: ${selectedRecords.length} valid records × ${safeCopiesExecute} copies → ${selectedPrinter?.name || ''}...`,
    );

    const activeTemplates = allTemplates.filter((t) => selectedTemplateIds.includes(t.id));

    const resolvedOrientation = printRotation === 180
      ? "portrait-180"
      : printRotation === 90
      ? "landscape"
      : printRotation === 270
      ? "landscape-180"
      : "portrait";

    // Build the print queue: group by record and copies, and interleave templates (A, B, A, B...)
    const queue: { template: LabelTemplate; record: DatabaseRecord; index: number }[] = [];
    let counter = 1;
    selectedRecords.forEach((rec) => {
      for (let c = 0; c < safeCopiesExecute; c++) {
        activeTemplates.forEach((t) => {
          queue.push({
            template: {
              ...t,
              widthMm: customWidthMm,
              heightMm: customHeightMm,
              orientation: resolvedOrientation,
              rotation: printRotation,
            },
            record: rec,
            index: counter++,
          });
        });
      }
    });

    try {
      const isSaveToPDF = selectedPrinter?.name === "Microsoft Print to PDF"
        || selectedPrinter?.name.toLowerCase().includes("pdf");

      if (isSaveToPDF) {
        setProgress(20);

        // Always use the browser-side WYSIWYG PDF renderer — this guarantees exact
        // mm-accurate dual-column layout matching what the user sees in the preview.
        const pdfBase64 = await generateLabelPDF(
          queue,
          paperType,
          customWidthMm,
          customHeightMm
        );

        if (!pdfBase64) {
          onLogMessage("error", "Failed to generate print PDF — empty output.");
          alert("Print failed: could not generate PDF.");
          setPrinting(false);
          return;
        }

        setProgress(60);

        // Save As dialog for virtual PDF printer
        const dialogRes = await electronAPI.showSaveDialog({
          title: "Save PDF Labels",
          defaultPath: "labels.pdf",
          filters: [{ name: "PDF Documents (*.pdf)", extensions: ["pdf"] }]
        });

        if (dialogRes.canceled || !dialogRes.filePath) {
          onLogMessage("warning", "PDF save canceled by user.");
          setPrinting(false);
          return;
        }

        // Decode base64 and write via Electron file API
        const saveRes = await electronAPI.saveTemplateFile(
          dialogRes.filePath,
          // Convert base64 to binary string for writing — use a data URI marker the main process understands
          `__PDF_BASE64__${pdfBase64}`
        );

        const uniqueJobAccessions = Array.from(
          new Set(
            queue
              .map((item) => item.record.AccessionNo || item.record.acc_no || "")
              .map((s) => String(s).trim())
              .filter(Boolean)
          )
        );
        const jobBookCount = uniqueJobAccessions.length > 0 ? uniqueJobAccessions.length : 1;
        const jobAccessionText = uniqueJobAccessions.join(", ");

        if (saveRes.success) {
          setProgress(100);
          setPrintedCount(queue.length);
          onLogMessage("success", `PDF labels saved to ${dialogRes.filePath}`);
          setSuccess(true);
          addPrintHistory({
            method: (initialAccessionNumbers && initialAccessionNumbers.length > 0 ? "email" : "manual") as "manual" | "email",
            senderEmail: (initialAccessionNumbers && initialAccessionNumbers.length > 0) ? (senderEmail || "automation@email.com") : senderEmail,
            accessionNo: jobAccessionText,
            bookCount: jobBookCount,
            copies: jobBookCount,
            totalStickers: queue.length,
            accessionNumbers: uniqueJobAccessions,
            templates: Array.from(new Set(queue.map(item => item.template.name || item.template.id))),
            printerName: "Save to PDF File",
            status: "success"
          });
        } else {
          onLogMessage("error", `PDF save failed: ${saveRes.message}`);
          alert(`Save failed: ${saveRes.message}`);
          addPrintHistory({
            method: (initialAccessionNumbers && initialAccessionNumbers.length > 0 ? "email" : "manual") as "manual" | "email",
            senderEmail: (initialAccessionNumbers && initialAccessionNumbers.length > 0) ? (senderEmail || "automation@email.com") : senderEmail,
            accessionNo: jobAccessionText,
            bookCount: jobBookCount,
            copies: jobBookCount,
            totalStickers: queue.length,
            accessionNumbers: uniqueJobAccessions,
            templates: Array.from(new Set(queue.map(item => item.template.name || item.template.id))),
            printerName: "Save to PDF File",
            status: "failed",
            error: saveRes.message
          });
        }
      } else {
        setProgress(40);
        const primaryTmpl = activeTemplates[0] || template;
        const resolvedColumns = paperType === "dual" ? 2 : (primaryTmpl?.columns || 1);
        const resolvedPageW = resolvedColumns === 2
          ? (leftMarginMm + customWidthMm * 2 + middleGapMm + rightMarginMm)
          : (leftMarginMm + customWidthMm + rightMarginMm);
        const resolvedPageH = customHeightMm + topMarginMm;

        const targetTemplate: LabelTemplate = {
          ...primaryTmpl,
          columns: resolvedColumns,
          widthMm: customWidthMm,
          heightMm: customHeightMm,
          marginLeft: leftMarginMm,
          marginRight: rightMarginMm,
          marginTop: topMarginMm,
          marginBottom: 0,
          gapHorizontal: middleGapMm,
          gapVertical: primaryTmpl?.gapVertical || primaryTmpl?.gapMm || 2.0,
          pageWidthMm: resolvedPageW,
          pageHeightMm: resolvedPageH,
          orientation: resolvedOrientation,
          rotation: printRotation,
        };

        const result = await electronAPI.printBatch(
          selectedPrinter?.name || '',
          queue, // Pass the unified queue of template/record pairs
          1,     // copies are already resolved in the queue
          targetTemplate,
          {
            quality: "auto",
            nativeMode: true,
            calibration: {
              offsetX: 0,
              offsetY: 0,
              scaleX: 1.0,
              scaleY: 1.0,
              rotation: 0,
            }
          }
        );

        const uniqueJobAccessions = Array.from(
          new Set(
            queue
              .map((item) => item.record.AccessionNo || item.record.acc_no || "")
              .map((s) => String(s).trim())
              .filter(Boolean)
          )
        );
        const jobBookCount = uniqueJobAccessions.length > 0 ? uniqueJobAccessions.length : 1;
        const jobAccessionText = uniqueJobAccessions.join(", ");

        setProgress(100);
        setPrintedCount(queue.length);

        if (result.success) {
          onLogMessage(
            "success",
            `Spooled ${queue.length} labels natively using the ${(result as any).driver || "backend"} engine to ${selectedPrinter?.name || ''} @ ${(result as any).dpi || "native"} DPI.`
          );
          setSuccess(true);
          addPrintHistory({
            method: (initialAccessionNumbers && initialAccessionNumbers.length > 0 ? "email" : "manual") as "manual" | "email",
            senderEmail: (initialAccessionNumbers && initialAccessionNumbers.length > 0) ? (senderEmail || "automation@email.com") : senderEmail,
            accessionNo: jobAccessionText,
            bookCount: jobBookCount,
            copies: jobBookCount,
            totalStickers: queue.length,
            accessionNumbers: uniqueJobAccessions,
            templates: Array.from(new Set(queue.map(item => item.template.name || item.template.id))),
            printerName: selectedPrinter?.name || '',
            status: "success"
          });
        } else {
          onLogMessage("error", `Print failed: ${result.message}`);
          alert(`Failed to print: ${result.message}`);
          addPrintHistory({
            method: (initialAccessionNumbers && initialAccessionNumbers.length > 0 ? "email" : "manual") as "manual" | "email",
            senderEmail: (initialAccessionNumbers && initialAccessionNumbers.length > 0) ? (senderEmail || "automation@email.com") : senderEmail,
            accessionNo: jobAccessionText,
            bookCount: jobBookCount,
            copies: jobBookCount,
            totalStickers: queue.length,
            accessionNumbers: uniqueJobAccessions,
            templates: Array.from(new Set(queue.map(item => item.template.name || item.template.id))),
            printerName: selectedPrinter?.name || '',
            status: "failed",
            error: result.message
          });
        }
      }
    } catch (err: any) {
      onLogMessage("error", `Print job failed: ${err.message}`);
      alert(`Print error: ${err.message}`);
    } finally {
      setPrinting(false);
    }
  };

  // Build a calibration template (same size as the active design) with a
  // boundary border, an origin (0,0) crosshair + label, and 10mm grid ticks,
  // then spool it to the printer to verify the GDI physical-offset alignment.
  const handlePrintAlignmentTest = async () => {
    if (!selectedPrinter?.name) {
      onLogMessage("error", "No printer selected for the alignment test.");
      return;
    }

    const W = customWidthMm;
    const H = customHeightMm;
    const calibElements: LabelElement[] = [];
    let z = 1;

    // Boundary border rectangle flush to the paper/label edge
    calibElements.push({
      id: "calib-border",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: W,
      height: H,
      rotation: 0,
      locked: true,
      visible: true,
      zValue: z++,
      fillColor: "transparent",
      strokeColor: "#000000",
      strokeWidth: 0.3,
    });

    // Origin (0,0) crosshair
    calibElements.push({
      id: "calib-origin-h",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: 6,
      height: 0.4,
      rotation: 0,
      locked: true,
      visible: true,
      zValue: z++,
      fillColor: "#000000",
      strokeColor: "#000000",
      strokeWidth: 0,
    });
    calibElements.push({
      id: "calib-origin-v",
      type: "shape",
      shapeType: "rect",
      x: 0,
      y: 0,
      width: 0.4,
      height: 6,
      rotation: 0,
      locked: true,
      visible: true,
      zValue: z++,
      fillColor: "#000000",
      strokeColor: "#000000",
      strokeWidth: 0,
    });
    calibElements.push({
      id: "calib-origin-label",
      type: "text",
      x: 1,
      y: 1,
      width: 12,
      height: 5,
      rotation: 0,
      locked: true,
      visible: true,
      zValue: z++,
      text: "0,0",
      fontFamily: "Segoe UI",
      fontSize: 8,
      fontWeight: "bold",
      fontStyle: "normal",
      textColor: "#000000",
      textAlign: "left",
    });

    // Grid ticks every 10mm along the top and left edges
    for (let m = 10; m < W; m += 10) {
      calibElements.push({
        id: `calib-tick-x-${m}`,
        type: "shape",
        shapeType: "rect",
        x: m,
        y: 0,
        width: 0.3,
        height: 3,
        rotation: 0,
        locked: true,
        visible: true,
        zValue: z++,
        fillColor: "#000000",
        strokeColor: "#000000",
        strokeWidth: 0,
      });
    }
    for (let m = 10; m < H; m += 10) {
      calibElements.push({
        id: `calib-tick-y-${m}`,
        type: "shape",
        shapeType: "rect",
        x: 0,
        y: m,
        width: 3,
        height: 0.3,
        rotation: 0,
        locked: true,
        visible: true,
        zValue: z++,
        fillColor: "#000000",
        strokeColor: "#000000",
        strokeWidth: 0,
      });
    }

    const calibTemplate: LabelTemplate = {
      id: "__calibration__",
      name: "Print Alignment Test",
      widthMm: W,
      heightMm: H,
      marginMm: 0,
      elements: calibElements,
      uniqueField: "AccessionNo",
      lastModified: new Date().toISOString(),
      shape: "rectangle",
      orientation: "portrait",
      mediaType: (primaryTemplate?.mediaType || "continuous") as any,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      pageWidthMm: W,
      pageHeightMm: H,
    };

    onLogMessage(
      "info",
      `Spooling alignment calibration sheet to ${selectedPrinter?.name || ''}...`,
    );
    try {
      const result = await electronAPI.printBatch(
        selectedPrinter?.name || '',
        [{ template: calibTemplate, record: {} }],
        1,
        calibTemplate,
        { quality: "auto" },
      );
      if (result?.success) {
        onLogMessage(
          "success",
          `Alignment test printed to ${selectedPrinter?.name || ''}. Verify the border and ticks align with the paper edge.`,
        );
      } else {
        onLogMessage(
          "error",
          `Alignment test failed: ${result?.message || "unknown error"}`,
        );
      }
    } catch (err: any) {
      onLogMessage("error", `Alignment test error: ${err?.message || err}`);
    }
  };

  const safeCopies = typeof copies === "number" ? copies : 1;
  const totalLabelsToPrint = selectedRecords.length * safeCopies;

  // Build sequential print queue of (template, record) pairs
  const printQueue = React.useMemo(() => {
    const queue: { template: LabelTemplate; record: DatabaseRecord; index: number }[] = [];
    const activeTemplates = allTemplates.filter((t) => selectedTemplateIds.includes(t.id));

    let counter = 1;
    selectedRecords.forEach((rec) => {
      for (let c = 0; c < safeCopies; c++) {
        activeTemplates.forEach((t) => {
          queue.push({ template: t, record: rec, index: counter++ });
        });
      }
    });
    return queue;
  }, [allTemplates, selectedTemplateIds, selectedRecords, safeCopies]);

  // For dual column layout, group queue items into rows of 2
  const printRows = React.useMemo(() => {
    const rows: { rowNumber: number; left?: typeof printQueue[0]; right?: typeof printQueue[0] }[] = [];
    let r = 1;
    for (let i = 0; i < printQueue.length; i += 2) {
      rows.push({
        rowNumber: r++,
        left: printQueue[i],
        right: printQueue[i + 1],
      });
    }
    return rows;
  }, [printQueue]);

  // Print Preview: show last entered number on top (first-in-first-out 180° rotated preview order)
  // Physical printing remains strictly in the original entered sequence.
  const previewQueue = React.useMemo(() => {
    return [...printQueue].reverse();
  }, [printQueue]);

  const previewRows = React.useMemo(() => {
    return [...printRows].reverse();
  }, [printRows]);

  // Render Label Preview Elements based on active record
  const renderLiveElement = (
    el: any,
    record: DatabaseRecord,
    itemTemplate: LabelTemplate | undefined,
    mmToPx: number = 2.4,
  ) => {
    if (!el.visible) return null;

    const activeT = itemTemplate || template;
    if (!activeT) return null;
    const templateW = activeT.widthMm;
    const templateH = activeT.heightMm;

    // Clamp / shrink coordinates to fit inside the canvas boundaries
    let elX = el.x;
    let elY = el.y;
    let elW = el.width;
    let elH = el.height;

    if (elX < 0) {
      elW = Math.max(0.5, elW + elX);
      elX = 0;
    }
    if (elY < 0) {
      elH = Math.max(0.5, elH + elY);
      elY = 0;
    }
    if (elX >= templateW) {
      elX = Math.max(0, templateW - 1);
      elW = 1;
    }
    if (elY >= templateH) {
      elY = Math.max(0, templateH - 1);
      elH = 1;
    }

    if (elX + elW > templateW) {
      elW = Math.max(0.5, templateW - elX);
    }
    if (elY + elH > templateH) {
      elH = Math.max(0.5, templateH - elY);
    }

    const style: React.CSSProperties = {
      position: "absolute",
      left: `${elX * mmToPx}px`,
      top: `${elY * mmToPx}px`,
      width: `${elW * mmToPx}px`,
      height: `${elH * mmToPx}px`,
      transform: `rotate(${el.rotation || 0}deg)`,
      transformOrigin: "center center",
    };

    const content = resolveElementContent(el, record, itemTemplate, activeProfile);
    if (!content || !content.trim()) {
      return null;
    }

    if (el.type === "barcode") {
      return (
        <div key={el.id} style={{ ...style, overflow: "hidden" }} className="w-full h-full relative bg-white select-none">
          <BarcodeRenderer
            value={content}
            type={el.barcodeType || "code128"}
            showText={Boolean(el.showText)}
            width={elW * mmToPx}
            height={elH * mmToPx}
            barHeight={el.barHeight || 50}
            barWidth={el.barWidth || 0.35}
            fontSize={el.fontSize}
            elementWidthMm={elW}
            elementHeightMm={elH}
            mmToPx={mmToPx}
            autoSize={el.autoSize !== false}
            fontWeight={el.fontWeight}
            fontStyle={el.fontStyle}
            textMargin={el.textMargin}
          />
        </div>
      );
    }

    if (el.type === "qrcode") {
      return (
        <div key={el.id} style={style} className="w-full h-full relative overflow-hidden select-none">
          <QRCodeRenderer
            value={content}
            width={elW * mmToPx}
            height={elH * mmToPx}
          />
        </div>
      );
    }

    if (el.type === "line" || (el.type === "shape" && el.shapeType === "line")) {
      const isVertical = elH > elW;
      return (
        <div
          key={el.id}
          className="w-full h-full select-none flex items-center justify-center"
          style={style}
        >
          <div
            style={{
              width: isVertical ? "0px" : "100%",
              height: isVertical ? "100%" : "0px",
              borderTop: isVertical ? "none" : `${el.strokeWidth || 1}px solid ${el.strokeColor || "#000000"}`,
              borderLeft: isVertical ? `${el.strokeWidth || 1}px solid ${el.strokeColor || "#000000"}` : "none",
            }}
          />
        </div>
      );
    }

    if (el.type === "shape") {
      const isEllipse = el.shapeType === "ellipse";
      return (
        <div key={el.id} style={style} className="select-none">
          <div
            className="w-full h-full"
            style={{
              backgroundColor: el.fillColor || "#ffffff",
              border: `${el.strokeWidth || 1}px solid ${el.strokeColor || "#000000"}`,
              borderRadius: isEllipse ? "50%" : "0px",
            }}
          />
        </div>
      );
    }

    if (el.type === "image") {
      return (
        <div key={el.id} style={style} className="w-full h-full flex items-center justify-center select-none">
          {el.text ? (
            <img
              src={el.text}
              alt="Uploaded"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="w-full h-full bg-slate-100 border border-slate-300 flex items-center justify-center text-[10px] text-slate-400">
              No Image Loaded
            </div>
          )}
        </div>
      );
    }

    // Default: text element
    const alignClass =
      el.textAlign === "center"
        ? "justify-center"
        : el.textAlign === "right"
          ? "justify-end"
          : "justify-start";
    const baseFontSizePx = (el.fontSize || 10) * (25.4 / 72.0) * mmToPx;
    const hasHindi = /[\u0900-\u0D7F]/.test(content || "");
    const effectiveFontFamily = hasHindi ? "Noto Sans" : (el.fontFamily || "Segoe UI");
    const wrapEnabled = (el as any).wrapText === true || el.autoExpand === true;
    const isAutoSizing = el.autoShrink || el.autoExpand;
    const finalFontSizePx = isAutoSizing
      ? getAutoShrunkWrappedFontSize(
        content,
        effectiveFontFamily,
        baseFontSizePx,
        elW * mmToPx,
        elH * mmToPx,
        wrapEnabled,
        el.fontWeight,
        el.fontStyle,
        Boolean(el.autoExpand),
        Boolean(el.autoShrink)
      )
      : baseFontSizePx;

    return (
      <div
        key={el.id}
        style={{
          ...style,
          fontFamily: `"${effectiveFontFamily}", "Noto Sans", "Noto Sans Devanagari", "Noto Sans UI", "Segoe UI", sans-serif`,
          fontSize: `${finalFontSizePx}px`,
          fontWeight: el.fontWeight || "normal",
          fontStyle: el.fontStyle || "normal",
          color: el.textColor || "#000000",
          display: "flex",
          alignItems: "center",
          lineHeight: 1.25,
          whiteSpace: wrapEnabled ? "pre-wrap" : "nowrap",
          wordBreak: wrapEnabled ? "break-word" : "normal",
          width: wrapEnabled ? "100%" : "max-content",
          overflow: wrapEnabled ? "hidden" : "visible",
        }}
        className={`${alignClass} select-none px-1`}
      >
        {content}
      </div>
    );
  };

  if (!isOpen) return null;

  const isLight = theme === "light";

  return (
    <div className={`fixed inset-0 ${isLight ? 'bg-slate-900/40' : 'bg-black/85'} backdrop-blur-md flex items-center justify-center z-[100] p-4 select-none animate-fade-in font-sans`}>
      <div className={`${isLight ? 'bg-white border-slate-200 shadow-[0_25px_60px_rgba(0,0,0,0.18)]' : 'bg-[#0e111a] border-indigo-500/20 shadow-[0_0_80px_rgba(0,0,0,0.7)]'} border rounded-3xl w-full max-w-5xl overflow-hidden flex flex-col h-[88vh] max-h-[780px] transition-all`}>
        {/* Modal Title Header */}
        <div className={`px-6 py-4 ${isLight ? 'bg-slate-50/80 border-slate-200' : 'bg-[#121624] border-slate-800'} border-b flex items-center justify-between shrink-0`}>
          <div className="flex items-center gap-3.5">
            <img
              src={logoUrl}
              alt="BarCode Studio Logo"
              className="w-11 h-11 object-contain shrink-0 select-none drop-shadow-xs"
            />
            <div>
              <h3 className={`font-black text-base ${isLight ? 'text-slate-900' : 'text-slate-100'} tracking-tight flex items-center gap-2`}>
                Barcode Label Printer
              </h3>
              <p className={`text-[11px] ${isLight ? 'text-slate-600' : 'text-slate-400'} font-medium tracking-wide`}>
                Configure layout, check record mappings, and run print spoolers.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={printing}
            className={`p-2 rounded-xl ${isLight ? 'hover:bg-slate-200/70 text-slate-500 hover:text-slate-800' : 'hover:bg-slate-800 text-slate-400 hover:text-white'} transition-all disabled:opacity-40 cursor-pointer border border-transparent`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Main Content Workspace */}
        {!printing && !success && (
          <div className={`flex-1 flex overflow-hidden min-h-0 ${isLight ? 'bg-slate-100/60' : 'bg-[#090b11]'}`}>
            {/* LEFT AREA: Sourcing configuration */}
            <div className={`w-[360px] p-4 border-r ${isLight ? 'bg-white border-slate-200' : 'bg-[#0e111a] border-slate-800'} flex flex-col gap-4 shrink-0 z-10 overflow-y-auto custom-scrollbar`}>

              {/* Accession Numbers Section */}
              <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-3.5 space-y-2.5 shadow-xs`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Hash className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
                    <span className={`text-xs font-bold tracking-tight truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                      Accession Numbers
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isLookingUp && (
                      <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />
                    )}
                    {missingAccessionNumbers.length > 0 && (
                      <span className={`inline-flex items-center text-[9px] px-2 py-0.5 rounded-full font-mono font-bold whitespace-nowrap ${isLight ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-red-500/15 border border-red-500/30 text-red-300'}`}>
                        {missingAccessionNumbers.length} Missing
                      </span>
                    )}
                    <span className={`inline-flex items-center text-[9px] px-2 py-0.5 rounded-full font-mono font-bold whitespace-nowrap ${isLight ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'}`}>
                      {parsedAccessions.length} {parsedAccessions.length === 1 ? 'Item' : 'Items'}
                    </span>

                    {accessionText.trim() && (
                      <button
                        type="button"
                        onClick={() => handleAccessionTextChange('')}
                        title="Clear all"
                        className={`p-1 rounded-lg transition-colors cursor-pointer ${
                          isLight ? 'hover:bg-slate-200/70 text-slate-400 hover:text-slate-700' : 'hover:bg-slate-800 text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Simple Multi-Line Paste-All Box with Row Highlight & Delete Actions */}
                <div className={`relative rounded-xl border transition-all h-44 overflow-hidden ${
                  isLight
                    ? 'border-slate-300 bg-white focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-500/15 shadow-xs'
                    : 'border-slate-700/80 bg-[#0e1220] focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 shadow-xs'
                }`}>
                  {/* Layer 1: Row Highlights (Starts from left corner, ends at right corner fading) */}
                  <div
                    ref={backdropRef}
                    aria-hidden="true"
                    className="absolute inset-0 overflow-hidden pointer-events-none select-none"
                    style={{
                      paddingTop: '10px',
                      paddingBottom: '10px',
                    }}
                  >
                    {(accessionText ? accessionText.split("\n") : []).map((line, lineIdx) => {
                      const clean = line.trim();
                      const { baseTerm } = parseTermAbbreviation(clean);
                      const cached = lookupResults.get(baseTerm.toLowerCase());
                      const isMissing = Boolean(
                        clean &&
                        activeProfile &&
                        (cached?.status === "not_found" || missingAccessionNumbers.some((m) => line.includes(m)))
                      );

                      return (
                        <div
                          key={lineIdx}
                          style={{ height: '24px' }}
                          className={`w-full transition-colors flex items-center ${
                            isMissing
                              ? isLight
                                ? "bg-gradient-to-r from-red-200/90 via-red-100/35 to-transparent border-l-4 border-red-500"
                                : "bg-gradient-to-r from-red-500/35 via-red-500/15 to-transparent border-l-4 border-red-500"
                              : "border-l-4 border-transparent"
                          }`}
                        />
                      );
                    })}
                  </div>

                  {/* Layer 2: Native Multi-Line Textarea */}
                  <textarea
                    ref={textareaRef}
                    value={accessionText}
                    onChange={(e) => handleAccessionTextChange(e.target.value)}
                    onScroll={handleTextareaScroll}
                    placeholder={"Enter or paste accession numbers..."}
                    spellCheck={false}
                    className={`relative z-10 w-full h-full text-xs font-mono font-bold bg-transparent outline-none resize-none custom-scrollbar border-0 block whitespace-pre ${
                      isLight ? 'text-slate-900 placeholder-slate-400' : 'text-slate-100 placeholder-slate-500'
                    }`}
                    style={{
                      lineHeight: '24px',
                      paddingTop: '10px',
                      paddingBottom: '10px',
                      paddingLeft: '14px',
                      paddingRight: '36px',
                      boxSizing: 'border-box',
                    }}
                  />

                  {/* Layer 3: Overlay with clickable cross buttons on the right corner of missing lines */}
                  <div
                    ref={overlayRef}
                    aria-hidden="true"
                    className="absolute inset-0 overflow-hidden pointer-events-none z-20"
                    style={{
                      paddingTop: '10px',
                      paddingBottom: '10px',
                      paddingRight: '8px',
                    }}
                  >
                    {(accessionText ? accessionText.split("\n") : []).map((line, lineIdx) => {
                      const clean = line.trim();
                      const { baseTerm } = parseTermAbbreviation(clean);
                      const cached = lookupResults.get(baseTerm.toLowerCase());
                      const isMissing = Boolean(
                        clean &&
                        activeProfile &&
                        (cached?.status === "not_found" || missingAccessionNumbers.some((m) => line.includes(m)))
                      );

                      return (
                        <div
                          key={lineIdx}
                          style={{ height: '24px' }}
                          className="w-full flex items-center justify-end"
                        >
                          {isMissing && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveLine(lineIdx);
                              }}
                              title={`Remove ${clean}`}
                              className="pointer-events-auto p-0.5 rounded text-red-500 hover:text-red-700 hover:bg-red-200/70 dark:text-red-400 dark:hover:text-red-200 dark:hover:bg-red-500/35 transition-all cursor-pointer shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Status Indicator & Missing Banner */}
                <div className="space-y-1.5 pt-0.5">
                  {missingAccessionNumbers.length > 0 ? (
                    <div className={`p-2.5 rounded-xl border flex flex-col gap-1.5 ${
                      isLight
                        ? "bg-red-50 border-red-200 text-red-900 shadow-xs"
                        : "bg-red-500/10 border-red-500/30 text-red-200 shadow-xs"
                    }`}>
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                        <span>{missingAccessionNumbers.length} record(s) not found in database</span>
                      </span>
                    </div>
                  ) : selectedRecords.length > 0 ? (
                    <div className="flex items-center justify-between text-[10px] px-1">
                      <span className={`font-bold flex items-center gap-1.5 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isLight ? 'bg-emerald-600' : 'bg-emerald-400'} inline-block animate-pulse`}></span>
                        <span>{selectedRecords.length} records found & ready to print</span>
                      </span>
                    </div>
                  ) : parsedAccessions.length > 0 && selectedRecords.length === 0 && !isLookingUp ? (
                    <div className={`text-[10px] font-semibold flex items-center gap-1.5 px-1 ${isLight ? 'text-red-600' : 'text-red-400'}`}>
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>No valid records found in database</span>
                    </div>
                  ) : (
                    <div className={`text-[10px] font-medium px-1 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                      Type or paste accession numbers (one per line)
                    </div>
                  )}
                </div>
              </div>

              {/* Templates Selection Section */}
              {allTemplates.length > 0 && (
                <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-3.5 space-y-2.5 shadow-xs`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className={`w-3.5 h-3.5 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
                      <span className={`text-[11px] font-extrabold uppercase tracking-wider font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                        Selected Templates
                      </span>
                    </div>
                    <span className={`text-[8.5px] px-2 py-0.5 rounded-full font-mono font-bold ${isLight ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'}`}>
                      {selectedTemplateIds.length}/{allTemplates.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto pr-1 custom-scrollbar">
                    {allTemplates.map((t) => {
                      const isSelected = selectedTemplateIds.includes(t.id);
                      return (
                        <label
                          key={t.id}
                          className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-all border ${isSelected
                            ? isLight
                              ? "bg-indigo-50/80 border-indigo-300 text-indigo-950 shadow-xs"
                              : "bg-indigo-500/15 border-indigo-500/40 text-indigo-200 shadow-xs"
                            : isLight
                              ? "bg-white border-slate-200 hover:bg-slate-100/70 text-slate-700"
                              : "bg-[#161b2d] border-slate-700 hover:bg-slate-800 text-slate-300"
                            }`}
                        >
                          <div className="relative flex items-center justify-center shrink-0">
                            <input
                              type="checkbox"
                              className="absolute opacity-0 w-full h-full cursor-pointer"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTemplateIds((prev) => [...prev, t.id]);
                                } else {
                                  setSelectedTemplateIds((prev) =>
                                    prev.filter((id) => id !== t.id),
                                  );
                                }
                              }}
                            />
                            <div className={`w-4 h-4 rounded-md border transition-all flex items-center justify-center ${isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                              : isLight ? 'border-slate-300 bg-slate-100' : 'border-slate-700 bg-black/20'}`}>
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className={`text-[11px] font-bold truncate leading-tight ${isSelected
                              ? isLight ? "text-indigo-900" : "text-indigo-200"
                              : isLight ? "text-slate-800" : "text-slate-200"
                              }`}>
                              {t.name}
                            </span>
                            <span className={`text-[8.5px] font-mono mt-0.5 ${isLight ? "text-slate-500" : "text-slate-400"}`}>
                              {t.widthMm}x{t.heightMm} mm • {t.elements.length} components
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Target Printer Dropdown Section */}
              <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-2.5 space-y-2 shadow-xs`}>
                <div className="flex items-center justify-between px-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <PrinterIcon className={`w-3.5 h-3.5 shrink-0 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
                    <span className={`text-[10.5px] font-extrabold uppercase tracking-wider font-mono truncate ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                      Printer
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className={`text-[9px] font-mono font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      {selectedPrinter?.status || "Ready"} · {printerCaps?.maxDpi || 300} DPI
                    </span>
                  </div>
                </div>

                <div className="relative" ref={printerDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsPrinterDropdownOpen((prev) => !prev)}
                    className={`w-full flex items-center justify-between gap-2 ${
                      isLight
                        ? 'bg-white border-slate-300 hover:border-indigo-400 hover:bg-slate-50/80 text-slate-800 shadow-xs'
                        : 'bg-[#121624] border-slate-700/90 hover:border-indigo-500/60 hover:bg-[#161b2d] text-slate-100 shadow-xs'
                    } ${isPrinterDropdownOpen ? (isLight ? 'border-indigo-500 ring-2 ring-indigo-500/15' : 'border-indigo-500 ring-2 ring-indigo-500/25') : ''} border rounded-xl px-2.5 py-1.5 text-xs outline-none cursor-pointer transition-all font-bold select-none`}
                  >
                    <span className="truncate flex-1 text-left">
                      {selectedPrinter?.name || "Select Printer"}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isPrinterDropdownOpen ? 'rotate-180 text-indigo-500' : isLight ? 'text-slate-400' : 'text-slate-500'}`} />
                  </button>

                  {/* Floating Custom Dropdown Menu */}
                  {isPrinterDropdownOpen && (
                    <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-xl p-1 shadow-2xl border ${
                      isLight
                        ? 'bg-white border-slate-200/90 shadow-slate-300/60'
                        : 'bg-[#151928] border-slate-700 shadow-black/80'
                    } max-h-48 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-100`}>
                      {printers.length === 0 ? (
                        <div className="p-2.5 text-center text-xs text-slate-400 font-medium">
                          No printers detected
                        </div>
                      ) : (
                        printers.map((p) => {
                          const isSelected = p.name === selectedPrinter?.name;

                          return (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => {
                                setSelectedPrinter(p);
                                try {
                                  localStorage.setItem("barcode_studio_active_printer", JSON.stringify(p));
                                } catch (e) { }
                                onSelectPrinter?.(p);
                                setIsPrinterDropdownOpen(false);
                              }}
                              className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-all cursor-pointer ${
                                isSelected
                                  ? isLight
                                    ? "bg-indigo-50 text-indigo-900 font-bold"
                                    : "bg-indigo-500/20 text-indigo-200 font-bold"
                                  : isLight
                                    ? "hover:bg-slate-100 text-slate-700 font-medium"
                                    : "hover:bg-slate-800/70 text-slate-300 font-medium"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <PrinterIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? (isLight ? "text-indigo-600" : "text-indigo-400") : (isLight ? "text-slate-400" : "text-slate-500")}`} />
                                <span className="truncate">{p.name}</span>
                              </div>
                              {isSelected && (
                                <Check className={`w-3.5 h-3.5 stroke-[2.5] shrink-0 ${isLight ? "text-indigo-600" : "text-indigo-400"}`} />
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Volume Settings Section */}
              <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-3.5 mt-auto shadow-xs`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 ${isLight ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'} rounded-lg`}>
                      <Layers className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[10.5px] font-extrabold uppercase font-mono tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                        Volume Copies
                      </span>
                      <span className={`text-[8.5px] font-mono mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        {selectedRecords.length * (Number(copies) || 1)} labels spooling
                      </span>
                    </div>
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={copies}
                    onChange={(e) =>
                      handleCopiesChange(
                        e.target.value === ""
                          ? ""
                          : Math.max(1, parseInt(e.target.value) || 1),
                      )
                    }
                    className={`w-16 ${isLight ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600' : 'bg-[#161b2d] border-slate-700 text-slate-100 focus:border-indigo-500'} border rounded-lg px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-indigo-500/50 font-mono font-black text-center shadow-xs`}
                  />
                </div>
              </div>

              {/* Printing Rotation Section */}
              <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-3.5 shadow-xs space-y-2`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 ${isLight ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'} rounded-lg`}>
                      <RotateCw className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-[10.5px] font-extrabold uppercase font-mono tracking-wider ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                        Printing Rotation
                      </span>
                      <span className={`text-[8.5px] font-mono mt-0.5 ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                        {printRotation}° {printRotation === 0 ? "Normal" : printRotation === 90 ? "90° Clockwise" : printRotation === 180 ? "180° Inverted" : "270° Reverse"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {([0, 90, 180, 270] as const).map((deg) => {
                    const isSelected = printRotation === deg;
                    return (
                      <button
                        key={deg}
                        type="button"
                        onClick={() => handleRotationChange(deg)}
                        className={`py-1.5 px-2 rounded-xl text-[10.5px] font-bold font-mono transition-all border cursor-pointer text-center ${
                          isSelected
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                            : isLight
                            ? "bg-white border-slate-200 hover:bg-slate-100 text-slate-700"
                            : "bg-[#161b2d] border-slate-700 hover:bg-slate-800 text-slate-300"
                        }`}
                      >
                        {deg}°
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* RIGHT AREA: Preview Board */}
            <div className={`flex-1 ${isLight ? 'bg-slate-100/90' : 'bg-[#06070a]'} flex flex-col items-center justify-start overflow-y-auto p-6 relative custom-scrollbar`}>
              {/* Grid backing overlay */}
              <div
                className={`absolute inset-0 pointer-events-none ${isLight ? 'opacity-[0.05]' : 'opacity-[0.03]'}`}
                style={{
                  backgroundImage: isLight
                    ? 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)'
                    : 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
                  backgroundSize: '20px 20px'
                }}
              />

              {selectedRecords.length > 0 && selectedTemplateIds.length > 0 ? (
                <div className="flex flex-col items-center gap-3.5 w-full max-w-xl z-10">
                  <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[9.5px] font-mono font-bold tracking-wider border shadow-xs ${isLight
                    ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                    : "bg-indigo-500/15 border-indigo-500/30 text-indigo-300"
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isLight ? 'bg-indigo-600' : 'bg-indigo-400'} animate-pulse`}></span>
                    <span>ROLL PREVIEW: {paperType === "dual" ? "DUAL COLUMN LINER" : "SINGLE COLUMN LINER"}</span>
                  </div>

                  {/* Spool liner backplate */}
                  <div className={`w-full ${isLight ? 'bg-slate-800 border-slate-700' : 'bg-[#14151b] border-slate-800/80'} rounded-2xl p-4 border shadow-2xl flex flex-col items-center gap-4 overflow-y-auto max-h-[520px] custom-scrollbar`}>
                    {/* Feed indicator line */}
                    <div className="w-full text-center text-[8.5px] text-slate-400 font-mono select-none flex items-center justify-center gap-2 shrink-0 py-0.5">
                      <div className="h-[1px] bg-slate-700/60 flex-1" />
                      <span className="tracking-widest flex items-center gap-1.5 font-extrabold uppercase text-slate-400">
                        ▲ Feed Direction ▲
                      </span>
                      <div className="h-[1px] bg-slate-700/60 flex-1" />
                    </div>

                    {paperType === "single" ? (
                      <div className="flex flex-col gap-5 items-center w-full">
                        {previewQueue.map((item, qIdx) => {
                          const currentTemplate = item.template;
                          const isZebra1 = selectedPrinter?.type === "Zebra Thermal Label" || selectedPrinter?.name?.toLowerCase().includes("zebra");
                          const w = customWidthMm;
                          const h = customHeightMm;

                          const pageWExplicit = currentTemplate.pageWidthMm || 0;
                          const pageHExplicit = currentTemplate.pageHeightMm || 0;
                          const edgeToEdgeH = pageHExplicit > 0 && Math.abs(pageHExplicit - h) < 0.5;
                          const edgeToEdgeW = pageWExplicit > 0 && Math.abs(pageWExplicit - w) < 0.5;
                          const effLeft = (isZebra1 || edgeToEdgeW) ? 0 : leftMarginMm;
                          const effTop = (isZebra1 || edgeToEdgeH) ? 0 : topMarginMm;
                          const effRight = (isZebra1 || edgeToEdgeW) ? 0 : rightMarginMm;

                          const linerW = w + effLeft + effRight;
                          const linerH = h + (effTop * 2);
                          const leftOffset = effLeft;
                          const topOffset = effTop;

                          return (
                            <div key={qIdx} className="flex flex-col items-center gap-1.5 animate-fade-in shrink-0">
                              <span className="text-[8.5px] font-mono text-slate-400 font-bold">
                                Label #{item.index} ({currentTemplate.name})
                              </span>
                              <div
                                className={
                                  isZebra1
                                    ? "relative bg-white border border-slate-200 rounded shadow-md select-none overflow-hidden"
                                    : "relative bg-[#f4f2e9] border border-dashed border-[#ded9be] rounded-lg shadow-lg select-none overflow-hidden"
                                }
                                style={{
                                  width: `${linerW * previewScale}px`,
                                  height: `${linerH * previewScale}px`,
                                }}
                              >
                                <div
                                  className={`absolute bg-white overflow-hidden select-none ${isZebra1 ? "" : "shadow-[0_3px_10px_rgba(0,0,0,0.12)] border border-slate-200"} ${currentTemplate.shape === "rounded-rectangle" ? "rounded-[6px]" : currentTemplate.shape === "ellipse" || currentTemplate.shape === "circle" ? "rounded-full" : "rounded-xs"}`}
                                  style={{
                                    left: `${leftOffset * previewScale}px`,
                                    top: `${topOffset * previewScale}px`,
                                    width: `${w * previewScale}px`,
                                    height: `${h * previewScale}px`,
                                    filter: currentTemplate.negative ? "invert(1)" : "none",
                                    transform: `${currentTemplate.mirrorImage ? "scaleX(-1)" : ""} rotate(${printRotation}deg)`.trim() || "none",
                                  }}
                                >
                                  <div className="relative w-full h-full">
                                    {currentTemplate.elements.map((el) =>
                                      renderLiveElement(el, item.record, currentTemplate, previewScale)
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-5 items-center w-full">
                        {previewRows.map((row, rowIdx) => {
                          const leftTemplate = row.left?.template || allTemplates.find(t => selectedTemplateIds.includes(t.id)) || allTemplates[0];
                          const rightTemplate = row.right?.template || leftTemplate;

                          const wLeft = customWidthMm;
                          const hLeft = customHeightMm;

                          const wRight = customWidthMm;
                          const hRight = customHeightMm;

                          const maxStickerH = Math.max(hLeft, hRight);
                          const linerW = leftMarginMm + wLeft + middleGapMm + wRight + rightMarginMm;
                          const linerH = maxStickerH + (topMarginMm * 2);

                          return (
                            <div key={rowIdx} className="flex flex-col items-center gap-1.5 w-full shrink-0">
                              <span className="text-[8.5px] font-mono text-slate-400 font-bold uppercase tracking-wider">
                                Row #{row.rowNumber}
                              </span>

                              <div
                                className="relative bg-[#ebe8d8] border border-[#d2cca6] rounded-lg shadow-lg select-none overflow-hidden"
                                style={{
                                  width: `${linerW * previewScale}px`,
                                  height: `${linerH * previewScale}px`,
                                }}
                              >
                                {/* LEFT STICKER */}
                                {row.left ? (
                                  <div
                                    className={`absolute bg-white shadow-[0_3px_10px_rgba(0,0,0,0.12)] border border-slate-200 overflow-hidden select-none ${leftTemplate?.shape === "rounded-rectangle" ? "rounded-[6px]" : leftTemplate?.shape === "ellipse" || leftTemplate?.shape === "circle" ? "rounded-full" : "rounded-xs"}`}
                                    style={{
                                      left: `${leftMarginMm * previewScale}px`,
                                      top: `${topMarginMm * previewScale}px`,
                                      width: `${wLeft * previewScale}px`,
                                      height: `${hLeft * previewScale}px`,
                                      filter: leftTemplate?.negative ? "invert(1)" : "none",
                                      transform: `${leftTemplate?.mirrorImage ? "scaleX(-1)" : ""} rotate(${printRotation}deg)`.trim() || "none",
                                    }}
                                  >
                                    <div className="relative w-full h-full">
                                      {leftTemplate?.elements.map((el) =>
                                        renderLiveElement(el, row.left!.record, leftTemplate, previewScale)
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className="absolute border border-dashed border-neutral-300/60 flex items-center justify-center bg-[#dbd6ba]/55 rounded-sm"
                                    style={{
                                      left: `${leftMarginMm * previewScale}px`,
                                      top: `${topMarginMm * previewScale}px`,
                                      width: `${wLeft * previewScale}px`,
                                      height: `${hLeft * previewScale}px`,
                                    }}
                                  >
                                    <span className="text-[8px] font-bold text-[#b5af91] uppercase font-mono">Empty</span>
                                  </div>
                                )}

                                {/* RIGHT STICKER */}
                                {row.right ? (
                                  <div
                                    className={`absolute bg-white shadow-[0_3px_10px_rgba(0,0,0,0.12)] border border-slate-200 overflow-hidden select-none ${rightTemplate?.shape === "rounded-rectangle" ? "rounded-[6px]" : rightTemplate?.shape === "ellipse" || rightTemplate?.shape === "circle" ? "rounded-full" : "rounded-xs"}`}
                                    style={{
                                      left: `${(leftMarginMm + wLeft + middleGapMm) * previewScale}px`,
                                      top: `${topMarginMm * previewScale}px`,
                                      width: `${wRight * previewScale}px`,
                                      height: `${hRight * previewScale}px`,
                                      filter: rightTemplate?.negative ? "invert(1)" : "none",
                                      transform: `${rightTemplate?.mirrorImage ? "scaleX(-1)" : ""} rotate(${printRotation}deg)`.trim() || "none",
                                    }}
                                  >
                                    <div className="relative w-full h-full">
                                      {rightTemplate?.elements.map((el) =>
                                        renderLiveElement(el, row.right!.record, rightTemplate, previewScale)
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className="absolute border border-dashed border-neutral-300/60 flex items-center justify-center bg-[#dbd6ba]/55 rounded-sm"
                                    style={{
                                      left: `${(leftMarginMm + wLeft + middleGapMm) * previewScale}px`,
                                      top: `${topMarginMm * previewScale}px`,
                                      width: `${wRight * previewScale}px`,
                                      height: `${hRight * previewScale}px`,
                                    }}
                                  >
                                    <span className="text-[8px] font-bold text-[#b5af91] uppercase font-mono">Empty</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={`m-auto flex flex-col items-center gap-4 text-center max-w-sm z-10 p-6 ${isLight ? 'bg-white border-slate-200 shadow-xl' : 'bg-[#0e111a] border-slate-800 shadow-2xl'} border rounded-2xl`}>
                  <div className={`w-14 h-14 rounded-2xl ${isLight ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'} flex items-center justify-center mb-1`}>
                    <Search className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-slate-100'} tracking-tight`}>No preview available</h4>
                    <p className={`text-xs leading-relaxed mt-1.5 ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      {selectedTemplateIds.length === 0
                        ? "Select one or more layout templates from the sidebar options to construct label configurations."
                        : hasEnteredAccessions && selectedRecords.length === 0
                        ? "No valid accession records were found. Nothing can be printed."
                        : "Enter valid database codes or accession identifiers in the input card to generate print simulations."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MISSING ACCESSION STRICT WARNING MODAL */}
        {showMissingWarning && (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-xs flex items-center justify-center z-[150] p-4 animate-fade-in">
            <div className={`w-full max-w-md rounded-2xl p-5 shadow-2xl border ${isLight ? 'bg-white border-slate-200 text-slate-900' : 'bg-[#151928] border-slate-700 text-slate-100'}`}>
              <div className="flex items-start gap-3.5">
                <div className={`p-2.5 rounded-xl shrink-0 ${isLight ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="flex-1 space-y-1.5">
                  <h4 className="font-black text-sm tracking-tight text-red-600 dark:text-red-400">Missing Records Block Printing</h4>
                  <p className={`text-xs leading-relaxed font-mono ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                    {missingAccessionNumbers.length === 1
                      ? `1 accession number was not found: ${missingAccessionNumbers[0]}`
                      : `${missingAccessionNumbers.length} accession numbers were not found: ${missingAccessionNumbers.join(', ')}`
                    }
                  </p>
                  <p className={`text-xs font-semibold pt-1 ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                    Printing is strictly disabled until all missing records are removed or corrected.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2.5 mt-5 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowMissingWarning(false)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${isLight ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* PRINTING SIMULATION STATUS PANEL */}
        {printing && (
          <div className={`flex-1 p-10 text-center flex flex-col items-center justify-center space-y-6 ${isLight ? 'bg-white text-slate-900' : 'bg-[#0e111a] text-slate-100'}`}>
            <div className="flex flex-col items-center justify-center gap-4">
              <div className={`w-10 h-10 rounded-full border-3 ${isLight ? 'border-slate-200' : 'border-slate-800'} border-t-indigo-600 animate-spin`}></div>
              <div className="space-y-1">
                <h4 className={`text-base font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                  Printing in progress...
                </h4>
                <p className={`text-xs ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                  Sending label {printedCount} of {totalLabelsToPrint} to {selectedPrinter?.name || ''}
                </p>
              </div>
            </div>

            <div className="w-full max-w-xs space-y-1">
              <div className={`w-full ${isLight ? 'bg-slate-200' : 'bg-slate-800'} rounded-full h-1.5 overflow-hidden`}>
                <div
                  className="bg-gradient-to-r from-indigo-600 to-violet-600 h-full rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400 block text-right">{progress}%</span>
            </div>
          </div>
        )}

        {/* SUCCESS SUMMARY DETAILS CARD */}
        {success && (
          <div className={`flex-1 p-10 text-center flex flex-col items-center justify-center space-y-5 ${isLight ? 'bg-white text-slate-900' : 'bg-[#0e111a] text-slate-100'} animate-fade-in`}>
            <div className={`p-4 rounded-full border ${isLight ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'} shadow-lg`}>
              <Check className="w-10 h-10 stroke-[2.5]" />
            </div>

            <div className="space-y-1">
              <h4 className={`text-lg font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                Labels Printed Successfully
              </h4>
              <p className={`text-xs max-w-xs leading-relaxed mx-auto ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
               <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{totalLabelsToPrint} label(s)</span> printed by <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedPrinter?.name || ''}</span>.
              </p>
            </div>

            <div className="flex gap-3 w-full max-w-xs pt-2">
              <button
                onClick={() => setSuccess(false)}
                className={`flex-1 py-2 rounded-xl ${isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300' : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-700'} border text-xs transition-colors cursor-pointer font-bold`}
              >
                Print Another Batch
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Footer actions for setup */}
        {!printing && !success && (
          <div className={`px-6 py-3.5 ${isLight ? 'bg-slate-50 border-slate-200' : 'bg-[#121624] border-slate-800'} border-t flex justify-between items-center shrink-0`}>
            <span className={`text-xs flex items-center gap-2 font-mono ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
              <Info className={`w-4 h-4 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
              <span>
                Verify alignments and properties before dispatching jobs.
              </span>
            </span>

            <div className="flex gap-2.5">
              <button
                onClick={onClose}
                className={`px-4 py-2 rounded-xl ${isLight ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'} border text-xs transition-colors cursor-pointer font-bold`}
              >
                Cancel
              </button>
              {(() => {
                const hasMissing = missingAccessionNumbers.length > 0;
                const isPrintDisabled = selectedRecords.length === 0 || hasMissing || isLookingUp;
                return (
                  <button
                    onClick={handlePrintSubmit}
                    disabled={isPrintDisabled}
                    title={
                      hasMissing
                        ? `Cannot print: ${missingAccessionNumbers.length} record(s) not found in database. Remove them to proceed.`
                        : isLookingUp
                        ? "Verifying records in database..."
                        : selectedRecords.length === 0
                        ? "Enter valid accession records to print"
                        : "Print Labels"
                    }
                    className={`px-6 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all ${
                      isPrintDisabled
                        ? "bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-500 cursor-not-allowed opacity-50 shadow-none"
                        : "bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/25 active:scale-[0.98] cursor-pointer"
                    }`}
                  >
                    <PrinterIcon className="w-4 h-4" />
                    <span>Print Labels</span>
                  </button>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
