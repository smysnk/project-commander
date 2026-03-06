import { useCallback, useEffect, useMemo } from 'react';
import { graphqlRequest } from '../../../lib/graphqlClient';
import { setPanelProjectListSelectedProject } from '../../../store';
import { LEFT_PANEL_MODE } from '../constants/ui';
import {
  MUTATION_RESTART_SERVICE_RUNTIME,
  MUTATION_TOGGLE_PROJECT_RUNTIME,
  MUTATION_TOGGLE_SERVICE_RUNTIME,
} from '../graphql/documents';

export default function useProjectsPaneController({
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
  serviceIconDefs,
  formatServiceLabel,
  orderedTypeIconKeys,
  projectTypeIcons,
}) {
  useEffect(() => {
    if (!selectedProjectPath && projects.length > 0) {
      dispatch(setPanelProjectListSelectedProject(projects[0].path));
      return;
    }

    if (selectedProjectPath && !projects.some((project) => project.path === selectedProjectPath)) {
      dispatch(setPanelProjectListSelectedProject(projects[0]?.path || ''));
    }
  }, [dispatch, projects, selectedProjectPath]);

  const onSelectProject = useCallback((projectPath) => {
    dispatch(setPanelProjectListSelectedProject(projectPath));
    setLeftPanelMode(LEFT_PANEL_MODE.PROJECTS);
  }, [dispatch, setLeftPanelMode]);

  const onToggleRuntime = useCallback(async (project, event) => {
    event.stopPropagation();
    setError('');
    dispatch(setPanelProjectListSelectedProject(project.path));
    setLeftPanelMode(LEFT_PANEL_MODE.PROJECTS);

    await loadProjectLogs({
      projectPath: project.path,
      fullRefresh: true,
    });

    try {
      await graphqlRequest({
        query: MUTATION_TOGGLE_PROJECT_RUNTIME,
        variables: {
          projectPath: project.path,
          projectTypes: project.types,
        },
        endpoint: graphqlEndpoint,
      });

      await loadDashboard(graphqlEndpoint);
      await loadProjectEnvironment({ projectPath: project.path });
      await loadProjectLogs({
        projectPath: project.path,
        fullRefresh: true,
      });
    } catch (toggleError) {
      setError(toggleError.message || 'Unable to toggle project runtime');
    }
  }, [
    dispatch,
    graphqlEndpoint,
    loadDashboard,
    loadProjectEnvironment,
    loadProjectLogs,
    setLeftPanelMode,
    setError,
  ]);

  const onToggleServiceRuntime = useCallback(async ({
    projectPath,
    serviceKey,
    event,
    restart = false,
  }) => {
    event.stopPropagation();
    setError('');
    dispatch(setPanelProjectListSelectedProject(projectPath));
    setLeftPanelMode(LEFT_PANEL_MODE.PROJECTS);

    try {
      await graphqlRequest({
        query: restart ? MUTATION_RESTART_SERVICE_RUNTIME : MUTATION_TOGGLE_SERVICE_RUNTIME,
        variables: {
          projectPath,
          serviceKey,
        },
        endpoint: graphqlEndpoint,
      });
      await loadDashboard(graphqlEndpoint);
      await loadProjectEnvironment({ projectPath });
      await loadProjectLogs({
        projectPath,
        fullRefresh: true,
      });
    } catch (toggleError) {
      setError(toggleError.message || (restart
        ? 'Unable to restart service runtime'
        : 'Unable to toggle service runtime'));
    }
  }, [
    dispatch,
    graphqlEndpoint,
    loadDashboard,
    loadProjectEnvironment,
    loadProjectLogs,
    setLeftPanelMode,
    setError,
  ]);

  const getServiceState = useCallback(({ serviceStatus, isEnabled }) => {
    if (!isEnabled) {
      return 'unused';
    }
    if (serviceStatus === 'starting') {
      return 'starting';
    }
    if (serviceStatus === 'started') {
      return 'online';
    }
    if (serviceStatus === 'crashed') {
      return 'offline';
    }
    return 'disabled';
  }, []);

  const getAllServicesState = useCallback((project) => {
    const enabledKeys = getDiscoveredServiceKeys(project.services);

    if (enabledKeys.length === 0) {
      return {
        serviceState: 'unused',
        runtimeState: 'stopped',
        enabled: false,
      };
    }

    const runtimeEntryByKey = new Map(
      (project.runtimeServiceEntries || [])
        .map((entry) => ({
          key: normalizeServiceKey(entry?.key),
          pid: Number(entry?.pid),
          state: String(entry?.state || 'stopped').toLowerCase(),
        }))
        .filter((entry) => entry.key)
        .map((entry) => [entry.key, entry]),
    );

    const hasStartingWithPid = enabledKeys.some((key) => {
      const entry = runtimeEntryByKey.get(key);
      return entry?.state === 'starting' && Number.isInteger(entry?.pid) && entry.pid > 0;
    });
    if (hasStartingWithPid) {
      return { serviceState: 'starting', runtimeState: 'starting', enabled: true };
    }

    const hasStartedWithPid = enabledKeys.some((key) => {
      const entry = runtimeEntryByKey.get(key);
      return entry?.state === 'started' && Number.isInteger(entry?.pid) && entry.pid > 0;
    });
    if (hasStartedWithPid) {
      return { serviceState: 'online', runtimeState: 'started', enabled: true };
    }

    const hasCrashed = enabledKeys.some((key) => {
      const entry = runtimeEntryByKey.get(key);
      return entry?.state === 'crashed';
    });
    if (hasCrashed) {
      return { serviceState: 'offline', runtimeState: 'crashed', enabled: true };
    }
    return { serviceState: 'controlStopped', runtimeState: 'stopped', enabled: true };
  }, [getDiscoveredServiceKeys, normalizeServiceKey]);

  return useMemo(() => ({
    leftWidthPct,
    projects,
    loading,
    selectedProjectPath,
    onSelectProject,
    normalizeServiceKey,
    getDiscoveredServiceKeys,
    buildUniqueIconsForServices,
    SERVICE_ICON_DEFS: serviceIconDefs,
    formatServiceLabel,
    getServiceState,
    getAllServicesState,
    ORDERED_TYPE_ICON_KEYS: orderedTypeIconKeys,
    PROJECT_TYPE_ICONS: projectTypeIcons,
    onToggleServiceRuntime,
    onToggleRuntime,
  }), [
    buildUniqueIconsForServices,
    getAllServicesState,
    getDiscoveredServiceKeys,
    getServiceState,
    leftWidthPct,
    loading,
    formatServiceLabel,
    normalizeServiceKey,
    onSelectProject,
    onToggleRuntime,
    onToggleServiceRuntime,
    orderedTypeIconKeys,
    projectTypeIcons,
    projects,
    selectedProjectPath,
    serviceIconDefs,
  ]);
}
