// ===========================================================================
// === region:factory — validate-adapters — structural conformance lint of the shipped slot skills ===
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
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
const SKILL_LINE_BASELINE = { faff: 1170, "faff-beep-boop": 720, "faff-graft": 634 };   // renamed from SKILL_LINE_CAP_OVERRIDE (FAFF-584). faff/faff-beep-boop: ratchet baselines, set to their exact committed size. faff-graft: unchanged carry-forward, see above. (FAFF-115 single-source gateway grows): FAFF-749 +2, FAFF-758 +2, FAFF-728 +1 gateway +14 beep-boop, FAFF-700 +7 gateway, FAFF-727 +10 gateway, FAFF-750 +2 gateway (concurrency obligation 7), FAFF-767 +1 beep-boop (surface intervention row) + faff-graft +2 (Step 10 dispatch-cut split + pr-ready return), FAFF-448 +6 gateway (decisions-register consult in Resolve-attempt before park) + faff-graft +6 (register-consult mirror + 3/5 bound-drift fix), FAFF-584 gateway ## Routing dedupe (line-neutral rename) + baseline re-pin to committed size, FAFF-699 +11 gateway (Interactive next-step offer subsection + Park-protocol recovery addendum), FAFF-761 +6 faff-graft (Step 3 standalone-interactive L2 mint block + Step 10 terminal outcome-write block)
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
const REFER_BACK = /Read[^\n]*\bfaff\/SKILL\.md/;
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
function c3CalibrationFloor(seamReg, root, _casesPresent) {
  const calibratedKinds = Object.entries(seamReg.kinds)
    .filter(([, entry]) => entry.status === "calibrated")
    .map(([kind]) => kind);
  if (calibratedKinds.length === 0) return { failed: false, exit2: false }; // no claim → nothing to read, nothing to fail

  const frontierPath = path.join(root, "eval", "baselines", "frontier.json");
  let baseline;
  if (!fs.existsSync(frontierPath)) {
    console.log(`FAIL  eval/baselines/frontier.json (calibration floor)`);
    console.log(`        ✗ eval/baselines/frontier.json not found (${frontierPath}) — a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)`);
    return { failed: true, exit2: true };
  }
  try {
    baseline = JSON.parse(fs.readFileSync(frontierPath, "utf8"));
  } catch (e) {
    console.log(`FAIL  eval/baselines/frontier.json (calibration floor)`);
    console.log(`        ✗ eval/baselines/frontier.json malformed JSON: ${e.message} — a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)`);
    return { failed: true, exit2: true };
  }
  if (!baseline || typeof baseline.per_kind !== "object" || baseline.per_kind === null) {
    console.log(`FAIL  eval/baselines/frontier.json (calibration floor)`);
    console.log(`        ✗ eval/baselines/frontier.json missing the \`per_kind\` map — a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)`);
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
      console.log(`FAIL  eval/baselines/frontier.json:${kind} (calibration floor)`);
      console.log(`        ✗ ${result.reason}`);
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
  evaluator: { type: "producer-evaluator", slot: "evaluator" },
  prd: { type: "producer-prd", slot: "prd" },
  review: { type: "producer-review" },
  ship: { type: "producer-ship" },
  // FAFF-231: the infra-profile acquirer slot. The shipped default occupant is the built-in
  // deterministic `faff profile mine` step (no skill — like `gates`); SLOT_TYPES lets a custom
  // swapped-in occupant be structurally linted: it must emit the faff-contract:infra-profile block.
  profile: { type: "producer-profile", slot: "profile" },
};

function checksFor(meta, t) {
  const out = [];
  const has = (s) => t.includes(s);
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
      out.push([has("faff-contract:spec-readiness"), "emits its `faff-contract:spec-readiness` artifact block"]);
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
    case "producer-review":
      out.push([has("faff-contract:review-verdict"), "emits its `faff-contract:review-verdict` artifact block"]);
      break;
    case "producer-spec-review":
      // FAFF-265/266: the spec-stage reviewer (FAFF-9 family) self-declares its verdict in a
      // faff-contract:spec-review-verdict block the consumer (faff-prep) parses and pipes to
      // `faff contract spec-review-verdict`. The default occupant is the L1–L3 single-pass
      // four-lens reviewer (FAFF-266); L4 per-lens refuters (FAFF-267) swap in via the same slot.
      out.push([has("faff-contract:spec-review-verdict"), "emits its `faff-contract:spec-review-verdict` artifact block"]);
      break;
    case "producer-architecture":
      // FAFF-27: the architecture PROPOSER (the missing generative box; FAFF-9's architectural lens is
      // the downstream CRITIC, they meet only through the spec artifact — ADR-0030). It self-declares its
      // best-fit proposal in a faff-contract:architecture-proposal block the consumer parses and pipes to
      // `faff contract architecture-proposal`. Default occupant: faffter-noon-architecture.
      out.push([has("faff-contract:architecture-proposal"), "emits its `faff-contract:architecture-proposal` artifact block"]);
      break;
    case "producer-env":
      // FAFF-30: the environment PROVISIONER (the provision box of the propose→provision→seed→evaluate
      // pipeline). It self-declares a provisioned, health-checked env in a faff-contract:env-handle block the
      // consumer (FAFF-34) parses and pipes to `faff contract env-handle` (gate: status:ready → exit 0). The
      // handle is the interface; the provisioning mechanism (compose now, cloud later) is swappable behind it.
      // Default occupant: faffter-noon-env-compose.
      out.push([has("faff-contract:env-handle"), "emits its `faff-contract:env-handle` artifact block"]);
      break;
    case "producer-evaluator":
      // FAFF-34: the code-blind holdout JUDGE (the evaluate box of propose→provision→seed→evaluate). It
      // self-declares its per-criterion + aggregate verdict in a faff-contract:holdout-verdict block the
      // consumer parses and pipes to `faff contract holdout-verdict` (gate: code_blind:true + aggregate
      // matches derivation → exit 0). Default occupant: faffter-noon-evaluate.
      out.push([has("faff-contract:holdout-verdict"), "emits its `faff-contract:holdout-verdict` artifact block"]);
      break;
    case "producer-prd":
      // The code-blind PRD-admissibility producer (the LLM half of the L4 run-start PRD gate). It
      // self-declares its verdict in a faff-contract:prd-readiness block the run-start caller parses and
      // pipes to `faff contract prd-readiness` (the deterministic validator: admissible → admit the run;
      // anything else → refuse, fail-safe). Default occupant: faffter-noon-prd.
      out.push([has("faff-contract:prd-readiness"), "emits its `faff-contract:prd-readiness` artifact block"]);
      break;
    case "producer-ship":
      out.push([has("faff-contract:delivery-outcome"), "emits its `faff-contract:delivery-outcome` artifact block"]);
      break;
    case "producer-profile":
      // FAFF-231: an infra-profile acquirer (repo-miner or any other acquisition mode) conforms by
      // emitting the FAFF-26 faff-contract:infra-profile block the orchestrator validates + stores.
      out.push([has("faff-contract:infra-profile"), "emits its `faff-contract:infra-profile` artifact block"]);
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
  const gatewayPath = path.join(skillsDir, "faff", "SKILL.md");
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
      process.stderr.write(`validate-adapters --configured: multiple .faffrc files at ${root}; keep only one.\n`);
      return 2;
    }
    throw e;
  }

  const slots = (data && typeof data.slots === "object" && !Array.isArray(data.slots)) ? data.slots : {};
  const entries = Object.entries(slots).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) {
    console.log(cfgPath
      ? `no slots configured in ${path.basename(cfgPath)} — nothing to pre-flight (all slots use shipped defaults).`
      : "no .faffrc found — nothing to pre-flight (all slots use shipped defaults).");
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
  const reg = REGISTRY[name];
  if (!reg) {
    console.log(`${name}: foreign (not in REGISTRY) — semantic Validate applies`);
    return 1;
  }
  if (reg.type !== slotMeta.type) {
    console.log(`${name}: bundled but wrong slot (registered ${reg.type}, occupies ${slot}:${slotMeta.type}) — semantic Validate applies`);
    return 1;
  }
  console.log(`${name}: bundled first-party for slot ${slot} — conformant by construction`);
  return 0;
}

