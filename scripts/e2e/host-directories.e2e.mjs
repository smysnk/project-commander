#!/usr/bin/env node

import os from 'os';
import process from 'process';
import { spawnSync } from 'child_process';

const LOG_PREFIX = '[e2e:host-directories]';
const GRAPHQL_ENDPOINT = String(process.env.E2E_GRAPHQL_ENDPOINT || 'http://localhost:4000/graphql').trim();
const HOST_IP = String(process.env.E2E_HOST_IP || '192.168.1.250').trim();
const REMOTE_USER = String(process.env.E2E_REMOTE_USER || os.userInfo().username || '').trim();
const REMOTE_CONNECT_TIMEOUT_SECONDS = (() => {
  const parsed = Number.parseInt(String(process.env.E2E_SSH_CONNECT_TIMEOUT_SECONDS || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
})();
const TEST_DIRECTORY = String(
  process.env.E2E_TEST_DIRECTORY || `~/play/pc-host-directory-e2e-${Date.now()}`,
).trim();

const QUERY_HOSTS = `
  query Hosts {
    hosts {
      id
      ip
      name
      source
      directories
    }
  }
`;

const MUTATION_ADD_HOST = `
  mutation AddHost($ip: String!) {
    addHost(ip: $ip) {
      id
      ip
      name
      source
      directories
    }
  }
`;

const MUTATION_ADD_HOST_DIRECTORY = `
  mutation AddHostDirectory($hostId: Int!, $directoryPath: String!) {
    addHostDirectory(hostId: $hostId, directoryPath: $directoryPath) {
      id
      directories
    }
  }
`;

const MUTATION_REMOVE_HOST_DIRECTORY = `
  mutation RemoveHostDirectory($hostId: Int!, $directoryPath: String!) {
    removeHostDirectory(hostId: $hostId, directoryPath: $directoryPath) {
      id
      directories
    }
  }
`;

const REMOTE_SCRIPT = `
set -euo pipefail
operation="$1"
target_path="$2"

if [[ -z "\${target_path}" ]]; then
  echo "target path is required" >&2
  exit 2
fi

if [[ "\${target_path}" == "~" ]]; then
  target_path="\${HOME}"
elif [[ "\${target_path}" == ~/* ]]; then
  target_path="\${HOME}/\${target_path#~/}"
fi

case "\${operation}" in
  exists-dir)
    [[ -d "\${target_path}" ]]
    ;;
  exists-any)
    [[ -e "\${target_path}" ]]
    ;;
  make-non-empty)
    mkdir -p -- "\${target_path}"
    printf '%s\\n' "pc-e2e" > "\${target_path}/.pc-e2e-non-empty"
    ;;
  clear-non-empty)
    rm -f -- "\${target_path}/.pc-e2e-non-empty"
    ;;
  cleanup)
    rm -f -- "\${target_path}/.pc-e2e-non-empty"
    rmdir -- "\${target_path}" 2>/dev/null || true
    ;;
  *)
    echo "unsupported operation: \${operation}" >&2
    exit 3
    ;;
esac
`;

const log = (message) => {
  console.log(`${LOG_PREFIX} ${message}`);
};

const formatGraphqlErrors = (errors) => (
  (Array.isArray(errors) ? errors : [])
    .map((entry) => String(entry?.message || '').trim())
    .filter(Boolean)
    .join(' | ')
);

const graphqlRequest = async ({ query, variables = {}, expectError = false }) => {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Non-JSON GraphQL response (${response.status}): ${text.slice(0, 500)}`);
  }

  if (!response.ok) {
    const errorMessage = formatGraphqlErrors(payload?.errors);
    throw new Error(
      `GraphQL HTTP ${response.status}${errorMessage ? `: ${errorMessage}` : ''}`,
    );
  }

  const hasErrors = Array.isArray(payload?.errors) && payload.errors.length > 0;
  if (expectError) {
    if (!hasErrors) {
      throw new Error('Expected GraphQL mutation to fail, but it succeeded.');
    }
    return payload;
  }

  if (hasErrors) {
    throw new Error(`GraphQL error: ${formatGraphqlErrors(payload.errors)}`);
  }

  return payload?.data || {};
};

const runRemote = ({ operation, directoryPath, allowedExitCodes = [0] }) => {
  const target = `${REMOTE_USER}@${HOST_IP}`;
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${REMOTE_CONNECT_TIMEOUT_SECONDS}`,
    target,
    'bash',
    '-se',
    '--',
    operation,
    directoryPath,
  ];
  const result = spawnSync('ssh', args, {
    encoding: 'utf8',
    input: REMOTE_SCRIPT,
  });

  const status = Number.isInteger(result.status) ? result.status : 1;
  if (!allowedExitCodes.includes(status)) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    throw new Error(
      `Remote operation "${operation}" failed (exit=${status})${stderr ? ` stderr=${stderr}` : ''}${stdout ? ` stdout=${stdout}` : ''}`,
    );
  }

  return status;
};

