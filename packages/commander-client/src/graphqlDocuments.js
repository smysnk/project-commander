const HOST_FIELDS = `
  id
  agentUuid
  ip
  port
  name
  source
  online
  health
  status
  lastSeenAt
  error
  version
  protocolVersion
  directories
  projectCount
  projects {
    id
    name
    path
  }
`;

const DESIRED_PROCESS_FIELDS = `
  id
  hostId
  projectId
  serviceId
  slaveId
  hostName
  projectName
  serviceName
  processKey
  packageKey
  packageRelativePath
  projectPath
  desiredState
  launchMode
  cwd
  command
  args
  env {
    key
    value
  }
  envHash
  launchFingerprint
  logRoot
  restartPolicy
  updatedAt
`;

const OBSERVED_RUN_FIELDS = `
  id
  runId
  desiredProcessId
  hostId
  projectId
  serviceId
  slaveId
  bootId
  processKey
  packageKey
  projectPath
  pid
  pgid
  launchFingerprint
  command
  args
  cwd
  envHash
  status
  startedAt
  lastSeenAt
  exitedAt
  exitCode
  exitSignal
  logPath
  adopted
  reconciliationSource
  runtimeState {
    sampledAt
    cpuPercent
    memoryPercent
    rssBytes
    vmsBytes
    readBytes
    writeBytes
    readOps
    writeOps
    openFds
    threadCount
    status
  }
`;

const HOST_PATH_MAPPING_FIELDS = `
  id
  hostId
  agentUuid
  logicalRoot
  codexPathPrefix
  hostPathPrefix
  description
  enabled
  createdBy
  updatedBy
  createdAt
  updatedAt
`;

const RESOLVED_HOST_PATH_FIELDS = `
  inputPath
  codexPath
  hostPath
  source
  approved
  matchedRoot
  approvedRoots
  mapping {
    ${HOST_PATH_MAPPING_FIELDS}
  }
`;

const PROCESS_TEMPLATE_FIELDS = `
  id
  hostId
  projectId
  templateKey
  displayName
  description
  packageKey
  packageRelativePath
  processKeyTemplate
  cwdTemplate
  desiredState
  launchMode
  command
  args
  env {
    key
    value
  }
  restartPolicy
  healthChecksJson
  logRoot
  enabled
  allowCodex
  source
  scope
  createdBy
  updatedBy
  createdAt
  updatedAt
`;

const AUTOMATION_TOKEN_FIELDS = `
  id
  name
  accessMode
  scopes
  effectiveScopes
  allowedHostIds
  allowedProjectIds
  allowedPathPrefixes
  rawCommandAllowed
  fullAccess
  expiresAt
  lastUsedAt
  createdBy
  revokedAt
  createdAt
  updatedAt
`;

const RUNTIME_AUDIT_EVENT_FIELDS = `
  id
  requestId
  actorType
  actorId
  actorName
  toolName
  scope
  hostId
  projectId
  desiredProcessId
  runId
  processKey
  action
  inputJson
  resultJson
  status
  errorMessage
  createdAt
`;

const RESOLVED_PROCESS_TEMPLATE_FIELDS = `
  template {
    ${PROCESS_TEMPLATE_FIELDS}
  }
  hostId
  agentUuid
  projectId
  projectPath
  processKey
  packageKey
  packageRelativePath
  desiredState
  launchMode
  cwd
  command
  args
  env {
    key
    value
  }
  logRoot
  restartPolicy
  healthChecksJson
`;

const RUNTIME_WAIT_RESULT_FIELDS = `
  status
  matchedCheck
  failedCheck
  elapsedMs
  observedRun {
    ${OBSERVED_RUN_FIELDS}
  }
  lastLogLines
  httpStatus
  message
`;

const QUERY_HOSTS = `
  query CommanderClientHosts {
    hosts {
      ${HOST_FIELDS}
    }
  }
`;

const QUERY_AUTOMATION_TOKENS = `
  query CommanderClientAutomationTokens($includeRevoked: Boolean) {
    automationApiTokens(includeRevoked: $includeRevoked) {
      ${AUTOMATION_TOKEN_FIELDS}
    }
  }
`;

const QUERY_RUNTIME_AUDIT_EVENTS = `
  query CommanderClientRuntimeAuditEvents(
    $limit: Int
    $action: String
    $hostId: Int
    $projectId: Int
    $actorType: String
  ) {
    runtimeAuditEvents(
      limit: $limit
      action: $action
      hostId: $hostId
      projectId: $projectId
      actorType: $actorType
    ) {
      ${RUNTIME_AUDIT_EVENT_FIELDS}
    }
  }
`;

