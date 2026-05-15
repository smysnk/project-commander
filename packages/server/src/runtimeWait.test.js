const http = require('http');
const net = require('net');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeWaiter } = require('./runtimeWait');

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

const createHarness = ({
  runtimeState,
  logs = [],
  processTemplates = null,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const calls = [];
  const waiter = createRuntimeWaiter({
    processRegistry: {
      async getSlaveRuntimeState(input) {
        calls.push({ method: 'getSlaveRuntimeState', input });
        return runtimeState || {
          host: { id: 7, agentUuid: 'slave-7', name: 'clearbox', ip: '127.0.0.1' },
          processRuns: [],
        };
      },
    },
    runtimeBackend: {
      async getManagedProcessLogs(input) {
        calls.push({ method: 'getManagedProcessLogs', input });
        return logs.map((message, index) => ({
          id: index + 1,
          message,
        }));
      },
      async getSlaveLogs(input) {
        calls.push({ method: 'getSlaveLogs', input });
        return logs.map((message, index) => ({
          id: index + 1,
          message,
        }));
      },
    },
    processTemplates,
    fetchImpl,
  });

  return { waiter, calls };
};

test('waitForRuntime matches observed process status', async () => {
  const { waiter } = createHarness({
    runtimeState: {
      host: { id: 7, agentUuid: 'slave-7', name: 'clearbox' },
      processRuns: [{
        runId: 'run-1',
        hostId: 7,
        projectId: 19,
        packageKey: 'web',
        pid: 1234,
        command: 'yarn dev',
        argsJson: [],
        status: 'running',
      }],
    },
  });

  const result = await waiter.waitForRuntime({
    hostId: 7,
    projectId: 19,
    processKey: 'web',
    timeoutMs: 100,
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.matchedCheck, 'process_status');
  assert.equal(result.observedRun.runId, 'run-1');
});

test('waitForRuntime performs http health checks', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ready');
  });
  const port = await listen(server);
  try {
    const { waiter } = createHarness();
    const result = await waiter.waitForRuntime({
      healthChecksJson: JSON.stringify([{
        type: 'http',
        url: `http://127.0.0.1:${port}/`,
        expectedStatus: 200,
        bodyIncludes: 'ready',
      }]),
      timeoutMs: 1000,
    });

    assert.equal(result.status, 'matched');
    assert.equal(result.matchedCheck, 'http');
    assert.equal(result.httpStatus, 200);
  } finally {
    await close(server);
  }
});

test('waitForRuntime performs tcp health checks', async () => {
  const server = net.createServer((socket) => socket.end());
  const port = await listen(server);
  try {
    const { waiter } = createHarness();
    const result = await waiter.waitForRuntime({
      healthChecksJson: JSON.stringify([{
        type: 'tcp',
        host: '127.0.0.1',
        port,
      }]),
      timeoutMs: 1000,
    });

    assert.equal(result.status, 'matched');
    assert.equal(result.matchedCheck, 'tcp');
  } finally {
    await close(server);
  }
});

test('waitForRuntime follows managed process logs for log-pattern checks', async () => {
  const { waiter, calls } = createHarness({
    runtimeState: {
      host: { id: 7, agentUuid: 'slave-7', name: 'clearbox' },
      processRuns: [{
        runId: 'run-ready',
        hostId: 7,
        projectId: 19,
        packageKey: 'web',
        pid: 1234,
        command: 'yarn dev',
        argsJson: [],
        status: 'running',
      }],
    },
    logs: ['booting', 'Ready on http://localhost:3010'],
  });

  const result = await waiter.waitForRuntime({
    hostId: 7,
    agentUuid: 'slave-7',
    projectId: 19,
    processKey: 'web',
    healthChecksJson: JSON.stringify([{
      type: 'log_pattern',
      pattern: 'Ready',
    }]),
    timeoutMs: 100,
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.matchedCheck, 'log_pattern');
  assert.ok(result.lastLogLines.some((line) => line.includes('Ready')));
  assert.equal(calls.some((call) => call.method === 'getManagedProcessLogs'), true);
});

test('waitForRuntime returns timeout diagnostics with recent logs', async () => {
  const { waiter } = createHarness({
    runtimeState: {
      host: { id: 7, agentUuid: 'slave-7', name: 'clearbox' },
      processRuns: [{
        runId: 'run-slow',
        hostId: 7,
        projectId: 19,
        packageKey: 'web',
        pid: 1234,
        command: 'yarn dev',
        argsJson: [],
        status: 'starting',
      }],
    },
    logs: ['still booting'],
  });

  const result = await waiter.waitForRuntime({
    hostId: 7,
    agentUuid: 'slave-7',
    projectId: 19,
    processKey: 'web',
    healthChecksJson: JSON.stringify([{
      type: 'log_pattern',
      pattern: 'Ready',
    }]),
    timeoutMs: 5,
    intervalMs: 1,
  });

  assert.equal(result.status, 'timeout');
  assert.equal(result.failedCheck, 'log_pattern');
  assert.deepEqual(result.lastLogLines, ['still booting']);
});

test('waitForRuntime compiles template health checks before evaluation', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('template-ready');
  });
  const port = await listen(server);
  try {
    const { waiter } = createHarness({
      processTemplates: {
        async resolveProcessTemplate() {
          return {
            host: { id: 7, agentUuid: 'slave-7', name: 'clearbox', ip: '127.0.0.1' },
            project: { id: 19, name: 'varcad.io' },
            desiredProcess: {
              hostId: 7,
              slaveId: 'slave-7',
              projectId: 19,
              projectPath: '/srv/varcad.io',
              packageKey: 'web',
              packageRelativePath: '.',
              envJson: {},
            },
            healthChecksJson: [{
              type: 'http',
              url: `http://{{host.ip}}:${port}/`,
              expectedStatus: 200,
              bodyIncludes: 'template-ready',
            }],
          };
        },
      },
    });

    const result = await waiter.waitForRuntime({
      hostId: 7,
      projectId: 19,
      templateKey: 'node.dev',
      timeoutMs: 1000,
    });

    assert.equal(result.status, 'matched');
    assert.equal(result.matchedCheck, 'http');
  } finally {
    await close(server);
  }
});

test('waitForRuntime matches one-shot process exit codes', async () => {
  const { waiter } = createHarness({
    runtimeState: {
      host: { id: 7, agentUuid: 'slave-7', name: 'clearbox' },
      processRuns: [{
        runId: 'run-build',
        hostId: 7,
        projectId: 19,
        packageKey: 'build',
        pid: 1234,
        command: 'yarn build',
        argsJson: [],
        status: 'exited',
        exitCode: 0,
      }],
    },
  });

  const result = await waiter.waitForRuntime({
    hostId: 7,
    projectId: 19,
    packageKey: 'build',
    expectedExitCode: 0,
    timeoutMs: 100,
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.matchedCheck, 'command_exit');
});
