const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { Writable } = require('node:stream');

const { buildRuntimeOptions, parseArgv, runCli, waitSucceeded } = require('../src');

const captureStream = () => {
  let text = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        text += chunk.toString('utf8');
        callback();
      },
    }),
    get text() {
      return text;
    },
  };
};

const runWithClient = async (argv, client, extra = {}) => {
  const stdout = captureStream();
  const stderr = captureStream();
  let capturedOptions = null;
  const exitCode = await runCli(argv, {
    env: extra.env || {},
    stdout: stdout.stream,
    stderr: stderr.stream,
    clientFactory(options) {
      capturedOptions = options;
      return client;
    },
  });
  return {
    exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    clientOptions: capturedOptions,
  };
};

test('parseArgv supports command positionals, booleans, values, and repeats', () => {
  const parsed = parseArgv([
    '--json',
    'process',
    'ensure',
    '--host=clearbox',
    '--arg',
    'one',
    '--arg',
    'two',
    '--wait',
  ]);

  assert.deepEqual(parsed.positionals, ['process', 'ensure']);
  assert.equal(parsed.options.json, true);
  assert.equal(parsed.options.host, 'clearbox');
  assert.deepEqual(parsed.options.arg, ['one', 'two']);
  assert.equal(parsed.options.wait, true);
});

test('runtime config precedence is flags, environment, then pcctl config', () => {
  const options = { url: 'https://flag.example', token: 'flag-token' };
  const env = {
    PROJECT_COMMANDER_URL: 'https://env.example',
    PROJECT_COMMANDER_TOKEN: 'env-token',
    PROJECT_COMMANDER_DEFAULT_HOST: 'env-host',
  };
  const config = {
    url: 'https://config.example',
    token: 'config-token',
    defaultHost: 'config-host',
  };

  assert.deepEqual(buildRuntimeOptions({ options, env, config }), {
    endpoint: undefined,
    baseUrl: 'https://flag.example',
    token: 'flag-token',
    defaultHost: 'env-host',
  });
});

test('hosts list --json returns hosts and configures commander-client for pcctl', async () => {
  const result = await runWithClient(['hosts', 'list', '--json'], {
    async listHosts() {
      return [{ id: 3, name: 'clearbox', ip: '192.168.1.251' }];
    },
  }, {
    env: {
      PROJECT_COMMANDER_URL: 'https://commander.example',
      PROJECT_COMMANDER_TOKEN: 'token-from-env',
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout)[0].name, 'clearbox');
  assert.equal(result.clientOptions.baseUrl, 'https://commander.example');
  assert.equal(result.clientOptions.token, 'token-from-env');
  assert.equal(result.clientOptions.actor, 'pcctl');
  assert.equal(result.clientOptions.toolName, 'pcctl');
});

test('projects list uses default host from config file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcctl-test-'));
  const configPath = path.join(tmpDir, 'pcctl.json');
  fs.writeFileSync(configPath, JSON.stringify({ defaultHost: 'clearbox' }));
  const calls = [];

  const result = await runWithClient(['--config', configPath, 'projects', 'list', '--json'], {
    async listProjects(input) {
      calls.push(input);
      return [{ id: 10, name: 'varcad.io', hostName: 'clearbox' }];
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls[0].host, 'clearbox');
  assert.equal(JSON.parse(result.stdout)[0].name, 'varcad.io');
});

test('process ensure --wait returns process and wait result as JSON', async () => {
  const calls = [];
  const result = await runWithClient([
    'process',
    'ensure',
    '--host',
    'clearbox',
    '--project',
    'varcad.io',
    '--template',
    'docker-compose-web',
    '--wait',
    '--timeout-ms',
    '90000',
    '--json',
  ], {
    async ensureProcess(input) {
      calls.push({ method: 'ensureProcess', input });
      return { id: 55, processKey: 'docker-compose-web', packageKey: 'docker-compose-web' };
    },
    async waitForRuntime(input) {
      calls.push({ method: 'waitForRuntime', input });
      return { status: 'matched', elapsedMs: 20 };
    },
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.process.id, 55);
  assert.equal(payload.wait.status, 'matched');
  assert.equal(calls[0].input.host, 'clearbox');
  assert.equal(calls[0].input.template, 'docker-compose-web');
  assert.equal(calls[1].input.timeoutMs, 90000);
});

test('process ensure exits 2 when wait fails', async () => {
  const result = await runWithClient(['process', 'ensure', '--template', 'node.dev', '--wait', '--json'], {
    async ensureProcess() {
      return { id: 1, processKey: 'web', packageKey: 'web' };
    },
    async waitForRuntime() {
      return { status: 'timeout', elapsedMs: 1000 };
    },
  });

  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stdout).wait.status, 'timeout');
});

test('process kill commands route to commander-client with hard flag', async () => {
  const calls = [];
  const client = {
    async killProcess(input) {
      calls.push(input);
      return { status: 'queued', commandId: input.hard ? 'hard-1' : 'soft-1' };
    },
  };

  const soft = await runWithClient(['process', 'soft-kill', '--run-id', 'run-1', '--json'], client);
  const hard = await runWithClient(['process', 'hard-kill', '--run-id', 'run-2', '--json'], client);

  assert.equal(soft.exitCode, 0);
  assert.equal(hard.exitCode, 0);
  assert.equal(calls[0].runId, 'run-1');
  assert.equal(calls[0].hard, false);
  assert.equal(calls[1].runId, 'run-2');
  assert.equal(calls[1].hard, true);
});

test('process logs resolves run id before tailing logs', async () => {
  const calls = [];
  const result = await runWithClient(['process', 'logs', '--run-id', 'run-abc', '--json'], {
    async listObservedRuns(input) {
      calls.push({ method: 'listObservedRuns', input });
      return [{ runId: 'run-abc', hostId: 7, slaveId: 'slave-7', projectPath: '/srv/app' }];
    },
    async tailProcessLog(input) {
      calls.push({ method: 'tailProcessLog', input });
      return [{ id: 1, message: 'Ready', projectPath: '/srv/app' }];
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout)[0].message, 'Ready');
  assert.equal(calls[1].input.hostId, 7);
  assert.equal(calls[1].input.agentUuid, 'slave-7');
  assert.equal(calls[1].input.projectPath, '/srv/app');
});

test('authorization failures return exit code 3', async () => {
  const error = new Error('User is not authorized.');
  error.status = 403;
  const result = await runWithClient(['hosts', 'list'], {
    async listHosts() {
      throw error;
    },
  });

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /not authorized/i);
});

test('waitSucceeded recognizes successful and failed wait states', () => {
  assert.equal(waitSucceeded(null), true);
  assert.equal(waitSucceeded({ status: 'matched' }), true);
  assert.equal(waitSucceeded({ status: 'timeout' }), false);
});
