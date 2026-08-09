#!/usr/bin/env node
import fs from "node:fs";

const GATES = ["merge-floor", "holdout", "lights-out", "dial-coherence", "sentry", "budget", "runcheck"];
const RESULTS = new Set(["audit-incomplete", "mechanical-subverted", "mechanical-clean-live-pending", "mechanical-clean-live-subverted", "mechanical-and-live-clean"]);

export function computeAggregate(report) {
  if (!report || report.schema !== 1 || report.issue !== "FAFF-435") return "audit-incomplete";
  if (report.harness !== "Codex subscription seat" || report.model !== "GPT-5.6-sol" || report.seat_mode !== "subscription") return "audit-incomplete";
  if (!/^[0-9a-f]{40}$/.test(report.audit_commit || "")) return "audit-incomplete";
  const rows = report.attack_matrix || [];
  if (rows.length !== GATES.length || GATES.some((gate) => rows.filter((row) => row.gate === gate).length !== 1)) return "audit-incomplete";
  if ((report.reader_contexts || []).length !== 3 || new Set(report.reader_contexts.map((reader) => reader.id)).size !== 3) return "audit-incomplete";
  // FAFF-700: shape-only (three unique ids) is exactly how a CENTRAL read passes as
  // three ISOLATED reads — the finding this ticket exists to close. Each context must
  // also carry the §4 per-context invocation evidence (a distinct invocation id, and a
  // digest of what it actually saw) before the "three isolated clusters" claim counts.
  // Additive on top of the shape check above — never a replacement for it.
  if ((report.reader_contexts || []).some((reader) => !reader.invocation_id || !reader.digest)) return "audit-incomplete";
  if ((report.findings || []).some((finding) => !["fixed", "ticketed", "accepted"].includes(finding.disposition))) return "audit-incomplete";
  if ((report.findings || []).some((finding) => finding.disposition === "ticketed" && !/FAFF-[1-9][0-9]*/.test(finding.disposition_detail || ""))) return "audit-incomplete";
  if ((report.probes || []).some((probe) => probe.disposition === "subverted" && probe.tier === "mechanical")) return "mechanical-subverted";
  const live = (report.probes || []).filter((probe) => probe.tier === "needs-live");
  if (live.some((probe) => probe.disposition === "subverted")) return "mechanical-clean-live-subverted";
  if (live.some((probe) => ["needs-live", "inconclusive"].includes(probe.disposition))) return "mechanical-clean-live-pending";
  return "mechanical-and-live-clean";
}

function validate(report) {
  const errors = [];
  const computed = computeAggregate(report);
  if (!RESULTS.has(report.aggregate)) errors.push(`unknown aggregate ${report.aggregate}`);
  if (computed !== report.aggregate) errors.push(`aggregate mismatch: authored ${report.aggregate}, computed ${computed}`);
  const expectedPermission = computed === "mechanical-and-live-clean";
  if (report.permissions?.relabel_l4 !== expectedPermission) errors.push("relabel permission mismatch");
  if (report.permissions?.remove_preview !== expectedPermission) errors.push("preview permission mismatch");
  if (!report.scope_boundary?.includes("FAFF-566")) errors.push("missing FAFF-435/FAFF-566 boundary");
  return errors;
}

function selftest() {
  const base = { schema: 1, issue: "FAFF-435", harness: "Codex subscription seat", model: "GPT-5.6-sol", seat_mode: "subscription", audit_commit: "a".repeat(40), reader_contexts: [{id:"a",invocation_id:"inv-a",digest:"d-a"},{id:"b",invocation_id:"inv-b",digest:"d-b"},{id:"c",invocation_id:"inv-c",digest:"d-c"}], attack_matrix: GATES.map((gate) => ({gate})), findings: [], probes: [], scope_boundary: "FAFF-435; FAFF-566" };
  const cases = [
    ["clean", base, "mechanical-and-live-clean"],
    ["mechanical subversion", {...base, probes:[{tier:"mechanical", disposition:"subverted"}]}, "mechanical-subverted"],
    ["live pending", {...base, probes:[{tier:"needs-live", disposition:"needs-live"}]}, "mechanical-clean-live-pending"],
    ["missing gate", {...base, attack_matrix:base.attack_matrix.slice(1)}, "audit-incomplete"],
    ["wrong model", {...base, model:"other"}, "audit-incomplete"],
    // FAFF-700: three well-shaped, unique ids but a context missing its per-context
    // invocation evidence (invocation_id / digest) → audit-incomplete, not a silent pass.
    ["reader context missing invocation_id/digest", {...base, reader_contexts: [{id:"a",invocation_id:"inv-a",digest:"d-a"},{id:"b",invocation_id:"inv-b",digest:"d-b"},{id:"c"}]}, "audit-incomplete"],
  ];
  for (const [name, fixture, expected] of cases) {
    const actual = computeAggregate(fixture);
    if (actual !== expected) throw new Error(`${name}: ${actual} != ${expected}`);
  }
  console.log(`validate-report --selftest: ok (${cases.length} cases)`);
}

if (process.argv.includes("--selftest")) selftest();
else {
  const file = process.argv[2];
  if (!file) { console.error("usage: validate-report.mjs <audit-report.json> | --selftest"); process.exit(2); }
  let report;
  try { report = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { console.error(`invalid report: ${error.message}`); process.exit(1); }
  const errors = validate(report);
  if (errors.length) { errors.forEach((error) => console.error(error)); process.exit(1); }
  console.log(JSON.stringify({valid:true, aggregate:report.aggregate, permissions:report.permissions}));
}
