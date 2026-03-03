const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const { spawn, execFile } = require('child_process');
const util = require('util');
const dotenv = require('dotenv');
const { Op, where, literal } = require('sequelize');
const { sequelize } = require('./db');
const { Project, Service, PortRange } = require('./models');
const execFileAsync = util.promisify(execFile);

const LOG_DIR = path.resolve(__dirname, '../data/runtime-logs');
const STABLE_RUNNING_MS = Number(process.env.SERVICE_STABLE_MS || 4000);
const PORT_BLOCK_START = 4000;
const PORT_BLOCK_SIZE = 10;
const PORT_BLOCK_MAX = 65000;
const PORT_RANGE_OVERRIDE_KEY = 'portRangeOverride';
const SERVICE_KEY_ORDER = ['main', 'graphql', 'api', 'admin'];
const PORT_OFFSETS = {
  WEB_PORT: 0,
  SERVER_PORT: 1,
  ADMIN_PORT: 2,
  ASSET_SERVER_PORT: 3,
};

fs.mkdirSync(LOG_DIR, { recursive: true });

let eventSink = null;
let pidMonitorTimer = null;
let pidMonitorActive = false;

const activeProcesses = new Map();
const projectLogFiles = new Map();
const serviceRuntimeStates = new Map();
const stopRequestedServices = new Set();

const toIso = (value) => (value ? value.toISOString() : null);

const clampLimit = (limit) => {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 300;
  }
  return Math.min(parsed, 2000);
};

const emitEvent = (payload) => {
  if (typeof eventSink !== 'function') {
    return;
  }
  try {
    eventSink(payload);
  } catch {
    // ignore sink failures
  }
};

const closeFdSafely = (fd) => {
  if (!Number.isInteger(fd) || fd < 0) {
    return;
  }
  try {
    fs.closeSync(fd);
  } catch {
    // ignore close errors
  }
};

