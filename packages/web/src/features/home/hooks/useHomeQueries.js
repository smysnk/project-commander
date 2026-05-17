import { useCallback } from 'react';
import { graphqlRequest } from '../../../lib/graphqlClient';
import {
  setHomeDomainField,
  setRuntimeConfig,
} from '../../../store';
import {
  QUERY_DISCOVERY_DASHBOARD,
  QUERY_DEPLOYMENT_INSTANCES,
  QUERY_DESIRED_PROCESSES,
  QUERY_HOST_RUNTIME_ENV,
  QUERY_HOSTS,
  QUERY_HOST_PATH_MAPPINGS,
  QUERY_OBSERVED_PROCESS_RUNS,
  QUERY_PROJECT_ENVIRONMENT,
  QUERY_PROJECT_LOGS,
  QUERY_PROJECT_PORT_RANGE_SETTINGS,
  QUERY_PROJECT_PROCESS_STATS,
  QUERY_RUNTIME_BACKEND_INFO,
  QUERY_RUNTIME_CONFIG,
  QUERY_SLAVE_RUNTIME_STATE,
  QUERY_SLAVE_RUNTIME_TELEMETRY,
} from '../graphql/documents';
import { normalizeHostRecord } from '../lib/homeUtils';
import {
  normalizeDiscoveryConfig,
  normalizePortRangeSettings,
  normalizeRuntimeBackendInfo,
  normalizeRuntimeConfig,
} from '../lib/runtimeTransforms';

export const useRuntimeQueries = ({
  dispatch,
  graphqlEndpoint,
  setError,
  setRuntimeBackendInfo,
  setRuntimeBackendInfoLoading,
}) => {
  const bootstrapRuntimeVariables = useCallback(async () => {
    setRuntimeBackendInfoLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_RUNTIME_CONFIG,
        endpoint: '/graphql',
      });

      const normalized = normalizeRuntimeConfig(data?.runtimeConfig);
      dispatch(setRuntimeConfig({ config: normalized }));
      setRuntimeBackendInfo(normalizeRuntimeBackendInfo(data?.runtimeBackendInfo));
      return normalized;
    } finally {
      setRuntimeBackendInfoLoading(false);
    }
  }, [dispatch, setRuntimeBackendInfo, setRuntimeBackendInfoLoading]);

  const loadRuntimeBackendInfo = useCallback(async (endpoint) => {
    setRuntimeBackendInfoLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_RUNTIME_BACKEND_INFO,
        endpoint: endpoint || graphqlEndpoint,
      });
      setRuntimeBackendInfo(normalizeRuntimeBackendInfo(data?.runtimeBackendInfo));
    } catch (runtimeBackendError) {
      setError(runtimeBackendError.message || 'Unable to load runtime backend info');
    } finally {
      setRuntimeBackendInfoLoading(false);
    }
  }, [graphqlEndpoint, setError, setRuntimeBackendInfo, setRuntimeBackendInfoLoading]);

  return {
    bootstrapRuntimeVariables,
    loadRuntimeBackendInfo,
  };
};

export const useDashboardQueries = ({
  setLoading,
  setProjects,
  setScannedAt,
  setDiscoveryConfig,
}) => {
  const loadDashboard = useCallback(async (endpoint) => {
    setLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_DISCOVERY_DASHBOARD,
        endpoint: endpoint || '/graphql',
      });

      const discovered = data?.discoveredProjects || {};
      setProjects(discovered.projects || []);
      setScannedAt(discovered.scannedAt || '');
      setDiscoveryConfig(normalizeDiscoveryConfig(data?.discoveryConfig));
    } finally {
      setLoading(false);
    }
  }, [setDiscoveryConfig, setLoading, setProjects, setScannedAt]);

  return {
    loadDashboard,
  };
};

