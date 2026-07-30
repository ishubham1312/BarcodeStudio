import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useElectronAPI } from '../hooks/useElectronAPI';
import { LabelElement, LabelTemplate } from '../types';
import { AlignLeft, AlignCenter, AlignRight, Lock, Unlock, Settings, PenTool, Hash, Type as TypeIcon, Search, ChevronDown, Check, Info, Link2, Unlink } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { convertMmToUnit, convertUnitToMm, getUnitSymbol } from './PageSetupModal';

const NumInput = ({ value, onChange, className, step = "1", min, max, disabled }: { value: number, onChange: (v: number) => void, className?: string, step?: string, min?: number, max?: number, disabled?: boolean }) => {
  const [localValue, setLocalValue] = React.useState<string>(value.toString());

  React.useEffect(() => {
    if (localValue === '' && value === 0) return;
    if (localValue === '-' && value === 0) return;
    const parsed = parseFloat(localValue);
    if (isNaN(parsed) || parsed !== value) {
      setLocalValue(value.toString());
    }
  }, [value]);

  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      value={localValue}
      onChange={e => {
        setLocalValue(e.target.value);
        if (e.target.value === '' || e.target.value === '-') {
           onChange(0);
        } else {
           const parsed = parseFloat(e.target.value);
           if (!isNaN(parsed)) {
              onChange(parsed);
           }
        }
      }}
      onBlur={() => {
        if (localValue === '' || localValue === '-') {
          setLocalValue(value.toString());
        } else {
          setLocalValue(value.toString());
        }
      }}
      className={className}
    />
  );
};


const INDIAN_SYMBOLOGIES = [
  {
    id: 'code128',
    name: 'Code 128',
    sample: 'IND1280',
    description: 'High-density compact alphanumeric standard. Widely used in Indian retail, logistics & libraries.',
    badge: 'Logistics Standard'
  },
  {
    id: 'code39',
    name: 'Code 39',
    sample: 'IND39',
    description: 'Alphanumeric barcode with variable length. Used in Indian government, defense & automotive.',
    badge: 'Industrial Standard'
  },
  {
    id: 'code93',
    name: 'Code 93',
    sample: 'IND93',
    description: 'Higher density alphanumeric barcode than Code 39. Common in postal services & warehousing.',
    badge: 'Postal & Express'
  },
  {
    id: 'gs1128',
    name: 'GS1-128',
    sample: '0195012345678903',
    description: 'Global standard for carton labeling. Broadly mandated in Indian manufacturing and retail.',
    badge: 'Supply Chain'
  },
  {
    id: 'codabar',
    name: 'Codabar',
    sample: 'A123456B',
    description: 'Self-checking numeric code with A-D markers. Standard in Indian blood banks & lab tracking.',
    badge: 'Healthcare & Labs'
  },
  {
    id: 'ean8',
    name: 'EAN-8',
    sample: '12345670',
    description: 'Compressed 8-digit European Article Number. Used on small candy and retail packages in India.',
    badge: 'Compact Retail'
  },
  {
    id: 'ean13',
    name: 'EAN-13',
    sample: '8901234567897',
    description: 'Standard retail product barcode. The "890" prefix designates Indian-origin merchandise.',
    badge: 'Retail Standard (India)'
  },
  {
    id: 'upca',
    name: 'UPC-A',
    sample: '123456789012',
    description: 'Standard 12-digit barcode for supermarket goods. Supported globally & in Indian supermarkets.',
    badge: 'Retail Standard (US/IN)'
  },
  {
    id: 'upce',
    name: 'UPC-E',
    sample: '01234565',
    description: 'Compressed 6-digit variant of UPC-A. Ideal for small-format cosmetics and grocery items.',
    badge: 'Compact Grocery'
  },
  {
    id: 'itf',
    name: 'Interleaved 2 of 5',
    sample: '12345678',
    description: 'Continuous numeric barcode. Widely implemented in Indian shipping, aviation & warehousing.',
    badge: 'Cardboard Shipping'
  },
  {
    id: 'itf14',
    name: 'ITF-14',
    sample: '12345678901231',
    description: 'Heavyweight 14-digit shipping symbol. Printed directly on master cases and outer corrugated boxes.',
    badge: 'Master Cartons'
  },
  {
    id: 'msi',
    name: 'MSI Plessey',
    sample: '123456',
    description: 'Continuous numeric barcode. Extensively used for inventory shelves and shelf-edge labels.',
    badge: 'Warehouse Shelving'
  },
  {
    id: 'isbn',
    name: 'ISBN Barcode',
    sample: '9788175257665',
    description: 'International Book Number. Decodes as EAN-13 starting with 978/979. Mandated for books in India.',
    badge: 'Book Publishing'
  },
  {
    id: 'issn',
    name: 'ISSN Barcode',
    sample: '9772582118002',
    description: 'Serial Publication Number. Decodes as EAN-13 starting with 977. For magazines and newspapers.',
    badge: 'Serials & Periodicals'
  }
];

const MiniBarcode: React.FC<{ type: string; value: string }> = ({ type, value }) => {
  const svgRef = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => {
    if (!svgRef.current) return;
    try {
      let targetFormat = 'CODE128';
      let val = value;
      if (type === 'code39') targetFormat = 'CODE39';
      else if (type === 'code93') targetFormat = 'CODE128';
      else if (type === 'gs1128') targetFormat = 'CODE128';
      else if (type === 'codabar') { targetFormat = 'CODABAR'; if (!/^[A-D][0-9\-$./:+]+[A-D]$/.test(val)) val = 'A123456B'; }
      else if (type === 'ean8') { targetFormat = 'EAN8'; if (!/^\d{7,8}$/.test(val)) val = '12345670'; }
      else if (type === 'ean13') { targetFormat = 'EAN13'; if (!/^\d{12,13}$/.test(val)) val = '8901234567897'; }
      else if (type === 'upca') { targetFormat = 'UPC'; if (!/^\d{11,12}$/.test(val)) val = '123456789012'; }
      else if (type === 'upce') { targetFormat = 'UPCE'; if (!/^\d{6,8}$/.test(val)) val = '01234565'; }
      else if (type === 'itf') { targetFormat = 'ITF'; if (!/^\d+$/.test(val) || val.length % 2 !== 0) val = '12345678'; }
      else if (type === 'itf14') { targetFormat = 'ITF14'; if (!/^\d{13,14}$/.test(val)) val = '12345678901231'; }
      else if (type === 'msi') { targetFormat = 'MSI'; if (!/^\d+$/.test(val)) val = '123456'; }
      else if (type === 'isbn') { targetFormat = 'EAN13'; val = '9788175257665'; }
      else if (type === 'issn') { targetFormat = 'EAN13'; val = '9772582118002'; }

      JsBarcode(svgRef.current, val, {
        format: targetFormat,
        displayValue: false,
        height: 14,
        width: 1.1,
        margin: 0
      });
    } catch (e) {
      // Ignored fallback
    }
  }, [type, value]);

  return <svg ref={svgRef} className="h-4.5 w-full max-w-[120px] object-contain opacity-90" />;
};

