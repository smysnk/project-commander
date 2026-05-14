export const dynamic = 'force-dynamic';

export default async function AccessDeniedPage({ searchParams }) {
  const params = await searchParams;
  const email = typeof params?.email === 'string' ? params.email.trim() : '';
  const hasEmail = email.length > 0;

  return (
    <main className="loginShell">
      <section className="loginPanel">
        <p className="loginEyebrow">Unauthorized</p>
        <h1>Access denied</h1>
        <p className="loginMuted">
          {hasEmail
            ? (
              <>
                <strong>{email}</strong>
                {' '}
                is not on the Project Commander access list.
              </>
            )
            : 'Your Google account is not on the Project Commander access list.'}
        </p>
        <p className="loginMuted">
          Ask an administrator to add your email to <code>AUTH_ALLOWED_USERS</code> and then try again.
        </p>
      </section>
    </main>
  );
}
