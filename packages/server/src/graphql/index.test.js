const test = require('node:test');
const assert = require('node:assert/strict');

const { createResolvers } = require('./index');

const createResolverHarness = (overrides = {}) => {
  const calls = [];
  const processRegistry = {
    async getSlaveRuntimeState(input) {
      calls.push({ method: 'getSlaveRuntimeState', input });
      return overrides.getSlaveRuntimeStateResult || null;
    },
    async listDesiredProcesses(input) {
      calls.push({ method: 'listDesiredProcesses', input });
      return overrides.listDesiredProcessesResult || [];
    },
    async ensureDesiredProcess(input) {
      calls.push({ method: 'ensureDesiredProcess', input });
      return overrides.ensureDesiredProcessResult || null;
    },
    async deleteDesiredProcessDefinition(input) {
      calls.push({ method: 'deleteDesiredProcessDefinition', input });
      return overrides.deleteDesiredProcessDefinitionResult ?? true;
    },
    async queueProcessKill(input) {
      calls.push({ method: 'queueProcessKill', input });
      return overrides.queueProcessKillResult || { commandId: 'kill-1', status: 'queued' };
    },
  };

  const resolvers = createResolvers({
    discoveryConfig: { projectPath: '/tmp', folderPattern: '.*', maxDepth: 2 },
    validateAndNormalizeConfig: async (value) => value,
    discoverProjects: async () => ({ rootPath: '/tmp', folderPattern: '.*', maxDepth: 2, scannedAt: new Date().toISOString(), projects: [] }),
    addCustomProjectPath: async () => ({}),
    listHosts: async () => [],
    addHost: async () => ({}),
    deleteHost: async () => true,
    addHostDirectory: async () => ({}),
    removeHostDirectory: async () => ({}),
    checkoutHostProject: async () => ({}),
    upgradeHostAgent: async () => ({}),
    getTerminalSession: async () => null,
    startHostTerminalSession: async () => null,
    sendHostTerminalInput: async () => true,
    closeHostTerminalSession: async () => true,
    processRegistry,
    runtimeBackend: {
      name: 'go-master',
      getProjectRuntime: async () => ({}),
      getProjectLogs: async () => [],
      getProjectLaunchEnvironment: async () => [],
      getProjectPortRangeSettings: async () => ({ mode: 'automatic', begin: null }),
      getProjectProcessStats: async () => [],
    },
    serverVersion: '0.1.0',
    serverProtocolVersion: 'v1',
    serverSlaveTargetVersion: '0.1.0',
  });

  return {
    resolvers,
    calls,
  };
};

test('slaveRuntimeState query maps desired processes, observed runs, and host telemetry', async () => {
  const { resolvers, calls } = createResolverHarness({
    getSlaveRuntimeStateResult: {
      host: {
        id: 7,
        agentUuid: 'slave-7',
        ip: '192.168.1.7',
        port: 42050,
        name: 'blackbox',
        source: 'runtime',
        online: true,
        health: 'healthy',
        status: 'registered',
        metadata: { directories: ['/srv/projects'] },
      },
      desiredProcesses: [
        {
          id: 101,
          hostId: 7,
          projectId: 3,
          serviceId: 9,
          processKey: 'api',
          packageKey: 'api',
          cwd: '/srv/projects/api',
          command: 'yarn',
          argsJson: ['dev'],
          envJson: { NODE_ENV: 'development' },
          desiredState: 'running',
          launchMode: 'exec',
          host: { agentUuid: 'slave-7', name: 'blackbox' },
          project: { name: 'api-project', metadata: { path: '/srv/projects/api' } },
          service: { name: 'api' },
        },
      ],
      processRuns: [
        {
          id: 501,
          runId: 'run-501',
          desiredProcessId: 101,
          hostId: 7,
          projectId: 3,
          serviceId: 9,
          slaveId: 'slave-7',
          bootId: 'boot-7',
          packageKey: 'api',
          pid: 1234,
          pgid: 1234,
          command: 'yarn',
          argsJson: ['dev'],
          cwd: '/srv/projects/api',
          status: 'running',
          runtimeState: {
            sampledAt: '2026-03-09T02:00:00Z',
            cpuPercent: 1.5,
            memoryPercent: 2.5,
            rssBytes: 1000,
            vmsBytes: 2000,
            readBytes: 3000,
            writeBytes: 4000,
            readOps: 5,
            writeOps: 6,
            status: 'running',
          },
        },
      ],
      hostRuntimeState: {
        sampledAt: '2026-03-09T02:00:00Z',
        cpuPercent: 10,
        memoryTotalBytes: 10000,
        memoryUsedBytes: 5000,
        memoryAvailableBytes: 5000,
        diskTotalBytes: 100000,
        diskUsedBytes: 40000,
        diskAvailableBytes: 60000,
        diskMount: '/srv',
      },
    },
  });

  const result = await resolvers.Query.slaveRuntimeState(null, { agentUuid: 'slave-7' });
  assert.equal(calls[0].method, 'getSlaveRuntimeState');
  assert.equal(calls[0].input.slaveId, 'slave-7');
  assert.equal(result.host.id, 7);
  assert.equal(result.desiredProcesses.length, 1);
  assert.equal(result.desiredProcesses[0].env[0].key, 'NODE_ENV');
  assert.equal(result.observedRuns.length, 1);
  assert.equal(result.observedRuns[0].runtimeState.cpuPercent, 1.5);
  assert.equal(result.hostRuntimeState.diskMount, '/srv');
});

