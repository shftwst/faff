// FAFF-928 — the spec-review occupant's LensRequest[] assembler (build-lens-requests.mjs).
// Asserts every enabled lens's argv carries the raw-body flags (--raw-dir/--lens/--round) resolved
// under <scratch>/raw, and that an absent rawDir leaves the argv byte-for-byte as it was before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLensRequests, parseArgs } from "../plugin/skills/faffter-dark-spec-review/build-lens-requests.mjs";

const LENSES = ["architectural", "infosec", "methodology", "QA"];

function argFor(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

test("FAFF-928 AC6: each lens's argv carries --raw-dir <scratch>/raw --lens <lens> --round <n>", () => {
  const scratch = mkdtempSync(join(tmpdir(), "spec-review-"));
  const rawDir = join(scratch, "raw");
  const reqs = buildLensRequests({
    lenses: LENSES,
    backendsJson: join(scratch, "backends.json"),
    timeout: 120,
    maxTokens: 2000,
    systemDir: "plugin/skills/faffter-dark-spec-review",
    contextPaths: [join(scratch, "a.js"), join(scratch, "b.js")],
    diffPath: join(scratch, "spec.md"),
    rawDir,
    round: 2,
  });
  assert.equal(reqs.length, LENSES.length);
  for (const req of reqs) {
    assert.ok(LENSES.includes(req.lens));
    assert.equal(argFor(req.argv, "--raw-dir"), rawDir, `${req.lens}: --raw-dir resolves to <scratch>/raw`);
    assert.equal(argFor(req.argv, "--lens"), req.lens, `${req.lens}: --lens names the lens`);
    assert.equal(argFor(req.argv, "--round"), "2", `${req.lens}: --round names the round`);
    // the pre-existing argv fields are still present and per-lens correct
    assert.equal(argFor(req.argv, "--system"), `plugin/skills/faffter-dark-spec-review/refute-${req.lens}.md`);
    assert.equal(argFor(req.argv, "--diff"), join(scratch, "spec.md"));
    assert.equal(argFor(req.argv, "--max-tokens"), "2000");
    assert.equal(req.argv.filter((a) => a === "--context").length, 2, "both context files carried");
  }
});

test("FAFF-928 AC6: absent rawDir omits the three raw-body flags (byte-for-byte the old argv)", () => {
  const [req] = buildLensRequests({
    lenses: ["architectural"],
    backendsJson: "b.json", timeout: 120, maxTokens: 2000,
    systemDir: "d", contextPaths: ["a.js"], diffPath: "spec.md",
    // no rawDir / round
  });
  assert.ok(!req.argv.includes("--raw-dir"), "no --raw-dir without a scratch dir");
  assert.ok(!req.argv.includes("--lens"), "no --lens without a scratch dir");
  assert.ok(!req.argv.includes("--round"), "no --round without a scratch dir");
});

test("FAFF-928 AC6: the CLI arg parser round-trips --lenses / --raw-dir / --round", () => {
  const a = parseArgs(["--lenses", "architectural,QA", "--backends-json", "b", "--system-dir", "d",
    "--diff", "s", "--context", "f1", "--context", "f2", "--raw-dir", "/r", "--round", "3", "--timeout", "90", "--max-tokens", "1500"]);
  assert.deepEqual(a.lenses, ["architectural", "QA"]);
  assert.deepEqual(a.contextPaths, ["f1", "f2"]);
  assert.equal(a.rawDir, "/r");
  assert.equal(a.round, "3");
});
