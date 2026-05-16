const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCommanderClient } = require('commander-client');

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.project-commander', 'pcctl.json');
const WAIT_SUCCESS_STATUSES = new Set(['matched', 'success', 'ok', 'running', 'healthy']);
const BOOLEAN_OPTIONS = new Set([
  'allow-unapproved',
  'follow',
  'full-access',
  'hard',
  'help',
  'include-disabled',
  'json',
  'raw-command-allowed',
  'wait',
]);

const usage = `pcctl - Project Commander lifecycle CLI

Usage:
  pcctl [global flags] hosts list [--json]
  pcctl [global flags] projects list [--host <host>] [--json]
  pcctl [global flags] templates list --host <host> --project <project> [--json]
  pcctl [global flags] process ensure --host <host> --project <project> --template <key> [--wait] [--json]
  pcctl [global flags] process restart --host <host> --project <project> [--process-key <key>] [--template <key>] [--wait]
  pcctl [global flags] process ps [--host <host>] [--project <project>] [--status <status>] [--process-key <key>] [--search <text>] [--json]
  pcctl [global flags] process logs --run-id <run-id> [--follow] [--json]
  pcctl [global flags] process soft-kill --run-id <run-id> [--json]
  pcctl [global flags] process hard-kill --run-id <run-id> [--json]
  pcctl [global flags] path resolve --host <host> --path <path> [--json]

Global flags:
  --url <url>                Project Commander base URL; env PROJECT_COMMANDER_URL
  --endpoint <url>           GraphQL endpoint; env PROJECT_COMMANDER_GRAPHQL_ENDPOINT
  --token <token>            Automation bearer token; env PROJECT_COMMANDER_TOKEN
  --config <path>            Config file; default ~/.project-commander/pcctl.json
  --host <host>              Host selector or default host override
  --json                     Emit JSON
  --help                     Show this help

Config precedence: command flags, environment variables, then ~/.project-commander/pcctl.json.`;

const kebabToCamel = (value) => String(value || '').replace(/-([a-z])/gu, (_, char) => char.toUpperCase());

const assignOption = (options, key, value) => {
  const normalizedKey = kebabToCamel(key);
  if (Object.prototype.hasOwnProperty.call(options, normalizedKey)) {
    const existing = options[normalizedKey];
    options[normalizedKey] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    return;
  }
  options[normalizedKey] = value;
};

const parseArgv = (argv = []) => {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index]);
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1).map(String));
      break;
    }
    if (arg === '-j') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const withoutPrefix = arg.slice(2);
      const equalsIndex = withoutPrefix.indexOf('=');
      const rawKey = equalsIndex >= 0 ? withoutPrefix.slice(0, equalsIndex) : withoutPrefix;
      if (!rawKey) {
        continue;
      }
      if (equalsIndex >= 0) {
        assignOption(options, rawKey, withoutPrefix.slice(equalsIndex + 1));
        continue;
      }
      if (BOOLEAN_OPTIONS.has(rawKey)) {
        assignOption(options, rawKey, true);
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !String(next).startsWith('-')) {
        assignOption(options, rawKey, String(next));
        index += 1;
      } else {
        assignOption(options, rawKey, true);
      }
      continue;
    }
    positionals.push(arg);
  }

  return { positionals, options };
};

const firstValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstValue(...value);
      if (nested !== undefined && nested !== null && nested !== '') {
        return nested;
      }
      continue;
    }
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
};

const boolValue = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
};

const intValue = (value) => {
  const candidate = firstValue(value);
  if (candidate === undefined || candidate === null || candidate === '') {
    return null;
  }
  const parsed = Number(candidate);
  return Number.isInteger(parsed) ? parsed : null;
};

const arrayValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [String(value)];
};

const envEntries = (values) => arrayValue(values)
  .map((entry) => {
    const index = entry.indexOf('=');
    if (index <= 0) {
      return null;
    }
    return {
      key: entry.slice(0, index).trim(),
      value: entry.slice(index + 1),
    };
  })
  .filter((entry) => entry?.key);

