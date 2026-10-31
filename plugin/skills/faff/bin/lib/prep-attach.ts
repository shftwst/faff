// === region:factory — prep-attach — FAFF-1406: prep stages, confirms and parks its spec attach through one command ===
// `faff prep attach` replaces the stamp, tier, marker and readiness ritual faff-prep used to perform in
// prose. Stage writes the `.faff/prep/<ISSUE>.json` attach-state marker before any step that can fail,
// stamps the spec under its H1, writes the `build-tier:` line, runs the spec-readiness fold, and either
// hands back the stamped file to post (tracker mode) or writes the git-only store and closes the marker.
// Confirm closes the marker after the agent's tracker post, and only while the staged file still hashes
// to the staged digest. Park records `disposition: "parked"`. Each call prints one typed token. The
// command never touches the tracker, makes an LLM call, or consults a decision kernel.
// ===========================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseArgs, usageError } = require("./argv");
const { findRoot, dig } = require("./shared-infra");
const { loadConfig, DEFAULTS } = require("./config-core");
const { extractSpecFeatures, tier, DEFAULT_PREP_PARAMS } = require("./tier");
const { computeSpecReadiness } = require("./contract-defs-review");
const { resolveFaffVersion } = require("./faff-version");
const { harnessIdentify } = require("./harness");
const { admissibleVerdict, dodClassify, parseScenarios } = require("./admissibility");

// The typed token one call prints, plus whatever the token carries.
type PrepExtras = {
  reason?: string; violations?: string[]; body_path?: string; spec_sha256?: string; confidence?: string; build_tier?: string;
  admissibility?: Admissibility; admissibility_line?: string;
};
// FAFF-1443: the lights-out admissibility result stage records on every ready-to-post or attached spec.
// Exactly these three keys, with these types, on every path, so a consumer can refuse on
// `admissible !== true` without a null guard.
type Admissibility = { admissible: boolean; reasons: string[]; scenarios_prose: string[] };
// The verdict and classify functions stage uses; tests substitute a throwing classify for the fault path.
type AdmissibilityImpl = {
  verdict(text: string): unknown; classify(text: string): unknown; countScenarios(text: string): unknown;
};
type PrepResult = { issue: string; token: string } & PrepExtras;

type Owner = { session_id?: string; run_dir?: string; pid?: number };
type StageMarker = {
  issue: string; spec_produced: true; attached: boolean; mode: string; ts: string; owner: Owner;
  harness: string; model: string; faff_version: string;
  spec_sha256?: string; body_path?: string; attached_at?: string; admissibility?: Admissibility;
};
// A marker as read back from disk: any JSON object carrying `spec_produced: true`.
type StoredMarker = { [k: string]: unknown };

const isRecord = (v: unknown): v is StoredMarker => typeof v === "object" && v !== null && !Array.isArray(v);

// `v[k]` for a value of unknown shape, with JavaScript's own semantics: a primitive reads through its
// wrapper, and null or undefined throws the TypeError the plain property read would.
function prop(v: unknown, k: string): unknown {
  if (v === null || v === undefined) throw new TypeError(`Cannot read properties of ${v} (reading '${k}')`);
  return Reflect.get(Object(v), k);
}

type PrepDeps = {
  readText(p: string): string;
  readBytes(p: string): Buffer;
  writeText(p: string, t: string): void;
  writeTextAtomic(p: string, t: string): void;
  readJson(p: string): unknown;
  writeJsonAtomic(p: string, obj: unknown): void;
  identity(): { harness: string; model: string };
  version(): string;
  config(): { producer: string; tracker: string };
  today(): string;
  now(): string;
  env: { [k: string]: string | undefined };
  pid: number;
  admissibility?: AdmissibilityImpl;
};

type StageOpts = {
  issue: string; specPath: string; mode: string; gitOnly: boolean; gateHistory: number | null;
  extractionPath: string | null; root: string;
};

const ISSUE_RE = /^[A-Za-z][A-Za-z0-9]*-[0-9]+$/;
const TOKENS = ["ready-to-post", "attached", "invalid", "needs-judgement", "parked", "errored"];
const CONFIDENCE = ["high", "medium", "low"];
const READINESS_INFO = "faff-contract:spec-readiness";
const TRACKER_NAMES: { [k: string]: string } = { linear: "Linear", github: "GitHub", jira: "Jira" };

