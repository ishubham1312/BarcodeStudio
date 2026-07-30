/**
 * Smartly calculates font size for a text element so that it fits
 * within specified maximum width and height (supporting word wrapping and multi-line paragraphs).
 */
export function getAutoShrunkWrappedFontSize(
  text: string,
  fontFamily: string,
  initialFontSizePx: number,
  maxWidthPx: number,
  maxHeightPx: number,
  wrapText: boolean,
  fontWeight?: string,
  fontStyle?: string
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

  let fontSize = initialFontSizePx;

  // Step down font size until all wrapped lines fit horizontally & vertically
  while (fontSize > minFontSize) {
    const lines = getWrappedLines(text, fontSize);
    const lineSpacingMultiplier = 1.25;
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

/**
 * Single-line font size auto-shrink calculation.
 */
export function getAutoShrunkFontSize(
  text: string,
  fontFamily: string,
  initialFontSizePx: number,
  maxWidthPx: number,
  fontWeight?: string,
  fontStyle?: string
): number {
  return getAutoShrunkWrappedFontSize(
    text,
    fontFamily,
    initialFontSizePx,
    maxWidthPx,
    0,
    false,
    fontWeight,
    fontStyle
  );
}
