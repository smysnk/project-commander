import {
  FiActivity,
  FiBarChart2,
  FiBell,
  FiBookOpen,
  FiCloud,
  FiCode,
  FiCpu,
  FiCreditCard,
  FiDatabase,
  FiEdit3,
  FiFilm,
  FiFolder,
  FiGlobe,
  FiImage,
  FiKey,
  FiLayers,
  FiLock,
  FiMail,
  FiMonitor,
  FiMusic,
  FiPackage,
  FiSearch,
  FiServer,
  FiSettings,
  FiShield,
  FiShoppingCart,
  FiSmartphone,
  FiTerminal,
  FiTool,
  FiUsers,
} from 'react-icons/fi';

const normalizeServiceName = (value) => String(value || '').trim().toLowerCase();

const tokenize = (value) =>
  normalizeServiceName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const ICON_RULES = [
  {
    icon: FiGlobe,
    exact: ['web', 'frontend', 'site', 'portal', 'landing'],
    tokens: ['web', 'front', 'frontend', 'site', 'portal', 'ui', 'client'],
  },
  {
    icon: FiServer,
    exact: ['server', 'api', 'backend', 'gateway', 'proxy'],
    tokens: ['server', 'api', 'backend', 'gateway', 'proxy'],
  },
  {
    icon: FiKey,
    exact: ['admin', 'auth', 'identity', 'iam'],
    tokens: ['admin', 'auth', 'identity', 'iam', 'permission'],
  },
  {
    icon: FiDatabase,
    exact: ['db', 'database', 'postgres', 'mysql', 'redis'],
    tokens: ['db', 'database', 'postgres', 'mysql', 'mongo', 'redis', 'cache'],
  },
  {
    icon: FiActivity,
    exact: ['worker', 'jobs', 'queue'],
    tokens: ['worker', 'jobs', 'job', 'queue', 'consumer', 'scheduler'],
  },
  {
    icon: FiCpu,
    exact: ['ai', 'ml', 'inference'],
    tokens: ['ai', 'ml', 'model', 'inference', 'compute', 'engine'],
  },
  {
    icon: FiImage,
    exact: ['image', 'images', 'media', 'thumbnail'],
    tokens: ['image', 'images', 'media', 'thumbnail', 'preview', 'photo'],
  },
  {
    icon: FiFilm,
    exact: ['video', 'videos'],
    tokens: ['video', 'videos', 'stream', 'transcode'],
  },
  {
    icon: FiMusic,
    exact: ['audio', 'music'],
    tokens: ['audio', 'music', 'sound'],
  },
  {
    icon: FiSearch,
    exact: ['search', 'index', 'indexer'],
    tokens: ['search', 'index', 'indexer', 'query'],
  },
  {
    icon: FiMail,
    exact: ['mail', 'email', 'mailer'],
    tokens: ['mail', 'email', 'mailer', 'smtp'],
  },
  {
    icon: FiBell,
    exact: ['notifications', 'notification'],
    tokens: ['notify', 'notification', 'notifications', 'alert'],
  },
  {
    icon: FiCreditCard,
    exact: ['billing', 'payments', 'payment'],
    tokens: ['billing', 'payments', 'payment', 'checkout'],
  },
  {
    icon: FiShoppingCart,
    exact: ['commerce', 'shop', 'store'],
    tokens: ['commerce', 'shop', 'store', 'cart', 'order'],
  },
  {
    icon: FiBookOpen,
    exact: ['docs', 'documentation'],
    tokens: ['docs', 'documentation', 'guide'],
  },
  {
    icon: FiBarChart2,
    exact: ['analytics', 'metrics'],
    tokens: ['analytics', 'metrics', 'stats', 'telemetry'],
  },
  {
    icon: FiTerminal,
    exact: ['cli', 'console', 'shell'],
    tokens: ['cli', 'console', 'shell', 'terminal'],
  },
  {
    icon: FiMonitor,
    exact: ['desktop', 'electron'],
    tokens: ['desktop', 'electron', 'mac', 'windows'],
  },
  {
    icon: FiSmartphone,
    exact: ['mobile', 'ios', 'android'],
    tokens: ['mobile', 'ios', 'android', 'reactnative'],
  },
  {
    icon: FiLayers,
    exact: ['shared', 'common', 'core'],
    tokens: ['shared', 'common', 'core', 'framework', 'platform'],
  },
  {
    icon: FiCloud,
    exact: ['cloud', 'infra', 'k8s'],
    tokens: ['cloud', 'infra', 'k8s', 'kubernetes', 'aws', 'gcp', 'azure'],
  },
  {
    icon: FiShield,
    exact: ['security', 'secrets'],
    tokens: ['security', 'secure', 'secrets', 'vault'],
  },
  {
    icon: FiSettings,
    exact: ['config', 'settings'],
    tokens: ['config', 'settings', 'setup'],
  },
  {
    icon: FiEdit3,
    exact: ['cms', 'editor'],
    tokens: ['cms', 'editor', 'content', 'blog'],
  },
  {
    icon: FiUsers,
    exact: ['users', 'accounts'],
    tokens: ['users', 'user', 'accounts', 'profile'],
  },
  {
    icon: FiFolder,
    exact: ['files', 'storage'],
    tokens: ['files', 'file', 'storage', 'drive', 'bucket'],
  },
  {
    icon: FiCode,
    exact: ['sdk', 'compiler'],
    tokens: ['sdk', 'compiler', 'transpiler', 'parser', 'codegen'],
  },
  {
    icon: FiTool,
    exact: ['tools', 'tooling'],
    tokens: ['tools', 'tooling', 'build', 'dev'],
  },
  {
    icon: FiLock,
    exact: ['private', 'internal'],
    tokens: ['private', 'internal', 'locked'],
  },
];

