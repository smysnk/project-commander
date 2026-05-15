const path = require('path');
const { Host, Project, HostPathMapping } = require('./models');

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

const normalizeAgentUuid = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

const normalizePathPrefix = (value, fieldName = 'path') => {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) {
    throw new Error(`${fieldName} is required`);
  }
  if (raw.includes('\0')) {
    throw new Error(`${fieldName} cannot contain null bytes`);
  }
  if (!raw.startsWith('/') && !raw.startsWith('~/')) {
    throw new Error(`${fieldName} must be an absolute path or ~/ path`);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '/') {
    return normalized;
  }
  return normalized.replace(/\/+$/u, '');
};

const pathStartsWithPrefix = (candidateInput, prefixInput) => {
  const candidate = normalizePathPrefix(candidateInput, 'candidate path');
  const prefix = normalizePathPrefix(prefixInput, 'path prefix');
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
};

const joinMappedPath = (hostPrefixInput, sourcePrefixInput, inputPathInput) => {
  const hostPrefix = normalizePathPrefix(hostPrefixInput, 'hostPathPrefix');
  const sourcePrefix = normalizePathPrefix(sourcePrefixInput, 'codexPathPrefix');
  const inputPath = normalizePathPrefix(inputPathInput, 'path');
  if (!pathStartsWithPrefix(inputPath, sourcePrefix)) {
    throw new Error(`path is not inside codexPathPrefix: ${sourcePrefix}`);
  }
  const suffix = inputPath.slice(sourcePrefix.length).replace(/^\/+/, '');
  return suffix ? path.posix.join(hostPrefix, suffix) : hostPrefix;
};

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

const getHostDirectories = (host) => {
  const plain = toPlainRecord(host);
  const metadata = getMetadata(plain);
  const directories = Array.isArray(plain?.directories)
    ? plain.directories
    : metadata.directories;
  return Array.isArray(directories)
    ? directories
      .map((entry) => {
        try {
          return normalizePathPrefix(entry, 'host directory');
        } catch {
          return null;
        }
      })
      .filter(Boolean)
    : [];
};

const uniquePaths = (paths) => {
  const seen = new Set();
  const unique = [];
  for (const candidate of paths) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    unique.push(candidate);
  }
  return unique;
};

const buildApprovedHostRoots = ({ host, projects = [] }) => uniquePaths([
  ...getHostDirectories(host),
  ...projects
    .map((project) => {
      const projectPath = getProjectPath(project);
      if (!projectPath) {
        return null;
      }
      try {
        return normalizePathPrefix(projectPath, 'project path');
      } catch {
        return null;
      }
    })
    .filter(Boolean),
]);

const findContainingRoot = (hostPath, approvedRoots = []) => {
  const normalizedHostPath = normalizePathPrefix(hostPath, 'hostPath');
  return approvedRoots
    .filter((root) => pathStartsWithPrefix(normalizedHostPath, root))
    .sort((left, right) => right.length - left.length)[0] || null;
};

const assertApprovedHostPath = (hostPath, approvedRoots = [], { allowUnapproved = false } = {}) => {
  const normalizedHostPath = normalizePathPrefix(hostPath, 'hostPath');
  const matchedRoot = findContainingRoot(normalizedHostPath, approvedRoots);
  if (matchedRoot || allowUnapproved) {
    return {
      approved: Boolean(matchedRoot),
      matchedRoot,
      hostPath: normalizedHostPath,
    };
  }
  throw new Error(`Resolved host path is outside approved host roots: ${normalizedHostPath}`);
};

const mapHostPathMapping = (mapping) => {
  const record = toPlainRecord(mapping);
  if (!record) {
    return null;
  }
  return {
    id: normalizeOptionalInteger(record.id),
    hostId: normalizeOptionalInteger(record.hostId),
    agentUuid: normalizeAgentUuid(record.agentUuid),
    logicalRoot: record.logicalRoot ? String(record.logicalRoot).trim() : null,
    codexPathPrefix: String(record.codexPathPrefix || '').trim(),
    hostPathPrefix: String(record.hostPathPrefix || '').trim(),
    description: record.description ? String(record.description) : null,
    enabled: record.enabled !== false,
    createdBy: record.createdBy ? String(record.createdBy) : null,
    updatedBy: record.updatedBy ? String(record.updatedBy) : null,
    createdAt: record.createdAt ? String(record.createdAt) : null,
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
  };
};

