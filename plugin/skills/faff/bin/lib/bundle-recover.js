// ===========================================================================
// === region:factory — bundle-recover — FAFF-820: recover safely on a later executor from a verified Phase 0 bundle ===
//
// A READ-ONLY recovery verb for a FRESH executor with no local `.faff/runs/<run-id>/`:
// discover the most recent Phase 0 recovery bundle for an issue across every run
// (FAFF-819's bundle store), verify it through the SAME fail-closed six-value ladder
// `faff bundle verify` uses (`classifyBundle`/`verifyBundleIdentity` — never forked),
// reconstruct the run directory at a fresh root from a CLEAN bundle's own bytes, and
// compute a read-only resume-or-park preview by handing the reconstructed ledger to
// the SAME shipped resume cores `faff lights-out --resume` uses (`classifyReEnterable`,
// `reconstructResumePlan`, `gatherResumeEvidence`).
//
// This verb writes NO owner state (never owner.status, never owner.epoch) and makes
// NO forge call (`gh`) — a shipped issue whose merge cannot be proven from bundle
// bytes parks, never skips (the bundle carries no merge-record.json, so the reused
// evidence gatherer's own null-recorded short-circuit already enforces this). The
// continuation that DOES write owner state stays `faff lights-out --resume <run-id>`,
// run separately once this verb reports `reconstructed` — see records/specs/
// 2026-08-17-faff-820-*.md §2 (out of scope) for the ADR-lineage rationale (ADR-0056/
// 0057/0098/0115: only the run's own agents write owner.status).
//
// Design-ambiguity note (flagged, not silently resolved): the spec's discovery
// mechanism is keyed by issue (`refs/faff/bundles/*/seg-*/<ISSUE>` / `.faff/bundles/
// */seg-*/<ISSUE>/`), which can never surface a run-close boundary (its boundary_key
// is literally "run-close", never an issue id) — yet spec §4's edge cases require a
// run-close bundle to be reachable "via --run-id". This module resolves that gap by
// additionally probing the run-close identity for the given --run-id directly (at the
// segment id observed on that run's own per-issue candidates, or segment 0 as a
// last-resort default when none was found) whenever --run-id is supplied. Flagged in
// the FAFF-820 build report for human confirmation.
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { findRoot, readLedger } = require("./shared-infra");
const { isValidIssueId } = require("./heartbeat");
const { verifyBundleIdentity, resolveBundleStore, resolveBundleStoreName } = require("./bundle");
const { classifyReEnterable, reconstructResumePlan } = require("./resume");
const { gatherResumeEvidence } = require("./lights-out");
const { computeEscapes } = require("./effects");
const { computeRecoveryDispositionVerdict } = require("./contract-defs");

const GIT_REMOTE_NAME = "origin"; // matches bundle.js's gitRemoteBundleStore default — never a second remote name

// ---------------------------------------------------------------------------
// PURE — selectMostRecent(cleanCandidates): the cross-run "most recent" pick (spec §3).
// `candidates` is [{ identity, ts }] — every entry ALREADY verified CLEAN by the caller
// (this function never re-derives a verdict). Orders by latest `last_safe_boundary.ts`,
// tiebreaks on the sortable `run-YYYYMMDD-HHMMSS` prefix of run_id, and reports an
// ambiguity signal when two DISTINCT candidates (different run_id or boundary_key) are
// indistinguishable on both. Selection ordering is explicitly best-effort, not
// correctness-bearing (spec §3 "Selection ordering is best-effort") — a wrong pick is
// bounded by the CLEAN-only admission gate and the park defaults, never a bad accept.
// ---------------------------------------------------------------------------
const RUN_ID_SORT_PREFIX_RE = /^run-(\d{8}-\d{6})/;
function runIdSortPrefix(runId) {
  const m = typeof runId === "string" ? runId.match(RUN_ID_SORT_PREFIX_RE) : null;
  return m ? m[1] : null;
}

function selectMostRecent(candidates) {
  const list = Array.isArray(candidates)
    ? candidates.filter((c) => c && c.identity && typeof c.ts === "string")
    : [];
  if (list.length === 0) return { chosen: null, ambiguous: false };

  const scored = list.map((c) => ({
    candidate: c,
    tsMs: Date.parse(c.ts),
    prefix: runIdSortPrefix(c.identity.run_id),
  }));
  scored.sort((a, b) => {
    const tsA = Number.isFinite(a.tsMs) ? a.tsMs : -Infinity;
    const tsB = Number.isFinite(b.tsMs) ? b.tsMs : -Infinity;
    if (tsB !== tsA) return tsB - tsA; // latest ts first
    const pa = a.prefix || "";
    const pb = b.prefix || "";
    if (pb !== pa) return pb.localeCompare(pa); // latest run_id prefix first
    return 0; // indistinguishable on both keys — the ambiguity check below decides
  });

  const top = scored[0];
  const runnerUp = scored[1];
  const distinctBundle = !!runnerUp && (
    runnerUp.candidate.identity.run_id !== top.candidate.identity.run_id
    || runnerUp.candidate.identity.boundary_key !== top.candidate.identity.boundary_key
  );
  const tied = distinctBundle
    && runnerUp.tsMs === top.tsMs
    && (runnerUp.prefix || "") === (top.prefix || "");
  if (tied) return { chosen: null, ambiguous: true };
  return { chosen: top.candidate, ambiguous: false };
}

// ---------------------------------------------------------------------------
// PURE — idempotencyDecision(existingLedgerBytes, bundleLedgerBytes): the write-once
// rule (spec §3, reusing the SAME rule `localExistingBundleResult` applies to a bundle
// store write). `absent` when nothing exists yet at the reconstruction target (proceed
// to write); `match` when the existing bytes equal the bundle's own (idempotent no-op);
// `conflict` when they differ (never overwritten — surfaced as an identity-conflict refusal).
// ---------------------------------------------------------------------------
function idempotencyDecision(existingLedgerBytes, bundleLedgerBytes) {
  if (existingLedgerBytes === null || existingLedgerBytes === undefined) return "absent";
  const a = Buffer.isBuffer(existingLedgerBytes) ? existingLedgerBytes : Buffer.from(String(existingLedgerBytes));
  const b = Buffer.isBuffer(bundleLedgerBytes) ? bundleLedgerBytes : Buffer.from(String(bundleLedgerBytes));
  return a.equals(b) ? "match" : "conflict";
}

