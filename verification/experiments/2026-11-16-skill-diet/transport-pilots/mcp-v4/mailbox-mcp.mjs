import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { callMailbox } from './interactive-handoff.mjs';
import { sha256 } from './schema.mjs';

export function structuredHash(value) {
  const normalise = item => {
    if (Array.isArray(item)) return item.map(normalise);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, normalise(item[key])]));
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('non-finite JSON number');
    if (item === undefined) throw new Error('undefined JSON value');
    return item;
  };
  return sha256(JSON.stringify(normalise(value)));
}

function validId(id) {
  return typeof id === 'string' && id.length > 0 || Number.isSafeInteger(id) && id >= 0;
}

function validateSchema(schema, value, path = 'arguments') {
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minimum', 'enum', 'description']);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || Object.keys(schema).some(key => !allowed.has(key))) throw new Error('unsupported task schema');
  const types = { object: value !== null && typeof value === 'object' && !Array.isArray(value), array: Array.isArray(value), string: typeof value === 'string', integer: Number.isSafeInteger(value), number: typeof value === 'number' && Number.isFinite(value), boolean: typeof value === 'boolean', null: value === null };
  if (schema.type && !types[schema.type]) throw new Error(`${path}: expected ${schema.type}`);
  if (schema.enum && !schema.enum.some(item => isDeepStrictEqual(item, value))) throw new Error(`${path}: outside enum`);
  if (schema.minimum !== undefined && !(value >= schema.minimum)) throw new Error(`${path}: below minimum`);
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) throw new Error(`${path}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) validateSchema(schema.properties[key], item, `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path}: extra ${key}`);
    }
  }
  if (schema.type === 'array' && schema.items) value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`));
}

export function createMcpMailbox(directory, { timeoutMs = 45000 } = {}) {
  const taskBytes = readFileSync(join(directory, 'task.json'));
  const task = JSON.parse(taskBytes), tools = task.tools;
  if (!Array.isArray(tools) || new Set(tools.map(t => t.name)).size !== tools.length || !tools.some(t => t.name === 'finish')) throw new Error('invalid task tools');
  for (const name of ['requests', 'responses']) readdirSync(join(directory, name));
  const manifest = {
    schema: 1, server: 'measurement', task_sha256: sha256(taskBytes), tools_sha256: structuredHash(tools),
    server_sha256: sha256(readFileSync(new URL(import.meta.url))), mailbox_sha256: sha256(readFileSync(new URL('./interactive-handoff.mjs', import.meta.url))),
  };
  writeFileSync(join(directory, 'mcp-server-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const tracePath = join(directory, 'mcp-trace.jsonl');
  writeFileSync(tracePath, '', { flag: 'wx' });
  const ids = new Set();
  let sequence = 0, finished = false, pending = Promise.resolve();
  const requestNames = () => readdirSync(join(directory, 'requests')).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
  return {
    tools,
    manifest,
    call(rpcId, name, args) {
      const next = pending.then(() => execute(rpcId, name, args));
      pending = next.catch(() => {});
      return next;
    },
  };
  async function execute(rpcId, name, args) {
      const trace = { seq: ++sequence, rpc_id: rpcId ?? null, tool: name ?? null, arguments_sha256: null, mailbox_id: null, request_sha256: null, response_sha256: null, value_sha256: null };
      let result;
      let before = new Set();
      try {
        before = new Set(requestNames());
        if (!validId(rpcId)) throw new Error('invalid MCP request id');
        trace.arguments_sha256 = structuredHash(args);
        if (ids.has(rpcId)) throw new Error('duplicate MCP request id');
        ids.add(rpcId);
        if (finished) throw new Error('call after finish');
        if (!tools.some(t => t.name === name) || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('unknown tool or malformed arguments');
        validateSchema(tools.find(t => t.name === name).inputSchema, args);
        const value = await callMailbox(directory, name, args, { timeoutMs });
        const added = requestNames().filter(n => !before.has(n));
        if (added.length !== 1) throw new Error('mailbox request attribution is not unique');
        trace.mailbox_id = added[0].slice(0, -5);
        const requestBytes = readFileSync(join(directory, 'requests', added[0]));
        const responseBytes = readFileSync(join(directory, 'responses', added[0]));
        const request = JSON.parse(requestBytes), response = JSON.parse(responseBytes);
        if (!isDeepStrictEqual(request, { name, args }) || response.ok !== true || !isDeepStrictEqual(response.value, value)) throw new Error('mailbox result differs');
        trace.request_sha256 = sha256(requestBytes);
        trace.response_sha256 = sha256(responseBytes);
        trace.value_sha256 = structuredHash(value);
        result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
        finished = name === 'finish' && value?.finished === true;
      } catch (error) {
        trace.error = error.message;
        try {
          const added = requestNames().filter(n => !before.has(n));
          if (added.length === 1) {
          trace.mailbox_id = added[0].slice(0, -5);
          trace.request_sha256 = sha256(readFileSync(join(directory, 'requests', added[0])));
            try { trace.response_sha256 = sha256(readFileSync(join(directory, 'responses', added[0]))); } catch { /* A timeout has no response. */ }
          }
        } catch (attributionError) { trace.attribution_error = attributionError.message; }
        result = { content: [{ type: 'text', text: error.message }], isError: true };
      }
      trace.result_sha256 = structuredHash(result);
      appendFileSync(tracePath, JSON.stringify(trace) + '\n');
      return result;
  }
}

export async function serveMcpMailbox(directory, { input = process.stdin, output = process.stdout } = {}) {
  const bridge = createMcpMailbox(directory), lines = createInterface({ input, crlfDelay: Infinity });
  const send = value => output.write(JSON.stringify(value) + '\n');
  const protocolPath = join(directory, 'mcp-protocol-errors.jsonl');
  writeFileSync(protocolPath, '', { flag: 'wx' });
  const ids = new Set();
  let initialized = false;
  for await (const line of lines) {
    let request;
    try {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('oversized MCP request');
      request = JSON.parse(line);
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') throw new Error('invalid JSON-RPC request');
      if (request.method === 'notifications/initialized' && request.id === undefined && initialized) continue;
      if (!validId(request.id)) throw new Error('invalid JSON-RPC request id');
      if (ids.has(request.id)) throw new Error('duplicate JSON-RPC request id');
      ids.add(request.id);
      let result;
      if (request.method === 'initialize') {
        if (initialized) throw new Error('duplicate initialize');
        initialized = true;
        const supported = ['2024-11-05', '2025-03-26'];
        result = { protocolVersion: supported.includes(request.params?.protocolVersion) ? request.params.protocolVersion : supported[0], capabilities: { tools: {} }, serverInfo: { name: 'faff-diet-mailbox', version: '1' } };
      } else if (!initialized) throw new Error('initialize required');
      else if (request.method === 'ping') result = {};
      else if (request.method === 'tools/list') result = { tools: bridge.tools };
      else if (request.method === 'tools/call') result = await bridge.call(request.id, request.params?.name, request.params?.arguments === undefined ? {} : request.params.arguments);
      else throw new Error('unsupported MCP method');
      send({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      const response = { jsonrpc: '2.0', id: validId(request?.id) ? request.id : null, error: { code: -32600, message: error.message } };
      appendFileSync(protocolPath, JSON.stringify({ input_sha256: sha256(line), response_sha256: structuredHash(response), error: error.message }) + '\n');
      send(response);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('usage: mailbox-mcp.mjs RUN_DIRECTORY');
  await serveMcpMailbox(resolve(process.argv[2]));
}
