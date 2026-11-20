import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const faff = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const aggregate = fileURLToPath(new URL("../plugin/skills/faffter-dark-spec-review/aggregate.mjs", import.meta.url));
const backends = [
  { provider: "openai", model: "first", host: "https://first.invalid/v1" },
  { provider: "nvidia", model: "team/second", host: "https://second.invalid/v1" },
];

const observation = "### observation: no findings\n";
const critical = "### critical: Incorrect behaviour\n- claim: A failed check exits successfully.\n";
const receipt = (lens, options = {}) => ({ lens, exit: 0, stdout: "", stderr: "", truncated: false, ...options });
function served(lens, index, body = observation, options = {}) {
  const { provider, model } = backends[index];
  return receipt(lens, {
    stdout: `## Adversarial findings — ${provider}/${model} (chain[${index}], host: config)\n\n${body}`,
    ...options,
  });
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "faff-spec-review-receipts-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "results.json");
  const chain = join(dir, "backends.json");
  writeFileSync(chain, JSON.stringify(backends));
  const run = (...args) => spawnSync(process.execPath, [faff, "spec-review", "record-results", "--dir", dir, ...args], {
    cwd: dir, encoding: "utf8",
  });
  const fold = (result, count) => result.status === 0
    ? spawnSync(process.execPath, [aggregate, "--n", String(count)], { input: result.stdout, encoding: "utf8", cwd: dir })
    : result;
  const prepRound = (block) => {
    const verdictFile = join(dir, "prep-verdict.md");
    writeFileSync(verdictFile, block);
    return spawnSync(process.execPath, [faff, "spec-review", "round", "--issue", "FIXTURE-1", "--dir", dir,
      "--verdict-file", verdictFile, "--mode", "autonomous", "--occupant", "adversarial", "--served", "any", "--root", dir, "--json"], {
      cwd: dir, encoding: "utf8",
    });
  };
  const capture = (rows, lenses, round, receiptsOnly) => {
    writeFileSync(file, JSON.stringify(rows));
    const options = receiptsOnly ? ["--receipts-only"] : [];
    return run("--round", String(round), "--lenses", lenses.join(","), "--backends-json", chain, "--results", file, ...options);
  };
  return {
    dir,
    chain,
    prepRound,
    fold,
    read: (name) => readFileSync(join(dir, name), "utf8"),
    json: (name) => JSON.parse(readFileSync(join(dir, name), "utf8")),
    record: (rows, lenses = rows.map(row => row.lens), round = 1) => {
      const partial = lenses.length < 4;
      const result = capture(rows, lenses, round, partial);
      return partial ? fold(result, lenses.length) : result;
    },
    receipts: (rows, round = 1) => capture(rows, rows.map(row => row.lens), round, true),
    publish: (rows, round = 1) => capture(rows, rows.map(row => row.lens), round, false),
    missing: (lenses, round = 1) => {
      const partial = lenses.length < 4;
      const options = partial ? ["--receipts-only"] : [];
      const result = run("--round", String(round), "--lenses", lenses.join(","), "--no-results", ...options);
      return partial ? fold(result, lenses.length) : result;
    },
  };
}

function verdict(run) {
  assert.equal(run.status, 0, run.stderr);
  const block = run.stdout.match(/^```faff-contract:spec-review-verdict\n([^\n]+)\n```\n$/);
  assert.ok(block, run.stdout);
  return JSON.parse(block[1]);
}

test("record-results keeps exit-0 bytes and pins the strongest actual serving backend", (t) => {
  const f = fixture(t);
  const scope = served("architectural", 1, "### observation: already ratified\n- evidence: UTF-8 café\r\n   \r\n", {
    stderr: "head-fit\nraw trim: café\n",
  });
  const qa = served("QA", 0);
  assert.deepEqual(verdict(f.publish([scope, served("infosec", 1), served("methodology", 1), qa])), { verdict: "approve", objections: [] });
  assert.equal(f.read("round-1-QA.md"), qa.stdout);
  assert.equal(f.read("round-1-architectural.md"), scope.stdout + "\n\n## Transport stderr\n" + scope.stderr);
  assert.deepEqual(f.json("pinned-reviewer.json"), backends[0]);
  assert.equal(f.json("served-1.json").served_identity, "openai|first|https://first.invalid/v1");
  assert.equal(f.json("pin-capture.json").state, "captured");
  assert.ok(!readdirSync(f.dir).includes("round-1.json"));
});

