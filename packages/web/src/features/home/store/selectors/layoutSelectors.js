import { LEFT_PANEL_MODE } from '../../constants/ui';

const EMPTY_ARRAY = Object.freeze([]);

export const selectLeftWidthPct = (state) => state?.panelProjectList?.leftWidthPct ?? 50;

export const selectRightTab = (state) => state?.panelProjectExplorer?.mode || 'logs';

export const selectFollowLogs = (state) => state?.panelProjectExplorer?.isFollowMode ?? true;

export const selectEditorTheme = (state) => state?.userSettings?.style;

export const selectLeftPanelMode = (state) => {
  const leftPanelMode = String(state?.uiInteractions?.leftPanelMode || LEFT_PANEL_MODE.PROJECTS).trim().toLowerCase();
  return leftPanelMode || LEFT_PANEL_MODE.PROJECTS;
};

export const selectHostsSidebarCollapsed = (state) => Boolean(state?.uiInteractions?.hostsSidebarCollapsed);

export const selectHostsSidebarWidthPx = (state) => Number(state?.uiInteractions?.hostsSidebarWidthPx) || 360;

export const selectResizing = (state) => Boolean(state?.uiInteractions?.resizing);

export const selectDebugExpandedPaths = (state) => {
  const expandedPaths = state?.uiInteractions?.debugExpandedPaths;
  return Array.isArray(expandedPaths) ? expandedPaths : EMPTY_ARRAY;
};

export const selectError = (state) => String(state?.uiInteractions?.error || '');
