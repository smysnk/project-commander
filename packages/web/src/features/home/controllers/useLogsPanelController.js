import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  appendHomeOverlayLog,
  requestHomeRealtimeLogWindow,
  setPanelProjectExplorerFollowMode,
  setUiActiveLogContextKey,
  setUiDisabledLogLevels,
  setUiSelectedLogServices,
} from '../../../store';
import { LEFT_PANEL_MODE } from '../constants/ui';
import { formatClientLogArgs, toIsoTimestamp } from '../lib/homeUtils';
import {
  buildLogStreams,
  buildLogsContextDescriptor,
  extractHueFromColor,
  formatLogText,
  getServiceColorMap,
  LOG_LEVEL_ORDER,
  MASTER_LOG_SOURCES,
  normalizeLogLevelName,
  resolveLogLevelForEntry,
  RUNTIME_LOG_SOURCES,
  sortLogEntries,
  toOverlaySource,
} from '../lib/logTransforms';
import {
  LOG_VIEWER_TAIL_INITIAL_LINES,
  LOG_VIEWER_TOP_EDGE_PX,
  buildTailWindowStreamRequest,
  getNextTailLineCount,
  normalizeTailLineCount,
} from '../lib/logViewer';

const MASTER_CONTEXT_LOG_SOURCES = new Set([
  'node-backend',
  ...MASTER_LOG_SOURCES,
]);

const CLIENT_LOG_IGNORE_PATTERNS = [
  /selector\s+select\w+\s+returned a different result when called with the same parameters/i,
  /maximum update depth exceeded/i,
  /hydration failed because the server rendered html didn't match the client/i,
  /cannot update a component while rendering a different component/i,
];

const shouldIgnoreClientConsoleMessage = (message) => {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return true;
  }
  return CLIENT_LOG_IGNORE_PATTERNS.some((pattern) => pattern.test(normalized));
};

