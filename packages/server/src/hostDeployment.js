const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolveConfiguredSudoPassword } = require('./hostAgentLifecycle');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_SLAVE_SCRIPT = path.resolve(REPO_ROOT, 'scripts/deploy/deploy-slave.sh');
const DEFAULT_VERIFY_TIMEOUT_SECONDS = 45;
const DEFAULT_VERIFY_RETRIES = 3;
const DEFAULT_VERIFY_RETRY_DELAY_SECONDS = 8;
const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const DEFAULT_LOCAL_MASTER_SOCKET_PATH = '/tmp/project-commander/master.sock';
const DEPLOY_SUDO_PASSWORD_REQUIRED_MARKER = '__PC_DEPLOY_SUDO_PASSWORD_REQUIRED__';
const DEPLOY_SUDO_PASSWORD_REQUIRED_EXIT_CODE = 92;

const shellQuote = (value) => `'${String(value || '').replace(/'/g, `'\\''`)}'`;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const parseEndpointHost = (endpoint) => {
  const normalized = String(endpoint || '').trim();
  if (!normalized) {
    return '';
  }

  const ipv6Match = normalized.match(/^\[([^\]]+)\]:(\d+)$/);
  if (ipv6Match) {
    return String(ipv6Match[1] || '').trim().toLowerCase();
  }

  const lastColonIndex = normalized.lastIndexOf(':');
  if (lastColonIndex <= 0 || lastColonIndex === normalized.length - 1) {
    return normalized.toLowerCase();
  }
  return normalized.slice(0, lastColonIndex).trim().toLowerCase();
};

const isLoopbackEndpointHost = (host) => {
  const normalized = String(host || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.')
  );
};

const normalizeHostMetadata = (metadata) => (
  metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {}
);

const resolveConnectionTarget = ({
  hostIp,
  metadata,
}) => {
  const normalizedMetadata = normalizeHostMetadata(metadata);
  const rawTarget = String(normalizedMetadata.manualTarget || '').trim();
  const normalizedHost = String(hostIp || normalizedMetadata.host || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
  const sshUser = String(normalizedMetadata.sshUser || '').trim() || null;
  const sshPort = parsePositiveInt(normalizedMetadata.sshPort, 0);
  const isLocal = isLoopbackEndpointHost(normalizedHost);

  return {
    host: normalizedHost,
    target: rawTarget || normalizedHost,
    sshUser,
    sshPort: sshPort > 0 ? sshPort : null,
    isLocal,
  };
};

const redactCommandArgs = (args) => {
  const redacted = [];
  for (let index = 0; index < args.length; index += 1) {
    const current = String(args[index] || '');
    redacted.push(current);
    if (current === '--shared-key' && index + 1 < args.length) {
      redacted.push('<redacted>');
      index += 1;
    }
  }
  return redacted;
};

const toIsoTimestamp = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Date().toISOString();
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
};

const emitOverlayLog = (
  emitEvent,
  {
    serviceName = 'deploy',
    stream = 'system',
    source = 'node-backend',
    message,
    timestamp,
    hostId = null,
    hostName = null,
    hostIp = null,
  } = {},
) => {
  const normalizedMessage = String(message || '').trimEnd();
  if (!normalizedMessage || typeof emitEvent !== 'function') {
    return;
  }

  emitEvent({
    type: 'overlay-log',
    entry: {
      timestamp: toIsoTimestamp(timestamp),
      serviceName: String(serviceName || 'deploy'),
      stream: String(stream || 'system'),
      source: String(source || 'node-backend'),
      hostId: Number.isInteger(Number(hostId)) ? Number(hostId) : null,
      hostName: hostName ? String(hostName) : null,
      hostIp: hostIp ? String(hostIp) : null,
      message: normalizedMessage,
    },
  });
};

const resolveLocalUser = () => {
  try {
    const info = os.userInfo();
    const candidate = String(info?.username || '').trim();
    if (candidate) {
      return candidate;
    }
  } catch {
    // fallback below
  }

  const fallback = String(process.env.USER || process.env.LOGNAME || '').trim();
  return fallback || null;
};

const createLineForwarder = ({
  emitEvent,
  stream,
  hostId,
  hostName,
  hostIp,
  serviceName = 'deploy',
  onLine = null,
}) => {
  let buffer = '';
  const emitLine = (line) => {
    const normalized = String(line || '').trimEnd();
    if (!normalized) {
      return;
    }
    if (typeof onLine === 'function') {
      const shouldEmit = onLine(normalized, stream);
      if (shouldEmit === false) {
        return;
      }
    }
    emitOverlayLog(emitEvent, {
      serviceName,
      stream,
      source: 'node-backend',
      hostId,
      hostName,
      hostIp,
      message: normalized,
    });
  };

  const onData = (chunk) => {
    buffer += String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      emitLine(line);
    }
  };

  const onEnd = () => {
    emitLine(buffer);
    buffer = '';
  };

  return {
    onData,
    onEnd,
  };
};

const runRemoteDirectoryOperation = async ({
  hostId,
  hostName,
  hostIp,
  hostMetadata,
  operation,
  directoryPath,
  emitEvent,
}) => {
  const target = resolveConnectionTarget({
    hostIp,
    metadata: hostMetadata,
  });
  if (!target.host) {
    throw new Error('host target is required');
  }

  const normalizedOperation = String(operation || '').trim().toLowerCase();
  if (!['add', 'remove'].includes(normalizedOperation)) {
    throw new Error(`Unsupported remote directory operation: ${operation}`);
  }

  const normalizedDirectoryPath = String(directoryPath || '').trim();
  if (!normalizedDirectoryPath) {
    throw new Error('directoryPath is required');
  }

  const user = resolveLocalUser();
  const targetUser = target.sshUser || user;
  if (!target.isLocal && !targetUser) {
    throw new Error(`Unable to determine the SSH user for host directory operation on ${target.host}`);
  }
  const hostTarget = target.isLocal
    ? target.host
    : `${targetUser}@${target.host}`;
  const sshArgs = target.isLocal
    ? []
    : [
      '-o',
      'BatchMode=yes',
      '-o',
      `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
      ...(target.sshPort ? ['-p', String(target.sshPort)] : []),
      hostTarget,
      'bash',
      '-se',
      '--',
      normalizedOperation,
      normalizedDirectoryPath,
    ];

  const remoteScript = `
set -euo pipefail
operation="$1"
target_path="$2"

if [[ -z "\${target_path}" ]]; then
  echo "[host-dir][error] target directory path is empty" >&2
  exit 2
fi

if [[ "\${target_path}" == "~" ]]; then
  target_path="\${HOME}"
elif [[ "\${target_path}" == ~/* ]]; then
  target_path="\${HOME}/\${target_path#~/}"
fi

if [[ "\${operation}" == "add" ]]; then
  if [[ -e "\${target_path}" && ! -d "\${target_path}" ]]; then
    echo "[host-dir][error] path exists but is not a directory: \${target_path}" >&2
    exit 3
  fi
  mkdir -p -- "\${target_path}"
  echo "[host-dir] ensured directory exists: \${target_path}"
  exit 0
fi

if [[ "\${operation}" == "remove" ]]; then
  if [[ -e "\${target_path}" && ! -d "\${target_path}" ]]; then
    echo "[host-dir][error] path exists but is not a directory: \${target_path}" >&2
    exit 4
  fi
  if [[ ! -e "\${target_path}" ]]; then
    echo "[host-dir] directory does not exist; nothing to remove: \${target_path}"
    exit 0
  fi
  if rmdir -- "\${target_path}"; then
    echo "[host-dir] removed empty directory: \${target_path}"
    exit 0
  fi
  echo "[host-dir][error] directory is not empty and cannot be removed: \${target_path}" >&2
  exit 5
fi

echo "[host-dir][error] unknown operation: \${operation}" >&2
exit 6
`.trimStart();

  emitOverlayLog(emitEvent, {
    serviceName: 'host-directory',
    hostId,
    hostName,
    hostIp: target.host,
    message: `[host-dir] starting ${normalizedOperation} on ${hostTarget}: ${normalizedDirectoryPath}`,
  });
  emitOverlayLog(emitEvent, {
    serviceName: 'host-directory',
    hostId,
    hostName,
    hostIp: target.host,
    message: target.isLocal
      ? `$ bash -se -- ${shellQuote(normalizedOperation)} ${shellQuote(normalizedDirectoryPath)}`
      : `$ ssh ${sshArgs.map((value) => shellQuote(value)).join(' ')}`,
  });

  await new Promise((resolve, reject) => {
    const child = spawn(target.isLocal ? 'bash' : 'ssh', target.isLocal ? [
      '-se',
      '--',
      normalizedOperation,
      normalizedDirectoryPath,
    ] : sshArgs, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const forwardStdout = createLineForwarder({
      emitEvent,
      stream: 'stdout',
      hostId,
      hostName,
      hostIp: target.host,
      serviceName: 'host-directory',
    });
    const forwardStderr = createLineForwarder({
      emitEvent,
      stream: 'stderr',
      hostId,
      hostName,
      hostIp: target.host,
      serviceName: 'host-directory',
    });

    child.stdin?.setEncoding('utf8');
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdin?.write(remoteScript);
    child.stdin?.end();

    child.stdout?.on('data', forwardStdout.onData);
    child.stderr?.on('data', forwardStderr.onData);
    child.stdout?.on('end', forwardStdout.onEnd);
    child.stderr?.on('end', forwardStderr.onEnd);

    child.on('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error || 'remote host directory operation failed')));
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `Host directory operation "${normalizedOperation}" failed for ${hostTarget} (exit=${code ?? 'null'}, signal=${signal || 'none'}).`,
      ));
    });
  });
};

