const typeDefs = `#graphql
  type ServiceEnvEntry {
    key: String!
    value: String
  }

  type ServiceEnvFile {
    file: String!
    entries: [ServiceEnvEntry!]!
  }

  type ServiceScript {
    name: String!
    command: String!
  }

  type DeclaredService {
    name: String!
    path: String!
    relativePath: String!
    language: String!
    hasPackageJson: Boolean!
    hasMakefile: Boolean!
    packageScripts: [ServiceScript!]!
    makeTargets: [String!]!
    envVarNames: [String!]!
    envFiles: [ServiceEnvFile!]!
    effectiveEnvVarMap: [ServiceEnvEntry!]!
  }

  type ServicePorts {
    main: Int
    graphql: Int
    api: Int
    admin: Int
  }

  type ServicePids {
    main: Int
    graphql: Int
    api: Int
    admin: Int
  }

  type ServiceStates {
    main: String!
    graphql: String!
    api: String!
    admin: String!
  }

  type ServiceRuntimeEntry {
    key: String!
    serviceName: String!
    pid: Int
    port: Int
    state: String!
  }

  type RuntimeConfig {
    appUrl: String
    graphqlEndpoint: String
    wsEndpoint: String
    runtimeBackend: String!
    version: String
    protocolVersion: String
    slaveTargetVersion: String
  }

  type MasterAgentInfo {
    socketPath: String
    target: String
    slaveControlTarget: String
    slaveControlPort: Int
    service: String
    status: String
    connectionStatus: String
    connectionHealth: String
    lastConnectedAt: String
    lastAttemptAt: String
    reconnectAttempts: Int
    version: String
    protocolVersion: String
    startedAt: String
    capabilities: [String!]!
    grantedCapabilities: [String!]!
    error: String
  }

  type RuntimeBackendInfo {
    name: String!
    displayName: String!
    masterAgent: MasterAgentInfo
  }

  type HostProject {
    id: Int!
    name: String!
    path: String
  }

  type Host {
    id: Int!
    agentUuid: String
    ip: String!
    port: Int!
    targetSocket: String
    name: String!
    source: String!
    online: Boolean!
    health: String!
    status: String!
    lastSeenAt: String
    error: String
    version: String
    protocolVersion: String
    directories: [String!]!
    projectCount: Int!
    projects: [HostProject!]!
  }

  type HostCheckoutProjectResult {
    host: Host!
    commandId: String!
    status: String!
    message: String
  }

  input RuntimeEnvEntryInput {
    key: String!
    value: String
  }

  type RuntimeEnvEntry {
    key: String!
    value: String
  }

  type DesiredProcessDefinition {
    id: Int!
    hostId: Int!
    projectId: Int!
    serviceId: Int
    slaveId: String
    hostName: String
    projectName: String
    serviceName: String
    processKey: String!
    packageKey: String!
    packageRelativePath: String
    projectPath: String
    desiredState: String!
    launchMode: String!
    cwd: String!
    command: String!
    args: [String!]!
    env: [RuntimeEnvEntry!]!
    envHash: String
    launchFingerprint: String
    logRoot: String
    restartPolicy: String
    updatedAt: String
  }

  type ProcessRuntimeTelemetry {
    sampledAt: String!
    cpuPercent: Float!
    memoryPercent: Float!
    rssBytes: Float!
    vmsBytes: Float!
    readBytes: Float!
    writeBytes: Float!
    readOps: Float!
    writeOps: Float!
    openFds: Int
    threadCount: Int
    status: String!
  }

  type HostRuntimeTelemetry {
    sampledAt: String!
    cpuPercent: Float!
    load1m: Float
    load5m: Float
    load15m: Float
    memoryTotalBytes: Float!
    memoryUsedBytes: Float!
    memoryAvailableBytes: Float!
    diskTotalBytes: Float!
    diskUsedBytes: Float!
    diskAvailableBytes: Float!
    diskMount: String
  }

  type ObservedProcessRun {
    id: Int
    runId: String!
    desiredProcessId: Int
    hostId: Int!
    projectId: Int!
    serviceId: Int
    slaveId: String
    bootId: String
    processKey: String!
    packageKey: String!
    projectPath: String
    pid: Float!
    pgid: Float
    launchFingerprint: String
    command: String!
    args: [String!]!
    cwd: String
    envHash: String
    status: String!
    startedAt: String
    lastSeenAt: String
    exitedAt: String
    exitCode: Int
    exitSignal: String
    logPath: String
    adopted: Boolean!
    reconciliationSource: String
    runtimeState: ProcessRuntimeTelemetry
  }

  type SlaveRuntimeStateSnapshot {
    host: Host!
    desiredProcesses: [DesiredProcessDefinition!]!
    observedRuns: [ObservedProcessRun!]!
    hostRuntimeState: HostRuntimeTelemetry
  }

  type RuntimeKillCommandResult {
    commandId: String
    status: String!
    message: String
  }

  type TerminalOutputEntry {
    timestamp: String!
    stream: String!
    text: String!
  }

  type TerminalSession {
    sessionId: String!
    hostId: Int!
    hostName: String!
    hostIp: String!
    status: String!
    startedAt: String!
    closedAt: String
    exitCode: Int
    output: [TerminalOutputEntry!]!
  }

  type DiscoveryConfig {
    projectPath: String!
    folderPattern: String!
    maxDepth: Int!
  }

  type DiscoveredProject {
    name: String!
    path: String!
    relativePath: String!
    hostId: Int
    hostName: String
    types: [String!]!
    services: [String!]!
    hasMakefile: Boolean!
    declaredServices: [DeclaredService!]!
    runtimeStatus: String!
    runtimePid: Int
    runtimePorts: [Int!]!
    runtimePortRangeBegin: Int
    runtimePortRangeEnd: Int
    runtimeServicePorts: ServicePorts!
    runtimeServicePids: ServicePids!
    runtimeServiceStates: ServiceStates!
    runtimeServiceEntries: [ServiceRuntimeEntry!]!
    runtimeLastExitCode: Int
  }

  type ProjectRuntime {
    projectPath: String!
    status: String!
    pid: Int
    startedAt: String
    stoppedAt: String
    lastExitCode: Int
    portRangeBegin: Int
    portRangeEnd: Int
    servicePorts: ServicePorts!
    servicePids: ServicePids!
    serviceStates: ServiceStates!
    serviceRuntimeEntries: [ServiceRuntimeEntry!]!
  }

  type ProjectLogEntry {
    id: Int!
    projectPath: String!
    timestamp: String!
    serviceName: String!
    stream: String!
    message: String!
  }

  type ProjectProcessStat {
    serviceId: Int!
    serviceName: String!
    serviceKey: String!
    pid: Int!
    cpuPercent: Float!
    memoryPercent: Float!
    rssMb: Float!
    virtualMb: Float!
    elapsed: String!
    command: String!
    status: String!
  }

  enum PortRangeMode {
    AUTOMATIC
    MANUAL
  }

  type ProjectPortRangeSettings {
    mode: PortRangeMode!
    begin: Int
  }

  type ProjectDiscoveryResult {
    rootPath: String!
    folderPattern: String!
    maxDepth: Int!
    scannedAt: String!
    projects: [DiscoveredProject!]!
  }

  type Query {
    hello: String!
    runtimeConfig: RuntimeConfig!
    runtimeBackendInfo: RuntimeBackendInfo!
    hosts: [Host!]!
    slaveRuntimeState(hostId: Int, agentUuid: String): SlaveRuntimeStateSnapshot
    desiredProcesses(hostId: Int, projectId: Int, agentUuid: String): [DesiredProcessDefinition!]!
    observedProcessRuns(hostId: Int, agentUuid: String): [ObservedProcessRun!]!
    terminalSession(hostId: Int!): TerminalSession
    discoveryConfig: DiscoveryConfig!
    discoveredProjects: ProjectDiscoveryResult!
    projectRuntime(projectPath: String!): ProjectRuntime!
    projectLogs(projectPath: String!, limit: Int, afterId: Int, serviceNames: [String!]): [ProjectLogEntry!]!
    hostLogs(hostId: Int, agentUuid: String, limit: Int, afterId: Int, serviceNames: [String!]): [ProjectLogEntry!]!
    projectLaunchEnvironment(projectPath: String!): [ServiceEnvEntry!]!
    projectPortRangeSettings(projectPath: String!): ProjectPortRangeSettings!
    projectProcessStats(projectPath: String!): [ProjectProcessStat!]!
  }

  type Mutation {
    updateDiscoveryConfig(
      projectPath: String
      folderPattern: String
      maxDepth: Int
    ): DiscoveryConfig!
    addProject(projectPath: String!): ProjectDiscoveryResult!
    addHost(ip: String!): Host!
    deleteHost(hostId: Int!): Boolean!
    addHostDirectory(hostId: Int!, directoryPath: String!): Host!
    removeHostDirectory(hostId: Int!, directoryPath: String!): Host!
    upgradeHostAgent(hostId: Int!): Host!
    ensureDesiredProcess(
      desiredProcessId: Int
      hostId: Int
      agentUuid: String
      projectId: Int
      projectPath: String
      serviceId: Int
      processKey: String
      packageKey: String
      packageRelativePath: String
      desiredState: String
      launchMode: String!
      cwd: String!
      command: String!
      args: [String!]
      env: [RuntimeEnvEntryInput!]
      logRoot: String
      restartPolicy: String
      createdBy: String
      updatedBy: String
    ): DesiredProcessDefinition!
    deleteDesiredProcessDefinition(
      desiredProcessId: Int
      hostId: Int
      agentUuid: String
      projectId: Int
      projectPath: String
      packageKey: String
      processKey: String
    ): Boolean!
    softKillProcess(
      hostId: Int
      agentUuid: String
      runId: String
      processKey: String
      pid: Int
      reason: String
    ): RuntimeKillCommandResult!
    hardKillProcess(
      hostId: Int
      agentUuid: String
      runId: String
      processKey: String
      pid: Int
      reason: String
    ): RuntimeKillCommandResult!
    checkoutHostProject(
      hostId: Int!
      repositoryUrl: String!
      baseDirectory: String!
      destinationFolder: String!
    ): HostCheckoutProjectResult!
    startHostTerminalSession(hostId: Int!): TerminalSession!
    sendHostTerminalInput(sessionId: String!, input: String!): Boolean!
    closeHostTerminalSession(sessionId: String!): Boolean!
    toggleProjectRuntime(
      projectPath: String!
      projectTypes: [String!]
    ): ProjectRuntime!
    toggleServiceRuntime(
      projectPath: String!
      serviceKey: String!
    ): ProjectRuntime!
    setProjectPortRangeSettings(
      projectPath: String!
      mode: PortRangeMode!
      begin: Int
    ): ProjectPortRangeSettings!
  }
`;