const readJsonFile = (filePath) => {
  const normalized = String(filePath || '').trim();
  if (!normalized || !fs.existsSync(normalized)) {
    return {};
  }
  const parsed = JSON.parse(fs.readFileSync(normalized, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

const readConfig = ({ configPath = DEFAULT_CONFIG_PATH } = {}) => {
  try {
    return readJsonFile(configPath);
  } catch (error) {
    throw new Error(`Unable to read pcctl config ${configPath}: ${error.message}`);
  }
};

const buildRuntimeOptions = ({ options = {}, env = process.env, config = {} } = {}) => {
  const endpoint = firstValue(
    options.endpoint,
    options.graphqlEndpoint,
    env.PROJECT_COMMANDER_GRAPHQL_ENDPOINT,
    config.graphqlEndpoint,
    config.endpoint,
  );
  const baseUrl = firstValue(
    options.url,
    options.baseUrl,
    env.PROJECT_COMMANDER_URL,
    config.url,
    config.baseUrl,
  );
  const token = firstValue(
    options.token,
    env.PROJECT_COMMANDER_TOKEN,
    env.PROJECT_COMMANDER_AUTOMATION_TOKEN,
    config.token,
    config.automationToken,
  );
  const defaultHost = firstValue(
    options.host,
    env.PROJECT_COMMANDER_DEFAULT_HOST,
    config.defaultHost,
    config.host,
  );

  return {
    endpoint,
    baseUrl,
    token,
    defaultHost,
  };
};

const createClient = ({ runtimeOptions, env = process.env, clientFactory = createCommanderClient } = {}) => clientFactory({
  endpoint: runtimeOptions.endpoint,
  baseUrl: runtimeOptions.baseUrl,
  token: runtimeOptions.token,
  actor: 'pcctl',
  toolName: 'pcctl',
  allowRawCommands: boolValue(env.PROJECT_COMMANDER_PCCTL_ALLOW_RAW_COMMANDS),
});

const commonInput = (options = {}, runtimeOptions = {}) => ({
  host: firstValue(options.host, runtimeOptions.defaultHost),
  hostId: intValue(options.hostId),
  agentUuid: firstValue(options.agentUuid, options.slaveId),
  project: firstValue(options.project, options.projectName),
  projectId: intValue(options.projectId),
  projectPath: firstValue(options.projectPath),
  codexPath: firstValue(options.codexPath),
  allowUnapproved: boolValue(options.allowUnapproved),
});

const processInput = (options = {}, runtimeOptions = {}) => ({
  ...commonInput(options, runtimeOptions),
  template: firstValue(options.template, options.templateKey),
  templateKey: firstValue(options.templateKey, options.template),
  processKey: firstValue(options.processKey),
  packageKey: firstValue(options.packageKey),
  packageRelativePath: firstValue(options.packageRelativePath),
  desiredState: firstValue(options.desiredState),
  launchMode: firstValue(options.launchMode),
  cwd: firstValue(options.cwd),
  command: firstValue(options.command),
  args: arrayValue(options.arg || options.args),
  env: envEntries(options.env),
  logRoot: firstValue(options.logRoot),
  restartPolicy: firstValue(options.restartPolicy),
  healthChecksJson: firstValue(options.healthChecksJson, options.healthChecks),
  wait: boolValue(options.wait),
  timeoutMs: intValue(options.timeoutMs),
  intervalMs: intValue(options.intervalMs),
  runId: firstValue(options.runId),
  pid: intValue(options.pid),
  status: firstValue(options.status),
  search: firstValue(options.search, options.query, options.filter),
  hard: boolValue(options.hard),
  reason: firstValue(options.reason),
  privilegedScope: firstValue(options.privilegedScope),
});

const waitSucceeded = (waitResult) => {
  if (!waitResult) {
    return true;
  }
  return WAIT_SUCCESS_STATUSES.has(String(waitResult.status || '').trim().toLowerCase());
};

const stringifyCell = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.join(',');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
};

const formatTable = (rows = [], columns = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'No rows';
  }
  const activeColumns = columns.length > 0
    ? columns
    : Object.keys(rows[0]).slice(0, 8).map((key) => ({ key, label: key }));
  const normalizedRows = rows.map((row) => activeColumns.map((column) => stringifyCell(row?.[column.key])));
  const widths = activeColumns.map((column, columnIndex) => Math.max(
    String(column.label).length,
    ...normalizedRows.map((row) => row[columnIndex].length),
  ));
  const header = activeColumns.map((column, index) => String(column.label).padEnd(widths[index])).join('  ');
  const separator = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = normalizedRows
    .map((row) => row.map((cell, index) => cell.padEnd(widths[index])).join('  '))
    .join('\n');
  return `${header}\n${separator}\n${body}`;
};

const formatKeyValue = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return stringifyCell(value);
  }
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${stringifyCell(entry)}`)
    .join('\n');
};

const formatOutput = (value, { json = false, table = null } = {}) => {
  if (json) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
  if (Array.isArray(value)) {
    return `${formatTable(value, table || [])}\n`;
  }
  if (value && typeof value === 'object' && Array.isArray(value.process ? [value.process] : null) && value.process) {
    return `${formatKeyValue(value)}\n`;
  }
  return `${formatKeyValue(value)}\n`;
};

const columnsFor = (kind) => {
  const columns = {
    hosts: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'NAME' },
      { key: 'ip', label: 'IP' },
      { key: 'online', label: 'ONLINE' },
      { key: 'health', label: 'HEALTH' },
      { key: 'version', label: 'VERSION' },
    ],
    projects: [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'NAME' },
      { key: 'hostName', label: 'HOST' },
      { key: 'runtimeStatus', label: 'STATUS' },
      { key: 'path', label: 'PATH' },
    ],
    templates: [
      { key: 'id', label: 'ID' },
      { key: 'templateKey', label: 'KEY' },
      { key: 'displayName', label: 'NAME' },
      { key: 'packageKey', label: 'PKG' },
      { key: 'launchMode', label: 'MODE' },
      { key: 'enabled', label: 'ENABLED' },
      { key: 'allowCodex', label: 'CODEX' },
    ],
    processes: [
      { key: 'runId', label: 'RUN ID' },
      { key: 'hostId', label: 'HOST' },
      { key: 'projectId', label: 'PROJECT' },
      { key: 'processKey', label: 'PROCESS' },
      { key: 'pid', label: 'PID' },
      { key: 'status', label: 'STATUS' },
      { key: 'startedAt', label: 'STARTED' },
    ],
    logs: [
      { key: 'id', label: 'ID' },
      { key: 'timestamp', label: 'TIME' },
      { key: 'serviceName', label: 'SERVICE' },
      { key: 'stream', label: 'STREAM' },
      { key: 'message', label: 'MESSAGE' },
    ],
  };
  return columns[kind] || [];
};

const resolveObservedRun = async (client, input = {}) => {
  if (!input.runId) {
    return null;
  }
  const directRuns = await client.listObservedRuns(input);
  const directMatch = directRuns.find((run) => run.runId === input.runId);
  if (directMatch) {
    return directMatch;
  }
  if (input.host || input.hostId || input.agentUuid) {
    return null;
  }
  const hosts = await client.listHosts();
  for (const host of hosts) {
    const runs = await client.listObservedRuns({ hostId: host.id, agentUuid: host.agentUuid });
    const match = runs.find((run) => run.runId === input.runId);
    if (match) {
      return match;
    }
  }
  return null;
};

const readProcessLogs = async (client, input = {}) => {
  const run = input.runId ? await resolveObservedRun(client, input) : null;
  const logInput = run
    ? {
      ...input,
      hostId: run.hostId || input.hostId,
      agentUuid: run.slaveId || input.agentUuid,
      projectPath: run.projectPath || input.projectPath,
    }
    : input;
  return client.tailProcessLog(logInput);
};

const followProcessLogs = async ({ client, input, stdout, json }) => {
  let afterId = intValue(input.afterId);
  const intervalMs = intValue(input.intervalMs) || 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const logs = await readProcessLogs(client, { ...input, afterId });
    for (const entry of logs) {
      afterId = Math.max(afterId || 0, Number(entry.id) || 0);
      stdout.write(json ? `${JSON.stringify(entry)}\n` : `${formatTable([entry], columnsFor('logs'))}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

