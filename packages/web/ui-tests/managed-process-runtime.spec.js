const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');

const DEFAULT_APP_URL = 'http://localhost:3000';
const HOST_ID = 1;
const PROJECT_ID = 101;
const PROJECT_PATH = '/tmp/managed-app';
const RUN_ID = 'run-1';

const MASTER_AGENT_INFO = {
  socketPath: '/tmp/project-commander/master.sock',
  target: '127.0.0.1:50052',
  slaveControlTarget: '127.0.0.1:50052',
  slaveControlPort: 50052,
  service: 'projectcommander.master.v1.MasterControlService',
  status: 'running',
  connectionStatus: 'connected',
  connectionHealth: 'healthy',
  lastConnectedAt: new Date().toISOString(),
  lastAttemptAt: new Date().toISOString(),
  reconnectAttempts: 0,
  version: '0.1.0',
  protocolVersion: 'v1',
  startedAt: new Date().toISOString(),
  capabilities: [],
  grantedCapabilities: [],
  error: null,
};

function buildHost() {
  return {
    id: HOST_ID,
    agentUuid: 'host-1',
    ip: '192.168.1.250',
    port: 42050,
    name: 'blackbox',
    source: 'registered',
    online: true,
    health: 'healthy',
    status: 'registered',
    lastSeenAt: new Date().toISOString(),
    error: null,
    version: '0.1.0',
    protocolVersion: 'v1',
    targetSocket: null,
    directories: ['~/play'],
    projectCount: 1,
    projects: [
      {
        id: PROJECT_ID,
        name: 'managed-app',
        path: PROJECT_PATH,
        hostId: HOST_ID,
      },
    ],
  };
}

function createDesiredProcessFromVariables(variables = {}) {
  const packageKey = String(variables.packageKey || variables.processKey || 'worker').trim() || 'worker';
  const processKey = String(variables.processKey || packageKey).trim() || packageKey;
  return {
    id: Number(variables.desiredProcessId || 1),
    hostId: HOST_ID,
    projectId: PROJECT_ID,
    serviceId: null,
    slaveId: 'host-1',
    hostName: 'blackbox',
    projectName: 'managed-app',
    serviceName: packageKey,
    processKey,
    packageKey,
    packageRelativePath: packageKey,
    projectPath: PROJECT_PATH,
    desiredState: String(variables.desiredState || 'running'),
    launchMode: String(variables.launchMode || 'exec'),
    cwd: String(variables.cwd || PROJECT_PATH),
    command: String(variables.command || 'yarn'),
    args: Array.isArray(variables.args) ? variables.args.map((value) => String(value)) : ['dev'],
    env: Array.isArray(variables.env) ? variables.env : [],
    envHash: 'envhash-worker',
    launchFingerprint: `launch-${processKey}`,
    logRoot: String(variables.logRoot || '/tmp/project-commander/processes').trim() || null,
    restartPolicy: String(variables.restartPolicy || 'manual'),
    updatedAt: new Date().toISOString(),
  };
}

function createObservedRunFromDesiredProcess(desiredProcess, overrides = {}) {
  return {
    id: 1,
    runId: RUN_ID,
    desiredProcessId: desiredProcess.id,
    hostId: HOST_ID,
    projectId: PROJECT_ID,
    serviceId: null,
    slaveId: 'host-1',
    bootId: 'boot-1',
    processKey: desiredProcess.processKey,
    packageKey: desiredProcess.packageKey,
    projectPath: desiredProcess.projectPath,
    pid: 7345,
    pgid: 7345,
    launchFingerprint: desiredProcess.launchFingerprint,
    command: desiredProcess.command,
    args: desiredProcess.args,
    cwd: desiredProcess.cwd,
    envHash: desiredProcess.envHash,
    status: 'running',
    startedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    logPath: `/tmp/project-commander/processes/boot-1/7345.log`,
    adopted: false,
    reconciliationSource: 'desired',
    runtimeState: {
      sampledAt: new Date().toISOString(),
      cpuPercent: 3.4,
      memoryPercent: 1.2,
      rssBytes: 36 * 1024 * 1024,
      vmsBytes: 128 * 1024 * 1024,
      readBytes: 512,
      writeBytes: 1024,
      readOps: 2,
      writeOps: 4,
      openFds: 9,
      threadCount: 4,
      status: String(overrides.status || 'running'),
    },
    ...overrides,
  };
}

