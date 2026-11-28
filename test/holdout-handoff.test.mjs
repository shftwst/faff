import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main as evaluate } from "../plugin/skills/faffter-noon-evaluate/evaluate-call.mjs";

const require = createRequire(import.meta.url);
const { readHoldout } = require("../plugin/skills/faff/bin/lib/merge-gate-floor.js");
const CLI = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const SPEC = [
  "## Scenarios", "", "```holdout", "Given one order", "When an order is posted", "Then the response is 201", "```", "",
  "- The prose reads well", "",
  "## 8. DONE", "", "- [ ] The copy reads well", "- [ ] needs-human: A designer approves the colors", "",
].join("\n");

function cli(root, args, input) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, input, encoding: "utf8" });
}

function fixture(t, specText = SPEC) {
  const root = mkdtempSync(join(tmpdir(), "faff-holdout-handoff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  writeFileSync(join(root, ".faffrc.yaml"), "lanes:\n  evaluator:\n    isolation:\n      container: own\n");
  const runDir = join(root, ".faff", "runs", "run-example");
  const key = "FAFF-42";
  mkdirSync(join(runDir, key), { recursive: true });
  mkdirSync(join(root, ".faff", "holdout"), { recursive: true });
  const spec = join(root, "spec.md");
  writeFileSync(spec, specText);
  const runFile = join(runDir, key, "holdout.json");
  const storeFile = join(root, ".faff", "holdout", `${key}.json`);
  const intent = join(runDir, "lane-boundary.json");
  return { root, runDir, key, spec, runFile, storeFile, intent };
}

function checked(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("criteria preserves exact canonical running-stack inputs and emits the existing human-only result", (t) => {
  const f = fixture(t);
  const original = checked(cli(f.root, ["dod", "classify", "--spec", f.spec, "--json"]));
  const prepared = checked(cli(f.root, ["holdout", "criteria", "--spec", f.spec]));
  const judged = original.criteria.filter((row) => row.verification_tier === "running-stack");
  assert.ok(judged.some((row) => row.holdout));
  assert.ok(judged.some((row) => row.class === "prose"));
  assert.ok(original.criteria.some((row) => row.human_only && row.verification_tier === "delegated"));
  assert.deepEqual(prepared.criteria, judged.map(({ id, text, class: kind, holdout }) => ({
    id, text, class: kind, holdout,
    ...(kind === "prose" ? { verdict: "needs-human", evidence_present: false, reason: "prose scenario: no machine check and no delegate verifier", reason_code: "human-only" } : {}),
  })));
  assert.deepEqual(checked(cli(f.root, ["holdout", "criteria", "--spec", f.spec, "--counts"])), {
    judged_count: original.judged_count, integration_count: original.integration_count, delegated_count: original.delegated_count,
  });
  assert.equal(cli(f.root, ["holdout", "criteria", "--spec", join(f.root, "missing.md")]).status, 2);
});

function offer(f, mode, ...args) {
  return cli(f.root, ["holdout", "offer", "--spec", f.spec, "--issue", f.key, "--run-dir", f.runDir, "--mode", mode, ...args]);
}

test("offer follows the live autonomous posture, counts the full spec and writes intent alone", t => {
  const f = fixture(t);
  const marker = join(f.runDir, f.key, "holdout-offer.json");
  const counts = checked(cli(f.root, ["holdout", "criteria", "--spec", f.spec, "--counts"]));
  assert.ok(counts.judged_count > 0);
  for (const [level, unattended, decision] of [["L3", false, "skip"], ["L4", false, "auto"], ["L3", true, "auto"]]) {
    writeFileSync(join(f.root, ".faffrc.yaml"), `autonomous:\n  unattended: ${unattended}\nverification:\n  holdout: true\n`);
    writeFileSync(join(f.runDir, "run-ledger.json"), JSON.stringify({ level }));
    const { action, decided_at, ...record } = checked(offer(f, "autonomous", "--holdout"));
    assert.equal(action, "recorded");
    assert.equal(new Date(decided_at).toISOString(), decided_at);
    assert.deepEqual(record, { decision, attended: false, ...counts });
    assert.deepEqual(JSON.parse(readFileSync(marker)), { ...record, decided_at });
    assert.equal(existsSync(f.runFile), false);
    assert.equal(existsSync(f.storeFile), false);
  }
});

test("attended offer asks for consent or accepts an existing explicit posture", t => {
  const f = fixture(t);
  writeFileSync(join(f.runDir, "run-ledger.json"), JSON.stringify({ level: "L2" }));
  const marker = join(f.runDir, f.key, "holdout-offer.json");
  assert.equal(checked(offer(f, "interactive")).action, "ask");
  assert.equal(existsSync(marker), false);
  for (const [args, decision] of [[["--answer", "yes"], "accept"], [["--answer", "no"], "decline"], [["--holdout"], "accept"]]) {
    assert.equal(checked(offer(f, "interactive", ...args)).decision, decision);
    assert.equal(JSON.parse(readFileSync(marker)).attended, true);
  }
  writeFileSync(join(f.root, ".faffrc.yaml"), "verification:\n  holdout: true\n");
  assert.equal(checked(offer(f, "interactive")).decision, "accept");
  assert.equal(checked(offer(f, "interactive", "--answer", "no")).decision, "decline");
});

test("integration-only offer always skips, including unattended and pre-accepted attended runs", t => {
  const f = fixture(t, "## Scenarios\n\n```integration\nGiven a\nWhen b\nThen c\n```\n");
  for (const [level, mode] of [["L4", "autonomous"], ["L2", "interactive"]]) {
    writeFileSync(join(f.runDir, "run-ledger.json"), JSON.stringify({ level }));
    const receipt = checked(offer(f, mode, "--holdout"));
    assert.equal(receipt.judged_count, 0);
    assert.ok(receipt.integration_count > 0);
    assert.equal(receipt.decision, "skip");
  }
});

test("offer rejects missing run or spec, invalid routing and autonomous consent", t => {
  const f = fixture(t);
  assert.equal(offer(f, "interactive").status, 2);
  writeFileSync(join(f.runDir, "run-ledger.json"), JSON.stringify({ level: "L3" }));
  for (const [args, mode, flags] of [
    [{ key: "../other" }, "autonomous", []], [{ runDir: f.root }, "autonomous", []],
    [{ spec: join(f.root, "missing") }, "autonomous", []], [{}, "invalid", []],
    [{}, "autonomous", ["--answer", "yes"]], [{}, "interactive", ["--answer", "maybe"]],
  ]) assert.equal(offer({ ...f, ...args }, mode, ...flags).status, 2);
  assert.equal(existsSync(join(f.runDir, f.key, "holdout-offer.json")), false);
});

const receiptArgs = (f, status = 0) => ["holdout", "receipt", "--key", f.key, "--run-dir", f.runDir, "--writer-exit", String(status)];

test("receipt reads the actual spawner-owned files without changing the code-blind payload", async (t) => {
  const f = fixture(t);
  checked(cli(f.root, ["lane-boundary", "emit", "--run-dir", f.runDir, "--lane", "evaluator", "--json"]));
  const specText = readFileSync(f.spec, "utf8");
  const endpoint = "https://fixture.example.invalid/ready";
  const credential = "holdout-runtime-token-do-not-return";
  const credentials = join(f.root, "credentials.json");
  writeFileSync(credentials, JSON.stringify({ scheme: "bearer", token: credential }));
  const prepared = checked(cli(f.root, ["holdout", "criteria", "--spec", f.spec]));
  const verdict = {
    aggregate: "needs-human",
    criteria: prepared.criteria.map((row) => row.class === "prose" ? row : ({
      ...row, verdict: "met", evidence_present: true, exercised: "POST /orders", expected: "201", observed: `201 ${credential}`,
    })),
  };
  let seenPayload;
  const launch = ["--spec", f.spec, "--endpoint", endpoint, "--key", f.key, "--out", f.runFile, "--store-out", f.storeFile, "--intent", f.intent, "--credentials", credentials];
  const status = await evaluate(launch, {
    preflightFn: () => ({ holds: true }),
    spawnFn: async (payload) => {
      seenPayload = payload;
      return { status: "ok", verdict };
    },
  });
  assert.equal(status, 0);
  assert.deepEqual(Object.keys(seenPayload), ["specText", "endpoints", "intentText", "deadlineMs", "credentials"]);
  assert.equal(seenPayload.specText, specText);
  assert.deepEqual(seenPayload.endpoints, [endpoint]);
  assert.equal(seenPayload.intentText, readFileSync(f.intent, "utf8"));
  assert.deepEqual(seenPayload.credentials, { scheme: "bearer", token: credential });
  const original = readFileSync(f.runFile, "utf8");
  assert.equal(readFileSync(f.storeFile, "utf8"), original);
  assert.equal(JSON.parse(original).spawner_attested, true);
  assert.ok(!original.includes(credential));
  assert.deepEqual(checked(cli(f.root, receiptArgs(f))), { aggregate: "needs-human", spawner_attested: true });
  const expired = await evaluate(launch, {
    preflightFn: () => ({ holds: true }),
    spawnFn: async () => ({ status: "deadline" }),
  });
  assert.equal(expired, 8);
  assert.equal(readFileSync(f.runFile, "utf8"), original);
  const failed = cli(f.root, receiptArgs(f, expired));
  assert.equal(failed.status, 1);
  assert.deepEqual(JSON.parse(failed.stdout), { aggregate: "needs-human", reason: "writer-failed" });
  writeFileSync(f.storeFile, original + "\n");
  assert.equal(cli(f.root, receiptArgs(f)).status, 1);
  rmSync(f.runFile);
  assert.equal(cli(f.root, receiptArgs(f)).status, 1);
});

test("receipt keeps the legacy inline path and refuses the same record once a cage is promised", (t) => {
  const f = fixture(t);
  const prepared = checked(cli(f.root, ["holdout", "criteria", "--spec", f.spec]));
  const criteria = prepared.criteria.map((row) => row.class === "prose" ? row : ({
    ...row, verdict: "met", evidence_present: true, exercised: "GET /", expected: "200", observed: "200",
  }));
  const record = cli(f.root, ["holdout", "record", "--issue", f.key, "--spec", f.spec, "--run-dir", f.runDir], JSON.stringify({
    code_blind: true, aggregate: "needs-human", criteria,
  }));
  assert.equal(record.status, 0, record.stderr);
  assert.deepEqual(checked(cli(f.root, receiptArgs(f))), { aggregate: "needs-human", spawner_attested: false });
  checked(cli(f.root, ["lane-boundary", "emit", "--run-dir", f.runDir, "--lane", "evaluator", "--json"]));
  assert.equal(cli(f.root, receiptArgs(f)).status, 1);
  writeFileSync(f.intent, "{ malformed");
  assert.equal(cli(f.root, receiptArgs(f)).status, 1);
  rmSync(f.intent);
  assert.equal(cli(f.root, [...receiptArgs(f), "--caged"]).status, 1);
  const doc = JSON.parse(readFileSync(f.storeFile, "utf8"));
  writeFileSync(f.storeFile, JSON.stringify({ ...doc, issue: "FAFF-77" }));
  assert.equal(cli(f.root, receiptArgs(f)).status, 1);
});

test("the receipt and existing merge-floor reader agree on a passing run-scoped record", (t) => {
  const f = fixture(t, SPEC.replace("- The prose reads well\n", ""));
  const prepared = checked(cli(f.root, ["holdout", "criteria", "--spec", f.spec]));
  const criteria = prepared.criteria.map((row) => ({
    ...row, verdict: "met", evidence_present: true, exercised: "POST /orders", expected: "201", observed: "201",
  }));
  const written = cli(f.root, ["holdout", "record", "--issue", f.key, "--spec", f.spec, "--run-dir", f.runDir], JSON.stringify({
    code_blind: true, aggregate: "meets-spec", criteria,
  }));
  assert.equal(written.status, 0, written.stderr);
  assert.deepEqual(checked(cli(f.root, receiptArgs(f))), { aggregate: "meets-spec", spawner_attested: false });
  writeFileSync(join(f.runDir, f.key, "build-progress.json"), JSON.stringify({ updated_at: "2000-01-01T00:00:00Z" }));
  assert.equal(readHoldout(f.runDir, f.key), "meets-spec");
  const floor = checked(cli(f.root, ["holdout", "verdict", "--issue", f.key, "--json"]));
  assert.equal(floor.gate, "pass");
  assert.equal(floor.aggregate, "meets-spec");
});
