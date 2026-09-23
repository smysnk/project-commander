'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { graphqlRequest } from '../../../../lib/graphqlClient';
import {
  MUTATION_DELETE_HOST_SSH_KEY_CONFIG,
  MUTATION_UPSERT_HOST_SSH_KEY_CONFIG,
  QUERY_HOST_SSH_KEY_CONFIG,
} from '../../graphql/documents';
import {
  selectIsMasterSidebarSelected,
  selectSelectedHost,
} from '../../store/selectors';

const DEFAULT_KEY_NAME = 'default';

const getHostLabel = (host) => (
  String(host?.name || host?.hostName || host?.ip || '').trim() || 'No host selected'
);

const emptyDraft = {
  keyName: DEFAULT_KEY_NAME,
  privateKey: '',
  publicKey: '',
  knownHosts: '',
  strictHostKeyChecking: true,
};

export default function ConfigPanel() {
  const selectedHost = useSelector(selectSelectedHost);
  const isMasterSidebarSelected = useSelector(selectIsMasterSidebarSelected);
  const hostId = Number(selectedHost?.id);
  const hasHost = Number.isInteger(hostId) && hostId > 0 && !isMasterSidebarSelected;
  const [sshConfig, setSshConfig] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const hostLabel = useMemo(() => getHostLabel(selectedHost), [selectedHost]);

  const loadConfig = useCallback(async () => {
    if (!hasHost) {
      setSshConfig(null);
      setDraft(emptyDraft);
      setMessage('');
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await graphqlRequest({
        query: QUERY_HOST_SSH_KEY_CONFIG,
        variables: { hostId },
      });
      const nextConfig = data?.hostSshKeyConfig || null;
      setSshConfig(nextConfig);
      setDraft({
        keyName: nextConfig?.keyName || DEFAULT_KEY_NAME,
        privateKey: '',
        publicKey: nextConfig?.publicKey || '',
        knownHosts: nextConfig?.knownHosts || '',
        strictHostKeyChecking: nextConfig?.strictHostKeyChecking !== false,
      });
    } catch (loadError) {
      setError(loadError.message || 'Unable to load host SSH key config.');
    } finally {
      setLoading(false);
    }
  }, [hasHost, hostId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const updateDraft = useCallback((field, value) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  const onSave = useCallback(async () => {
    if (!hasHost) {
      setError('Select a host before saving SSH checkout config.');
      return;
    }
    const privateKey = String(draft.privateKey || '').trim();
    if (!privateKey) {
      setError('Paste an unencrypted private SSH key before saving. Existing private keys are not displayed and must be re-entered to rotate.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const data = await graphqlRequest({
        query: MUTATION_UPSERT_HOST_SSH_KEY_CONFIG,
        variables: {
          hostId,
          keyName: String(draft.keyName || DEFAULT_KEY_NAME).trim() || DEFAULT_KEY_NAME,
          privateKey,
          publicKey: String(draft.publicKey || '').trim() || null,
          passphrase: null,
          knownHosts: String(draft.knownHosts || '').trim() || null,
          strictHostKeyChecking: Boolean(draft.strictHostKeyChecking),
        },
      });
      const nextConfig = data?.upsertHostSshKeyConfig || null;
      setSshConfig(nextConfig);
      setDraft((current) => ({
        ...current,
        privateKey: '',
        keyName: nextConfig?.keyName || current.keyName || DEFAULT_KEY_NAME,
        publicKey: nextConfig?.publicKey || current.publicKey || '',
        knownHosts: nextConfig?.knownHosts || current.knownHosts || '',
        strictHostKeyChecking: nextConfig?.strictHostKeyChecking !== false,
      }));
      setMessage('SSH checkout key saved for this host.');
    } catch (saveError) {
      setError(saveError.message || 'Unable to save host SSH key config.');
    } finally {
      setSaving(false);
    }
  }, [draft, hasHost, hostId]);

  const onDelete = useCallback(async () => {
    if (!hasHost) {
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await graphqlRequest({
        query: MUTATION_DELETE_HOST_SSH_KEY_CONFIG,
        variables: {
          hostId,
          keyName: String(draft.keyName || sshConfig?.keyName || DEFAULT_KEY_NAME).trim() || DEFAULT_KEY_NAME,
        },
      });
      setSshConfig(null);
      setDraft(emptyDraft);
      setMessage('SSH checkout key removed for this host.');
    } catch (deleteError) {
      setError(deleteError.message || 'Unable to delete host SSH key config.');
    } finally {
      setSaving(false);
    }
  }, [draft.keyName, hasHost, hostId, sshConfig?.keyName]);

  return (
    <div className="configPanel">
      <div className="panelHeaderBlock">
        <span className="panelEyebrow">Host Config</span>
        <h2>Remote checkout SSH key</h2>
        <p>
          Configure a host-scoped private SSH key for agent-side git checkouts.
          The key is stored server-side and is not displayed after saving.
        </p>
      </div>

      {!hasHost ? (
        <p className="emptyState">Select a slave host to configure remote checkout credentials.</p>
      ) : (
        <div className="configForm">
          <div className="configSummaryGrid">
            <div>
              <span className="configLabel">Host</span>
              <strong>{hostLabel}</strong>
            </div>
            <div>
              <span className="configLabel">Configured</span>
              <strong>{sshConfig?.hasPrivateKey ? 'Yes' : 'No'}</strong>
            </div>
            <div>
              <span className="configLabel">Fingerprint</span>
              <strong>{sshConfig?.fingerprint || '-'}</strong>
            </div>
            <div>
              <span className="configLabel">Updated</span>
              <strong>{sshConfig?.updatedAt ? new Date(sshConfig.updatedAt).toLocaleString() : '-'}</strong>
            </div>
          </div>

          <label className="configField">
            <span>Key name</span>
            <input
              type="text"
              value={draft.keyName}
              onChange={(event) => updateDraft('keyName', event.target.value)}
              disabled={saving || loading}
              placeholder="default"
            />
          </label>

          <label className="configField">
            <span>Private SSH key</span>
            <textarea
              value={draft.privateKey}
              onChange={(event) => updateDraft('privateKey', event.target.value)}
              disabled={saving || loading}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              rows={9}
              spellCheck={false}
            />
            <small>Required when saving. Existing private key material is intentionally never returned to the browser.</small>
          </label>

          <label className="configField">
            <span>Public key (optional)</span>
            <textarea
              value={draft.publicKey}
              onChange={(event) => updateDraft('publicKey', event.target.value)}
              disabled={saving || loading}
              placeholder="ssh-ed25519 AAAA..."
              rows={3}
              spellCheck={false}
            />
          </label>

          <label className="configField">
            <span>known_hosts (optional)</span>
            <textarea
              value={draft.knownHosts}
              onChange={(event) => updateDraft('knownHosts', event.target.value)}
              disabled={saving || loading}
              placeholder="github.com ssh-ed25519 AAAA..."
              rows={4}
              spellCheck={false}
            />
          </label>

          <label className="configCheckboxRow">
            <input
              type="checkbox"
              checked={draft.strictHostKeyChecking}
              onChange={(event) => updateDraft('strictHostKeyChecking', event.target.checked)}
              disabled={saving || loading}
            />
            <span>Require strict host key checking when known_hosts is provided</span>
          </label>

          {error ? <p className="configMessage error">{error}</p> : null}
          {message ? <p className="configMessage success">{message}</p> : null}

          <div className="configActions">
            <button type="button" className="primaryActionButton" onClick={onSave} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save SSH Key'}
            </button>
            <button type="button" className="secondaryActionButton" onClick={loadConfig} disabled={saving || loading}>
              Refresh
            </button>
            <button type="button" className="dangerActionButton" onClick={onDelete} disabled={saving || loading || !sshConfig?.hasPrivateKey}>
              Delete Key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