const QUERY_PROJECTS = `
  query CommanderClientProjects {
    hosts {
      ${HOST_FIELDS}
    }
    discoveredProjects {
      scannedAt
      projects {
        name
        path
        relativePath
        hostId
        hostName
        services
        types
        hasMakefile
        runtimeStatus
        runtimePid
        runtimePorts
      }
    }
  }
`;

const QUERY_DESIRED_PROCESSES = `
  query CommanderClientDesiredProcesses($hostId: Int, $projectId: Int, $agentUuid: String) {
    desiredProcesses(hostId: $hostId, projectId: $projectId, agentUuid: $agentUuid) {
      ${DESIRED_PROCESS_FIELDS}
    }
  }
`;

const QUERY_OBSERVED_RUNS = `
  query CommanderClientObservedRuns($hostId: Int, $agentUuid: String) {
    observedProcessRuns(hostId: $hostId, agentUuid: $agentUuid) {
      ${OBSERVED_RUN_FIELDS}
    }
  }
`;

const QUERY_WAIT_FOR_RUNTIME = `
  query CommanderClientWaitForRuntime(
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $projectPath: String
    $codexPath: String
    $runId: String
    $processKey: String
    $packageKey: String
    $templateKey: String
    $status: String
    $expectedStatus: String
    $expectedExitCode: Int
    $timeoutMs: Int
    $intervalMs: Int
    $healthChecksJson: String
    $url: String
    $method: String
    $bodyIncludes: String
    $port: Int
    $tcpHost: String
    $pattern: String
    $graphqlEndpoint: String
    $graphqlQuery: String
    $variablesJson: String
  ) {
    waitForRuntime(
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      projectPath: $projectPath
      codexPath: $codexPath
      runId: $runId
      processKey: $processKey
      packageKey: $packageKey
      templateKey: $templateKey
      status: $status
      expectedStatus: $expectedStatus
      expectedExitCode: $expectedExitCode
      timeoutMs: $timeoutMs
      intervalMs: $intervalMs
      healthChecksJson: $healthChecksJson
      url: $url
      method: $method
      bodyIncludes: $bodyIncludes
      port: $port
      tcpHost: $tcpHost
      pattern: $pattern
      graphqlEndpoint: $graphqlEndpoint
      query: $graphqlQuery
      variablesJson: $variablesJson
    ) {
      ${RUNTIME_WAIT_RESULT_FIELDS}
    }
  }
`;

const QUERY_HOST_LOGS = `
  query CommanderClientHostLogs($hostId: Int, $agentUuid: String, $limit: Int, $afterId: Int, $serviceNames: [String!]) {
    hostLogs(hostId: $hostId, agentUuid: $agentUuid, limit: $limit, afterId: $afterId, serviceNames: $serviceNames) {
      id
      projectPath
      timestamp
      serviceName
      stream
      message
    }
  }
`;

const QUERY_HOST_PATH_MAPPINGS = `
  query CommanderClientHostPathMappings($hostId: Int, $agentUuid: String, $includeDisabled: Boolean) {
    hostPathMappings(hostId: $hostId, agentUuid: $agentUuid, includeDisabled: $includeDisabled) {
      ${HOST_PATH_MAPPING_FIELDS}
    }
  }
`;

const QUERY_RESOLVE_HOST_PATH = `
  query CommanderClientResolveHostPath($hostId: Int, $agentUuid: String, $path: String!, $allowUnapproved: Boolean) {
    resolveHostPath(hostId: $hostId, agentUuid: $agentUuid, path: $path, allowUnapproved: $allowUnapproved) {
      ${RESOLVED_HOST_PATH_FIELDS}
    }
  }
`;

const QUERY_PROCESS_TEMPLATES = `
  query CommanderClientProcessTemplates(
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $projectPath: String
    $codexPath: String
    $includeDisabled: Boolean
    $codexOnly: Boolean
    $allowUnapproved: Boolean
  ) {
    processTemplates(
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      projectPath: $projectPath
      codexPath: $codexPath
      includeDisabled: $includeDisabled
      codexOnly: $codexOnly
      allowUnapproved: $allowUnapproved
    ) {
      ${PROCESS_TEMPLATE_FIELDS}
    }
  }
`;

