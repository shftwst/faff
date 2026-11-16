"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRecord = isRecord;
exports.readMcpMessages = readMcpMessages;
exports.connectReviewTracker = connectReviewTracker;
// === region:factory — review-comment-mcp - tracker MCP stdio transport ===
const node_child_process_1 = require("node:child_process");
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const PROTOCOL = '2025-06-18';
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function configuration(value) {
    const invalid = () => { throw new Error('invalid review tracker configuration'); };
    if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'args,command,issueArgument,listing,schema,timestampField,tools' || value.schema !== 1)
        return invalid();
    if (typeof value.command !== 'string' || !value.command || /[\x00\r\n]/.test(value.command) || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string' && !arg.includes('\0')))
        return invalid();
    const { tools } = value;
    if (!isRecord(tools) || Object.keys(tools).sort().join(',') !== 'create,list,update')
        return invalid();
    const { list, create, update } = tools;
    if (typeof list !== 'string' || !list || typeof create !== 'string' || !create || typeof update !== 'string' || !update)
        return invalid();
    if (typeof value.issueArgument !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value.issueArgument) || value.issueArgument === 'body' || value.issueArgument === 'id')
        return invalid();
    if (typeof value.timestampField !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value.timestampField) || value.timestampField === 'id' || value.timestampField === 'body')
        return invalid();
    if (value.listing !== 'complete-array' && value.listing !== 'complete-comments')
        return invalid();
    return { command: value.command, args: value.args, tools: { list, create, update }, issueArgument: value.issueArgument, timestampField: value.timestampField, listing: value.listing };
}
function readMcpMessages(input, receive, fail) {
    let buffered = Buffer.alloc(0);
    let failed = false;
    input.on('data', (chunk) => {
        if (failed)
            return;
        try {
            buffered = Buffer.concat([buffered, chunk]);
            let newline;
            while ((newline = buffered.indexOf(10)) !== -1) {
                if (newline > MAX_MESSAGE_BYTES)
                    throw new Error('MCP message exceeds 8 MiB');
                const line = buffered.subarray(0, newline);
                buffered = buffered.subarray(newline + 1);
                const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
                receive(message);
            }
            if (buffered.length > MAX_MESSAGE_BYTES)
                throw new Error('MCP message exceeds 8 MiB');
        }
        catch {
            failed = true;
            fail(new Error('invalid or oversized MCP message'));
        }
    });
    input.on('end', () => { if (!failed && buffered.length)
        fail(new Error('truncated MCP message')); });
    input.on('error', () => fail(new Error('MCP stream failed')));
}
function stdioClient(config, timeoutMs) {
    const child = (0, node_child_process_1.spawn)(config.command, config.args, { shell: false, stdio: ['pipe', 'pipe', 'inherit'] });
    const pending = new Map();
    let nextId = 0;
    let closed = false;
    const close = (error = new Error('tracker transport closed')) => {
        if (closed)
            return;
        closed = true;
        for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        pending.clear();
        child.stdin.destroy();
        child.kill();
        const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
        kill.unref();
        child.once('exit', () => clearTimeout(kill));
    };
    const send = (message) => {
        if (closed)
            throw new Error('tracker transport closed');
        const line = JSON.stringify(message);
        if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES)
            throw new Error('MCP request exceeds 8 MiB');
        child.stdin.write(line + '\n', error => { if (error)
            close(new Error('tracker write failed')); });
    };
    child.on('error', () => close(new Error('tracker process failed')));
    child.on('exit', () => close());
    child.stdin.on('error', () => close());
    child.stdout.on('end', () => close());
    readMcpMessages(child.stdout, message => {
        if (!isRecord(message) || message.jsonrpc !== '2.0')
            throw new Error('invalid JSON-RPC response');
        if (typeof message.method === 'string') {
            if (message.id !== undefined)
                send({ jsonrpc: '2.0', id: message.id, ...(message.method === 'ping' ? { result: {} } : { error: { code: -32601, message: 'client method unsupported' } }) });
            return;
        }
        if (typeof message.id !== 'number')
            throw new Error('invalid response id');
        const entry = pending.get(message.id);
        if (!entry)
            throw new Error('unexpected response id');
        if (('error' in message) === ('result' in message))
            throw new Error('invalid response envelope');
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if ('error' in message)
            entry.reject(new Error('tracker protocol request failed'));
        else
            entry.resolve(message.result);
    }, close);
    return {
        close,
        notify(method) { send({ jsonrpc: '2.0', method }); },
        request(method, params) {
            if (closed)
                return Promise.reject(new Error('tracker transport closed'));
            if (pending.size >= 32)
                return Promise.reject(new Error('too many pending tracker requests'));
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => close(new Error('tracker request timeout')), timeoutMs);
                pending.set(id, { resolve, reject, timer });
                try {
                    send({ jsonrpc: '2.0', id, method, params });
                }
                catch {
                    close(new Error('tracker request could not be sent'));
                }
            });
        },
    };
}
function toolValue(result) {
    if (!isRecord(result) || (result.isError !== undefined && result.isError !== false))
        throw new Error('tracker tool reported an error');
    if (result.structuredContent !== undefined)
        return result.structuredContent;
    if (!Array.isArray(result.content) || result.content.length !== 1)
        throw new Error('tracker tool must return one JSON value');
    const item = result.content[0];
    if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string')
        throw new Error('tracker tool must return JSON text');
    const value = JSON.parse(item.text);
    return value;
}
async function connectReviewTracker(value, options = {}) {
    const config = configuration(value);
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000)
        throw new Error('invalid tracker timeout');
    const client = stdioClient(config, timeoutMs);
    try {
        const init = await client.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'faff-review-comments', version: '1.0.0' } });
        if (!isRecord(init) || init.protocolVersion !== PROTOCOL || !isRecord(init.capabilities) || !isRecord(init.capabilities.tools))
            throw new Error('tracker must support MCP 2025-06-18 tools');
        client.notify('notifications/initialized');
        const names = new Set();
        const cursors = new Set();
        let cursor;
        for (let page = 0;; page++) {
            if (page >= 100)
                throw new Error('tracker tool listing exceeds 100 pages');
            const listed = await client.request('tools/list', cursor === undefined ? {} : { cursor });
            if (!isRecord(listed) || !Array.isArray(listed.tools))
                throw new Error('invalid tracker tool listing');
            for (const tool of listed.tools) {
                if (!isRecord(tool) || typeof tool.name !== 'string' || names.has(tool.name))
                    throw new Error('invalid or duplicate tracker tool');
                names.add(tool.name);
            }
            if (listed.nextCursor === undefined)
                break;
            if (typeof listed.nextCursor !== 'string' || !listed.nextCursor || cursors.has(listed.nextCursor))
                throw new Error('invalid tracker tool cursor');
            cursor = listed.nextCursor;
            cursors.add(cursor);
        }
        for (const name of Object.values(config.tools))
            if (!names.has(name))
                throw new Error(`configured tracker tool unavailable: ${name}`);
    }
    catch (error) {
        client.close();
        throw error;
    }
    const call = async (name, args) => toolValue(await client.request('tools/call', { name, arguments: args }));
    return {
        close: client.close,
        ports: {
            async listComments(issueId) {
                const value = await call(config.tools.list, { [config.issueArgument]: issueId });
                const comments = config.listing === 'complete-comments' && isRecord(value) && Object.keys(value).join(',') === 'comments' ? value.comments : config.listing === 'complete-array' ? value : null;
                if (!Array.isArray(comments))
                    throw new Error('tracker did not return the configured complete comment listing');
                return comments.map((comment) => {
                    if (!isRecord(comment) || typeof comment.id !== 'string' || typeof comment.body !== 'string')
                        throw new Error('invalid tracker comment');
                    return { id: comment.id, body: comment.body, created_at: comment[config.timestampField] ?? null };
                });
            },
            async writeComment(issueId, plan) {
                try {
                    const args = plan.action === 'create' ? { [config.issueArgument]: issueId, body: plan.body } : { id: plan.comment_id ?? '', body: plan.body };
                    const result = await call(plan.action === 'create' ? config.tools.create : config.tools.update, args);
                    if (isRecord(result) && typeof result.id === 'string' && result.id && (plan.action === 'create' || result.id === plan.comment_id) && (result.body === undefined || result.body === plan.body))
                        return { status: 'acknowledged', comment_id: result.id };
                }
                catch { /* A remote error can follow a committed write. */ }
                return { status: 'uncertain', diagnostic: 'tracker did not acknowledge the expected comment; inspect a new live read before any further write' };
            },
        },
    };
}
