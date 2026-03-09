'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  connectHomeRealtime,
  disconnectHomeRealtime,
  setHomeDomainField,
  setPanelProjectExplorerFollowMode,
  setPanelProjectExplorerMode,
  setPanelProjectListLayout,
  setPanelProjectListSelectedProject,
  setUiActiveLogContextKey,
  setUiDisabledLogLevels,
  setUiError,
  setUiResizing,
  setUiSelectedLogServices,
  setUiDebugExpandedPaths,
  setUiHostsSidebarCollapsed,
  setUiHostsSidebarWidthPx,
  setUiLeftPanelMode,
  setUiSelectedHostId,
  setUserStyle,
  resolveClientThemePreference,
} from '../../store';
import { graphqlRequest } from '../../lib/graphqlClient';
import TagChip from '../../components/TagChip';
import { findServiceIcon, getUniqueServiceIconMap } from '../../lib/serviceIconFinder';
import {
  MUTATION_SET_PROJECT_PORT_RANGE_SETTINGS,
} from './graphql/documents';
import {
  LEFT_PANEL_MODE,
  PORT_RANGE_MODE,
  PORT_RANGE_BEGIN_MIN,
  PORT_RANGE_BEGIN_MAX,
} from './constants/ui';
import {
  deriveDestinationFolderFromRepositoryUrl,
  formatVersionWithProtocol,
  isHostVersionOutOfDate,
  normalizeHostDirectories,
  normalizeTerminalSession,
} from './lib/homeUtils';
import {
  LOG_LEVEL_LETTER_MAP,
  normalizeLogLevelName,
} from './lib/logTransforms';
import {
  formatRuntimeDateTime,
  getDefaultWsEndpoint,
  normalizePortRangeSettings,
  toConnectionHealthClassName,
  toHostHealthClassName,
} from './lib/runtimeTransforms';
import {
  useDashboardQueries,
  useProjectQueries,
  useRuntimeRegistryQueries,
  useRuntimeQueries,
} from './hooks/useHomeQueries';
import useRuntimeRegistryActions from './hooks/useRuntimeRegistryActions';
import { useTerminalActions } from './hooks/useTerminalActions';
import useHomeLayoutController from './controllers/useHomeLayoutController';
import useHostsSidebarController from './controllers/useHostsSidebarController';
import useLogsPanelController from './controllers/useLogsPanelController';
import useProjectsPaneController from './controllers/useProjectsPaneController';
import useRightPaneController from './controllers/useRightPaneController';
import useStatusBarController from './controllers/useStatusBarController';
import HomePageShellContainer from './containers/HomePageShellContainer';
import { HomeLayoutProvider } from './context/HomeLayoutContext';
import { HostsSidebarProvider } from './context/HostsSidebarContext';
import { ProjectsPaneProvider } from './context/ProjectsPaneContext';
import { RightPaneProvider } from './context/RightPaneContext';
import { LogsPanelProvider } from './context/LogsPanelContext';
import { DebugPanelProvider } from './context/DebugPanelContext';
import { EnvironmentPanelProvider } from './context/EnvironmentPanelContext';
import { TopPanelProvider } from './context/TopPanelContext';
import { RuntimePanelProvider } from './context/RuntimePanelContext';
import { TerminalPanelProvider } from './context/TerminalPanelContext';
import { StatusBarProvider } from './context/StatusBarContext';
import {
  selectAddingHost,
  selectCheckoutAutoDestinationByHostId,
  selectCheckoutBaseDirectoryByHostId,
  selectCheckoutDestinationByHostId,
  selectCheckoutMutationBusyByHostId,
  selectCheckoutRepoInputByHostId,
  selectDebugExpandedPaths,
  selectDeletingHostId,
  selectDirectoryInputByHostId,
  selectDirectoryMutationBusyByHostId,
  selectDisabledLogLevels,
  selectEditorTheme,
  selectEnvironmentLoading,
  selectError,
  selectFollowLogs,
  selectHomeLoading,
  selectHosts,
  selectHostsLoading,
  selectHostsSidebarCollapsed,
  selectHostsSidebarWidthPx,
  selectLeftPanelMode,
  selectLeftWidthPct,
  selectLogsLoading,
  selectLogsQueryEntriesByContext,
  selectManualHostIp,
  selectManualPortRangeInput,
  selectOverlayLogs,
  selectProcessStatsLoading,
  selectProjectEnvironment,
  selectProjectLogs,
  selectProjectPortRangeSettings,
  selectProjectPortRangeSettingsLoading,
  selectProjectPortRangeSettingsSaving,
  selectProjectProcessStats,
  selectProjects,
  selectRightTab,
  selectResizing,
  selectRuntimeConfig,
  selectRuntimeBackendInfo,
  selectRuntimeBackendInfoLoading,
  selectScannedAt,
  selectSelectedHost,
  selectSelectedHostId,
  selectSelectedHostNumericId,
  selectSelectedLogServices,
  selectSelectedProject,
  selectSelectedProjectPath,
  selectSeenLogServicesByProject,
  selectShowAddDirectoryRowByHostId,
  selectShowAddHostRow,
  selectShowCheckoutRowByHostId,
  selectTerminalInputByHostId,
  selectTerminalOutputBySessionId,
  selectTerminalSendingByHostId,
  selectTerminalSessionsByHostId,
  selectTerminalStartingByHostId,
  selectUpgradingHostId,
  selectIsMasterSidebarSelected,
  selectRunningProjectCount,
  selectSelectedTerminalOutput,
  selectSelectedTerminalSession,
  selectSelectedHostTerminalInput,
  selectSelectedHostTerminalStarting,
  selectSelectedHostTerminalSending,
  selectSlaveTargetVersion,
  selectIsGoMasterBackend,
  selectMasterAgent,
} from './store/selectors';
import { FiGlobe, FiKey, FiServer } from 'react-icons/fi';
import { FaNodeJs } from 'react-icons/fa6';
import { SiGo, SiTurborepo } from 'react-icons/si';
const renderLogTagRow = (
  entry,
  {
    serviceTagColor = null,
    serviceIcon = null,
    logLevel = 'info',
    showHostTag = true,
  } = {},
) => {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();
  const rawServiceName = String(entry.serviceName || '').trim();
  const hostLabel = String(entry?.hostName || entry?.hostIp || '').trim();
  const ServiceChipIcon = serviceIcon || findServiceIcon(rawServiceName);
  const normalizedLogLevel = normalizeLogLevelName(logLevel) || 'info';
  const levelLetter = LOG_LEVEL_LETTER_MAP[normalizedLogLevel] || 'I';
  const serviceTagStyle = {
    ...(serviceTagColor ? { color: serviceTagColor } : {}),
  };
  return (
    <div className="infiniteLogTagRowContent">
      <span className={`logLevelTag ${normalizedLogLevel}`}>
        {levelLetter}
      </span>
      <span className="logTimestamp">{timestamp}</span>
      {showHostTag && hostLabel ? (
        <TagChip className="logHostTag" title={hostLabel} fullWidth>
          {hostLabel}
        </TagChip>
      ) : (
        <span className="logHostPlaceholder" aria-hidden />
      )}
      <TagChip className="logServiceTag" style={serviceTagStyle} title={rawServiceName || '-'} fullWidth>
        {rawServiceName || '-'}
      </TagChip>
      <span className="logServiceIconCol" aria-hidden>
        <ServiceChipIcon className="logServiceTagIcon" />
      </span>
    </div>
  );
};

