#!/usr/bin/env node
// FAFF-267 — deterministic majority/severity aggregation for the L4 adversarial spec reviewer.
//
// The per-lens refuters (independent `review-call.mjs` passes) produce a list of Refutations; this
// helper maps that set onto the fixed `spec-review-verdict` contract. Per the governing
// deterministic-tools-over-prose tenet, the severity→verdict roll-up is a tool, not prose — same
// refutation set always yields the same verdict. The contract validates verdict SHAPE only (and keeps
// this mapping out, by design); this is the reviewer's judgement, owned by this occupant.
//
// Pure functions carry no I/O and are unit-tested directly; the CLI is a thin stdin→stdout wrapper.
// Zero-dependency: node stdlib only (node:fs, node:url).

import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The contract severity enum is blocker|major|minor. Refuters speak the adversarial-review
// vocabulary (critical|major|minor|observation); map it onto the contract enum. An `observation`
// is advisory and NEVER gates (mapped to null = dropped). An unknown severity is treated the same.
export const SEVERITY_MAP = { critical: "blocker", major: "major", minor: "minor", observation: null };
export function mapSeverity(s) {
  return Object.prototype.hasOwnProperty.call(SEVERITY_MAP, s) ? SEVERITY_MAP[s] : null;
}

// PURE: strict majority of n enabled lenses — the count at or above which "most lenses refuted".
// ceil((n+1)/2): n=1→1, n=2→2, n=3→2, n=4→3. (A single enabled lens refuting is already a majority;
// two of four is a tie, not a majority.)
export function strictMajority(n) {
  return Math.ceil((n + 1) / 2);
}

// PURE: the majority/severity gate. Maps a list of Refutations onto { verdict, objections }, where
// objections is the contract shape List<{ lens, severity }>. A lens counts as "refuted" iff it
// carries at least one GATING objection (observation-only / empty → clear). `nEnabled` is the count
// of lenses that fired for this issue (default: the number of refutations supplied).
//
// Refutation: { lens, outcome: "refuted"|"clear"|"unavailable", kind?: "infra-configured"|"config-fault",
//               objections: [{ severity, claim?, evidence?, predicted_consequence?, summary? }], model? }
//
// FAFF-935: an objection may carry the enrichment triple {claim, evidence, predicted_consequence}
// (the argued content a downstream judge reads). FAFF-943 adds `spec_anchor` — the heading slug of
// the attacked spec section (canonical derivation: faff bin/lib/heading-slug.js; the refuter omits
// it when no single section is nameable, and a transport-floor synthesized objection never carries
// one). aggregate() carries each field VERBATIM from the source objection onto the output objection
// when present as a string — additive, so the fields survive into the round record and thence
// `faff spec-judge-evidence`. It changes NO gating input: the severity map, the
// refutedCount/anyCritical tally, and the majority gate are untouched.
const TRIPLE_FIELDS = ["claim", "evidence", "predicted_consequence", "spec_anchor"];
function carryTriple(target, source) {
  if (source && typeof source === "object") {
    for (const field of TRIPLE_FIELDS) {
      if (typeof source[field] === "string") target[field] = source[field];
    }
  }
  return target;
}
export function aggregate(refutations, nEnabled) {
  const list = Array.isArray(refutations) ? refutations : [];

  const gating = [];          // contract-shaped objections across all available lenses
  let anyCritical = false;
  let refutedCount = 0;
  for (const r of list) {
    if (!r || r.outcome === "unavailable") continue;
    const objs = Array.isArray(r.objections) ? r.objections : [];
    const lensGating = [];
    for (const o of objs) {
      const sev = mapSeverity(o && o.severity);
      if (sev === null) continue;            // advisory / unknown — non-gating
      if (o && o.severity === "critical") anyCritical = true;
      lensGating.push(carryTriple({ lens: r.lens, severity: sev }, o));
    }
    if (lensGating.length > 0) {
      refutedCount += 1;
      gating.push(...lensGating);
    }
  }

  const n = Number.isInteger(nEnabled) && nEnabled > 0 ? nEnabled : list.length;
  const majority = strictMajority(n);
  const forcedReject = anyCritical || refutedCount >= majority;

  const unavailable = list.filter((r) => r && r.outcome === "unavailable");
  const configFault = unavailable.filter((r) => r.kind === "config-fault");
  const nameLenses = (rs, severity) => rs.map((r) => ({ lens: r.lens, severity }));

  // 1. Transport floor — a config fault must be fixed by a human, always (even if the available
  //    lenses already force reject-approach): a misconfigured/auth-failed/default-host-down refuter
  //    is not a review result.
  if (configFault.length > 0) {
    return { verdict: "needs-human", objections: [...gating, ...nameLenses(configFault, "blocker")] };
  }
  // 1b. FAFF-900: an (infra-configured) down lens whose missing vote could swing the verdict is a
  //     TRANSIENT the orchestrator can hold and retry — surface the distinct `unavailable` verdict
  //     (never `needs-human`, which reads as "a human must act"; a swing-capable infra outage is
  //     recoverable without one). Severity defaults to "major" (the founded default for a lens with
  //     no actual finding to grade — distinct from the config-fault "blocker" above, which names a
  //     human config bug). If the available lenses already force reject-approach, the missing lens
  //     cannot change it — fall through to the gate below.
  if (unavailable.length > 0 && !forcedReject) {
    return { verdict: "unavailable", objections: [...gating, ...nameLenses(unavailable, "major")] };
  }
  // 2. Severity veto — any critical objection.
  if (anyCritical) return { verdict: "reject-approach", objections: gating };
  // 3. Majority gate — strict majority of ENABLED lenses refuted.
  if (refutedCount >= majority) return { verdict: "reject-approach", objections: gating };
  // 4. Non-critical minority — fixable in place.
  if (refutedCount > 0) return { verdict: "revise", objections: gating };
  // 5. Clean.
  return { verdict: "approve", objections: [] };
}

