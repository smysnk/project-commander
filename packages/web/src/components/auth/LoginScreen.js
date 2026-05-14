'use client';

import { useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

const normalizeCallbackPath = (value) => {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  return value;
};

const getLoginErrorMessage = (value) => {
  switch (value) {
    case 'AccessDenied':
      return 'That Google account is not allowed for this application.';
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'OAuthCreateAccount':
      return 'Google OAuth could not complete. Check the callback URL and client credentials.';
    case 'Configuration':
      return 'Authentication is configured incorrectly. Check the auth environment values.';
    case 'SessionExpired':
      return 'Your session could not be used by the backend. Sign in again.';
    default:
      return value ? 'Authentication failed. Try again.' : null;
  }
};

export default function LoginScreen({ authConfigured }) {
  const searchParams = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const callbackUrl = normalizeCallbackPath(searchParams.get('callbackUrl'));
  const errorMessage = useMemo(
    () => getLoginErrorMessage(searchParams.get('error')),
    [searchParams],
  );

  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    try {
      await signIn('google', { callbackUrl });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <p className="loginEyebrow">Google OAuth</p>
        <h1>Sign in to Project Commander</h1>
        <p className="loginMuted">
          The same NextAuth session is used by the frontend, GraphQL API, and websocket runtime stream.
        </p>

        <div className="loginButtonRow">
          <button
            type="button"
            className="loginButton"
            onClick={handleGoogleSignIn}
            disabled={!authConfigured || submitting}
          >
            {authConfigured
              ? (submitting ? 'Redirecting…' : 'Continue with Google')
              : 'Google OAuth not configured'}
          </button>
        </div>

        {errorMessage ? <p className="loginErrorText">{errorMessage}</p> : null}

        {!authConfigured ? (
          <p className="loginMuted">
            Set <code>NEXTAUTH_SECRET</code>, <code>GOOGLE_CLIENT_ID</code>, and <code>GOOGLE_CLIENT_SECRET</code> to enable login.
          </p>
        ) : null}
      </section>
    </main>
  );
}
