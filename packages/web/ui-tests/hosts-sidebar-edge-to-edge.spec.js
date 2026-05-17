const { test, expect } = require('@playwright/test');
const { selectWorkspacePanel } = require('./helpers/workspacePanels');

const DEFAULT_APP_URL = 'http://localhost:3000';
const PROJECT_PATH = '/tmp/mock-project';

async function installGraphqlMocks(page) {
  await page.route('**/graphql', async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch {
      body = {};
    }

    const query = String(body.query || '');
    const ok = (payload) =>
      route.fulfill({
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
              hostId: 1,
              hostName: 'blackbox',
              services: ['main'],
              types: ['node-project'],
              hasMakefile: false,
              declaredServices: [],
            },
          ],
        },
      });
    }

    if (query.includes('query Hosts') || query.includes('\n    hosts {')) {
      return ok({
        hosts: [
          {
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

test('host rows are edge-to-edge with padded inner content', async ({ page, baseURL }) => {
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

  await selectWorkspacePanel(page, 'Hosts');
  const sidebarBody = page.locator('.hostsSidebarBody');
  const hostRow = page.locator('.hostList .hostCard').first();
  const hostTitle = hostRow.locator('.hostCardTitle').first();
  const hostActions = hostRow.locator('.hostCardActions').first();
  const firstFieldLabel = hostRow.locator('.hostFieldItem .hostFieldLabel').first();
  const firstFieldValue = hostRow.locator('.hostFieldItem .hostFieldValue').first();

  await expect(sidebarBody).toBeVisible();
  await expect(hostRow).toBeVisible();
  await expect(hostTitle).toBeVisible();
  await expect(hostActions).toBeVisible();
  await expect(firstFieldLabel).toBeVisible();
  await expect(firstFieldValue).toBeVisible();

  const sidebarBox = await sidebarBody.boundingBox();
  const hostRowBox = await hostRow.boundingBox();
  const hostTitleBox = await hostTitle.boundingBox();
  const hostActionsBox = await hostActions.boundingBox();
  const firstFieldLabelBox = await firstFieldLabel.boundingBox();
  const firstFieldValueBox = await firstFieldValue.boundingBox();

  expect(sidebarBox).toBeTruthy();
  expect(hostRowBox).toBeTruthy();
  expect(hostTitleBox).toBeTruthy();
  expect(hostActionsBox).toBeTruthy();
  expect(firstFieldLabelBox).toBeTruthy();
  expect(firstFieldValueBox).toBeTruthy();

  if (!sidebarBox || !hostRowBox || !hostTitleBox || !hostActionsBox || !firstFieldLabelBox || !firstFieldValueBox) {
    return;
  }

  const rowLeftDelta = Math.abs(hostRowBox.x - sidebarBox.x);
  const rowRightDelta = Math.abs(
    (hostRowBox.x + hostRowBox.width) - (sidebarBox.x + sidebarBox.width),
  );

  expect(rowLeftDelta).toBeLessThanOrEqual(1.5);
  expect(rowRightDelta).toBeLessThanOrEqual(1.5);

  const headerLeftInset = hostTitleBox.x - hostRowBox.x;
  const headerRightInset = (hostRowBox.x + hostRowBox.width) - (hostActionsBox.x + hostActionsBox.width);
  const fieldLeftInset = firstFieldLabelBox.x - hostRowBox.x;
  const fieldRightInset = (hostRowBox.x + hostRowBox.width) - (firstFieldValueBox.x + firstFieldValueBox.width);

  expect(headerLeftInset).toBeGreaterThanOrEqual(8);
  expect(headerLeftInset).toBeLessThanOrEqual(20);
  expect(headerRightInset).toBeGreaterThanOrEqual(8);
  expect(headerRightInset).toBeLessThanOrEqual(20);

  expect(fieldLeftInset).toBeGreaterThanOrEqual(8);
  expect(fieldLeftInset).toBeLessThanOrEqual(20);
  expect(fieldRightInset).toBeGreaterThanOrEqual(8);
  expect(fieldRightInset).toBeLessThanOrEqual(20);
});
