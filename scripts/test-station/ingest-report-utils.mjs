import fs from 'node:fs';
import path from 'node:path';

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

export function createIngestPayload(options = {}) {
  const reportPath = requireNonEmptyString(options.reportPath, 'reportPath');
  const projectKey = requireNonEmptyString(options.projectKey, 'projectKey');
  const report = options.report || readJson(reportPath);
  const outputDir = path.resolve(options.outputDir || path.dirname(reportPath));
  const storage = normalizeStorageOptions(options.storage);

  return {
    projectKey,
    report: attachArtifactLocations(report, storage),
    source: buildGitHubSourceContext({
      buildStartedAt: options.buildStartedAt,
      buildCompletedAt: options.buildCompletedAt,
      jobStatus: options.jobStatus,
      artifactCount: countOutputFiles(outputDir),
      storage,
    }, options.env),
    artifacts: collectOutputArtifacts(outputDir, storage),
  };
}

export async function publishIngestPayload(options = {}) {
  const endpoint = requireNonEmptyString(options.endpoint, 'endpoint');
  const sharedKey = requireNonEmptyString(options.sharedKey, 'sharedKey');
  const payload = options.payload;
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sharedKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const body = tryParseJson(text);
  if (!response.ok) {
    const detail = body?.error?.message || body?.message || text || `HTTP ${response.status}`;
    throw new Error(`Ingest publish failed (${response.status}): ${detail}`);
  }

  return body;
}

export function normalizeStorageOptions(storage = {}) {
  return {
    bucket: trimToNull(storage.bucket),
    prefix: normalizeRelativePath(storage.prefix || ''),
    baseUrl: normalizeBaseUrl(storage.baseUrl),
  };
}

function buildGitHubSourceContext(options = {}, env = process.env) {
  const serverUrl = trimToNull(env.GITHUB_SERVER_URL) || 'https://github.com';
  const repository = trimToNull(env.GITHUB_REPOSITORY);
  const runId = trimToNull(env.GITHUB_RUN_ID);
  const startedAt = normalizeTimestamp(options.buildStartedAt)
    || normalizeTimestamp(env.TEST_STATION_BUILD_STARTED_AT)
    || new Date().toISOString();
  const completedAt = normalizeTimestamp(options.buildCompletedAt)
    || normalizeTimestamp(env.TEST_STATION_BUILD_COMPLETED_AT)
    || new Date().toISOString();
  const storage = normalizeStorageOptions(options.storage);

  return {
    provider: 'github-actions',
    runId,
    runUrl: repository && runId ? `${serverUrl}/${repository}/actions/runs/${runId}` : null,
    repository,
    repositoryUrl: repository ? `${serverUrl}/${repository}` : null,
    branch: trimToNull(env.GITHUB_HEAD_REF)
      || (trimToNull(env.GITHUB_REF_TYPE) === 'branch' ? trimToNull(env.GITHUB_REF_NAME) : null),
    tag: trimToNull(env.GITHUB_REF_TYPE) === 'tag' ? trimToNull(env.GITHUB_REF_NAME) : null,
    commitSha: trimToNull(env.GITHUB_SHA),
    actor: trimToNull(env.GITHUB_ACTOR),
    startedAt,
    completedAt,
    buildNumber: parseInteger(env.GITHUB_RUN_NUMBER),
    ci: {
      eventName: trimToNull(env.GITHUB_EVENT_NAME),
      workflow: trimToNull(env.GITHUB_WORKFLOW),
      workflowRef: trimToNull(env.GITHUB_WORKFLOW_REF),
      workflowSha: trimToNull(env.GITHUB_WORKFLOW_SHA),
      job: trimToNull(env.GITHUB_JOB),
      ref: trimToNull(env.GITHUB_REF),
      refName: trimToNull(env.GITHUB_REF_NAME),
      refType: trimToNull(env.GITHUB_REF_TYPE),
      runAttempt: parseInteger(env.GITHUB_RUN_ATTEMPT),
      repositoryOwner: trimToNull(env.GITHUB_REPOSITORY_OWNER),
      serverUrl,
      status: trimToNull(options.jobStatus) || trimToNull(env.TEST_STATION_CI_STATUS),
      buildDurationMs: diffTimestamps(startedAt, completedAt),
      artifactCount: Number.isFinite(options.artifactCount) ? options.artifactCount : null,
      storage: {
        bucket: storage.bucket,
        prefix: storage.prefix,
        baseUrl: storage.baseUrl,
      },
    },
  };
}

