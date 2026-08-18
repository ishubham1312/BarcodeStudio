const fontSizeCache = new Map<string, number>();
const MAX_CACHE_SIZE = 1500;

/**
 * Smartly calculates font size for a text element so that it fits
<<<<<<< HEAD
 * within specified maximum width and height (supporting word wrapping and multi-line paragraphs).
 * When autoExpand is enabled, tests larger font sizes to fill available box space
 * (for both single-line and word-wrapped text) and chooses the largest valid size that fits.
=======
 * within specified maximum width and height (supporting word wrapping and multi-line paragraphs),
 * and optionally scales up font size by up to +2px (Smart Fit) when text is short.
>>>>>>> d0e4f23f974bad87a7ff9af2a720f1c105950927
 */
export function getAutoShrunkWrappedFontSize(
  text: string,
  fontFamily: string,
  initialFontSizePx: number,
  maxWidthPx: number,
  maxHeightPx: number,
  wrapText: boolean,
  fontWeight?: string,
  fontStyle?: string,
<<<<<<< HEAD
  autoExpand?: boolean,
  autoShrink?: boolean
=======
  smartFit?: boolean,
  autoShrink?: boolean,
  autoExpand?: boolean
>>>>>>> d0e4f23f974bad87a7ff9af2a720f1c105950927
): number {
  if (!text || maxWidthPx <= 0 || initialFontSizePx <= 0) return initialFontSizePx;

  // Memoization lookup for 60fps canvas performance
  const cacheKey = `${text}_${fontFamily}_${initialFontSizePx}_${maxWidthPx}_${maxHeightPx}_${wrapText ? 1 : 0}_${fontWeight || ''}_${fontStyle || ''}_${smartFit ? 1 : 0}_${autoShrink ? 1 : 0}_${autoExpand ? 1 : 0}`;
  const cachedVal = fontSizeCache.get(cacheKey);
  if (cachedVal !== undefined) {
    return cachedVal;
  }

<<<<<<< HEAD
  const ctx = canvas.getContext("2d");
  if (!ctx) return initialFontSizePx;

  const maxAllowedWidth = Math.max(1, maxWidthPx - 4);
  const minFontSize = 4;
  const shouldShrink = autoShrink !== false;

  const measureWidth = (str: string, size: number): number => {
    ctx.font = `${fontStyle || "normal"} ${fontWeight || "normal"} ${size}px "${fontFamily}", "Noto Sans UI", "Noto Sans", "Segoe UI", system-ui, sans-serif`;
    return ctx.measureText(str).width;
  };

  // Helper to split text into wrapped lines respecting paragraphs (\n) and long words
  const getWrappedLines = (str: string, size: number): string[] => {
    const rawParagraphs = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (!wrapText) return rawParagraphs.length > 0 ? rawParagraphs : [str];

    const lines: string[] = [];

    for (const para of rawParagraphs) {
      if (!para) {
        lines.push("");
        continue;
=======
  const computeFontSize = (): number => {
    let canvas = (getAutoShrunkFontSize as any)._canvas;
    if (!canvas) {
      if (typeof document !== "undefined") {
        canvas = document.createElement("canvas");
        (getAutoShrunkFontSize as any)._canvas = canvas;
      } else {
        return initialFontSizePx;
>>>>>>> d0e4f23f974bad87a7ff9af2a720f1c105950927
      }
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return initialFontSizePx;

    // Account for px-1 container padding (4px left + 4px right = 8px)
    const maxAllowedWidth = Math.max(1, maxWidthPx - 8);
    const maxAllowedHeight = maxHeightPx > 0 ? Math.max(1, maxHeightPx - 4) : 0;
    const minFontSize = 4;

    const measureWidth = (str: string, size: number): number => {
      ctx.font = `${fontStyle || "normal"} ${fontWeight || "normal"} ${size}px "${fontFamily}", "Segoe UI", system-ui, sans-serif`;
      return ctx.measureText(str).width;
    };

    // Helper to split text into wrapped lines respecting paragraphs (\n) and long words
    const getWrappedLines = (str: string, size: number): string[] => {
      const rawParagraphs = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
      if (!wrapText) return rawParagraphs.length > 0 ? rawParagraphs : [str];

      const lines: string[] = [];

      for (const para of rawParagraphs) {
        if (!para) {
          lines.push("");
          continue;
        }

        const words = para.split(" ");
        let currentLine = "";

        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          const testLine = currentLine ? `${currentLine} ${word}` : word;

          if (measureWidth(testLine, size) <= maxAllowedWidth) {
            currentLine = testLine;
          } else {
            if (currentLine) {
              lines.push(currentLine);
              currentLine = "";
            }

            // If the word itself is wider than maxAllowedWidth, break character by character
            if (measureWidth(word, size) > maxAllowedWidth) {
              let part = "";
              for (let c = 0; c < word.length; c++) {
                const char = word[c];
                if (measureWidth(part + char, size) <= maxAllowedWidth) {
                  part += char;
                } else {
                  if (part) lines.push(part);
                  part = char;
                }
              }
              if (part) currentLine = part;
            } else {
              currentLine = word;
            }
          }
        }
        if (currentLine) lines.push(currentLine);
      }

      return lines.length > 0 ? lines : [str];
    };

    const isIndic = /[\u0900-\u0D7F\u0600-\u06FF]/.test(text);
    const lineSpacingMultiplier = isIndic ? 1.65 : 1.30;

    // 0. Auto Expand Font (Fit Box) Logic: Smart font expansion capped at +3px boost max over base size
    if (autoExpand) {
      const maxBoostPx = 3.0;
      const startFontSizePx = initialFontSizePx + maxBoostPx;
      const minFontSizePx = autoShrink ? minFontSize : initialFontSizePx;

      let currentSize = startFontSizePx;
      while (currentSize >= minFontSizePx) {
        const lines = getWrappedLines(text, currentSize);
        const lineHeight = currentSize * lineSpacingMultiplier;
        const totalHeight = lines.length * lineHeight;

        let fitsWidth = true;
        for (const line of lines) {
          if (measureWidth(line, currentSize) > maxAllowedWidth) {
            fitsWidth = false;
            break;
          }
        }

        const fitsHeight = maxAllowedHeight <= 0 || totalHeight <= maxAllowedHeight;

        if (fitsWidth && fitsHeight) {
          return currentSize;
        }

        currentSize -= 0.5;
      }
      return minFontSizePx;
    }

    // 1. Smart Fit scaling UP logic (dynamically boost font size for short text)
    if (smartFit) {
      const baseLines = getWrappedLines(text, initialFontSizePx);
      const baseLineCount = baseLines.length;
      let baseFitsWidth = true;
      for (const line of baseLines) {
        if (measureWidth(line, initialFontSizePx) > maxAllowedWidth) {
          baseFitsWidth = false;
          break;
        }
      }
      const baseTotalHeight = baseLineCount * initialFontSizePx * lineSpacingMultiplier;
      const baseFitsHeight = maxAllowedHeight <= 0 || baseTotalHeight <= maxAllowedHeight;

      if (baseFitsWidth && baseFitsHeight) {
        const candidates = [4.0, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5];
        for (const boost of candidates) {
          const candidateSize = initialFontSizePx + boost;
          const candLines = getWrappedLines(text, candidateSize);

          // Guardrail 1: Scaled font size MUST NOT cause extra line wraps
          if (candLines.length > baseLineCount) continue;

          // Guardrail 2: Scaled font size MUST NOT exceed horizontal bounds
          let candFitsWidth = true;
          for (const line of candLines) {
            if (measureWidth(line, candidateSize) > maxAllowedWidth) {
              candFitsWidth = false;
              break;
            }
          }
          if (!candFitsWidth) continue;

          // Guardrail 3: Scaled font size MUST NOT exceed vertical container bounds
          const candTotalHeight = candLines.length * candidateSize * lineSpacingMultiplier;
          if (maxAllowedHeight > 0 && candTotalHeight > maxAllowedHeight) continue;

          // Candidate passed all guardrails! Return scaled up font size.
          return candidateSize;
        }
      }
    }

    // 2. Standard step-down auto-shrink logic if text exceeds box size and autoShrink is enabled
    if (autoShrink !== false) {
      let fontSize = initialFontSizePx;
      while (fontSize > minFontSize) {
        const lines = getWrappedLines(text, fontSize);
        const lineHeight = fontSize * lineSpacingMultiplier;
        const totalHeight = lines.length * lineHeight;

        let fitsWidth = true;
        for (const line of lines) {
          if (measureWidth(line, fontSize) > maxAllowedWidth) {
            fitsWidth = false;
            break;
          }
        }

        const fitsHeight = maxAllowedHeight <= 0 || totalHeight <= maxAllowedHeight;

        if (fitsWidth && fitsHeight) {
          break;
        }

        fontSize -= 0.5;
      }
      return Math.max(minFontSize, fontSize);
    }

    return initialFontSizePx;
  };

<<<<<<< HEAD
  // Auto-expand: grow the font until it fills the element box
  // without overflowing width or height. Supports both single-line and word-wrapped text.
  const cleanText = text ? text.trim() : "";
  const canAutoExpand = Boolean(autoExpand);
  let expandedBase = initialFontSizePx;

  if (canAutoExpand && cleanText) {
    const maxCap = Math.max(initialFontSizePx + 3, initialFontSizePx * 3.5);
    let cap = initialFontSizePx;

    while (cap < maxCap) {
      const testSize = cap + 0.5;
      if (wrapText) {
        const lines = getWrappedLines(text, testSize);
        const lineSpacingMultiplier = 1.35;
        const lineHeight = testSize * lineSpacingMultiplier;
        const totalHeight = lines.length * lineHeight;

        let fitsWidth = true;
        for (const line of lines) {
          if (measureWidth(line, testSize) > maxAllowedWidth) {
            fitsWidth = false;
            break;
          }
        }

        const fitsHeight = maxHeightPx <= 0 || totalHeight <= maxHeightPx;
        if (fitsWidth && fitsHeight) {
          cap = testSize;
        } else {
          break;
        }
      } else {
        const w = measureWidth(cleanText, testSize);
        const h = testSize * 0.75;
        if (w <= maxAllowedWidth && (maxHeightPx <= 0 || h <= maxHeightPx)) {
          cap = testSize;
        } else {
          break;
        }
      }
    }
    expandedBase = cap;
  }

  let fontSize = expandedBase;
  const lowestAllowedSize = shouldShrink ? minFontSize : initialFontSizePx;

  // Step down font size if text overflows the available box
  while (fontSize > lowestAllowedSize) {
    if (wrapText) {
      const lines = getWrappedLines(text, fontSize);
      const lineSpacingMultiplier = 1.35;
      const lineHeight = fontSize * lineSpacingMultiplier;
      const totalHeight = lines.length * lineHeight;

      let fitsWidth = true;
      for (const line of lines) {
        if (measureWidth(line, fontSize) > maxAllowedWidth) {
          fitsWidth = false;
          break;
        }
      }

      // Strictly fit within maxHeightPx so multi-line text never gets cropped at the bottom
      const fitsHeight = maxHeightPx <= 0 || totalHeight <= maxHeightPx;

      if (fitsWidth && fitsHeight) {
        break;
      }
    } else {
      // Single-line text fitting
      const textWidth = measureWidth(cleanText || text, fontSize);
      const fitsWidth = textWidth <= maxAllowedWidth;
      const fitsHeight = maxHeightPx <= 0 || (fontSize * 0.75) <= maxHeightPx;

      if (fitsWidth && fitsHeight) {
        break;
      }
    }

    fontSize -= 0.5;
  }

  // Ensure font size respects lower and upper bounds
  return Math.max(lowestAllowedSize, Math.min(expandedBase, fontSize));
}

/**
 * Single-line font size auto-shrink / auto-expand calculation.
=======
  const calculatedSize = computeFontSize();
  if (fontSizeCache.size >= MAX_CACHE_SIZE) {
    const firstKey = fontSizeCache.keys().next().value;
    if (firstKey) fontSizeCache.delete(firstKey);
  }
  fontSizeCache.set(cacheKey, calculatedSize);
  return calculatedSize;
}

/**
 * Utility function for auto-scaling font size to fit container bounding box.
 */
export function getAutoScaledFontSize(
  text: string,
  fontFamily: string,
  initialFontSizePx: number,
  maxWidthPx: number,
  maxHeightPx: number,
  wrapText: boolean,
  fontWeight?: string,
  fontStyle?: string,
  autoShrink?: boolean
): number {
  return getAutoShrunkWrappedFontSize(
    text,
    fontFamily,
    initialFontSizePx,
    maxWidthPx,
    maxHeightPx,
    wrapText,
    fontWeight,
    fontStyle,
    false,
    autoShrink,
    true
  );
}

/**
 * Single-line font size auto-shrink / smart-fit calculation.
>>>>>>> d0e4f23f974bad87a7ff9af2a720f1c105950927
 */
export function getAutoShrunkFontSize(
  text: string,
  fontFamily: string,
  initialFontSizePx: number,
  maxWidthPx: number,
  fontWeight?: string,
  fontStyle?: string,
<<<<<<< HEAD
  autoExpand?: boolean,
  maxHeightPx?: number,
  autoShrink?: boolean
=======
  smartFit?: boolean
>>>>>>> d0e4f23f974bad87a7ff9af2a720f1c105950927
): number {
  return getAutoShrunkWrappedFontSize(
    text,
    fontFamily,
    initialFontSizePx,
    maxWidthPx,
    maxHeightPx || 0,
    false,
    fontWeight,
    fontStyle,
<<<<<<< HEAD
    autoExpand,
    autoShrink
=======
    smartFit
>>>>>>> d0e4f23f974bad87a7ff9af2a720f1c105950927
  );
}