// PURE: render the producer's single contract artifact block from an aggregate() result.
export function renderBlock(result) {
  return "```faff-contract:spec-review-verdict\n" + JSON.stringify(result) + "\n```\n";
}

// ---- CLI ----------------------------------------------------------------
// Input (stdin or --refutations FILE) is JSON: either a bare array of Refutations, or an object
// { refutations: [...], enabled_lenses: [...] }. --n N overrides the enabled-lens count.
function readInput(args) {
  const fi = args.indexOf("--refutations");
  const raw = fi !== -1 ? readFileSync(args[fi + 1], "utf8") : readFileSync(0, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { refutations: parsed, nEnabled: undefined };
  const refutations = Array.isArray(parsed.refutations) ? parsed.refutations : [];
  const nEnabled = Array.isArray(parsed.enabled_lenses) ? parsed.enabled_lenses.length : undefined;
  return { refutations, nEnabled };
}

function selftest() {
  const fails = [];
  const t = (name, cond) => { if (!cond) fails.push(name); };
  const r = (lens, sev) => ({ lens, outcome: "refuted", objections: sev ? [{ severity: sev }] : [] });
  const clear = (lens) => ({ lens, outcome: "clear", objections: [] });
  const down = (lens, kind) => ({ lens, outcome: "unavailable", kind, objections: [] });

  // strict-majority table
  t("majority n=1 → 1", strictMajority(1) === 1);
  t("majority n=2 → 2", strictMajority(2) === 2);
  t("majority n=3 → 2", strictMajority(3) === 2);
  t("majority n=4 → 3", strictMajority(4) === 3);

  // severity mapping
  t("critical→blocker", mapSeverity("critical") === "blocker");
  t("major→major", mapSeverity("major") === "major");
  t("minor→minor", mapSeverity("minor") === "minor");
  t("observation→null", mapSeverity("observation") === null);
  t("unknown→null", mapSeverity("bogus") === null);

  // scenario: 2 refuted (major) of 4, no critical → revise
  let v = aggregate([r("architectural", "major"), r("infosec", "major"), clear("methodology"), clear("QA")], 4);
  t("2/4 major → revise", v.verdict === "revise" && v.objections.length === 2);
  // a third refuting lens flips to reject-approach
  v = aggregate([r("architectural", "major"), r("infosec", "major"), r("methodology", "major"), clear("QA")], 4);
  t("3/4 major → reject-approach", v.verdict === "reject-approach");

  // any critical → reject-approach regardless
  v = aggregate([r("architectural", "critical"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  t("1 critical → reject-approach", v.verdict === "reject-approach" && v.objections[0].severity === "blocker");

  // all clear → approve, []
  v = aggregate([clear("architectural"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  t("all clear → approve []", v.verdict === "approve" && v.objections.length === 0);

  // config-fault unavailable lens, others clear → needs-human, names the lens
  v = aggregate([down("infosec", "config-fault"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  t("config-fault → needs-human", v.verdict === "needs-human");
  t("config-fault names lens", v.objections.some((o) => o.lens === "infosec" && o.severity === "blocker"));

  // FAFF-900: infra-configured down lens that could swing → unavailable (never needs-human — a
  // transient the orchestrator can hold/retry), named as a "major" objection.
  v = aggregate([down("infosec", "infra-configured"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  t("infra-down swing → unavailable", v.verdict === "unavailable");
  t("infra-down swing names lens as major", v.objections.some((o) => o.lens === "infosec" && o.severity === "major"));

  // infra-configured down lens that cannot swing (available already force reject via critical) → reject-approach
  v = aggregate([down("infosec", "infra-configured"), r("architectural", "critical"), clear("methodology"), clear("QA")], 4);
  t("infra-down no-swing → reject-approach", v.verdict === "reject-approach");

  // single enabled lens refuting (n=1) is already a majority → reject-approach
  v = aggregate([r("architectural", "minor")], 1);
  t("n=1 minor refute → reject-approach", v.verdict === "reject-approach");

  // founded-verdict invariant: every non-approve carries ≥1 objection; approve carries none
  for (const res of [
    aggregate([r("architectural", "major"), clear("infosec")], 2),
    aggregate([down("infosec", "config-fault"), clear("architectural")], 2),
    aggregate([clear("architectural")], 1),
  ]) {
    if (res.verdict === "approve") t("approve has no objections", res.objections.length === 0);
    else t(`${res.verdict} has ≥1 objection`, res.objections.length >= 1);
  }

  // observation-only lens is clear (advisory, non-gating)
  v = aggregate([{ lens: "QA", outcome: "refuted", objections: [{ severity: "observation" }] }, clear("architectural")], 2);
  t("observation-only → clear → approve", v.verdict === "approve");

  // FAFF-935: the enrichment triple {claim, evidence, predicted_consequence} rides verbatim from
  // the input objection onto the output objection, and changes no gating decision.
  const enriched = { lens: "architectural", outcome: "refuted", objections: [{ severity: "major", claim: "C", evidence: "E", predicted_consequence: "P" }] };
  v = aggregate([enriched, clear("infosec"), clear("methodology"), clear("QA")], 4);
  t("triple carried onto output objection", v.objections.length === 1 && v.objections[0].claim === "C" && v.objections[0].evidence === "E" && v.objections[0].predicted_consequence === "P");
  t("triple carry keeps lens+severity", v.objections[0].lens === "architectural" && v.objections[0].severity === "major");
  t("triple carry unchanged verdict", v.verdict === "revise");
  // a bare {severity} objection yields no triple keys (back-compat — identical to today's shape)
  v = aggregate([r("architectural", "major"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  t("bare objection carries no triple keys", !("claim" in v.objections[0]) && !("evidence" in v.objections[0]) && !("predicted_consequence" in v.objections[0]));
  // the taste-level sentinel is carried like any other string
  v = aggregate([{ lens: "QA", outcome: "refuted", objections: [{ severity: "minor", claim: "less elegant", evidence: "sec 3", predicted_consequence: "not separately stated" }] }, clear("architectural"), clear("methodology"), clear("infosec")], 4);
  t("taste sentinel carried verbatim", v.objections[0].predicted_consequence === "not separately stated");
  // a partial triple carries only the present strings; a non-string field is dropped (never gates)
  v = aggregate([{ lens: "infosec", outcome: "refuted", objections: [{ severity: "major", claim: "auth bypass", predicted_consequence: 42 }] }, clear("architectural"), clear("methodology"), clear("QA")], 4);
  t("partial triple carries present string only", v.objections[0].claim === "auth bypass" && !("evidence" in v.objections[0]) && !("predicted_consequence" in v.objections[0]));
  // transport-floor synthesized objection (down lens, no finding to grade) carries no triple
  v = aggregate([down("infosec", "config-fault"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  t("synthesized objection carries no triple", v.objections.some((o) => o.lens === "infosec" && !("claim" in o)));
  // FAFF-943: spec_anchor rides verbatim beside the triple, changes no verdict, and an absent /
  // non-string / synthesized-objection anchor stays absent (the FAFF-930 absence-path precondition).
  const anchored = { lens: "architectural", outcome: "refuted", objections: [{ severity: "major", claim: "C", evidence: "E", predicted_consequence: "P", spec_anchor: "aggregation-carry-the-anchor" }] };
  v = aggregate([anchored, clear("infosec"), clear("methodology"), clear("QA")], 4);
  t("anchor carried onto output objection", v.objections[0].spec_anchor === "aggregation-carry-the-anchor");
  t("anchor carry unchanged verdict", v.verdict === "revise");
  v = aggregate([r("architectural", "major"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  t("bare objection carries no anchor key", !("spec_anchor" in v.objections[0]));
  v = aggregate([{ lens: "QA", outcome: "refuted", objections: [{ severity: "minor", spec_anchor: "" }] }, clear("architectural"), clear("methodology"), clear("infosec")], 4);
  t("empty-string anchor carried verbatim", v.objections[0].spec_anchor === "");
  v = aggregate([{ lens: "infosec", outcome: "refuted", objections: [{ severity: "major", spec_anchor: 42 }] }, clear("architectural"), clear("methodology"), clear("QA")], 4);
  t("non-string anchor dropped", !("spec_anchor" in v.objections[0]));
  v = aggregate([down("infosec", "config-fault"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  t("synthesized objection carries no anchor", v.objections.some((o) => o.lens === "infosec" && !("spec_anchor" in o)));

  if (fails.length) {
    process.stderr.write("aggregate --selftest: FAIL\n" + fails.map((f) => "  ✗ " + f).join("\n") + "\n");
    return 1;
  }
  process.stdout.write("aggregate --selftest: ok\n");
  return 0;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--selftest")) return selftest();
  let input;
  try {
    input = readInput(args);
  } catch (e) {
    process.stderr.write(`aggregate: cannot read refutations JSON — ${e.message}\n`);
    return 2;
  }
  const ni = args.indexOf("--n");
  const nEnabled = ni !== -1 ? parseInt(args[ni + 1], 10) : input.nEnabled;
  // Fail-SAFE input-adequacy guard (the L4 "a down refuter never silently approves" discipline,
  // applied to the aggregation boundary). The pure aggregate() computes the gate over a CONSISTENT
  // set (one entry per enabled lens); the CLI refuses to vote on an absent or inconsistent set rather
  // than fabricate an `approve` from it. A non-zero exit here is treated upstream as `needs-human`,
  // exactly as a non-zero review-call.mjs exit is — never a silent pass.
  if (input.refutations.length === 0) {
    process.stderr.write("aggregate: no refutations supplied — refusing to vote (an empty set would silently approve; treat as needs-human)\n");
    return 3;
  }
  if (Number.isInteger(nEnabled) && nEnabled > 0 && input.refutations.length !== nEnabled) {
    process.stderr.write(`aggregate: refutation count (${input.refutations.length}) != enabled-lens count (${nEnabled}) — refusing to vote on an inconsistent set (treat as needs-human)\n`);
    return 3;
  }
  const result = aggregate(input.refutations, nEnabled);
  process.stdout.write(renderBlock(result));
  return 0;
}

// Run as CLI only when invoked directly (not when imported by the test).
// `import.meta.url` is a percent-encoded file: URL; build the comparison URL from process.argv[1]
// via pathToFileURL so it encodes identically. Concatenating the file scheme with the raw path
// under-encodes URL-special chars (e.g. an interpunct in a worktree branch dir), silently failing
// the equality and no-op'ing main() on a gate component (FAFF-464). FAFF-813: faff installs each
// skill by symlinking `plugin/skills/<skill>/` into `~/.claude/skills/<skill>`, so a production
// invocation's process.argv[1] is the symlink path while import.meta.url is already the repo
// realpath — canonicalise argv1 through realpathSync before comparing so a symlinked install path
// still matches.
export function entrypoint_href(argv1) {
  if (!argv1) return null;
  try {
    return pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return pathToFileURL(argv1).href;
  }
}

if (import.meta.url === entrypoint_href(process.argv[1])) {
  process.exit(main(process.argv));
}
