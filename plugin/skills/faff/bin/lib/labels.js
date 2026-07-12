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


const CONTROL_LABELS = [
  { name: "faff-automate", color: "#6fcf97", tracker_owned: true,
    description: "Human-set eligibility: this ticket MAY be picked up by the autonomous faff pipeline (auto-spec/promote/build). Under the default opt-in posture, absence = not automatable. Removing it cranks the ticket down to hands-off. Tracker-owned (FAFF-218): toggle in the tracker UI only — the faff CLI refuses to add/remove it." },
  { name: "faff-automation-hold", color: "#5e6ad2", tracker_owned: true,
    description: "Human-set hard exclude: NEVER automate this ticket, even if it also carries faff-automate. Highest precedence in the eligibility model. Visible to read skills. Tracker-owned (FAFF-218): toggle in the tracker UI only — the faff CLI refuses to add/remove it." },
  { name: "faff-parked", color: "#e8a33d",
    description: "Issue parked by an autonomous faff run. Check the issue comments for the park reason. Surfaced by /faff-wtf." },
  { name: "faff-jot-intake", color: "#4ea7fc",
    description: "Cosmetic hint: work created by /faff-jot, picked up by the next /faff-prep pass. NOT provenance — the load-bearing intake signal is the .faff/provenance marker (FAFF-212) and the initiated audit field (FAFF-220); this label survives only as a grandfather bridge for legacy tickets (FAFF-209: the label alone is NOT provenance)." },
  { name: "faff-chain-gap-fill", color: "#4ea7fc",
    description: "Cosmetic hint: an auto-filled chain-gap / execution-discovered ticket (faff-tidy / faff-beep-boop), picked up by the next /faff-prep pass. NOT provenance — the load-bearing initiation signal is the initiated: autonomous audit field (FAFF-220); this label survives only as a grandfather/migration hint." },
  { name: "faff-awaiting-review", color: "#f2c94c",
    description: "Built work holding for review-provider recovery; the next drain resumes at review (no rebuild). Applied and cleared by faff-graft. NOT a park (faff-parked, above) — a hold means automation is waiting on a machine, not a human (FAFF-403)." },
];

function cmdLabels(args) {
  if (args.includes("--names")) {
    for (const l of CONTROL_LABELS) console.log(l.name);
    return 0;
  }
  console.log(JSON.stringify(CONTROL_LABELS, null, 2));
  return 0;
}


module.exports = { CONTROL_LABELS, cmdLabels };
