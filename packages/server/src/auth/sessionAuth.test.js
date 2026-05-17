const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getAutomationTokenRecords,
  isAuthExplicitlyDisabled,
  isApiAuthConfigured,
  readAuthenticatedAccessFromHeaders,
  resolveAutomationAccessFromHeaders,
} = require('./sessionAuth');

const withEnv = async (patch, fn) => {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] == null) {
      delete process.env[key];
    } else {
      process.env[key] = patch[key];
    }
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

test('automation bearer token grants non-browser API access', async () => {
  await withEnv({
    NEXTAUTH_SECRET: null,
    PROJECT_COMMANDER_AUTOMATION_TOKEN: 'codex:secret-token',
    PROJECT_COMMANDER_AUTOMATION_TOKENS: null,
  }, async () => {
    assert.equal(isApiAuthConfigured(), true);
    assert.deepEqual(getAutomationTokenRecords(), [
      { name: 'codex', token: 'secret-token' },
    ]);

    const result = await readAuthenticatedAccessFromHeaders({
      headers: {
        authorization: 'Bearer secret-token',
      },
    });

    assert.equal(result.failure, null);
    assert.equal(result.user.name, 'codex');
    assert.equal(result.user.automation, true);
  });
});

test('invalid automation bearer token is rejected', async () => {
  await withEnv({
    NEXTAUTH_SECRET: null,
    PROJECT_COMMANDER_AUTOMATION_TOKEN: 'expected-token',
    PROJECT_COMMANDER_AUTOMATION_TOKENS: null,
  }, async () => {
    const result = resolveAutomationAccessFromHeaders({
      authorization: 'Bearer wrong-token',
    });

    assert.equal(result.user, null);
    assert.equal(result.failure, 'missing');
  });
});

test('explicit auth disable flag bypasses configured API auth', async () => {
  await withEnv({
    NEXTAUTH_SECRET: 'configured-secret',
    PROJECT_COMMANDER_AUTOMATION_TOKEN: 'codex:secret-token',
    PROJECT_COMMANDER_AUTH_REQUIRED: 'true',
    PROJECT_COMMANDER_AUTH_DISABLED: '1',
  }, async () => {
    assert.equal(isAuthExplicitlyDisabled(), true);
    assert.equal(isApiAuthConfigured(), false);
  });
});