const shellSingleQuote = (value) => `'${String(value || '').replace(/'/g, `'\\''`)}'`;

const appendSystemLogLine = ({ filePath, serviceName, message }) => {
  if (!filePath || !message) {
    return;
  }
  const timestamp = new Date().toISOString();
  const normalizedService = String(serviceName || 'service');
  const normalizedMessage = String(message).trim();
  if (!normalizedMessage) {
    return;
  }
  try {
    fs.appendFileSync(filePath, `${timestamp}\t${normalizedService}\tsystem\t${normalizedMessage}\n`);
  } catch {
    // ignore write errors
  }
};

const resetServiceLogFiles = ({
  projectPath,
  serviceId,
  stdoutPath,
  stderrPath,
}) => {
  if (projectPath && projectLogFiles.has(projectPath)) {
    const tracked = projectLogFiles.get(projectPath) || [];
    projectLogFiles.set(
      projectPath,
      tracked.filter((entry) => (
        entry?.stdoutPath !== stdoutPath && entry?.stderrPath !== stderrPath
      )),
    );
  }

  for (const filePath of [stdoutPath, stderrPath]) {
    if (!filePath) {
      continue;
    }
    try {
      fs.writeFileSync(filePath, '');
    } catch {
      // ignore truncation failures
    }
  }

  if (Number.isInteger(serviceId)) {
    stopRequestedServices.delete(serviceId);
  }
};

const sendSignalToServiceProcess = (pid, signal) => {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      process.kill(normalizedPid, signal);
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-normalizedPid, signal);
    return;
  } catch {
    // fall through to direct pid signal
  }

  try {
    process.kill(normalizedPid, signal);
  } catch {
    // ignore
  }
};

const getProjectPath = (project) => project?.metadata?.path || null;
const getProjectMetadata = (project) => {
  const metadata = project?.metadata;
  return metadata && typeof metadata === 'object' ? metadata : {};
};

const normalizePortRangeMode = (value) => (
  String(value || '').trim().toLowerCase() === 'manual'
    ? 'manual'
    : 'automatic'
);

const normalizePortRangeBegin = (value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  if (parsed + PORT_BLOCK_SIZE - 1 > PORT_BLOCK_MAX) {
    return null;
  }
  return parsed;
};

const getProjectPortRangeSettingsFromMetadata = (metadata) => {
  const raw = metadata?.[PORT_RANGE_OVERRIDE_KEY];
  const mode = normalizePortRangeMode(raw?.mode);
  const begin = normalizePortRangeBegin(raw?.begin);
  if (mode === 'manual') {
    return { mode, begin };
  }
  return { mode: 'automatic', begin: null };
};

const getProjectPortRangeSettingsFromProject = (project) =>
  getProjectPortRangeSettingsFromMetadata(getProjectMetadata(project));

const buildProjectPathWhere = (projectPath) => {
  const normalizedPath = path.resolve(projectPath);
  const dialect = sequelize.getDialect();
  if (dialect === 'postgres') {
    return where(literal(`metadata->>'path'`), normalizedPath);
  }
  return where(literal(`json_extract(metadata, '$.path')`), normalizedPath);
};

const isProcessRunning = (pid) => {
  const parsed = Number(pid);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return false;
  }
  try {
    process.kill(parsed, 0);
    return true;
  } catch {
    return false;
  }
};

const ensureProjectLogFiles = (projectPath) => {
  if (!projectLogFiles.has(projectPath)) {
    projectLogFiles.set(projectPath, []);
  }
  return projectLogFiles.get(projectPath);
};

const registerServiceLogFiles = ({ projectPath, serviceName, pid, stdoutPath, stderrPath }) => {
  const tracked = ensureProjectLogFiles(projectPath);
  const key = stdoutPath && stderrPath
    ? `${stdoutPath}:${stderrPath}`
    : `${serviceName}:${pid}`;
  if (tracked.some((entry) => entry.key === key)) {
    return;
  }
  tracked.push({
    key,
    serviceName,
    pid,
    stdoutPath,
    stderrPath,
  });
};

const getServiceRelativeBaseName = (service) => {
  const relativePath = String(service?.relativePath || '').trim();
  if (!relativePath || relativePath === '.') {
    return '';
  }
  return path.basename(relativePath).toLowerCase();
};

const resolveServiceDisplayName = (service) => {
  const relativeBase = getServiceRelativeBaseName(service);
  if (relativeBase === 'web' || relativeBase === 'server' || relativeBase === 'admin' || relativeBase === 'graphql') {
    return relativeBase;
  }

  const normalizedName = String(service?.name || '').trim();
  if (normalizedName.toLowerCase() === 'interface') {
    return 'web';
  }

  return normalizedName || 'service';
};

const inferServiceKey = (service) => {
  const name = String(service?.name || '').toLowerCase();
  const kind = String(service?.kind || '').toLowerCase();
  const relativeBase = getServiceRelativeBaseName(service);
  const isRootService = String(service?.relativePath || '').trim() === '.';

  if (name === 'web' || name === 'interface' || relativeBase === 'web' || kind === 'main') return 'main';
  if (name === 'admin' || relativeBase === 'admin' || kind === 'admin') return 'admin';
  if (name === 'server' || name === 'api' || relativeBase === 'server' || relativeBase === 'api' || kind === 'api') return 'api';
  if (name === 'graphql' || relativeBase === 'graphql' || kind === 'graphql') return 'graphql';
  if (isRootService) return 'main';
  return 'unknown';
};

const resolveServiceRuntimeKey = (service) => {
  const inferred = inferServiceKey(service);
  if (inferred !== 'unknown') {
    return inferred;
  }

  const relativeBase = getServiceRelativeBaseName(service);
  if (relativeBase) {
    return relativeBase;
  }

  const normalizedName = String(service?.name || '').trim().toLowerCase();
  if (normalizedName) {
    return normalizedName;
  }

  return 'unknown';
};

const getServiceRuntimeState = (service) => {
  const runtimeState = serviceRuntimeStates.get(service.id);
  const pidRunning = service.processId && isProcessRunning(service.processId);
  if (pidRunning) {
    return runtimeState?.status === 'starting' ? 'starting' : 'started';
  }
  if (runtimeState?.status === 'crashed') {
    return 'crashed';
  }
  if (runtimeState?.status === 'starting') {
    return 'starting';
  }
  return 'stopped';
};

const buildServiceRuntimeEntries = (services) => {
  const entriesByKey = new Map();

  for (const service of services || []) {
    const key = resolveServiceRuntimeKey(service);
    if (!key) {
      continue;
    }

    const state = getServiceRuntimeState(service);
    const pid = Number(service.processId);
    const runningPid = Number.isInteger(pid) && pid > 0 && isProcessRunning(pid) ? pid : null;
    const port = Number.isInteger(service.port) ? service.port : null;
    const entry = {
      key,
      serviceName: resolveServiceDisplayName(service),
      pid: runningPid,
      port,
      state,
    };

    const current = entriesByKey.get(key);
    if (!current) {
      entriesByKey.set(key, entry);
      continue;
    }

    const currentRunning = Number.isInteger(current.pid) && current.pid > 0;
    const entryRunning = Number.isInteger(entry.pid) && entry.pid > 0;

    if (!currentRunning && entryRunning) {
      entriesByKey.set(key, entry);
      continue;
    }

    if (currentRunning === entryRunning) {
      if (current.state !== 'starting' && entry.state === 'starting') {
        entriesByKey.set(key, entry);
        continue;
      }
      if (current.state === 'stopped' && entry.state !== 'stopped') {
        entriesByKey.set(key, entry);
      }
    }
  }

  return Array.from(entriesByKey.values()).sort((left, right) => left.key.localeCompare(right.key));
};

const resolveServiceForKey = (services, serviceKey) => {
  const normalizedKey = String(serviceKey || '').toLowerCase();
  if (!normalizedKey) {
    return null;
  }
  const byName = {
    main: ['web', 'interface'],
    api: ['server', 'api'],
    admin: ['admin'],
    graphql: ['graphql', 'server'],
  };

  const preferredNames = byName[normalizedKey] || [];
  for (const preferred of preferredNames) {
    const match = services.find(
      (service) =>
        (
          String(service.name || '').toLowerCase() === preferred ||
          getServiceRelativeBaseName(service) === preferred
        ) &&
        service.hasPackageJson &&
        service.relativePath,
    );
    if (match) {
      return match;
    }
  }

  const byKind = services.find((service) => inferServiceKey(service) === normalizedKey);
  if (byKind) {
    return byKind;
  }

  const byDeclaredName = services.find((service) => {
    const declaredName = String(service?.name || '').trim().toLowerCase();
    const relativeBase = getServiceRelativeBaseName(service);
    return declaredName === normalizedKey || relativeBase === normalizedKey;
  });
  if (byDeclaredName) {
    return byDeclaredName;
  }

  return null;
};

const getServiceCwd = (projectPath, service) => {
  if (service.relativePath) {
    return path.resolve(projectPath, service.relativePath);
  }
  return projectPath;
};

const parseRootEnv = async (projectPath) => {
  const envPath = path.join(projectPath, '.env');
  try {
    const raw = await fsp.readFile(envPath, 'utf8');
    return dotenv.parse(raw);
  } catch {
    return {};
  }
};

const buildPortOverrides = (base) => {
  const serverPort = String(base + PORT_OFFSETS.SERVER_PORT);
  return {
    WEB_PORT: String(base + PORT_OFFSETS.WEB_PORT),
    SERVER_PORT: serverPort,
    ADMIN_PORT: String(base + PORT_OFFSETS.ADMIN_PORT),
    ASSET_SERVER_PORT: String(base + PORT_OFFSETS.ASSET_SERVER_PORT),
    PROTECTED_GRAPHQL_URL: `http://localhost:${serverPort}/graphql/protected`,
  };
};