const createRemoteHostDirectory = async ({
  hostId,
  hostName,
  hostIp,
  hostMetadata,
  directoryPath,
  emitEvent,
}) => runRemoteDirectoryOperation({
  hostId,
  hostName,
  hostIp,
  hostMetadata,
  operation: 'add',
  directoryPath,
  emitEvent,
});

const removeRemoteHostDirectory = async ({
  hostId,
  hostName,
  hostIp,
  hostMetadata,
  directoryPath,
  emitEvent,
}) => runRemoteDirectoryOperation({
  hostId,
  hostName,
  hostIp,
  hostMetadata,
  operation: 'remove',
  directoryPath,
  emitEvent,
});

const deploySlaveToHost = async ({
  hostId,
  hostName,
  hostIp,
  hostMetadata,
  hostAgentUuid,
  deploymentAction = 'deployment',
  emitEvent,
  requestSudoPassword,
}) => {
  const target = resolveConnectionTarget({
    hostIp,
    metadata: hostMetadata,
  });
  if (!target.host) {
    return;
  }
  const normalizedAgentUuid = String(hostAgentUuid || '').trim().toLowerCase();
  if (!normalizedAgentUuid) {
    throw new Error(
      `Host ${hostName || target.host} is missing agent UUID. Recreate the host or run migrations before deployment.`,
    );
  }

  const user = resolveLocalUser();
  const targetUser = target.sshUser || user;
  if (!target.isLocal && !targetUser) {
    throw new Error(`Unable to determine the SSH user for deployment to ${target.host}`);
  }

  const hostTarget = target.isLocal
    ? target.host
    : `${targetUser}@${target.host}`;
  const normalizedDeploymentAction = String(deploymentAction || '').trim().toLowerCase() || 'deployment';
  const deploymentLabel = normalizedDeploymentAction === 'upgrade'
    ? 'upgrade'
    : normalizedDeploymentAction === 'redeploy'
      ? 're-deploy'
      : 'deployment';
  const args = [
    DEPLOY_SLAVE_SCRIPT,
    '--host',
    hostTarget,
    '--slave-id',
    normalizedAgentUuid,
  ];
  if (target.isLocal) {
    args.push('--local');
  }
  if (target.sshPort) {
    args.push('--ssh-port', String(target.sshPort));
  }

  const masterSocketPath = String(
    process.env.PC_MASTER_SLAVE_SOCKET_PATH
    || process.env.PC_MASTER_SOCKET_PATH
    || (target.isLocal ? DEFAULT_LOCAL_MASTER_SOCKET_PATH : ''),
  ).trim();
  const masterEndpoint = String(
    process.env.PC_MASTER_ENDPOINT || process.env.PC_MASTER_SLAVE_LISTEN_ADDR || '',
  ).trim();
  if (target.isLocal && masterSocketPath) {
    args.push('--master-socket-path', masterSocketPath);
  } else {
    if (!masterEndpoint) {
      throw new Error(
        'PC_MASTER_ENDPOINT is required for remote slave deployment. Set it to a master endpoint reachable from the remote host (for example, 192.168.x.x:50052).',
      );
    }
    args.push('--master-endpoint', masterEndpoint);
    const endpointHost = parseEndpointHost(masterEndpoint);
    if (!target.isLocal && isLoopbackEndpointHost(endpointHost)) {
      emitOverlayLog(emitEvent, {
        hostId,
        hostName,
        hostIp: target.host,
        stream: 'stderr',
        message: `Warning: configured master endpoint "${masterEndpoint}" is loopback. Remote host ${target.host} will attempt to connect to itself unless master is running there.`,
      });
    }
  }
  const defaultProjectPath = String(process.env.PC_SLAVE_DEFAULT_PROJECT_PATH || '').trim();
  if (defaultProjectPath) {
    args.push('--default-project-path', defaultProjectPath);
  }
  const sharedKey = String(process.env.PC_SLAVE_SHARED_KEY || '').trim();
  if (!sharedKey) {
    throw new Error('PC_SLAVE_SHARED_KEY is required before deploying a slave host');
  }
  args.push('--shared-key', sharedKey);
  const verifyTimeoutSeconds = parsePositiveInt(
    process.env.PC_SLAVE_DEPLOY_VERIFY_TIMEOUT_SECONDS,
    DEFAULT_VERIFY_TIMEOUT_SECONDS,
  );
  const verifyRetries = parsePositiveInt(
    process.env.PC_SLAVE_DEPLOY_VERIFY_RETRIES,
    DEFAULT_VERIFY_RETRIES,
  );
  const verifyRetryDelaySeconds = parsePositiveInt(
    process.env.PC_SLAVE_DEPLOY_VERIFY_RETRY_DELAY_SECONDS,
    DEFAULT_VERIFY_RETRY_DELAY_SECONDS,
  );
  args.push('--verify-timeout', String(verifyTimeoutSeconds));
  args.push('--verify-retries', String(verifyRetries));
  args.push('--verify-retry-delay', String(verifyRetryDelaySeconds));

  emitOverlayLog(emitEvent, {
    hostId,
    hostName,
    hostIp: target.host,
    message: `Starting slave ${deploymentLabel} to ${hostTarget} (slave_id=${normalizedAgentUuid}).`,
  });
  emitOverlayLog(emitEvent, {
    hostId,
    hostName,
    hostIp: target.host,
    message: `$ bash ${redactCommandArgs(args).map((value) => shellQuote(value)).join(' ')}`,
  });

  const configuredSudoPassword = resolveConfiguredSudoPassword(process.env);

  const runDeploymentAttempt = ({ sudoPassword = null } = {}) => (
    new Promise((resolve, reject) => {
      let sudoPasswordRequired = false;
      let sudoPasswordRejected = false;
      const child = spawn('bash', args, {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          ...(sudoPassword || configuredSudoPassword
            ? { PC_DEPLOY_SUDO_PASSWORD: String(sudoPassword || configuredSudoPassword) }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const onLine = (line) => {
        if (line.includes(DEPLOY_SUDO_PASSWORD_REQUIRED_MARKER)) {
          sudoPasswordRequired = true;
          return false;
        }
        if (line.includes('[deploy][error] provided sudo password was rejected.')) {
          sudoPasswordRejected = true;
        }
        return true;
      };

      const forwardStdout = createLineForwarder({
        emitEvent,
        stream: 'stdout',
        hostId,
        hostName,
        hostIp: target.host,
        onLine,
      });
      const forwardStderr = createLineForwarder({
        emitEvent,
        stream: 'stderr',
        hostId,
        hostName,
        hostIp: target.host,
        onLine,
      });

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', forwardStdout.onData);
      child.stderr?.on('data', forwardStderr.onData);
      child.stdout?.on('end', forwardStdout.onEnd);
      child.stderr?.on('end', forwardStderr.onEnd);

      child.on('error', (error) => {
        emitOverlayLog(emitEvent, {
          hostId,
          hostName,
          hostIp: target.host,
          message: `Deployment process failed to start for ${hostTarget}: ${error.message || error}`,
        });
        reject(error instanceof Error ? error : new Error(String(error || 'deployment process failed')));
      });

      child.on('close', (code, signal) => {
        resolve({
          code,
          signal,
          sudoPasswordRequired: sudoPasswordRequired || code === DEPLOY_SUDO_PASSWORD_REQUIRED_EXIT_CODE,
          sudoPasswordRejected,
        });
      });
    })
  );

  let sudoPassword = null;
  let usedManualSudoPassword = false;
  for (let attemptIndex = 1; attemptIndex <= 3; attemptIndex += 1) {
    const result = await runDeploymentAttempt({ sudoPassword });
    if (result.code === 0) {
      emitOverlayLog(emitEvent, {
        hostId,
        hostName,
        hostIp: target.host,
        message: `Slave ${deploymentLabel} completed for ${hostTarget}.`,
      });
      return;
    }

    if (result.sudoPasswordRejected && configuredSudoPassword && !usedManualSudoPassword) {
      emitOverlayLog(emitEvent, {
        hostId,
        hostName,
        hostIp: target.host,
        message: `Configured sudo password from environment was rejected for slave ${deploymentLabel} on ${hostTarget}; falling back to frontend prompt.`,
        stream: 'stderr',
      });
    }

    if ((result.sudoPasswordRequired || result.sudoPasswordRejected) && !usedManualSudoPassword) {
      usedManualSudoPassword = true;
      if (typeof requestSudoPassword !== 'function') {
        throw new Error(
          `Slave ${deploymentLabel} failed for ${hostTarget}: sudo password is required but no frontend password request handler is available.`,
        );
      }
      emitOverlayLog(emitEvent, {
        hostId,
        hostName,
        hostIp: target.host,
        message: `Sudo password required to continue slave ${deploymentLabel} on ${hostTarget}. Awaiting frontend response.`,
      });
      sudoPassword = await requestSudoPassword({
        hostId,
        hostName,
        hostIp: target.host,
        deploymentAction: normalizedDeploymentAction,
      });
      if (!String(sudoPassword || '')) {
        throw new Error(
          `Slave ${deploymentLabel} cancelled for ${hostTarget}: sudo password was not provided.`,
        );
      }
      emitOverlayLog(emitEvent, {
        hostId,
        hostName,
        hostIp: target.host,
        message: `Received sudo password from frontend; retrying slave ${deploymentLabel} on ${hostTarget}.`,
      });
      continue;
    }

    const failure = new Error(
      `Slave ${deploymentLabel} failed for ${hostTarget} (exit=${result.code ?? 'null'}, signal=${result.signal || 'none'}).`,
    );
    emitOverlayLog(emitEvent, {
      hostId,
      hostName,
      hostIp: target.host,
      message: failure.message,
    });
    throw failure;
  }
};

module.exports = {
  deploySlaveToHost,
  createRemoteHostDirectory,
  removeRemoteHostDirectory,
};
