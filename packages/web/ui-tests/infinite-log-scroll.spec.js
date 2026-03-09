const { test, expect } = require('@playwright/test');
const { installWebSocketMock } = require('./helpers/wsMock');

const DEFAULT_APP_URL = 'http://localhost:3000';
const PROJECT_PATH = '/tmp/mock-project';

const MOCK_PROJECT_LOGS = Array.from({ length: 180 }, (_, index) => ({
  id: index + 1,
  projectPath: PROJECT_PATH,
  timestamp: new Date(Date.UTC(2026, 2, 4, 14, 30, index % 60)).toISOString(),
  serviceName: index % 2 === 0 ? 'web' : 'api',
  stream: index % 9 === 0 ? 'stderr' : 'stdout',
  level: index % 9 === 0 ? 'error' : 'info',
  message: `log-line-${index + 1} payload`,
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

test('infinite log renderer uses one text block with line-aligned tag rows and emits websocket window queries', async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installWebSocketMock(page, [], {
    captureStorageKey: '__LOG_QUERY_MESSAGES__',
    captureActions: ['logs.query'],
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

  const textBlock = page.getByTestId('infinite-log-text-block');
  await expect(textBlock).toBeVisible();
  await expect(textBlock).toHaveCount(1);

  const tagRows = page.locator('.infiniteLogTagRow');
  await expect(tagRows.first()).toBeVisible();
  const renderedTagCount = await tagRows.count();
  expect(renderedTagCount).toBeGreaterThan(80);
  expect(renderedTagCount).toBeLessThan(MOCK_PROJECT_LOGS.length);
  const renderedTextLineCount = await textBlock.evaluate((node) => {
    const content = String(node.textContent || '');
    if (!content) {
      return 0;
    }
    return content.split('\n').length;
  });
  expect(renderedTextLineCount).toBeGreaterThanOrEqual(renderedTagCount);
  expect(renderedTextLineCount).toBeLessThanOrEqual(MOCK_PROJECT_LOGS.length);

  const [firstBox, secondBox, firstLineHeight] = await Promise.all([
    tagRows.nth(0).boundingBox(),
    tagRows.nth(1).boundingBox(),
    tagRows.nth(0).evaluate((node) => Number.parseFloat(window.getComputedStyle(node).lineHeight)),
  ]);
  expect(firstBox).toBeTruthy();
  expect(secondBox).toBeTruthy();
  expect(firstLineHeight).toBeGreaterThan(0);

  if (firstBox && secondBox) {
    const deltaY = Math.abs(secondBox.y - firstBox.y);
    expect(Math.abs(deltaY - firstLineHeight)).toBeLessThanOrEqual(1.5);
  }

  const logStream = page.getByTestId('log-stream');
  await logStream.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 220);
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  await expect.poll(async () => {
    return page.evaluate(() => window.__LOG_QUERY_MESSAGES__.length);
  }).toBeGreaterThan(0);

  const latestQuery = await page.evaluate(() => {
    const messages = window.__LOG_QUERY_MESSAGES__ || [];
    return messages[messages.length - 1] || null;
  });
  expect(latestQuery).toBeTruthy();
  expect(latestQuery.action).toBe('logs.query');
  expect(Array.isArray(latestQuery.streams)).toBeTruthy();
  expect(latestQuery.streams.length).toBeGreaterThan(0);
  expect(typeof latestQuery.streams[0].offset).toBe('number');
  expect(typeof latestQuery.streams[0].limit).toBe('number');
});
