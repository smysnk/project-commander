const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LOG_VIEWER_TAIL_INITIAL_LINES,
  LOG_VIEWER_TAIL_MAX_LINES,
  normalizeTailLineCount,
  getNextTailLineCount,
  buildTailWindowStreamRequest,
} = require('./logViewer');

test('normalizeTailLineCount clamps invalid values to configured bounds', () => {
  assert.equal(normalizeTailLineCount(undefined), LOG_VIEWER_TAIL_INITIAL_LINES);
  assert.equal(normalizeTailLineCount(0), LOG_VIEWER_TAIL_INITIAL_LINES);
  assert.equal(normalizeTailLineCount(-250), LOG_VIEWER_TAIL_INITIAL_LINES);
  assert.equal(normalizeTailLineCount(LOG_VIEWER_TAIL_MAX_LINES + 500), LOG_VIEWER_TAIL_MAX_LINES);
});

test('getNextTailLineCount increments in fixed steps and clamps at max', () => {
  assert.equal(
    getNextTailLineCount(LOG_VIEWER_TAIL_INITIAL_LINES),
    LOG_VIEWER_TAIL_INITIAL_LINES + 100,
  );
  assert.equal(
    getNextTailLineCount(LOG_VIEWER_TAIL_MAX_LINES),
    LOG_VIEWER_TAIL_MAX_LINES,
  );
});

test('buildTailWindowStreamRequest uses negative offsets for tail seeking', () => {
  const request = buildTailWindowStreamRequest(180);
  assert.deepEqual(request, {
    streamId: 'merged',
    offset: -180,
    limit: 180,
  });
});
