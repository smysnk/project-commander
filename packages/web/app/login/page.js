import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import LoginScreen from '../../src/components/auth/LoginScreen';
import { authOptions } from '../../src/lib/auth-options';
import { isAuthEnabled } from '../../src/lib/auth-env';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const hasAuthError = Boolean(params?.error);
  const authEnabled = isAuthEnabled();
  const session = authEnabled ? await getServerSession(authOptions) : null;

  if (session && !hasAuthError) {
    redirect('/');
  }

  return <LoginScreen authConfigured={authEnabled} />;
}
