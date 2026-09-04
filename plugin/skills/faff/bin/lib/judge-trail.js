// ===========================================================================
// === region:factory — judge-trail — FAFF-994: durable, interrogatable spec-review ===
// judgement trail. A per-issue judgement trail (refuter objections, per-proposition judge
// rulings, the AdmitResult, and the spec text that was judged) is written VERBATIM to a
// dedicated `refs/faff/judge-trail/<run_id>` custom git ref — a durable, queryable sibling
// store that survives run-dir cleanup and needs no PR. Additive sibling to ADR-0109's
// PR-only committed-anchor rule: opens no PR, triggers no CI, is never a persistence
// precondition. Two halves live here: the WRITER (`faff judge-trail mint`, best-effort,
// called at run close) and the READER CORE (`faff judge-history`, git plumbing only, no
// checkout, `witness_sha` recomputed on every read — the store's own claimed hash is never
// trusted, mirroring bundle.js's `classifyBundle` recompute-per-read discipline).
//
// Region boundary (the single highest-risk mistake in this build): `audit.js` is
// region:governance and may NEVER `require()` this file (a governance->factory require
// edge fails `faff regions check`, the ADR-0042 direction lint). `faff audit`'s durable
// second source reaches this reader ONLY via a spawnSync self-spawn of the same `faff`
// binary (`spawnSync(process.execPath, [ENTRYPOINT, "judge-history", ...])`) — a PROCESS
// boundary, invisible to the require-graph lint by design, the exact precedent
// events.js's `cmdEventsAnchorRun` uses to reach `governance-check`. See audit.js for that
// call site; this file never imports audit.js either.
//
// Module placement: a NEW factory module rather than widening bundle.js — bundle.js's
// BundleStore occupants are shaped for a flat 7-member manifest keyed by member name, not
// the nested per-issue subtrees this trail needs (built via a temp index + `write-tree`,
// materialising real subtrees from slash-containing paths — `git mktree` only builds flat
// trees). This module owns its own thin git wrappers (gitRun/gitRunText, mirroring
// bundle.js's private ones), reusing only bundle.js's EXPORTED surface —
// `canonicalJSON` (the pinned deterministic serialisation `witness_sha` is computed over)
// and `resolveBundleStoreName` (the existing `bundle_store` config resolution: `local` ->
// `git update-ref`; `git-remote` -> non-force push to origin) — plus
// spec-judge-casefile.js's exported `sha256Text` and spec-review-convergence.js's exported
// `roundFilesInDir`.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { canonicalJSON, resolveBundleStoreName } = require("./bundle");
const { sha256Text } = require("./spec-judge-casefile");
const { roundFilesInDir } = require("./spec-review-convergence");

const SCHEMA_VERSION = 1;
const REMOTE_NAME = "origin";

// Identity-component charset — mirrors bundle.js's own (unexported) validIdentityToken:
// no ".." segment, first char never "-" (defence in depth against argv-as-flag
// confusion). Applied to run_id BEFORE it is interpolated into a ref name.
const IDENTITY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function validIdentityToken(tok) {
  return typeof tok === "string" && tok.length > 0 && IDENTITY_TOKEN_RE.test(tok) && !tok.includes("..");
}

function judgeTrailRefName(runId) {
  return `refs/faff/judge-trail/${runId}`;
}

// Thin git wrappers — the store-agnostic plumbing every occupant below shares (mirrors
// bundle.js's own gitRun/gitRunText, kept local rather than imported: bundle.js's are
// module-private by design).
function gitRun(root, args, input) {
  return spawnSync("git", ["-C", root, ...args], { input });
}
function gitRunText(root, args, input) {
  return spawnSync("git", ["-C", root, ...args], { input, encoding: "utf8" });
}

const STORE_UNAVAILABLE_RE = /no such remote|does not appear to be a git repository|could not read from remote|permission denied|repository not found|timed out|could not resolve host|unable to access|connection (refused|timed out)|fatal: unable to connect/i;
const REF_EXISTS_RE = /already exists|non-fast-forward|failed to push some refs|stale info/i;

