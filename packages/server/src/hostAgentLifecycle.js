const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const resolveConfiguredSudoPassword = (env = process.env) => {
  const source = env && typeof env === 'object' ? env : {};
  const keys = ['PC_DEPLOY_SUDO_PASSWORD', 'PC_SUDO_PASSWORD', 'PC_ROOT_PASSWORD'];
  for (const key of keys) {
    const candidate = String(source[key] || '');
    if (candidate.length > 0) {
      return candidate;
    }
  }
  return '';
};

const parseVersionSegments = (value) => {
  const normalized = String(value || '').trim().replace(/^v/i, '');
  const core = normalized.match(/^\d+(?:\.\d+)*/)?.[0] || '';
  if (!core) {
    return null;
  }
  const segments = core
    .split('.')
    .map((segment) => Number.parseInt(segment, 10));
  if (segments.some((segment) => !Number.isInteger(segment) || segment < 0)) {
    return null;
  }
  return segments;
};

const compareVersionSegments = (left, right) => {
  const leftSegments = parseVersionSegments(left);
  const rightSegments = parseVersionSegments(right);
  if (!leftSegments || !rightSegments) {
    return null;
  }

  const maxLength = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftSegments[index] ?? 0;
    const rightValue = rightSegments[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }
  return 0;
};

const isHostVersionOutOfDate = (hostVersion, targetVersion) => {
  const normalizedTarget = String(targetVersion || '').trim();
  if (!normalizedTarget) {
    return false;
  }
  const normalizedHostVersion = String(hostVersion || '').trim();
  if (!normalizedHostVersion) {
    return true;
  }

  const numericComparison = compareVersionSegments(normalizedHostVersion, normalizedTarget);
  if (numericComparison == null) {
    return normalizedHostVersion !== normalizedTarget;
  }
  return numericComparison < 0;
};

const isHostVersionMismatch = (hostVersion, targetVersion) => {
  const normalizedTarget = String(targetVersion || '').trim();
  if (!normalizedTarget) {
    return false;
  }
  const normalizedHostVersion = String(hostVersion || '').trim();
  if (!normalizedHostVersion) {
    return true;
  }

  const numericComparison = compareVersionSegments(normalizedHostVersion, normalizedTarget);
  if (numericComparison == null) {
    return normalizedHostVersion !== normalizedTarget;
  }
  return numericComparison !== 0;
};

const createHostAgentAutoUpgradeController = ({
  targetVersion,
  enabled = true,
  cooldownMs = 60000,
  findHostRecord,
  deployHostAgent,
  emitLog,
  now = () => Date.now(),
} = {}) => {
  const inFlightByHostId = new Map();
  const lastAttemptByHostId = new Map();

  const considerRuntimeHost = async (runtimeHost, { trigger = 'runtime' } = {}) => {
    if (!enabled) {
      return false;
    }

    const normalizedTargetVersion = String(targetVersion || '').trim();
    if (!normalizedTargetVersion) {
      return false;
    }

    const hostVersion = String(runtimeHost?.version || '').trim();
    if (!isHostVersionMismatch(hostVersion, normalizedTargetVersion)) {
      return false;
    }

    if (typeof findHostRecord !== 'function' || typeof deployHostAgent !== 'function') {
      return false;
    }

    const persistedHost = await findHostRecord(runtimeHost);
    const hostId = Number(persistedHost?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      return false;
    }

    if (inFlightByHostId.has(hostId)) {
      return false;
    }

    const nowMs = Number(now());
    const hasPreviousAttempt = lastAttemptByHostId.has(hostId);
    const lastAttemptMs = Number(lastAttemptByHostId.get(hostId) || 0);
    if (hasPreviousAttempt && (nowMs - lastAttemptMs) < cooldownMs) {
      return false;
    }
    lastAttemptByHostId.set(hostId, nowMs);

    const deploymentAction = isHostVersionOutOfDate(hostVersion, normalizedTargetVersion)
      ? 'upgrade'
      : 'redeploy';
    const requestLabel = deploymentAction === 'upgrade' ? 'upgrade' : 're-deploy';
    const hostName = String(
      persistedHost?.name
      || runtimeHost?.name
      || runtimeHost?.hostName
      || runtimeHost?.ip
      || hostId,
    ).trim();
    const hostIp = String(
      persistedHost?.ip
      || runtimeHost?.ip
      || '',
    ).trim() || null;

    if (typeof emitLog === 'function') {
      emitLog({
        hostId,
        hostName,
        hostIp,
        message: `Detected slave version mismatch for ${hostName} (${hostVersion || 'unknown'} -> ${normalizedTargetVersion}); starting automatic ${requestLabel}.`,
      });
    }

    const deploymentPromise = Promise.resolve(deployHostAgent({
      host: persistedHost,
      currentVersion: hostVersion || 'unknown',
      targetVersion: normalizedTargetVersion,
      deploymentAction,
      trigger,
    }))
      .catch(() => {})
      .finally(() => {
        inFlightByHostId.delete(hostId);
      });

    inFlightByHostId.set(hostId, deploymentPromise);
    return true;
  };

  return {
    considerRuntimeHost,
    getCooldownMs() {
      return cooldownMs;
    },
    getInFlightHostIds() {
      return Array.from(inFlightByHostId.keys());
    },
  };
};

const resolveAutoUpgradeEnabled = (env = process.env) => {
  const raw = String(env?.PC_SLAVE_AUTO_UPGRADE_ENABLED || '').trim().toLowerCase();
  if (!raw) {
    return true;
  }
  return raw !== 'false' && raw !== '0' && raw !== 'no' && raw !== 'off';
};

const resolveAutoUpgradeCooldownMs = (env = process.env) => (
  parsePositiveInt(env?.PC_SLAVE_AUTO_UPGRADE_COOLDOWN_SECONDS, 60) * 1000
);

module.exports = {
  resolveConfiguredSudoPassword,
  parseVersionSegments,
  compareVersionSegments,
  isHostVersionOutOfDate,
  isHostVersionMismatch,
  createHostAgentAutoUpgradeController,
  resolveAutoUpgradeEnabled,
  resolveAutoUpgradeCooldownMs,
};
