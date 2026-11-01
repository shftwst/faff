// ===========================================================================
// === region:factory — pr-open — FAFF-1416: graft Step 9b's PR opening as one command ===
//
// `faff pr open` runs the ordered PR-opening sequence graft's Step 9b used to describe in prose and
// returns one typed token for the skill to route. The order is the safety property: the review
// verdict is `pass`, the body is sanitized and checked, the anchor is minted, committed and pushed,
// and only then does `faff pr-create` open the PR. Every refusal that can be decided before the push
// is decided before the push.
//
// It composes the existing commands and changes none of them: `faff pr-create` stays the sole
// `gh pr create` path and keeps verifying a grant it did not mint; `faff events anchor`, `faff bundle
// publish`, `faff evidence write`, `faff effects declare|observe` and `faff commissaire effect
// declare|authorize|observe` are spawned as they are; the pr-body sanitizer and checker run
// in-process. Commissaire is reached only through its existing verbs. The command never writes the
// tracker: on `opened` / `already-open` it returns the In Review transition as a descriptor.
//
// Exit codes: 0 opened / already-open / no-op; 1 refused; 2 errored; 3 needs-human.
// ===========================================================================

const fs: FsApi = require("node:fs");
const os: OsApi = require("node:os");
const path: PathApi = require("node:path");
const childProcess: ChildProcessApi = require("node:child_process");

// --- Typed views of the modules this command composes (no casts: the annotation types `require`). ---

interface FsApi {
  readFileSync(file: string, encoding: "utf8"): string;
  writeFileSync(file: string, data: string): void;
  mkdtempSync(prefix: string): string;
  rmSync(file: string, opts: { recursive?: boolean; force?: boolean }): void;
}
interface OsApi { tmpdir(): string }
interface PathApi {
  basename(p: string): string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
}
interface SpawnSyncResult { status: number | null; stdout: string | null; stderr: string | null; error?: Error | undefined }
interface ChildProcessApi {
  spawnSync(cmd: string, args: string[], opts: { cwd?: string; input?: string; encoding: "utf8"; timeout?: number; env?: NodeJS.ProcessEnv }): SpawnSyncResult;
}
interface ParsedArgs { values: { [flag: string]: unknown }; positionals: string[]; errors: unknown[] }
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}
interface GhApi { runGh(args: string[], opts: { timeout?: number }): SpawnSyncResult }
interface FloorApi { readReviewVerdict(runDir: string, issue: string): string }
interface PrBodyApi {
  sanitizePrBody(body: string, target: string): string;
  checkPrBody(body: string, target: string): { ok: boolean; violations: unknown[] };
}
interface EventsApi { validateAnchorGenesis(runDir: string): { valid: boolean; code?: string | undefined } }
interface TrustContext { transport: string; base_ref: string }
interface EffectsApi {
  makeTrustContext(opts: { transport: string; repo_dir: string; base_ref: string; resolve_slug: boolean }): TrustContext;
  resolvePrCreateGrantDetail(runDir: string, issue: string, base: string, ctx: TrustContext): { state: string };
}
interface MergeAuthorizeApi {
  deriveGrantInputs(runDir: string, issue: string, at: { cwd: string; repo: string | null; headSha: string }): GrantInputs;
}

const argvApi: ArgvApi = require("./argv");
const ghApi: GhApi = require("./merge-gate-gh");
const floorApi: FloorApi = require("./merge-gate-floor");
const prBodyApi: PrBodyApi = require("./pr-body");
const eventsApi: EventsApi = require("./events");
const effectsApi: EffectsApi = require("./merge-gate-effects");
const mergeAuthorizeApi: MergeAuthorizeApi = require("./merge-authorize");

const FAFF_BIN: string = path.resolve(__dirname, "..", "faff");

// --- Types ---------------------------------------------------------------------------------------

export type PrOpenToken = "opened" | "already-open" | "no-op" | "refused" | "needs-human" | "errored";
export type Spawned = { status: number | null; stdout: string; stderr: string; timedOut: boolean };
export type GrantInputs = { level: string; attended: boolean; holdout: string };
export type TrackerTransition = {
  to: "In Review";
  governed: boolean;
  effect: { kind: "tracker-write"; target: string; reversible: true };
};
export type PrOpenResult = {
  token: PrOpenToken;
  exit: number;
  pr_url?: string;
  pr_number?: number;
  head_sha?: string;
  anchor_dest?: string;
  cause?: string;
  blockers?: string[];
  warnings: string[];
  governed?: boolean;
  tracker_transition?: TrackerTransition;
};
export type PrOpenOptions = {
  runDir: string;
  issue: string;
  base: string;
  title: string;
  bodyFile: string;
  specReviewEvidence: string | null;
};

