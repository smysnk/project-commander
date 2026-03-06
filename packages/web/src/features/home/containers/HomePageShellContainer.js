import ThemeDropdown from '../../../components/ThemeDropdown';
import HostsSidebar from '../components/HostsSidebar';
import ProjectListPane from '../components/ProjectListPane';
import RightPane from '../components/RightPane';
import StatusBar from '../components/StatusBar';
import {
  useHomeLayoutContext,
} from '../context/HomeLayoutContext';
import { useStatusBarContext } from '../context/StatusBarContext';

export default function HomePageShellContainer() {
  const layoutState = useHomeLayoutContext();
  const {
    projectsCount = 0,
    runningCount = 0,
  } = useStatusBarContext();
  const {
    workspaceRef,
    mainPanelsRef,
    hostsSidebarCollapsed,
    resizing,
    resizingHandleRef,
    onStartResize,
  } = layoutState;

  return (
    <div className="appShell">
      <header className="topMenuBar">
        <div className="menuLeft">
          <span className="menuTitle">Project Commander</span>
          <span className="menuItem">Projects: {projectsCount}</span>
          <span className="menuItem">Running: {runningCount}</span>
        </div>
        <div className="menuRight">
          <ThemeDropdown />
        </div>
      </header>

      <div className="workspace" ref={workspaceRef}>
        <HostsSidebar />
        {!hostsSidebarCollapsed ? (
          <div
            className={`divider sidebarDivider ${resizing && resizingHandleRef.current === 'sidebar' ? 'active' : ''}`}
            onMouseDown={(event) => onStartResize(event, 'sidebar')}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize hosts sidebar"
            data-testid="sidebar-divider"
          />
        ) : null}
        <div className="mainPanels" ref={mainPanelsRef}>
          <ProjectListPane />

          <div
            className={`divider contentDivider ${resizing && resizingHandleRef.current === 'content' ? 'active' : ''}`}
            onMouseDown={(event) => onStartResize(event, 'content')}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panels"
            data-testid="content-divider"
          />

          <RightPane />
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
