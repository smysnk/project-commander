const {
  ACCESS_MODES,
  ALL_AUTOMATION_SCOPES,
  expandScopesForAccessMode,
  isFullAccessTokensEnabled,
  normalizeNumberArray,
  normalizeStringArray,
} = require('./automationTokens');

class LifecycleAuthorizationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LifecycleAuthorizationError';
    this.code = 'FORBIDDEN';
    this.statusCode = 403;
    this.details = details;
  }
}

const MODE_RANK = ACCESS_MODES.reduce((accumulator, mode, index) => {
  accumulator[mode] = index;
  return accumulator;
}, {});

const MODE_REQUIREMENTS = {
  'runtime:read': 'observe',
  'runtime:ensure:template': 'operate-template',
  'runtime:ensure:raw': 'operate-project',
  'runtime:delete': 'operate-template',
  'runtime:restart': 'operate-template',
  'runtime:kill:soft': 'operate-template',
  'runtime:kill:hard': 'operate-template',
  'runtime:templates:read': 'observe',
  'runtime:templates:write:project': 'operate-project',
  'runtime:templates:write:host': 'operate-host',
  'runtime:templates:write:global': 'admin',
  'hosts:read': 'observe',
  'hosts:write': 'operate-host',
  'paths:read': 'observe',
  'paths:write:project': 'operate-project',
  'paths:write:host': 'operate-host',
  'paths:write:global': 'admin',
  'logs:read': 'observe',
  'audit:read': 'admin',
  'tokens:read': 'admin',
  'tokens:write': 'admin',
};

const normalizeAccessMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODE_RANK, mode) ? mode : 'observe';
};

const normalizeInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const pathStartsWith = (candidate, prefix) => {
  const normalizedCandidate = String(candidate || '').trim().replace(/\/+/g, '/');
  const normalizedPrefix = String(prefix || '').trim().replace(/\/+/g, '/').replace(/\/+$/u, '');
  if (!normalizedCandidate || !normalizedPrefix) {
    return false;
  }
  return normalizedCandidate === normalizedPrefix || normalizedCandidate.startsWith(`${normalizedPrefix}/`);
};

const isModeAtLeast = (actual, required) => (
  (MODE_RANK[normalizeAccessMode(actual)] ?? 0) >= (MODE_RANK[normalizeAccessMode(required)] ?? 0)
);

const getActionModeRequirement = ({ action, target = {} }) => {
  if (action === 'runtime:ensure') {
    return target.rawCommand ? 'runtime:ensure:raw' : 'runtime:ensure:template';
  }
  if (action === 'runtime:templates:write') {
    if (normalizeInteger(target.projectId)) {
      return 'runtime:templates:write:project';
    }
    if (normalizeInteger(target.hostId)) {
      return 'runtime:templates:write:host';
    }
    return 'runtime:templates:write:global';
  }
  if (action === 'paths:write') {
    if (normalizeInteger(target.projectId)) {
      return 'paths:write:project';
    }
    if (normalizeInteger(target.hostId)) {
      return 'paths:write:host';
    }
    return 'paths:write:global';
  }
  return action;
};

const buildTrustedProfile = (user, actorType) => ({
  actorType,
  actorId: user?.subject || user?.email || null,
  actorName: user?.name || user?.email || actorType,
  accessMode: 'full-access',
  scopes: new Set(ALL_AUTOMATION_SCOPES),
  allowedHostIds: [],
  allowedProjectIds: [],
  allowedPathPrefixes: [],
  rawCommandAllowed: true,
  fullAccess: true,
  source: actorType,
});

const buildAccessProfile = (user = null) => {
  if (!user) {
    return buildTrustedProfile(user, 'system');
  }
  if (!user.automation) {
    return buildTrustedProfile(user, 'user');
  }

  const token = user.automationToken || {};
  const source = token.source || 'environment';
  const accessMode = normalizeAccessMode(token.accessMode || 'full-access');
  const fullAccess = Boolean(token.fullAccess) || accessMode === 'full-access';
  const scopes = new Set(expandScopesForAccessMode({
    accessMode,
    scopes: normalizeStringArray(token.scopes),
    fullAccess,
  }));

  return {
    actorType: source === 'database' ? 'automation-token' : 'automation-env',
    actorId: token.id == null ? user.subject || null : String(token.id),
    actorName: user.name || token.name || 'automation',
    accessMode,
    scopes,
    allowedHostIds: normalizeNumberArray(token.allowedHostIds),
    allowedProjectIds: normalizeNumberArray(token.allowedProjectIds),
    allowedPathPrefixes: normalizeStringArray(token.allowedPathPrefixes),
    rawCommandAllowed: Boolean(token.rawCommandAllowed) || fullAccess,
    fullAccess,
    source,
  };
};

