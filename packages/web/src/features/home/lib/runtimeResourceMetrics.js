export const RUNTIME_RESOURCE_HISTORY_LIMIT = 60;
export const RUNTIME_RESOURCE_SAMPLE_INTERVAL_MS = 1000;

const TERMINAL_PROCESS_STATUSES = new Set([
  'dead',
  'exited',
  'failed',
  'killed',
  'stopped',
  'terminated',
]);

const normalizeString = (value) => String(value || '').trim();

const normalizeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizePositiveInteger = (value) => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const newestTimestamp = (left, right) => {
  const leftMs = Date.parse(left || '');
  const rightMs = Date.parse(right || '');
  if (!Number.isFinite(leftMs)) {
    return right || left || null;
  }
  if (!Number.isFinite(rightMs)) {
    return left || right || null;
  }
  return rightMs > leftMs ? right : left;
};

export const isActiveObservedRunForMetrics = (observedRun) => {
  const pid = normalizePositiveInteger(observedRun?.pid);
  if (!pid) {
    return false;
  }
  const status = normalizeString(observedRun?.runtimeState?.status || observedRun?.status).toLowerCase();
  return !TERMINAL_PROCESS_STATUSES.has(status);
};

export const getObservedRunApplicationKey = (observedRun) => {
  const deploymentId = normalizePositiveInteger(observedRun?.deploymentId);
  if (deploymentId) {
    return `deployment:${deploymentId}`;
  }
  const deploymentKey = normalizeString(observedRun?.deploymentKey).toLowerCase();
  if (deploymentKey) {
    return `deployment-key:${deploymentKey}`;
  }
  const projectPath = normalizeString(observedRun?.projectPath).toLowerCase() || 'unknown-project';
  const packageKey = normalizeString(observedRun?.packageKey || observedRun?.processKey).toLowerCase() || 'managed-process';
  return `project:${projectPath}:package:${packageKey}`;
};

export const getObservedRunApplicationLabel = (observedRun) => {
  const deploymentLabel = normalizeString(observedRun?.deploymentName || observedRun?.deploymentKey);
  if (deploymentLabel) {
    return deploymentLabel;
  }
  const packageKey = normalizeString(observedRun?.packageKey || observedRun?.processKey);
  const projectPath = normalizeString(observedRun?.projectPath);
  if (packageKey && projectPath) {
    return `${packageKey} · ${projectPath.split('/').filter(Boolean).pop() || projectPath}`;
  }
  return packageKey || projectPath || 'managed-process';
};

export const buildDeploymentResourceSamples = (observedRuns, { sampledAt = null } = {}) => {
  const groups = new Map();
  for (const observedRun of Array.isArray(observedRuns) ? observedRuns : []) {
    if (!isActiveObservedRunForMetrics(observedRun)) {
      continue;
    }
    const key = getObservedRunApplicationKey(observedRun);
    const runtimeState = observedRun?.runtimeState && typeof observedRun.runtimeState === 'object'
      ? observedRun.runtimeState
      : {};
    const pid = normalizePositiveInteger(observedRun?.pid);
    const current = groups.get(key) || {
      key,
      label: getObservedRunApplicationLabel(observedRun),
      deploymentKey: normalizeString(observedRun?.deploymentKey),
      deploymentName: normalizeString(observedRun?.deploymentName),
      projectPath: normalizeString(observedRun?.projectPath),
      packageKeys: new Set(),
      pids: new Set(),
      runCount: 0,
      cpuPercent: 0,
      memoryPercent: 0,
      rssBytes: 0,
      vmsBytes: 0,
      readBytes: 0,
      writeBytes: 0,
      readOps: 0,
      writeOps: 0,
      sampledAt: sampledAt || null,
    };

    current.runCount += 1;
    current.cpuPercent += normalizeNumber(runtimeState.cpuPercent);
    current.memoryPercent += normalizeNumber(runtimeState.memoryPercent);
    current.rssBytes += normalizeNumber(runtimeState.rssBytes);
    current.vmsBytes += normalizeNumber(runtimeState.vmsBytes);
    current.readBytes += normalizeNumber(runtimeState.readBytes);
    current.writeBytes += normalizeNumber(runtimeState.writeBytes);
    current.readOps += normalizeNumber(runtimeState.readOps);
    current.writeOps += normalizeNumber(runtimeState.writeOps);
    current.sampledAt = newestTimestamp(current.sampledAt, runtimeState.sampledAt || observedRun?.lastSeenAt || sampledAt);
    if (pid) {
      current.pids.add(pid);
    }
    const packageKey = normalizeString(observedRun?.packageKey || observedRun?.processKey);
    if (packageKey) {
      current.packageKeys.add(packageKey);
    }
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      packageKeys: Array.from(group.packageKeys).sort((left, right) => left.localeCompare(right)),
      pids: Array.from(group.pids).sort((left, right) => left - right),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const buildHistoryEntry = (sample, previousEntry, nowMs) => {
  const previousTimeMs = Number(previousEntry?.sampleTimeMs || 0);
  const elapsedSeconds = previousTimeMs > 0 ? Math.max((nowMs - previousTimeMs) / 1000, 1) : 1;
  const readBytesDelta = previousEntry ? Math.max(0, sample.readBytes - normalizeNumber(previousEntry.readBytes)) : 0;
  const writeBytesDelta = previousEntry ? Math.max(0, sample.writeBytes - normalizeNumber(previousEntry.writeBytes)) : 0;
  return {
    ...sample,
    sampleTimeMs: nowMs,
    readBytesPerSecond: readBytesDelta / elapsedSeconds,
    writeBytesPerSecond: writeBytesDelta / elapsedSeconds,
    ioBytesPerSecond: (readBytesDelta + writeBytesDelta) / elapsedSeconds,
  };
};

export const appendDeploymentResourceHistory = (historyByKey, samples, {
  limit = RUNTIME_RESOURCE_HISTORY_LIMIT,
  nowMs = Date.now(),
} = {}) => {
  const normalizedLimit = Math.max(2, Math.min(300, Number.parseInt(limit, 10) || RUNTIME_RESOURCE_HISTORY_LIMIT));
  const sampleList = Array.isArray(samples) ? samples : [];
  const nextHistory = {};

  for (const sample of sampleList) {
    const key = normalizeString(sample?.key);
    if (!key) {
      continue;
    }
    const previousHistory = Array.isArray(historyByKey?.[key]) ? historyByKey[key] : [];
    const previousEntry = previousHistory.length > 0 ? previousHistory[previousHistory.length - 1] : null;
    nextHistory[key] = [
      ...previousHistory.slice(-(normalizedLimit - 1)),
      buildHistoryEntry(sample, previousEntry, nowMs),
    ];
  }

  return nextHistory;
};
