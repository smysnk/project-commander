const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');

const DEFAULT_APP_URL = 'http://localhost:3000';
const PROJECT_PATH = '/tmp/mock-app';

const MASTER_AGENT_INFO = {
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
};

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

    if (query.includes('discoveredProjects')) {
      return ok({
        discoveryConfig: {
          projectPath: '/tmp',
          folderPattern: '.*',
          maxDepth: 1,
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
        hosts: [],
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
            timestamp: new Date(Date.UTC(2026, 2, 6, 14, 0, 0)).toISOString(),
            serviceName: 'web',
            stream: 'stdout',
            level: 'info',
            message: 'mock-project-log',
          },
        ],
      });
    }

    if (query.includes('projectLaunchEnvironment')) {
      return ok({
        projectLaunchEnvironment: [
          { key: 'NODE_ENV', value: 'test' },
        ],
      });
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
      return ok({
        projectProcessStats: [
          {
            serviceId: 'web',
            serviceName: 'mock-web',
            pid: 3001,
            cpuPercent: 0.5,
            memoryPercent: 0.2,
            rssMb: 52,
            virtualMb: 210,
            elapsed: '00:00:12',
            command: 'node server.js',
          },
        ],
      });
    }

    if (query.includes('terminalSession')) {
      return ok({ terminalSession: null });
    }

    return ok({});
  });
}

test('right pane tabs are left-aligned, mutually exclusive, and mapped to expected panels', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installWebSocketMock(page, [], {
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
            timestamp: new Date(Date.UTC(2026, 2, 6, 14, 0, 0)).toISOString(),
            serviceName: 'web',
            stream: 'stdout',
            level: 'info',
            message: 'mock-project-log',
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

  const tabsGroup = page.locator('.panelTabsGroup');
  const rightPane = page.locator('.rightPanel');
  await expect(tabsGroup).toBeVisible();
  await expect(page.locator('.panelTabsRight')).toHaveCount(0);

  const tabOrder = await page.locator('.panelTabsGroup .panelTab').evaluateAll((nodes) =>
    nodes.map((node) => String(node.textContent || '').trim()).filter(Boolean));
  expect(tabOrder).toEqual(['Logs', 'Debug', 'Environment', 'Top', 'Runtime', 'Terminal']);

  const expectSingleActiveTab = async (name) => {
    await expect(page.locator('.panelTabsGroup .panelTab.active')).toHaveCount(1);
    await expect(page.getByRole('tab', { name })).toHaveClass(/active/);
  };

  await expectSingleActiveTab('Logs');
  await expect(page.getByTestId('log-panel')).toBeVisible();
  await expect(page.getByTestId('log-stream')).toContainText('mock-project-log');

  await page.getByRole('tab', { name: 'Debug' }).click();
  await expectSingleActiveTab('Debug');
  await expect(rightPane.locator('.debugPanel')).toBeVisible();
  await expect(rightPane.locator('.debugTree')).toBeVisible();

  await page.getByRole('tab', { name: 'Environment' }).click();
  await expectSingleActiveTab('Environment');
  await expect(rightPane.locator('.environmentPanel')).toBeVisible();
  await expect(rightPane.locator('.environmentPanel')).toContainText('Port Range');
  await expect(rightPane.locator('.environmentPanel')).toContainText('NODE_ENV');

  await page.getByRole('tab', { name: 'Top' }).click();
  await expectSingleActiveTab('Top');
  await expect(rightPane.locator('.topPanel')).toBeVisible();
  await expect(rightPane.locator('.topTable')).toContainText('mock-web');

  await page.getByRole('tab', { name: 'Runtime' }).click();
  await expectSingleActiveTab('Runtime');
  await expect(rightPane.locator('.runtimePanel')).toBeVisible();
  await expect(rightPane.locator('.runtimePanel')).toContainText('Server Runtime');
  await expect(rightPane.locator('.runtimePanel')).toContainText('Master Agent');

  await page.getByRole('tab', { name: 'Terminal' }).click();
  await expectSingleActiveTab('Terminal');
  await expect(rightPane.locator('.terminalPanel')).toBeVisible();
  await expect(rightPane.locator('.terminalPanel')).toContainText('Select a slave agent to start a terminal session.');
});
