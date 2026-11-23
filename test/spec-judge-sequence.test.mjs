import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { faffBin } from "./helpers/run-cli.mjs";

const BEFORE = "# Spec\n\n## First decision\n\n**Chosen:** Keep the stable first path.\n\n## Second decision\n\n**Chosen:** Use the initial ordering.\n";
const VERIFY = "Use the corrected ordering with explicit replay ownership";
const RECONSTRUCTION = [
  ["requirements_invariants", "Maintain stable per-proposition arbitration and ensure every prior correction reaches the current document."],
  ["existing_behaviour", "The caller currently proceeds from the first item to the second and does its work in explicit order."],
  ["valid_solution_properties", "Every proposed path needs independent evidence and should remain equivalent across reruns with the same specification."],
  ["undeterminable_facts", "It is unclear which consumer will require queue selection under an unrelated environment or fixture."],
].map(([key, body]) => `## ${key}\n${body}`).join("\n\n");

function block(pid, outcome = "AFFIRM_SPEC") {
  const correction = outcome === "UPHOLD_REVIEW" ? { summary: "Update the second decision.", verification: VERIFY } : null;
  return "```faff-contract:spec-judge-verdict\n" + JSON.stringify({ proposition_id: pid, outcome, rationale: "Grounded in the ordered replay requirement.", correction }) + "\n```";
}