const getSymbologyKFactor = (type: string): number => {
  const t = (type || '').toLowerCase();
  if (t.includes('128') || t.includes('gs1')) return 180.85;
  if (t.includes('39')) return 62.5;
  if (t.includes('93')) return 111.1;
  if (t.includes('ean13') || t.includes('upca') || t.includes('upc') || t.includes('isbn') || t.includes('issn')) return 142.85;
  if (t.includes('ean8')) return 142.85;
  if (t.includes('itf')) return 142.85;
  if (t.includes('codabar')) return 117.6;
  return 180.85;
};

const estimateBarcodeModules = (type: string, value: string): number => {
  const L = value.length;
  const t = type.toLowerCase();
  if (t.includes("128") || t.includes("gs1")) {
    return 11 * L + 35;
  }
  if (t.includes("39")) {
    return 12 * L + 20;
  }
  if (t.includes("ean13") || t.includes("upca") || t.includes("upc") || t.includes("isbn") || t.includes("issn")) {
    return 95;
  }
  if (t.includes("ean8")) {
    return 67;
  }
  if (t.includes("itf14")) {
    return 150;
  }
  if (t.includes("itf")) {
    return 9 * L + 18;
  }
  if (t.includes("codabar")) {
    return 14 * L + 18;
  }
  return 12 * L + 20;
};

interface PropertiesPanelProps {
  selectedElement: LabelElement | null;
  onUpdateElement: (id: string, updates: Partial<LabelElement>) => void;
  template: LabelTemplate;
  onUpdateTemplate: (updates: Partial<LabelTemplate>) => void;
  dbFields: string[];
  onOpenPageSetup: () => void;
  onHighlightElement?: (id: string | null) => void;
}

/** Returns a human-readable display name for a label element. */
function getElementDisplayName(el: LabelElement): string {
  const typeName = el.type.charAt(0).toUpperCase() + el.type.slice(1);
  if (el.fieldName) return `${typeName} · ${el.fieldName}`;
  if (el.type === 'barcode' && el.barcodeType) {
    const bcName = el.barcodeType.toUpperCase();
    return `Barcode · ${bcName}`;
  }
  if (el.type === 'qrcode') return 'QR Code';
  if (el.type === 'text' && el.text) {
    const preview = el.text.length > 18 ? el.text.slice(0, 18) + '…' : el.text;
    return `Text · "${preview}"`;
  }
  if (el.type === 'shape') {
    return `Shape · ${(el.shapeType || 'rect').charAt(0).toUpperCase() + (el.shapeType || 'rect').slice(1)}`;
  }
  if (el.type === 'image') return `Image · ${el.id.slice(0, 6)}`;
  if (el.type === 'line') return `Line · ${el.id.slice(0, 6)}`;
  return `${typeName} · ${el.id.slice(0, 6)}`;
}

