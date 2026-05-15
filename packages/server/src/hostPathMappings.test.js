const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildApprovedHostRoots,
  createHostPathMappingCatalog,
  joinMappedPath,
  normalizePathPrefix,
  pathStartsWithPrefix,
} = require('./hostPathMappings');

const createCatalogHarness = () => {
  const state = {
    hosts: [{
      id: 7,
      agentUuid: 'slave-7',
      name: 'clearbox',
      metadata: { directories: ['/opt/project-commander/slave/play'] },
    }],
    projects: [{
      id: 19,
      hostId: 7,
      name: 'varcad.io',
      metadata: { path: '/opt/project-commander/slave/play/varcad.io' },
    }],
    mappings: [],
  };

  class HostPathMappingRecord {
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
      async findAll({ where } = {}) {
        return state.projects.filter((entry) => Number(entry.hostId) === Number(where?.hostId));
      },
    },
    HostPathMapping: {
      async findAll({ where } = {}) {
        return state.mappings.filter((entry) => (
          Number(entry.hostId) === Number(where?.hostId)
          && (where?.enabled == null || Boolean(entry.enabled) === Boolean(where.enabled))
        ));
      },
      async findByPk(id) {
        return state.mappings.find((entry) => Number(entry.id) === Number(id)) || null;
      },
      async findOne({ where } = {}) {
        return state.mappings.find((entry) => (
          Number(entry.hostId) === Number(where?.hostId)
          && entry.codexPathPrefix === where?.codexPathPrefix
          && entry.hostPathPrefix === where?.hostPathPrefix
        )) || null;
      },
      async create(payload) {
        const record = new HostPathMappingRecord({
          id: state.mappings.length + 1,
          ...payload,
        });
        state.mappings.push(record);
        return record;
      },
      async destroy({ where } = {}) {
        const before = state.mappings.length;
        state.mappings = state.mappings.filter((entry) => {
          if (Number(entry.id) !== Number(where?.id)) {
            return true;
          }
          if (where?.hostId && Number(entry.hostId) !== Number(where.hostId)) {
            return true;
          }
          return false;
        });
        return before - state.mappings.length;
      },
    },
  };

  return {
    state,
    catalog: createHostPathMappingCatalog({ models }),
  };
};

test('normalizes prefixes and matches on path segment boundaries', () => {
  assert.equal(normalizePathPrefix('/Volumes/public/'), '/Volumes/public');
  assert.equal(pathStartsWithPrefix('/Volumes/public/play', '/Volumes/public'), true);
  assert.equal(pathStartsWithPrefix('/Volumes/publicity/play', '/Volumes/public'), false);
  assert.equal(
    joinMappedPath('/opt/project-commander/slave/play', '/Volumes/public/play', '/Volumes/public/play/varcad.io'),
    '/opt/project-commander/slave/play/varcad.io',
  );
});

test('builds approved host roots from host directories and project paths', () => {
  const roots = buildApprovedHostRoots({
    host: { metadata: { directories: ['/opt/project-commander/slave/play'] } },
    projects: [{ metadata: { path: '/opt/project-commander/slave/play/varcad.io' } }],
  });

  assert.deepEqual(roots, [
    '/opt/project-commander/slave/play',
    '/opt/project-commander/slave/play/varcad.io',
  ]);
});

test('upserts mappings and resolves the longest codex prefix to a host path', async () => {
  const { catalog } = createCatalogHarness();

  await catalog.upsertHostPathMapping({
    hostId: 7,
    codexPathPrefix: '/Volumes/public/play',
    hostPathPrefix: '/opt/project-commander/slave/play',
    createdBy: 'test',
  });
  await catalog.upsertHostPathMapping({
    hostId: 7,
    codexPathPrefix: '/Volumes/public/play/varcad.io',
    hostPathPrefix: '/opt/project-commander/slave/play/varcad.io',
    createdBy: 'test',
  });

  const resolved = await catalog.resolveHostPath({
    hostId: 7,
    path: '/Volumes/public/play/varcad.io/packages/web',
  });

  assert.equal(resolved.source, 'mapping');
  assert.equal(resolved.hostPath, '/opt/project-commander/slave/play/varcad.io/packages/web');
  assert.equal(resolved.mapping.codexPathPrefix, '/Volumes/public/play/varcad.io');
  assert.equal(resolved.approved, true);
});

test('rejects mappings whose host prefix escapes approved roots', async () => {
  const { catalog } = createCatalogHarness();

  await assert.rejects(
    () => catalog.upsertHostPathMapping({
      hostId: 7,
      codexPathPrefix: '/Volumes/public',
      hostPathPrefix: '/etc',
    }),
    /outside approved host roots/,
  );
});

test('recognizes exact discovered host project paths before mappings', async () => {
  const { catalog } = createCatalogHarness();

  const resolved = await catalog.resolveHostPath({
    hostId: 7,
    path: '/opt/project-commander/slave/play/varcad.io',
  });

  assert.equal(resolved.source, 'discovered_project');
  assert.equal(resolved.hostPath, '/opt/project-commander/slave/play/varcad.io');
});
