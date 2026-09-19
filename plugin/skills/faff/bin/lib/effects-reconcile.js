// ===========================================================================
// === region:governance — effects-reconcile — FAFF-1028: off-ledger landed-merge DETECTION. ===
//
// `faff effects check` (effects.js) is a pure COMPARISON detector: it groups the
// declared-effects ledger by (issue, step) and flags an effect OBSERVED into the ledger but not
// declared. It cannot see an effect that never touched the ledger at all — and an empty/missing
// ledger reads as CLEAN (effects.js:~624/~731, correct for the pure core). Two facts compose
// into a fail-open: a protected merge performed entirely off the governed path (no declare, no
// observe) produces no ledger entry, no comparison group, and no escape signal — "no effects
// were governed" reads identically to "no effects happened."
//
// This module is the impure OBSERVATION-side backstop: it reads this run's landed merges
// directly from GIT ground truth (the protected branch's first-parent history over
// `base_sha..head`, recorded at run mint — see run-ledger.js/lights-out.js) and diffs them
// against this run's declared/observed merge effects. A landing with no covering declaration is
// surfaced as `uncovered`, `any_escape:true` — including an UNATTRIBUTABLE landing (no derivable
// issue key), which is the incident's own shape and is NEVER dropped (fail-safe).
//
// DETECTION ONLY, never prevention (an accepted, documented limit — see DESCRIBE_TEXT below and
// the honesty-condition docs this ticket's DONE criteria require): the declared-effects ledger
// this reconcile judges against is writable by the same actor authorised to merge, so an actor
// who declares one thing and merges another is not caught. Structural mediation (FAFF-1034's
// E-B target) is the only real closure of that trust gap, and is explicitly OUT OF SCOPE here.
//
// The pure `computeEscapes` core (effects.js) is UNTOUCHED — this is a distinct verb
// (`faff effects reconcile-merges`) in a distinct module, so the pure/impure boundary is visible
// at the command name (spec §3 "CLI surface" decision).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { spawnSync } = require("node:child_process");
const { findRoot, resolveRunDir } = require("./shared-infra");
const { verifyEffectsChain } = require("./events");

// The post-feature mint marker's key. This module lives in the `governance` region (the
// escape-detection family alongside effects.js/events.js/sentry.js) and `faff regions check`
// enforces a hard require-graph direction invariant — a governance file must never `require()` a
// factory file (ADR-0042) — with NO suppression mechanism by design ("an escape hatch on a
// boundary lint is the boundary leaking"). run-ledger.js (the mint SITE that stamps this key) and
// merge-gate.js (below) both live in the `factory` region, so this literal — and the two tiny git
// primitives below — are INTENTIONALLY duplicated rather than imported, mirroring audit.js's own
// documented precedent for the identical boundary. Keep this string byte-identical to
// run-ledger.js's own `MINT_MARKER_KEY` constant.
const MINT_MARKER_KEY = "base_sha_required";

// FAFF-628 declared grammar fragment: reconcile-merges takes the SAME --run XOR --run-dir shape
// as declare/observe/check (effects.js EFFECTS_SPEC already declares --run/--run-dir/--issue/
// --json as accepted flags on the shared `effects` verb; this module adds no new flag name).
const EFFECTS_RECONCILE_SUBCOMMAND = { "reconcile-merges": { required_flags: [] } };

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A generic, UNBOUNDED tracker-issue-id shape ("FAFF-1028", "ABC-123", …) — a short alpha prefix, a
// hyphen, digits. Deliberately loose: plenty of ordinary technical tokens match it too ("utf-8",
// "iso-8601", "v2-1"), so it is a FALLBACK ONLY (see attributeCommit) — used verbatim would risk the
// exact failure the spec's own Failure-modes section warns against ("prefer under-attribution
// surfaced as a fault/uncovered over cross-run false positives"): a commit merely mentioning
// "utf-8" could wrongly extract as a fake issue id, get excluded as "some other run's business",
// and a genuinely off-ledger landing would silently vanish from the report instead of surfacing.
const GENERIC_ISSUE_RE = /\b[A-Za-z][A-Za-z0-9]{1,9}-\d+\b/;

// Derive the acceptable tracker-prefix family from this run's OWN admitted issue ids (e.g.
// ["FAFF-500"] -> {"FAFF"}). Scoping extraction to this family is what closes the false-positive
// gap above: a same-tracker CONCURRENT run's issue ("FAFF-999") still extracts and correctly
// excludes, while an unrelated technical token ("utf-8") never matches at all, because its
// "prefix" ("UTF") is not a family this run has ever seen itself use. PURE.
function issuePrefixes(admittedIssues) {
  const set = new Set();
  for (const id of admittedIssues || []) {
    if (typeof id !== "string") continue;
    const m = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(id);
    if (m) set.add(m[1].toUpperCase());
  }
  return set;
}

