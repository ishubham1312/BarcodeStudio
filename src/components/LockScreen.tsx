import React, { useEffect, useState, useMemo } from "react";
import { Copy, LogOut, AlertTriangle, ShieldAlert, Laptop, User, Radio } from "lucide-react";
import errorImg from "../../assets/error.png";
import { LockScreenState } from "../services/directAccessService";

interface LockScreenProps {
  onCloseApp: () => void;
  info?: Partial<LockScreenState>;
}

function genHex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
}
function genAddr(): string {
  return '0x' + genHex(12);
}
function genPid(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}
function genTid(): number {
  return 1000 + Math.floor(Math.random() * 8000);
}
function genTimestamp(): string {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', '') + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export const LockScreen: React.FC<LockScreenProps> = ({ onCloseApp, info }) => {
  const [copied, setCopied] = useState(false);
  const [copiedHwid, setCopiedHwid] = useState(false);

  const isNotice = info?.type === "admin_notice";

  const meta = useMemo(() => {
    const pid       = genPid();
    const tid       = genTid();
    const ts        = genTimestamp();
    const crashAddr = genAddr();
    const heapAddr  = genAddr();
    const f1        = genAddr();
    const f2        = genAddr();
    const f3        = genAddr();
    const f4        = genAddr();
    const f5        = genAddr();
    const f6        = genAddr();
    const modBase   = '0x' + genHex(8).toUpperCase();
    const errorCode = 'ERR_CONN_TIMEOUT_0x8401';
    const sessionId = genHex(8) + '-' + genHex(4) + '-' + genHex(4) + '-' + genHex(4) + '-' + genHex(12);
    const buildHash = genHex(40);
    return { pid, tid, ts, crashAddr, heapAddr, f1, f2, f3, f4, f5, f6, modBase, errorCode, sessionId, buildHash };
  }, []);

  const fullReport = useMemo(() => {
    if (isNotice) {
      return `Barcode Studio — Workstation Notice
Device ID : ${info?.hardwareId || "N/A"}
Hostname  : ${info?.hostname || "N/A"}
Username  : ${info?.username || "N/A"}
Status    : Deactivated by Administration
Notice    : ${info?.message || "The administration has deactivated this application / workstation."}`;
    }

    const errorMsg = info?.message || "Database connection error (ERR_CONN_TIMEOUT_0x8401): Remote cluster unreachable. Retrying in background...";

    return `Barcode Studio — Unhandled Fatal Exception Report
Generated : ${meta.ts} UTC
Session ID: ${meta.sessionId}
Build Hash: ${meta.buildHash}
PID: ${meta.pid}  TID: ${meta.tid}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FATAL: System Exception at ${meta.crashAddr}
Error Code : ${meta.errorCode}
Description: ${errorMsg}
HRESULT    : 0xC0000005  (STATUS_CLUSTER_TIMEOUT — read from ${meta.heapAddr})

Origin: backend/cluster_proxy — DriverWorker::Execute
  REMOTE_CLUSTER_ASSERT failed: socket_connect → TIMEOUT
  V8 heap: network barrier timeout during cluster sync
  Dangling connection pipe in background heartbeat listener

Native Stack:
  #0  ${meta.f1}  cluster_proxy.node!ConnectionWorker::Execute+0x1a4
  #1  ${meta.f2}  cluster_proxy.node!Napi::AsyncWorker::OnWorkComplete+0x38
  #2  ${meta.f3}  node.exe!node::ThreadPoolWork::AfterWork+0x5c
  #3  ${meta.f4}  node.exe!uv__work_done+0x8b
  #4  ${meta.f5}  node.exe!uv__async_io+0x47
  #5  ${meta.f6}  node.exe!uv_run+0x162

Resolution:
  Remote cluster unreachable. This fault persists while remote connectivity is halted.
  Please contact your system administrator with this report.`;
  }, [isNotice, info, meta]);

  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F5" || (e.ctrlKey && e.key === "r")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", block, true);
    return () => window.removeEventListener("keydown", block, true);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleCopyHwid = async () => {
    if (!info?.hardwareId) return;
    try {
      await navigator.clipboard.writeText(info.hardwareId);
      setCopiedHwid(true);
      setTimeout(() => setCopiedHwid(false), 2000);
    } catch (err) {
      console.error("Failed to copy HWID:", err);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 1. ADMIN NOTICE: Official Deactivation Screen (MODE 2)
  // ─────────────────────────────────────────────────────────────
  if (isNotice) {
    return (
      <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 md:p-8 select-none">
        <div className="flex flex-col w-full max-w-xl rounded-2xl border border-slate-700/60 bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          
          {/* Header banner */}
          <div className="bg-gradient-to-r from-amber-600 to-amber-700 px-6 py-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/30 flex items-center justify-center border border-amber-300/30">
                <ShieldAlert className="w-5 h-5 text-amber-100" />
              </div>
              <div>
                <h3 className="text-white font-extrabold text-sm tracking-tight">
                  {info?.title || "Application Deactivated"}
                </h3>
                <p className="text-amber-100/80 text-[11px]">Central Enterprise Access Control</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/25 text-[10px] font-semibold text-amber-200 border border-amber-400/20">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span>Direct Toggle Mode</span>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-5">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-xs text-amber-200/90 leading-relaxed font-medium">
                {info?.message || "The administration has deactivated this application / workstation. Please contact your system administrator."}
              </p>
            </div>

            {/* Hardware ID & Workstation info badge */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Device Hardware ID
                </span>
                <button
                  type="button"
                  onClick={handleCopyHwid}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 transition-all cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedHwid ? "Copied!" : "Copy ID"}</span>
                </button>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-center text-sm font-extrabold tracking-wider text-slate-200">
                {info?.hardwareId || "Detecting Hardware..."}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <Laptop className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate">Host: <b className="text-slate-300">{info?.hostname || "Localhost"}</b></span>
                </div>
                <div className="flex items-center gap-1.5 overflow-hidden">
                  <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate">User: <b className="text-slate-300">{info?.username || "Local User"}</b></span>
                </div>
              </div>
            </div>

            {/* Live real-time listening indicator */}
            <div className="flex items-center justify-center gap-2 py-1 text-[11px] font-medium text-slate-400">
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Real-time link active — automatically unlocks when administrator activates.</span>
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 bg-slate-950/50 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition-all cursor-pointer border border-slate-700"
            >
              {copied ? "Copied Details" : "Copy Device Details"}
            </button>
            <button
              type="button"
              onClick={onCloseApp}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-md shadow-red-600/20 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Exit Application</span>
            </button>
          </div>

        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. FAKE ERROR: Realistic System Exception / Crash (MODE 3)
  // ─────────────────────────────────────────────────────────────
  const displayFakeError = info?.message || "Database connection error (ERR_CONN_TIMEOUT_0x8401): Remote cluster unreachable. Retrying in background...";

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-8 select-none">
      <div className="flex flex-col md:flex-row w-full max-w-4xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[92vh] bg-white">

        {/* ── Left: image ── */}
        <div className="md:w-[38%] flex items-stretch justify-center bg-slate-50 border-b md:border-b-0 md:border-r border-slate-200 shrink-0 overflow-hidden">
          <img src={errorImg} alt="Error" className="w-full h-full object-cover" />
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">

          {/* ── Top red bar ── */}
          <div className="bg-red-600 px-6 py-3 flex items-center gap-3 shrink-0">
            <AlertTriangle className="w-4 h-4 text-white shrink-0" />
            <div>
              <p className="text-white font-extrabold text-[11px] uppercase tracking-widest leading-none">
                {info?.title || "System Exception — Remote Cluster Failure"}
              </p>
              <p className="text-red-200 text-[9px] font-mono mt-0.5">
                PID {meta.pid} · TID {meta.tid} · {meta.ts} UTC
              </p>
            </div>
          </div>

          {/* ── Scrollable content ── */}
          <div className="flex-1 overflow-y-auto custom-scrollbar">

            {/* ── Human-readable summary ── */}
            <div className="px-6 py-5 space-y-4 border-b border-slate-100">
              <h2 className="text-base font-extrabold text-slate-900 leading-snug">
                Barcode Studio encountered an unhandled system exception.
              </h2>
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-[11.5px] font-mono text-red-900 leading-relaxed break-words font-semibold">
                {displayFakeError}
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                A fatal cluster gateway timeout occurred inside the distributed sync service.
                The connection proxy attempted to reach remote socket endpoints without receiving an ACK response, causing an unrecoverable runtime exception.
              </p>

              {/* ── Key/value badges ── */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  { label: "Exception Code", value: meta.errorCode, color: "text-amber-600" },
                  { label: "HRESULT",        value: "0xC0000005",        color: "text-red-600"   },
                  { label: "Fault Address",  value: meta.crashAddr,      color: "text-red-600"   },
                  { label: "Remote Socket",  value: meta.heapAddr,       color: "text-slate-700" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-widest mb-0.5">{label}</span>
                    <code className={`text-[10px] font-mono font-bold ${color}`}>{value}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Terminal dump ── */}
            <div className="px-6 py-4">
              <div className="rounded-xl overflow-hidden border border-slate-800 shadow-lg">
                <div className="bg-slate-800 px-3 py-2 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 opacity-80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-60" />
                  <span className="ml-3 text-[9px] text-slate-400 font-mono">barcode_studio — exception_dump.log</span>
                </div>
                <div className="bg-slate-950 px-4 py-3 font-mono text-[9px] leading-5 space-y-1 overflow-x-auto">
                  <p><span className="text-slate-500">[{meta.ts}]</span> <span className="text-red-400 font-bold">FATAL</span> <span className="text-slate-300">SIGSEGV / ERR_CONN_TIMEOUT received</span></p>
                  <p><span className="text-slate-500">fault   </span> <span className="text-red-400">{meta.crashAddr}</span> <span className="text-slate-500">STATUS_CLUSTER_TIMEOUT</span></p>
                  <p><span className="text-slate-500">code    </span> <span className="text-amber-400">{meta.errorCode}</span> <span className="text-slate-500">HRESULT=0xC0000005</span></p>
                  <div className="border-t border-slate-800 my-1.5" />
                  <p className="text-slate-400">{`#0  ${meta.f1}  cluster_proxy!ConnectionWorker::Execute+0x1a4`}</p>
                  <p className="text-slate-400">{`#1  ${meta.f2}  node.exe!node::ThreadPoolWork::AfterWork+0x5c`}</p>
                  <p className="text-slate-400">{`#2  ${meta.f3}  node.exe!uv__work_done+0x8b`}</p>
                  <p className="text-red-500 font-bold mt-1">Remote cluster unreachable. Execution halted.</p>
                </div>
              </div>
            </div>

          </div>

          {/* ── Footer actions ── */}
          <div className="flex flex-col sm:flex-row gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50 text-xs font-bold text-slate-700 hover:text-indigo-700 transition-all cursor-pointer shadow-sm"
            >
              <Copy className="w-3.5 h-3.5 text-indigo-500" />
              <span>{copied ? "Copied!" : "Copy Report"}</span>
            </button>
            <button
              type="button"
              onClick={onCloseApp}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs shadow-md shadow-red-600/20 cursor-pointer transition-all border border-red-600"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Terminate Application</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