function witnessSha(manifestCore) {
  return crypto.createHash("sha256").update(canonicalJSON(manifestCore), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Writer — faff judge-trail mint
// ---------------------------------------------------------------------------

// <run_dir>/<ISSUE>/spec-review/ dirs carrying any judgement material — round-<n>.json
// (roundFilesInDir), or a judge/ subdir with ledger.json. Sorted for determinism.
function listIssueScratchDirs(runDir) {
  let names;
  try { names = fs.readdirSync(runDir); } catch { return []; }
  const out = [];
  for (const name of names.sort()) {
    const specReviewDir = path.join(runDir, name, "spec-review");
    let st;
    try { st = fs.statSync(specReviewDir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let hasRounds = false;
    try { hasRounds = roundFilesInDir(specReviewDir).length > 0; } catch { hasRounds = false; }
    const judgeDir = path.join(specReviewDir, "judge");
    const hasJudge = fs.existsSync(path.join(judgeDir, "ledger.json"));
    if (hasRounds || hasJudge) out.push({ issue: name, specReviewDir, judgeDir });
  }
  return out;
}

// Objections — verbatim from the latest round-<n>.json's `objections` array (the standing
// residue proxy; mint has no window_start to re-derive the exact windowed residue, so the
// latest round is the closest verbatim source), with contested_source/lens/severity carried
// through UNCHANGED from the matching ledger.json entry (index-matched via the same
// propositionId(i) = "p-<01..>" scheme spec-judge-casefile.js's assemble() uses) when a
// ledger is present. Never re-derives claim/evidence/predicted_consequence.
function collectObjections(specReviewDir, ledger) {
  let rounds;
  try { rounds = roundFilesInDir(specReviewDir); } catch { rounds = []; }
  if (rounds.length === 0) return [];
  const latest = rounds[rounds.length - 1];
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(latest.path, "utf8")); } catch { return []; }
  const raw = Array.isArray(parsed.objections) ? parsed.objections : [];
  return raw.map((obj, i) => {
    const pid = `p-${String(i + 1).padStart(2, "0")}`;
    const entry = ledger && ledger.entries && ledger.entries[pid] ? ledger.entries[pid] : null;
    return {
      claim: obj && typeof obj.claim === "string" ? obj.claim : "",
      evidence: obj && typeof obj.evidence === "string" ? obj.evidence : "",
      predicted_consequence: obj && (typeof obj.predicted_consequence === "string" || obj.predicted_consequence === null)
        ? obj.predicted_consequence : null,
      spec_anchor: obj && typeof obj.spec_anchor === "string" ? obj.spec_anchor : "",
      lens: entry && typeof entry.lens === "string" ? entry.lens : (obj && typeof obj.lens === "string" ? obj.lens : ""),
      severity: entry && typeof entry.severity === "string" ? entry.severity : (obj && typeof obj.severity === "string" ? obj.severity : ""),
      contested_source: entry ? !!entry.contested_source : false,
    };
  });
}

// Rulings — verbatim ruling-<pid>.json files (the spec-judge-verdict contract shape:
// proposition_id/outcome/rationale/correction/synthesis_sources/prd_gap_citation/lens/
// severity/conformant/violations), gathered in ledger.order when a ledger is present (a
// parked pid has no ruling file and is skipped, never fabricated), else every
// ruling-*.json found directly in judgeDir (sorted) — the no-ledger edge case should not
// arise in practice (a ruling implies an assembled ledger) but degrades safely either way.
function collectRulings(judgeDir, ledger) {
  const rulings = [];
  if (ledger && Array.isArray(ledger.order)) {
    for (const pid of ledger.order) {
      const rp = path.join(judgeDir, `ruling-${pid}.json`);
      if (!fs.existsSync(rp)) continue;
      try { rulings.push(JSON.parse(fs.readFileSync(rp, "utf8"))); } catch { /* an unreadable ruling is skipped, not fatal to the mint */ }
    }
    return rulings;
  }
  let names = [];
  try { names = fs.readdirSync(judgeDir).filter((n) => /^ruling-.+\.json$/.test(n)).sort(); } catch { names = []; }
  for (const n of names) {
    try { rulings.push(JSON.parse(fs.readFileSync(path.join(judgeDir, n), "utf8"))); } catch { /* skip unreadable */ }
  }
  return rulings;
}

// The reviewed spec text: on-disk spec file if present (checked under common prep
// scratch names in <run_dir>/<issue>/), else the last proposition's pre_ruling_spec_content
// in ledger.json (that field + its pre_ruling_spec_sha sibling are written by
// spec-judge-casefile.js's assemble()). Returns null when neither is available.
const SPEC_FILE_CANDIDATES = ["spec-draft.md", "spec.md", "spec-comment.md"];
function resolveSpecText(runDir, issue, ledger) {
  for (const name of SPEC_FILE_CANDIDATES) {
    const p = path.join(runDir, issue, name);
    if (fs.existsSync(p)) {
      try { return fs.readFileSync(p, "utf8"); } catch { /* try the next candidate */ }
    }
  }
  if (ledger && Array.isArray(ledger.order) && ledger.order.length && ledger.entries) {
    const lastPid = ledger.order[ledger.order.length - 1];
    const entry = ledger.entries[lastPid];
    if (entry && typeof entry.pre_ruling_spec_content === "string") return entry.pre_ruling_spec_content;
  }
  return null;
}

// outcome: admit|park|error|no-judge — coarse disposition, for --outcome filtering.
// no-judge: no ledger.json at all (only refuter rounds; the judge never ran).
// error:    a ledger.json exists (assemble ran) but no admit-result.json (the admit
//           roll-up never completed for this issue — a run that errored mid-judge).
// admit/park: admit-result.json's own `admit` boolean, verbatim (never re-derived).
function determineOutcome(ledgerPresent, admitResult) {
  if (!ledgerPresent) return "no-judge";
  if (!admitResult || typeof admitResult.admit !== "boolean") return "error";
  return admitResult.admit === true ? "admit" : "park";
}

function readJsonMaybe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// Assemble one issue's subtree: { manifest, files: { relName: Buffer } }. Throws on a
// hard failure (caller logs + skips that one issue — best-effort per the writer contract).
function buildIssueSubtree(runDir, issue, specReviewDir, judgeDir) {
  const ledger = readJsonMaybe(path.join(judgeDir, "ledger.json"));
  const admitResult = readJsonMaybe(path.join(judgeDir, "admit-result.json"));

  const objections = collectObjections(specReviewDir, ledger);
  const rulings = collectRulings(judgeDir, ledger);
  const specText = resolveSpecText(runDir, issue, ledger);
  const builtSpecSha = sha256Text(specText || "");
  const outcome = determineOutcome(!!ledger, admitResult);
  const lenses = [...new Set(objections.map((o) => o.lens).filter((l) => l))].sort();

  const files = {};
  files["objections.json"] = Buffer.from(JSON.stringify(objections, null, 2) + "\n", "utf8");
  files["rulings.json"] = Buffer.from(JSON.stringify(rulings, null, 2) + "\n", "utf8");
  if (admitResult !== null) files["admit-result.json"] = Buffer.from(JSON.stringify(admitResult, null, 2) + "\n", "utf8");
  if (specText !== null) files["spec.txt"] = Buffer.from(specText, "utf8");

  const manifestCore = {
    schema_version: SCHEMA_VERSION,
    issue,
    run_id: path.basename(runDir),
    built_spec_sha: builtSpecSha,
    spec_blob: specText !== null ? "spec.txt" : null,
    objections: "objections.json",
    rulings: "rulings.json",
    admit_result: admitResult !== null ? "admit-result.json" : null,
    outcome,
    lenses,
  };
  const manifest = { ...manifestCore, witness_sha: witnessSha(manifestCore) };
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { manifest, files };
}

// Materialise one issue's files into the shared temp index via hash-object + update-index
// --cacheinfo (the nested-subtree idiom: git write-tree later synthesises real subtrees
// from these slash-containing "<issue>/<file>" paths — git mktree alone cannot).
function stageIssueFiles(root, tmpIndexPath, issue, files) {
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndexPath };
  for (const [relName, bytes] of Object.entries(files)) {
    const hash = spawnSync("git", ["-C", root, "hash-object", "-w", "--stdin"], { input: bytes, encoding: "utf8" });
    if (hash.status !== 0) throw new Error(`judge-trail mint: git hash-object failed for ${issue}/${relName}: ${hash.stderr || ""}`);
    const sha = hash.stdout.trim();
    const upd = spawnSync("git", ["-C", root, "update-index", "--add", "--cacheinfo", `100644,${sha},${issue}/${relName}`], { env, encoding: "utf8" });
    if (upd.status !== 0) throw new Error(`judge-trail mint: git update-index failed for ${issue}/${relName}: ${upd.stderr || ""}`);
  }
}

// mint(runDir, opts) -> { ok, code, minted, run_id, ref, commit_sha?, issues?, message? }
// Best-effort throughout: any failure returns { ok:false, code:1, message } without
// leaving a partial ref (the tmp index is scratch; nothing is pushed/updated until the
// whole tree + commit succeed). Never throws upward — the CLI wrapper below is the only
// catch boundary, but every internal failure is already caught here.
function mint(runDirArg, opts = {}) {
  const root = opts.root || findRoot();
  const runDir = path.resolve(runDirArg);
  const runId = path.basename(runDir);
  const ref = judgeTrailRefName(runId);

  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    return { ok: false, code: 1, message: `judge-trail mint: no such run dir ${runDir}`, run_id: runId, ref };
  }
  if (!validIdentityToken(runId)) {
    return { ok: false, code: 1, message: `judge-trail mint: run_id ${JSON.stringify(runId)} fails the identity charset`, run_id: runId, ref };
  }

  const issueDirs = listIssueScratchDirs(runDir);
  if (issueDirs.length === 0) {
    return { ok: true, code: 0, minted: false, run_id: runId, ref, message: "no judgement material — nothing to mint" };
  }

  const storeName = resolveBundleStoreName(root);

  // Write-once pre-check (per issue): a re-run of the same run_id must not clobber the
  // first trail — treated as already-minted, a clean no-op, regardless of on-disk drift.
  if (storeName === "git-remote") {
    const ls = gitRunText(root, ["ls-remote", REMOTE_NAME, ref]);
    if (ls.status !== 0 || ls.error) {
      return { ok: false, code: 1, message: `judge-trail mint: cannot reach ${REMOTE_NAME} to check ${ref}`, run_id: runId, ref };
    }
    if (ls.stdout.trim()) {
      return { ok: true, code: 0, minted: false, run_id: runId, ref, message: `${ref} already exists on ${REMOTE_NAME} — clean no-op` };
    }
  } else {
    const show = gitRun(root, ["show-ref", "--verify", "--quiet", ref]);
    if (show.status === 0) {
      return { ok: true, code: 0, minted: false, run_id: runId, ref, message: `${ref} already exists locally — clean no-op` };
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-judge-trail-"));
  const tmpIndex = path.join(tmpDir, "index");
  try {
    const issuesMinted = [];
    for (const { issue, specReviewDir, judgeDir } of issueDirs) {
      let subtree;
      try { subtree = buildIssueSubtree(runDir, issue, specReviewDir, judgeDir); }
      catch (e) { process.stderr.write(`faff judge-trail mint: skipping ${issue} — ${e.message}\n`); continue; }
      try { stageIssueFiles(root, tmpIndex, issue, subtree.files); }
      catch (e) { return { ok: false, code: 1, message: e.message, run_id: runId, ref }; }
      issuesMinted.push(issue);
    }
    if (issuesMinted.length === 0) {
      return { ok: true, code: 0, minted: false, run_id: runId, ref, message: "no issue subtree produced material — nothing to mint" };
    }

    const writeTree = spawnSync("git", ["-C", root, "write-tree"], { env: { ...process.env, GIT_INDEX_FILE: tmpIndex }, encoding: "utf8" });
    if (writeTree.status !== 0) return { ok: false, code: 1, message: `judge-trail mint: git write-tree failed: ${writeTree.stderr || ""}`, run_id: runId, ref };
    const treeSha = writeTree.stdout.trim();

    const commitTree = gitRunText(root, ["commit-tree", treeSha, "-m", `judge-trail ${runId}`]);
    if (commitTree.status !== 0) return { ok: false, code: 1, message: `judge-trail mint: git commit-tree failed: ${commitTree.stderr || ""}`, run_id: runId, ref };
    const commitSha = commitTree.stdout.trim();

    if (storeName === "git-remote") {
      const push = gitRunText(root, ["push", REMOTE_NAME, `${commitSha}:${ref}`]);
      if (push.status !== 0) {
        const stderr = push.stderr || "";
        if (REF_EXISTS_RE.test(stderr)) {
          return { ok: true, code: 0, minted: false, run_id: runId, ref, message: `${ref} already exists on ${REMOTE_NAME} — clean no-op (race)` };
        }
        if (STORE_UNAVAILABLE_RE.test(stderr) || push.error) {
          return { ok: false, code: 1, message: `judge-trail mint: store unavailable pushing ${ref}: ${stderr.trim() || String(push.error)}`, run_id: runId, ref };
        }
        return { ok: false, code: 1, message: `judge-trail mint: git push failed for ${ref}: ${stderr}`, run_id: runId, ref };
      }
    } else {
      const upd = spawnSync("git", ["-C", root, "update-ref", ref, commitSha]);
      if (upd.status !== 0) return { ok: false, code: 1, message: `judge-trail mint: git update-ref failed for ${ref}: ${(upd.stderr || "").toString()}`, run_id: runId, ref };
    }

    return { ok: true, code: 0, minted: true, run_id: runId, ref, commit_sha: commitSha, issues: issuesMinted };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

// In-process selftest of the pure cores (mirrors the shape of eligible/park-verdict's own
// --selftest — a plain check() table, no process.exit). The full mint -> judge-history git
// round trip (including the write-once no-op and tamper-suspect detection) is covered by
// test/judge-trail.test.mjs, which spins up a scratch bare-repo remote; this selftest stays
// fast and dependency-free so `faff regions selftest` never needs a git fixture for it.
function judgeTrailSelftest() {
  let failed = 0;
  const ok = (label, cond) => { if (!cond) { process.stderr.write(`judge-trail --selftest FAIL: ${label}\n`); failed++; } };

  ok("judgeTrailRefName", judgeTrailRefName("run-abc-123") === "refs/faff/judge-trail/run-abc-123");
  ok("validIdentityToken rejects ..", !validIdentityToken("run-..-evil"));
  ok("validIdentityToken rejects empty", !validIdentityToken(""));
  ok("validIdentityToken accepts a normal run id", validIdentityToken("run-20260904-095513-beepboop-list-72ed27"));

  // determineOutcome: the four-way coarse disposition.
  ok("determineOutcome: no ledger -> no-judge", determineOutcome(false, null) === "no-judge");
  ok("determineOutcome: ledger, no admit-result -> error", determineOutcome(true, null) === "error");
  ok("determineOutcome: ledger, admit:true -> admit", determineOutcome(true, { admit: true }) === "admit");
  ok("determineOutcome: ledger, admit:false -> park", determineOutcome(true, { admit: false }) === "park");
  ok("determineOutcome: ledger, malformed admit-result -> error", determineOutcome(true, { admit: "yes" }) === "error");

  // witness_sha: deterministic across key order, and a mutated core changes the digest —
  // the recompute-on-read discipline judgeHistory's readManifestRecord relies on.
  const core1 = { schema_version: 1, issue: "FAFF-1", run_id: "r", built_spec_sha: "abc", outcome: "admit", lenses: ["qa"] };
  const core2 = { lenses: ["qa"], outcome: "admit", built_spec_sha: "abc", run_id: "r", issue: "FAFF-1", schema_version: 1 };
  ok("witnessSha is key-order independent", witnessSha(core1) === witnessSha(core2));
  const core3 = { ...core1, outcome: "park" };
  ok("witnessSha changes when the manifest core changes", witnessSha(core1) !== witnessSha(core3));

  // collectObjections: verbatim triple + ledger-carried contested_source, index-matched by
  // the same p-01/p-02 scheme spec-judge-casefile.js's assemble() uses.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-judge-trail-selftest-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "round-1.json"), JSON.stringify({
      verdict: "reject-approach",
      objections: [
        { lens: "infosec", severity: "major", claim: "leak", evidence: "see config.txt", predicted_consequence: "exfiltration", spec_anchor: "the-guard" },
      ],
    }));
    const ledgerFixture = { order: ["p-01"], entries: { "p-01": { lens: "infosec", severity: "major", contested_source: true } } };
    const objs = collectObjections(tmpDir, ledgerFixture);
    ok("collectObjections: one objection", objs.length === 1);
    ok("collectObjections: claim/evidence verbatim", objs[0] && objs[0].claim === "leak" && objs[0].evidence === "see config.txt");
    ok("collectObjections: contested_source carried through from the ledger", objs[0] && objs[0].contested_source === true);
    const objsNoLedger = collectObjections(tmpDir, null);
    ok("collectObjections: no ledger -> contested_source defaults false", objsNoLedger[0] && objsNoLedger[0].contested_source === false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (judge-trail --selftest, ${failed} failed)`);
  return failed ? 1 : 0;
}

const JUDGE_TRAIL_MINT_SPEC = { flags: { "--run-dir": { arity: 1 }, "--root": { arity: 1 }, "--json": { arity: 0 } }, positionals: { min: 0, max: 0 } };

function cmdJudgeTrail(args) {
  if (args.includes("--selftest")) return judgeTrailSelftest();
  const sub = args[0];
  if (sub === "mint") {
    const { values, errors } = parseArgs(args.slice(1), JUDGE_TRAIL_MINT_SPEC);
    if (errors.length) return usageError(errors, "usage: faff judge-trail mint --run-dir <dir> [--root <repo>] [--json]");
    const runDirArg = values["--run-dir"];
    if (!runDirArg) { process.stderr.write("faff judge-trail mint: --run-dir required\n"); return 2; }
    const root = values["--root"] || findRoot();
    let result;
    try { result = mint(runDirArg, { root }); }
    catch (e) { result = { ok: false, code: 1, message: `judge-trail mint: unexpected error: ${e.message}` }; }
    if (values["--json"]) console.log(JSON.stringify(result));
    else console.log(result.message || (result.minted ? `minted ${result.ref} (${(result.issues || []).length} issue(s))` : "no-op"));
    return result.ok ? 0 : 1;
  }
  process.stderr.write("faff judge-trail: expected 'mint'\nusage: faff judge-trail mint --run-dir <dir> [--root <repo>] [--json]\n");
  return 2;
}

// ---------------------------------------------------------------------------
// Reader core — faff judge-history. Git plumbing only (for-each-ref/ls-remote/show/
// ls-tree) — never a checkout. `faff audit`'s durable second source is a SECOND consumer
// of this same reader core (self-spawned, see the file banner) — this function/CLI is the
// "one reader core" the spec's audit second-source design decision refers to.
// ---------------------------------------------------------------------------

function enumerateRefs(root, storeName) {
  if (storeName === "git-remote") {
    const ls = gitRunText(root, ["ls-remote", REMOTE_NAME, "refs/faff/judge-trail/*"]);
    if (ls.status !== 0 || ls.error) return { ok: false, reason: "store_unavailable" };
    const out = [];
    for (const line of ls.stdout.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [sha, refPath] = t.split(/\s+/);
      out.push({ runId: refPath.split("/").pop(), sha, refPath });
    }
    return { ok: true, refs: out };
  }
  const fe = gitRunText(root, ["for-each-ref", "refs/faff/judge-trail/", "--format=%(objectname) %(refname)"]);
  if (fe.status !== 0) return { ok: false, reason: "unreadable" };
  const out = [];
  for (const line of fe.stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const [sha, refPath] = t.split(/\s+/);
    out.push({ runId: refPath.split("/").pop(), sha, refPath });
  }
  return { ok: true, refs: out };
}

function listTreeIssues(root, commitSha) {
  const ls = gitRunText(root, ["ls-tree", "--name-only", commitSha]);
  if (ls.status !== 0) return [];
  return ls.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

// Returns a Buffer, or null when the path is absent at that commit.
function showBlob(root, commitSha, relPath) {
  const show = gitRun(root, ["show", `${commitSha}:${relPath}`]);
  if (show.status !== 0) return null;
  return show.stdout;
}

// Recomputes witness_sha over the manifest core (everything but witness_sha itself) using
// the SAME canonicalJSON the write path used — the store's own claimed hash is never
// trusted. A mismatch, a missing manifest, or an unparseable one all render tamper_suspect
// (the record is retained either way, never dropped).
function readManifestRecord(runId, root, commitSha, issue) {
  const bytes = showBlob(root, commitSha, `${issue}/manifest.json`);
  if (bytes === null) return { run_id: runId, issue, outcome: null, lenses: [], manifest: null, tamper_suspect: true, parse_error: "manifest.json missing" };
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); }
  catch (e) { return { run_id: runId, issue, outcome: null, lenses: [], manifest: null, tamper_suspect: true, parse_error: `manifest.json unparseable: ${e.message}` }; }
  if (!manifest || typeof manifest !== "object" || typeof manifest.witness_sha !== "string") {
    return { run_id: runId, issue, outcome: (manifest && manifest.outcome) || null, lenses: (manifest && manifest.lenses) || [], manifest, tamper_suspect: true, parse_error: "manifest.json missing witness_sha" };
  }
  const core = { ...manifest };
  delete core.witness_sha;
  const recomputed = witnessSha(core);
  const tamperSuspect = recomputed !== manifest.witness_sha;
  return { run_id: runId, issue, outcome: manifest.outcome, lenses: Array.isArray(manifest.lenses) ? manifest.lenses : [], manifest, tamper_suspect: tamperSuspect };
}

// judgeHistory(filters, opts) -> { ok:true, records:[...], note? }. Never throws; a
// store-unavailable enumeration degrades to an empty result set with a note rather than
// failing the caller (faff audit's second source treats absence as additive-absent).
function judgeHistory(filters = {}, opts = {}) {
  const root = opts.root || findRoot();
  const storeName = resolveBundleStoreName(root);
  const enumd = enumerateRefs(root, storeName);
  if (!enumd.ok) return { ok: true, records: [], note: `durable judge-trail unavailable: ${enumd.reason}` };

  let refs = enumd.refs;
  if (filters.run) refs = refs.filter((r) => r.runId === filters.run);

  const records = [];
  for (const r of refs) {
    if (storeName === "git-remote") {
      const fetch = gitRunText(root, ["fetch", "--no-tags", REMOTE_NAME, r.refPath]);
      if (fetch.status !== 0) { records.push({ run_id: r.runId, issue: null, outcome: null, lenses: [], manifest: null, tamper_suspect: true, parse_error: "fetch failed" }); continue; }
    }
    const issues = listTreeIssues(root, r.sha);
    for (const issue of issues) {
      if (filters.issue && issue !== filters.issue) continue;
      records.push(readManifestRecord(r.runId, root, r.sha, issue));
    }
  }

  let out = records;
  if (filters.lens) out = out.filter((rec) => Array.isArray(rec.lenses) && rec.lenses.includes(filters.lens));
  if (filters.outcome) out = out.filter((rec) => rec.outcome === filters.outcome);
  return { ok: true, records: out };
}

const JUDGE_HISTORY_SPEC = {
  flags: {
    "--issue": { arity: 1 },
    "--run": { arity: 1 },
    "--lens": { arity: 1 },
    "--outcome": { arity: 1 },
    "--root": { arity: 1 },
    "--json": { arity: 0 },
  },
  positionals: { min: 0, max: 0 },
};

function cmdJudgeHistory(args) {
  const { values, errors } = parseArgs(args, JUDGE_HISTORY_SPEC);
  if (errors.length) return usageError(errors, "usage: faff judge-history [--issue ID] [--run RUN_ID] [--lens L] [--outcome O] [--root DIR] [--json]");
  const root = values["--root"] || findRoot();
  const filters = {
    issue: values["--issue"] || null,
    run: values["--run"] || null,
    lens: values["--lens"] || null,
    outcome: values["--outcome"] || null,
  };
  const result = judgeHistory(filters, { root });
  if (values["--json"]) { console.log(JSON.stringify(result.records)); return 0; }
  if (result.records.length === 0) { console.log(result.note || "no judge-trail records found"); return 0; }
  for (const rec of result.records) {
    const flag = rec.tamper_suspect ? " TAMPER-SUSPECT (witness_sha mismatch)" : "";
    console.log(`${rec.run_id}/${rec.issue}  outcome=${rec.outcome || "?"}  lenses=${(rec.lenses || []).join(",")}${flag}`);
  }
  return 0;
}

module.exports = {
  judgeTrailRefName,
  validIdentityToken,
  witnessSha,
  listIssueScratchDirs,
  collectObjections,
  collectRulings,
  resolveSpecText,
  determineOutcome,
  buildIssueSubtree,
  mint,
  cmdJudgeTrail,
  judgeTrailSelftest,
  enumerateRefs,
  readManifestRecord,
  judgeHistory,
  cmdJudgeHistory,
};