// Every effect the command has goes through one of these, so a test can drive the whole sequence
// and record each call in order.
export type PrOpenDeps = {
  git: (args: string[]) => Spawned;
  gh: (args: string[]) => Spawned;
  faff: (args: string[], input: string | null, timeoutMs: number) => Spawned;
  readReviewVerdict: (runDir: string, issue: string) => string;
  sanitize: (draft: string, issue: string) => string;
  check: (body: string, issue: string) => { ok: boolean; violations: unknown[] };
  validateAnchorGenesis: (runDir: string) => { valid: boolean; code?: string | undefined };
  prCreateGrantState: (runDir: string, issue: string, base: string) => string;
  deriveInputs: (runDir: string, issue: string, headSha: string) => GrantInputs;
  readFile: (file: string) => string | null;
  writeTemp: (content: string) => string;
  removeFile: (file: string) => void;
};

type OpenPr = { number: number | null; url: string | null; baseRefName: string | null; headRefOid: string | null };

const STATUS_TIMEOUT_MS = 30 * 1000;
const DEFAULT_TIMEOUT_MS = 120 * 1000;
// The same issue-id shape `faff pr-create` accepts.
const ISSUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PR_OPEN_SPEC = {
  flags: {
    "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--base": { arity: 1 }, "--title": { arity: 1 },
    "--body-file": { arity: 1 }, "--spec-review-evidence": { arity: 1 }, "--json": { arity: 0 },
  },
};
const PR_OPEN_USAGE = "usage: faff pr open --run-dir DIR --issue ID --base BRANCH --title T --body-file FILE [--spec-review-evidence FILE] [--json]";

// --- Helpers ---------------------------------------------------------------------------------------

