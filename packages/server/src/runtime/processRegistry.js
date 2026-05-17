const crypto = require('crypto');
const path = require('path');
const { sequelize } = require('../db');
const {
  DesiredProcess,
  ProcessRun,
  ProcessRuntimeState,
  HostRuntimeState,
  Host,
  Project,
  Service,
} = require('../models');

const normalizeString = (value) => String(value || '').trim();

const normalizeInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const normalizeBigIntLike = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
);

const SERVER_LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

const normalizeServerConsoleLogLevel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'info';
  }
  if (normalized === 'warning') {
    return 'warn';
  }
  return Object.prototype.hasOwnProperty.call(SERVER_LOG_LEVELS, normalized)
    ? normalized
    : 'info';
};

const sortObjectKeys = (value) => {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = sortObjectKeys(value[key]);
      return accumulator;
    }, {});
};

const stableJSONStringify = (value) => JSON.stringify(sortObjectKeys(value));

const buildEnvHash = (envJson) => crypto
  .createHash('sha256')
  .update(stableJSONStringify(normalizeObject(envJson)))
  .digest('hex');

const buildLaunchFingerprint = ({
  hostId,
  projectId,
  packageKey,
  launchMode,
  cwd,
  command,
  argsJson,
  envJson,
} = {}) => crypto
  .createHash('sha256')
  .update(stableJSONStringify({
    hostId: normalizeInteger(hostId),
    projectId: normalizeInteger(projectId),
    packageKey: normalizeString(packageKey),
    launchMode: normalizeString(launchMode || 'exec'),
    cwd: normalizeString(cwd),
    command: normalizeString(command),
    argsJson: normalizeArray(argsJson),
    envJson: normalizeObject(envJson),
  }))
  .digest('hex');

const resolveProjectPathFromModel = (project) => {
  const metadataPath = normalizeString(project?.metadata?.path);
  if (metadataPath) {
    return path.resolve(metadataPath);
  }
  const virtualPath = normalizeString(project?.path);
  if (virtualPath) {
    return path.resolve(virtualPath);
  }
  return '';
};

const envJsonToEntries = (envJson) => Object.entries(normalizeObject(envJson))
  .map(([key, value]) => ({
    key: normalizeString(key),
    value: value == null ? '' : String(value),
  }))
  .filter((entry) => entry.key)
  .sort((left, right) => left.key.localeCompare(right.key));

const envEntriesToJson = (envEntries) => normalizeArray(envEntries).reduce((accumulator, entry) => {
  const key = normalizeString(entry?.key);
  if (!key) {
    return accumulator;
  }
  accumulator[key] = entry?.value == null ? '' : String(entry.value);
  return accumulator;
}, {});

const normalizeDesiredProcessPayload = (input = {}) => {
  const envJson = normalizeObject(input.envJson);
  const argsJson = normalizeArray(input.argsJson);
  return {
    desiredProcessId: normalizeInteger(input.desiredProcessId),
    hostId: normalizeInteger(input.hostId),
    projectId: normalizeInteger(input.projectId),
    serviceId: normalizeInteger(input.serviceId),
    processKey: normalizeString(input.processKey),
    packageKey: normalizeString(input.packageKey),
    packageRelativePath: normalizeString(input.packageRelativePath) || null,
    desiredState: normalizeString(input.desiredState || 'running') || 'running',
    launchMode: normalizeString(input.launchMode || 'exec') || 'exec',
    cwd: normalizeString(input.cwd),
    command: normalizeString(input.command),
    argsJson,
    envJson,
    envHash: normalizeString(input.envHash) || buildEnvHash(envJson),
    launchFingerprint: normalizeString(input.launchFingerprint) || buildLaunchFingerprint({
      hostId: input.hostId,
      projectId: input.projectId,
      packageKey: input.packageKey,
      launchMode: input.launchMode,
      cwd: input.cwd,
      command: input.command,
      argsJson,
      envJson,
    }),
    logRoot: normalizeString(input.logRoot) || null,
    restartPolicy: normalizeString(input.restartPolicy || 'manual') || 'manual',
    createdBy: normalizeString(input.createdBy) || null,
    updatedBy: normalizeString(input.updatedBy || input.createdBy) || null,
  };
};

const normalizeProcessRunPayload = (input = {}) => ({
  desiredProcessId: normalizeInteger(input.desiredProcessId),
  hostId: normalizeInteger(input.hostId),
  projectId: normalizeInteger(input.projectId),
  serviceId: normalizeInteger(input.serviceId),
  runId: normalizeString(input.runId),
  packageKey: normalizeString(input.packageKey),
  slaveId: normalizeString(input.slaveId),
  bootId: normalizeString(input.bootId) || null,
  pid: normalizeBigIntLike(input.pid),
  pgid: normalizeInteger(input.pgid),
  launchFingerprint: normalizeString(input.launchFingerprint) || null,
  command: normalizeString(input.command),
  argsJson: normalizeArray(input.argsJson),
  cwd: normalizeString(input.cwd) || null,
  envHash: normalizeString(input.envHash) || null,
  status: normalizeString(input.status || 'starting') || 'starting',
  startedAt: input.startedAt || new Date(),
  lastSeenAt: input.lastSeenAt || new Date(),
  exitedAt: input.exitedAt || null,
  exitCode: normalizeInteger(input.exitCode),
  exitSignal: normalizeString(input.exitSignal) || null,
  logPath: normalizeString(input.logPath) || null,
  adopted: Boolean(input.adopted),
  reconciliationSource: normalizeString(input.reconciliationSource) || null,
});

