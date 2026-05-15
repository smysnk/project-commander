const { createCommanderClient } = require('commander-client');

const objectSchema = (properties = {}, required = []) => ({
  type: 'object',
  additionalProperties: true,
  properties,
  required,
});

const stringProperty = (description) => ({ type: 'string', description });
const numberProperty = (description) => ({ type: 'number', description });
const booleanProperty = (description) => ({ type: 'boolean', description });

const toolDefinitions = [
  {
    name: 'project_commander.list_hosts',
    description: 'List Project Commander slave hosts.',
    inputSchema: objectSchema(),
  },
  {
    name: 'project_commander.list_automation_tokens',
    description: 'List automation API tokens without exposing token secrets.',
    inputSchema: objectSchema({
      includeRevoked: booleanProperty('Include revoked tokens.'),
    }),
  },
  {
    name: 'project_commander.create_automation_token',
    description: 'Create an automation API token and return the one-time token value.',
    inputSchema: objectSchema({
      name: stringProperty('Token display name.'),
      accessMode: stringProperty('Access mode: observe, operate-template, operate-project, operate-host, admin, or full-access.'),
      scopes: { type: 'array', items: { type: 'string' }, description: 'Additional scopes to grant or !scope entries to narrow defaults.' },
      allowedHostIds: { type: 'array', items: { type: 'number' }, description: 'Allowed Project Commander host ids.' },
      allowedProjectIds: { type: 'array', items: { type: 'number' }, description: 'Allowed Project Commander project ids.' },
      allowedPathPrefixes: { type: 'array', items: { type: 'string' }, description: 'Allowed filesystem path prefixes.' },
      rawCommandAllowed: booleanProperty('Allow raw command desired-process definitions when scope also permits it.'),
      fullAccess: booleanProperty('Request full access; deployment policy may disable this.'),
      expiresAt: stringProperty('Optional ISO timestamp expiration. Full-access defaults to a short expiration.'),
    }, ['name', 'accessMode']),
  },
  {
    name: 'project_commander.revoke_automation_token',
    description: 'Revoke an automation API token by id.',
    inputSchema: objectSchema({
      id: numberProperty('Automation token id.'),
    }, ['id']),
  },
  {
    name: 'project_commander.list_runtime_audit_events',
    description: 'List runtime audit events for lifecycle and access operations.',
    inputSchema: objectSchema({
      limit: numberProperty('Maximum events to return.'),
      action: stringProperty('Filter by audit action.'),
      hostId: numberProperty('Filter by host id.'),
      projectId: numberProperty('Filter by project id.'),
      actorType: stringProperty('Filter by actor type.'),
    }),
  },
  {
    name: 'project_commander.list_projects',
    description: 'List discovered projects, optionally scoped to a host.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
    }),
  },
  {
    name: 'project_commander.list_process_templates',
    description: 'List server-backed safe process templates for a project.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectId: numberProperty('Project id.'),
      projectPath: stringProperty('Host-local project path.'),
      codexPath: stringProperty('Codex-visible project path.'),
      includeDisabled: booleanProperty('Include disabled templates.'),
      codexOnly: booleanProperty('Only return templates available to Codex.'),
      allowUnapproved: booleanProperty('Allow unresolved or unapproved path mappings while listing.'),
    }),
  },
  {
    name: 'project_commander.resolve_process_template',
    description: 'Resolve a process template into the desired process definition that would be ensured.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectId: numberProperty('Project id.'),
      projectPath: stringProperty('Host-local project path.'),
      codexPath: stringProperty('Codex-visible project path.'),
      template: stringProperty('Template key alias.'),
      templateKey: stringProperty('Template key.'),
      processKey: stringProperty('Stable process key override.'),
      packageKey: stringProperty('Package/runtime slot key override.'),
      packageRelativePath: stringProperty('Package-relative working path override.'),
      allowUnapproved: booleanProperty('Allow resolved paths outside approved host roots.'),
    }),
  },
  {
    name: 'project_commander.upsert_process_template',
    description: 'Create or update a server-owned process template.',
    inputSchema: objectSchema({
      id: numberProperty('Existing template id.'),
      host: stringProperty('Host name, IP, or agent UUID for host/project scoped templates.'),
      hostId: numberProperty('Project Commander host id.'),
      project: stringProperty('Project name for project scoped templates.'),
      projectId: numberProperty('Project id.'),
      templateKey: stringProperty('Stable template key.'),
      displayName: stringProperty('Template display name.'),
      description: stringProperty('Template description.'),
      packageKey: stringProperty('Default package/runtime slot key.'),
      packageRelativePath: stringProperty('Default package relative path.'),
      processKeyTemplate: stringProperty('Template for generated process key.'),
      cwdTemplate: stringProperty('Template for generated cwd.'),
      desiredState: stringProperty('Default desired state.'),
      launchMode: stringProperty('exec or shell.'),
      command: stringProperty('Command template.'),
      restartPolicy: stringProperty('Restart policy.'),
      healthChecksJson: stringProperty('JSON array of health checks.'),
      logRoot: stringProperty('Log root template.'),
      enabled: booleanProperty('Whether template is enabled.'),
      allowCodex: booleanProperty('Whether Codex can use this template.'),
    }, ['templateKey', 'command']),
  },
  {
    name: 'project_commander.delete_process_template',
    description: 'Delete a persisted process template.',
    inputSchema: objectSchema({
      id: numberProperty('Template id.'),
      hostId: numberProperty('Optional host id guard.'),
      projectId: numberProperty('Optional project id guard.'),
    }, ['id']),
  },
  {
    name: 'project_commander.list_host_path_mappings',
    description: 'List shared-drive path mappings for a Project Commander host.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      includeDisabled: booleanProperty('Include disabled mappings.'),
    }),
  },
  {
    name: 'project_commander.resolve_host_path',
    description: 'Resolve a Codex-visible path to the host-local path a slave should execute against.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      path: stringProperty('Codex-visible or host-local path to resolve.'),
      codexPath: stringProperty('Alias for path.'),
      allowUnapproved: booleanProperty('Allow paths outside approved host roots.'),
    }),
  },
  {
    name: 'project_commander.upsert_host_path_mapping',
    description: 'Create or update a shared-drive path mapping for a host.',
    inputSchema: objectSchema({
      id: numberProperty('Existing mapping id.'),
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      logicalRoot: stringProperty('Human-readable logical root name.'),
      codexPathPrefix: stringProperty('Path prefix visible to Codex, for example /Volumes/public-1/play.'),
      hostPathPrefix: stringProperty('Host-local prefix used by the slave.'),
      description: stringProperty('Mapping description.'),
      enabled: booleanProperty('Whether the mapping is active.'),
      allowUnapproved: booleanProperty('Allow hostPathPrefix outside approved host roots.'),
    }, ['codexPathPrefix', 'hostPathPrefix']),
  },
  {
    name: 'project_commander.delete_host_path_mapping',
    description: 'Delete a shared-drive path mapping.',
    inputSchema: objectSchema({
      id: numberProperty('Mapping id.'),
      hostId: numberProperty('Optional host id guard.'),
      agentUuid: stringProperty('Optional slave UUID guard.'),
    }, ['id']),
  },
  {
    name: 'project_commander.list_desired_processes',
    description: 'List desired process definitions.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectId: numberProperty('Project id.'),
      projectPath: stringProperty('Host-local project path.'),
    }),
  },
  {
    name: 'project_commander.list_observed_runs',
    description: 'List observed process runs.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectPath: stringProperty('Host-local project path.'),
    }),
  },
  {
    name: 'project_commander.ensure_process',
    description: 'Ensure a desired process exists, using a safe template or explicit process definition.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectId: numberProperty('Project id.'),
      projectPath: stringProperty('Host-local project path.'),
      codexPath: stringProperty('Codex-visible project path that should be resolved to a host-local cwd.'),
      template: stringProperty('Safe built-in template key, for example node.dev or docker.compose.up.'),
      processKey: stringProperty('Stable process key.'),
      packageKey: stringProperty('Stable package/runtime slot key.'),
      cwd: stringProperty('Host-local working directory.'),
      launchMode: stringProperty('exec or shell.'),
      command: stringProperty('Command text for explicit raw process definitions.'),
      privilegedScope: stringProperty('Required value raw-command when raw command mode is explicitly enabled.'),
      desiredState: stringProperty('Desired state, usually running.'),
      restartPolicy: stringProperty('Restart policy.'),
      healthChecksJson: stringProperty('JSON array of health checks to wait against.'),
      wait: booleanProperty('Wait for runtime after ensuring the process.'),
      timeoutMs: numberProperty('Wait timeout in milliseconds.'),
      allowUnapproved: booleanProperty('Allow resolved paths outside approved host roots.'),
    }),
  },
  {
    name: 'project_commander.restart_process',
    description: 'Request a restart by killing matching observed runs; slave reconciliation should relaunch desired processes.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectPath: stringProperty('Host-local project path.'),
      processKey: stringProperty('Stable process key.'),
      packageKey: stringProperty('Stable package/runtime slot key.'),
      hard: booleanProperty('Use hard kill for restart.'),
      reason: stringProperty('Restart reason.'),
    }),
  },
  {
    name: 'project_commander.soft_kill_process',
    description: 'Queue a soft kill for a managed process run.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      runId: stringProperty('Observed run id.'),
      processKey: stringProperty('Stable process key.'),
      pid: numberProperty('Process pid, used only with safer identity fields.'),
      reason: stringProperty('Kill reason.'),
    }),
  },
  {
    name: 'project_commander.hard_kill_process',
    description: 'Queue a hard kill for a managed process run.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      runId: stringProperty('Observed run id.'),
      processKey: stringProperty('Stable process key.'),
      pid: numberProperty('Process pid, used only with safer identity fields.'),
      reason: stringProperty('Kill reason.'),
    }),
  },
  {
    name: 'project_commander.tail_process_log',
    description: 'Read recent managed process log lines through Project Commander.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectPath: stringProperty('Host-local project path.'),
      codexPath: stringProperty('Codex-visible path used for project-scoped log resolution.'),
      limit: numberProperty('Maximum log lines.'),
      afterId: numberProperty('Return logs after this log id.'),
    }),
  },
  {
    name: 'project_commander.wait_for_runtime',
    description: 'Wait for a process status or HTTP health check.',
    inputSchema: objectSchema({
      host: stringProperty('Host name, IP, or agent UUID.'),
      hostId: numberProperty('Project Commander host id.'),
      agentUuid: stringProperty('Slave agent UUID.'),
      project: stringProperty('Project name.'),
      projectPath: stringProperty('Host-local project path.'),
      codexPath: stringProperty('Codex-visible path used for project-scoped runtime resolution.'),
      processKey: stringProperty('Stable process key.'),
      packageKey: stringProperty('Stable package/runtime slot key.'),
      status: stringProperty('Expected process status.'),
      url: stringProperty('HTTP URL to check.'),
      method: stringProperty('HTTP method for HTTP checks.'),
      httpStatus: numberProperty('Expected HTTP status.'),
      bodyIncludes: stringProperty('Expected substring in HTTP response body.'),
      healthChecksJson: stringProperty('JSON array of health checks.'),
      pattern: stringProperty('Log pattern to wait for through managed process logs.'),
      port: numberProperty('TCP port to wait for.'),
      tcpHost: stringProperty('TCP host to wait for.'),
      graphqlEndpoint: stringProperty('GraphQL endpoint URL to check.'),
      query: stringProperty('GraphQL query text.'),
      expectedExitCode: numberProperty('Expected exit code for one-shot process checks.'),
      timeoutMs: numberProperty('Wait timeout in milliseconds.'),
      intervalMs: numberProperty('Polling interval in milliseconds.'),
    }),
  },
];

