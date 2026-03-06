const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const DEFAULT_SOCKET_PATH = process.env.PC_MASTER_SOCKET_PATH || '/tmp/project-commander/master.sock';

const MASTER_CONTROL_PROTO_PATH = path.resolve(
  __dirname,
  '../../../../proto/projectcommander/master/v1/master_control.proto',
);
const MASTER_EVENTS_PROTO_PATH = path.resolve(
  __dirname,
  '../../../../proto/projectcommander/master/v1/master_events.proto',
);
const PROTO_INCLUDE_DIR = path.resolve(__dirname, '../../../../proto');

const masterControlPackageDefinition = protoLoader.loadSync(MASTER_CONTROL_PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_INCLUDE_DIR],
});
const masterEventsPackageDefinition = protoLoader.loadSync(MASTER_EVENTS_PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_INCLUDE_DIR],
});

const masterControlGrpcObject = grpc.loadPackageDefinition(masterControlPackageDefinition);
const MasterControl = masterControlGrpcObject?.projectcommander?.master?.v1?.MasterControl;
const masterEventsGrpcObject = grpc.loadPackageDefinition(masterEventsPackageDefinition);
const MasterEvents = masterEventsGrpcObject?.projectcommander?.master?.v1?.MasterEvents;

if (!MasterControl) {
  throw new Error(`Unable to load MasterControl service from ${MASTER_CONTROL_PROTO_PATH}`);
}
if (!MasterEvents) {
  throw new Error(`Unable to load MasterEvents service from ${MASTER_EVENTS_PROTO_PATH}`);
}

const toUnixTarget = (socketPath) => {
  const normalized = String(socketPath || '').trim();
  if (!normalized) {
    throw new Error('Socket path is required.');
  }
  if (normalized.startsWith('/')) {
    return `unix://${normalized}`;
  }
  return `unix:${normalized}`;
};

