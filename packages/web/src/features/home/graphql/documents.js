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
  mutation DeleteHost($hostId: Int!) {
    deleteHost(hostId: $hostId)
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
