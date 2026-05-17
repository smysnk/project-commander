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
  const hostPathMappings = {
    async listHostPathMappings(input) {
      calls.push({ method: 'listHostPathMappings', input });
      return overrides.listHostPathMappingsResult || [];
    },
    async resolveHostPath(input) {
      calls.push({ method: 'resolveHostPath', input });
      return overrides.resolveHostPathResult || null;
    },
    async upsertHostPathMapping(input) {
      calls.push({ method: 'upsertHostPathMapping', input });
      return overrides.upsertHostPathMappingResult || null;
    },
    async deleteHostPathMapping(input) {
      calls.push({ method: 'deleteHostPathMapping', input });
      return overrides.deleteHostPathMappingResult ?? true;
    },
  };
  const processTemplates = {
    async listProcessTemplates(input) {
      calls.push({ method: 'listProcessTemplates', input });
      return overrides.listProcessTemplatesResult || [];
    },
    async resolveProcessTemplate(input) {
      calls.push({ method: 'resolveProcessTemplate', input });
      return overrides.resolveProcessTemplateResult || null;
    },
    async ensureProcessFromTemplate(input) {
      calls.push({ method: 'ensureProcessFromTemplate', input });
      return overrides.ensureProcessFromTemplateResult || null;
    },
    async upsertProcessTemplate(input) {
      calls.push({ method: 'upsertProcessTemplate', input });
      return overrides.upsertProcessTemplateResult || null;
    },
    async deleteProcessTemplate(input) {
      calls.push({ method: 'deleteProcessTemplate', input });
      return overrides.deleteProcessTemplateResult ?? true;
    },
  };
  const runtimeWait = {
    async waitForRuntime(input) {
      calls.push({ method: 'waitForRuntime', input });
      return overrides.waitForRuntimeResult || {
        status: 'timeout',
        elapsedMs: 0,
        lastLogLines: [],
      };
    },
  };

  const resolvers = createResolvers({
    discoveryConfig: { projectPath: '/tmp', folderPattern: '.*', maxDepth: 2 },
    validateAndNormalizeConfig: async (value) => value,
    discoverProjects: async () => ({ rootPath: '/tmp', folderPattern: '.*', maxDepth: 2, scannedAt: new Date().toISOString(), projects: [] }),
    addCustomProjectPath: async () => ({}),
    listHosts: async () => [],
    addHost: async () => ({}),
    deleteHost: async (...args) => {
      calls.push({ method: 'deleteHost', args });
      return overrides.deleteHostResult ?? true;
    },
    addHostDirectory: async () => ({}),
    removeHostDirectory: async () => ({}),
    checkoutHostProject: async () => ({}),
    upgradeHostAgent: async () => ({}),
    getTerminalSession: async () => null,
    startHostTerminalSession: async () => null,
    sendHostTerminalInput: async () => true,
    closeHostTerminalSession: async () => true,
    processRegistry,
    hostPathMappings,
    processTemplates,
    runtimeWait,
    automationTokenStore: overrides.automationTokenStore,
    lifecycleAccess: overrides.lifecycleAccess,
    runtimeAudit: overrides.runtimeAudit,
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
          processKey: 'api-dev',
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
  assert.equal(result.observedRuns[0].processKey, 'api-dev');
  assert.equal(result.observedRuns[0].packageKey, 'api');
  assert.equal(result.observedRuns[0].runtimeState.cpuPercent, 1.5);
  assert.equal(result.hostRuntimeState.diskMount, '/srv');
});

