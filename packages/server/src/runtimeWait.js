const net = require('net');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_LOG_LIMIT = 120;
const TERMINAL_STATUSES = new Set(['exited', 'failed', 'killed', 'replaced', 'stopped']);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toPlainRecord = (value) => (
  value && typeof value?.get === 'function'
    ? value.get({ plain: true })
    : value
);

const toPositiveInteger = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const toInteger = (value, fallback = null) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const normalizeString = (value) => String(value || '').trim();

const normalizeObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const parseJsonValue = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (Array.isArray(fallback) && Array.isArray(value)) {
    return value;
  }
  if (!Array.isArray(fallback) && value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(fallback)) {
      return Array.isArray(parsed) ? parsed : fallback;
    }
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const getNestedContextValue = (context, variableName) => {
  const parts = normalizeString(variableName).split('.').filter(Boolean);
  let current = context;
  for (const part of parts) {
    if (!current || !Object.prototype.hasOwnProperty.call(current, part)) {
      return '';
    }
    current = current[part];
  }
  return current == null ? '' : String(current);
};

const compileTemplateString = (value, context) => normalizeString(value).replace(
  /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,
  (_, variableName) => getNestedContextValue(context, variableName),
);

const compileStructuredValue = (value, context) => {
  if (Array.isArray(value)) {
    return value.map((entry) => compileStructuredValue(entry, context));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((accumulator, [key, entry]) => {
      accumulator[key] = compileStructuredValue(entry, context);
      return accumulator;
    }, {});
  }
  return typeof value === 'string' ? compileTemplateString(value, context) : value;
};

const normalizeCheckType = (value) => normalizeString(value).toLowerCase() || 'process_status';

const normalizeHealthCheck = (check, index = 0) => ({
  ...normalizeObject(check),
  type: normalizeCheckType(check?.type),
  index,
});

const normalizeHealthChecks = (checks) => (
  Array.isArray(checks) ? checks.map(normalizeHealthCheck) : []
);

const buildDefaultChecks = (input = {}) => {
  const checks = [];
  if (normalizeString(input.url)) {
    checks.push({
      type: 'http',
      url: normalizeString(input.url),
      method: normalizeString(input.method || 'GET') || 'GET',
      expectedStatus: toInteger(input.httpStatus ?? input.expectedStatus, 200),
      bodyIncludes: normalizeString(input.bodyIncludes),
    });
  }
  if (normalizeString(input.graphqlEndpoint) || normalizeString(input.graphqlUrl)) {
    checks.push({
      type: 'graphql',
      endpoint: normalizeString(input.graphqlEndpoint || input.graphqlUrl),
      query: normalizeString(input.query || input.graphqlQuery),
      variablesJson: input.variablesJson,
      expectedStatus: toInteger(input.httpStatus ?? input.expectedStatus, 200),
    });
  }
  const port = toPositiveInteger(input.port);
  if (port) {
    checks.push({
      type: 'tcp',
      host: normalizeString(input.tcpHost || input.hostIp || input.ip || '127.0.0.1') || '127.0.0.1',
      port,
    });
  }
  if (normalizeString(input.pattern)) {
    checks.push({
      type: 'log_pattern',
      pattern: normalizeString(input.pattern),
    });
  }
  if (input.expectedExitCode !== undefined && input.expectedExitCode !== null && input.expectedExitCode !== '') {
    checks.push({
      type: 'command_exit',
      expectedExitCode: toInteger(input.expectedExitCode, 0),
    });
  }
  if (checks.length === 0) {
    checks.push({
      type: 'process_status',
      expectedStatus: normalizeString(input.status || input.expectedStatus || 'running') || 'running',
    });
  }
  return normalizeHealthChecks(checks);
};

const checkNeedsRuntimeState = (check) => (
  ['process_status', 'command_exit', 'log_pattern'].includes(normalizeCheckType(check?.type))
);

const checkNeedsLogs = (check) => normalizeCheckType(check?.type) === 'log_pattern';

const runMatchesInput = (run, input = {}) => {
  const record = toPlainRecord(run);
  if (!record) {
    return false;
  }
  const runId = normalizeString(input.runId);
  if (runId && normalizeString(record.runId) !== runId) {
    return false;
  }
  const processKey = normalizeString(input.processKey || input.packageKey);
  if (processKey) {
    const candidateKeys = [
      record.processKey,
      record.packageKey,
      record.serviceName,
    ].map(normalizeString).filter(Boolean);
    if (!candidateKeys.includes(processKey)) {
      return false;
    }
  }
  const projectId = toPositiveInteger(input.projectId);
  if (projectId && toPositiveInteger(record.projectId) !== projectId) {
    return false;
  }
  const projectPath = normalizeString(input.projectPath);
  if (projectPath && normalizeString(record.projectPath) && normalizeString(record.projectPath) !== projectPath) {
    return false;
  }
  return true;
};

