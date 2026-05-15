import { useEffect, useMemo, useState } from 'react';
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
    hostPathMappings,
    hostRuntimeState,
    runtimeLoading,
    runtimeActionBusy,
    onRefreshSelectedHostRuntime,
    onEnsureDesiredProcess,
    onDeleteDesiredProcess,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    onViewManagedProcessLogs,
    formatRuntimeDateTime,
    formatVersionWithProtocol,
  } = useRuntimePanelContext();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draft, setDraft] = useState(() => buildDefaultDraft(selectedHost, selectedProject));
  const [editingDesiredProcessId, setEditingDesiredProcessId] = useState(null);

  useEffect(() => {
    setDraft(buildDefaultDraft(selectedHost, selectedProject));
    setShowCreateForm(false);
    setEditingDesiredProcessId(null);
  }, [selectedHost, selectedProject]);

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
      cwd: String(nextProject?.path || current.cwd || '').trim(),
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
                    placeholder="Defaults to package key"
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
            <h4 className="runtimeSubsectionTitle">Desired Processes</h4>
            {desiredProcesses.length === 0 ? (
              <p className="emptyState">No managed processes have been declared for this host.</p>
            ) : (
              <div className="runtimeProcessList">
                {desiredProcesses.map((processDefinition) => (
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
            <h4 className="runtimeSubsectionTitle">Observed Runs</h4>
            {observedProcessRuns.length === 0 ? (
              <p className="emptyState">No managed processes are currently running on this host.</p>
            ) : (
              <div className="runtimeProcessList">
                {observedProcessRuns.map((observedRun) => (
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
