const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const normalizeLogLevelName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'warning') {
    return 'warn';
  }
  if (normalized === 'panic') {
    return 'fatal';
  }
  return LOG_LEVELS.has(normalized) ? normalized : null;
};

export const toIsoTimestamp = (value) => {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
};

export const normalizeOverlayLogStream = (value) => {
  const normalized = String(value || 'system').trim().toLowerCase();
  if (normalized === 'stdout' || normalized === 'stderr' || normalized === 'system') {
    return normalized;
  }
  return 'system';
};

export const normalizeOverlayLogEntry = (entry, { id } = {}) => {
  const message = String(entry?.message || '').trimEnd();
  if (!message) {
    return null;
  }
  return {
    id: String(id || '').trim() || null,
    projectPath: '@overlay',
    timestamp: toIsoTimestamp(entry?.timestamp),
    serviceName: String(entry?.serviceName || 'system').trim() || 'system',
    level: normalizeLogLevelName(entry?.level),
    source: String(entry?.source || entry?.serviceName || 'system').trim().toLowerCase() || 'system',
    hostId: Number.isInteger(Number(entry?.hostId)) ? Number(entry?.hostId) : null,
    hostName: String(entry?.hostName || '').trim() || null,
    hostIp: String(entry?.hostIp || '').trim() || null,
    agentUuid: String(entry?.agentUuid || entry?.slaveId || '').trim() || null,
    slaveId: String(entry?.slaveId || entry?.agentUuid || '').trim() || null,
    stream: normalizeOverlayLogStream(entry?.stream),
    message,
  };
};

export const buildRuntimeConnectionFingerprint = (connection) => {
  if (!connection || typeof connection !== 'object') {
    return '';
  }
  return JSON.stringify({
    socketPath: connection.socketPath ?? null,
    target: connection.target ?? null,
    service: connection.service ?? null,
    status: connection.status ?? null,
    connectionStatus: connection.connectionStatus ?? null,
    connectionHealth: connection.connectionHealth ?? null,
    reconnectAttempts: Number.isFinite(Number(connection.reconnectAttempts))
      ? Number(connection.reconnectAttempts)
      : null,
    version: connection.version ?? null,
    protocolVersion: connection.protocolVersion ?? null,
    startedAt: connection.startedAt ?? null,
    capabilities: Array.isArray(connection.capabilities) ? connection.capabilities : [],
    grantedCapabilities: Array.isArray(connection.grantedCapabilities) ? connection.grantedCapabilities : [],
    error: connection.error ?? null,
  });
};
