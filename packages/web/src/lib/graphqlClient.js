const redirectToLogin = (error = 'SessionExpired') => {
  if (typeof window === 'undefined') {
    return;
  }
  const currentPath = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
  const params = new URLSearchParams();
  params.set('error', String(error || 'SessionExpired'));
  if (currentPath && currentPath !== '/login') {
    params.set('callbackUrl', currentPath);
  }
  window.location.assign(`/login?${params.toString()}`);
};

export async function graphqlRequest({ query, variables = {}, endpoint = '/graphql' }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      redirectToLogin();
    }
    throw new Error(payload?.error || `GraphQL request failed (${response.status})`);
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((entry) => entry?.message).filter(Boolean).join('; ');
    throw new Error(message || 'GraphQL response returned errors');
  }

  return payload.data || {};
}
