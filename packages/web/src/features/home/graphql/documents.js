export const QUERY_RUNTIME_CONFIG = `
  query RuntimeConfig {
    runtimeConfig {
      appUrl
      graphqlEndpoint
      wsEndpoint
      runtimeBackend
      version
      protocolVersion
      slaveTargetVersion
    }
    runtimeBackendInfo {
      name
      displayName
      masterAgent {
        socketPath
        target
        slaveControlTarget
        slaveControlPort
        service
        status
        connectionStatus
        connectionHealth
        lastConnectedAt
        lastAttemptAt
        reconnectAttempts
        version
        protocolVersion
        startedAt
        capabilities
        grantedCapabilities
        error
      }
    }
  }
`;

export const QUERY_HOSTS = `
  query Hosts {
    hosts {
      id
      agentUuid
      ip
      port
      targetSocket
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
      runtimeEnv {
        key
        value
      }
      projectCount
      projects {
        id
        name
        path
      }
    }
  }
`;

export const QUERY_RUNTIME_BACKEND_INFO = `
  query RuntimeBackendInfo {
    runtimeBackendInfo {
      name
      displayName
      masterAgent {
        socketPath
        target
        slaveControlTarget
        slaveControlPort
        service
        status
        connectionStatus
        connectionHealth
        lastConnectedAt
        lastAttemptAt
        reconnectAttempts
        version
        protocolVersion
        startedAt
        capabilities
        grantedCapabilities
        error
      }
    }
  }
`;

export const QUERY_DISCOVERY_DASHBOARD = `
  query DiscoveryDashboard {
    discoveryConfig {
      projectPath
      folderPattern
      maxDepth
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
        declaredServices {
          name
          path
          relativePath
          language
          hasPackageJson
          hasMakefile
          packageScripts {
            name
            command
          }
          makeTargets
          envVarNames
          envFiles {
            file
            entries {
              key
              value
            }
          }
          effectiveEnvVarMap {
            key
            value
          }
        }
        runtimeStatus
        runtimePid
        runtimePorts
        runtimePortRangeBegin
        runtimePortRangeEnd
        runtimeServicePorts {
          main
          graphql
          api
          admin
        }
        runtimeServicePids {
          main
          graphql
          api
          admin
        }
        runtimeServiceStates {
          main
          graphql
          api
          admin
        }
        runtimeServiceEntries {
          key
          serviceName
          pid
          port
          state
        }
        runtimeLastExitCode
      }
    }
  }
`;

export const QUERY_PROJECT_LOGS = `
  query ProjectLogs($projectPath: String!, $limit: Int, $afterId: Int, $serviceNames: [String!]) {
    projectLogs(projectPath: $projectPath, limit: $limit, afterId: $afterId, serviceNames: $serviceNames) {
      id
      timestamp
      serviceName
      stream
      message
    }
  }
`;

export const QUERY_HOST_LOGS = `
  query HostLogs($hostId: Int, $agentUuid: String, $limit: Int, $afterId: Int, $serviceNames: [String!]) {
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

export const QUERY_HOST_PATH_MAPPINGS = `
  query HostPathMappings($hostId: Int, $agentUuid: String, $includeDisabled: Boolean) {
    hostPathMappings(hostId: $hostId, agentUuid: $agentUuid, includeDisabled: $includeDisabled) {
      id
      hostId
      agentUuid
      logicalRoot
      codexPathPrefix
      hostPathPrefix
      description
      enabled
      updatedAt
    }
  }
`;

export const QUERY_PROJECT_ENVIRONMENT = `
  query ProjectLaunchEnvironment($projectPath: String!) {
    projectLaunchEnvironment(projectPath: $projectPath) {
      key
      value
    }
  }
`;

export const QUERY_PROJECT_PORT_RANGE_SETTINGS = `
  query ProjectPortRangeSettings($projectPath: String!) {
    projectPortRangeSettings(projectPath: $projectPath) {
      mode
      begin
    }
  }
`;

export const QUERY_PROJECT_PROCESS_STATS = `
  query ProjectProcessStats($projectPath: String!) {
    projectProcessStats(projectPath: $projectPath) {
      serviceId
      serviceName
      serviceKey
      pid
      cpuPercent
      memoryPercent
      rssMb
      virtualMb
      elapsed
      command
      status
    }
  }
`;

export const QUERY_TERMINAL_SESSION = `
  query TerminalSession($hostId: Int!) {
    terminalSession(hostId: $hostId) {
      sessionId
      hostId
      hostName
      hostIp
      status
      startedAt
      closedAt
      exitCode
      output {
        timestamp
        stream
        text
      }
    }
  }
`;

export const QUERY_SLAVE_RUNTIME_STATE = `
  query SlaveRuntimeState($hostId: Int, $agentUuid: String) {
    slaveRuntimeState(hostId: $hostId, agentUuid: $agentUuid) {
      host {
        id
        agentUuid
        ip
        port
        targetSocket
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
      runtimeEnv {
        key
        value
      }
      projectCount
        projects {
          id
          name
          path
        }
      }
      desiredProcesses {
        id
        hostId
        projectId
        deploymentId
        deploymentKey
        deploymentName
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
      }
      observedRuns {
        id
        runId
        desiredProcessId
        hostId
        projectId
        deploymentId
        deploymentKey
        deploymentName
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
      }
      hostRuntimeState {
        sampledAt
        cpuPercent
        load1m
        load5m
        load15m
        memoryTotalBytes
        memoryUsedBytes
        memoryAvailableBytes
        diskTotalBytes
        diskUsedBytes
        diskAvailableBytes
        diskMount
      }
    }
  }