const generateRequestId = (prefix) =>
  `${prefix || 'req'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const invokeUnary = (client, methodName, payload, { requestId, timeoutMs = 3000 } = {}) =>
  new Promise((resolve, reject) => {
    if (!client || typeof client[methodName] !== 'function') {
      reject(new Error(`Invalid grpc client or method: ${methodName}`));
      return;
    }

    const metadata = new grpc.Metadata();
    if (requestId) {
      metadata.set('x-request-id', requestId);
    }

    const deadline = new Date(Date.now() + Math.max(100, Number(timeoutMs) || 3000));
    client[methodName](payload || {}, metadata, { deadline }, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });

const createMasterClient = ({ socketPath = DEFAULT_SOCKET_PATH } = {}) => {
  const target = toUnixTarget(socketPath);
  const client = new MasterControl(target, grpc.credentials.createInsecure());
  const eventsClient = new MasterEvents(target, grpc.credentials.createInsecure());

  const close = () => {
    client.close();
    eventsClient.close();
  };

  const getRuntimeSnapshot = async ({ projectPath, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('runtime');
    return invokeUnary(
      client,
      'GetRuntimeSnapshot',
      {
        requestId,
        projectPath,
      },
      { requestId, timeoutMs },
    );
  };

  const health = async ({ timeoutMs = 3000 } = {}) => {
    const requestId = generateRequestId('health');
    return invokeUnary(
      client,
      'Health',
      { requestId },
      { requestId, timeoutMs },
    );
  };

  const getVersion = async ({ timeoutMs = 3000 } = {}) => {
    const requestId = generateRequestId('version');
    return invokeUnary(
      client,
      'GetVersion',
      { requestId },
      { requestId, timeoutMs },
    );
  };

  const handshake = async ({
    clientName = 'project-commander-node',
    clientVersion = '0.1.0',
    requestedCapabilities = ['master.health', 'master.version', 'master.handshake'],
    timeoutMs = 3000,
  } = {}) => {
    const requestId = generateRequestId('handshake');
    return invokeUnary(
      client,
      'Handshake',
      {
        requestId,
        clientName,
        clientVersion,
        requestedCapabilities,
      },
      { requestId, timeoutMs },
    );
  };

  const listRegisteredSlaves = async ({ timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('list-registered-slaves');
    return invokeUnary(
      client,
      'ListRegisteredSlaves',
      { requestId },
      { requestId, timeoutMs },
    );
  };

  const checkoutProjectOnSlave = async ({
    slaveId,
    repositoryUrl,
    baseDirectory,
    destinationFolder,
    timeoutMs = 7000,
  } = {}) => {
    const requestId = generateRequestId('checkout-slave-project');
    return invokeUnary(
      client,
      'CheckoutProjectOnSlave',
      {
        requestId,
        slaveId,
        repositoryUrl,
        baseDirectory,
        destinationFolder,
      },
      { requestId, timeoutMs },
    );
  };

  const startService = async ({ projectPath, serviceKey, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('start-service');
    return invokeUnary(
      client,
      'StartService',
      {
        requestId,
        projectPath,
        serviceKey,
      },
      { requestId, timeoutMs },
    );
  };

  const stopService = async ({ projectPath, serviceKey, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('stop-service');
    return invokeUnary(
      client,
      'StopService',
      {
        requestId,
        projectPath,
        serviceKey,
      },
      { requestId, timeoutMs },
    );
  };

  const restartService = async ({ projectPath, serviceKey, timeoutMs = 7000 } = {}) => {
    const requestId = generateRequestId('restart-service');
    return invokeUnary(
      client,
      'RestartService',
      {
        requestId,
        projectPath,
        serviceKey,
      },
      { requestId, timeoutMs },
    );
  };

  const startProject = async ({ projectPath, timeoutMs = 10000 } = {}) => {
    const requestId = generateRequestId('start-project');
    return invokeUnary(
      client,
      'StartProject',
      {
        requestId,
        projectPath,
      },
      { requestId, timeoutMs },
    );
  };

  const stopProject = async ({ projectPath, timeoutMs = 10000 } = {}) => {
    const requestId = generateRequestId('stop-project');
    return invokeUnary(
      client,
      'StopProject',
      {
        requestId,
        projectPath,
      },
      { requestId, timeoutMs },
    );
  };

  const getLogs = async ({
    projectPath,
    slaveId,
    limit,
    afterId,
    serviceNames,
    timeoutMs = 5000,
  } = {}) => {
    const requestId = generateRequestId('logs');
    return invokeUnary(
      client,
      'GetLogs',
      {
        requestId,
        projectPath: projectPath ? String(projectPath) : '',
        slaveId: slaveId ? String(slaveId) : '',
        limit: Number.isInteger(limit) ? limit : 0,
        afterId: Number.isInteger(afterId) ? afterId : 0,
        serviceNames: Array.isArray(serviceNames) ? serviceNames.filter(Boolean) : [],
      },
      { requestId, timeoutMs },
    );
  };

  const getProcessStats = async ({ projectPath, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('process-stats');
    return invokeUnary(
      client,
      'GetProcessStats',
      {
        requestId,
        projectPath,
      },
      { requestId, timeoutMs },
    );
  };

  const getPortRangeSettings = async ({ projectPath, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('get-port-range');
    return invokeUnary(
      client,
      'GetPortRangeSettings',
      {
        requestId,
        projectPath,
      },
      { requestId, timeoutMs },
    );
  };

  const setPortRangeSettings = async ({ projectPath, mode, begin, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('set-port-range');
    return invokeUnary(
      client,
      'SetPortRangeSettings',
      {
        requestId,
        projectPath,
        settings: {
          mode,
          begin: Number.isInteger(begin) ? begin : 0,
        },
      },
      { requestId, timeoutMs },
    );
  };

  const getLaunchEnvironment = async ({ projectPath, timeoutMs = 5000 } = {}) => {
    const requestId = generateRequestId('launch-env');
    return invokeUnary(
      client,
      'GetLaunchEnvironment',
      {
        requestId,
        projectPath,
      },
      { requestId, timeoutMs },
    );
  };

  const subscribeEvents = ({
    projectPaths,
    requestId,
    timeoutMs = 0,
    onEvent,
    onError,
    onEnd,
    onStatus,
  } = {}) => {
    const resolvedRequestId = requestId || generateRequestId('events');
    const metadata = new grpc.Metadata();
    metadata.set('x-request-id', resolvedRequestId);

    const callOptions = {};
    const normalizedTimeoutMs = Number(timeoutMs);
    if (Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0) {
      callOptions.deadline = new Date(Date.now() + Math.max(500, normalizedTimeoutMs));
    }

    const normalizedProjectPaths = Array.isArray(projectPaths)
      ? projectPaths.map((projectPath) => String(projectPath || '').trim()).filter(Boolean)
      : [];

    const stream = eventsClient.SubscribeEvents({
      requestId: resolvedRequestId,
      projectPaths: normalizedProjectPaths,
    }, metadata, callOptions);

    if (typeof onEvent === 'function') {
      stream.on('data', (event) => {
        onEvent(event);
      });
    }
    if (typeof onError === 'function') {
      stream.on('error', (error) => {
        onError(error);
      });
    }
    if (typeof onEnd === 'function') {
      stream.on('end', () => {
        onEnd();
      });
    }
    if (typeof onStatus === 'function') {
      stream.on('status', (statusValue) => {
        onStatus(statusValue);
      });
    }

    return {
      requestId: resolvedRequestId,
      stream,
      cancel: () => {
        stream.cancel();
      },
    };
  };

  return {
    client,
    eventsClient,
    close,
    health,
    getVersion,
    handshake,
    listRegisteredSlaves,
    checkoutProjectOnSlave,
    getRuntimeSnapshot,
    startService,
    stopService,
    restartService,
    startProject,
    stopProject,
    getLogs,
    getProcessStats,
    getPortRangeSettings,
    setPortRangeSettings,
    getLaunchEnvironment,
    subscribeEvents,
    socketPath,
    target,
  };
};

module.exports = {
  createMasterClient,
  DEFAULT_SOCKET_PATH,
};