// ---------------------------------------------------------------------------
// PURE — foldEscapesIntoPlan(plan, escapes): the escaped-effect fold (spec §3
// "Escaped-effect check" / §4 preview_resume). Any `computeEscapes` escape moves its
// issue OUT of every dispatch-eligible bucket and INTO park — an ambiguous effect state
// must never read as skip/continue/redispatch, only as a park needing reconciliation.
// An issue already parked (e.g. a shipped-divergence park) is left as-is, never duplicated.
// ---------------------------------------------------------------------------
function foldEscapesIntoPlan(plan, escapes) {
  const base = plan && typeof plan === "object" ? plan : {};
  const next = {
    skip: Array.isArray(base.skip) ? base.skip.slice() : [],
    continue_review: Array.isArray(base.continue_review) ? base.continue_review.slice() : [],
    continue_from_push: Array.isArray(base.continue_from_push) ? base.continue_from_push.slice() : [],
    redispatch: Array.isArray(base.redispatch) ? base.redispatch.slice() : [],
    park: Array.isArray(base.park) ? base.park.slice() : [],
    terminal: Array.isArray(base.terminal) ? base.terminal.slice() : [],
    drain_remainder: base.drain_remainder !== false,
  };
  for (const esc of (escapes || [])) {
    const issue = esc.issue;
    if (next.park.some((p) => p.issue === issue)) continue; // already parked — never a duplicate/contradictory entry
    next.skip = next.skip.filter((i) => i !== issue);
    next.continue_review = next.continue_review.filter((i) => i !== issue);
    next.continue_from_push = next.continue_from_push.filter((i) => i !== issue);
    next.redispatch = next.redispatch.filter((i) => i !== issue);
    next.park.push({
      issue,
      divergence: {
        class: "escaped-side-effect",
        issue,
        detail: `${(esc.escaped || []).length} observed effect(s) at step ${esc.step} with no covering declaration`,
      },
    });
  }
  return next;
}

// PURE — the shared shape of a refused disposition (spec §3 RecoveryDisposition record).
function refusedDisposition({ bundle_verdict, bundle_identity, run_id, boundary_kind, reason, candidates_considered }) {
  return {
    verb: "bundle-recover",
    disposition: "refused",
    bundle_verdict,
    bundle_identity: bundle_identity || null,
    run_id: run_id || "",
    run_dir: null,
    boundary_kind: boundary_kind || "issue-merge-floor",
    reason,
    resume_preview: null,
    candidates_considered: Number.isInteger(candidates_considered) ? candidates_considered : 0,
  };
}

// ---------------------------------------------------------------------------
// IMPURE — cross-run discovery (spec §3 "Cross-run discovery mechanism"). Store-specific,
// reusing each occupant's own primitives/idiom; returns raw {run_id, run_segment_id,
// boundary_kind, boundary_key} candidates to verify (never a verdict itself — verification
// is always the separate, unforked verifyBundleIdentity step below).
// ---------------------------------------------------------------------------
function discoverLocalCandidates(root, issue) {
  const bundlesRoot = path.join(root, ".faff", "bundles");
  const out = [];
  let runDirs;
  try { runDirs = fs.readdirSync(bundlesRoot); } catch { return out; }
  for (const runId of runDirs) {
    let segDirs;
    try { segDirs = fs.readdirSync(path.join(bundlesRoot, runId)); } catch { continue; }
    for (const seg of segDirs) {
      const m = seg.match(/^seg-(\d+)$/);
      if (!m) continue;
      const boundaryDir = path.join(bundlesRoot, runId, seg, issue);
      if (fs.existsSync(path.join(boundaryDir, "manifest.json"))) {
        out.push({ run_id: runId, run_segment_id: Number(m[1]), boundary_kind: "issue-merge-floor", boundary_key: issue });
      }
    }
  }
  return out;
}

function discoverLocalRunCloseCandidate(root, runId, segmentId) {
  const dir = path.join(root, ".faff", "bundles", runId, `seg-${segmentId}`, "run-close");
  if (fs.existsSync(path.join(dir, "manifest.json"))) {
    return { run_id: runId, run_segment_id: segmentId, boundary_kind: "run-close", boundary_key: "run-close" };
  }
  return null;
}

// Widens gitRemoteBundleStore.listBoundaries' own ls-remote glob idiom (bundle.js
// `refs/faff/bundles/${run_id}/seg-${run_segment_id}/*`) from one (run_id, segment) to
// every run's boundary ref for this issue — the SAME "no fetch, one ls-remote" read shape.
function discoverGitRemoteCandidates(root, issue) {
  const pattern = `refs/faff/bundles/*/seg-*/${issue}`;
  const r = spawnSync("git", ["-C", root, "ls-remote", GIT_REMOTE_NAME, pattern], { encoding: "utf8" });
  if (r.status !== 0 || r.error) return { candidates: [], unreachable: true };
  const out = [];
  for (const line of (r.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const refPath = trimmed.split(/\s+/)[1];
    const m = refPath && refPath.match(/^refs\/faff\/bundles\/([^/]+)\/seg-(\d+)\/(.+)$/);
    if (!m || m[3] !== issue) continue; // defence in depth against a glob false-positive
    out.push({ run_id: m[1], run_segment_id: Number(m[2]), boundary_kind: "issue-merge-floor", boundary_key: m[3] });
  }
  return { candidates: out, unreachable: false };
}

function discoverGitRemoteRunCloseCandidate(root, runId, segmentId) {
  const ref = `refs/faff/bundles/${runId}/seg-${segmentId}/run-close`;
  const r = spawnSync("git", ["-C", root, "ls-remote", GIT_REMOTE_NAME, ref], { encoding: "utf8" });
  if (r.status !== 0 || r.error || !(r.stdout || "").trim()) return null;
  return { run_id: runId, run_segment_id: segmentId, boundary_kind: "run-close", boundary_key: "run-close" };
}

// discover_by_issue (spec §4 step 2): store-dispatch + the --run-id narrowing + the
// run-close-via---run-id probe (see the module banner's flagged design-ambiguity note).
function discoverCandidates({ storeName, root, issue, runId }) {
  let raw;
  let unreachable = false;
  if (storeName === "git-remote") {
    const r = discoverGitRemoteCandidates(root, issue);
    raw = r.candidates;
    unreachable = r.unreachable;
  } else {
    raw = discoverLocalCandidates(root, issue);
  }
  if (runId) raw = raw.filter((c) => c.run_id === runId);
  if (runId && !unreachable) {
    const segmentsToProbe = raw.length ? [...new Set(raw.map((c) => c.run_segment_id))] : [0];
    for (const seg of segmentsToProbe) {
      const rc = storeName === "git-remote"
        ? discoverGitRemoteRunCloseCandidate(root, runId, seg)
        : discoverLocalRunCloseCandidate(root, runId, seg);
      if (rc) raw.push(rc);
    }
  }
  return { candidates: raw, unreachable };
}

// ---------------------------------------------------------------------------
// IMPURE — fetch two of a CLEAN bundle's own already-proven member bytes for
// reconstruction (ledger_snapshot, anchors). No re-verification here — the digest chain
// was already proven CLEAN for this exact identity by verifyBundleIdentity/classifyBundle;
// this is a second READ of already-trusted bytes, never a second trust decision.
// ---------------------------------------------------------------------------
function fetchCleanMemberBytes(store, identity, names) {
  const out = {};
  for (const name of names) {
    const m = store.member(identity, name);
    if (!m || m.status !== "ok") {
      throw new Error(`member ${name} unreadable after a CLEAN verdict for ${identity.run_id}/${identity.boundary_key} — internal fault`);
    }
    out[name] = m.bytes;
  }
  return out;
}

// ---------------------------------------------------------------------------
// IMPURE — reconstruct_projection (spec §3/§4): write EXACTLY three targets from the
// CLEAN bundle's own bytes — nothing else is claimed as recovered (no shell, container,
// worktree, or per-issue build checkpoint outside the anchor's own files map).
// ---------------------------------------------------------------------------
// A CLEAN verdict proves the anchors member's BYTES match the bundle's own recorded digest —
// it proves nothing about the rel-paths encoded inside those bytes being safe to join onto a
// real directory. Reject absolute paths and any ".."-segment before ever touching disk: this
// write is a NEW persistent-write surface (bundle.js's own tamper check only ever materialises
// into a throwaway temp dir), so the containment guard is defence-in-depth within FAFF-819's
// CLEAN trust model, not a redundant check.
function isSafeAnchorRelPath(rel) {
  if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel)) return false;
  return !rel.split("/").some((seg) => seg === "..");
}

