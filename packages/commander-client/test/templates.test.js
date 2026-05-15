const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDesiredProcessInputFromTemplate,
  CommanderClient,
  inferProcessTemplates,
  normalizeDesiredProcessInput,
  resolveTemplate,
} = require('../src');

const project = {
  id: 25,
  name: 'varcad.io',
  path: '/opt/project-commander/slave/play/varcad.io',
  types: ['node-project', 'node-monorepo'],
  services: ['main', 'web', 'server'],
};

const host = {
  id: 3,
  name: 'clearbox',
  agentUuid: 'slave-1',
};

test('infers safe templates for node projects', () => {
  const templates = inferProcessTemplates(project);
  const keys = templates.map((template) => template.key);

  assert.ok(keys.includes('node.dev'));
  assert.ok(keys.includes('docker.compose.up'));
  assert.ok(keys.includes('docker-compose-web'));
});

test('resolves docker-compose-web alias without caller passing raw command text', () => {
  const template = resolveTemplate({ project, template: 'docker-compose-web' });
  assert.equal(template.command, 'docker compose -f docker-compose.clearbox.yml -p varcad-io up -d');

  const desiredProcess = buildDesiredProcessInputFromTemplate({
    host,
    project,
    template,
    input: {},
    actor: 'test',
  });

  assert.equal(desiredProcess.hostId, 3);
  assert.equal(desiredProcess.agentUuid, 'slave-1');
  assert.equal(desiredProcess.projectPath, project.path);
  assert.equal(desiredProcess.packageKey, 'docker-compose-web');
  assert.equal(desiredProcess.command, 'docker compose -f docker-compose.clearbox.yml -p varcad-io up -d');
  assert.equal(desiredProcess.createdBy, 'test');
});

test('raw process definitions are disabled unless privileged scope is explicit', async () => {
  const client = new CommanderClient({
    fetch: async () => ({ json: async () => ({}), ok: true, status: 200 }),
  });

  await assert.rejects(
    () => client.ensureProcess({
      hostId: 1,
      cwd: project.path,
      launchMode: 'shell',
      command: 'echo unsafe',
    }),
    /Raw process definitions are disabled/,
  );
});

test('defaults to the Project Commander server GraphQL port', () => {
  const previousUrl = process.env.PROJECT_COMMANDER_URL;
  const previousEndpoint = process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
  delete process.env.PROJECT_COMMANDER_URL;
  delete process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
  try {
    const client = new CommanderClient({
      fetch: async () => ({ json: async () => ({}), ok: true, status: 200 }),
    });

    assert.equal(client.endpoint, 'http://127.0.0.1:4000/graphql');
  } finally {
    if (previousUrl == null) {
      delete process.env.PROJECT_COMMANDER_URL;
    } else {
      process.env.PROJECT_COMMANDER_URL = previousUrl;
    }
    if (previousEndpoint == null) {
      delete process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
    } else {
      process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT = previousEndpoint;
    }
  }
});

test('derives GraphQL endpoint from PROJECT_COMMANDER_URL', async () => {
  const previous = process.env.PROJECT_COMMANDER_URL;
  const previousEndpoint = process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
  delete process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
  process.env.PROJECT_COMMANDER_URL = 'https://commander.example.test';
  try {
    const client = new CommanderClient({
      fetch: async () => ({ json: async () => ({}), ok: true, status: 200 }),
    });

    assert.equal(client.endpoint, 'https://commander.example.test/graphql');
  } finally {
    if (previous == null) {
      delete process.env.PROJECT_COMMANDER_URL;
    } else {
      process.env.PROJECT_COMMANDER_URL = previous;
    }
    if (previousEndpoint == null) {
      delete process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
    } else {
      process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT = previousEndpoint;
    }
  }
});

test('host selector can resolve by IP through the host field', async () => {
  const client = new CommanderClient({
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          data: {
            hosts: [{ id: 7, name: 'clearbox', ip: '192.168.1.251', projects: [] }],
            discoveredProjects: {
              projects: [{
                name: 'varcad.io',
                path: project.path,
                hostId: 7,
              }],
            },
          },
        };
      },
    }),
  });

  const projects = await client.listProjects({ host: '192.168.1.251' });
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'varcad.io');
});

test('optional numeric fields keep null values instead of coercing to zero', () => {
  const input = normalizeDesiredProcessInput({
    desiredProcessId: null,
    hostId: null,
    projectId: null,
    serviceId: null,
    cwd: project.path,
    launchMode: 'shell',
    command: 'yarn dev',
  });

  assert.equal(input.desiredProcessId, null);
  assert.equal(input.hostId, null);
  assert.equal(input.projectId, null);
  assert.equal(input.serviceId, null);
});

