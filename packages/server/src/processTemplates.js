const path = require('path');
const {
  Host,
  Project,
  ProcessTemplate,
} = require('./models');
const {
  normalizePathPrefix,
} = require('./hostPathMappings');

const toPlainRecord = (value) => (
  value && typeof value?.get === 'function'
    ? value.get({ plain: true })
    : value
);

const normalizeOptionalInteger = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeTemplateKey = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('templateKey is required');
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new Error(`templateKey contains unsupported characters: ${normalized}`);
  }
  return normalized;
};

const normalizeLaunchMode = (value) => {
  const normalized = String(value || 'shell').trim().toLowerCase();
  if (!['exec', 'shell'].includes(normalized)) {
    throw new Error('launchMode must be exec or shell');
  }
  return normalized;
};

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'project';

const parseStructuredValue = (value, fallback) => {
  if (Array.isArray(fallback)) {
    if (Array.isArray(value)) {
      return value;
    }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(fallback)) {
        return Array.isArray(parsed) ? parsed : fallback;
      }
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const normalizeEnvObject = (env) => {
  if (Array.isArray(env)) {
    return env.reduce((accumulator, entry) => {
      const key = String(entry?.key || '').trim();
      if (!key) {
        return accumulator;
      }
      accumulator[key] = entry?.value == null ? '' : String(entry.value);
      return accumulator;
    }, {});
  }
  return parseStructuredValue(env, {});
};

const normalizeStringArray = (value) => parseStructuredValue(value, [])
  .map((entry) => String(entry || '').trim())
  .filter(Boolean);

const getMetadata = (record) => {
  const plain = toPlainRecord(record);
  const raw = plain?.metadata;
  if (raw && typeof raw === 'object') {
    return raw;
  }
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const getProjectPath = (project) => {
  const plain = toPlainRecord(project);
  return String(plain?.metadata?.path || plain?.path || '').trim() || null;
};

const getProjectTypes = (project) => {
  const plain = toPlainRecord(project);
  const metadata = getMetadata(plain);
  const directTypes = Array.isArray(plain?.types) ? plain.types : [];
  const metadataTypes = Array.isArray(metadata.types) ? metadata.types : [];
  const technologyTypes = Array.isArray(plain?.technologies)
    ? plain.technologies.map((entry) => entry?.key || entry?.name).filter(Boolean)
    : [];
  return Array.from(new Set([...directTypes, ...metadataTypes, ...technologyTypes].map((entry) => String(entry || '').trim()).filter(Boolean)));
};

const projectSupportsNode = (project) => getProjectTypes(project).some((type) => type.startsWith('node-'));
const projectSupportsMake = (project) => {
  const plain = toPlainRecord(project);
  const metadata = getMetadata(plain);
  return Boolean(plain?.hasMakefile || metadata.hasMakefile || getProjectTypes(project).includes('make-project'));
};

const hasKnownProjectShape = (project) => {
  const plain = toPlainRecord(project);
  const metadata = getMetadata(plain);
  return getProjectTypes(project).length > 0 || Object.prototype.hasOwnProperty.call(plain || {}, 'hasMakefile') || Object.prototype.hasOwnProperty.call(metadata, 'hasMakefile');
};

const createInferredTemplate = ({
  templateKey,
  displayName,
  description,
  packageKey,
  command,
  desiredState = 'running',
  launchMode = 'shell',
  restartPolicy = 'manual',
  argsJson = [],
}) => ({
  id: null,
  hostId: null,
  projectId: null,
  templateKey,
  displayName,
  description,
  packageKey,
  packageRelativePath: '.',
  processKeyTemplate: '{{package.key}}',
  cwdTemplate: '{{project.hostPath}}',
  desiredState,
  launchMode,
  command,
  argsJson,
  envJson: {},
  restartPolicy,
  healthChecksJson: [],
  logRoot: null,
  enabled: true,
  allowCodex: true,
  source: 'inferred',
  scope: 'inferred',
  precedence: 0,
  createdBy: null,
  updatedBy: null,
  createdAt: null,
  updatedAt: null,
});

const inferDefaultProcessTemplates = ({ project } = {}) => {
  const knownShape = hasKnownProjectShape(project);
  const projectName = String(toPlainRecord(project)?.name || '').trim() || 'project';
  const templates = [];
  if (!knownShape || projectSupportsNode(project)) {
    templates.push(createInferredTemplate({
      templateKey: 'node.dev',
      displayName: 'Node development server',
      description: 'Run yarn dev in the project root.',
      packageKey: 'main',
      command: 'yarn dev',
    }));
    templates.push(createInferredTemplate({
      templateKey: 'node.build',
      displayName: 'Node build',
      description: 'Run yarn build in the project root.',
      packageKey: 'build',
      command: 'yarn build',
      desiredState: 'stopped',
    }));
    templates.push(createInferredTemplate({
      templateKey: 'node.test',
      displayName: 'Node tests',
      description: 'Run yarn test in the project root.',
      packageKey: 'test',
      command: 'yarn test',
      desiredState: 'stopped',
    }));
  }

  templates.push(createInferredTemplate({
    templateKey: 'docker.compose.up',
    displayName: 'Docker Compose up',
    description: 'Run docker compose up -d in the project root.',
    packageKey: 'docker-compose',
    command: 'docker compose up -d',
  }));
  templates.push(createInferredTemplate({
    templateKey: 'docker.compose.down',
    displayName: 'Docker Compose down',
    description: 'Run docker compose down in the project root.',
    packageKey: 'docker-compose-down',
    command: 'docker compose down',
    desiredState: 'stopped',
  }));
  templates.push(createInferredTemplate({
    templateKey: 'docker.compose.clearbox.up',
    displayName: 'Docker Compose clearbox up',
    description: 'Run the clearbox-specific docker compose file if present.',
    packageKey: 'docker-compose-clearbox',
    command: `docker compose -f docker-compose.clearbox.yml -p ${slugify(projectName)} up -d`,
  }));
  templates.push(createInferredTemplate({
    templateKey: 'docker-compose-web',
    displayName: 'Docker Compose web stack',
    description: 'Compatibility alias for the clearbox docker compose web/server stack.',
    packageKey: 'docker-compose-web',
    command: `docker compose -f docker-compose.clearbox.yml -p ${slugify(projectName)} up -d`,
  }));

  if (!knownShape || projectSupportsMake(project)) {
    templates.push(createInferredTemplate({
      templateKey: 'make.start',
      displayName: 'Make start',
      description: 'Run make start in the project root.',
      packageKey: 'main',
      command: 'make start',
    }));
    templates.push(createInferredTemplate({
      templateKey: 'make.test',
      displayName: 'Make test',
      description: 'Run make test in the project root.',
      packageKey: 'test',
      command: 'make test',
      desiredState: 'stopped',
    }));
  }

  return templates;
};

const getTemplateScope = (template) => {
  const hostScoped = normalizeOptionalInteger(template.hostId) != null;
  const projectScoped = normalizeOptionalInteger(template.projectId) != null;
  if (hostScoped && projectScoped) {
    return { scope: 'host_project', precedence: 400 };
  }
  if (projectScoped) {
    return { scope: 'project', precedence: 300 };
  }
  if (hostScoped) {
    return { scope: 'host', precedence: 200 };
  }
  return { scope: 'global', precedence: 100 };
};

const mapProcessTemplate = (template, extra = {}) => {
  const record = toPlainRecord(template);
  if (!record) {
    return null;
  }
  const scope = extra.scope ? extra : getTemplateScope(record);
  return {
    id: normalizeOptionalInteger(record.id),
    hostId: normalizeOptionalInteger(record.hostId),
    projectId: normalizeOptionalInteger(record.projectId),
    templateKey: String(record.templateKey || '').trim(),
    displayName: String(record.displayName || record.templateKey || '').trim(),
    description: record.description ? String(record.description) : null,
    packageKey: String(record.packageKey || record.templateKey || '').trim(),
    packageRelativePath: String(record.packageRelativePath || '.').trim() || '.',
    processKeyTemplate: String(record.processKeyTemplate || '{{package.key}}').trim() || '{{package.key}}',
    cwdTemplate: String(record.cwdTemplate || '{{project.hostPath}}').trim() || '{{project.hostPath}}',
    desiredState: String(record.desiredState || 'running').trim() || 'running',
    launchMode: String(record.launchMode || 'shell').trim() || 'shell',
    command: String(record.command || '').trim(),
    argsJson: normalizeStringArray(record.argsJson),
    envJson: normalizeEnvObject(record.envJson),
    restartPolicy: String(record.restartPolicy || 'manual').trim() || 'manual',
    healthChecksJson: parseStructuredValue(record.healthChecksJson, []),
    logRoot: record.logRoot ? String(record.logRoot).trim() : null,
    enabled: record.enabled !== false,
    allowCodex: record.allowCodex !== false,
    source: extra.source || record.source || 'persisted',
    scope: scope.scope,
    precedence: scope.precedence,
    createdBy: record.createdBy ? String(record.createdBy) : null,
    updatedBy: record.updatedBy ? String(record.updatedBy) : null,
    createdAt: record.createdAt ? String(record.createdAt) : null,
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
  };
};

const selectHighestPrecedenceTemplates = (templates) => {
  const byKey = new Map();
  for (const template of templates) {
    if (!template?.templateKey) {
      continue;
    }
    const existing = byKey.get(template.templateKey);
    const existingId = normalizeOptionalInteger(existing?.id) || 0;
    const templateId = normalizeOptionalInteger(template?.id) || 0;
    if (
      !existing
      || Number(template.precedence || 0) > Number(existing.precedence || 0)
      || (Number(template.precedence || 0) === Number(existing.precedence || 0) && templateId > existingId)
    ) {
      byKey.set(template.templateKey, template);
    }
  }
  return Array.from(byKey.values()).sort((left, right) => left.templateKey.localeCompare(right.templateKey));
};

const readContextValue = (context, variableName) => {
  const parts = String(variableName || '').trim().split('.').filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  if (!['host', 'project', 'package', 'env'].includes(parts[0])) {
    throw new Error(`Unsupported template variable: ${variableName}`);
  }
  let current = context;
  for (const part of parts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(current, part)) {
      return '';
    }
    current = current[part];
  }
  return current == null ? '' : String(current);
};

const compileTemplateString = (value, context) => String(value || '').replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, variableName) => readContextValue(context, variableName));

