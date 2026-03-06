const { test, expect } = require("@playwright/test");
const { installWebSocketMock } = require("./helpers/wsMock");

const DEFAULT_APP_URL = "http://localhost:3000";

const HOST_ONE = {
  id: 1,
  agentUuid: "host-1",
  ip: "192.168.1.250",
  port: 45268,
  name: "blackbox",
  source: "manual",
  online: true,
  health: "healthy",
  status: "registered",
  lastSeenAt: new Date().toISOString(),
  error: null,
  directories: ["~/play"],
  projects: [],
};

const HOST_TWO = {
  id: 2,
  agentUuid: "host-2",
  ip: "192.168.1.251",
  port: 45269,
  name: "atlas",
  source: "manual",
  online: true,
  health: "healthy",
  status: "registered",
  lastSeenAt: new Date().toISOString(),
  error: null,
  directories: ["~/play"],
  projects: [],
};

const WS_EVENTS = [
  {
    kind: "event",
    eventId: "evt-host-1",
    topic: "log.overlay",
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 4, 10, 0, 0)).toISOString(),
      serviceName: "slave-agent",
      source: "slave-agent",
      stream: "stdout",
      message: "slave contact host-1",
      hostId: HOST_ONE.id,
      hostName: HOST_ONE.name,
      hostIp: HOST_ONE.ip,
    },
  },
  {
    kind: "event",
    eventId: "evt-master-host-1",
    topic: "log.overlay",
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 4, 10, 0, 1)).toISOString(),
      serviceName: "agent-master",
      source: "master-agent",
      stream: "stdout",
      message: "master observed host-1",
      hostId: HOST_ONE.id,
      hostName: HOST_ONE.name,
      hostIp: HOST_ONE.ip,
    },
  },
  {
    kind: "event",
    eventId: "evt-host-2",
    topic: "log.overlay",
    payload: {
      timestamp: new Date(Date.UTC(2026, 2, 4, 10, 0, 2)).toISOString(),
      serviceName: "slave-agent",
      source: "slave-agent",
      stream: "stdout",
      message: "slave contact host-2",
      hostId: HOST_TWO.id,
      hostName: HOST_TWO.name,
      hostIp: HOST_TWO.ip,
    },
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
          projects: [],
        },
      });
    }

    if (query.includes("query Hosts") || query.includes("\n    hosts {")) {
      return ok({
        hosts: [HOST_ONE, HOST_TWO],
      });
    }

    if (query.includes("projectLogs")) {
      return ok({ projectLogs: [] });
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

test("shows slave-agent host logs in logs pane when host is selected and no project is selected", async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  await installWebSocketMock(page, WS_EVENTS);
  await installGraphqlMocks(page);

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return;
  }

  try {
    await expect(page.locator(".appShell")).toBeVisible({ timeout: 3_000 });
  } catch {
    test.skip(true, `Project Commander UI shell is unavailable at ${appUrl}.`);
    return;
  }

  await expect(page.locator(".projectRow")).toHaveCount(0);

  const blackboxHost = page.locator(".hostList .hostCard").filter({ hasText: /blackbox/i }).first();
  await expect(blackboxHost).toBeVisible();
  await blackboxHost.click();
  await expect(blackboxHost).toHaveClass(/selected/);

  await page.getByRole("tab", { name: "Logs" }).click();

  const logStream = page.getByTestId("log-stream");
  await expect(logStream).toBeVisible();
  await expect(logStream).toContainText("slave contact host-1");
  await expect(logStream).not.toContainText("master observed host-1");
  await expect(logStream).not.toContainText("slave contact host-2");
  const slaveAgentTagCount = await logStream
    .locator(".logServiceTag")
    .filter({ hasText: "slave-agent" })
    .count();
  expect(slaveAgentTagCount).toBeGreaterThan(0);
  await expect(logStream.locator(".logServiceTag").filter({ hasText: "agent-master" })).toHaveCount(0);
});
