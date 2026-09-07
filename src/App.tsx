import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ElementType,
  LabelElement,
  LabelTemplate,
  DatabaseRecord,
  Printer,
  LogEntry,
  ConnectionProfile,
  RecentFile,
} from "./types";
import { mockPrinters, mockRecords, defaultTemplates } from "./data/mockData";
import { Home } from "./components/Home";
import { LockScreen } from "./components/LockScreen";
import { DesignerCanvas } from "./components/DesignerCanvas";
import { SidebarToolbox } from "./components/SidebarToolbox";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ConnectionModal } from "./components/ConnectionModal";
import { PrintModal } from "./components/PrintModal";
import { PageSetupModal } from "./components/PageSetupModal";
import { RestartAppModal } from "./components/RestartAppModal";
import logoUrl from "../assets/logo.png";
import {
  Save,
  Plus,
  FolderOpen,
  Printer as PrinterIcon,
  Database,
  Grid,
  ZoomIn,
  ZoomOut,
  Undo,
  Redo,
  LogOut,
  Play,
  Sun,
  Moon,
  Info,
  CheckCircle2,
  X,
  HelpCircle,
  ArrowLeft,
  PanelLeft,
  PanelRight,
  Sparkles,
  FileText,
  Pencil,
  Minimize2,
  Maximize2,
  FolderPlus,
  RefreshCw,
  Download,
  Pin,
  Layers,
} from "lucide-react";
import { useElectronAPI } from "./hooks/useElectronAPI";
import {
  deserializeTemplateFromFile,
  serializeTemplateToFile,
  createNewBlankTemplate,
  prepareTemplateForLoadOrImport,
  deepClone,
} from "./utils/templateSerialization";

const BLANK_TEMPLATE: LabelTemplate = createNewBlankTemplate("Untitled Template");

const standardLogicalFields = [
  { key: 'AccessionNo', label: 'Accession Number / Unique Key' },
  { key: 'Title', label: 'Title' },
  { key: 'Author', label: 'Author' },
  { key: 'Publisher', label: 'Publisher' },
  { key: 'ClassNo', label: 'Classification Number' },
  { key: 'BookNo', label: 'Book Number' },
  { key: 'ISBN', label: 'ISBN' },
  { key: 'Edition', label: 'Edition' },
  { key: 'Year', label: 'Publication Year' },
  { key: 'Price', label: 'Price' },
  { key: 'Status', label: 'Status' }
];

