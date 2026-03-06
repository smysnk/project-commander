import { findServiceIcon } from '../../../lib/serviceIconFinder';
import { useProjectsPaneContext } from '../context/ProjectsPaneContext';

export default function ProjectListPane() {
  const {
    leftWidthPct,
    projects,
    loading,
    selectedProjectPath,
    onSelectProject,
    normalizeServiceKey,
    getDiscoveredServiceKeys,
    buildUniqueIconsForServices,
    SERVICE_ICON_DEFS,
    formatServiceLabel,
    getServiceState,
    getAllServicesState,
    ORDERED_TYPE_ICON_KEYS,
    PROJECT_TYPE_ICONS,
    onToggleServiceRuntime,
    onToggleRuntime,
  } = useProjectsPaneContext();
  return (
    <section className="leftPanel" style={{ width: `${leftWidthPct}%` }}>
      <div className="projectTableWrap">
        {projects.length === 0 && !loading ? (
          <p className="emptyState">No projects matched the current scan settings.</p>
        ) : null}

        {projects.length > 0 ? (
          <table>
            <colgroup>
              <col className="nameCol" />
              <col className="servicesCol" />
              <col className="typesCol" />
            </colgroup>
            <thead>
              <tr>
                <th>Name</th>
                <th className="iconsHeader servicesCol">Packages</th>
                <th className="iconsHeader typesCol">Stack</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const selected = project.path === selectedProjectPath;
                const isAppRunning = project.runtimeStatus === 'started' || project.runtimeStatus === 'starting';
                const runtimeServicePorts = project.runtimeServicePorts || {};
                const runtimeServiceStates = project.runtimeServiceStates || {};
                const runtimeServiceEntryMap = new Map(
                  (project.runtimeServiceEntries || [])
                    .map((entry) => ({
                      key: normalizeServiceKey(entry?.key),
                      entry,
                    }))
                    .filter((item) => item.key)
                    .map((item) => [item.key, item.entry]),
                );
                const discoveredServiceKeys = getDiscoveredServiceKeys(project.services);
                const discoveredServiceIconMap = buildUniqueIconsForServices(discoveredServiceKeys);
                const allServicesState = getAllServicesState(project);
                const allServicesLabel = allServicesState.runtimeState === 'starting'
                  ? 'Starting all services'
                  : allServicesState.runtimeState === 'started'
                    ? 'Stop all services'
                    : 'Start all services';

                return (
                  <tr
                    key={project.path}
                    className={`projectRow ${selected ? 'selected' : ''}`}
                    onClick={() => onSelectProject(project.path)}
                  >
                    <td className={`appNameCell ${isAppRunning ? '' : 'stopped'}`}>{project.name}</td>
                    <td className="iconsCell servicesCol">
                      <div className="serviceIcons">
                        {discoveredServiceKeys.map((serviceKey) => {
                          const guessedIcon = discoveredServiceIconMap[serviceKey] || findServiceIcon(serviceKey);
                          const serviceDef = SERVICE_ICON_DEFS[serviceKey] || {
                            label: formatServiceLabel(serviceKey),
                            icon: guessedIcon,
                            className: 'generic',
                          };
                          const Icon = serviceDef.icon;
                          const runtimeEntry = runtimeServiceEntryMap.get(serviceKey) || null;
                          const runtimePid = Number(runtimeEntry?.pid);
                          const hasAssociatedPid = Number.isInteger(runtimePid) && runtimePid > 0;
                          const port = runtimeEntry?.port || runtimeServicePorts[serviceKey] || null;
                          const rawServiceStatus = String(
                            runtimeEntry?.state || runtimeServiceStates[serviceKey] || 'stopped',
                          ).toLowerCase();
                          const serviceStatus = (
                            (rawServiceStatus === 'started' || rawServiceStatus === 'starting') &&
                            !hasAssociatedPid
                          )
                            ? 'stopped'
                            : rawServiceStatus;
                          const serviceState = getServiceState({ serviceStatus, isEnabled: true });

                          const tooltipBase = port
                            ? `${serviceDef.label}: ${port}`
                            : `${serviceDef.label}: unavailable`;
                          const tooltip = `${tooltipBase} · ${serviceStatus}${hasAssociatedPid ? ` · pid ${runtimePid}` : ''} · click to toggle · shift+click to restart`;
                          const isClickable = true;

                          return (
                            <button
                              type="button"
                              key={`${project.path}-${serviceKey}`}
                              className={`serviceIcon ${serviceDef.className} ${serviceState} ${isClickable ? 'clickable' : ''}`}
                              title={tooltip}
                              aria-label={tooltip}
                              onClick={(event) => {
                                if (!isClickable) {
                                  event.stopPropagation();
                                  return;
                                }
                                onToggleServiceRuntime({
                                  projectPath: project.path,
                                  serviceKey,
                                  event,
                                  restart: event.shiftKey,
                                });
                              }}
                            >
                              <Icon />
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          key={`${project.path}-all-services`}
                          className={`serviceIcon control ${allServicesState.serviceState} ${allServicesState.enabled ? 'clickable' : ''}`}
                          title={allServicesLabel}
                          aria-label={allServicesLabel}
                          onClick={(event) => {
                            if (!allServicesState.enabled) {
                              event.stopPropagation();
                              return;
                            }
                            onToggleRuntime(project, event);
                          }}
                        >
                          {allServicesState.runtimeState === 'starting'
                            ? <span className="controlGlyph">◔</span>
                            : allServicesState.runtimeState === 'started'
                              ? <span className="controlGlyph">■</span>
                              : <span className="controlGlyph">▶</span>}
                        </button>
                      </div>
                    </td>
                    <td className="iconsCell typesCol">
                      <div className="typeIcons">
                        {ORDERED_TYPE_ICON_KEYS.map((iconKey) => {
                          const iconDef = PROJECT_TYPE_ICONS[iconKey];
                          const Icon = iconDef.icon;
                          const active = iconDef.isActive(project.types || []);
                          return (
                            <span
                              className={`typeIcon ${iconDef.className} ${active ? 'active' : 'inactive'}`}
                              title={iconDef.label}
                              aria-label={iconDef.label}
                              key={`${project.path}-${iconKey}`}
                            >
                              <Icon />
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