const getPrimaryPortForService = (service, overrides) => {
  const key = inferServiceKey(service);
  if (key === 'main') return Number(overrides.WEB_PORT);
  if (key === 'admin') return Number(overrides.ADMIN_PORT);
  if (key === 'api' || key === 'graphql') return Number(overrides.SERVER_PORT);
  return Number(overrides.SERVER_PORT);
};

const collectUsedPortsFromRunningServices = async () => {
  const usedPorts = new Set();
  const services = await Service.findAll({
    where: { processId: { [Op.ne]: null } },
    attributes: ['id', 'processId', 'port'],
  });

  for (const service of services) {
    if (!isProcessRunning(service.processId)) {
      await service.update({ processId: null });
      const current = serviceRuntimeStates.get(service.id);
      serviceRuntimeStates.set(service.id, {
        status: stopRequestedServices.has(service.id) ? 'stopped' : 'crashed',
        pid: null,
        startedAt: current?.startedAt || null,
        lastExitCode: current?.lastExitCode ?? null,
      });
      stopRequestedServices.delete(service.id);
      continue;
    }

    if (Number.isInteger(service.port) && service.port > 0) {
      usedPorts.add(service.port);
    }
  }

  return usedPorts;
};

const addPortRangeToSet = (usedPorts, beginPort, endPort) => {
  const normalizedBegin = Number(beginPort);
  const normalizedEnd = Number(endPort);
  if (
    !Number.isInteger(normalizedBegin) ||
    !Number.isInteger(normalizedEnd) ||
    normalizedBegin <= 0 ||
    normalizedEnd < normalizedBegin
  ) {
    return;
  }

  for (let port = normalizedBegin; port <= normalizedEnd; port += 1) {
    usedPorts.add(port);
  }
};

const collectReservedPortsFromPortRanges = async ({ excludeProjectId = null } = {}) => {
  const whereClause = Number.isInteger(excludeProjectId)
    ? { projectId: { [Op.ne]: excludeProjectId } }
    : undefined;
  const ranges = await PortRange.findAll({
    attributes: ['begin', 'end', 'projectId'],
    ...(whereClause ? { where: whereClause } : {}),
  });

  const reserved = new Set();
  for (const range of ranges) {
    addPortRangeToSet(reserved, range.begin, range.end);
  }
  return reserved;
};

const tryBindPort = async ({ port, host }) =>
  new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        server.close(() => resolve(result));
      } catch {
        resolve(result);
      }
    };

    server.once('error', (error) => {
      if (error && (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL')) {
        finish(null);
        return;
      }
      finish(false);
    });
    server.once('listening', () => finish(true));
    server.unref();
    server.listen({
      port,
      ...(host ? { host } : {}),
      exclusive: true,
    });
  });

const isPortAvailable = async (port) => {
  // Probe with default host first so behavior matches servers that bind to all interfaces.
  const defaultBind = await tryBindPort({ port });
  if (defaultBind !== null) {
    return defaultBind;
  }

  // If the host doesn't support default bind (e.g. IPv6 unavailable), fall back to IPv4 checks.
  const ipv4Any = await tryBindPort({ port, host: '0.0.0.0' });
  if (ipv4Any !== null) {
    return ipv4Any;
  }

  const loopback = await tryBindPort({ port, host: '127.0.0.1' });
  return loopback === true;
};

const isPortBlockAvailable = async ({ base, usedPorts }) => {
  for (let offset = 0; offset < PORT_BLOCK_SIZE; offset += 1) {
    const port = base + offset;
    if (usedPorts.has(port)) {
      return false;
    }
    // Verify the OS can bind this port, not just our own runtime bookkeeping.
    // This prevents selecting a block where another external process is already listening.
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortAvailable(port);
    if (!available) {
      return false;
    }
  }
  return true;
};

const isPortBlockStartValid = (base) => {
  const normalizedBase = Number(base);
  return (
    Number.isInteger(normalizedBase) &&
    normalizedBase > 0 &&
    normalizedBase + PORT_BLOCK_SIZE - 1 <= PORT_BLOCK_MAX
  );
};

const isSpecificPortBlockAvailable = async ({ base, excludeProjectId = null } = {}) => {
  const normalizedBase = Number(base);
  if (!isPortBlockStartValid(normalizedBase)) {
    return false;
  }

  const usedPorts = await collectUsedPortsFromRunningServices();
  const reservedPorts = await collectReservedPortsFromPortRanges({ excludeProjectId });
  for (const port of reservedPorts) {
    usedPorts.add(port);
  }

  return isPortBlockAvailable({ base: normalizedBase, usedPorts });
};

const allocateOpenPortBlock = async ({ excludeProjectId = null } = {}) => {
  const usedPorts = await collectUsedPortsFromRunningServices();
  const reservedPorts = await collectReservedPortsFromPortRanges({ excludeProjectId });
  for (const port of reservedPorts) {
    usedPorts.add(port);
  }

  for (let base = PORT_BLOCK_START; base <= PORT_BLOCK_MAX - PORT_BLOCK_SIZE; base += PORT_BLOCK_SIZE) {
    // eslint-disable-next-line no-await-in-loop
    const available = await isPortBlockAvailable({ base, usedPorts });
    if (available) {
      return base;
    }
  }
  throw new Error('No available 10-port block found.');
};

