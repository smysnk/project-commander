const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const os = require('os');

const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const MAX_SESSION_OUTPUT_ENTRIES = 2000;
const DEFAULT_REMOTE_SHELL_USER = String(
  process.env.PC_SLAVE_SHELL_USER || process.env.PC_SLAVE_SERVICE_USER || 'pc-slave',
).trim() || 'pc-slave';

const toIsoTimestamp = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Date().toISOString();
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
};

const resolveLocalUser = () => {
  try {
    const info = os.userInfo();
    const candidate = String(info?.username || '').trim();
    if (candidate) {
      return candidate;
    }
  } catch {
    // fallback below
  }
  const fallback = String(process.env.USER || process.env.LOGNAME || '').trim();
  return fallback || null;
};

const normalizeShellUser = (input) => {
  const normalized = String(input || '').trim();
  if (!normalized) {
    return null;
  }
  if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(normalized)) {
    return null;
  }
  return normalized;
};

const createTerminalSessionManager = ({ emitEvent } = {}) => {
  const sessionsById = new Map();
  const sessionIdByHostId = new Map();

  const emitSessionEvent = (session, payload = {}) => {
    if (!session || typeof emitEvent !== 'function') {
      return;
    }
    emitEvent({
      topic: 'terminal.session',
      source: 'node-backend',
      entityId: `terminal:${session.sessionId}`,
      payload: {
        sessionId: session.sessionId,
        hostId: session.hostId,
        hostName: session.hostName,
        hostIp: session.hostIp,
        status: session.status,
        startedAt: session.startedAt,
        closedAt: session.closedAt || null,
        exitCode: Number.isInteger(session.exitCode) ? session.exitCode : null,
        ...payload,
      },
    });
  };

  const snapshotOutput = (entry) => ({
    timestamp: toIsoTimestamp(entry?.timestamp),
    stream: String(entry?.stream || 'stdout').trim().toLowerCase() || 'stdout',
    text: String(entry?.text || ''),
  });

  const snapshotSession = (session) => {
    if (!session) {
      return null;
    }
    return {
      sessionId: session.sessionId,
      hostId: session.hostId,
      hostName: session.hostName,
      hostIp: session.hostIp,
      status: session.status,
      startedAt: session.startedAt,
      closedAt: session.closedAt || null,
      exitCode: Number.isInteger(session.exitCode) ? session.exitCode : null,
      output: Array.isArray(session.output) ? session.output.map(snapshotOutput) : [],
    };
  };

  const appendOutput = (session, { stream = 'stdout', text } = {}) => {
    if (!session) {
      return;
    }
    const normalizedText = String(text || '');
    if (!normalizedText) {
      return;
    }

    const outputEntry = {
      timestamp: new Date().toISOString(),
      stream: String(stream || 'stdout').trim().toLowerCase() || 'stdout',
      text: normalizedText,
    };
    session.output.push(outputEntry);
    if (session.output.length > MAX_SESSION_OUTPUT_ENTRIES) {
      session.output.splice(0, session.output.length - MAX_SESSION_OUTPUT_ENTRIES);
    }

    emitSessionEvent(session, {
      action: 'output',
      entry: snapshotOutput(outputEntry),
    });
  };

  const closeSession = (session, { code = null, signal = null, reason = null } = {}) => {
    if (!session || session.status === 'closed') {
      return;
    }

    session.status = 'closed';
    session.closedAt = new Date().toISOString();
    session.exitCode = Number.isInteger(Number(code)) ? Number(code) : null;
    session.signal = signal ? String(signal) : null;

    emitSessionEvent(session, {
      action: 'closed',
      reason: reason ? String(reason) : null,
      signal: session.signal,
    });
  };

  const startSession = ({
    hostId,
    hostName,
    hostIp,
  }) => {
    const normalizedHostId = Number(hostId);
    if (!Number.isInteger(normalizedHostId) || normalizedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }
    const normalizedHostIp = String(hostIp || '').trim();
    if (!normalizedHostIp) {
      throw new Error('hostIp is required');
    }

    const existingSessionId = sessionIdByHostId.get(normalizedHostId);
    if (existingSessionId) {
      const existingSession = sessionsById.get(existingSessionId);
      if (existingSession && existingSession.status === 'active') {
        return snapshotSession(existingSession);
      }
    }

    const localUser = resolveLocalUser();
    if (!localUser) {
      throw new Error(`Unable to determine the current local user for terminal session on ${normalizedHostIp}`);
    }

    const shellUser = normalizeShellUser(DEFAULT_REMOTE_SHELL_USER);
    if (!shellUser) {
      throw new Error(`Invalid remote shell user configured: ${DEFAULT_REMOTE_SHELL_USER}`);
    }

    const sshTarget = `${localUser}@${normalizedHostIp}`;
    const remoteCommand = [
      'if command -v sudo >/dev/null 2>&1; then',
      `  sudo -n -u ${shellUser} -H bash -il;`,
      'elif command -v runuser >/dev/null 2>&1; then',
      `  runuser -u ${shellUser} -- bash -il;`,
      'else',
      `  su -s /bin/bash - ${shellUser};`,
      'fi',
    ].join(' ');

    const sshArgs = [
      '-tt',
      '-o',
      'BatchMode=yes',
      '-o',
      `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
      sshTarget,
      remoteCommand,
    ];

    const session = {
      sessionId: `term-${Date.now()}-${randomUUID().slice(0, 8)}`,
      hostId: normalizedHostId,
      hostName: String(hostName || normalizedHostIp).trim() || normalizedHostIp,
      hostIp: normalizedHostIp,
      status: 'active',
      startedAt: new Date().toISOString(),
      closedAt: null,
      exitCode: null,
      signal: null,
      output: [],
      child: null,
    };

    const child = spawn('ssh', sshArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.child = child;
    sessionsById.set(session.sessionId, session);
    sessionIdByHostId.set(session.hostId, session.sessionId);

    child.stdin?.setDefaultEncoding('utf8');
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk) => {
      appendOutput(session, {
        stream: 'stdout',
        text: String(chunk || ''),
      });
    });
    child.stderr?.on('data', (chunk) => {
      appendOutput(session, {
        stream: 'stderr',
        text: String(chunk || ''),
      });
    });

    child.on('error', (error) => {
      appendOutput(session, {
        stream: 'stderr',
        text: `[terminal][error] ${error?.message || error}`,
      });
      closeSession(session, {
        reason: error?.message || String(error),
      });
    });

    child.on('close', (code, signal) => {
      const reason = Number.isInteger(Number(code))
        ? `Shell exited with code ${Number(code)}.`
        : 'Shell session ended.';
      closeSession(session, {
        code,
        signal,
        reason,
      });
    });

    emitSessionEvent(session, {
      action: 'started',
      output: [],
    });

    return snapshotSession(session);
  };

  const sendInput = ({
    sessionId,
    input,
  }) => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('sessionId is required');
    }

    const session = sessionsById.get(normalizedSessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${normalizedSessionId}`);
    }
    if (session.status !== 'active') {
      throw new Error('Terminal session is closed');
    }

    const child = session.child;
    if (!child || child.killed || !child.stdin || child.stdin.destroyed) {
      throw new Error('Terminal session is not writable');
    }

    const rawInput = String(input || '');
    const normalizedInput = rawInput.endsWith('\n') ? rawInput : `${rawInput}\n`;
    child.stdin.write(normalizedInput);
    return true;
  };

  const closeSessionById = ({ sessionId }) => {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      throw new Error('sessionId is required');
    }
    const session = sessionsById.get(normalizedSessionId);
    if (!session) {
      return false;
    }
    if (session.status !== 'active') {
      return true;
    }

    const child = session.child;
    if (child?.stdin && !child.stdin.destroyed) {
      child.stdin.write('exit\n');
    }
    setTimeout(() => {
      if (session.status === 'active' && child && !child.killed) {
        child.kill('SIGTERM');
      }
    }, 1200).unref?.();
    return true;
  };

  const getSessionForHost = ({ hostId }) => {
    const normalizedHostId = Number(hostId);
    if (!Number.isInteger(normalizedHostId) || normalizedHostId <= 0) {
      throw new Error('hostId must be a positive integer');
    }
    const sessionId = sessionIdByHostId.get(normalizedHostId);
    if (!sessionId) {
      return null;
    }
    const session = sessionsById.get(sessionId);
    return snapshotSession(session);
  };

  return {
    startSession,
    sendInput,
    closeSession: closeSessionById,
    getSessionForHost,
  };
};

module.exports = {
  createTerminalSessionManager,
};
