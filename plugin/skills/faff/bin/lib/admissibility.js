// ===========================================================================
// === region:factory — admissibility — FAFF-441: spec DoD-classification + admissible / holdout / spec-review-lens engines (DoD cluster hoisted from prd; handlers rehomed out of the lint-cli-doc span) ===
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, requireFlags, usageError } = require("./argv");
const { findRoot, mainWorktreeRoot } = require("./shared-infra");
const { buildHoldoutRecord, holdoutRecordSelftest, isSafeHoldoutKey, resolveContained, writeHoldoutRecord } = require("./holdout-record");
const ADMISSIBLE_SPEC = { flags: { "--selftest": { arity: 0 }, "--lights-out": { arity: 0 }, "--json": { arity: 0 }, "--spec": { arity: 1 } }, positionals: { min: 0, max: null, name: "arg" } };
const DOD_CLASSIFY_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--spec": { arity: 1 }, "--issue": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const DOD_SPLIT_SPEC = { flags: { "--view": { arity: 1 }, "--spec": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const HOLDOUT_VERDICTS_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--require-spawner-attested": { arity: 0 }, "--association": { arity: 1 }, "--dir": { arity: 1 }, "--persist": { arity: 0 }, "--prdr-dir": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const HOLDOUT_VERDICT_SPEC = { flags: { "--json": { arity: 0 }, "--require-spawner-attested": { arity: 0 }, "--issue": { arity: 1 }, "--dir": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const HOLDOUT_RECORD_SPEC = { flags: { "--json": { arity: 0 }, "--issue": { arity: 1 }, "--spec": { arity: 1 }, "--key": { arity: 1 }, "--run-dir": { arity: 1 }, "--credentials-env": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const SPEC_REVIEW_LENSES_SPEC = { flags: { "--selftest": { arity: 0 }, "--tags": { arity: 1 }, "--level": { arity: 1 }, "--appetite": { arity: 1 }, "--adversarial-configured": { arity: 1 }, "--root": { arity: 1 } }, positionals: { min: 0, max: null, name: "arg" } };
// FAFF-628 — declared grammar for the two subcommand-dispatch verbs this module owns. `spec`
// carries BOTH per-subcommand CommandSpecs (a List<CommandSpec>) so the accepted-flag union
// covers both — `dod classify --view` (a `dod split`-only flag) still correctly reads as unknown.
const DOD_SURFACE = {
  kind: "subcommand_dispatch",
  spec: [DOD_CLASSIFY_SPEC, DOD_SPLIT_SPEC],
  subcommands: {
    classify: { required_flags: [] },
    split: { required_flags: ["--view"] },
  },
};
const HOLDOUT_SURFACE = {
  kind: "subcommand_dispatch",
  spec: [HOLDOUT_VERDICTS_SPEC, HOLDOUT_VERDICT_SPEC, HOLDOUT_RECORD_SPEC],
  subcommands: {
    verdicts: { required_flags: ["--association"] },
    verdict: { required_flags: ["--issue"] },
    record: { required_flags: ["--issue", "--spec"] },
  },
};
const { SPEC_REVIEW_LENSES, computeHoldoutVerdict, computeHoldoutVerdictsMap, holdoutGateResult } = require("./contract-defs");
const { loadConfig } = require("./config");
const { assembleAdversarialBackends } = require("./adversarial-backends");
const { ISSUE_ID_RE, parseLocalAcId, qualifyAcId } = require("./ac-id");

function prdHasComparator(s) {
  if (/[<>≤≥]/.test(s)) return true;                 // < > <= >= ≤ ≥ all contain one of these
  return /(?:^|[\s(])=(?:[\s)]|\d|$)/.test(s);        // a bare relational `=` (e.g. "x = 5")
}

// Classify one criterion's text. scenario (Then) > assertion (MUST/comparator) > prose.
// GWT keywords are capitalised by convention (FAFF-10 / the template) — match a
// capitalised `Then` so lowercase prose ("…and then…") is not mistaken for a scenario.
function classifyCriterion(text) {
  if (/\bThen\b/.test(text)) return "scenario";
  if (/\bmust\b/i.test(text) || prdHasComparator(text)) return "assertion";
  return "prose";
}

// --- born-verifiability oracle lint (FAFF-812) ---
// An `assertion`-class criterion reads born-verifiable on SHAPE alone (a `MUST` or a comparator),
// but shape says nothing about what the assertion is ABOUT — a well-formed assertion whose subject
// is internal code ("no timestamp comparison MUST happen in the api") has no external oracle the
// code-blind holdout can exercise. hasObservableOracle is the deterministic, in-source-tuned
// predicate that answers "does this assertion name an observable the holdout can reach?", mirroring
// the module's existing hand-tuned rules (BANNED_VAGUE, PROSE_DONE_STOPWORDS) — never escalated to
// an LLM; it checks form, not whether a named oracle is truly reachable.
//
// Presence of any OBSERVABLE_TOKENS entry → an oracle is named (an HTTP/exit-code/file/stdio
// vocabulary). INTERNAL_SUBJECT_MARKERS are phrasings that assert over code internals — deliberately
// PHRASE-specific ("in the api", not the bare word "api"), since the bare noun appears in plenty of
// valid observable assertions ("the API MUST return 200").
const OBSERVABLE_TOKENS = [
  "http", "https", "status", "status code", "response", "header", "body",
  "endpoint", "route", "request", "exit code", "exit status", "exits", "returns",
  "stdout", "stderr", "output", "file", "on disk", "written", "persisted",
  "200", "201", "400", "401", "403", "404", "409", "422", "500",
  "get ", "post ", "put ", "patch ", "delete ", "/",
];

const INTERNAL_SUBJECT_MARKERS = [
  "in the api", "in the code", "in the handler", "in the service",
  "internally", "under the hood",
];

// The "no ... happens" / "never calls" families are phrasing-varied, so they are matched
// structurally (a small regex each) rather than as a fixed phrase.
const INTERNAL_NEGATION_RE = /\bno\b.*\b(happen|happens|occur|occurs|comparison|call|calls)\b/i;
const INTERNAL_NEVER_RE = /\b(never|does not|doesn't|do not|don't)\b.*\b(call|calls|happen|compare|read|write)\b/i;

// Pure predicate, consulted only for assertion-class criteria. true = names an observable oracle
// the holdout can reach; false = oracle-less (an internal-code subject with no observable named).
// Recall-biased toward NOT flagging (gateway posture: a false negative is the status quo/no
// regression; a false positive erodes trust in an advisory) — flags only when an internal-subject
// marker fires AND no observable token is present.
function hasObservableOracle(text) {
  const lc = String(text == null ? "" : text).toLowerCase();
  const hasObservable = OBSERVABLE_TOKENS.some((t) => lc.includes(t));
  const hasInternalMarker = INTERNAL_SUBJECT_MARKERS.some((m) => lc.includes(m)) || INTERNAL_NEGATION_RE.test(lc) || INTERNAL_NEVER_RE.test(lc);
  return !(hasInternalMarker && !hasObservable);
}

// FAFF-275: a fence-open line whose info string is EXACTLY `holdout` (case-insensitive) — every
// criterion unit formed inside that fence is a holdout. Both fence styles recognised, matching
// the fence-toggle regex every other scanner in this file already shares.
function isHoldoutFenceOpen(line) {
  return /^\s*(?:```|~~~)\s*holdout\s*$/i.test(line);
}

// --- verification-tier tagging (FAFF-961) ---
// A second, orthogonal axis over `class` (shape) and `holdout` (builder-visibility): which VERIFIER
// can observe a criterion. Three values — `running-stack` (the default; the
// code-blind holdout's remit), `delegated` (FAFF-1291: a prose DONE item, verified by the AC checklist) and `integration` (born-verifiable, but only by the review/merge test
// floor, e.g. a down-migration on a forward-only stack the holdout cannot roll back). Carried on an
// additive `verification_tier` field (never a fourth `class` value — that would break every consumer
// switching on the three-value `class`, exactly what FAFF-812 rejected for `oracle_less`). FAFF-962
// widens the enum with `not-yet-reachable` + its deferred-with-obligation carrier.
//
// FAFF-1360 adds one precedence step after the prose-DONE rule: a non-prose DONE item that names a
// repository test file or a module export is `integration` (see codeSurfaceSignal), ahead of the keyword list.
//
// A fence-open line whose info string is EXACTLY `integration` (case-insensitive) — every criterion
// unit formed inside it is integration-tier. Mirrors isHoldoutFenceOpen.
function isIntegrationFenceOpen(line) {
  return /^\s*(?:```|~~~)\s*integration\s*$/i.test(line);
}

// The integration keyword heuristic: a narrow, phrase-specific migration-reversal set, applied to any
// criterion an explicit marker did not tier. Deliberately minimal (grown from real misses, like
// BANNED_VAGUE) — only the reversal family signals the tier; a bare "migration"/"database" is
// running-stack-observable and must NOT match (an over-broad match removes a criterion from the
// holdout's judged set, weakening verification — the dangerous direction).
const INTEGRATION_TIER_MARKERS = [
  "down-migration", "down migration", "migrate down", "downward migration",
  "rollback", "roll back", "rolled back",
  "revert the migration", "reverse the migration", "reversible migration",
];

// FAFF-1360: a non-prose DONE item that names a repository test file, or says a symbol is exported
// from a module, checks something the code-blind evaluator can never observe. A false match removes a
// criterion from the holdout, so each signal stays narrow and grows only from real misses.
const TEST_FILE_TOKEN_RE = /[\w.-]+(?:\.test|\.spec|_test|_spec)\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|swift|sh|bats)\b|\btest_\w+\.py\b/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const SOURCE_FILE_RE = /^[\w.\/-]+\.(?:[cm]?[jt]sx?|py|go|rb|rs|java|kt|swift|sh|bats)$/;
const SENTINEL = "\u0001";
const MASK_ID = `${SENTINEL}ID${SENTINEL}`;
const MASK_SRC = `${SENTINEL}SRC${SENTINEL}`;
const MASK_IDS = `${MASK_ID}(?:\\s*(?:,|and)\\s*${MASK_ID})*`;
const EXPORT_CLAUSE_RES = [
  new RegExp(`(?:^|[.;:!?]\\s+)export\\s+${MASK_ID}`, "i"),
  new RegExp(`\\bexported\\s+${MASK_ID}\\s*(?:'s\\b|(?:function|method|class|constant|helper|symbol)\\b)`, "i"),
  new RegExp(`${MASK_IDS}\\s+(?:is|are)\\s+exported\\s+from\\b`, "i"),
  new RegExp(`${MASK_SRC}\\s+exports?\\s+${MASK_ID}`, "i"),
];

// "Export `x` to a file" moves data, not a module symbol.
const DATA_EXPORT_RE = new RegExp(`(?:^|[.;:!?]\\s+)export\\s+${MASK_IDS}\\s+(?:to|into|onto|as)\\b`, "i");

function maskCodeSpans(text) {
  return String(text).split(SENTINEL).join(" ").replace(/`([^`]*)`/g, (_, code) => {
    if (IDENT_RE.test(code)) return ` ${MASK_ID} `;
    if (SOURCE_FILE_RE.test(code)) return ` ${MASK_SRC} `;
    return ` ${SENTINEL}CODE${SENTINEL} `;
  });
}

// Pure. "test-file" | "export" | null, from criterion text with the leading [ac-N] already removed.
function codeSurfaceSignal(text) {
  const t = String(text == null ? "" : text);
  if (TEST_FILE_TOKEN_RE.test(t)) return "test-file";
  const masked = maskCodeSpans(t);
  if (!DATA_EXPORT_RE.test(masked) && EXPORT_CLAUSE_RES.some((re) => re.test(masked))) return "export";
  return null;
}

// Pure. Resolves a criterion's verification tier by precedence: an explicit marker (from the parser)
// wins over a code-surface DONE item (FAFF-1360, step 3), which wins over an INTEGRATION_TIER_MARKERS
// keyword hit, which wins over the running-stack default.
// FAFF-1291: a prose DONE criterion is `delegated` (its verifier is the AC checklist, which receives
// DONE items by id); the rule sits between the explicit marker and the keyword check, so a prose DONE
// item that names a rollback is still delegated, not integration. A prose Scenarios unit stays
// running-stack: no verifier receives a Scenarios unit by id. Step 3 (FAFF-1360) tiers a DONE item with
// a code-surface signal `integration`; a Scenarios unit is the holdout's own material and never matches.
function resolveVerificationTier(text, markerTier, criterion) {
  if (markerTier) return markerTier;
  if (criterion && criterion.class === "prose" && criterion.source === "done") return "delegated";
  if (criterion && criterion.source === "done" && codeSurfaceSignal(text) !== null) return "integration";
  const lc = String(text == null ? "" : text).toLowerCase();
  if (INTEGRATION_TIER_MARKERS.some((k) => lc.includes(k))) return "integration";
  return "running-stack";
}

// FAFF-1291: the verifier is a pure function of the tier.
const TIER_VERIFIER = { "running-stack": "holdout", integration: "review-merge-floor", delegated: "ac-checklist" };

// Pure function over the `## Acceptance criteria` / `## Scenarios` section body. No filesystem /
// tracker I/O, so it is unit-testable in isolation. Returns [{text, kind, holdout}].
//  - strips blank lines, code-fence markers, and whole-line italic placeholders (^_.*_$)
//  - a unit is one markdown list item ("- "/"* "/"N.") OR a Given/When/Then block
// FAFF-275: the marker is read HERE, at unit-formation time, so classify's flags and dodSplit's
// removals (holdoutRemovalSpans, below) can never disagree — both share isHoldoutFenceOpen + the
// same `/^holdout:\s*/i` bullet-prefix test. A bullet's explicit `holdout:` prefix wins over an
// enclosing fence's state (irrelevant in practice — bullets don't appear inside GWT fences).
function classifyAcceptanceCriteria(sectionText) {
  const lines = String(sectionText == null ? "" : sectionText).split(/\r?\n/);
  const units = [];
  let cur = null;
  let curHoldout = false;
  let curTier = null;                                           // FAFF-961: null = no explicit marker (post-pass decides)
  let fence = false;
  let fenceHoldout = false;
  let fenceTier = null;                                         // FAFF-961: an enclosing `integration` fence's tier
  const pushCur = () => { if (cur != null) { const t = cur.trim(); if (t) units.push({ text: t, holdout: curHoldout, tier: curTier }); } cur = null; curHoldout = false; curTier = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*(?:```|~~~)/.test(line)) {                          // drop fence markers, keep content
      if (!fence) { fence = true; fenceHoldout = isHoldoutFenceOpen(line); fenceTier = isIntegrationFenceOpen(line) ? "integration" : null; }
      else { fence = false; fenceHoldout = false; fenceTier = null; }
      continue;
    }
    if (line.trim() === "") { pushCur(); continue; }             // blank closes a unit
    if (/^_.*_$/.test(line.trim())) { pushCur(); continue; }     // whole-line italic placeholder — not a criterion
    if (!fence && /^\s*>/.test(line)) { pushCur(); continue; }   // FAFF-275: a blockquote line (e.g. dodSplit's withheld-note) is never a criterion
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      pushCur();
      const m = li[1].match(/^holdout:\s*(.*)$/i);
      const ti = li[1].match(/^integration:\s*(.*)$/i);         // FAFF-961: bullet-prefix tier marker, stripped like holdout:
      if (m) { cur = m[1]; curHoldout = true; curTier = fence ? fenceTier : null; }  // FAFF-275: holdout prefix; tier still inherits an enclosing fence
      else if (ti) { cur = ti[1]; curHoldout = fence && fenceHoldout; curTier = "integration"; }
      else { cur = li[1]; curHoldout = fence && fenceHoldout; curTier = fence ? fenceTier : null; }
      continue;
    }
    if (/^\s*Given\b/i.test(line)) { pushCur(); cur = line.trim(); curHoldout = fence && fenceHoldout; curTier = fence ? fenceTier : null; continue; }  // GWT block start
    if (cur != null) cur += "\n" + line.trim();                  // continuation (When/Then/And/wrap)
    else { cur = line.trim(); curHoldout = fence && fenceHoldout; curTier = fence ? fenceTier : null; }  // a bare leading prose/assertion line
  }
  pushCur();
  return units.map((u) => ({ text: u.text, kind: classifyCriterion(u.text), holdout: u.holdout, tier: u.tier }));
}

// --- dod classify (FAFF-34) ---
// The LINE-INDEX extent of a heading section (`## Scenarios`, `### N. DONE`, …), up to the next
// equal/higher heading. Fence-aware: a `#` inside a code fence is not a heading. Returns null when
// the heading is absent. Pure. `sectionBody` (below) is a thin text-joining wrapper over this; FAFF-275's
// `dodSplit` needs the INDICES themselves (to remove/keep specific lines), so the range-finding walk
// lives here once and both callers share it — never two independently-drifting boundary scanners.
// FAFF-306: `opts.extraStop(line)` is an OPTIONAL boundary extension consulted outside fences — the
// scenarios caller passes `scenariosBoundaryStop` (stop at a DONE heading / contract fence / confidence
// line regardless of relative level); other callers omit it and keep the equal/higher-heading break alone.
function sectionBodyRange(lines, headingRe, opts) {
  const extraStop = opts && opts.extraStop;
  let start = -1, level = 0, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (/^\s*(?:```|~~~)/.test(lines[k])) { fence = !fence; continue; }
    if (!fence && headingRe.test(lines[k])) { start = k; level = headingLevel(lines[k]); break; }
  }
  if (start === -1) return null;
  let end = lines.length;
  fence = false;
  for (let k = start + 1; k < lines.length; k++) {
    // The extra boundary is checked OUTSIDE a fence and BEFORE the fence toggle, so a
    // `faff-contract:` fence-open stops the section instead of being entered as fence content.
    if (!fence && extraStop && extraStop(lines[k])) { end = k; break; }
    if (/^\s*(?:```|~~~)/.test(lines[k])) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(lines[k]);
    if (lvl > 0 && lvl <= level) { end = k; break; }
  }
  return { headingLine: start, bodyStart: start + 1, bodyEnd: end };
}

// The body TEXT of a heading section — a thin join over sectionBodyRange (see above for the shared
// boundary walk). Unchanged behaviour/signature; existing callers (admissible, dod classify) are
// unaffected by the refactor.
function sectionBody(specText, headingRe, opts) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  const range = sectionBodyRange(lines, headingRe, opts);
  if (range == null) return null;
  return lines.slice(range.bodyStart, range.bodyEnd).join("\n");
}

// Classify a spec's DoD criteria by born-verifiability class, reusing classifyCriterion VERBATIM (no forked
// rule — the same scenario>assertion>prose function `faff admissible` applies). Criteria are drawn from the
// SAME structures admissible reads: the `## Scenarios` section (each Given/When/Then block + each assertion
// bullet, via classifyAcceptanceCriteria) and the `### N. DONE` checklist (each `- [ ]` item). Pure — no I/O.
// FAFF-275: additive `holdout` per-criterion flag + top-level `holdout_counts` — `counts` is untouched and
// still sums to `criteria.length`, so every existing consumer keeps working unread.
function dodClassify(specText, opts) {
  const issue = opts && opts.issue;
  const criteria = [];
  const markerTiers = [];                                       // FAFF-961: parallel to criteria — the explicit-marker tier (or null) per criterion
  const scenBody = sectionBody(specText, SCENARIOS_HEADING_RE, { extraStop: scenariosBoundaryStop });
  if (scenBody != null) {
    for (const u of classifyAcceptanceCriteria(scenBody)) { criteria.push({ text: u.text, class: u.kind, source: "scenarios", holdout: u.holdout }); markerTiers.push(u.tier || null); }
  }
  const doneAdvisories = [];
  const doneItems = assignLocalAcIds(parseDoneChecklist(specText));
  for (const { text: t } of doneItems) {
    // FAFF-275: DONE mirrors the body 1:1 and is NEVER withheld (the closed-loop rule — a withheld
    // DONE item would silently break graft's AC checklist + the merge-gate floor). A `holdout:`-prefixed
    // DONE item is left LITERAL (no strip, holdout stays false) and draws an advisory, never a strip/removal.
    if (/^holdout:\s*/i.test(t)) doneAdvisories.push(t);
    criteria.push({ text: t, class: classifyCriterion(t), source: "done", holdout: false });
    markerTiers.push(null);                                     // FAFF-961: DONE items carry no tier marker (mirrors the holdout-literal rule); the FAFF-1360 code-surface step, then keyword/default, still apply below
  }
  for (const t of doneAdvisories) {
    process.stderr.write(`dod classify: DONE item begins "holdout:" but DONE items are never withheld (marker ignored, text kept literal): ${t.replace(/\s+/g, " ").slice(0, 60)}\n`);
  }
  const counts = { scenario: 0, assertion: 0, prose: 0 };
  for (const c of criteria) counts[c.class]++;
  const holdout_counts = { holdout: 0, visible: 0 };
  for (const c of criteria) { if (c.holdout) holdout_counts.holdout++; else holdout_counts.visible++; }
  // FAFF-812: additive oracle_less flag — true only for an assertion-class criterion with no
  // observable oracle (see hasObservableOracle above). A single post-pass over the already-built
  // criteria, so the two push sites above stay untouched. Never changes class/counts/holdout.
  let oracle_less_count = 0;
  for (const c of criteria) {
    c.oracle_less = c.class === "assertion" && !hasObservableOracle(c.text);
    if (c.oracle_less) oracle_less_count++;
  }
  // FAFF-961: additive verification_tier — marker (from the parser) > INTEGRATION_TIER_MARKERS keyword
  // > running-stack default. A single post-pass over the already-built criteria, mirroring the
  // oracle_less pass; never changes class/counts/holdout/oracle_less. verification_tier_counts sums to
  // criteria.length by construction (every criterion resolves to exactly one tier value).
  const verification_tier_counts = { "running-stack": 0, integration: 0, delegated: 0 };
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    c.verification_tier = resolveVerificationTier(c.text, markerTiers[i], c);
    c.verifier = TIER_VERIFIER[c.verification_tier];
    verification_tier_counts[c.verification_tier]++;
  }
  // FAFF-1291: judged_count is the judged set (every running-stack criterion, any class); the graft
  // skip rule needs it and integration_count both at zero; delegated_count is integration + delegated.
  const judged_count = verification_tier_counts["running-stack"];
  const integration_count = verification_tier_counts.integration;
  const delegated_count = integration_count + verification_tier_counts.delegated;
  // FAFF-1259: additive `id` per criterion, "<source>:<n>" with n the 1-based position among that
  // source's criteria in classify order. Minted here, not by the evaluator, so the value is mechanical.
  const seenPerSource = {};
  let doneIndex = 0;
  for (const c of criteria) {
    seenPerSource[c.source] = (seenPerSource[c.source] || 0) + 1;
    c.id = `${c.source}:${seenPerSource[c.source]}`;
    if (c.source !== "done") continue;
    c.local_ac_id = doneItems[doneIndex++].local || c.id;
    if (issue) c.ac_id = qualifyAcId(issue, c.local_ac_id);
  }
  return { criteria, counts, holdout_counts, oracle_less_count, verification_tier_counts, judged_count, integration_count, delegated_count };
}

// FAFF-1287: reads each DONE item's authored `[ac-N]` id. A near miss, a duplicate, or an id on only
// some items falls back to the positional id with an advisory on stderr; nothing here blocks.
function assignLocalAcIds(items) {
  const parsed = items.map((t) => parseLocalAcId(t));
  parsed.forEach((p) => { if (p.nearMiss) process.stderr.write("dod classify: DONE item id not recognised (use lowercase [ac-N])\n"); });
  const uses = new Map();
  for (const p of parsed) if (p.local) uses.set(p.local, (uses.get(p.local) || 0) + 1);
  for (const [id, n] of uses) if (n > 1) process.stderr.write(`dod classify: duplicate AC id ${id}\n`);
  const resolved = parsed.map((p) => (p.local && uses.get(p.local) === 1 ? p : { local: null, text: p.text }));
  if (resolved.some((p) => p.local) && resolved.some((p) => !p.local)) process.stderr.write("dod classify: mixed authored and positional AC ids\n");
  return resolved;
}

// FAFF-275: within a Scenarios-section BODY (already isolated by sectionBodyRange), find the
// line-index spans to REMOVE for the builder view — a holdout fence (open..close inclusive) or a
// holdout bullet (its start line + continuation lines, up to the next blank/unit/fence/heading).
// Independent scan from classifyAcceptanceCriteria, but shares its two marker predicates
// (isHoldoutFenceOpen, the `/^holdout:\s*/i` bullet-prefix test) and its unit-boundary rules
// (blank / new-bullet / new-Given closes the current unit) — one shared vocabulary, two projections
// (classify's flags, split's removals), never two independently-drifting parsers.
function holdoutRemovalSpans(bodyLines) {
  const spans = [];
  let fence = false, fenceHoldout = false, fenceStart = -1;
  let bulletStart = -1;   // -1 == not currently inside a holdout-bullet unit
  const closeBullet = (endIdx) => { if (bulletStart !== -1) { spans.push({ start: bulletStart, end: endIdx }); bulletStart = -1; } };
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i].replace(/\s+$/, "");
    if (/^\s*(?:```|~~~)/.test(line)) {
      if (!fence) { fence = true; fenceHoldout = isHoldoutFenceOpen(line); fenceStart = i; closeBullet(i - 1); }
      else { if (fenceHoldout) spans.push({ start: fenceStart, end: i }); fence = false; fenceHoldout = false; fenceStart = -1; }
      continue;
    }
    if (fence) continue;                                          // in-fence content is handled as ONE span above
    if (line.trim() === "") { closeBullet(i - 1); continue; }      // blank closes the current holdout-bullet unit
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) { closeBullet(i - 1); bulletStart = /^holdout:\s*/i.test(li[1]) ? i : -1; continue; }
    if (/^\s*Given\b/i.test(line)) { closeBullet(i - 1); continue; }  // a new GWT unit is never itself holdout outside a fence
    // a continuation line belongs to the currently-open holdout bullet, if any — no-op otherwise
  }
  closeBullet(bodyLines.length - 1);
  return spans;
}

// FAFF-275: the deterministic split behind `faff dod split --view builder|full`. `full` is the
// identity (byte-for-byte). `builder` removes each holdout-marked scenario unit and inserts one
// withheld-count note directly under the Scenarios heading — a no-marker spec is a guaranteed,
// byte-identical no-op (the input is returned UNTOUCHED, never reconstructed from split lines).
// Pure: no tracker/network/LLM. Returns { text, warnings } — warnings is the over-withholding
// advisory (never gates; the CLI wrapper prints it to stderr, mirroring admissibleVerdict's
// return-don't-print convention elsewhere in this file).
function dodSplit(specText, view) {
  const text = String(specText == null ? "" : specText);
  if (view === "full") return { text, warnings: [] };

  const lines = text.split(/\r?\n/);
  const range = sectionBodyRange(lines, SCENARIOS_HEADING_RE, { extraStop: scenariosBoundaryStop });
  if (range == null) return { text, warnings: [] };                // no Scenarios section — nothing the marker's jurisdiction covers

  const bodyLines = lines.slice(range.bodyStart, range.bodyEnd);
  const classified = classifyAcceptanceCriteria(bodyLines.join("\n"));
  const holdoutCount = classified.filter((c) => c.holdout).length;
  if (holdoutCount === 0) return { text, warnings: [] };            // guaranteed byte-identical no-op

  const spans = holdoutRemovalSpans(bodyLines);
  const removed = new Set();
  for (const s of spans) for (let i = s.start; i <= s.end; i++) removed.add(i);
  const kept = [];
  for (let i = 0; i < bodyLines.length; i++) if (!removed.has(i)) kept.push(bodyLines[i]);
  // Collapse a doubled blank line LEFT BY a removal (array-level — never touch bytes outside
  // removed spans), then drop a leading blank: the note becomes the section's new first line.
  const collapsed = [];
  for (const l of kept) {
    if (l.trim() === "" && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === "") continue;
    collapsed.push(l);
  }
  while (collapsed.length > 0 && collapsed[0].trim() === "") collapsed.shift();

  const bornBefore = classified.filter((c) => c.kind === "scenario" || c.kind === "assertion").length;
  const bornAfter = classified.filter((c) => !c.holdout && (c.kind === "scenario" || c.kind === "assertion")).length;
  const warnings = [];
  if (bornBefore >= 1 && bornAfter === 0) {
    warnings.push("over-withholding advisory: the builder view retains ZERO born-verifiable Scenarios-section criteria (the full spec had >= 1) — consider marking fewer scenarios as holdout");
  }

  const note = `> ${holdoutCount} holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.`;
  const before = lines.slice(0, range.headingLine + 1);   // everything up to + including the Scenarios heading, untouched
  const after = lines.slice(range.bodyEnd);               // everything from the section's end onward, untouched
  const middleLines = ["", note, "", ...collapsed];
  return { text: [...before, ...middleLines, ...after].join("\n"), warnings };
}

// The `## Acceptance criteria` section body (case-insensitive heading PREFIX, so
// "## Acceptance Criteria" / "## Acceptance criteria (release)" match). Delegates to the
// shared sectionBody/sectionBodyRange scanner (FAFF-923): fence-aware start scan, body stops
// at the first equal-or-higher heading (a `#` h1 included, not just the next `## `). null when
// no such section exists. No local boundary-scanning loop — see sectionBodyRange for the walk.
function acceptanceSection(prdText) {
  return sectionBody(prdText, /^\s*##\s+acceptance criteria/i);
}

const BANNED_VAGUE = [
  "works correctly", "works as expected", "handled properly",
  "behaves correctly", "as appropriate", "etc.", "and so on", "properly handled",
];

function matchesBannedVague(text) {
  const t = String(text == null ? "" : text).toLowerCase();
  return BANNED_VAGUE.some((p) => t.includes(p));
}

// The `## Scenarios` heading matcher, shared by parseScenarios (R1, `faff
// admissible`) and dodClassify's sectionBody call (`faff dod classify`) so the two
// recognise the SAME heading forms by construction. Tolerant of an optional leading
// list-number (`5. ` / `5) `, matching the file's `\d+[.)]` numbering convention) and
// case-insensitive, so the producer's own `### 5. SCENARIOS` form is recognised (the
// DONE matcher is already number-tolerant — it keys on the word `\bdone\b`). Recognition
// only — the R1/R2a/R2b counting logic is unchanged (FAFF-300).
const SCENARIOS_HEADING_RE = /^\s*#{1,6}\s+(?:\d+[.)]\s+)?scenarios\b/i;

// Heading level of a markdown ATX heading line (count of leading #), else 0.
function headingLevel(line) {
  const m = String(line).match(/^\s*(#{1,6})\s+\S/);
  return m ? m[1].length : 0;
}

// --- Shared DoD-section boundary recognisers (FAFF-306) ---
// One source of truth for where the SCENARIOS section ends, so `dod classify`
// (via sectionBody) and `admissible` (via parseScenarios) cannot disagree on the
// section extent. The defect was a heading-LEVEL break (`lvl <= level`) that let a
// DEEPER DONE heading (`## Scenarios` h2 → `### N. DONE` h3) fail to stop the
// section, so it ran to EOF and swallowed the DONE heading, the trailing
// `confidence:` line, and the `faff-contract:` block as phantom criteria.

// A DONE heading: any ATX heading whose text contains the word `done` (the SAME
// predicate parseDoneChecklist keys its section START on — name-keyed, level-agnostic).
function isDoneHeading(line) {
  return headingLevel(line) > 0 && /\bdone\b/i.test(line);
}

// The producer's standalone trailing confidence line (`confidence: high|medium|low`).
// Never a criterion (not a GWT scenario, not a MUST/comparator assertion).
function isConfidenceLine(line) {
  return /^\s*confidence:\s*(?:high|medium|low)\s*$/i.test(line);
}

// A fence-open line whose info string carries `faff-contract:` (the trailing
// spec-readiness block). Keys on the info string ONLY — a generic GWT / bash fence
// (no `faff-contract:`) is NOT a stop, so scenario fence content is still kept.
function opensContractFence(line) {
  return /^\s*(?:```|~~~)\s*faff-contract:/i.test(line);
}

// The shared scenarios-section boundary extension: stop at a DONE heading (any
// level), the trailing contract block, or a standalone confidence line. Consulted
// OUTSIDE a fence only (in-fence GWT blocks never end the section). The `lvl <= level`
// equal/higher-heading break stays in each loop — this is the additive part both share.
function scenariosBoundaryStop(line) {
  return isDoneHeading(line) || opensContractFence(line) || isConfidenceLine(line);
}

// Level of the first heading (outside fences) matching `pred`, else 0. Used by the
// advisory DoD heading-level-mismatch check.
function firstHeadingLevelMatching(specText, pred) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  let fence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (pred(line)) return headingLevel(line);
  }
  return 0;
}

// Advisory (never gating) warning when SCENARIOS and DONE headings sit at different
// levels — the historical over-capture trap. Surfacing it is the reconciliation
// signal: admissible now flags the exact structural smell that used to silently
// desync it from `dod classify`. Empty array when levels match or either is absent.
function doneScenariosLevelWarning(specText) {
  const s = firstHeadingLevelMatching(specText, (l) => SCENARIOS_HEADING_RE.test(l));
  const d = firstHeadingLevelMatching(specText, (l) => isDoneHeading(l));
  if (s > 0 && d > 0 && s !== d) {
    return [`R4 advisory: SCENARIOS heading (h${s}) and DONE heading (h${d}) are at different levels — normalise them; dod classify reads the same section by name regardless, but a level mismatch is the historical over-capture trap (FAFF-306)`];
  }
  return [];
}

// Count born-verifiable scenarios under a `## Scenarios` heading: each
// Given/When/Then group (a `Given` line is enough to count one) PLUS each
// standalone assertion/constraint bullet (non-functional objectives are valid
// born-verifiable items per both producers). Pure — no I/O.
function parseScenarios(specText) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
  let start = -1, level = 0, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (isFence(lines[k])) { fence = !fence; continue; }
    if (!fence && SCENARIOS_HEADING_RE.test(lines[k])) { start = k; level = headingLevel(lines[k]); break; }
  }
  if (start === -1) return 0;
  let count = 0;
  fence = false;
  for (let k = start + 1; k < lines.length; k++) {
    const line = lines[k];
    // FAFF-306: the SAME boundary `dod classify` uses — stop at a DONE heading / contract
    // fence / confidence line (outside a fence) so admissible cannot over-count past DONE.
    if (!fence && scenariosBoundaryStop(line)) break;
    if (isFence(line)) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(line);               // a `#` inside a code fence is not a heading
    if (lvl > 0 && lvl <= level) break;                       // next equal/higher heading ends the section
    if (/^\s*Given\b/i.test(line)) { count++; continue; }     // a Given line counts one GWT group (in-fence GWT included)
    if (fence) continue;                                      // other in-fence lines are scenario prose, not bullets
    // a standalone assertion/constraint bullet (e.g. "- **Assertion:** …")
    if (/^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)) {
      const body = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
      if (/\bassert(?:ion)?\b|\bconstraint\b|\bmust\b/i.test(body)) count++;
    }
  }
  return count;
}

// Collect `- [ ]` / `- [x]` checklist item texts under the DoD heading — matched
// by NAME (a heading whose text contains "DONE"), not by number, so it works for
// both `## 8. DONE` and `### 4. DONE`. Collect until the next heading of
// equal-or-higher level (sub-headings under DONE are included). Pure — no I/O.
function parseDoneChecklist(specText) {
  const lines = String(specText == null ? "" : specText).split(/\r?\n/);
  const isFence = (l) => /^\s*(?:```|~~~)/.test(l);
  let start = -1, level = 0, fence = false;
  for (let k = 0; k < lines.length; k++) {
    if (isFence(lines[k])) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(lines[k]);           // a `#` inside a code fence is not a heading
    if (lvl > 0 && isDoneHeading(lines[k])) { start = k; level = lvl; break; }   // name-keyed (shared, FAFF-306)
  }
  if (start === -1) return [];
  const items = [];
  fence = false;
  for (let k = start + 1; k < lines.length; k++) {
    if (isFence(lines[k])) { fence = !fence; continue; }
    const lvl = fence ? 0 : headingLevel(lines[k]);
    if (lvl > 0 && lvl <= level) break;                       // next equal/higher heading ends the section
    if (fence) continue;                                      // checklist items live outside fences
    const m = lines[k].match(/^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

// R3 (advisory): does the spec carry a runnable check command? A fenced ```verify
// block, an "Integration smoke test" block, or a fenced shell/console command.
// Its absence only warns — never fails admissibility. Pure — no I/O.
function detectRunnableCheck(specText) {
  const t = String(specText == null ? "" : specText);
  if (/```\s*verify\b/i.test(t)) return true;
  if (/integration smoke test/i.test(t)) return true;
  if (/```\s*(?:bash|sh|shell|console)\b/i.test(t)) return true;
  return false;
}

// --- prose-DONE delegation advisory (FAFF-304, reworded by FAFF-1291) ---
// A prose DONE item is no longer judged by the code-blind holdout: `faff dod classify` tiers it
// `delegated` and the AC checklist verifies it. The count of prose DONE items is still a
// deterministic, knowable-in-advance number, and so is the judged count (the criteria the holdout
// does judge). This advisory surfaces both on `admissible`'s
// existing warnings[] channel — additive only, NEVER gating (it can't flip
// `admissible`). It reuses dodClassify (the SAME classifier the evaluator uses), so
// the count agrees with the evaluator by construction and inherits FAFF-306's
// corrected `## Scenarios` / `### N. DONE` section boundaries for free.

// Recall-biased duplicate threshold + stopwords — tunable constants (a floor, by
// design; tune from real misses, never escalate to an LLM), mirroring BANNED_VAGUE.
const DUP_THRESHOLD = 0.6;
const PROSE_DONE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "by", "for",
  "with", "is", "are", "be", "was", "were", "been", "it", "its", "this", "that",
  "these", "those", "as", "so", "if", "then", "when", "given", "than", "into",
  "from", "over", "via", "not", "will", "must", "should", "can", "may", "each",
  "any", "all", "no", "new",
]);

// Content tokens of a criterion: lowercase, strip markdown/backticks/punctuation,
// drop 1-char tokens and stopwords (incl. Given/When/Then scaffolding). Returns a Set.
function proseDoneTokens(text) {
  const cleaned = String(text == null ? "" : text)
    .toLowerCase()
    .replace(/`+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ");
  const out = new Set();
  for (const w of cleaned.split(/\s+/)) {
    if (w.length > 1 && !PROSE_DONE_STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

// One-directional containment of the DONE item's tokens in a born-verifiable
// criterion's tokens (NOT symmetric Jaccard) — a restated DONE item is typically a
// near-subset of the fuller scenario, which carries extra Given/When/Then scaffolding
// a symmetric score would under-weight. Returns the fraction of the DONE item's tokens
// the born-verifiable one covers, in [0,1].
function proseDoneContainment(doneText, bornText) {
  const dt = proseDoneTokens(doneText);
  if (dt.size === 0) return 0;
  const bt = proseDoneTokens(bornText);
  let inter = 0;
  for (const w of dt) if (bt.has(w)) inter++;
  return inter / dt.size;
}

// Pure: given the spec text, return the prose-DONE advisory data, or null when there
// is no prose DONE item (no warning). Reuses dodClassify — the single source of truth,
// no second parser. The duplicate flag is a recall-biased advisory refinement; it
// annotates, never gates.
function proseDoneAdvisory(specText) {
  let classified;
  try { classified = dodClassify(specText); } catch (e) { return null; }
  const proseDone = classified.criteria.filter((c) => c.source === "done" && c.class === "prose");
  if (proseDone.length === 0) return null;
  const bornVerifiable = classified.criteria.filter((c) => c.class === "scenario" || c.class === "assertion");
  const duplicates = proseDone.filter((p) => bornVerifiable.some((b) => proseDoneContainment(p.text, b.text) >= DUP_THRESHOLD));
  const doneTotal = classified.criteria.filter((c) => c.source === "done").length;
  return { count: proseDone.length, items: proseDone, duplicates, judged: classified.judged_count, allProseDone: proseDone.length === doneTotal };
}

// Render the single-line advisory (deterministic "prose-DONE advisory:" prefix). Items
// whitespace-collapsed + truncated ~50 chars, mirroring the R2b detail style. The
// duplicate clause is omitted entirely when no item looks like a restatement.
function renderProseDoneWarning(adv) {
  const trunc = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 50);
  const items = adv.items.map((p) => trunc(p.text)).join(" | ");
  let s = `prose-DONE advisory: ${adv.count} DONE item(s) are loose prose and are delegated to the AC checklist, not judged by the holdout (judged count: ${adv.judged}; phrase an item with Then or must to keep it code-blind): ${items}`;
  if (adv.duplicates.length >= 1) {
    const dups = adv.duplicates.map((p) => trunc(p.text)).join(" | ");
    s += `  (${adv.duplicates.length} appear to restate a born-verifiable scenario — candidates to remove: ${dups})`;
  }
  return s;
}

// --- oracle-less-assertion advisory (FAFF-812) ---
// Pure: given the spec text, return the oracle-less advisory data, or null when there are zero
// oracle-less assertions (no warning). Reuses dodClassify's additive oracle_less flag — the single
// source of truth, no second parser. Mirrors proseDoneAdvisory's try/catch-to-null shape.
function oracleLessAdvisory(specText) {
  let classified;
  try { classified = dodClassify(specText); } catch (e) { return null; }
  const oracleLess = classified.criteria.filter((c) => c.oracle_less);
  if (oracleLess.length === 0) return null;
  return { count: oracleLess.length, items: oracleLess };
}

// --- code-surface advisory (FAFF-1360) ---
const MIXED_SURFACE_RE = /\b(?:exits?|exited|exit code|exit status|stdout|stderr|https?)\b/i;

// Pure: DONE items sent to the test floor by a code-surface signal, or null when there are none.
function codeSurfaceAdvisory(specText) {
  let classified;
  try { classified = dodClassify(specText); } catch (e) { return null; }
  const items = classified.criteria.filter((c) => c.source === "done" && c.verification_tier === "integration" && codeSurfaceSignal(c.text) !== null);
  if (items.length === 0) return null;
  return { count: items.length, items, mixed: items.filter((c) => MIXED_SURFACE_RE.test(c.text)) };
}

function renderCodeSurfaceWarning(adv) {
  const trunc = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 50);
  let s = `code-surface advisory: ${adv.count} DONE item(s) name a repository test file or an exported symbol and go to the review/merge test floor, not the holdout: ${adv.items.map((c) => trunc(c.text)).join(" | ")}`;
  if (adv.mixed.length > 0) {
    s += `  (${adv.mixed.length} also name CLI or HTTP behaviour; state that behaviour as its own DONE item so the holdout judges it: ${adv.mixed.map((c) => trunc(c.text)).join(" | ")})`;
  }
  return s;
}

// --- scenarios code-surface advisory (FAFF-1364) ---
// Pure: Scenarios units whose check is a repository test file, or null when there are none. Mirrors
// codeSurfaceAdvisory but filters source==="scenarios" and does NOT filter on verification_tier — a
// Scenarios test-file unit stays running-stack (ADR-0140: no verifier other than the holdout receives
// a Scenarios unit by id, so there is nowhere to retier it to). Reuses codeSurfaceSignal, never a
// second pattern (FAFF-1360's TEST_FILE_TOKEN_RE stays the one detection home).
function scenariosCodeSurfaceAdvisory(specText) {
  let classified;
  try { classified = dodClassify(specText); } catch (e) { return null; }
  const items = classified.criteria.filter((c) => c.source === "scenarios" && codeSurfaceSignal(c.text) === "test-file");
  if (items.length === 0) return null;
  return { count: items.length, items };
}

function renderScenariosCodeSurfaceWarning(adv) {
  const trunc = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 50);
  return `scenarios-code-surface advisory: ${adv.count} Scenarios unit(s) name a repository test file the code-blind holdout cannot run; restate the behaviour as an observable Given/When/Then and move the test-file check to a DONE item: ${adv.items.map((c) => trunc(c.text)).join(" | ")}`;
}

// --- scenarios prose advisory (FAFF-1293) ---
// Pure: Scenarios units dodClassify puts in the prose class (no Then, no MUST, no comparator), in classify
// order, or null when there are none. A prose Scenarios unit has no delegate verifier (ADR-0140: the AC
// checklist receives DONE items by id, never Scenarios units) and a holdout-marked one is also withheld
// from the builder view, so it checks nothing. Reads dodClassify's class/holdout fields only — never a
// second prose detector (classifyCriterion stays the one class rule). Advisory: never flips admissible.
function scenariosProseAdvisory(specText) {
  let classified;
  try { classified = dodClassify(specText); } catch (e) { return null; }
  const items = classified.criteria.filter((c) => c.source === "scenarios" && c.class === "prose");
  if (items.length === 0) return null;
  return { count: items.length, holdout: items.filter((c) => c.holdout === true).length, items };
}

function renderScenariosProseWarning(adv) {
  const trunc = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 50);
  const clause = adv.holdout >= 1 ? `; ${adv.holdout} of them are holdout-marked and withheld from the builder, so they check nothing` : "";
  const named = adv.items.map((c) => `${c.id}${c.holdout === true ? " (holdout)" : ""} ${trunc(c.text)}`).join(" | ");
  return `scenarios-prose advisory: ${adv.count} Scenarios unit(s) are prose (no Then, no MUST or comparator) and cannot be judged code-blind${clause}; restate each as a Given/When/Then with an observable Then: ${named}`;
}

// Render the single-line advisory (deterministic "oracle-less-assertion advisory:" prefix). Items
// whitespace-collapsed + truncated ~50 chars, mirroring renderProseDoneWarning's style.
function renderOracleLessWarning(adv) {
  const trunc = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, 50);
  const items = adv.items.map((c) => trunc(c.text)).join(" | ");
  return `oracle-less-assertion advisory: ${adv.count} assertion(s) name no observable oracle (a MUST/comparator over internal code the holdout cannot exercise): ${items}`;
}

// The pure verdict. Any parse exception coerces to inadmissible (fail-safe).
function admissibleVerdict(specText, lightsOut) {
  if (!lightsOut) {
    return { admissible: true, reasons: [], checks: [{ id: "scope", pass: true, detail: "not lights-out — gate inactive" }], warnings: [] };
  }
  let scenarios, doneItems;
  try {
    scenarios = parseScenarios(specText);
    doneItems = parseDoneChecklist(specText);
  } catch (e) {
    return { admissible: false, reasons: ["spec unparseable — fail-safe inadmissible"], checks: [], warnings: [] };
  }
  const checks = [];
  checks.push({ id: "R1.scenarios", pass: scenarios >= 1, detail: `${scenarios} born-verifiable scenario(s) (need >=1)` });
  checks.push({ id: "R2a.done-present", pass: doneItems.length >= 1, detail: `${doneItems.length} DONE checklist item(s) (need >=1)` });
  const vague = doneItems.filter((it) => matchesBannedVague(it));
  checks.push({ id: "R2b.done-concrete", pass: vague.length === 0, detail: `${vague.length} vague DONE item(s)${vague.length ? ": " + vague.map((v) => v.replace(/\s+/g, " ").slice(0, 50)).join(" | ") : ""}` });
  const warnings = detectRunnableCheck(specText) ? [] : ["R3 advisory: no runnable check command found (recommended for lights-out, not required)"];
  warnings.push(...doneScenariosLevelWarning(specText));   // FAFF-306: advisory only — never flips admissible
  const adv = proseDoneAdvisory(specText);                 // FAFF-304: predict the evaluator's prose-DONE punts
  if (adv) warnings.push(renderProseDoneWarning(adv));     // advisory only — never flips admissible
  if (adv && adv.allProseDone && adv.judged === 0) warnings.push("prose-DONE advisory: every DONE item is loose prose and nothing is judged, so nothing in DONE will be judged code-blind (it rests on the AC checklist and review)");  // FAFF-1291
  const surfaceAdv = codeSurfaceAdvisory(specText);        // FAFF-1360: advisory only; never flips admissible
  if (surfaceAdv) warnings.push(renderCodeSurfaceWarning(surfaceAdv));
  const scenAdv = scenariosCodeSurfaceAdvisory(specText);  // FAFF-1364: advisory only; never flips admissible
  if (scenAdv) warnings.push(renderScenariosCodeSurfaceWarning(scenAdv));
  const proseAdv = scenariosProseAdvisory(specText);       // FAFF-1293: advisory only; never flips admissible
  if (proseAdv) warnings.push(renderScenariosProseWarning(proseAdv));
  const admissible = checks.every((c) => c.pass);
  const reasons = checks.filter((c) => !c.pass).map((c) => c.detail);
  return { admissible, reasons, checks, warnings };
}

// Verdict-table selftest — one case per spec'd branch.
const ADMISSIBLE_GOOD = [
  "## Scenarios", "",
  "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "",
  "## 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", "- [ ] exit code MUST be 0 admissible / 1 inadmissible", "",
  "**Integration smoke test.**", "```", "faff admissible --selftest", "```", "",
].join("\n");

// The producer's own default heading form: numbered + H3 + uppercase
// (`### 5. SCENARIOS` / `### 8. DONE`). Same content as ADMISSIBLE_GOOD; only the
// heading style differs — recognition must not gate on it (FAFF-300).
const ADMISSIBLE_GOOD_NUMBERED = [
  "### 5. SCENARIOS", "",
  "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "",
  "### 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", "- [ ] exit code MUST be 0 admissible / 1 inadmissible", "",
].join("\n");

// FAFF-304 fixtures — prose DONE items are delegated to the AC checklist (FAFF-1291).
// ADMISSIBLE_PROSE_DONE: 3 prose DONE that do NOT restate the scenario (no
// duplicate clause). ADMISSIBLE_DUP_DONE: 3 prose DONE, 2 of which restate the scenario
// (the duplicate clause names those 2 as candidates to remove).
const ADMISSIBLE_PROSE_DONE = [
  "## Scenarios", "",
  "```", "Given a request to /healthz", "When the server is running", "Then it responds 200", "```", "",
  "## 8. DONE", "",
  "- [ ] The dashboard surfaces deployment status to operators",
  "- [ ] Operators can filter the audit log by actor",
  "- [ ] The onboarding flow welcomes new users",
].join("\n");

const ADMISSIBLE_DUP_DONE = [
  "## Scenarios", "",
  "```", "Given a user submits a shortened link request", "When the server stores the mapping", "Then the api returns the short code", "```", "",
  "## 8. DONE", "",
  "- [ ] the server stores the mapping for a shortened link request",
  "- [ ] the api returns the short code to the user",
  "- [ ] operators receive a weekly analytics digest",
].join("\n");

function admissibleSelftest() {
  const noScenarios = ADMISSIBLE_GOOD.replace(/## Scenarios[\s\S]*?\n\n(?=## 8\. DONE)/, "");
  const cases = [
    { name: "admissible (R1+R2 pass, R3 ok)", text: ADMISSIBLE_GOOD, lights: true, wantAdmissible: true, wantWarn: false },
    { name: "admissible numbered headings (### N. SCENARIOS / ### N. DONE)", text: ADMISSIBLE_GOOD_NUMBERED, lights: true, wantAdmissible: true },
    { name: "R1-fail (no Scenarios)", text: noScenarios, lights: true, wantAdmissible: false, wantReason: /R1|scenario/i },
    { name: "R2a-fail (empty DONE)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n(no items)\n", lights: true, wantAdmissible: false, wantReason: /DONE checklist/i },
    { name: "R2b-fail (vague DONE item)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the feature works correctly\n", lights: true, wantAdmissible: false, wantReason: /vague DONE/i },
    { name: "R3-advisory-warn (no runnable check)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantWarn: true },
    { name: "unparseable-failsafe (empty body)", text: "", lights: true, wantAdmissible: false },
    { name: "scope-inactive (no --lights-out)", text: "", lights: false, wantAdmissible: true, wantScope: true },
    // FAFF-306: a DoD heading-level mismatch (`## Scenarios` h2 / `### N. DONE` h3) stays admissible
    // but MUST surface the advisory level-mismatch warning — never flipping the boolean.
    { name: "FAFF-306 level-mismatch advisory (h2 Scenarios / h3 DONE)", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n### 2. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantWarnMatch: /different levels.*FAFF-306/ },
    // Consistent levels (both h2) must emit NO level-mismatch warning (regression guard).
    { name: "FAFF-306 consistent levels → no level warning", text: "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantNoLevelWarn: true },
    // FAFF-304: prose DONE items predict the holdout evaluator's needs-human punts —
    // advisory only, never flipping the boolean.
    { name: "FAFF-304 prose-DONE-fires-advisory (3 prose DONE)", text: ADMISSIBLE_PROSE_DONE, lights: true, wantAdmissible: true, wantAdvisory: true, wantAdvisoryCount: 3, wantDuplicate: false },
    { name: "FAFF-304 born-verifiable-DONE-no-advisory", text: ADMISSIBLE_GOOD, lights: true, wantAdmissible: true, wantAdvisory: false },
    { name: "FAFF-304 duplicate-annotation-present (2 restate a scenario)", text: ADMISSIBLE_DUP_DONE, lights: true, wantAdmissible: true, wantAdvisory: true, wantAdvisoryCount: 3, wantDuplicate: true },
    { name: "FAFF-304 advisory-never-flips-admissible (prose DONE stays admissible)", text: ADMISSIBLE_PROSE_DONE, lights: true, wantAdmissible: true, wantAdvisory: true },
    // FAFF-1364: a Scenarios unit whose check is a repository test file fires the new advisory,
    // never flipping admissible. A CLI-only Scenarios unit and a well-formed GWT unit yield no
    // scenarios-code-surface warning — the signal is narrow (test-file token only).
    { name: "FAFF-1364 scenarios-code-surface-fires (test-file in Scenarios)", text: "## Scenarios\n```\nGiven a\nWhen b\nThen `test/a.test.mjs` MUST pass\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantWarnMatch: /^scenarios-code-surface advisory:/ },
    { name: "FAFF-1364 scenarios-code-surface-silent (CLI-only Scenarios unit)", text: "## Scenarios\n```\nGiven a\nThen `faff x` MUST exit 0\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantNoScenariosSurfaceWarn: true },
    { name: "FAFF-1364 scenarios-code-surface-silent (well-formed GWT)", text: ADMISSIBLE_GOOD, lights: true, wantAdmissible: true, wantNoScenariosSurfaceWarn: true },
    // FAFF-1293: a holdout-fenced Given/When block with no Then is a prose Scenarios unit — the advisory names it
    // with the (holdout) tag and never flips admissible. A well-formed GWT unit and a MUST assertion bullet stay silent.
    { name: "FAFF-1293 scenarios-prose-fires (holdout Given/When, no Then)", text: "## Scenarios\n```\nGiven a\nWhen b\nThen c MUST hold\n```\n\n```holdout\nGiven a withheld case\nWhen the CLI runs\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantWarnMatch: /^scenarios-prose advisory: 1 Scenarios unit\(s\).*; 1 of them are holdout-marked.*scenarios:2 \(holdout\) Given a withheld case/ },
    { name: "FAFF-1293 scenarios-prose-silent (well-formed GWT)", text: ADMISSIBLE_GOOD, lights: true, wantAdmissible: true, wantNoScenariosProseWarn: true },
    { name: "FAFF-1293 scenarios-prose-silent (MUST assertion bullet)", text: "## Scenarios\n\n- p99 latency MUST be < 200ms\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n", lights: true, wantAdmissible: true, wantNoScenariosProseWarn: true },
  ];
  let failed = 0;
  for (const c of cases) {
    const v = admissibleVerdict(c.text, c.lights);
    let ok = v.admissible === c.wantAdmissible;
    if (ok && c.wantReason) ok = v.reasons.some((r) => c.wantReason.test(r));
    if (ok && c.wantWarn === true) ok = v.warnings.length >= 1;
    if (ok && c.wantWarn === false) ok = v.warnings.length === 0;
    if (ok && c.wantWarnMatch) ok = v.warnings.some((w) => c.wantWarnMatch.test(w));    // FAFF-306
    if (ok && c.wantNoLevelWarn) ok = !v.warnings.some((w) => /different levels/.test(w));  // FAFF-306
    if (ok && c.wantNoScenariosSurfaceWarn) ok = !v.warnings.some((w) => w.startsWith("scenarios-code-surface advisory:"));  // FAFF-1364
    if (ok && c.wantNoScenariosProseWarn) ok = !v.warnings.some((w) => w.startsWith("scenarios-prose advisory:"));  // FAFF-1293
    // FAFF-304: the prose-DONE punt-prediction advisory (a warnings[] string, never gating)
    const advWarn = v.warnings.find((w) => w.startsWith("prose-DONE advisory:"));
    if (ok && c.wantAdvisory === true) ok = !!advWarn;
    if (ok && c.wantAdvisory === false) ok = !advWarn;
    if (ok && typeof c.wantAdvisoryCount === "number") ok = !!advWarn && new RegExp(`^prose-DONE advisory: ${c.wantAdvisoryCount} DONE item`).test(advWarn);
    if (ok && c.wantDuplicate === true) ok = !!advWarn && /candidates to remove:/.test(advWarn);
    if (ok && c.wantDuplicate === false) ok = !!advWarn && !/candidates to remove:/.test(advWarn);
    if (ok && c.wantScope) ok = v.checks.length === 1 && v.checks[0].id === "scope" && v.warnings.length === 0;
    // invariant: reasons non-empty IFF inadmissible; warnings never flip admissible
    if (ok) ok = (v.reasons.length > 0) === (v.admissible === false);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name} → admissible=${v.admissible}`);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

function cmdAdmissible(args) {
  if (args.includes("--selftest")) return admissibleSelftest();
  const parsed = parseArgs(args, ADMISSIBLE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff admissible --spec <path|-> [--lights-out] [--json]");
  const lightsOut = !!parsed.values["--lights-out"];
  const json = !!parsed.values["--json"];
  const specArg = parsed.values["--spec"] === undefined ? null : parsed.values["--spec"];
  let specText;
  try {
    if (specArg && specArg !== "-") specText = fs.readFileSync(specArg, "utf8");
    else specText = fs.readFileSync(0, "utf8");   // --spec - or no --spec → stdin
  } catch (e) {
    process.stderr.write(`faff admissible: cannot read spec: ${e.message}\n`);
    return 2;
  }
  const v = admissibleVerdict(specText, lightsOut);
  if (json) {
    process.stdout.write(JSON.stringify(v) + "\n");
  } else {
    process.stdout.write(JSON.stringify(v, null, 2) + "\n");
  }
  return v.admissible ? 0 : 1;
}

// faff dod classify — FAFF-34: classify a spec's DoD criteria by born-verifiability class (reusing
// classifyCriterion verbatim), for the evaluator to decide which it may machine-judge (scenario/assertion)
// vs force to needs-human (prose). Pure: file/stdin in, JSON out, no tracker/network/LLM.
// FAFF-275: `dod split` is a sibling action in this same namespace — see cmdDodSplit.
function cmdDod(args) {
  if (args.includes("--selftest")) return dodSelftest();
  const action = args.find((a) => !a.startsWith("--"));
  if (action === "split") return cmdDodSplit(args);
  const parsed = parseArgs(args, DOD_CLASSIFY_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "faff dod: usage:\n  faff dod classify --spec <path|-> [--issue <id>] [--json]\n  faff dod split --spec <path|-> --view builder|full");
  if (action !== "classify") {
    process.stderr.write("faff dod: usage:\n  faff dod classify --spec <path|-> [--issue <id>] [--json]\n  faff dod split --spec <path|-> --view builder|full\n");
    return 2;
  }
  const json = !!parsed.values["--json"];
  const specArg = parsed.values["--spec"] === undefined ? null : parsed.values["--spec"];
  let specText;
  try {
    if (specArg && specArg !== "-") specText = fs.readFileSync(specArg, "utf8");
    else specText = fs.readFileSync(0, "utf8");   // --spec - or no --spec → stdin
  } catch (e) {
    process.stderr.write(`faff dod classify: cannot read spec: ${e.message}\n`);
    return 2;
  }
  const issue = parsed.values["--issue"];
  if (issue !== undefined && !ISSUE_ID_RE.test(issue)) {
    process.stderr.write("faff dod classify: --issue must be a tracker id such as FAFF-1287\n");
    return 2;
  }
  const r = dodClassify(specText, { issue });
  process.stdout.write(JSON.stringify(r, null, json ? 0 : 2) + "\n");
  return 0;   // a successful parse is exit 0 (an empty criteria set is valid data the evaluator handles)
}

// faff dod split --spec <path|-> --view builder|full — FAFF-275: print the requested visibility
// view of a spec. `full` is the identity (byte-for-byte); `builder` removes each holdout-marked
// scenario unit (see dodSplit) and inserts one withheld-count note. Pure beyond the single
// file/stdin read (no tracker/network/LLM) — the over-withholding advisory (if any) is printed to
// stderr, never gating (exit stays 0). Exit 2: missing/unknown --view, or unreadable spec.
function cmdDodSplit(args) {
  const parsed = parseArgs(args, DOD_SPLIT_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "faff dod split: usage: faff dod split --spec <path|-> --view builder|full");
  const splitReqErr = requireFlags(parsed.values, DOD_SURFACE.subcommands.split, "dod", "split");
  const view = parsed.values["--view"] === undefined ? null : parsed.values["--view"];
  if (splitReqErr || (view !== "builder" && view !== "full")) {
    process.stderr.write("faff dod split: usage: faff dod split --spec <path|-> --view builder|full\n");
    return 2;
  }
  const specArg = parsed.values["--spec"] === undefined ? null : parsed.values["--spec"];
  let specText;
  try {
    if (specArg && specArg !== "-") specText = fs.readFileSync(specArg, "utf8");
    else specText = fs.readFileSync(0, "utf8");   // --spec - or no --spec → stdin
  } catch (e) {
    process.stderr.write(`faff dod split: cannot read spec: ${e.message}\n`);
    return 2;
  }
  const { text, warnings } = dodSplit(specText, view);
  process.stdout.write(text);
  for (const w of warnings) process.stderr.write(`faff dod split: ${w}\n`);
  return 0;
}

// In-memory selftest of dodClassify + classifyCriterion parity (mirrors admissible --selftest). No I/O.
function dodSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`dod --selftest FAIL: ${label}\n`); failed++; } };
  const spec = [
    "## Scenarios",
    "```",
    "Given a user is logged in",
    "When they click checkout",
    "Then the order is submitted",
    "```",
    "",
    "- The p99 latency MUST be < 200ms",
    "",
    "## 8. DONE",
    "",
    "### From WHY",
    "- [ ] Given X is set, When Y runs, Then Z holds",
    "- [ ] The API MUST return 200 on /healthz",
    "- [ ] The onboarding copy reads warmly",
  ].join("\n");
  const r = dodClassify(spec);
  check("a Given/When/Then unit → scenario", r.criteria.some((c) => c.class === "scenario"));
  check("a MUST/comparator unit → assertion", r.criteria.some((c) => c.class === "assertion"));
  check("anything else → prose", r.criteria.some((c) => c.class === "prose"));
  check("scenarios + done sources both present", r.criteria.some((c) => c.source === "scenarios") && r.criteria.some((c) => c.source === "done"));
  check("counts sum equals criteria length", r.counts.scenario + r.counts.assertion + r.counts.prose === r.criteria.length);
  check("classifyCriterion parity: Then → scenario", classifyCriterion("Then it happens") === "scenario");
  check("classifyCriterion parity: MUST → assertion", classifyCriterion("It MUST be fast") === "assertion");
  check("classifyCriterion parity: comparator → assertion", classifyCriterion("count = 5") === "assertion");
  check("classifyCriterion parity: plain prose → prose", classifyCriterion("It feels nice") === "prose");
  const empty = dodClassify("# Spec with no DoD sections\n\njust prose.\n");
  check("no DoD sections → empty criteria, parse still succeeds", empty.criteria.length === 0);
  // FAFF-300: the shared SCENARIOS_HEADING_RE means a numbered `### 5. SCENARIOS`
  // heading (the producer's own form) is recognised by dodClassify, not just by admissible.
  const numbered = dodClassify("### 5. SCENARIOS\n```\nGiven x\nWhen y\nThen z\n```\n\n### 8. DONE\n- [ ] the parser returns >=1 item\n");
  check("numbered `### N. SCENARIOS` heading → scenarios source recognised", numbered.criteria.some((c) => c.source === "scenarios"));
  // FAFF-306: a `## Scenarios` (h2) followed by a DEEPER `### N. DONE` (h3) must NOT over-capture
  // past the DONE heading — the DONE heading line, the trailing `confidence:` line, and the
  // `faff-contract:` block must never become phantom `prose` criteria, and DONE items must not be
  // double-counted under `source:"scenarios"`. Correcting only the heading level must not change the result.
  const mmUnnumbered = [
    "## Scenarios", "",
    "```", "Given a user is logged in", "When they checkout", "Then the order is submitted", "```", "",
    "### 2. DONE", "",
    "- [ ] The API MUST return 200 on /healthz",
    "",
    "confidence: high", "",
    "```faff-contract:spec-readiness", '{ "confidence": "high" }', "```", "",
  ].join("\n");
  const mmNumbered = mmUnnumbered.replace(/^## Scenarios/m, "### 1. SCENARIOS");
  const mmU = dodClassify(mmUnnumbered), mmN = dodClassify(mmNumbered);
  check("FAFF-306: h2-Scenarios/h3-DONE → no phantom prose (DONE heading/confidence/contract excluded)", mmU.counts.prose === 0);
  check("FAFF-306: DONE items not double-counted (source scenarios holds only the real GWT)", mmU.criteria.filter((c) => c.source === "scenarios").length === 1 && mmU.criteria.filter((c) => c.source === "done").length === 1);
  check("FAFF-306: classification is identical whether SCENARIOS is h2 or h3 (heading level no longer matters)", JSON.stringify(mmU) === JSON.stringify(mmN));
  check("FAFF-306: parseScenarios count == dod source:scenarios scenario count (cross-parser agreement)", parseScenarios(mmUnnumbered) === mmU.criteria.filter((c) => c.source === "scenarios" && c.class === "scenario").length);

  // --- FAFF-275: holdout marker + `dod split` ---
  const holdoutSpec = [
    "## Scenarios", "",
    "```holdout",
    "Given a fenced holdout scenario",
    "When it runs",
    "Then it is withheld from the builder",
    "```", "",
    "```",
    "Given a plain visible scenario",
    "When it runs",
    "Then it is NOT withheld",
    "```", "",
    "- holdout: The p99 latency MUST be < 200ms",
    "- The onboarding copy reads warmly",
    "",
    "## 8. DONE", "",
    "- [ ] the parser returns >=1 item",
  ].join("\n");
  const hc = dodClassify(holdoutSpec);
  const scenarioCriteria = hc.criteria.filter((c) => c.source === "scenarios");
  check("FAFF-275: fenced-holdout GWT criterion → holdout true", scenarioCriteria.some((c) => c.class === "scenario" && c.holdout === true && /withheld from the builder/.test(c.text)));
  check("FAFF-275: plain-fence GWT criterion → holdout false", scenarioCriteria.some((c) => c.class === "scenario" && c.holdout === false && /NOT withheld/.test(c.text)));
  check("FAFF-275: `holdout:` bullet → prefix stripped, class assertion, holdout true", scenarioCriteria.some((c) => c.text === "The p99 latency MUST be < 200ms" && c.class === "assertion" && c.holdout === true));
  check("FAFF-275: unmarked bullet → holdout false", scenarioCriteria.some((c) => /onboarding copy/.test(c.text) && c.holdout === false));
  check("FAFF-275: holdout_counts sums to criteria.length, holdout+visible split correct", hc.holdout_counts.holdout + hc.holdout_counts.visible === hc.criteria.length && hc.holdout_counts.holdout === 2);
  check("FAFF-275: counts is UNCHANGED shape and still sums to criteria.length", hc.counts.scenario + hc.counts.assertion + hc.counts.prose === hc.criteria.length);

  const builderView = dodSplit(holdoutSpec, "builder");
  check("FAFF-275: dod split --view full is the identity (byte-for-byte)", dodSplit(holdoutSpec, "full").text === holdoutSpec);
  check("FAFF-275: dod split --view builder omits the fenced-holdout block", !/withheld from the builder/.test(builderView.text));
  check("FAFF-275: dod split --view builder omits the holdout bullet", !/p99 latency/.test(builderView.text));
  check("FAFF-275: dod split --view builder retains the visible scenario + bullet", /NOT withheld/.test(builderView.text) && /onboarding copy/.test(builderView.text));
  check("FAFF-275: dod split --view builder inserts the withheld-count note under the Scenarios heading", /^## Scenarios\n\n> 2 holdout scenario\(s\) withheld/.test(builderView.text));
  check("FAFF-275: dod split --view builder retains the DONE section untouched", /## 8\. DONE[\s\S]*the parser returns >=1 item/.test(builderView.text));

  // Coherence invariant: dodClassify(dodSplit(spec, builder)) == full classification minus the holdout criteria.
  const bviewClassified = dodClassify(builderView.text);
  const expectedRemaining = hc.criteria.filter((c) => !c.holdout);
  // FAFF-1259: `id` numbers a spec's own criteria, so the builder view renumbers its survivors; the invariant compares everything else.
  const withoutId = (list) => JSON.stringify(list.map(({ id, ...rest }) => rest));
  check("FAFF-275 coherence invariant: builder-view classification == full minus holdout criteria", withoutId(bviewClassified.criteria) === withoutId(expectedRemaining));
  check("FAFF-1259: criterion ids are <source>:<n>, numbered per source in classify order", hc.criteria.every((c, i, all) => c.id === `${c.source}:${all.slice(0, i + 1).filter((x) => x.source === c.source).length}`));
  check("FAFF-275 coherence invariant: builder-view holdout_counts.holdout is 0", bviewClassified.holdout_counts.holdout === 0);

  // A marker-free spec's builder view MUST be a byte-identical no-op.
  const noMarkerSpec = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  check("FAFF-275: no-marker spec → builder view is byte-identical to the input", dodSplit(noMarkerSpec, "builder").text === noMarkerSpec);

  // A marker OUTSIDE the Scenarios section is not recognised — no flag, no strip, no removal.
  const markerOutside = "## Scenarios\n```\nGiven x\nThen y\n```\n\n## 8. DONE\n\n- [ ] holdout: the parser returns >=1 item\n";
  const outsideClassified = dodClassify(markerOutside);
  check("FAFF-275: a `holdout:`-prefixed DONE item stays literal (not stripped), holdout false", outsideClassified.criteria.some((c) => c.source === "done" && c.text === "holdout: the parser returns >=1 item" && c.holdout === false));
  check("FAFF-275: dod split never removes a DONE-section holdout-prefixed item", dodSplit(markerOutside, "builder").text === markerOutside);

  // ~~~ fences are recognised too, matching the shared fence recognisers.
  const tildeSpec = "## Scenarios\n\n~~~holdout\nGiven x\nWhen y\nThen z\n~~~\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const tildeClassified = dodClassify(tildeSpec);
  check("FAFF-275: ~~~holdout fence recognised same as ```holdout", tildeClassified.criteria.some((c) => c.source === "scenarios" && c.holdout === true));
  check("FAFF-275: dod split removes a ~~~holdout fence", !/Given x/.test(dodSplit(tildeSpec, "builder").text));

  // Over-withholding: builder view retains ZERO born-verifiable scenarios-section criteria while
  // the full spec had >= 1 → advisory warning, never a gate (dodSplit still succeeds, just warns).
  const allHoldoutSpec = "## Scenarios\n```holdout\nGiven x\nWhen y\nThen z\n```\n\n## 8. DONE\n\n- [ ] the parser returns >=1 item\n";
  const allHoldoutSplit = dodSplit(allHoldoutSpec, "builder");
  check("FAFF-275: over-withholding fires an advisory warning (never a gate)", allHoldoutSplit.warnings.length >= 1 && /over-withholding/.test(allHoldoutSplit.warnings[0]));

  // Marked-vs-unmarked parity: `faff admissible` on the FULL spec is marker-blind (a holdout-marked
  // scenario counts toward R1 exactly as unmarked — fence info never mattered to parseScenarios).
  const unmarkedEquivalent = holdoutSpec.replace(/```holdout/, "```").replace(/- holdout: /, "- ");
  const vMarked = admissibleVerdict(holdoutSpec, true), vUnmarked = admissibleVerdict(unmarkedEquivalent, true);
  check("FAFF-275: marked-vs-unmarked admissible parity (same admissible verdict + reasons)", vMarked.admissible === vUnmarked.admissible && JSON.stringify(vMarked.reasons) === JSON.stringify(vUnmarked.reasons));

  // --- FAFF-812: born-verifiability oracle lint ---
  // The observed miss: an internal-code prohibition with no HTTP oracle read as a clean assertion.
  const oracleLessSpec = [
    "## Scenarios", "",
    "```", "Given a user is logged in", "When they click checkout", "Then the order is submitted", "```", "",
    "- The API MUST return 200 on /healthz",
    "- no timestamp comparison MUST happen in the api",
    "",
    "## 8. DONE", "",
    "- [ ] the parser returns >=1 item",
  ].join("\n");
  const olc = dodClassify(oracleLessSpec);
  const healthzCrit = olc.criteria.find((c) => /healthz/.test(c.text));
  const timestampCrit = olc.criteria.find((c) => /timestamp comparison/.test(c.text));
  const scenarioCrit812 = olc.criteria.find((c) => c.source === "scenarios" && c.class === "scenario");
  check("FAFF-812: observed miss — internal-code prohibition classifies assertion + oracle_less true", timestampCrit && timestampCrit.class === "assertion" && timestampCrit.oracle_less === true);
  check("FAFF-812: regression — observable-MUST assertion classifies assertion + oracle_less false", healthzCrit && healthzCrit.class === "assertion" && healthzCrit.oracle_less === false);
  check("FAFF-812: regression — a GWT scenario keeps class scenario and oracle_less false", scenarioCrit812 && scenarioCrit812.oracle_less === false);
  check("FAFF-812: oracle_less is false for every non-assertion criterion", olc.criteria.every((c) => c.class === "assertion" || c.oracle_less === false));
  check("FAFF-812: oracle_less_count equals the number of oracle_less==true criteria", olc.oracle_less_count === olc.criteria.filter((c) => c.oracle_less).length && olc.oracle_less_count === 1);
  check("FAFF-812: counts is UNCHANGED shape and still sums to criteria.length (no regression)", olc.counts.scenario + olc.counts.assertion + olc.counts.prose === olc.criteria.length);
  check("FAFF-812: hasObservableOracle direct parity — internal-subject marker + no observable token → false", hasObservableOracle("no timestamp comparison MUST happen in the api") === false);
  check("FAFF-812: hasObservableOracle direct parity — observable token present → true", hasObservableOracle("The API MUST return 200 on /healthz") === true);
  const olAdv = oracleLessAdvisory(oracleLessSpec);
  check("FAFF-812: oracleLessAdvisory returns the flagged criterion when >=1 oracle-less assertion exists", olAdv && olAdv.count === 1 && /timestamp comparison/.test(olAdv.items[0].text));
  check("FAFF-812: oracleLessAdvisory returns null when there are zero oracle-less assertions", oracleLessAdvisory(ADMISSIBLE_GOOD) === null);
  check("FAFF-812: renderOracleLessWarning renders the deterministic prefixed line", /^oracle-less-assertion advisory: 1 assertion\(s\) name no observable oracle/.test(renderOracleLessWarning(olAdv)));
  check("FAFF-812: the lint never flips the admissible verdict (advisory only)", admissibleVerdict(oracleLessSpec, true).admissible === true);

  // --- FAFF-961: verification-tier tagging (integration tier) ---
  const tierSpec = [
    "## Scenarios", "",
    "```integration", "Given a migrated database", "When the down-migration runs", "Then the schema reverts", "```", "",
    "- The rollback MUST restore the previous schema",
    "- integration: the reverse migration MUST succeed",
    "- The API MUST return 200 on /healthz",
    "",
    "## 8. DONE", "",
    "- [ ] the parser returns >=1 item",
  ].join("\n");
  const tc = dodClassify(tierSpec);
  const fenceCrit = tc.criteria.find((c) => c.source === "scenarios" && c.class === "scenario");
  const rollbackCrit = tc.criteria.find((c) => /rollback/.test(c.text));
  const prefixCrit = tc.criteria.find((c) => /reverse migration/.test(c.text));
  const healthzTierCrit = tc.criteria.find((c) => /healthz/.test(c.text));
  check("FAFF-961: an integration fence tiers integration with class unchanged (scenario)", fenceCrit && fenceCrit.verification_tier === "integration" && fenceCrit.class === "scenario");
  check("FAFF-961: an unmarked 'rollback' assertion tiers integration via the keyword heuristic", rollbackCrit && rollbackCrit.verification_tier === "integration");
  check("FAFF-961: an 'integration:' bullet prefix tiers integration and strips the prefix from text", prefixCrit && prefixCrit.verification_tier === "integration" && !/^integration:/i.test(prefixCrit.text));
  check("FAFF-961: an unmarked running-stack assertion keeps the conservative running-stack default", healthzTierCrit && healthzTierCrit.verification_tier === "running-stack");
  check("FAFF-961: every criterion resolves to a legal tier value", tc.criteria.every((c) => c.verification_tier === "running-stack" || c.verification_tier === "integration" || c.verification_tier === "delegated"));
  check("FAFF-961: verification_tier_counts sums to criteria.length", tc.verification_tier_counts["running-stack"] + tc.verification_tier_counts.integration + tc.verification_tier_counts.delegated === tc.criteria.length);
  const dtc = dodClassify(["## Scenarios", "", "- The API MUST return 200", "- a loose prose line", "", "## 8. DONE", "", "- [ ] the rollback must restore the previous release", "- [ ] operators like the dashboard", "- [ ] rollback is smooth"].join("\n"));
  check("FAFF-1291: a prose DONE item tiers delegated with verifier ac-checklist, even when it names a rollback", dtc.criteria.filter((c) => c.verification_tier === "delegated").every((c) => c.source === "done" && c.class === "prose" && c.verifier === "ac-checklist") && dtc.verification_tier_counts.delegated === 2);
  check("FAFF-1291: a prose Scenarios unit stays running-stack with verifier holdout", dtc.criteria.some((c) => c.source === "scenarios" && c.class === "prose" && c.verification_tier === "running-stack" && c.verifier === "holdout"));
  check("FAFF-1291: judged_count / integration_count / delegated_count", dtc.judged_count === 2 && dtc.integration_count === 1 && dtc.delegated_count === 3);
  check("FAFF-961: counts is UNCHANGED shape and still sums to criteria.length (no regression)", tc.counts.scenario + tc.counts.assertion + tc.counts.prose === tc.criteria.length);
  check("FAFF-961: the tier axis never perturbs holdout_counts or oracle_less_count shape", tc.holdout_counts.holdout + tc.holdout_counts.visible === tc.criteria.length && typeof tc.oracle_less_count === "number");
  check("FAFF-961: precedence — a 'rollback' inside a running-stack context still tiers integration by keyword", resolveVerificationTier("The rollback MUST restore the schema", null) === "integration");
  check("FAFF-961: precedence — an explicit marker wins even when no keyword is present", resolveVerificationTier("the endpoint returns 200", "integration") === "integration");
  check("FAFF-961: a bare 'migration'/'database' mention is NOT integration (running-stack default holds)", resolveVerificationTier("the migration applies and the database has the row", null) === "running-stack");
  check("FAFF-961: a marker-free spec assigns running-stack to every criterion", dodClassify(ADMISSIBLE_GOOD).criteria.every((c) => c.verification_tier === "running-stack"));
  // --- FAFF-1360: code-surface DONE items go to the test floor ---
  const doneCrit = (t) => ({ source: "done", class: "assertion", text: t });
  const d3 = "`test/faff-1353-write-core-issue-scoped.test.mjs` and `test/events.test.mjs` pass unmodified, and `faff events append` with `{\"phase\":\"run\",\"type\":\"decision-capture\",\"issue\":\"\"}` still exits 1 with one `- <violation>` stderr line per violation.";
  const d8 = "A non-schema append failure still produces `journal append failed: <message>`: called with `{code: \"EVENTS_LOCKED\", message: \"m\"}`, `reportAppendFailure` writes a note whose reason is `journal append failed: m`. Export `reportAppendFailure` and `lineSafe` for the unit tests, as `effects-reconcile.js` exports `sanitizeDetail`.";
  const signalCases = [
    [d3, "test-file"], [d8, "export"],
    ["`pkg/store_test.go` MUST pass", "test-file"],
    ["`parseLimit` and `formatLimit` are exported from `lib/limit.js`, and `parseLimit` MUST reject a negative limit", "export"],
    ["The exported `runShardedRung`'s new `concurrency` parameter defaults to single-wave", "export"],
    ["the `summary` field is exported to the CSV", null],
    ["The CSV export `path` MUST default to stdout", null],
    ["Export `results` to a CSV after the run.", null],
    ["On success: export `summary` to stdout.", null],
    ["`faff export` MUST write `out.json`", null],
    ["the CSV export `report.csv` MUST have a header row", null],
    ["the service MUST answer 200 on `http://app.test.internal/healthz`", null],
    ["\u0001ID\u0001 is exported from x", null],
    ["`faff events append` MUST exit 1 on an empty issue", null],
    ["`test/decision-capture.test.mjs:172-215` MUST pass", "test-file"],
  ];
  for (const [t, want] of signalCases) check(`FAFF-1360: codeSurfaceSignal(${JSON.stringify(t.slice(0, 40))}) === ${want}`, codeSurfaceSignal(t) === want);
  check("FAFF-1360: an explicit marker beats a code-surface DONE item", resolveVerificationTier("`a.test.mjs` MUST pass", "running-stack", doneCrit("x")) === "running-stack");
  check("FAFF-1360: a prose DONE item naming a test file stays delegated", resolveVerificationTier("`a.test.mjs` pass", null, { source: "done", class: "prose" }) === "delegated");
  check("FAFF-1360: a Scenarios unit naming a test file stays running-stack", resolveVerificationTier("`a.test.mjs` MUST pass", null, { source: "scenarios", class: "assertion" }) === "running-stack");
  check("FAFF-1360: no criterion argument keeps today's result", resolveVerificationTier("`a.test.mjs` MUST pass", null) === "running-stack");
  check("FAFF-1360: a code-surface assertion DONE item is integration", resolveVerificationTier(d3, null, doneCrit(d3)) === "integration");
  const cliOnly = dodClassify(["## Scenarios", "", "- `test/a.test.mjs` MUST pass", "", "## 8. DONE", "", "- [ ] `faff events append` MUST exit 1 on an empty issue", ""].join("\n"));
  check("FAFF-1360: a CLI-only DONE item and a Scenarios test-file unit stay running-stack/holdout", cliOnly.criteria.length === 2 && cliOnly.criteria.every((c) => c.verification_tier === "running-stack" && c.verifier === "holdout"));
  const holdoutPrefixed = dodClassify(["## Scenarios", "", "- `faff x` MUST exit 0", "", "## 8. DONE", "", "- [ ] holdout: `x.test.mjs` MUST pass", ""].join("\n"));
  const hp = holdoutPrefixed.criteria.find((c) => c.source === "done");
  check("FAFF-1360: a holdout:-prefixed DONE item keeps its text, holdout false, and is integration", hp && hp.text.startsWith("holdout:") && hp.holdout === false && hp.verification_tier === "integration");
  const lineRange = dodClassify(["## Scenarios", "", "- `faff x` MUST exit 0", "", "## 8. DONE", "", "- [ ] `test/decision-capture.test.mjs:172-215` MUST pass", ""].join("\n"));
  check("FAFF-1360: a test-file token with a line range is integration", lineRange.criteria.find((c) => c.source === "done").verification_tier === "integration");

  if (failed) { console.log(`dod --selftest: FAIL (${failed} failed)`); return 1; }
  console.log("dod --selftest: ok"); return 0;
}

// faff holdout verdicts — FAFF-277: the pure, trust-gated bridge from the evaluator's persisted holdout
// verdicts (`.faff/holdout/<key>.json`) to the already-shipped `faff prdr coverage --dod-verdicts` flag.
// Reads each verdict, re-validates it through the SAME `computeHoldoutVerdict` gate (never a forked rule),
// translates a passing `meets-spec` → the literal `met`, folds conservatively per PRDR, and emits the
// `{prdr-id: value}` map keyed by the supplied issue→PRDR association. Pure: filesystem read of --dir +
// args only (no tracker/network/LLM) — parity with `dod classify` / `prdr coverage`.
function cmdHoldout(args) {
  if (args.includes("--selftest")) return holdoutVerdictsSelftest();
  const action = args.find((a) => !a.startsWith("--"));
  if (action === "verdict") return cmdHoldoutVerdict(args);   // FAFF-311: the singular per-issue graft gate
  if (action === "record") return cmdHoldoutRecord(args);     // FAFF-1259: the one writer of the v0.3 holdout record
  const parsed = parseArgs(args, HOLDOUT_VERDICTS_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "faff holdout: usage:\n  faff holdout verdicts --association <json|@file|-> [--dir .faff/holdout] [--json]\n  faff holdout verdict --issue <id> [--dir .faff/holdout] [--json]\n  faff holdout record --issue <id> --spec <path> [--key <k>] [--run-dir <dir>] [--credentials-env <VAR>] [--json]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  if (action !== "verdicts") {
    process.stderr.write("faff holdout: usage:\n  faff holdout verdicts --association <json|@file|-> [--dir .faff/holdout] [--json]\n  faff holdout verdict --issue <id> [--dir .faff/holdout] [--json]\n  faff holdout record --issue <id> --spec <path> [--key <k>] [--run-dir <dir>] [--credentials-env <VAR>] [--json]\n");
    return 2;
  }
  // --association (required): inline JSON, @path, or - for stdin. A broken association is operator error
  // (fail-loud exit 2), NOT a silent empty map.
  const assocRaw = get("--association");
  const assocReqErr = requireFlags(parsed.values, HOLDOUT_SURFACE.subcommands.verdicts, "holdout", "verdicts");
  if (assocReqErr) { process.stderr.write(assocReqErr + " (JSON object { holdout-key: prdr-id }, @path, or - for stdin)\n"); return 2; }
  let assocText;
  try {
    if (assocRaw === "-") assocText = fs.readFileSync(0, "utf8");
    else if (assocRaw.startsWith("@")) assocText = fs.readFileSync(assocRaw.slice(1), "utf8");
    else assocText = assocRaw;
  } catch (e) { process.stderr.write(`faff holdout verdicts: cannot read --association: ${e.message}\n`); return 2; }
  let association;
  try { association = JSON.parse(assocText); } catch (e) { process.stderr.write(`faff holdout verdicts: --association is not valid JSON: ${e.message}\n`); return 2; }
  if (association === null || typeof association !== "object" || Array.isArray(association)) {
    process.stderr.write("faff holdout verdicts: --association must be a JSON object { holdout-key: prdr-id }\n"); return 2;
  }
  const dir = get("--dir") || ".faff/holdout";
  // Read the store. An ABSENT dir (ENOENT) is the valid "nothing trusted yet" case → empty map, exit 0
  // (coverage already handles it). An UNREADABLE dir (a file, a permission error) is operator error → exit 2.
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch (e) {
    if (e.code === "ENOENT") names = [];
    else { process.stderr.write(`faff holdout verdicts: cannot read --dir ${JSON.stringify(dir)}: ${e.message}\n`); return 2; }
  }
  const files = names.map((name) => {
    const key = name.slice(0, -".json".length);
    try { return { key, text: fs.readFileSync(path.join(dir, name), "utf8") }; }
    catch { return { key, unreadable: true }; }
  });
  // FAFF-384: --require-spawner-attested arms the spawner-attestation ratchet inside the shared trust gate.
  // The caller (the run bridge) sets it iff the run's lane-boundary intent promised the evaluator cage.
  const requireSpawnerAttested = args.includes("--require-spawner-attested");
  const out = computeHoldoutVerdictsMap(association, files, { requireSpawnerAttested });
  // FAFF-953: --persist writes each trust-gated verdict onto its PRDR record, so a cold
  // `faff prdr coverage` on the mainline reproduces the run's verdict. The value written is
  // out.verdicts (the gate output of computeHoldoutVerdictsMap), never a caller-supplied
  // literal, so a hand-authored `met` can never reach a record through this path. A verdict
  // whose record is absent in --prdr-dir is reported to stderr, never silently dropped.
  if (args.includes("--persist")) {
    const prdrDir = get("--prdr-dir");
    if (!prdrDir) { process.stderr.write("faff holdout verdicts --persist: requires --prdr-dir <dir>\n"); return 2; }
    const { setPrdrDodVerdict } = require("./prdr");
    const persisted = [], missing = [];
    for (const [id, verdict] of Object.entries(out.verdicts)) {
      (setPrdrDodVerdict(prdrDir, id, verdict) ? persisted : missing).push(id);
    }
    out.persisted = persisted;
    if (missing.length) { out.persist_missing = missing; process.stderr.write(`faff holdout verdicts --persist: no PRDR record for ${missing.join(", ")} in ${prdrDir}\n`); }
  }
  const json = args.includes("--json");   // accepted for symmetry with `dod classify`; output is always JSON
  process.stdout.write(JSON.stringify(out, null, json ? 0 : 2) + "\n");
  // The skipped audit trail also goes to stderr so a missing/untrusted PRDR is visible, never silent.
  if (out.skipped.length) {
    process.stderr.write(`faff holdout verdicts: skipped ${out.skipped.length} file(s): ${out.skipped.map((s) => `${s.key}(${s.reason})`).join(", ")}\n`);
  }
  return 0;   // report-only (parity with coverage/yagni): an empty map is a valid conservative answer, exit 0
}

// faff holdout verdict --issue <id> — FAFF-311: the per-issue merge-floor GATE lookup for `faff-graft`
// Step 10 (Decision 4 → Option A, persist-once/consume-twice). Reads the SINGLE per-issue verdict
// `.faff/holdout/<id>.json`, re-validates it through the SAME `computeHoldoutVerdict` gate (never a forked
// rule — via holdoutGateResult), and reduces it to a pass/block decision keyed to the issue being built,
// BEFORE the FAFF-277 PRDR fold. Fail-closed: a missing/unreadable/malformed/non-blind/incoherent verdict,
// or any aggregate ≠ meets-spec, is `block` (exit 1) — never a silent pass. Exit 0 = pass, 1 = block,
// 2 = usage. PURE beyond the single-file read (no tracker/network/LLM). The same file still feeds the
// unchanged `faff holdout verdicts --association` run roll-up (one artifact, two consumers).
function cmdHoldoutVerdict(args) {
  const parsed = parseArgs(args, HOLDOUT_VERDICT_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "faff holdout verdict: usage: faff holdout verdict --issue <id> [--dir .faff/holdout] [--json]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const issue = get("--issue");
  const issueReqErr = requireFlags(parsed.values, HOLDOUT_SURFACE.subcommands.verdict, "holdout", "verdict");
  if (issueReqErr) { process.stderr.write(issueReqErr + "\n"); return 2; }
  // The issue id is a filename component — a safe ticket token only (letters/digits/._-, no leading dash).
  // Reject anything else (path separators, `..`, a stray flag captured as the value) so `--issue` can never
  // traverse out of --dir; usage error (exit 2), never a silent read of an unintended path.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) {
    process.stderr.write(`faff holdout verdict: --issue ${JSON.stringify(issue)} is not a valid issue id (letters/digits/._- only, no path separators)\n`); return 2;
  }
  const dir = get("--dir") || ".faff/holdout";
  const file = path.join(dir, `${issue}.json`);
  const json = args.includes("--json");
  const emit = (res, status) => {
    process.stdout.write(JSON.stringify({ issue, ...res }, null, json ? 0 : 2) + "\n");
    if (res.gate === "block") process.stderr.write(`faff holdout verdict: ${issue} BLOCKED (${res.reason})\n`);
    return status;
  };
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return emit({ gate: "block", reason: e.code === "ENOENT" ? "missing" : "unreadable", detail: e.message }, 1); }
  let block;
  try { block = JSON.parse(text); }
  catch (e) { return emit({ gate: "block", reason: "unreadable", detail: e.message }, 1); }
  // FAFF-384: --require-spawner-attested arms the spawner-attestation ratchet inside the SAME trust gate.
  // faff-graft Step-10 sets it iff the run's lane-boundary intent promised the evaluator cage; absent, the
  // gate is byte-for-byte today's per-issue behaviour (legacy uncaged runs unaffected).
  const requireSpawnerAttested = args.includes("--require-spawner-attested");
  const res = holdoutGateResult(block, { requireSpawnerAttested });
  return emit(res, res.gate === "pass" ? 0 : 1);
}

// faff holdout record — FAFF-1259: pipe the evaluator's holdout block through the one shared writer
// (holdout-record.js) and persist the v0.3 `holdout-anchored` record. Exit 0 = accepted, 1 = refused (a
// fail-closed `needs-human` record is still written, because an absent holdout verdict reads as "did not
// run" at every consumer), 2 = usage / path guard / identity guard / IO fault (nothing further written).
function parseHoldoutBlock(text) {
  try { return JSON.parse(text); } catch { /* fall through to the fenced form */ }
  const fences = [...text.matchAll(/^```faff-contract:holdout-verdict[ \t]*\r?\n([\s\S]*?)\r?\n```/gm)];
  if (fences.length !== 1) return null;
  try { return JSON.parse(fences[0][1]); } catch { return null; }
}

function holdoutRunDirContained(root, runDirArg) {
  const abs = path.resolve(runDirArg);
  const mainRoot = mainWorktreeRoot(root);
  for (const top of [root, mainRoot].filter(Boolean)) {
    const base = path.join(top, ".faff", "runs");
    let rel = path.relative(base, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
      rel = path.relative(real(base), real(abs));
    }
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const contained = resolveContained(base, rel);
    if (contained) return contained;
  }
  return null;
}

function cmdHoldoutRecord(args) {
  const usage = "faff holdout record: usage: faff holdout record --issue <id> --spec <path> [--key <k>] [--run-dir <dir>] [--credentials-env <VAR>] [--json]  (evaluator block on stdin)";
  const parsed = parseArgs(args, HOLDOUT_RECORD_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, usage);
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const reqErr = requireFlags(parsed.values, HOLDOUT_SURFACE.subcommands.record, "holdout", "record");
  if (reqErr) { process.stderr.write(reqErr + "\n"); return 2; }
  const issue = get("--issue");
  const key = get("--key") || issue;
  const specArg = get("--spec");
  if (specArg === "-") {
    process.stderr.write("faff holdout record: --spec must be a file path; - is refused because the evaluator block arrives on stdin\n");
    return 2;
  }
  for (const [flag, value] of [["--issue", issue], ["--key", key]]) {
    if (!isSafeHoldoutKey(value)) {
      process.stderr.write(`faff holdout record: ${flag} ${JSON.stringify(value)} is not a valid id (letters/digits/._- only, no path separators)\n`);
      return 2;
    }
  }
  const root = findRoot();
  const storeFile = resolveContained(path.join(root, ".faff", "holdout"), `${key}.json`);
  if (!storeFile) { process.stderr.write("faff holdout record: the store path resolves outside .faff/holdout/\n"); return 2; }
  let runFile = null;
  const runDirArg = get("--run-dir");
  if (runDirArg) {
    const runDir = holdoutRunDirContained(root, runDirArg);
    if (!runDir) { process.stderr.write("faff holdout record: --run-dir resolves outside .faff/runs/ (or through a symlink)\n"); return 2; }
    const issueDir = resolveContained(runDir, issue);
    if (!issueDir) { process.stderr.write("faff holdout record: the run copy directory is not contained in --run-dir\n"); return 2; }
    runFile = path.join(issueDir, "holdout.json");
  }
  const extraSecrets = [];
  const credentialsEnv = get("--credentials-env");
  if (credentialsEnv !== null) {
    const raw = /^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialsEnv) ? process.env[credentialsEnv] : undefined;
    let credentials;
    try { credentials = raw ? JSON.parse(raw) : undefined; } catch { credentials = undefined; }
    if (credentials === null || typeof credentials !== "object" || Array.isArray(credentials)) {
      process.stderr.write("faff holdout record: --credentials-env must name an environment variable holding a JSON object\n");
      return 2;
    }
    if (credentials.scheme === "bearer" && typeof credentials.token === "string" && credentials.token) extraSecrets.push(credentials.token);
  }
  let existing = null;
  try { existing = fs.readFileSync(storeFile, "utf8"); } catch (e) { if (e.code !== "ENOENT") { process.stderr.write(`faff holdout record: cannot read the existing store file: ${e.message}\n`); return 2; } }
  let unparseable = false;
  if (existing !== null) {
    let prior = null;
    try { prior = JSON.parse(existing); } catch { unparseable = true; }
    if (prior && typeof prior === "object" && typeof prior.issue === "string" && prior.issue !== issue) {
      process.stderr.write(`faff holdout record: ${path.relative(root, storeFile)} already records a different issue; refusing to overwrite it\n`);
      return 2;
    }
  }
  let built;
  try {
    let stdin = "";
    try { stdin = fs.readFileSync(0, "utf8"); } catch { /* no stdin reads as an unparseable block */ }
    // FAFF-1291: classify the full-view spec the evaluator received; the writer checks the block against it.
    // An unreadable spec leaves `classified` null, and the writer refuses fail-closed (no classify output).
    let classified = null;
    try { classified = dodClassify(fs.readFileSync(specArg, "utf8"), ISSUE_ID_RE.test(issue) ? { issue } : undefined); } catch { classified = null; }
    built = buildHoldoutRecord(parseHoldoutBlock(stdin), { issue, extraSecrets, classified });
  } catch (e) { process.stderr.write(`faff holdout record: cannot build the record: ${e.message}\n`); return 2; }
  try {
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    if (unparseable) fs.renameSync(storeFile, `${storeFile}.unparseable-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    writeHoldoutRecord(storeFile, built.bytes);
    if (runFile) {
      fs.mkdirSync(path.dirname(runFile), { recursive: true });
      writeHoldoutRecord(runFile, built.bytes);
    }
  } catch (e) { process.stderr.write(`faff holdout record: write failed: ${e.message}\n`); return 2; }
  if (!built.ok) process.stderr.write(`faff holdout record: block REFUSED (fail-closed record written):\n${built.refusals.map((r) => `  - ${r}`).join("\n")}\n`);
  if (args.includes("--json")) process.stdout.write(built.bytes);
  else process.stdout.write(`faff holdout record: ${built.ok ? "accepted" : "refused"} -> ${[storeFile, runFile].filter(Boolean).map((f) => path.relative(root, f)).join(", ")}\n`);
  return built.ok ? 0 : 1;
}

// In-memory selftest of computeHoldoutVerdictsMap + holdoutGateResult — the gate + translate + conservative
// fold + the singular per-issue gate (mirrors dod --selftest; the map/gate fns are pure).
function holdoutVerdictsSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`holdout --selftest FAIL: ${label}\n`); failed++; } };
  const block = (aggregate, verdict, code_blind = true) => JSON.stringify({
    aggregate, code_blind,
    criteria: [{ class: "assertion", verdict, evidence_present: true }],
    violations: [],
  });
  const meets = block("meets-spec", "met");
  const fails = block("fails", "unmet");

  // 1. conformant meets-spec + association → {prdr:"met"}
  const r1 = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: meets }]);
  check("conformant meets-spec → {prdr:met}", JSON.stringify(r1.verdicts) === JSON.stringify({ "0007": "met" }) && r1.skipped.length === 0);

  // 2. code_blind:false → PRDR absent, skipped contract-rejected
  const r2 = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: block("meets-spec", "met", false) }]);
  check("code_blind:false → absent + contract-rejected", !("0007" in r2.verdicts) && r2.skipped.some((s) => s.key === "FAFF-34" && s.reason === "contract-rejected"));

  // 3. conformant fails → verdicts[prdr]=="fails" (≠ met)
  const r3 = computeHoldoutVerdictsMap({ "FAFF-B": "0008" }, [{ key: "FAFF-B", text: fails }]);
  check("conformant fails → 'fails' (≠ met)", r3.verdicts["0008"] === "fails");

  // 4. empty dir → {}
  const r4 = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, []);
  check("empty files → {} verdicts", Object.keys(r4.verdicts).length === 0);

  // 5. conservative fold: meets-spec + fails on one PRDR → not met
  const r5 = computeHoldoutVerdictsMap({ "FAFF-A": "0007", "FAFF-B": "0007" }, [{ key: "FAFF-A", text: meets }, { key: "FAFF-B", text: fails }]);
  check("two files one PRDR (meets+fails) → not met", r5.verdicts["0007"] !== "met" && r5.verdicts["0007"] === "fails");

  // 6. fold: met + met on one PRDR → met
  const r6 = computeHoldoutVerdictsMap({ "FAFF-A": "0007", "FAFF-C": "0007" }, [{ key: "FAFF-A", text: meets }, { key: "FAFF-C", text: meets }]);
  check("two files one PRDR (met+met) → met", r6.verdicts["0007"] === "met");

  // 7. no association entry → skipped no-association, contributes nothing
  const r7 = computeHoldoutVerdictsMap({}, [{ key: "FAFF-X", text: meets }]);
  check("no-association → skipped, nothing contributed", Object.keys(r7.verdicts).length === 0 && r7.skipped.some((s) => s.reason === "no-association"));

  // 8. unreadable / malformed JSON → skipped unreadable
  const r8 = computeHoldoutVerdictsMap({ "FAFF-A": "0007", "FAFF-B": "0007" }, [{ key: "FAFF-A", unreadable: true }, { key: "FAFF-B", text: "{not json" }]);
  check("unreadable + malformed → skipped unreadable, never met", !("0007" in r8.verdicts) && r8.skipped.filter((s) => s.reason === "unreadable").length === 2);

  // 9. trusted non-'met' passes through as its own string (gaps/needs-human are ≠ met)
  const r9 = computeHoldoutVerdictsMap({ "FAFF-G": "0009" }, [{ key: "FAFF-G", text: JSON.stringify({ aggregate: "gaps", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] }) }]);
  check("trusted 'gaps' passes through (≠ met)", r9.verdicts["0009"] === "gaps");

  // --- FAFF-311: the singular per-issue graft gate (holdoutGateResult) ---
  // g1. conformant meets-spec, code-blind → pass
  check("gate: meets-spec code-blind → pass", holdoutGateResult(JSON.parse(meets)).gate === "pass");
  // g2. fails → block, reason carries the aggregate
  const g2 = holdoutGateResult(JSON.parse(fails));
  check("gate: fails → block (reason=fails)", g2.gate === "block" && g2.reason === "fails");
  // g3. code_blind:false meets-spec → block (non-blind is structurally inadmissible), never pass
  check("gate: non-blind meets-spec → block", holdoutGateResult(JSON.parse(block("meets-spec", "met", false))).gate === "block");
  // g4. incoherent (aggregate lies about the criteria) → block via contract violation
  const g4 = holdoutGateResult({ aggregate: "meets-spec", code_blind: true, criteria: [{ class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] });
  check("gate: incoherent meets-spec → block (contract-rejected)", g4.gate === "block" && g4.reason === "contract-rejected");
  // g5. non-object → block, never throw
  check("gate: non-object → block", holdoutGateResult(null).gate === "block");
  // g6. gaps → block (mixed verdicts never merge)
  const g6 = holdoutGateResult({ aggregate: "gaps", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] });
  check("gate: gaps → block (reason=gaps)", g6.gate === "block" && g6.reason === "gaps");

  // --- FAFF-1292: reason_code — the gate rollup + the contract cross-field rules ---
  // gr1. a born-verifiable env gap (no-surface) is accepted + blocking, and rolls up in needs_human_reasons.
  const gr1 = holdoutGateResult({ aggregate: "needs-human", code_blind: true, violations: [], criteria: [{ class: "assertion", verdict: "needs-human", evidence_present: false, reason_code: "no-surface" }, { class: "prose", verdict: "needs-human", evidence_present: false, reason_code: "human-only" }] });
  check("gate: mixed no-surface+human-only → block + needs_human_reasons counts", gr1.gate === "block" && JSON.stringify(gr1.needs_human_reasons) === JSON.stringify({ "no-surface": 1, "human-only": 1 }));
  // gr2. a legacy absent reason_code on a needs-human criterion counts under "unspecified" (never dropped).
  const gr2 = holdoutGateResult({ aggregate: "needs-human", code_blind: true, violations: [], criteria: [{ class: "prose", verdict: "needs-human", evidence_present: false }] });
  check("gate: legacy absent code → needs_human_reasons {unspecified:1}", gr2.gate === "block" && JSON.stringify(gr2.needs_human_reasons) === JSON.stringify({ unspecified: 1 }));
  // gr3. zero needs-human criteria → needs_human_reasons absent.
  check("gate: no needs-human criteria → needs_human_reasons absent", !("needs_human_reasons" in holdoutGateResult(JSON.parse(meets))));
  // gr4. contract rules: a born-verifiable human-only, a prose non-human-only, a met carrying a code, an
  //      out-of-enum code → each a violation; an absent code on needs-human is TOLERATED (no violation).
  const cv = (crit, agg = "needs-human") => computeHoldoutVerdict({ aggregate: agg, code_blind: true, violations: [], criteria: [crit] }).contractData.violations;
  check("contract: born-verifiable human-only → violation", cv({ class: "assertion", verdict: "needs-human", evidence_present: false, reason_code: "human-only" }).some((v) => v.includes("never human-only")));
  check("contract: prose non-human-only → violation", cv({ class: "prose", verdict: "needs-human", evidence_present: false, reason_code: "no-surface" }).some((v) => v.includes("prose must be human-only")));
  check("contract: met carrying a code → violation", cv({ class: "assertion", verdict: "met", evidence_present: true, reason_code: "no-surface" }, "meets-spec").some((v) => v.includes("carries a reason_code")));
  check("contract: out-of-enum code → violation", cv({ class: "assertion", verdict: "needs-human", evidence_present: false, reason_code: "bogus" }).some((v) => v.includes("not in {")));
  check("contract: absent code on needs-human → TOLERATED", cv({ class: "prose", verdict: "needs-human", evidence_present: false }).length === 0);

  // --- FAFF-384: the spawner-attestation ratchet threaded through both consumers ---
  const attested = JSON.stringify({ aggregate: "meets-spec", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true }], violations: [], spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" } });
  // gate: a self-attested meets-spec passes with the flag OFF (legacy) but BLOCKS with the flag ON.
  check("gate: self-attested meets-spec, ratchet OFF → pass", holdoutGateResult(JSON.parse(meets)).gate === "pass");
  check("gate: self-attested meets-spec, ratchet ON → block", holdoutGateResult(JSON.parse(meets), { requireSpawnerAttested: true }).gate === "block");
  // gate: a spawner-attested meets-spec passes even with the flag ON.
  check("gate: spawner-attested meets-spec, ratchet ON → pass", holdoutGateResult(JSON.parse(attested), { requireSpawnerAttested: true }).gate === "pass");
  // map bridge: same self-attested file is trusted with the flag OFF, contract-rejected with the flag ON.
  const rOff = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: meets }]);
  check("bridge: self-attested, ratchet OFF → met", rOff.verdicts["0007"] === "met");
  const rOn = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: meets }], { requireSpawnerAttested: true });
  check("bridge: self-attested, ratchet ON → contract-rejected", !("0007" in rOn.verdicts) && rOn.skipped.some((s) => s.reason === "contract-rejected"));
  const rOnA = computeHoldoutVerdictsMap({ "FAFF-34": "0007" }, [{ key: "FAFF-34", text: attested }], { requireSpawnerAttested: true });
  check("bridge: spawner-attested, ratchet ON → met", rOnA.verdicts["0007"] === "met");

  // FAFF-1259: the record writer — accepted, refused and attested cases, and the gate reading them unchanged.
  const detailed = { id: "scenarios:1", text: "t", holdout: true, class: "scenario", verdict: "met", evidence_present: true, exercised: "GET /x", expected: "200", observed: "200" };
  const recClassified = dodClassify("## Scenarios\n\n```\nGiven a\nWhen b\nThen c\n```\n\n## 8. DONE\n\n- [ ] a loose prose item\n", { issue: "FAFF-1" });
  const accepted = buildHoldoutRecord({ aggregate: "meets-spec", code_blind: true, violations: [], criteria: [detailed] }, { issue: "FAFF-1", secretValues: [], classified: recClassified });
  check("record: accepted block gate-passes", accepted.ok && holdoutGateResult(accepted.doc).gate === "pass");
  const refused = buildHoldoutRecord({ aggregate: "meets-spec", code_blind: true, violations: [], criteria: [{ ...detailed, exercised: null }] }, { issue: "FAFF-1", secretValues: [], classified: recClassified });
  check("record: refused block writes a gate-blocked fail-closed record", !refused.ok && holdoutGateResult(refused.doc).gate === "block");
  const attestationEnvelope = { code_blind: true, spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" }, violations: [] };
  const stamped = buildHoldoutRecord({ aggregate: "meets-spec", criteria: [detailed], violations: [] }, { issue: "FAFF-1", secretValues: [], envelope: attestationEnvelope, classified: recClassified });
  check("record: attested record passes the ratchet", stamped.ok && holdoutGateResult(stamped.doc, { requireSpawnerAttested: true }).gate === "pass");
  check("record: unattested record fails the ratchet", holdoutGateResult(accepted.doc, { requireSpawnerAttested: true }).gate === "block");
  if (holdoutRecordSelftest() !== 0) failed++;

  if (failed) { console.log(`holdout --selftest: FAIL (${failed} failed)`); return 1; }
  console.log("holdout --selftest: ok"); return 0;
}

// --- spec-review lens selection (FAFF-268) ---
// The cost-gate that runs IN FRONT OF the spec_review producer: given a spec's classified
// change-surface tags + the runtime level + the configured appetite, choose WHICH of the
// four frozen lenses fire and HOW DEEP (mode). Pure + deterministic — the heuristic
// signal→tag classification is the prose layer's job (faff-prep, reusing the already-shipped
// -scan surface extraction); this maps a *classified* surface to a LensSelection.
//
// v1 is ADDITIVE-ONLY / safe-direction (ADR 0028): only the `architectural` (and
// `methodology` where no tag adds it) lens is ever dropped, and only on a confidently
// -classified surface; `infosec` + `QA` are STICKY (always fire at L1–L3); an unclassified
// or unrecognised surface fires all four (fail-safe); L4 is pinned to the full adversarial
// set and never narrowed by appetite; low/medium appetite widens to all four. Symmetric /
// aggressive skipping (dropping the sticky lenses) is a deferred follow-up.
const SPEC_REVIEW_SURFACE_TAGS = [
  "config", "auth-security", "data-schema", "public-api",
  "infra-deploy", "ui", "pure-logic", "architecture-bearing",
];
// Lenses each tag adds ON TOP OF the {infosec, QA} v1 baseline (positive-fire only). The
// only lens that can be absent from a tag's add-set is the one that surface does not need —
// that absence is the only v1 skip. infosec/QA never depend on this table (they are sticky).
const SPEC_REVIEW_SURFACE_FIRES = {
  "config": [],                                  // trivial — architectural skipped
  "auth-security": ["infosec"],                  // infosec already baseline; explicit for intent
  "data-schema": ["architectural", "infosec"],
  "public-api": ["architectural", "methodology"],
  "infra-deploy": ["architectural", "infosec"],  // deploy/infra structure + secrets surface
  "ui": ["methodology"],
  "pure-logic": ["architectural"],
  "architecture-bearing": ["architectural"],
};
const SPEC_REVIEW_ALL_LENSES = SPEC_REVIEW_LENSES; // ["architectural","infosec","methodology","QA"]

// The four autonomy levels this resolver accepts. FAFF-1343: the enum is VALIDATED, not
// coerced. An out-of-enum `--level` (a bare `4` for `L4`) used to fall through to the
// single-pass default and echo the bogus level back in the rationale, so the output read
// like a considered answer rather than a rejected input; with the L4 fail-closed rule below
// that silent fall-through would let a malformed level BYPASS the refusal outright.
const SPEC_REVIEW_LEVELS = ["L1", "L2", "L3", "L4"];

// Pure: { tags:[SurfaceTag], level:"L1".."L4", appetite:"low|medium|high|full",
// adversarialConfigured:bool } → LensSelection | { error }.
//
// FAFF-1343: `mode` follows whether an adversarial spec_review chain is CONFIGURED — at
// every level. It is no longer pinned to the L4 mint. An operator who configures the
// adversarial occupant and its backend chain gets per-lens refuters on an ordinary L3
// drain, which is the same axis the kill-switch already uses (Sentry acts on
// ATTENDEDNESS, not on the mint, precisely because an unattended L3 has no human
// reading the output). Pinning depth to the mint meant a configured adversarial occupant
// was collapsed to the single-pass checklist its own SKILL says "reduces this to the
// single-pass default" — silently, on every L1–L3 review.
//
// L4 keeps exactly ONE level-specific rule, and it is the opposite of a degrade: it must
// FAIL CLOSED when no chain is configured, rather than quietly reviewing at a depth it is
// not permitted to rely on. `adversarialConfigured` defaults to false, so a caller that
// does not resolve it cannot accidentally obtain an L4 selection.
function selectLenses({ tags = [], level = "L3", appetite = "high", adversarialConfigured = false } = {}) {
  const lvl = String(level).toUpperCase();
  const app = String(appetite).toLowerCase();
  if (!SPEC_REVIEW_LEVELS.includes(lvl)) {
    return { error: "bad-level", detail: `--level must be one of ${SPEC_REVIEW_LEVELS.join("|")} (got ${JSON.stringify(String(level))})` };
  }
  const adversarial = adversarialConfigured === true;
  if (lvl === "L4" && !adversarial) {
    return { error: "adversarial-unconfigured", detail: "L4 requires a configured adversarial spec_review chain — refusing to degrade to the single-pass checklist" };
  }
  const mode = adversarial ? "adversarial" : "single-pass";
  const order = (arr) => SPEC_REVIEW_ALL_LENSES.filter((l) => arr.includes(l));
  const all = () => SPEC_REVIEW_ALL_LENSES.slice();

  const tagList = Array.isArray(tags) ? tags.filter((t) => t != null && t !== "") : [];
  const unknown = tagList.filter((t) => !SPEC_REVIEW_SURFACE_TAGS.includes(t));

  // Fail-safe (principle 1): no signal at all → fire all four.
  if (tagList.length === 0) {
    return { lenses: all(), mode, rationale: `unclassified surface (no tags) → fail-safe all-four; mode=${mode} (level ${lvl})` };
  }
  // Fail-safe: a tag we cannot confidently classify → fire all four (never under-review on doubt).
  if (unknown.length > 0) {
    return { lenses: all(), mode, rationale: `unrecognised surface tag(s) [${unknown.join(", ")}] → fail-safe all-four; mode=${mode} (level ${lvl})` };
  }
  // L4: pinned to the full adversarial set; appetite never narrows below the fail-safe set.
  if (lvl === "L4") {
    return { lenses: all(), mode, rationale: `L4 → adversarial all-four (never narrowed by appetite; configured chain required); tags=[${tagList.join(", ")}]` };
  }
  // L1–L3, low/medium appetite: widen to all four (fires more, skips less — safe direction).
  if (app === "low" || app === "medium") {
    return { lenses: all(), mode, rationale: `${app} appetite → widen to all-four (no skip); tags=[${tagList.join(", ")}]; mode=${mode}` };
  }
  // L1–L3, high/full appetite: additive set — sticky {infosec, QA} baseline + each tag's fires.
  const set = new Set(["infosec", "QA"]);
  for (const t of tagList) for (const l of SPEC_REVIEW_SURFACE_FIRES[t]) set.add(l);
  const lenses = order([...set]);
  const skipped = SPEC_REVIEW_ALL_LENSES.filter((l) => !set.has(l));
  const rationale = `tags=[${tagList.join(", ")}]; baseline=infosec,QA (sticky); fired=[${lenses.join(", ")}]`
    + (skipped.length ? `; skipped=[${skipped.join(", ")}] (safe-direction, additive-only v1)` : "; skipped=none")
    + `; mode=${mode} (level ${lvl}, appetite ${app})`;
  return { lenses, mode, rationale };
}

function specReviewLensesSelftest() {
  const has = (s, l) => s.lenses.includes(l);
  const cases = [
    { name: "config-only L2 high → architectural skipped, infosec+QA fire, single-pass",
      in: { tags: ["config"], level: "L2", appetite: "high" },
      check: (s) => !has(s, "architectural") && has(s, "infosec") && has(s, "QA") && s.mode === "single-pass" && /config/.test(s.rationale) },
    { name: "auth-security any level → infosec always present",
      in: { tags: ["auth-security"], level: "L3", appetite: "full" },
      check: (s) => has(s, "infosec") },
    { name: "ambiguous (no tags) → all four (fail-safe)",
      in: { tags: [], level: "L2", appetite: "high" },
      check: (s) => s.lenses.length === 4 },
    { name: "unknown tag → fail-safe all four",
      in: { tags: ["mystery"], level: "L2", appetite: "high" },
      check: (s) => s.lenses.length === 4 && /unrecognised/.test(s.rationale) },
    { name: "L4 + configured chain → adversarial mode, all four, not narrowed by appetite",
      in: { tags: ["config"], level: "L4", appetite: "full", adversarialConfigured: true },
      check: (s) => s.mode === "adversarial" && s.lenses.length === 4 },
    // FAFF-1343: mode follows CONFIGURATION, at every level — not the L4 mint.
    { name: "L3 + configured chain → adversarial (depth is no longer pinned to the L4 mint)",
      in: { tags: ["config"], level: "L3", appetite: "high", adversarialConfigured: true },
      check: (s) => s.mode === "adversarial" },
    { name: "L1 + configured chain → adversarial (every level can reach it)",
      in: { tags: ["config"], level: "L1", appetite: "high", adversarialConfigured: true },
      check: (s) => s.mode === "adversarial" },
    { name: "L2 + NO configured chain → single-pass (unchanged below L4)",
      in: { tags: ["config"], level: "L2", appetite: "high", adversarialConfigured: false },
      check: (s) => s.mode === "single-pass" && !s.error },
    { name: "L4 + NO configured chain → FAILS CLOSED, never degrades to single-pass",
      in: { tags: ["config"], level: "L4", appetite: "full", adversarialConfigured: false },
      check: (s) => s.error === "adversarial-unconfigured" && s.mode === undefined && s.lenses === undefined },
    { name: "L4 fail-closed is the DEFAULT when the caller omits adversarialConfigured",
      in: { tags: ["config"], level: "L4", appetite: "full" },
      check: (s) => s.error === "adversarial-unconfigured" },
    { name: "configured chain still narrows the L1–L3 lens SET by tag (mode is orthogonal to set)",
      in: { tags: ["config"], level: "L3", appetite: "high", adversarialConfigured: true },
      check: (s) => s.mode === "adversarial" && !has(s, "architectural") && has(s, "infosec") && has(s, "QA") },
    { name: "out-of-enum level is REJECTED, not coerced to single-pass (the bare-4 fail-open)",
      in: { tags: ["config"], level: "4", appetite: "high", adversarialConfigured: true },
      check: (s) => s.error === "bad-level" && s.mode === undefined },
    { name: "out-of-enum level cannot BYPASS the L4 fail-closed refusal",
      in: { tags: ["config"], level: "4", appetite: "high", adversarialConfigured: false },
      check: (s) => s.error === "bad-level" },
    { name: "lowercase level is still accepted (case-normalised, not rejected)",
      in: { tags: ["config"], level: "l4", appetite: "full", adversarialConfigured: true },
      check: (s) => s.mode === "adversarial" && !s.error },
    { name: "low appetite widens to all four (no skip)",
      in: { tags: ["config"], level: "L2", appetite: "low" },
      check: (s) => s.lenses.length === 4 },
    { name: "medium appetite widens to all four (safe-direction)",
      in: { tags: ["config"], level: "L3", appetite: "medium" },
      check: (s) => s.lenses.length === 4 },
    { name: "public-api L3 high → architectural + methodology fire",
      in: { tags: ["public-api"], level: "L3", appetite: "high" },
      check: (s) => has(s, "architectural") && has(s, "methodology") && has(s, "infosec") && has(s, "QA") },
    { name: "data-schema L3 high → architectural + infosec, methodology skipped",
      in: { tags: ["data-schema"], level: "L3", appetite: "high" },
      check: (s) => has(s, "architectural") && has(s, "infosec") && has(s, "QA") && !has(s, "methodology") },
    { name: "invariant: infosec+QA sticky in every L1–L3 selection",
      in: { tags: ["config"], level: "L1", appetite: "full" },
      check: (s) => has(s, "infosec") && has(s, "QA") },
    { name: "invariant: lenses ⊆ the four frozen lenses, mode in enum",
      in: { tags: ["ui", "config"], level: "L2", appetite: "high" },
      check: (s) => s.lenses.every((l) => SPEC_REVIEW_ALL_LENSES.includes(l)) && ["single-pass", "adversarial"].includes(s.mode) },
  ];
  let failed = 0;
  for (const c of cases) {
    const s = selectLenses(c.in);
    const ok = !!c.check(s);
    if (!ok) failed++;
    // FAFF-1343: a refusal (L4 with no configured chain, or an out-of-enum level) returns an
    // { error } shape with no lenses/mode, so render that rather than throwing on undefined.
    const shown = s.error ? `error=${s.error}` : `{${s.lenses.join(",")}} ${s.mode}`;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name} → ${shown}`);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

const SPEC_REVIEW_LENSES_USAGE =
  "usage: faff spec-review-lenses [--tags a,b] [--level L1|L2|L3|L4] [--appetite ...] " +
  "[--adversarial-configured yes|no] [--root DIR]";

function cmdSpecReviewLenses(args) {
  if (args.includes("--selftest")) return specReviewLensesSelftest();
  const parsed = parseArgs(args, SPEC_REVIEW_LENSES_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, SPEC_REVIEW_LENSES_USAGE);
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const tagsArg = get("--tags");
  const tags = tagsArg ? tagsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const level = get("--level") || "L3";
  const appetite = get("--appetite") || "high";

  // FAFF-1343: resolve whether an adversarial spec_review chain is configured. An explicit
  // --adversarial-configured wins (deterministic tests, and a caller that already resolved
  // its own chain); otherwise read the repo config through the SAME predicate
  // `faff spec-review-pin --resolve` uses, for the `spec_review` consumer, so the two verbs
  // can never disagree about whether a chain exists.
  const advFlag = get("--adversarial-configured");
  let adversarialConfigured;
  if (advFlag === "yes" || advFlag === "no") {
    adversarialConfigured = advFlag === "yes";
  } else if (advFlag != null) {
    return usageError(
      [{ code: "bad-value", detail: `--adversarial-configured must be yes|no (got ${JSON.stringify(advFlag)})` }],
      SPEC_REVIEW_LENSES_USAGE);
  } else {
    const root = get("--root") || findRoot();
    const [cfg] = loadConfig(root);
    adversarialConfigured = !assembleAdversarialBackends(cfg, "spec_review").error;
  }

  const selection = selectLenses({ tags, level, appetite, adversarialConfigured });
  if (selection.error === "bad-level") {
    process.stderr.write(`faff spec-review-lenses: ${selection.detail}\n`);
    return 2;
  }
  if (selection.error === "adversarial-unconfigured") {
    // Exit 3 for parity with `faff spec-review-pin --resolve`, which already returns 3 for
    // this same condition ("adversarial is unset ... no adversarial provider configured").
    process.stderr.write(`faff spec-review-lenses: ${selection.detail}\n`);
    return 3;
  }
  process.stdout.write(JSON.stringify(selection) + "\n");
  return 0;
}


module.exports = { ADMISSIBLE_DUP_DONE, ADMISSIBLE_GOOD, ADMISSIBLE_GOOD_NUMBERED, ADMISSIBLE_PROSE_DONE, ADMISSIBLE_SPEC, BANNED_VAGUE, DOD_CLASSIFY_SPEC, DOD_SPLIT_SPEC, DOD_SURFACE, DUP_THRESHOLD, HOLDOUT_RECORD_SPEC, HOLDOUT_SURFACE, HOLDOUT_VERDICTS_SPEC, HOLDOUT_VERDICT_SPEC, INTEGRATION_TIER_MARKERS, INTERNAL_SUBJECT_MARKERS, OBSERVABLE_TOKENS, PROSE_DONE_STOPWORDS, SCENARIOS_HEADING_RE, SPEC_REVIEW_ALL_LENSES, SPEC_REVIEW_LENSES_SPEC, SPEC_REVIEW_SURFACE_FIRES, SPEC_REVIEW_SURFACE_TAGS, acceptanceSection, admissibleSelftest, admissibleVerdict, classifyAcceptanceCriteria, classifyCriterion, cmdAdmissible, codeSurfaceAdvisory, codeSurfaceSignal, cmdDod, cmdDodSplit, cmdHoldout, cmdHoldoutRecord, cmdHoldoutVerdict, cmdSpecReviewLenses, detectRunnableCheck, dodClassify, dodSelftest, dodSplit, doneScenariosLevelWarning, firstHeadingLevelMatching, hasObservableOracle, headingLevel, holdoutRemovalSpans, holdoutVerdictsSelftest, isConfidenceLine, isDoneHeading, isHoldoutFenceOpen, isIntegrationFenceOpen, matchesBannedVague, opensContractFence, oracleLessAdvisory, parseDoneChecklist, parseScenarios, prdHasComparator, proseDoneAdvisory, proseDoneContainment, proseDoneTokens, renderCodeSurfaceWarning, renderOracleLessWarning, renderProseDoneWarning, renderScenariosCodeSurfaceWarning, renderScenariosProseWarning, resolveVerificationTier, scenariosBoundaryStop, scenariosCodeSurfaceAdvisory, scenariosProseAdvisory, sectionBody, sectionBodyRange, selectLenses, specReviewLensesSelftest };
