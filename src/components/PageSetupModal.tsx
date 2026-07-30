import React, { useState, useEffect, useMemo } from 'react';
import { LabelTemplate } from '../types';
import { UnitConverter, PageSettings, LabelSettings, LayoutEngine, MediaType } from '../utils/LayoutEngine';
import { X, Save, FileText, Settings, Layers, Sliders, ShieldAlert, Check, LayoutGrid, Printer } from 'lucide-react';

// Exporting helpers to maintain backwards compatibility with App.tsx and PropertiesPanel.tsx
export const convertMmToUnit = UnitConverter.convertMmToUnit;
export const convertUnitToMm = UnitConverter.convertUnitToMm;
export const getUnitSymbol = UnitConverter.getUnitSymbol;

interface PageSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: LabelTemplate;
  mode: 'create' | 'edit';
  onSave: (updates: Partial<LabelTemplate>) => void;
  theme?: 'light' | 'dark';
}

export const PageSetupModal: React.FC<PageSetupModalProps> = ({
  isOpen,
  onClose,
  template,
  mode,
  onSave,
  theme = 'light',
}) => {
  const isLight = theme === 'light';

  // 1. Core Unit State
  const [selectedUnit, setSelectedUnit] = useState<'mm' | 'cm' | 'in'>(() => {
    const tUnit = template.unit || 'mm';
    const tUnitStr = tUnit as string;
    if (tUnitStr === 'inch' || tUnitStr === 'inches' || tUnitStr === 'in') return 'in';
    return tUnit as 'mm' | 'cm';
  });

  // 2. Form States (stored in selected unit)
  const [name, setName] = useState(template.name || 'Custom Label Layout');
  const [mediaType, setMediaType] = useState<MediaType>((template.mediaType as MediaType) || 'sheet');
  
  // Page Width/Height
  const [pageWidth, setPageWidth] = useState<number>(0);
  const [pageHeight, setPageHeight] = useState<number>(0);
  const [isInfiniteHeight, setIsInfiniteHeight] = useState<boolean>(true);

  // Label Size
  const [labelWidth, setLabelWidth] = useState<number>(0);
  const [labelHeight, setLabelHeight] = useState<number>(0);
  
  // Layout Columns/Rows
  const [columns, setColumns] = useState<number>(1);
  const [rows, setRows] = useState<number>(1);

  // Gaps & Margins
  const [gapHorizontal, setGapHorizontal] = useState<number>(0);
  const [gapVertical, setGapVertical] = useState<number>(0);
  const [marginTop, setMarginTop] = useState<number>(0);
  const [marginBottom, setMarginBottom] = useState<number>(0);
  const [marginLeft, setMarginLeft] = useState<number>(0);
  const [marginRight, setMarginRight] = useState<number>(0);

  // Corner Radius
  const [cornerRadius, setCornerRadius] = useState<number>(0);

  // DPI
  const [dpi, setDpi] = useState<number | 'auto'>('auto');

  // Sync state with template on open
  useEffect(() => {
    if (!isOpen) return;

    const unit = template.unit || 'mm';
    const unitStr = unit as string;
    const cleanUnit = (unitStr === 'inch' || unitStr === 'inches' || unitStr === 'in') ? 'in' : (unit as 'mm' | 'cm');
    setSelectedUnit(cleanUnit);

    setName(template.name || 'Custom Label Layout');
    const detectedMedia = (template.mediaType as MediaType) || 
      (((template.columns || 1) === 1 && !template.pageHeightMm) ? 'continuous' : 'sheet');
    setMediaType(detectedMedia);

    // Page Size (fallback based on label size if not defined)
    const rawPageW = template.pageWidthMm || (template.widthMm * (template.columns || 1));
    const rawPageH = template.pageHeightMm || (template.heightMm * (template.rows || 1));
    
    setPageWidth(convertMmToUnit(rawPageW, cleanUnit));
    setPageHeight(convertMmToUnit(rawPageH, cleanUnit));
    setIsInfiniteHeight(template.pageHeightMm === undefined || template.pageHeightMm === null || detectedMedia === 'continuous');

    // Label Size
    setLabelWidth(convertMmToUnit(template.widthMm || 50, cleanUnit));
    setLabelHeight(convertMmToUnit(template.heightMm || 30, cleanUnit));

    // Layout
    setColumns(template.columns || 1);
    setRows(template.rows || 1);

    // Gaps & Margins
    setGapHorizontal(convertMmToUnit(template.gapHorizontal ?? 0, cleanUnit));
    setGapVertical(convertMmToUnit(template.gapVertical ?? 0, cleanUnit));
    setMarginTop(convertMmToUnit(template.marginTop ?? 0, cleanUnit));
    setMarginBottom(convertMmToUnit(template.marginBottom ?? 0, cleanUnit));
    setMarginLeft(convertMmToUnit(template.marginLeft ?? 0, cleanUnit));
    setMarginRight(convertMmToUnit(template.marginRight ?? 0, cleanUnit));

    // Corner Radius & DPI
    setCornerRadius(convertMmToUnit(template.cornerRadiusMm ?? 0, cleanUnit));
    setDpi(template.dpi || 'auto');
  }, [isOpen, template]);

  // Handle unit switching: converts values instantly in fields to maintain visual parity
  const handleUnitChange = (newUnit: 'mm' | 'cm' | 'in') => {
    if (newUnit === selectedUnit) return;

    const convert = (val: number) => {
      const mm = convertUnitToMm(val, selectedUnit);
      return convertMmToUnit(mm, newUnit);
    };

    setPageWidth(prev => convert(prev));
    setPageHeight(prev => convert(prev));
    setLabelWidth(prev => convert(prev));
    setLabelHeight(prev => convert(prev));
    setGapHorizontal(prev => convert(prev));
    setGapVertical(prev => convert(prev));
    setMarginTop(prev => convert(prev));
    setMarginBottom(prev => convert(prev));
    setMarginLeft(prev => convert(prev));
    setMarginRight(prev => convert(prev));
    setCornerRadius(prev => convert(prev));
    
    setSelectedUnit(newUnit);
  };

  // Convert current form inputs back to mm for Layout Calculations
  const calculatedMmSettings = useMemo(() => {
    const unit = selectedUnit;
    return {
      page: new PageSettings({
        mediaType,
        width: convertUnitToMm(pageWidth, unit),
        height: isInfiniteHeight ? 0 : convertUnitToMm(pageHeight, unit),
        marginTop: convertUnitToMm(marginTop, unit),
        marginBottom: convertUnitToMm(marginBottom, unit),
        marginLeft: convertUnitToMm(marginLeft, unit),
        marginRight: convertUnitToMm(marginRight, unit),
        isInfiniteHeight: isInfiniteHeight || mediaType === 'continuous',
        dpi
      }),
      label: new LabelSettings({
        width: convertUnitToMm(labelWidth, unit),
        height: convertUnitToMm(labelHeight, unit),
        columns,
        rows: mediaType === 'sheet' ? rows : 1,
        gapHorizontal: convertUnitToMm(gapHorizontal, unit),
        gapVertical: convertUnitToMm(gapVertical, unit),
        cornerRadius: convertUnitToMm(cornerRadius, unit)
      })
    };
  }, [
    selectedUnit, mediaType, pageWidth, pageHeight, isInfiniteHeight, dpi,
    labelWidth, labelHeight, columns, rows, gapHorizontal, gapVertical,
    marginTop, marginBottom, marginLeft, marginRight, cornerRadius
  ]);

  // Calculate layout for preview based on mathematical layout engine
  const mockCount = mediaType === 'sheet' ? (columns * rows) : (columns * 2);
  const layoutPlan = useMemo(() => {
    return LayoutEngine.calculateLayout(calculatedMmSettings.page, calculatedMmSettings.label, mockCount);
  }, [calculatedMmSettings, mockCount, mediaType, columns, rows]);

  // Check if labels exceed the physical page dimensions
  const layoutExceedsPage = useMemo(() => {
    const p = calculatedMmSettings.page;
    const l = calculatedMmSettings.label;
    
    const totalW = p.marginLeft + 
                   columns * l.width + 
                   (columns > 1 ? (columns - 1) * l.gapHorizontal : 0) + 
                   p.marginRight;
                   
    const totalH = mediaType === 'sheet'
      ? (p.marginTop + rows * l.height + (rows > 1 ? (rows - 1) * l.gapVertical : 0) + p.marginBottom)
      : (p.marginTop + l.height + p.marginBottom);
      
    const widthOverflow = totalW > p.width;
    const heightOverflow = mediaType === 'sheet' && totalH > p.height;
    
    return widthOverflow || heightOverflow;
  }, [calculatedMmSettings, columns, rows, mediaType]);

  const handleSaveClick = () => {
    const unit = selectedUnit;
    
    const updates: Partial<LabelTemplate> = {
      name,
      mediaType,
      unit,
      widthMm: convertUnitToMm(labelWidth, unit),
      heightMm: convertUnitToMm(labelHeight, unit),
      columns,
      rows: mediaType === 'sheet' ? rows : 1,
      gapHorizontal: convertUnitToMm(gapHorizontal, unit),
      gapVertical: convertUnitToMm(gapVertical, unit),
      marginTop: convertUnitToMm(marginTop, unit),
      marginBottom: convertUnitToMm(marginBottom, unit),
      marginLeft: convertUnitToMm(marginLeft, unit),
      marginRight: convertUnitToMm(marginRight, unit),
      cornerRadiusMm: convertUnitToMm(cornerRadius, unit),
      dpi,
      pageWidthMm: convertUnitToMm(pageWidth, unit),
      pageHeightMm: isInfiniteHeight && mediaType === 'continuous' ? undefined : convertUnitToMm(pageHeight, unit),
    };

    onSave(updates);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md animate-fade-in p-4 overflow-y-auto select-none">
      <div className={`w-full max-w-5xl rounded-2xl border flex flex-col md:flex-row h-auto md:h-[680px] overflow-hidden shadow-2xl transition-all duration-300 ${
        isLight
          ? 'bg-slate-50 border-slate-200 text-slate-900'
          : 'bg-[#0b0c10] border-metro-border text-metro-primary'
      }`}>
        
        {/* Left Side: Inputs and Parameters Form */}
        <div className={`flex-1 flex flex-col border-r h-full overflow-y-auto ${
          isLight ? 'border-slate-200 bg-white' : 'border-metro-border bg-[#0e1017]'
        }`}>
          {/* Header */}
          <div className={`p-5 border-b flex items-center justify-between shrink-0 ${
            isLight ? 'border-slate-200 bg-slate-100/80 text-slate-900' : 'border-metro-border bg-metro-header text-white'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl border ${
                isLight ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400'
              }`}>
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold uppercase tracking-wider font-display">Page Setup & Geometry</h2>
                <p className={`text-[11px] font-semibold ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>
                  Configure Media, Print Dimensions & Layout Rules
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {/* Unit Switcher */}
              <div className={`flex border rounded-xl p-0.5 shadow-xs ${
                isLight ? 'bg-slate-200/80 border-slate-300/70' : 'bg-metro-input border-metro-border'
              }`}>
                {(['mm', 'cm', 'in'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleUnitChange(u)}
                    className={`px-2.5 py-1 text-[10px] font-extrabold rounded-lg transition-all cursor-pointer uppercase ${
                      selectedUnit === u
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : isLight
                          ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/50'
                          : 'text-metro-secondary hover:text-white hover:bg-metro-header'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>

              <button 
                onClick={onClose}
                className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                  isLight
                    ? 'hover:bg-rose-100 text-slate-400 hover:text-rose-600'
                    : 'hover:bg-metro-input text-metro-secondary hover:text-rose-400'
                }`}
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-5 flex-1 text-xs">
            {/* Template Name Input */}
            <div>
              <label className={`block text-[10px] font-extrabold uppercase tracking-wider mb-1.5 ${
                isLight ? 'text-slate-600' : 'text-metro-secondary'
              }`}>
                Layout Template Name
              </label>
              <input 
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`w-full border rounded-xl px-3.5 py-2 text-xs font-bold transition-all outline-none ${
                  isLight
                    ? 'bg-slate-100/90 border-slate-300 text-slate-900 placeholder-slate-400 focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                    : 'bg-metro-input border-metro-border text-metro-primary placeholder-metro-secondary/40 focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                }`}
                placeholder="Enter template name..."
              />
            </div>

            {/* Section 1: Page Setup (Printer & Sheet Layout) */}
            <div className={`border p-4.5 rounded-2xl space-y-4 shadow-xs transition-all ${
              isLight ? 'border-slate-200/90 bg-slate-50/80' : 'border-metro-border/80 bg-metro-panel/40'
            }`}>
              <div className={`flex items-center gap-2 border-b pb-2.5 ${
                isLight ? 'border-slate-200/80' : 'border-metro-border/60'
              }`}>
                <Layers className="w-4 h-4 text-indigo-500" />
                <h3 className={`text-[11px] font-extrabold uppercase tracking-wider ${
                  isLight ? 'text-indigo-900' : 'text-indigo-400'
                }`}>
                  1. Media Type & Sheet Layout
                </h3>
              </div>
              
              {/* Media Type Selection */}
              <div>
                <label className={`block text-[9.5px] font-extrabold uppercase tracking-wider mb-2 ${
                  isLight ? 'text-slate-600' : 'text-metro-secondary'
                }`}>
                  Select Media Format
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(['continuous', 'pre-cut', 'sheet'] as const).map((type) => {
                    const isSelected = mediaType === type;
                    const labelTitle = type === 'continuous' ? 'Continuous Roll' : type === 'pre-cut' ? 'Pre-cut Roll' : 'Sheet Labels';
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          setMediaType(type);
                          if (type === 'continuous') {
                            setIsInfiniteHeight(true);
                          } else {
                            setIsInfiniteHeight(false);
                          }
                        }}
                        className={`p-3 border rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer text-center font-bold text-[10px] ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/15'
                            : isLight
                              ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-300'
                              : 'border-metro-border bg-metro-input/50 text-metro-secondary hover:bg-metro-header hover:text-white'
                        }`}
                      >
                        <span className="uppercase tracking-wider">{labelTitle}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Page / Roll Size */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-[10px] font-bold mb-1.5 ${
                    isLight ? 'text-slate-700' : 'text-metro-secondary'
                  }`}>
                    Total Page Width ({selectedUnit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={pageWidth || ''}
                    onChange={(e) => setPageWidth(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className={`block text-[10px] font-bold ${
                      isLight ? 'text-slate-700' : 'text-metro-secondary'
                    }`}>
                      Total Page Height ({selectedUnit})
                    </label>
                    {mediaType === 'continuous' && (
                      <label className="flex items-center gap-1.5 text-[9.5px] font-extrabold text-indigo-500 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isInfiniteHeight}
                          onChange={(e) => setIsInfiniteHeight(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                        Continuous
                      </label>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    disabled={isInfiniteHeight && mediaType === 'continuous'}
                    value={isInfiniteHeight && mediaType === 'continuous' ? '' : pageHeight || ''}
                    placeholder={isInfiniteHeight && mediaType === 'continuous' ? 'Continuous / Infinite' : ''}
                    onChange={(e) => setPageHeight(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary disabled:opacity-40 disabled:cursor-not-allowed focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
              </div>

              {/* Columns & Rows */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-[10px] font-bold mb-1.5 ${
                    isLight ? 'text-slate-700' : 'text-metro-secondary'
                  }`}>
                    Columns Across
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={columns || ''}
                    onChange={(e) => setColumns(Math.max(1, parseInt(e.target.value) || 1))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1.5 ${
                    isLight ? 'text-slate-700' : 'text-metro-secondary'
                  }`}>
                    Rows Down
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    disabled={mediaType !== 'sheet'}
                    value={mediaType === 'sheet' ? rows : 'Dynamic'}
                    onChange={(e) => setRows(Math.max(1, parseInt(e.target.value) || 1))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary disabled:opacity-40 disabled:cursor-not-allowed focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Label Dimensions & Margins */}
            <div className={`border p-4.5 rounded-2xl space-y-4 shadow-xs transition-all ${
              isLight ? 'border-slate-200/90 bg-slate-50/80' : 'border-metro-border/80 bg-metro-panel/40'
            }`}>
              <div className={`flex items-center gap-2 border-b pb-2.5 ${
                isLight ? 'border-slate-200/80' : 'border-metro-border/60'
              }`}>
                <Sliders className="w-4 h-4 text-indigo-500" />
                <h3 className={`text-[11px] font-extrabold uppercase tracking-wider ${
                  isLight ? 'text-indigo-900' : 'text-indigo-400'
                }`}>
                  2. Sticker Dimensions & Spacing
                </h3>
              </div>
              
              {/* Sticker / Label Size */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-[10px] font-bold mb-1.5 ${
                    isLight ? 'text-slate-700' : 'text-metro-secondary'
                  }`}>
                    Label Width ({selectedUnit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={labelWidth || ''}
                    onChange={(e) => setLabelWidth(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10px] font-bold mb-1.5 ${
                    isLight ? 'text-slate-700' : 'text-metro-secondary'
                  }`}>
                    Label Height ({selectedUnit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={labelHeight || ''}
                    onChange={(e) => setLabelHeight(Math.max(0.1, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
              </div>

              {/* Layout Gaps */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-[9.5px] font-bold mb-1 ${
                    isLight ? 'text-slate-600' : 'text-metro-secondary'
                  }`}>
                    Horizontal Gap ({selectedUnit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={columns <= 1}
                    value={gapHorizontal || 0}
                    onChange={(e) => setGapHorizontal(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-1.5 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary disabled:opacity-40 disabled:cursor-not-allowed focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[9.5px] font-bold mb-1 ${
                    isLight ? 'text-slate-600' : 'text-metro-secondary'
                  }`}>
                    Vertical Gap ({selectedUnit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    disabled={mediaType === 'pre-cut'}
                    value={gapVertical || 0}
                    onChange={(e) => setGapVertical(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-1.5 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 disabled:bg-slate-100 disabled:text-slate-400 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20'
                        : 'bg-metro-input border-metro-border text-metro-primary disabled:opacity-40 disabled:cursor-not-allowed focus:border-metro-accent focus:ring-2 focus:ring-indigo-500/20'
                    }`}
                  />
                </div>
              </div>

              {/* Margins */}
              <div>
                <label className={`block text-[10px] font-extrabold uppercase tracking-wider mb-2 ${
                  isLight ? 'text-slate-600' : 'text-metro-secondary'
                }`}>
                  Margins ({selectedUnit})
                </label>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className={`block text-[8.5px] font-bold mb-1 ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Top</label>
                    <input
                      type="number"
                      step="0.01"
                      value={marginTop || 0}
                      onChange={(e) => setMarginTop(Math.max(0, parseFloat(e.target.value) || 0))}
                      className={`w-full border rounded-lg px-2 py-1 text-xs font-mono font-bold transition-all outline-none ${
                        isLight
                          ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                          : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent'
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`block text-[8.5px] font-bold mb-1 ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Bottom</label>
                    <input
                      type="number"
                      step="0.01"
                      value={marginBottom || 0}
                      onChange={(e) => setMarginBottom(Math.max(0, parseFloat(e.target.value) || 0))}
                      className={`w-full border rounded-lg px-2 py-1 text-xs font-mono font-bold transition-all outline-none ${
                        isLight
                          ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                          : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent'
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`block text-[8.5px] font-bold mb-1 ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Left</label>
                    <input
                      type="number"
                      step="0.01"
                      value={marginLeft || 0}
                      onChange={(e) => setMarginLeft(Math.max(0, parseFloat(e.target.value) || 0))}
                      className={`w-full border rounded-lg px-2 py-1 text-xs font-mono font-bold transition-all outline-none ${
                        isLight
                          ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                          : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent'
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`block text-[8.5px] font-bold mb-1 ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Right</label>
                    <input
                      type="number"
                      step="0.01"
                      value={marginRight || 0}
                      onChange={(e) => setMarginRight(Math.max(0, parseFloat(e.target.value) || 0))}
                      className={`w-full border rounded-lg px-2 py-1 text-xs font-mono font-bold transition-all outline-none ${
                        isLight
                          ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                          : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent'
                      }`}
                    />
                  </div>
                </div>
              </div>

              {/* Corner Radius & DPI Calibration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={`block text-[10px] font-extrabold uppercase tracking-wider mb-1.5 ${
                    isLight ? 'text-slate-600' : 'text-metro-secondary'
                  }`}>
                    Corner Radius ({selectedUnit})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={cornerRadius || 0}
                    onChange={(e) => setCornerRadius(Math.max(0, parseFloat(e.target.value) || 0))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold transition-all outline-none ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                        : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent'
                    }`}
                  />
                </div>
                <div>
                  <label className={`block text-[10px] font-extrabold uppercase tracking-wider mb-1.5 ${
                    isLight ? 'text-slate-600' : 'text-metro-secondary'
                  }`}>
                    Printer Resolution
                  </label>
                  <select
                    value={dpi === 'auto' ? 'auto' : String(dpi)}
                    onChange={(e) => setDpi(e.target.value === 'auto' ? 'auto' : parseInt(e.target.value))}
                    className={`w-full border rounded-xl px-3 py-2 text-xs font-bold transition-all outline-none cursor-pointer ${
                      isLight
                        ? 'bg-white border-slate-300 text-slate-900 focus:border-indigo-600'
                        : 'bg-metro-input border-metro-border text-metro-primary focus:border-metro-accent'
                    }`}
                  >
                    <option value="auto" className={isLight ? 'bg-white text-slate-900' : 'bg-[#13151c] text-white'}>Auto Detect</option>
                    <option value="203" className={isLight ? 'bg-white text-slate-900' : 'bg-[#13151c] text-white'}>203 DPI (Standard Thermal)</option>
                    <option value="300" className={isLight ? 'bg-white text-slate-900' : 'bg-[#13151c] text-white'}>300 DPI (HD Thermal)</option>
                    <option value="600" className={isLight ? 'bg-white text-slate-900' : 'bg-[#13151c] text-white'}>600 DPI (Ultra Precision)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Controls */}
          <div className={`p-4 border-t flex items-center justify-end gap-3 shrink-0 ${
            isLight ? 'border-slate-200 bg-slate-100/90' : 'border-metro-border bg-metro-header'
          }`}>
            <button
              onClick={onClose}
              className={`px-4 py-2 border rounded-xl font-bold cursor-pointer text-xs transition-all ${
                isLight
                  ? 'border-slate-300 hover:bg-slate-200 text-slate-700'
                  : 'border-metro-border hover:bg-metro-input hover:text-white text-metro-secondary'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveClick}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex items-center gap-1.5 font-bold cursor-pointer text-xs shadow-md shadow-indigo-600/20 transition-all"
            >
              <Save className="w-4 h-4" />
              Apply Settings
            </button>
          </div>
        </div>

        {/* Right Side: Visual Page Setup Preview */}
        <div className={`w-full md:w-[440px] flex flex-col p-6 h-full relative shrink-0 ${
          isLight ? 'bg-slate-100/90 border-t md:border-t-0 md:border-l border-slate-200' : 'bg-metro-canvas/80 border-t md:border-t-0 md:border-l border-metro-border'
        }`}>
          <div className="mb-4 flex items-center gap-2">
            <FileText className={`w-4 h-4 ${isLight ? 'text-indigo-600' : 'text-metro-accent'}`} />
            <h3 className={`text-[10px] font-extrabold uppercase tracking-wider ${
              isLight ? 'text-slate-700' : 'text-metro-secondary'
            }`}>
              Live Layout Preview
            </h3>
          </div>

          {/* Layout Statistics Panel */}
          <div className={`border p-3.5 rounded-2xl mb-4 space-y-2 text-[10.5px] shadow-xs ${
            isLight ? 'bg-white border-slate-200/90 text-slate-800' : 'bg-metro-panel/80 border-metro-border/80 text-metro-primary'
          }`}>
            <div className="flex justify-between items-center">
              <span className={`font-semibold ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Sticker Dimensions:</span>
              <span className="font-mono font-bold">{labelWidth} × {labelHeight} {selectedUnit}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={`font-semibold ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Printable Area:</span>
              <span className="font-mono font-bold">
                {UnitConverter.convertMmToUnit(layoutPlan.printableWidth, selectedUnit)} × {UnitConverter.convertMmToUnit(layoutPlan.printableHeight, selectedUnit)} {selectedUnit}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className={`font-semibold ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>Labels Per Sheet/Row:</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">{mediaType === 'sheet' ? `${columns * rows} stickers` : `${columns} across`}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className={`font-semibold ${isLight ? 'text-slate-500' : 'text-metro-secondary'}`}>DPI Calibration:</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{dpi === 'auto' ? 'Auto Spool (300 DPI fallback)' : `${dpi} DPI`}</span>
            </div>
          </div>

          {/* Preview Container Board */}
          <div className={`flex-1 border rounded-2xl relative flex items-center justify-center p-6 overflow-hidden shadow-inner select-none ${
            isLight ? 'bg-slate-200/60 border-slate-300/80' : 'bg-[#07080b] border-metro-border'
          }`}>
            {/* Draw Page bounds in miniature */}
            {(() => {
              const previewMaxDim = 280; // max size in px for preview screen area
              const mmPlanW = layoutPlan.pageWidth;
              const mmPlanH = layoutPlan.pageHeight;
              
              // Scale factor to fit inside the preview container
              const scale = Math.min(previewMaxDim / mmPlanW, previewMaxDim / mmPlanH);
              
              const pxPageW = mmPlanW * scale;
              const pxPageH = mmPlanH * scale;

              const pageStyle: React.CSSProperties = {
                width: `${pxPageW}px`,
                height: `${pxPageH}px`,
                backgroundColor: isLight ? '#ffffff' : '#090b11',
                border: isLight ? '2px solid #4f46e5' : '2px solid #6366f1',
                boxShadow: isLight ? '0 10px 25px -5px rgba(0, 0, 0, 0.1)' : '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                position: 'relative',
                transition: 'all 0.15s ease',
                overflow: 'hidden'
              };

              const marginStyle: React.CSSProperties = {
                position: 'absolute',
                left: `${convertUnitToMm(marginLeft, selectedUnit) * scale}px`,
                right: `${convertUnitToMm(marginRight, selectedUnit) * scale}px`,
                top: `${convertUnitToMm(marginTop, selectedUnit) * scale}px`,
                bottom: `${convertUnitToMm(marginBottom, selectedUnit) * scale}px`,
                border: isLight ? '1.5px dashed rgba(79, 70, 229, 0.45)' : '1.5px dashed rgba(99, 102, 241, 0.4)',
                pointerEvents: 'none'
              };

              return (
                <div style={pageStyle} className="transition-all rounded-sm flex items-center justify-center">
                  {/* Margins */}
                  <div style={marginStyle} />

                  {/* Individual Labels */}
                  {layoutPlan.pages[0]?.labels.map((lbl) => {
                    const radiusMm = convertUnitToMm(cornerRadius, selectedUnit);
                    const lblStyle: React.CSSProperties = {
                      position: 'absolute',
                      left: `${lbl.x * scale}px`,
                      top: `${lbl.y * scale}px`,
                      width: `${lbl.width * scale}px`,
                      height: `${lbl.height * scale}px`,
                      border: isLight ? '1px solid rgba(79, 70, 229, 0.85)' : '1px solid rgba(99, 102, 241, 0.75)',
                      backgroundColor: isLight ? 'rgba(79, 70, 229, 0.08)' : 'rgba(99, 102, 241, 0.12)',
                      borderRadius: `${radiusMm * scale}px`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: `${Math.max(6, Math.min(10, lbl.height * scale * 0.2))}px`,
                      color: isLight ? 'rgba(67, 56, 202, 0.95)' : 'rgba(165, 180, 252, 0.95)',
                      fontWeight: '800',
                      pointerEvents: 'none',
                      boxSizing: 'border-box'
                    };

                    return (
                      <div key={lbl.index} style={lblStyle}>
                        <span>L{lbl.index + 1}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          
          {layoutExceedsPage && (
            <div className="mt-3 p-2.5 bg-rose-500/10 border border-rose-500/40 text-rose-600 dark:text-rose-400 rounded-xl flex items-center gap-2 font-bold animate-pulse text-[9.5px] select-none shadow-xs">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Layout exceeds page boundary! Adjust columns, gaps, or margins.</span>
            </div>
          )}
          
          <div className={`mt-3 text-center text-[9.5px] font-semibold select-none ${
            isLight ? 'text-slate-500' : 'text-metro-secondary/80'
          }`}>
            Dynamic scaled preview. Stickers are numbered (L1, L2...).
          </div>
        </div>
      </div>
    </div>
  );
};
