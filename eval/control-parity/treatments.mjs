import { canonicalHash, projection, validateTrace } from './schema.mjs';
import { HARNESS_INSTRUCTION, CANDIDATE_HARNESS_INSTRUCTION } from './claude-driver.mjs';
import { COMMAND_TOOL } from './command-use.mjs';

export function treatmentRuntime(body, userPrompt, { candidate = false } = {}) {
  const copy = structuredClone(body);
  const problems = [];
  let prompts = 0;
  for (const message of copy.messages ?? []) {
    if (Array.isArray(message.content)) message.content = message.content.filter(block => {
      if (block.type === 'text' && block.text === userPrompt) { prompts++; return false; }
      return true;
    });
    else if (message.content === userPrompt) { prompts++; message.content = ''; }
  }
  if (prompts !== 1) problems.push('prompt');
  if (copy.metadata) delete copy.metadata.user_id;
  let raw_sha256 = null;
  try { raw_sha256 = canonicalHash(copy); } catch { problems.push('invalid-runtime'); }
  const harness = candidate ? CANDIDATE_HARNESS_INSTRUCTION : HARNESS_INSTRUCTION;
  let harnesses = 0;
  const normalise = text => {
    if (typeof text !== 'string') return text;
    harnesses += text.split(harness).length - 1;
    return text.replaceAll(harness, HARNESS_INSTRUCTION);
  };
  if (Array.isArray(copy.system)) copy.system = copy.system.map(block => ({ ...block, ...(typeof block.text === 'string' ? { text: normalise(block.text) } : {}) }));
  else copy.system = normalise(copy.system);
  if (harnesses !== 1) problems.push('harness');
  if (candidate) {
    const name = `mcp__tracker__${COMMAND_TOOL.name}`;
    const added = (copy.tools ?? []).filter(tool => tool.name === name);
    if (added.length !== 1 || added[0].description !== COMMAND_TOOL.description
      || canonicalHash(added[0].input_schema ?? null) !== canonicalHash(COMMAND_TOOL.inputSchema)) problems.push('candidate-tool');
    copy.tools = (copy.tools ?? []).filter(tool => tool.name !== name);
  }
  try { return { sha256: canonicalHash(copy), raw_sha256, problems }; }
  catch { return { sha256: null, raw_sha256, problems: [...problems, 'invalid-runtime'] }; }
}

const ENTRY_KEYS = ['scenario', 'input_sha256', 'policy_sha256', 'candidate_expected_sha256', 'candidate_projection_sha256', 'baseline_projection_sha256', 'decision', 'reason'].sort().join(',');

export function expectedProjection(scenario, fixture) {
  if (!fixture || fixture.id !== scenario.id) throw new Error('missing expected projection fixture');
  const reads = scenario.expected.reads_before_first_effect.map(read => {
    if (read.op !== 'list_comments' || read.args.issue_id !== fixture.issue_id) throw new Error('unsupported expected read');
    return { kind: 'read', ...read, result: { comments: fixture.tracker.comments } };
  });
  const effects = scenario.expected.effects.flatMap((effect, i) => [
    { kind: 'effect-attempt', id: `e${i + 1}`, ...effect },
    { kind: 'effect-result', attempt_id: `e${i + 1}`, outcome: 'applied', acknowledged: true },
  ]);
  return [...reads, ...effects, { kind: 'terminal', ...scenario.expected.terminal, final_state_sha256: scenario.expected.final_state_sha256 }];
}

export function validateDeclarations(value, { registry, decisions, history, fixtures }) {
  if (!value || Object.keys(value).sort().join(',') !== 'decisions_sha256,entries,historical_run_sha256,schema'
    || value.schema !== 1 || !Array.isArray(value.entries)
    || value.decisions_sha256 !== canonicalHash(decisions) || value.historical_run_sha256 !== canonicalHash(history)) throw new Error('stale or invalid treatment declarations');
  const seen = new Set();
  for (const entry of value.entries) {
    const scenario = registry.scenarios.find(s => s.id === entry.scenario);
    const decision = decisions.decisions.find(d => d.id === entry.decision && d.covered_by.includes(entry.scenario));
    if (Object.keys(entry).sort().join(',') !== ENTRY_KEYS || !scenario || !decision || seen.has(entry.scenario)
      || typeof entry.reason !== 'string' || !entry.reason.trim()
      || entry.input_sha256 !== scenario.input_sha256 || entry.policy_sha256 !== scenario.policy_sha256
      || entry.candidate_expected_sha256 !== canonicalHash(scenario.expected)
      || entry.candidate_projection_sha256 !== canonicalHash(expectedProjection(scenario, fixtures.scenarios.find(f => f.id === scenario.id)))) throw new Error(`invalid declaration for ${entry.scenario}`);
    const historical = history.traces.filter(t => t.scenario === entry.scenario && canonicalHash(projection(t)) === entry.baseline_projection_sha256);
    if (historical.length !== 1) throw new Error(`unknown historical difference for ${entry.scenario}`);
    const checked = validateTrace(historical[0], scenario, registry);
    if (checked.status !== 'fail' || checked.incomplete.length) throw new Error(`historical difference is not complete for ${entry.scenario}`);
    seen.add(entry.scenario);
  }
  return value;
}

export function classifyPair({ scenario, registry, baseline, candidate, declaration, runtimeMatches, commandUse, model }) {
  const report = { scenario: scenario.id, classification: 'incomplete', baseline: null, candidate: null, event_differences: [] };
  if (!baseline || !candidate) return report;
  try {
    report.baseline = validateTrace(baseline, scenario, registry);
    report.candidate = validateTrace(candidate, scenario, registry);
  } catch (error) { return { ...report, invalid: error.message }; }
  const before = projection(baseline);
  const after = projection(candidate);
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if (canonicalHash(before[i] ?? null) !== canonicalHash(after[i] ?? null)) report.event_differences.push(i);
  }
  if (runtimeMatches !== true || [report.baseline, report.candidate].some(r => r.status === 'incomplete' || r.incomplete.length)
    || [baseline, candidate].some(t => t.accounting.requests < 1 || t.accounting.served_models.length !== 1 || t.accounting.served_models[0] !== model)) return report;
  if (report.candidate.status !== 'pass') report.classification = 'candidate-failure';
  else if (commandUse !== 'followed') report.classification = 'command-not-followed';
  else if (!report.event_differences.length) report.classification = 'preserved';
  else if (declaration?.baseline_projection_sha256 === canonicalHash(before)
    && declaration.candidate_projection_sha256 === canonicalHash(after)
    && declaration.candidate_expected_sha256 === canonicalHash(scenario.expected)) report.classification = 'declared-change';
  else report.classification = 'unexpected-difference';
  return report;
}
