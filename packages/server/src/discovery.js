const fs = require('fs/promises');
const path = require('path');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.yarn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
]);

const MAKEFILE_NAMES = ['Makefile', 'makefile', 'GNUmakefile'];

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const parseMaxDepth = (input) => {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 6;
  }
  return parsed;
};

const buildFolderPattern = (patternInput) => {
  const pattern = patternInput || '.*';
  return new RegExp(pattern);
};

const isDirectory = async (folderPath) => {
  try {
    const stats = await fs.stat(folderPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

const hasNestedGoMod = async (folderPath, maxDepth = 2) => {
  const queue = [{ dir: folderPath, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();

    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const nextDir = path.join(current.dir, entry.name);
      const nestedGoModPath = path.join(nextDir, 'go.mod');
      if (await pathExists(nestedGoModPath)) {
        return true;
      }

      if (current.depth < maxDepth) {
        queue.push({ dir: nextDir, depth: current.depth + 1 });
      }
    }
  }

  return false;
};

const hasMakefileInFolder = async (folderPath) => {
  for (const fileName of MAKEFILE_NAMES) {
    if (await pathExists(path.join(folderPath, fileName))) {
      return true;
    }
  }
  return false;
};

const readJsonFile = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const parseEnvFileEntries = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const entries = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) {
        continue;
      }

      const key = match[1];
      let value = match[2] || '';
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }

      entries.push({ key, value });
    }

    return entries;
  } catch {
    return [];
  }
};

const readMakeTargets = async (folderPath) => {
  for (const makefileName of MAKEFILE_NAMES) {
    const makefilePath = path.join(folderPath, makefileName);
    try {
      const raw = await fs.readFile(makefilePath, 'utf8');
      const targets = [];
      for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
        if (!match) {
          continue;
        }
        const targetName = match[1];
        if (targetName.startsWith('.')) {
          continue;
        }
        targets.push(targetName);
      }
      return Array.from(new Set(targets));
    } catch {
      // try next makefile variant
    }
  }

  return [];
};

const detectServiceLanguage = async (folderPath) => {
  if (await pathExists(path.join(folderPath, 'go.mod'))) {
    return 'go';
  }

  if (await pathExists(path.join(folderPath, 'package.json'))) {
    if (await pathExists(path.join(folderPath, 'tsconfig.json'))) {
      return 'typescript';
    }

    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      const hasTypeScriptFile = entries.some((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name));
      if (hasTypeScriptFile) {
        return 'typescript';
      }
    } catch {
      // ignore
    }

    return 'javascript';
  }

  return 'unknown';
};

const toEnvMap = (entries) => {
  const map = {};
  for (const entry of entries || []) {
    if (entry && typeof entry.key === 'string') {
      map[entry.key] = entry.value;
    }
  }
  return map;
};

const inspectDeclaredServiceFolder = async (serviceFolderPath, projectRootPath, rootEnvMap = {}) => {
  const packageJsonPath = path.join(serviceFolderPath, 'package.json');
  const envExamplePath = path.join(serviceFolderPath, '.env.example');

  const [hasPackageJson, hasMakefile, language, packageJson, envExampleEntries, makeTargets] =
    await Promise.all([
      pathExists(packageJsonPath),
      hasMakefileInFolder(serviceFolderPath),
      detectServiceLanguage(serviceFolderPath),
      readJsonFile(packageJsonPath),
      parseEnvFileEntries(envExamplePath),
      readMakeTargets(serviceFolderPath),
    ]);

  const packageScripts = hasPackageJson && packageJson && packageJson.scripts && typeof packageJson.scripts === 'object'
    ? Object.entries(packageJson.scripts)
        .filter(([name, command]) => typeof name === 'string' && typeof command === 'string')
        .map(([name, command]) => ({ name, command }))
    : [];

  const envFiles = [];
  if (envExampleEntries.length > 0) {
    envFiles.push({ file: '.env.example', entries: envExampleEntries });
  }

  const envVarNames = Array.from(new Set(envExampleEntries.map((entry) => entry.key))).sort();
  const effectiveEnvVarMap = envVarNames
    .filter((key) => Object.prototype.hasOwnProperty.call(rootEnvMap, key))
    .map((key) => ({ key, value: rootEnvMap[key] }));

  return {
    name: (packageJson && typeof packageJson.name === 'string' && packageJson.name.trim()) || path.basename(serviceFolderPath),
    path: serviceFolderPath,
    relativePath: path.relative(projectRootPath, serviceFolderPath) || '.',
    language,
    hasPackageJson,
    hasMakefile,
    packageScripts,
    makeTargets,
    envVarNames,
    envFiles,
    effectiveEnvVarMap,
  };
};

