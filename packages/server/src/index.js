const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { sequelize } = require('./db');
const { runMigrations } = require('./migrate');
const { initModelAssociations } = require('./models');
const { listCustomProjectPaths, syncDiscoveredProjects } = require('./projectCatalog');
const {
  addManualHost,
  deleteHostById,
  getHostById,
  findHostByRuntimeIdentity,
  normalizeHostDirectoryPath,
  getHostDirectoriesFromMetadata,
  addHostDirectory: addHostDirectoryInCatalog,
  removeHostDirectory: removeHostDirectoryInCatalog,
  syncRegisteredHosts,
  listHostsWithProjects,
} = require('./hostCatalog');
const {
  deploySlaveToHost,
  createRemoteHostDirectory,
  removeRemoteHostDirectory,
} = require('./hostDeployment');
const { createTerminalSessionManager } = require('./terminalSessionManager');
const { createProcessRegistry } = require('./runtime/processRegistry');
const {
  isHostVersionOutOfDate,
  createHostAgentAutoUpgradeController,
  resolveAutoUpgradeEnabled,
  resolveAutoUpgradeCooldownMs,
} = require('./hostAgentLifecycle');
const {
  parseMaxDepth,
  buildFolderPattern,
  isDirectory,
} = require('./discovery');
const { createRuntimeBackend, normalizeBackendName } = require('./runtime/backend');
const { typeDefs, createResolvers } = require('./graphql');
const { version: serverPackageVersion } = require('../package.json');
const { version: slavePackageVersion } = require('../../agent-slave/package.json');

require('./env');

const PORT = Number(process.env.SERVER_PORT || 4000);
const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const lifecycleEvent = String(process.env.npm_lifecycle_event || '').toLowerCase();
const isDevMode = nodeEnv === 'development' || nodeEnv === 'dev' || lifecycleEvent === 'dev';
const shouldRunMigrationsOnStartup =
  isDevMode && process.env.RUN_MIGRATIONS_ON_STARTUP !== 'false';

const discoveryConfig = {
  projectPath: path.resolve(process.env.PROJECT_PATH || process.cwd()),
  folderPattern: process.env.PROJECT_FOLDER_PATTERN || '.*',
  maxDepth: parseMaxDepth(process.env.SCAN_MAX_DEPTH || 6),
};
const EVENT_PROTOCOL_VERSION = 'v1';
const SERVER_VERSION = String(serverPackageVersion || '').trim() || '0.0.0-dev';
const EVENT_BUFFER_LIMIT = 4000;
const WS_PING_INTERVAL_MS = 15000;
const WS_MAX_BUFFERED_AMOUNT = 1024 * 1024;
const DEPLOY_SUDO_PASSWORD_REQUEST_TIMEOUT_SECONDS = Math.max(
  15,
  Number.parseInt(String(process.env.PC_DEPLOY_SUDO_PASSWORD_TIMEOUT_SECONDS || '120').trim(), 10) || 120,
);
const LOG_EVENT_TOPICS = new Set(['log.overlay', 'project.log.append', 'process.log.append']);
const LOG_QUERY_MAX_LIMIT = 1200;
const RUNTIME_LOG_SOURCES = new Set(['nextjs-client', 'node-backend', 'master-agent', 'agent-master']);
const MASTER_LOG_SOURCES = new Set(['master-agent', 'agent-master']);
const DEFAULT_LOCAL_SLAVE_SOCKET_PATH = '/tmp/project-commander/master.sock';

const isLoopbackHostTarget = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.')
  );
};

const resolveLocalSlaveSocketTarget = () => {
  const fromEnv = String(
    process.env.PC_MASTER_SLAVE_SOCKET_PATH || process.env.PC_MASTER_SOCKET_PATH || '',
  ).trim();
  return fromEnv || DEFAULT_LOCAL_SLAVE_SOCKET_PATH;
};

const resolveSlaveTargetVersion = () => {
  const fromEnv = String(process.env.PC_SLAVE_TARGET_VERSION || '').trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromPackage = String(slavePackageVersion || '').trim();
  return fromPackage || null;
};

const SLAVE_TARGET_VERSION = resolveSlaveTargetVersion();

const isTransientMasterStartupError = (error) => {
  const code = Number(error?.code);
  const details = String(error?.details || error?.message || '').toLowerCase();
  return (
    code === 14
    || details.includes('unavailable')
    || details.includes('connect enoent')
    || details.includes('master.sock')
  );
};

const validateAndNormalizeConfig = async (input) => {
  const nextConfig = {
    projectPath: discoveryConfig.projectPath,
    folderPattern: discoveryConfig.folderPattern,
    maxDepth: discoveryConfig.maxDepth,
  };

  if (Object.prototype.hasOwnProperty.call(input, 'projectPath')) {
    if (typeof input.projectPath !== 'string' || input.projectPath.trim().length === 0) {
      throw new Error('projectPath must be a non-empty string');
    }

    const normalizedProjectPath = path.resolve(input.projectPath.trim());
    if (!(await isDirectory(normalizedProjectPath))) {
      throw new Error(`projectPath is not a directory: ${normalizedProjectPath}`);
    }
    nextConfig.projectPath = normalizedProjectPath;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'folderPattern')) {
    if (typeof input.folderPattern !== 'string' || input.folderPattern.trim().length === 0) {
      throw new Error('folderPattern must be a non-empty regex string');
    }

    buildFolderPattern(input.folderPattern.trim());
    nextConfig.folderPattern = input.folderPattern.trim();
  }

  if (Object.prototype.hasOwnProperty.call(input, 'maxDepth')) {
    const parsedDepth = Number(input.maxDepth);
    if (!Number.isInteger(parsedDepth) || parsedDepth < 0 || parsedDepth > 20) {
      throw new Error('maxDepth must be an integer between 0 and 20');
    }

    nextConfig.maxDepth = parsedDepth;
  }

  return nextConfig;
};