const selectObservedRun = (runtimeState, input = {}) => {
  const runs = Array.isArray(runtimeState?.processRuns || runtimeState?.observedRuns)
    ? (runtimeState.processRuns || runtimeState.observedRuns)
    : [];
  return runs.find((run) => runMatchesInput(run, input)) || null;
};

const normalizeObservedRunForResult = (run) => {
  const record = toPlainRecord(run);
  if (!record) {
    return null;
  }
  const runtimeState = toPlainRecord(record.runtimeState);
  return {
    ...record,
    runtimeState: runtimeState || record.runtimeState || null,
  };
};

const readRecentLogLines = async ({
  runtimeBackend,
  runtimeState,
  input,
  limit = DEFAULT_LOG_LIMIT,
} = {}) => {
  if (!runtimeBackend || typeof runtimeBackend !== 'object') {
    return [];
  }
  const selectedRun = selectObservedRun(runtimeState, input);
  const runId = normalizeString(input.runId || selectedRun?.runId);
  const slaveId = normalizeString(input.agentUuid || input.slaveId || runtimeState?.host?.agentUuid || selectedRun?.slaveId);
  if (runId && slaveId && typeof runtimeBackend.getManagedProcessLogs === 'function') {
    const logs = await runtimeBackend.getManagedProcessLogs({
      slaveId,
      runId,
      limit,
      afterId: null,
      serviceNames: null,
    });
    return (Array.isArray(logs) ? logs : []).map((entry) => normalizeString(entry?.message)).filter(Boolean);
  }
  if (slaveId && typeof runtimeBackend.getSlaveLogs === 'function') {
    const logs = await runtimeBackend.getSlaveLogs({
      slaveId,
      limit,
      afterId: null,
      serviceNames: null,
    });
    return (Array.isArray(logs) ? logs : []).map((entry) => normalizeString(entry?.message)).filter(Boolean);
  }
  return [];
};

const evaluateProcessStatusCheck = ({ check, runtimeState, input }) => {
  const observedRun = selectObservedRun(runtimeState, input);
  const expectedStatus = normalizeString(check.expectedStatus || check.status || input.status || 'running').toLowerCase();
  if (!observedRun) {
    return {
      matched: false,
      message: 'no observed run matched the wait selectors',
    };
  }
  const status = normalizeString(toPlainRecord(observedRun)?.status).toLowerCase();
  return {
    matched: status === expectedStatus,
    observedRun,
    message: `observed status ${status || 'unknown'} did not match ${expectedStatus}`,
  };
};

const evaluateCommandExitCheck = ({ check, runtimeState, input }) => {
  const observedRun = selectObservedRun(runtimeState, input);
  if (!observedRun) {
    return {
      matched: false,
      message: 'no observed run matched the wait selectors',
    };
  }
  const record = toPlainRecord(observedRun);
  const expectedExitCode = toInteger(check.expectedExitCode, 0);
  const status = normalizeString(record?.status).toLowerCase();
  const exitCode = toInteger(record?.exitCode);
  return {
    matched: TERMINAL_STATUSES.has(status) && exitCode === expectedExitCode,
    observedRun,
    message: `observed exit state status=${status || 'unknown'} exitCode=${exitCode == null ? 'unknown' : exitCode}`,
  };
};

const evaluateHttpCheck = async ({ check, fetchImpl }) => {
  const url = normalizeString(check.url);
  if (!url) {
    return { matched: false, failed: true, message: 'http health check requires url' };
  }
  try {
    const response = await fetchImpl(url, {
      method: normalizeString(check.method || 'GET') || 'GET',
      headers: normalizeObject(check.headers),
    });
    const expectedStatus = toInteger(check.expectedStatus, 200);
    const bodyIncludes = normalizeString(check.bodyIncludes || check.body);
    const body = bodyIncludes ? await response.text() : '';
    const statusMatches = response.status === expectedStatus;
    const bodyMatches = !bodyIncludes || body.includes(bodyIncludes);
    return {
      matched: statusMatches && bodyMatches,
      httpStatus: response.status,
      message: statusMatches
        ? (bodyMatches ? 'http check matched' : `http body did not include ${bodyIncludes}`)
        : `http status ${response.status} did not match ${expectedStatus}`,
    };
  } catch (error) {
    return {
      matched: false,
      message: `http check failed: ${error?.message || error}`,
    };
  }
};

