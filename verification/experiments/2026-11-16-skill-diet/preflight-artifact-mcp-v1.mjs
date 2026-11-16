import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runRenderingArtifacts, gradeRenderingCapture } from '../../../eval/control-parity/rendering-artifact.mjs';
import { createMcpMailbox } from '../../../eval/control-parity/mailbox-mcp.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const evidence = import.meta.dirname, planPath = resolve(process.argv[2]), output = resolve(process.argv[3]);
const read = path => JSON.parse(readFileSync(path));
const plan = read(planPath), fixture = read(join(evidence, plan.fixture));
const running = runRenderingArtifacts({ root: plan.runtime_root, commit: plan.runtime_commit, policyPath: join(evidence, plan.samples[0].policy), fixturePath: join(evidence, plan.fixture), output });
const mcp = createMcpMailbox(output);
let calls = 0;
async function call(name, args) {
  const result = await mcp.call(++calls, name, args);
  assert.equal(result.isError, false);
  return JSON.parse(result.content[0].text);
}
let offset = 0;
while (offset !== null) offset = (await call('read_policy', { offset })).next_offset;
for (const row of fixture.cases) await call('write_output', { case_id: row.id, text: row.reference });
for (const row of fixture.rule_cases) await call('answer_rule', { case_id: row.id, value: row.expected });
await call('finish', {});
const report = await running, capture = read(join(output, 'capture.json'));
assert.equal(report.status, 'pass');
for (const row of fixture.cases) {
  const changed = structuredClone(capture); changed.outputs = changed.outputs.filter(item => item.id !== row.id);
  assert.equal(gradeRenderingCapture(changed, fixture).status, 'fail');
}
for (const row of fixture.rule_cases) {
  const changed = structuredClone(capture); changed.rule_answers = changed.rule_answers.filter(item => item.id !== row.id);
  assert.equal(gradeRenderingCapture(changed, fixture).status, 'fail');
}
const paths = ['mcp-trace.jsonl', 'mcp-server-manifest.json', 'task.json', 'manifest.json', 'capture.json', 'report.json'];
const result = { schema: 1, status: 'pass', scope: 'Deterministic reference-output MCP preflight only, no model measurement or source acceptance.', calls, artifacts: fixture.cases.length, decisions: fixture.rule_cases.length, omitted_outputs_rejected: fixture.cases.length + fixture.rule_cases.length, client_sha256: sha256(readFileSync(new URL(import.meta.url))), plan_sha256: sha256(readFileSync(planPath)), hashes: Object.fromEntries(paths.map(path => [path, sha256(readFileSync(join(output, path)))])) };
writeFileSync(join(output, 'preflight.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, calls, artifacts: result.artifacts, decisions: result.decisions }));
