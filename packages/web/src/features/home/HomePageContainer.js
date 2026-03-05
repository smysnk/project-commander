'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setPanelProjectExplorerFollowMode,
  setPanelProjectExplorerMode,
  setPanelProjectListLayout,
  setPanelProjectListSelectedProject,
  setUiActiveLogContextKey,
  setUiAddingHost,
  setUiCheckoutAutoDestinationByHostId,
  setUiCheckoutBaseDirectoryByHostId,
  setUiCheckoutDestinationByHostId,
  setUiCheckoutMutationBusyByHostId,
  setUiCheckoutRepoInputByHostId,
  setUiDirectoryInputByHostId,
  setUiDirectoryMutationBusyByHostId,
  setUiDisabledLogLevels,
  setUiDeletingHostId,
  setUiSelectedLogServices,
  setUiShowAddDirectoryRowByHostId,
  setRuntimeConfig,
  setUiShowCheckoutRowByHostId,
  setUiError,
  setUiResizing,
  setUiDebugExpandedPaths,
  setUiTerminalInputByHostId,
  setUiTerminalSendingByHostId,
  setUiTerminalStartingByHostId,
  setUiHostsSidebarCollapsed,
  setUiHostsSidebarWidthPx,
  setUiLeftPanelMode,
  setUiManualHostIp,
  setUiSelectedHostId,
  setUiShowAddHostRow,
  setUiUpgradingHostId,
  setUserStyle,
  resolveClientThemePreference,
} from '../../store';
import { graphqlRequest } from '../../lib/graphqlClient';
import { findServiceIcon, getUniqueServiceIconMap } from '../../lib/serviceIconFinder';
import InfiniteLogStream from '../../components/InfiniteLogStream';
import logQueryProtocol from '../../lib/logQueryProtocol';
import DebugTreeNode from './components/DebugTreeNode';
import { DebugTreeProvider } from './context/DebugTreeContext';
import { FiGitBranch, FiGlobe, FiKey, FiPlus, FiServer, FiTrash2, FiUpload } from 'react-icons/fi';
import { FaNodeJs } from 'react-icons/fa6';
import { SiGo, SiTurborepo } from 'react-icons/si';
import ThemeDropdown from '../../components/ThemeDropdown';

const QUERY_RUNTIME_CONFIG = `
  query RuntimeConfig {
    runtimeConfig {
      appUrl
      graphqlEndpoint
      wsEndpoint
      runtimeBackend
    }
    runtimeBackendInfo {
      name
      displayName
      masterAgent {
        socketPath
        target
        service
        status
        connectionStatus
        connectionHealth
        lastConnectedAt
        lastAttemptAt
        reconnectAttempts
        version
        protocolVersion
        startedAt
        capabilities
        grantedCapabilities
        error
      }
    }
  }
`;

const QUERY_HOSTS = `
  query Hosts {
    hosts {
      id
      ip
      port
      name
      projects {
        id
        name
        path
      }
    }
  }
`;

const QUERY_RUNTIME_BACKEND_INFO = `
  query RuntimeBackendInfo {
    runtimeBackendInfo {
      name
      displayName
      masterAgent {
        socketPath
        target
        service
        status
        connectionStatus
        connectionHealth
        lastConnectedAt
        lastAttemptAt
        reconnectAttempts
        version
        protocolVersion
        startedAt
        capabilities
        grantedCapabilities
        error
      }
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
        hostId
        hostName
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

const MUTATION_RESTART_SERVICE_RUNTIME = `
  mutation RestartServiceRuntime($projectPath: String!, $serviceKey: String!) {
    restartServiceRuntime(projectPath: $projectPath, serviceKey: $serviceKey) {
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

const MUTATION_ADD_PROJECT = `
  mutation AddProject($projectPath: String!) {
    addProject(projectPath: $projectPath) {
      projectPath
      added
    }
  }
`;

const clampWidth = (value) => Math.max(20, Math.min(80, Math.round(value)));
const LEFT_PANEL_MODE = {
  PROJECTS: 'projects',
  RUNTIME: 'runtime',
  TERMINAL: 'terminal',
};
const MASTER_AGENT_SIDEBAR_ID = 'master-agent';
const PORT_RANGE_MODE = {
  AUTOMATIC: 'AUTOMATIC',
  MANUAL: 'MANUAL',
};
const PORT_RANGE_BEGIN_MIN = 1;
const PORT_RANGE_BEGIN_MAX = 64991;
const {
  buildLogsQueryMessage,
  normalizeLogsQueryResult,
} = logQueryProtocol;
const MASTER_LOG_SOURCES = ['master-agent', 'agent-master'];
const RUNTIME_LOG_SOURCES = ['nextjs-client', 'node-backend', ...MASTER_LOG_SOURCES];
const LOG_LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LOG_LEVEL_LABEL_MAP = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  fatal: 'Fatal',
};
const LOG_LEVEL_LETTER_MAP = {
  trace: 'T',
  debug: 'D',
  info: 'I',
  warn: 'W',
  error: 'E',
  fatal: 'F',
};
const LOG_LEVEL_COLOR_MAP = {
  trace: '#7a8aa0',
  debug: '#5f8ed6',
  info: '#1eaa66',
  warn: '#c98a00',
  error: '#d14b4b',
  fatal: '#b032a8',
};

const normalizeLogLevelName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'warning') {
    return 'warn';
  }
  if (normalized === 'panic') {
    return 'fatal';
  }
  return LOG_LEVEL_ORDER.includes(normalized) ? normalized : null;
};

const resolveLogLevelFromMessage = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const patterns = [
    /\blevel\s*[:=]\s*"?((?:trace|debug|info|warn|warning|error|fatal|panic))"?\b/i,
    /"level"\s*:\s*"((?:trace|debug|info|warn|warning|error|fatal|panic))"/i,
    /\[(trace|debug|info|warn|warning|error|fatal|panic)\]/i,
    /^(?:\[[^\]]+\]\s*)*(trace|debug|info|warn|warning|error|fatal|panic)\b[:\s-]/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || !match[1]) {
      continue;
    }
    const normalized = normalizeLogLevelName(match[1]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const resolveLogLevelForEntry = (entry) => {
  const fromLevel = normalizeLogLevelName(entry?.level);
  if (fromLevel) {
    return fromLevel;
  }
  const fromMessage = resolveLogLevelFromMessage(entry?.message);
  if (fromMessage) {
    return fromMessage;
  }
  return String(entry?.stream || '').trim().toLowerCase() === 'stderr' ? 'error' : 'info';
};

const toOverlaySource = (entry) => (
  String(entry?.source || entry?.serviceName || '').trim().toLowerCase()
);

const normalizeHealthName = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'healthy') {
    return 'healthy';
  }
  if (normalized === 'warning') {
    return 'warning';
  }
  if (normalized === 'critical') {
    return 'critical';
  }
  return 'unknown';
};

const toHostHealthClassName = (value) => normalizeHealthName(value);
const toConnectionHealthClassName = (value) => normalizeHealthName(value);

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
  runtimeBackend: String(runtimeConfig?.runtimeBackend || '').trim().toLowerCase() === 'go-master'
    ? 'go-master'
    : 'js',
});

const normalizeRuntimeBackendInfo = (runtimeBackendInfo) => {
  const normalizedName = String(runtimeBackendInfo?.name || '').trim().toLowerCase() === 'go-master'
    ? 'go-master'
    : 'js';
  const normalizedMasterAgent = runtimeBackendInfo?.masterAgent && typeof runtimeBackendInfo.masterAgent === 'object'
    ? runtimeBackendInfo.masterAgent
    : null;

  return {
    name: normalizedName,
    displayName: String(runtimeBackendInfo?.displayName || '').trim() || (
      normalizedName === 'go-master' ? 'Go Master Agent' : 'JavaScript Runtime Manager'
    ),
    masterAgent: normalizedMasterAgent
      ? {
        socketPath: String(normalizedMasterAgent.socketPath || '').trim() || null,
        target: String(normalizedMasterAgent.target || '').trim() || null,
        service: String(normalizedMasterAgent.service || '').trim() || null,
        status: String(normalizedMasterAgent.status || '').trim() || null,
        connectionStatus: String(normalizedMasterAgent.connectionStatus || '').trim() || null,
        connectionHealth: String(normalizedMasterAgent.connectionHealth || '').trim() || null,
        lastConnectedAt: String(normalizedMasterAgent.lastConnectedAt || '').trim() || null,
        lastAttemptAt: String(normalizedMasterAgent.lastAttemptAt || '').trim() || null,
        reconnectAttempts: Number.isInteger(Number(normalizedMasterAgent.reconnectAttempts))
          ? Number(normalizedMasterAgent.reconnectAttempts)
          : 0,
        version: String(normalizedMasterAgent.version || '').trim() || null,
        protocolVersion: String(normalizedMasterAgent.protocolVersion || '').trim() || null,
        startedAt: String(normalizedMasterAgent.startedAt || '').trim() || null,
        capabilities: Array.isArray(normalizedMasterAgent.capabilities)
          ? normalizedMasterAgent.capabilities.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        grantedCapabilities: Array.isArray(normalizedMasterAgent.grantedCapabilities)
          ? normalizedMasterAgent.grantedCapabilities.map((value) => String(value || '').trim()).filter(Boolean)
          : [],
        error: String(normalizedMasterAgent.error || '').trim() || null,
      }
      : null,
  };
};

const normalizeDiscoveryConfig = (discoveryConfig) => {
  const maxDepth = Number(discoveryConfig?.maxDepth);
  return {
    projectPath: String(discoveryConfig?.projectPath || '').trim(),
    folderPattern: String(discoveryConfig?.folderPattern || '').trim(),
    maxDepth: Number.isInteger(maxDepth) ? maxDepth : null,
  };
};

const formatRuntimeDateTime = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '-';
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return normalized;
  }
  return parsed.toLocaleString();
};

const formatRuntimeList = (values) => (
  Array.isArray(values) && values.length > 0 ? values.join(', ') : '-'
);

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

