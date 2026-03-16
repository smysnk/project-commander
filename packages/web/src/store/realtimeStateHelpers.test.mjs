import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuntimeConnectionFingerprint,
  normalizeOverlayLogEntry,
} from './realtimeStateHelpers.mjs';

test('buildRuntimeConnectionFingerprint ignores volatile timestamp-only changes', () => {
  const left = buildRuntimeConnectionFingerprint({
    socketPath: '/tmp/project-commander/master.sock',
    target: 'unix:///tmp/project-commander/master.sock',
    service: 'pc-master',
    status: 'SERVING',
    connectionStatus: 'connected',
    connectionHealth: 'healthy',
    lastConnectedAt: '2026-03-09T17:45:56.359Z',
    lastAttemptAt: '2026-03-09T17:45:56.359Z',
    reconnectAttempts: 0,
    version: '0.1.5',
    protocolVersion: 'v1',
    startedAt: '2026-03-09T17:41:43.214625Z',
    capabilities: ['master.health'],
    grantedCapabilities: ['master.health'],
    error: null,
  });

  const right = buildRuntimeConnectionFingerprint({
    socketPath: '/tmp/project-commander/master.sock',
    target: 'unix:///tmp/project-commander/master.sock',
    service: 'pc-master',
    status: 'SERVING',
    connectionStatus: 'connected',
    connectionHealth: 'healthy',
    lastConnectedAt: '2026-03-09T17:46:10.677Z',
    lastAttemptAt: '2026-03-09T17:46:10.677Z',
    reconnectAttempts: 0,
    version: '0.1.5',
    protocolVersion: 'v1',
    startedAt: '2026-03-09T17:41:43.214625Z',
    capabilities: ['master.health'],
    grantedCapabilities: ['master.health'],
    error: null,
  });

  assert.equal(left, right);
});

test('normalizeOverlayLogEntry normalizes overlay websocket payloads', () => {
  const entry = normalizeOverlayLogEntry({
    timestamp: '2026-03-09T17:45:55.993Z',
    serviceName: 'deploy',
    source: 'node-backend',
    hostId: '62',
    hostName: 'clearbox',
    hostIp: '192.168.1.251',
    stream: 'stdout',
    level: 'INFO',
    message: 'hello world  \n',
  }, { id: 'overlay-1' });

  assert.deepEqual(entry, {
    id: 'overlay-1',
    projectPath: '@overlay',
    timestamp: '2026-03-09T17:45:55.993Z',
    serviceName: 'deploy',
    level: 'info',
    source: 'node-backend',
    hostId: 62,
    hostName: 'clearbox',
    hostIp: '192.168.1.251',
    agentUuid: null,
    slaveId: null,
    stream: 'stdout',
    message: 'hello world',
  });
});
