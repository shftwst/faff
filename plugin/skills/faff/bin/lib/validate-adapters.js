// ===========================================================================
// === region:factory — validate-adapters — structural conformance lint of the shipped slot skills ===
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { HERE } = require("./shared-infra");
const { parseArgs, usageError } = require("./argv");
const VALIDATE_ADAPTERS_SPEC = { flags: { "--configured": { arity: 0 }, "--root": { arity: 1 }, "--skills-dir": { arity: 1 }, "--is-bundled": { arity: 1 }, "--slot": { arity: 1 } } };
const { loadConfig, DEFAULTS } = require("./config");
const { CANONICAL_CONFIG, findRoot } = require("./shared-infra");
const { CONTRACT_DESCRIBES } = require("./contract-defs");

const REGISTRY = {
  "faffidavit-routing": { type: "adaptor", slot: "routing_adaptor", contract: "automation-routing" },
  "faffidavit-rendering": { type: "pure-adaptor", slot: "rendering_adaptor" },
  "faffter-noon-methodology-thematic": { type: "methodology" },
  "faffter-dark-methodology-agile-delivery": { type: "methodology" },
  "faffter-noon-concurrency-sequential": { type: "mechanism" },
  "faffter-dark-concurrency-parallel": { type: "mechanism" },
  "faffter-noon-spec": { type: "producer-spec" },
  "faffter-dark-nlspec": { type: "producer-spec" },
  "faffter-noon-spec-review": { type: "producer-spec-review" },
  "faffter-dark-spec-review": { type: "producer-spec-review" },
  "faffter-noon-architecture": { type: "producer-architecture" },
  "faffter-noon-env-compose": { type: "producer-env" },
  "faffter-noon-evaluate": { type: "producer-evaluator" },
  "faffter-noon-prd": { type: "producer-prd" },
  "faffter-noon-intake": { type: "producer-intake" },
  "faffter-noon-adr": { type: "producer-adr" },
  "faffter-noon-transport-private-network": { type: "producer-transport" },
  "faffter-noon-env-code-interface": { type: "producer-env-code-interface" },
  "faffter-noon-review": { type: "producer-review" },
  "faffter-dark-adversarial-review": { type: "producer-review" },
  "faffter-noon-ship": { type: "producer-ship" },
};
const SKIP = new Set(["faffter-dark-authoring-adaptors"]);
const REQUIRED_METHODOLOGY_OUTPUTS = ["backlog-diagnostics", "pick-ordering", "promotion-readiness", "build-queue"];

// FAFF-120: the machine-checkable subset of the skill-authoring charter (docs/reference/skill-authoring.md).
// SKILL_LINE_CAP is a lenient CEILING for every SKILL.md not named in SKILL_LINE_BASELINE below.
const SKILL_LINE_CAP = 600;                       // per-file SKILL.md line cap (shared default ceiling)
// FAFF-584: downward ratchet for the two hub files whose size is load-bearing enough to track by
// their own committed line count — the gateway (`faff`) and the beep-boop orchestration hub. Scope
// is deliberately the two hub files, not every SKILL.md (human decision, 2026-08-10): the ~28 other
// skills stay on the shared SKILL_LINE_CAP default above. Each value here MUST equal the file's
// current `wc -l` — zero headroom. Lower it only when the file is leaned; NEVER raise it to fit
// growth (growth instead FAILs "(line cap)"; the per-file loop below also prints a non-failing
// RATCHET advisory when a file has shrunk below its recorded baseline, nudging the value down).
// Honest limit: this is a STATELESS linter — it reads the working tree, never git history — so it
// cannot mechanically stop a contributor hand-raising a baseline to fit growth instead of leaning;
// the real gate is that such a raise is a conspicuous, reviewable diff line, not a silent pass. A
// git-history monotonic-nonincreasing check, and extending the ratchet to every SKILL.md, are both
// deferred follow-ups (FAFF-584 §7) — the stateless linter can't do the former without new machinery.
// `faff-graft` carries an unrelated, pre-existing override (FAFF-708 et al.) with headroom, not a
// zero-headroom ratchet; it predates and is out of this ticket's two-hub-file scope, so its value is
// carried forward unchanged rather than folded into the ratchet invariant above.
// FAFF-607: path-keyed downward line-cap ratchet for the gateway split's lean target,
// faff/references/kernel.md (the dir-keyed SKILL_LINE_BASELINE loop below only iterates dirs that
// contain a SKILL.md, so a references file is never line-capped by it). Growth FAILs; a shrink below
// baseline prints a non-failing RATCHET advisory — lower it to lock the reduction, exactly like
// SKILL_LINE_BASELINE. The bare-/faff faff/SKILL.md baseline drops from 1170 to its post-split size.
const KERNEL_LINE_BASELINE = 340;
const SKILL_LINE_BASELINE = { faff: 62, "faff-beep-boop": 571, "faff-graft": 558, "faff-prep": 523 };
// FAFF-884: the turn-survival anchor-phrase lint, generalised from the hard-coded
// `name === "faff-graft"` branch to a data-driven PER-SKILL map. Each skill anchors
// on the literal phrases its OWN prose genuinely carries (the three faff-graft phrases
// do not all appear in faff-beep-boop / faff-prep, so a shared phrase set would force
// contrived wording) — case-insensitive substring, PRESENCE-only (the mechanical floor
// is the runtime background-fence + inflightcheck Stop hook, not this static check).
// faff-graft keeps its three unchanged; faff-beep-boop / faff-prep each assert the
// in-flight-marker turn-survival prose the FAFF-884 fix adds at their dispatch sites.
const ANCHOR_PHRASES = {
  "faff-graft": ["run_in_background: true", "never end a turn", "foreground-to-terminal"],
  "faff-beep-boop": ["never end a turn", "in-flight marker", "non-terminal turn-end", "foreground-to-terminal"],
  "faff-prep": ["never end a turn", "in-flight marker"],
};
const PARA_WORD_CAP = 200;                         // longest single prose line (≈ one paragraph) — nudge bullets over walls of prose
const DUP_BLOCK_WINDOW = 6;                         // identical run of significant lines across 2+ skills = copied prose; single-source it
const DUP_SIG_MINLEN = 25;                          // a "significant" line for dedup/paragraph purposes is non-trivial prose this long
// Stray non-load-bearing markers: transcript run-ids and retrospective war-story idioms that belong in
// git history / ADRs / design notes, not the runtime prompt. Load-bearing FAFF-NN refs (contract anchors,
// section pointers) are intentionally NOT matched — the rule targets idioms, not issue-tags.
const STRAY_TRANSCRIPT = /\brun \d{4}-\d{2}-\d{2}\b|\bbeep-boop-\d{4,}\b|\brun-\d{8}-\d{6}-(?:beepboop|lights-out)\b/i;
const STRAY_RETRO = /\bfixes a real (?:failure|bug|mistake)\b|\bthe exact (?:failure|bug|mistake) this guards against\b|\bbit (?:us|me) (?:twice|once)\b|\brecurred (?:twice|\d+ times)\b/i;
// A prose line for the paragraph + dedup rules: not blank, not a list item / heading / table / fence / quote.
function isProseLine(line) {
  const s = line.trim();
  if (!s) return false;
  return !/^([-*>]|\d+\.|#|\||```)/.test(s);
}
// A bold-lead bullet is the house mega-bullet style ("- **Foo.** …" / "* **Foo.** …") — prose in
// disguise as a list item. isProseLine (above) deliberately excludes it and stays UNCHANGED — it also
// gates the cross-file dedup collection below, and widening it would silently pull bold-lead bullets
// (frequently shared/referenced prose) into dedup windows. isParagraphLine is the dedicated, surgical
// selector for the paragraph-length cap only (FAFF-584).
const BOLD_LEAD_BULLET = /^[-*]\s+\*\*/;
function isParagraphLine(line) {
  const s = line.trim();
  if (!s) return false;
  if (BOLD_LEAD_BULLET.test(s)) return true;
  return isProseLine(line);
}
// FAFF-584: the within-prose anchor lint. ANCHOR_REF captures the bold target text of one
// `→ **Section**` cross-reference; HEADING_LINE matches a `##`..`######` heading, capturing its text.
const ANCHOR_REF = /→\s*\*\*([^*]+)\*\*/g;
const HEADING_LINE = /^(#{2,6})\s+(.+?)\s*$/;
// Normalize a heading (or an anchor leaf) for comparison: strip backticks/emphasis markers, lowercase,
// collapse whitespace. Anchor resolution and ambiguous-heading detection both compare on this form.
function normalizeHeading(s) {
  return s.trim().replace(/[`*_]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
// An anchor leaf resolves if it equals a pooled heading, or is a whole-word prefix of one (refs
// routinely use a short form of a longer heading). A bare substring prefix ("park" vs "parking lot")
// must NOT resolve — the word-boundary space after the leaf is what makes the boundary real.
function anchorResolves(leaf, headings) {
  if (headings.has(leaf)) return true;
  for (const h of headings) {
    if (h.startsWith(leaf + " ")) return true;
  }
  return false;
}
// FAFF-607: the refer-back requirement is satisfied by Reading the kernel (faff/references/kernel.md,
// where the shared gateway prose now lives after the split), not only the bare-/faff faff/SKILL.md.
const REFER_BACK = /Read[^\n]*\bfaff\/(?:references\/kernel|SKILL)\.md/;
const NON_NORMATIVE = /non-normative|gateway wins/i;

// FAFF-54: every faff-* user command emits human-facing output (terminal, tracker
// descriptions, tracker comments), so each must DOCUMENT routing that output through
// the configured renderer (gateway -> Rendering, Universal-routing rule). A match is
// any of: the `rendering_adaptor` slot name, the gateway Rendering section, or the
// Universal-routing rule. HONEST LIMIT: this is a conservative reference-PRESENCE
// check — it proves the skill *documents* the rule, NOT that it routes *every* emit
// at runtime (runtime routing is a prose interaction, not statically lintable — the
// same class of limit as FAFF-57's chain-gate). It catches the realistic drift: a
// skill that drops the rule entirely.
const RENDERING_REF = /rendering_adaptor|Universal-routing|→\s*\*?\*?Rendering|gateway['’]s? \*?\*?Rendering/;

// FAFF-50 / FAFF-1322: CLI-only config access — no skill may hand-read a config file with a shell
// command; config is resolved via `faff config`. Conservative: flags only an explicit shell read with
// cat/head/tail/grep/sed/awk/less (never a prose mention) of either the deprecated root-tier `.faffrc*`
// or the whole `.faff/config…` spelling class — dot/hyphen-separated variants and the bare
// extensionless name, with or without a `.yaml`/`.yml` suffix. The `.faff/config` alternative
// `(?:[.-][\w.-]*)?(?![\w.\-/])` is a conservative tripwire over that class: it flags every
// dot/hyphen-separated `.faff/config` variant and the bare extensionless name (a skill has no
// business shell-reading one). Scope is deliberately dot/hyphen-separated per the spec, so a bare
// word continuation (`.faff/config_local`, `.faff/config2`) is not a variant and stays unflagged;
// the `(?![\w.\-/])` lookahead
// still excludes a path under a `.faff/config/` directory (a `/` after `config`) and a longer word
// like `.faff/configuration.yaml` (a letter after `config`, no separator). The `.example` line-skip
// in the scan loop below (independent of this pattern) is what exempts `.faff/config.example.yaml`.
// Exported so test/validate-adapters.test.mjs can unit-test the pattern directly.
const HANDREAD = /\b(?:cat|head|tail|less|grep|sed|awk)\b[^\n]*(?:\.faffrc(?:\.ya?ml)?\b|\.faff\/config(?:[.-][\w.-]*)?(?![\w.\-/]))/;

// FAFF-1207: the `faff commissaire` facade accepts `--issue` only as a deprecated one-release alias of
// `--unit-id` (FAFF-1167); any skill prose that passes `--issue` on a commissaire invocation re-arms the
// stderr deprecation notice on every governed graft. This guard fires on the INVOCATION SHAPE — a faff
// binary token DIRECTLY followed by `commissaire`, then (same line, no backtick in between) a `--issue`
// flag — never on mere co-occurrence of the words, and never on the dozen other commands whose own
// current `--issue` flag is correct (effects / run-ledger / build-claim / landing-claim / worktree-* /
// corrective / spec-review-dir / decision-capture / post-merge-check / bundle-recover). Anchoring
// `commissaire` immediately after the binary is what excludes every one of those. A single lazy
// `[^`\n]*?` run (no nesting) keeps it ReDoS-free; the backtick exclusion stops a match leaking across
// two separate backticked commands on one line.
const COMMISSAIRE_ISSUE_RE = /(?<![\w.-])"?\$?faff"?\s+commissaire\b[^`\n]*?\s--issue\b/i;

// FAFF-598: derive the inline-enum-restatement lint's value sets from CONTRACT_DESCRIBES — the SAME
// data `faff contract <name> --describe` renders — never a hand-copied list of its own. One set per
// lintable (default true; the sole false today is spec-readiness's producer-authored marker dialect)
// value group with >=3 values (the floor that keeps generic two-value sets out); identical sets shared
// across contracts (e.g. two contracts reusing PRDR_DISPOSITIONS) dedupe to one reported owner.
function inlineEnumLintSets() {
  const sets = new Map();
  for (const [contract, describe] of Object.entries(CONTRACT_DESCRIBES)) {
    for (const g of describe.values || []) {
      if (g.lintable === false) continue;
      if (!Array.isArray(g.enum) || g.enum.length < 3) continue;
      const key = [...g.enum].sort().join("|");
      if (!sets.has(key)) sets.set(key, { contract, field: g.field, values: g.enum });
    }
  }
  return [...sets.values()];
}

// FAFF-598: a lintable enum's FULL value set appearing together within a 2-line window is an inline
// restatement of prose `faff contract <name> --describe` already generates from the same data —
// exactly the FAFF-582 drift class (a hand-copied enum going stale against the validator). Matching is
// backtick-stripped, word-boundary tokens; a single-value mention, a partial reference, or an example
// never fires (the full-set requirement is the precision floor, not a matcher heuristic).
function lintInlineEnumRestatement(skillText) {
  const findings = [];
  const lintSets = inlineEnumLintSets();
  if (!lintSets.length) return findings;
  const lines = skillText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(".example") || (lines[i + 1] || "").includes(".example")) continue;
    const windowText = `${lines[i]}\n${lines[i + 1] || ""}`;
    const tokens = new Set((windowText.match(/`?[A-Za-z0-9][A-Za-z0-9_-]*`?/g) || []).map((t) => t.replace(/`/g, "")));
    for (const set of lintSets) {
      if (set.values.every((v) => tokens.has(v))) {
        findings.push(`line ${i + 1}: inline enum restatement of ${set.contract}.${set.field} — point at \`faff contract ${set.contract} --describe\` instead (FAFF-598)`);
      }
    }
  }
  return findings;
}

// FAFF-1207: one finding per line whose content is a `faff commissaire` invocation passing the
// deprecated `--issue` alias (see COMMISSAIRE_ISSUE_RE for the invocation-shape anchor). Pure — input
// is one file's text; returns [] for any file with no such invocation (including clean `--unit-id`
// lines and every non-commissaire `--issue`). Per-line, mirroring the FAFF-1198 removed-dispatch-key
// scan, because the commissaire facade invocations in skill prose are always single-line commands.
function lintCommissaireUnitId(text) {
  const findings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // No `.example` skip (unlike the HANDREAD / FAFF-598 scans): a commissaire `--issue` invocation
    // is a regression whether or not the line also names an example path, and the FAFF-1198 lint this
    // mirrors has no such skip either. Keeping the scan unconditional closes that false-negative hole.
    if (COMMISSAIRE_ISSUE_RE.test(lines[i])) {
      findings.push(`line ${i + 1}: \`--issue\` is the deprecated commissaire alias; pass \`--unit-id\` (FAFF-1207)`);
    }
  }
  return findings;
}

// FAFF-51: internal slot skills hide from the user `/` menu via `user-invocable: false`
// frontmatter; user-facing commands (the faff-* skills) and the authoring dev tool must NOT.
function hasUserInvocableFalse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return /^user-invocable:\s*false\b/m.test(m ? m[1] : "");
}