const ATTACH_SPEC = {
  flags: {
    "--issue": { arity: 1 }, "--spec": { arity: 1 }, "--mode": { arity: 1 }, "--git-only": { arity: 0 },
    "--gate-history": { arity: 1 }, "--extraction": { arity: 1 }, "--confirm": { arity: 0 },
    "--comment-id": { arity: 1 }, "--park": { arity: 0 }, "--root": { arity: 1 }, "--json": { arity: 0 },
  },
  positionals: { min: 0, max: 0 },
};
const ATTACH_USAGE = [
  "usage: faff prep attach --issue ID --spec FILE --mode interactive|autonomous [--git-only] [--gate-history N] [--extraction FILE] [--root DIR] [--json]",
  "       faff prep attach --issue ID --confirm --comment-id ID [--root DIR] [--json]",
  "       faff prep attach --issue ID --park [--root DIR] [--json]",
].join("\n");

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------
const sha256 = (buf: string | Buffer): string => crypto.createHash("sha256").update(buf).digest("hex");
const result = (issue: string, token: string, extra?: PrepExtras): PrepResult => ({ issue, token, ...extra });
const errored = (issue: string, reason: string, extra?: PrepExtras): PrepResult => result(issue, "errored", { reason, ...extra });

// For each line, whether it sits inside (or opens or closes) a fenced code block.
function fenceMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: string | null = null;
  lines.forEach((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const fence = m ? m[1] : undefined; // both groups always participate in a match
    const info = m ? m[2] : undefined;
    if (open) {
      mask[i] = true;
      if (fence !== undefined && fence[0] === open[0] && fence.length >= open.length && (info ?? "").trim() === "") open = null;
    } else if (fence !== undefined) {
      mask[i] = true;
      open = fence;
    }
  });
  return mask;
}

// Index of the last standalone `confidence:` line outside fences, or -1.
function confidenceLineIndex(lines: string[], mask: boolean[]): number {
  let idx = -1;
  lines.forEach((line, i) => { if (!mask[i] && /^confidence:\s*\S+\s*$/i.test(line)) idx = i; });
  return idx;
}

// The stamp's confidence token: exactly high, medium or low (lowercased), else "unknown".
function stampConfidence(text: string): string {
  const lines = text.split("\n");
  const i = confidenceLineIndex(lines, fenceMask(lines));
  const found = i < 0 ? undefined : lines[i];
  if (found === undefined) return "unknown";
  const tok = found.replace(/^confidence:\s*/i, "").trim().toLowerCase();
  return CONFIDENCE.includes(tok) ? tok : "unknown";
}

function trackerName(raw: unknown): string {
  const v = String(raw == null ? "" : raw).trim();
  if (!v) return "";
  return TRACKER_NAMES[v.toLowerCase()] || v.charAt(0).toUpperCase() + v.slice(1);
}

function stampLine({ producer, date, mode, harness, model, version, confidence, tracker, issue, gitOnly }: {
  producer: string; date: string; mode: string; harness: string; model: string; version: string;
  confidence: string; tracker: string; issue: string; gitOnly: boolean;
}): string {
  const tail = gitOnly ? "" : ` Full spec on ${tracker} ${issue}.`;
  return `> Spec: ${producer} · ${date} · ${mode} · ${harness}/${model} · faff ${version} · confidence: ${confidence}.${tail}`;
}

