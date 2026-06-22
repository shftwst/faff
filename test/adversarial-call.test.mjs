// FAFF-183 — adversarial review backend call: pure functions + injectable-transport orchestration.
// Zero live model calls — getFn/streamFn are mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatPayload, modelServed, accumulateNdjson, assembleUserMessage,
  preflight, runReview, parseArgs, unreachableExit, EXIT, DEFAULT_NUM_PREDICT,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

test("buildChatPayload sets think:false + stream:true + the default token budget", () => {
  const p = buildChatPayload({ model: "m", system: "S", user: "U" });
  assert.equal(p.think, false, "think disabled (reasoning models would else return empty content)");
  assert.equal(p.stream, true, "streamed (long responses else drop the connection)");
  assert.equal(p.options.num_predict, DEFAULT_NUM_PREDICT);
  assert.deepEqual(p.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(p.messages[1].content, "U");
});

test("buildChatPayload honours an explicit num_predict", () => {
  assert.equal(buildChatPayload({ model: "m", system: "", user: "", numPredict: 4000 }).options.num_predict, 4000);
});

test("modelServed reads /api/tags and matches exactly (the hyphen/colon typo case)", () => {
  const tags = { models: [{ name: "qwen3.6:27b-mlx" }, { name: "smollm2:135m" }] };
  assert.equal(modelServed(tags, "qwen3.6:27b-mlx").served, true);
  const miss = modelServed(tags, "qwen3.6-27b-mlx"); // the real FAFF-181 typo
  assert.equal(miss.served, false);
  assert.deepEqual(miss.names, ["qwen3.6:27b-mlx", "smollm2:135m"]);
});

test("accumulateNdjson folds streamed content + flags length-truncation, tolerating a bad line", () => {
  const stream = [
    JSON.stringify({ message: { content: "Hello " } }),
    "not json — partial frame",
    JSON.stringify({ message: { content: "world" } }),
    JSON.stringify({ done: true, done_reason: "length" }),
  ].join("\n");
  const r = accumulateNdjson(stream);
  assert.equal(r.content, "Hello world");
  assert.equal(r.truncated, true);
  assert.equal(r.done, true);
});

test("accumulateNdjson: a clean stop is not truncated", () => {
  const r = accumulateNdjson(JSON.stringify({ message: { content: "x" }, done: true, done_reason: "stop" }));
  assert.equal(r.truncated, false);
});

test("assembleUserMessage fences context files ahead of the diff (the no-hallucination fix)", () => {
  const u = assembleUserMessage({ contextFiles: [{ path: "plugin/skills/faff/SKILL.md", text: "GATEWAY" }], diff: "DIFF" });
  assert.match(u, /<file path="plugin\/skills\/faff\/SKILL\.md">\nGATEWAY\n<\/file>/);
  assert.ok(u.indexOf("GATEWAY") < u.indexOf("DIFF UNDER REVIEW"), "context precedes the diff");
});

test("preflight: unreachable host (infra) is distinct from not-served (config)", async () => {
  const down = await preflight({ host: "http://h:1", model: "m", getFn: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.unreachable, true);
  const up = await preflight({ host: "http://h:1", model: "m", getFn: async () => JSON.stringify({ models: [{ name: "other" }] }) });
  assert.equal(up.unreachable, false);
  assert.equal(up.served, false);
});

test("runReview: model-not-served → status model-not-served (skill maps to needs-human, never pass)", async () => {
  const r = await runReview({
    host: "http://h:1", model: "typo", system: "S", user: "U",
    getFn: async () => JSON.stringify({ models: [{ name: "real" }] }),
    streamFn: async () => { throw new Error("should not stream when not served"); },
  });
  assert.equal(r.status, "model-not-served");
  assert.deepEqual(r.names, ["real"]);
});

test("runReview: unreachable → status unreachable (skill maps to pass+skip)", async () => {
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U",
    getFn: async () => { throw new Error("timeout"); },
    streamFn: async () => { throw new Error("unused"); },
  });
  assert.equal(r.status, "unreachable");
});

test("runReview: happy path streams findings", async () => {
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U",
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => [
      JSON.stringify({ message: { content: "### finding" } }),
      JSON.stringify({ done: true, done_reason: "stop" }),
    ].join("\n"),
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(r.truncated, false);
});

test("runReview: truncation triggers exactly one retry at 2× the token budget", async () => {
  const budgets = [];
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", numPredict: 1000,
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async (_url, body) => {
      budgets.push(JSON.parse(body).options.num_predict);
      const first = budgets.length === 1;
      return JSON.stringify({ message: { content: first ? "partial" : "full" }, done: true, done_reason: first ? "length" : "stop" });
    },
  });
  assert.deepEqual(budgets, [1000, 2000], "one retry at double budget");
  assert.equal(r.content, "full");
  assert.equal(r.truncated, false);
});

test("parseArgs collects repeated --context and the scalar flags", () => {
  const a = parseArgs(["--host", "http://h", "--model", "m", "--system", "s.txt", "--diff", "d.txt", "--context", "a", "--context", "b", "--num-predict", "1500"]);
  assert.equal(a.host, "http://h");
  assert.equal(a.model, "m");
  assert.deepEqual(a.context, ["a", "b"]);
  assert.equal(a.numPredict, 1500);
});

test("EXIT codes: not-served and unreachable are distinct + non-zero", () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.NOT_SERVED, 4);
  assert.equal(EXIT.UNREACHABLE, 5);
  assert.notEqual(EXIT.NOT_SERVED, EXIT.UNREACHABLE);
});

// --- FAFF-213: fail loud when the host is the unconfigured localhost default ---

test("EXIT.DEFAULT_HOST_UNREACHABLE === 6, distinct from NOT_SERVED (4) and UNREACHABLE (5)", () => {
  assert.equal(EXIT.DEFAULT_HOST_UNREACHABLE, 6); // AC 1
  assert.notEqual(EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.NOT_SERVED);
  assert.notEqual(EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.UNREACHABLE);
});

test("parseArgs: --host-source default is collected; omitting it defaults to config (back-compat)", () => {
  assert.equal(parseArgs(["--host-source", "default"]).hostSource, "default"); // AC 2
  assert.equal(parseArgs(["--host-source", "config"]).hostSource, "config");
  // existing callers never pass the flag → unchanged exit-5 behaviour
  assert.equal(parseArgs(["--host", "http://h", "--model", "m"]).hostSource, "config");
});

test("unreachableExit: default-host down → exit 6 (needs-human); configured host down → exit 5 (pass+skip)", () => {
  // AC 3 — pure, no I/O, no live call: an explicitly-configured host that's down stays exit 5;
  // a default localhost fallback that's down → exit 6.
  assert.equal(unreachableExit({ hostSource: "default" }), EXIT.DEFAULT_HOST_UNREACHABLE);
  assert.equal(unreachableExit({ hostSource: "config" }), EXIT.UNREACHABLE);
  // an explicitly-configured localhost is still "config" → stays exit 5 (the host string is irrelevant)
  assert.equal(unreachableExit({ hostSource: "config" }), 5);
  // missing/omitted provenance is treated as config (back-compat with existing callers)
  assert.equal(unreachableExit({}), EXIT.UNREACHABLE);
  assert.equal(unreachableExit(), EXIT.UNREACHABLE);
});
