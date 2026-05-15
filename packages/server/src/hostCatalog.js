const net = require('net');
const { randomUUID } = require('crypto');
const { sequelize } = require('./db');
const { Host, Project } = require('./models');

const HOST_SOURCE_RUNTIME = 'runtime';
const HOST_SOURCE_MANUAL = 'manual';
const DEFAULT_HOST_DIRECTORY_FALLBACK = '~/play';

const normalizeHostIp = (ip) => String(ip || '').trim();
const normalizeHostName = (name) => String(name || '').trim();
const normalizeHostNameKey = (name) => normalizeHostName(name).toLowerCase();
const normalizeHostAgentUuid = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
};

const normalizeHostPort = (port) => {
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return 0;
  }
  return parsed;
};

const normalizeHostMetadata = (metadata) => (
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {}
);

const normalizeHostDirectoryPath = (directoryPathInput) => {
  const normalized = String(directoryPathInput || '').trim().replace(/\\/g, '/');
  if (!normalized) {
    throw new Error('directoryPath is required');
  }
  if (normalized.includes('\0')) {
    throw new Error('directoryPath cannot contain null bytes');
  }
  if (normalized === '/') {
    return normalized;
  }
  return normalized.replace(/\/+$/g, '');
};

const normalizeHostDirectories = (input) => {
  const directories = Array.isArray(input) ? input : [];
  const unique = [];
  const seen = new Set();
  for (const directoryPath of directories) {
    let normalized = '';
    try {
      normalized = normalizeHostDirectoryPath(directoryPath);
    } catch {
      normalized = '';
    }
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
};

const getHostDirectoriesFromMetadata = (metadata) => {
  const normalizedMetadata = normalizeHostMetadata(metadata);
  return normalizeHostDirectories(normalizedMetadata.directories);
};

const getDefaultHostDirectory = () => {
  const configured = String(process.env.PC_SLAVE_DEFAULT_PROJECT_PATH || '').trim();
  const candidate = configured || DEFAULT_HOST_DIRECTORY_FALLBACK;
  try {
    return normalizeHostDirectoryPath(candidate);
  } catch {
    return DEFAULT_HOST_DIRECTORY_FALLBACK;
  }
};

const getInitialHostDirectories = () => [getDefaultHostDirectory()];

const normalizeRegisteredHost = (input) => {
  const name = normalizeHostName(input?.name || input?.hostName);
  if (!name) {
    return null;
  }

  const ip = normalizeHostIp(input?.ip);
  if (!ip) {
    return null;
  }

  return {
    name,
    ip,
    port: normalizeHostPort(input?.port),
    source: HOST_SOURCE_RUNTIME,
    slaveId: normalizeHostAgentUuid(input?.slaveId || input?.agentUuid || input?.hostAgentUuid),
  };
};

const buildRuntimeHostNameCandidates = ({ requestedName, ip, port }) => {
  const normalizedName = normalizeHostName(requestedName);
  const normalizedIp = normalizeHostIp(ip);
  const normalizedPort = normalizeHostPort(port);
  const addressLabel = normalizedPort > 0 ? `${normalizedIp}:${normalizedPort}` : normalizedIp;
  return [
    normalizedName,
    `${normalizedName} (${addressLabel})`,
    `${normalizedName} [${addressLabel}]`,
  ].filter(Boolean);
};

const allocateRuntimeHostName = ({
  requestedName,
  ip,
  port,
  existingId = null,
  reservedNames = new Map(),
}) => {
  const normalizedName = normalizeHostName(requestedName);
  if (!normalizedName) {
    throw new Error('requestedName is required');
  }

  const candidates = buildRuntimeHostNameCandidates({ requestedName: normalizedName, ip, port });
  const normalizedExistingId = Number.isInteger(Number(existingId)) && Number(existingId) > 0
    ? Number(existingId)
    : null;
  const isAvailable = (candidate) => {
    const ownerId = reservedNames.get(normalizeHostNameKey(candidate));
    return ownerId == null || ownerId === normalizedExistingId;
  };

  for (const candidate of candidates) {
    if (isAvailable(candidate)) {
      return candidate;
    }
  }

  const collisionBase = candidates[candidates.length - 1] || normalizedName;
  for (let index = 2; index <= 1000; index += 1) {
    const candidate = `${collisionBase} #${index}`;
    if (isAvailable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to allocate a unique runtime host name for ${normalizedName}.`);
};

const generateHostAgentUuid = () => normalizeHostAgentUuid(randomUUID());

const isValidHostname = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  if (normalized.length > 253) {
    return false;
  }
  const labels = normalized.split('.');
  if (labels.some((label) => !label || label.length > 63)) {
    return false;
  }
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
};

const parseManualHostTarget = (targetInput) => {
  const rawTarget = String(targetInput || '').trim();
  if (!rawTarget) {
    throw new Error('host target is required');
  }
  if (rawTarget.includes('\0')) {
    throw new Error('host target cannot contain null bytes');
  }

  let host = '';
  let sshUser = null;
  let sshPort = null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawTarget)) {
    let parsed;
    try {
      parsed = new URL(rawTarget);
    } catch {
      throw new Error(`Invalid host target URL: ${rawTarget}`);
    }
    const protocol = String(parsed.protocol || '').replace(/:$/, '').toLowerCase();
    const isSshLikeProtocol = protocol === 'ssh' || protocol === 'sftp' || protocol === 'scp';
    host = String(parsed.hostname || '').trim();
    sshUser = isSshLikeProtocol ? (String(parsed.username || '').trim() || null) : null;
    if (isSshLikeProtocol && parsed.port) {
      const parsedPort = Number.parseInt(parsed.port, 10);
      if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
        sshPort = parsedPort;
      }
    }
  } else {
    const userHostPortMatch = rawTarget.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/);
    if (userHostPortMatch) {
      sshUser = String(userHostPortMatch[1] || '').trim() || null;
      host = String(userHostPortMatch[2] || '').trim();
      if (userHostPortMatch[3]) {
        const parsedPort = Number.parseInt(userHostPortMatch[3], 10);
        if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          sshPort = parsedPort;
        }
      }
    } else {
      const bracketIpv6Match = rawTarget.match(/^\[([^\]]+)\]:(\d+)$/);
      if (bracketIpv6Match) {
        host = String(bracketIpv6Match[1] || '').trim();
        const parsedPort = Number.parseInt(bracketIpv6Match[2], 10);
        if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          sshPort = parsedPort;
        }
      } else {
      const hostPortMatch = rawTarget.match(/^([^:\s]+):(\d+)$/);
        if (hostPortMatch && net.isIP(String(hostPortMatch[1] || '').trim()) !== 6) {
          host = String(hostPortMatch[1] || '').trim();
          const parsedPort = Number.parseInt(hostPortMatch[2], 10);
          if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
            sshPort = parsedPort;
          }
        } else {
          host = rawTarget;
        }
      }
    }
  }

  const normalizedHost = normalizeHostIp(host).replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalizedHost) {
    throw new Error(`Unable to resolve host from target: ${rawTarget}`);
  }

  if (net.isIP(normalizedHost) === 0 && !isValidHostname(normalizedHost)) {
    throw new Error(`Host target must resolve to a valid IPv4/IPv6 address or hostname: ${rawTarget}`);
  }

  return {
    target: rawTarget,
    host: normalizedHost,
    sshUser,
    sshPort,
  };
};

const resolveManualHostName = async ({ ip, transaction }) => {
  let sequence = 1;
  while (sequence <= 1000) {
    const candidate = sequence === 1 ? ip : `${ip}-${sequence}`;
    // eslint-disable-next-line no-await-in-loop
    const existing = await Host.findOne({
      attributes: ['id'],
      where: { name: candidate },
      transaction,
    });
    if (!existing) {
      return candidate;
    }
    sequence += 1;
  }
  throw new Error('Unable to allocate a unique host name.');
};

const addManualHost = async (targetInput) => {
  const normalizedTarget = parseManualHostTarget(targetInput);
  const ip = normalizedTarget.host;

  return sequelize.transaction(async (transaction) => {
    const existing = await Host.findOne({
      where: {
        source: HOST_SOURCE_MANUAL,
        ip,
      },
      transaction,
    });
    if (existing) {
      const existingMetadata = normalizeHostMetadata(existing.metadata);
      const hasDirectories = Object.prototype.hasOwnProperty.call(existingMetadata, 'directories');
      const existingDirectories = hasDirectories
        ? getHostDirectoriesFromMetadata(existingMetadata)
        : getInitialHostDirectories();
      const shouldUpdateMetadata = (
        !hasDirectories
        || JSON.stringify(existingDirectories) !== JSON.stringify(existingMetadata.directories || [])
      );
      const nextMetadata = {
        ...existingMetadata,
        directories: existingDirectories,
        manualTarget: normalizedTarget.target,
        sshUser: normalizedTarget.sshUser,
        sshPort: normalizedTarget.sshPort,
      };
      const metadataChanged = JSON.stringify(nextMetadata) !== JSON.stringify(existingMetadata);
      const updates = {};
      if (!normalizeHostAgentUuid(existing.agentUuid)) {
        updates.agentUuid = generateHostAgentUuid();
      }
      if (shouldUpdateMetadata || metadataChanged) {
        updates.metadata = nextMetadata;
      }
      if (Object.keys(updates).length > 0) {
        await existing.update(updates, { transaction });
      }
      return existing;
    }

    const name = await resolveManualHostName({ ip, transaction });
    return Host.create({
      name,
      ip,
      port: 0,
      source: HOST_SOURCE_MANUAL,
      agentUuid: generateHostAgentUuid(),
      metadata: {
        directories: getInitialHostDirectories(),
        manualTarget: normalizedTarget.target,
        sshUser: normalizedTarget.sshUser,
        sshPort: normalizedTarget.sshPort,
      },
    }, { transaction });
  });
};

const getHostById = async (hostIdInput, { transaction } = {}) => {
  const hostId = Number(hostIdInput);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    throw new Error('hostId must be a positive integer');
  }
  return Host.findByPk(hostId, { transaction });
};

const findHostByRuntimeIdentity = async (input, { transaction } = {}) => {
  const agentUuid = normalizeHostAgentUuid(input?.slaveId || input?.agentUuid || input?.hostAgentUuid);
  if (agentUuid) {
    const byAgentUuid = await Host.findOne({
      where: { agentUuid },
      transaction,
    });
    if (byAgentUuid) {
      return byAgentUuid;
    }
  }

  const ip = normalizeHostIp(input?.ip);
  if (ip) {
    const byIp = await Host.findOne({
      where: { ip },
      transaction,
    });
    if (byIp) {
      return byIp;
    }
  }

  const name = normalizeHostName(input?.name || input?.hostName);
  if (name) {
    const byName = await Host.findOne({
      where: { name },
      transaction,
    });
    if (byName) {
      return byName;
    }
  }

  return null;
};

const canMatchRuntimeHostByIp = (host, incomingIpCounts = new Map()) => {
  const ip = normalizeHostIp(host?.ip);
  if (!ip) {
    return false;
  }
  // Slave id is the stable identity. Under Kubernetes NodePort/SNAT, multiple
  // slaves can present the same IP, so IP fallback is safe only when unique.
  if (normalizeHostAgentUuid(host?.slaveId || host?.agentUuid) && Number(incomingIpCounts.get(ip) || 0) > 1) {
    return false;
  }
  return true;
};

const deleteHostById = async (hostIdInput) => {
  const hostId = Number(hostIdInput);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    throw new Error('hostId must be a positive integer');
  }

  return sequelize.transaction(async (transaction) => {
    const host = await Host.findByPk(hostId, { transaction });
    if (!host) {
      return false;
    }

    await Project.update(
      { hostId: null },
      {
        where: { hostId },
        transaction,
      },
    );
    await host.destroy({ transaction });
    return true;
  });
};

const syncRegisteredHosts = async (registeredHosts) => {
  const normalizedHosts = Array.isArray(registeredHosts)
    ? registeredHosts
      .map((entry) => normalizeRegisteredHost(entry))
      .filter(Boolean)
    : [];
  const incomingIpCounts = normalizedHosts.reduce((counts, host) => {
    if (host.ip) {
      counts.set(host.ip, (counts.get(host.ip) || 0) + 1);
    }
    return counts;
  }, new Map());

  const deduped = [];
  const seenKeys = new Set();
  for (const host of normalizedHosts) {
    const dedupeKey = host.slaveId ? `slave:${host.slaveId}` : `name:${host.name}`;
    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    deduped.push(host);
    seenKeys.add(dedupeKey);
  }

  await sequelize.transaction(async (transaction) => {
    const existingHosts = await Host.findAll({
      attributes: ['id', 'name', 'ip', 'port', 'source', 'agentUuid', 'metadata'],
      transaction,
    });
    const existingByAgentUuid = new Map();
    const existingByName = new Map();
    const existingByIp = new Map();
    const reservedNames = new Map();

    for (const host of existingHosts) {
      const normalizedAgentUuid = normalizeHostAgentUuid(host.agentUuid);
      if (normalizedAgentUuid && !existingByAgentUuid.has(normalizedAgentUuid)) {
        existingByAgentUuid.set(normalizedAgentUuid, host);
      }
      const normalizedNameKey = normalizeHostNameKey(host.name);
      if (normalizedNameKey && !existingByName.has(normalizedNameKey)) {
        existingByName.set(normalizedNameKey, host);
      }
      if (host.name) {
        reservedNames.set(normalizedNameKey, Number(host.id));
      }
      if (host.ip && !existingByIp.has(host.ip)) {
        existingByIp.set(host.ip, host);
      }
    }

    const matchedExistingIds = new Set();

    for (const host of deduped) {
      let existing = null;
      if (host.slaveId) {
        existing = existingByAgentUuid.get(host.slaveId) || null;
      }
      if (!existing) {
        existing = existingByName.get(normalizeHostNameKey(host.name)) || null;
      }
      if (!existing) {
        existing = canMatchRuntimeHostByIp(host, incomingIpCounts)
          ? (existingByIp.get(host.ip) || null)
          : null;
      }

      const nextName = allocateRuntimeHostName({
        requestedName: host.name,
        ip: host.ip,
        port: host.port,
        existingId: existing ? Number(existing.id) : null,
        reservedNames,
      });

      if (!existing) {
        const created = await Host.create({
          ...host,
          name: nextName,
          source: HOST_SOURCE_RUNTIME,
          agentUuid: host.slaveId,
          metadata: { directories: getInitialHostDirectories() },
        }, { transaction });
        reservedNames.set(normalizeHostNameKey(nextName), Number(created.id));
        existingByName.set(normalizeHostNameKey(nextName), created);
        existingByIp.set(host.ip, created);
        if (host.slaveId) {
          existingByAgentUuid.set(host.slaveId, created);
        }
        matchedExistingIds.add(Number(created.id));
        continue;
      }

      matchedExistingIds.add(Number(existing.id));

      const existingAgentUuid = normalizeHostAgentUuid(existing.agentUuid);
      const nextAgentUuid = host.slaveId || existingAgentUuid || null;
      const nextSource = existing.source || HOST_SOURCE_RUNTIME;
      const existingMetadata = normalizeHostMetadata(existing.metadata);
      const hasDirectories = Object.prototype.hasOwnProperty.call(existingMetadata, 'directories');
      const nextDirectories = hasDirectories
        ? getHostDirectoriesFromMetadata(existingMetadata)
        : getInitialHostDirectories();
      const nextMetadata = {
        ...existingMetadata,
        directories: nextDirectories,
      };
      const existingDirectories = Array.isArray(existingMetadata.directories)
        ? existingMetadata.directories
        : [];
      const metadataChanged = (
        !hasDirectories
        || JSON.stringify(existingDirectories) !== JSON.stringify(nextDirectories)
      );

      if (
        existing.name !== nextName ||
        existing.ip !== host.ip ||
        Number(existing.port) !== Number(host.port) ||
        existing.source !== nextSource ||
        existingAgentUuid !== nextAgentUuid ||
        metadataChanged
      ) {
        const previousName = normalizeHostName(existing.name);
        const previousIp = normalizeHostIp(existing.ip);
        const previousAgentUuid = normalizeHostAgentUuid(existing.agentUuid);
        const currentNameKey = normalizeHostNameKey(existing.name);
        if (currentNameKey && reservedNames.get(currentNameKey) === Number(existing.id)) {
          reservedNames.delete(currentNameKey);
        }
        await existing.update({
          name: nextName,
          ip: host.ip,
          port: host.port,
          source: nextSource,
          agentUuid: nextAgentUuid,
          metadata: nextMetadata,
        }, { transaction });
        const previousNameKey = normalizeHostNameKey(previousName);
        if (previousNameKey && existingByName.get(previousNameKey) === existing) {
          existingByName.delete(previousNameKey);
        }
        if (previousIp && existingByIp.get(previousIp) === existing) {
          existingByIp.delete(previousIp);
        }
        if (previousAgentUuid && existingByAgentUuid.get(previousAgentUuid) === existing) {
          existingByAgentUuid.delete(previousAgentUuid);
        }
        reservedNames.set(normalizeHostNameKey(nextName), Number(existing.id));
        existingByName.set(normalizeHostNameKey(nextName), existing);
        existingByIp.set(host.ip, existing);
        if (nextAgentUuid) {
          existingByAgentUuid.set(nextAgentUuid, existing);
        }
      }
    }

    const staleIds = existingHosts
      .filter((host) => {
        const source = String(host.source || '').toLowerCase();
        const isRuntimeSourced = source === '' || source === HOST_SOURCE_RUNTIME;
        return isRuntimeSourced && !matchedExistingIds.has(Number(host.id));
      })
      .map((host) => host.id);

    if (staleIds.length > 0) {
      await Host.destroy({
        where: { id: staleIds },
        transaction,
      });
    }
  });
};

const addHostDirectory = async ({ hostId, directoryPath }) => {
  const normalizedDirectoryPath = normalizeHostDirectoryPath(directoryPath);

  return sequelize.transaction(async (transaction) => {
    const host = await getHostById(hostId, { transaction });
    if (!host) {
      throw new Error(`Host not found: ${hostId}`);
    }

    const metadata = normalizeHostMetadata(host.metadata);
    const directories = getHostDirectoriesFromMetadata(metadata);
    if (directories.includes(normalizedDirectoryPath)) {
      return host;
    }

    const nextDirectories = [...directories, normalizedDirectoryPath];
    await host.update({
      metadata: {
        ...metadata,
        directories: nextDirectories,
      },
    }, { transaction });
    return host;
  });
};

const removeHostDirectory = async ({ hostId, directoryPath }) => {
  const normalizedDirectoryPath = normalizeHostDirectoryPath(directoryPath);

  return sequelize.transaction(async (transaction) => {
    const host = await getHostById(hostId, { transaction });
    if (!host) {
      throw new Error(`Host not found: ${hostId}`);
    }

    const metadata = normalizeHostMetadata(host.metadata);
    const directories = getHostDirectoriesFromMetadata(metadata);
    const nextDirectories = directories.filter((entry) => entry !== normalizedDirectoryPath);
    if (nextDirectories.length === directories.length) {
      return host;
    }

    await host.update({
      metadata: {
        ...metadata,
        directories: nextDirectories,
      },
    }, { transaction });
    return host;
  });
};

const listHostsWithProjects = async () => Host.findAll({
  attributes: ['id', 'name', 'ip', 'port', 'source', 'agentUuid', 'metadata'],
  include: [{
    model: Project,
    as: 'projects',
    attributes: ['id', 'name', 'metadata'],
    required: false,
  }],
  order: [['name', 'ASC']],
});

module.exports = {
  addManualHost,
  allocateRuntimeHostName,
  canMatchRuntimeHostByIp,
  deleteHostById,
  getHostById,
  findHostByRuntimeIdentity,
  normalizeHostDirectoryPath,
  getHostDirectoriesFromMetadata,
  addHostDirectory,
  removeHostDirectory,
  syncRegisteredHosts,
  listHostsWithProjects,
};
