import React, { useState, useRef, useEffect } from "react";
import { LabelElement, DatabaseRecord, ConnectionProfile } from "../types";
import { getAutoShrunkFontSize, getAutoShrunkWrappedFontSize } from "../utils/textUtils";
import { useElectronAPI } from "../hooks/useElectronAPI";
import { PageSettings, LabelSettings, LayoutEngine, MediaType } from "../utils/LayoutEngine";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import {
  Lock,
  EyeOff,
  MousePointer,
  Hand,
  RotateCcw,
  RotateCw,
  Grid,
  Layers,
  Eye,
  ShieldAlert,
  CheckCircle,
  Info,
  X,
  Minus,
  Sparkles,
  Database,
} from "lucide-react";

const STANDARD_FIELD_LABELS: Record<string, string> = {
  AccessionNo: "Accession Number",
  Title: "Title",
  Author: "Author",
  Publisher: "Publisher",
  ClassNo: "Classification Number",
  BookNo: "Book Number",
  ISBN: "ISBN",
  Edition: "Edition",
  Year: "Publication Year",
  Price: "Price",
  Status: "Status"
};

// ─────────────────────────────────────────────────────────────────────────────
// Separator Guides — purely visual canvas guides (never printed, never exported)
// ─────────────────────────────────────────────────────────────────────────────
export type GuideUnit = "mm" | "in" | "cm";

export interface SeparatorGuide {
  id: string;
  orientation: "vertical" | "horizontal";
  positionMm: number; // always stored internally in millimetres
}

const toMm = (value: number, unit: GuideUnit): number =>
  unit === "in" ? value * 25.4 : unit === "cm" ? value * 10 : value;

const fromMm = (mm: number, unit: GuideUnit): number =>
  unit === "in" ? mm / 25.4 : unit === "cm" ? mm / 10 : mm;

interface DesignerCanvasProps {
  widthMm: number;
  heightMm: number;
  shape?: "rectangle" | "rounded-rectangle" | "ellipse" | "circle";
  orientation?: "portrait" | "landscape" | "portrait-180" | "landscape-180";
  mirrorImage?: boolean;
  negative?: boolean;
  elements: LabelElement[];
  selectedId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (id: string, updates: Partial<LabelElement>) => void;
  onUpdateElements?: (
    updatesMap: Record<string, Partial<LabelElement>>,
  ) => void;
  snapToGrid: boolean;
  onToggleSnapToGrid?: () => void;
  gridSizeMm: number;
  zoom: number; // e.g. 1.5 for 150%
  onZoomChange?: (newZoom: number) => void;
  activeRecord: DatabaseRecord | null;
  activeProfile?: ConnectionProfile | null;
  onSelectRecord?: (record: DatabaseRecord | null) => void;
  onLogMessage?: (level: "info" | "success" | "error" | "warning", msg: string) => void;
  previewMode: "template" | "live";
  onPreviewModeChange: (mode: "template" | "live") => void;
  unit?: 'mm' | 'in' | 'cm';
  onUpdateOrientation?: (orientation: 'portrait' | 'landscape' | 'portrait-180' | 'landscape-180') => void;
  onRemoveElement: (id: string) => void;
  onRemoveElements?: (ids: string[]) => void;
  selectedIds?: string[];
  onSelectElements?: (ids: string[]) => void;

  // Layout engine page settings
  mediaType?: 'continuous' | 'pre-cut' | 'sheet';
  cornerRadiusMm?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  gapHorizontal?: number;
  gapVertical?: number;
  columns?: number;
  rows?: number;
  pageWidthMm?: number;
  pageHeightMm?: number;
  dbRecords?: DatabaseRecord[];
  onStartHistoryAction?: () => void;
  paddingLeftMm?: number;
  paddingRightMm?: number;
  paddingTopMm?: number;
  paddingBottomMm?: number;
  highlightedElementId?: string | null;
}

