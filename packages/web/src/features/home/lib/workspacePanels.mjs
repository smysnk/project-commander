export const WORKSPACE_PANEL = {
  PROJECTS: 'projects',
  HOSTS: 'hosts',
  LOGS: 'logs',
  RUNTIME: 'runtime',
  TERMINAL: 'terminal',
  ENVIRONMENT: 'environment',
  TOP: 'top',
  DEBUG: 'debug',
};

export const WORKSPACE_PANEL_ORDER = [
  WORKSPACE_PANEL.PROJECTS,
  WORKSPACE_PANEL.HOSTS,
  WORKSPACE_PANEL.LOGS,
  WORKSPACE_PANEL.RUNTIME,
  WORKSPACE_PANEL.TERMINAL,
  WORKSPACE_PANEL.ENVIRONMENT,
  WORKSPACE_PANEL.TOP,
  WORKSPACE_PANEL.DEBUG,
];

export const WORKSPACE_PANEL_LABELS = {
  [WORKSPACE_PANEL.PROJECTS]: 'Projects',
  [WORKSPACE_PANEL.HOSTS]: 'Hosts',
  [WORKSPACE_PANEL.LOGS]: 'Logs',
  [WORKSPACE_PANEL.RUNTIME]: 'Runtime',
  [WORKSPACE_PANEL.TERMINAL]: 'Terminal',
  [WORKSPACE_PANEL.ENVIRONMENT]: 'Environment',
  [WORKSPACE_PANEL.TOP]: 'Top',
  [WORKSPACE_PANEL.DEBUG]: 'Debug',
};

const WORKSPACE_PANEL_SET = new Set(WORKSPACE_PANEL_ORDER);

const WORKSPACE_PANEL_BY_LEGACY_EXPLORER_MODE = {
  logs: WORKSPACE_PANEL.LOGS,
  runtime: WORKSPACE_PANEL.RUNTIME,
  terminal: WORKSPACE_PANEL.TERMINAL,
  environment: WORKSPACE_PANEL.ENVIRONMENT,
  top: WORKSPACE_PANEL.TOP,
  debug: WORKSPACE_PANEL.DEBUG,
};

const WORKSPACE_PANEL_BY_LEGACY_PANEL_MODE = {
  projects: WORKSPACE_PANEL.PROJECTS,
  runtime: WORKSPACE_PANEL.HOSTS,
  terminal: WORKSPACE_PANEL.TERMINAL,
};

export const normalizeWorkspacePanel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return WORKSPACE_PANEL_SET.has(normalized) ? normalized : WORKSPACE_PANEL.PROJECTS;
};

export const getWorkspacePanelFromLegacyState = ({
  activeWorkspacePanel,
  explorerMode,
  panelMode,
} = {}) => {
  if (typeof activeWorkspacePanel === 'string' && activeWorkspacePanel.trim()) {
    return normalizeWorkspacePanel(activeWorkspacePanel);
  }

  const normalizedExplorerMode = String(explorerMode || '').trim().toLowerCase();
  if (WORKSPACE_PANEL_BY_LEGACY_EXPLORER_MODE[normalizedExplorerMode]) {
    return WORKSPACE_PANEL_BY_LEGACY_EXPLORER_MODE[normalizedExplorerMode];
  }

  const normalizedPanelMode = String(panelMode || '').trim().toLowerCase();
  return WORKSPACE_PANEL_BY_LEGACY_PANEL_MODE[normalizedPanelMode] || WORKSPACE_PANEL.PROJECTS;
};
