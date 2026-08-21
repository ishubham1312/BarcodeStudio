/**
 * Smartly calculates font size for a text element so that it fits
 * within specified maximum width and height (supporting word wrapping and multi-line paragraphs).
 * When autoExpand is enabled, tests larger font sizes to fill available box space (for both single-line
 * and word-wrapped multi-line text) and chooses the largest valid size that fits cleanly.
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
  autoExpand?: boolean,
  autoShrink?: boolean
): number {
  if (!text || maxWidthPx <= 0 || initialFontSizePx <= 0) return initialFontSizePx;

  let canvas = (getAutoShrunkFontSize as any)._canvas;
  if (!canvas) {
    if (typeof document !== "undefined") {
      canvas = document.createElement("canvas");
      (getAutoShrunkFontSize as any)._canvas = canvas;
    } else {
      return initialFontSizePx;
    }
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return initialFontSizePx;

  // Safe inner bounds (margin for box padding and antialiasing)
  const maxAllowedWidth = Math.max(1, maxWidthPx - 4);
  const maxAllowedHeight = maxHeightPx > 0 ? Math.max(1, maxHeightPx - 2) : 0;
  const minFontSize = 4;
  const lineSpacingMultiplier = 1.25;
  const allowWrap = wrapText || Boolean(autoExpand);
  const shouldShrink = autoShrink !== false;
  const canAutoExpand = Boolean(autoExpand);

  const cleanText = text ? text.trim() : "";
  if (!cleanText) return initialFontSizePx;

  const hasHindi = /[\u0900-\u0D7F]/.test(cleanText);
  const effectiveFontFamily = hasHindi ? "Noto Sans" : (fontFamily || "Noto Sans");

  const measureWidth = (str: string, size: number): number => {
    ctx.font = `${fontStyle || "normal"} ${fontWeight || "normal"} ${size}px "${effectiveFontFamily}", "Noto Sans", "Noto Sans Devanagari", "Noto Sans UI", "Segoe UI", system-ui, sans-serif`;
    return ctx.measureText(str).width;
  };

  const getWrappedLines = (str: string, size: number): string[] => {
    const rawParagraphs = str.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (!allowWrap) return rawParagraphs.length > 0 ? rawParagraphs : [str];

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

  const checkFits = (size: number): boolean => {
    if (size <= 0) return false;
    if (allowWrap) {
      const lines = getWrappedLines(cleanText, size);
      const lineHeight = size * lineSpacingMultiplier;
      const totalHeight = lines.length * lineHeight;

      if (maxAllowedHeight > 0 && totalHeight > maxAllowedHeight) {
        return false;
      }

      for (const line of lines) {
        if (measureWidth(line, size) > maxAllowedWidth) {
          return false;
        }
      }
      return true;
    } else {
      const w = measureWidth(cleanText, size);
      const h = size * 0.85;
      if (w > maxAllowedWidth) return false;
      if (maxAllowedHeight > 0 && h > maxAllowedHeight) return false;
      return true;
    }
  };

  if (canAutoExpand) {
    const maxSearchSize = maxAllowedHeight > 0 ? Math.min(120, maxAllowedHeight) : Math.max(initialFontSizePx * 4, 120);
    let low = minFontSize;
    let high = maxSearchSize;
    let bestFit = initialFontSizePx;

    // Fast binary search with 0.5px precision
    for (let iter = 0; iter < 16; iter++) {
      const mid = Math.round(((low + high) / 2) * 2) / 2;
      if (checkFits(mid)) {
        bestFit = mid;
        low = mid + 0.5;
      } else {
        high = mid - 0.5;
      }
      if (low > high) break;
    }

    if (bestFit >= initialFontSizePx) {
      return bestFit;
    } else if (shouldShrink) {
      return bestFit;
    } else {
      return initialFontSizePx;
    }
  }

  // Auto-shrink only
  let fontSize = initialFontSizePx;
  const lowestAllowed = shouldShrink ? minFontSize : initialFontSizePx;
  while (fontSize > lowestAllowed) {
    if (checkFits(fontSize)) {
      break;
    }
    fontSize -= 0.5;
  }

  return Math.max(lowestAllowed, fontSize);
}

/**
 * Single-line font size auto-shrink / auto-expand calculation.
 */
export function getAutoShrunkFontSize(
  text: string,
  fontFamily: string,
  initialFontSizePx: number,
  maxWidthPx: number,
  fontWeight?: string,
  fontStyle?: string,
  autoExpand?: boolean,
  maxHeightPx?: number,
  autoShrink?: boolean
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
    autoExpand,
    autoShrink
  );
}

