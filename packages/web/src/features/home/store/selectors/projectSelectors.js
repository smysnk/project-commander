import {
  selectHomeDiscoveryConfig,
  selectHomeLoading,
  selectHomeProcessStatsLoading,
  selectHomeProjectEnvironment,
  selectHomeProjectPortRangeSettings,
  selectHomeProjectPortRangeSettingsLoading,
  selectHomeProjectPortRangeSettingsSaving,
  selectHomeProjectProcessStats,
  selectHomeScannedAt,
  selectHomeManualPortRangeInput,
  selectHomeEnvironmentLoading,
} from './homeDomainSelectors';

const EMPTY_ARRAY = Object.freeze([]);

export const selectProjects = (state) => {
  const projects = state?.homeDomain?.projects;
  return Array.isArray(projects) ? projects : EMPTY_ARRAY;
};

export const selectProjectsLoading = (state) => selectHomeLoading(state);

export const selectSelectedProjectPath = (state) => state?.panelProjectList?.selectedProjectPath || '';

export const selectSelectedProject = (state) => {
  const selectedProjectPath = String(selectSelectedProjectPath(state) || '').trim();
  if (!selectedProjectPath) {
    return null;
  }
  return selectProjects(state).find((project) => project?.path === selectedProjectPath) || null;
};

export const selectRunningProjectCount = (state) => (
  selectProjects(state).filter((project) => ['starting', 'started'].includes(project?.runtimeStatus)).length
);

export const selectScannedAt = (state) => selectHomeScannedAt(state);

export const selectDiscoveryConfig = (state) => selectHomeDiscoveryConfig(state);

export const selectProjectEnvironment = (state) => selectHomeProjectEnvironment(state);

export const selectEnvironmentLoading = (state) => selectHomeEnvironmentLoading(state);

export const selectProjectPortRangeSettings = (state) => selectHomeProjectPortRangeSettings(state);

export const selectProjectPortRangeSettingsLoading = (state) => selectHomeProjectPortRangeSettingsLoading(state);

export const selectProjectPortRangeSettingsSaving = (state) => selectHomeProjectPortRangeSettingsSaving(state);

export const selectManualPortRangeInput = (state) => selectHomeManualPortRangeInput(state);

export const selectProjectProcessStats = (state) => selectHomeProjectProcessStats(state);

export const selectProcessStatsLoading = (state) => selectHomeProcessStatsLoading(state);
