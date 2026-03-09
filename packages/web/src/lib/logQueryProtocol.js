const MAX_QUERY_LIMIT = 1200;

const sanitizeQueryRequestStream = (stream) => {
  const streamId = String(stream?.streamId || '').trim();
  const offset = Number.parseInt(stream?.offset, 10) || 0;
  const limit = Math.max(0, Math.min(MAX_QUERY_LIMIT, Number.parseInt(stream?.limit, 10) || 0));
  if (!streamId || limit <= 0) {
    return null;
  }
  return {
    streamId,
    offset,
    limit,
  };
};

const buildLogsQueryMessage = ({
  requestId,
  context = {},
  streams = [],
} = {}) => {
  const normalizedRequestId = String(requestId || '').trim();
  if (!normalizedRequestId) {
    throw new Error('requestId is required for logs.query');
  }
  const normalizedStreams = (Array.isArray(streams) ? streams : [])
    .map((stream) => sanitizeQueryRequestStream(stream))
    .filter(Boolean);
  if (normalizedStreams.length === 0) {
    return null;
  }
  const rawHostId = context?.hostId;
  const parsedHostId = rawHostId === null || rawHostId === undefined || rawHostId === ''
    ? null
    : Number.parseInt(rawHostId, 10);
  return {
    action: 'logs.query',
    requestId: normalizedRequestId,
    context: {
      scope: String(context?.scope || 'runtime').trim().toLowerCase() || 'runtime',
      contextKey: String(context?.contextKey || '').trim() || null,
      projectPath: context?.projectPath ? String(context.projectPath) : null,
      hostId: Number.isInteger(parsedHostId) ? parsedHostId : null,
      hostName: context?.hostName ? String(context.hostName) : null,
      hostIp: context?.hostIp ? String(context.hostIp) : null,
      hostAgentUuid: context?.hostAgentUuid
        ? String(context.hostAgentUuid).trim() || null
        : null,
      runId: context?.runId ? String(context.runId).trim() || null : null,
      processKey: context?.processKey ? String(context.processKey).trim() || null : null,
      packageKey: context?.packageKey ? String(context.packageKey).trim() || null : null,
      logPath: context?.logPath ? String(context.logPath).trim() || null : null,
    },
    streams: normalizedStreams,
  };
};

const normalizeLogsQueryResult = (payload) => {
  if (!payload || payload.kind !== 'logs.query.result') {
    return null;
  }
  const requestId = String(payload.requestId || '').trim();
  if (!requestId) {
    return null;
  }
  return {
    kind: 'logs.query.result',
    requestId,
    contextKey: payload?.contextKey ? String(payload.contextKey) : null,
    scope: String(payload?.scope || 'runtime').trim().toLowerCase() || 'runtime',
    streams: (Array.isArray(payload?.streams) ? payload.streams : [])
      .map((stream) => ({
        streamId: String(stream?.streamId || '').trim(),
        totalLines: Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0),
        offset: Math.max(0, Number.parseInt(stream?.offset, 10) || 0),
        lines: Array.isArray(stream?.lines) ? stream.lines : [],
      }))
      .filter((stream) => stream.streamId.length > 0),
  };
};

module.exports = {
  MAX_QUERY_LIMIT,
  sanitizeQueryRequestStream,
  buildLogsQueryMessage,
  normalizeLogsQueryResult,
};
