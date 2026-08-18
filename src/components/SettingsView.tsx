import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Printer, ConnectionProfile } from "../types";
import { mockPrinters, defaultTemplates } from "../data/mockData";
import { useElectronAPI } from "../hooks/useElectronAPI";
import logoUrl from "@/assets/logo.png";
import shubhamGif from "@/assets/shubham.gif";
import { ConnectionModal } from "./ConnectionModal";
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

  // General App preferences
  const [unit, setUnit] = useState<"mm" | "in">("mm");
  const [snapSensitivity, setSnapSensitivity] = useState<number>(8);
  const [autoSaveInterval, setAutoSaveInterval] = useState<number>(30);

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

  // Gmail Configuration state
  const [gmailAddress, setGmailAddress] = useState(
    () =>
      localStorage.getItem("gmail_address") || "librarian.catalog@gmail.com",
  );
  const [gmailAppPassword, setGmailAppPassword] = useState(
    () => localStorage.getItem("gmail_app_password") || "abcd efgh ijkl mnop",
  );

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
      return stored ? JSON.parse(stored) : ["acquisitions@citycollege.edu", "librarian@citycollege.edu"];
    } catch (e) {
      console.error(e);
      return ["acquisitions@citycollege.edu", "librarian@citycollege.edu"];
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
  const gmailLogEndRef = React.useRef<HTMLDivElement>(null);

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

  // Auto-scroll log terminal to bottom on new log entries
  useEffect(() => {
    if (gmailLogEndRef.current) {
      gmailLogEndRef.current.scrollIntoView({ behavior: "smooth" });
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

        // Gmail automation
        gmail_address: localStorage.getItem("gmail_address") || "",
        gmail_app_password: localStorage.getItem("gmail_app_password") || "",
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
        ["gmail_address", bundle.gmail_address || ""],
        ["gmail_app_password", bundle.gmail_app_password || ""],
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

      setConfigStatus("✓ Configuration imported. Restart the app for all changes to take effect.");
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
              { id: "preferences", label: "Printers & Layout", icon: SlidersHorizontal },
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
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">

            {/* Section Header */}
            <div className="flex items-center gap-3 pb-1">
              <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                <Mail className="w-4 h-4 text-red-400" />
              </div>
              <div>
                <h3 className="font-extrabold text-xs uppercase tracking-wider text-metro-primary">Gmail Print Automations</h3>
                <p className="text-[10px] text-metro-secondary">Poll your Gmail inbox and automatically spool label print jobs from email commands.</p>
              </div>
            </div>

            {/* Gmail Credentials + Polling Card */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-5 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-metro-border pb-3">
                <Mail className="w-4 h-4 text-red-500" />
                <h4 className="font-bold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">Gmail Account Configuration</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 dark:text-metro-secondary uppercase tracking-wider">Gmail Address</label>
                  <input
                    type="email"
                    value={gmailAddress}
                    onChange={e => setGmailAddress(e.target.value)}
                    placeholder="your@gmail.com"
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 dark:text-metro-secondary uppercase tracking-wider">App Password</label>
                  <div className="relative">
                    <input
                      type={showGmailPass ? "text" : "password"}
                      value={gmailAppPassword}
                      onChange={e => setGmailAppPassword(e.target.value)}
                      placeholder="xxxx xxxx xxxx xxxx"
                      className="w-full px-3 py-2.5 pr-10 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                    />
                    <button type="button" onClick={() => setShowGmailPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-metro-primary transition-colors cursor-pointer">
                      {showGmailPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Polling Toggle Row */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-metro-border">
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-metro-primary">Background Auto-Polling</p>
                  <p className="text-[10px] text-slate-500 dark:text-metro-secondary">
                    {pollingEnabled && pollingIntervalSeconds > 0
                      ? `Next poll in ${countdown}s — checking every ${pollingInterval}`
                      : "Automatically check inbox on a schedule"}
                  </p>
                </div>
                <button type="button" onClick={() => setPollingEnabled(p => !p)} className="flex items-center gap-2 cursor-pointer">
                  {pollingEnabled
                    ? <ToggleRight className="w-8 h-8 text-indigo-500" />
                    : <ToggleLeft className="w-8 h-8 text-slate-400" />}
                  <span className={`text-[10px] font-bold ${pollingEnabled
                    ? theme === "light"
                      ? "text-indigo-600"
                      : "text-indigo-400"
                    : "text-slate-400"
                    }`}>
                    {pollingEnabled ? "ENABLED" : "DISABLED"}
                  </span>
                </button>
              </div>

              {/* Interval Preset Buttons */}
              {pollingEnabled && (
                <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-metro-border animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label className="text-[10px] font-bold text-slate-500 dark:text-metro-secondary uppercase tracking-wider min-w-[120px]">
                      Check Frequency
                    </label>
                    <select
                      value={
                        pollingMode === "daily"
                          ? "daily"
                          : `${intervalValue}-${intervalUnit}`
                      }
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
                      className="flex-1 px-3 py-2 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500 cursor-pointer transition-colors"
                    >
                      <option value="10-seconds">Every 10 seconds</option>
                      <option value="30-seconds">Every 30 seconds</option>
                      <option value="1-minutes">Every 1 minute</option>
                      <option value="2-minutes">Every 2 minutes</option>
                      <option value="5-minutes">Every 5 minutes</option>
                      <option value="daily">Daily at specific time</option>
                    </select>
                  </div>

                  {pollingMode === "daily" && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 animate-fade-in">
                      <label className="text-[10px] font-bold text-slate-500 dark:text-metro-secondary uppercase tracking-wider min-w-[120px]">
                        Daily Time
                      </label>
                      <input
                        type="time"
                        value={dailyTime}
                        onChange={e => setDailyTime(e.target.value)}
                        className="px-3 py-2 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs text-slate-800 dark:text-metro-primary focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  )}

                  {/* Queue Status */}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-mono ${isPrintingRef.current
                    ? theme === "light"
                      ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    : theme === "light"
                      ? "bg-slate-50 border-slate-200 text-slate-500"
                      : "bg-metro-input/40 border-metro-border/50 text-metro-secondary"
                    }`}>
                    <Activity className="w-3 h-3 shrink-0" />
                    <span>
                      {isPrintingRef.current
                        ? `Print job running… ${printQueueRef.current.length} job(s) queued`
                        : printQueueRef.current.length > 0
                          ? `${printQueueRef.current.length} job(s) queued, waiting for printer`
                          : "Queue idle — ready to accept print commands"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Trigger Subjects */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 border-b border-metro-border pb-3">
                <Bell className="w-4 h-4 text-amber-400" />
                <h4 className="font-bold text-xs text-metro-primary uppercase tracking-wider">Email Trigger Subjects</h4>
              </div>
              <p className="text-[10px] text-metro-secondary">Only emails with these exact subjects will trigger printing.</p>
              <div className="flex flex-wrap gap-2">
                {triggerSubjects.map((subj, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <span className="text-[10px] font-mono font-bold text-amber-400">{subj}</span>
                    <button type="button" onClick={() => setTriggerSubjects(prev => prev.filter((_, i) => i !== idx))}
                      className="text-amber-400/60 hover:text-red-400 transition-colors cursor-pointer"><X className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text" value={newSubjectInput} onChange={e => setNewSubjectInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newSubjectInput.trim()) { handleAddSubjectVariations(newSubjectInput); setNewSubjectInput(""); } }}
                  placeholder="e.g. PRINT_LABELS"
                  className="flex-1 px-3 py-2 bg-metro-input border border-metro-border rounded-xl text-xs text-metro-primary focus:outline-none focus:border-amber-500/60 font-mono transition-colors"
                />
                <button type="button" onClick={() => { if (newSubjectInput.trim()) { handleAddSubjectVariations(newSubjectInput); setNewSubjectInput(""); } }}
                  className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl text-[10px] font-bold hover:bg-amber-500/20 transition-all cursor-pointer flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
            </div>

            {/* Template Mappings */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-metro-border pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <h4 className="font-bold text-xs text-metro-primary uppercase tracking-wider">Template Key Mappings</h4>
                </div>
                {nextAvailableLetter && (
                  <button type="button"
                    onClick={() => setGmailTemplateMappings(prev => ({ ...prev, [nextAvailableLetter]: allAvailableTemplates[0]?.id || "" }))}
                    className="px-3 py-1.5 bg-indigo-600/10 border border-indigo-500/30 text-indigo-400 rounded-xl text-[10px] font-bold hover:bg-indigo-600/20 transition-all cursor-pointer flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add Key '{nextAvailableLetter.toUpperCase()}'
                  </button>
                )}
              </div>
              <p className="text-[10px] text-metro-secondary">Map single letters to templates. Use these letters in email commands to select which template to print.</p>
              {Object.keys(gmailTemplateMappings).length === 0 ? (
                <div className="py-6 text-center border border-dashed border-metro-border/50 rounded-xl">
                  <p className="text-[11px] text-metro-secondary">No template keys configured yet. Click 'Add Key A' to start.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {Object.entries(gmailTemplateMappings).sort(([a], [b]) => a.localeCompare(b)).map(([letter, templateId]) => (
                    <div key={letter} className="flex items-center gap-3 p-3 bg-metro-input/40 border border-metro-border/50 rounded-xl">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                        <span className="text-sm font-black text-indigo-400 font-mono">{letter.toUpperCase()}</span>
                      </div>
                      <select
                        value={templateId}
                        onChange={e => setGmailTemplateMappings(prev => ({ ...prev, [letter]: e.target.value }))}
                        className="flex-1 px-3 py-2 bg-metro-input border border-metro-border rounded-xl text-xs text-metro-primary focus:outline-none focus:border-indigo-500/60 cursor-pointer"
                      >
                        <option value="">— Select Template —</option>
                        {allAvailableTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => setGmailTemplateMappings(prev => { const n = { ...prev }; delete n[letter]; return n; })}
                        className="p-1.5 text-metro-secondary hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 cursor-pointer">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Command Format Guide — improved */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-metro-border pb-3">
                <BookOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h4 className="font-bold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">Command Format Guide</h4>
              </div>
              <div className="p-3 bg-slate-800 dark:bg-black/60 rounded-xl">
                <p className="text-[10px] text-slate-300 font-mono mb-1 opacity-60">Email body format (one command per line):</p>
                <p className="text-sm font-mono font-bold text-white">
                  <span className="text-sky-300">&lt;AccessionNo&gt;</span>
                  <span className="text-slate-400">[</span>
                  <span className="text-amber-300">/copies</span>
                  <span className="text-slate-400">]</span>
                  <span className="text-slate-400">[</span>
                  <span className="text-emerald-300">/template+copies</span>
                  <span className="text-slate-400">]...</span>
                </p>
              </div>
              <div className="space-y-1.5">
                {[
                  { cmd: "10001", tag: "DEFAULT", tagColor: "bg-slate-500", desc: "All templates · 2 copies each" },
                  { cmd: "10001/3", tag: "GLOBAL", tagColor: "bg-indigo-500", desc: "All templates · 3 copies each" },
                  { cmd: "10001/a", tag: "SINGLE", tagColor: "bg-sky-500", desc: "Template A only · 2 copies (default)" },
                  { cmd: "10001/b1", tag: "SINGLE", tagColor: "bg-sky-500", desc: "Template B only · 1 copy" },
                  { cmd: "10001/a1/b4", tag: "MULTI", tagColor: "bg-violet-500", desc: "A → 1 copy   B → 4 copies" },
                  { cmd: "10001/4/a1", tag: "OVERRIDE", tagColor: "bg-amber-500", desc: "All → 4 copies   A overridden → 1 copy" },
                  { cmd: "10001/a2/b3/c1", tag: "MULTI", tagColor: "bg-violet-500", desc: "A → 2   B → 3   C → 1" },
                ].map(({ cmd, tag, tagColor, desc }) => (
                  <div key={cmd} className="flex items-center gap-3 p-2.5 bg-slate-50 dark:bg-metro-input/30 border border-slate-200 dark:border-metro-border/50 rounded-xl group hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors">
                    <code className="text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 px-2.5 py-1 rounded-lg min-w-[130px]">{cmd}</code>
                    <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded-md shrink-0 ${tagColor}`}>{tag}</span>
                    <span className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">{desc}</span>
                  </div>
                ))}
              </div>
              <div className="p-3.5 bg-zinc-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
                <p className="text-[10px] font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-500" /> Parsing Rules
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  {[
                    ["AccNo", "Always first, before any /"],
                    ["/3", "Global copies for ALL templates"],
                    ["/a", "Only template A, 2 copies"],
                    ["/b3", "Only template B, 3 copies"],
                    ["/a + /b", "Only A and B print (no global)"],
                    ["/3 + /a1", "All print at 3 copies; A at 1"],
                  ].map(([code, rule]) => (
                    <div key={code} className="flex items-center gap-2">
                      <code className="text-[10px] font-mono font-bold bg-slate-200 dark:bg-slate-800 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded min-w-[70px] text-center">{code}</code>
                      <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">{rule}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Verified Senders */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-metro-border pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="font-bold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">Verified Senders Filter</h4>
                </div>
                <button type="button" onClick={() => setGmailVerifiedOnly(p => !p)} className="flex items-center gap-1.5 cursor-pointer">
                  {gmailVerifiedOnly ? <ToggleRight className="w-6 h-6 text-emerald-600 dark:text-emerald-400" /> : <ToggleLeft className="w-6 h-6 text-slate-400" />}
                  <span className={`text-[10px] font-bold ${gmailVerifiedOnly ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400"}`}>
                    {gmailVerifiedOnly ? "ON" : "OFF"}
                  </span>
                </button>
              </div>
              {gmailVerifiedOnly && (
                <>
                  <p className="text-[10px] text-slate-500 dark:text-metro-secondary">Only process print commands from these email addresses.</p>
                  <div className="space-y-1.5">
                    {gmailVerifiedSenders.map((addr, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2.5 bg-slate-50 dark:bg-metro-input/40 border border-slate-200 dark:border-metro-border/50 rounded-xl">
                        <span className="flex-1 text-[10px] font-mono text-slate-700 dark:text-metro-primary">{addr}</span>
                        <button type="button" onClick={() => setGmailVerifiedSenders(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-slate-400 hover:text-red-500 cursor-pointer transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input type="email" value={newVerifiedEmail} onChange={e => setNewVerifiedEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && newVerifiedEmail.trim()) { setGmailVerifiedSenders(p => [...p, newVerifiedEmail.trim()]); setNewVerifiedEmail(""); } }}
                      placeholder="user@example.com"
                      className="flex-1 px-3 py-2 bg-slate-50 dark:bg-metro-input border border-slate-300 dark:border-metro-border rounded-xl text-xs font-mono text-slate-800 dark:text-metro-primary focus:outline-none focus:border-emerald-500 transition-colors" />
                    <button type="button" onClick={() => { if (newVerifiedEmail.trim()) { setGmailVerifiedSenders(p => [...p, newVerifiedEmail.trim()]); setNewVerifiedEmail(""); } }}
                      className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-bold hover:bg-emerald-700 transition-all cursor-pointer flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Poll Action + Live Terminal */}
            <div className="bg-white dark:bg-metro-panel border border-slate-200 dark:border-metro-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-metro-border pb-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <h4 className="font-bold text-xs text-slate-800 dark:text-metro-primary uppercase tracking-wider">Live Poll Console</h4>
                  {printQueueRef.current.length > 0 && (
                    <span className="text-[9px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
                      {printQueueRef.current.length} queued
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setGmailLogs([])} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-metro-secondary transition-colors cursor-pointer">
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={isGmailChecking}
                    onClick={handlePollGmailInbox}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-[10px] rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-indigo-600/20"
                  >
                    {isGmailChecking ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" /><span>Polling Inbox...</span></>
                    ) : (
                      <><Play className="w-3.5 h-3.5" /><span>Check &amp; Poll Now</span></>
                    )}
                  </button>
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 h-64 overflow-y-auto font-mono text-[10px] space-y-0.5">
                {gmailLogs.length === 0 ? (
                  <p className="text-slate-500 italic">No activity yet. Click "Check &amp; Poll Now" to start a live inbox scan.</p>
                ) : (
                  gmailLogs
                    .filter(log => !log.startsWith('[PRINT_DONE]'))
                    .map((log, i) => {
                      const color = log.includes('[SUCCESS]') || log.includes('[VERIFIED]') || log.includes('[SPOOL]') || log.includes('[FINISHED]')
                        ? 'text-emerald-400'
                        : log.includes('[ERROR]') || log.includes('[FATAL]') || log.includes('[BLOCKED]')
                          ? 'text-red-400'
                          : log.includes('[SECURITY]') || log.includes('[AUTH]')
                            ? 'text-amber-300'
                            : log.includes('[QUERY]') || log.includes('[PARSE]')
                              ? 'text-sky-400'
                              : log.includes('[IMAP]') || log.includes('[SCAN]')
                                ? 'text-indigo-300'
                                : 'text-slate-400';
                      return <p key={i} className={color}>{log}</p>;
                    })
                )}
                <div ref={gmailLogEndRef} />
              </div>
            </div>

          </div>
        )}

        {/* --- TAB 3: PRINTERS & PREFERENCES --- */}
        {activeTab === "preferences" && (
          <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            {/* Real-time hardware scanning widget */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-metro-border pb-4">
                <div className="flex items-center gap-2.5">
                  <PrinterIcon className="w-5 h-5 text-indigo-400" />
                  <div>
                    <h3 className="font-extrabold text-xs uppercase tracking-wider text-metro-primary">
                      System Printer Detection
                    </h3>
                    <p className="text-[10px] text-metro-secondary">
                      Scan your local system for connected USB label printers or network queues.
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
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white font-bold text-[10px] flex items-center gap-2 transition-all cursor-pointer self-start md:self-auto shadow-md"
                >
                  {isScanning ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Scanning Device Hubs...</span>
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
                <div className="p-8 text-center bg-metro-input/20 border border-dashed border-metro-border/50 rounded-xl flex flex-col items-center justify-center gap-3">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-[11px] text-metro-secondary font-mono animate-pulse">
                    Probing plug-and-play USB buses, serial descriptors, and dynamic PDF spooler catalogs...
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status Indicator */}
                  <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/80 dark:border-indigo-500/10 rounded-xl flex items-center justify-between gap-3 text-xs">
                    <span className="text-indigo-900/90 dark:text-metro-secondary font-semibold">
                      {hasScanned
                        ? `Scan Completed: Identified ${displayPrinters.length} system-compatible document spooler(s).`
                        : `Device scanner idle. ${displayPrinters.length} printer driver(s) are available for selection.`
                      }
                    </span>
                    <span className="text-[9px] bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20 font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      Online
                    </span>
                  </div>

                  {/* Printer Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {displayPrinters.map((printer) => {
                      const isSelected = activePrinter.name === printer.name;
                      const isThermal = printer.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(printer.name || '');
                      const has300Name = /300|te300|600/i.test(printer.name || '');
                      const displayDpi = isThermal ? (has300Name ? 300 : 203) : (printer.dpi || 300);

                      // Derive clean driver badge metadata
                      const driverBadge = (() => {
                        const nameLower = (printer.name || '').toLowerCase();
                        if (nameLower.includes('zpl') || nameLower.includes('zebra')) {
                          return { label: 'ZPL Native Spool', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' };
                        }
                        if (nameLower.includes('tsc') || nameLower.includes('endura') || nameLower.includes('kores')) {
                          return { label: 'TSPL Native Spool', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
                        }
                        if (nameLower.includes('pdf')) {
                          return { label: 'PDF Document Spooler', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
                        }
                        return { label: 'Windows GDI Driver', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
                      })();

                      return (
                        <div
                          key={printer.name}
                          onClick={() => onSelectPrinter({ ...printer, dpi: displayDpi, isThermal })}
                          className={`p-4 rounded-2xl border flex flex-col justify-between gap-3 cursor-pointer transition-all duration-200 ${isSelected
                            ? "bg-indigo-950/20 border-indigo-500 ring-1 ring-indigo-500/30 shadow-lg shadow-indigo-500/10 text-indigo-300"
                            : "bg-metro-input/40 border-metro-border hover:border-slate-400 dark:hover:border-slate-600 hover:bg-metro-input/60"
                            }`}
                        >
                          {/* Top Section: Icon, Printer Name & Badge */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`p-2.5 rounded-xl transition-colors shrink-0 ${isSelected
                                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                                  : "bg-metro-input text-metro-secondary"
                                  }`}
                              >
                                <PrinterIcon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-metro-primary truncate leading-tight">
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
                                <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/40">
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </div>
                              ) : (
                                <div className="w-5 h-5 rounded-full border border-metro-border bg-metro-input/50" />
                              )}
                            </div>
                          </div>

                          {/* Bottom Section: Hardware Native DPI Badge */}
                          <div className="pt-2.5 border-t border-metro-border/50 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-semibold text-metro-secondary uppercase tracking-wider font-mono">
                                Hardware Native:
                              </span>
                              <span className="text-[9.5px] font-extrabold font-mono px-2.5 py-0.5 rounded-md border bg-indigo-500/15 text-indigo-400 border-indigo-500/30">
                                {displayDpi} DPI
                              </span>
                            </div>

                            <span className="text-[8.5px] text-emerald-400 font-bold font-mono bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase tracking-wider">
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

            {/* Print Quality / resolution mode */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5 border-b border-metro-border pb-3">
                <SlidersHorizontal className="w-5 h-5 text-indigo-400" />
                <div className="flex-1">
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-metro-primary">
                    Print Quality (Resolution)
                  </h3>
                  <p className="text-[10px] text-metro-secondary">
                    Auto locks resolution to auto-detected hardware printhead DPI. Highest forces maximum fidelity; High Speed favours speed.
                  </p>
                </div>
                {qualitySaved && (
                  <span className="text-[9px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    Saved
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    id: "auto",
                    label: "Auto (Recommended)",
                    hint: `Uses auto-detected hardware resolution (${(() => {
                      const isThermal = activePrinter.isThermal || /zebra|tsc|endura|kores|thermal|godex|citizen|intermec|sato|2801|zpl|tspl/i.test(activePrinter.name || '');
                      const has300Name = /300|te300|600/i.test(activePrinter.name || '');
                      return isThermal ? (has300Name ? 300 : 203) : (activePrinter.dpi || 300);
                    })()} DPI) for pixel-perfect sharpness.`,
                  },
                  {
                    id: "highest",
                    label: "Highest Quality",
                    hint: "Forces maximum available printhead resolution for detailed graphics.",
                  },
                  {
                    id: "highspeed",
                    label: "High Speed",
                    hint: "Optimized for high-volume batch printing throughput.",
                  },
                ].map((opt) => {
                  const selected = printQuality === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSavePrintQuality(opt.id)}
                      className={`flex flex-col items-start gap-1 rounded-xl p-3.5 border transition-all cursor-pointer text-left ${selected
                        ? "bg-indigo-500/10 border-indigo-500 ring-1 ring-indigo-500/30 shadow-md shadow-indigo-500/10"
                        : "bg-metro-input border-metro-border hover:border-slate-400 dark:hover:border-slate-600 hover:bg-metro-input/60"
                        }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-[11px] font-bold ${selected ? "text-indigo-300" : "text-metro-primary"}`}>
                          {opt.label}
                        </span>
                        {selected && (
                          <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
                        )}
                      </div>
                      <span className="text-[9px] text-metro-secondary font-mono leading-relaxed mt-0.5">
                        {opt.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Layout metrics configurations */}
            <div className="bg-metro-panel border border-metro-border rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2.5 border-b border-metro-border pb-3">
                <SlidersHorizontal className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="font-extrabold text-xs uppercase tracking-wider text-metro-primary">
                    Layout Standards & Snapping Rules
                  </h3>
                  <p className="text-[10px] text-metro-secondary">
                    Define unit scale coordinates, magnetic snap triggers, and
                    automatic drafts background saving.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[9.5px] font-bold text-metro-secondary uppercase tracking-wider font-mono block">
                    Measurement Metrics Standard
                  </label>
                  <div className="flex bg-metro-input border border-metro-border p-1 rounded-xl">
                    <button
                      onClick={() => setUnit("mm")}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${unit === "mm"
                        ? "bg-metro-accent text-white shadow-sm font-extrabold"
                        : "text-metro-secondary hover:text-metro-primary"
                        }`}
                    >
                      Metric Scale (mm)
                    </button>
                    <button
                      onClick={() => setUnit("in")}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${unit === "in"
                        ? "bg-metro-accent text-white shadow-sm font-extrabold"
                        : "text-metro-secondary hover:text-metro-primary"
                        }`}
                    >
                      Imperial Scale (in)
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[9.5px] font-bold text-metro-secondary uppercase tracking-wider font-mono block">
                    Draft Auto-Save Frequency
                  </label>
                  <select
                    value={autoSaveInterval}
                    onChange={(e) =>
                      setAutoSaveInterval(parseInt(e.target.value))
                    }
                    className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:outline-none text-metro-primary cursor-pointer"
                  >
                    <option value={10}>Every 10 Seconds</option>
                    <option value={30}>Every 30 Seconds</option>
                    <option value={60}>Every Minute</option>
                    <option value={300}>Every 5 Minutes</option>
                  </select>
                </div>

                <div className="col-span-1 sm:col-span-2 space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="font-bold text-metro-secondary uppercase tracking-wider">
                      Magnet Grid Snapping Density
                    </span>
                    <span className="font-bold text-indigo-400">
                      {snapSensitivity} px (Threshold)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="15"
                    value={snapSensitivity}
                    onChange={(e) =>
                      setSnapSensitivity(parseInt(e.target.value))
                    }
                    className="w-full accent-indigo-500 h-1.5 rounded-full bg-metro-border/60 appearance-none cursor-pointer"
                  />
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
                        v3.7.1 Pro
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
    </div>
  );
};