function isRecord(v: unknown): v is { [k: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null { return typeof v === "string" && v !== "" ? v : null; }
function firstLine(s: string): string { return (s.trim().split("\n")[0] ?? "").trim(); }
function lastJson(stdout: string): unknown {
  const lines = stdout.trim().split("\n");
  try { return JSON.parse(lines[lines.length - 1] ?? ""); } catch { return null; }
}
function prNumberFromUrl(url: string): number | null {
  const m = /\/pull\/(\d+)\b/.exec(url);
  return m && m[1] !== undefined ? Number(m[1]) : null;
}

function transition(issue: string, governed: boolean): TrackerTransition {
  return { to: "In Review", governed, effect: { kind: "tracker-write", target: `${issue}:In Progress->In Review`, reversible: true } };
}

// The governed-run check graft defines: exactly one JSON object with a boolean `governed`, within
// 30 seconds, else a fault. The cause names the exit code, `timeout` or `unparseable output`, never
// the call's stderr text.
function governedCheck(r: Spawned): { governed: boolean } | { fault: string } {
  if (r.timedOut) return { fault: "timeout" };
  if (r.status !== 0) return { fault: `exit ${r.status === null ? "null" : String(r.status)}` };
  let parsed: unknown;
  try { parsed = JSON.parse(r.stdout.trim()); } catch { return { fault: "unparseable output" }; }
  if (!isRecord(parsed) || typeof parsed["governed"] !== "boolean") return { fault: "unparseable output" };
  return { governed: parsed["governed"] };
}

function parseOpenPrs(stdout: string): OpenPr[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim() === "" ? "null" : stdout); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const out: OpenPr[] = [];
  for (const e of parsed) {
    if (!isRecord(e)) return null;
    const n = e["number"];
    out.push({ number: typeof n === "number" ? n : null, url: str(e["url"]), baseRefName: str(e["baseRefName"]), headRefOid: str(e["headRefOid"]) });
  }
  return out;
}

// `faff events anchor` exit 3 is a refusal; classify it by the fixed stderr prefix and the exported
// read-only genesis validator, never by free text. A refusal it cannot classify fails closed to
// genesis-invalid.
function anchorRefusalCode(stderr: string, runDir: string, deps: PrOpenDeps): string {
  if (stderr.split("\n").some((l) => l.startsWith("faff events anchor: floor-incomplete"))) return "floor-incomplete";
  let code: string | undefined;
  try { code = deps.validateAnchorGenesis(runDir).code; } catch { code = undefined; }
  return code === "no-events" || code === "genesis-invalid" ? code : "genesis-invalid";
}

function anchorCauseText(code: string, runDir: string): string {
  if (code === "floor-incomplete") return `anchor-floor-incomplete: ${runDir} lacks a required merge-floor file (ac-checklist.json or review-verdict.json); a build-evidence defect, not a provisioning fault`;
  if (code === "no-events") return `anchor-no-events: ${runDir} has no events.jsonl; a provisioning fault, re-mint the run dir`;
  return `anchor-genesis-invalid: ${runDir} has no valid genesis chain; a provisioning fault, re-mint the run dir`;
}

// --- The sequence ------------------------------------------------------------------------------------

function runPrOpen(opts: PrOpenOptions, deps: PrOpenDeps): PrOpenResult {
  const { runDir, issue, base, title } = opts;
  const warnings: string[] = [];
  const done = (r: Omit<PrOpenResult, "warnings">): PrOpenResult => ({ ...r, warnings });
  const errored = (cause: string): PrOpenResult => done({ token: "errored", exit: 2, cause });

  // 1. Parse and validate.
  if (runDir === "" || issue === "" || base === "" || title === "" || opts.bodyFile === "") return errored("usage: --run-dir, --issue, --base, --title and --body-file are required");
  if (!ISSUE_RE.test(issue) || issue.includes("..")) return errored(`usage: --issue ${JSON.stringify(issue)} is not a valid issue id`);
  const draft = deps.readFile(opts.bodyFile);
  if (draft === null) return errored(`unreadable input: cannot read --body-file ${opts.bodyFile}`);

  // 2. Git-only: no pushable remote, no PR to open.
  const remotes = deps.git(["remote"]);
  if (remotes.status === 0 && remotes.stdout.trim() === "") return done({ token: "no-op", exit: 0, cause: "git-only (no remote): no PR to open" });

  // 3. Branch check.
  const branchR = deps.git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchR.status === 0 ? branchR.stdout.trim() : "";
  if (branch === "" || branch === "HEAD" || branch === base || branch.startsWith("-")) {
    return errored(`wrong-branch: HEAD is ${JSON.stringify(branch || "unresolved")}; run from the feature branch, never ${base}`);
  }

  // 4. Review precondition.
  const review = deps.readReviewVerdict(runDir, issue);
  if (review !== "pass") return done({ token: "refused", exit: 1, cause: "review-not-pass", blockers: [`review verdict is ${review}, not pass`] });

  // 5. Governed-run check.
  const status = governedCheck(deps.faff(["commissaire", "contract", "status", "--run-dir", runDir], null, STATUS_TIMEOUT_MS));
  if ("fault" in status) return done({ token: "needs-human", exit: 3, cause: `commissaire-status-failed: ${status.fault}` });
  const governed = status.governed;
  const runId = path.basename(runDir.replace(/[\\/]+$/, ""));
  const dest = `.faff/anchors/${runId}/${issue}/`;

  // 6. The spec-review evidence floor file (best-effort).
  if (opts.specReviewEvidence !== null) {
    const evidence = deps.readFile(opts.specReviewEvidence);
    if (evidence === null) warnings.push(`spec-review evidence ${opts.specReviewEvidence} is unreadable; no spec-review-verdict.json written`);
    else {
      const w = deps.faff(["evidence", "write", "spec-review-verdict", "--run-dir", runDir, "--issue", issue], evidence, DEFAULT_TIMEOUT_MS);
      if (w.status !== 0) warnings.push(`faff evidence write spec-review-verdict exited ${String(w.status)}: ${firstLine(w.stderr)}`);
    }
  }

  // 7-18 own the safe-body temp file; the finally deletes it on every path that created it.
  let safeFile: string | null = null;
  try {
    // 7. Sanitize, then check the exact bytes that will ship.
    let safeBytes: string | null = null;
    try {
      safeFile = deps.writeTemp(deps.sanitize(draft, issue));
      safeBytes = deps.readFile(safeFile);
    } catch (e) {
      return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: [`pr-body sanitize failed: ${e instanceof Error ? e.message : String(e)}`] });
    }
    if (safeBytes === null) return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: ["the sanitized body could not be read back"] });
    let checked: { ok: boolean; violations: unknown[] };
    try { checked = deps.check(safeBytes, issue); } catch (e) {
      return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: [`pr-body check failed: ${e instanceof Error ? e.message : String(e)}`] });
    }
    if (!checked.ok) return done({ token: "refused", exit: 1, cause: "body-unsafe", blockers: [`pr-body check: ${JSON.stringify(checked.violations)}`] });

    // 8. The existing PR, before anything outward.
    const list = deps.gh(["pr", "list", "--head", branch, "--state", "open", "--json", "number,url,baseRefName,headRefOid"]);
    const prs = list.status === 0 ? parseOpenPrs(list.stdout) : null;
    if (prs === null) return errored(`gh-unavailable: gh pr list ${list.status === 0 ? "printed unparseable output" : `exited ${String(list.status)}`}`);
    const otherBase = prs.filter((p) => p.baseRefName !== base);
    if (otherBase.length) {
      return done({ token: "refused", exit: 1, cause: "open-pr-other-base", blockers: otherBase.map((p) => `open PR ${p.url ?? `#${String(p.number)}`} targets ${p.baseRefName ?? "an unknown base"}, not ${base}`), governed });
    }
    const existing = prs[0] ?? null;
    if (existing !== null && governed && deps.prCreateGrantState(runDir, issue, base) !== "valid-grant") {
      return done({ token: "needs-human", exit: 3, cause: `already-open-ungranted: open PR ${existing.url ?? `#${String(existing.number)}`} has no valid pr-create grant on this governed run`, governed });
    }
    const existingFields = (): { pr_url?: string; pr_number?: number } => {
      const out: { pr_url?: string; pr_number?: number } = {};
      if (existing !== null && existing.url !== null) out.pr_url = existing.url;
      const n = existing === null ? null : existing.number ?? (existing.url !== null ? prNumberFromUrl(existing.url) : null);
      if (n !== null) out.pr_number = n;
      return out;
    };

    // 9. Already anchored: nothing changed since the head was anchored and pushed.
    const headBefore = deps.git(["rev-parse", "HEAD"]);
    const localHead = headBefore.status === 0 ? headBefore.stdout.trim() : "";
    if (existing !== null && localHead !== "" && existing.headRefOid === localHead) {
      const tree = deps.git(["ls-tree", "HEAD", "--", dest]);
      if (tree.status === 0 && tree.stdout.trim() !== "") {
        return done({ token: "already-open", exit: 0, ...existingFields(), head_sha: localHead, anchor_dest: dest, governed, tracker_transition: transition(issue, governed) });
      }
    }

    // 10. Anchor.
    const anchor = deps.faff(["events", "anchor", "--run-dir", runDir, "--issue", issue, "--dest", dest], null, DEFAULT_TIMEOUT_MS);
    if (anchor.status === 3) {
      const code = anchorRefusalCode(anchor.stderr, runDir, deps);
      return done({ token: "needs-human", exit: 3, cause: anchorCauseText(code, runDir), governed });
    }
    if (anchor.status !== 0) return errored(`anchor CLI error: faff events anchor exited ${String(anchor.status)}: ${firstLine(anchor.stderr)}`);
    for (const l of anchor.stderr.split("\n")) if (l.includes("evidence-schema warn-only")) warnings.push(l.trim());

    // 11. Anchor commit. Only an empty stage skips the commit; every other failure stops here.
    const add = deps.git(["add", "--", dest]);
    if (add.status !== 0) return errored(`commit failure: git add exited ${String(add.status)}: ${firstLine(add.stderr)}`);
    const staged = deps.git(["diff", "--cached", "--quiet", "--", dest]);
    if (staged.status === 1) {
      const commit = deps.git(["commit", "-m", `chore(${issue}): anchor run evidence`, "--", dest]);
      if (commit.status !== 0) return errored(`commit failure: git commit exited ${String(commit.status)}: ${firstLine(commit.stderr || commit.stdout)}`);
    } else if (staged.status !== 0) {
      return errored(`commit failure: git diff --cached exited ${String(staged.status)}: ${firstLine(staged.stderr)}`);
    }

    // 12. Push, bracketed on a governed run.
    const pushEffect = JSON.stringify([{ kind: "push", target: branch, reversible: true }]);
    if (governed) {
      const d = deps.faff(["effects", "declare", "--run", runId, "--issue", issue, "--step", "push"], pushEffect, DEFAULT_TIMEOUT_MS);
      if (d.status !== 0) warnings.push(`faff effects declare (push) exited ${String(d.status)}: ${firstLine(d.stderr)}`);
    }
    const push = deps.git(["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
    if (push.status !== 0) return errored(`push failure: git push exited ${String(push.status)}: ${firstLine(push.stderr)}`);
    if (governed) {
      const o = deps.faff(["effects", "observe", "--run", runId, "--issue", issue, "--step", "push"], pushEffect, DEFAULT_TIMEOUT_MS);
      if (o.status !== 0) warnings.push(`faff effects observe (push) exited ${String(o.status)}: ${firstLine(o.stderr)}`);
    }
    const headAfter = deps.git(["rev-parse", "HEAD"]);
    const head = headAfter.status === 0 ? headAfter.stdout.trim() : localHead;

    // 13. Bundle (best-effort).
    const bundle = deps.faff(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "issue-merge-floor", "--boundary-key", issue], null, DEFAULT_TIMEOUT_MS);
    if (bundle.status !== 0 || /store_unavailable/.test(bundle.stdout + bundle.stderr)) {
      warnings.push(`faff bundle publish did not publish (exit ${String(bundle.status)}): ${firstLine(bundle.stderr || bundle.stdout)}`);
    }

    // 14. The push updated an existing PR.
    if (existing !== null) {
      return done({ token: "already-open", exit: 0, ...existingFields(), head_sha: head, anchor_dest: dest, governed, tracker_transition: transition(issue, governed) });
    }

    // 15. The governed pr-create producer half.
    const createEffect = { kind: "pr-create", target: base };
    const facadeArgs = (verb: string): string[] => ["commissaire", "effect", verb, "--run-dir", runDir, "--producer", runId, "--unit-id", issue, "--step", "pr-create"];
    if (governed) {
      let inputs: GrantInputs;
      try { inputs = deps.deriveInputs(runDir, issue, head); } catch (e) {
        return done({ token: "needs-human", exit: 3, cause: `pr-create-denied: grant inputs could not be established: ${e instanceof Error ? e.message : String(e)}`, head_sha: head, anchor_dest: dest, governed });
      }
      const d = deps.faff(facadeArgs("declare"), JSON.stringify([{ ...createEffect, reversible: true }]), DEFAULT_TIMEOUT_MS);
      if (d.status !== 0) return done({ token: "needs-human", exit: 3, cause: `pr-create-denied: commissaire effect declare exited ${String(d.status)}`, head_sha: head, anchor_dest: dest, governed });
      const a = deps.faff([...facadeArgs("authorize"), "--level", inputs.level], JSON.stringify({ effect: createEffect, level: inputs.level, attended: inputs.attended, holdout: inputs.holdout }), DEFAULT_TIMEOUT_MS);
      const verdict = a.status === 0 ? lastJson(a.stdout) : null;
      if (!isRecord(verdict) || verdict["verdict"] !== "grant") {
        const why = a.status !== 0 ? `authorize exited ${String(a.status)}` : !isRecord(verdict) ? "authorize printed no verdict" : `verdict ${String(verdict["verdict"])}${str(verdict["reason"]) ? ` (${String(verdict["reason"])})` : ""}`;
        return done({ token: "needs-human", exit: 3, cause: `pr-create-denied: ${why}`, head_sha: head, anchor_dest: dest, governed });
      }
    }

    // 16. Open.
    const create = deps.faff(["pr-create", "--run-dir", runDir, "--issue", issue, "--base", base, "--body-file", safeFile, "--title", title, "--json"], null, DEFAULT_TIMEOUT_MS);
    const created = lastJson(create.stdout);
    const createdVerdict = isRecord(created) ? created["verdict"] : null;
    if (create.status === 0 && createdVerdict === "no-op") return done({ token: "no-op", exit: 0, cause: "faff pr-create: git-only (no remote)", governed });
    if (create.status !== 0 || createdVerdict !== "opened" || !isRecord(created)) {
      const blockers = isRecord(created) && Array.isArray(created["blockers"]) ? created["blockers"].map((b) => String(b)) : [firstLine(create.stderr) || `faff pr-create exited ${String(create.status)}`];
      return done({ token: "refused", exit: 1, cause: "pr-create-refused", blockers, head_sha: head, anchor_dest: dest, governed });
    }
    const url = str(created["pr_url"]);

    // 17. Observe (governed).
    if (governed) {
      const o = deps.faff(facadeArgs("observe"), JSON.stringify([{ ...createEffect, reversible: true }]), DEFAULT_TIMEOUT_MS);
      if (o.status !== 0) warnings.push(`faff commissaire effect observe (pr-create) exited ${String(o.status)}: ${firstLine(o.stderr)}`);
    }

    // 18. Emit.
    const result: Omit<PrOpenResult, "warnings"> = { token: "opened", exit: 0, head_sha: head, anchor_dest: dest, governed, tracker_transition: transition(issue, governed) };
    if (url !== null) {
      result.pr_url = url;
      const n = prNumberFromUrl(url);
      if (n !== null) result.pr_number = n;
    }
    return done(result);
  } finally {
    if (safeFile !== null) deps.removeFile(safeFile);
  }
}

// --- Real dependencies -------------------------------------------------------------------------------

function spawned(r: SpawnSyncResult): Spawned {
  const timedOut = r.error !== undefined && /ETIMEDOUT/.test(String(r.error.message));
  return { status: r.error !== undefined ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : ""), timedOut };
}

function defaultDeps(cwd: string): PrOpenDeps {
  let tmpDir: string | null = null;
  return {
    git: (args) => spawned(childProcess.spawnSync("git", args, { cwd, encoding: "utf8", timeout: DEFAULT_TIMEOUT_MS })),
    gh: (args) => spawned(ghApi.runGh(args, { timeout: 60000 })),
    faff: (args, input, timeoutMs) => spawned(childProcess.spawnSync(process.execPath, [FAFF_BIN, ...args], input === null ? { cwd, encoding: "utf8", timeout: timeoutMs } : { cwd, encoding: "utf8", timeout: timeoutMs, input })),
    readReviewVerdict: (runDir, issue) => floorApi.readReviewVerdict(runDir, issue),
    sanitize: (draft, issue) => prBodyApi.sanitizePrBody(draft, issue),
    check: (body, issue) => prBodyApi.checkPrBody(body, issue),
    validateAnchorGenesis: (runDir) => eventsApi.validateAnchorGenesis(runDir),
    prCreateGrantState: (runDir, issue, base) => {
      const ctx = effectsApi.makeTrustContext({ transport: "remote", repo_dir: cwd, base_ref: base, resolve_slug: true });
      return effectsApi.resolvePrCreateGrantDetail(runDir, issue, base, ctx).state;
    },
    deriveInputs: (runDir, issue, headSha) => mergeAuthorizeApi.deriveGrantInputs(runDir, issue, { cwd, repo: null, headSha }),
    readFile: (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } },
    writeTemp: (content) => {
      if (tmpDir === null) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-pr-open-"));
      const file = path.join(tmpDir, "safe-body.md");
      fs.writeFileSync(file, content);
      return file;
    },
    removeFile: () => {
      if (tmpDir !== null) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } tmpDir = null; }
    },
  };
}

