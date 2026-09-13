// ===========================================================================
// === region:factory — labels — the canonical faff control-label manifest (FAFF-47). ===
// The single source of truth for faff's control labels. The CLI EMITS the set;
// it cannot create tracker labels (no MCP). The agent ensures-before-tag via the
// tracker MCP using this manifest (gateway -> Control-label provisioning).
// ===========================================================================
// `tracker_owned: true` marks the two eligibility-throttle labels the faff CLI
// REFUSES to mutate (FAFF-218): they may only be toggled by a human in the tracker
// UI, so `faff-automate` present ⟹ a human set it, by construction. The refusal
// predicate in labelOp reads this flag — never a hardcoded name set. Machine-breadcrumb
// labels omit it (⇒ false) and stay CLI-writable.
//
// FAFF-1044: each entry's `role` is the STABLE identity — prefix-independent, never
// compared directly by a read-site. `name` (`<prefix>-<role>`) is DERIVED by the
// `controlLabels(prefix)` factory below and is presentation only (tracker I/O / CLI
// output) — no code holds a prefixed string as an identity key. `prefix` defaults to
// "faff" so every default-prefix caller (selftests included) is byte-identical to the
// historical literal-name manifest.

const CONTROL_LABEL_DEFS = [
  { role: "automate", color: "#6fcf97", tracker_owned: true,
    description: "Human-set eligibility: this ticket MAY be picked up by the autonomous faff pipeline (auto-spec/promote/build). Under the default opt-in posture, absence = not automatable. Removing it cranks the ticket down to hands-off. Tracker-owned (FAFF-218): toggle in the tracker UI only — the faff CLI refuses to add/remove it." },
  { role: "automation-hold", color: "#5e6ad2", tracker_owned: true,
    description: "Human-set hard exclude: NEVER automate this ticket, even if it also carries the automate label. Highest precedence in the eligibility model. Visible to read skills. Tracker-owned (FAFF-218): toggle in the tracker UI only — the faff CLI refuses to add/remove it." },
  { role: "parked", color: "#e8a33d",
    description: "Issue parked by an autonomous faff run. Check the issue comments for the park reason. Surfaced by /faff-wtf." },
  { role: "jot-intake", color: "#4ea7fc",
    description: "Cosmetic hint: work created by /faff-jot, picked up by the next /faff-prep pass. NOT provenance — the load-bearing intake signal is the .faff/provenance marker (FAFF-212) and the initiated audit field (FAFF-220); this label survives only as a grandfather bridge for legacy tickets (FAFF-209: the label alone is NOT provenance)." },
  { role: "chain-gap-fill", color: "#4ea7fc",
    description: "Cosmetic hint: an auto-filled chain-gap / execution-discovered ticket (faff-tidy / faff-beep-boop, or a methodology lens filing a surfaced prerequisite/follow-up dependency), picked up by the next /faff-prep pass. NOT provenance — the load-bearing initiation signal is the initiated: autonomous audit field (FAFF-220); this label survives only as a grandfather/migration hint." },
  { role: "awaiting-review", color: "#f2c94c",
    description: "Built work holding for review-provider recovery; the next drain resumes at review (no rebuild). Applied by faff-graft; cleared by faff-graft (on terminal disposition) or faff-tidy (stale-label auto-clear on state moves). NOT a park (the parked label, above) — a hold means automation is waiting on a machine, not a human (FAFF-403)." },
  { role: "awaiting-spec-review", color: "#f2c94c",
    description: "A spec holding for spec-review-provider recovery; the next prep drain re-enters at the review gate (spec re-production skipped). Applied by faff-prep on a swing-capable spec-review outage past the in-turn retry ceiling; cleared by faff-prep (on terminal disposition) or faff-tidy (stale-label auto-clear on state moves). NOT a park (the parked label, above) and NOT the build-side awaiting-review — a distinct prep-altitude hold so the two stay separable in `faff disposition` / `/faff-wtf` (FAFF-900)." },
  { role: "repeat-parked", color: "#d97706",
    description: "Cosmetic breadcrumb: an active issue demoted Todo->Backlog because faff park-history flagged it repeat-parked (3+ parks, same root-cause class, within the rolling window). Detection is seam-computed (faff park-history), NOT read from this label — the label only marks the demotion for /faff-wtf. Distinct from the repeat-parked routing verdict (contract-defs.js). CLI-writable (no tracker_owned flag)." },
  { role: "claimed", color: "#9b51e0",
    description: "faff set this issue's In Progress claim; eligible for stale-claim reclaim (FAFF-758). Applied by faff-graft at the Step-5 claim, cleared by faff-graft (on terminal disposition and the FAFF-403 retry-later release) or faff-tidy (state-driven stale-label sweep). Its presence is the PROVENANCE that lets tidy auto-reclaim a stale (past claim_ttl_hours) claim — a claim WITHOUT it is human-set or unprovable and is only surfaced, never reverted. Machine-writable like the parked/awaiting-review labels (no tracker_owned flag), NOT an eligibility throttle." },
];

