// ===========================================================================
// === region:factory — stage — FAFF-457: selective staging + a filename-class secret guard ===
// The build-safety chokepoint for every worktree commit path. `git add -A`
// (and `git add .`) stages EVERY untracked file, gated only by `.gitignore` —
// a denylist one omission away from a leak. That is the PR #258 vector: a stray
// untracked `.env` swept into a pushed commit because only `.env.claude-box`
// was ignored. The fix is the inverse primitive — an ALLOWLIST: stage tracked
// changes plus an explicit, named set of intended new paths, so an unintended
// file is never swept in REGARDLESS of gitignore coverage.
//
// This module is the single home (the `label.js` / `faff label` pattern): JS
// call sites (`sentry.js`) require it directly; prose call sites (graft /
// concurrency SKILLs) shell the `faff stage-guard` CLI wrapper. It is PURE
// git-plumbing only — no tracker MCP, no network — like the other bin/lib
// helpers.
//
// The secret-class guard is a filename-CLASS check (does this look like a
// secrets file?), explicitly NOT content-based secret scanning (that is
// dev-infra, out of faff's concern — FAFF-103 was cancelled on exactly that
// basis). It is a cheap backstop; the allowlist is the primary defence.
//
// Two guard modes:
//   - "assert" — hard-fail (ok=false) if any staged path is secret-class;
//     unstage nothing. For the PRECISE build commit, where a staged secret is
//     a defect that must stop loudly.
//   - "filter" — `git restore --staged` each secret-class path and report it;
//     ok always true. For WIP-preservation commits (sentry-abort, member-park)
//     that must still produce a resumable sha — drop the secret, keep the work.
// ===========================================================================

const { spawnSync } = require("node:child_process");

// The denylist — a SINGLE constant, filename-class only, matched on the
// lowercased basename (directory stripped). Extending it is a one-line change.
const SECRET_CLASS_PATTERNS = [
  /^\.env$/,                              // .env
  /^\.env\..+$/,                          // .env.* (local, production, …)
  /\.(pem|key|p12|pfx|keystore|jks)$/,    // *.pem *.key *.p12 *.pfx *.keystore *.jks
  /^\.netrc$/,                            // .netrc
  /\.?pgpass$/,                           // .pgpass *.pgpass
  /^credentials(\.json)?$/,               // credentials credentials.json
  /^\.npmrc$/,                            // .npmrc
  /^\.pypirc$/,                           // .pypirc
];

// The SSH key family (id_rsa* / id_dsa* / id_ecdsa* / id_ed25519*) — secret
// EXCEPT the `.pub` public half. The spec scopes the `.pub` exemption to this
// family ("id_rsa* … but NOT *.pub"), so it is handled HERE, not as a global
// allowlist entry — a mis-named `vault.key.pub` must never be blanket-exempted.
const ID_KEY_PATTERN = /^id_(rsa|dsa|ecdsa|ed25519)/;

// Global allowlist exceptions — conventionally non-secret template files.
// Checked FIRST. `.pub` is deliberately NOT here (see ID_KEY_PATTERN above).
const SECRET_CLASS_ALLOW = [/\.example$/, /\.sample$/];

// true iff the basename looks like a secrets file (and is not an allowlist
// exception). Accepts a basename OR a full path (directory is stripped).
function isSecretClass(p) {
  if (p == null) return false;
  const base = String(p).split("/").pop().trim().toLowerCase();
  if (!base) return false;
  if (SECRET_CLASS_ALLOW.some((re) => re.test(base))) return false;
  if (ID_KEY_PATTERN.test(base)) return !base.endsWith(".pub");   // .pub is the public half
  return SECRET_CLASS_PATTERNS.some((re) => re.test(base));
}

