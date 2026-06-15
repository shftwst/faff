// FAFF-136 — direct ollama /api/chat model tests. PURE request/parse + an end-to-end liveDriver
// integration driven by a MOCK `post` (zero network, zero spawn). The real http(s) transport is
// never exercised in CI — eval/ is excluded from node --test and `post` is injected.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOllamaRequest, parseOllamaResponse, makeOllamaModel } from "../eval/ollama-model.mjs";
import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { liveDriver } from "../eval/live-driver.mjs";

// --- buildOllamaRequest: POST /api/chat, non-streaming, model + prompt in the body ---
test("buildOllamaRequest targets /api/chat with a non-streaming chat body", () => {
  const req = buildOllamaRequest({ baseUrl: "http://studio.longhair-escalator.ts.net:11434", model: "qwen3.6:27b-mlx" }, "PROMPT");
  assert.equal(req.method, "POST");
  assert.equal(req.url, "http://studio.longhair-escalator.ts.net:11434/api/chat");
  const body = JSON.parse(req.body);
  assert.equal(body.model, "qwen3.6:27b-mlx");
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, [{ role: "user", content: "PROMPT" }]);
});

test("buildOllamaRequest fails loud on a missing baseUrl or model", () => {
  assert.throws(() => buildOllamaRequest({ model: "m" }, "P"), /baseUrl|no localhost default/);
  assert.throws(() => buildOllamaRequest({ baseUrl: "http://h:11434" }, "P"), /requires a model/);
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
