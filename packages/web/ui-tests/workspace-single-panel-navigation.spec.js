const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');
const {
  expectSingleWorkspacePanel,
  selectWorkspacePanel,
} = require('./helpers/workspacePanels');

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

async function openMockedApp(page, appUrl) {
  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return false;
  }

  try {
    await expect(page.locator('.appShell')).toBeVisible({ timeout: 3_000 });
  } catch {
    test.skip(true, `Project Commander UI shell is unavailable at ${appUrl}.`);
    return false;
  }
  return true;
}

async function installMocks(page) {
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
}

test('desktop workspace menu renders one active panel at a time', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;
  await installMocks(page);
  if (!await openMockedApp(page, appUrl)) {
    return;
  }

  await expect(page.locator('.panelTabsGroup')).toHaveCount(0);
  await expect(page.locator('.mainPanels')).toHaveCount(0);

  const panelOrder = await page.locator('.workspacePanelNav .workspacePanelButton').evaluateAll((nodes) =>
    nodes.map((node) => String(node.textContent || '').trim()).filter(Boolean));
  expect(panelOrder).toEqual(['Projects', 'Hosts', 'Logs', 'Runtime', 'Terminal', 'Environment', 'Top', 'Debug']);

  const expectOnlyPanelButtonActive = async (name) => {
    await expect(page.locator('.workspacePanelNav .workspacePanelButton[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.workspacePanelNav').getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  };

  await expectOnlyPanelButtonActive('Projects');
  await expectSingleWorkspacePanel(page, 'projects');
  await expect(page.locator('.projectsPanel')).toBeVisible();
  await expect(page.locator('.projectsPanel')).toContainText('mock-app');

  await selectWorkspacePanel(page, 'Hosts');
  await expectOnlyPanelButtonActive('Hosts');
  await expectSingleWorkspacePanel(page, 'hosts');
  await expect(page.locator('.hostsSidebarPanelMode')).toBeVisible();
  await expect(page.locator('.hostsSidebarPanelMode')).toContainText('No slave agents registered with master agent.');

  await selectWorkspacePanel(page, 'Runtime');
  await expectOnlyPanelButtonActive('Runtime');
  await expectSingleWorkspacePanel(page, 'runtime');
  await expect(page.locator('.runtimePanel')).toContainText('Server Runtime');
  await expect(page.locator('.runtimePanel')).toContainText('Master Agent');

  await selectWorkspacePanel(page, 'Logs');
  await expectOnlyPanelButtonActive('Logs');
  await expectSingleWorkspacePanel(page, 'logs');
  await expect(page.getByTestId('log-panel')).toBeVisible();

  await selectWorkspacePanel(page, 'Terminal');
  await expectOnlyPanelButtonActive('Terminal');
  await expectSingleWorkspacePanel(page, 'terminal');
  await expect(page.locator('.terminalPanel')).toContainText('Select a slave agent to start a terminal session.');

  await selectWorkspacePanel(page, 'Environment');
  await expectOnlyPanelButtonActive('Environment');
  await expectSingleWorkspacePanel(page, 'environment');
  await expect(page.locator('.environmentPanel')).toContainText('Port Range');
  await expect(page.locator('.environmentPanel')).toContainText('NODE_ENV');

  await selectWorkspacePanel(page, 'Top');
  await expectOnlyPanelButtonActive('Top');
  await expectSingleWorkspacePanel(page, 'top');
  await expect(page.locator('.topTable')).toContainText('mock-web');

  await selectWorkspacePanel(page, 'Debug');
  await expectOnlyPanelButtonActive('Debug');
  await expectSingleWorkspacePanel(page, 'debug');
  await expect(page.locator('.debugTree')).toBeVisible();
});

test('mobile workspace menu stays usable and keeps a single visible panel', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;
  await page.setViewportSize({ width: 390, height: 844 });
  await installMocks(page);
  if (!await openMockedApp(page, appUrl)) {
    return;
  }

  await expect(page.locator('.workspacePanelNav')).toBeVisible();
  await expect(page.locator('.workspacePanelNav .workspacePanelButton')).toHaveCount(8);
  await expect(page.getByTestId('sidebar-divider')).toHaveCount(0);
  await expect(page.getByTestId('content-divider')).toHaveCount(0);

  for (const [label, panelId] of [
    ['Projects', 'projects'],
    ['Hosts', 'hosts'],
    ['Runtime', 'runtime'],
    ['Logs', 'logs'],
    ['Terminal', 'terminal'],
  ]) {
    await selectWorkspacePanel(page, label);
    await expectSingleWorkspacePanel(page, panelId);
    await expect(page.locator('.workspacePanelNav .workspacePanelButton[aria-current="page"]')).toHaveCount(1);
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
  }
});
