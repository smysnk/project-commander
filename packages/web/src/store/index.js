import { applyMiddleware, compose, createStore } from 'redux';
import { useRef } from 'react';
import {
  EditorThemeEnum,
  defaultEditorTheme,
  defaultEditorThemes,
} from '../components/editorThemeRegistry';
import logQueryProtocol from '../lib/logQueryProtocol';
import {
  MAX_OVERLAY_LOG_ENTRIES,
  MAX_PROJECT_LOG_ENTRIES,
  WORKSPACE_PANEL,
} from '../features/home/constants/ui';
import { normalizeWorkspacePanel } from '../features/home/lib/workspacePanels.mjs';
import { normalizeLogLevelName } from '../features/home/lib/logTransforms';
import { normalizeRuntimeBackendInfo } from '../features/home/lib/runtimeTransforms';
import {
  buildRuntimeConnectionFingerprint,
  normalizeOverlayLogEntry,
  toIsoTimestamp,
} from './realtimeStateHelpers.mjs';

const SET_RUNTIME_CONFIG = 'SET_RUNTIME_CONFIG';
const SET_HOME_DOMAIN_PATCH = 'SET_HOME_DOMAIN_PATCH';
const SET_HOME_DOMAIN_FIELD = 'SET_HOME_DOMAIN_FIELD';
const SET_USER_STYLE = 'SET_USER_STYLE';
const SET_PANEL_PROJECT_LIST_SELECTED_PROJECT = 'SET_PANEL_PROJECT_LIST_SELECTED_PROJECT';
const SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE = 'SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE';
const SET_UI_ACTIVE_WORKSPACE_PANEL = 'SET_UI_ACTIVE_WORKSPACE_PANEL';
const SET_UI_SELECTED_HOST_ID = 'SET_UI_SELECTED_HOST_ID';
const SET_UI_ACTIVE_LOG_CONTEXT_KEY = 'SET_UI_ACTIVE_LOG_CONTEXT_KEY';
const SET_UI_SELECTED_LOG_SERVICES = 'SET_UI_SELECTED_LOG_SERVICES';
const SET_UI_DISABLED_LOG_LEVELS = 'SET_UI_DISABLED_LOG_LEVELS';
const SET_UI_ERROR = 'SET_UI_ERROR';
const SET_UI_DEBUG_EXPANDED_PATHS = 'SET_UI_DEBUG_EXPANDED_PATHS';
const APPEND_HOME_OVERLAY_LOG = 'APPEND_HOME_OVERLAY_LOG';
const APPEND_HOME_OVERLAY_LOGS = 'APPEND_HOME_OVERLAY_LOGS';
const APPEND_HOME_PROJECT_LOG = 'APPEND_HOME_PROJECT_LOG';
const MERGE_HOME_RUNTIME_BACKEND_INFO = 'MERGE_HOME_RUNTIME_BACKEND_INFO';
const APPLY_HOME_RUNTIME_PROJECT_UPDATE = 'APPLY_HOME_RUNTIME_PROJECT_UPDATE';
const HOME_REALTIME_CONNECT = 'HOME_REALTIME_CONNECT';
const HOME_REALTIME_DISCONNECT = 'HOME_REALTIME_DISCONNECT';
const HOME_REALTIME_REQUEST_LOG_WINDOW = 'HOME_REALTIME_REQUEST_LOG_WINDOW';
const USER_SETTINGS_STORAGE_KEY = 'project-discovery:user-settings';
const USER_SETTINGS_STYLE_COOKIE = 'user_settings_style';
const PANEL_STATE_STORAGE_KEY = 'project-discovery:panel-state';

export const setRuntimeConfig = (payload) => ({
  type: SET_RUNTIME_CONFIG,
  payload,
});

export const setHomeDomainPatch = (patch) => ({
  type: SET_HOME_DOMAIN_PATCH,
  patch,
});

export const setHomeDomainField = (field, value) => ({
  type: SET_HOME_DOMAIN_FIELD,
  field,
  value,
});

export const setUserStyle = (style) => ({
  type: SET_USER_STYLE,
  style,
});

export const setPanelProjectListSelectedProject = (projectPath) => ({
  type: SET_PANEL_PROJECT_LIST_SELECTED_PROJECT,
  projectPath,
});

export const setPanelProjectExplorerFollowMode = (isFollowMode) => ({
  type: SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE,
  isFollowMode,
});

export const setUiActiveWorkspacePanel = (activeWorkspacePanel) => ({
  type: SET_UI_ACTIVE_WORKSPACE_PANEL,
  activeWorkspacePanel,
});

export const setUiSelectedHostId = (selectedHostId) => ({
  type: SET_UI_SELECTED_HOST_ID,
  selectedHostId,
});

export const setUiActiveLogContextKey = (activeLogContextKey) => ({
  type: SET_UI_ACTIVE_LOG_CONTEXT_KEY,
  activeLogContextKey,
});

export const setUiSelectedLogServices = (selectedLogServices) => ({
  type: SET_UI_SELECTED_LOG_SERVICES,
  selectedLogServices,
});

export const setUiDisabledLogLevels = (disabledLogLevels) => ({
  type: SET_UI_DISABLED_LOG_LEVELS,
  disabledLogLevels,
});

export const setUiError = (error) => ({
  type: SET_UI_ERROR,
  error,
});

export const setUiDebugExpandedPaths = (debugExpandedPaths) => ({
  type: SET_UI_DEBUG_EXPANDED_PATHS,
  debugExpandedPaths,
});

export const appendHomeOverlayLog = (entry) => ({
  type: APPEND_HOME_OVERLAY_LOG,
  entry,
});

export const appendHomeOverlayLogs = (entries) => ({
  type: APPEND_HOME_OVERLAY_LOGS,
  entries,
});

export const appendHomeProjectLog = ({ entry, selectedProjectPath } = {}) => ({
  type: APPEND_HOME_PROJECT_LOG,
  entry,
  selectedProjectPath,
});

export const mergeHomeRuntimeBackendInfo = (connection) => ({
  type: MERGE_HOME_RUNTIME_BACKEND_INFO,
  connection,
});

export const applyHomeRuntimeProjectUpdate = (update) => ({
  type: APPLY_HOME_RUNTIME_PROJECT_UPDATE,
  update,
});

export const connectHomeRealtime = (wsEndpoint) => ({
  type: HOME_REALTIME_CONNECT,
  wsEndpoint: String(wsEndpoint || ''),
});

export const disconnectHomeRealtime = () => ({
  type: HOME_REALTIME_DISCONNECT,
});

export const requestHomeRealtimeLogWindow = ({ context, streams } = {}) => ({
  type: HOME_REALTIME_REQUEST_LOG_WINDOW,
  context,
  streams,
});

const UI_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const normalizePanelExplorerFollowMode = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  return true;
};

const normalizeUiActiveWorkspacePanel = (value) => normalizeWorkspacePanel(value);

