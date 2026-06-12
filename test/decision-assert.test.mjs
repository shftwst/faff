// FAFF-95 — Decision-assertion matcher self-test.
//
// The defining property of every matcher: it goes RED (throws AssertionError) when the
// captured decision diverges from the declared expectation, and is silent on a match.
// Each matcher gets a pass-on-match case AND a throws-on-mismatch case. The expectCliResult
// case runs against a record from a REAL `runSkill` (real `faff next`) so the parse is
// proven non-tautological. Synthetic records are built via the harness's makeRecorder
// (which FAFF-93 exports for FAFF-95 to reuse). Bare `node --test` — no LLM, no network.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeRecorder } from "./helpers/skill-harness.mjs";
import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill, scriptedDriver } from "./helpers/skill-harness.mjs";
import {
  expectBucket,
  expectNoBucket,
  expectOrder,
  expectVerdict,
  expectVerdictOrder,
  expectMutation,
  expectNoMutation,
  expectCliResult,
  expectSeamOrder,
  expectRendering,
} from "./helpers/decision-assert.mjs";

// Build a synthetic DecisionRecord by replaying record-* calls through makeRecorder,
// then asserting both the pass and the throw with one fixture.
function recordWith(fn) {
  const r = makeRecorder();
  fn(r);
  return r.assemble("test-skill", "scripted");
}

const throwsAssertion = (fn) => assert.throws(fn, assert.AssertionError);

test("expectBucket: deep-equals on match, throws on a different id set", () => {
  const rec = recordWith((r) => r.recordBucket("ready", ["ISS-A"]));
  expectBucket(rec, "ready", ["ISS-A"]); // passes
  throwsAssertion(() => expectBucket(rec, "ready", ["ISS-B"]));
  throwsAssertion(() => expectBucket(rec, "missing", [])); // absent key fails loud
});

test("expectNoBucket: passes when absent, throws when the bucket was emitted", () => {
  const rec = recordWith((r) => r.recordBucket("ready", ["ISS-A"]));
  expectNoBucket(rec, "on-hold"); // passes
  throwsAssertion(() => expectNoBucket(rec, "ready"));
});

test("expectOrder: order-sensitive — author-supplied order, no ranking computed", () => {
  const rec = recordWith((r) => r.recordBucket("b", ["X", "Y"]));
  expectOrder(rec, "b", ["X", "Y"]); // passes
  throwsAssertion(() => expectOrder(rec, "b", ["Y", "X"])); // reversed -> red
});

test("expectVerdict: matches {issue,token}(+source); throws on wrong token", () => {
  const rec = recordWith((r) => r.recordVerdict("ISS-A", "graft", "faff next"));
  expectVerdict(rec, "ISS-A", "graft"); // passes
  expectVerdict(rec, "ISS-A", "graft", "faff next"); // source matches
  throwsAssertion(() => expectVerdict(rec, "ISS-A", "prep"));
  throwsAssertion(() => expectVerdict(rec, "ISS-A", "graft", "other-source"));
});

test("expectVerdictOrder: verdicts in seq order name the expected issues", () => {
  const rec = recordWith((r) => {
    r.recordVerdict("ISS-A", "graft", "faff next");
    r.recordVerdict("ISS-B", "prep", "faff next");
  });
  expectVerdictOrder(rec, ["ISS-A", "ISS-B"]); // passes
  throwsAssertion(() => expectVerdictOrder(rec, ["ISS-B", "ISS-A"]));
});

test("expectMutation: matches op (+ issue + args subset); throws on wrong op/issue", () => {
  const rec = recordWith((r) => r.recordMutation("setStatus", "ISS-A", { status: "Todo", extra: 1 }));
  expectMutation(rec, { op: "setStatus" }); // op only
  expectMutation(rec, { op: "setStatus", issue: "ISS-A", args: { status: "Todo" } }); // subset args
  throwsAssertion(() => expectMutation(rec, { op: "removeLabel" }));
  throwsAssertion(() => expectMutation(rec, { op: "setStatus", issue: "ISS-Z" }));
  throwsAssertion(() => expectMutation(rec, { op: "setStatus", args: { status: "Done" } }));
});

test("expectNoMutation: passes on an empty mutation list, throws when one exists", () => {
  const empty = recordWith(() => {});
  expectNoMutation(empty); // passes
  const withMut = recordWith((r) => r.recordMutation("setStatus", "ISS-A", { status: "Todo" }));
  throwsAssertion(() => expectNoMutation(withMut));
  // filtered: a non-matching filter still passes
  expectNoMutation(withMut, { op: "removeLabel" });
  throwsAssertion(() => expectNoMutation(withMut, { op: "setStatus" }));
});

test("expectCliResult: NON-TAUTOLOGICAL — parses real `faff next` stdout from a real runSkill", (t) => {
  const tracker = loadFixture({
    version: 1,
    labels: [{ name: "faff-automate", color: "#6fcf97" }],
    issues: [
      { id: "ISS-A", title: "ready", state: "Backlog", stateCategory: "backlog", labels: ["faff-automate"] },
    ],
  });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { cli: ["eligible", "--label", "faff-automate"] }, // real -> "true"
      { cli: ["next", "--status", "backlog", "--spec", "high"] }, // real -> {"next":"graft"}
    ]),
  });

  // passes against the real computed output
  expectCliResult(rec, "eligible", { exit: 0, stdoutTrim: "true" });
  expectCliResult(rec, "next", { exit: 0, json: { next: "graft" } });
  // a wrong expectation goes red — proves the matcher actually reads real stdout, not the script
  throwsAssertion(() => expectCliResult(rec, "next", { json: { next: "prep" } }));
  throwsAssertion(() => expectCliResult(rec, "eligible", { stdoutTrim: "false" }));
  throwsAssertion(() => expectCliResult(rec, "config", { exit: 0 })); // no such CLI call
});

test("expectSeamOrder: before-seq < after-seq; reversed throws; no-match throws", () => {
  const rec = recordWith((r) => {
    r.recordCli(["next", "--status", "backlog"], '{"next":"graft"}', 0);
    r.recordBucket("ready", ["ISS-A"]);
  });
  expectSeamOrder(rec, { kind: "cliCall", argvHead: "next" }, { kind: "bucket", name: "ready" }); // passes
  throwsAssertion(() =>
    expectSeamOrder(rec, { kind: "bucket", name: "ready" }, { kind: "cliCall", argvHead: "next" }),
  );
  // a selector that matches nothing is a loud AssertionError, not a TypeError
  throwsAssertion(() =>
    expectSeamOrder(rec, { kind: "cliCall", argvHead: "nope" }, { kind: "bucket", name: "ready" }),
  );
});

test("expectRendering: membership match; throws when the surface was not emitted", () => {
  const rec = recordWith((r) => r.recordRendering("tidy-report"));
  expectRendering(rec, "tidy-report"); // passes
  throwsAssertion(() => expectRendering(rec, "wtf-briefing"));
});

test("matchers fail loud on a malformed record (clear AssertionError, not TypeError)", () => {
  throwsAssertion(() => expectVerdict({}, "ISS-A", "graft")); // rec.verdicts not an array
  throwsAssertion(() => expectBucket({}, "ready", [])); // rec.buckets missing
});
