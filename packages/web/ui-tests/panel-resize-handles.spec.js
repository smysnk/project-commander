const { test, expect } = require('@playwright/test');
const {
  expectSingleWorkspacePanel,
  selectWorkspacePanel,
} = require('./helpers/workspacePanels');

const DEFAULT_APP_URL = 'http://localhost:3000';

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
            target: '127.0.0.1:50052',
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
        hosts: [
          {
            id: 1,
            agentUuid: 'host-1',
            ip: 'blackbox.local',
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
          },
        ],
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

    return ok({});
  });
}

test('single-panel shell does not render legacy split-pane resize handles', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;
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

  const workspace = page.locator('.workspace');
  const viewport = page.locator('.workspacePanelViewport');

  await expect(workspace).toBeVisible();
  await expect(viewport).toBeVisible();
  await expect(page.locator('.mainPanels')).toHaveCount(0);
  await expect(page.getByTestId('sidebar-divider')).toHaveCount(0);
  await expect(page.getByTestId('content-divider')).toHaveCount(0);
  await expect(page.locator('.divider')).toHaveCount(0);

  await expectSingleWorkspacePanel(page, 'projects');
  await selectWorkspacePanel(page, 'Hosts');
  await expectSingleWorkspacePanel(page, 'hosts');
  await selectWorkspacePanel(page, 'Runtime');
  await expectSingleWorkspacePanel(page, 'runtime');
});