const startServer = async () => {
  const runtimeBackendMode = normalizeBackendName();
  const runtimeBackend = createRuntimeBackend();
  const processRegistry = createProcessRegistry({
    runtimeBackend,
    logger: console,
  });
  const customProjectPaths = new Set();

  initModelAssociations();

  try {
    await sequelize.authenticate();
    if (shouldRunMigrationsOnStartup) {
      console.log('Running database migrations on startup...');
      await runMigrations();
    }
    console.log('Database connection established.');
  } catch (error) {
    console.error('Unable to initialize database connection/migrations:', error);
    process.exit(1);
  }

  const app = express();
  const httpServer = http.createServer(app);
  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
  const wsClients = new Set();
  const wsClientState = new Map();
  const eventBuffer = [];
  let nextEventSequence = 1;
  const toIsoTimestamp = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return new Date().toISOString();
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return new Date().toISOString();
    }
    return parsed.toISOString();
  };
  const normalizeTopicFilter = (topics) => {
    if (!Array.isArray(topics) || topics.length === 0) {
      return new Set(['*']);
    }
    const next = new Set(
      topics
        .map((topic) => String(topic || '').trim())
        .filter(Boolean),
    );
    return next.size > 0 ? next : new Set(['*']);
  };
  const canReceiveTopic = (state, topic) => {
    if (!state || !state.subscribed) {
      return false;
    }
    if (state.topics.has('*')) {
      return true;
    }
    return state.topics.has(topic);
  };
  const rememberEvent = (event) => {
    eventBuffer.push(event);
    if (eventBuffer.length > EVENT_BUFFER_LIMIT) {
      eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_LIMIT);
    }
  };
  const buildEvent = ({
    topic,
    source = 'node-backend',
    entityId = null,
    payload = {},
    timestamp,
  } = {}) => {
    const normalizedTopic = String(topic || '').trim();
    if (!normalizedTopic) {
      return null;
    }
    const seq = nextEventSequence;
    nextEventSequence += 1;
    return {
      kind: 'event',
      protocolVersion: EVENT_PROTOCOL_VERSION,
      eventId: `evt-${seq}`,
      seq,
      ts: toIsoTimestamp(timestamp),
      topic: normalizedTopic,
      source: String(source || 'node-backend'),
      entityId: entityId == null ? null : String(entityId),
      payload: payload && typeof payload === 'object' ? payload : {},
    };
  };
  const replayEventsToSocket = (socket, { lastEventId = null } = {}) => {
    const state = wsClientState.get(socket);
    if (!state || !state.subscribed || socket.readyState !== 1) {
      return;
    }
    let startIndex = 0;
    const normalizedLastEventId = String(lastEventId || '').trim();
    if (normalizedLastEventId) {
      const foundIndex = eventBuffer.findIndex((event) => event.eventId === normalizedLastEventId);
      startIndex = foundIndex >= 0 ? foundIndex + 1 : Math.max(0, eventBuffer.length - EVENT_BUFFER_LIMIT);
    }
    for (let index = startIndex; index < eventBuffer.length; index += 1) {
      const event = eventBuffer[index];
      if (!canReceiveTopic(state, event.topic)) {
        continue;
      }
      socket.send(JSON.stringify(event));
    }
  };
  const publishEvent = ({
    topic,
    source = 'node-backend',
    entityId = null,
    payload = {},
    timestamp,
  } = {}) => {
    const event = buildEvent({
      topic,
      source,
      entityId,
      payload,
      timestamp,
    });
    if (!event) {
      return null;
    }
    rememberEvent(event);
    const serialized = JSON.stringify(event);
    for (const socket of wsClients) {
      const state = wsClientState.get(socket);
      if (!state || socket.readyState !== 1 || !canReceiveTopic(state, event.topic)) {
        continue;
      }
      if (
        LOG_EVENT_TOPICS.has(event.topic) &&
        Number(socket.bufferedAmount || 0) > WS_MAX_BUFFERED_AMOUNT
      ) {
        state.droppedLogEvents += 1;
        continue;
      }
      socket.send(serialized);
    }
    return event;
  };
  const deploySudoChallenges = new Map();
  const clearDeploySudoChallenge = (challengeId) => {
    const normalizedId = String(challengeId || '').trim();
    if (!normalizedId) {
      return null;
    }
    const challenge = deploySudoChallenges.get(normalizedId) || null;
    if (!challenge) {
      return null;
    }
    deploySudoChallenges.delete(normalizedId);
    if (challenge.timeout) {
      clearTimeout(challenge.timeout);
    }
    return challenge;
  };
  const resolveDeploySudoChallenge = (challengeId, password) => {
    const challenge = clearDeploySudoChallenge(challengeId);
    if (!challenge) {
      return false;
    }
    challenge.resolve(String(password || ''));
    return true;
  };
  const rejectDeploySudoChallenge = (challengeId, reason) => {
    const challenge = clearDeploySudoChallenge(challengeId);
    if (!challenge) {
      return false;
    }
    challenge.reject(new Error(String(reason || 'Sudo password challenge was cancelled.')));
    return true;
  };
  const requestDeploySudoPassword = ({
    hostId = null,
    hostName = null,
    hostIp = null,
    deploymentAction = 'deployment',
  } = {}) => {
    if (wsClients.size <= 0) {
      throw new Error('Sudo password is required but no frontend websocket clients are connected.');
    }
    const challengeId = `sudo-${Date.now()}-${crypto.randomUUID()}`;
    const timeoutMs = DEPLOY_SUDO_PASSWORD_REQUEST_TIMEOUT_SECONDS * 1000;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        rejectDeploySudoChallenge(challengeId, `Timed out waiting for sudo password (${DEPLOY_SUDO_PASSWORD_REQUEST_TIMEOUT_SECONDS}s).`);
      }, timeoutMs);
      timeout.unref?.();
      deploySudoChallenges.set(challengeId, {
        challengeId,
        timeout,
        resolve,
        reject,
      });
      publishEvent({
        topic: 'deploy.sudo.password.required',
        source: 'node-backend',
        entityId: Number.isInteger(Number(hostId)) ? `host:${Number(hostId)}` : null,
        payload: {
          challengeId,
          requestedAt: new Date().toISOString(),
          timeoutSeconds: DEPLOY_SUDO_PASSWORD_REQUEST_TIMEOUT_SECONDS,
          hostId: Number.isInteger(Number(hostId)) ? Number(hostId) : null,
          hostName: hostName ? String(hostName) : null,
          hostIp: hostIp ? String(hostIp) : null,
          deploymentAction: String(deploymentAction || 'deployment').trim().toLowerCase() || 'deployment',
        },
      });
    });
  };
  const emitRuntimeEvent = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    if (typeof payload.topic === 'string') {
      return publishEvent({
        topic: payload.topic,
        source: payload.source || 'runtime-backend',
        entityId: payload.entityId || null,
        payload: payload.payload || {},
        timestamp: payload.timestamp,
      });
    }
    if (payload.type === 'runtime' && payload.runtime?.projectPath) {
      return publishEvent({
        topic: 'runtime.project.updated',
        source: payload.source || (runtimeBackend.name === 'go-master' ? 'master-agent' : 'node-runtime'),
        entityId: payload.runtime.projectPath,
        payload: payload.runtime,
      });
    }
    if (payload.type === 'overlay-log' && payload.entry && typeof payload.entry === 'object') {
      const overlaySource = String(
        payload.entry.source || payload.entry.serviceName || payload.source || 'system',
      ).trim() || 'system';
      const overlayEntityId = payload.entry.hostId != null
        ? `host:${payload.entry.hostId}`
        : (
          payload.entry.projectPath
            ? `project:${payload.entry.projectPath}`
            : null
        );
      return publishEvent({
        topic: 'log.overlay',
        source: overlaySource,
        entityId: overlayEntityId,
        payload: payload.entry,
      });
    }
    if (payload.type === 'project-log' && payload.entry && typeof payload.entry === 'object') {
      return publishEvent({
        topic: 'project.log.append',
        source: String(payload.entry.source || payload.source || 'runtime').trim() || 'runtime',
        entityId: payload.entry.projectPath ? `project:${payload.entry.projectPath}` : null,
        payload: payload.entry,
        timestamp: payload.entry.timestamp,
      });
    }
    if (payload.type === 'managed-process-log-chunk' && payload.chunk && typeof payload.chunk === 'object') {
      const chunk = payload.chunk;
      return publishEvent({
        topic: 'process.log.append',
        source: String(chunk.packageKey || chunk.processKey || payload.source || 'managed-process').trim() || 'managed-process',
        entityId: chunk.runId ? `process:${chunk.runId}` : null,
        payload: chunk,
        timestamp: chunk.sampledAt || null,
      });
    }
    if (payload.type === 'host' && payload.host && typeof payload.host === 'object') {
      const event = publishEvent({
        topic: 'host.updated',
        source: payload.source || 'master-agent',
        entityId: payload.host.id != null
          ? `host:${payload.host.id}`
          : (payload.host.name || payload.host.ip || null),
        payload: payload.host,
        timestamp: payload.host.lastSeenAt || null,
      });
      Promise.resolve(hostAgentAutoUpgradeController.considerRuntimeHost(payload.host, { trigger: 'runtime-event' }))
        .catch((error) => {
          emitBackendLog({
            message: `Automatic host agent upgrade evaluation failed: ${error.message || error}`,
            stream: 'stderr',
            hostName: payload.host?.name || null,
            hostIp: payload.host?.ip || null,
          });
        });
      return event;
    }
    if (payload.type === 'slave-runtime-state' && payload.runtimeState && typeof payload.runtimeState === 'object') {
      Promise.resolve(processRegistry.applySlaveRuntimeState(payload.runtimeState))
        .catch((error) => {
          emitBackendLog({
            message: `Slave runtime state persistence failed: ${error.message || error}`,
            stream: 'stderr',
          });
        });
      return publishEvent({
        topic: 'runtime.slave.state.updated',
        source: payload.source || 'master-agent',
        entityId: payload.runtimeState.slaveId ? `slave:${payload.runtimeState.slaveId}` : null,
        payload: payload.runtimeState,
        timestamp: payload.runtimeState.updatedAt || null,
      });
    }
    if (payload.type === 'slave-process-reconciliation' && payload.report && typeof payload.report === 'object') {
      Promise.resolve(processRegistry.applyReconciliationReport(payload.report))
        .catch((error) => {
          emitBackendLog({
            message: `Slave reconciliation persistence failed: ${error.message || error}`,
            stream: 'stderr',
          });
        });
      return publishEvent({
        topic: 'runtime.slave.reconciliation',
        source: payload.source || 'master-agent',
        entityId: payload.report.slaveId ? `slave:${payload.report.slaveId}` : null,
        payload: payload.report,
        timestamp: payload.report.updatedAt || null,
      });
    }
    if (payload.type === 'discovery.projects' && Array.isArray(payload.projects)) {
      const event = publishEvent({
        topic: 'discovery.projects.updated',
        source: payload.source || 'master-agent',
        entityId: 'projects',
        payload: {
          scannedAt: payload.scannedAt || new Date().toISOString(),
          projects: payload.projects,
        },
        timestamp: payload.scannedAt,
      });
      discoverProjects(undefined, payload.projects)
        .catch((error) => {
          emitBackendLog({
            message: `Project sync from slave discovery failed: ${error.message || error}`,
            stream: 'stderr',
          });
        });
      return event;
    }
    return null;
  };
  const emitBackendLog = ({
    message,
    stream = 'system',
    hostId = null,
    hostName = null,
    hostIp = null,
  } = {}) => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
      return;
    }

    publishEvent({
      topic: 'log.overlay',
      source: 'node-backend',
      entityId: Number.isInteger(Number(hostId)) ? `host:${Number(hostId)}` : null,
      payload: {
        timestamp: new Date().toISOString(),
        serviceName: 'node-backend',
        source: 'node-backend',
        stream,
        message: normalizedMessage,
        hostId: Number.isInteger(Number(hostId)) ? Number(hostId) : null,
        hostName: hostName ? String(hostName) : null,
        hostIp: hostIp ? String(hostIp) : null,
      },
    });
  };
  const hostDeploymentJobs = new Map();
  const runHostAgentDeployment = async ({
    host,
    currentVersion = 'unknown',
    targetVersion = SLAVE_TARGET_VERSION,
    deploymentAction = 'deployment',
    logRequestedMessage = null,
    duplicateMessage = null,
  } = {}) => {
    const plainHost = host && typeof host.toJSON === 'function' ? host.toJSON() : host;
    const hostId = Number(plainHost?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      throw new Error('A persisted host with a valid id is required for deployment.');
    }

    const existingJob = hostDeploymentJobs.get(hostId);
    if (existingJob) {
      if (duplicateMessage) {
        emitBackendLog({
          hostId,
          hostName: plainHost?.name,
          hostIp: plainHost?.ip,
          message: duplicateMessage,
        });
      }
      return existingJob;
    }

    const hostIp = String(plainHost?.ip || '').trim();
    const hostAgentUuid = String(plainHost?.agentUuid || '').trim().toLowerCase();
    if (!hostIp) {
      throw new Error(`Host ${plainHost?.name || hostId} is missing an IP address.`);
    }
    if (!hostAgentUuid) {
      throw new Error(`Host ${plainHost?.name || hostId} does not have an assigned slave UUID.`);
    }

    const normalizedAction = String(deploymentAction || '').trim().toLowerCase() || 'deployment';
    const requestLabel = normalizedAction === 'upgrade'
      ? 'upgrade'
      : normalizedAction === 'redeploy'
        ? 're-deploy'
        : 'deployment';
    const normalizedCurrentVersion = String(currentVersion || '').trim() || 'unknown';
    const normalizedTargetVersion = String(targetVersion || '').trim() || 'unknown';

    if (logRequestedMessage) {
      emitBackendLog({
        hostId,
        hostName: plainHost?.name,
        hostIp,
        message: logRequestedMessage,
      });
    }

    const job = deploySlaveToHost({
      hostId,
      hostName: plainHost?.name,
      hostIp,
      hostMetadata: plainHost?.metadata,
      hostAgentUuid,
      deploymentAction: normalizedAction,
      emitEvent: emitRuntimeEvent,
      requestSudoPassword: requestDeploySudoPassword,
    }).catch((error) => {
      emitRuntimeEvent({
        type: 'overlay-log',
        entry: {
          timestamp: new Date().toISOString(),
          serviceName: 'node-backend',
          source: 'node-backend',
          stream: 'system',
          message: `${requestLabel[0].toUpperCase()}${requestLabel.slice(1)} attempt failed for ${hostIp}: ${error.message || error}`,
          hostId,
          hostName: plainHost?.name ? String(plainHost.name) : null,
          hostIp,
          currentVersion: normalizedCurrentVersion,
          targetVersion: normalizedTargetVersion,
        },
      });
      throw error;
    }).finally(() => {
      hostDeploymentJobs.delete(hostId);
    });

    hostDeploymentJobs.set(hostId, job);
    return job;
  };
  const hostAgentAutoUpgradeController = createHostAgentAutoUpgradeController({
    targetVersion: SLAVE_TARGET_VERSION,
    enabled: resolveAutoUpgradeEnabled(process.env),
    cooldownMs: resolveAutoUpgradeCooldownMs(process.env),
    findHostRecord: async (runtimeHost) => findHostByRuntimeIdentity(runtimeHost),
    deployHostAgent: ({ host, currentVersion, targetVersion, deploymentAction }) => (
      runHostAgentDeployment({
        host,
        currentVersion,
        targetVersion,
        deploymentAction,
      })
    ),
    emitLog: emitBackendLog,
  });
  const terminalSessionManager = createTerminalSessionManager({ emitEvent: emitRuntimeEvent });

  const getHostForTerminal = async ({ hostId }) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }
    const host = await getHostById(parsedHostId);
    if (!host) {
      throw new Error(`Host not found: ${parsedHostId}`);
    }
    return {
      id: parsedHostId,
      name: String(host?.name || host?.ip || `host-${parsedHostId}`).trim() || `host-${parsedHostId}`,
      ip: String(host?.ip || '').trim(),
    };
  };

  const getTerminalSession = async ({ hostId }) => {
    const host = await getHostForTerminal({ hostId });
    return terminalSessionManager.getSessionForHost({ hostId: host.id });
  };

  const startHostTerminalSession = async ({ hostId }) => {
    const host = await getHostForTerminal({ hostId });
    if (!host.ip) {
      throw new Error(`Host ${host.name} is missing an IP address.`);
    }
    return terminalSessionManager.startSession({
      hostId: host.id,
      hostName: host.name,
      hostIp: host.ip,
    });
  };

  const sendHostTerminalInput = async ({ sessionId, input }) => (
    terminalSessionManager.sendInput({ sessionId, input })
  );

  const closeHostTerminalSession = async ({ sessionId }) => (
    terminalSessionManager.closeSession({ sessionId })
  );

  const normalizeLogQueryStreamRequest = (streamRequest) => {
    const streamId = String(streamRequest?.streamId || '').trim();
    const offset = Number.parseInt(streamRequest?.offset, 10) || 0;
    const limit = Math.max(
      0,
      Math.min(LOG_QUERY_MAX_LIMIT, Number.parseInt(streamRequest?.limit, 10) || 0),
    );
    if (!streamId || limit <= 0) {
      return null;
    }
    return {
      streamId,
      offset,
      limit,
    };
  };

  const resolveRequestedBackendLogLimit = (streamRequests = []) => {
    let requiredLines = 0;
    for (const streamRequest of Array.isArray(streamRequests) ? streamRequests : []) {
      const requestedLimit = Math.max(0, Number.parseInt(streamRequest?.limit, 10) || 0);
      const requestedOffset = Number.parseInt(streamRequest?.offset, 10) || 0;
      if (requestedOffset < 0) {
        // Tail seek: offset=-100 means "start 100 lines from end".
        requiredLines = Math.max(requiredLines, Math.abs(requestedOffset), requestedLimit);
        continue;
      }
      requiredLines = Math.max(requiredLines, requestedOffset + requestedLimit);
    }
    const normalized = Math.max(100, requiredLines || 100);
    return Math.min(LOG_QUERY_MAX_LIMIT, normalized);
  };

  const sortLogEntries = (entries) => (
    (Array.isArray(entries) ? entries.slice() : [])
      .sort((left, right) => {
        const leftTs = toIsoTimestamp(left?.timestamp);
        const rightTs = toIsoTimestamp(right?.timestamp);
        if (leftTs !== rightTs) {
          return leftTs.localeCompare(rightTs);
        }
        return String(left?.id || '').localeCompare(String(right?.id || ''));
      })
  );

  const resolveOverlayLogsForScope = ({
    scope,
    hostId = null,
    hostName = null,
    hostIp = null,
    hostAgentUuid = null,
  } = {}) => {
    const normalizedScope = String(scope || 'runtime').trim().toLowerCase() || 'runtime';
    const normalizedHostName = String(hostName || '').trim().toLowerCase();
    const normalizedHostIp = String(hostIp || '').trim();
    const normalizedHostId = Number.isInteger(Number(hostId)) ? Number(hostId) : null;
    const normalizedHostAgentUuid = String(hostAgentUuid || '').trim().toLowerCase();

    const entries = eventBuffer
      .filter((event) => String(event?.topic || '').trim() === 'log.overlay')
      .map((event) => {
        const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
        return {
          id: String(payload?.id || event?.eventId || '').trim() || `overlay-${event?.seq || 0}`,
          timestamp: toIsoTimestamp(payload?.timestamp || event?.ts),
          serviceName: String(payload?.serviceName || event?.source || 'runtime').trim() || 'runtime',
          source: String(payload?.source || event?.source || 'runtime').trim() || 'runtime',
          stream: String(payload?.stream || 'stdout').trim().toLowerCase() || 'stdout',
          level: payload?.level ? String(payload.level).trim().toLowerCase() : null,
          message: String(payload?.message || ''),
          hostId: Number.isInteger(Number(payload?.hostId)) ? Number(payload.hostId) : null,
          hostName: payload?.hostName ? String(payload.hostName) : null,
          hostIp: payload?.hostIp ? String(payload.hostIp) : null,
          agentUuid: String(payload?.agentUuid || payload?.slaveId || '').trim() || null,
          slaveId: String(payload?.slaveId || payload?.agentUuid || '').trim() || null,
          projectPath: '@overlay',
        };
      });

    if (normalizedScope === 'runtime') {
      return sortLogEntries(entries.filter((entry) => RUNTIME_LOG_SOURCES.has(
        String(entry?.source || entry?.serviceName || '').trim().toLowerCase(),
      )));
    }

    if (normalizedScope === 'host') {
      return sortLogEntries(entries.filter((entry) => {
        const entryHostId = Number.isInteger(Number(entry?.hostId)) ? Number(entry.hostId) : null;
        const entryHostName = String(entry?.hostName || '').trim().toLowerCase();
        const entryHostIp = String(entry?.hostIp || '').trim();
        const entryHostAgentUuid = String(entry?.agentUuid || entry?.slaveId || '').trim().toLowerCase();
        if (normalizedHostId != null && entryHostId != null && entryHostId === normalizedHostId) {
          return true;
        }
        if (
          normalizedHostAgentUuid &&
          entryHostAgentUuid &&
          entryHostAgentUuid === normalizedHostAgentUuid
        ) {
          return true;
        }
        if (normalizedHostName && entryHostName && entryHostName === normalizedHostName) {
          return true;
        }
        if (normalizedHostIp && entryHostIp && entryHostIp === normalizedHostIp) {
          return true;
        }
        return false;
      }));
    }

    if (normalizedScope === 'master') {
      return sortLogEntries(entries.filter((entry) => MASTER_LOG_SOURCES.has(
        String(entry?.source || entry?.serviceName || '').trim().toLowerCase(),
      )));
    }

    return sortLogEntries(entries);
  };

  const resolveSlaveLogsForScope = async ({
    hostAgentUuid = null,
    hostId = null,
    hostName = null,
    hostIp = null,
    requestedLimit = LOG_QUERY_MAX_LIMIT,
  } = {}) => {
    const normalizedHostAgentUuid = String(hostAgentUuid || '').trim();
    if (!normalizedHostAgentUuid || typeof runtimeBackend.getSlaveLogs !== 'function') {
      return resolveOverlayLogsForScope({
        scope: 'host',
        hostId,
        hostName,
        hostIp,
        hostAgentUuid: normalizedHostAgentUuid,
      });
    }

    const records = await runtimeBackend.getSlaveLogs({
      slaveId: normalizedHostAgentUuid,
      limit: requestedLimit,
      afterId: null,
      serviceNames: null,
    });
    return sortLogEntries((Array.isArray(records) ? records : []).map((record, index) => ({
      id: String(record?.id || `host-log-${index}`),
      timestamp: toIsoTimestamp(record?.timestamp),
      serviceName: String(record?.serviceName || 'agent-slave').trim() || 'agent-slave',
      source: String(record?.source || 'agent-slave').trim() || 'agent-slave',
      stream: String(record?.stream || 'stdout').trim().toLowerCase() || 'stdout',
      level: record?.level ? String(record.level).trim().toLowerCase() : null,
      message: String(record?.message || ''),
      hostId: Number.isInteger(Number(record?.hostId))
        ? Number(record.hostId)
        : (Number.isInteger(Number(hostId)) ? Number(hostId) : null),
      hostName: String(record?.hostName || hostName || '').trim() || null,
      hostIp: String(record?.hostIp || hostIp || '').trim() || null,
      agentUuid: String(record?.agentUuid || record?.slaveId || normalizedHostAgentUuid).trim() || null,
      slaveId: String(record?.slaveId || record?.agentUuid || normalizedHostAgentUuid).trim() || null,
      projectPath: String(record?.projectPath || `@slave:${normalizedHostAgentUuid}`),
    })));
  };

  const resolveProjectLogsForScope = async ({
    projectPath,
    requestedLimit = LOG_QUERY_MAX_LIMIT,
  } = {}) => {
    const normalizedProjectPath = String(projectPath || '').trim();
    if (!normalizedProjectPath) {
      return [];
    }

    const records = await runtimeBackend.getProjectLogs({
      projectPath: normalizedProjectPath,
      limit: requestedLimit,
      afterId: null,
      serviceNames: null,
    });
    return sortLogEntries((Array.isArray(records) ? records : []).map((record, index) => ({
      id: String(record?.id || `project-log-${index}`),
      timestamp: toIsoTimestamp(record?.timestamp),
      serviceName: String(record?.serviceName || 'project').trim() || 'project',
      source: String(record?.source || 'project').trim() || 'project',
      stream: String(record?.stream || 'stdout').trim().toLowerCase() || 'stdout',
      level: record?.level ? String(record.level).trim().toLowerCase() : null,
      message: String(record?.message || ''),
      hostId: Number.isInteger(Number(record?.hostId)) ? Number(record.hostId) : null,
      hostName: record?.hostName ? String(record.hostName) : null,
      hostIp: record?.hostIp ? String(record.hostIp) : null,
      projectPath: normalizedProjectPath,
    })));
  };

  const resolveManagedProcessLogsForScope = async ({
    hostAgentUuid = null,
    hostId = null,
    hostName = null,
    hostIp = null,
    runId = null,
    requestedLimit = LOG_QUERY_MAX_LIMIT,
  } = {}) => {
    const normalizedHostAgentUuid = String(hostAgentUuid || '').trim();
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedHostAgentUuid || !normalizedRunId || typeof runtimeBackend.getManagedProcessLogs !== 'function') {
      return [];
    }

    const records = await runtimeBackend.getManagedProcessLogs({
      slaveId: normalizedHostAgentUuid,
      runId: normalizedRunId,
      limit: requestedLimit,
      afterId: null,
      serviceNames: null,
    });
    return sortLogEntries((Array.isArray(records) ? records : []).map((record, index) => ({
      id: String(record?.id || `process-log-${index}`),
      timestamp: toIsoTimestamp(record?.timestamp),
      serviceName: String(record?.serviceName || record?.processKey || 'managed-process').trim() || 'managed-process',
      source: String(record?.source || record?.serviceName || 'managed-process').trim() || 'managed-process',
      stream: String(record?.stream || 'stdout').trim().toLowerCase() || 'stdout',
      level: record?.level ? String(record.level).trim().toLowerCase() : null,
      message: String(record?.message || ''),
      hostId: Number.isInteger(Number(record?.hostId))
        ? Number(record.hostId)
        : (Number.isInteger(Number(hostId)) ? Number(hostId) : null),
      hostName: String(record?.hostName || hostName || '').trim() || null,
      hostIp: String(record?.hostIp || hostIp || '').trim() || null,
      agentUuid: String(record?.agentUuid || record?.slaveId || normalizedHostAgentUuid).trim() || null,
      slaveId: String(record?.slaveId || record?.agentUuid || normalizedHostAgentUuid).trim() || null,
      runId: normalizedRunId,
      projectPath: String(record?.projectPath || `@process:${normalizedHostAgentUuid}:${normalizedRunId}`),
    })));
  };

  const resolveLogsForQueryContext = async (context = {}, streamRequests = []) => {
    const scope = String(context?.scope || 'runtime').trim().toLowerCase() || 'runtime';
    const requestedLimit = resolveRequestedBackendLogLimit(streamRequests);
    if (scope === 'project') {
      return resolveProjectLogsForScope({
        projectPath: context?.projectPath,
        requestedLimit,
      });
    }
    if (scope === 'host') {
      return resolveSlaveLogsForScope({
        hostAgentUuid: context?.hostAgentUuid || context?.agentUuid || context?.slaveId,
        hostId: context?.hostId,
        hostName: context?.hostName,
        hostIp: context?.hostIp,
        requestedLimit,
      });
    }
    if (scope === 'process') {
      return resolveManagedProcessLogsForScope({
        hostAgentUuid: context?.hostAgentUuid || context?.agentUuid || context?.slaveId,
        hostId: context?.hostId,
        hostName: context?.hostName,
        hostIp: context?.hostIp,
        runId: context?.runId,
        requestedLimit,
      });
    }
    return resolveOverlayLogsForScope({
      scope,
      hostId: context?.hostId,
      hostName: context?.hostName,
      hostIp: context?.hostIp,
      hostAgentUuid: context?.hostAgentUuid || context?.agentUuid || context?.slaveId,
    });
  };

  const streamSliceFromEntries = ({ entries, streamId, offset, limit }) => {
    const normalizedStreamId = String(streamId || '').trim();
    const sourceEntries = normalizedStreamId === 'merged'
      ? entries
      : entries.filter((entry) => String(entry?.serviceName || '').trim() === normalizedStreamId);
    const totalLines = sourceEntries.length;
    const parsedOffset = Number.parseInt(offset, 10) || 0;
    const tailAwareOffset = parsedOffset < 0
      ? (totalLines + parsedOffset)
      : parsedOffset;
    const safeOffset = Math.max(0, Math.min(totalLines, tailAwareOffset));
    const safeLimit = Math.max(0, Math.min(LOG_QUERY_MAX_LIMIT, Number.parseInt(limit, 10) || 0));
    return {
      streamId: normalizedStreamId,
      totalLines,
      offset: safeOffset,
      lines: sourceEntries.slice(safeOffset, safeOffset + safeLimit),
    };
  };

  const sendLogsQueryResult = (socket, payload) => {
    if (!socket || socket.readyState !== 1) {
      return;
    }
    socket.send(JSON.stringify(payload));
  };

  const handleLogsQueryMessage = async (socket, message) => {
    const requestId = String(message?.requestId || '').trim();
    if (!requestId) {
      sendLogsQueryResult(socket, {
        kind: 'logs.query.error',
        error: 'requestId is required.',
      });
      return;
    }

    const streamRequests = (Array.isArray(message?.streams) ? message.streams : [])
      .map((streamRequest) => normalizeLogQueryStreamRequest(streamRequest))
      .filter(Boolean);
    if (streamRequests.length === 0) {
      sendLogsQueryResult(socket, {
        kind: 'logs.query.error',
        requestId,
        error: 'At least one valid stream request is required.',
      });
      return;
    }

    const context = message?.context && typeof message.context === 'object'
      ? message.context
      : {};
    const contextKey = context?.contextKey ? String(context.contextKey) : null;
    const scope = String(context?.scope || 'runtime').trim().toLowerCase() || 'runtime';
    try {
      const baseEntries = await resolveLogsForQueryContext(context, streamRequests);
      const streams = streamRequests.map((streamRequest) => (
        streamSliceFromEntries({
          entries: baseEntries,
          streamId: streamRequest.streamId,
          offset: streamRequest.offset,
          limit: streamRequest.limit,
        })
      ));

      sendLogsQueryResult(socket, {
        kind: 'logs.query.result',
        protocolVersion: EVENT_PROTOCOL_VERSION,
        requestId,
        contextKey,
        scope,
        serverTime: new Date().toISOString(),
        streams,
      });
    } catch (error) {
      sendLogsQueryResult(socket, {
        kind: 'logs.query.error',
        requestId,
        contextKey,
        scope,
        error: String(error?.message || error || 'Unknown logs.query error'),
      });
    }
  };

  try {
    const persistedCustomProjectPaths = await listCustomProjectPaths();
    for (const customProjectPath of persistedCustomProjectPaths) {
      customProjectPaths.add(path.resolve(customProjectPath));
    }
  } catch (error) {
    console.warn('Failed to load custom project paths from the database:', error);
  }

  const createCustomPathDiscoveryEntry = (projectPathInput) => {
    const normalizedPath = path.resolve(String(projectPathInput || '').trim());
    return {
      name: path.basename(normalizedPath) || normalizedPath,
      path: normalizedPath,
      relativePath: '.',
      types: ['custom-path'],
      services: ['main'],
      declaredServices: [],
      hasMakefile: false,
      customPath: true,
      hostId: null,
      hostName: null,
      hostIp: null,
      hostAgentUuid: null,
    };
  };

  const normalizeRuntimeDiscoveredProject = (project) => {
    const normalizedPath = String(project?.path || '').trim();
    if (!normalizedPath) {
      return null;
    }
    const absolutePath = path.resolve(normalizedPath);
    const types = Array.isArray(project?.types)
      ? Array.from(new Set(project.types.map((value) => String(value || '').trim()).filter(Boolean)))
      : [];
    const services = Array.isArray(project?.services)
      ? Array.from(new Set(project.services.map((value) => String(value || '').trim()).filter(Boolean)))
      : [];

    return {
      name: String(project?.name || path.basename(absolutePath) || absolutePath).trim(),
      path: absolutePath,
      relativePath: String(project?.relativePath || '.').trim() || '.',
      types,
      services: services.length > 0 ? services : ['main'],
      declaredServices: [],
      hasMakefile: Boolean(project?.hasMakefile),
      hostName: String(project?.hostName || '').trim() || null,
      hostIp: String(project?.hostIp || '').trim() || null,
      hostAgentUuid: String(project?.slaveId || project?.hostAgentUuid || '').trim().toLowerCase() || null,
      customPath: Boolean(project?.customPath),
    };
  };

  const resolveDiscoveredProjectHostMetadata = async (projectsInput) => {
    const projects = Array.isArray(projectsInput) ? projectsInput : [];
    const persistedHosts = await listHostsWithProjects();
    const hostByAgentUuid = new Map();
    const hostByName = new Map();
    const hostByIp = new Map();
    for (const host of persistedHosts) {
      const plain = typeof host?.toJSON === 'function' ? host.toJSON() : host;
      const hostId = Number(plain?.id);
      if (!Number.isInteger(hostId) || hostId <= 0) {
        continue;
      }
      const agentUuid = String(plain?.agentUuid || '').trim().toLowerCase();
      const hostName = String(plain?.name || '').trim();
      const hostIp = String(plain?.ip || '').trim();
      if (agentUuid && !hostByAgentUuid.has(agentUuid)) {
        hostByAgentUuid.set(agentUuid, plain);
      }
      if (hostName && !hostByName.has(hostName)) {
        hostByName.set(hostName, plain);
      }
      if (hostIp && !hostByIp.has(hostIp)) {
        hostByIp.set(hostIp, plain);
      }
    }

    const merged = [];
    const seen = new Set();
    for (const project of projects) {
      const normalized = normalizeRuntimeDiscoveredProject(project);
      if (!normalized) {
        continue;
      }
      const resolvedHost = (
        (normalized.hostAgentUuid ? hostByAgentUuid.get(normalized.hostAgentUuid) : null)
        || (normalized.hostName ? hostByName.get(normalized.hostName) : null)
        || (normalized.hostIp ? hostByIp.get(normalized.hostIp) : null)
        || null
      );
      const resolvedHostId = Number(resolvedHost?.id);
      const hostId = Number.isInteger(resolvedHostId) && resolvedHostId > 0 ? resolvedHostId : null;
      const hostName = normalized.hostName || String(resolvedHost?.name || '').trim() || null;
      const hostIp = normalized.hostIp || String(resolvedHost?.ip || '').trim() || null;
      const hostAgentUuid = normalized.hostAgentUuid || String(resolvedHost?.agentUuid || '').trim().toLowerCase() || null;
      const dedupeKey = `${(hostAgentUuid || 'none').toLowerCase()}::${normalized.path.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      merged.push({
        ...normalized,
        hostId,
        hostName,
        hostIp,
        hostAgentUuid,
      });
    }
    return merged;
  };

  const discoverProjects = async (_config, runtimeProjectsOverride = null) => {
    let runtimeProjects = [];
    if (Array.isArray(runtimeProjectsOverride)) {
      runtimeProjects = runtimeProjectsOverride;
    } else if (typeof runtimeBackend.listDiscoveredProjects === 'function') {
      runtimeProjects = await runtimeBackend.listDiscoveredProjects();
    }
    if (typeof runtimeBackend.listRegisteredHosts === 'function') {
      try {
        const runtimeHosts = await runtimeBackend.listRegisteredHosts();
        await syncRegisteredHosts(Array.isArray(runtimeHosts) ? runtimeHosts : []);
        await Promise.allSettled(
          (Array.isArray(runtimeHosts) ? runtimeHosts : [])
            .map((runtimeHost) => hostAgentAutoUpgradeController.considerRuntimeHost(runtimeHost, { trigger: 'discovery-sync' })),
        );
      } catch (hostSyncError) {
        console.warn(`Unable to sync hosts during project discovery: ${hostSyncError?.message || hostSyncError}`);
      }
    }

    const mergedRawProjects = Array.isArray(runtimeProjects) ? runtimeProjects.slice() : [];
    const seenPaths = new Set(
      mergedRawProjects
        .map((project) => String(project?.path || '').trim())
        .filter(Boolean)
        .map((projectPath) => path.resolve(projectPath)),
    );

    for (const customProjectPath of customProjectPaths) {
      const normalizedCustomPath = path.resolve(customProjectPath);
      if (seenPaths.has(normalizedCustomPath)) {
        continue;
      }
      mergedRawProjects.push(createCustomPathDiscoveryEntry(normalizedCustomPath));
      seenPaths.add(normalizedCustomPath);
    }

    const mergedProjects = await resolveDiscoveredProjectHostMetadata(mergedRawProjects);
    mergedProjects.sort((a, b) => String(a?.path || '').localeCompare(String(b?.path || '')));

    const mergedDiscovery = {
      rootPath: 'slave-reported',
      folderPattern: '.*',
      maxDepth: 0,
      scannedAt: new Date().toISOString(),
      projects: mergedProjects,
    };

    await syncDiscoveredProjects(mergedDiscovery);
    return mergedDiscovery;
  };
  const addCustomProjectPath = async (projectPathInput) => {
    const trimmedProjectPath = String(projectPathInput || '').trim();
    if (!trimmedProjectPath) {
      throw new Error('projectPath must be a non-empty string');
    }
    const normalizedProjectPath = path.resolve(trimmedProjectPath);
    customProjectPaths.add(normalizedProjectPath);
    return discoverProjects();
  };
  const listHosts = async () => {
    let registeredHosts = [];
    try {
      if (typeof runtimeBackend.listRegisteredHosts === 'function') {
        registeredHosts = await runtimeBackend.listRegisteredHosts();
      }
      await syncRegisteredHosts(registeredHosts);
      await Promise.allSettled(
        (Array.isArray(registeredHosts) ? registeredHosts : [])
          .map((runtimeHost) => hostAgentAutoUpgradeController.considerRuntimeHost(runtimeHost, { trigger: 'list-hosts' })),
      );
    } catch (error) {
      console.warn('Failed to sync registered hosts from runtime backend:', error);
      emitBackendLog({
        message: `Host sync failed: ${error.message || error}`,
        stream: 'stderr',
      });
    }

    const persistedHosts = await listHostsWithProjects();
    const runtimeBySlaveId = new Map();
    const runtimeByName = new Map();
    const runtimeByIp = new Map();
    for (const runtimeHost of registeredHosts) {
      const slaveId = String(runtimeHost?.slaveId || '').trim().toLowerCase();
      const name = String(runtimeHost?.name || runtimeHost?.hostName || '').trim();
      const ip = String(runtimeHost?.ip || '').trim();
      if (slaveId) {
        runtimeBySlaveId.set(slaveId, runtimeHost);
      }
      if (name) {
        runtimeByName.set(name, runtimeHost);
      }
      if (ip) {
        runtimeByIp.set(ip, runtimeHost);
      }
    }

    const nowMs = Date.now();
    return persistedHosts.map((host) => {
      const plain = typeof host?.toJSON === 'function' ? host.toJSON() : host;
      const persistedSlaveId = String(plain?.agentUuid || '').trim().toLowerCase();
      const runtimeHost = (
        (persistedSlaveId ? runtimeBySlaveId.get(persistedSlaveId) : null)
        || runtimeByName.get(plain?.name)
        || runtimeByIp.get(plain?.ip)
        || null
      );
      const source = String(plain?.source || 'runtime').trim().toLowerCase();
      const runtimeStatus = String(runtimeHost?.status || '').trim().toLowerCase();
      const runtimeHealth = String(runtimeHost?.health || '').trim().toLowerCase();
      const runtimeError = String(runtimeHost?.error || '').trim();
      const lastSeenAt = runtimeHost?.lastSeenAt || runtimeHost?.registeredAt || null;
      let status = 'unknown';
      let health = 'unknown';
      let error = null;
      let online = false;

      if (runtimeHost) {
        status = runtimeStatus || 'registered';
        error = runtimeError || null;
        online = (
          typeof runtimeHost?.online === 'boolean'
            ? runtimeHost.online
            : status === 'registered'
        );

        if (runtimeHealth) {
          health = runtimeHealth;
        } else {
          const parsedLastSeenMs = lastSeenAt ? Date.parse(String(lastSeenAt)) : NaN;
          const ageMs = Number.isFinite(parsedLastSeenMs) ? (nowMs - parsedLastSeenMs) : Number.POSITIVE_INFINITY;
          if (status === 'registered' && ageMs <= 30000) {
            health = 'healthy';
          } else if (status === 'registered') {
            health = 'warning';
          } else if (status === 'drained') {
            health = 'warning';
          } else {
            health = 'critical';
          }
        }

        if (!error && status === 'disconnected') {
          error = 'Slave heartbeat timed out; master has not received recent health checks.';
        }
      } else if (source === 'manual') {
        status = 'unregistered';
        health = 'warning';
        error = 'Slave not registered with master yet.';
      } else {
        status = 'offline';
        health = 'critical';
        error = 'Runtime host is missing from the master registry.';
      }

      const persistedProjects = Array.isArray(plain?.projects)
        ? plain.projects
          .map((project) => ({
            id: Number.isInteger(Number(project?.id)) ? Number(project.id) : null,
            name: String(project?.name || '').trim(),
            path: String(project?.metadata?.path || project?.path || '').trim() || null,
          }))
          .filter((project) => project.name || project.path)
        : [];
      const runtimeProjects = Array.isArray(runtimeHost?.discoveredProjects)
        ? runtimeHost.discoveredProjects
          .map((project) => ({
            id: null,
            name: String(project?.name || '').trim(),
            path: String(project?.path || '').trim() || null,
          }))
          .filter((project) => project.name || project.path)
        : [];
      const projectsByKey = new Map();
      for (const project of [...persistedProjects, ...runtimeProjects]) {
        const key = project.path
          ? `path:${project.path.toLowerCase()}`
          : `name:${String(project.name || '').toLowerCase()}`;
        if (!key || projectsByKey.has(key)) {
          continue;
        }
        projectsByKey.set(key, project);
      }
      const mergedProjects = Array.from(projectsByKey.values()).sort((left, right) => (
        String(left?.name || left?.path || '').localeCompare(String(right?.name || right?.path || ''))
      ));
      const normalizedHostIp = String(plain?.ip || '').trim();
      const targetSocket = isLoopbackHostTarget(normalizedHostIp)
        ? resolveLocalSlaveSocketTarget()
        : null;

      return {
        ...plain,
        directories: getHostDirectoriesFromMetadata(plain?.metadata),
        projects: mergedProjects,
        projectCount: mergedProjects.length,
        targetSocket,
        version: String(runtimeHost?.version || plain?.version || '').trim() || null,
        protocolVersion: String(
          runtimeHost?.protocolVersion || runtimeHost?.protocol || plain?.protocolVersion || '',
        ).trim() || null,
        status,
        health,
        error,
        lastSeenAt,
        online,
      };
    });
  };
  const addHost = async (ip) => {
    const host = await addManualHost(ip);
    emitBackendLog({
      message: `Manual host added: ${host?.name || host?.ip || ip} (agent_uuid=${host?.agentUuid || 'n/a'})`,
      hostId: host?.id,
      hostName: host?.name,
      hostIp: host?.ip || ip,
    });
    void runHostAgentDeployment({
      host,
      deploymentAction: 'deployment',
    });
    return host;
  };
  const deleteHost = async (hostId) => {
    const deleted = await deleteHostById(hostId);
    emitBackendLog({
      message: deleted
        ? `Host deleted: ${hostId}`
        : `Delete host skipped (not found): ${hostId}`,
    });
    return deleted;
  };
  const addHostDirectory = async ({ hostId, directoryPath }) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }
    const normalizedDirectoryPath = normalizeHostDirectoryPath(directoryPath);
    const host = await getHostById(parsedHostId);
    if (!host) {
      throw new Error(`Host not found: ${parsedHostId}`);
    }

    const hostIp = String(host?.ip || '').trim();
    if (!hostIp) {
      throw new Error(`Host ${host?.name || parsedHostId} is missing an IP address.`);
    }

    await createRemoteHostDirectory({
      hostId: parsedHostId,
      hostName: host?.name,
      hostIp,
      hostMetadata: host?.metadata,
      directoryPath: normalizedDirectoryPath,
      emitEvent: emitRuntimeEvent,
    });

    await addHostDirectoryInCatalog({
      hostId: parsedHostId,
      directoryPath: normalizedDirectoryPath,
    });

    emitBackendLog({
      hostId: parsedHostId,
      hostName: host?.name,
      hostIp,
      message: `Host directory ensured: ${normalizedDirectoryPath}`,
    });

    const hosts = await listHosts();
    const updatedHost = hosts.find((entry) => Number(entry?.id) === parsedHostId) || null;
    if (!updatedHost) {
      throw new Error(`Host not found after adding directory: ${parsedHostId}`);
    }
    emitRuntimeEvent({
      type: 'host',
      source: 'node-backend',
      host: updatedHost,
    });
    return updatedHost;
  };
  const removeHostDirectory = async ({ hostId, directoryPath }) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }
    const normalizedDirectoryPath = normalizeHostDirectoryPath(directoryPath);
    const host = await getHostById(parsedHostId);
    if (!host) {
      throw new Error(`Host not found: ${parsedHostId}`);
    }

    const hostIp = String(host?.ip || '').trim();
    if (!hostIp) {
      throw new Error(`Host ${host?.name || parsedHostId} is missing an IP address.`);
    }

    await removeRemoteHostDirectory({
      hostId: parsedHostId,
      hostName: host?.name,
      hostIp,
      hostMetadata: host?.metadata,
      directoryPath: normalizedDirectoryPath,
      emitEvent: emitRuntimeEvent,
    });

    await removeHostDirectoryInCatalog({
      hostId: parsedHostId,
      directoryPath: normalizedDirectoryPath,
    });

    emitBackendLog({
      hostId: parsedHostId,
      hostName: host?.name,
      hostIp,
      message: `Host directory removed: ${normalizedDirectoryPath}`,
    });

    const hosts = await listHosts();
    const updatedHost = hosts.find((entry) => Number(entry?.id) === parsedHostId) || null;
    if (!updatedHost) {
      throw new Error(`Host not found after removing directory: ${parsedHostId}`);
    }
    emitRuntimeEvent({
      type: 'host',
      source: 'node-backend',
      host: updatedHost,
    });
    return updatedHost;
  };
  const checkoutHostProject = async ({
    hostId,
    repositoryUrl,
    baseDirectory,
    destinationFolder,
  }) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }
    const normalizedRepositoryUrl = String(repositoryUrl || '').trim();
    if (!normalizedRepositoryUrl) {
      throw new Error('repositoryUrl is required');
    }
    const normalizedBaseDirectory = normalizeHostDirectoryPath(baseDirectory);
    const normalizedDestinationFolder = String(destinationFolder || '').trim();
    if (!normalizedDestinationFolder) {
      throw new Error('destinationFolder is required');
    }
    if (
      normalizedDestinationFolder.includes('/')
      || normalizedDestinationFolder.includes('\\')
      || normalizedDestinationFolder === '.'
      || normalizedDestinationFolder === '..'
    ) {
      throw new Error('destinationFolder must be a single folder name.');
    }

    const host = await getHostById(parsedHostId);
    if (!host) {
      throw new Error(`Host not found: ${parsedHostId}`);
    }

    if (!String(host?.agentUuid || '').trim().toLowerCase()) {
      throw new Error(`Host ${host?.name || parsedHostId} does not have an assigned slave UUID.`);
    }
    if (typeof runtimeBackend.checkoutHostProject !== 'function') {
      throw new Error('Runtime backend does not support host checkout operations.');
    }

    const checkoutResult = await runtimeBackend.checkoutHostProject({
      slaveId: hostAgentUuid,
      repositoryUrl: normalizedRepositoryUrl,
      baseDirectory: normalizedBaseDirectory,
      destinationFolder: normalizedDestinationFolder,
    });

    const targetPath = path.posix.join(
      normalizedBaseDirectory.replace(/\\/g, '/'),
      normalizedDestinationFolder,
    );
    emitBackendLog({
      hostId: parsedHostId,
      hostName: host?.name,
      hostIp: host?.ip,
      message: `Checkout queued on host ${host?.name || host?.ip || parsedHostId}: ${normalizedRepositoryUrl} -> ${targetPath} (command_id=${checkoutResult?.commandId || 'n/a'})`,
    });

    const hosts = await listHosts();
    const updatedHost = hosts.find((entry) => Number(entry?.id) === parsedHostId) || null;
    if (updatedHost) {
      emitRuntimeEvent({
        type: 'host',
        source: 'node-backend',
        host: updatedHost,
      });
    }

    return {
      host: updatedHost || host,
      commandId: String(checkoutResult?.commandId || '').trim() || '',
      status: String(checkoutResult?.status || 'queued').trim().toLowerCase() || 'queued',
      message: checkoutResult?.message ? String(checkoutResult.message) : null,
    };
  };
  const upgradeHostAgent = async ({ hostId }) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }

    const host = await getHostById(parsedHostId);
    if (!host) {
      throw new Error(`Host not found: ${parsedHostId}`);
    }

    const hostIp = String(host?.ip || '').trim();
    if (!hostIp) {
      throw new Error(`Host ${host?.name || parsedHostId} is missing an IP address.`);
    }

    const hostAgentUuid = String(host?.agentUuid || '').trim().toLowerCase();
    if (!hostAgentUuid) {
      throw new Error(`Host ${host?.name || parsedHostId} does not have an assigned slave UUID.`);
    }

    const hosts = await listHosts();
    const currentHostState = hosts.find((entry) => Number(entry?.id) === parsedHostId) || null;
    const currentVersion = String(currentHostState?.version || '').trim() || 'unknown';
    const targetVersion = String(SLAVE_TARGET_VERSION || '').trim() || 'unknown';
    const outOfDate = isHostVersionOutOfDate(currentVersion, targetVersion);
    const deploymentAction = outOfDate ? 'upgrade' : 'redeploy';
    const requestLabel = outOfDate ? 'upgrade' : 're-deploy';
    void runHostAgentDeployment({
      host,
      currentVersion,
      targetVersion,
      deploymentAction,
      logRequestedMessage: `Slave ${requestLabel} requested for ${host?.name || hostIp} (${currentVersion} -> ${targetVersion}).`,
    });

    return currentHostState || host;
  };

  try {
    const initialDiscovery = await discoverProjects(discoveryConfig);
    console.log(`Initial project sync complete (${initialDiscovery.projects.length} projects).`);
  } catch (error) {
    const transientStartupError = isTransientMasterStartupError(error);
    if (isTransientMasterStartupError(error)) {
      console.log(`Initial project sync deferred until master/slave discovery is ready: ${error?.message || error}`);
    } else {
      console.warn('Initial project sync skipped (waiting for master/slave discovery):', error);
    }
    emitBackendLog({
      message: `Initial project sync skipped: ${error.message || error}`,
      stream: transientStartupError ? 'stdout' : 'stderr',
    });
  }

  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers: createResolvers({
      discoveryConfig,
      validateAndNormalizeConfig,
      discoverProjects,
      addCustomProjectPath,
      listHosts,
      addHost,
      deleteHost,
      addHostDirectory,
      removeHostDirectory,
      checkoutHostProject,
      upgradeHostAgent,
      getTerminalSession,
      startHostTerminalSession,
      sendHostTerminalInput,
      closeHostTerminalSession,
      processRegistry,
      runtimeBackend,
      serverVersion: SERVER_VERSION,
      serverProtocolVersion: EVENT_PROTOCOL_VERSION,
      serverSlaveTargetVersion: SLAVE_TARGET_VERSION,
    }),
  });

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  await apolloServer.start();

  const wsHeartbeatTimer = setInterval(() => {
    for (const socket of wsClients) {
      const state = wsClientState.get(socket);
      if (!state) {
        continue;
      }
      if (!state.isAlive) {
        socket.terminate();
        continue;
      }
      state.isAlive = false;
      socket.ping();
    }
  }, WS_PING_INTERVAL_MS);
  wsHeartbeatTimer.unref?.();

  wsServer.on('connection', (socket, request) => {
    wsClients.add(socket);
    wsClientState.set(socket, {
      subscribed: false,
      topics: new Set(),
      isAlive: true,
      droppedLogEvents: 0,
      lastEventId: null,
    });

    socket.send(JSON.stringify({
      kind: 'hello',
      protocolVersion: EVENT_PROTOCOL_VERSION,
      serverTime: new Date().toISOString(),
      wsPath: '/ws',
    }));

    socket.on('pong', () => {
      const state = wsClientState.get(socket);
      if (!state) {
        return;
      }
      state.isAlive = true;
    });

    socket.on('message', (rawData) => {
      let message = null;
      try {
        message = JSON.parse(String(rawData || ''));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.action === 'ping') {
        socket.send(JSON.stringify({
          kind: 'pong',
          serverTime: new Date().toISOString(),
        }));
        return;
      }

      if (message.action === 'logs.query') {
        handleLogsQueryMessage(socket, message);
        return;
      }

      if (message.action === 'deploy.sudo.password.submit') {
        const challengeId = String(message?.challengeId || '').trim();
        const password = String(message?.password || '');
        if (!challengeId) {
          socket.send(JSON.stringify({
            kind: 'deploy.sudo.password.error',
            error: 'challengeId is required.',
          }));
          return;
        }
        if (!password) {
          socket.send(JSON.stringify({
            kind: 'deploy.sudo.password.error',
            challengeId,
            error: 'password is required.',
          }));
          return;
        }
        const accepted = resolveDeploySudoChallenge(challengeId, password);
        socket.send(JSON.stringify({
          kind: accepted ? 'deploy.sudo.password.accepted' : 'deploy.sudo.password.error',
          challengeId,
          ...(accepted ? {} : { error: 'challenge is missing or expired.' }),
        }));
        return;
      }

      if (message.action === 'deploy.sudo.password.cancel') {
        const challengeId = String(message?.challengeId || '').trim();
        if (!challengeId) {
          socket.send(JSON.stringify({
            kind: 'deploy.sudo.password.error',
            error: 'challengeId is required.',
          }));
          return;
        }
        const cancelled = rejectDeploySudoChallenge(
          challengeId,
          'Sudo password prompt cancelled from frontend.',
        );
        socket.send(JSON.stringify({
          kind: cancelled ? 'deploy.sudo.password.cancelled' : 'deploy.sudo.password.error',
          challengeId,
          ...(cancelled ? {} : { error: 'challenge is missing or expired.' }),
        }));
        return;
      }

      if (message.action === 'subscribe') {
        const state = wsClientState.get(socket);
        if (!state) {
          return;
        }
        state.subscribed = true;
        state.topics = normalizeTopicFilter(message.topics);
        state.isAlive = true;
        state.lastEventId = String(message.lastEventId || '').trim() || null;

        socket.send(JSON.stringify({
          kind: 'subscribed',
          protocolVersion: EVENT_PROTOCOL_VERSION,
          serverTime: new Date().toISOString(),
          topics: Array.from(state.topics),
          requestOrigin: request?.headers?.origin || null,
        }));
        replayEventsToSocket(socket, { lastEventId: state.lastEventId });
      }
    });

    socket.on('close', () => {
      wsClients.delete(socket);
      wsClientState.delete(socket);
    });
  });

  runtimeBackend.setRuntimeEventSink?.(emitRuntimeEvent);
  runtimeBackend.start?.();
  Promise.resolve()
    .then(async () => {
      if (typeof runtimeBackend.listRegisteredHosts !== 'function') {
        return;
      }
      const registeredHosts = await runtimeBackend.listRegisteredHosts();
      const slaveIds = Array.isArray(registeredHosts)
        ? registeredHosts
          .map((host) => String(host?.slaveId || '').trim().toLowerCase())
          .filter(Boolean)
        : [];
      for (const slaveId of slaveIds) {
        // Bootstrap persisted runtime state for already-connected slaves.
        // Event streams do not replay historical heartbeats on backend startup.
        // eslint-disable-next-line no-await-in-loop
        await processRegistry.refreshSlaveRuntimeStateFromRuntimeBackend({ slaveId });
      }
    })
    .catch((error) => {
      emitBackendLog({
        message: `Runtime registry bootstrap failed: ${error.message || error}`,
        stream: 'stderr',
      });
    });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    '/graphql',
    cors({ origin: true, credentials: true }),
    express.json(),
    expressMiddleware(apolloServer),
  );

  app.get('/api/discovery/config', (req, res) => {
    res.json({ config: discoveryConfig });
  });

  app.put('/api/discovery/config', async (req, res) => {
    try {
      const normalized = await validateAndNormalizeConfig(req.body || {});
      discoveryConfig.projectPath = normalized.projectPath;
      discoveryConfig.folderPattern = normalized.folderPattern;
      discoveryConfig.maxDepth = normalized.maxDepth;
      res.json({ config: discoveryConfig });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Invalid configuration' });
    }
  });

  app.get('/api/discovery/projects', async (req, res) => {
    try {
      const result = await discoverProjects(discoveryConfig);
      res.json({
        config: discoveryConfig,
        ...result,
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Project scan failed' });
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`Discovery server listening on http://localhost:${PORT}`);
    console.log(`GraphQL server ready at http://localhost:${PORT}/graphql`);
    console.log(`Websocket server ready at ws://localhost:${PORT}/ws`);
    console.log(`Runtime backend: ${runtimeBackendMode}`);
    emitBackendLog({
      message: `Node backend ready on port ${PORT} (runtime=${runtimeBackendMode})`,
    });
  });
};

startServer().catch((error) => {
  console.error('Failed to start discovery server:', error);
  process.exit(1);
});