const toGraphqlPortRangeMode = (mode) => (
  String(mode || '').toLowerCase() === 'manual'
    ? 'MANUAL'
    : 'AUTOMATIC'
);

const fromGraphqlPortRangeMode = (mode) => (
  String(mode || '').toUpperCase() === 'MANUAL'
    ? 'manual'
    : 'automatic'
);

const mapHostForGraphql = (host, fallback = {}) => {
  if (!host) {
    return null;
  }

  const mappedProjects = Array.isArray(host.projects)
    ? host.projects.map((project, index) => {
      const projectId = Number(project?.id);
      const fallbackId = 1_000_000 + index;
      return {
        id: Number.isInteger(projectId) && projectId > 0 ? projectId : fallbackId,
        name: String(project?.name || '').trim() || String(project?.path || '').trim() || '-',
        path: project?.metadata?.path || project?.path || null,
      };
    })
    : [];
  const explicitProjectCount = Number(host?.projectCount);
  const projectCount = Number.isInteger(explicitProjectCount) && explicitProjectCount >= 0
    ? explicitProjectCount
    : mappedProjects.length;

  return {
    id: Number(host.id),
    agentUuid: host?.agentUuid ? String(host.agentUuid) : null,
    ip: String(host.ip || ''),
    port: Number(host.port) || 0,
    targetSocket: host?.targetSocket ? String(host.targetSocket) : null,
    name: String(host.name || ''),
    source: String(host.source || 'runtime'),
    online: typeof host?.online === 'boolean' ? host.online : Boolean(fallback.online),
    health: String(host.health || fallback.health || 'unknown'),
    status: String(host.status || fallback.status || 'unknown'),
    lastSeenAt: host.lastSeenAt ? String(host.lastSeenAt) : null,
    error: host.error ? String(host.error) : (fallback.error ? String(fallback.error) : null),
    version: host?.version ? String(host.version) : (fallback?.version ? String(fallback.version) : null),
    protocolVersion: host?.protocolVersion
      ? String(host.protocolVersion)
      : (fallback?.protocolVersion ? String(fallback.protocolVersion) : null),
    directories: Array.isArray(host?.directories)
      ? host.directories.map((directory) => String(directory || '').trim()).filter(Boolean)
      : [],
    projectCount,
    projects: mappedProjects,
  };
};

