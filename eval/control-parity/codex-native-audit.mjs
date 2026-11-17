import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyNativeTool } from './native-tool-audit.mjs';
import { canonicalHash, sha256 } from './schema.mjs';

function commandResult(output) {
  if (Array.isArray(output)) {
    if (output.length !== 2 || output.some(item => item.type !== 'input_text' || typeof item.text !== 'string') || !/^Script completed\nWall time [\d.]+ seconds\nOutput:\n$/.test(output[0].text)) return null;
    try { return JSON.parse(output[1].text); } catch { return null; }
  }
  if (typeof output === 'object' && output) return output;
  try { const value = JSON.parse(output); if (typeof value === 'object') return value; } catch { /* Native CLI results can use the text envelope. */ }
  const match = typeof output === 'string' && output.match(/Process exited with code (\d+)[\s\S]*?\n(?:Final output|Output):\n([\s\S]*)$/);
  return match ? { exit_code: Number(match[1]), output: match[2] } : null;
}

export function parseExecWrapper(input) {
  const match = typeof input === 'string' && input.match(/^\s*text\(\s*await\s+tools\.exec_command\(\s*(\{[\s\S]*\})\s*\)\s*\)\s*;?\s*$/);
  if (!match) return null;
  let rest = match[1].slice(1).trimStart();
  const args = {}, allowed = new Set(['cmd', 'max_output_tokens', 'yield_time_ms', 'workdir']);
  while (rest !== '}') {
    const keyMatch = rest.match(/^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z_0-9]*)\s*:\s*/);
    if (!keyMatch) return null;
    let key;
    try { key = keyMatch[1].startsWith('"') ? JSON.parse(keyMatch[1]) : keyMatch[1]; } catch { return null; }
    if (!allowed.has(key) || Object.hasOwn(args, key)) return null;
    rest = rest.slice(keyMatch[0].length);
    const valueMatch = rest.match(/^("(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
    if (!valueMatch) return null;
    try { args[key] = JSON.parse(valueMatch[0]); } catch { return null; }
    rest = rest.slice(valueMatch[0].length).trimStart();
    if (rest.startsWith(',')) { rest = rest.slice(1).trimStart(); if (rest === '}') return null; }
    else if (rest !== '}') return null;
  }
  if (typeof args.cmd !== 'string' || args.workdir !== undefined && typeof args.workdir !== 'string') return null;
  for (const key of ['max_output_tokens', 'yield_time_ms']) if (args[key] !== undefined && (!Number.isInteger(args[key]) || args[key] <= 0)) return null;
  return args;
}

