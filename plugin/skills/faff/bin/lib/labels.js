// ===========================================================================
// === region:factory — labels — the canonical faff control-label manifest (FAFF-47). ===
// The single source of truth for faff's control labels. The CLI EMITS the set;
// it cannot create tracker labels (no MCP). The agent ensures-before-tag via the
// tracker MCP using this manifest (gateway -> Control-label provisioning).
// ===========================================================================
// `tracker_owned: true` marks the eligibility-throttle label the faff CLI REFUSES to
// mutate (FAFF-218): `faff-automate` may only be toggled by a human in the tracker UI,
// so its presence ⟹ a human set it, by construction. The refusal predicate in labelOp
// reads this flag — never a hardcoded name set. Machine-breadcrumb labels omit it
// (⇒ false) and stay CLI-writable.
//
// FAFF-1044: each entry's `role` is the STABLE identity — prefix-independent, never
// compared directly by a read-site. `name` (`<prefix>-<role>`) is DERIVED by the
// `controlLabels(prefix)` factory below and is presentation only (tracker I/O / CLI
// output) — no code holds a prefixed string as an identity key. `prefix` defaults to
// "faff" so every default-prefix caller (selftests included) is byte-identical to the
// historical literal-name manifest.
//
// FAFF-1091: each entry also carries a built-in `group` — the faff-known membership that
// makes single-select tracker groups safe. Only the machine-managed, mutually-exclusive
// STATE set is a group (`group: "state"`); everything else is ungrouped (`group: null`).
// `automate` is a standalone tracker-owned eligibility label (never faff-transitioned);
// `stacked` legitimately co-exists with a state label, so it stays ungrouped (operator
// decision 2026-09-24). Membership lives adjacent to the role it describes and iterates
// with the defs, so a new/retired role carries or drops its group in one edit.

const CONTROL_LABEL_DEFS = [
  { role: "automate", color: "#6fcf97", tracker_owned: true, group: null,
    description: "Human-set eligibility: this ticket MAY be picked up by the autonomous faff pipeline (auto-spec/promote/build). The sole eligibility signal — presence = automatable, absence = not (one opt-in model everywhere, FAFF-1097). Removing it cranks the ticket down to hands-off. Tracker-owned (FAFF-218): toggle in the tracker UI only — the faff CLI refuses to add/remove it." },
  { role: "parked", color: "#e8a33d", group: "state",
    description: "Issue parked by an autonomous faff run. Check the issue comments for the park reason. Surfaced by /faff-wtf." },
  { role: "awaiting-review", color: "#f2c94c", group: "state",
    description: "Built work holding for review-provider recovery; the next drain resumes at review (no rebuild). Applied by faff-graft; cleared by faff-graft (on terminal disposition) or faff-tidy (stale-label auto-clear on state moves). NOT a park (the parked label, above) — a hold means automation is waiting on a machine, not a human (FAFF-403)." },
  { role: "awaiting-spec-review", color: "#f2c94c", group: "state",
    description: "A spec holding for spec-review-provider recovery; the next prep drain re-enters at the review gate (spec re-production skipped). Applied by faff-prep on a swing-capable spec-review outage past the in-turn retry ceiling; cleared by faff-prep (on terminal disposition) or faff-tidy (stale-label auto-clear on state moves). NOT a park (the parked label, above) and NOT the build-side awaiting-review — a distinct prep-altitude hold so the two stay separable in `faff disposition` / `/faff-wtf` (FAFF-900)." },
  { role: "claimed", color: "#9b51e0", group: "state",
    description: "faff set this issue's In Progress claim; eligible for stale-claim reclaim (FAFF-758). Applied by faff-graft at the Step-5 claim, cleared by faff-graft (on terminal disposition and the FAFF-403 retry-later release) or faff-tidy (state-driven stale-label sweep). Its presence is the PROVENANCE that lets tidy auto-reclaim a stale (past claim_ttl_hours) claim — a claim WITHOUT it is human-set or unprovable and is only surfaced, never reverted. Machine-writable like the parked/awaiting-review labels (no tracker_owned flag), NOT an eligibility throttle." },
  { role: "awaiting-adjudication", color: "#f2c94c", group: "state",
    description: "Built work holding for a build-review dialogue-or-judge pass still pending across turns; the next drain resumes the dialogue loop at its stashed round (no rebuild). Applied by faff-graft, cleared by faff-graft (on terminal disposition) or faff-tidy (stale-label auto-clear). NOT a park (the parked label) and NOT the review-outage awaiting-review hold — a distinct build-review-dialogue hold (FAFF-996)." },
  { role: "stacked", color: "#56ccf2", group: null,
    description: "faff built this dependent on an unmerged dependency's branch (FAFF-1077 branch-stacking) and its PR is open; the merge-order interlock holds its merge until the dependency's PR merges. Applied by the concurrency occupant when the dependent is stacked-and-open; cleared by faff-graft (on terminal disposition) or faff-tidy (stale-label auto-clear). Machine-writable (no tracker_owned flag), NOT an eligibility throttle. Surfaced by /faff-wtf so a stacked-pending dependent is legible." },
];

