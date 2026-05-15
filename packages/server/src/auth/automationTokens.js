const crypto = require('crypto');
const { Op } = require('sequelize');
const { AutomationApiToken } = require('../models/automationApiToken');

const ACCESS_MODES = [
  'observe',
  'operate-template',
  'operate-project',
  'operate-host',
  'admin',
  'full-access',
];

const ALL_AUTOMATION_SCOPES = [
  'runtime:read',
  'runtime:ensure',
  'runtime:delete',
  'runtime:restart',
  'runtime:kill:soft',
  'runtime:kill:hard',
  'runtime:raw-command',
  'runtime:templates:read',
  'runtime:templates:write',
  'hosts:read',
  'hosts:write',
  'paths:read',
  'paths:write',
  'logs:read',
  'audit:read',
  'tokens:read',
  'tokens:write',
  'admin:full-access',
];

const ACCESS_MODE_DEFAULT_SCOPES = {
  observe: [
    'runtime:read',
    'runtime:templates:read',
    'hosts:read',
    'paths:read',
    'logs:read',
  ],
  'operate-template': [
    'runtime:read',
    'runtime:ensure',
    'runtime:delete',
    'runtime:restart',
    'runtime:kill:soft',
    'runtime:templates:read',
    'hosts:read',
    'paths:read',
    'logs:read',
  ],
  'operate-project': [
    'runtime:read',
    'runtime:ensure',
    'runtime:delete',
    'runtime:restart',
    'runtime:kill:soft',
    'runtime:templates:read',
    'runtime:templates:write',
    'hosts:read',
    'paths:read',
    'paths:write',
    'logs:read',
  ],
  'operate-host': [
    'runtime:read',
    'runtime:ensure',
    'runtime:delete',
    'runtime:restart',
    'runtime:kill:soft',
    'runtime:kill:hard',
    'runtime:templates:read',
    'runtime:templates:write',
    'hosts:read',
    'hosts:write',
    'paths:read',
    'paths:write',
    'logs:read',
  ],
  admin: [
    'runtime:read',
    'runtime:ensure',
    'runtime:delete',
    'runtime:restart',
    'runtime:kill:soft',
    'runtime:kill:hard',
    'runtime:raw-command',
    'runtime:templates:read',
    'runtime:templates:write',
    'hosts:read',
    'hosts:write',
    'paths:read',
    'paths:write',
    'logs:read',
    'audit:read',
    'tokens:read',
    'tokens:write',
  ],
  'full-access': ALL_AUTOMATION_SCOPES,
};

const normalizeAccessMode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ACCESS_MODES.includes(normalized) ? normalized : 'observe';
};

const normalizeStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  ));
};

const normalizeNumberArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry > 0),
  ));
};

const normalizeDate = (value) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isFullAccessTokensEnabled = () => (
  String(process.env.PROJECT_COMMANDER_FULL_ACCESS_TOKENS_ENABLED || 'true')
    .trim()
    .toLowerCase() !== 'false'
);

const hashAutomationToken = (token) => crypto
  .createHash('sha256')
  .update(String(token || ''), 'utf8')
  .digest('hex');

const generateAutomationToken = () => `pc_${crypto.randomBytes(32).toString('base64url')}`;

const expandScopesForAccessMode = ({ accessMode, scopes = [], fullAccess = false }) => {
  const mode = normalizeAccessMode(fullAccess ? 'full-access' : accessMode);
  const scopeSet = new Set(ACCESS_MODE_DEFAULT_SCOPES[mode] || []);
  for (const scope of normalizeStringArray(scopes)) {
    if (scope.startsWith('!')) {
      scopeSet.delete(scope.slice(1));
    } else {
      scopeSet.add(scope);
    }
  }
  if (fullAccess || mode === 'full-access') {
    for (const scope of ALL_AUTOMATION_SCOPES) {
      scopeSet.add(scope);
    }
  }
  return Array.from(scopeSet).filter((scope) => ALL_AUTOMATION_SCOPES.includes(scope));
};

const mapAutomationTokenForApi = (record) => {
  const plain = record && typeof record.get === 'function' ? record.get({ plain: true }) : record;
  if (!plain) {
    return null;
  }
  const accessMode = normalizeAccessMode(plain.accessMode);
  const fullAccess = Boolean(plain.fullAccess) || accessMode === 'full-access';
  const scopes = normalizeStringArray(plain.scopesJson);
  return {
    id: Number(plain.id),
    name: String(plain.name || '').trim(),
    accessMode,
    scopes,
    effectiveScopes: expandScopesForAccessMode({ accessMode, scopes, fullAccess }),
    allowedHostIds: normalizeNumberArray(plain.allowedHostIdsJson),
    allowedProjectIds: normalizeNumberArray(plain.allowedProjectIdsJson),
    allowedPathPrefixes: normalizeStringArray(plain.allowedPathPrefixesJson),
    rawCommandAllowed: Boolean(plain.rawCommandAllowed),
    fullAccess,
    expiresAt: plain.expiresAt ? new Date(plain.expiresAt).toISOString() : null,
    lastUsedAt: plain.lastUsedAt ? new Date(plain.lastUsedAt).toISOString() : null,
    createdBy: plain.createdBy ? String(plain.createdBy) : null,
    revokedAt: plain.revokedAt ? new Date(plain.revokedAt).toISOString() : null,
    createdAt: plain.createdAt ? new Date(plain.createdAt).toISOString() : null,
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : null,
  };
};