const sortLogEntries = (entries) => {
  const list = Array.isArray(entries) ? entries : [];
  return list.slice().sort((left, right) => {
    const leftTs = Date.parse(String(left?.timestamp || ''));
    const rightTs = Date.parse(String(right?.timestamp || ''));
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    if (Number.isFinite(leftTs) && !Number.isFinite(rightTs)) {
      return -1;
    }
    if (!Number.isFinite(leftTs) && Number.isFinite(rightTs)) {
      return 1;
    }
    const leftId = String(left?.id || '');
    const rightId = String(right?.id || '');
    return leftId.localeCompare(rightId);
  });
};

const formatLogText = (entry) => {
  const segments = applyAnsiColorCodes(entry?.message);
  const plainMessage = segments.map((segment) => segment.text).join('');
  const formattedJson = tryFormatJsonPayload(plainMessage);
  return formattedJson || plainMessage;
};

const renderLogTagRow = (
  entry,
  {
    serviceTagColor = null,
    serviceIcon = null,
    logLevel = 'info',
  } = {},
) => {
  const timestamp = new Date(entry.timestamp).toLocaleTimeString();
  const rawServiceName = String(entry.serviceName || '').trim();
  const hostLabel = String(entry?.hostName || entry?.hostIp || '').trim();
  const ServiceChipIcon = serviceIcon || findServiceIcon(rawServiceName);
  const normalizedLogLevel = normalizeLogLevelName(logLevel) || 'info';
  const levelLetter = LOG_LEVEL_LETTER_MAP[normalizedLogLevel] || 'I';
  const serviceChipRowStyle = {
    ...(serviceTagColor ? { color: serviceTagColor } : {}),
  };
  return (
    <div className="infiniteLogTagRowContent">
      <span className={`logLevelTag ${normalizedLogLevel}`}>
        {levelLetter}
      </span>
      <span className="logTimestamp">{timestamp}</span>
      {hostLabel ? (
        <span className="logHostTag" title={hostLabel}>
          {hostLabel}
        </span>
      ) : null}
      <span className="logServiceChipRow" style={serviceChipRowStyle}>
        <span className="logServiceTag">{rawServiceName || '-'}</span>
        <ServiceChipIcon className="logServiceTagIcon" aria-hidden />
      </span>
    </div>
  );

  const hostsCollapsedSidebarContent = (
    <div className="hostsSidebarCollapsedBody">
      <button
        type="button"
        className={`collapsedHostButton ${isMasterRowSelected ? 'selected' : ''}`}
        onClick={() => {
          setSelectedHostId(MASTER_AGENT_SIDEBAR_ID);
          setLeftPanelMode(LEFT_PANEL_MODE.RUNTIME);
        }}
        aria-label="Select master agent"
        title="Master Agent"
        data-testid="collapsed-master-agent"
      >
        <span className={`collapsedHostHealthDot ${masterConnectionHealthClass}`} aria-hidden="true" />
        <FiServer />
      </button>
      {hostsLoading ? (
        <span className="collapsedHostsEmpty" aria-label="Loading hosts">...</span>
      ) : null}
      {!hostsLoading && hosts.length === 0 ? (
        <span className="collapsedHostsEmpty" aria-label="No hosts">-</span>
      ) : null}
      {hosts.length > 0 ? (
        <div className="collapsedHostList" role="list" aria-label="Slave agents">
          {hosts.map((host) => {
            const hostId = Number(host?.id) || 0;
            const isSelectedHost = Number(selectedHostId) === hostId;
            const hostHealthClass = toHostHealthClassName(host?.health);
            const hostName = String(host?.name || host?.ip || hostId).trim() || String(hostId);
            return (
              <button
                key={`collapsed-host-${hostId}`}
                type="button"
                className={`collapsedHostButton ${isSelectedHost ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedHostId(hostId);
                  setLeftPanelMode(LEFT_PANEL_MODE.RUNTIME);
                }}
                aria-label={`Select host ${hostName}`}
                title={hostName}
                data-testid={`collapsed-host-${hostId}`}
              >
                <span className={`collapsedHostHealthDot ${hostHealthClass}`} aria-hidden="true" />
                <FiServer />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

const toLogStreamLine = (entry, index) => {
  const normalizedId = String(entry?.id || `row-${index}`).trim();
  return {
    ...entry,
    id: normalizedId,
    __lineId: normalizedId,
    __lineIndex: index,
    __lineText: formatLogText(entry),
  };
};

const buildLogStreams = (entries) => {
  const lines = (Array.isArray(entries) ? entries : []).map((entry, index) => toLogStreamLine(entry, index));
  return [
    {
      streamId: 'merged',
      totalLines: lines.length,
      offset: 0,
      lines,
    },
  ];
};

const buildLogsContextDescriptor = ({
  isProjectLogContext,
  selectedProjectPath,
  isHostLogContext,
  selectedHost,
}) => {
  if (isProjectLogContext && selectedProjectPath) {
    return {
      scope: 'project',
      contextKey: `project:${selectedProjectPath}`,
      projectPath: selectedProjectPath,
      hostId: null,
      hostName: null,
      hostIp: null,
    };
  }
  if (isHostLogContext && selectedHost) {
    return {
      scope: 'host',
      contextKey: `host:${selectedHost.id}`,
      projectPath: null,
      hostId: Number(selectedHost.id),
      hostName: String(selectedHost.name || '').trim() || null,
      hostIp: String(selectedHost.ip || '').trim() || null,
    };
  }
  return {
    scope: 'runtime',
    contextKey: 'runtime',
    projectPath: null,
    hostId: null,
    hostName: null,
    hostIp: null,
  };
};

const normalizeLogsQueryLines = (lines) => (
  (Array.isArray(lines) ? lines : []).map((line, index) => ({
    ...line,
    id: String(line?.id || `query-line-${index}`).trim() || `query-line-${index}`,
    __lineText: formatLogText(line),
  }))
);

const normalizeLogsQueryStreams = (streams) => (
  (Array.isArray(streams) ? streams : [])
    .map((stream) => ({
      streamId: String(stream?.streamId || '').trim(),
      totalLines: Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0),
      offset: Math.max(0, Number.parseInt(stream?.offset, 10) || 0),
      lines: normalizeLogsQueryLines(stream?.lines),
    }))
    .filter((stream) => stream.streamId.length > 0)
);

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

export default function HomePage() {
  const dispatch = useDispatch();
  const runtimeConfig = useSelector((state) => state.runtime.config);
  const leftWidthPct = useSelector((state) => state.panelProjectList.leftWidthPct);
  const selectedProjectPath = useSelector((state) => state.panelProjectList.selectedProjectPath);
  const rightTab = useSelector((state) => state.panelProjectExplorer.mode);
  const followLogs = useSelector((state) => state.panelProjectExplorer.isFollowMode);
  const editorTheme = useSelector((state) => state.userSettings.style);
  const leftPanelMode = useSelector((state) => state.uiInteractions.leftPanelMode);
  const hostsSidebarCollapsed = useSelector((state) => state.uiInteractions.hostsSidebarCollapsed);
  const hostsSidebarWidthPx = useSelector((state) => state.uiInteractions.hostsSidebarWidthPx);
  const resizing = useSelector((state) => state.uiInteractions.resizing);
  const selectedHostId = useSelector((state) => state.uiInteractions.selectedHostId);
  const activeLogContextKey = useSelector((state) => state.uiInteractions.activeLogContextKey);
  const error = useSelector((state) => state.uiInteractions.error);
  const showAddHostRow = useSelector((state) => state.uiInteractions.showAddHostRow);
  const manualHostIp = useSelector((state) => state.uiInteractions.manualHostIp);
  const addingHost = useSelector((state) => state.uiInteractions.addingHost);
  const deletingHostId = useSelector((state) => state.uiInteractions.deletingHostId);
  const upgradingHostId = useSelector((state) => state.uiInteractions.upgradingHostId);

  const graphqlEndpoint = runtimeConfig?.graphqlEndpoint || '/graphql';
  const wsEndpoint = runtimeConfig?.wsEndpoint || getDefaultWsEndpoint();

  const [projects, setProjects] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [showAddDirectoryRowByHostId, setShowAddDirectoryRowByHostId] = useState({});
  const [directoryInputByHostId, setDirectoryInputByHostId] = useState({});
  const [directoryMutationBusyByHostId, setDirectoryMutationBusyByHostId] = useState({});
  const [showCheckoutRowByHostId, setShowCheckoutRowByHostId] = useState({});
  const [checkoutRepoInputByHostId, setCheckoutRepoInputByHostId] = useState({});
  const [checkoutBaseDirectoryByHostId, setCheckoutBaseDirectoryByHostId] = useState({});
  const [checkoutDestinationByHostId, setCheckoutDestinationByHostId] = useState({});
  const [checkoutAutoDestinationByHostId, setCheckoutAutoDestinationByHostId] = useState({});
  const [checkoutMutationBusyByHostId, setCheckoutMutationBusyByHostId] = useState({});
  const [terminalSessionByHostId, setTerminalSessionByHostId] = useState({});
  const [terminalOutputBySessionId, setTerminalOutputBySessionId] = useState({});
  const [terminalInputByHostId, setTerminalInputByHostId] = useState({});
  const [terminalStartingByHostId, setTerminalStartingByHostId] = useState({});
  const [terminalSendingByHostId, setTerminalSendingByHostId] = useState({});
  const [scannedAt, setScannedAt] = useState('');
  const [discoveryConfig, setDiscoveryConfig] = useState(() => normalizeDiscoveryConfig(null));
  const [loading, setLoading] = useState(true);
  const [addingProject, setAddingProject] = useState(false);
  const [runtimeBackendInfo, setRuntimeBackendInfo] = useState(() => normalizeRuntimeBackendInfo(null));
  const [runtimeBackendInfoLoading, setRuntimeBackendInfoLoading] = useState(false);
  const [projectLogs, setProjectLogs] = useState([]);
  const [overlayLogs, setOverlayLogs] = useState([]);
  const [activeLogStreams, setActiveLogStreams] = useState(() => buildLogStreams([]));
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
  const [disabledLogLevels, setDisabledLogLevels] = useState([]);
  const [seenLogServicesByProject, setSeenLogServicesByProject] = useState({});

  const workspaceRef = useRef(null);
  const mainPanelsRef = useRef(null);
  const logStreamRef = useRef(null);
  const terminalOutputRef = useRef(null);
  const resizingRef = useRef(false);
  const resizingHandleRef = useRef(null);
  const wsRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  const wsRetryCountRef = useRef(0);
  const wsLastEventIdRef = useRef('');
  const wsLogQuerySequenceRef = useRef(0);
  const projectLogsRef = useRef([]);
  const overlayLogSeedRef = useRef(1);
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

  const setError = useCallback((valueOrUpdater) => {
    const currentValue = String(error || '');
    const nextValue = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(currentValue)
      : valueOrUpdater;
    dispatch(setUiError(String(nextValue || '')));
  }, [dispatch, error]);

  const bootstrapRuntimeVariables = useCallback(async () => {
    setRuntimeBackendInfoLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_RUNTIME_CONFIG,
        endpoint: '/graphql',
      });

      const normalized = normalizeRuntimeConfig(data?.runtimeConfig);
      dispatch(setRuntimeConfig({ config: normalized }));
      setRuntimeBackendInfo(normalizeRuntimeBackendInfo(data?.runtimeBackendInfo));
      return normalized;
    } finally {
      setRuntimeBackendInfoLoading(false);
    }
  }, [dispatch]);

  const loadRuntimeBackendInfo = useCallback(async (endpoint) => {
    setRuntimeBackendInfoLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_RUNTIME_BACKEND_INFO,
        endpoint: endpoint || graphqlEndpoint,
      });
      setRuntimeBackendInfo(normalizeRuntimeBackendInfo(data?.runtimeBackendInfo));
    } catch (runtimeBackendError) {
      setError(runtimeBackendError.message || 'Unable to load runtime backend info');
    } finally {
      setRuntimeBackendInfoLoading(false);
    }
  }, [
    checkoutAutoDestinationByHostId,
    checkoutBaseDirectoryByHostId,
    checkoutDestinationByHostId,
    checkoutMutationBusyByHostId,
    checkoutRepoInputByHostId,
    directoryInputByHostId,
    directoryMutationBusyByHostId,
    dispatch,
    graphqlEndpoint,
    showAddDirectoryRowByHostId,
    showCheckoutRowByHostId,
    terminalInputByHostId,
    terminalSendingByHostId,
    terminalStartingByHostId,
  ]);

  const loadHosts = useCallback(async (endpoint) => {
    setHostsLoading(true);
    try {
      const data = await graphqlRequest({
        query: QUERY_HOSTS,
        endpoint: endpoint || graphqlEndpoint,
      });
      const nextHosts = Array.isArray(data?.hosts) ? data.hosts.map((host) => normalizeHostRecord(host)) : [];
      setHosts(nextHosts);
      const nextHostIds = new Set(nextHosts.map((host) => Number(host?.id)).filter((id) => Number.isInteger(id) && id > 0));
      dispatch(setUiShowAddDirectoryRowByHostId(
        Object.fromEntries(
          Object.entries(showAddDirectoryRowByHostId || {}).filter(([hostId, visible]) => (
            Boolean(visible) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setUiDirectoryInputByHostId(
        Object.fromEntries(
          Object.entries(directoryInputByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setUiDirectoryMutationBusyByHostId(
        Object.fromEntries(
          Object.entries(directoryMutationBusyByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setUiShowCheckoutRowByHostId(
        Object.fromEntries(
          Object.entries(showCheckoutRowByHostId || {}).filter(([hostId, visible]) => (
            Boolean(visible) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setUiCheckoutRepoInputByHostId(
        Object.fromEntries(
          Object.entries(checkoutRepoInputByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setUiCheckoutBaseDirectoryByHostId(
        Object.fromEntries(
          Object.entries(checkoutBaseDirectoryByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setUiCheckoutDestinationByHostId(
        Object.fromEntries(
          Object.entries(checkoutDestinationByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setUiCheckoutAutoDestinationByHostId(
        Object.fromEntries(
          Object.entries(checkoutAutoDestinationByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setUiCheckoutMutationBusyByHostId(
        Object.fromEntries(
          Object.entries(checkoutMutationBusyByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      setTerminalSessionByHostId((current) => (
        Object.fromEntries(
          Object.entries(current || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        )
      ));
      dispatch(setUiTerminalInputByHostId(
        Object.fromEntries(
          Object.entries(terminalInputByHostId || {}).filter(([hostId]) => nextHostIds.has(Number(hostId))),
        ),
      ));
      dispatch(setUiTerminalStartingByHostId(
        Object.fromEntries(
          Object.entries(terminalStartingByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
      dispatch(setUiTerminalSendingByHostId(
        Object.fromEntries(
          Object.entries(terminalSendingByHostId || {}).filter(([hostId, busy]) => (
            Boolean(busy) && nextHostIds.has(Number(hostId))
          )),
        ),
      ));
    } catch (hostsError) {
      setError(hostsError.message || 'Unable to load registered hosts');
    } finally {
      setHostsLoading(false);
    }
  }, [graphqlEndpoint]);
  const loadTerminalSession = useCallback(async (hostId, endpoint) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      return null;
    }

    const data = await graphqlRequest({
      query: QUERY_TERMINAL_SESSION,
      variables: { hostId: parsedHostId },
      endpoint: endpoint || graphqlEndpoint,
    });
    const normalizedSession = normalizeTerminalSession(data?.terminalSession);
    setTerminalSessionByHostId((current) => ({
      ...(current || {}),
      [parsedHostId]: normalizedSession,
    }));
    if (normalizedSession?.sessionId) {
      setTerminalOutputBySessionId((current) => ({
        ...(current || {}),
        [normalizedSession.sessionId]: normalizedSession.status === 'closed'
          ? []
          : normalizedSession.output.slice(-MAX_TERMINAL_OUTPUT_ENTRIES),
      }));
    }
    return normalizedSession;
  }, [graphqlEndpoint]);
  const startTerminalSessionForHost = useCallback(async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to start terminal session: invalid host id.');
      return null;
    }

    setError('');
    dispatch(setUiTerminalStartingByHostId({
      ...(terminalStartingByHostId || {}),
      [hostId]: true,
    }));
    try {
      const data = await graphqlRequest({
        query: MUTATION_START_HOST_TERMINAL_SESSION,
        variables: { hostId },
        endpoint: graphqlEndpoint,
      });
      const normalizedSession = normalizeTerminalSession(data?.startHostTerminalSession);
      if (!normalizedSession) {
        throw new Error('Unable to start terminal session.');
      }
      setTerminalSessionByHostId((current) => ({
        ...(current || {}),
        [hostId]: normalizedSession,
      }));
      setTerminalOutputBySessionId((current) => ({
        ...(current || {}),
        [normalizedSession.sessionId]: normalizedSession.status === 'closed'
          ? []
          : normalizedSession.output.slice(-MAX_TERMINAL_OUTPUT_ENTRIES),
      }));
      dispatch(setUiTerminalInputByHostId({
        ...(terminalInputByHostId || {}),
        [hostId]: '',
      }));
      return normalizedSession;
    } catch (startError) {
      setError(startError.message || 'Unable to start terminal session');
      return null;
    } finally {
      dispatch(setUiTerminalStartingByHostId({
        ...(terminalStartingByHostId || {}),
        [hostId]: false,
      }));
    }
  }, [dispatch, graphqlEndpoint, terminalInputByHostId, terminalStartingByHostId]);
  const sendTerminalInput = useCallback(async ({ sessionId, hostId, input }) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      setError('Unable to send terminal input: invalid host id.');
      return false;
    }
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
      setError('No active terminal session.');
      return false;
    }

    setError('');
    dispatch(setUiTerminalSendingByHostId({
      ...(terminalSendingByHostId || {}),
      [parsedHostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_SEND_HOST_TERMINAL_INPUT,
        variables: {
          sessionId: normalizedSessionId,
          input: String(input || ''),
        },
        endpoint: graphqlEndpoint,
      });
      return true;
    } catch (sendError) {
      setError(sendError.message || 'Unable to send terminal input');
      return false;
    } finally {
      dispatch(setUiTerminalSendingByHostId({
        ...(terminalSendingByHostId || {}),
        [parsedHostId]: false,
      }));
    }
  }, [dispatch, graphqlEndpoint, terminalSendingByHostId]);
  const appendOverlayLog = useCallback((entry) => {
    const message = String(entry?.message || '').trimEnd();
    if (!message) {
      return;
    }

    const nextEntry = {
      id: `overlay-${overlayLogSeedRef.current}`,
      projectPath: '@overlay',
      timestamp: toIsoTimestamp(entry?.timestamp),
      serviceName: String(entry?.serviceName || 'system').trim() || 'system',
      level: normalizeLogLevelName(entry?.level),
      source: toOverlaySource(entry) || 'system',
      hostId: Number.isInteger(Number(entry?.hostId)) ? Number(entry.hostId) : null,
      hostName: String(entry?.hostName || '').trim() || null,
      hostIp: String(entry?.hostIp || '').trim() || null,
      stream: (() => {
        const normalized = String(entry?.stream || 'system').trim().toLowerCase();
        if (normalized === 'stdout' || normalized === 'stderr' || normalized === 'system') {
          return normalized;
        }
        return 'system';
      })(),
      message,
    };
    overlayLogSeedRef.current += 1;

    setOverlayLogs((current) => {
      const next = [...current, nextEntry];
      if (next.length <= MAX_OVERLAY_LOG_ENTRIES) {
        return next;
      }
      return next.slice(next.length - MAX_OVERLAY_LOG_ENTRIES);
    });
  }, []);
  const appendProjectLog = useCallback((entry) => {
    const projectPath = String(entry?.projectPath || '').trim();
    const serviceName = String(entry?.serviceName || '').trim();
    const message = String(entry?.message || '').trimEnd();
    if (!projectPath || !serviceName || !message) {
      return;
    }

    const stream = String(entry?.stream || 'stdout').trim().toLowerCase();
    const normalizedStream = (
      stream === 'stdout' || stream === 'stderr' || stream === 'system'
    )
      ? stream
      : 'stdout';
    const normalizedId = String(entry?.id || `${projectPath}-${Date.now()}`).trim();
    const nextEntry = {
      id: normalizedId,
      projectPath,
      timestamp: toIsoTimestamp(entry?.timestamp),
      serviceName,
      level: normalizeLogLevelName(entry?.level),
      stream: normalizedStream,
      message,
    };

    setProjectLogs((current) => {
      if (projectPath !== selectedProjectPath) {
        return current;
      }
      const hasDuplicate = current.some((logEntry) => String(logEntry?.id || '') === normalizedId);
      if (hasDuplicate) {
        return current;
      }
      const next = [...current, nextEntry];
      if (next.length <= MAX_PROJECT_LOG_ENTRIES) {
        return next;
      }
      return next.slice(next.length - MAX_PROJECT_LOG_ENTRIES);
    });
  }, [selectedProjectPath]);

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
      setDiscoveryConfig(normalizeDiscoveryConfig(data?.discoveryConfig));
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
        : [];
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
    if (leftPanelMode !== LEFT_PANEL_MODE.RUNTIME) {
      return;
    }
    loadRuntimeBackendInfo(graphqlEndpoint);
  }, [graphqlEndpoint, leftPanelMode, loadRuntimeBackendInfo]);

  useEffect(() => {
    loadHosts(graphqlEndpoint);
  }, [graphqlEndpoint, loadHosts]);

  useEffect(() => {
    if (!Array.isArray(hosts) || hosts.length === 0) {
      if (selectedHostId !== null && selectedHostId !== MASTER_AGENT_SIDEBAR_ID) {
        dispatch(setUiSelectedHostId(null));
      }
      return;
    }

    if (selectedHostId == null) {
      return;
    }

    if (selectedHostId === MASTER_AGENT_SIDEBAR_ID) {
      return;
    }

    const hasSelected = hosts.some((host) => Number(host?.id) === Number(selectedHostId));
    if (!hasSelected) {
      dispatch(setUiSelectedHostId(null));
    }
  }, [dispatch, hosts, selectedHostId]);

  useEffect(() => {
    if (leftPanelMode === LEFT_PANEL_MODE.PROJECTS || rightTab === 'logs') {
      return;
    }
    dispatch(setPanelProjectExplorerMode('logs'));
  }, [dispatch, leftPanelMode, rightTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    const bindMethod = (methodName, stream) => (...args) => {
      originalConsole[methodName](...args);
      const formatted = formatClientLogArgs(args);
      if (!formatted) {
        return;
      }
      appendOverlayLog({
        timestamp: new Date().toISOString(),
        serviceName: 'nextjs-client',
        source: 'nextjs-client',
        stream,
        message: formatted,
      });
    };

    console.log = bindMethod('log', 'stdout');
    console.info = bindMethod('info', 'stdout');
    console.warn = bindMethod('warn', 'stderr');
    console.error = bindMethod('error', 'stderr');

    return () => {
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    };
  }, [appendOverlayLog]);

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
        socket.send(JSON.stringify({
          action: 'subscribe',
          topics: ['*'],
          lastEventId: wsLastEventIdRef.current || null,
        }));
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

        if (payload.kind === 'hello' || payload.kind === 'subscribed' || payload.kind === 'pong') {
          return;
        }

        if (payload.kind === 'logs.query.result') {
          const normalized = normalizeLogsQueryResult(payload);
          if (!normalized) {
            return;
          }
          if (
            normalized.contextKey
            && activeLogContextKey
            && normalized.contextKey !== activeLogContextKey
          ) {
            return;
          }
          const nextStreams = normalizeLogsQueryStreams(normalized.streams);
          if (nextStreams.length > 0) {
            setActiveLogStreams(nextStreams);
          }
          return;
        }

        if (payload.kind === 'logs.query.error') {
          const queryErrorMessage = String(payload?.error || '').trim();
          if (queryErrorMessage) {
            appendOverlayLog({
              timestamp: new Date().toISOString(),
              serviceName: 'node-backend',
              source: 'node-backend',
              stream: 'stderr',
              message: `[logs.query] ${queryErrorMessage}`,
            });
          }
          return;
        }

        if (payload.kind !== 'event') {
          return;
        }

        const eventId = String(payload.eventId || '').trim();
        if (eventId) {
          wsLastEventIdRef.current = eventId;
        }
        const topic = String(payload.topic || '').trim();
        if (!topic) {
          return;
        }

        if (topic === 'log.overlay' && payload.payload && typeof payload.payload === 'object') {
          appendOverlayLog(payload.payload);
          return;
        }

        if (topic === 'project.log.append' && payload.payload && typeof payload.payload === 'object') {
          appendProjectLog(payload.payload);
          return;
        }

        if (topic === 'runtime.master.connection' && payload.payload && typeof payload.payload === 'object') {
          const connection = payload.payload;
          setRuntimeBackendInfo((current) => {
            const normalizedCurrent = normalizeRuntimeBackendInfo(current);
            const currentMasterAgent = normalizedCurrent.masterAgent || {};
            return normalizeRuntimeBackendInfo({
              ...normalizedCurrent,
              name: 'go-master',
              masterAgent: {
                ...currentMasterAgent,
                socketPath: connection.socketPath ?? currentMasterAgent.socketPath ?? null,
                target: connection.target ?? currentMasterAgent.target ?? null,
                service: connection.service ?? currentMasterAgent.service ?? null,
                status: connection.status ?? currentMasterAgent.status ?? null,
                connectionStatus: connection.connectionStatus ?? currentMasterAgent.connectionStatus ?? null,
                connectionHealth: connection.connectionHealth ?? currentMasterAgent.connectionHealth ?? null,
                lastConnectedAt: connection.lastConnectedAt ?? currentMasterAgent.lastConnectedAt ?? null,
                lastAttemptAt: connection.lastAttemptAt ?? currentMasterAgent.lastAttemptAt ?? null,
                reconnectAttempts: Number.isInteger(Number(connection.reconnectAttempts))
                  ? Number(connection.reconnectAttempts)
                  : (currentMasterAgent.reconnectAttempts || 0),
                version: connection.version ?? currentMasterAgent.version ?? null,
                protocolVersion: connection.protocolVersion ?? currentMasterAgent.protocolVersion ?? null,
                startedAt: connection.startedAt ?? currentMasterAgent.startedAt ?? null,
                capabilities: Array.isArray(connection.capabilities)
                  ? connection.capabilities
                  : (currentMasterAgent.capabilities || []),
                grantedCapabilities: Array.isArray(connection.grantedCapabilities)
                  ? connection.grantedCapabilities
                  : (currentMasterAgent.grantedCapabilities || []),
                error: connection.error ?? currentMasterAgent.error ?? null,
              },
            });
          });
          return;
        }

        if (topic === 'runtime.project.updated' && payload.payload?.projectPath) {
          const update = payload.payload;
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
  }, [
    activeLogContextKey,
    appendOverlayLog,
    appendProjectLog,
    graphqlEndpoint,
    loadDashboard,
    wsEndpoint,
  ]);

  useEffect(() => {
    if (rightTab !== 'logs' || !followLogs) {
      return;
    }
    scrollLogsToEnd('auto');
  }, [activeLogStreams, followLogs, overlayLogs, projectLogs, rightTab, scrollLogsToEnd]);

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
    if (typeof window === 'undefined') return;
    if (!runtimeConfig) return;
    window.__RUNTIME_CONFIG__ = runtimeConfig;
  }, [runtimeConfig]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!resizingRef.current || !workspaceRef.current) {
        return;
      }

      const activeHandle = resizingHandleRef.current || 'content';
      if (activeHandle === 'sidebar') {
        if (hostsSidebarCollapsed) {
          return;
        }
        const workspaceRect = workspaceRef.current.getBoundingClientRect();
        if (workspaceRect.width <= 0) {
          return;
        }
        const maxAllowedWidth = Math.max(
          HOSTS_SIDEBAR_WIDTH_MIN,
          Math.min(HOSTS_SIDEBAR_WIDTH_MAX, workspaceRect.width - 320),
        );
        const nextWidth = clampSidebarWidth(event.clientX - workspaceRect.left, {
          max: maxAllowedWidth,
        });
        dispatch(setUiHostsSidebarWidthPx(nextWidth));
        return;
      }

      const rect = mainPanelsRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) {
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
      resizingHandleRef.current = null;
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
  }, [dispatch, hostsSidebarCollapsed]);

  const startResize = (event, handle = 'content') => {
    event.preventDefault();
    resizingRef.current = true;
    resizingHandleRef.current = handle === 'sidebar' ? 'sidebar' : 'content';
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onRefresh = async () => {
    setError('');
    try {
      await loadDashboard(graphqlEndpoint);
      if (leftPanelMode === LEFT_PANEL_MODE.RUNTIME) {
        await loadRuntimeBackendInfo(graphqlEndpoint);
      }
      await loadHosts(graphqlEndpoint);
    } catch (refreshError) {
      setError(refreshError.message || 'Unable to refresh projects');
    }
  };

  const onAddProject = async () => {
    const entered = window.prompt('Enter the full directory path for the project you want to add.');
    if (entered == null) {
      return;
    }

    const projectPath = entered.trim();
    if (!projectPath) {
      setError('Project path cannot be empty');
      return;
    }

    setError('');
    setAddingProject(true);
    try {
      const data = await graphqlRequest({
        query: MUTATION_ADD_PROJECT,
        variables: { projectPath },
        endpoint: graphqlEndpoint,
      });
      await loadDashboard(graphqlEndpoint);
      dispatch(setPanelProjectListSelectedProject(data?.addProject?.projectPath || projectPath));
    } catch (addError) {
      setError(addError.message || 'Unable to add project');
    } finally {
      setAddingProject(false);
    }
  };
  const onAddHost = async () => {
    const ip = manualHostIp.trim();
    if (!ip) {
      setError('Host target is required.');
      return;
    }

    setError('');
    dispatch(setUiAddingHost(true));
    try {
      await graphqlRequest({
        query: MUTATION_ADD_HOST,
        variables: { ip },
        endpoint: graphqlEndpoint,
      });
      dispatch(setUiManualHostIp(''));
      dispatch(setUiShowAddHostRow(false));
      await loadHosts(graphqlEndpoint);
    } catch (addHostError) {
      setError(addHostError.message || 'Unable to add host');
    } finally {
      dispatch(setUiAddingHost(false));
    }
  };
  const onDeleteHost = async (host) => {
    const hostId = Number(host?.id);
    const hostName = String(host?.name || '').trim() || String(host?.ip || '').trim() || `#${hostId}`;
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to delete host: invalid host id.');
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete host "${hostName}"?`);
      if (!confirmed) {
        return;
      }
    }

    setError('');
    dispatch(setUiDeletingHostId(hostId));
    try {
      const data = await graphqlRequest({
        query: MUTATION_DELETE_HOST,
        variables: { hostId },
        endpoint: graphqlEndpoint,
      });
      if (!data?.deleteHost) {
        throw new Error('Host was not found or already deleted.');
      }
      await loadHosts(graphqlEndpoint);
    } catch (deleteHostError) {
      setError(deleteHostError.message || 'Unable to delete host');
    } finally {
      dispatch(setUiDeletingHostId(null));
    }
  };
  const onUpgradeHostAgent = async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to deploy host agent: invalid host id.');
      return;
    }

    setError('');
    dispatch(setUiUpgradingHostId(hostId));
    try {
      await graphqlRequest({
        query: MUTATION_UPGRADE_HOST_AGENT,
        variables: { hostId },
        endpoint: graphqlEndpoint,
      });
      await loadHosts(graphqlEndpoint);
    } catch (upgradeError) {
      setError(upgradeError.message || 'Unable to deploy host agent');
    } finally {
      dispatch(setUiUpgradingHostId(null));
    }
  };
  const onAddHostDirectory = async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to add directory: invalid host id.');
      return;
    }

    const directoryPath = String(directoryInputByHostId?.[hostId] || '').trim();
    if (!directoryPath) {
      setError('Directory path is required.');
      return;
    }

    setError('');
    dispatch(setUiDirectoryMutationBusyByHostId({
      ...(directoryMutationBusyByHostId || {}),
      [hostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_ADD_HOST_DIRECTORY,
        variables: { hostId, directoryPath },
        endpoint: graphqlEndpoint,
      });
      dispatch(setUiDirectoryInputByHostId({
        ...(directoryInputByHostId || {}),
        [hostId]: '',
      }));
      dispatch(setUiShowAddDirectoryRowByHostId({
        ...(showAddDirectoryRowByHostId || {}),
        [hostId]: false,
      }));
      await loadHosts(graphqlEndpoint);
    } catch (addDirectoryError) {
      setError(addDirectoryError.message || 'Unable to add directory');
    } finally {
      dispatch(setUiDirectoryMutationBusyByHostId({
        ...(directoryMutationBusyByHostId || {}),
        [hostId]: false,
      }));
    }
  };
  const onRemoveHostDirectory = async ({ host, directoryPath }) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to remove directory: invalid host id.');
      return;
    }

    const normalizedDirectoryPath = String(directoryPath || '').trim();
    if (!normalizedDirectoryPath) {
      setError('Unable to remove directory: invalid path.');
      return;
    }

    setError('');
    dispatch(setUiDirectoryMutationBusyByHostId({
      ...(directoryMutationBusyByHostId || {}),
      [hostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_REMOVE_HOST_DIRECTORY,
        variables: { hostId, directoryPath: normalizedDirectoryPath },
        endpoint: graphqlEndpoint,
      });
      await loadHosts(graphqlEndpoint);
    } catch (removeDirectoryError) {
      setError(removeDirectoryError.message || 'Unable to remove directory');
    } finally {
      dispatch(setUiDirectoryMutationBusyByHostId({
        ...(directoryMutationBusyByHostId || {}),
        [hostId]: false,
      }));
    }
  };
  const onCheckoutRepositoryInputChange = (hostId, value) => {
    const nextValue = String(value || '');
    const derivedDestination = deriveDestinationFolderFromRepositoryUrl(nextValue);
    const previousAuto = String(checkoutAutoDestinationByHostId?.[hostId] || '');
    const existingDestination = String(checkoutDestinationByHostId?.[hostId] || '');
    const nextDestination = (!existingDestination || existingDestination === previousAuto)
      ? derivedDestination
      : existingDestination;
    dispatch(setUiCheckoutRepoInputByHostId({
      ...(checkoutRepoInputByHostId || {}),
      [hostId]: nextValue,
    }));
    dispatch(setUiCheckoutDestinationByHostId({
      ...(checkoutDestinationByHostId || {}),
      [hostId]: nextDestination,
    }));
    dispatch(setUiCheckoutAutoDestinationByHostId({
      ...(checkoutAutoDestinationByHostId || {}),
      [hostId]: derivedDestination,
    }));
  };
  const onCancelCheckoutHostProject = (hostId) => {
    dispatch(setUiCheckoutRepoInputByHostId({
      ...(checkoutRepoInputByHostId || {}),
      [hostId]: '',
    }));
    dispatch(setUiCheckoutDestinationByHostId({
      ...(checkoutDestinationByHostId || {}),
      [hostId]: '',
    }));
    dispatch(setUiCheckoutAutoDestinationByHostId({
      ...(checkoutAutoDestinationByHostId || {}),
      [hostId]: '',
    }));
    dispatch(setUiShowCheckoutRowByHostId({
      ...(showCheckoutRowByHostId || {}),
      [hostId]: false,
    }));
  };
  const onCheckoutHostProject = async (host) => {
    const hostId = Number(host?.id);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Unable to checkout project: invalid host id.');
      return;
    }

    const repositoryUrl = String(checkoutRepoInputByHostId?.[hostId] || '').trim();
    const hostDirectories = normalizeHostDirectories(host?.directories);
    const selectedBaseDirectory = String(
      checkoutBaseDirectoryByHostId?.[hostId] || hostDirectories[0] || '',
    ).trim();
    const destinationFolder = String(checkoutDestinationByHostId?.[hostId] || '').trim();
    if (!repositoryUrl) {
      setError('Git repository URL is required.');
      return;
    }
    if (!selectedBaseDirectory) {
      setError('A target project directory is required before checkout.');
      return;
    }
    if (!destinationFolder) {
      setError('Destination folder is required.');
      return;
    }

    setError('');
    dispatch(setUiCheckoutMutationBusyByHostId({
      ...(checkoutMutationBusyByHostId || {}),
      [hostId]: true,
    }));
    try {
      await graphqlRequest({
        query: MUTATION_CHECKOUT_HOST_PROJECT,
        variables: {
          hostId,
          repositoryUrl,
          baseDirectory: selectedBaseDirectory,
          destinationFolder,
        },
        endpoint: graphqlEndpoint,
      });
      onCancelCheckoutHostProject(hostId);
      await loadHosts(graphqlEndpoint);
    } catch (checkoutError) {
      setError(checkoutError.message || 'Unable to checkout project on host');
    } finally {
      dispatch(setUiCheckoutMutationBusyByHostId({
        ...(checkoutMutationBusyByHostId || {}),
        [hostId]: false,
      }));
    }
  };
  const onTerminalInputChange = useCallback((hostId, value) => {
    const parsedHostId = Number(hostId);
    if (!Number.isInteger(parsedHostId) || parsedHostId <= 0) {
      return;
    }
    dispatch(setUiTerminalInputByHostId({
      ...(terminalInputByHostId || {}),
      [parsedHostId]: String(value || ''),
    }));
  }, [dispatch, terminalInputByHostId]);
  const onSubmitTerminalInput = useCallback(async () => {
    const hostId = Number(selectedHostId);
    if (!Number.isInteger(hostId) || hostId <= 0) {
      setError('Select a host before running terminal commands.');
      return;
    }
    const session = normalizeTerminalSession(terminalSessionByHostId?.[hostId]);
    if (!session || session.status !== 'active') {
      setError('Terminal session is not active.');
      return;
    }
    const command = String(terminalInputByHostId?.[hostId] || '');
    const sent = await sendTerminalInput({
      hostId,
      sessionId: session.sessionId,
      input: command,
    });
    if (sent) {
      dispatch(setUiTerminalInputByHostId({
        ...(terminalInputByHostId || {}),
        [hostId]: '',
      }));
    }
  }, [dispatch, selectedHostId, sendTerminalInput, terminalInputByHostId, terminalSessionByHostId]);

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
  const selectedHost = useMemo(
    () => hosts.find((host) => Number(host?.id) === Number(selectedHostId)) || null,
    [hosts, selectedHostId],
  );
  const isMasterSidebarSelected = selectedHostId === MASTER_AGENT_SIDEBAR_ID;
  const selectedHostNumericId = Number(selectedHost?.id);
  const selectedTerminalSession = useMemo(
    () => (
      Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0
        ? normalizeTerminalSession(terminalSessionByHostId?.[selectedHostNumericId])
        : null
    ),
    [selectedHostNumericId, terminalSessionByHostId],
  );
  const selectedTerminalOutput = useMemo(() => {
    if (!selectedTerminalSession?.sessionId) {
      return [];
    }
    return Array.isArray(terminalOutputBySessionId?.[selectedTerminalSession.sessionId])
      ? terminalOutputBySessionId[selectedTerminalSession.sessionId]
      : [];
  }, [selectedTerminalSession, terminalOutputBySessionId]);
  const selectedHostTerminalInput = Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0
    ? String(terminalInputByHostId?.[selectedHostNumericId] || '')
    : '';
  const selectedHostTerminalStarting = Boolean(
    Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0
      ? terminalStartingByHostId?.[selectedHostNumericId]
      : false,
  );
  const selectedHostTerminalSending = Boolean(
    Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0
      ? terminalSendingByHostId?.[selectedHostNumericId]
      : false,
  );
  const hasActiveTerminalSession = selectedTerminalSession?.status === 'active';
  const isProjectLogContext = leftPanelMode === LEFT_PANEL_MODE.PROJECTS;
  const isMasterLogContext = leftPanelMode !== LEFT_PANEL_MODE.PROJECTS && isMasterSidebarSelected;
  const isHostLogContext = (
    leftPanelMode !== LEFT_PANEL_MODE.PROJECTS
    && !isMasterLogContext
    && selectedHost != null
  );
  const isRuntimeLogContext = (
    leftPanelMode !== LEFT_PANEL_MODE.PROJECTS
    && !isMasterLogContext
    && !isHostLogContext
  );

  useEffect(() => {
    if (leftPanelMode !== LEFT_PANEL_MODE.TERMINAL) {
      return;
    }
    if (!Number.isInteger(selectedHostNumericId) || selectedHostNumericId <= 0) {
      return;
    }

    const hasSessionEntry = Object.prototype.hasOwnProperty.call(
      terminalSessionByHostId,
      selectedHostNumericId,
    );
    if (!hasSessionEntry) {
      loadTerminalSession(selectedHostNumericId).catch((terminalError) => {
        setError(terminalError.message || 'Unable to load terminal session');
      });
      return;
    }

    const currentSession = normalizeTerminalSession(terminalSessionByHostId?.[selectedHostNumericId]);
    if (!currentSession && !terminalStartingByHostId?.[selectedHostNumericId]) {
      startTerminalSessionForHost(selectedHost).catch((terminalError) => {
        setError(terminalError.message || 'Unable to start terminal session');
      });
    }
  }, [
    leftPanelMode,
    loadTerminalSession,
    selectedHost,
    selectedHostNumericId,
    startTerminalSessionForHost,
    terminalSessionByHostId,
    terminalStartingByHostId,
  ]);

  useEffect(() => {
    if (leftPanelMode !== LEFT_PANEL_MODE.TERMINAL || !hasActiveTerminalSession) {
      return;
    }
    const container = terminalOutputRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [
    hasActiveTerminalSession,
    leftPanelMode,
    selectedTerminalOutput.length,
    selectedTerminalSession?.sessionId,
  ]);

  const projectLogServiceOptions = useMemo(() => {
    if (!selectedProjectPath) {
      return [];
    }
    return (seenLogServicesByProject[selectedProjectPath] || [])
      .map((serviceName) => String(serviceName || '').trim())
      .filter(Boolean);
  }, [seenLogServicesByProject, selectedProjectPath]);
  const disabledLogLevelSet = useMemo(
    () => new Set(
      (Array.isArray(disabledLogLevels) ? disabledLogLevels : [])
        .map((level) => normalizeLogLevelName(level))
        .filter(Boolean),
    ),
    [disabledLogLevels],
  );

  const displayedLogs = useMemo(() => {
    let scopedLogs = [];
    if (isProjectLogContext) {
      const disabledServices = new Set(
        (Array.isArray(selectedLogServices) ? selectedLogServices : [])
          .map((serviceName) => String(serviceName || '').trim())
          .filter(Boolean),
      );
      scopedLogs = projectLogs.filter((entry) => {
        const logProjectPath = String(entry?.projectPath || '').trim();
        if (selectedProjectPath && logProjectPath && logProjectPath !== selectedProjectPath) {
          return false;
        }
        const serviceName = String(entry?.serviceName || '').trim();
        return !disabledServices.has(serviceName);
      });
    } else if (isRuntimeLogContext) {
      scopedLogs = overlayLogs.filter((entry) => (
        RUNTIME_LOG_SOURCES.includes(toOverlaySource(entry))
      ));
    } else if (isMasterLogContext) {
      scopedLogs = overlayLogs.filter((entry) => (
        MASTER_LOG_SOURCES.includes(toOverlaySource(entry))
      ));
    } else if (isHostLogContext) {
      if (!selectedHost) {
        return [];
      }

      const selectedHostNumericId = Number(selectedHost.id);
      const selectedHostName = String(selectedHost.name || '').trim().toLowerCase();
      const selectedHostIp = String(selectedHost.ip || '').trim();
      scopedLogs = overlayLogs.filter((entry) => {
        const entryHostId = Number(entry?.hostId);
        if (Number.isInteger(selectedHostNumericId) && selectedHostNumericId > 0) {
          if (Number.isInteger(entryHostId) && entryHostId === selectedHostNumericId) {
            return true;
          }
        }

        const entryHostName = String(entry?.hostName || '').trim().toLowerCase();
        const entryHostIp = String(entry?.hostIp || '').trim();
        if (selectedHostName && entryHostName && selectedHostName === entryHostName) {
          return true;
        }
        if (selectedHostIp && entryHostIp && selectedHostIp === entryHostIp) {
          return true;
        }
        return false;
      });
    } else {
      scopedLogs = projectLogs.slice();
    }

    const levelFilteredLogs = scopedLogs.filter((entry) => (
      !disabledLogLevelSet.has(resolveLogLevelForEntry(entry))
    ));

    return sortLogEntries(levelFilteredLogs);
  }, [
    disabledLogLevelSet,
    isHostLogContext,
    isMasterLogContext,
    isProjectLogContext,
    isRuntimeLogContext,
    overlayLogs,
    projectLogs,
    selectedHost,
    selectedLogServices,
    selectedProjectPath,
  ]);

  const logServiceOptions = useMemo(() => {
    if (isProjectLogContext) {
      return projectLogServiceOptions;
    }
    return Array.from(
      new Set(
        displayedLogs
          .map((entry) => String(entry?.serviceName || '').trim())
          .filter(Boolean),
      ),
    );
  }, [displayedLogs, isProjectLogContext, projectLogServiceOptions]);
  const logLevelOptions = LOG_LEVEL_ORDER;
  const isLogLevelDisabled = useCallback(
    (level) => disabledLogLevelSet.has(level),
    [disabledLogLevelSet],
  );

  const logServiceColorMap = useMemo(() => {
    const visibleServiceNames = displayedLogs
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
  }, [displayedLogs, editorTheme, logServiceOptions]);
  const logServiceIconMap = useMemo(() => {
    const canonicalVisibleNames = displayedLogs
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
  }, [displayedLogs, logServiceOptions, selectedProjectServiceKeys]);
  const logContextDescriptor = useMemo(() => (
    buildLogsContextDescriptor({
      isProjectLogContext,
      selectedProjectPath,
      isMasterLogContext,
      isHostLogContext,
      selectedHost,
    })
  ), [isHostLogContext, isMasterLogContext, isProjectLogContext, selectedHost, selectedProjectPath]);
  const localLogStreams = useMemo(
    () => buildLogStreams(displayedLogs),
    [displayedLogs],
  );
  const effectiveLogStreams = useMemo(
    () => (Array.isArray(activeLogStreams) && activeLogStreams.length > 0
      ? activeLogStreams
      : localLogStreams),
    [activeLogStreams, localLogStreams],
  );
  const requestLogWindowOverWebsocket = useCallback(({ streams }) => {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== 1) {
      return;
    }
    const sequence = wsLogQuerySequenceRef.current + 1;
    wsLogQuerySequenceRef.current = sequence;
    const requestId = `logs-query-${Date.now()}-${sequence}`;
    const payload = buildLogsQueryMessage({
      requestId,
      context: logContextDescriptor,
      streams,
    });
    if (!payload) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }, [logContextDescriptor]);
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
    setActiveLogStreams(localLogStreams);
    dispatch(setUiActiveLogContextKey(logContextDescriptor.contextKey || 'runtime'));
  }, [dispatch, localLogStreams, logContextDescriptor.contextKey]);

  useEffect(() => {
    dispatch(setUiSelectedLogServices([]));
    setProjectLogs([]);
    setProjectEnvironment([]);
    setProjectPortRangeSettings(normalizePortRangeSettings(null));
    setManualPortRangeInput('');
    setProjectProcessStats([]);
    dispatch(setPanelProjectExplorerFollowMode(true));
  }, [dispatch, selectedProjectPath]);

  useEffect(() => {
    if (leftPanelMode !== LEFT_PANEL_MODE.PROJECTS || !selectedProjectPath) {
      return;
    }
    loadProjectLogs({
      projectPath: selectedProjectPath,
      fullRefresh: true,
      serviceNames: null,
    });
  }, [leftPanelMode, loadProjectLogs, selectedProjectPath]);

  useEffect(() => {
    if (!selectedProjectPath || rightTab !== 'environment') {
      return;
    }
    loadProjectEnvironment({
      projectPath: selectedProjectPath,
    });
  }, [loadProjectEnvironment, rightTab, selectedProjectPath]);

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
    const current = Array.isArray(selectedLogServices) ? selectedLogServices : [];
    const next = current.includes(serviceName)
      ? current.filter((name) => name !== serviceName)
      : [...current, serviceName];
    dispatch(setUiSelectedLogServices(next));
  }, [dispatch, selectedLogServices]);
  const toggleLogLevel = useCallback((level) => {
    const normalizedLevel = normalizeLogLevelName(level);
    if (!normalizedLevel) {
      return;
    }
    const next = new Set(
      (Array.isArray(disabledLogLevels) ? disabledLogLevels : [])
        .map((item) => normalizeLogLevelName(item))
        .filter(Boolean),
    );
    if (next.has(normalizedLevel)) {
      next.delete(normalizedLevel);
    } else {
      next.add(normalizedLevel);
    }
    dispatch(setUiDisabledLogLevels(LOG_LEVEL_ORDER.filter((item) => next.has(item))));
  }, [disabledLogLevels, dispatch]);
  const onToggleServiceRuntime = useCallback(async ({
    projectPath,
    serviceKey,
    event,
    restart = false,
  }) => {
    event.stopPropagation();
    setError('');
    dispatch(setPanelProjectListSelectedProject(projectPath));

    try {
      await graphqlRequest({
        query: restart ? MUTATION_RESTART_SERVICE_RUNTIME : MUTATION_TOGGLE_SERVICE_RUNTIME,
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
      setError(toggleError.message || (restart
        ? 'Unable to restart service runtime'
        : 'Unable to toggle service runtime'));
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
  const runtimeBackendMode = String(
    runtimeConfig?.runtimeBackend || runtimeBackendInfo?.name || 'js',
  ).trim().toLowerCase() === 'go-master'
    ? 'go-master'
    : 'js';
  const runtimeBackendDisplayName = runtimeBackendInfo?.displayName || (
    runtimeBackendMode === 'go-master' ? 'Go Master Agent' : 'JavaScript Runtime Manager'
  );
  const slaveTargetVersion = String(runtimeConfig?.slaveTargetVersion || '').trim() || null;
  const isGoMasterBackend = runtimeBackendMode === 'go-master';
  const masterAgentInfo = runtimeBackendInfo?.masterAgent || null;
  const masterConnectionStatus = String(masterAgentInfo?.connectionStatus || '').trim().toLowerCase() || (
    isGoMasterBackend ? 'connecting' : 'n/a'
  );
  const masterConnectionHealthClass = toConnectionHealthClassName(masterAgentInfo?.connectionHealth);
  const masterConnectionLabel = isGoMasterBackend
    ? `Master link: ${masterConnectionStatus}`
    : 'Master link: n/a';
  const hostsSidebarContent = (
    <div className="runtimePanel hostsSidebarPanel">
      <div className="hostsToolbar">
        <h3 className="runtimeSectionTitle">Slave Hosts</h3>
        <button
          type="button"
          className="hostsAddButton"
          onClick={() => {
            setError('');
            setShowAddHostRow((current) => {
              const next = !current;
              if (!next) {
                setManualHostIp('');
              }
              return next;
            });
          }}
          disabled={hostsLoading || addingHost || deletingHostId != null}
          aria-label="Add host"
          title="Add host"
        >
          <FiPlus />
        </button>
      </div>

      {showAddHostRow ? (
        <div className="hostsAddRow">
          <input
            type="text"
            className="hostsAddInput"
            placeholder="Enter host target (IP, hostname, or URL)"
            value={manualHostIp}
            onChange={(event) => setManualHostIp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onAddHost();
              }
            }}
            disabled={addingHost}
            aria-label="Host target"
          />
          <button
            type="button"
            className="hostsAddAction"
            onClick={onAddHost}
            disabled={addingHost}
          >
            {addingHost ? 'Adding...' : 'Add'}
          </button>
        </div>
      ) : null}

      {hostsLoading ? (
        <p className="emptyState">Loading registered hosts...</p>
      ) : null}
      {!hostsLoading && hosts.length === 0 ? (
        <p className="emptyState">No slave hosts registered with master agent.</p>
      ) : null}
      {hosts.length > 0 ? (
        <div className="environmentTable hostList">
          {hosts.map((host) => {
            const isManualHost = String(host?.source || '').toLowerCase() === 'manual';
            const hostId = Number(host?.id) || 0;
            const isSelectedHost = Number(selectedHostId) === hostId;
            const hostHealthClass = toHostHealthClassName(host?.health);
            const statusLabel = String(host?.status || 'unknown').trim() || 'unknown';
            const onlineLabel = host?.online ? 'online' : 'offline';
            const hostDirectories = normalizeHostDirectories(host?.directories);
            const showDirectoryRow = Boolean(showAddDirectoryRowByHostId?.[hostId]);
            const directoryInputValue = String(directoryInputByHostId?.[hostId] || '');
            const directoryMutationBusy = Boolean(directoryMutationBusyByHostId?.[hostId]);
            const showCheckoutRow = Boolean(showCheckoutRowByHostId?.[hostId]);
            const checkoutRepoInput = String(checkoutRepoInputByHostId?.[hostId] || '');
            const checkoutBaseDirectory = String(
              checkoutBaseDirectoryByHostId?.[hostId] || hostDirectories[0] || '',
            );
            const checkoutDestination = String(checkoutDestinationByHostId?.[hostId] || '');
            const checkoutMutationBusy = Boolean(checkoutMutationBusyByHostId?.[hostId]);
            const hostOutOfDate = isHostVersionOutOfDate(host?.version, slaveTargetVersion);
            const deployButtonTitle = !slaveTargetVersion
              ? 'Re-deploy slave agent (target version unknown).'
              : hostOutOfDate
                ? `Upgrade slave to ${slaveTargetVersion}`
                : `Re-deploy slave agent (${String(host?.version || '').trim() || 'unknown'} is current).`;
            const deployActionLabel = hostOutOfDate ? 'Upgrade' : 'Re-deploy';
            const checkoutDestinationOptions = Array.from(new Set(
              [
                deriveDestinationFolderFromRepositoryUrl(checkoutRepoInput),
                ...(
                  Array.isArray(host?.projects)
                    ? host.projects
                      .map((project) => String(project?.name || '').trim())
                      .filter(Boolean)
                    : []
                ),
              ].filter(Boolean),
            ));
            return (
              <div
                className={`runtimeSection hostCard ${isSelectedHost ? 'selected' : ''}`}
                key={`${host.id}-${host.name}`}
                onClick={() => {
                  setSelectedHostId(hostId);
                  setLeftPanelMode(LEFT_PANEL_MODE.RUNTIME);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedHostId(hostId);
                    setLeftPanelMode(LEFT_PANEL_MODE.RUNTIME);
                  }
                }}
              >
                <div className="hostCardHeader">
                  <div className="hostCardTitle">
                    <span
                      className={`hostHealthDot ${hostHealthClass}`}
                      aria-label={`Health ${hostHealthClass}`}
                      title={`Health: ${hostHealthClass}`}
                    />
                    <h3 className="runtimeSectionTitle">
                      {host.name}
                      {isManualHost ? ' (manual)' : ''}
                    </h3>
                  </div>
                  <div className="hostCardActions">
                    <button
                      type="button"
                      className="hostsActionButton hostCheckoutButton"
                      onClick={(event) => {
                        event.stopPropagation();
                        setError('');
                        const next = !Boolean(showCheckoutRowByHostId?.[hostId]);
                        if (next) {
                          const defaultBaseDirectory = hostDirectories[0] || '';
                          dispatch(setUiCheckoutBaseDirectoryByHostId({
                            ...(checkoutBaseDirectoryByHostId || {}),
                            [hostId]: String(checkoutBaseDirectoryByHostId?.[hostId] || defaultBaseDirectory),
                          }));
                        }
                        dispatch(setUiShowCheckoutRowByHostId({
                          ...(showCheckoutRowByHostId || {}),
                          [hostId]: next,
                        }));
                      }}
                      disabled={hostsLoading || checkoutMutationBusy || deletingHostId === hostId}
                      aria-label={`Checkout project on host ${host.name}`}
                      title="Checkout project"
                    >
                      <FiGitBranch />
                    </button>
                    <button
                      type="button"
                      className="hostsActionButton hostUpgradeButton"
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpgradeHostAgent(host);
                      }}
                      disabled={
                        hostsLoading
                        || checkoutMutationBusy
                        || upgradingHostId === hostId
                        || deletingHostId === hostId
                      }
                      aria-label={`${deployActionLabel} slave agent on host ${host.name}`}
                      title={deployButtonTitle}
                    >
                      {upgradingHostId === hostId ? '...' : <FiUpload />}
                    </button>
                    {isManualHost ? (
                      <button
                        type="button"
                        className="hostsDeleteButton"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteHost(host);
                        }}
                        disabled={hostsLoading || deletingHostId === Number(host.id)}
                        aria-label={`Delete host ${host.name}`}
                        title="Delete host"
                      >
                        {deletingHostId === Number(host.id) ? '...' : <FiTrash2 />}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="hostFieldGrid">
                  <div className="hostFieldItem">
                    <span className="hostFieldLabel">Status</span>
                    <span className="hostFieldValue">
                      {`${statusLabel} (${onlineLabel})`}
                      {host?.lastSeenAt ? ` (last seen ${formatRuntimeDateTime(host.lastSeenAt)})` : ''}
                    </span>
                  </div>
                  {host?.error ? (
                    <div className="hostFieldItem hostFieldItemError">
                      <span className="hostFieldLabel">Connection Error</span>
                      <span className="hostFieldValue">{String(host.error)}</span>
                    </div>
                  ) : null}
                  <div className="hostFieldItem">
                    <span className="hostFieldLabel">Target</span>
                    <span className="hostFieldValue">{host.ip || '-'}</span>
                  </div>
                  <div className="hostFieldItem">
                    <span className="hostFieldLabel">Port</span>
                    <span className="hostFieldValue">{Number.isInteger(host.port) ? host.port : '-'}</span>
                  </div>
                  <div className="hostFieldItem">
                    <span className="hostFieldLabel">Version</span>
                    <span className="hostFieldValue">
                      {formatVersionWithProtocol(host?.version, host?.protocolVersion)}
                    </span>
                  </div>
                  <div className="hostFieldItem">
                    <span className="hostFieldLabel hostFieldLabelWithAction">
                      <span>Directories</span>
                      <button
                        type="button"
                        className="hostDirectoryAddButton"
                        onClick={(event) => {
                          event.stopPropagation();
                          setError('');
                          const next = !Boolean(showAddDirectoryRowByHostId?.[hostId]);
                          if (!next) {
                            dispatch(setUiDirectoryInputByHostId({
                              ...(directoryInputByHostId || {}),
                              [hostId]: '',
                            }));
                          }
                          dispatch(setUiShowAddDirectoryRowByHostId({
                            ...(showAddDirectoryRowByHostId || {}),
                            [hostId]: next,
                          }));
                        }}
                        disabled={hostsLoading || directoryMutationBusy || deletingHostId === hostId}
                        aria-label={`Add directory for host ${host.name}`}
                        title="Add directory"
                      >
                        <FiPlus />
                      </button>
                    </span>
                    <span className="hostFieldValue">
                      {hostDirectories.length > 0
                        ? `${hostDirectories.length} configured`
                        : '-'}
                    </span>
                  </div>
                </div>
                {showDirectoryRow ? (
                  <div
                    className="hostDirectoryAddRow"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="text"
                      className="hostsAddInput hostDirectoryAddInput"
                      placeholder="Enter directory path (e.g. /opt/workspace)"
                      value={directoryInputValue}
                      onChange={(event) => {
                        const value = event.target.value;
                        dispatch(setUiDirectoryInputByHostId({
                          ...(directoryInputByHostId || {}),
                          [hostId]: value,
                        }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onAddHostDirectory(host);
                        }
                      }}
                      disabled={directoryMutationBusy}
                      aria-label={`Directory path for host ${host.name}`}
                    />
                    <button
                      type="button"
                      className="hostsAddAction"
                      onClick={() => onAddHostDirectory(host)}
                      disabled={directoryMutationBusy}
                    >
                      {directoryMutationBusy ? 'Saving...' : 'Submit'}
                    </button>
                  </div>
                ) : null}
                {hostDirectories.length > 0 ? (
                  <div className="hostDirectoryList">
                    {hostDirectories.map((directoryPath) => (
                      <div className="hostDirectoryItem" key={`${hostId}-${directoryPath}`}>
                        <span className="hostDirectoryPath">{directoryPath}</span>
                        <button
                          type="button"
                          className="hostDirectoryRemoveButton"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveHostDirectory({ host, directoryPath });
                          }}
                          disabled={directoryMutationBusy}
                          aria-label={`Remove directory ${directoryPath}`}
                          title="Remove directory"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {showCheckoutRow ? (
                  <div
                    className="hostCheckoutForm"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="text"
                      className="hostsAddInput hostCheckoutInput"
                      placeholder="Git repository URL (e.g. git@github.com:org/repo.git)"
                      value={checkoutRepoInput}
                      onChange={(event) => onCheckoutRepositoryInputChange(hostId, event.target.value)}
                      disabled={checkoutMutationBusy}
                      aria-label={`Repository URL for host ${host.name}`}
                    />
                    <div className="hostCheckoutRow">
                      <span className="hostCheckoutLabel">Project directory</span>
                      <select
                        className="hostsAddInput hostCheckoutSelect"
                        value={checkoutBaseDirectory}
                        onChange={(event) => {
                          const value = String(event.target.value || '');
                          dispatch(setUiCheckoutBaseDirectoryByHostId({
                            ...(checkoutBaseDirectoryByHostId || {}),
                            [hostId]: value,
                          }));
                        }}
                        disabled={checkoutMutationBusy || hostDirectories.length === 0}
                        aria-label={`Project directory for host ${host.name}`}
                      >
                        {hostDirectories.length === 0 ? (
                          <option value="">No directories configured</option>
                        ) : hostDirectories.map((directoryPath) => (
                          <option key={`${hostId}-base-${directoryPath}`} value={directoryPath}>
                            {directoryPath}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="hostCheckoutRow">
                      <span className="hostCheckoutLabel">Destination folder</span>
                      <div className="hostCheckoutDestinationWrap">
                        <input
                          type="text"
                          list={`checkout-destination-options-${hostId}`}
                          className="hostsAddInput hostCheckoutInput"
                          placeholder="Destination folder (e.g. my-repo)"
                          value={checkoutDestination}
                          onChange={(event) => {
                            const value = event.target.value;
                            dispatch(setUiCheckoutDestinationByHostId({
                              ...(checkoutDestinationByHostId || {}),
                              [hostId]: value,
                            }));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              onCheckoutHostProject(host);
                            }
                          }}
                          disabled={checkoutMutationBusy}
                          aria-label={`Destination folder for host ${host.name}`}
                        />
                        <datalist id={`checkout-destination-options-${hostId}`}>
                          {checkoutDestinationOptions.map((value) => (
                            <option key={`${hostId}-checkout-destination-${value}`} value={value} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                    <div className="hostCheckoutActions">
                      <button
                        type="button"
                        className="hostsAddAction hostCheckoutCancel"
                        onClick={() => onCancelCheckoutHostProject(hostId)}
                        disabled={checkoutMutationBusy}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="hostsAddAction hostCheckoutSubmit"
                        onClick={() => onCheckoutHostProject(host)}
                        disabled={checkoutMutationBusy || hostDirectories.length === 0}
                      >
                        {checkoutMutationBusy ? 'Queuing...' : 'Submit'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );

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
            onClick={onAddProject}
            disabled={loading || addingProject}
          >
            {addingProject ? 'Adding...' : 'Add project'}
          </button>
          <button
            type="button"
            className="menuButton"
            onClick={onRefresh}
            disabled={loading || addingProject}
          >
            {loading ? 'Scanning...' : 'Refresh'}
          </button>
          <ThemeDropdown />
        </div>
      </header>

      <div className="workspace" ref={workspaceRef}>
        <aside
          className={`hostsSidebar ${hostsSidebarCollapsed ? 'collapsed' : ''}`}
          style={hostsSidebarCollapsed ? undefined : { width: `${hostsSidebarWidthPx}px` }}
        >
          <div className="hostsSidebarHeader">
              <button
                type="button"
                className="hostsSidebarToggle"
                onClick={() => setHostsSidebarCollapsed((current) => !current)}
                aria-label={hostsSidebarCollapsed ? 'Expand hosts sidebar' : 'Collapse hosts sidebar'}
                title={hostsSidebarCollapsed ? 'Expand hosts sidebar' : 'Collapse hosts sidebar'}
              >
                {hostsSidebarCollapsed ? '›' : '‹'}
              </button>
          </div>
          <div className="hostsSidebarBody">
            {hostsSidebarCollapsed ? hostsCollapsedSidebarContent : hostsSidebarContent}
          </div>
        </aside>
        {!hostsSidebarCollapsed ? (
          <div
            className={`divider sidebarDivider ${resizing && resizingHandleRef.current === 'sidebar' ? 'active' : ''}`}
            onMouseDown={(event) => startResize(event, 'sidebar')}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize hosts sidebar"
            data-testid="sidebar-divider"
          />
        ) : null}
        <div className="mainPanels" ref={mainPanelsRef}>
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
                              const tooltip = `${tooltipBase} · ${serviceStatus}${hasAssociatedPid ? ` · pid ${runtimePid}` : ''} · click to toggle · shift+click to restart`;
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
                                      restart: event.shiftKey,
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
          className={`divider contentDivider ${resizing && resizingHandleRef.current === 'content' ? 'active' : ''}`}
          onMouseDown={(event) => startResize(event, 'content')}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          data-testid="content-divider"
        />

        <section className="rightPanel">
          <div className="panelTabs">
            <div className="panelTabsGroup" role="tablist" aria-label="Output tabs">
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
            <div className="panelTabsGroup panelTabsRight" role="group" aria-label="Left pane views">
              <button
                type="button"
                className={`panelTab ${leftPanelMode === LEFT_PANEL_MODE.RUNTIME ? 'active' : ''}`}
                onClick={() => setLeftPanelMode(LEFT_PANEL_MODE.RUNTIME)}
              >
                Runtime
              </button>
              <button
                type="button"
                className={`panelTab ${leftPanelMode === LEFT_PANEL_MODE.TERMINAL ? 'active' : ''}`}
                onClick={() => setLeftPanelMode(LEFT_PANEL_MODE.TERMINAL)}
              >
                Terminal
              </button>
            </div>
          </div>

          {rightTab === 'logs' ? (
            <div className="logPanel" data-testid="log-panel">
              <div className="logFilters">
                {logLevelOptions.map((level) => {
                  const disabled = isLogLevelDisabled(level);
                  const levelColor = LOG_LEVEL_COLOR_MAP[level] || 'var(--accent)';
                  const buttonStyle = disabled
                    ? {
                      borderColor: levelColor,
                      color: levelColor,
                      backgroundColor: 'var(--chip)',
                      opacity: 0.7,
                    }
                    : {
                      borderColor: levelColor,
                      color: levelColor,
                      backgroundColor: 'color-mix(in srgb, var(--card) 88%, transparent)',
                    };
                  return (
                    <button
                      key={level}
                      type="button"
                      className={`logFilterBtn ${disabled ? '' : 'active'} ${level}`}
                      style={buttonStyle}
                      onClick={() => toggleLogLevel(level)}
                    >
                      {LOG_LEVEL_LABEL_MAP[level] || level}
                    </button>
                  );
                })}
              </div>
              {isProjectLogContext ? (
                <div className="logFilters">
                  {logServiceOptions.map((serviceName) => {
                    const disabled = selectedLogServices.includes(serviceName);
                    const serviceColor = logServiceColorMap[serviceName] || 'var(--accent)';
                    const buttonStyle = disabled
                      ? {
                        borderColor: serviceColor,
                        color: serviceColor,
                        backgroundColor: 'var(--chip)',
                        opacity: 0.72,
                      }
                      : {
                        borderColor: serviceColor,
                        color: serviceColor,
                        backgroundColor: 'color-mix(in srgb, var(--card) 88%, transparent)',
                      };
                    return (
                      <button
                        key={serviceName}
                        type="button"
                        className={`logFilterBtn ${disabled ? '' : 'active'}`}
                        style={buttonStyle}
                        onClick={() => toggleLogService(serviceName)}
                      >
                        {serviceName}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {displayedLogs.length > 0 && !followLogs ? (
                <button
                  type="button"
                  className="logFollowBtn"
                  data-testid="scroll-to-bottom"
                  onClick={onResumeLogFollow}
                >
                  Scroll to bottom
                </button>
              ) : null}
              {isProjectLogContext && !selectedProject && displayedLogs.length === 0 ? (
                <p className="emptyState">No project selected.</p>
              ) : null}
              {isHostLogContext && !selectedHost && displayedLogs.length === 0 ? (
                <p className="emptyState">No host selected.</p>
              ) : null}
              {isMasterLogContext && displayedLogs.length === 0 ? (
                <p className="emptyState">No master agent logs yet.</p>
              ) : null}
              {isRuntimeLogContext && displayedLogs.length === 0 ? (
                <p className="emptyState">No runtime logs yet.</p>
              ) : null}
              {isHostLogContext && selectedHost && displayedLogs.length === 0 ? (
                <p className="emptyState">No logs for selected host yet.</p>
              ) : null}
              {isProjectLogContext && selectedProject && logsLoading && displayedLogs.length === 0 ? (
                <p className="emptyState">Loading logs...</p>
              ) : null}
              {isProjectLogContext && selectedProject && !logsLoading && displayedLogs.length === 0 ? (
                <p className="emptyState">No log output yet.</p>
              ) : null}
              {displayedLogs.length > 0 ? (
                <InfiniteLogStream
                  ref={logStreamRef}
                  streams={effectiveLogStreams}
                  lineHeight={22}
                  overscanAbove={140}
                  overscanBelow={220}
                  onScroll={onLogStreamScroll}
                  onWindowRequest={requestLogWindowOverWebsocket}
                  renderLineText={(line) => String(line?.__lineText || line?.message || '')}
                  renderLineTags={(line) => {
                    const logLevel = resolveLogLevelForEntry(line);
                    return renderLogTagRow(line, {
                      serviceTagColor: logServiceColorMap[String(line?.serviceName || '').trim()] || null,
                      serviceIcon: logServiceIconMap[toCanonicalServiceIconKey(line?.serviceName)] || null,
                      logLevel,
                    });
                  }}
                />
              ) : null}
            </div>
          ) : rightTab === 'debug' ? (
            <div className="debugPanel">
              {!selectedProject ? <p className="emptyState">No project selected.</p> : null}
              {selectedProject && debugData ? (
                <DebugTreeProvider value={{ expandedPaths: debugExpandedPaths, togglePath: toggleDebugPath }}>
                  <div className="debugTree">
                    <DebugTreeNode
                      name="project"
                      value={debugData}
                      path=""
                    />
                  </div>
                </DebugTreeProvider>
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
          <span className="statusItem statusMasterLink">
            <span className={`runtimeHealthDot ${masterConnectionHealthClass}`} />
            <span>{masterConnectionLabel}</span>
          </span>
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