`;

export const QUERY_SLAVE_RUNTIME_TELEMETRY = `
  query SlaveRuntimeTelemetry($hostId: Int, $agentUuid: String) {
    slaveRuntimeState(hostId: $hostId, agentUuid: $agentUuid) {
      host {
        id
        agentUuid
        ip
        name
        online
        health
        status
        lastSeenAt
        error
        version
        protocolVersion
      }
      observedRuns {
        id
        runId
        desiredProcessId
        hostId
        projectId
        deploymentId
        deploymentKey
        deploymentName
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
      }
      hostRuntimeState {
        sampledAt
        cpuPercent
        load1m
        load5m
        load15m
        memoryTotalBytes
        memoryUsedBytes
        memoryAvailableBytes
        diskTotalBytes
        diskUsedBytes
        diskAvailableBytes
        diskMount
      }
    }
  }
`;

export const QUERY_DEPLOYMENT_INSTANCES = `
  query DeploymentInstances($hostId: Int, $projectId: Int) {
    deploymentInstances(hostId: $hostId, projectId: $projectId) {
      id
      hostId
      projectId
      deploymentKey
      displayName
      deploymentPath
      env {
        key
        value
      }
      logRoot
      createdAt
      updatedAt
    }
  }
`;

export const QUERY_HOST_RUNTIME_ENV = `
  query HostRuntimeEnv($hostId: Int, $agentUuid: String) {
    hostRuntimeEnv(hostId: $hostId, agentUuid: $agentUuid) {
      env {
        key
        value
      }
    }
  }
`;

export const QUERY_DESIRED_PROCESSES = `
  query DesiredProcesses($hostId: Int, $projectId: Int, $deploymentId: Int, $deploymentKey: String, $agentUuid: String) {
    desiredProcesses(hostId: $hostId, projectId: $projectId, deploymentId: $deploymentId, deploymentKey: $deploymentKey, agentUuid: $agentUuid) {
      id
      hostId
      projectId
      deploymentId
      deploymentKey
      deploymentName
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
    }
  }
`;

export const QUERY_OBSERVED_PROCESS_RUNS = `
  query ObservedProcessRuns($hostId: Int, $deploymentId: Int, $deploymentKey: String, $agentUuid: String) {
    observedProcessRuns(hostId: $hostId, deploymentId: $deploymentId, deploymentKey: $deploymentKey, agentUuid: $agentUuid) {
      id
      runId
      desiredProcessId
      hostId
      projectId
      deploymentId
      deploymentKey
      deploymentName
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
    }
  }
`;

export const MUTATION_TOGGLE_PROJECT_RUNTIME = `
  mutation ToggleProjectRuntime($projectPath: String!, $projectTypes: [String!]) {
    toggleProjectRuntime(projectPath: $projectPath, projectTypes: $projectTypes) {
      projectPath
      status
      pid
      startedAt
      stoppedAt
      lastExitCode
    }
  }
`;

export const MUTATION_TOGGLE_SERVICE_RUNTIME = `
  mutation ToggleServiceRuntime($projectPath: String!, $serviceKey: String!) {
    toggleServiceRuntime(projectPath: $projectPath, serviceKey: $serviceKey) {
      projectPath
      status
      pid
      servicePids {
        main
        graphql
        api
        admin
      }
      serviceStates {
        main
        graphql
        api
        admin
      }
    }
  }
`;

export const MUTATION_RESTART_SERVICE_RUNTIME = `
  mutation RestartServiceRuntime($projectPath: String!, $serviceKey: String!) {
    restartServiceRuntime(projectPath: $projectPath, serviceKey: $serviceKey) {
      projectPath
      status
      pid
      servicePids {
        main
        graphql
        api
        admin
      }
      serviceStates {
        main
        graphql
        api
        admin
      }
    }
  }
`;

export const MUTATION_SET_PROJECT_PORT_RANGE_SETTINGS = `
  mutation SetProjectPortRangeSettings($projectPath: String!, $mode: PortRangeMode!, $begin: Int) {
    setProjectPortRangeSettings(projectPath: $projectPath, mode: $mode, begin: $begin) {
      mode
      begin
    }
  }
`;

export const MUTATION_ADD_PROJECT = `
  mutation AddProject($projectPath: String!) {
    addProject(projectPath: $projectPath) {
      projectPath
      added
    }
  }
`;

export const MUTATION_ADD_HOST = `
  mutation AddHost($ip: String!) {
    addHost(ip: $ip) {
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
    }
  }
`;

export const MUTATION_DELETE_HOST = `
  mutation DeleteHost($hostId: Int!, $removeDirectoryContents: Boolean) {
    deleteHost(hostId: $hostId, removeDirectoryContents: $removeDirectoryContents)
  }
