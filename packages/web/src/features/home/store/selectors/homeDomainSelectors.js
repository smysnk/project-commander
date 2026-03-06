import {
  PORT_RANGE_MODE,
} from '../../constants/ui';

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const DEFAULT_DISCOVERY_CONFIG = Object.freeze({
  projectPath: '',
  folderPattern: '',
  maxDepth: null,
});
const DEFAULT_RUNTIME_BACKEND_INFO = Object.freeze({
  name: 'js',
  displayName: 'JavaScript Runtime Manager',
  masterAgent: null,
});
const DEFAULT_PROJECT_PORT_RANGE_SETTINGS = Object.freeze({
  mode: PORT_RANGE_MODE.AUTOMATIC,
  begin: null,
});

export const selectHomeDomain = (state) => state?.homeDomain || EMPTY_OBJECT;

export const selectHomeProjects = (state) => {
  const projects = selectHomeDomain(state)?.projects;
  return Array.isArray(projects) ? projects : EMPTY_ARRAY;
};

export const selectHomeHosts = (state) => {
  const hosts = selectHomeDomain(state)?.hosts;
  return Array.isArray(hosts) ? hosts : EMPTY_ARRAY;
};

export const selectHomeHostsLoading = (state) => Boolean(selectHomeDomain(state)?.hostsLoading);

export const selectHomeTerminalSessionsByHostId = (state) => {
  const sessionsByHostId = selectHomeDomain(state)?.terminalSessionByHostId;
  return sessionsByHostId && typeof sessionsByHostId === 'object' ? sessionsByHostId : EMPTY_OBJECT;
};

export const selectHomeTerminalOutputBySessionId = (state) => {
  const outputBySessionId = selectHomeDomain(state)?.terminalOutputBySessionId;
  return outputBySessionId && typeof outputBySessionId === 'object' ? outputBySessionId : EMPTY_OBJECT;
};

export const selectHomeScannedAt = (state) => String(selectHomeDomain(state)?.scannedAt || '');

export const selectHomeDiscoveryConfig = (state) => {
  const discoveryConfig = selectHomeDomain(state)?.discoveryConfig;
  return discoveryConfig && typeof discoveryConfig === 'object'
    ? discoveryConfig
    : DEFAULT_DISCOVERY_CONFIG;
};

export const selectHomeLoading = (state) => Boolean(selectHomeDomain(state)?.loading);

export const selectHomeRuntimeBackendInfo = (state) => {
  const runtimeBackendInfo = selectHomeDomain(state)?.runtimeBackendInfo;
  return runtimeBackendInfo && typeof runtimeBackendInfo === 'object'
    ? runtimeBackendInfo
    : DEFAULT_RUNTIME_BACKEND_INFO;
};

export const selectHomeRuntimeBackendInfoLoading = (state) => (
  Boolean(selectHomeDomain(state)?.runtimeBackendInfoLoading)
);

export const selectHomeProjectLogs = (state) => {
  const entries = selectHomeDomain(state)?.projectLogs;
  return Array.isArray(entries) ? entries : EMPTY_ARRAY;
};

export const selectHomeOverlayLogs = (state) => {
  const entries = selectHomeDomain(state)?.overlayLogs;
  return Array.isArray(entries) ? entries : EMPTY_ARRAY;
};

export const selectHomeLogsQueryEntriesByContext = (state) => {
  const byContext = selectHomeDomain(state)?.logsQueryEntriesByContext;
  return byContext && typeof byContext === 'object' ? byContext : EMPTY_OBJECT;
};

export const selectHomeLogsLoading = (state) => Boolean(selectHomeDomain(state)?.logsLoading);

export const selectHomeProjectEnvironment = (state) => {
  const environment = selectHomeDomain(state)?.projectEnvironment;
  return Array.isArray(environment) ? environment : EMPTY_ARRAY;
};

export const selectHomeEnvironmentLoading = (state) => Boolean(selectHomeDomain(state)?.environmentLoading);

export const selectHomeProjectPortRangeSettings = (state) => {
  const projectPortRangeSettings = selectHomeDomain(state)?.projectPortRangeSettings;
  return projectPortRangeSettings && typeof projectPortRangeSettings === 'object'
    ? projectPortRangeSettings
    : DEFAULT_PROJECT_PORT_RANGE_SETTINGS;
};

export const selectHomeProjectPortRangeSettingsLoading = (state) => (
  Boolean(selectHomeDomain(state)?.projectPortRangeSettingsLoading)
);

export const selectHomeProjectPortRangeSettingsSaving = (state) => (
  Boolean(selectHomeDomain(state)?.projectPortRangeSettingsSaving)
);

export const selectHomeManualPortRangeInput = (state) => (
  String(selectHomeDomain(state)?.manualPortRangeInput || '')
);

export const selectHomeProjectProcessStats = (state) => {
  const processStats = selectHomeDomain(state)?.projectProcessStats;
  return Array.isArray(processStats) ? processStats : EMPTY_ARRAY;
};

export const selectHomeProcessStatsLoading = (state) => Boolean(selectHomeDomain(state)?.processStatsLoading);

export const selectHomeSeenLogServicesByProject = (state) => {
  const seen = selectHomeDomain(state)?.seenLogServicesByProject;
  return seen && typeof seen === 'object' ? seen : EMPTY_OBJECT;
};
