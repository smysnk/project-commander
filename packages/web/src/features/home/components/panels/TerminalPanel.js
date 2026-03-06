import { useTerminalPanelContext } from '../../context/TerminalPanelContext';

export default function TerminalPanel() {
  const {
    selectedHost,
    selectedHostNumericId,
    selectedTerminalSession,
    selectedTerminalOutput,
    selectedHostTerminalInput,
    selectedHostTerminalStarting,
    selectedHostTerminalSending,
    onTerminalInputChange,
    onSubmitTerminalInput,
    onStartTerminalSession,
    terminalOutputRef,
  } = useTerminalPanelContext();

  const hostLabel = String(selectedHost?.name || selectedHost?.ip || '').trim();
  const hasSelectedHost = Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0;
  const isActiveSession = String(selectedTerminalSession?.status || '').trim().toLowerCase() === 'active';
  const sessionClosed = selectedTerminalSession && !isActiveSession;

  const onSubmit = (event) => {
    event?.preventDefault?.();
    onSubmitTerminalInput();
  };

  return (
    <div className="terminalPanel">
      {!hasSelectedHost ? (
        <p className="emptyState">Select a slave agent to start a terminal session.</p>
      ) : null}

      {hasSelectedHost && !isActiveSession ? (
        <div className="terminalNewSessionState">
          <p className="terminalSessionStatus">
            {sessionClosed
              ? `Terminal session for ${hostLabel || 'selected host'} is closed.`
              : `No active terminal session for ${hostLabel || 'selected host'}.`}
          </p>
          <button
            type="button"
            className="terminalRunButton terminalNewSessionButton"
            onClick={onStartTerminalSession}
            disabled={selectedHostTerminalStarting}
          >
            {selectedHostTerminalStarting ? 'Starting...' : 'New Session'}
          </button>
        </div>
      ) : null}

      {hasSelectedHost && isActiveSession ? (
        <div className="terminalSessionWrap">
          <div className="terminalOutput" ref={terminalOutputRef}>
            {selectedTerminalOutput.length === 0 ? (
              <p className="terminalEmptyOutput">Session is active. No output yet.</p>
            ) : (
              selectedTerminalOutput.map((entry, index) => {
                const timestamp = entry?.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '--:--:--';
                const stream = String(entry?.stream || 'stdout').trim().toLowerCase();
                const lineClassName = `terminalLine ${stream === 'stderr' ? 'stderr' : stream === 'system' ? 'system' : 'stdout'}`;
                const lineKey = `${String(entry?.timestamp || '')}-${stream}-${index}`;
                return (
                  <div key={lineKey} className={lineClassName}>
                    <span className="terminalLineTimestamp">{timestamp}</span>
                    <span className="terminalLineStream">{stream}</span>
                    <span className="terminalLineText">{String(entry?.text || '')}</span>
                  </div>
                );
              })
            )}
          </div>
          <form className="terminalInputRow" onSubmit={onSubmit}>
            <span className="terminalPrompt">$</span>
            <input
              type="text"
              className="terminalInput"
              value={selectedHostTerminalInput}
              placeholder="Enter command..."
              onChange={(event) => onTerminalInputChange(event.target.value)}
              disabled={selectedHostTerminalSending}
            />
            <button
              type="submit"
              className="terminalRunButton"
              disabled={selectedHostTerminalSending || !String(selectedHostTerminalInput || '').trim()}
            >
              {selectedHostTerminalSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