// Pure factory: no config read, no fs. `name` is computed per entry; `role` / `color` /
// `tracker_owned` / `description` pass through verbatim. The resolved prefix is threaded
// in by the command layer (cmdLabels here; cmdLabel in label.js) — no pure function
// reads config directly (the FAFF-1044 anti-pattern this whole conversion avoids).
function controlLabels(prefix = "faff") {
  return CONTROL_LABEL_DEFS.map((l) => ({ ...l, name: `${prefix}-${l.role}` }));
}

// FAFF-1044: a direct unit test for controlLabels(prefix) itself — the default-prefix
// case must be byte-identical to the historical nine faff-* names (zero-config), and a
// custom prefix must derive the role-mapped rendered name while color/tracker_owned/
// description pass through unchanged per entry.
const LABELS_SELFTEST_CASES = [
  // [prefix, expectedNames] — role/color/tracker_owned/description checked structurally below
  ["faff", ["faff-automate", "faff-automation-hold", "faff-parked", "faff-jot-intake", "faff-chain-gap-fill", "faff-awaiting-review", "faff-awaiting-spec-review", "faff-repeat-parked", "faff-claimed"]],
  ["sd", ["sd-automate", "sd-automation-hold", "sd-parked", "sd-jot-intake", "sd-chain-gap-fill", "sd-awaiting-review", "sd-awaiting-spec-review", "sd-repeat-parked", "sd-claimed"]],
];

function labelsSelftest() {
  let fail = 0;
  for (const [prefix, wantNames] of LABELS_SELFTEST_CASES) {
    const labels = controlLabels(prefix);
    const gotNames = labels.map((l) => l.name);
    const namesOk = JSON.stringify(gotNames) === JSON.stringify(wantNames);
    if (!namesOk) fail++;
    console.log(`${namesOk ? "ok  " : "FAIL"} controlLabels(${JSON.stringify(prefix)}) names → ${JSON.stringify(gotNames)}${namesOk ? "" : ` (want ${JSON.stringify(wantNames)})`}`);
    // role/color/tracker_owned/description pass through unchanged per entry, and role is
    // present and prefix-independent (name === `${prefix}-${role}` for every entry).
    let entriesOk = true;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      const def = CONTROL_LABEL_DEFS[i];
      if (l.role !== def.role || l.color !== def.color || !!l.tracker_owned !== !!def.tracker_owned || l.description !== def.description || l.name !== `${prefix}-${l.role}`) {
        entriesOk = false;
      }
    }
    if (!entriesOk) fail++;
    console.log(`${entriesOk ? "ok  " : "FAIL"} controlLabels(${JSON.stringify(prefix)}) role/color/tracker_owned/description pass through unchanged, name === \`\${prefix}-\${role}\``);
  }
  const total = LABELS_SELFTEST_CASES.length * 2;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const LABELS_SPEC = { flags: { "--selftest": { arity: 0 }, "--names": { arity: 0 }, "--root": { arity: 1 } } };

function cmdLabels(args) {
  if (args.includes("--selftest")) return labelsSelftest();
  const { values, errors } = parseArgs(args, LABELS_SPEC);
  if (errors.length) return usageError(errors, "usage: faff labels [--names] [--root DIR]");
  // FAFF-1044: cmdLabels is the CLI command layer — it resolves the configured prefix
  // itself (config.js's resolveLabelPrefix is the single resolver every control-label
  // command layer calls). A malformed configured prefix fails loud, same as `config get`.
  const { resolveLabelPrefix } = require("./config");
  const root = values["--root"] || findRoot();
  const resolved = resolveLabelPrefix(root);
  if (resolved.error) { process.stderr.write(resolved.error + "\n"); return 2; }
  const labels = controlLabels(resolved.prefix);
  if (values["--names"]) {
    for (const l of labels) console.log(l.name);
    return 0;
  }
  console.log(JSON.stringify(labels, null, 2));
  return 0;
}


module.exports = { CONTROL_LABEL_DEFS, LABELS_SELFTEST_CASES, cmdLabels, controlLabels, labelsSelftest };
