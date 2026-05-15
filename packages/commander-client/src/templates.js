const path = require('path');

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'project';

const normalizeTemplateKey = (value) => String(value || '').trim();

const createTemplate = ({
  key,
  displayName,
  description,
  packageKey,
  command,
  launchMode = 'shell',
  restartPolicy = 'manual',
  desiredState = 'running',
  args = [],
}) => ({
  key,
  displayName,
  description,
  packageKey: packageKey || key,
  launchMode,
  command,
  args,
  restartPolicy,
  desiredState,
  allowCodex: true,
  source: 'builtin',
});

const baseTemplates = [
  createTemplate({
    key: 'node.dev',
    displayName: 'Node development server',
    description: 'Run yarn dev in the project root.',
    packageKey: 'main',
    command: 'yarn dev',
  }),
  createTemplate({
    key: 'node.build',
    displayName: 'Node build',
    description: 'Run yarn build in the project root.',
    packageKey: 'build',
    command: 'yarn build',
    desiredState: 'stopped',
  }),
  createTemplate({
    key: 'node.test',
    displayName: 'Node tests',
    description: 'Run yarn test in the project root.',
    packageKey: 'test',
    command: 'yarn test',
    desiredState: 'stopped',
  }),
  createTemplate({
    key: 'docker.compose.up',
    displayName: 'Docker Compose up',
    description: 'Run docker compose up -d in the project root.',
    packageKey: 'docker-compose',
    command: 'docker compose up -d',
  }),
  createTemplate({
    key: 'docker.compose.down',
    displayName: 'Docker Compose down',
    description: 'Run docker compose down in the project root.',
    packageKey: 'docker-compose-down',
    command: 'docker compose down',
    desiredState: 'stopped',
  }),
  createTemplate({
    key: 'make.start',
    displayName: 'Make start',
    description: 'Run make start in the project root.',
    packageKey: 'main',
    command: 'make start',
  }),
  createTemplate({
    key: 'make.test',
    displayName: 'Make test',
    description: 'Run make test in the project root.',
    packageKey: 'test',
    command: 'make test',
    desiredState: 'stopped',
  }),
];

const projectSupportsNode = (project) => (
  Array.isArray(project?.types) && project.types.some((type) => String(type).startsWith('node-'))
);

const projectSupportsMake = (project) => Boolean(project?.hasMakefile);

const compileTemplateCommand = (template, { project }) => {
  if (template.key === 'docker.compose.clearbox.up' || template.key === 'docker-compose-web') {
    return `docker compose -f docker-compose.clearbox.yml -p ${slugify(project?.name)} up -d`;
  }
  return template.command;
};

const inferProcessTemplates = (project = {}) => {
  const templates = [];
  if (projectSupportsNode(project)) {
    templates.push(...baseTemplates.filter((template) => template.key.startsWith('node.')));
  }
  templates.push(...baseTemplates.filter((template) => template.key.startsWith('docker.compose.')));
  templates.push(createTemplate({
    key: 'docker.compose.clearbox.up',
    displayName: 'Docker Compose clearbox up',
    description: 'Run the clearbox-specific docker compose file if present.',
    packageKey: 'docker-compose-clearbox',
    command: 'docker compose -f docker-compose.clearbox.yml up -d',
  }));
  templates.push(createTemplate({
    key: 'docker-compose-web',
    displayName: 'Docker Compose web stack',
    description: 'Compatibility alias for the clearbox docker compose web/server stack.',
    packageKey: 'docker-compose-web',
    command: 'docker compose -f docker-compose.clearbox.yml up -d',
  }));
  if (projectSupportsMake(project)) {
    templates.push(...baseTemplates.filter((template) => template.key.startsWith('make.')));
  }

  return templates.map((template) => ({
    ...template,
    cwd: project.path || '',
    projectPath: project.path || '',
    command: compileTemplateCommand(template, { project }),
  }));
};

const resolveTemplate = ({ project, template }) => {
  const templateKey = normalizeTemplateKey(template);
  if (!templateKey) {
    return null;
  }
  return inferProcessTemplates(project)
    .find((candidate) => candidate.key === templateKey) || null;
};

const buildDesiredProcessInputFromTemplate = ({
  host,
  project,
  template,
  input = {},
  actor = 'commander-mcp',
}) => {
  if (!host || !project || !template) {
    throw new Error('host, project, and template are required');
  }

  const packageKey = String(input.packageKey || template.packageKey || template.key).trim();
  const processKey = String(input.processKey || packageKey).trim();
  const cwd = String(input.cwd || template.cwd || project.path || '').trim();
  const command = String(input.command || template.command || '').trim();
  if (!packageKey || !processKey || !cwd || !command) {
    throw new Error('template did not resolve to a valid process definition');
  }

  return {
    hostId: Number(host.id),
    agentUuid: host.agentUuid || null,
    projectId: Number.isInteger(Number(project.id)) ? Number(project.id) : null,
    projectPath: project.path || null,
    processKey,
    packageKey,
    packageRelativePath: input.packageRelativePath || '.',
    desiredState: input.desiredState || template.desiredState || 'running',
    launchMode: input.launchMode || template.launchMode || 'shell',
    cwd: path.normalize(cwd),
    command,
    args: Array.isArray(input.args) ? input.args : (template.args || []),
    env: Array.isArray(input.env) ? input.env : [],
    logRoot: input.logRoot || null,
    restartPolicy: input.restartPolicy || template.restartPolicy || 'manual',
    createdBy: input.createdBy || actor,
    updatedBy: input.updatedBy || input.createdBy || actor,
  };
};

module.exports = {
  buildDesiredProcessInputFromTemplate,
  inferProcessTemplates,
  resolveTemplate,
  slugify,
};