const normalizeUiSelectedHostId = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  const asNumber = Number.parseInt(String(value).trim(), 10);
  if (Number.isInteger(asNumber) && asNumber > 0 && String(value).trim() === String(asNumber)) {
    return asNumber;
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const normalizeUiActiveLogContextKey = (value) => {
  const normalized = String(value || '').trim();
  return normalized || 'runtime';
};

const normalizeUiSelectedLogServices = (value) => {
  const source = Array.isArray(value) ? value : [];
  const next = [];
  const seen = new Set();
  for (const entry of source) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const normalizeUiDisabledLogLevels = (value) => {
  const source = Array.isArray(value) ? value : [];
  const next = [];
  const seen = new Set();
  for (const entry of source) {
    const normalized = String(entry || '').trim().toLowerCase();
    if (!UI_LOG_LEVELS.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const normalizeUiError = (value) => String(value || '');

const normalizeUiDebugExpandedPaths = (value) => {
  const source = Array.isArray(value) ? value : [];
  const next = [];
  const seen = new Set();
  for (const entry of source) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
};

const toPersistedUiInteractions = (uiInteractions = {}) => ({
  activeWorkspacePanel: normalizeUiActiveWorkspacePanel(uiInteractions?.activeWorkspacePanel),
  selectedHostId: normalizeUiSelectedHostId(uiInteractions?.selectedHostId),
  activeLogContextKey: normalizeUiActiveLogContextKey(uiInteractions?.activeLogContextKey),
  selectedLogServices: normalizeUiSelectedLogServices(uiInteractions?.selectedLogServices),
  disabledLogLevels: normalizeUiDisabledLogLevels(uiInteractions?.disabledLogLevels),
});

const getDefaultWsEndpoint = () => {
  const explicitWsUrl = String(process.env.NEXT_PUBLIC_WS_URL || '').trim();
  if (explicitWsUrl) {
    return explicitWsUrl;
  }

  const configuredServerPort = Number.parseInt(
    String(process.env.NEXT_PUBLIC_SERVER_PORT || '').trim(),
    10,
  );
  const hasConfiguredServerPort = Number.isInteger(configuredServerPort) && configuredServerPort > 0;

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostName = window.location.hostname;
    if (hasConfiguredServerPort) {
      return `${protocol}://${hostName}:${configuredServerPort}/ws`;
    }
    return `${protocol}://${window.location.host}/ws`;
  }

  return `ws://localhost:${hasConfiguredServerPort ? configuredServerPort : 4000}/ws`;
};

const getSystemPreferredTheme = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return defaultEditorTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? EditorThemeEnum.GITHUB_DARK
    : EditorThemeEnum.GITHUB_LIGHT;
};

export const resolveClientThemePreference = () => {
  if (typeof window !== 'undefined') {
    const cookieEntry = document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${USER_SETTINGS_STYLE_COOKIE}=`));
    if (cookieEntry) {
      const cookieValue = decodeURIComponent(cookieEntry.split('=').slice(1).join('='));
      if (defaultEditorThemes.includes(cookieValue)) {
        return cookieValue;
      }
    }

    try {
      const raw = window.localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (defaultEditorThemes.includes(parsed?.style)) {
          return parsed.style;
        }
      }
    } catch {
      // ignore invalid storage data
    }

    return getSystemPreferredTheme();
  }

  return defaultEditorTheme;
};

const getInitialTheme = () => defaultEditorTheme;

const getInitialPanelProjectList = () => {
  return {
    selectedProjectPath: '',
  };
};

const getInitialPanelProjectExplorer = () => {
  return {
    isFollowMode: true,
  };
};

const getInitialUiInteractions = () => {
  return {
    activeWorkspacePanel: WORKSPACE_PANEL.PROJECTS,
    selectedHostId: 'master-agent',
    activeLogContextKey: 'runtime',
    selectedLogServices: [],
    disabledLogLevels: [],
    error: '',
    debugExpandedPaths: [],
  };
};

const getInitialHomeDomain = () => ({
  projects: [],
  hosts: [],
  hostsLoading: false,
  showAddHostRow: false,
  manualHostIp: '',
  addingHost: false,
  deletingHostId: null,
  upgradingHostId: null,
  showAddDirectoryRowByHostId: {},
  directoryInputByHostId: {},
  directoryMutationBusyByHostId: {},
  showCheckoutRowByHostId: {},
  checkoutRepoInputByHostId: {},
  checkoutBaseDirectoryByHostId: {},
  checkoutDestinationByHostId: {},
  checkoutAutoDestinationByHostId: {},
  checkoutMutationBusyByHostId: {},
  terminalInputByHostId: {},
  terminalStartingByHostId: {},
  terminalSendingByHostId: {},
  terminalSessionByHostId: {},
  terminalOutputBySessionId: {},
  scannedAt: '',
  discoveryConfig: {
    projectPath: '',
    folderPattern: '',
    maxDepth: null,
  },
  loading: true,
  runtimeBackendInfo: {
    name: 'js',
    displayName: 'JavaScript Runtime Manager',
    masterAgent: null,
  },
  runtimeBackendInfoLoading: false,
  projectLogs: [],
  overlayLogs: [],
  logsQueryEntriesByContext: {},
  logsLoading: false,
  projectEnvironment: [],
  environmentLoading: false,
  projectPortRangeSettings: {
    mode: 'AUTOMATIC',
    begin: null,
  },
  projectPortRangeSettingsLoading: false,
  projectPortRangeSettingsSaving: false,
  manualPortRangeInput: '',
  projectProcessStats: [],
  processStatsLoading: false,
  seenLogServicesByProject: {},
});

const initialState = {
  settings: {
    themes: defaultEditorThemes,
  },
  userSettings: {
    style: getInitialTheme(),
  },
  panelProjectList: getInitialPanelProjectList(),
  panelProjectExplorer: getInitialPanelProjectExplorer(),
  uiInteractions: getInitialUiInteractions(),
  homeDomain: getInitialHomeDomain(),
  runtime: {
    loaded: false,
    config: {
      graphqlEndpoint: '/graphql',
      wsEndpoint: getDefaultWsEndpoint(),
    },
  },
};

function reducer(state = initialState, action) {
  switch (action.type) {
    case SET_HOME_DOMAIN_PATCH:
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          ...(
            action.patch && typeof action.patch === 'object' && !Array.isArray(action.patch)
              ? action.patch
              : {}
          ),
        },
      };
    case SET_HOME_DOMAIN_FIELD: {
      const field = String(action.field || '').trim();
      if (!field) {
        return state;
      }
      if (typeof action.value === 'function') {
        if (process.env.NODE_ENV !== 'production') {
          // Enforce serializable actions for predictable replay/debugging.
          console.warn(`Ignored non-serializable setHomeDomainField("${field}") update.`);
        }
        return state;
      }
      const currentValue = state.homeDomain?.[field];
      const nextValue = action.value;
      if (currentValue === nextValue) {
        return state;
      }
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          [field]: nextValue,
        },
      };
    }
    case APPEND_HOME_OVERLAY_LOG: {
      const entry = action.entry && typeof action.entry === 'object' ? action.entry : null;
      if (!entry) {
        return state;
      }
      const current = Array.isArray(state.homeDomain?.overlayLogs) ? state.homeDomain.overlayLogs : [];
      const next = [...current, entry];
      const bounded = next.length > MAX_OVERLAY_LOG_ENTRIES
        ? next.slice(next.length - MAX_OVERLAY_LOG_ENTRIES)
        : next;
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          overlayLogs: bounded,
        },
      };
    }
    case APPEND_HOME_OVERLAY_LOGS: {
      const entries = Array.isArray(action.entries)
        ? action.entries.filter((entry) => entry && typeof entry === 'object')
        : [];
      if (entries.length <= 0) {
        return state;
      }
      const current = Array.isArray(state.homeDomain?.overlayLogs) ? state.homeDomain.overlayLogs : [];
      const next = [...current, ...entries];
      const bounded = next.length > MAX_OVERLAY_LOG_ENTRIES
        ? next.slice(next.length - MAX_OVERLAY_LOG_ENTRIES)
        : next;
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          overlayLogs: bounded,
        },
      };
    }
    case APPEND_HOME_PROJECT_LOG: {
      const entry = action.entry && typeof action.entry === 'object' ? action.entry : null;
      if (!entry) {
        return state;
      }
      const targetProjectPath = String(action.selectedProjectPath || '').trim();
      const entryProjectPath = String(entry.projectPath || '').trim();
      if (!targetProjectPath || !entryProjectPath || targetProjectPath !== entryProjectPath) {
        return state;
      }
      const current = Array.isArray(state.homeDomain?.projectLogs) ? state.homeDomain.projectLogs : [];
      const normalizedId = String(entry.id || '').trim();
      if (!normalizedId) {
        return state;
      }
      const hasDuplicate = current.some((logEntry) => String(logEntry?.id || '').trim() === normalizedId);
      if (hasDuplicate) {
        return state;
      }
      const next = [...current, entry];
      const bounded = next.length > MAX_PROJECT_LOG_ENTRIES
        ? next.slice(next.length - MAX_PROJECT_LOG_ENTRIES)
        : next;
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          projectLogs: bounded,
        },
      };
    }
    case MERGE_HOME_RUNTIME_BACKEND_INFO: {
      const connection = action.connection && typeof action.connection === 'object'
        ? action.connection
        : null;
      if (!connection) {
        return state;
      }
      const normalizedCurrent = normalizeRuntimeBackendInfo(state.homeDomain?.runtimeBackendInfo);
      const currentMasterAgent = normalizedCurrent.masterAgent || {};
      const nextRuntimeBackendInfo = normalizeRuntimeBackendInfo({
        ...normalizedCurrent,
        name: 'go-master',
        masterAgent: {
          ...currentMasterAgent,
          socketPath: connection.socketPath ?? currentMasterAgent.socketPath ?? null,
          target: connection.target ?? currentMasterAgent.target ?? null,
          service: connection.service ?? currentMasterAgent.service ?? null,
          status: connection.status ?? currentMasterAgent.status ?? null,
          connectionStatus: connection.connectionStatus ?? currentMasterAgent.connectionStatus ?? null,
          connectionHealth: connection.connectionHealth ?? currentMasterAgent.connectionHealth ?? null,
          lastConnectedAt: connection.lastConnectedAt ?? currentMasterAgent.lastConnectedAt ?? null,
          lastAttemptAt: connection.lastAttemptAt ?? currentMasterAgent.lastAttemptAt ?? null,
          reconnectAttempts: Number.isInteger(Number(connection.reconnectAttempts))
            ? Number(connection.reconnectAttempts)
            : (currentMasterAgent.reconnectAttempts || 0),
          version: connection.version ?? currentMasterAgent.version ?? null,
          protocolVersion: connection.protocolVersion ?? currentMasterAgent.protocolVersion ?? null,
          startedAt: connection.startedAt ?? currentMasterAgent.startedAt ?? null,
          capabilities: Array.isArray(connection.capabilities)
            ? connection.capabilities
            : (currentMasterAgent.capabilities || []),
          grantedCapabilities: Array.isArray(connection.grantedCapabilities)
            ? connection.grantedCapabilities
            : (currentMasterAgent.grantedCapabilities || []),
          error: connection.error ?? currentMasterAgent.error ?? null,
        },
      });
      if (JSON.stringify(normalizedCurrent) === JSON.stringify(nextRuntimeBackendInfo)) {
        return state;
      }
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          runtimeBackendInfo: nextRuntimeBackendInfo,
        },
      };
    }
    case APPLY_HOME_RUNTIME_PROJECT_UPDATE: {
      const update = action.update && typeof action.update === 'object' ? action.update : null;
      const projectPath = String(update?.projectPath || '').trim();
      if (!projectPath) {
        return state;
      }
      const currentProjects = Array.isArray(state.homeDomain?.projects) ? state.homeDomain.projects : [];
      let changed = false;
      const nextProjects = currentProjects.map((project) => {
        if (String(project?.path || '').trim() !== projectPath) {
          return project;
        }
        const nextProject = {
          ...project,
          runtimeStatus: update.status,
          runtimePid: update.pid,
          runtimePorts: update.ports || [],
          runtimePortRangeBegin: update.portRangeBegin ?? null,
          runtimePortRangeEnd: update.portRangeEnd ?? null,
          runtimeServicePorts: update.servicePorts || {},
          runtimeServicePids: update.servicePids || {},
          runtimeServiceStates: update.serviceStates || {},
          runtimeServiceEntries: update.serviceRuntimeEntries || [],
          runtimeLastExitCode: update.lastExitCode ?? null,
        };
        if (JSON.stringify(project) === JSON.stringify(nextProject)) {
          return project;
        }
        changed = true;
        return nextProject;
      });
      if (!changed) {
        return state;
      }
      return {
        ...state,
        homeDomain: {
          ...state.homeDomain,
          projects: nextProjects,
        },
      };
    }
    case SET_USER_STYLE:
      if (!state.settings.themes.includes(action.style)) {
        return state;
      }
      return {
        ...state,
        userSettings: {
          ...state.userSettings,
          style: action.style,
        },
      };
    case SET_RUNTIME_CONFIG:
      return {
        ...state,
        runtime: {
          loaded: true,
          config: {
            ...state.runtime.config,
            ...(action.payload?.config || action.payload || {}),
            graphqlEndpoint:
              (action.payload?.config || action.payload || {}).graphqlEndpoint ||
              state.runtime.config.graphqlEndpoint ||
              '/graphql',
            wsEndpoint:
              (action.payload?.config || action.payload || {}).wsEndpoint ||
              state.runtime.config.wsEndpoint ||
              getDefaultWsEndpoint(),
          },
        },
      };
    case SET_PANEL_PROJECT_LIST_SELECTED_PROJECT:
      return {
        ...state,
        panelProjectList: {
          ...state.panelProjectList,
          selectedProjectPath:
            typeof action.projectPath === 'string' ? action.projectPath : state.panelProjectList.selectedProjectPath,
        },
      };
    case SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE:
      return {
        ...state,
        panelProjectExplorer: {
          ...state.panelProjectExplorer,
          isFollowMode: normalizePanelExplorerFollowMode(action.isFollowMode),
        },
      };
    case SET_UI_ACTIVE_WORKSPACE_PANEL:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          activeWorkspacePanel: normalizeUiActiveWorkspacePanel(action.activeWorkspacePanel),
        },
      };
    case SET_UI_SELECTED_HOST_ID:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          selectedHostId: normalizeUiSelectedHostId(action.selectedHostId),
        },
      };
    case SET_UI_ACTIVE_LOG_CONTEXT_KEY:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          activeLogContextKey: normalizeUiActiveLogContextKey(action.activeLogContextKey),
        },
      };
    case SET_UI_SELECTED_LOG_SERVICES:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          selectedLogServices: normalizeUiSelectedLogServices(action.selectedLogServices),
        },
      };
    case SET_UI_DISABLED_LOG_LEVELS:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          disabledLogLevels: normalizeUiDisabledLogLevels(action.disabledLogLevels),
        },
      };
    case SET_UI_ERROR:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          error: normalizeUiError(action.error),
        },
      };
    case SET_UI_DEBUG_EXPANDED_PATHS:
      return {
        ...state,
        uiInteractions: {
          ...state.uiInteractions,
          debugExpandedPaths: normalizeUiDebugExpandedPaths(action.debugExpandedPaths),
        },
      };
    default:
      return state;
  }
}

function mergeInitialState(preloadedState) {
  return {
    ...initialState,
    ...(preloadedState || {}),
    settings: {
      ...initialState.settings,
      ...(preloadedState?.settings || {}),
    },
    userSettings: {
      ...initialState.userSettings,
      ...(preloadedState?.userSettings || {}),
    },
    panelProjectList: {
      ...initialState.panelProjectList,
      ...(preloadedState?.panelProjectList || {}),
      selectedProjectPath:
        typeof preloadedState?.panelProjectList?.selectedProjectPath === 'string'
          ? preloadedState.panelProjectList.selectedProjectPath
          : initialState.panelProjectList.selectedProjectPath,
    },
    panelProjectExplorer: {
      ...initialState.panelProjectExplorer,
      ...(preloadedState?.panelProjectExplorer || {}),
      isFollowMode: normalizePanelExplorerFollowMode(
        preloadedState?.panelProjectExplorer?.isFollowMode ?? initialState.panelProjectExplorer.isFollowMode,
      ),
    },
    uiInteractions: {
      activeWorkspacePanel: normalizeUiActiveWorkspacePanel(
        preloadedState?.uiInteractions?.activeWorkspacePanel ?? initialState.uiInteractions.activeWorkspacePanel,
      ),
      selectedHostId: normalizeUiSelectedHostId(
        preloadedState?.uiInteractions?.selectedHostId ?? initialState.uiInteractions.selectedHostId,
      ),
      activeLogContextKey: normalizeUiActiveLogContextKey(
        preloadedState?.uiInteractions?.activeLogContextKey ?? initialState.uiInteractions.activeLogContextKey,
      ),
      selectedLogServices: normalizeUiSelectedLogServices(
        preloadedState?.uiInteractions?.selectedLogServices ?? initialState.uiInteractions.selectedLogServices,
      ),
      disabledLogLevels: normalizeUiDisabledLogLevels(
        preloadedState?.uiInteractions?.disabledLogLevels ?? initialState.uiInteractions.disabledLogLevels,
      ),
      error: normalizeUiError(
        preloadedState?.uiInteractions?.error ?? initialState.uiInteractions.error,
      ),
      debugExpandedPaths: normalizeUiDebugExpandedPaths(
        preloadedState?.uiInteractions?.debugExpandedPaths ?? initialState.uiInteractions.debugExpandedPaths,
      ),
    },
    homeDomain: {
      ...initialState.homeDomain,
      ...(preloadedState?.homeDomain || {}),
    },
    runtime: {
      ...initialState.runtime,
      ...(preloadedState?.runtime || {}),
      config: {
        ...initialState.runtime.config,
        ...(preloadedState?.runtime?.config || {}),
      },
    },
  };
}

const {
  buildLogsQueryMessage,
  normalizeLogsQueryResult,
} = logQueryProtocol;

const WEBSOCKET_DISCONNECTED_ERROR = 'Websocket disconnected; reconnecting...';
const WEBSOCKET_UNAUTHORIZED_CLOSE_CODES = new Set([4401, 4403]);
const DEPLOY_SUDO_PASSWORD_PROMPT_TIMEOUT_SECONDS_FALLBACK = 120;
const DEPLOY_SUDO_PASSWORD_PROMPT_TITLE = 'Project Commander requires sudo access to install or update a slave service.';
const OVERLAY_LOG_FLUSH_DELAY_MS = 100;

const redirectToLogin = (error = 'SessionExpired') => {
  if (typeof window === 'undefined') {
    return;
  }
  const currentPath = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
  const params = new URLSearchParams();
  params.set('error', String(error || 'SessionExpired'));
  if (currentPath && currentPath !== '/login') {
    params.set('callbackUrl', currentPath);
  }
  window.location.assign(`/login?${params.toString()}`);
};

const redirectToUnauthorized = () => {
  if (typeof window === 'undefined') {
    return;
  }
  window.location.assign('/access-denied');
};

const appendOverlayLogEntry = (storeApi, entry, { overlaySeedRef }) => {
  const nextEntry = normalizeOverlayLogEntry(entry, {
    id: `overlay-${overlaySeedRef.current}`,
  });
  if (!nextEntry) {
    return;
  }
  overlaySeedRef.current += 1;
  storeApi.dispatch(appendHomeOverlayLog(nextEntry));
};

const appendProjectLogEntry = (storeApi, entry, { projectLogSeedRef }) => {
  const projectPath = String(entry?.projectPath || '').trim();
  const serviceName = String(entry?.serviceName || '').trim();
  const message = String(entry?.message || '').trimEnd();
  if (!projectPath || !serviceName || !message) {
    return;
  }
  const stream = String(entry?.stream || 'stdout').trim().toLowerCase();
  const normalizedStream = (
    stream === 'stdout' || stream === 'stderr' || stream === 'system'
  )
    ? stream
    : 'stdout';
  const nextId = String(entry?.id || `project-log-${Date.now()}-${projectLogSeedRef.current}`).trim();
  projectLogSeedRef.current += 1;
  const nextEntry = {
    id: nextId,
    projectPath,
    timestamp: toIsoTimestamp(entry?.timestamp),
    serviceName,
    level: normalizeLogLevelName(entry?.level),
    stream: normalizedStream,
    message,
  };

  const selectedProjectPath = String(storeApi.getState()?.panelProjectList?.selectedProjectPath || '').trim();
  if (!selectedProjectPath || selectedProjectPath !== projectPath) {
    return;
  }

  storeApi.dispatch(appendHomeProjectLog({
    entry: nextEntry,
    selectedProjectPath,
  }));
};

const normalizeDeployActionLabel = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'upgrade') {
    return 'upgrade';
  }
  if (normalized === 'redeploy' || normalized === 're-deploy') {
    return 're-deploy';
  }
  return 'deployment';
};

const buildDeploySudoPromptMessage = ({
  hostName = null,
  hostIp = null,
  deploymentAction = 'deployment',
  timeoutSeconds = DEPLOY_SUDO_PASSWORD_PROMPT_TIMEOUT_SECONDS_FALLBACK,
} = {}) => {
  const normalizedHostName = String(hostName || '').trim();
  const normalizedHostIp = String(hostIp || '').trim();
  const hostLabel = normalizedHostName || normalizedHostIp || 'selected host';
  const actionLabel = normalizeDeployActionLabel(deploymentAction);
  const timeout = Number.isInteger(Number(timeoutSeconds)) && Number(timeoutSeconds) > 0
    ? Number(timeoutSeconds)
    : DEPLOY_SUDO_PASSWORD_PROMPT_TIMEOUT_SECONDS_FALLBACK;

  return [
    DEPLOY_SUDO_PASSWORD_PROMPT_TITLE,
    '',
    `Host: ${hostLabel}`,
    `Action: ${actionLabel}`,
    `Timeout: ${timeout}s`,
    '',
    'Enter sudo password:',
  ].join('\n');
};

const isDeploySudoChallengeExpired = ({
  requestedAt = null,
  timeoutSeconds = DEPLOY_SUDO_PASSWORD_PROMPT_TIMEOUT_SECONDS_FALLBACK,
} = {}) => {
  const parsedRequestedAt = Date.parse(String(requestedAt || ''));
  const timeout = Number.isInteger(Number(timeoutSeconds)) && Number(timeoutSeconds) > 0
    ? Number(timeoutSeconds)
    : DEPLOY_SUDO_PASSWORD_PROMPT_TIMEOUT_SECONDS_FALLBACK;
  if (Number.isNaN(parsedRequestedAt)) {
    return false;
  }
  return Date.now() > (parsedRequestedAt + timeout * 1000);
};

const realtimeMiddleware = (storeApi) => {
  const wsRef = { current: null };
  const reconnectTimerRef = { current: null };
  const disconnectTimerRef = { current: null };
  const runtimeConnectionFlushTimerRef = { current: null };
  const overlayLogFlushTimerRef = { current: null };
  const pendingOverlayLogsRef = { current: [] };
  const pendingRuntimeConnectionRef = { current: null };
  const lastRuntimeConnectionFingerprintRef = { current: '' };
  const lastRuntimeConnectionStatusRef = { current: '' };
  const retryCountRef = { current: 0 };
  const lastEventIdRef = { current: '' };
  const logQuerySequenceRef = { current: 0 };
  const overlaySeedRef = { current: 1 };
  const projectLogSeedRef = { current: 1 };
  const promptedSudoChallengeIdsRef = { current: new Set() };
  const pendingSudoChallengeIdsRef = { current: new Set() };
  const endpointRef = { current: '' };
  const isManualDisconnectRef = { current: false };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const clearDisconnectTimer = () => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  };

  const clearRuntimeConnectionFlushTimer = () => {
    if (runtimeConnectionFlushTimerRef.current) {
      clearTimeout(runtimeConnectionFlushTimerRef.current);
      runtimeConnectionFlushTimerRef.current = null;
    }
  };
  const clearOverlayLogFlushTimer = () => {
    if (overlayLogFlushTimerRef.current) {
      clearTimeout(overlayLogFlushTimerRef.current);
      overlayLogFlushTimerRef.current = null;
    }
  };
  const flushOverlayLogs = () => {
    overlayLogFlushTimerRef.current = null;
    const pendingEntries = pendingOverlayLogsRef.current;
    pendingOverlayLogsRef.current = [];
    if (!Array.isArray(pendingEntries) || pendingEntries.length <= 0) {
      return;
    }
    storeApi.dispatch(appendHomeOverlayLogs(pendingEntries));
  };
  const scheduleOverlayLogFlush = (immediate = false) => {
    if (immediate) {
      clearOverlayLogFlushTimer();
      flushOverlayLogs();
      return;
    }
    if (overlayLogFlushTimerRef.current) {
      return;
    }
    overlayLogFlushTimerRef.current = setTimeout(() => {
      flushOverlayLogs();
    }, OVERLAY_LOG_FLUSH_DELAY_MS);
  };
  const enqueueOverlayLogEntry = (entry) => {
    const normalizedEntry = normalizeOverlayLogEntry(entry, {
      id: `overlay-${overlaySeedRef.current}`,
    });
    if (!normalizedEntry) {
      return;
    }
    overlaySeedRef.current += 1;
    pendingOverlayLogsRef.current = [...pendingOverlayLogsRef.current, normalizedEntry];
    scheduleOverlayLogFlush(pendingOverlayLogsRef.current.length >= 20);
  };

  const flushRuntimeConnection = () => {
    runtimeConnectionFlushTimerRef.current = null;
    const pending = pendingRuntimeConnectionRef.current;
    pendingRuntimeConnectionRef.current = null;
    if (!pending || typeof pending !== 'object') {
      return;
    }
    const fingerprint = buildRuntimeConnectionFingerprint(pending);
    if (!fingerprint || fingerprint === lastRuntimeConnectionFingerprintRef.current) {
      return;
    }
    lastRuntimeConnectionFingerprintRef.current = fingerprint;
    lastRuntimeConnectionStatusRef.current = String(pending.connectionStatus || '').trim().toLowerCase();
    storeApi.dispatch(mergeHomeRuntimeBackendInfo(pending));
  };

  const scheduleRuntimeConnectionFlush = (immediate = false) => {
    if (immediate) {
      clearRuntimeConnectionFlushTimer();
      flushRuntimeConnection();
      return;
    }
    if (runtimeConnectionFlushTimerRef.current) {
      return;
    }
    runtimeConnectionFlushTimerRef.current = setTimeout(() => {
      flushRuntimeConnection();
    }, 300);
  };

  const closeSocket = () => {
    flushOverlayLogs();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const resolveEndpoint = (wsEndpoint) => {
    const rawEndpoint = String(wsEndpoint || '').trim();
    if (!rawEndpoint || typeof window === 'undefined') {
      return '';
    }
    if (rawEndpoint.startsWith('/')) {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${window.location.host}${rawEndpoint}`;
    }
    return rawEndpoint;
  };

  const scheduleReconnect = () => {
    if (isManualDisconnectRef.current) {
      return;
    }
    clearReconnectTimer();
    const retry = retryCountRef.current;
    const delayMs = Math.min(10000, 750 * (retry + 1));
    reconnectTimerRef.current = setTimeout(() => {
      connectSocket(endpointRef.current);
    }, delayMs);
    retryCountRef.current = retry + 1;
  };

  const sendDeploySudoPasswordMessage = ({ action, challengeId, password = '' } = {}) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const normalizedChallengeId = String(challengeId || '').trim();
    if (!normalizedChallengeId) {
      return false;
    }
    const payload = {
      action: String(action || '').trim(),
      challengeId: normalizedChallengeId,
    };
    if (payload.action === 'deploy.sudo.password.submit') {
      payload.password = String(password || '');
    }
    socket.send(JSON.stringify(payload));
    return true;
  };

  const handleDeploySudoPasswordChallenge = (challengePayload) => {
    const challengeId = String(challengePayload?.challengeId || '').trim();
    if (!challengeId) {
      return;
    }
    if (promptedSudoChallengeIdsRef.current.has(challengeId)) {
      return;
    }
    promptedSudoChallengeIdsRef.current.add(challengeId);
    pendingSudoChallengeIdsRef.current.add(challengeId);

    const timeoutSeconds = Number.parseInt(String(challengePayload?.timeoutSeconds || '').trim(), 10);
    const normalizedTimeoutSeconds = Number.isInteger(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : DEPLOY_SUDO_PASSWORD_PROMPT_TIMEOUT_SECONDS_FALLBACK;
    const hostId = Number.isInteger(Number(challengePayload?.hostId)) ? Number(challengePayload.hostId) : null;
    const hostName = String(challengePayload?.hostName || '').trim() || null;
    const hostIp = String(challengePayload?.hostIp || '').trim() || null;
    const deploymentAction = normalizeDeployActionLabel(challengePayload?.deploymentAction);

    if (isDeploySudoChallengeExpired({
      requestedAt: challengePayload?.requestedAt,
      timeoutSeconds: normalizedTimeoutSeconds,
    })) {
      appendOverlayLogEntry(storeApi, {
        timestamp: new Date().toISOString(),
        level: 'warn',
        serviceName: 'node-backend',
        source: 'node-backend',
        stream: 'system',
        hostId,
        hostName,
        hostIp,
        message: 'Skipping expired sudo password prompt for slave deployment.',
      }, { overlaySeedRef });
      pendingSudoChallengeIdsRef.current.delete(challengeId);
      return;
    }

    const promptMessage = buildDeploySudoPromptMessage({
      hostName,
      hostIp,
      deploymentAction,
      timeoutSeconds: normalizedTimeoutSeconds,
    });
    const password = typeof window !== 'undefined'
      ? window.prompt(promptMessage, '')
      : null;
    const submitted = typeof password === 'string' && password.length > 0;

    const sent = sendDeploySudoPasswordMessage({
      action: submitted ? 'deploy.sudo.password.submit' : 'deploy.sudo.password.cancel',
      challengeId,
      password: submitted ? password : '',
    });

    appendOverlayLogEntry(storeApi, {
      timestamp: new Date().toISOString(),
      level: submitted ? 'info' : 'warn',
      serviceName: 'node-backend',
      source: 'node-backend',
      stream: 'system',
      hostId,
      hostName,
      hostIp,
      message: sent
        ? (submitted
          ? `Sudo password submitted for slave ${deploymentAction} on ${hostName || hostIp || 'host'}.`
          : `Sudo password prompt cancelled for slave ${deploymentAction} on ${hostName || hostIp || 'host'}.`)
        : `Unable to respond to sudo password challenge for ${hostName || hostIp || 'host'} because websocket is disconnected.`,
    }, { overlaySeedRef });
    if (!sent) {
      pendingSudoChallengeIdsRef.current.delete(challengeId);
    }
  };

  const updateLogsQueryEntriesForContext = ({
    contextKey,
    scope,
    streams,
    serverTime,
    requestId,
  } = {}) => {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) {
      return;
    }

    const normalizedServerTime = toIsoTimestamp(serverTime || Date.now());
    const normalizedStreams = (Array.isArray(streams) ? streams : [])
      .map((stream, streamIndex) => {
        const streamId = String(stream?.streamId || `stream-${streamIndex}`).trim();
        if (!streamId) {
          return null;
        }
        const totalLines = Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0);
        const offset = Math.max(0, Number.parseInt(stream?.offset, 10) || 0);
        const lines = (Array.isArray(stream?.lines) ? stream.lines : [])
          .map((line, lineIndex) => {
            const fallbackLineId = `${normalizedContextKey}:${streamId}:${offset + lineIndex}`;
            const lineId = String(line?.id || fallbackLineId).trim() || fallbackLineId;
            return {
              id: lineId,
              projectPath: String(line?.projectPath || '').trim() || '@overlay',
              timestamp: toIsoTimestamp(line?.timestamp || normalizedServerTime),
              serviceName: String(line?.serviceName || 'runtime').trim() || 'runtime',
              source: String(line?.source || line?.serviceName || 'runtime').trim().toLowerCase() || 'runtime',
              stream: String(line?.stream || 'stdout').trim().toLowerCase() || 'stdout',
              level: normalizeLogLevelName(line?.level),
              message: String(line?.message || ''),
              hostId: Number.isInteger(Number(line?.hostId)) ? Number(line.hostId) : null,
              hostName: String(line?.hostName || '').trim() || null,
              hostIp: String(line?.hostIp || '').trim() || null,
              agentUuid: String(line?.agentUuid || line?.slaveId || '').trim() || null,
              slaveId: String(line?.slaveId || line?.agentUuid || '').trim() || null,
            };
          });
        return {
          streamId,
          totalLines,
          offset,
          lines,
        };
      })
      .filter(Boolean);

    const seenLineIds = new Set();
    const flattenedEntries = normalizedStreams
      .flatMap((stream) => (Array.isArray(stream?.lines) ? stream.lines : []))
      .filter((line) => {
        const lineId = String(line?.id || '').trim();
        if (!lineId || seenLineIds.has(lineId)) {
          return false;
        }
        seenLineIds.add(lineId);
        return true;
      })
      .sort((left, right) => {
        const leftTimestamp = toIsoTimestamp(left?.timestamp);
        const rightTimestamp = toIsoTimestamp(right?.timestamp);
        if (leftTimestamp !== rightTimestamp) {
          return leftTimestamp.localeCompare(rightTimestamp);
        }
        return String(left?.id || '').localeCompare(String(right?.id || ''));
      });

    const currentByContext = storeApi.getState()?.homeDomain?.logsQueryEntriesByContext;
    const normalizedCurrentByContext = (
      currentByContext && typeof currentByContext === 'object'
        ? currentByContext
        : {}
    );
    const nextByContext = {
      ...normalizedCurrentByContext,
      [normalizedContextKey]: {
        scope: String(scope || 'runtime').trim().toLowerCase() || 'runtime',
        requestId: String(requestId || '').trim() || null,
        receivedAt: normalizedServerTime,
        error: null,
        streams: normalizedStreams,
        entries: flattenedEntries,
      },
    };
    storeApi.dispatch(setHomeDomainField('logsQueryEntriesByContext', nextByContext));
  };

  const updateLogsQueryErrorForContext = ({
    contextKey,
    scope,
    requestId,
    error,
  } = {}) => {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) {
      return;
    }
    const normalizedError = String(error || '').trim();
    const currentByContext = storeApi.getState()?.homeDomain?.logsQueryEntriesByContext;
    const normalizedCurrentByContext = (
      currentByContext && typeof currentByContext === 'object'
        ? currentByContext
        : {}
    );
    const currentEntry = normalizedCurrentByContext[normalizedContextKey];
    const nextByContext = {
      ...normalizedCurrentByContext,
      [normalizedContextKey]: {
        scope: String(scope || currentEntry?.scope || 'runtime').trim().toLowerCase() || 'runtime',
        requestId: String(requestId || currentEntry?.requestId || '').trim() || null,
        receivedAt: toIsoTimestamp(Date.now()),
        error: normalizedError || null,
        streams: Array.isArray(currentEntry?.streams) ? currentEntry.streams : [],
        entries: Array.isArray(currentEntry?.entries) ? currentEntry.entries : [],
      },
    };
    storeApi.dispatch(setHomeDomainField('logsQueryEntriesByContext', nextByContext));
  };

  const appendManagedProcessLogChunk = ({
    eventId,
    chunk,
  } = {}) => {
    const normalizedRunId = String(chunk?.runId || '').trim();
    const rawLines = Array.isArray(chunk?.lines) ? chunk.lines : [];
    if (!normalizedRunId || rawLines.length <= 0) {
      return;
    }

    const currentByContext = storeApi.getState()?.homeDomain?.logsQueryEntriesByContext;
    const normalizedCurrentByContext = (
      currentByContext && typeof currentByContext === 'object'
        ? currentByContext
        : {}
    );
    const matchingContextKeys = Object.keys(normalizedCurrentByContext)
      .filter((contextKey) => {
        const entry = normalizedCurrentByContext[contextKey];
        return String(entry?.scope || '').trim().toLowerCase() === 'process'
          && contextKey.endsWith(`:${normalizedRunId}`);
      });
    if (matchingContextKeys.length <= 0) {
      return;
    }

    const sampledAt = toIsoTimestamp(chunk?.sampledAt || Date.now());
    const normalizedServiceName = String(
      chunk?.packageKey || chunk?.processKey || 'managed-process',
    ).trim() || 'managed-process';
    const normalizedSource = String(chunk?.source || normalizedServiceName).trim().toLowerCase() || 'managed-process';
    const normalizedStream = String(chunk?.stream || 'stdout').trim().toLowerCase() || 'stdout';
    const normalizedAgentUuid = String(chunk?.agentUuid || chunk?.slaveId || '').trim() || null;
    const normalizedProjectPath = `@process:${normalizedAgentUuid || 'unknown'}:${normalizedRunId}`;
    const normalizedLines = rawLines
      .map((line, lineIndex) => {
        const message = String(line || '');
        if (!message) {
          return null;
        }
        return {
          id: `${String(eventId || `proc-${normalizedRunId}`)}:${lineIndex}`,
          projectPath: normalizedProjectPath,
          timestamp: sampledAt,
          serviceName: normalizedServiceName,
          source: normalizedSource,
          stream: normalizedStream,
          level: normalizeLogLevelName(chunk?.level),
          message,
          hostId: Number.isInteger(Number(chunk?.hostId)) ? Number(chunk.hostId) : null,
          hostName: String(chunk?.hostName || '').trim() || null,
          hostIp: String(chunk?.hostIp || '').trim() || null,
          agentUuid: normalizedAgentUuid,
          slaveId: normalizedAgentUuid,
          runId: normalizedRunId,
        };
      })
      .filter(Boolean);
    if (normalizedLines.length <= 0) {
      return;
    }

    const nextByContext = { ...normalizedCurrentByContext };
    let changed = false;

    for (const contextKey of matchingContextKeys) {
      const currentEntry = normalizedCurrentByContext[contextKey];
      const currentStreams = Array.isArray(currentEntry?.streams) ? currentEntry.streams : [];
      const mergedStream = currentStreams.find((stream) => String(stream?.streamId || '').trim() === 'merged');
      const tailAware = mergedStream
        ? ((Number.parseInt(mergedStream.offset, 10) || 0) + (Array.isArray(mergedStream.lines) ? mergedStream.lines.length : 0))
          >= (Number.parseInt(mergedStream.totalLines, 10) || 0)
        : true;
      const existingLineIds = new Set(
        (Array.isArray(currentEntry?.entries) ? currentEntry.entries : [])
          .map((line) => String(line?.id || '').trim())
          .filter(Boolean),
      );
      const appendableLines = normalizedLines.filter((line) => !existingLineIds.has(String(line.id || '').trim()));
      if (appendableLines.length <= 0) {
        continue;
      }

      const nextStreams = currentStreams.length > 0
        ? currentStreams.map((stream) => {
          if (String(stream?.streamId || '').trim() !== 'merged') {
            return stream;
          }
          const currentStreamLines = Array.isArray(stream?.lines) ? stream.lines : [];
          const nextStreamLines = tailAware
            ? [...currentStreamLines, ...appendableLines]
            : currentStreamLines;
          return {
            ...stream,
            totalLines: Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0) + appendableLines.length,
            lines: nextStreamLines,
          };
        })
        : [{
          streamId: 'merged',
          totalLines: appendableLines.length,
          offset: 0,
          lines: appendableLines,
        }];

      const flattenedEntries = nextStreams
        .flatMap((stream) => (Array.isArray(stream?.lines) ? stream.lines : []))
        .sort((left, right) => {
          const leftTimestamp = toIsoTimestamp(left?.timestamp);
          const rightTimestamp = toIsoTimestamp(right?.timestamp);
          if (leftTimestamp !== rightTimestamp) {
            return leftTimestamp.localeCompare(rightTimestamp);
          }
          return String(left?.id || '').localeCompare(String(right?.id || ''));
        });

      nextByContext[contextKey] = {
        ...currentEntry,
        receivedAt: sampledAt,
        error: null,
        streams: nextStreams,
        entries: flattenedEntries,
      };
      changed = true;
    }

    if (changed) {
      storeApi.dispatch(setHomeDomainField('logsQueryEntriesByContext', nextByContext));
    }
  };

  const handleSocketMessage = (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.kind === 'hello' || payload.kind === 'subscribed' || payload.kind === 'pong') {
      return;
    }

    if (
      payload.kind === 'deploy.sudo.password.accepted'
      || payload.kind === 'deploy.sudo.password.cancelled'
      || payload.kind === 'deploy.sudo.password.error'
    ) {
      const challengeId = String(payload?.challengeId || '').trim();
      if (challengeId) {
        pendingSudoChallengeIdsRef.current.delete(challengeId);
      }
      const statusLevel = payload.kind === 'deploy.sudo.password.error'
        ? 'error'
        : (
          payload.kind === 'deploy.sudo.password.cancelled'
            ? 'warn'
            : 'info'
        );
      const statusMessage = payload.kind === 'deploy.sudo.password.accepted'
        ? 'Sudo password accepted by backend.'
        : (
          payload.kind === 'deploy.sudo.password.cancelled'
            ? 'Sudo password request cancelled.'
            : `Sudo password request error: ${String(payload?.error || 'unknown error')}`
        );
      appendOverlayLogEntry(storeApi, {
        timestamp: new Date().toISOString(),
        level: statusLevel,
        serviceName: 'node-backend',
        source: 'node-backend',
        stream: statusLevel === 'error' ? 'stderr' : 'system',
        message: statusMessage,
      }, { overlaySeedRef });
      return;
    }

    if (payload.kind === 'logs.query.result') {
      const normalized = normalizeLogsQueryResult(payload);
      if (!normalized) {
        return;
      }
      const contextKey = String(normalized.contextKey || normalized.scope || 'runtime').trim()
        || 'runtime';
      updateLogsQueryEntriesForContext({
        contextKey,
        scope: normalized.scope,
        streams: normalized.streams,
        serverTime: payload?.serverTime,
        requestId: normalized.requestId,
      });
      return;
    }

    if (payload.kind === 'logs.query.error') {
      const queryErrorMessage = String(payload?.error || '').trim();
      const activeContext = String(storeApi.getState()?.uiInteractions?.activeLogContextKey || '').trim();
      const contextKey = String(payload?.contextKey || activeContext || payload?.scope || 'runtime').trim()
        || 'runtime';
      updateLogsQueryErrorForContext({
        contextKey,
        scope: payload?.scope,
        requestId: payload?.requestId,
        error: queryErrorMessage,
      });
      if (queryErrorMessage) {
        appendOverlayLogEntry(storeApi, {
          timestamp: new Date().toISOString(),
          serviceName: 'node-backend',
          source: 'node-backend',
          stream: 'stderr',
          message: `[logs.query] ${queryErrorMessage}`,
        }, { overlaySeedRef });
      }
      return;
    }

    if (payload.kind !== 'event') {
      return;
    }

    const eventId = String(payload.eventId || '').trim();
    if (eventId) {
      lastEventIdRef.current = eventId;
    }
    const topic = String(payload.topic || '').trim();
    if (!topic || !payload.payload || typeof payload.payload !== 'object') {
      return;
    }

    if (topic === 'deploy.sudo.password.required') {
      handleDeploySudoPasswordChallenge(payload.payload);
      return;
    }

    if (topic === 'log.overlay') {
      enqueueOverlayLogEntry(payload.payload);
      return;
    }

    if (topic === 'project.log.append') {
      appendProjectLogEntry(storeApi, payload.payload, { projectLogSeedRef });
      return;
    }

    if (topic === 'process.log.append') {
      appendManagedProcessLogChunk({
        eventId,
        chunk: payload.payload,
      });
      return;
    }

    if (topic === 'runtime.master.connection') {
      const connection = payload.payload;
      const nextConnectionStatus = String(connection?.connectionStatus || '').trim().toLowerCase();
      const shouldFlushImmediately = Boolean(nextConnectionStatus)
        && nextConnectionStatus !== lastRuntimeConnectionStatusRef.current;
      pendingRuntimeConnectionRef.current = connection;
      scheduleRuntimeConnectionFlush(shouldFlushImmediately);
      return;
    }

    if (topic === 'runtime.project.updated' && payload.payload?.projectPath) {
      storeApi.dispatch(applyHomeRuntimeProjectUpdate(payload.payload));
    }
  };

  const connectSocket = (wsEndpoint) => {
    if (typeof window === 'undefined') {
      return;
    }
    const resolvedEndpoint = resolveEndpoint(wsEndpoint);
    if (!resolvedEndpoint) {
      return;
    }

    const socket = new WebSocket(resolvedEndpoint);
    wsRef.current = socket;

    socket.onopen = () => {
      retryCountRef.current = 0;
      const currentError = String(storeApi.getState()?.uiInteractions?.error || '');
      if (currentError === WEBSOCKET_DISCONNECTED_ERROR) {
        storeApi.dispatch(setUiError(''));
      }
      socket.send(JSON.stringify({
        action: 'subscribe',
        topics: ['*'],
        lastEventId: lastEventIdRef.current || null,
      }));
    };

    socket.onmessage = handleSocketMessage;

    socket.onerror = () => {
      const currentError = String(storeApi.getState()?.uiInteractions?.error || '');
      if (!currentError) {
        storeApi.dispatch(setUiError(WEBSOCKET_DISCONNECTED_ERROR));
      }
    };

    socket.onclose = (event) => {
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      if (WEBSOCKET_UNAUTHORIZED_CLOSE_CODES.has(Number(event?.code))) {
        isManualDisconnectRef.current = true;
        if (Number(event?.code) === 4403) {
          redirectToUnauthorized();
        } else {
          redirectToLogin();
        }
        return;
      }
      if (!isManualDisconnectRef.current) {
        const currentError = String(storeApi.getState()?.uiInteractions?.error || '');
        if (!currentError) {
          storeApi.dispatch(setUiError(WEBSOCKET_DISCONNECTED_ERROR));
        }
        scheduleReconnect();
      }
    };
  };

  return (next) => (action) => {
    if (action.type === HOME_REALTIME_CONNECT) {
      clearDisconnectTimer();
      clearOverlayLogFlushTimer();
      pendingOverlayLogsRef.current = [];
      clearRuntimeConnectionFlushTimer();
      pendingRuntimeConnectionRef.current = null;
      storeApi.dispatch(setHomeDomainField('logsQueryEntriesByContext', {}));
      pendingSudoChallengeIdsRef.current.clear();
      endpointRef.current = String(action.wsEndpoint || '').trim();
      isManualDisconnectRef.current = false;
      clearReconnectTimer();
      closeSocket();
      if (endpointRef.current) {
        connectSocket(endpointRef.current);
      }
      return next(action);
    }

    if (action.type === HOME_REALTIME_DISCONNECT) {
      isManualDisconnectRef.current = true;
      endpointRef.current = '';
      storeApi.dispatch(setHomeDomainField('logsQueryEntriesByContext', {}));
      pendingSudoChallengeIdsRef.current.clear();
      clearDisconnectTimer();
      clearReconnectTimer();
      clearOverlayLogFlushTimer();
      pendingOverlayLogsRef.current = [];
      clearRuntimeConnectionFlushTimer();
      pendingRuntimeConnectionRef.current = null;
      disconnectTimerRef.current = setTimeout(() => {
        closeSocket();
        retryCountRef.current = 0;
        disconnectTimerRef.current = null;
      }, 120);
      return next(action);
    }

    if (action.type === HOME_REALTIME_REQUEST_LOG_WINDOW) {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        const sequence = logQuerySequenceRef.current + 1;
        logQuerySequenceRef.current = sequence;
        const requestId = `logs-query-${Date.now()}-${sequence}`;
        const payload = buildLogsQueryMessage({
          requestId,
          context: action.context,
          streams: action.streams,
        });
        if (payload) {
          socket.send(JSON.stringify(payload));
        }
      }
      return next(action);
    }

    return next(action);
  };
};

