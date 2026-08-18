import React, { useState, useEffect, useRef } from "react";
import { X, FolderOpen, Upload, Check, Trash2, Search, FileJson, CheckSquare, Square, Info } from "lucide-react";
import { LabelTemplate } from "../types";
import { defaultTemplates } from "../data/mockData";
import { useElectronAPI } from "../hooks/useElectronAPI";
import { deepClone, deserializeTemplateFromFile, prepareTemplateForLoadOrImport } from "../utils/templateSerialization";
import { ConfirmModal } from "./ConfirmModal";

interface OpenTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenTemplates: (templates: LabelTemplate[]) => void;
  theme?: "light" | "dark";
}

export const OpenTemplateModal: React.FC<OpenTemplateModalProps> = ({
  isOpen,
  onClose,
  onOpenTemplates,
  theme = "dark",
}) => {
  const electronAPI = useElectronAPI();
  const [savedTemplates, setSavedTemplates] = useState<LabelTemplate[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenNativeDialog = async () => {
    try {
      const dialogRes = await electronAPI.showOpenDialog({
        title: "Open Barcode Studio Layout Templates",
        filters: [
          { name: "Barcode Studio Files (*.bcs, *.json)", extensions: ["bcs", "json"] }
        ],
        properties: ["openFile", "multiSelections"]
      });

      if (!dialogRes.canceled && dialogRes.filePaths.length > 0) {
        const importedTemplates: LabelTemplate[] = [];
        const importedIds = new Set<string>();

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
            importedIds.add(newTemplate.id);
          }
        }

        if (importedTemplates.length > 0) {
          const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
          let userSaved: LabelTemplate[] = [];
          if (savedStr) {
            try { userSaved = JSON.parse(savedStr); } catch (err) { }
          }
          userSaved = [...importedTemplates.map((t) => deepClone(t)), ...userSaved.filter((t) => !importedIds.has(t.id))];
          localStorage.setItem("windows_barcode_studio_saved_templates", JSON.stringify(userSaved));

          setSavedTemplates((prev) => [...importedTemplates, ...prev.filter((t) => !importedIds.has(t.id))]);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            importedIds.forEach((id) => next.add(id));
            return next;
          });
        }
      }
    } catch (err: any) {
      alert(`Error loading files: ${err.message}`);
    }
  };

  // Load saved templates on open
  useEffect(() => {
    if (isOpen) {
      const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
      let userSaved: LabelTemplate[] = [];
      if (savedStr) {
        try {
          userSaved = JSON.parse(savedStr);
        } catch (e) {
          console.error("Failed to parse saved templates", e);
        }
      }
      
      // Ensure all templates have unique IDs and merge
      const allMerged = [...userSaved];
      
      // Add default templates if they aren't already represented in the list
      defaultTemplates.forEach((def) => {
        if (!allMerged.some((t) => t.id === def.id)) {
          allMerged.push(def as LabelTemplate);
        }
      });

      setSavedTemplates(allMerged.map((t) => prepareTemplateForLoadOrImport(t)));
      setSelectedIds(new Set());
      setSearchQuery("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredTemplates = savedTemplates.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleOpenSelected = () => {
    const selected = savedTemplates.filter((t) => selectedIds.has(t.id));
    if (selected.length > 0) {
      const clonedSelected = selected.map((t) =>
        prepareTemplateForLoadOrImport(t, { forceNewElementIds: true })
      );
      onOpenTemplates(clonedSelected);
      onClose();
    }
  };

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const handleDeleteTemplate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    
    // Do not allow deleting system default templates
    if (defaultTemplates.some((dt) => dt.id === id)) {
      alert("System default templates cannot be deleted.");
      return;
    }

    setDeleteTargetId(id);
  };

  const executeDeleteTemplate = () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
    let userSaved: LabelTemplate[] = [];
    if (savedStr) {
      try {
        userSaved = JSON.parse(savedStr);
      } catch (e) {}
    }
    
    const updated = userSaved.filter((t) => t.id !== id);
    localStorage.setItem("windows_barcode_studio_saved_templates", JSON.stringify(updated));
    
    try {
      const pinnedStr = localStorage.getItem("barcode_studio_pinned_templates");
      if (pinnedStr) {
        const pinned: string[] = JSON.parse(pinnedStr);
        const nextPinned = pinned.filter((pId) => pId !== id);
        localStorage.setItem("barcode_studio_pinned_templates", JSON.stringify(nextPinned));
      }
    } catch {}

    setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDeleteTargetId(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList: File[] = Array.from(files);
    const importedTemplates: LabelTemplate[] = [];
    const importedIds = new Set<string>();

    let processedCount = 0;
    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (parsed && typeof parsed === "object") {
            const newTemplate: LabelTemplate = deserializeTemplateFromFile(parsed, { isImport: true });
            if (!newTemplate.name || newTemplate.name === "Untitled Template") {
              newTemplate.name = `Imported ${file.name.replace(".bcs", "").replace(".json", "")}`;
            }
            importedTemplates.push(newTemplate);
            importedIds.add(newTemplate.id);
          }
        } catch (err) {
          console.error("Failed to parse file", file.name, err);
        } finally {
          processedCount++;
          if (processedCount === fileList.length && importedTemplates.length > 0) {
            const savedStr = localStorage.getItem("windows_barcode_studio_saved_templates");
            let userSaved: LabelTemplate[] = [];
            if (savedStr) {
              try { userSaved = JSON.parse(savedStr); } catch (err) { }
            }
            userSaved = [...importedTemplates.map((t) => deepClone(t)), ...userSaved.filter((t) => !importedIds.has(t.id))];
            localStorage.setItem("windows_barcode_studio_saved_templates", JSON.stringify(userSaved));

            setSavedTemplates((prev) => [...importedTemplates, ...prev.filter((t) => !importedIds.has(t.id))]);
            setSelectedIds((prev) => {
              const next = new Set(prev);
              importedIds.forEach((id) => next.add(id));
              return next;
            });
          }
        }
      };
      reader.readAsText(file);
    });

    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
      <div 
        className={`w-full max-w-2xl rounded-2xl border flex flex-col max-h-[85vh] shadow-2xl transition-all duration-300 ${
          theme === "light"
            ? "bg-white border-slate-200 text-slate-800"
            : "bg-[#0b0c10] border-metro-border text-metro-primary"
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          theme === "light" ? "border-slate-200 bg-slate-50" : "border-metro-border bg-metro-panel"
        } rounded-t-2xl`}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-500/15 rounded-lg text-indigo-500">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-base tracking-tight">Open Templates</h2>
              <p className="text-[10px] text-slate-500 font-medium">
                Choose one or more templates to load into the multi-tab designer workspace
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              theme === "light" ? "hover:bg-slate-200 text-slate-400 hover:text-slate-700" : "hover:bg-metro-header text-metro-secondary hover:text-metro-primary"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className={`p-4 border-b flex flex-col sm:flex-row gap-3 items-center justify-between ${
          theme === "light" ? "border-slate-200" : "border-metro-border"
        }`}>
          {/* Search */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search templates by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-9 pr-4 py-2 text-xs rounded-xl border outline-none transition-all ${
                theme === "light"
                  ? "border-slate-200 bg-slate-100/50 focus:border-indigo-500 focus:bg-white text-slate-800 placeholder-slate-400"
                  : "border-metro-border bg-metro-input focus:border-indigo-500 focus:bg-metro-input text-metro-primary placeholder-metro-secondary"
              }`}
            />
          </div>

          {/* Import JSON file */}
          <button
            onClick={window.electronAPI ? handleOpenNativeDialog : () => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm hover:shadow transition-all cursor-pointer w-full sm:w-auto justify-center"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Load from Files (.bcs, .json)</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".bcs,.json"
            multiple
            className="hidden"
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredTemplates.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <FileJson className="w-12 h-12 text-slate-400/50 mb-3" />
              <p className="text-xs font-semibold text-slate-500">No templates found</p>
              <p className="text-[10px] text-slate-400">
                {searchQuery ? "Try checking your spelling or search terms." : "Load a template JSON file from your machine to get started."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredTemplates.map((t) => {
                const isSelected = selectedIds.has(t.id);
                const isDefault = defaultTemplates.some((dt) => dt.id === t.id);

                return (
                  <div
                    key={t.id}
                    onClick={() => toggleSelect(t.id)}
                    className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer relative group flex items-start gap-3 select-none ${
                      isSelected
                        ? theme === "light"
                          ? "border-indigo-500 bg-indigo-50/40 shadow-xs"
                          : "border-indigo-500/60 bg-indigo-500/5 shadow-xs"
                        : theme === "light"
                        ? "border-slate-200 hover:border-slate-300 bg-slate-50/50 hover:bg-slate-50"
                        : "border-metro-border hover:border-metro-secondary bg-metro-panel/40 hover:bg-metro-panel/60"
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <div className={`mt-0.5 shrink-0 ${isSelected ? "text-indigo-500" : "text-slate-400"}`}>
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 fill-indigo-500/10" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </div>

                    {/* Template details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-xs truncate block max-w-[80%]">
                          {t.name}
                        </span>
                        {isDefault && (
                          <span className={`text-[8px] px-1.5 py-0.2 rounded-full font-bold font-mono tracking-wide scale-90 ${
                            theme === "light" ? "bg-slate-100 text-slate-500" : "bg-metro-header text-metro-secondary"
                          }`}>
                            SYSTEM
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono mt-1 block">
                        {t.widthMm} × {t.heightMm} mm ({t.shape || "rectangle"})
                      </span>
                      {t.lastModified && (
                        <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">
                          Modified: {new Date(t.lastModified).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {/* Actions: delete */}
                    {!isDefault && (
                      <button
                        onClick={(e) => handleDeleteTemplate(e, t.id)}
                        className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all absolute right-2 top-2 ${
                          theme === "light"
                            ? "hover:bg-red-50 text-slate-400 hover:text-red-600"
                            : "hover:bg-red-500/10 text-metro-secondary hover:text-red-400"
                        }`}
                        title="Delete template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t flex items-center justify-between rounded-b-2xl ${
          theme === "light" ? "border-slate-200 bg-slate-50" : "border-metro-border bg-metro-panel"
        }`}>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
            <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>Select one or more templates. Click Open to load in designer tabs.</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                theme === "light"
                  ? "border-slate-200 hover:bg-slate-100 text-slate-600"
                  : "border-metro-border hover:bg-metro-header text-metro-secondary hover:text-metro-primary"
              }`}
            >
              Cancel
            </button>
            <button
              disabled={selectedIds.size === 0}
              onClick={handleOpenSelected}
              className={`px-4 py-2 rounded-xl text-xs font-bold text-white transition-all cursor-pointer flex items-center gap-1.5 ${
                selectedIds.size === 0
                  ? "bg-indigo-600/50 cursor-not-allowed opacity-50"
                  : "bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/10"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              <span>Open Selected ({selectedIds.size})</span>
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteTargetId !== null}
        theme={theme}
        title="Delete Saved Template"
        message="Are you sure you want to delete this saved template? This action cannot be undone."
        confirmText="Delete Template"
        cancelText="Cancel"
        variant="danger"
        onConfirm={executeDeleteTemplate}
        onClose={() => setDeleteTargetId(null)}
      />
    </div>
  );
};