const evaluateGraphqlCheck = async ({ check, fetchImpl }) => {
  const endpoint = normalizeString(check.endpoint || check.url || check.graphqlEndpoint);
  const query = normalizeString(check.query);
  if (!endpoint || !query) {
    return { matched: false, failed: true, message: 'graphql health check requires endpoint and query' };
  }
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...normalizeObject(check.headers),
      },
      body: JSON.stringify({
        query,
        variables: parseJsonValue(check.variablesJson || check.variables, {}),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    const expectedStatus = toInteger(check.expectedStatus, 200);
    const matched = response.status === expectedStatus
      && (!Array.isArray(payload.errors) || payload.errors.length === 0);
    return {
      matched,
      httpStatus: response.status,
      message: matched
        ? 'graphql check matched'
        : `graphql check failed with status ${response.status}${Array.isArray(payload.errors) && payload.errors.length > 0 ? ` and ${payload.errors.length} errors` : ''}`,
    };
  } catch (error) {
    return {
      matched: false,
      message: `graphql check failed: ${error?.message || error}`,
    };
  }
};

const evaluateTcpCheck = async ({ check }) => {
  const host = normalizeString(check.host || check.hostname || '127.0.0.1') || '127.0.0.1';
  const port = toPositiveInteger(check.port);
  if (!port) {
    return { matched: false, failed: true, message: 'tcp health check requires port' };
  }
  const timeoutMs = toPositiveInteger(check.connectTimeoutMs || check.timeoutMs, 1000);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ matched: true, message: 'tcp check matched' }));
    socket.once('timeout', () => finish({ matched: false, message: `tcp connection timed out to ${host}:${port}` }));
    socket.once('error', (error) => finish({ matched: false, message: `tcp check failed: ${error?.message || error}` }));
  });
};

const evaluateLogPatternCheck = async ({
  check,
  runtimeBackend,
  runtimeState,
  input,
}) => {
  const pattern = normalizeString(check.pattern);
  if (!pattern) {
    return { matched: false, failed: true, message: 'log_pattern health check requires pattern' };
  }
  const lastLogLines = await readRecentLogLines({
    runtimeBackend,
    runtimeState,
    input,
    limit: toPositiveInteger(check.limit, DEFAULT_LOG_LIMIT),
  });
  return {
    matched: lastLogLines.some((line) => line.includes(pattern)),
    lastLogLines,
    observedRun: selectObservedRun(runtimeState, input),
    message: `log pattern ${pattern} was not found in recent logs`,
  };
};

const buildTemplateContext = ({ resolvedTemplate, input, runtimeState } = {}) => {
  const desiredProcess = normalizeObject(toPlainRecord(resolvedTemplate?.desiredProcess));
  const host = normalizeObject(toPlainRecord(resolvedTemplate?.host || runtimeState?.host));
  const project = normalizeObject(toPlainRecord(resolvedTemplate?.project));
  return {
    host: {
      name: normalizeString(host.name),
      agentUuid: normalizeString(host.agentUuid || desiredProcess.slaveId || input.agentUuid || input.slaveId),
      ip: normalizeString(host.ip || input.hostIp || input.ip),
    },
    project: {
      name: normalizeString(project.name || input.project || input.projectName),
      hostPath: normalizeString(desiredProcess.projectPath || input.projectPath),
      codexPath: normalizeString(input.codexPath || desiredProcess.projectPath || input.projectPath),
    },
    package: {
      key: normalizeString(desiredProcess.packageKey || input.packageKey || input.processKey),
      relativePath: normalizeString(desiredProcess.packageRelativePath || input.packageRelativePath || '.'),
    },
    env: normalizeObject(desiredProcess.envJson),
  };
};