const assertAllowed = (condition, message, details = {}) => {
  if (!condition) {
    throw new LifecycleAuthorizationError(message, details);
  }
};

const assertScope = (profile, scope) => {
  assertAllowed(
    profile.fullAccess || profile.scopes.has(scope),
    `Missing required automation scope: ${scope}`,
    { scope },
  );
};

const assertScopeConstraints = (profile, target = {}) => {
  const hostId = normalizeInteger(target.hostId);
  const projectId = normalizeInteger(target.projectId);

  if (profile.allowedHostIds.length > 0) {
    assertAllowed(hostId, 'Host-scoped token requires a target host id.', { allowedHostIds: profile.allowedHostIds });
    assertAllowed(
      profile.allowedHostIds.includes(hostId),
      `Automation token is not allowed to access host ${hostId}.`,
      { hostId, allowedHostIds: profile.allowedHostIds },
    );
  }

  if (profile.allowedProjectIds.length > 0) {
    assertAllowed(projectId, 'Project-scoped token requires a target project id.', { allowedProjectIds: profile.allowedProjectIds });
    assertAllowed(
      profile.allowedProjectIds.includes(projectId),
      `Automation token is not allowed to access project ${projectId}.`,
      { projectId, allowedProjectIds: profile.allowedProjectIds },
    );
  }

  const targetPaths = normalizeStringArray([
    target.path,
    target.codexPath,
    target.hostPath,
    target.cwd,
    target.projectPath,
    target.logRoot,
    ...(Array.isArray(target.paths) ? target.paths : []),
  ]);
  if (profile.allowedPathPrefixes.length > 0 && targetPaths.length > 0) {
    for (const targetPath of targetPaths) {
      assertAllowed(
        profile.allowedPathPrefixes.some((prefix) => pathStartsWith(targetPath, prefix)),
        `Automation token is not allowed to access path ${targetPath}.`,
        { path: targetPath, allowedPathPrefixes: profile.allowedPathPrefixes },
      );
    }
  }
};

const authorizeLifecycleAction = ({ user = null, action, requiredScopes = [], target = {} } = {}) => {
  const profile = buildAccessProfile(user);
  const fullAccessDisabled = profile.actorType.startsWith('automation')
    && profile.fullAccess
    && !isFullAccessTokensEnabled();
  assertAllowed(!fullAccessDisabled, 'Full-access automation tokens are disabled by deployment policy.');

  const actionRequirement = getActionModeRequirement({ action, target });
  const requiredMode = MODE_REQUIREMENTS[actionRequirement] || MODE_REQUIREMENTS[action] || 'observe';
  assertAllowed(
    profile.fullAccess || isModeAtLeast(profile.accessMode, requiredMode),
    `Automation access mode ${profile.accessMode} cannot perform ${action}.`,
    { action, accessMode: profile.accessMode, requiredMode },
  );

  for (const scope of requiredScopes) {
    assertScope(profile, scope);
  }

  if (target.rawCommand) {
    assertAllowed(
      profile.fullAccess || (profile.accessMode !== 'operate-template' && isModeAtLeast(profile.accessMode, 'operate-project')),
      'Raw command lifecycle definitions require operate-project access or full-access.',
      { action, accessMode: profile.accessMode },
    );
    assertScope(profile, 'runtime:raw-command');
    assertAllowed(profile.rawCommandAllowed, 'Raw command lifecycle definitions are disabled for this token.');
  }

  if (target.hardKill) {
    assertScope(profile, 'runtime:kill:hard');
  }

  assertScopeConstraints(profile, target);
  return profile;
};

module.exports = {
  LifecycleAuthorizationError,
  buildAccessProfile,
  authorizeLifecycleAction,
  pathStartsWith,
};