export function auditCodexEvents(events, sample) {
  const tools = [], calls = new Map(), modelIds = new Set(), efforts = new Set(), versions = new Set(), instructionHashes = new Set();
  let promptMatches = 0, taskComplete = false, sessionId = null;
  for (const event of events) {
    const payload = event.payload ?? {};
    if (event.type === 'session_meta') {
      sessionId = payload.id;
      if (payload.cli_version) versions.add(payload.cli_version);
      if (payload.base_instructions) instructionHashes.add(canonicalHash(payload.base_instructions));
    }
    if (event.type === 'turn_context') {
      if (payload.model) modelIds.add(payload.model);
      if (payload.effort) efforts.add(payload.effort);
    }
    if (event.type === 'event_msg' && payload.type === 'task_complete') taskComplete = true;
    if (event.type !== 'response_item') continue;
    if (payload.type === 'message' && payload.role === 'user') {
      const text = (payload.content ?? []).map(c => c.text ?? '').join('\n');
      if (text.includes(sample.prompt.trim())) promptMatches++;
    }
    if (['function_call', 'custom_tool_call'].includes(payload.type)) {
      let args;
      try { args = JSON.parse(payload.arguments); } catch { args = {}; }
      const wrapped = payload.type === 'custom_tool_call' && ['exec', 'functions.exec'].includes(payload.name) ? parseExecWrapper(payload.input) : null;
      if (wrapped) args = wrapped;
      const record = { id: payload.call_id, name: payload.name, input_sha256: canonicalHash(payload.arguments ?? payload.input ?? null), allowed: false, result_seen: false };
      if ((wrapped || ['exec_command', 'functions.exec_command'].includes(payload.name)) && typeof args.cmd === 'string') {
        if (wrapped) record.transport = 'one-literal-exec-command-through-exec';
        const path = sample.reads.find(path => args.cmd === `cat -- ${path}`);
        if (path) Object.assign(record, { allowed: true, path, command_sha256: sha256(args.cmd) });
        else Object.assign(record, classifyNativeTool({ id: payload.call_id, name: 'Bash', input: { command: args.cmd } }, sample), { name: payload.name });
      }
      if (!record.allowed) record.problem ??= 'outside-authorised-native-tools';
      if (calls.has(record.id)) record.problem = 'duplicate-tool-id';
      tools.push(record); calls.set(record.id, record);
    }
    if (['function_call_output', 'custom_tool_call_output'].includes(payload.type) && calls.has(payload.call_id)) {
      const record = calls.get(payload.call_id), result = commandResult(payload.output);
      record.result_seen = true; record.result_sha256 = canonicalHash(payload.output);
      record.is_error = result?.exit_code !== 0 || typeof result?.output !== 'string';
      if (record.path && !record.is_error) {
        record.read_content_sha256 = sha256(result.output);
        record.read_content_bytes = Buffer.byteLength(result.output);
      }
    }
  }
  const firstBridge = tools.findIndex(call => call.port);
  const initialReads = sample.reads.map(path => {
    const expected = sample.read_bindings.find(binding => binding.path === path);
    const read = tools.find((call, index) => index < firstBridge && call.path === path && call.result_seen && !call.is_error && call.read_content_sha256 === expected?.sha256);
    return { path, complete: !!read, content_sha256: read?.read_content_sha256 ?? null, content_bytes: read?.read_content_bytes ?? null };
  });
  const problems = tools.filter(call => !call.allowed || call.is_error || call.problem).map(call => ({ id: call.id, name: call.name, problem: call.problem ?? 'native-command-failed' }));
  if (initialReads.some(read => !read.complete)) problems.push({ problem: 'initial-read-missing-incomplete-or-truncated' });
  if (modelIds.size !== 1 || !modelIds.has('gpt-6-astra') || efforts.size !== 1 || !efforts.has('low')) problems.push({ problem: 'model-or-effort-differs' });
  if (versions.size !== 1 || !versions.has('0.169.0')) problems.push({ problem: 'cli-version-differs' });
  const complete = !!sessionId && promptMatches === 1 && taskComplete && tools.length > 0 && tools.every(call => call.result_seen) && tools.some(call => call.port === 'finish' && call.result_seen && !call.is_error);
  return { name: sample.name, session_id: sessionId, prompt_matches: promptMatches, model_ids: [...modelIds], efforts: [...efforts], versions: [...versions], base_instruction_hashes: [...instructionHashes], tools, initial_reads: initialReads, complete, status: problems.length ? 'fail' : complete ? 'pass' : 'incomplete', problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [rolloutPath, samplePath, outputPath] = process.argv.slice(2);
  if (!outputPath) throw new Error('usage: codex-native-audit.mjs PRIVATE_ROLLOUT SAMPLE NEW_OUTPUT');
  const bytes = readFileSync(rolloutPath), events = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  const report = { schema: 1, scope: 'Only metadata from the explicitly named measurement session is exported. No reasoning, messages, credentials or tool-result contents.', auditor_sha256: sha256(readFileSync(new URL(import.meta.url))), classifier_sha256: sha256(readFileSync(new URL('./native-tool-audit.mjs', import.meta.url))), source_sha256: sha256(bytes), runs: [auditCodexEvents(events, JSON.parse(readFileSync(samplePath)))] };
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ name: report.runs[0].name, status: report.runs[0].status }));
}
