import React, { useState, useEffect, useRef, useCallback } from "react";
import { DatabaseRecord, Printer, LabelTemplate, ConnectionProfile, LabelElement, PrintHistoryRecord } from "../types";
import { PageSettings, LabelSettings, LayoutEngine, MediaType } from "../utils/LayoutEngine";
import { getAutoShrunkFontSize, getAutoShrunkWrappedFontSize } from "../utils/textUtils";
import { mockRecords } from "../data/mockData";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

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
  List,
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
  } catch (e) {
    console.error("Failed to save print history:", e);
  }
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

  // Local active printer state for temporary overrides
  const [selectedPrinter, setSelectedPrinter] = useState<Printer | null>(activePrinter);

  useEffect(() => {
    if (isOpen) {
      setSelectedPrinter(activePrinter);
    }
  }, [isOpen, activePrinter]);

  // Paper & Layout Selection states (Derived from active template config to ensure correct layout and spacing)
  const activeTemplates = React.useMemo(() => {
    return allTemplates.filter((t) => selectedTemplateIds.includes(t.id));
  }, [allTemplates, selectedTemplateIds]);

  const primaryTemplate = activeTemplates[0] || template;
  const paperType = (primaryTemplate?.columns || 1) === 2 ? "dual" : "single";

  const customWidthMm = primaryTemplate?.widthMm || 50;
  const customHeightMm = primaryTemplate?.heightMm || 30;
  const leftMarginMm = primaryTemplate?.marginLeft !== undefined ? primaryTemplate.marginLeft : 2;
  const rightMarginMm = primaryTemplate?.marginRight !== undefined ? primaryTemplate.marginRight : 2;
  const middleGapMm = primaryTemplate?.gapHorizontal !== undefined ? primaryTemplate.gapHorizontal : 2;
  const topMarginMm = primaryTemplate?.marginTop !== undefined ? primaryTemplate.marginTop : 3;

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

  // Configured Unique Field source
  const [uniqueField, setUniqueField] = useState<string>(
    template?.uniqueField || allTemplates[0]?.uniqueField || "AccessionNo",
  );

  // Sourcing Input Modes
  const [sourcingMode, setSourcingMode] = useState<
    "single" | "range" | "list" | "select"
  >("single");

  // Multi-line accession number input (defaults to empty so user enters accession numbers)
  const [accessionNumbersText, setAccessionNumbersText] = useState<string>(
    initialAccessionNumbers && initialAccessionNumbers.length > 0
      ? initialAccessionNumbers.join("\n")
      : "",
  );

  const [selectedRecords, setSelectedRecords] = useState<DatabaseRecord[]>([]);
  const [searchError, setSearchError] = useState("");
  const [nativeMode, setNativeMode] = useState(true);

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

  // Handle accession numbers search lookup
  const handleLookup = useCallback(async () => {
    // ── No active DB profile: build fallback records from entered terms ───────
    if (!activeProfile) {
      const terms = accessionNumbersText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (terms.length === 0) {
        setSearchError("Please enter at least one key identifier");
        setSelectedRecords([]);
        return;
      }
      // Synthesise a minimal record from the entered values so the template
      // static text fields are preserved and the barcode gets the entered number.
      const fallbackRecords: DatabaseRecord[] = [];
      terms.forEach((t) => {
        const { baseTerm, abbreviations } = parseTermAbbreviation(t);
        abbreviations.forEach(({ suffix, count }) => {
          for (let i = 0; i < count; i++) {
            const finalAccessionNo = baseTerm + suffix;
            fallbackRecords.push({
              AccessionNo: finalAccessionNo,
              acc_no: finalAccessionNo,
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
        });
      });
      setSelectedRecords(fallbackRecords);
      setSearchError("");
      return;
    }

    if (!accessionNumbersText.trim()) {
      setSearchError("Please enter at least one key identifier");
      setSelectedRecords([]);
      return;
    }

    const terms = accessionNumbersText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");

    try {
      const logicalUniqueKey = activeProfile.uniqueField || 'AccessionNo';
      const lookupField = activeProfile.fieldMappings?.[logicalUniqueKey] || logicalUniqueKey;
      let totalFound = 0;

      // Clear the current records and errors before starting the progressive fetch
      setSelectedRecords([]);
      setSearchError("");

      const accumulatedRecords: DatabaseRecord[] = [];

      for (const term of terms) {
        const { baseTerm, abbreviations } = parseTermAbbreviation(term);
        const data = await electronAPI.dbQueryRecord(activeProfile, activeProfile.table, lookupField, baseTerm);

        const baseRecord: any = {};
        if (data.success && data.record) {
          const row = data.record;

          // Map physical columns to logical keys based on profile field mappings
          const mappings: Record<string, string> = activeProfile.fieldMappings || {};
          Object.entries(mappings).forEach(([logicalKey, physicalCol]) => {
            if (physicalCol && row[physicalCol] !== undefined) {
              baseRecord[logicalKey] = String(row[physicalCol]);
            }
          });

          // Fallback mapping for the lookup field if not explicitly mapped
          if (!baseRecord[logicalUniqueKey] && row[lookupField] !== undefined) {
            baseRecord[logicalUniqueKey] = String(row[lookupField]);
          }

          // Include raw physical columns for full flexibility
          Object.keys(row).forEach(key => {
            baseRecord[key] = String(row[key]);
          });
        } else {
          // DB connected but record not found: still create a fallback with the entered number
          baseRecord.AccessionNo = baseTerm;
          baseRecord.acc_no = baseTerm;
          baseRecord[logicalUniqueKey] = baseTerm;
          baseRecord[lookupField] = baseTerm;
          Object.assign(baseRecord, {
            Title: "", Author: "", Publisher: "", ClassNo: "",
            BookNo: "", ISBN: "", Edition: "", Year: "", Price: "", Status: "",
          });
        }

        const newlyGenerated: any[] = [];
        // Apply abbreviations to generate the actual records
        abbreviations.forEach(({ suffix, count }) => {
          for (let i = 0; i < count; i++) {
            const finalAccessionNo = baseTerm + suffix;
            newlyGenerated.push({
              ...baseRecord,
              AccessionNo: finalAccessionNo,
              acc_no: finalAccessionNo,
              [logicalUniqueKey]: finalAccessionNo,
              [lookupField]: finalAccessionNo,
            });
          }
        });

        if (newlyGenerated.length > 0) {
          totalFound += newlyGenerated.length;
          accumulatedRecords.push(...newlyGenerated);
        }
      }

      setSelectedRecords(accumulatedRecords);

      if (totalFound === 0) {
        setSearchError(
          `No records found with unique field "${logicalUniqueKey}" (mapped to "${lookupField}") matching the provided identifiers`,
        );
      }
    } catch (err: any) {
      setSearchError(`Lookup failed: ${err.message}`);
    }
  }, [accessionNumbersText, activeProfile, electronAPI]);

  // Sync / initialize accession numbers input when modal opens
  useEffect(() => {
    if (isOpen) {
      let initialText = "";
      if (initialAccessionNumbers && initialAccessionNumbers.length > 0) {
        initialText = initialAccessionNumbers.join("\n");
      }
      setAccessionNumbersText(initialText);
      if (!initialText) {
        setSelectedRecords([]);
        setSearchError("");
      }
    }
  }, [isOpen, initialAccessionNumbers]);

  // Automatically trigger database query whenever accessionNumbersText or activeProfile changes (debounced)
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      handleLookup();
    }, 400); // 400ms debounce to avoid excessive database calls while typing

    return () => clearTimeout(timer);
  }, [accessionNumbersText, activeProfile, isOpen, handleLookup]);

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

  // Printer Calibration States
  const [calibOffsetX, setCalibOffsetX] = useState<number>(0);
  const [calibOffsetY, setCalibOffsetY] = useState<number>(0);
  const [calibScaleX, setCalibScaleX] = useState<number>(1.0);
  const [calibScaleY, setCalibScaleY] = useState<number>(1.0);
  const [calibRotation, setCalibRotation] = useState<number>(0);

  // Sync printer calibration settings on printer change
  useEffect(() => {
    if (!isOpen || !selectedPrinter?.name) return;
    try {
      const stored = localStorage.getItem("barcode_studio_printer_calibrations");
      if (stored) {
        const calibs = JSON.parse(stored);
        const pCalib = calibs[selectedPrinter.name] || {};
        setCalibOffsetX(pCalib.offsetX !== undefined ? pCalib.offsetX : 0);
        setCalibOffsetY(pCalib.offsetY !== undefined ? pCalib.offsetY : 0);
        setCalibScaleX(pCalib.scaleX !== undefined ? pCalib.scaleX : 1.0);
        setCalibScaleY(pCalib.scaleY !== undefined ? pCalib.scaleY : 1.0);
        setCalibRotation(pCalib.rotation !== undefined ? pCalib.rotation : 0);
        return;
      }
    } catch (e) {}
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
    } catch (e) {}
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

        let content = el.text || "";
        if (el.fieldName) {
          // Look up the database value; fall back to el.text if the field is absent or empty
          const dbVal = rec[el.fieldName];
          const resolvedVal = dbVal !== undefined && dbVal !== null && String(dbVal).trim() !== ""
            ? String(dbVal)
            : (el.text || "");
          content = `${el.prefix || ""}${resolvedVal}${el.suffix || ""}`;
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
          const wrapEnabled = (el as any).wrapText === true;
          const finalFontSizePx = el.autoShrink
            ? getAutoShrunkWrappedFontSize(
              content,
              fontFamily,
              baseFontSizePx,
              elPixelW,
              elPixelH,
              wrapEnabled,
              fontWeight,
              fontStyle
            )
            : baseFontSizePx;

          ctx.font = `${fontStyle} ${fontWeight} ${finalFontSizePx}px "${fontFamily}", "Segoe UI", system-ui, sans-serif`;

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
            const lineSpacing = 1.25;
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
            ctx.fillText(content, textX, textY, elPixelW);
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

      // 3. Orientation Rotation (landscape, portrait-180, landscape-180)
      if (t.orientation && t.orientation !== "portrait") {
        const rotCanvas = document.createElement("canvas");
        const rCtx = rotCanvas.getContext("2d");
        if (rCtx) {
          if (t.orientation === "portrait-180") {
            rotCanvas.width = finalCanvas.width;
            rotCanvas.height = finalCanvas.height;
            rCtx.translate(finalCanvas.width, finalCanvas.height);
            rCtx.rotate(Math.PI);
            rCtx.drawImage(finalCanvas, 0, 0);
          } else if (t.orientation === "landscape") {
            rotCanvas.width = finalCanvas.height;
            rotCanvas.height = finalCanvas.width;
            rCtx.translate(finalCanvas.height, 0);
            rCtx.rotate(Math.PI / 2);
            rCtx.drawImage(finalCanvas, 0, 0);
          } else if (t.orientation === "landscape-180") {
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
  const handlePrintSubmit = async () => {
    if (selectedRecords.length === 0) {
      alert(
        `No matching records were identified. Check that your unique ID search or selections are valid.`,
      );
      return;
    }

    setPrinting(true);
    setProgress(0);
    setPrintedCount(0);
    setSuccess(false);

    const safeCopiesExecute = Number(copies) || 1;
    onLogMessage(
      "info",
      `Preparing print job: ${selectedRecords.length} records × ${safeCopiesExecute} copies → ${selectedPrinter?.name || ''}...`,
    );

    const activeTemplates = allTemplates.filter((t) => selectedTemplateIds.includes(t.id));

    // Build the print queue: group by record and copies, and interleave templates (A, B, A, B...)
    const queue: { template: LabelTemplate; record: DatabaseRecord; index: number }[] = [];
    let counter = 1;
    selectedRecords.forEach((rec) => {
      for (let c = 0; c < safeCopiesExecute; c++) {
        activeTemplates.forEach((t) => {
          queue.push({ template: t, record: rec, index: counter++ });
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

        if (saveRes.success) {
          setProgress(100);
          setPrintedCount(queue.length);
          onLogMessage("success", `PDF labels saved to ${dialogRes.filePath}`);
          setSuccess(true);
          addPrintHistory({
            method: (initialAccessionNumbers && initialAccessionNumbers.length > 0 ? "email" : "manual") as "manual" | "email",
            senderEmail: (initialAccessionNumbers && initialAccessionNumbers.length > 0) ? (senderEmail || "automation@email.com") : senderEmail,
            accessionNo: queue.map(item => item.record.AccessionNo || item.record.acc_no || '').filter(Boolean).slice(0, 10).join(', ') + (queue.length > 10 ? '...' : ''),
            copies: queue.length,
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
            accessionNo: queue.map(item => item.record.AccessionNo || item.record.acc_no || '').filter(Boolean).slice(0, 10).join(', ') + (queue.length > 10 ? '...' : ''),
            copies: queue.length,
            templates: Array.from(new Set(queue.map(item => item.template.name || item.template.id))),
            printerName: "Save to PDF File",
            status: "failed",
            error: saveRes.message
          });
        }
      } else {
        setProgress(40);
        const targetTemplate = activeTemplates[0] || template;
        const result = await electronAPI.printBatch(
          selectedPrinter?.name || '',
          queue, // Pass the unified queue of template/record pairs
          1,     // copies are already resolved in the queue
          targetTemplate,
          {
            quality: "auto",
            nativeMode: true,
            calibration: {
              offsetX: calibOffsetX,
              offsetY: calibOffsetY,
              scaleX: calibScaleX,
              scaleY: calibScaleY,
              rotation: calibRotation,
            }
          }
        );

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
            accessionNo: queue.map(item => item.record.AccessionNo || item.record.acc_no || '').filter(Boolean).slice(0, 10).join(', ') + (queue.length > 10 ? '...' : ''),
            copies: queue.length,
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
            accessionNo: queue.map(item => item.record.AccessionNo || item.record.acc_no || '').filter(Boolean).slice(0, 10).join(', ') + (queue.length > 10 ? '...' : ''),
            copies: queue.length,
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

  // Build sequential print queue of (template, record) pairs for visual simulation
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
    const rows: { left?: typeof printQueue[0]; right?: typeof printQueue[0] }[] = [];
    for (let i = 0; i < printQueue.length; i += 2) {
      rows.push({
        left: printQueue[i],
        right: printQueue[i + 1],
      });
    }
    return rows;
  }, [printQueue]);

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

    // Replace Field Binding
    let content = el.text || "";
    if (el.fieldName) {
      const lower = el.fieldName.toLowerCase();
      let dbVal = "";

      // 1. Direct or case-insensitive key match
      for (const key of Object.keys(record)) {
        if (key.toLowerCase() === lower) {
          dbVal = String(record[key] ?? "");
          break;
        }
      }

      // 2. Check activeProfile field mappings if direct match failed
      if (!dbVal && activeProfile?.fieldMappings) {
        const physCol = activeProfile.fieldMappings[el.fieldName] || activeProfile.fieldMappings[lower];
        if (physCol && record[physCol] !== undefined) {
          dbVal = String(record[physCol] ?? "");
        }
      }

      // 3. Fallback check for reverse mapping
      if (!dbVal && activeProfile?.fieldMappings) {
        for (const [logicalKey, physCol] of Object.entries(activeProfile.fieldMappings)) {
          if ((physCol as string).toLowerCase() === lower && record[logicalKey] !== undefined) {
            dbVal = String(record[logicalKey] ?? "");
            break;
          }
        }
      }

      // 4. Common field aliases fallback
      if (!dbVal) {
        const checkKeys = (keys: string[]) => {
          for (const k of keys) {
            for (const rk of Object.keys(record)) {
              if (rk.toLowerCase() === k.toLowerCase() && record[rk] !== undefined && record[rk] !== null && record[rk] !== "") {
                return String(record[rk]);
              }
            }
          }
          return "";
        };

        if (lower === 'acc_no' || lower === 'accessionno' || lower === 'accno' || lower === 'accession') {
          dbVal = checkKeys(['ACC_NO', 'AccessionNo', 'Acc_No', 'ACCNO', 'accession', 'id']);
        } else if (lower === 'title' || lower === 'booktitle' || lower === 'book_title') {
          dbVal = checkKeys(['TITLE', 'BookTitle', 'Book_Title', 'title', 'name']);
        } else if (lower === 'author' || lower === 'authorname' || lower === 'author_name') {
          dbVal = checkKeys(['AUTHOR', 'Author', 'AuthorName', 'Author_Name', 'author', 'writer']);
        } else if (lower === 'publisher' || lower === 'pub_name' || lower === 'pubname') {
          dbVal = checkKeys(['PUBLISHER', 'Publisher', 'PublisherName', 'pub_name', 'publisher']);
        } else if (lower === 'call_no' || lower === 'callno' || lower === 'class_no' || lower === 'classno') {
          dbVal = checkKeys(['CALL_NO', 'CallNo', 'ClassNo', 'Class_No', 'call_no']);
        } else if (lower === 'barcode' || lower === 'code') {
          dbVal = checkKeys(['BARCODE', 'Barcode', 'Code', 'barcode']);
        } else if (lower === 'year' || lower === 'pubyear' || lower === 'pub_year') {
          dbVal = checkKeys(['YEAR', 'Year', 'PubYear', 'Pub_Year', 'year']);
        } else if (lower === 'price' || lower === 'cost') {
          dbVal = checkKeys(['PRICE', 'Price', 'Cost', 'price']);
        } else if (lower === 'isbn') {
          dbVal = checkKeys(['ISBN', 'Isbn', 'isbn']);
        }
      }

      content = `${el.prefix || ""}${dbVal}${el.suffix || ""}`;
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
    const wrapEnabled = (el as any).wrapText === true;
    const finalFontSizePx = el.autoShrink
      ? getAutoShrunkWrappedFontSize(
        content,
        el.fontFamily || "Segoe UI",
        baseFontSizePx,
        elW * mmToPx,
        elH * mmToPx,
        wrapEnabled,
        el.fontWeight,
        el.fontStyle
      )
      : baseFontSizePx;

    return (
      <div
        key={el.id}
        style={{
          ...style,
          fontFamily: el.fontFamily || "Segoe UI",
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
            <div className={`p-2.5 ${isLight ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'} rounded-xl shadow-xs`}>
              <PrinterIcon className="w-5 h-5" />
            </div>
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
            <div className={`w-[340px] p-4 border-r ${isLight ? 'bg-white border-slate-200' : 'bg-[#0e111a] border-slate-800'} flex flex-col gap-4 shrink-0 z-10 overflow-y-auto custom-scrollbar`}>

              {/* Accession Numbers Section */}
              <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-3.5 space-y-2.5 shadow-xs`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Hash className={`w-3.5 h-3.5 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
                    <span className={`text-[11px] font-extrabold uppercase tracking-wider font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                      Accession Numbers
                    </span>
                  </div>
                  <span className={`text-[8.5px] px-2 py-0.5 rounded-full font-mono font-bold ${isLight ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-300'}`}>
                    1 Per Line
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className={`relative rounded-xl border ${isLight ? 'border-slate-300 bg-white focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-500/20' : 'border-slate-700 bg-[#161b2d] focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20'} transition-all overflow-hidden shadow-inner`}>
                    <textarea
                      value={accessionNumbersText}
                      onChange={(e) => setAccessionNumbersText(e.target.value)}
                      placeholder={`e.g.\n10001\n10002`}
                      className={`w-full h-20 bg-transparent px-3 py-2 text-xs font-mono font-bold ${isLight ? 'text-slate-900 placeholder-slate-400' : 'text-slate-100 placeholder-slate-500'} outline-none resize-none border-none leading-relaxed`}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    {searchError ? (
                      <span className={`text-[9.5px] font-semibold flex-1 leading-tight flex items-center gap-1.5 ${isLight ? 'text-red-600' : 'text-red-400'}`}>
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {searchError}
                      </span>
                    ) : (
                      <span className="text-[9.5px] flex-1 leading-tight font-medium">
                        {selectedRecords.length > 0 ? (
                          <span className={`font-bold flex items-center gap-1.5 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isLight ? 'bg-emerald-600' : 'bg-emerald-400'} inline-block animate-pulse`}></span>
                            {selectedRecords.length} records linked
                          </span>
                        ) : (
                          <span className={isLight ? 'text-slate-500' : 'text-slate-400'}>
                            Enter identifiers to match labels
                          </span>
                        )}
                      </span>
                    )}
                  </div>
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
              <div className={`${isLight ? 'bg-slate-50/70 border-slate-200' : 'bg-[#161b2d]/40 border-indigo-500/15'} border rounded-2xl p-3.5 space-y-2.5 shadow-xs`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <PrinterIcon className={`w-3.5 h-3.5 ${isLight ? 'text-indigo-600' : 'text-indigo-400'}`} />
                    <span className={`text-[11px] font-extrabold uppercase tracking-wider font-mono ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                      Target Printer
                    </span>
                  </div>
                </div>
                <div className="relative">
                  <select
                    value={selectedPrinter?.name || ""}
                    onChange={(e) => {
                      const p = printers.find((x) => x.name === e.target.value);
                      if (p) {
                        setSelectedPrinter(p);
                      }
                    }}
                    className={`w-full ${isLight ? 'bg-white border-slate-300 text-slate-900 hover:border-slate-400' : 'bg-[#161b2d] border-slate-700 text-slate-100 hover:border-slate-600'} border rounded-xl pl-3 pr-8 py-2 text-xs outline-none cursor-pointer appearance-none transition-all font-bold shadow-xs`}
                  >
                    {printers.map((p) => (
                      <option key={p.name} value={p.name} className={isLight ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <div className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className={`text-[9px] font-mono font-bold ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                      {selectedPrinter?.status || "Ready"} · {printerCaps?.maxDpi || 300} DPI
                    </span>
                  </div>
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
                        {printQueue.map((item, qIdx) => {
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
                                    transform: `${currentTemplate.mirrorImage ? "scaleX(-1)" : ""} ${currentTemplate.orientation === "portrait-180" ? "rotate(180deg)" : currentTemplate.orientation === "landscape" ? "rotate(90deg)" : currentTemplate.orientation === "landscape-180" ? "rotate(270deg)" : ""}`.trim() || "none",
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
                        {printRows.map((row, rowIdx) => {
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
                                Row #{rowIdx + 1}
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
                                      transform: `${leftTemplate?.mirrorImage ? "scaleX(-1)" : ""} ${leftTemplate?.orientation === "portrait-180" ? "rotate(180deg)" : leftTemplate?.orientation === "landscape" ? "rotate(90deg)" : leftTemplate?.orientation === "landscape-180" ? "rotate(270deg)" : ""}`.trim() || "none",
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
                                      transform: `${rightTemplate?.mirrorImage ? "scaleX(-1)" : ""} ${rightTemplate?.orientation === "portrait-180" ? "rotate(180deg)" : rightTemplate?.orientation === "landscape" ? "rotate(90deg)" : rightTemplate?.orientation === "landscape-180" ? "rotate(270deg)" : ""}`.trim() || "none",
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
                        : "Enter valid database codes or accession identifiers in the input card to generate print simulations."}
                    </p>
                  </div>
                </div>
              )}
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
                Labels Spooled Successfully
              </h4>
              <p className={`text-xs max-w-xs leading-relaxed mx-auto ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>
                Spooler printed <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{totalLabelsToPrint} labels</span> to target spool <span className="font-bold text-indigo-600 dark:text-indigo-400">{selectedPrinter?.name || ''}</span>.
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
              <button
                onClick={handlePrintSubmit}
                disabled={selectedRecords.length === 0}
                className="px-6 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-45 shadow-lg shadow-indigo-600/25 active:scale-[0.98] transition-all"
              >
                <PrinterIcon className="w-4 h-4" />
                <span>Print Labels</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
