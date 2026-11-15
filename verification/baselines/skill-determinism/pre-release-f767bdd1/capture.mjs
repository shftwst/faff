import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [rootArg, auditArg, outArg, operatorArg] = process.argv.slice(2);
if (!operatorArg) throw new Error('usage: node capture.mjs SOURCE_ROOT AUDIT_TOOL OUTPUT_DIR OPERATOR_ROOT');
const [root, auditTool, out, operatorRoot] = [rootArg, auditArg, outArg, operatorArg].map(p => path.resolve(p));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const source = p => fs.readFileSync(path.join(root, p));
fs.mkdirSync(out, { recursive: true });
if (fs.existsSync(path.join(out, 'inventory.json'))) throw new Error('Capture exists; choose a new output directory');
const startedAt = new Date().toISOString();
const commit = git('rev-parse', 'HEAD');
const before = git('status', '--porcelain=v1', '--untracked-files=no');
if (before) throw new Error('Source has tracked changes');

fs.mkdirSync(path.join(out, 'analysis-tool'), { recursive: true });
const original = fs.readFileSync(auditTool, 'utf8');
let bound = original;
for (const name of ['cli-driver.mjs', 'tokenomics.mjs']) {
  const needle = `'./${name}'`;
  if (bound.split(needle).length !== 2) throw new Error(`Unexpected audit import: ${name}`);
  bound = bound.replace(needle, JSON.stringify(pathToFileURL(path.join(root, 'eval', name)).href));
}
const boundPath = path.join(out, 'analysis-tool/skill-audit.pinned.mjs');
fs.writeFileSync(boundPath, bound, { flag: 'wx' });
fs.writeFileSync(path.join(out, 'analysis-tool/skill-audit.original.mjs'), original, { flag: 'wx' });
const audit = await import(pathToFileURL(boundPath).href);
const inv = audit.inventory(root);
save('inventory.json', inv);
save('entry-loads.json', audit.entryLoads(root));
const history = audit.historical(operatorRoot);
save('historical-cost.json', history);
const { parseTranscript } = await import(pathToFileURL(path.join(root, 'eval/tokenomics.mjs')).href);
const usage = history.evidence.flatMap(e => parseTranscript(fs.readFileSync(path.join(operatorRoot, e.path), 'utf8')).map(call => ({ source: e.path, ...call })));
fs.writeFileSync(path.join(out, 'historical-usage.jsonl'), usage.map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx' });

const tracked = git('ls-files', '-z', 'plugin', 'scripts', 'eval', 'test', '.github/workflows', 'AGENTS.md', 'docs/reference/skill-authoring.md', 'docs/plans', 'design').split('\0').filter(Boolean);
const files = tracked.map(p => {
  const b = source(p);
  return { path: p, bytes: b.length, sha256: hash(b) };
});
save('source-files.json', { commit, files });
fs.writeFileSync(path.join(out, 'git-tree.txt'), git('ls-tree', '-r', '--full-tree', 'HEAD') + '\n', { flag: 'wx' });
execFileSync('git', ['archive', '--format=tar.gz', `--output=${path.join(out, 'source.tar.gz')}`, commit, 'plugin', 'scripts', 'eval', 'test', '.github/workflows', 'AGENTS.md', 'docs/reference/skill-authoring.md'], { cwd: root });

const require = createRequire(path.join(root, 'plugin/skills/faff/bin/lib/config-core.js'));
const { DEFAULTS, loadConfig } = require('./config-core.js');
const slots = Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => k.startsWith('slots.')).map(([k, v]) => [k.slice(6), v]));
const configurations = [root, operatorRoot].map(p => {
  const [data, configPath, overlayPath] = loadConfig(p);
  return {
    root: p,
    files: [configPath, overlayPath].filter(Boolean).map(f => ({ path: f, sha256: hash(fs.readFileSync(f)) })),
    explicit_slots: data.slots ?? {},
    resolved_slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, data.slots?.[k] ?? v])),
  };
});
save('configuration.json', { builtin_slots: slots, configurations, scope: 'Slot values only. Config files are hashed, not copied. A linked worktree can inherit operator config; builtin_slots is the clean-adoption reference.' });

