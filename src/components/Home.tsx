import React, { useState, useEffect } from "react";
import { LabelTemplate, Printer } from "../types";
import { defaultTemplates, mockPrinters } from "../data/mockData";
import {
  Database,
  Plus,
  FolderOpen,
  Printer as PrinterIcon,
  Layout,
  Settings,
  Trash2,
  FolderPlus,
  Layers,
  ChevronRight,
  ExternalLink,
  Tag,
  Check,
  X,
  Upload,
  History,
  Pin,
} from "lucide-react";
import logoUrl from "@/assets/logo.png";
import { SettingsView } from "./SettingsView";
import { HistoryView } from "./HistoryView";
import { ConfirmModal } from "./ConfirmModal";
import { useElectronAPI } from "../hooks/useElectronAPI";
import {
  prepareTemplateForLoadOrImport,
  deserializeTemplateFromFile,
  deepClone,
} from "../utils/templateSerialization";

interface HomeProps {
  onNewTemplate: () => void;
  onOpenTemplateDialog: () => void;
  onOpenMultipleTemplates?: (templates: LabelTemplate[]) => void;
  onPrintTemplates?: (templates: LabelTemplate[]) => void;
  onUpdateDatabaseConfig?: (connected: boolean, name: string) => void;
  onAutoTriggerPrint?: (accessionNumbers: string[]) => void;
  onReprint?: (accessionNoStr: string) => void;

  dbConnected: boolean;
  dbName: string;
  activePrinter: Printer;
  onSelectPrinter: (printer: Printer) => void;
  printers?: Printer[];
  onSavePrinterSettings?: (printer: Printer) => void;
  theme?: "light" | "dark";
}

interface QuickShortcut {
  id: string;
  name: string;
  templateIds: string[];
}

