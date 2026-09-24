// ===========================================================================
// === region:factory — label — FAFF-187: the control-label mutation op. PURE: emits a deterministic ===
// op descriptor (issue · label · action · ensure-first · idempotent-noop) the
// agent executes via the configured tracker MCP. NO tracker access — same
// invariant as `next`/`eligible`. Validates <label> against the CONTROL_LABELS
// manifest (single source of truth, no second copy); rejects anything not in it
// (control-labels-only scope). The single MCP write stays agent-side. Idempotency
// is pre-computed only from the optional --present-label flags the agent passes
// from its own fresh fetch; the CLI never fetches current labels.
// ===========================================================================

const { controlLabels, groupTransitionOps } = require("./labels");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const LABEL_SPEC = { flags: { "--selftest": { arity: 0 }, "--present-label": { arity: 1, repeatable: true }, "--root": { arity: 1 } }, positionals: { min: 0, max: 3, name: "action issue label" } };

// FAFF-1044/1091: `prefix` and per-role `names` are threaded from the command layer (cmdLabel
// below resolves the configured tracking.label_prefix + tracking.control_labels and passes
// them), defaulting to "faff"/{} — labelOp stays a pure function over its args (no config read
// inside it), same thread pattern as automationEligible / intakeVerdict. Threading `names` is
// load-bearing: a renamed label (e.g. a renamed `automate`) must still be FOUND by
// `l.name === label` so it is REFUSED (tracker-owned), not wrongly REJECTED (unknown label).
function labelOp({ action, issue, label, present, prefix = "faff", names = {} }) {
  const entry = controlLabels(prefix, names).find((l) => l.name === label);
  if (!entry) return { rejected: true, label };
  // FAFF-218: the eligibility-throttle labels are tracker-human-only. Refuse to
  // add OR remove either, in any direction — no sanctioned faff path writes them,
  // so their presence implies a human toggled it in the tracker, by construction.
  if (entry.tracker_owned) return { refused: true, label, action, issue };
  const ensure_first = action === "add";
  const idempotent_noop =
    present == null
      ? null
      : action === "add"
      ? present.includes(label)
      : !present.includes(label);
  return {
    issue,
    label,
    action,
    ensure_first,
    idempotent_noop,
    manifest_entry: action === "add" ? entry : null,
  };
}

const LABEL_SELFTEST_CASES = [
  // [ {action, issue, label, present}, expected-or-"reject" ]
  // add of a manifest label, no present set ⇒ ensure_first true, noop null, entry set
  [{ action: "add", issue: "FAFF-99", label: "faff-parked", present: null },
    { action: "add", ensure_first: true, idempotent_noop: null, hasEntry: true, rejected: false }],
  // remove of a machine-breadcrumb manifest label ⇒ ensure_first false, manifest_entry null
  [{ action: "remove", issue: "FAFF-99", label: "faff-parked", present: null },
    { action: "remove", ensure_first: false, idempotent_noop: null, hasEntry: false, rejected: false }],
  // label not in manifest ⇒ rejected
  [{ action: "add", issue: "FAFF-99", label: "not-a-faff-label", present: null },
    { rejected: true }],
  // FAFF-218: the tracker-owned eligibility label is REFUSED in both directions
  [{ action: "add", issue: "FAFF-99", label: "faff-automate", present: null },
    { refused: true }],                                  // crank up
  [{ action: "remove", issue: "FAFF-99", label: "faff-automate", present: null },
    { refused: true }],                                  // crank down
  // refusal precedes idempotency: present-flags are ignored on the refused path
  [{ action: "add", issue: "FAFF-99", label: "faff-automate", present: ["faff-automate"] },
    { refused: true }],
  // add of a present machine-breadcrumb label ⇒ idempotent_noop true (refusal does NOT apply)
  [{ action: "add", issue: "FAFF-99", label: "faff-parked", present: ["faff-parked"] },
    { action: "add", ensure_first: true, idempotent_noop: true, hasEntry: true, rejected: false }],
  // add of an absent label (present set, label not in it) ⇒ idempotent_noop false
  [{ action: "add", issue: "FAFF-99", label: "faff-parked", present: ["faff-automate"] },
    { action: "add", ensure_first: true, idempotent_noop: false, hasEntry: true, rejected: false }],
  // remove of an absent label ⇒ idempotent_noop true (clean no-op)
  [{ action: "remove", issue: "FAFF-99", label: "faff-parked", present: ["faff-automate"] },
    { action: "remove", ensure_first: false, idempotent_noop: true, hasEntry: false, rejected: false }],
  // remove of a present label ⇒ idempotent_noop false (a real removal)
  [{ action: "remove", issue: "FAFF-99", label: "faff-parked", present: ["faff-parked"] },
    { action: "remove", ensure_first: false, idempotent_noop: false, hasEntry: false, rejected: false }],
  // FAFF-403: the new awaiting-review hold label is CLI-writable (no tracker_owned flag),
  // same shape as faff-parked — proves it slots into the manifest-driven op with no special-casing.
  [{ action: "add", issue: "FAFF-403", label: "faff-awaiting-review", present: null },
    { action: "add", ensure_first: true, idempotent_noop: null, hasEntry: true, rejected: false }],
  [{ action: "remove", issue: "FAFF-403", label: "faff-awaiting-review", present: null },
    { action: "remove", ensure_first: false, idempotent_noop: null, hasEntry: false, rejected: false }],
];

