// ===========================================================================
// === region:factory — intake-provenance guard (FAFF-212) — make "new work entered through the front ===
// door" a deterministic, checkable fact rather than a prose convention.
//
// Today the only signal a ticket came through /faff-jot is the `faff-jot-intake`
// label — agent-applied, so an agent can stamp it without running intake (the
// FAFF-209 bypass). This replaces "trust the label" with a CLI-written provenance
// marker (.faff/provenance/<ISSUE>.json, parallel to prepcheck's .faff/prep/) plus
// a graft-time precondition that reads it. Provenance becomes a side effect of
// RUNNING the flow, not a sticker.
//
// Guardrail, not cryptographic control: a local agent can always write a marker —
// acceptable, because doing so is a deliberate, recorded, visible act (the `via`
// and `reason` fields are the audit trail). We make bypass loud, not impossible.
//
// Enforced where the ticket is KNOWN — at /faff-graft start — never as a global
// Stop-hook: a turn-end hook with no "which ticket" signal false-blocks unrelated
// sessions (FAFF-205). So intakecheck deliberately does NOT join FAFF_STOP_HOOKS.
//
// All four functions below are PURE / fs-injected — zero tracker/network calls.
// Labels are passed in via --labels (the agent already fetched them); the verdict
// is marker-plus-label-fallback so the legacy label is a migration bridge, never
// trusted forever.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULTS, loadConfig } = require("./config");
const { dig, findRoot } = require("./shared-infra");

const PROVENANCE_SCHEMA = 2;            // FAFF-220: bump 1→2 — record gains the optional `initiated` audit field.
const INTAKE_VIA = new Set(["jot", "backfill", "fast_track"]);
// FAFF-220: initiation-mode audit breadcrumb (FAFF-217). interactive = a human was present
// (jot/plot); autonomous = a lights-out chokepoint (beep-boop/tidy). AUDIT ONLY — `initiated`
// is read by /faff-wtf and the out-of-faff backstop, NEVER by intakeVerdict or any gate. The
// containment guarantee is the write-side refusal (FAFF-219/221), never this field. Mirrors
// INTAKE_VIA: a closed set, validated on write, grandfathered on read (v1 markers → null).
const INITIATED_MODE = new Set(["interactive", "autonomous"]);
const INTAKE_GATE_MODES = new Set(["warn", "block", "off"]);

// Pure verdict over (marker, labels, mode). marker is the parsed marker or null
// (absent OR malformed — both gate as absent). Returns {satisfied, basis, warn?}.
//   off                → always satisfied (gate disabled)
//   marker present     → satisfied, basis = the recorded `via`
//   faff-jot-intake    → satisfied, basis grandfathered-label, warn:true (spoofable migration bridge)
//   faff-automate      → satisfied, basis eligibility-gesture, NO warn (FAFF-223; see below)
//   neither            → unsatisfied, basis no-provenance
//
// FAFF-223 — the `eligibility-gesture` basis. After FAFF-218 the faff CLI write-abstains
// on `faff-automate` (it is tracker_owned: true; the CLI refuses to add/remove it), so a
// present `faff-automate` PROVES a human toggled it in the tracker — by construction. That
// makes it admissible intake provenance: a human who creates a ticket in the tracker and
// cranks it up has, by that single gesture, both made it eligible AND vouched for its intake.
// This is the human-side counterpart to FAFF-212 (agent intake) — no human CLI, ever.
//
// It is a NEW, DISTINCTLY-NAMED basis, not a merge of the eligibility and intake verdicts:
// the two axes stay separate (eligibility = "may auto-build?", intake = "front door?"), and
// the distinct `eligibility-gesture` string keeps the audit trail legible (a reviewer can
// tell label-derived intake from a real jot marker). Precedence is strongest-evidence-first:
// a recorded marker wins, then grandfathered-label (which keeps its migration warn), then
// eligibility-gesture. Unlike the spoofable grandfathered-label, eligibility-gesture carries
// NO warn — FAFF-218 makes it trustworthy by construction. TRUST DEPENDENCY: this basis is
// sound ONLY while FAFF-218's write-abstention holds; if `faff-automate` ever became CLI-
// writable again, it would be agent-spoofable (the FAFF-209 failure the marker was built for).
function intakeVerdict(marker, labels, mode) {
  if (mode === "off") return { satisfied: true, basis: "gate-off" };
  const via = marker && marker.intake && marker.intake.via;
  if (INTAKE_VIA.has(via)) return { satisfied: true, basis: via };
  const labelSet = new Set(labels);
  if (labelSet.has("faff-jot-intake")) {
    return { satisfied: true, basis: "grandfathered-label", warn: true };
  }
  if (labelSet.has("faff-automate")) {
    return { satisfied: true, basis: "eligibility-gesture" };
  }
  return { satisfied: false, basis: "no-provenance" };
}

