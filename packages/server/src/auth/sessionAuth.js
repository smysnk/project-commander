const { parse: parseCookieHeader } = require('cookie');
const { getToken } = require('next-auth/jwt');

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

const isApiAuthConfigured = () => Boolean(getEffectiveAuthSecret());

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
  getEffectiveAuthSecret,
  isAllowedUserEmail,
  isApiAuthConfigured,
  parseAllowedUsers,
  readAuthenticatedAccess,
  readAuthenticatedAccessFromHeaders,
  readAuthenticatedUser,
  readAuthenticatedUserFromHeaders,
  shouldUseSecureAuthCookies,
};
