const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');
const { selectWorkspacePanel } = require('./helpers/workspacePanels');

const DEFAULT_APP_URL = 'http://localhost:3000';

const HOST_ONE = {
  id: 1,
  agentUuid: '5d0aedce-cf5f-4af2-9e35-111111111111',
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
  agentUuid: '6a8c2c7f-4b5d-4e5f-a928-222222222222',
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
    eventId: 'evt-master-node',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 11, 0, 0)).toISOString(),
      serviceName: 'node-backend',
      source: 'node-backend',
      stream: 'stdout',
      level: 'info',
      message: 'node-backend-master-view',
    },
  },
  {
    kind: 'event',
    eventId: 'evt-master-agent',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 11, 0, 1)).toISOString(),
      serviceName: 'agent-master',
      source: 'agent-master',
      stream: 'stdout',
      level: 'info',
      message: 'agent-master-master-view',
    },
  },
  {
    kind: 'event',
    eventId: 'evt-master-host-relay',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 11, 0, 2)).toISOString(),
      serviceName: 'agent-master',
      source: 'master-agent',
      stream: 'stdout',
      level: 'debug',
      message: 'slave contact master-relay-selected-host-should-hide',
      hostId: HOST_ONE.id,
      hostName: HOST_ONE.name,
      hostIp: HOST_ONE.ip,
      agentUuid: HOST_ONE.agentUuid,
    },
  },
  {
    kind: 'event',
    eventId: 'evt-slave-selected-host',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 11, 0, 3)).toISOString(),
      serviceName: HOST_ONE.name,
      source: 'agent-slave',
      stream: 'stdout',
      level: 'info',
      message: 'selected-slave-uuid-log',
      hostId: null,
      hostName: HOST_ONE.name,
      hostIp: HOST_ONE.ip,
      agentUuid: HOST_ONE.agentUuid,
    },
  },
  {
    kind: 'event',
    eventId: 'evt-slave-other-host',
    topic: 'log.overlay',
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 5, 11, 0, 4)).toISOString(),
      serviceName: HOST_TWO.name,
      source: 'agent-slave',
      stream: 'stdout',
      level: 'info',
      message: 'other-slave-uuid-log',
      hostId: null,
      hostName: HOST_TWO.name,
      hostIp: HOST_TWO.ip,
      agentUuid: HOST_TWO.agentUuid,
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
          projects: [],
        },
      });
    }

    if (query.includes('query Hosts') || query.includes('\n    hosts {')) {
      return ok({
        hosts: [HOST_ONE, HOST_TWO],
      });
    }

    if (query.includes('projectLogs')) {
      return ok({ projectLogs: [] });
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

test('defaults to master selection and scopes logs by selected master/slave context', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('project-discovery:panel-state', JSON.stringify({
        panelProjectList: {
          selectedProjectPath: '',
        },
        panelProjectExplorer: {
          isFollowMode: true,
        },
        uiInteractions: {
          selectedHostId: 'master-agent',
          activeWorkspacePanel: 'hosts',
          activeLogContextKey: 'runtime',
          selectedLogServices: [],
          disabledLogLevels: [],
        },
      }));
    } catch {
      // ignore
    }
  });
  await installWebSocketMock(page, WS_EVENTS);
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

  const masterRow = page.locator('.masterHostRow');
  await expect(masterRow).toBeVisible();
  await expect(masterRow).toHaveClass(/selected/);
  await expect(page.locator('.hostList .hostCard.selected')).toHaveCount(0);
  await expect(page.locator('.workspacePanelNav').getByRole('button', { name: 'Hosts', exact: true })).toHaveAttribute('aria-current', 'page');

  await selectWorkspacePanel(page, 'Logs');

  const logStream = page.getByTestId('log-stream');
  await expect(logStream).toBeVisible();
  await expect(logStream).toContainText('node-backend-master-view');
  await expect(logStream).toContainText('agent-master-master-view');
  await expect(logStream).not.toContainText('selected-slave-uuid-log');
  await expect(logStream).not.toContainText('other-slave-uuid-log');
  await expect(logStream.locator('.logHostTag')).toHaveCount(0);

  await selectWorkspacePanel(page, 'Hosts');
  const selectedHostRow = page.locator('.hostList .hostCard').filter({ hasText: /blackbox/i }).first();
  await expect(selectedHostRow).toBeVisible();
  await selectedHostRow.click();
  await selectWorkspacePanel(page, 'Logs');

  await expect(logStream).toContainText('selected-slave-uuid-log');
  await expect(logStream).not.toContainText('other-slave-uuid-log');
  await expect(logStream).not.toContainText('node-backend-master-view');
  await expect(logStream).not.toContainText('agent-master-master-view');
  await expect(logStream).not.toContainText('master-relay-selected-host-should-hide');
  await expect(logStream.locator('.logServiceTag').filter({ hasText: 'node-backend' })).toHaveCount(0);
  await expect(logStream.locator('.logServiceTag').filter({ hasText: 'agent-master' })).toHaveCount(0);

  await selectWorkspacePanel(page, 'Hosts');
  await expect(selectedHostRow).toHaveClass(/selected/);
  await expect(selectedHostRow.locator('.hostHealthDot')).toHaveClass(/healthy/);
  await expect(selectedHostRow).toContainText('(online)');
});