// Insert or replace the stamp directly under the H1. Returns null when there is no H1 outside fences.
function applyStamp(text: string, line: string): string | null {
  const lines = text.split("\n");
  const mask = fenceMask(lines);
  const h1 = lines.findIndex((l, i) => !mask[i] && /^# /.test(l));
  if (h1 < 0) return null;
  let next = h1 + 1;
  while (next < lines.length && (lines[next] ?? "").trim() === "") next++;
  if (next < lines.length && !mask[next] && (lines[next] ?? "").startsWith("> Spec:")) lines[next] = line;
  else lines.splice(h1 + 1, 0, "", line);
  return lines.join("\n");
}

// Remove every `build-tier:` line outside fences, insert one after the standalone confidence line (else
// after the stamp), and fill it with the tier computed over that very text. The value changes no feature
// `extractSpecFeatures` reads, so `faff tier` on the written file prints the same value.
function applyTier(text: string, gateHistory: number | null): { text: string; tier: string } {
  let lines = text.split("\n");
  let mask = fenceMask(lines);
  lines = lines.filter((l, i) => mask[i] || !/^build-tier:/.test(l));
  mask = fenceMask(lines);
  let at = confidenceLineIndex(lines, mask);
  if (at < 0) at = lines.findIndex((l, i) => !mask[i] && l.startsWith("> Spec:"));
  lines.splice(at + 1, 0, "build-tier: mechanical");
  const draft = lines.join("\n");
  const features = extractSpecFeatures(draft);
  if (gateHistory != null) features.gate_history = gateHistory;
  const t: string = tier(features, DEFAULT_PREP_PARAMS);
  lines[at + 1] = `build-tier: ${t}`;
  return { text: lines.join("\n"), tier: t };
}

// FAFF-1443: the advisory lights-out admissibility result over `text`, and the value of its retained
// line. The line carries only fixed vocabulary (the verdict word, failing check ids and `scenarios:<n>`
// unit ids), never spec text, so a spec cannot forge a verdict inside it. Any fault reads refused-shaped:
// `admissible: false` and the `unknown` line. It never changes a stage token.
const ADMISSIBILITY_LINE_CAP = 300;
const DEFAULT_ADMISSIBILITY: AdmissibilityImpl = {
  verdict: (text) => admissibleVerdict(text, true),
  classify: (text) => dodClassify(text),
  countScenarios: (text) => parseScenarios(text),
};

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function computeAdmissibility(text: string, impl: AdmissibilityImpl): { admissibility: Admissibility; line: string } {
  try {
    const verdict = impl.verdict(text);
    const classified = impl.classify(text);
    const admissible = prop(verdict, "admissible");
    const reasons = prop(verdict, "reasons");
    const checks = prop(verdict, "checks");
    const criteria = prop(classified, "criteria");
    if (typeof admissible !== "boolean" || !isStringArray(reasons) || !Array.isArray(checks) || !Array.isArray(criteria)) {
      throw new Error("admissibility verdict or classification has an unexpected shape");
    }
    const units = criteria.filter((c) => prop(c, "source") === "scenarios");
    const prose: string[] = [];
    for (const c of units) {
      if (prop(c, "class") !== "prose") continue;
      const id = prop(c, "id");
      if (typeof id !== "string") throw new Error("a Scenarios unit has no id");
      prose.push(id);
    }
    const proseTail = prose.length ? `prose scenarios: ${prose.join(", ")}` : "";
    let line: string;
    if (admissible) line = proseTail ? `admissible — ${proseTail}` : "admissible";
    else {
      const failing: string[] = [];
      for (const c of checks) {
        if (prop(c, "pass") === true) continue;
        const id = prop(c, "id");
        if (typeof id !== "string") throw new Error("an admissibility check has no id");
        if (id !== "R1.scenarios") { failing.push(id); continue; }
        const k = impl.countScenarios(text);
        if (typeof k !== "number") throw new Error("the scenario count is not a number");
        failing.push(units.length === 0 ? "R1.scenarios (no Scenarios units)" : `R1.scenarios (${k} of ${units.length} units count)`);
      }
      if (failing.length === 0) failing.push("unparseable");
      line = `refused — ${failing.join(", ")}${proseTail ? `; ${proseTail}` : ""}`;
    }
    return { admissibility: { admissible, reasons: [...reasons], scenarios_prose: prose }, line };
  } catch (e) {
    const message = e && typeof prop(e, "message") === "string" ? prop(e, "message") : String(e);
    return {
      admissibility: { admissible: false, reasons: [`admissibility check failed: ${message}`], scenarios_prose: [] },
      line: "unknown — check failed",
    };
  }
}

// Remove every `admissibility:` line outside fences (a line-start match, so prose or a DONE item that
// merely contains the word is untouched), compute the result over the remaining text, and insert one
// line directly after the `build-tier:` line, capped at ADMISSIBILITY_LINE_CAP characters.
function applyAdmissibility(text: string, impl: AdmissibilityImpl = DEFAULT_ADMISSIBILITY): { text: string; admissibility: Admissibility; line: string } {
  let lines = text.split("\n");
  let mask = fenceMask(lines);
  lines = lines.filter((l, i) => mask[i] || !/^admissibility:/.test(l));
  const { admissibility, line } = computeAdmissibility(lines.join("\n"), impl);
  let full = `admissibility: ${line}`;
  if (full.length > ADMISSIBILITY_LINE_CAP) full = `${full.slice(0, ADMISSIBILITY_LINE_CAP - 1)}…`;
  mask = fenceMask(lines);
  let at = lines.findIndex((l, i) => !mask[i] && /^build-tier:/.test(l));
  if (at < 0) at = lines.findIndex((l, i) => !mask[i] && l.startsWith("> Spec:"));
  lines.splice(at + 1, 0, full);
  return { text: lines.join("\n"), admissibility, line: full.slice("admissibility: ".length) };
}

// The bodies of every `faff-contract:spec-readiness` fence outside other fences.
function readinessBlocks(text: string): string[] {
  const lines = text.split("\n");
  const blocks: string[] = [];
  let open: string | null = null;
  let body: string[] | null = null;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const fence = m ? m[1] : undefined; // both groups always participate in a match
    const info = m ? m[2] : undefined;
    if (open) {
      if (fence !== undefined && fence[0] === open[0] && fence.length >= open.length && (info ?? "").trim() === "") {
        if (body) blocks.push(body.join("\n"));
        open = null; body = null;
      } else if (body) body.push(line);
    } else if (fence !== undefined) {
      open = fence;
      body = (info ?? "").trim() === READINESS_INFO ? [] : null;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Procedures over injected dependencies.
// ---------------------------------------------------------------------------
const markerPath = (root: string, issue: string): string => path.join(root, ".faff", "prep", `${issue}.json`);

function stage(opts: StageOpts, deps: PrepDeps): PrepResult {
  const { issue, specPath, mode, gitOnly, gateHistory, extractionPath, root } = opts;
  let source: string;
  try { source = deps.readText(specPath); } catch (e) { return errored(issue, `spec-unreadable: ${prop(e, "code") || prop(e, "message")}`); }

  const mp = markerPath(root, issue);
  const existing = deps.readJson(mp);
  if (gitOnly && existing && prop(existing, "disposition") === "parked") return result(issue, "needs-judgement", { reason: "git-only-marker-parked" });

  const id = deps.identity();
  const version = deps.version();
  const owner: Owner = {};
  if (deps.env.FAFF_SESSION_ID) owner.session_id = deps.env.FAFF_SESSION_ID;
  if (deps.env.FAFF_RUN_DIR) owner.run_dir = deps.env.FAFF_RUN_DIR;
  owner.pid = deps.pid;
  const marker: StageMarker = {
    issue, spec_produced: true, attached: false, mode: gitOnly ? "git-only" : "tracker", ts: deps.now(),
    owner, harness: id.harness, model: id.model, faff_version: version,
  };
  try { deps.writeJsonAtomic(mp, marker); } catch (e) { return errored(issue, `marker-unwritable: ${prop(e, "code") || prop(e, "message")}`); }

  let cfg: { producer: string; tracker: string };
  try { cfg = deps.config(); } catch (e) { return errored(issue, `config-unreadable: ${prop(e, "message")}`); }
  const confidence = stampConfidence(source);
  const line = stampLine({
    producer: cfg.producer, date: deps.today(), mode, harness: id.harness, model: id.model, version,
    confidence, tracker: cfg.tracker, issue, gitOnly,
  });
  const stamped = applyStamp(source, line);
  if (stamped === null) return result(issue, "invalid", { reason: "no-h1", confidence });
  // Tier, then the admissibility line, then tier again over the final line count: the line adds one line
  // and `spec_lines` is a tier feature, so the recorded tier is the one `faff tier` prints on the file.
  const adm = applyAdmissibility(applyTier(stamped, gateHistory).text, deps.admissibility || DEFAULT_ADMISSIBILITY);
  const tiered = applyTier(adm.text, gateHistory);
  const text = tiered.text;
  const common = { confidence, build_tier: tiered.tier };
  const success = { ...common, admissibility: adm.admissibility, admissibility_line: adm.line };
  const writeBack = (): void => deps.writeText(specPath, text);

  let extraction: unknown;
  const blocks = readinessBlocks(text);
  if (blocks.length > 1) return errored(issue, "multiple-readiness-blocks", common);
  if (extractionPath) {
    try { extraction = JSON.parse(deps.readText(extractionPath)); } catch { return errored(issue, "extraction-unparseable", common); }
  } else {
    if (blocks.length === 0) {
      try { writeBack(); } catch (e) { return errored(issue, `spec-unwritable: ${prop(e, "code") || prop(e, "message")}`, common); }
      return result(issue, "needs-judgement", { reason: "no-readiness-block", ...common });
    }
    try { extraction = JSON.parse(blocks[0] ?? ""); } catch { return errored(issue, "readiness-block-unparseable", common); }
  }
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) return errored(issue, "readiness-extraction-not-an-object", common);
  const fold = computeSpecReadiness({ ...extraction, provenance_present: /^> Spec:/m.test(text) });
  if (fold.failLoud) return errored(issue, `readiness-fail-loud: ${fold.failLoud}`, common);
  const violations: string[] = [...fold.contractData.violations];
  if (confidence === "unknown") violations.push("confidence line missing or not one of high, medium, low");
  if (violations.length) {
    try { writeBack(); } catch (e) { return errored(issue, `spec-unwritable: ${prop(e, "code") || prop(e, "message")}`, common); }
    return result(issue, "invalid", { violations, ...common });
  }

  try { writeBack(); } catch (e) { return errored(issue, `spec-unwritable: ${prop(e, "code") || prop(e, "message")}`, common); }
  const digest = sha256(Buffer.from(text, "utf8"));
  const bodyPath = path.resolve(specPath);
  marker.spec_sha256 = digest;
  marker.body_path = bodyPath;
  marker.admissibility = adm.admissibility;
  if (gitOnly) {
    try { deps.writeTextAtomic(path.join(root, ".faff", "specs", `${issue}.md`), text); } catch (e) { return errored(issue, `store-unwritable: ${prop(e, "code") || prop(e, "message")}`, common); }
    marker.attached = true;
    marker.attached_at = deps.now();
  }
  try { deps.writeJsonAtomic(mp, marker); } catch (e) { return errored(issue, `marker-unwritable: ${prop(e, "code") || prop(e, "message")}`, common); }
  if (gitOnly) return result(issue, "attached", { spec_sha256: digest, ...success });
  return result(issue, "ready-to-post", { body_path: bodyPath, spec_sha256: digest, ...success });
}

function readStagedMarker(root: string, issue: string, deps: PrepDeps): StoredMarker | null {
  const m = deps.readJson(markerPath(root, issue));
  return isRecord(m) && m.spec_produced === true ? m : null;
}

function confirm(opts: { issue: string; commentId: string; root: string }, deps: PrepDeps): PrepResult {
  const { issue, commentId, root } = opts;
  const m = readStagedMarker(root, issue, deps);
  if (!m) return errored(issue, "no-staged-spec");
  let body: Buffer | null;
  try { body = typeof m.body_path === "string" ? deps.readBytes(m.body_path) : null; } catch { body = null; }
  if (!body || typeof m.spec_sha256 !== "string" || sha256(body) !== m.spec_sha256) return errored(issue, "spec-changed-since-stage");
  const next = { ...m, attached: true, comment_id: commentId, attached_at: deps.now() };
  try { deps.writeJsonAtomic(markerPath(root, issue), next); } catch (e) { return errored(issue, `marker-unwritable: ${prop(e, "code") || prop(e, "message")}`); }
  return result(issue, "attached", { spec_sha256: m.spec_sha256 });
}

function park(opts: { issue: string; root: string }, deps: PrepDeps): PrepResult {
  const { issue, root } = opts;
  const m = readStagedMarker(root, issue, deps);
  if (!m) return errored(issue, "no-staged-spec");
  try { deps.writeJsonAtomic(markerPath(root, issue), { ...m, disposition: "parked" }); } catch (e) { return errored(issue, `marker-unwritable: ${prop(e, "code") || prop(e, "message")}`); }
  return result(issue, "parked");
}

// ---------------------------------------------------------------------------
// Impure shell: the real dependencies. Tests substitute fakes.
// ---------------------------------------------------------------------------
function atomicWrite(p: string, data: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, p);
}

function defaultDeps(root: string): PrepDeps {
  return {
    readText: (p) => fs.readFileSync(p, "utf8"),
    readBytes: (p) => fs.readFileSync(p),
    writeText: (p, t) => fs.writeFileSync(p, t),
    writeTextAtomic: (p, t) => atomicWrite(p, t),
    readJson: (p): unknown => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } },
    writeJsonAtomic: (p, obj) => atomicWrite(p, JSON.stringify(obj) + "\n"),
    identity: () => { try { const id = harnessIdentify({ root }); return { harness: id.harness || "unknown", model: id.model || "unknown" }; } catch { return { harness: "unknown", model: "unknown" }; } },
    version: () => { try { return resolveFaffVersion().version || "unknown"; } catch { return "unknown"; } },
    config: () => {
      const [data] = loadConfig(root);
      return { producer: dig(data, "slots.spec") || DEFAULTS["slots.spec"], tracker: trackerName(dig(data, "tracking.tracker")) };
    },
    today: () => { const d = new Date(); const p = (n: number): string => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; },
    now: () => new Date().toISOString(),
    env: process.env,
    pid: process.pid,
  };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------
