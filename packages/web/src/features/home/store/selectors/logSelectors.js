import {
  selectHomeLogsLoading,
  selectHomeLogsQueryEntriesByContext,
  selectHomeOverlayLogs,
  selectHomeProjectLogs,
  selectHomeSeenLogServicesByProject,
} from './homeDomainSelectors';

const EMPTY_ARRAY = Object.freeze([]);

export const selectProjectLogs = (state) => selectHomeProjectLogs(state);

export const selectOverlayLogs = (state) => selectHomeOverlayLogs(state);

export const selectLogsQueryEntriesByContext = (state) => selectHomeLogsQueryEntriesByContext(state);

export const selectLogsLoading = (state) => selectHomeLogsLoading(state);

export const selectActiveLogContextKey = (state) => state?.uiInteractions?.activeLogContextKey || 'runtime';

export const selectSelectedLogServices = (state) => {
  const selected = state?.uiInteractions?.selectedLogServices;
  return Array.isArray(selected) ? selected : EMPTY_ARRAY;
};

export const selectDisabledLogLevels = (state) => {
  const disabled = state?.uiInteractions?.disabledLogLevels;
  return Array.isArray(disabled) ? disabled : EMPTY_ARRAY;
};

export const selectSeenLogServicesByProject = (state) => selectHomeSeenLogServicesByProject(state);