// Walk up the parentId chain to find the root ancestor of a linked element.
export function findRootParent(
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

// Topologically recompute absolute (x, y) coordinates for all linked (child)
// elements based on their parent chain. Children are centered horizontally
// under their parent and stacked below it by `parentSpacing`.
export function recalculateLinkedPositions(
  elements: LabelElement[],
): LabelElement[] {
  const childrenOf = new Map<string, LabelElement[]>();
  elements.forEach((el) => {
    if (el.parentId) {
      if (!childrenOf.has(el.parentId)) childrenOf.set(el.parentId, []);
      childrenOf.get(el.parentId)!.push(el);
    }
  });

  const result = elements.map((e) => ({ ...e }));
  const resultById = new Map(result.map((e) => [e.id, e]));

  const compute = (parent: LabelElement) => {
    const kids = childrenOf.get(parent.id);
    if (!kids) return;
    for (const kid of kids) {
      const kidInResult = resultById.get(kid.id);
      if (!kidInResult) continue;
      kidInResult.x = parseFloat(
        (parent.x + (parent.width - kidInResult.width) / 2).toFixed(2),
      );
      kidInResult.y = parseFloat(
        (parent.y + parent.height + (kidInResult.parentSpacing || 0)).toFixed(2),
      );
      compute(kidInResult);
    }
  };

  // Process from roots first so nested children get correct coordinates.
  result.forEach((e) => {
    if (!e.parentId) compute(e);
  });

  return result;
}

export default function App() {
  const electronAPI = useElectronAPI();

  // Background Gmail Auto-Polling Loop (Runs constantly regardless of active view)
  useEffect(() => {
    let timer: any = null;
    let countdownVal = 0;
    let countdownTimer: any = null;
    let isChecking = false;

    const runBackgroundPoll = async () => {
      if (isChecking) {
        console.log("[Gmail Poller] Skipped: already checking.");
        return;
      }

      const enabled = localStorage.getItem("gmail_polling_enabled") === "true";
      if (!enabled) {
        console.log("[Gmail Poller] Skipped: polling not enabled.");
        return;
      }

      const gmailAddress = localStorage.getItem("gmail_address") || "";
      const gmailAppPassword = localStorage.getItem("gmail_app_password") || "";
      if (!gmailAddress || !gmailAppPassword) {
        console.warn("[Gmail Poller] Skipped: Gmail address or app password missing.");
        window.dispatchEvent(new CustomEvent("gmail-poll-completed", {
          detail: { success: false, logs: ["[CONFIG] Gmail address or app password is not configured. Go to Settings → Print Automations to configure."] }
        }));
        return;
      }

      let triggerSubjects: string[] = [];
      try {
        const stored = localStorage.getItem("gmail_trigger_subjects");
        triggerSubjects = stored ? JSON.parse(stored) : [];
      } catch { }

      const verifiedOnly = localStorage.getItem("gmail_verified_only") === "true";
      let verifiedSenders: string[] = [];
      try {
        const stored = localStorage.getItem("gmail_verified_senders");
        verifiedSenders = stored ? JSON.parse(stored) : [];
      } catch { }

      let gmailTemplateMappings: Record<string, string> = {};
      try {
        const stored = localStorage.getItem("gmail_template_mappings");
        gmailTemplateMappings = stored ? JSON.parse(stored) : {};
      } catch { }
      if (Object.keys(gmailTemplateMappings).length === 0) {
        console.warn("[Gmail Poller] Skipped: No template key mappings configured.");
        window.dispatchEvent(new CustomEvent("gmail-poll-completed", {
          detail: { success: false, logs: ["[CONFIG] No template key mappings configured. Go to Settings → Print Automations → Template Mappings to add at least one mapping."] }
        }));
        return;
      }

      let savedUserTemplates: any[] = [];
      try {
        const stored = localStorage.getItem("windows_barcode_studio_saved_templates");
        savedUserTemplates = stored ? JSON.parse(stored) : [];
      } catch { }
      const allAvailableTemplates = [...savedUserTemplates, ...defaultTemplates].filter(
        (item, index, self) => self.findIndex((t) => t.id === item.id) === index
      );

      let dbConfig: any = null;
      try {
        const stored = localStorage.getItem("barcode_studio_sql_servers");
        if (stored) {
          const servers = JSON.parse(stored);
          const activeServer = servers.find((s: any) => s.isActive);
          if (activeServer) {
            dbConfig = {
              dbType: activeServer.dbType || "mssql",
              server: activeServer.server,
              port: activeServer.port,
              instance: activeServer.instance,
              database: activeServer.database,
              username: activeServer.username,
              password: activeServer.password,
              authMode: activeServer.authMode,
              trustCert: activeServer.trustCert ?? true,
              encrypt: activeServer.encrypt ?? false,
              sqlitePath: activeServer.sqlitePath,
              table: activeServer.table,
              uniqueField: activeServer.uniqueField,
            };
          }
        }
      } catch { }
      if (!dbConfig) {
        console.warn("[Gmail Poller] Skipped: No active database server configured.");
        window.dispatchEvent(new CustomEvent("gmail-poll-completed", {
          detail: { success: false, logs: ["[CONFIG] No active database server configured. Go to Settings → Database Connections and ensure one server is active."] }
        }));
        return;
      }

      let activePrinterName = "";
      try {
        const stored = localStorage.getItem("barcode_studio_active_printer");
        const activePrinter = stored ? JSON.parse(stored) : null;
        activePrinterName = activePrinter?.name || "Microsoft Print to PDF";
      } catch { }

      const lastPollTime = localStorage.getItem("gmail_last_poll_time") || null;

      console.log("[Gmail Poller] Starting poll cycle...", { gmailAddress, activePrinterName, templateMappings: Object.keys(gmailTemplateMappings).length });

      isChecking = true;
      try {
        const result = (await electronAPI.pollGmail({
          gmailAddress,
          gmailAppPassword,
          triggerSubjects,
          verifiedOnly,
          verifiedSenders,
          templates: allAvailableTemplates,
          templateMappings: gmailTemplateMappings,
          printerName: activePrinterName,
          dbConfig,
          lastPollTime,
        })) as any;
        console.log("[Gmail Poller] Poll result:", result?.success, result?.logs?.length, "log lines");
        if (result?.success) {
          if (result.lastPollTime) {
            localStorage.setItem("gmail_last_poll_time", result.lastPollTime);
          }
          if (result.printedJobs && result.printedJobs.length > 0) {
            try {
              const savedStr = localStorage.getItem("print_history");
              const historyList = savedStr ? JSON.parse(savedStr) : [];

              result.printedJobs.forEach((job: any) => {
                const accList = Array.isArray(job.accessionNumbers)
                  ? job.accessionNumbers
                  : (typeof job.accessionNo === "string"
                      ? job.accessionNo.split(/[\r\n,;\t]+/).map((s: string) => s.trim()).filter(Boolean)
                      : []);
                const uniqueAccs = Array.from(new Set(accList));
                const bookCount = job.bookCount || (uniqueAccs.length > 0 ? uniqueAccs.length : (job.copies || 1));
                historyList.unshift({
                  id: `h-${Math.random().toString(36).substring(2, 9)}`,
                  timestamp: job.timestamp || new Date().toISOString(),
                  method: "email",
                  senderEmail: job.senderEmail,
                  accessionNo: job.accessionNo,
                  bookCount: bookCount,
                  copies: bookCount,
                  totalStickers: job.totalStickers || job.copies || 1,
                  accessionNumbers: uniqueAccs.length > 0 ? uniqueAccs : (job.accessionNo ? [job.accessionNo] : []),
                  templates: job.templates,
                  printerName: job.printerName,
                  status: job.status,
                  error: job.error
                });
              });

              if (historyList.length > 5000) {
                historyList.splice(5000);
              }
              localStorage.setItem("print_history", JSON.stringify(historyList));
              window.dispatchEvent(new CustomEvent("print-history-updated"));
            } catch (e) {
              console.error("Failed to append Gmail automated prints to history:", e);
            }
          }
        }
        window.dispatchEvent(new CustomEvent("gmail-poll-completed", { detail: result }));
      } catch (err) {
        console.error("[Background Gmail Poller] Error: ", err);
        window.dispatchEvent(new CustomEvent("gmail-poll-completed", {
          detail: { success: false, logs: [`[FATAL] Polling error: ${err}`] }
        }));
      } finally {
        isChecking = false;
      }
    };

    const startInterval = () => {
      if (timer) clearInterval(timer);
      if (countdownTimer) clearInterval(countdownTimer);

      const enabled = localStorage.getItem("gmail_polling_enabled") === "true";
      if (!enabled) {
        console.log("[Gmail Poller] Interval stopped: polling disabled.");
        window.dispatchEvent(new CustomEvent("gmail-countdown-tick", { detail: 0 }));
        return;
      }

      const intervalStr = localStorage.getItem("gmail_polling_interval") || "Every 30 seconds";
      if (intervalStr === "Manual Only") {
        console.log("[Gmail Poller] Interval stopped: mode is Manual Only.");
        window.dispatchEvent(new CustomEvent("gmail-countdown-tick", { detail: 0 }));
        return;
      }

      let seconds = 30;
      if (intervalStr.startsWith("Every ")) {
        const parts = intervalStr.split(" ");
        const num = parseInt(parts[1]);
        const unit = parts[2]?.toLowerCase() || "";
        let val = isNaN(num) ? 30 : num;
        if (unit.includes("second")) seconds = val;
        else if (unit.includes("minute")) seconds = val * 60;
        else if (unit.includes("hour")) seconds = val * 3600;
      }

      console.log(`[Gmail Poller] Auto-poll interval started: every ${seconds}s (${intervalStr}).`);

      countdownVal = seconds;
      window.dispatchEvent(new CustomEvent("gmail-countdown-tick", { detail: countdownVal }));

      countdownTimer = setInterval(() => {
        countdownVal--;
        if (countdownVal <= 0) {
          runBackgroundPoll();
          countdownVal = seconds;
        }
        window.dispatchEvent(new CustomEvent("gmail-countdown-tick", { detail: countdownVal }));
      }, 1000);
    };

    // Seed initial run and startup timers
    runBackgroundPoll();
    startInterval();

    const handleSettingsChanged = () => {
      console.log("[Gmail Poller] Settings changed — restarting interval and running immediate poll.");
      startInterval();
      // Run an immediate poll so user sees feedback after toggling settings
      runBackgroundPoll();
    };
    window.addEventListener("gmail-settings-changed", handleSettingsChanged);

    return () => {
      if (timer) clearInterval(timer);
      if (countdownTimer) clearInterval(countdownTimer);
      window.removeEventListener("gmail-settings-changed", handleSettingsChanged);
    };
  }, [electronAPI]);

  // Theme state
  const [theme, setTheme] = useState<"dark" | "light">("light");

  // Custom presets state for previously used custom sizes
  const [customPresets, setCustomPresets] = useState<
    Array<{ id: string; name: string; width: number; height: number }>
  >(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_custom_presets");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Apply theme class to documentElement
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("light");
    } else {
      root.classList.remove("light");
    }
  }, [theme]);

  // Navigation & View Mode
  const [activeView, setActiveView] = useState<'home' | 'designer'>('home');
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [previewMode, setPreviewMode] = useState<"template" | "live">("template");

  // Monitor window size and aspect ratio for responsive sidebar management
  const [isSmallScreen, setIsSmallScreen] = useState(() => {
    const aspect = window.innerWidth / window.innerHeight;
    return window.innerWidth < 1200 || aspect < 1.25;
  });

  useEffect(() => {
    const handleResize = () => {
      const aspect = window.innerWidth / window.innerHeight;
      const small = window.innerWidth < 1200 || aspect < 1.25;
      setIsSmallScreen((prev) => {
        if (prev !== small) {
          if (small) {
            // Auto hide sidebars to prioritize canvas area on half-screen/small width
            setShowLeftSidebar(false);
            setShowRightSidebar(false);
          } else {
            // Restore sidebars on returning to full screen
            setShowLeftSidebar(true);
            setShowRightSidebar(true);
          }
        }
        return small;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Active label template state with multiple tab (Chrome-tabs) support
  const [openTemplates, setOpenTemplates] = useState<LabelTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string>("");
  const [showAddTabMenu, setShowAddTabMenu] = useState<boolean>(false);
  const [addTabMenuCoords, setAddTabMenuCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isLocked, setIsLocked] = useState<boolean>(false);

  // App restart modal state on config file load / drop
  const [restartModalInfo, setRestartModalInfo] = useState<{ isOpen: boolean; fileName?: string }>({ isOpen: false });

  // Check application telemetry status on mount and poll periodically
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await electronAPI.getTelemetryStatus();
        if (res && res.success) {
          setIsLocked(res.locked);
        }
      } catch (err) {
        console.error("[Telemetry] Error fetching telemetry status:", err);
      }
    };

    checkStatus();
    // Poll telemetry status every 1 hour to detect remote reactivation automatically
    const interval = setInterval(checkStatus, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [electronAPI]);



  // Click listener to close the Add Tab Dropdown menu when clicking outside
  useEffect(() => {
    if (!showAddTabMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const btn = document.getElementById("tab-add-btn");
      if (btn && !btn.contains(e.target as Node)) {
        setShowAddTabMenu(false);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [showAddTabMenu]);

  // File System Template associations (Template ID -> File Path)
  const [templateFilePaths, setTemplateFilePaths] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_template_file_paths");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  // Persist templateFilePaths to localStorage
  useEffect(() => {
    localStorage.setItem("barcode_studio_template_file_paths", JSON.stringify(templateFilePaths));
  }, [templateFilePaths]);

  // Recent files list
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_recent_files");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persist recent files to localStorage
  useEffect(() => {
    localStorage.setItem("barcode_studio_recent_files", JSON.stringify(recentFiles));
  }, [recentFiles]);

  const addRecentFile = useCallback((filePath: string, templateName: string) => {
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    setRecentFiles((prev) => {
      const filtered = prev.filter((rf) => rf.filePath !== filePath);
      const newEntry: RecentFile = {
        filePath,
        fileName,
        templateName,
        lastOpened: new Date().toISOString(),
      };
      return [newEntry, ...filtered].slice(0, 10);
    });
  }, []);

  // Pinned templates list (pinned directly to homescreen)
  const [pinnedTemplateIds, setPinnedTemplateIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_pinned_templates");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Group Template modal state
  const [showGroupModal, setShowGroupModal] = useState<boolean>(false);
  const [newGroupName, setNewGroupName] = useState<string>("");
  const [existingGroups, setExistingGroups] = useState<Array<{ id: string; name: string; templateIds: string[] }>>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_shortcuts");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Reload groups from storage whenever the modal opens
  useEffect(() => {
    if (showGroupModal) {
      try {
        const stored = localStorage.getItem("barcode_studio_shortcuts");
        if (stored) setExistingGroups(JSON.parse(stored));
      } catch (e) {
        console.error(e);
      }
    }
  }, [showGroupModal]);


  const template =
    openTemplates.find((t) => t.id === activeTemplateId) ||
    openTemplates[0] ||
    defaultTemplates[0] ||
    BLANK_TEMPLATE;

  const setTemplate = (
    updater: LabelTemplate | ((prev: LabelTemplate) => LabelTemplate),
  ) => {
    setOpenTemplates((prev) => {
      const activeId = activeTemplateId || (prev[0] ? prev[0].id : "");
      return prev.map((t) => {
        if (t.id === activeId) {
          return typeof updater === "function" ? updater(t) : updater;
        }
        return t;
      });
    });
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId) {
      if (!selectedIds.includes(selectedId)) {
        setSelectedIds([selectedId]);
      }
    } else {
      setSelectedIds([]);
    }
  }, [selectedId]);

  // Connected DB state
  const [dbConnected, setDbConnected] = useState(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_sql_servers");
      if (stored) {
        const servers = JSON.parse(stored);
        if (servers.some((s: any) => s.isActive)) return true;
      }
    } catch (e) { }
    return true;
  });
  const [dbName, setDbName] = useState(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_sql_servers");
      if (stored) {
        const servers = JSON.parse(stored);
        const active = servers.find((s: any) => s.isActive);
        if (active) return active.database;
      }
    } catch (e) { }
    return "";
  });
  const [activeRecord, setActiveRecord] = useState<DatabaseRecord | null>(
    mockRecords[0] || null,
  );

  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_sql_servers");
      let active: any = null;
      if (stored) {
        const servers = JSON.parse(stored);
        active = servers.find((s: any) => s.isActive);
      }
      if (active) {
        return {
          id: active.id,
          name: active.name,
          dbType: active.dbType || "mssql",
          server: active.server,
          port: active.port || (active.dbType === "mysql" ? 3306 : 1433),
          instance: active.instance,
          database: active.database,
          table: active.table,
          username: active.username,
          password: active.password || "",
          authMode: active.authMode,
          trustCert: active.trustCert ?? true,
          encrypt: active.encrypt ?? false,
          sqlitePath: active.sqlitePath || "barcode_studio_library.db",
          uniqueField: active.uniqueField || "AccessionNo",
          fieldMappings: active.fieldMappings || {},
        };
      }
    } catch (e) {
      console.error(e);
    }
    return null;
  });
  const [dbRecords, setDbRecords] = useState<DatabaseRecord[]>(mockRecords);

  const dbFieldsList = React.useMemo(() => {
    const fields = new Set<string>();

    if (activeProfile) {
      if (activeProfile.fieldMappings) {
        Object.keys(activeProfile.fieldMappings).forEach(k => fields.add(k));
      }
      if ((activeProfile as any).customFields) {
        ((activeProfile as any).customFields).forEach((k: string) => fields.add(k));
      }
    }

    if (dbRecords && dbRecords.length > 0) {
      Object.keys(dbRecords[0]).forEach(k => fields.add(k));
    } else {
      [
        "AccessionNo",
        "Title",
        "Author",
        "ClassNo",
        "BookNo",
        "ISBN",
        "Publisher",
        "Year",
        "Price",
        "Status",
      ].forEach(k => fields.add(k));
    }

    if (template && template.elements) {
      template.elements.forEach(el => {
        if (el.fieldName) {
          fields.add(el.fieldName);
        }
      });
    }

    return Array.from(fields);
  }, [dbRecords, activeProfile, template]);

  useEffect(() => {
    localStorage.setItem(
      "windows_barcode_studio_template",
      JSON.stringify(template),
    );
  }, [template]);

  // Calibration and viewport configurations
  const [zoom, setZoom] = useState(1.5);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSizeMm, setGridSizeMm] = useState(2.5);

  // Drivers and logs
  const [printers, setPrinters] = useState<Printer[]>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_saved_printers");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error(e);
    }
    return mockPrinters;
  });

  const [activePrinter, setActivePrinter] = useState<Printer>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_active_printer");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return mockPrinters[0];
  });

  useEffect(() => {
    try {
      localStorage.setItem("barcode_studio_active_printer", JSON.stringify(activePrinter));
    } catch (e) {
      console.error(e);
    }
  }, [activePrinter]);

  useEffect(() => {
    try {
      localStorage.setItem("barcode_studio_saved_printers", JSON.stringify(printers));
    } catch (e) {
      console.error(e);
    }
  }, [printers]);

  // Load real printers from desktop backend on mount
  useEffect(() => {
    const loadPrinters = async () => {
      try {
        const result = await electronAPI.getPrinters();
        if (result.success && Array.isArray(result.printers)) {
          const formatted = result.printers.map((p: any) => ({
            name: p.name,
            status: p.status,
            type: p.type,
            dpi: p.dpi || 300,
            paperType: 'single',
            widthMm: 50,
            heightMm: 30,
            leftMarginMm: 0,
            rightMarginMm: 0,
            middleGapMm: 0
          }));

          const stored = localStorage.getItem("barcode_studio_saved_printers");
          let saved: Printer[] = [];
          if (stored) {
            try { saved = JSON.parse(stored); } catch (e) { }
          }

          const merged = formatted.map((p: any) => {
            const match = saved.find((s) => s.name === p.name);
            return match ? { ...p, ...match } : p;
          });

          setPrinters(merged);

          // Preserve previously saved active printer if present
          let hasPreservedActive = false;
          try {
            const storedActive = localStorage.getItem("barcode_studio_active_printer");
            if (storedActive) {
              const parsedActive = JSON.parse(storedActive);
              if (parsedActive && parsedActive.name) {
                const foundActive = merged.find((p: any) => p.name === parsedActive.name);
                if (foundActive) {
                  setActivePrinter({ ...foundActive, ...parsedActive });
                  hasPreservedActive = true;
                } else {
                  setActivePrinter(parsedActive);
                  hasPreservedActive = true;
                }
              }
            }
          } catch (e) { }

          // Only fall back to Windows default printer if no active printer was previously saved
          if (!hasPreservedActive) {
            const defaultPrintRes = await electronAPI.getDefaultPrinter();
            if (defaultPrintRes.success && defaultPrintRes.name) {
              const foundDefault = merged.find((p: any) => p.name === defaultPrintRes.name);
              if (foundDefault) {
                setActivePrinter(foundDefault);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load native printers list:", err);
      }
    };

    if (window.electronAPI) {
      loadPrinters();
    }
  }, [electronAPI]);

  const handleSelectPrinter = (printer: Printer) => {
    let printerToSet = printer;
    if (activePrinter && printer.name !== activePrinter.name) {
      const saved = printers.find((p) => p.name === printer.name);
      if (saved) {
        printerToSet = { ...saved, ...printer };
      }
    }
    setActivePrinter(printerToSet);
    try {
      localStorage.setItem("barcode_studio_active_printer", JSON.stringify(printerToSet));
    } catch (e) { }
    logMessage("info", `Selected printer: ${printerToSet.name}`);
  };

  const handleSavePrinterSettings = (updatedPrinter: Printer) => {
    setPrinters((prev) => {
      const exists = prev.some((p) => p.name === updatedPrinter.name);
      const updated = exists ? prev.map((p) => p.name === updatedPrinter.name ? updatedPrinter : p) : [...prev, updatedPrinter];
      try {
        localStorage.setItem("barcode_studio_saved_printers", JSON.stringify(updated));
      } catch (e) { }
      return updated;
    });
    setActivePrinter(updatedPrinter);
    try {
      localStorage.setItem("barcode_studio_active_printer", JSON.stringify(updatedPrinter));
    } catch (e) { }
    logMessage("success", `Permanently saved calibration settings for printer: ${updatedPrinter.name}`);
  };

  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Modals and notifications
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showPageSetupModal, setShowPageSetupModal] = useState(false);
  const [pageSetupMode, setPageSetupMode] = useState<'create' | 'edit'>('edit');
  const [printTemplates, setPrintTemplates] = useState<LabelTemplate[]>([]);
  const [preloadedAccessionNumbers, setPreloadedAccessionNumbers] = useState<
    string[]
  >([]);
  const [autoStartPrint, setAutoStartPrint] = useState(false);
  const [showNewSizeModal, setShowNewSizeModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);



  // Clipboard for copy-paste shortcuts
  const clipboardElementsRef = useRef<LabelElement[]>([]);
  const keydownHandlerRef = useRef<(e: KeyboardEvent) => void>(undefined);

  // Custom size form states
  const [newDesignName, setNewDesignName] = useState("My Custom Label");
  const [newDesignWidth, setNewDesignWidth] = useState<number | "">(75);
  const [newDesignHeight, setNewDesignHeight] = useState<number | "">(38);
  const [newDesignPreset, setNewDesignPreset] = useState("spine-75-38");
  const [newDesignStep, setNewDesignStep] = useState<1 | 2>(1);
  const [newDesignShape, setNewDesignShape] = useState<
    "rectangle" | "rounded-rectangle" | "ellipse" | "circle"
  >("rectangle");
  const [newDesignOrientation, setNewDesignOrientation] = useState<
    "portrait" | "landscape" | "portrait-180" | "landscape-180"
  >("portrait");
  const [newDesignMirror, setNewDesignMirror] = useState(false);
  const [newDesignNegative, setNewDesignNegative] = useState(false);

  // Undo / Redo stacks
  const [undoStack, setUndoStack] = useState<LabelElement[][]>([]);
  const [redoStack, setRedoStack] = useState<LabelElement[][]>([]);

  // Editing tab name
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState("");

  // Logs stream helper
  const logMessage = useCallback(
    (level: LogEntry["level"], message: string) => {
      const timestamp = new Date().toLocaleTimeString();
      const newEntry: LogEntry = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp,
        level,
        message,
      };
      setLogs((prev) => [...prev, newEntry]);
    },
    [],
  );

  const handleTogglePinTemplate = useCallback(() => {
    const activeTmpl = openTemplates.find((t) => t.id === activeTemplateId) || openTemplates[0];
    if (!activeTmpl?.id) return;
    setPinnedTemplateIds((prev) => {
      const isPinned = prev.includes(activeTmpl.id);
      const next = isPinned
        ? prev.filter((id) => id !== activeTmpl.id)
        : [...prev, activeTmpl.id];
      localStorage.setItem("barcode_studio_pinned_templates", JSON.stringify(next));
      logMessage(
        "info",
        isPinned
          ? `Unpinned layout '${activeTmpl.name}' from Homescreen.`
          : `Pinned layout '${activeTmpl.name}' directly to Homescreen.`
      );
      return next;
    });
  }, [openTemplates, activeTemplateId, logMessage]);

  const handleToggleTemplateInGroup = (groupId: string) => {
    const activeTmpl = openTemplates.find((t) => t.id === activeTemplateId) || openTemplates[0];
    if (!activeTmpl?.id) return;
    setExistingGroups((prev) => {
      const next = prev.map((g) => {
        if (g.id === groupId) {
          const hasTmpl = g.templateIds.includes(activeTmpl.id);
          const nextTmpls = hasTmpl
            ? g.templateIds.filter((id) => id !== activeTmpl.id)
            : [...g.templateIds, activeTmpl.id];
          return { ...g, templateIds: nextTmpls };
        }
        return g;
      });
      localStorage.setItem("barcode_studio_shortcuts", JSON.stringify(next));
      return next;
    });
  };

  const handleCreateAndAssignGroup = () => {
    const activeTmpl = openTemplates.find((t) => t.id === activeTemplateId) || openTemplates[0];
    if (!newGroupName.trim() || !activeTmpl?.id) return;
    const name = newGroupName.trim();
    const newGroup = {
      id: `sc-${Math.random().toString(36).substring(2, 9)}`,
      name,
      templateIds: [activeTmpl.id],
    };
    const next = [...existingGroups, newGroup];
    setExistingGroups(next);
    localStorage.setItem("barcode_studio_shortcuts", JSON.stringify(next));
    setNewGroupName("");
    logMessage("success", `Created group '${name}' and assigned layout '${activeTmpl.name}'.`);
  };

  // Validate custom fonts loaded in template
  const checkCustomFonts = useCallback((t: LabelTemplate) => {
    const standardFonts = [
      "Arial", "Helvetica", "Times New Roman", "Courier New", "Verdana", "Georgia",
      "Trebuchet MS", "Impact", "Comic Sans MS", "sans-serif", "serif", "Noto Sans", "Noto Sans Devanagari", "Noto Sans-bold", "monospace",
      "cursive", "system-ui", "Segoe UI", "Roboto", "Inter", "Outfit"
    ];
    const missingFonts: string[] = [];

    t.elements.forEach((el) => {
      if (el.fontFamily && !standardFonts.includes(el.fontFamily) && !missingFonts.includes(el.fontFamily)) {
        try {
          const available = document.fonts.check(`12px "${el.fontFamily}"`);
          if (!available) {
            missingFonts.push(el.fontFamily);
          }
        } catch {
          // document.fonts.check not supported
        }
      }
    });

    if (missingFonts.length > 0) {
      logMessage(
        "warning",
        `Missing Custom Fonts: [${missingFonts.join(", ")}]. Fallback fonts will be used.`
      );
      alert(
        `Graceful Warning: The following custom font(s) used in this template are not installed on this computer:\n• ${missingFonts.join("\n• ")}\n\nAppropriate system fallback fonts will be used.`
      );
    }
  }, [logMessage]);

  // Fetch records from bound SQL server
  const fetchRecords = useCallback(async (server: any) => {
    try {
      const data = await electronAPI.dbQuery(server, server.table, 100);
      if (data.success) {
        const fieldMappings = server.fieldMappings || {};
        const customFields = server.customFields || [];

        const mappedRows = (data.rows || []).map((row: any) => {
          const mapped: any = {};

          // 1. Map standard fields
          standardLogicalFields.forEach(f => {
            const phys = fieldMappings[f.key];
            mapped[f.key] = phys && row[phys] !== undefined ? String(row[phys]) : '';
          });

          // 2. Map custom fields (keys in mapping that are not standard, plus server.customFields)
          const allCustomKeys = new Set([
            ...customFields,
            ...Object.keys(fieldMappings).filter(k => !standardLogicalFields.some(sf => sf.key === k))
          ]);

          allCustomKeys.forEach(k => {
            const phys = fieldMappings[k];
            mapped[k] = phys && row[phys] !== undefined ? String(row[phys]) : '';
          });

          // 3. Keep rest of original raw physical columns for full flexibility
          Object.keys(row).forEach(key => {
            if (mapped[key] === undefined) {
              mapped[key] = String(row[key]);
            }
          });

          return mapped;
        });

        setDbRecords(mappedRows);
        setActiveRecord((prev) => {
          if (prev) {
            const idKey = server.uniqueField || "AccessionNo";
            const match = mappedRows.find(
              (r: any) =>
                (r[idKey] !== undefined && r[idKey] === prev[idKey]) ||
                (r.AccessionNo !== undefined && r.AccessionNo === prev.AccessionNo) ||
                (r.ACC_NO !== undefined && r.ACC_NO === prev.ACC_NO)
            );
            return match || prev;
          }
          return mappedRows[0] || null;
        });
        logMessage("success", `Fetched ${data.rows.length} records from ${server.table}`);
      } else {
        logMessage("error", `Failed to fetch records: ${data.message}`);
      }
    } catch (e) {
      logMessage("error", `Failed to fetch records: ${e}`);
    }
  }, [logMessage, electronAPI]);

  // Synchronize database records when activeProfile is selected or loaded
  useEffect(() => {
    if (activeProfile && (previewMode === 'live' || showPrintModal)) {
      fetchRecords(activeProfile);
    }
  }, [activeProfile, previewMode, showPrintModal, fetchRecords]);

  const handleAutoTriggerPrint = useCallback(
    (numbers: string[]) => {
      // Load templates specified for Gmail automation
      try {
        const storedIdsStr = localStorage.getItem("gmail_selected_templates");
        if (storedIdsStr) {
          const storedIds: string[] = JSON.parse(storedIdsStr);
          if (storedIds.length > 0) {
            const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
            const savedUserTemplates = savedStr ? JSON.parse(savedStr) : [];
            const allAvailable = [...savedUserTemplates, ...defaultTemplates].filter(
              (item, index, self) => self.findIndex((t) => t.id === item.id) === index,
            );
            const selectedTemplates = allAvailable.filter(t => storedIds.includes(t.id));
            if (selectedTemplates.length > 0) {
              setPrintTemplates(selectedTemplates);
            }
          }
        }
      } catch (e) {
        console.error("Failed to load Gmail automation templates:", e);
      }

      setPreloadedAccessionNumbers(numbers);
      setAutoStartPrint(true);
      setShowPrintModal(true);
      logMessage(
        "success",
        `Gmail print automation triggered! Spooling ${numbers.length} parsed accession numbers.`,
      );
    },
    [logMessage],
  );

  // Set up startup logging
  useEffect(() => {
    logMessage("success", "Windows Barcode Studio starting...");
    logMessage(
      "info",
      "Loaded Zebra ZD420 (203dpi) and virtual Microsoft print drivers.",
    );
    logMessage(
      "info",
      "Autodetected connection to localhost\\SQLEXPRESS, database [LibraryDB].",
    );
  }, [logMessage]);

  // Helper to remove blank default "Untitled Template" tabs when opening saved/external template files
  const filterUnusedUntitledTabs = useCallback((prev: LabelTemplate[]): LabelTemplate[] => {
    return prev.filter(
      (t) =>
        !(
          (t.name === "Untitled Template" || t.name.toLowerCase().includes("untitled")) &&
          t.elements.length === 0
        )
    );
  }, []);

  // Handle custom safe Electron deep link/double-click template files (.bcs)
  useEffect(() => {
    // 1. Listen for new open-file events while app is running
    electronAPI.onOpenFile((filePath, content) => {
      try {
        const loadedTemplate = deserializeTemplateFromFile(content, { forceNewElementIds: true });
        checkCustomFonts(loadedTemplate);

        setOpenTemplates((prev) => {
          const cleanPrev = filterUnusedUntitledTabs(prev);
          const exists = cleanPrev.find((t) => t.id === loadedTemplate.id);
          if (exists) return cleanPrev.map((t) => (t.id === loadedTemplate.id ? loadedTemplate : t));
          return [...cleanPrev, loadedTemplate];
        });
        setActiveTemplateId(loadedTemplate.id);

        setTemplateFilePaths((prev) => ({
          ...prev,
          [loadedTemplate.id]: filePath,
        }));

        addRecentFile(filePath, loadedTemplate.name);
        updateSavedTemplatesList(loadedTemplate);
        setActiveView("designer");

        const filename = filePath.split(/[\\/]/).pop() || filePath;
        logMessage("success", `Opened double-clicked template file: ${filename}`);
      } catch (err) {
        logMessage("error", `Failed to parse double-clicked template: ${err}`);
      }
    });

    // 2. Query initial file if app was launched via double-clicking .bcs file
    electronAPI.getInitialFile().then((fileData) => {
      if (fileData) {
        try {
          const loadedTemplate = deserializeTemplateFromFile(fileData.content, { forceNewElementIds: true });
          checkCustomFonts(loadedTemplate);

          setOpenTemplates([loadedTemplate]);
          setActiveTemplateId(loadedTemplate.id);

          setTemplateFilePaths((prev) => ({
            ...prev,
            [loadedTemplate.id]: fileData.filePath,
          }));

          addRecentFile(fileData.filePath, loadedTemplate.name);
          updateSavedTemplatesList(loadedTemplate);
          setActiveView("designer");

          const filename = fileData.filePath.split(/[\\/]/).pop() || fileData.filePath;
          logMessage("success", `Loaded double-clicked template at launch: ${filename}`);
        } catch (err) {
          logMessage("error", `Failed to parse launch template file: ${err}`);
        }
      }
    });
  }, [electronAPI, logMessage, checkCustomFonts, addRecentFile]);

  // Handle double-click / launch of .bcsc config files — restore all localStorage keys
  useEffect(() => {
    const applyConfigBundle = async (content: string, filePath: string) => {
      try {
        const bundle = JSON.parse(content);
        if (bundle.__bcs_type !== "config") return; // not a config file, ignore

        const lsKeys: Array<[string, string]> = [
          ["barcode_studio_sql_servers", JSON.stringify(bundle.barcode_studio_sql_servers || [])],
          ["barcode_studio_active_printer", JSON.stringify(bundle.barcode_studio_active_printer || null)],
          ["barcode_studio_saved_printers", JSON.stringify(bundle.barcode_studio_saved_printers || [])],
          ["windows_barcode_studio_saved_templates", JSON.stringify(bundle.windows_barcode_studio_saved_templates || [])],
          ["barcode_studio_custom_presets", JSON.stringify(bundle.barcode_studio_custom_presets || [])],
          ["barcode_studio_recent_files", JSON.stringify(bundle.barcode_studio_recent_files || [])],
          // Note: gmail_address and gmail_app_password are intentionally excluded for privacy & security
          ["gmail_trigger_subjects", JSON.stringify(bundle.gmail_trigger_subjects || [])],
          ["gmail_polling_enabled", bundle.gmail_polling_enabled || "false"],
          ["gmail_polling_interval", bundle.gmail_polling_interval || ""],
          ["gmail_selected_templates", JSON.stringify(bundle.gmail_selected_templates || [])],
          ["gmail_verified_only", bundle.gmail_verified_only || "false"],
          ["gmail_verified_senders", JSON.stringify(bundle.gmail_verified_senders || [])],
          ["gmail_template_mappings", JSON.stringify(bundle.gmail_template_mappings || {})],
        ];
        if (bundle.barcode_studio_shortcuts) {
          lsKeys.push(["barcode_studio_shortcuts", JSON.stringify(bundle.barcode_studio_shortcuts)]);
        }
        lsKeys.forEach(([key, value]) => { try { localStorage.setItem(key, value); } catch { } });

        if (bundle.py_settings) {
          try { await electronAPI.saveSettings(bundle.py_settings); } catch { }
        }

        const filename = filePath.split(/[\\/]/).pop() || filePath;
        logMessage("success", `Config imported from ${filename} — restart required for all changes to take effect.`);
        setRestartModalInfo({ isOpen: true, fileName: filename });
      } catch (err) {
        logMessage("error", `Failed to apply config file: ${err}`);
      }
    };

    electronAPI.onOpenConfigFile((filePath, content) => {
      applyConfigBundle(content, filePath);
    });
  }, [electronAPI, logMessage]);

  // Drag and Drop support for .bcs and .bcsc files
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        const lowerName = file.name.toLowerCase();
        const filePath = (file as any).path;

        if (lowerName.endsWith('.bcsc')) {
          if (filePath) {
            try {
              const readRes = await electronAPI.readTemplateFile(filePath);
              if (readRes.success && readRes.content) {
                const bundle = JSON.parse(readRes.content);
                if (bundle.__bcs_type === "config") {
                  const lsKeys: Array<[string, string]> = [
                    ["barcode_studio_sql_servers", JSON.stringify(bundle.barcode_studio_sql_servers || [])],
                    ["barcode_studio_active_printer", JSON.stringify(bundle.barcode_studio_active_printer || null)],
                    ["barcode_studio_saved_printers", JSON.stringify(bundle.barcode_studio_saved_printers || [])],
                    ["windows_barcode_studio_saved_templates", JSON.stringify(bundle.windows_barcode_studio_saved_templates || [])],
                    ["barcode_studio_custom_presets", JSON.stringify(bundle.barcode_studio_custom_presets || [])],
                    ["barcode_studio_recent_files", JSON.stringify(bundle.barcode_studio_recent_files || [])],
                    // Note: gmail_address and gmail_app_password are intentionally excluded for privacy & security
                    ["gmail_trigger_subjects", JSON.stringify(bundle.gmail_trigger_subjects || [])],
                    ["gmail_polling_enabled", bundle.gmail_polling_enabled || "false"],
                    ["gmail_polling_interval", bundle.gmail_polling_interval || ""],
                    ["gmail_selected_templates", JSON.stringify(bundle.gmail_selected_templates || [])],
                    ["gmail_verified_only", bundle.gmail_verified_only || "false"],
                    ["gmail_verified_senders", JSON.stringify(bundle.gmail_verified_senders || [])],
                    ["gmail_template_mappings", JSON.stringify(bundle.gmail_template_mappings || {})],
                  ];
                  if (bundle.barcode_studio_shortcuts) {
                    lsKeys.push(["barcode_studio_shortcuts", JSON.stringify(bundle.barcode_studio_shortcuts)]);
                  }
                  lsKeys.forEach(([key, value]) => { try { localStorage.setItem(key, value); } catch { } });
                  if (bundle.py_settings) {
                    try { await electronAPI.saveSettings(bundle.py_settings); } catch { }
                  }
                  logMessage("success", `Config imported from dropped file ${file.name}`);
                  setRestartModalInfo({ isOpen: true, fileName: file.name });
                }
              }
            } catch (err: any) {
              logMessage("error", `Dropped config file error: ${err.message}`);
            }
          }
        } else if (lowerName.endsWith('.bcs') || lowerName.endsWith('.json')) {
          if (filePath) {
            try {
              const readRes = await electronAPI.readTemplateFile(filePath);
              if (readRes.success && readRes.content) {
                const loadedTemplate = deserializeTemplateFromFile(readRes.content, { forceNewElementIds: true });
                checkCustomFonts(loadedTemplate);

                setOpenTemplates((prev) => {
                  const cleanPrev = filterUnusedUntitledTabs(prev);
                  const exists = cleanPrev.find((t) => t.id === loadedTemplate.id);
                  if (exists) return cleanPrev.map((t) => (t.id === loadedTemplate.id ? loadedTemplate : t));
                  return [...cleanPrev, loadedTemplate];
                });
                setActiveTemplateId(loadedTemplate.id);

                setTemplateFilePaths((prev) => ({
                  ...prev,
                  [loadedTemplate.id]: filePath,
                }));

                addRecentFile(filePath, loadedTemplate.name);
                updateSavedTemplatesList(loadedTemplate);
                setActiveView("designer");

                const filename = filePath.split(/[\\/]/).pop() || filePath;
                logMessage("success", `Opened dropped template: ${filename}`);
              } else {
                logMessage("error", `Failed to read dropped file: ${readRes.message}`);
              }
            } catch (err: any) {
              logMessage("error", `Dropped file parsing error: ${err.message}`);
            }
          }
        }
      }
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [electronAPI, checkCustomFonts, addRecentFile, logMessage]);

  // Load from local storage on mount
  useEffect(() => {
    const saved = localStorage.getItem("windows_barcode_studio_template");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const templateToLoad = prepareTemplateForLoadOrImport(parsed);
        setOpenTemplates([templateToLoad]);
        setActiveTemplateId(templateToLoad.id);
        logMessage(
          "info",
          "Restored previous working template from local storage.",
        );
      } catch (err) {
        console.error(err);
        const fallback = createNewBlankTemplate("Untitled Template");
        setOpenTemplates([fallback]);
        setActiveTemplateId(fallback.id);
      }
    } else {
      const fallback = createNewBlankTemplate("Untitled Template");
      setOpenTemplates([fallback]);
      setActiveTemplateId(fallback.id);
    }
  }, []);

  // File operations dialogs
  const handleOpenTemplateDialog = useCallback(async () => {
    try {
      const res = await electronAPI.showOpenDialog({
        title: "Open Barcode Studio Layout Templates",
        filters: [
          { name: "Barcode Studio Template Files (*.bcs, *.json)", extensions: ["bcs", "json"] },
        ],
        properties: ["openFile", "multiSelections"],
      });

      if (!res.canceled && res.filePaths.length > 0) {
        const newlyLoaded: LabelTemplate[] = [];
        const newPaths: Record<string, string> = {};
        const openedNames: string[] = [];

        for (const filePath of res.filePaths) {
          const readRes = await electronAPI.readTemplateFile(filePath);
          if (readRes.success && readRes.content) {
            const loadedTemplate = deserializeTemplateFromFile(readRes.content, { forceNewElementIds: true });
            checkCustomFonts(loadedTemplate);
            newlyLoaded.push(loadedTemplate);
            newPaths[loadedTemplate.id] = filePath;

            const filename = filePath.split(/[\\/]/).pop() || filePath;
            openedNames.push(filename);

            addRecentFile(filePath, loadedTemplate.name);
            updateSavedTemplatesList(loadedTemplate);
          } else {
            logMessage("error", `Failed to read file '${filePath}': ${readRes.message}`);
          }
        }

        if (newlyLoaded.length > 0) {
          setOpenTemplates((prev) => {
            const cleanPrev = filterUnusedUntitledTabs(prev);
            let next = [...cleanPrev];
            for (const t of newlyLoaded) {
              const existsIdx = next.findIndex((existing) => existing.id === t.id);
              if (existsIdx >= 0) {
                next[existsIdx] = t;
              } else {
                next.push(t);
              }
            }
            return next;
          });
          setActiveTemplateId(newlyLoaded[newlyLoaded.length - 1].id);
          setTemplateFilePaths((prev) => ({ ...prev, ...newPaths }));
          setActiveView("designer");
          logMessage(
            "success",
            `Opened ${newlyLoaded.length} template layout file(s): ${openedNames.join(", ")}`
          );
        }
      }
    } catch (err: any) {
      logMessage("error", `Open dialog error: ${err.message}`);
    }
  }, [electronAPI, checkCustomFonts, addRecentFile, logMessage]);

  const updateSavedTemplatesList = useCallback((templateToSave: LabelTemplate) => {
    try {
      const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
      let userSaved: LabelTemplate[] = [];
      if (savedStr) {
        try { userSaved = JSON.parse(savedStr); } catch (err) { }
      }
      userSaved = userSaved.filter(t => t.id !== templateToSave.id);
      userSaved.unshift(deepClone(templateToSave));
      localStorage.setItem("windows_barcode_studio_saved_templates", JSON.stringify(userSaved));
    } catch (err) {
      console.error("Failed to update saved templates list:", err);
    }
  }, []);

  const handleSaveAsTemplateDialog = useCallback(async () => {
    try {
      const res = await electronAPI.showSaveDialog({
        title: "Save Layout Design As",
        defaultPath: `${template.name}.bcs`,
        filters: [
          { name: "Barcode Studio Template File (*.bcs)", extensions: ["bcs"] },
        ],
      });

      if (!res.canceled && res.filePath) {
        let finalPath = res.filePath;
        if (!finalPath.toLowerCase().endsWith('.bcs')) {
          finalPath += '.bcs';
        }

        const filenameWithoutExt = finalPath.split(/[\\/]/).pop()?.replace(/\.bcs$/i, "") || template.name;

        // Serialize with isSaveAs: true to guarantee a fresh unique document ID & child element IDs
        const { serializedJson, templateToSave } = serializeTemplateToFile(template, {
          isSaveAs: true,
          customName: filenameWithoutExt,
        });

        const saveRes = await electronAPI.saveTemplateFile(finalPath, serializedJson);
        if (saveRes.success) {
          const oldId = template.id;

          // Replace old template in open tabs with the newly decoupled templateToSave
          setOpenTemplates((prev) => {
            return prev.map((t) => (t.id === oldId ? templateToSave : t));
          });
          setActiveTemplateId(templateToSave.id);

          setTemplateFilePaths((prev) => {
            const copy = { ...prev };
            delete copy[oldId];
            copy[templateToSave.id] = finalPath;
            return copy;
          });

          addRecentFile(finalPath, templateToSave.name);
          updateSavedTemplatesList(templateToSave);

          const filename = finalPath.split(/[\\/]/).pop() || finalPath;
          logMessage("success", `Saved layout design as: ${filename}`);
          setSaveStatus(`Layout design saved successfully to ${filename}`);
          setTimeout(() => setSaveStatus(null), 3500);
        } else {
          logMessage("error", `Failed to save file: ${saveRes.message}`);
        }
      }
    } catch (err: any) {
      logMessage("error", `Save As error: ${err.message}`);
    }
  }, [electronAPI, template, addRecentFile, logMessage, updateSavedTemplatesList]);

  const handleOpenRecentFile = useCallback(async (filePath: string) => {
    try {
      const readRes = await electronAPI.readTemplateFile(filePath);
      if (readRes.success && readRes.content) {
        const loadedTemplate = deserializeTemplateFromFile(readRes.content, { forceNewElementIds: true });
        checkCustomFonts(loadedTemplate);

        setOpenTemplates((prev) => {
          const cleanPrev = filterUnusedUntitledTabs(prev);
          const exists = cleanPrev.find((t) => t.id === loadedTemplate.id);
          if (exists) return cleanPrev.map((t) => (t.id === loadedTemplate.id ? loadedTemplate : t));
          return [...cleanPrev, loadedTemplate];
        });
        setActiveTemplateId(loadedTemplate.id);

        setTemplateFilePaths((prev) => ({
          ...prev,
          [loadedTemplate.id]: filePath,
        }));

        addRecentFile(filePath, loadedTemplate.name);
        updateSavedTemplatesList(loadedTemplate);
        setActiveView("designer");

        const filename = filePath.split(/[\\/]/).pop() || filePath;
        logMessage("success", `Opened recent template: ${filename}`);
      } else {
        logMessage("error", `Could not open file: ${readRes.message}`);
        alert(`Error opening file: "${filePath}"\nThis file might have been moved, renamed, or deleted.`);
        setRecentFiles((prev) => prev.filter((rf) => rf.filePath !== filePath));
      }
    } catch (err: any) {
      logMessage("error", `Recent file open error: ${err.message}`);
    }
  }, [electronAPI, checkCustomFonts, addRecentFile, logMessage, updateSavedTemplatesList]);

  // Save template progress
  const handleSaveProgress = useCallback(async () => {
    const currentFilePath = templateFilePaths[template.id];
    if (currentFilePath) {
      try {
        const { serializedJson, templateToSave } = serializeTemplateToFile(template, { isSaveAs: false });
        const saveRes = await electronAPI.saveTemplateFile(currentFilePath, serializedJson);
        if (saveRes.success) {
          setOpenTemplates((prev) => prev.map((t) => (t.id === templateToSave.id ? templateToSave : t)));
          addRecentFile(currentFilePath, templateToSave.name);
          updateSavedTemplatesList(templateToSave);

          const filename = currentFilePath.split(/[\\/]/).pop() || currentFilePath;
          logMessage("success", `Saved layout progress: ${filename}`);
          setSaveStatus(`Saved: ${filename}`);
          setTimeout(() => setSaveStatus(null), 2500);
        } else {
          logMessage("error", `Failed to save file: ${saveRes.message}`);
        }
      } catch (err: any) {
        logMessage("error", `Save error: ${err.message}`);
      }
    } else {
      await handleSaveAsTemplateDialog();
    }
  }, [template, templateFilePaths, handleSaveAsTemplateDialog, addRecentFile, logMessage, updateSavedTemplatesList]);

  const handleCloseTab = (id: string) => {
    const nextTabs = openTemplates.filter((t) => t.id !== id);
    if (nextTabs.length === 0) {
      // closed last tab, go back to dashboard
      setOpenTemplates([]);
      setActiveTemplateId("");
      setActiveView('home');
    } else {
      setOpenTemplates(nextTabs);
      if (activeTemplateId === id) {
        const closedIdx = openTemplates.findIndex((t) => t.id === id);
        const nextActiveIdx = Math.min(
          nextTabs.length - 1,
          Math.max(0, closedIdx - 1),
        );
        setActiveTemplateId(nextTabs[nextActiveIdx].id);
      }
    }
    logMessage("warning", "Closed design document tab.");
  };

  // Helper to commit element changes to the undo history stack
  const saveHistoryState = (nextElements: LabelElement[]) => {
    setUndoStack((prev) => [...prev, template.elements]);
    setRedoStack([]); // clear redo
    setTemplate((prev) => ({ ...prev, elements: nextElements }));
  };

  const handleStartHistoryAction = () => {
    setUndoStack((prev) => [...prev, template.elements]);
    setRedoStack([]); // clear redo
  };

  // Undo / Redo operations
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, template.elements]);
    setTemplate((prev) => ({ ...prev, elements: previous }));
    logMessage("info", "Undo action committed.");
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, template.elements]);
    setTemplate((prev) => ({ ...prev, elements: next }));
    logMessage("info", "Redo action committed.");
  };

  // Add vector element
  const handleAddElement = (type: ElementType, subtype?: string) => {
    const defaultX = template.widthMm * 0.15;
    const defaultY = template.heightMm * 0.25;

    const baseElement: LabelElement = {
      id: `e-${Math.random().toString(36).substring(2, 9)}`,
      type,
      x: defaultX,
      y: defaultY,
      width: type === "barcode" ? 30 : type === "qrcode" ? 12 : 25,
      height: type === "barcode" ? 10 : type === "qrcode" ? 12 : 6,
      rotation: 0,
      locked: false,
      visible: true,
      zValue: template.elements.length + 1,
    };

    if (type === "text") {
      baseElement.fontFamily = "Segoe UI";
      baseElement.fontSize = 10;
      baseElement.textColor = "#000000";
      baseElement.textAlign = "left";
      if (subtype) {
        baseElement.fieldName = subtype;
        baseElement.text = `[${subtype}]`;
      } else {
        baseElement.text = "Static Text";
      }
    } else if (type === "barcode") {
      baseElement.barcodeType = "code128";
      baseElement.fieldName = "AccessionNo";
      baseElement.showText = false;
      baseElement.barHeight = 50;
      baseElement.barWidth = 0.35;
      baseElement.autoSize = true;
    } else if (type === "qrcode") {
      baseElement.fieldName = "AccessionNo";
    } else if (type === "shape") {
      baseElement.shapeType = (subtype as any) || "rect";
      baseElement.fillColor = "#ffffff";
      baseElement.strokeColor = "#000000";
      baseElement.strokeWidth = 1;
    } else if (type === "line") {
      baseElement.type = "line";
      baseElement.shapeType = "line";
      baseElement.fillColor = "transparent";
      baseElement.strokeColor = "#000000";
      baseElement.strokeWidth = 1.5;
    }

    const nextElements = [...template.elements, baseElement];
    saveHistoryState(nextElements);
    setSelectedId(baseElement.id);
    logMessage(
      "success",
      `Created vector element: ${type} (${subtype || "standard"})`,
    );
  };

  // Keyboard Shortcuts Service (Ctrl+C, Ctrl+V, Ctrl+S, Del, Arrows nudge)
  keydownHandlerRef.current = (e: KeyboardEvent) => {
    // Ignore when typing inside input elements
    const target = e.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    ) {
      return;
    }

    // If not in designer mode, keyboard shortcuts in designer (like Ctrl+S, Ctrl+B, Ctrl+I, nudge, copy, etc) should be disabled!
    if (activeView !== 'designer') return;

    // Ctrl+Tab - Switch between open design layouts/tabs
    if ((e.ctrlKey || e.metaKey) && e.key === "Tab") {
      e.preventDefault();
      if (openTemplates.length > 1) {
        const currentIndex = openTemplates.findIndex(
          (t) => t.id === activeTemplateId,
        );
        let nextIndex = currentIndex + 1;
        if (e.shiftKey) {
          nextIndex = currentIndex - 1;
          if (nextIndex < 0) nextIndex = openTemplates.length - 1;
        } else {
          if (nextIndex >= openTemplates.length) nextIndex = 0;
        }
        const nextTemplate = openTemplates[nextIndex];
        setActiveTemplateId(nextTemplate.id);
        logMessage("info", `Switched layout tab to: ${nextTemplate.name}`);
      }
      return;
    }

    // Global Ctrl+P - Print current template(s)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      setShowPrintModal(true);
      return;
    }

    // 1. Global Ctrl+S - Save Progress
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      handleSaveProgress();
      return;
    }

    // Sidebar Toggles
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      setShowLeftSidebar((p) => !p);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
      e.preventDefault();
      setShowRightSidebar((p) => !p);
      return;
    }

    // Ctrl+Z - Undo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      handleUndo();
      return;
    }

    // Ctrl+Y - Redo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      handleRedo();
      return;
    }

    // Ctrl+R - Rotate 90 degrees clockwise
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      const idsToRotate = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
      if (idsToRotate.length > 0) {
        const updatedElements = template.elements.map((el) => {
          if (idsToRotate.includes(el.id)) {
            const currentRotation = el.rotation || 0;
            const nextRotation = (currentRotation + 90) % 360;
            return { ...el, rotation: nextRotation };
          }
          return el;
        });
        saveHistoryState(updatedElements);
        logMessage("success", `Rotated ${idsToRotate.length} element(s) 90° clockwise.`);
      }
      return;
    }

    // Delete elements shortcut (Delete / Backspace)
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (selectedIds.length > 0) {
        handleRemoveElements(selectedIds);
      } else if (selectedId) {
        handleRemoveElement(selectedId);
      }
      return;
    }

    // Select All shortcut (Ctrl+A / Cmd+A)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      const allVisibleIds = template.elements.filter((el) => el.visible).map((el) => el.id);
      setSelectedIds(allVisibleIds);
      if (allVisibleIds.length > 0) {
        setSelectedId(allVisibleIds[allVisibleIds.length - 1]);
      } else {
        setSelectedId(null);
      }
      return;
    }

    // 2. Global Ctrl+C - Copy selected elements
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      const idsToCopy = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
      if (idsToCopy.length > 0) {
        const els = template.elements.filter((item) => idsToCopy.includes(item.id));
        if (els.length > 0) {
          e.preventDefault();
          clipboardElementsRef.current = els;
          logMessage(
            "info",
            `Copied ${els.length} element(s) to clipboard.`,
          );
        }
      }
      return;
    }

    // Ctrl+D - Duplicate selected elements with offset
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      const idsToDup = selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []);
      if (idsToDup.length > 0) {
        e.preventDefault();
        const els = template.elements.filter((item) => idsToDup.includes(item.id));
        const duplicatedList: LabelElement[] = [];

        els.forEach((el) => {
          const nextX = Math.min(template.widthMm - el.width, el.x + 2.5);
          const nextY = Math.min(template.heightMm - el.height, el.y + 2.5);
          duplicatedList.push({
            ...el,
            id: `e-${Math.random().toString(36).substring(2, 9)}`,
            x: nextX,
            y: nextY,
            zValue: template.elements.length + duplicatedList.length + 1,
          });
        });

        if (duplicatedList.length > 0) {
          const nextElements = [...template.elements, ...duplicatedList];
          saveHistoryState(nextElements);
          const newIds = duplicatedList.map((el) => el.id);
          setSelectedIds(newIds);
          setSelectedId(newIds[newIds.length - 1]);
          logMessage(
            "success",
            `Duplicated ${duplicatedList.length} element(s) at layout offset (+2.5mm).`,
          );
        }
      }
      return;
    }

    // 3. Global Ctrl+V - Paste elements
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      if (clipboardElementsRef.current.length > 0) {
        e.preventDefault();
        const pastedList: LabelElement[] = [];

        clipboardElementsRef.current.forEach((copied) => {
          const nextX = Math.min(template.widthMm - copied.width, copied.x + 2.5);
          const nextY = Math.min(template.heightMm - copied.height, copied.y + 2.5);
          pastedList.push({
            ...copied,
            id: `e-${Math.random().toString(36).substring(2, 9)}`,
            x: nextX,
            y: nextY,
            zValue: template.elements.length + pastedList.length + 1,
          });
        });

        if (pastedList.length > 0) {
          const nextElements = [...template.elements, ...pastedList];
          saveHistoryState(nextElements);
          const newIds = pastedList.map((el) => el.id);
          setSelectedIds(newIds);
          setSelectedId(newIds[newIds.length - 1]);
          logMessage(
            "success",
            `Pasted ${pastedList.length} element(s) at layout offset (+2.5mm).`,
          );
        }
      }
      return;
    }

    // Actions requiring a selected element
    if (!selectedId) return;
    const element = template.elements.find((el) => el.id === selectedId);
    if (!element) return;

    // 5. Arrow keys nudge logic
    if (element.locked) return;
    const step = e.shiftKey ? 2.5 : 0.5; // larger step size on Shift

    let dx = 0;
    let dy = 0;

    if (e.key === "ArrowUp") {
      dy = -step;
    } else if (e.key === "ArrowDown") {
      dy = step;
    } else if (e.key === "ArrowLeft") {
      dx = -step;
    } else if (e.key === "ArrowRight") {
      dx = step;
    }

    if (dx !== 0 || dy !== 0) {
      e.preventDefault();

      if (template.mirrorImage) {
        dx = -dx;
      }

      if (template.orientation === "landscape") {
        const temp = dx;
        dx = dy;
        dy = -temp;
      } else if (template.orientation === "landscape-180") {
        const temp = dx;
        dx = -dy;
        dy = temp;
      } else if (template.orientation === "portrait-180") {
        dx = -dx;
        dy = -dy;
      }

      // Save history state before nudge
      setUndoStack((prev) => [...prev, template.elements]);
      setRedoStack([]);

      onUpdateElement(selectedId, {
        x: parseFloat((element.x + dx).toFixed(2)),
        y: parseFloat((element.y + dy).toFixed(2)),
      });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (keydownHandlerRef.current) {
        keydownHandlerRef.current(e);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Update specific element property
  const onUpdateElement = (id: string, updates: Partial<LabelElement>) => {
    setTemplate((prev) => {
      const target = prev.elements.find((el) => el.id === id);
      let nextElements = prev.elements.map((el) => {
        if (el.id === id) {
          return { ...el, ...updates };
        }
        return el;
      });

      // If the updated element is itself a linked (child) element, translate its
      // root parent by the same delta so the entire anchored chain moves together.
      if (target && target.parentId && (updates.x !== undefined || updates.y !== undefined)) {
        const root = findRootParent(nextElements, id);
        if (root && root.id !== id) {
          const dx = (updates.x !== undefined ? updates.x : target.x) - target.x;
          const dy = (updates.y !== undefined ? updates.y : target.y) - target.y;
          nextElements = nextElements.map((el) =>
            el.id === root.id
              ? {
                ...el,
                x: parseFloat((el.x + dx).toFixed(2)),
                y: parseFloat((el.y + dy).toFixed(2)),
              }
              : el,
          );
        }
      }

      return { ...prev, elements: recalculateLinkedPositions(nextElements) };
    });
  };

  // Update multiple elements' properties simultaneously (for multi-selection dragging)
  const onUpdateElements = (
    updatesMap: Record<string, Partial<LabelElement>>,
  ) => {
    setTemplate((prev) => {
      const nextElements = prev.elements.map((el) => {
        if (updatesMap[el.id]) {
          return { ...el, ...updatesMap[el.id] };
        }
        return el;
      });
      return { ...prev, elements: recalculateLinkedPositions(nextElements) };
    });
  };

  // Delete element
  const handleRemoveElement = (id: string) => {
    const nextElements = template.elements
      .filter((el) => el.id !== id)
      // Unlink any children of the deleted element (turn them into free elements)
      .map((el) => (el.parentId === id ? { ...el, parentId: undefined } : el));
    saveHistoryState(nextElements);
    if (selectedId === id) setSelectedId(null);
    logMessage("warning", "Deleted canvas element.");
  };

  // Delete multiple elements
  const handleRemoveElements = (ids: string[]) => {
    if (!ids || ids.length === 0) return;
    const nextElements = template.elements
      .filter((el) => !ids.includes(el.id))
      .map((el) => (ids.includes(el.parentId || "") ? { ...el, parentId: undefined } : el));
    saveHistoryState(nextElements);
    if (selectedId && ids.includes(selectedId)) setSelectedId(null);
    logMessage("warning", `Deleted ${ids.length} canvas element(s).`);
  };

  // Adjust layer Z-Ordering
  const handleSetZOrder = (
    id: string,
    direction: "up" | "down" | "top" | "bottom",
  ) => {
    const target = template.elements.find((el) => el.id === id);
    if (!target) return;

    let nextElements = [...template.elements];
    const sorted = [...nextElements].sort((a, b) => a.zValue - b.zValue);
    const idx = sorted.findIndex((el) => el.id === id);

    if (direction === "up" && idx < sorted.length - 1) {
      const neighbor = sorted[idx + 1];
      const temp = target.zValue;
      target.zValue = neighbor.zValue;
      neighbor.zValue = temp;
    } else if (direction === "down" && idx > 0) {
      const neighbor = sorted[idx - 1];
      const temp = target.zValue;
      target.zValue = neighbor.zValue;
      neighbor.zValue = temp;
    } else if (direction === "top") {
      const topZ = sorted[sorted.length - 1].zValue;
      target.zValue = topZ + 1;
    } else if (direction === "bottom") {
      const botZ = sorted[0].zValue;
      target.zValue = botZ - 1;
    }

    setTemplate((prev) => ({ ...prev, elements: nextElements }));
    logMessage("info", `Adjusted layer order for element.`);
  };

  const handleOpenNewSizeModal = () => {
    setPageSetupMode('create');
    setShowPageSetupModal(true);
  };

  const handleReprint = useCallback((accessionNoStr: string) => {
    const cleanStr = accessionNoStr.replace(/\.\.\./g, "");
    const numbers = cleanStr.split(",").map(s => s.trim()).filter(Boolean);
    if (numbers.length > 0) {
      setPreloadedAccessionNumbers(numbers);
      setShowPrintModal(true);
      logMessage("info", `Preloaded ${numbers.length} accession numbers for reprinting.`);
    }
  }, [logMessage]);

  // Handle create size template confirm
  const handleCreateTemplateConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    let width = Number(newDesignWidth) || 75;
    let height = Number(newDesignHeight) || 38;

    if (newDesignPreset === "spine-75-38") {
      width = 75;
      height = 38;
    } else if (newDesignPreset === "spine-narrow") {
      width = 38;
      height = 25;
    } else if (newDesignPreset === "pocket-80-50") {
      width = 80;
      height = 50;
    } else if (newDesignPreset === "shipping-101-152") {
      width = 101;
      height = 152;
    } else {
      // It's a custom size (either custom input or selected from customPresets list)
      const foundPreset = customPresets.find((cp) => cp.id === newDesignPreset);
      if (foundPreset) {
        width = foundPreset.width;
        height = foundPreset.height;
      } else {
        // Saving a newly configured custom size
        const alreadyExists = customPresets.find(
          (cp) => cp.width === width && cp.height === height,
        );
        if (!alreadyExists) {
          const newPresetId = `custom-${width}-${height}`;
          const newCustomPreset = {
            id: newPresetId,
            name: `Custom`,
            width,
            height,
          };
          const nextCustomPresets = [newCustomPreset, ...customPresets];
          setCustomPresets(nextCustomPresets);
          try {
            localStorage.setItem(
              "barcode_studio_custom_presets",
              JSON.stringify(nextCustomPresets),
            );
          } catch (err) {
            console.error(err);
          }
        }
      }
    }

    // If shape is circle, ensure dimensions are synchronized
    if (newDesignShape === "circle") {
      height = width;
    }

    const newTab = createNewBlankTemplate(newDesignName || "Custom Size Label Layout", {
      widthMm: width,
      heightMm: height,
      marginMm: 2,
      shape: newDesignShape,
      orientation: newDesignOrientation,
      mirrorImage: newDesignMirror,
      negative: newDesignNegative,
    });

    setOpenTemplates((prev) => [...prev, newTab]);
    setActiveTemplateId(newTab.id);

    // Save template dimensions for active printer
    setActivePrinter((prevPrinter) => ({
      ...prevPrinter,
      widthMm: width,
      heightMm: height,
    }));

    setSelectedId(null);
    setActiveView('designer');
    setShowNewSizeModal(false);
    logMessage(
      "success",
      `Created customized designer canvas sized: ${width}x${height} mm.`,
    );
  };

  if (isLocked) {
    return <LockScreen onCloseApp={() => electronAPI.close()} />;
  }

  return (
    <div className="h-screen w-screen bg-metro-app text-metro-primary flex flex-col overflow-hidden font-sans select-none">
      {/* Top Action Notification Toast for clean modern status info */}
      {saveStatus && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-indigo-950 border border-indigo-500 rounded-lg shadow-xl text-xs font-semibold text-indigo-100 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-indigo-400" />
          <span>{saveStatus}</span>
          <button
            onClick={() => setSaveStatus(null)}
            className="ml-2 hover:text-white cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Global Application Top Bar */}
      <div className="h-14 bg-metro-panel border-b border-metro-border flex items-center justify-between px-4 shrink-0 z-40 select-none drag-handle">
        {activeView === 'home' ? (
          // --- DASHBOARD HEADER ---
          <>
            <div className="flex items-center gap-2.5 drag-none">
              <img
                src={logoUrl}
                className="w-5 h-5 rounded-md object-contain border border-metro-border/40"
                alt="BarCode Studio Logo"
              />
              <span className="font-extrabold text-sm tracking-tight text-metro-primary">
                BarCode Studio
              </span>
            </div>

            <div className="flex items-center gap-2 drag-none h-full">
              {/* Theme switcher */}
              <button
                onClick={() =>
                  setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                }
                className="p-1.5 rounded-md text-metro-secondary hover:bg-metro-header hover:text-metro-primary transition-colors cursor-pointer"
                title="Switch theme dark/light"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>

              {/* Custom Window Controls inside Dashboard */}
              {window.electronAPI && (
                <div className="flex items-center h-full mr-[-16px] ml-2">
                  <button
                    onClick={() => electronAPI.minimize()}
                    className="w-[46px] h-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer"
                    title="Minimize"
                  >
                    <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <line y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  </button>
                  <button
                    onClick={() => electronAPI.maximize()}
                    className="w-[46px] h-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer"
                    title="Maximize"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" fill="none" />
                    </svg>
                  </button>
                  <button
                    onClick={() => electronAPI.close()}
                    className="w-[46px] h-full flex items-center justify-center hover:bg-[#e81123] active:bg-[#f1707a] text-metro-secondary hover:text-white transition-colors cursor-pointer"
                    title="Close"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          // --- DESIGNER/EDITOR HEADER ---
          <>
            {/* Left Column: Exit, Info, Logo */}
            <div className="flex items-center gap-3 min-w-0 drag-none">
              <div className="flex items-center gap-2 shrink-0">
                <img
                  src={logoUrl}
                  className="w-5 h-5 rounded-md object-contain border border-metro-border/40"
                  alt="BarCode Studio Logo"
                />
                <span className="font-extrabold text-xs tracking-tight text-metro-primary hidden sm:inline">
                  BarCode Studio
                </span>
              </div>

              <div className="w-[1px] h-5 bg-metro-border shrink-0"></div>

              <div className="flex flex-col min-w-0">
                <div className="group flex items-center gap-1.5 min-w-0">
                  {editingTabId === activeTemplateId ? (
                    <input
                      type="text"
                      value={editingTabName}
                      onChange={(e) => setEditingTabName(e.target.value)}
                      autoFocus
                      onBlur={() => {
                        if (editingTabName.trim() !== "") {
                          setOpenTemplates((prev) =>
                            prev.map((tmpl) =>
                              tmpl.id === activeTemplateId ? { ...tmpl, name: editingTabName } : tmpl
                            )
                          );
                        }
                        setEditingTabId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (editingTabName.trim() !== "") {
                            setOpenTemplates((prev) =>
                              prev.map((tmpl) =>
                                tmpl.id === activeTemplateId ? { ...tmpl, name: editingTabName } : tmpl
                              )
                            );
                          }
                          setEditingTabId(null);
                        }
                        if (e.key === "Escape") {
                          setEditingTabId(null);
                        }
                      }}
                      className="bg-metro-input border border-indigo-500 rounded px-1.5 py-0.5 text-xs font-bold text-metro-primary w-[180px] outline-none"
                    />
                  ) : (
                    <>
                      <span className="text-xs font-bold text-metro-primary leading-tight max-w-[120px] sm:max-w-[180px] md:max-w-[240px] truncate cursor-pointer hover:text-indigo-400 transition-colors"
                        onClick={() => {
                          setEditingTabId(activeTemplateId);
                          setEditingTabName(template.name);
                        }}
                        title="Click to rename"
                      >
                        {template.name || "Untitled Layout"}
                      </span>
                      <button
                        onClick={() => {
                          setEditingTabId(activeTemplateId);
                          setEditingTabName(template.name);
                        }}
                        className="p-1 rounded hover:bg-metro-input text-metro-secondary hover:text-indigo-400 transition-all cursor-pointer opacity-0 group-hover:opacity-100"
                        title="Rename Template"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>

                      {/* Pin to Homescreen button */}
                      <button
                        onClick={handleTogglePinTemplate}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${pinnedTemplateIds.includes(template.id)
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-400 hover:bg-amber-500/25"
                          : "bg-metro-panel border-metro-border text-metro-secondary hover:text-metro-primary hover:border-metro-secondary"
                          }`}
                        title={pinnedTemplateIds.includes(template.id) ? "Pinned on Homescreen (Click to unpin)" : "Pin layout directly on Homescreen"}
                      >
                        <Pin className={`w-3 h-3 ${pinnedTemplateIds.includes(template.id) ? "fill-amber-400 text-amber-400" : ""}`} />
                        <span>{pinnedTemplateIds.includes(template.id) ? "Pinned" : "Pin"}</span>
                      </button>
                    </>
                  )}
                </div>
                <span className="text-[10px] text-metro-secondary leading-none font-mono mt-0.5">
                  Size: {template.widthMm} × {template.heightMm} mm
                </span>
              </div>
            </div>

            {/* Center Column: Design Utilities (Undo/Redo & Zoom) */}
            <div className="hidden md:flex items-center gap-1 bg-metro-header/30 border border-metro-border/60 rounded-xl px-2 py-1 drag-none">
              {/* Undo / Redo */}
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Undo modification (Ctrl+Z)"
              >
                <Undo className="w-4 h-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0}
                className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
                title="Redo modification (Ctrl+Y)"
              >
                <Redo className="w-4 h-4" />
              </button>

              <div className="w-[1px] h-3 bg-metro-border/60 mx-1.5"></div>

              {/* Zoom controls */}
              <button
                onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-mono text-metro-secondary w-12 text-center font-bold">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Right Column: Actions (Save, Print, Close, Panel Toggles) */}
            <div className="flex items-center gap-2 shrink-0 drag-none h-full">
              {/* Panel togglers */}
              <div className="flex items-center gap-0.5 bg-metro-header/30 border border-metro-border/60 rounded-xl p-1 shrink-0">
                <button
                  onClick={() => setShowLeftSidebar((p) => !p)}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${showLeftSidebar
                    ? "bg-metro-accent/10 text-metro-accent"
                    : "text-metro-secondary hover:text-metro-primary"
                    }`}
                  title="Toggle Toolbox (Ctrl+B)"
                >
                  <PanelLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setShowRightSidebar((p) => !p)}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${showRightSidebar
                    ? "bg-metro-accent/10 text-metro-accent"
                    : "text-metro-secondary hover:text-metro-primary"
                    }`}
                  title="Toggle Inspector (Ctrl+I)"
                >
                  <PanelRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="w-[1px] h-5 bg-metro-border shrink-0"></div>

              {/* Group Template */}
              <button
                onClick={() => setShowGroupModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-metro-border bg-metro-panel hover:bg-metro-header hover:border-metro-secondary text-metro-primary transition-all cursor-pointer text-xs font-bold"
                title="Group this layout into a template folder/shortcut"
              >
                <Layers className="w-3.5 h-3.5 text-metro-accent" />
                <span>Group</span>
              </button>

              {/* Save Layout */}
              <button
                onClick={handleSaveProgress}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-metro-border bg-metro-panel hover:bg-metro-header hover:border-metro-secondary text-metro-primary transition-all cursor-pointer text-xs font-bold"
                title="Save layout progress (Ctrl+S)"
              >
                <Save className="w-3.5 h-3.5 text-indigo-400" />
                <span>Save</span>
              </button>

              {/* Save As Layout */}
              <button
                onClick={handleSaveAsTemplateDialog}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-metro-border bg-metro-panel hover:bg-metro-header hover:border-metro-secondary text-metro-primary transition-all cursor-pointer text-xs font-bold"
                title="Save layout design as a new file"
              >
                <FolderPlus className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save As</span>
              </button>

              {/* Print Label */}
              <button
                onClick={() => setShowPrintModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/10 transition-all cursor-pointer border border-indigo-600"
                title="Open printer spooler interface"
              >
                <PrinterIcon className="w-3.5 h-3.5" />
                <span>Print</span>
              </button>



              {/* Custom Window Controls inside Designer */}
              {window.electronAPI && (
                <div className="flex items-center h-full mr-[-16px] ml-2">
                  <button
                    onClick={() => electronAPI.minimize()}
                    className="w-[46px] h-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer"
                    title="Minimize"
                  >
                    <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <line y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  </button>
                  <button
                    onClick={() => electronAPI.maximize()}
                    className="w-[46px] h-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 active:bg-black/20 dark:active:bg-white/20 text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer"
                    title="Maximize"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" fill="none" />
                    </svg>
                  </button>
                  <button
                    onClick={() => electronAPI.close()}
                    className="w-[46px] h-full flex items-center justify-center hover:bg-[#e81123] active:bg-[#f1707a] text-metro-secondary hover:text-white transition-colors cursor-pointer"
                    title="Close"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Main panel viewport */}
      <div className="flex-1 flex overflow-hidden">
        {activeView === 'home' && (
          <Home
            theme={theme}
            onNewTemplate={handleOpenNewSizeModal}
            onReprint={handleReprint}
            onOpenTemplateDialog={handleOpenTemplateDialog}
            onOpenMultipleTemplates={(templates) => {
              setOpenTemplates(templates);
              if (templates.length > 0) {
                setActiveTemplateId(templates[templates.length - 1].id);
              }
              setSelectedId(null);
              setActiveView('designer');
              logMessage(
                "success",
                `Opened group set: ${templates.map((t) => t.name).join(", ")}`,
              );
            }}
            onPrintTemplates={(templates) => {
              setPrintTemplates(templates);
              setShowPrintModal(true);
            }}
            onUpdateDatabaseConfig={(connected, name) => {
              setDbConnected(connected);
              setDbName(name);
              try {
                const stored = localStorage.getItem("barcode_studio_sql_servers");
                if (stored) {
                  const servers = JSON.parse(stored);
                  const active = servers.find((s: any) => s.isActive);
                  if (active) {
                    const prof: ConnectionProfile = {
                      id: active.id,
                      name: active.name,
                      dbType: active.dbType || "mssql",
                      server: active.server,
                      port: active.port || (active.dbType === "mysql" ? 3306 : 1433),
                      instance: active.instance,
                      database: active.database,
                      table: active.table,
                      username: active.username,
                      password: active.password || "",
                      authMode: active.authMode,
                      trustCert: active.trustCert ?? true,
                      encrypt: active.encrypt ?? false,
                      sqlitePath: active.sqlitePath || "barcode_studio_library.db",
                      uniqueField: active.uniqueField || "AccessionNo",
                      fieldMappings: active.fieldMappings || {},
                    };
                    setActiveProfile(prof);
                  } else {
                    setActiveProfile(null);
                  }
                } else {
                  setActiveProfile(null);
                }
              } catch (e) {
                console.error(e);
              }
            }}
            onAutoTriggerPrint={handleAutoTriggerPrint}
            dbConnected={dbConnected}
            dbName={dbName}
            activePrinter={activePrinter}
            printers={printers}
            onSelectPrinter={handleSelectPrinter}
            onSavePrinterSettings={handleSavePrinterSettings}
          />
        )}
        {activeView === 'designer' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Chrome-like Tabs Bar */}
            <div className="h-9 bg-metro-panel border-b border-metro-border flex items-center justify-between px-3 select-none shrink-0">
              <div className="flex items-center gap-1 h-full overflow-x-auto scrollbar-none pt-1">
                {openTemplates.map((t) => {
                  const isActive = t.id === activeTemplateId;
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        setActiveTemplateId(t.id);
                        setSelectedId(null);
                      }}
                      className={`group flex items-center gap-2 h-8 px-3.5 rounded-t-lg text-[11px] font-bold border-t border-x cursor-pointer transition-all ${isActive
                        ? "bg-metro-app border-metro-border text-metro-accent font-extrabold z-10"
                        : "bg-metro-header/60 border-transparent text-metro-secondary hover:bg-metro-header hover:text-metro-primary"
                        }`}
                    >
                      <span className="truncate max-w-[130px]">
                        {t.name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCloseTab(t.id);
                        }}
                        className="p-0.5 rounded hover:bg-metro-input hover:text-rose-500 opacity-50 group-hover:opacity-100 transition-all cursor-pointer"
                        title="Close Design Tab"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}

                {/* Plus add tab button inside the scroll strip, next to the last tab */}
                <button
                  id="tab-add-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setAddTabMenuCoords({
                      top: rect.bottom,
                      left: rect.left,
                    });
                    setShowAddTabMenu(!showAddTabMenu);
                  }}
                  className="p-1 rounded-md hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer self-center ml-1 mb-1 shrink-0"
                  title="Add / Open Layout Template"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Fixed positioning dropdown rendered via portal to escape stacking contexts */}
              {showAddTabMenu && createPortal(
                <div
                  className="fixed bg-metro-panel border border-metro-border rounded-xl shadow-2xl py-1.5 z-[9999] min-w-[175px] text-xs animate-fade-in"
                  style={{
                    top: `${addTabMenuCoords.top + 4}px`,
                    left: `${addTabMenuCoords.left}px`,
                  }}
                >
                  <button
                    onClick={() => {
                      setShowAddTabMenu(false);
                      handleOpenNewSizeModal();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-metro-header text-metro-primary flex items-center gap-2 cursor-pointer font-bold transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-metro-accent shrink-0" />
                    <span>Create New Template</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowAddTabMenu(false);
                      handleOpenTemplateDialog();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-metro-header text-metro-primary flex items-center gap-2 cursor-pointer font-bold transition-colors border-t border-metro-border/40"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Open Template</span>
                  </button>
                </div>,
                document.body
              )}

              {/* Active Tab Info */}
              <div className="flex items-center gap-3 mr-2 shrink-0">
                <div className="text-[9px] text-metro-secondary font-mono uppercase tracking-wider font-extrabold hidden md:block">
                  Tabs Open: {openTemplates.length}
                </div>
                {openTemplates.length > 0 && (
                  <button
                    onClick={() => {
                      setOpenTemplates([]);
                      setActiveTemplateId("");
                      setActiveView('home');
                      logMessage("warning", "Closed all layout templates.");
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-metro-border bg-metro-panel/50 hover:bg-rose-500/10 hover:border-rose-500/30 text-metro-primary hover:text-rose-500 transition-all cursor-pointer text-[9px] font-extrabold uppercase tracking-wider font-mono shrink-0"
                    title="Close All Templates"
                  >
                    <X className="w-3 h-3 text-rose-500" />
                    <span>Close</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden relative">
              {/* Left Toolbox */}
              <div
                className={`transition-all duration-300 ease-in-out flex shrink-0 absolute lg:relative left-0 top-0 bottom-0 z-40 h-full bg-metro-panel lg:bg-transparent border-r border-metro-border shadow-xl lg:shadow-none ${showLeftSidebar ? "w-60 opacity-100" : "w-0 opacity-0 overflow-hidden border-none"}`}
              >
                <SidebarToolbox
                  template={template}
                  onAddElement={handleAddElement}
                  elements={template.elements}
                  selectedId={selectedId}
                  onSelectElement={setSelectedId}
                  onUpdateElement={onUpdateElement}
                  onRemoveElement={handleRemoveElement}
                  onSetZOrder={handleSetZOrder}
                  activeRecord={activeRecord}
                  onSelectRecord={(rec) => {
                    setActiveRecord(rec);
                    if (rec) {
                      const idKey = activeProfile?.uniqueField || "AccessionNo";
                      logMessage(
                        "info",
                        `Live binding lookup record: Index ${rec[idKey] || rec.AccessionNo || ""} loaded.`,
                      );
                    }
                  }}
                  dbConnected={dbConnected}
                  dbName={dbName}
                  activePrinter={activePrinter}
                  onSelectPrinter={handleSelectPrinter}
                  onShowHelp={() => setShowHelpModal(true)}
                  onToggleTheme={() =>
                    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                  }
                  theme={theme}
                  dbRecords={dbRecords}
                  activeProfile={activeProfile}
                />
              </div>

              {/* Canvas vector workspace - SIMPLE SPACE */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <DesignerCanvas
                  widthMm={template.widthMm}
                  heightMm={template.heightMm}
                  shape={template.shape}
                  orientation={template.orientation}
                  mirrorImage={template.mirrorImage}
                  elements={template.elements}
                  selectedId={selectedId}
                  onSelectElement={setSelectedId}
                  selectedIds={selectedIds}
                  onSelectElements={setSelectedIds}
                  onUpdateElement={onUpdateElement}
                  onUpdateElements={onUpdateElements}
                  snapToGrid={snapToGrid}
                  onToggleSnapToGrid={() => setSnapToGrid((prev) => !prev)}
                  gridSizeMm={gridSizeMm}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  activeRecord={activeRecord}
                  activeProfile={activeProfile}
                  onSelectRecord={setActiveRecord}
                  onLogMessage={logMessage}
                  previewMode={previewMode}
                  onPreviewModeChange={setPreviewMode}
                  onRemoveElement={handleRemoveElement}
                  onRemoveElements={handleRemoveElements}
                  onStartHistoryAction={handleStartHistoryAction}
                  unit={template.unit}
                  onUpdateOrientation={(newOrientation) => {
                    setTemplate((prev) => ({ ...prev, orientation: newOrientation }));
                    setActivePrinter((prevPrinter) => ({
                      ...prevPrinter,
                      paperType: template.columns === 2 ? "dual" : "single",
                    }));
                  }}
                  mediaType={template.mediaType}
                  cornerRadiusMm={template.cornerRadiusMm}
                  marginTop={template.marginTop}
                  marginBottom={template.marginBottom}
                  marginLeft={template.marginLeft}
                  marginRight={template.marginRight}
                  gapHorizontal={template.gapHorizontal}
                  gapVertical={template.gapVertical}
                  columns={template.columns}
                  rows={template.rows}
                  pageWidthMm={template.pageWidthMm}
                  pageHeightMm={template.pageHeightMm}
                  paddingLeftMm={template.paddingLeftMm}
                  paddingRightMm={template.paddingRightMm}
                  paddingTopMm={template.paddingTopMm}
                  paddingBottomMm={template.paddingBottomMm}
                  dbRecords={dbRecords}
                  highlightedElementId={highlightedElementId}
                />

                {/* Status Bar Footer */}
                <div className="h-7 bg-metro-panel border-t border-metro-border flex items-center justify-between px-4 shrink-0 text-[10px] font-semibold text-metro-secondary select-none">
                  {/* Left: DB Connection Status */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${dbConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                      <span>
                        {dbConnected
                          ? `Connected: ${activeProfile?.name || dbName}`
                          : 'Database Disconnected'}
                      </span>
                    </div>
                    {activeProfile?.table && (
                      <>
                        <span className="text-metro-border/60">|</span>
                        <span>Table: {activeProfile.table}</span>
                      </>
                    )}
                    {previewMode === 'live' && activeRecord ? (
                      <>
                        <span className="text-metro-border/60">|</span>
                        <span>Live View </span>
                      </>
                    ) : (
                      <>
                        <span className="text-metro-border/60">|</span>
                        <span>Design Mode</span>
                      </>
                    )}
                  </div>

                  {/* Right: Elements count, active printer, rotation, zoom level */}
                  <div className="flex items-center gap-4">
                    <span>Elements: {template.elements.length}</span>
                    <span className="text-metro-border/60">|</span>
                    <span>Printer: {activePrinter?.name || 'No Printer'} ({activePrinter?.dpi || 203} DPI)</span>
                    <span className="text-metro-border/60">|</span>
                    <span>Rotation: {(() => {
                      const o = template.orientation || 'portrait';
                      if (o === 'portrait') return '0°';
                      if (o === 'landscape') return '90°';
                      if (o === 'portrait-180') return '180°';
                      if (o === 'landscape-180') return '270°';
                      return '0°';
                    })()}</span>
                    <span className="text-metro-border/60">|</span>
                    <span>Zoom: {Math.round(zoom * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Properties Panel Inspector */}
              <div
                className={`transition-all duration-300 ease-in-out flex shrink-0 absolute lg:relative right-0 top-0 bottom-0 z-40 h-full bg-metro-panel lg:bg-transparent border-l border-metro-border shadow-xl lg:shadow-none ${showRightSidebar ? "w-60 opacity-100" : "w-0 opacity-0 overflow-hidden border-none"}`}
              >
                <PropertiesPanel
                  selectedElement={
                    template.elements.find((el) => el.id === selectedId) || null
                  }
                  onUpdateElement={onUpdateElement}
                  template={template}
                  onUpdateTemplate={(updates) => {
                    setTemplate((prev) => ({ ...prev, ...updates }));
                    if (updates.widthMm !== undefined || updates.heightMm !== undefined) {
                      setActivePrinter((prevPrinter) => ({
                        ...prevPrinter,
                        ...(updates.widthMm !== undefined ? { widthMm: updates.widthMm } : {}),
                        ...(updates.heightMm !== undefined ? { heightMm: updates.heightMm } : {}),
                      }));
                    }
                  }}
                  dbFields={dbFieldsList}
                  onOpenPageSetup={() => setShowPageSetupModal(true)}
                  onHighlightElement={setHighlightedElementId}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Database Connection Profile Setup Dialog */}
      <ConnectionModal
        isOpen={showConnectionModal}
        onClose={() => setShowConnectionModal(false)}
        activeProfile={activeProfile}
        onSaveProfile={(prof) => {
          setActiveProfile(prof);
          try {
            const stored = localStorage.getItem("barcode_studio_sql_servers");
            let servers = stored ? JSON.parse(stored) : [];
            const index = servers.findIndex((s: any) => s.id === prof.id);
            const serverItem = {
              id: prof.id,
              name: prof.name,
              dbType: prof.dbType,
              server: prof.server,
              port: prof.port,
              instance: prof.instance,
              database: prof.database,
              table: prof.table,
              username: prof.username,
              password: prof.password,
              authMode: prof.authMode,
              trustCert: prof.trustCert,
              encrypt: prof.encrypt,
              sqlitePath: prof.sqlitePath,
              uniqueField: prof.uniqueField,
              fieldMappings: prof.fieldMappings,
              isActive: true,
            };
            // Set all other servers to inactive
            servers = servers.map((s: any) => ({ ...s, isActive: false }));
            if (index >= 0) {
              servers[index] = serverItem;
            } else {
              servers.push(serverItem);
            }
            localStorage.setItem("barcode_studio_sql_servers", JSON.stringify(servers));
          } catch (e) {
            console.error(e);
          }
          logMessage(
            "info",
            `Saved SQL connection parameters for: ${prof.name}`,
          );
        }}
        onLoadedRecords={(records) => {
          setDbRecords(records);
          if (records.length > 0) {
            setActiveRecord(records[0]);
          }
        }}
        onConnect={async (prof) => {
          setDbConnected(true);
          setDbName(prof.database);
          logMessage(
            "success",
            `Connected directly to SQL Server [${prof.server}]. Table [${prof.table}] indexed.`,
          );
          return {
            success: true,
            msg: `Successful connection to ${prof.database}`,
          };
        }}
      />

      {/* Help Modal: Keyboard Shortcuts & Canvas Gestures */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-fade-in">
          <div className="bg-metro-panel border border-metro-border w-full max-w-lg shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 bg-metro-header border-b border-metro-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center">
                  <HelpCircle className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <span className="font-bold text-sm text-metro-primary block">
                    Designer Quick Guide
                  </span>
                  <span className="text-[10px] text-metro-secondary">
                    Available keyboard shortcuts and mouse interactions
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowHelpModal(false)}
                className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs">
              {/* Keyboard Shortcuts Section */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-metro-primary uppercase tracking-wider text-[10px] font-mono border-b border-metro-border pb-1.5">
                  Keyboard Shortcuts
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    {
                      keys: ["Ctrl", "S"],
                      desc: "Save layout progress to persistent storage",
                    },
                    {
                      keys: ["Ctrl", "P"],
                      desc: "Open printing spooler interface",
                    },
                    {
                      keys: ["Ctrl", "Z"],
                      desc: "Undo the last design canvas modification",
                    },
                    {
                      keys: ["Ctrl", "Y"],
                      desc: "Redo the previously undone canvas action",
                    },
                    {
                      keys: ["Ctrl", "C"],
                      desc: "Copy selected element to local clipboard",
                    },
                    {
                      keys: ["Ctrl", "V"],
                      desc: "Paste copied element with offset (+2.5mm)",
                    },
                    {
                      keys: ["Ctrl", "D"],
                      desc: "Duplicate selected element with offset (+2.5mm)",
                    },
                    {
                      keys: ["Ctrl", "B"],
                      desc: "Toggle visibility of Left Toolbox",
                    },
                    {
                      keys: ["Ctrl", "I"],
                      desc: "Toggle visibility of Right Inspector",
                    },
                    {
                      keys: ["Del", "/ Backspace"],
                      desc: "Delete the currently selected element",
                    },
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-4 p-2.5 rounded-xl bg-metro-input/20 border border-metro-border/40 hover:bg-metro-input/40 transition-colors"
                    >
                      <span className="text-metro-secondary font-medium leading-relaxed max-w-[200px]">
                        {item.desc}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        {item.keys.map((k, kIdx) => (
                          <kbd
                            key={kIdx}
                            className="px-1.5 py-0.5 rounded bg-metro-header border border-metro-border text-[9px] font-mono font-bold text-metro-primary shadow-sm"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Arrow Key Nudging Section */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-metro-primary uppercase tracking-wider text-[10px] font-mono border-b border-metro-border pb-1.5">
                  Precision Arrow Nudging
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-metro-input/20 border border-metro-border/40">
                    <span className="text-[18px]">🎯</span>
                    <div>
                      <div className="font-bold text-metro-primary">
                        Fine Nudge (0.5 mm)
                      </div>
                      <p className="text-[10px] text-metro-secondary mt-0.5 leading-relaxed">
                        Use the{" "}
                        <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                          ↑
                        </kbd>{" "}
                        <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                          ↓
                        </kbd>{" "}
                        <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                          ←
                        </kbd>{" "}
                        <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                          →
                        </kbd>{" "}
                        arrow keys to slide active vector elements precisely.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-metro-input/20 border border-metro-border/40">
                    <span className="text-[18px]">⚡</span>
                    <div>
                      <div className="font-bold text-metro-primary">
                        Large Nudge (2.5 mm)
                      </div>
                      <p className="text-[10px] text-metro-secondary mt-0.5 leading-relaxed">
                        Hold{" "}
                        <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                          Shift
                        </kbd>{" "}
                        while pressing arrow keys to translate selection items
                        at dynamic velocity.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Gestures and Mouse interaction */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-metro-primary uppercase tracking-wider text-[10px] font-mono border-b border-metro-border pb-1.5">
                  Advanced Canvas Operations
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-metro-input/20 border border-metro-border/40 space-y-1">
                    <div className="font-bold text-metro-primary flex items-center gap-1.5">
                      <span className="text-indigo-400 font-bold">📐</span>{" "}
                      Multi-Element Selection
                    </div>
                    <p className="text-[10px] text-metro-secondary leading-relaxed">
                      Hold{" "}
                      <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                        Shift
                      </kbd>{" "}
                      and click multiple design components, or click and drag on
                      empty canvas space to draw a marquee selection rectangle.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-metro-input/20 border border-metro-border/40 space-y-1">
                    <div className="font-bold text-metro-primary flex items-center gap-1.5">
                      <span className="text-indigo-400 font-bold">🖐️</span>{" "}
                      Panning & Workspace Navigation
                    </div>
                    <p className="text-[10px] text-metro-secondary leading-relaxed">
                      Select the Hand tool or hold{" "}
                      <kbd className="px-1 bg-metro-header border border-metro-border rounded text-[9px] font-mono font-bold">
                        Space
                      </kbd>{" "}
                      or use your middle mouse button to drag and pan across the
                      millimetric layout draft space.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 bg-metro-header border-t border-metro-border flex items-center justify-end shrink-0">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all cursor-pointer shadow-md shadow-indigo-500/10"
              >
                Got it, close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printing Dialog */}
      <PrintModal
        isOpen={showPrintModal}
        onClose={() => {
          setShowPrintModal(false);
          setPreloadedAccessionNumbers([]);
          setAutoStartPrint(false);
          setPrintTemplates([]);
        }}
        activeRecord={activeRecord}
        activePrinter={activePrinter}
        onLogMessage={logMessage}
        templates={printTemplates.length > 0 ? printTemplates : openTemplates}
        initialAccessionNumbers={preloadedAccessionNumbers}
        autoStart={autoStartPrint}
        theme={theme}
        dbRecords={dbRecords}
        activeProfile={activeProfile}
        printers={printers}
        onSelectPrinter={handleSelectPrinter}
      />

      <PageSetupModal
        isOpen={showPageSetupModal}
        onClose={() => setShowPageSetupModal(false)}
        template={pageSetupMode === 'create' ? BLANK_TEMPLATE : template}
        mode={pageSetupMode}
        onSave={(updates) => {
          if (pageSetupMode === 'create') {
            const newTab: LabelTemplate = {
              id: `t-${Math.random().toString(36).substring(2, 9)}`,
              name: updates.name || "Custom Size Label Layout",
              widthMm: updates.widthMm || 75,
              heightMm: updates.heightMm || 38,
              marginMm: updates.marginMm ?? 2,
              elements: [],
              uniqueField: "AccessionNo",
              lastModified: new Date().toISOString(),
              shape: updates.shape || "rectangle",
              orientation: updates.orientation || "portrait",
              unit: updates.unit || 'mm',
              rows: updates.rows || 1,
              columns: updates.columns || 2,
              marginTop: updates.marginTop ?? 0,
              marginBottom: updates.marginBottom ?? 0,
              marginLeft: updates.marginLeft ?? 1.27,
              marginRight: updates.marginRight ?? 1.27,
              setLabelSizeManually: updates.setLabelSizeManually ?? true,
              gapHorizontal: updates.gapHorizontal ?? 0,
              gapVertical: updates.gapVertical ?? 0,
              setGapManually: updates.setGapManually ?? true,
              startingCorner: updates.startingCorner || 'top-left',
              primaryDirection: updates.primaryDirection || 'horizontal',
              promptForStartNumber: updates.promptForStartNumber ?? false,
              trackStartNumber: updates.trackStartNumber ?? false,
              pageWidthMm: updates.pageWidthMm,
              pageHeightMm: updates.pageHeightMm,
            };

            setOpenTemplates((prev) => [...prev, newTab]);
            setActiveTemplateId(newTab.id);

            setActivePrinter((prevPrinter) => ({
              ...prevPrinter,
              widthMm: newTab.widthMm,
              heightMm: newTab.heightMm,
              leftMarginMm: newTab.marginLeft,
              rightMarginMm: newTab.marginRight,
              topMarginMm: newTab.marginTop,
              middleGapMm: newTab.gapHorizontal,
              paperType: newTab.columns === 2 ? "dual" : "single",
            }));

            setSelectedId(null);
            setActiveView('designer');
            logMessage(
              "success",
              `Created customized designer canvas sized: ${newTab.widthMm}x${newTab.heightMm} mm.`,
            );
          } else {
            // Edit Mode: update existing template
            setTemplate((prev) => ({ ...prev, ...updates }));
            setActivePrinter((prevPrinter) => ({
              ...prevPrinter,
              widthMm: updates.widthMm ?? prevPrinter.widthMm,
              heightMm: updates.heightMm ?? prevPrinter.heightMm,
              leftMarginMm: updates.marginLeft ?? prevPrinter.leftMarginMm,
              rightMarginMm: updates.marginRight ?? prevPrinter.rightMarginMm,
              topMarginMm: updates.marginTop ?? prevPrinter.topMarginMm,
              middleGapMm: updates.gapHorizontal ?? prevPrinter.middleGapMm,
              paperType: updates.columns !== undefined ? (updates.columns === 2 ? "dual" : "single") : prevPrinter.paperType,
            }));
          }
        }}
        theme={theme}
      />

      {/* Group Template Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4 select-none animate-fade-in">
          <div className="bg-metro-panel border border-metro-border w-full max-w-md shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 bg-metro-header border-b border-metro-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <span className="font-bold text-sm text-metro-primary block">
                    Group Layout Template
                  </span>
                  <span className="text-[10px] text-metro-secondary">
                    Assign '{template.name}' to a group or create a new group shortcut
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowGroupModal(false)}
                className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Existing Groups List */}
              <div>
                <label className="font-bold text-metro-primary uppercase tracking-wider text-[10px] font-mono block mb-2">
                  Assign to Existing Groups
                </label>
                {existingGroups.length === 0 ? (
                  <div className="p-3 rounded-xl bg-metro-input/20 border border-metro-border/40 text-[11px] text-metro-secondary text-center">
                    No template groups created yet. Create a new group below!
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {existingGroups.map((group) => {
                      const isChecked = group.templateIds.includes(template.id);
                      return (
                        <label
                          key={group.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-metro-input/20 border border-metro-border/40 hover:bg-metro-input/40 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggleTemplateInGroup(group.id)}
                              className="rounded border-metro-border text-indigo-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="font-bold text-metro-primary text-xs">
                              {group.name}
                            </span>
                          </div>
                          <span className="text-[10px] text-metro-secondary font-mono">
                            {group.templateIds.length} layout{group.templateIds.length !== 1 ? "s" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Create New Group */}
              <div className="pt-2 border-t border-metro-border/40">
                <label className="font-bold text-metro-primary uppercase tracking-wider text-[10px] font-mono block mb-2">
                  Create New Group / Shortcut Folder
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Spine Label Presets..."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateAndAssignGroup();
                    }}
                    className="flex-1 bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs font-semibold text-metro-primary outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleCreateAndAssignGroup}
                    disabled={!newGroupName.trim()}
                    className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs transition-all cursor-pointer shrink-0"
                  >
                    + Create
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-metro-header border-t border-metro-border flex items-center justify-end">
              <button
                onClick={() => setShowGroupModal(false)}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restart App Modal on Config Import / Load */}
      <RestartAppModal
        isOpen={restartModalInfo.isOpen}
        fileName={restartModalInfo.fileName}
        theme={theme}
        onRestart={() => electronAPI.restartApp()}
        onClose={() => setRestartModalInfo({ isOpen: false })}
      />

    </div>
  );
}
