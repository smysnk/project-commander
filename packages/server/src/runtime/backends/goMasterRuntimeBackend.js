const path = require('path');
const { createMasterClient } = require('../../agent/masterClient');

const DEFAULT_CANONICAL_SERVICE_KEYS = ['main', 'graphql', 'api', 'admin'];
const DEFAULT_HANDSHAKE_CAPABILITIES = [
  'master.health',
  'master.version',
  'master.handshake',
];
const CONTACT_EVENT_SERVICE_NAME = 'agent-master';
const MASTER_EVENT_TYPE_RUNTIME_SNAPSHOT = 'runtime.snapshot';
const MASTER_EVENT_TYPE_LOG_APPEND = 'log.append';
const MASTER_EVENT_TYPE_SLAVE_REGISTERED = 'slave.registered';
const MASTER_EVENT_TYPE_SLAVE_HEARTBEAT = 'slave.heartbeat';
const MASTER_EVENT_TYPE_SLAVE_CONNECTION_LOST = 'slave.connection_lost';
const MASTER_EVENT_TYPE_SLAVE_DRAINED = 'slave.drained';
const MASTER_EVENT_TYPE_SLAVE_COMMAND_QUEUED = 'slave.command_queued';
const MASTER_EVENT_TYPE_SLAVE_COMMAND_DISPATCHED = 'slave.command_dispatched';
const MASTER_EVENT_TYPE_SLAVE_COMMAND_RESULT = 'slave.command_result';
const EVENT_STREAM_RECONNECT_MS = 1000;
const MASTER_CONNECT_RETRY_MS = 1000;
const MASTER_CONNECT_TIMEOUT_MS = 900;
const MASTER_METADATA_REFRESH_MS = 30000;
const SLAVE_CONTACT_LOG_INTERVAL_MS = 15000;
const MASTER_STATUS_DEGRADED = 'degraded';
const MASTER_SHARED_KEY_MISSING_ERROR = 'Slave shared key is not configured on master (set PC_SLAVE_SHARED_KEY).';

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const toPositiveIntOrNull = (value) => {
  const parsed = toNumberOrNull(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const normalizeServiceKey = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized === 'web' || normalized === 'interface' || normalized === 'main') {
    return 'main';
  }
  if (normalized === 'server' || normalized === 'api') {
    return 'api';
  }
  if (normalized === 'admin') {
    return 'admin';
  }
  if (normalized === 'graphql') {
    return 'graphql';
  }
  return normalized;
};

const parseSlaveControlListenTarget = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return {
      target: null,
      port: null,
    };
  }

  const ipv6Match = normalized.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    const parsedPort = Number.parseInt(String(ipv6Match[2] || '').trim(), 10);
    return {
      target: normalized,
      port: Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : null,
    };
  }

  const lastColonIndex = normalized.lastIndexOf(':');
  if (lastColonIndex > 0 && lastColonIndex < normalized.length - 1) {
    const parsedPort = Number.parseInt(normalized.slice(lastColonIndex + 1).trim(), 10);
    return {
      target: normalized,
      port: Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
        ? parsedPort
        : null,
    };
  }

  return {
    target: normalized,
    port: null,
  };
};

const toRuntimeDefaults = () => ({
  servicePorts: { main: null, graphql: null, api: null, admin: null },
  servicePids: { main: null, graphql: null, api: null, admin: null },
  serviceStates: { main: 'stopped', graphql: 'stopped', api: 'stopped', admin: 'stopped' },
});