// Currently-staged paths in <worktree> (index vs HEAD). Returns `null` (NOT `[]`)
// on a git failure, so a caller can distinguish "could not read the index" from
// "index is clean" — a security guard must never read-fail into a false all-clear.
function stagedPaths(worktree) {
  const r = spawnSync("git", ["-C", worktree, "diff", "--cached", "--name-only", "-z"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\0").filter(Boolean);
}

// Guard the current index. mode="assert": ok=false when any staged path is
// secret-class (unstage nothing). mode="filter": restore --staged each secret
// path (fall back to `reset HEAD` on an older git), report them, ok always true.
// A read failure surfaces as { readFailed: true } — assert FAILS LOUD on it
// (never a false clean), filter treats it as best-effort (nothing to unstage).
function guardStaged(worktree, mode) {
  const staged = stagedPaths(worktree);
  if (staged === null) return { secretStaged: [], ok: mode === "filter", unstaged: [], readFailed: true };
  const secretStaged = staged.filter((p) => isSecretClass(p));
  if (mode === "filter") {
    const unstaged = [];
    for (const p of secretStaged) {
      const r = spawnSync("git", ["-C", worktree, "restore", "--staged", "--", p], { encoding: "utf8" });
      if (r.status !== 0) spawnSync("git", ["-C", worktree, "reset", "-q", "HEAD", "--", p], { encoding: "utf8" });
      unstaged.push(p);
    }
    return { secretStaged, ok: true, unstaged };
  }
  // assert (default)
  return { secretStaged, ok: secretStaged.length === 0, unstaged: [] };
}

// WIP-preservation stage (sentry-abort / member-park): capture ALL legitimate
// in-flight work without sweeping a secret. Stages tracked modifications/
// deletions (already in history — cannot be a stray secret) plus each untracked
// non-secret-class path by explicit pathspec; a filter-mode pass is the
// belt-and-braces. Returns the secret-class paths it deliberately skipped, so
// the caller can report the WIP omission.
function wipStage(worktree) {
  spawnSync("git", ["-C", worktree, "add", "-u"], { encoding: "utf8" });
  const skipped = [];
  const st = spawnSync("git", ["-C", worktree, "status", "--porcelain", "-z"], { encoding: "utf8" });
  if (st.status === 0) {
    for (const entry of st.stdout.split("\0").filter(Boolean)) {
      if (!entry.startsWith("?? ")) continue;          // untracked only; tracked handled by add -u
      const p = entry.slice(3);
      if (isSecretClass(p)) skipped.push(p);
      else spawnSync("git", ["-C", worktree, "add", "--", p], { encoding: "utf8" });
    }
  }
  const g = guardStaged(worktree, "filter");           // belt-and-braces
  for (const p of g.unstaged) if (!skipped.includes(p)) skipped.push(p);
  return { skipped };
}

// --- CLI: faff stage-guard --worktree <dir> --mode assert|filter|wip [--json] ---
// assert  — guard the current index; exit 1 if a secret-class path is staged.
// filter  — unstage each secret-class path already in the index; exit 0.
// wip     — run the full WIP-preservation selective stage (add -u + non-secret
//           untracked + filter) so a governance caller (sentry.js) can invoke it
//           via a CHILD spawn of this bin rather than requiring the factory lib
//           directly (the ADR-0042 governance→factory direction rule). exit 0.
const { parseArgs, usageError } = require("./argv");
const STAGE_GUARD_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 },
  "--worktree": { arity: 1 }, "--mode": { arity: 1 },
} };

