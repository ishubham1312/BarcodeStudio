import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Printer, ConnectionProfile } from "../types";
import { mockPrinters, defaultTemplates } from "../data/mockData";
import { useElectronAPI } from "../hooks/useElectronAPI";
import logoUrl from "@/assets/logo.png";
import shubhamGif from "@/assets/shubham.gif";
import { ConnectionModal } from "./ConnectionModal";
import { RestartAppModal } from "./RestartAppModal";
import {
  Printer as PrinterIcon,
  Database,
  Sparkles,
  CheckCircle,
  RefreshCw,
  Sliders,
  Eye,
  EyeOff,
  Terminal,
  BookOpen,
  Cpu,
  Ruler,
  Layers,
  HelpCircle,
  Plus,
  X,
  Trash2,
  Search,
  Server,
  Check,
  Save,
  AlertCircle,
  Network,
  Settings,
  Upload,
  Download,
  PackageOpen,
  SlidersHorizontal,
  ChevronRight,
  Info,
  Mail,
  ToggleLeft,
  ToggleRight,
  Bell,
  Play,
  CheckCircle2,
  Clock,
  ArrowRight,
  ArrowLeft,
  UserCheck,
  Globe,
  Github,
  Activity,
  Pencil,
  Code2,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { motion } from "motion/react";

interface SQLServer {
  id: string;
  name: string;
  server: string;
  instance: string;
  database: string;
  table: string;
  username: string;
  password?: string;
  authMode: "windows" | "sql";
  uniqueField: string;
  isActive: boolean;
}

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

interface SettingsViewProps {
  dbConnected: boolean;
  dbName: string;
  onUpdateDatabaseConfig: (connected: boolean, name: string) => void;
  onAutoTriggerPrint?: (accessionNumbers: string[]) => void;
  activePrinter: Printer;
  onSelectPrinter: (printer: Printer) => void;
  printers?: Printer[];
  onSavePrinterSettings?: (printer: Printer) => void;
  theme: "light" | "dark";
  onBack: () => void;
}

const availablePrinters: Printer[] = [
  {
    name: "Microsoft Print to PDF (600dpi)",
    status: "Ready",
    type: "Virtual Document Printer",
    dpi: 600,
  },
];

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

export const SettingsView: React.FC<SettingsViewProps> = ({
  dbConnected,
  dbName,
  onUpdateDatabaseConfig,
  onAutoTriggerPrint,
  activePrinter,
  onSelectPrinter,
  printers,
  onSavePrinterSettings,
  theme,
  onBack,
}) => {
  const electronAPI = useElectronAPI();
  // Navigation Tabs state: 'database' | 'gmail' | 'preferences' | 'about'
  const [activeTab, setActiveTab] = useState<"database" | "gmail" | "preferences" | "about">("database");

  // Restart Modal state on config import
  const [restartModalInfo, setRestartModalInfo] = useState<{ isOpen: boolean; fileName?: string }>({ isOpen: false });

  // Save Settings Status state
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSavePrinterSettingsLocal = () => {
    if (onSavePrinterSettings) {
      onSavePrinterSettings(activePrinter);
    } else {
      try {
        localStorage.setItem("barcode_studio_active_printer", JSON.stringify(activePrinter));
      } catch (e) {
        console.error(e);
      }
    }
    setSaveSuccess(true);
    setTimeout(() => {
      setSaveSuccess(false);
    }, 3000);
  };

  // Default print-quality resolution mode (auto / highest / highspeed)
  const [printQuality, setPrintQuality] = useState<string>("auto");
  const [qualitySaved, setQualitySaved] = useState(false);

  // Load the saved default print quality from backend settings on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.electronAPI) {
          const res = await electronAPI.getSettings();
          if (!cancelled && res?.success && res.settings?.preferences?.printQuality) {
            setPrintQuality(res.settings.preferences.printQuality);
          }
        }
      } catch (e) {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [electronAPI]);

  const handleSavePrintQuality = async (mode: string) => {
    setPrintQuality(mode);
    try {
      if (window.electronAPI) {
        // Merge into existing backend settings so we don't clobber other prefs.
        let current: any = { preferences: {} };
        try {
          const res = await electronAPI.getSettings();
          if (res?.success && res.settings) current = res.settings;
        } catch (e) {
          /* ignore, start from defaults */
        }
        const merged = {
          ...current,
          preferences: {
            ...(current.preferences || {}),
            printQuality: mode,
          },
        };
        await electronAPI.saveSettings(merged);
        setQualitySaved(true);
        setTimeout(() => setQualitySaved(false), 3000);
      }
    } catch (e) {
      console.error("Failed to persist print quality:", e);
    }
  };

  // Hardware Scanner Simulation
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [isTestingImap, setIsTestingImap] = useState(false);
  const [scannedPrinters, setScannedPrinters] = useState<Printer[]>([]);

  const displayPrinters = hasScanned ? scannedPrinters : (printers || mockPrinters);

  // SQL Servers registry
  const [servers, setServers] = useState<SQLServer[]>(() => {
    let initialServers: SQLServer[] = [];
    try {
      const stored = localStorage.getItem("barcode_studio_sql_servers");
      if (stored) {
        initialServers = JSON.parse(stored);
      }
    } catch (e) {
      console.error(e);
    }

    return initialServers;
  });

  // Save servers registry
  useEffect(() => {
    localStorage.setItem("barcode_studio_sql_servers", JSON.stringify(servers));
  }, [servers]);


  // Add Server Multi-step Wizard States
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);

  const activeProfileForModal = useMemo<ConnectionProfile | null>(() => {
    if (!editingServerId) return null;
    const srv = servers.find((s) => s.id === editingServerId);
    if (!srv) return null;
    return {
      id: srv.id,
      name: srv.name,
      dbType: (srv as any).dbType || "mssql",
      server: srv.server,
      port: (srv as any).port || ((srv as any).dbType === "mysql" ? 3306 : 1433),
      instance: srv.instance,
      database: srv.database,
      table: srv.table,
      sqlitePath: (srv as any).sqlitePath || "barcode_studio_library.db",
      username: srv.username,
      password: srv.password,
      authMode: srv.authMode,
      trustCert: (srv as any).trustCert ?? true,
      encrypt: (srv as any).encrypt ?? false,
      uniqueField: srv.uniqueField || "AccessionNo",
      fieldMappings: (srv as any).fieldMappings || {},
    };
  }, [editingServerId, servers]);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [srvName, setSrvName] = useState("");
  const [srvHost, setSrvHost] = useState("");
  const [srvInstance, setSrvInstance] = useState("");
  const [srvDatabase, setSrvDatabase] = useState("");
  const [srvTable, setSrvTable] = useState("");
  const [srvUser, setSrvUser] = useState("");
  const [srvPass, setSrvPass] = useState("");
  const [srvAuthMode, setSrvAuthMode] = useState<"windows" | "sql">("sql");
  const [srvUniqueField, setSrvUniqueField] = useState("AccessionNo");
  const [showPass, setShowPass] = useState(false);

  // Testing & Handshake Simulation States
  const [handshakeProgress, setHandshakeProgress] = useState(0);
  const [wizardLogs, setWizardLogs] = useState<string[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [testLogs, setTestLogs] = useState<string[]>([]);

  // Search & Query Tool States
  const [queryingServerId, setQueryingServerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [foundRecord, setFoundRecord] = useState<Record<string, any> | null>(null);
  const [searchError, setSearchError] = useState("");
  const [querySearchFieldKey, setQuerySearchFieldKey] = useState<string>("");
  const [querySearchLoading, setQuerySearchLoading] = useState(false);

  // Derive mapped fields list for the currently querying server
  const queryMappedFields = useMemo(() => {
    if (!queryingServerId) return [];
    const srv = servers.find(s => s.id === queryingServerId);
    if (!srv) return [];
    const mappings: Record<string, string> = (srv as any).fieldMappings || {};
    const list = Object.entries(mappings)
      .filter(([key, val]) => {
        const v = val as string;
        return v && v.trim() !== "" && !v.includes("Skip Bind");
      })
      .map(([key, val]) => ({
        key,
        label: STANDARD_FIELD_LABELS[key] || key,
        physical: val as string
      }));
    if (list.length === 0) {
      const uField = srv.uniqueField || "AccessionNo";
      return [{ key: uField, label: STANDARD_FIELD_LABELS[uField] || uField, physical: uField }];
    }
    return list;
  }, [queryingServerId, servers]);

  // Gmail Configuration state - clean defaults without hardcoded credentials
  const [gmailAddress, setGmailAddress] = useState(() => {
    const saved = localStorage.getItem("gmail_address");
    return saved && saved !== "librarian.catalog@gmail.com" ? saved : "";
  });
  const [gmailAppPassword, setGmailAppPassword] = useState(() => {
    const saved = localStorage.getItem("gmail_app_password");
    return saved && saved !== "abcd efgh ijkl mnop" ? saved : "";
  });

  // Multiple trigger subjects state
  const [triggerSubjects, setTriggerSubjects] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("gmail_trigger_subjects");
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error(e);
    }
    const single = localStorage.getItem("gmail_trigger_subject");
    return single ? [single] : ["PRINT_LABELS", "SPINE_LABELS", "AUTO_PRINT"];
  });
  const [newSubjectInput, setNewSubjectInput] = useState("");

  const handleAddSubjectVariations = useCallback((val: string) => {
    const raw = val.trim();
    if (!raw) return;

    const list: string[] = [raw];
    list.push(raw.toLowerCase());
    list.push(raw.toUpperCase());

    // Sentence case
    list.push(raw.charAt(0).toUpperCase() + raw.slice(1));
    list.push(raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase());

    const words = raw.split(/[\s_]+/);
    if (words.length > 0) {
      const capitalizedWords = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

      // Title Case combinations
      list.push(capitalizedWords.join(" "));
      list.push(capitalizedWords.join("_"));

      const spaceJoined = words.join(" ");
      const underscoreJoined = words.join("_");

      list.push(spaceJoined.toLowerCase());
      list.push(spaceJoined.toUpperCase());
      list.push(underscoreJoined.toLowerCase());
      list.push(underscoreJoined.toUpperCase());
    }

    const uniqueNew = Array.from(new Set(list.filter(Boolean)));
    setTriggerSubjects(prev => {
      const combined = [...prev];
      uniqueNew.forEach(item => {
        if (!combined.includes(item)) {
          combined.push(item);
        }
      });
      return combined;
    });
  }, []);

  const [showAddTemplate, setShowAddTemplate] = useState(false);

  // New States for Template Selection and Verified Sender Filter
  const [gmailSelectedTemplates, setGmailSelectedTemplates] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("gmail_selected_templates");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  });

  const [gmailVerifiedOnly, setGmailVerifiedOnly] = useState<boolean>(() => {
    return localStorage.getItem("gmail_verified_only") === "true";
  });

  const [gmailVerifiedSenders, setGmailVerifiedSenders] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("gmail_verified_senders");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Filter out legacy hardcoded dummy/sample emails
          return parsed.filter(
            (email: string) =>
              email &&
              typeof email === "string" &&
              !email.toLowerCase().includes("citycollege.edu") &&
              !email.toLowerCase().includes("institution.edu") &&
              !email.toLowerCase().includes("example.com")
          );
        }
      }
      return [];
    } catch (e) {
      console.error(e);
      return [];
    }
  });

  const [newVerifiedEmail, setNewVerifiedEmail] = useState("");
  const [editingVerifiedIndex, setEditingVerifiedIndex] = useState<number | null>(null);
  const [editingVerifiedValue, setEditingVerifiedValue] = useState("");

  const [savedUserTemplates] = useState<any[]>(() => {
    try {
      const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
      return savedStr ? JSON.parse(savedStr) : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  });

  const allAvailableTemplates = [...savedUserTemplates, ...defaultTemplates].filter(
    (item, index, self) => self.findIndex((t) => t.id === item.id) === index,
  );

  const [pollingEnabled, setPollingEnabled] = useState(
    () => localStorage.getItem("gmail_polling_enabled") === "true",
  );
  const [pollingInterval, setPollingInterval] = useState(
    () => localStorage.getItem("gmail_polling_interval") || "Every 30 seconds",
  );
  const [showGmailPass, setShowGmailPass] = useState(false);
  const [gmailStatus, setGmailStatus] = useState<"listening" | "idle">("idle");
  const [gmailLogs, setGmailLogs] = useState<string[]>([]);
  const [isGmailChecking, setIsGmailChecking] = useState(false);
  const terminalContainerRef = React.useRef<HTMLDivElement>(null);

  // Persisted last-poll timestamp — sent to backend so it can filter by time
  const [lastPollTime, setLastPollTime] = useState<string | null>(
    () => localStorage.getItem("gmail_last_poll_time") || null
  );

  // "Printing Done" popup state
  const [printDoneInfo, setPrintDoneInfo] = useState<{
    accessions: number;
    pages: number;
    printer: string;
  } | null>(null);

  // Template key → template ID mappings (a → first template, b → second, etc.)
  const [gmailTemplateMappings, setGmailTemplateMappings] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem("gmail_template_mappings");
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  });

  useEffect(() => {
    localStorage.setItem("gmail_template_mappings", JSON.stringify(gmailTemplateMappings));
  }, [gmailTemplateMappings]);

  // Persist lastPollTime to localStorage so it survives app restarts
  useEffect(() => {
    if (lastPollTime) {
      localStorage.setItem("gmail_last_poll_time", lastPollTime);
    }
  }, [lastPollTime]);

  // Auto-scroll ONLY inside the terminal viewport, never scrolling the whole page
  useEffect(() => {
    if (terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [gmailLogs]);

  const LETTER_KEYS = "abcdefghijklmnopqrstuvwxyz".split("");
  const nextAvailableLetter = LETTER_KEYS.find(l => !(l in gmailTemplateMappings)) || "";


  // Detailed scheduling selector states
  const [pollingMode, setPollingMode] = useState<
    "interval" | "daily" | "manual"
  >(() => {
    const stored =
      localStorage.getItem("gmail_polling_interval") || "Every 30 seconds";
    if (stored === "Manual Only") return "manual";
    if (stored.startsWith("Daily at ")) return "daily";
    return "interval";
  });

  const [intervalValue, setIntervalValue] = useState<number | "">(() => {
    const stored =
      localStorage.getItem("gmail_polling_interval") || "Every 30 seconds";
    if (stored === "Manual Only" || stored.startsWith("Daily at ")) return 30;
    const parts = stored.split(" ");
    const num = parseInt(parts[1]);
    return isNaN(num) ? 30 : num;
  });

  const [intervalUnit, setIntervalUnit] = useState<
    "seconds" | "minutes" | "hours"
  >(() => {
    const stored =
      localStorage.getItem("gmail_polling_interval") || "Every 30 seconds";
    if (stored === "Manual Only" || stored.startsWith("Daily at "))
      return "seconds";
    const parts = stored.split(" ");
    if (parts.length >= 3) {
      const u = parts[2].toLowerCase();
      if (u.includes("second")) return "seconds";
      if (u.includes("minute")) return "minutes";
      if (u.includes("hour")) return "hours";
    }
    return "seconds";
  });

  const [dailyTime, setDailyTime] = useState<string>(() => {
    const stored =
      localStorage.getItem("gmail_polling_interval") || "Every 30 seconds";
    if (stored.startsWith("Daily at ")) {
      return stored.replace("Daily at ", "");
    }
    return "09:00";
  });

  // Calculate pollingInterval whenever sub-states change
  useEffect(() => {
    let str = "Manual Only";
    if (pollingMode === "interval") {
      str = `Every ${intervalValue} ${intervalValue === 1 ? intervalUnit.slice(0, -1) : intervalUnit}`;
    } else if (pollingMode === "daily") {
      str = `Daily at ${dailyTime}`;
    }
    setPollingInterval(str);
  }, [pollingMode, intervalValue, intervalUnit, dailyTime]);

  // Print job queue + busy lock (declared after pollingMode state)
  const printQueueRef = React.useRef<(() => Promise<void>)[]>([]);
  const isPrintingRef = React.useRef(false);

  const drainQueue = React.useRef<() => Promise<void>>(() => Promise.resolve());

  drainQueue.current = async () => {
    if (isPrintingRef.current) return;
    while (printQueueRef.current.length > 0) {
      const job = printQueueRef.current.shift()!;
      isPrintingRef.current = true;
      try { await job(); } catch (e) { console.error("Queue job failed:", e); }
      isPrintingRef.current = false;
    }
  };

  const enqueuePrintJob = React.useCallback((job: () => Promise<void>) => {
    printQueueRef.current.push(job);
    if (!isPrintingRef.current) {
      drainQueue.current();
    }
  }, []);

  // Auto-poll countdown timer
  const [countdown, setCountdown] = React.useState<number>(0);
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Preset intervals in seconds
  const PRESET_INTERVALS = [
    { label: "10s", value: 10 },
    { label: "30s", value: 30 },
    { label: "1 min", value: 60 },
    { label: "2 min", value: 120 },
    { label: "5 min", value: 300 },
  ];

  // Resolve polling interval in seconds
  const pollingIntervalSeconds = React.useMemo(() => {
    if (pollingMode === "manual") return 0;
    if (pollingMode === "interval") {
      const val = Number(intervalValue) || 30;
      if (intervalUnit === "seconds") return val;
      if (intervalUnit === "minutes") return val * 60;
      if (intervalUnit === "hours") return val * 3600;
    }
    return 0;
  }, [pollingMode, intervalValue, intervalUnit]);

  // Listen for background auto-polling ticking and completed logs events
  useEffect(() => {
    const handleTick = (e: Event) => {
      setCountdown((e as CustomEvent).detail || 0);
    };
    const handlePollCompleted = (e: Event) => {
      const result = (e as CustomEvent).detail;
      if (result) {
        if (result.logs) setGmailLogs(result.logs);
        if (result.success) setGmailStatus("listening");

        const logs = result.logs || [];
        const printDoneLine = logs.find((log: string) => log.startsWith('[PRINT_DONE]'));
        if (printDoneLine && result.success) {
          const match = printDoneLine.match(/\[PRINT_DONE\]\s+(\d+):(\d+)/);
          if (match) {
            const accessions = parseInt(match[1]);
            const pages = parseInt(match[2]);
            setPrintDoneInfo({
              accessions,
              pages,
              printer: activePrinter?.name || 'printer'
            });
          }
        }
      }
    };

    window.addEventListener("gmail-countdown-tick", handleTick);
    window.addEventListener("gmail-poll-completed", handlePollCompleted);
    return () => {
      window.removeEventListener("gmail-countdown-tick", handleTick);
      window.removeEventListener("gmail-poll-completed", handlePollCompleted);
    };
  }, [activePrinter]);

  // Save Gmail Configs and notify background worker
  useEffect(() => {
    localStorage.setItem("gmail_address", gmailAddress);
    localStorage.setItem("gmail_app_password", gmailAppPassword);
    localStorage.setItem(
      "gmail_trigger_subjects",
      JSON.stringify(triggerSubjects),
    );
    localStorage.setItem("gmail_polling_enabled", String(pollingEnabled));
    localStorage.setItem("gmail_polling_interval", pollingInterval);
    localStorage.setItem("gmail_selected_templates", JSON.stringify(gmailSelectedTemplates));
    localStorage.setItem("gmail_verified_only", String(gmailVerifiedOnly));
    localStorage.setItem("gmail_verified_senders", JSON.stringify(gmailVerifiedSenders));

    // Notify the background poller in App.tsx that settings have changed
    window.dispatchEvent(new CustomEvent("gmail-settings-changed"));
  }, [
    gmailAddress,
    gmailAppPassword,
    triggerSubjects,
    pollingEnabled,
    pollingInterval,
    gmailSelectedTemplates,
    gmailVerifiedOnly,
    gmailVerifiedSenders,
  ]);

  // Initiate Multi-step Server Wizard
  const handleOpenWizard = () => {
    setEditingServerId(null);
    setWizardStep(1);
    setShowConnectionModal(true);
    setHandshakeProgress(0);
    setWizardLogs([]);
  };

  // ── App Config Export ──────────────────────────────────────────────────────
  // Collects all localStorage app data + Python settings into a .bcsc file
  const [configStatus, setConfigStatus] = useState<string | null>(null);

  const handleExportConfig = async () => {
    try {
      // Pull Python-side settings too (server list, active printer from disk)
      let pySettings: any = null;
      try {
        const res = await electronAPI.getSettings();
        if (res.success) pySettings = res.settings;
      } catch { /* non-fatal */ }

      const configBundle: Record<string, any> = {
        __bcs_type: "config",
        __bcs_version: "1.0",
        __exported_at: new Date().toISOString(),

        // Server / database profiles
        barcode_studio_sql_servers: (() => { try { return JSON.parse(localStorage.getItem("barcode_studio_sql_servers") || "[]"); } catch { return []; } })(),

        // Printer settings
        barcode_studio_active_printer: (() => { try { return JSON.parse(localStorage.getItem("barcode_studio_active_printer") || "null"); } catch { return null; } })(),
        barcode_studio_saved_printers: (() => { try { return JSON.parse(localStorage.getItem("barcode_studio_saved_printers") || "[]"); } catch { return []; } })(),

        // Label templates
        windows_barcode_studio_saved_templates: (() => { try { return JSON.parse(localStorage.getItem("windows_barcode_studio_saved_templates") || "[]"); } catch { return []; } })(),
        barcode_studio_custom_presets: (() => { try { return JSON.parse(localStorage.getItem("barcode_studio_custom_presets") || "[]"); } catch { return []; } })(),
        barcode_studio_recent_files: (() => { try { return JSON.parse(localStorage.getItem("barcode_studio_recent_files") || "[]"); } catch { return []; } })(),
        barcode_studio_shortcuts: (() => { try { return JSON.parse(localStorage.getItem("barcode_studio_shortcuts") || "null"); } catch { return null; } })(),

        // Gmail automation (sensitive credentials excluded for security & privacy)
        gmail_trigger_subjects: (() => { try { return JSON.parse(localStorage.getItem("gmail_trigger_subjects") || "[]"); } catch { return []; } })(),
        gmail_polling_enabled: localStorage.getItem("gmail_polling_enabled") || "false",
        gmail_polling_interval: localStorage.getItem("gmail_polling_interval") || "",
        gmail_selected_templates: (() => { try { return JSON.parse(localStorage.getItem("gmail_selected_templates") || "[]"); } catch { return []; } })(),
        gmail_verified_only: localStorage.getItem("gmail_verified_only") || "false",
        gmail_verified_senders: (() => { try { return JSON.parse(localStorage.getItem("gmail_verified_senders") || "[]"); } catch { return []; } })(),
        gmail_template_mappings: (() => { try { return JSON.parse(localStorage.getItem("gmail_template_mappings") || "{}"); } catch { return {}; } })(),

        // Python-side settings (servers + printer from disk)
        py_settings: pySettings,
      };

      const json = JSON.stringify(configBundle, null, 2);

      const dialogRes = await electronAPI.showSaveDialog({
        title: "Export App Configuration",
        defaultPath: `barcode_studio_config_${new Date().toISOString().slice(0, 10)}.bcsc`,
        filters: [
          { name: "Barcode Studio Config File (*.bcsc)", extensions: ["bcsc"] },
        ],
      });

      if (dialogRes.canceled || !dialogRes.filePath) return;

      const saveRes = await electronAPI.saveTemplateFile(dialogRes.filePath, json);
      if (saveRes.success) {
        setConfigStatus("✓ Configuration exported successfully.");
      } else {
        setConfigStatus(`✗ Export failed: ${saveRes.message}`);
      }
    } catch (err: any) {
      setConfigStatus(`✗ Export error: ${err.message}`);
    }
    setTimeout(() => setConfigStatus(null), 4000);
  };

  // ── App Config Import ──────────────────────────────────────────────────────
  const handleImportConfig = async () => {
    try {
      const dialogRes = await electronAPI.showOpenDialog({
        title: "Import App Configuration",
        filters: [
          { name: "Barcode Studio Config File (*.bcsc)", extensions: ["bcsc"] },
        ],
        properties: ["openFile"],
      });

      if (dialogRes.canceled || dialogRes.filePaths.length === 0) return;

      const readRes = await electronAPI.readTemplateFile(dialogRes.filePaths[0]);
      if (!readRes.success || !readRes.content) {
        setConfigStatus("✗ Could not read the selected file.");
        setTimeout(() => setConfigStatus(null), 4000);
        return;
      }

      let bundle: any;
      try {
        bundle = JSON.parse(readRes.content);
      } catch {
        setConfigStatus("✗ Invalid config file — could not parse JSON.");
        setTimeout(() => setConfigStatus(null), 4000);
        return;
      }

      // Validate it is a config bundle not a template file
      if (bundle.__bcs_type !== "config") {
        setConfigStatus("✗ This is a template file (.bcs), not a config file (.bcsc). Open it from File → Open instead.");
        setTimeout(() => setConfigStatus(null), 6000);
        return;
      }

      // Restore localStorage keys
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

      lsKeys.forEach(([key, value]) => {
        try { localStorage.setItem(key, value); } catch { /* quota */ }
      });

      // Also push Python-side settings to disk if present
      if (bundle.py_settings) {
        try { await electronAPI.saveSettings(bundle.py_settings); } catch { /* non-fatal */ }
      }

      // Reload server list from localStorage into component state
      try {
        const stored = localStorage.getItem("barcode_studio_sql_servers");
        if (stored) setServers(JSON.parse(stored));
      } catch { /* ignore */ }

      const selectedFileName = dialogRes.filePaths[0].split(/[\\/]/).pop() || dialogRes.filePaths[0];
      setRestartModalInfo({ isOpen: true, fileName: selectedFileName });
      setConfigStatus("✓ Configuration imported successfully.");
    } catch (err: any) {
      setConfigStatus(`✗ Import error: ${err.message}`);
    }
    setTimeout(() => setConfigStatus(null), 6000);
  };

  const handleEditServer = (server: SQLServer) => {
    setEditingServerId(server.id);
    setSrvName(server.name);
    setSrvHost(server.server);
    setSrvInstance(server.instance);
    setSrvDatabase(server.database);
    setSrvTable(server.table);
    setSrvUser(server.username);
    setSrvPass(server.password || "••••••••••••");
    setSrvAuthMode(server.authMode);
    setSrvUniqueField(server.uniqueField);

    setWizardStep(1);
    setShowConnectionModal(true);
    setHandshakeProgress(0);
    setWizardLogs([]);
  };

  const handleStartWizardHandshake = () => {
    setWizardStep(2);
    setHandshakeProgress(0);
    setWizardLogs([
      `[PING] Locating direct database host at address "${srvHost}"...`,
      `[PING] Checking connection state via socket bind on port 1434...`,
    ]);

    let prog = 0;
    const interval = setInterval(() => {
      prog += 10;
      setHandshakeProgress(Math.min(prog, 100));

      if (prog === 30) {
        setWizardLogs((prev) => [
          ...prev,
          `[TCP] Active connection established with host "${srvHost}".`,
          `[HANDSHAKE] Transferring TDS connection payload version 7.4...`,
        ]);
      } else if (prog === 60) {
        setWizardLogs((prev) => [
          ...prev,
          srvAuthMode === "windows"
            ? `[AUTH] Authenticated securely with local Windows Credentials Token.`
            : `[AUTH] Encrypting connection & logging in using SQL User "${srvUser}"...`,
          `[CATALOG] Switching catalog schema database to [${srvDatabase}].`,
        ]);
      } else if (prog === 85) {
        setWizardLogs((prev) => [
          ...prev,
          `[SCHEMA] Success! Found table "[${srvTable}]".`,
          `[SCHEMA] Read schema data. Identified 11 index column headers.`,
        ]);
      } else if (prog === 100) {
        clearInterval(interval);
        setWizardLogs((prev) => [
          ...prev,
          `[SUCCESS] Direct handshake verified successfully. Ready to bind column headers.`,
        ]);
      }
    }, 250);
  };

  // Add or edit registered server from step 3
  const handleWizardSubmit = () => {
    if (editingServerId) {
      setServers((prev) =>
        prev.map((srv) => {
          if (srv.id === editingServerId) {
            return {
              ...srv,
              name: srvName,
              server: srvHost,
              instance: srvInstance,
              database: srvDatabase,
              table: srvTable,
              username: srvUser,
              password: srvPass,
              authMode: srvAuthMode,
              uniqueField: srvUniqueField,
            };
          }
          return srv;
        }),
      );

      const updatedSrv = servers.find((s) => s.id === editingServerId);
      if (updatedSrv?.isActive) {
        onUpdateDatabaseConfig(true, srvDatabase);
      }

      setEditingServerId(null);
    } else {
      const newServer: SQLServer = {
        id: `srv-${Math.random().toString(36).substring(2, 9)}`,
        name: srvName,
        server: srvHost,
        instance: srvInstance,
        database: srvDatabase,
        table: srvTable,
        username: srvUser,
        password: srvPass,
        authMode: srvAuthMode,
        uniqueField: srvUniqueField,
        isActive: servers.length === 0, // Make active if it's the first
      };

      setServers((prev) => [...prev, newServer]);
      if (newServer.isActive) {
        onUpdateDatabaseConfig(true, newServer.database);
      }
    }

    setShowConnectionModal(false);

    // Reset fields
    setSrvName("");
    setSrvHost("");
    setSrvInstance("");
    setSrvDatabase("");
    setSrvTable("");
    setSrvUser("");
    setSrvPass("");
    setSrvAuthMode("sql");
    setSrvUniqueField("AccessionNo");
  };

  // Handle testing connection from catalog list
  const handleTestConnection = (server: SQLServer) => {
    setTestingId(server.id);
    setTestSuccess(null);
    setTestLogs([
      `[PING] Attempting to reach MS SQL host "${server.server}"...`,
      `[UDP/PORT] Probing SQL Server Browser service port 1434...`,
    ]);

    setTimeout(() => {
      setTestLogs((prev) => [
        ...prev,
        `[BRIDGE] SQL Browser response received. Instance "${server.instance}" bound to TCP port 1433.`,
        `[HANDSHAKE] Sending Tabular Data Stream (TDS) packet version 7.4...`,
        server.authMode === "windows"
          ? `[AUTH] Securing tunnel with Windows Integrated Authentication...`
          : `[AUTH] Logging in with SQL database user credential "${server.username}"...`,
      ]);

      setTimeout(() => {
        setTestLogs((prev) => [
          ...prev,
          `[CATALOG] Database context switched to [${server.database}].`,
          `[INDEX] Scanning column mapping definitions on ${server.table}...`,
          `[SUCCESS] Connection verified! Field "${server.uniqueField}" verified as index primary key.`,
        ]);
        setTestingId(null);
        setTestSuccess(true);

        if (server.isActive) {
          onUpdateDatabaseConfig(true, server.database);
        }
      }, 1200);
    }, 1200);
  };

  // Toggle active server
  const handleSetActiveServer = (id: string) => {
    let activeDbName = "";
    setServers((prev) => {
      const updated = prev.map((srv) => ({
        ...srv,
        isActive: srv.id === id,
      }));
      const active = updated.find((srv) => srv.id === id);
      if (active) {
        activeDbName = active.database;
      }
      return updated;
    });

    // We should call it using setTimeout to avoid running in the middle of current render cycle or after the update cycle finishes
    setTimeout(() => {
      if (activeDbName) {
        onUpdateDatabaseConfig(true, activeDbName);
      }
    }, 0);

    setQueryingServerId(null);
    setFoundRecord(null);
    setSearchQuery("");
    setSearchError("");
  };

  // Remove server from registry
  const handleRemoveServer = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const wasActive = servers.find((srv) => srv.id === id)?.isActive;
    let updated = servers.filter((srv) => srv.id !== id);

    if (wasActive && updated.length > 0) {
      updated = updated.map((srv, index) =>
        index === 0 ? { ...srv, isActive: true } : srv,
      );
      onUpdateDatabaseConfig(true, updated[0].database);
    } else if (wasActive && updated.length === 0) {
      onUpdateDatabaseConfig(false, "Offline Mode");
    }

    setServers(updated);
  };

  // Search/Lookup record using the real database API with mapped field
  const handleQueryRecord = async (server: SQLServer) => {
    if (!searchQuery.trim()) {
      setSearchError("Please enter a search value.");
      setFoundRecord(null);
      return;
    }
    setSearchError("");
    setQuerySearchLoading(true);

    try {
      // Determine which physical column to search
      const mappedField = queryMappedFields.find(f => f.key === querySearchFieldKey);
      const searchColumn = mappedField ? mappedField.physical : (server.uniqueField || "AccessionNo");

      // Build a connection profile from the server object for the API
      const config: any = {
        dbType: (server as any).dbType || "mssql",
        server: server.server,
        port: (server as any).port,
        instance: server.instance,
        database: server.database,
        username: server.username,
        password: server.password,
        authMode: server.authMode,
        trustCert: (server as any).trustCert ?? true,
        encrypt: (server as any).encrypt ?? false,
        sqlitePath: (server as any).sqlitePath,
        table: server.table,
        uniqueField: server.uniqueField,
        fieldMappings: (server as any).fieldMappings || {},
      };

      const data = await electronAPI.dbQueryRecord(
        config,
        server.table,
        searchColumn,
        searchQuery.trim()
      );
      if (data.success && data.record) {
        setFoundRecord(data.record);
        setSearchError("");
      } else {
        setFoundRecord(null);
        setSearchError(
          data.message || `No record found in table "${server.table}" where "${mappedField?.label || searchColumn}" (${searchColumn}) matches "${searchQuery.trim()}".`
        );
      }
    } catch (err: any) {
      setFoundRecord(null);
      setSearchError(`Failed to query database: ${err.message}`);
    } finally {
      setQuerySearchLoading(false);
    }
  };

  // REAL Gmail Polling Trigger — calls Python backend via IPC
  const handlePollGmailInbox = async () => {
    setIsGmailChecking(true);
    setGmailLogs([`[IMAP] Initiating live connection to Gmail inbox...`]);

    // Build active db config
    const activeServer = servers.find(s => s.isActive);
    if (!activeServer) {
      setGmailLogs([`[ERROR] No active database profile found. Please configure a database connection first.`]);
      setIsGmailChecking(false);
      return;
    }
    if (Object.keys(gmailTemplateMappings).length === 0) {
      setGmailLogs([`[ERROR] No template keys are configured. Please map at least one template (a, b, c...) before polling.`]);
      setIsGmailChecking(false);
      return;
    }

    const dbConfig = {
      dbType: (activeServer as any).dbType || "mssql",
      server: activeServer.server,
      port: (activeServer as any).port,
      instance: activeServer.instance,
      database: activeServer.database,
      username: activeServer.username,
      password: activeServer.password,
      authMode: activeServer.authMode,
      trustCert: (activeServer as any).trustCert ?? true,
      encrypt: (activeServer as any).encrypt ?? false,
      sqlitePath: (activeServer as any).sqlitePath,
      table: activeServer.table,
      uniqueField: activeServer.uniqueField,
    };

    try {
      const result = await electronAPI.pollGmail({
        gmailAddress,
        gmailAppPassword,
        triggerSubjects,
        verifiedOnly: gmailVerifiedOnly,
        verifiedSenders: gmailVerifiedSenders,
        templates: allAvailableTemplates,
        templateMappings: gmailTemplateMappings,
        printerName: activePrinter?.name,
        dbConfig,
        lastPollTime,  // send persisted timestamp so backend filters by time
      });

      const logs = result.logs || [];
      setGmailLogs(logs);

      // Persist the new last-poll time returned by backend
      if (result.lastPollTime) {
        setLastPollTime(result.lastPollTime);
      }

      // Check for [PRINT_DONE] marker in logs
      const printDoneLine = logs.find((log: string) => log.startsWith('[PRINT_DONE]'));
      if (printDoneLine && result.success) {
        // Parse format: [PRINT_DONE] accessions:pages
        const match = printDoneLine.match(/\[PRINT_DONE\]\s+(\d+):(\d+)/);
        if (match) {
          const accessions = parseInt(match[1]);
          const pages = parseInt(match[2]);
          setPrintDoneInfo({
            accessions,
            pages,
            printer: activePrinter?.name || 'printer'
          });
        }
      }

      if (result.success) setGmailStatus("listening");
    } catch (err: any) {
      setGmailLogs([`[FATAL] Unexpected error: ${err.message}`]);
    } finally {
      setIsGmailChecking(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-metro-app animate-fade-in text-metro-primary select-none font-sans h-full w-full">

      {/* ===== PRINTING DONE POPUP OVERLAY ===== */}
      {printDoneInfo && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-metro-panel border border-emerald-500/40 rounded-2xl shadow-2xl shadow-emerald-500/10 p-8 max-w-sm w-full mx-4 flex flex-col items-center gap-5 animate-fade-in">
            {/* Icon */}
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border-2 border-emerald-500/40 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            </div>
            {/* Title */}
            <div className="text-center space-y-1">
              <h3 className="text-lg font-black text-metro-primary tracking-tight">Printing Done!</h3>
              <p className="text-xs text-metro-secondary">Gmail automation print job completed successfully.</p>
            </div>
            {/* Stats */}
            <div className="w-full grid grid-cols-2 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-emerald-400">{printDoneInfo.accessions}</p>
                <p className="text-[10px] text-metro-secondary font-semibold uppercase tracking-wider mt-0.5">Accession{printDoneInfo.accessions !== 1 ? 's' : ''}</p>
              </div>
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 text-center">
                <p className="text-2xl font-black text-indigo-400">{printDoneInfo.pages}</p>
                <p className="text-[10px] text-metro-secondary font-semibold uppercase tracking-wider mt-0.5">Label Page{printDoneInfo.pages !== 1 ? 's' : ''}</p>
              </div>
            </div>
            {/* Printer name */}
            <div className="flex items-center gap-2 px-3 py-2 bg-metro-input border border-metro-border rounded-xl w-full">
              <PrinterIcon className="w-3.5 h-3.5 text-metro-secondary shrink-0" />
              <span className="text-[10px] font-mono text-metro-secondary truncate">{printDoneInfo.printer}</span>
            </div>
            {/* Dismiss */}
            <button
              type="button"
              onClick={() => setPrintDoneInfo(null)}
              className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" /> Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Left Sidebar Panel (Identical style to the home screen sidebar) */}
      <div className="w-60 shrink-0 bg-metro-panel border-r border-metro-border flex flex-col justify-between py-6 px-4 h-full shadow-lg">
        <div className="space-y-6">
          <div className="px-1 flex flex-col gap-3.5">
            <button
              onClick={onBack}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-lg border border-metro-border bg-metro-panel/50 hover:bg-indigo-600/10 hover:border-indigo-500/30 text-metro-secondary hover:text-indigo-400 text-xs font-bold transition-all cursor-pointer w-fit"
            >
              <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
              <span>Back to Home</span>
            </button>

            <h2 className="text-sm font-bold tracking-tight flex items-center gap-2 text-metro-primary uppercase font-mono">
              <Settings className="w-4 h-4 text-indigo-400" />
              <span>Settings</span>
            </h2>
            <p className="text-[11px] text-metro-secondary leading-relaxed">
              Configure connected databases, automated print pipelines, and
              layout preferences.
            </p>
          </div>

          {/* Navigation Options stacked vertically */}
          <div className="flex flex-col gap-1 relative">
            {[
              { id: "database", label: "Database Connections", icon: Database },
              { id: "gmail", label: "Print Automations", icon: Mail },
              { id: "preferences", label: "Printers & Hardware", icon: PrinterIcon },
              { id: "about", label: "About", icon: Info },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`relative w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-3 border text-left ${isActive
                    ? "text-indigo-400 font-bold"
                    : "bg-transparent border-transparent text-metro-secondary hover:text-metro-primary hover:bg-metro-panel/50"
                    }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTabBg"
                      className="absolute inset-0 bg-indigo-600/10 border border-indigo-500/40 rounded-xl shadow-sm shadow-indigo-500/5"
                      initial={false}
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <Icon className="w-4 h-4 shrink-0 relative z-10" />
                  <div className="flex-1 min-w-0 relative z-10">
                    <span className="block truncate">{tab.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {/* Right Content Panel - Matches homescreen main space padding and scrolling */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6 min-w-0 h-full">
        {/* --- TAB 1: DATABASE SETTINGS --- */}
        {activeTab === "database" && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-amber-500" />
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-metro-primary">
                    Registered SQL catalog databases
                  </h3>
                </div>
                <button
                  onClick={handleOpenWizard}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/15"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add SQL Server</span>
                </button>
              </div>

              {/* ── App Config Import / Export ─────────────────────────────── */}
              <div className={`rounded-2xl border overflow-hidden shadow-sm ${theme === "light"
                ? "border-slate-200 bg-white"
                : "border-metro-border bg-metro-panel/30"
                }`}>
                {/* Header */}
                <div className={`flex items-center gap-3 px-5 py-4 border-b ${theme === "light"
                  ? "border-slate-200 bg-slate-50"
                  : "border-metro-border bg-metro-panel/50"
                  }`}>
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/20">
                    <PackageOpen className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[12px] font-extrabold leading-none ${theme === "light" ? "text-slate-900" : "text-metro-primary"
                      }`}>
                      App Configuration Backup
                    </p>
                    <p className={`text-[10px] mt-1 leading-snug ${theme === "light" ? "text-slate-500" : "text-metro-secondary"
                      }`}>
                      Export all servers, templates, printers &amp; settings into a{" "}
                      <code className={`font-mono px-1 py-0.5 rounded ${theme === "light"
                        ? "bg-slate-100 text-indigo-600"
                        : "bg-slate-800 text-indigo-400"
                        }`}>
                        .bcsc
                      </code>{" "}
                      file — then import it on any other PC instantly.
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 p-4">
                  {/* Export */}
                  <button
                    type="button"
                    onClick={handleExportConfig}
                    className={`flex-1 flex items-center gap-3 px-4 py-3.5 rounded-xl border font-bold text-[11px] transition-all cursor-pointer group ${theme === "light"
                      ? "border-indigo-300 bg-indigo-50 hover:bg-indigo-100"
                      : "border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20"
                      }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 group-hover:bg-indigo-700 flex items-center justify-center transition-all shrink-0 shadow-sm shadow-indigo-600/30">
                      <Upload className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="text-left">
                      <span className={`block leading-tight ${theme === "light" ? "text-indigo-900" : "text-indigo-200"}`}>
                        Export Configuration
                      </span>
                      <span className={`block text-[9.5px] font-normal leading-tight mt-0.5 ${theme === "light" ? "text-indigo-700" : "text-indigo-400"
                        }`}>
                        Save all data to a <code className="font-mono">.bcsc</code> file
                      </span>
                    </div>
                  </button>

                  {/* Import */}
                  <button
                    type="button"
                    onClick={handleImportConfig}
                    className={`flex-1 flex items-center gap-3 px-4 py-3.5 rounded-xl border font-bold text-[11px] transition-all cursor-pointer group ${theme === "light"
                      ? "border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                      : "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                      }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 group-hover:bg-emerald-700 flex items-center justify-center transition-all shrink-0 shadow-sm shadow-emerald-600/30">
                      <Download className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div className="text-left">
                      <span className={`block leading-tight ${theme === "light" ? "text-emerald-900" : "text-emerald-200"}`}>
                        Import Configuration
                      </span>
                      <span className={`block text-[9.5px] font-normal leading-tight mt-0.5 ${theme === "light" ? "text-emerald-800" : "text-emerald-400"
                        }`}>
                        Restore all data from a <code className="font-mono">.bcsc</code> file
                      </span>
                    </div>
                  </button>
                </div>

                {/* What's included tags */}
                <div className="px-4 pb-4 flex flex-wrap gap-1.5">
                  {["DB Server Profiles", "Label Templates", "Printer Settings", "Gmail Automation", "Custom Presets", "Recent Files"].map(tag => (
                    <span
                      key={tag}
                      className={`px-2 py-0.5 rounded-full text-[8.5px] font-bold border font-mono uppercase tracking-wide ${theme === "light"
                        ? "bg-slate-100 border-slate-200 text-slate-600"
                        : "bg-metro-panel border-metro-border text-metro-secondary"
                        }`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Status feedback */}
                {configStatus && (
                  <div className={`mx-4 mb-4 px-3.5 py-2.5 rounded-xl text-[10.5px] font-bold border transition-all ${configStatus.startsWith("✓")
                    ? theme === "light"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : theme === "light"
                      ? "bg-red-50 border-red-200 text-red-700"
                      : "bg-red-500/10 border-red-500/30 text-red-400"
                    }`}>
                    {configStatus}
                  </div>
                )}
              </div>

              {/* Servers grid list */}
              {servers.length === 0 ? (
                <div
                  onClick={handleOpenWizard}
                  className="group relative p-8 rounded-2xl border-2 border-dashed border-metro-border hover:border-indigo-500/50 bg-metro-panel/15 hover:bg-indigo-600/[0.01] transition-all duration-300 cursor-pointer flex flex-col items-center justify-center text-center gap-4 min-h-[260px] animate-fade-in"
                >
                  <div className="p-4 bg-indigo-600/10 rounded-full text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300 transform group-hover:scale-110 shadow-lg shadow-indigo-600/5">
                    <Plus className="w-8 h-8" />
                  </div>
                  <div className="space-y-1.5 max-w-sm">
                    <h4 className="text-xs font-extrabold text-metro-primary tracking-wide uppercase font-mono group-hover:text-indigo-400 transition-colors">
                      No Database Configured
                    </h4>
                    <p className="text-[11px] text-metro-secondary leading-relaxed">
                      Link your local or network SQL database to fetch accession
                      metadata. Let's add your first SQL server connection.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mt-2 px-4.5 py-2 rounded-xl bg-indigo-600 group-hover:bg-indigo-700 text-white text-[10px] font-extrabold shadow-md shadow-indigo-600/15 transition-all cursor-pointer"
                  >
                    Let's Add Server
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {servers.map((server) => (
                    <div
                      key={server.id}
                      onClick={() => handleSetActiveServer(server.id)}
                      className={`group relative p-5 rounded-2xl flex flex-col justify-between gap-4 border transition-all duration-300 cursor-pointer ${server.isActive
                        ? "bg-indigo-600/[0.04] border-indigo-500 shadow-lg shadow-indigo-500/5"
                        : "bg-metro-panel/40 hover:bg-metro-panel/80 border-metro-border/80 hover:border-slate-500"
                        }`}
                    >
                      {server.isActive && (
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-emerald-500/10 text-emerald-400 text-[9px] font-extrabold px-2 py-0.5 rounded-full border border-emerald-500/20">
                          <Check className="w-3 h-3 animate-pulse" />
                          <span>ACTIVE</span>
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <div
                            className={`p-2 rounded-xl ${server.isActive ? "bg-indigo-600/15 text-indigo-400" : "bg-metro-input text-metro-secondary"}`}
                          >
                            <Server className="w-4.5 h-4.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs font-extrabold text-metro-primary truncate leading-tight">
                              {server.name}
                            </h4>
                            <p className="text-[10px] text-metro-secondary font-mono mt-1 truncate">
                              {server.server}\\{server.instance}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px] bg-metro-input/50 p-3 rounded-xl border border-metro-border/45 font-mono">
                          <div>
                            <span className="text-metro-secondary block text-[9px] uppercase tracking-wider">
                              Database
                            </span>
                            <span className="text-metro-primary font-bold truncate block">
                              {server.database}
                            </span>
                          </div>
                          <div>
                            <span className="text-metro-secondary block text-[9px] uppercase tracking-wider">
                              Table View
                            </span>
                            <span className="text-metro-primary font-bold truncate block">
                              {server.table}
                            </span>
                          </div>
                          <div className="col-span-2 pt-1 border-t border-white/5 mt-1 flex justify-between items-center text-[9px]">
                            <span className="text-metro-secondary uppercase tracking-wider">
                              Trigger Key Field:
                            </span>
                            <span className="text-indigo-400 font-extrabold">
                              {server.uniqueField}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-metro-border/45">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTestConnection(server);
                            }}
                            className="text-[9px] font-extrabold bg-metro-input hover:bg-metro-panel text-metro-secondary hover:text-metro-primary px-2.5 py-1.5 rounded-lg border border-metro-border/60 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            {testingId === server.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Network className="w-3 h-3" />
                            )}
                            <span>Test connection</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditServer(server);
                            }}
                            className="p-1.5 text-metro-secondary hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-all cursor-pointer border border-transparent hover:border-indigo-500/15"
                            title="Edit SQL Server Config"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleRemoveServer(server.id, e)}
                            className="p-1.5 text-metro-secondary hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer border border-transparent hover:border-red-500/15"
                            title="Remove SQL Server"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ping diagnostic block */}
              {testLogs.length > 0 && (
                <div className="bg-metro-input border border-metro-border/80 rounded-2xl p-4.5 space-y-2 animate-fade-in shadow-inner">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <div className="flex items-center gap-2 text-slate-300">
                      <Terminal className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-[9.5px] uppercase tracking-wider font-mono">
                        TDS Protocol Handshake Logs
                      </span>
                    </div>
                    <button
                      onClick={() => setTestLogs([])}
                      className="text-[9px] font-bold text-metro-secondary hover:text-metro-primary cursor-pointer"
                    >
                      Clear logs
                    </button>
                  </div>
                  <div className="font-mono text-[10.5px] text-slate-400 space-y-1.5 max-h-32 overflow-y-auto leading-relaxed">
                    {testLogs.map((log, index) => (
                      <div
                        key={index}
                        className={
                          log.includes("[SUCCESS]")
                            ? "text-emerald-400 font-bold"
                            : log.includes("[AUTH]")
                              ? "text-amber-300 font-semibold"
                              : "text-slate-400"
                        }
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Direct query tool — uses mapped fields from connection profile */}
              {queryingServerId && (
                <div className="bg-metro-panel border border-metro-border rounded-2xl p-5 space-y-4 animate-fade-in shadow-md">
                  <div className="flex items-center justify-between border-b border-metro-border pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 bg-amber-500/10 rounded-xl text-amber-500">
                        <Search className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-xs text-metro-primary">
                          SQL Query Tool &mdash;{" "}
                          {servers.find((s) => s.id === queryingServerId)?.name}
                        </h4>
                        <p className="text-[10px] text-metro-secondary">
                          Search by any mapped field to fetch live records from the connected database.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setQueryingServerId(null); setFoundRecord(null); setSearchQuery(""); setSearchError(""); }}
                      className="text-metro-secondary hover:text-metro-primary p-1.5 rounded-lg hover:bg-metro-input transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Field selector + search input */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">
                      Query Record By Mapped Field
                    </label>
                    <div className="flex gap-2">
                      <div className="w-[40%] shrink-0">
                        <select
                          value={querySearchFieldKey}
                          onChange={(e) => {
                            setQuerySearchFieldKey(e.target.value);
                            setSearchQuery("");
                            setSearchError("");
                            setFoundRecord(null);
                          }}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2.5 text-[11px] font-semibold text-metro-primary focus:border-indigo-500 focus:outline-none transition-colors cursor-pointer"
                        >
                          {queryMappedFields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label} → {f.physical}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const srv = servers.find(
                                (s) => s.id === queryingServerId,
                              );
                              if (srv) handleQueryRecord(srv);
                            }
                          }}
                          placeholder={`Enter ${STANDARD_FIELD_LABELS[querySearchFieldKey] || querySearchFieldKey || "value"}...`}
                          className="w-full bg-metro-input border border-metro-border rounded-xl pl-9.5 pr-4 py-2.5 text-xs font-semibold text-metro-primary placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
                        />
                      </div>
                      <button
                        onClick={() => {
                          const srv = servers.find(
                            (s) => s.id === queryingServerId,
                          );
                          if (srv) handleQueryRecord(srv);
                        }}
                        disabled={querySearchLoading}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold text-xs px-5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-1.5 shadow-md shadow-indigo-600/15"
                      >
                        {querySearchLoading ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            <span>Searching...</span>
                          </>
                        ) : (
                          <span>Search Record</span>
                        )}
                      </button>
                    </div>

                    {/* Mapped fields quick-select chips */}
                    {queryMappedFields.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {queryMappedFields.map((f) => (
                          <button
                            key={f.key}
                            type="button"
                            onClick={() => {
                              setQuerySearchFieldKey(f.key);
                              setSearchQuery("");
                              setSearchError("");
                              setFoundRecord(null);
                            }}
                            className={`text-[9px] font-bold px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${querySearchFieldKey === f.key
                              ? "bg-indigo-600/15 border-indigo-500/40 text-indigo-400"
                              : "bg-metro-input/50 border-metro-border/50 text-metro-secondary hover:text-metro-primary hover:border-slate-500"
                              }`}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {searchError && (
                    <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{searchError}</span>
                    </div>
                  )}

                  {foundRecord && (
                    <div className="p-5 bg-metro-panel border border-indigo-500/20 rounded-2xl space-y-4 animate-fade-in shadow-xl">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest font-mono">
                          RECORD DETECTED IN SQL
                        </span>
                        <span className="text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold px-2 py-0.5 rounded-full">
                          INDEX MATCHED
                        </span>
                      </div>
                      {/* Dynamic record display based on mapped fields */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px] font-mono">
                        {(() => {
                          // Build display entries: prefer mapped fields, then show all record keys
                          const displayEntries: { label: string; value: string; isHighlight?: boolean }[] = [];
                          const shownKeys = new Set<string>();

                          // First show mapped fields in order
                          queryMappedFields.forEach((mf) => {
                            // Try physical column name in the record
                            const val = foundRecord[mf.physical] ?? foundRecord[mf.key] ?? "";
                            displayEntries.push({
                              label: mf.label,
                              value: String(val),
                              isHighlight: mf.key === querySearchFieldKey
                            });
                            shownKeys.add(mf.physical);
                            shownKeys.add(mf.key);
                          });

                          // Then show remaining record fields
                          Object.entries(foundRecord).forEach(([k, v]) => {
                            if (!shownKeys.has(k)) {
                              displayEntries.push({
                                label: STANDARD_FIELD_LABELS[k] || k,
                                value: String(v ?? "")
                              });
                            }
                          });

                          return displayEntries.map((entry, idx) => (
                            <div key={idx} className={`p-2.5 rounded-xl border ${entry.isHighlight
                              ? "bg-indigo-600/10 border-indigo-500/25"
                              : "bg-metro-input/30 border-metro-border/30"
                              }`}>
                              <span className="text-metro-secondary block text-[9px] uppercase tracking-wider mb-1">
                                {entry.label}
                              </span>
                              <span className={`font-bold block truncate ${entry.isHighlight ? "text-indigo-400" : "text-metro-primary"
                                }`}>
                                {entry.value || "—"}
                              </span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- TAB 2: GMAIL PRINT AUTOMATIONS --- */}
        {activeTab === "gmail" && (
          <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-8">

            {/* Top Pipeline Header Banner */}
            <div className="relative overflow-hidden bg-gradient-to-r from-rose-500/10 via-indigo-500/10 to-purple-500/10 border border-slate-200 dark:border-metro-border rounded-3xl p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white flex items-center justify-center shadow-lg shadow-rose-500/20 shrink-0">
                    <Mail className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-base text-slate-800 dark:text-metro-primary tracking-tight">
                        Gmail Print Automation Pipeline
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25">
                        Daemon Service
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-metro-secondary mt-1 max-w-xl leading-relaxed">
                      Automatically monitor your inbox, parse accession numbers and copy multipliers from incoming emails, and dispatch instant print jobs to hardware.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start md:self-center">
                  {gmailAddress && gmailAppPassword ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Pipeline Ready</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs font-bold">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Setup Required</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 4 Stat Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-200/60 dark:border-metro-border/60">
                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Mail Account</span>
                    <Mail className="w-3.5 h-3.5 text-rose-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate font-mono">
                    {gmailAddress || "Not configured"}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate">
                    {gmailAddress && gmailAppPassword ? "Credentials saved" : "Needs email & password"}
                  </p>
                </div>

                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Auto-Polling</span>
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate">
                    {pollingEnabled ? pollingInterval : "Manual Only"}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate">
                    {pollingEnabled
                      ? (countdown > 0 ? `Next scan in ${countdown}s` : "Scanning...")
                      : "Background poller off"}
                  </p>
                </div>

                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Template Keys</span>
                    <Layers className="w-3.5 h-3.5 text-sky-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate">
                    {Object.keys(gmailTemplateMappings).length} Key{Object.keys(gmailTemplateMappings).length !== 1 ? "s" : ""} Active
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate font-mono">
                    {Object.keys(gmailTemplateMappings).map(k => k.toUpperCase()).sort().join(", ") || "None mapped"}
                  </p>
                </div>

                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Spool Target</span>
                    <PrinterIcon className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate">
                    {activePrinter?.name || "No Printer Selected"}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate">
                    {activePrinter ? "Ready to print" : "Select in Preferences"}
                  </p>
                </div>
              </div>
            </div>

            {/* CARD 1: Gmail Credentials */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                      Gmail Account Credentials
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                      Dedicated mailbox credentials used to read incoming print commands.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-metro-secondary font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Stored locally &amp; never exported</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Email input */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-metro-secondary uppercase tracking-wider flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-rose-500" />
                    Gmail Address
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      value={gmailAddress}
                      onChange={e => setGmailAddress(e.target.value)}
                      placeholder="your-catalog@gmail.com"
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 font-mono transition-all"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary">
                    The email account that receives print requests from your staff or LMS.
                  </p>
                </div>

                {/* App password input */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-metro-secondary uppercase tracking-wider flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                    Google 16-Digit App Password
                  </label>
                  <div className="relative">
                    <input
                      type={showGmailPass ? "text" : "password"}
                      value={gmailAppPassword}
                      onChange={e => setGmailAppPassword(e.target.value)}
                      placeholder="xxxx xxxx xxxx xxxx"
                      className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 font-mono tracking-wider transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGmailPass(p => !p)}
                      title={showGmailPass ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-metro-primary p-1 transition-colors cursor-pointer"
                    >
                      {showGmailPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary">
                    Use an App Password generated from your Google Account security panel.
                  </p>
                </div>
              </div>

              {/* Helpful callout banner for Google App Passwords */}
              <div className="p-3.5 bg-slate-50 dark:bg-metro-input/40 border border-slate-200 dark:border-metro-border/60 rounded-xl flex items-start gap-3 text-slate-600 dark:text-metro-secondary text-xs">
                <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-slate-800 dark:text-metro-primary text-[11px]">
                    How to get a Google App Password:
                  </p>
                  <p className="text-[10.5px] leading-relaxed text-slate-500 dark:text-metro-secondary">
                    Go to <strong className="text-slate-700 dark:text-slate-300">Google Account → Security → 2-Step Verification → App passwords</strong>. Create a new entry named <em>Barcode Studio</em> and paste the generated 16-letter code above. Normal Google passwords will be rejected by IMAP.
                  </p>
                </div>
              </div>
            </div>

            {/* CARD 2: Background Auto-Polling Engine */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                      Background Auto-Polling Engine
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                      Periodically scans the mailbox for unread emails with trigger subjects.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right select-none">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${pollingEnabled ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                      <span className={`text-xs font-extrabold uppercase tracking-wider ${pollingEnabled ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400"}`}>
                        {pollingEnabled ? "Poller Active" : "Poller Paused"}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-metro-secondary block">
                      {pollingEnabled ? "Scanning in background" : "Click switch to activate"}
                    </span>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={pollingEnabled}
                    onClick={() => setPollingEnabled(p => !p)}
                    title={pollingEnabled ? "Click to pause background auto-polling" : "Click to enable background auto-polling"}
                    className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                      pollingEnabled
                        ? "bg-gradient-to-r from-indigo-600 to-violet-600 border-indigo-500 shadow-md shadow-indigo-500/30"
                        : "bg-slate-200 dark:bg-slate-700/80 border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    <span className="sr-only">Toggle background auto-polling</span>
                    <span
                      className={`pointer-events-none inline-flex h-7 w-7 transform items-center justify-center rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out ${
                        pollingEnabled ? "translate-x-8" : "translate-x-0"
                      }`}
                    >
                      {pollingEnabled ? (
                        <Check className="h-3.5 w-3.5 text-indigo-600 stroke-[3]" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-slate-400 stroke-[2.5]" />
                      )}
                    </span>
                  </button>
                </div>
              </div>

              {pollingEnabled ? (
                <div className="space-y-4 animate-fade-in">
                  {/* Frequency presets and dropdown */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-metro-secondary uppercase tracking-wider">
                      Check Frequency &amp; Schedule
                    </label>

                    {/* Quick preset chips */}
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { label: "10s", mode: "interval", val: 10, unit: "seconds" },
                        { label: "30s", mode: "interval", val: 30, unit: "seconds" },
                        { label: "1 min", mode: "interval", val: 1, unit: "minutes" },
                        { label: "2 min", mode: "interval", val: 2, unit: "minutes" },
                        { label: "5 min", mode: "interval", val: 5, unit: "minutes" },
                        { label: "Daily", mode: "daily", val: 30, unit: "seconds" },
                      ].map(chip => {
                        const isSelected = chip.mode === "daily"
                          ? pollingMode === "daily"
                          : pollingMode === "interval" && intervalValue === chip.val && intervalUnit === chip.unit;
                        return (
                          <button
                            key={chip.label}
                            type="button"
                            onClick={() => {
                              if (chip.mode === "daily") {
                                setPollingMode("daily");
                              } else {
                                setPollingMode("interval");
                                setIntervalValue(chip.val);
                                setIntervalUnit(chip.unit as any);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${isSelected
                              ? "bg-indigo-500/15 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold shadow-sm"
                              : "bg-slate-50 dark:bg-metro-input/50 border-slate-200 dark:border-metro-border text-slate-600 dark:text-metro-secondary hover:border-slate-400"
                              }`}
                          >
                            {chip.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Dropdown / Time selector */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                      <select
                        value={pollingMode === "daily" ? "daily" : `${intervalValue}-${intervalUnit}`}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === "daily") {
                            setPollingMode("daily");
                          } else {
                            const [numStr, unitStr] = val.split("-");
                            setPollingMode("interval");
                            setIntervalValue(Number(numStr));
                            setIntervalUnit(unitStr as any);
                          }
                        }}
                        className="px-3 py-2 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
                      >
                        <option value="10-seconds">Every 10 seconds</option>
                        <option value="30-seconds">Every 30 seconds</option>
                        <option value="1-minutes">Every 1 minute</option>
                        <option value="2-minutes">Every 2 minutes</option>
                        <option value="5-minutes">Every 5 minutes</option>
                        <option value="daily">Daily at specific time</option>
                      </select>

                      {pollingMode === "daily" && (
                        <div className="flex items-center gap-2 animate-fade-in">
                          <span className="text-xs text-slate-500 dark:text-metro-secondary font-medium">Time:</span>
                          <input
                            type="time"
                            value={dailyTime}
                            onChange={e => setDailyTime(e.target.value)}
                            className="px-3 py-1.5 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Engine countdown & status pill */}
                  <div className="p-3 bg-slate-50 dark:bg-metro-input/30 border border-slate-200 dark:border-metro-border/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                      <span className="font-mono font-bold text-slate-800 dark:text-metro-primary">
                        {pollingIntervalSeconds > 0
                          ? `Next automatic poll in ${countdown}s`
                          : "Scheduled for daily execution"}
                      </span>
                      <span className="text-slate-400 dark:text-metro-secondary">({pollingInterval})</span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <Activity className="w-3.5 h-3.5 text-indigo-500" />
                      <span className={isPrintingRef.current ? "text-amber-500 font-bold" : "text-slate-500 dark:text-metro-secondary"}>
                        {isPrintingRef.current
                          ? `Printing in progress (${printQueueRef.current.length} queued)`
                          : printQueueRef.current.length > 0
                            ? `${printQueueRef.current.length} print job(s) in queue`
                            : "Queue idle — ready for incoming jobs"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-metro-input/20 border border-dashed border-slate-200 dark:border-metro-border/60 rounded-xl text-center">
                  <p className="text-xs text-slate-500 dark:text-metro-secondary">
                    Background polling is disabled. You can still trigger manual mailbox scans anytime via the console below.
                  </p>
                </div>
              )}
            </div>

            {/* SPLIT 2-COLUMN GRID: Trigger Subjects & Template Mappings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* CARD 3: Email Trigger Subjects */}
              <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-metro-border pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                        <Bell className="w-4 h-4" />
                      </div>
                      <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                        Trigger Subjects
                      </h4>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      {triggerSubjects.length} Registered
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-metro-secondary leading-relaxed">
                    Incoming emails must match one of these subject lines to activate the parsing and spooling workflow.
                  </p>

                  {/* Subject chip tags cloud */}
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto p-1">
                    {triggerSubjects.map((subj, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border border-amber-500/25 rounded-xl group hover:border-amber-500/40 transition-colors"
                      >
                        <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                          {subj}
                        </span>
                        <button
                          type="button"
                          onClick={() => setTriggerSubjects(prev => prev.filter((_, i) => i !== idx))}
                          className="text-amber-500/60 hover:text-red-500 dark:hover:text-red-400 p-0.5 rounded transition-colors cursor-pointer"
                          title="Remove subject"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Add subject input */}
                <div className="pt-2 border-t border-slate-100 dark:border-metro-border">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSubjectInput}
                      onChange={e => setNewSubjectInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && newSubjectInput.trim()) {
                          handleAddSubjectVariations(newSubjectInput);
                          setNewSubjectInput("");
                        }
                      }}
                      placeholder="e.g. PRINT_LABELS"
                      className="flex-1 px-3 py-2 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs font-mono text-slate-800 dark:text-metro-primary placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newSubjectInput.trim()) {
                          handleAddSubjectVariations(newSubjectInput);
                          setNewSubjectInput("");
                        }
                      }}
                      className="px-3.5 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-600 dark:text-amber-400 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary mt-1.5">
                    Automatically registers uppercase, lowercase, and space variations.
                  </p>
                </div>
              </div>

              {/* CARD 4: Template Key Mappings */}
              <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-4 shadow-sm flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-metro-border pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                        <Layers className="w-4 h-4" />
                      </div>
                      <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                        Template Key Mappings
                      </h4>
                    </div>

                    {nextAvailableLetter && (
                      <button
                        type="button"
                        onClick={() =>
                          setGmailTemplateMappings(prev => ({
                            ...prev,
                            [nextAvailableLetter]: allAvailableTemplates[0]?.id || "",
                          }))
                        }
                        className="px-3 py-1 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Map Key '{nextAvailableLetter.toUpperCase()}'</span>
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-metro-secondary leading-relaxed">
                    Map command letters (A, B, C...) to layout templates. In email lines, use syntax like <code className="px-1 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[10px]">10001/a2</code>.
                  </p>

                  {/* Mapping rows */}
                  {Object.keys(gmailTemplateMappings).length === 0 ? (
                    <div className="py-8 text-center border border-dashed border-slate-200 dark:border-metro-border/60 rounded-xl space-y-2">
                      <Layers className="w-6 h-6 text-slate-400 mx-auto opacity-50" />
                      <p className="text-xs text-slate-500 dark:text-metro-secondary">
                        No template keys mapped yet.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setGmailTemplateMappings({ a: allAvailableTemplates[0]?.id || "" })
                        }
                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                      >
                        Click to map Key 'A' to first template
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-48 overflow-y-auto p-1">
                      {Object.entries(gmailTemplateMappings)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([letter, templateId]) => (
                          <div
                            key={letter}
                            className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-metro-input/40 border border-slate-200 dark:border-metro-border/50 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                              <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-mono">
                                {letter.toUpperCase()}
                              </span>
                            </div>
                            <select
                              value={templateId}
                              onChange={e =>
                                setGmailTemplateMappings(prev => ({ ...prev, [letter]: e.target.value }))
                              }
                              className="flex-1 px-3 py-1.5 bg-white dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-lg text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500 cursor-pointer font-medium"
                            >
                              <option value="">— Select Layout Template —</option>
                              {allAvailableTemplates.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                setGmailTemplateMappings(prev => {
                                  const n = { ...prev };
                                  delete n[letter];
                                  return n;
                                })
                              }
                              className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Delete mapping"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-metro-border text-[10px] text-slate-400 dark:text-metro-secondary">
                  {Object.keys(gmailTemplateMappings).length} of 26 alphabet keys configured.
                </div>
              </div>

            </div>

            {/* CARD 5: Verified Senders Allowlist */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                      Verified Senders Security Filter
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                      Prevent unauthorized print jobs by filtering emails to approved sender addresses.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right select-none">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${gmailVerifiedOnly ? "bg-emerald-500" : "bg-amber-400"}`} />
                      <span className={`text-xs font-extrabold uppercase tracking-wider ${gmailVerifiedOnly ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>
                        {gmailVerifiedOnly ? "Strict Whitelist On" : "Whitelist Off (Allow All)"}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-metro-secondary block">
                      {gmailVerifiedOnly ? "Only verified senders print" : "Accept commands from any sender"}
                    </span>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={gmailVerifiedOnly}
                    onClick={() => setGmailVerifiedOnly(p => !p)}
                    title={gmailVerifiedOnly ? "Click to disable sender whitelist" : "Click to enable sender whitelist"}
                    className={`relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${
                      gmailVerifiedOnly
                        ? "bg-gradient-to-r from-emerald-500 to-teal-600 border-emerald-500 shadow-md shadow-emerald-500/30"
                        : "bg-slate-200 dark:bg-slate-700/80 border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    <span className="sr-only">Toggle sender verification</span>
                    <span
                      className={`pointer-events-none inline-flex h-7 w-7 transform items-center justify-center rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out ${
                        gmailVerifiedOnly ? "translate-x-8" : "translate-x-0"
                      }`}
                    >
                      {gmailVerifiedOnly ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 stroke-[3]" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-slate-400 stroke-[2.5]" />
                      )}
                    </span>
                  </button>
                </div>
              </div>

              {gmailVerifiedOnly ? (
                <div className="space-y-3 animate-fade-in">
                  <p className="text-xs text-slate-500 dark:text-metro-secondary">
                    Only commands originating from these exact email addresses will be spooled:
                  </p>

                  {gmailVerifiedSenders.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {gmailVerifiedSenders.map((addr, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl shadow-xs"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-xs font-mono font-medium text-emerald-800 dark:text-emerald-300">
                            {addr}
                          </span>
                          <button
                            type="button"
                            onClick={() => setGmailVerifiedSenders(prev => prev.filter((_, i) => i !== idx))}
                            className="p-0.5 text-emerald-600 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer"
                            title="Remove email"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 dark:bg-metro-input/40 border border-dashed border-slate-300 dark:border-metro-border rounded-xl text-center space-y-1">
                      <p className="text-xs font-semibold text-slate-700 dark:text-metro-primary">
                        No authorized senders specified yet
                      </p>
                      <p className="text-[11px] text-slate-400 dark:text-metro-secondary">
                        Enter authorized staff or department email addresses below to permit automated printing.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <input
                      type="email"
                      value={newVerifiedEmail}
                      onChange={e => setNewVerifiedEmail(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const val = newVerifiedEmail.trim().toLowerCase();
                          if (val && !gmailVerifiedSenders.includes(val)) {
                            setGmailVerifiedSenders(p => [...p, val]);
                            setNewVerifiedEmail("");
                          }
                        }
                      }}
                      placeholder="e.g. library.staff@school.org"
                      className="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs font-mono text-slate-800 dark:text-metro-primary placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = newVerifiedEmail.trim().toLowerCase();
                        if (val && !gmailVerifiedSenders.includes(val)) {
                          setGmailVerifiedSenders(p => [...p, val]);
                          setNewVerifiedEmail("");
                        }
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm shadow-emerald-600/15"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Allow Sender</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    Sender verification is disabled. Any email with a matching trigger subject will be parsed and printed.
                  </span>
                </div>
              )}
            </div>

            {/* CARD 6: Interactive Command Format & Reference Guide */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                      Email Command Syntax Guide
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                      Format your email bodies using this grammar (one command per line).
                    </p>
                  </div>
                </div>
              </div>

              {/* Syntax Banner */}
              <div className="p-4 bg-slate-900 dark:bg-black/60 border border-slate-800 rounded-xl">
                <p className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider mb-1.5">
                  General Command Pattern:
                </p>
                <p className="text-base font-mono font-bold text-white tracking-wide">
                  <span className="text-sky-300">&lt;AccessionNo&gt;</span>
                  <span className="text-slate-500">[</span>
                  <span className="text-amber-300">/copies</span>
                  <span className="text-slate-500">]</span>
                  <span className="text-slate-500">[</span>
                  <span className="text-emerald-300">/template+copies</span>
                  <span className="text-slate-500">]...</span>
                </p>
              </div>

              {/* Examples Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {[
                  { cmd: "10001", tag: "DEFAULT", tagColor: "bg-slate-500", desc: "All templates · 2 copies each" },
                  { cmd: "10001/3", tag: "GLOBAL", tagColor: "bg-indigo-600", desc: "All templates · 3 copies each" },
                  { cmd: "10001/a", tag: "SINGLE", tagColor: "bg-sky-600", desc: "Template A only · 2 copies default" },
                  { cmd: "10001/b1", tag: "SINGLE", tagColor: "bg-sky-600", desc: "Template B only · 1 copy" },
                  { cmd: "10001/a1/b4", tag: "MULTI", tagColor: "bg-purple-600", desc: "Template A (1 copy) · Template B (4 copies)" },
                  { cmd: "10001/4/a1", tag: "OVERRIDE", tagColor: "bg-amber-600", desc: "All templates at 4 copies, except A at 1" },
                ].map(({ cmd, tag, tagColor, desc }) => (
                  <div
                    key={cmd}
                    className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-metro-input/30 border border-slate-200 dark:border-metro-border/50 rounded-xl hover:border-indigo-300 dark:hover:border-indigo-500/30 transition-all"
                  >
                    <code className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-200 dark:bg-slate-800 px-2.5 py-1 rounded-lg min-w-[125px] text-center">
                      {cmd}
                    </code>
                    <span className={`text-[9px] font-bold text-white px-2 py-0.5 rounded-md shrink-0 ${tagColor}`}>
                      {tag}
                    </span>
                    <span className="text-[11px] text-slate-600 dark:text-slate-400 font-medium truncate">
                      {desc}
                    </span>
                  </div>
                ))}
              </div>

              {/* Quick parsing rules pills */}
              <div className="p-3.5 bg-slate-50 dark:bg-metro-input/20 border border-slate-200 dark:border-metro-border/50 rounded-xl space-y-2 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-[11px] text-slate-700 dark:text-metro-primary uppercase tracking-wider">
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Grammar Rules Summary</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-slate-600 dark:text-metro-secondary">
                  <div>• <strong>Accession Number</strong> is always the first token preceding any slash.</div>
                  <div>• <strong>/number</strong> sets global copy count for all mapped templates.</div>
                  <div>• <strong>/letter</strong> selectively isolates printing to that single template.</div>
                  <div>• <strong>Multiple letters</strong> (e.g. /a2/b1) selectively print each mapped layout.</div>
                </div>
              </div>
            </div>

            {/* CARD 7: Live Poll Console & Diagnostics */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <h4 className="font-extrabold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">
                      Live Poll Console &amp; Diagnostics
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setGmailLogs([])}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-metro-secondary dark:hover:text-metro-primary hover:bg-slate-100 dark:hover:bg-metro-input/50 transition-colors cursor-pointer"
                  >
                    Clear Console
                  </button>
                  <button
                    type="button"
                    disabled={isGmailChecking}
                    onClick={handlePollGmailInbox}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-indigo-600/25"
                  >
                    {isGmailChecking ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Polling Mailbox...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Check &amp; Poll Now</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Terminal Viewport */}
              <div
                ref={terminalContainerRef}
                className="bg-slate-950 border border-slate-800 rounded-xl p-4 h-72 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1 shadow-inner select-text"
              >
                {gmailLogs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
                    <Terminal className="w-8 h-8 opacity-40" />
                    <p className="italic text-xs">No activity yet. Click "Check &amp; Poll Now" to initiate a live inbox scan.</p>
                  </div>
                ) : (
                  gmailLogs
                    .filter(log => !log.startsWith('[PRINT_DONE]'))
                    .map((log, i) => {
                      const color =
                        log.includes('[SUCCESS]') || log.includes('[VERIFIED]') || log.includes('[SPOOL]') || log.includes('[FINISHED]')
                          ? 'text-emerald-400 font-semibold'
                          : log.includes('[ERROR]') || log.includes('[FATAL]') || log.includes('[BLOCKED]')
                            ? 'text-rose-400 font-semibold'
                            : log.includes('[SECURITY]') || log.includes('[AUTH]')
                              ? 'text-amber-300'
                              : log.includes('[QUERY]') || log.includes('[PARSE]')
                                ? 'text-sky-300'
                                : log.includes('[IMAP]') || log.includes('[SCAN]')
                                  ? 'text-indigo-300'
                                  : 'text-slate-400';
                      return (
                        <p key={i} className={`${color} break-all hover:bg-white/[0.03] px-1 rounded`}>
                          {log}
                        </p>
                      );
                    })
                )}
              </div>
            </div>

          </div>
        )}

        {/* --- TAB 3: PRINTERS & HARDWARE --- */}
        {activeTab === "preferences" && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            {/* Header Banner */}
            <div className="relative overflow-hidden rounded-2xl p-6 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent border border-indigo-500/20 bg-white/50 dark:bg-metro-panel/50 backdrop-blur-sm shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/20 shrink-0">
                    <PrinterIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-base text-slate-800 dark:text-metro-primary tracking-tight">
                        Hardware Printers &amp; Output Engine
                      </h3>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 font-mono">
                        Hardware Spooler
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-metro-secondary mt-1 max-w-xl leading-relaxed">
                      Auto-detect thermal printheads, manage direct ZPL / TSPL driver spooling, and configure rasterization resolution presets.
                    </p>
                  </div>
                </div>

              </div>

              {/* 4 Stat Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-200/60 dark:border-metro-border/60">
                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Active Target</span>
                    <PrinterIcon className="w-3.5 h-3.5 text-indigo-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate">
                    {activePrinter?.name || "None Selected"}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate font-mono">
                    Primary Spool Target
                  </p>
                </div>

                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Driver Protocol</span>
                    <Cpu className="w-3.5 h-3.5 text-cyan-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate font-mono">
                    {(() => {
                      const name = (activePrinter?.name || "").toLowerCase();
                      if (name.includes("zpl") || name.includes("zebra")) return "ZPL Native Driver";
                      if (name.includes("tsc") || name.includes("endura") || name.includes("kores")) return "TSPL Native Driver";
                      if (name.includes("pdf")) return "PDF Spooler";
                      return "Windows GDI Driver";
                    })()}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate">
                    Direct command pipeline
                  </p>
                </div>

                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Hardware DPI</span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate font-mono">
                    {(() => {
                      const isThermal = activePrinter?.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(activePrinter?.name || "");
                      const has300Name = /300|te300|600/i.test(activePrinter?.name || "");
                      return isThermal ? (has300Name ? "300 DPI" : "203 DPI") : `${activePrinter?.dpi || 300} DPI`;
                    })()}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate">
                    Native head resolution
                  </p>
                </div>

                <div className="p-3 bg-white/70 dark:bg-metro-panel/60 backdrop-blur-sm border border-slate-200/70 dark:border-metro-border/70 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-slate-400 dark:text-metro-secondary">
                    <span className="text-[10px] uppercase font-bold tracking-wider">Quality Profile</span>
                    <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-500" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate capitalize">
                    {printQuality === "auto" ? "Auto Native Lock" : printQuality === "highest" ? "Highest Fidelity" : "High Speed Mode"}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-metro-secondary truncate">
                    {qualitySaved ? "Profile locked & active" : "Auto-configured"}
                  </p>
                </div>
              </div>
            </div>

            {/* CARD 1: System Printer Detection & Selection */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <PrinterIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 dark:text-metro-primary">
                      System Printer Detection &amp; Selection
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                      Select target printer for barcode and catalog label generation.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isScanning}
                  onClick={async () => {
                    setIsScanning(true);
                    try {
                      const result = await electronAPI.getPrinters();
                      if (result.success && Array.isArray(result.printers)) {
                        const formatted = await Promise.all(result.printers.map(async (p: any) => {
                          let caps: any = null;
                          try {
                            caps = await electronAPI.getPrinterCapabilities(p.name);
                          } catch (e) { }

                          const isThermal = caps?.isThermal || p.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(p.name || '');
                          const has300Name = /300|te300|600/i.test(p.name || '');
                          const trueDpi = caps?.defaultDpi || (isThermal ? (has300Name ? 300 : 203) : (p.dpi || 300));
                          const supportedDpi = caps?.supportedDpi || p.supportedDpi || (isThermal ? (has300Name ? [300] : [203]) : [300, 600]);

                          return {
                            name: p.name,
                            status: p.status || 'Ready',
                            type: p.type || 'Printer Spooler',
                            dpi: trueDpi,
                            isThermal,
                            driver: caps?.driver || p.driver,
                            protocol: caps?.protocol || p.protocol,
                            supportedDpi,
                            paperType: 'single',
                            widthMm: 50,
                            heightMm: 30,
                            leftMarginMm: 0,
                            rightMarginMm: 0,
                            middleGapMm: 0
                          };
                        }));

                        // Merge with saved settings in localStorage if any
                        const stored = localStorage.getItem("barcode_studio_saved_printers");
                        let saved: Printer[] = [];
                        if (stored) {
                          try { saved = JSON.parse(stored); } catch (e) { }
                        }
                        const merged = formatted.map((p: any) => {
                          const match = saved.find((s) => s.name === p.name);
                          if (match) {
                            const isThermal = p.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(p.name || '');
                            const has300Name = /300|te300|600/i.test(p.name || '');
                            const trueDpi = isThermal ? (has300Name ? 300 : 203) : (p.dpi || match.dpi || 300);
                            return { ...p, ...match, dpi: trueDpi, isThermal };
                          }
                          return p;
                        });
                        setScannedPrinters(merged);

                        // Try to preserve active selection or auto-select first scanned
                        const stillExists = merged.some(p => p.name === activePrinter.name);
                        if (!stillExists && merged.length > 0) {
                          onSelectPrinter(merged[0]);
                        } else if (stillExists) {
                          const updatedActive = merged.find(p => p.name === activePrinter.name);
                          if (updatedActive) onSelectPrinter(updatedActive);
                        }
                      } else {
                        setScannedPrinters([]);
                      }
                    } catch (e) {
                      console.error("Failed to scan printers:", e);
                    } finally {
                      setTimeout(() => {
                        setIsScanning(false);
                        setHasScanned(true);
                      }, 800);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 transition-all cursor-pointer self-start md:self-auto shadow-sm shadow-indigo-600/20"
                >
                  {isScanning ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Scanning System Buses...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-3.5 h-3.5" />
                      <span>Scan for Attached Devices</span>
                    </>
                  )}
                </button>
              </div>

              {isScanning ? (
                <div className="p-8 text-center bg-slate-50 dark:bg-metro-input/20 border border-dashed border-slate-200 dark:border-metro-border/50 rounded-2xl flex flex-col items-center justify-center gap-3">
                  <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-xs text-slate-600 dark:text-metro-secondary font-mono animate-pulse">
                    Probing plug-and-play USB hubs, Windows spooler ports, and virtual document pipelines...
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status Strip */}
                  <div className="p-3.5 bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-500/20 rounded-xl flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-indigo-900/90 dark:text-metro-secondary font-medium">
                        {hasScanned
                          ? `Scan Completed: Found ${displayPrinters.length} system printer(s). Click any card to set as primary spool target.`
                          : `Hardware catalog ready: ${displayPrinters.length} printer driver(s) available. Click any card to select.`}
                      </span>
                    </div>
                    <span className="text-[10px] bg-emerald-100/70 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/25 font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider font-mono">
                      Online
                    </span>
                  </div>

                  {/* Printer Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {displayPrinters.map((printer) => {
                      const isSelected = activePrinter.name === printer.name;
                      const isThermal = printer.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(printer.name || '');
                      const has300Name = /300|te300|600/i.test(printer.name || '');
                      const displayDpi = isThermal ? (has300Name ? 300 : 203) : (printer.dpi || 300);

                      const driverBadge = (() => {
                        const nameLower = (printer.name || '').toLowerCase();
                        if (nameLower.includes('zpl') || nameLower.includes('zebra')) {
                          return { label: 'ZPL Native Spool', color: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/30' };
                        }
                        if (nameLower.includes('tsc') || nameLower.includes('endura') || nameLower.includes('kores')) {
                          return { label: 'TSPL Native Spool', color: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30' };
                        }
                        if (nameLower.includes('pdf')) {
                          return { label: 'PDF Document Spooler', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' };
                        }
                        return { label: 'Windows GDI Driver', color: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30' };
                      })();

                      return (
                        <div
                          key={printer.name}
                          onClick={() => onSelectPrinter({ ...printer, dpi: displayDpi, isThermal })}
                          className={`p-4 rounded-2xl border flex flex-col justify-between gap-3.5 cursor-pointer transition-all duration-200 ${isSelected
                            ? "bg-indigo-50/70 dark:bg-indigo-950/25 border-indigo-500 ring-2 ring-indigo-500/30 shadow-md shadow-indigo-500/10 text-indigo-950 dark:text-indigo-200"
                            : "bg-slate-50/50 dark:bg-metro-input/40 border-slate-200 dark:border-metro-border hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-metro-input/60 shadow-2xs"
                            }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`p-2.5 rounded-xl transition-colors shrink-0 ${isSelected
                                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                                  : "bg-slate-200 dark:bg-metro-input text-slate-600 dark:text-metro-secondary"
                                  }`}
                              >
                                <PrinterIcon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-slate-800 dark:text-metro-primary truncate leading-tight">
                                  {printer.name}
                                </h4>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded-full border ${driverBadge.color}`}>
                                    {driverBadge.label}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0 mt-0.5">
                              {isSelected ? (
                                <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                              ) : (
                                <div className="w-5 h-5 rounded-full border border-slate-300 dark:border-metro-border bg-white dark:bg-metro-input/50" />
                              )}
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-slate-200/70 dark:border-metro-border/50 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-semibold text-slate-500 dark:text-metro-secondary uppercase tracking-wider font-mono">
                                Hardware Native:
                              </span>
                              <span className="text-[9.5px] font-extrabold font-mono px-2.5 py-0.5 rounded-md border bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25">
                                {displayDpi} DPI
                              </span>
                            </div>

                            <span className="text-[8.5px] text-emerald-600 dark:text-emerald-400 font-bold font-mono bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-wider">
                              Ready
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* CARD 2: Print Quality / Resolution mode */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-5 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
                    <SlidersHorizontal className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 dark:text-metro-primary">
                      Printhead Resolution &amp; Quality Preset
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                      Controls thermal rasterization fidelity and vector rendering sharpness.
                    </p>
                  </div>
                </div>
                {qualitySaved && (
                  <span className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 font-bold px-3 py-1 rounded-full uppercase tracking-wider font-mono flex items-center gap-1.5 shadow-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Saved
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {[
                  {
                    id: "auto",
                    label: "Auto (Recommended)",
                    badge: "Hardware Lock",
                    hint: `Locks rendering to auto-detected hardware printhead (${(() => {
                      const isThermal = activePrinter.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(activePrinter.name || '');
                      const has300Name = /300|te300|600/i.test(activePrinter.name || '');
                      return isThermal ? (has300Name ? 300 : 203) : (activePrinter.dpi || 300);
                    })()} DPI) for 1:1 pixel-perfect sharpness.`,
                  },
                  {
                    id: "highest",
                    label: "Highest Quality",
                    badge: "Max Density",
                    hint: "Forces maximum available printhead resolution for small barcodes, dense QR codes, and fine typography.",
                  },
                  {
                    id: "highspeed",
                    label: "High Speed",
                    badge: "High Throughput",
                    hint: "Optimized raster stream for rapid continuous batch printing and bulk inventory labeling.",
                  },
                ].map((opt) => {
                  const selected = printQuality === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSavePrintQuality(opt.id)}
                      className={`flex flex-col items-start justify-between gap-3 rounded-2xl p-4 border transition-all cursor-pointer text-left ${selected
                        ? "bg-indigo-50/70 dark:bg-indigo-950/25 border-indigo-500 ring-2 ring-indigo-500/30 shadow-md shadow-indigo-500/10"
                        : "bg-slate-50/60 dark:bg-metro-input/40 border-slate-200 dark:border-metro-border hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-metro-input/60 shadow-2xs"
                        }`}
                    >
                      <div className="w-full">
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-xs font-bold ${selected ? "text-indigo-600 dark:text-indigo-300" : "text-slate-800 dark:text-metro-primary"}`}>
                            {opt.label}
                          </span>
                          {selected ? (
                            <div className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-metro-border" />
                          )}
                        </div>
                        <span className="inline-block mt-1 text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-metro-input text-slate-600 dark:text-metro-secondary">
                          {opt.badge}
                        </span>
                      </div>
                      <span className="text-[10.5px] text-slate-500 dark:text-metro-secondary leading-relaxed">
                        {opt.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* CARD 3: Active Driver Pipeline & Spool Diagnostics */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-metro-border pb-3">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-800 dark:text-metro-primary">
                    Active Driver Pipeline &amp; Spool Diagnostics
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-metro-secondary">
                    Real-time hardware routing and command engine capabilities for the selected printer.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <div className="p-4 bg-slate-50/70 dark:bg-metro-input/30 border border-slate-200/80 dark:border-metro-border/60 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs">
                    <PrinterIcon className="w-3.5 h-3.5" />
                    <span>Raw Spool Channel</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-metro-secondary leading-relaxed">
                    Jobs bypass standard GDI raster bottlenecks by delivering native printer instructions directly to <strong className="font-mono text-slate-800 dark:text-metro-primary">{activePrinter?.name || "Target Spooler"}</strong>.
                  </p>
                </div>

                <div className="p-4 bg-slate-50/70 dark:bg-metro-input/30 border border-slate-200/80 dark:border-metro-border/60 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 font-bold text-xs">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Millimetre-Accurate Scale</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-metro-secondary leading-relaxed">
                    Canvas coordinates are automatically converted to thermal dots at {(() => {
                      const isThermal = activePrinter?.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(activePrinter?.name || '');
                      const has300Name = /300|te300|600/i.test(activePrinter?.name || '');
                      return isThermal ? (has300Name ? "11.81 dots/mm (300 DPI)" : "8 dots/mm (203 DPI)") : "11.81 dots/mm (300 DPI)";
                    })()} without margin drift.
                  </p>
                </div>

                <div className="p-4 bg-slate-50/70 dark:bg-metro-input/30 border border-slate-200/80 dark:border-metro-border/60 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Rotation Parity Engine</span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-metro-secondary leading-relaxed">
                    0°, 90°, 180°, and 270° orientations are physically calibrated across both TSPL and ZPL thermal printer heads to match the on-screen preview.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 4: ABOUT APP & MEET THE DEVELOPER --- */}
        {activeTab === "about" && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            {/* Top Half: About Section of BarCode Studio */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-6 space-y-6 shadow-xl">
              {/* Header Info */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-metro-border/80 pb-5">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 p-2 flex items-center justify-center shrink-0 shadow-md">
                    <img src={logoUrl} alt="BarCode Studio Logo" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-black text-lg tracking-tight text-metro-primary font-display">
                        BarCode Studio
                      </h3>
                      <span className="text-[10px] font-mono font-extrabold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 px-3 py-0.5 rounded-full uppercase tracking-wider">
                        v3.7.9 Pro
                      </span>
                    </div>
                    <p className="text-xs text-metro-secondary mt-1 leading-relaxed">
                      Professional Barcode & Label Design Studio with Native Thermal Printing Engine.
                    </p>
                  </div>
                </div>
              </div>

              {/* Core Features & System Architecture Grid */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold text-metro-primary uppercase tracking-wider font-mono flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>Core Capabilities & System Features</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="p-4 bg-metro-input/30 border border-metro-border/60 rounded-xl space-y-1.5 hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                      <Cpu className="w-4 h-4 shrink-0" />
                      <span>High-Speed Thermal Engine</span>
                    </div>
                    <p className="text-[11px] text-metro-secondary leading-relaxed">
                      Direct GDI and Raw ZPL / TSPL printer driver routing supporting 203, 300, and 600 DPI thermal spoolers.
                    </p>
                  </div>

                  <div className="p-4 bg-metro-input/30 border border-metro-border/60 rounded-xl space-y-1.5 hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                      <Database className="w-4 h-4 shrink-0" />
                      <span>SQL & Database Integration</span>
                    </div>
                    <p className="text-[11px] text-metro-secondary leading-relaxed">
                      Live catalog queries across MS SQL Server, MySQL, and SQLite databases with dynamic field bindings.
                    </p>
                  </div>

                  <div className="p-4 bg-metro-input/30 border border-metro-border/60 rounded-xl space-y-1.5 hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                      <Mail className="w-4 h-4 shrink-0" />
                      <span>Automated Print Spooler</span>
                    </div>
                    <p className="text-[11px] text-metro-secondary leading-relaxed">
                      Automated background inbox polling, verified sender rules, keyword triggers, and instant label spooling.
                    </p>
                  </div>

                  <div className="p-4 bg-metro-input/30 border border-metro-border/60 rounded-xl space-y-1.5 hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                      <Layers className="w-4 h-4 shrink-0" />
                      <span>WYSIWYG Template Designer</span>
                    </div>
                    <p className="text-[11px] text-metro-secondary leading-relaxed">
                      Precision canvas editor supporting 1D/2D barcodes, QR codes, images, shapes, and auto-shrunk text algorithms.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Half: Meet the Developer Card (Shifted here) */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2 border-b border-metro-border/80 pb-3">
                <Code2 className="w-4 h-4 text-indigo-400" />
                <h4 className="text-xs font-extrabold text-metro-primary uppercase tracking-wider font-mono">
                  Meet the Developer
                </h4>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-between gap-5 pt-1">
                {/* Left Side: Avatar + Developer Info */}
                <div className="flex items-center gap-4 min-w-0 w-full md:w-auto">
                  <div className="relative w-16 h-16 rounded-full border-2 border-indigo-500/40 dark:border-indigo-400/50 shadow-md overflow-hidden shrink-0 ring-4 ring-indigo-500/10 bg-slate-100 dark:bg-slate-800">
                    <img
                      src={shubhamGif}
                      alt="Shubham - Developer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = logoUrl;
                      }}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-base font-extrabold text-metro-primary tracking-tight">
                        Shubham
                      </h4>
                    </div>
                    <p className="text-xs text-metro-secondary truncate mt-1">
                      Developer @ BarCode Studio
                    </p>
                  </div>
                </div>

                {/* Right Side / Action Buttons */}
                <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end shrink-0">
                  {/* GitHub Profile Button */}
                  <button
                    type="button"
                    onClick={() => {
                      const ghUrl = "https://github.com/ishubham1312";
                      if (window.electronAPI && typeof (window.electronAPI as any).openExternal === "function") {
                        (window.electronAPI as any).openExternal(ghUrl);
                      } else {
                        window.open(ghUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="px-4 py-2.5 bg-metro-input hover:bg-metro-panel text-metro-primary border border-metro-border rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm flex items-center gap-2 hover:border-slate-400 dark:hover:border-slate-600"
                    title="Open GitHub Profile"
                  >
                    <Github className="w-4 h-4 text-slate-400 hover:text-white" />
                    <span>GitHub</span>
                  </button>

                  {/* Portfolio Button */}
                  <button
                    type="button"
                    onClick={() => {
                      const netlifyUrl = "https://ishubham1312.netlify.app";
                      if (window.electronAPI && typeof (window.electronAPI as any).openExternal === "function") {
                        (window.electronAPI as any).openExternal(netlifyUrl);
                      } else {
                        window.open(netlifyUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="px-4 py-2.5 bg-metro-input hover:bg-metro-panel text-metro-primary border border-metro-border rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm flex items-center gap-2 hover:border-indigo-500/50"
                  >
                    <Globe className="w-4 h-4 text-indigo-400" />
                    <span>Portfolio</span>
                  </button>

                  {/* Contact Developer Button */}
                  <button
                    type="button"
                    onClick={() => {
                      const gmailComposeUrl = "https://mail.google.com/mail/?view=cm&fs=1&to=ishubham1312@gmail.com&su=BarCode+Studio+Support+%26+Feedback";
                      if (window.electronAPI && typeof (window.electronAPI as any).openExternal === "function") {
                        (window.electronAPI as any).openExternal(gmailComposeUrl);
                      } else {
                        window.open(gmailComposeUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md shadow-indigo-600/20 flex items-center gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    <span>Contact Developer</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {" "}
      {/* End Right Content Panel */}
      <ConnectionModal
        isOpen={showConnectionModal}
        onClose={() => {
          setShowConnectionModal(false);
          setEditingServerId(null);
        }}
        activeProfile={activeProfileForModal}
        onSaveProfile={(prof) => {
          try {
            const serverItem: SQLServer = {
              id: prof.id,
              name: prof.name,
              server: prof.server || "",
              instance: prof.instance || "",
              database: prof.database,
              table: prof.table,
              username: prof.username || "",
              password: prof.password,
              authMode: prof.authMode || "sql",
              uniqueField: prof.uniqueField || "AccessionNo",
              isActive: true,
            };

            // Add custom fields for connection profile compatibility
            (serverItem as any).dbType = prof.dbType;
            (serverItem as any).port = prof.port;
            (serverItem as any).sqlitePath = prof.sqlitePath;
            (serverItem as any).trustCert = prof.trustCert;
            (serverItem as any).encrypt = prof.encrypt;
            (serverItem as any).fieldMappings = prof.fieldMappings;

            // Set all other servers to inactive
            const updatedServers = servers.map((s) => ({
              ...s,
              isActive: s.id === prof.id,
            }));

            const index = updatedServers.findIndex((s) => s.id === prof.id);
            if (index >= 0) {
              updatedServers[index] = serverItem;
            } else {
              updatedServers.push(serverItem);
            }

            setServers(updatedServers);
            localStorage.setItem("barcode_studio_sql_servers", JSON.stringify(updatedServers));
            onUpdateDatabaseConfig(true, serverItem.database);
          } catch (e) {
            console.error(e);
          }
        }}
        onConnect={async (prof) => {
          const serverItem: SQLServer = {
            id: prof.id,
            name: prof.name,
            server: prof.server || "",
            instance: prof.instance || "",
            database: prof.database,
            table: prof.table,
            username: prof.username || "",
            password: prof.password,
            authMode: prof.authMode || "sql",
            uniqueField: prof.uniqueField || "AccessionNo",
            isActive: true,
          };

          (serverItem as any).dbType = prof.dbType;
          (serverItem as any).port = prof.port;
          (serverItem as any).sqlitePath = prof.sqlitePath;
          (serverItem as any).trustCert = prof.trustCert;
          (serverItem as any).encrypt = prof.encrypt;
          (serverItem as any).fieldMappings = prof.fieldMappings;

          setServers(prev => {
            const list = prev.map(s => ({ ...s, isActive: false }));
            const index = list.findIndex(s => s.id === prof.id);
            if (index >= 0) {
              list[index] = serverItem;
              return list;
            } else {
              return [...list, serverItem];
            }
          });

          onUpdateDatabaseConfig(true, serverItem.database);
          return { success: true, msg: "Connected" };
        }}
      />

      <RestartAppModal
        isOpen={restartModalInfo.isOpen}
        fileName={restartModalInfo.fileName}
        theme={theme}
        onRestart={() => electronAPI.restartApp()}
        onClose={() => setRestartModalInfo({ isOpen: false })}
      />
    </div>
  );
};
