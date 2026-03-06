import { useStatusBarContext } from '../context/StatusBarContext';

export default function StatusBar() {
  const {
    projectsLabel,
    statusMessage,
    masterConnectionHealthClass,
    masterConnectionLabel,
    selectedProjectStatusLabel,
    portRangeStatusLabel,
  } = useStatusBarContext();
  return (
    <footer className="statusBar">
      <span className="statusItem">{projectsLabel}</span>
      <span className={`statusItem ${statusMessage.startsWith('Error: ') ? 'error' : ''}`}>{statusMessage}</span>
      <span className="statusRightGroup">
        <span className="statusItem statusMasterLink">
          <span className={`runtimeHealthDot ${masterConnectionHealthClass}`} />
          <span>{masterConnectionLabel}</span>
        </span>
        <span className="statusItem selectedProjectStatus">{selectedProjectStatusLabel}</span>
        <span className="statusItem portRangeStatus">
          Port range: {portRangeStatusLabel}
        </span>
      </span>
    </footer>
  );
}
