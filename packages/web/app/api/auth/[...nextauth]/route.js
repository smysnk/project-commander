import NextAuth from 'next-auth';
import { authOptions } from '../../../../src/lib/auth-options';
import { isAuthEnabled } from '../../../../src/lib/auth-env';

const handler = NextAuth(authOptions);

const handleUnconfiguredAuth = () => Response.json(
  {
    error: 'Google OAuth is not configured. Set NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, and GOOGLE_CLIENT_SECRET.',
  },
  { status: 503 },
);

export const GET = async (request, context) => (
  isAuthEnabled() ? handler(request, context) : handleUnconfiguredAuth()
);

export const POST = async (request, context) => (
  isAuthEnabled() ? handler(request, context) : handleUnconfiguredAuth()
);
