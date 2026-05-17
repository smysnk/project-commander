const { test, expect } = require('@playwright/test');
const { selectWorkspacePanel } = require('./helpers/workspacePanels');

const DEFAULT_APP_URL = 'http://localhost:3000';
const RUN_LIVE_MANAGED_PROCESS = String(process.env.PLAYWRIGHT_LIVE_MANAGED_PROCESS || '').trim() === '1';
const LIVE_HOST_MATCH = String(process.env.PLAYWRIGHT_LIVE_MANAGED_HOST_MATCH || 'localhost|127\\.0\\.0\\.1|mac').trim();

test.setTimeout(180_000);

async function gotoLiveApp(page, baseURL) {
  const appUrl = process.env.PLAYWRIGHT_BASE_URL || baseURL || DEFAULT_APP_URL;

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  } catch {
    test.skip(true, `App server is unavailable at ${appUrl}. Set PLAYWRIGHT_BASE_URL or run the web app before running this live test.`);
    return null;
  }

  try {
    await expect(page.locator('.appShell')).toBeVisible({ timeout: 5_000 });
  } catch {
    test.skip(true, `Project Commander UI shell is unavailable at ${appUrl}.`);
    return null;
  }

  return appUrl;
}

async function openRuntimeForLiveHost(page) {
  await selectWorkspacePanel(page, 'Hosts');
  const hostPattern = new RegExp(LIVE_HOST_MATCH, 'i');
  const hostCard = page.locator('.hostList .hostCard').filter({ hasText: hostPattern }).first();
  test.skip(await hostCard.count() === 0, `No host card matched /${LIVE_HOST_MATCH}/. Set PLAYWRIGHT_LIVE_MANAGED_HOST_MATCH.`);

  await hostCard.click();
  await selectWorkspacePanel(page, 'Runtime');

  const runtimePanel = page.locator('.runtimePanel');
  await expect(runtimePanel).toContainText('Selected Slave Agent');
  await expect(runtimePanel).toContainText(/Desired Processes|Observed Runs/);
  return { hostCard, runtimePanel };
}

async function selectFirstProject(runtimePanel) {
  const projectSelect = runtimePanel.getByLabel('Project');
  const options = await projectSelect.locator('option').evaluateAll((nodes) => nodes.map((node) => ({
    value: node.value,
    disabled: node.disabled,
  })));
  const projectOption = options.find((option) => option.value && !option.disabled);
  test.skip(!projectOption, 'Selected host does not expose any projects to attach a managed process to.');
  await projectSelect.selectOption(projectOption.value);
}

async function createManagedProcess(runtimePanel, suffix, command) {
  const desiredSection = runtimePanel.locator('.runtimeProcessSection').nth(0);
  const observedSection = runtimePanel.locator('.runtimeProcessSection').nth(1);
  const packageKey = `live-${suffix}`;
  const processKey = `live-${suffix}`;

  await runtimePanel.getByRole('button', { name: 'Add Managed Process' }).click();
  await selectFirstProject(runtimePanel);
  await runtimePanel.getByLabel('Package Key').fill(packageKey);
  await runtimePanel.getByLabel('Process Key').fill(processKey);
  await runtimePanel.getByLabel('Launch Mode').selectOption('shell');
  await runtimePanel.getByLabel('Restart Policy').selectOption('manual');
  await runtimePanel.getByLabel('Command').fill(command);
  await runtimePanel.getByLabel('Args (one per line)').fill('');
  await runtimePanel.getByLabel('Env (KEY=VALUE per line)').fill('');
  await runtimePanel.getByRole('button', { name: 'Ensure Desired Process' }).click();

  const desiredRow = desiredSection.locator('.runtimeProcessRow').filter({ hasText: processKey }).first();
  const observedRow = observedSection.locator('.runtimeProcessRow').filter({ hasText: processKey }).first();
  await expect(desiredRow).toBeVisible({ timeout: 30_000 });
  await expect(observedRow).toBeVisible({ timeout: 30_000 });
  return { packageKey, processKey, desiredRow, observedRow };
}

async function deleteDesiredProcess(runtimePanel, processKey) {
  const desiredSection = runtimePanel.locator('.runtimeProcessSection').nth(0);
  const desiredRow = desiredSection.locator('.runtimeProcessRow').filter({ hasText: processKey }).first();
  if (await desiredRow.count()) {
    await desiredRow.getByRole('button', { name: 'Delete' }).click();
    await expect(desiredRow).toHaveCount(0, { timeout: 30_000 });
  }
}

async function waitForLogMarker(page, marker) {
  const logPanel = page.locator('.logPanel');
  await expect(logPanel).toContainText(marker, { timeout: 30_000 });
}

test('live managed process runtime flow: create, tail logs, soft kill, hard kill', async ({ page, baseURL }) => {
  test.skip(!RUN_LIVE_MANAGED_PROCESS, 'Set PLAYWRIGHT_LIVE_MANAGED_PROCESS=1 to run this live managed-process test.');

  const appUrl = await gotoLiveApp(page, baseURL);
  if (!appUrl) {
    return;
  }

  const { runtimePanel } = await openRuntimeForLiveHost(page);
  const suffixBase = Date.now().toString(36);

  const softStartMarker = `pc-live-soft-start-${suffixBase}`;
  const softStopMarker = `pc-live-soft-stop-${suffixBase}`;
  const softCommand = [
    `printf '${softStartMarker}\\n'`,
    `trap \"printf '${softStopMarker}\\\\n'; exit 0\" TERM`,
    'while true; do sleep 1; done',
  ].join('; ');
  const softProcess = await createManagedProcess(runtimePanel, `${suffixBase}-soft`, softCommand);

  await softProcess.observedRow.getByRole('button', { name: 'Logs' }).click();
  await waitForLogMarker(page, softStartMarker);

  await selectWorkspacePanel(page, 'Runtime');
  await softProcess.observedRow.getByRole('button', { name: 'Soft Kill' }).click();
  await selectWorkspacePanel(page, 'Logs');
  await waitForLogMarker(page, softStopMarker);

  await selectWorkspacePanel(page, 'Runtime');
  await deleteDesiredProcess(runtimePanel, softProcess.processKey);

  const hardStartMarker = `pc-live-hard-start-${suffixBase}`;
  const hardCommand = [
    `printf '${hardStartMarker}\\n'`,
    "trap '' TERM",
    'while true; do sleep 1; done',
  ].join('; ');
  const hardProcess = await createManagedProcess(runtimePanel, `${suffixBase}-hard`, hardCommand);

  await hardProcess.observedRow.getByRole('button', { name: 'Logs' }).click();
  await waitForLogMarker(page, hardStartMarker);

  await selectWorkspacePanel(page, 'Runtime');
  await hardProcess.observedRow.getByRole('button', { name: 'Hard Kill' }).click();
  await deleteDesiredProcess(runtimePanel, hardProcess.processKey);
  await expect(hardProcess.observedRow).toHaveCount(0, { timeout: 30_000 });
});
