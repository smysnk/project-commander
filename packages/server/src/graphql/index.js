const {
  toggleProjectRuntime,
  toggleServiceRuntime,
  getProjectRuntime,
  getProjectLogs,
  getProjectLaunchEnvironment,
  getProjectPortRangeSettings,
  setProjectPortRangeSettings,
  getProjectProcessStats,
} = require('../runtimeManager');

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
    discoveryConfig: DiscoveryConfig!
    discoveredProjects: ProjectDiscoveryResult!
    projectRuntime(projectPath: String!): ProjectRuntime!
    projectLogs(projectPath: String!, limit: Int, afterId: Int, serviceNames: [String!]): [ProjectLogEntry!]!
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

const createResolvers = ({ discoveryConfig, validateAndNormalizeConfig, discoverProjects }) => ({
  Query: {
    hello: () => 'Hello from Project Discovery GraphQL server',
    runtimeConfig: () => ({
      appUrl: process.env.APP_URL || `http://localhost:${process.env.WEB_PORT || '3000'}`,
      graphqlEndpoint: '/graphql',
      wsEndpoint: process.env.WS_URL || `ws://localhost:${process.env.SERVER_PORT || '4000'}/ws`,
    }),
    discoveryConfig: () => ({ ...discoveryConfig }),
    discoveredProjects: async () => {
      const discovered = await discoverProjects(discoveryConfig);
      const runtimes = await Promise.all(
        discovered.projects.map((project) => getProjectRuntime(project.path)),
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
    projectRuntime: async (_, { projectPath }) => getProjectRuntime(projectPath),
    projectLogs: async (_, { projectPath, limit, afterId, serviceNames }) =>
      getProjectLogs({ projectPath, limit, afterId, serviceNames }),
    projectLaunchEnvironment: async (_, { projectPath }) =>
      getProjectLaunchEnvironment(projectPath),
    projectPortRangeSettings: async (_, { projectPath }) => {
      const settings = await getProjectPortRangeSettings(projectPath);
      return {
        mode: toGraphqlPortRangeMode(settings?.mode),
        begin: Number.isInteger(Number(settings?.begin)) ? Number(settings.begin) : null,
      };
    },
    projectProcessStats: async (_, { projectPath }) =>
      getProjectProcessStats(projectPath),
  },
  Mutation: {
    updateDiscoveryConfig: async (_, args) => {
      const normalized = await validateAndNormalizeConfig(args || {});
      discoveryConfig.projectPath = normalized.projectPath;
      discoveryConfig.folderPattern = normalized.folderPattern;
      discoveryConfig.maxDepth = normalized.maxDepth;
      return { ...discoveryConfig };
    },
    toggleProjectRuntime: async (_, args) =>
      toggleProjectRuntime({
        projectPath: args.projectPath,
        projectTypes: args.projectTypes,
      }),
    toggleServiceRuntime: async (_, args) =>
      toggleServiceRuntime({
        projectPath: args.projectPath,
        serviceKey: args.serviceKey,
      }),
    setProjectPortRangeSettings: async (_, args) => {
      const settings = await setProjectPortRangeSettings({
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

module.exports = {
  typeDefs,
  createResolvers,
};
