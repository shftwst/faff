import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gradeReportingExecution, REPORTING_TOOLS } from '../../../eval/control-parity/reporting-execution.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

export function assessReportingDrafts(capture, expected, fixture) {
  const raw = gradeReportingExecution(capture, expected, fixture), errors = [], discarded = [];
  const check = (condition, code, detail = null) => { if (!condition) errors.push({ code, detail }); };
  const known = new Set(fixture.cases.map(row => row.id)), ports = new Set(REPORTING_TOOLS.map(tool => tool.name));
  const ids = new Set(), selected = new Set();
  check(Array.isArray(capture.errors) && capture.errors.length === 0, 'capture-errors');
  for (const [index, event] of capture.events.entries()) {
    check(ports.has(event.name), 'unknown-operation', event.seq);
    check(event.seq === index + 1 && !event.error, 'invalid-sequence-or-tool-error', event.seq);
    check(event.name === 'finish' ? event.case_id === null && index === capture.events.length - 1 && event.result?.finished === true : known.has(event.case_id) && event.args?.case_id === event.case_id, 'case-or-finish-differs', event.seq);
    if (event.name !== 'normalise_output') continue;
    check(typeof event.result?.id === 'string' && event.result.id.length > 0 && !ids.has(event.result.id), 'normalisation-id-invalid-or-duplicate', event.seq);
    ids.add(event.result?.id);
    check(['tracker', 'conversation'].includes(event.args?.channel) && typeof event.args?.text === 'string' && event.result?.text === event.args.text && event.result?.dependency === 'controlled identity rendering adaptor', 'normalisation-result-differs', event.seq);
  }
  check(capture.events.filter(event => event.name === 'finish').length === 1, 'finish-count');
  for (const row of fixture.cases) {
    const events = capture.events.filter(event => event.case_id === row.id), normalised = events.filter(event => event.name === 'normalise_output'), publications = events.filter(event => event.name === 'publish');
    if (row.action !== 'report') {
      check(normalised.length === 0 && publications.length === 0, 'draft-or-publication-on-nonreport-case', row.id);
      continue;
    }
    const commands = events.filter(event => event.name === 'run_faff');
    check(commands.length === 1, 'summary-command-count', row.id);
    for (const channel of ['tracker', 'conversation']) {
      const posts = publications.filter(event => event.args?.channel === channel), drafts = normalised.filter(event => event.args?.channel === channel);
      check(posts.length === 1, 'publication-count', { case_id: row.id, channel });
      if (posts.length !== 1) continue;
      const post = posts[0], referenced = drafts.filter(event => event.result?.id === post.args.normalised_id);
      check(referenced.length === 1, 'publication-reference-missing-or-cross-channel', post.seq);
      if (referenced.length !== 1) continue;
      const chosen = referenced[0]; selected.add(chosen.seq);
      check(commands[0]?.seq < chosen.seq && chosen.seq < post.seq, 'publication-order', post.seq);
      check(post.result?.acknowledged === true && post.result?.channel === channel && post.result?.target === post.args.target && post.result?.text === chosen.result.text, 'publication-result-differs', post.seq);
      for (const draft of drafts) {
        check(commands[0]?.seq < draft.seq && draft.seq < post.seq, 'draft-outside-prepublication-window', draft.seq);
        if (draft !== chosen) discarded.push({ case_id: row.id, channel, seq: draft.seq, normalised_id: draft.result?.id ?? null, input_sha256: typeof draft.args.text === 'string' ? sha256(draft.args.text) : null, selected_seq: chosen.seq, publication_seq: post.seq });
      }
    }
    check(publications.length === 2, 'unknown-or-extra-publication', row.id);
  }
  const projection = { ...capture, events: capture.events.filter(event => event.name !== 'normalise_output' || selected.has(event.seq)) };
  const assessed = gradeReportingExecution(projection, expected, fixture);
  for (const row of raw.cases) {
    const retained = assessed.cases.find(item => item.id === row.id)?.problems ?? [];
    for (const problem of row.problems) if (!retained.includes(problem)) check(['publication-count', 'publication-order:tracker', 'publication-order:conversation'].includes(problem), 'unpermitted-raw-reclassification', { case_id: row.id, problem });
  }
  return { schema: 1, status: !errors.length && assessed.status === 'pass' ? 'pass' : 'fail', scope: 'Post-hoc oracle assessment, frozen before remaining baselines or any candidate. Recognises only unused pre-publication rendering drafts; original raw scores, native calls, intermediate text and overhead remain unchanged. Controlled identity rendering and publication only; no rendering-quality or hosted-publication claim.', raw, assessed, errors, discarded_drafts: discarded, normalisation_calls: capture.events.filter(event => event.name === 'normalise_output').length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: assess-reporting-drafts-v1.mjs RUN_DIRECTORY FIXTURE NEW_OUTPUT');
  const read = name => readFileSync(join(directory, name));
  const result = assessReportingDrafts(JSON.parse(read('capture.json')), JSON.parse(read('expected.json')), JSON.parse(readFileSync(fixturePath)));
  Object.assign(result, { assessor_sha256: sha256(readFileSync(new URL(import.meta.url))), source_hashes: Object.fromEntries(['capture.json', 'expected.json', 'report.json', 'native-audit.json'].map(name => [name, sha256(read(name))])), fixture_sha256: sha256(readFileSync(fixturePath)) });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, raw: result.raw.status, discarded_drafts: result.discarded_drafts.length, errors: result.errors }));
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
