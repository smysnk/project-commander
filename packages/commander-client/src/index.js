const {
  MUTATION_CREATE_AUTOMATION_TOKEN,
  MUTATION_DELETE_DESIRED_PROCESS,
  MUTATION_DELETE_HOST_PATH_MAPPING,
  MUTATION_DELETE_PROCESS_TEMPLATE,
  MUTATION_ENSURE_PROCESS_FROM_TEMPLATE,
  MUTATION_ENSURE_DESIRED_PROCESS,
  MUTATION_HARD_KILL_PROCESS,
  MUTATION_SOFT_KILL_PROCESS,
  MUTATION_UPSERT_HOST_PATH_MAPPING,
  MUTATION_UPSERT_PROCESS_TEMPLATE,
  MUTATION_REVOKE_AUTOMATION_TOKEN,
  QUERY_AUTOMATION_TOKENS,
  QUERY_DESIRED_PROCESSES,
  QUERY_HOST_LOGS,
  QUERY_HOST_PATH_MAPPINGS,
  QUERY_HOSTS,
  QUERY_OBSERVED_RUNS,
  QUERY_PROCESS_TEMPLATES,
  QUERY_PROJECTS,
  QUERY_RUNTIME_AUDIT_EVENTS,
  QUERY_RESOLVE_PROCESS_TEMPLATE,
  QUERY_RESOLVE_HOST_PATH,
  QUERY_WAIT_FOR_RUNTIME,
} = require('./graphqlDocuments');
const {
  buildDesiredProcessInputFromTemplate,
  inferProcessTemplates,
  resolveTemplate,
} = require('./templates');

const DEFAULT_GRAPHQL_ENDPOINT = 'http://127.0.0.1:4000/graphql';
const READ_RETRY_COUNT = 2;
const READ_RETRY_DELAY_MS = 250;
const RAW_COMMAND_SCOPE = 'raw-command';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeEndpoint = (options = {}) => {
  const explicitEndpoint = options.endpoint || process.env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT;
  if (explicitEndpoint) {
    return String(explicitEndpoint).trim();
  }

  const baseUrl = options.baseUrl || process.env.PROJECT_COMMANDER_URL;
  if (baseUrl) {
    return `${String(baseUrl).replace(/\/$/, '')}/graphql`;
  }

  return DEFAULT_GRAPHQL_ENDPOINT;
};

const normalizeToken = (options = {}) => String(
  options.token
  || process.env.PROJECT_COMMANDER_TOKEN
  || process.env.PROJECT_COMMANDER_AUTOMATION_TOKEN
  || '',
).trim();

const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const toOptionalInteger = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const isRawCommandAllowed = (options = {}) => {
  if (typeof options.allowRawCommands === 'boolean') {
    return options.allowRawCommands;
  }
  return isTruthy(process.env.PROJECT_COMMANDER_ALLOW_RAW_COMMANDS)
    || isTruthy(process.env.PROJECT_COMMANDER_MCP_ALLOW_RAW_COMMANDS);
};

class CommanderGraphQLError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CommanderGraphQLError';
    this.status = details.status || null;
    this.errors = details.errors || [];
    this.payload = details.payload || null;
  }
}

const normalizeEnvEntries = (env) => {
  if (Array.isArray(env)) {
    return env
      .map((entry) => ({
        key: String(entry?.key || '').trim(),
        value: entry?.value == null ? '' : String(entry.value),
      }))
      .filter((entry) => entry.key);
  }
  if (env && typeof env === 'object') {
    return Object.entries(env)
      .map(([key, value]) => ({
        key: String(key || '').trim(),
        value: value == null ? '' : String(value),
      }))
      .filter((entry) => entry.key);
  }
  return [];
};

const normalizeJsonString = (...values) => {
  const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '');
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
};

const isTransientGraphQLError = (error) => {
  if (!error) {
    return false;
  }
  if (error.status && error.status >= 500) {
    return true;
  }
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(String(error.message || ''));
};

