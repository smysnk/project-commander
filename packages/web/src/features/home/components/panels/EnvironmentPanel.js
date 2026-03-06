import {
  PORT_RANGE_BEGIN_MAX,
  PORT_RANGE_BEGIN_MIN,
  PORT_RANGE_MODE,
} from '../../constants/ui';
import { useEnvironmentPanelContext } from '../../context/EnvironmentPanelContext';

export default function EnvironmentPanel() {
  const {
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
  } = useEnvironmentPanelContext();
  return (
    <div className="environmentPanel">
      {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
      {selectedProject ? (
        <div className="environmentTable">
          <div className="environmentRow environmentPortRangeRow">
            <span className="environmentKey">Port Range</span>
            <div className="environmentValue environmentPortRangeControls">
              <div className="portRangeModeToggle" role="group" aria-label="Port range mode">
                <button
                  type="button"
                  className={`portRangeModeBtn ${projectPortRangeSettings.mode === PORT_RANGE_MODE.AUTOMATIC ? 'active' : ''}`}
                  onClick={() => onSelectPortRangeMode(PORT_RANGE_MODE.AUTOMATIC)}
                  disabled={portRangeControlsDisabled}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  className={`portRangeModeBtn ${projectPortRangeSettings.mode === PORT_RANGE_MODE.MANUAL ? 'active' : ''}`}
                  onClick={() => onSelectPortRangeMode(PORT_RANGE_MODE.MANUAL)}
                  disabled={portRangeControlsDisabled}
                >
                  Manual
                </button>
              </div>
              {isManualPortRangeMode ? (
                <div className="portRangeManualRow">
                  <input
                    type="number"
                    className="portRangeInput"
                    inputMode="numeric"
                    min={PORT_RANGE_BEGIN_MIN}
                    max={PORT_RANGE_BEGIN_MAX}
                    value={manualPortRangeValue}
                    placeholder={String(PORT_RANGE_BEGIN_MIN)}
                    disabled={portRangeControlsDisabled || hasAcceptedManualPortRange}
                    onChange={(event) => setManualPortRangeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !hasAcceptedManualPortRange && !portRangeControlsDisabled) {
                        event.preventDefault();
                        onAcceptManualPortRange();
                      }
                    }}
                  />
                  {!hasAcceptedManualPortRange ? (
                    <button
                      type="button"
                      className="portRangeAcceptBtn"
                      onClick={onAcceptManualPortRange}
                      disabled={portRangeControlsDisabled}
                      aria-label="Accept manual start port"
                      title="Accept manual start port"
                    >
                      ✓
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {environmentLoading ? (
            <p className="emptyState">Loading launch environment...</p>
          ) : null}
          {!environmentLoading && projectEnvironment.length === 0 ? (
            <p className="emptyState">No launch environment variables resolved.</p>
          ) : null}
          {projectEnvironment.map((entry) => (
            <div className="environmentRow" key={`${entry.key}-${entry.value}`}>
              <span className="environmentKey">{entry.key}</span>
              <span className="environmentValue">{entry.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