// `admissibility_line` is the text-mode detail only; the JSON result carries the `admissibility` object.
function emit(res: PrepResult, json: boolean): void {
  const { admissibility_line: admissibilityLine, ...shown } = res;
  if (json) { console.log(JSON.stringify(shown)); return; }
  const bits = [
    res.body_path && `post ${res.body_path}`, res.violations && res.violations.join("; "),
    admissibilityLine && `admissibility: ${admissibilityLine}`,
  ].filter(Boolean);
  console.log(`prep attach ${res.issue}: ${res.token}${res.reason ? `:${res.reason}` : ""}${bits.length ? ` (${bits.join("; ")})` : ""}`);
}

function cmdPrep(args: string[], depsOverride?: PrepDeps): number {
  if (args[0] !== "attach") return usageError([{ code: "bad-value", detail: "expected the verb attach" }], ATTACH_USAGE);
  const { values, errors } = parseArgs(args.slice(1), ATTACH_SPEC);
  if (errors.length) return usageError(errors, ATTACH_USAGE);
  const bad = (detail: string, flag?: string): number => usageError([{ code: "bad-value", flag, detail }], ATTACH_USAGE);
  const issue: string | undefined = values["--issue"];
  if (!issue) return usageError([{ code: "missing-value", detail: "--issue required" }], ATTACH_USAGE);
  if (!ISSUE_RE.test(issue)) return bad(`--issue must match ${ISSUE_RE.source}`, "--issue");
  const modes = ["--spec", "--confirm", "--park"].filter((f) => values[f] !== undefined);
  if (modes.length !== 1) return bad("exactly one of --spec, --confirm and --park is required");
  const stageOnly = ["--mode", "--git-only", "--gate-history", "--extraction"].filter((f) => values[f] !== undefined);
  if (modes[0] !== "--spec" && stageOnly.length) return bad(`${stageOnly.join(", ")} only apply with --spec`);
  if (modes[0] !== "--confirm" && values["--comment-id"] !== undefined) return bad("--comment-id only applies with --confirm", "--comment-id");

  let gateHistory: number | null = null;
  if (modes[0] === "--spec") {
    if (values["--mode"] !== "interactive" && values["--mode"] !== "autonomous") return bad("--mode must be interactive or autonomous", "--mode");
    if (values["--gate-history"] !== undefined) {
      if (!/^[0-9]+$/.test(values["--gate-history"])) return bad("--gate-history must be a non-negative integer", "--gate-history");
      gateHistory = Number(values["--gate-history"]);
    }
  }
  if (modes[0] === "--confirm" && !values["--comment-id"]) return usageError([{ code: "missing-value", flag: "--comment-id", detail: "--confirm requires --comment-id" }], ATTACH_USAGE);

  const root = path.resolve(values["--root"] || findRoot());
  const deps = depsOverride || defaultDeps(root);
  let res: PrepResult;
  try {
    if (modes[0] === "--spec") {
      res = stage({ issue, specPath: values["--spec"], mode: values["--mode"], gitOnly: !!values["--git-only"], gateHistory, extractionPath: values["--extraction"] || null, root }, deps);
    } else if (modes[0] === "--confirm") res = confirm({ issue, commentId: values["--comment-id"], root }, deps);
    else res = park({ issue, root }, deps);
  } catch (e) { res = errored(issue, `unexpected: ${e && prop(e, "message") ? prop(e, "message") : e}`); }
  emit(res, !!values["--json"]);
  return res.token === "errored" ? 2 : 0;
}

module.exports = {
  ISSUE_RE, TOKENS, fenceMask, stampConfidence, trackerName, stampLine, applyStamp, applyTier, applyAdmissibility, readinessBlocks,
  markerPath, stage, confirm, park, defaultDeps, cmdPrep,
};
