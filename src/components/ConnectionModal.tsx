import React, { useState, useEffect } from 'react';
import { ConnectionProfile, DatabaseRecord } from '../types';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { 
  X, 
  Server, 
  Database, 
  User, 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  FileSpreadsheet, 
  Globe, 
  Lock, 
  Network,
  Cpu,
  ArrowRight,
  ArrowLeft,
  Check,
  Search,
  Activity,
  ChevronRight,
  Table,
  Eye,
  Sliders,
  Sparkles,
  Plus
} from 'lucide-react';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile: ConnectionProfile | null;
  onSaveProfile: (profile: ConnectionProfile) => void;
  onConnect: (profile: ConnectionProfile) => Promise<{ success: boolean; msg: string }>;
  onLoadedRecords?: (records: DatabaseRecord[]) => void;
}

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

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  activeProfile,
  onSaveProfile,
  onConnect,
  onLoadedRecords
}) => {
  const electronAPI = useElectronAPI();
  // Wizard steps: 1 = Parameters, 2 = Choose Table, 3 = Map Headers, 4 = Row Preview Grid
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Connection fields state
  const [dbType, setDbType] = useState<'sqlite' | 'mysql' | 'mssql'>(activeProfile?.dbType || 'sqlite');
  const [name, setName] = useState(activeProfile?.name || 'Local SQLite Library');
  const [server, setServer] = useState(activeProfile?.server || 'localhost');
  const [port, setPort] = useState<number>(activeProfile?.port || 3306);
  const [instance, setInstance] = useState(activeProfile?.instance || '');
  const [database, setDatabase] = useState(activeProfile?.database || 'main');
  const [table, setTable] = useState(activeProfile?.table || 'BOOK_MASTER');
  const [sqlitePath, setSqlitePath] = useState(activeProfile?.sqlitePath || 'barcode_studio_library.db');
  const [authMode, setAuthMode] = useState<'windows' | 'sql'>(activeProfile?.authMode || 'sql');
  const [username, setUsername] = useState(activeProfile?.username || 'sa');
  const [password, setPassword] = useState(activeProfile?.password || '');
  const [trustCert, setTrustCert] = useState(activeProfile?.trustCert ?? true);
  const [encrypt, setEncrypt] = useState(activeProfile?.encrypt ?? false);
  const [uniqueField, setUniqueField] = useState(activeProfile?.uniqueField || 'AccessionNo');

  // Schema mappings state (logicalField -> physicalColumn)
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>(activeProfile?.fieldMappings || {});

  // API Lists
  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [views, setViews] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);

  // Filtering states
  const [tableFilter, setTableFilter] = useState('');
  const [previewFilter, setPreviewFilter] = useState('');
  const [previewPage, setPreviewPage] = useState(0);
  const pageSize = 10;

  // Tree nodes expanded
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    'tables': true,
    'views': false
  });

  // Async states
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);

  // Initialize fields on profile change
  useEffect(() => {
    if (activeProfile) {
      setDbType(activeProfile.dbType || 'sqlite');
      setName(activeProfile.name);
      setServer(activeProfile.server || 'localhost');
      setPort(activeProfile.port || (activeProfile.dbType === 'mysql' ? 3306 : 1433));
      setInstance(activeProfile.instance || '');
      setDatabase(activeProfile.database || 'main');
      setTable(activeProfile.table || '');
      setSqlitePath(activeProfile.sqlitePath || 'barcode_studio_library.db');
      setAuthMode(activeProfile.authMode || 'sql');
      setUsername(activeProfile.username || 'sa');
      setTrustCert(activeProfile.trustCert ?? true);
      setEncrypt(activeProfile.encrypt ?? false);
      setUniqueField(activeProfile.uniqueField || 'AccessionNo');
      setFieldMappings(activeProfile.fieldMappings || {});
    }
  }, [activeProfile, isOpen]);

  // Adjust defaults when dbType changes
  useEffect(() => {
    if (!activeProfile) {
      if (dbType === 'sqlite') {
        setName('Local SQLite Library');
        setDatabase('main');
        setTable('BOOK_MASTER');
      } else if (dbType === 'mysql') {
        setName('Production MySQL Server');
        setPort(3306);
        setDatabase('');
        setTable('');
      } else if (dbType === 'mssql') {
        setName('MS SQL Server Instance');
        setPort(1433);
        setDatabase('');
        setTable('');
      }
    }
  }, [dbType]);

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const buildConfig = () => ({
    dbType,
    server,
    port,
    instance,
    database,
    table,
    sqlitePath,
    authMode,
    username,
    password,
    trustCert,
    encrypt,
    uniqueField
  });

  // API Call: Test Connection & Get Databases
  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const config = buildConfig();
      const data = await electronAPI.dbTest(config);
      
      if (data.success) {
        setTestResult({ success: true, msg: data.message });
        // Retrieve databases
        const dbData = await electronAPI.dbDatabases(config);
        if (dbData.success) {
          setDatabases(dbData.databases);
          if (dbData.databases.length > 0 && !database) {
            setDatabase(dbData.databases[0]);
          }
        }
      } else {
        setTestResult({ success: false, msg: data.message });
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: err.message || 'Network error' });
    } finally {
      setIsTesting(false);
    }
  };

  // API Call: Fetch Tables/Views for the chosen Database
  const handleFetchTables = async () => {
    setIsLoadingMetadata(true);
    try {
      const config = buildConfig();
      const data = await electronAPI.dbTables(config);
      if (data.success) {
        setTables(data.tables || []);
        setViews(data.views || []);
        setStep(2);
      } else {
        alert(`Failed to list tables: ${data.message || 'Error'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  // API Call: Fetch columns & start column mapping
  const handleFetchColumnsAndMap = async (selectedTable: string) => {
    setTable(selectedTable);
    setIsLoadingMetadata(true);
    try {
      const config = { ...buildConfig(), table: selectedTable };
      const data = await electronAPI.dbColumns(config, selectedTable);
      if (data.success) {
        const discoveredCols = data.columns || [];
        setColumns(discoveredCols);

        // Pre-populate mappings logically
        const initialMappings: Record<string, string> = { ...fieldMappings };
        standardLogicalFields.forEach(f => {
          // If already mapped in active profile, preserve it
          if (initialMappings[f.key]) return;

          // Try automatic detection (fuzzy matches)
          const target = discoveredCols.find((c: string) => {
            const cleanC = c.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanK = f.key.toLowerCase().replace(/[^a-z0-9]/g, '');
            // matches like 'ACC_NO' or 'acc_no' to 'AccessionNo'
            return cleanC === cleanK || 
                   cleanC.includes(cleanK) || 
                   cleanK.includes(cleanC) ||
                   (f.key === 'AccessionNo' && (cleanC === 'accno' || cleanC === 'id' || cleanC === 'acc_no')) ||
                   (f.key === 'ClassNo' && (cleanC === 'classno' || cleanC === 'classification'));
          });
          if (target) {
            initialMappings[f.key] = target;
          } else {
            initialMappings[f.key] = '';
          }
        });
        setFieldMappings(initialMappings);
        setStep(3);
      } else {
        alert(`Failed to load columns: ${data.message || 'Error'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  // Perform magic auto-map trigger
  const handleAutoMap = () => {
    const freshMappings: Record<string, string> = {};
    standardLogicalFields.forEach(f => {
      const match = columns.find(c => {
        const cNorm = c.toLowerCase().replace(/[^a-z0-9]/g, '');
        const kNorm = f.key.toLowerCase().replace(/[^a-z0-9]/g, '');
        return cNorm === kNorm || 
               cNorm.includes(kNorm) || 
               kNorm.includes(cNorm) ||
               (f.key === 'AccessionNo' && (cNorm === 'accno' || cNorm === 'id' || cNorm === 'acc_no')) ||
               (f.key === 'ClassNo' && (cNorm === 'classno' || cNorm === 'classification'));
      });
      freshMappings[f.key] = match || '';
    });
    setFieldMappings(freshMappings);
  };

  // API Call: Fetch top 100 rows for interactive Preview Grid
  const handleFetchPreviewGrid = async () => {
    setIsLoadingMetadata(true);
    try {
      const config = buildConfig();
      const data = await electronAPI.dbQuery(config, table, 100);
      if (data.success) {
        setPreviewRows(data.rows || []);
        setPreviewPage(0);
        setStep(4);
      } else {
        alert(`Failed to preview rows: ${data.message || 'Error'}`);
      }
    } catch (err: any) {
      alert(`Network error: ${err.message}`);
    } finally {
      setIsLoadingMetadata(false);
    }
  };

  // Final Action: complete and bind mapping to standard schema
  const handleSaveAndLink = async () => {
    const customFields = Object.keys(fieldMappings).filter(
      k => !standardLogicalFields.some(sf => sf.key === k)
    );

    // Compile mapped records to pass back to label layout
    const mappedRecords: DatabaseRecord[] = previewRows.map((row) => {
      const mappedRecord: any = {};
      
      // Populate standard logical fields using mappings
      standardLogicalFields.forEach(f => {
        const physicalCol = fieldMappings[f.key];
        mappedRecord[f.key] = physicalCol && row[physicalCol] !== undefined ? String(row[physicalCol]) : '';
      });

      // Populate custom logical fields using mappings
      customFields.forEach(k => {
        const physicalCol = fieldMappings[k];
        mappedRecord[k] = physicalCol && row[physicalCol] !== undefined ? String(row[physicalCol]) : '';
      });

      // Keep rest of original raw physical columns for full flexibility
      Object.keys(row).forEach(key => {
        if (mappedRecord[key] === undefined) {
          mappedRecord[key] = String(row[key]);
        }
      });

      return mappedRecord as DatabaseRecord;
    });

    const profile: ConnectionProfile = {
      id: activeProfile?.id || `sql-${Math.random().toString(36).substring(2, 9)}`,
      name,
      dbType,
      server,
      port,
      instance,
      database,
      table,
      username,
      password,
      authMode,
      trustCert,
      encrypt,
      sqlitePath,
      uniqueField: uniqueField || 'AccessionNo',
      fieldMappings,
      customFields
    };

    onSaveProfile(profile);
    if (onLoadedRecords && mappedRecords.length > 0) {
      onLoadedRecords(mappedRecords);
    }
    
    const res = await onConnect(profile);
    if (res.success) {
      onClose();
    } else {
      alert(res.msg);
    }
  };

  // Filter preview records
  const filteredPreviewRows = previewRows.filter(row => {
    if (!previewFilter) return true;
    const term = previewFilter.toLowerCase();
    return Object.values(row).some(val => String(val).toLowerCase().includes(term));
  });

  const paginatedPreviewRows = filteredPreviewRows.slice(
    previewPage * pageSize,
    (previewPage + 1) * pageSize
  );

  const totalPages = Math.ceil(filteredPreviewRows.length / pageSize);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] backdrop-blur-md p-4 select-none animate-fade-in font-sans">
      <div className="bg-metro-panel border border-metro-border rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] text-metro-secondary animate-scale-up">
        
        {/* Header with Step Wizard Indicators */}
        <div className="px-6 py-5 bg-metro-header border-b border-metro-border/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-xl text-indigo-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-metro-primary leading-none">Universal SQL Data Source Linker</h3>
              <p className="text-[10px] text-metro-secondary mt-1.5">Direct schema-agnostic DB provider (BarTender style)</p>
            </div>
          </div>
          
          {/* Step Progress Indicators */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step >= 1 ? 'bg-indigo-600 text-white' : 'bg-metro-input text-metro-secondary'
              }`}>1</span>
              <span className="text-[10px] font-bold hidden md:inline text-metro-primary">Source Setup</span>
            </div>
            <div className="w-4 h-0.5 bg-metro-border/60" />
            
            <div className="flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step >= 2 ? 'bg-indigo-600 text-white' : 'bg-metro-input text-metro-secondary'
              }`}>2</span>
              <span className="text-[10px] font-bold hidden md:inline text-metro-primary">Select Table</span>
            </div>
            <div className="w-4 h-0.5 bg-metro-border/60" />
            
            <div className="flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step >= 3 ? 'bg-indigo-600 text-white' : 'bg-metro-input text-metro-secondary'
              }`}>3</span>
              <span className="text-[10px] font-bold hidden md:inline text-metro-primary">Field Mapping</span>
            </div>
            <div className="w-4 h-0.5 bg-metro-border/60" />

            <div className="flex items-center gap-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step >= 4 ? 'bg-indigo-600 text-white font-bold' : 'bg-metro-input text-metro-secondary'
              }`}>4</span>
              <span className="text-[10px] font-bold hidden md:inline text-metro-primary">Preview Spreadsheet</span>
            </div>
            
            <button 
              onClick={onClose} 
              className="p-1.5 rounded-lg hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-colors cursor-pointer ml-4"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Wizard Panel Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 min-h-[400px]">
          
          {/* STEP 1: ENGINE & CONNECTION CONFIG */}
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-indigo-500/5 p-4 rounded-xl border border-indigo-500/10 flex items-start gap-3">
                <Cpu className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-indigo-300">Step 1: SQL Server Connection parameters</h4>
                  <p className="text-[10px] text-metro-secondary mt-1">
                    Select a database engine and provide credentials. Tip: Select **SQLite** to connect instantly to our built-in sample library database.
                  </p>
                </div>
              </div>

              {/* Engine Selection Tiles */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'sqlite', name: 'SQLite DB File', desc: 'File-based storage' },
                  { id: 'mysql', name: 'MySQL Server', desc: 'Enterprise Relational' },
                  { id: 'mssql', name: 'Microsoft SQL Server', desc: 'Active SSMS Provider' }
                ].map(engine => (
                  <div
                    key={engine.id}
                    onClick={() => setDbType(engine.id as any)}
                    className={`p-4 rounded-xl border cursor-pointer text-center transition-all ${
                      dbType === engine.id
                        ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-500/5'
                        : 'bg-metro-input/40 border-metro-border hover:border-slate-500 text-metro-primary'
                    }`}
                  >
                    <span className="text-xs font-extrabold block">{engine.name}</span>
                    <span className="text-[9px] text-metro-secondary block mt-0.5">{engine.desc}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1.5 tracking-wide">Connection Profile Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Local LibraryDB"
                    className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs text-metro-primary outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {dbType === 'sqlite' ? (
                  <div>
                    <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1.5 tracking-wide">SQLite Database File Path</label>
                    <input
                      type="text"
                      value={sqlitePath}
                      onChange={e => setSqlitePath(e.target.value)}
                      placeholder="e.g. barcode_studio_library.db"
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs text-metro-primary outline-none focus:border-indigo-500 transition-colors font-mono"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1.5 tracking-wide">Host Address (URL / IP)</label>
                      <input
                        type="text"
                        value={server}
                        onChange={e => setServer(e.target.value)}
                        placeholder="localhost or 192.168.1.50"
                        className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs text-metro-primary outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1.5 tracking-wide">Port</label>
                      <input
                        type="number"
                        value={port}
                        onChange={e => setPort(Number(e.target.value))}
                        className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs text-metro-primary outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  </>
                )}
              </div>

              {dbType !== 'sqlite' && (
                <div className="space-y-4">
                  {dbType === 'mssql' && (
                    <div>
                      <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1.5 tracking-wide">Named SQL Instance (Optional)</label>
                      <input
                        type="text"
                        value={instance}
                        onChange={e => setInstance(e.target.value)}
                        placeholder="e.g. SQLEXPRESS"
                        className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-xs text-metro-primary outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                  )}

                  {/* Auth Selection */}
                  <div className="p-4 bg-metro-input rounded-xl border border-metro-border/80 space-y-3">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-[9px] text-metro-primary font-bold uppercase tracking-wider">Authentication Protocol</span>
                    </div>
                    
                    {dbType === 'mssql' && (
                      <div className="flex gap-4 pt-1">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-metro-primary">
                          <input
                            type="radio"
                            name="auth"
                            checked={authMode === 'windows'}
                            onChange={() => setAuthMode('windows')}
                            className="text-indigo-600 focus:ring-0 bg-metro-input border-metro-border"
                          />
                          Windows NT Integrated Security
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-metro-primary">
                          <input
                            type="radio"
                            name="auth"
                            checked={authMode === 'sql'}
                            onChange={() => setAuthMode('sql')}
                            className="text-indigo-600 focus:ring-0 bg-metro-input border-metro-border"
                          />
                          SQL Server Authentication
                        </label>
                      </div>
                    )}

                    {(authMode === 'sql' || dbType === 'mysql') && (
                      <div className="grid grid-cols-2 gap-3 pt-1 border-t border-metro-border/20">
                        <div>
                          <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1">SQL Username</label>
                          <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-1.5 text-xs text-metro-primary outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-metro-secondary font-bold uppercase block mb-1">Password</label>
                          <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-1.5 text-xs text-metro-primary outline-none focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* TLS flags */}
                  <div className="flex gap-6 pt-1 text-xs font-medium text-metro-primary">
                    <label className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={trustCert}
                        onChange={e => setTrustCert(e.target.checked)}
                        className="rounded-md text-indigo-600 focus:ring-0 bg-metro-input border-metro-border"
                      />
                      Trust Server Certificate
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
                      <input
                        type="checkbox"
                        checked={encrypt}
                        onChange={e => setEncrypt(e.target.checked)}
                        className="rounded-md text-indigo-600 focus:ring-0 bg-metro-input border-metro-border"
                      />
                      Force SSL Encrypted Link
                    </label>
                  </div>
                </div>
              )}

              {/* Test and Discovery Panel */}
              <div className="pt-4 border-t border-metro-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-5 py-2.5 rounded-xl bg-metro-input hover:bg-metro-header border border-metro-border hover:border-metro-secondary text-metro-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Verifying TCP Link...' : 'Test Database Link'}</span>
                </button>

                {/* Databases dropdown */}
                {testResult?.success && dbType !== 'sqlite' && (
                  <div className="flex items-center gap-2 shrink-0 animate-fade-in w-full sm:w-auto">
                    <Database className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-bold text-metro-secondary uppercase">Active catalog:</span>
                    <select
                      value={database}
                      onChange={e => setDatabase(e.target.value)}
                      className="text-xs bg-metro-input border border-metro-border rounded-lg px-2.5 py-1.5 text-metro-primary cursor-pointer outline-none focus:border-indigo-500"
                    >
                      <option value="">-- Choose Database --</option>
                      {databases.map(db => (
                        <option key={db} value={db}>{db}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {testResult && (
                <div className={`p-4 rounded-xl border flex items-start gap-3 animate-fade-in ${
                  testResult.success 
                    ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300' 
                    : 'bg-red-500/5 border-red-500/20 text-red-300'
                }`}>
                  {testResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                  )}
                  <div>
                    <h5 className="text-xs font-extrabold">{testResult.success ? 'Success' : 'Connection Failed'}</h5>
                    <p className="text-[10px] text-metro-secondary mt-1">{testResult.msg}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: TABLE & VIEW SEARCHABLE TREE */}
          {step === 2 && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-indigo-500/5 p-4 rounded-xl border border-indigo-500/10 flex items-start gap-3">
                <Table className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-indigo-300">Step 2: Database Catalog Tree View</h4>
                  <p className="text-[10px] text-metro-secondary mt-1">
                    Select a table or database view to map its columns. Use instant search to filter physical datasets.
                  </p>
                </div>
              </div>

              {/* Table search filter */}
              <div className="relative shrink-0">
                <input
                  type="text"
                  placeholder="Search catalog tables & views..."
                  value={tableFilter}
                  onChange={e => setTableFilter(e.target.value)}
                  className="w-full text-xs pl-9 pr-4 py-2.5 bg-metro-input border border-metro-border text-metro-primary placeholder-metro-secondary focus:border-indigo-500 outline-none rounded-xl"
                />
                <Search className="w-4 h-4 text-metro-secondary absolute left-3 top-3" />
              </div>

              <div className="bg-metro-input rounded-xl border border-metro-border overflow-hidden max-h-[300px] overflow-y-auto">
                <div className="p-4 space-y-3 font-mono text-xs">
                  {/* Tables folder */}
                  <div className="space-y-1.5">
                    <div 
                      className="flex items-center gap-2 cursor-pointer font-bold text-metro-primary"
                      onClick={() => setExpandedNodes(prev => ({ ...prev, tables: !prev.tables }))}
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform ${expandedNodes.tables ? 'rotate-90' : ''}`} />
                      <Database className="w-4 h-4 text-indigo-400" />
                      <span>Tables ({tables.length})</span>
                    </div>
                    {expandedNodes.tables && (
                      <div className="ml-6 space-y-1 pl-2 border-l border-metro-border/60">
                        {tables
                          .filter(t => t.toLowerCase().includes(tableFilter.toLowerCase()))
                          .map(tName => (
                            <div
                              key={tName}
                              onClick={() => handleFetchColumnsAndMap(tName)}
                              className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-colors"
                            >
                              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-[11px] font-bold">{tName}</span>
                            </div>
                          ))}
                        {tables.length === 0 && (
                          <span className="text-[10px] text-metro-secondary italic block p-1">No tables found</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Views folder */}
                  <div className="space-y-1.5 pt-2">
                    <div 
                      className="flex items-center gap-2 cursor-pointer font-bold text-metro-primary"
                      onClick={() => setExpandedNodes(prev => ({ ...prev, views: !prev.views }))}
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform ${expandedNodes.views ? 'rotate-90' : ''}`} />
                      <Database className="w-4 h-4 text-indigo-400" />
                      <span>Views ({views.length})</span>
                    </div>
                    {expandedNodes.views && (
                      <div className="ml-6 space-y-1 pl-2 border-l border-metro-border/60">
                        {views
                          .filter(v => v.toLowerCase().includes(tableFilter.toLowerCase()))
                          .map(vName => (
                            <div
                              key={vName}
                              onClick={() => handleFetchColumnsAndMap(vName)}
                              className="flex items-center gap-2 p-2 rounded-lg cursor-pointer hover:bg-metro-header text-metro-secondary hover:text-metro-primary transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="text-[11px] font-bold">{vName}</span>
                            </div>
                          ))}
                        {views.length === 0 && (
                          <span className="text-[10px] text-metro-secondary italic block p-1">No database views found</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: MAPPING PANEL */}
          {step === 3 && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/10 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <Sliders className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-emerald-300">Step 3: Map Database columns to logical fields</h4>
                    <p className="text-[10px] text-metro-secondary mt-1">
                      Table selected: <strong className="text-emerald-400 font-mono">{table}</strong> ({columns.length} columns discovered). Map standard designer placeholders to physical database columns.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAutoMap}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white border border-indigo-500/20 flex items-center gap-1 text-[10px] font-bold cursor-pointer transition-all shrink-0"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Fuzzy Auto-Map</span>
                </button>
              </div>

              {/* Unique Field (Accession ID) designation */}
              <div className="bg-metro-input/40 p-4 rounded-xl border border-metro-border flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-metro-primary block">Primary/Unique Search Identifier</span>
                  <p className="text-[10px] text-metro-secondary mt-0.5">Which standard logical field serves as the unique lookup index? (Usually AccessionNo)</p>
                </div>
                <select
                  value={uniqueField}
                  onChange={e => setUniqueField(e.target.value)}
                  className="text-xs bg-metro-input border border-metro-border rounded-lg px-3 py-1.5 text-metro-primary cursor-pointer outline-none font-bold"
                >
                  {standardLogicalFields.map(f => (
                    <option key={f.key} value={f.key}>{f.key}</option>
                  ))}
                </select>
              </div>

              {/* Mapping list and Custom Field Creator */}
              <div className="pt-2 flex items-center justify-between border-t border-metro-border/30">
                <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Mapped Schema Fields</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    id="new-custom-field-input"
                    placeholder="Enter custom field name..."
                    className="text-[10px] px-2.5 py-1.5 bg-metro-input border border-metro-border text-metro-primary outline-none rounded-lg w-44"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const btn = document.getElementById('add-custom-field-btn');
                        if (btn) btn.click();
                      }
                    }}
                  />
                  <button
                    type="button"
                    id="add-custom-field-btn"
                    onClick={() => {
                      const input = document.getElementById('new-custom-field-input') as HTMLInputElement;
                      const name = input?.value?.trim();
                      if (!name) return;
                      if (standardLogicalFields.some(sf => sf.key === name) || fieldMappings[name] !== undefined) {
                        alert('Field name already exists!');
                        return;
                      }
                      if (!/^[a-zA-Z0-9_]+$/.test(name)) {
                        alert('Field name must contain only alphanumeric characters or underscores!');
                        return;
                      }
                      setFieldMappings(prev => ({ ...prev, [name]: '' }));
                      input.value = '';
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Custom Field</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 max-h-[220px] overflow-y-auto pr-1">
                {/* 1. Standard Fields */}
                {standardLogicalFields.map(f => {
                  const currentMapping = fieldMappings[f.key] || '';
                  return (
                    <div 
                      key={f.key} 
                      className="bg-metro-input/20 border border-metro-border/85 rounded-xl p-3 flex items-center justify-between gap-4"
                    >
                      <div className="truncate flex-1">
                        <span className="text-[11px] font-extrabold text-metro-primary block">{f.label}</span>
                        <span className="text-[9px] text-metro-secondary block font-mono">{`{${f.key}}`}</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 shrink-0">
                        <ArrowRight className="w-3.5 h-3.5 text-metro-secondary" />
                        <select
                          value={currentMapping}
                          onChange={e => setFieldMappings(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className={`text-[11px] bg-metro-input border rounded-lg px-2 py-1.5 font-bold font-mono outline-none cursor-pointer max-w-[150px] ${
                            currentMapping 
                              ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/[0.02]' 
                              : 'border-metro-border text-metro-secondary'
                          }`}
                        >
                          <option value="">-- [Skip Bind] --</option>
                          {columns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}

                {/* 2. Custom Fields */}
                {Object.keys(fieldMappings)
                  .filter(k => !standardLogicalFields.some(sf => sf.key === k))
                  .map(k => {
                    const currentMapping = fieldMappings[k] || '';
                    return (
                      <div 
                        key={k} 
                        className="bg-indigo-500/[0.02] border border-indigo-500/20 rounded-xl p-3 flex items-center justify-between gap-4 animate-fade-in"
                      >
                        <div className="truncate flex-1">
                          <span className="text-[11px] font-extrabold text-indigo-400 block">{k}</span>
                          <span className="text-[9px] text-metro-secondary block font-mono">{`{${k}} (Custom)`}</span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          <ArrowRight className="w-3.5 h-3.5 text-metro-secondary" />
                          <select
                            value={currentMapping}
                            onChange={e => setFieldMappings(prev => ({ ...prev, [k]: e.target.value }))}
                            className={`text-[11px] bg-metro-input border rounded-lg px-2 py-1.5 font-bold font-mono outline-none cursor-pointer max-w-[130px] ${
                              currentMapping 
                                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/[0.02]' 
                                : 'border-metro-border text-metro-secondary'
                            }`}
                          >
                            <option value="">-- [Skip Bind] --</option>
                            {columns.map(col => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              setFieldMappings(prev => {
                                const copy = { ...prev };
                                delete copy[k];
                                return copy;
                              });
                            }}
                            className="p-1 rounded-lg text-metro-secondary hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors"
                            title="Remove Custom Field Mapping"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* STEP 4: INTERACTIVE PREVIEW GRID */}
          {step === 4 && (
            <div className="space-y-4 animate-fade-in flex flex-col h-full min-h-[350px]">
              <div className="bg-indigo-500/5 p-4 rounded-xl border border-indigo-500/10 flex items-start justify-between gap-3 shrink-0">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-indigo-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-indigo-300">Step 4: SQL Spreadsheet Data Preview</h4>
                    <p className="text-[10px] text-metro-secondary mt-1">
                      Showing up to 100 rows retrieved from <strong className="text-indigo-400 font-mono">{table}</strong>. Grid columns are sorted by physical catalog position.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="text"
                    placeholder="Search preview rows..."
                    value={previewFilter}
                    onChange={e => {
                      setPreviewFilter(e.target.value);
                      setPreviewPage(0);
                    }}
                    className="text-xs pl-8 pr-2.5 py-1.5 bg-metro-input border border-metro-border text-metro-primary outline-none rounded-lg"
                  />
                  <Search className="w-3.5 h-3.5 text-metro-secondary absolute mt-0.5 ml-2.5" />
                </div>
              </div>

              {/* Spreadsheet layout */}
              <div className="flex-1 overflow-auto border border-metro-border/80 rounded-xl bg-metro-input/30 max-h-[250px]">
                <table className="w-full text-left border-collapse text-[11px] font-sans">
                  <thead className="bg-metro-header sticky top-0 text-metro-primary font-bold border-b border-metro-border select-text">
                    <tr>
                      <th className="p-2.5 border-r border-metro-border w-12 text-center">#</th>
                      {columns.map(col => (
                        <th key={col} className="p-2.5 border-r border-metro-border font-mono">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-metro-border/50 font-medium select-text">
                    {paginatedPreviewRows.map((row, rIdx) => (
                      <tr 
                        key={rIdx} 
                        className="hover:bg-indigo-600/5 hover:text-white transition-colors"
                      >
                        <td className="p-2 border-r border-metro-border text-center text-metro-secondary font-mono">
                          {previewPage * pageSize + rIdx + 1}
                        </td>
                        {columns.map(col => (
                          <td key={col} className="p-2 border-r border-metro-border max-w-[150px] truncate">
                            {row[col] !== null && row[col] !== undefined ? String(row[col]) : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {paginatedPreviewRows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 1} className="p-8 text-center text-xs text-metro-secondary italic">
                          No rows found matching search filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Paging controls */}
              <div className="flex items-center justify-between shrink-0 pt-2 text-xs font-semibold text-metro-primary border-t border-metro-border/50">
                <span className="text-metro-secondary text-[11px]">
                  Showing {Math.min(filteredPreviewRows.length, previewPage * pageSize + 1)}-{Math.min(filteredPreviewRows.length, (previewPage + 1) * pageSize)} of {filteredPreviewRows.length} rows
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                    disabled={previewPage === 0}
                    className="px-2.5 py-1.5 rounded bg-metro-input hover:bg-metro-header border border-metro-border text-metro-primary disabled:opacity-45 cursor-pointer transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-metro-secondary font-mono">{previewPage + 1} / {Math.max(1, totalPages)}</span>
                  <button
                    onClick={() => setPreviewPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={previewPage >= totalPages - 1}
                    className="px-2.5 py-1.5 rounded bg-metro-input hover:bg-metro-header border border-metro-border text-metro-primary disabled:opacity-45 cursor-pointer transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Wizard Footer Control Buttons */}
        <div className="px-6 py-4.5 bg-metro-header border-t border-metro-border/60 flex items-center justify-between shrink-0">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((prev) => (prev - 1) as any)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-metro-input hover:bg-metro-header text-metro-primary font-bold text-xs border border-metro-border/80 transition-all cursor-pointer animate-fade-in"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-metro-input hover:bg-metro-header text-metro-secondary hover:text-metro-primary font-bold text-xs border border-metro-border/80 cursor-pointer transition-all"
            >
              Cancel
            </button>

            {step === 1 && (
              <button
                onClick={handleFetchTables}
                disabled={isLoadingMetadata || (dbType !== 'sqlite' && !testResult?.success)}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs cursor-pointer shadow-lg shadow-indigo-600/10 transition-all"
              >
                <span>{isLoadingMetadata ? 'Loading catalog...' : 'Next: Choose Table'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 2 && (
              <div className="text-xs text-metro-secondary italic self-center">
                Select a table from catalog to proceed
              </div>
            )}

            {step === 3 && (
              <button
                onClick={handleFetchPreviewGrid}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs cursor-pointer shadow-lg shadow-indigo-600/10 transition-all"
              >
                <span>Next: Spreadsheet Preview</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 4 && (
              <button
                onClick={handleSaveAndLink}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer shadow-lg shadow-emerald-600/10 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Link & Bind Schema</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