function cmdValidateAdapters(args) {
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

  let failed = false;
  const uncovered = [];
  for (const name of present) {
    if (SKIP.has(name)) {
      // user-facing dev tool — must NOT carry the internal-only marker
      const skiptext = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
      if (hasUserInvocableFalse(skiptext)) {
        failed = true;
        console.log(`FAIL  ${name} (user-facing dev tool)`);
        console.log(`        ✗ must NOT carry user-invocable: false (it is directly user-invocable)`);
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
      console.log(`FAIL  ${name} (${meta.type})`);
      for (const label of bad) console.log(`        ✗ ${label}`);
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
      console.log(`FAIL  ${name} (user command)`);
      console.log(`        ✗ must NOT carry user-invocable: false (it is a user / command)`);
    }
    // FAFF-54: every faff-* user command emits human-facing output, so its SKILL.md
    // must reference routing that output through the configured renderer. Presence
    // check only — see RENDERING_REF for the honest runtime-routing limit.
    if (!RENDERING_REF.test(text)) {
      failed = true;
      console.log(`FAIL  ${name} (rendering pass)`);
      console.log(`        ✗ no rendering-pass reference — a faff-* command emits human-facing output and must route it through the configured renderer (gateway → Rendering, Universal-routing rule) (FAFF-54)`);
    }
    // FAFF-491/530: faff-graft's build phase (Steps 7–9b) must carry the foreground-posture
    // rule — a build subagent that self-backgrounds its own gate/test/review step and ends
    // its turn strands the build (live occurrences, FAFF-466/FAFF-446/FAFF-530). Substring-only
    // (case-insensitive), same honesty caveat as FAFF-439: this asserts the instruction is
    // PRESENT, not runtime-obeyed — the FAFF-491/530 background-fence hook is the mechanical floor.
    // FAFF-530 adds the third anchor `foreground-to-terminal` — the dispatched build's turn
    // contract (terminal token or sanctioned hold, never a progress report).
    if (name === "faff-graft") {
      const lower = text.toLowerCase();
      const hasRunInBackground = lower.includes("run_in_background: true");
      const hasNeverEndATurn = lower.includes("never end a turn");
      const hasForegroundToTerminal = lower.includes("foreground-to-terminal");
      if (!hasRunInBackground || !hasNeverEndATurn || !hasForegroundToTerminal) {
        failed = true;
        console.log(`FAIL  ${name} (build-phase posture)`);
        console.log(`        ✗ missing the FAFF-491/530 foreground-posture declaration — must carry all three of "run_in_background: true", "never end a turn", and "foreground-to-terminal" (case-insensitive)`);
      }
    }
  }
  // FAFF-50: CLI-only config access — no skill may hand-read the rc file with a shell command;
  // config is resolved via `faff config`. Conservative: flags only an explicit shell read of
  // .faffrc* (cat/head/tail/grep/sed/awk/less), never a prose mention.
  const HANDREAD = /\b(?:cat|head|tail|less|grep|sed|awk)\b[^\n]*\.faffrc(?:\.ya?ml)?\b/;
  const allSkills = fs.readdirSync(skillsDir)
    .filter((d) => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).sort();
  for (const name of allSkills) {
    const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
    for (const line of text.split("\n")) {
      if (line.includes(".example")) continue;
      const m = line.match(HANDREAD);
      if (m) {
        failed = true;
        console.log(`FAIL  ${name} (config access)`);
        console.log(`        ✗ hand-reads the rc file ("${m[0].trim()}") — resolve config via \`faff config\`, never read .faffrc directly (FAFF-50)`);
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
        console.log(`FAIL  ${name} (delegation conformance)`);
        console.log(`        ✗ line ${i + 1}: hardcoded install-mode literal "${bad}" at a Skill-tool delegation site —`);
        console.log(`          name the sibling by its canonical name and resolve per gateway → Sibling-skill invocation (FAFF-164/172)`);
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
        console.log(`FAIL  ${name} (prose default)`);
        console.log(`        ✗ line ${i + 1}: redundant \`-d\` on registry key "${m[1]}" — the registry owns the default; drop the -d (drift vector) (FAFF-191)`);
      }
      if (DISPATCH_ANCHOR.test(line)) {
        const tokens = [...line.matchAll(/`([^`]+)`/g)].map((t) => t[1]);
        const bad = tokens.find((t) => slotDefaults.has(t));
        if (bad) {
          failed = true;
          console.log(`FAIL  ${name} (prose default)`);
          console.log(`        ✗ line ${i + 1}: dispatch site names bundled default "${bad}" — route through \`faff config get slots.<x>\` and name no default (FAFF-191)`);
        }
      }
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
      console.log(`FAIL  ${name} (inline enum restatement)`);
      for (const f of findings) console.log(`        ✗ ${f}`);
    }
  }

  // FAFF-678: voice-pointer lint — see lintVoicePointer for the three-leg description.
  {
    const voiceFindings = lintVoicePointer(args, skillsDir, allSkills);
    if (voiceFindings.length) {
      failed = true;
      console.log(`FAIL  voice-pointer (FAFF-678)`);
      for (const f of voiceFindings) console.log(`        ✗ ${f}`);
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
      console.log(`FAIL  ${name} (line cap)`);
      console.log(`        ✗ SKILL.md is ${lines.length} lines (cap ${cap}) — split or lean it (FAFF-120 charter)`);
    } else if (Object.prototype.hasOwnProperty.call(SKILL_LINE_BASELINE, name) && lines.length < cap) {
      console.log(`RATCHET  ${name} — now ${lines.length} lines, below baseline ${cap}; lower the baseline to lock the reduction (FAFF-120)`);
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
        console.log(`FAIL  ${name} (stray marker)`);
        console.log(`        ✗ line ${i + 1}: ${stray} — state the rule forward; war-stories belong in git history / ADRs / design, not the prompt (FAFF-120 charter)`);
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
            console.log(`FAIL  ${name} (paragraph)`);
            console.log(`        ✗ line ${i + 1}: ${words}-word paragraph (cap ${PARA_WORD_CAP}) — break it into bullets (FAFF-120 charter)`);
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
  // cross-file duplicated-block report (single-source it per FAFF-115)
  const reportedDup = new Set();
  for (const [key, names] of dupWindows) {
    if (names.size < 2) continue;
    const sig = [...names].sort().join(",");
    if (reportedDup.has(sig)) continue; // one report per offending file set
    reportedDup.add(sig);
    failed = true;
    console.log(`FAIL  ${[...names].sort().join(", ")} (duplicated block)`);
    console.log(`        ✗ ${DUP_BLOCK_WINDOW}+ identical lines shared across skills — give shared prose one home (gateway) and reference it, never copy (FAFF-120/115)`);
    console.log(`          first line: "${key.split("\n")[0].slice(0, 70)}"`);
  }
  // FAFF-584: anchor-existence lint — resolve every `→ **Target**` ref against the pooled headings
  // set collected above. WARN-severity (advisory): the ~200-occurrence anchor web has never been
  // linted, so a hard gate on first pass would red-CI the tree; this makes breakage visible instead.
  // Resolves heading EXISTENCE only, not the "A → B nests under A" claim (deliberately out of scope).
  for (const name of allSkills) {
    const lines = linesByFile.get(name);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(".example")) continue;
      for (const m of line.matchAll(ANCHOR_REF)) {
        const target = m[1].trim();
        const segments = target.split(" → ");
        const leaf = normalizeHeading(segments[segments.length - 1]);
        if (anchorResolves(leaf, headings)) continue;
        console.log(`WARN  ${name} (anchor) — line ${i + 1}: "${target}" resolves to no heading (leaf "${leaf}") — fix the ref or the heading (FAFF-120)`);
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
      console.log(`FAIL  eval/seam-registry.json (seam registry)`);
      console.log(`        ✗ ${seamErr} — both consumers fail loud on a missing/malformed registry (FAFF-280/281: exit 2)`);
      return 2;
    } else if (seamReg) {
      for (const name of allSkills) {
        const text = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
        const bad = reconcileSeam(name, readJudgementSeam(text), seamReg, REGISTRY)
          .filter(([ok]) => !ok).map(([, label]) => label);
        if (bad.length) {
          failed = true;
          console.log(`FAIL  ${name} (judgement seam)`);
          for (const label of bad) console.log(`        ✗ ${label}`);
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
          console.log(`FAIL  ${name} (eval coverage)`);
          console.log(`        ✗ registry surface with no \`judgement_seam:\` declaration — the registry attributes a grader KIND to it; declare its seam KIND(s) (FAFF-281 C1)`);
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
          console.log(`FAIL  eval/cases/${kind} (eval coverage)`);
          console.log(`        ✗ kind \`${kind}\` is registry-status \`${entry.status}\` but has 0 cases in eval/cases/ (FAFF-281 C2)`);
        } else if (entry.status === "designed") {
          console.log(`NEEDS-CASES  ${kind} (surface ${entry.surface}) — registry-status \`designed\`, 0 cases yet (advisory)`);
        }
      }

      // FAFF-616 C3: for each `calibrated` kind, confirm the committed frontier baseline backs the
      // claim (row exists, not a warn_kind, accuracy clears the floor). Runs after C1/C2, off the
      // same shared root. A missing/malformed frontier.json while a calibrated claim exists is
      // fail-loud (exit 2, harness-can't-run); a claim that reads fine but misses the floor is a
      // lint FAIL (exit 1, folded into `failed` below).
      const c3 = c3CalibrationFloor(seamReg, usedRoot, casesPresent);
      if (c3.exit2) return 2;
      if (c3.failed) failed = true;
    }
  }

  for (const n of Object.keys(REGISTRY)) {
    if (!present.includes(n)) console.log(`WARN  ${n} is registered but not present on disk`);
  }
  if (uncovered.length) {
    console.log("");
    for (const n of uncovered) {
      console.log(`UNCOVERED  ${n} — a shipped slot skill with no registered checks; add it to validate-adapters`);
    }
    return 2;
  }
  console.log("");
  const linted = present.filter((n) => !SKIP.has(n)).length;
  console.log(`RESULT: ${failed ? "FAIL" : "PASS"} (${linted} slot skills linted)`);
  return failed ? 1 : 0;
}


module.exports = { DUP_BLOCK_WINDOW, DUP_SIG_MINLEN, NON_NORMATIVE, PARA_WORD_CAP, REFER_BACK, REGISTRY, RENDERING_REF, REQUIRED_METHODOLOGY_OUTPUTS, SKILL_LINE_CAP, SKILL_LINE_BASELINE, SKIP, SLOT_TYPES, STRAY_RETRO, STRAY_TRANSCRIPT, c3CalibrationFloor, checkCalibrated, checksFor, cmdIsBundled, cmdValidateAdapters, extractVoicePathToken, hasUserInvocableFalse, inlineEnumLintSets, isProseLine, isParagraphLine, anchorResolves, normalizeHeading, lintInlineEnumRestatement, lintVoicePointer, loadSeamRegistryForLint, locateSkill, readJudgementSeam, reconcileSeam, resolveSkillsDir, validateConfigured };
