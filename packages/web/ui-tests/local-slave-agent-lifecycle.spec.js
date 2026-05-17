const { test, expect } = require("@playwright/test");
const { selectWorkspacePanel } = require("./helpers/workspacePanels");

const DEFAULT_APP_URL = "http://localhost:3000";

function buildHostRecord({
  id,
  ip,
  name,
  agentUuid,
  targetSocket = null,
  projectCount = 0,
  projects = [],
  status = "registered",
  online = true,
  health = "healthy",
} = {}) {
  return {
    id: Number(id),
    agentUuid: String(agentUuid || `agent-${id}`),
    ip: String(ip || ""),
    port: 0,
    name: String(name || ip || `host-${id}`),
    source: "manual",
    online: Boolean(online),
    health: String(health || "unknown"),
    status: String(status || "unknown"),
    lastSeenAt: new Date().toISOString(),
    error: null,
    version: "0.1.0",
    protocolVersion: "v1",
    targetSocket,
    directories: ["~/play"],
    projectCount,
    projects,
  };
}

async function installGraphqlMocks(page) {
  const state = {
    hosts: [],
    nextHostId: 1,
    lastDeleteVariables: null,
  };
  const runtimeBackendInfoPayload = {
    name: "go-master",
    displayName: "Go Master Agent",
    masterAgent: {
      socketPath: "/tmp/project-commander/master.sock",
      target: "/tmp/project-commander/master.sock",
      slaveControlTarget: "127.0.0.1:50052",
      slaveControlPort: 50052,
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
  };

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
          version: "0.1.0",
          protocolVersion: "v1",
          slaveTargetVersion: "0.1.0",
        },
        runtimeBackendInfo: runtimeBackendInfoPayload,
      });
    }

    if (query.includes("runtimeBackendInfo")) {
      return ok({
        runtimeBackendInfo: runtimeBackendInfoPayload,
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
      return ok({ hosts: state.hosts });
    }

    if (query.includes("mutation AddHost")) {
      const target = String(variables.ip || "").trim();
      const hostId = state.nextHostId;
      state.nextHostId += 1;
      const host = buildHostRecord({
        id: hostId,
        ip: target || "localhost",
        name: target || "localhost",
        agentUuid: `local-agent-${hostId}`,
        targetSocket: "/tmp/project-commander/master.sock",
        projectCount: 3,
        projects: [
          { id: 101, name: "alpha", path: "/tmp/alpha" },
          { id: 102, name: "bravo", path: "/tmp/bravo" },
          { id: 103, name: "charlie", path: "/tmp/charlie" },
        ],
      });
      state.hosts = [...state.hosts, host];
      return ok({
        addHost: {
          id: host.id,
          ip: host.ip,
          port: host.port,
          name: host.name,
          source: host.source,
        },
      });
    }

    if (query.includes("mutation DeleteHost")) {
      const hostId = Number(variables.hostId);
      state.lastDeleteVariables = { ...variables };
      state.hosts = state.hosts.filter((host) => Number(host.id) !== hostId);
      return ok({ deleteHost: true });
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

  return state;
}

test("adds local slave host, verifies local-socket deployment, and removes host", async ({ page, baseURL }) => {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  const graphqlMockState = await installGraphqlMocks(page);

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

  await selectWorkspacePanel(page, "Hosts");
  await expect(page.locator(".hostList .hostCard")).toHaveCount(0);

  const addHostResult = await page.evaluate(async () => {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation AddHost($ip: String!) {
            addHost(ip: $ip) {
              id
              ip
              name
              source
            }
          }
        `,
        variables: {
          ip: "localhost",
        },
      }),
    });
    return response.json();
  });
  expect(addHostResult?.data?.addHost?.ip).toBe("localhost");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".appShell")).toBeVisible({ timeout: 3_000 });

  await selectWorkspacePanel(page, "Hosts");
  const localhostCard = page.locator(".hostList .hostCard").filter({ hasText: /localhost/i });
  await expect(localhostCard).toBeVisible();
  await expect(localhostCard).toContainText(/registered/i);

  await localhostCard.click();
  await expect(localhostCard).toContainText("Target");
  await expect(localhostCard).toContainText("/tmp/project-commander/master.sock");
  await expect(localhostCard).not.toContainText("Port");
  await expect(localhostCard).toContainText("Projects");
  await expect(localhostCard).toContainText("3 detected");
  await expect(localhostCard).toContainText("Version");
  await expect(localhostCard).toContainText("0.1.0 (Proto v1)");
  await selectWorkspacePanel(page, "Runtime");
  await expect(page.locator(".statusMasterLink")).toContainText("Master link: connected");

  await selectWorkspacePanel(page, "Hosts");
  await localhostCard.dispatchEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 160,
    clientY: 160,
  });
  const contextMenu = page.getByRole("menu");
  await expect(contextMenu.getByRole("menuitem", { name: "Delete host" })).toBeVisible();
  await contextMenu.getByRole("menuitem", { name: "Delete host" }).click();

  const deleteDialog = page.getByRole("dialog", { name: "Delete Host" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText("Remove contents of configured host directories");
  await expect(deleteDialog).toContainText("~/play");
  await deleteDialog.getByRole("checkbox").check();
  await deleteDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.locator(".hostList .hostCard")).toHaveCount(0);
  await expect(page.locator(".hostsSidebarBody")).toContainText("No slave agents registered with master agent.");
  expect(graphqlMockState.lastDeleteVariables).toMatchObject({
    hostId: 1,
    removeDirectoryContents: true,
  });
});
