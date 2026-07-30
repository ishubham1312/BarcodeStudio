import React, { useEffect, useState, useMemo } from "react";
import { Copy, LogOut, AlertTriangle, Info, TerminalSquare } from "lucide-react";
import errorImg from "../../assets/error.png";

interface LockScreenProps {
  onCloseApp: () => void;
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

export const LockScreen: React.FC<LockScreenProps> = ({ onCloseApp }) => {
  const [copied, setCopied] = useState(false);

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
    const errorCode = 'ERR_NAPI_' + genHex(4).toUpperCase();
    const sessionId = genHex(8) + '-' + genHex(4) + '-' + genHex(4) + '-' + genHex(4) + '-' + genHex(12);
    const buildHash = genHex(40);
    return { pid, tid, ts, crashAddr, heapAddr, f1, f2, f3, f4, f5, f6, modBase, errorCode, sessionId, buildHash };
  }, []);

  const fullReport = useMemo(() => `Barcode Studio — Unhandled Fatal Exception Report
Generated : ${meta.ts} UTC
Session ID: ${meta.sessionId}
Build Hash: ${meta.buildHash}
PID: ${meta.pid}  TID: ${meta.tid}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FATAL: SIGSEGV at ${meta.crashAddr}
Error Code : ${meta.errorCode}
HRESULT    : 0xC0000005  (STATUS_ACCESS_VIOLATION — read from ${meta.heapAddr})

Origin: better-sqlite3.node — BarcodeStudioDB::StatementWorker::Execute
  NAPI_ASSERT failed: napi_get_value_string_utf8 → non-ok status
  V8 heap: write barrier violation during GC compaction pass
  Dangling pointer deref in concurrent transaction finalize

Native Stack:
  #0  ${meta.f1}  better-sqlite3.node!StatementWorker::Execute+0x1a4
  #1  ${meta.f2}  better-sqlite3.node!Napi::AsyncWorker::OnWorkComplete+0x38
  #2  ${meta.f3}  node.exe!node::ThreadPoolWork::AfterWork+0x5c
  #3  ${meta.f4}  node.exe!uv__work_done+0x8b
  #4  ${meta.f5}  node.exe!uv__async_io+0x47
  #5  ${meta.f6}  node.exe!uv_run+0x162

JS Frame:
  at binding.Database.transaction.immediate (internal/barcode_db_adapter.js:214:22)
  at DriversyncWorker.flushPendingRecords (src/workers/driversync.worker.js:89:14)
  at process.processTicksAndRejections (node:internal/process/task_queues:95:5)

Resolution:
  This fault persists across reinstalls. No third-party tool or registry
  edit can resolve it. Contact the software developer with this report.`, [meta]);

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

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-8 select-none">
      <div className="flex flex-col md:flex-row w-full max-w-4xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden max-h-[92vh]"
           style={{ background: "#fff" }}>

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
                Fatal Native Exception — Renderer Host Process
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
                Barcode Studio has crashed due to an internal component failure.
              </h2>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                A fatal access violation occurred inside a proprietary native database binding.
                The renderer host process attempted to dereference an invalid heap address
                during a concurrent transaction flush, causing an unrecoverable memory fault.
              </p>
              <p className="text-[11px] text-slate-700 font-semibold leading-relaxed">
                This condition{" "}
                <span className="text-red-600 font-extrabold">cannot be resolved</span>{" "}
                by reinstalling the application, repairing system files, or modifying
                Windows settings. The fault is encoded in the application's internal
                runtime state and persists across reinstalls.
              </p>

              {/* ── Key/value badges ── */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  { label: "Error Code",    value: meta.errorCode,      color: "text-amber-600" },
                  { label: "HRESULT",       value: "0xC0000005",        color: "text-red-600"   },
                  { label: "Fault Address", value: meta.crashAddr,      color: "text-red-600"   },
                  { label: "Heap Read At",  value: meta.heapAddr,       color: "text-slate-700" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="block text-[8px] font-extrabold text-slate-400 uppercase tracking-widest mb-0.5">{label}</span>
                    <code className={`text-[10px] font-mono font-bold ${color}`}>{value}</code>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Info box ── */}
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex gap-2.5 bg-blue-50 border border-blue-200 rounded-xl p-3.5">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[10.5px] text-blue-800 leading-relaxed">
                  The session state that caused this fault has been encoded with ID{" "}
                  <code className="font-mono font-bold text-blue-700 bg-blue-100 px-1 py-0.5 rounded text-[9.5px]">{meta.sessionId}</code>.
                  {" "}The original developer must supply a patched build targeting this specific session.{" "}
                  <span className="font-bold">Contact the software developer and provide the full crash report below.</span>
                </p>
              </div>
            </div>

            {/* ── Terminal crash dump ── */}
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-2">
                <TerminalSquare className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">Native Crash Dump</span>
              </div>

              {/* Terminal window chrome */}
              <div className="rounded-xl overflow-hidden border border-slate-800 shadow-lg">
                {/* traffic lights bar */}
                <div className="bg-slate-800 px-3 py-2 flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 opacity-80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-60" />
                  <span className="ml-3 text-[9px] text-slate-400 font-mono">barcode_studio — crash_dump.log</span>
                </div>

                {/* terminal body */}
                <div className="bg-slate-950 px-4 py-3 font-mono text-[9px] leading-5 space-y-1 overflow-x-auto">
                  <p><span className="text-slate-500">[{meta.ts}]</span> <span className="text-red-400 font-bold">FATAL</span> <span className="text-slate-300">SIGSEGV received — beginning crash dump</span></p>
                  <p><span className="text-slate-500">module  </span> <span className="text-amber-300">better-sqlite3.node</span> <span className="text-slate-500">base={meta.modBase}</span></p>
                  <p><span className="text-slate-500">fault   </span> <span className="text-red-400">{meta.crashAddr}</span> <span className="text-slate-500">STATUS_ACCESS_VIOLATION read {meta.heapAddr}</span></p>
                  <p><span className="text-slate-500">code    </span> <span className="text-amber-400">{meta.errorCode}</span> <span className="text-slate-500">HRESULT=0xC0000005</span></p>
                  <div className="border-t border-slate-800 my-1.5" />
                  <p className="text-slate-500 text-[8.5px] uppercase tracking-widest">— native stack —</p>
                  {[
                    `#0  ${meta.f1}  better-sqlite3.node!StatementWorker::Execute+0x1a4`,
                    `#1  ${meta.f2}  better-sqlite3.node!Napi::AsyncWorker::OnWorkComplete+0x38`,
                    `#2  ${meta.f3}  node.exe!node::ThreadPoolWork::AfterWork+0x5c`,
                    `#3  ${meta.f4}  node.exe!uv__work_done+0x8b`,
                    `#4  ${meta.f5}  node.exe!uv__async_io+0x47`,
                    `#5  ${meta.f6}  node.exe!uv_run+0x162`,
                  ].map((line, i) => (
                    <p key={i} className="text-slate-400">{line}</p>
                  ))}
                  <div className="border-t border-slate-800 my-1.5" />
                  <p className="text-slate-500 text-[8.5px] uppercase tracking-widest">— js frame —</p>
                  <p className="text-slate-400">{"  "}at binding.Database.transaction.immediate <span className="text-slate-500">(internal/barcode_db_adapter.js:214:22)</span></p>
                  <p className="text-slate-400">{"  "}at DriversyncWorker.flushPendingRecords <span className="text-slate-500">(src/workers/driversync.worker.js:89:14)</span></p>
                  <p className="text-slate-400">{"  "}at process.processTicksAndRejections <span className="text-slate-500">(node:internal/process/task_queues:95:5)</span></p>
                  <div className="border-t border-slate-800 my-1.5" />
                  <p><span className="text-slate-500">session </span><span className="text-slate-300 text-[8.5px]">{meta.sessionId}</span></p>
                  <p><span className="text-slate-500">build   </span><span className="text-slate-300 text-[8.5px]">{meta.buildHash}</span></p>
                  <p className="text-red-500 font-bold mt-1">Crash dump complete. Process terminated.</p>
                </div>
              </div>
            </div>

          </div>{/* end scroll */}

          {/* ── Footer actions ── */}
          <div className="flex flex-col sm:flex-row gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 hover:border-indigo-400 bg-white hover:bg-indigo-50 text-xs font-bold text-slate-700 hover:text-indigo-700 transition-all cursor-pointer shadow-sm"
            >
              <Copy className="w-3.5 h-3.5 text-indigo-500" />
              <span>{copied ? "Copied!" : "Copy Full Crash Report"}</span>
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

        </div>{/* end right panel */}
      </div>
    </div>
  );
};
