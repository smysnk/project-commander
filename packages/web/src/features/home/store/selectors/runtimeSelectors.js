import { selectHomeRuntimeBackendInfo, selectHomeRuntimeBackendInfoLoading } from './homeDomainSelectors';

const DEFAULT_RUNTIME_CONFIG = Object.freeze({});

export const selectRuntimeConfig = (state) => {
  const runtimeConfig = state?.runtime?.config;
  return runtimeConfig && typeof runtimeConfig === 'object'
    ? runtimeConfig
    : DEFAULT_RUNTIME_CONFIG;
};

export const selectRuntimeBackendInfo = (state) => selectHomeRuntimeBackendInfo(state);

export const selectRuntimeBackendInfoLoading = (state) => selectHomeRuntimeBackendInfoLoading(state);

export const selectMasterAgent = (state) => selectRuntimeBackendInfo(state)?.masterAgent || null;

export const selectMasterAgentInfo = selectMasterAgent;

export const selectRuntimeBackendMode = (state) => {
  const runtimeConfigBackend = String(selectRuntimeConfig(state)?.runtimeBackend || '').trim().toLowerCase();
  const runtimeBackendName = String(selectRuntimeBackendInfo(state)?.name || '').trim().toLowerCase();
  return runtimeConfigBackend === 'go-master' || runtimeBackendName === 'go-master'
    ? 'go-master'
    : 'js';
};

export const selectIsGoMasterBackend = (state) => selectRuntimeBackendMode(state) === 'go-master';

export const selectSlaveTargetVersion = (state) => {
  const targetVersion = String(selectRuntimeConfig(state)?.slaveTargetVersion || '').trim();
  return targetVersion || null;
};