test('ensureDesiredProcess mutation forwards env entries and maps the created process', async () => {
  const { resolvers, calls } = createResolverHarness({
    ensureDesiredProcessResult: {
      id: 202,
      hostId: 8,
      projectId: 5,
      processKey: 'worker',
      packageKey: 'worker',
      cwd: '/srv/projects/worker',
      command: 'node',
      argsJson: ['server.js'],
      envJson: { PORT: '3000' },
      desiredState: 'running',
      launchMode: 'exec',
      host: { agentUuid: 'slave-8', name: 'mac' },
      project: { name: 'worker-project', metadata: { path: '/srv/projects/worker' } },
    },
  });

  const result = await resolvers.Mutation.ensureDesiredProcess(null, {
    hostId: 8,
    projectId: 5,
    processKey: 'worker',
    packageKey: 'worker',
    launchMode: 'exec',
    cwd: '/srv/projects/worker',
    command: 'node',
    args: ['server.js'],
    env: [{ key: 'PORT', value: '3000' }],
  });

  assert.equal(calls[0].method, 'ensureDesiredProcess');
  assert.deepEqual(calls[0].input.envJson, { PORT: '3000' });
  assert.equal(result.id, 202);
  assert.equal(result.env[0].key, 'PORT');
});

test('ensureDesiredProcess mutation forwards desiredProcessId for edits', async () => {
  const { resolvers, calls } = createResolverHarness({
    ensureDesiredProcessResult: {
      id: 22,
      hostId: 4,
      projectId: 8,
      processKey: 'worker',
      packageKey: 'worker',
      projectPath: '/tmp/managed-app',
      desiredState: 'running',
      launchMode: 'exec',
      cwd: '/tmp/managed-app',
      command: 'yarn',
      argsJson: ['dev'],
      restartPolicy: 'manual',
      updatedAt: new Date('2026-03-09T10:15:00.000Z'),
    },
  });

  await resolvers.Mutation.ensureDesiredProcess(null, {
    desiredProcessId: 22,
    hostId: 4,
    projectId: 8,
    processKey: 'worker',
    packageKey: 'worker',
    launchMode: 'exec',
    cwd: '/tmp/managed-app',
    command: 'yarn',
  });

  assert.equal(calls[0].method, 'ensureDesiredProcess');
  assert.equal(calls[0].input.desiredProcessId, 22);
});

test('softKillProcess and hardKillProcess mutations queue kill commands with the correct hard flag', async () => {
  const { resolvers, calls } = createResolverHarness();

  const softResult = await resolvers.Mutation.softKillProcess(null, {
    agentUuid: 'slave-9',
    runId: 'run-soft',
    reason: 'graceful stop',
  });
  const hardResult = await resolvers.Mutation.hardKillProcess(null, {
    hostId: 9,
    pid: 999,
    reason: 'force stop',
  });

  assert.equal(calls[0].method, 'queueProcessKill');
  assert.equal(calls[0].input.hard, false);
  assert.equal(calls[0].input.slaveId, 'slave-9');
  assert.equal(softResult.status, 'queued');
  assert.equal(calls[1].method, 'queueProcessKill');
  assert.equal(calls[1].input.hard, true);
  assert.equal(calls[1].input.hostId, 9);
  assert.equal(hardResult.message, 'hard kill command queued');
});
