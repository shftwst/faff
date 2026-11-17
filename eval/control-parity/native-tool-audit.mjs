import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalHash, sha256 } from './schema.mjs';

const unquote = value => /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
const userText = event => {
  if (event.type !== 'user' || event.isMeta) return '';
  const content = event.message?.content;
  return typeof content === 'string' ? content : (content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
};

export function classifyNativeTool(block, sample) {
  const input = block.input ?? {}, record = { id: block.id, name: block.name, allowed: false };
  if (block.name === 'Read') {
    record.path = input.file_path;
    record.allowed = sample.reads.includes(input.file_path);
  } else if (block.name === 'Write') {
    record.path = input.file_path;
    record.content_bytes = Buffer.byteLength(input.content ?? '');
    record.content_sha256 = sha256(input.content ?? '');
    try {
      record.arguments_sha256 = canonicalHash(JSON.parse(input.content));
      record.allowed = sample.fileInput && input.file_path === join(sample.directory, 'bridge-arguments.json');
    } catch { record.problem = 'argument-file-is-not-json'; }
  } else if (block.name === 'Bash') {
    const command = input.command ?? '';
    record.command_sha256 = sha256(command);
    record.command_bytes = Buffer.byteLength(command);
    record.background = input.run_in_background === true;
    const heredoc = command.match(/^([^\n]+)<<'FAFF_JSON'\r?\n([\s\S]*)\r?\nFAFF_JSON\s*$/);
    const head = (heredoc ? heredoc[1] : command).trim().split(/\s+/).map(unquote);
    const expectedLength = sample.fileInput ? 5 : 6;
    if (head.length === expectedLength && ['node', '/usr/local/bin/node'].includes(head[0]) && head[1] === sample.bridge && head[2] === 'call' && head[3] === sample.directory && sample.tools.includes(head[4])) {
      record.port = head[4];
      if (sample.fileInput && !heredoc) record.allowed = true;
      else if (!sample.fileInput && heredoc && head[5] === '-') {
        try { record.arguments_sha256 = canonicalHash(JSON.parse(heredoc[2])); record.allowed = true; }
        catch { record.problem = 'heredoc-is-not-json'; }
      }
    }
    if (!record.allowed) record.problem ??= 'outside-fixed-bridge-command';
  }
  if (!record.allowed) record.problem ??= 'outside-authorised-native-tools';
  return record;
}

export function auditNativeEvents(events, samples) {
  const records = new Map(samples.map(sample => [sample.name, { name: sample.name, prompt_matches: 0, tools: [], model_ids: new Set(), versions: new Set() }]));
  const calls = new Map();
  let active = null;
  for (const event of events) {
    const text = userText(event);
    if (text) {
      active = samples.find(sample => text.includes(sample.prompt.trim())) ?? null;
      if (active) records.get(active.name).prompt_matches++;
    }
    const time = Date.parse(event.timestamp);
    if (active && Number.isFinite(time) && (time < active.start || time > active.end)) active = null;
    if (active) {
      const row = records.get(active.name);
      if (event.version) row.versions.add(event.version);
      if (event.message?.model) row.model_ids.add(event.message.model);
      for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (block?.type !== 'tool_use') continue;
        const inputHash = canonicalHash({ name: block.name, input: block.input });
        if (calls.has(block.id)) {
          const previous = calls.get(block.id);
          previous.log_occurrences++;
          if (previous.input_sha256 !== inputHash) {
            previous.allowed = false;
            previous.problem = 'same-tool-id-with-different-input';
          }
          continue;
        }
        const call = { ...classifyNativeTool(block, active), input_sha256: inputHash, log_occurrences: 1, timestamp: event.timestamp, result_seen: false };
        row.tools.push(call);
        calls.set(block.id, call);
      }
    }
    if (!Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (block.type !== 'tool_result' || !calls.has(block.tool_use_id)) continue;
      const call = calls.get(block.tool_use_id);
      call.result_seen = true;
      call.is_error = call.is_error === true || block.is_error === true;
      call.result_sha256 = canonicalHash(block.content ?? null);
      if (call.is_error) {
        const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        call.error_kind = /merge.fence/i.test(content) ? 'merge-fence' : /permission|safety check/i.test(content) ? 'native-safety-check' : 'other';
      }
      const file = event.toolUseResult?.file;
      if (call.name === 'Read' && typeof file?.content === 'string') {
        call.read_content_sha256 = sha256(file.content);
        call.read_content_bytes = Buffer.byteLength(file.content);
        call.read_lines = { start: file.startLine, count: file.numLines, total: file.totalLines };
      }
    }
  }
  return [...records.values()].map(row => {
    const problems = row.tools.filter(call => !call.allowed || call.is_error).map(call => ({ id: call.id, name: call.name, problem: call.problem ?? call.error_kind }));
    const sample = samples.find(sample => sample.name === row.name);
    const firstBridge = row.tools.findIndex(call => call.port);
    const initialReads = sample.reads.map(path => {
      const reads = row.tools.filter((call, index) => index < firstBridge && call.name === 'Read' && call.path === path && call.result_seen && !call.is_error);
      const completeRead = reads.find(call => call.read_lines?.start === 1 && call.read_lines.count === call.read_lines.total);
      return { path, complete: !!completeRead, content_sha256: completeRead?.read_content_sha256 ?? null, content_bytes: completeRead?.read_content_bytes ?? null };
    });
    if (sample.requireInitialReads && initialReads.some(read => !read.complete)) problems.push({ problem: 'initial-read-missing-or-incomplete' });
    const complete = row.prompt_matches === 1 && row.tools.length > 0 && row.tools.every(call => call.result_seen) && row.tools.some(call => call.port === 'finish' && call.result_seen && !call.is_error);
    return { ...row, model_ids: [...row.model_ids], versions: [...row.versions], initial_reads: initialReads, complete, status: problems.length ? 'fail' : complete ? 'pass' : 'incomplete', problems };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [evidenceArg, outputArg, projectArg, ...planArgs] = process.argv.slice(2);
  if (!planArgs.length) throw new Error('usage: native-tool-audit.mjs EVIDENCE NEW_OUTPUT PROJECT PLAN...');
  const evidence = resolve(evidenceArg), output = resolve(outputArg);
  const samples = planArgs.flatMap(path => {
    const plan = JSON.parse(readFileSync(resolve(path), 'utf8'));
    return plan.samples.map(sample => {
      const directory = join(evidence, 'workflow-runs', sample.name);
      const promptPath = join(directory, 'worker-prompt.txt'), finalPath = join(directory, 'worker-final-state.json');
      if (!existsSync(finalPath)) throw new Error(`sample has not finished: ${sample.name}`);
      return { name: sample.name, directory, prompt: readFileSync(promptPath, 'utf8'), start: statSync(promptPath).mtimeMs - 2000, end: statSync(finalPath).mtimeMs + 2000, reads: [...(plan.context_files ?? []), join(directory, 'task.json')], requireInitialReads: true, bridge: resolve(evidence, '../../..', plan.bridge), fileInput: plan.bridge.endsWith('/mailbox-file-call.mjs'), tools: JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8')).tools.map(tool => tool.name) };
    });
  });
  if (new Set(samples.map(s => s.name)).size !== samples.length) throw new Error('duplicate requested sample');
  const project = resolve(projectArg).replace(/[^a-zA-Z0-9]/g, '-');
  const logs = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects', project);
  const sources = [], runs = new Map(samples.map(s => [s.name, []]));
  if (existsSync(logs)) for (const name of readdirSync(logs).filter(name => name.endsWith('.jsonl'))) {
    const bytes = readFileSync(join(logs, name));
    const text = bytes.toString('utf8');
    if (!samples.some(sample => text.includes(sample.directory))) continue;
    const events = text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    const found = auditNativeEvents(events, samples).filter(run => run.prompt_matches || run.tools.length);
    if (!found.length) continue;
    const source = { file: name, sha256: sha256(bytes), bytes: bytes.length, shape: events.slice(0, 8).map(event => ({ type: event.type, timestamp: event.timestamp, version: event.version, role: event.message?.role, content_types: Array.isArray(event.message?.content) ? event.message.content.map(block => block.type) : typeof event.message?.content })), prompt_times: events.flatMap(event => { const match = samples.find(sample => userText(event).includes(sample.prompt.trim())); return match ? [{ run: match.name, timestamp: event.timestamp, expected_start: new Date(match.start).toISOString(), expected_end: new Date(match.end).toISOString() }] : []; }) };
    sources.push(source);
    for (const run of found) runs.get(run.name).push({ ...run, source_sha256: source.sha256 });
  }
  const results = [...runs].map(([name, matches]) => matches.length === 1 ? matches[0] : { name, status: 'incomplete', problem: matches.length ? 'multiple-session-matches' : 'no-session-match', matches });
  const report = { schema: 1, scope: 'Native tool metadata for explicitly requested fixture sessions only. No model thoughts, assistant prose, credentials, tool-result contents or unrelated conversations are exported.', auditor_sha256: sha256(readFileSync(new URL(import.meta.url))), sources, runs: results };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ exported: output, runs: results.map(({ name, status }) => ({ name, status })) }));
}
