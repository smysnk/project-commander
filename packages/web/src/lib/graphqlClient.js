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
    throw new Error(payload?.error || `GraphQL request failed (${response.status})`);
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((entry) => entry?.message).filter(Boolean).join('; ');
    throw new Error(message || 'GraphQL response returned errors');
  }

  return payload.data || {};
}