const getProjectIncludes = () => ([
  { model: Service, as: 'services' },
  { model: PortRange, as: 'portRange' },
]);

const getPortRangeForProject = (project) => {
  const begin = Number(project?.portRange?.begin);
  const end = Number(project?.portRange?.end);
  if (!Number.isInteger(begin) || !Number.isInteger(end) || begin <= 0 || end < begin) {
    return null;
  }
  return { begin, end };
};

const assignProjectPortRange = async (project, beginPort) => {
  const normalizedBegin = Number(beginPort);
  if (!Number.isInteger(normalizedBegin) || normalizedBegin <= 0) {
    throw new Error('Invalid port range start value.');
  }

  const endPort = normalizedBegin + PORT_BLOCK_SIZE - 1;
  let range = project.portRange || null;
  if (!range) {
    range = await PortRange.findOne({ where: { projectId: project.id } });
  }

  if (range) {
    await range.update({
      begin: normalizedBegin,
      end: endPort,
    });
  } else {
    range = await PortRange.create({
      projectId: project.id,
      begin: normalizedBegin,
      end: endPort,
    });
  }

  project.setDataValue('portRange', range);
  return range;
};

const clearProjectPortRangeIfIdle = async (project) => {
  const runningServices = getRunningServicesForProject(project?.services || []);
  if (runningServices.length > 0 || !project?.portRange) {
    return;
  }

  await project.portRange.destroy();
  project.setDataValue('portRange', null);
};

const getPortBlockFromRunningServices = (services) => {
  const runningPorts = getRunningServicesForProject(services)
    .map((service) => Number(service.port))
    .filter((port) => Number.isInteger(port) && port > 0)
    .sort((a, b) => a - b);

  if (runningPorts.length === 0) {
    return null;
  }

  const inferred = Math.floor(runningPorts[0] / PORT_BLOCK_SIZE) * PORT_BLOCK_SIZE;
  return inferred > 0 ? inferred : null;
};

const loadProjectWithServices = async (projectPathInput) => {
  const normalizedPath = path.resolve(projectPathInput);
  const project = await Project.findOne({
    where: buildProjectPathWhere(normalizedPath),
    include: getProjectIncludes(),
  });
  return { projectPath: normalizedPath, project };
};

const getRunningServicesForProject = (services) =>
  services.filter((service) => service.processId && isProcessRunning(service.processId));

const getOrAllocateProjectPortBlock = async (project, services) => {
  const settings = getProjectPortRangeSettingsFromProject(project);
  const runningServices = getRunningServicesForProject(services);
  const existingRange = getPortRangeForProject(project);
  if (existingRange) {
    const manualBegin = settings.mode === 'manual'
      ? normalizePortRangeBegin(settings.begin)
      : null;
    if (
      manualBegin &&
      runningServices.length === 0 &&
      existingRange.begin !== manualBegin
    ) {
      const manualAvailable = await isSpecificPortBlockAvailable({
        base: manualBegin,
        excludeProjectId: project.id,
      });
      if (!manualAvailable) {
        throw new Error(`Configured manual port range ${manualBegin}-${manualBegin + PORT_BLOCK_SIZE - 1} is unavailable.`);
      }
      await assignProjectPortRange(project, manualBegin);
      return manualBegin;
    }
    return existingRange.begin;
  }

  const inferredFromRunning = getPortBlockFromRunningServices(services);
  if (inferredFromRunning) {
    await assignProjectPortRange(project, inferredFromRunning);
    return inferredFromRunning;
  }

  if (settings.mode === 'manual') {
    const manualBegin = normalizePortRangeBegin(settings.begin);
    if (manualBegin) {
      const manualAvailable = await isSpecificPortBlockAvailable({
        base: manualBegin,
        excludeProjectId: project.id,
      });
      if (!manualAvailable) {
        throw new Error(`Configured manual port range ${manualBegin}-${manualBegin + PORT_BLOCK_SIZE - 1} is unavailable.`);
      }
      await assignProjectPortRange(project, manualBegin);
      return manualBegin;
    }
  }

  const nextBlock = await allocateOpenPortBlock({ excludeProjectId: project.id });
  await assignProjectPortRange(project, nextBlock);
  return nextBlock;
};

const buildRuntimeSnapshot = (projectPath, services, portRange = null) => {
  const normalizedPortRange = (
    Number.isInteger(Number(portRange?.begin)) &&
    Number.isInteger(Number(portRange?.end))
  )
    ? { begin: Number(portRange.begin), end: Number(portRange.end) }
    : null;
  const runningServices = getRunningServicesForProject(services);
  const hasStarting = runningServices.some(
    (service) => serviceRuntimeStates.get(service.id)?.status === 'starting',
  );

  const status = hasStarting
    ? 'starting'
    : runningServices.length > 0
      ? 'started'
      : 'stopped';

  const sortedPorts = Array.from(
    new Set(
      runningServices
        .map((service) => service.port)
        .filter((port) => Number.isInteger(port) && port > 0),
    ),
  ).sort((a, b) => a - b);

  const slotPayload = buildServiceSlotPayload(services);
  const serviceRuntimeEntries = buildServiceRuntimeEntries(services);

  return {
    projectPath,
    status,
    pid: runningServices[0]?.processId || null,
    startedAt: toIso(
      runningServices.length > 0
        ? new Date(
          Math.min(
            ...runningServices.map(
              (service) => serviceRuntimeStates.get(service.id)?.startedAt || Date.now(),
            ),
          ),
        )
        : null,
    ),
    stoppedAt: status === 'stopped' ? toIso(new Date()) : null,
    lastExitCode: null,
    ports: sortedPorts,
    portRangeBegin: normalizedPortRange?.begin || null,
    portRangeEnd: normalizedPortRange?.end || null,
    servicePorts: slotPayload.ports,
    servicePids: slotPayload.pids,
    serviceStates: slotPayload.states,
    serviceRuntimeEntries,
  };
};

