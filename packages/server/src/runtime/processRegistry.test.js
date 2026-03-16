const test = require('node:test');
const assert = require('node:assert/strict');

const { createProcessRegistry, buildLaunchFingerprint } = require('./processRegistry');

const createRuntimeHarness = () => {
  const state = {
    desiredProcesses: [],
  };

  class DesiredProcessRecord {
    constructor(data) {
      Object.assign(this, data);
    }

    async update(payload) {
      Object.assign(this, payload);
      return this;
    }

    async reload() {
      this.host = await harness.models.Host.findByPk(this.hostId);
      this.project = await harness.models.Project.findByPk(this.projectId);
      this.service = this.serviceId ? await harness.models.Service.findByPk(this.serviceId) : null;
      return this;
    }

    async destroy() {
      state.desiredProcesses = state.desiredProcesses.filter((entry) => Number(entry.id) !== Number(this.id));
    }
  }

  const hostRecord = {
    id: 7,
    agentUuid: 'slave-7',
    name: 'blackbox',
    ip: '192.168.1.250',
  };
  const projectRecord = {
    id: 19,
    hostId: 7,
    name: 'api-project',
    metadata: { path: '/srv/projects/api-project' },
  };
  const serviceRecord = {
    id: 31,
    projectId: 19,
    name: 'api',
    relativePath: 'packages/api',
  };

  const runtimeCalls = {
    upserts: [],
    deletions: [],
  };

  const models = {
    DesiredProcess: {
      async findByPk(id) {
        return state.desiredProcesses.find((entry) => Number(entry.id) === Number(id)) || null;
      },
      async findOne({ where } = {}) {
        return state.desiredProcesses.find((entry) => (
          (!where?.hostId || Number(entry.hostId) === Number(where.hostId))
          && (!where?.projectId || Number(entry.projectId) === Number(where.projectId))
          && (!where?.packageKey || String(entry.packageKey) === String(where.packageKey))
        )) || null;
      },
      async findAll({ where } = {}) {
        return state.desiredProcesses.filter((entry) => (
          (!where?.hostId || Number(entry.hostId) === Number(where.hostId))
          && (!where?.projectId || Number(entry.projectId) === Number(where.projectId))
        ));
      },
      async create(payload) {
        const record = new DesiredProcessRecord({
          id: state.desiredProcesses.length + 1,
          ...payload,
          host: hostRecord,
          project: projectRecord,
          service: payload.serviceId ? serviceRecord : null,
        });
        state.desiredProcesses.push(record);
        return record;
      },
      async destroy({ where } = {}) {
        const beforeCount = state.desiredProcesses.length;
        state.desiredProcesses = state.desiredProcesses.filter((entry) => {
          if (where?.id && Number(entry.id) === Number(where.id)) {
            return false;
          }
          if (
            where?.hostId
            && where?.projectId
            && where?.packageKey
            && Number(entry.hostId) === Number(where.hostId)
            && Number(entry.projectId) === Number(where.projectId)
            && String(entry.packageKey) === String(where.packageKey)
          ) {
            return false;
          }
          return true;
        });
        return beforeCount - state.desiredProcesses.length;
      },
    },
    ProcessRun: {
      async findAll() {
        return [];
      },
      async findOne() {
        return null;
      },
      async create(payload) {
        return payload;
      },
    },
    ProcessRuntimeState: {
      async findOne() {
        return null;
      },
      async upsert(payload) {
        return [payload, true];
      },
    },
    HostRuntimeState: {
      async findOne() {
        return null;
      },
      async upsert(payload) {
        return [payload, true];
      },
    },
    Host: {
      async findByPk(id) {
        return Number(id) === hostRecord.id ? hostRecord : null;
      },
      async findOne({ where } = {}) {
        return String(where?.agentUuid || '').toLowerCase() === hostRecord.agentUuid ? hostRecord : null;
      },
    },
    Project: {
      async findByPk(id) {
        return Number(id) === projectRecord.id ? projectRecord : null;
      },
      async findAll({ where } = {}) {
        if (where?.hostId && Number(where.hostId) !== projectRecord.hostId) {
          return [];
        }
        return [projectRecord];
      },
    },
    Service: {
      async findByPk(id) {
        return Number(id) === serviceRecord.id ? serviceRecord : null;
      },
      async findAll({ where } = {}) {
        if (where?.projectId && Number(where.projectId) !== serviceRecord.projectId) {
          return [];
        }
        return [serviceRecord];
      },
    },
  };

  const harness = {
    state,
    runtimeCalls,
    models,
    registry: createProcessRegistry({
      sequelizeInstance: {
        async transaction(fn) {
          return fn({});
        },
      },
      runtimeBackend: {
        async upsertDesiredProcess(payload) {
          runtimeCalls.upserts.push(payload);
          return { status: 'ok' };
        },
        async deleteDesiredProcess(payload) {
          runtimeCalls.deletions.push(payload);
          return { status: 'ok' };
        },
      },
      logger: {
        log() {},
        warn() {},
        error() {},
      },
      models,
    }),
    hostRecord,
    projectRecord,
    serviceRecord,
  };

  return harness;
};