const normalizeProjectRecord = (project, hosts = []) => {
  const hostId = Number(project?.hostId);
  const host = Number.isInteger(hostId)
    ? hosts.find((candidate) => Number(candidate?.id) === hostId)
    : null;
  const hostProject = host?.projects?.find((candidate) => candidate?.path === project?.path) || null;
  return {
    id: toOptionalInteger(hostProject?.id),
    name: project?.name || hostProject?.name || '',
    path: project?.path || hostProject?.path || '',
    relativePath: project?.relativePath || '',
    hostId: Number.isInteger(hostId) ? hostId : null,
    hostName: project?.hostName || host?.name || null,
    hostAgentUuid: host?.agentUuid || null,
    services: Array.isArray(project?.services) ? project.services : [],
    types: Array.isArray(project?.types) ? project.types : [],
    hasMakefile: Boolean(project?.hasMakefile),
    runtimeStatus: project?.runtimeStatus || 'unknown',
    runtimePid: toOptionalInteger(project?.runtimePid),
    runtimePorts: Array.isArray(project?.runtimePorts) ? project.runtimePorts : [],
  };
};

const matchesString = (value, expected) => {
  const normalizedValue = String(value || '').trim().toLowerCase();
  const normalizedExpected = String(expected || '').trim().toLowerCase();
  return normalizedValue && normalizedExpected && normalizedValue === normalizedExpected;
};

const findHost = (hosts, selector = {}) => {
  const hostId = Number(selector.hostId || selector.id);
  const hostName = selector.host || selector.hostName || selector.name;
  const agentUuid = selector.agentUuid || selector.slaveId || selector.host;
  const ip = selector.ip || selector.host;
  return hosts.find((host) => (
    (Number.isInteger(hostId) && Number(host.id) === hostId)
    || matchesString(host.name, hostName)
    || matchesString(host.agentUuid, agentUuid)
    || matchesString(host.ip, ip)
  )) || null;
};

const findProject = (projects, selector = {}) => {
  const projectId = Number(selector.projectId || selector.id);
  const projectName = selector.project || selector.projectName || selector.name;
  const projectPath = selector.projectPath || selector.path;
  const hostId = Number(selector.hostId);
  return projects.find((project) => {
    const hostMatches = !Number.isInteger(hostId) || Number(project.hostId) === hostId;
    return hostMatches && (
      (Number.isInteger(projectId) && Number(project.id) === projectId)
      || matchesString(project.name, projectName)
      || String(project.path || '').trim() === String(projectPath || '').trim()
    );
  }) || null;
};

const normalizeDesiredProcessInput = (input = {}, actor = 'commander-client') => ({
  desiredProcessId: toOptionalInteger(input.desiredProcessId),
  hostId: toOptionalInteger(input.hostId),
  agentUuid: String(input.agentUuid || input.slaveId || '').trim() || null,
  projectId: toOptionalInteger(input.projectId),
  projectPath: String(input.projectPath || '').trim() || null,
  serviceId: toOptionalInteger(input.serviceId),
  processKey: String(input.processKey || input.packageKey || '').trim() || null,
  packageKey: String(input.packageKey || input.processKey || '').trim() || null,
  packageRelativePath: String(input.packageRelativePath || '.').trim() || '.',
  desiredState: String(input.desiredState || 'running').trim() || 'running',
  launchMode: String(input.launchMode || 'exec').trim() || 'exec',
  cwd: String(input.cwd || '').trim(),
  command: String(input.command || '').trim(),
  args: Array.isArray(input.args) ? input.args.map((value) => String(value)).filter(Boolean) : [],
  env: normalizeEnvEntries(input.env),
  logRoot: String(input.logRoot || '').trim() || null,
  restartPolicy: String(input.restartPolicy || 'manual').trim() || 'manual',
  createdBy: String(input.createdBy || actor).trim() || actor,
  updatedBy: String(input.updatedBy || input.createdBy || actor).trim() || actor,
});

