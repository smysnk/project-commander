const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');
const { selectWorkspacePanel } = require('./helpers/workspacePanels');

const DEFAULT_APP_URL = 'http://localhost:3000';
const PROJECT_PATH = '/tmp/mock-project';

const HOST_ONE = {
  id: 1,
  agentUuid: 'host-1',
  ip: '192.168.1.250',
  port: 45268,
  name: 'blackbox',
  source: 'manual',
  online: true,
  health: 'healthy',
  status: 'registered',
  lastSeenAt: new Date().toISOString(),
  error: null,
  directories: ['~/play'],
  projects: [],
};

const HOST_TWO = {
  id: 2,
  agentUuid: 'host-2',
  ip: '192.168.1.251',
  port: 45269,
  name: 'atlas',
  source: 'manual',
  online: true,
  health: 'healthy',
  status: 'registered',
  lastSeenAt: new Date().toISOString(),
  error: null,
  directories: ['~/play'],
  projects: [],
};

const WS_EVENTS = [
  {
    kind: 'event',
    eventId: 'evt-runtime-node',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 1, 0, 0)).toISOString(),
      serviceName: 'node-backend',
      source: 'node-backend',
      stream: 'stdout',
      level: 'info',
      message: 'runtime-node-health',
    },
  },
  {
    kind: 'event',
    eventId: 'evt-master',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 1, 0, 1)).toISOString(),
      serviceName: 'agent-master',
      source: 'agent-master',
      stream: 'stdout',
      level: 'debug',
      message: 'master-only-heartbeat',
    },
  },
  {
    kind: 'event',
    eventId: 'evt-host-one',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 1, 0, 2)).toISOString(),
      serviceName: 'slave-agent',
      source: 'slave-agent',
      stream: 'stdout',
      level: 'debug',
      message: 'host-one-heartbeat',
      hostId: HOST_ONE.id,
      hostName: HOST_ONE.name,
      hostIp: HOST_ONE.ip,
    },
  },
  {
    kind: 'event',
    eventId: 'evt-host-two',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 1, 0, 3)).toISOString(),
      serviceName: 'slave-agent',
      source: 'slave-agent',
      stream: 'stdout',
      level: 'debug',
      message: 'host-two-heartbeat',
      hostId: HOST_TWO.id,
      hostName: HOST_TWO.name,
      hostIp: HOST_TWO.ip,
    },
  },
];

async function installGraphqlMocks(page) {
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

    if (query.includes('runtimeConfig')) {
      return ok({
        runtimeConfig: {
          appUrl: DEFAULT_APP_URL,
          graphqlEndpoint: '/graphql',
          wsEndpoint: 'ws://localhost:4000/ws',
          runtimeBackend: 'go-master',
        },
        runtimeBackendInfo: {
          name: 'go-master',
          displayName: 'Go Master Agent',
          masterAgent: {
            socketPath: '/tmp/pc-master.sock',
            target: '127.0.0.1:50052',
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
          },
        },
      });
    }

    if (query.includes('discoveredProjects')) {
      return ok({
        discoveryConfig: {
          projectPath: '/tmp',
          folderPattern: '.*',
          maxDepth: 4,
        },
        discoveredProjects: {
          scannedAt: new Date().toISOString(),
          projects: [
            {
              name: 'mock-app',
              path: PROJECT_PATH,
              relativePath: '.',
              hostId: null,
              hostName: null,
              services: ['web'],
              types: ['node-project'],
              hasMakefile: false,
              declaredServices: [],
              runtimeStatus: 'stopped',
              runtimePid: null,
              runtimePorts: [],
              runtimePortRangeBegin: null,
              runtimePortRangeEnd: null,
              runtimeServicePorts: {},
              runtimeServicePids: {},
              runtimeServiceStates: {},
              runtimeServiceEntries: [],
              runtimeLastExitCode: null,
            },
          ],
        },
      });
    }

    if (query.includes('query Hosts') || query.includes('\n    hosts {')) {
      return ok({
        hosts: [HOST_ONE, HOST_TWO],
      });
    }

    if (query.includes('projectLogs')) {
      if (String(variables.projectPath || '') !== PROJECT_PATH) {
        return ok({ projectLogs: [] });
      }
      return ok({
        projectLogs: [
          {
            id: 1,
            projectPath: PROJECT_PATH,
            timestamp: new Date(Date.UTC(2026, 2, 5, 1, 0, 0)).toISOString(),
            serviceName: 'web',
            stream: 'stdout',
            level: 'info',
            message: 'project-log-line',
          },
        ],
      });
    }

    if (query.includes('projectLaunchEnvironment')) {
      return ok({ projectLaunchEnvironment: [] });
    }

    if (query.includes('projectProcessStats')) {
      return ok({ projectProcessStats: [] });
    }

    if (query.includes('projectPortRangeSettings')) {
      return ok({
        projectPortRangeSettings: {
          mode: 'AUTOMATIC',
          begin: null,
        },
      });
    }

    if (query.includes('terminalSession')) {
      return ok({ terminalSession: null });
    }

    return ok({});
  });
}

test('switches tab/log contexts across runtime, master, and host selections', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installWebSocketMock(page, WS_EVENTS, {
    logQueryFixtures: [
      {
        context: {
          scope: 'project',
          contextKey: `project:${PROJECT_PATH}`,
          projectPath: PROJECT_PATH,
        },
        streamId: 'merged',
        lines: [
          {
            id: 1,
            projectPath: PROJECT_PATH,
            timestamp: new Date(Date.UTC(2026, 2, 5, 1, 0, 0)).toISOString(),
            serviceName: 'web',
            stream: 'stdout',
            level: 'info',
            message: 'project-log-line',
          },
        ],
      },
    ],
  });
  await installGraphqlMocks(page);

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

  await selectWorkspacePanel(page, 'Logs');
  const logStream = page.getByTestId('log-stream');
  await expect(logStream).toBeVisible();
  await expect(logStream).toContainText('runtime-node-health');
  await expect(logStream).toContainText('master-only-heartbeat');
  await expect(logStream).not.toContainText('host-one-heartbeat');

  await selectWorkspacePanel(page, 'Hosts');
  await page.locator('.masterHostRow').click();
  await selectWorkspacePanel(page, 'Logs');
  await expect(logStream).toContainText('master-only-heartbeat');
  await expect(logStream).toContainText('runtime-node-health');
  await expect(logStream).not.toContainText('host-one-heartbeat');

  await selectWorkspacePanel(page, 'Hosts');
  await page.locator('.hostList .hostCard').filter({ hasText: /blackbox/i }).first().click();
  await selectWorkspacePanel(page, 'Logs');
  await expect(logStream).toContainText('host-one-heartbeat');
  await expect(logStream).not.toContainText('host-two-heartbeat');
  await expect(logStream).not.toContainText('master-only-heartbeat');

  await selectWorkspacePanel(page, 'Terminal');
});