const PROJECT_TYPE_ICONS = {
  node: {
    label: 'Node.js project',
    icon: FaNodeJs,
    className: 'node',
    isActive: (types) => types.includes('node-project'),
  },
  go: {
    label: 'Golang project',
    icon: SiGo,
    className: 'go',
    isActive: (types) => types.includes('go-project'),
  },
  monorepo: {
    label: 'Monorepo',
    icon: SiTurborepo,
    className: 'mono',
    isActive: (types) => types.includes('node-monorepo') || types.includes('go-monorepo'),
  },
};

const ORDERED_TYPE_ICON_KEYS = ['node', 'go', 'monorepo'];

const ORDERED_SERVICE_KEYS = ['main', 'graphql', 'api', 'admin'];
const CONTROL_ADJACENT_SERVICE_KEYS = ['admin', 'api', 'main'];
const PANEL_STATE_STORAGE_KEY = 'project-discovery:panel-state';
const RIGHT_PANE_TAB = {
  LOGS: 'logs',
  DEBUG: 'debug',
  ENVIRONMENT: 'environment',
  TOP: 'top',
  RUNTIME: 'runtime',
  TERMINAL: 'terminal',
};

const SERVICE_ICON_DEFS = {
  main: { label: 'Main', icon: FiGlobe, className: 'main' },
  api: { label: 'API', icon: FiServer, className: 'api' },
  admin: { label: 'Admin', icon: FiKey, className: 'admin' },
};

const normalizeServiceKey = (value) => String(value || '').trim().toLowerCase();

const toCanonicalServiceIconKey = (value) => {
  const normalized = normalizeServiceKey(value);
  if (!normalized) {
    return '';
  }
  if (normalized === 'web' || normalized === 'interface' || normalized === 'main') {
    return 'main';
  }
  if (normalized === 'server' || normalized === 'api') {
    return 'api';
  }
  if (normalized === 'admin') {
    return 'admin';
  }
  if (normalized === 'graphql') {
    return 'graphql';
  }
  return normalized;
};

const buildLockedServiceIcons = (serviceKeys) =>
  Object.fromEntries(
    Object.entries(SERVICE_ICON_DEFS)
      .filter(([serviceName]) => serviceKeys.includes(serviceName))
      .map(([serviceName, iconDef]) => [serviceName, iconDef.icon]),
  );

const buildUniqueIconsForServices = (serviceKeys) =>
  getUniqueServiceIconMap(serviceKeys, {
    lockedIconsByService: buildLockedServiceIcons(serviceKeys),
  });