const toPlainRecord = (value) => (
  value && typeof value?.get === 'function'
    ? value.get({ plain: true })
    : value
);

const mapRuntimeEnvEntries = (entriesOrObject) => {
  if (Array.isArray(entriesOrObject)) {
    return entriesOrObject
      .map((entry) => ({
        key: String(entry?.key || '').trim(),
        value: entry?.value == null ? null : String(entry.value),
      }))
      .filter((entry) => entry.key);
  }
  if (!entriesOrObject || typeof entriesOrObject !== 'object') {
    return [];
  }
  return Object.entries(entriesOrObject)
    .map(([key, value]) => ({
      key: String(key || '').trim(),
      value: value == null ? null : String(value),
    }))
    .filter((entry) => entry.key)
    .sort((left, right) => left.key.localeCompare(right.key));
};

const mapDesiredProcessForGraphql = (desiredProcess) => {
  const record = toPlainRecord(desiredProcess);
  if (!record) {
    return null;
  }
  const host = toPlainRecord(record.host);
  const project = toPlainRecord(record.project);
  const service = toPlainRecord(record.service);
  const id = Number(record.id);
  const hostId = Number(record.hostId);
  const projectId = Number(record.projectId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(hostId) || hostId <= 0 || !Number.isInteger(projectId) || projectId <= 0) {
    return null;
  }
  return {
    id,
    hostId,
    projectId,
    serviceId: Number.isInteger(Number(record.serviceId)) ? Number(record.serviceId) : null,
    slaveId: host?.agentUuid ? String(host.agentUuid).trim() : null,
    hostName: host?.name ? String(host.name).trim() : null,
    projectName: project?.name ? String(project.name).trim() : null,
    serviceName: service?.name ? String(service.name).trim() : null,
    processKey: String(record.processKey || '').trim(),
    packageKey: String(record.packageKey || '').trim(),
    packageRelativePath: record.packageRelativePath ? String(record.packageRelativePath).trim() : null,
    projectPath: project?.metadata?.path || project?.path || null,
    desiredState: String(record.desiredState || 'running').trim() || 'running',
    launchMode: String(record.launchMode || 'exec').trim() || 'exec',
    cwd: String(record.cwd || '').trim(),
    command: String(record.command || '').trim(),
    args: Array.isArray(record.argsJson) ? record.argsJson.map((value) => String(value)) : [],
    env: mapRuntimeEnvEntries(record.envJson),
    envHash: record.envHash ? String(record.envHash).trim() : null,
    launchFingerprint: record.launchFingerprint ? String(record.launchFingerprint).trim() : null,
    logRoot: record.logRoot ? String(record.logRoot).trim() : null,
    restartPolicy: record.restartPolicy ? String(record.restartPolicy).trim() : null,
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
  };
};

