const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');

const DEFAULT_APP_URL = 'http://localhost:3000';
const PROJECT_PATH = '/tmp/mock-project';

const MOCK_PROJECT_LOGS = Array.from({ length: 240 }, (_, index) => ({
  id: index + 1,
  projectPath: PROJECT_PATH,
  timestamp: new Date(Date.UTC(2026, 2, 4, 15, 10, index % 60)).toISOString(),
  serviceName: index % 2 === 0 ? 'web' : 'api',
  stream: index % 10 === 0 ? 'stderr' : 'stdout',
  level: index % 10 === 0 ? 'error' : 'info',
  message: `scrollbar-line-${index + 1} payload`,
}));

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
          projects: [
            {
              name: 'mock-app',
              path: PROJECT_PATH,
              relativePath: '.',
              hostId: null,
              hostName: null,
              services: ['web', 'api'],
              types: ['node-project'],
              hasMakefile: false,
              declaredServices: [],
              runtimeStatus: 'started',
              runtimePid: 12345,
              runtimePorts: [3000],
              runtimePortRangeBegin: 4000,
              runtimePortRangeEnd: 4009,
              runtimeServicePorts: { main: 3000, graphql: null, api: null, admin: null },
              runtimeServicePids: { main: 12345, graphql: null, api: null, admin: null },
              runtimeServiceStates: { main: 'started', graphql: 'stopped', api: 'stopped', admin: 'stopped' },
              runtimeServiceEntries: [
                { key: 'main', serviceName: 'web', pid: 12345, port: 3000, state: 'started' },
              ],
              runtimeLastExitCode: null,
            },
          ],
        },
      });
    }

    if (query.includes('query Hosts') || query.includes('\n    hosts {')) {
      return ok({ hosts: [] });
    }

    if (query.includes('projectLogs')) {
      if (String(variables.projectPath || '') !== PROJECT_PATH) {
        return ok({ projectLogs: [] });
      }
      return ok({ projectLogs: MOCK_PROJECT_LOGS });
    }

    if (query.includes('projectLaunchEnvironment')) {
      return ok({ projectLaunchEnvironment: [] });
    }

    if (query.includes('projectProcessStats')) {
      return ok({ projectProcessStats: [] });
    }

    if (query.includes('projectPortRangeSettings')) {
      return ok({
        projectPortRangeSettings: { mode: 'AUTOMATIC', begin: null },
      });
    }

    return ok({});
  });
}

test('log pane becomes vertically scrollable when enough log items are rendered', async ({ page, baseURL }) => {
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
        lines: MOCK_PROJECT_LOGS,
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

  const logStream = page.getByTestId('log-stream');
  await expect(logStream).toBeVisible();

  await expect.poll(async () => (
    logStream.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: window.getComputedStyle(node).overflowY,
    }))
  )).toMatchObject({
    overflowY: 'auto',
  });

  await expect.poll(async () => (
    logStream.evaluate((node) => node.scrollHeight - node.clientHeight)
  )).toBeGreaterThan(0);

  const metrics = await logStream.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }));

  expect(metrics.clientHeight).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  const maxScrollTop = await logStream.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop;
  });
  expect(maxScrollTop).toBeGreaterThan(0);
});
