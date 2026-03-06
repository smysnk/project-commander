const test = require('node:test');
const assert = require('node:assert/strict');
const protocol = require('./logQueryProtocol');

test('buildLogsQueryMessage produces websocket-compatible payload with sanitized streams', () => {
  const payload = protocol.buildLogsQueryMessage({
    requestId: 'req-123',
    context: {
      scope: 'project',
      contextKey: 'project:/tmp/app',
      projectPath: '/tmp/app',
      hostId: null,
    },
    streams: [
      { streamId: 'merged', offset: 10, limit: 80 },
      { streamId: 'api', offset: -3, limit: 0 },
      { streamId: '', offset: 0, limit: 20 },
    ],
  });

  assert.deepEqual(payload, {
    action: 'logs.query',
    requestId: 'req-123',
    context: {
      scope: 'project',
      contextKey: 'project:/tmp/app',
      projectPath: '/tmp/app',
      hostId: null,
      hostName: null,
      hostIp: null,
      hostAgentUuid: null,
    },
    streams: [
      { streamId: 'merged', offset: 10, limit: 80 },
    ],
  });
});

test('buildLogsQueryMessage returns null when no valid stream windows are requested', () => {
  const payload = protocol.buildLogsQueryMessage({
    requestId: 'req-empty',
    streams: [{ streamId: 'merged', offset: 0, limit: 0 }],
  });
  assert.equal(payload, null);
});

test('buildLogsQueryMessage preserves negative offsets for tail-seek windows', () => {
  const payload = protocol.buildLogsQueryMessage({
    requestId: 'req-tail',
    context: {
      scope: 'host',
      contextKey: 'host:1',
      hostId: 1,
    },
    streams: [{ streamId: 'merged', offset: -100, limit: 100 }],
  });

  assert.deepEqual(payload?.streams, [
    { streamId: 'merged', offset: -100, limit: 100 },
  ]);
});

test('normalizeLogsQueryResult sanitizes incoming websocket query results', () => {
  const normalized = protocol.normalizeLogsQueryResult({
    kind: 'logs.query.result',
    requestId: 'req-10',
    contextKey: 'runtime',
    scope: 'runtime',
    streams: [
      {
        streamId: 'merged',
        totalLines: 200,
        offset: 40,
        lines: [{ id: 1, message: 'line-1' }],
      },
      {
        streamId: '',
        totalLines: 1,
        offset: 0,
        lines: [{ id: 2, message: 'line-2' }],
      },
    ],
  });

  assert.deepEqual(normalized, {
    kind: 'logs.query.result',
    requestId: 'req-10',
    contextKey: 'runtime',
    scope: 'runtime',
    streams: [
      {
        streamId: 'merged',
        totalLines: 200,
        offset: 40,
        lines: [{ id: 1, message: 'line-1' }],
      },
    ],
  });
});