async function installGraphqlMocks(page) {
  const state = {
    host: buildHost(),
    desiredProcesses: [],
    observedProcessRuns: [],
    ensureCalls: [],
    deleteCalls: [],
    softKillCalls: [],
    hardKillCalls: [],
    nextDesiredProcessId: 1,
  };

  await page.route('**/graphql', async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch {
      body = {};
    }

    const query = String(body.query || '');
    const variables = body.variables || {};
    const ok = (payload) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: payload }),
    });

    const buildSlaveRuntimeState = () => ({
      host: {
        id: state.host.id,
        agentUuid: state.host.agentUuid,
        name: state.host.name,
        ip: state.host.ip,
      },
      slaveId: state.host.agentUuid,
      bootId: 'boot-1',
      desiredProcessCount: state.desiredProcesses.length,
      observedRunCount: state.observedProcessRuns.length,
      desiredProcesses: state.desiredProcesses,
      observedRuns: state.observedProcessRuns,
      hostRuntimeState: {
        sampledAt: new Date().toISOString(),
        cpuPercent: 12.5,
        load1m: 0.42,
        load5m: 0.38,
        load15m: 0.35,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        memoryUsedBytes: 6 * 1024 * 1024 * 1024,
        memoryAvailableBytes: 10 * 1024 * 1024 * 1024,
        diskTotalBytes: 500 * 1024 * 1024 * 1024,
        diskUsedBytes: 120 * 1024 * 1024 * 1024,
        diskAvailableBytes: 380 * 1024 * 1024 * 1024,
        diskMount: '/',
      },
    });

    if (query.includes('runtimeConfig')) {
      return ok({
        runtimeConfig: {
          appUrl: DEFAULT_APP_URL,
          graphqlEndpoint: '/graphql',
          wsEndpoint: 'ws://localhost:4000/ws',
          runtimeBackend: 'go-master',
          version: '0.1.0',
          protocolVersion: 'v1',
          slaveTargetVersion: '0.1.0',
        },
        runtimeBackendInfo: {
          name: 'go-master',
          displayName: 'Go Master Agent',
          masterAgent: MASTER_AGENT_INFO,
        },
      });
    }

    if (query.includes('runtimeBackendInfo')) {
      return ok({
        runtimeBackendInfo: {
          name: 'go-master',
          displayName: 'Go Master Agent',
          masterAgent: MASTER_AGENT_INFO,
        },
      });
    }

    if (query.includes('discoveredProjects')) {
      return ok({
        discoveryConfig: {
          projectPath: '/tmp',
          folderPattern: '.*',
          maxDepth: 1,
        },
        discoveredProjects: {
          scannedAt: new Date().toISOString(),
          projects: [],
        },
      });
    }

    if (query.includes('query Hosts') || query.includes('\n    hosts {')) {
      return ok({ hosts: [state.host] });
    }

    if (query.includes('query SlaveRuntimeState')) {
      return ok({ slaveRuntimeState: buildSlaveRuntimeState() });
    }

    if (query.includes('query DesiredProcesses')) {
      return ok({ desiredProcesses: state.desiredProcesses });
    }

    if (query.includes('query ObservedProcessRuns')) {
      return ok({ observedProcessRuns: state.observedProcessRuns });
    }

    if (query.includes('mutation EnsureDesiredProcess')) {
      state.ensureCalls.push(variables);
      let desiredProcess = null;
      const desiredProcessId = Number(variables.desiredProcessId || 0);
      if (Number.isInteger(desiredProcessId) && desiredProcessId > 0) {
        desiredProcess = state.desiredProcesses.find((entry) => Number(entry.id) === desiredProcessId) || null;
      }

      if (desiredProcess) {
        const updatedProcess = createDesiredProcessFromVariables({
          ...desiredProcess,
          ...variables,
          desiredProcessId: desiredProcess.id,
        });
        state.desiredProcesses = state.desiredProcesses.map((entry) => (
          Number(entry.id) === desiredProcess.id ? updatedProcess : entry
        ));
        state.observedProcessRuns = state.observedProcessRuns.map((entry) => (
          entry.runId === RUN_ID
            ? createObservedRunFromDesiredProcess(updatedProcess, {
              ...entry,
              status: entry.status,
              lastSeenAt: new Date().toISOString(),
            })
            : entry
        ));
        return ok({ ensureDesiredProcess: updatedProcess });
      }

      desiredProcess = createDesiredProcessFromVariables({
        ...variables,
        desiredProcessId: state.nextDesiredProcessId,
      });
      state.nextDesiredProcessId += 1;
      state.desiredProcesses = [desiredProcess];
      state.observedProcessRuns = [createObservedRunFromDesiredProcess(desiredProcess)];
      return ok({ ensureDesiredProcess: desiredProcess });
    }

    if (query.includes('mutation DeleteDesiredProcessDefinition')) {
      state.deleteCalls.push(variables);
      const desiredProcessId = Number(variables.desiredProcessId || 0);
      state.desiredProcesses = state.desiredProcesses.filter((entry) => Number(entry.id) !== desiredProcessId);
      return ok({ deleteDesiredProcessDefinition: true });
    }

    if (query.includes('mutation SoftKillProcess')) {
      state.softKillCalls.push(variables);
      state.observedProcessRuns = state.observedProcessRuns.map((entry) => (
        entry.runId === String(variables.runId)
          ? {
            ...entry,
            status: 'stopping',
            lastSeenAt: new Date().toISOString(),
            runtimeState: {
              ...entry.runtimeState,
              status: 'stopping',
            },
          }
          : entry
      ));
      return ok({
        softKillProcess: {
          commandId: 'soft-kill-1',
          status: 'queued',
          message: 'soft kill command queued',
        },
      });
    }

    if (query.includes('mutation HardKillProcess')) {
      state.hardKillCalls.push(variables);
      state.observedProcessRuns = state.observedProcessRuns.map((entry) => (
        entry.runId === String(variables.runId)
          ? {
            ...entry,
            status: 'exited',
            exitSignal: 'SIGKILL',
            exitedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            runtimeState: {
              ...entry.runtimeState,
              status: 'exited',
            },
          }
          : entry
      ));
      return ok({
        hardKillProcess: {
          commandId: 'hard-kill-1',
          status: 'queued',
          message: 'hard kill command queued',
        },
      });
    }

    if (query.includes('projectLogs')) {
      return ok({ projectLogs: [] });
    }

    if (query.includes('projectLaunchEnvironment')) {
      return ok({ projectLaunchEnvironment: [] });
    }

    if (query.includes('projectPortRangeSettings')) {
      return ok({
        projectPortRangeSettings: {
          mode: 'AUTOMATIC',
          begin: null,
        },
      });
    }

    if (query.includes('projectProcessStats')) {
      return ok({ projectProcessStats: [] });
    }

    if (query.includes('terminalSession')) {
      return ok({ terminalSession: null });
    }

    return ok({});
  });

  return state;
}

