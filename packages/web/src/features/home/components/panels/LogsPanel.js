import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InfiniteLogStream from '../../../../components/InfiniteLogStream';
import useTagColumnWidth from '../../../../components/useTagColumnWidth';
import { useLogsPanelContext } from '../../context/LogsPanelContext';
import {
  LOG_LEVEL_COLOR_MAP,
  LOG_LEVEL_LABEL_MAP,
} from '../../lib/logTransforms';

const DEFAULT_COLUMN_WIDTHS = Object.freeze({
  level: 30,
  time: 88,
  host: 116,
  package: 110,
});

const MIN_COLUMN_WIDTHS = Object.freeze({
  level: 24,
  time: 72,
  host: 84,
  package: 80,
});

export default function LogsPanel() {
  const {
    logLevelOptions,
    isLogLevelDisabled,
    toggleLogLevel,
    isProcessLogContext,
    isProjectLogContext,
    logServiceOptions,
    selectedLogServices,
    selectedProcessLogTarget,
    logServiceColorMap,
    toggleLogService,
    displayedLogs,
    followLogs,
    onResumeLogFollow,
    isHostLogContext,
    selectedHost,
    isMasterLogContext,
    isRuntimeLogContext,
    selectedProject,
    logsLoading,
    logStreamRef,
    effectiveLogStreams,
    onLogStreamScroll,
    requestLogWindowOverWebsocket,
    renderLineTags,
  } = useLogsPanelContext();
  const [columnWidths, setColumnWidths] = useState(DEFAULT_COLUMN_WIDTHS);
  const [manualColumnWidths, setManualColumnWidths] = useState({});
  const [activeResizeKey, setActiveResizeKey] = useState(null);
  const resizeSessionRef = useRef(null);
  const logViewerRef = useRef(null);

  const hostTagValues = useMemo(() => [
    'Host',
    ...displayedLogs
      .map((entry) => String(entry?.hostName || entry?.hostIp || '').trim())
      .filter(Boolean),
  ], [displayedLogs]);
  const packageTagValues = useMemo(() => [
    'Package',
    ...displayedLogs
      .map((entry) => String(entry?.serviceName || '').trim())
      .filter(Boolean),
  ], [displayedLogs]);
  const autoHostWidth = useTagColumnWidth({
    values: hostTagValues,
    minWidth: MIN_COLUMN_WIDTHS.host,
    maxWidth: 180,
    fallbackWidth: DEFAULT_COLUMN_WIDTHS.host,
    containerRef: logViewerRef,
    maxFraction: 0.18,
  });
  const autoPackageWidth = useTagColumnWidth({
    values: packageTagValues,
    minWidth: MIN_COLUMN_WIDTHS.package,
    maxWidth: 190,
    fallbackWidth: DEFAULT_COLUMN_WIDTHS.package,
    containerRef: logViewerRef,
    maxFraction: 0.2,
  });

  const beginResizeColumn = useCallback((event, columnKey) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_COLUMN_WIDTHS, columnKey)) {
      return;
    }
    event.preventDefault();
    resizeSessionRef.current = {
      key: columnKey,
      startX: Number(event.clientX) || 0,
      startWidth: Number(columnWidths?.[columnKey]) || DEFAULT_COLUMN_WIDTHS[columnKey],
    };
    setManualColumnWidths((previous) => (
      previous?.[columnKey]
        ? previous
        : { ...previous, [columnKey]: true }
    ));
    setActiveResizeKey(columnKey);
  }, [columnWidths]);

  useEffect(() => {
    if (!activeResizeKey) {
      return undefined;
    }

    const onPointerMove = (event) => {
      const session = resizeSessionRef.current;
      if (!session || session.key !== activeResizeKey) {
        return;
      }
      const deltaX = (Number(event.clientX) || 0) - session.startX;
      const minWidth = MIN_COLUMN_WIDTHS[activeResizeKey] || 24;
      const nextWidth = Math.max(minWidth, Math.round(session.startWidth + deltaX));
      setColumnWidths((previous) => {
        const current = Number(previous?.[activeResizeKey]) || 0;
        if (current === nextWidth) {
          return previous;
        }
        return {
          ...previous,
          [activeResizeKey]: nextWidth,
        };
      });
    };

    const onPointerUp = () => {
      setActiveResizeKey(null);
      resizeSessionRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [activeResizeKey]);

  useEffect(() => {
    setColumnWidths((previous) => {
      let next = previous;

      if (!manualColumnWidths.host && previous.host !== autoHostWidth) {
        next = next === previous ? { ...previous } : next;
        next.host = autoHostWidth;
      }

      if (!manualColumnWidths.package && previous.package !== autoPackageWidth) {
        next = next === previous ? { ...previous } : next;
        next.package = autoPackageWidth;
      }

      return next;
    });
  }, [autoHostWidth, autoPackageWidth, manualColumnWidths.host, manualColumnWidths.package]);

  const logColumnStyle = useMemo(() => ({
    '--log-col-level-width': `${Math.max(MIN_COLUMN_WIDTHS.level, Number(columnWidths?.level) || 0)}px`,
    '--log-col-time-width': `${Math.max(MIN_COLUMN_WIDTHS.time, Number(columnWidths?.time) || 0)}px`,
    '--log-col-machine-width': `${Math.max(MIN_COLUMN_WIDTHS.host, Number(columnWidths?.host) || 0)}px`,
    '--log-col-package-width': `${Math.max(MIN_COLUMN_WIDTHS.package, Number(columnWidths?.package) || 0)}px`,
  }), [columnWidths]);

  const renderResizeHandle = (columnKey, label) => (
    <button
      type="button"
      className={`logColumnResizeHandle ${activeResizeKey === columnKey ? 'active' : ''}`}
      data-testid={`log-column-resize-${columnKey}`}
      aria-label={`Resize ${label} column`}
      onPointerDown={(event) => beginResizeColumn(event, columnKey)}
    />
  );

  return (
    <div className="logPanel" data-testid="log-panel">
      <div className="logFilters">
        {logLevelOptions.map((level) => {
          const disabled = isLogLevelDisabled(level);
          const levelColor = LOG_LEVEL_COLOR_MAP[level] || 'var(--accent)';
          const buttonStyle = disabled
            ? {
              borderColor: levelColor,
              color: levelColor,
              backgroundColor: 'var(--chip)',
              opacity: 0.7,
            }
            : {
              borderColor: levelColor,
              color: levelColor,
              backgroundColor: 'color-mix(in srgb, var(--card) 88%, transparent)',
            };
          return (
            <button
              key={level}
              type="button"
              className={`logFilterBtn ${disabled ? '' : 'active'} ${level}`}
              style={buttonStyle}
              onClick={() => toggleLogLevel(level)}
            >
              {LOG_LEVEL_LABEL_MAP[level] || level}
            </button>
          );
        })}
      </div>
      {isProjectLogContext ? (
        <div className="logFilters">
          {logServiceOptions.map((serviceName) => {
            const disabled = selectedLogServices.includes(serviceName);
            const serviceColor = logServiceColorMap[serviceName] || 'var(--accent)';
            const buttonStyle = disabled
              ? {
                borderColor: serviceColor,
                color: serviceColor,
                backgroundColor: 'var(--chip)',
                opacity: 0.72,
              }
              : {
                borderColor: serviceColor,
                color: serviceColor,
                backgroundColor: 'color-mix(in srgb, var(--card) 88%, transparent)',
              };
            return (
              <button
                key={serviceName}
                type="button"
                className={`logFilterBtn ${disabled ? '' : 'active'}`}
                style={buttonStyle}
                onClick={() => toggleLogService(serviceName)}
              >
                {serviceName}
              </button>
            );
          })}
        </div>
      ) : null}
      {displayedLogs.length > 0 && !followLogs ? (
        <button
          type="button"
          className="logFollowBtn"
          data-testid="scroll-to-bottom"
          onClick={onResumeLogFollow}
        >
          Scroll to bottom
        </button>
      ) : null}
      {isProcessLogContext && selectedProcessLogTarget ? (
        <div className="runtimeInlineMeta">
          Managed process log:
          {' '}
          {String(
            selectedProcessLogTarget?.packageKey
            || selectedProcessLogTarget?.processKey
            || selectedProcessLogTarget?.runId
            || '-',
          ).trim() || '-'}
        </div>
      ) : null}
      {isProjectLogContext && !selectedProject && displayedLogs.length === 0 ? (
        <p className="emptyState">No project selected.</p>
      ) : null}
      {isProcessLogContext && !selectedHost && displayedLogs.length === 0 ? (
        <p className="emptyState">No host selected for managed process logs.</p>
      ) : null}
      {isProcessLogContext && selectedHost && logsLoading && displayedLogs.length === 0 ? (
        <p className="emptyState">Loading managed process logs...</p>
      ) : null}
      {isProcessLogContext && selectedHost && !logsLoading && displayedLogs.length === 0 ? (
        <p className="emptyState">No managed process log output yet.</p>
      ) : null}
      {isHostLogContext && !selectedHost && displayedLogs.length === 0 ? (
        <p className="emptyState">No host selected.</p>
      ) : null}
      {isMasterLogContext && displayedLogs.length === 0 ? (
        <p className="emptyState">No master agent logs yet.</p>
      ) : null}
      {isRuntimeLogContext && displayedLogs.length === 0 ? (
        <p className="emptyState">No runtime logs yet.</p>
      ) : null}
      {isHostLogContext && selectedHost && displayedLogs.length === 0 ? (
        <p className="emptyState">No logs for selected host yet.</p>
      ) : null}
      {isProjectLogContext && selectedProject && logsLoading && displayedLogs.length === 0 ? (
        <p className="emptyState">Loading logs...</p>
      ) : null}
      {isProjectLogContext && selectedProject && !logsLoading && displayedLogs.length === 0 ? (
        <p className="emptyState">No log output yet.</p>
      ) : null}
      {displayedLogs.length > 0 ? (
        <div
          ref={logViewerRef}
          className="logViewer"
          style={logColumnStyle}
          data-testid="log-viewer"
        >
          <div className="logColumnHeaderRow" role="presentation">
            <span className="logColumnHeaderCell level" title="Log level">
              {renderResizeHandle('level', 'level')}
            </span>
            <span className="logColumnHeaderCell time" title="Timestamp">
              Time
              {renderResizeHandle('time', 'time')}
            </span>
            <span className="logColumnHeaderCell host" title="Host">
              Host
              {renderResizeHandle('host', 'host')}
            </span>
            <span className="logColumnHeaderCell package" title="Package">
              Package
              {renderResizeHandle('package', 'package')}
            </span>
            <span className="logColumnHeaderCell icon" title="Icon">
              Icon
            </span>
            <span className="logColumnHeaderCell message" title="Message">
              Message
            </span>
          </div>
          <InfiniteLogStream
            ref={logStreamRef}
            className="logViewerStream"
            streams={effectiveLogStreams}
            lineHeight={22}
            overscanAbove={140}
            overscanBelow={220}
            onScroll={onLogStreamScroll}
            onWindowRequest={requestLogWindowOverWebsocket}
            renderLineText={(line) => String(line?.__lineText || line?.message || '')}
            renderLineTags={renderLineTags}
          />
        </div>
      ) : null}
    </div>
  );
}