test('templated ensure_process resolves codexPath to host-local cwd', async () => {
  const client = new CommanderClient({
    fetch: async () => ({ json: async () => ({}), ok: true, status: 200 }),
  });
  client.ensureProcessFromTemplate = async (input) => ({
    id: 1,
    ...input,
    cwd: '/opt/project-commander/slave/play/varcad.io',
    command: 'docker compose -f docker-compose.clearbox.yml -p varcad-io up -d',
  });

  const desiredProcess = await client.ensureProcess({
    host: 'clearbox',
    project: 'varcad.io',
    template: 'docker-compose-web',
    codexPath: '/Volumes/public-1/play/varcad.io',
  });

  assert.equal(desiredProcess.cwd, '/opt/project-commander/slave/play/varcad.io');
  assert.equal(desiredProcess.command, 'docker compose -f docker-compose.clearbox.yml -p varcad-io up -d');
});

test('process template methods call the server-backed template catalog', async () => {
  const requests = [];
  const client = new CommanderClient({
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.query.includes('CommanderClientProcessTemplates')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              processTemplates: [{
                templateKey: 'node.dev',
                displayName: 'Node dev',
                packageKey: 'main',
                command: 'yarn dev',
              }],
            },
          }),
        };
      }
      if (body.query.includes('CommanderClientResolveProcessTemplate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              resolveProcessTemplate: {
                hostId: 3,
                projectId: 25,
                processKey: 'main',
                packageKey: 'main',
                cwd: project.path,
                command: 'yarn dev',
              },
            },
          }),
        };
      }
      if (body.query.includes('CommanderClientEnsureProcessFromTemplate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ensureProcessFromTemplate: {
                id: 7,
                hostId: 3,
                projectId: 25,
                processKey: 'main',
                packageKey: 'main',
                cwd: project.path,
                command: 'yarn dev',
              },
            },
          }),
        };
      }
      if (body.query.includes('CommanderClientUpsertProcessTemplate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              upsertProcessTemplate: {
                id: 9,
                templateKey: 'node.dev',
                packageKey: 'main',
                command: 'yarn dev',
              },
            },
          }),
        };
      }
      if (body.query.includes('CommanderClientDeleteProcessTemplate')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              deleteProcessTemplate: true,
            },
          }),
        };
      }
      if (body.query.includes('CommanderClientWaitForRuntime')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              waitForRuntime: {
                status: 'matched',
                matchedCheck: 'http',
                elapsedMs: 10,
                httpStatus: 200,
                lastLogLines: [],
              },
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    },
  });

  client.resolveTemplateContext = async (input) => ({
    hostId: 3,
    agentUuid: 'slave-1',
    projectId: 25,
    projectPath: project.path,
    codexPath: input.codexPath || null,
  });

  const templates = await client.listProcessTemplates({
    host: 'clearbox',
    project: 'varcad.io',
    includeDisabled: true,
  });
  const resolved = await client.resolveProcessTemplate({
    host: 'clearbox',
    project: 'varcad.io',
    template: 'node.dev',
  });
  const ensured = await client.ensureProcessFromTemplate({
    host: 'clearbox',
    project: 'varcad.io',
    template: 'node.dev',
  });
  const upserted = await client.upsertProcessTemplate({
    host: 'clearbox',
    project: 'varcad.io',
    templateKey: 'node.dev',
    command: 'yarn dev',
  });
  const deleted = await client.deleteProcessTemplate({ id: 9 });

  assert.equal(templates[0].templateKey, 'node.dev');
  assert.equal(resolved.command, 'yarn dev');
  assert.equal(ensured.id, 7);
  assert.equal(upserted.id, 9);
  assert.equal(deleted, true);
  assert.equal(requests[0].variables.includeDisabled, true);
  assert.equal(requests[1].variables.templateKey, 'node.dev');
  assert.equal(requests[2].variables.templateKey, 'node.dev');
  assert.equal(requests[3].variables.createdBy, 'commander-client');
});

test('waitForRuntime delegates health checks to the server runtime wait API', async () => {
  const requests = [];
  const client = new CommanderClient({
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            waitForRuntime: {
              status: 'matched',
              matchedCheck: 'log_pattern',
              elapsedMs: 25,
              lastLogLines: ['Ready'],
            },
          },
        }),
      };
    },
  });
  client.resolveTemplateContext = async () => ({
    hostId: 3,
    agentUuid: 'slave-1',
    projectId: 25,
    projectPath: project.path,
    codexPath: null,
  });

  const result = await client.waitForRuntime({
    host: 'clearbox',
    project: 'varcad.io',
    template: 'node.dev',
    processKey: 'web',
    healthChecks: [{ type: 'log_pattern', pattern: 'Ready' }],
    timeoutMs: 30000,
  });

  assert.equal(result.status, 'matched');
  assert.equal(result.matchedCheck, 'log_pattern');
  assert.equal(requests[0].variables.templateKey, 'node.dev');
  assert.match(requests[0].variables.healthChecksJson, /Ready/);
  assert.equal(requests[0].variables.timeoutMs, 30000);
});

test('graphql requests include the Project Commander tool header', async () => {
  const seenHeaders = [];
  const client = new CommanderClient({
    actor: 'commander-client-test',
    toolName: 'project_commander.test_tool',
    fetch: async (_url, options) => {
      seenHeaders.push(options.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { hosts: [] } }),
      };
    },
  });

  await client.listHosts();

  assert.equal(seenHeaders[0]['x-project-commander-tool'], 'project_commander.test_tool');
});
