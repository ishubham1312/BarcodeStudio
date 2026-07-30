import React, { useState } from 'react';
import { ElementType, LabelElement, DatabaseRecord, Printer, LabelTemplate, ConnectionProfile } from '../types';
import {
  Type,
  Square,
  Minus,
  Image as ImageIcon,
  Layers,
  Search,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Database,
  ArrowUp,
  ArrowDown,
  Trash2,
  Bookmark,
  Plus,
  FolderOpen,
  Printer as PrinterIcon,
  HelpCircle,
  Sun,
  Moon,
  FileSpreadsheet,
  GripVertical
} from 'lucide-react';

interface SidebarToolboxProps {
  template: LabelTemplate;
  onAddElement: (type: ElementType, subtype?: string) => void;
  elements: LabelElement[];
  selectedId: string | null;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (id: string, updates: Partial<LabelElement>) => void;
  onRemoveElement: (id: string) => void;
  onSetZOrder: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;
  activeRecord: DatabaseRecord | null;
  onSelectRecord: (record: DatabaseRecord | null) => void;
  dbConnected: boolean;
  dbName: string;
  activePrinter: Printer;
  onSelectPrinter: (printer: Printer) => void;
  onShowHelp?: () => void;
  onToggleTheme?: () => void;
  theme?: 'dark' | 'light';
  dbRecords?: DatabaseRecord[];
  activeProfile?: ConnectionProfile | null;
}

