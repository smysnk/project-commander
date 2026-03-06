import {
  PORT_RANGE_BEGIN_MAX,
  PORT_RANGE_BEGIN_MIN,
  PORT_RANGE_MODE,
} from '../constants/ui';

export const normalizeHealthName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'healthy') {
    return 'healthy';
  }
  if (normalized === 'warning') {
    return 'warning';
  }
  if (normalized === 'critical') {
    return 'critical';
  }
  return 'unknown';
};

export const toHostHealthClassName = (value) => normalizeHealthName(value);
export const toConnectionHealthClassName = (value) => normalizeHealthName(value);

export const getDefaultWsEndpoint = () => {
  const configuredServerPort = Number.parseInt(
    String(process.env.NEXT_PUBLIC_SERVER_PORT || '').trim(),
    10,
  );
  const hasConfiguredServerPort = Number.isInteger(configuredServerPort) && configuredServerPort > 0;
  const fallbackPort = hasConfiguredServerPort ? configuredServerPort : 4000;

  if (typeof window === 'undefined') {
    return `ws://localhost:${fallbackPort}/ws`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const hostName = window.location.hostname;
  if (hasConfiguredServerPort) {
    return `${protocol}://${hostName}:${configuredServerPort}/ws`;
  }
  return `${protocol}://${window.location.host}/ws`;
};

export const normalizeRuntimeConfig = (runtimeConfig) => ({
  appUrl: runtimeConfig?.appUrl || '',
  graphqlEndpoint: runtimeConfig?.graphqlEndpoint || '/graphql',
  wsEndpoint: runtimeConfig?.wsEndpoint || getDefaultWsEndpoint(),
  runtimeBackend: String(runtimeConfig?.runtimeBackend || '').trim().toLowerCase() === 'go-master'
    ? 'go-master'
    : 'js',
});

export const normalizeRuntimeBackendInfo = (runtimeBackendInfo) => {
  const normalizedName = String(runtimeBackendInfo?.name || '').trim().toLowerCase() === 'go-master'
    ? 'go-master'
    : 'js';
  const normalizedMasterAgent = runtimeBackendInfo?.masterAgent && typeof runtimeBackendInfo.masterAgent === 'object'
    ? runtimeBackendInfo.masterAgent
    : null;

  return {
    name: normalizedName,
    displayName: String(runtimeBackendInfo?.displayName || '').trim() || (
      normalizedName === 'go-master' ? 'Go Master Agent' : 'JavaScript Runtime Manager'
    ),
    masterAgent: normalizedMasterAgent
      ? {
        socketPath: String(normalizedMasterAgent.socketPath || '').trim() || null,
        target: String(normalizedMasterAgent.target || '').trim() || null,
        service: String(normalizedMasterAgent.service || '').trim() || null,
        status: String(normalizedMasterAgent.status || '').trim() || null,
        connectionStatus: String(normalizedMasterAgent.connectionStatus || '').trim() || null,
        connectionHealth: String(normalizedMasterAgent.connectionHealth || '').trim() || null,
        lastConnectedAt: String(normalizedMasterAgent.lastConnectedAt || '').trim() || null,
        lastAttemptAt: String(normalizedMasterAgent.lastAttemptAt || '').trim() || null,
        reconnectAttempts: Number.isInteger(Number(normalizedMasterAgent.reconnectAttempts))
          ? Number(normalizedMasterAgent.reconnectAttempts)
          : 0,
        version: String(normalizedMasterAgent.version || '').trim() || null,
        protocolVersion: String(normalizedMasterAgent.protocolVersion || '').trim() || null,
        startedAt: String(normalizedMasterAgent.startedAt || '').trim() || null,
        capabilities: Array.isArray(normalizedMasterAgent.capabilities)
          ? normalizedMasterAgent.capabilities.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        grantedCapabilities: Array.isArray(normalizedMasterAgent.grantedCapabilities)
          ? normalizedMasterAgent.grantedCapabilities.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        error: String(normalizedMasterAgent.error || '').trim() || null,
      }
      : null,
  };
};

export const normalizeDiscoveryConfig = (discoveryConfig) => {
  const maxDepth = Number(discoveryConfig?.maxDepth);
  return {
    projectPath: String(discoveryConfig?.projectPath || '').trim(),
    folderPattern: String(discoveryConfig?.folderPattern || '').trim(),
    maxDepth: Number.isInteger(maxDepth) ? maxDepth : null,
  };
};

export const formatRuntimeDateTime = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '-';
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }
  return parsed.toLocaleString();
};

export const formatRuntimeList = (values) => (
  Array.isArray(values) && values.length > 0 ? values.join(', ') : '-'
);

export const normalizePortRangeSettings = (settings) => {
  const mode = String(settings?.mode || '').trim().toUpperCase() === PORT_RANGE_MODE.MANUAL
    ? PORT_RANGE_MODE.MANUAL
    : PORT_RANGE_MODE.AUTOMATIC;
  const begin = Number(settings?.begin);
  const normalizedBegin = (
    Number.isInteger(begin) &&
    begin >= PORT_RANGE_BEGIN_MIN &&
    begin <= PORT_RANGE_BEGIN_MAX
  )
    ? begin
    : null;
  if (mode === PORT_RANGE_MODE.MANUAL) {
    return { mode, begin: normalizedBegin };
  }
  return { mode: PORT_RANGE_MODE.AUTOMATIC, begin: null };
};
