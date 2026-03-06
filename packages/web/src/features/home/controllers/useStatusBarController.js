import { useMemo } from 'react';

export default function useStatusBarController({
  loading,
  projectsCount,
  runningCount,
  error,
  scannedAt,
  masterConnectionHealthClass,
  masterConnectionLabel,
  selectedProject,
}) {
  return useMemo(() => {
    const projectsLabel = loading ? 'Scanning projects...' : `Projects: ${projectsCount}`;
    const statusMessage = error
      ? `Error: ${error}`
      : scannedAt
        ? `Last scan: ${new Date(scannedAt).toLocaleString()}`
        : 'Ready';
    const selectedProjectStatusLabel = selectedProject
      ? `${selectedProject.name} (${selectedProject.runtimeStatus || 'stopped'})${selectedProject.runtimePid ? ` · pid ${selectedProject.runtimePid}` : ''}`
      : 'No project selected';
    const portRangeStatusLabel = (
      Number.isInteger(selectedProject?.runtimePortRangeBegin) &&
      Number.isInteger(selectedProject?.runtimePortRangeEnd)
    )
      ? `${selectedProject.runtimePortRangeBegin}-${selectedProject.runtimePortRangeEnd}`
      : 'None';

    return {
      loading,
      projectsCount,
      runningCount,
      projectsLabel,
      error,
      scannedAt,
      statusMessage,
      masterConnectionHealthClass,
      masterConnectionLabel,
      selectedProject,
      selectedProjectStatusLabel,
      portRangeStatusLabel,
    };
  }, [
    error,
    loading,
    masterConnectionHealthClass,
    masterConnectionLabel,
    projectsCount,
    runningCount,
    scannedAt,
    selectedProject,
  ]);
}