// FAFF-1044: a non-default prefix resolves the manifest by role, not the literal "faff-"
// string — a label carrying the DEFAULT prefix is rejected under a configured custom
// prefix (no cross-prefix fallback), and the tracker_owned refusal still fires by role.
const LABEL_PREFIX_SELFTEST_CASES = [
  [{ action: "add", issue: "FAFF-99", label: "sd-parked", present: null, prefix: "sd" },
    { action: "add", ensure_first: true, idempotent_noop: null, hasEntry: true, rejected: false }],
  [{ action: "add", issue: "FAFF-99", label: "faff-parked", present: null, prefix: "sd" },
    { rejected: true }],                                   // default-prefix name doesn't match under "sd"
  [{ action: "add", issue: "FAFF-99", label: "sd-automate", present: null, prefix: "sd" },
    { refused: true }],                                     // tracker_owned refusal still fires by role
];

// FAFF-1091: a per-role name override is threaded via `names` — labelOp finds a renamed label
// by its rendered name and still refuses the tracker-owned `automate` role, while the STALE
// default-prefix literal no longer matches once the role is renamed (no override-axis fallback,
// mirroring the prefix-axis rule). Injection safety: a colon-bearing override name round-trips
// as data (never a second identity), so it can neither be found under the wrong role nor corrupt
// the op — the emitted op carries the exact override string.
const LABEL_OVERRIDE_SELFTEST_CASES = [
  [{ action: "add", issue: "FAFF-1", label: "Some group: eligible", present: null, prefix: "faff", names: { automate: "Some group: eligible" } },
    { refused: true }],                                   // renamed automate refused by role
  [{ action: "remove", issue: "FAFF-1", label: "Some group: eligible", present: null, prefix: "faff", names: { automate: "Some group: eligible" } },
    { refused: true }],                                   // refusal is bidirectional, by role
  [{ action: "add", issue: "FAFF-1", label: "State: Parked", present: null, prefix: "faff", names: { parked: "State: Parked" } },
    { action: "add", ensure_first: true, idempotent_noop: null, hasEntry: true, rejected: false }], // renamed breadcrumb writable
  [{ action: "add", issue: "FAFF-1", label: "faff-automate", present: null, prefix: "faff", names: { automate: "Some group: eligible" } },
    { rejected: true }],                                  // stale default literal no longer matches once renamed
];

