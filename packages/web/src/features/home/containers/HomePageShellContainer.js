import { useEffect, useState } from 'react';
import HostsSidebar from '../components/HostsSidebar';
import ProjectListPane from '../components/ProjectListPane';
import StatusBar from '../components/StatusBar';
import WorkspaceMenuBar from '../components/WorkspaceMenuBar';
import DebugPanel from '../components/panels/DebugPanel';
import EnvironmentPanel from '../components/panels/EnvironmentPanel';
import LogsPanel from '../components/panels/LogsPanel';
import RuntimePanel from '../components/panels/RuntimePanel';
import TerminalPanel from '../components/panels/TerminalPanel';
import TopPanel from '../components/panels/TopPanel';
import { WORKSPACE_PANEL } from '../constants/ui';
import {
  useHomeLayoutContext,
} from '../context/HomeLayoutContext';

const RIGHT_PANEL_COMPONENTS = {
  [WORKSPACE_PANEL.RUNTIME]: RuntimePanel,
  [WORKSPACE_PANEL.TERMINAL]: TerminalPanel,
  [WORKSPACE_PANEL.ENVIRONMENT]: EnvironmentPanel,
  [WORKSPACE_PANEL.TOP]: TopPanel,
  [WORKSPACE_PANEL.DEBUG]: DebugPanel,
};

const DETAIL_PANEL_ORDER = [
  WORKSPACE_PANEL.RUNTIME,
  WORKSPACE_PANEL.TERMINAL,
  WORKSPACE_PANEL.ENVIRONMENT,
  WORKSPACE_PANEL.TOP,
  WORKSPACE_PANEL.DEBUG,
];

const getDesktopDetailPanel = (activeWorkspacePanel) => (
  DETAIL_PANEL_ORDER.includes(activeWorkspacePanel)
    ? activeWorkspacePanel
    : WORKSPACE_PANEL.RUNTIME
);

function useIsCompactWorkspace() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(max-width: 720px)');
    const update = () => setIsCompact(Boolean(mediaQuery.matches));
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return isCompact;
}

function WorkspacePanelViewport({ activeWorkspacePanel }) {
  if (activeWorkspacePanel === WORKSPACE_PANEL.HOSTS) {
    return <HostsSidebar />;
  }

  if (activeWorkspacePanel === WORKSPACE_PANEL.PROJECTS) {
    return <ProjectListPane />;
  }

  const ActivePanel = RIGHT_PANEL_COMPONENTS[activeWorkspacePanel] || LogsPanel;
  return (
    <section className="workspacePanelContent workspacePanelBody">
      <ActivePanel />
    </section>
  );
}

export default function HomePageShellContainer({ authEnabled = false }) {
  const layoutState = useHomeLayoutContext();
  const {
    workspaceRef,
    activeWorkspacePanel,
    onSelectWorkspacePanel,
  } = layoutState;
  const isCompactWorkspace = useIsCompactWorkspace();
  const desktopDetailPanel = getDesktopDetailPanel(activeWorkspacePanel);
  const DesktopDetailPanel = RIGHT_PANEL_COMPONENTS[desktopDetailPanel] || RuntimePanel;

  const workspace = isCompactWorkspace ? (
    <div className="workspace workspaceSinglePanel" ref={workspaceRef}>
      <main className="workspacePanelViewport" data-active-panel={activeWorkspacePanel}>
        <WorkspacePanelViewport activeWorkspacePanel={activeWorkspacePanel} />
      </main>
    </div>
  ) : (
    <div className="workspace workspaceSplitShell" ref={workspaceRef}>
      <HostsSidebar />

      <main className="desktopMainPanel" aria-label="Projects">
        <ProjectListPane />
      </main>

      <aside className="desktopRightPanel" aria-label="Detail panel">
        <section className="desktopRightPanelBody workspacePanelBody">
          <DesktopDetailPanel />
        </section>
      </aside>

      <section className="bottomLogTray" aria-label="Log tray">
        <div className="bottomLogTrayHeader">
          <span>Logs</span>
          <button
            type="button"
            className={`panelTab ${activeWorkspacePanel === WORKSPACE_PANEL.LOGS ? 'active' : ''}`}
            onClick={() => onSelectWorkspacePanel(WORKSPACE_PANEL.LOGS)}
          >
            Focus Logs
          </button>
        </div>
        <LogsPanel />
      </section>
    </div>
  );

  return (
    <div className="appShell">
      <WorkspaceMenuBar authEnabled={authEnabled} />

      {workspace}

      <StatusBar />
    </div>
  );
}
