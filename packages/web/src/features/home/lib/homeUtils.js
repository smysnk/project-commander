const UNKNOWN_VERSION = '-';

export const toIsoTimestamp = (value) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  const text = String(value || '').trim();
  if (!text) {
    return new Date().toISOString();
  }

  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      const parsedNumeric = new Date(numeric);
      if (Number.isFinite(parsedNumeric.getTime())) {
        return parsedNumeric.toISOString();
      }
    }
    return new Date().toISOString();
  }

  return parsed.toISOString();
};

const normalizeHostHealth = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'healthy' || normalized === 'warning' || normalized === 'critical') {
    return normalized;
  }
  return 'unknown';
};

const normalizeHostStatus = ({ status, online }) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized) {
    return normalized;
  }
  return online ? 'registered' : 'unregistered';
};

const normalizeHostProjectCount = (value, fallbackProjects = []) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  return Array.isArray(fallbackProjects) ? fallbackProjects.length : 0;
};

const normalizeHostProject = (project) => {
  const projectId = Number.parseInt(String(project?.id || '').trim(), 10);
  const name = String(project?.name || '').trim();
  const path = String(project?.path || '').trim();

  return {
    id: Number.isInteger(projectId) && projectId > 0 ? projectId : 0,
    name: name || path || '-',
    path: path || null,
  };
};

export const normalizeHostDirectories = (input) => {
  const source = Array.isArray(input) ? input : [];
  const normalized = [];
  const seen = new Set();

  for (const entry of source) {
    const value = String(entry || '').trim().replace(/\\/g, '/');
    if (!value) {
      continue;
    }
    const cleaned = value === '/' ? value : value.replace(/\/+$/g, '');
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    normalized.push(cleaned);
  }

  return normalized;
};

export const normalizeHostRecord = (host) => {
  const id = Number.parseInt(String(host?.id || '').trim(), 10);
  const ip = String(host?.ip || '').trim();
  const name = String(host?.name || '').trim() || ip || (Number.isInteger(id) && id > 0 ? `host-${id}` : 'host');
  const port = Number(host?.port);
  const online = Boolean(host?.online);
  const rawSource = String(host?.source || '').trim().toLowerCase();
  const source = rawSource === 'manual' ? 'manual' : 'runtime';
  const projects = (Array.isArray(host?.projects) ? host.projects : []).map(normalizeHostProject);
  const targetSocket = String(host?.targetSocket || '').trim() || null;

  return {
    id: Number.isInteger(id) && id > 0 ? id : 0,
    agentUuid: String(host?.agentUuid || '').trim() || null,
    ip,
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
    name,
    source,
    online,
    health: normalizeHostHealth(host?.health),
    status: normalizeHostStatus({ status: host?.status, online }),
    lastSeenAt: String(host?.lastSeenAt || '').trim() || null,
    error: String(host?.error || '').trim() || null,
    targetSocket,
    version: String(host?.version || '').trim() || null,
    protocolVersion: String(host?.protocolVersion || '').trim() || null,
    directories: normalizeHostDirectories(host?.directories),
    projects,
    projectCount: normalizeHostProjectCount(host?.projectCount, projects),
  };
};

const parseSemver = (input) => {
  const raw = String(input || '').trim().toLowerCase().replace(/^v/, '');
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return [
    Number.parseInt(match[1] || '0', 10),
    Number.parseInt(match[2] || '0', 10),
    Number.parseInt(match[3] || '0', 10),
  ];
};

const compareSemver = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    const leftPart = Number(left[index] || 0);
    const rightPart = Number(right[index] || 0);
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
};

export const isHostVersionOutOfDate = (hostVersion, targetVersion) => {
  const normalizedHostVersion = String(hostVersion || '').trim();
  const normalizedTargetVersion = String(targetVersion || '').trim();
  if (!normalizedTargetVersion) {
    return false;
  }
  if (!normalizedHostVersion) {
    return true;
  }

  const parsedHost = parseSemver(normalizedHostVersion);
  const parsedTarget = parseSemver(normalizedTargetVersion);
  if (parsedHost && parsedTarget) {
    return compareSemver(parsedHost, parsedTarget) < 0;
  }

  return normalizedHostVersion !== normalizedTargetVersion;
};

