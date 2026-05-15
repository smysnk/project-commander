const test = require('node:test');
const assert = require('node:assert/strict');

const { createProcessTemplateCatalog } = require('./processTemplates');

const createCatalogHarness = () => {
  const state = {
    hosts: [{
      id: 7,
      agentUuid: 'slave-7',
      name: 'clearbox',
      ip: '192.168.1.251',
    }],
    projects: [{
      id: 19,
      hostId: 7,
      name: 'varcad.io',
      metadata: {
        path: '/opt/project-commander/slave/play/varcad.io',
        types: ['node-project'],
        hasMakefile: true,
      },
    }],
    templates: [],
  };
  const runtimeCalls = [];

  class ProcessTemplateRecord {
    constructor(payload) {
      Object.assign(this, payload);
    }

    async update(payload) {
      Object.assign(this, payload);
      return this;
    }
  }

  const models = {
    Host: {
      async findByPk(id) {
        return state.hosts.find((entry) => Number(entry.id) === Number(id)) || null;
      },
      async findOne({ where } = {}) {
        return state.hosts.find((entry) => String(entry.agentUuid) === String(where?.agentUuid)) || null;
      },
    },
    Project: {
      async findByPk(id) {
        return state.projects.find((entry) => Number(entry.id) === Number(id)) || null;
      },
      async findAll({ where } = {}) {
        return state.projects.filter((entry) => Number(entry.hostId) === Number(where?.hostId));
      },
    },
    ProcessTemplate: {
      async findAll() {
        return state.templates;
      },
      async findByPk(id) {
        return state.templates.find((entry) => Number(entry.id) === Number(id)) || null;
      },
      async create(payload) {
        const record = new ProcessTemplateRecord({
          id: state.templates.length + 1,
          ...payload,
        });
        state.templates.push(record);
        return record;
      },
      async destroy({ where } = {}) {
        const before = state.templates.length;
        state.templates = state.templates.filter((entry) => {
          if (Number(entry.id) !== Number(where?.id)) {
            return true;
          }
          if (where?.hostId && Number(entry.hostId) !== Number(where.hostId)) {
            return true;
          }
          if (where?.projectId && Number(entry.projectId) !== Number(where.projectId)) {
            return true;
          }
          return false;
        });
        return before - state.templates.length;
      },
    },
  };

  const catalog = createProcessTemplateCatalog({
    models,
    hostPathMappings: {
      async resolveHostPath({ path }) {
        if (path === '/Volumes/public-1/play/varcad.io') {
          return { hostPath: '/opt/project-commander/slave/play/varcad.io' };
        }
        return { hostPath: path };
      },
    },
    processRegistry: {
      async ensureDesiredProcess(input) {
        runtimeCalls.push(input);
        return {
          id: runtimeCalls.length,
          ...input,
          host: state.hosts[0],
          project: state.projects[0],
        };
      },
    },
  });

  return {
    catalog,
    runtimeCalls,
    state,
  };
};

test('lists inferred default templates for a project', async () => {
  const { catalog } = createCatalogHarness();

  const templates = await catalog.listProcessTemplates({
    hostId: 7,
    projectId: 19,
  });
  const keys = templates.map((template) => template.templateKey);

  assert.ok(keys.includes('node.dev'));
  assert.ok(keys.includes('docker-compose-web'));
  assert.ok(keys.includes('make.start'));
});

test('project-scoped template overrides inferred defaults', async () => {
  const { catalog } = createCatalogHarness();

  await catalog.upsertProcessTemplate({
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
    displayName: 'Custom dev',
    packageKey: 'web',
    processKeyTemplate: 'custom.{{package.key}}',
    cwdTemplate: '{{project.hostPath}}/packages/web',
    launchMode: 'shell',
    command: 'yarn workspace web dev',
    createdBy: 'test',
  });

  const resolved = await catalog.resolveProcessTemplate({
    hostId: 7,
    projectId: 19,
    templateKey: 'node.dev',
  });

  assert.equal(resolved.template.source, 'persisted');
  assert.equal(resolved.template.scope, 'host_project');
  assert.equal(resolved.desiredProcess.packageKey, 'web');
  assert.equal(resolved.desiredProcess.processKey, 'custom.web');
  assert.equal(resolved.desiredProcess.cwd, '/opt/project-commander/slave/play/varcad.io/packages/web');
  assert.equal(resolved.desiredProcess.command, 'yarn workspace web dev');
});

test('disabled or non-codex templates block codex resolution instead of falling back', async () => {
  const { catalog } = createCatalogHarness();

  await catalog.upsertProcessTemplate({
    hostId: 7,
    projectId: 19,
    templateKey: 'node.test',
    displayName: 'Disabled tests',
    packageKey: 'test',
    command: 'yarn test',
    enabled: false,
  });
  await catalog.upsertProcessTemplate({
    hostId: 7,
    projectId: 19,
    templateKey: 'node.build',
    displayName: 'Admin-only build',
    packageKey: 'build',
    command: 'yarn build',
    allowCodex: false,
  });

  await assert.rejects(
    () => catalog.resolveProcessTemplate({ hostId: 7, projectId: 19, templateKey: 'node.test' }),
    /disabled/,
  );
  await assert.rejects(
    () => catalog.resolveProcessTemplate({ hostId: 7, projectId: 19, templateKey: 'node.build' }),
    /not available to Codex/,
  );
});

test('ensureProcessFromTemplate compiles codex path and persists desired state', async () => {
  const { catalog, runtimeCalls } = createCatalogHarness();

  const result = await catalog.ensureProcessFromTemplate({
    hostId: 7,
    projectId: 19,
    codexPath: '/Volumes/public-1/play/varcad.io',
    templateKey: 'docker-compose-web',
    createdBy: 'codex-test',
  });

  assert.equal(runtimeCalls.length, 1);
  assert.equal(runtimeCalls[0].cwd, '/opt/project-commander/slave/play/varcad.io');
  assert.equal(runtimeCalls[0].projectPath, '/opt/project-commander/slave/play/varcad.io');
  assert.equal(runtimeCalls[0].command, 'docker compose -f docker-compose.clearbox.yml -p varcad-io up -d');
  assert.equal(runtimeCalls[0].createdBy, 'codex-test');
  assert.equal(result.desiredProcess.id, 1);
});

test('upsertProcessTemplate updates exact scope and delete removes persisted template', async () => {
  const { catalog, state } = createCatalogHarness();

  const created = await catalog.upsertProcessTemplate({
    projectId: 19,
    templateKey: 'node.dev',
    displayName: 'Project dev',
    packageKey: 'main',
    command: 'yarn dev',
  });
  const updated = await catalog.upsertProcessTemplate({
    projectId: 19,
    templateKey: 'node.dev',
    displayName: 'Project dev updated',
    packageKey: 'main',
    command: 'yarn dev --host 0.0.0.0',
  });
  const deleted = await catalog.deleteProcessTemplate({ id: updated.id, projectId: 19 });

  assert.equal(created.id, updated.id);
  assert.equal(state.templates.length, 0);
  assert.equal(deleted, true);
});
