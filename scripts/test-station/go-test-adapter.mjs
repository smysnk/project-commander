import path from 'node:path';
import { spawn } from 'node:child_process';

export const id = 'go-test';
export const description = 'Go test adapter';

export function createAdapter() {
  return {
    id,
    description,
    phase: 3,
    async run({ project, suite, execution }) {
      const commandSpec = parseCommandSpec(suite.command);
      const slug = `${slugify(suite.packageName || 'default')}-${slugify(suite.id)}`;
      const commandExecution = await spawnCommand(commandSpec.command, commandSpec.args, {
        cwd: suite.cwd || project.rootDir,
        env: resolveSuiteEnv(suite.env),
      });
      const parsed = parseGoEvents(parseNdjson(commandExecution.stdout), suite.cwd || project.rootDir, suite.packageName);
      const warnings = [...parsed.warnings];

      if (execution?.coverage && suite?.coverage?.enabled !== false) {
        warnings.push('Go coverage is not implemented yet for the local go-test adapter.');
      }

      return {
        status: deriveSuiteStatus(parsed.summary, commandExecution.exitCode),
        durationMs: commandExecution.durationMs,
        summary: parsed.summary,
        coverage: null,
        tests: parsed.tests,
        warnings,
        output: {
          stdout: commandExecution.stdout,
          stderr: commandExecution.stderr,
        },
        rawArtifacts: [
          {
            relativePath: `${slug}-go-test.ndjson`,
            content: commandExecution.stdout,
          },
          {
            relativePath: `${slug}-go-test.json`,
            content: JSON.stringify({
              summary: parsed.summary,
              warnings,
              tests: parsed.tests,
            }, null, 2),
          },
        ],
      };
    },
  };
}

export function parseGoEvents(events, workspaceDir, suitePackageName = '') {
  const testsByKey = new Map();
  const packageStates = new Map();
  const warnings = [];

  for (const event of events) {
    if (!event || typeof event !== 'object') {
      continue;
    }
    const packageImportPath = normalizeString(event.Package);
    if (!packageImportPath) {
      continue;
    }
    const packageState = ensurePackageState(packageStates, packageImportPath, workspaceDir, suitePackageName);
    const action = normalizeString(event.Action).toLowerCase();
    const testName = normalizeString(event.Test);

    if (action === 'output') {
      const line = typeof event.Output === 'string' ? event.Output : '';
      if (testName) {
        const testState = ensureTestState(testsByKey, packageState, testName);
        testState.outputLines.push(line);
      } else {
        packageState.outputLines.push(line);
        if (/\[no test files\]/.test(line)) {
          packageState.packageNoTestFiles = true;
        }
      }
      continue;
    }

    if (testName) {
      const testState = ensureTestState(testsByKey, packageState, testName);
      if (action === 'pass' || action === 'fail' || action === 'skip') {
        testState.status = normalizeGoStatus(action);
        testState.durationMs = normalizeElapsedMs(event.Elapsed);
      }
      continue;
    }

    if (action === 'pass' || action === 'fail' || action === 'skip') {
      packageState.status = normalizeGoStatus(action);
      packageState.durationMs = normalizeElapsedMs(event.Elapsed);
    }
  }

  const tests = Array.from(testsByKey.values())
    .map((testState) => finalizeGoTestResult(testState, workspaceDir))
    .filter(Boolean);

  const packagesWithTests = new Set(
    tests
      .map((test) => test.rawDetails?.packageImportPath || null)
      .filter(Boolean),
  );
  for (const packageState of packageStates.values()) {
    if (packageState.status !== 'failed') {
      continue;
    }
    if (packagesWithTests.has(packageState.packageImportPath)) {
      continue;
    }

    const packageFailureOutput = cleanGoOutput(packageState.outputLines);
    tests.push({
      name: `${packageState.packageRelativePath} package test run`,
      fullName: `${packageState.packageLabel} package test run`,
      status: 'failed',
      durationMs: packageState.durationMs,
      file: null,
      line: null,
      column: null,
      failureMessages: packageFailureOutput
        ? [trimForReport(packageFailureOutput, 1000)]
        : [`go test failed for ${packageState.packageLabel}`],
      assertions: [],
      setup: [],
      mocks: [],
      rawDetails: {
        packageImportPath: packageState.packageImportPath,
        packageRelativePath: packageState.packageRelativePath,
        output: trimForReport(packageFailureOutput, 4000),
      },
    });
  }

  for (const packageState of packageStates.values()) {
    if (packageState.packageNoTestFiles) {
      warnings.push(`Go package ${packageState.packageLabel} has no test files.`);
    }
  }

  const summary = summarizeTests(tests);
  return {
    summary,
    tests: tests.sort(sortTests),
    warnings: Array.from(new Set(warnings)),
  };
}

function ensurePackageState(packageStates, packageImportPath, workspaceDir, suitePackageName) {
  if (!packageStates.has(packageImportPath)) {
    const packageRelativePath = deriveGoPackageRelativePath(packageImportPath, suitePackageName);
    packageStates.set(packageImportPath, {
      packageImportPath,
      packageRelativePath,
      packageDir: packageRelativePath === '.'
        ? path.resolve(workspaceDir)
        : path.resolve(workspaceDir, packageRelativePath),
      packageLabel: packageRelativePath === '.'
        ? suitePackageName || path.basename(workspaceDir)
        : packageRelativePath,
      status: null,
      durationMs: 0,
      outputLines: [],
      packageNoTestFiles: false,
    });
  }
  const state = packageStates.get(packageImportPath);
  if (state.outputLines.some((line) => /\[no test files\]/.test(line))) {
    state.packageNoTestFiles = true;
  }
  return state;
}

