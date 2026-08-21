import React, { useEffect, useState } from "react";
import { RotateCcw, CheckCircle2, X, FileCode, Sparkles } from "lucide-react";

export interface RestartAppModalProps {
  isOpen: boolean;
  fileName?: string;
  theme?: "light" | "dark";
  onRestart: () => void | Promise<void>;
  onClose: () => void;
}

export const RestartAppModal: React.FC<RestartAppModalProps> = ({
  isOpen,
  fileName,
  theme = "dark",
  onRestart,
  onClose,
}) => {
  const isLight = theme === "light";
  const [isRestarting, setIsRestarting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsRestarting(false);
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && !isRestarting) {
        e.preventDefault();
        handleRestartClick();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isRestarting, onClose]);

  if (!isOpen) return null;

  const handleRestartClick = async () => {
    setIsRestarting(true);
    try {
      await onRestart();
    } catch {
      setIsRestarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      {/* Backdrop with Blur */}
      <div
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        className={`relative w-full max-w-md rounded-3xl p-6 shadow-2xl transition-all animate-in zoom-in-95 duration-200 border ${
          isLight
            ? "bg-white/95 border-slate-200/90 text-slate-900 shadow-slate-300/50"
            : "bg-[#0f172a]/95 border-indigo-500/25 text-slate-100 shadow-indigo-950/60"
        }`}
      >
        {/* Subtle Ambient Glow */}
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-2 rounded-xl transition-colors cursor-pointer ${
            isLight
              ? "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-500/10">
                <RotateCcw className={`w-6 h-6 text-indigo-400 ${isRestarting ? "animate-spin" : ""}`} />
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 items-center justify-center">
                  <CheckCircle2 className="w-3 h-3 text-white" />
                </span>
              </span>
            </div>

            <div className="flex flex-col gap-0.5 pr-6">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />
                  Import Complete
                </span>
              </div>
              <h3 className={`text-base font-bold tracking-tight mt-1 ${isLight ? "text-slate-900" : "text-white"}`}>
                Restart Application
              </h3>
            </div>
          </div>

          {/* Description */}
          <p className={`text-xs leading-relaxed ${isLight ? "text-slate-600" : "text-slate-300"}`}>
            Configuration settings have been successfully imported. To apply all database profiles, active printers, label templates, and background services cleanly, please restart Barcode Studio.
          </p>

          {/* File Badge Pill (if filename provided) */}
          {fileName && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono border ${
                isLight
                  ? "bg-slate-50 border-slate-200 text-slate-700"
                  : "bg-slate-900/80 border-slate-700/60 text-slate-300"
              }`}
            >
              <FileCode className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="truncate flex-1 font-medium">{fileName}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 mt-2 pt-3 border-t border-slate-200/20">
            <button
              type="button"
              onClick={onClose}
              disabled={isRestarting}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isLight
                  ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                  : "bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60"
              }`}
            >
              Later
            </button>
            <button
              type="button"
              onClick={handleRestartClick}
              disabled={isRestarting}
              className="px-5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer bg-gradient-to-r from-indigo-600 via-indigo-500 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/30 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRestarting ? "animate-spin" : ""}`} />
              <span>{isRestarting ? "Restarting..." : "Restart App"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