export default function useLogsPanelController({
  dispatch,
  leftPanelMode,
  rightTab,
  followLogs,
  selectedProjectPath,
  projectLogs,
  overlayLogs,
  logsQueryEntriesByContext,
  logsLoading,
  selectedProject,
  selectedHost,
  isMasterSidebarSelected,
  selectedLogServices,
  disabledLogLevels,
  seenLogServicesByProject,
  setSeenLogServicesByProject,
  loadProjectLogs,
  setProjectLogs,
  setProjectEnvironment,
  setProjectPortRangeSettings,
  setManualPortRangeInput,
  setProjectProcessStats,
  normalizePortRangeSettings,
  logStreamRef,
  projectLogsRef,
  isProgrammaticLogScrollRef,
  overlayLogSeedRef,
  scrollLogsToEnd,
  editorTheme,
  selectedProjectServiceKeys,
  buildUniqueIconsForServices,
  toCanonicalServiceIconKey,
  renderLogTagRow,
}) {
  const isProjectLogContext = leftPanelMode === LEFT_PANEL_MODE.PROJECTS;
  const isMasterLogContext = leftPanelMode !== LEFT_PANEL_MODE.PROJECTS && isMasterSidebarSelected;
  const isHostLogContext = (
    leftPanelMode !== LEFT_PANEL_MODE.PROJECTS
    && !isMasterLogContext
    && selectedHost != null
  );
  const isRuntimeLogContext = (
    leftPanelMode !== LEFT_PANEL_MODE.PROJECTS
    && !isMasterLogContext
    && !isHostLogContext
  );
  const lastClientConsoleMessageRef = useRef({
    signature: '',
    timestamp: 0,
  });
  const requestedTailSizeByContextRef = useRef(new Map());
  const isTailRequestInFlightByContextRef = useRef(new Map());

  const appendOverlayLog = useCallback((entry) => {
    const message = String(entry?.message || '').trimEnd();
    if (!message) {
      return;
    }

    const nextEntry = {
      id: `overlay-${overlayLogSeedRef.current}`,
      projectPath: '@overlay',
      timestamp: toIsoTimestamp(entry?.timestamp),
      serviceName: String(entry?.serviceName || 'system').trim() || 'system',
      level: normalizeLogLevelName(entry?.level),
      source: toOverlaySource(entry) || 'system',
      hostId: Number.isInteger(Number(entry?.hostId)) ? Number(entry.hostId) : null,
      hostName: String(entry?.hostName || '').trim() || null,
      hostIp: String(entry?.hostIp || '').trim() || null,
      stream: (() => {
        const normalized = String(entry?.stream || 'system').trim().toLowerCase();
        if (normalized === 'stdout' || normalized === 'stderr' || normalized === 'system') {
          return normalized;
        }
        return 'system';
      })(),
      message,
    };
    overlayLogSeedRef.current += 1;
    dispatch(appendHomeOverlayLog(nextEntry));
  }, [dispatch, overlayLogSeedRef]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const bindMethod = (methodName, stream) => (...args) => {
      originalConsole[methodName](...args);
      const formatted = formatClientLogArgs(args);
      if (shouldIgnoreClientConsoleMessage(formatted)) {
        return;
      }

      const signature = `${methodName}:${formatted}`;
      const now = Date.now();
      const previous = lastClientConsoleMessageRef.current;
      if (previous.signature === signature && (now - previous.timestamp) < 1200) {
        return;
      }
      lastClientConsoleMessageRef.current = {
        signature,
        timestamp: now,
      };

      // Schedule out of the render call stack to avoid recursive render-time dispatches.
      window.setTimeout(() => {
        appendOverlayLog({
          timestamp: new Date().toISOString(),
          serviceName: 'nextjs-client',
          source: 'nextjs-client',
          stream,
          message: formatted,
        });
      }, 0);
    };

    console.log = bindMethod('log', 'stdout');
    console.info = bindMethod('info', 'stdout');
    console.warn = bindMethod('warn', 'stderr');
    console.error = bindMethod('error', 'stderr');

    return () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    };
  }, [appendOverlayLog]);

  useEffect(() => {
    if (rightTab !== 'logs' || !followLogs) {
      return;
    }
    scrollLogsToEnd('auto');
  }, [followLogs, overlayLogs, projectLogs, rightTab, scrollLogsToEnd]);

  useEffect(() => {
    projectLogsRef.current = projectLogs;
  }, [projectLogs, projectLogsRef]);

  useEffect(() => {
    if (!selectedProjectPath || projectLogs.length === 0) {
      return;
    }

    const discoveredNames = projectLogs
      .map((entry) => String(entry?.serviceName || '').trim())
      .filter(Boolean);
    if (discoveredNames.length === 0) {
      return;
    }

    const previousMap = seenLogServicesByProject && typeof seenLogServicesByProject === 'object'
      ? seenLogServicesByProject
      : {};
    const previous = Array.isArray(previousMap[selectedProjectPath]) ? previousMap[selectedProjectPath] : [];
    const next = Array.from(new Set([...previous, ...discoveredNames]));
    if (next.length === previous.length && next.every((value, index) => value === previous[index])) {
      return;
    }
    setSeenLogServicesByProject({
      ...previousMap,
      [selectedProjectPath]: next,
    });
  }, [
    projectLogs,
    selectedProjectPath,
    seenLogServicesByProject,
    setSeenLogServicesByProject,
  ]);

  const projectLogServiceOptions = useMemo(() => {
    if (!selectedProjectPath) {
      return [];
    }
    return (seenLogServicesByProject[selectedProjectPath] || [])
      .map((serviceName) => String(serviceName || '').trim())
      .filter(Boolean);
  }, [seenLogServicesByProject, selectedProjectPath]);

  const logContextDescriptor = useMemo(() => (
    buildLogsContextDescriptor({
      isProjectLogContext,
      selectedProjectPath,
      isHostLogContext,
      selectedHost,
    })
  ), [isHostLogContext, isProjectLogContext, selectedHost, selectedProjectPath]);

  const activeLogContextKey = String(logContextDescriptor?.contextKey || 'runtime').trim() || 'runtime';
  const queryContextEntry = useMemo(() => {
    const byContext = logsQueryEntriesByContext && typeof logsQueryEntriesByContext === 'object'
      ? logsQueryEntriesByContext
      : {};
    const entry = byContext[activeLogContextKey];
    return entry && typeof entry === 'object' ? entry : null;
  }, [activeLogContextKey, logsQueryEntriesByContext]);
  const queryEntriesForActiveContext = useMemo(() => {
    if (!queryContextEntry || typeof queryContextEntry !== 'object') {
      return [];
    }
    const entries = queryContextEntry.entries;
    return Array.isArray(entries) ? entries : [];
  }, [queryContextEntry]);
  const queryStreamsForActiveContext = useMemo(() => {
    if (!queryContextEntry || typeof queryContextEntry !== 'object') {
      return [];
    }
    const streams = Array.isArray(queryContextEntry?.streams) ? queryContextEntry.streams : [];
    return streams
      .map((stream, streamIndex) => {
        const streamId = String(stream?.streamId || `stream-${streamIndex}`).trim();
        if (!streamId) {
          return null;
        }
        const totalLines = Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0);
        const offset = Math.max(0, Number.parseInt(stream?.offset, 10) || 0);
        const lines = (Array.isArray(stream?.lines) ? stream.lines : []).map((line, lineIndex) => {
          const fallbackLineId = `${activeLogContextKey}:${streamId}:${offset + lineIndex}`;
          const lineId = String(line?.id || fallbackLineId).trim() || fallbackLineId;
          return {
            ...line,
            id: lineId,
            __lineId: lineId,
            __lineText: String(line?.__lineText || formatLogText(line)),
          };
        });
        return {
          streamId,
          totalLines,
          offset,
          lines,
        };
      })
      .filter(Boolean);
  }, [activeLogContextKey, queryContextEntry]);
  const shouldUseTailViewerQuery = rightTab === 'logs' && (isProjectLogContext || isHostLogContext);

  const disabledLogLevelSet = useMemo(
    () => new Set(
      (Array.isArray(disabledLogLevels) ? disabledLogLevels : [])
        .map((level) => normalizeLogLevelName(level))
        .filter(Boolean),
    ),
    [disabledLogLevels],
  );

  const displayedLogs = useMemo(() => {
    let scopedLogs = [];
    const hasQueryBackedContext = isProjectLogContext || isHostLogContext;
    const hasQueryContextEntry = hasQueryBackedContext && Boolean(queryContextEntry);
    const queryBackedEntries = hasQueryBackedContext ? queryEntriesForActiveContext : [];
    if (isProjectLogContext) {
      const disabledServices = new Set(
        (Array.isArray(selectedLogServices) ? selectedLogServices : [])
          .map((serviceName) => String(serviceName || '').trim())
          .filter(Boolean),
      );
      const sourceEntries = hasQueryContextEntry ? queryBackedEntries : projectLogs;
      scopedLogs = sourceEntries.filter((entry) => {
        const logProjectPath = String(entry?.projectPath || '').trim();
        if (selectedProjectPath && logProjectPath && logProjectPath !== selectedProjectPath) {
          return false;
        }
        const serviceName = String(entry?.serviceName || '').trim();
        return !disabledServices.has(serviceName);
      });
    } else if (isRuntimeLogContext) {
      scopedLogs = overlayLogs.filter((entry) => (
        RUNTIME_LOG_SOURCES.includes(toOverlaySource(entry))
      ));
    } else if (isMasterLogContext) {
      scopedLogs = overlayLogs.filter((entry) => (
        MASTER_CONTEXT_LOG_SOURCES.has(toOverlaySource(entry))
      ));
    } else if (isHostLogContext) {
      if (!selectedHost) {
        return [];
      }

      if (hasQueryContextEntry) {
        scopedLogs = queryBackedEntries.slice();
        const levelFilteredLogs = scopedLogs.filter((entry) => (
          !disabledLogLevelSet.has(resolveLogLevelForEntry(entry))
        ));
        return sortLogEntries(levelFilteredLogs);
      }

      const selectedHostNumericId = Number(selectedHost.id);
      const selectedHostName = String(selectedHost.name || '').trim().toLowerCase();
      const selectedHostIp = String(selectedHost.ip || '').trim();
      const selectedHostAgentUuid = String(
        selectedHost.agentUuid || selectedHost.slaveId || '',
      ).trim().toLowerCase();
      scopedLogs = overlayLogs.filter((entry) => {
        const entryHostId = Number(entry?.hostId);
        const entrySource = toOverlaySource(entry);
        const entryMessage = String(entry?.message || '').trim().toLowerCase();
        const entryHostName = String(entry?.hostName || '').trim().toLowerCase();
        const entryHostIp = String(entry?.hostIp || '').trim();
        const entryAgentUuid = String(entry?.agentUuid || entry?.slaveId || '').trim().toLowerCase();
        if (
          selectedHostAgentUuid &&
          entryAgentUuid &&
          selectedHostAgentUuid !== entryAgentUuid
        ) {
          return false;
        }
        const matchesSelectedHost = (
          (Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0 &&
            Number.isInteger(entryHostId) && entryHostId === selectedHostNumericId) ||
          (selectedHostName && entryHostName && selectedHostName === entryHostName) ||
          (selectedHostIp && entryHostIp && selectedHostIp === entryHostIp) ||
          (selectedHostAgentUuid && entryAgentUuid && selectedHostAgentUuid === entryAgentUuid)
        );
        if (!matchesSelectedHost) {
          return false;
        }

        if (
          MASTER_LOG_SOURCES.includes(entrySource) ||
          entrySource === 'node-backend' ||
          entrySource === 'nextjs-client'
        ) {
          return false;
        }

        if (selectedHostAgentUuid && entryAgentUuid && selectedHostAgentUuid === entryAgentUuid) {
          return true;
        }

        if (selectedHostName && entrySource === selectedHostName) {
          return true;
        }

        if (selectedHostIp && entrySource === selectedHostIp) {
          return true;
        }

        return (
          entrySource === 'agent-slave' ||
          entrySource === 'slave-agent' ||
          entryMessage.startsWith('[slave]')
        );
      });
    } else {
      scopedLogs = projectLogs.slice();
    }

    const levelFilteredLogs = scopedLogs.filter((entry) => (
      !disabledLogLevelSet.has(resolveLogLevelForEntry(entry))
    ));

    return sortLogEntries(levelFilteredLogs);
  }, [
    disabledLogLevelSet,
    isHostLogContext,
    isMasterLogContext,
    isProjectLogContext,
    isRuntimeLogContext,
    overlayLogs,
    projectLogs,
    queryContextEntry,
    queryEntriesForActiveContext,
    selectedHost,
    selectedLogServices,
    selectedProjectPath,
  ]);

  const logServiceOptions = useMemo(() => {
    if (isProjectLogContext) {
      return projectLogServiceOptions;
    }
    return Array.from(
      new Set(
        displayedLogs
          .map((entry) => String(entry?.serviceName || '').trim())
          .filter(Boolean),
      ),
    );
  }, [displayedLogs, isProjectLogContext, projectLogServiceOptions]);

  const logServiceColorMap = useMemo(() => {
    const visibleServiceNames = displayedLogs
      .map((entry) => String(entry?.serviceName || '').trim())
      .filter(Boolean);
    const seedNames = visibleServiceNames.length > 0
      ? visibleServiceNames
      : logServiceOptions.map((name) => String(name || '').trim()).filter(Boolean);
    const primaryHue = typeof window === 'undefined'
      ? 180
      : extractHueFromColor(
        window.getComputedStyle(document.documentElement).getPropertyValue('--accent'),
      );
    return getServiceColorMap(seedNames, primaryHue);
  }, [displayedLogs, editorTheme, logServiceOptions]);

  const logServiceIconMap = useMemo(() => {
    const canonicalVisibleNames = displayedLogs
      .map((entry) => toCanonicalServiceIconKey(entry?.serviceName))
      .filter(Boolean);
    const canonicalLogOptionNames = logServiceOptions
      .map((serviceName) => toCanonicalServiceIconKey(serviceName))
      .filter(Boolean);
    const seedNames = Array.from(new Set([
      ...selectedProjectServiceKeys,
      ...canonicalLogOptionNames,
      ...canonicalVisibleNames,
    ]));
    return buildUniqueIconsForServices(seedNames);
  }, [
    buildUniqueIconsForServices,
    displayedLogs,
    logServiceOptions,
    selectedProjectServiceKeys,
    toCanonicalServiceIconKey,
  ]);

  useEffect(() => {
    dispatch(setUiActiveLogContextKey(logContextDescriptor.contextKey || 'runtime'));
  }, [dispatch, logContextDescriptor.contextKey]);

  useEffect(() => {
    dispatch(setUiSelectedLogServices([]));
    setProjectLogs([]);
    setProjectEnvironment([]);
    setProjectPortRangeSettings(normalizePortRangeSettings(null));
    setManualPortRangeInput('');
    setProjectProcessStats([]);
    dispatch(setPanelProjectExplorerFollowMode(true));
  }, [
    dispatch,
    normalizePortRangeSettings,
    selectedProjectPath,
    setManualPortRangeInput,
    setProjectEnvironment,
    setProjectLogs,
    setProjectPortRangeSettings,
    setProjectProcessStats,
  ]);

  useEffect(() => {
    if (leftPanelMode !== LEFT_PANEL_MODE.PROJECTS || !selectedProjectPath) {
      return;
    }
    if (shouldUseTailViewerQuery) {
      return;
    }
    loadProjectLogs({
      projectPath: selectedProjectPath,
      fullRefresh: true,
      serviceNames: null,
    });
  }, [leftPanelMode, loadProjectLogs, selectedProjectPath, shouldUseTailViewerQuery]);

  const localLogStreams = useMemo(() => {
    if (shouldUseTailViewerQuery && queryStreamsForActiveContext.length > 0) {
      return queryStreamsForActiveContext;
    }
    return buildLogStreams(displayedLogs);
  }, [displayedLogs, queryStreamsForActiveContext, shouldUseTailViewerQuery]);

  const toggleLogService = useCallback((serviceName) => {
    const current = Array.isArray(selectedLogServices) ? selectedLogServices : [];
    const next = current.includes(serviceName)
      ? current.filter((name) => name !== serviceName)
      : [...current, serviceName];
    dispatch(setUiSelectedLogServices(next));
  }, [dispatch, selectedLogServices]);

  const toggleLogLevel = useCallback((level) => {
    const normalizedLevel = normalizeLogLevelName(level);
    if (!normalizedLevel) {
      return;
    }
    const next = new Set(
      (Array.isArray(disabledLogLevels) ? disabledLogLevels : [])
        .map((item) => normalizeLogLevelName(item))
        .filter(Boolean),
    );
    if (next.has(normalizedLevel)) {
      next.delete(normalizedLevel);
    } else {
      next.add(normalizedLevel);
    }
    dispatch(setUiDisabledLogLevels(LOG_LEVEL_ORDER.filter((item) => next.has(item))));
  }, [disabledLogLevels, dispatch]);

  const requestLogWindowOverWebsocket = useCallback(({ streams, force = false } = {}) => {
    if (shouldUseTailViewerQuery && !force) {
      return;
    }
    const normalizedStreams = Array.isArray(streams) ? streams : [];
    if (normalizedStreams.length <= 0) {
      return;
    }
    dispatch(requestHomeRealtimeLogWindow({
      context: logContextDescriptor,
      streams: normalizedStreams,
    }));
  }, [dispatch, logContextDescriptor, shouldUseTailViewerQuery]);

  const requestTailLogWindow = useCallback((tailLineCount) => {
    if (!shouldUseTailViewerQuery) {
      return;
    }
    const normalizedTailLineCount = normalizeTailLineCount(tailLineCount);
    requestLogWindowOverWebsocket({
      force: true,
      streams: [buildTailWindowStreamRequest(normalizedTailLineCount)],
    });
  }, [requestLogWindowOverWebsocket, shouldUseTailViewerQuery]);

  const onLogStreamScroll = useCallback(() => {
    if (isProgrammaticLogScrollRef.current) {
      return;
    }
    const container = logStreamRef.current;
    if (!container) {
      return;
    }
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    const atBottom = distanceToBottom <= 16;

    if (atBottom && !followLogs) {
      dispatch(setPanelProjectExplorerFollowMode(true));
      return;
    }
    if (!atBottom && followLogs) {
      dispatch(setPanelProjectExplorerFollowMode(false));
    }

    if (!shouldUseTailViewerQuery) {
      return;
    }

    if (container.scrollTop > LOG_VIEWER_TOP_EDGE_PX) {
      return;
    }

    const contextKey = String(activeLogContextKey || '').trim();
    if (!contextKey) {
      return;
    }
    if (isTailRequestInFlightByContextRef.current.get(contextKey)) {
      return;
    }

    const currentTail = normalizeTailLineCount(
      requestedTailSizeByContextRef.current.get(contextKey) ?? LOG_VIEWER_TAIL_INITIAL_LINES,
    );
    const nextTail = getNextTailLineCount(currentTail);
    if (nextTail <= currentTail) {
      return;
    }
    requestedTailSizeByContextRef.current.set(contextKey, nextTail);
    isTailRequestInFlightByContextRef.current.set(contextKey, true);
    requestTailLogWindow(nextTail);
  }, [
    activeLogContextKey,
    dispatch,
    followLogs,
    isProgrammaticLogScrollRef,
    logStreamRef,
    requestTailLogWindow,
    shouldUseTailViewerQuery,
  ]);

  const onResumeLogFollow = useCallback(() => {
    dispatch(setPanelProjectExplorerFollowMode(true));
    scrollLogsToEnd('smooth');
  }, [dispatch, scrollLogsToEnd]);

  useEffect(() => {
    if (!shouldUseTailViewerQuery) {
      return;
    }
    if (isProjectLogContext && !selectedProjectPath) {
      return;
    }
    if (isHostLogContext && !selectedHost) {
      return;
    }
    const requestedTail = normalizeTailLineCount(
      requestedTailSizeByContextRef.current.get(activeLogContextKey) ?? LOG_VIEWER_TAIL_INITIAL_LINES,
    );
    requestedTailSizeByContextRef.current.set(activeLogContextKey, requestedTail);
    isTailRequestInFlightByContextRef.current.set(activeLogContextKey, true);
    requestTailLogWindow(requestedTail);
  }, [
    activeLogContextKey,
    isHostLogContext,
    isProjectLogContext,
    requestTailLogWindow,
    selectedHost,
    selectedProjectPath,
    shouldUseTailViewerQuery,
  ]);

  useEffect(() => {
    if (!shouldUseTailViewerQuery) {
      return;
    }
    if (!queryContextEntry || activeLogContextKey !== String(logContextDescriptor?.contextKey || '').trim()) {
      return;
    }
    isTailRequestInFlightByContextRef.current.set(activeLogContextKey, false);
  }, [
    activeLogContextKey,
    logContextDescriptor?.contextKey,
    queryContextEntry?.receivedAt,
    shouldUseTailViewerQuery,
  ]);

  const renderLogLineTags = useCallback((line) => {
    const logLevel = resolveLogLevelForEntry(line);
    return renderLogTagRow(line, {
      serviceTagColor: logServiceColorMap[String(line?.serviceName || '').trim()] || null,
      serviceIcon: logServiceIconMap[toCanonicalServiceIconKey(line?.serviceName)] || null,
      logLevel,
      showHostTag: !isMasterLogContext,
    });
  }, [isMasterLogContext, logServiceColorMap, logServiceIconMap, renderLogTagRow, toCanonicalServiceIconKey]);

  const isLogLevelDisabled = useCallback(
    (level) => disabledLogLevelSet.has(level),
    [disabledLogLevelSet],
  );

  return useMemo(() => ({
    logLevelOptions: LOG_LEVEL_ORDER,
    isLogLevelDisabled,
    toggleLogLevel,
    isProjectLogContext,
    logServiceOptions,
    selectedLogServices,
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
    effectiveLogStreams: localLogStreams,
    onLogStreamScroll,
    requestLogWindowOverWebsocket,
    renderLineTags: renderLogLineTags,
  }), [
    displayedLogs,
    followLogs,
    isHostLogContext,
    isLogLevelDisabled,
    isMasterLogContext,
    isProjectLogContext,
    isRuntimeLogContext,
    localLogStreams,
    logServiceColorMap,
    logServiceOptions,
    logStreamRef,
    logsLoading,
    onLogStreamScroll,
    onResumeLogFollow,
    renderLogLineTags,
    requestLogWindowOverWebsocket,
    selectedHost,
    selectedLogServices,
    selectedProject,
    toggleLogLevel,
    toggleLogService,
  ]);
}
