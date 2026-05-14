import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import HomePageContainer from '../src/features/home/HomePageContainer';
import { authOptions } from '../src/lib/auth-options';
import { isAllowedUserEmail, isAuthEnabled } from '../src/lib/auth-env';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const authEnabled = isAuthEnabled();
  const session = authEnabled ? await getServerSession(authOptions) : null;
  const sessionEmail = typeof session?.user?.email === 'string' ? session.user.email : null;

  if (authEnabled && !session) {
    redirect('/login');
  }

  if (authEnabled && !isAllowedUserEmail(sessionEmail)) {
    const params = new URLSearchParams();
    if (sessionEmail) {
      params.set('email', sessionEmail);
    }
    redirect(`/access-denied${params.size > 0 ? `?${params.toString()}` : ''}`);
  }

  return <HomePageContainer />;
}
