import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMessagesCompleter, PRODUCERS, runFormatCheck } from "../eval/format-check.mjs";

const byName = (n) => PRODUCERS.find((p) => p.producer === n);
const okContract = () => ({ status: 0, out: "" });
const ctx = { runContract: okContract };

const SPEC_OK = "# Spec\n\n**Chosen:** x\n\nconfidence: high\n\n```faff-contract:spec-readiness\n{\"confidence\":\"high\",\"decisions\":[{\"marker\":\"chosen\"}]}\n```\n";

test("spec: a well-formed output passes", () => {
  assert.equal(byName("spec").check(SPEC_OK, ctx), null);
});

test("spec: the tag on the line after a bare fence is not read, so the block is missing", () => {
  const bare = SPEC_OK.replace("```faff-contract:spec-readiness\n", "```\nfaff-contract:spec-readiness\n");
  assert.match(byName("spec").check(bare, ctx), /0 faff-contract:spec-readiness blocks/);
});

test("spec: no confidence line, bad JSON, a contract rejection and tool markup each name their cause", () => {
  assert.match(byName("spec").check(SPEC_OK.replace("confidence: high\n", ""), ctx), /confidence/);
  assert.match(byName("spec").check(SPEC_OK.replace('{"confidence":"high","decisions":[{"marker":"chosen"}]}', "{not json"), ctx), /not valid JSON/);
  assert.match(byName("spec").check(SPEC_OK, { runContract: () => ({ status: 1, out: "decision[3] has no canonical marker" }) }), /rejected it.*canonical marker/);
  assert.match(byName("spec").check("<｜DSML｜ invoke name=\"Bash\">", ctx), /tool-call markup/);
});

const ARCH_OK = "Proposal.\n\n```faff-contract:architecture-proposal\n{\"chosen_architecture\":\"a\",\"rationale\":\"b\",\"adr_candidates\":[],\"assumptions\":[],\"recommendation\":\"build\"}\n```\n\n## ADR promotion intent\n\n- x\n\nconfidence: medium\n";

test("architecture: passes with the tag on the fence line, fails on a bare fence", () => {
  assert.equal(byName("architecture").check(ARCH_OK, ctx), null);
  const bare = ARCH_OK.replace("```faff-contract:architecture-proposal\n", "```\nfaff-contract:architecture-proposal\n");
  assert.match(byName("architecture").check(bare, ctx), /tag on the fence line/);
});

test("architecture: missing promotion intent or confidence line is named", () => {
  const noIntent = { runContract: (args) => (args[0] === "adr" ? { status: 1, out: "" } : okContract()) };
  assert.match(byName("architecture").check(ARCH_OK, noIntent), /promotion intent/);
  assert.match(byName("architecture").check(ARCH_OK.replace("confidence: medium\n", ""), ctx), /confidence/);
});

test("routing: bare JSON passes, JSON inside prose passes, a wrong verdict or no JSON fails", () => {
  const ctxWant = { want: "fire-and-forget" };
  assert.equal(byName("routing").check('{"verdict":"fire-and-forget","root_cause":null}', ctx, ctxWant), null);
  assert.equal(byName("routing").check('Here:\n```json\n{"verdict":"fire-and-forget","root_cause":null}\n```', ctx, ctxWant), null);
  assert.match(byName("routing").check('{"verdict":"likely-fire","root_cause":null}', ctx, ctxWant), /expected fire-and-forget/);
  assert.match(byName("routing").check("I think it fires.", ctx, ctxWant), /no JSON/);
  assert.match(byName("routing").check('{"verdict":"x"}', { runContract: () => ({ status: 2, out: "" }) }, ctxWant), /exit 2/);
});

test("routing alternates its two fixtures by sample index", () => {
  assert.equal(byName("routing").user(0).want, "fire-and-forget");
  assert.equal(byName("routing").user(1).want, "needs-decision-first");
  assert.equal(byName("routing").user(2).want, "fire-and-forget");
});

test("adr: exactly Context, Decision, Consequences passes; a title or Self-review heading fails", () => {
  const body = (h) => h.map((x) => `## ${x}\n\ntext\n`).join("\n");
  assert.equal(byName("adr").check(body(["Context", "Decision", "Consequences"]), ctx), null);
  assert.match(byName("adr").check("# ADR: title\n\n" + body(["Context", "Decision", "Consequences"]), ctx), /headings were/);
  assert.match(byName("adr").check(body(["Context", "Decision", "Consequences", "Self-review"]), ctx), /Self-review/);
});

test("runFormatCheck: counts passes, groups failure reasons, sends a different request id every call", async () => {
  const seen = [];
  const complete = async (system, user) => { seen.push(user); return seen.length % 2 ? SPEC_OK : "nothing useful"; };
  const r = await runFormatCheck({ complete, samples: 6, producers: [byName("spec")], runContract: okContract, concurrency: 2 });
  assert.equal(r.producers[0].samples, 6);
  assert.equal(r.producers[0].passed, 3);
  assert.equal(Object.values(r.producers[0].failures).reduce((a, b) => a + b, 0), 3);
  assert.equal(new Set(seen.map((u) => u.match(/request-id (\S+)\]/)[1])).size, 6, "a unique id per call defeats a gateway response cache");
  assert.ok(seen.every((u) => /no tools in this session/.test(u)));
});

test("runFormatCheck: a failed call is a counted failure, not a thrown error", async () => {
  const r = await runFormatCheck({ complete: async () => { throw new Error("HTTP 500"); }, samples: 2, producers: [byName("adr")], runContract: okContract });
  assert.equal(r.producers[0].passed, 0);
  assert.match(Object.keys(r.producers[0].failures)[0], /call failed: HTTP 500/);
});

test("runFormatCheck: `only` limits the producers", async () => {
  const r = await runFormatCheck({ complete: async () => "", samples: 1, only: ["routing"], runContract: okContract });
  assert.deepEqual(r.producers.map((p) => p.producer), ["routing"]);
});

test("makeMessagesCompleter posts to /v1/messages with the key and returns the text blocks", async () => {
  let call;
  const fetchFn = async (url, init) => { call = { url, init }; return { ok: true, status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "hi" }, { type: "text", text: " there" }] }) }; };
  const out = await makeMessagesCompleter({ baseUrl: "https://gw.test/", apiKey: "k", model: "m", fetchFn })("SYS", "USER");
  assert.equal(out, "hi there");
  assert.equal(call.url, "https://gw.test/v1/messages");
  const body = JSON.parse(call.init.body);
  assert.equal(body.system, "SYS");
  assert.equal(body.model, "m");
  assert.equal(call.init.headers["x-api-key"], "k");
  await assert.rejects(() => makeMessagesCompleter({ baseUrl: "https://gw.test", apiKey: "k", model: "m", fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ error: "no" }) }) })("S", "U"), /HTTP 401/);
});