const inspectMonorepoDeclaredServices = async (projectFolderPath) => {
  const packagesFolderPath = path.join(projectFolderPath, 'packages');
  if (!(await isDirectory(packagesFolderPath))) {
    return [];
  }

  let entries = [];
  try {
    entries = await fs.readdir(packagesFolderPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const serviceDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .filter((entry) => !IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => path.join(packagesFolderPath, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const rootEnvEntries = await parseEnvFileEntries(path.join(projectFolderPath, '.env'));
  const rootEnvMap = toEnvMap(rootEnvEntries);

  const results = [];
  for (const serviceFolderPath of serviceDirs) {
    const inspected = await inspectDeclaredServiceFolder(serviceFolderPath, projectFolderPath, rootEnvMap);
    // For monorepos, use the package folder name as the canonical service name so
    // runtime slots/log labels map to web/server/admin consistently.
    results.push({
      ...inspected,
      name: path.basename(serviceFolderPath),
    });
  }
  return results;
};

const inspectSingleProjectDeclaredService = async (projectFolderPath) => {
  const rootEnvEntries = await parseEnvFileEntries(path.join(projectFolderPath, '.env'));
  const rootEnvMap = toEnvMap(rootEnvEntries);
  const service = await inspectDeclaredServiceFolder(
    projectFolderPath,
    projectFolderPath,
    rootEnvMap,
  );
  return [service];
};

const inferServiceKinds = async (folderPath, types) => {
  const inferred = new Set(['main']);

  const [hasGraphqlSchema, hasGraphqlDir, hasApiDir, hasServerDir, hasAdminDir] = await Promise.all([
    pathExists(path.join(folderPath, 'schema.graphql')),
    isDirectory(path.join(folderPath, 'graphql')),
    isDirectory(path.join(folderPath, 'api')),
    isDirectory(path.join(folderPath, 'server')),
    isDirectory(path.join(folderPath, 'admin')),
  ]);

  if (hasGraphqlSchema || hasGraphqlDir) {
    inferred.add('graphql');
  }

  if (hasApiDir || hasServerDir || types.includes('go-project')) {
    inferred.add('api');
  }

  if (hasAdminDir) {
    inferred.add('admin');
  }

  return Array.from(inferred);
};

const toServiceKind = (serviceName) => {
  const normalized = String(serviceName || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'web' || normalized === 'interface') {
    return 'main';
  }
  if (normalized === 'server' || normalized === 'api') {
    return 'api';
  }
  if (normalized === 'admin') {
    return 'admin';
  }
  if (normalized === 'graphql') {
    return 'graphql';
  }
  return normalized;
};

const inspectProjectFolder = async (folderPath, rootPath) => {
  const [
    hasPackageJson,
    hasPackagesDir,
    hasGoMod,
    hasGoWork,
    hasMakefile,
  ] = await Promise.all([
    pathExists(path.join(folderPath, 'package.json')),
    isDirectory(path.join(folderPath, 'packages')),
    pathExists(path.join(folderPath, 'go.mod')),
    pathExists(path.join(folderPath, 'go.work')),
    hasMakefileInFolder(folderPath),
  ]);

  const hasNestedModule = hasGoMod ? await hasNestedGoMod(folderPath) : false;

  const types = [];

  if (hasPackageJson) {
    types.push('node-project');
    if (hasPackagesDir) {
      types.push('node-monorepo');
    }
  }

  if (hasGoMod) {
    types.push('go-project');
  }

  if (hasGoWork || (hasGoMod && hasNestedModule)) {
    types.push('go-monorepo');
  }

  if (types.length === 0 && !hasMakefile) {
    return null;
  }

  if (types.length === 0 && hasMakefile) {
    types.push('make-project');
  }

  const isMonorepo = types.includes('node-monorepo') || types.includes('go-monorepo');
  const [inferredServices, declaredServices] = await Promise.all([
    inferServiceKinds(folderPath, types),
    isMonorepo
      ? inspectMonorepoDeclaredServices(folderPath)
      : inspectSingleProjectDeclaredService(folderPath),
  ]);

  const monorepoDeclaredKinds = declaredServices
    .map((service) => toServiceKind(service.name))
    .filter(Boolean);
  const services = isMonorepo
    ? Array.from(new Set([...inferredServices, ...monorepoDeclaredKinds]))
    : ['main'];

  return {
    name: path.basename(folderPath),
    path: folderPath,
    relativePath: path.relative(rootPath, folderPath) || '.',
    types,
    services,
    declaredServices,
    hasMakefile,
  };
};

const scanProjects = async ({ projectPath, folderPattern, maxDepth }) => {
  const normalizedRoot = path.resolve(projectPath);
  const normalizedMaxDepth = parseMaxDepth(maxDepth);
  const pattern = buildFolderPattern(folderPattern);

  const rootIsDirectory = await isDirectory(normalizedRoot);
  if (!rootIsDirectory) {
    throw new Error(`Project path does not exist or is not a directory: ${normalizedRoot}`);
  }

  const results = [];
  const queue = [{ dir: normalizedRoot, depth: 0 }];
  const rootName = path.basename(normalizedRoot);

  if (pattern.test(rootName)) {
    const rootInspection = await inspectProjectFolder(normalizedRoot, normalizedRoot);
    if (rootInspection) {
      results.push(rootInspection);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();

    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const candidatePath = path.join(current.dir, entry.name);
      const childDepth = current.depth + 1;

      if (childDepth <= normalizedMaxDepth && pattern.test(entry.name)) {
        const inspected = await inspectProjectFolder(candidatePath, normalizedRoot);
        if (inspected) {
          results.push(inspected);
        }
      }

      if (childDepth < normalizedMaxDepth) {
        queue.push({ dir: candidatePath, depth: childDepth });
      }
    }
  }

  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    rootPath: normalizedRoot,
    folderPattern,
    maxDepth: normalizedMaxDepth,
    scannedAt: new Date().toISOString(),
    projects: results,
  };
};

module.exports = {
  scanProjects,
  parseMaxDepth,
  buildFolderPattern,
  isDirectory,
};