/** Custom dropdown for selecting anchor parent — supports hover-to-highlight. */
const AnchorParentDropdown: React.FC<{
  selectedElement: LabelElement;
  elements: LabelElement[];
  wouldCreateCycle: (childId: string, parentId: string) => boolean;
  onUpdateElement: (id: string, updates: Partial<LabelElement>) => void;
  onHighlightElement?: (id: string | null) => void;
}> = ({ selectedElement, elements, wouldCreateCycle, onUpdateElement, onHighlightElement }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onHighlightElement?.(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onHighlightElement]);

  const parentEl = selectedElement.parentId
    ? elements.find((el) => el.id === selectedElement.parentId)
    : null;
  const displayLabel = parentEl
    ? getElementDisplayName(parentEl)
    : '— None (Free Element) —';

  const candidates = elements.filter(
    (el) =>
      el.id !== selectedElement.id &&
      !wouldCreateCycle(selectedElement.id, el.id),
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2 text-metro-primary text-xs outline-none cursor-pointer hover:border-metro-secondary transition-colors font-bold flex items-center justify-between gap-1 text-left"
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 text-metro-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-metro-panel border border-metro-border rounded-xl shadow-2xl max-h-48 overflow-y-auto custom-scrollbar">
          <div
            className={`px-2.5 py-2 text-xs cursor-pointer transition-colors font-bold ${
              !selectedElement.parentId
                ? 'bg-indigo-500/15 text-indigo-400'
                : 'text-metro-primary hover:bg-metro-input'
            }`}
            onMouseEnter={() => onHighlightElement?.(null)}
            onClick={() => {
              onUpdateElement(selectedElement.id, { parentId: undefined });
              setOpen(false);
              onHighlightElement?.(null);
            }}
          >
            — None (Free Element) —
          </div>
          {candidates.map((el) => (
            <div
              key={el.id}
              className={`px-2.5 py-2 text-xs cursor-pointer transition-colors font-bold ${
                selectedElement.parentId === el.id
                  ? 'bg-indigo-500/15 text-indigo-400'
                  : 'text-metro-primary hover:bg-metro-input'
              }`}
              onMouseEnter={() => onHighlightElement?.(el.id)}
              onMouseLeave={() => onHighlightElement?.(null)}
              onClick={() => {
                onUpdateElement(selectedElement.id, {
                  parentId: el.id,
                  parentSpacing: selectedElement.parentSpacing ?? 0,
                });
                setOpen(false);
                onHighlightElement?.(null);
              }}
            >
              {getElementDisplayName(el)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedElement,
  onUpdateElement,
  template,
  onUpdateTemplate,
  dbFields,
  onOpenPageSetup,
  onHighlightElement
}) => {
  const electronAPI = useElectronAPI();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [barcodeTab, setBarcodeTab] = React.useState<'properties' | 'symbology'>('properties');
  const [autoDetectedMessage, setAutoDetectedMessage] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [fontSearch, setFontSearch] = useState('');
  const [fontDropdownOpen, setFontDropdownOpen] = useState(false);
  const fontDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(event.target as Node)) {
        setFontDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Barcode dimension specifications calculation
  const barcodeType = selectedElement?.barcodeType || 'code128';
  const K = getSymbologyKFactor(barcodeType);
  const isRatioDisabled = !['code39', 'codabar', 'itf'].includes(barcodeType.toLowerCase());

  let xDim = 10.0;
  let densityVal = 18.0;
  let heightInches = 0.5;

  if (selectedElement && selectedElement.type === 'barcode') {
    if (selectedElement.autoSize !== false) {
      const widthMm = selectedElement.width || 40;
      const heightMm = selectedElement.height || 15;
      const modules = estimateBarcodeModules(barcodeType, selectedElement.text || '12345678');

      const widthInches = widthMm / 25.4;
      const calculatedXInches = widthInches / modules;
      xDim = calculatedXInches * 1000;
      densityVal = K / xDim;

      const showText = Boolean(selectedElement.showText);
      const fontSizePt = selectedElement.fontSize || 10;
      const fontHeightMm = fontSizePt * 0.352778;
      const barHeightMm = Math.max(3.0, heightMm - (showText ? fontHeightMm + 2.0 : 0));
      heightInches = barHeightMm / 25.4;
    } else {
      const barWidthMm = selectedElement.barWidth || 0.4;
      const barHeightMm = selectedElement.barHeight || 15.0;

      xDim = barWidthMm / 0.0254;
      densityVal = K / xDim;
      heightInches = barHeightMm / 25.4;
    }
  }

  // Round values for UI display
  xDim = Math.round(xDim * 10) / 10;
  densityVal = Math.round(densityVal * 1000) / 1000;
  heightInches = Math.round(heightInches * 1000) / 1000;

  const handleXDimChange = (v: number) => {
    if (!selectedElement) return;
    const barWidthMm = v * 0.0254;
    const computedDensity = K / v;
    const modules = estimateBarcodeModules(barcodeType, selectedElement.text || '12345678');
    const widthMm = modules * barWidthMm;
    onUpdateElement(selectedElement.id, {
      autoSize: false,
      barWidth: barWidthMm,
      xDimensionMils: v,
      barcodeDensity: computedDensity,
      width: widthMm
    });
  };

  const handleDensityChange = (v: number) => {
    if (!selectedElement || v <= 0) return;
    const computedXDim = K / v;
    const barWidthMm = computedXDim * 0.0254;
    const modules = estimateBarcodeModules(barcodeType, selectedElement.text || '12345678');
    const widthMm = modules * barWidthMm;
    onUpdateElement(selectedElement.id, {
      autoSize: false,
      barWidth: barWidthMm,
      xDimensionMils: computedXDim,
      barcodeDensity: v,
      width: widthMm
    });
  };

  const handleHeightInchesChange = (v: number) => {
    if (!selectedElement) return;
    const barHeightMm = v * 25.4;
    const showText = Boolean(selectedElement.showText);
    const fontSizePt = selectedElement.fontSize || 10;
    const fontHeightMm = fontSizePt * (25.4 / 72.0);
    const heightMm = barHeightMm + (showText ? fontHeightMm + 2.0 : 0);
    onUpdateElement(selectedElement.id, {
      autoSize: false,
      barHeight: barHeightMm,
      height: heightMm
    });
  };

  const handleRatioChange = (v: string) => {
    if (!selectedElement) return;
    onUpdateElement(selectedElement.id, {
      barcodeRatio: v
    });
  };

  const currentSymbology = selectedElement && selectedElement.type === 'barcode'
    ? INDIAN_SYMBOLOGIES.find(sym => sym.id === selectedElement.barcodeType)
    : null;

  const filteredSymbologies = INDIAN_SYMBOLOGIES.filter(sym => 
    sym.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sym.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sym.badge.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleNumChange = (field: keyof LabelElement, val: string) => {
    if (!selectedElement) return;
    const parsed = parseFloat(val);
    if (!isNaN(parsed)) {
      onUpdateElement(selectedElement.id, { [field]: parsed });
    }
  };

  // Detect whether anchoring `childId` to `prospectiveParentId` would create a
  // circular linkage (i.e. the prospective parent is the child or one of its
  // own descendants).
  const wouldCreateCycle = (childId: string, prospectiveParentId: string): boolean => {
    if (childId === prospectiveParentId) return true;
    const byId = new Map(template.elements.map((e) => [e.id, e]));
    let cur: string | undefined = prospectiveParentId;
    const seen = new Set<string>();
    while (cur && byId.has(cur) && !seen.has(cur)) {
      if (cur === childId) return true;
      seen.add(cur);
      cur = byId.get(cur)!.parentId;
    }
    return false;
  };

  const handleTextChange = (field: keyof LabelElement, val: string) => {
    if (!selectedElement) return;
    onUpdateElement(selectedElement.id, { [field]: val });
  };

  const handleBoolChange = (field: keyof LabelElement, val: boolean) => {
    if (!selectedElement) return;
    onUpdateElement(selectedElement.id, { [field]: val });
  };

  const [fonts, setFonts] = useState<string[]>([
    'Segoe UI', 'Inter', 'Arial', 'Courier New', 'Times New Roman',
    'Georgia', 'Impact', 'Verdana', 'JetBrains Mono', 'Trebuchet MS'
  ]);

  useEffect(() => {
    let active = true;
    const loadSystemFonts = async () => {
      try {
        const res = await electronAPI.getSystemFonts();
        if (active && res && res.success && res.fonts && res.fonts.length > 0) {
          setFonts(res.fonts);
        }
      } catch (err) {
        console.error("Failed to load system fonts:", err);
      }
    };
    loadSystemFonts();
    return () => { active = false; };
  }, [electronAPI]);

  const filteredFonts = useMemo(() => {
    return fonts.filter(font => 
      font.toLowerCase().includes(fontSearch.toLowerCase())
    );
  }, [fonts, fontSearch]);

  return (
    <div className="w-60 bg-metro-panel border-l border-metro-border h-full flex flex-col overflow-y-auto select-none shrink-0 text-metro-secondary font-sans shadow-md">
      
      {/* Header Info */}
      <div className="p-4 border-b border-metro-border bg-metro-panel shrink-0 flex items-center gap-2">
        <div className="p-1.5 bg-metro-accent/10 rounded-lg text-metro-accent">
          {selectedElement ? <PenTool className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
        </div>
        <div>
          <h3 className="font-bold text-xs text-metro-primary leading-none">Inspector</h3>
          <span className="text-[9px] text-metro-secondary font-bold tracking-wider font-mono uppercase mt-0.5 block">
            {selectedElement ? `${selectedElement.type}` : 'Label Canvas'}
          </span>
        </div>
      </div>

      {selectedElement ? (
        <div className="p-4 space-y-4 text-xs">
          
          {/* Section: Barcode Tab selector if it is a Barcode */}
          {selectedElement.type === 'barcode' && (
            <div className="flex bg-metro-input p-1 rounded-xl border border-metro-border mb-2 shrink-0">
              <button
                type="button"
                onClick={() => setBarcodeTab('properties')}
                className={`flex-1 py-1.5 rounded-lg text-[10.5px] font-bold text-center transition-all cursor-pointer ${
                  barcodeTab === 'properties'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-metro-secondary hover:text-metro-primary'
                }`}
              >
                Properties
              </button>
              <button
                type="button"
                onClick={() => setBarcodeTab('symbology')}
                className={`flex-1 py-1.5 rounded-lg text-[10.5px] font-bold text-center transition-all cursor-pointer ${
                  barcodeTab === 'symbology'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-metro-secondary hover:text-metro-primary'
                }`}
              >
                Symbology
              </button>
            </div>
          )}

          {/* If barcode and symbology tab is selected, render standards selector directly */}
          {selectedElement.type === 'barcode' && barcodeTab === 'symbology' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Barcode Standards</span>
                <span className="text-[9px] text-indigo-400 font-mono font-bold uppercase tracking-wider">{filteredSymbologies.length} Available</span>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-metro-secondary" />
                <input
                  type="text"
                  placeholder="Search standard symbologies..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-metro-input border border-metro-border rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-metro-primary focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Scrollable list */}
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-0.5 custom-scrollbar">
                {filteredSymbologies.length === 0 ? (
                  <div className="text-center py-8 text-metro-secondary text-[11px]">No symbology found</div>
                ) : (
                  filteredSymbologies.map(sym => {
                    const isSelected = selectedElement.barcodeType === sym.id;
                    return (
                      <button
                        key={sym.id}
                        type="button"
                        onClick={() => {
                          onUpdateElement(selectedElement.id, { barcodeType: sym.id });
                        }}
                        className={`w-full text-left p-3 rounded-2xl border flex flex-col gap-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600/15 border-indigo-500 text-metro-primary'
                            : 'bg-black/20 border-metro-border/50 hover:bg-black/40 hover:border-metro-secondary text-metro-secondary hover:text-metro-primary'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="font-extrabold text-[11px] leading-tight">{sym.name}</span>
                          <span className="text-[7.5px] font-extrabold px-1.5 py-0.5 rounded bg-black/40 text-indigo-400 border border-indigo-500/10 font-mono">
                            {sym.badge}
                          </span>
                        </div>

                        {/* Live preview of the actual barcode */}
                        <div className="w-full h-8 bg-white rounded flex items-center justify-center p-1 overflow-hidden">
                          <MiniBarcode type={sym.id} value={sym.sample} />
                        </div>

                        <p className="text-[8.5px] text-metro-secondary font-medium leading-relaxed">
                          {sym.description}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Layout Metrics Section */}
              <div className="space-y-2.5">
                <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">
                  Layout Metrics ({getUnitSymbol(template.unit || 'mm')})
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">X Position</label>
                    <NumInput
                      step="0.001"
                      value={convertMmToUnit(selectedElement.x, template.unit || 'mm')}
                      onChange={v => {
                        const mmVal = convertUnitToMm(v, template.unit || 'mm');
                        onUpdateElement(selectedElement.id, { x: mmVal });
                      }}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Y Position</label>
                    <NumInput
                      step="0.001"
                      value={convertMmToUnit(selectedElement.y, template.unit || 'mm')}
                      onChange={v => {
                        const mmVal = convertUnitToMm(v, template.unit || 'mm');
                        onUpdateElement(selectedElement.id, { y: mmVal });
                      }}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Width</label>
                    <NumInput
                      step="0.001"
                      value={convertMmToUnit(selectedElement.width, template.unit || 'mm')}
                      onChange={v => {
                        const mmVal = convertUnitToMm(v, template.unit || 'mm');
                        onUpdateElement(selectedElement.id, { width: mmVal });
                      }}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Height</label>
                    <NumInput
                      step="0.001"
                      value={convertMmToUnit(selectedElement.height, template.unit || 'mm')}
                      onChange={v => {
                        const mmVal = convertUnitToMm(v, template.unit || 'mm');
                        onUpdateElement(selectedElement.id, { height: mmVal });
                      }}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                    />
                  </div>
                </div>

                <div className="pt-0.5">
                  <label className="text-[9px] text-metro-secondary block mb-1">Rotation Angle (°)</label>
                  <NumInput
                    value={selectedElement.rotation}
                    onChange={v => handleNumChange('rotation', v.toString())}
                    className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors"
                  />
                </div>

                <div className="pt-1.5">
                  <button
                    onClick={() => handleBoolChange('locked', !selectedElement.locked)}
                    className={`flex items-center gap-2 px-3 py-2 border text-[11px] font-bold w-full justify-center transition-all cursor-pointer rounded-xl ${
                      selectedElement.locked
                        ? 'bg-red-600/15 border-red-500/20 text-red-400 shadow-sm shadow-red-500/5'
                        : 'bg-metro-input border-metro-border text-metro-primary hover:bg-metro-header hover:border-metro-secondary'
                    }`}
                  >
                    {selectedElement.locked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" /> Locked
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3.5 h-3.5 text-metro-accent" /> Lock Element
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Anchor Layout Section */}
              <div className="space-y-2.5 pt-3 border-t border-metro-border">
                <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Anchor Layout</span>

                <div>
                  <label className="text-[9px] text-metro-secondary block mb-1">Anchor Parent</label>
                  <AnchorParentDropdown
                    selectedElement={selectedElement}
                    elements={template.elements}
                    wouldCreateCycle={wouldCreateCycle}
                    onUpdateElement={onUpdateElement}
                    onHighlightElement={onHighlightElement}
                  />

                  {selectedElement.parentId ? (
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <p className="text-[8.5px] text-indigo-400 flex items-center gap-1 leading-tight">
                        <Link2 className="w-3 h-3 shrink-0" />
                        Anchored below parent — moves with it.
                      </p>
                      <button
                        type="button"
                        onClick={() => onUpdateElement(selectedElement.id, { parentId: undefined })}
                        className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-metro-input border border-metro-border hover:border-red-500/40 text-[9px] font-bold text-metro-secondary hover:text-red-400 transition-colors cursor-pointer shrink-0"
                        title="Unlink from parent"
                      >
                        <Unlink className="w-3 h-3" /> Unlink
                      </button>
                    </div>
                  ) : (
                    <p className="text-[8.5px] text-metro-secondary mt-1.5 leading-tight">
                      Link this element to a parent so it stays centered underneath and follows the parent when moved.
                    </p>
                  )}
                </div>

                {selectedElement.parentId && (
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">
                      Spacing Below Parent ({getUnitSymbol(template.unit || 'mm')})
                    </label>
                    <NumInput
                      step="0.1"
                      value={convertMmToUnit(selectedElement.parentSpacing ?? 0, template.unit || 'mm')}
                      onChange={(v) =>
                        onUpdateElement(selectedElement.id, {
                          parentSpacing: convertUnitToMm(v, template.unit || 'mm'),
                        })
                      }
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                    />
                  </div>
                )}
              </div>

              {/* Data Source Binding Section */}
              {(selectedElement.type === 'text' || selectedElement.type === 'barcode' || selectedElement.type === 'qrcode') && (
                <div className="space-y-2.5 pt-3 border-t border-metro-border">
                  <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Database Field Mapping</span>
                  
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Map SQL Column</label>
                    <select
                      value={selectedElement.fieldName || ''}
                      onChange={e => {
                        const fName = e.target.value;
                        let updates: Partial<LabelElement> = {
                          fieldName: fName
                        };
                        
                        // Intelligent barcode format auto-detection
                        if (selectedElement.type === 'barcode' && fName) {
                          const fNameLower = fName.toLowerCase();
                          let detectedType = selectedElement.barcodeType || 'code128';
                          if (fNameLower.includes('isbn')) {
                            detectedType = 'isbn';
                          } else if (fNameLower.includes('issn')) {
                            detectedType = 'issn';
                          } else if (fNameLower.includes('ean13')) {
                            detectedType = 'ean13';
                          } else if (fNameLower.includes('ean8')) {
                            detectedType = 'ean8';
                          } else if (fNameLower.includes('upce')) {
                            detectedType = 'upce';
                          } else if (fNameLower.includes('upca') || fNameLower.includes('upc')) {
                            detectedType = 'upca';
                          } else if (fNameLower.includes('itf14')) {
                            detectedType = 'itf14';
                          } else if (fNameLower.includes('itf')) {
                            detectedType = 'itf';
                          } else if (fNameLower.includes('codabar')) {
                            detectedType = 'codabar';
                          } else if (fNameLower.includes('code39')) {
                            detectedType = 'code39';
                          } else if (fNameLower.includes('code93')) {
                            detectedType = 'code93';
                          } else {
                            detectedType = 'code128';
                          }
                          updates.barcodeType = detectedType;
                          setAutoDetectedMessage(`Auto-detected barcode standard "${detectedType.toUpperCase()}" for SQL field "${fName}"`);
                          setTimeout(() => setAutoDetectedMessage(''), 5000);
                        }

                        onUpdateElement(selectedElement.id, updates);
                      }}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2 text-metro-primary text-xs outline-none cursor-pointer hover:border-metro-secondary transition-colors font-bold"
                    >
                      <option value="">-- Static Value --</option>
                      {(() => {
                        const mergedFields = [...dbFields];
                        if (selectedElement.fieldName && !mergedFields.includes(selectedElement.fieldName)) {
                          mergedFields.unshift(selectedElement.fieldName);
                        }
                        return mergedFields.map(field => (
                          <option key={field} value={field}>{field}</option>
                        ));
                      })()}
                    </select>

                    {autoDetectedMessage && (
                      <div className="mt-2 p-2 bg-indigo-950/40 border border-indigo-500/20 rounded-xl flex items-center gap-1.5 text-indigo-300 text-[9px] animate-fade-in font-medium">
                        <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        <span>{autoDetectedMessage}</span>
                      </div>
                    )}
                  </div>

                  {!selectedElement.fieldName ? (
                    <div>
                      <label className="text-[9px] text-metro-secondary block mb-1">Plaintext / Value</label>
                      <input
                        type="text"
                        value={selectedElement.text || ''}
                        onChange={e => handleTextChange('text', e.target.value)}
                        className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">Prefix</label>
                        <input
                          type="text"
                          value={selectedElement.prefix || ''}
                          onChange={e => handleTextChange('prefix', e.target.value)}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">Suffix</label>
                        <input
                          type="text"
                          value={selectedElement.suffix || ''}
                          onChange={e => handleTextChange('suffix', e.target.value)}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Typography Section for Text & Barcode Elements */}
              {(selectedElement.type === 'text' || selectedElement.type === 'barcode') && (
                <div className="space-y-2.5 pt-3 border-t border-metro-border">
                  <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Typography</span>
                  
                  <div className="relative" ref={fontDropdownRef}>
                    <label className="text-[9px] text-metro-secondary block mb-1">Font Family</label>
                    <button
                      type="button"
                      onClick={() => setFontDropdownOpen(!fontDropdownOpen)}
                      className="w-full flex items-center justify-between bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none cursor-pointer hover:border-metro-secondary transition-all font-bold text-left"
                    >
                      <span style={{ fontFamily: selectedElement.fontFamily || 'Segoe UI' }}>
                        {selectedElement.fontFamily || 'Segoe UI'}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-metro-secondary shrink-0 ml-1" />
                    </button>
                    
                    {fontDropdownOpen && (
                      <div className="absolute left-0 right-0 mt-1 bg-metro-panel border border-metro-border rounded-xl shadow-2xl z-50 p-2 flex flex-col gap-1.5 min-w-[200px]">
                        {/* Search Input */}
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-metro-secondary" />
                          <input
                            type="text"
                            placeholder="Search font..."
                            value={fontSearch}
                            onChange={e => setFontSearch(e.target.value)}
                            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-metro-border bg-metro-input/40 focus:border-metro-accent outline-none text-xs text-metro-primary font-bold"
                            autoFocus
                          />
                        </div>
                        
                        {/* Scrollable list */}
                        <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5 custom-scrollbar pr-1">
                          {filteredFonts.length === 0 ? (
                            <div className="py-3 text-center text-[10px] text-metro-secondary">
                              No fonts match search
                            </div>
                          ) : (
                            filteredFonts.map(font => {
                              const isSelected = (selectedElement.fontFamily || 'Segoe UI') === font;
                              return (
                                <button
                                  key={font}
                                  type="button"
                                  onClick={() => {
                                    handleTextChange('fontFamily', font);
                                    setFontDropdownOpen(false);
                                  }}
                                  className={`w-full flex items-center justify-between text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                                    isSelected 
                                      ? "bg-metro-accent/15 text-metro-accent font-bold" 
                                      : "text-metro-primary hover:bg-indigo-600 hover:text-white"
                                  }`}
                                >
                                  <span style={{ fontFamily: font }}>{font}</span>
                                  {isSelected && <Check className="w-3.5 h-3.5 text-metro-accent shrink-0 ml-1" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-metro-secondary block mb-1">Size (pt)</label>
                      <NumInput
                        value={selectedElement.fontSize || 10}
                        onChange={v => handleNumChange('fontSize', v.toString())}
                        className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-metro-secondary block mb-1">Fill Color</label>
                      <input
                        type="color"
                        value={selectedElement.textColor || '#000000'}
                        onChange={e => handleTextChange('textColor', e.target.value)}
                        className="w-full h-[32px] bg-metro-input border border-metro-border rounded-xl px-1.5 py-1 cursor-pointer hover:border-metro-secondary transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTextChange('fontWeight', selectedElement.fontWeight === 'bold' ? 'normal' : 'bold')}
                      className={`flex-1 py-1.5 px-2 border rounded-xl text-[11px] font-bold text-center cursor-pointer transition-all duration-150 ${
                        selectedElement.fontWeight === 'bold'
                          ? 'bg-metro-accent border-metro-accent text-white shadow-sm'
                          : 'border-metro-border text-metro-primary hover:bg-metro-header hover:text-white'
                      }`}
                    >
                      Bold
                    </button>
                    <button
                      onClick={() => handleTextChange('fontStyle', selectedElement.fontStyle === 'italic' ? 'normal' : 'italic')}
                      className={`flex-1 py-1.5 px-2 border rounded-xl text-[11px] italic text-center cursor-pointer transition-all duration-150 ${
                        selectedElement.fontStyle === 'italic'
                          ? 'bg-metro-accent border-metro-accent text-white shadow-sm'
                          : 'border-metro-border text-metro-primary hover:bg-metro-header hover:text-white'
                      }`}
                    >
                      Italic
                    </button>
                  </div>

                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Align Text</label>
                    <div className="flex rounded-xl overflow-hidden border border-metro-border bg-metro-input p-0.5">
                      {(['left', 'center', 'right'] as const).map(align => (
                        <button
                          key={align}
                          onClick={() => handleTextChange('textAlign', align)}
                          className={`flex-1 py-1.5 flex items-center justify-center transition-all cursor-pointer rounded-lg ${
                            selectedElement.textAlign === align
                              ? 'bg-metro-accent text-white shadow-sm'
                              : 'hover:bg-metro-header text-metro-secondary hover:text-metro-primary'
                          }`}
                        >
                          {align === 'left' && <AlignLeft className="w-3.5 h-3.5" />}
                          {align === 'center' && <AlignCenter className="w-3.5 h-3.5" />}
                          {align === 'right' && <AlignRight className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-1.5 flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedElement.autoShrink === true}
                        onChange={e => {
                          onUpdateElement(selectedElement.id, {
                            autoShrink: e.target.checked
                          });
                        }}
                        className="rounded border-metro-border text-metro-accent focus:ring-0 bg-metro-input w-4 h-4 cursor-pointer"
                      />
                      <span className="text-[11px] text-metro-primary font-semibold" title="Smartly scales down font size if text exceeds the element box size (with word wrap if enabled)">
                        Smart Font Auto-Shrink
                      </span>
                    </label>

                    {selectedElement.type === 'text' && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={(selectedElement as any).wrapText === true}
                          onChange={e => {
                            onUpdateElement(selectedElement.id, {
                              wrapText: e.target.checked
                            });
                          }}
                          className="rounded border-metro-border text-metro-accent focus:ring-0 bg-metro-input w-4 h-4 cursor-pointer"
                        />
                        <span className="text-[11px] text-metro-primary font-semibold" title="Wrap text onto multiple lines if it exceeds the element's width (auto-shrinking font size if text still overflows)">
                          Wrap Text (Multi-Line)
                        </span>
                      </label>
                    )}
                    {selectedElement.type === 'barcode' && (
                      <div className="pt-2">
                        <label className="text-[9px] text-metro-secondary block mb-1">Text Distance (mm)</label>
                        <NumInput
                          step="0.1"
                          min={0}
                          max={20}
                          value={selectedElement.textMargin !== undefined ? selectedElement.textMargin : 1.5}
                          onChange={v => handleNumChange('textMargin', v.toString())}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Barcode Geometric Properties (Only shown in properties tab) */}
              {selectedElement.type === 'barcode' && (
                <div className="space-y-2.5 pt-3 border-t border-metro-border">
                  <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Barcode Dimension Specs</span>
                  
                  <label className="flex items-center gap-2 cursor-pointer pb-1">
                    <input
                      type="checkbox"
                      checked={selectedElement.autoSize !== false}
                      onChange={e => handleBoolChange('autoSize', e.target.checked)}
                      className="rounded-md border-metro-border text-metro-accent focus:ring-0 bg-metro-input w-4 h-4 cursor-pointer"
                    />
                    <span className="text-[11px] text-metro-primary font-semibold">Auto-fit Bounding Box (Auto Width/Height)</span>
                  </label>

                  {/* Dimension properties group box */}
                  <div className="border border-metro-border rounded-xl p-3 space-y-2.5 relative">
                    <span className="absolute -top-2 left-3 bg-metro-panel px-1 text-[9px] font-bold text-metro-secondary uppercase tracking-wider font-mono">Dimensions</span>
                    
                    {/* Row 1: X Dimension & Ratio */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">X-Dim (mils)</label>
                        <NumInput
                          step="0.1"
                          min={1}
                          max={100}
                          value={xDim}
                          onChange={handleXDimChange}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">Ratio</label>
                        <select
                          disabled={isRatioDisabled}
                          value={selectedElement.barcodeRatio || 'auto'}
                          onChange={e => handleRatioChange(e.target.value)}
                          className="w-full bg-metro-input disabled:opacity-40 disabled:cursor-not-allowed border border-metro-border rounded-xl px-2 py-1.5 text-metro-primary text-xs outline-none cursor-pointer hover:border-metro-secondary transition-colors font-bold"
                        >
                          <option value="auto">Auto</option>
                          <option value="2.0">2.0 : 1</option>
                          <option value="2.5">2.5 : 1</option>
                          <option value="3.0">3.0 : 1</option>
                        </select>
                      </div>
                    </div>

                    {/* Row 2: Density & Height */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">Density (c/in)</label>
                        <NumInput
                          step="0.001"
                          min={1}
                          max={100}
                          value={densityVal}
                          onChange={handleDensityChange}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">Height (in)</label>
                        <NumInput
                          step="0.001"
                          min={0.01}
                          max={10}
                          value={heightInches}
                          onChange={handleHeightInchesChange}
                          className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedElement.showText)}
                      onChange={e => handleBoolChange('showText', e.target.checked)}
                      className="rounded-md border-metro-border text-metro-accent focus:ring-0 bg-metro-input w-4 h-4 cursor-pointer"
                    />
                    <span className="text-[11px] text-metro-primary font-semibold">Display Plaintext Label</span>
                  </label>
                </div>
              )}

              {/* Shape & Line Properties Section */}
              {(selectedElement.type === 'shape' || selectedElement.type === 'line') && (
                <div className="space-y-2.5 pt-3 border-t border-metro-border">
                  <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">
                    {selectedElement.type === 'line' || selectedElement.shapeType === 'line' ? 'Line Properties' : 'Shape Properties'}
                  </span>
                  
                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Geometry</label>
                    <select
                      value={selectedElement.type === 'line' ? 'line' : (selectedElement.shapeType || 'rect')}
                      onChange={e => {
                        const val = e.target.value;
                        if (val === 'line') {
                          onUpdateElement(selectedElement.id, { type: 'line', shapeType: 'line', fillColor: 'transparent' });
                        } else {
                          onUpdateElement(selectedElement.id, { type: 'shape', shapeType: val as any });
                        }
                      }}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2 text-metro-primary text-xs outline-none cursor-pointer hover:border-metro-secondary transition-colors"
                    >
                      <option value="rect">Rectangle</option>
                      <option value="ellipse">Circle / Ellipse</option>
                      <option value="line">Line Divider</option>
                    </select>
                  </div>

                  <div className={`grid ${selectedElement.type !== 'line' && selectedElement.shapeType !== 'line' ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                    {selectedElement.type !== 'line' && selectedElement.shapeType !== 'line' && (
                      <div>
                        <label className="text-[9px] text-metro-secondary block mb-1">Fill Color</label>
                        <input
                          type="color"
                          value={selectedElement.fillColor || '#ffffff'}
                          onChange={e => handleTextChange('fillColor', e.target.value)}
                          className="w-full h-[32px] bg-metro-input border border-metro-border rounded-xl px-1.5 py-1 cursor-pointer hover:border-metro-secondary transition-colors"
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-[9px] text-metro-secondary block mb-1">Line / Stroke Color</label>
                      <input
                        type="color"
                        value={selectedElement.strokeColor || '#000000'}
                        onChange={e => handleTextChange('strokeColor', e.target.value)}
                        className="w-full h-[32px] bg-metro-input border border-metro-border rounded-xl px-1.5 py-1 cursor-pointer hover:border-metro-secondary transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Line Thickness / Stroke Width (px)</label>
                    <NumInput
                      value={selectedElement.strokeWidth || 1}
                      onChange={v => handleNumChange('strokeWidth', v.toString())}
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary text-xs outline-none focus:border-metro-accent transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Image Resources Section */}
              {selectedElement.type === 'image' && (
                <div className="space-y-2.5 pt-3 border-t border-metro-border">
                  <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Image Resource</span>
                  
                  <div className="flex gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      className="hidden"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            handleTextChange('text', reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 px-3 py-1.5 bg-metro-input border border-metro-border rounded-xl text-[11px] font-bold hover:bg-metro-header cursor-pointer transition-colors text-metro-primary"
                    >
                      Upload File
                    </button>
                  </div>

                  <div>
                    <label className="text-[9px] text-metro-secondary block mb-1">Direct URL</label>
                    <textarea
                      value={selectedElement.text || ''}
                      onChange={e => handleTextChange('text', e.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-metro-primary text-[11px] outline-none h-24 resize-none focus:border-metro-accent transition-colors"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Global Template Settings if No Element Selected */
        <div className="p-4 space-y-4 text-xs">
          <div className="space-y-2.5">
            <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Active Design</span>
            
            <div>
              <label className="text-[9px] text-metro-secondary block mb-1">Label Layout Name</label>
              <input
                type="text"
                value={template.name}
                onChange={e => onUpdateTemplate({ name: e.target.value })}
                className="w-full bg-metro-input border border-metro-border rounded-xl px-3 py-2 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-metro-border">
            <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">
              Label Dimensions ({getUnitSymbol(template.unit || 'mm')})
            </span>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-metro-secondary block mb-1">Width</label>
                <NumInput
                  step="0.001"
                  value={convertMmToUnit(template.widthMm, template.unit || 'mm')}
                  onChange={v => {
                    const mmVal = convertUnitToMm(v, template.unit || 'mm');
                    onUpdateTemplate({ widthMm: Math.max(5, mmVal || 38) });
                  }}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
                />
              </div>
              <div>
                <label className="text-[9px] text-metro-secondary block mb-1">Height</label>
                <NumInput
                  step="0.001"
                  value={convertMmToUnit(template.heightMm, template.unit || 'mm')}
                  onChange={v => {
                    const mmVal = convertUnitToMm(v, template.unit || 'mm');
                    onUpdateTemplate({ heightMm: Math.max(5, mmVal || 25) });
                  }}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
                />
              </div>
            </div>

            <div>
              <label className="text-[9px] text-metro-secondary block mb-1">Internal Safety Offset</label>
              <NumInput
                step="0.001"
                value={convertMmToUnit(template.marginMm, template.unit || 'mm')}
                onChange={v => {
                  const mmVal = convertUnitToMm(v, template.unit || 'mm');
                  onUpdateTemplate({ marginMm: Math.max(0, mmVal || 0) });
                }}
                className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-metro-border">
            <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">Label Shape</span>
            <div>
              <select
                value={template.shape || 'rectangle'}
                onChange={e => onUpdateTemplate({ shape: e.target.value as any })}
                className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2 text-metro-primary outline-none cursor-pointer hover:border-metro-secondary transition-colors font-bold"
              >
                <option value="rectangle">Rectangle</option>
                <option value="rounded-rectangle">Rounded Rectangle</option>
                <option value="ellipse">Ellipse</option>
                <option value="circle">Circle</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 pt-3 border-t border-metro-border">
            <span className="text-[10px] font-bold text-metro-secondary uppercase tracking-wider block font-mono">
              Page Internal Padding ({getUnitSymbol(template.unit || 'mm')})
            </span>
            
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-metro-secondary block mb-1">Left</label>
                <NumInput
                  step="0.1"
                  value={convertMmToUnit(template.paddingLeftMm || 0, template.unit || 'mm')}
                  onChange={v => {
                    const mmVal = convertUnitToMm(v, template.unit || 'mm');
                    onUpdateTemplate({ paddingLeftMm: Math.max(0, mmVal || 0) });
                  }}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
                />
              </div>
              <div>
                <label className="text-[9px] text-metro-secondary block mb-1">Right</label>
                <NumInput
                  step="0.1"
                  value={convertMmToUnit(template.paddingRightMm || 0, template.unit || 'mm')}
                  onChange={v => {
                    const mmVal = convertUnitToMm(v, template.unit || 'mm');
                    onUpdateTemplate({ paddingRightMm: Math.max(0, mmVal || 0) });
                  }}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
                />
              </div>
              <div>
                <label className="text-[9px] text-metro-secondary block mb-1">Top</label>
                <NumInput
                  step="0.1"
                  value={convertMmToUnit(template.paddingTopMm || 0, template.unit || 'mm')}
                  onChange={v => {
                    const mmVal = convertUnitToMm(v, template.unit || 'mm');
                    onUpdateTemplate({ paddingTopMm: Math.max(0, mmVal || 0) });
                  }}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
                />
              </div>
              <div>
                <label className="text-[9px] text-metro-secondary block mb-1">Bottom</label>
                <NumInput
                  step="0.1"
                  value={convertMmToUnit(template.paddingBottomMm || 0, template.unit || 'mm')}
                  onChange={v => {
                    const mmVal = convertUnitToMm(v, template.unit || 'mm');
                    onUpdateTemplate({ paddingBottomMm: Math.max(0, mmVal || 0) });
                  }}
                  className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-1.5 text-metro-primary outline-none focus:border-metro-accent transition-colors font-bold"
                />
              </div>
            </div>
          </div>
          
          <div className="space-y-2.5 pt-3 border-t border-metro-border">
            <div>
              <label className="text-[9px] text-metro-secondary block mb-1">Primary Key Identifier</label>
              <select
                value={template.uniqueField || 'AccessionNo'}
                onChange={e => onUpdateTemplate({ uniqueField: e.target.value })}
                className="w-full bg-metro-input border border-metro-border rounded-xl px-2.5 py-2 text-metro-primary outline-none cursor-pointer hover:border-metro-secondary transition-colors font-bold"
              >
                {(() => {
                  const mergedFields = [...dbFields];
                  if (template.uniqueField && !mergedFields.includes(template.uniqueField)) {
                    mergedFields.unshift(template.uniqueField);
                  }
                  return mergedFields.map(field => (
                    <option key={field} value={field}>{field}</option>
                  ));
                })()}
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-metro-border">
            <button
              type="button"
              onClick={onOpenPageSetup}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-xl transition-all cursor-pointer shadow-md shadow-indigo-600/10 text-center"
            >
              Page Setup...
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