test('ensureDesiredProcess persists the definition and mirrors it into the master backend', async () => {
  const harness = createRuntimeHarness();

  const desiredProcess = await harness.registry.ensureDesiredProcess({
    hostId: harness.hostRecord.id,
    projectId: harness.projectRecord.id,
    serviceId: harness.serviceRecord.id,
    packageKey: 'packages/api',
    processKey: 'api',
    launchMode: 'exec',
    cwd: '/srv/projects/api-project/packages/api',
    command: 'yarn',
    argsJson: ['dev'],
    envJson: { NODE_ENV: 'development' },
    restartPolicy: 'always',
    createdBy: 'process-registry-test',
  });

  assert.equal(desiredProcess.hostId, harness.hostRecord.id);
  assert.equal(desiredProcess.projectId, harness.projectRecord.id);
  assert.equal(desiredProcess.serviceId, harness.serviceRecord.id);
  assert.equal(desiredProcess.launchMode, 'exec');
  assert.equal(desiredProcess.command, 'yarn');
  assert.deepEqual(desiredProcess.argsJson, ['dev']);
  assert.deepEqual(desiredProcess.envJson, { NODE_ENV: 'development' });
  assert.equal(harness.runtimeCalls.upserts.length, 1);
  assert.equal(harness.runtimeCalls.upserts[0].slaveId, harness.hostRecord.agentUuid);
  assert.equal(harness.runtimeCalls.upserts[0].desiredProcess.processKey, 'api');
  assert.equal(
    harness.runtimeCalls.upserts[0].desiredProcess.launchFingerprint,
    buildLaunchFingerprint({
      hostId: harness.hostRecord.id,
      projectId: harness.projectRecord.id,
      packageKey: 'packages/api',
      launchMode: 'exec',
      cwd: '/srv/projects/api-project/packages/api',
      command: 'yarn',
      argsJson: ['dev'],
      envJson: { NODE_ENV: 'development' },
    }),
  );
});

test('deleteDesiredProcessDefinition removes the definition and mirrors the deletion', async () => {
  const harness = createRuntimeHarness();
  const desiredProcess = await harness.registry.ensureDesiredProcess({
    hostId: harness.hostRecord.id,
    projectId: harness.projectRecord.id,
    packageKey: 'packages/api',
    processKey: 'api',
    launchMode: 'exec',
    cwd: '/srv/projects/api-project/packages/api',
    command: 'yarn',
    argsJson: ['dev'],
  });

  const deleted = await harness.registry.deleteDesiredProcessDefinition({
    desiredProcessId: desiredProcess.id,
  });

  assert.equal(deleted, true);
  assert.equal(harness.state.desiredProcesses.length, 0);
  assert.equal(harness.runtimeCalls.deletions.length, 1);
  assert.deepEqual(harness.runtimeCalls.deletions[0], {
    slaveId: harness.hostRecord.agentUuid,
    processKey: 'api',
  });
});

test('getSlaveRuntimeState returns the host bundle for the requested agent uuid', async () => {
  const harness = createRuntimeHarness();
  const desiredProcess = await harness.registry.ensureDesiredProcess({
    hostId: harness.hostRecord.id,
    projectId: harness.projectRecord.id,
    packageKey: 'packages/api',
    processKey: 'api',
    launchMode: 'exec',
    cwd: '/srv/projects/api-project/packages/api',
    command: 'yarn',
  });

  const runtimeState = await harness.registry.getSlaveRuntimeState({
    slaveId: harness.hostRecord.agentUuid,
  });

  assert.equal(runtimeState.host.id, harness.hostRecord.id);
  assert.equal(runtimeState.desiredProcesses.length, 1);
  assert.equal(runtimeState.desiredProcesses[0].id, desiredProcess.id);
  assert.deepEqual(runtimeState.processRuns, []);
  assert.equal(runtimeState.hostRuntimeState, null);
});
