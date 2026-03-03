'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setPanelProjectExplorerFollowMode,
  setPanelProjectExplorerMode,
  setPanelProjectListLayout,
  setPanelProjectListSelectedProject,
  setRuntimeConfig,
  setUserStyle,
  resolveClientThemePreference,
} from '../src/store';
import { graphqlRequest } from '../src/lib/graphqlClient';
import { findServiceIcon, getUniqueServiceIconMap } from '../src/lib/serviceIconFinder';
import { FiGlobe, FiKey, FiServer } from 'react-icons/fi';
import { FaNodeJs } from 'react-icons/fa6';
import { SiGo, SiTurborepo } from 'react-icons/si';
import ThemeDropdown from '../src/components/ThemeDropdown';

const QUERY_RUNTIME_CONFIG = `
  query RuntimeConfig {
    runtimeConfig {
      appUrl
      graphqlEndpoint
      wsEndpoint
    }
  }
`;

const QUERY_DISCOVERY_DASHBOARD = `
  query DiscoveryDashboard {
    discoveryConfig {
      projectPath
      folderPattern
      maxDepth
    }
    discoveredProjects {
      scannedAt
      projects {
        name
        path
        relativePath
        services
        types
        hasMakefile
        declaredServices {
          name
          path
          relativePath
          language
          hasPackageJson
          hasMakefile
          packageScripts {
            name
            command
          }
          makeTargets
          envVarNames
          envFiles {
            file
            entries {
              key
              value
            }
          }
          effectiveEnvVarMap {
            key
            value
          }
        }
        runtimeStatus
        runtimePid
        runtimePorts
        runtimePortRangeBegin
        runtimePortRangeEnd
        runtimeServicePorts {
          main
          graphql
          api
          admin
        }
        runtimeServicePids {
          main
          graphql
          api
          admin
        }
        runtimeServiceStates {
          main
          graphql
          api
          admin
        }
        runtimeServiceEntries {
          key
          serviceName
          pid
          port
          state
        }
        runtimeLastExitCode
      }
    }
  }
`;

const QUERY_PROJECT_LOGS = `
  query ProjectLogs($projectPath: String!, $limit: Int, $afterId: Int, $serviceNames: [String!]) {
    projectLogs(projectPath: $projectPath, limit: $limit, afterId: $afterId, serviceNames: $serviceNames) {
      id
      timestamp
      serviceName
      stream
      message
    }
  }
`;

const QUERY_PROJECT_ENVIRONMENT = `
  query ProjectLaunchEnvironment($projectPath: String!) {
    projectLaunchEnvironment(projectPath: $projectPath) {
      key
      value
    }
  }
`;

const QUERY_PROJECT_PORT_RANGE_SETTINGS = `
  query ProjectPortRangeSettings($projectPath: String!) {
    projectPortRangeSettings(projectPath: $projectPath) {
      mode
      begin
    }
  }
`;

const QUERY_PROJECT_PROCESS_STATS = `
  query ProjectProcessStats($projectPath: String!) {
    projectProcessStats(projectPath: $projectPath) {
      serviceId
      serviceName
      serviceKey
      pid
      cpuPercent
      memoryPercent
      rssMb
      virtualMb
      elapsed
      command
      status
    }
  }
`;

const MUTATION_TOGGLE_PROJECT_RUNTIME = `
  mutation ToggleProjectRuntime($projectPath: String!, $projectTypes: [String!]) {
    toggleProjectRuntime(projectPath: $projectPath, projectTypes: $projectTypes) {
      projectPath
      status
      pid
      startedAt
      stoppedAt
      lastExitCode
    }
  }
`;

const MUTATION_TOGGLE_SERVICE_RUNTIME = `
  mutation ToggleServiceRuntime($projectPath: String!, $serviceKey: String!) {
    toggleServiceRuntime(projectPath: $projectPath, serviceKey: $serviceKey) {
      projectPath
      status
      pid
      servicePids {
        main
        graphql
        api
        admin
      }
      serviceStates {
        main
        graphql
        api
        admin
      }
    }
  }
`;

const MUTATION_SET_PROJECT_PORT_RANGE_SETTINGS = `
  mutation SetProjectPortRangeSettings($projectPath: String!, $mode: PortRangeMode!, $begin: Int) {
    setProjectPortRangeSettings(projectPath: $projectPath, mode: $mode, begin: $begin) {
      mode
      begin
    }
  }
`;

const clampWidth = (value) => Math.max(20, Math.min(80, Math.round(value)));
const PORT_RANGE_MODE = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
};
const PORT_RANGE_BEGIN_MIN = 1;
const PORT_RANGE_BEGIN_MAX = 64991;

const getDefaultWsEndpoint = () => {
  const configuredServerPort = Number.parseInt(
    String(process.env.NEXT_PUBLIC_SERVER_PORT || '').trim(),
    10,
  );
  const hasConfiguredServerPort = Number.isInteger(configuredServerPort) && configuredServerPort > 0;
  const fallbackPort = hasConfiguredServerPort ? configuredServerPort : 4000;

  if (typeof window === 'undefined') {
    return `ws://localhost:${fallbackPort}/ws`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const hostName = window.location.hostname;
  if (hasConfiguredServerPort) {
    return `${protocol}://${hostName}:${configuredServerPort}/ws`;
  }
  return `${protocol}://${window.location.host}/ws`;
};

const normalizeRuntimeConfig = (runtimeConfig) => ({
  appUrl: runtimeConfig?.appUrl || '',
  graphqlEndpoint: runtimeConfig?.graphqlEndpoint || '/graphql',
  wsEndpoint: runtimeConfig?.wsEndpoint || getDefaultWsEndpoint(),
});

const normalizePortRangeSettings = (settings) => {
  const mode = String(settings?.mode || '').trim().toUpperCase() === PORT_RANGE_MODE.MANUAL
    ? PORT_RANGE_MODE.MANUAL
    : PORT_RANGE_MODE.AUTOMATIC;
  const begin = Number(settings?.begin);
  const normalizedBegin = (
    Number.isInteger(begin) &&
    begin >= PORT_RANGE_BEGIN_MIN &&
    begin <= PORT_RANGE_BEGIN_MAX
  )
    ? begin
    : null;
  if (mode === PORT_RANGE_MODE.MANUAL) {
    return { mode, begin: normalizedBegin };
  }
  return { mode: PORT_RANGE_MODE.AUTOMATIC, begin: null };
};

const ASCII_ESCAPE_PATTERN = /\\x([0-9A-Fa-f]{2})|\\u([0-9A-Fa-f]{4})|\\([nrtbfv\\])/g;
const ANSI_OSC_PATTERN = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
const ANSI_CSI_PATTERN = /\u001B\[([0-?]*)([ -/]*)([@-~])/g;
const XTERM_COLOR_STEPS = [0, 95, 135, 175, 215, 255];
const ANSI_16_COLOR_MAP = {
  30: '#000000',
  31: '#cd3131',
  32: '#00bc00',
  33: '#949800',
  34: '#0451a5',
  35: '#bc05bc',
  36: '#0598bc',
  37: '#cccccc',
  90: '#767676',
  91: '#f14c4c',
  92: '#23d18b',
  93: '#f5f543',
  94: '#3b8eea',
  95: '#d670d6',
  96: '#29b8db',
  97: '#f2f2f2',
};

const decodeAsciiEscapes = (value) => String(value || '').replace(
  ASCII_ESCAPE_PATTERN,
  (_, hexByte, hexWord, shortEscape) => {
    if (hexByte) {
      return String.fromCharCode(Number.parseInt(hexByte, 16));
    }
    if (hexWord) {
      return String.fromCharCode(Number.parseInt(hexWord, 16));
    }

    const shortMap = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      '\\': '\\',
    };
    return shortMap[shortEscape] || '';
  },
);

const stripNonDisplayControlChars = (value) =>
  String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

const toHexByte = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 255) {
    return '00';
  }
  return Math.round(n).toString(16).padStart(2, '0');
};