// FAFF-220: pure accessor centralising the grandfather rule for the `initiated` audit field.
// Returns the recorded mode iff it is a member of INITIATED_MODE, else null — which covers an
// absent key (mode-unknown), a legacy schema:1 marker (no key), and any malformed/unknown value.
// So a v1 marker reads back as null with no error, and readers never re-implement the rule.
// AUDIT ONLY — must never be consulted by intakeVerdict or any gate (the audit-only invariant).
function initiatedOf(marker) {
  const v = marker && marker.initiated;
  return INITIATED_MODE.has(v) ? v : null;
}

function provenancePath(root, issue) {
  return path.join(root, ".faff", "provenance", `${issue}.json`);
}

// Read .faff/provenance/<ISSUE>.json → parsed marker, or null when absent OR
// malformed (a malformed marker gates as absent + [warn], never crashes — same
// tolerance as readPrepMarkers).
function readProvenanceMarker(root, issue) {
  const p = provenancePath(root, issue);
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); } catch { return { marker: null, malformed: false }; }
  let m;
  try { m = JSON.parse(raw); } catch { return { marker: null, malformed: true }; }
  if (!m || typeof m !== "object") return { marker: null, malformed: true };
  return { marker: m, malformed: false };
}

// Resolve intake_gate via the config CLI's default-aware registry (FAFF-182):
// unset → "warn". Any unrecognised value coerces to "warn" (fail-safe non-block) AND
// warns to stderr (FAFF-212 review F3: a typo'd `intake_gate: blok` must not silently
// downgrade a block to warn without a peep).
function resolveIntakeGate(root) {
  const [data] = loadConfig(root);
  const v = dig(data, "intake_gate");
  if (v === null || v === undefined) return DEFAULTS["intake_gate"];
  const mode = String(v);
  if (INTAKE_GATE_MODES.has(mode)) return mode;
  process.stderr.write(`faff: intake_gate='${mode}' is not warn|block|off — coercing to '${DEFAULTS["intake_gate"]}' (fail-safe).\n`);
  return DEFAULTS["intake_gate"];
}

function intakeGuidance(issue, basis) {
  // FAFF-223 — the human remedy is now a ZERO-CLI tracker gesture, not `intake-record`.
  // After FAFF-218 a human-set `faff-automate` is itself admissible intake provenance
  // (basis eligibility-gesture), so the documented human steady-state remedy is simply
  // "set faff-automate in the tracker" — no command to type. `intake-record --via backfill`
  // is REFRAMED here as a MIGRATION / agent-orchestrator tool (bulk legacy backfill), no
  // longer the human steady-state ceremony it used to be billed as. Note /faff-jot ISSUE is
  // the existing-ticket interactor (eligibility crank-up/down) — it does NOT write a marker;
  // a bare new idea starts at `/faff-jot` (no ISSUE). The guidance is intentionally NOT
  // eligibility-aware: the intake gate only ever fires on the eligible path (a not-eligible
  // ticket has no autonomous consumer), so "set faff-automate" is always the right answer.
  return (
    `faff intakecheck: ${issue} has no genuine intake provenance (${basis}). New work must ` +
    `enter through the front door. Human remedy (zero-CLI): set the faff-automate label on ` +
    `${issue} in the tracker — a write-abstained human gesture that faff reads as intake ` +
    `provenance; or capture a genuinely new idea via \`/faff-jot\` (no issue id — the front ` +
    `door). (Migration / agent-orchestrator only: \`faff intake-record ${issue} --via backfill\` ` +
    `for bulk legacy backfill, or \`--via fast-track --reason "<why>"\` for a recorded override. ` +
    `Legacy tickets carrying the faff-jot-intake label are grandfathered through with a warning.)`
  );
}

// FAFF-223 — the interactive bypass notice. When `intakecheck --interactive` meets an
// unsatisfied verdict under block-mode, the human at the keyboard IS the sanction (parity
// with interactive jot), so the build proceeds. This notice MUST NOT instruct the human to
// run any CLI command — that would reintroduce the zero-CLI-human-surface violation.
function interactiveBypassNotice(issue, basis) {
  return (
    `${issue}: no intake provenance (${basis}), but interactive build — ` +
    `the human at the keyboard is the sanction; proceeding.`
  );
}