function collectOutputArtifacts(outputDir, storage = {}) {
  return listFilesRecursively(path.resolve(outputDir))
    .map((absolutePath) => toRelativePosixPath(outputDir, absolutePath))
    .sort((left, right) => left.localeCompare(right))
    .map((relativePath) => {
      const locator = createArtifactLocator(relativePath, storage);
      return {
        label: createArtifactLabel(relativePath),
        relativePath,
        href: relativePath,
        kind: 'file',
        mediaType: inferMediaType(relativePath),
        storageKey: locator.storageKey,
        sourceUrl: locator.sourceUrl,
      };
    });
}

function attachArtifactLocations(report, storage = {}) {
  const cloned = structuredClone(report);
  const packages = Array.isArray(cloned?.packages) ? cloned.packages : [];
  for (const packageEntry of packages) {
    const suites = Array.isArray(packageEntry?.suites) ? packageEntry.suites : [];
    for (const suite of suites) {
      const rawArtifacts = Array.isArray(suite?.rawArtifacts) ? suite.rawArtifacts : [];
      for (const artifact of rawArtifacts) {
        if (!artifact || typeof artifact !== 'object' || !artifact.relativePath) {
          continue;
        }
        const relativePath = path.posix.join('raw', normalizeRelativePath(artifact.relativePath));
        const locator = createArtifactLocator(relativePath, storage);
        artifact.storageKey = locator.storageKey;
        artifact.sourceUrl = locator.sourceUrl;
      }
    }
  }
  return cloned;
}

function createArtifactLocator(relativePath, storage = {}) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const prefix = normalizeRelativePath(storage.prefix || '');
  const objectPath = prefix ? path.posix.join(prefix, normalizedRelativePath) : normalizedRelativePath;
  return {
    storageKey: storage.bucket ? `s3://${storage.bucket}/${objectPath}` : null,
    sourceUrl: storage.baseUrl ? new URL(objectPath, `${storage.baseUrl}/`).toString() : null,
  };
}

function listFilesRecursively(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function countOutputFiles(outputDir) {
  return listFilesRecursively(outputDir).length;
}

function createArtifactLabel(relativePath) {
  switch (relativePath) {
    case 'report.json':
      return 'Normalized report';
    case 'modules.json':
      return 'Module rollup';
    case 'ownership.json':
      return 'Ownership rollup';
    case 'index.html':
      return 'HTML report';
    default:
      return path.posix.basename(relativePath);
  }
}

function inferMediaType(relativePath) {
  switch (path.extname(relativePath).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.html':
      return 'text/html';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}

function requireNonEmptyString(value, name) {
  const normalized = trimToNull(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function trimToNull(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value) {
  const normalized = trimToNull(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function diffTimestamps(left, right) {
  const leftValue = Date.parse(left);
  const rightValue = Date.parse(right);
  if (Number.isNaN(leftValue) || Number.isNaN(rightValue)) {
    return null;
  }
  return Math.max(0, rightValue - leftValue);
}

function normalizeRelativePath(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
  return normalized.replace(/\/$/, '');
}

function normalizeBaseUrl(value) {
  const normalized = trimToNull(value);
  return normalized ? normalized.replace(/\/+$/, '') : null;
}

function toRelativePosixPath(rootDir, absolutePath) {
  return normalizeRelativePath(path.relative(rootDir, absolutePath));
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
