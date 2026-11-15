// Execute a pinned candidate without exposing the oracle or parent credentials to it.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { canonicalHash, parseStrictJson, sha256, validateJsonValue } from './schema.mjs';

const ENTRY = 'plugin/skills/faff/bin/faff';
const ARGS = ['review-comment', 'plan', '--input', '-'];
export class CommandInputError extends Error {
  constructor(message, reason = 'command-input-invalid') { super(message); this.reason = reason; }
}
const git = (root, ...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function bindCandidateCommand(root, pinnedCommit) {
  root = realpathSync(root);
  if (realpathSync(git(root, 'rev-parse', '--show-toplevel').trim()) !== root) throw new Error('candidate root must be the repository top level');
  const commit = git(root, 'rev-parse', 'HEAD').trim();
  if (commit !== pinnedCommit) throw new Error('candidate commit differs from the pinned commit');
  if (git(root, 'status', '--porcelain', '--untracked-files=all', '--', 'plugin').trim()) throw new Error('candidate plugin is dirty');
  const artifacts = {};
  const objectFormat = git(root, 'rev-parse', '--show-object-format').trim();
  for (const record of git(root, 'ls-tree', '-rz', 'HEAD', '--', 'plugin').split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (!['100644', '100755'].includes(mode) || type !== 'blob') throw new Error(`unsupported candidate file ${path}`);
    const full = join(root, path);
    if (!lstatSync(full).isFile() || realpathSync(full) !== full) throw new Error(`candidate file is not a regular path: ${path}`);
    const bytes = readFileSync(full);
    const actualObject = createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actualObject !== object) throw new Error(`candidate artifact differs from committed bytes: ${path}`);
    artifacts[path] = sha256(bytes);
  }
  if (!artifacts[ENTRY] || !artifacts['plugin/skills/faff/build-manifest.json']) throw new Error('candidate CLI or build manifest is missing');
  return { schema: 1, root, commit, plugin_tree: git(root, 'rev-parse', 'HEAD:plugin').trim(), entry: ENTRY, command: ARGS, artifacts };
}

export function assertCandidateCommandUnchanged(binding) {
  if (canonicalHash(bindCandidateCommand(binding.root, binding.commit)) !== canonicalHash(binding)) throw new Error('candidate command binding changed');
}

function validateInput(input) {
  try { validateJsonValue(input); } catch { throw new CommandInputError('invalid candidate command input'); }
  if (!exactKeys(input, ['schema', 'issue_id', 'faff_body', 'comments']) || input.schema !== 1
    || typeof input.issue_id !== 'string' || !input.issue_id || typeof input.faff_body !== 'string'
    || !Array.isArray(input.comments) || input.comments.some(c => !c || typeof c.id !== 'string' || typeof c.body !== 'string')) {
    throw new CommandInputError('invalid candidate command input');
  }
}

function validatePlan(value, input) {
  if (!exactKeys(value, ['schema', 'action', 'reason', 'comment_id', 'body', 'expectedDigest'])
    || value.schema !== 1 || typeof value.body !== 'string') throw new Error('invalid planner output');
  if (value.action === 'create') {
    if (value.reason !== 'created' || value.comment_id !== null || value.expectedDigest !== null) throw new Error('invalid create plan');
  } else if (value.action === 'update') {
    const targets = input.comments.filter(c => c.id === value.comment_id);
    if (!['updated', 'reconciled'].includes(value.reason) || targets.length !== 1
      || value.expectedDigest !== sha256(Buffer.from(targets[0].body, 'utf8'))) throw new Error('invalid update plan');
  } else throw new Error('invalid plan action');
  return value;
}

export function invokeCandidateCommand(binding, input, { timeoutMs = 5000, maxOutputBytes = 1024 * 1024, maxInputBytes = 1024 * 1024 } = {}) {
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const startedNs = process.hrtime.bigint();
  validateInput(input);
  const stdin = JSON.stringify(input);
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new Error('invalid command input limit');
  if (Buffer.byteLength(stdin) > maxInputBytes) throw new CommandInputError('command input exceeds limit', 'command-input-limit');
  assertCandidateCommandUnchanged(binding);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error('invalid command limits');
  const directory = mkdtempSync(join(tmpdir(), 'faff-cp-command-'));
  try {
    for (const [path, hash] of Object.entries(binding.artifacts)) {
      const bytes = readFileSync(join(binding.root, path));
      if (sha256(bytes) !== hash) throw new Error(`candidate artifact changed: ${path}`);
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
    }
    const argv = [
      process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission',
      `--allow-fs-read=${join(directory, 'plugin')}`,
      join(directory, ENTRY), ...ARGS,
    ];
    const spawnStarted = process.hrtime.bigint();
    const output = spawnSync(process.execPath, argv, {
      cwd: directory, env: {},
      input: stdin, timeout: timeoutMs,
      killSignal: 'SIGKILL', maxBuffer: maxOutputBytes,
    });
    const spawnDuration = process.hrtime.bigint() - spawnStarted;
    const stdoutBytes = output.stdout ?? Buffer.alloc(0);
    const stderrBytes = output.stderr ?? Buffer.alloc(0);
    const stdout = stdoutBytes.toString('utf8');
    const stderr = stderrBytes.toString('utf8');
    let error = output.error?.code === 'ETIMEDOUT' ? 'command-timeout'
      : output.error?.code === 'ENOBUFS' ? 'command-output-limit'
      : output.error ? 'command-spawn'
      : output.status !== 0 ? 'command-exit' : null;
    let plan = null;
    if (!error) {
      try { plan = validatePlan(parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(stdoutBytes)), input); }
      catch { error = 'invalid-plan'; }
    }
    return { plan, evidence: {
      schema: 1, source_commit: binding.commit, plugin_tree: binding.plugin_tree,
      artifacts: binding.artifacts, command: ARGS, node: process.version,
      executable: process.execPath, argv, cwd: directory, env_keys: [],
      input, stdin, stdin_sha256: sha256(stdin), stdout, stderr,
      stdout_sha256: sha256(stdoutBytes), stderr_sha256: sha256(stderrBytes),
      stdout_base64: stdoutBytes.toString('base64'), stderr_base64: stderrBytes.toString('base64'),
      exit_code: output.status, signal: output.signal, error,
      started_at: startedAt, ended_at: new Date().toISOString(), duration_ns: String(process.hrtime.bigint() - startedNs),
      spawn_duration_ns: String(spawnDuration), spawn_elapsed_ms: Number(spawnDuration) / 1e6,
      elapsed_ms: Math.ceil(performance.now() - started),
    } };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