// Robust positional-arg finder for the intake subcommands (FAFF-212 review F1/F5):
// walk left-to-right, consuming each flag's value where the flag takes one, so the
// FIRST bare token is the issue id — no `indexOf` ambiguity, and a `--labels` whose
// value is itself another flag (a shell-quoting slip like `--labels --json`) is
// detected rather than silently swallowing the next flag as a label value.
const INTAKE_VALUE_FLAGS = new Set(["--labels", "--root", "--via", "--reason", "--initiated"]);
function parseIntakeArgs(args) {
  let issue = null;
  const flags = {};
  let danglingValueFlag = null; // a value-flag whose "value" is another flag or absent
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (INTAKE_VALUE_FLAGS.has(a)) {
      const nxt = args[i + 1];
      if (nxt === undefined || nxt.startsWith("--")) { danglingValueFlag = a; continue; }
      flags[a] = nxt; i++;
    } else if (a.startsWith("--")) {
      flags[a] = true; // boolean flag (--json / --selftest)
    } else if (issue === null) {
      issue = a;
    }
  }
  return { issue, flags, danglingValueFlag };
}

// `faff intakecheck <ISSUE> [--labels csv] [--interactive] [--json]` — PURE: marker (fs) +
// injected labels + resolved mode. exit 0 satisfied · 3 unsatisfied(block-only) · 2 usage/malformed-args.
// WARN NEVER BLOCKS: an unsatisfied verdict under mode=warn prints guidance and exits 0.
// FAFF-223 — `--interactive`: under block-mode, an unsatisfied verdict that would exit 3
// instead prints a [warn] bypass notice and exits 0 — the human at the keyboard is the
// sanction. Autonomous callers OMIT the flag, so the block stays in force for them. The
// bypass is the deterministic seam (selftest-covered), not graft prose.
function cmdIntakecheck(args) {
  if (args.includes("--selftest")) return intakecheckSelftest();
  const { issue, flags, danglingValueFlag } = parseIntakeArgs(args);
  const asJson = flags["--json"] === true;
  const interactive = flags["--interactive"] === true;
  // A value-flag that swallowed nothing (or the next flag) is a likely quoting slip —
  // fail loud rather than silently treating the ticket as unlabelled and blocking it.
  if (danglingValueFlag === "--labels") {
    process.stderr.write("faff intakecheck: --labels needs a value (use --labels \"\" for tracker-less / no labels); refusing to guess.\n");
    return 2;
  }
  const root = flags["--root"] || findRoot();
  if (!issue) { process.stderr.write("faff intakecheck: usage: faff intakecheck <issue> [--labels csv] [--interactive] [--json]\n"); return 2; }
  const labelsArg = flags["--labels"];
  const labels = typeof labelsArg === "string" ? labelsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const mode = resolveIntakeGate(root);
  const { marker, malformed } = readProvenanceMarker(root, issue);
  const v = intakeVerdict(marker, labels, mode);
  // The interactive bypass only ever changes the block-mode unsatisfied case — model it as a
  // single exit decision so the [warn] notice and exit code can never disagree (intakeExit
  // is the shared truth, also driven by the paired selftest).
  const exit = intakeExit(v, mode, interactive);
  const bypassed = !v.satisfied && mode === "block" && interactive; // exit 0 by the human-sanction rule
  const out = { issue, mode, ...v, ...(interactive ? { interactive: true } : {}), ...(bypassed ? { bypassed: true } : {}) };
  if (malformed) out.warn = true; // a malformed marker surfaces a warning even when the label saves it

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else if (v.satisfied) {
    if (out.warn) console.log(`[warn] ${issue}: intake provenance via ${v.basis}${malformed ? " (marker malformed — treated as absent)" : ""}.`);
    else console.log(`ok: ${issue} intake provenance basis=${v.basis}.`);
  } else if (bypassed) {
    console.log(`[warn] ${interactiveBypassNotice(issue, v.basis)}`);
  } else if (mode === "warn") {
    console.log(`[warn] ${intakeGuidance(issue, v.basis)}`);
  } else { // block, non-interactive
    console.log(intakeGuidance(issue, v.basis));
  }

  return exit;
}