export const useHostQueries = ({
  dispatch,
  graphqlEndpoint,
  setError,
  setHostsLoading,
  setHosts,
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
  setTerminalSessionByHostId,
}) => {
  const loadHosts = useCallback(async (endpoint) => {
    setHostsLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_HOSTS,
        endpoint: endpoint || graphqlEndpoint,
      });
      const nextHosts = Array.isArray(data?.hosts) ? data.hosts.map((host) => normalizeHostRecord(host)) : [];
      setHosts(nextHosts);
      const nextHostIds = new Set(nextHosts.map((host) => Number(host?.id)).filter((id) => Number.isInteger(id) && id > 0));
      dispatch(setHomeDomainField('showAddDirectoryRowByHostId',
        Object.fromEntries(
          Object.entries(showAddDirectoryRowByHostId || {}).filter(([hostId, visible]) => (
            Boolean(visible) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setHomeDomainField('directoryInputByHostId',
        Object.fromEntries(
          Object.entries(directoryInputByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setHomeDomainField('directoryMutationBusyByHostId',
        Object.fromEntries(
          Object.entries(directoryMutationBusyByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setHomeDomainField('showCheckoutRowByHostId',
        Object.fromEntries(
          Object.entries(showCheckoutRowByHostId || {}).filter(([hostId, visible]) => (
            Boolean(visible) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setHomeDomainField('checkoutRepoInputByHostId',
        Object.fromEntries(
          Object.entries(checkoutRepoInputByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setHomeDomainField('checkoutBaseDirectoryByHostId',
        Object.fromEntries(
          Object.entries(checkoutBaseDirectoryByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setHomeDomainField('checkoutDestinationByHostId',
        Object.fromEntries(
          Object.entries(checkoutDestinationByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setHomeDomainField('checkoutAutoDestinationByHostId',
        Object.fromEntries(
          Object.entries(checkoutAutoDestinationByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setHomeDomainField('checkoutMutationBusyByHostId',
        Object.fromEntries(
          Object.entries(checkoutMutationBusyByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      setTerminalSessionByHostId(
        Object.fromEntries(
          Object.entries(terminalSessionByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      );
      dispatch(setHomeDomainField('terminalInputByHostId',
        Object.fromEntries(
          Object.entries(terminalInputByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setHomeDomainField('terminalStartingByHostId',
        Object.fromEntries(
          Object.entries(terminalStartingByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setHomeDomainField('terminalSendingByHostId',
        Object.fromEntries(
          Object.entries(terminalSendingByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
    } catch (hostsError) {
      setError(hostsError.message || 'Unable to load registered hosts');
    } finally {
      setHostsLoading(false);
    }
  }, [graphqlEndpoint]);

  return {
    loadHosts,
  };
};

export const useProjectQueries = ({
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
}) => {
  const loadProjectLogs = useCallback(async ({
    projectPath,
    fullRefresh = false,
    serviceNames,
  } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectLogs([]);
      return;
    }

    if (fullRefresh) {
      setLogsLoading(true);
    }

    try {
      const requestedServiceNames = Array.isArray(serviceNames)
        ? serviceNames
        : [];
      const variables = {
        projectPath: targetProjectPath,
        limit: fullRefresh ? 600 : 200,
        afterId: fullRefresh ? null : (projectLogsRef.current[projectLogsRef.current.length - 1]?.id || null),
        serviceNames: requestedServiceNames.length > 0 ? requestedServiceNames : null,
      };

      const data = await graphqlRequest({
        query: QUERY_PROJECT_LOGS,
        variables,
        endpoint: graphqlEndpoint,
      });

      const entries = data?.projectLogs || [];

      if (fullRefresh) {
        setProjectLogs(entries);
      } else if (entries.length > 0) {
        const current = Array.isArray(projectLogsRef.current) ? projectLogsRef.current : [];
        const seen = new Set(current.map((entry) => entry.id));
        const next = current.slice();
        for (const entry of entries) {
          if (!seen.has(entry.id)) {
            next.push(entry);
            seen.add(entry.id);
          }
        }
        if (next.length !== current.length) {
          setProjectLogs(next);
        }
      }
    } catch (logError) {
      if (fullRefresh) {
        setError(logError.message || 'Unable to load project logs');
      }
    } finally {
      if (fullRefresh) {
        setLogsLoading(false);
      }
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  const loadProjectPortRangeSettings = useCallback(async ({ projectPath } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectPortRangeSettings(normalizePortRangeSettings(null));
      setManualPortRangeInput('');
      return;
    }

    setProjectPortRangeSettingsLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_PROJECT_PORT_RANGE_SETTINGS,
        variables: { projectPath: targetProjectPath },
        endpoint: graphqlEndpoint,
      });
      const normalized = normalizePortRangeSettings(data?.projectPortRangeSettings);
      setProjectPortRangeSettings(normalized);
      setManualPortRangeInput(normalized.begin != null ? String(normalized.begin) : '');
    } catch (settingsError) {
      setError(settingsError.message || 'Unable to load project port range settings');
    } finally {
      setProjectPortRangeSettingsLoading(false);
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  const loadProjectEnvironment = useCallback(async ({ projectPath } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectEnvironment([]);
      return;
    }

    setEnvironmentLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_PROJECT_ENVIRONMENT,
        variables: { projectPath: targetProjectPath },
        endpoint: graphqlEndpoint,
      });
      setProjectEnvironment(data?.projectLaunchEnvironment || []);
    } catch (envError) {
      setError(envError.message || 'Unable to load launch environment');
    } finally {
      setEnvironmentLoading(false);
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  const loadProjectProcessStats = useCallback(async ({
    projectPath,
    background = false,
  } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectProcessStats([]);
      return;
    }

    if (!background) {
      setProcessStatsLoading(true);
    }

    try {
      const data = await graphqlRequest({
        query: QUERY_PROJECT_PROCESS_STATS,
        variables: { projectPath: targetProjectPath },
        endpoint: graphqlEndpoint,
      });
      setProjectProcessStats(data?.projectProcessStats || []);
    } catch (statsError) {
      if (!background) {
        setError(statsError.message || 'Unable to load process statistics');
      }
    } finally {
      if (!background) {
        setProcessStatsLoading(false);
      }
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  return {
    loadProjectLogs,
    loadProjectPortRangeSettings,
    loadProjectEnvironment,
    loadProjectProcessStats,
  };
};

export const useRuntimeRegistryQueries = ({
  graphqlEndpoint,
  setError,
  setRuntimeRegistryByHostId,
  setRuntimeRegistryLoadingByHostId,
}) => {
  const loadSlaveRuntimeBundle = useCallback(async ({
    hostId,
    agentUuid,
  } = {}) => {
    const parsedHostId = Number.parseInt(String(hostId ?? '').trim(), 10);
    const normalizedAgentUuid = String(agentUuid || '').trim();
    if ((!Number.isInteger(parsedHostId) || parsedHostId <= 0) && !normalizedAgentUuid) {
      return null;
    }

    const variables = {
      hostId: Number.isInteger(parsedHostId) && parsedHostId > 0 ? parsedHostId : null,
      agentUuid: normalizedAgentUuid || null,
    };
    const hostKey = Number.isInteger(parsedHostId) && parsedHostId > 0
      ? parsedHostId
      : normalizedAgentUuid;

    setRuntimeRegistryLoadingByHostId((current) => ({
      ...(current || {}),
      [hostKey]: true,
    }));

    try {
      const [
        runtimeStateData,
        desiredProcessesData,
        observedRunsData,
        hostPathMappingsData,
        deploymentInstancesData,
        hostRuntimeEnvData,
      ] = await Promise.all([
        graphqlRequest({
          query: QUERY_SLAVE_RUNTIME_STATE,
          variables,
          endpoint: graphqlEndpoint,
        }),
        graphqlRequest({
          query: QUERY_DESIRED_PROCESSES,
          variables,
          endpoint: graphqlEndpoint,
        }),
        graphqlRequest({
          query: QUERY_OBSERVED_PROCESS_RUNS,
          variables,
          endpoint: graphqlEndpoint,
        }),
        graphqlRequest({
          query: QUERY_HOST_PATH_MAPPINGS,
          variables: { ...variables, includeDisabled: true },
          endpoint: graphqlEndpoint,
        }),
        graphqlRequest({
          query: QUERY_DEPLOYMENT_INSTANCES,
          variables,
          endpoint: graphqlEndpoint,
        }),
        graphqlRequest({
          query: QUERY_HOST_RUNTIME_ENV,
          variables,
          endpoint: graphqlEndpoint,
        }),
      ]);

      const runtimeState = runtimeStateData?.slaveRuntimeState || null;
      const desiredProcesses = Array.isArray(desiredProcessesData?.desiredProcesses)
        ? desiredProcessesData.desiredProcesses
        : [];
      const observedProcessRuns = Array.isArray(observedRunsData?.observedProcessRuns)
        ? observedRunsData.observedProcessRuns
        : [];
      const hostPathMappings = Array.isArray(hostPathMappingsData?.hostPathMappings)
        ? hostPathMappingsData.hostPathMappings
        : [];
      const deploymentInstances = Array.isArray(deploymentInstancesData?.deploymentInstances)
        ? deploymentInstancesData.deploymentInstances
        : [];
      const hostRuntimeEnv = Array.isArray(hostRuntimeEnvData?.hostRuntimeEnv?.env)
        ? hostRuntimeEnvData.hostRuntimeEnv.env
        : [];
      const resolvedHostId = Number(runtimeState?.host?.id || parsedHostId || 0);
      const resolvedHostKey = Number.isInteger(resolvedHostId) && resolvedHostId > 0
        ? resolvedHostId
        : hostKey;

      const bundle = {
        slaveRuntimeState: runtimeState,
        desiredProcesses,
        observedProcessRuns,
        hostPathMappings,
        deploymentInstances,
        hostRuntimeEnv,
        loadedAt: new Date().toISOString(),
      };
      setRuntimeRegistryByHostId((current) => ({
        ...(current || {}),
        [resolvedHostKey]: bundle,
      }));
      return bundle;
    } catch (runtimeRegistryError) {
      setError(runtimeRegistryError.message || 'Unable to load slave runtime state');
      return null;
    } finally {
      setRuntimeRegistryLoadingByHostId((current) => ({
        ...(current || {}),
        [hostKey]: false,
      }));
    }
  }, [
    graphqlEndpoint,
    setError,
    setRuntimeRegistryByHostId,
    setRuntimeRegistryLoadingByHostId,
  ]);

  const loadSlaveRuntimeTelemetry = useCallback(async ({
    hostId,
    agentUuid,
  } = {}) => {
    const parsedHostId = Number.parseInt(String(hostId ?? '').trim(), 10);
    const normalizedAgentUuid = String(agentUuid || '').trim();
    if ((!Number.isInteger(parsedHostId) || parsedHostId <= 0) && !normalizedAgentUuid) {
      return null;
    }

    const variables = {
      hostId: Number.isInteger(parsedHostId) && parsedHostId > 0 ? parsedHostId : null,
      agentUuid: normalizedAgentUuid || null,
    };
    const hostKey = Number.isInteger(parsedHostId) && parsedHostId > 0
      ? parsedHostId
      : normalizedAgentUuid;

    try {
      const telemetryData = await graphqlRequest({
        query: QUERY_SLAVE_RUNTIME_TELEMETRY,
        variables,
        endpoint: graphqlEndpoint,
      });
      const runtimeState = telemetryData?.slaveRuntimeState || null;
      const observedProcessRuns = Array.isArray(runtimeState?.observedRuns)
        ? runtimeState.observedRuns
        : [];
      const resolvedHostId = Number(runtimeState?.host?.id || parsedHostId || 0);
      const resolvedHostKey = Number.isInteger(resolvedHostId) && resolvedHostId > 0
        ? resolvedHostId
        : hostKey;
      const loadedAt = new Date().toISOString();

      setRuntimeRegistryByHostId((current) => {
        const previous = current?.[resolvedHostKey] || current?.[hostKey] || {};
        return {
          ...(current || {}),
          [resolvedHostKey]: {
            ...previous,
            slaveRuntimeState: runtimeState,
            observedProcessRuns,
            telemetryLoadedAt: loadedAt,
            loadedAt: previous.loadedAt || loadedAt,
          },
        };
      });

      return {
        slaveRuntimeState: runtimeState,
        observedProcessRuns,
        telemetryLoadedAt: loadedAt,
      };
    } catch (runtimeRegistryError) {
      setError(runtimeRegistryError.message || 'Unable to load slave runtime telemetry');
      return null;
    }
  }, [
    graphqlEndpoint,
    setError,
    setRuntimeRegistryByHostId,
  ]);

  return {
    loadSlaveRuntimeBundle,
    loadSlaveRuntimeTelemetry,
  };
};