async function fixture(t, { objections = 2, retry = 2, timeout = 1, deadline = 2, answer } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff-spec-judge-sequence-test-"));
  const scratch = join(dir, "scratch");
  const out = join(scratch, "judge");
  const spec = join(dir, "spec.md");
  const evidence = join(dir, "sample.txt");
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "refuter" }, { id: "judge" }] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const content = (await answer?.(request, requests)) ?? RECONSTRUCTION;
    if (content === false) return;
    res.setHeader("content-type", "text/event-stream");
    res.end("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  const host = `http://127.0.0.1:${server.address().port}/v1`;
  writeFileSync(join(dir, ".faffrc.yaml"), `backends:
  judge:
    provider: openai
    model: judge
    host: ${host}
  refuter:
    provider: openai
    model: refuter
    host: ${host}
adversarial:
  deadline: ${deadline}
  timeout: ${timeout}
  spec_review:
    refs:
      - refuter
  spec_judge:
    refs:
      - judge
      - refuter
    max_tokens: 2700
prep:
  spec_review_judge_retry_limit: ${retry}
`);
  mkdirSync(join(dir, ".faff"));
  mkdirSync(scratch);
  writeFileSync(spec, BEFORE);
  writeFileSync(evidence, "Original local evidence.\n");
  const round = {
    verdict: "revise",
    objections: ["first-decision", "second-decision"].slice(0, objections).map((spec_anchor) => ({
      lens: "architectural",
      severity: "minor",
      claim: `A concrete objection at ${spec_anchor}.`,
      evidence: "sample.txt provides corroboration",
      predicted_consequence: "The ordered case could otherwise reappear.",
      spec_anchor,
    })),
  };
  const roundPath = join(scratch, "round-1.json");
  writeFileSync(roundPath, JSON.stringify(round));
  function cli(mode, extra = [], base = ["--dir", scratch, "--window-start", "1", "--spec", spec]) {
    return new Promise((resolve) => {
      execFile(process.execPath, [faffBin, "spec-judge-evidence", mode, ...base, ...extra], { cwd: dir, timeout: 15000 },
        (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    });
  }
  const judge = `openai|judge|${host}`;
  const assemble = () => cli("--assemble", ["--sequence", "--issue", "TEST-1", "--repo-root", dir]);
  const step = (extra = []) => cli("--step", ["--backend", judge, ...extra]);
  const ledger = () => JSON.parse(readFileSync(join(out, "ledger.json"), "utf8"));
  return { dir, scratch, out, spec, evidence, roundPath, round, requests, assemble, step, cli, ledger, host };
}

function value(result, action) {
  assert.equal(result.code, 0, result.stderr);
  const doc = JSON.parse(result.stdout);
  if (action) assert.equal(doc.action, action, result.stdout);
  return doc;
}

const prompt = (request) => request.messages.map(({ content }) => content).join("\n");

test("sequenced CLI resumes the second proposition against the corrected spec and parks a duplicate ruling", async (t) => {
  const f = await fixture(t, { answer: (req, list) => {
    if (list.length === 2) return block("p-01", "UPHOLD_REVIEW");
    if (list.length === 4) return block("p-02") + "\n" + block("p-02");
    return RECONSTRUCTION;
  } });
  assert.equal(value(await f.assemble()).assembled, 2);
  assert.equal(statSync(join(f.out, "ledger.json")).mode & 0o777, 0o600);
  assert.equal(value(await f.step(), "continue").pid, "p-01");
  assert.doesNotMatch(prompt(f.requests[0]), /"argument_[AB]"|argument_A_source|order_seed/);
  assert.equal(f.requests[0].max_tokens ?? f.requests[0].max_completion_tokens, 2700);
  assert.match(prompt(f.requests[0]), /Original local evidence/);

  assert.equal(value(await f.step(), "apply-correction").correction.verification, VERIFY);
  assert.match(prompt(f.requests[1]), /"argument_A"/);
  assert.equal(value(await f.assemble()).resumed, true);
  assert.equal(value(await f.step(), "apply-correction").pid, "p-01");
  assert.equal(f.requests.length, 2);
  assert.equal((await f.cli("--admit", ["--level", "L3"])).code, 2);

  writeFileSync(f.spec, BEFORE.replace("Use the initial ordering.", VERIFY + "."));
  assert.equal(value(await f.step(), "continue").pid, "p-01");
  assert.equal(value(await f.step(), "continue").pid, "p-02");
  assert.match(prompt(f.requests[2]), new RegExp(VERIFY));
  assert.doesNotMatch(prompt(f.requests[2]), /Use the initial ordering/);
  assert.match(f.ledger().entries["p-02"].pre_ruling_spec_content, new RegExp(VERIFY));

  const second = value(await f.step(), "parked");
  assert.equal(second.reason, "multiple-verdict-blocks");
  assert.equal(second.pid, "p-02");
  value(await f.step(), "done");
  const admit = value(await f.cli("--admit", ["--level", "L3"]));
  assert.deepEqual(admit.parked, ["p-02"]);
  writeFileSync(join(f.out, "ruling-p-01.json"), JSON.stringify({ proposition_id: "p-01", outcome: "AFFIRM_SPEC" }));
  assert.match((await f.cli("--admit", ["--level", "L3"])).stderr, /does not match the bound response/);
});

test("the transport retry stays within phase two and invalid later output cannot become a ruling", async (t) => {
  let wait = true;
  const f = await fixture(t, { objections: 1, answer: (req) => {
    if (!prompt(req).includes('"argument_A"')) return RECONSTRUCTION;
    return wait ? false : block("p-99");
  } });
  value(await f.assemble());
  value(await f.step(), "continue");
  const retry = value(await f.step(), "retry");
  assert.equal(retry.phase, 2);
  assert.ok([5, 8].includes(retry.exit));
  assert.deepEqual(f.ledger().entries["p-01"].step.attempts, [1, 1]);
  wait = false;
  assert.equal(value(await f.step(), "parked").reason, "verdict-proposition-mismatch");
  assert.deepEqual(f.ledger().entries["p-01"].step.attempts, [1, 2]);
  assert.equal(f.requests.filter((req) => !prompt(req).includes('"argument_A"')).length, 1);
});

test("changed spec, local evidence, round bytes and window refuse to reuse a reconstruction", async (t) => {
  const f = await fixture(t, { objections: 1 });
  value(await f.assemble());
  value(await f.step(), "continue");
  writeFileSync(f.spec, BEFORE + "\nChanged current input.\n");
  assert.match((await f.step()).stderr, /current spec, case evidence or judge settings changed/);
  writeFileSync(f.spec, BEFORE);
  writeFileSync(f.evidence, "Changed local evidence.");
  assert.match((await f.step()).stderr, /case evidence.*changed/);
  writeFileSync(f.evidence, "Original local evidence.\n");
  writeFileSync(f.roundPath, JSON.stringify(f.round) + "\n");
  assert.match((await f.step()).stderr, /round evidence changed/);
  assert.match((await f.assemble()).stderr, /different round evidence/);
  writeFileSync(f.roundPath, JSON.stringify(f.round));
  const wrongWindow = await f.cli("--step", [], ["--dir", f.scratch, "--window-start", "2", "--spec", f.spec]);
  assert.equal(wrongWindow.code, 2);
  assert.match(wrongWindow.stderr, /review window does not match/);
  writeFileSync(join(f.scratch, "window.json"), JSON.stringify({ window_start: 2 }));
  assert.match((await f.step()).stderr, /persisted review window changed/);
  assert.equal(f.requests.length, 1);
});

test("no phase two call follows malformed reconstruction and a selected refuter cannot serve", async (t) => {
  const malformed = await fixture(t, { objections: 1, answer: () => "not a reconstruction" });
  value(await malformed.assemble());
  assert.equal(value(await malformed.step(), "parked").reason, "reconstruction empty/failed");
  assert.equal(malformed.requests.length, 1);

  const shared = await fixture(t, { objections: 1 });
  value(await shared.assemble());
  const result = await shared.cli("--step", ["--backend", `openai|refuter|${shared.host}`]);
  assert.match(value(result, "parked").reason, /no independent spec judge backend/);
  assert.equal(shared.requests.length, 0);
});

test("only the active correction can be parked and a pre-existing literal cannot satisfy it", async (t) => {
  const f = await fixture(t, { answer: (req) => prompt(req).includes('"argument_A"') ? block("p-01", "UPHOLD_REVIEW") : RECONSTRUCTION });
  const original = BEFORE + "\n" + VERIFY;
  writeFileSync(f.spec, original);
  value(await f.assemble());
  value(await f.step(), "continue");
  value(await f.step(), "apply-correction");
  writeFileSync(f.spec, original + "\nUnrelated edit.");
  value(await f.step(), "apply-correction");
  const wrong = await f.step(["--park", "p-02"]);
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /park must name the active correction/);
  assert.equal(value(await f.step(["--park", "p-01"]), "parked").pid, "p-01");
  assert.equal(value(await f.step(), "continue").pid, "p-02");
});

const ampleBudget = ["--budget-secs", "240"];
const admitL3 = (f) => f.cli("--admit", ["--level", "L3"]);

// review-call includes the per-attempt mkdtemp suffix in one XML path label.
function comparableRequest(request) {
  return { ...request, messages: request.messages.map((message) => ({
    ...message,
    content: message.content.replace(/(<file path="[^"\n]*\/faff-spec-judge-)[A-Za-z0-9]{6}(\/context\.json">)/g, "$1TEMP$2"),
  })) };
}

test("bounded and single steps send identical ordered requests and persist the same admission after a correction", async (t) => {
  const f = await fixture(t, { answer: (request, requests) => {
    if (!prompt(request).includes('"argument_A"')) return RECONSTRUCTION;
    return requests.length === 2 ? block("p-01", "UPHOLD_REVIEW") : block("p-02");
  } });
  const revised = BEFORE.replace("Use the initial ordering.", VERIFY + ".");
  async function run(bounded) {
    const args = bounded ? ampleBudget : [];
    value(await f.assemble());
    if (!bounded) value(await f.step(), "continue");
    const correction = value(await f.step(args), "apply-correction");
    assert.equal(correction.pid, "p-01");
    assert.equal(correction.correction.verification, VERIFY);
    assert.deepEqual(value(await f.step(args)), correction);
    assert.equal(f.requests.length, 2);
    assert.equal((await admitL3(f)).code, 2);
    writeFileSync(f.spec, revised);
    if (!bounded) {
      assert.equal(value(await f.step(), "continue").pid, "p-01");
      assert.equal(value(await f.step(), "continue").pid, "p-02");
      assert.equal(value(await f.step(), "continue").pid, "p-02");
    }
    value(await f.step(args), "done");
    value(await f.step(args), "done");
    assert.equal(f.requests.length, 4);
    assert.match(prompt(f.requests[2]), new RegExp(VERIFY));
    const admit = value(await admitL3(f));
    assert.equal(admit.admit, true);
    assert.deepEqual(admit.resolved, ["p-01", "p-02"]);
    return {
      requests: f.requests.splice(0).map(comparableRequest),
      admission: readFileSync(join(f.out, "admit-result.json"), "utf8"),
      rulings: ["p-01", "p-02"].map((pid) => readFileSync(join(f.out, `ruling-${pid}.json`), "utf8")),
    };
  }
  const single = await run(false);
  rmSync(f.out, { recursive: true });
  writeFileSync(f.spec, BEFORE);
  assert.deepEqual(await run(true), single);
});

test("an insufficient budget leaves the case unbound until the judge can start", async (t) => {
  const f = await fixture(t, { objections: 1, answer: (req) => prompt(req).includes('"argument_A"') ? block("p-01") : RECONSTRUCTION });
  value(await f.assemble());
  for (const invalid of ["0", "1.5", "3x"]) {
    assert.equal((await f.step(["--budget-secs", invalid])).code, 2);
  }
  const stop = await f.step(["--budget-secs", "1"]);
  assert.equal(stop.code, 3, stop.stderr);
  assert.deepEqual(JSON.parse(stop.stdout), { action: "budget", steps: 0, attempt_secs: 32 });
  assert.equal(f.requests.length, 0);
  assert.equal(f.ledger().entries["p-01"].step, undefined);
  writeFileSync(f.spec, BEFORE.replace("Keep the stable first path", "Retain the revised first path"));
  value(await f.step(ampleBudget), "done");
  assert.match(prompt(f.requests[0]), /Retain the revised first path/);
  assert.equal(value(await admitL3(f)).admit, true);
  assert.deepEqual(f.ledger().entries["p-01"].step.attempts, [1, 1]);
  assert.equal(f.requests.length, 2);
});

test("a short resume settles a spent attempt without calling the judge", async (t) => {
  const f = await fixture(t, { objections: 1, retry: 0 });
  value(await f.assemble());
  value(await f.step(), "continue");
  const ledger = f.ledger();
  // A killed caller charged its last phase-two attempt before receiving a ruling.
  ledger.entries["p-01"].step.attempts[1] = 1;
  writeFileSync(join(f.out, "ledger.json"), JSON.stringify(ledger));
  const done = value(await f.step(["--budget-secs", "1"]), "done");
  assert.deepEqual(done.parked, [{ pid: "p-01", reason: "phase 2 retry budget exhausted" }]);
  assert.deepEqual(f.ledger().entries["p-01"].step.attempts, [1, 1]);
  assert.equal(f.requests.length, 1);
});

test("an exhausted ruling attempt cannot hide a corrupt reconstruction on resume", async (t) => {
  const f = await fixture(t, { objections: 1, retry: 0 });
  value(await f.assemble());
  value(await f.step(), "continue");
  const ledger = f.ledger();
  const step = ledger.entries["p-01"].step;
  step.attempts[1] = 1;
  step.reconstruction.sha = "unbound";
  writeFileSync(join(f.out, "ledger.json"), JSON.stringify(ledger));
  const resumed = await f.step(["--budget-secs", "1"]);
  assert.equal(resumed.code, 2);
  assert.match(resumed.stderr, /stored reconstruction is invalid or unbound/);
  assert.equal(f.ledger().entries["p-01"].step.finished, undefined);
  assert.equal((await admitL3(f)).code, 2);
  assert.equal(f.requests.length, 1);
});

test("a bounded retry reuses the first phase and moves past a parked proposition", async (t) => {
  const f = await fixture(t, { retry: 1, answer: (req) => {
    if (!prompt(req).includes('"argument_A"')) return RECONSTRUCTION;
    const entries = f.ledger().entries;
    if (entries["p-02"].step) return block("p-02");
    // The transport can retry HTTP inside one judge step. Fail that whole first attempt.
    return entries["p-01"].step.attempts[1] === 1 ? false : block("p-99");
  } });
  value(await f.assemble());
  const parked = [{ pid: "p-01", reason: "verdict-proposition-mismatch" }];
  assert.deepEqual(value(await f.step(ampleBudget), "done").parked, parked);
  assert.deepEqual(value(await f.step(ampleBudget), "done").parked, parked);
  const rulings = f.requests.filter(req => prompt(req).includes('"argument_A"'));
  assert.equal(f.requests.length - rulings.length, 2);
  const firstCase = rulings.slice(0, -1);
  assert.ok(firstCase.length >= 2);
  for (const request of firstCase) assert.deepEqual(comparableRequest(request), comparableRequest(firstCase[0]));
  const entries = f.ledger().entries;
  assert.deepEqual(entries["p-01"].step.attempts, [1, 2]);
  assert.deepEqual(entries["p-02"].step.attempts, [1, 1]);
  const result = value(await admitL3(f));
  assert.deepEqual(result.parked, ["p-01"]);
  assert.deepEqual(result.resolved, ["p-02"]);
});

test("a bounded step with only a refuter parks every case without a provider call", async (t) => {
  const f = await fixture(t);
  value(await f.assemble());
  value(await f.cli("--step", ["--backend", `openai|refuter|${f.host}`, ...ampleBudget]), "done");
  assert.deepEqual(value(await admitL3(f)).parked, ["p-01", "p-02"]);
  for (const entry of Object.values(f.ledger().entries)) assert.deepEqual(entry.step.attempts, [0, 0]);
  assert.equal(f.requests.length, 0);
});

test("a budget reached after reconstruction leaves only the ruling to dispatch on resume", async (t) => {
  const f = await fixture(t, { objections: 1, timeout: 2, answer: async (request) => {
    if (prompt(request).includes('"argument_A"')) return block("p-01");
    await delay(1250);
    return RECONSTRUCTION;
  } });
  value(await f.assemble());
  const stop = await f.step(["--budget-secs", "33"]);
  assert.equal(stop.code, 3, stop.stderr);
  assert.deepEqual(JSON.parse(stop.stdout), { action: "budget", steps: 1, attempt_secs: 32 });
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.ledger().entries["p-01"].step.attempts, [1, 0]);
  assert.equal((await admitL3(f)).code, 2);
  value(await f.step(ampleBudget), "done");
  assert.equal(f.requests.length, 2);
  assert.match(prompt(f.requests[1]), /"argument_A"/);
  assert.equal(value(await admitL3(f)).admit, true);
});

test("a second caller cannot claim a proposition while the bounded caller awaits its ruling", async (t) => {
  let notifyRuling, releaseRuling;
  const started = new Promise((resolve) => { notifyRuling = resolve; });
  const release = new Promise((resolve) => { releaseRuling = resolve; });
  const f = await fixture(t, { objections: 1, deadline: 12, timeout: 10, answer: async (request) => {
    if (!prompt(request).includes('"argument_A"')) return RECONSTRUCTION;
    notifyRuling();
    await release;
    return block("p-01");
  } });
  value(await f.assemble());
  const owner = f.step(ampleBudget);
  try {
    const earlyExit = await Promise.race([started, owner]);
    assert.equal(earlyExit, undefined, JSON.stringify(earlyExit));
    const rival = await f.step();
    assert.equal(rival.code, 2);
    assert.match(rival.stderr, /spec judge step already running/);
  } finally {
    releaseRuling();
  }
  value(await owner, "done");
  assert.equal(f.requests.length, 2);
  assert.equal(value(await admitL3(f)).admit, true);
});

test("parking an active correction once lets a bounded caller advance to the next proposition", async (t) => {
  const f = await fixture(t, { answer: (request, list) => {
    if (!prompt(request).includes('"argument_A"')) return RECONSTRUCTION;
    return list.length === 2 ? block("p-01", "UPHOLD_REVIEW") : block("p-02");
  } });
  value(await f.assemble());
  assert.equal(value(await f.step(ampleBudget), "apply-correction").pid, "p-01");
  assert.equal((await f.step(["--park", "p-02", ...ampleBudget])).code, 2);
  assert.equal(f.requests.length, 2);
  value(await f.step(["--park", "p-01", ...ampleBudget]), "done");
  const result = value(await admitL3(f));
  assert.deepEqual(result.parked, ["p-01"]);
  assert.deepEqual(result.resolved, ["p-02"]);
  assert.equal(f.requests.length, 4);
});

async function exerciseHeartbeat(t, args) {
  let atDispatch, beforeReturn;
  const f = await fixture(t, { objections: 1, timeout: 6, deadline: 8, answer: async (request) => {
    if (prompt(request).includes('"argument_A"')) return block("p-01");
    atDispatch = existsSync(heartbeat) ? readFileSync(heartbeat, "utf8").trim() : "";
    await delay(1300);
    beforeReturn = existsSync(heartbeat) ? readFileSync(heartbeat, "utf8").trim() : "";
    return RECONSTRUCTION;
  } });
  appendFileSync(join(f.dir, ".faffrc.yaml"), "sentry:\n  stall_window_secs: 1\n");
  const runs = join(f.dir, ".faff", "runs");
  function makeRun(name) {
    const run = join(runs, name);
    const old = new Date(Date.now() - 60000).toISOString();
    mkdirSync(join(run, "TEST-1", "spec-review"), { recursive: true });
    writeFileSync(join(run, "run-ledger.json"), JSON.stringify({
      run_id: name, admitted: [], outcomes: {}, owner: { status: "running", started_at: old, last_heartbeat: old },
    }));
    return run;
  }
  const owner = makeRun("owner");
  const other = makeRun("other");
  const heartbeat = join(owner, "heartbeat");
  const review = join(owner, "TEST-1", "spec-review");
  writeFileSync(join(review, "round-1.json"), JSON.stringify(f.round));
  const base = ["--dir", review, "--window-start", "1", "--spec", f.spec];
  value(await f.cli("--assemble", ["--sequence", "--run-dir", owner, "--issue", "TEST-1", "--repo-root", f.dir], base));
  function advance(run) {
    return f.cli("--step", ["--run-dir", run, "--backend", `openai|judge|${f.host}`, ...args], base);
  }
  const refused = await advance(other);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /--run-dir must own/);
  const ledgerPath = join(owner, "run-ledger.json");
  const savedLedger = readFileSync(ledgerPath, "utf8");
  writeFileSync(ledgerPath, JSON.stringify({ ...JSON.parse(savedLedger), run_id: "replacement" }));
  assert.equal((await advance(owner)).code, 2);
  writeFileSync(ledgerPath, savedLedger);
  assert.equal(f.requests.length, 0);
  assert.equal(existsSync(heartbeat), false);
  if (!args.length) {
    value(await advance(owner), "continue");
    value(await advance(owner), "continue");
  }
  value(await advance(owner), "done");
  assert.ok(Date.parse(beforeReturn) > Date.parse(atDispatch), "heartbeat did not advance during the single pending request");
  assert.equal(f.requests.length, 2);
  assert.equal(value(await f.cli("--admit", ["--level", "L3", "--run-dir", owner], base)).admit, true);
  const final = readFileSync(heartbeat, "utf8");
  await delay(1100);
  assert.equal(readFileSync(heartbeat, "utf8"), final);
  assert.equal(existsSync(join(other, "heartbeat")), false);
}
test("a bounded judge renews only the owning run during a provider call and stops on completion",
  t => exerciseHeartbeat(t, ampleBudget));
test("a single foreground step renews only the owning run while waiting for a provider",
  t => exerciseHeartbeat(t, []));
