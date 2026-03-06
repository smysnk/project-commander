import { useTopPanelContext } from '../../context/TopPanelContext';

export default function TopPanel() {
  const {
    selectedProject,
    processStatsLoading,
    projectProcessStats,
  } = useTopPanelContext();
  return (
    <div className="topPanel">
      {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
      {selectedProject && processStatsLoading && projectProcessStats.length === 0 ? (
        <p className="emptyState">Loading process statistics...</p>
      ) : null}
      {selectedProject && !processStatsLoading && projectProcessStats.length === 0 ? (
        <p className="emptyState">No running service processes for this project.</p>
      ) : null}
      {selectedProject && projectProcessStats.length > 0 ? (
        <table className="topTable">
          <thead>
            <tr>
              <th>Service</th>
              <th>PID</th>
              <th>CPU%</th>
              <th>MEM%</th>
              <th>RSS MB</th>
              <th>VSZ MB</th>
              <th>Elapsed</th>
              <th>Command</th>
            </tr>
          </thead>
          <tbody>
            {projectProcessStats.map((stat) => (
              <tr key={`${stat.serviceId}-${stat.pid}`}>
                <td>{stat.serviceName}</td>
                <td>{stat.pid}</td>
                <td>{Number(stat.cpuPercent || 0).toFixed(1)}</td>
                <td>{Number(stat.memoryPercent || 0).toFixed(1)}</td>
                <td>{Number(stat.rssMb || 0).toFixed(1)}</td>
                <td>{Number(stat.virtualMb || 0).toFixed(1)}</td>
                <td>{stat.elapsed || '-'}</td>
                <td className="topCommandCell" title={stat.command || ''}>{stat.command || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
