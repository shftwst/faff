// FAFF-1435 — builds run-dir fixtures for `faff run summary` through the real writers.
// `run-ledger init-self-drain` mints the ledger and the genesis event, `run-ledger record-outcome`
// records each outcome, and `events append` writes the sentry checkpoints. Fields no CLI writes —
// `admitted` (the skill appends it), the annotation arrays, `stop_reason`, `level` and the
// owner timestamps (pinned so a render is reproducible) — are set on the minted ledger, and the
// result is checked against the v0.3 run-ledger schema. Every id, title and path is invented.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..", "..");
export const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const SCHEMA = require(join(REPO, "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema", "run-ledger.schema.json"));

export const STARTED_AT = "2026-01-01T00:00:00.000Z";
export const ENDED_AT = "2026-01-01T02:34:00.000Z";

export function cli(root, args, { input = "", env = {} } = {}) {
  const base = { ...process.env };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_SESSION_ID"]) delete base[k];
  const r = spawnSync("node", [CLI, ...args], { cwd: root, encoding: "utf8", input, env: { ...base, ...env } });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// A light shape check of the ledger against the v0.3 schema's declared property types.
export function schemaViolations(ledger) {
  const out = [];
  for (const [k, v] of Object.entries(ledger)) {
    const p = SCHEMA.properties[k];
    if (!p) { out.push(`unknown field ${k}`); continue; }
    if (p.type === "array" && !Array.isArray(v)) out.push(`${k} is not an array`);
    if (p.type === "object" && (typeof v !== "object" || v === null || Array.isArray(v))) out.push(`${k} is not an object`);
    if (p.type === "string" && typeof v !== "string") out.push(`${k} is not a string`);
    if (p.type === "integer" && !Number.isInteger(v)) out.push(`${k} is not an integer`);
    if (k === "outcomes") for (const o of Object.values(v)) if (!p.additionalProperties.enum.includes(o)) out.push(`outcome ${o} not in the enum`);
  }
  return out;
}

export function buildRun({
  mode = "list", entropy = "abc123", admitted = [], outcomes = {}, ledger = {}, events = [], files = {}, config = "", git = true,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-run-summary-"));
  if (git) spawnSync("git", ["-C", root, "init", "-q"]);
  writeFileSync(join(root, ".faffrc.yaml"), config);
  const runId = `run-20260101-000000-beepboop-${mode}-${entropy}`;
  const mint = cli(root, ["run-ledger", "init-self-drain", "--mode", mode, "--id", runId, "--root", root]);
  if (mint.code !== 0) throw new Error(`init-self-drain failed: ${mint.err}`);
  const runDir = join(root, ".faff", "runs", runId);
  const ledgerPath = join(runDir, "run-ledger.json");
  const patch = (fn) => { const l = JSON.parse(readFileSync(ledgerPath, "utf8")); fn(l); writeFileSync(ledgerPath, JSON.stringify(l, null, 2) + "\n"); };
  patch((l) => { l.admitted = [...admitted]; });
  for (const [issue, outcome] of Object.entries(outcomes)) {
    if (!admitted.includes(issue)) patch((l) => { l.admitted.push(issue); });
    const r = cli(root, ["run-ledger", "record-outcome", "--issue", issue, "--outcome", outcome, "--run-dir", runDir]);
    if (r.code !== 0) throw new Error(`record-outcome ${issue} ${outcome} failed: ${r.err}`);
  }
  patch((l) => {
    Object.assign(l, ledger);
    l.owner = { ...l.owner, started_at: STARTED_AT, last_heartbeat: STARTED_AT };
  });
  for (const e of events) {
    const r = cli(root, ["events", "append", "--run", runId, "--ts", e.ts, "--root", root], { input: JSON.stringify({ phase: e.phase ?? "run", type: e.type, ...(e.data ? { data: e.data } : {}) }) });
    if (r.code !== 0) throw new Error(`events append failed: ${r.err}`);
  }
  // The last event fixes the duration endpoint (the genesis event carries the mint-time clock).
  const end = cli(root, ["events", "append", "--run", runId, "--ts", ENDED_AT, "--root", root], { input: JSON.stringify({ phase: "run", type: "run-end" }) });
  if (end.code !== 0) throw new Error(`run-end append failed: ${end.err}`);
  writeFileSync(join(runDir, "heartbeat"), STARTED_AT + "\n");
  for (const [rel, content] of Object.entries(files)) {
    const p = join(rel.startsWith(".faff/") ? root : runDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  const violations = schemaViolations(JSON.parse(readFileSync(ledgerPath, "utf8")));
  if (violations.length) throw new Error(`fixture ledger violates the schema: ${violations.join("; ")}`);
  return { root, runDir, runId };
}

// The synthetic reference fixture: the structure of a real list-mode drain (one shipped issue,
// two sentry checkpoints ending in abort, a converged stop) with invented ids, titles and paths.
export function buildReference() {
  const fx = buildRun({
    mode: "list",
    admitted: ["DEMO-7"],
    outcomes: { "DEMO-7": "shipped" },
    ledger: { level: "L3", stop_reason: "converged/both-dry" },
    events: [
      { ts: "2026-01-01T01:00:00.000Z", type: "sentry-checkpoint", data: { intervention: "continue", tripped: false } },
      { ts: "2026-01-01T02:00:00.000Z", type: "sentry-checkpoint", data: { intervention: "abort", tripped: true } },
    ],
    files: {
      "DEMO-7/merge-record.json": { pr: 4242, head_sha: "1111111111111111111111111111111111111111" },
      "sibling-baseline.json": [],
    },
    config: "slots:\n  methodology: example-methodology\n",
  });
  const facts = {
    format: 2,
    tracker: { titles: { "DEMO-7": "Render the demo widget" }, sibling_end_states: {}, superseded_delivered: {} },
    run: { waves: 2, verdicts: { fire_and_forget: 1, likely_fire: 0, routed_out: {} }, park_records: [], follow_ups: [] },
  };
  const factsPath = join(fx.root, "summary-facts.json");
  writeFileSync(factsPath, JSON.stringify(facts, null, 2));
  return { ...fx, factsPath };
}

// The forge the reference fixture sees: DEMO-7's PR merged at the recorded head.
export function referenceGh(args) {
  if (args[0] === "pr" && args[1] === "view" && args[2] === "4242") return { ok: true, data: { state: "MERGED", headRefOid: "1111111111111111111111111111111111111111" }, stderr: "" };
  return { ok: false, data: null, stderr: "no stub for " + args.join(" ") };
}