const buildServiceSlotPayload = (services) => {
  const ports = { main: null, graphql: null, api: null, admin: null };
  const pids = { main: null, graphql: null, api: null, admin: null };
  const states = { main: 'stopped', graphql: 'stopped', api: 'stopped', admin: 'stopped' };

  for (const slot of SERVICE_KEY_ORDER) {
    const slotService = services.find((service) => inferServiceKey(service) === slot);
    if (!slotService) {
      continue;
    }

    if (Number.isInteger(slotService.port)) {
      ports[slot] = slotService.port;
    }

    const runtimeState = serviceRuntimeStates.get(slotService.id);
    const pidRunning = slotService.processId && isProcessRunning(slotService.processId);
    if (pidRunning) {
      pids[slot] = slotService.processId;
      states[slot] = runtimeState?.status === 'starting' ? 'starting' : 'started';
    } else if (runtimeState?.status === 'crashed') {
      states[slot] = 'crashed';
    } else if (runtimeState?.status === 'starting') {
      states[slot] = 'starting';
    } else {
      states[slot] = 'stopped';
    }
  }

  return { ports, pids, states };
};

const emitRuntimeForProject = async (projectPath) => {
  const runtime = await getProjectRuntime(projectPath);
  emitEvent({
    type: 'runtime',
    runtime,
  });
};

const buildLaunchBootstrapCommand = ({ cwd, launchCommand }) => {
  const directoryLine = shellSingleQuote(`directory: ${cwd}`);
  const commandLine = shellSingleQuote(`launch command: ${launchCommand}`);
  return [
    `printf '%s\\n' ${directoryLine}`,
    `printf '%s\\n' ${commandLine}`,
    `printf '%s\\n' "process id: $$"`,
    `exec ${launchCommand}`,
  ].join('; ');
};

const startServiceRuntime = async ({ projectPath, service }) => {
  if (!service) {
    throw new Error('No service selected to start.');
  }
  if (service.processId && isProcessRunning(service.processId)) {
    return;
  }

  const { project } = await loadProjectWithServices(projectPath);
  if (!project) {
    throw new Error(`Project not found for path ${projectPath}`);
  }

  await project.reload({ include: getProjectIncludes() });
  const refreshedService = project.services.find((item) => item.id === service.id) || service;
  const previousPid = Number(refreshedService.processId);
  if (Number.isInteger(previousPid) && previousPid > 0 && !isProcessRunning(previousPid)) {
    await refreshedService.update({ processId: null });
  }
  const portBlock = await getOrAllocateProjectPortBlock(project, project.services || []);
  const overrides = buildPortOverrides(portBlock);

  const servicePort = getPrimaryPortForService(refreshedService, overrides);
  await refreshedService.update({ port: Number.isInteger(servicePort) ? servicePort : null });

  const rootEnv = await parseRootEnv(projectPath);
  const env = {
    ...process.env,
    ...rootEnv,
    ...overrides,
    ...(Number.isInteger(servicePort) && servicePort > 0
      ? { PORT: String(servicePort) }
      : {}),
  };

  const cwd = getServiceCwd(projectPath, refreshedService);
  const serviceDisplayName = resolveServiceDisplayName(refreshedService);
  const launchCommand = 'yarn dev';
  const bootstrappedLaunchCommand = buildLaunchBootstrapCommand({
    cwd,
    launchCommand,
  });
  const stdoutPath = path.join(LOG_DIR, `${refreshedService.id}.stdout.log`);
  const stderrPath = path.join(LOG_DIR, `${refreshedService.id}.stderr.log`);
  resetServiceLogFiles({
    projectPath,
    serviceId: refreshedService.id,
    stdoutPath,
    stderrPath,
  });

  const stdoutFd = fs.openSync(stdoutPath, 'a');
  const stderrFd = fs.openSync(stderrPath, 'a');

  let child;
  try {
    child = spawn(bootstrappedLaunchCommand, {
      cwd,
      env,
      // Write logs directly to files so services can keep running after the controller restarts.
      stdio: ['ignore', stdoutFd, stderrFd],
      shell: true,
      detached: true,
    });
  } finally {
    closeFdSafely(stdoutFd);
    closeFdSafely(stderrFd);
  }

  if (!child) {
    throw new Error(`Failed to spawn service ${refreshedService.name}.`);
  }
  const pid = child.pid || null;
  if (!pid) {
    throw new Error(`Failed to spawn service ${refreshedService.name}.`);
  }
  child.unref();

  activeProcesses.set(refreshedService.id, {
    child,
    pid,
    projectPath,
    serviceId: refreshedService.id,
    serviceName: serviceDisplayName,
    stdoutPath,
    stderrPath,
  });

  registerServiceLogFiles({
    projectPath,
    serviceName: serviceDisplayName,
    pid,
    stdoutPath,
    stderrPath,
  });

  await refreshedService.update({ processId: pid });
  serviceRuntimeStates.set(refreshedService.id, {
    status: 'starting',
    pid,
    startedAt: Date.now(),
    lastExitCode: null,
  });
  stopRequestedServices.delete(refreshedService.id);
  await emitRuntimeForProject(projectPath);

  child.on('close', async (code) => {
    const processEntry = activeProcesses.get(refreshedService.id);
    if (processEntry) {
      appendSystemLogLine({
        filePath: processEntry.stdoutPath,
        serviceName: serviceDisplayName,
        message: 'Process exited.',
      });
      activeProcesses.delete(refreshedService.id);
    }

    const freshService = await Service.findByPk(refreshedService.id);
    if (freshService && freshService.processId === pid) {
      await freshService.update({ processId: null });
    }

    const intentionalStop = stopRequestedServices.has(refreshedService.id);
    stopRequestedServices.delete(refreshedService.id);
    serviceRuntimeStates.set(refreshedService.id, {
      status: intentionalStop ? 'stopped' : 'crashed',
      pid: null,
      startedAt: serviceRuntimeStates.get(refreshedService.id)?.startedAt || null,
      lastExitCode: Number.isInteger(code) ? code : null,
    });
    await emitRuntimeForProject(projectPath);
  });
};

