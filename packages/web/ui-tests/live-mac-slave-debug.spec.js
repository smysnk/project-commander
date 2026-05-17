const { test, expect } = require('@playwright/test');
const { selectWorkspacePanel } = require('./helpers/workspacePanels');

const DEFAULT_APP_URL = 'http://localhost:3000';
const RUN_LIVE_DEBUG = String(process.env.PLAYWRIGHT_LIVE_MAC_DEBUG || '').trim() === '1';
const LIVE_HOST_MATCH = String(process.env.PLAYWRIGHT_LIVE_HOST_MATCH || '127.0.0.1|localhost|mac').trim();

test('live mac slave debug: local host shows socket target, no port row, and project count', async ({
  page,
  baseURL,
}) => {
  test.skip(!RUN_LIVE_DEBUG, 'Set PLAYWRIGHT_LIVE_MAC_DEBUG=1 to run this temporary live debug e2e.');

  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run web app before test.`);
    return;
  }

  try {
    await expect(page.locator('.appShell')).toBeVisible({ timeout: 3_000 });
  } catch {
    test.skip(true, `Project Commander UI shell is unavailable at ${appUrl}.`);
    return;
  }

  await selectWorkspacePanel(page, 'Hosts');

  const anyHostCard = page.locator('.hostList .hostCard');
  try {
    await anyHostCard.first().waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    // handled by skip below
  }

  const hostPattern = new RegExp(LIVE_HOST_MATCH, 'i');
  const hostCard = page.locator('.hostList .hostCard').filter({ hasText: hostPattern }).first();
  const hostCardCount = await hostCard.count();
  test.skip(hostCardCount === 0, `No host card matched /${LIVE_HOST_MATCH}/. Update PLAYWRIGHT_LIVE_HOST_MATCH.`);

  await hostCard.click();
  await expect(hostCard).toContainText('Target');
  await expect(hostCard).not.toContainText('Port');

  const targetValue = hostCard.locator('.hostFieldItem', {
    has: page.locator('.hostFieldLabel', { hasText: 'Target' }),
  }).locator('.hostFieldValue').first();
  await expect(targetValue).toContainText('/');

  await expect(hostCard).toContainText('Projects');
  const projectsValue = hostCard.locator('.hostFieldItem', {
    has: page.locator('.hostFieldLabel', { hasText: 'Projects' }),
  }).locator('.hostFieldValue').first();
  await expect(projectsValue).toContainText(/\d+\s+detected/i);

  const projectCountText = (await projectsValue.textContent()) || '';
  const projectCount = Number.parseInt(projectCountText, 10);
  expect(Number.isInteger(projectCount) && projectCount > 0).toBeTruthy();
});