const persistUserSettingsMiddleware = (storeApi) => (next) => (action) => {
  const previousSettings = storeApi.getState()?.userSettings;
  const result = next(action);
  const currentSettings = storeApi.getState()?.userSettings;
  const changed = JSON.stringify(previousSettings) !== JSON.stringify(currentSettings);

  if (changed && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings || {}));
    } catch {
      // ignore storage failures
    }

    try {
      const style = currentSettings?.style;
      const secure = window.location.protocol === 'https:' ? '; Secure' : '';
      if (style) {
        document.cookie =
          `${USER_SETTINGS_STYLE_COOKIE}=${encodeURIComponent(style)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
      } else {
        document.cookie = `${USER_SETTINGS_STYLE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
      }
    } catch {
      // ignore cookie write failures
    }
  }

  return result;
};

const persistPanelStateMiddleware = (storeApi) => (next) => (action) => {
  const previousPanelProjectList = storeApi.getState()?.panelProjectList;
  const previousPanelProjectExplorer = storeApi.getState()?.panelProjectExplorer;
  const previousUiInteractions = storeApi.getState()?.uiInteractions;
  const result = next(action);
  const currentPanelProjectList = storeApi.getState()?.panelProjectList;
  const currentPanelProjectExplorer = storeApi.getState()?.panelProjectExplorer;
  const currentUiInteractions = storeApi.getState()?.uiInteractions;
  const previousPersistedUiInteractions = toPersistedUiInteractions(previousUiInteractions || {});
  const currentPersistedUiInteractions = toPersistedUiInteractions(currentUiInteractions || {});
  const changed =
    JSON.stringify(previousPanelProjectList) !== JSON.stringify(currentPanelProjectList) ||
    JSON.stringify(previousPanelProjectExplorer) !== JSON.stringify(currentPanelProjectExplorer) ||
    JSON.stringify(previousPersistedUiInteractions) !== JSON.stringify(currentPersistedUiInteractions);

  if (changed && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        PANEL_STATE_STORAGE_KEY,
        JSON.stringify({
          panelProjectList: {
            selectedProjectPath: currentPanelProjectList?.selectedProjectPath || '',
          },
          panelProjectExplorer: {
            isFollowMode: normalizePanelExplorerFollowMode(currentPanelProjectExplorer?.isFollowMode),
          },
          uiInteractions: currentPersistedUiInteractions,
        }),
      );
    } catch {
      // ignore storage failures
    }
  }

  return result;
};

export const makeStore = (preloadedState) => {
  const middlewareEnhancer = applyMiddleware(
    realtimeMiddleware,
    persistUserSettingsMiddleware,
    persistPanelStateMiddleware,
  );
  const composeEnhancers =
    typeof window !== 'undefined' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
      ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
        name: `Project Commander Web @ ${window.location.host}`,
        instanceId: `project-commander-web-${window.location.host}`,
      })
      : compose;

  const enhancer = composeEnhancers(middlewareEnhancer);

  return createStore(reducer, mergeInitialState(preloadedState), enhancer);
};

export const wrapper = {
  useWrappedStore({ initialState: preloadedState, ...rest } = {}) {
    const storeRef = useRef();
    if (!storeRef.current) {
      storeRef.current = makeStore(preloadedState);
    }
    return { store: storeRef.current, props: { pageProps: rest?.pageProps || {} } };
  },
};
