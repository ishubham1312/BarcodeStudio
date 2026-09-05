import React, { useState, useEffect, useMemo } from "react";
import { 
  History, 
  Search, 
  Download, 
  Upload,
  RefreshCw, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  XCircle,
  FileText,
  Mail,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { PrintHistoryRecord } from "../types";
import { ConfirmModal } from "./ConfirmModal";

interface HistoryViewProps {
  theme?: "light" | "dark";
  onReprint?: (accessionNoStr: string) => void;
}

const formatAccessionNumbers = (accStr: string): string => {
  if (!accStr) return "";
  const parts = accStr.split(",").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  
  const order: string[] = [];
  const counts: { [key: string]: number } = {};
  
  parts.forEach(p => {
    if (!counts[p]) {
      order.push(p);
      counts[p] = 0;
    }
    counts[p]++;
  });
  
  return order.map(p => {
    if (p === "...") return "...";
    if (counts[p] > 1) {
      return `${p}(${counts[p]})`;
    }
    return p;
  }).join(", ");
};

export const HistoryView: React.FC<HistoryViewProps> = ({ 
  theme = "dark", 
  onReprint 
}) => {
  const [history, setHistory] = useState<PrintHistoryRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "manual" | "email">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "success" | "failed">("all");
  
  // Date Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Sender Filter
  const [senderFilter, setSenderFilter] = useState("all");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Load history from localStorage
  const loadHistory = () => {
    try {
      const savedStr = localStorage.getItem("print_history");
      if (savedStr) {
        setHistory(JSON.parse(savedStr));
      } else {
        setHistory([]);
      }
    } catch (e) {
      console.error("Failed to load print history:", e);
    }
  };

  useEffect(() => {
    loadHistory();

    // Listen for background updates
    const handleUpdate = () => loadHistory();
    window.addEventListener("print-history-updated", handleUpdate);
    return () => {
      window.removeEventListener("print-history-updated", handleUpdate);
    };
  }, []);

  // Get unique email senders dynamically
  const uniqueSenders = useMemo(() => {
    const senders = new Set<string>();
    history.forEach(record => {
      if (record.senderEmail && record.method === "email") {
        senders.add(record.senderEmail);
      }
    });
    return Array.from(senders).sort();
  }, [history]);

  // Helper to extract clean accession numbers from a history record
  const getRecordAccessions = (record: PrintHistoryRecord): string[] => {
    if (record.accessionNumbers && record.accessionNumbers.length > 0) {
      return record.accessionNumbers.map((s) => String(s).trim()).filter(Boolean);
    }
    if (!record.accessionNo) return [];
    return record.accessionNo
      .split(/[\r\n,;\t]+/)
      .map((s) => s.trim().replace(/\.\.\.$/, ""))
      .filter(Boolean);
  };

  // Compute Statistics - strictly count UNIQUE books (accession numbers)
  // Any repeated accession number is counted only once (deduplicated)
  const stats = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const todayAccessions = new Set<string>();
    const monthAccessions = new Set<string>();
    const totalAccessions = new Set<string>();
    let totalStickersCount = 0;

    history.forEach((record) => {
      if (record.status === "success") {
        const accs = getRecordAccessions(record);
        accs.forEach((acc) => {
          totalAccessions.add(acc.toLowerCase());
        });

        totalStickersCount += record.totalStickers || record.copies || 1;

        const recordDate = new Date(record.timestamp);
        const recordDateStr = record.timestamp.split("T")[0];

        if (recordDateStr === todayStr) {
          accs.forEach((acc) => todayAccessions.add(acc.toLowerCase()));
        }

        if (recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear) {
          accs.forEach((acc) => monthAccessions.add(acc.toLowerCase()));
        }
      }
    });

    return {
      todayCount: todayAccessions.size,
      monthCount: monthAccessions.size,
      totalCount: totalAccessions.size,
      totalStickersCount,
    };
  }, [history]);

  // Filtered History
  const filteredHistory = useMemo(() => {
    return history.filter(record => {
      // Search text mapping (accession number, sender email, templates, printer name)
      const matchesSearch = 
        record.accessionNo.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.senderEmail && record.senderEmail.toLowerCase().includes(searchQuery.toLowerCase())) ||
        record.printerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.templates.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesMethod = methodFilter === "all" || record.method === methodFilter;
      const matchesStatus = statusFilter === "all" || record.status === statusFilter;

      // Sender email filter
      const matchesSender = senderFilter === "all" || record.senderEmail === senderFilter;

      // Date range filter
      let matchesDate = true;
      if (startDate || endDate) {
        const recordDateStr = record.timestamp.split("T")[0]; // YYYY-MM-DD
        if (startDate && recordDateStr < startDate) {
          matchesDate = false;
        }
        if (endDate && recordDateStr > endDate) {
          matchesDate = false;
        }
      }

      return matchesSearch && matchesMethod && matchesStatus && matchesSender && matchesDate;
    });
  }, [history, searchQuery, methodFilter, statusFilter, senderFilter, startDate, endDate]);

  // Paginated History
  const paginatedHistory = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredHistory.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredHistory, currentPage]);

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage) || 1;

  // Export to CSV
  const handleExportCSV = () => {
    try {
      const headers = ["Timestamp", "Method", "Sender Email", "Accession Numbers", "Book Count (Unique)", "Total Stickers", "Templates Used", "Printer Name", "Status", "Error Message"];
      const rows = filteredHistory.map(r => [
        new Date(r.timestamp).toLocaleString(),
        r.method.toUpperCase(),
        r.senderEmail || "N/A",
        `"${r.accessionNo}"`,
        r.bookCount || r.accessionNumbers?.length || r.copies || 1,
        r.totalStickers || r.copies || 1,
        `"${r.templates.join(", ")}"`,
        r.printerName,
        r.status.toUpperCase(),
        r.error || ""
      ]);

      const csvContent = "data:text/csv;charset=utf-8," 
        + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `print_history_${new Date().toISOString().split("T")[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      alert("Failed to export CSV: " + e);
    }
  };

  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Clear History
  const handleClearHistory = () => {
    setShowClearConfirm(true);
  };

  const executeClearHistory = () => {
    localStorage.removeItem("print_history");
    setHistory([]);
    setCurrentPage(1);
  };

  return (
    <div className="flex-1 p-8 flex flex-col gap-6 overflow-y-auto h-full text-xs">
      
      {/* HEADER SECTION */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h2 className={`text-2xl font-extrabold tracking-tight ${theme === "light" ? "text-indigo-950" : "text-white"}`}>
            Print History & Logs
          </h2>
          <p className={`text-xs mt-1 ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
            Monitor stats, filter jobs, and manage logs for manual and email prints.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            disabled={filteredHistory.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/30 disabled:text-indigo-200/50 text-white font-bold transition-all shadow-md shadow-indigo-600/10 cursor-pointer disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            <span>Export to CSV</span>
          </button>
          
          <button
            onClick={handleClearHistory}
            disabled={history.length === 0}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-metro-panel hover:bg-rose-500/10 hover:text-rose-500 border border-metro-border hover:border-rose-500/30 text-metro-secondary font-bold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear Logs</span>
          </button>
        </div>
      </div>

      {/* STATISTICS WIDGETS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
        
        {/* Today stats */}
        <div className={`p-5 rounded-2xl border shadow-md flex items-center justify-between ${
          theme === "light" 
            ? "bg-white border-slate-200/80 shadow-slate-100" 
            : "bg-metro-panel border-metro-border/50"
        }`}>
          <div>
            <span className={`text-[10px] uppercase font-bold tracking-wider ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
              Books Printed Today
            </span>
            <div className={`text-2xl font-black mt-1 ${theme === "light" ? "text-slate-900" : "text-white"}`}>
              {stats.todayCount}
            </div>
            <span className="text-[9px] text-emerald-400 font-semibold mt-1 inline-block">Unique books spooled today</span>
          </div>
          <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        {/* Monthly stats */}
        <div className={`p-5 rounded-2xl border shadow-md flex items-center justify-between ${
          theme === "light" 
            ? "bg-white border-slate-200/80 shadow-slate-100" 
            : "bg-metro-panel border-metro-border/50"
        }`}>
          <div>
            <span className={`text-[10px] uppercase font-bold tracking-wider ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
              Books This Month
            </span>
            <div className={`text-2xl font-black mt-1 ${theme === "light" ? "text-slate-900" : "text-white"}`}>
              {stats.monthCount}
            </div>
            <span className="text-[9px] text-indigo-400 font-semibold mt-1 inline-block">Unique books this calendar month</span>
          </div>
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
            <History className="w-6 h-6" />
          </div>
        </div>

        {/* All-time stats */}
        <div className={`p-5 rounded-2xl border shadow-md flex items-center justify-between ${
          theme === "light" 
            ? "bg-white border-slate-200/80 shadow-slate-100" 
            : "bg-metro-panel border-metro-border/50"
        }`}>
          <div>
            <span className={`text-[10px] uppercase font-bold tracking-wider ${theme === "light" ? "text-slate-500" : "text-slate-400"}`}>
              All-Time Unique Books
            </span>
            <div className={`text-2xl font-black mt-1 ${theme === "light" ? "text-slate-900" : "text-white"}`}>
              {stats.totalCount}
            </div>
            <span className="text-[9px] text-slate-400 font-semibold mt-1 inline-block">
              Deduplicated books ({stats.totalStickersCount} stickers)
            </span>
          </div>
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400">
            <FileText className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* FILTER CONTROL BAR */}
      <div className={`p-4 rounded-2xl border shadow-sm flex flex-col gap-4 shrink-0 ${
        theme === "light" 
          ? "bg-white border-slate-200/80 shadow-slate-100" 
          : "bg-metro-panel border-metro-border/50"
      }`}>
        {/* Row 1: Search & Date Filters */}
        <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center w-full">
          {/* Search Input */}
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-metro-secondary" />
            <input
              type="text"
              placeholder="Search accession, sender, template..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className={`w-full pl-10 pr-4 py-2 rounded-xl border border-metro-border bg-metro-input/40 hover:bg-metro-input hover:border-slate-500/30 focus:border-indigo-500/50 outline-none text-xs text-metro-primary transition-all`}
            />
          </div>

          {/* Date Filter */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <SlidersHorizontal className="w-3.5 h-3.5 text-metro-secondary" />
            <span className="font-semibold text-metro-secondary">Date Range:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                className="px-2.5 py-1.5 rounded-xl border border-metro-border bg-metro-input text-xs text-metro-primary outline-none focus:border-indigo-500 transition-all"
              />
              <span className="text-metro-secondary text-[10px]">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                className="px-2.5 py-1.5 rounded-xl border border-metro-border bg-metro-input text-xs text-metro-primary outline-none focus:border-indigo-500 transition-all"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(""); setEndDate(""); setCurrentPage(1); }}
                  className="px-2.5 py-1 rounded-xl text-[10px] bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 font-bold transition-all cursor-pointer"
                >
                  Clear Date
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Method, Status & Sender Select */}
        <div className="flex flex-wrap items-center gap-5 w-full justify-start border-t border-metro-border/30 pt-3">
          {/* Method Filter */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-metro-secondary">Method:</span>
            <div className="flex rounded-xl bg-metro-input/40 p-0.5 border border-metro-border">
              {(["all", "manual", "email"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => { setMethodFilter(m); setCurrentPage(1); }}
                  className={`px-3 py-1 rounded-lg font-bold capitalize text-[10px] transition-all cursor-pointer ${
                    methodFilter === m
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-metro-secondary hover:text-metro-primary"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-metro-secondary">Status:</span>
            <div className="flex rounded-xl bg-metro-input/40 p-0.5 border border-metro-border">
              {(["all", "success", "failed"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                  className={`px-3 py-1 rounded-lg font-bold capitalize text-[10px] transition-all cursor-pointer ${
                    statusFilter === s
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-metro-secondary hover:text-metro-primary"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Sender Filter */}
          {uniqueSenders.length > 0 && (
            <div className="flex items-center gap-2 ml-auto lg:ml-0">
              <span className="font-semibold text-metro-secondary">Sender Email:</span>
              <select
                value={senderFilter}
                onChange={(e) => { setSenderFilter(e.target.value); setCurrentPage(1); }}
                className="px-3 py-1.5 rounded-xl border border-metro-border bg-metro-input text-[11px] text-metro-primary outline-none focus:border-indigo-500 transition-all cursor-pointer max-w-[250px]"
              >
                <option value="all">All Senders</option>
                {uniqueSenders.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* DATA TABLE VIEW */}
      <div className={`flex-1 rounded-2xl border overflow-hidden flex flex-col min-h-[300px] shadow-sm ${
        theme === "light" 
          ? "bg-white border-slate-200/80 shadow-slate-100/50" 
          : "bg-metro-panel border-metro-border/50"
      }`}>
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className={`border-b border-metro-border uppercase tracking-wider font-bold text-[10px] ${
                theme === "light" ? "bg-slate-50 text-slate-500" : "bg-metro-header text-metro-secondary"
              }`}>
                <th className="py-3.5 px-5">Date & Time</th>
                <th className="py-3.5 px-5">Method</th>
                <th className="py-3.5 px-5">Job Source</th>
                <th className="py-3.5 px-5">Accession(s)</th>
                <th className="py-3.5 px-5 text-center">Books (Accessions)</th>
                <th className="py-3.5 px-5">Printer</th>
                <th className="py-3.5 px-5">Status</th>
                <th className="py-3.5 px-5 text-right">Action</th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-metro-border/40">
              {paginatedHistory.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-metro-secondary">
                    <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <span className="font-bold">No print records found</span>
                    <p className="text-[10px] mt-1 opacity-70">
                      Try updating search filters or run a print job to populate logs.
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedHistory.map((record) => {
                  const dt = new Date(record.timestamp);
                  const dateStr = dt.toLocaleDateString();
                  const timeStr = dt.toLocaleTimeString();

                  return (
                    <tr 
                      key={record.id} 
                      className={`transition-colors hover:bg-metro-input/20`}
                    >
                      <td className="py-3 px-5 font-mono text-[10px] text-metro-secondary leading-normal whitespace-nowrap">
                        <div>{dateStr}</div>
                        <div className="opacity-70 mt-0.5">{timeStr}</div>
                      </td>
                      
                      <td className="py-3 px-5">
                        <span className={`inline-flex items-center gap-1 font-bold ${
                          record.method === "email" ? "text-purple-400" : "text-sky-400"
                        }`}>
                          {record.method === "email" ? <Mail className="w-3.5 h-3.5 text-purple-400" /> : <FileText className="w-3.5 h-3.5 text-sky-400" />}
                          <span className="capitalize">{record.method}</span>
                        </span>
                      </td>
                      
                      <td className="py-3 px-5 font-medium text-metro-primary whitespace-pre-wrap break-words max-w-[200px]">
                        {record.senderEmail ? (
                          <span className="text-purple-300 font-bold" title={record.senderEmail}>
                            {record.senderEmail}
                          </span>
                        ) : (
                          <span className="text-slate-500 font-semibold">Manual User</span>
                        )}
                      </td>
                      
                      <td className="py-3 px-5 font-mono text-[10px] whitespace-pre-wrap break-all text-metro-primary max-w-[300px]" title={record.accessionNo}>
                        {formatAccessionNumbers(record.accessionNo)}
                      </td>
                      
                      <td className="py-3 px-5 text-center font-bold text-metro-primary">
                        <div>
                          {record.bookCount || record.accessionNumbers?.length || record.copies || 1} Books
                        </div>
                        {record.totalStickers && record.totalStickers !== (record.bookCount || record.copies) && (
                          <div className="text-[9px] font-normal text-metro-secondary">
                            ({record.totalStickers} stickers)
                          </div>
                        )}
                      </td>
                      
                      <td className="py-3 px-5 text-metro-secondary whitespace-pre-wrap break-words max-w-[150px]" title={record.printerName}>
                        {record.printerName}
                      </td>
                      
                      <td className="py-3 px-5">
                        {record.status === "success" ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>Success</span>
                          </span>
                        ) : (
                          <span 
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 font-bold border border-rose-500/20 cursor-help"
                            title={record.error || "Unknown print error"}
                          >
                            <XCircle className="w-3 h-3 text-rose-400" />
                            <span>Failed</span>
                          </span>
                        )}
                      </td>
                      
                      <td className="py-3 px-5 text-right">
                        {onReprint && (
                          <button
                            onClick={() => onReprint(record.accessionNo)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-metro-input border border-metro-border hover:border-indigo-500/50 hover:bg-indigo-500/10 text-metro-secondary hover:text-indigo-400 transition-all cursor-pointer font-bold"
                            title="Preload this job's accession numbers into Print View"
                          >
                            <RefreshCw className="w-3 h-3 animate-hover" />
                            <span>Reprint</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION SECTION */}
        {totalPages > 1 && (
          <div className="h-12 border-t border-metro-border px-5 flex items-center justify-between shrink-0 select-none">
            <span className="text-[10px] text-metro-secondary">
              Showing <span className="font-bold text-metro-primary">{((currentPage - 1) * itemsPerPage) + 1}</span> to{" "}
              <span className="font-bold text-metro-primary">{Math.min(currentPage * itemsPerPage, filteredHistory.length)}</span> of{" "}
              <span className="font-bold text-metro-primary">{filteredHistory.length}</span> print logs
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded bg-metro-input border border-metro-border disabled:opacity-40 text-metro-primary transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <div className="px-3 text-[10px] font-bold text-metro-primary">
                Page {currentPage} of {totalPages}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded bg-metro-input border border-metro-border disabled:opacity-40 text-metro-primary transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        theme={theme}
        title="Clear Print History"
        message="Are you sure you want to permanently clear all print history? This action cannot be undone."
        confirmText="Clear History"
        cancelText="Cancel"
        variant="danger"
        onConfirm={executeClearHistory}
        onClose={() => setShowClearConfirm(false)}
      />
    </div>
  );
};