const QUERY_RESOLVE_PROCESS_TEMPLATE = `
  query CommanderClientResolveProcessTemplate(
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $projectPath: String
    $codexPath: String
    $templateKey: String!
    $packageKey: String
    $packageRelativePath: String
    $processKey: String
    $allowUnapproved: Boolean
    $codexOnly: Boolean
    $env: [RuntimeEnvEntryInput!]
  ) {
    resolveProcessTemplate(
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      projectPath: $projectPath
      codexPath: $codexPath
      templateKey: $templateKey
      packageKey: $packageKey
      packageRelativePath: $packageRelativePath
      processKey: $processKey
      allowUnapproved: $allowUnapproved
      codexOnly: $codexOnly
      env: $env
    ) {
      ${RESOLVED_PROCESS_TEMPLATE_FIELDS}
    }
  }
`;

const MUTATION_ENSURE_DESIRED_PROCESS = `
  mutation CommanderClientEnsureDesiredProcess(
    $desiredProcessId: Int
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $projectPath: String
    $serviceId: Int
    $processKey: String
    $packageKey: String
    $packageRelativePath: String
    $desiredState: String
    $launchMode: String!
    $cwd: String!
    $command: String!
    $args: [String!]
    $env: [RuntimeEnvEntryInput!]
    $logRoot: String
    $restartPolicy: String
    $createdBy: String
    $updatedBy: String
  ) {
    ensureDesiredProcess(
      desiredProcessId: $desiredProcessId
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      projectPath: $projectPath
      serviceId: $serviceId
      processKey: $processKey
      packageKey: $packageKey
      packageRelativePath: $packageRelativePath
      desiredState: $desiredState
      launchMode: $launchMode
      cwd: $cwd
      command: $command
      args: $args
      env: $env
      logRoot: $logRoot
      restartPolicy: $restartPolicy
      createdBy: $createdBy
      updatedBy: $updatedBy
    ) {
      ${DESIRED_PROCESS_FIELDS}
    }
  }
`;

const MUTATION_ENSURE_PROCESS_FROM_TEMPLATE = `
  mutation CommanderClientEnsureProcessFromTemplate(
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $projectPath: String
    $codexPath: String
    $templateKey: String!
    $packageKey: String
    $packageRelativePath: String
    $processKey: String
    $desiredState: String
    $launchMode: String
    $cwd: String
    $command: String
    $args: [String!]
    $env: [RuntimeEnvEntryInput!]
    $logRoot: String
    $restartPolicy: String
    $allowUnapproved: Boolean
    $createdBy: String
    $updatedBy: String
  ) {
    ensureProcessFromTemplate(
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      projectPath: $projectPath
      codexPath: $codexPath
      templateKey: $templateKey
      packageKey: $packageKey
      packageRelativePath: $packageRelativePath
      processKey: $processKey
      desiredState: $desiredState
      launchMode: $launchMode
      cwd: $cwd
      command: $command
      args: $args
      env: $env
      logRoot: $logRoot
      restartPolicy: $restartPolicy
      allowUnapproved: $allowUnapproved
      createdBy: $createdBy
      updatedBy: $updatedBy
    ) {
      ${DESIRED_PROCESS_FIELDS}
    }
  }
`;

const MUTATION_DELETE_DESIRED_PROCESS = `
  mutation CommanderClientDeleteDesiredProcess(
    $desiredProcessId: Int
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $projectPath: String
    $packageKey: String
    $processKey: String
  ) {
    deleteDesiredProcessDefinition(
      desiredProcessId: $desiredProcessId
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      projectPath: $projectPath
      packageKey: $packageKey
      processKey: $processKey
    )
  }
`;

const MUTATION_SOFT_KILL_PROCESS = `
  mutation CommanderClientSoftKillProcess(
    $hostId: Int
    $agentUuid: String
    $runId: String
    $processKey: String
    $pid: Int
    $reason: String
  ) {
    softKillProcess(
      hostId: $hostId
      agentUuid: $agentUuid
      runId: $runId
      processKey: $processKey
      pid: $pid
      reason: $reason
    ) {
      commandId
      status
      message
    }
  }
`;

const MUTATION_HARD_KILL_PROCESS = `
  mutation CommanderClientHardKillProcess(
    $hostId: Int
    $agentUuid: String
    $runId: String
    $processKey: String
    $pid: Int
    $reason: String
  ) {
    hardKillProcess(
      hostId: $hostId
      agentUuid: $agentUuid
      runId: $runId
      processKey: $processKey
      pid: $pid
      reason: $reason
    ) {
      commandId
      status
      message
    }
  }
`;

