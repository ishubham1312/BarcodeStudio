/**
 * Smartly calculates font size for a text element so that it fits
 * within specified maximum width and height (supporting word wrapping and multi-line paragraphs).
 * When autoExpand is enabled, tests larger font sizes to fill available box space
 * (for both single-line and word-wrapped text) and chooses the largest valid size that fits.
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