export const DesignerCanvas: React.FC<DesignerCanvasProps> = ({
  widthMm,
  heightMm,
  shape = "rectangle",
  orientation = "portrait",
  mirrorImage = false,
  negative = false,
  elements,
  selectedId,
  onSelectElement,
  onUpdateElement,
  onUpdateElements,
  snapToGrid,
  onToggleSnapToGrid,
  gridSizeMm,
  zoom,
  onZoomChange,
  activeRecord,
  activeProfile = null,
  onSelectRecord,
  onLogMessage,
  previewMode,
  onPreviewModeChange,
  unit = 'mm',
  onUpdateOrientation,
  onRemoveElement,
  onRemoveElements,
  mediaType = 'sheet',
  cornerRadiusMm = 0,
  marginTop = 0,
  marginBottom = 0,
  marginLeft = 0,
  marginRight = 0,
  gapHorizontal = 0,
  gapVertical = 0,
  columns = 1,
  rows = 1,
  pageWidthMm,
  pageHeightMm,
  dbRecords = [],
  selectedIds: propsSelectedIds,
  onSelectElements: propsOnSelectElements,
  onStartHistoryAction,
  paddingLeftMm = 0,
  paddingRightMm = 0,
  paddingTopMm = 0,
  paddingBottomMm = 0,
  highlightedElementId,
}) => {
  const electronAPI = useElectronAPI();
  const mmToPx = 9.0 * zoom; // scale factor - double previous to fix the scale issue

  // Swapped visual width and height of physical sticker if printed in landscape
  const isLandscapeRotated = orientation === "landscape" || orientation === "landscape-180";
  const stickerW = isLandscapeRotated ? heightMm : widthMm;
  const stickerH = isLandscapeRotated ? widthMm : heightMm;

  const widthPx = stickerW * mmToPx;
  const heightPx = stickerH * mmToPx;

  const canvasRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Native wheel handler to intercept browser zoom
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (onZoomChange) {
          const zoomStep = 0.15;
          if (e.deltaY < 0) {
            onZoomChange(Math.min(3.0, zoom + zoomStep));
          } else {
            onZoomChange(Math.max(0.5, zoom - zoomStep));
          }
        }
      }
    };

    workspace.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      workspace.removeEventListener("wheel", handleWheel);
    };
  }, [zoom, onZoomChange]);

  // Panning state for moveable canvas
  const [toolMode, setToolMode] = useState<"select" | "pan">("select");
  const spacePressedRef = useRef(false);
  const originalToolModeRef = useRef<"select" | "pan">("select");
  const toolModeRef = useRef(toolMode);
  const dragSelectCompletedRef = useRef(false);

  useEffect(() => {
    toolModeRef.current = toolMode;
  }, [toolMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === " " || e.code === "Space") {
        if (!spacePressedRef.current) {
          spacePressedRef.current = true;
          originalToolModeRef.current = toolModeRef.current;
          setToolMode("pan");
        }
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === " " || e.code === "Space") {
        if (spacePressedRef.current) {
          spacePressedRef.current = false;
          setToolMode(originalToolModeRef.current);
        }
        e.preventDefault();
      }
    };

    const handleBlur = () => {
      if (spacePressedRef.current) {
        spacePressedRef.current = false;
        setToolMode(originalToolModeRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Ruler Guideline states (User-defined guides)
  const [xGuides, setXGuides] = useState<number[]>([]); // Vertical guidelines in mm
  const [yGuides, setYGuides] = useState<number[]>([]); // Horizontal guidelines in mm
  const [activeGuideLines, setActiveGuideLines] = useState<boolean>(true);

  // Separator Guides — visual-only canvas dividers (never printed / exported)
  const [separatorGuides, setSeparatorGuides] = useState<SeparatorGuide[]>([]);
  const [showSepPanel, setShowSepPanel] = useState<boolean>(false);
  const [sepOrientation, setSepOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [sepValue, setSepValue] = useState<string>("25");
  const [sepUnit, setSepUnit] = useState<GuideUnit>("mm");

  const addSeparatorGuide = () => {
    const val = parseFloat(sepValue);
    if (isNaN(val) || val < 0) return;
    const positionMm = toMm(val, sepUnit);
    setSeparatorGuides((prev) => [
      ...prev,
      {
        id: `sep-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
        orientation: sepOrientation,
        positionMm,
      },
    ]);
  };
  const [showAccessionPrompt, setShowAccessionPrompt] = useState(false);
  const [selectedSearchFieldKey, setSelectedSearchFieldKey] = useState<string>("AccessionNo");
  const [promptAccessionValue, setPromptAccessionValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);

  // Track nudging for tooltip precision
  const [nudgeInfo, setNudgeInfo] = useState<{
    elementId: string;
    lastDirection: string;
    step: number;
  } | null>(null);

  // Track all selected items for multi-selection moving & alignment
  const [localSelectedIds, setLocalSelectedIds] = useState<string[]>([]);
  const selectedIds = propsSelectedIds !== undefined ? propsSelectedIds : localSelectedIds;
  const setSelectedIds = propsOnSelectElements !== undefined ? propsOnSelectElements : setLocalSelectedIds;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (selectedId) {
          const el = elements.find((item) => item.id === selectedId);
          if (el && !el.locked) {
            let dir = "";
            if (e.key === "ArrowUp") dir = "Up";
            else if (e.key === "ArrowDown") dir = "Down";
            else if (e.key === "ArrowLeft") dir = "Left";
            else if (e.key === "ArrowRight") dir = "Right";

            setNudgeInfo({
              elementId: el.id,
              lastDirection: dir,
              step: e.shiftKey ? 2.5 : 0.5,
            });

            // Clear any existing timer
            if (timer) clearTimeout(timer);

            // Auto fade out / clear after 1.5s
            timer = setTimeout(() => {
              setNudgeInfo(null);
            }, 1500);
          }
        }
      }

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timer) clearTimeout(timer);
    };
  }, [selectedId, elements]);

  // Dynamic Workspace Size Tracker for perfect responsive ruler positioning
  const [workspaceSize, setWorkspaceSize] = useState({
    width: 800,
    height: 600,
  });

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    // Direct initialization
    const rect = workspace.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setWorkspaceSize({ width: rect.width, height: rect.height });
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWorkspaceSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(workspace);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Compute precise pixel coordinates for positioning the canvas card relative to the workspace
  const canvasLeftPx = (workspaceSize.width - widthPx) / 2 + pan.x;
  const canvasTopPx = (workspaceSize.height - heightPx) / 2 + pan.y;

  // Marquee drag-to-select marquee box
  const [selectBox, setSelectBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Sync selectedIds with selectedId prop
  useEffect(() => {
    if (selectedId) {
      if (!selectedIds.includes(selectedId)) {
        setSelectedIds([selectedId]);
      }
    } else {
      setSelectedIds([]);
    }
  }, [selectedId]);

  const [dragState, setDragState] = useState<{
    elementId: string;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
    startRotation?: number;
    startFontSize?: number;
    action: "move" | "resize" | "rotate";
    handle?: string;
    startPositions?: Array<{
      id: string;
      x: number;
      y: number;
      locked: boolean;
    }>;
  } | null>(null);

  // Find which fields are mapped in the profile
  const mappedFieldsList = React.useMemo(() => {
    if (!activeProfile) return [{ key: "AccessionNo", label: "Accession Number", physical: "AccessionNo" }];
    const mappings: Record<string, string> = activeProfile.fieldMappings || {};
    
    // Get all mapped standard fields
    const list = Object.entries(mappings)
      .filter(([key, val]) => {
        return val && val.trim() !== "" && !val.includes("Skip Bind");
      })
      .map(([key, val]) => ({
        key,
        label: STANDARD_FIELD_LABELS[key] || key,
        physical: val
      }));

    // If list is empty, default to unique field
    if (list.length === 0) {
      const uField = activeProfile.uniqueField || "AccessionNo";
      const uLabel = STANDARD_FIELD_LABELS[uField] || uField;
      return [{ key: uField, label: uLabel, physical: uField }];
    }
    return list;
  }, [activeProfile]);

  useEffect(() => {
    if (mappedFieldsList.length > 0) {
      const defaultField = mappedFieldsList.find(f => f.key === "AccessionNo") || mappedFieldsList[0];
      if (defaultField) {
        setSelectedSearchFieldKey(defaultField.key);
      }
    }
  }, [mappedFieldsList]);

  // Reset panning offset
  const handleResetView = () => {
    setPan({ x: 0, y: 0 });
  };

  const handleFetchAccessionValue = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const queryVal = promptAccessionValue.trim();
    if (!queryVal) {
      setPromptError("Please enter a search value.");
      return;
    }

    setPromptLoading(true);
    setPromptError("");
    try {
      // 1. Ultra-fast local check in dbRecords cache (< 1ms instant response)
      if (dbRecords && dbRecords.length > 0) {
        const queryLower = queryVal.toLowerCase();
        const localMatch = dbRecords.find(rec => {
          for (const [k, v] of Object.entries(rec)) {
            if (v !== undefined && v !== null && String(v).trim().toLowerCase() === queryLower) {
              return true;
            }
          }
          return false;
        });

        if (localMatch) {
          if (onSelectRecord) {
            onSelectRecord(localMatch);
          }
          onPreviewModeChange("live");
          setShowAccessionPrompt(false);
          if (onLogMessage) {
            onLogMessage("success", `Loaded live preview for ${selectedSearchFieldKey}: ${queryVal}`);
          }
          return;
        }
      }

      if (!activeProfile) {
        onPreviewModeChange("live");
        setShowAccessionPrompt(false);
        if (onLogMessage) {
          onLogMessage("info", "No active database connection profile. Displaying live preview.");
        }
        return;
      }

      const mappedField = mappedFieldsList.find(f => f.key === selectedSearchFieldKey);
      const searchColumn = mappedField ? mappedField.physical : (activeProfile.uniqueField || "AccessionNo");

      // 2-second fast query execution
      const queryPromise = electronAPI.dbQueryRecord(
        activeProfile,
        activeProfile.table,
        searchColumn,
        queryVal
      );

      const timeoutPromise = new Promise<{ success: false; message: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, message: "Database query timed out (server did not respond in 2 seconds)." }), 2000)
      );

      const data: any = await Promise.race([queryPromise, timeoutPromise]);

      if (data && data.success && data.record) {
        const mappedRecord: any = { ...data.record };
        const fieldMappings = activeProfile.fieldMappings || {};
        Object.entries(fieldMappings).forEach(([logicalKey, physCol]) => {
          if (physCol && data.record[physCol] !== undefined) {
            mappedRecord[logicalKey] = String(data.record[physCol]);
          }
        });

        if (onSelectRecord) {
          onSelectRecord(mappedRecord);
        }
        onPreviewModeChange("live");
        setShowAccessionPrompt(false);
        if (onLogMessage) {
          onLogMessage("success", `Loaded live preview for ${selectedSearchFieldKey}: ${queryVal}`);
        }
      } else {
        setPromptError(data?.message || `No record found in table "${activeProfile.table}" where "${selectedSearchFieldKey}" (${searchColumn}) matches "${queryVal}".`);
      }
    } catch (err: any) {
      setPromptError(`Query failed: ${err?.message || err}`);
    } finally {
      setPromptLoading(false);
    }
  };

  // Parse binding fields. Show appropriate placeholder based on mode and data availability.
  const getRenderedText = (element: LabelElement, recordOverride?: DatabaseRecord | null): string => {
    const record = recordOverride !== undefined 
      ? recordOverride 
      : (activeRecord || (dbRecords && dbRecords.length > 0 ? dbRecords[0] : null));

    if (element.fieldName) {
      // ---- Template Mode: Show raw field token ----
      if (previewMode === "template") {
        return `${element.fieldName}`;
      }

      // ---- Live Mode with Loaded Record: Show Real Data ----
      if (record) {
        const lower = element.fieldName.toLowerCase();
        let dbVal = "";

        // 1. Direct or case-insensitive key match
        for (const key of Object.keys(record)) {
          if (key.toLowerCase() === lower) {
            dbVal = String(record[key] ?? "");
            break;
          }
        }

        // 2. Check profile field mappings if direct match failed
        if (!dbVal && activeProfile?.fieldMappings) {
          const physCol = activeProfile.fieldMappings[element.fieldName] || activeProfile.fieldMappings[lower];
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

        if (dbVal !== "") {
          return `${element.prefix || ""}${dbVal}${element.suffix || ""}`;
        }
      }

      // ---- Live Mode without Loaded Record: Show Realistic Sample Placeholder Text ----
      const fieldLower = element.fieldName.toLowerCase();
      let sampleValue = element.fieldName;

      if (fieldLower.includes("acc") || fieldLower.includes("accession")) {
        sampleValue = "888102765866";
      } else if (fieldLower.includes("title") || fieldLower.includes("name")) {
        sampleValue = "Introduction to Algorithms";
      } else if (fieldLower.includes("author") || fieldLower.includes("writer")) {
        sampleValue = "Thomas H. Cormen";
      } else if (fieldLower.includes("publisher")) {
        sampleValue = "MIT Press";
      } else if (fieldLower.includes("isbn")) {
        sampleValue = "9780262033848";
      } else if (fieldLower.includes("class") || fieldLower.includes("dewey")) {
        sampleValue = "005.1";
      } else if (fieldLower.includes("book") && fieldLower.includes("no")) {
        sampleValue = "COR/I";
      } else if (fieldLower.includes("price") || fieldLower.includes("cost")) {
        sampleValue = "$89.99";
      } else if (fieldLower.includes("edition")) {
        sampleValue = "3rd Edition";
      } else if (fieldLower.includes("year") || fieldLower.includes("date")) {
        sampleValue = "2009";
      } else if (fieldLower.includes("status")) {
        sampleValue = "Available";
      } else if (fieldLower.includes("location") || fieldLower.includes("shelf")) {
        sampleValue = "Stack A-1";
      } else if (fieldLower.includes("barcode") || fieldLower.includes("code")) {
        sampleValue = "123456789012";
      }

      return `${element.prefix || ""}${sampleValue}${element.suffix || ""}`;
    }

    // No field binding — use static text
    return element.text || "TEXT";
  };

  // Click on horizontal ruler to toggle vertical guide line
  const handleHorizontalRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left - 24; // offset pl-6 (24px)
    const mmValue = (localX - canvasLeftPx) / mmToPx;
    if (mmValue >= 0 && mmValue <= widthMm) {
      const roundedMm = parseFloat(mmValue.toFixed(1));
      setXGuides((prev) => {
        const existsIdx = prev.findIndex((g) => Math.abs(g - roundedMm) < 1.5);
        if (existsIdx !== -1) {
          return prev.filter((_, i) => i !== existsIdx);
        }
        return [...prev, roundedMm];
      });
    }
  };

  // Click on vertical ruler to toggle horizontal guide line
  const handleVerticalRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localY = e.clientY - rect.top;
    const mmValue = (localY - canvasTopPx) / mmToPx;
    if (mmValue >= 0 && mmValue <= heightMm) {
      const roundedMm = parseFloat(mmValue.toFixed(1));
      setYGuides((prev) => {
        const existsIdx = prev.findIndex((g) => Math.abs(g - roundedMm) < 1.5);
        if (existsIdx !== -1) {
          return prev.filter((_, i) => i !== existsIdx);
        }
        return [...prev, roundedMm];
      });
    }
  };

  // Dragging or Resizing element
  const handleMouseDown = (
    e: React.MouseEvent,
    element: LabelElement,
    action: "move" | "resize" | "rotate",
    handle?: string,
  ) => {
    if (toolMode === "pan") return; // Cannot edit elements while panning tool is active
    if (element.locked && action === "move") return;
    e.stopPropagation();
    e.preventDefault();

    // Blur active elements to ensure focus resets to document body
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    if (onStartHistoryAction) {
      onStartHistoryAction();
    }

    let nextIds = [...selectedIds];
    if (e.shiftKey) {
      if (nextIds.includes(element.id)) {
        nextIds = nextIds.filter((id) => id !== element.id);
      } else {
        nextIds.push(element.id);
      }
    } else {
      if (!nextIds.includes(element.id)) {
        nextIds = [element.id];
      }
    }
    setSelectedIds(nextIds);
    onSelectElement(nextIds[nextIds.length - 1] || null);

    const idsToDrag = nextIds;
    const startPositions = idsToDrag.map((id) => {
      const el = elements.find((item) => item.id === id);
      return {
        id,
        x: el ? el.x : 0,
        y: el ? el.y : 0,
        locked: el ? el.locked : false,
      };
    });

    setDragState({
      elementId: element.id,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: element.x,
      startTop: element.y,
      startWidth: element.width,
      startHeight: element.height,
      startRotation: element.rotation || 0,
      startFontSize: element.fontSize || 10,
      action,
      handle,
      startPositions,
    });
  };

  // Handle Workspace Mouse Down (for panning and marquee selection)
  const handleWorkspaceMouseDown = (e: React.MouseEvent) => {
    // Blur active elements to ensure focus resets to document body
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    // If middle button (button 1) or pan tool is active
    if (e.button === 1 || toolMode === "pan") {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (toolMode === "select" && e.button === 0) {
      // Start drag-to-select marquee box!
      setSelectBox({
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
      });
    }
  };

  // Document-level mouse listeners for perfect dragging & panning mechanics
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (selectBox) {
        setSelectBox((prev) =>
          prev
            ? {
                ...prev,
                currentX: e.clientX,
                currentY: e.clientY,
              }
            : null,
        );
        return;
      }

      if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
        return;
      }

      if (!dragState) return;
      const element = elements.find((el) => el.id === dragState.elementId);
      if (!element) return;

      let dx = (e.clientX - dragState.startX) / mmToPx;
      let dy = (e.clientY - dragState.startY) / mmToPx;

      // Un-apply mirror and rotation to match visual dragging
      // CSS transform: scaleX(-1) rotate(...)
      // So v_canvas = rotate(-ang) * scaleX(-1) * v_screen

      if (mirrorImage) {
        dx = -dx;
      }

      if (orientation === "landscape") {
        // rotate(90) -> we need rotate(-90)
        // x' = y, y' = -x
        const temp = dx;
        dx = dy;
        dy = -temp;
      } else if (orientation === "landscape-180") {
        // rotate(270) -> we need rotate(-270) or +90
        // x' = -y, y' = x
        const temp = dx;
        dx = -dy;
        dy = temp;
      } else if (orientation === "portrait-180") {
        // rotate(180) -> rotate(-180)
        dx = -dx;
        dy = -dy;
      }

      if (dragState.action === "move") {
        let newX = dragState.startLeft + dx;
        let newY = dragState.startTop + dy;

        let snappedX = false;
        let snappedY = false;

        if (snapToGrid) {
          const snapThreshold = 8 / mmToPx; // 8 screen pixels threshold

          // 1. Gather all alignment candidates for X (vertical guide lines)
          const xCandidates = [
            { val: 0, label: "canvas-left" },
            { val: widthMm / 2, label: "canvas-center" },
            { val: widthMm, label: "canvas-right" },
          ];

          elements.forEach((other) => {
            if (other.id === element.id || !other.visible) return;
            xCandidates.push({ val: other.x, label: "element-left" });
            xCandidates.push({
              val: other.x + other.width / 2,
              label: "element-center",
            });
            xCandidates.push({
              val: other.x + other.width,
              label: "element-right",
            });
          });

          // 2. Gather all alignment candidates for Y (horizontal guide lines)
          const yCandidates = [
            { val: 0, label: "canvas-top" },
            { val: heightMm / 2, label: "canvas-center" },
            { val: heightMm, label: "canvas-bottom" },
          ];

          elements.forEach((other) => {
            if (other.id === element.id || !other.visible) return;
            yCandidates.push({ val: other.y, label: "element-top" });
            yCandidates.push({
              val: other.y + other.height / 2,
              label: "element-center",
            });
            yCandidates.push({
              val: other.y + other.height,
              label: "element-bottom",
            });
          });

          // 3. Check X-Anchors (Left, Center, Right of dragged object) vs candidates
          let bestSnapX = null;
          let bestDiffX = snapThreshold;

          const myXAnchors = [
            { val: newX, offset: 0 },
            { val: newX + element.width / 2, offset: -element.width / 2 },
            { val: newX + element.width, offset: -element.width },
          ];

          myXAnchors.forEach((myAnchor) => {
            xCandidates.forEach((cand) => {
              const diff = Math.abs(myAnchor.val - cand.val);
              if (diff < bestDiffX) {
                bestDiffX = diff;
                bestSnapX = cand.val + myAnchor.offset;
              }
            });
          });

          if (bestSnapX !== null) {
            newX = bestSnapX;
            snappedX = true;
          }

          // 4. Check Y-Anchors (Top, Center, Bottom of dragged object) vs candidates
          let bestSnapY = null;
          let bestDiffY = snapThreshold;

          const myYAnchors = [
            { val: newY, offset: 0 },
            { val: newY + element.height / 2, offset: -element.height / 2 },
            { val: newY + element.height, offset: -element.height },
          ];

          myYAnchors.forEach((myAnchor) => {
            yCandidates.forEach((cand) => {
              const diff = Math.abs(myAnchor.val - cand.val);
              if (diff < bestDiffY) {
                bestDiffY = diff;
                bestSnapY = cand.val + myAnchor.offset;
              }
            });
          });

          if (bestSnapY !== null) {
            newY = bestSnapY;
            snappedY = true;
          }

          // 5. Spacing & Equal Gap Horizontal Snap Solver (Only if not snapped to standard edges)
          if (!snappedX) {
            const sortedOthersX = elements
              .filter((el) => el.id !== element.id && el.visible)
              .sort((a, b) => a.x - b.x);

            for (let i = 0; i < sortedOthersX.length; i++) {
              for (let j = i + 1; j < sortedOthersX.length; j++) {
                const el1 = sortedOthersX[i];
                const el2 = sortedOthersX[j];

                // Case 1: Dragged element is between el1 and el2
                if (
                  newX >= el1.x + el1.width &&
                  newX + element.width <= el2.x
                ) {
                  const targetLeft =
                    (el2.x + el1.x + el1.width - element.width) / 2;
                  if (Math.abs(newX - targetLeft) < snapThreshold) {
                    newX = targetLeft;
                    snappedX = true;
                    break;
                  }
                }
                // Case 2: Dragged element is to the right of el2, matching the el1-el2 gap
                else if (newX >= el2.x + el2.width) {
                  const gap = el2.x - (el1.x + el1.width);
                  const targetLeft = el2.x + el2.width + gap;
                  if (gap > 0 && Math.abs(newX - targetLeft) < snapThreshold) {
                    newX = targetLeft;
                    snappedX = true;
                    break;
                  }
                }
              }
              if (snappedX) break;
            }
          }

          // 6. Spacing & Equal Gap Vertical Snap Solver (Only if not snapped to standard edges)
          if (!snappedY) {
            const sortedOthersY = elements
              .filter((el) => el.id !== element.id && el.visible)
              .sort((a, b) => a.y - b.y);

            for (let i = 0; i < sortedOthersY.length; i++) {
              for (let j = i + 1; j < sortedOthersY.length; j++) {
                const el1 = sortedOthersY[i];
                const el2 = sortedOthersY[j];

                // Case 1: Dragged element is between el1 and el2
                if (
                  newY >= el1.y + el1.height &&
                  newY + element.height <= el2.y
                ) {
                  const targetTop =
                    (el2.y + el1.y + el1.height - element.height) / 2;
                  if (Math.abs(newY - targetTop) < snapThreshold) {
                    newY = targetTop;
                    snappedY = true;
                    break;
                  }
                }
                // Case 2: Dragged element is below el2, matching the el1-el2 gap
                else if (newY >= el2.y + el2.height) {
                  const gap = el2.y - (el1.y + el1.height);
                  const targetTop = el2.y + el2.height + gap;
                  if (gap > 0 && Math.abs(newY - targetTop) < snapThreshold) {
                    newY = targetTop;
                    snappedY = true;
                    break;
                  }
                }
              }
              if (snappedY) break;
            }
          }
        }

        // Bound to canvas limits - removed to allow dragging anywhere
        const displacedDx = newX - dragState.startLeft;
        const displacedDy = newY - dragState.startTop;

        // Linked elements: dragging any element in an anchor chain translates its
        // root parent so the entire aligned group moves together as one unit.
        const draggedEl = elements.find((el) => el.id === dragState.elementId);
        if (draggedEl && draggedEl.parentId) {
          const root = findRootParent(elements, draggedEl.id);
          if (root && root.id !== draggedEl.id) {
            const updatesMap: Record<string, Partial<LabelElement>> = {
              [root.id]: {
                x: parseFloat((root.x + displacedDx).toFixed(2)),
                y: parseFloat((root.y + displacedDy).toFixed(2)),
              },
            };
            if (onUpdateElements) {
              onUpdateElements(updatesMap);
            } else {
              onUpdateElement(root.id, updatesMap[root.id]);
            }
            return;
          }
        }

        if (dragState.startPositions && dragState.startPositions.length > 0) {
          const updatesMap: Record<string, Partial<LabelElement>> = {};
          dragState.startPositions.forEach((p) => {
            if (p.locked) return;
            const elObj = elements.find((item) => item.id === p.id);
            if (!elObj) return;
            let elNewX = p.x + displacedDx;
            let elNewY = p.y + displacedDy;
            // Bound each individual element within the canvas limits - removed to allow dragging anywhere
            updatesMap[p.id] = { x: elNewX, y: elNewY };
          });

          if (onUpdateElements) {
            onUpdateElements(updatesMap);
          } else {
            Object.entries(updatesMap).forEach(([id, updates]) => {
              onUpdateElement(id, updates);
            });
          }
        } else {
          onUpdateElement(element.id, { x: newX, y: newY });
        }
      } else if (dragState.action === "resize" && dragState.handle) {
        const handle = dragState.handle;
        let newX = dragState.startLeft;
        let newY = dragState.startTop;
        let newW = dragState.startWidth;
        let newH = dragState.startHeight;

        if (element.rotation && element.rotation !== 0) {
          // Resizing a rotated element: work in its local coordinate space
          const angle = element.rotation;
          const rad = (angle * Math.PI) / 180;

          // Project the canvas-space dx, dy into the element's rotated local space
          const localDx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
          const localDy = dx * Math.sin(-rad) + dy * Math.cos(-rad);

          let localCxShift = 0;
          let localCyShift = 0;

          if (handle.includes("r")) {
            const maxDx = -dragState.startWidth + 2;
            const clampedLocalDx = Math.max(maxDx, localDx);
            newW = dragState.startWidth + clampedLocalDx;
            localCxShift = clampedLocalDx / 2;
          } else if (handle.includes("l")) {
            const maxDx = dragState.startWidth - 2;
            const clampedLocalDx = Math.min(maxDx, localDx);
            newW = dragState.startWidth - clampedLocalDx;
            localCxShift = clampedLocalDx / 2;
          }

          if (handle.includes("b")) {
            const maxDy = -dragState.startHeight + 2;
            const clampedLocalDy = Math.max(maxDy, localDy);
            newH = dragState.startHeight + clampedLocalDy;
            localCyShift = clampedLocalDy / 2;
          } else if (handle.includes("t")) {
            const maxDy = dragState.startHeight - 2;
            const clampedLocalDy = Math.min(maxDy, localDy);
            newH = dragState.startHeight - clampedLocalDy;
            localCyShift = clampedLocalDy / 2;
          }

          if (["tl", "tr", "bl", "br"].includes(handle)) {
            const scale = newW / dragState.startWidth;
            newH = dragState.startHeight * scale;
            if (handle.includes("b")) {
              localCyShift = (newH - dragState.startHeight) / 2;
            } else if (handle.includes("t")) {
              localCyShift = -(newH - dragState.startHeight) / 2;
            }
          }

          // Convert local center shift back to canvas-space center shift
          const globalCxShift =
            localCxShift * Math.cos(rad) - localCyShift * Math.sin(rad);
          const globalCyShift =
            localCxShift * Math.sin(rad) + localCyShift * Math.cos(rad);

          const oldCx = dragState.startLeft + dragState.startWidth / 2;
          const oldCy = dragState.startTop + dragState.startHeight / 2;
          const newCx = oldCx + globalCxShift;
          const newCy = oldCy + globalCyShift;

          newX = newCx - newW / 2;
          newY = newCy - newH / 2;
        } else {
          // Snapping logic during resizing for unrotated elements
          if (snapToGrid) {
            const snapThreshold = 8 / mmToPx;

            // X candidates for resizing
            const xCandidates = [0, widthMm / 2, widthMm];
            elements.forEach((other) => {
              if (other.id === element.id || !other.visible) return;
              xCandidates.push(
                other.x,
                other.x + other.width / 2,
                other.x + other.width,
              );
            });

            // Y candidates for resizing
            const yCandidates = [0, heightMm / 2, heightMm];
            elements.forEach((other) => {
              if (other.id === element.id || !other.visible) return;
              yCandidates.push(
                other.y,
                other.y + other.height / 2,
                other.y + other.height,
              );
            });

            if (handle.includes("r")) {
              let currentRight =
                dragState.startLeft + dragState.startWidth + dx;
              let bestRight = currentRight;
              let bestDiff = snapThreshold;
              xCandidates.forEach((cand) => {
                const diff = Math.abs(currentRight - cand);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestRight = cand;
                }
              });
              newW = Math.max(2, bestRight - dragState.startLeft);
            } else if (handle.includes("l")) {
              let currentLeft = dragState.startLeft + dx;
              let bestLeft = currentLeft;
              let bestDiff = snapThreshold;
              xCandidates.forEach((cand) => {
                const diff = Math.abs(currentLeft - cand);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestLeft = cand;
                }
              });
              const clampedLeft = Math.min(
                dragState.startLeft + dragState.startWidth - 2,
                bestLeft,
              );
              newX = clampedLeft;
              newW = dragState.startWidth - (clampedLeft - dragState.startLeft);
            }

            if (handle.includes("b")) {
              let currentBottom =
                dragState.startTop + dragState.startHeight + dy;
              let bestBottom = currentBottom;
              let bestDiff = snapThreshold;
              yCandidates.forEach((cand) => {
                const diff = Math.abs(currentBottom - cand);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestBottom = cand;
                }
              });
              newH = Math.max(2, bestBottom - dragState.startTop);
            } else if (handle.includes("t")) {
              let currentTop = dragState.startTop + dy;
              let bestTop = currentTop;
              let bestDiff = snapThreshold;
              yCandidates.forEach((cand) => {
                const diff = Math.abs(currentTop - cand);
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestTop = cand;
                }
              });
              const clampedTop = Math.min(
                dragState.startTop + dragState.startHeight - 2,
                bestTop,
              );
              newY = clampedTop;
              newH = dragState.startHeight - (clampedTop - dragState.startTop);
            }
          } else {
            // Standard no-snapping resizing
            if (handle.includes("r")) {
              newW = Math.max(2, dragState.startWidth + dx);
            }
            if (handle.includes("b")) {
              newH = Math.max(2, dragState.startHeight + dy);
            }
            if (handle.includes("l")) {
              const maxDx = dragState.startWidth - 2;
              const clampedDx = Math.min(maxDx, dx);
              newX = dragState.startLeft + clampedDx;
              newW = dragState.startWidth - clampedDx;
            }
            if (handle.includes("t")) {
              const maxDy = dragState.startHeight - 2;
              const clampedDy = Math.min(maxDy, dy);
              newY = dragState.startTop + clampedDy;
              newH = dragState.startHeight - clampedDy;
            }
          }

          const isCorner = ["tl", "tr", "bl", "br"].includes(handle);
          if (isCorner) {
            const scale = newW / dragState.startWidth;
            newH = dragState.startHeight * scale;
            if (handle.includes("t")) {
              newY = dragState.startTop + (dragState.startHeight - newH);
            } else {
              newY = dragState.startTop;
            }
          }
        } // Close the else block for unrotated logic

        const isCorner = ["tl", "tr", "bl", "br"].includes(handle);
        const updates: Partial<LabelElement> = {
          x: Math.max(0, newX),
          y: Math.max(0, newY),
          width: Math.max(2, newW),
          height: Math.max(2, newH),
        };

        if ((element.type === "text" || element.type === "barcode") && isCorner && dragState.startFontSize) {
          const scale = newW / dragState.startWidth;
          updates.fontSize = Math.max(4, parseFloat((dragState.startFontSize * scale).toFixed(1)));
        }

        onUpdateElement(element.id, updates);
      } else if (dragState.action === "rotate") {
        const elCenterX = dragState.startLeft + dragState.startWidth / 2;
        const elCenterY = dragState.startTop + dragState.startHeight / 2;

        // Find handle's original position in element space
        const R = dragState.startHeight / 2 + 24 / mmToPx;
        const rad = (dragState.startRotation || 0) * (Math.PI / 180);

        // Unrotated handle is at (0, -R). Rotated:
        const handleInitialCanvasX = elCenterX + R * Math.sin(rad);
        const handleInitialCanvasY = elCenterY - R * Math.cos(rad);

        const currentMouseCanvasX = handleInitialCanvasX + dx;
        const currentMouseCanvasY = handleInitialCanvasY + dy;

        // Calculate new angle from center to mouse
        let angle =
          Math.atan2(
            currentMouseCanvasY - elCenterY,
            currentMouseCanvasX - elCenterX,
          ) *
          (180 / Math.PI);
        angle += 90; // Add 90 so that 'straight up' (12 o'clock) is 0 degrees

        let finalAngle = Math.round(angle);

        // Optional snap to 15 degrees with shift key
        if (e.shiftKey) {
          finalAngle = Math.round(finalAngle / 15) * 15;
        }

        // Normalize to 0-359
        finalAngle = ((finalAngle % 360) + 360) % 360;

        // Soft snap to 0, 90, 180, 270 degrees if within 3 degrees (makes it perfect without shift)
        if (!e.shiftKey) {
          const snapThreshold = 3;
          if (
            Math.abs(finalAngle - 0) <= snapThreshold ||
            Math.abs(finalAngle - 360) <= snapThreshold
          )
            finalAngle = 0;
          else if (Math.abs(finalAngle - 90) <= snapThreshold) finalAngle = 90;
          else if (Math.abs(finalAngle - 180) <= snapThreshold)
            finalAngle = 180;
          else if (Math.abs(finalAngle - 270) <= snapThreshold)
            finalAngle = 270;
        }

        onUpdateElement(element.id, { rotation: finalAngle });
      }
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      setDragState(null);

      if (selectBox) {
        const x1 = Math.min(selectBox.startX, selectBox.currentX);
        const y1 = Math.min(selectBox.startY, selectBox.currentY);
        const x2 = Math.max(selectBox.startX, selectBox.currentX);
        const y2 = Math.max(selectBox.startY, selectBox.currentY);

        const width = x2 - x1;
        const height = y2 - y1;

        if (width > 2 && height > 2) {
          const selected: string[] = [];
          const workspaceRect = workspaceRef.current?.getBoundingClientRect();

          if (workspaceRect) {
            elements.forEach((el) => {
              if (!el.visible) return;

              // Compute screen bounds of element
              const elLeft = workspaceRect.left + canvasLeftPx + el.x * mmToPx;
              const elTop = workspaceRect.top + canvasTopPx + el.y * mmToPx;
              const elWidth = el.width * mmToPx;
              const elHeight = el.height * mmToPx;

              const elRight = elLeft + elWidth;
              const elBottom = elTop + elHeight;

              // Check overlap
              const overlaps = !(
                elRight < x1 ||
                elLeft > x2 ||
                elBottom < y1 ||
                elTop > y2
              );

              if (overlaps) {
                selected.push(el.id);
              }
            });

            setSelectedIds(selected);
            if (selected.length > 0) {
              onSelectElement(selected[selected.length - 1]);
            } else {
              onSelectElement(null);
            }
          }
          
          dragSelectCompletedRef.current = true;
          setTimeout(() => {
            dragSelectCompletedRef.current = false;
          }, 100);
        }
        setSelectBox(null);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    dragState,
    isPanning,
    panStart,
    elements,
    mmToPx,
    snapToGrid,
    gridSizeMm,
    widthMm,
    heightMm,
    xGuides,
    yGuides,
    activeGuideLines,
    selectBox,
    selectedIds,
    onSelectElement,
    toolMode,
  ]);

  // Click outside elements to deselect
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (toolMode === "pan") return;
    if (dragSelectCompletedRef.current) return;
    if (e.target === canvasRef.current || e.target === workspaceRef.current) {
      setSelectedIds([]);
      onSelectElement(null);
    }
  };

  // Real-time alignment lines to render visually
  const activeVerticalGuides: number[] = [];
  const activeHorizontalGuides: number[] = [];
  const spacingGuides: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    value: number;
    type: "h" | "v";
  }> = [];

  if (
    snapToGrid &&
    dragState &&
    (dragState.action === "move" || dragState.action === "resize")
  ) {
    const dragged = elements.find((el) => el.id === dragState.elementId);
    if (dragged) {
      const matchThreshold = 0.25; // tight match threshold in mm

      const xCandidates = [
        { val: 0, label: "canvas-left" },
        { val: widthMm / 2, label: "canvas-center" },
        { val: widthMm, label: "canvas-right" },
      ];
      const yCandidates = [
        { val: 0, label: "canvas-top" },
        { val: heightMm / 2, label: "canvas-center" },
        { val: heightMm, label: "canvas-bottom" },
      ];

      elements.forEach((other) => {
        if (other.id === dragged.id || !other.visible) return;
        xCandidates.push({ val: other.x, label: "element-left" });
        xCandidates.push({
          val: other.x + other.width / 2,
          label: "element-center",
        });
        xCandidates.push({
          val: other.x + other.width,
          label: "element-right",
        });

        yCandidates.push({ val: other.y, label: "element-top" });
        yCandidates.push({
          val: other.y + other.height / 2,
          label: "element-center",
        });
        yCandidates.push({
          val: other.y + other.height,
          label: "element-bottom",
        });
      });

      const myXAnchors = [
        dragged.x,
        dragged.x + dragged.width / 2,
        dragged.x + dragged.width,
      ];
      const myYAnchors = [
        dragged.y,
        dragged.y + dragged.height / 2,
        dragged.y + dragged.height,
      ];

      myXAnchors.forEach((anch) => {
        xCandidates.forEach((cand) => {
          if (Math.abs(anch - cand.val) < matchThreshold) {
            if (!activeVerticalGuides.includes(cand.val)) {
              activeVerticalGuides.push(cand.val);
            }
          }
        });
      });

      myYAnchors.forEach((anch) => {
        yCandidates.forEach((cand) => {
          if (Math.abs(anch - cand.val) < matchThreshold) {
            if (!activeHorizontalGuides.includes(cand.val)) {
              activeHorizontalGuides.push(cand.val);
            }
          }
        });
      });

      // Spacing & distribution calculations
      // Horizontal gaps
      const horizontalOthers = elements
        .filter((el) => el.id !== dragged.id && el.visible)
        .sort((a, b) => a.x - b.x);

      for (let i = 0; i < horizontalOthers.length; i++) {
        for (let j = i + 1; j < horizontalOthers.length; j++) {
          const el1 = horizontalOthers[i];
          const el2 = horizontalOthers[j];

          // 1. Dragged is between el1 and el2
          if (
            dragged.x >= el1.x + el1.width &&
            dragged.x + dragged.width <= el2.x
          ) {
            const g1 = dragged.x - (el1.x + el1.width);
            const g2 = el2.x - (dragged.x + dragged.width);
            if (Math.abs(g1 - g2) < matchThreshold) {
              spacingGuides.push({
                x: el1.x + el1.width,
                y: Math.min(el1.y, dragged.y, el2.y) + 2,
                w: g1,
                h: 1,
                value: g1,
                type: "h",
              });
              spacingGuides.push({
                x: dragged.x + dragged.width,
                y: Math.min(el1.y, dragged.y, el2.y) + 2,
                w: g2,
                h: 1,
                value: g2,
                type: "h",
              });
            }
          }
          // 2. Dragged is to the right of el2, and el1-el2 gap matches el2-dragged gap
          else if (dragged.x >= el2.x + el2.width) {
            const g1 = el2.x - (el1.x + el1.width);
            const g2 = dragged.x - (el2.x + el2.width);
            if (Math.abs(g1 - g2) < matchThreshold) {
              spacingGuides.push({
                x: el1.x + el1.width,
                y: Math.min(el1.y, el2.y, dragged.y) + 2,
                w: g1,
                h: 1,
                value: g1,
                type: "h",
              });
              spacingGuides.push({
                x: el2.x + el2.width,
                y: Math.min(el1.y, el2.y, dragged.y) + 2,
                w: g2,
                h: 1,
                value: g2,
                type: "h",
              });
            }
          }
        }
      }

      // Vertical gaps
      const verticalOthers = elements
        .filter((el) => el.id !== dragged.id && el.visible)
        .sort((a, b) => a.y - b.y);

      for (let i = 0; i < verticalOthers.length; i++) {
        for (let j = i + 1; j < verticalOthers.length; j++) {
          const el1 = verticalOthers[i];
          const el2 = verticalOthers[j];

          // 1. Dragged is between el1 and el2
          if (
            dragged.y >= el1.y + el1.height &&
            dragged.y + dragged.height <= el2.y
          ) {
            const g1 = dragged.y - (el1.y + el1.height);
            const g2 = el2.y - (dragged.y + dragged.height);
            if (Math.abs(g1 - g2) < matchThreshold) {
              spacingGuides.push({
                x: Math.min(el1.x, dragged.x, el2.x) + 2,
                y: el1.y + el1.height,
                w: 1,
                h: g1,
                value: g1,
                type: "v",
              });
              spacingGuides.push({
                x: Math.min(el1.x, dragged.x, el2.x) + 2,
                y: dragged.y + dragged.height,
                w: 1,
                h: g2,
                value: g2,
                type: "v",
              });
            }
          }
          // 2. Dragged is below el2, and el1-el2 gap matches el2-dragged gap
          else if (dragged.y >= el2.y + el2.height) {
            const g1 = el2.y - (el1.y + el1.height);
            const g2 = dragged.y - (el2.y + el2.height);
            if (Math.abs(g1 - g2) < matchThreshold) {
              spacingGuides.push({
                x: Math.min(el1.x, el2.x, dragged.x) + 2,
                y: el1.y + el1.height,
                w: 1,
                h: g1,
                value: g1,
                type: "v",
              });
              spacingGuides.push({
                x: Math.min(el1.x, el2.x, dragged.x) + 2,
                y: el2.y + el2.height,
                w: 1,
                h: g2,
                value: g2,
                type: "v",
              });
            }
          }
        }
      }
    }
  }

  // Generate ticks for horizontal ruler over the entire viewport span, showing both positive and negative units
  const renderHorizontalTicks = () => {
    if (!workspaceSize.width) return null;
    const activeUnit = unit || 'mm';

    if (activeUnit === 'in') {
      const startInch = Math.floor((-canvasLeftPx / mmToPx) / 25.4 * 10);
      const endInch = Math.ceil(((workspaceSize.width - canvasLeftPx) / mmToPx) / 25.4 * 10);
      
      const safeStart = Math.max(-400, startInch);
      const safeEnd = Math.min(400, endInch);
      
      const ticks = [];
      for (let i = safeStart; i <= safeEnd; i++) {
        const inchVal = i / 10;
        const mmVal = inchVal * 25.4;
        const tickLeft = canvasLeftPx + mmVal * mmToPx;
        const isLabel = i % 10 === 0;
        const isMedium = i % 5 === 0;
        
        ticks.push(
          <div
            key={`h-tick-in-${i}`}
            className={`absolute border-l ${i === 0 ? "border-indigo-500 w-[1px]" : "border-metro-border/60"}`}
            style={{
              left: `${tickLeft}px`,
              height: isLabel ? "11px" : isMedium ? "7px" : "4px",
              bottom: 0,
            }}
          >
            {isLabel && (
              <span
                className={`absolute left-1 bottom-0.5 text-[8px] font-mono leading-none ${i === 0 ? "text-indigo-500 font-bold" : "text-metro-secondary"}`}
              >
                {inchVal}
              </span>
            )}
          </div>
        );
      }
      return ticks;
    } else {
      const startMm = Math.floor(-canvasLeftPx / mmToPx);
      const endMm = Math.ceil((workspaceSize.width - canvasLeftPx) / mmToPx);
      const isCm = activeUnit === 'cm';

      const ticks = [];
      const safeStartMm = Math.max(-1000, startMm);
      const safeEndMm = Math.min(1000, endMm);

      for (let mm = safeStartMm; mm <= safeEndMm; mm++) {
        const isLabel = mm % 10 === 0;
        const isMedium = mm % 5 === 0;
        const tickLeft = canvasLeftPx + mm * mmToPx;

        ticks.push(
          <div
            key={`h-tick-${mm}`}
            className={`absolute border-l ${mm === 0 ? "border-indigo-500 w-[1px]" : "border-metro-border/60"}`}
            style={{
              left: `${tickLeft}px`,
              height: isLabel ? "11px" : isMedium ? "7px" : "4px",
              bottom: 0,
            }}
          >
            {isLabel && (
              <span
                className={`absolute left-1 bottom-0.5 text-[8px] font-mono leading-none ${mm === 0 ? "text-indigo-500 font-bold" : "text-metro-secondary"}`}
              >
                {isCm ? mm / 10 : mm}
              </span>
            )}
          </div>,
        );
      }
      return ticks;
    }
  };

  // Generate ticks for vertical ruler over the entire viewport span, showing both positive and negative units
  const renderVerticalTicks = () => {
    if (!workspaceSize.height) return null;
    const activeUnit = unit || 'mm';

    if (activeUnit === 'in') {
      const startInch = Math.floor((-canvasTopPx / mmToPx) / 25.4 * 10);
      const endInch = Math.ceil(((workspaceSize.height - canvasTopPx) / mmToPx) / 25.4 * 10);
      
      const safeStart = Math.max(-400, startInch);
      const safeEnd = Math.min(400, endInch);
      
      const ticks = [];
      for (let i = safeStart; i <= safeEnd; i++) {
        const inchVal = i / 10;
        const mmVal = inchVal * 25.4;
        const tickTop = canvasTopPx + mmVal * mmToPx;
        const isLabel = i % 10 === 0;
        const isMedium = i % 5 === 0;
        
        ticks.push(
          <div
            key={`v-tick-in-${i}`}
            className={`absolute border-t ${i === 0 ? "border-indigo-500 h-[1px]" : "border-metro-border/60"} w-full`}
            style={{
              top: `${tickTop}px`,
              width: isLabel ? "11px" : isMedium ? "7px" : "4px",
              right: 0,
            }}
          >
            {isLabel && (
              <span
                className={`absolute right-0.5 top-0.5 text-[8px] font-mono leading-none rotate-90 ${i === 0 ? "text-indigo-500 font-bold" : "text-metro-secondary"}`}
              >
                {inchVal}
              </span>
            )}
          </div>
        );
      }
      return ticks;
    } else {
      const startMm = Math.floor(-canvasTopPx / mmToPx);
      const endMm = Math.ceil((workspaceSize.height - canvasTopPx) / mmToPx);
      const isCm = activeUnit === 'cm';

      const ticks = [];
      const safeStartMm = Math.max(-1000, startMm);
      const safeEndMm = Math.min(1000, endMm);

      for (let mm = safeStartMm; mm <= safeEndMm; mm++) {
        const isLabel = mm % 10 === 0;
        const isMedium = mm % 5 === 0;
        const tickTop = canvasTopPx + mm * mmToPx;

        ticks.push(
          <div
            key={`v-tick-${mm}`}
            className={`absolute border-t ${mm === 0 ? "border-indigo-500 h-[1px]" : "border-metro-border/60"} w-full`}
            style={{
              top: `${tickTop}px`,
              width: isLabel ? "11px" : isMedium ? "7px" : "4px",
              right: 0,
            }}
          >
            {isLabel && (
              <span
                className={`absolute right-0.5 top-0.5 text-[8px] font-mono leading-none rotate-90 ${mm === 0 ? "text-indigo-500 font-bold" : "text-metro-secondary"}`}
              >
                {isCm ? mm / 10 : mm}
              </span>
            )}
          </div>,
        );
      }
      return ticks;
    }
  };

  const renderElementContent = (el: LabelElement, renderedText: string) => {
    return (
      <div className={`w-full h-full relative ${(el.type === 'text' && !(el as any).wrapText) ? 'overflow-visible' : 'overflow-hidden'}`}>
        {el.type === "text" && (() => {
          const wrapEnabled = (el as any).wrapText === true;
          const baseFontSizePx = (el.fontSize || 10) * (25.4 / 72.0) * mmToPx;
          const finalFontSizePx = (el.autoShrink || el.smartFit)
            ? getAutoShrunkWrappedFontSize(
                renderedText,
                el.fontFamily || "Segoe UI",
                baseFontSizePx,
                el.width * mmToPx,
                el.height * mmToPx,
                wrapEnabled,
                el.fontWeight,
                el.fontStyle,
                el.smartFit,
                el.autoShrink
              )
            : baseFontSizePx;

          const isIndic = /[\u0900-\u0D7F\u0600-\u06FF]/.test(renderedText || "");

          return (
            <div
              className="h-full flex items-center select-none px-1"
              style={{
                fontFamily: el.fontFamily || "Segoe UI",
                fontSize: `${finalFontSizePx}px`,
                fontWeight: el.fontWeight || "normal",
                fontStyle: el.fontStyle || "normal",
                color: el.textColor || "#000000",
                lineHeight: isIndic ? 1.48 : 1.28,
                paddingTop: isIndic ? "2px" : "0px",
                paddingBottom: isIndic ? "2px" : "0px",
                whiteSpace: wrapEnabled ? "pre-wrap" : "nowrap",
                wordBreak: wrapEnabled ? "break-word" : "normal",
                width: wrapEnabled ? "100%" : "max-content",
                textAlign: el.textAlign || "left",
                justifyContent:
                  el.textAlign === "center"
                    ? "center"
                    : el.textAlign === "right"
                      ? "flex-end"
                      : "flex-start",
              }}
            >
              {renderedText}
            </div>
          );
        })()}

        {el.type === "barcode" && (
          <BarcodeRenderer
            value={renderedText}
            type={el.barcodeType || "code128"}
            showText={Boolean(el.showText)}
            width={el.width * mmToPx}
            height={el.height * mmToPx}
            barHeight={el.barHeight || 50}
            barWidth={el.barWidth || 0.35}
            fontSize={el.fontSize}
            elementWidthMm={el.width}
            elementHeightMm={el.height}
            mmToPx={mmToPx}
            autoSize={el.autoSize !== false}
            fontWeight={el.fontWeight}
            fontStyle={el.fontStyle}
            textMargin={el.textMargin}
          />
        )}

        {el.type === "qrcode" && (
          <QRCodeRenderer
            value={renderedText}
            width={el.width * mmToPx}
            height={el.height * mmToPx}
          />
        )}

        {el.type === "shape" && (
          <div className="w-full h-full">
            {el.shapeType === "ellipse" ? (
              <div
                className="w-full h-full"
                style={{
                  backgroundColor: el.fillColor || "#ffffff",
                  border: `${(el.strokeWidth || 1) * zoom}px solid ${el.strokeColor || "#000000"}`,
                  borderRadius: "50%",
                }}
              />
            ) : el.shapeType === "line" ? (
              <div className="w-full h-full flex items-center justify-center pointer-events-none">
                {el.height > el.width ? (
                  <div
                    style={{
                      width: "0px",
                      height: "100%",
                      borderLeft: `${(el.strokeWidth || 1) * zoom}px solid ${el.strokeColor || "#000000"}`,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "0px",
                      borderTop: `${(el.strokeWidth || 1) * zoom}px solid ${el.strokeColor || "#000000"}`,
                    }}
                  />
                )}
              </div>
            ) : (
              <div
                className="w-full h-full"
                style={{
                  backgroundColor: el.fillColor || "#ffffff",
                  border: `${(el.strokeWidth || 1) * zoom}px solid ${el.strokeColor || "#000000"}`,
                  borderRadius: "0px",
                }}
              />
            )}
          </div>
        )}

        {el.type === "line" && (
          <div className="w-full h-full flex items-center justify-center pointer-events-none">
            {el.height > el.width ? (
              <div
                style={{
                  width: "0px",
                  height: "100%",
                  borderLeft: `${(el.strokeWidth || 1) * zoom}px solid ${el.strokeColor || "#000000"}`,
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "0px",
                  borderTop: `${(el.strokeWidth || 1) * zoom}px solid ${el.strokeColor || "#000000"}`,
                }}
              />
            )}
          </div>
        )}

        {el.type === "image" && (
          <div className="w-full h-full flex items-center justify-center">
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
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 bg-metro-canvas flex flex-col overflow-hidden relative select-none font-sans" onClick={handleCanvasClick}>
      {/* Horizontal Ruler - click/tap to toggle guidelines */}
      <div
        onClick={handleHorizontalRulerClick}
        className="h-6 bg-metro-panel border-b border-metro-border flex relative overflow-hidden pl-6 shrink-0 z-10 cursor-col-resize select-none"
        title="Click on the ruler to drop/remove vertical guide lines"
      >
        <div className="absolute top-0 left-0 w-6 h-6 bg-metro-panel border-r border-metro-border z-20 flex items-center justify-center text-[8px] font-bold text-metro-secondary font-mono uppercase">
          {unit}
        </div>
        <div className="flex h-full w-full relative">
          {renderHorizontalTicks()}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Vertical Ruler - click/tap to toggle guidelines */}
        <div
          onClick={handleVerticalRulerClick}
          className="w-6 bg-metro-panel border-r border-metro-border h-full relative shrink-0 z-10 cursor-row-resize select-none"
          title="Click on the ruler to drop/remove horizontal guide lines"
        >
          <div className="flex flex-col h-full w-full relative">
            {renderVerticalTicks()}
          </div>
        </div>

        {/* Working area container with moveable canvas wrapper - Sleek Slate/Dark Gray backdrop */}
        <div
          ref={workspaceRef}
          onMouseDown={handleWorkspaceMouseDown}
          className={`flex-1 overflow-hidden outline-none relative select-none bg-[#313135] ${
            toolMode === "pan"
              ? isPanning
                ? "cursor-grabbing"
                : "cursor-grab"
              : ""
          }`}
        >
          {/* Vertical Toolbar on the top right of the canvas grey area */}
          <div className="absolute top-4 right-4 z-30 flex flex-col items-center bg-metro-panel border border-metro-border shadow-2xl rounded-xl p-1.5 gap-1.5 text-xs animate-fade-in">
            {/* Live Preview Toggle Button */}
            <button
              onClick={() => {
                if (previewMode === "live") {
                  onPreviewModeChange("template");
                  if (onLogMessage) {
                    onLogMessage("info", "Switched to Design View mode");
                  }
                } else {
                  setPromptAccessionValue("");
                  setPromptError("");
                  setShowAccessionPrompt(true);
                }
              }}
              className={`p-2 rounded-lg transition-all cursor-pointer border ${
                previewMode === "live"
                  ? "bg-indigo-500 border-indigo-400 text-white shadow-md shadow-indigo-500/25"
                  : "border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary"
              }`}
              title={
                previewMode === "live"
                  ? "Switch to Design View (Draft Mode)"
                  : "Enter Accession Number for Live Data Preview"
              }
            >
              <Eye className="w-4 h-4" />
            </button>

            {/* Query Specific Record Button */}
            <button
              onClick={() => {
                setPromptAccessionValue("");
                setPromptError("");
                setShowAccessionPrompt(true);
              }}
              className="p-2 rounded-lg border border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary transition-all cursor-pointer"
              title="Query Record from Database for Live View"
            >
              <Database className="w-4 h-4 text-indigo-400" />
            </button>

            <div className="w-full h-[1px] bg-metro-border/60"></div>

            {/* Smart Snapping Guides Toggle */}
            <button
              onClick={() => setActiveGuideLines((prev) => !prev)}
              className={`p-2 rounded-lg transition-all cursor-pointer border ${
                activeGuideLines
                  ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                  : "border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary"
              }`}
              title={
                activeGuideLines
                  ? "Disable Smart Snapping Guides"
                  : "Enable Smart Snapping Guides"
              }
            >
              <Grid className="w-4 h-4" />
            </button>

            {/* Smart Snapping Alignment Toggle */}
            <button
              onClick={() => onToggleSnapToGrid && onToggleSnapToGrid()}
              className={`p-2 rounded-lg transition-all cursor-pointer border ${
                snapToGrid
                  ? "bg-indigo-500 border-indigo-400 text-white shadow-md"
                  : "border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary"
              }`}
              title={
                snapToGrid
                  ? "Disable Alignment Hints"
                  : "Enable Alignment Hints"
              }
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {/* Clear Guides Button */}
            {(xGuides.length > 0 || yGuides.length > 0) && (
              <button
                onClick={() => {
                  setXGuides([]);
                  setYGuides([]);
                }}
                className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all cursor-pointer"
                title="Clear Ruler Guidelines"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <div className="w-full h-[1px] bg-metro-border/60"></div>

            {/* Selection Tool */}
            <button
              onClick={() => {
                setToolMode("select");
                onSelectElement(null);
              }}
              className={`p-2 rounded-lg transition-all cursor-pointer border ${
                toolMode === "select"
                  ? "bg-metro-accent border-metro-accent/30 text-white shadow-md"
                  : "border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary"
              }`}
              title="Pointer selection tool (V)"
            >
              <MousePointer className="w-4 h-4" />
            </button>

            {/* Hand Tool */}
            <button
              onClick={() => setToolMode("pan")}
              className={`p-2 rounded-lg transition-all cursor-pointer border ${
                toolMode === "pan"
                  ? "bg-metro-accent border-metro-accent/30 text-white shadow-md"
                  : "border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary"
              }`}
              title="Hand panning tool (Space)"
            >
              <Hand className="w-4 h-4" />
            </button>

            <div className="w-full h-[1px] bg-metro-border/60"></div>

            {/* Reset Offset/View */}
            <button
              onClick={handleResetView}
              className="p-2 rounded-lg border border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary transition-all cursor-pointer"
              title="Reset View Zoom & Offset"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Rotate Canvas Button */}
            <button
              onClick={() => {
                const rotationMap: Record<string, 'portrait' | 'landscape' | 'portrait-180' | 'landscape-180'> = {
                  "portrait": "landscape",
                  "landscape": "portrait-180",
                  "portrait-180": "landscape-180",
                  "landscape-180": "portrait"
                };
                const nextOrientation = rotationMap[orientation] || "portrait";
                onUpdateOrientation?.(nextOrientation);
                onLogMessage?.("info", `Rotated canvas orientation to ${nextOrientation}`);
              }}
                className="p-2 rounded-lg border border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary transition-all cursor-pointer"
                title="Rotate Entire Canvas 90° Clockwise"
              >
                <RotateCw className="w-4 h-4 text-indigo-400" />
              </button>

            {/* Separator Guides Toggle */}
            <button
              onClick={() => setShowSepPanel((p) => !p)}
              className={`p-2 rounded-lg transition-all cursor-pointer border ${
                showSepPanel
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  : "border-transparent text-metro-secondary hover:bg-metro-input hover:text-metro-primary"
              }`}
              title="Separator Guides — visual only, not printed"
            >
              <Minus className="w-4 h-4" />
            </button>
          </div>

          {/* Separator Guides Control Panel (visual only — never printed) */}
          {showSepPanel && (
            <div className="absolute top-4 right-20 z-40 w-60 bg-metro-panel border border-metro-border shadow-2xl rounded-xl p-3 space-y-2.5 text-metro-primary animate-fade-in">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-bold uppercase tracking-wider font-mono text-metro-secondary">
                  Separator Guides
                </h4>
                <button
                  onClick={() => setShowSepPanel(false)}
                  className="text-metro-secondary hover:text-metro-primary cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[9px] text-metro-secondary leading-tight">
                Visual guide only — never sent to print or export.
              </p>

              <div className="flex gap-1">
                {(["vertical", "horizontal"] as const).map((o) => (
                  <button
                    key={o}
                    onClick={() => setSepOrientation(o)}
                    className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all cursor-pointer ${
                      sepOrientation === o
                        ? "bg-amber-500/15 border border-amber-500/40 text-amber-300"
                        : "bg-metro-input border border-metro-border text-metro-secondary hover:text-metro-primary"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5">
                <input
                  type="number"
                  value={sepValue}
                  onChange={(e) => setSepValue(e.target.value)}
                  placeholder="25"
                  className="flex-1 min-w-0 bg-metro-input border border-metro-border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-amber-500"
                />
                <select
                  value={sepUnit}
                  onChange={(e) => setSepUnit(e.target.value as GuideUnit)}
                  className="bg-metro-input border border-metro-border rounded-lg px-2 py-1.5 text-xs font-mono outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="mm">mm</option>
                  <option value="in">in</option>
                  <option value="cm">cm</option>
                </select>
              </div>

              <button
                onClick={addSeparatorGuide}
                className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition-all cursor-pointer"
              >
                Add Separator Line
              </button>

              {separatorGuides.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                  {separatorGuides.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between bg-metro-input/50 border border-metro-border rounded-lg px-2 py-1"
                    >
                      <span className="text-[9px] font-mono text-metro-secondary uppercase">
                        {g.orientation} · {fromMm(g.positionMm, sepUnit).toFixed(1)}
                        {sepUnit}
                      </span>
                      <button
                        onClick={() =>
                          setSeparatorGuides((prev) =>
                            prev.filter((x) => x.id !== g.id),
                          )
                        }
                        className="text-red-400 hover:text-red-300 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setSeparatorGuides([])}
                    className="w-full text-[9px] text-red-400 hover:text-red-300 font-semibold uppercase tracking-wider"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Active Canvas Board - SIMPLE SPACE */}
          <div
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="bg-white border border-metro-border absolute select-none shadow-2xl"
            style={{
              width: `${widthPx}px`,
              height: `${heightPx}px`,
              left: `${canvasLeftPx}px`,
              top: `${canvasTopPx}px`,
              cursor:
                toolMode === "pan"
                  ? isPanning
                    ? "grabbing"
                    : "cursor-grab"
                  : "default",
              borderRadius:
                shape === "rounded-rectangle"
                  ? `${(cornerRadiusMm || 0) * mmToPx}px`
                  : shape === "ellipse" || shape === "circle"
                    ? "50%"
                    : "2px",
              filter: negative ? "invert(1)" : "none",
              transform:
                `${mirrorImage ? "scaleX(-1)" : ""} ${orientation === "portrait-180" ? "rotate(180deg)" : orientation === "landscape" ? "rotate(90deg)" : orientation === "landscape-180" ? "rotate(270deg)" : ""}`.trim() ||
                "none",
              overflow: "visible",
            }}
          >
            {/* Visual Page Internal Padding Boundary (Purely guide, never printed) */}
            {(paddingLeftMm > 0 || paddingRightMm > 0 || paddingTopMm > 0 || paddingBottomMm > 0) && (
              <div
                className="absolute border border-dashed border-red-500/60 pointer-events-none z-10"
                style={{
                  left: `${paddingLeftMm * mmToPx}px`,
                  top: `${paddingTopMm * mmToPx}px`,
                  width: `${(widthMm - paddingLeftMm - paddingRightMm) * mmToPx}px`,
                  height: `${(heightMm - paddingTopMm - paddingBottomMm) * mmToPx}px`,
                  borderRadius:
                    shape === "rounded-rectangle"
                      ? `${Math.max(0, cornerRadiusMm - Math.min(paddingLeftMm, paddingTopMm)) * mmToPx}px`
                      : "0px"
                }}
              />
            )}

            {/* Elements loop for design sticker */}
            {elements
              .filter((el) => el.visible)
              .sort((a, b) => a.zValue - b.zValue)
              .map((el) => {
                const isSelected = selectedIds.includes(el.id);
                const isHighlighted = highlightedElementId === el.id;
                const renderedText = getRenderedText(el);
                const isFieldBound = !!el.fieldName;

                return (
                  <div
                    key={el.id}
                    onMouseDown={(e) => handleMouseDown(e, el, "move")}
                    className={`absolute select-none cursor-move group transition-shadow ${
                      isHighlighted
                        ? "outline outline-2 outline-amber-400 outline-offset-2 shadow-[0_0_12px_rgba(251,191,36,0.5)] bg-amber-500/10 animate-pulse"
                        : isSelected
                          ? "outline outline-2 outline-indigo-500 outline-offset-0 shadow-lg bg-transparent"
                          : isFieldBound
                            ? "hover:outline hover:outline-1 hover:outline-indigo-400 hover:outline-dashed hover:bg-indigo-500/5"
                            : "hover:outline hover:outline-1 hover:outline-metro-accent/50 hover:outline-dotted"
                    }`}
                    style={{
                      left: `${el.x * mmToPx}px`,
                      top: `${el.y * mmToPx}px`,
                      width: `${el.width * mmToPx}px`,
                      height: `${el.height * mmToPx}px`,
                      transform: `rotate(${el.rotation}deg)`,
                      zIndex: el.zValue,
                    }}
                  >
                    {renderElementContent(el, renderedText)}

                    {/* Highlight Name Tag — shown when element is hovered from inspector dropdown */}
                    {isHighlighted && (
                      <div
                        className="absolute bottom-full left-1/2 mb-1 bg-amber-500 text-black px-2 py-0.5 rounded-md shadow-lg pointer-events-none z-50 whitespace-nowrap text-[9px] font-bold tracking-wide"
                        style={{
                          transform: `translateX(-50%) rotate(${-el.rotation}deg)`,
                          transformOrigin: 'bottom center',
                        }}
                      >
                        {(() => {
                          const t = el.type.charAt(0).toUpperCase() + el.type.slice(1);
                          if (el.fieldName) return `${t} · ${el.fieldName}`;
                          if (el.type === 'barcode' && el.barcodeType) return `Barcode · ${el.barcodeType.toUpperCase()}`;
                          if (el.type === 'qrcode') return 'QR Code';
                          if (el.type === 'text' && el.text) return `Text · "${el.text.length > 14 ? el.text.slice(0, 14) + '…' : el.text}"`;
                          if (el.type === 'shape') return `Shape · ${(el.shapeType || 'rect')}`;
                          return `${t} · ${el.id.slice(0, 6)}`;
                        })()}
                      </div>
                    )}
                    {el.locked && (
                      <div className="absolute top-1 right-1 p-0.5 bg-black/60 rounded-sm text-white pointer-events-none">
                        <Lock className="w-2.5 h-2.5" />
                      </div>
                    )}

                    {/* Rotation Tooltip */}
                    {dragState &&
                      dragState.action === "rotate" &&
                      dragState.elementId === el.id && (
                        <div
                          className="absolute bottom-full left-1/2 mb-6 bg-slate-900/95 border border-amber-500/60 text-white px-2.5 py-1.5 rounded-lg shadow-2xl pointer-events-none z-50 flex items-center gap-2 whitespace-nowrap animate-fade-in font-mono text-[10px] select-none"
                          style={{
                            transform: `translateX(-50%) rotate(${-el.rotation}deg)`,
                            transformOrigin: "bottom center",
                          }}
                        >
                          <RotateCw className="w-3 h-3 text-amber-400" />
                          <span className="text-amber-400 font-extrabold uppercase tracking-wider text-[8px] mr-0.5">
                            Rotate
                          </span>
                          <span className="text-white font-extrabold">
                            {el.rotation}&deg;
                          </span>
                        </div>
                      )}

                    {/* 8 Bounding Resizer Square Dots if Selected */}
                    {isSelected && !el.locked && (
                      <>
                        {["tl", "t", "tr", "r", "br", "b", "bl", "l"].map(
                          (handle) => {
                            const positionStyles: Record<
                              string,
                              React.CSSProperties
                            > = {
                              tl: {
                                top: -4,
                                left: -4,
                                cursor: "nwse-resize",
                              },
                              t: {
                                top: -4,
                                left: "50%",
                                marginLeft: -4,
                                cursor: "ns-resize",
                              },
                              tr: {
                                top: -4,
                                right: -4,
                                cursor: "nesw-resize",
                              },
                              r: {
                                top: "50%",
                                right: -4,
                                marginTop: -4,
                                cursor: "ew-resize",
                              },
                              br: {
                                bottom: -4,
                                right: -4,
                                cursor: "nwse-resize",
                              },
                              b: {
                                bottom: -4,
                                left: "50%",
                                marginLeft: -4,
                                cursor: "ns-resize",
                              },
                              bl: {
                                bottom: -4,
                                left: -4,
                                cursor: "nesw-resize",
                              },
                              l: {
                                top: "50%",
                                left: -4,
                                marginTop: -4,
                                cursor: "ew-resize",
                              },
                            };

                            return (
                              <div
                                key={handle}
                                onMouseDown={(e) =>
                                  handleMouseDown(
                                    e,
                                    el,
                                    "resize",
                                    handle,
                                  )
                                }
                                className="absolute w-2 h-2 bg-indigo-600 border border-white z-50 hover:scale-125 transition-transform"
                                style={positionStyles[handle]}
                              />
                            );
                          },
                        )}

                        {/* Rotation Handle */}
                        <div
                          onMouseDown={(e) =>
                            handleMouseDown(e, el, "rotate", "rotate")
                          }
                          className="absolute w-5 h-5 bg-white border border-indigo-600 rounded-full z-50 hover:scale-110 transition-transform shadow-sm flex items-center justify-center text-indigo-600 cursor-grab active:cursor-grabbing"
                          style={{
                            top: -24,
                            left: "50%",
                            marginLeft: -10,
                          }}
                        >
                          <RotateCw className="w-3 h-3" />
                          <div className="absolute w-[1px] h-[14px] bg-indigo-400 left-1/2 top-[100%] -translate-x-1/2 pointer-events-none" />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

            {/* Render Anchor (parent→child) connector lines for linked elements */}
            <svg
              className="absolute inset-0 pointer-events-none z-20"
              style={{ width: widthPx, height: heightPx, overflow: "visible" }}
            >
              <defs>
                <marker
                  id="anchorLinkArrow"
                  markerWidth="9"
                  markerHeight="9"
                  refX="6"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill="#8b5cf6" />
                </marker>
              </defs>
              {elements
                .filter((el) => el.parentId && el.visible)
                .map((child) => {
                  const parent = elements.find(
                    (p) => p.id === child.parentId,
                  );
                  if (!parent || !parent.visible) return null;
                  const px = (parent.x + parent.width / 2) * mmToPx;
                  const py = (parent.y + parent.height) * mmToPx;
                  const cx = (child.x + child.width / 2) * mmToPx;
                  const cy = child.y * mmToPx;
                  return (
                    <g key={`anchor-link-${child.id}`}>
                      <line
                        x1={px}
                        y1={py}
                        x2={cx}
                        y2={cy}
                        stroke="#8b5cf6"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                        markerEnd="url(#anchorLinkArrow)"
                      />
                      {/* Anchor node on the parent's bottom-center */}
                      <circle cx={px} cy={py} r={3.2} fill="#8b5cf6" />
                      {/* Anchor node on the child's top-center */}
                      <circle cx={cx} cy={cy} r={3.2} fill="#8b5cf6" />
                    </g>
                  );
                })}
            </svg>

            {/* Render Vertical User-defined Guidelines */}
            {activeGuideLines &&
              xGuides.map((gX, idx) => (
                <div
                  key={`xg-${idx}`}
                  className="absolute top-0 bottom-0 border-l border-cyan-400 border-dashed pointer-events-none z-30"
                  style={{ left: `${gX * mmToPx}px` }}
                  title="Ruler Guideline. Click on the ruler again to remove."
                />
              ))}

            {/* Render Horizontal User-defined Guidelines */}
            {activeGuideLines &&
              yGuides.map((gY, idx) => (
                <div
                  key={`yg-${idx}`}
                  className="absolute left-0 right-0 border-t border-cyan-400 border-dashed pointer-events-none z-30"
                  style={{ top: `${gY * mmToPx}px` }}
                  title="Ruler Guideline. Click on the ruler again to remove."
                />
              ))}

            {/* Render Separator Guides — visual-only dividers (never printed) */}
            {separatorGuides
              .filter((g) => g.orientation === "vertical")
              .map((g) => (
                <div
                  key={g.id}
                  className="absolute top-0 bottom-0 border-l-2 border-dashed border-slate-400/70 pointer-events-none z-30"
                  style={{ left: `${g.positionMm * mmToPx}px` }}
                  title={`Separator guide (vertical) at ${fromMm(g.positionMm, sepUnit).toFixed(1)}${sepUnit} — not printed`}
                >
                  <span className="absolute top-0.5 left-1 text-[8px] font-mono text-slate-400 bg-white/80 px-1 rounded whitespace-nowrap">
                    {fromMm(g.positionMm, sepUnit).toFixed(1)}
                    {sepUnit}
                  </span>
                </div>
              ))}
            {separatorGuides
              .filter((g) => g.orientation === "horizontal")
              .map((g) => (
                <div
                  key={g.id}
                  className="absolute left-0 right-0 border-t-2 border-dashed border-slate-400/70 pointer-events-none z-30"
                  style={{ top: `${g.positionMm * mmToPx}px` }}
                  title={`Separator guide (horizontal) at ${fromMm(g.positionMm, sepUnit).toFixed(1)}${sepUnit} — not printed`}
                >
                  <span className="absolute left-0.5 top-1 text-[8px] font-mono text-slate-400 bg-white/80 px-1 rounded whitespace-nowrap">
                    {fromMm(g.positionMm, sepUnit).toFixed(1)}
                    {sepUnit}
                  </span>
                </div>
              ))}

            {/* Render Smart Alignment Guides (Horizontal & Vertical Matching lines) */}
            {activeGuideLines &&
              activeVerticalGuides.map((gX, idx) => (
                <div
                  key={`avg-${idx}`}
                  className="absolute top-0 bottom-0 border-l border-indigo-500 shadow-[0_0_4px_rgba(99,102,241,0.6)] pointer-events-none z-30 opacity-90"
                  style={{ left: `${gX * mmToPx}px` }}
                />
              ))}

            {/* Render Smart Alignment Guides (Horizontal Matching lines) */}
            {activeGuideLines &&
              activeHorizontalGuides.map((gY, idx) => (
                <div
                  key={`ahg-${idx}`}
                  className="absolute left-0 right-0 border-t border-indigo-500 shadow-[0_0_4px_rgba(99,102,241,0.6)] pointer-events-none z-30 opacity-90"
                  style={{ top: `${gY * mmToPx}px` }}
                />
              ))}

            {/* Render Smart Equal Spacing & Distribution Indicators */}
            {activeGuideLines &&
              spacingGuides.map((sg, idx) => {
                const style: React.CSSProperties =
                  sg.type === "h"
                    ? {
                        left: `${sg.x * mmToPx}px`,
                        top: `${sg.y * mmToPx}px`,
                        width: `${sg.w * mmToPx}px`,
                        height: "2px",
                      }
                    : {
                        left: `${sg.x * mmToPx}px`,
                        top: `${sg.y * mmToPx}px`,
                        width: "2px",
                        height: `${sg.h * mmToPx}px`,
                      };
                return (
                  <div
                    key={`sg-${idx}`}
                    className="absolute bg-pink-500 pointer-events-none z-30 flex items-center justify-center"
                    style={style}
                  >
                    <div
                      className={`absolute bg-pink-600 px-1.5 py-0.5 rounded text-[8px] font-mono text-white whitespace-nowrap shadow-md ${
                        sg.type === "h" ? "-translate-y-3.5" : "translate-x-3.5"
                      }`}
                    >
                      {sg.value.toFixed(1)} mm
                    </div>
                    {sg.type === "h" ? (
                      <>
                        <div className="absolute left-0 w-[1px] h-2.5 bg-pink-600" />
                        <div className="absolute right-0 w-[1px] h-2.5 bg-pink-600" />
                      </>
                    ) : (
                      <>
                        <div className="absolute top-0 h-[1px] w-2.5 bg-pink-600" />
                        <div className="absolute bottom-0 h-[1px] w-2.5 bg-pink-600" />
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {selectBox && (
            <div
              className="absolute border border-indigo-500 bg-indigo-500/10 pointer-events-none z-50 rounded"
              style={{
                left: `${Math.min(selectBox.startX, selectBox.currentX) - (workspaceRef.current?.getBoundingClientRect().left || 0)}px`,
                top: `${Math.min(selectBox.startY, selectBox.currentY) - (workspaceRef.current?.getBoundingClientRect().top || 0)}px`,
                width: `${Math.abs(selectBox.currentX - selectBox.startX)}px`,
                height: `${Math.abs(selectBox.currentY - selectBox.startY)}px`,
              }}
            />
          )}

          {showAccessionPrompt && (
            <div className="absolute inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-metro-panel border border-metro-border w-full max-w-sm rounded-2xl shadow-2xl p-5 space-y-4 animate-fade-in text-metro-primary">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <span className="font-extrabold text-sm font-sans">Live Preview Accession</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAccessionPrompt(false)}
                    className="text-metro-secondary hover:text-metro-primary p-1 rounded-lg hover:bg-metro-input transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-[11px] text-metro-secondary font-medium leading-relaxed font-sans">
                  Enter an accession identifier or record key to load actual database row fields into the designer canvas workspace.
                </p>

                <form onSubmit={handleFetchAccessionValue} className="space-y-4 font-sans">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">
                      Query Record By Mapped Field
                    </label>
                    <div className="flex gap-2">
                      <div className="w-[45%] shrink-0">
                        <select
                          value={selectedSearchFieldKey}
                          onChange={(e) => {
                            setSelectedSearchFieldKey(e.target.value);
                            setPromptAccessionValue("");
                            setPromptError("");
                          }}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2 text-[11px] font-semibold text-metro-primary focus:border-indigo-500 focus:outline-none transition-colors cursor-pointer"
                        >
                          {mappedFieldsList.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1">
                        <input
                          type="text"
                          required
                          autoFocus
                          placeholder={`Enter ${STANDARD_FIELD_LABELS[selectedSearchFieldKey] || "value"}...`}
                          value={promptAccessionValue}
                          onChange={(e) => setPromptAccessionValue(e.target.value)}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs font-semibold text-metro-primary placeholder-metro-secondary focus:border-indigo-500 focus:outline-none transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  {promptError && (
                    <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-semibold leading-normal">
                      ⚠️ {promptError}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowAccessionPrompt(false)}
                      className="px-3.5 py-1.5 rounded-xl border border-metro-border hover:bg-metro-input text-metro-secondary hover:text-metro-primary font-bold transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={promptLoading}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold rounded-xl shadow-md shadow-indigo-600/15 transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      {promptLoading ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                          <span>Searching...</span>
                        </>
                      ) : (
                        <span>Load Live View</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Walk up the parentId chain to find the root ancestor of a linked element.
function findRootParent(
  elements: LabelElement[],
  id: string,
): LabelElement | undefined {
  const byId = new Map(elements.map((e) => [e.id, e]));
  let cur = byId.get(id);
  if (!cur) return cur;
  const visited = new Set<string>();
  while (cur.parentId && byId.has(cur.parentId) && !visited.has(cur.id)) {
    visited.add(cur.id);
    cur = byId.get(cur.parentId)!;
  }
  return cur;
}

// Helper to estimate number of barcode modules for WYSIWYG integer scaling
const estimateBarcodeModules = (type: string, value: string): number => {
  const L = value.length;
  const t = type.toLowerCase();
  if (t.includes("128") || t.includes("gs1")) {
    return 11 * L + 35;
  }
  if (t.includes("39")) {
    return 12 * L + 20;
  }
  if (t.includes("ean13") || t.includes("upca") || t.includes("upc") || t.includes("isbn") || t.includes("issn")) {
    return 95;
  }
  if (t.includes("ean8")) {
    return 67;
  }
  if (t.includes("itf14")) {
    return 150;
  }
  if (t.includes("itf")) {
    return 9 * L + 18;
  }
  if (t.includes("codabar")) {
    return 14 * L + 18;
  }
  return 12 * L + 20;
};

// --- Embedded Barcode Renderer to ensure fresh JsBarcode canvas loops ---
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
      // Map standard shortcodes to JsBarcode targets
      let targetFormat = "CODE128";
      let val = value || "123456789";

      if (type === "code39") {
        targetFormat = "CODE39";
      } else if (type === "code93") {
        targetFormat = "CODE128"; // fallback
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
      const extra_px = Math.max(0, font_size_px - (fontSize || 10));
      const text_margin_px = base_text_margin_px + extra_px;

      // Bar height = total element height minus the text row when text is shown.
      // Use floor so the generated SVG height always fits within elementHeightMm * scale.
      const bar_height_px = showText
        ? Math.max(5, Math.floor((elementHeightMm * scale) - font_size_px - text_margin_px))
        : (elementHeightMm * scale);
      
      let finalBarWidth = barWidth || 0.35;
      if (autoSize) {
        const numModules = estimateBarcodeModules(type, val);
        const elementWidthPx = elementWidthMm * scale;
        // Compute maximum integer pixel width per module that fits within container
        const moduleWidthPx = Math.max(1, Math.floor(elementWidthPx / numModules));
        // Convert screen pixels back to mm
        finalBarWidth = moduleWidthPx / scale;
      }
      
      const module_width_px = Math.max(1, Math.round(finalBarWidth * scale));

      let fontOptions = "";
      if (fontWeight === "bold" && fontStyle === "italic") {
        fontOptions = "bold italic";
      } else if (fontWeight === "bold") {
        fontOptions = "bold";
      } else if (fontStyle === "italic") {
        fontOptions = "italic";
      }

      // Already computed above: text_margin_px = base_text_margin_px + extra_px;

      const barcodeOpts: any = {
        format: targetFormat,
        displayValue: showText,
        fontSize: font_size_px,
        height: bar_height_px,
        width: module_width_px,
        margin: 0,
        background: "transparent",
        textMargin: text_margin_px,
      };
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
        // Anchor to top so bars fill first and text label sits below — prevents vertical
        // centering from pushing the text row outside the element boundary (WYSIWYG match).
        svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
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
          <span
            className="text-[8px] text-red-500 leading-none truncate max-w-full"
            title={error}
          >
            {error}
          </span>
        </div>
      )}
    </>
  );
};

// --- Embedded QR Renderer ---
interface QRCodeRendererProps {
  value: string;
  width: number;
  height: number;
}

const QRCodeRenderer: React.FC<QRCodeRendererProps> = ({
  value,
  width,
  height,
}) => {
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