function ensureTestState(testsByKey, packageState, testName) {
  const key = `${packageState.packageImportPath}::${testName}`;
  if (!testsByKey.has(key)) {
    testsByKey.set(key, {
      packageImportPath: packageState.packageImportPath,
      packageRelativePath: packageState.packageRelativePath,
      packageDir: packageState.packageDir,
      packageLabel: packageState.packageLabel,
      testName,
      outputLines: [],
      status: null,
      durationMs: 0,
    });
  }
  return testsByKey.get(key);
}

function finalizeGoTestResult(testState) {
  const status = normalizeStatus(testState.status || 'skipped');
  const cleanedOutput = cleanGoOutput(testState.outputLines);
  const sourceLocation = extractGoSourceLocation(cleanedOutput, testState.packageDir);
  return {
    name: testState.testName,
    fullName: `${testState.packageLabel} ${testState.testName}`,
    status,
    durationMs: testState.durationMs,
    file: sourceLocation.file,
    line: sourceLocation.line,
    column: null,
    failureMessages: status === 'failed'
      ? extractFailureMessages(cleanedOutput)
      : [],
    assertions: [],
    setup: [],
    mocks: [],
    rawDetails: {
      packageImportPath: testState.packageImportPath,
      packageRelativePath: testState.packageRelativePath,
      output: trimForReport(cleanedOutput, 4000),
    },
  };
}

function extractFailureMessages(cleanedOutput) {
  const lines = cleanedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return ['go test reported failure'];
  }
  return Array.from(new Set(lines.map((line) => trimForReport(line, 400))));
}

function extractGoSourceLocation(cleanedOutput, packageDir) {
  const match = cleanedOutput.match(/(^|\n)([^:\n]+\.go):(\d+):/);
  if (!match) {
    return {
      file: null,
      line: null,
    };
  }
  const candidateFile = match[2];
  return {
    file: path.resolve(packageDir, candidateFile),
    line: Number.parseInt(match[3], 10) || null,
  };
}

function cleanGoOutput(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || ''))
    .filter((line) => !/^=== (RUN|PAUSE|CONT)\s+/.test(line))
    .filter((line) => !/^--- (PASS|FAIL|SKIP): /.test(line))
    .filter((line) => !/^(PASS|FAIL)\s*$/.test(line.trim()))
    .filter((line) => !/^ok\s+\S+/.test(line.trim()))
    .filter((line) => !/^\?\s+\S+\s+\[no test files\]/.test(line.trim()))
    .join('')
    .trim();
}

function parseCommandSpec(command) {
  if (Array.isArray(command) && command.length > 0) {
    return {
      command: String(command[0]),
      args: command.slice(1).map((entry) => String(entry)),
    };
  }
  if (typeof command === 'string' && command.trim().length > 0) {
    const tokens = tokenizeCommand(command);
    return {
      command: tokens[0],
      args: tokens.slice(1),
    };
  }
  throw new Error('go-test adapter requires suite.command as a non-empty string or array.');
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        current += command[index + 1];
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function spawnCommand(command, args, options) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      stderr += `${error.message}\n`;
      resolve({
        exitCode: 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (code) => {
      resolve({
        exitCode: Number.isInteger(code) ? code : 1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function parseNdjson(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function deriveGoPackageRelativePath(importPath, suitePackageName) {
  const normalizedImportPath = normalizeString(importPath);
  const normalizedSuitePackageName = normalizeString(suitePackageName);
  if (!normalizedImportPath || !normalizedSuitePackageName) {
    return '.';
  }
  const marker = `/packages/${normalizedSuitePackageName}`;
  const markerIndex = normalizedImportPath.indexOf(marker);
  if (markerIndex === -1) {
    return '.';
  }
  const remaining = normalizedImportPath.slice(markerIndex + marker.length).replace(/^\/+/, '');
  return remaining ? remaining : '.';
}

function summarizeTests(tests) {
  return {
    total: tests.length,
    passed: tests.filter((test) => test.status === 'passed').length,
    failed: tests.filter((test) => test.status === 'failed').length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
  };
}

function deriveSuiteStatus(summary, exitCode) {
  if (exitCode !== 0 || summary.failed > 0) {
    return 'failed';
  }
  if (summary.total === 0 || summary.skipped === summary.total) {
    return 'skipped';
  }
  return 'passed';
}

function sortTests(left, right) {
  const leftFile = left.file || '';
  const rightFile = right.file || '';
  if (leftFile !== rightFile) {
    return leftFile.localeCompare(rightFile);
  }
  if ((left.line || 0) !== (right.line || 0)) {
    return (left.line || 0) - (right.line || 0);
  }
  return left.fullName.localeCompare(right.fullName);
}

function normalizeGoStatus(action) {
  if (action === 'pass') {
    return 'passed';
  }
  if (action === 'skip') {
    return 'skipped';
  }
  return 'failed';
}

function normalizeStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'skipped') return 'skipped';
  return 'failed';
}

function normalizeElapsedMs(elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds)) {
    return 0;
  }
  return Math.max(0, Math.round(Number(elapsedSeconds) * 1000));
}

function trimForReport(value, limit) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeEnv(env) {
  const nextEnv = { ...env };
  delete nextEnv.NODE_TEST_CONTEXT;
  return nextEnv;
}

function resolveSuiteEnv(suiteEnv) {
  return {
    ...sanitizeEnv(process.env),
    ...normalizeEnvRecord(suiteEnv),
  };
}

function normalizeEnvRecord(env) {
  if (!env || typeof env !== 'object') {
    return {};
  }
  const normalized = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) {
      continue;
    }
    normalized[key] = String(value);
  }
  return normalized;
}

function normalizeString(value) {
  return String(value || '').trim();
}