// `faff intake-record <ISSUE> --via jot|backfill|fast-track [--reason "<text>"] [--initiated interactive|autonomous] [--json]`
// Writes/updates .faff/provenance/<ISSUE>.json and emits the faff-contract:intake-record
// descriptor. --via fast-track REQUIRES --reason: a missing reason exits 2 and writes
// nothing (the CONSTRAINT in the marker schema). The CLI is the sole writer of the marker.
function cmdIntakeRecord(args) {
  // FAFF-220: --selftest drives the via/reason/initiated validation table AND the initiatedOf
  // grandfather table; both must pass.
  if (args.includes("--selftest")) {
    const a = intakeRecordSelftest();
    console.log("");
    const b = initiatedOfSelftest();
    return a || b;
  }
  const { issue, flags, danglingValueFlag } = parseIntakeArgs(args);
  const asJson = flags["--json"] === true;
  if (danglingValueFlag) {
    process.stderr.write(`faff intake-record: ${danglingValueFlag} needs a value.\n`);
    return 2;
  }
  const root = flags["--root"] || findRoot();
  if (!issue) { process.stderr.write("faff intake-record: usage: faff intake-record <issue> --via jot|backfill|fast-track [--reason \"<text>\"] [--initiated interactive|autonomous]\n"); return 2; }
  // accept fast-track (CLI flag spelling) and normalise to the schema's fast_track enum.
  let via = flags["--via"];
  if (via === "fast-track") via = "fast_track";
  if (!INTAKE_VIA.has(via)) {
    process.stderr.write("faff intake-record: --via must be one of jot|backfill|fast-track\n");
    return 2;
  }
  const reason = flags["--reason"];
  if (via === "fast_track" && (!reason || !reason.trim())) {
    process.stderr.write("faff intake-record: --via fast-track requires --reason \"<text>\" (recorded override); nothing written.\n");
    return 2;
  }
  // FAFF-220: optional --initiated audit field. Validate against INITIATED_MODE → exit 2 on an
  // invalid value, nothing written (parity with --via). Absent → undefined here ⇒ the key is
  // omitted below (we never write `initiated: null`); a prior value is merge-preserved.
  const initiated = flags["--initiated"];
  if (initiated !== undefined && !INITIATED_MODE.has(initiated)) {
    process.stderr.write("faff intake-record: --initiated must be one of interactive|autonomous\n");
    return 2;
  }

  const p = provenancePath(root, issue);
  // load-or-init, preserving any reserved prep block (observability only, never gated in v1)
  let marker = { schema: PROVENANCE_SCHEMA, issue, intake: null };
  try { const ex = JSON.parse(fs.readFileSync(p, "utf8")); if (ex && typeof ex === "object") marker = { ...marker, ...ex, issue }; } catch { /* absent/malformed → fresh */ }

  // No-downgrade guard (FAFF-212 review F2): `backfill` is the bulk-migration stamp — it
  // must NEVER overwrite an existing GENUINE record (jot = real front-door, fast_track =
  // deliberate reasoned override). Silently replacing `jot` with `backfill` would corrupt
  // the audit trail ("entered through jot" → "backfilled"). A backfill over an existing
  // backfill is a harmless no-op-ish refresh; jot/fast_track always record (a deliberate
  // act re-asserting provenance is legitimate). The guard is a no-op + exit 0.
  const existingVia = marker.intake && marker.intake.via;
  if (via === "backfill" && (existingVia === "jot" || existingVia === "fast_track")) {
    const msg = `faff intake-record: ${issue} already has genuine provenance (via ${existingVia}); ` +
      `backfill will not downgrade it — leaving the existing marker untouched.`;
    if (asJson) console.log(JSON.stringify({ issue, via: existingVia, noop: "no-downgrade", path: path.relative(root, p) }, null, 2));
    else process.stderr.write(msg + "\n");
    return 0;
  }

  marker.schema = PROVENANCE_SCHEMA;
  marker.intake = { via, ts: new Date().toISOString(), ...(via === "fast_track" ? { reason: reason.trim() } : {}) };
  // FAFF-220: stamp `initiated` only when supplied (a valid mode). When absent we leave the key
  // exactly as load-or-init found it — merge-preserving any prior value — and never set it to
  // null, so a mode-unknown marker is byte-identical (no `initiated` key) to a legacy v1 marker.
  if (initiated !== undefined) marker.initiated = initiated;

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(marker, null, 2) + "\n");

  const descriptor = { issue, via, ts: marker.intake.ts, ...(via === "fast_track" ? { reason: reason.trim() } : {}), ...(marker.initiated ? { initiated: marker.initiated } : {}), path: path.relative(root, p) };
  if (asJson) {
    console.log(JSON.stringify(descriptor, null, 2));
  } else {
    console.log("```faff-contract:intake-record");
    console.log(JSON.stringify(descriptor, null, 2));
    console.log("```");
  }
  return 0;
}

