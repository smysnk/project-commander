import { applyMiddleware, compose, createStore } from 'redux';
import { useRef } from 'react';
import {
  EditorThemeEnum,
  defaultEditorTheme,
  defaultEditorThemes,
} from '../components/editorThemeRegistry';

const SET_RUNTIME_CONFIG = 'SET_RUNTIME_CONFIG';
const SET_USER_STYLE = 'SET_USER_STYLE';
const SET_PANEL_PROJECT_LIST_LAYOUT = 'SET_PANEL_PROJECT_LIST_LAYOUT';
const SET_PANEL_PROJECT_LIST_SELECTED_PROJECT = 'SET_PANEL_PROJECT_LIST_SELECTED_PROJECT';
const SET_PANEL_PROJECT_EXPLORER_MODE = 'SET_PANEL_PROJECT_EXPLORER_MODE';
const SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE = 'SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE';
const USER_SETTINGS_STORAGE_KEY = 'project-discovery:user-settings';
const USER_SETTINGS_STYLE_COOKIE = 'user_settings_style';
const PANEL_STATE_STORAGE_KEY = 'project-discovery:panel-state';

export const setRuntimeConfig = (payload) => ({
  type: SET_RUNTIME_CONFIG,
  payload,
});

export const setUserStyle = (style) => ({
  type: SET_USER_STYLE,
  style,
});

export const setPanelProjectListLayout = (payload) => ({
  type: SET_PANEL_PROJECT_LIST_LAYOUT,
  payload,
});

export const setPanelProjectListSelectedProject = (projectPath) => ({
  type: SET_PANEL_PROJECT_LIST_SELECTED_PROJECT,
  projectPath,
});

export const setPanelProjectExplorerMode = (mode) => ({
  type: SET_PANEL_PROJECT_EXPLORER_MODE,
  mode,
});

export const setPanelProjectExplorerFollowMode = (isFollowMode) => ({
  type: SET_PANEL_PROJECT_EXPLORER_FOLLOW_MODE,
  isFollowMode,
});

const clampPanelWidth = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(20, Math.min(80, Math.round(parsed)));
};

const PANEL_EXPLORER_MODES = new Set(['logs', 'debug', 'environment', 'top']);

const normalizePanelExplorerMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return PANEL_EXPLORER_MODES.has(normalized) ? normalized : 'logs';
};

const normalizePanelExplorerFollowMode = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  return true;
};

const getDefaultWsEndpoint = () => {
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
  const fallback = {
    leftWidthPct: 50,
    selectedProjectPath: '',
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(PANEL_STATE_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    const rawPanelProjectList = parsed?.panelProjectList || parsed?.panels || parsed;
    return {
      leftWidthPct: clampPanelWidth(rawPanelProjectList?.leftWidthPct),
      selectedProjectPath:
        typeof rawPanelProjectList?.selectedProjectPath === 'string' ? rawPanelProjectList.selectedProjectPath : '',
    };
  } catch {
    return fallback;
  }
};

const getInitialPanelProjectExplorer = () => {
  const fallback = {
    mode: 'logs',
    isFollowMode: true,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(PANEL_STATE_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    const rawPanelProjectExplorer = parsed?.panelProjectExplorer || {};

    return {
      mode: normalizePanelExplorerMode(rawPanelProjectExplorer?.mode),
      isFollowMode: normalizePanelExplorerFollowMode(rawPanelProjectExplorer?.isFollowMode),
    };
  } catch {
    return fallback;
  }
};

const initialState = {
  settings: {
    themes: defaultEditorThemes,
  },
  userSettings: {
    style: getInitialTheme(),
  },
  panelProjectList: getInitialPanelProjectList(),
  panelProjectExplorer: getInitialPanelProjectExplorer(),
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
    case SET_PANEL_PROJECT_LIST_LAYOUT:
      return {
        ...state,
        panelProjectList: {
          ...state.panelProjectList,
          leftWidthPct: clampPanelWidth(action.payload?.leftWidthPct),
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
    case SET_PANEL_PROJECT_EXPLORER_MODE:
      return {
        ...state,
        panelProjectExplorer: {
          ...state.panelProjectExplorer,
          mode: normalizePanelExplorerMode(action.mode),
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
      leftWidthPct: clampPanelWidth(
        preloadedState?.panelProjectList?.leftWidthPct ?? initialState.panelProjectList.leftWidthPct,
      ),
      selectedProjectPath:
        typeof preloadedState?.panelProjectList?.selectedProjectPath === 'string'
          ? preloadedState.panelProjectList.selectedProjectPath
          : initialState.panelProjectList.selectedProjectPath,
    },
    panelProjectExplorer: {
      ...initialState.panelProjectExplorer,
      ...(preloadedState?.panelProjectExplorer || {}),
      mode: normalizePanelExplorerMode(
        preloadedState?.panelProjectExplorer?.mode ?? initialState.panelProjectExplorer.mode,
      ),
      isFollowMode: normalizePanelExplorerFollowMode(
        preloadedState?.panelProjectExplorer?.isFollowMode ?? initialState.panelProjectExplorer.isFollowMode,
      ),
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
  const result = next(action);
  const currentPanelProjectList = storeApi.getState()?.panelProjectList;
  const currentPanelProjectExplorer = storeApi.getState()?.panelProjectExplorer;
  const changed =
    JSON.stringify(previousPanelProjectList) !== JSON.stringify(currentPanelProjectList) ||
    JSON.stringify(previousPanelProjectExplorer) !== JSON.stringify(currentPanelProjectExplorer);

  if (changed && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        PANEL_STATE_STORAGE_KEY,
        JSON.stringify({
          panelProjectList: {
            leftWidthPct: clampPanelWidth(currentPanelProjectList?.leftWidthPct),
            selectedProjectPath: currentPanelProjectList?.selectedProjectPath || '',
          },
          panelProjectExplorer: {
            mode: normalizePanelExplorerMode(currentPanelProjectExplorer?.mode),
            isFollowMode: normalizePanelExplorerFollowMode(currentPanelProjectExplorer?.isFollowMode),
          },
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
    persistUserSettingsMiddleware,
    persistPanelStateMiddleware,
  );
  const composeEnhancers =
    typeof window !== 'undefined' && window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
      ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
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
