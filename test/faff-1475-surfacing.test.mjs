// FAFF-1475 slice 2, surfacing: `faff run summary` lists the human-only criteria an unattended merge
// skipped, and `faff governance-check` names them when its AC leg passes by skip.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildRun } from "./fixtures/run-summary/build.mjs";

const require = createRequire(import.meta.url);
const rs = require("../plugin/skills/faff/bin/lib/run-summary.js");

const EMPTY_HOME = mkdtempSync(join(tmpdir(), "faff-1475-surfacing-home-"));
process.env.HOME = EMPTY_HOME;
delete process.env.CLAUDE_CONFIG_DIR;

const deps = () => ({
  ghJson: (args) => ({ ok: false, data: null, stderr: `unstubbed gh ${args.join(" ")}` }),
  doctor: () => ({ exit: 0, resultLine: "RESULT: all faff skills are dev-linked (symlinks) — repo is live." }),
  economics: () => ({ tokens_total: 1000, tokens_source: "estimate", cost_total: null, zero_ship: false, cost_per_shipped: { tokens_each: 1000, cost_each: null }, cost_per_attempt: { denom: 1, tokens_each: 1000, cost_each: null } }),
  budget: () => ({ breached: [], tokens_source: "estimate" }),
  methodology: () => null,
});

function render(fx) {
  const factsPath = join(fx.root, "facts.json");
  writeFileSync(factsPath, JSON.stringify({ format: 2, tracker: {}, run: {} }));
  return rs.renderRunSummary({ runDir: fx.runDir, factsPath, root: fx.root, sessionId: null }, deps());
}

const section = (text, heading) => text.split("\n## ").find((s) => s.startsWith(heading)) ?? "";
const CALLED = { pr: 7, head_sha: "abc", merged: true, ac_called_out: ["faff-9#ac-2"] };

describe("run summary", () => {
  test("a called-out issue is listed in its own section and is absent from the auto-merged one", () => {
    const fx = buildRun({ admitted: ["X"], outcomes: { X: "shipped" }, files: { "X/merge-record.json": CALLED } });
    const out = render(fx);
    const calledOut = section(out, "Shipped (human-only ACs called out)");
    assert.match(calledOut, /- X/);
    assert.match(calledOut, /faff-9#ac-2/);
    assert.match(calledOut, /a person must confirm/);
    assert.ok(!section(out, "Shipped (auto-merged)").includes("- X"));
  });

  test("an issue with no called-out ids stays under auto-merged and no called-out section appears", () => {
    const fx = buildRun({ admitted: ["X"], outcomes: { X: "shipped" }, files: { "X/merge-record.json": { pr: 7, head_sha: "abc", merged: true } } });
    const out = render(fx);
    assert.ok(section(out, "Shipped (auto-merged)").includes("- X"));
    assert.ok(!out.includes("human-only ACs called out"));
  });

  test("an empty or malformed ac_called_out is ignored", () => {
    for (const bad of [[], "faff-9#ac-2", [3, null], { a: 1 }]) {
      const fx = buildRun({ admitted: ["X"], outcomes: { X: "shipped" }, files: { "X/merge-record.json": { pr: 7, head_sha: "abc", merged: true, ac_called_out: bad } } });
      const out = render(fx);
      assert.ok(!out.includes("human-only ACs called out"), JSON.stringify(bad));
      assert.ok(section(out, "Shipped (auto-merged)").includes("- X"));
    }
  });

  test("an issue appears under exactly one shipped subsection: post-merge flagged outranks called out, which outranks adversarial skipped", () => {
    const fx = buildRun({
      admitted: ["A", "B", "C"],
      outcomes: { A: "shipped", B: "shipped", C: "shipped" },
      ledger: { review_adversarial_skipped: ["B", "C"], post_merge_verification_failures: [{ issue: "A", command: "npm test" }] },
      files: { "A/merge-record.json": CALLED, "B/merge-record.json": CALLED, "C/merge-record.json": { pr: 8, head_sha: "def", merged: true } },
    });
    const out = render(fx);
    const flagged = section(out, "Shipped (post-merge verification flagged)");
    const calledOut = section(out, "Shipped (human-only ACs called out)");
    const skipped = section(out, "Shipped (adversarial review skipped");
    assert.ok(flagged.includes("- A") && !calledOut.includes("- A") && !skipped.includes("- A"));
    assert.ok(calledOut.includes("- B") && !flagged.includes("- B") && !skipped.includes("- B"));
    assert.ok(skipped.includes("- C") && !calledOut.includes("- C"));
    assert.ok(!section(out, "Shipped (auto-merged)").match(/- [ABC]\b/));
  });

  test("a higher-precedence line for a called-out issue names its called-out ids", () => {
    const fx = buildRun({
      admitted: ["A"], outcomes: { A: "shipped" },
      ledger: { post_merge_verification_failures: [{ issue: "A", command: "npm test" }] },
      files: { "A/merge-record.json": CALLED },
    });
    assert.match(section(render(fx), "Shipped (post-merge verification flagged)"), /human-only ACs called out: faff-9#ac-2/);
  });

  test("called-out ids are rendered as inert text", () => {
    const fx = buildRun({ admitted: ["X"], outcomes: { X: "shipped" }, files: { "X/merge-record.json": { pr: 7, head_sha: "abc", merged: true, ac_called_out: ["faff-9#ac-2\n## injected"] } } });
    const out = render(fx);
    assert.ok(!out.split("\n").some((l) => l.startsWith("## injected")));
  });
});
