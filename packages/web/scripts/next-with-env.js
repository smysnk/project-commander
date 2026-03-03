const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

const mode = String(process.argv[2] || '').trim().toLowerCase();
if (mode !== 'dev' && mode !== 'start') {
  console.error(`Unsupported mode "${mode}". Use "dev" or "start".`);
  process.exit(1);
}

dotenv.config({
  path: path.resolve(__dirname, '../../../.env'),
  override: true,
});

const port = Number.parseInt(String(process.env.WEB_PORT || '').trim(), 10);
const normalizedPort = Number.isInteger(port) && port > 0 ? String(port) : '3000';

const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, mode, '-p', normalizedPort], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(Number.isInteger(code) ? code : 0);
});
