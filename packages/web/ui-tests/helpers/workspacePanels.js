const { expect } = require('@playwright/test');

const WORKSPACE_PANEL_LABELS = ['Projects', 'Hosts', 'Logs', 'Runtime', 'Terminal', 'Environment', 'Top', 'Debug'];

async function selectWorkspacePanel(page, label) {
  const button = page.locator('.workspacePanelNav').getByRole('button', { name: label, exact: true });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-current')) === 'page') {
    return button;
  }
  await expect.poll(async () => {
    await button.click();
    return await button.getAttribute('aria-current');
  }, {
    intervals: [100, 250, 500, 1_000],
    timeout: 5_000,
  }).toBe('page');
  return button;
}

async function expectSingleWorkspacePanel(page, activePanel) {
  const viewport = page.locator('.workspacePanelViewport');
  await expect(viewport).toBeVisible();
  await expect(viewport).toHaveAttribute('data-active-panel', activePanel);
  await expect(page.locator('.workspacePanelViewport > *')).toHaveCount(1);
  await expect(page.getByTestId('sidebar-divider')).toHaveCount(0);
  await expect(page.getByTestId('content-divider')).toHaveCount(0);
  await expect(page.locator('.divider')).toHaveCount(0);
}

module.exports = {
  WORKSPACE_PANEL_LABELS,
  expectSingleWorkspacePanel,
  selectWorkspacePanel,
};
