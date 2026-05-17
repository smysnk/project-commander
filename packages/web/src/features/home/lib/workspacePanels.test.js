const test = require('node:test');
const assert = require('node:assert/strict');

const loadWorkspacePanels = () => import('./workspacePanels.mjs');

test('normalizeWorkspacePanel accepts known panels and falls back to projects', async () => {
  const { normalizeWorkspacePanel } = await loadWorkspacePanels();

  assert.equal(normalizeWorkspacePanel('runtime'), 'runtime');
  assert.equal(normalizeWorkspacePanel(' LOGS '), 'logs');
  assert.equal(normalizeWorkspacePanel('unknown'), 'projects');
  assert.equal(normalizeWorkspacePanel(null), 'projects');
});

test('getWorkspacePanelFromLegacyState preserves stored active panel first', async () => {
  const { getWorkspacePanelFromLegacyState } = await loadWorkspacePanels();

  assert.equal(getWorkspacePanelFromLegacyState({
    activeWorkspacePanel: 'runtime',
    explorerMode: 'logs',
    panelMode: 'projects',
  }), 'runtime');
});

test('getWorkspacePanelFromLegacyState maps old split-pane state for storage migration', async () => {
  const { getWorkspacePanelFromLegacyState } = await loadWorkspacePanels();

  assert.equal(getWorkspacePanelFromLegacyState({ explorerMode: 'debug' }), 'debug');
  assert.equal(getWorkspacePanelFromLegacyState({ explorerMode: 'environment' }), 'environment');
  assert.equal(getWorkspacePanelFromLegacyState({ explorerMode: 'missing', panelMode: 'projects' }), 'projects');
  assert.equal(getWorkspacePanelFromLegacyState({ panelMode: 'runtime' }), 'hosts');
  assert.equal(getWorkspacePanelFromLegacyState({ panelMode: 'terminal' }), 'terminal');
  assert.equal(getWorkspacePanelFromLegacyState({}), 'projects');
});