class CommanderClient {
  constructor(options = {}) {
    this.endpoint = normalizeEndpoint(options);
    this.token = normalizeToken(options);
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.actor = options.actor || 'commander-client';
    this.toolName = options.toolName || this.actor;
    this.allowRawCommands = isRawCommandAllowed(options);
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch is required to use commander-client');
    }
  }

  async graphql(query, variables = {}, options = {}) {
    const headers = {
      'content-type': 'application/json',
      'x-project-commander-tool': String(options.toolName || this.toolName || this.actor),
      ...(options.headers || {}),
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CommanderGraphQLError(
        payload?.errors?.[0]?.message || payload?.error || `GraphQL request failed (${response.status})`,
        { status: response.status, payload, errors: payload?.errors || [] },
      );
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new CommanderGraphQLError(
        payload.errors.map((entry) => entry?.message).filter(Boolean).join('; ') || 'GraphQL returned errors',
        { status: response.status, payload, errors: payload.errors },
      );
    }
    return payload.data || {};
  }

  async read(query, variables = {}, options = {}) {
    const retries = toOptionalInteger(options.retries) ?? READ_RETRY_COUNT;
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await this.graphql(query, variables, options);
      } catch (error) {
        lastError = error;
        if (attempt >= retries || !isTransientGraphQLError(error)) {
          throw error;
        }
        await delay(READ_RETRY_DELAY_MS * (attempt + 1));
      }
    }
    throw lastError;
  }

  async listHosts() {
    const data = await this.read(QUERY_HOSTS);
    return Array.isArray(data.hosts) ? data.hosts : [];
  }

  async listAutomationTokens(input = {}) {
    const data = await this.read(QUERY_AUTOMATION_TOKENS, {
      includeRevoked: Boolean(input.includeRevoked),
    });
    return Array.isArray(data.automationApiTokens) ? data.automationApiTokens : [];
  }

  async createAutomationToken(input = {}) {
    const data = await this.graphql(MUTATION_CREATE_AUTOMATION_TOKEN, {
      name: String(input.name || '').trim() || 'automation-token',
      accessMode: String(input.accessMode || 'observe').trim() || 'observe',
      scopes: Array.isArray(input.scopes) ? input.scopes.map((entry) => String(entry)).filter(Boolean) : [],
      allowedHostIds: Array.isArray(input.allowedHostIds)
        ? input.allowedHostIds.map((entry) => toOptionalInteger(entry)).filter((entry) => entry !== null)
        : [],
      allowedProjectIds: Array.isArray(input.allowedProjectIds)
        ? input.allowedProjectIds.map((entry) => toOptionalInteger(entry)).filter((entry) => entry !== null)
        : [],
      allowedPathPrefixes: Array.isArray(input.allowedPathPrefixes)
        ? input.allowedPathPrefixes.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
      rawCommandAllowed: Object.prototype.hasOwnProperty.call(input, 'rawCommandAllowed')
        ? Boolean(input.rawCommandAllowed)
        : null,
      fullAccess: Object.prototype.hasOwnProperty.call(input, 'fullAccess')
        ? Boolean(input.fullAccess)
        : null,
      expiresAt: input.expiresAt == null ? null : String(input.expiresAt),
    });
    return data.createAutomationApiToken || null;
  }

  async revokeAutomationToken(input = {}) {
    const data = await this.graphql(MUTATION_REVOKE_AUTOMATION_TOKEN, {
      id: toOptionalInteger(input.id),
    });
    return Boolean(data.revokeAutomationApiToken);
  }

  async listRuntimeAuditEvents(input = {}) {
    const data = await this.read(QUERY_RUNTIME_AUDIT_EVENTS, {
      limit: toOptionalInteger(input.limit),
      action: String(input.action || '').trim() || null,
      hostId: toOptionalInteger(input.hostId),
      projectId: toOptionalInteger(input.projectId),
      actorType: String(input.actorType || '').trim() || null,
    });
    return Array.isArray(data.runtimeAuditEvents) ? data.runtimeAuditEvents : [];
  }

  async listProjects(input = {}) {
    const data = await this.read(QUERY_PROJECTS);
    const hosts = Array.isArray(data.hosts) ? data.hosts : [];
    const discovered = Array.isArray(data.discoveredProjects?.projects)
      ? data.discoveredProjects.projects
      : [];
    const projects = discovered.map((project) => normalizeProjectRecord(project, hosts));
    const host = findHost(hosts, input);
    const hostId = Number(input.hostId || host?.id);
    if (Number.isInteger(hostId)) {
      return projects.filter((project) => Number(project.hostId) === hostId);
    }
    return projects;
  }

  async resolveHostAndProject(input = {}) {
    const data = await this.read(QUERY_PROJECTS);
    const hosts = Array.isArray(data.hosts) ? data.hosts : [];
    const projects = (Array.isArray(data.discoveredProjects?.projects)
      ? data.discoveredProjects.projects
      : []
    ).map((project) => normalizeProjectRecord(project, hosts));
    const host = findHost(hosts, input);
    if (!host) {
      throw new Error(`Unable to resolve host from ${JSON.stringify(input)}`);
    }
    const project = findProject(projects, { ...input, hostId: host.id });
    if (!project) {
      throw new Error(`Unable to resolve project from ${JSON.stringify(input)}`);
    }
    return { host, project };
  }

  async resolveTemplateContext(input = {}) {
    let hostId = toOptionalInteger(input.hostId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    let projectId = toOptionalInteger(input.projectId);
    let projectPath = String(input.projectPath || '').trim() || null;

    const hasNamedHostSelector = Boolean(input.host || input.hostName || input.agentUuid || input.slaveId);
    const hasProjectSelector = Boolean(input.project || input.projectName || input.projectId || input.projectPath);
    if (hasProjectSelector && (hasNamedHostSelector || hostId)) {
      const { host, project } = await this.resolveHostAndProject(input);
      hostId = Number(host.id);
      agentUuid = agentUuid || host.agentUuid || null;
      projectId = toOptionalInteger(project.id);
      projectPath = projectPath || project.path || null;
    } else if (!hostId && hasNamedHostSelector) {
      const hosts = await this.listHosts();
      const host = findHost(hosts, input);
      if (!host) {
        throw new Error(`Unable to resolve host from ${JSON.stringify(input)}`);
      }
      hostId = Number(host.id);
      agentUuid = agentUuid || host.agentUuid || null;
    }

    return {
      hostId,
      agentUuid,
      projectId,
      projectPath,
      codexPath: String(input.codexPath || '').trim() || null,
    };
  }

  async listProcessTemplates(input = {}) {
    const context = await this.resolveTemplateContext(input);
    const data = await this.read(QUERY_PROCESS_TEMPLATES, {
      ...context,
      includeDisabled: Boolean(input.includeDisabled),
      codexOnly: Object.prototype.hasOwnProperty.call(input, 'codexOnly')
        ? Boolean(input.codexOnly)
        : true,
      allowUnapproved: Boolean(input.allowUnapproved),
    });
    return Array.isArray(data.processTemplates) ? data.processTemplates : [];
  }

  async resolveProcessTemplate(input = {}) {
    const context = await this.resolveTemplateContext(input);
    const data = await this.read(QUERY_RESOLVE_PROCESS_TEMPLATE, {
      ...context,
      templateKey: String(input.templateKey || input.template || '').trim(),
      packageKey: String(input.packageKey || '').trim() || null,
      packageRelativePath: String(input.packageRelativePath || '').trim() || null,
      processKey: String(input.processKey || '').trim() || null,
      allowUnapproved: Boolean(input.allowUnapproved),
      codexOnly: Object.prototype.hasOwnProperty.call(input, 'codexOnly')
        ? Boolean(input.codexOnly)
        : true,
      env: normalizeEnvEntries(input.env),
    });
    return data.resolveProcessTemplate || null;
  }

  async ensureProcessFromTemplate(input = {}) {
    const context = await this.resolveTemplateContext(input);
    const data = await this.graphql(MUTATION_ENSURE_PROCESS_FROM_TEMPLATE, {
      ...context,
      templateKey: String(input.templateKey || input.template || '').trim(),
      packageKey: String(input.packageKey || '').trim() || null,
      packageRelativePath: String(input.packageRelativePath || '').trim() || null,
      processKey: String(input.processKey || '').trim() || null,
      desiredState: String(input.desiredState || '').trim() || null,
      launchMode: String(input.launchMode || '').trim() || null,
      cwd: String(input.cwd || '').trim() || null,
      command: String(input.command || '').trim() || null,
      args: Object.prototype.hasOwnProperty.call(input, 'args') && Array.isArray(input.args)
        ? input.args.map((value) => String(value)).filter(Boolean)
        : null,
      env: normalizeEnvEntries(input.env),
      logRoot: String(input.logRoot || '').trim() || null,
      restartPolicy: String(input.restartPolicy || '').trim() || null,
      allowUnapproved: Boolean(input.allowUnapproved),
      createdBy: String(input.createdBy || this.actor).trim() || this.actor,
      updatedBy: String(input.updatedBy || input.createdBy || this.actor).trim() || this.actor,
    });
    return data.ensureProcessFromTemplate || null;
  }

  async upsertProcessTemplate(input = {}) {
    const context = await this.resolveTemplateContext(input);
    const healthChecksJson = input.healthChecksJson == null && input.healthChecks == null
      ? null
      : (typeof (input.healthChecksJson ?? input.healthChecks) === 'string'
        ? String(input.healthChecksJson ?? input.healthChecks)
        : JSON.stringify(input.healthChecksJson ?? input.healthChecks));
    const data = await this.graphql(MUTATION_UPSERT_PROCESS_TEMPLATE, {
      id: toOptionalInteger(input.id),
      hostId: context.hostId,
      projectId: context.projectId,
      templateKey: String(input.templateKey || input.template || '').trim(),
      displayName: String(input.displayName || '').trim() || null,
      description: input.description == null ? null : String(input.description),
      packageKey: String(input.packageKey || '').trim() || null,
      packageRelativePath: String(input.packageRelativePath || '').trim() || null,
      processKeyTemplate: String(input.processKeyTemplate || '').trim() || null,
      cwdTemplate: String(input.cwdTemplate || '').trim() || null,
      desiredState: String(input.desiredState || '').trim() || null,
      launchMode: String(input.launchMode || '').trim() || null,
      command: String(input.command || '').trim(),
      args: Array.isArray(input.argsJson || input.args)
        ? (input.argsJson || input.args).map((value) => String(value)).filter(Boolean)
        : [],
      env: normalizeEnvEntries(input.envJson || input.env),
      restartPolicy: String(input.restartPolicy || '').trim() || null,
      healthChecksJson,
      logRoot: String(input.logRoot || '').trim() || null,
      enabled: Object.prototype.hasOwnProperty.call(input, 'enabled') ? Boolean(input.enabled) : null,
      allowCodex: Object.prototype.hasOwnProperty.call(input, 'allowCodex') ? Boolean(input.allowCodex) : null,
      createdBy: String(input.createdBy || this.actor).trim() || this.actor,
      updatedBy: String(input.updatedBy || input.createdBy || this.actor).trim() || this.actor,
    });
    return data.upsertProcessTemplate || null;
  }

  async deleteProcessTemplate(input = {}) {
    const data = await this.graphql(MUTATION_DELETE_PROCESS_TEMPLATE, {
      id: toOptionalInteger(input.id),
      hostId: toOptionalInteger(input.hostId),
      projectId: toOptionalInteger(input.projectId),
    });
    return Boolean(data.deleteProcessTemplate);
  }

  async listHostPathMappings(input = {}) {
    let hostId = toOptionalInteger(input.hostId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    if (!hostId && (input.host || input.hostName || input.agentUuid || input.slaveId)) {
      const hosts = await this.listHosts();
      const host = findHost(hosts, input);
      if (!host) {
        throw new Error(`Unable to resolve host from ${JSON.stringify(input)}`);
      }
      hostId = Number(host.id);
      agentUuid = agentUuid || host.agentUuid || null;
    }
    const data = await this.read(QUERY_HOST_PATH_MAPPINGS, {
      hostId,
      agentUuid,
      includeDisabled: Boolean(input.includeDisabled),
    });
    return Array.isArray(data.hostPathMappings) ? data.hostPathMappings : [];
  }

  async resolveHostPath(input = {}) {
    let hostId = toOptionalInteger(input.hostId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    if (!hostId && (input.host || input.hostName || input.agentUuid || input.slaveId || input.project)) {
      const hosts = await this.listHosts();
      const host = findHost(hosts, input);
      if (!host) {
        throw new Error(`Unable to resolve host from ${JSON.stringify(input)}`);
      }
      hostId = Number(host.id);
      agentUuid = agentUuid || host.agentUuid || null;
    }
    const data = await this.read(QUERY_RESOLVE_HOST_PATH, {
      hostId,
      agentUuid,
      path: String(input.path || input.codexPath || '').trim(),
      allowUnapproved: Boolean(input.allowUnapproved),
    });
    return data.resolveHostPath || null;
  }

  async upsertHostPathMapping(input = {}) {
    let hostId = toOptionalInteger(input.hostId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    if (!hostId && (input.host || input.hostName || input.agentUuid || input.slaveId)) {
      const hosts = await this.listHosts();
      const host = findHost(hosts, input);
      if (!host) {
        throw new Error(`Unable to resolve host from ${JSON.stringify(input)}`);
      }
      hostId = Number(host.id);
      agentUuid = agentUuid || host.agentUuid || null;
    }
    const data = await this.graphql(MUTATION_UPSERT_HOST_PATH_MAPPING, {
      id: toOptionalInteger(input.id),
      hostId,
      agentUuid,
      logicalRoot: String(input.logicalRoot || '').trim() || null,
      codexPathPrefix: String(input.codexPathPrefix || '').trim(),
      hostPathPrefix: String(input.hostPathPrefix || '').trim(),
      description: input.description == null ? null : String(input.description),
      enabled: Object.prototype.hasOwnProperty.call(input, 'enabled') ? Boolean(input.enabled) : null,
      allowUnapproved: Boolean(input.allowUnapproved),
      createdBy: String(input.createdBy || this.actor).trim() || this.actor,
      updatedBy: String(input.updatedBy || input.createdBy || this.actor).trim() || this.actor,
    });
    return data.upsertHostPathMapping || null;
  }

  async deleteHostPathMapping(input = {}) {
    const data = await this.graphql(MUTATION_DELETE_HOST_PATH_MAPPING, {
      id: toOptionalInteger(input.id),
      hostId: toOptionalInteger(input.hostId),
      agentUuid: String(input.agentUuid || input.slaveId || '').trim() || null,
    });
    return Boolean(data.deleteHostPathMapping);
  }

  async listDesiredProcesses(input = {}) {
    const variables = {
      hostId: toOptionalInteger(input.hostId),
      projectId: toOptionalInteger(input.projectId),
      agentUuid: String(input.agentUuid || input.slaveId || '').trim() || null,
      projectPath: String(input.projectPath || '').trim() || null,
      processKey: String(input.processKey || '').trim() || null,
      packageKey: String(input.packageKey || '').trim() || null,
      desiredState: String(input.desiredState || '').trim() || null,
      search: String(input.search || input.query || input.filter || '').trim() || null,
    };
    if (!variables.hostId && (input.host || input.hostName || input.project || input.projectPath)) {
      const { host, project } = await this.resolveHostAndProject(input);
      variables.hostId = Number(host.id);
      variables.agentUuid = host.agentUuid || variables.agentUuid;
      variables.projectId = toOptionalInteger(project.id);
      variables.projectPath = variables.projectPath || project.path || null;
    }
    const data = await this.read(QUERY_DESIRED_PROCESSES, variables);
    return Array.isArray(data.desiredProcesses) ? data.desiredProcesses : [];
  }

  async listObservedRuns(input = {}) {
    let hostId = toOptionalInteger(input.hostId);
    let projectId = toOptionalInteger(input.projectId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    let projectPath = String(input.projectPath || '').trim();
    if (!hostId && (input.host || input.hostName || input.project || input.projectPath)) {
      const { host, project } = await this.resolveHostAndProject(input);
      hostId = Number(host.id);
      projectId = toOptionalInteger(project.id);
      agentUuid = host.agentUuid || agentUuid;
      projectPath = projectPath || project.path || '';
    }
    const data = await this.read(QUERY_OBSERVED_RUNS, {
      hostId,
      projectId,
      agentUuid,
      projectPath: projectPath || null,
      processKey: String(input.processKey || '').trim() || null,
      packageKey: String(input.packageKey || '').trim() || null,
      status: String(input.status || '').trim() || null,
      runId: String(input.runId || '').trim() || null,
      pid: toOptionalInteger(input.pid),
      search: String(input.search || input.query || input.filter || '').trim() || null,
    });
    const runs = Array.isArray(data.observedProcessRuns) ? data.observedProcessRuns : [];
    return projectPath ? runs.filter((run) => run.projectPath === projectPath) : runs;
  }

  async ensureDesiredProcess(input = {}) {
    const variables = normalizeDesiredProcessInput(input, this.actor);
    const data = await this.graphql(MUTATION_ENSURE_DESIRED_PROCESS, variables);
    return data.ensureDesiredProcess || null;
  }

  async ensureProcess(input = {}) {
    if (input.template) {
      return this.ensureProcessFromTemplate({
        ...input,
        templateKey: input.template,
      });
    }
    if (!this.allowRawCommands || input.privilegedScope !== RAW_COMMAND_SCOPE) {
      throw new Error(
        'Raw process definitions are disabled by default; use a safe template or set PROJECT_COMMANDER_MCP_ALLOW_RAW_COMMANDS=true and pass privilegedScope="raw-command".',
      );
    }
    const resolvedCodexPath = input.codexPath && !input.cwd
      ? await this.resolveHostPath(input)
      : null;
    return this.ensureDesiredProcess({
      ...input,
      cwd: resolvedCodexPath?.hostPath || input.cwd,
    });
  }

  async deleteDesiredProcess(input = {}) {
    const data = await this.graphql(MUTATION_DELETE_DESIRED_PROCESS, {
      desiredProcessId: toOptionalInteger(input.desiredProcessId),
      hostId: toOptionalInteger(input.hostId),
      agentUuid: String(input.agentUuid || input.slaveId || '').trim() || null,
      projectId: toOptionalInteger(input.projectId),
      projectPath: String(input.projectPath || '').trim() || null,
      packageKey: String(input.packageKey || '').trim() || null,
      processKey: String(input.processKey || '').trim() || null,
    });
    return Boolean(data.deleteDesiredProcessDefinition);
  }

  async killProcess(input = {}) {
    const hard = Boolean(input.hard);
    let hostId = toOptionalInteger(input.hostId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    if (!hostId && (input.host || input.hostName || input.project || input.projectPath)) {
      const { host } = await this.resolveHostAndProject(input);
      hostId = Number(host.id);
      agentUuid = host.agentUuid || agentUuid;
    }
    const data = await this.graphql(
      hard ? MUTATION_HARD_KILL_PROCESS : MUTATION_SOFT_KILL_PROCESS,
      {
        hostId,
        agentUuid,
        runId: String(input.runId || '').trim() || null,
        processKey: String(input.processKey || '').trim() || null,
        pid: toOptionalInteger(input.pid),
        reason: String(input.reason || '').trim() || null,
      },
    );
    return hard ? data.hardKillProcess : data.softKillProcess;
  }

  async restartProcess(input = {}) {
    const runs = await this.listObservedRuns(input);
    const processKey = String(input.processKey || input.packageKey || '').trim();
    const runningRuns = runs.filter((run) => {
      const status = String(run.status || '').toLowerCase();
      const matchesProcess = !processKey || run.processKey === processKey || run.packageKey === processKey;
      return matchesProcess && !['exited', 'failed', 'killed', 'replaced'].includes(status);
    });
    const kills = [];
    for (const run of runningRuns) {
      kills.push(await this.killProcess({
        ...input,
        hostId: run.hostId || input.hostId,
        agentUuid: run.slaveId || input.agentUuid,
        runId: run.runId,
        processKey: run.processKey,
        pid: run.pid,
        hard: Boolean(input.hard),
        reason: input.reason || 'restart requested by commander lifecycle proxy',
      }));
    }
    return {
      killedRuns: kills,
      matchedRuns: runningRuns,
      message: runningRuns.length > 0
        ? 'restart requested by killing current runs; slave reconciliation should relaunch desired process'
        : 'no running process matched restart request',
    };
  }

  async tailProcessLog(input = {}) {
    let hostId = toOptionalInteger(input.hostId);
    let agentUuid = String(input.agentUuid || input.slaveId || '').trim() || null;
    let projectPath = String(input.projectPath || '').trim();
    if (!hostId && (input.host || input.hostName || input.project || input.projectPath)) {
      const { host, project } = await this.resolveHostAndProject(input);
      hostId = Number(host.id);
      agentUuid = host.agentUuid || agentUuid;
      projectPath = projectPath || project.path || '';
    }
    const data = await this.read(QUERY_HOST_LOGS, {
      hostId,
      agentUuid,
      limit: toOptionalInteger(input.limit) ?? 200,
      afterId: toOptionalInteger(input.afterId),
      serviceNames: Array.isArray(input.serviceNames) ? input.serviceNames : null,
    });
    const logs = Array.isArray(data.hostLogs) ? data.hostLogs : [];
    return projectPath ? logs.filter((entry) => entry.projectPath === projectPath) : logs;
  }

  async waitForRuntime(input = {}) {
    const context = await this.resolveTemplateContext(input);
    const data = await this.read(QUERY_WAIT_FOR_RUNTIME, {
      ...context,
      runId: String(input.runId || '').trim() || null,
      processKey: String(input.processKey || '').trim() || null,
      packageKey: String(input.packageKey || '').trim() || null,
      templateKey: String(input.templateKey || input.template || '').trim() || null,
      status: String(input.status || '').trim() || null,
      expectedStatus: String(input.expectedStatus || input.httpStatus || '').trim() || null,
      expectedExitCode: toOptionalInteger(input.expectedExitCode),
      timeoutMs: toOptionalInteger(input.timeoutMs),
      intervalMs: toOptionalInteger(input.intervalMs),
      healthChecksJson: normalizeJsonString(input.healthChecksJson, input.healthChecks, input.checks),
      url: String(input.url || '').trim() || null,
      method: String(input.method || '').trim() || null,
      bodyIncludes: String(input.bodyIncludes || '').trim() || null,
      port: toOptionalInteger(input.port),
      tcpHost: String(input.tcpHost || input.hostIp || input.ip || '').trim() || null,
      pattern: String(input.pattern || '').trim() || null,
      graphqlEndpoint: String(input.graphqlEndpoint || input.graphqlUrl || '').trim() || null,
      graphqlQuery: String(input.query || input.graphqlQuery || '').trim() || null,
      variablesJson: normalizeJsonString(input.variablesJson, input.variables),
    }, {
      retries: 0,
    });
    return data.waitForRuntime || null;
  }
}

const createCommanderClient = (options = {}) => new CommanderClient(options);

module.exports = {
  CommanderClient,
  CommanderGraphQLError,
  buildDesiredProcessInputFromTemplate,
  createCommanderClient,
  inferProcessTemplates,
  RAW_COMMAND_SCOPE,
  normalizeDesiredProcessInput,
  resolveTemplate,
};
