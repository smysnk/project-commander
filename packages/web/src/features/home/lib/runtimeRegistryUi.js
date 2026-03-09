export const formatRuntimePercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return `${numeric.toFixed(numeric >= 100 ? 0 : 1)}%`;
};

export const formatRuntimeBytes = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '-';
  }
  if (numeric < 1024) {
    return `${Math.round(numeric)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let nextValue = numeric / 1024;
  let unitIndex = 0;
  while (nextValue >= 1024 && unitIndex < units.length - 1) {
    nextValue /= 1024;
    unitIndex += 1;
  }
  return `${nextValue.toFixed(nextValue >= 100 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatRuntimeByteRatio = (usedBytes, totalBytes) => {
  const used = Number(usedBytes);
  const total = Number(totalBytes);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return formatRuntimeBytes(usedBytes);
  }
  return `${formatRuntimeBytes(used)} / ${formatRuntimeBytes(total)}`;
};

export const formatRuntimeLoad = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }
  return numeric.toFixed(2);
};

export const getObservedProcessLabel = (observedRun) => {
  const packageKey = String(observedRun?.packageKey || '').trim();
  if (packageKey) {
    return packageKey;
  }
  const processKey = String(observedRun?.processKey || '').trim();
  if (processKey) {
    return processKey;
  }
  const command = String(observedRun?.command || '').trim();
  if (command) {
    return command;
  }
  return 'managed-process';
};

export const parseRuntimeArgsInput = (value) => (
  String(value || '')
    .split('\n')
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
);

export const parseRuntimeEnvInput = (value) => (
  String(value || '')
    .split('\n')
    .map((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) {
        return null;
      }
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        return null;
      }
      return {
        key: trimmed.slice(0, separatorIndex).trim(),
        value: trimmed.slice(separatorIndex + 1),
      };
    })
    .filter((entry) => entry?.key)
);
