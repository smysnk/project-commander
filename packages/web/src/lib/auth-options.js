import GoogleProvider from 'next-auth/providers/google';
import {
  getAuthSessionCookieName,
  isAllowedUserEmail,
  readAuthEnv,
  shouldUseSecureAuthCookies,
} from './auth-env';

const authEnv = readAuthEnv();
const useSecureCookies = shouldUseSecureAuthCookies();

export const authOptions = {
  providers:
    authEnv.googleClientId && authEnv.googleClientSecret
      ? [
          GoogleProvider({
            clientId: authEnv.googleClientId,
            clientSecret: authEnv.googleClientSecret,
          }),
        ]
      : [],
  secret: authEnv.nextAuthSecret,
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  cookies: {
    sessionToken: {
      name: getAuthSessionCookieName(),
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
  },
  callbacks: {
    async signIn({ user, profile }) {
      const email = user.email || (typeof profile?.email === 'string' ? profile.email : null);
      return isAllowedUserEmail(email);
    },
    async jwt({ token, user, profile }) {
      if (user?.email) {
        token.email = user.email;
      }
      if (user?.name) {
        token.name = user.name;
      }
      if (user?.image) {
        token.picture = user.image;
      }
      if (profile?.sub) {
        token.sub = String(profile.sub);
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        email: typeof token.email === 'string' ? token.email : session.user?.email,
        image: typeof token.picture === 'string' ? token.picture : session.user?.image,
        name: typeof token.name === 'string' ? token.name : session.user?.name,
      };
      return session;
    },
  },
};