const installedRoots = [path.join(os.homedir(), '.codex/plugins/cache/faff/faff/0.44.0/skills'), path.join(os.homedir(), '.agents/skills')];
const installed = installedRoots.map(dir => {
  if (!fs.existsSync(dir)) return { root: dir, missing: true };
  const rows = fs.readdirSync(dir).sort().filter(n => /^(faff$|faff-|faffter-|faffidavit-)/.test(n)).flatMap(name => {
    const p = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(p)) return [];
    const b = fs.readFileSync(p);
    const description = (b.toString('utf8').match(/^description:\s*(.*)$/m)?.[1] ?? '').replace(/^"|"$/g, '');
    const expected = inv.files.find(f => f.path === `plugin/skills/${name}/SKILL.md`);
    return [{ name, resolved: fs.realpathSync(p), sha256: hash(b), bytes: b.length, description_chars: description.length, description_est_tokens: Math.ceil(description.length / 4), matches_pinned_source: hash(b) === expected?.sha256 }];
  });
  return { root: dir, entries: rows.length, description_est_tokens: rows.reduce((a, r) => a + r.description_est_tokens, 0), rows };
});
save('installed-discovery.json', { captured_at: new Date().toISOString(), roots: installed, limitation: 'Filesystem discovery, not the exact rendered runtime catalogue. Metadata estimates exclude names, wrappers and truncation. Duplicate entries do not prove duplicate body loads.' });

const sessions = JSON.parse(fs.readFileSync(path.join(operatorRoot, 'verification/audits/2026-11-14-skill-determinism/data/local-codex-usage.json')));
save('selected-local-usage.json', {
  scope: 'Recheck the five sessions selected in the audit. They are historical samples, not a current-release performance benchmark. No transcript contents retained.',
  sessions: sessions.sessions.map(s => {
    const b = fs.readFileSync(path.join(os.homedir(), '.codex/sessions', s.file));
    const rows = b.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
    const totals = rows.filter(r => r.type === 'event_msg' && r.payload?.type === 'token_count' && r.payload?.info?.total_token_usage).map(r => r.payload.info.total_token_usage);
    return { file: s.file, sha256: hash(b), matches_audit_hash: hash(b) === s.sha256, usage_events: totals.length, counter_resets: totals.filter((x, i) => i > 0 && x.total_tokens < totals[i - 1].total_tokens).length, last_reported_totals: totals.at(-1) };
  }),
});
const after = git('status', '--porcelain=v1', '--untracked-files=no');
if (git('rev-parse', 'HEAD') !== commit || after !== before) throw new Error('Pinned source changed during capture');
save('capture.json', {
  schema: 1, started_at: startedAt, finished_at: new Date().toISOString(), commit, tree: git('rev-parse', 'HEAD^{tree}'), root, operator_root: operatorRoot,
  node: process.version, os: { platform: os.platform(), release: os.release(), arch: os.arch() },
  command: process.argv, source_status_before: before, source_status_after: after,
  analysis_tool: { original_path: auditTool, original_sha256: hash(original), bound_sha256: hash(bound), binding: 'Only two import paths replaced with file URLs into the pinned source. All inventory calls pass the source root explicitly.' },
  archive: { path: 'source.tar.gz', sha256: hash(fs.readFileSync(path.join(out, 'source.tar.gz'))), scope: 'Tracked plugin, scripts, eval, tests, CI workflows, contributor guidance and skill authoring standard.' },
  historical_evidence: { root: operatorRoot, storage: 'Local original workspace; absent from clean worktree. Raw sources individually hashed in historical-cost.json. Content-free parsed request usage retained in historical-usage.jsonl.' },
  limitations: ['Static tokens use ceil(JS string length / 4).', 'No paid model call, live tracker write or install mutation.', 'No candidate arm exists, so no measured migration savings or behavioural parity claim.', 'Historical cost uses repository rates, not current pricing or invoices.'],
});
console.log(JSON.stringify({ commit, totals: inv.totals, installed: installed.map(x => ({ root: x.root, entries: x.entries })), tracked_files_hashed: files.length, source_unchanged: true }));
