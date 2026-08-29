// Deterministic tests for eval/tokenomics.mjs — parse, census, bill, and the strategy transforms.
// No model call, no process spawn (matches the eval/ CI convention). Uses a hand-built transcript
// so the expected numbers are checkable by hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTranscript,
  census,
  billCalls,
  applyPrefixShrink,
  apply5mWrites,
  benchmark,
  sensitivity,
  rateFor,
  RATES,
  prefillTokens,
  latency,
  ttlRisk,
  parseAnchors,
  kvLens,
} from "../eval/tokenomics.mjs";

// Two API calls, each split across streaming lines that share a request_id. The final line of each
// carries the real output_tokens; earlier lines carry the message-start snapshot (out=1).
const TRANSCRIPT = [
  // call A (opus): message-start snapshot then final line
  { type: "assistant", request_id: "reqA", message: { model: "claude-opus-4-8", usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 100000, cache_creation: { ephemeral_1h_input_tokens: 100000, ephemeral_5m_input_tokens: 0 }, input_tokens: 5, output_tokens: 1 } } },
  { type: "assistant", request_id: "reqA", message: { model: "claude-opus-4-8", usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 100000, cache_creation: { ephemeral_1h_input_tokens: 100000, ephemeral_5m_input_tokens: 0 }, input_tokens: 5, output_tokens: 400 } } },
  // call B (opus): warm read of the cached prefix
  { type: "assistant", request_id: "reqB", parent_tool_use_id: "t1", message: { model: "claude-opus-4-8", usage: { cache_read_input_tokens: 100000, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 }, input_tokens: 2, output_tokens: 200 } } },
  // noise lines that must be ignored
  { type: "system", subtype: "x" },
  { type: "user", message: { role: "user" } },
].map((o) => JSON.stringify(o)).join("\n");

test("parseTranscript dedupes by request_id and takes max usage", () => {
  const calls = parseTranscript(TRANSCRIPT);
  assert.equal(calls.length, 2);
  const [a, b] = calls;
  assert.equal(a.rid, "reqA");
  assert.equal(a.cw, 100000);
  assert.equal(a.out, 400); // max across the two reqA lines, not the 1 from the snapshot
  assert.equal(a.subagent, false);
  assert.equal(b.cr, 100000);
  assert.equal(b.subagent, true); // parent_tool_use_id present
});

test("census reports read:write ratio and context share", () => {
  const c = census(parseTranscript(TRANSCRIPT));
  assert.equal(c.calls, 2);
  assert.equal(c.cache_read.sum, 100000);
  assert.equal(c.cache_write.sum, 101000);
  // context = cr(100000) + cw(101000) + in(7) = 201007; output = 600
  assert.equal(c.context_tokens, 201007);
  assert.equal(c.output_tokens, 600);
  assert.ok(c.context_share_pct > 99);
});

test("billCalls prices cache read/write and output with the right per-model rate", () => {
  const calls = parseTranscript(TRANSCRIPT);
  const { cost, legs } = billCalls(calls);
  // opus in=$5/Mtok, out=$25/Mtok. read leg = 100000 * 0.1 * 5e-6 = $0.05
  assert.equal(legs.read, 0.05);
  // write leg = 101000 * 2.0 (1h) * 5e-6 = $1.01
  assert.equal(legs.write, 1.01);
  // output leg = 600 * 25e-6 = $0.015
  assert.equal(legs.output, 0.015);
  // input leg = 7 tok * 5e-6 = $0.000035; total = 0.05 + 1.01 + 0.000035 + 0.015 = 1.075 (rounded)
  assert.equal(cost, 1.075);
});

test("applyPrefixShrink drops the fixed prefix from the read leg on warm calls and the write leg on cold calls", () => {
  const calls = parseTranscript(TRANSCRIPT);
  const shrunk = applyPrefixShrink(calls, 100000, 10000); // F=100k -> 10k, dF=90k
  const [a, b] = shrunk;
  assert.equal(a.cw, 10000); // cold write call: prefix was written, now 10k
  assert.equal(b.cr, 10000); // warm read call: cached prefix now 10k
});

test("applyPrefixShrink with Fp=0 removes the prefix entirely", () => {
  const calls = parseTranscript(TRANSCRIPT);
  const stripped = applyPrefixShrink(calls, 100000, 0);
  assert.equal(stripped[0].cw, 0);
  assert.equal(stripped[1].cr, 0);
});

