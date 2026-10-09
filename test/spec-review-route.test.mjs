// Severity-aware reject-approach routing: the pure `routeRejectApproach` partition and the
// `faff spec-review route` CLI verb that wraps it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { routeRejectApproach, specReviewSelftest } from "../plugin/skills/faff/bin/lib/spec-review.js";

const o = (lens, severity, extra = {}) => ({ lens, severity, ...extra });
const rv = (objections, extra = {}) => ({ verdict: "reject-approach", objections, ...extra });
const route = (record) => {
  const r = routeRejectApproach(record);
  assert.equal(r.error, undefined, r.error);
  return r.route;
};

// Lens/severity lists copied from the recorded rounds, not read from run files.
const R_1201 = [o("infosec", "minor"), o("infosec", "minor"), o("methodology", "minor"), o("QA", "minor")];
const R_1198 = [
  o("architectural", "minor"), o("methodology", "major"), o("methodology", "major"),
  o("methodology", "minor"), o("methodology", "minor"), o("QA", "minor"), o("QA", "minor"),
];

test("round-1 shape from the minors-only case routes to prep with nothing carried", () => {
  assert.deepEqual(route(rv(R_1201)), { destination: "prep", reason: "no-methodology-major", carried_design_objections: [] });
});

test("round-1 shape with methodology majors routes to plot carrying design objections in order", () => {
  assert.deepEqual(route(rv(R_1198)), {
    destination: "plot",
    reason: "methodology-major-or-above",
    carried_design_objections: [o("architectural", "minor"), o("QA", "minor"), o("QA", "minor")],
  });
});

test("methodology only: minor -> prep; major -> plot; blocker -> plot", () => {
  assert.equal(route(rv([o("methodology", "minor")])).destination, "prep");
  assert.equal(route(rv([o("methodology", "major")])).destination, "plot");
  assert.equal(route(rv([o("methodology", "blocker")])).destination, "plot");
  assert.deepEqual(route(rv([o("methodology", "major")])).carried_design_objections, []);
});

test("design lenses only (including a blocker) -> prep, nothing carried", () => {
  for (const lens of ["architectural", "infosec", "QA"]) {
    for (const sev of ["minor", "major", "blocker"]) {
      const r = route(rv([o(lens, sev)]));
      assert.equal(r.destination, "prep", `${lens}/${sev}`);
      assert.equal(r.reason, "no-methodology-major");
      assert.deepEqual(r.carried_design_objections, []);
    }
  }
});

test("methodology minor plus design lenses -> prep, nothing carried", () => {
  const r = route(rv([o("methodology", "minor"), o("architectural", "blocker"), o("QA", "major")]));
  assert.equal(r.destination, "prep");
  assert.deepEqual(r.carried_design_objections, []);
});

test("methodology major plus design lenses -> plot, carried is {lens, severity} only in input order", () => {
  const r = route(rv([
    o("QA", "major", { claim: "c", evidence: "e", disposition: "fixed" }),
    o("methodology", "major", { claim: "m" }),
    o("infosec", "blocker", { spec_anchor: "a" }),
  ]));
  assert.equal(r.destination, "plot");
  assert.deepEqual(r.carried_design_objections, [{ lens: "QA", severity: "major" }, { lens: "infosec", severity: "blocker" }]);
  for (const c of r.carried_design_objections) assert.deepEqual(Object.keys(c), ["lens", "severity"]);
});

test("single-pass shapes: architectural blocker + methodology minor -> prep; + methodology major -> plot", () => {
  assert.equal(route(rv([o("architectural", "blocker"), o("methodology", "minor")])).destination, "prep");
  const r = route(rv([o("architectural", "blocker"), o("methodology", "major")]));
  assert.equal(r.destination, "plot");
  assert.deepEqual(r.carried_design_objections, [o("architectural", "blocker")]);
});

test("both input shapes (raw body, contract stdout) route identically", () => {
  for (const objections of [R_1201, R_1198]) {
    assert.deepEqual(
      routeRejectApproach(rv(objections)),
      routeRejectApproach(rv(objections, { conformant: true, violations: [] })),
    );
  }
});