// Selftest — drives the pure verdict over all bases + warn-never-blocks + malformed-as-absent
// + (FAFF-223) the eligibility-gesture basis and the --interactive bypass, no filesystem.
// Tuple: [marker, labels, mode, want, interactive?] — interactive defaults to false when omitted.
const INTAKECHECK_SELFTEST_CASES = [
  // basis: recorded via wins, no warn, exit 0
  [{ intake: { via: "jot" } }, [], "block", { satisfied: true, basis: "jot", exit: 0 }],
  [{ intake: { via: "backfill" } }, [], "block", { satisfied: true, basis: "backfill", exit: 0 }],
  [{ intake: { via: "fast_track", reason: "prod outage" } }, [], "block", { satisfied: true, basis: "fast_track", exit: 0 }],
  // grandfathered label only → satisfied + warn, exit 0
  [null, ["faff-jot-intake"], "block", { satisfied: true, basis: "grandfathered-label", warn: true, exit: 0 }],
  // FAFF-223: faff-automate (write-abstained, human-set) → eligibility-gesture, NO warn, exit 0
  [null, ["faff-automate"], "block", { satisfied: true, basis: "eligibility-gesture", exit: 0 }],
  // FAFF-223: precedence — a recorded marker still wins over the eligibility-gesture label
  [{ intake: { via: "jot" } }, ["faff-automate"], "block", { satisfied: true, basis: "jot", exit: 0 }],
  // FAFF-223: precedence — grandfathered-label wins over eligibility-gesture when both labels present
  [null, ["faff-jot-intake", "faff-automate"], "block", { satisfied: true, basis: "grandfathered-label", warn: true, exit: 0 }],
  // neither, block → unsatisfied exit 3
  [null, [], "block", { satisfied: false, basis: "no-provenance", exit: 3 }],
  // FAFF-223: PAIRED bypass — same no-provenance block case, but --interactive → exit 0
  // (the human at the keyboard is the sanction). Pinned against the non-interactive exit-3
  // case directly above: the only difference is the interactive dimension.
  [null, [], "block", { satisfied: false, basis: "no-provenance", exit: 0 }, true],
  // FAFF-223: --interactive is a no-op when the verdict is already satisfied (no spurious bypass flag)
  [{ intake: { via: "jot" } }, [], "block", { satisfied: true, basis: "jot", exit: 0 }, true],
  // FAFF-223: --interactive is a no-op under warn (warn never blocked anyway; still exit 0)
  [null, [], "warn", { satisfied: false, basis: "no-provenance", exit: 0 }, true],
  // neither, WARN → unsatisfied but exit 0 (warn never blocks)
  [null, [], "warn", { satisfied: false, basis: "no-provenance", exit: 0 }],
  // off → always satisfied, exit 0, even with no marker / no label
  [null, [], "off", { satisfied: true, basis: "gate-off", exit: 0 }],
  // malformed marker (null) + label → grandfathered (gates as absent)
  [null, ["faff-jot-intake"], "warn", { satisfied: true, basis: "grandfathered-label", warn: true, exit: 0 }],
];

// Exit decision over (verdict, mode, interactive). The interactive bypass (FAFF-223) only
// ever relaxes the block-mode unsatisfied case to exit 0 — the human is the sanction. warn/off
// never blocked, and a satisfied verdict is always exit 0, so interactive is a no-op there.
function intakeExit(v, mode, interactive = false) {
  if (v.satisfied) return 0;
  if (mode === "block" && interactive) return 0; // FAFF-223 human-sanction bypass
  return mode === "block" ? 3 : 0;
}