function reconstructProjection(targetRoot, identity, memberBytes) {
  const runId = identity.run_id;
  const boundaryKey = identity.boundary_key;
  const runDir = path.join(targetRoot, ".faff", "runs", runId);
  const anchorDir = path.join(targetRoot, ".faff", "anchors", runId, boundaryKey);

  let anchors;
  try { anchors = JSON.parse(memberBytes.anchors.toString("utf8")); }
  catch (e) { throw new Error(`anchors member is not valid JSON after a CLEAN verdict: ${e.message}`); }
  const files = (anchors && typeof anchors.files === "object" && anchors.files) ? anchors.files : {};
  // hasOwnProperty, never a truthiness check — an empty (but PRESENT) events.jsonl
  // base64-decodes to "", which is falsy and would wrongly read as absent.
  if (!Object.prototype.hasOwnProperty.call(files, "events.jsonl")) {
    // REQUIRED_MEMBERS + mintIssueAnchor guarantee a CLEAN bundle's anchor always carries
    // events.jsonl — reaching here is an internal fault, not a normal branch.
    throw new Error("a CLEAN bundle's anchor carries no events.jsonl — internal fault");
  }
  // Validate EVERY rel-path before writing ANY file — a bad key partway through the map must
  // never leave a half-written anchor dir alongside an already-escaped write.
  for (const rel of Object.keys(files)) {
    if (!isSafeAnchorRelPath(rel)) {
      throw new Error(`anchors member carries an unsafe path "${rel}" (absolute or '..'-escaping) — refusing to write outside the anchor directory`);
    }
  }

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), memberBytes.ledger_snapshot);
  for (const [rel, b64] of Object.entries(files)) {
    const dest = path.join(anchorDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(b64, "base64"));
  }
  fs.copyFileSync(path.join(anchorDir, "events.jsonl"), path.join(runDir, "events.jsonl"));

  return { runDir, anchorDir };
}