const createRuntimeWaiter = ({
  processRegistry,
  runtimeBackend,
  processTemplates = null,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) => {
  if (!processRegistry || typeof processRegistry !== 'object') {
    throw new Error('processRegistry is required for runtime waiter.');
  }
  if (!runtimeBackend || typeof runtimeBackend !== 'object') {
    throw new Error('runtimeBackend is required for runtime waiter.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is required for runtime waiter.');
  }

  const resolveTemplateChecks = async (input) => {
    const templateKey = normalizeString(input.templateKey || input.template);
    if (!templateKey || !processTemplates || typeof processTemplates.resolveProcessTemplate !== 'function') {
      return { checks: [], resolvedTemplate: null };
    }
    const resolvedTemplate = await processTemplates.resolveProcessTemplate({
      ...input,
      templateKey,
    });
    const checks = normalizeHealthChecks(resolvedTemplate?.healthChecksJson);
    return { checks, resolvedTemplate };
  };

  const loadRuntimeState = async (input) => {
    if (typeof processRegistry.getSlaveRuntimeState !== 'function') {
      return null;
    }
    const hostId = toPositiveInteger(input.hostId);
    const slaveId = normalizeString(input.agentUuid || input.slaveId);
    if (!hostId && !slaveId) {
      return null;
    }
    return processRegistry.getSlaveRuntimeState({ hostId, slaveId });
  };

  const resolveChecks = async (input) => {
    const explicitChecks = normalizeHealthChecks(
      parseJsonValue(input.healthChecksJson || input.healthChecks, []),
    );
    if (explicitChecks.length > 0) {
      return { checks: explicitChecks, resolvedTemplate: null };
    }
    const templateResult = await resolveTemplateChecks(input);
    if (templateResult.checks.length > 0) {
      return templateResult;
    }
    return {
      checks: buildDefaultChecks(input),
      resolvedTemplate: templateResult.resolvedTemplate,
    };
  };

  const waitForRuntime = async (input = {}) => {
    const startedAt = now();
    const timeoutMs = toPositiveInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS);
    const intervalMs = toPositiveInteger(input.intervalMs, DEFAULT_INTERVAL_MS);
    const deadline = startedAt + timeoutMs;
    const { checks: rawChecks, resolvedTemplate } = await resolveChecks(input);
    const initialRuntimeState = rawChecks.some(checkNeedsRuntimeState)
      ? await loadRuntimeState(input)
      : null;
    const templateContext = buildTemplateContext({ resolvedTemplate, input, runtimeState: initialRuntimeState });
    const checks = normalizeHealthChecks(rawChecks.map((check) => compileStructuredValue(check, templateContext)));
    let lastLogLines = [];
    let lastObservedRun = null;
    let lastHttpStatus = null;
    let lastFailure = null;

    while (now() <= deadline) {
      const runtimeState = checks.some(checkNeedsRuntimeState)
        ? (await loadRuntimeState(input))
        : null;
      if (runtimeState) {
        lastObservedRun = selectObservedRun(runtimeState, input) || lastObservedRun;
      }

      for (const check of checks) {
        let result;
        const type = normalizeCheckType(check.type);
        if (type === 'process_status') {
          result = evaluateProcessStatusCheck({ check, runtimeState, input });
        } else if (type === 'command_exit') {
          result = evaluateCommandExitCheck({ check, runtimeState, input });
        } else if (type === 'http') {
          result = await evaluateHttpCheck({ check, fetchImpl });
        } else if (type === 'tcp') {
          result = await evaluateTcpCheck({ check });
        } else if (type === 'log_pattern') {
          result = await evaluateLogPatternCheck({
            check,
            runtimeBackend,
            runtimeState,
            input,
          });
        } else if (type === 'graphql') {
          result = await evaluateGraphqlCheck({ check, fetchImpl });
        } else {
          result = {
            matched: false,
            failed: true,
            message: `unsupported health check type: ${type}`,
          };
        }

        if (Array.isArray(result?.lastLogLines)) {
          lastLogLines = result.lastLogLines;
        } else if (checkNeedsLogs(check) && lastLogLines.length === 0) {
          lastLogLines = await readRecentLogLines({
            runtimeBackend,
            runtimeState,
            input,
          });
        }
        lastObservedRun = result?.observedRun || lastObservedRun;
        if (Number.isInteger(Number(result?.httpStatus))) {
          lastHttpStatus = Number(result.httpStatus);
        }

        if (result?.matched) {
          return {
            status: 'matched',
            matchedCheck: type,
            failedCheck: null,
            elapsedMs: Math.max(0, now() - startedAt),
            observedRun: normalizeObservedRunForResult(result.observedRun || lastObservedRun),
            lastLogLines,
            httpStatus: lastHttpStatus,
            message: result.message || `${type} health check matched`,
          };
        }

        lastFailure = {
          type,
          message: result?.message || `${type} health check did not match`,
        };
        if (result?.failed) {
          return {
            status: 'failed',
            matchedCheck: null,
            failedCheck: type,
            elapsedMs: Math.max(0, now() - startedAt),
            observedRun: normalizeObservedRunForResult(lastObservedRun),
            lastLogLines,
            httpStatus: lastHttpStatus,
            message: lastFailure.message,
          };
        }
      }

      if (now() >= deadline) {
        break;
      }
      await delay(Math.min(intervalMs, Math.max(0, deadline - now())));
    }

    if (lastLogLines.length === 0 && checks.some(checkNeedsLogs)) {
      const runtimeState = checks.some(checkNeedsRuntimeState)
        ? await loadRuntimeState(input)
        : null;
      lastLogLines = await readRecentLogLines({
        runtimeBackend,
        runtimeState,
        input,
      });
      lastObservedRun = selectObservedRun(runtimeState, input) || lastObservedRun;
    }

    return {
      status: 'timeout',
      matchedCheck: null,
      failedCheck: lastFailure?.type || (checks[0] ? normalizeCheckType(checks[0].type) : null),
      elapsedMs: Math.max(0, now() - startedAt),
      observedRun: normalizeObservedRunForResult(lastObservedRun),
      lastLogLines,
      httpStatus: lastHttpStatus,
      message: lastFailure?.message || 'runtime wait timed out',
    };
  };

  return {
    waitForRuntime,
  };
};

module.exports = {
  createRuntimeWaiter,
  normalizeHealthChecks,
};