const mapAutomationTokenToUser = (record) => {
  const mapped = mapAutomationTokenForApi(record);
  if (!mapped || mapped.revokedAt) {
    return null;
  }
  return {
    subject: `automation-token:${mapped.id}`,
    name: mapped.name || `automation-token-${mapped.id}`,
    email: null,
    image: null,
    automation: true,
    automationToken: {
      source: 'database',
      ...mapped,
    },
  };
};

const findActiveAutomationTokenByBearer = async (bearerToken) => {
  const token = String(bearerToken || '').trim();
  if (!token) {
    return { record: null, failure: 'missing' };
  }
  const tokenHash = hashAutomationToken(token);
  let record = null;
  try {
    record = await AutomationApiToken.findOne({ where: { tokenHash } });
  } catch (error) {
    // Local tests and first-boot dev databases may not have this table yet.
    return { record: null, failure: 'unavailable', error };
  }
  if (!record) {
    return { record: null, failure: 'missing' };
  }
  const now = Date.now();
  if (record.revokedAt) {
    return { record: null, failure: 'revoked' };
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now) {
    return { record: null, failure: 'expired' };
  }
  try {
    await record.update({ lastUsedAt: new Date() }, { silent: true });
  } catch {
    // Authentication should not fail only because last-used bookkeeping failed.
  }
  return { record, failure: null };
};

const listAutomationTokens = async ({ includeRevoked = false, limit = 500 } = {}) => {
  const where = includeRevoked ? {} : { revokedAt: null };
  const records = await AutomationApiToken.findAll({
    where,
    limit: Math.min(Math.max(Number(limit) || 500, 1), 1000),
    order: [['createdAt', 'DESC']],
  });
  return records.map((record) => mapAutomationTokenForApi(record)).filter(Boolean);
};

const createAutomationToken = async (input = {}, actor = null) => {
  const accessMode = normalizeAccessMode(input.accessMode);
  const fullAccess = Boolean(input.fullAccess) || accessMode === 'full-access';
  if (fullAccess && !isFullAccessTokensEnabled()) {
    throw new Error('Full-access automation tokens are disabled by deployment policy.');
  }
  const token = generateAutomationToken();
  const expiresAt = normalizeDate(input.expiresAt)
    || (fullAccess ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null);
  const createdBy = String(
    input.createdBy
    || actor?.email
    || actor?.name
    || actor?.subject
    || 'system',
  ).trim() || 'system';

  const record = await AutomationApiToken.create({
    name: String(input.name || '').trim() || 'automation-token',
    tokenHash: hashAutomationToken(token),
    accessMode: fullAccess ? 'full-access' : accessMode,
    scopesJson: normalizeStringArray(input.scopes),
    allowedHostIdsJson: normalizeNumberArray(input.allowedHostIds),
    allowedProjectIdsJson: normalizeNumberArray(input.allowedProjectIds),
    allowedPathPrefixesJson: normalizeStringArray(input.allowedPathPrefixes),
    rawCommandAllowed: Boolean(input.rawCommandAllowed) || fullAccess,
    fullAccess,
    expiresAt,
    createdBy,
  });

  return {
    token,
    record: mapAutomationTokenForApi(record),
    warning: fullAccess
      ? 'Full-access tokens can perform all lifecycle operations and should be stored carefully; this token value is shown only once.'
      : 'Token value is shown only once.',
  };
};

const revokeAutomationToken = async ({ id } = {}) => {
  const parsedId = Number(id);
  if (!Number.isInteger(parsedId) || parsedId <= 0) {
    throw new Error('id must be a positive integer');
  }
  const record = await AutomationApiToken.findByPk(parsedId);
  if (!record) {
    return false;
  }
  if (!record.revokedAt) {
    await record.update({ revokedAt: new Date() });
  }
  return true;
};

const deleteExpiredAutomationTokens = async ({ before = new Date() } = {}) => AutomationApiToken.destroy({
  where: {
    expiresAt: {
      [Op.lt]: before,
    },
  },
});

module.exports = {
  ACCESS_MODE_DEFAULT_SCOPES,
  ACCESS_MODES,
  ALL_AUTOMATION_SCOPES,
  createAutomationToken,
  deleteExpiredAutomationTokens,
  expandScopesForAccessMode,
  findActiveAutomationTokenByBearer,
  generateAutomationToken,
  hashAutomationToken,
  isFullAccessTokensEnabled,
  listAutomationTokens,
  mapAutomationTokenForApi,
  mapAutomationTokenToUser,
  normalizeAccessMode,
  normalizeNumberArray,
  normalizeStringArray,
  revokeAutomationToken,
};
