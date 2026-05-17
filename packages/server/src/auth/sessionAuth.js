const { parse: parseCookieHeader } = require('cookie');
const crypto = require('crypto');
const { getToken } = require('next-auth/jwt');
const {
  findActiveAutomationTokenByBearer,
  mapAutomationTokenToUser,
} = require('./automationTokens');

const normalizeEmail = (value) => value.trim().toLowerCase();

const parseAllowedUsers = (value) => {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      String(value)
        .split(/[\n,]/u)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(normalizeEmail),
    ),
  );
};

const getEffectiveAuthSecret = () => process.env.NEXTAUTH_SECRET?.trim() || '';

const parseAutomationTokenEntries = (value) => {
  if (!value) {
    return [];
  }
  return String(value)
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex > 0) {
        return {
          name: entry.slice(0, separatorIndex).trim(),
          token: entry.slice(separatorIndex + 1).trim(),
        };
      }
      return {
        name: 'automation',
        token: entry,
      };
    })
    .filter((entry) => entry.token);
};

const getAutomationTokenRecords = () => {
  const records = [
    ...parseAutomationTokenEntries(process.env.PROJECT_COMMANDER_AUTOMATION_TOKEN),
    ...parseAutomationTokenEntries(process.env.PROJECT_COMMANDER_AUTOMATION_TOKENS),
  ];
  const seen = new Set();
  return records.filter((record) => {
    if (seen.has(record.token)) {
      return false;
    }
    seen.add(record.token);
    return true;
  });
};

const safeTokenEquals = (actual, expected) => {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  if (actualBuffer.length !== expectedBuffer.length || actualBuffer.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

const readBearerToken = (headers = {}) => {
  const rawAuthorization = headers.authorization || headers.Authorization || '';
  const match = String(rawAuthorization).match(/^Bearer\s+(.+)$/iu);
  return match ? match[1].trim() : '';
};

const resolveAutomationAccessFromHeaders = (headers = {}) => {
  const bearerToken = readBearerToken(headers);
  if (!bearerToken) {
    return null;
  }
  const matched = getAutomationTokenRecords()
    .find((record) => safeTokenEquals(bearerToken, record.token));
  if (!matched) {
    return {
      user: null,
      failure: 'missing',
    };
  }
  return {
    user: {
      subject: `automation:${matched.name || 'token'}`,
      name: matched.name || 'automation',
      email: null,
      image: null,
      automation: true,
      automationToken: {
        source: 'environment',
        name: matched.name || 'automation',
        accessMode: 'full-access',
        scopes: [],
        allowedHostIds: [],
        allowedProjectIds: [],
        allowedPathPrefixes: [],
        rawCommandAllowed: true,
        fullAccess: true,
      },
    },
    failure: null,
  };
};

const resolvePersistedAutomationAccessFromHeaders = async (headers = {}) => {
  const bearerToken = readBearerToken(headers);
  if (!bearerToken) {
    return null;
  }

  const result = await findActiveAutomationTokenByBearer(bearerToken);
  if (!result.record) {
    if (result.failure === 'unavailable') {
      return null;
    }
    return {
      user: null,
      failure: result.failure || 'missing',
    };
  }

  return {
    user: mapAutomationTokenToUser(result.record),
    failure: null,
  };
};

const shouldUseSecureAuthCookies = () => {
  const candidates = [
    process.env.NEXTAUTH_URL,
    process.env.WEB_URL,
    process.env.SERVER_URL,
    process.env.APP_URL,
  ].filter(Boolean);

  if (candidates.some((value) => String(value).startsWith('https://'))) {
    return true;
  }

  return process.env.NODE_ENV === 'production';
};

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const isAuthExplicitlyDisabled = () => (
  isTruthy(process.env.PROJECT_COMMANDER_AUTH_DISABLED)
  || isTruthy(process.env.AUTH_DISABLED)
);

const isApiAuthConfigured = () => Boolean(
  !isAuthExplicitlyDisabled()
  && (
    getEffectiveAuthSecret()
    || getAutomationTokenRecords().length > 0
    || isTruthy(process.env.PROJECT_COMMANDER_AUTH_REQUIRED)
    || isTruthy(process.env.PROJECT_COMMANDER_AUTOMATION_TOKEN_AUTH_ENABLED)
  ),
);

const isAllowedUserEmail = (
  email,
  allowedUsers = parseAllowedUsers(process.env.AUTH_ALLOWED_USERS),
) => {
  if (!email) {
    return false;
  }

  if (!allowedUsers.length) {
    return true;
  }

  return allowedUsers.includes(normalizeEmail(String(email)));
};

const resolveUserFromToken = (token) => {
  if (!token) {
    return {
      user: null,
      failure: 'missing',
    };
  }

  const email = typeof token.email === 'string' ? token.email : null;
  if (!isAllowedUserEmail(email)) {
    return {
      user: null,
      failure: 'forbidden',
    };
  }

  return {
    user: {
      subject: typeof token.sub === 'string' ? token.sub : null,
      name: typeof token.name === 'string' ? token.name : null,
      email,
      image:
        typeof token.picture === 'string'
          ? token.picture
          : (typeof token.image === 'string' ? token.image : null),
    },
    failure: null,
  };
};

const readAuthenticatedAccessFromHeaders = async ({ headers = {}, cookies = null } = {}) => {
  const persistedAutomationAccess = await resolvePersistedAutomationAccessFromHeaders(headers);
  if (
    persistedAutomationAccess?.user
    || (
      persistedAutomationAccess?.failure
      && persistedAutomationAccess.failure !== 'missing'
      && persistedAutomationAccess.failure !== 'unavailable'
    )
  ) {
    return persistedAutomationAccess;
  }

  const automationAccess = resolveAutomationAccessFromHeaders(headers);
  if (automationAccess?.user || automationAccess?.failure) {
    return automationAccess;
  }

  const secret = getEffectiveAuthSecret();
  if (!secret) {
    return {
      user: null,
      failure: 'unconfigured',
    };
  }

  const normalizedCookies = cookies || parseCookieHeader(headers.cookie || '');
  const token = await getToken({
    req: {
      cookies: normalizedCookies,
      headers,
    },
    secret,
    secureCookie: shouldUseSecureAuthCookies(),
  });

  return resolveUserFromToken(token);
};

const readAuthenticatedUserFromHeaders = async (input) => {
  const result = await readAuthenticatedAccessFromHeaders(input);
  return result.user;
};

const readAuthenticatedAccess = async (request) => readAuthenticatedAccessFromHeaders({
  headers: request?.headers || {},
});

const readAuthenticatedUser = async (request) => readAuthenticatedUserFromHeaders({
  headers: request?.headers || {},
});

module.exports = {
  getAutomationTokenRecords,
  getEffectiveAuthSecret,
  isAuthExplicitlyDisabled,
  isAllowedUserEmail,
  isApiAuthConfigured,
  parseAllowedUsers,
  resolveAutomationAccessFromHeaders,
  resolvePersistedAutomationAccessFromHeaders,
  readAuthenticatedAccess,
  readAuthenticatedAccessFromHeaders,
  readAuthenticatedUser,
  readAuthenticatedUserFromHeaders,
  shouldUseSecureAuthCookies,
};