// Pure factory: no config read, no fs. `name` is computed per entry; `role` / `color` /
// `tracker_owned` / `description` / `group` pass through verbatim. The resolved prefix and
// per-role name overrides are threaded in by the command layer (cmdLabels here; cmdLabel
// in label.js) — no pure function reads config directly (the FAFF-1044 anti-pattern this
// whole conversion avoids). FAFF-1091: `names` is a `role -> full name` map (only
// overridden roles present); `name` resolves as `names[role] ?? \`${prefix}-${role}\``, so
// an empty `names` + default prefix is byte-identical to the historical manifest.
function controlLabels(prefix = "faff", names = {}) {
  return CONTROL_LABEL_DEFS.map((l) => ({
    ...l,
    name: names[l.role] != null ? names[l.role] : `${prefix}-${l.role}`,
  }));
}

// FAFF-1091: pure clear-then-add emitter for a single-select label group. Given the target
// role and the rendered names currently on the issue (the agent's fresh fetch), it emits an
// ORDERED op list — every OTHER same-group label removed FIRST, then the target added — so a
// single-select tracker group never rejects the second write nor transiently holds two.
// An ungrouped target (automate, stacked) emits a plain idempotent add with NO clears.
// PURE: no config read, no tracker access; emits descriptors the agent executes in order.
function groupTransitionOps({ targetRole, present = [], prefix = "faff", names = {} }) {
  const labels = controlLabels(prefix, names);
  const target = labels.find((l) => l.role === targetRole);
  if (!target) return { rejected: true, targetRole };
  // FAFF-218: a tracker-owned role (automate) is human-only — no sanctioned faff path writes it.
  // The transition verb must REFUSE it too (mirroring labelOp's refusal), or the human-only
  // eligibility label would be reachable through the sibling verb (a plain add on an ungrouped
  // target). Refusal is by the role-derived flag, never a hardcoded name.
  if (target.tracker_owned) return { refused: true, targetRole, name: target.name };
  const addOp = (label) => ({ action: "add", label });
  const removeOp = (label) => ({ action: "remove", label });
  if (target.group == null) return [addOp(target.name)];
  const groupNames = labels.filter((l) => l.group === target.group).map((l) => l.name);
  const removes = present
    .filter((n) => groupNames.includes(n) && n !== target.name)
    .map(removeOp);
  return [...removes, addOp(target.name)];
}

// FAFF-1044: a direct unit test for controlLabels(prefix) itself — the default-prefix
// case must be byte-identical to the historical default-prefix faff-* names (zero-config), and a
// custom prefix must derive the role-mapped rendered name while color/tracker_owned/
// description pass through unchanged per entry.
const LABELS_SELFTEST_CASES = [
  // [prefix, expectedNames] — role/color/tracker_owned/description checked structurally below
  ["faff", ["faff-automate", "faff-parked", "faff-awaiting-review", "faff-awaiting-spec-review", "faff-claimed", "faff-awaiting-adjudication", "faff-stacked"]],
  ["sd", ["sd-automate", "sd-parked", "sd-awaiting-review", "sd-awaiting-spec-review", "sd-claimed", "sd-awaiting-adjudication", "sd-stacked"]],
];

// FAFF-1091: per-role name-override round-trips through controlLabels(prefix, names).
// [prefix, names, expectedNames] — an overridden role renders its full name (spaces/colons
// allowed); every unset role stays `${prefix}-${role}`.
const LABELS_OVERRIDE_SELFTEST_CASES = [
  // A grouped name and a colon-bearing eligibility name; unset roles fall back to the prefix.
  ["faff", { parked: "State: Parked", automate: "Some group: eligible" },
    ["Some group: eligible", "State: Parked", "faff-awaiting-review", "faff-awaiting-spec-review", "faff-claimed", "faff-awaiting-adjudication", "faff-stacked"]],
  // A custom prefix with a single override — the override wins, the prefix fills the rest.
  ["sd", { claimed: "State: Claimed" },
    ["sd-automate", "sd-parked", "sd-awaiting-review", "sd-awaiting-spec-review", "State: Claimed", "sd-awaiting-adjudication", "sd-stacked"]],
];

