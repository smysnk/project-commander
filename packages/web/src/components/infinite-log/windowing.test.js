const test = require('node:test');
const assert = require('node:assert/strict');
const windowing = require('./windowing');

test('computeStreamWindowRequests supports multiple streams with independent totals and offsets', () => {
  const streams = [
    {
      streamId: 'api',
      totalLines: 100,
      offset: 40,
      lines: Array.from({ length: 20 }, (_, index) => ({ message: `api-${index}` })),
    },
    {
      streamId: 'worker',
      totalLines: 60,
      offset: 10,
      lines: Array.from({ length: 15 }, (_, index) => ({ message: `worker-${index}` })),
    },
  ];

  const requests = windowing.computeStreamWindowRequests({
    streams,
    start: 90,
    endExclusive: 130,
  });

  assert.deepEqual(requests, [
    {
      streamId: 'api',
      offset: 90,
      limit: 10,
      totalLines: 100,
    },
    {
      streamId: 'worker',
      offset: 0,
      limit: 30,
      totalLines: 60,
    },
  ]);
});

test('computeWindowFromScroll loads lines above and below current scroll anchor', () => {
  const range = windowing.computeWindowFromScroll({
    scrollTop: 440,
    viewportHeight: 220,
    lineHeight: 22,
    overscanAbove: 8,
    overscanBelow: 12,
    totalLines: 500,
  });

  assert.equal(range.anchorLine, 20);
  assert.equal(range.visibleLines, 10);
  assert.equal(range.start, 12);
  assert.equal(range.endExclusive, 42);
});

test('flattenLoadedStreamLines preserves global index alignment with stream offsets', () => {
  const flattened = windowing.flattenLoadedStreamLines([
    {
      streamId: 'alpha',
      totalLines: 5,
      offset: 2,
      lines: [{ message: 'a2' }, { message: 'a3' }],
    },
    {
      streamId: 'beta',
      totalLines: 4,
      offset: 1,
      lines: [{ message: 'b1' }, { message: 'b2' }],
    },
  ]);

  assert.deepEqual(
    flattened.map((entry) => ({
      streamId: entry.streamId,
      globalIndex: entry.globalIndex,
      streamLineIndex: entry.streamLineIndex,
      text: entry.line.message,
    })),
    [
      { streamId: 'alpha', globalIndex: 2, streamLineIndex: 2, text: 'a2' },
      { streamId: 'alpha', globalIndex: 3, streamLineIndex: 3, text: 'a3' },
      { streamId: 'beta', globalIndex: 6, streamLineIndex: 1, text: 'b1' },
      { streamId: 'beta', globalIndex: 7, streamLineIndex: 2, text: 'b2' },
    ],
  );
});

test('computeTagRowStyle aligns ad-hoc tag rows to log text line height', () => {
  const style = windowing.computeTagRowStyle({
    localIndex: 7,
    lineHeight: 22,
  });
  assert.equal(style.top, 154);
  assert.equal(style.height, 22);
  assert.equal(style.lineHeight, 22);
});
