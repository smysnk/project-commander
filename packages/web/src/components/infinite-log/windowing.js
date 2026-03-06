const DEFAULT_LINE_HEIGHT_PX = 22;
const DEFAULT_OVERSCAN_ABOVE_LINES = 120;
const DEFAULT_OVERSCAN_BELOW_LINES = 180;

const clamp = (value, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
};

const normalizeStreamRecord = (stream) => {
  const streamId = String(stream?.streamId || stream?.id || '').trim();
  const totalLines = Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0);
  const offset = clamp(
    Number.parseInt(stream?.offset, 10) || 0,
    0,
    totalLines,
  );
  const lines = Array.isArray(stream?.lines) ? stream.lines : [];
  return {
    streamId,
    totalLines,
    offset,
    lines,
  };
};

const getTotalLineCount = (streams) => (
  (Array.isArray(streams) ? streams : [])
    .map((stream) => normalizeStreamRecord(stream))
    .reduce((sum, stream) => sum + stream.totalLines, 0)
);

const computeWindowFromScroll = ({
  scrollTop = 0,
  viewportHeight = 0,
  lineHeight = DEFAULT_LINE_HEIGHT_PX,
  overscanAbove = DEFAULT_OVERSCAN_ABOVE_LINES,
  overscanBelow = DEFAULT_OVERSCAN_BELOW_LINES,
  totalLines = 0,
} = {}) => {
  const normalizedTotalLines = Math.max(0, Number.parseInt(totalLines, 10) || 0);
  if (normalizedTotalLines <= 0) {
    return {
      start: 0,
      endExclusive: 0,
      anchorLine: 0,
      visibleLines: 0,
    };
  }

  const normalizedLineHeight = Math.max(1, Number.parseInt(lineHeight, 10) || DEFAULT_LINE_HEIGHT_PX);
  const normalizedViewportHeight = Math.max(0, Number.parseInt(viewportHeight, 10) || 0);
  const visibleLines = Math.max(1, Math.ceil(normalizedViewportHeight / normalizedLineHeight));
  const anchorLine = clamp(
    Math.floor(Math.max(0, Number(scrollTop) || 0) / normalizedLineHeight),
    0,
    Math.max(0, normalizedTotalLines - 1),
  );
  const start = clamp(
    anchorLine - Math.max(0, Number.parseInt(overscanAbove, 10) || 0),
    0,
    normalizedTotalLines,
  );
  const endExclusive = clamp(
    anchorLine + visibleLines + Math.max(0, Number.parseInt(overscanBelow, 10) || 0),
    0,
    normalizedTotalLines,
  );
  return {
    start,
    endExclusive,
    anchorLine,
    visibleLines,
  };
};

const computeStreamWindowRequests = ({
  streams,
  start = 0,
  endExclusive = 0,
} = {}) => {
  const normalizedStreams = (Array.isArray(streams) ? streams : []).map((stream) => normalizeStreamRecord(stream));
  const normalizedStart = Math.max(0, Number.parseInt(start, 10) || 0);
  const normalizedEnd = Math.max(normalizedStart, Number.parseInt(endExclusive, 10) || normalizedStart);
  const requests = [];
  let globalCursor = 0;

  for (const stream of normalizedStreams) {
    const streamStart = globalCursor;
    const streamEnd = streamStart + stream.totalLines;
    globalCursor = streamEnd;
    if (stream.totalLines <= 0 || !stream.streamId) {
      continue;
    }
    const sliceStart = Math.max(streamStart, normalizedStart);
    const sliceEnd = Math.min(streamEnd, normalizedEnd);
    if (sliceEnd <= sliceStart) {
      continue;
    }
    requests.push({
      streamId: stream.streamId,
      offset: sliceStart - streamStart,
      limit: sliceEnd - sliceStart,
      totalLines: stream.totalLines,
    });
  }

  return requests;
};

const flattenLoadedStreamLines = (streams) => {
  const normalizedStreams = (Array.isArray(streams) ? streams : []).map((stream) => normalizeStreamRecord(stream));
  const flattened = [];
  let globalCursor = 0;

  for (const stream of normalizedStreams) {
    const streamStart = globalCursor;
    globalCursor += stream.totalLines;
    if (!stream.streamId || stream.lines.length === 0) {
      continue;
    }
    for (let index = 0; index < stream.lines.length; index += 1) {
      const globalIndex = streamStart + stream.offset + index;
      if (globalIndex < streamStart || globalIndex >= streamStart + stream.totalLines) {
        continue;
      }
      flattened.push({
        streamId: stream.streamId,
        globalIndex,
        streamLineIndex: stream.offset + index,
        line: stream.lines[index],
      });
    }
  }

  return flattened.sort((left, right) => left.globalIndex - right.globalIndex);
};

const computeTagRowStyle = ({ localIndex = 0, lineHeight = DEFAULT_LINE_HEIGHT_PX } = {}) => {
  const normalizedLocalIndex = Math.max(0, Number.parseInt(localIndex, 10) || 0);
  const normalizedLineHeight = Math.max(1, Number.parseInt(lineHeight, 10) || DEFAULT_LINE_HEIGHT_PX);
  const top = normalizedLocalIndex * normalizedLineHeight;
  return {
    top,
    height: normalizedLineHeight,
    lineHeight: normalizedLineHeight,
  };
};

module.exports = {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_OVERSCAN_ABOVE_LINES,
  DEFAULT_OVERSCAN_BELOW_LINES,
  clamp,
  normalizeStreamRecord,
  getTotalLineCount,
  computeWindowFromScroll,
  computeStreamWindowRequests,
  flattenLoadedStreamLines,
  computeTagRowStyle,
};