test('runtime process queries apply desired and observed run filters', async () => {
  const { resolvers, calls } = createResolverHarness({
    listDesiredProcessesResult: [
      {
        id: 101,
        hostId: 7,
        projectId: 3,
        processKey: 'api',
        packageKey: 'api',
        cwd: '/srv/projects/api',
        command: 'yarn',
        argsJson: ['dev'],
        envJson: {},
        desiredState: 'running',
        launchMode: 'exec',
        host: { agentUuid: 'slave-7', name: 'blackbox' },
        project: { name: 'api-project', metadata: { path: '/srv/projects/api' } },
      },
      {
        id: 102,
        hostId: 7,
        projectId: 4,
        processKey: 'worker',
        packageKey: 'worker',
        cwd: '/srv/projects/worker',
        command: 'node',
        argsJson: ['worker.js'],
        envJson: {},
        desiredState: 'stopped',
        launchMode: 'exec',
        host: { agentUuid: 'slave-7', name: 'blackbox' },
        project: { name: 'worker-project', metadata: { path: '/srv/projects/worker' } },
      },
    ],
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
      processRuns: [
        {
          id: 501,
          runId: 'run-api',
          hostId: 7,
          projectId: 3,
          slaveId: 'slave-7',
          packageKey: 'api',
          pid: 1234,
          command: 'yarn',
          argsJson: ['dev'],
          cwd: '/srv/projects/api',
          projectPath: '/srv/projects/api',
          status: 'running',
        },
        {
          id: 502,
          runId: 'run-worker',
          hostId: 7,
          projectId: 4,
          slaveId: 'slave-7',
          packageKey: 'worker',
          pid: 5678,
          command: 'node',
          argsJson: ['worker.js'],
          cwd: '/srv/projects/worker',
          projectPath: '/srv/projects/worker',
          status: 'exited',
        },
      ],
    },
  });

  const desired = await resolvers.Query.desiredProcesses(null, {
    hostId: 7,
    packageKey: 'api',
    search: 'yarn',
  });
  const observed = await resolvers.Query.observedProcessRuns(null, {
    hostId: 7,
    status: 'running',
    search: 'api',
  });

  assert.equal(desired.length, 1);
  assert.equal(desired[0].packageKey, 'api');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].runId, 'run-api');
  assert.equal(calls[0].input.packageKey, 'api');
  assert.equal(calls[0].input.search, 'yarn');
});

