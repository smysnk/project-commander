#!/usr/bin/env node

const { createToolHandlers, toolDefinitions } = require('./tools');
const { version } = require('../package.json');

const protocolVersion = '2024-11-05';
const serverInfo = {
  name: 'project-commander-mcp',
  version,
};

const encodeContentLengthMessage = (message) => {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
};

const sendLineDelimitedMessage = (output, message) => {
  output.write(`${JSON.stringify(message)}\n`);
};

const sendContentLengthMessage = (output, message) => {
  output.write(encodeContentLengthMessage(message));
};

const createErrorResponse = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id,
  error: {
    code,
    message,
    ...(data ? { data } : {}),
  },
});

const createSuccessResponse = (id, result) => ({
  jsonrpc: '2.0',
  id,
  result,
});

const parseToolCallArguments = (params = {}) => {
  if (params.arguments && typeof params.arguments === 'object') {
    return params.arguments;
  }
  if (params.input && typeof params.input === 'object') {
    return params.input;
  }
  return {};
};

const createRequestHandler = ({ handlers = createToolHandlers() } = {}) => async (request) => {
  const { id, method, params } = request || {};
  try {
    if (method === 'initialize') {
      return createSuccessResponse(id, {
        protocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo,
      });
    }

    if (method === 'ping') {
      return createSuccessResponse(id, {});
    }

    if (method === 'tools/list') {
      return createSuccessResponse(id, {
        tools: toolDefinitions,
      });
    }

    if (method === 'tools/call') {
      const name = String(params?.name || '').trim();
      const result = await handlers.callTool(name, parseToolCallArguments(params));
      return createSuccessResponse(id, result);
    }

    if (!id) {
      return null;
    }
    return createErrorResponse(id, -32601, `Unsupported method: ${method}`);
  } catch (error) {
    return createErrorResponse(id, -32000, error?.message || String(error), {
      name: error?.name || 'Error',
      status: error?.status || null,
      errors: error?.errors || undefined,
    });
  }
};

const parseContentLengthFrame = (buffer) => {
  const headerMatch = buffer.match(/^Content-Length:\s*(\d+)\s*(?:\r?\n|$)/iu);
  if (!headerMatch) {
    return null;
  }

  const crlfHeaderEnd = buffer.indexOf('\r\n\r\n');
  const lfHeaderEnd = buffer.indexOf('\n\n');
  const headerEnd = crlfHeaderEnd >= 0
    ? crlfHeaderEnd
    : lfHeaderEnd;
  if (headerEnd < 0) {
    return { incomplete: true };
  }

  const separatorLength = crlfHeaderEnd >= 0 ? 4 : 2;
  const contentLength = Number(headerMatch[1]);
  const bodyStart = headerEnd + separatorLength;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) {
    return { incomplete: true };
  }

  return {
    body: buffer.slice(bodyStart, bodyEnd),
    rest: buffer.slice(bodyEnd),
  };
};

const startLineDelimitedServer = ({ input = process.stdin, output = process.stdout, handlers } = {}) => {
  const handleRequest = createRequestHandler({ handlers });
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.length > 0) {
      buffer = buffer.replace(/^\s+/u, '');
      if (!buffer) {
        break;
      }

      const contentFrame = parseContentLengthFrame(buffer);
      if (contentFrame?.incomplete) {
        break;
      }
      if (contentFrame) {
        buffer = contentFrame.rest;
        let request;
        try {
          request = JSON.parse(contentFrame.body);
        } catch {
          sendContentLengthMessage(output, createErrorResponse(null, -32700, 'Parse error'));
          continue;
        }
        Promise.resolve(handleRequest(request))
          .then((response) => {
            if (response) {
              sendContentLengthMessage(output, response);
            }
          })
          .catch((error) => {
            sendContentLengthMessage(output, createErrorResponse(request?.id || null, -32000, error?.message || String(error)));
          });
        continue;
      }

      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) {
        break;
      }
      const rawLine = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!rawLine) {
        continue;
      }
      let request;
      try {
        request = JSON.parse(rawLine);
      } catch (error) {
        sendLineDelimitedMessage(output, createErrorResponse(null, -32700, 'Parse error', { rawLine }));
        continue;
      }
      Promise.resolve(handleRequest(request))
        .then((response) => {
          if (response) {
            sendLineDelimitedMessage(output, response);
          }
        })
        .catch((error) => {
          sendLineDelimitedMessage(output, createErrorResponse(request?.id || null, -32000, error?.message || String(error)));
        });
    }
  });
};

if (require.main === module) {
  startLineDelimitedServer();
}

module.exports = {
  createRequestHandler,
  encodeContentLengthMessage,
  parseToolCallArguments,
  startLineDelimitedServer,
};
