#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const args = new Set(process.argv.slice(2));
const printOnly = args.has('--print');
const quiet = args.has('--quiet');
const injectedVersion = String(
  process.env.PROJECT_COMMANDER_BUILD_VERSION || process.env.BUILD_VERSION || '',
).trim();

const packageJsonPaths = [
  path.join(repoRoot, 'package.json'),
  path.join(repoRoot, 'packages/agent-master/package.json'),
  path.join(repoRoot, 'packages/agent-shared/package.json'),
  path.join(repoRoot, 'packages/agent-slave/package.json'),
  path.join(repoRoot, 'packages/commander-client/package.json'),
  path.join(repoRoot, 'packages/commander-mcp/package.json'),
  path.join(repoRoot, 'packages/pcctl/package.json'),
  path.join(repoRoot, 'packages/server/package.json'),
  path.join(repoRoot, 'packages/web/package.json'),
];

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse JSON from ${filePath}: ${error.message}`);
  }
};

const writeJson = (filePath, value) => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
};

const tryExecGit = (gitArgs) => {
  try {
    return execFileSync(
      'git',
      gitArgs,
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
  } catch (error) {
    return null;
  }
};

const resolveBranchName = () => tryExecGit(['branch', '--show-current']) || 'HEAD';

const resolveCommitCount = () => {
  const raw = tryExecGit(['rev-list', '--count', 'HEAD']);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unable to resolve git commit count from "${raw}"`);
  }
  return parsed;
};

const resolveBaseVersion = () => {
  const rootPackage = readJson(packageJsonPaths[0]);
  const raw = String(rootPackage.version || '').trim();
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`Root package.json version must be semver-like, received "${raw || '<empty>'}"`);
  }
  return {
    major: match[1],
    minor: match[2],
    patch: match[3],
  };
};

const baseVersion = resolveBaseVersion();
const inferredCommitCount = resolveCommitCount();
const branchName = injectedVersion ? 'env' : resolveBranchName();
const commitCount = injectedVersion ? null : inferredCommitCount;
const computedVersion = injectedVersion
  || (
    commitCount
      ? `${baseVersion.major}.${baseVersion.minor}.${commitCount}`
      : `${baseVersion.major}.${baseVersion.minor}.${baseVersion.patch || '0'}`
  );

if (!printOnly) {
  for (const packageJsonPath of packageJsonPaths) {
    const manifest = readJson(packageJsonPath);
    if (manifest.version === computedVersion) {
      continue;
    }
    manifest.version = computedVersion;
    writeJson(packageJsonPath, manifest);
  }
}

if (quiet || printOnly) {
  process.stdout.write(`${computedVersion}\n`);
} else {
  process.stdout.write(
    `synced workspace package versions to ${computedVersion} (branch ${branchName}, commits ${commitCount ?? 'n/a'})\n`,
  );
}
