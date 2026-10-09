// usage: node regrade-score.mjs <faff checkout> <runs dir>
// Re-parses the runs' errored reps with the parsers in <faff checkout>.
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
const [W, R] = process.argv.slice(2);
const { parseRefutation } = await import(join(W, "plugin/skills/faffter-dark-spec-review/parse-refutation.mjs"));
const { normaliseCleanRefutation } = await import(join(W, "plugin/skills/faffter-dark-adversarial-review/review-call.mjs"));
const { aggregate } = await import(join(W, "plugin/skills/faffter-dark-spec-review/aggregate.mjs"));
const { parseJudgementEnvelope } = await import(join(W, "eval/envelope.mjs"));
const { grade } = await import(join(W, "eval/grader.mjs"));
const { loadCases } = await import(join(W, "eval/run-evals.mjs"));
const cases = new Map(loadCases().map((c) => [c.id, c]));
const ABOVE = new Set(["blocker", "major"]);
const out = {};
for (const d of readdirSync(R).filter((f) => f.endsWith(".judgements.jsonl.gz"))) {
  const eff = d.split("-")[0];
  for (const line of gunzipSync(readFileSync(join(R, d))).toString("utf8").trim().split("\n")) {
    const j = JSON.parse(line); if (j.status !== "errored") continue;
    const k = `${eff} ${j.kind}`; const s = (out[k] ??= { errored: 0, parsed: 0, right: 0, wrong: [] });
    s.errored++; const c = cases.get(j.case_id);
    try {
      if (j.kind === "refutation-code") {
        const env = parseJudgementEnvelope(j.raw_text ?? "", { expectedCaseId: j.case_id }); s.parsed++;
        const r = grade(c, env); if (r.score === 1) s.right++; else s.wrong.push(`${j.case_id} said ${r.signature}`);
      } else {
        const m = /^\[lens=([^\]]+)\]\n([\s\S]*)$/.exec(j.raw_text ?? ""); if (!m) continue;
        const lens = m[1]; const p = parseRefutation(normaliseCleanRefutation(m[2]).content, lens); if (!p.ok) continue; s.parsed++;
        const objects = aggregate([p.entry], 4).objections.some((o) => ABOVE.has(String(o.severity)));
        const o = c.oracle; let should;
        if (o.closed_set) should = o.closed_set.includes(lens) ? "object" : "clean";
        else should = o.lens_bounds.must_object.includes(lens) ? "object" : (o.lens_bounds.may_object ?? []).includes(lens) ? "either" : "clean";
        const ok = should === "either" || (should === "object") === objects;
        if (ok) s.right++; else s.wrong.push(`${j.case_id} ${lens} ${objects ? "objected" : "clean"}, should ${should}`);
      }
    } catch (e) { /* still unparseable */ }
  }
}
for (const [k, s] of Object.entries(out)) {
  console.log(k.padEnd(22), "errored", s.errored, "parsed", s.parsed, "right", s.right, "wrong", s.wrong.length);
  for (const w of s.wrong) console.log("   ", w);
}
