// Format lane: does a model's producer output pass faff's own parsers?
//
// The judgement sweep grades answers through an eval-only envelope, so it cannot say whether a model
// formats the blocks faff actually consumes. This lane runs four producers (spec, architecture, routing,
// ADR) a few times each and feeds every sample to the real parsers: the readiness-fence reader, the
// `faff contract` validators and `faff adr extract-intent`. One call is one request to an Anthropic
// Messages API endpoint with a unique request id, because a gateway may answer an identical request
// from a cache and make N samples one.
//
// The model is told it has no tools. Without that, some models emit tool-call markup instead of the
// artefact, and the lane would measure that artefact of a single-shot call rather than formatting.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const require = createRequire(import.meta.url);
const NO_TOOLS = "You have no tools in this session: answer directly from the information given and do not call any tool.";

const skillText = (name) => readFileSync(join(REPO, "plugin", "skills", name, "SKILL.md"), "utf8");
const faffCli = () => join(REPO, "plugin", "skills", "faff", "bin", "faff");

// Default contract runner: pipes a candidate to `faff <args>` and reports the exit status.
export function runFaff(args, input) {
  const r = spawnSync("node", [faffCli(), ...args], { input, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const TOOL_MARKUP = /DSML|<invoke\b|<tool_call>|<function_calls>/;

function parsers() {
  return require(join(REPO, "plugin", "skills", "faff", "bin", "lib", "prep-attach.js"));
}

const SPEC_USER = [
  "Produce the spec for this issue, following your skill exactly.",
  "",
  "ISSUE: Add a --quiet flag to `faff runcheck`",
  "`faff runcheck` prints one audit line per issue plus a summary. Add `--quiet` that prints only the summary line. Exit codes unchanged.",
  "",
  "EXPLORE FINDINGS:",
  "- The command lives in plugin/skills/faff/bin/lib/runcheck.js; output goes through a single `emit(line)` helper.",
  "- Argument parsing is hand-rolled in the same file; flags are listed in a USAGE constant.",
  "- Tests live in test/runcheck.test.mjs and capture stdout via a helper.",
].join("\n");

const ARCH_USER = [
  "INFRA PROFILE: Node 22 runtime, GitHub Actions CI, deploys to Fly.io, Postgres available, one engineer, no on-call.",
  "BRIEF: A small internal service that receives webhook events, stores them durably, and lets staff search the last 90 days. Expected load: under 50 events/second. Events must never be lost once acknowledged.",
  "Produce the proposal exactly as your skill specifies.",
].join("\n");

const ROUTING_FIXTURES = [
  { want: "fire-and-forget", text: "ISSUE FAFF-501 (Todo). Spec confidence: high. Markers: Chosen x2, no Punt, no Assumes. punt-scan blocking_open_count: 0. No in-queue blockers. Conflict analysis: independent. Park history: none. backlog-diagnostics findings for this issue: none." },
  { want: "needs-decision-first", text: "ISSUE FAFF-502 (Todo). Spec confidence: medium. Markers: one open **Punt:** (decides: API shape), blocking_open_count: 1. No blockers. Park history: none. Diagnostics: none." },
];

const ADR_USER = [
  "Settled decision: use a Postgres LISTEN/NOTIFY queue instead of Redis for the webhook ingest. Spec rationale: Postgres is already provisioned, one fewer service to run, load is under 50 events/second. Related ADRs: none.",
  "Resolved format (from `faff adr format --json`): sections in order: Context, Decision, Consequences. Author the ADR body.",
].join("\n");

// Each producer: the skill that is the system prompt, a user prompt per sample, and a check that returns
// null for a pass or a short reason for a failure.
export const PRODUCERS = [
  {
    producer: "spec",
    skill: "faffter-noon-spec",
    user: () => ({ text: SPEC_USER }),
    check(text, { runContract }) {
      if (TOOL_MARKUP.test(text)) return "tool-call markup instead of the artefact";
      const { stampConfidence, readinessBlocks } = parsers();
      if (stampConfidence(text) === "unknown") return "no parseable `confidence:` line";
      const blocks = readinessBlocks(text);
      if (blocks.length !== 1) return `${blocks.length} faff-contract:spec-readiness blocks, expected 1`;
      try { JSON.parse(blocks[0]); } catch { return "readiness block is not valid JSON"; }
      const v = runContract(["contract", "spec-readiness"], blocks[0]);
      return v.status === 0 ? null : `spec-readiness contract rejected it: ${v.out.slice(0, 160).replace(/\s+/g, " ")}`;
    },
  },
  {
    producer: "architecture",
    skill: "faffter-noon-architecture",
    user: () => ({ text: ARCH_USER }),
    check(text, { runContract }) {
      if (TOOL_MARKUP.test(text)) return "tool-call markup instead of the artefact";
      const m = text.match(/^ {0,3}```faff-contract:architecture-proposal[ \t]*\r?\n([\s\S]*?)\r?\n```/m);
      if (!m) return "no faff-contract:architecture-proposal fence with the tag on the fence line";
      try { JSON.parse(m[1]); } catch { return "proposal block is not valid JSON"; }
      const v = runContract(["contract", "architecture-proposal"], m[1]);
      if (v.status !== 0) return `architecture-proposal contract rejected it: ${v.out.slice(0, 160).replace(/\s+/g, " ")}`;
      if (runContract(["adr", "extract-intent"], text).status !== 0) return "no `## ADR promotion intent` section";
      return parsers().stampConfidence(text) === "unknown" ? "no parseable `confidence:` line" : null;
    },
  },
  {
    producer: "routing",
    skill: "faffidavit-routing",
    user: (i) => { const f = ROUTING_FIXTURES[i % ROUTING_FIXTURES.length]; return { text: `${f.text}\nAssign the verdict and emit ONLY the extraction JSON your skill specifies, nothing else.`, want: f.want }; },
    check(text, { runContract }, ctx) {
      let obj = null;
      try { obj = JSON.parse(text.trim()); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { obj = JSON.parse(m[0]); } catch { /* fall through */ } }
      }
      if (!obj) return "no JSON object in the output";
      const v = runContract(["contract", "automation-routing"], JSON.stringify(obj));
      if (v.status !== 0) return `automation-routing contract exit ${v.status}`;
      return obj.verdict === ctx.want ? null : `verdict ${obj.verdict}, expected ${ctx.want}`;
    },
  },
  {
    producer: "adr",
    skill: "faffter-noon-adr",
    note: "A title or a Self-review heading is a miss. The confidence line is advisory and not machine-parsed.",
    user: () => ({ text: ADR_USER }),
    check(text) {
      if (TOOL_MARKUP.test(text)) return "tool-call markup instead of the artefact";
      const headings = [...text.matchAll(/^#{1,3}\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
      const ok = headings.length === 3 && headings[0] === "Context" && headings[1] === "Decision" && headings[2] === "Consequences";
      return ok ? null : `headings were: ${headings.join(" | ") || "none"}`;
    },
  },
];

// One request per sample to an Anthropic-style /v1/messages endpoint. `fetchFn` is injectable.
export function makeMessagesCompleter({ baseUrl, apiKey, model, maxTokens = 6000, fetchFn = globalThis.fetch }) {
  const url = `${String(baseUrl).replace(/\/+$/, "")}/v1/messages`;
  return async (system, user) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  };
}

const withNonce = (text, i) => `${text}\n\n${NO_TOOLS}\n\n[request-id ${i}-${Math.random().toString(36).slice(2)}]`;

export async function runFormatCheck({ complete, samples = 12, producers = PRODUCERS, runContract = runFaff, concurrency = 4, only = null } = {}) {
  const out = [];
  for (const p of producers.filter((x) => !only || only.includes(x.producer))) {
    const system = skillText(p.skill);
    const results = new Array(samples);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, samples) }, async () => {
      while (next < samples) {
        const i = next++;
        const u = p.user(i);
        let reason;
        try { reason = p.check(await complete(system, withNonce(u.text, i)), { runContract }, u); }
        catch (e) { reason = `call failed: ${e.message}`; }
        results[i] = reason;
      }
    }));
    const failures = results.filter((r) => r != null);
    const reasons = {};
    for (const f of failures) reasons[f] = (reasons[f] ?? 0) + 1;
    out.push({ producer: p.producer, samples, passed: samples - failures.length, failures: reasons, note: p.note ?? null });
  }
  return { producers: out, checked_at: new Date().toISOString() };
}
