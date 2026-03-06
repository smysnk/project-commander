const { defineConfig } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

module.exports = defineConfig({
  testDir: './ui-tests',
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    headless: true,
  },
});