export const formatVersionWithProtocol = (version, protocolVersion) => {
  const normalizedVersion = String(version || '').trim() || UNKNOWN_VERSION;
  const normalizedProtocol = String(protocolVersion || '').trim();
  if (!normalizedProtocol) {
    return normalizedVersion;
  }
  const protocolLabel = normalizedProtocol.toLowerCase().startsWith('v')
    ? normalizedProtocol
    : `v${normalizedProtocol}`;
  return `${normalizedVersion} (Proto ${protocolLabel})`;
};

const normalizeTerminalOutputEntry = (entry) => {
  const stream = String(entry?.stream || '').trim().toLowerCase();
  const normalizedStream = stream === 'stderr'
    ? 'stderr'
    : stream === 'system'
      ? 'system'
      : 'stdout';

  return {
    timestamp: toIsoTimestamp(entry?.timestamp),
    stream: normalizedStream,
    text: String(entry?.text || ''),
  };
};

export const normalizeTerminalSession = (session) => {
  const sessionId = String(session?.sessionId || '').trim();
  if (!sessionId) {
    return null;
  }

  const hostId = Number.parseInt(String(session?.hostId || '').trim(), 10);
  const status = String(session?.status || '').trim().toLowerCase();
  const normalizedStatus = status === 'active' ? 'active' : 'closed';
  const exitCode = Number.parseInt(String(session?.exitCode || '').trim(), 10);

  return {
    sessionId,
    hostId: Number.isInteger(hostId) && hostId > 0 ? hostId : 0,
    hostName: String(session?.hostName || '').trim() || '-',
    hostIp: String(session?.hostIp || '').trim() || '-',
    status: normalizedStatus,
    startedAt: toIsoTimestamp(session?.startedAt),
    closedAt: normalizedStatus === 'closed' ? toIsoTimestamp(session?.closedAt || session?.startedAt) : null,
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    output: (Array.isArray(session?.output) ? session.output : []).map(normalizeTerminalOutputEntry),
  };
};

const safeStringify = (value) => {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_, current) => {
      if (typeof current === 'bigint') {
        return current.toString();
      }
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) {
          return '[Circular]';
        }
        seen.add(current);
      }
      if (current instanceof Error) {
        return {
          name: current.name,
          message: current.message,
          stack: current.stack,
        };
      }
      return current;
    });
  } catch {
    return String(value);
  }
};

export const formatClientLogArgs = (args) => {
  const values = Array.isArray(args) ? args : [];
  const parts = values
    .map((arg) => {
      if (typeof arg === 'string') {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack || `${arg.name}: ${arg.message}`;
      }
      if (arg === undefined) {
        return 'undefined';
      }
      if (arg === null) {
        return 'null';
      }
      if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
        return String(arg);
      }
      return safeStringify(arg);
    })
    .map((part) => String(part || '').trim())
    .filter(Boolean);

  return parts.join(' ').trim();
};

export const deriveDestinationFolderFromRepositoryUrl = (value) => {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  let candidatePath = input;

  const scpLikeMatch = input.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  if (scpLikeMatch && scpLikeMatch[1]) {
    candidatePath = scpLikeMatch[1];
  } else {
    try {
      const parsed = new URL(input);
      candidatePath = String(parsed.pathname || '').replace(/^\/+/, '');
    } catch {
      candidatePath = input;
    }
  }

  const segments = candidatePath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return '';
  }

  const rawName = segments[segments.length - 1].replace(/\.git$/i, '');
  return rawName
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
};

export const clampSidebarWidth = (value, { min, max, fallback } = {}) => {
  const normalizedMin = Number.isFinite(Number(min)) ? Number(min) : 220;
  const normalizedMax = Number.isFinite(Number(max)) ? Number(max) : 680;
  const parsed = Number(value);
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : normalizedMin;

  if (!Number.isFinite(parsed)) {
    return Math.max(normalizedMin, Math.min(normalizedMax, Math.round(normalizedFallback)));
  }

  return Math.max(normalizedMin, Math.min(normalizedMax, Math.round(parsed)));
};
