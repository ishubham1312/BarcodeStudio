import React, { useEffect } from "react";
import { AlertTriangle, Trash2, Info, X } from "lucide-react";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "info";
  theme?: "light" | "dark";
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  theme = "dark",
  onConfirm,
  onClose,
}) => {
  const isLight = theme === "light";

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onConfirm]);

  if (!isOpen) return null;

  const renderIcon = () => {
    if (variant === "danger") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 shadow-lg shadow-red-500/10">
          <Trash2 className="w-6 h-6 animate-pulse" />
        </div>
      );
    }
    if (variant === "warning") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-lg shadow-amber-500/10">
          <AlertTriangle className="w-6 h-6" />
        </div>
      );
    }
    return (
      <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-500/10">
        <Info className="w-6 h-6" />
      </div>
    );
  };

  const getConfirmButtonStyles = () => {
    if (variant === "danger") {
      return "bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white shadow-lg shadow-red-600/25 border border-red-500/30";
    }
    if (variant === "warning") {
      return "bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white shadow-lg shadow-amber-600/25 border border-amber-500/30";
    }
    return "bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white shadow-lg shadow-indigo-600/25 border border-indigo-500/30";
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop with Smooth Blur */}
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-md transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className={`relative w-full max-w-md rounded-3xl p-6 shadow-2xl transition-all animate-in zoom-in-95 duration-200 border ${isLight
          ? "bg-white/95 border-slate-200/90 text-slate-900 shadow-slate-300/50"
          : "bg-[#0f172a]/95 border-indigo-500/20 text-slate-100 shadow-indigo-950/50"
          }`}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-2 rounded-xl transition-colors ${isLight
            ? "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            : "text-slate-400 hover:text-white hover:bg-slate-800/60"
            }`}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col gap-4">
          {/* Header Row */}
          <div className="flex items-center gap-4">
            {renderIcon()}
            <div className="flex flex-col gap-0.5">
              <h3
                className={`text-base font-bold tracking-tight ${isLight ? "text-slate-900" : "text-white"
                  }`}
              >
                {title}
              </h3>
            </div>
          </div>

          {/* Message Body */}
          <p
            className={`text-xs leading-relaxed ${isLight ? "text-slate-600" : "text-slate-300"
              }`}
          >
            {message}
          </p>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-slate-200/20">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${isLight
                ? "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                : "bg-slate-800/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60"
                }`}
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${getConfirmButtonStyles()}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
