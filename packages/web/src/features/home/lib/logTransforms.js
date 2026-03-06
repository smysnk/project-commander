export const MASTER_LOG_SOURCES = ['master-agent', 'agent-master'];
export const RUNTIME_LOG_SOURCES = ['nextjs-client', 'node-backend', ...MASTER_LOG_SOURCES];
export const LOG_LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
export const LOG_LEVEL_LABEL_MAP = {
  trace: 'Trace',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
  fatal: 'Fatal',
};
export const LOG_LEVEL_LETTER_MAP = {
  trace: 'T',
  debug: 'D',
  info: 'I',
  warn: 'W',
  error: 'E',
  fatal: 'F',
};
export const LOG_LEVEL_COLOR_MAP = {
  trace: '#7a8aa0',
  debug: '#5f8ed6',
  info: '#1eaa66',
  warn: '#c98a00',
  error: '#d14b4b',
  fatal: '#b032a8',
};

export const normalizeLogLevelName = (value) => {
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

export const resolveLogLevelFromMessage = (value) => {
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

export const resolveLogLevelForEntry = (entry) => {
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

export const toOverlaySource = (entry) => (
  String(entry?.source || entry?.serviceName || '').trim().toLowerCase()
);

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

export const applyAnsiColorCodes = (input) => {
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

export const tryFormatJsonPayload = (value) => {
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

export const extractHueFromColor = (value) => {
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

export const getServiceColorMap = (serviceNames, primaryHue) => {
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

export const sortLogEntries = (entries) => {
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

export const formatLogText = (entry) => {
  const segments = applyAnsiColorCodes(entry?.message);
  const plainMessage = segments.map((segment) => segment.text).join('');
  const formattedJson = tryFormatJsonPayload(plainMessage);
  return formattedJson || plainMessage;
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

export const buildLogStreams = (entries) => {
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

export const buildLogsContextDescriptor = ({
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
      hostAgentUuid: String(selectedHost.agentUuid || selectedHost.slaveId || '').trim() || null,
    };
  }
  return {
    scope: 'runtime',
    contextKey: 'runtime',
    projectPath: null,
    hostId: null,
    hostName: null,
    hostIp: null,
    hostAgentUuid: null,
  };
};

const normalizeLogsQueryLines = (lines) => (
  (Array.isArray(lines) ? lines : []).map((line, index) => ({
    ...line,
    id: String(line?.id || `query-line-${index}`).trim() || `query-line-${index}`,
    __lineText: formatLogText(line),
  }))
);

export const normalizeLogsQueryStreams = (streams) => (
  (Array.isArray(streams) ? streams : [])
    .map((stream) => ({
      streamId: String(stream?.streamId || '').trim(),
      totalLines: Math.max(0, Number.parseInt(stream?.totalLines, 10) || 0),
      offset: Math.max(0, Number.parseInt(stream?.offset, 10) || 0),
      lines: normalizeLogsQueryLines(stream?.lines),
    }))
    .filter((stream) => stream.streamId.length > 0)
);