const normalizeCompiledPath = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  return path.posix.normalize(normalized.replace(/\\/g, '/'));
};

const createProcessTemplateCatalog = ({
  models = {},
  hostPathMappings = null,
  processRegistry = null,
  logger = console,
} = {}) => {
  const HostModel = models.Host || Host;
  const ProjectModel = models.Project || Project;
  const ProcessTemplateModel = models.ProcessTemplate || ProcessTemplate;

  const findHost = async ({ hostId, agentUuid } = {}) => {
    const parsedHostId = normalizeOptionalInteger(hostId);
    if (parsedHostId) {
      return HostModel.findByPk(parsedHostId);
    }
    const normalizedAgentUuid = String(agentUuid || '').trim();
    if (normalizedAgentUuid) {
      return HostModel.findOne({ where: { agentUuid: normalizedAgentUuid } });
    }
    return null;
  };

  const loadProjects = async (hostId) => {
    if (!hostId) {
      return [];
    }
    return ProjectModel.findAll({ where: { hostId } });
  };

  const findProject = async ({ host, projectId, projectPath, codexPath, allowUnapproved } = {}) => {
    const hostRecord = toPlainRecord(host);
    const hostId = normalizeOptionalInteger(hostRecord?.id);
    const parsedProjectId = normalizeOptionalInteger(projectId);
    if (parsedProjectId) {
      const project = await ProjectModel.findByPk(parsedProjectId);
      const projectRecord = toPlainRecord(project);
      if (projectRecord && hostId && normalizeOptionalInteger(projectRecord.hostId) !== hostId) {
        return null;
      }
      return project;
    }
    const projects = await loadProjects(hostId);
    let targetPath = String(projectPath || '').trim();
    if (codexPath && hostPathMappings && typeof hostPathMappings.resolveHostPath === 'function') {
      const resolved = await hostPathMappings.resolveHostPath({
        hostId,
        agentUuid: hostRecord?.agentUuid,
        path: codexPath,
        allowUnapproved,
      });
      targetPath = String(resolved?.hostPath || '').trim() || targetPath;
    }
    if (!targetPath) {
      return null;
    }
    let normalizedTargetPath = '';
    try {
      normalizedTargetPath = normalizePathPrefix(targetPath, 'projectPath');
    } catch {
      normalizedTargetPath = targetPath.replace(/\\/g, '/').replace(/\/+$/g, '');
    }
    return projects.find((project) => getProjectPath(project) === normalizedTargetPath) || null;
  };

  const resolveHostAndProject = async (input = {}) => {
    const host = await findHost(input);
    if (!host && (input.hostId || input.agentUuid)) {
      throw new Error('Host not found for process template operation');
    }
    const project = host
      ? await findProject({ host, ...input })
      : null;
    if ((input.projectId || input.projectPath || input.codexPath) && !project) {
      throw new Error('Project not found for process template operation');
    }
    return { host, project };
  };

  const loadPersistedTemplates = async ({ host, project } = {}) => {
    const hostId = normalizeOptionalInteger(toPlainRecord(host)?.id);
    const projectId = normalizeOptionalInteger(toPlainRecord(project)?.id);
    const records = await ProcessTemplateModel.findAll({});
    return records
      .map((record) => mapProcessTemplate(record))
      .filter(Boolean)
      .filter((template) => {
        const templateHostId = normalizeOptionalInteger(template.hostId);
        const templateProjectId = normalizeOptionalInteger(template.projectId);
        const hostMatches = templateHostId == null || (hostId != null && templateHostId === hostId);
        const projectMatches = templateProjectId == null || (projectId != null && templateProjectId === projectId);
        return hostMatches && projectMatches;
      });
  };

  const listProcessTemplates = async ({
    hostId,
    agentUuid,
    projectId,
    projectPath,
    codexPath,
    includeDisabled = false,
    codexOnly = true,
    allowUnapproved = false,
  } = {}) => {
    const { host, project } = await resolveHostAndProject({
      hostId,
      agentUuid,
      projectId,
      projectPath,
      codexPath,
      allowUnapproved,
    });
    const persisted = await loadPersistedTemplates({ host, project });
    const inferred = inferDefaultProcessTemplates({ host, project }).map((template) => mapProcessTemplate(template, {
      source: 'inferred',
      scope: 'inferred',
      precedence: 0,
    }));
    return selectHighestPrecedenceTemplates([...inferred, ...persisted])
      .filter((template) => includeDisabled || template.enabled)
      .filter((template) => !codexOnly || template.allowCodex);
  };

  const resolveProcessTemplate = async (input = {}) => {
    const templateKey = normalizeTemplateKey(input.templateKey || input.template);
    const { host, project } = await resolveHostAndProject(input);
    if (!host) {
      throw new Error('hostId or agentUuid is required to resolve a process template');
    }
    if (!project) {
      throw new Error('projectId, projectPath, or codexPath is required to resolve a process template');
    }
    const templates = await listProcessTemplates({
      ...input,
      includeDisabled: true,
      codexOnly: false,
    });
    const template = templates.find((candidate) => candidate.templateKey === templateKey) || null;
    if (!template) {
      throw new Error(`Process template not found: ${templateKey}`);
    }
    if (!template.enabled) {
      throw new Error(`Process template is disabled: ${templateKey}`);
    }
    if (input.codexOnly !== false && !template.allowCodex) {
      throw new Error(`Process template is not available to Codex: ${templateKey}`);
    }
    const desiredProcess = await compileProcessTemplate({ template, host, project, input });
    return {
      host,
      project,
      template,
      desiredProcess,
      healthChecksJson: template.healthChecksJson,
    };
  };

  const compileProcessTemplate = async ({ template, host, project, input = {} }) => {
    const hostRecord = toPlainRecord(host);
    const projectRecord = toPlainRecord(project);
    const hostId = normalizeOptionalInteger(hostRecord?.id);
    const projectId = normalizeOptionalInteger(projectRecord?.id);
    const projectHostPath = input.codexPath && hostPathMappings && typeof hostPathMappings.resolveHostPath === 'function'
      ? String((await hostPathMappings.resolveHostPath({
        hostId,
        agentUuid: hostRecord?.agentUuid,
        path: input.codexPath,
        allowUnapproved: input.allowUnapproved,
      }))?.hostPath || '').trim()
      : (String(input.projectPath || '').trim() || getProjectPath(projectRecord));
    const projectCodexPath = String(input.codexPath || projectHostPath || '').trim();
    const inputEnv = normalizeEnvObject(input.env);
    const templateEnv = normalizeEnvObject(template.envJson);
    const env = { ...templateEnv, ...inputEnv };
    const packageKeyTemplate = input.packageKey || template.packageKey || template.templateKey;
    const packageKey = compileTemplateString(packageKeyTemplate, {
      host: {}, project: {}, package: {}, env,
    }).trim() || template.templateKey;
    const packageRelativePath = compileTemplateString(
      input.packageRelativePath || template.packageRelativePath || '.',
      { host: {}, project: {}, package: { key: packageKey }, env },
    ).trim() || '.';
    const context = {
      host: {
        name: String(hostRecord?.name || '').trim(),
        agentUuid: String(hostRecord?.agentUuid || '').trim(),
        ip: String(hostRecord?.ip || '').trim(),
      },
      project: {
        name: String(projectRecord?.name || '').trim(),
        hostPath: projectHostPath,
        codexPath: projectCodexPath,
      },
      package: {
        key: packageKey,
        relativePath: packageRelativePath,
      },
      env,
    };
    const processKey = compileTemplateString(input.processKey || template.processKeyTemplate, context).trim() || packageKey;
    const cwd = normalizeCompiledPath(compileTemplateString(input.cwd || template.cwdTemplate, context));
    const command = compileTemplateString(input.command || template.command, context).trim();
    if (!hostId || !projectId || !cwd || !command || !packageKey || !processKey) {
      throw new Error('Process template did not compile to a valid desired process input');
    }
    const args = Array.isArray(input.args)
      ? input.args.map((entry) => compileTemplateString(entry, context)).filter(Boolean)
      : normalizeStringArray(template.argsJson).map((entry) => compileTemplateString(entry, context)).filter(Boolean);
    const logRoot = input.logRoot || template.logRoot
      ? compileTemplateString(input.logRoot || template.logRoot, context).trim()
      : null;
    return {
      hostId,
      slaveId: String(hostRecord?.agentUuid || input.agentUuid || '').trim() || null,
      projectId,
      projectPath: projectHostPath,
      serviceId: normalizeOptionalInteger(input.serviceId),
      processKey,
      packageKey,
      packageRelativePath,
      desiredState: String(input.desiredState || template.desiredState || 'running').trim() || 'running',
      launchMode: normalizeLaunchMode(input.launchMode || template.launchMode),
      cwd,
      command,
      argsJson: args,
      envJson: env,
      logRoot,
      restartPolicy: String(input.restartPolicy || template.restartPolicy || 'manual').trim() || 'manual',
      createdBy: String(input.createdBy || 'process-template').trim() || 'process-template',
      updatedBy: String(input.updatedBy || input.createdBy || 'process-template').trim() || 'process-template',
    };
  };

  const ensureProcessFromTemplate = async (input = {}) => {
    if (!processRegistry || typeof processRegistry.ensureDesiredProcess !== 'function') {
      throw new Error('processRegistry.ensureDesiredProcess is required for ensureProcessFromTemplate');
    }
    const resolved = await resolveProcessTemplate(input);
    const desiredProcess = await processRegistry.ensureDesiredProcess(resolved.desiredProcess);
    return {
      host: resolved.host,
      project: resolved.project,
      template: resolved.template,
      desiredProcess,
      healthChecksJson: resolved.healthChecksJson,
    };
  };

  const upsertProcessTemplate = async (input = {}) => {
    const templateKey = normalizeTemplateKey(input.templateKey || input.template);
    const hostId = normalizeOptionalInteger(input.hostId);
    const projectId = normalizeOptionalInteger(input.projectId);
    if (hostId && !(await HostModel.findByPk(hostId))) {
      throw new Error(`Host not found: ${hostId}`);
    }
    if (projectId && !(await ProjectModel.findByPk(projectId))) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const payload = {
      hostId,
      projectId,
      templateKey,
      displayName: String(input.displayName || templateKey).trim() || templateKey,
      description: input.description == null ? null : String(input.description),
      packageKey: String(input.packageKey || templateKey).trim() || templateKey,
      packageRelativePath: String(input.packageRelativePath || '.').trim() || '.',
      processKeyTemplate: String(input.processKeyTemplate || '{{package.key}}').trim() || '{{package.key}}',
      cwdTemplate: String(input.cwdTemplate || '{{project.hostPath}}').trim() || '{{project.hostPath}}',
      desiredState: String(input.desiredState || 'running').trim() || 'running',
      launchMode: normalizeLaunchMode(input.launchMode),
      command: String(input.command || '').trim(),
      argsJson: normalizeStringArray(input.argsJson || input.args),
      envJson: normalizeEnvObject(input.envJson || input.env),
      restartPolicy: String(input.restartPolicy || 'manual').trim() || 'manual',
      healthChecksJson: parseStructuredValue(input.healthChecksJson || input.healthChecks, []),
      logRoot: input.logRoot == null ? null : String(input.logRoot).trim() || null,
      enabled: input.enabled !== false,
      allowCodex: input.allowCodex !== false,
      createdBy: String(input.createdBy || '').trim() || null,
      updatedBy: String(input.updatedBy || input.createdBy || '').trim() || null,
    };
    if (!payload.command) {
      throw new Error('command is required');
    }

    const id = normalizeOptionalInteger(input.id);
    let existing = id ? await ProcessTemplateModel.findByPk(id) : null;
    if (!existing) {
      const records = await ProcessTemplateModel.findAll({});
      existing = records.find((record) => {
        const candidate = toPlainRecord(record);
        return normalizeOptionalInteger(candidate?.hostId) === hostId
          && normalizeOptionalInteger(candidate?.projectId) === projectId
          && String(candidate?.templateKey || '') === templateKey;
      }) || null;
    }
    if (existing) {
      const updatePayload = { ...payload };
      delete updatePayload.createdBy;
      await existing.update(updatePayload);
      return mapProcessTemplate(existing);
    }
    const created = await ProcessTemplateModel.create(payload);
    return mapProcessTemplate(created);
  };

  const deleteProcessTemplate = async ({ id, hostId, projectId } = {}) => {
    const parsedId = normalizeOptionalInteger(id);
    if (!parsedId) {
      throw new Error('id is required');
    }
    const where = { id: parsedId };
    const parsedHostId = normalizeOptionalInteger(hostId);
    const parsedProjectId = normalizeOptionalInteger(projectId);
    if (parsedHostId) {
      where.hostId = parsedHostId;
    }
    if (parsedProjectId) {
      where.projectId = parsedProjectId;
    }
    const deleted = await ProcessTemplateModel.destroy({ where });
    return Number(deleted) > 0;
  };

  return {
    compileProcessTemplate,
    deleteProcessTemplate,
    ensureProcessFromTemplate,
    inferDefaultProcessTemplates,
    listProcessTemplates,
    resolveProcessTemplate,
    upsertProcessTemplate,
    logger,
  };
};

module.exports = {
  compileTemplateString,
  createProcessTemplateCatalog,
  inferDefaultProcessTemplates,
  mapProcessTemplate,
  normalizeTemplateKey,
  slugify,
};