function intakecheckSelftest() {
  let fail = 0;
  for (const [marker, labels, mode, want, interactive = false] of INTAKECHECK_SELFTEST_CASES) {
    const v = intakeVerdict(marker, labels, mode);
    const exit = intakeExit(v, mode, interactive);
    const got = { satisfied: v.satisfied, basis: v.basis, ...(v.warn ? { warn: true } : {}), exit };
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} via=${marker && marker.intake && marker.intake.via} labels=[${labels.join(",")}] mode=${mode}${interactive ? " --interactive" : ""} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${INTAKECHECK_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

// intake-record selftest — the --via fast-track-requires-reason constraint, the
// fast-track→fast_track normalisation, and via validation, in-memory (no fs write).
const INTAKE_RECORD_SELFTEST_CASES = [
  // [via, reason, initiated] → { accepted, via?, initiated? }   (initiated omitted ⇒ absent flag)
  ["jot", null, undefined, { accepted: true, via: "jot" }],
  ["backfill", null, undefined, { accepted: true, via: "backfill" }],
  ["fast-track", "prod outage", undefined, { accepted: true, via: "fast_track" }],
  ["fast-track", null, undefined, { accepted: false }],          // fast-track without reason → reject, write nothing
  ["fast-track", "  ", undefined, { accepted: false }],           // whitespace-only reason → reject
  ["bogus", null, undefined, { accepted: false }],                // unknown via → reject
  // FAFF-220: --initiated validation (parity with --via). Valid modes accepted + echoed; bogus → reject.
  ["jot", null, "interactive", { accepted: true, via: "jot", initiated: "interactive" }],
  ["jot", null, "autonomous", { accepted: true, via: "jot", initiated: "autonomous" }],
  ["jot", null, "bogus", { accepted: false }],                    // invalid initiated → reject (parity with --via)
  ["jot", null, "", { accepted: false }],                          // empty initiated → not a member → reject
];

// FAFF-220: validates (via, reason) AND the optional initiated value (undefined ⇒ flag absent,
// which is always acceptable and leaves the field unstamped). A present-but-invalid initiated
// rejects, exactly like an invalid via — nothing written.
function validateIntakeRecord(via, reason, initiated) {
  let v = via === "fast-track" ? "fast_track" : via;
  if (!INTAKE_VIA.has(v)) return { accepted: false };
  if (v === "fast_track" && (!reason || !reason.trim())) return { accepted: false };
  if (initiated !== undefined && !INITIATED_MODE.has(initiated)) return { accepted: false };
  return { accepted: true, via: v, ...(initiated !== undefined ? { initiated } : {}) };
}

function intakeRecordSelftest() {
  let fail = 0;
  for (const [via, reason, initiated, want] of INTAKE_RECORD_SELFTEST_CASES) {
    const got = validateIntakeRecord(via, reason, initiated);
    const pick = want.accepted
      ? { accepted: got.accepted, via: got.via, ...(want.initiated !== undefined ? { initiated: got.initiated } : {}) }
      : { accepted: got.accepted };
    const ok = JSON.stringify(pick) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} via=${via} reason=${JSON.stringify(reason)} initiated=${JSON.stringify(initiated)} → ${JSON.stringify(pick)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${INTAKE_RECORD_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

// FAFF-220: initiatedOf grandfather table — the accessor normalises every marker shape to a
// recorded mode or null, in-memory (no fs). v1 / absent / malformed all → null with no error.
const INITIATED_OF_SELFTEST_CASES = [
  [{ schema: 2, initiated: "interactive" }, "interactive"],   // v2 recorded mode → itself
  [{ schema: 2, initiated: "autonomous" }, "autonomous"],
  [{ schema: 2, intake: { via: "jot" } }, null],              // v2, no initiated (mode-unknown) → null
  [{ schema: 1, intake: { via: "jot" } }, null],              // legacy v1 marker (no key) → null, grandfathered
  [{ schema: 2, initiated: "bogus" }, null],                  // malformed/unknown value → null
  [null, null],                                               // absent marker → null
];

function initiatedOfSelftest() {
  let fail = 0;
  for (const [marker, want] of INITIATED_OF_SELFTEST_CASES) {
    const got = initiatedOf(marker);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} marker=${JSON.stringify(marker)} → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${INITIATED_OF_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { INITIATED_MODE, INITIATED_OF_SELFTEST_CASES, INTAKECHECK_SELFTEST_CASES, INTAKE_GATE_MODES, INTAKE_RECORD_SELFTEST_CASES, INTAKE_VALUE_FLAGS, INTAKE_VIA, PROVENANCE_SCHEMA, cmdIntakeRecord, cmdIntakecheck, initiatedOf, initiatedOfSelftest, intakeExit, intakeGuidance, intakeRecordSelftest, intakeVerdict, intakecheckSelftest, interactiveBypassNotice, parseIntakeArgs, provenancePath, readProvenanceMarker, resolveIntakeGate, validateIntakeRecord };