const normalizeRuntimeSnapshot = (snapshot, projectPathFallback) => {
  const defaults = toRuntimeDefaults();
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const services = Array.isArray(source.services) ? source.services : [];

  const serviceRuntimeEntries = services
    .map((service) => {
      const key = normalizeServiceKey(service?.serviceKey);
      if (!key) {
        return null;
      }

      const pid = toPositiveIntOrNull(service?.pid);
      const port = toPositiveIntOrNull(service?.port);
      const rawState = String(service?.state || 'stopped').toLowerCase();
      const state = rawState || 'stopped';

      if (Object.prototype.hasOwnProperty.call(defaults.servicePorts, key)) {
        defaults.servicePorts[key] = port;
        defaults.servicePids[key] = pid;
        defaults.serviceStates[key] = state;
      }

      return {
        key,
        serviceName: String(service?.serviceName || key),
        pid,
        port,
        state,
        runId: String(service?.runId || ''),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.key.localeCompare(right.key));

  const runtimePorts = Array.from(
    new Set(serviceRuntimeEntries.map((entry) => entry.port).filter((port) => Number.isInteger(port) && port > 0)),
  ).sort((left, right) => left - right);

  const pid = toPositiveIntOrNull(source.pid);
  const status = String(source.status || 'stopped').toLowerCase() || 'stopped';

  return {
    projectPath: String(source.projectPath || projectPathFallback || ''),
    status,
    pid,
    startedAt: null,
    stoppedAt: null,
    lastExitCode: null,
    ports: runtimePorts,
    portRangeBegin: toPositiveIntOrNull(source.portRangeBegin),
    portRangeEnd: toPositiveIntOrNull(source.portRangeEnd),
    servicePorts: defaults.servicePorts,
    servicePids: defaults.servicePids,
    serviceStates: defaults.serviceStates,
    serviceRuntimeEntries,
  };
};

const normalizePortRangeSettings = (settings) => {
  const mode = String(settings?.mode || '').toLowerCase() === 'manual' ? 'manual' : 'automatic';
  const begin = toPositiveIntOrNull(settings?.begin);
  if (mode === 'manual') {
    return { mode, begin };
  }
  return { mode: 'automatic', begin: null };
};

const normalizeProjectPath = (projectPath) => path.resolve(String(projectPath || ''));

const formatLogs = (response, projectPath) => {
  const entries = Array.isArray(response?.entries) ? response.entries : [];
  return entries.map((entry) => ({
    id: toNumberOrNull(entry?.id) || 0,
    projectPath: String(entry?.projectPath || projectPath),
    timestamp: String(entry?.timestamp || ''),
    serviceName: String(entry?.serviceName || ''),
    stream: String(entry?.stream || 'stdout'),
    message: String(entry?.message || ''),
  }));
};

const toProcessStats = (response) => {
  const stats = Array.isArray(response?.stats) ? response.stats : [];
  return stats.map((stat) => ({
    serviceId: toNumberOrNull(stat?.serviceId) || 0,
    serviceName: String(stat?.serviceName || ''),
    serviceKey: String(stat?.serviceKey || ''),
    pid: toPositiveIntOrNull(stat?.pid) || 0,
    cpuPercent: Number(stat?.cpuPercent || 0),
    memoryPercent: Number(stat?.memoryPercent || 0),
    rssMb: Number(stat?.rssMb || 0),
    virtualMb: Number(stat?.virtualMb || 0),
    elapsed: String(stat?.elapsed || ''),
    command: String(stat?.command || ''),
    status: String(stat?.status || 'running'),
  }));
};

const normalizeSlaveId = (value) => String(value || '').trim();

const formatSlaveLogs = (response, {
  slaveId,
  hostName = null,
  hostIp = null,
} = {}) => {
  const normalizedSlaveId = normalizeSlaveId(slaveId);
  const entries = Array.isArray(response?.entries) ? response.entries : [];
  const defaultProjectPath = normalizedSlaveId ? `@slave:${normalizedSlaveId}` : '@slave:unknown';
  return entries.map((entry) => ({
    id: toNumberOrNull(entry?.id) || 0,
    projectPath: String(entry?.projectPath || defaultProjectPath),
    timestamp: String(entry?.timestamp || ''),
    serviceName: String(entry?.serviceName || hostName || 'agent-slave'),
    stream: String(entry?.stream || 'stdout'),
    message: String(entry?.message || ''),
    source: 'agent-slave',
    hostName: hostName || null,
    hostIp: hostIp || null,
    agentUuid: normalizedSlaveId || null,
    slaveId: normalizedSlaveId || null,
  }));
};

const isHostOnlineStatus = (status) => (
  String(status || '').trim().toLowerCase() === 'registered'
);

const toRegisteredHosts = (response) => {
  const slaves = Array.isArray(response?.slaves) ? response.slaves : [];
  return slaves
    .map((slave) => {
      const name = String(slave?.hostName || slave?.slaveId || '').trim();
      const ip = String(slave?.ip || '').trim();
      const port = toPositiveIntOrNull(slave?.port) || 0;
      const status = String(slave?.status || '').trim().toLowerCase() || 'registered';
      const health = String(slave?.health || '').trim().toLowerCase() || null;
      const error = String(slave?.error || '').trim() || null;
      const lastSeenAt = String(slave?.lastSeenAt || '').trim() || null;
      const registeredAt = String(slave?.registeredAt || '').trim() || null;
      const slaveId = String(slave?.slaveId || '').trim() || null;
      const version = String(slave?.version || '').trim() || null;
      const protocolVersion = (
        String(slave?.protocolVersion || slave?.protocol || '').trim() || null
      );
      const discoveredProjects = Array.isArray(slave?.discoveredProjects)
        ? slave.discoveredProjects
        : [];
      const normalizedDiscoveredProjects = discoveredProjects
        .map((project) => {
          const projectPath = String(project?.path || '').trim();
          if (!projectPath) {
            return null;
          }
          const projectName = String(project?.name || path.basename(projectPath) || projectPath).trim();
          const relativePath = String(project?.relativePath || '.').trim() || '.';
          const types = Array.isArray(project?.types)
            ? Array.from(new Set(project.types.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
            : [];
          const services = Array.isArray(project?.services)
            ? Array.from(new Set(project.services.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
            : ['main'];
          return {
            name: projectName,
            path: normalizeProjectPath(projectPath),
            relativePath,
            types,
            services: services.length > 0 ? services : ['main'],
            hasMakefile: Boolean(project?.hasMakefile),
            hostName: name,
            hostIp: ip,
            slaveId,
          };
        })
        .filter(Boolean);

      if (!name || !ip) {
        return null;
      }

      return {
        name,
        ip,
        port,
        status,
        health,
        error,
        lastSeenAt,
        registeredAt,
        version,
        protocolVersion,
        slaveId,
        online: isHostOnlineStatus(status),
        discoveredProjects: normalizedDiscoveredProjects,
      };
    })
    .filter(Boolean);
};

const toNonEmptyStringOrNull = (value) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};

const toStringList = (values) => (
  Array.isArray(values)
    ? values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    : []
);

const toErrorMessage = (error) => {
  if (!error) {
    return null;
  }
  if (typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return String(error);
};

const parseJsonObject = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

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

const normalizeRegisteredSlave = (slave) => {
  const slaveId = String(slave?.slaveId || '').trim();
  if (!slaveId) {
    return null;
  }

  const hostName = String(slave?.hostName || slaveId).trim() || slaveId;
  const ip = String(slave?.ip || '').trim();
  const port = toPositiveIntOrNull(slave?.port) || 0;
  const status = String(slave?.status || '').trim().toLowerCase() || 'unknown';
  const health = String(slave?.health || '').trim().toLowerCase() || null;
  const error = String(slave?.error || '').trim() || null;
  const registeredAt = String(slave?.registeredAt || '').trim();
  const lastSeenAt = String(slave?.lastSeenAt || '').trim();
  const version = String(slave?.version || '').trim() || null;
  const protocolVersion = (
    String(slave?.protocolVersion || slave?.protocol || '').trim() || null
  );
  const discoveredProjects = Array.isArray(slave?.discoveredProjects)
    ? slave.discoveredProjects
    : [];

  const normalizedDiscoveredProjects = discoveredProjects
    .map((project) => {
      const projectPath = String(project?.path || '').trim();
      if (!projectPath) {
        return null;
      }
      const projectName = String(project?.name || path.basename(projectPath) || projectPath).trim();
      const relativePath = String(project?.relativePath || '.').trim() || '.';
      const types = Array.isArray(project?.types)
        ? Array.from(new Set(project.types.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
        : [];
      const services = Array.isArray(project?.services)
        ? Array.from(new Set(project.services.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))
        : ['main'];
      return {
        name: projectName,
        path: normalizeProjectPath(projectPath),
        relativePath,
        types,
        services: services.length > 0 ? services : ['main'],
        hasMakefile: Boolean(project?.hasMakefile),
      };
    })
    .filter(Boolean);

  return {
    slaveId,
    hostName,
    ip,
    port,
    status,
    health,
    error,
    registeredAt,
    lastSeenAt,
    version,
    protocolVersion,
    discoveredProjects: normalizedDiscoveredProjects,
  };
};

const createGoMasterRuntimeBackend = ({ socketPath } = {}) => {
  const master = createMasterClient(socketPath ? { socketPath } : undefined);
  const slaveControlListenTarget = String(
    process.env.PC_MASTER_SLAVE_LISTEN_ADDR || process.env.PC_MASTER_ENDPOINT || '',
  ).trim();
  const parsedSlaveControlListenTarget = parseSlaveControlListenTarget(slaveControlListenTarget);
  let eventSink = null;
  let eventStream = null;
  let eventStreamReconnectTimer = null;
  let masterConnectionTimer = null;
  let masterProbeInFlight = false;
  let stopRequested = false;
  let nextMetadataRefreshAtMs = 0;
  let lastConnectionStateEmission = '';

  const masterAgentState = {
    socketPath: toNonEmptyStringOrNull(master.socketPath),
    target: toNonEmptyStringOrNull(master.target),
    slaveControlTarget: parsedSlaveControlListenTarget.target,
    slaveControlPort: parsedSlaveControlListenTarget.port,
    service: null,
    status: null,
    version: null,
    protocolVersion: null,
    startedAt: null,
    capabilities: [],
    grantedCapabilities: [],
    error: null,
    connectionStatus: 'connecting',
    connectionHealth: 'warning',
    lastConnectedAt: null,
    lastAttemptAt: null,
    reconnectAttempts: 0,
  };

  const trackedProjectPaths = new Set();
  const cachedRuntimeByProject = new Map();
  const trackedSlaveContacts = new Map();
  const trackedSlaveLastContactLogMs = new Map();
  let lastDiscoveredProjectsEmission = '';

  const clearEventStreamReconnectTimer = () => {
    if (!eventStreamReconnectTimer) {
      return;
    }
    clearTimeout(eventStreamReconnectTimer);
    eventStreamReconnectTimer = null;
  };

  const clearMasterConnectionTimer = () => {
    if (!masterConnectionTimer) {
      return;
    }
    clearTimeout(masterConnectionTimer);
    masterConnectionTimer = null;
  };

  const findTrackedSlaveById = (slaveId) => {
    const normalizedSlaveId = normalizeSlaveId(slaveId);
    if (!normalizedSlaveId) {
      return null;
    }
    const direct = trackedSlaveContacts.get(normalizedSlaveId);
    if (direct) {
      return direct;
    }
    const target = normalizedSlaveId.toLowerCase();
    for (const [candidateSlaveId, candidate] of trackedSlaveContacts.entries()) {
      if (String(candidateSlaveId || '').trim().toLowerCase() === target) {
        return candidate;
      }
      if (String(candidate?.slaveId || '').trim().toLowerCase() === target) {
        return candidate;
      }
    }
    return null;
  };

  const toConnectionHealth = (connectionStatus) => {
    const normalized = String(connectionStatus || '').trim().toLowerCase();
    if (normalized === 'connected') {
      return 'healthy';
    }
    if (normalized === 'connecting' || normalized === 'reconnecting') {
      return 'warning';
    }
    if (normalized === 'disconnected') {
      return 'critical';
    }
    return 'unknown';
  };

  const getMasterAgentSnapshot = () => ({
    socketPath: masterAgentState.socketPath,
    target: masterAgentState.target,
    slaveControlTarget: masterAgentState.slaveControlTarget,
    slaveControlPort: Number.isInteger(masterAgentState.slaveControlPort)
      ? masterAgentState.slaveControlPort
      : null,
    service: masterAgentState.service,
    status: masterAgentState.status,
    version: masterAgentState.version,
    protocolVersion: masterAgentState.protocolVersion,
    startedAt: masterAgentState.startedAt,
    capabilities: Array.isArray(masterAgentState.capabilities)
      ? [...masterAgentState.capabilities]
      : [],
    grantedCapabilities: Array.isArray(masterAgentState.grantedCapabilities)
      ? [...masterAgentState.grantedCapabilities]
      : [],
    error: masterAgentState.error,
    connectionStatus: masterAgentState.connectionStatus,
    connectionHealth: masterAgentState.connectionHealth,
    lastConnectedAt: masterAgentState.lastConnectedAt,
    lastAttemptAt: masterAgentState.lastAttemptAt,
    reconnectAttempts: Number.isInteger(masterAgentState.reconnectAttempts)
      ? masterAgentState.reconnectAttempts
      : 0,
  });

  const emitMasterConnectionStateIfChanged = () => {
    const snapshot = getMasterAgentSnapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastConnectionStateEmission) {
      return;
    }
    lastConnectionStateEmission = serialized;
    if (typeof eventSink !== 'function') {
      return;
    }
    eventSink({
      topic: 'runtime.master.connection',
      source: 'node-backend',
      entityId: 'master-agent',
      payload: {
        ...snapshot,
        timestamp: new Date().toISOString(),
      },
    });
  };

  const setMasterConnectionStatus = (nextStatus, { errorMessage = null } = {}) => {
    const previousStatus = String(masterAgentState.connectionStatus || '').trim().toLowerCase();
    const normalizedStatus = String(nextStatus || '').trim().toLowerCase() || 'unknown';
    if (
      normalizedStatus === 'connected' &&
      (previousStatus === 'reconnecting' || previousStatus === 'disconnected')
    ) {
      console.info('[runtime][go-master] Connection to master agent restored.');
    }
    masterAgentState.connectionStatus = normalizedStatus;
    masterAgentState.connectionHealth = toConnectionHealth(normalizedStatus);
    if (errorMessage) {
      masterAgentState.error = String(errorMessage || '').trim() || null;
    } else if (normalizedStatus === 'connected') {
      masterAgentState.error = null;
    }
    emitMasterConnectionStateIfChanged();
  };

  const rememberProject = (projectPath) => {
    if (!projectPath) {
      return '';
    }
    const normalized = normalizeProjectPath(projectPath);
    trackedProjectPaths.add(normalized);
    return normalized;
  };

  const emitRuntimeIfChanged = (runtime) => {
    if (!runtime?.projectPath || typeof eventSink !== 'function') {
      return;
    }

    const serialized = JSON.stringify(runtime);
    const previous = cachedRuntimeByProject.get(runtime.projectPath);
    if (previous === serialized) {
      return;
    }

    cachedRuntimeByProject.set(runtime.projectPath, serialized);
    eventSink({
      type: 'runtime',
      runtime,
    });
  };

  const getTrackedDiscoveredProjects = () => {
    const projects = [];
    const seenKeys = new Set();
    for (const slave of trackedSlaveContacts.values()) {
      const slaveId = String(slave?.slaveId || '').trim();
      const hostName = String(slave?.hostName || '').trim();
      const hostIp = String(slave?.ip || '').trim();
      const discoveredProjects = Array.isArray(slave?.discoveredProjects) ? slave.discoveredProjects : [];
      for (const project of discoveredProjects) {
        const projectPath = normalizeProjectPath(project?.path || '');
        if (!projectPath) {
          continue;
        }
        const key = `${slaveId.toLowerCase()}::${projectPath.toLowerCase()}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        projects.push({
          name: String(project?.name || path.basename(projectPath) || projectPath).trim(),
          path: projectPath,
          relativePath: String(project?.relativePath || '.').trim() || '.',
          types: Array.isArray(project?.types) ? project.types : [],
          services: Array.isArray(project?.services) ? project.services : ['main'],
          hasMakefile: Boolean(project?.hasMakefile),
          hostName: hostName || null,
          hostIp: hostIp || null,
          slaveId: slaveId || null,
        });
      }
    }
    projects.sort((left, right) => {
      const leftName = String(left?.name || '');
      const rightName = String(right?.name || '');
      if (leftName !== rightName) {
        return leftName.localeCompare(rightName);
      }
      return String(left?.path || '').localeCompare(String(right?.path || ''));
    });
    return projects;
  };

  const emitDiscoveredProjectsIfChanged = () => {
    if (typeof eventSink !== 'function') {
      return;
    }
    const projects = getTrackedDiscoveredProjects();
    const serialized = JSON.stringify(projects);
    if (serialized === lastDiscoveredProjectsEmission) {
      return;
    }
    lastDiscoveredProjectsEmission = serialized;
    eventSink({
      type: 'discovery.projects',
      source: 'master-agent',
      projects,
      scannedAt: new Date().toISOString(),
    });
  };

  const emitOverlayLog = ({
    message,
    timestamp,
    stream = 'system',
    hostName = null,
    hostIp = null,
    level = null,
    serviceName = CONTACT_EVENT_SERVICE_NAME,
  }) => {
    if (typeof eventSink !== 'function') {
      return;
    }

    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
      return;
    }

    eventSink({
      type: 'overlay-log',
      entry: {
        timestamp: toIsoTimestamp(timestamp),
        serviceName: String(serviceName || CONTACT_EVENT_SERVICE_NAME).trim() || CONTACT_EVENT_SERVICE_NAME,
        stream: String(stream || 'system'),
        level: toNonEmptyStringOrNull(level),
        message: normalizedMessage,
        source: 'master-agent',
        hostName: hostName ? String(hostName) : null,
        hostIp: hostIp ? String(hostIp) : null,
      },
    });
  };

  const toHostEventPayload = (slave) => {
    if (!slave || !slave.slaveId) {
      return null;
    }

    const status = String(slave.status || '').trim().toLowerCase() || 'unknown';
    const health = String(slave.health || '').trim().toLowerCase() || 'unknown';
    const lastSeenAt = String(slave.lastSeenAt || slave.registeredAt || '').trim() || null;
    const error = String(slave.error || '').trim() || null;

    return {
      id: null,
      agentUuid: String(slave.slaveId || '').trim() || null,
      name: String(slave.hostName || slave.slaveId || '').trim(),
      ip: String(slave.ip || '').trim(),
      port: toPositiveIntOrNull(slave.port) || 0,
      source: 'runtime',
      status,
      health,
      error,
      lastSeenAt,
      version: String(slave.version || '').trim() || null,
      protocolVersion: String(slave.protocolVersion || '').trim() || null,
      online: isHostOnlineStatus(status),
    };
  };

  const emitHostUpdate = ({ slave } = {}) => {
    if (typeof eventSink !== 'function') {
      return;
    }
    const hostPayload = toHostEventPayload(slave);
    if (!hostPayload || !hostPayload.agentUuid) {
      return;
    }
    eventSink({
      type: 'host',
      source: 'master-agent',
      host: hostPayload,
    });
  };

  const toSlaveEndpoint = (slave) => (
    slave?.ip
      ? `${slave.ip}${slave.port > 0 ? `:${slave.port}` : ''}`
      : 'unknown'
  );

  const upsertTrackedSlave = ({
    slave,
    forceRegistered = false,
    forceContact = false,
  } = {}) => {
    if (!slave || !slave.slaveId) {
      return;
    }

    const previous = trackedSlaveContacts.get(slave.slaveId);
    const endpoint = toSlaveEndpoint(slave);

    if (!previous || forceRegistered) {
      emitOverlayLog({
        timestamp: slave.lastSeenAt || slave.registeredAt,
        message: `Slave registered: ${slave.hostName} (${endpoint}) id=${slave.slaveId}`,
        hostName: slave.hostName,
        hostIp: slave.ip,
      });
      trackedSlaveLastContactLogMs.set(slave.slaveId, Date.now());
      trackedSlaveContacts.set(slave.slaveId, slave);
      emitHostUpdate({ slave });
      emitDiscoveredProjectsIfChanged();
      return;
    }

    const statusChanged = (
      String(slave.status || '').trim().toLowerCase() !==
      String(previous.status || '').trim().toLowerCase()
    );
    const healthChanged = (
      String(slave.health || '').trim().toLowerCase() !==
      String(previous.health || '').trim().toLowerCase()
    );
    const errorChanged = (
      String(slave.error || '').trim() !==
      String(previous.error || '').trim()
    );
    const seenChanged = slave.lastSeenAt && slave.lastSeenAt !== previous.lastSeenAt;
    const nowMs = Date.now();
    const lastContactLogMs = Number(trackedSlaveLastContactLogMs.get(slave.slaveId) || 0);
    const contactLogStale = (nowMs - lastContactLogMs) >= SLAVE_CONTACT_LOG_INTERVAL_MS;
    const shouldEmitContactLog = (
      (forceContact || seenChanged) &&
      (statusChanged || healthChanged || errorChanged || contactLogStale)
    );

    if (shouldEmitContactLog) {
      const normalizedError = String(slave.error || '').trim();
      emitOverlayLog({
        timestamp: slave.lastSeenAt,
        message: normalizedError
          ? `Slave contact: ${slave.hostName} (${endpoint}) id=${slave.slaveId} status=${slave.status || 'unknown'} health=${slave.health || 'unknown'} error=${normalizedError}`
          : `Slave contact: ${slave.hostName} (${endpoint}) id=${slave.slaveId}`,
        hostName: slave.hostName,
        hostIp: slave.ip,
        level: 'debug',
      });
      trackedSlaveLastContactLogMs.set(slave.slaveId, nowMs);
    }

    trackedSlaveContacts.set(slave.slaveId, slave);
    emitHostUpdate({ slave });
    emitDiscoveredProjectsIfChanged();
  };

  const removeTrackedSlave = ({
    slaveId,
    hostName = null,
    hostIp = null,
    reason = null,
  } = {}) => {
    const normalizedSlaveId = String(slaveId || '').trim();
    if (!normalizedSlaveId) {
      return;
    }

    const previous = trackedSlaveContacts.get(normalizedSlaveId);
    trackedSlaveContacts.delete(normalizedSlaveId);
    trackedSlaveLastContactLogMs.delete(normalizedSlaveId);
    const finalHostName = (
      String(hostName || '').trim() ||
      String(previous?.hostName || '').trim() ||
      normalizedSlaveId
    );
    const finalHostIp = String(hostIp || '').trim() || String(previous?.ip || '').trim() || null;
    const normalizedReason = String(reason || '').trim();

    emitOverlayLog({
      message: `Slave disconnected: ${finalHostName} id=${normalizedSlaveId}${normalizedReason ? ` (${normalizedReason})` : ''}`,
      hostName: finalHostName,
      hostIp: finalHostIp,
    });

    const disconnectedState = {
      slaveId: normalizedSlaveId,
      hostName: finalHostName,
      ip: finalHostIp,
      port: toPositiveIntOrNull(previous?.port) || 0,
      status: 'disconnected',
      health: 'critical',
      error: normalizedReason || 'Slave disconnected',
      registeredAt: String(previous?.registeredAt || '').trim() || null,
      lastSeenAt: String(previous?.lastSeenAt || '').trim() || new Date().toISOString(),
      version: String(previous?.version || '').trim() || null,
      protocolVersion: String(previous?.protocolVersion || '').trim() || null,
    };
    emitHostUpdate({ slave: disconnectedState });
    emitDiscoveredProjectsIfChanged();
  };

  const getProjectRuntime = async (projectPath) => {
    const normalizedProjectPath = rememberProject(projectPath);
    const response = await master.getRuntimeSnapshot({ projectPath: normalizedProjectPath });
    const runtime = normalizeRuntimeSnapshot(response?.snapshot, normalizedProjectPath);
    emitRuntimeIfChanged(runtime);
    return runtime;
  };

  const syncTrackedSlavesFromSnapshot = (snapshotSlaves) => {
    const normalizedSlaves = Array.isArray(snapshotSlaves) ? snapshotSlaves : [];
    const seenSlaveIds = new Set();
    for (const slave of normalizedSlaves) {
      if (!slave?.slaveId) {
        continue;
      }
      seenSlaveIds.add(slave.slaveId);
      upsertTrackedSlave({ slave });
    }

    const staleSlaveIds = Array.from(trackedSlaveContacts.keys())
      .filter((slaveId) => !seenSlaveIds.has(slaveId));
    for (const staleSlaveId of staleSlaveIds) {
      const stale = trackedSlaveContacts.get(staleSlaveId);
      removeTrackedSlave({
        slaveId: staleSlaveId,
        hostName: stale?.hostName || null,
        hostIp: stale?.ip || null,
      });
    }
  };

  const isExpectedStreamError = (error) => {
    if (!error) {
      return false;
    }
    if (Number(error.code) === 1) {
      return true;
    }
    const message = String(error?.message || '').toLowerCase();
    return message.includes('cancelled') || message.includes('canceled');
  };

  const handleMasterRuntimeSnapshotEvent = (event) => {
    const payload = parseJsonObject(event?.payloadJson);
    const projectPath = String(payload?.projectPath || event?.projectPath || '').trim();
    if (!projectPath) {
      return;
    }
    const normalizedProjectPath = rememberProject(projectPath);
    const runtime = normalizeRuntimeSnapshot(payload, normalizedProjectPath);
    emitRuntimeIfChanged(runtime);
  };

  const handleMasterLogAppendEvent = (event) => {
    const payload = parseJsonObject(event?.payloadJson);
    if (!payload || typeof eventSink !== 'function') {
      return;
    }

    const projectPath = String(payload?.projectPath || event?.projectPath || '').trim();
    const serviceName = String(payload?.serviceName || '').trim();
    const message = String(payload?.message || '').trimEnd();
    if (!projectPath || !serviceName || !message) {
      return;
    }

    const runId = String(payload?.runId || event?.runId || '').trim();
    const stream = String(payload?.stream || 'stdout').trim().toLowerCase();
    const normalizedStream = (
      stream === 'stdout' || stream === 'stderr' || stream === 'system'
    )
      ? stream
      : 'stdout';

    const entry = {
      id: String(event?.eventId || `stream-log-${Date.now()}`),
      projectPath,
      timestamp: toIsoTimestamp(payload?.timestamp || event?.timestamp),
      serviceName,
      stream: normalizedStream,
      message,
      runId,
      source: 'master-agent',
    };
    eventSink({
      type: 'project-log',
      source: 'master-agent',
      entry,
    });
  };

  const handleMasterSlaveEvent = (eventType, event) => {
    const payload = parseJsonObject(event?.payloadJson);
    const slave = normalizeRegisteredSlave(payload);
    if (!slave) {
      return;
    }

    if (eventType === MASTER_EVENT_TYPE_SLAVE_REGISTERED) {
      upsertTrackedSlave({ slave, forceRegistered: true });
      return;
    }
    if (eventType === MASTER_EVENT_TYPE_SLAVE_HEARTBEAT) {
      upsertTrackedSlave({ slave, forceContact: true });
      return;
    }
    if (eventType === MASTER_EVENT_TYPE_SLAVE_CONNECTION_LOST) {
      upsertTrackedSlave({ slave, forceContact: true });
      return;
    }
    if (eventType === MASTER_EVENT_TYPE_SLAVE_DRAINED) {
      removeTrackedSlave({
        slaveId: slave.slaveId,
        hostName: slave.hostName,
        hostIp: slave.ip,
        reason: payload?.reason,
      });
    }
  };

  const handleMasterSlaveCommandEvent = (eventType, event) => {
    const payload = parseJsonObject(event?.payloadJson) || {};
    const commandId = String(payload?.commandId || '').trim();
    const commandType = String(payload?.commandType || '').trim().toLowerCase();
    const repositoryUrl = String(payload?.repositoryUrl || '').trim();
    const targetPath = String(payload?.targetPath || '').trim();
    const hostName = String(payload?.hostName || '').trim() || null;
    const hostIp = String(payload?.ip || '').trim() || null;
    const status = String(payload?.status || '').trim().toLowerCase();
    const message = String(payload?.message || '').trim();
    const outputLines = Array.isArray(payload?.outputLines)
      ? payload.outputLines
        .map((line) => String(line || '').trimEnd())
        .filter(Boolean)
      : [];

    const commandLabel = commandId ? `id=${commandId}` : 'id=unknown';
    const checkoutDescriptor = repositoryUrl && targetPath
      ? `${repositoryUrl} -> ${targetPath}`
      : (targetPath || repositoryUrl || 'checkout command');

    if (eventType === MASTER_EVENT_TYPE_SLAVE_COMMAND_QUEUED) {
      emitOverlayLog({
        message: `Slave checkout queued: ${checkoutDescriptor} (${commandLabel})`,
        hostName,
        hostIp,
      });
      return;
    }

    if (eventType === MASTER_EVENT_TYPE_SLAVE_COMMAND_DISPATCHED) {
      emitOverlayLog({
        message: `Slave checkout started: ${checkoutDescriptor} (${commandLabel})`,
        hostName,
        hostIp,
      });
      return;
    }

    if (eventType !== MASTER_EVENT_TYPE_SLAVE_COMMAND_RESULT) {
      return;
    }

    const statusLabel = status || 'failed';
    const primaryMessage = message || `Slave checkout ${statusLabel}: ${checkoutDescriptor}`;
    emitOverlayLog({
      message: `Slave checkout ${statusLabel}: ${primaryMessage} (${commandLabel})`,
      hostName,
      hostIp,
      stream: statusLabel === 'completed' ? 'stdout' : 'stderr',
      level: statusLabel === 'completed' ? 'info' : 'error',
    });

    if (outputLines.length > 0) {
      const level = statusLabel === 'completed' ? 'debug' : 'error';
      const stream = statusLabel === 'completed' ? 'stdout' : 'stderr';
      for (const line of outputLines) {
        emitOverlayLog({
          message: `[checkout][${commandType || 'command'}][${commandId || 'unknown'}] ${line}`,
          hostName,
          hostIp,
          stream,
          level,
          serviceName: String(hostName || hostIp || '').trim() || 'unknown-host',
        });
      }
    }
  };

  const handleMasterEvent = (event) => {
    const eventType = String(event?.type || '').trim().toLowerCase();
    if (eventType === MASTER_EVENT_TYPE_RUNTIME_SNAPSHOT) {
      handleMasterRuntimeSnapshotEvent(event);
      return;
    }
    if (eventType === MASTER_EVENT_TYPE_LOG_APPEND) {
      handleMasterLogAppendEvent(event);
      return;
    }
    if (
      eventType === MASTER_EVENT_TYPE_SLAVE_REGISTERED ||
      eventType === MASTER_EVENT_TYPE_SLAVE_HEARTBEAT ||
      eventType === MASTER_EVENT_TYPE_SLAVE_CONNECTION_LOST ||
      eventType === MASTER_EVENT_TYPE_SLAVE_DRAINED
    ) {
      handleMasterSlaveEvent(eventType, event);
      return;
    }
    if (
      eventType === MASTER_EVENT_TYPE_SLAVE_COMMAND_QUEUED ||
      eventType === MASTER_EVENT_TYPE_SLAVE_COMMAND_DISPATCHED ||
      eventType === MASTER_EVENT_TYPE_SLAVE_COMMAND_RESULT
    ) {
      handleMasterSlaveCommandEvent(eventType, event);
    }
  };

  const scheduleEventStreamReconnect = () => {
    if (stopRequested || eventStreamReconnectTimer) {
      return;
    }
    eventStreamReconnectTimer = setTimeout(() => {
      eventStreamReconnectTimer = null;
      if (!stopRequested) {
        connectEventStream();
      }
    }, EVENT_STREAM_RECONNECT_MS);
    eventStreamReconnectTimer.unref?.();
  };

  const clearEventStream = () => {
    if (!eventStream) {
      return;
    }
    try {
      eventStream.cancel?.();
    } catch {
      // ignore cancel errors
    }
    eventStream = null;
  };

  const connectEventStream = () => {
    if (stopRequested || eventStream) {
      return;
    }

    let settled = false;
    const settleStream = ({ reconnect = false } = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      eventStream = null;
      if (reconnect) {
        scheduleEventStreamReconnect();
      }
    };

    eventStream = master.subscribeEvents({
      projectPaths: [],
      onEvent: (event) => {
        handleMasterEvent(event);
      },
      onError: (error) => {
        if (stopRequested || isExpectedStreamError(error)) {
          settleStream({ reconnect: false });
          return;
        }
        emitOverlayLog({
          stream: 'stderr',
          message: `Master event stream error: ${toErrorMessage(error) || 'unknown error'}`,
        });
        setMasterConnectionStatus('reconnecting', {
          errorMessage: toErrorMessage(error) || 'Master event stream unavailable',
        });
        settleStream({ reconnect: true });
      },
      onEnd: () => {
        if (stopRequested) {
          settleStream({ reconnect: false });
          return;
        }
        emitOverlayLog({
          message: 'Master event stream ended; reconnecting.',
        });
        setMasterConnectionStatus('reconnecting', {
          errorMessage: 'Master event stream ended',
        });
        settleStream({ reconnect: true });
      },
    });
  };

  const refreshMasterMetadata = async () => {
    const [versionResult, handshakeResult] = await Promise.allSettled([
      master.getVersion({ timeoutMs: 2000 }),
      master.handshake({
        requestedCapabilities: DEFAULT_HANDSHAKE_CAPABILITIES,
        timeoutMs: 2000,
      }),
    ]);

    if (versionResult.status === 'fulfilled') {
      const version = versionResult.value || {};
      masterAgentState.service = toNonEmptyStringOrNull(version.service) || masterAgentState.service;
      masterAgentState.version = toNonEmptyStringOrNull(version.version) || masterAgentState.version;
      masterAgentState.protocolVersion = (
        toNonEmptyStringOrNull(version.protocolVersion) || masterAgentState.protocolVersion
      );
      masterAgentState.startedAt = (
        toNonEmptyStringOrNull(version.startedAt) || masterAgentState.startedAt
      );
      masterAgentState.capabilities = toStringList(version.capabilities);
    }

    if (handshakeResult.status === 'fulfilled') {
      const handshake = handshakeResult.value || {};
      masterAgentState.socketPath = (
        toNonEmptyStringOrNull(handshake.socketPath) || masterAgentState.socketPath
      );
      masterAgentState.protocolVersion = (
        toNonEmptyStringOrNull(handshake.protocolVersion) || masterAgentState.protocolVersion
      );
      masterAgentState.grantedCapabilities = toStringList(handshake.grantedCapabilities);
    }
  };

  const scheduleMasterConnectionProbe = (delayMs = MASTER_CONNECT_RETRY_MS) => {
    if (stopRequested || masterConnectionTimer) {
      return;
    }
    masterConnectionTimer = setTimeout(() => {
      masterConnectionTimer = null;
      probeMasterConnectionOnce().catch((error) => {
        setMasterConnectionStatus('reconnecting', {
          errorMessage: toErrorMessage(error) || 'Master connectivity probe failed',
        });
        scheduleMasterConnectionProbe(MASTER_CONNECT_RETRY_MS);
      });
    }, Math.max(0, Number(delayMs) || MASTER_CONNECT_RETRY_MS));
    masterConnectionTimer.unref?.();
  };

  const probeMasterConnectionOnce = async () => {
    if (stopRequested) {
      return;
    }
    if (masterProbeInFlight) {
      scheduleMasterConnectionProbe(MASTER_CONNECT_RETRY_MS);
      return;
    }

    masterProbeInFlight = true;
    masterAgentState.lastAttemptAt = new Date().toISOString();
    emitMasterConnectionStateIfChanged();

    const previousStatus = String(masterAgentState.connectionStatus || '').trim().toLowerCase();
    const wasConnected = previousStatus === 'connected';
    if (!wasConnected) {
      setMasterConnectionStatus(
        masterAgentState.reconnectAttempts > 0 ? 'reconnecting' : 'connecting',
      );
    }

    try {
      const health = await master.health({ timeoutMs: MASTER_CONNECT_TIMEOUT_MS });
      masterAgentState.service = toNonEmptyStringOrNull(health?.service) || masterAgentState.service;
      masterAgentState.status = toNonEmptyStringOrNull(health?.status) || masterAgentState.status;
      masterAgentState.version = toNonEmptyStringOrNull(health?.version) || masterAgentState.version;
      masterAgentState.startedAt = toNonEmptyStringOrNull(health?.startedAt) || masterAgentState.startedAt;
      masterAgentState.lastConnectedAt = new Date().toISOString();
      masterAgentState.reconnectAttempts = 0;
      setMasterConnectionStatus('connected');
      const normalizedMasterStatus = String(masterAgentState.status || '').trim().toLowerCase();
      if (normalizedMasterStatus === MASTER_STATUS_DEGRADED) {
        masterAgentState.error = MASTER_SHARED_KEY_MISSING_ERROR;
      } else if (masterAgentState.error === MASTER_SHARED_KEY_MISSING_ERROR) {
        masterAgentState.error = null;
      }

      if (!eventStream) {
        connectEventStream();
      }

      const nowMs = Date.now();
      if (!wasConnected || nowMs >= nextMetadataRefreshAtMs) {
        await refreshMasterMetadata();
        nextMetadataRefreshAtMs = nowMs + MASTER_METADATA_REFRESH_MS;
        emitMasterConnectionStateIfChanged();
      }
    } catch (error) {
      masterAgentState.reconnectAttempts += 1;
      const errorMessage = toErrorMessage(error) || 'Master connectivity check failed';
      setMasterConnectionStatus('reconnecting', { errorMessage });
      clearEventStream();
      scheduleEventStreamReconnect();
    } finally {
      masterProbeInFlight = false;
      scheduleMasterConnectionProbe(MASTER_CONNECT_RETRY_MS);
    }
  };

  const startMasterConnectionMonitor = () => {
    clearMasterConnectionTimer();
    masterAgentState.reconnectAttempts = 0;
    masterAgentState.error = null;
    setMasterConnectionStatus('connecting');
    scheduleMasterConnectionProbe(0);
  };

  return {
    name: 'go-master',
    async getBackendInfo() {
      return {
        name: 'go-master',
        displayName: 'Go Master Agent',
        masterAgent: getMasterAgentSnapshot(),
      };
    },

    setRuntimeEventSink(sink) {
      eventSink = typeof sink === 'function' ? sink : null;
      emitMasterConnectionStateIfChanged();
    },

    start() {
      stopRequested = false;
      lastDiscoveredProjectsEmission = '';
      clearEventStreamReconnectTimer();
      clearMasterConnectionTimer();
      startMasterConnectionMonitor();
    },

    stop() {
      stopRequested = true;
      clearEventStreamReconnectTimer();
      clearMasterConnectionTimer();
      clearEventStream();
      trackedSlaveContacts.clear();
      lastDiscoveredProjectsEmission = '';
      setMasterConnectionStatus('disconnected', {
        errorMessage: 'Node runtime backend stopped',
      });
      master.close();
    },

    async toggleProjectRuntime({ projectPath }) {
      const normalizedProjectPath = rememberProject(projectPath);
      const runtime = await getProjectRuntime(normalizedProjectPath);
      const hasRunningServices = (runtime.serviceRuntimeEntries || []).some(
        (entry) =>
          Number.isInteger(entry?.pid) &&
          entry.pid > 0 &&
          (entry.state === 'starting' || entry.state === 'started'),
      );

      if (hasRunningServices) {
        await master.stopProject({ projectPath: normalizedProjectPath });
      } else {
        await master.startProject({ projectPath: normalizedProjectPath });
      }

      return getProjectRuntime(normalizedProjectPath);
    },

    async toggleServiceRuntime({ projectPath, serviceKey }) {
      const normalizedProjectPath = rememberProject(projectPath);
      const normalizedServiceKey = normalizeServiceKey(serviceKey);
      const runtime = await getProjectRuntime(normalizedProjectPath);

      const targetEntry = (runtime.serviceRuntimeEntries || []).find((entry) => {
        const entryKey = normalizeServiceKey(entry?.key);
        return entryKey === normalizedServiceKey;
      });

      const isRunning = Boolean(
        targetEntry &&
        Number.isInteger(targetEntry.pid) &&
        targetEntry.pid > 0 &&
        (targetEntry.state === 'starting' || targetEntry.state === 'started'),
      );

      if (isRunning) {
        await master.stopService({
          projectPath: normalizedProjectPath,
          serviceKey: normalizedServiceKey,
        });
      } else {
        await master.startService({
          projectPath: normalizedProjectPath,
          serviceKey: normalizedServiceKey,
        });
      }

      return getProjectRuntime(normalizedProjectPath);
    },

    async getProjectRuntime(projectPath) {
      return getProjectRuntime(projectPath);
    },

    async getProjectLogs({ projectPath, limit, afterId, serviceNames }) {
      const normalizedProjectPath = rememberProject(projectPath);
      const response = await master.getLogs({
        projectPath: normalizedProjectPath,
        limit,
        afterId,
        serviceNames,
      });
      return formatLogs(response, normalizedProjectPath);
    },

    async getSlaveLogs({ slaveId, limit, afterId, serviceNames }) {
      const normalizedSlaveId = normalizeSlaveId(slaveId);
      if (!normalizedSlaveId) {
        return [];
      }
      const trackedSlave = findTrackedSlaveById(normalizedSlaveId);
      const response = await master.getLogs({
        slaveId: normalizedSlaveId,
        limit,
        afterId,
        serviceNames,
      });
      return formatSlaveLogs(response, {
        slaveId: normalizedSlaveId,
        hostName: String(trackedSlave?.hostName || '').trim() || null,
        hostIp: String(trackedSlave?.ip || '').trim() || null,
      });
    },

    async getProjectLaunchEnvironment(projectPath) {
      const normalizedProjectPath = rememberProject(projectPath);
      const response = await master.getLaunchEnvironment({ projectPath: normalizedProjectPath });
      const entries = Array.isArray(response?.entries) ? response.entries : [];
      return entries.map((entry) => ({
        key: String(entry?.key || ''),
        value: String(entry?.value || ''),
      }));
    },

    async getProjectPortRangeSettings(projectPath) {
      const normalizedProjectPath = rememberProject(projectPath);
      const response = await master.getPortRangeSettings({ projectPath: normalizedProjectPath });
      return normalizePortRangeSettings(response?.settings);
    },

    async setProjectPortRangeSettings({ projectPath, mode, begin }) {
      const normalizedProjectPath = rememberProject(projectPath);
      const normalizedMode = String(mode || '').toLowerCase() === 'manual' ? 'manual' : 'automatic';
      const normalizedBegin = toPositiveIntOrNull(begin) || 0;
      const response = await master.setPortRangeSettings({
        projectPath: normalizedProjectPath,
        mode: normalizedMode,
        begin: normalizedMode === 'manual' ? normalizedBegin : 0,
      });
      return normalizePortRangeSettings(response?.settings);
    },

    async getProjectProcessStats(projectPath) {
      const normalizedProjectPath = rememberProject(projectPath);
      const response = await master.getProcessStats({ projectPath: normalizedProjectPath });
      return toProcessStats(response);
    },

    async listRegisteredHosts() {
      const response = await master.listRegisteredSlaves();
      const hosts = toRegisteredHosts(response);
      const tracked = hosts
        .map((host) => ({
          slaveId: String(host?.slaveId || '').trim(),
          hostName: String(host?.name || '').trim(),
          ip: String(host?.ip || '').trim(),
          port: toPositiveIntOrNull(host?.port) || 0,
          status: String(host?.status || '').trim().toLowerCase() || 'unknown',
          health: String(host?.health || '').trim().toLowerCase() || null,
          error: String(host?.error || '').trim() || null,
          registeredAt: String(host?.registeredAt || '').trim(),
          lastSeenAt: String(host?.lastSeenAt || '').trim(),
          version: String(host?.version || '').trim() || null,
          protocolVersion: String(host?.protocolVersion || '').trim() || null,
          online: Boolean(host?.online),
          discoveredProjects: Array.isArray(host?.discoveredProjects) ? host.discoveredProjects : [],
        }))
        .filter((host) => host.slaveId && host.hostName && host.ip);
      syncTrackedSlavesFromSnapshot(tracked);
      return hosts;
    },

    async listDiscoveredProjects() {
      const response = await master.listRegisteredSlaves();
      const hosts = toRegisteredHosts(response);
      const tracked = hosts
        .map((host) => ({
          slaveId: String(host?.slaveId || '').trim(),
          hostName: String(host?.name || '').trim(),
          ip: String(host?.ip || '').trim(),
          port: toPositiveIntOrNull(host?.port) || 0,
          status: String(host?.status || '').trim().toLowerCase() || 'unknown',
          health: String(host?.health || '').trim().toLowerCase() || null,
          error: String(host?.error || '').trim() || null,
          registeredAt: String(host?.registeredAt || '').trim(),
          lastSeenAt: String(host?.lastSeenAt || '').trim(),
          version: String(host?.version || '').trim() || null,
          protocolVersion: String(host?.protocolVersion || '').trim() || null,
          online: Boolean(host?.online),
          discoveredProjects: Array.isArray(host?.discoveredProjects) ? host.discoveredProjects : [],
        }))
        .filter((host) => host.slaveId && host.hostName && host.ip);
      syncTrackedSlavesFromSnapshot(tracked);
      return getTrackedDiscoveredProjects();
    },

    async checkoutHostProject({
      slaveId,
      repositoryUrl,
      baseDirectory,
      destinationFolder,
    }) {
      const normalizedSlaveId = String(slaveId || '').trim();
      const normalizedRepositoryUrl = String(repositoryUrl || '').trim();
      const normalizedBaseDirectory = String(baseDirectory || '').trim();
      const normalizedDestinationFolder = String(destinationFolder || '').trim();
      if (!normalizedSlaveId) {
        throw new Error('slaveId is required');
      }
      if (!normalizedRepositoryUrl) {
        throw new Error('repositoryUrl is required');
      }
      if (!normalizedBaseDirectory) {
        throw new Error('baseDirectory is required');
      }
      if (!normalizedDestinationFolder) {
        throw new Error('destinationFolder is required');
      }

      const response = await master.checkoutProjectOnSlave({
        slaveId: normalizedSlaveId,
        repositoryUrl: normalizedRepositoryUrl,
        baseDirectory: normalizedBaseDirectory,
        destinationFolder: normalizedDestinationFolder,
      });
      return {
        commandId: String(response?.commandId || '').trim() || null,
        status: String(response?.status || '').trim().toLowerCase() || 'unknown',
        message: String(response?.message || '').trim() || null,
      };
    },

    async stopServiceByProcessId(processId) {
      const parsedProcessId = toPositiveIntOrNull(processId);
      if (!parsedProcessId) {
        return;
      }

      for (const projectPath of trackedProjectPaths) {
        const runtime = await getProjectRuntime(projectPath);
        const matched = (runtime.serviceRuntimeEntries || []).find(
          (entry) => Number(entry?.pid) === parsedProcessId,
        );
        if (!matched) {
          continue;
        }

        await master.stopService({
          projectPath,
          serviceKey: normalizeServiceKey(matched.key),
        });
        await getProjectRuntime(projectPath);
        break;
      }
    },

    async close() {
      this.stop();
    },
  };
};

module.exports = {
  createGoMasterRuntimeBackend,
  DEFAULT_CANONICAL_SERVICE_KEYS,
};
