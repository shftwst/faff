import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parseExecWrapper } from './codex-native-audit.mjs';
import { structuredHash } from './mailbox-mcp.mjs';
import { createPolicyReader } from './policy-reader.mjs';
import { sha256 } from './schema.mjs';

export function parseMcpWrapper(input) {
  const match = typeof input === 'string' && input.match(/^\s*text\(await tools\.mcp__measurement__([a-z_]+)\((\{[\s\S]*\})\)\);?\s*$/);
  if (!match) return null;
  try { return { name: match[1], args: JSON.parse(match[2]) }; } catch { return null; }
}

function unwrap(output) {
  if (!Array.isArray(output) || output.length !== 2 || output.some(item => item.type !== 'input_text' || typeof item.text !== 'string') || !/^Script completed\nWall time [\d.]+ seconds\nOutput:\n$/.test(output[0].text)) return null;
  try { return JSON.parse(output[1].text); } catch { return null; }
}

export async function auditMcpEvidence(evidence) {
  const { events, sample, task, trace, requests, responses, protocolErrors, report, capture, serverManifest, policy } = evidence;
  const problems = [], calls = [], models = new Set(), efforts = new Set(), versions = new Set(), sessions = new Set(), instructions = new Set();
  const problem = (code, detail = null) => problems.push({ code, detail });
  const check = (condition, code, detail = null) => { if (!condition) problem(code, detail); };
  let promptMatches = 0, userMessages = 0, completed = 0, outstanding = null;
  check([sample.prompt, sample.model, sample.effort, sample.cli_version, sample.session_id].every(value => typeof value === 'string' && value.length > 0) && Array.isArray(sample.reads) && sample.reads.length === 3 && sample.reads.every(row => typeof row.path === 'string' && /^[a-f0-9]{64}$/.test(row.sha256)), 'expected-metadata-invalid');
  check(Array.isArray(trace) && Array.isArray(protocolErrors) && Array.isArray(capture.events) && Array.isArray(capture.errors) && Array.isArray(sample.startup_context) && sample.startup_context.length === 2, 'evidence-shape-invalid');
  const seen = new Set();
  for (const event of events) {
    const p = event.payload ?? {};
    if (event.type === 'session_meta') {
      sessions.add(p.id); versions.add(p.cli_version);
      if (p.base_instructions) instructions.add(structuredHash(p.base_instructions));
    }
    if (event.type === 'turn_context') { models.add(p.model); efforts.add(p.effort); }
    if (event.type === 'event_msg' && p.type === 'task_complete') { check(outstanding === null && calls.length > 0, 'premature-worker-completion'); completed++; }
    if (event.type !== 'response_item') continue;
    if (p.type === 'message' && p.role === 'user') {
      userMessages++;
      const parts = (p.content ?? []).map(c => c.text);
      check(calls.length === 0 && completed === 0 && p.content?.every(c => c.type === 'input_text'), 'user-context-order-or-type');
      if (userMessages === 1) check(isDeepStrictEqual(parts, sample.startup_context), 'startup-context-differs');
      else if (userMessages === 2 && parts.length === 1 && parts[0] === sample.prompt.trim()) promptMatches++;
    }
    check(['message', 'reasoning', 'function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(p.type), 'unsupported-native-response-item', p.type);
    if (['function_call', 'custom_tool_call'].includes(p.type)) {
      check(completed === 0, 'native-call-after-completion', p.call_id);
      check(outstanding === null, 'overlapping-native-call', p.call_id);
      check(typeof p.call_id === 'string' && !seen.has(p.call_id), 'duplicate-or-invalid-native-id', p.call_id);
      seen.add(p.call_id);
      const wrapper = p.type === 'custom_tool_call' && ['exec', 'functions.exec'].includes(p.name);
      const read = wrapper ? parseExecWrapper(p.input) : null;
      const mcp = wrapper ? parseMcpWrapper(p.input) : null;
      const call = { id: p.call_id, read, mcp, result: null, results: 0, input_sha256: structuredHash(p.input ?? p.arguments ?? null) };
      check(!!read || !!mcp, 'unauthorised-native-call', p.call_id);
      calls.push(call); outstanding = call;
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      check(completed === 0, 'native-result-after-completion', p.call_id);
      const call = calls.find(c => c.id === p.call_id);
      if (!call) { problem('orphan-native-result', p.call_id); continue; }
      check(outstanding === call, 'out-of-order-native-result', p.call_id);
      call.results++; call.result = unwrap(p.output);
      call.result_sha256 = structuredHash(p.output);
      outstanding = null;
    }
  }
  check(models.size === 1 && models.has(sample.model), 'model-differs');
  check(efforts.size === 1 && efforts.has(sample.effort), 'effort-differs');
  check(versions.size === 1 && versions.has(sample.cli_version), 'cli-version-differs');
  check(sessions.size === 1 && sessions.has(sample.session_id), 'session-differs');
  check(promptMatches === 1 && userMessages === 2 && completed === 1 && sample.exit_code === 0, 'worker-incomplete-or-prompt-differs');
  check(calls.every(c => c.results === 1 && c.result !== null), 'missing-duplicate-or-malformed-native-result');
  const initialReads = sample.reads.map((binding, index) => {
    const call = calls[index], valid = call?.read?.cmd === `cat -- ${binding.path}` && call.read.max_output_tokens === 12000 && call.read.yield_time_ms === 10000 && call.result?.exit_code === 0 && typeof call.result?.output === 'string' && sha256(call.result.output) === binding.sha256;
    check(valid, 'initial-read-missing-incomplete-or-truncated', binding.path);
    return { path: binding.path, complete: !!valid, sha256: valid ? sha256(call.result.output) : null };
  });
  const native = calls.slice(sample.reads.length);
  check(native.length === trace.length && native.length > 0 && native.every(c => c.mcp && !c.read), 'native-trace-count-or-allowlist');
  check(protocolErrors.length === 0, 'protocol-errors');
  check(serverManifest.server_sha256 === sample.server_sha256 && serverManifest.mailbox_sha256 === sample.mailbox_sha256, 'server-code-binding-differs');
  check(serverManifest.task_sha256 === sample.task_sha256 && serverManifest.tools_sha256 === structuredHash(task.tools), 'task-tools-binding-differs');
  check(isDeepStrictEqual(sample.server_tools, task.tools.map(t => t.name)), 'tool-allowlist-differs');
  const reader = createPolicyReader(policy), readOrAct = reader.guard(async (_name, _args) => null);
  check(isDeepStrictEqual(task.policy, reader.metadata), 'registered-policy-differs');
  const ids = new Set(), rpcIds = new Set(), operations = [];
  let finished = false;
  for (let index = 0; index < trace.length; index++) {
    const row = trace[index], call = native[index];
    try {
      check(row.seq === index + 1 && !row.error && !row.attribution_error, 'trace-order-or-error', index + 1);
      check((typeof row.rpc_id === 'string' && row.rpc_id.length > 0 || Number.isSafeInteger(row.rpc_id) && row.rpc_id >= 0) && !rpcIds.has(row.rpc_id), 'duplicate-or-invalid-rpc-id', index + 1);
      rpcIds.add(row.rpc_id);
      check(typeof row.mailbox_id === 'string' && /^[a-f0-9-]{36}$/.test(row.mailbox_id) && !ids.has(row.mailbox_id), 'duplicate-or-invalid-mailbox-id', index + 1);
      ids.add(row.mailbox_id);
      const name = row.mailbox_id + '.json', reqBytes = requests[name], resBytes = responses[name];
      check(!!reqBytes && !!resBytes, 'missing-mailbox-file', index + 1);
      if (!reqBytes || !resBytes) continue;
      const req = JSON.parse(reqBytes), res = JSON.parse(resBytes);
      check(row.request_sha256 === sha256(reqBytes) && row.response_sha256 === sha256(resBytes), 'mailbox-file-hash-differs', index + 1);
      check(isDeepStrictEqual(req, { name: row.tool, args: call?.mcp?.args }) && call?.mcp?.name === row.tool && row.arguments_sha256 === structuredHash(req.args), 'request-attribution-differs', index + 1);
      check(res.ok === true && row.value_sha256 === structuredHash(res.value), 'mailbox-response-differs', index + 1);
      const expectedResult = { content: [{ type: 'text', text: JSON.stringify(res.value) }], isError: false };
      check(isDeepStrictEqual(call?.result, expectedResult) && row.result_sha256 === structuredHash(expectedResult), 'native-mcp-result-differs', index + 1);
      check(task.tools.some(t => t.name === row.tool), 'tool-outside-task', row.tool);
      check(!finished, 'operation-after-finish', index + 1);
      const expectedPolicy = await readOrAct(row.tool, req.args);
      if (row.tool === 'read_policy') check(isDeepStrictEqual(res.value, expectedPolicy), 'policy-result-differs', index + 1);
      else operations.push({ name: req.name, args: req.args, result: res.value });
      if (row.tool === 'finish') { finished = true; check(res.value?.finished === true && index === trace.length - 1, 'finish-not-acknowledged-or-not-last'); }
    } catch (error) { problem('invalid-trace-or-policy', { index: index + 1, message: error.message }); }
  }
  check(finished && operations.filter(r => r.name === 'finish').length === 1, 'missing-or-duplicate-finish');
  const expectedFiles = [...ids].map(id => id + '.json').sort();
  check(isDeepStrictEqual(Object.keys(requests).sort(), expectedFiles) && isDeepStrictEqual(Object.keys(responses).sort(), expectedFiles), 'orphan-mailbox-files');
  check(reader.capture().complete && isDeepStrictEqual(reader.capture(), report.policy_delivery), 'reported-policy-delivery-differs');
  check(report.bridge?.requests === trace.length && report.bridge?.rejected === 0 && report.bridge?.stop === null, 'bridge-report-differs');
  check(Array.isArray(capture.errors) && capture.errors.length === 0 && operations.length === capture.events?.length && operations.every((op, index) => {
    const actual = capture.events[index];
    return actual.seq === index + 1 && isDeepStrictEqual(op, { name: actual.name, args: actual.args, result: actual.result });
  }), 'capture-operation-bijection-differs');
  return { status: problems.length ? 'fail' : 'pass', session_id: sample.session_id, model_ids: [...models], efforts: [...efforts], versions: [...versions], base_instruction_hashes: [...instructions], initial_reads: initialReads, native_calls: calls.length, mcp_calls: trace.length, policy_reads: reader.capture().reads.length, problems };
}

export async function auditMcpDirectory(nativePath, directory, policyPath) {
  const read = name => readFileSync(join(directory, name));
  const json = name => JSON.parse(read(name));
  const rows = name => read(name).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
  const worker = json('worker-manifest.json'), state = json('worker-final-state.json'), startup = json('startup-binding.json');
  const bytes = readFileSync(nativePath), taskBytes = read('task.json'), task = JSON.parse(taskBytes);
  const sample = { startup_context: startup.context, prompt: read('worker-prompt.txt').toString('utf8'), model: worker.requested_model, effort: worker.effort, cli_version: '0.169.0', session_id: state.thread_ids?.[0], exit_code: state.exit_code, reads: worker.reads, server_tools: worker.server_tools, server_sha256: worker.server_sha256, mailbox_sha256: sha256(readFileSync(new URL('./interactive-handoff.mjs', import.meta.url))), task_sha256: sha256(taskBytes) };
  const files = name => Object.fromEntries(readdirSync(join(directory, name)).map(file => [file, readFileSync(join(directory, name, file))]));
  const evidence = { events: bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse), sample, task, trace: rows('mcp-trace.jsonl'), protocolErrors: rows('mcp-protocol-errors.jsonl'), requests: files('requests'), responses: files('responses'), serverManifest: json('mcp-server-manifest.json'), report: json('report.json'), capture: json('capture.json'), policy: readFileSync(policyPath) };
  const audit = await auditMcpEvidence(evidence);
  if (sha256(sample.prompt) !== worker.prompt_sha256 || state.thread_ids?.length !== 1 || !worker.reads.some(binding => binding.path === join(directory, 'task.json') && binding.sha256 === sample.task_sha256)) {
    audit.status = 'fail'; audit.problems.push({ code: 'worker-manifest-binding-differs' });
  }
  return { schema: 1, scope: 'Native structured transport and unchanged mailbox attribution. Semantic fidelity, case completion and production runtime binding require the separately recorded workflow grade and integration checks. No reasoning or tool content is exported.', auditor_sha256: sha256(readFileSync(new URL(import.meta.url))), source_sha256: sha256(bytes), evidence_hashes: Object.fromEntries(['task.json', 'startup-binding.json', 'worker-manifest.json', 'worker-final-state.json', 'mcp-server-manifest.json', 'mcp-trace.jsonl', 'mcp-protocol-errors.jsonl', 'capture.json', 'report.json'].map(name => [name, sha256(read(name))])), runs: [audit] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [nativePath, directory, policyPath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: codex-mcp-native-audit.mjs PRIVATE_NATIVE RUN_DIRECTORY POLICY_FILE NEW_OUTPUT');
  const result = await auditMcpDirectory(nativePath, resolve(directory), policyPath);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.runs[0].status, calls: result.runs[0].mcp_calls, problems: result.runs[0].problems }));
  process.exitCode = result.runs[0].status === 'pass' ? 0 : 1;
}