test('creates, edits, tails, soft-kills, hard-kills, and deletes a managed process from the runtime UI', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;
  const graphqlState = await installGraphqlMocks(page);

  await installWebSocketMock(page, [], {
    captureStorageKey: '__capturedRuntimeWsActions',
    captureActions: ['logs.query'],
    logQueryFixtures: [
      {
        context: {
          scope: 'process',
          contextKey: `process:${HOST_ID}:${RUN_ID}`,
          hostId: HOST_ID,
          hostName: 'blackbox',
          hostIp: '192.168.1.250',
          hostAgentUuid: 'host-1',
        },
        streamId: 'merged',
        lines: [
          {
            id: 'managed-log-1',
            projectPath: `@process:host-1:${RUN_ID}`,
            timestamp: new Date(Date.UTC(2026, 2, 9, 19, 0, 0)).toISOString(),
            serviceName: 'worker',
            stream: 'stdout',
            level: 'info',
            hostId: HOST_ID,
            hostName: 'blackbox',
            hostIp: '192.168.1.250',
            agentUuid: 'host-1',
            message: 'worker started',
          },
          {
            id: 'managed-log-2',
            projectPath: `@process:host-1:${RUN_ID}`,
            timestamp: new Date(Date.UTC(2026, 2, 9, 19, 0, 1)).toISOString(),
            serviceName: 'worker',
            stream: 'stdout',
            level: 'info',
            hostId: HOST_ID,
            hostName: 'blackbox',
            hostIp: '192.168.1.250',
            agentUuid: 'host-1',
            message: 'worker heartbeat',
          },
        ],
      },
    ],
  });

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return;
  }

  try {
    await expect(page.locator('.appShell')).toBeVisible({ timeout: 3_000 });
  } catch {
    test.skip(true, `Project Commander UI shell is unavailable at ${appUrl}.`);
    return;
  }

  const hostCard = page.locator('.hostList .hostCard').filter({ hasText: /blackbox/i }).first();
  await expect(hostCard).toBeVisible();
  await hostCard.click();

  await page.getByRole('tab', { name: 'Runtime' }).click();
  const runtimePanel = page.locator('.rightPanel .runtimePanel');
  await expect(runtimePanel).toBeVisible();
  await expect(runtimePanel).toContainText('Selected Slave Agent');

  await page.getByRole('button', { name: 'Add Managed Process' }).click();
  await runtimePanel.getByLabel('Package Key').fill('worker');
  await runtimePanel.getByLabel('Process Key').fill('worker');
  await runtimePanel.getByRole('button', { name: 'Ensure Desired Process' }).click();

  await expect(runtimePanel).toContainText('Desired Processes');
  await expect(runtimePanel).toContainText('Observed Runs');
  await expect(runtimePanel).toContainText('worker');
  await expect(runtimePanel).toContainText('pid 7345');
  expect(graphqlState.ensureCalls).toHaveLength(1);

  const desiredWorkerRow = runtimePanel.locator('.runtimeProcessRow').filter({ hasText: /worker/ }).first();
  await desiredWorkerRow.getByRole('button', { name: 'Edit' }).click();
  await runtimePanel.getByLabel('Command').fill('node');
  await runtimePanel.getByLabel(/Args/).fill('server.js');
  await runtimePanel.getByRole('button', { name: 'Update Managed Process' }).click();

  await expect(runtimePanel).toContainText('node server.js');
  expect(graphqlState.ensureCalls).toHaveLength(2);
  expect(Number(graphqlState.ensureCalls[1].desiredProcessId)).toBe(1);

  const observedWorkerRow = runtimePanel.locator('.runtimeProcessRow').filter({ hasText: /pid 7345/ }).first();
  await observedWorkerRow.getByRole('button', { name: 'Logs' }).click();

  const logPanel = page.getByTestId('log-panel');
  await expect(logPanel).toBeVisible();
  await expect(logPanel).toContainText('Managed process log');
  await expect(logPanel).toContainText('7345.log');
  await expect(page.getByTestId('log-stream')).toContainText('worker started');

  const capturedWsActions = await page.evaluate(() => window.__capturedRuntimeWsActions || []);
  expect(capturedWsActions.some((entry) => (
    entry?.action === 'logs.query'
    && entry?.context?.scope === 'process'
    && entry?.context?.runId === RUN_ID
    && entry?.context?.contextKey === `process:${HOST_ID}:${RUN_ID}`
  ))).toBe(true);

  await page.getByRole('tab', { name: 'Runtime' }).click();
  await observedWorkerRow.getByRole('button', { name: 'Soft Kill' }).click();
  await expect(runtimePanel).toContainText('stopping');
  expect(graphqlState.softKillCalls).toHaveLength(1);

  await observedWorkerRow.getByRole('button', { name: 'Hard Kill' }).click();
  await expect(runtimePanel).toContainText('exited');
  expect(graphqlState.hardKillCalls).toHaveLength(1);

  await desiredWorkerRow.getByRole('button', { name: 'Delete' }).click();
  await expect(runtimePanel).toContainText('No managed processes have been declared for this host.');
  expect(graphqlState.deleteCalls).toHaveLength(1);
});
