'use client';

import { signOut, useSession } from 'next-auth/react';
import { useSelector } from 'react-redux';
import ThemeDropdown from '../../../components/ThemeDropdown';
import {
  WORKSPACE_PANEL_LABELS,
  WORKSPACE_PANEL_ORDER,
} from '../constants/ui';
import {
  useHomeLayoutContext,
} from '../context/HomeLayoutContext';
import { useStatusBarContext } from '../context/StatusBarContext';
import {
  selectIsMasterSidebarSelected,
  selectSelectedHost,
  selectSelectedProject,
} from '../store/selectors';

const basename = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || normalized;
};

const getProjectLabel = (project) => (
  String(project?.name || '').trim() || basename(project?.path) || 'No project'
);

const getHostLabel = ({ selectedHost, isMasterSidebarSelected }) => {
  if (isMasterSidebarSelected) {
    return 'Master';
  }
  return String(selectedHost?.name || selectedHost?.hostName || selectedHost?.ip || '').trim() || 'No host';
};

function AuthenticatedMenuControls() {
  const { data: session, status } = useSession();
  const email = typeof session?.user?.email === 'string' ? session.user.email : '';
  const isLoading = status === 'loading';

  return (
    <>
      {email ? <span className="menuItem menuAuthLabel">{email}</span> : null}
      <button
        type="button"
        className="menuButton menuButtonSecondary"
        onClick={() => signOut({ callbackUrl: '/login' })}
        disabled={isLoading}
      >
        {isLoading ? 'Loading...' : 'Logout'}
      </button>
    </>
  );
}

export default function WorkspaceMenuBar({ authEnabled = false }) {
  const {
    activeWorkspacePanel,
    onSelectWorkspacePanel,
  } = useHomeLayoutContext();
  const {
    projectsCount = 0,
    runningCount = 0,
  } = useStatusBarContext();
  const selectedProject = useSelector(selectSelectedProject);
  const selectedHost = useSelector(selectSelectedHost);
  const isMasterSidebarSelected = useSelector(selectIsMasterSidebarSelected);
  const projectLabel = getProjectLabel(selectedProject);
  const hostLabel = getHostLabel({ selectedHost, isMasterSidebarSelected });

  return (
    <header className="topMenuBar">
      <div className="menuLeft">
        <span className="menuTitle">Project Commander</span>
        <span className="menuItem">Projects: {projectsCount}</span>
        <span className="menuItem">Running: {runningCount}</span>
      </div>

      <nav className="workspacePanelNav" aria-label="Workspace panels">
        {WORKSPACE_PANEL_ORDER.map((panelId) => {
          const selected = panelId === activeWorkspacePanel;
          const label = WORKSPACE_PANEL_LABELS[panelId] || panelId;
          return (
            <button
              key={panelId}
              type="button"
              className={`workspacePanelButton ${selected ? 'active' : ''}`}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelectWorkspacePanel(panelId)}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <div className="workspaceContextChips" aria-label="Current workspace context">
        <span className="workspaceContextChip" title={projectLabel}>
          Project: {projectLabel}
        </span>
        <span className="workspaceContextChip" title={hostLabel}>
          Host: {hostLabel}
        </span>
      </div>

      <div className="menuRight">
        {authEnabled ? <AuthenticatedMenuControls /> : null}
        <ThemeDropdown />
      </div>
    </header>
  );
}