const normalizeProcessRuntimeStatePayload = (input = {}) => ({
  processRunId: normalizeInteger(input.processRunId),
  sampledAt: input.sampledAt || new Date(),
  cpuPercent: Number(input.cpuPercent || 0),
  memoryPercent: Number(input.memoryPercent || 0),
  rssBytes: normalizeBigIntLike(input.rssBytes),
  vmsBytes: normalizeBigIntLike(input.vmsBytes),
  readBytes: normalizeBigIntLike(input.readBytes),
  writeBytes: normalizeBigIntLike(input.writeBytes),
  readOps: normalizeBigIntLike(input.readOps),
  writeOps: normalizeBigIntLike(input.writeOps),
  openFds: normalizeInteger(input.openFds),
  threadCount: normalizeInteger(input.threadCount),
  status: normalizeString(input.status || 'unknown') || 'unknown',
});

const normalizeHostRuntimeStatePayload = (input = {}) => ({
  hostId: normalizeInteger(input.hostId),
  slaveId: normalizeString(input.slaveId),
  bootId: normalizeString(input.bootId) || null,
  sampledAt: input.sampledAt || new Date(),
  cpuPercent: Number(input.cpuPercent || 0),
  load1m: input.load1m == null ? null : Number(input.load1m),
  load5m: input.load5m == null ? null : Number(input.load5m),
  load15m: input.load15m == null ? null : Number(input.load15m),
  memoryTotalBytes: normalizeBigIntLike(input.memoryTotalBytes),
  memoryUsedBytes: normalizeBigIntLike(input.memoryUsedBytes),
  memoryAvailableBytes: normalizeBigIntLike(input.memoryAvailableBytes),
  diskTotalBytes: normalizeBigIntLike(input.diskTotalBytes),
  diskUsedBytes: normalizeBigIntLike(input.diskUsedBytes),
  diskAvailableBytes: normalizeBigIntLike(input.diskAvailableBytes),
  diskMount: normalizeString(input.diskMount) || null,
});

