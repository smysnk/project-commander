const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePositiveHostId,
  resolveTerminalSubmitRequest,
} = require('./terminalActionUtils.cjs');

test('normalizePositiveHostId accepts only positive integer host ids', () => {
  assert.equal(normalizePositiveHostId(1), 1);
  assert.equal(normalizePositiveHostId('12'), 12);
  assert.equal(normalizePositiveHostId(0), null);
  assert.equal(normalizePositiveHostId(-1), null);
  assert.equal(normalizePositiveHostId('abc'), null);
});

test('resolveTerminalSubmitRequest requires a valid selected host', () => {
  const next = resolveTerminalSubmitRequest({
    selectedHostId: 0,
    terminalSessionByHostId: {},
    terminalInputByHostId: {},
    normalizeSession: (value) => value,
  });

  assert.deepEqual(next, {
    ok: false,
    error: 'Select a host before running terminal commands.',
  });
});

test('resolveTerminalSubmitRequest requires active session with sessionId', () => {
  const next = resolveTerminalSubmitRequest({
    selectedHostId: 5,
    terminalSessionByHostId: {
      5: { sessionId: '', status: 'active' },
    },
    terminalInputByHostId: {},
    normalizeSession: (value) => value,
  });

  assert.deepEqual(next, {
    ok: false,
    error: 'Terminal session is not active.',
  });
});

test('resolveTerminalSubmitRequest returns payload for active session', () => {
  const next = resolveTerminalSubmitRequest({
    selectedHostId: 5,
    terminalSessionByHostId: {
      5: { sessionId: 'sess-1', status: 'active' },
    },
    terminalInputByHostId: {
      5: 'ls -la',
    },
    normalizeSession: (value) => value,
  });

  assert.deepEqual(next, {
    ok: true,
    hostId: 5,
    sessionId: 'sess-1',
    input: 'ls -la',
  });
});