test("record-results retains residual diagnostics and the first attempt across same-round retries", (t) => {
  const f = fixture(t);
  const residual = served("QA", 1, "### major: Missing claim\n", { truncated: true });
  assert.equal(verdict(f.record([residual])).verdict, "unavailable");
  const original = f.read("round-1-QA.md");
  assert.ok(original.startsWith(residual.stdout));
  assert.match(original, /## Parser diagnostics\nparse-refutation: .*missing_field=claim truncated=true/);
  const firstPin = f.read("pinned-reviewer.json");
  const clear = served("QA", 0);
  assert.equal(verdict(f.record([clear])).verdict, "approve");
  assert.equal(f.read("round-1-QA.md"), original);
  assert.equal(f.read("round-1-QA.retry-1.md"), clear.stdout);
  assert.equal(f.read("pinned-reviewer.json"), firstPin);
  assert.equal(f.json("served-1.json").served_identity, "openai|first|https://first.invalid/v1");
});

test("record-results preserves swing-capable outages, critical veto and the config-fault floor", (t) => {
  const fixtureRoot = fixture(t);
  const veto = served("architectural", 0, critical);
  const infrastructure = receipt("QA", { exit: 8 });
  const auth = receipt("QA", { exit: 7 });
  assert.equal(verdict(fixtureRoot.record([served("architectural", 0), infrastructure])).verdict, "unavailable");
  assert.equal(verdict(fixtureRoot.record([veto, infrastructure], ["architectural", "QA"], 2)).verdict, "reject-approach");
  const failed = verdict(fixtureRoot.record([veto, auth], ["architectural", "QA"], 3));
  assert.equal(failed.verdict, "needs-human");
  assert.ok(failed.objections.some(objection => objection.lens === "QA" && objection.severity === "blocker"));
});

test("record-results records no scheduled lens as clear on an unavailable batch", (t) => {
  const f = fixture(t);
  assert.deepEqual(verdict(f.missing(["infosec", "QA"], 4)), {
    verdict: "needs-human",
    objections: [{ lens: "infosec", severity: "blocker" }, { lens: "QA", severity: "blocker" }],
  });
  assert.equal(f.json("pin-capture.json").state, "skipped-no-lens");
  assert.ok(!readdirSync(f.dir).some(name => name.startsWith("served-") || name.startsWith("round-")));
});

test("record-results refuses an incomplete batch without pinning or approving", (t) => {
  const f = fixture(t);
  const failure = f.record([served("QA", 0)], ["QA", "infosec"]);
  assert.equal(failure.status, 2, failure.stderr);
  assert.equal(failure.stdout, "");
  assert.match(failure.stderr, /exactly one ordered result per enabled lens/);
  assert.deepEqual(readdirSync(f.dir).sort(), ["backends.json", "results.json"]);
});

test("record-results keeps suspect transport bytes but refuses an index and identity mismatch", (t) => {
  const f = fixture(t);
  const bad = served("QA", 0);
  bad.stdout = bad.stdout.replace("chain[0]", "chain[1]");
  const failed = f.record([bad]);
  assert.equal(failed.status, 2, failed.stderr);
  assert.equal(failed.stdout, "");
  assert.match(failed.stderr, /QA serving attribution does not match the prepared chain/);
  assert.equal(f.read("round-1-QA.md"), bad.stdout);
  assert.equal(f.json("pin-capture.json").state, "failed");
  assert.ok(!readdirSync(f.dir).includes("pinned-reviewer.json"));
});

test("record-results classifies every documented nonzero transport exit without parsing its stdout", (t) => {
  const f = fixture(t);
  for (const exit of [2, 4, 5, 6, 7, 8, 12]) {
    const expected = [5, 8, 12].includes(exit)
      ? { verdict: "unavailable", objections: [{ lens: "QA", severity: "major" }] }
      : { verdict: "needs-human", objections: [{ lens: "QA", severity: "blocker" }] };
    const unserved = receipt("QA", { exit, stdout: served("QA", 0, critical).stdout });
    assert.deepEqual(verdict(f.record([unserved])), expected, "transport exit " + exit);
  }
  assert.ok(!readdirSync(f.dir).some(name => name.startsWith("round-")));
});

test("record-results leaves an established pin and initial capture marker intact when a later chain cannot be read", (t) => {
  const f = fixture(t);
  assert.equal(verdict(f.record([served("QA", 0)])).verdict, "approve");
  const original = f.read("pinned-reviewer.json");
  writeFileSync(f.chain, "{");
  const failed = f.record([served("QA", 1)], ["QA"], 2);
  assert.equal(failed.status, 2, failed.stderr);
  assert.equal(failed.stdout, "");
  assert.equal(f.read("pinned-reviewer.json"), original);
  const marker = f.json("pin-capture.json");
  assert.equal(marker.state, "captured");
  assert.equal(marker.round, 1);
  assert.equal(marker.last_failure_round, 2);
  assert.ok(!readdirSync(f.dir).includes("served-2.json"));
});

test("record-results leaves an earlier available vote in the partial retry caller's custody", (t) => {
  const f = fixture(t);
  const prior = served("architectural", 1, "### major: Missing acceptance check\n- claim: Completion has no pass condition.\n");
  const initial = f.receipts([prior, receipt("QA", { exit: 8 })]);
  assert.equal(initial.status, 0, initial.stderr);
  const firstPrep = f.prepRound(f.fold(initial, 2).stdout);
  assert.equal(firstPrep.status, 0, firstPrep.stderr);
  const firstDecision = JSON.parse(firstPrep.stdout);
  assert.equal(firstDecision.action, "retry-outage");
  assert.deepEqual(firstDecision.outaged_lenses, ["QA"]);
  assert.equal(f.json("round-1.json").objections[0].claim, "Completion has no pass condition.");
  const retry = f.receipts([served("QA", 0)], 2);
  assert.equal(retry.status, 0, retry.stderr);
  assert.doesNotMatch(retry.stdout, /faff-contract/);
  const retained = JSON.parse(initial.stdout)[0];
  const fresh = JSON.parse(retry.stdout);
  assert.deepEqual(fresh.map(entry => entry.lens), ["QA"]);
  const combined = spawnSync(process.execPath, [aggregate, "--n", "2"], {
    input: JSON.stringify([retained, ...fresh]), encoding: "utf8", cwd: f.dir,
  });
  assert.equal(verdict(combined).verdict, "revise");
  const secondPrep = f.prepRound(combined.stdout);
  assert.equal(secondPrep.status, 0, secondPrep.stderr);
  assert.equal(JSON.parse(secondPrep.stdout).action, "fix-and-rerun");
  assert.ok(readdirSync(f.dir).includes("round-1-architectural.md"));
});

test("record-results refuses to publish a partial batch without caller-owned aggregation", (t) => {
  const f = fixture(t);
  const result = f.publish([served("QA", 0)]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /partial lens sets require --receipts-only/);
  assert.deepEqual(readdirSync(f.dir).sort(), ["backends.json", "results.json"]);
});