test('deleteHost mutation forwards directory content cleanup flag', async () => {
  const { resolvers, calls } = createResolverHarness();

  const deleted = await resolvers.Mutation.deleteHost(null, {
    hostId: 7,
    removeDirectoryContents: true,
  });

  assert.equal(deleted, true);
  assert.equal(calls[0].method, 'deleteHost');
  assert.deepEqual(calls[0].args, [7, { removeDirectoryContents: true }]);
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

test('path mapping queries and mutations forward to host path mapping catalog', async () => {
  const mapping = {
    id: 11,
    hostId: 7,
    agentUuid: 'slave-7',
    logicalRoot: 'clearbox-public',
    codexPathPrefix: '/Volumes/public-1/play',
    hostPathPrefix: '/opt/project-commander/slave/play',
    description: 'clearbox mounted play share',
    enabled: true,
    createdBy: 'test',
    updatedBy: 'test',
  };
  const { resolvers, calls } = createResolverHarness({
    listHostPathMappingsResult: [mapping],
    resolveHostPathResult: {
      inputPath: '/Volumes/public-1/play/varcad.io',
      codexPath: '/Volumes/public-1/play/varcad.io',
      hostPath: '/opt/project-commander/slave/play/varcad.io',
      source: 'mapping',
      approved: true,
      matchedRoot: '/opt/project-commander/slave/play',
      approvedRoots: ['/opt/project-commander/slave/play'],
      mapping,
    },
    upsertHostPathMappingResult: mapping,
  });

  const mappings = await resolvers.Query.hostPathMappings(null, {
    hostId: 7,
    includeDisabled: true,
  });
  const resolved = await resolvers.Query.resolveHostPath(null, {
    hostId: 7,
    path: '/Volumes/public-1/play/varcad.io',
  });
  const upserted = await resolvers.Mutation.upsertHostPathMapping(null, {
    hostId: 7,
    logicalRoot: 'clearbox-public',
    codexPathPrefix: '/Volumes/public-1/play',
    hostPathPrefix: '/opt/project-commander/slave/play',
    description: 'clearbox mounted play share',
    enabled: true,
    createdBy: 'test',
  });
  const deleted = await resolvers.Mutation.deleteHostPathMapping(null, {
    id: 11,
    hostId: 7,
  });

  assert.equal(calls[0].method, 'listHostPathMappings');
  assert.equal(calls[0].input.includeDisabled, true);
  assert.equal(mappings[0].codexPathPrefix, '/Volumes/public-1/play');
  assert.equal(calls[1].method, 'resolveHostPath');
  assert.equal(resolved.hostPath, '/opt/project-commander/slave/play/varcad.io');
  assert.equal(resolved.mapping.id, 11);
  assert.equal(calls[2].method, 'upsertHostPathMapping');
  assert.equal(upserted.logicalRoot, 'clearbox-public');
  assert.equal(calls[3].method, 'deleteHostPathMapping');
  assert.equal(deleted, true);
});

test('process template queries and mutations forward to process template catalog', async () => {
  const template = {
    id: 31,
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
    displayName: 'Node dev',
    packageKey: 'web',
    packageRelativePath: '.',
    processKeyTemplate: '{{package.key}}',
    cwdTemplate: '{{project.hostPath}}/packages/web',
    desiredState: 'running',
    launchMode: 'shell',
    command: 'yarn workspace web dev',
    argsJson: ['--host', '0.0.0.0'],
    envJson: { NODE_ENV: 'development' },
    restartPolicy: 'manual',
    healthChecksJson: [{ type: 'http', url: 'http://localhost:3010' }],
    enabled: true,
    allowCodex: true,
    source: 'persisted',
    scope: 'host_project',
  };
  const desiredProcess = {
    id: 44,
    hostId: 7,
    projectId: 19,
    slaveId: 'slave-7',
    processKey: 'web',
    packageKey: 'web',
    packageRelativePath: '.',
    projectPath: '/srv/varcad.io',
    desiredState: 'running',
    launchMode: 'shell',
    cwd: '/srv/varcad.io/packages/web',
    command: 'yarn workspace web dev',
    argsJson: ['--host', '0.0.0.0'],
    envJson: { NODE_ENV: 'development' },
    restartPolicy: 'manual',
    host: { agentUuid: 'slave-7', name: 'clearbox' },
    project: { name: 'varcad.io', metadata: { path: '/srv/varcad.io' } },
  };
  const { resolvers, calls } = createResolverHarness({
    listProcessTemplatesResult: [template],
    resolveProcessTemplateResult: {
      template,
      desiredProcess,
      healthChecksJson: template.healthChecksJson,
    },
    ensureProcessFromTemplateResult: {
      template,
      desiredProcess,
      healthChecksJson: template.healthChecksJson,
    },
    upsertProcessTemplateResult: template,
  });

  const templates = await resolvers.Query.processTemplates(null, {
    hostId: 7,
    projectId: 19,
    includeDisabled: true,
  });
  const resolved = await resolvers.Query.resolveProcessTemplate(null, {
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
    env: [{ key: 'NODE_ENV', value: 'development' }],
  });
  const ensured = await resolvers.Mutation.ensureProcessFromTemplate(null, {
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
    args: ['--host', '0.0.0.0'],
  });
  const upserted = await resolvers.Mutation.upsertProcessTemplate(null, {
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
    displayName: 'Node dev',
    packageKey: 'web',
    cwdTemplate: '{{project.hostPath}}/packages/web',
    launchMode: 'shell',
    command: 'yarn workspace web dev',
    args: ['--host', '0.0.0.0'],
    env: [{ key: 'NODE_ENV', value: 'development' }],
    healthChecksJson: '[{"type":"http","url":"http://localhost:3010"}]',
  });
  const deleted = await resolvers.Mutation.deleteProcessTemplate(null, {
    id: 31,
    hostId: 7,
  });

  assert.equal(calls[0].method, 'listProcessTemplates');
  assert.equal(calls[0].input.includeDisabled, true);
  assert.equal(templates[0].templateKey, 'node.dev');
  assert.equal(templates[0].env[0].key, 'NODE_ENV');
  assert.match(templates[0].healthChecksJson, /localhost:3010/);
  assert.equal(calls[1].method, 'resolveProcessTemplate');
  assert.equal(calls[1].input.env[0].value, 'development');
  assert.equal(resolved.cwd, '/srv/varcad.io/packages/web');
  assert.equal(resolved.template.scope, 'host_project');
  assert.equal(calls[2].method, 'ensureProcessFromTemplate');
  assert.deepEqual(calls[2].input.args, ['--host', '0.0.0.0']);
  assert.equal(ensured.id, 44);
  assert.equal(calls[3].method, 'upsertProcessTemplate');
  assert.deepEqual(calls[3].input.envJson, { NODE_ENV: 'development' });
  assert.deepEqual(calls[3].input.healthChecksJson, [{ type: 'http', url: 'http://localhost:3010' }]);
  assert.equal(upserted.packageKey, 'web');
  assert.equal(calls[4].method, 'deleteProcessTemplate');
  assert.equal(deleted, true);
});

test('waitForRuntime query forwards health checks and maps diagnostics', async () => {
  const { resolvers, calls } = createResolverHarness({
    waitForRuntimeResult: {
      status: 'matched',
      matchedCheck: 'log_pattern',
      elapsedMs: 25,
      observedRun: {
        id: 501,
        runId: 'run-501',
        hostId: 7,
        projectId: 19,
        slaveId: 'slave-7',
        packageKey: 'web',
        processKey: 'web',
        pid: 1234,
        command: 'yarn dev',
        argsJson: [],
        status: 'running',
      },
      lastLogLines: ['Ready on http://localhost:3010'],
      message: 'log check matched',
    },
  });

  const result = await resolvers.Query.waitForRuntime(null, {
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
    processKey: 'web',
    healthChecksJson: '[{"type":"log_pattern","pattern":"Ready"}]',
    timeoutMs: 30000,
  });

  assert.equal(calls[0].method, 'waitForRuntime');
  assert.equal(calls[0].input.templateKey, 'node.dev');
  assert.match(calls[0].input.healthChecksJson, /Ready/);
  assert.equal(result.status, 'matched');
  assert.equal(result.matchedCheck, 'log_pattern');
  assert.equal(result.observedRun.runId, 'run-501');
  assert.deepEqual(result.lastLogLines, ['Ready on http://localhost:3010']);
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

test('lifecycle mutation writes runtime audit event with request and target metadata', async () => {
  const auditEvents = [];
  const { resolvers } = createResolverHarness({
    runtimeAudit: {
      async recordRuntimeAuditEvent(event) {
        auditEvents.push(event);
        return event;
      },
      async listRuntimeAuditEvents() {
        return auditEvents;
      },
    },
    ensureDesiredProcessResult: {
      id: 303,
      hostId: 7,
      projectId: 19,
      processKey: 'web',
      packageKey: 'web',
      projectPath: '/srv/varcad.io',
      desiredState: 'running',
      launchMode: 'shell',
      cwd: '/srv/varcad.io',
      command: 'yarn dev',
      argsJson: [],
      envJson: {},
      restartPolicy: 'manual',
    },
  });

  await resolvers.Mutation.ensureDesiredProcess(null, {
    hostId: 7,
    projectId: 19,
    processKey: 'web',
    packageKey: 'web',
    launchMode: 'shell',
    cwd: '/srv/varcad.io',
    command: 'yarn dev',
  }, {
    requestId: 'req-phase-5',
    toolName: 'project_commander.ensure_process',
    user: {
      subject: 'local-test',
      name: 'local-test',
    },
  });

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].context.requestId, 'req-phase-5');
  assert.equal(auditEvents[0].context.toolName, 'project_commander.ensure_process');
  assert.equal(auditEvents[0].action, 'runtime:ensure');
  assert.equal(auditEvents[0].hostId, 7);
  assert.equal(auditEvents[0].projectId, 19);
  assert.equal(auditEvents[0].desiredProcessId, 303);
  assert.equal(auditEvents[0].processKey, 'web');
  assert.equal(auditEvents[0].status, 'success');
});