const remoteDirectoryExists = (directoryPath) => (
  runRemote({
    operation: 'exists-dir',
    directoryPath,
    allowedExitCodes: [0, 1],
  }) === 0
);

const remotePathExists = (directoryPath) => (
  runRemote({
    operation: 'exists-any',
    directoryPath,
    allowedExitCodes: [0, 1],
  }) === 0
);

const normalizeDirectories = (directories) => {
  const source = Array.isArray(directories) ? directories : [];
  const unique = [];
  const seen = new Set();
  for (const entry of source) {
    const normalized = String(entry || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
};

const getHostByIp = async (ip) => {
  const data = await graphqlRequest({ query: QUERY_HOSTS });
  const hosts = Array.isArray(data?.hosts) ? data.hosts : [];
  return hosts.find((host) => String(host?.ip || '').trim() === ip) || null;
};

const getHostById = async (hostId) => {
  const data = await graphqlRequest({ query: QUERY_HOSTS });
  const hosts = Array.isArray(data?.hosts) ? data.hosts : [];
  return hosts.find((host) => Number(host?.id) === Number(hostId)) || null;
};

const ensureHost = async (ip) => {
  const existing = await getHostByIp(ip);
  if (existing) {
    return Number(existing.id);
  }

  log(`Host ${ip} is not in catalog; creating a manual host entry.`);
  const data = await graphqlRequest({
    query: MUTATION_ADD_HOST,
    variables: { ip },
  });
  const hostId = Number(data?.addHost?.id);
  if (!Number.isInteger(hostId) || hostId <= 0) {
    throw new Error(`Failed to create host entry for ${ip}.`);
  }
  return hostId;
};

const ensure = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const safeCleanup = async (hostId) => {
  if (!Number.isInteger(hostId) || hostId <= 0) {
    return;
  }

  try {
    await graphqlRequest({
      query: MUTATION_REMOVE_HOST_DIRECTORY,
      variables: { hostId, directoryPath: TEST_DIRECTORY },
    });
  } catch {
    // directory may already be gone or removable only after clearing marker file.
  }

  try {
    runRemote({ operation: 'clear-non-empty', directoryPath: TEST_DIRECTORY, allowedExitCodes: [0, 1] });
    runRemote({ operation: 'cleanup', directoryPath: TEST_DIRECTORY, allowedExitCodes: [0] });
  } catch {
    // best-effort cleanup only.
  }

  try {
    await graphqlRequest({
      query: MUTATION_REMOVE_HOST_DIRECTORY,
      variables: { hostId, directoryPath: TEST_DIRECTORY },
    });
  } catch {
    // best-effort cleanup only.
  }
};

const main = async () => {
  ensure(HOST_IP.length > 0, 'E2E_HOST_IP must be set.');
  ensure(REMOTE_USER.length > 0, 'E2E_REMOTE_USER is empty and local user lookup failed.');

  log(`GraphQL endpoint: ${GRAPHQL_ENDPOINT}`);
  log(`Remote target: ${REMOTE_USER}@${HOST_IP}`);
  log(`Test directory: ${TEST_DIRECTORY}`);

  let hostId = null;
  try {
    hostId = await ensureHost(HOST_IP);
    log(`Using host id=${hostId}`);

    runRemote({ operation: 'cleanup', directoryPath: TEST_DIRECTORY, allowedExitCodes: [0] });

    log('Adding directory via GraphQL mutation.');
    await graphqlRequest({
      query: MUTATION_ADD_HOST_DIRECTORY,
      variables: { hostId, directoryPath: TEST_DIRECTORY },
    });

    let host = await getHostById(hostId);
    ensure(host, `Host ${hostId} is missing after addHostDirectory mutation.`);
    let directories = normalizeDirectories(host?.directories);
    ensure(
      directories.includes(TEST_DIRECTORY),
      `Host metadata missing directory after addHostDirectory: ${TEST_DIRECTORY}`,
    );
    ensure(
      remoteDirectoryExists(TEST_DIRECTORY),
      `Remote directory was not created: ${TEST_DIRECTORY}`,
    );

    log('Adding same directory again to verify uniqueness.');
    await graphqlRequest({
      query: MUTATION_ADD_HOST_DIRECTORY,
      variables: { hostId, directoryPath: TEST_DIRECTORY },
    });

    host = await getHostById(hostId);
    ensure(host, `Host ${hostId} is missing after duplicate addHostDirectory mutation.`);
    directories = normalizeDirectories(host?.directories);
    const occurrences = directories.filter((entry) => entry === TEST_DIRECTORY).length;
    ensure(
      occurrences === 1,
      `Expected exactly one directory entry for ${TEST_DIRECTORY}, found ${occurrences}.`,
    );

    log('Marking directory non-empty and validating remove failure.');
    runRemote({ operation: 'make-non-empty', directoryPath: TEST_DIRECTORY, allowedExitCodes: [0] });
    const removeAttempt = await graphqlRequest({
      query: MUTATION_REMOVE_HOST_DIRECTORY,
      variables: { hostId, directoryPath: TEST_DIRECTORY },
      expectError: true,
    });
    const removeFailureMessage = formatGraphqlErrors(removeAttempt?.errors);
    ensure(
      removeFailureMessage.length > 0,
      'Expected removeHostDirectory failure message for non-empty directory.',
    );
    ensure(
      remoteDirectoryExists(TEST_DIRECTORY),
      'Directory should still exist after failed removeHostDirectory on non-empty path.',
    );

    host = await getHostById(hostId);
    ensure(host, `Host ${hostId} is missing after failed removeHostDirectory mutation.`);
    directories = normalizeDirectories(host?.directories);
    ensure(
      directories.includes(TEST_DIRECTORY),
      'Directory entry should remain in host metadata when remote removal fails.',
    );

    log('Clearing marker file and removing directory.');
    runRemote({ operation: 'clear-non-empty', directoryPath: TEST_DIRECTORY, allowedExitCodes: [0, 1] });
    await graphqlRequest({
      query: MUTATION_REMOVE_HOST_DIRECTORY,
      variables: { hostId, directoryPath: TEST_DIRECTORY },
    });

    ensure(
      !remotePathExists(TEST_DIRECTORY),
      `Remote directory still exists after removeHostDirectory: ${TEST_DIRECTORY}`,
    );

    host = await getHostById(hostId);
    ensure(host, `Host ${hostId} is missing after successful removeHostDirectory mutation.`);
    directories = normalizeDirectories(host?.directories);
    ensure(
      !directories.includes(TEST_DIRECTORY),
      'Directory entry still exists in host metadata after removeHostDirectory.',
    );

    log('PASS: host directory add/remove e2e checks succeeded.');
  } finally {
    await safeCleanup(hostId);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