const createHostPathMappingCatalog = ({ models = {}, logger = console } = {}) => {
  const HostModel = models.Host || Host;
  const ProjectModel = models.Project || Project;
  const HostPathMappingModel = models.HostPathMapping || HostPathMapping;

  const findHost = async ({ hostId, agentUuid } = {}) => {
    const parsedHostId = normalizeOptionalInteger(hostId);
    if (parsedHostId) {
      return HostModel.findByPk(parsedHostId);
    }
    const normalizedAgentUuid = normalizeAgentUuid(agentUuid);
    if (normalizedAgentUuid) {
      return HostModel.findOne({ where: { agentUuid: normalizedAgentUuid } });
    }
    throw new Error('hostId or agentUuid is required');
  };

  const loadProjects = async (hostId) => ProjectModel.findAll({ where: { hostId } });

  const listHostPathMappings = async ({ hostId, agentUuid, includeDisabled = false } = {}) => {
    const host = await findHost({ hostId, agentUuid });
    if (!host) {
      return [];
    }
    const where = { hostId: Number(host.id) };
    if (!includeDisabled) {
      where.enabled = true;
    }
    const mappings = await HostPathMappingModel.findAll({ where });
    const normalizedAgentUuid = normalizeAgentUuid(agentUuid);
    return mappings
      .map((mapping) => mapHostPathMapping(mapping))
      .filter(Boolean)
      .filter((mapping) => !normalizedAgentUuid || !mapping.agentUuid || mapping.agentUuid === normalizedAgentUuid)
      .sort((left, right) => left.codexPathPrefix.localeCompare(right.codexPathPrefix));
  };

  const resolveHostPath = async ({ hostId, agentUuid, path: inputPath, allowUnapproved = false } = {}) => {
    const host = await findHost({ hostId, agentUuid });
    if (!host) {
      throw new Error('Host not found for path resolution');
    }
    const hostRecord = toPlainRecord(host);
    const resolvedHostId = normalizeOptionalInteger(hostRecord.id);
    const resolvedAgentUuid = normalizeAgentUuid(hostRecord.agentUuid || agentUuid);
    const normalizedInputPath = normalizePathPrefix(inputPath, 'path');
    const projects = await loadProjects(resolvedHostId);
    const approvedRoots = buildApprovedHostRoots({ host: hostRecord, projects });

    const matchingProject = projects.find((project) => {
      const projectPath = getProjectPath(project);
      return projectPath && normalizePathPrefix(projectPath, 'project path') === normalizedInputPath;
    }) || null;
    if (matchingProject) {
      const approval = assertApprovedHostPath(normalizedInputPath, approvedRoots, { allowUnapproved: true });
      return {
        inputPath: normalizedInputPath,
        codexPath: normalizedInputPath,
        hostPath: normalizedInputPath,
        source: 'discovered_project',
        mapping: null,
        approved: approval.approved,
        matchedRoot: approval.matchedRoot,
        approvedRoots,
      };
    }

    const mappings = await listHostPathMappings({ hostId: resolvedHostId, agentUuid: resolvedAgentUuid });
    const matchingMapping = mappings
      .filter((mapping) => pathStartsWithPrefix(normalizedInputPath, mapping.codexPathPrefix))
      .sort((left, right) => right.codexPathPrefix.length - left.codexPathPrefix.length)[0] || null;
    if (matchingMapping) {
      const hostPath = joinMappedPath(
        matchingMapping.hostPathPrefix,
        matchingMapping.codexPathPrefix,
        normalizedInputPath,
      );
      const approval = assertApprovedHostPath(hostPath, approvedRoots, { allowUnapproved });
      return {
        inputPath: normalizedInputPath,
        codexPath: normalizedInputPath,
        hostPath: approval.hostPath,
        source: 'mapping',
        mapping: matchingMapping,
        approved: approval.approved,
        matchedRoot: approval.matchedRoot,
        approvedRoots,
      };
    }

    const matchedRoot = findContainingRoot(normalizedInputPath, approvedRoots);
    if (matchedRoot) {
      return {
        inputPath: normalizedInputPath,
        codexPath: normalizedInputPath,
        hostPath: normalizedInputPath,
        source: 'host_root',
        mapping: null,
        approved: true,
        matchedRoot,
        approvedRoots,
      };
    }

    const approval = assertApprovedHostPath(normalizedInputPath, approvedRoots, { allowUnapproved });
    return {
      inputPath: normalizedInputPath,
      codexPath: normalizedInputPath,
      hostPath: approval.hostPath,
      source: 'explicit_host_path',
      mapping: null,
      approved: approval.approved,
      matchedRoot: approval.matchedRoot,
      approvedRoots,
    };
  };

  const upsertHostPathMapping = async (input = {}) => {
    const host = await findHost(input);
    if (!host) {
      throw new Error('Host not found for path mapping');
    }
    const hostRecord = toPlainRecord(host);
    const resolvedHostId = normalizeOptionalInteger(hostRecord.id);
    const projects = await loadProjects(resolvedHostId);
    const approvedRoots = buildApprovedHostRoots({ host: hostRecord, projects });
    const codexPathPrefix = normalizePathPrefix(input.codexPathPrefix, 'codexPathPrefix');
    const hostPathPrefix = normalizePathPrefix(input.hostPathPrefix, 'hostPathPrefix');
    assertApprovedHostPath(hostPathPrefix, approvedRoots, {
      allowUnapproved: Boolean(input.allowUnapproved),
    });

    const id = normalizeOptionalInteger(input.id);
    const payload = {
      hostId: resolvedHostId,
      agentUuid: normalizeAgentUuid(input.agentUuid || hostRecord.agentUuid),
      logicalRoot: String(input.logicalRoot || '').trim() || null,
      codexPathPrefix,
      hostPathPrefix,
      description: input.description == null ? null : String(input.description),
      enabled: input.enabled !== false,
      createdBy: String(input.createdBy || '').trim() || null,
      updatedBy: String(input.updatedBy || input.createdBy || '').trim() || null,
    };

    let mapping = id ? await HostPathMappingModel.findByPk(id) : null;
    if (!mapping) {
      mapping = await HostPathMappingModel.findOne({
        where: {
          hostId: resolvedHostId,
          codexPathPrefix,
          hostPathPrefix,
        },
      });
    }

    if (mapping) {
      const updatePayload = { ...payload };
      delete updatePayload.createdBy;
      await mapping.update(updatePayload);
      return mapHostPathMapping(mapping);
    }

    const created = await HostPathMappingModel.create(payload);
    return mapHostPathMapping(created);
  };

  const deleteHostPathMapping = async ({ id, hostId, agentUuid } = {}) => {
    const parsedId = normalizeOptionalInteger(id);
    if (!parsedId) {
      throw new Error('id is required');
    }
    const host = hostId || agentUuid ? await findHost({ hostId, agentUuid }) : null;
    const where = { id: parsedId };
    if (host) {
      where.hostId = Number(toPlainRecord(host).id);
    }
    const deleted = await HostPathMappingModel.destroy({ where });
    return Number(deleted) > 0;
  };

  return {
    listHostPathMappings,
    resolveHostPath,
    upsertHostPathMapping,
    deleteHostPathMapping,
    logger,
  };
};

module.exports = {
  assertApprovedHostPath,
  buildApprovedHostRoots,
  createHostPathMappingCatalog,
  findContainingRoot,
  joinMappedPath,
  mapHostPathMapping,
  normalizePathPrefix,
  pathStartsWithPrefix,
};
