// usage: node regrade-parse.mjs <faff checkout> <runs dir>
// Re-parses the runs' errored reps with the parsers in <faff checkout>.
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
const [W, R] = process.argv.slice(2);
const { parseRefutation } = await import(join(W, "plugin/skills/faffter-dark-spec-review/parse-refutation.mjs"));
const { normaliseCleanRefutation } = await import(join(W, "plugin/skills/faffter-dark-adversarial-review/review-call.mjs"));
const { parseJudgementEnvelope } = await import(join(W, "eval/envelope.mjs"));
const out = {};
for (const d of readdirSync(R).filter((f) => f.endsWith(".judgements.jsonl.gz"))) {
  const eff = d.split("-")[0];
  for (const line of gunzipSync(readFileSync(join(R, d))).toString("utf8").trim().split("\n")) {
    const j = JSON.parse(line); if (j.status !== "errored") continue;
    const k = `${eff} ${j.kind}`; const s = (out[k] ??= { errored: 0, recovered: 0, still: [] }); s.errored++;
    let ok = false, why = "";
    try {
      if (j.kind === "refutation-spec") {
        const m = /^\[lens=([^\]]+)\]\n([\s\S]*)$/.exec(j.raw_text ?? "");
        if (!m) { why = "no lens raw"; } else {
          const p = parseRefutation(normaliseCleanRefutation(m[2]).content, m[1]);
          ok = p.ok; if (!ok) why = p.fault?.reason ?? p.fault?.missing_field ?? "unparseable";
        }
      } else { parseJudgementEnvelope(j.raw_text ?? "", { expectedCaseId: j.case_id }); ok = true; }
    } catch (e) { why = e.message.slice(0, 60); }
    if (ok) s.recovered++; else s.still.push(why);
  }
}
for (const [k, s] of Object.entries(out)) {
  const c = {}; for (const w of s.still) c[w] = (c[w] || 0) + 1;
  console.log(k.padEnd(22), "errored", s.errored, "recovered", s.recovered, "still", s.still.length, JSON.stringify(c));
}
