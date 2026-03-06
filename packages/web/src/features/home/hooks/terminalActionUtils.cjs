function normalizePositiveHostId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function resolveTerminalSubmitRequest({
  selectedHostId,
  terminalSessionByHostId,
  terminalInputByHostId,
  normalizeSession,
} = {}) {
  const hostId = normalizePositiveHostId(selectedHostId);
  if (!hostId) {
    return {
      ok: false,
      error: 'Select a host before running terminal commands.',
    };
  }

  const normalize = typeof normalizeSession === 'function'
    ? normalizeSession
    : (value) => value;
  const session = normalize(terminalSessionByHostId?.[hostId]);
  if (!session || String(session.status || '').trim().toLowerCase() !== 'active') {
    return {
      ok: false,
      error: 'Terminal session is not active.',
    };
  }

  const sessionId = String(session.sessionId || '').trim();
  if (!sessionId) {
    return {
      ok: false,
      error: 'Terminal session is not active.',
    };
  }

  return {
    ok: true,
    hostId,
    sessionId,
    input: String(terminalInputByHostId?.[hostId] || ''),
  };
}

module.exports = {
  normalizePositiveHostId,
  resolveTerminalSubmitRequest,
};
