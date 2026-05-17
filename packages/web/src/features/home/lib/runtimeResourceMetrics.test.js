const test = require('node:test');
const assert = require('node:assert/strict');

const {
  appendDeploymentResourceHistory,
  buildDeploymentResourceSamples,
  isActiveObservedRunForMetrics,
} = require('./runtimeResourceMetrics');

test('buildDeploymentResourceSamples groups active observed runs by deployment', () => {
  const samples = buildDeploymentResourceSamples([
    {
      deploymentId: 2,
      deploymentKey: 'local',
      deploymentName: 'Local',
      projectPath: '/srv/app',
      packageKey: 'web',
      pid: 101,
      status: 'running',
      runtimeState: {
        sampledAt: '2026-05-17T10:00:00.000Z',
        cpuPercent: 7.5,
        memoryPercent: 1.1,
        rssBytes: 1024,
        readBytes: 200,
        writeBytes: 300,
      },
    },
    {
      deploymentId: 2,
      deploymentKey: 'local',
      deploymentName: 'Local',
      projectPath: '/srv/app',
      packageKey: 'api',
      pid: 102,
      status: 'sleeping',
      runtimeState: {
        sampledAt: '2026-05-17T10:00:01.000Z',
        cpuPercent: 2.5,
        memoryPercent: 0.4,
        rssBytes: 2048,
        readBytes: 400,
        writeBytes: 700,
      },
    },
    {
      deploymentId: 3,
      deploymentKey: 'old',
      projectPath: '/srv/app',
      packageKey: 'worker',
      pid: 103,
      status: 'exited',
      runtimeState: {
        cpuPercent: 99,
      },
    },
  ]);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].key, 'deployment:2');
  assert.equal(samples[0].label, 'Local');
  assert.equal(samples[0].runCount, 2);
  assert.deepEqual(samples[0].pids, [101, 102]);
  assert.deepEqual(samples[0].packageKeys, ['api', 'web']);
  assert.equal(samples[0].cpuPercent, 10);
  assert.equal(samples[0].rssBytes, 3072);
  assert.equal(samples[0].readBytes, 600);
  assert.equal(samples[0].writeBytes, 1000);
  assert.equal(samples[0].sampledAt, '2026-05-17T10:00:01.000Z');
});

test('isActiveObservedRunForMetrics rejects terminal or missing-pid rows', () => {
  assert.equal(isActiveObservedRunForMetrics({ pid: 42, status: 'running' }), true);
  assert.equal(isActiveObservedRunForMetrics({ pid: 0, status: 'running' }), false);
  assert.equal(isActiveObservedRunForMetrics({ pid: 42, status: 'exited' }), false);
  assert.equal(isActiveObservedRunForMetrics({ pid: 42, runtimeState: { status: 'terminated' } }), false);
});

test('appendDeploymentResourceHistory caps history and computes io deltas', () => {
  const first = appendDeploymentResourceHistory({}, [
    {
      key: 'deployment:2',
      label: 'Local',
      readBytes: 100,
      writeBytes: 300,
      cpuPercent: 1,
      rssBytes: 1024,
    },
  ], { nowMs: 1000, limit: 2 });

  const second = appendDeploymentResourceHistory(first, [
    {
      key: 'deployment:2',
      label: 'Local',
      readBytes: 250,
      writeBytes: 650,
      cpuPercent: 2,
      rssBytes: 2048,
    },
  ], { nowMs: 2000, limit: 2 });

  const third = appendDeploymentResourceHistory(second, [
    {
      key: 'deployment:2',
      label: 'Local',
      readBytes: 450,
      writeBytes: 900,
      cpuPercent: 3,
      rssBytes: 4096,
    },
  ], { nowMs: 3000, limit: 2 });

  assert.equal(third['deployment:2'].length, 2);
  assert.equal(third['deployment:2'][1].readBytesPerSecond, 200);
  assert.equal(third['deployment:2'][1].writeBytesPerSecond, 250);
  assert.equal(third['deployment:2'][1].ioBytesPerSecond, 450);
});