// FAFF-280: a skill declares its LLM-judgement seam(s) via a `judgement_seam:` frontmatter key,
// sibling to name/description/user-invocable. Value is a comma-separated list of grader kind-ids
// OR the literal `none` (asserted-deterministic, no seam). Read with the same frontmatter-regex
// precedent as hasUserInvocableFalse. Returns: null (key ABSENT/undeclared) | "none" | string[] of
// kind-ids. A single comma-scalar line (no YAML sequence — faff's frontmatter parsers carry no array).
function readJudgementSeam(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = (fm ? fm[1] : "").match(/^judgement_seam:\s*(.+?)\s*$/m);
  if (!m) return null;
  const raw = m[1].trim();
  if (raw === "none") return "none";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// FAFF-280: load eval/seam-registry.json (the seam→KIND SSOT) relative to the repo root (this CLI
// lives at <root>/plugin/skills/faff/bin/faff). Returns { registry, error, root }. A plugin-only
// install with no eval/ harness yields {registry:null, error:null} — nothing to reconcile. An eval/
// dir WITH a missing/malformed registry is a hard error (fail-loud, mirroring the grader consumer).
// FAFF-616: accepts an explicit `root` (the shared root every gate-block fs read resolves against —
// `--root` if the caller supplied one, else the HERE-relative default) and returns the root it used
// so callers (the C2 casesDir read, the C3 frontier.json read) thread the SAME value rather than each
// re-resolving their own — a fixture pointed at by `--root` must never fall through to the real tree.
function loadSeamRegistryForLint(root) {
  const repoRoot = root !== undefined ? root : path.resolve(HERE, "..", "..", "..", "..");
  const evalDir = path.join(repoRoot, "eval");
  const regPath = path.join(evalDir, "seam-registry.json");
  if (!fs.existsSync(evalDir)) return { registry: null, error: null, root: repoRoot };
  if (!fs.existsSync(regPath)) return { registry: null, error: `eval/seam-registry.json not found (${regPath})`, root: repoRoot };
  let reg;
  try { reg = JSON.parse(fs.readFileSync(regPath, "utf8")); }
  catch (e) { return { registry: null, error: `eval/seam-registry.json malformed JSON: ${e.message}`, root: repoRoot }; }
  if (!reg || typeof reg.kinds !== "object" || reg.kinds === null) {
    return { registry: null, error: "eval/seam-registry.json missing the `kinds` map", root: repoRoot };
  }
  return { registry: reg, error: null, root: repoRoot };
}

// FAFF-616 C3: pure calibration-floor predicate. `baseline` is the ALREADY-PARSED frontier object
// (checkCalibrated never reads it from disk); `floor` is the resolved numeric floor
// (baseline.policy.calibration_floor ?? 0.85); `warnSet` is a Set of baseline.policy.warn_kinds. No
// fs, no process.exit, no model call, no ambient state — deterministic in its args, so it is testable
// with hand-built objects and structurally cannot invoke a model. Gates on `accuracy` only; a broken
// kind's `stability`/`format_adherence` reading 1.00 must never affect the verdict. Kind lookup is
// exact-string (baseline.per_kind[kind]) — the grader asserts registry keys == its KINDS, so
// normalizing here would only mask a genuine divergence.
function checkCalibrated(kind, entry, baseline, floor, warnSet) {
  const row = baseline && baseline.per_kind ? baseline.per_kind[kind] : undefined;
  if (row === undefined) {
    return { ok: false, reason: `kind \`${kind}\` is registry-status \`calibrated\` but has no per_kind row in frontier.json — run the operator sweep (FAFF-614)` };
  }
  if (warnSet.has(kind)) {
    return { ok: false, reason: `kind \`${kind}\` is \`calibrated\` but is a policy.warn_kind in frontier.json — a warn-kind is not calibration-clean` };
  }
  if (row.accuracy < floor) {
    return { ok: false, reason: `kind \`${kind}\` accuracy ${row.accuracy} < calibration floor ${floor}` };
  }
  return { ok: true };
}

// FAFF-616 C3: the outer lint — owns the frontier.json fs-read and the fail-loud exit. Impure by
// design (the counterpart to the pure checkCalibrated above). Only called when `seamReg !== null`;
// `root` is the SAME shared root loadSeamRegistryForLint used, never recomputed. `casesPresent` is
// accepted per the component interface (a calibrated-with-0-cases kind is caught by the extended C2,
// not here — this param is not consulted by the procedure below, kept for interface parity). A
// calibrated claim with no readable frontier baseline is a harness-can't-run condition (exit 2),
// distinct from a claim that reads fine but misses the floor (a lint FAIL, exit 1, via `failed`).
function c3CalibrationFloor(seamReg, root, _casesPresent, reportFailure = console.log) {
  const calibratedKinds = Object.entries(seamReg.kinds)
    .filter(([, entry]) => entry.status === "calibrated")
    .map(([kind]) => kind);
  if (calibratedKinds.length === 0) return { failed: false, exit2: false }; // no claim → nothing to read, nothing to fail

  const frontierPath = path.join(root, "eval", "baselines", "frontier.json");
  let baseline;
  if (!fs.existsSync(frontierPath)) {
    reportFailure(`FAIL  eval/baselines/frontier.json (calibration floor)`);
    reportFailure(`        ✗ eval/baselines/frontier.json not found (${frontierPath}) — a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)`);
    return { failed: true, exit2: true };
  }
  try {
    baseline = JSON.parse(fs.readFileSync(frontierPath, "utf8"));
  } catch (e) {
    reportFailure(`FAIL  eval/baselines/frontier.json (calibration floor)`);
    reportFailure(`        ✗ eval/baselines/frontier.json malformed JSON: ${e.message} — a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)`);
    return { failed: true, exit2: true };
  }
  if (!baseline || typeof baseline.per_kind !== "object" || baseline.per_kind === null) {
    reportFailure(`FAIL  eval/baselines/frontier.json (calibration floor)`);
    reportFailure(`        ✗ eval/baselines/frontier.json missing the \`per_kind\` map — a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)`);
    return { failed: true, exit2: true };
  }

  const policy = baseline.policy || {};
  const floor = policy.calibration_floor !== undefined && policy.calibration_floor !== null ? policy.calibration_floor : 0.85;
  const warnSet = new Set(policy.warn_kinds || []);

  let failed = false;
  for (const kind of calibratedKinds) {
    const result = checkCalibrated(kind, seamReg.kinds[kind], baseline, floor, warnSet);
    if (!result.ok) {
      failed = true;
      reportFailure(`FAIL  eval/baselines/frontier.json:${kind} (calibration floor)`);
      reportFailure(`        ✗ ${result.reason}`);
    }
  }
  return { failed, exit2: false };
}

// FAFF-280: reconcile a skill's `judgement_seam:` declaration against the registry. `declared`:
// null (ABSENT — advisory-pass in FAFF-280; the absent→fail enforcement is FAFF-281) | "none" |
// string[]. Surface matches the skill dir name. Returns [ok,label] tuples (empty when absent). The
// canonical KIND set is the registry's own keys (== grader KINDS, asserted equal by the grader).
function reconcileSeam(skillName, declared, registry, adaptorRegistry) {
  if (declared === null) return [];
  const allKinds = Object.keys(registry.kinds);
  const registered = allKinds.filter((k) => registry.kinds[k].surface === skillName);
  if (declared === "none") {
    return [[registered.length === 0,
      registered.length
        ? `declares \`none\` but registry maps [${registered.join(", ")}] to it`
        : "judgement_seam: none — owns no registered KIND"]];
  }
  const unknown = declared.filter((k) => !allKinds.includes(k));
  if (unknown.length) return [[false, `judgement_seam declares unknown KIND(s): ${unknown.join(", ")}`]];
  // FAFF-281 slot-sibling relaxation: an alternate occupant owns no registry row but fills the same
  // slot as a surface sibling (a REGISTRY skill of the same `type`); it may declare that sibling's
  // KIND(s) honestly without owning the row and without the `none`-lie. Expected = its own rows if it
  // is itself a surface, else the union of its slot-siblings' rows. (Falls back to own rows when no
  // adaptor registry is supplied or the skill is not a REGISTRY occupant — the FAFF-280 behaviour.)
  let expected = registered;
  if (registered.length === 0 && adaptorRegistry && adaptorRegistry[skillName]) {
    const myType = adaptorRegistry[skillName].type;
    const siblings = new Set(Object.keys(adaptorRegistry)
      .filter((n) => n !== skillName && adaptorRegistry[n].type === myType));
    expected = allKinds.filter((k) => siblings.has(registry.kinds[k].surface));
  }
  const d = [...new Set(declared)].sort(), r = [...new Set(expected)].sort();
  const eq = d.length === r.length && d.every((k, i) => k === r[i]);
  return [[eq, eq
    ? "judgement_seam == registry surface rows"
    : `judgement_seam mismatch — declared [${d.join(", ")}] vs expected [${r.join(", ")}]`]];
}

// .faffrc slot name → the conformance profile its occupant must satisfy. Lets the
// --configured pre-flight derive the expected `checksFor` type from the slot alone,
// so a third-party occupant (not in REGISTRY) can still be structurally linted.
const SLOT_TYPES = {
  routing_adaptor: { type: "adaptor", slot: "routing_adaptor" },
  rendering_adaptor: { type: "pure-adaptor", slot: "rendering_adaptor" },
  methodology: { type: "methodology" },
  concurrency: { type: "mechanism" },
  intake: { type: "producer-intake" },
  adr: { type: "producer-adr" },
  spec: { type: "producer-spec" },
  spec_review: { type: "producer-spec-review", slot: "spec_review" },
  architecture: { type: "producer-architecture", slot: "architecture" },
  env: { type: "producer-env", slot: "env" },
  transport: { type: "producer-transport", slot: "transport" },
  "env-code-interface": { type: "producer-env-code-interface", slot: "env-code-interface" },
  evaluator: { type: "producer-evaluator", slot: "evaluator" },
  prd: { type: "producer-prd", slot: "prd" },
  review: { type: "producer-review" },
  ship: { type: "producer-ship" },
  // FAFF-231: the infra-profile acquirer slot. The shipped default occupant is the built-in
  // deterministic `faff profile mine` step (no skill — like `gates`); SLOT_TYPES lets a custom
  // swapped-in occupant be structurally linted: it must emit the faff-contract:infra-profile block.
  profile: { type: "producer-profile", slot: "profile" },
};

const PRODUCER_ARTIFACTS = {
  "producer-spec": "spec-readiness",
  "producer-review": "review-verdict",
  "producer-spec-review": "spec-review-verdict",
  "producer-architecture": "architecture-proposal",
  "producer-env": "env-handle",
  "producer-evaluator": "holdout-verdict",
  "producer-prd": "prd-readiness",
  "producer-ship": "delivery-outcome",
  "producer-profile": "infra-profile",
};

function checksFor(meta, t) {
  const out = [];
  const has = (s) => t.includes(s);
  const artifact = PRODUCER_ARTIFACTS[meta.type];
  if (artifact) out.push([has(`faff-contract:${artifact}`), `emits its \`faff-contract:${artifact}\` artifact block`]);
  switch (meta.type) {
    case "adaptor":
      out.push([REFER_BACK.test(t), "refer-back: Read the sibling faff/SKILL.md when standalone"]);
      out.push([NON_NORMATIVE.test(t), "recap marked non-normative / 'gateway wins'"]);
      out.push([has(meta.slot), `names its slot (${meta.slot})`]);
      out.push([!t.toLowerCase().includes("no internal contract"),
                "an adaptor over a fixed contract must NOT claim 'no internal contract'"]);
      // FAFF-77: contract-as-code wiring-check. An adaptor that delegates conformance to a
      // contract script (declared via meta.contract) must WIRE to it and declare the script
      // the sole source of contract data — so "check the wiring" is sound. (Schema-resolves
      // is checked in cmdValidateAdapters, which has the skills dir.)
      if (meta.contract) {
        out.push([has(`faff contract ${meta.contract}`),
                  `wires to its contract script (\`faff contract ${meta.contract}\`)`]);
        out.push([/sole source of contract data/i.test(t),
                  "declares the contract script the sole source of contract data (no prose-built contract data)"]);
      }
      break;
    case "pure-adaptor":
      out.push([t.toLowerCase().includes("no internal contract"), "pure adaptor declares it has no internal contract"]);
      out.push([has(meta.slot), `names its slot (${meta.slot})`]);
      break;
    case "methodology":
      for (const o of REQUIRED_METHODOLOGY_OUTPUTS) out.push([has(o), `answers required output \`${o}\``]);
      out.push([has("methodology` slot") || has("methodology slot"), "references the gateway methodology-slot contract"]);
      break;
    case "mechanism":
      out.push([has("Mechanism slots") || has("slot contract"), "refers back to the gateway mechanism-slot contract"]);
      out.push([has("merge gate"), "states it never weakens the merge gate"]);
      out.push([has("ledger"), "records terminal outcomes to the run ledger"]);
      // FAFF-439: a concurrency executor must declare a turn-safe dispatch posture — the Agent tool
      // backgrounds by default, so an omitted posture lets the orchestrator end its turn with a build
      // still in flight (idle-reaped mid-work). Two valid arms: foreground dispatch (sequential's
      // `run_in_background: false`) OR a background dispatch covered by a "never end a turn" await-all
      // gate (parallel's). Substring-only: this asserts the instruction is PRESENT, not runtime-obeyed.
      out.push([t.toLowerCase().includes("run_in_background: false") || t.toLowerCase().includes("never end a turn"),
                'declares a turn-safe dispatch posture ("run_in_background: false", or a "never end a turn" await-all gate)']);
      // FAFF-530: a concurrency executor must ALSO stamp the foreground-to-terminal discipline
      // into its BuildDispatch prompt — the dispatched build's OWN turn contract (run every
      // gate/test/review step foreground; never end a turn without the terminal token). This is
      // the defence-in-depth clause the build subagent sees at its highest-salience surface; the
      // same distinctive phrase anchors the faff-graft build-phase lint. Substring-only.
      out.push([t.toLowerCase().includes("foreground-to-terminal"),
                'stamps the foreground-to-terminal dispatch clause into its BuildDispatch prompt (FAFF-530)']);
      break;
    case "producer-spec":
      // FAFF-109: conformance is artifact-emission (the spec_adaptor was retired) — the
      // producer self-declares its markers + confidence in a faff-contract:spec-readiness block
      // the consumer (faff-prep) parses and pipes to `faff contract spec-readiness` directly.
      out.push([t.toLowerCase().includes("confidence"), "emits a confidence self-rating"]);
      break;
    case "producer-intake":
      out.push([t.toLowerCase().includes("discovery brief"), "emits a discovery brief"]);
      break;
    case "producer-adr":
      // FAFF-196: the ADR-body producer is intake-shaped — a documented output (a Nygard ADR
      // body) with NO gated faff-contract block (graft always records an already-Chosen decision),
      // plus an ADVISORY confidence self-rating. Conformance is "emits the documented body +
      // confidence"; it must NOT claim a faff-contract block.
      out.push([/nygard/i.test(t) && t.includes("Consequences"),
                "emits a Nygard ADR body (Context/Decision/Consequences)"]);
      out.push([t.toLowerCase().includes("confidence"), "emits an advisory confidence self-rating"]);
      out.push([!/faff-contract:/.test(t),
                "carries NO faff-contract block (the ADR body is advisory, not gated pass/fail)"]);
      break;
    case "producer-transport":
      // FAFF-817: the evaluator→SUT reachability resolver composed under `env`. Inline-return
      // occupant (no gated faff-contract block, mirroring producer-adr's posture) — the env
      // occupant consumes the resolved base host mid-flow, in the same turn, never a piped contract.
      out.push([has("`transport` slot") || has("transport slot"), "names its `transport` slot"]);
      out.push([has("base host") || has("base_host"), "documents returning a resolved base host for evaluator→SUT reachability"]);
      out.push([!/faff-contract:/.test(t),
                "carries NO faff-contract block (the result is consumed inline by env, not gated)"]);
      break;
    case "producer-env-code-interface":
      // FAFF-1105: the code-interface reachability provisioner composed under `env`. Inline-return
      // occupant (no gated faff-contract block, mirroring producer-transport) — it builds a code
      // component and stands up the FAFF-1104 bridge (faff-bridge-node.mjs) as a health-checked compose
      // service, returning the bridge socket the env occupant folds into the one env-handle it emits.
      out.push([has("`env-code-interface` slot") || has("env-code-interface slot"), "names its `env-code-interface` slot"]);
      out.push([has("/faff-rpc/health"), "documents the bridge endpoint + /faff-rpc/health health-check for the code-interface reachability"]);
      out.push([has("teardown"), "documents teardown of the bridge it stands up"]);
      out.push([has("host-side reachability") || has("all-interfaces"),
                "documents the transport-constrained host publish (never a naive all-interfaces publish)"]);
      out.push([!/faff-contract:/.test(t),
                "carries NO faff-contract block (the result is consumed inline by env, not gated)"]);
      break;
  }
  return out;
}

// FAFF-678: voice-pointer lint — the gateway's `House voice:` clause names a canonical path; every
// other SKILL.md quoting that clause must name the SAME path, and (only when linting faff's own
// source tree) the path must resolve on disk. This is what would have caught PR #500: the pointer
// went stale, the clause's own fallback failed open by design, and nothing else was watching it.
// Three legs, run in order:
//   1. Extract the canonical token from the gateway's `House voice:` line (first backticked token
//      containing "/" or ending ".md"). No gateway file at all -> skip silently (the sibling fixture
//      suites spawn against a gateway-less tmpdir and must keep passing). Gateway present but the
//      clause or its path-shaped token is missing -> hard fail, but ONLY in the source tree — an
//      absent clause is exactly the drift this lint exists to catch, so reusing the "no gateway"
//      skip here would make the guard silently vacuous in the one case that matters.
//   2. Agreement — every other SKILL.md line mentioning the voice (case-insensitive "house voice" /
//      "voice rules" / "the voice") that carries a path-shaped backticked token must name the same
//      canonical token. A mismatch is a partial repoint.
//   3. Resolution — the canonical token must exist on disk, checked only when the resolved root
//      looks like faff's own source tree (an `eval/` dir present — the same marker
//      loadSeamRegistryForLint() uses). `--root` drives this leg explicitly so a fixture under
//      `--skills-dir` is judged on its own root, never the surrounding checkout (fixture isolation).
function extractVoicePathToken(line) {
  const backticked = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return backticked.find((t) => /[A-Za-z0-9]/.test(t) && (t.includes("/") || t.endsWith(".md"))) || null;
}
function lintVoicePointer(args, skillsDir, allSkills) {
  const findings = [];
  // FAFF-607: post-split the `House voice:` clause (the Voice clause under Sibling-skill invocation)
  // lives in faff/references/kernel.md; read it there, falling back to the bare gateway for a
  // pre-split tree.
  const kernelPath = path.join(skillsDir, "faff", "references", "kernel.md");
  const gatewayPath = fs.existsSync(kernelPath) ? kernelPath : path.join(skillsDir, "faff", "SKILL.md");
  if (!fs.existsSync(gatewayPath)) return findings; // leg 1, no-gateway case: skip silently

  const { values } = parseArgs(args, VALIDATE_ADAPTERS_SPEC);
  const root = values["--root"] !== undefined ? values["--root"] : path.resolve(HERE, "..", "..", "..", "..");
  const inSourceTree = fs.existsSync(path.join(root, "eval"));

  const gatewayLine = fs.readFileSync(gatewayPath, "utf8").split("\n").find((l) => l.includes("House voice:"));
  const canonical = gatewayLine ? extractVoicePathToken(gatewayLine) : null;
  if (!gatewayLine || !canonical) {
    if (inSourceTree) {
      findings.push("faff/SKILL.md: no `House voice:` clause with a path-shaped token found — the voice-pointer guard has nothing to check against (FAFF-678)");
    }
    return findings; // leg 1, gateway-present-but-clause-missing case
  }

  // leg 2: agreement
  const VOICE_MENTION = /house voice|voice rules|the voice/i;
  for (const name of allSkills) {
    if (name === "faff") continue;
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    for (const line of text.split("\n")) {
      if (!VOICE_MENTION.test(line)) continue;
      const tok = extractVoicePathToken(line);
      if (tok && tok !== canonical) {
        findings.push(`${name}/SKILL.md: names voice source "${tok}", gateway names "${canonical}" — partial repoint (FAFF-678)`);
      }
    }
  }

  // leg 3: resolution — source tree only
  if (inSourceTree && !fs.existsSync(path.resolve(root, canonical))) {
    findings.push(`voice source does not resolve: "${canonical}" (FAFF-678)`);
  }

  return findings;
}

function resolveSkillsDir(args) {
  const { values } = parseArgs(args, VALIDATE_ADAPTERS_SPEC);
  if (values["--skills-dir"] !== undefined) return values["--skills-dir"];
  // script-relative: faff lives at skills/faff/bin/, so the skills root is two up
  // (sentinel: faffidavit-routing — a surviving sibling adaptor; FAFF-109 retired faffidavit-spec)
  const cand = path.resolve(HERE, "..", "..");
  return fs.existsSync(path.join(cand, "faffidavit-routing")) ? cand : "skills";
}

// Locate an occupant's SKILL.md under skillsDir. Accepts a bare skill name or a
// `plugin:skill` reference (tries the trailing segment too).
function locateSkill(skillsDir, occupant) {
  const cands = [occupant];
  if (occupant.includes(":")) cands.push(occupant.slice(occupant.lastIndexOf(":") + 1));
  for (const c of cands) {
    const p = path.join(skillsDir, c, "SKILL.md");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --configured: read .faffrc and structurally pre-flight the user's configured slot
// occupants. This is the on-demand twin of the runtime conformance gate — run it
// BEFORE an unattended build so a swapped-in occupant's structural drift surfaces
// now, not as an overnight park. Only the structural half; the semantic checks
// (maps-onto-not-redefines, stays-in-lane) still need the authoring-adaptors Validate face.
function validateConfigured(args, skillsDir) {
  const { values } = parseArgs(args, VALIDATE_ADAPTERS_SPEC);
  let root = values["--root"] !== undefined ? values["--root"] : null;
  root = root || findRoot();

  let data, cfgPath;
  try { [data, cfgPath] = loadConfig(root); }
  catch (e) {
    if (e.message === "legacy-config-name") {
      process.stderr.write(`validate-adapters --configured: legacy config filename found (${e.legacy.join(", ")}); faff uses only \`${CANONICAL_CONFIG}\` — rename it. (FAFF-50)\n`);
      return 2;
    }
    if (e.message === "multiple-config") {
      process.stderr.write(`validate-adapters --configured: multiple config files at ${root}; keep only one.\n`);
      return 2;
    }
    throw e;
  }

  const slots = (data && typeof data.slots === "object" && !Array.isArray(data.slots)) ? data.slots : {};
  const entries = Object.entries(slots).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) {
    console.log(cfgPath
      ? `no slots configured in ${path.relative(root, cfgPath)} — nothing to pre-flight (all slots use shipped defaults).`
      : "no config file found — nothing to pre-flight (all slots use shipped defaults).");
    return 0;
  }

  let failed = false;
  let linted = 0;
  for (const [slot, occupant] of entries) {
    const meta = SLOT_TYPES[slot];
    if (!meta) { console.log(`WARN  ${slot}: not a recognised faff slot — skipping`); continue; }
    if (REGISTRY[occupant]) {
      console.log(`pass  ${slot}: ${occupant} — shipped slot skill, conformant by construction`);
      continue;
    }
    const p = locateSkill(skillsDir, occupant);
    if (!p) {
      console.log(`WARN  ${slot}: ${occupant} — not found under ${skillsDir}; can't structurally pre-flight`);
      console.log(`        (third-party skill installed elsewhere — run /faffter-dark-authoring-adaptors Validate on it)`);
      continue;
    }
    linted++;
    const results = checksFor(meta, fs.readFileSync(p, "utf8"));
    const bad = results.filter(([ok]) => !ok).map(([, label]) => label);
    if (bad.length) {
      failed = true;
      console.log(`FAIL  ${slot}: ${occupant} (${meta.type})`);
      for (const label of bad) console.log(`        ✗ ${label}`);
    } else {
      console.log(`pass  ${slot}: ${occupant} (${meta.type}) — ${results.length} checks`);
    }
  }
  console.log("");
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${linted} configured occupant${linted === 1 ? "" : "s"} structurally linted)`);
  console.log("Structural half only — run /faffter-dark-authoring-adaptors Validate for the semantic checks (maps-onto-not-redefines, stays-in-lane).");
  return failed ? 1 : 0;
}

// FAFF-710: the deterministic bundled-membership predicate the runtime slot-conformance gate
// consults BEFORE deciding whether to run the LLM semantic Validate. It is a pure function of the
// occupant name + slot against REGISTRY/SLOT_TYPES — no .faffrc read, no filesystem probe — so it
// returns the same verdict under every harness. That is the whole point: the scope decision in
// front of the non-deterministic semantic gate is itself deterministic, so a bundled first-party
// occupant is exempted by mechanical lookup rather than an LLM reading of its identity.
//   exit 0 → name ∈ REGISTRY AND REGISTRY[name].type === SLOT_TYPES[slot].type (bundled, right slot)
//   exit 1 → foreign (not in REGISTRY) OR wrong-slot (in REGISTRY, type ≠ this slot's type) — validate
//   exit 2 → usage (missing/blank name, or missing/unknown slot)
// The --slot guard mirrors validateConfigured()'s own SLOT_TYPES[slot] lookup, so the predicate and
// the --configured lint agree on what "the right skill for this slot" means, and the exemption never
// widens to bare name-membership across every REGISTRY key.
function bundledSlotStatus(name, slot) {
  const reg = Object.hasOwn(REGISTRY, name) ? REGISTRY[name] : null;
  if (!reg) return "foreign";
  return reg.type === SLOT_TYPES[slot].type ? "bundled" : "wrong-slot";
}

function cmdIsBundled(args) {
  const { values, errors } = parseArgs(args, VALIDATE_ADAPTERS_SPEC);
  if (errors.length) return usageError(errors, "usage: faff validate-adapters --is-bundled <occupant> --slot <slot>");
  const name = typeof values["--is-bundled"] === "string" ? values["--is-bundled"].trim() : "";
  const slot = typeof values["--slot"] === "string" ? values["--slot"].trim() : "";
  if (!name) {
    process.stderr.write("validate-adapters --is-bundled: missing/blank occupant name\n");
    return 2;
  }
  const slotMeta = SLOT_TYPES[slot];
  if (!slotMeta) {
    process.stderr.write(`validate-adapters --is-bundled: missing/unknown --slot (got "${slot || "<none>"}"; known: ${Object.keys(SLOT_TYPES).join(", ")})\n`);
    return 2;
  }
  const status = bundledSlotStatus(name, slot);
  if (status === "foreign") {
    console.log(`${name}: foreign (not in REGISTRY) — semantic Validate applies`);
    return 1;
  }
  if (status === "wrong-slot") {
    console.log(`${name}: bundled but wrong slot (registered ${REGISTRY[name].type}, occupies ${slot}:${slotMeta.type}) — semantic Validate applies`);
    return 1;
  }
  console.log(`${name}: bundled first-party for slot ${slot} — conformant by construction`);
  return 0;
}

// FAFF-963: gateway-usage manifest lint. Shells out to the ESM planner's `--check-manifest --json`
// (validate-adapters is CJS; the planner is ESM) so the gateway-heading parse stays single-source in
// `segmentGateway` — no second parser to drift. Structural + reference violations FAIL the run (exit 1,
// folded into `failed`); a missing/unparseable manifest is fail-loud (exit 2, harness-can't-run),
// mirroring the seam-registry / frontier.json precedent. A root with no eval/ harness (a fixture
// skills-dir) has no planner to run and is a clean no-op, exactly as the seam block skips an absent
// registry. Usage drift is NOT checked here — it is advisory (`--drift`), never a CI gate.
// A hung planner fails this lint by name instead of stalling every caller's spawn.
const PLANNER_TIMEOUT_MS = 60_000;

function lintGatewayManifest(root, reportFailure = console.log) {
  const plannerPath = path.join(root, "eval", "prefix-planner.mjs");
  if (!fs.existsSync(plannerPath)) return { failed: false, exit2: false };
  try {
    execFileSync(process.execPath, [plannerPath, "--check-manifest", "--json"], { encoding: "utf8", timeout: PLANNER_TIMEOUT_MS, killSignal: "SIGKILL" });
  } catch (err) {
    if (err.status === 2) {
      reportFailure(`FAIL  eval/baselines/gateway-usage.json (gateway-usage manifest)`);
      reportFailure(`        ✗ manifest missing or unparseable — the CI lint cannot read the declared block→consumer matrix (FAFF-963: exit 2)`);
      return { failed: true, exit2: true };
    }
    if (err.status === 1) {
      let parsed = null;
      try { parsed = JSON.parse(err.stdout || ""); } catch { parsed = null; }
      reportFailure(`FAIL  eval/baselines/gateway-usage.json (gateway-usage manifest)`);
      const violations = parsed ? [...(parsed.structural || []), ...(parsed.reference || [])] : [];
      if (violations.length) for (const v of violations) reportFailure(`        ✗ ${v}`);
      else reportFailure(`        ✗ ${(err.stdout || err.message || "").trim()}`);
      return { failed: true, exit2: false };
    }
    // Any other exit is an unexpected harness fault, not a content FAIL.
    reportFailure(`FAIL  eval/baselines/gateway-usage.json (gateway-usage manifest)`);
    reportFailure(`        ✗ prefix-planner --check-manifest failed unexpectedly: ${err.message}`);
    return { failed: true, exit2: true };
  }
  console.log(`pass  gateway-usage manifest`);
  return { failed: false, exit2: false };
}

// FAFF-1416: faff-graft's Step 9b opens the PR through one command, `faff pr open`, which owns the
// anchor-before-PR order (FAFF-1001) and the no-broad-swallow anchor commit (FAFF-1005) as tested code
// (test/pr-open.test.mjs pins both on its recorded call sequence). This lint keeps the prose from
// re-growing its own sequence: the bounded Step 9b section must invoke `faff pr open` (with its flags) in a code span,
// and no code span in it may invoke `gh pr create`, `faff pr-create`, `faff pr-body`, `faff events
// anchor` or `git push` directly. Only code spans count, so prose that names a command it forbids
// stays clean. Pure (exported for unit tests); the fail-closed absent-section policy lives at the
// call site.
function collectStep9bCodeSpans(section) {
  const spans = [];
  let inFence = false;
  let fenced = [];
  for (const line of section.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (inFence) { for (const l of fenced) spans.push(l); }   // closing fence: commit the buffered block
      fenced = [];
      inFence = !inFence;
      continue;
    }
    if (inFence) { fenced.push(line); continue; }
    for (const m of line.matchAll(/`([^`]+)`/g)) spans.push(m[1]);
  }
  // An unterminated fence leaves its lines uncommitted: malformed markdown must not turn trailing
  // prose into whole-line spans and raise a false FAIL.
  return spans;
}
// `faff"?` also matches the `"$faff" <verb>` shell form the skills use.
const STEP9B_DIRECT_CALLS = [
  ["gh pr create", /\bgh\s+pr\s+create\b/],
  ["faff pr-create", /\bfaff"?\s+pr-create\b/],
  ["faff pr-body", /\bfaff"?\s+pr-body\b/],
  ["faff events anchor", /\bfaff"?\s+events\s+anchor\b/],
  ["git push", /\bgit\s+push\b/],
];
// An invocation carries flags; a bare `faff pr open` mention in prose does not count as the call.
const STEP9B_PR_OPEN_CALL = /\bfaff"?\s+pr\s+open\s+--/;
function checkStep9bPrOpen(text) {
  const start = text.indexOf("**Step 9b:");
  const end = text.indexOf("**Step 10:", start + 1);
  if (start === -1 || end === -1) return { scoped: false, ok: true, invokesPrOpen: false, hits: [] };
  const spans = collectStep9bCodeSpans(text.slice(start, end));
  const invokesPrOpen = spans.some((s) => STEP9B_PR_OPEN_CALL.test(s));
  const hits = [];
  for (const span of spans) for (const [name, re] of STEP9B_DIRECT_CALLS) if (re.test(span)) hits.push({ name, span });
  return { scoped: true, ok: invokesPrOpen && hits.length === 0, invokesPrOpen, hits };
}

// FAFF-1009: capture-wiring lint. Every kernel that mints a base record in-kernel (calls
// captureDecision) needs a `decide --export` co-located with its consult, or the base reads an
// empty correlation_id and grades nothing (decision-capture.js empty-id note). This gate derives
// the kernel set from source and asserts each is wired, fail-closed. It follows lint-cli-coverage's
// "declared, not grep-guessed" shape: the authoritative set comes from the source calls, never a
// prose grep for a bare kernel name.
const CAPTURE_WIRING_WINDOW = 15; // lines between a `faff <k>` consult and its `decide --export`

// Read the balanced call-argument text starting at the "(" of a captureDecision( call. Tracks string
// literals so a paren inside a string never mis-balances the scan. Returns null if unbalanced.
function balancedCallArg(src, openParenIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return src.slice(openParenIdx + 1, i); }
  }
  return null;
}

// Derive the kernel set from source with a brace-aware read of every captureDecision({ ... kernel:
// "<k>" ... }) call across plugin/skills/faff/bin/lib/*.js. The multi-line form (claim-verdict,
// park-verdict, eligible) is read across newlines, so a single-line regex cannot drop it and fail
// open. Assumes a literal string kernel argument (no computed name exists today). Throws on a read
// error so the caller can map it to a hard tooling failure (exit 2), never a silent pass.
function deriveCaptureKernels(libDir) {
  const files = fs.readdirSync(libDir).filter((f) => f.endsWith(".js")).sort();
  const kernels = new Set();
  const needle = "captureDecision(";
  for (const f of files) {
    const src = fs.readFileSync(path.join(libDir, f), "utf8");
    let idx = 0;
    while ((idx = src.indexOf(needle, idx)) !== -1) {
      const openParen = idx + needle.length - 1;
      const arg = balancedCallArg(src, openParen);
      idx = openParen + 1;
      if (arg == null) continue;
      const m = arg.match(/\bkernel\s*:\s*["']([^"']+)["']/);
      if (m) kernels.add(m[1]);
    }
  }
  return [...kernels].sort();
}

// FAFF-1434 / FAFF-1418: a composing command that captures a kernel's base in-process, under a consult
// id it mints itself (mintConsultCorrelationId), wires that kernel wherever a SKILL.md really runs it:
// no env crosses a shell, so no `decide --export` is needed. Each entry is narrow by construction:
//  - `covers` is the operator-decided set (2026-11-01): only kernels no skill drives itself. graft admit
//    covers `next` and `eligible` (never `claim-verdict`, which faff-tidy drives); run trigger covers
//    `run-outward` and `run-start`;
//  - it applies only while the module's non-comment code calls mintConsultCorrelationId and captures the
//    kernel through the entry's own capture call (`capture`), so a commented-out or renamed capture stops
//    counting;
//  - it counts only a real invocation carrying each of the entry's `required` flags with a value
//    (isInProcessInvocation), in a fenced block or an un-negated code span, never prose or a heredoc;
//  - a covered kernel that some skill also drives with its own `decide --export` fails the lint
//    (inProcessDriven), so the route can never hide a driver.
const IN_PROCESS_CAPTURE = [
  { module: "graft-admit.js", verb: ["graft", "admit"], required: ["--mode", "--facts", "--run-dir"], stdin: ["--facts"], capture: /\.base\(\s*["']([^"']+)["']/g, covers: ["eligible", "next"] },
  { module: "run-trigger.js", verb: ["run", "trigger"], required: ["--run-dir"], capture: /\bsafeMint\(\s*["']([^"']+)["']/g, covers: ["run-outward", "run-start"] },
  { module: "run-wave-consult.js", verb: ["run", "wave-consult"], required: ["--run-dir", "--wave"], capture: /\bcapture\(\s*["']([^"']+)["']/g, covers: ["queue-state", "run-done"] },
];

const commandOf = (verb) => `faff ${verb.join(" ")}`;

// Strip // and /* */ comments from JavaScript source, keeping string, template and regex literals.
function stripJsComments(src) {
  let out = "";
  let prev = "";
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    const nx = src[i + 1];
    if (ch === "/" && nx === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && nx === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; out += " "; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1); prev = ch; i = j + 1; continue;
    }
    if (ch === "/" && (prev === "" || "(,=:[!&|?{};".includes(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j += 1;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j += 1;
      }
      out += src.slice(i, j + 1); prev = "/"; i = j + 1; continue;
    }
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return out;
}

// The route entries whose module's live code still mints consult ids, each with `kernels` (what its
// code captures through the entry's capture call) and `wires` (its cover list narrowed to those).
// Returns [] when no module is present.
function deriveInProcessCapture(libDir, entries = IN_PROCESS_CAPTURE) {
  const out = [];
  for (const { module: mod, verb, required, stdin = [], capture, covers } of entries) {
    const file = path.join(libDir, mod);
    if (!fs.existsSync(file)) continue;
    const code = stripJsComments(fs.readFileSync(file, "utf8"));
    if (!code.includes("mintConsultCorrelationId(")) continue;
    const kernels = [...new Set([...code.matchAll(new RegExp(capture.source, "g"))].map((m) => m[1]))].sort();
    out.push({ module: mod, verb, required, stdin, kernels, wires: covers.filter((k) => kernels.includes(k)).sort() });
  }
  return out;
}

// Replace each balanced `$(…)` command substitution with one opaque token, so flags inside it never
// count for the outer command and its pipes or `&&` never split the outer one.
function maskSubstitutions(line) {
  let out = "";
  for (let i = 0; i < line.length;) {
    if (line[i] === "$" && line[i + 1] === "(") {
      let depth = 0;
      let j = i + 1;
      for (; j < line.length; j++) {
        if (line[j] === "(") depth++;
        else if (line[j] === ")") { depth--; if (depth === 0) break; }
      }
      out += "__SUBST__";
      i = j + 1;
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

// A word that negates a command in its sentence: "never run …", "… must never be run", "do not …".
const NEGATION_RE = /\b(?:never|not|don['’]t|doesn['’]t|cannot|can['’]t|mustn['’]t|shouldn['’]t|avoid)\b/i;
const SENTENCE_END_RE = /[.!?]\s|\n\s*\n|\n\s*[-*]\s|\|/g;

// Blank every inline code span to spaces (same length), so span contents neither end a sentence nor
// negate one.
const blankSpans = (t) => t.replace(/`[^`\n]*`/g, (x) => " ".repeat(x.length));

// The sentence around [start, end) in `masked`: back to the previous sentence end, blank line, list item
// or table cell, and forward to the next one.
function sentenceAround(masked, start, end) {
  let cut = 0;
  for (const b of masked.slice(0, start).matchAll(SENTENCE_END_RE)) cut = b.index + b[0].length;
  const tail = masked.slice(end);
  const next = tail.search(/[.!?]\s|\n\s*\n|\n\s*[-*]\s|\|/);
  return masked.slice(cut, start) + " " + (next < 0 ? tail : tail.slice(0, next));
}

// The last sentence of the paragraph a fence follows (blank lines before the fence skipped).
function sentenceBefore(text, start) {
  const before = blankSpans(text.slice(0, start)).replace(/\s+$/, "");
  let cut = 0;
  for (const b of before.matchAll(SENTENCE_END_RE)) cut = b.index + b[0].length;
  return before.slice(cut);
}

// Every shell command a SKILL.md shows as code: each logical line of a fenced block (backslash
// continuations joined, heredoc bodies dropped) unless the fence follows a negating sentence, and each
// inline code span whose sentence does not negate it, split into simple commands at |, ||, && and ;
// after masking `$(…)`.
function codeCommands(text) {
  const lines = [];
  const rest = text.replace(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm, (m, body, offset) => {
    if (NEGATION_RE.test(sentenceBefore(text, offset))) return "\n\n";
    let heredoc = null;
    for (const line of body.replace(/\\\n/g, " ").split("\n")) {
      if (heredoc !== null) { if (line.trim() === heredoc) heredoc = null; continue; }
      lines.push(line);
      const h = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (h) heredoc = h[2];
    }
    return "\n\n";
  });
  const masked = blankSpans(rest);
  for (const m of rest.matchAll(/`([^`\n]+)`/g)) {
    if (NEGATION_RE.test(sentenceAround(masked, m.index, m.index + m[0].length))) continue;
    lines.push(m[1]);
  }
  return lines.map(maskSubstitutions).flatMap((l) => l.split(/\|\||&&|[|;]/)).map((c) => c.trim()).filter(Boolean);
}

// A simple command that runs `faff <verb…>` with each required flag carrying a value of its own: the
// next token, or `--flag=value`. A value never starts with `-` (it would be another flag), except a lone
// `-` for a flag listed in `stdin` (`--facts -` reads stdin). A masked `$(…)` is never a flag.
function isInProcessInvocation(command, verb, required, stdin = []) {
  const toks = command.split(/\s+/);
  let i = 0;
  while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
  if (!/^(?:"?\$faff"?|faff)$/.test(toks[i] || "")) return false;
  if (verb.some((v, k) => toks[i + 1 + k] !== v)) return false;
  const args = toks.slice(i + 1 + verb.length);
  const okValue = (flag, v) => v !== undefined && v !== "" && (!v.startsWith("-") || (v === "-" && stdin.includes(flag)));
  const valued = (flag) => {
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq !== undefined) return okValue(flag, eq.slice(flag.length + 1));
    const j = args.indexOf(flag);
    return j >= 0 && okValue(flag, args[j + 1]);
  };
  return required.every(valued);
}

// The covered kernels some SKILL.md really wires through an in-process capturing command, each mapped to
// the entry that wires it.
function inProcessWiredKernels(skillsDir, inProcess) {
  return new Set(inProcessRoutes(skillsDir, inProcess).keys());
}
function inProcessRoutes(skillsDir, inProcess) {
  const texts = fs.readdirSync(skillsDir)
    .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md")))
    .map((d) => fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf8"));
  const commands = texts.flatMap((t) => codeCommands(t));
  const routes = new Map();
  for (const entry of inProcess) {
    if (commands.some((c) => isInProcessInvocation(c, entry.verb, entry.required, entry.stdin))) for (const k of entry.wires) if (!routes.has(k)) routes.set(k, entry);
  }
  return routes;
}

// Covered kernels that some SKILL.md also drives with its own `decide --kernel <k> --export`, each
// with the skill that does. Such a kernel is never exempted, and its presence fails the lint.
function inProcessDriven(skillsDir, kernels) {
  const out = [];
  const skills = fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).sort();
  for (const k of kernels) {
    const kRe = flaggedKernelRe(k);
    for (const d of skills) {
      const lines = fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf8").split("\n");
      if (lines.some((l) => /\bdecide\b/.test(l) && /--export\b/.test(l) && kRe.test(l))) { out.push({ kernel: k, skill: d }); break; }
    }
  }
  return out;
}

// A structural token match on the flagged `--kernel <k>`, never a naive substring: the kernel name
// must be a whole flag argument (no trailing word/hyphen char), so `--kernel run` never matches
// `--kernel run-start`.
function flaggedKernelRe(kernel) {
  const esc = kernel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`--kernel\\s+${esc}(?![\\w-])`);
}
function consultRe(kernel) {
  const esc = kernel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\bfaff\\s+${esc}(?![\\w-])`);
}

// FAFF-1014: order-aware capture-wiring test. A kernel <k> is wired in a SKILL.md file iff EITHER
// (a) a `decide ... --kernel <k> ... --export` driver line states, on that same line, that the export
//     runs `before` the consult (the word "before", case-insensitive — one real note capitalises it —
//     plus a "consult" reference or a literal `faff <k>` on the line); OR
// (b) a driver line at index d precedes a `faff <k>` consult at index c in the same file, with d < c
//     and (c - d) <= CAPTURE_WIRING_WINDOW; OR
// (c) FAFF-1394: one code span evals the driver and then runs `faff <k>` after `&&`, which orders
//     the export before the consult by construction (sameCommandSpanRe).
// Predicate (a) matches the eight same-sentence capture notes (driver and consult on one line, d == c);
// predicate (b) matches project-next's genuine distinct driver line and any future correctly-separated
// site. The old order-agnostic `Math.abs(d - c)` pairing is gone: a driver that sits after its consult
// with no same-line "before" assertion no longer counts as wired.
// FAFF-1394: one code span that evals `decide … --kernel <k> … --export` and then runs `faff <k>`
// after `&&`, so the export and the consult share one shell.
function sameCommandSpanRe(kernel) {
  const esc = kernel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`eval \"\\$\\(faff decision-capture decide [^`]*--kernel\\s+" + esc +
    "(?![\\w-])[^`]*--export\\)\"\\s*&&\\s*faff\\s+" + esc + "(?![\\w-])[^`]*`");
}
const beforeRe = /\bbefore\b/i;
const consultWordRe = /\bconsult/i;
function captureWiringUnwired(skillsDir, kernels, inProcessWired = new Set()) {
  const skillDirs = fs.readdirSync(skillsDir)
    .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).sort();
  const perFile = skillDirs.map((d) => fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf8").split("\n"));
  const unwired = [];
  for (const k of kernels) {
    if (inProcessWired.has(k)) continue;
    const cRe = consultRe(k);
    const kRe = flaggedKernelRe(k);
    const isDecideExport = (line) => /\bdecide\b/.test(line) && /--export\b/.test(line) && kRe.test(line);
    const sameRe = sameCommandSpanRe(k);
    let wired = false;
    outer:
    for (const lines of perFile) {
      const consults = [];
      const decides = [];
      for (let i = 0; i < lines.length; i++) {
        if (cRe.test(lines[i])) consults.push(i);
        if (isDecideExport(lines[i])) decides.push(i);
      }
      // (a) same-line order assertion: a driver line that says the export runs "before" the consult.
      for (const d of decides) {
        if (beforeRe.test(lines[d]) && (consultWordRe.test(lines[d]) || cRe.test(lines[d]))) {
          wired = true;
          break outer;
        }
      }
      // (c) one command: the driver's eval, then `&& faff <k>`.
      if (lines.some((l) => sameRe.test(l))) { wired = true; break outer; }
      // (b) distinct-line driver precedes a nearby consult (d < c, within the window).
      for (const d of decides) {
        for (const c of consults) {
          if (d < c && (c - d) <= CAPTURE_WIRING_WINDOW) { wired = true; break outer; }
        }
      }
    }
    if (!wired) unwired.push(k);
  }
  return unwired;
}

// FAFF-1394: each tool call runs in a fresh shell, so an `eval "$(… decide … --export)"` in one call
// never reaches a kernel consulted in the next, and the in-kernel base reads an empty correlation_id.
// A kernel is same-command wired iff some SKILL.md holds one code span that evals its
// `decide … --kernel <k> … --export` and then runs `faff <k>` after `&&`.
function captureSameCommandUnwired(skillsDir, kernels, inProcessWired = new Set()) {
  const skillDirs = fs.readdirSync(skillsDir)
    .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).sort();
  const texts = skillDirs.map((d) => fs.readFileSync(path.join(skillsDir, d, "SKILL.md"), "utf8"));
  return kernels.filter((k) => {
    if (inProcessWired.has(k)) return false;
    const span = sameCommandSpanRe(k);
    return !texts.some((t) => span.test(t));
  });
}

function cmdValidateAdapters(args) {
  if (args[0] === "scaffold" || args[0] === "check") {
    const profiles = Object.fromEntries(Object.entries(SLOT_TYPES).map(([slot, profile]) => [
      slot, { ...profile, ...REGISTRY[DEFAULTS[`slots.${slot}`]] },
    ]));
    return require("./slot-authoring").cmdSlotAuthoring(args[0], args.slice(1), {
      profiles, producerArtifacts: PRODUCER_ARTIFACTS, methodologyOutputs: REQUIRED_METHODOLOGY_OUTPUTS,
      checksFor, readJudgementSeam, referBack: REFER_BACK, nonNormative: NON_NORMATIVE, resolveSkillsDir, locateSkill,
    });
  }
  if (args.includes("--is-bundled")) return cmdIsBundled(args);
  const { values, errors } = parseArgs(args, VALIDATE_ADAPTERS_SPEC);
  if (errors.length) return usageError(errors, "usage: faff validate-adapters [--configured] [--skills-dir DIR] [--root DIR] | --is-bundled <occupant> --slot <slot>");
  // FAFF-616: the shared root every seam-block fs read (registry, cases, frontier) resolves against —
  // `--root` if supplied, else the HERE-relative default. Resolved once here, threaded through
  // loadSeamRegistryForLint below, and reused verbatim for the C2 casesDir + C3 frontier reads.
  const root = values["--root"] !== undefined ? values["--root"] : path.resolve(HERE, "..", "..", "..", "..");
  const skillsDir = resolveSkillsDir(args);
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    process.stderr.write(`validate-adapters: skills dir not found: ${skillsDir}\n`);
    return 2;
  }

  if (args.includes("--configured")) return validateConfigured(args, skillsDir);

  const present = fs.readdirSync(skillsDir)
    .filter((d) => (d.startsWith("faffidavit-") || d.startsWith("faffter-")) &&
                   fs.existsSync(path.join(skillsDir, d, "SKILL.md")))
    .sort();

  const failures = [];
  const inputs = { args, skillsDir, root, requireBaseline: values["--skills-dir"] === undefined };
  let status;
  try {
    status = lintBundledSkills(present, inputs, (line) => failures.push(line));
  } finally {
    for (const line of failures) console.log(line);
  }
  if (status !== 2) {
    const linted = present.filter((name) => !SKIP.has(name)).length;
    console.log("");
    console.log(`RESULT: ${status === 0 ? "PASS" : "FAIL"} (${linted} slot skills linted)`);
  }
  return status;
}

function lintBundledSkills(present, { args, skillsDir, root, requireBaseline }, reportFailure) {
  let failed = false;
  const uncovered = [];
  for (const name of present) {
    if (SKIP.has(name)) {
      // user-facing dev tool — must NOT carry the internal-only marker
      const skiptext = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      if (hasUserInvocableFalse(skiptext)) {
        failed = true;
        reportFailure(`FAIL  ${name} (user-facing dev tool)`);
        reportFailure(`        ✗ must NOT carry user-invocable: false (it is directly user-invocable)`);
      }
      continue;
    }
    const meta = REGISTRY[name];
    if (!meta) { uncovered.push(name); continue; }
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const results = checksFor(meta, text);
    // FAFF-77: the named contract must resolve to a schema on disk (the wiring-check's
    // "contract resolves" leg — needs the skills dir, so it lives here not in checksFor).
    if (meta.contract) {
      const schemaFile = path.join(skillsDir, "faff", "contracts", `${meta.contract}.schema.json`);
      results.push([fs.existsSync(schemaFile),
                    `contract ${meta.contract} resolves (skills/faff/contracts/${meta.contract}.schema.json present)`]);
    }
    results.push([hasUserInvocableFalse(text),
                  "frontmatter user-invocable: false (internal slot skill, hidden from the / menu)"]);
    const bad = results.filter(([ok]) => !ok).map(([, label]) => label);
    if (bad.length) {
      failed = true;
      reportFailure(`FAIL  ${name} (${meta.type})`);
      for (const label of bad) reportFailure(`        ✗ ${label}`);
    } else {
      console.log(`pass  ${name} (${meta.type}) — ${results.length} checks`);
    }
  }
  // FAFF-51: user-facing faff-* commands must NOT carry the internal-only marker
  const userCmds = fs.readdirSync(skillsDir)
    .filter((d) => /^faff(-|$)/.test(d) && fs.existsSync(path.join(skillsDir, d, "SKILL.md")))
    .sort();
  for (const name of userCmds) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    if (hasUserInvocableFalse(text)) {
      failed = true;
      reportFailure(`FAIL  ${name} (user command)`);
      reportFailure(`        ✗ must NOT carry user-invocable: false (it is a user / command)`);
    }
    // FAFF-54: every faff-* user command emits human-facing output, so its SKILL.md
    // must reference routing that output through the configured renderer. Presence
    // check only — see RENDERING_REF for the honest runtime-routing limit.
    // FAFF-607: exempt the bare-`/faff` router. Post-split faff/SKILL.md is routing + narrative only;
    // the Rendering / Universal-routing rule moved to faff/references/kernel.md, which every
    // output-emitting sub-skill Reads (and each still carries its own RENDERING_REF). The router
    // itself emits no adaptor-routed output.
    if (name !== "faff" && !RENDERING_REF.test(text)) {
      failed = true;
      reportFailure(`FAIL  ${name} (rendering pass)`);
      reportFailure(`        ✗ no rendering-pass reference — a faff-* command emits human-facing output and must route it through the configured renderer (gateway → Rendering, Universal-routing rule) (FAFF-54)`);
    }
    // FAFF-491/530/884: the turn-survival posture must be PRESENT in the skills that
    // carry it — faff-graft's build phase (Steps 7–9b) and, per FAFF-884, faff-beep-boop's
    // orchestrator dispatch + faff-prep's spec-review dispatch, the arms the inflightcheck
    // Stop hook now backstops. A subagent/orchestrator that self-backgrounds a dispatch and
    // ends its turn strands the run (live occurrences, FAFF-466/446/530 at the build altitude,
    // FAFF-884 at the orchestrator/prep altitude). Substring-only (case-insensitive), same
    // honesty caveat as FAFF-439: this asserts the instruction is PRESENT, not runtime-obeyed
    // — the background-fence + inflightcheck hooks are the mechanical floor. The anchor set is
    // per-skill (ANCHOR_PHRASES, module scope), each skill keyed on the literal phrases its own
    // prose carries.
    const anchors = ANCHOR_PHRASES[name];
    if (anchors) {
      const lower = text.toLowerCase();
      const missing = anchors.filter((p) => !lower.includes(p));
      if (missing.length) {
        failed = true;
        reportFailure(`FAIL  ${name} (turn-survival posture)`);
        reportFailure(`        ✗ missing turn-survival anchor phrase(s): ${missing.map((p) => JSON.stringify(p)).join(", ")} (case-insensitive; ANCHOR_PHRASES[${name}])`);
      }
    }
  }
  // FAFF-50: CLI-only config access — scan each SKILL.md for a shell hand-read of a config file via
  // the module-scoped HANDREAD guard (defined + documented above); config is resolved via `faff config`.
  const allSkills = fs.readdirSync(skillsDir)
    .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).sort();
  for (const name of allSkills) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    for (const line of text.split("\n")) {
      if (line.includes(".example")) continue;
      const m = line.match(HANDREAD);
      if (m) {
        failed = true;
        reportFailure(`FAIL  ${name} (config access)`);
        reportFailure(`        ✗ hand-reads the rc file ("${m[0].trim()}") — resolve config via \`faff config\`, never read the config file directly (FAFF-50)`);
        break;
      }
    }
  }
  // FAFF-172: delegation-conformance lint — a Skill-tool delegation site must name the sibling by its
  // canonical name, never a hardcoded install-mode literal (a leading-slash /faff-… or the faff: plugin
  // namespace). The FAFF-164 convention's notation is `<canonical-name>` skill … via the Skill tool, so
  // the delegation TARGET is the backtick bound to the word "skill" on a "via the Skill tool" line.
  // Keying on `<target>` skill (not any backtick on the line) is what avoids false-positiving on the
  // human-command slash prose that legitimately shares the line (e.g. "Prep now via `/faff-prep`? … invoke
  // the `faff-prep` skill via the Skill tool"): a human-command `/faff-…` reference is never in `…` skill
  // form. Reuses allSkills above. Enforces the gateway Sibling-skill-invocation convention.
  const DELEGATION_ANCHOR = /via the Skill tool/i;
  const isInstallModeLiteral = (tok) => tok.startsWith("/") || tok.startsWith("faff:");
  for (const name of allSkills) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(".example")) continue;
      if (!DELEGATION_ANCHOR.test(line)) continue;
      const targets = [...line.matchAll(/`([^`]+)`\s+skill\b/gi)].map((m) => m[1]);
      const bad = targets.find(isInstallModeLiteral);
      if (bad) {
        failed = true;
        reportFailure(`FAIL  ${name} (delegation conformance)`);
        reportFailure(`        ✗ line ${i + 1}: hardcoded install-mode literal "${bad}" at a Skill-tool delegation site —`);
        reportFailure(`          name the sibling by its canonical name and resolve per gateway → Sibling-skill invocation (FAFF-164/172)`);
      }
    }
  }
  // FAFF-191: prose-supplied-default lint — the deferred half of FAFF-182. Derives both check sets
  // from the registry at lint time (never a hardcoded copy — the registry is the single source):
  // rule (a) flags a redundant `-d` on a key the registry already defaults; rule (b) flags a
  // dispatch site (Skill-tool delegation or producer-subagent dispatch) that names a bundled slot
  // default literally instead of resolving it via `config get slots.<x>`. Both key on the
  // CONSTRUCTION, never on bare occurrence, so a documentation mention (the gateway Slots table,
  // config examples, narrative, a skill's own self-description) never flags. Reuses allSkills above.
  const registryKeys = new Set(Object.keys(DEFAULTS));
  const slotDefaults = new Set(
    Object.entries(DEFAULTS).filter(([k]) => k.startsWith("slots.")).map(([, v]) => v),
  );
  const DISPATCH_ANCHOR = /via the Skill tool|producer subagent|producer dispatch/i;
  const GET_WITH_D = /config get\s+`?([A-Za-z0-9_.<>-]+)`?[^\n]*\s-d\s/;
  for (const name of allSkills) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(".example")) continue;
      const m = line.match(GET_WITH_D);
      if (m && registryKeys.has(m[1])) {
        failed = true;
        reportFailure(`FAIL  ${name} (prose default)`);
        reportFailure(`        ✗ line ${i + 1}: redundant \`-d\` on registry key "${m[1]}" — the registry owns the default; drop the -d (drift vector) (FAFF-191)`);
      }
      if (DISPATCH_ANCHOR.test(line)) {
        const tokens = [...line.matchAll(/`([^`]+)`/g)].map((t) => t[1]);
        const bad = tokens.find((t) => slotDefaults.has(t));
        if (bad) {
          failed = true;
          reportFailure(`FAIL  ${name} (prose default)`);
          reportFailure(`        ✗ line ${i + 1}: dispatch site names bundled default "${bad}" — route through \`faff config get slots.<x>\` and name no default (FAFF-191)`);
        }
      }
    }
  }
  // FAFF-1198: removed-dispatch-key lint. Every dispatch site resolves through `faff dispatch resolve`;
  // prompt text never names a removed `models.*` / `effort.*` key or verb, and never reads `dispatch.*`
  // with `faff config get`. Scans every SKILL.md plus every references/*.md. `eval.model`, `data.effort`
  // and `dispatch.<lane>.model` do not match: the lookbehind refuses a preceding word character or dot.
  const REMOVED_DISPATCH_KEY = /(?<![\w.$-])(?:models|effort)\.(?:build_by_confidence|build_by_tier|build|prep_explore|spec_review|spec|methodology|intake|architecture|adr|<lane>|<slot>)(?!\w)/;
  const REMOVED_BUILD_FOR = /faff (?:models|effort) build-for/;
  const RAW_DISPATCH_READ = /faff config get\s+`?dispatch\./;
  const dispatchProseFiles = allSkills.flatMap((name) => {
    const refsDir = path.join(skillsDir, name, "references");
    const refs = fs.existsSync(refsDir) ? fs.readdirSync(refsDir).filter((f) => f.endsWith(".md")).sort().map((f) => path.join("references", f)) : [];
    return ["SKILL.md", ...refs].map((rel) => ({ name, rel, file: path.join(skillsDir, name, rel) }));
  });
  for (const { name, rel, file } of dispatchProseFiles) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const hits = [];
    lines.forEach((line, i) => {
      const key = line.match(REMOVED_DISPATCH_KEY);
      if (key) hits.push(`line ${i + 1}: ${key[0]} was removed; use its dispatch.<lane>.<field> key through faff dispatch resolve (FAFF-1198)`);
      const verb = line.match(REMOVED_BUILD_FOR);
      if (verb) hits.push(`line ${i + 1}: ${verb[0]} was removed; use faff dispatch resolve build (FAFF-1198)`);
      const raw = line.match(RAW_DISPATCH_READ);
      if (raw) hits.push(`line ${i + 1}: ${raw[0].trim()}: dispatch sites read dispatch: through faff dispatch resolve (FAFF-1198)`);
    });
    if (hits.length) {
      failed = true;
      reportFailure(`FAIL  ${rel === "SKILL.md" ? name : `${name}/${rel}`} (removed dispatch key)`);
      for (const h of hits) reportFailure(`        ✗ ${h}`);
    }
  }
  // FAFF-1207: commissaire `--issue` guard. Reuses the FAFF-1198 dispatchProseFiles set (every SKILL.md
  // + every references/*.md), so references prose is covered and the label convention is identical.
  // FAILs any skill-prose file that passes the deprecated `--issue` alias on a `faff commissaire`
  // invocation, while leaving every other command's own current `--issue` flag untouched.
  for (const { name, rel, file } of dispatchProseFiles) {
    const findings = lintCommissaireUnitId(fs.readFileSync(file, "utf8"));
    if (findings.length) {
      failed = true;
      reportFailure(`FAIL  ${rel === "SKILL.md" ? name : `${name}/${rel}`} (commissaire --issue)`);
      for (const f of findings) reportFailure(`        ✗ ${f}`);
    }
  }
  // FAFF-598: inline-enum-restatement lint — a skill hand-restating a lintable fixed-contract enum's
  // full value set (with per-value meaning) is exactly the drift class FAFF-582 caught; the remedy is
  // always the same pointer. Reuses allSkills above.
  for (const name of allSkills) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const findings = lintInlineEnumRestatement(text);
    if (findings.length) {
      failed = true;
      reportFailure(`FAIL  ${name} (inline enum restatement)`);
      for (const f of findings) reportFailure(`        ✗ ${f}`);
    }
  }

  // FAFF-678: voice-pointer lint — see lintVoicePointer for the three-leg description.
  {
    const voiceFindings = lintVoicePointer(args, skillsDir, allSkills);
    if (voiceFindings.length) {
      failed = true;
      reportFailure(`FAIL  voice-pointer (FAFF-678)`);
      for (const f of voiceFindings) reportFailure(`        ✗ ${f}`);
    }
  }

  // FAFF-120: skill-authoring charter — the lintable subset (docs/reference/skill-authoring.md). Per-file
  // rules (line cap, paragraph length, stray markers, heading collection) run in one pass; the
  // cross-file dedup detector collects significant-line windows here and reports after the loop; the
  // FAFF-584 anchor-existence lint resolves refs after the loop too (it needs every file's headings
  // pooled first, structurally identical to dupWindows). Reuses allSkills above.
  const dupWindows = new Map(); // block-key -> Set of skill names that contain it
  const headings = new Set(); // pooled, normalized ## / ### ... headings across every skill
  const linesByFile = new Map(); // name -> lines, retained for the anchor-resolution pass below
  for (const name of allSkills) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    const lines = text.split("\n");
    linesByFile.set(name, lines);

    // line cap — FAFF-584: a downward ratchet for the two SKILL_LINE_BASELINE hub files (zero
    // headroom; growth FAILs, a shrink below baseline prints a non-failing RATCHET advisory), the
    // shared lenient SKILL_LINE_CAP ceiling for everything else.
    const cap = SKILL_LINE_BASELINE[name] || SKILL_LINE_CAP;
    if (lines.length > cap) {
      failed = true;
      reportFailure(`FAIL  ${name} (line cap)`);
      reportFailure(`        ✗ SKILL.md is ${lines.length} lines (cap ${cap}) — split or lean it (FAFF-120 charter)`);
    } else if (Object.prototype.hasOwnProperty.call(SKILL_LINE_BASELINE, name) && lines.length < cap) {
      console.log(`RATCHET  ${name} — now ${lines.length} lines, below baseline ${cap}; lower the baseline to lock the reduction (FAFF-120)`);
    }

    // FAFF-1416: the Step 9b PR-open lint (faff-graft only). See checkStep9bPrOpen. FAFF-1004:
    // fail-CLOSED — an absent or partial Step 9b section is a FAIL, so a renamed or renumbered heading
    // cannot disable the guard while validate-adapters still exits 0. Other skills are unaffected.
    if (name === "faff-graft") {
      const step9b = checkStep9bPrOpen(text);
      if (!step9b.scoped) {
        failed = true;
        reportFailure(`FAIL  ${name} (Step 9b PR open)`);
        reportFailure(`        ✗ faff-graft must carry a bounded Step 9b section (the \`**Step 9b:\` … \`**Step 10:\` headings around the \`faff pr open\` call); none found — a renamed or renumbered heading silently disables this guard (FAFF-1004)`);
      } else if (!step9b.ok) {
        failed = true;
        reportFailure(`FAIL  ${name} (Step 9b PR open)`);
        if (!step9b.invokesPrOpen) reportFailure(`        ✗ Step 9b must open the PR with \`faff pr open\`, which owns the anchor-before-PR order and the anchor commit (FAFF-1416)`);
        for (const h of step9b.hits) reportFailure(`        ✗ Step 9b invokes \`${h.name}\` directly (span: ${h.span}); \`faff pr open\` runs it, in order (FAFF-1416)`);
      }
    }

    // paragraph / wall-of-text + stray markers + heading collection (per significant prose line)
    const sigLines = [];
    const seenHeadingsThisFile = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(".example")) continue;
      const stray = STRAY_TRANSCRIPT.test(line) ? "transcript run-id" : (STRAY_RETRO.test(line) ? "retrospective war-story phrase" : null);
      if (stray) {
        failed = true;
        reportFailure(`FAIL  ${name} (stray marker)`);
        reportFailure(`        ✗ line ${i + 1}: ${stray} — state the rule forward; war-stories belong in git history / ADRs / design, not the prompt (FAFF-120 charter)`);
      }

      // FAFF-584: heading collection — pools into `headings` for the anchor-resolution pass below,
      // and flags a heading text repeated within this one file (an anchor to it would be ambiguous).
      const headingMatch = line.match(HEADING_LINE);
      if (headingMatch) {
        const norm = normalizeHeading(headingMatch[2]);
        if (seenHeadingsThisFile.has(norm)) {
          console.log(`WARN  ${name} (ambiguous anchor) — heading "${headingMatch[2].trim()}" appears more than once; an anchor to it is ambiguous — rename one (FAFF-120)`);
        }
        seenHeadingsThisFile.add(norm);
        headings.add(norm);
      }

      // FAFF-584: isParagraphLine additionally selects bold-lead bullets (the house mega-bullet
      // style), closing the exemption that let them pass green regardless of length. isProseLine
      // itself is unchanged and keeps gating the dedup collection below (never widen that predicate).
      if (isParagraphLine(line)) {
        const words = line.trim().split(/\s+/).length;
        if (words > PARA_WORD_CAP) {
          if (isProseLine(line)) {
            failed = true;
            reportFailure(`FAIL  ${name} (paragraph)`);
            reportFailure(`        ✗ line ${i + 1}: ${words}-word paragraph (cap ${PARA_WORD_CAP}) — break it into bullets (FAFF-120 charter)`);
          } else {
            // selected only via the bold-lead-bullet branch of isParagraphLine — advisory, not a hard
            // FAIL (15 pre-existing over-cap bullets would red-CI the tree on landing; FAFF-584 §3).
            console.log(`WARN  ${name} (paragraph) — line ${i + 1}: ${words}-word bold-lead bullet (cap ${PARA_WORD_CAP}) — break it into sub-bullets (FAFF-120 charter)`);
          }
        }
      }

      if (isProseLine(line) && line.trim().length >= DUP_SIG_MINLEN) sigLines.push(line.trim());
    }

    // collect dedup windows from this skill's significant prose lines
    for (let k = 0; k + DUP_BLOCK_WINDOW <= sigLines.length; k++) {
      const key = sigLines.slice(k, k + DUP_BLOCK_WINDOW).join("\n");
      if (!dupWindows.has(key)) dupWindows.set(key, new Set());
      dupWindows.get(key).add(name);
    }
  }
  // FAFF-1442: per-file byte ratchet over every SKILL.md and references/*.md, on top of the line caps
  // above (which stay unchanged). A missing baseline fails on the bundled tree (no --skills-dir) and
  // only skips with an INFO line for an explicit skills dir.
  const prose = require("./prose-size").proseRatchet(skillsDir, requireBaseline);
  for (const line of prose.lines) {
    if (line.startsWith("FAIL  ") || line.startsWith("        ✗")) reportFailure(line);
    else console.log(line);
  }
  if (prose.failed) failed = true;
  // cross-file duplicated-block report (single-source it per FAFF-115)
  const reportedDup = new Set();
  for (const [key, names] of dupWindows) {
    if (names.size < 2) continue;
    const sig = [...names].sort().join(",");
    if (reportedDup.has(sig)) continue; // one report per offending file set
    reportedDup.add(sig);
    failed = true;
    reportFailure(`FAIL  ${[...names].sort().join(", ")} (duplicated block)`);
    reportFailure(`        ✗ ${DUP_BLOCK_WINDOW}+ identical lines shared across skills — give shared prose one home (gateway) and reference it, never copy (FAFF-120/115)`);
    reportFailure(`          first line: "${key.split("\n")[0].slice(0, 70)}"`);
  }
  // FAFF-607: pool the gateway kernel + reference headings into the anchor set, so an anchor whose
  // target section moved from the monolith into faff/references/*.md still resolves. Also retain the
  // reference bodies so their own cross-references (references cross-refer) are anchor-checked too.
  const faffRefDir = path.join(skillsDir, "faff", "references");
  const refFiles = fs.existsSync(faffRefDir)
    ? fs.readdirSync(faffRefDir).filter((f) => f.endsWith(".md")).sort()
    : [];
  const refLinesByFile = new Map();
  const refHeadingsByFile = new Map();
  for (const rf of refFiles) {
    const rlines = fs.readFileSync(path.join(faffRefDir, rf), "utf8").split("\n");
    refLinesByFile.set(rf, rlines);
    const set = new Set();
    let infence = false;
    for (const line of rlines) {
      if (line.trim().startsWith("```")) { infence = !infence; continue; }
      if (infence) continue;
      const hm = line.match(HEADING_LINE);
      if (hm) { const n = normalizeHeading(hm[2]); headings.add(n); set.add(n); }
    }
    refHeadingsByFile.set(rf, set);
  }

  // FAFF-584: anchor-existence lint — resolve every `→ **Target**` ref against the pooled headings
  // set collected above (FAFF-607 adds the kernel + reference headings to that pool). WARN-severity
  // (advisory): the ~200-occurrence anchor web has never been linted, so a hard gate on first pass
  // would red-CI the tree; this makes breakage visible instead. Resolves heading EXISTENCE only, not
  // the "A → B nests under A" claim (deliberately out of scope). Scans both SKILL.md files and — per
  // FAFF-607 — the reference bodies themselves.
  const anchorScan = (label, lines) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(".example")) continue;
      for (const m of line.matchAll(ANCHOR_REF)) {
        const target = m[1].trim();
        const segments = target.split(" → ");
        const leaf = normalizeHeading(segments[segments.length - 1]);
        if (anchorResolves(leaf, headings)) continue;
        console.log(`WARN  ${label} (anchor) — line ${i + 1}: "${target}" resolves to no heading (leaf "${leaf}") — fix the ref or the heading (FAFF-120)`);
      }
    }
  };
  for (const name of allSkills) anchorScan(name, linesByFile.get(name));
  for (const rf of refFiles) anchorScan(`faff/references/${rf}`, refLinesByFile.get(rf));

  // FAFF-607: gateway kernel/reference split lints — kernel line-cap ratchet, orphan-reference (FAIL),
  // and matrix-driven under-read completeness (FAIL). Only fires once the split has landed
  // (faff/references/ exists); a byte-for-byte no-op on a repo without it.
  if (refFiles.length) {
    // (a) kernel line-cap ratchet — the kernel is the split's lean target; cap it by path.
    const kernelPath = path.join(faffRefDir, "kernel.md");
    if (fs.existsSync(kernelPath)) {
      const klen = fs.readFileSync(kernelPath, "utf8").split("\n").length;
      if (klen > KERNEL_LINE_BASELINE) {
        failed = true;
        reportFailure(`FAIL  faff/references/kernel.md (kernel line cap)`);
        reportFailure(`        ✗ kernel is ${klen} lines (cap ${KERNEL_LINE_BASELINE}) — the kernel is the split's lean target; move prose to a lane reference, never grow the cap (FAFF-607)`);
      } else if (klen < KERNEL_LINE_BASELINE) {
        console.log(`RATCHET  faff/references/kernel.md — now ${klen} lines, below baseline ${KERNEL_LINE_BASELINE}; lower KERNEL_LINE_BASELINE to lock the reduction (FAFF-607)`);
      }
    }
    const skillText = new Map();
    for (const name of allSkills) skillText.set(name, fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8"));
    const namedRefs = (text) => new Set([...text.matchAll(/faff\/references\/([A-Za-z0-9_-]+\.md)/g)].map((m) => m[1]));
    // (b) orphan-reference lint (FAIL): a reference Read by no skill; a load-line naming a missing
    //     reference. kernel.md is exempt (universally Read).
    for (const rf of refFiles) {
      if (rf === "kernel.md") continue;
      const readers = allSkills.filter((n) => namedRefs(skillText.get(n)).has(rf));
      if (readers.length === 0) {
        failed = true;
        reportFailure(`FAIL  faff/references/${rf} (orphan reference)`);
        reportFailure(`        ✗ Read by no skill — fold it into the kernel or delete it (FAFF-607)`);
      }
    }
    for (const name of allSkills) {
      for (const rf of namedRefs(skillText.get(name))) {
        if (rf !== "kernel.md" && !refFiles.includes(rf)) {
          failed = true;
          reportFailure(`FAIL  ${name} (missing reference)`);
          reportFailure(`        ✗ Reads faff/references/${rf} which does not exist (FAFF-607)`);
        }
      }
    }
    // (c) under-read completeness lint (FAIL): a load-line carrier that consumes a gateway block (per
    //     the authoritative matrix eval/baselines/gateway-usage.json) placed in a reference, but omits
    //     that reference from its load-line. Placement = which reference holds the block's heading. An
    //     `unknown`-consumer reference-placed block degrades to WARN (its consumer set is uncomputable).
    const matrixPath = path.join(root, "eval", "baselines", "gateway-usage.json");
    if (fs.existsSync(matrixPath)) {
      let matrix = null;
      try { matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8")); } catch (e) { matrix = null; }
      if (matrix && Array.isArray(matrix.blocks)) {
        const placementOf = (title) => {
          const nt = normalizeHeading(title);
          for (const rf of refFiles) {
            if (rf !== "kernel.md" && refHeadingsByFile.get(rf).has(nt)) return rf;
          }
          return null; // kernel or bare gateway — imposes no reference requirement
        };
        // load-line carriers = skills that Read the kernel (the 20; empty before the load-lines land).
        const carriers = allSkills.filter((n) => namedRefs(skillText.get(n)).has("kernel.md"));
        for (const name of carriers) {
          const declared = namedRefs(skillText.get(name));
          const needed = new Set();
          for (const blk of matrix.blocks) {
            const cons = blk.consumers;
            const rf = placementOf(blk.title);
            if (!rf) continue; // kernel/bare-gateway block — no requirement
            if (cons === "unknown") {
              console.log(`WARN  faff/references/${rf} (under-read) — block "${blk.title}" has consumers:"unknown"; its consumer set is uncomputable, so under-read cannot verify it (FAFF-607/963)`);
              continue;
            }
            if (!Array.isArray(cons)) continue; // "all" blocks live in the kernel; "none" never placed
            if (cons.includes(name)) needed.add(rf);
          }
          const missing = [...needed].filter((rf) => !declared.has(rf));
          if (missing.length) {
            failed = true;
            reportFailure(`FAIL  ${name} (under-read)`);
            reportFailure(`        ✗ consumes gateway block(s) placed in ${missing.sort().join(", ")} (per gateway-usage.json) but its load-line does not Read them — add them (FAFF-607)`);
          }
        }
      }
    }
  }

  // FAFF-280: judgement-seam reconciliation — each skill's `judgement_seam:` frontmatter declaration
  // must agree with the seam→KIND registry (eval/seam-registry.json). `none` must own no registered
  // KIND; an unknown kind-id, or a declared-set ≠ expected-rows mismatch (with the FAFF-281 slot-
  // sibling relaxation), FAILS the skill. A missing/malformed registry (with an eval/ harness present)
  // fails loud. FAFF-281 adds the absent-key coverage gate (C1/C2) below. Reuses allSkills above;
  // surface == skill dir name.
  {
    const { registry: seamReg, error: seamErr, root: usedRoot } = loadSeamRegistryForLint(root);
    if (seamErr) {
      // FAFF-281: a missing/malformed registry (with an eval/ harness present) is a structural/harness
      // error, not a lint failure — fail loud with exit 2 (the "harness can't run" code, as for an
      // absent skills dir / uncovered slot skill), distinct from a content FAIL (exit 1).
      reportFailure(`FAIL  eval/seam-registry.json (seam registry)`);
      reportFailure(`        ✗ ${seamErr} — both consumers fail loud on a missing/malformed registry (FAFF-280/281: exit 2)`);
      return 2;
    } else if (seamReg) {
      for (const name of allSkills) {
        const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
        const bad = reconcileSeam(name, readJudgementSeam(text), seamReg, REGISTRY)
          .filter(([ok]) => !ok).map(([, label]) => label);
        if (bad.length) {
          failed = true;
          reportFailure(`FAIL  ${name} (judgement seam)`);
          for (const label of bad) reportFailure(`        ✗ ${label}`);
        }
      }

      // FAFF-281: eval-coverage gate (shipped-defaults only — this whole pass is after the early
      // --configured return). C1 — a registry SURFACE (the registry attributes ≥1 KIND to it, so a
      // declaration is owed and authorable) whose SKILL.md carries NO `judgement_seam:` key FAILS. A
      // REGISTRY slot-skill with no registry row yet (no KIND maps to it) is an advisory `undeclared`
      // line, NOT a fail — it flips to a hard C1 fail automatically the instant a backfill ticket adds
      // its registry row. C2 — a kind whose registry status is `covered` but has 0 live cases in
      // eval/cases/ FAILS (the dishonest state); `designed` with 0 cases is an advisory NEEDS-CASES,
      // never a fail. `cases_present` is derived live from eval/cases/, never stored.
      const surfaces = new Set(Object.values(seamReg.kinds).map((e) => e.surface));
      const c1Names = [...new Set([...Object.keys(REGISTRY), ...surfaces])].sort();
      for (const name of c1Names) {
        const skillFile = path.join(skillsDir, name, "SKILL.md");
        if (!fs.existsSync(skillFile)) continue;
        if (readJudgementSeam(fs.readFileSync(skillFile, "utf8")) !== null) continue; // declared — reconcile owns it
        if (surfaces.has(name)) {
          failed = true;
          reportFailure(`FAIL  ${name} (eval coverage)`);
          reportFailure(`        ✗ registry surface with no \`judgement_seam:\` declaration — the registry attributes a grader KIND to it; declare its seam KIND(s) (FAFF-281 C1)`);
        } else {
          console.log(`UNDECLARED  ${name} — REGISTRY slot skill, no judgement_seam key and no registry row yet (advisory; flips to FAIL when its backfill ticket registers a row)`);
        }
      }
      const casesDir = path.join(usedRoot, "eval", "cases");
      const caseFiles = fs.existsSync(casesDir) ? fs.readdirSync(casesDir) : [];
      const casesPresent = (kind) => caseFiles.filter((f) => f.startsWith(`${kind}-`) && f.endsWith(".json")).length;
      for (const [kind, entry] of Object.entries(seamReg.kinds)) {
        if (casesPresent(kind) > 0) continue;
        // FAFF-616: a `calibrated` claim is strictly stronger than `covered` — it cannot be case-empty
        // either, so the FAIL condition widens from {covered} to {covered, calibrated}.
        if (entry.status === "covered" || entry.status === "calibrated") {
          failed = true;
          reportFailure(`FAIL  eval/cases/${kind} (eval coverage)`);
          reportFailure(`        ✗ kind \`${kind}\` is registry-status \`${entry.status}\` but has 0 cases in eval/cases/ (FAFF-281 C2)`);
        } else if (entry.status === "designed") {
          console.log(`NEEDS-CASES  ${kind} (surface ${entry.surface}) — registry-status \`designed\`, 0 cases yet (advisory)`);
        }
      }

      // FAFF-616 C3: for each `calibrated` kind, confirm the committed frontier baseline backs the
      // claim (row exists, not a warn_kind, accuracy clears the floor). Runs after C1/C2, off the
      // same shared root. A missing/malformed frontier.json while a calibrated claim exists is
      // fail-loud (exit 2, harness-can't-run); a claim that reads fine but misses the floor is a
      // lint FAIL (exit 1, folded into `failed` below).
      const c3 = c3CalibrationFloor(seamReg, usedRoot, casesPresent, reportFailure);
      if (c3.exit2) return 2;
      if (c3.failed) failed = true;
    }
  }

  // FAFF-963: gateway-usage manifest lint (structural + reference). Runs after the seam block, off the
  // same shared root. Fail-loud (exit 2) on a missing/unparseable manifest; violations fold into `failed`.
  {
    const m = lintGatewayManifest(root, reportFailure);
    if (m.exit2) return 2;
    if (m.failed) failed = true;
  }

  // FAFF-1009: capture-wiring gate. Derive the captureDecision kernel set from source and assert each
  // is wired with an adjacent `decide --export` in some SKILL.md. Fail-closed: an unwired kernel FAILs
  // (exit 1, folded into `failed`); a source read error is a hard tooling failure (exit 2), never a pass.
  if (fs.existsSync(path.join(skillsDir, "faff", "bin", "lib")) &&
      fs.statSync(path.join(skillsDir, "faff", "bin", "lib")).isDirectory()) {
    const libDir = path.join(skillsDir, "faff", "bin", "lib");
    let kernels;
    let inProcess;
    try {
      kernels = deriveCaptureKernels(libDir);
      inProcess = deriveInProcessCapture(libDir);
    } catch (e) {
      reportFailure(`FAIL  capture-wiring (kernel-set derivation)`);
      reportFailure(`        ✗ could not read the captureDecision kernel set from ${libDir}: ${e && e.message} — fail-closed, never a pass (FAFF-1009: exit 2)`);
      return 2;
    }
    if (kernels.length === 0) {
      reportFailure(`FAIL  capture-wiring (kernel-set derivation)`);
      reportFailure(`        ✗ no captureDecision kernels derived from ${libDir} — the brace-aware match found nothing; fail-closed rather than vacuously pass (FAFF-1009: exit 2)`);
      return 2;
    }
    // FAFF-1434 / FAFF-1418: kernels a real in-process capturing invocation wires, minus any a skill also
    // drives itself (that combination fails here, so the route never hides a driver).
    const routes = inProcessRoutes(skillsDir, inProcess);
    const routed = new Set(routes.keys());
    const driven = inProcessDriven(skillsDir, [...routed].sort());
    if (driven.length) {
      failed = true;
      reportFailure(`FAIL  capture-wiring (in-process route, FAFF-1434)`);
      for (const { kernel, skill } of driven) {
        reportFailure(`        ✗ kernel "${kernel}" is covered by \`${commandOf(routes.get(kernel).verb)}\`'s in-process route but ${skill}/SKILL.md also drives it with its own \`decide --kernel ${kernel} --export\`; the route covers only kernels no skill drives, so drop it from IN_PROCESS_CAPTURE's covers`);
      }
    }
    const inProcessWired = new Set([...routed].filter((k) => !driven.some((d) => d.kernel === k)));
    // A covered kernel left unwired says so: the route found no real invocation to count.
    const coverEntry = (k) => inProcess.find((e) => e.wires.includes(k));
    const routeHint = (k) => {
      const e = coverEntry(k);
      if (e === undefined || routed.has(k)) return "";
      const cmd = commandOf(e.verb);
      return ` It is covered by \`${cmd}\`'s in-process route, but no SKILL.md runs \`${cmd} ${e.required.map((f) => `${f} …`).join(" ")}\` as one command in a fenced block or an un-negated code span (FAFF-1434).`;
    };
    // Name only the kernels that rely on the in-process route, so the pass line never hides a driver
    // that went missing behind one that a composing command also covers.
    const viaNote = (bare) => {
      const groups = new Map();
      for (const k of bare.filter((x) => inProcessWired.has(x))) {
        const cmd = commandOf(routes.get(k).verb);
        groups.set(cmd, [...(groups.get(cmd) || []), k]);
      }
      return [...groups].map(([cmd, ks]) => `; ${ks.join(", ")} via \`${cmd}\`'s in-process capture (FAFF-1434)`).join("");
    };
    const unwired = captureWiringUnwired(skillsDir, kernels, inProcessWired);
    if (unwired.length) {
      failed = true;
      reportFailure(`FAIL  capture-wiring (FAFF-1009)`);
      for (const k of unwired) {
        reportFailure(`        ✗ kernel "${k}" mints a base in-kernel but no SKILL.md states its \`decide --kernel ${k} --export\` runs before the \`faff ${k}\` consult — either same-line ("before ... consult" / "before ... faff ${k}") or as a distinct driver line preceding the consult within ${CAPTURE_WIRING_WINDOW} lines — so its base reads an empty correlation_id and grades nothing (FAFF-1009/FAFF-1014).${routeHint(k)}`);
      }
    } else {
      console.log(`pass  capture-wiring — all ${kernels.length} captureDecision kernels have an adjacent \`decide --export\` (FAFF-1009)${viaNote(captureWiringUnwired(skillsDir, kernels))}`);
    }
    const apart = captureSameCommandUnwired(skillsDir, kernels, inProcessWired);
    if (apart.length) {
      failed = true;
      reportFailure(`FAIL  capture-same-command (FAFF-1394)`);
      for (const k of apart) {
        reportFailure(`        ✗ kernel "${k}": no SKILL.md runs its driver and its consult in one command, \`eval "$(faff decision-capture decide … --kernel ${k} … --export)" && faff ${k} …\`. Each tool call is a fresh shell, so an export in one call never reaches a consult in the next and the base reads an empty correlation_id.${routeHint(k)}`);
      }
    } else {
      console.log(`pass  capture-same-command — all ${kernels.length} captureDecision kernels run \`decide --export\` and the consult in one command (FAFF-1394)${viaNote(captureSameCommandUnwired(skillsDir, kernels))}`);
    }
  }

  for (const n of Object.keys(REGISTRY)) {
    if (!present.includes(n)) console.log(`WARN  ${n} is registered but not present on disk`);
  }
  if (uncovered.length) {
    console.log("");
    for (const n of uncovered) {
      reportFailure(`UNCOVERED  ${n} — a shipped slot skill with no registered checks; add it to validate-adapters`);
    }
    return 2;
  }
  return failed ? 1 : 0;
}


module.exports = { ANCHOR_PHRASES, CAPTURE_WIRING_WINDOW, COMMISSAIRE_ISSUE_RE, DUP_BLOCK_WINDOW, DUP_SIG_MINLEN, HANDREAD, NON_NORMATIVE, PARA_WORD_CAP, REFER_BACK, REGISTRY, RENDERING_REF, REQUIRED_METHODOLOGY_OUTPUTS, SKILL_LINE_CAP, SKILL_LINE_BASELINE, KERNEL_LINE_BASELINE, SKIP, SLOT_TYPES, STRAY_RETRO, STRAY_TRANSCRIPT, balancedCallArg, c3CalibrationFloor, captureSameCommandUnwired, captureWiringUnwired, checkCalibrated, checkStep9bPrOpen, checksFor, bundledSlotStatus, cmdIsBundled, cmdValidateAdapters, deriveCaptureKernels, deriveInProcessCapture, inProcessWiredKernels, inProcessDriven, codeCommands, isInProcessInvocation, inProcessRoutes, maskSubstitutions, IN_PROCESS_CAPTURE, stripJsComments, extractVoicePathToken, hasUserInvocableFalse, inlineEnumLintSets, isProseLine, isParagraphLine, anchorResolves, normalizeHeading, lintCommissaireUnitId, lintGatewayManifest, lintInlineEnumRestatement, lintVoicePointer, loadSeamRegistryForLint, locateSkill, readJudgementSeam, reconcileSeam, resolveSkillsDir, validateConfigured };
