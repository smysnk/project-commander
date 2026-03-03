const { test, expect } = require("@playwright/test");

const DEFAULT_APP_URL = "http://localhost:3000";
const PROJECT_PATH = "/tmp/mock-project";

const buildMockLogs = (count = 260) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    timestamp: new Date(Date.UTC(2026, 2, 2, 12, 0, index % 60)).toISOString(),
    serviceName: "web",
    stream: "stdout",
    message: `Mock log line ${index + 1} ${"-".repeat(32)}`,
  }));

const MOCK_LOGS = buildMockLogs();

async function installGraphqlMocks(page) {
  await page.route("**/graphql", async (route) => {
    let body = {};
    try {
      body = route.request().postDataJSON() || {};
    } catch {
      body = {};
    }

    const query = String(body.query || "");
    const variables = body.variables || {};
    const ok = (payload) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: payload }),
      });

    if (query.includes("runtimeConfig")) {
      return ok({
        runtimeConfig: {
          appUrl: DEFAULT_APP_URL,
          graphqlEndpoint: "/graphql",
          wsEndpoint: "ws://localhost:4000/ws",
        },
      });
    }

    if (query.includes("discoveredProjects")) {
      return ok({
        discoveryConfig: {
          projectPath: "/tmp",
          folderPattern: ".*",
          maxDepth: 6,
        },
        discoveredProjects: {
          scannedAt: new Date().toISOString(),
          projects: [
            {
              name: "mock-app",
              path: PROJECT_PATH,
              relativePath: ".",
              services: ["web"],
              types: ["node-project"],
              hasMakefile: false,
              declaredServices: [],
              runtimeStatus: "started",
              runtimePid: 12345,
              runtimePorts: [3000],
              runtimePortRangeBegin: 4000,
              runtimePortRangeEnd: 4009,
              runtimeServicePorts: { main: 3000, graphql: null, api: null, admin: null },
              runtimeServicePids: { main: 12345, graphql: null, api: null, admin: null },
              runtimeServiceStates: { main: "started", graphql: "stopped", api: "stopped", admin: "stopped" },
              runtimeServiceEntries: [
                {
                  key: "main",
                  serviceName: "web",
                  pid: 12345,
                  port: 3000,
                  state: "started",
                },
              ],
              runtimeLastExitCode: null,
            },
          ],
        },
      });
    }

    if (query.includes("projectLogs")) {
      const requestedPath = String(variables.projectPath || "");
      if (requestedPath !== PROJECT_PATH) {
        return ok({ projectLogs: [] });
      }

      const afterId = Number(variables.afterId || 0);
      const limit = Number(variables.limit || MOCK_LOGS.length);
      const rows = afterId > 0
        ? MOCK_LOGS.filter((entry) => entry.id > afterId).slice(0, limit)
        : MOCK_LOGS.slice(-Math.max(limit, 0));

      return ok({
        projectLogs: rows.map((entry) => ({
          ...entry,
          projectPath: PROJECT_PATH,
        })),
      });
    }

    if (query.includes("projectLaunchEnvironment")) {
      return ok({ projectLaunchEnvironment: [] });
    }

    if (query.includes("projectProcessStats")) {
      return ok({ projectProcessStats: [] });
    }

    if (query.includes("toggleProjectRuntime")) {
      return ok({
        toggleProjectRuntime: {
          projectPath: PROJECT_PATH,
          status: "started",
          pid: 12345,
          startedAt: new Date().toISOString(),
          stoppedAt: null,
          lastExitCode: null,
        },
      });
    }

    if (query.includes("toggleServiceRuntime")) {
      return ok({
        toggleServiceRuntime: {
          projectPath: PROJECT_PATH,
          status: "started",
          pid: 12345,
          servicePids: { main: 12345, graphql: null, api: null, admin: null },
          serviceStates: { main: "started", graphql: "stopped", api: "stopped", admin: "stopped" },
        },
      });
    }

    return ok({});
  });
}

test("shows 'Scroll to bottom' near the lower middle when logs are scrolled upward", async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installGraphqlMocks(page);

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return;
  }

  const logStream = page.getByTestId("log-stream");
  await expect(logStream).toBeVisible();
  await expect(page.locator(".logLine")).toHaveCount(MOCK_LOGS.length);

  const jumpButton = page.getByTestId("scroll-to-bottom");
  await expect(jumpButton).toHaveCount(0);

  await logStream.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(jumpButton).toBeVisible();
  await expect(jumpButton).toHaveText("Scroll to bottom");

  const logStreamBox = await logStream.boundingBox();
  const jumpButtonBox = await jumpButton.boundingBox();
  expect(logStreamBox).toBeTruthy();
  expect(jumpButtonBox).toBeTruthy();

  if (logStreamBox && jumpButtonBox) {
    const streamCenterX = logStreamBox.x + (logStreamBox.width / 2);
    const buttonCenterX = jumpButtonBox.x + (jumpButtonBox.width / 2);
    const buttonCenterY = jumpButtonBox.y + (jumpButtonBox.height / 2);
    const lowerRegionY = logStreamBox.y + (logStreamBox.height * 0.6);

    expect(Math.abs(buttonCenterX - streamCenterX)).toBeLessThanOrEqual(logStreamBox.width * 0.2);
    expect(buttonCenterY).toBeGreaterThanOrEqual(lowerRegionY);
  }
});

test("shows 'Scroll to bottom' while away from bottom and hides it when scrolled back to bottom", async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installGraphqlMocks(page);

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return;
  }

  const logStream = page.getByTestId("log-stream");
  await expect(logStream).toBeVisible();
  await expect(page.locator(".logLine")).toHaveCount(MOCK_LOGS.length);

  const scrollButton = page.getByTestId("scroll-to-bottom");
  await expect(scrollButton).toHaveCount(0);

  // Move away from bottom: follow mode should disable and button should appear.
  await logStream.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight - 200);
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(scrollButton).toBeVisible();

  // While still scrolling away from bottom, the button remains visible.
  await logStream.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollTop - 120);
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(scrollButton).toBeVisible();

  // Reaching the bottom manually should re-enable follow mode and hide the button.
  await logStream.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(scrollButton).toHaveCount(0);
});

test("'Scroll to bottom' button is absolutely positioned", async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installGraphqlMocks(page);

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return;
  }

  const logStream = page.getByTestId("log-stream");
  await expect(logStream).toBeVisible();
  await expect(page.locator(".logLine")).toHaveCount(MOCK_LOGS.length);

  await logStream.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  const scrollButton = page.getByTestId("scroll-to-bottom");
  await expect(scrollButton).toBeVisible();

  const position = await scrollButton.evaluate((node) => window.getComputedStyle(node).position);
  expect(position).toBe("absolute");

  const logPanel = page.getByTestId("log-panel");
  await expect(logPanel).toBeVisible();

  const isParentLogPanel = await scrollButton.evaluate(
    (node) => node.parentElement?.classList.contains("logPanel") === true,
  );
  expect(isParentLogPanel).toBe(true);

  const parentPosition = await logPanel.evaluate((node) => window.getComputedStyle(node).position);
  expect(parentPosition).toBe("relative");
});