const stopServiceRuntime = async ({ service }) => {
  if (!service || !service.processId) {
    return;
  }
  const pid = Number(service.processId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  stopRequestedServices.add(service.id);
  sendSignalToServiceProcess(pid, 'SIGTERM');

  const killTimer = setTimeout(() => {
    if (isProcessRunning(pid)) {
      sendSignalToServiceProcess(pid, 'SIGKILL');
    }
  }, 5000);
  killTimer.unref?.();
};

const stopServiceByProcessId = async (processId) => {
  const pid = Number(processId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  const service = await Service.findOne({ where: { processId: pid } });
  if (!service) {
    return;
  }
  await stopServiceRuntime({ service });
};

const toggleServiceRuntime = async ({ projectPath, serviceKey }) => {
  const { projectPath: normalizedPath, project } = await loadProjectWithServices(projectPath);
  if (!project) {
    throw new Error(`Project not found for path ${normalizedPath}`);
  }

  const services = project.services || [];
  const targetService = resolveServiceForKey(services, serviceKey);
  if (!targetService) {
    throw new Error(`No service found for key "${serviceKey}" in ${normalizedPath}`);
  }

  if (targetService.processId && isProcessRunning(targetService.processId)) {
    await stopServiceRuntime({ service: targetService });
  } else {
    await startServiceRuntime({ projectPath: normalizedPath, service: targetService });
  }

  return getProjectRuntime(normalizedPath);
};

const selectStartableServices = (services) => {
  const packageJsonServices = services.filter((service) => service.hasPackageJson);
  if (packageJsonServices.length === 0) {
    return [];
  }
  if (packageJsonServices.length === 1) {
    return [packageJsonServices[0]];
  }

  const slotsInOrder = ['main', 'api', 'admin', 'graphql'];
  const selected = [];
  const seen = new Set();

  for (const slot of slotsInOrder) {
    const candidate = resolveServiceForKey(packageJsonServices, slot);
    if (!candidate) {
      continue;
    }
    const identity = Number.isInteger(candidate.id)
      ? String(candidate.id)
      : `${String(candidate.name || '').toLowerCase()}::${String(candidate.relativePath || '')}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    selected.push(candidate);
  }

  if (selected.length > 0) {
    return selected;
  }

  return [packageJsonServices[0]];
};

const toggleProjectRuntime = async ({ projectPath }) => {
  const { projectPath: normalizedPath, project } = await loadProjectWithServices(projectPath);
  if (!project) {
    throw new Error(`Project not found for path ${normalizedPath}`);
  }

  const services = project.services || [];
  const running = services.filter((service) => service.processId && isProcessRunning(service.processId));
  if (running.length > 0) {
    for (const service of running) {
      await stopServiceRuntime({ service });
    }
    return getProjectRuntime(normalizedPath);
  }

  const startableServices = selectStartableServices(services);
  for (const service of startableServices) {
    await startServiceRuntime({ projectPath: normalizedPath, service });
  }
  return getProjectRuntime(normalizedPath);
};

const getProjectRuntime = async (projectPath) => {
  const { projectPath: normalizedPath, project } = await loadProjectWithServices(projectPath);
  if (!project) {
    return {
      projectPath: normalizedPath,
      status: 'stopped',
      pid: null,
      startedAt: null,
      stoppedAt: toIso(new Date()),
      lastExitCode: null,
      ports: [],
      portRangeBegin: null,
      portRangeEnd: null,
      servicePorts: { main: null, graphql: null, api: null, admin: null },
      servicePids: { main: null, graphql: null, api: null, admin: null },
      serviceStates: { main: 'stopped', graphql: 'stopped', api: 'stopped', admin: 'stopped' },
      serviceRuntimeEntries: [],
    };
  }

  for (const service of project.services || []) {
    if (service.processId && !isProcessRunning(service.processId)) {
      await service.update({ processId: null });
      if (!stopRequestedServices.has(service.id)) {
        const state = serviceRuntimeStates.get(service.id) || {};
        serviceRuntimeStates.set(service.id, {
          ...state,
          status: state.status === 'starting' || state.status === 'started' ? 'crashed' : (state.status || 'stopped'),
          pid: null,
        });
      }
      stopRequestedServices.delete(service.id);
    }
  }

  await project.reload({ include: getProjectIncludes() });
  await clearProjectPortRangeIfIdle(project);
  return buildRuntimeSnapshot(normalizedPath, project.services || [], project.portRange || null);
};

const parseLogLine = (line) => {
  const [timestamp, serviceName, stream, ...rest] = line.split('\t');
  if (!timestamp || !serviceName || !stream) {
    return null;
  }

  if (!Number.isFinite(new Date(timestamp).getTime())) {
    return null;
  }

  if (stream !== 'stdout' && stream !== 'stderr' && stream !== 'system') {
    return null;
  }

  return {
    timestamp,
    serviceName,
    stream,
    message: rest.join('\t') || '',
  };
};

const parsePsLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/,
  );
  if (!match) {
    return null;
  }

  const pid = Number(match[1]);
  const cpuPercent = Number(match[2]);
  const memoryPercent = Number(match[3]);
  const rssKb = Number(match[4]);
  const virtualKb = Number(match[5]);
  const elapsed = String(match[6] || '').trim();
  const command = String(match[7] || '').trim();

  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  return {
    pid,
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
    memoryPercent: Number.isFinite(memoryPercent) ? memoryPercent : 0,
    rssMb: Number.isFinite(rssKb) ? Number((rssKb / 1024).toFixed(1)) : 0,
    virtualMb: Number.isFinite(virtualKb) ? Number((virtualKb / 1024).toFixed(1)) : 0,
    elapsed,
    command,
  };
};

const readProcessStats = async (pid) => {
  const parsedPid = Number(pid);
  if (!Number.isInteger(parsedPid) || parsedPid <= 0) {
    return null;
  }
  if (!isProcessRunning(parsedPid)) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('ps', [
      '-p',
      String(parsedPid),
      '-o',
      'pid=,pcpu=,pmem=,rss=,vsz=,etime=,command=',
    ]);
    const firstLine = String(stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    return parsePsLine(firstLine);
  } catch {
    return null;
  }
};

const readLogFileEntries = async ({ filePath, serviceNameFallback, streamFallback }) => {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const stats = await fsp.stat(filePath).catch(() => null);
    const fallbackTimestampBase = Number.isFinite(stats?.birthtimeMs)
      ? stats.birthtimeMs
      : Number.isFinite(stats?.ctimeMs)
        ? stats.ctimeMs
        : Number.isFinite(stats?.mtimeMs)
          ? stats.mtimeMs
          : Date.now();

    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        const parsed = parseLogLine(line);
        if (parsed) {
          return {
            ...parsed,
            serviceName: parsed.serviceName || serviceNameFallback || 'unknown',
          };
        }

        // Support raw lines written directly by detached services.
        return {
          timestamp: new Date(fallbackTimestampBase + index).toISOString(),
          serviceName: serviceNameFallback || 'unknown',
          stream: streamFallback || 'stdout',
          message: String(line || '').trimEnd(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getProjectLogs = async ({ projectPath, limit, afterId, serviceNames }) => {
  const normalizedPath = path.resolve(projectPath);
  const normalizedLimit = clampLimit(limit);
  const serviceFilter = Array.isArray(serviceNames) ? new Set(serviceNames) : null;

  const { project } = await loadProjectWithServices(normalizedPath);
  if (!project) {
    return [];
  }

  const trackedFiles = ensureProjectLogFiles(normalizedPath);
  for (const service of project.services || []) {
    if (!service.processId) {
      continue;
    }
    registerServiceLogFiles({
      projectPath: normalizedPath,
      serviceName: resolveServiceDisplayName(service),
      pid: service.processId,
      stdoutPath: path.join(LOG_DIR, `${service.id}.stdout.log`),
      stderrPath: path.join(LOG_DIR, `${service.id}.stderr.log`),
    });
  }

  const allEntries = [];
  for (const tracked of trackedFiles) {
    const stdoutEntries = await readLogFileEntries({
      filePath: tracked.stdoutPath,
      serviceNameFallback: tracked.serviceName,
      streamFallback: 'stdout',
    });
    const stderrEntries = await readLogFileEntries({
      filePath: tracked.stderrPath,
      serviceNameFallback: tracked.serviceName,
      streamFallback: 'stderr',
    });
    allEntries.push(...stdoutEntries, ...stderrEntries);
  }

  allEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let withIds = allEntries.map((entry, index) => ({
    id: index + 1,
    projectPath: normalizedPath,
    timestamp: entry.timestamp,
    serviceName: entry.serviceName,
    stream: entry.stream,
    message: entry.message,
  }));

  if (Number.isInteger(afterId) && afterId > 0) {
    withIds = withIds.filter((entry) => entry.id > afterId);
  }
  if (serviceFilter) {
    withIds = withIds.filter((entry) => serviceFilter.has(entry.serviceName));
  }
  return withIds.slice(-normalizedLimit);
};

const getProjectLaunchEnvironment = async (projectPath) => {
  const normalizedPath = path.resolve(projectPath);
  const { project } = await loadProjectWithServices(normalizedPath);
  if (!project) {
    return [];
  }

  const rootEnv = await parseRootEnv(normalizedPath);
  const settings = getProjectPortRangeSettingsFromProject(project);
  let portBlock = Number(project?.portRange?.begin);
  if ((!Number.isInteger(portBlock) || portBlock <= 0) && settings.mode === 'manual') {
    const manualBegin = normalizePortRangeBegin(settings.begin);
    if (manualBegin) {
      portBlock = manualBegin;
    }
  }
  if (!Number.isInteger(portBlock) || portBlock <= 0) {
    portBlock = await allocateOpenPortBlock({ excludeProjectId: project.id });
  }
  const overrides = buildPortOverrides(portBlock);
  const merged = {
    ...rootEnv,
    ...overrides,
  };
  const overrideKeysInOrder = Object.keys(overrides);
  const overridePriority = new Map(overrideKeysInOrder.map((key, index) => [key, index]));

  return Object.entries(merged)
    .map(([key, value]) => ({ key, value: String(value ?? '') }))
    .sort((a, b) => {
      const leftPriority = overridePriority.has(a.key) ? overridePriority.get(a.key) : Number.POSITIVE_INFINITY;
      const rightPriority = overridePriority.has(b.key) ? overridePriority.get(b.key) : Number.POSITIVE_INFINITY;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return a.key.localeCompare(b.key);
    });
};

const getProjectProcessStats = async (projectPath) => {
  const normalizedPath = path.resolve(projectPath);
  const { project } = await loadProjectWithServices(normalizedPath);
  if (!project) {
    return [];
  }

  const result = [];

  for (const service of project.services || []) {
    const pid = Number(service.processId);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }

    if (!isProcessRunning(pid)) {
      await service.update({ processId: null });
      const state = serviceRuntimeStates.get(service.id) || {};
      serviceRuntimeStates.set(service.id, {
        ...state,
        status: stopRequestedServices.has(service.id)
          ? 'stopped'
          : 'crashed',
        pid: null,
      });
      stopRequestedServices.delete(service.id);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const stats = await readProcessStats(pid);
    if (!stats) {
      continue;
    }

    result.push({
      serviceId: service.id,
      serviceName: resolveServiceDisplayName(service),
      serviceKey: inferServiceKey(service),
      pid: stats.pid,
      cpuPercent: stats.cpuPercent,
      memoryPercent: stats.memoryPercent,
      rssMb: stats.rssMb,
      virtualMb: stats.virtualMb,
      elapsed: stats.elapsed || '',
      command: stats.command || '',
      status: 'running',
    });
  }

  result.sort((left, right) => {
    const leftSlotIndex = SERVICE_KEY_ORDER.indexOf(left.serviceKey);
    const rightSlotIndex = SERVICE_KEY_ORDER.indexOf(right.serviceKey);
    const a = leftSlotIndex >= 0 ? leftSlotIndex : SERVICE_KEY_ORDER.length + 1;
    const b = rightSlotIndex >= 0 ? rightSlotIndex : SERVICE_KEY_ORDER.length + 1;
    if (a !== b) {
      return a - b;
    }
    return String(left.serviceName || '').localeCompare(String(right.serviceName || ''));
  });

  return result;
};

const getProjectPortRangeSettings = async (projectPath) => {
  const normalizedPath = path.resolve(projectPath);
  const project = await Project.findOne({
    where: buildProjectPathWhere(normalizedPath),
    attributes: ['id', 'metadata'],
  });
  if (!project) {
    return {
      mode: 'automatic',
      begin: null,
    };
  }
  return getProjectPortRangeSettingsFromProject(project);
};

const setProjectPortRangeSettings = async ({ projectPath, mode, begin }) => {
  const normalizedPath = path.resolve(projectPath);
  const project = await Project.findOne({
    where: buildProjectPathWhere(normalizedPath),
    attributes: ['id', 'metadata'],
  });
  if (!project) {
    throw new Error(`Project not found for path ${normalizedPath}`);
  }

  const normalizedMode = normalizePortRangeMode(mode);
  const normalizedBegin = normalizePortRangeBegin(begin);
  if (normalizedMode === 'manual' && begin != null && normalizedBegin == null) {
    throw new Error(`Manual port range begin must be an integer between 1 and ${PORT_BLOCK_MAX - PORT_BLOCK_SIZE + 1}.`);
  }

  const nextSettings = normalizedMode === 'manual'
    ? { mode: 'manual', begin: normalizedBegin }
    : { mode: 'automatic', begin: null };
  const nextMetadata = {
    ...getProjectMetadata(project),
    [PORT_RANGE_OVERRIDE_KEY]: nextSettings,
  };

  await project.update({
    metadata: nextMetadata,
  });

  return nextSettings;
};

const monitorPids = async () => {
  if (pidMonitorActive) {
    return;
  }
  pidMonitorActive = true;

  try {
    const services = await Service.findAll({
      where: { processId: { [Op.ne]: null } },
      include: [{ model: Project, as: 'project' }],
    });
    const changedProjectPaths = new Set();
    const now = Date.now();

    for (const service of services) {
      const projectPath = getProjectPath(service.project);
      if (!projectPath) {
        continue;
      }

      if (!isProcessRunning(service.processId)) {
        await service.update({ processId: null });
        const previous = serviceRuntimeStates.get(service.id) || {};
        const intentionalStop = stopRequestedServices.has(service.id);
        stopRequestedServices.delete(service.id);
        serviceRuntimeStates.set(service.id, {
          ...previous,
          status: intentionalStop ? 'stopped' : 'crashed',
          pid: null,
        });
        changedProjectPaths.add(projectPath);
        continue;
      }

      const state = serviceRuntimeStates.get(service.id) || {
        status: 'started',
        pid: service.processId,
        startedAt: now,
        lastExitCode: null,
      };

      if (state.status === 'starting' && now - (state.startedAt || now) >= STABLE_RUNNING_MS) {
        state.status = 'started';
        changedProjectPaths.add(projectPath);
      }
      state.pid = service.processId;
      serviceRuntimeStates.set(service.id, state);
    }

    for (const projectPath of changedProjectPaths) {
      await emitRuntimeForProject(projectPath);
    }
  } finally {
    pidMonitorActive = false;
  }
};

const startPidMonitor = () => {
  if (pidMonitorTimer) {
    return;
  }
  pidMonitorTimer = setInterval(() => {
    monitorPids().catch(() => {});
  }, 1000);
};

const setRuntimeEventSink = (sink) => {
  eventSink = sink;
};

module.exports = {
  toggleProjectRuntime,
  toggleServiceRuntime,
  getProjectRuntime,
  getProjectLogs,
  getProjectLaunchEnvironment,
  getProjectPortRangeSettings,
  setProjectPortRangeSettings,
  getProjectProcessStats,
  setRuntimeEventSink,
  startPidMonitor,
  stopServiceByProcessId,
};