const mapProcessRuntimeTelemetryForGraphql = (runtimeState) => {
  const record = toPlainRecord(runtimeState);
  if (!record) {
    return null;
  }
  return {
    sampledAt: String(record.sampledAt || new Date().toISOString()),
    cpuPercent: Number(record.cpuPercent || 0),
    memoryPercent: Number(record.memoryPercent || 0),
    rssBytes: Number(record.rssBytes || 0),
    vmsBytes: Number(record.vmsBytes || 0),
    readBytes: Number(record.readBytes || 0),
    writeBytes: Number(record.writeBytes || 0),
    readOps: Number(record.readOps || 0),
    writeOps: Number(record.writeOps || 0),
    openFds: Number.isInteger(Number(record.openFds)) ? Number(record.openFds) : null,
    threadCount: Number.isInteger(Number(record.threadCount)) ? Number(record.threadCount) : null,
    status: String(record.status || 'unknown').trim() || 'unknown',
  };
};

const mapHostRuntimeTelemetryForGraphql = (hostRuntimeState) => {
  const record = toPlainRecord(hostRuntimeState);
  if (!record) {
    return null;
  }
  return {
    sampledAt: String(record.sampledAt || new Date().toISOString()),
    cpuPercent: Number(record.cpuPercent || 0),
    load1m: record.load1m == null ? null : Number(record.load1m),
    load5m: record.load5m == null ? null : Number(record.load5m),
    load15m: record.load15m == null ? null : Number(record.load15m),
    memoryTotalBytes: Number(record.memoryTotalBytes || 0),
    memoryUsedBytes: Number(record.memoryUsedBytes || 0),
    memoryAvailableBytes: Number(record.memoryAvailableBytes || 0),
    diskTotalBytes: Number(record.diskTotalBytes || 0),
    diskUsedBytes: Number(record.diskUsedBytes || 0),
    diskAvailableBytes: Number(record.diskAvailableBytes || 0),
    diskMount: record.diskMount ? String(record.diskMount).trim() : null,
  };
};