const handleCommand = async ({ positionals, options, runtimeOptions, client, stdout }) => {
  const [group, command] = positionals;
  const json = boolValue(options.json);

  if (!group || group === 'help' || boolValue(options.help)) {
    return { exitCode: 0, output: `${usage}\n` };
  }

  if (group === 'hosts' && command === 'list') {
    return { output: formatOutput(await client.listHosts(), { json, table: columnsFor('hosts') }) };
  }

  if (group === 'projects' && command === 'list') {
    const input = commonInput(options, runtimeOptions);
    return { output: formatOutput(await client.listProjects(input), { json, table: columnsFor('projects') }) };
  }

  if (group === 'templates' && command === 'list') {
    const input = commonInput(options, runtimeOptions);
    return { output: formatOutput(await client.listProcessTemplates(input), { json, table: columnsFor('templates') }) };
  }

  if (group === 'path' && command === 'resolve') {
    const input = {
      ...commonInput(options, runtimeOptions),
      path: firstValue(options.path, options.codexPath),
    };
    if (!input.path) {
      throw new Error('path resolve requires --path');
    }
    return { output: formatOutput(await client.resolveHostPath(input), { json }) };
  }

  if (group === 'process' && command === 'ps') {
    const input = processInput(options, runtimeOptions);
    return { output: formatOutput(await client.listObservedRuns(input), { json, table: columnsFor('processes') }) };
  }

  if (group === 'process' && command === 'ensure') {
    const input = processInput(options, runtimeOptions);
    if (!input.template && !input.command) {
      throw new Error('process ensure requires --template or --command');
    }
    const processDefinition = await client.ensureProcess(input);
    const wait = input.wait
      ? await client.waitForRuntime({
        ...input,
        processKey: input.processKey || processDefinition?.processKey,
        packageKey: input.packageKey || processDefinition?.packageKey,
      })
      : null;
    return {
      exitCode: waitSucceeded(wait) ? 0 : 2,
      output: formatOutput({ process: processDefinition, wait }, { json }),
    };
  }

  if (group === 'process' && command === 'restart') {
    const input = processInput(options, runtimeOptions);
    let resolvedTemplate = null;
    if (input.template || input.templateKey) {
      resolvedTemplate = await client.resolveProcessTemplate(input);
      input.processKey = input.processKey || resolvedTemplate?.processKey;
      input.packageKey = input.packageKey || resolvedTemplate?.packageKey;
    }
    const restart = await client.restartProcess(input);
    const wait = input.wait
      ? await client.waitForRuntime({
        ...input,
        processKey: input.processKey,
        packageKey: input.packageKey,
      })
      : null;
    return {
      exitCode: waitSucceeded(wait) ? 0 : 2,
      output: formatOutput({ restart, template: resolvedTemplate, wait }, { json }),
    };
  }

  if (group === 'process' && command === 'logs') {
    const input = {
      ...processInput(options, runtimeOptions),
      limit: intValue(options.limit) || 200,
      afterId: intValue(options.afterId),
      serviceNames: arrayValue(options.serviceName || options.serviceNames),
    };
    if (boolValue(options.follow)) {
      await followProcessLogs({ client, input, stdout, json });
      return { output: '' };
    }
    return { output: formatOutput(await readProcessLogs(client, input), { json, table: columnsFor('logs') }) };
  }

  if (group === 'process' && (command === 'soft-kill' || command === 'hard-kill')) {
    const input = processInput(options, runtimeOptions);
    if (!input.runId && !input.processKey && !input.pid) {
      throw new Error(`process ${command} requires --run-id, --process-key, or --pid`);
    }
    const result = await client.killProcess({
      ...input,
      hard: command === 'hard-kill',
    });
    return { output: formatOutput(result, { json }) };
  }

  throw new Error(`Unknown command: ${positionals.join(' ')}`);
};