export const Home: React.FC<HomeProps> = ({
  onNewTemplate,
  onOpenTemplateDialog,
  onOpenMultipleTemplates,
  onPrintTemplates,
  onUpdateDatabaseConfig,
  onAutoTriggerPrint,
  onReprint,

  dbConnected,
  dbName,
  activePrinter,
  onSelectPrinter,
  printers,
  onSavePrinterSettings,
  theme = "dark",
}) => {
  const electronAPI = useElectronAPI();
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "history">("dashboard");
  const [shortcuts, setShortcuts] = useState<QuickShortcut[]>(() => {
    try {
      const saved = localStorage.getItem("barcode_studio_shortcuts");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showAddShortcutModal, setShowAddShortcutModal] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedShortcutIds, setSelectedShortcutIds] = useState<string[]>([]);
  const [showConfirmDeleteModal, setShowConfirmDeleteModal] = useState(false);
  const [newShortcutName, setNewShortcutName] = useState("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [savedUserTemplates, setSavedUserTemplates] = useState<LabelTemplate[]>(() => {
    try {
      const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
      return savedStr ? JSON.parse(savedStr) : [];
    } catch {
      return [];
    }
  });
  const [templateToDelete, setTemplateToDelete] = useState<LabelTemplate | null>(null);

  const translateOldId = (id: string): string => {
    if (id === "spine-75-38" || id === "t-spine-std") return defaultTemplates[0]?.id || "t-spine-std";
    if (id === "pocket-100-80" || id === "t-pocket-std") return defaultTemplates[1]?.id || "t-pocket-std";
    return id;
  };

  const loadSavedTemplates = () => {
    const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
    if (savedStr) {
      try {
        setSavedUserTemplates(JSON.parse(savedStr));
      } catch (e) {
        console.error(e);
      }
    } else {
      setSavedUserTemplates([]);
    }
  };

  const loadShortcuts = () => {
    try {
      const saved = localStorage.getItem("barcode_studio_shortcuts");
      setShortcuts(saved ? JSON.parse(saved) : []);
    } catch (e) {
      setShortcuts([]);
    }
  };

  useEffect(() => {
    loadSavedTemplates();
  }, [showAddShortcutModal]);

  useEffect(() => {
    const handleUpdate = () => {
      loadSavedTemplates();
      loadShortcuts();
      try {
        const stored = localStorage.getItem("barcode_studio_pinned_templates");
        setPinnedIds(stored ? JSON.parse(stored) : []);
      } catch { }
    };

    handleUpdate();

    window.addEventListener("storage", handleUpdate);
    window.addEventListener("bcs-data-updated", handleUpdate);
    return () => {
      window.removeEventListener("storage", handleUpdate);
      window.removeEventListener("bcs-data-updated", handleUpdate);
    };
  }, []);

  const handleConfirmDeleteTemplate = () => {
    if (!templateToDelete) return;
    const id = templateToDelete.id;

    // Remove from saved templates in localStorage
    const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
    let userSaved: LabelTemplate[] = [];
    if (savedStr) {
      try {
        userSaved = JSON.parse(savedStr);
      } catch (e) {
        console.error(e);
      }
    }
    const updated = userSaved.filter((t) => t.id !== id);
    localStorage.setItem("windows_barcode_studio_saved_templates", JSON.stringify(updated));
    setSavedUserTemplates(updated);

    // Remove from shortcut selection if selected
    setSelectedTemplateIds((prev) => prev.filter((item) => item !== id));

    // Remove from pinned templates if pinned
    setPinnedIds((prev) => {
      const next = prev.filter((item) => item !== id);
      localStorage.setItem("barcode_studio_pinned_templates", JSON.stringify(next));
      return next;
    });

    // Remove from existing shortcuts
    setShortcuts((prev) => {
      const next = prev.map((s) => ({
        ...s,
        templateIds: s.templateIds.filter((tId) => tId !== id),
      })).filter((s) => s.templateIds.length > 0);
      localStorage.setItem("barcode_studio_shortcuts", JSON.stringify(next));
      return next;
    });

    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("bcs-data-updated"));
    setTemplateToDelete(null);
  };

  const combinedTemplates = [...savedUserTemplates, ...defaultTemplates].filter(
    (item, index, self) => self.findIndex((t) => t.id === item.id) === index,
  );

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("barcode_studio_pinned_templates");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const stored = localStorage.getItem("barcode_studio_pinned_templates");
        setPinnedIds(stored ? JSON.parse(stored) : []);
      } catch { }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const pinnedTemplates = combinedTemplates.filter((t) => pinnedIds.includes(t.id));

  const handleUnpinTemplate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = prev.filter((item) => item !== id);
      localStorage.setItem("barcode_studio_pinned_templates", JSON.stringify(next));
      return next;
    });
  };

  // Load and initialize shortcuts
  useEffect(() => {
    const saved = localStorage.getItem("barcode_studio_shortcuts");
    if (saved) {
      try {
        setShortcuts(JSON.parse(saved));
      } catch (e) {
        setShortcuts(getInitialShortcuts());
      }
    } else {
      const initial = getInitialShortcuts();
      setShortcuts(initial);
      localStorage.setItem("barcode_studio_shortcuts", JSON.stringify(initial));
    }
  }, []);

  const getInitialShortcuts = (): QuickShortcut[] => {
    return [];
  };

  const handleCreateShortcut = () => {
    if (!newShortcutName.trim() || selectedTemplateIds.length === 0) return;

    const newShortcut: QuickShortcut = {
      id: `sc-${Math.random().toString(36).substring(2, 9)}`,
      name: newShortcutName.trim(),
      templateIds: selectedTemplateIds,
    };

    const nextShortcuts = [...shortcuts, newShortcut];
    setShortcuts(nextShortcuts);
    localStorage.setItem(
      "barcode_studio_shortcuts",
      JSON.stringify(nextShortcuts),
    );
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("bcs-data-updated"));

    // Reset fields
    setNewShortcutName("");
    setSelectedTemplateIds([]);
    setShowAddShortcutModal(false);
  };

  const handleConfirmDelete = () => {
    const nextShortcuts = shortcuts.filter(
      (s) => !selectedShortcutIds.includes(s.id),
    );
    setShortcuts(nextShortcuts);
    localStorage.setItem(
      "barcode_studio_shortcuts",
      JSON.stringify(nextShortcuts),
    );
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("bcs-data-updated"));

    // Reset delete modes
    setSelectedShortcutIds([]);
    setIsDeleteMode(false);
    setShowConfirmDeleteModal(false);
  };

  const handleToggleDeleteMode = () => {
    if (isDeleteMode) {
      setIsDeleteMode(false);
      setSelectedShortcutIds([]);
    } else {
      setIsDeleteMode(true);
      setSelectedShortcutIds([]);
    }
  };

  const handleOpenShortcut = (shortcut: QuickShortcut) => {
    let freshSaved: LabelTemplate[] = [];
    try {
      const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
      if (savedStr) freshSaved = JSON.parse(savedStr);
    } catch { }
    const freshCombined = [...freshSaved, ...defaultTemplates].filter(
      (item, index, self) => self.findIndex((t) => t.id === item.id) === index,
    );

    const matchedTemplates = shortcut.templateIds
      .map((id) => {
        const translatedId = translateOldId(id);
        return (
          freshCombined.find((t) => t.id === translatedId) ||
          freshCombined.find((t) => t.id === id) ||
          freshCombined.find((t) => t.name === id)
        );
      })
      .filter((t): t is LabelTemplate => !!t);

    if (matchedTemplates.length === 0) return;

    if (onOpenMultipleTemplates) {
      const clonedTemplates = matchedTemplates.map((t) =>
        prepareTemplateForLoadOrImport(t, { forceNewElementIds: true })
      );
      onOpenMultipleTemplates(clonedTemplates);
    } else {
      // Fallback
      onOpenTemplateDialog();
    }
  };

  const handleToggleTemplateSelection = (id: string) => {
    setSelectedTemplateIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleLoadTemplateFromFileForShortcut = async () => {
    try {
      const dialogRes = await electronAPI.showOpenDialog({
        title: "Import Barcode Studio Layout Templates",
        filters: [
          { name: "Barcode Studio Files (*.bcs, *.json)", extensions: ["bcs", "json"] }
        ],
        properties: ["openFile", "multiSelections"]
      });

      if (!dialogRes.canceled && dialogRes.filePaths.length > 0) {
        const importedTemplates: LabelTemplate[] = [];
        for (const filePath of dialogRes.filePaths) {
          const readRes = await electronAPI.readTemplateFile(filePath);
          if (readRes.success && readRes.content) {
            const filename = filePath.split(/[\\/]/).pop() || filePath;
            const newTemplate = deserializeTemplateFromFile(readRes.content, {
              isImport: true,
            });
            if (!newTemplate.name || newTemplate.name === "Untitled Template") {
              newTemplate.name = `Imported ${filename.replace(".bcs", "").replace(".json", "")}`;
            }
            importedTemplates.push(newTemplate);
          }
        }

        if (importedTemplates.length > 0) {
          const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
          let userSaved: LabelTemplate[] = [];
          if (savedStr) {
            try { userSaved = JSON.parse(savedStr); } catch (err) { }
          }
          const importedIds = new Set(importedTemplates.map((t) => t.id));
          userSaved = [...importedTemplates.map((t) => deepClone(t)), ...userSaved.filter((t) => !importedIds.has(t.id))];
          localStorage.setItem("windows_barcode_studio_saved_templates", JSON.stringify(userSaved));
          window.dispatchEvent(new Event("storage"));
          window.dispatchEvent(new CustomEvent("bcs-data-updated"));

          setSavedUserTemplates(userSaved);
          setSelectedTemplateIds((prev) => {
            const next = [...prev];
            importedTemplates.forEach((t) => {
              if (!next.includes(t.id)) next.push(t.id);
            });
            return next;
          });
        }
      }
    } catch (err: any) {
      alert(`Error loading files: ${err.message}`);
    }
  };

  return (
    <div className="flex h-full w-full bg-metro-app text-metro-primary overflow-hidden select-none font-sans">
      {/* Modern Sidebar Navigation */}
      {!showSettings && (
        <div className="bg-metro-panel border-r border-metro-border flex flex-col justify-between py-6 px-4 w-60 shrink-0 shadow-lg">
          <div className="space-y-1">
            <button
              onClick={() => {
                setShowSettings(false);
                setActiveTab("dashboard");
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-xs font-bold text-left ${!showSettings && activeTab === "dashboard"
                ? "bg-metro-accent/10 text-metro-accent"
                : "hover:bg-metro-header text-metro-secondary hover:text-metro-primary cursor-pointer"
                }`}
            >
              <Layout className="w-4 h-4 shrink-0" />
              <span>Home</span>
            </button>

            <button
              onClick={onNewTemplate}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-metro-header text-metro-secondary hover:text-metro-primary text-xs font-semibold text-left transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Create Layout</span>
            </button>

            <button
              onClick={() => {
                setShowSettings(false);
                setActiveTab("history");
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-xs font-bold text-left ${!showSettings && activeTab === "history"
                ? "bg-metro-accent/10 text-metro-accent"
                : "hover:bg-metro-header text-metro-secondary hover:text-metro-primary cursor-pointer"
                }`}
            >
              <History className="w-4 h-4 shrink-0" />
              <span>History</span>
            </button>
          </div>

          {/* Selected Printer Widget / Settings button */}
          <div className="pt-6 border-t border-metro-border relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${showSettings
                ? "bg-metro-accent/10 text-metro-accent font-bold"
                : "hover:bg-metro-header text-metro-secondary hover:text-metro-primary border border-transparent hover:border-metro-border/50 font-semibold"
                }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="text-xs">Settings</span>
            </button>
          </div>
        </div>
      )}

      {showSettings ? (
        <SettingsView
          dbConnected={dbConnected}
          dbName={dbName}
          onUpdateDatabaseConfig={onUpdateDatabaseConfig || (() => { })}
          onAutoTriggerPrint={onAutoTriggerPrint}
          activePrinter={activePrinter}
          onSelectPrinter={onSelectPrinter}
          printers={printers}
          onSavePrinterSettings={onSavePrinterSettings}
          theme={theme}
          onBack={() => setShowSettings(false)}
        />
      ) : activeTab === "history" ? (
        <HistoryView
          theme={theme}
          onReprint={onReprint}
        />
      ) : (
        /* Main launch space */
        <div className="flex-1 p-8 flex flex-col gap-6 overflow-y-auto">
          {/* Modern Header Banner (Ensuring logo and app name appear exactly once) */}
          <div
            className={`relative overflow-hidden p-6 md:p-8 rounded-2xl shadow-xl flex flex-col md:flex-row items-center gap-6 justify-between shrink-0 transition-all duration-300 ${theme === "light"
              ? "bg-gradient-to-r from-indigo-50 via-slate-50 to-indigo-100/50 border border-indigo-200/60 shadow-indigo-100/40"
              : "bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-950 border border-slate-800/80"
              }`}
          >
            <div className="absolute -right-10 -top-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute -left-10 -bottom-10 w-48 h-48 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none"></div>

            <div className="space-y-3 z-10">
              <h2
                className={`text-2xl md:text-3xl font-extrabold tracking-tight font-display transition-colors ${theme === "light" ? "text-indigo-950" : "text-white"
                  }`}
              >
                BarCode Studio
              </h2>
              <p
                className={`text-xs md:text-sm max-w-xl leading-relaxed transition-colors ${theme === "light"
                  ? "text-slate-600 font-medium"
                  : "text-slate-300"
                  }`}
              >
                Create, calibrate, and batch-print professional catalog barcodes
                and spine labels directly linked with your active SQL Server
                database.
              </p>
            </div>

            <div
              onClick={() => {
                const url = "https://barcodestudio.vercel.app/";
                if (electronAPI?.openExternal) {
                  electronAPI.openExternal(url);
                } else {
                  window.open(url, "_blank");
                }
              }}
              title="Click to visit BarCode Studio website - barcodestudio.vercel.app"
              className={`shrink-0 z-10 p-4 rounded-2xl border shadow-lg transition-all duration-300 cursor-pointer group hover:scale-105 hover:border-indigo-500/60 ${theme === "light"
                ? "bg-white/95 border-indigo-200/50 hover:shadow-indigo-100"
                : "bg-slate-900/80 border-slate-800/60 hover:shadow-indigo-900/20"
                }`}
            >
              <img
                src={logoUrl}
                className="w-20 h-20 rounded-xl shadow-xl object-contain group-hover:scale-105 transition-transform duration-300"
                alt="BarCode Studio App Icon"
              />
            </div>
          </div>

          {/* Dynamic Launch Actions (Takes space of 2 cards only in a 3-column grid) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 shrink-0">
            <div
              onClick={onNewTemplate}
              className="group relative p-5 bg-metro-panel/50 hover:bg-metro-panel border border-metro-border hover:border-indigo-500/50 transition-all duration-300 cursor-pointer rounded-2xl shadow-md hover:shadow-indigo-500/5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300">
                  <Plus className="w-5 h-5" />
                </div>
              </div>
              <h3 className="font-bold text-sm text-metro-primary mb-1.5">
                Create New Label
              </h3>
              <p className="text-[11px] text-metro-secondary leading-normal">
                Design a custom barcode template. Specify exact physical label
                dimensions in millimeters.
              </p>
            </div>

            <div
              onClick={onOpenTemplateDialog}
              className="group relative p-5 bg-metro-panel/50 hover:bg-metro-panel border border-metro-border hover:border-emerald-500/50 transition-all duration-300 cursor-pointer rounded-2xl shadow-md hover:shadow-emerald-500/5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300">
                  <FolderOpen className="w-5 h-5" />
                </div>
              </div>
              <h3 className="font-bold text-sm text-metro-primary mb-1.5">
                Open Template
              </h3>
              <p className="text-[11px] text-metro-secondary leading-normal">
                Restore your previously saved design or browse for a .bcs
                layout file on your computer.
              </p>
            </div>

            {/* Spacer to align 2 columns with the 3 columns of shortcuts below */}
            <div className="hidden lg:block"></div>
          </div>

          {/* ── Pinned Templates ──────────────────────────────────────────── */}
          {pinnedTemplates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                  <Pin className="w-3 h-3 text-amber-400 fill-amber-400" />
                </div>
                <h3 className="text-xs font-extrabold text-metro-primary tracking-tight">
                  Pinned Templates
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {pinnedTemplates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onOpenMultipleTemplates && onOpenMultipleTemplates([t])}
                    className="group relative cursor-pointer rounded-xl border border-amber-500/40 hover:border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 transition-all duration-200 p-4 shadow-sm"
                  >
                    <button
                      onClick={(e) => handleUnpinTemplate(t.id, e)}
                      className="absolute top-3 right-3 p-1 rounded hover:bg-amber-500/20 text-amber-400 transition-colors cursor-pointer"
                      title="Unpin from Homescreen"
                    >
                      <Pin className="w-3.5 h-3.5 fill-amber-400" />
                    </button>

                    <div className="flex items-start gap-3 pr-6">
                      <div
                        className="shrink-0 rounded border border-metro-border bg-white shadow-sm"
                        style={{
                          width: 40,
                          height: Math.max(20, Math.round(40 * (t.heightMm / t.widthMm))),
                          borderRadius: (t.cornerRadiusMm ?? 0) > 0 ? 4 : 2,
                        }}
                      >
                        <div className="w-full h-full flex flex-col justify-between p-0.5 opacity-60">
                          <div className="flex gap-0.5 justify-between">
                            <div className="h-1 w-1/3 bg-black/30 rounded-sm" />
                          </div>
                          <div className="flex gap-px items-end h-3 px-0.5">
                            {Array.from({ length: 12 }).map((_, i) => (
                              <div
                                key={i}
                                className="flex-1 bg-black"
                                style={{ height: `${40 + (i % 3) * 20}%`, opacity: i % 2 === 0 ? 1 : 0 }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-metro-primary truncate group-hover:text-amber-500 transition-colors">
                          {t.name}
                        </p>
                        <p className="text-[10px] text-metro-secondary font-mono mt-0.5">
                          {t.widthMm} × {t.heightMm} mm
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-1 text-[10px] font-bold text-amber-400 group-hover:text-amber-300 transition-colors">
                      <ChevronRight className="w-3 h-3" />
                      Open Pinned Layout
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Built-in Templates ──────────────────────────────────────────── */}
          {defaultTemplates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                  <Tag className="w-3 h-3 text-amber-400" />
                </div>
                <h3 className="text-xs font-extrabold text-metro-primary tracking-tight">
                  Built-in Templates
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {defaultTemplates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onOpenMultipleTemplates && onOpenMultipleTemplates([t])}
                    className="group relative cursor-pointer rounded-xl border border-metro-border hover:border-amber-500/50 bg-metro-panel/50 hover:bg-metro-panel transition-all duration-200 p-4 shadow-sm hover:shadow-amber-500/5"
                  >
                    {/* Mini sticker preview */}
                    <div className="flex items-start gap-3">
                      <div
                        className="shrink-0 rounded border border-metro-border bg-white dark:bg-white shadow-sm"
                        style={{
                          width: 40,
                          height: Math.round(40 * (t.heightMm / t.widthMm)),
                          borderRadius: (t.cornerRadiusMm ?? 0) > 0 ? 4 : 2,
                        }}
                      >
                        {/* Barcode preview lines */}
                        <div className="w-full h-full flex flex-col justify-between p-0.5 opacity-60">
                          <div className="flex gap-0.5 justify-between">
                            <div className="h-1 w-1/3 bg-black/30 rounded-sm" />
                            <div className="h-1 w-1/4 bg-black/30 rounded-sm" />
                          </div>
                          <div className="flex gap-px items-end h-4 px-0.5">
                            {Array.from({ length: 18 }).map((_, i) => (
                              <div
                                key={i}
                                className="flex-1 bg-black"
                                style={{ height: `${40 + (i % 3) * 20}%`, opacity: i % 2 === 0 ? 1 : 0 }}
                              />
                            ))}
                          </div>
                          <div className="h-1 w-2/3 bg-black/20 rounded-sm" />
                          <div className="h-2 w-full bg-black/10 rounded-sm" />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-metro-primary truncate group-hover:text-amber-500 transition-colors">
                          {t.name}
                        </p>
                        <p className="text-[10px] text-metro-secondary font-mono mt-0.5">
                          {t.widthMm} × {t.heightMm} mm
                        </p>
                        <p className="text-[9px] text-metro-secondary mt-1">
                          {t.columns ?? 1} col{(t.columns ?? 1) > 1 ? "s" : ""} · {t.elements.length} elements · {(t.elements.find(e => e.type === "barcode")?.barcodeType ?? "Code-128").toUpperCase()}
                        </p>
                      </div>
                    </div>

                    {/* Open label */}
                    <div className="mt-3 flex items-center gap-1 text-[10px] font-bold text-metro-secondary group-hover:text-amber-500 transition-colors">
                      <ChevronRight className="w-3 h-3" />
                      Open in Designer
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}


          {/* Quick Design Shortcuts section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-metro-accent/15 border border-metro-accent/25 flex items-center justify-center">
                  <Layers className="w-3 h-3 text-metro-accent" />
                </div>
                <h3 className="text-xs font-extrabold text-metro-primary tracking-tight">
                  Quick Shortcuts
                </h3>
              </div>

              <div className="flex items-center gap-2">
                {/* Delete/Cancel Toggle button */}
                {shortcuts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isDeleteMode && selectedShortcutIds.length > 0) {
                        setShowConfirmDeleteModal(true);
                      } else {
                        handleToggleDeleteMode();
                      }
                    }}
                    className={`px-3 py-1.5 border rounded-lg font-bold transition-all flex items-center justify-center cursor-pointer ${isDeleteMode
                      ? selectedShortcutIds.length > 0
                        ? "bg-red-600 hover:bg-red-700 text-white border-red-600 shadow-md shadow-red-600/15"
                        : "bg-red-500 text-white border-red-500 hover:bg-red-600"
                      : "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white"
                      }`}
                    title={
                      isDeleteMode
                        ? selectedShortcutIds.length > 0
                          ? "Delete Selected"
                          : "Cancel Delete Mode"
                        : "Select Shortcuts to Delete"
                    }
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    {isDeleteMode && selectedShortcutIds.length > 0 && (
                      <span className="text-[10px]">
                        Delete ({selectedShortcutIds.length})
                      </span>
                    )}
                    {isDeleteMode && selectedShortcutIds.length === 0 && (
                      <span className="text-[10px]">Cancel</span>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowAddShortcutModal(true);
                    setIsDeleteMode(false);
                    setSelectedShortcutIds([]);
                  }}
                  className="text-[10px] bg-metro-accent/10 border border-metro-accent/20 hover:bg-metro-accent hover:text-white text-metro-accent px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Create Shortcut Set</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shortcuts.map((shortcut) => {
                const isGroup = shortcut.templateIds.length > 1;
                const isSelectedForDelete = selectedShortcutIds.includes(
                  shortcut.id,
                );

                const handleCardClick = () => {
                  if (isDeleteMode) {
                    setSelectedShortcutIds((prev) =>
                      prev.includes(shortcut.id)
                        ? prev.filter((id) => id !== shortcut.id)
                        : [...prev, shortcut.id],
                    );
                  } else {
                    handleOpenShortcut(shortcut);
                  }
                };

                return (
                  <div
                    key={shortcut.id}
                    onClick={handleCardClick}
                    className={`group relative p-5 transition-all duration-300 cursor-pointer rounded-2xl flex flex-col justify-between gap-5 border ${isDeleteMode
                      ? isSelectedForDelete
                        ? "bg-red-500/10 border-red-500 shadow-lg shadow-red-500/10"
                        : "bg-metro-panel/20 border-metro-border/50 hover:border-red-500/50 hover:bg-metro-panel/40"
                      : "bg-metro-panel/60 hover:bg-metro-panel border-metro-border/80 hover:border-indigo-500/60 hover:shadow-xl hover:shadow-indigo-500/10"
                      }`}
                  >
                    {/* Tick box visual representation if isDeleteMode is enabled */}
                    {isDeleteMode && (
                      <div className="absolute top-4 right-4 z-20">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelectedForDelete
                            ? "bg-red-500 border-red-500 text-white scale-110"
                            : "border-metro-secondary/50 bg-metro-input hover:border-red-400"
                            }`}
                        >
                          {isSelectedForDelete && (
                            <Check className="w-3 h-3 stroke-[3]" />
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-4 items-center">
                      {/* Visual representation card/stack */}
                      <div className="relative shrink-0 w-16 h-16 flex items-center justify-center bg-metro-input/50 rounded-xl border border-metro-border/50 group-hover:bg-indigo-500/5 group-hover:border-indigo-500/20 transition-colors">
                        {isGroup ? (
                          // Stack of cards icon
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-10 h-8 bg-metro-header border border-metro-border rounded-lg shadow-sm rotate-6 translate-x-1.5 transition-transform group-hover:rotate-12 group-hover:translate-x-2.5"></div>
                            <div className="w-10 h-8 bg-indigo-500/20 border border-indigo-500/30 rounded-lg shadow-md -rotate-3 -translate-x-1 transition-transform group-hover:-rotate-6 group-hover:-translate-x-2"></div>
                            <div className="w-10 h-8 bg-metro-panel border border-metro-border/90 rounded-lg shadow-lg flex items-center justify-center z-10 transition-transform group-hover:scale-105">
                              <Layers className="w-5 h-5 text-indigo-400 drop-shadow-sm" />
                            </div>
                          </div>
                        ) : (
                          // Single miniature label style
                          <div className="w-12 h-9 bg-white/90 rounded-lg shadow-sm border border-slate-300 flex items-center justify-center overflow-hidden transition-transform group-hover:scale-105">
                            <div className="w-[85%] h-[75%] border border-slate-200 bg-slate-50 rounded flex flex-col justify-between p-1">
                              <div className="w-full h-[1px] bg-slate-300 rounded-full"></div>
                              <div className="flex gap-1 items-center">
                                <div className="w-1/2 h-2 flex gap-0.5 bg-slate-800 rounded-sm">
                                  <div className="w-[1px] h-full bg-white/60"></div>
                                  <div className="w-[1px] h-full bg-white/60"></div>
                                </div>
                                <div className="w-1/3 h-1.5 bg-indigo-500/40 rounded-sm"></div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5 min-w-0 flex-1">
                        <span
                          className={`text-sm font-extrabold truncate block leading-tight transition-colors ${isDeleteMode && isSelectedForDelete
                            ? "text-red-400"
                            : "text-metro-primary group-hover:text-metro-accent"
                            }`}
                        >
                          {shortcut.name}
                        </span>

                        {/* Subtitle listing items */}
                        <span className="text-[10px] text-metro-secondary block font-mono font-medium truncate">
                          {isGroup
                            ? `${shortcut.templateIds.length} Label Designs Bundled`
                            : combinedTemplates.find(
                              (t) => t.id === translateOldId(shortcut.templateIds[0]),
                            )?.widthMm +
                            " × " +
                            combinedTemplates.find(
                              (t) => t.id === translateOldId(shortcut.templateIds[0]),
                            )?.heightMm +
                            " mm"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-metro-border/60 pt-4 mt-1 text-[10px] font-bold uppercase font-mono tracking-wider">
                      <span
                        className={`px-2.5 py-1 rounded-md ${isGroup
                          ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                          : "bg-metro-input border border-metro-border text-metro-secondary"
                          }`}
                      >
                        {isGroup ? "Group Set" : "Single Layout"}
                      </span>

                      <div className="flex items-center gap-2.5">
                        {!isDeleteMode ? (
                          <>
                            {onPrintTemplates && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  let freshSaved: LabelTemplate[] = [];
                                  try {
                                    const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
                                    if (savedStr) freshSaved = JSON.parse(savedStr);
                                  } catch { }
                                  const freshCombined = [...freshSaved, ...defaultTemplates].filter(
                                    (item, index, self) => self.findIndex((t) => t.id === item.id) === index,
                                  );
                                  const templatesToPrint = shortcut.templateIds
                                    .map((id) => {
                                      const translatedId = translateOldId(id);
                                      return (
                                        freshCombined.find((t) => t.id === translatedId) ||
                                        freshCombined.find((t) => t.id === id) ||
                                        freshCombined.find((t) => t.name === id)
                                      );
                                    })
                                    .filter(Boolean) as LabelTemplate[];
                                  onPrintTemplates(templatesToPrint);
                                }}
                                className="text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20 px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all text-[10px] font-extrabold group/btn"
                              >
                                Print <PrinterIcon className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
                              </button>
                            )}
                            <span className="text-metro-secondary hover:text-indigo-400 flex items-center gap-1 transition-colors px-2 py-1">
                              Open <ExternalLink className="w-3 h-3" />
                            </span>
                          </>
                        ) : (
                          <span
                            className={`flex items-center gap-1.5 transition-colors font-extrabold ${isSelectedForDelete ? "text-red-400" : "text-metro-secondary"}`}
                          >
                            {isSelectedForDelete ? "Selected to Delete" : "Click to Select"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Big Plus card placeholder if there is less than 2 cards */}
              {shortcuts.length < 2 && (
                <div
                  onClick={() => {
                    setShowAddShortcutModal(true);
                    setIsDeleteMode(false);
                    setSelectedShortcutIds([]);
                  }}
                  className="group p-4 bg-metro-panel/10 hover:bg-metro-panel/30 border-2 border-dashed border-metro-border hover:border-metro-accent/50 hover:shadow-lg transition-all duration-300 cursor-pointer rounded-2xl flex flex-col items-center justify-center gap-3 min-h-[120px] text-center"
                >
                  <div className="p-2 bg-metro-accent/10 text-metro-accent rounded-full group-hover:scale-110 transition-transform">
                    <Plus className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-metro-primary block">
                      Group Multiple Designs
                    </span>
                    <span className="text-[10px] text-metro-secondary max-w-[180px] block mt-0.5">
                      Bundle your templates into a single-click card layout
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>


        </div>
      )}

      {/* --- ADD SHORTCUT MODAL DIALOG --- */}
      {showAddShortcutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 animate-fade-in p-4">
          <div className="bg-metro-panel border border-metro-border rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-metro-border pb-3">
              <div className="flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-metro-accent" />
                <h3 className="text-sm font-bold text-metro-primary">
                  Create Quick Shortcut Set
                </h3>
              </div>
              <button
                onClick={() => setShowAddShortcutModal(false)}
                className="p-1 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider font-mono">
                  Shortcut or Bundle Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Spine & Pocket Combo Set"
                  value={newShortcutName}
                  onChange={(e) => setNewShortcutName(e.target.value)}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-3.5 py-2 text-xs font-semibold focus:border-metro-accent focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider font-mono block">
                  Select Design Layouts to Bind
                </label>
                <div className="flex justify-between items-center -mt-1 mb-2">
                  <span className="text-[9px] text-metro-secondary">
                    Check multiple templates to group them together.
                  </span>
                  <button
                    type="button"
                    onClick={handleLoadTemplateFromFileForShortcut}
                    className="text-[9px] text-metro-accent hover:underline flex items-center gap-1 cursor-pointer font-bold bg-transparent border-0 outline-none"
                  >
                    <Upload className="w-2.5 h-2.5" />
                    <span>Load from File...</span>
                  </button>
                </div>

                <div className="border border-metro-border rounded-xl bg-metro-input/40 p-2.5 max-h-48 overflow-y-auto space-y-1">
                  {combinedTemplates.length === 0 ? (
                    <div className="py-6 text-center text-metro-secondary text-xs">
                      No design layouts available.
                    </div>
                  ) : (
                    combinedTemplates.map((t) => {
                      const isSelected = selectedTemplateIds.includes(t.id);
                      const isDefault = defaultTemplates.some((dt) => dt.id === t.id);
                      return (
                        <div
                          key={t.id}
                          onClick={() => handleToggleTemplateSelection(t.id)}
                          className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs font-semibold transition-all cursor-pointer group ${isSelected
                            ? "bg-metro-accent/15 text-metro-accent border border-metro-accent/30"
                            : "hover:bg-metro-header text-metro-secondary hover:text-metro-primary border border-transparent"
                            }`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="block text-xs font-bold truncate">
                                {t.name}
                              </span>
                              {isDefault && (
                                <span className="text-[8px] px-1.5 py-0.2 rounded font-bold font-mono tracking-wide bg-metro-header text-metro-secondary shrink-0">
                                  SYSTEM
                                </span>
                              )}
                            </div>
                            <span className="block text-[9px] opacity-75 font-mono">
                              {t.widthMm}x{t.heightMm} mm
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!isDefault && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setTemplateToDelete(t);
                                }}
                                className="p-1.5 rounded-lg text-metro-secondary hover:text-red-400 hover:bg-red-500/10 opacity-70 hover:opacity-100 transition-all cursor-pointer"
                                title="Delete template"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isSelected
                                ? "bg-metro-accent border-metro-accent text-white"
                                : "border-metro-border bg-metro-input"
                                }`}
                            >
                              {isSelected && <Check className="w-2.5 h-2.5" />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-metro-border">
              <button
                onClick={() => setShowAddShortcutModal(false)}
                className="px-3.5 py-1.5 rounded-xl border border-metro-border text-metro-secondary hover:text-metro-primary text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateShortcut}
                disabled={
                  !newShortcutName.trim() || selectedTemplateIds.length === 0
                }
                className="px-4 py-1.5 rounded-xl bg-metro-accent text-white shadow-md shadow-metro-accent/15 hover:bg-metro-accent/95 disabled:opacity-50 text-xs font-bold cursor-pointer"
              >
                Create Shortcut
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRM DELETE SHORTCUTS MODAL --- */}
      {showConfirmDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 animate-fade-in p-4">
          <div className="bg-metro-panel border border-metro-border rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-2.5 bg-red-500/10 rounded-xl">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-metro-primary">
                  Delete Shortcuts
                </h3>
                <p className="text-[10px] text-metro-secondary mt-0.5">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <p className="text-xs text-metro-secondary leading-relaxed">
              Are you sure you want to delete the{" "}
              <span className="font-extrabold text-metro-primary">
                {selectedShortcutIds.length}
              </span>{" "}
              selected shortcut set(s)?
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmDeleteModal(false)}
                className="px-3.5 py-1.5 rounded-xl border border-metro-border text-metro-secondary hover:text-metro-primary text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md shadow-red-600/15 cursor-pointer transition-all"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRM DELETE TEMPLATE MODAL --- */}
      <ConfirmModal
        isOpen={!!templateToDelete}
        title="Delete Template"
        message={`Are you sure you want to delete "${templateToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        theme={theme}
        onConfirm={handleConfirmDeleteTemplate}
        onClose={() => setTemplateToDelete(null)}
      />


    </div>
  );
};
