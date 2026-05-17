import { useEffect, useMemo, useRef, useState } from 'react';
import TagChip from '../../../../components/TagChip';
import { useRuntimePanelContext } from '../../context/RuntimePanelContext';
import {
  formatRuntimeByteRatio,
  formatRuntimeBytes,
  formatRuntimeLoad,
  formatRuntimePercent,
  getObservedProcessLabel,
  parseRuntimeArgsInput,
  parseRuntimeEnvInput,
} from '../../lib/runtimeRegistryUi';
import {
  RUNTIME_RESOURCE_HISTORY_LIMIT,
  RUNTIME_RESOURCE_SAMPLE_INTERVAL_MS,
  appendDeploymentResourceHistory,
  buildDeploymentResourceSamples,
} from '../../lib/runtimeResourceMetrics';

const toDisplayValue = (value, fallback = '-') => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

const resolveSelectedProjectOption = (selectedHost, selectedProject) => {
  const hostProjects = Array.isArray(selectedHost?.projects) ? selectedHost.projects : [];
  const selectedHostId = Number(selectedHost?.id || 0);
  const selectedProjectHostId = Number(selectedProject?.hostId || 0);
  if (selectedProject && selectedHostId > 0 && selectedProjectHostId === selectedHostId) {
    const matched = hostProjects.find((project) => project?.path === selectedProject?.path)
      || hostProjects.find((project) => Number(project?.id) === Number(selectedProject?.id));
    if (matched) {
      return matched;
    }
  }
  return hostProjects[0] || null;
};

const buildDefaultDraft = (selectedHost, selectedProject) => {
  const selectedProjectOption = resolveSelectedProjectOption(selectedHost, selectedProject);
  const projectPath = String(selectedProjectOption?.path || selectedProject?.path || '').trim();
  return {
    projectId: Number.isInteger(Number(selectedProjectOption?.id)) ? Number(selectedProjectOption.id) : null,
    projectPath,
    deploymentId: null,
    deploymentKey: '',
    packageKey: '',
    processKey: '',
    cwd: projectPath,
    command: 'yarn',
    launchMode: 'exec',
    restartPolicy: 'manual',
    argsText: 'dev',
    envText: '',
    logRoot: '',
  };
};

const buildDraftFromDesiredProcess = (desiredProcess) => ({
  desiredProcessId: Number.isInteger(Number(desiredProcess?.id)) ? Number(desiredProcess.id) : null,
  projectId: Number.isInteger(Number(desiredProcess?.projectId)) ? Number(desiredProcess.projectId) : null,
  projectPath: String(desiredProcess?.projectPath || '').trim(),
  deploymentId: Number.isInteger(Number(desiredProcess?.deploymentId)) ? Number(desiredProcess.deploymentId) : null,
  deploymentKey: String(desiredProcess?.deploymentKey || '').trim(),
  packageKey: String(desiredProcess?.packageKey || '').trim(),
  processKey: String(desiredProcess?.processKey || '').trim(),
  cwd: String(desiredProcess?.cwd || '').trim(),
  command: String(desiredProcess?.command || '').trim(),
  launchMode: String(desiredProcess?.launchMode || 'exec').trim() || 'exec',
  restartPolicy: String(desiredProcess?.restartPolicy || 'manual').trim() || 'manual',
  argsText: Array.isArray(desiredProcess?.args) ? desiredProcess.args.join('\n') : '',
  envText: Array.isArray(desiredProcess?.env)
    ? desiredProcess.env
      .map((entry) => `${String(entry?.key || '').trim()}=${entry?.value == null ? '' : String(entry.value)}`)
      .filter(Boolean)
      .join('\n')
    : '',
  logRoot: String(desiredProcess?.logRoot || '').trim(),
});

const emptyRuntimeFilters = () => ({
  search: '',
  projectPath: '',
  deploymentKey: '',
  status: '',
});

const runtimeEnvToText = (entries) => (Array.isArray(entries) ? entries : [])
  .map((entry) => `${String(entry?.key || '').trim()}=${entry?.value == null ? '' : String(entry.value)}`)
  .filter((entry) => entry.trim())
  .join('\n');

const normalizeFilterValue = (value) => String(value || '').trim().toLowerCase();

const rowMatchesSearch = (values, search) => {
  const normalizedSearch = normalizeFilterValue(search);
  if (!normalizedSearch) {
    return true;
  }
  return values.some((value) => normalizeFilterValue(value).includes(normalizedSearch));
};

const rowMatchesExact = (value, filterValue) => {
  const normalizedFilter = normalizeFilterValue(filterValue);
  if (!normalizedFilter) {
    return true;
  }
  return normalizeFilterValue(value) === normalizedFilter;
};

