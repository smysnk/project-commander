import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..', '..');
const vendorDir = path.join(rootDir, 'references', 'test-station');
const vendorCli = path.join(vendorDir, 'bin', 'test-station.mjs');
const vendorInstallMarker = path.join(vendorDir, 'node_modules', '@test-station', 'core', 'package.json');
const pathFlags = new Set(['--config', '--input', '--output', '--output-dir']);

main();

function main() {
  ensureVendoredInstallation();
  const forwardedArgs = resolveRootRelativeArgs(process.argv.slice(2));
  const result = spawnSync('yarn', ['node', vendorCli, ...forwardedArgs], {
    cwd: vendorDir,
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

function ensureVendoredInstallation() {
  if (fs.existsSync(vendorInstallMarker)) {
    return;
  }

  const result = spawnSync('yarn', ['install', '--immutable'], {
    cwd: vendorDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveRootRelativeArgs(args) {
  const resolved = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    resolved.push(token);
    if (!pathFlags.has(token)) {
      continue;
    }
    const nextToken = args[index + 1];
    if (typeof nextToken !== 'string') {
      continue;
    }
    resolved.push(path.isAbsolute(nextToken) ? nextToken : path.resolve(rootDir, nextToken));
    index += 1;
  }
  return resolved;
}
