// Refutation evals against an OpenAI-compatible backend with an explicit reasoning_effort.
// Same prompts, fan and grading as the harness's CLI driver; only the transport differs.
// usage: node run.mjs <effort: off|low|high|max> <tag> [case-id,...]
// env: LOCAL_API_KEY (required), GLM_BASE_URL, GLM_REPS, GLM_MAX_REPS
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const { loadCases, runEvals } = await import(join(ROOT, "eval/run-evals.mjs"));
const { buildEvalPrompt, criteriaFor, REFUTATION_SPEC_LENSES } = await import(join(ROOT, "eval/cli-driver.mjs"));
const { parseRefutation } = await import(join(ROOT, "plugin/skills/faffter-dark-spec-review/parse-refutation.mjs"));
const { aggregate } = await import(join(ROOT, "plugin/skills/faffter-dark-spec-review/aggregate.mjs"));
const { normaliseCleanRefutation } = await import(join(ROOT, "plugin/skills/faffter-dark-adversarial-review/review-call.mjs"));

const BASE_URL = process.env.GLM_BASE_URL ?? "https://llm.longhair-escalator.ts.net/v1";
const MODEL = "spark/glm-5.3-flash";
const KEY = process.env.LOCAL_API_KEY;
const [effort, tag, only] = process.argv.slice(2);
if (!["off", "low", "high", "max"].includes(effort)) throw new Error("effort must be off|low|high|max");
if (!KEY) throw new Error("LOCAL_API_KEY not set");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.error(`[glm ${effort} ${new Date().toISOString()}] ${m}`);

async function complete(prompt) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 16000, reasoning_effort: effort, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(600_000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) {
      const json = await res.json();
      return { text: json.choices?.[0]?.message?.content ?? "", tokens: json.usage?.completion_tokens ?? 0 };
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) { say(`auth failed (${res.status}); exiting`); process.exit(5); }
    if (attempt >= 6) throw new Error(`HTTP ${res.status} after ${attempt} attempts: ${body.slice(0, 200)}`);
    say(`HTTP ${res.status} ${body.slice(0, 80)}; retry ${attempt}`);
    await sleep(15_000 * attempt);
  }
}

async function driver(evalCase) {
  if (evalCase.kind === "refutation-spec") {
    const systemDir = join(ROOT, "plugin/skills/faffter-dark-spec-review");
    const refutations = [];
    let tokens = 0;
    for (const lens of REFUTATION_SPEC_LENSES) {
      const brief = readFileSync(join(systemDir, `refute-${lens.toLowerCase()}.md`), "utf8");
      const out = await complete(`${brief}\n\nSpec:\n${evalCase.fixture?.spec ?? ""}`);
      tokens += out.tokens;
      const parsed = parseRefutation(normaliseCleanRefutation(out.text).content, lens);
      if (!parsed.ok) {
        const f = parsed.fault ?? {};
        const err = new Error(`lens=${lens} unparseable (${f.reason ?? f.missing_field ?? "unparseable"})`);
        err.rawOutput = `[lens=${lens}]\n${out.text}`;
        throw err;
      }
      refutations.push(parsed.entry);
    }
    const rolled = aggregate(refutations, REFUTATION_SPEC_LENSES.length);
    return { rawText: "```faff-eval:judgement\n" + JSON.stringify({ case_id: evalCase.id, objections: rolled.objections }) + "\n```", tokens };
  }
  const out = await complete(buildEvalPrompt(evalCase, criteriaFor(evalCase.kind)));
  return { rawText: out.text, tokens: out.tokens };
}

const want = only ? new Set(only.split(",")) : null;
const cases = loadCases().filter((c) => /^refutation-/.test(c.kind) && (!want || want.has(c.id)));
const dir = join(HERE, "runs", tag);
mkdirSync(dir, { recursive: true });
say(`${cases.length} case(s) -> ${dir}`);
const summary = await runEvals({ cases, driver, baseReps: Number(process.env.GLM_REPS ?? 20), maxReps: Number(process.env.GLM_MAX_REPS ?? 50), judgementsPath: join(dir, "judgements.jsonl"), stamp: { model: MODEL, effort } });
writeFileSync(join(dir, "summary.json"), JSON.stringify(summary, null, 1));
for (const [k, v] of Object.entries(summary.per_kind)) console.log(`KIND ${k} accuracy ${v.accuracy.toFixed(3)} stability ${v.stability.toFixed(3)} format ${v.format_adherence?.toFixed?.(3)}`);