function labelSelftest() {
  let fail = 0;
  for (const [inp, want] of [...LABEL_SELFTEST_CASES, ...LABEL_PREFIX_SELFTEST_CASES, ...LABEL_OVERRIDE_SELFTEST_CASES]) {
    const got = labelOp(inp);
    let ok;
    if (want.refused) {
      ok = got.refused === true && got.label === inp.label && got.action === inp.action;
    } else if (want.rejected) {
      ok = got.rejected === true;
    } else {
      ok =
        !got.rejected &&
        got.action === want.action &&
        got.ensure_first === want.ensure_first &&
        got.idempotent_noop === want.idempotent_noop &&
        (want.hasEntry ? got.manifest_entry != null && got.manifest_entry.name === inp.label
                       : got.manifest_entry === null) &&
        got.issue === inp.issue &&
        got.label === inp.label;
    }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(inp)} → ${JSON.stringify(got)}`);
  }
  const total = LABEL_SELFTEST_CASES.length + LABEL_PREFIX_SELFTEST_CASES.length + LABEL_OVERRIDE_SELFTEST_CASES.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

const LABEL_USAGE = "faff label: usage: faff label add|remove <issue-id> <label> [--present-label L ...] [--root DIR]  |  faff label transition <issue-id> <target-role> [--present-label L ...] [--root DIR]";

function cmdLabel(args) {
  if (args.includes("--selftest")) return labelSelftest();
  const { values, positionals, errors } = parseArgs(args, LABEL_SPEC);
  if (errors.length) return usageError(errors, LABEL_USAGE);
  const action = positionals[0];
  if (action !== "add" && action !== "remove" && action !== "transition") {
    process.stderr.write("faff label: action must be add|remove|transition\n");
    return 2;
  }
  // FAFF-1044/1091: cmdLabel is the CLI command layer — resolve the configured prefix AND the
  // per-role name overrides (fail loud on a malformed value, same as `config get`) and thread
  // both into the pure emitters (labelOp / groupTransitionOps).
  const { resolveLabelPrefix, resolveControlLabels } = require("./config");
  const root = values["--root"] || findRoot();
  const resolvedPrefix = resolveLabelPrefix(root);
  if (resolvedPrefix.error) { process.stderr.write(resolvedPrefix.error + "\n"); return 2; }
  const resolvedNames = resolveControlLabels(root);
  if (resolvedNames.error) { process.stderr.write(resolvedNames.error + "\n"); return 2; }
  const present = Array.isArray(values["--present-label"]) ? values["--present-label"] : (values["--present-label"] !== undefined ? [values["--present-label"]] : []);

  // FAFF-1091: the single-select state-group transition verb. Takes a TARGET-ROLE (role is the
  // identity — the verb renders the name itself) and emits ONE ordered remove-then-add contract
  // via the pure groupTransitionOps, so the state-writing sites (faff-graft park/claim/hold,
  // faff-tidy stale sweep) call this instead of loose independent add/remove calls whose ordering
  // would live only in prose. An ungrouped target (stacked) is a plain idempotent add.
  if (action === "transition") {
    const issue = positionals[1];
    const targetRole = positionals[2];
    if (!issue || !targetRole) { process.stderr.write(LABEL_USAGE + "\n"); return 2; }
    const ops = groupTransitionOps({ targetRole, present, prefix: resolvedPrefix.prefix, names: resolvedNames.names });
    if (ops.rejected) {
      process.stderr.write(`faff label transition: '${targetRole}' is not a faff control-label role (see \`faff labels\`)\n`);
      return 1;
    }
    if (ops.refused) {
      process.stderr.write(
        `faff label transition: '${targetRole}' is a tracker-owned eligibility label — faff will not transition it. ` +
        `Toggle it directly on ${issue} in the tracker (one click on the board). ` +
        `This keeps automation eligibility a human-only decision (FAFF-218).\n`);
      return 3;
    }
    console.log("```faff-contract:label-op");
    console.log(JSON.stringify({ issue, action: "transition", target_role: targetRole, ops }, null, 2));
    console.log("```");
    return 0;
  }

  const issue = positionals[1];
  const label = positionals[2];
  if (!issue || !label) {
    process.stderr.write(LABEL_USAGE + "\n");
    return 2;
  }
  const result = labelOp({ action, issue, label, present: present.length ? present : null, prefix: resolvedPrefix.prefix, names: resolvedNames.names });
  if (result.rejected) {
    process.stderr.write(`faff label: '${label}' is not a faff control label (see \`faff labels --names\`)\n`);
    return 1;
  }
  if (result.refused) {
    process.stderr.write(
      `faff label: '${label}' is a tracker-owned eligibility label — faff will not ${action} it. ` +
      `Toggle it directly on ${issue} in the tracker (one click on the board). ` +
      `This keeps automation eligibility a human-only decision (FAFF-218).\n`);
    return 3;
  }
  console.log("```faff-contract:label-op");
  console.log(JSON.stringify(result, null, 2));
  console.log("```");
  return 0;
}


module.exports = { LABEL_SELFTEST_CASES, cmdLabel, labelOp, labelSelftest };
