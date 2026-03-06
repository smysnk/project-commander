const { test, expect } = require('@playwright/test');

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

async function dragDividerToX(page, dividerLocator, targetX) {
  const dividerBox = await dividerLocator.boundingBox();
  expect(dividerBox).toBeTruthy();
  if (!dividerBox) {
    return;
  }
  const startX = dividerBox.x + (dividerBox.width / 2);
  const startY = dividerBox.y + (dividerBox.height / 2);
  await dividerLocator.dispatchEvent('mousedown', {
    button: 0,
    buttons: 1,
    clientX: startX,
    clientY: startY,
  });
  for (let step = 1; step <= 12; step += 1) {
    const x = startX + ((targetX - startX) * step / 12);
    await page.evaluate(({ clientX, clientY }) => {
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        button: 0,
        buttons: 1,
        clientX,
        clientY,
      }));
    }, { clientX: x, clientY: startY });
  }
  await page.evaluate(({ clientX, clientY }) => {
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      button: 0,
      buttons: 0,
      clientX,
      clientY,
    }));
  }, { clientX: targetX, clientY: startY });
}

test('sidebar and content drag handles stay aligned with horizontal cursor resizing', async ({ page, baseURL }) => {
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
  const mainPanels = page.locator('.mainPanels');
  const hostsSidebar = page.locator('.hostsSidebar');
  const leftPanel = page.locator('.leftPanel');
  const sidebarDivider = page.getByTestId('sidebar-divider');
  const contentDivider = page.getByTestId('content-divider');

  await expect(workspace).toBeVisible();
  await expect(mainPanels).toBeVisible();
  await expect(hostsSidebar).toBeVisible();
  await expect(leftPanel).toBeVisible();
  await expect(sidebarDivider).toBeVisible();
  await expect(contentDivider).toBeVisible();

  const workspaceBox = await workspace.boundingBox();
  expect(workspaceBox).toBeTruthy();
  if (!workspaceBox) {
    return;
  }

  const targetSidebarWidth = Math.max(240, Math.min(460, Math.round(workspaceBox.width * 0.28)));
  const targetSidebarX = workspaceBox.x + targetSidebarWidth;

  await dragDividerToX(page, sidebarDivider, targetSidebarX);
  await page.waitForTimeout(220);
  await expect.poll(async () => {
    const box = await hostsSidebar.boundingBox();
    return box ? box.width : 0;
  }).toBeGreaterThan(targetSidebarWidth - 20);

  const [sidebarBoxAfter, sidebarDividerBoxAfter] = await Promise.all([
    hostsSidebar.boundingBox(),
    sidebarDivider.boundingBox(),
  ]);
  expect(sidebarBoxAfter).toBeTruthy();
  expect(sidebarDividerBoxAfter).toBeTruthy();

  if (sidebarBoxAfter && sidebarDividerBoxAfter) {
    const sidebarWidthDelta = Math.abs(sidebarBoxAfter.width - targetSidebarWidth);
    const sidebarDividerCenterX = sidebarDividerBoxAfter.x + (sidebarDividerBoxAfter.width / 2);
    const sidebarCursorDelta = Math.abs(sidebarDividerCenterX - targetSidebarX);

    expect(sidebarWidthDelta).toBeLessThanOrEqual(20);
    expect(sidebarCursorDelta).toBeLessThanOrEqual(14);
  }

  const mainPanelsBox = await mainPanels.boundingBox();
  expect(mainPanelsBox).toBeTruthy();
  if (!mainPanelsBox) {
    return;
  }

  const targetContentRatio = 0.62;
  const targetContentX = mainPanelsBox.x + (mainPanelsBox.width * targetContentRatio);
  await dragDividerToX(page, contentDivider, targetContentX);
  const expectedLeftWidth = mainPanelsBox.width * targetContentRatio;
  await expect.poll(async () => {
    const box = await contentDivider.boundingBox();
    return box ? box.x + (box.width / 2) : 0;
  }).toBeGreaterThan(targetContentX - 30);

  const [leftPanelBoxAfter, contentDividerBoxAfter] = await Promise.all([
    leftPanel.boundingBox(),
    contentDivider.boundingBox(),
  ]);
  expect(leftPanelBoxAfter).toBeTruthy();
  expect(contentDividerBoxAfter).toBeTruthy();

  if (leftPanelBoxAfter && contentDividerBoxAfter) {
    const leftWidthDelta = Math.abs(leftPanelBoxAfter.width - expectedLeftWidth);
    const contentDividerCenterX = contentDividerBoxAfter.x + (contentDividerBoxAfter.width / 2);
    const contentCursorDelta = Math.abs(contentDividerCenterX - targetContentX);

    expect(leftWidthDelta).toBeLessThanOrEqual(36);
    expect(contentCursorDelta).toBeLessThanOrEqual(20);
  }
});