const buildProjectFilterOptions = (hostProjects, runtimeRows) => {
  const options = new Map();
  for (const project of Array.isArray(hostProjects) ? hostProjects : []) {
    const path = String(project?.path || '').trim();
    if (path) {
      options.set(path, String(project?.name || path).trim() || path);
    }
  }
  for (const row of Array.isArray(runtimeRows) ? runtimeRows : []) {
    const path = String(row?.projectPath || '').trim();
    if (path && !options.has(path)) {
      options.set(path, String(row?.projectName || path).trim() || path);
    }
  }
  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const buildRuntimeStatusOptions = (runtimeRows, field) => Array.from(new Set(
  (Array.isArray(runtimeRows) ? runtimeRows : [])
    .map((row) => String(row?.[field] || '').trim())
    .filter(Boolean),
))
  .sort((left, right) => left.localeCompare(right));

const buildDeploymentFilterOptions = (deployments, runtimeRows) => {
  const options = new Map();
  for (const deployment of Array.isArray(deployments) ? deployments : []) {
    const key = String(deployment?.deploymentKey || '').trim();
    if (key) {
      options.set(key, String(deployment?.displayName || key).trim() || key);
    }
  }
  for (const row of Array.isArray(runtimeRows) ? runtimeRows : []) {
    const key = String(row?.deploymentKey || '').trim();
    if (key && !options.has(key)) {
      options.set(key, String(row?.deploymentName || key).trim() || key);
    }
  }
  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const filterDesiredProcesses = (processes, filters) => (Array.isArray(processes) ? processes : [])
  .filter((processDefinition) => (
    rowMatchesExact(processDefinition.projectPath, filters.projectPath)
    && rowMatchesExact(processDefinition.deploymentKey, filters.deploymentKey)
    && rowMatchesExact(processDefinition.desiredState, filters.status)
    && rowMatchesSearch([
      processDefinition.processKey,
      processDefinition.packageKey,
      processDefinition.projectName,
      processDefinition.projectPath,
      processDefinition.deploymentKey,
      processDefinition.deploymentName,
      processDefinition.serviceName,
      processDefinition.cwd,
      processDefinition.command,
      ...(Array.isArray(processDefinition.args) ? processDefinition.args : []),
      processDefinition.restartPolicy,
      processDefinition.desiredState,
    ], filters.search)
  ));

const filterObservedRuns = (runs, filters) => (Array.isArray(runs) ? runs : [])
  .filter((observedRun) => (
    rowMatchesExact(observedRun.projectPath, filters.projectPath)
    && rowMatchesExact(observedRun.deploymentKey, filters.deploymentKey)
    && rowMatchesExact(observedRun.status, filters.status)
    && rowMatchesSearch([
      observedRun.runId,
      observedRun.processKey,
      observedRun.packageKey,
      observedRun.projectPath,
      observedRun.deploymentKey,
      observedRun.deploymentName,
      observedRun.cwd,
      observedRun.command,
      ...(Array.isArray(observedRun.args) ? observedRun.args : []),
      observedRun.status,
      observedRun.pid,
      observedRun.logPath,
      observedRun.reconciliationSource,
      observedRun.bootId,
    ], filters.search)
  ));

const SPARKLINE_WIDTH = 160;
const SPARKLINE_HEIGHT = 44;

const getHistoryMax = (history, field, floor = 1) => Math.max(
  floor,
  ...((Array.isArray(history) ? history : [])
    .map((entry) => Number(entry?.[field]))
    .filter((value) => Number.isFinite(value) && value >= 0)),
);

const buildSparklinePoints = (history, field, maxValue) => {
  const entries = Array.isArray(history) ? history : [];
  if (entries.length === 0) {
    return '';
  }
  if (entries.length === 1) {
    const y = SPARKLINE_HEIGHT - ((Number(entries[0]?.[field] || 0) / maxValue) * SPARKLINE_HEIGHT);
    return `0,${y.toFixed(1)} ${SPARKLINE_WIDTH},${y.toFixed(1)}`;
  }
  return entries
    .map((entry, index) => {
      const x = (index / (entries.length - 1)) * SPARKLINE_WIDTH;
      const value = Math.max(0, Number(entry?.[field] || 0));
      const y = SPARKLINE_HEIGHT - ((value / maxValue) * SPARKLINE_HEIGHT);
      return `${x.toFixed(1)},${Math.max(0, Math.min(SPARKLINE_HEIGHT, y)).toFixed(1)}`;
    })
    .join(' ');
};

const RuntimeSparkline = ({
  label,
  value,
  history,
  field,
  maxValue,
  className = '',
}) => {
  const normalizedMax = Number.isFinite(Number(maxValue)) && Number(maxValue) > 0
    ? Number(maxValue)
    : getHistoryMax(history, field, 1);
  const points = buildSparklinePoints(history, field, normalizedMax);
  return (
    <div className={`runtimeSparkline ${className}`.trim()}>
      <div className="runtimeSparklineHeader">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <svg
        className="runtimeSparklineSvg"
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        role="img"
        aria-label={`${label} sparkline`}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1={SPARKLINE_HEIGHT - 0.5}
          x2={SPARKLINE_WIDTH}
          y2={SPARKLINE_HEIGHT - 0.5}
          className="runtimeSparklineBaseline"
        />
        {points ? (
          <polyline
            points={points}
            className="runtimeSparklineLine"
          />
        ) : null}
      </svg>
    </div>
  );
};

export default function RuntimePanel() {
  const {
    runtimeConfig,
    runtimeBackendInfo,
    runtimeBackendInfoLoading,
    masterAgentInfo,
    isGoMasterBackend,
    selectedHost,
    selectedProject,
    slaveRuntimeState,
    desiredProcesses,
    observedProcessRuns,
    deploymentInstances,
    hostRuntimeEnv,
    hostPathMappings,
    hostRuntimeState,
    runtimeLoading,
    runtimeActionBusy,
    onRefreshSelectedHostRuntime,
    onEnsureDesiredProcess,
    onDeleteDesiredProcess,
    onEnsureDeploymentInstance,
    onDeleteDeploymentInstance,
    onSetHostRuntimeEnv,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    onViewManagedProcessLogs,
    formatRuntimeDateTime,
    formatVersionWithProtocol,
  } = useRuntimePanelContext();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draft, setDraft] = useState(() => buildDefaultDraft(selectedHost, selectedProject));
  const [deploymentDraft, setDeploymentDraft] = useState({
    projectId: null,
    deploymentKey: '',
    displayName: '',
    deploymentPath: '',
    envText: '',
    logRoot: '',
  });
  const [hostEnvText, setHostEnvText] = useState(() => runtimeEnvToText(hostRuntimeEnv));
  const [editingDesiredProcessId, setEditingDesiredProcessId] = useState(null);
  const [desiredProcessFilters, setDesiredProcessFilters] = useState(() => emptyRuntimeFilters());
  const [observedRunFilters, setObservedRunFilters] = useState(() => emptyRuntimeFilters());
  const [resourceHistoryByKey, setResourceHistoryByKey] = useState({});
  const observedProcessRunsRef = useRef([]);

  useEffect(() => {
    setDraft(buildDefaultDraft(selectedHost, selectedProject));
    setShowCreateForm(false);
    setEditingDesiredProcessId(null);
    setDeploymentDraft({
      projectId: Number.isInteger(Number(resolveSelectedProjectOption(selectedHost, selectedProject)?.id))
        ? Number(resolveSelectedProjectOption(selectedHost, selectedProject).id)
        : null,
      deploymentKey: '',
      displayName: '',
      deploymentPath: String(resolveSelectedProjectOption(selectedHost, selectedProject)?.path || selectedProject?.path || '').trim(),
      envText: '',
      logRoot: '',
    });
    setDesiredProcessFilters(emptyRuntimeFilters());
    setObservedRunFilters(emptyRuntimeFilters());
  }, [selectedHost, selectedProject]);

  useEffect(() => {
    setHostEnvText(runtimeEnvToText(hostRuntimeEnv));
  }, [selectedHost?.id]);

  useEffect(() => {
    setResourceHistoryByKey({});
  }, [selectedHost?.id]);

  useEffect(() => {
    observedProcessRunsRef.current = Array.isArray(observedProcessRuns) ? observedProcessRuns : [];
  }, [observedProcessRuns]);

  useEffect(() => {
    if (!selectedHost) {
      setResourceHistoryByKey({});
      return undefined;
    }

    const appendCurrentSample = () => {
      const samples = buildDeploymentResourceSamples(observedProcessRunsRef.current);
      setResourceHistoryByKey((current) => appendDeploymentResourceHistory(current, samples, {
        limit: RUNTIME_RESOURCE_HISTORY_LIMIT,
        nowMs: Date.now(),
      }));
    };

    appendCurrentSample();
    if (typeof window === 'undefined') {
      return undefined;
    }

    const intervalId = window.setInterval(appendCurrentSample, RUNTIME_RESOURCE_SAMPLE_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedHost?.id]);

  const backendName = toDisplayValue(
    runtimeBackendInfo?.displayName || runtimeBackendInfo?.name || runtimeConfig?.runtimeBackend,
    'Unknown backend',
  );
  const backendVersion = formatVersionWithProtocol(
    runtimeConfig?.version || null,
    runtimeConfig?.protocolVersion || null,
  );
  const masterVersion = formatVersionWithProtocol(
    masterAgentInfo?.version || null,
    masterAgentInfo?.protocolVersion || null,
  );
  const masterLastHeartbeat = masterAgentInfo?.lastConnectedAt
    ? formatRuntimeDateTime(masterAgentInfo.lastConnectedAt)
    : '-';
  const selectedHostTarget = useMemo(() => {
    if (!selectedHost) {
      return '-';
    }
    return String(selectedHost?.targetSocket || selectedHost?.ip || '-').trim() || '-';
  }, [selectedHost]);
  const selectedHostVersion = formatVersionWithProtocol(
    selectedHost?.version || null,
    selectedHost?.protocolVersion || null,
  );
  const hostProjects = Array.isArray(selectedHost?.projects) ? selectedHost.projects : [];
  const visibleHostPathMappings = Array.isArray(hostPathMappings) ? hostPathMappings : [];
  const desiredProjectFilterOptions = useMemo(
    () => buildProjectFilterOptions(hostProjects, desiredProcesses),
    [hostProjects, desiredProcesses],
  );
  const observedProjectFilterOptions = useMemo(
    () => buildProjectFilterOptions(hostProjects, observedProcessRuns),
    [hostProjects, observedProcessRuns],
  );
  const desiredDeploymentFilterOptions = useMemo(
    () => buildDeploymentFilterOptions(deploymentInstances, desiredProcesses),
    [deploymentInstances, desiredProcesses],
  );
  const observedDeploymentFilterOptions = useMemo(
    () => buildDeploymentFilterOptions(deploymentInstances, observedProcessRuns),
    [deploymentInstances, observedProcessRuns],
  );
  const desiredStateFilterOptions = useMemo(
    () => buildRuntimeStatusOptions(desiredProcesses, 'desiredState'),
    [desiredProcesses],
  );
  const observedStatusFilterOptions = useMemo(
    () => buildRuntimeStatusOptions(observedProcessRuns, 'status'),
    [observedProcessRuns],
  );
  const filteredDesiredProcesses = useMemo(
    () => filterDesiredProcesses(desiredProcesses, desiredProcessFilters),
    [desiredProcesses, desiredProcessFilters],
  );
  const filteredObservedProcessRuns = useMemo(
    () => filterObservedRuns(observedProcessRuns, observedRunFilters),
    [observedProcessRuns, observedRunFilters],
  );
  const visibleResourceSamples = useMemo(
    () => buildDeploymentResourceSamples(filteredObservedProcessRuns),
    [filteredObservedProcessRuns],
  );
  const visibleResourceCards = useMemo(
    () => visibleResourceSamples.map((sample) => ({
      ...sample,
      history: Array.isArray(resourceHistoryByKey?.[sample.key]) ? resourceHistoryByKey[sample.key] : [],
    })),
    [resourceHistoryByKey, visibleResourceSamples],
  );
  const desiredFiltersActive = Boolean(
    desiredProcessFilters.search || desiredProcessFilters.projectPath || desiredProcessFilters.deploymentKey || desiredProcessFilters.status,
  );
  const observedFiltersActive = Boolean(
    observedRunFilters.search || observedRunFilters.projectPath || observedRunFilters.deploymentKey || observedRunFilters.status,
  );

  const updateDesiredFilter = (field, value) => {
    setDesiredProcessFilters((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateObservedFilter = (field, value) => {
    setObservedRunFilters((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const onDraftFieldChange = (field, value) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const onProjectSelectionChange = (projectIdValue) => {
    const parsedProjectId = Number.parseInt(String(projectIdValue || '').trim(), 10);
    const nextProject = hostProjects.find((candidate) => Number(candidate?.id) === parsedProjectId) || null;
    setDraft((current) => ({
      ...current,
      projectId: Number.isInteger(parsedProjectId) ? parsedProjectId : null,
      projectPath: String(nextProject?.path || '').trim(),
      deploymentId: null,
      deploymentKey: '',
      cwd: String(nextProject?.path || current.cwd || '').trim(),
    }));
  };

  const onDeploymentSelectionChange = (deploymentIdValue) => {
    const parsedDeploymentId = Number.parseInt(String(deploymentIdValue || '').trim(), 10);
    const deployment = (Array.isArray(deploymentInstances) ? deploymentInstances : [])
      .find((candidate) => Number(candidate?.id) === parsedDeploymentId) || null;
    setDraft((current) => ({
      ...current,
      deploymentId: deployment ? Number(deployment.id) : null,
      deploymentKey: String(deployment?.deploymentKey || '').trim(),
      cwd: String(deployment?.deploymentPath || current.cwd || '').trim(),
      logRoot: String(deployment?.logRoot || current.logRoot || '').trim(),
    }));
  };

  const submitDesiredProcess = async () => {
    if (!selectedHost) {
      return;
    }
    const packageKey = String(draft.packageKey || '').trim();
    const processKey = String(draft.processKey || packageKey).trim();
    await onEnsureDesiredProcess({
      hostId: selectedHost.id,
      agentUuid: selectedHost.agentUuid,
      desiredProcessId: editingDesiredProcessId,
      projectId: draft.projectId,
      projectPath: draft.projectPath,
      deploymentId: draft.deploymentId,
      deploymentKey: draft.deploymentKey,
      packageKey,
      processKey,
      cwd: draft.cwd,
      command: draft.command,
      launchMode: draft.launchMode,
      restartPolicy: draft.restartPolicy,
      args: parseRuntimeArgsInput(draft.argsText),
      env: parseRuntimeEnvInput(draft.envText),
      logRoot: draft.logRoot,
      createdBy: 'runtime-panel',
      updatedBy: 'runtime-panel',
    });
    setShowCreateForm(false);
    setEditingDesiredProcessId(null);
    setDraft(buildDefaultDraft(selectedHost, selectedProject));
  };

  const startEditingDesiredProcess = (desiredProcess) => {
    setDraft(buildDraftFromDesiredProcess(desiredProcess));
    setEditingDesiredProcessId(Number.isInteger(Number(desiredProcess?.id)) ? Number(desiredProcess.id) : null);
    setShowCreateForm(true);
  };

  const cancelDesiredProcessEdit = () => {
    setShowCreateForm(false);
    setEditingDesiredProcessId(null);
    setDraft(buildDefaultDraft(selectedHost, selectedProject));
  };

  const deleteDesiredProcessDefinition = async (desiredProcess) => {
    if (!selectedHost || !desiredProcess) {
      return;
    }
    await onDeleteDesiredProcess?.(selectedHost, desiredProcess);
    if (Number(editingDesiredProcessId) === Number(desiredProcess?.id)) {
      cancelDesiredProcessEdit();
    }
  };

  const submitHostRuntimeEnv = async () => {
    if (!selectedHost) {
      return;
    }
    await onSetHostRuntimeEnv?.({
      hostId: selectedHost.id,
      agentUuid: selectedHost.agentUuid,
      env: parseRuntimeEnvInput(hostEnvText),
    });
  };

  const submitDeploymentInstance = async () => {
    if (!selectedHost) {
      return;
    }
    const project = hostProjects.find((candidate) => Number(candidate?.id) === Number(deploymentDraft.projectId)) || null;
    await onEnsureDeploymentInstance?.({
      hostId: selectedHost.id,
      agentUuid: selectedHost.agentUuid,
      projectId: deploymentDraft.projectId,
      projectPath: String(project?.path || '').trim() || null,
      deploymentKey: deploymentDraft.deploymentKey,
      displayName: deploymentDraft.displayName,
      deploymentPath: deploymentDraft.deploymentPath,
      env: parseRuntimeEnvInput(deploymentDraft.envText),
      logRoot: deploymentDraft.logRoot,
    });
  };

  const deleteDeploymentInstance = async (deployment) => {
    if (!selectedHost || !deployment) {
      return;
    }
    if (
      typeof window !== 'undefined'
      && !window.confirm(`Delete deployment ${deployment.deploymentKey}?`)
    ) {
      return;
    }
    const deleteDesiredProcesses = typeof window !== 'undefined'
      && window.confirm(`Also delete desired processes for ${deployment.deploymentKey}?`);
    await onDeleteDeploymentInstance?.({
      hostId: selectedHost.id,
      agentUuid: selectedHost.agentUuid,
      deploymentId: deployment.id,
      deleteDesiredProcesses,
    });
  };

  return (
    <div className="runtimePanel">
      {runtimeBackendInfoLoading ? (
        <p className="emptyState">Loading runtime configuration...</p>
      ) : null}

      <div className="runtimeSection">
        <h3 className="runtimeSectionTitle">Server Runtime</h3>
        <div className="hostFieldGrid">
          <div className="hostFieldItem">
            <span className="hostFieldLabel">Backend</span>
            <span className="hostFieldValue">{backendName}</span>
          </div>
          <div className="hostFieldItem">
            <span className="hostFieldLabel">Version</span>
            <span className="hostFieldValue">{backendVersion}</span>
          </div>
          <div className="hostFieldItem">
            <span className="hostFieldLabel">GraphQL</span>
            <span className="hostFieldValue">{toDisplayValue(runtimeConfig?.graphqlEndpoint)}</span>
          </div>
          <div className="hostFieldItem">
            <span className="hostFieldLabel">Websocket</span>
            <span className="hostFieldValue">{toDisplayValue(runtimeConfig?.wsEndpoint)}</span>
          </div>
          <div className="hostFieldItem">
            <span className="hostFieldLabel">Target Slave Version</span>
            <span className="hostFieldValue">{toDisplayValue(runtimeConfig?.slaveTargetVersion)}</span>
          </div>
        </div>
      </div>

      {isGoMasterBackend ? (
        <div className="runtimeSection">
          <h3 className="runtimeSectionTitle">Master Agent</h3>
          <div className="hostFieldGrid">
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Status</span>
              <span className="hostFieldValue">
                {toDisplayValue(masterAgentInfo?.connectionStatus)} ({toDisplayValue(masterAgentInfo?.status)})
              </span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Version</span>
              <span className="hostFieldValue">{masterVersion}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Target</span>
              <span className="hostFieldValue">
                {toDisplayValue(masterAgentInfo?.target || masterAgentInfo?.slaveControlTarget)}
              </span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Socket Path</span>
              <span className="hostFieldValue">{toDisplayValue(masterAgentInfo?.socketPath)}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">TCP Slave Port</span>
              <span className="hostFieldValue">{toDisplayValue(masterAgentInfo?.slaveControlPort)}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Last Heartbeat</span>
              <span className="hostFieldValue">{masterLastHeartbeat}</span>
            </div>
            {masterAgentInfo?.error ? (
              <div className="hostFieldItem hostFieldItemError">
                <span className="hostFieldLabel">Agent Error</span>
                <span className="hostFieldValue">{toDisplayValue(masterAgentInfo.error)}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectedHost ? (
        <div className="runtimeSection">
          <div className="runtimeHostToolbar">
            <h3 className="runtimeSectionTitle">Selected Slave Agent</h3>
            <div className="runtimeHostToolbarActions">
              <button
                type="button"
                className="hostsAddAction"
                onClick={() => {
                  onRefreshSelectedHostRuntime?.();
                }}
                disabled={runtimeLoading || runtimeActionBusy}
              >
                {runtimeLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                className="hostsAddAction"
                onClick={() => setShowCreateForm((current) => !current)}
                disabled={runtimeActionBusy}
              >
                {showCreateForm ? 'Hide Form' : 'Add Managed Process'}
              </button>
            </div>
          </div>

          <div className="hostFieldGrid">
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Host</span>
              <span className="hostFieldValue">{toDisplayValue(selectedHost?.name || selectedHost?.ip)}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Target</span>
              <span className="hostFieldValue">{selectedHostTarget}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Version</span>
              <span className="hostFieldValue">{selectedHostVersion}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Status</span>
              <span className="hostFieldValue">
                {toDisplayValue(selectedHost?.status)}
                {selectedHost?.lastSeenAt ? ` (last seen ${formatRuntimeDateTime(selectedHost.lastSeenAt)})` : ''}
              </span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Desired Processes</span>
              <span className="hostFieldValue">{desiredProcesses.length}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Observed Runs</span>
              <span className="hostFieldValue">{observedProcessRuns.length}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">CPU</span>
              <span className="hostFieldValue">{formatRuntimePercent(hostRuntimeState?.cpuPercent)}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Memory</span>
              <span className="hostFieldValue">
                {formatRuntimeByteRatio(hostRuntimeState?.memoryUsedBytes, hostRuntimeState?.memoryTotalBytes)}
              </span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Disk</span>
              <span className="hostFieldValue">
                {formatRuntimeByteRatio(hostRuntimeState?.diskUsedBytes, hostRuntimeState?.diskTotalBytes)}
              </span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Load</span>
              <span className="hostFieldValue">
                {`${formatRuntimeLoad(hostRuntimeState?.load1m)} / ${formatRuntimeLoad(hostRuntimeState?.load5m)} / ${formatRuntimeLoad(hostRuntimeState?.load15m)}`}
              </span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Runtime Sampled</span>
              <span className="hostFieldValue">{toDisplayValue(formatRuntimeDateTime(hostRuntimeState?.sampledAt))}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Memory Available</span>
              <span className="hostFieldValue">{formatRuntimeBytes(hostRuntimeState?.memoryAvailableBytes)}</span>
            </div>
            <div className="hostFieldItem">
              <span className="hostFieldLabel">Disk Available</span>
              <span className="hostFieldValue">{formatRuntimeBytes(hostRuntimeState?.diskAvailableBytes)}</span>
            </div>
            {slaveRuntimeState?.hostRuntimeState?.diskMount ? (
              <div className="hostFieldItem">
                <span className="hostFieldLabel">Disk Mount</span>
                <span className="hostFieldValue">{slaveRuntimeState.hostRuntimeState.diskMount}</span>
              </div>
            ) : null}
          </div>

          <div className="runtimeProcessSection">
            <div className="runtimeSubsectionHeader">
              <h4 className="runtimeSubsectionTitle">Deployment Resource Graphs</h4>
              <span className="runtimeFilterCount">
                {visibleResourceCards.length}
                {' apps · '}
                {RUNTIME_RESOURCE_HISTORY_LIMIT}s window
              </span>
            </div>
            {visibleResourceCards.length === 0 ? (
              <p className="emptyState">No active process telemetry samples are available for the current host/filter.</p>
            ) : (
              <div className="runtimeResourceGrid">
                {visibleResourceCards.map((sample) => {
                  const history = Array.isArray(sample.history) ? sample.history : [];
                  const latest = history.length > 0 ? history[history.length - 1] : sample;
                  const cpuMax = getHistoryMax(history, 'cpuPercent', 100);
                  const memoryMax = getHistoryMax(history, 'rssBytes', Math.max(1, Number(latest?.rssBytes || sample.rssBytes || 1)));
                  const ioMax = getHistoryMax(history, 'ioBytesPerSecond', Math.max(1, Number(latest?.ioBytesPerSecond || 1)));
                  return (
                    <div className="runtimeResourceCard" key={`resource-${sample.key}`}>
                      <div className="runtimeResourceCardHeader">
                        <div className="runtimeResourceTitleBlock">
                          <strong>{sample.label}</strong>
                          <span>
                            {sample.runCount}
                            {' runs · pid '}
                            {sample.pids.length > 0 ? sample.pids.join(', ') : '-'}
                          </span>
                        </div>
                        <span className="runtimeInlineMeta">
                          sampled {toDisplayValue(formatRuntimeDateTime(sample.sampledAt))}
                        </span>
                      </div>
                      <div className="runtimeResourcePackages">
                        {(sample.packageKeys || []).length > 0 ? sample.packageKeys.join(', ') : 'managed-process'}
                      </div>
                      <div className="runtimeSparklineGrid">
                        <RuntimeSparkline
                          label="CPU"
                          value={formatRuntimePercent(latest?.cpuPercent ?? sample.cpuPercent)}
                          history={history}
                          field="cpuPercent"
                          maxValue={cpuMax}
                          className="cpu"
                        />
                        <RuntimeSparkline
                          label="RSS"
                          value={formatRuntimeBytes(latest?.rssBytes ?? sample.rssBytes)}
                          history={history}
                          field="rssBytes"
                          maxValue={memoryMax}
                          className="memory"
                        />
                        <RuntimeSparkline
                          label="IO/s"
                          value={`${formatRuntimeBytes(latest?.ioBytesPerSecond || 0)}/s`}
                          history={history}
                          field="ioBytesPerSecond"
                          maxValue={ioMax}
                          className="io"
                        />
                      </div>
                      <div className="runtimeResourceTotals">
                        <span>Read {formatRuntimeBytes(sample.readBytes)}</span>
                        <span>Write {formatRuntimeBytes(sample.writeBytes)}</span>
                        <span>Mem {formatRuntimePercent(sample.memoryPercent)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="hostRuntimeProcessSection">
            <h4 className="runtimeSubsectionTitle">Host Runtime Env</h4>
            <div className="runtimeFieldGrid">
              <label className="runtimeFieldLabel runtimeFieldSpanFull">
                Shared env for every deployment on this host
                <textarea
                  className="hostsAddInput runtimeTextarea"
                  value={hostEnvText}
                  onChange={(event) => setHostEnvText(event.target.value)}
                  disabled={runtimeActionBusy}
                  placeholder="KEY=VALUE"
                />
              </label>
            </div>
            <div className="hostCheckoutActions">
              <button
                type="button"
                className="hostsAddAction hostCheckoutSubmit"
                onClick={submitHostRuntimeEnv}
                disabled={runtimeActionBusy}
              >
                Save Host Env
              </button>
            </div>
          </div>

          <div className="hostRuntimeProcessSection">
            <div className="runtimeSubsectionHeader">
              <h4 className="runtimeSubsectionTitle">Deployment Instances</h4>
              <span className="runtimeFilterCount">{(deploymentInstances || []).length}</span>
            </div>
            <div className="runtimeFieldGrid">
              <label className="runtimeFieldLabel">
                Project
                <select
                  className="hostsAddInput"
                  value={deploymentDraft.projectId ?? ''}
                  onChange={(event) => {
                    const projectId = Number.parseInt(event.target.value, 10);
                    const project = hostProjects.find((candidate) => Number(candidate?.id) === projectId) || null;
                    setDeploymentDraft((current) => ({
                      ...current,
                      projectId: Number.isInteger(projectId) ? projectId : null,
                      deploymentPath: String(project?.path || current.deploymentPath || '').trim(),
                    }));
                  }}
                  disabled={runtimeActionBusy}
                >
                  <option value="">Select project</option>
                  {hostProjects.map((project) => (
                    <option key={`deployment-project-${project.id}`} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="runtimeFieldLabel">
                Deployment Key
                <input
                  type="text"
                  className="hostsAddInput"
                  value={deploymentDraft.deploymentKey}
                  onChange={(event) => setDeploymentDraft((current) => ({ ...current, deploymentKey: event.target.value }))}
                  disabled={runtimeActionBusy}
                  placeholder="local, staging, prod-a"
                />
              </label>
              <label className="runtimeFieldLabel">
                Display Name
                <input
                  type="text"
                  className="hostsAddInput"
                  value={deploymentDraft.displayName}
                  onChange={(event) => setDeploymentDraft((current) => ({ ...current, displayName: event.target.value }))}
                  disabled={runtimeActionBusy}
                />
              </label>
              <label className="runtimeFieldLabel">
                Deployment Path
                <input
                  type="text"
                  className="hostsAddInput"
                  value={deploymentDraft.deploymentPath}
                  onChange={(event) => setDeploymentDraft((current) => ({ ...current, deploymentPath: event.target.value }))}
                  disabled={runtimeActionBusy}
                />
              </label>
              <label className="runtimeFieldLabel">
                Log Root
                <input
                  type="text"
                  className="hostsAddInput"
                  value={deploymentDraft.logRoot}
                  onChange={(event) => setDeploymentDraft((current) => ({ ...current, logRoot: event.target.value }))}
                  disabled={runtimeActionBusy}
                />
              </label>
              <label className="runtimeFieldLabel runtimeFieldSpanFull">
                Deployment Env
                <textarea
                  className="hostsAddInput runtimeTextarea"
                  value={deploymentDraft.envText}
                  onChange={(event) => setDeploymentDraft((current) => ({ ...current, envText: event.target.value }))}
                  disabled={runtimeActionBusy}
                  placeholder="WEB_PORT=3015"
                />
              </label>
            </div>
            <div className="hostCheckoutActions">
              <button
                type="button"
                className="hostsAddAction hostCheckoutSubmit"
                onClick={submitDeploymentInstance}
                disabled={runtimeActionBusy}
              >
                Save Deployment
              </button>
            </div>
            {(deploymentInstances || []).length > 0 ? (
              <div className="hostRuntimeProcessList">
                {deploymentInstances.map((deployment) => (
                  <div key={`deployment-${deployment.id}`} className="hostRuntimeProcessRow">
                    <div className="hostRuntimeProcessIdentity">
                      <strong>{toDisplayValue(deployment.displayName || deployment.deploymentKey)}</strong>
                      <span className="hostRuntimeProcessMeta">{toDisplayValue(deployment.deploymentPath)}</span>
                    </div>
                    <div className="hostRuntimeProcessMeta">
                      <span>{toDisplayValue(deployment.deploymentKey)}</span>
                      <span>{(deployment.env || []).length} env vars</span>
                    </div>
                    <div className="runtimeProcessActions">
                      <button
                        type="button"
                        className="hostTextActionButton"
                        onClick={() => setDeploymentDraft({
                          projectId: deployment.projectId,
                          deploymentKey: deployment.deploymentKey || '',
                          displayName: deployment.displayName || '',
                          deploymentPath: deployment.deploymentPath || '',
                          envText: runtimeEnvToText(deployment.env),
                          logRoot: deployment.logRoot || '',
                        })}
                        disabled={runtimeActionBusy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="hostTextActionButton danger"
                        onClick={() => deleteDeploymentInstance(deployment)}
                        disabled={runtimeActionBusy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="emptyState hostRuntimeEmptyState">No deployment instances configured.</p>
            )}
          </div>

          <div className="hostRuntimeProcessSection">
            <h4 className="runtimeSubsectionTitle">Shared Path Mappings</h4>
            {visibleHostPathMappings.length > 0 ? (
              <div className="hostRuntimeProcessList">
                {visibleHostPathMappings.map((mapping) => (
                  <div
                    key={mapping.id || `${mapping.codexPathPrefix}:${mapping.hostPathPrefix}`}
                    className="hostRuntimeProcessRow"
                  >
                    <div className="hostRuntimeProcessIdentity">
                      <strong>{toDisplayValue(mapping.logicalRoot || mapping.codexPathPrefix)}</strong>
                      <span className="hostRuntimeProcessMeta">
                        {mapping.enabled === false ? 'disabled' : 'enabled'}
                      </span>
                    </div>
                    <div className="hostRuntimeProcessMeta">
                      <span title={mapping.codexPathPrefix}>
                        Codex {toDisplayValue(mapping.codexPathPrefix)}
                      </span>
                      <span title={mapping.hostPathPrefix}>
                        Host {toDisplayValue(mapping.hostPathPrefix)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="emptyState hostRuntimeEmptyState">No shared path mappings configured.</p>
            )}
          </div>

          {showCreateForm ? (
            <div className="runtimeProcessForm">
              <div className="runtimeFieldGrid">
                <label className="runtimeFieldLabel">
                  Project
                  <select
                    className="hostsAddInput"
                    value={draft.projectId ?? ''}
                    onChange={(event) => onProjectSelectionChange(event.target.value)}
                    disabled={runtimeActionBusy}
                  >
                    <option value="">Select project</option>
                    {hostProjects.map((project) => (
                      <option key={`runtime-project-${project.id}`} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="runtimeFieldLabel">
                  Deployment
                  <select
                    className="hostsAddInput"
                    value={draft.deploymentId ?? ''}
                    onChange={(event) => onDeploymentSelectionChange(event.target.value)}
                    disabled={runtimeActionBusy}
                  >
                    <option value="">No deployment namespace</option>
                    {(deploymentInstances || [])
                      .filter((deployment) => !draft.projectId || Number(deployment.projectId) === Number(draft.projectId))
                      .map((deployment) => (
                        <option key={`process-deployment-${deployment.id}`} value={deployment.id}>
                          {deployment.displayName || deployment.deploymentKey}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="runtimeFieldLabel">
                  Package Key
                  <input
                    type="text"
                    className="hostsAddInput"
                    value={draft.packageKey}
                    onChange={(event) => onDraftFieldChange('packageKey', event.target.value)}
                    disabled={runtimeActionBusy}
                  />
                </label>
                <label className="runtimeFieldLabel">
                  Process Key
                  <input
                    type="text"
                    className="hostsAddInput"
                    value={draft.processKey}
                    onChange={(event) => onDraftFieldChange('processKey', event.target.value)}
                    disabled={runtimeActionBusy}
                    placeholder="Defaults to deployment.package when a deployment is selected"
                  />
                </label>
                <label className="runtimeFieldLabel">
                  Working Directory
                  <input
                    type="text"
                    className="hostsAddInput"
                    value={draft.cwd}
                    onChange={(event) => onDraftFieldChange('cwd', event.target.value)}
                    disabled={runtimeActionBusy}
                  />
                </label>
                <label className="runtimeFieldLabel">
                  Launch Mode
                  <select
                    className="hostsAddInput"
                    value={draft.launchMode}
                    onChange={(event) => onDraftFieldChange('launchMode', event.target.value)}
                    disabled={runtimeActionBusy}
                  >
                    <option value="exec">exec</option>
                    <option value="shell">shell</option>
                  </select>
                </label>
                <label className="runtimeFieldLabel">
                  Restart Policy
                  <select
                    className="hostsAddInput"
                    value={draft.restartPolicy}
                    onChange={(event) => onDraftFieldChange('restartPolicy', event.target.value)}
                    disabled={runtimeActionBusy}
                  >
                    <option value="manual">manual</option>
                    <option value="always">always</option>
                    <option value="on_failure">on_failure</option>
                  </select>
                </label>
                <label className="runtimeFieldLabel runtimeFieldSpanFull">
                  Command
                  <input
                    type="text"
                    className="hostsAddInput"
                    value={draft.command}
                    onChange={(event) => onDraftFieldChange('command', event.target.value)}
                    disabled={runtimeActionBusy}
                  />
                </label>
                <label className="runtimeFieldLabel">
                  Args (one per line)
                  <textarea
                    className="hostsAddInput runtimeTextarea"
                    value={draft.argsText}
                    onChange={(event) => onDraftFieldChange('argsText', event.target.value)}
                    disabled={runtimeActionBusy}
                  />
                </label>
                <label className="runtimeFieldLabel">
                  Env (KEY=VALUE per line)
                  <textarea
                    className="hostsAddInput runtimeTextarea"
                    value={draft.envText}
                    onChange={(event) => onDraftFieldChange('envText', event.target.value)}
                    disabled={runtimeActionBusy}
                  />
                </label>
                <label className="runtimeFieldLabel runtimeFieldSpanFull">
                  Log Root (optional)
                  <input
                    type="text"
                    className="hostsAddInput"
                    value={draft.logRoot}
                    onChange={(event) => onDraftFieldChange('logRoot', event.target.value)}
                    disabled={runtimeActionBusy}
                    placeholder="Defaults to slave log root"
                  />
                </label>
              </div>
              <div className="hostCheckoutActions">
                <button
                  type="button"
                  className="hostsAddAction hostCheckoutCancel"
                  onClick={cancelDesiredProcessEdit}
                  disabled={runtimeActionBusy}
                >
                  {editingDesiredProcessId ? 'Cancel Edit' : 'Cancel'}
                </button>
                <button
                  type="button"
                  className="hostsAddAction hostCheckoutSubmit"
                  onClick={submitDesiredProcess}
                  disabled={runtimeActionBusy}
                >
                  {runtimeActionBusy
                    ? 'Saving...'
                    : (editingDesiredProcessId ? 'Update Managed Process' : 'Ensure Desired Process')}
                </button>
              </div>
            </div>
          ) : null}

          <div className="runtimeProcessSection">
            <div className="runtimeSubsectionHeader">
              <h4 className="runtimeSubsectionTitle">Desired Processes</h4>
              <span className="runtimeFilterCount">
                {filteredDesiredProcesses.length}
                {' / '}
                {desiredProcesses.length}
              </span>
            </div>
            <div className="runtimeFilterBar">
              <input
                type="search"
                className="hostsAddInput runtimeFilterInput"
                value={desiredProcessFilters.search}
                onChange={(event) => updateDesiredFilter('search', event.target.value)}
                placeholder="Filter desired processes"
                aria-label="Filter desired processes"
              />
              <select
                className="hostsAddInput runtimeFilterSelect"
                value={desiredProcessFilters.projectPath}
                onChange={(event) => updateDesiredFilter('projectPath', event.target.value)}
                aria-label="Filter desired processes by project"
              >
                <option value="">All projects</option>
                {desiredProjectFilterOptions.map((option) => (
                  <option key={`desired-project-filter-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="hostsAddInput runtimeFilterSelect"
                value={desiredProcessFilters.deploymentKey}
                onChange={(event) => updateDesiredFilter('deploymentKey', event.target.value)}
                aria-label="Filter desired processes by deployment"
              >
                <option value="">All deployments</option>
                {desiredDeploymentFilterOptions.map((option) => (
                  <option key={`desired-deployment-filter-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="hostsAddInput runtimeFilterSelect"
                value={desiredProcessFilters.status}
                onChange={(event) => updateDesiredFilter('status', event.target.value)}
                aria-label="Filter desired processes by state"
              >
                <option value="">All states</option>
                {desiredStateFilterOptions.map((state) => (
                  <option key={`desired-state-filter-${state}`} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="hostTextActionButton"
                onClick={() => setDesiredProcessFilters(emptyRuntimeFilters())}
                disabled={!desiredFiltersActive}
              >
                Clear
              </button>
            </div>
            {desiredProcesses.length === 0 ? (
              <p className="emptyState">No managed processes have been declared for this host.</p>
            ) : filteredDesiredProcesses.length === 0 ? (
              <p className="emptyState">No desired processes match the current filters.</p>
            ) : (
              <div className="runtimeProcessList">
                {filteredDesiredProcesses.map((processDefinition) => (
                  <div className="runtimeProcessRow" key={`desired-${processDefinition.id}`}>
                    <div className="runtimeProcessIdentity">
                      <TagChip className="logServiceTag">
                        {String(processDefinition.packageKey || processDefinition.processKey || '-').trim() || '-'}
                      </TagChip>
                      <span className="runtimeProcessMeta">
                        {String(processDefinition.command || '').trim() || '-'}
                        {processDefinition.args?.length ? ` ${processDefinition.args.join(' ')}` : ''}
                      </span>
                    </div>
                    <div className="runtimeProcessMetrics">
                      <span>{toDisplayValue(processDefinition.projectName || processDefinition.projectPath)}</span>
                      <span>Deployment {toDisplayValue(processDefinition.deploymentName || processDefinition.deploymentKey, 'none')}</span>
                      <span>{toDisplayValue(processDefinition.cwd)}</span>
                      <span>{toDisplayValue(processDefinition.restartPolicy)}</span>
                    </div>
                    <div className="runtimeProcessActions">
                      <button
                        type="button"
                        className="hostTextActionButton"
                        onClick={() => startEditingDesiredProcess(processDefinition)}
                        disabled={runtimeActionBusy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="hostTextActionButton danger"
                        onClick={() => deleteDesiredProcessDefinition(processDefinition)}
                        disabled={runtimeActionBusy}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="runtimeProcessSection">
            <div className="runtimeSubsectionHeader">
              <h4 className="runtimeSubsectionTitle">Observed Runs</h4>
              <span className="runtimeFilterCount">
                {filteredObservedProcessRuns.length}
                {' / '}
                {observedProcessRuns.length}
              </span>
            </div>
            <div className="runtimeFilterBar">
              <input
                type="search"
                className="hostsAddInput runtimeFilterInput"
                value={observedRunFilters.search}
                onChange={(event) => updateObservedFilter('search', event.target.value)}
                placeholder="Filter observed runs"
                aria-label="Filter observed runs"
              />
              <select
                className="hostsAddInput runtimeFilterSelect"
                value={observedRunFilters.projectPath}
                onChange={(event) => updateObservedFilter('projectPath', event.target.value)}
                aria-label="Filter observed runs by project"
              >
                <option value="">All projects</option>
                {observedProjectFilterOptions.map((option) => (
                  <option key={`observed-project-filter-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="hostsAddInput runtimeFilterSelect"
                value={observedRunFilters.deploymentKey}
                onChange={(event) => updateObservedFilter('deploymentKey', event.target.value)}
                aria-label="Filter observed runs by deployment"
              >
                <option value="">All deployments</option>
                {observedDeploymentFilterOptions.map((option) => (
                  <option key={`observed-deployment-filter-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="hostsAddInput runtimeFilterSelect"
                value={observedRunFilters.status}
                onChange={(event) => updateObservedFilter('status', event.target.value)}
                aria-label="Filter observed runs by status"
              >
                <option value="">All statuses</option>
                {observedStatusFilterOptions.map((status) => (
                  <option key={`observed-status-filter-${status}`} value={status}>
                    {status}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="hostTextActionButton"
                onClick={() => setObservedRunFilters(emptyRuntimeFilters())}
                disabled={!observedFiltersActive}
              >
                Clear
              </button>
            </div>
            {observedProcessRuns.length === 0 ? (
              <p className="emptyState">No managed processes are currently running on this host.</p>
            ) : filteredObservedProcessRuns.length === 0 ? (
              <p className="emptyState">No observed runs match the current filters.</p>
            ) : (
              <div className="runtimeProcessList">
                {filteredObservedProcessRuns.map((observedRun) => (
                  <div className="runtimeProcessRow" key={`observed-${observedRun.runId}`}>
                    <div className="runtimeProcessIdentity">
                      <TagChip className="logServiceTag">
                        {getObservedProcessLabel(observedRun)}
                      </TagChip>
                      <span className="runtimeProcessMeta">
                        pid {Number(observedRun.pid || 0) > 0 ? Number(observedRun.pid) : '-'}
                        {' · '}
                        {toDisplayValue(observedRun.status)}
                        {observedRun.lastSeenAt ? ` · ${formatRuntimeDateTime(observedRun.lastSeenAt)}` : ''}
                      </span>
                    </div>
                    <div className="runtimeProcessMetrics">
                      <span>Deployment {toDisplayValue(observedRun.deploymentName || observedRun.deploymentKey, 'none')}</span>
                      <span>CPU {formatRuntimePercent(observedRun.runtimeState?.cpuPercent)}</span>
                      <span>Mem {formatRuntimeBytes(observedRun.runtimeState?.rssBytes)}</span>
                      <span>
                        IO {formatRuntimeBytes(observedRun.runtimeState?.readBytes)}
                        {' / '}
                        {formatRuntimeBytes(observedRun.runtimeState?.writeBytes)}
                      </span>
                      <span>
                        FDs {toDisplayValue(observedRun.runtimeState?.openFds)}
                        {' · '}
                        Threads {toDisplayValue(observedRun.runtimeState?.threadCount)}
                      </span>
                      <span>Sampled {toDisplayValue(formatRuntimeDateTime(observedRun.runtimeState?.sampledAt))}</span>
                      <span>{toDisplayValue(observedRun.logPath)}</span>
                    </div>
                    <div className="runtimeProcessActions">
                      <button
                        type="button"
                        className="hostTextActionButton"
                        onClick={() => onViewManagedProcessLogs?.(selectedHost, observedRun)}
                        disabled={runtimeActionBusy}
                      >
                        Logs
                      </button>
                      <button
                        type="button"
                        className="hostTextActionButton"
                        onClick={() => onSoftKillObservedProcess?.(selectedHost, observedRun)}
                        disabled={runtimeActionBusy}
                      >
                        Soft Kill
                      </button>
                      <button
                        type="button"
                        className="hostTextActionButton danger"
                        onClick={() => onHardKillObservedProcess?.(selectedHost, observedRun)}
                        disabled={runtimeActionBusy}
                      >
                        Hard Kill
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