// --- CLI ---------------------------------------------------------------------------------------------

function emit(json: boolean, r: PrOpenResult): number {
  if (json) { process.stdout.write(JSON.stringify(r) + "\n"); return r.exit; }
  const where = r.pr_url ? ` ${r.pr_url}` : "";
  process.stdout.write(`${r.token}${where}${r.cause ? ` (${r.cause})` : ""}\n`);
  for (const b of r.blockers ?? []) process.stdout.write(`  ✗ ${b}\n`);
  for (const w of r.warnings) process.stdout.write(`  [warn] ${w}\n`);
  return r.exit;
}

function cmdPrOpen(args: string[]): number {
  const parsed = argvApi.parseArgs(args, PR_OPEN_SPEC);
  if (parsed.errors.length) return argvApi.usageError(parsed.errors, PR_OPEN_USAGE);
  const json = parsed.values["--json"] === true;
  const get = (f: string): string => str(parsed.values[f]) ?? "";
  const missing = ["--run-dir", "--issue", "--base", "--title", "--body-file"].filter((f) => get(f) === "");
  if (missing.length) {
    process.stderr.write(`faff pr open: missing ${missing.join(", ")}\n${PR_OPEN_USAGE}\n`);
    return emit(json, { token: "errored", exit: 2, cause: `usage: missing ${missing.join(", ")}`, warnings: [] });
  }
  const opts: PrOpenOptions = {
    runDir: path.resolve(get("--run-dir")),
    issue: get("--issue"),
    base: get("--base"),
    title: get("--title"),
    bodyFile: get("--body-file"),
    specReviewEvidence: str(parsed.values["--spec-review-evidence"]),
  };
  return emit(json, runPrOpen(opts, defaultDeps(process.cwd())));
}

const PR_USAGE = PR_OPEN_USAGE;

function cmdPr(args: string[]): number {
  if (args[0] !== "open") return argvApi.usageError([{ code: "bad-value", detail: "expected a verb: open" }], PR_USAGE);
  return cmdPrOpen(args.slice(1));
}

module.exports = { cmdPr, runPrOpen, defaultDeps };
