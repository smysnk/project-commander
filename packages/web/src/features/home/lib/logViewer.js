export const LOG_VIEWER_TAIL_INITIAL_LINES = 100;
export const LOG_VIEWER_TAIL_STEP_LINES = 100;
export const LOG_VIEWER_TAIL_MAX_LINES = 1200;
export const LOG_VIEWER_TOP_EDGE_PX = 28;

const clampInteger = (value, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return min;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
};

export const normalizeTailLineCount = (value) => (
  clampInteger(value, LOG_VIEWER_TAIL_INITIAL_LINES, LOG_VIEWER_TAIL_MAX_LINES)
);

export const getNextTailLineCount = (current) => {
  const normalizedCurrent = normalizeTailLineCount(current);
  return clampInteger(
    normalizedCurrent + LOG_VIEWER_TAIL_STEP_LINES,
    LOG_VIEWER_TAIL_INITIAL_LINES,
    LOG_VIEWER_TAIL_MAX_LINES,
  );
};

export const buildTailWindowStreamRequest = (tailLineCount) => {
  const normalizedTailLineCount = normalizeTailLineCount(tailLineCount);
  return {
    streamId: 'merged',
    // Negative offset means "seek from the end of the stream".
    offset: -normalizedTailLineCount,
    limit: normalizedTailLineCount,
  };
};

