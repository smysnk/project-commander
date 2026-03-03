const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { sequelize } = require('./db');
const { runMigrations } = require('./migrate');
const { initModelAssociations } = require('./models');
const { syncDiscoveredProjects } = require('./projectCatalog');
const {
  scanProjects,
  parseMaxDepth,
  buildFolderPattern,
  isDirectory,
} = require('./discovery');
const { setRuntimeEventSink, startPidMonitor } = require('./runtimeManager');
const { typeDefs, createResolvers } = require('./graphql');

require('./env');

const PORT = Number(process.env.SERVER_PORT || 4000);
const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
const lifecycleEvent = String(process.env.npm_lifecycle_event || '').toLowerCase();
const isDevMode = nodeEnv === 'development' || nodeEnv === 'dev' || lifecycleEvent === 'dev';
const shouldRunMigrationsOnStartup =
  isDevMode && process.env.RUN_MIGRATIONS_ON_STARTUP !== 'false';

const discoveryConfig = {
  projectPath: path.resolve(process.env.PROJECT_PATH || process.cwd()),
  folderPattern: process.env.PROJECT_FOLDER_PATTERN || '.*',
  maxDepth: parseMaxDepth(process.env.SCAN_MAX_DEPTH || 6),
};

const validateAndNormalizeConfig = async (input) => {
  const nextConfig = {
    projectPath: discoveryConfig.projectPath,
    folderPattern: discoveryConfig.folderPattern,
    maxDepth: discoveryConfig.maxDepth,
  };

  if (Object.prototype.hasOwnProperty.call(input, 'projectPath')) {
    if (typeof input.projectPath !== 'string' || input.projectPath.trim().length === 0) {
      throw new Error('projectPath must be a non-empty string');
    }

    const normalizedProjectPath = path.resolve(input.projectPath.trim());
    if (!(await isDirectory(normalizedProjectPath))) {
      throw new Error(`projectPath is not a directory: ${normalizedProjectPath}`);
    }
    nextConfig.projectPath = normalizedProjectPath;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'folderPattern')) {
    if (typeof input.folderPattern !== 'string' || input.folderPattern.trim().length === 0) {
      throw new Error('folderPattern must be a non-empty regex string');
    }

    buildFolderPattern(input.folderPattern.trim());
    nextConfig.folderPattern = input.folderPattern.trim();
  }

  if (Object.prototype.hasOwnProperty.call(input, 'maxDepth')) {
    const parsedDepth = Number(input.maxDepth);
    if (!Number.isInteger(parsedDepth) || parsedDepth < 0 || parsedDepth > 20) {
      throw new Error('maxDepth must be an integer between 0 and 20');
    }

    nextConfig.maxDepth = parsedDepth;
  }

  return nextConfig;
};

const startServer = async () => {
  initModelAssociations();

  try {
    await sequelize.authenticate();
    if (shouldRunMigrationsOnStartup) {
      console.log('Running database migrations on startup...');
      await runMigrations();
    }
    console.log('Database connection established.');
  } catch (error) {
    console.error('Unable to initialize database connection/migrations:', error);
    process.exit(1);
  }

  const app = express();
  const httpServer = http.createServer(app);
  const wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
  const wsClients = new Set();
  const discoverProjects = async (config) => {
    const discovered = await scanProjects(config);
    await syncDiscoveredProjects(discovered);
    return discovered;
  };

  try {
    const initialDiscovery = await discoverProjects(discoveryConfig);
    console.log(`Initial project sync complete (${initialDiscovery.projects.length} projects).`);
  } catch (error) {
    console.error('Failed initial discovery sync:', error);
    process.exit(1);
  }

  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers: createResolvers({
      discoveryConfig,
      validateAndNormalizeConfig,
      discoverProjects,
    }),
  });

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  await apolloServer.start();

  wsServer.on('connection', (socket) => {
    wsClients.add(socket);

    socket.send(JSON.stringify({
      type: 'welcome',
      message: 'Project Commander websocket connected.',
    }));

    socket.on('close', () => {
      wsClients.delete(socket);
    });
  });

  setRuntimeEventSink((payload) => {
    const message = JSON.stringify(payload);
    for (const socket of wsClients) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  });
  startPidMonitor();

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(
    '/graphql',
    cors({ origin: true, credentials: true }),
    express.json(),
    expressMiddleware(apolloServer),
  );

  app.get('/api/discovery/config', (req, res) => {
    res.json({ config: discoveryConfig });
  });

  app.put('/api/discovery/config', async (req, res) => {
    try {
      const normalized = await validateAndNormalizeConfig(req.body || {});
      discoveryConfig.projectPath = normalized.projectPath;
      discoveryConfig.folderPattern = normalized.folderPattern;
      discoveryConfig.maxDepth = normalized.maxDepth;
      res.json({ config: discoveryConfig });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Invalid configuration' });
    }
  });

  app.get('/api/discovery/projects', async (req, res) => {
    try {
      const result = await discoverProjects(discoveryConfig);
      res.json({
        config: discoveryConfig,
        ...result,
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Project scan failed' });
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`Discovery server listening on http://localhost:${PORT}`);
    console.log(`GraphQL server ready at http://localhost:${PORT}/graphql`);
    console.log(`Websocket server ready at ws://localhost:${PORT}/ws`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start discovery server:', error);
  process.exit(1);
});
