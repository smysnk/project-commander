const crypto = require('crypto');
const { Host, HostSshKeyConfig } = require('./models');

const DEFAULT_KEY_NAME = 'default';

const normalizeString = (value) => String(value || '').trim();

const normalizePrivateKey = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (!normalized.includes('PRIVATE KEY')) {
    throw new Error('Private key must be an OpenSSH/PEM private key block.');
  }
  return `${normalized.replace(/\r\n/g, '\n')}\n`;
};

const buildFingerprint = ({ publicKey, privateKey } = {}) => {
  const source = normalizeString(publicKey) || normalizeString(privateKey);
  if (!source) {
    return null;
  }
  const digest = crypto.createHash('sha256').update(source).digest('base64').replace(/=+$/g, '');
  return `SHA256:${digest}`;
};

const toPlainRecord = (value) => (
  value && typeof value.get === 'function'
    ? value.get({ plain: true })
    : value
);

const toPublicHostSshKeyConfig = (record) => {
  const plain = toPlainRecord(record);
  if (!plain) {
    return null;
  }
  return {
    id: Number(plain.id),
    hostId: Number(plain.hostId),
    agentUuid: plain.agentUuid ? String(plain.agentUuid) : null,
    keyName: String(plain.keyName || DEFAULT_KEY_NAME),
    publicKey: plain.publicKey ? String(plain.publicKey) : null,
    hasPrivateKey: Boolean(normalizeString(plain.privateKey)),
    hasPassphrase: Boolean(normalizeString(plain.passphrase)),
    knownHosts: plain.knownHosts ? String(plain.knownHosts) : null,
    strictHostKeyChecking: plain.strictHostKeyChecking !== false,
    fingerprint: plain.fingerprint ? String(plain.fingerprint) : null,
    createdBy: plain.createdBy ? String(plain.createdBy) : null,
    updatedBy: plain.updatedBy ? String(plain.updatedBy) : null,
    createdAt: plain.createdAt ? String(plain.createdAt) : null,
    updatedAt: plain.updatedAt ? String(plain.updatedAt) : null,
  };
};

const resolveHostForConfig = async ({ hostId, agentUuid } = {}) => {
  const parsedHostId = Number(hostId);
  if (Number.isInteger(parsedHostId) && parsedHostId > 0) {
    const host = await Host.findByPk(parsedHostId);
    if (!host) {
      throw new Error(`Host not found: ${parsedHostId}`);
    }
    return host;
  }

  const normalizedAgentUuid = normalizeString(agentUuid);
  if (normalizedAgentUuid) {
    const host = await Host.findOne({ where: { agentUuid: normalizedAgentUuid } });
    if (!host) {
      throw new Error(`Host not found for agent UUID: ${normalizedAgentUuid}`);
    }
    return host;
  }

  throw new Error('hostId or agentUuid is required.');
};

const getHostSshKeyConfig = async ({ hostId, agentUuid, keyName = DEFAULT_KEY_NAME } = {}) => {
  const host = await resolveHostForConfig({ hostId, agentUuid });
  const record = await HostSshKeyConfig.findOne({
    where: {
      hostId: host.id,
      keyName: normalizeString(keyName) || DEFAULT_KEY_NAME,
    },
  });
  return toPublicHostSshKeyConfig(record);
};

const getHostSshKeyMaterial = async ({ hostId, agentUuid, keyName = DEFAULT_KEY_NAME } = {}) => {
  const host = await resolveHostForConfig({ hostId, agentUuid });
  const record = await HostSshKeyConfig.findOne({
    where: {
      hostId: host.id,
      keyName: normalizeString(keyName) || DEFAULT_KEY_NAME,
    },
  });
  return toPlainRecord(record);
};

const upsertHostSshKeyConfig = async ({
  hostId,
  agentUuid,
  keyName = DEFAULT_KEY_NAME,
  privateKey,
  publicKey,
  passphrase,
  knownHosts,
  strictHostKeyChecking = true,
  updatedBy,
} = {}) => {
  const host = await resolveHostForConfig({ hostId, agentUuid });
  const normalizedKeyName = normalizeString(keyName) || DEFAULT_KEY_NAME;
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  if (!normalizedPrivateKey) {
    throw new Error('privateKey is required.');
  }
  const normalizedPublicKey = normalizeString(publicKey) || null;
  const normalizedPassphrase = passphrase === null || passphrase === undefined ? null : String(passphrase);
  const normalizedKnownHosts = knownHosts === null || knownHosts === undefined ? null : String(knownHosts).trim() || null;
  const fingerprint = buildFingerprint({ publicKey: normalizedPublicKey, privateKey: normalizedPrivateKey });

  const [record] = await HostSshKeyConfig.upsert({
    hostId: host.id,
    agentUuid: normalizeString(host.agentUuid) || normalizeString(agentUuid) || null,
    keyName: normalizedKeyName,
    privateKey: normalizedPrivateKey,
    publicKey: normalizedPublicKey,
    passphrase: normalizedPassphrase,
    knownHosts: normalizedKnownHosts,
    strictHostKeyChecking: strictHostKeyChecking !== false,
    fingerprint,
    updatedBy: normalizeString(updatedBy) || null,
    createdBy: normalizeString(updatedBy) || null,
  });

  const saved = record || await HostSshKeyConfig.findOne({
    where: { hostId: host.id, keyName: normalizedKeyName },
  });
  return toPublicHostSshKeyConfig(saved);
};

const deleteHostSshKeyConfig = async ({ hostId, agentUuid, keyName = DEFAULT_KEY_NAME } = {}) => {
  const host = await resolveHostForConfig({ hostId, agentUuid });
  const deleted = await HostSshKeyConfig.destroy({
    where: {
      hostId: host.id,
      keyName: normalizeString(keyName) || DEFAULT_KEY_NAME,
    },
  });
  return deleted > 0;
};

module.exports = {
  DEFAULT_KEY_NAME,
  getHostSshKeyConfig,
  getHostSshKeyMaterial,
  upsertHostSshKeyConfig,
  deleteHostSshKeyConfig,
  toPublicHostSshKeyConfig,
};
