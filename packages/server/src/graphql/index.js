const {
  createAutomationToken,
  listAutomationTokens,
  revokeAutomationToken,
} = require('../auth/automationTokens');
const { authorizeLifecycleAction } = require('../auth/lifecycleAccess');

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

  type HostPathMapping {
    id: Int!
    hostId: Int!
    agentUuid: String
    logicalRoot: String
    codexPathPrefix: String!
    hostPathPrefix: String!
    description: String
    enabled: Boolean!
    createdBy: String
    updatedBy: String
    createdAt: String
    updatedAt: String
  }

  type ResolvedHostPath {
    inputPath: String!
    codexPath: String
    hostPath: String!
    source: String!
    approved: Boolean!
    matchedRoot: String
    approvedRoots: [String!]!
    mapping: HostPathMapping
  }

  type ProcessTemplate {
    id: Int
    hostId: Int
    projectId: Int
    templateKey: String!
    displayName: String!
    description: String
    packageKey: String!
    packageRelativePath: String
    processKeyTemplate: String!
    cwdTemplate: String!
    desiredState: String!
    launchMode: String!
    command: String!
    args: [String!]!
    env: [RuntimeEnvEntry!]!
    restartPolicy: String!
    healthChecksJson: String!
    logRoot: String
    enabled: Boolean!
    allowCodex: Boolean!
    source: String!
    scope: String!
    createdBy: String
    updatedBy: String
    createdAt: String
    updatedAt: String
  }

  type AutomationApiToken {
    id: Int!
    name: String!
    accessMode: String!
    scopes: [String!]!
    effectiveScopes: [String!]!
    allowedHostIds: [Int!]!
    allowedProjectIds: [Int!]!
    allowedPathPrefixes: [String!]!
    rawCommandAllowed: Boolean!
    fullAccess: Boolean!
    expiresAt: String
    lastUsedAt: String
    createdBy: String
    revokedAt: String
    createdAt: String
    updatedAt: String
  }

  type CreateAutomationApiTokenResult {
    token: String!
    record: AutomationApiToken!
    warning: String
  }

  type RuntimeAuditEvent {
    id: Int!
    requestId: String
    actorType: String!
    actorId: String
    actorName: String
    toolName: String
    scope: String
    hostId: Int
    projectId: Int
    desiredProcessId: Int
    runId: String
    processKey: String
    action: String!
    inputJson: String!
    resultJson: String!
    status: String!
    errorMessage: String
    createdAt: String
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

  type ResolvedProcessTemplate {
    template: ProcessTemplate!
    hostId: Int!
    agentUuid: String
    projectId: Int!
    projectPath: String
    processKey: String!
    packageKey: String!
    packageRelativePath: String
    desiredState: String!
    launchMode: String!
    cwd: String!
    command: String!
    args: [String!]!
    env: [RuntimeEnvEntry!]!
    logRoot: String
    restartPolicy: String!
    healthChecksJson: String!
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

  type RuntimeWaitResult {
    status: String!
    matchedCheck: String
    failedCheck: String
    elapsedMs: Int!
    observedRun: ObservedProcessRun
    lastLogLines: [String!]!
    httpStatus: Int
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
    automationApiTokens(includeRevoked: Boolean): [AutomationApiToken!]!
    runtimeAuditEvents(limit: Int, action: String, hostId: Int, projectId: Int, actorType: String): [RuntimeAuditEvent!]!
    hostPathMappings(hostId: Int, agentUuid: String, includeDisabled: Boolean): [HostPathMapping!]!
    resolveHostPath(hostId: Int, agentUuid: String, path: String!, allowUnapproved: Boolean): ResolvedHostPath!
    processTemplates(hostId: Int, agentUuid: String, projectId: Int, projectPath: String, codexPath: String, includeDisabled: Boolean, codexOnly: Boolean, allowUnapproved: Boolean): [ProcessTemplate!]!
    resolveProcessTemplate(hostId: Int, agentUuid: String, projectId: Int, projectPath: String, codexPath: String, templateKey: String!, packageKey: String, packageRelativePath: String, processKey: String, allowUnapproved: Boolean, codexOnly: Boolean, env: [RuntimeEnvEntryInput!]): ResolvedProcessTemplate!
    waitForRuntime(hostId: Int, agentUuid: String, projectId: Int, projectPath: String, codexPath: String, runId: String, processKey: String, packageKey: String, templateKey: String, status: String, expectedStatus: String, expectedExitCode: Int, timeoutMs: Int, intervalMs: Int, healthChecksJson: String, url: String, method: String, bodyIncludes: String, port: Int, tcpHost: String, pattern: String, graphqlEndpoint: String, query: String, variablesJson: String): RuntimeWaitResult!
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
    createAutomationApiToken(
      name: String!
      accessMode: String!
      scopes: [String!]
      allowedHostIds: [Int!]
      allowedProjectIds: [Int!]
      allowedPathPrefixes: [String!]
      rawCommandAllowed: Boolean
      fullAccess: Boolean
      expiresAt: String
    ): CreateAutomationApiTokenResult!
    revokeAutomationApiToken(id: Int!): Boolean!
    upsertHostPathMapping(
      id: Int
      hostId: Int
      agentUuid: String
      logicalRoot: String
      codexPathPrefix: String!
      hostPathPrefix: String!
      description: String
      enabled: Boolean
      allowUnapproved: Boolean
      createdBy: String
      updatedBy: String
    ): HostPathMapping!
    deleteHostPathMapping(id: Int!, hostId: Int, agentUuid: String): Boolean!
    upsertProcessTemplate(
      id: Int
      hostId: Int
      projectId: Int
      templateKey: String!
      displayName: String
      description: String
      packageKey: String
      packageRelativePath: String
      processKeyTemplate: String
      cwdTemplate: String
      desiredState: String
      launchMode: String
      command: String!
      args: [String!]
      env: [RuntimeEnvEntryInput!]
      restartPolicy: String
      healthChecksJson: String
      logRoot: String
      enabled: Boolean
      allowCodex: Boolean
      createdBy: String
      updatedBy: String
    ): ProcessTemplate!
    deleteProcessTemplate(id: Int!, hostId: Int, projectId: Int): Boolean!
    ensureProcessFromTemplate(
      hostId: Int
      agentUuid: String
      projectId: Int
      projectPath: String
      codexPath: String
      templateKey: String!
      packageKey: String
      packageRelativePath: String
      processKey: String
      desiredState: String
      launchMode: String
      cwd: String
      command: String
      args: [String!]
      env: [RuntimeEnvEntryInput!]
      logRoot: String
      restartPolicy: String
      allowUnapproved: Boolean
      createdBy: String
      updatedBy: String
    ): DesiredProcessDefinition!
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

const mapHostPathMappingForGraphql = (mapping) => {
  const record = toPlainRecord(mapping);
  if (!record) {
    return null;
  }
  const id = Number(record.id);
  const hostId = Number(record.hostId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(hostId) || hostId <= 0) {
    return null;
  }
  return {
    id,
    hostId,
    agentUuid: record.agentUuid ? String(record.agentUuid).trim() : null,
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

const mapResolvedHostPathForGraphql = (resolvedPath) => {
  if (!resolvedPath || typeof resolvedPath !== 'object') {
    return null;
  }
  return {
    inputPath: String(resolvedPath.inputPath || '').trim(),
    codexPath: resolvedPath.codexPath ? String(resolvedPath.codexPath).trim() : null,
    hostPath: String(resolvedPath.hostPath || '').trim(),
    source: String(resolvedPath.source || 'unknown').trim() || 'unknown',
    approved: Boolean(resolvedPath.approved),
    matchedRoot: resolvedPath.matchedRoot ? String(resolvedPath.matchedRoot).trim() : null,
    approvedRoots: Array.isArray(resolvedPath.approvedRoots)
      ? resolvedPath.approvedRoots.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
    mapping: mapHostPathMappingForGraphql(resolvedPath.mapping),
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

const serializeJsonField = (value, fallback) => {
  const normalized = value === undefined || value === null ? fallback : value;
  try {
    return JSON.stringify(normalized);
  } catch {
    return JSON.stringify(fallback);
  }
};

const parseJsonArgument = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (Array.isArray(fallback) && Array.isArray(value)) {
    return value;
  }
  if (!Array.isArray(fallback) && value && typeof value === 'object') {
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

const safeJsonStringify = (value, fallback = {}) => {
  try {
    return JSON.stringify(value === undefined ? fallback : value);
  } catch {
    return JSON.stringify(fallback);
  }
};

const mapAutomationTokenForGraphql = (token) => {
  const record = toPlainRecord(token);
  if (!record) {
    return null;
  }
  const id = Number(record.id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return {
    id,
    name: String(record.name || '').trim(),
    accessMode: String(record.accessMode || 'observe').trim() || 'observe',
    scopes: Array.isArray(record.scopes) ? record.scopes.map((scope) => String(scope)) : [],
    effectiveScopes: Array.isArray(record.effectiveScopes)
      ? record.effectiveScopes.map((scope) => String(scope))
      : [],
    allowedHostIds: Array.isArray(record.allowedHostIds)
      ? record.allowedHostIds.map((value) => Number(value)).filter((value) => Number.isInteger(value))
      : [],
    allowedProjectIds: Array.isArray(record.allowedProjectIds)
      ? record.allowedProjectIds.map((value) => Number(value)).filter((value) => Number.isInteger(value))
      : [],
    allowedPathPrefixes: Array.isArray(record.allowedPathPrefixes)
      ? record.allowedPathPrefixes.map((value) => String(value))
      : [],
    rawCommandAllowed: Boolean(record.rawCommandAllowed),
    fullAccess: Boolean(record.fullAccess),
    expiresAt: record.expiresAt ? String(record.expiresAt) : null,
    lastUsedAt: record.lastUsedAt ? String(record.lastUsedAt) : null,
    createdBy: record.createdBy ? String(record.createdBy) : null,
    revokedAt: record.revokedAt ? String(record.revokedAt) : null,
    createdAt: record.createdAt ? String(record.createdAt) : null,
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
  };
};

const mapRuntimeAuditEventForGraphql = (event) => {
  const record = toPlainRecord(event);
  if (!record) {
    return null;
  }
  const id = Number(record.id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return {
    id,
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
    inputJson: safeJsonStringify(record.inputJson, {}),
    resultJson: safeJsonStringify(record.resultJson, {}),
    status: String(record.status || 'success'),
    errorMessage: record.errorMessage ? String(record.errorMessage) : null,
    createdAt: record.createdAt ? String(record.createdAt) : null,
  };
};

const mapProcessTemplateForGraphql = (template) => {
  const record = toPlainRecord(template);
  if (!record) {
    return null;
  }
  return {
    id: Number.isInteger(Number(record.id)) ? Number(record.id) : null,
    hostId: Number.isInteger(Number(record.hostId)) ? Number(record.hostId) : null,
    projectId: Number.isInteger(Number(record.projectId)) ? Number(record.projectId) : null,
    templateKey: String(record.templateKey || '').trim(),
    displayName: String(record.displayName || record.templateKey || '').trim(),
    description: record.description == null ? null : String(record.description),
    packageKey: String(record.packageKey || '').trim(),
    packageRelativePath: record.packageRelativePath ? String(record.packageRelativePath).trim() : null,
    processKeyTemplate: String(record.processKeyTemplate || '{{package.key}}').trim(),
    cwdTemplate: String(record.cwdTemplate || '{{project.hostPath}}').trim(),
    desiredState: String(record.desiredState || 'running').trim() || 'running',
    launchMode: String(record.launchMode || 'shell').trim() || 'shell',
    command: String(record.command || '').trim(),
    args: Array.isArray(record.argsJson) ? record.argsJson.map((entry) => String(entry)) : [],
    env: mapRuntimeEnvEntries(record.envJson),
    restartPolicy: String(record.restartPolicy || 'manual').trim() || 'manual',
    healthChecksJson: serializeJsonField(record.healthChecksJson, []),
    logRoot: record.logRoot ? String(record.logRoot).trim() : null,
    enabled: record.enabled !== false,
    allowCodex: record.allowCodex !== false,
    source: String(record.source || 'persisted').trim() || 'persisted',
    scope: String(record.scope || 'global').trim() || 'global',
    createdBy: record.createdBy ? String(record.createdBy) : null,
    updatedBy: record.updatedBy ? String(record.updatedBy) : null,
    createdAt: record.createdAt ? String(record.createdAt) : null,
    updatedAt: record.updatedAt ? String(record.updatedAt) : null,
  };
};

const mapResolvedProcessTemplateForGraphql = (resolved) => {
  if (!resolved || typeof resolved !== 'object') {
    return null;
  }
  const desiredProcess = toPlainRecord(resolved.desiredProcess);
  const template = mapProcessTemplateForGraphql(resolved.template);
  if (!desiredProcess || !template) {
    return null;
  }
  return {
    template,
    hostId: Number(desiredProcess.hostId),
    agentUuid: desiredProcess.slaveId ? String(desiredProcess.slaveId).trim() : null,
    projectId: Number(desiredProcess.projectId),
    projectPath: desiredProcess.projectPath ? String(desiredProcess.projectPath).trim() : null,
    processKey: String(desiredProcess.processKey || '').trim(),
    packageKey: String(desiredProcess.packageKey || '').trim(),
    packageRelativePath: desiredProcess.packageRelativePath ? String(desiredProcess.packageRelativePath).trim() : null,
    desiredState: String(desiredProcess.desiredState || 'running').trim() || 'running',
    launchMode: String(desiredProcess.launchMode || 'shell').trim() || 'shell',
    cwd: String(desiredProcess.cwd || '').trim(),
    command: String(desiredProcess.command || '').trim(),
    args: Array.isArray(desiredProcess.argsJson) ? desiredProcess.argsJson.map((entry) => String(entry)) : [],
    env: mapRuntimeEnvEntries(desiredProcess.envJson),
    logRoot: desiredProcess.logRoot ? String(desiredProcess.logRoot).trim() : null,
    restartPolicy: String(desiredProcess.restartPolicy || 'manual').trim() || 'manual',
    healthChecksJson: serializeJsonField(resolved.healthChecksJson || resolved.template?.healthChecksJson, []),
  };
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

const mapRuntimeWaitResultForGraphql = (result) => {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return {
    status: String(result.status || 'timeout').trim().toLowerCase() || 'timeout',
    matchedCheck: result.matchedCheck ? String(result.matchedCheck).trim() : null,
    failedCheck: result.failedCheck ? String(result.failedCheck).trim() : null,
    elapsedMs: Number.isInteger(Number(result.elapsedMs)) ? Number(result.elapsedMs) : 0,
    observedRun: mapObservedProcessRunForGraphql(result.observedRun),
    lastLogLines: Array.isArray(result.lastLogLines)
      ? result.lastLogLines.map((entry) => String(entry || '')).filter(Boolean)
      : [],
    httpStatus: Number.isInteger(Number(result.httpStatus)) ? Number(result.httpStatus) : null,
    message: result.message ? String(result.message) : null,
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
  hostPathMappings = null,
  processTemplates = null,
  runtimeWait = null,
  automationTokenStore = null,
  lifecycleAccess = null,
  runtimeAudit = null,
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
  if (hostPathMappings && typeof hostPathMappings !== 'object') {
    throw new Error('hostPathMappings must be an object when provided to GraphQL resolvers.');
  }
  if (processTemplates && typeof processTemplates !== 'object') {
    throw new Error('processTemplates must be an object when provided to GraphQL resolvers.');
  }
  if (runtimeWait && typeof runtimeWait !== 'object') {
    throw new Error('runtimeWait must be an object when provided to GraphQL resolvers.');
  }
  if (automationTokenStore && typeof automationTokenStore !== 'object') {
    throw new Error('automationTokenStore must be an object when provided to GraphQL resolvers.');
  }
  if (lifecycleAccess && typeof lifecycleAccess !== 'object') {
    throw new Error('lifecycleAccess must be an object when provided to GraphQL resolvers.');
  }
  if (runtimeAudit && typeof runtimeAudit !== 'object') {
    throw new Error('runtimeAudit must be an object when provided to GraphQL resolvers.');
  }

  const requireProcessRegistry = (methodName) => {
    if (!processRegistry || typeof processRegistry[methodName] !== 'function') {
      throw new Error(`processRegistry.${methodName} is required for runtime registry GraphQL operations.`);
    }
  };

  const requireHostPathMappings = (methodName) => {
    if (!hostPathMappings || typeof hostPathMappings[methodName] !== 'function') {
      throw new Error(`hostPathMappings.${methodName} is required for path mapping GraphQL operations.`);
    }
  };

  const requireProcessTemplates = (methodName) => {
    if (!processTemplates || typeof processTemplates[methodName] !== 'function') {
      throw new Error(`processTemplates.${methodName} is required for process template GraphQL operations.`);
    }
  };

  const requireRuntimeWait = (methodName) => {
    if (!runtimeWait || typeof runtimeWait[methodName] !== 'function') {
      throw new Error(`runtimeWait.${methodName} is required for runtime wait GraphQL operations.`);
    }
  };

  const activeAutomationTokenStore = automationTokenStore || {
    createAutomationToken,
    listAutomationTokens,
    revokeAutomationToken,
  };
  const activeLifecycleAccess = lifecycleAccess || {
    authorizeLifecycleAction,
  };
  const activeRuntimeAudit = runtimeAudit || {
    recordRuntimeAuditEvent: async () => null,
    listRuntimeAuditEvents: async () => [],
  };

  const authorizeGraphqlAction = (context, options) => (
    activeLifecycleAccess.authorizeLifecycleAction
      ? activeLifecycleAccess.authorizeLifecycleAction({
        user: context?.user || null,
        ...options,
      })
      : authorizeLifecycleAction({
        user: context?.user || null,
        ...options,
      })
  );

  const auditGraphqlEvent = async (context, payload) => {
    if (!activeRuntimeAudit || typeof activeRuntimeAudit.recordRuntimeAuditEvent !== 'function') {
      return null;
    }
    return activeRuntimeAudit.recordRuntimeAuditEvent({
      context: context || {},
      ...payload,
    });
  };

  const executeAuditedMutation = async (
    context,
    {
      action,
      scope,
      requiredScopes,
      target = {},
      input = {},
      execute,
      resolveAuditTarget = null,
    },
  ) => {
    let auditTarget = { ...target };
    try {
      authorizeGraphqlAction(context, {
        action,
        requiredScopes,
        target,
      });
      const result = await execute();
      if (typeof resolveAuditTarget === 'function') {
        auditTarget = {
          ...auditTarget,
          ...resolveAuditTarget(result),
        };
      }
      await auditGraphqlEvent(context, {
        action,
        scope,
        ...auditTarget,
        input,
        result,
        status: 'success',
      });
      return result;
    } catch (error) {
      await auditGraphqlEvent(context, {
        action,
        scope,
        ...auditTarget,
        input,
        result: {},
        status: 'error',
        errorMessage: error?.message || String(error),
      });
      throw error;
    }
  };

  const resolveDesiredProcessAuditTarget = (desiredProcess) => {
    const record = toPlainRecord(desiredProcess);
    return {
      hostId: record?.hostId,
      projectId: record?.projectId,
      desiredProcessId: record?.id,
      processKey: record?.processKey,
    };
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
    hosts: async (_, __, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:read',
        requiredScopes: ['hosts:read'],
      });
      const hosts = await listHosts();
      return hosts.map((host) => mapHostForGraphql(host)).filter(Boolean);
    },
    automationApiTokens: async (_, { includeRevoked } = {}, context) => {
      authorizeGraphqlAction(context, {
        action: 'tokens:read',
        requiredScopes: ['tokens:read'],
      });
      const tokens = await activeAutomationTokenStore.listAutomationTokens({ includeRevoked });
      return Array.isArray(tokens) ? tokens.map((entry) => mapAutomationTokenForGraphql(entry)).filter(Boolean) : [];
    },
    runtimeAuditEvents: async (_, args = {}, context) => {
      authorizeGraphqlAction(context, {
        action: 'audit:read',
        requiredScopes: ['audit:read'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
        },
      });
      const events = await activeRuntimeAudit.listRuntimeAuditEvents({
        limit: args.limit,
        action: args.action,
        hostId: args.hostId,
        projectId: args.projectId,
        actorType: args.actorType,
      });
      return Array.isArray(events) ? events.map((entry) => mapRuntimeAuditEventForGraphql(entry)).filter(Boolean) : [];
    },
    hostPathMappings: async (_, { hostId, agentUuid, includeDisabled }, context) => {
      authorizeGraphqlAction(context, {
        action: 'paths:read',
        requiredScopes: ['paths:read'],
        target: { hostId },
      });
      requireHostPathMappings('listHostPathMappings');
      const mappings = await hostPathMappings.listHostPathMappings({
        hostId,
        agentUuid,
        includeDisabled,
      });
      return Array.isArray(mappings)
        ? mappings.map((entry) => mapHostPathMappingForGraphql(entry)).filter(Boolean)
        : [];
    },
    resolveHostPath: async (_, {
      hostId,
      agentUuid,
      path: pathInput,
      allowUnapproved,
    }, context) => {
      authorizeGraphqlAction(context, {
        action: 'paths:read',
        requiredScopes: ['paths:read'],
        target: {
          hostId,
          path: pathInput,
        },
      });
      requireHostPathMappings('resolveHostPath');
      const resolvedPath = await hostPathMappings.resolveHostPath({
        hostId,
        agentUuid,
        path: pathInput,
        allowUnapproved,
      });
      return mapResolvedHostPathForGraphql(resolvedPath);
    },
    processTemplates: async (_, args, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:templates:read',
        requiredScopes: ['runtime:templates:read'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          path: args.projectPath || args.codexPath,
        },
      });
      requireProcessTemplates('listProcessTemplates');
      const templates = await processTemplates.listProcessTemplates({
        hostId: args.hostId,
        agentUuid: args.agentUuid,
        projectId: args.projectId,
        projectPath: args.projectPath,
        codexPath: args.codexPath,
        includeDisabled: args.includeDisabled,
        codexOnly: args.codexOnly !== false,
        allowUnapproved: args.allowUnapproved,
      });
      return Array.isArray(templates)
        ? templates.map((entry) => mapProcessTemplateForGraphql(entry)).filter(Boolean)
        : [];
    },
    resolveProcessTemplate: async (_, args, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:templates:read',
        requiredScopes: ['runtime:templates:read'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          path: args.projectPath || args.codexPath,
        },
      });
      requireProcessTemplates('resolveProcessTemplate');
      const resolved = await processTemplates.resolveProcessTemplate({
        hostId: args.hostId,
        agentUuid: args.agentUuid,
        projectId: args.projectId,
        projectPath: args.projectPath,
        codexPath: args.codexPath,
        templateKey: args.templateKey,
        packageKey: args.packageKey,
        packageRelativePath: args.packageRelativePath,
        processKey: args.processKey,
        allowUnapproved: args.allowUnapproved,
        codexOnly: args.codexOnly,
        env: args.env,
      });
      const payload = mapResolvedProcessTemplateForGraphql(resolved);
      if (!payload) {
        throw new Error('Unable to map resolved process template.');
      }
      return payload;
    },
    waitForRuntime: async (_, args, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read', 'logs:read'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          path: args.projectPath || args.codexPath,
        },
      });
      requireRuntimeWait('waitForRuntime');
      const result = await runtimeWait.waitForRuntime({
        hostId: args.hostId,
        agentUuid: args.agentUuid,
        projectId: args.projectId,
        projectPath: args.projectPath,
        codexPath: args.codexPath,
        runId: args.runId,
        processKey: args.processKey,
        packageKey: args.packageKey,
        templateKey: args.templateKey,
        status: args.status,
        expectedStatus: args.expectedStatus,
        expectedExitCode: args.expectedExitCode,
        timeoutMs: args.timeoutMs,
        intervalMs: args.intervalMs,
        healthChecksJson: args.healthChecksJson,
        url: args.url,
        method: args.method,
        bodyIncludes: args.bodyIncludes,
        port: args.port,
        tcpHost: args.tcpHost,
        pattern: args.pattern,
        graphqlEndpoint: args.graphqlEndpoint,
        query: args.query,
        variablesJson: args.variablesJson,
      });
      return mapRuntimeWaitResultForGraphql(result);
    },
    slaveRuntimeState: async (_, { hostId, agentUuid }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { hostId },
      });
      requireProcessRegistry('getSlaveRuntimeState');
      const runtimeState = await processRegistry.getSlaveRuntimeState({
        hostId,
        slaveId: agentUuid,
      });
      return mapSlaveRuntimeStateForGraphql(runtimeState);
    },
    desiredProcesses: async (_, { hostId, projectId, agentUuid }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { hostId, projectId },
      });
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
    observedProcessRuns: async (_, { hostId, agentUuid }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { hostId },
      });
      requireProcessRegistry('getSlaveRuntimeState');
      const runtimeState = await processRegistry.getSlaveRuntimeState({
        hostId,
        slaveId: agentUuid,
      });
      const runs = Array.isArray(runtimeState?.processRuns) ? runtimeState.processRuns : [];
      return runs.map((entry) => mapObservedProcessRunForGraphql(entry)).filter(Boolean);
    },
    terminalSession: async (_, { hostId }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:read',
        requiredScopes: ['hosts:read'],
        target: { hostId },
      });
      const session = await getTerminalSessionFn({ hostId });
      return mapTerminalSessionForGraphql(session);
    },
    discoveryConfig: (_, __, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:read',
        requiredScopes: ['hosts:read'],
      });
      return { ...discoveryConfig };
    },
    discoveredProjects: async (_, __, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:read',
        requiredScopes: ['hosts:read'],
      });
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
    projectRuntime: async (_, { projectPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { path: projectPath },
      });
      return runtimeBackend.getProjectRuntime(projectPath);
    },
    projectLogs: async (_, { projectPath, limit, afterId, serviceNames }, context) => {
      authorizeGraphqlAction(context, {
        action: 'logs:read',
        requiredScopes: ['logs:read'],
        target: { path: projectPath },
      });
      return runtimeBackend.getProjectLogs({ projectPath, limit, afterId, serviceNames });
    },
    hostLogs: async (_, { hostId, agentUuid, limit, afterId, serviceNames }, context) => {
      authorizeGraphqlAction(context, {
        action: 'logs:read',
        requiredScopes: ['logs:read'],
        target: { hostId },
      });
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
    projectLaunchEnvironment: async (_, { projectPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { path: projectPath },
      });
      return runtimeBackend.getProjectLaunchEnvironment(projectPath);
    },
    projectPortRangeSettings: async (_, { projectPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { path: projectPath },
      });
      const settings = await runtimeBackend.getProjectPortRangeSettings(projectPath);
      return {
        mode: toGraphqlPortRangeMode(settings?.mode),
        begin: Number.isInteger(Number(settings?.begin)) ? Number(settings.begin) : null,
      };
    },
    projectProcessStats: async (_, { projectPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:read',
        requiredScopes: ['runtime:read'],
        target: { path: projectPath },
      });
      return runtimeBackend.getProjectProcessStats(projectPath);
    },
  },
  Mutation: {
    updateDiscoveryConfig: async (_, args, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
      });
      const normalized = await validateAndNormalizeConfig(args || {});
      discoveryConfig.projectPath = normalized.projectPath;
      discoveryConfig.folderPattern = normalized.folderPattern;
      discoveryConfig.maxDepth = normalized.maxDepth;
      return { ...discoveryConfig };
    },
    addProject: async (_, { projectPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: { path: projectPath },
      });
      return addCustomProjectPath(projectPath);
    },
    addHost: async (_, { ip }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
      });
      const host = await addHostFn(ip);
      return mapHostForGraphql(host, {
        online: false,
        health: 'warning',
        status: 'unregistered',
        error: 'Slave not registered with master yet.',
      });
    },
    deleteHost: async (_, { hostId }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: { hostId },
      });
      return deleteHostFn(hostId);
    },
    addHostDirectory: async (_, { hostId, directoryPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: { hostId, path: directoryPath },
      });
      const host = await addHostDirectoryFn({ hostId, directoryPath });
      return mapHostForGraphql(host);
    },
    removeHostDirectory: async (_, { hostId, directoryPath }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: { hostId, path: directoryPath },
      });
      const host = await removeHostDirectoryFn({ hostId, directoryPath });
      return mapHostForGraphql(host);
    },
    upgradeHostAgent: async (_, { hostId }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: { hostId },
      });
      const host = await upgradeHostAgentFn({ hostId });
      return mapHostForGraphql(host);
    },
    createAutomationApiToken: async (_, args, context) => {
      const fullAccessRequested = Boolean(args.fullAccess) || String(args.accessMode || '').trim().toLowerCase() === 'full-access';
      authorizeGraphqlAction(context, {
        action: 'tokens:write',
        requiredScopes: fullAccessRequested ? ['tokens:write', 'admin:full-access'] : ['tokens:write'],
        target: {
          hostId: Array.isArray(args.allowedHostIds) && args.allowedHostIds.length === 1 ? args.allowedHostIds[0] : null,
          projectId: Array.isArray(args.allowedProjectIds) && args.allowedProjectIds.length === 1 ? args.allowedProjectIds[0] : null,
          paths: args.allowedPathPrefixes,
        },
      });
      let result = null;
      try {
        result = await activeAutomationTokenStore.createAutomationToken(args, context?.user || null);
        await auditGraphqlEvent(context, {
          action: 'tokens:create',
          scope: 'tokens:write',
          input: {
            ...args,
            token: undefined,
          },
          result: {
            record: result.record,
            warning: result.warning,
          },
          status: 'success',
        });
        return {
          token: result.token,
          record: mapAutomationTokenForGraphql(result.record),
          warning: result.warning || null,
        };
      } catch (error) {
        await auditGraphqlEvent(context, {
          action: 'tokens:create',
          scope: 'tokens:write',
          input: {
            ...args,
            token: undefined,
          },
          result: {},
          status: 'error',
          errorMessage: error?.message || String(error),
        });
        throw error;
      }
    },
    revokeAutomationApiToken: async (_, { id }, context) => {
      authorizeGraphqlAction(context, {
        action: 'tokens:write',
        requiredScopes: ['tokens:write'],
      });
      try {
        const result = await activeAutomationTokenStore.revokeAutomationToken({ id, actor: context?.user || null });
        await auditGraphqlEvent(context, {
          action: 'tokens:revoke',
          scope: 'tokens:write',
          input: { id },
          result: { revoked: Boolean(result) },
          status: 'success',
        });
        return Boolean(result);
      } catch (error) {
        await auditGraphqlEvent(context, {
          action: 'tokens:revoke',
          scope: 'tokens:write',
          input: { id },
          result: {},
          status: 'error',
          errorMessage: error?.message || String(error),
        });
        throw error;
      }
    },
    upsertHostPathMapping: async (_, args, context) => {
      requireHostPathMappings('upsertHostPathMapping');
      const mapping = await executeAuditedMutation(context, {
        action: 'paths:write',
        scope: 'paths:write',
        requiredScopes: ['paths:write'],
        target: {
          hostId: args.hostId,
          paths: [args.codexPathPrefix, args.hostPathPrefix],
        },
        input: args,
        execute: () => hostPathMappings.upsertHostPathMapping({
          id: args.id,
          hostId: args.hostId,
          agentUuid: args.agentUuid,
          logicalRoot: args.logicalRoot,
          codexPathPrefix: args.codexPathPrefix,
          hostPathPrefix: args.hostPathPrefix,
          description: args.description,
          enabled: args.enabled,
          allowUnapproved: args.allowUnapproved,
          createdBy: args.createdBy,
          updatedBy: args.updatedBy,
        }),
        resolveAuditTarget: (record) => ({
          hostId: toPlainRecord(record)?.hostId || args.hostId,
        }),
      });
      return mapHostPathMappingForGraphql(mapping);
    },
    deleteHostPathMapping: async (_, args, context) => {
      requireHostPathMappings('deleteHostPathMapping');
      return executeAuditedMutation(context, {
        action: 'paths:write',
        scope: 'paths:write',
        requiredScopes: ['paths:write'],
        target: {
          hostId: args.hostId,
        },
        input: args,
        execute: () => hostPathMappings.deleteHostPathMapping({
          id: args.id,
          hostId: args.hostId,
          agentUuid: args.agentUuid,
        }),
      });
    },
    upsertProcessTemplate: async (_, args, context) => {
      requireProcessTemplates('upsertProcessTemplate');
      const template = await executeAuditedMutation(context, {
        action: 'runtime:templates:write',
        scope: 'runtime:templates:write',
        requiredScopes: ['runtime:templates:write'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          paths: [args.cwdTemplate, args.logRoot],
        },
        input: args,
        execute: () => processTemplates.upsertProcessTemplate({
          id: args.id,
          hostId: args.hostId,
          projectId: args.projectId,
          templateKey: args.templateKey,
          displayName: args.displayName,
          description: args.description,
          packageKey: args.packageKey,
          packageRelativePath: args.packageRelativePath,
          processKeyTemplate: args.processKeyTemplate,
          cwdTemplate: args.cwdTemplate,
          desiredState: args.desiredState,
          launchMode: args.launchMode,
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
          restartPolicy: args.restartPolicy,
          healthChecksJson: parseJsonArgument(args.healthChecksJson, []),
          logRoot: args.logRoot,
          enabled: args.enabled,
          allowCodex: args.allowCodex,
          createdBy: args.createdBy,
          updatedBy: args.updatedBy,
        }),
        resolveAuditTarget: (record) => ({
          hostId: toPlainRecord(record)?.hostId || args.hostId,
          projectId: toPlainRecord(record)?.projectId || args.projectId,
          processKey: toPlainRecord(record)?.templateKey || args.templateKey,
        }),
      });
      return mapProcessTemplateForGraphql(template);
    },
    deleteProcessTemplate: async (_, args, context) => {
      requireProcessTemplates('deleteProcessTemplate');
      return executeAuditedMutation(context, {
        action: 'runtime:templates:write',
        scope: 'runtime:templates:write',
        requiredScopes: ['runtime:templates:write'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
        },
        input: args,
        execute: () => processTemplates.deleteProcessTemplate({
          id: args.id,
          hostId: args.hostId,
          projectId: args.projectId,
        }),
      });
    },
    ensureProcessFromTemplate: async (_, args, context) => {
      requireProcessTemplates('ensureProcessFromTemplate');
      const result = await executeAuditedMutation(context, {
        action: 'runtime:ensure',
        scope: 'runtime:ensure',
        requiredScopes: ['runtime:ensure'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          path: args.projectPath || args.codexPath || args.cwd,
          logRoot: args.logRoot,
          rawCommand: Boolean(args.command),
        },
        input: args,
        execute: () => processTemplates.ensureProcessFromTemplate({
          hostId: args.hostId,
          agentUuid: args.agentUuid,
          projectId: args.projectId,
          projectPath: args.projectPath,
          codexPath: args.codexPath,
          templateKey: args.templateKey,
          packageKey: args.packageKey,
          packageRelativePath: args.packageRelativePath,
          processKey: args.processKey,
          desiredState: args.desiredState,
          launchMode: args.launchMode,
          cwd: args.cwd,
          command: args.command,
          args: args.args,
          env: args.env,
          logRoot: args.logRoot,
          restartPolicy: args.restartPolicy,
          allowUnapproved: args.allowUnapproved,
          createdBy: args.createdBy,
          updatedBy: args.updatedBy,
        }),
        resolveAuditTarget: (payload) => resolveDesiredProcessAuditTarget(payload?.desiredProcess),
      });
      return mapDesiredProcessForGraphql(result?.desiredProcess);
    },
    ensureDesiredProcess: async (_, args, context) => {
      requireProcessRegistry('ensureDesiredProcess');
      const desiredProcess = await executeAuditedMutation(context, {
        action: 'runtime:ensure',
        scope: 'runtime:ensure',
        requiredScopes: ['runtime:ensure'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          path: args.projectPath || args.cwd,
          logRoot: args.logRoot,
          rawCommand: true,
        },
        input: args,
        execute: () => processRegistry.ensureDesiredProcess({
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
        }),
        resolveAuditTarget: resolveDesiredProcessAuditTarget,
      });
      return mapDesiredProcessForGraphql(desiredProcess);
    },
    deleteDesiredProcessDefinition: async (_, args, context) => {
      requireProcessRegistry('deleteDesiredProcessDefinition');
      return executeAuditedMutation(context, {
        action: 'runtime:delete',
        scope: 'runtime:delete',
        requiredScopes: ['runtime:delete'],
        target: {
          hostId: args.hostId,
          projectId: args.projectId,
          desiredProcessId: args.desiredProcessId,
          processKey: args.processKey || args.packageKey,
          path: args.projectPath,
        },
        input: args,
        execute: () => processRegistry.deleteDesiredProcessDefinition({
          desiredProcessId: args.desiredProcessId,
          hostId: args.hostId,
          slaveId: args.agentUuid,
          projectId: args.projectId,
          projectPath: args.projectPath,
          packageKey: args.packageKey,
          processKey: args.processKey,
        }),
      });
    },
    softKillProcess: async (_, args, context) => {
      requireProcessRegistry('queueProcessKill');
      const result = await executeAuditedMutation(context, {
        action: 'runtime:kill:soft',
        scope: 'runtime:kill:soft',
        requiredScopes: ['runtime:kill:soft'],
        target: {
          hostId: args.hostId,
          runId: args.runId,
          processKey: args.processKey,
        },
        input: args,
        execute: () => processRegistry.queueProcessKill({
          hostId: args.hostId,
          slaveId: args.agentUuid,
          runId: args.runId,
          processKey: args.processKey,
          pid: args.pid,
          hard: false,
          reason: args.reason,
        }),
      });
      return {
        commandId: result?.commandId ? String(result.commandId) : null,
        status: String(result?.status || 'queued').trim().toLowerCase() || 'queued',
        message: 'soft kill command queued',
      };
    },
    hardKillProcess: async (_, args, context) => {
      requireProcessRegistry('queueProcessKill');
      const result = await executeAuditedMutation(context, {
        action: 'runtime:kill:hard',
        scope: 'runtime:kill:hard',
        requiredScopes: ['runtime:kill:hard'],
        target: {
          hostId: args.hostId,
          runId: args.runId,
          processKey: args.processKey,
          hardKill: true,
        },
        input: args,
        execute: () => processRegistry.queueProcessKill({
          hostId: args.hostId,
          slaveId: args.agentUuid,
          runId: args.runId,
          processKey: args.processKey,
          pid: args.pid,
          hard: true,
          reason: args.reason,
        }),
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
    }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: {
          hostId,
          path: baseDirectory,
        },
      });
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
    startHostTerminalSession: async (_, { hostId }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
        target: { hostId },
      });
      const session = await startHostTerminalSessionFn({ hostId });
      const payload = mapTerminalSessionForGraphql(session);
      if (!payload) {
        throw new Error('Unable to map started terminal session.');
      }
      return payload;
    },
    sendHostTerminalInput: async (_, { sessionId, input }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
      });
      return sendHostTerminalInputFn({ sessionId, input });
    },
    closeHostTerminalSession: async (_, { sessionId }, context) => {
      authorizeGraphqlAction(context, {
        action: 'hosts:write',
        requiredScopes: ['hosts:write'],
      });
      return closeHostTerminalSessionFn({ sessionId });
    },
    toggleProjectRuntime: async (_, args, context) => executeAuditedMutation(context, {
      action: 'runtime:ensure',
      scope: 'runtime:ensure',
      requiredScopes: ['runtime:ensure'],
      target: {
        path: args.projectPath,
        rawCommand: true,
      },
      input: args,
      execute: () => runtimeBackend.toggleProjectRuntime({
        projectPath: args.projectPath,
        projectTypes: args.projectTypes,
      }),
    }),
    toggleServiceRuntime: async (_, args, context) => executeAuditedMutation(context, {
      action: 'runtime:ensure',
      scope: 'runtime:ensure',
      requiredScopes: ['runtime:ensure'],
      target: {
        path: args.projectPath,
        processKey: args.serviceKey,
        rawCommand: true,
      },
      input: args,
      execute: () => runtimeBackend.toggleServiceRuntime({
        projectPath: args.projectPath,
        serviceKey: args.serviceKey,
      }),
    }),
    setProjectPortRangeSettings: async (_, args, context) => {
      authorizeGraphqlAction(context, {
        action: 'runtime:ensure',
        requiredScopes: ['runtime:ensure'],
        target: { path: args.projectPath },
      });
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