export const SidebarToolbox: React.FC<SidebarToolboxProps> = ({
  template,
  onAddElement,
  elements,
  selectedId,
  onSelectElement,
  onUpdateElement,
  onRemoveElement,
  onSetZOrder,
  activeRecord,
  onSelectRecord,
  dbConnected,
  dbName,
  activePrinter,
  onSelectPrinter,
  onShowHelp,
  onToggleTheme,
  theme = 'dark',
  dbRecords = [],
  activeProfile = null
}) => {
  const [activeTab, setActiveTab] = useState<'insert' | 'layers'>('insert');
  
  // Database fields search state
  const [fieldsSearch, setFieldsSearch] = useState('');

  // Layer drag and drop re-ordering state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleLayerDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(id);
  };

  const handleLayerDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverId !== targetId) {
      setDragOverId(targetId);
    }
  };

  const handleLayerDragLeave = (e: React.DragEvent, targetId: string) => {
    if (dragOverId === targetId) {
      setDragOverId(null);
    }
  };

  const handleLayerDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const sourceId = draggedId || e.dataTransfer.getData('text/plain');
    setDraggedId(null);

    if (!sourceId || sourceId === targetId) return;

    const sorted = [...elements].sort((a, b) => b.zValue - a.zValue);
    const fromIndex = sorted.findIndex(el => el.id === sourceId);
    const toIndex = sorted.findIndex(el => el.id === targetId);

    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const total = reordered.length;
    reordered.forEach((el, index) => {
      const newZ = (total - index) * 10;
      if (el.zValue !== newZ) {
        onUpdateElement(el.id, { zValue: newZ });
      }
    });
  };

  const handleLayerDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  // SQL Server Tree State
  const [showSqlTree, setShowSqlTree] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    'db': true,
    'tables': true
  });
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  const toggleNode = (node: string) => {
    setExpandedNodes(prev => ({ ...prev, [node]: !prev[node] }));
  };

  const customFieldKeys = React.useMemo(() => {
    const keys = new Set<string>();
    ['AccessionNo', 'Title', 'Author', 'ClassNo', 'BookNo', 'ISBN', 'Publisher', 'Year', 'Price', 'Status'].forEach(k => keys.add(k));
    if (activeProfile) {
      if (activeProfile.fieldMappings) {
        Object.keys(activeProfile.fieldMappings).forEach(k => keys.add(k));
      }
      if ((activeProfile as any).customFields) {
        ((activeProfile as any).customFields).forEach((k: string) => keys.add(k));
      }
    }
    return Array.from(keys);
  }, [activeProfile]);

  const sqlTables = activeProfile?.table
    ? [{ 
        name: activeProfile.table, 
        fields: Array.from(new Set([
          ...(dbRecords && dbRecords.length > 0 ? Object.keys(dbRecords[0]) : []),
          ...customFieldKeys
        ]))
      }]
    : [
        { name: 'dbo.MARC21Records', fields: ['AccessionNo', 'Title', 'Author', 'ClassNo', 'BookNo', 'ISBN', 'Publisher', 'Year', 'Price', 'Status', 'Location'] },
        { name: 'dbo.Patrons', fields: ['PatronID', 'Name', 'Email', 'Phone', 'Type', 'ExpiryDate'] },
        { name: 'dbo.Circulation', fields: ['TransactionID', 'AccessionNo', 'PatronID', 'IssueDate', 'DueDate', 'ReturnDate'] }
      ];

  const activeFields = selectedTable 
    ? sqlTables.find(t => t.name === selectedTable)?.fields || [] 
    : Array.from(new Set([
        ...(dbRecords && dbRecords.length > 0 ? Object.keys(dbRecords[0]) : []),
        ...customFieldKeys
      ]));
    
  const filteredFields = activeFields.filter(f => f.toLowerCase().includes(fieldsSearch.toLowerCase()));

  // Mini scale for the thermal printer live view preview
  const maxMiniWidth = 170;
  const miniMmToPx = Math.min(maxMiniWidth / template.widthMm, 120 / template.heightMm);

  const handleMiniMouseDown = (e: React.MouseEvent, el: LabelElement) => {
    e.stopPropagation();
    onSelectElement(el.id);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = el.x;
    const initialY = el.y;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = (moveEvent.clientX - startX) / miniMmToPx;
      const dy = (moveEvent.clientY - startY) / miniMmToPx;
      
      onUpdateElement(el.id, {
        x: parseFloat((initialX + dx).toFixed(1)),
        y: parseFloat((initialY + dy).toFixed(1))
      });
    };
    
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const selectedElement = elements.find(el => el.id === selectedId) || null;

  // Toolbox buttons layout
  const tools: { type: ElementType; label: string; icon: React.ReactNode; subtype?: string }[] = [
    { type: 'text', label: 'Static/Dynamic Text', icon: <Type className="w-4 h-4" /> },
    { type: 'barcode', label: 'Standard Barcode', icon: <span className="font-extrabold tracking-tighter text-[9px] font-mono leading-none">||||</span> },
    { type: 'qrcode', label: 'QR Code Object', icon: <span className="font-extrabold text-[10px] tracking-tight">QR</span> },
    { type: 'shape', label: 'Rectangle Shape', icon: <Square className="w-4 h-4" />, subtype: 'rect' },
    { type: 'shape', label: 'Circle Shape', icon: <div className="w-3.5 h-3.5 rounded-full border-2 border-current" />, subtype: 'ellipse' },
    { type: 'line', label: 'Line Divider', icon: <Minus className="w-4 h-4 rotate-45" /> },
    { type: 'image', label: 'Graphic Image / Logo', icon: <ImageIcon className="w-4 h-4" /> }
  ];

  const dbFields = ['AccessionNo', 'Title', 'Author', 'ClassNo', 'BookNo', 'ISBN', 'Publisher', 'Year', 'Price'];


  const getElementLabel = (el: LabelElement): string => {
    if (el.fieldName) return `${el.fieldName}`;
    if (el.type === 'text') return el.text || 'Static Text';
    if (el.type === 'barcode') return `${el.barcodeType?.toUpperCase() || 'CODE128'}`;
    if (el.type === 'qrcode') return 'QR Code';
    if (el.type === 'shape') return el.shapeType === 'ellipse' ? 'Circle' : 'Rectangle';
    return el.type.toUpperCase();
  };

  return (
    <div className="w-60 bg-metro-panel border-r border-metro-border flex flex-col h-full select-none shrink-0 shadow-md">
      
      {/* Modern Capsule Tab Switcher */}
      <div className="p-2 border-b border-metro-border bg-metro-panel shrink-0">
        <div className="flex bg-metro-input p-1 rounded-xl border border-metro-border/40">
          {(['insert', 'layers'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-1.5 text-[9px] font-bold tracking-wider uppercase rounded-lg transition-all cursor-pointer ${
                activeTab === tab
                  ? 'text-white bg-metro-accent shadow-sm'
                  : 'text-metro-secondary hover:text-metro-primary hover:bg-metro-panel/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content Panels */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* PANEL: INSERT */}
        {activeTab === 'insert' && (
          <div className="p-4 flex flex-col gap-4 overflow-y-auto h-full">
            {/* Quick Insert Grid */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Quick Insert</span>
              <div className="grid grid-cols-4 gap-2">
                {tools.map((tool, i) => (
                  <button
                    key={i}
                    onClick={() => onAddElement(tool.type, tool.subtype)}
                    className="group flex flex-col items-center justify-center w-12 h-12 bg-metro-input hover:bg-metro-header border border-metro-border/80 hover:border-metro-accent text-metro-secondary hover:text-metro-accent transition-all duration-150 cursor-pointer rounded-xl hover:shadow-md hover:shadow-indigo-500/5"
                    title={tool.label}
                  >
                    {tool.icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Database Fields */}
            <div className="space-y-3 pt-4 border-t border-metro-border flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Database Fields</span>
                <button
                  onClick={() => setShowSqlTree(!showSqlTree)}
                  className={`text-[9px] font-bold px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                    showSqlTree ? 'bg-indigo-600 text-white' : 'bg-metro-input hover:bg-metro-header text-metro-secondary'
                  }`}
                  title="Connect SQL Server"
                >
                  <Database className="w-3 h-3" />
                  SQL
                </button>
              </div>
              
              {showSqlTree ? (
                <div className="flex-1 overflow-y-auto pr-0.5 space-y-1">
                  <div className="text-xs font-mono select-none">
                    {/* Database Node */}
                    <div className="flex items-center gap-1.5 py-1.5 px-2 cursor-pointer hover:bg-metro-input rounded" onClick={() => toggleNode('db')}>
                      <Database className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="font-bold text-metro-primary text-[10px]">{activeProfile?.database || dbName || 'LibraryDB'}</span>
                    </div>
                    
                    {expandedNodes['db'] && (
                      <div className="ml-3 pl-2 border-l border-metro-border space-y-1 mt-1">
                        <div className="flex items-center gap-1.5 py-1.5 px-2 cursor-pointer hover:bg-metro-input rounded" onClick={() => toggleNode('tables')}>
                          <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-metro-primary text-[10px]">Tables</span>
                        </div>
                        
                        {expandedNodes['tables'] && (
                          <div className="ml-3 pl-2 border-l border-metro-border space-y-1 mt-1">
                            {sqlTables.map(t => (
                              <div key={t.name}>
                                <div 
                                  className={`flex items-center gap-1.5 py-1.5 px-2 cursor-pointer rounded transition-colors ${
                                    selectedTable === t.name || activeProfile?.table === t.name ? 'bg-indigo-600/20 text-indigo-300 font-bold' : 'hover:bg-metro-input text-metro-secondary'
                                  }`}
                                  onClick={() => setSelectedTable(t.name === selectedTable ? null : t.name)}
                                >
                                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                                  <span className="text-[10px] truncate">{t.name}</span>
                                </div>
                                {(selectedTable === t.name || activeProfile?.table === t.name) && (
                                  <div className="ml-4 pl-2 border-l border-metro-border mt-1 space-y-1 pb-1">
                                    {t.fields.map(fName => (
                                      <button
                                        key={fName}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onAddElement('text', fName);
                                        }}
                                        className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-metro-input/40 hover:bg-metro-header border border-transparent hover:border-metro-accent/40 text-left text-[9.5px] text-metro-primary transition-colors cursor-pointer"
                                      >
                                        <span className="truncate max-w-[120px]">{fName}</span>
                                        <span className="text-[8px] text-metro-accent font-bold font-mono px-1 py-[1px] rounded bg-metro-accent/10 border border-metro-accent/25 hover:bg-metro-accent hover:text-white transition-colors">
                                          + Map
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {/* Fields Search Bar */}
                  <div className="relative shrink-0">
                    <input
                      type="text"
                      placeholder="Search fields..."
                      value={fieldsSearch}
                      onChange={e => setFieldsSearch(e.target.value)}
                      className="w-full text-xs pl-8 pr-2.5 py-1.5 bg-metro-input border border-metro-border text-metro-primary placeholder-metro-secondary focus:border-metro-accent outline-none rounded-xl font-sans"
                    />
                    <Search className="w-3.5 h-3.5 text-metro-secondary absolute left-2.5 top-2" />
                  </div>

                  {/* Fields List */}
                  <div className="space-y-1.5 overflow-y-auto flex-1 pr-0.5">
                    {filteredFields.map(fName => (
                      <button
                        key={fName}
                        onClick={() => onAddElement('text', fName)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-metro-input/40 hover:bg-metro-header border border-metro-border/60 hover:border-metro-accent/40 text-left text-xs font-bold text-metro-primary transition-all duration-150 cursor-pointer"
                      >
                        <span className="truncate max-w-[120px]">{fName}</span>
                        <span className="text-[9px] text-metro-accent font-bold font-mono px-1.5 py-0.5 rounded bg-metro-accent/10 border border-metro-accent/25 hover:bg-metro-accent hover:text-white transition-colors">
                          + Map
                        </span>
                      </button>
                    ))}
                    {filteredFields.length === 0 && (
                      <div className="text-center py-6 text-xs text-metro-secondary italic">
                        No matching fields
                      </div>
                    )}
                  </div>
                  
                </>
              )}
            </div>
          </div>
        )}

        {/* PANEL: LAYERS */}
        {activeTab === 'layers' && (
          <div className="p-4 flex flex-col gap-3 overflow-hidden h-full">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider font-mono">Layers ({elements.length})</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => selectedId && onSetZOrder(selectedId, 'up')}
                  disabled={!selectedId}
                  className="p-1.5 rounded-lg bg-metro-input hover:bg-metro-header text-metro-primary border border-metro-border disabled:opacity-30 cursor-pointer hover:border-metro-secondary transition-colors"
                  title="Bring Forward"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => selectedId && onSetZOrder(selectedId, 'down')}
                  disabled={!selectedId}
                  className="p-1.5 rounded-lg bg-metro-input hover:bg-metro-header text-metro-primary border border-metro-border disabled:opacity-30 cursor-pointer hover:border-metro-secondary transition-colors"
                  title="Send Backward"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Layers list */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
              {[...elements]
                .sort((a, b) => b.zValue - a.zValue)
                .map(el => {
                  const isSelected = el.id === selectedId;
                  return (
                    <div
                      key={el.id}
                      draggable
                      onDragStart={(e) => handleLayerDragStart(e, el.id)}
                      onDragOver={(e) => handleLayerDragOver(e, el.id)}
                      onDragLeave={(e) => handleLayerDragLeave(e, el.id)}
                      onDrop={(e) => handleLayerDrop(e, el.id)}
                      onDragEnd={handleLayerDragEnd}
                      onClick={() => onSelectElement(el.id)}
                      className={`flex items-center justify-between px-2.5 py-2 rounded-xl border transition-all duration-150 cursor-pointer select-none ${
                        draggedId === el.id
                          ? 'opacity-40 border-dashed border-indigo-500 bg-indigo-500/10'
                          : dragOverId === el.id
                            ? 'border-indigo-500 bg-indigo-500/20 scale-[1.02] shadow-lg shadow-indigo-500/20 ring-2 ring-indigo-500/40 text-indigo-300'
                            : isSelected
                              ? 'bg-metro-accent/10 border-metro-accent text-metro-accent'
                              : 'bg-metro-input/40 border-metro-border/80 hover:bg-metro-panel hover:border-metro-secondary text-metro-primary'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                        <GripVertical
                          className="w-3.5 h-3.5 text-metro-secondary hover:text-indigo-400 cursor-grab active:cursor-grabbing shrink-0 transition-colors"
                        />
                        <Bookmark className="w-3 h-3 text-metro-accent shrink-0" />
                        <span className="text-xs font-bold truncate leading-none">
                          {getElementLabel(el)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {/* Visibility Toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateElement(el.id, { visible: !el.visible });
                          }}
                          className={`p-1 rounded-md hover:bg-metro-input transition-colors ${el.visible ? 'text-metro-primary' : 'text-metro-muted'}`}
                          title={el.visible ? 'Hide Element' : 'Show Element'}
                        >
                          {el.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        </button>

                        {/* Lock Toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateElement(el.id, { locked: !el.locked });
                          }}
                          className={`p-1 rounded-md hover:bg-metro-input transition-colors ${el.locked ? 'text-metro-accent' : 'text-metro-muted'}`}
                          title={el.locked ? 'Unlock Element' : 'Lock Element'}
                        >
                          {el.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        </button>

                        {/* Remove Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveElement(el.id);
                          }}
                          className="p-1 rounded-md hover:bg-metro-input hover:text-red-500 text-metro-muted transition-colors"
                          title="Delete Element"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}

              {elements.length === 0 && (
                <div className="text-center py-10 text-xs text-metro-secondary italic leading-relaxed">
                  Canvas is empty.<br />Add elements above.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Workspace Settings Strip */}
      <div className="px-3 py-2 bg-metro-header/60 border-t border-metro-border flex items-center justify-between shrink-0">
        <span className="text-[9px] font-extrabold text-metro-secondary uppercase tracking-wider font-mono">Utilities</span>
        <div className="flex items-center gap-1">
          {onShowHelp && (
            <button
              onClick={onShowHelp}
              className="p-1.5 rounded-lg text-metro-secondary hover:bg-metro-input hover:text-metro-primary transition-colors cursor-pointer"
              title="Open shortcuts & gestures quick guide"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          )}
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
              className="p-1.5 rounded-lg text-metro-secondary hover:bg-metro-input hover:text-metro-primary transition-colors cursor-pointer"
              title="Switch theme"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-400" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
