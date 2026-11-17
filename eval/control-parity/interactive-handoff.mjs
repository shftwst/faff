// Interactive fixture treatment. Provider accounting stays explicitly unavailable.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { openHandoff, gradeHandoff, readHandoffEvents } from './handoff-tools.mjs';
import { loadInputs } from './run.mjs';
import { canonicalHash, sha256, validateTrace } from './schema.mjs';
import { captureScenario, createFixtureTracker, loadPolicyBytes } from './tracker.mjs';

const ALLOWED = new Set(['prepare_review_comment', 'apply_review_comment', 'finish']);
const MAX_BYTES = 1024 * 1024;
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

export async function callMailbox(directory, name, args, { timeoutMs = 45000, pollMs = 50 } = {}) {
  const id = randomUUID();
  const request = JSON.stringify({ name, args });
  if (Buffer.byteLength(request) > MAX_BYTES) throw new Error('oversized bridge request');
  const pending = join(directory, 'requests', `${id}.tmp`);
  writeFileSync(pending, request, { flag: 'wx' });
  renameSync(pending, join(directory, 'requests', `${id}.json`));
  const response = join(directory, 'responses', `${id}.json`);
  const started = Date.now();
  while (!existsSync(response)) {
    if (Date.now() - started >= timeoutMs) throw new Error('interactive response timeout');
    await delay(pollMs);
  }
  const result = JSON.parse(readFileSync(response, 'utf8'));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export async function serveMailbox(directory, call, { timeoutMs = 180000, pollMs = 50, allowedTools = ALLOWED, maxRequests = 16 } = {}) {
  mkdirSync(join(directory, 'requests'));
  mkdirSync(join(directory, 'responses'));
  const seen = new Set();
  const started = Date.now();
  let rejected = 0;
  while (Date.now() - started < timeoutMs) {
    for (const file of readdirSync(join(directory, 'requests')).sort()) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file) || seen.has(file)) continue;
      seen.add(file);
      let result, finished = false;
      try {
        if (seen.size > maxRequests) throw new Error('interactive call limit');
        const path = join(directory, 'requests', file);
        if (statSync(path).size > MAX_BYTES) throw new Error('oversized bridge request');
        const request = JSON.parse(readFileSync(path, 'utf8'));
        if (!request || Object.keys(request).sort().join(',') !== 'args,name' || !allowedTools.has(request.name)) throw new Error('unknown tool or malformed request');
        const value = await call(request.name, request.args);
        result = { ok: true, value };
        finished = request.name === 'finish' && value?.finished === true;
      } catch (error) {
        rejected++;
        result = { ok: false, error: error.message };
      }
      const pending = join(directory, 'responses', `${file}.tmp`);
      write(pending, result);
      renameSync(pending, join(directory, 'responses', file));
      if (finished) return { stop: null, requests: seen.size, rejected };
      if (seen.size >= maxRequests) return { stop: { reason: 'interactive-call-limit' }, requests: seen.size, rejected };
    }
    await delay(pollMs);
  }
  return { stop: { reason: 'interactive-timeout' }, requests: seen.size, rejected };
}

export async function runInteractiveHandoff(root, commit, output) {
  const binding = bindCandidateCommand(root, commit);
  const inputs = loadInputs(root);
  const scenario = inputs.registry.scenarios.find(s => s.id === 'crlf-outside-region');
  const fixture = inputs.fixtures.get(scenario.id);
  const released = execFileSync('git', ['show', '690546db64e3de7a68058a98a9945bfb731e68b3:plugin/skills/faff/references/review.md'], { cwd: root, encoding: 'utf8' });
  const start = released.indexOf('### Review-findings comment identity');
  const end = released.indexOf('### Producer slots', start);
  assert.ok(start >= 0 && end > start);
  const oraclePolicy = Buffer.from(released.slice(start, end));
  assert.equal(sha256(oraclePolicy), scenario.policy_sha256);
  const policy = loadPolicyBytes(root).toString('utf8');
  const task = {
    treatment: 'interactive-stored-handoff-v1',
    instructions: 'Apply this policy to the fixture issue using only prepare_review_comment, apply_review_comment and finish through the CLI bridge. Supply issue_id and faff_body exactly as given to prepare. Apply only the returned plan_ref. Do not reconstruct or write a tracker body. Finish only after the connector acknowledges the write. Read no tracker state, oracle, server source or other files; do not edit files or run other commands.',
    policy,
    input: { issue_id: fixture.issue_id, faff_body: fixture.faff_body },
    call_usage: 'node BRIDGE_SCRIPT call OUTPUT_DIRECTORY TOOL_NAME JSON_ARGUMENT_OBJECT',
  };
  const harnessHash = sha256(readFileSync(new URL(import.meta.url)));
  const runtime = canonicalHash({ node: process.version, harness: harnessHash, tools: [...ALLOWED], protocol: 'file-mailbox-to-production-MCP-connector' });
  mkdirSync(output);
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), {
    schema: 1, treatment: task.treatment, binding,
    fixture_sha256: canonicalHash(fixture), oracle_sha256: canonicalHash(scenario.expected),
    policy_sha256: sha256(policy), task_sha256: canonicalHash(task), harness_sha256: harnessHash,
    runtime_sha256: runtime,
    limits: { attempts: 1, max_calls: 16, timeout_ms: 180000 },
    scope: 'One interactive Claude fixture run. Bash/file capabilities differ from the restricted MCP proxy treatment. Provider usage, actual request count and billed cost are unmetered. This cannot satisfy the original accounting gate.',
  });
  const directory = join(output, 'tracker');
  let bridge;
  const trace = await captureScenario({
    driver: async () => {
      const handoff = await openHandoff({ binding, directory });
      try {
        write(join(output, 'ready.json'), { ready: true, tools: handoff.definitions });
        bridge = await serveMailbox(output, handoff.call);
        return { stop: bridge.stop };
      } finally { handoff.close(); }
    },
    fixture, registryEntry: scenario, directory, policyBytes: oraclePolicy,
    promptSha256: canonicalHash(task), runtimeSha256: runtime,
  });
  write(join(output, 'trace.json'), trace);
  const tracker = createFixtureTracker({ directory });
  const grade = validateTrace(trace, scenario, inputs.registry);
  const handoff = gradeHandoff({ calls: readHandoffEvents(directory), events: tracker.readEvents(), fixture, stop: trace.stop });
  assertCandidateCommandUnchanged(binding);
  assert.equal(sha256(readFileSync(new URL(import.meta.url))), harnessHash);
  const behaviourPassed = !trace.stop && !grade.failures.length && handoff.status === 'followed' && bridge?.rejected === 0;
  const report = {
    treatment: task.treatment,
    behaviour_status: behaviourPassed ? 'pass' : 'fail',
    original_trace_grade: grade,
    handoff, bridge,
    accounting_status: 'unavailable',
    scope: 'Actual fixture reads, write attempts, acknowledgements and terminal state; not paired acceptance, hosted tracker qualification or metered usage.',
  };
  write(join(output, 'report.json'), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === 'call' && args.length === 3) {
    console.log(JSON.stringify(await callMailbox(resolve(args[0]), args[1], JSON.parse(args[2]))));
  } else if (operation === 'serve' && args.length === 3) {
    const report = await runInteractiveHandoff(resolve(args[0]), args[1], resolve(args[2]));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.behaviour_status === 'pass' ? 0 : 1;
  } else throw new Error('usage: interactive-handoff.mjs serve ROOT COMMIT NEW_OUTPUT | call OUTPUT TOOL JSON_ARGS');
}