const mapObservedProcessRunForGraphql = (processRun) => {
  const record = toPlainRecord(processRun);
  if (!record) {
    return null;
  }
  const hostId = Number(record.hostId);
  const projectId = Number(record.projectId);
  if (!Number.isInteger(hostId) || hostId <= 0 || !Number.isInteger(projectId) || projectId <= 0) {
    return null;
  }
  return {
    id: Number.isInteger(Number(record.id)) ? Number(record.id) : null,
    runId: String(record.runId || '').trim(),
    desiredProcessId: Number.isInteger(Number(record.desiredProcessId)) ? Number(record.desiredProcessId) : null,
    hostId,
    projectId,
    serviceId: Number.isInteger(Number(record.serviceId)) ? Number(record.serviceId) : null,
    slaveId: record.slaveId ? String(record.slaveId).trim() : null,
    bootId: record.bootId ? String(record.bootId).trim() : null,
    processKey: String(record.packageKey || record.processKey || '').trim(),
    packageKey: String(record.packageKey || '').trim(),
    projectPath: record.projectPath ? String(record.projectPath).trim() : null,
    pid: Number(record.pid || 0),
    pgid: record.pgid == null ? null : Number(record.pgid),
    launchFingerprint: record.launchFingerprint ? String(record.launchFingerprint).trim() : null,
    command: String(record.command || '').trim(),
    args: Array.isArray(record.argsJson) ? record.argsJson.map((value) => String(value)) : [],
    cwd: record.cwd ? String(record.cwd).trim() : null,
    envHash: record.envHash ? String(record.envHash).trim() : null,
    status: String(record.status || 'unknown').trim() || 'unknown',
    startedAt: record.startedAt ? String(record.startedAt) : null,
    lastSeenAt: record.lastSeenAt ? String(record.lastSeenAt) : null,
    exitedAt: record.exitedAt ? String(record.exitedAt) : null,
    exitCode: Number.isInteger(Number(record.exitCode)) ? Number(record.exitCode) : null,
    exitSignal: record.exitSignal ? String(record.exitSignal).trim() : null,
    logPath: record.logPath ? String(record.logPath).trim() : null,
    adopted: Boolean(record.adopted),
    reconciliationSource: record.reconciliationSource ? String(record.reconciliationSource).trim() : null,
    runtimeState: mapProcessRuntimeTelemetryForGraphql(record.runtimeState),
  };
};

const mapSlaveRuntimeStateForGraphql = (runtimeState) => {
  if (!runtimeState || typeof runtimeState !== 'object') {
    return null;
  }
  const hostPayload = mapHostForGraphql(toPlainRecord(runtimeState.host));
  if (!hostPayload) {
    return null;
  }
  return {
    host: hostPayload,
    desiredProcesses: Array.isArray(runtimeState.desiredProcesses)
      ? runtimeState.desiredProcesses.map((entry) => mapDesiredProcessForGraphql(entry)).filter(Boolean)
      : [],
    observedRuns: Array.isArray(runtimeState.processRuns || runtimeState.observedRuns)
      ? (runtimeState.processRuns || runtimeState.observedRuns).map((entry) => mapObservedProcessRunForGraphql(entry)).filter(Boolean)
      : [],
    hostRuntimeState: mapHostRuntimeTelemetryForGraphql(runtimeState.hostRuntimeState),
  };
};

const normalizeTerminalOutputEntry = (entry) => ({
  timestamp: String(entry?.timestamp || new Date().toISOString()),
  stream: String(entry?.stream || 'stdout').trim().toLowerCase() || 'stdout',
  text: String(entry?.text || ''),
});

const mapTerminalSessionForGraphql = (session) => {
  if (!session || typeof session !== 'object') {
    return null;
  }

  const hostId = Number(session?.hostId);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    return null;
  }

  return {
    sessionId: String(session?.sessionId || '').trim(),
    hostId,
    hostName: String(session?.hostName || '').trim(),
    hostIp: String(session?.hostIp || '').trim(),
    status: String(session?.status || 'closed').trim().toLowerCase() || 'closed',
    startedAt: String(session?.startedAt || new Date().toISOString()),
    closedAt: session?.closedAt ? String(session.closedAt) : null,
    exitCode: Number.isInteger(Number(session?.exitCode)) ? Number(session.exitCode) : null,
    output: Array.isArray(session?.output)
      ? session.output.map((entry) => normalizeTerminalOutputEntry(entry))
      : [],
  };
};

