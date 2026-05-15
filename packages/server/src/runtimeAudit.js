const { RuntimeAuditEvent } = require('./models/runtimeAuditEvent');

const SECRET_KEY_PATTERN = /token|password|secret|shared[_-]?key|authorization|cookie/i;

const sanitizeAuditPayload = (value, depth = 0) => {
  if (depth > 6) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAuditPayload(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key)
      ? '[redacted]'
      : sanitizeAuditPayload(entry, depth + 1);
  }
  return sanitized;
};

const toPlainRecord = (value) => (
  value && typeof value.get === 'function'
    ? value.get({ plain: true })
    : value
);

const inferActor = (context = {}) => {
  const user = context?.user || null;
  if (!user) {
    return {
      actorType: 'system',
      actorId: null,
      actorName: 'system',
    };
  }
  if (user.automation) {
    const token = user.automationToken || {};
    return {
      actorType: token.source === 'database' ? 'automation-token' : 'automation-env',
      actorId: token.id == null ? user.subject || null : String(token.id),
      actorName: user.name || token.name || 'automation',
    };
  }
  return {
    actorType: 'user',
    actorId: user.subject || user.email || null,
    actorName: user.name || user.email || 'user',
  };
};

const mapRuntimeAuditEventForApi = (event) => {
  const record = toPlainRecord(event);
  if (!record) {
    return null;
  }
  return {
    id: Number(record.id),
    requestId: record.requestId ? String(record.requestId) : null,
    actorType: String(record.actorType || 'system'),
    actorId: record.actorId ? String(record.actorId) : null,
    actorName: record.actorName ? String(record.actorName) : null,
    toolName: record.toolName ? String(record.toolName) : null,
    scope: record.scope ? String(record.scope) : null,
    hostId: Number.isInteger(Number(record.hostId)) ? Number(record.hostId) : null,
    projectId: Number.isInteger(Number(record.projectId)) ? Number(record.projectId) : null,
    desiredProcessId: Number.isInteger(Number(record.desiredProcessId)) ? Number(record.desiredProcessId) : null,
    runId: record.runId ? String(record.runId) : null,
    processKey: record.processKey ? String(record.processKey) : null,
    action: String(record.action || ''),
    inputJson: record.inputJson && typeof record.inputJson === 'object' ? record.inputJson : {},
    resultJson: record.resultJson && typeof record.resultJson === 'object' ? record.resultJson : {},
    status: String(record.status || 'success'),
    errorMessage: record.errorMessage ? String(record.errorMessage) : null,
    createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : null,
  };
};

const createRuntimeAuditLogger = ({ model = RuntimeAuditEvent, logger = console } = {}) => {
  const recordRuntimeAuditEvent = async ({
    context = {},
    action,
    scope = null,
    hostId = null,
    projectId = null,
    desiredProcessId = null,
    runId = null,
    processKey = null,
    input = {},
    result = {},
    status = 'success',
    errorMessage = null,
  } = {}) => {
    const normalizedAction = String(action || '').trim();
    if (!normalizedAction || !model || typeof model.create !== 'function') {
      return null;
    }
    const actor = inferActor(context);
    try {
      const event = await model.create({
        requestId: context?.requestId ? String(context.requestId) : null,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorName: actor.actorName,
        toolName: context?.toolName ? String(context.toolName) : null,
        scope: scope ? String(scope) : null,
        hostId: Number.isInteger(Number(hostId)) ? Number(hostId) : null,
        projectId: Number.isInteger(Number(projectId)) ? Number(projectId) : null,
        desiredProcessId: Number.isInteger(Number(desiredProcessId)) ? Number(desiredProcessId) : null,
        runId: runId ? String(runId) : null,
        processKey: processKey ? String(processKey) : null,
        action: normalizedAction,
        inputJson: sanitizeAuditPayload(input || {}),
        resultJson: sanitizeAuditPayload(result || {}),
        status: String(status || 'success'),
        errorMessage: errorMessage ? String(errorMessage) : null,
      });
      return mapRuntimeAuditEventForApi(event);
    } catch (error) {
      logger?.warn?.(`Unable to record runtime audit event: ${error.message || error}`);
      return null;
    }
  };

  const listRuntimeAuditEvents = async ({ limit = 100, action, hostId, projectId, actorType } = {}) => {
    if (!model || typeof model.findAll !== 'function') {
      return [];
    }
    const where = {};
    if (action) {
      where.action = String(action);
    }
    if (Number.isInteger(Number(hostId)) && Number(hostId) > 0) {
      where.hostId = Number(hostId);
    }
    if (Number.isInteger(Number(projectId)) && Number(projectId) > 0) {
      where.projectId = Number(projectId);
    }
    if (actorType) {
      where.actorType = String(actorType);
    }
    const records = await model.findAll({
      where,
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
      order: [['createdAt', 'DESC']],
    });
    return records.map((record) => mapRuntimeAuditEventForApi(record)).filter(Boolean);
  };

  return {
    recordRuntimeAuditEvent,
    listRuntimeAuditEvents,
  };
};

module.exports = {
  createRuntimeAuditLogger,
  inferActor,
  mapRuntimeAuditEventForApi,
  sanitizeAuditPayload,
};