const formatServiceLabel = (serviceKey) => {
  const normalized = normalizeServiceKey(serviceKey);
  if (!normalized) {
    return 'Package';
  }
  if (normalized === 'api') {
    return 'API';
  }
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const getDiscoveredServiceKeys = (services) => {
  const uniqueKeys = Array.from(
    new Set((Array.isArray(services) ? services : []).map((serviceKey) => normalizeServiceKey(serviceKey)).filter(Boolean)),
  );

  const orderedKeys = uniqueKeys.sort((left, right) => {
    const leftIndex = ORDERED_SERVICE_KEYS.indexOf(left);
    const rightIndex = ORDERED_SERVICE_KEYS.indexOf(right);
    const leftRank = leftIndex >= 0 ? leftIndex : ORDERED_SERVICE_KEYS.length + 1;
    const rightRank = rightIndex >= 0 ? rightIndex : ORDERED_SERVICE_KEYS.length + 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });

  const pinnedControlAdjacentKeys = CONTROL_ADJACENT_SERVICE_KEYS
    .filter((key) => orderedKeys.includes(key));
  const nonPinnedKeys = orderedKeys
    .filter((key) => !CONTROL_ADJACENT_SERVICE_KEYS.includes(key));

  return [...nonPinnedKeys, ...pinnedControlAdjacentKeys];
};

const getDefaultDebugExpandedPaths = (selectedProject = null) => {
  const expanded = new Set([
    '',
    'name',
    'path',
    'relativePath',
    'runtimeStatus',
    'runtimePid',
    'runtimePorts',
    'runtimeServicePorts',
    'runtimeServicePids',
    'runtimeServiceStates',
    'runtimeLastExitCode',
    'stack',
    'enabledServices',
    'hasMakefile',
    'declaredServices',
  ]);

  const declaredCount = Array.isArray(selectedProject?.declaredServices)
    ? selectedProject.declaredServices.length
    : 0;

  for (let index = 0; index < declaredCount; index += 1) {
    expanded.add(`declaredServices.${index}`);
  }

  return expanded;
};

export default function HomePageContainer() {
  const dispatch = useDispatch();
  const runtimeConfig = useSelector(selectRuntimeConfig);
  const leftWidthPct = useSelector(selectLeftWidthPct);
  const selectedProjectPath = useSelector(selectSelectedProjectPath);
  const rightTab = useSelector(selectRightTab);
  const followLogs = useSelector(selectFollowLogs);
  const editorTheme = useSelector(selectEditorTheme);
  const leftPanelMode = useSelector(selectLeftPanelMode);
  const runtimeBackendInfo = useSelector(selectRuntimeBackendInfo);
  const runtimeBackendInfoLoading = useSelector(selectRuntimeBackendInfoLoading);
  const hostsSidebarCollapsed = useSelector(selectHostsSidebarCollapsed);
  const hostsSidebarWidthPx = useSelector(selectHostsSidebarWidthPx);
  const resizing = useSelector(selectResizing);
  const selectedHostId = useSelector(selectSelectedHostId);
  const error = useSelector(selectError);
  const showAddHostRow = useSelector(selectShowAddHostRow);
  const manualHostIp = useSelector(selectManualHostIp);
  const addingHost = useSelector(selectAddingHost);
  const deletingHostId = useSelector(selectDeletingHostId);
  const upgradingHostId = useSelector(selectUpgradingHostId);
  const showAddDirectoryRowByHostId = useSelector(selectShowAddDirectoryRowByHostId);
  const directoryInputByHostId = useSelector(selectDirectoryInputByHostId);
  const directoryMutationBusyByHostId = useSelector(selectDirectoryMutationBusyByHostId);
  const showCheckoutRowByHostId = useSelector(selectShowCheckoutRowByHostId);
  const checkoutRepoInputByHostId = useSelector(selectCheckoutRepoInputByHostId);
  const checkoutBaseDirectoryByHostId = useSelector(selectCheckoutBaseDirectoryByHostId);
  const checkoutDestinationByHostId = useSelector(selectCheckoutDestinationByHostId);
  const checkoutAutoDestinationByHostId = useSelector(selectCheckoutAutoDestinationByHostId);
  const checkoutMutationBusyByHostId = useSelector(selectCheckoutMutationBusyByHostId);
  const terminalInputByHostId = useSelector(selectTerminalInputByHostId);
  const terminalStartingByHostId = useSelector(selectTerminalStartingByHostId);
  const terminalSendingByHostId = useSelector(selectTerminalSendingByHostId);
  const selectedLogServices = useSelector(selectSelectedLogServices);
  const disabledLogLevels = useSelector(selectDisabledLogLevels);
  const debugExpandedPaths = useSelector(selectDebugExpandedPaths);
  const projects = useSelector(selectProjects);
  const hosts = useSelector(selectHosts);
  const hostsLoading = useSelector(selectHostsLoading);
  const terminalSessionByHostId = useSelector(selectTerminalSessionsByHostId);
  const terminalOutputBySessionId = useSelector(selectTerminalOutputBySessionId);
  const scannedAt = useSelector(selectScannedAt);
  const loading = useSelector(selectHomeLoading);
  const projectLogs = useSelector(selectProjectLogs);
  const logsQueryEntriesByContext = useSelector(selectLogsQueryEntriesByContext);
  const overlayLogs = useSelector(selectOverlayLogs);
  const logsLoading = useSelector(selectLogsLoading);
  const projectEnvironment = useSelector(selectProjectEnvironment);
  const environmentLoading = useSelector(selectEnvironmentLoading);
  const projectPortRangeSettings = useSelector(selectProjectPortRangeSettings);
  const projectPortRangeSettingsLoading = useSelector(selectProjectPortRangeSettingsLoading);
  const projectPortRangeSettingsSaving = useSelector(selectProjectPortRangeSettingsSaving);
  const manualPortRangeInput = useSelector(selectManualPortRangeInput);
  const projectProcessStats = useSelector(selectProjectProcessStats);
  const processStatsLoading = useSelector(selectProcessStatsLoading);
  const seenLogServicesByProject = useSelector(selectSeenLogServicesByProject);
  const runningCount = useSelector(selectRunningProjectCount);
  const selectedProject = useSelector(selectSelectedProject);
  const selectedHost = useSelector(selectSelectedHost);
  const isMasterSidebarSelected = useSelector(selectIsMasterSidebarSelected);
  const selectedHostNumericId = useSelector(selectSelectedHostNumericId);
  const selectedTerminalSession = useSelector(selectSelectedTerminalSession);
  const selectedTerminalOutput = useSelector(selectSelectedTerminalOutput);
  const selectedHostTerminalInput = useSelector(selectSelectedHostTerminalInput);
  const selectedHostTerminalStarting = useSelector(selectSelectedHostTerminalStarting);
  const selectedHostTerminalSending = useSelector(selectSelectedHostTerminalSending);
  const slaveTargetVersion = useSelector(selectSlaveTargetVersion);
  const isGoMasterBackend = useSelector(selectIsGoMasterBackend);
  const masterAgentInfo = useSelector(selectMasterAgent);
  const [runtimeRegistryByHostId, setRuntimeRegistryByHostId] = useState({});
  const [runtimeRegistryLoadingByHostId, setRuntimeRegistryLoadingByHostId] = useState({});
  const [runtimeActionBusyByHostId, setRuntimeActionBusyByHostId] = useState({});
  const [selectedProcessLogTarget, setSelectedProcessLogTarget] = useState(null);

  const graphqlEndpoint = runtimeConfig?.graphqlEndpoint || '/graphql';
  const wsEndpoint = runtimeConfig?.wsEndpoint || getDefaultWsEndpoint();

  const workspaceRef = useRef(null);
  const mainPanelsRef = useRef(null);
  const logStreamRef = useRef(null);
  const terminalOutputRef = useRef(null);
  const resizingRef = useRef(false);
  const resizingHandleRef = useRef(null);
  const projectLogsRef = useRef([]);
  const overlayLogSeedRef = useRef(1);
  const isProgrammaticLogScrollRef = useRef(false);
  const debugExpandedPathsRef = useRef(debugExpandedPaths);

  useEffect(() => {
    debugExpandedPathsRef.current = debugExpandedPaths;
  }, [debugExpandedPaths]);

  const scrollLogsToEnd = useCallback((behavior = 'auto') => {
    const container = logStreamRef.current;
    if (!container) {
      return;
    }

    isProgrammaticLogScrollRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior });
    window.setTimeout(() => {
      isProgrammaticLogScrollRef.current = false;
    }, behavior === 'smooth' ? 280 : 0);
  }, []);

  useEffect(() => {
    const preferredTheme = resolveClientThemePreference();
    if (preferredTheme && preferredTheme !== editorTheme) {
      dispatch(setUserStyle(preferredTheme));
    }
  }, [dispatch, editorTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(PANEL_STATE_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      const panelProjectList = parsed?.panelProjectList || parsed?.panels || {};
      const panelProjectExplorer = parsed?.panelProjectExplorer || {};
      const uiInteractions = parsed?.uiInteractions || {};

      if (panelProjectList && typeof panelProjectList === 'object') {
        dispatch(setPanelProjectListLayout({
          leftWidthPct: panelProjectList.leftWidthPct,
        }));
        if (typeof panelProjectList.selectedProjectPath === 'string') {
          dispatch(setPanelProjectListSelectedProject(panelProjectList.selectedProjectPath));
        }
      }

      if (panelProjectExplorer && typeof panelProjectExplorer === 'object') {
        dispatch(setPanelProjectExplorerMode(panelProjectExplorer.mode));
        if (typeof panelProjectExplorer.isFollowMode === 'boolean') {
          dispatch(setPanelProjectExplorerFollowMode(panelProjectExplorer.isFollowMode));
        }
      }

      if (uiInteractions && typeof uiInteractions === 'object') {
        dispatch(setUiLeftPanelMode(uiInteractions.leftPanelMode));
        dispatch(setUiHostsSidebarCollapsed(Boolean(uiInteractions.hostsSidebarCollapsed)));
        dispatch(setUiHostsSidebarWidthPx(uiInteractions.hostsSidebarWidthPx));
        dispatch(setUiSelectedHostId(uiInteractions.selectedHostId));
        dispatch(setUiActiveLogContextKey(uiInteractions.activeLogContextKey));
        dispatch(setUiSelectedLogServices(
          Array.isArray(uiInteractions.selectedLogServices) ? uiInteractions.selectedLogServices : [],
        ));
        dispatch(setUiDisabledLogLevels(
          Array.isArray(uiInteractions.disabledLogLevels) ? uiInteractions.disabledLogLevels : [],
        ));
      }
    } catch {
      // ignore invalid storage data
    }
  }, [dispatch]);

  useEffect(() => {
    if (!wsEndpoint) {
      return undefined;
    }

    dispatch(connectHomeRealtime(wsEndpoint));
    return () => {
      dispatch(disconnectHomeRealtime());
    };
  }, [dispatch, wsEndpoint]);

  const setError = useCallback((valueOrUpdater) => {
    const currentValue = String(error || '');
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    dispatch(setUiError(String(nextValue || '')));
  }, [dispatch, error]);

  const setLeftPanelMode = useCallback((valueOrUpdater) => {
    const currentValue = String(leftPanelMode || LEFT_PANEL_MODE.PROJECTS);
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    dispatch(setUiLeftPanelMode(String(nextValue || LEFT_PANEL_MODE.PROJECTS)));
  }, [dispatch, leftPanelMode]);

  const setHostsSidebarCollapsed = useCallback((valueOrUpdater) => {
    const currentValue = Boolean(hostsSidebarCollapsed);
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    dispatch(setUiHostsSidebarCollapsed(Boolean(nextValue)));
  }, [dispatch, hostsSidebarCollapsed]);

  const setSelectedHostId = useCallback((valueOrUpdater) => {
    const currentValue = selectedHostId ?? null;
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    dispatch(setUiSelectedHostId(nextValue));
  }, [dispatch, selectedHostId]);

  const setShowAddHostRow = useCallback((value) => {
    dispatch(setHomeDomainField('showAddHostRow', Boolean(value)));
  }, [dispatch]);

  const setManualHostIp = useCallback((value) => {
    dispatch(setHomeDomainField('manualHostIp', String(value || '')));
  }, [dispatch]);

  const setResizing = useCallback((valueOrUpdater) => {
    const currentValue = Boolean(resizing);
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    dispatch(setUiResizing(Boolean(nextValue)));
  }, [dispatch, resizing]);

  const setDebugExpandedPaths = useCallback((valueOrUpdater) => {
    const currentValue = new Set(
      Array.isArray(debugExpandedPathsRef.current) ? debugExpandedPathsRef.current : [],
    );
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    const normalized = Array.isArray(nextValue)
      ? nextValue
      : nextValue instanceof Set
        ? Array.from(nextValue)
        : [];
    dispatch(setUiDebugExpandedPaths(normalized));
  }, [dispatch]);

  const setProjects = useCallback((value) => {
    dispatch(setHomeDomainField('projects', Array.isArray(value) ? value : []));
  }, [dispatch]);

  const setHosts = useCallback((value) => {
    dispatch(setHomeDomainField('hosts', Array.isArray(value) ? value : []));
  }, [dispatch]);

  const setHostsLoading = useCallback((value) => {
    dispatch(setHomeDomainField('hostsLoading', Boolean(value)));
  }, [dispatch]);

  const setTerminalSessionByHostId = useCallback((value) => {
    dispatch(setHomeDomainField('terminalSessionByHostId', value && typeof value === 'object' ? value : {}));
  }, [dispatch]);

  const setTerminalOutputBySessionId = useCallback((value) => {
    dispatch(setHomeDomainField('terminalOutputBySessionId', value && typeof value === 'object' ? value : {}));
  }, [dispatch]);

  const setScannedAt = useCallback((value) => {
    dispatch(setHomeDomainField('scannedAt', String(value || '')));
  }, [dispatch]);

  const setDiscoveryConfig = useCallback((value) => {
    dispatch(setHomeDomainField('discoveryConfig', value && typeof value === 'object' ? value : {
      projectPath: '',
      folderPattern: '',
      maxDepth: null,
    }));
  }, [dispatch]);

  const setLoading = useCallback((value) => {
    dispatch(setHomeDomainField('loading', Boolean(value)));
  }, [dispatch]);

  const setRuntimeBackendInfo = useCallback((value) => {
    dispatch(setHomeDomainField('runtimeBackendInfo', value && typeof value === 'object' ? value : null));
  }, [dispatch]);

  const setRuntimeBackendInfoLoading = useCallback((value) => {
    dispatch(setHomeDomainField('runtimeBackendInfoLoading', Boolean(value)));
  }, [dispatch]);

  const setProjectLogs = useCallback((value) => {
    dispatch(setHomeDomainField('projectLogs', Array.isArray(value) ? value : []));
  }, [dispatch]);

  const setLogsLoading = useCallback((value) => {
    dispatch(setHomeDomainField('logsLoading', Boolean(value)));
  }, [dispatch]);

  const setProjectEnvironment = useCallback((value) => {
    dispatch(setHomeDomainField('projectEnvironment', Array.isArray(value) ? value : []));
  }, [dispatch]);

  const setEnvironmentLoading = useCallback((value) => {
    dispatch(setHomeDomainField('environmentLoading', Boolean(value)));
  }, [dispatch]);

  const setProjectPortRangeSettings = useCallback((value) => {
    dispatch(setHomeDomainField('projectPortRangeSettings', value && typeof value === 'object'
      ? value
      : normalizePortRangeSettings(null)));
  }, [dispatch]);

  const setProjectPortRangeSettingsLoading = useCallback((value) => {
    dispatch(setHomeDomainField('projectPortRangeSettingsLoading', Boolean(value)));
  }, [dispatch]);

  const setProjectPortRangeSettingsSaving = useCallback((value) => {
    dispatch(setHomeDomainField('projectPortRangeSettingsSaving', Boolean(value)));
  }, [dispatch]);

  const setManualPortRangeInput = useCallback((value) => {
    dispatch(setHomeDomainField('manualPortRangeInput', String(value || '')));
  }, [dispatch]);

  const setProjectProcessStats = useCallback((value) => {
    dispatch(setHomeDomainField('projectProcessStats', Array.isArray(value) ? value : []));
  }, [dispatch]);

  const setProcessStatsLoading = useCallback((value) => {
    dispatch(setHomeDomainField('processStatsLoading', Boolean(value)));
  }, [dispatch]);

  const setSeenLogServicesByProject = useCallback((value) => {
    dispatch(setHomeDomainField('seenLogServicesByProject', value && typeof value === 'object' ? value : {}));
  }, [dispatch]);

  const { bootstrapRuntimeVariables, loadRuntimeBackendInfo } = useRuntimeQueries({
    dispatch,
    graphqlEndpoint,
    setError,
    setRuntimeBackendInfo,
    setRuntimeBackendInfoLoading,
  });
  const { loadSlaveRuntimeBundle } = useRuntimeRegistryQueries({
    graphqlEndpoint,
    setError,
    setRuntimeRegistryByHostId,
    setRuntimeRegistryLoadingByHostId,
  });
  const { loadDashboard } = useDashboardQueries({
    setLoading,
    setProjects,
    setScannedAt,
    setDiscoveryConfig,
  });
  const {
    loadProjectLogs,
    loadProjectPortRangeSettings,
    loadProjectEnvironment,
    loadProjectProcessStats,
  } = useProjectQueries({
    graphqlEndpoint,
    selectedProjectPath,
    setError,
    projectLogsRef,
    setLogsLoading,
    setProjectLogs,
    setProjectPortRangeSettings,
    setManualPortRangeInput,
    setProjectPortRangeSettingsLoading,
    setEnvironmentLoading,
    setProjectEnvironment,
    setProcessStatsLoading,
    setProjectProcessStats,
  });

  const {
    loadTerminalSession,
    startTerminalSessionForHost,
    onTerminalInputChange,
    onSubmitTerminalInput,
  } = useTerminalActions({
    dispatch,
    graphqlEndpoint,
    selectedHostId,
    terminalInputByHostId,
    terminalStartingByHostId,
    terminalSendingByHostId,
    terminalSessionByHostId,
    terminalOutputBySessionId,
    setTerminalSessionByHostId,
    setTerminalOutputBySessionId,
    setError,
  });
  const {
    ensureDesiredProcess,
    softKillProcess,
    hardKillProcess,
  } = useRuntimeRegistryActions({
    graphqlEndpoint,
    setError,
    setRuntimeActionBusyByHostId,
    loadSlaveRuntimeBundle,
  });

  useEffect(() => {
    let active = true;

    const run = async () => {
      setError('');
      try {
        const runtime = await bootstrapRuntimeVariables();
        if (!active) {
          return;
        }
        await loadDashboard(runtime.graphqlEndpoint || '/graphql');
      } catch (scanError) {
        if (!active) {
          return;
        }
        setError(scanError.message || 'Unable to load dashboard');
      }
    };

    run();
    return () => {
      active = false;
    };
  }, [bootstrapRuntimeVariables, loadDashboard, setError]);

  useEffect(() => {
    if (rightTab !== RIGHT_PANE_TAB.RUNTIME) {
      return;
    }
    loadRuntimeBackendInfo(graphqlEndpoint);
  }, [graphqlEndpoint, loadRuntimeBackendInfo, rightTab]);

  useEffect(() => {
    if (typeof window === 'undefined' || !runtimeConfig) {
      return;
    }
    window.__RUNTIME_CONFIG__ = runtimeConfig;
  }, [runtimeConfig]);

  useEffect(() => {
    const validHostIds = new Set(
      (Array.isArray(hosts) ? hosts : [])
        .map((host) => Number(host?.id))
        .filter((hostId) => Number.isInteger(hostId) && hostId > 0),
    );

    setRuntimeRegistryByHostId((current) => (
      Object.fromEntries(
        Object.entries(current || {}).filter(([hostId]) => validHostIds.has(Number(hostId))),
      )
    ));
    setRuntimeRegistryLoadingByHostId((current) => (
      Object.fromEntries(
        Object.entries(current || {}).filter(([hostId, loadingValue]) => (
          Boolean(loadingValue) && validHostIds.has(Number(hostId))
        )),
      )
    ));
    setRuntimeActionBusyByHostId((current) => (
      Object.fromEntries(
        Object.entries(current || {}).filter(([hostId, busy]) => (
          Boolean(busy) && validHostIds.has(Number(hostId))
        )),
      )
    ));
  }, [hosts]);

  useEffect(() => {
    if (!selectedProcessLogTarget) {
      return;
    }
    const targetHostId = Number(selectedProcessLogTarget?.hostId || 0);
    const selectedId = Number(selectedHost?.id || 0);
    if (leftPanelMode === LEFT_PANEL_MODE.PROJECTS || !Number.isInteger(selectedId) || selectedId <= 0) {
      setSelectedProcessLogTarget(null);
      return;
    }
    if (Number.isInteger(targetHostId) && targetHostId > 0 && targetHostId !== selectedId) {
      setSelectedProcessLogTarget(null);
    }
  }, [leftPanelMode, selectedHost, selectedProcessLogTarget]);

  useEffect(() => {
    if (!isGoMasterBackend || !selectedHost) {
      return undefined;
    }
    const hostId = Number(selectedHost?.id || 0);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      return undefined;
    }
    const agentUuid = String(selectedHost?.agentUuid || '').trim() || null;
    let active = true;
    let intervalId = null;

    const refresh = async () => {
      try {
        await loadSlaveRuntimeBundle({
          hostId,
          agentUuid,
        });
      } catch {
        // errors are surfaced through setError inside the hook
      }
    };

    refresh();
    if (typeof window !== 'undefined') {
      intervalId = window.setInterval(() => {
        if (!active) {
          return;
        }
        refresh();
      }, 1000);
    }

    return () => {
      active = false;
      if (intervalId != null) {
        window.clearInterval(intervalId);
      }
    };
  }, [isGoMasterBackend, loadSlaveRuntimeBundle, selectedHost]);

  const layoutState = useHomeLayoutController({
    dispatch,
    hostsSidebarCollapsed,
    resizing,
    setResizing,
    workspaceRef,
    mainPanelsRef,
    resizingRef,
    resizingHandleRef,
  });

  const selectedProjectServiceKeys = useMemo(
    () => getDiscoveredServiceKeys(selectedProject?.services || []),
    [selectedProject],
  );
  const hasActiveTerminalSession = selectedTerminalSession?.status === 'active';
  const selectedHostRuntimeBundle = useMemo(() => {
    if (!Number.isInteger(selectedHostNumericId) || selectedHostNumericId <= 0) {
      return null;
    }
    const bundle = runtimeRegistryByHostId?.[selectedHostNumericId];
    return bundle && typeof bundle === 'object' ? bundle : null;
  }, [runtimeRegistryByHostId, selectedHostNumericId]);
  const selectedHostSlaveRuntimeState = selectedHostRuntimeBundle?.slaveRuntimeState || null;
  const selectedHostDesiredProcesses = Array.isArray(selectedHostRuntimeBundle?.desiredProcesses)
    ? selectedHostRuntimeBundle.desiredProcesses
    : [];
  const selectedHostObservedProcessRuns = Array.isArray(selectedHostRuntimeBundle?.observedProcessRuns)
    ? selectedHostRuntimeBundle.observedProcessRuns
    : [];
  const selectedHostHostRuntimeState = selectedHostSlaveRuntimeState?.hostRuntimeState
    || selectedHostRuntimeBundle?.hostRuntimeState
    || null;
  const selectedHostRuntimeLoading = Boolean(
    Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0
      ? runtimeRegistryLoadingByHostId?.[selectedHostNumericId]
      : false,
  );
  const selectedHostRuntimeActionBusy = Boolean(
    Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0
      ? runtimeActionBusyByHostId?.[selectedHostNumericId]
      : false,
  );

  useEffect(() => {
    if (rightTab !== RIGHT_PANE_TAB.TERMINAL) {
      return;
    }
    if (!Number.isInteger(selectedHostNumericId) || selectedHostNumericId <= 0) {
      return;
    }

    const hasSessionEntry = Object.prototype.hasOwnProperty.call(
      terminalSessionByHostId,
      selectedHostNumericId,
    );
    if (!hasSessionEntry) {
      loadTerminalSession(selectedHostNumericId).catch((terminalError) => {
        setError(terminalError.message || 'Unable to load terminal session');
      });
      return;
    }

    const currentSession = normalizeTerminalSession(terminalSessionByHostId?.[selectedHostNumericId]);
    if (!currentSession && !terminalStartingByHostId?.[selectedHostNumericId]) {
      startTerminalSessionForHost(selectedHost).catch((terminalError) => {
        setError(terminalError.message || 'Unable to start terminal session');
      });
    }
  }, [
    loadTerminalSession,
    rightTab,
    selectedHost,
    selectedHostNumericId,
    setError,
    startTerminalSessionForHost,
    terminalSessionByHostId,
    terminalStartingByHostId,
  ]);

  useEffect(() => {
    if (rightTab !== RIGHT_PANE_TAB.TERMINAL || !hasActiveTerminalSession) {
      return;
    }
    const container = terminalOutputRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [
    hasActiveTerminalSession,
    rightTab,
    selectedTerminalOutput.length,
    selectedTerminalSession?.sessionId,
  ]);

  useEffect(() => {
    if (!selectedProjectPath || rightTab !== RIGHT_PANE_TAB.ENVIRONMENT) {
      return;
    }
    loadProjectEnvironment({ projectPath: selectedProjectPath });
    loadProjectPortRangeSettings({ projectPath: selectedProjectPath });
  }, [loadProjectEnvironment, loadProjectPortRangeSettings, rightTab, selectedProjectPath]);

  useEffect(() => {
    if (!selectedProjectPath || rightTab !== RIGHT_PANE_TAB.TOP) {
      return undefined;
    }

    loadProjectProcessStats({
      projectPath: selectedProjectPath,
      background: false,
    });

    const interval = window.setInterval(() => {
      loadProjectProcessStats({
        projectPath: selectedProjectPath,
        background: true,
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [loadProjectProcessStats, rightTab, selectedProjectPath]);

  const saveProjectPortRangeSettings = useCallback(async ({ mode, begin }) => {
    if (!selectedProjectPath) {
      return null;
    }

    setError('');
    setProjectPortRangeSettingsSaving(true);
    try {
      const data = await graphqlRequest({
        query: MUTATION_SET_PROJECT_PORT_RANGE_SETTINGS,
        variables: {
          projectPath: selectedProjectPath,
          mode,
          begin: Number.isInteger(begin) ? begin : null,
        },
        endpoint: graphqlEndpoint,
      });
      const normalized = normalizePortRangeSettings(data?.setProjectPortRangeSettings);
      setProjectPortRangeSettings(normalized);
      setManualPortRangeInput(normalized.begin != null ? String(normalized.begin) : '');
      await loadProjectEnvironment({ projectPath: selectedProjectPath });
      return normalized;
    } catch (settingsError) {
      setError(settingsError.message || 'Unable to save project port range settings');
      return null;
    } finally {
      setProjectPortRangeSettingsSaving(false);
    }
  }, [
    graphqlEndpoint,
    loadProjectEnvironment,
    selectedProjectPath,
    setError,
    setManualPortRangeInput,
    setProjectPortRangeSettings,
    setProjectPortRangeSettingsSaving,
  ]);

  const onSelectPortRangeMode = useCallback(async (mode) => {
    if (mode === PORT_RANGE_MODE.AUTOMATIC) {
      await saveProjectPortRangeSettings({
        mode: PORT_RANGE_MODE.AUTOMATIC,
        begin: null,
      });
      return;
    }

    await saveProjectPortRangeSettings({
      mode: PORT_RANGE_MODE.MANUAL,
      begin: projectPortRangeSettings.begin,
    });
  }, [projectPortRangeSettings.begin, saveProjectPortRangeSettings]);

  const onAcceptManualPortRange = useCallback(async () => {
    const parsed = Number.parseInt(String(manualPortRangeInput || '').trim(), 10);
    if (!Number.isInteger(parsed) || parsed < PORT_RANGE_BEGIN_MIN || parsed > PORT_RANGE_BEGIN_MAX) {
      setError(`Port range start must be an integer from ${PORT_RANGE_BEGIN_MIN} to ${PORT_RANGE_BEGIN_MAX}.`);
      return;
    }

    await saveProjectPortRangeSettings({
      mode: PORT_RANGE_MODE.MANUAL,
      begin: parsed,
    });
  }, [manualPortRangeInput, saveProjectPortRangeSettings, setError]);

  const isManualPortRangeMode = projectPortRangeSettings.mode === PORT_RANGE_MODE.MANUAL;
  const hasAcceptedManualPortRange = (
    isManualPortRangeMode &&
    Number.isInteger(projectPortRangeSettings.begin) &&
    projectPortRangeSettings.begin >= PORT_RANGE_BEGIN_MIN &&
    projectPortRangeSettings.begin <= PORT_RANGE_BEGIN_MAX
  );
  const portRangeControlsDisabled = projectPortRangeSettingsLoading || projectPortRangeSettingsSaving;
  const manualPortRangeValue = hasAcceptedManualPortRange
    ? String(projectPortRangeSettings.begin)
    : manualPortRangeInput;

  const masterConnectionStatus = String(masterAgentInfo?.connectionStatus || '').trim().toLowerCase() || (
    isGoMasterBackend ? 'connecting' : 'n/a'
  );
  const masterConnectionHealthClass = toConnectionHealthClassName(masterAgentInfo?.connectionHealth);
  const masterConnectionLabel = isGoMasterBackend
    ? `Master link: ${masterConnectionStatus}`
    : 'Master link: n/a';

  const hostsSidebarState = useHostsSidebarController({
    dispatch,
    graphqlEndpoint,
    setError,
    setLeftPanelMode,
    setHostsSidebarCollapsed,
    setSelectedHostId,
    setShowAddHostRow,
    setManualHostIp,
    setHostsLoading,
    setHosts,
    setTerminalSessionByHostId,
    hostsSidebarCollapsed,
    hostsSidebarWidthPx,
    hostsLoading,
    addingHost,
    deletingHostId,
    hosts,
    showAddHostRow,
    manualHostIp,
    selectedHostId,
    isMasterSidebarSelected,
    masterConnectionHealthClass,
    masterConnectionStatus,
    masterAgentInfo,
    showAddDirectoryRowByHostId,
    directoryInputByHostId,
    directoryMutationBusyByHostId,
    showCheckoutRowByHostId,
    checkoutRepoInputByHostId,
    checkoutBaseDirectoryByHostId,
    checkoutDestinationByHostId,
    checkoutAutoDestinationByHostId,
    checkoutMutationBusyByHostId,
    terminalInputByHostId,
    terminalStartingByHostId,
    terminalSendingByHostId,
    terminalSessionByHostId,
    slaveTargetVersion,
    upgradingHostId,
    runtimeRegistryByHostId,
    runtimeRegistryLoadingByHostId,
    runtimeActionBusyByHostId,
    onViewManagedProcessLogs,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    toHostHealthClassName,
    normalizeHostDirectories,
    isHostVersionOutOfDate,
    deriveDestinationFolderFromRepositoryUrl,
    formatVersionWithProtocol,
    formatRuntimeDateTime,
  });

  const projectsPaneState = useProjectsPaneController({
    dispatch,
    graphqlEndpoint,
    setError,
    setLeftPanelMode,
    loadDashboard,
    loadProjectEnvironment,
    loadProjectLogs,
    leftWidthPct,
    projects,
    loading,
    selectedProjectPath,
    normalizeServiceKey,
    getDiscoveredServiceKeys,
    buildUniqueIconsForServices,
    serviceIconDefs: SERVICE_ICON_DEFS,
    formatServiceLabel,
    orderedTypeIconKeys: ORDERED_TYPE_ICON_KEYS,
    projectTypeIcons: PROJECT_TYPE_ICONS,
  });

  const logsPanelState = useLogsPanelController({
    dispatch,
    leftPanelMode,
    rightTab,
    followLogs,
    selectedProjectPath,
    projectLogs,
    overlayLogs,
    logsQueryEntriesByContext,
    logsLoading,
    selectedProject,
    selectedHost,
    isMasterSidebarSelected,
    selectedLogServices,
    disabledLogLevels,
    seenLogServicesByProject,
    setSeenLogServicesByProject,
    selectedProcessLogTarget,
    loadProjectLogs,
    setProjectLogs,
    setProjectEnvironment,
    setProjectPortRangeSettings,
    setManualPortRangeInput,
    setProjectProcessStats,
    normalizePortRangeSettings,
    logStreamRef,
    projectLogsRef,
    isProgrammaticLogScrollRef,
    overlayLogSeedRef,
    scrollLogsToEnd,
    editorTheme,
    selectedProjectServiceKeys,
    buildUniqueIconsForServices,
    toCanonicalServiceIconKey,
    renderLogTagRow,
  });

  const debugData = useMemo(() => (
    selectedProject
      ? {
        name: selectedProject.name,
        path: selectedProject.path,
        relativePath: selectedProject.relativePath,
        runtimeStatus: selectedProject.runtimeStatus,
        runtimePid: selectedProject.runtimePid,
        runtimePorts: selectedProject.runtimePorts || [],
        runtimePortRangeBegin: selectedProject.runtimePortRangeBegin ?? null,
        runtimePortRangeEnd: selectedProject.runtimePortRangeEnd ?? null,
        runtimeServicePorts: selectedProject.runtimeServicePorts || {},
        runtimeServicePids: selectedProject.runtimeServicePids || {},
        runtimeServiceStates: selectedProject.runtimeServiceStates || {},
        runtimeServiceEntries: selectedProject.runtimeServiceEntries || [],
        runtimeLastExitCode: selectedProject.runtimeLastExitCode ?? null,
        stack: selectedProject.types || [],
        enabledServices: selectedProject.services || [],
        hasMakefile: Boolean(selectedProject.hasMakefile),
        declaredServices: (selectedProject.declaredServices || []).map((service) => ({
          ...service,
          effectiveEnvVarMap: Object.fromEntries(
            (service.effectiveEnvVarMap || []).map((entry) => [entry.key, entry.value]),
          ),
        })),
      }
      : null
  ), [selectedProject]);

  useEffect(() => {
    setDebugExpandedPaths(getDefaultDebugExpandedPaths(selectedProject));
  }, [selectedProject, setDebugExpandedPaths]);

  const toggleDebugPath = useCallback((path) => {
    setDebugExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, [setDebugExpandedPaths]);

  const debugPanelState = useMemo(() => ({
    selectedProject,
    debugData,
    debugExpandedPaths,
    toggleDebugPath,
  }), [debugData, debugExpandedPaths, selectedProject, toggleDebugPath]);

  const environmentPanelState = useMemo(() => ({
    selectedProject,
    projectPortRangeSettings,
    onSelectPortRangeMode,
    portRangeControlsDisabled,
    isManualPortRangeMode,
    manualPortRangeValue,
    hasAcceptedManualPortRange,
    setManualPortRangeInput,
    onAcceptManualPortRange,
    environmentLoading,
    projectEnvironment,
  }), [
    environmentLoading,
    hasAcceptedManualPortRange,
    isManualPortRangeMode,
    manualPortRangeValue,
    onAcceptManualPortRange,
    onSelectPortRangeMode,
    portRangeControlsDisabled,
    projectEnvironment,
    projectPortRangeSettings,
    selectedProject,
    setManualPortRangeInput,
  ]);

  const topPanelState = useMemo(() => ({
    selectedProject,
    processStatsLoading,
    projectProcessStats,
  }), [processStatsLoading, projectProcessStats, selectedProject]);

  const onStartTerminalSession = useCallback(() => {
    if (!selectedHost) {
      setError('Select a slave agent before starting a terminal session.');
      return;
    }
    startTerminalSessionForHost(selectedHost).catch((terminalError) => {
      setError(terminalError.message || 'Unable to start terminal session');
    });
  }, [selectedHost, setError, startTerminalSessionForHost]);

  const onRefreshSelectedHostRuntime = useCallback(() => {
    if (!selectedHost) {
      return Promise.resolve(null);
    }
    return loadSlaveRuntimeBundle({
      hostId: selectedHost.id,
      agentUuid: selectedHost.agentUuid,
    });
  }, [loadSlaveRuntimeBundle, selectedHost]);

  const onViewManagedProcessLogs = useCallback((host, observedRun) => {
    const hostId = Number(host?.id || 0);
    const runId = String(observedRun?.runId || '').trim();
    if (!Number.isInteger(hostId) || hostId <= 0 || !runId) {
      setError('Unable to open managed process logs: missing host or run id.');
      return;
    }
    setError('');
    setSelectedProcessLogTarget({
      hostId,
      hostName: String(host?.name || '').trim() || null,
      hostIp: String(host?.ip || '').trim() || null,
      hostAgentUuid: String(host?.agentUuid || observedRun?.slaveId || '').trim() || null,
      runId,
      processKey: String(observedRun?.processKey || '').trim() || null,
      packageKey: String(observedRun?.packageKey || observedRun?.processKey || '').trim() || null,
      logPath: String(observedRun?.logPath || '').trim() || null,
    });
    dispatch(setPanelProjectExplorerMode(RIGHT_PANE_TAB.LOGS));
  }, [dispatch, setError]);

  const onSoftKillObservedProcess = useCallback((host, observedRun) => {
    if (!host || !observedRun) {
      return Promise.resolve(null);
    }
    return softKillProcess({
      hostId: host.id,
      agentUuid: host.agentUuid,
      runId: observedRun.runId,
      processKey: observedRun.processKey,
      pid: observedRun.pid,
      reason: 'Requested from runtime UI',
    });
  }, [softKillProcess]);

  const onHardKillObservedProcess = useCallback((host, observedRun) => {
    if (!host || !observedRun) {
      return Promise.resolve(null);
    }
    return hardKillProcess({
      hostId: host.id,
      agentUuid: host.agentUuid,
      runId: observedRun.runId,
      processKey: observedRun.processKey,
      pid: observedRun.pid,
      reason: 'Requested from runtime UI',
    });
  }, [hardKillProcess]);

  const runtimePanelState = useMemo(() => ({
    runtimeConfig,
    runtimeBackendInfo,
    runtimeBackendInfoLoading,
    masterAgentInfo,
    isGoMasterBackend,
    selectedHost,
    selectedProject,
    slaveRuntimeState: selectedHostSlaveRuntimeState,
    desiredProcesses: selectedHostDesiredProcesses,
    observedProcessRuns: selectedHostObservedProcessRuns,
    hostRuntimeState: selectedHostHostRuntimeState,
    runtimeLoading: selectedHostRuntimeLoading,
    runtimeActionBusy: selectedHostRuntimeActionBusy,
    onRefreshSelectedHostRuntime,
    onEnsureDesiredProcess: ensureDesiredProcess,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    onViewManagedProcessLogs,
    formatRuntimeDateTime,
    formatVersionWithProtocol,
  }), [
    ensureDesiredProcess,
    isGoMasterBackend,
    onHardKillObservedProcess,
    onRefreshSelectedHostRuntime,
    onSoftKillObservedProcess,
    onViewManagedProcessLogs,
    masterAgentInfo,
    selectedHost,
    selectedHostDesiredProcesses,
    selectedHostHostRuntimeState,
    selectedHostObservedProcessRuns,
    selectedHostRuntimeActionBusy,
    selectedHostRuntimeLoading,
    selectedHostSlaveRuntimeState,
    selectedProject,
    runtimeBackendInfo,
    runtimeBackendInfoLoading,
    runtimeConfig,
  ]);

  const terminalPanelState = useMemo(() => ({
    selectedHost,
    selectedHostNumericId,
    selectedTerminalSession,
    selectedTerminalOutput,
    selectedHostTerminalInput,
    selectedHostTerminalStarting,
    selectedHostTerminalSending,
    onTerminalInputChange: (value) => {
      onTerminalInputChange(selectedHostNumericId, value);
    },
    onSubmitTerminalInput,
    onStartTerminalSession,
    terminalOutputRef,
  }), [
    onSubmitTerminalInput,
    onStartTerminalSession,
    onTerminalInputChange,
    selectedHost,
    selectedHostNumericId,
    selectedHostTerminalInput,
    selectedHostTerminalSending,
    selectedHostTerminalStarting,
    selectedTerminalOutput,
    selectedTerminalSession,
  ]);

  const onSelectRightTab = useCallback((tab) => {
    const normalizedTab = String(tab || '').trim().toLowerCase();
    dispatch(setPanelProjectExplorerMode(normalizedTab));
  }, [dispatch]);

  const rightPaneState = useRightPaneController({
    rightTab,
    onSelectRightTab,
  });

  const statusBarState = useStatusBarController({
    loading,
    projectsCount: projects.length,
    runningCount,
    error,
    scannedAt,
    masterConnectionHealthClass,
    masterConnectionLabel,
    selectedProject,
  });

  return (
    <HomeLayoutProvider value={layoutState}>
      <HostsSidebarProvider value={hostsSidebarState}>
        <ProjectsPaneProvider value={projectsPaneState}>
          <RightPaneProvider value={rightPaneState}>
            <LogsPanelProvider value={logsPanelState}>
              <DebugPanelProvider value={debugPanelState}>
                <EnvironmentPanelProvider value={environmentPanelState}>
                  <TopPanelProvider value={topPanelState}>
                    <RuntimePanelProvider value={runtimePanelState}>
                      <TerminalPanelProvider value={terminalPanelState}>
                        <StatusBarProvider value={statusBarState}>
                          <HomePageShellContainer />
                        </StatusBarProvider>
                      </TerminalPanelProvider>
                    </RuntimePanelProvider>
                  </TopPanelProvider>
                </EnvironmentPanelProvider>
              </DebugPanelProvider>
            </LogsPanelProvider>
          </RightPaneProvider>
        </ProjectsPaneProvider>
      </HostsSidebarProvider>
    </HomeLayoutProvider>
  );
}