function cmdStageGuard(args) {
  if (args.includes("--selftest")) return stageSelftest();
  const { values, errors } = parseArgs(args, STAGE_GUARD_SPEC);
  if (errors.length) return usageError(errors, "usage: faff stage-guard --mode assert|filter|wip [--worktree DIR] [--json]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const asJson = !!values["--json"];
  const worktree = get("--worktree") || ".";
  const mode = get("--mode");
  if (mode !== "assert" && mode !== "filter" && mode !== "wip") {
    process.stderr.write("faff stage-guard: --mode must be 'assert', 'filter', or 'wip'\n");
    return 2;
  }
  const isRepo = spawnSync("git", ["-C", worktree, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (isRepo.status !== 0) {
    process.stderr.write(`faff stage-guard: not a git work tree: ${worktree}\n`);
    return 2;
  }
  if (mode === "wip") {
    const { skipped } = wipStage(worktree);
    // exit code of `git diff --cached --quiet` is 1 when the index has changes.
    const dq = spawnSync("git", ["-C", worktree, "diff", "--cached", "--quiet"], { encoding: "utf8" });
    const stagedNonempty = dq.status === 1;
    if (asJson) console.log(JSON.stringify({ worktree, mode, skipped, staged_nonempty: stagedNonempty }));
    else console.log(`faff stage-guard: WIP staged (${stagedNonempty ? "non-empty" : "empty"})${skipped.length ? ` — skipped ${skipped.length} secret-class path(s): ${skipped.join(", ")}` : ""}`);
    return 0;
  }
  const res = guardStaged(worktree, mode);
  if (res.readFailed) {
    // FAILS LOUD: could not read the index. assert must never report a false clean.
    const msg = "faff stage-guard: could not read the git index (git failed)";
    if (asJson) console.log(JSON.stringify({ worktree, mode, ok: false, read_failed: true }));
    else process.stderr.write(msg + "\n");
    return mode === "assert" ? 2 : 0;
  }
  if (asJson) {
    console.log(JSON.stringify({ worktree, mode, ok: res.ok, secret_staged: res.secretStaged, unstaged: res.unstaged }));
  } else if (mode === "assert") {
    if (res.ok) console.log("faff stage-guard: clean — no secret-class path staged");
    else process.stderr.write(`faff stage-guard: SECRET-CLASS path(s) staged (aborting):\n${res.secretStaged.map((p) => "  " + p).join("\n")}\n`);
  } else {
    if (res.unstaged.length) console.log(`faff stage-guard: unstaged ${res.unstaged.length} secret-class path(s): ${res.unstaged.join(", ")}`);
    else console.log("faff stage-guard: clean — nothing to unstage");
  }
  return mode === "assert" && !res.ok ? 1 : 0;
}

// Pure selftest — drives the isSecretClass classification table (no git, no fs).
const STAGE_SELFTEST_CASES = [
  // [ basename-or-path, expected isSecretClass ]
  [".env", true], [".env.local", true], [".env.production", true],
  [".env.example", false], [".env.production.example", false], [".env.sample", false],
  ["server.pem", true], ["private.key", true], ["cert.p12", true], ["cert.pfx", true],
  ["store.keystore", true], ["store.jks", true],
  ["id_rsa", true], ["id_ed25519", true], ["id_ecdsa", true], ["id_dsa", true],
  ["id_rsa.pub", false], ["id_ed25519.pub", false],
  // .pub is exempt ONLY for the SSH key family — never a global exemption:
  [".env.local.pub", true], ["server.key", true], ["notes.pub", false],
  [".netrc", true], [".pgpass", true], ["team.pgpass", true],
  ["credentials", true], ["credentials.json", true], [".npmrc", true], [".pypirc", true],
  // ordinary source is never secret-class (incl. "key"/"env" substrings)
  ["index.js", false], ["README.md", false], ["config.yaml", false],
  ["key-handler.ts", false], ["monkey.js", false], ["environment.ts", false],
  // full paths are evaluated on the basename
  ["deep/nested/.env", true], ["src/id_rsa.pub", false], ["docs/config.pem", true],
];

function stageSelftest() {
  let fail = 0;
  for (const [name, want] of STAGE_SELFTEST_CASES) {
    const got = isSecretClass(name);
    if (got !== want) { fail++; console.log(`FAIL isSecretClass(${JSON.stringify(name)}) = ${got}, want ${want}`); }
    else console.log(`ok   isSecretClass(${JSON.stringify(name)}) = ${got}`);
  }
  console.log(fail ? `stage selftest: ${fail} FAILED` : `stage selftest: all ${STAGE_SELFTEST_CASES.length} passed`);
  return fail ? 1 : 0;
}

module.exports = {
  SECRET_CLASS_PATTERNS, SECRET_CLASS_ALLOW, STAGE_SELFTEST_CASES,
  isSecretClass, stagedPaths, guardStaged, wipStage,
  cmdStageGuard, stageSelftest,
};