test("routeRejectApproach errors on every malformed or non-reject-approach input", () => {
  const bad = [
    null, [], "x", 3,
    { verdict: "revise", objections: [o("architectural", "major")] },
    { objections: [o("architectural", "major")] },
    rv([o("QA", "minor")], { conformant: false }),
    rv([]),
    { verdict: "reject-approach" },
    { verdict: "reject-approach", objections: "nope" },
    rv([o("observation", "minor")]),
    rv([o("QA", "critical")]),
    rv([o("QA", "minor"), null]),
  ];
  for (const b of bad) {
    const r = routeRejectApproach(b);
    assert.equal(typeof r.error, "string", JSON.stringify(b));
    assert.equal(r.route, undefined);
  }
  assert.match(routeRejectApproach({ verdict: "revise", objections: [] }).error, /reject-approach/);
});

test("specReviewSelftest() still returns 0", () => {
  assert.equal(specReviewSelftest(), 0);
});

// --- CLI wiring ---
const BODY = JSON.stringify(rv(R_1201));
const PREP_LINE = '{"destination":"prep","reason":"no-methodology-major","carried_design_objections":[]}\n';

test("CLI route: stdin (no --file) and --file - print one Route line, exit 0", () => {
  const a = runCli(["spec-review", "route"], { input: BODY });
  assert.equal(a.code, 0);
  assert.equal(a.stdout, PREP_LINE);
  const b = runCli(["spec-review", "route", "--file", "-"], { input: BODY });
  assert.equal(b.code, 0);
  assert.equal(b.stdout, PREP_LINE);
});

test("CLI route: --file <path>", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-route-"));
  try {
    const p = join(dir, "v.json");
    writeFileSync(p, JSON.stringify(rv(R_1198)));
    const r = runCli(["spec-review", "route", "--file", p]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.equal(JSON.parse(r.stdout).destination, "plot");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI route: exit 2 with empty stdout on bad input", () => {
  const cases = [
    { args: ["--file", "/no/such/verdict.json"] },
    { args: ["--file", "-"], input: "{ not json" },
    { args: ["--file", "-"], input: "" },
    { args: ["--file", "-"], input: JSON.stringify({ verdict: "revise", objections: [o("architectural", "major")] }), msg: /reject-approach/ },
    { args: ["--file", "-"], input: JSON.stringify(rv([o("QA", "minor")], { conformant: false })) },
    { args: ["--file", "-"], input: JSON.stringify(rv([])) },
    { args: ["--file", "-"], input: JSON.stringify(rv([o("observation", "minor")])) },
    { args: ["--file", "-"], input: JSON.stringify(rv([o("QA", "critical")])) },
  ];
  for (const c of cases) {
    const r = runCli(["spec-review", "route", ...c.args], { input: c.input ?? "" });
    assert.equal(r.code, 2, JSON.stringify(c));
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.length > 0);
    if (c.msg) assert.match(r.stderr, c.msg);
  }
});

test("CLI: unknown verb message and usage list route", () => {
  const r = runCli(["spec-review", "nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /route/);
  const u = runCli(["spec-review", "route", "extra"]);
  assert.equal(u.code, 2);
  assert.match(u.stderr, /route \[--file/);
});

test("pipe: faff contract spec-review-verdict stdout routes (prep, then plot)", () => {
  const run = (objections) => {
    const v = runCli(["contract", "spec-review-verdict"], { input: JSON.stringify(rv(objections)) });
    assert.equal(v.code, 0);
    return runCli(["spec-review", "route"], { input: v.stdout });
  };
  const prep = run(R_1201);
  assert.equal(prep.code, 0);
  assert.deepEqual(JSON.parse(prep.stdout), { destination: "prep", reason: "no-methodology-major", carried_design_objections: [] });
  const plot = run(R_1201.map((x) => (x.lens === "methodology" ? { ...x, severity: "major" } : x)));
  assert.equal(plot.code, 0);
  assert.deepEqual(JSON.parse(plot.stdout).carried_design_objections, [o("infosec", "minor"), o("infosec", "minor"), o("QA", "minor")]);
  assert.equal(JSON.parse(plot.stdout).destination, "plot");
});