const toolMap = new Map(toolDefinitions.map((tool) => [tool.name, tool]));

const createTextResult = (value) => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const createToolHandlers = ({ client = createCommanderClient({ actor: 'commander-mcp', toolName: 'project_commander.mcp' }) } = {}) => ({
  async callTool(name, input = {}) {
    const previousToolName = client.toolName;
    client.toolName = name;
    try {
      switch (name) {
        case 'project_commander.list_hosts':
          return createTextResult(await client.listHosts(input));
        case 'project_commander.list_automation_tokens':
          return createTextResult(await client.listAutomationTokens(input));
        case 'project_commander.create_automation_token':
          return createTextResult(await client.createAutomationToken(input));
        case 'project_commander.revoke_automation_token':
          return createTextResult(await client.revokeAutomationToken(input));
        case 'project_commander.list_runtime_audit_events':
          return createTextResult(await client.listRuntimeAuditEvents(input));
        case 'project_commander.list_projects':
          return createTextResult(await client.listProjects(input));
        case 'project_commander.list_process_templates':
          return createTextResult(await client.listProcessTemplates(input));
        case 'project_commander.resolve_process_template':
          return createTextResult(await client.resolveProcessTemplate(input));
        case 'project_commander.upsert_process_template':
          return createTextResult(await client.upsertProcessTemplate(input));
        case 'project_commander.delete_process_template':
          return createTextResult(await client.deleteProcessTemplate(input));
        case 'project_commander.list_host_path_mappings':
          return createTextResult(await client.listHostPathMappings(input));
        case 'project_commander.resolve_host_path':
          return createTextResult(await client.resolveHostPath(input));
        case 'project_commander.upsert_host_path_mapping':
          return createTextResult(await client.upsertHostPathMapping(input));
        case 'project_commander.delete_host_path_mapping':
          return createTextResult(await client.deleteHostPathMapping(input));
        case 'project_commander.list_desired_processes':
          return createTextResult(await client.listDesiredProcesses(input));
        case 'project_commander.list_observed_runs':
          return createTextResult(await client.listObservedRuns(input));
        case 'project_commander.ensure_process': {
          const processDefinition = await client.ensureProcess(input);
          const waitResult = input.wait
            ? await client.waitForRuntime({
              ...input,
              processKey: input.processKey || processDefinition?.processKey,
              packageKey: input.packageKey || processDefinition?.packageKey,
            })
            : null;
          return createTextResult({ process: processDefinition, wait: waitResult });
        }
        case 'project_commander.restart_process':
          return createTextResult(await client.restartProcess(input));
        case 'project_commander.soft_kill_process':
          return createTextResult(await client.killProcess({ ...input, hard: false }));
        case 'project_commander.hard_kill_process':
          return createTextResult(await client.killProcess({ ...input, hard: true }));
        case 'project_commander.tail_process_log':
          return createTextResult(await client.tailProcessLog(input));
        case 'project_commander.wait_for_runtime':
          return createTextResult(await client.waitForRuntime(input));
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } finally {
      client.toolName = previousToolName;
    }
  },
});

module.exports = {
  createToolHandlers,
  toolDefinitions,
  toolMap,
};
