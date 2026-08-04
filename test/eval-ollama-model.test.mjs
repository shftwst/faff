// FAFF-136 — direct ollama /api/chat model tests. PURE request/parse + an end-to-end liveDriver
// integration driven by a MOCK `post` (zero network, zero spawn). The real http(s) transport is
// never exercised in CI — eval/ is excluded from node --test and `post` is injected.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOllamaRequest, parseOllamaResponse, makeOllamaModel, makeDirectOllamaDriver } from "../eval/ollama-model.mjs";
import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { liveDriver } from "../eval/live-driver.mjs";
import { runEvals } from "../eval/run-evals.mjs";

const envOf = (id, payload) => "```faff-eval:judgement\n" + JSON.stringify({ case_id: id, ...payload }) + "\n```";
const ollamaReply = (content) => JSON.stringify({ message: { content } });

// --- buildOllamaRequest: POST /api/chat, non-streaming, model + prompt in the body ---
test("buildOllamaRequest targets /api/chat with a non-streaming chat body", () => {
  const req = buildOllamaRequest({ baseUrl: "http://studio.x.ts.net:11434", model: "qwen3.6:27b-mlx" }, "PROMPT");
  assert.equal(req.method, "POST");
  assert.equal(req.url, "http://studio.x.ts.net:11434/api/chat");
  const body = JSON.parse(req.body);
  assert.equal(body.model, "qwen3.6:27b-mlx");
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, [{ role: "user", content: "PROMPT" }]);
});

test("buildOllamaRequest fails loud on a missing baseUrl or model", () => {
  assert.throws(() => buildOllamaRequest({ model: "m" }, "P"), /baseUrl|no localhost default/);
  assert.throws(() => buildOllamaRequest({ baseUrl: "http://h:11434" }, "P"), /requires a model/);
});

// --- FAFF-137: think / options are included only when defined (think:false is the local-speed lever) ---
test("buildOllamaRequest threads think and options only when defined", () => {
  const base = JSON.parse(buildOllamaRequest({ baseUrl: "http://h:11434", model: "m" }, "P").body);
  assert.ok(!("think" in base) && !("options" in base), "omitted when undefined");

  const withThink = JSON.parse(buildOllamaRequest({ baseUrl: "http://h:11434", model: "m", think: false, options: { temperature: 0 } }, "P").body);
  assert.equal(withThink.think, false);
  assert.deepEqual(withThink.options, { temperature: 0 });
});

test("makeOllamaModel forwards think to the request via the injected post", async () => {
  let seen;
  const post = async (req) => { seen = JSON.parse(req.body); return '{"message":{"content":"OK"}}'; };
  const model = makeOllamaModel({ baseUrl: "http://h:11434", model: "m", think: false, post });
  await model("P");
  assert.equal(seen.think, false);
});

// --- parseOllamaResponse: extract message.content; fail loud otherwise ---
test("parseOllamaResponse extracts message.content (string or parsed object)", () => {
  assert.equal(parseOllamaResponse('{"message":{"content":"hi"}}'), "hi");
  assert.equal(parseOllamaResponse({ message: { content: "hi" } }), "hi");
});

test("parseOllamaResponse fails loud on an unrecognised shape", () => {
  assert.throws(() => parseOllamaResponse({ done: true }), /message\.content/);
});

// --- makeOllamaModel: returns the parsed content via the injected post (no network) ---
test("makeOllamaModel returns the completion text via the injected post", async () => {
  const calls = [];
  const post = async (req) => {
    calls.push(req);
    return '{"message":{"content":"the model says hi"}}';
  };
  const model = makeOllamaModel({ baseUrl: "http://h:11434", model: "m", post });
  assert.equal(await model("PROMPT"), "the model says hi");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/chat$/);
});

// --- end-to-end: makeOllamaModel drives liveDriver against the real harness (mock post only) ---
test("ollama model + liveDriver: judgement flows through to DecisionRecord buckets, zero network", async (t) => {
  const tracker = loadFixture({
    version: 1,
    issues: [
      { id: "ISS-A", title: "Add login rate limiting", state: "Backlog", stateCategory: "backlog" },
      { id: "ISS-B", title: "Rate-limit the login endpoint", state: "Backlog", stateCategory: "backlog" },
    ],
  });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  t.after(() => repo.teardown());

  // The mock post returns an ollama response whose content is a faff-eval:judgement envelope.
  const envelope = "```faff-eval:judgement\n" + JSON.stringify({ case_id: "live", classifications: { dupe: ["ISS-A", "ISS-B"] } }) + "\n```";
  const post = async () => JSON.stringify({ message: { content: envelope } });
  const model = makeOllamaModel({ baseUrl: "http://h:11434", model: "m", post });

  const rec = await runSkill({ skill: "faff-tidy", tracker, repo, driver: liveDriver({ model }) });
  assert.equal(rec.driver, "live");
  assert.deepEqual(rec.buckets.dupe, ["ISS-A", "ISS-B"]); // the direct-completion judgement, captured at the seam
});

// --- FAFF-144: the run-evals-compatible direct driver builds the eval prompt + returns {rawText,tokens} ---
test("makeDirectOllamaDriver builds the eval prompt and returns {rawText,tokens} via the injected post", async () => {
  const seen = {};
  const post = async (req) => { seen.body = JSON.parse(req.body); return ollamaReply(envOf("dupe-x", { classifications: { dupe: ["A", "B"] } })); };
  const driver = makeDirectOllamaDriver({ baseUrl: "http://h:11434", model: "m", post, pluginDir: null }); // null → skip criteria read
  const out = await driver({ id: "dupe-x", kind: "dupe", fixture: { issues: [{ id: "A" }, { id: "B" }] }, question: "dupes?" });
  assert.match(out.rawText, /faff-eval:judgement/);
  assert.ok(out.tokens > 0);
  // the POST body carries the assembled eval prompt: the fixture + the envelope instruction, think:false
  assert.match(seen.body.messages[0].content, /faff-eval:judgement/);
  assert.match(seen.body.messages[0].content, /"A"/);
  assert.equal(seen.body.think, false);
});

// --- FAFF-144: the direct driver runs through runEvals + grader (local per-kind table), zero network ---
test("makeDirectOllamaDriver runs through runEvals and grades", async () => {
  const post = async () => ollamaReply(envOf("c", { classifications: { dupe: ["A", "B"] } }));
  const driver = makeDirectOllamaDriver({ baseUrl: "http://h:11434", model: "m", post, pluginDir: null });
  const cases = [{ id: "c", kind: "dupe", fixture: { issues: [] }, question: "?", oracle: { closed_set: ["A", "B"] } }];
  const s = await runEvals({ cases, driver, baseReps: 2, maxReps: 2 });
  assert.equal(s.per_kind.dupe.accuracy, 1);
  assert.equal(s.per_kind.dupe.format_adherence, 1); // exact tag → compliant
});