// ---------------------------------------------------------------------------
// IMPURE (read-only) — preview_resume (spec §4): gathers evidence from the reconstructed
// directory the SAME way `resumeLightsOut` does (the unforked `gatherResumeEvidence`),
// runs the SAME pure `classifyReEnterable`/`reconstructResumePlan` cores, and folds in
// any `computeEscapes` escape over the reconstructed anchor's declared-effects.jsonl.
// Writes nothing: no ledger write, no owner.epoch/owner.status, no heartbeat file.
// ---------------------------------------------------------------------------
function readDeclaredEffectsEntries(anchorDir) {
  const p = path.join(anchorDir, "declared-effects.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// PURE — the canonical "nothing to resume" plan: every bucket empty, drain_remainder false
// (there is no admitted-set settlement left to drain — the run itself is not re-enterable).
function emptyResumePlan() {
  return { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: false };
}

function previewResume(runDir, root, boundaryKey) {
  const ledger = readLedger(runDir);
  // No live heartbeat is possible on a reconstructed directory (spec "Cross-box liveness"):
  // this verb never writes a heartbeat file for a run it did not itself continue, and a
  // fresh box cannot observe the original box's process — held is always false here.
  const cls = classifyReEnterable(ledger, { held: false });
  if (!cls.reEnterable) {
    // done-clean (or any other refusal state, e.g. a run-close ledger with every outcome
    // already settled) has nothing left to resume — running reconstructResumePlan here would
    // wrongly park a settled, unprovable-merge issue on a run nobody will ever continue. The
    // `state` field already carries WHY (done-clean, live-running, ...); the plan itself stays
    // the canonical empty shape.
    return { reEnterable: false, state: cls.state, plan: emptyResumePlan() };
  }
  const evidence = gatherResumeEvidence(runDir, root, ledger, null);
  let plan = reconstructResumePlan(ledger, evidence);

  const runId = path.basename(runDir);
  const anchorDir = path.join(root, ".faff", "anchors", runId, boundaryKey);
  const entries = readDeclaredEffectsEntries(anchorDir);
  const { escapes } = computeEscapes(entries, null);
  plan = foldEscapesIntoPlan(plan, escapes);

  return { reEnterable: true, state: cls.state, plan };
}

// ---------------------------------------------------------------------------
// IMPURE shell — bundleRecover (spec §4 PROCEDURE bundle_recover): resolve, discover,
// verify, select, reconstruct, preview, report. Every read-only step reuses a shipped
// primitive verbatim; this function introduces no new verification/resume logic.
// ---------------------------------------------------------------------------
function bundleRecover({ issue, runId, root, dryRun, store, storeName }) {
  const resolvedRoot = root || findRoot();
  const resolvedStoreName = storeName || resolveBundleStoreName(resolvedRoot);
  const resolvedStore = store || resolveBundleStore(resolvedRoot);

  const { candidates: rawCandidates, unreachable } = discoverCandidates({
    storeName: resolvedStoreName, root: resolvedRoot, issue, runId,
  });
  if (unreachable) {
    return refusedDisposition({
      bundle_verdict: "VERIFICATION_UNAVAILABLE", bundle_identity: null, run_id: runId || "",
      boundary_kind: "issue-merge-floor",
      reason: `the ${resolvedStoreName} store's backing remote is unreachable — discovery could not enumerate bundles for ${issue}`,
      candidates_considered: 0,
    });
  }
  if (rawCandidates.length === 0) {
    return refusedDisposition({
      bundle_verdict: "MISSING", bundle_identity: null, run_id: runId || "",
      boundary_kind: "issue-merge-floor",
      reason: `no bundle for ${issue} in the ${resolvedStoreName} store`,
      candidates_considered: 0,
    });
  }

  const verified = rawCandidates.map((identity) => verifyBundleIdentity(identity, { root: resolvedRoot, store: resolvedStore }));

  const clean = [];
  const cleanDroppedForTs = []; // CLEAN candidates whose own last_safe_boundary.ts was missing/unreadable/malformed — kept separate so a refusal never claims "no CLEAN bundle" when one genuinely was CLEAN
  for (const v of verified) {
    if (v.verdict !== "CLEAN") continue;
    let ts = null;
    try {
      const m = resolvedStore.member(v.identity, "last_safe_boundary");
      if (m && m.status === "ok") {
        const parsed = JSON.parse(m.bytes.toString("utf8"));
        if (typeof parsed.ts === "string") ts = parsed.ts;
      }
    } catch { ts = null; }
    if (ts) clean.push({ identity: v.identity, ts });
    else cleanDroppedForTs.push(v);
  }

  if (clean.length === 0 && cleanDroppedForTs.length > 0) {
    // A defensive-only path: classifyBundle already proved CLEAN, so the digest chain is
    // intact — this only fires if last_safe_boundary itself is unreadable/malformed at read
    // time (a store hiccup between verify and this second member fetch, or a genuinely
    // malformed member classifyBundle's own MALFORMED leg somehow missed). Never report "no
    // CLEAN bundle" here — one WAS CLEAN; name the real, specific reason instead.
    const cause = cleanDroppedForTs[0];
    return refusedDisposition({
      bundle_verdict: "CLEAN", bundle_identity: cause.identity,
      run_id: (cause.identity && cause.identity.run_id) || runId || "",
      boundary_kind: (cause.identity && cause.identity.boundary_kind) || "issue-merge-floor",
      reason: `a CLEAN bundle for ${issue} carried no usable last_safe_boundary.ts (the member was missing, unreadable, or malformed at read time) — refusing rather than guessing a recency order`,
      candidates_considered: rawCandidates.length,
    });
  }

  if (clean.length === 0) {
    const preferred = verified.find((v) => v.verdict === "STALE") || verified[0];
    const supersededNote = preferred.superseded_by
      ? `; superseded_by ${preferred.superseded_by.run_id}/${preferred.superseded_by.boundary_key}` : "";
    return refusedDisposition({
      bundle_verdict: preferred.verdict, bundle_identity: preferred.identity,
      run_id: (preferred.identity && preferred.identity.run_id) || runId || "",
      boundary_kind: (preferred.identity && preferred.identity.boundary_kind) || "issue-merge-floor",
      reason: `no CLEAN bundle for ${issue}; verdicts seen: ${verified.map((v) => v.verdict).join(", ")}${supersededNote}`,
      candidates_considered: rawCandidates.length,
    });
  }

  const { chosen, ambiguous } = selectMostRecent(clean);
  if (ambiguous) {
    return refusedDisposition({
      bundle_verdict: "CLEAN", bundle_identity: null, run_id: runId || "",
      boundary_kind: "issue-merge-floor",
      reason: `two equally-recent CLEAN bundles for ${issue} — refusing to guess`,
      candidates_considered: rawCandidates.length,
    });
  }

  const identity = chosen.identity;
  const memberBytes = fetchCleanMemberBytes(resolvedStore, identity, ["ledger_snapshot", "anchors"]);

  const realRunDir = path.join(resolvedRoot, ".faff", "runs", identity.run_id);
  const realLedgerPath = path.join(realRunDir, "run-ledger.json");
  const existingLedgerBytes = fs.existsSync(realLedgerPath) ? fs.readFileSync(realLedgerPath) : null;
  const decision = idempotencyDecision(existingLedgerBytes, memberBytes.ledger_snapshot);

  if (decision === "conflict") {
    return refusedDisposition({
      bundle_verdict: "CLEAN", bundle_identity: identity, run_id: identity.run_id, boundary_kind: identity.boundary_kind,
      reason: `a different run-ledger.json already exists at ${realRunDir} (write-once — never overwritten)`,
      candidates_considered: rawCandidates.length,
    });
  }

  if (decision === "match") {
    const preview = previewResume(realRunDir, resolvedRoot, identity.boundary_key);
    return {
      verb: "bundle-recover", disposition: "noop-already-present", bundle_verdict: "CLEAN", bundle_identity: identity,
      run_id: identity.run_id, run_dir: realRunDir, boundary_kind: identity.boundary_kind,
      reason: "the reconstructed run directory already exists with a byte-identical ledger — nothing to do",
      resume_preview: preview.plan, candidates_considered: rawCandidates.length,
    };
  }

  // decision === "absent"
  if (dryRun) {
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-dry-"));
    try {
      let scratchRunDir;
      try {
        ({ runDir: scratchRunDir } = reconstructProjection(scratchRoot, identity, memberBytes));
      } catch (e) {
        // Same "refuse rather than half-write" posture as the real path below — the scratch
        // dir is discarded either way (the finally), so there is nothing to clean up on disk;
        // the failure still needs to surface as a founded refusal, not an uncaught throw.
        return refusedDisposition({
          bundle_verdict: "CLEAN", bundle_identity: identity, run_id: identity.run_id, boundary_kind: identity.boundary_kind,
          reason: `reconstruction failed: ${e.message}`,
          candidates_considered: rawCandidates.length,
        });
      }
      const preview = previewResume(scratchRunDir, scratchRoot, identity.boundary_key);
      return {
        verb: "bundle-recover", disposition: "reconstructed", bundle_verdict: "CLEAN", bundle_identity: identity,
        run_id: identity.run_id, run_dir: realRunDir, boundary_kind: identity.boundary_kind,
        reason: "dry-run — would reconstruct and preview the resume plan; the real root was left untouched",
        resume_preview: preview.plan, candidates_considered: rawCandidates.length, dry_run: true,
      };
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  }

  let projected;
  try {
    projected = reconstructProjection(resolvedRoot, identity, memberBytes);
  } catch (e) {
    // Refuse rather than leave a half-written directory (spec §4 edge cases).
    try { fs.rmSync(realRunDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    try { fs.rmSync(path.join(resolvedRoot, ".faff", "anchors", identity.run_id, identity.boundary_key), { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    return refusedDisposition({
      bundle_verdict: "CLEAN", bundle_identity: identity, run_id: identity.run_id, boundary_kind: identity.boundary_kind,
      reason: `reconstruction failed: ${e.message}`,
      candidates_considered: rawCandidates.length,
    });
  }
  const preview = previewResume(projected.runDir, resolvedRoot, identity.boundary_key);
  return {
    verb: "bundle-recover", disposition: "reconstructed", bundle_verdict: "CLEAN", bundle_identity: identity,
    run_id: identity.run_id, run_dir: projected.runDir, boundary_kind: identity.boundary_kind,
    reason: "reconstructed from a CLEAN Phase 0 recovery bundle",
    resume_preview: preview.plan, candidates_considered: rawCandidates.length,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const BUNDLE_RECOVER_SPEC = {
  flags: {
    "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--dry-run": { arity: 0 },
    "--issue": { arity: 1 }, "--run-id": { arity: 1 }, "--root": { arity: 1 },
  },
};
const USAGE = "usage: faff bundle-recover --issue ISSUE-ID [--run-id ID] [--root DIR] [--dry-run] [--json] [--selftest]";

function bundleRecoverExitCode(disposition) {
  return (disposition === "reconstructed" || disposition === "noop-already-present") ? 0 : 1;
}

function emit(contractData, asJson) {
  if (asJson) { console.log(JSON.stringify(contractData)); return; }
  const lines = [`bundle-recover: ${contractData.disposition}${contractData.dry_run ? " (dry-run)" : ""} — ${contractData.reason}`];
  if (contractData.bundle_identity) {
    const id = contractData.bundle_identity;
    lines.push(`  identity: ${id.run_id}/seg-${id.run_segment_id}/${id.boundary_key} (${contractData.bundle_verdict})`);
  } else {
    lines.push(`  bundle_verdict: ${contractData.bundle_verdict}`);
  }
  if (contractData.run_dir) lines.push(`  run_dir: ${contractData.run_dir}`);
  if (contractData.resume_preview) {
    const p = contractData.resume_preview;
    lines.push(`  resume preview — skip:${p.skip.length} continue_review:${p.continue_review.length} continue_from_push:${p.continue_from_push.length} redispatch:${p.redispatch.length} park:${p.park.length} terminal:${(p.terminal || []).length}`);
  }
  console.log(lines.join("\n"));
}

function cmdBundleRecover(args) {
  if (args.includes("--selftest")) return bundleRecoverSelftest();
  const { values, errors } = parseArgs(args, BUNDLE_RECOVER_SPEC);
  if (errors.length) return usageError(errors, USAGE);
  const issue = values["--issue"] || null;
  if (!issue) { process.stderr.write(`faff bundle-recover: --issue is required\n${USAGE}\n`); return 2; }
  if (!isValidIssueId(issue)) { process.stderr.write(`faff bundle-recover: --issue ${JSON.stringify(issue)} is not a valid issue id\n`); return 2; }
  const runId = values["--run-id"] || null;
  const root = values["--root"] || findRoot();
  const dryRun = !!values["--dry-run"];
  const asJson = !!values["--json"];

  let raw;
  try {
    raw = bundleRecover({ issue, runId, root, dryRun });
  } catch (e) {
    process.stderr.write(`faff bundle-recover: ${e.message}\n`);
    return 2;
  }

  const { contractData, failLoud } = computeRecoveryDispositionVerdict(raw);
  if (failLoud || !contractData) {
    process.stderr.write(`faff bundle-recover: internal — emitted disposition non-conformant: ${failLoud || "no contract data"}\n`);
    return 2;
  }
  if (!contractData.conformant) {
    process.stderr.write(`faff bundle-recover: internal — emitted disposition failed its own contract: ${contractData.violations.join("; ")}\n`);
    return 2;
  }

  emit(contractData, asJson);
  return bundleRecoverExitCode(contractData.disposition);
}

// ---------------------------------------------------------------------------
// In-memory + scratch-fs selftest — the pure cores + a full local-store discover/verify/
// reconstruct/preview round trip (git-remote coverage lives in test/bundle-recover.test.mjs,
// which also carries the killed-executor fixture and the no-gh-call oracle per the spec DoD).
// ---------------------------------------------------------------------------
function bundleRecoverSelftest() {
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // --- selectMostRecent: ordering, tiebreak, ambiguity ---
  const idA = { run_id: "run-20260101-000000-a", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const idB = { run_id: "run-20260102-000000-b", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const pickLatestTs = selectMostRecent([
    { identity: idA, ts: "2026-01-01T00:00:00.000Z" },
    { identity: idB, ts: "2026-01-02T00:00:00.000Z" },
  ]);
  ok(!pickLatestTs.ambiguous && pickLatestTs.chosen.identity.run_id === idB.run_id, "selectMostRecent: later last_safe_boundary.ts wins");

  const pickByRunIdPrefix = selectMostRecent([
    { identity: idA, ts: "2026-01-05T00:00:00.000Z" },
    { identity: idB, ts: "2026-01-05T00:00:00.000Z" },
  ]);
  ok(!pickByRunIdPrefix.ambiguous && pickByRunIdPrefix.chosen.identity.run_id === idB.run_id, "selectMostRecent: exact ts tie breaks on the run_id sortable prefix");

  const idC = { run_id: "run-20260102-000000-c", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 };
  const ambiguous = selectMostRecent([
    { identity: idB, ts: "2026-01-05T00:00:00.000Z" },
    { identity: idC, ts: "2026-01-05T00:00:00.000Z" },
  ]);
  ok(ambiguous.ambiguous === true && ambiguous.chosen === null, "selectMostRecent: an indistinguishable tie (same ts, same run_id prefix) refuses ambiguous");

  ok(selectMostRecent([]).ambiguous === false && selectMostRecent([]).chosen === null, "selectMostRecent: no candidates -> not ambiguous, nothing chosen");

  // --- idempotencyDecision ---
  ok(idempotencyDecision(null, Buffer.from("x")) === "absent", "idempotencyDecision: nothing existing -> absent");
  ok(idempotencyDecision(Buffer.from("x"), Buffer.from("x")) === "match", "idempotencyDecision: byte-identical -> match");
  ok(idempotencyDecision(Buffer.from("x"), Buffer.from("y")) === "conflict", "idempotencyDecision: diverging bytes -> conflict");

  // --- foldEscapesIntoPlan: escape moves an issue out of every dispatch bucket into park ---
  const basePlan = { skip: ["A"], continue_review: [], continue_from_push: ["B"], redispatch: ["C"], park: [], terminal: [], drain_remainder: true };
  const folded = foldEscapesIntoPlan(basePlan, [{ issue: "B", step: "build", escaped: [{ kind: "git-push", target: "origin/x" }] }]);
  ok(!folded.continue_from_push.includes("B") && folded.park.some((p) => p.issue === "B" && p.divergence.class === "escaped-side-effect"), "foldEscapesIntoPlan: an escaped issue is pulled out of continue_from_push and parked");
  ok(folded.skip.includes("A") && folded.redispatch.includes("C"), "foldEscapesIntoPlan: unaffected issues are untouched");
  const foldedNoDup = foldEscapesIntoPlan({ ...basePlan, park: [{ issue: "B", divergence: { class: "phantom-merge", issue: "B", detail: "x" } }] }, [{ issue: "B", step: "build", escaped: [{ kind: "git-push", target: "x" }] }]);
  ok(foldedNoDup.park.length === 1 && foldedNoDup.park[0].divergence.class === "phantom-merge", "foldEscapesIntoPlan: an already-parked issue is never duplicated/overwritten");

  // --- refusedDisposition shape ---
  const refused = refusedDisposition({ bundle_verdict: "MISSING", bundle_identity: null, run_id: "", boundary_kind: "issue-merge-floor", reason: "x", candidates_considered: 0 });
  ok(refused.disposition === "refused" && refused.run_dir === null && refused.resume_preview === null, "refusedDisposition: run_dir/resume_preview are always null on a refusal");

  // --- full local-store round trip: publish (via bundle.js), discover, verify, select,
  // reconstruct, preview — a fresh root with no prior .faff/runs/<run-id>/ ---
  const { publishBundle, localBundleStore } = require("./bundle");
  const { mintIssueAnchor } = require("./events");

  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-src-"));
  const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-fresh-"));
  try {
    const run_id = "run-20260101-090000-fx";
    const runDir = path.join(srcRoot, ".faff", "runs", run_id);
    fs.mkdirSync(runDir, { recursive: true });
    const ledger = { run_id, admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "running", last_heartbeat: "2020-01-01T00:00:00.000Z" } };
    fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger));
    fs.writeFileSync(path.join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${run_id}","seq":0,"ts":"2026-01-01T09:00:00.000Z","phase":"run","type":"run-start"}\n`);
    fs.mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "FAFF-1", "ac-checklist.json"), '{"all_verified":true}');
    // FAFF-2 is admitted but never anchored — the killed-executor shape (proven end-to-end
    // in test/bundle-recover.test.mjs; this selftest asserts the same redispatch-not-skip outcome).

    const anchorDest = path.join(srcRoot, ".faff", "anchors", run_id, "FAFF-1");
    const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDest);
    ok(mint.ok, "selftest fixture: anchor minted cleanly");

    // Bundles are published to a LOCAL store under srcRoot but DISCOVERED/VERIFIED against
    // freshRoot's own local store dir — copy the bundle tree across, mirroring how a
    // git-remote publish/fetch pair moves bytes between two otherwise-unrelated roots.
    const store = localBundleStore(srcRoot);
    const pub = publishBundle(runDir, "issue-merge-floor", "FAFF-1", { root: srcRoot, store, boundarySeq: 0 });
    ok(pub.ok === true, "selftest fixture: bundle published to the local store");
    fs.mkdirSync(path.join(freshRoot, ".faff", "bundles"), { recursive: true });
    fs.cpSync(path.join(srcRoot, ".faff", "bundles"), path.join(freshRoot, ".faff", "bundles"), { recursive: true });

    // --- discover_by_issue: local scan finds the published boundary ---
    const discovered = discoverLocalCandidates(freshRoot, "FAFF-1");
    ok(discovered.length === 1 && discovered[0].run_id === run_id, "discoverLocalCandidates: finds the published boundary under a fresh root");

    // --- reconstructed happy path: no prior .faff/runs/<run-id>/ on freshRoot ---
    ok(!fs.existsSync(path.join(freshRoot, ".faff", "runs", run_id)), "selftest fixture: freshRoot has no prior run directory");
    const disp1 = bundleRecover({ issue: "FAFF-1", runId: null, root: freshRoot, dryRun: false, storeName: "local", store: localBundleStore(freshRoot) });
    ok(disp1.disposition === "reconstructed" && disp1.bundle_verdict === "CLEAN", `bundleRecover: reconstructs from a CLEAN local-store bundle (got ${disp1.disposition}/${disp1.bundle_verdict})`);
    ok(fs.existsSync(path.join(freshRoot, ".faff", "runs", run_id, "run-ledger.json")), "bundleRecover: run-ledger.json written verbatim");
    ok(fs.existsSync(path.join(freshRoot, ".faff", "anchors", run_id, "FAFF-1", "events.jsonl")), "bundleRecover: anchor directory reconstructed");
    ok(fs.existsSync(path.join(freshRoot, ".faff", "runs", run_id, "events.jsonl")), "bundleRecover: events.jsonl copied to the run directory");
    ok(disp1.resume_preview && disp1.resume_preview.park.some((p) => p.issue === "FAFF-1") && !disp1.resume_preview.skip.includes("FAFF-1"), "bundleRecover: a shipped issue with no bundle-carried merge-record.json parks (unproven-merge), never skips");
    ok(disp1.resume_preview && disp1.resume_preview.redispatch.includes("FAFF-2"), "bundleRecover: the un-anchored in-flight issue redispatches, never skip/continue");
    ok(!disp1.resume_preview.skip.includes("FAFF-2") && !disp1.resume_preview.continue_review.includes("FAFF-2") && !disp1.resume_preview.continue_from_push.includes("FAFF-2"), "bundleRecover: FAFF-2 never appears in skip/continue_review/continue_from_push");

    // --- noop-already-present: a second recovery over the same target is idempotent ---
    const disp2 = bundleRecover({ issue: "FAFF-1", runId: null, root: freshRoot, dryRun: false, storeName: "local", store: localBundleStore(freshRoot) });
    ok(disp2.disposition === "noop-already-present", `bundleRecover: a repeat recovery is idempotent (got ${disp2.disposition})`);

    // --- refused conflict: a diverging ledger already on disk is never overwritten ---
    const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-conflict-"));
    try {
      const conflictRunDir = path.join(conflictRoot, ".faff", "runs", run_id);
      fs.mkdirSync(conflictRunDir, { recursive: true });
      fs.writeFileSync(path.join(conflictRunDir, "run-ledger.json"), JSON.stringify({ ...ledger, owner: { ...ledger.owner, epoch: 999 } }));
      fs.mkdirSync(path.join(conflictRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(srcRoot, ".faff", "bundles"), path.join(conflictRoot, ".faff", "bundles"), { recursive: true });
      const dispConflict = bundleRecover({ issue: "FAFF-1", runId: null, root: conflictRoot, dryRun: false, storeName: "local", store: localBundleStore(conflictRoot) });
      ok(dispConflict.disposition === "refused" && /already exists/.test(dispConflict.reason), `bundleRecover: a diverging existing ledger refuses as a conflict (got ${dispConflict.disposition}/${dispConflict.reason})`);
      ok(JSON.parse(fs.readFileSync(path.join(conflictRunDir, "run-ledger.json"), "utf8")).owner.epoch === 999, "bundleRecover: the diverging ledger is never overwritten");
    } finally { fs.rmSync(conflictRoot, { recursive: true, force: true }); }

    // --- dry-run: writes nothing to the real root, still reports the disposition ---
    const dryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-dry-"));
    try {
      fs.mkdirSync(path.join(dryRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(srcRoot, ".faff", "bundles"), path.join(dryRoot, ".faff", "bundles"), { recursive: true });
      const dispDry = bundleRecover({ issue: "FAFF-1", runId: null, root: dryRoot, dryRun: true, storeName: "local", store: localBundleStore(dryRoot) });
      ok(dispDry.disposition === "reconstructed" && dispDry.resume_preview !== null, `bundleRecover --dry-run: still reports reconstructed with a preview (got ${dispDry.disposition})`);
      ok(!fs.existsSync(path.join(dryRoot, ".faff", "runs", run_id)), "bundleRecover --dry-run: the real root's run directory is never created");
    } finally { fs.rmSync(dryRoot, { recursive: true, force: true }); }

    // --- refused on every non-CLEAN verdict (synthetic candidates via classifyBundle's own ladder,
    // exercised through the SAME verifyBundleIdentity seam bundleRecover calls) ---
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-missing-"));
    try {
      const dispMissing = bundleRecover({ issue: "NO-SUCH-ISSUE", runId: null, root: missingRoot, dryRun: false, storeName: "local", store: localBundleStore(missingRoot) });
      ok(dispMissing.disposition === "refused" && dispMissing.bundle_verdict === "MISSING", `bundleRecover: no bundle at all -> refused/MISSING (got ${dispMissing.disposition}/${dispMissing.bundle_verdict})`);
    } finally { fs.rmSync(missingRoot, { recursive: true, force: true }); }

    // --- refused on a TAMPERED bundle (bit-flip a member after publish, before discovery) ---
    const tamperedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-tampered-"));
    try {
      fs.mkdirSync(path.join(tamperedRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(srcRoot, ".faff", "bundles"), path.join(tamperedRoot, ".faff", "bundles"), { recursive: true });
      const memberPath = path.join(tamperedRoot, ".faff", "bundles", run_id, "seg-0", "FAFF-1", "ledger_snapshot.bin");
      const original = fs.readFileSync(memberPath);
      fs.writeFileSync(memberPath, Buffer.from(JSON.stringify({ ...JSON.parse(original.toString("utf8")), owner: { epoch: 999, status: "done" } })));
      const dispTampered = bundleRecover({ issue: "FAFF-1", runId: null, root: tamperedRoot, dryRun: false, storeName: "local", store: localBundleStore(tamperedRoot) });
      ok(dispTampered.disposition === "refused" && dispTampered.bundle_verdict === "TAMPERED", `bundleRecover: a tampered bundle refuses (got ${dispTampered.disposition}/${dispTampered.bundle_verdict})`);
      ok(!fs.existsSync(path.join(tamperedRoot, ".faff", "runs", run_id)), "bundleRecover: a refused disposition writes no run directory");
    } finally { fs.rmSync(tamperedRoot, { recursive: true, force: true }); }

    // --- refused STALE: a second, later per-issue boundary supersedes the first ---
    const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-stale-"));
    try {
      fs.mkdirSync(path.join(staleRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(srcRoot, ".faff", "bundles"), path.join(staleRoot, ".faff", "bundles"), { recursive: true });
      fs.mkdirSync(path.join(runDir, "FAFF-2b"), { recursive: true });
      const anchorDest2 = path.join(srcRoot, ".faff", "anchors", run_id, "FAFF-2b");
      mintIssueAnchor(runDir, "FAFF-2b", anchorDest2);
      const pub2 = publishBundle(runDir, "issue-merge-floor", "FAFF-2b", { root: srcRoot, store, boundarySeq: 1 });
      ok(pub2.ok === true, "selftest fixture: a second, later boundary published in the same segment");
      fs.rmSync(path.join(staleRoot, ".faff", "bundles"), { recursive: true, force: true });
      fs.mkdirSync(path.join(staleRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(srcRoot, ".faff", "bundles"), path.join(staleRoot, ".faff", "bundles"), { recursive: true });
      const dispStale = bundleRecover({ issue: "FAFF-1", runId: null, root: staleRoot, dryRun: false, storeName: "local", store: localBundleStore(staleRoot) });
      ok(dispStale.disposition === "refused" && dispStale.bundle_verdict === "STALE", `bundleRecover: an earlier boundary superseded by a later one refuses STALE (got ${dispStale.disposition}/${dispStale.bundle_verdict})`);
      ok(/superseded_by/.test(dispStale.reason), "bundleRecover: the STALE refusal names the superseding boundary");
    } finally { fs.rmSync(staleRoot, { recursive: true, force: true }); }

    // --- unproven-merge park: a shipped issue with NO merge-record.json (never carried by the
    // bundle) parks rather than skips, on a FRESH shipped-only fixture ---
    const shipRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-ship-"));
    const shipFreshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-ship-fresh-"));
    try {
      const shipRunId = "run-20260101-100000-sh";
      const shipRunDir = path.join(shipRoot, ".faff", "runs", shipRunId);
      fs.mkdirSync(shipRunDir, { recursive: true });
      // owner.status "running" + a stale heartbeat -> dead-running (re-enterable): this fixture
      // is specifically testing the unproven-merge park, which only fires along the reEnterable
      // branch of previewResume — a "done" owner would (correctly, post-fix-1) preview nothing
      // to resume instead, which is a different fixture (see the run-close one below).
      fs.writeFileSync(path.join(shipRunDir, "run-ledger.json"), JSON.stringify({ run_id: shipRunId, admitted: ["FAFF-9"], outcomes: { "FAFF-9": "shipped" }, owner: { epoch: 0, status: "running", last_heartbeat: "2020-01-01T00:00:00.000Z" } }));
      fs.writeFileSync(path.join(shipRunDir, "events.jsonl"), `{"schema":1,"run_id":"${shipRunId}","seq":0,"ts":"2026-01-01T10:00:00.000Z","phase":"run","type":"run-start"}\n`);
      // Deliberately NO merge-record.json under shipRunDir/FAFF-9/ — the bundle never carries one.
      const shipAnchorDest = path.join(shipRoot, ".faff", "anchors", shipRunId, "FAFF-9");
      mintIssueAnchor(shipRunDir, "FAFF-9", shipAnchorDest);
      const shipStore = localBundleStore(shipRoot);
      const shipPub = publishBundle(shipRunDir, "issue-merge-floor", "FAFF-9", { root: shipRoot, store: shipStore, boundarySeq: 0 });
      ok(shipPub.ok === true, "selftest fixture: shipped-issue bundle published");
      fs.mkdirSync(path.join(shipFreshRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(shipRoot, ".faff", "bundles"), path.join(shipFreshRoot, ".faff", "bundles"), { recursive: true });
      const dispShip = bundleRecover({ issue: "FAFF-9", runId: null, root: shipFreshRoot, dryRun: false, storeName: "local", store: localBundleStore(shipFreshRoot) });
      ok(dispShip.disposition === "reconstructed", `bundleRecover: shipped-issue bundle reconstructs (got ${dispShip.disposition})`);
      ok(dispShip.resume_preview && dispShip.resume_preview.park.some((p) => p.issue === "FAFF-9"), "bundleRecover: an unprovable-merge shipped issue parks, never skips");
      ok(dispShip.resume_preview && !dispShip.resume_preview.skip.includes("FAFF-9"), "bundleRecover: FAFF-9 never appears in skip without merge proof");
    } finally {
      fs.rmSync(shipRoot, { recursive: true, force: true });
      fs.rmSync(shipFreshRoot, { recursive: true, force: true });
    }

    // --- run-close reached via --run-id: publish a run-close boundary, then recover with
    // --run-id set — even though the per-issue boundary for FAFF-1 is now STALE (superseded
    // by run-close), the direct run-close probe finds a CLEAN candidate and reconstructs it ---
    const closeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-close-"));
    const closeFreshRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-close-fresh-"));
    try {
      const closeRunId = "run-20260101-110000-cl";
      const closeRunDir = path.join(closeRoot, ".faff", "runs", closeRunId);
      fs.mkdirSync(closeRunDir, { recursive: true });
      fs.writeFileSync(path.join(closeRunDir, "run-ledger.json"), JSON.stringify({ run_id: closeRunId, admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } }));
      fs.writeFileSync(path.join(closeRunDir, "events.jsonl"), `{"schema":1,"run_id":"${closeRunId}","seq":0,"ts":"2026-01-01T11:00:00.000Z","phase":"run","type":"run-start"}\n`);
      const closeStore = localBundleStore(closeRoot);
      const closeAnchorDest = path.join(closeRoot, ".faff", "anchors", closeRunId, "FAFF-1");
      mintIssueAnchor(closeRunDir, "FAFF-1", closeAnchorDest);
      publishBundle(closeRunDir, "issue-merge-floor", "FAFF-1", { root: closeRoot, store: closeStore, boundarySeq: 0 });
      const closeAnchorDest2 = path.join(closeRoot, ".faff", "anchors", closeRunId, "run-close");
      mintIssueAnchor(closeRunDir, "run-close", closeAnchorDest2);
      const closePub = publishBundle(closeRunDir, "run-close", "run-close", { root: closeRoot, store: closeStore, boundarySeq: 1 });
      ok(closePub.ok === true, "selftest fixture: run-close bundle published");
      fs.mkdirSync(path.join(closeFreshRoot, ".faff", "bundles"), { recursive: true });
      fs.cpSync(path.join(closeRoot, ".faff", "bundles"), path.join(closeFreshRoot, ".faff", "bundles"), { recursive: true });
      const dispClose = bundleRecover({ issue: "FAFF-1", runId: closeRunId, root: closeFreshRoot, dryRun: false, storeName: "local", store: localBundleStore(closeFreshRoot) });
      ok(dispClose.disposition === "reconstructed" && dispClose.boundary_kind === "run-close", `bundleRecover: --run-id reaches the run-close boundary (got ${dispClose.disposition}/${dispClose.boundary_kind})`);
      const closeRp = dispClose.resume_preview;
      const closeRpEmpty = !!closeRp && closeRp.skip.length === 0 && closeRp.continue_review.length === 0
        && closeRp.continue_from_push.length === 0 && closeRp.redispatch.length === 0
        && closeRp.park.length === 0 && closeRp.terminal.length === 0 && closeRp.drain_remainder === false;
      ok(closeRpEmpty, `bundleRecover: a run-close (done-clean) reconstruction previews nothing to resume — every bucket empty (got ${JSON.stringify(closeRp)})`);
    } finally {
      fs.rmSync(closeRoot, { recursive: true, force: true });
      fs.rmSync(closeFreshRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(srcRoot, { recursive: true, force: true });
    fs.rmSync(freshRoot, { recursive: true, force: true });
  }

  // --- reconstructProjection: a path-containment guard on the anchors member (defence in
  // depth — a CLEAN verdict proves byte fidelity against the bundle's own recorded digest,
  // never rel-path safety; a malicious/malformed anchors map must never escape anchorDir) ---
  const escapeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-escape-"));
  try {
    const evilFiles = {
      "events.jsonl": Buffer.from("").toString("base64"),
      "../../escape.txt": Buffer.from("pwned").toString("base64"),
    };
    const evilAnchorsBytes = Buffer.from(JSON.stringify({ dir: "x", files: evilFiles }), "utf8");
    const evilMemberBytes = {
      ledger_snapshot: Buffer.from(JSON.stringify({ run_id: "run-escape", admitted: [], outcomes: {}, owner: { epoch: 0, status: "done" } })),
      anchors: evilAnchorsBytes,
    };
    let threw = null;
    try {
      reconstructProjection(escapeRoot, { run_id: "run-escape", boundary_key: "FAFF-1" }, evilMemberBytes);
    } catch (e) { threw = e; }
    ok(threw !== null && /unsafe path/.test(threw.message), `reconstructProjection: a '..'-escaping anchors rel path refuses (got ${threw && threw.message})`);
    ok(!fs.existsSync(path.join(escapeRoot, ".faff")), "reconstructProjection: the escape refusal happens before any write — nothing lands under the target root at all");
    ok(!fs.existsSync(path.join(os.tmpdir(), "escape.txt")), "reconstructProjection: the '..'-escaping file was never written anywhere");
  } finally { fs.rmSync(escapeRoot, { recursive: true, force: true }); }

  const escapeAbsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-bundle-recover-escape-abs-"));
  try {
    const evilAbsFiles = { "events.jsonl": Buffer.from("").toString("base64"), "/etc/escape.txt": Buffer.from("pwned").toString("base64") };
    const evilAbsAnchorsBytes = Buffer.from(JSON.stringify({ dir: "x", files: evilAbsFiles }), "utf8");
    const evilAbsMemberBytes = {
      ledger_snapshot: Buffer.from(JSON.stringify({ run_id: "run-escape-abs", admitted: [], outcomes: {}, owner: { epoch: 0, status: "done" } })),
      anchors: evilAbsAnchorsBytes,
    };
    let threwAbs = null;
    try {
      reconstructProjection(escapeAbsRoot, { run_id: "run-escape-abs", boundary_key: "FAFF-1" }, evilAbsMemberBytes);
    } catch (e) { threwAbs = e; }
    ok(threwAbs !== null && /unsafe path/.test(threwAbs.message), `reconstructProjection: an absolute anchors rel path refuses (got ${threwAbs && threwAbs.message})`);
  } finally { fs.rmSync(escapeAbsRoot, { recursive: true, force: true }); }

  // --- contract round trip: computeRecoveryDispositionVerdict coercion ---
  const { contractData: coerced } = computeRecoveryDispositionVerdict({
    disposition: "MAYBE", bundle_verdict: "CLEAN", bundle_identity: null, run_id: "r", run_dir: null,
    boundary_kind: "issue-merge-floor", reason: "x", resume_preview: null, candidates_considered: 0,
  });
  ok(coerced.disposition === "refused", "computeRecoveryDispositionVerdict: an out-of-enum disposition coerces to refused, never reconstructed");
  const { contractData: badPair } = computeRecoveryDispositionVerdict({
    disposition: "reconstructed", bundle_verdict: "STALE", bundle_identity: null, run_id: "r", run_dir: "/x",
    boundary_kind: "issue-merge-floor", reason: "x", resume_preview: { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true },
    candidates_considered: 1,
  });
  ok(badPair.conformant === false, "computeRecoveryDispositionVerdict: a non-CLEAN verdict paired with reconstructed is flagged non-conformant");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  selectMostRecent, runIdSortPrefix, idempotencyDecision, foldEscapesIntoPlan, refusedDisposition,
  discoverLocalCandidates, discoverLocalRunCloseCandidate, discoverGitRemoteCandidates, discoverGitRemoteRunCloseCandidate,
  discoverCandidates, fetchCleanMemberBytes, isSafeAnchorRelPath, emptyResumePlan, reconstructProjection, previewResume, bundleRecover,
  cmdBundleRecover, bundleRecoverExitCode, bundleRecoverSelftest,
};
