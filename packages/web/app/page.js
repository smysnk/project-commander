import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import HomePageContainer from '../src/features/home/HomePageContainer';
import { authOptions } from '../src/lib/auth-options';
import { isAuthEnabled } from '../src/lib/auth-env';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const authEnabled = isAuthEnabled();
  const session = authEnabled ? await getServerSession(authOptions) : null;

  if (authEnabled && !session) {
    redirect('/login');
  }

  return <HomePageContainer />;
}
