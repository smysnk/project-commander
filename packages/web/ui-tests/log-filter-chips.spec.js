const { test, expect } = require("@playwright/test");
const { installWebSocketMock } = require("./helpers/wsMock");

const DEFAULT_APP_URL = "http://localhost:3000";
const PROJECT_PATH = "/tmp/mock-project";

const MOCK_PROJECT_LOGS = [
  {
    id: 1,
    projectPath: PROJECT_PATH,
    timestamp: new Date(Date.UTC(2026, 2, 4, 14, 30, 0)).toISOString(),
    serviceName: "web",
    stream: "stdout",
    level: "info",
    message: "level=info web service started",
  },
  {
    id: 2,
    projectPath: PROJECT_PATH,
    timestamp: new Date(Date.UTC(2026, 2, 4, 14, 30, 5)).toISOString(),
    serviceName: "web",
    stream: "stdout",
    level: "debug",
    message: "level=debug web heartbeat",
  },
  {
    id: 3,
    projectPath: PROJECT_PATH,
    timestamp: new Date(Date.UTC(2026, 2, 4, 14, 30, 10)).toISOString(),
    serviceName: "api",
    stream: "stdout",
    level: "info",
    message: "level=info api request received",
  },
  {
    id: 4,
    projectPath: PROJECT_PATH,
    timestamp: new Date(Date.UTC(2026, 2, 4, 14, 30, 15)).toISOString(),
    serviceName: "api",
    stream: "stderr",
    level: "error",
    message: "level=error api failed to fetch dependency",
  },
  {
    id: 5,
    projectPath: PROJECT_PATH,
    timestamp: new Date(Date.UTC(2026, 2, 4, 14, 30, 20)).toISOString(),
    serviceName: "api",
    stream: "stdout",
    level: "debug",
    message: "level=debug api retry scheduled",
  },
];

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
          runtimeBackend: "go-master",
        },
        runtimeBackendInfo: {
          name: "go-master",
          displayName: "Go Master Agent",
          masterAgent: {
            socketPath: "/tmp/pc-master.sock",
            target: "127.0.0.1:50052",
            service: "projectcommander.master.v1.MasterControlService",
            status: "running",
            connectionStatus: "connected",
            connectionHealth: "healthy",
            lastConnectedAt: new Date().toISOString(),
            lastAttemptAt: new Date().toISOString(),
            reconnectAttempts: 0,
            version: "0.1.0",
            protocolVersion: "v1",
            startedAt: new Date().toISOString(),
            capabilities: [],
            grantedCapabilities: [],
            error: null,
          },
        },
      });
    }

    if (query.includes("discoveredProjects")) {
      return ok({
        discoveryConfig: {
          projectPath: "/tmp",
          folderPattern: ".*",
          maxDepth: 4,
        },
        discoveredProjects: {
          scannedAt: new Date().toISOString(),
          projects: [
            {
              name: "mock-app",
              path: PROJECT_PATH,
              relativePath: ".",
              hostId: null,
              hostName: null,
              services: ["web", "api"],
              types: ["node-project"],
              hasMakefile: false,
              declaredServices: [],
              runtimeStatus: "stopped",
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

    if (query.includes("query Hosts") || query.includes("\n    hosts {")) {
      return ok({ hosts: [] });
    }

    if (query.includes("projectLogs")) {
      const requestedPath = String(variables.projectPath || "");
      if (requestedPath !== PROJECT_PATH) {
        return ok({ projectLogs: [] });
      }
      return ok({
        projectLogs: MOCK_PROJECT_LOGS,
      });
    }

    if (query.includes("projectLaunchEnvironment")) {
      return ok({ projectLaunchEnvironment: [] });
    }

    if (query.includes("projectProcessStats")) {
      return ok({ projectProcessStats: [] });
    }

    if (query.includes("projectPortRangeSettings")) {
      return ok({
        projectPortRangeSettings: {
          mode: "AUTOMATIC",
          begin: null,
        },
      });
    }

    return ok({});
  });
}

async function openDashboardWithMocks(page, baseURL) {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;
  await installWebSocketMock(page, [], {
    logQueryFixtures: [
      {
        context: {
          scope: "project",
          contextKey: `project:${PROJECT_PATH}`,
          projectPath: PROJECT_PATH,
        },
        streamId: "merged",
        lines: MOCK_PROJECT_LOGS,
      },
    ],
  });
  await installGraphqlMocks(page);

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return false;
  }

  try {
    await expect(page.locator(".appShell")).toBeVisible({ timeout: 3_000 });
  } catch {
    test.skip(true, `Project Commander UI shell is unavailable at ${appUrl}.`);
    return false;
  }

  return true;
}

test("log level filter chips match package chip style and do not render level-letter glyph", async ({ page, baseURL }) => {
  const opened = await openDashboardWithMocks(page, baseURL);
  if (!opened) {
    return;
  }

  const levelFilters = page.locator(".logPanel .logFilters").first();
  const packageFilters = page.locator(".logPanel .logFilters").nth(1);
  const debugLevelChip = levelFilters.getByRole("button", { name: "Debug" });
  const webPackageChip = packageFilters.getByRole("button", { name: /^web$/i });

  await expect(debugLevelChip).toBeVisible();
  await expect(webPackageChip).toBeVisible();
  await expect(page.locator(".logLevelFilterLetter")).toHaveCount(0);

  const [levelStyle, packageStyle] = await Promise.all([
    debugLevelChip.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        borderRadius: style.borderRadius,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        fontSize: style.fontSize,
      };
    }),
    webPackageChip.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        borderRadius: style.borderRadius,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        fontSize: style.fontSize,
      };
    }),
  ]);

  expect(levelStyle).toEqual(packageStyle);
});

test("package chips toggle with same active/inactive semantics as log level chips", async ({ page, baseURL }) => {
  const opened = await openDashboardWithMocks(page, baseURL);
  if (!opened) {
    return;
  }

  const levelFilters = page.locator(".logPanel .logFilters").first();
  const packageFilters = page.locator(".logPanel .logFilters").nth(1);
  const errorLevelChip = levelFilters.getByRole("button", { name: "Error" });
  const webPackageChip = packageFilters.getByRole("button", { name: /^web$/i });

  await expect(errorLevelChip).toBeVisible();
  await expect(webPackageChip).toBeVisible();
  await expect(page.locator(".logLine")).toHaveCount(MOCK_PROJECT_LOGS.length);
  await expect(errorLevelChip).toHaveClass(/active/);
  await expect(webPackageChip).toHaveClass(/active/);

  await webPackageChip.click();
  await expect(webPackageChip).not.toHaveClass(/active/);
  await expect(page.locator(".logLine")).toHaveCount(3);

  await errorLevelChip.click();
  await expect(errorLevelChip).not.toHaveClass(/active/);
  await expect(page.locator(".logLine")).toHaveCount(2);

  await errorLevelChip.click();
  await expect(errorLevelChip).toHaveClass(/active/);
  await expect(page.locator(".logLine")).toHaveCount(3);

  await webPackageChip.click();
  await expect(webPackageChip).toHaveClass(/active/);
  await expect(page.locator(".logLine")).toHaveCount(MOCK_PROJECT_LOGS.length);
});
