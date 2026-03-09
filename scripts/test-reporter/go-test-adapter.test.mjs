import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { deriveGoPackageRelativePath, parseGoEvents } from './go-test-adapter.mjs';

test('deriveGoPackageRelativePath resolves package paths beneath the suite package root', () => {
  assert.equal(
    deriveGoPackageRelativePath(
      'github.com/josh/project-commander/packages/agent-slave/cmd/pc-slave',
      'agent-slave',
    ),
    'cmd/pc-slave',
  );
  assert.equal(
    deriveGoPackageRelativePath(
      'github.com/josh/project-commander/packages/agent-master',
      'agent-master',
    ),
    '.',
  );
});

test('parseGoEvents ignores no-test-file packages and returns normalized test results', () => {
  const workspaceDir = path.resolve('/repo/packages/agent-master');
  const parsed = parseGoEvents([
    {
      Action: 'output',
      Package: 'github.com/josh/project-commander/packages/agent-master/internal/master',
      Output: '?   \tgithub.com/josh/project-commander/packages/agent-master/internal/master\t[no test files]\n',
    },
    {
      Action: 'skip',
      Package: 'github.com/josh/project-commander/packages/agent-master/internal/master',
      Elapsed: 0,
    },
    {
      Action: 'run',
      Package: 'github.com/josh/project-commander/packages/agent-master/cmd/pc-master',
      Test: 'TestParseLogLevel',
    },
    {
      Action: 'output',
      Package: 'github.com/josh/project-commander/packages/agent-master/cmd/pc-master',
      Test: 'TestParseLogLevel',
      Output: 'main_test.go:17: observed detail\n',
    },
    {
      Action: 'pass',
      Package: 'github.com/josh/project-commander/packages/agent-master/cmd/pc-master',
      Test: 'TestParseLogLevel',
      Elapsed: 0.01,
    },
  ], workspaceDir, 'agent-master');

  assert.deepEqual(parsed.summary, {
    total: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
  });
  assert.equal(parsed.tests.length, 1);
  assert.equal(parsed.tests[0].status, 'passed');
  assert.equal(parsed.tests[0].fullName, 'cmd/pc-master TestParseLogLevel');
  assert.equal(parsed.tests[0].file, path.resolve(workspaceDir, 'cmd/pc-master', 'main_test.go'));
  assert.equal(parsed.tests[0].line, 17);
  assert.equal(parsed.warnings[0], 'Go package internal/master has no test files.');
});

test('parseGoEvents synthesizes a package failure when go test fails before a test result exists', () => {
  const workspaceDir = path.resolve('/repo/packages/agent-slave');
  const parsed = parseGoEvents([
    {
      Action: 'output',
      Package: 'github.com/josh/project-commander/packages/agent-slave/cmd/pc-slave',
      Output: '# github.com/josh/project-commander/packages/agent-slave/cmd/pc-slave\n',
    },
    {
      Action: 'output',
      Package: 'github.com/josh/project-commander/packages/agent-slave/cmd/pc-slave',
      Output: 'checkout.go:12:2: undefined: broken\n',
    },
    {
      Action: 'fail',
      Package: 'github.com/josh/project-commander/packages/agent-slave/cmd/pc-slave',
      Elapsed: 0.02,
    },
  ], workspaceDir, 'agent-slave');

  assert.deepEqual(parsed.summary, {
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
  });
  assert.equal(parsed.tests.length, 1);
  assert.equal(parsed.tests[0].status, 'failed');
  assert.match(parsed.tests[0].failureMessages[0], /undefined: broken/);
});
