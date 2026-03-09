import { FiGitBranch, FiPlus, FiServer, FiTrash2, FiUpload } from 'react-icons/fi';
import TagChip from '../../../components/TagChip';
import { useHostsSidebarContext } from '../context/HostsSidebarContext';
import {
  formatRuntimeByteRatio,
  formatRuntimeBytes,
  formatRuntimePercent,
  getObservedProcessLabel,
} from '../lib/runtimeRegistryUi';

const isLoopbackTarget = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || normalized === '127.0.0.1'
    || normalized.startsWith('127.')
  );
};

export default function HostsSidebar() {
  const {
    hostsSidebarCollapsed,
    hostsSidebarWidthPx,
    onToggleSidebarCollapsed,
    hostsLoading,
    addingHost,
    deletingHostId,
    hosts,
    showAddHostRow,
    manualHostIp,
    onManualHostIpChange,
    onToggleAddHostRow,
    onAddHost,
    selectedHostId,
    onSelectHost,
    isMasterSidebarSelected,
    onSelectMasterHost,
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
    checkoutMutationBusyByHostId,
    slaveTargetVersion,
    upgradingHostId,
    runtimeRegistryByHostId,
    runtimeRegistryLoadingByHostId,
    runtimeActionBusyByHostId,
    onViewManagedProcessLogs,
    onSoftKillObservedProcess,
    onHardKillObservedProcess,
    onUpgradeHostAgent,
    onDeleteHost,
    onToggleHostCheckoutRow,
    onToggleHostDirectoryRow,
    onHostDirectoryInputChange,
    onAddHostDirectory,
    onRemoveHostDirectory,
    onCheckoutRepositoryInputChange,
    onCheckoutBaseDirectoryChange,
    onCheckoutDestinationChange,
    onCancelCheckoutHostProject,
    onCheckoutHostProject,
    toHostHealthClassName,
    normalizeHostDirectories,
    isHostVersionOutOfDate,
    deriveDestinationFolderFromRepositoryUrl,
    formatVersionWithProtocol,
    formatRuntimeDateTime,
  } = useHostsSidebarContext();
  const normalizedMasterConnectionStatus = String(masterConnectionStatus || 'unknown').trim() || 'unknown';
  const normalizedMasterRuntimeStatus = String(masterAgentInfo?.status || 'unknown').trim() || 'unknown';
  const masterStatusLabel = `${normalizedMasterConnectionStatus} (${normalizedMasterRuntimeStatus})`;
  const masterTargetValue = String(
    masterAgentInfo?.socketPath || masterAgentInfo?.target || '-',
  ).trim() || '-';

  return (
    <aside
      className={`hostsSidebar ${hostsSidebarCollapsed ? 'collapsed' : ''}`}
      style={hostsSidebarCollapsed ? undefined : { width: `${hostsSidebarWidthPx}px` }}
    >
      <div className="hostsSidebarHeader">
        {!hostsSidebarCollapsed ? (
          <h2 className="hostsSidebarHeaderTitle">Master Agent</h2>
        ) : null}
        <button
          type="button"
          className="hostsSidebarToggle"
          onClick={onToggleSidebarCollapsed}
          aria-label={hostsSidebarCollapsed ? 'Expand hosts sidebar' : 'Collapse hosts sidebar'}
          title={hostsSidebarCollapsed ? 'Expand hosts sidebar' : 'Collapse hosts sidebar'}
        >
          {hostsSidebarCollapsed ? '›' : '‹'}
        </button>
      </div>
      <div className="hostsSidebarBody">
        {hostsSidebarCollapsed ? (
          <div className="hostsSidebarCollapsedBody">
            <button
              type="button"
              className={`collapsedHostButton ${isMasterSidebarSelected ? 'selected' : ''}`}
              onClick={onSelectMasterHost}
              aria-label="Select master agent"
              title="Master Agent"
              data-testid="collapsed-master-agent"
            >
              <span className={`collapsedHostHealthDot ${masterConnectionHealthClass}`} aria-hidden="true" />
              <FiServer />
            </button>
            {hostsLoading ? (
              <span className="collapsedHostsEmpty" aria-label="Loading hosts">...</span>
            ) : null}
            {!hostsLoading && hosts.length === 0 ? (
              <span className="collapsedHostsEmpty" aria-label="No hosts">-</span>
            ) : null}
            {hosts.length > 0 ? (
              <div className="collapsedHostList" role="list" aria-label="Slave agents">
                {hosts.map((host) => {
                  const hostId = Number(host?.id) || 0;
                  const isSelectedHost = Number(selectedHostId) === hostId;
                  const hostHealthClass = toHostHealthClassName(host?.health);
                  const hostName = String(host?.name || host?.ip || hostId).trim() || String(hostId);
                  return (
                    <button
                      key={`collapsed-host-${hostId}`}
                      type="button"
                      className={`collapsedHostButton ${isSelectedHost ? 'selected' : ''}`}
                      onClick={() => onSelectHost(hostId)}
                      aria-label={`Select host ${hostName}`}
                      title={hostName}
                      data-testid={`collapsed-host-${hostId}`}
                    >
                      <span className={`collapsedHostHealthDot ${hostHealthClass}`} aria-hidden="true" />
                      <FiServer />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="runtimePanel hostsSidebarPanel">
            <div
              className={`runtimeSection hostCard masterHostRow ${isMasterSidebarSelected ? 'selected' : ''}`}
              onClick={onSelectMasterHost}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectMasterHost();
                }
              }}
            >
              <div className="hostCardHeader">
                <div className="hostCardTitle">
                  <span
                    className={`hostHealthDot ${masterConnectionHealthClass}`}
                    aria-label={`Health ${masterConnectionHealthClass}`}
                    title={`Health: ${masterConnectionHealthClass}`}
                  />
                  <h3 className="runtimeSectionTitle">Master Agent</h3>
                </div>
              </div>
              <div className="hostFieldGrid">
                <div className="hostFieldItem">
                  <span className="hostFieldLabel">Status</span>
                  <span className="hostFieldValue">{masterStatusLabel}</span>
                </div>
                <div className="hostFieldItem">
                  <span className="hostFieldLabel">Target</span>
                  <span className="hostFieldValue">{masterTargetValue}</span>
                </div>
                <div className="hostFieldItem">
                  <span className="hostFieldLabel">Version</span>
                  <span className="hostFieldValue">
                    {formatVersionWithProtocol(masterAgentInfo?.version, masterAgentInfo?.protocolVersion)}
                  </span>
                </div>
              </div>
            </div>

            <div className="hostsToolbar">
              <h3 className="runtimeSectionTitle">Slave Agents</h3>
              <button
                type="button"
                className="hostsAddButton"
                onClick={onToggleAddHostRow}
                disabled={hostsLoading || addingHost || deletingHostId != null}
                aria-label="Add host"
                title="Add host"
              >
                <FiPlus />
              </button>
            </div>

            {showAddHostRow ? (
              <div className="hostsAddRow">
                <input
                  type="text"
                  className="hostsAddInput"
                  placeholder="Enter host target (IP, hostname, or URL)"
                  value={manualHostIp}
                  onChange={(event) => onManualHostIpChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onAddHost();
                    }
                  }}
                  disabled={addingHost}
                  aria-label="Host target"
                />
                <button
                  type="button"
                  className="hostsAddAction"
                  onClick={onAddHost}
                  disabled={addingHost}
                >
                  {addingHost ? 'Adding...' : 'Add'}
                </button>
              </div>
            ) : null}

            {hostsLoading ? (
              <p className="emptyState">Loading registered hosts...</p>
            ) : null}
            {!hostsLoading && hosts.length === 0 ? (
              <p className="emptyState">No slave agents registered with master agent.</p>
            ) : null}
            {hosts.length > 0 ? (
              <div className="environmentTable hostList">
                {hosts.map((host) => {
                  const isManualHost = String(host?.source || '').toLowerCase() === 'manual';
                  const hostId = Number(host?.id) || 0;
                  const isSelectedHost = Number(selectedHostId) === hostId;
                  const hostHealthClass = toHostHealthClassName(host?.health);
                  const statusLabel = String(host?.status || 'unknown').trim() || 'unknown';
                  const onlineLabel = host?.online ? 'online' : 'offline';
                  const hostDirectories = normalizeHostDirectories(host?.directories);
                  const showDirectoryRow = Boolean(showAddDirectoryRowByHostId?.[hostId]);
                  const directoryInputValue = String(directoryInputByHostId?.[hostId] || '');
                  const directoryMutationBusy = Boolean(directoryMutationBusyByHostId?.[hostId]);
                  const showCheckoutRow = Boolean(showCheckoutRowByHostId?.[hostId]);
                  const checkoutRepoInput = String(checkoutRepoInputByHostId?.[hostId] || '');
                  const checkoutBaseDirectory = String(
                    checkoutBaseDirectoryByHostId?.[hostId] || hostDirectories[0] || '',
                  );
                  const checkoutDestination = String(checkoutDestinationByHostId?.[hostId] || '');
                  const checkoutMutationBusy = Boolean(checkoutMutationBusyByHostId?.[hostId]);
                  const hostOutOfDate = isHostVersionOutOfDate(host?.version, slaveTargetVersion);
                  const useSocketTarget = Boolean(host?.targetSocket) || isLoopbackTarget(host?.ip);
                  const targetValue = useSocketTarget
                    ? String(host?.targetSocket || host?.ip || '-').trim() || '-'
                    : (host.ip || '-');
                  const runtimeBundle = runtimeRegistryByHostId?.[hostId] || null;
                  const runtimeLoading = Boolean(runtimeRegistryLoadingByHostId?.[hostId]);
                  const runtimeBusy = Boolean(runtimeActionBusyByHostId?.[hostId]);
                  const observedRuns = Array.isArray(runtimeBundle?.observedProcessRuns)
                    ? runtimeBundle.observedProcessRuns
                    : [];
                  const desiredProcesses = Array.isArray(runtimeBundle?.desiredProcesses)
                    ? runtimeBundle.desiredProcesses
                    : [];
                  const hostRuntimeState = runtimeBundle?.slaveRuntimeState?.hostRuntimeState || null;
                  const projectCount = Number.isInteger(Number(host?.projectCount))
                    ? Number(host.projectCount)
                    : (Array.isArray(host?.projects) ? host.projects.length : 0);
                  const deployButtonTitle = !slaveTargetVersion
                    ? 'Re-deploy slave agent (target version unknown).'
                    : hostOutOfDate
                      ? `Upgrade slave to ${slaveTargetVersion}`
                      : `Re-deploy slave agent (${String(host?.version || '').trim() || 'unknown'} is current).`;
                  const deployActionLabel = hostOutOfDate ? 'Upgrade' : 'Re-deploy';
                  const checkoutDestinationOptions = Array.from(new Set(
                    [
                      deriveDestinationFolderFromRepositoryUrl(checkoutRepoInput),
                      ...(
                        Array.isArray(host?.projects)
                          ? host.projects
                            .map((project) => String(project?.name || '').trim())
                            .filter(Boolean)
                          : []
                      ),
                    ].filter(Boolean),
                  ));
                  return (
                    <div
                      className={`runtimeSection hostCard ${isSelectedHost ? 'selected' : ''}`}
                      key={`${host.id}-${host.name}`}
                      onClick={() => onSelectHost(hostId)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectHost(hostId);
                        }
                      }}
                    >
                      <div className="hostCardHeader">
                        <div className="hostCardTitle">
                          <span
                            className={`hostHealthDot ${hostHealthClass}`}
                            aria-label={`Health ${hostHealthClass}`}
                            title={`Health: ${hostHealthClass}`}
                          />
                          <h3 className="runtimeSectionTitle">
                            {host.name}
                            {isManualHost ? ' (manual)' : ''}
                          </h3>
                        </div>
                        <div className="hostCardActions">
                          <button
                            type="button"
                            className="hostsActionButton hostCheckoutButton"
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleHostCheckoutRow(hostId, hostDirectories);
                            }}
                            disabled={hostsLoading || checkoutMutationBusy || deletingHostId === hostId}
                            aria-label={`Checkout project on host ${host.name}`}
                            title="Checkout project"
                          >
                            <FiGitBranch />
                          </button>
                          <button
                            type="button"
                            className="hostsActionButton hostUpgradeButton"
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpgradeHostAgent(host);
                            }}
                            disabled={
                              hostsLoading
                              || checkoutMutationBusy
                              || upgradingHostId === hostId
                              || deletingHostId === hostId
                            }
                            aria-label={`${deployActionLabel} slave agent on host ${host.name}`}
                            title={deployButtonTitle}
                          >
                            {upgradingHostId === hostId ? '...' : <FiUpload />}
                          </button>
                          {isManualHost ? (
                            <button
                              type="button"
                              className="hostsDeleteButton"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteHost(host);
                              }}
                              disabled={hostsLoading || deletingHostId === Number(host.id)}
                              aria-label={`Delete host ${host.name}`}
                              title="Delete host"
                            >
                              {deletingHostId === Number(host.id) ? '...' : <FiTrash2 />}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="hostFieldGrid">
                        <div className="hostFieldItem">
                          <span className="hostFieldLabel">Status</span>
                          <span className="hostFieldValue">
                            {`${statusLabel} (${onlineLabel})`}
                            {host?.lastSeenAt ? ` (last seen ${formatRuntimeDateTime(host.lastSeenAt)})` : ''}
                          </span>
                        </div>
                        {host?.error ? (
                          <div className="hostFieldItem hostFieldItemError">
                            <span className="hostFieldLabel">Connection Error</span>
                            <span className="hostFieldValue">{String(host.error)}</span>
                          </div>
                        ) : null}
                        <div className="hostFieldItem">
                          <span className="hostFieldLabel">Target</span>
                          <span className="hostFieldValue">{targetValue}</span>
                        </div>
                        {!useSocketTarget ? (
                          <div className="hostFieldItem">
                            <span className="hostFieldLabel">Port</span>
                            <span className="hostFieldValue">{Number.isInteger(host.port) ? host.port : '-'}</span>
                          </div>
                        ) : null}
                        <div className="hostFieldItem">
                          <span className="hostFieldLabel">Projects</span>
                          <span className="hostFieldValue">{`${projectCount} detected`}</span>
                        </div>
                        <div className="hostFieldItem">
                          <span className="hostFieldLabel">Version</span>
                          <span className="hostFieldValue">
                            {formatVersionWithProtocol(host?.version, host?.protocolVersion)}
                          </span>
                        </div>
                        {isSelectedHost ? (
                          <div className="hostFieldItem">
                            <span className="hostFieldLabel">Runtime CPU</span>
                            <span className="hostFieldValue">
                              {runtimeLoading
                                ? 'Loading...'
                                : formatRuntimePercent(hostRuntimeState?.cpuPercent)}
                            </span>
                          </div>
                        ) : null}
                        {isSelectedHost ? (
                          <div className="hostFieldItem">
                            <span className="hostFieldLabel">Runtime Memory</span>
                            <span className="hostFieldValue">
                              {runtimeLoading
                                ? 'Loading...'
                                : formatRuntimeByteRatio(
                                  hostRuntimeState?.memoryUsedBytes,
                                  hostRuntimeState?.memoryTotalBytes,
                                )}
                            </span>
                          </div>
                        ) : null}
                        {isSelectedHost ? (
                          <div className="hostFieldItem">
                            <span className="hostFieldLabel">Desired Processes</span>
                            <span className="hostFieldValue">
                              {runtimeLoading ? 'Loading...' : desiredProcesses.length}
                            </span>
                          </div>
                        ) : null}
                        {isSelectedHost ? (
                          <div className="hostFieldItem">
                            <span className="hostFieldLabel">Observed Runs</span>
                            <span className="hostFieldValue">
                              {runtimeLoading ? 'Loading...' : observedRuns.length}
                            </span>
                          </div>
                        ) : null}
                        <div className="hostFieldItem">
                          <span className="hostFieldLabel hostFieldLabelWithAction">
                            <span>Directories</span>
                            <button
                              type="button"
                              className="hostDirectoryAddButton"
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleHostDirectoryRow(hostId);
                              }}
                              disabled={hostsLoading || directoryMutationBusy || deletingHostId === hostId}
                              aria-label={`Add directory for host ${host.name}`}
                              title="Add directory"
                            >
                              <FiPlus />
                            </button>
                          </span>
                          <span className="hostFieldValue">
                            {hostDirectories.length > 0
                              ? `${hostDirectories.length} configured`
                              : '-'}
                          </span>
                        </div>
                      </div>
                      {isSelectedHost ? (
                        <div className="hostRuntimeProcessSection">
                          <div className="runtimeInlineMeta">Desired Processes</div>
                          {desiredProcesses.length > 0 ? (
                            <div className="hostRuntimeProcessList">
                              {desiredProcesses.map((desiredProcess) => (
                                <div
                                  className="hostRuntimeProcessRow"
                                  key={`${hostId}-desired-${desiredProcess.id}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="hostRuntimeProcessIdentity">
                                    <TagChip className="logServiceTag">
                                      {String(
                                        desiredProcess?.packageKey
                                        || desiredProcess?.processKey
                                        || '-',
                                      ).trim() || '-'}
                                    </TagChip>
                                    <span className="hostRuntimeProcessMeta">
                                      {String(desiredProcess?.command || '').trim() || '-'}
                                      {Array.isArray(desiredProcess?.args) && desiredProcess.args.length > 0
                                        ? ` ${desiredProcess.args.join(' ')}`
                                        : ''}
                                    </span>
                                  </div>
                                  <div className="hostRuntimeProcessMeta">
                                    {String(desiredProcess?.cwd || '').trim() || '-'}
                                    {' · '}
                                    {String(desiredProcess?.restartPolicy || '').trim() || '-'}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="emptyState hostRuntimeEmptyState">No desired processes.</p>
                          )}
                        </div>
                      ) : null}
                      {isSelectedHost ? (
                        <div className="hostRuntimeProcessSection">
                          <div className="runtimeInlineMeta">Observed Runs</div>
                          {observedRuns.length > 0 ? (
                            <div className="hostRuntimeProcessList">
                              {observedRuns.map((observedRun) => (
                                <div
                                  className="hostRuntimeProcessRow"
                                  key={`${hostId}-${observedRun.runId}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="hostRuntimeProcessIdentity">
                                    <TagChip className="logServiceTag">
                                      {getObservedProcessLabel(observedRun)}
                                    </TagChip>
                                    <span className="hostRuntimeProcessMeta">
                                      pid {Number(observedRun?.pid || 0) > 0 ? Number(observedRun.pid) : '-'}
                                      {' · '}
                                      {String(observedRun?.status || '-').trim() || '-'}
                                      {' · '}
                                      {formatRuntimeBytes(observedRun?.runtimeState?.rssBytes)}
                                    </span>
                                  </div>
                                  <div className="hostRuntimeProcessActions">
                                    <button
                                      type="button"
                                      className="hostTextActionButton"
                                      onClick={() => onViewManagedProcessLogs?.(host, observedRun)}
                                      disabled={runtimeBusy}
                                    >
                                      Logs
                                    </button>
                                    <button
                                      type="button"
                                      className="hostTextActionButton"
                                      onClick={() => onSoftKillObservedProcess?.(host, observedRun)}
                                      disabled={runtimeBusy}
                                    >
                                      Soft
                                    </button>
                                    <button
                                      type="button"
                                      className="hostTextActionButton danger"
                                      onClick={() => onHardKillObservedProcess?.(host, observedRun)}
                                      disabled={runtimeBusy}
                                    >
                                      Hard
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="emptyState hostRuntimeEmptyState">No observed runs.</p>
                          )}
                        </div>
                      ) : null}
                      {showDirectoryRow ? (
                        <div
                          className="hostDirectoryAddRow"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="text"
                            className="hostsAddInput hostDirectoryAddInput"
                            placeholder="Enter directory path (e.g. /opt/workspace)"
                            value={directoryInputValue}
                            onChange={(event) => {
                              onHostDirectoryInputChange(hostId, event.target.value);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                onAddHostDirectory(host);
                              }
                            }}
                            disabled={directoryMutationBusy}
                            aria-label={`Directory path for host ${host.name}`}
                          />
                          <button
                            type="button"
                            className="hostsAddAction"
                            onClick={() => onAddHostDirectory(host)}
                            disabled={directoryMutationBusy}
                          >
                            {directoryMutationBusy ? 'Saving...' : 'Submit'}
                          </button>
                        </div>
                      ) : null}
                      {hostDirectories.length > 0 ? (
                        <div className="hostDirectoryList">
                          {hostDirectories.map((directoryPath) => (
                            <div className="hostDirectoryItem" key={`${hostId}-${directoryPath}`}>
                              <span className="hostDirectoryPath">{directoryPath}</span>
                              <button
                                type="button"
                                className="hostDirectoryRemoveButton"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onRemoveHostDirectory({ host, directoryPath });
                                }}
                                disabled={directoryMutationBusy}
                                aria-label={`Remove directory ${directoryPath}`}
                                title="Remove directory"
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {showCheckoutRow ? (
                        <div
                          className="hostCheckoutForm"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="text"
                            className="hostsAddInput hostCheckoutInput"
                            placeholder="Git repository URL (e.g. git@github.com:org/repo.git)"
                            value={checkoutRepoInput}
                            onChange={(event) => onCheckoutRepositoryInputChange(hostId, event.target.value)}
                            disabled={checkoutMutationBusy}
                            aria-label={`Repository URL for host ${host.name}`}
                          />
                          <div className="hostCheckoutRow">
                            <span className="hostCheckoutLabel">Project directory</span>
                            <select
                              className="hostsAddInput hostCheckoutSelect"
                              value={checkoutBaseDirectory}
                              onChange={(event) => {
                                onCheckoutBaseDirectoryChange(hostId, event.target.value);
                              }}
                              disabled={checkoutMutationBusy || hostDirectories.length === 0}
                              aria-label={`Project directory for host ${host.name}`}
                            >
                              {hostDirectories.length === 0 ? (
                                <option value="">No directories configured</option>
                              ) : hostDirectories.map((directoryPath) => (
                                <option key={`${hostId}-base-${directoryPath}`} value={directoryPath}>
                                  {directoryPath}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="hostCheckoutRow">
                            <span className="hostCheckoutLabel">Destination folder</span>
                            <div className="hostCheckoutDestinationWrap">
                              <input
                                type="text"
                                list={`checkout-destination-options-${hostId}`}
                                className="hostsAddInput hostCheckoutInput"
                                placeholder="Destination folder (e.g. my-repo)"
                                value={checkoutDestination}
                                onChange={(event) => {
                                  onCheckoutDestinationChange(hostId, event.target.value);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    onCheckoutHostProject(host);
                                  }
                                }}
                                disabled={checkoutMutationBusy}
                                aria-label={`Destination folder for host ${host.name}`}
                              />
                              <datalist id={`checkout-destination-options-${hostId}`}>
                                {checkoutDestinationOptions.map((value) => (
                                  <option key={`${hostId}-checkout-destination-${value}`} value={value} />
                                ))}
                              </datalist>
                            </div>
                          </div>
                          <div className="hostCheckoutActions">
                            <button
                              type="button"
                              className="hostsAddAction hostCheckoutCancel"
                              onClick={() => onCancelCheckoutHostProject(hostId)}
                              disabled={checkoutMutationBusy}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="hostsAddAction hostCheckoutSubmit"
                              onClick={() => onCheckoutHostProject(host)}
                              disabled={checkoutMutationBusy || hostDirectories.length === 0}
                            >
                              {checkoutMutationBusy ? 'Queuing...' : 'Submit'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