const createProcessRegistry = ({
  runtimeBackend = null,
  logger = console,
  sequelizeInstance = sequelize,
  models = {
    DesiredProcess,
    ProcessRun,
    ProcessRuntimeState,
    HostRuntimeState,
    Host,
    Project,
    Service,
  },
} = {}) => {
  const runtimeLogger = (
    logger && typeof logger === 'object'
      ? logger
      : console
  );
  const consoleLogLevel = normalizeServerConsoleLogLevel(process.env.PC_SERVER_CONSOLE_LOG_LEVEL);
  const repeatedLogState = new Map();
  const {
    DesiredProcess: DesiredProcessModel,
    ProcessRun: ProcessRunModel,
    ProcessRuntimeState: ProcessRuntimeStateModel,
    HostRuntimeState: HostRuntimeStateModel,
    Host: HostModel,
    Project: ProjectModel,
    Service: ServiceModel,
  } = models;

  const shouldLogLevel = (level) => (
    SERVER_LOG_LEVELS[level] >= SERVER_LOG_LEVELS[consoleLogLevel]
  );

  const emitLog = (level, message, details = undefined) => {
    if (!shouldLogLevel(level)) {
      return;
    }
    const method = level === 'error'
      ? 'error'
      : (level === 'warn' ? 'warn' : 'log');
    const target = typeof runtimeLogger?.[method] === 'function'
      ? runtimeLogger[method].bind(runtimeLogger)
      : console[method].bind(console);
    if (details === undefined) {
      target(message);
      return;
    }
    target(message, details);
  };

  const logWarn = (message, details = undefined) => {
    emitLog('warn', message, details);
  };

  const logDebug = (message, details = undefined) => {
    emitLog('debug', message, details);
  };

  const logDebugRateLimited = (key, message, intervalMs = 30000, details = undefined) => {
    const normalizedKey = normalizeString(key);
    const now = Date.now();
    const lastLoggedAt = repeatedLogState.get(normalizedKey) || 0;
    if (normalizedKey && (now - lastLoggedAt) < intervalMs) {
      return;
    }
    if (normalizedKey) {
      repeatedLogState.set(normalizedKey, now);
    }
    logDebug(message, details);
  };

  const withTransaction = async (fn) => sequelizeInstance.transaction(fn);

  const findHostByIdOrSlaveId = async ({
    hostId,
    slaveId,
    transaction,
  } = {}) => {
    const normalizedHostId = normalizeInteger(hostId);
    if (normalizedHostId) {
      const host = await HostModel.findByPk(normalizedHostId, { transaction });
      if (host) {
        return host;
      }
    }

    const normalizedSlaveId = normalizeString(slaveId).toLowerCase();
    if (!normalizedSlaveId) {
      return null;
    }

    return HostModel.findOne({
      where: { agentUuid: normalizedSlaveId },
      transaction,
    });
  };

  const findProjectByIdOrPath = async ({
    projectId,
    projectPath,
    hostId,
    transaction,
  } = {}) => {
    const normalizedProjectId = normalizeInteger(projectId);
    if (normalizedProjectId) {
      const project = await ProjectModel.findByPk(normalizedProjectId, { transaction });
      if (project) {
        return project;
      }
    }

    const normalizedProjectPath = normalizeString(projectPath);
    if (!normalizedProjectPath) {
      return null;
    }

    const absoluteProjectPath = path.resolve(normalizedProjectPath);
    const where = {};
    const normalizedHostId = normalizeInteger(hostId);
    if (normalizedHostId) {
      where.hostId = normalizedHostId;
    }

    const projects = await ProjectModel.findAll({
      where,
      transaction,
    });

    return projects.find((project) => resolveProjectPathFromModel(project) === absoluteProjectPath) || null;
  };

  const findServiceByIdOrKey = async ({
    serviceId,
    projectId,
    packageKey,
    processKey,
    transaction,
  } = {}) => {
    const normalizedServiceId = normalizeInteger(serviceId);
    if (normalizedServiceId) {
      const service = await ServiceModel.findByPk(normalizedServiceId, { transaction });
      if (service) {
        return service;
      }
    }

    const normalizedProjectId = normalizeInteger(projectId);
    if (!normalizedProjectId) {
      return null;
    }

    const candidateKey = normalizeString(packageKey) || normalizeString(processKey);
    if (!candidateKey) {
      return null;
    }

    const services = await ServiceModel.findAll({
      where: { projectId: normalizedProjectId },
      transaction,
    });
    const targetKey = candidateKey.toLowerCase();
    return services.find((service) => {
      const nameKey = normalizeString(service?.name).toLowerCase();
      const relativePathKey = normalizeString(service?.relativePath).toLowerCase();
      return nameKey === targetKey || relativePathKey === targetKey;
    }) || null;
  };

  const hydrateDesiredProcess = async (desiredProcess, { transaction } = {}) => {
    if (!desiredProcess) {
      return null;
    }
    if (typeof desiredProcess.reload === 'function') {
      await desiredProcess.reload({
        include: [
          { model: HostModel, as: 'host', required: false },
          { model: ProjectModel, as: 'project', required: false },
          { model: ServiceModel, as: 'service', required: false },
        ],
        transaction,
      });
    }
    return desiredProcess;
  };

  const serializeDesiredProcessForMaster = (desiredProcess) => {
    if (!desiredProcess) {
      return null;
    }

    const projectPath = resolveProjectPathFromModel(desiredProcess.project);
    const payload = {
      desiredProcessId: normalizeInteger(desiredProcess.id) || 0,
      hostId: normalizeInteger(desiredProcess.hostId) || 0,
      projectId: normalizeInteger(desiredProcess.projectId) || 0,
      serviceId: normalizeInteger(desiredProcess.serviceId) || 0,
      processKey: normalizeString(desiredProcess.processKey),
      projectPath,
      packageKey: normalizeString(desiredProcess.packageKey),
      packageRelativePath: normalizeString(desiredProcess.packageRelativePath) || '',
      desiredState: normalizeString(desiredProcess.desiredState || 'running') || 'running',
      launchMode: normalizeString(desiredProcess.launchMode || 'exec') || 'exec',
      cwd: normalizeString(desiredProcess.cwd),
      command: normalizeString(desiredProcess.command),
      args: normalizeArray(desiredProcess.argsJson).map((value) => String(value)),
      env: envJsonToEntries(desiredProcess.envJson),
      envHash: normalizeString(desiredProcess.envHash),
      launchFingerprint: normalizeString(desiredProcess.launchFingerprint),
      logRoot: normalizeString(desiredProcess.logRoot),
      restartPolicy: normalizeString(desiredProcess.restartPolicy || 'manual') || 'manual',
      updatedAt: desiredProcess.updatedAt instanceof Date
        ? desiredProcess.updatedAt.toISOString()
        : normalizeString(desiredProcess.updatedAt),
    };
    return payload;
  };

  const mirrorDesiredProcessToMaster = async ({
    desiredProcess,
    slaveId,
  } = {}) => {
    const normalizedSlaveId = normalizeString(slaveId).toLowerCase();
    if (!normalizedSlaveId) {
      throw new Error('slaveId is required to mirror desired process into master');
    }
    if (typeof runtimeBackend?.upsertDesiredProcess !== 'function') {
      return { status: 'skipped' };
    }
    const serializedDesiredProcess = serializeDesiredProcessForMaster(desiredProcess);
    if (!serializedDesiredProcess?.processKey) {
      throw new Error('desired process is missing processKey and cannot be mirrored');
    }
    return runtimeBackend.upsertDesiredProcess({
      slaveId: normalizedSlaveId,
      desiredProcess: serializedDesiredProcess,
    });
  };

  const mirrorDesiredProcessDeletionToMaster = async ({
    slaveId,
    processKey,
  } = {}) => {
    const normalizedSlaveId = normalizeString(slaveId).toLowerCase();
    const normalizedProcessKey = normalizeString(processKey);
    if (!normalizedSlaveId || !normalizedProcessKey) {
      throw new Error('slaveId and processKey are required to remove mirrored desired process');
    }
    if (typeof runtimeBackend?.deleteDesiredProcess !== 'function') {
      return { status: 'skipped' };
    }
    return runtimeBackend.deleteDesiredProcess({
      slaveId: normalizedSlaveId,
      processKey: normalizedProcessKey,
    });
  };

  const upsertDesiredProcess = async (input, { transaction } = {}) => {
    const payload = normalizeDesiredProcessPayload(input);
    if (!payload.hostId || !payload.projectId || !payload.packageKey || !payload.processKey || !payload.cwd || !payload.command) {
      throw new Error('desired process requires hostId, projectId, processKey, packageKey, cwd, and command');
    }
    const { desiredProcessId, ...persistedPayload } = payload;

    let existing = null;
    if (desiredProcessId) {
      existing = await DesiredProcessModel.findByPk(desiredProcessId, { transaction });
    }
    if (!existing) {
      existing = await DesiredProcessModel.findOne({
        where: {
          hostId: persistedPayload.hostId,
          projectId: persistedPayload.projectId,
          packageKey: persistedPayload.packageKey,
        },
        transaction,
      });
    }

    if (existing) {
      await existing.update(persistedPayload, { transaction });
      return existing;
    }

    return DesiredProcessModel.create(persistedPayload, { transaction });
  };

  const removeDesiredProcess = async ({
    desiredProcessId,
    hostId,
    projectId,
    packageKey,
  } = {}, { transaction } = {}) => {
    if (normalizeInteger(desiredProcessId)) {
      return DesiredProcessModel.destroy({
        where: { id: normalizeInteger(desiredProcessId) },
        transaction,
      });
    }
    if (!normalizeInteger(hostId) || !normalizeInteger(projectId) || !normalizeString(packageKey)) {
      throw new Error('removeDesiredProcess requires desiredProcessId or hostId/projectId/packageKey');
    }
    return DesiredProcessModel.destroy({
      where: {
        hostId: normalizeInteger(hostId),
        projectId: normalizeInteger(projectId),
        packageKey: normalizeString(packageKey),
      },
      transaction,
    });
  };

  const listDesiredProcesses = async ({
    hostId,
    projectId,
    slaveId,
  } = {}, { transaction } = {}) => {
    const where = {};
    if (normalizeInteger(hostId)) {
      where.hostId = normalizeInteger(hostId);
    }
    if (normalizeInteger(projectId)) {
      where.projectId = normalizeInteger(projectId);
    }

    const include = [
      {
        model: HostModel,
        as: 'host',
        required: false,
      },
      {
        model: ProjectModel,
        as: 'project',
        required: false,
      },
      {
        model: ServiceModel,
        as: 'service',
        required: false,
      },
    ];

    if (normalizeString(slaveId)) {
      include[0].where = { agentUuid: normalizeString(slaveId).toLowerCase() };
      include[0].required = true;
    }

    return DesiredProcessModel.findAll({
      where,
      include,
      order: [
        ['hostId', 'ASC'],
        ['projectId', 'ASC'],
        ['packageKey', 'ASC'],
      ],
      transaction,
    });
  };

  const resolveDesiredProcessTarget = async (input, { transaction } = {}) => {
    const normalizedInput = input && typeof input === 'object' ? input : {};

    let host = await findHostByIdOrSlaveId({
      hostId: normalizedInput.hostId,
      slaveId: normalizedInput.slaveId,
      transaction,
    });

    const project = await findProjectByIdOrPath({
      projectId: normalizedInput.projectId,
      projectPath: normalizedInput.projectPath,
      hostId: host?.id || normalizedInput.hostId,
      transaction,
    });

    if (!host && project?.hostId) {
      host = await findHostByIdOrSlaveId({
        hostId: project.hostId,
        transaction,
      });
    }

    if (!host) {
      throw new Error('unable to resolve host for desired process');
    }
    if (!project) {
      throw new Error('unable to resolve project for desired process');
    }

    const service = await findServiceByIdOrKey({
      serviceId: normalizedInput.serviceId,
      projectId: project.id,
      packageKey: normalizedInput.packageKey,
      processKey: normalizedInput.processKey,
      transaction,
    });

    const projectPath = resolveProjectPathFromModel(project);
    const cwd = normalizeString(normalizedInput.cwd) || projectPath;
    const packageRelativePath = (
      normalizeString(normalizedInput.packageRelativePath)
      || normalizeString(service?.relativePath)
      || (
        projectPath && cwd && cwd !== projectPath
          ? path.relative(projectPath, cwd)
          : '.'
      )
    );
    const packageKey = (
      normalizeString(normalizedInput.packageKey)
      || normalizeString(service?.relativePath)
      || normalizeString(service?.name)
      || normalizeString(normalizedInput.processKey)
      || (
        packageRelativePath && packageRelativePath !== '.'
          ? packageRelativePath
          : path.basename(cwd)
      )
    );
    const processKey = normalizeString(normalizedInput.processKey) || packageKey;
    const command = normalizeString(normalizedInput.command);
    if (!command) {
      throw new Error('desired process command is required');
    }

    return {
      host,
      project,
      service,
      payload: {
        hostId: host.id,
        projectId: project.id,
        serviceId: service?.id || null,
        processKey,
        packageKey,
        packageRelativePath,
        desiredState: normalizeString(normalizedInput.desiredState || 'running') || 'running',
        launchMode: normalizeString(normalizedInput.launchMode || 'exec') || 'exec',
        cwd,
        command,
        argsJson: normalizeArray(normalizedInput.argsJson).map((value) => String(value)),
        envJson: normalizeObject(normalizedInput.envJson),
        logRoot: normalizeString(normalizedInput.logRoot) || null,
        restartPolicy: normalizeString(normalizedInput.restartPolicy || 'manual') || 'manual',
        createdBy: normalizeString(normalizedInput.createdBy) || null,
        updatedBy: normalizeString(normalizedInput.updatedBy || normalizedInput.createdBy) || null,
      },
      slaveId: normalizeString(host?.agentUuid || normalizedInput.slaveId).toLowerCase() || null,
      projectPath,
    };
  };

  const ensureDesiredProcess = async (input, options = {}) => {
    return withTransaction(async (transaction) => {
      const target = await resolveDesiredProcessTarget(input, { transaction });
      const desiredProcess = await upsertDesiredProcess(target.payload, { transaction });
      await hydrateDesiredProcess(desiredProcess, { transaction });
      if (target.slaveId) {
        await mirrorDesiredProcessToMaster({
          desiredProcess,
          slaveId: target.slaveId,
        });
      }
      return desiredProcess;
    });
  };

  const deleteDesiredProcessDefinition = async (input, options = {}) => {
    const normalizedInput = input && typeof input === 'object' ? input : {};
    return withTransaction(async (transaction) => {
      let desiredProcess = null;
      if (normalizeInteger(normalizedInput.desiredProcessId)) {
        desiredProcess = await DesiredProcessModel.findByPk(
          normalizeInteger(normalizedInput.desiredProcessId),
          {
            include: [
              { model: HostModel, as: 'host', required: false },
            ],
            transaction,
          },
        );
      } else {
        const host = await findHostByIdOrSlaveId({
          hostId: normalizedInput.hostId,
          slaveId: normalizedInput.slaveId,
          transaction,
        });
        const project = await findProjectByIdOrPath({
          projectId: normalizedInput.projectId,
          projectPath: normalizedInput.projectPath,
          hostId: host?.id || null,
          transaction,
        });
        const packageKey = normalizeString(normalizedInput.packageKey || normalizedInput.processKey);
        if (!host || !project || !packageKey) {
          throw new Error('unable to resolve desired process identity for deletion');
        }
        desiredProcess = await DesiredProcessModel.findOne({
          where: {
            hostId: host.id,
            projectId: project.id,
            packageKey,
          },
          include: [
            { model: HostModel, as: 'host', required: false },
          ],
          transaction,
        });
      }

      if (!desiredProcess) {
        return false;
      }

      const slaveId = normalizeString(desiredProcess?.host?.agentUuid || normalizedInput.slaveId).toLowerCase() || null;
      const processKey = normalizeString(desiredProcess.processKey);
      await desiredProcess.destroy({ transaction });
      if (slaveId && processKey) {
        await mirrorDesiredProcessDeletionToMaster({
          slaveId,
          processKey,
        });
      }
      return true;
    });
  };

  const createProcessRun = async (input, { transaction } = {}) => {
    const payload = normalizeProcessRunPayload(input);
    if (!payload.hostId || !payload.projectId || !payload.runId || !payload.packageKey || !payload.slaveId || !payload.command) {
      throw new Error('process run requires hostId, projectId, runId, packageKey, slaveId, and command');
    }
    return ProcessRunModel.create(payload, { transaction });
  };

  const touchProcessRun = async (runId, input, { transaction } = {}) => {
    const normalizedRunId = normalizeString(runId);
    if (!normalizedRunId) {
      throw new Error('runId is required');
    }
    const processRun = await ProcessRunModel.findOne({
      where: { runId: normalizedRunId },
      transaction,
    });
    if (!processRun) {
      return null;
    }
    const payload = normalizeProcessRunPayload({
      ...processRun.get({ plain: true }),
      ...input,
      runId: normalizedRunId,
    });
    await processRun.update(payload, { transaction });
    return processRun;
  };

  const upsertProcessRuntimeState = async (input, { transaction } = {}) => {
    const payload = normalizeProcessRuntimeStatePayload(input);
    if (!payload.processRunId) {
      throw new Error('processRunId is required');
    }

    const existing = await ProcessRuntimeStateModel.findOne({
      where: { processRunId: payload.processRunId },
      transaction,
    });
    if (existing) {
      await existing.update(payload, { transaction });
      return existing;
    }
    return ProcessRuntimeStateModel.create(payload, { transaction });
  };

  const upsertHostRuntimeState = async (input, { transaction } = {}) => {
    const payload = normalizeHostRuntimeStatePayload(input);
    if (!payload.hostId || !payload.slaveId) {
      throw new Error('hostId and slaveId are required');
    }

    const existing = await HostRuntimeStateModel.findOne({
      where: { hostId: payload.hostId },
      transaction,
    });
    if (existing) {
      await existing.update(payload, { transaction });
      return existing;
    }
    return HostRuntimeStateModel.create(payload, { transaction });
  };

  const getDesiredProcessByIdentity = async ({
    desiredProcessId,
    hostId,
    projectId,
    processKey,
    packageKey,
    transaction,
  } = {}) => {
    const normalizedDesiredProcessId = normalizeInteger(desiredProcessId);
    if (normalizedDesiredProcessId) {
      return DesiredProcessModel.findByPk(normalizedDesiredProcessId, { transaction });
    }

    const where = {};
    if (normalizeInteger(hostId)) {
      where.hostId = normalizeInteger(hostId);
    }
    if (normalizeInteger(projectId)) {
      where.projectId = normalizeInteger(projectId);
    }
    if (normalizeString(packageKey)) {
      where.packageKey = normalizeString(packageKey);
    } else if (normalizeString(processKey)) {
      where.processKey = normalizeString(processKey);
    } else {
      return null;
    }

    return DesiredProcessModel.findOne({ where, transaction });
  };

  const findOrCreateProcessRunForObservedRun = async ({
    host,
    observedRun,
    transaction,
  } = {}) => {
    const normalizedObservedRun = observedRun && typeof observedRun === 'object' ? observedRun : {};
    const normalizedRunId = normalizeString(normalizedObservedRun.runId);
    if (!host || !normalizedRunId) {
      return null;
    }

    let existingRun = await ProcessRunModel.findOne({
      where: { runId: normalizedRunId },
      transaction,
    });

    const project = await findProjectByIdOrPath({
      projectId: normalizedObservedRun.projectId,
      projectPath: normalizedObservedRun.projectPath,
      hostId: host.id,
      transaction,
    });

    const desiredProcess = await getDesiredProcessByIdentity({
      desiredProcessId: normalizedObservedRun.desiredProcessId,
      hostId: host.id,
      projectId: project?.id || null,
      processKey: normalizedObservedRun.processKey,
      packageKey: normalizedObservedRun.packageKey,
      transaction,
    });

    const resolvedProjectId = project?.id || desiredProcess?.projectId || null;
    const resolvedCommand = normalizeString(normalizedObservedRun.command || desiredProcess?.command);
    const resolvedPackageKey = normalizeString(
      normalizedObservedRun.packageKey || desiredProcess?.packageKey || normalizedObservedRun.processKey,
    );
    if (!resolvedProjectId || !resolvedCommand || !resolvedPackageKey) {
      logDebugRateLimited(
        `observed-run-unresolved:${normalizedRunId}`,
        `Skipping observed process run ${normalizedRunId}; project or command metadata could not be resolved.`,
      );
      return null;
    }

    const payload = normalizeProcessRunPayload({
      desiredProcessId: desiredProcess?.id || null,
      hostId: host.id,
      projectId: resolvedProjectId,
      serviceId: desiredProcess?.serviceId || null,
      runId: normalizedRunId,
      packageKey: resolvedPackageKey,
      slaveId: normalizeString(normalizedObservedRun.slaveId || host.agentUuid),
      bootId: normalizeString(normalizedObservedRun.bootId),
      pid: normalizedObservedRun.pid,
      pgid: normalizedObservedRun.pgid,
      launchFingerprint: normalizeString(normalizedObservedRun.launchFingerprint || desiredProcess?.launchFingerprint),
      command: resolvedCommand,
      argsJson: normalizeArray(normalizedObservedRun.args),
      cwd: normalizeString(normalizedObservedRun.cwd || desiredProcess?.cwd),
      envHash: normalizeString(normalizedObservedRun.envHash || desiredProcess?.envHash),
      status: normalizeString(normalizedObservedRun.status || 'running') || 'running',
      startedAt: normalizedObservedRun.startedAt ? new Date(normalizedObservedRun.startedAt) : new Date(),
      lastSeenAt: normalizedObservedRun.lastSeenAt ? new Date(normalizedObservedRun.lastSeenAt) : new Date(),
      exitedAt: normalizedObservedRun.exitedAt ? new Date(normalizedObservedRun.exitedAt) : null,
      exitCode: normalizedObservedRun.exitCode,
      exitSignal: normalizeString(normalizedObservedRun.exitSignal) || null,
      logPath: normalizeString(normalizedObservedRun.logPath) || null,
      adopted: Boolean(normalizedObservedRun.adopted),
      reconciliationSource: normalizeString(normalizedObservedRun.reconciliationSource) || null,
    });

    if (existingRun) {
      await existingRun.update(payload, { transaction });
      return existingRun;
    }
    return ProcessRunModel.create(payload, { transaction });
  };

  const applySlaveRuntimeState = async (runtimeStateInput, options = {}) => {
    const runtimeState = runtimeStateInput && typeof runtimeStateInput === 'object'
      ? runtimeStateInput
      : {};
    const normalizedSlaveId = normalizeString(runtimeState.slaveId).toLowerCase();
    if (!normalizedSlaveId) {
      return null;
    }

    return withTransaction(async (transaction) => {
      const host = await findHostByIdOrSlaveId({
        hostId: runtimeState.hostId,
        slaveId: normalizedSlaveId,
        transaction,
      });
      if (!host) {
        logDebugRateLimited(
          `runtime-state-missing-host:${normalizedSlaveId}`,
          `Skipping runtime state update; host was not found for slave ${normalizedSlaveId}.`,
        );
        return null;
      }

      const observedRuns = normalizeArray(runtimeState.observedRuns);
      const processTelemetry = normalizeArray(runtimeState.processTelemetry);
      const now = runtimeState.updatedAt ? new Date(runtimeState.updatedAt) : new Date();
      let hostRuntimeState = null;

      const hostTelemetry = runtimeState.hostTelemetry && typeof runtimeState.hostTelemetry === 'object'
        ? runtimeState.hostTelemetry
        : null;
      if (hostTelemetry) {
        hostRuntimeState = await upsertHostRuntimeState({
          hostId: host.id,
          slaveId: normalizedSlaveId,
          bootId: normalizeString(runtimeState.bootId) || null,
          sampledAt: hostTelemetry.sampledAt ? new Date(hostTelemetry.sampledAt) : now,
          cpuPercent: hostTelemetry.cpuPercent,
          load1m: hostTelemetry.load1m,
          load5m: hostTelemetry.load5m,
          load15m: hostTelemetry.load15m,
          memoryTotalBytes: hostTelemetry.memoryTotalBytes,
          memoryUsedBytes: hostTelemetry.memoryUsedBytes,
          memoryAvailableBytes: hostTelemetry.memoryAvailableBytes,
          diskTotalBytes: hostTelemetry.diskTotalBytes,
          diskUsedBytes: hostTelemetry.diskUsedBytes,
          diskAvailableBytes: hostTelemetry.diskAvailableBytes,
          diskMount: hostTelemetry.diskMount,
        }, { transaction });
      }

      const processRunsByRunId = new Map();
      for (const observedRun of observedRuns) {
        const processRun = await findOrCreateProcessRunForObservedRun({
          host,
          observedRun,
          transaction,
        });
        if (processRun) {
          processRunsByRunId.set(normalizeString(processRun.runId), processRun);
        }
      }

      for (const telemetrySample of processTelemetry) {
        const runId = normalizeString(telemetrySample?.runId);
        if (!runId) {
          continue;
        }
        let processRun = processRunsByRunId.get(runId) || null;
        if (!processRun) {
          processRun = await ProcessRunModel.findOne({
            where: { runId },
            transaction,
          });
          if (processRun) {
            processRunsByRunId.set(runId, processRun);
          }
        }
        if (!processRun) {
          continue;
        }
        await upsertProcessRuntimeState({
          processRunId: processRun.id,
          sampledAt: telemetrySample?.sampledAt ? new Date(telemetrySample.sampledAt) : now,
          cpuPercent: telemetrySample?.cpuPercent,
          memoryPercent: telemetrySample?.memoryPercent,
          rssBytes: telemetrySample?.rssBytes,
          vmsBytes: telemetrySample?.vmsBytes,
          readBytes: telemetrySample?.readBytes,
          writeBytes: telemetrySample?.writeBytes,
          readOps: telemetrySample?.readOps,
          writeOps: telemetrySample?.writeOps,
          openFds: telemetrySample?.openFds,
          threadCount: telemetrySample?.threadCount,
          status: normalizeString(telemetrySample?.status || processRun.status),
        }, { transaction });
      }

      return {
        host,
        hostRuntimeState,
        observedRunCount: observedRuns.length,
        processTelemetryCount: processTelemetry.length,
      };
    });
  };

  const applyReconciliationReport = async (reportInput, options = {}) => {
    const report = reportInput && typeof reportInput === 'object' ? reportInput : {};
    const normalizedSlaveId = normalizeString(report.slaveId).toLowerCase();
    if (!normalizedSlaveId) {
      return null;
    }

    const appliedRuntimeState = await applySlaveRuntimeState({
      slaveId: normalizedSlaveId,
      bootId: normalizeString(report.bootId) || null,
      observedRuns: normalizeArray(report.observedRuns),
      updatedAt: report.updatedAt || new Date().toISOString(),
    }, options);

    return {
      ...appliedRuntimeState,
      changeCount: normalizeArray(report.changes).length,
    };
  };

  const refreshSlaveRuntimeStateFromRuntimeBackend = async ({
    slaveId,
  } = {}) => {
    const normalizedSlaveId = normalizeString(slaveId).toLowerCase();
    if (!normalizedSlaveId) {
      throw new Error('slaveId is required');
    }
    if (typeof runtimeBackend?.getSlaveRuntimeState !== 'function') {
      return null;
    }

    const response = await runtimeBackend.getSlaveRuntimeState({
      slaveId: normalizedSlaveId,
    });
    if (!response || typeof response !== 'object') {
      return null;
    }
    return applySlaveRuntimeState(response);
  };

  const queueProcessKill = async ({
    slaveId,
    hostId,
    runId,
    processKey,
    pid,
    hard = false,
    reason = '',
  } = {}) => {
    const normalizedSlaveId = normalizeString(slaveId).toLowerCase()
      || normalizeString((await findHostByIdOrSlaveId({ hostId }))?.agentUuid).toLowerCase();
    if (!normalizedSlaveId) {
      throw new Error('slaveId or hostId is required');
    }
    if (typeof runtimeBackend?.queueSlaveKill !== 'function') {
      throw new Error('runtime backend does not support queueSlaveKill');
    }
    return runtimeBackend.queueSlaveKill({
      slaveId: normalizedSlaveId,
      runId: normalizeString(runId),
      processKey: normalizeString(processKey),
      pid: normalizeInteger(pid),
      hard: Boolean(hard),
      reason: normalizeString(reason),
    });
  };

  const getSlaveRuntimeState = async ({
    hostId,
    slaveId,
  } = {}, { transaction } = {}) => {
    const normalizedHostId = normalizeInteger(hostId);
    const normalizedSlaveId = normalizeString(slaveId).toLowerCase();

    let host = null;
    if (normalizedHostId) {
      host = await HostModel.findByPk(normalizedHostId, { transaction });
    } else if (normalizedSlaveId) {
      host = await HostModel.findOne({
        where: { agentUuid: normalizedSlaveId },
        transaction,
      });
    }
    if (!host) {
      return null;
    }

    const [desiredProcesses, hostRuntimeState] = await Promise.all([
      DesiredProcessModel.findAll({
        where: { hostId: host.id },
        include: [
          { model: HostModel, as: 'host', required: false },
          { model: ProjectModel, as: 'project', required: false },
          { model: ServiceModel, as: 'service', required: false },
        ],
        order: [['projectId', 'ASC'], ['packageKey', 'ASC']],
        transaction,
      }),
      HostRuntimeStateModel.findOne({
        where: { hostId: host.id },
        transaction,
      }),
    ]);

    const processRuns = await ProcessRunModel.findAll({
      where: { hostId: host.id },
      include: [
        {
          model: DesiredProcessModel,
          as: 'desiredProcess',
          required: false,
        },
        {
          model: ProcessRuntimeStateModel,
          as: 'runtimeState',
          required: false,
        },
      ],
      order: [['lastSeenAt', 'DESC']],
      transaction,
    });

    return {
      host,
      desiredProcesses,
      hostRuntimeState,
      processRuns,
    };
  };

  return {
    buildEnvHash,
    buildLaunchFingerprint,
    normalizeDesiredProcessPayload,
    normalizeProcessRunPayload,
    normalizeProcessRuntimeStatePayload,
    normalizeHostRuntimeStatePayload,
    envJsonToEntries,
    envEntriesToJson,
    resolveDesiredProcessTarget,
    serializeDesiredProcessForMaster,
    upsertDesiredProcess,
    removeDesiredProcess,
    listDesiredProcesses,
    ensureDesiredProcess,
    deleteDesiredProcessDefinition,
    createProcessRun,
    touchProcessRun,
    upsertProcessRuntimeState,
    upsertHostRuntimeState,
    applySlaveRuntimeState,
    applyReconciliationReport,
    refreshSlaveRuntimeStateFromRuntimeBackend,
    queueProcessKill,
    getSlaveRuntimeState,
    withTransaction,
  };
};

module.exports = {
  createProcessRegistry,
  buildEnvHash,
  buildLaunchFingerprint,
  normalizeDesiredProcessPayload,
  normalizeProcessRunPayload,
  normalizeProcessRuntimeStatePayload,
  normalizeHostRuntimeStatePayload,
};