const ICON_POOL = Array.from(new Set([
  FiGlobe,
  FiServer,
  FiKey,
  FiDatabase,
  FiActivity,
  FiCpu,
  FiImage,
  FiFilm,
  FiMusic,
  FiSearch,
  FiMail,
  FiBell,
  FiCreditCard,
  FiShoppingCart,
  FiBookOpen,
  FiBarChart2,
  FiTerminal,
  FiMonitor,
  FiSmartphone,
  FiLayers,
  FiCloud,
  FiShield,
  FiSettings,
  FiEdit3,
  FiUsers,
  FiFolder,
  FiCode,
  FiTool,
  FiLock,
  FiPackage,
]));

const scoreRule = (rule, normalized, tokens) => {
  let score = 0;
  if (rule.exact.includes(normalized)) {
    score += 1000;
  }

  for (const token of tokens) {
    if (rule.tokens.includes(token)) {
      score += 100;
      continue;
    }

    if (rule.tokens.some((candidate) => candidate.includes(token) || token.includes(candidate))) {
      score += 20;
    }
  }

  return score;
};

const getRankedIcons = (serviceName) => {
  const normalized = normalizeServiceName(serviceName);
  if (!normalized) {
    return [FiPackage, ...ICON_POOL.filter((icon) => icon !== FiPackage)];
  }

  const tokens = tokenize(normalized);
  const scored = ICON_RULES.map((rule, index) => ({
    icon: rule.icon,
    score: scoreRule(rule, normalized, tokens),
    index,
  }));

  const bestScoresByIcon = new Map();
  for (const row of scored) {
    const current = bestScoresByIcon.get(row.icon);
    if (!current || row.score > current.score || (row.score === current.score && row.index < current.index)) {
      bestScoresByIcon.set(row.icon, { score: row.score, index: row.index });
    }
  }

  const ranked = Array.from(bestScoresByIcon.entries())
    .sort((left, right) => {
      if (left[1].score !== right[1].score) {
        return right[1].score - left[1].score;
      }
      return left[1].index - right[1].index;
    })
    .map(([icon]) => icon);

  const ordered = [];
  const seen = new Set();
  for (const icon of ranked) {
    if (!seen.has(icon)) {
      seen.add(icon);
      ordered.push(icon);
    }
  }
  for (const icon of ICON_POOL) {
    if (!seen.has(icon)) {
      seen.add(icon);
      ordered.push(icon);
    }
  }

  if (!ordered.includes(FiPackage)) {
    ordered.push(FiPackage);
  }

  return ordered;
};

const getMatchConfidence = (serviceName) => {
  const normalized = normalizeServiceName(serviceName);
  if (!normalized) {
    return 0;
  }
  const tokens = tokenize(normalized);
  const scores = ICON_RULES
    .map((rule) => scoreRule(rule, normalized, tokens))
    .sort((a, b) => b - a);
  const top = scores[0] || 0;
  const next = scores[1] || 0;
  return (top * 2) + (top - next);
};

export const findServiceIcon = (serviceName, { excludedIcons = [] } = {}) => {
  const excluded = new Set(excludedIcons);
  const rankedIcons = getRankedIcons(serviceName);
  for (const icon of rankedIcons) {
    if (!excluded.has(icon)) {
      return icon;
    }
  }
  return FiPackage;
};

export const getUniqueServiceIconMap = (serviceNames, { lockedIconsByService = {} } = {}) => {
  const uniqueServices = Array.from(new Set(
    (Array.isArray(serviceNames) ? serviceNames : [])
      .map((name) => normalizeServiceName(name))
      .filter(Boolean),
  ));
  if (uniqueServices.length === 0) {
    return {};
  }

  const locked = new Map();
  for (const [serviceName, icon] of Object.entries(lockedIconsByService || {})) {
    const normalized = normalizeServiceName(serviceName);
    if (!normalized || typeof icon !== 'function') {
      continue;
    }
    locked.set(normalized, icon);
  }

  const assigned = {};
  const usedIcons = new Set();

  for (const [serviceName, icon] of locked.entries()) {
    if (!uniqueServices.includes(serviceName)) {
      continue;
    }
    assigned[serviceName] = icon;
    usedIcons.add(icon);
  }

  const unlocked = uniqueServices
    .filter((serviceName) => !Object.prototype.hasOwnProperty.call(assigned, serviceName))
    .map((serviceName) => ({
      serviceName,
      rankedIcons: getRankedIcons(serviceName),
      confidence: getMatchConfidence(serviceName),
    }))
    .sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }
      return left.serviceName.localeCompare(right.serviceName);
    });

  for (const entry of unlocked) {
    const chosen = entry.rankedIcons.find((icon) => !usedIcons.has(icon)) || FiPackage;
    assigned[entry.serviceName] = chosen;
    usedIcons.add(chosen);
  }

  return assigned;
};
