const normalizeEmail = (value) => value.trim().toLowerCase();

export const parseAllowedUsers = (value) => {
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

export const readAuthEnv = () => ({
  nextAuthUrl: process.env.NEXTAUTH_URL?.trim() || process.env.WEB_URL?.trim() || '',
  nextAuthSecret: process.env.NEXTAUTH_SECRET?.trim() || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() || '',
  allowedUsers: parseAllowedUsers(process.env.AUTH_ALLOWED_USERS),
});

export const getEffectiveAuthUrl = () => {
  const env = readAuthEnv();
  if (env.nextAuthUrl) {
    return env.nextAuthUrl;
  }
  const webPort = process.env.WEB_PORT?.trim() || '3000';
  return `http://localhost:${webPort}`;
};

export const shouldUseSecureAuthCookies = () => {
  if (getEffectiveAuthUrl().startsWith('https://')) {
    return true;
  }
  return process.env.NODE_ENV === 'production';
};

export const getAuthSessionCookieName = () => (
  shouldUseSecureAuthCookies()
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'
);

export const isAuthEnabled = () => {
  const env = readAuthEnv();
  return Boolean(env.nextAuthSecret && env.googleClientId && env.googleClientSecret);
};

export const isAllowedUserEmail = (email, allowedUsers = readAuthEnv().allowedUsers) => {
  if (!email) {
    return false;
  }

  if (!allowedUsers.length) {
    return true;
  }

  return allowedUsers.includes(normalizeEmail(String(email)));
};