const xterm256ToHex = (index) => {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    return null;
  }

  const baseColors = [
    '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
    '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
  ];
  if (n < 16) {
    return baseColors[n];
  }

  if (n >= 16 && n <= 231) {
    const offset = n - 16;
    const r = XTERM_COLOR_STEPS[Math.floor(offset / 36)];
    const g = XTERM_COLOR_STEPS[Math.floor((offset % 36) / 6)];
    const b = XTERM_COLOR_STEPS[offset % 6];
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
  }

  const gray = 8 + ((n - 232) * 10);
  return `#${toHexByte(gray)}${toHexByte(gray)}${toHexByte(gray)}`;
};

const applyAnsiColorCodes = (input) => {
  const decoded = decodeAsciiEscapes(input).replace(ANSI_OSC_PATTERN, '');
  const segments = [];
  let currentColor = null;
  let cursor = 0;
  let match = ANSI_CSI_PATTERN.exec(decoded);

  while (match) {
    const [raw, paramsRaw, , finalChar] = match;
    const start = match.index;

    if (start > cursor) {
      const text = stripNonDisplayControlChars(decoded.slice(cursor, start));
      if (text) {
        segments.push({
          text,
          color: currentColor,
        });
      }
    }

    if (finalChar === 'm') {
      const codes = String(paramsRaw || '').length > 0
        ? String(paramsRaw).split(';').map((part) => Number.parseInt(part, 10))
        : [0];
      for (let index = 0; index < codes.length; index += 1) {
        const code = codes[index];
        if (!Number.isInteger(code)) {
          continue;
        }
        if (code === 0 || code === 39) {
          currentColor = null;
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(ANSI_16_COLOR_MAP, code)) {
          currentColor = ANSI_16_COLOR_MAP[code];
          continue;
        }
        if (code === 38) {
          const mode = codes[index + 1];
          if (mode === 5 && Number.isInteger(codes[index + 2])) {
            const mapped = xterm256ToHex(codes[index + 2]);
            if (mapped) {
              currentColor = mapped;
            }
            index += 2;
            continue;
          }
          if (
            mode === 2 &&
            Number.isInteger(codes[index + 2]) &&
            Number.isInteger(codes[index + 3]) &&
            Number.isInteger(codes[index + 4])
          ) {
            const r = Math.max(0, Math.min(255, codes[index + 2]));
            const g = Math.max(0, Math.min(255, codes[index + 3]));
            const b = Math.max(0, Math.min(255, codes[index + 4]));
            currentColor = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
            index += 4;
          }
        }
      }
    }

    cursor = start + raw.length;
    match = ANSI_CSI_PATTERN.exec(decoded);
  }

  if (cursor < decoded.length) {
    const tail = stripNonDisplayControlChars(decoded.slice(cursor));
    if (tail) {
      segments.push({
        text: tail,
        color: currentColor,
      });
    }
  }

  return segments;
};

const tryFormatJsonPayload = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }
  const parseObjectLikeJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  };

  const wholeLine = parseObjectLikeJson(trimmed);
  if (wholeLine) {
    return wholeLine;
  }

  const openCurly = trimmed.indexOf('{');
  const openSquare = trimmed.indexOf('[');
  const starts = [openCurly, openSquare]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  for (const start of starts) {
    const opener = trimmed[start];
    const closer = opener === '{' ? '}' : ']';
    for (let end = trimmed.length; end > start; end -= 1) {
      if (trimmed[end - 1] !== closer) {
        continue;
      }
      const candidate = trimmed.slice(start, end).trim();
      const formatted = parseObjectLikeJson(candidate);
      if (formatted) {
        return formatted;
      }
    }
  }

  return null;
};

const extractHueFromColor = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const hexMatch = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const normalized = hexMatch[1].length === 3
      ? hexMatch[1].split('').map((char) => `${char}${char}`).join('')
      : hexMatch[1];
    const r = Number.parseInt(normalized.slice(0, 2), 16);
    const g = Number.parseInt(normalized.slice(2, 4), 16);
    const b = Number.parseInt(normalized.slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (delta === 0) {
      return 0;
    }
    let hue;
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = ((b - r) / delta) + 2;
    } else {
      hue = ((r - g) / delta) + 4;
    }
    return (Math.round(hue * 60) + 360) % 360;
  }

  const hslMatch = raw.match(/^hsla?\(([-+]?[0-9]*\.?[0-9]+)(?:deg)?[,\s]/i);
  if (hslMatch) {
    const parsed = Number.parseFloat(hslMatch[1]);
    if (Number.isFinite(parsed)) {
      return ((parsed % 360) + 360) % 360;
    }
  }

  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      const [r, g, b] = parts;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta === 0) {
        return 0;
      }
      let hue;
      if (max === r) {
        hue = ((g - b) / delta) % 6;
      } else if (max === g) {
        hue = ((b - r) / delta) + 2;
      } else {
        hue = ((r - g) / delta) + 4;
      }
      return (Math.round(hue * 60) + 360) % 360;
    }
  }

  return null;
};

const getServiceColorMap = (serviceNames, primaryHue) => {
  const uniqueNames = Array.from(new Set((serviceNames || []).filter(Boolean)));
  if (uniqueNames.length === 0) {
    return {};
  }

  const baseHue = Number.isFinite(primaryHue) ? primaryHue : 180;
  const step = 360 / (uniqueNames.length + 1);
  return Object.fromEntries(
    uniqueNames.map((serviceName, index) => {
      const hue = Math.round((baseHue + ((index + 1) * step)) % 360);
      return [serviceName, `hsl(${hue} 72% 52%)`];
    }),
  );
};

const formatLogLine = (entry, { serviceTagColor = null, serviceIcon = null } = {}) => {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();
  const segments = applyAnsiColorCodes(entry.message);
  const plainMessage = segments.map((segment) => segment.text).join('');
  const formattedJson = tryFormatJsonPayload(plainMessage);
  const rawServiceName = String(entry.serviceName || '').trim();
  const ServiceChipIcon = serviceIcon || findServiceIcon(rawServiceName);
  const serviceChipRowStyle = {
    ...(serviceTagColor ? { color: serviceTagColor } : {}),
  };
  return (
    <>
      <span className="logTimestampCol">
        <span className="logTimestamp">{timestamp}</span>
      </span>
      <span className="logServiceCol">
        <span className="logServiceChipRow" style={serviceChipRowStyle}>
          <span className="logServiceTag">{rawServiceName}</span>
          <ServiceChipIcon className="logServiceTagIcon" aria-hidden />
        </span>
      </span>
      <span className="logMessageCol">
        <span className="logMessage">
          {formattedJson ? (
            <span className="logJsonPayload">{formattedJson}</span>
          ) : (
            segments.map((segment, index) => (
              <span
                key={`${entry.id || entry.timestamp || 'log'}-${index}`}
                style={segment.color ? { color: segment.color } : undefined}
              >
                {segment.text}
              </span>
            ))
          )}
        </span>
      </span>
    </>
  );
};

