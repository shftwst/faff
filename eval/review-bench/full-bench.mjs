#!/usr/bin/env node
// full-bench.mjs — run the WHOLE benchmark battery for ONE model, then move on to the next.
// Configure the endpoint once; this runs every test kind (sequential panel, fan-out, cache, streaming
// TTFB, reasoning on/off), drops each under one parent results dir, and writes a consolidated
// FULL-SUMMARY.md with the headline numbers. Zero dependencies (spawns run-bench.mjs in this dir).
//
// USAGE
//   node full-bench.mjs --provider <ollama|openai> --host <URL> --model <NAME> [options]
//
//   # ollama
//   node full-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx
//   # openai-compatible (with key), Cohere native reasoning switch
//   OMLX_API_KEY=... node full-bench.mjs --provider openai --host http://HOST:8001/v1 \
//       --model North-Mini-Code-1.0-6bit --key-env OMLX_API_KEY --cohere
//   # quick pass (fan-out + cache only)
//   node full-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx --quick
//
// OPTIONS (endpoint flags are passed straight through to run-bench.mjs)
//   --provider --host --model --key-env --cohere --max-tokens   (see run-bench.mjs)
//   --single LENS   lens used for the single-lens tests (cache/stream/reasoning); default qa
//   --repeat N      iterations for the cache test; default 3
//   --quick         run only the fast subset (fan-out panel + cache)
//   --label TEXT    appended to the results dir name
//   --timeout-ms MS forwarded to run-bench.mjs

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(ROOT, "run-bench.mjs");

function parseArgs(argv) {
  const a = { single: "qa", repeat: 3, quick: false, cohere: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--provider") a.provider = argv[++i];
    else if (k === "--host") a.host = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--key-env") a.keyEnv = argv[++i];
    else if (k === "--cohere") a.cohere = true;
    else if (k === "--max-tokens") a.maxTokens = argv[++i];
    else if (k === "--single") a.single = argv[++i];
    else if (k === "--repeat") a.repeat = argv[++i];
    else if (k === "--quick") a.quick = true;
    else if (k === "--label") a.label = argv[++i];
    else if (k === "--requests-dir") a.requestsDir = argv[++i];
    else if (k === "--timeout-ms") a.timeoutMs = argv[++i];
    else if (k === "-h" || k === "--help") a.help = true;
  }
  return a;
}
const A = parseArgs(process.argv.slice(2));
if (A.help || !A.provider || !A.host || !A.model) {
  console.error("usage: node full-bench.mjs --provider <ollama|openai> --host <URL> --model <NAME> [options]\nsee the header of this file.");
  process.exit(A.help ? 0 : 2);
}

const slug = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// endpoint flags forwarded to every run-bench invocation
const endpoint = ["--provider", A.provider, "--host", A.host, "--model", A.model];
if (A.keyEnv) endpoint.push("--key-env", A.keyEnv);
if (A.cohere) endpoint.push("--cohere");
if (A.maxTokens) endpoint.push("--max-tokens", String(A.maxTokens));
if (A.timeoutMs) endpoint.push("--timeout-ms", String(A.timeoutMs));
if (A.requestsDir) endpoint.push("--requests-dir", A.requestsDir);   // e.g. code-review/requests

// the battery
const S = A.single.toLowerCase();
const battery = [
  { id: "1-panel-sequential", desc: "sequential 4-lens panel (calibration + clean per-lens timing)", args: ["--lens", "all", "--reasoning", "off"], quick: false },
  { id: "2-panel-fanout", desc: "concurrent 4-lens fan-out (GPU serialization + panel wall-clock)", args: ["--lens", "all", "--reasoning", "off", "--concurrent"], quick: true },
  { id: `3-cache-${S}-x${A.repeat}`, desc: `prompt-cache warming (${S} x${A.repeat})`, args: ["--lens", S, "--reasoning", "off", "--repeat", String(A.repeat)], quick: true },
  { id: `4-stream-ttfb-${S}`, desc: "streaming time-to-first-byte", args: ["--lens", S, "--reasoning", "off", "--stream"], quick: false },
  { id: `5-reasoning-on-${S}`, desc: "reasoning ON (compare vs off)", args: ["--lens", S, "--reasoning", "on"], quick: false },
];
const plan = A.quick ? battery.filter((b) => b.quick) : battery;

