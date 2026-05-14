import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import LoginScreen from '../../src/components/auth/LoginScreen';
import { authOptions } from '../../src/lib/auth-options';
import { isAllowedUserEmail, isAuthEnabled } from '../../src/lib/auth-env';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const hasAuthError = Boolean(params?.error);
  const authEnabled = isAuthEnabled();
  const session = authEnabled ? await getServerSession(authOptions) : null;
  const sessionEmail = typeof session?.user?.email === 'string' ? session.user.email : null;

  if (session && !hasAuthError) {
    if (!isAllowedUserEmail(sessionEmail)) {
      const unauthorizedParams = new URLSearchParams();
      if (sessionEmail) {
        unauthorizedParams.set('email', sessionEmail);
      }
      redirect(`/access-denied${unauthorizedParams.size > 0 ? `?${unauthorizedParams.toString()}` : ''}`);
    }
    redirect('/');
  }

  return <LoginScreen authConfigured={authEnabled} />;
}