test("apply5mWrites moves 1h writes into the cheaper 5m bucket", () => {
  const calls = parseTranscript(TRANSCRIPT);
  const b = billCalls(apply5mWrites(calls)).legs.write;
  // 101000 * 1.25 * 5e-6 = $0.63125
  assert.equal(b, 0.631);
});

test("benchmark ranks strategies and reports deltas vs baseline", () => {
  const calls = parseTranscript(TRANSCRIPT);
  const rows = benchmark(calls, { fixed: 100000, lean: 10000 });
  const base = rows.find((r) => r.name === "baseline");
  const drop = rows.find((r) => r.name === "drop-injection");
  assert.equal(base.delta, 0);
  assert.ok(drop.delta < 0); // stripping the prefix is cheaper
  assert.ok(drop.pct < 0);
});

test("sensitivity is a positive $/10k-token lever when a fixed prefix is present", () => {
  const calls = parseTranscript(TRANSCRIPT);
  assert.ok(sensitivity(calls, 100000) > 0);
  assert.equal(sensitivity(calls, 0), 0);
});

test("rateFor falls back to the opus default for unknown models", () => {
  assert.deepEqual(rateFor("claude-opus-4-8"), RATES["claude-opus-4-8"]);
  assert.deepEqual(rateFor("something-unknown"), { in: 5.0, out: 25.0 });
});

test("prefillTokens: cached skips the prefix, uncached re-prefills the whole context", () => {
  const c = { cr: 100000, cw: 1000, in: 5, out: 200 };
  assert.equal(prefillTokens(c, "cached"), 1005); // cw + in only
  assert.equal(prefillTokens(c, "uncached"), 101005); // cr + cw + in
});

test("latency: uncached wall is far higher than cached for a big cached prefix", () => {
  const calls = parseTranscript(TRANSCRIPT);
  const cached = latency(calls, { prefillTps: 1000, decodeTps: 35, regime: "cached" });
  const uncached = latency(calls, { prefillTps: 1000, decodeTps: 35, regime: "uncached" });
  assert.ok(uncached.wall_s > cached.wall_s);
  assert.ok(uncached.ttft_s.median >= cached.ttft_s.median);
});

test("ttlRisk counts inter-call gaps that exceed the TTL, per session", () => {
  // craft calls in one session 10s and 400s apart
  const base = Date.parse("2026-08-12T15:30:00.000Z");
  const calls = [
    { session: "s1", ts: base, cr: 0, cw: 0, in: 0, out: 0 },
    { session: "s1", ts: base + 10_000, cr: 0, cw: 0, in: 0, out: 0 },
    { session: "s1", ts: base + 410_000, cr: 0, cw: 0, in: 0, out: 0 },
  ];
  const r5m = ttlRisk(calls, 300);
  assert.equal(r5m.gaps, 2);
  assert.equal(r5m.expiries, 1); // the 400s gap expires a 5m cache
  const r1h = ttlRisk(calls, 3600);
  assert.equal(r1h.expiries, 0); // neither gap expires a 1h cache
});

test("kvLens: bigger per-token KV means fewer concurrent contexts fit", () => {
  const calls = [{ cr: 200000, cw: 0, in: 0, out: 0 }, { cr: 100000, cw: 0, in: 0, out: 0 }];
  // fp8-ish 131072 B/tok, 30 GB budget: budget holds ~228k tok; median ctx here is 200k → ~1.14 fit
  const fp8 = kvLens(calls, { bytesPerToken: 131072, kvBudgetGB: 30 });
  const fp4 = kvLens(calls, { bytesPerToken: 65536, kvBudgetGB: 30 });
  assert.ok(fp4.resident_at_median > fp8.resident_at_median); // halving KV/token doubles what fits
  assert.ok(fp8.gb_per_median_ctx > fp4.gb_per_median_ctx);
  assert.equal(fp8.median_ctx, 200000);
});

test("parseAnchors reads timing from result events", () => {
  const text = JSON.stringify({ type: "result", num_turns: 4, duration_api_ms: 20000, ttft_ms: 2500, usage: { output_tokens: 1000 } });
  const [a] = parseAnchors(text);
  assert.equal(a.turns, 4);
  assert.equal(a.duration_s, 20);
  assert.equal(a.ttft_s, 2.5);
  assert.equal(a.realized_output_tps, 50); // 1000 tok / 20 s
});
