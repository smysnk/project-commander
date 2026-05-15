const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  createRequestHandler,
  startLineDelimitedServer,
} = require('../src/server');
const { createToolHandlers, toolDefinitions } = require('../src/tools');

test('tools/list exposes project commander lifecycle tools', async () => {
  const handleRequest = createRequestHandler({
    handlers: createToolHandlers({
      client: {},
    }),
  });

  const response = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });

  assert.equal(response.id, 1);
  const names = response.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('project_commander.list_hosts'));
  assert.ok(names.includes('project_commander.resolve_host_path'));
  assert.ok(names.includes('project_commander.upsert_host_path_mapping'));
  assert.ok(names.includes('project_commander.ensure_process'));
  assert.ok(names.includes('project_commander.wait_for_runtime'));
});

test('tools/call routes list_hosts to the client', async () => {
  const handlers = createToolHandlers({
    client: {
      async listHosts() {
        return [{ id: 3, name: 'clearbox' }];
      },
    },
  });
  const handleRequest = createRequestHandler({ handlers });

  const response = await handleRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'project_commander.list_hosts',
      arguments: {},
    },
  });

  assert.equal(response.id, 2);
  assert.equal(response.result.content[0].type, 'text');
  assert.match(response.result.content[0].text, /clearbox/);
});

test('tool definitions all have object input schemas', () => {
  for (const tool of toolDefinitions) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
  }
});

test('tools/call routes resolve_host_path to the client', async () => {
  const handlers = createToolHandlers({
    client: {
      async resolveHostPath(input) {
        return {
          inputPath: input.path,
          hostPath: '/opt/project-commander/slave/play/varcad.io',
        };
      },
    },
  });
  const handleRequest = createRequestHandler({ handlers });

  const response = await handleRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'project_commander.resolve_host_path',
      arguments: {
        host: 'clearbox',
        path: '/Volumes/public-1/play/varcad.io',
      },
    },
  });

  assert.equal(response.id, 4);
  assert.match(response.result.content[0].text, /\/opt\/project-commander\/slave\/play\/varcad\.io/);
});

test('stdio server accepts MCP Content-Length frames', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let outputBuffer = '';
  const responsePromise = new Promise((resolve) => {
    output.on('data', (chunk) => {
      outputBuffer += chunk.toString('utf8');
      const headerEnd = outputBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }
      const header = outputBuffer.slice(0, headerEnd);
      const contentLength = Number(header.match(/Content-Length:\s*(\d+)/iu)?.[1] || 0);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;
      if (outputBuffer.length >= bodyEnd) {
        resolve(JSON.parse(outputBuffer.slice(bodyStart, bodyEnd)));
      }
    });
  });

  startLineDelimitedServer({
    input,
    output,
    handlers: createToolHandlers({
      client: {
        async listHosts() {
          return [{ id: 3, name: 'clearbox' }];
        },
      },
    }),
  });

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'project_commander.list_hosts',
      arguments: {},
    },
  });
  input.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);

  const response = await responsePromise;
  assert.equal(response.id, 5);
  assert.match(response.result.content[0].text, /clearbox/);
});
