import { useRightPaneContext } from '../context/RightPaneContext';
import DebugPanel from './panels/DebugPanel';
import EnvironmentPanel from './panels/EnvironmentPanel';
import LogsPanel from './panels/LogsPanel';
import RuntimePanel from './panels/RuntimePanel';
import TerminalPanel from './panels/TerminalPanel';
import TopPanel from './panels/TopPanel';

const RIGHT_PANE_TABS = [
  { id: 'logs', label: 'Logs', panel: LogsPanel },
  { id: 'debug', label: 'Debug', panel: DebugPanel },
  { id: 'environment', label: 'Environment', panel: EnvironmentPanel },
  { id: 'top', label: 'Top', panel: TopPanel },
  { id: 'runtime', label: 'Runtime', panel: RuntimePanel },
  { id: 'terminal', label: 'Terminal', panel: TerminalPanel },
];

export default function RightPane() {
  const { rightTab, onSelectRightTab } = useRightPaneContext();
  const activeTab = RIGHT_PANE_TABS.find((tab) => tab.id === rightTab) || RIGHT_PANE_TABS[0];
  const ActivePanel = activeTab.panel;

  return (
    <section className="rightPanel">
      <div className="panelTabs">
        <div className="panelTabsGroup" role="tablist" aria-label="Output tabs">
          {RIGHT_PANE_TABS.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`panelTab ${selected ? 'active' : ''}`}
                role="tab"
                aria-selected={selected}
                onClick={() => onSelectRightTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <ActivePanel />
    </section>
  );
}