const MUTATION_UPSERT_HOST_PATH_MAPPING = `
  mutation CommanderClientUpsertHostPathMapping(
    $id: Int
    $hostId: Int
    $agentUuid: String
    $logicalRoot: String
    $codexPathPrefix: String!
    $hostPathPrefix: String!
    $description: String
    $enabled: Boolean
    $allowUnapproved: Boolean
    $createdBy: String
    $updatedBy: String
  ) {
    upsertHostPathMapping(
      id: $id
      hostId: $hostId
      agentUuid: $agentUuid
      logicalRoot: $logicalRoot
      codexPathPrefix: $codexPathPrefix
      hostPathPrefix: $hostPathPrefix
      description: $description
      enabled: $enabled
      allowUnapproved: $allowUnapproved
      createdBy: $createdBy
      updatedBy: $updatedBy
    ) {
      ${HOST_PATH_MAPPING_FIELDS}
    }
  }
`;

const MUTATION_DELETE_HOST_PATH_MAPPING = `
  mutation CommanderClientDeleteHostPathMapping($id: Int!, $hostId: Int, $agentUuid: String) {
    deleteHostPathMapping(id: $id, hostId: $hostId, agentUuid: $agentUuid)
  }
`;

const MUTATION_UPSERT_PROCESS_TEMPLATE = `
  mutation CommanderClientUpsertProcessTemplate(
    $id: Int
    $hostId: Int
    $projectId: Int
    $templateKey: String!
    $displayName: String
    $description: String
    $packageKey: String
    $packageRelativePath: String
    $processKeyTemplate: String
    $cwdTemplate: String
    $desiredState: String
    $launchMode: String
    $command: String!
    $args: [String!]
    $env: [RuntimeEnvEntryInput!]
    $restartPolicy: String
    $healthChecksJson: String
    $logRoot: String
    $enabled: Boolean
    $allowCodex: Boolean
    $createdBy: String
    $updatedBy: String
  ) {
    upsertProcessTemplate(
      id: $id
      hostId: $hostId
      projectId: $projectId
      templateKey: $templateKey
      displayName: $displayName
      description: $description
      packageKey: $packageKey
      packageRelativePath: $packageRelativePath
      processKeyTemplate: $processKeyTemplate
      cwdTemplate: $cwdTemplate
      desiredState: $desiredState
      launchMode: $launchMode
      command: $command
      args: $args
      env: $env
      restartPolicy: $restartPolicy
      healthChecksJson: $healthChecksJson
      logRoot: $logRoot
      enabled: $enabled
      allowCodex: $allowCodex
      createdBy: $createdBy
      updatedBy: $updatedBy
    ) {
      ${PROCESS_TEMPLATE_FIELDS}
    }
  }
`;

const MUTATION_DELETE_PROCESS_TEMPLATE = `
  mutation CommanderClientDeleteProcessTemplate($id: Int!, $hostId: Int, $projectId: Int) {
    deleteProcessTemplate(id: $id, hostId: $hostId, projectId: $projectId)
  }
`;

const MUTATION_CREATE_AUTOMATION_TOKEN = `
  mutation CommanderClientCreateAutomationToken(
    $name: String!
    $accessMode: String!
    $scopes: [String!]
    $allowedHostIds: [Int!]
    $allowedProjectIds: [Int!]
    $allowedPathPrefixes: [String!]
    $rawCommandAllowed: Boolean
    $fullAccess: Boolean
    $expiresAt: String
  ) {
    createAutomationApiToken(
      name: $name
      accessMode: $accessMode
      scopes: $scopes
      allowedHostIds: $allowedHostIds
      allowedProjectIds: $allowedProjectIds
      allowedPathPrefixes: $allowedPathPrefixes
      rawCommandAllowed: $rawCommandAllowed
      fullAccess: $fullAccess
      expiresAt: $expiresAt
    ) {
      token
      warning
      record {
        ${AUTOMATION_TOKEN_FIELDS}
      }
    }
  }
`;

const MUTATION_REVOKE_AUTOMATION_TOKEN = `
  mutation CommanderClientRevokeAutomationToken($id: Int!) {
    revokeAutomationApiToken(id: $id)
  }
`;

module.exports = {
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
};