const createResolvers = ({
  discoveryConfig,
  validateAndNormalizeConfig,
  discoverProjects,
  addCustomProjectPath,
  listHosts,
  addHost: addHostFn,
  deleteHost: deleteHostFn,
  addHostDirectory: addHostDirectoryFn,
  removeHostDirectory: removeHostDirectoryFn,
  checkoutHostProject: checkoutHostProjectFn,
  upgradeHostAgent: upgradeHostAgentFn,
  getTerminalSession: getTerminalSessionFn,
  startHostTerminalSession: startHostTerminalSessionFn,
  sendHostTerminalInput: sendHostTerminalInputFn,
  closeHostTerminalSession: closeHostTerminalSessionFn,
  processRegistry = null,
  runtimeBackend,
  serverVersion = null,
  serverProtocolVersion = null,
  serverSlaveTargetVersion = null,
}) => {
  if (!runtimeBackend) {
    throw new Error('runtimeBackend is required for GraphQL resolvers.');
  }
  if (typeof addCustomProjectPath !== 'function') {
    throw new Error('addCustomProjectPath is required for GraphQL resolvers.');
  }
  if (typeof listHosts !== 'function') {
    throw new Error('listHosts is required for GraphQL resolvers.');
  }
  if (typeof addHostFn !== 'function') {
    throw new Error('addHost is required for GraphQL resolvers.');
  }
  if (typeof deleteHostFn !== 'function') {
    throw new Error('deleteHost is required for GraphQL resolvers.');
  }
  if (typeof addHostDirectoryFn !== 'function') {
    throw new Error('addHostDirectory is required for GraphQL resolvers.');
  }
  if (typeof removeHostDirectoryFn !== 'function') {
    throw new Error('removeHostDirectory is required for GraphQL resolvers.');
  }
  if (typeof checkoutHostProjectFn !== 'function') {
    throw new Error('checkoutHostProject is required for GraphQL resolvers.');
  }
  if (typeof upgradeHostAgentFn !== 'function') {
    throw new Error('upgradeHostAgent is required for GraphQL resolvers.');
  }
  if (typeof getTerminalSessionFn !== 'function') {
    throw new Error('getTerminalSession is required for GraphQL resolvers.');
  }
  if (typeof startHostTerminalSessionFn !== 'function') {
    throw new Error('startHostTerminalSession is required for GraphQL resolvers.');
  }
  if (typeof sendHostTerminalInputFn !== 'function') {
    throw new Error('sendHostTerminalInput is required for GraphQL resolvers.');
  }
  if (typeof closeHostTerminalSessionFn !== 'function') {
    throw new Error('closeHostTerminalSession is required for GraphQL resolvers.');
  }
  if (processRegistry && typeof processRegistry !== 'object') {
    throw new Error('processRegistry must be an object when provided to GraphQL resolvers.');
  }

  const requireProcessRegistry = (methodName) => {
    if (!processRegistry || typeof processRegistry[methodName] !== 'function') {
      throw new Error(`processRegistry.${methodName} is required for runtime registry GraphQL operations.`);
    }
  };

  return ({
  Query: {
    hello: () => 'Hello from Project Discovery GraphQL server',
    runtimeConfig: () => ({
      appUrl: process.env.APP_URL || `http://localhost:${process.env.WEB_PORT || '3000'}`,
      graphqlEndpoint: '/graphql',
      wsEndpoint: process.env.WS_URL || `ws://localhost:${process.env.SERVER_PORT || '4000'}/ws`,
      runtimeBackend: runtimeBackend.name || 'js',
      version: String(serverVersion || '').trim() || null,
      protocolVersion: String(serverProtocolVersion || '').trim() || null,
      slaveTargetVersion: String(serverSlaveTargetVersion || '').trim() || null,
    }),
    runtimeBackendInfo: async () => {
      if (typeof runtimeBackend.getBackendInfo === 'function') {
        return runtimeBackend.getBackendInfo();
      }
      return {
        name: runtimeBackend.name || 'js',
        displayName: runtimeBackend.name === 'go-master' ? 'Go Master Agent' : 'JavaScript Runtime Manager',
        masterAgent: null,
      };
    },
    hosts: async () => {
      const hosts = await listHosts();
      return hosts.map((host) => mapHostForGraphql(host)).filter(Boolean);
    },
    slaveRuntimeState: async (_, { hostId, agentUuid }) => {
      requireProcessRegistry('getSlaveRuntimeState');
      const runtimeState = await processRegistry.getSlaveRuntimeState({
        hostId,
        slaveId: agentUuid,
      });
      return mapSlaveRuntimeStateForGraphql(runtimeState);
    },
    desiredProcesses: async (_, { hostId, projectId, agentUuid }) => {
      requireProcessRegistry('listDesiredProcesses');
      const desiredProcesses = await processRegistry.listDesiredProcesses({
        hostId,
        projectId,
        slaveId: agentUuid,
      });
      return Array.isArray(desiredProcesses)
        ? desiredProcesses.map((entry) => mapDesiredProcessForGraphql(entry)).filter(Boolean)
        : [];
    },
    observedProcessRuns: async (_, { hostId, agentUuid }) => {
      requireProcessRegistry('getSlaveRuntimeState');
      const runtimeState = await processRegistry.getSlaveRuntimeState({
        hostId,
        slaveId: agentUuid,
      });
      const runs = Array.isArray(runtimeState?.processRuns) ? runtimeState.processRuns : [];
      return runs.map((entry) => mapObservedProcessRunForGraphql(entry)).filter(Boolean);
    },
    terminalSession: async (_, { hostId }) => {
      const session = await getTerminalSessionFn({ hostId });
      return mapTerminalSessionForGraphql(session);
    },
    discoveryConfig: () => ({ ...discoveryConfig }),
    discoveredProjects: async () => {
      const discovered = await discoverProjects(discoveryConfig);
      const runtimes = await Promise.all(
        discovered.projects.map((project) => runtimeBackend.getProjectRuntime(project.path)),
      );
      return {
        ...discovered,
        projects: discovered.projects.map((project, index) => {
          const runtime = runtimes[index] || {
            status: 'stopped',
            servicePorts: { main: null, graphql: null, api: null, admin: null },
            servicePids: { main: null, graphql: null, api: null, admin: null },
            serviceStates: { main: 'stopped', graphql: 'stopped', api: 'stopped', admin: 'stopped' },
            serviceRuntimeEntries: [],
            ports: [],
            portRangeBegin: null,
            portRangeEnd: null,
          };
          return {
            ...project,
            hostId: Number.isInteger(Number(project?.hostId)) ? Number(project.hostId) : null,
            hostName: project?.hostName ? String(project.hostName) : null,
            runtimeStatus: runtime.status,
            runtimePid: runtime.pid,
            runtimePorts: runtime.ports || [],
            runtimePortRangeBegin: runtime.portRangeBegin ?? null,
            runtimePortRangeEnd: runtime.portRangeEnd ?? null,
            runtimeServicePorts: runtime.servicePorts || {},
            runtimeServicePids: runtime.servicePids || {},
            runtimeServiceStates: runtime.serviceStates || {
              main: 'stopped',
              graphql: 'stopped',
              api: 'stopped',
              admin: 'stopped',
            },
            runtimeServiceEntries: runtime.serviceRuntimeEntries || [],
            runtimeLastExitCode: runtime.lastExitCode,
          };
        }),
      };
    },
    projectRuntime: async (_, { projectPath }) => runtimeBackend.getProjectRuntime(projectPath),
    projectLogs: async (_, { projectPath, limit, afterId, serviceNames }) =>
      runtimeBackend.getProjectLogs({ projectPath, limit, afterId, serviceNames }),
    hostLogs: async (_, { hostId, agentUuid, limit, afterId, serviceNames }) => {
      if (typeof runtimeBackend.getSlaveLogs !== 'function') {
        return [];
      }

      let resolvedAgentUuid = String(agentUuid || '').trim();
      if (!resolvedAgentUuid) {
        const parsedHostId = Number(hostId);
        if (Number.isInteger(parsedHostId) && parsedHostId > 0) {
          const hosts = await listHosts();
          const host = Array.isArray(hosts)
            ? hosts.find((candidate) => Number(candidate?.id) === parsedHostId)
            : null;
          resolvedAgentUuid = String(host?.agentUuid || '').trim();
        }
      }

      if (!resolvedAgentUuid) {
        return [];
      }

      return runtimeBackend.getSlaveLogs({
        slaveId: resolvedAgentUuid,
        limit,
        afterId,
        serviceNames,
      });
    },
    projectLaunchEnvironment: async (_, { projectPath }) =>
      runtimeBackend.getProjectLaunchEnvironment(projectPath),
    projectPortRangeSettings: async (_, { projectPath }) => {
      const settings = await runtimeBackend.getProjectPortRangeSettings(projectPath);
      return {
        mode: toGraphqlPortRangeMode(settings?.mode),
        begin: Number.isInteger(Number(settings?.begin)) ? Number(settings.begin) : null,
      };
    },
    projectProcessStats: async (_, { projectPath }) =>
      runtimeBackend.getProjectProcessStats(projectPath),
  },
  Mutation: {
    updateDiscoveryConfig: async (_, args) => {
      const normalized = await validateAndNormalizeConfig(args || {});
      discoveryConfig.projectPath = normalized.projectPath;
      discoveryConfig.folderPattern = normalized.folderPattern;
      discoveryConfig.maxDepth = normalized.maxDepth;
      return { ...discoveryConfig };
    },
    addProject: async (_, { projectPath }) => addCustomProjectPath(projectPath),
    addHost: async (_, { ip }) => {
      const host = await addHostFn(ip);
      return mapHostForGraphql(host, {
        online: false,
        health: 'warning',
        status: 'unregistered',
        error: 'Slave not registered with master yet.',
      });
    },
    deleteHost: async (_, { hostId }) => deleteHostFn(hostId),
    addHostDirectory: async (_, { hostId, directoryPath }) => {
      const host = await addHostDirectoryFn({ hostId, directoryPath });
      return mapHostForGraphql(host);
    },
    removeHostDirectory: async (_, { hostId, directoryPath }) => {
      const host = await removeHostDirectoryFn({ hostId, directoryPath });
      return mapHostForGraphql(host);
    },
    upgradeHostAgent: async (_, { hostId }) => {
      const host = await upgradeHostAgentFn({ hostId });
      return mapHostForGraphql(host);
    },
    ensureDesiredProcess: async (_, args) => {
      requireProcessRegistry('ensureDesiredProcess');
      const desiredProcess = await processRegistry.ensureDesiredProcess({
        desiredProcessId: args.desiredProcessId,
        hostId: args.hostId,
        slaveId: args.agentUuid,
        projectId: args.projectId,
        projectPath: args.projectPath,
        serviceId: args.serviceId,
        processKey: args.processKey,
        packageKey: args.packageKey,
        packageRelativePath: args.packageRelativePath,
        desiredState: args.desiredState,
        launchMode: args.launchMode,
        cwd: args.cwd,
        command: args.command,
        argsJson: Array.isArray(args.args) ? args.args : [],
        envJson: Array.isArray(args.env)
          ? args.env.reduce((accumulator, entry) => {
            const key = String(entry?.key || '').trim();
            if (!key) {
              return accumulator;
            }
            accumulator[key] = entry?.value == null ? '' : String(entry.value);
            return accumulator;
          }, {})
          : {},
        logRoot: args.logRoot,
        restartPolicy: args.restartPolicy,
        createdBy: args.createdBy,
        updatedBy: args.updatedBy,
      });
      return mapDesiredProcessForGraphql(desiredProcess);
    },
    deleteDesiredProcessDefinition: async (_, args) => {
      requireProcessRegistry('deleteDesiredProcessDefinition');
      return processRegistry.deleteDesiredProcessDefinition({
        desiredProcessId: args.desiredProcessId,
        hostId: args.hostId,
        slaveId: args.agentUuid,
        projectId: args.projectId,
        projectPath: args.projectPath,
        packageKey: args.packageKey,
        processKey: args.processKey,
      });
    },
    softKillProcess: async (_, args) => {
      requireProcessRegistry('queueProcessKill');
      const result = await processRegistry.queueProcessKill({
        hostId: args.hostId,
        slaveId: args.agentUuid,
        runId: args.runId,
        processKey: args.processKey,
        pid: args.pid,
        hard: false,
        reason: args.reason,
      });
      return {
        commandId: result?.commandId ? String(result.commandId) : null,
        status: String(result?.status || 'queued').trim().toLowerCase() || 'queued',
        message: 'soft kill command queued',
      };
    },
    hardKillProcess: async (_, args) => {
      requireProcessRegistry('queueProcessKill');
      const result = await processRegistry.queueProcessKill({
        hostId: args.hostId,
        slaveId: args.agentUuid,
        runId: args.runId,
        processKey: args.processKey,
        pid: args.pid,
        hard: true,
        reason: args.reason,
      });
      return {
        commandId: result?.commandId ? String(result.commandId) : null,
        status: String(result?.status || 'queued').trim().toLowerCase() || 'queued',
        message: 'hard kill command queued',
      };
    },
    checkoutHostProject: async (_, {
      hostId,
      repositoryUrl,
      baseDirectory,
      destinationFolder,
    }) => {
      const result = await checkoutHostProjectFn({
        hostId,
        repositoryUrl,
        baseDirectory,
        destinationFolder,
      });
      const hostPayload = mapHostForGraphql(result?.host);
      if (!hostPayload) {
        throw new Error('Unable to map host checkout response.');
      }
      return {
        host: hostPayload,
        commandId: String(result?.commandId || ''),
        status: String(result?.status || 'queued'),
        message: result?.message ? String(result.message) : null,
      };
    },
    startHostTerminalSession: async (_, { hostId }) => {
      const session = await startHostTerminalSessionFn({ hostId });
      const payload = mapTerminalSessionForGraphql(session);
      if (!payload) {
        throw new Error('Unable to map started terminal session.');
      }
      return payload;
    },
    sendHostTerminalInput: async (_, { sessionId, input }) => (
      sendHostTerminalInputFn({ sessionId, input })
    ),
    closeHostTerminalSession: async (_, { sessionId }) => (
      closeHostTerminalSessionFn({ sessionId })
    ),
    toggleProjectRuntime: async (_, args) =>
      runtimeBackend.toggleProjectRuntime({
        projectPath: args.projectPath,
        projectTypes: args.projectTypes,
      }),
    toggleServiceRuntime: async (_, args) =>
      runtimeBackend.toggleServiceRuntime({
        projectPath: args.projectPath,
        serviceKey: args.serviceKey,
      }),
    setProjectPortRangeSettings: async (_, args) => {
      const settings = await runtimeBackend.setProjectPortRangeSettings({
        projectPath: args.projectPath,
        mode: fromGraphqlPortRangeMode(args.mode),
        begin: args.begin,
      });
      return {
        mode: toGraphqlPortRangeMode(settings?.mode),
        begin: Number.isInteger(Number(settings?.begin)) ? Number(settings.begin) : null,
      };
    },
  },
  });
};

module.exports = {
  typeDefs,
  createResolvers,
};
