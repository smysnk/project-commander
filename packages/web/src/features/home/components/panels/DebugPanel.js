import DebugTreeNode from '../DebugTreeNode';
import { useDebugPanelContext } from '../../context/DebugPanelContext';

export default function DebugPanel() {
  const {
    selectedProject,
    debugData,
    debugExpandedPaths,
    toggleDebugPath,
  } = useDebugPanelContext();
  const expandedPaths = new Set(debugExpandedPaths || []);
  return (
    <div className="debugPanel">
      {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
      {selectedProject && debugData ? (
        <div className="debugTree">
          <DebugTreeNode
            name="project"
            value={debugData}
            path=""
            expandedPaths={expandedPaths}
            togglePath={toggleDebugPath}
          />
        </div>
      ) : null}
    </div>
  );
}
