const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveConfiguredSudoPassword,
  isHostVersionOutOfDate,
  isHostVersionMismatch,
  createHostAgentAutoUpgradeController,
} = require('./hostAgentLifecycle');

test('resolveConfiguredSudoPassword prefers explicit deploy password', () => {
  const password = resolveConfiguredSudoPassword({
    PC_ROOT_PASSWORD: 'root-secret',
    PC_SUDO_PASSWORD: 'sudo-secret',
    PC_DEPLOY_SUDO_PASSWORD: 'deploy-secret',
  });
  assert.equal(password, 'deploy-secret');
});

test('resolveConfiguredSudoPassword falls back through supported aliases', () => {
  assert.equal(resolveConfiguredSudoPassword({ PC_SUDO_PASSWORD: 'sudo-secret' }), 'sudo-secret');
  assert.equal(resolveConfiguredSudoPassword({ PC_ROOT_PASSWORD: 'root-secret' }), 'root-secret');
  assert.equal(resolveConfiguredSudoPassword({}), '');
});

test('version helpers distinguish out-of-date from general mismatch', () => {
  assert.equal(isHostVersionOutOfDate('0.1.3', '0.1.4'), true);
  assert.equal(isHostVersionOutOfDate('0.1.5', '0.1.4'), false);
  assert.equal(isHostVersionMismatch('0.1.3', '0.1.4'), true);
  assert.equal(isHostVersionMismatch('0.1.5', '0.1.4'), true);
  assert.equal(isHostVersionMismatch('0.1.4', '0.1.4'), false);
});

test('auto upgrade controller deploys upgrade for older host version', async () => {
  const attempts = [];
  const logs = [];
  let nowMs = 1000;

  const controller = createHostAgentAutoUpgradeController({
    targetVersion: '0.1.4',
    cooldownMs: 30000,
    now: () => nowMs,
    findHostRecord: async () => ({ id: 7, name: 'blackbox', ip: '192.168.1.250' }),
    deployHostAgent: async (payload) => {
      attempts.push(payload);
    },
    emitLog: (entry) => {
      logs.push(entry);
    },
  });

  const triggered = await controller.considerRuntimeHost({
    agentUuid: 'abc',
    name: 'blackbox',
    ip: '192.168.1.250',
    version: '0.1.3',
  });

  assert.equal(triggered, true);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].deploymentAction, 'upgrade');
  assert.match(logs[0].message, /starting automatic upgrade/i);

  nowMs += 1000;
  const skippedForCooldown = await controller.considerRuntimeHost({
    agentUuid: 'abc',
    name: 'blackbox',
    ip: '192.168.1.250',
    version: '0.1.3',
  });
  assert.equal(skippedForCooldown, false);
  assert.equal(attempts.length, 1);
});

test('auto upgrade controller deploys re-deploy for higher mismatched host version', async () => {
  const attempts = [];
  const controller = createHostAgentAutoUpgradeController({
    targetVersion: '0.1.4',
    cooldownMs: 1,
    findHostRecord: async () => ({ id: 11, name: 'mac', ip: '127.0.0.1' }),
    deployHostAgent: async (payload) => {
      attempts.push(payload);
    },
  });

  const triggered = await controller.considerRuntimeHost({
    agentUuid: 'mac',
    name: 'mac',
    ip: '127.0.0.1',
    version: '0.1.5',
  });

  assert.equal(triggered, true);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].deploymentAction, 'redeploy');
});

test('auto upgrade controller ignores up-to-date hosts and missing persisted records', async () => {
  const attempts = [];
  const controller = createHostAgentAutoUpgradeController({
    targetVersion: '0.1.4',
    cooldownMs: 1,
    findHostRecord: async (runtimeHost) => (
      runtimeHost?.version === '0.1.2'
        ? null
        : { id: 15, name: 'up-to-date', ip: '10.0.0.1' }
    ),
    deployHostAgent: async (payload) => {
      attempts.push(payload);
    },
  });

  assert.equal(await controller.considerRuntimeHost({ version: '0.1.4' }), false);
  assert.equal(await controller.considerRuntimeHost({ version: '0.1.2' }), false);
  assert.equal(attempts.length, 0);
});