// Attribute a commit subject to an issue key via a case-insensitive WHOLE-WORD match. Covers both
// faff's own conventional commit subjects ("feat(FAFF-1028): …") and a GitHub merge-commit subject
// naming the source branch ("Merge pull request #7 from org/faff-1028-effects-…") — faff's
// branch-naming convention embeds the issue id as a substring immediately followed by a
// non-word character ("-"), which IS a \b boundary, so one regex covers both shapes.
//
// Prefers a PREFIX-FAMILY-SCOPED match (derived from `admittedIssues`, via issuePrefixes) over the
// unbounded GENERIC_ISSUE_RE fallback: with a non-empty admitted set, only a key sharing one of
// THIS run's own tracker prefixes can extract at all — a same-family concurrent-run issue
// ("FAFF-999" when this run admits "FAFF-500") still extracts correctly (spec §5 "two runs sharing
// the protected branch"), while an ordinary technical token never does. The unbounded fallback
// fires only when there is no admitted-issue signal to derive a family from at all (e.g. a
// self-test calling this in isolation) — the same permissive, riskier shape the false-positive
// note above warns about, but with nothing safer available. PURE. Returns the extracted key
// UPPERCASED (normalising "faff-1028" and "FAFF-1028" to one canonical form) or null on no match —
// the incident's own shape.
function attributeCommit(subject, admittedIssues) {
  if (!subject) return null;
  const prefixes = issuePrefixes(admittedIssues);
  const re = prefixes.size > 0
    ? new RegExp(`\\b(${[...prefixes].map(escapeRegex).join("|")})-\\d+\\b`, "i")
    : GENERIC_ISSUE_RE;
  const m = re.exec(subject);
  return m ? m[0].toUpperCase() : null;
}

// Extract a PR number from a commit subject shaped like GitHub's two standard merge styles — a
// 2-parent "Merge pull request #<N> from …" commit, or a squash commit whose subject GitHub
// appends "(#<N>)" to. PURE, local, free — no network call (this slice performs no live forge
// query at all; see `forge_enriched` below and DESCRIBE_TEXT). Returns null on no match.
function extractPrNumberFromSubject(subject) {
  if (!subject) return null;
  let m = /^Merge pull request #(\d+)\b/.exec(subject);
  if (m) return Number(m[1]);
  m = /\(#(\d+)\)\s*$/.exec(subject);
  if (m) return Number(m[1]);
  return null;
}

// `detail` sanitisation (untrusted input, bounded — spec §3): a PR title / commit subject is
// attacker-influenceable (public-repo PRs) and flows into logs/Sentry, so it is DATA, never
// instructions — collapse newlines/control characters to spaces and truncate to a fixed 200-BYTE
// bound, UTF-8-safe (never split a multibyte codepoint). PURE.
function sanitizeDetail(raw) {
  const collapsed = String(raw == null ? "" : raw).replace(/[\r\n\t\x00-\x1f\x7f]+/g, " ").trim();
  const buf = Buffer.from(collapsed, "utf8");
  if (buf.length <= 200) return collapsed;
  let end = 200;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // back off out of a multibyte continuation
  return buf.slice(0, end).toString("utf8");
}

// Partition an ORDERED (oldest-first) list of {sha, subject} first-parent commits into
// branch-advancement SEGMENTS by contiguous GENERIC attribution: a maximal run of commits
// extracting the same issue key (or, symmetrically, a maximal run of mutually-key-less commits)
// forms ONE segment (spec §3 "the landing UNIT is a segment, not a single commit"). This is the
// fallback grouping the spec's Assumption 5 sanctions when a governed landing's merge-record.json
// carries no explicit base bound — in the common case (every commit in a governed multi-commit
// rebase/ff-only landing mentions its own issue id, per repo convention) it already coalesces the
// landing into one segment, which is what the coverage rule (attribution match) needs. Extraction
// is scoped to THIS run's own tracker-prefix family (via attributeCommit/issuePrefixes) — precise
// enough to reject ordinary technical tokens ("utf-8") while still recognising a same-family
// CONCURRENT run's issue id, which the caller (spec §6 "Attribution scope") then excludes rather
// than mis-reading it as unattributable. PURE.
function partitionSegments(commits, admittedIssues) {
  const segments = [];
  let cur = null;
  for (const c of commits) {
    const issue = attributeCommit(c.subject, admittedIssues);
    if (cur && cur.issue === issue) cur.commits.push(c);
    else { cur = { issue, commits: [c] }; segments.push(cur); }
  }
  return segments.map((s) => ({ issue: s.issue, commits: s.commits, tip: s.commits[s.commits.length - 1] }));
}

// Coverage predicate for ONE segment (spec §3 "Coverage rule", §6 "Coverage cross-match") — PURE
// given its inputs (the `effectTargetMatches` require is lazy to avoid an effects.js<->this
// load-time require cycle: effects.js requires this module to dispatch `reconcile-merges`, so
// this module must never require effects.js at ITS OWN top level).
//   (a) attribution match — the segment's issue has a declared/observed merge effect at all
//       (whatever its own target) — a governed multi-commit landing is ONE segment covered by
//       its ONE declared pr:<N>, whatever its internal commit count.
//   (b) target match — `effectTargetMatches` against any of this segment's candidate target
//       strings, cross-matching pr:<N> <-> commit:<sha> (the caller pre-computes BOTH candidate
//       strings into `candidateTargets` when an equivalence resolved).
function segmentCovered(segment, admittedIssues, declaredMerge, candidateTargets) {
  const { effectTargetMatches } = require("./effects"); // lazy — breaks the require cycle noted above
  if (segment.issue && admittedIssues.includes(segment.issue) && declaredMerge.some((d) => d.issue === segment.issue)) {
    return true;
  }
  return declaredMerge.some((d) => [...candidateTargets].some((t) => effectTargetMatches(d.target, t)));
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// --- Region-boundary duplicates of three tiny merge-gate.js (factory) primitives ---
// (see the MINT_MARKER_KEY comment above for why: `faff regions check` refuses ANY governance
// file requiring a factory one, with no suppression mechanism — a residual violation is fixed by
// moving/duplicating the code, never by silencing the lint). Each mirrors its merge-gate.js
// namesake's exact behaviour; keep them in sync if that file's logic ever changes.

// Mirrors merge-gate.js's `gitRun`.
function gitRunLocal(cwd, args, timeout = 15000) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout });
  if (r.error) return { ok: false, stdout: "", stderr: String(r.error.message || ""), status: null };
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim(), status: r.status };
}

