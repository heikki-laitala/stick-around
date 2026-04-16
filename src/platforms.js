/**
 * Find the nearest platform at or below feetScreenY that xPos is horizontally on.
 * Returns ground floor if nothing else matches.
 */
export function findFloor(platforms, feetScreenY, xPos, screenH) {
  let best = null;
  for (const p of platforms) {
    if (p.y >= feetScreenY - 2 && (best === null || p.y < best.y)) {
      if (xPos >= p.x && xPos <= p.x + p.w) {
        best = p;
      }
    }
  }
  const groundY = screenH - 4;
  if (groundY >= feetScreenY - 2 && (best === null || groundY < best.y)) {
    best = { y: groundY, x: 0, w: Infinity };
  }
  return best;
}

/**
 * Find the nearest platform ABOVE feetScreenY within maxDist.
 */
export function findPlatformAbove(platforms, feetScreenY, xPos, maxDist) {
  let best = null;
  for (const p of platforms) {
    if (p.y < feetScreenY - 2 && feetScreenY - p.y <= maxDist) {
      if (best === null || p.y > best.y) best = p;
    }
  }
  return best;
}

/**
 * Find the nearest platform directly above feetScreenY that the man is horizontally on.
 * Returns the platform whose bottom edge (y + lineHeight) is closest above feetY, or null.
 */
export function findCeiling(platforms, feetScreenY, xPos, lineHeight) {
  let best = null;
  for (const p of platforms) {
    const bottom = p.y + lineHeight;
    // Platform bottom must be above feet (with small tolerance)
    if (bottom < feetScreenY + 2 && xPos >= p.x && xPos <= p.x + p.w) {
      if (best === null || p.y > best.y) best = p;
    }
  }
  return best;
}

/**
 * Build platforms and region boxes from terminal content.
 * Pure function — returns new state rather than mutating globals.
 *
 * @param {object} content - Terminal content from backend
 * @param {object} cached  - { cachedInputIdx, cachedFooterIdx } fallback cache
 * @returns {{ platforms, promptArea, footerArea, textOffsetX, textOffsetY, textWidth, textHeight, lineHeight, cachedInputIdx, cachedFooterIdx, lastDebugLines, lastInputLine, lastFooterLine }}
 */
export function buildPlatforms(content, cached) {
  const textOffsetX = content.text_offset_x;
  const textOffsetY = content.text_offset_y;
  const textHeight = content.text_height;
  const textWidth = content.text_width;
  const lines = content.lines;
  const lineOffsets = content.line_offsets || [];
  const hashes = content.hashes || [];
  const numVisible = lines.length;
  const lastDebugLines = content.debug_lines || [];
  const lastInputLine = content.input_line;
  const lastFooterLine = content.footer_line;

  if (numVisible === 0) {
    return {
      platforms: [], promptArea: null, footerArea: null,
      textOffsetX, textOffsetY, textWidth, textHeight, lineHeight: 16,
      cachedInputIdx: cached.cachedInputIdx || null,
      cachedFooterIdx: cached.cachedFooterIdx || null,
      lastDebugLines, lastInputLine, lastFooterLine,
    };
  }

  const termRows = content.term_rows || numVisible;
  const termCols = content.term_cols || Math.max(...lines, 1);
  const lineHeight = textHeight / termRows;
  const charWidth = textWidth / termCols;
  const fitLines = termRows;

  let inputIdx = content.input_line;
  let footerIdx = content.footer_line;

  let newCachedInputIdx = cached.cachedInputIdx || null;
  let newCachedFooterIdx = cached.cachedFooterIdx || null;

  if (inputIdx != null && footerIdx != null) {
    newCachedInputIdx = inputIdx;
    newCachedFooterIdx = footerIdx;
  } else if (newCachedInputIdx != null) {
    if (inputIdx == null) inputIdx = newCachedInputIdx;
    if (footerIdx == null) footerIdx = newCachedFooterIdx;
  }

  if (inputIdx != null && inputIdx >= fitLines) inputIdx = fitLines - 1;
  if (footerIdx != null && footerIdx >= fitLines) footerIdx = fitLines;
  if (inputIdx != null && inputIdx < 0) inputIdx = 0;
  if (footerIdx != null && footerIdx < 0) footerIdx = 0;

  const lastPlatLine = inputIdx != null ? inputIdx - 1 : fitLines - 1;
  const platforms = [];

  const MIN_PLATFORM_COLS = 3; // Ignore very short lines (noise)
  for (let i = 0; i <= lastPlatLine && i < fitLines; i++) {
    const cols = lines[i];
    if (cols >= MIN_PLATFORM_COLS) {
      const y = textOffsetY + i * lineHeight;
      const offset = (lineOffsets[i] || 0) * charWidth;
      platforms.push({ y, x: textOffsetX + offset, w: cols * charWidth, hash: hashes[i] || 0 });
    }
  }

  // Add prompt top border as a walkable platform (full width)
  if (inputIdx != null) {
    const promptPlatY = textOffsetY + inputIdx * lineHeight + 2;
    platforms.push({ y: promptPlatY, x: textOffsetX, w: textWidth, hash: 0xFFFF });
  }

  // Prompt area bounding box
  let promptArea = null;
  if (inputIdx != null) {
    const promptY = textOffsetY + inputIdx * lineHeight + 2;
    const promptLines = footerIdx != null ? footerIdx - inputIdx : fitLines - inputIdx;
    promptArea = {
      x: textOffsetX,
      y: promptY,
      w: textWidth,
      h: promptLines * lineHeight - 9,
    };
  }

  // Footer area bounding box
  let footerArea = null;
  if (footerIdx != null && promptArea) {
    const footerY = promptArea.y + promptArea.h;
    const footerBottom = textOffsetY + fitLines * lineHeight;
    footerArea = {
      x: textOffsetX,
      y: footerY,
      w: textWidth,
      h: footerBottom - footerY,
    };
  } else if (footerIdx != null) {
    const footerY = textOffsetY + footerIdx * lineHeight;
    const footerLines = fitLines - footerIdx;
    footerArea = {
      x: textOffsetX,
      y: footerY,
      w: textWidth,
      h: footerLines * lineHeight,
    };
  }

  return {
    platforms, promptArea, footerArea,
    textOffsetX, textOffsetY, textWidth, textHeight, lineHeight,
    cachedInputIdx: newCachedInputIdx,
    cachedFooterIdx: newCachedFooterIdx,
    lastDebugLines, lastInputLine, lastFooterLine,
  };
}
