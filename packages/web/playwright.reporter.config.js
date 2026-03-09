const { defineConfig } = require('@playwright/test');

function resolveReporterPort() {
  const explicitPort = Number.parseInt(String(process.env.PLAYWRIGHT_WEB_PORT || '').trim(), 10);
  if (Number.isInteger(explicitPort) && explicitPort > 0) {
    return explicitPort;
  }

  const explicitBaseUrl = String(process.env.PLAYWRIGHT_BASE_URL || '').trim();
  if (explicitBaseUrl) {
    try {
      const url = new URL(explicitBaseUrl);
      const parsedPort = Number.parseInt(url.port, 10);
      if (Number.isInteger(parsedPort) && parsedPort > 0) {
        return parsedPort;
      }
      return url.protocol === 'https:' ? 443 : 80;
    } catch {
      // fall back to the reporter-specific port below
    }
  }

  return 3100;
}

const webPort = resolveReporterPort();
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${webPort}`;

module.exports = defineConfig({
  testDir: './ui-tests',
  testIgnore: ['**/live-*.spec.js'],
  timeout: 30_000,
  workers: 1,
  retries: 0,
  webServer: {
    command: 'yarn run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      WEB_PORT: String(webPort),
    },
  },
  use: {
    baseURL,
    headless: true,
  },
});
