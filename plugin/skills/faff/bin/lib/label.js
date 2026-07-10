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

const { CONTROL_LABELS } = require("./labels");

function labelOp({ action, issue, label, present }) {
  const entry = CONTROL_LABELS.find((l) => l.name === label);
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
  // FAFF-218: the two tracker-owned eligibility labels are REFUSED in all four directions
  [{ action: "add", issue: "FAFF-99", label: "faff-automate", present: null },
    { refused: true }],                                  // crank up
  [{ action: "remove", issue: "FAFF-99", label: "faff-automate", present: null },
    { refused: true }],                                  // crank down
  [{ action: "add", issue: "FAFF-99", label: "faff-automation-hold", present: null },
    { refused: true }],                                  // hold
  [{ action: "remove", issue: "FAFF-99", label: "faff-automation-hold", present: null },
    { refused: true }],                                  // unhold
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
];

function labelSelftest() {
  let fail = 0;
  for (const [inp, want] of LABEL_SELFTEST_CASES) {
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
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${LABEL_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdLabel(args) {
  if (args.includes("--selftest")) return labelSelftest();
  const action = args[0];
  if (action !== "add" && action !== "remove") {
    process.stderr.write("faff label: action must be add|remove\n");
    return 2;
  }
  const issue = args[1];
  const label = args[2];
  if (!issue || !label || issue.startsWith("--") || label.startsWith("--")) {
    process.stderr.write("faff label: usage: faff label add|remove <issue-id> <label> [--present-label L ...]\n");
    return 2;
  }
  const present = [];
  for (let i = 3; i < args.length; i++) {
    if (args[i] === "--present-label") { const v = args[++i]; if (v != null) present.push(v); }
  }
  const result = labelOp({ action, issue, label, present: present.length ? present : null });
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