`;

export const MUTATION_UPGRADE_HOST_AGENT = `
  mutation UpgradeHostAgent($hostId: Int!) {
    upgradeHostAgent(hostId: $hostId) {
      id
      version
      protocolVersion
      status
      online
      health
      error
      lastSeenAt
    }
  }
`;

export const MUTATION_ADD_HOST_DIRECTORY = `
  mutation AddHostDirectory($hostId: Int!, $directoryPath: String!) {
    addHostDirectory(hostId: $hostId, directoryPath: $directoryPath) {
      id
      directories
    }
  }
`;

export const MUTATION_REMOVE_HOST_DIRECTORY = `
  mutation RemoveHostDirectory($hostId: Int!, $directoryPath: String!) {
    removeHostDirectory(hostId: $hostId, directoryPath: $directoryPath) {
      id
      directories
    }
  }
`;

export const MUTATION_CHECKOUT_HOST_PROJECT = `
  mutation CheckoutHostProject(
    $hostId: Int!
    $repositoryUrl: String!
    $baseDirectory: String!
    $destinationFolder: String!
  ) {
    checkoutHostProject(
      hostId: $hostId
      repositoryUrl: $repositoryUrl
      baseDirectory: $baseDirectory
      destinationFolder: $destinationFolder
    ) {
      commandId
      status
      message
      host {
        id
        name
        ip
        status
        online
        health
        lastSeenAt
      }
    }
  }
`;

export const MUTATION_START_HOST_TERMINAL_SESSION = `
  mutation StartHostTerminalSession($hostId: Int!) {
    startHostTerminalSession(hostId: $hostId) {
      sessionId
      hostId
      hostName
      hostIp
      status
      startedAt
      closedAt
      exitCode
      output {
        timestamp
        stream
        text
      }
    }
  }
`;

export const MUTATION_SEND_HOST_TERMINAL_INPUT = `
  mutation SendHostTerminalInput($sessionId: String!, $input: String!) {
    sendHostTerminalInput(sessionId: $sessionId, input: $input)
  }
`;

export const MUTATION_ENSURE_DESIRED_PROCESS = `
  mutation EnsureDesiredProcess(
    $desiredProcessId: Int
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $deploymentId: Int
    $deploymentKey: String
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
      deploymentId: $deploymentId
      deploymentKey: $deploymentKey
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
      id
      hostId
      projectId
      deploymentId
      deploymentKey
      deploymentName
      processKey
      packageKey
      projectPath
      desiredState
      launchMode
      cwd
      command
      args
      restartPolicy
      updatedAt
    }
  }
`;

export const MUTATION_ENSURE_DEPLOYMENT_INSTANCE = `
  mutation EnsureDeploymentInstance(
    $hostId: Int!
    $projectId: Int
    $projectPath: String
    $deploymentKey: String!
    $displayName: String
    $deploymentPath: String
    $env: [RuntimeEnvEntryInput!]
    $logRoot: String
  ) {
    ensureDeploymentInstance(
      hostId: $hostId
      projectId: $projectId
      projectPath: $projectPath
      deploymentKey: $deploymentKey
      displayName: $displayName
      deploymentPath: $deploymentPath
      env: $env
      logRoot: $logRoot
      createdBy: "runtime-panel"
      updatedBy: "runtime-panel"
    ) {
      id
      hostId
      projectId
      deploymentKey
      displayName
      deploymentPath
      env {
        key
        value
      }
      logRoot
      updatedAt
    }
  }
`;

export const MUTATION_DELETE_DEPLOYMENT_INSTANCE = `
  mutation DeleteDeploymentInstance($deploymentId: Int!, $deleteDesiredProcesses: Boolean) {
    deleteDeploymentInstance(deploymentId: $deploymentId, deleteDesiredProcesses: $deleteDesiredProcesses)
  }
`;

export const MUTATION_SET_HOST_RUNTIME_ENV = `
  mutation SetHostRuntimeEnv($hostId: Int!, $env: [RuntimeEnvEntryInput!]!) {
    setHostRuntimeEnv(hostId: $hostId, env: $env) {
      env {
        key
        value
      }
    }
  }
`;

export const MUTATION_DELETE_DESIRED_PROCESS = `
  mutation DeleteDesiredProcessDefinition(
    $desiredProcessId: Int
    $hostId: Int
    $agentUuid: String
    $projectId: Int
    $deploymentId: Int
    $deploymentKey: String
    $projectPath: String
    $packageKey: String
    $processKey: String
  ) {
    deleteDesiredProcessDefinition(
      desiredProcessId: $desiredProcessId
      hostId: $hostId
      agentUuid: $agentUuid
      projectId: $projectId
      deploymentId: $deploymentId
      deploymentKey: $deploymentKey
      projectPath: $projectPath
      packageKey: $packageKey
      processKey: $processKey
    )
  }
`;

export const MUTATION_SOFT_KILL_PROCESS = `
  mutation SoftKillProcess(
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

export const MUTATION_HARD_KILL_PROCESS = `
  mutation HardKillProcess(
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
