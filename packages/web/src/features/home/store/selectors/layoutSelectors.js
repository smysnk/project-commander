import { normalizeWorkspacePanel } from '../../lib/workspacePanels.mjs';

const EMPTY_ARRAY = Object.freeze([]);

export const selectFollowLogs = (state) => state?.panelProjectExplorer?.isFollowMode ?? true;

export const selectEditorTheme = (state) => state?.userSettings?.style;

export const selectActiveWorkspacePanel = (state) => (
  normalizeWorkspacePanel(state?.uiInteractions?.activeWorkspacePanel)
);

export const selectDebugExpandedPaths = (state) => {
  const expandedPaths = state?.uiInteractions?.debugExpandedPaths;
  return Array.isArray(expandedPaths) ? expandedPaths : EMPTY_ARRAY;
};

export const selectError = (state) => String(state?.uiInteractions?.error || '');