// FAFF-1091: groupTransitionOps ordering table. [{targetRole, present, prefix, names}, expected].
// A grouped target clears every OTHER same-group present label FIRST, then adds; an ungrouped
// target (automate, stacked) is a plain add with no clears; an unknown role rejects.
const GROUP_TRANSITION_SELFTEST_CASES = [
  // move into claimed while parked + awaiting-review are present ⇒ remove both (in present-order), then add
  [{ targetRole: "claimed", present: ["faff-parked", "faff-awaiting-review"] },
    [{ action: "remove", label: "faff-parked" }, { action: "remove", label: "faff-awaiting-review" }, { action: "add", label: "faff-claimed" }]],
  // move into parked, nothing else present ⇒ a lone add (no clears)
  [{ targetRole: "parked", present: [] },
    [{ action: "add", label: "faff-parked" }]],
  // move into parked while parked already present ⇒ target excluded from removes ⇒ a lone add
  [{ targetRole: "parked", present: ["faff-parked"] },
    [{ action: "add", label: "faff-parked" }]],
  // ungrouped target (stacked) while a state label is present ⇒ plain add, state label UNTOUCHED
  [{ targetRole: "stacked", present: ["faff-awaiting-review"] },
    [{ action: "add", label: "faff-stacked" }]],
  // FAFF-218: the tracker-owned automate role is REFUSED by the transition verb too (never a plain
  // add) — the human-only eligibility label must not be reachable through the sibling verb.
  [{ targetRole: "automate", present: ["faff-parked"] }, "refuse"],
  // custom prefix + override: clears the resolved present name, adds the resolved target name
  [{ targetRole: "claimed", present: ["State: Parked"], prefix: "faff", names: { parked: "State: Parked", claimed: "State: Claimed" } },
    [{ action: "remove", label: "State: Parked" }, { action: "add", label: "State: Claimed" }]],
  // unknown role ⇒ rejected
  [{ targetRole: "not-a-role", present: [] }, "reject"],
];

function labelsSelftest() {
  let fail = 0;
  for (const [prefix, wantNames] of LABELS_SELFTEST_CASES) {
    const labels = controlLabels(prefix);
    const gotNames = labels.map((l) => l.name);
    const namesOk = JSON.stringify(gotNames) === JSON.stringify(wantNames);
    if (!namesOk) fail++;
    console.log(`${namesOk ? "ok  " : "FAIL"} controlLabels(${JSON.stringify(prefix)}) names → ${JSON.stringify(gotNames)}${namesOk ? "" : ` (want ${JSON.stringify(wantNames)})`}`);
    // role/color/tracker_owned/description/group pass through unchanged per entry, and role is
    // present and prefix-independent (name === `${prefix}-${role}` for every entry).
    let entriesOk = true;
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      const def = CONTROL_LABEL_DEFS[i];
      if (l.role !== def.role || l.color !== def.color || !!l.tracker_owned !== !!def.tracker_owned || l.description !== def.description || l.group !== def.group || l.name !== `${prefix}-${l.role}`) {
        entriesOk = false;
      }
    }
    if (!entriesOk) fail++;
    console.log(`${entriesOk ? "ok  " : "FAIL"} controlLabels(${JSON.stringify(prefix)}) role/color/tracker_owned/description/group pass through unchanged, name === \`\${prefix}-\${role}\``);
  }
  // FAFF-1091: per-role name overrides render the override, unset roles fall back to the prefix.
  for (const [prefix, names, wantNames] of LABELS_OVERRIDE_SELFTEST_CASES) {
    const gotNames = controlLabels(prefix, names).map((l) => l.name);
    const ok = JSON.stringify(gotNames) === JSON.stringify(wantNames);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} controlLabels(${JSON.stringify(prefix)}, ${JSON.stringify(names)}) names → ${JSON.stringify(gotNames)}${ok ? "" : ` (want ${JSON.stringify(wantNames)})`}`);
  }
  // FAFF-1091: groupTransitionOps emits removes-then-add in order; ungrouped ⇒ plain add.
  for (const [inp, want] of GROUP_TRANSITION_SELFTEST_CASES) {
    const got = groupTransitionOps(inp);
    const ok = want === "reject"
      ? got && got.rejected === true && got.targetRole === inp.targetRole
      : want === "refuse"
      ? got && got.refused === true && got.targetRole === inp.targetRole
      : JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} groupTransitionOps(${JSON.stringify(inp)}) → ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
  }
  const total = LABELS_SELFTEST_CASES.length * 2 + LABELS_OVERRIDE_SELFTEST_CASES.length + GROUP_TRANSITION_SELFTEST_CASES.length;
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
  // FAFF-1044/1091: cmdLabels is the CLI command layer — it resolves the configured prefix
  // AND the per-role name overrides itself (config.js's resolveLabelPrefix / resolveControlLabels
  // are the single resolvers every control-label command layer calls). A malformed configured
  // prefix or override fails loud, same as `config get`.
  const { resolveLabelPrefix, resolveControlLabels } = require("./config");
  const root = values["--root"] || findRoot();
  const resolved = resolveLabelPrefix(root);
  if (resolved.error) { process.stderr.write(resolved.error + "\n"); return 2; }
  const resolvedNames = resolveControlLabels(root);
  if (resolvedNames.error) { process.stderr.write(resolvedNames.error + "\n"); return 2; }
  const labels = controlLabels(resolved.prefix, resolvedNames.names);
  if (values["--names"]) {
    for (const l of labels) console.log(l.name);
    return 0;
  }
  console.log(JSON.stringify(labels, null, 2));
  return 0;
}


module.exports = { CONTROL_LABEL_DEFS, LABELS_SELFTEST_CASES, LABELS_OVERRIDE_SELFTEST_CASES, GROUP_TRANSITION_SELFTEST_CASES, cmdLabels, controlLabels, groupTransitionOps, labelsSelftest };