const parent = join(ROOT, "results", `full-${A.provider}-${slug(A.model)}${A.label ? "-" + slug(A.label) : ""}-${stamp()}`);
mkdirSync(parent, { recursive: true });

console.log(`\n================ FULL BENCHMARK ================`);
console.log(`model:    ${A.model}`);
console.log(`endpoint: ${A.provider} ${A.host}${A.cohere ? " (+cohere)" : ""}`);
console.log(`battery:  ${plan.length} test(s)${A.quick ? " (quick)" : ""}  ->  ${parent}`);
console.log(`===============================================\n`);

const collected = [];
for (let i = 0; i < plan.length; i++) {
  const b = plan[i];
  const outDir = join(parent, b.id);
  console.log(`\n----- [${i + 1}/${plan.length}] ${b.desc} -----`);
  const r = spawnSync("node", [RUNNER, ...endpoint, ...b.args, "--out", outDir], { stdio: "inherit" });
  let summary = null;
  try { summary = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8")); } catch {}
  collected.push({ ...b, outDir, exit: r.status, summary });
}

// ---- consolidate ----
const panel = collected.find((c) => c.id === "1-panel-sequential")?.summary;
const fanout = collected.find((c) => c.id === "2-panel-fanout")?.summary;
const cacheRun = collected.find((c) => c.id.startsWith("3-cache"))?.summary;
const streamRun = collected.find((c) => c.id.startsWith("4-stream"))?.summary;
const reasonOn = collected.find((c) => c.id.startsWith("5-reasoning-on"))?.summary;

const firstIterLenses = (s) => s?.runs?.[0]?.lenses ?? [];
function fmtTable(lensesRows) {
  let t = `| lens | http | total | ttfb | in | out | pe tps | gen tps | shape | severities | reasoning |\n|---|---|--:|--:|--:|--:|--:|--:|---|---|--:|\n`;
  for (const r of lensesRows) {
    if (r.error) { t += `| ${r.lens} | ${r.http ?? "-"} | | | | | | | ERROR | ${String(r.error).slice(0, 30)} | |\n`; continue; }
    t += `| ${r.lens} | ${r.http} | ${r.total_s}s | ${r.ttfb_s ?? ""} | ${r.in_tok} | ${r.out_tok} | ${r.prompt_eval_tps ?? ""} | ${r.gen_tps ?? ""} | ${r.shape} | ${(r.severities || []).join(",")} | ${r.reasoning_len || ""} |\n`;
  }
  return t;
}

// headline metrics (defensive)
const pl = firstIterLenses(panel);
const served = panel?.preflight?.served ?? "?";
const parseableN = pl.filter((r) => !r.error && (r.shape === "findings-shaped" || r.shape === "clean-pass")).length;
const allSev = pl.flatMap((r) => r.severities || []);
const emptyOnOff = pl.some((r) => r.shape === "EMPTY" && r.reasoning_len > 0);
// fan-out serialization: panel wall vs slowest single lens (from the sequential panel's per-lens totals)
const foWall = fanout?.runs?.[0]?.wall_s;
const seqTotals = pl.filter((r) => !r.error).map((r) => r.total_s);
const slowestSeq = seqTotals.length ? Math.max(...seqTotals) : null;
const sumSeq = seqTotals.reduce((a, b) => a + b, 0);
const serialRatio = foWall && slowestSeq ? +(foWall / slowestSeq).toFixed(1) : null;
// cache
const cacheLine = cacheRun?.cache ? Object.entries(cacheRun.cache).map(([ln, c]) => `${ln} ${c.total_s.join("s->")}s${c.speedup_first_to_last ? ` (${c.speedup_first_to_last}x)` : ""}`).join("; ") : null;
// ttfb
const streamLens = firstIterLenses(streamRun)[0];
// reasoning on vs off (single lens)
const offSingle = firstIterLenses(cacheRun)[0] || pl.find((r) => r.lens.toLowerCase() === S);
const onSingle = firstIterLenses(reasonOn)[0];

let md = `# Full benchmark — ${A.model}\n\n`;
md += `- endpoint: ${A.provider} ${A.host}${A.cohere ? " (+cohere)" : ""}\n- run: ${new Date().toISOString()}\n- battery: ${plan.map((b) => b.id).join(", ")}\n\n`;
md += `## Headline\n\n`;
md += `- **Serves / parseable:** model served = ${served}; ${parseableN}/${pl.length} lenses returned usable (findings-shaped or clean-pass).\n`;
md += `- **Calibration (severities across lenses):** ${allSev.length ? allSev.join(", ") : "none / not-shaped"}${new Set(allSev).size <= 1 && allSev.length ? "  ⚠ mono-severity (cannot pass a spec)" : ""}\n`;
md += `- **Reasoning disable works:** ${emptyOnOff ? "**NO** — a lens returned EMPTY with non-empty reasoning_content even with reasoning off (⚠ reasoning-eaten-budget; unusable on real prompts)" : "yes (reasoning off produced content, no budget-exhaustion)"}\n`;
md += `- **Fan-out serialization:** panel wall ${foWall ?? "?"}s vs slowest single lens ${slowestSeq ?? "?"}s${serialRatio ? ` -> ${serialRatio}x` : ""}${serialRatio && serialRatio > 1.5 ? " (serialized — single GPU; fan-out ~= sum of lenses)" : serialRatio ? " (roughly parallel)" : ""}. Sequential sum ${sumSeq ? sumSeq.toFixed(0) + "s" : "?"}.\n`;
md += `- **Prompt cache:** ${cacheLine || "n/a"}\n`;
md += `- **TTFB (streaming ${S}):** ${streamLens && streamLens.ttfb_s != null ? streamLens.ttfb_s + "s to first byte" : "n/a"}${streamLens && streamLens.ttfb_s != null && streamLens.total_s ? ` (total ${streamLens.total_s}s)` : ""}\n`;
if (onSingle || offSingle) {
  md += `- **Reasoning ON vs OFF (${S}):** off shape=${offSingle?.shape ?? "?"} out=${offSingle?.out_tok ?? "?"}${offSingle?.reasoning_len ? ` rc=${offSingle.reasoning_len}b` : ""} | on shape=${onSingle?.shape ?? "?"} out=${onSingle?.out_tok ?? "?"}${onSingle?.reasoning_len ? ` rc=${onSingle.reasoning_len}b` : ""}\n`;
}
md += `\n## Sub-runs\n\n`;
for (const c of collected) {
  md += `### ${c.id} — ${c.desc}\n\n`;
  if (c.exit !== 0 && !c.summary) { md += `_(run exited ${c.exit}, no summary)_\n\n`; continue; }
  const rows = (c.summary?.runs ?? []).flatMap((rn) => rn.lenses.map((l) => ({ ...l, _iter: rn.iter })));
  md += fmtTable(rows);
  if (c.summary?.cache) md += `\ncache: ${Object.entries(c.summary.cache).map(([ln, cc]) => `${ln} ${cc.total_s.join("s->")}s`).join("; ")}\n`;
  md += `\nfull detail: \`${c.id}/summary.md\`\n\n`;
}
writeFileSync(join(parent, "FULL-SUMMARY.md"), md);

console.log(`\n================ DONE ================`);
console.log(`consolidated report: ${join(parent, "FULL-SUMMARY.md")}`);
console.log(`per-test detail under: ${parent}/<test>/summary.md`);
