import { useRuntimePanelContext } from '../../context/RuntimePanelContext';

const toDisplayValue = (value, fallback = '-') => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

export default function RuntimePanel() {
  const {
    runtimeConfig,
    runtimeBackendInfo,
    runtimeBackendInfoLoading,
    masterAgentInfo,
    isGoMasterBackend,
    formatRuntimeDateTime,
    formatVersionWithProtocol,
  } = useRuntimePanelContext();

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
    </div>
  );
}