const PROJECT_TYPE_ICONS = {
  node: {
    label: 'Node.js project',
    icon: FaNodeJs,
    className: 'node',
    isActive: (types) => types.includes('node-project'),
  },
  go: {
    label: 'Golang project',
    icon: SiGo,
    className: 'go',
    isActive: (types) => types.includes('go-project'),
  },
  monorepo: {
    label: 'Monorepo',
    icon: SiTurborepo,
    className: 'mono',
    isActive: (types) => types.includes('node-monorepo') || types.includes('go-monorepo'),
  },
};

const ORDERED_TYPE_ICON_KEYS = ['node', 'go', 'monorepo'];

const ORDERED_SERVICE_KEYS = ['main', 'graphql', 'api', 'admin'];
const CONTROL_ADJACENT_SERVICE_KEYS = ['admin', 'api', 'main'];

const SERVICE_ICON_DEFS = {
  main: { label: 'Main', icon: FiGlobe, className: 'main' },
  api: { label: 'API', icon: FiServer, className: 'api' },
  admin: { label: 'Admin', icon: FiKey, className: 'admin' },
};

const normalizeServiceKey = (value) => String(value || '').trim().toLowerCase();

const toCanonicalServiceIconKey = (value) => {
  const normalized = normalizeServiceKey(value);
  if (!normalized) {
    return '';
  }
  if (normalized === 'web' || normalized === 'interface' || normalized === 'main') {
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

const buildLockedServiceIcons = (serviceKeys) =>
  Object.fromEntries(
    Object.entries(SERVICE_ICON_DEFS)
      .filter(([serviceName]) => serviceKeys.includes(serviceName))
      .map(([serviceName, iconDef]) => [serviceName, iconDef.icon]),
  );

const buildUniqueIconsForServices = (serviceKeys) =>
  getUniqueServiceIconMap(serviceKeys, {
    lockedIconsByService: buildLockedServiceIcons(serviceKeys),
  });

const formatServiceLabel = (serviceKey) => {
  const normalized = normalizeServiceKey(serviceKey);
  if (!normalized) {
    return 'Package';
  }
  if (normalized === 'api') {
    return 'API';
  }
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const getDiscoveredServiceKeys = (services) => {
  const uniqueKeys = Array.from(
    new Set((Array.isArray(services) ? services : []).map((serviceKey) => normalizeServiceKey(serviceKey)).filter(Boolean)),
  );

  const orderedKeys = uniqueKeys.sort((left, right) => {
    const leftIndex = ORDERED_SERVICE_KEYS.indexOf(left);
    const rightIndex = ORDERED_SERVICE_KEYS.indexOf(right);
    const leftRank = leftIndex >= 0 ? leftIndex : ORDERED_SERVICE_KEYS.length + 1;
    const rightRank = rightIndex >= 0 ? rightIndex : ORDERED_SERVICE_KEYS.length + 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.localeCompare(right);
  });

  const pinnedControlAdjacentKeys = CONTROL_ADJACENT_SERVICE_KEYS
    .filter((key) => orderedKeys.includes(key));
  const nonPinnedKeys = orderedKeys
    .filter((key) => !CONTROL_ADJACENT_SERVICE_KEYS.includes(key));

  return [...nonPinnedKeys, ...pinnedControlAdjacentKeys];
};

const getDefaultDebugExpandedPaths = (selectedProject = null) => {
  const expanded = new Set([
    '',
    'name',
    'path',
    'relativePath',
    'runtimeStatus',
    'runtimePid',
    'runtimePorts',
    'runtimeServicePorts',
    'runtimeServicePids',
    'runtimeServiceStates',
    'runtimeLastExitCode',
    'stack',
    'enabledServices',
    'hasMakefile',
    'declaredServices',
  ]);

  const declaredCount = Array.isArray(selectedProject?.declaredServices)
    ? selectedProject.declaredServices.length
    : 0;

  for (let index = 0; index < declaredCount; index += 1) {
    expanded.add(`declaredServices.${index}`);
  }

  return expanded;
};

const isTreeExpandable = (value) => Boolean(value) && typeof value === 'object';

function DebugTreeNode({ name, value, path, expandedPaths, togglePath }) {
  const expandable = isTreeExpandable(value);
  const isExpanded = expandable ? expandedPaths.has(path) : false;
  const isArray = Array.isArray(value);
  const entries = expandable
    ? (isArray ? value.map((item, index) => [String(index), item]) : Object.entries(value))
    : [];

  const summary = isArray ? `Array(${value.length})` : `Object(${entries.length})`;

  return (
    <div className="debugNode">
      <div className="debugNodeRow">
        {expandable ? (
          <button
            type="button"
            className="debugToggle"
            onClick={() => togglePath(path)}
            aria-label={isExpanded ? `Collapse ${name}` : `Expand ${name}`}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="debugSpacer" />
        )}
        <span className="debugKey">{name}</span>
        <span className="debugColon">:</span>
        {expandable ? (
          <span className="debugMeta">{summary}</span>
        ) : (
          <span className="debugValue">{JSON.stringify(value)}</span>
        )}
      </div>
      {expandable && isExpanded ? (
        <div className="debugChildren">
          {entries.map(([childKey, childValue]) => {
            const childPath = path ? `${path}.${childKey}` : childKey;
            return (
              <DebugTreeNode
                key={childPath}
                name={childKey}
                value={childValue}
                path={childPath}
                expandedPaths={expandedPaths}
                togglePath={togglePath}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function HomePage() {
  const dispatch = useDispatch();
  const runtimeConfig = useSelector((state) => state.runtime.config);
  const leftWidthPct = useSelector((state) => state.panelProjectList.leftWidthPct);
  const selectedProjectPath = useSelector((state) => state.panelProjectList.selectedProjectPath);
  const rightTab = useSelector((state) => state.panelProjectExplorer.mode);
  const followLogs = useSelector((state) => state.panelProjectExplorer.isFollowMode);
  const editorTheme = useSelector((state) => state.userSettings.style);

  const graphqlEndpoint = runtimeConfig?.graphqlEndpoint || '/graphql';
  const wsEndpoint = runtimeConfig?.wsEndpoint || getDefaultWsEndpoint();

  const [projects, setProjects] = useState([]);
  const [scannedAt, setScannedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [projectLogs, setProjectLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [projectEnvironment, setProjectEnvironment] = useState([]);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [projectPortRangeSettings, setProjectPortRangeSettings] = useState(() => normalizePortRangeSettings(null));
  const [projectPortRangeSettingsLoading, setProjectPortRangeSettingsLoading] = useState(false);
  const [projectPortRangeSettingsSaving, setProjectPortRangeSettingsSaving] = useState(false);
  const [manualPortRangeInput, setManualPortRangeInput] = useState('');
  const [projectProcessStats, setProjectProcessStats] = useState([]);
  const [processStatsLoading, setProcessStatsLoading] = useState(false);
  const [selectedLogServices, setSelectedLogServices] = useState([]);
  const [seenLogServicesByProject, setSeenLogServicesByProject] = useState({});
  const [resizing, setResizing] = useState(false);
  const [debugExpandedPaths, setDebugExpandedPaths] = useState(() => getDefaultDebugExpandedPaths(null));

  const workspaceRef = useRef(null);
  const logEndRef = useRef(null);
  const logStreamRef = useRef(null);
  const resizingRef = useRef(false);
  const wsRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  const wsRetryCountRef = useRef(0);
  const projectLogsRef = useRef([]);
  const selectedLogServicesRef = useRef(selectedLogServices);
  const isProgrammaticLogScrollRef = useRef(false);

  const scrollLogsToEnd = useCallback((behavior = 'auto') => {
    const container = logStreamRef.current;
    if (!container) {
      return;
    }
    isProgrammaticLogScrollRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });

    window.setTimeout(() => {
      isProgrammaticLogScrollRef.current = false;
    }, behavior === 'smooth' ? 280 : 0);
  }, []);

  useEffect(() => {
    const preferredTheme = resolveClientThemePreference();
    if (preferredTheme && preferredTheme !== editorTheme) {
      dispatch(setUserStyle(preferredTheme));
    }
  }, [dispatch, editorTheme]);

  const bootstrapRuntimeVariables = useCallback(async () => {
    const data = await graphqlRequest({
      query: QUERY_RUNTIME_CONFIG,
      endpoint: '/graphql',
    });

    const normalized = normalizeRuntimeConfig(data?.runtimeConfig);
    dispatch(setRuntimeConfig({ config: normalized }));
    return normalized;
  }, [dispatch]);

  const loadDashboard = useCallback(async (endpoint) => {
    setLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_DISCOVERY_DASHBOARD,
        endpoint: endpoint || '/graphql',
      });

      const discovered = data?.discoveredProjects || {};

      setProjects(discovered.projects || []);
      setScannedAt(discovered.scannedAt || '');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjectLogs = useCallback(async ({
    projectPath,
    fullRefresh = false,
    serviceNames,
  } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectLogs([]);
      return;
    }

    if (fullRefresh) {
      setLogsLoading(true);
    }

    try {
      const requestedServiceNames = Array.isArray(serviceNames)
        ? serviceNames
        : selectedLogServicesRef.current;
      const variables = {
        projectPath: targetProjectPath,
        limit: fullRefresh ? 600 : 200,
        afterId: fullRefresh ? null : (projectLogsRef.current[projectLogsRef.current.length - 1]?.id || null),
        serviceNames: requestedServiceNames.length > 0 ? requestedServiceNames : null,
      };

      const data = await graphqlRequest({
        query: QUERY_PROJECT_LOGS,
        variables,
        endpoint: graphqlEndpoint,
      });

      const entries = data?.projectLogs || [];

      if (fullRefresh) {
        setProjectLogs(entries);
      } else if (entries.length > 0) {
        setProjectLogs((current) => {
          const seen = new Set(current.map((entry) => entry.id));
          const next = current.slice();
          for (const entry of entries) {
            if (!seen.has(entry.id)) {
              next.push(entry);
              seen.add(entry.id);
            }
          }
          return next;
        });
      }
    } catch (logError) {
      if (fullRefresh) {
        setError(logError.message || 'Unable to load project logs');
      }
    } finally {
      if (fullRefresh) {
        setLogsLoading(false);
      }
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  const loadProjectEnvironment = useCallback(async ({ projectPath } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectEnvironment([]);
      return;
    }

    setEnvironmentLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_PROJECT_ENVIRONMENT,
        variables: { projectPath: targetProjectPath },
        endpoint: graphqlEndpoint,
      });
      setProjectEnvironment(data?.projectLaunchEnvironment || []);
    } catch (envError) {
      setError(envError.message || 'Unable to load launch environment');
    } finally {
      setEnvironmentLoading(false);
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  const loadProjectPortRangeSettings = useCallback(async ({ projectPath } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectPortRangeSettings(normalizePortRangeSettings(null));
      setManualPortRangeInput('');
      return;
    }

    setProjectPortRangeSettingsLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_PROJECT_PORT_RANGE_SETTINGS,
        variables: { projectPath: targetProjectPath },
        endpoint: graphqlEndpoint,
      });
      const normalized = normalizePortRangeSettings(data?.projectPortRangeSettings);
      setProjectPortRangeSettings(normalized);
      setManualPortRangeInput(normalized.begin != null ? String(normalized.begin) : '');
    } catch (settingsError) {
      setError(settingsError.message || 'Unable to load project port range settings');
    } finally {
      setProjectPortRangeSettingsLoading(false);
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  const loadProjectProcessStats = useCallback(async ({
    projectPath,
    background = false,
  } = {}) => {
    const targetProjectPath = projectPath || selectedProjectPath;
    if (!targetProjectPath) {
      setProjectProcessStats([]);
      return;
    }

    if (!background) {
      setProcessStatsLoading(true);
    }

    try {
      const data = await graphqlRequest({
        query: QUERY_PROJECT_PROCESS_STATS,
        variables: { projectPath: targetProjectPath },
        endpoint: graphqlEndpoint,
      });
      setProjectProcessStats(data?.projectProcessStats || []);
    } catch (statsError) {
      if (!background) {
        setError(statsError.message || 'Unable to load process statistics');
      }
    } finally {
      if (!background) {
        setProcessStatsLoading(false);
      }
    }
  }, [graphqlEndpoint, selectedProjectPath]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setError('');
      try {
        const runtime = await bootstrapRuntimeVariables();
        if (!active) return;

        await loadDashboard(runtime.graphqlEndpoint || '/graphql');
      } catch (scanError) {
        if (!active) return;
        setError(scanError.message || 'Unable to load dashboard');
      }
    };

    run();

    return () => {
      active = false;
    };
  }, [bootstrapRuntimeVariables, loadDashboard]);

  useEffect(() => {
    if (!selectedProjectPath && projects.length > 0) {
      dispatch(setPanelProjectListSelectedProject(projects[0].path));
      return;
    }

    if (selectedProjectPath && !projects.some((project) => project.path === selectedProjectPath)) {
      dispatch(setPanelProjectListSelectedProject(projects[0]?.path || ''));
    }
  }, [dispatch, projects, selectedProjectPath]);

  useEffect(() => {
    if (!wsEndpoint) {
      return undefined;
    }

    let cancelled = false;

    const resolvedEndpoint = wsEndpoint.startsWith('/')
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${wsEndpoint}`
      : wsEndpoint;

    const clearReconnectTimer = () => {
      if (wsReconnectTimerRef.current) {
        window.clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) {
        return;
      }

      clearReconnectTimer();
      const retry = wsRetryCountRef.current;
      const delayMs = Math.min(10000, 750 * (retry + 1));
      wsReconnectTimerRef.current = window.setTimeout(() => {
        connectSocket();
      }, delayMs);
      wsRetryCountRef.current = retry + 1;
    };

    const connectSocket = () => {
      if (cancelled) {
        return;
      }

      clearReconnectTimer();

      const socket = new WebSocket(resolvedEndpoint);
      wsRef.current = socket;

      socket.onopen = () => {
        wsRetryCountRef.current = 0;
        setError((current) =>
          current === 'Websocket disconnected; reconnecting...' ? '' : current,
        );
        // Reconcile any runtime transitions missed while disconnected.
        loadDashboard(graphqlEndpoint).catch(() => {});
      };

      socket.onmessage = (event) => {
        let payload = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (!payload || typeof payload !== 'object') {
          return;
        }

        if (payload.type === 'runtime' && payload.runtime?.projectPath) {
          const update = payload.runtime;
          setProjects((current) =>
            current.map((project) =>
              project.path === update.projectPath
                ? {
                  ...project,
                  runtimeStatus: update.status,
                  runtimePid: update.pid,
                  runtimePorts: update.ports || [],
                  runtimePortRangeBegin: update.portRangeBegin ?? null,
                  runtimePortRangeEnd: update.portRangeEnd ?? null,
                  runtimeServicePorts: update.servicePorts || {},
                  runtimeServicePids: update.servicePids || {},
                  runtimeServiceStates: update.serviceStates || {},
                  runtimeServiceEntries: update.serviceRuntimeEntries || [],
                  runtimeLastExitCode: update.lastExitCode ?? null,
                }
              : project,
          ),
        );
          return;
        }
      };

      socket.onerror = () => {
        setError((current) => current || 'Websocket disconnected; reconnecting...');
      };

      socket.onclose = () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        scheduleReconnect();
      };
    };

    connectSocket();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      wsRetryCountRef.current = 0;
    };
  }, [graphqlEndpoint, loadDashboard, wsEndpoint]);

  useEffect(() => {
    if (rightTab !== 'logs' || !followLogs) {
      return;
    }
    scrollLogsToEnd('auto');
  }, [followLogs, projectLogs, rightTab, scrollLogsToEnd]);

  useEffect(() => {
    projectLogsRef.current = projectLogs;
  }, [projectLogs]);

  useEffect(() => {
    if (!selectedProjectPath || projectLogs.length === 0) {
      return;
    }

    const discoveredNames = projectLogs
      .map((entry) => String(entry?.serviceName || '').trim())
      .filter(Boolean);
    if (discoveredNames.length === 0) {
      return;
    }

    setSeenLogServicesByProject((current) => {
      const previous = current[selectedProjectPath] || [];
      const next = Array.from(new Set([...previous, ...discoveredNames]));
      if (next.length === previous.length && next.every((value, index) => value === previous[index])) {
        return current;
      }
      return {
        ...current,
        [selectedProjectPath]: next,
      };
    });
  }, [projectLogs, selectedProjectPath]);

  useEffect(() => {
    selectedLogServicesRef.current = selectedLogServices;
  }, [selectedLogServices]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!runtimeConfig) return;
    window.__RUNTIME_CONFIG__ = runtimeConfig;
  }, [runtimeConfig]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!resizingRef.current || !workspaceRef.current) {
        return;
      }

      const rect = workspaceRef.current.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const ratio = ((event.clientX - rect.left) / rect.width) * 100;
      dispatch(setPanelProjectListLayout({ leftWidthPct: clampWidth(ratio) }));
    };

    const handleMouseUp = () => {
      if (!resizingRef.current) {
        return;
      }

      resizingRef.current = false;
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dispatch]);

  const startResize = (event) => {
    event.preventDefault();
    resizingRef.current = true;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onRefresh = async () => {
    setError('');
    try {
      await loadDashboard(graphqlEndpoint);
    } catch (refreshError) {
      setError(refreshError.message || 'Unable to refresh projects');
    }
  };

  const onToggleRuntime = async (project, event) => {
    event.stopPropagation();
    setError('');
    dispatch(setPanelProjectListSelectedProject(project.path));

    await loadProjectLogs({
      projectPath: project.path,
      fullRefresh: true,
    });

    try {
      await graphqlRequest({
        query: MUTATION_TOGGLE_PROJECT_RUNTIME,
        variables: {
          projectPath: project.path,
          projectTypes: project.types,
        },
        endpoint: graphqlEndpoint,
      });

      await loadDashboard(graphqlEndpoint);
      await loadProjectEnvironment({ projectPath: project.path });

      await loadProjectLogs({
        projectPath: project.path,
        fullRefresh: true,
      });
    } catch (toggleError) {
      setError(toggleError.message || 'Unable to toggle project runtime');
    }
  };

  const runningCount = useMemo(
    () => projects.filter((project) => ['starting', 'started'].includes(project.runtimeStatus)).length,
    [projects],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.path === selectedProjectPath) || null,
    [projects, selectedProjectPath],
  );
  const selectedProjectServiceKeys = useMemo(
    () => getDiscoveredServiceKeys(selectedProject?.services || []),
    [selectedProject],
  );
  const logServiceOptions = useMemo(() => {
    if (!selectedProjectPath) {
      return [];
    }
    return (seenLogServicesByProject[selectedProjectPath] || [])
      .map((serviceName) => String(serviceName || '').trim())
      .filter(Boolean);
  }, [seenLogServicesByProject, selectedProjectPath]);
  const logServiceColorMap = useMemo(() => {
    const visibleServiceNames = projectLogs
      .map((entry) => String(entry?.serviceName || '').trim())
      .filter(Boolean);
    const seedNames = visibleServiceNames.length > 0
      ? visibleServiceNames
      : logServiceOptions.map((name) => String(name || '').trim()).filter(Boolean);
    const primaryHue = typeof window === 'undefined'
      ? 180
      : extractHueFromColor(
        window.getComputedStyle(document.documentElement).getPropertyValue('--accent'),
      );
    return getServiceColorMap(seedNames, primaryHue);
  }, [editorTheme, logServiceOptions, projectLogs]);
  const logServiceIconMap = useMemo(() => {
    const canonicalVisibleNames = projectLogs
      .map((entry) => toCanonicalServiceIconKey(entry?.serviceName))
      .filter(Boolean);
    const canonicalLogOptionNames = logServiceOptions
      .map((serviceName) => toCanonicalServiceIconKey(serviceName))
      .filter(Boolean);
    const seedNames = Array.from(new Set([
      ...selectedProjectServiceKeys,
      ...canonicalLogOptionNames,
      ...canonicalVisibleNames,
    ]));
    return buildUniqueIconsForServices(seedNames);
  }, [logServiceOptions, projectLogs, selectedProjectServiceKeys]);
  const debugData = useMemo(
    () =>
      selectedProject
        ? {
          name: selectedProject.name,
          path: selectedProject.path,
          relativePath: selectedProject.relativePath,
          runtimeStatus: selectedProject.runtimeStatus,
          runtimePid: selectedProject.runtimePid,
          runtimePorts: selectedProject.runtimePorts || [],
          runtimePortRangeBegin: selectedProject.runtimePortRangeBegin ?? null,
          runtimePortRangeEnd: selectedProject.runtimePortRangeEnd ?? null,
          runtimeServicePorts: selectedProject.runtimeServicePorts || {},
          runtimeServicePids: selectedProject.runtimeServicePids || {},
          runtimeServiceStates: selectedProject.runtimeServiceStates || {},
          runtimeServiceEntries: selectedProject.runtimeServiceEntries || [],
          runtimeLastExitCode: selectedProject.runtimeLastExitCode ?? null,
          stack: selectedProject.types || [],
          enabledServices: selectedProject.services || [],
          hasMakefile: Boolean(selectedProject.hasMakefile),
          declaredServices: (selectedProject.declaredServices || []).map((service) => ({
            ...service,
            effectiveEnvVarMap: Object.fromEntries(
              (service.effectiveEnvVarMap || []).map((entry) => [entry.key, entry.value]),
            ),
          })),
        }
        : null,
    [selectedProject],
  );

  useEffect(() => {
    setDebugExpandedPaths(getDefaultDebugExpandedPaths(selectedProject));
  }, [selectedProject]);

  useEffect(() => {
    setSelectedLogServices([]);
    setProjectLogs([]);
    setProjectEnvironment([]);
    setProjectPortRangeSettings(normalizePortRangeSettings(null));
    setManualPortRangeInput('');
    setProjectProcessStats([]);
    dispatch(setPanelProjectExplorerFollowMode(true));
  }, [dispatch, selectedProjectPath]);

  useEffect(() => {
    if (!selectedProjectPath) {
      return;
    }
    loadProjectLogs({
      projectPath: selectedProjectPath,
      fullRefresh: true,
      serviceNames: selectedLogServices,
    });
  }, [loadProjectLogs, selectedProjectPath, selectedLogServices]);

  useEffect(() => {
    if (!selectedProjectPath || rightTab !== 'logs') {
      return undefined;
    }

    const interval = window.setInterval(() => {
      loadProjectLogs({
        projectPath: selectedProjectPath,
        fullRefresh: false,
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [loadProjectLogs, rightTab, selectedProjectPath]);

  useEffect(() => {
    if (!selectedProjectPath || rightTab !== 'environment') {
      return;
    }
    loadProjectEnvironment({
      projectPath: selectedProjectPath,
    });
    loadProjectPortRangeSettings({
      projectPath: selectedProjectPath,
    });
  }, [loadProjectEnvironment, loadProjectPortRangeSettings, rightTab, selectedProjectPath]);

  useEffect(() => {
    if (!selectedProjectPath || rightTab !== 'top') {
      return undefined;
    }

    loadProjectProcessStats({
      projectPath: selectedProjectPath,
      background: false,
    });

    const interval = window.setInterval(() => {
      loadProjectProcessStats({
        projectPath: selectedProjectPath,
        background: true,
      });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [loadProjectProcessStats, rightTab, selectedProjectPath]);

  const getServiceState = ({ serviceStatus, isEnabled }) => {
    if (!isEnabled) {
      return 'unused';
    }
    if (serviceStatus === 'starting') {
      return 'starting';
    }
    if (serviceStatus === 'started') {
      return 'online';
    }
    if (serviceStatus === 'crashed') {
      return 'offline';
    }
    return 'disabled';
  };
  const getAllServicesState = (project) => {
    const enabledKeys = getDiscoveredServiceKeys(project.services);

    if (enabledKeys.length === 0) {
      return {
        serviceState: 'unused',
        runtimeState: 'stopped',
        enabled: false,
      };
    }

    const runtimeEntryByKey = new Map(
      (project.runtimeServiceEntries || [])
        .map((entry) => ({
          key: normalizeServiceKey(entry?.key),
          pid: Number(entry?.pid),
          state: String(entry?.state || 'stopped').toLowerCase(),
        }))
        .filter((entry) => entry.key)
        .map((entry) => [entry.key, entry]),
    );

    const hasStartingWithPid = enabledKeys.some((key) => {
      const entry = runtimeEntryByKey.get(key);
      return entry?.state === 'starting' && Number.isInteger(entry?.pid) && entry.pid > 0;
    });
    if (hasStartingWithPid) {
      return { serviceState: 'starting', runtimeState: 'starting', enabled: true };
    }

    const hasStartedWithPid = enabledKeys.some((key) => {
      const entry = runtimeEntryByKey.get(key);
      return entry?.state === 'started' && Number.isInteger(entry?.pid) && entry.pid > 0;
    });
    if (hasStartedWithPid) {
      return { serviceState: 'online', runtimeState: 'started', enabled: true };
    }

    const hasCrashed = enabledKeys.some((key) => {
      const entry = runtimeEntryByKey.get(key);
      return entry?.state === 'crashed';
    });
    if (hasCrashed) {
      return { serviceState: 'offline', runtimeState: 'crashed', enabled: true };
    }
    return { serviceState: 'controlStopped', runtimeState: 'stopped', enabled: true };
  };
  const toggleDebugPath = useCallback((path) => {
    setDebugExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);
  const toggleLogService = useCallback((serviceName) => {
    setSelectedLogServices((current) => (
      current.includes(serviceName)
        ? current.filter((name) => name !== serviceName)
        : [...current, serviceName]
    ));
  }, []);
  const onToggleServiceRuntime = useCallback(async ({ projectPath, serviceKey, event }) => {
    event.stopPropagation();
    setError('');
    dispatch(setPanelProjectListSelectedProject(projectPath));

    try {
      await graphqlRequest({
        query: MUTATION_TOGGLE_SERVICE_RUNTIME,
        variables: {
          projectPath,
          serviceKey,
        },
        endpoint: graphqlEndpoint,
      });
      await loadDashboard(graphqlEndpoint);
      await loadProjectEnvironment({ projectPath });
      await loadProjectLogs({
        projectPath,
        fullRefresh: true,
      });
    } catch (toggleError) {
      setError(toggleError.message || 'Unable to toggle service runtime');
    }
  }, [dispatch, graphqlEndpoint, loadDashboard, loadProjectEnvironment, loadProjectLogs]);

  const saveProjectPortRangeSettings = useCallback(async ({ mode, begin }) => {
    if (!selectedProjectPath) {
      return null;
    }

    setError('');
    setProjectPortRangeSettingsSaving(true);
    try {
      const data = await graphqlRequest({
        query: MUTATION_SET_PROJECT_PORT_RANGE_SETTINGS,
        variables: {
          projectPath: selectedProjectPath,
          mode,
          begin: Number.isInteger(begin) ? begin : null,
        },
        endpoint: graphqlEndpoint,
      });
      const normalized = normalizePortRangeSettings(data?.setProjectPortRangeSettings);
      setProjectPortRangeSettings(normalized);
      setManualPortRangeInput(normalized.begin != null ? String(normalized.begin) : '');
      await loadProjectEnvironment({ projectPath: selectedProjectPath });
      return normalized;
    } catch (settingsError) {
      setError(settingsError.message || 'Unable to save project port range settings');
      return null;
    } finally {
      setProjectPortRangeSettingsSaving(false);
    }
  }, [graphqlEndpoint, loadProjectEnvironment, selectedProjectPath]);

  const onSelectPortRangeMode = useCallback(async (mode) => {
    if (mode === PORT_RANGE_MODE.AUTOMATIC) {
      await saveProjectPortRangeSettings({
        mode: PORT_RANGE_MODE.AUTOMATIC,
        begin: null,
      });
      return;
    }

    await saveProjectPortRangeSettings({
      mode: PORT_RANGE_MODE.MANUAL,
      begin: projectPortRangeSettings.begin,
    });
  }, [projectPortRangeSettings.begin, saveProjectPortRangeSettings]);

  const onAcceptManualPortRange = useCallback(async () => {
    const parsed = Number.parseInt(String(manualPortRangeInput || '').trim(), 10);
    if (!Number.isInteger(parsed) || parsed < PORT_RANGE_BEGIN_MIN || parsed > PORT_RANGE_BEGIN_MAX) {
      setError(`Port range start must be an integer from ${PORT_RANGE_BEGIN_MIN} to ${PORT_RANGE_BEGIN_MAX}.`);
      return;
    }

    await saveProjectPortRangeSettings({
      mode: PORT_RANGE_MODE.MANUAL,
      begin: parsed,
    });
  }, [manualPortRangeInput, saveProjectPortRangeSettings]);

  const onLogStreamScroll = useCallback(() => {
    if (isProgrammaticLogScrollRef.current) {
      return;
    }
    const container = logStreamRef.current;
    if (!container) {
      return;
    }
    const distanceToBottom = container.scrollHeight - (container.scrollTop + container.clientHeight);
    const atBottom = distanceToBottom <= 16;

    if (atBottom && !followLogs) {
      dispatch(setPanelProjectExplorerFollowMode(true));
      return;
    }
    if (!atBottom && followLogs) {
      dispatch(setPanelProjectExplorerFollowMode(false));
    }
  }, [dispatch, followLogs]);

  const onResumeLogFollow = useCallback(() => {
    dispatch(setPanelProjectExplorerFollowMode(true));
    scrollLogsToEnd('smooth');
  }, [dispatch, scrollLogsToEnd]);

  const isManualPortRangeMode = projectPortRangeSettings.mode === PORT_RANGE_MODE.MANUAL;
  const hasAcceptedManualPortRange = (
    isManualPortRangeMode &&
    Number.isInteger(projectPortRangeSettings.begin) &&
    projectPortRangeSettings.begin >= PORT_RANGE_BEGIN_MIN &&
    projectPortRangeSettings.begin <= PORT_RANGE_BEGIN_MAX
  );
  const portRangeControlsDisabled = projectPortRangeSettingsLoading || projectPortRangeSettingsSaving;
  const manualPortRangeValue = hasAcceptedManualPortRange
    ? String(projectPortRangeSettings.begin)
    : manualPortRangeInput;

  return (
    <div className="appShell">
      <header className="topMenuBar">
        <div className="menuLeft">
          <span className="menuTitle">Project Commander</span>
          <span className="menuItem">Projects: {projects.length}</span>
          <span className="menuItem">Running: {runningCount}</span>
        </div>
        <div className="menuRight">
          <button
            type="button"
            className="menuButton"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Scanning...' : 'Refresh'}
          </button>
          <ThemeDropdown />
        </div>
      </header>

      <div className="workspace" ref={workspaceRef}>
        <section className="leftPanel" style={{ width: `${leftWidthPct}%` }}>
          <div className="projectTableWrap">
            {projects.length === 0 && !loading ? (
              <p className="emptyState">No projects matched the current scan settings.</p>
            ) : null}

            {projects.length > 0 ? (
              <table>
                <colgroup>
                  <col className="nameCol" />
                  <col className="servicesCol" />
                  <col className="typesCol" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="iconsHeader servicesCol">Packages</th>
                    <th className="iconsHeader typesCol">Stack</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => {
                    const selected = project.path === selectedProjectPath;
                    const isAppRunning = project.runtimeStatus === 'started' || project.runtimeStatus === 'starting';
                    const runtimeServicePorts = project.runtimeServicePorts || {};
                    const runtimeServiceStates = project.runtimeServiceStates || {};
                    const runtimeServiceEntryMap = new Map(
                      (project.runtimeServiceEntries || [])
                        .map((entry) => ({
                          key: normalizeServiceKey(entry?.key),
                          entry,
                        }))
                        .filter((item) => item.key)
                        .map((item) => [item.key, item.entry]),
                    );
                    const discoveredServiceKeys = getDiscoveredServiceKeys(project.services);
                    const discoveredServiceIconMap = buildUniqueIconsForServices(discoveredServiceKeys);
                    const allServicesState = getAllServicesState(project);
                    const allServicesLabel = allServicesState.runtimeState === 'starting'
                      ? 'Starting all services'
                      : allServicesState.runtimeState === 'started'
                        ? 'Stop all services'
                        : 'Start all services';

                    return (
                      <tr
                        key={project.path}
                        className={`projectRow ${selected ? 'selected' : ''}`}
                        onClick={() => dispatch(setPanelProjectListSelectedProject(project.path))}
                      >
                        <td className={`appNameCell ${isAppRunning ? '' : 'stopped'}`}>{project.name}</td>
                        <td className="iconsCell servicesCol">
                          <div className="serviceIcons">
                            {discoveredServiceKeys.map((serviceKey) => {
                              const guessedIcon = discoveredServiceIconMap[serviceKey] || findServiceIcon(serviceKey);
                              const serviceDef = SERVICE_ICON_DEFS[serviceKey] || {
                                label: formatServiceLabel(serviceKey),
                                icon: guessedIcon,
                                className: 'generic',
                              };
                              const Icon = serviceDef.icon;
                              const runtimeEntry = runtimeServiceEntryMap.get(serviceKey) || null;
                              const runtimePid = Number(runtimeEntry?.pid);
                              const hasAssociatedPid = Number.isInteger(runtimePid) && runtimePid > 0;
                              const port = runtimeEntry?.port || runtimeServicePorts[serviceKey] || null;
                              const rawServiceStatus = String(
                                runtimeEntry?.state || runtimeServiceStates[serviceKey] || 'stopped',
                              ).toLowerCase();
                              const serviceStatus = (
                                (rawServiceStatus === 'started' || rawServiceStatus === 'starting') &&
                                !hasAssociatedPid
                              )
                                ? 'stopped'
                                : rawServiceStatus;
                              const serviceState = getServiceState({ serviceStatus, isEnabled: true });

                              const tooltipBase = port
                                  ? `${serviceDef.label}: ${port}`
                                  : `${serviceDef.label}: unavailable`;
                              const tooltip = `${tooltipBase} · ${serviceStatus}${hasAssociatedPid ? ` · pid ${runtimePid}` : ''} · click to toggle`;
                              const isClickable = true;

                              return (
                                <button
                                  type="button"
                                  key={`${project.path}-${serviceKey}`}
                                  className={`serviceIcon ${serviceDef.className} ${serviceState} ${isClickable ? 'clickable' : ''}`}
                                  title={tooltip}
                                  aria-label={tooltip}
                                  onClick={(event) => {
                                    if (!isClickable) {
                                      event.stopPropagation();
                                      return;
                                    }
                                    onToggleServiceRuntime({
                                      projectPath: project.path,
                                      serviceKey,
                                      event,
                                    });
                                  }}
                                >
                                  <Icon />
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              key={`${project.path}-all-services`}
                              className={`serviceIcon control ${allServicesState.serviceState} ${allServicesState.enabled ? 'clickable' : ''}`}
                              title={allServicesLabel}
                              aria-label={allServicesLabel}
                              onClick={(event) => {
                                if (!allServicesState.enabled) {
                                  event.stopPropagation();
                                  return;
                                }
                                onToggleRuntime(project, event);
                              }}
                            >
                              {allServicesState.runtimeState === 'starting'
                                ? <span className="controlGlyph">◔</span>
                                : allServicesState.runtimeState === 'started'
                                  ? <span className="controlGlyph">■</span>
                                  : <span className="controlGlyph">▶</span>}
                            </button>
                          </div>
                        </td>
                        <td className="iconsCell typesCol">
                          <div className="typeIcons">
                            {ORDERED_TYPE_ICON_KEYS.map((iconKey) => {
                              const iconDef = PROJECT_TYPE_ICONS[iconKey];
                              const Icon = iconDef.icon;
                              const active = iconDef.isActive(project.types || []);
                              return (
                                <span
                                  className={`typeIcon ${iconDef.className} ${active ? 'active' : 'inactive'}`}
                                  title={iconDef.label}
                                  aria-label={iconDef.label}
                                  key={`${project.path}-${iconKey}`}
                                >
                                  <Icon />
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        </section>

        <div
          className={`divider ${resizing ? 'active' : ''}`}
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
        />

        <section className="rightPanel">
          <div className="panelTabs" role="tablist" aria-label="Output tabs">
            <button
              type="button"
              className={`panelTab ${rightTab === 'logs' ? 'active' : ''}`}
              role="tab"
              aria-selected={rightTab === 'logs'}
              onClick={() => dispatch(setPanelProjectExplorerMode('logs'))}
            >
              Logs
            </button>
            <button
              type="button"
              className={`panelTab ${rightTab === 'debug' ? 'active' : ''}`}
              role="tab"
              aria-selected={rightTab === 'debug'}
              onClick={() => dispatch(setPanelProjectExplorerMode('debug'))}
            >
              Debug
            </button>
            <button
              type="button"
              className={`panelTab ${rightTab === 'environment' ? 'active' : ''}`}
              role="tab"
              aria-selected={rightTab === 'environment'}
              onClick={() => dispatch(setPanelProjectExplorerMode('environment'))}
            >
              Environment
            </button>
            <button
              type="button"
              className={`panelTab ${rightTab === 'top' ? 'active' : ''}`}
              role="tab"
              aria-selected={rightTab === 'top'}
              onClick={() => dispatch(setPanelProjectExplorerMode('top'))}
            >
              Top
            </button>
          </div>

          {rightTab === 'logs' ? (
            <div className="logPanel" data-testid="log-panel">
              <div className="logFilters">
                {logServiceOptions.map((serviceName) => {
                  const active = selectedLogServices.includes(serviceName);
                  const serviceColor = logServiceColorMap[serviceName] || 'var(--accent)';
                  const buttonStyle = active
                    ? {
                      borderColor: serviceColor,
                      color: serviceColor,
                      backgroundColor: 'color-mix(in srgb, var(--card) 88%, transparent)',
                    }
                    : {
                      borderColor: serviceColor,
                      color: serviceColor,
                      backgroundColor: 'var(--chip)',
                      opacity: 0.72,
                    };
                  return (
                    <button
                      key={serviceName}
                      type="button"
                      className={`logFilterBtn ${active ? 'active' : ''}`}
                      style={buttonStyle}
                      onClick={() => toggleLogService(serviceName)}
                    >
                      {serviceName}
                    </button>
                  );
                })}
              </div>
              {selectedProject && !followLogs ? (
                <button
                  type="button"
                  className="logFollowBtn"
                  data-testid="scroll-to-bottom"
                  onClick={onResumeLogFollow}
                >
                  Scroll to bottom
                </button>
              ) : null}
              <div className="logStream" ref={logStreamRef} onScroll={onLogStreamScroll} data-testid="log-stream">
              {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
              {selectedProject && logsLoading && projectLogs.length === 0 ? (
                <p className="emptyState">Loading logs...</p>
              ) : null}
              {selectedProject && !logsLoading && projectLogs.length === 0 ? (
                <p className="emptyState">No log output yet.</p>
              ) : null}
              {projectLogs.length > 0 ? (
                <div className="logTable">
                  {projectLogs.map((entry) => (
                    <div key={`${entry.projectPath}-${entry.id}`} className={`logLine ${entry.stream}`}>
                      {formatLogLine(entry, {
                        serviceTagColor: logServiceColorMap[String(entry.serviceName || '').trim()] || null,
                        serviceIcon: logServiceIconMap[toCanonicalServiceIconKey(entry.serviceName)] || null,
                      })}
                    </div>
                  ))}
                </div>
              ) : null}
              <div ref={logEndRef} />
              </div>
            </div>
          ) : rightTab === 'debug' ? (
            <div className="debugPanel">
              {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
              {selectedProject && debugData ? (
                <div className="debugTree">
                  <DebugTreeNode
                    name="project"
                    value={debugData}
                    path=""
                    expandedPaths={debugExpandedPaths}
                    togglePath={toggleDebugPath}
                  />
                </div>
              ) : null}
            </div>
          ) : rightTab === 'environment' ? (
            <div className="environmentPanel">
              {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
              {selectedProject ? (
                <div className="environmentTable">
                  <div className="environmentRow environmentPortRangeRow">
                    <span className="environmentKey">Port Range</span>
                    <div className="environmentValue environmentPortRangeControls">
                      <div className="portRangeModeToggle" role="group" aria-label="Port range mode">
                        <button
                          type="button"
                          className={`portRangeModeBtn ${projectPortRangeSettings.mode === PORT_RANGE_MODE.AUTOMATIC ? 'active' : ''}`}
                          onClick={() => onSelectPortRangeMode(PORT_RANGE_MODE.AUTOMATIC)}
                          disabled={portRangeControlsDisabled}
                        >
                          Automatic
                        </button>
                        <button
                          type="button"
                          className={`portRangeModeBtn ${projectPortRangeSettings.mode === PORT_RANGE_MODE.MANUAL ? 'active' : ''}`}
                          onClick={() => onSelectPortRangeMode(PORT_RANGE_MODE.MANUAL)}
                          disabled={portRangeControlsDisabled}
                        >
                          Manual
                        </button>
                      </div>
                      {isManualPortRangeMode ? (
                        <div className="portRangeManualRow">
                          <input
                            type="number"
                            className="portRangeInput"
                            inputMode="numeric"
                            min={PORT_RANGE_BEGIN_MIN}
                            max={PORT_RANGE_BEGIN_MAX}
                            value={manualPortRangeValue}
                            placeholder={String(PORT_RANGE_BEGIN_MIN)}
                            disabled={portRangeControlsDisabled || hasAcceptedManualPortRange}
                            onChange={(event) => setManualPortRangeInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !hasAcceptedManualPortRange && !portRangeControlsDisabled) {
                                event.preventDefault();
                                onAcceptManualPortRange();
                              }
                            }}
                          />
                          {!hasAcceptedManualPortRange ? (
                            <button
                              type="button"
                              className="portRangeAcceptBtn"
                              onClick={onAcceptManualPortRange}
                              disabled={portRangeControlsDisabled}
                              aria-label="Accept manual start port"
                              title="Accept manual start port"
                            >
                              ✓
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {environmentLoading ? (
                    <p className="emptyState">Loading launch environment...</p>
                  ) : null}
                  {!environmentLoading && projectEnvironment.length === 0 ? (
                    <p className="emptyState">No launch environment variables resolved.</p>
                  ) : null}
                  {projectEnvironment.map((entry) => (
                    <div className="environmentRow" key={`${entry.key}-${entry.value}`}>
                      <span className="environmentKey">{entry.key}</span>
                      <span className="environmentValue">{entry.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="topPanel">
              {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
              {selectedProject && processStatsLoading && projectProcessStats.length === 0 ? (
                <p className="emptyState">Loading process statistics...</p>
              ) : null}
              {selectedProject && !processStatsLoading && projectProcessStats.length === 0 ? (
                <p className="emptyState">No running service processes for this project.</p>
              ) : null}
              {selectedProject && projectProcessStats.length > 0 ? (
                <table className="topTable">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>PID</th>
                      <th>CPU%</th>
                      <th>MEM%</th>
                      <th>RSS MB</th>
                      <th>VSZ MB</th>
                      <th>Elapsed</th>
                      <th>Command</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectProcessStats.map((stat) => (
                      <tr key={`${stat.serviceId}-${stat.pid}`}>
                        <td>{stat.serviceName}</td>
                        <td>{stat.pid}</td>
                        <td>{Number(stat.cpuPercent || 0).toFixed(1)}</td>
                        <td>{Number(stat.memoryPercent || 0).toFixed(1)}</td>
                        <td>{Number(stat.rssMb || 0).toFixed(1)}</td>
                        <td>{Number(stat.virtualMb || 0).toFixed(1)}</td>
                        <td>{stat.elapsed || '-'}</td>
                        <td className="topCommandCell" title={stat.command || ''}>{stat.command || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <footer className="statusBar">
        <span className="statusItem">{loading ? 'Scanning projects...' : `Projects: ${projects.length}`}</span>
        <span className={`statusItem ${error ? 'error' : ''}`}>
          {error
            ? `Error: ${error}`
            : scannedAt
              ? `Last scan: ${new Date(scannedAt).toLocaleString()}`
              : 'Ready'}
        </span>
        <span className="statusRightGroup">
          <span className="statusItem selectedProjectStatus">
            {selectedProject
              ? `${selectedProject.name} (${selectedProject.runtimeStatus || 'stopped'})${selectedProject.runtimePid ? ` · pid ${selectedProject.runtimePid}` : ''}`
              : 'No project selected'}
          </span>
          <span className="statusItem portRangeStatus">
            Port range: {(
              Number.isInteger(selectedProject?.runtimePortRangeBegin) &&
              Number.isInteger(selectedProject?.runtimePortRangeEnd)
            )
              ? `${selectedProject.runtimePortRangeBegin}-${selectedProject.runtimePortRangeEnd}`
              : 'None'}
          </span>
        </span>
      </footer>
    </div>
  );
}
