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
  [WORKSPACE_PANEL.LOGS]: LogsPanel,
  [WORKSPACE_PANEL.RUNTIME]: RuntimePanel,
  [WORKSPACE_PANEL.TERMINAL]: TerminalPanel,
  [WORKSPACE_PANEL.ENVIRONMENT]: EnvironmentPanel,
  [WORKSPACE_PANEL.TOP]: TopPanel,
  [WORKSPACE_PANEL.DEBUG]: DebugPanel,
};

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
  } = layoutState;

  return (
    <div className="appShell">
      <WorkspaceMenuBar authEnabled={authEnabled} />

      <div className="workspace workspaceSinglePanel" ref={workspaceRef}>
        <main className="workspacePanelViewport" data-active-panel={activeWorkspacePanel}>
          <WorkspacePanelViewport activeWorkspacePanel={activeWorkspacePanel} />
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
