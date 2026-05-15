const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LifecycleAuthorizationError,
  authorizeLifecycleAction,
} = require('./lifecycleAccess');

const automationUser = (overrides = {}) => ({
  subject: `automation-token:${overrides.id || 1}`,
  name: overrides.name || 'test-token',
  automation: true,
  automationToken: {
    source: 'database',
    id: overrides.id || 1,
    name: overrides.name || 'test-token',
    accessMode: overrides.accessMode || 'observe',
    scopes: Array.isArray(overrides.scopes) ? overrides.scopes : [],
    allowedHostIds: Array.isArray(overrides.allowedHostIds) ? overrides.allowedHostIds : [],
    allowedProjectIds: Array.isArray(overrides.allowedProjectIds) ? overrides.allowedProjectIds : [],
    allowedPathPrefixes: Array.isArray(overrides.allowedPathPrefixes) ? overrides.allowedPathPrefixes : [],
    rawCommandAllowed: Boolean(overrides.rawCommandAllowed),
    fullAccess: Boolean(overrides.fullAccess),
  },
});

const assertDenied = (fn, pattern) => {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof LifecycleAuthorizationError, true);
    assert.match(error.message, pattern);
    return true;
  });
};

test('observe automation token cannot start or kill a process', () => {
  const user = automationUser({ accessMode: 'observe' });

  assertDenied(() => authorizeLifecycleAction({
    user,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 1, projectId: 1 },
  }), /cannot perform runtime:ensure/i);

  assertDenied(() => authorizeLifecycleAction({
    user,
    action: 'runtime:kill:soft',
    requiredScopes: ['runtime:kill:soft'],
    target: { hostId: 1 },
  }), /cannot perform runtime:kill:soft/i);
});

test('host-scoped token cannot manage another host', () => {
  const user = automationUser({
    accessMode: 'operate-template',
    allowedHostIds: [7],
  });

  authorizeLifecycleAction({
    user,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 7, projectId: 3 },
  });

  assertDenied(() => authorizeLifecycleAction({
    user,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 8, projectId: 3 },
  }), /not allowed to access host 8/i);
});

test('operate-template can start an approved template but cannot pass raw command text', () => {
  const user = automationUser({ accessMode: 'operate-template' });

  authorizeLifecycleAction({
    user,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 1, projectId: 1, rawCommand: false },
  });

  assertDenied(() => authorizeLifecycleAction({
    user,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 1, projectId: 1, rawCommand: true },
  }), /cannot perform runtime:ensure/i);
});

test('operate-project token cannot mutate another project', () => {
  const user = automationUser({
    accessMode: 'operate-project',
    allowedProjectIds: [11],
  });

  authorizeLifecycleAction({
    user,
    action: 'runtime:templates:write',
    requiredScopes: ['runtime:templates:write'],
    target: { projectId: 11 },
  });

  assertDenied(() => authorizeLifecycleAction({
    user,
    action: 'runtime:templates:write',
    requiredScopes: ['runtime:templates:write'],
    target: { projectId: 12 },
  }), /not allowed to access project 12/i);
});

test('raw command requests fail without explicit scope and token flag', () => {
  const missingScope = automationUser({
    accessMode: 'operate-project',
    rawCommandAllowed: true,
  });
  assertDenied(() => authorizeLifecycleAction({
    user: missingScope,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 1, projectId: 1, rawCommand: true },
  }), /runtime:raw-command/i);

  const missingFlag = automationUser({
    accessMode: 'operate-project',
    scopes: ['runtime:raw-command'],
    rawCommandAllowed: false,
  });
  assertDenied(() => authorizeLifecycleAction({
    user: missingFlag,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 1, projectId: 1, rawCommand: true },
  }), /disabled for this token/i);
});

test('full-access token can perform raw lifecycle and hard kill operations', () => {
  const user = automationUser({
    accessMode: 'full-access',
    fullAccess: true,
    rawCommandAllowed: true,
  });

  authorizeLifecycleAction({
    user,
    action: 'runtime:ensure',
    requiredScopes: ['runtime:ensure'],
    target: { hostId: 1, projectId: 1, rawCommand: true },
  });

  authorizeLifecycleAction({
    user,
    action: 'runtime:kill:hard',
    requiredScopes: ['runtime:kill:hard'],
    target: { hostId: 1, hardKill: true },
  });
});