// Mirrors merge-gate.js's `resolveLocalBase` (no `explicitBase` support — this reconcile never
// takes a `--base` override, so that branch of the original is dead code here by construction).
function resolveLocalBranchLocal(cwd) {
  for (const cand of ["main", "master"]) {
    if (gitRunLocal(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${cand}`], 5000).ok) return cand;
  }
  return null;
}

// Mirrors merge-gate.js's `mergeRecordPath`.
function mergeRecordPathLocal(runDir, issue) {
  return path.join(runDir, issue, "merge-record.json");
}

// This run's declared+observed MERGE-kind effects (declare and observe both cover — spec §5 edge
// case), scoped to `issueFilter` when given. Reads the same physical ledger `effects.js check`
// reads, never a second parallel store.
function readDeclaredMergeEffects(runDir, issueFilter) {
  const p = path.join(runDir, "declared-effects.jsonl");
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "");
  const out = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || (e.kind_of_entry !== "declare" && e.kind_of_entry !== "observe")) continue;
    if (!e.effect || e.effect.kind !== "merge") continue;
    if (issueFilter != null && e.issue !== issueFilter) continue;
    out.push({ issue: e.issue, target: e.effect.target });
  }
  return out;
}

// Scan every admitted issue's merge-record.json (written by merge-gate.js on every governed
// landing, REGARDLESS of forge uptime — merge-gate.js:~475) into a head_sha -> {issue, pr} map.
// This is the load-bearing outage-path equivalence source (spec §3/§6): the FAFF-1012 ledger
// auto-declaration records only `pr:<N>` (merge-gate.js:~719); merge-record.json is what still
// carries the landing commit's sha when `gh` is down.
function readMergeRecordsByHeadSha(runDir, admittedIssues) {
  const out = new Map();
  for (const issue of admittedIssues) {
    const rec = readJsonSafe(mergeRecordPathLocal(runDir, issue));
    if (rec && typeof rec.head_sha === "string" && rec.head_sha) {
      out.set(rec.head_sha, { issue, pr: rec.pr != null ? Number(rec.pr) : null });
    }
  }
  return out;
}

// `git log --first-parent --reverse` over base..head, OLDEST FIRST — the raw advancement set
// (spec §3/§4 "Landing predicate"): every commit on it advanced the protected branch (a 2-parent
// merge, a squash landing, or a direct-git commit); a feature-branch commit is NEVER on it
// (first-parent traversal never descends into a merged-in side branch) — excluded structurally,
// no per-commit merge-ness test, no forge query.
function readFirstParentAdvancement(root, base, head) {
  const sep = "\x1f";
  const r = gitRunLocal(root, ["log", "--first-parent", "--reverse", `--format=%H${sep}%s`, `${base}..${head}`], 20000);
  if (!r.ok) return { ok: false, error: r.stderr || "git log failed" };
  if (r.stdout === "") return { ok: true, commits: [] };
  const commits = r.stdout.split("\n").filter((l) => l !== "").map((line) => {
    const idx = line.indexOf(sep);
    return idx === -1 ? { sha: line, subject: "" } : { sha: line.slice(0, idx), subject: line.slice(idx + 1) };
  });
  return { ok: true, commits };
}

// PROCEDURE reconcile_merges (spec §4) — the impure orchestrator. Read-only: MUST NOT mutate any
// ledger, run artifact, or git state (spec §5 invariant).
function reconcileMerges({ root, runDir, issueFilter }) {
  root = root || findRoot();
  const ledger = readJsonSafe(path.join(runDir, "run-ledger.json"));
  if (!ledger || typeof ledger !== "object") {
    return { reconciled: false, uncovered: [], any_escape: false, fault: "run-ledger.json unreadable", forge_enriched: false, legacy_exempt: false };
  }

  // Step 1 — legacy exemption via the MINT-TIME marker (never inferred from base_sha presence
  // alone — that ambiguity is exactly what the field incident lacked). Not a fault.
  if (ledger[MINT_MARKER_KEY] !== true) {
    return { reconciled: true, uncovered: [], any_escape: false, fault: null, forge_enriched: false, legacy_exempt: true };
  }

  // Step 2 — the recorded base anchor is a HARD input for a post-feature run; absent is a
  // genuine, non-clean fault (the ungoverned run this ticket targets), never a silent clean.
  const base = typeof ledger.base_sha === "string" && ledger.base_sha ? ledger.base_sha : null;
  if (!base) {
    return { reconciled: false, uncovered: [], any_escape: false, fault: "no base anchor", forge_enriched: false, legacy_exempt: false };
  }

  // Step 3 — the FAFF-621 hash chain must verify. A genuinely broken/tampered/mismatched chain
  // is non-clean; a benign pre-chain legacy or partially-chained ledger is not treated as tamper.
  const chain = verifyEffectsChain(runDir, {});
  if (["broken", "witness-mismatch", "malformed"].includes(chain.status)) {
    return { reconciled: false, uncovered: [], any_escape: false, fault: `ledger chain ${chain.status}`, forge_enriched: false, legacy_exempt: false };
  }

  // Step 4 — this run's admitted issues (narrowed by --issue when given).
  const admittedAll = Array.isArray(ledger.admitted) ? ledger.admitted.filter((i) => typeof i === "string") : [];

  // Resolve the protected branch + its CURRENT local HEAD — always-on local git, never a forge
  // query (spec §6 "Primary ground truth").
  const branch = resolveLocalBranchLocal(root);
  if (!branch) {
    return { reconciled: false, uncovered: [], any_escape: false, fault: "protected branch unresolvable (no local main or master)", forge_enriched: false, legacy_exempt: false };
  }
  const headRes = gitRunLocal(root, ["rev-parse", "--verify", "--quiet", branch], 5000);
  if (!headRes.ok || !headRes.stdout) {
    return { reconciled: false, uncovered: [], any_escape: false, fault: `protected branch HEAD unresolvable (${branch})`, forge_enriched: false, legacy_exempt: false };
  }
  const head = headRes.stdout;

  // Robustness guard (adversarial review finding, code review round 1): `git log base..head` is
  // only a well-defined "what landed since base" range when `base` is actually an ancestor of
  // `head`. A STALE base_sha (the branch legitimately rebased since mint — the spec's own
  // Failure-modes entry names this exact case) makes the range span unrelated history, flooding
  // `uncovered` with false escapes instead of the clean, actionable fault the spec's whole "never
  // coerce a read fault to clean" posture calls for. This check is a defensive improvement for
  // that BENIGN staleness case ONLY — it is NOT, and cannot be, a defense against a privileged
  // actor deliberately rewriting the protected branch to erase evidence of an off-ledger merge
  // (a history-rewrite that keeps `base` reachable, e.g. dropping one commit via interactive
  // rebase, defeats an ancestor check identically to a git log range) — that remains part of the
  // accepted Limit-A trust boundary (an actor with sufficient repo access can defeat a
  // git-history-based detector; only structural mediation, out of scope, truly closes it), named
  // in the honesty docs alongside the existing ledger-writability residual.
  if (!gitRunLocal(root, ["merge-base", "--is-ancestor", base, head], 5000).ok) {
    return { reconciled: false, uncovered: [], any_escape: false, fault: "base_sha is not an ancestor of the protected branch HEAD (stale anchor or rewritten history)", forge_enriched: false, legacy_exempt: false };
  }

  // Step 5 — the raw first-parent advancement set (PRIMARY, always-on, local git).
  const fp = readFirstParentAdvancement(root, base, head);
  if (!fp.ok) {
    return { reconciled: false, uncovered: [], any_escape: false, fault: `git read failed: ${fp.error}`, forge_enriched: false, legacy_exempt: false };
  }

  // Extraction is scoped to THIS run's own tracker-prefix family (derived from the FULL admitted
  // set, never narrowed to a single --issue — the family question is "which tracker does this run
  // belong to", independent of which one issue this call happens to report on) so the
  // classification below can tell a same-family concurrent run's landing apart from a genuinely
  // key-less one, without false-extracting an ordinary technical token as a fake issue id.
  const rawSegments = partitionSegments(fp.commits, admittedAll);

  // segment_base for each segment is the previous segment's tip (or the overall base for the
  // first) — computed over the FULL ordered sequence, before any --issue/scope filtering, so it
  // stays correct regardless of which segments end up in scope for THIS call.
  let runningPrev = base;
  const segmentsWithBase = rawSegments.map((s) => {
    const segment_base = runningPrev;
    runningPrev = s.tip.sha;
    return { ...s, segment_base };
  });

  // Attribution SCOPE (spec §6): a segment whose extracted key names an issue THIS run never
  // admitted belongs to a CONCURRENT run sharing the protected branch — out of scope, silently
  // excluded (not this run's escape, and NOT surfaced as unattributable either — it IS
  // attributed, just to somebody else). Only a segment with NO extractable key at all
  // (`issue === null`) is genuinely unattributable, and that one is ALWAYS surfaced (fail-safe —
  // the incident's own shape) — including under `--issue`, per the unconditional "never dropped"
  // floor (spec §3 vocabulary / Failure-modes): a per-issue caller cannot itself tell whether a
  // key-less landing was theirs, so the safe direction is to always include it rather than let a
  // narrowing flag silently exclude the incident's own shape (adversarial review finding, code
  // review round 1). `--issue` therefore narrows to "this issue's own segments, plus every
  // genuinely-unattributable one" — a foreign-but-extracted issue is still excluded either way.
  const inScope = issueFilter != null
    ? segmentsWithBase.filter((s) => s.issue === issueFilter || s.issue === null)
    : segmentsWithBase.filter((s) => s.issue === null || admittedAll.includes(s.issue));

  const mergeRecords = readMergeRecordsByHeadSha(runDir, admittedAll);
  const declaredMerge = readDeclaredMergeEffects(runDir, issueFilter);

  const uncovered = [];
  for (const seg of inScope) {
    const subjectPr = extractPrNumberFromSubject(seg.tip.subject);
    const mrEntry = mergeRecords.get(seg.tip.sha) || null;
    const resolvedPr = subjectPr != null ? subjectPr : (mrEntry && mrEntry.pr != null ? mrEntry.pr : null);
    const candidateTargets = new Set([`commit:${seg.tip.sha}`]);
    if (resolvedPr != null) candidateTargets.add(`pr:${resolvedPr}`);

    if (!segmentCovered(seg, admittedAll, declaredMerge, candidateTargets)) {
      uncovered.push({
        target: resolvedPr != null ? `pr:${resolvedPr}` : `commit:${seg.tip.sha}`,
        commit: seg.tip.sha,
        segment_base: seg.segment_base,
        issue: seg.issue,
        detail: sanitizeDetail(seg.tip.subject),
        landed_at: null,
      });
    }
  }

  return {
    reconciled: true,
    uncovered,
    any_escape: uncovered.length > 0,
    fault: null,
    // Interim scope decision (documented, not a defect): this slice performs NO live forge
    // (`gh`) query at all — the pr:<N> equivalence resolves from the commit subject (free,
    // network-independent) or merge-record.json.head_sha (spec §6), which together already
    // satisfy "the kill-switch is never coupled to forge uptime" without depending on `gh` ever
    // succeeding. forge_enriched is therefore always false; this is informational only and never
    // sets `any_escape`/`forbidden` on its own (spec §4/§6).
    forge_enriched: false,
    legacy_exempt: false,
  };
}

// The honesty-condition text (spec §1a, DONE "From WHY") — surfaced via `--describe` and by the
// CLI's own --help/usage text, so a reader meets the limit where they meet the feature, never
// buried in a tracker thread.
const DESCRIBE_TEXT = `faff effects reconcile-merges — off-ledger landed-merge DETECTION (never prevention)

What this catches:
  - A protected-branch merge (direct-git, squash, rebase, or an ordinary PR merge) landed inside
    this run's window with no covering declare/observe entry in this run's declared-effects
    ledger -- surfaced as an uncovered landed merge, any_escape:true.
  - An in-window landing with no derivable issue key/branch -- surfaced with issue:null, never
    silently dropped (the field incident's own shape).

What this does NOT catch (accepted limits, documented -- not defects to engineer away here):
  - Limit A -- an actor who DECLARES a merge and then performs a DIFFERENT one off-ledger. The
    ledger this reconcile judges against is writable by the same authority that can merge, so a
    declare-then-diverge actor is not caught. Only structural mediation (FAFF-1034's E-B target --
    making the merge un-performable off-ledger at all) closes this trust gap; this ticket ships
    DETECTION ONLY, never prevention.
  - Limit A (integrity residual) -- base_sha, the post-feature mint marker (run-ledger.json), and
    merge-record.json.head_sha are trusted reconcile inputs OUTSIDE the FAFF-621 declared-effects
    hash chain. An actor with ledger write can strip the marker, advance the anchor, or forge a
    merge-record to spoof coverage.
  - Limit A (history-rewrite residual) -- this is a git-history-based detector: an actor with
    force-push rights to the protected branch can rewrite history to drop the off-ledger commit
    while keeping base_sha reachable (an interactive-rebase drop), which no ancestor check can
    catch. A base_sha that is NOT an ancestor of the current HEAD at all (a bulk rewrite, or a
    genuinely stale anchor) is refused as a fault (reconciled:false), but a surgical erasure that
    preserves ancestry defeats detection identically to Limit A above -- only structural mediation
    closes this too.
  - Limit A (target-match spoof surface) -- coverage's target-match branch matches a declared
    pr:<N>/commit:<sha> regardless of WHICH issue declared it, per the coverage rule (spec's own
    design, not an implementation gap). An actor need not even forge a declaration for the right
    issue -- naming a branch whose extracted PR number matches any OTHER issue's real declaration
    is enough to spoof coverage.
  - Limit B -- attribution (branch name / issue-key matching) is heuristic. An unattributable
    landing is surfaced (issue:null), never dropped, but a MIS-attributed landing is a documented
    reliability boundary, not a defect.
  - Limit B (local-ref staleness) -- the primary detector reads the LOCAL protected-branch ref,
    never fetches (by design, so it is never coupled to forge/network uptime). A merge landed
    directly on the remote by an actor who never touches this process's own checkout (e.g. a human
    merging via a forge web UI) is invisible until the next fetch.
  - Limit B (permanent fault on an unresolvable mint) -- a post-feature run whose environment could
    never resolve a local main/master at mint (e.g. a shallow/single-branch clone) carries
    base_sha:null for its entire lifetime, so EVERY checkpoint returns reconciled:false and trips
    the kill-switch, indistinguishable from a genuinely ungoverned run. This is the spec's own
    Chosen behaviour (a missing base anchor on a post-feature run is always non-clean), not an
    oversight -- but it is a real operational consequence worth knowing before deploying into such
    an environment.
  - Non-merge protected effects (deploy, secret-rotation, registry-publish, force-push,
    prod-script) -- out of scope for this slice.
`;

function readRunDirFromArgs({ root, run, runDirArg, rootExplicit }) {
  if (runDirArg !== null && run !== null) return { err: "one of --run or --run-dir, not both" };
  if (runDirArg === null && run === null) return { err: "one of --run <id> or --run-dir <dir> is required" };
  return { dir: runDirArg !== null ? runDirArg : resolveRunDir(root, run, rootExplicit) };
}

function cmdEffectsReconcileMerges(args) {
  let root = null, run = null, runDirArg = null, issue = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--run") run = args[++i];
    else if (args[i] === "--run-dir") runDirArg = args[++i];
    else if (args[i] === "--issue") issue = args[++i];
    else rest.push(args[i]);
  }
  if (rest.includes("--describe")) { console.log(DESCRIBE_TEXT); return 0; }
  if (rest.includes("--selftest")) return effectsReconcileSelftest();

  const rootExplicit = root !== null;
  root = root || findRoot();
  const resolved = readRunDirFromArgs({ root, run, runDirArg, rootExplicit });
  if (resolved.err) { process.stderr.write(`faff effects reconcile-merges: ${resolved.err}\n`); return 2; }
  const dir = resolved.dir;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    process.stderr.write(`faff effects reconcile-merges: run dir missing (${dir}) — initialise the run first\n`);
    return 3;
  }

  const result = reconcileMerges({ root, runDir: dir, issueFilter: issue });
  if (rest.includes("--json")) { console.log(JSON.stringify(result)); return 0; }
  if (result.legacy_exempt) console.log("effects reconcile-merges: legacy-exempt run (minted before this feature) — clean");
  else if (!result.reconciled) console.log(`effects reconcile-merges: NOT reconciled — ${result.fault}`);
  else if (!result.any_escape) console.log("effects reconcile-merges: no off-ledger landings — every landed merge is covered");
  else {
    console.log(`effects reconcile-merges: ${result.uncovered.length} uncovered landed merge(s) — any_escape: true`);
    for (const u of result.uncovered) console.log(`  - ${u.target} (issue: ${u.issue || "null (unattributable)"}) — ${u.detail}`);
  }
  return 0;
}

// In-memory self-test of the pure cores (mirrors effects.js's own --selftest style) plus one
// real-git integration pass in a scratch repo (mirrors the spec's own "Integration smoke test").
function effectsReconcileSelftest() {
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  let failed = 0;
  const fail = (m) => { process.stderr.write(`effects reconcile-merges --selftest FAIL: ${m}\n`); failed++; };

  // --- attributeCommit: no admitted-issue signal -> the unbounded generic-shape fallback ---
  if (attributeCommit("feat(FAFF-1028): add reconcile") !== "FAFF-1028") fail("attributeCommit: conventional subject");
  if (attributeCommit("Merge pull request #7 from org/faff-1028-effects-check") !== "FAFF-1028") fail("attributeCommit: branch-name-in-merge-subject");
  if (attributeCommit("chore: unrelated tidy") !== null) fail("attributeCommit: no match => null (unattributable)");
  if (attributeCommit("touches faff-1028 lowercase") !== "FAFF-1028") fail("attributeCommit: case-insensitive, normalised to uppercase");
  if (attributeCommit("feat(ABC-99): a different tracker prefix") !== "ABC-99") fail("attributeCommit: no admitted signal — extracts ANY issue-shaped key");
  if (attributeCommit("touches FAFF-10289 only") !== "FAFF-10289") fail("attributeCommit: extracts the FULL digit run, never a truncated prefix of a longer id");

  // --- attributeCommit: WITH an admitted-issue signal -> prefix-family-scoped (the false-positive
  // fix — a bare technical token must never masquerade as an issue id) ---
  if (attributeCommit("chore: bump to utf-8 encoding", ["FAFF-1"]) !== null) {
    fail("attributeCommit: a non-tracker technical token ('utf-8') must NOT extract as a fake issue id once an admitted family is known");
  }
  if (attributeCommit("docs: switch to iso-8601 timestamps", ["FAFF-1"]) !== null) {
    fail("attributeCommit: 'iso-8601' must not false-positive either");
  }
  if (attributeCommit("feat(FAFF-999): a concurrent run's own issue", ["FAFF-1"]) !== "FAFF-999") {
    fail("attributeCommit: a SAME-FAMILY foreign issue id still extracts (needed so the caller can recognise and exclude it)");
  }
  if (attributeCommit("feat(FAFF-1): this run's own issue", ["FAFF-1", "FAFF-2"]) !== "FAFF-1") {
    fail("attributeCommit: this run's own admitted issue still extracts under the family-scoped path");
  }

  // --- extractPrNumberFromSubject ---
  if (extractPrNumberFromSubject("Merge pull request #42 from org/branch") !== 42) fail("extractPrNumberFromSubject: merge-commit style");
  if (extractPrNumberFromSubject("feat(FAFF-1): thing (#99)") !== 99) fail("extractPrNumberFromSubject: squash style");
  if (extractPrNumberFromSubject("no pr number here") !== null) fail("extractPrNumberFromSubject: no match => null");

  // --- sanitizeDetail ---
  if (sanitizeDetail("a\nb\tc") !== "a b c") fail("sanitizeDetail: collapses control chars to spaces");
  if (sanitizeDetail("x".repeat(250)).length !== 200) fail("sanitizeDetail: truncates to 200 bytes");
  {
    const multibyte = "é".repeat(150); // each char is 2 bytes in UTF-8 — 300 bytes total
    const out = sanitizeDetail(multibyte);
    if (Buffer.from(out, "utf8").length > 200) fail("sanitizeDetail: truncation never exceeds the 200-byte bound");
    if (Buffer.byteLength(out.slice(-1), "utf8") !== Buffer.byteLength("é", "utf8")) fail("sanitizeDetail: truncation never splits a multibyte codepoint");
  }

  // --- partitionSegments ---
  {
    const commits = [
      { sha: "a1", subject: "feat(FAFF-1): step one" },
      { sha: "a2", subject: "feat(FAFF-1): step two" },
      { sha: "b1", subject: "chore: direct-git, no issue key" },
      { sha: "c1", subject: "feat(FAFF-2): other issue" },
    ];
    const segs = partitionSegments(commits);
    if (segs.length !== 3) fail(`partitionSegments: expected 3 contiguous segments, got ${segs.length}`);
    if (segs[0].issue !== "FAFF-1" || segs[0].commits.length !== 2) fail("partitionSegments: FAFF-1's two commits form one segment");
    if (segs[1].issue !== null || segs[1].tip.sha !== "b1") fail("partitionSegments: the unattributable commit forms its own issue:null segment");
    if (segs[2].issue !== "FAFF-2") fail("partitionSegments: a different issue starts a new segment");
  }

  // --- segmentCovered ---
  {
    const seg = { issue: "FAFF-1", commits: [], tip: { sha: "s1", subject: "x" } };
    if (!segmentCovered(seg, ["FAFF-1"], [{ issue: "FAFF-1", target: "pr:5" }], new Set(["commit:s1"]))) {
      fail("segmentCovered: attribution match covers regardless of the segment's own target");
    }
    const segNull = { issue: null, commits: [], tip: { sha: "s2", subject: "x" } };
    if (segmentCovered(segNull, ["FAFF-1"], [{ issue: "FAFF-1", target: "pr:5" }], new Set(["commit:s2"]))) {
      fail("segmentCovered: an unattributable segment is NOT covered by another issue's declaration");
    }
    if (!segmentCovered(segNull, ["FAFF-1"], [{ issue: null, target: "commit:s2" }], new Set(["commit:s2"]))) {
      fail("segmentCovered: target match covers an unattributable segment with a matching declaration");
    }
    if (!segmentCovered(segNull, ["FAFF-1"], [{ issue: null, target: "pr:9" }], new Set(["commit:s2", "pr:9"]))) {
      fail("segmentCovered: cross-match — a pr:<N> declaration covers a commit:<sha>-only segment via the candidate set");
    }
    if (segmentCovered(segNull, ["FAFF-1"], [{ issue: null, target: "commit:other" }], new Set(["commit:s2"]))) {
      fail("segmentCovered: no matching target and no attribution => NOT covered (fail-safe)");
    }
    if (!segmentCovered(segNull, ["FAFF-1"], [{ issue: null, target: "*" }], new Set(["commit:s2"]))) {
      fail("segmentCovered: a wildcard declaration covers");
    }
  }

  // --- real-git integration pass (mirrors the spec's own integration smoke test) ---
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-effects-reconcile-"));
    try {
      const git = (...a) => execFileSync("git", a, { cwd: tmp, encoding: "utf8" });
      git("init", "-q", "-b", "main");
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "Test");
      fs.writeFileSync(path.join(tmp, "f.txt"), "0\n");
      git("add", "-A");
      git("commit", "-q", "-m", "chore: seed");
      const base = git("rev-parse", "HEAD").trim();

      const runDir = path.join(tmp, ".faff", "runs", "run-selftest");
      fs.mkdirSync(runDir, { recursive: true });
      const ledger = { admitted: ["FAFF-500", "FAFF-501"], base_sha: base, base_sha_required: true };
      fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger));

      // Land an off-ledger, ATTRIBUTABLE commit directly on main — the "declared but never
      // merged" gap has NOTHING to compare against (empty declared-effects.jsonl), so `check`
      // alone would read clean; this reconcile must not.
      fs.writeFileSync(path.join(tmp, "f.txt"), "1\n");
      git("add", "-A");
      git("commit", "-q", "-m", "feat(FAFF-500): off-ledger direct merge");

      // Land a second, UNATTRIBUTABLE commit — the incident's own shape.
      fs.writeFileSync(path.join(tmp, "f.txt"), "2\n");
      git("add", "-A");
      git("commit", "-q", "-m", "chore: no issue key at all");

      let r = reconcileMerges({ root: tmp, runDir });
      if (r.reconciled !== true) fail("integration: reconciled true on a resolvable base + verified chain");
      if (r.any_escape !== true) fail("integration: two off-ledger landings => any_escape true");
      if (r.uncovered.length !== 2) fail(`integration: expected 2 uncovered landings, got ${r.uncovered.length}`);
      if (!r.uncovered.some((u) => u.issue === "FAFF-500")) fail("integration: the attributable landing is surfaced with its issue");
      if (!r.uncovered.some((u) => u.issue === null)) fail("integration: the unattributable landing is surfaced with issue:null, never dropped");

      // Declare the FAFF-500 merge (attribution match) — it should drop off `uncovered`, the
      // unattributable one must still surface.
      fs.appendFileSync(
        path.join(runDir, "declared-effects.jsonl"),
        JSON.stringify({ schema: 2, kind_of_entry: "declare", issue: "FAFF-500", step: "build", effect: { kind: "merge", target: "pr:1" } }) + "\n",
      );
      r = reconcileMerges({ root: tmp, runDir });
      if (r.any_escape !== true) fail("integration: the unattributable landing alone still trips any_escape");
      if (r.uncovered.length !== 1 || r.uncovered[0].issue !== null) fail("integration: declaring FAFF-500 covers it, leaving only the unattributable landing");

      // Land a CONCURRENT run's own off-ledger merge (an issue key this run never admitted) — it
      // must be attributed to that key and excluded, never mis-read as unattributable (issue:null)
      // and never surfaced as THIS run's escape (spec §5 "two runs sharing the protected branch").
      fs.writeFileSync(path.join(tmp, "f.txt"), "3\n");
      git("add", "-A");
      git("commit", "-q", "-m", "feat(FAFF-999): a different run's own off-ledger merge");
      r = reconcileMerges({ root: tmp, runDir });
      if (r.uncovered.some((u) => u.issue === "FAFF-999")) fail("integration: a concurrent run's landing must never surface under THIS run's reconcile");
      if (r.uncovered.filter((u) => u.issue === null).length !== 1) fail("integration: the concurrent run's landing is attributed to FAFF-999, NOT folded into the unattributable count");

      // A pre-feature (legacy) run — no mint marker at all — is exempt, not a fault.
      const legacyRunDir = path.join(tmp, ".faff", "runs", "run-legacy");
      fs.mkdirSync(legacyRunDir, { recursive: true });
      fs.writeFileSync(path.join(legacyRunDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"] }));
      const legacy = reconcileMerges({ root: tmp, runDir: legacyRunDir });
      if (legacy.legacy_exempt !== true || legacy.any_escape !== false || legacy.reconciled !== true) {
        fail("integration: a pre-feature ledger (no mint marker) is legacy_exempt, not a fault");
      }

      // A post-feature run with the marker but NO base_sha is a genuine, non-clean fault.
      const faultRunDir = path.join(tmp, ".faff", "runs", "run-fault");
      fs.mkdirSync(faultRunDir, { recursive: true });
      fs.writeFileSync(path.join(faultRunDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha_required: true }));
      const faulted = reconcileMerges({ root: tmp, runDir: faultRunDir });
      if (faulted.reconciled !== false || !faulted.fault || faulted.any_escape !== false) {
        fail("integration: a post-feature run with no base_sha is reconciled:false with a named fault, never any_escape:true by itself");
      }

      // An empty ledger with NO landings at all stays clean (the pure `empty ledger => clean`
      // case is unchanged; only a real off-ledger landing breaks it).
      const cleanRunDir = path.join(tmp, ".faff", "runs", "run-clean");
      fs.mkdirSync(cleanRunDir, { recursive: true });
      fs.writeFileSync(path.join(cleanRunDir, "run-ledger.json"), JSON.stringify({ admitted: [], base_sha: base, base_sha_required: true }));
      git("commit", "-q", "--allow-empty", "-m", "noop"); // advance HEAD past `base` with NOTHING attributable and NOTHING declared is still handled above; here base==head
      // Reset the scratch clean-run test to base==head (no advancement at all):
      const cleanLedger = { admitted: [], base_sha: git("rev-parse", "HEAD").trim(), base_sha_required: true };
      fs.writeFileSync(path.join(cleanRunDir, "run-ledger.json"), JSON.stringify(cleanLedger));
      const clean = reconcileMerges({ root: tmp, runDir: cleanRunDir });
      if (clean.any_escape !== false || clean.uncovered.length !== 0) fail("integration: base==head (no landings) stays clean");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  if (failed) return 1;
  console.log("effects reconcile-merges --selftest: ok");
  return 0;
}

module.exports = {
  MINT_MARKER_KEY,
  EFFECTS_RECONCILE_SUBCOMMAND,
  DESCRIBE_TEXT,
  attributeCommit,
  extractPrNumberFromSubject,
  sanitizeDetail,
  partitionSegments,
  segmentCovered,
  reconcileMerges,
  cmdEffectsReconcileMerges,
  effectsReconcileSelftest,
};