const exitCodeFromError = (error) => {
  const message = String(error?.message || error || '').toLowerCase();
  if (error?.status === 401 || error?.status === 403 || /auth|forbidden|denied|not authorized/.test(message)) {
    return 3;
  }
  return 1;
};

const runCli = async (argv = [], {
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  clientFactory = createCommanderClient,
} = {}) => {
  const { positionals, options } = parseArgv(argv);
  if (boolValue(options.help)) {
    stdout.write(`${usage}\n`);
    return 0;
  }
  try {
    const configPath = firstValue(options.config) || DEFAULT_CONFIG_PATH;
    const config = readConfig({ configPath });
    const runtimeOptions = buildRuntimeOptions({ options, env, config });
    const client = createClient({ runtimeOptions, env, clientFactory });
    const result = await handleCommand({ positionals, options, runtimeOptions, client, stdout });
    if (result?.output) {
      stdout.write(result.output);
    }
    return Number.isInteger(result?.exitCode) ? result.exitCode : 0;
  } catch (error) {
    stderr.write(`${error.message || error}\n`);
    return exitCodeFromError(error);
  }
};

module.exports = {
  DEFAULT_CONFIG_PATH,
  buildRuntimeOptions,
  commonInput,
  formatOutput,
  handleCommand,
  parseArgv,
  processInput,
  readConfig,
  runCli,
  usage,
  waitSucceeded,
};
