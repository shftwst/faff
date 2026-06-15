// FAFF-130/FAFF-132/FAFF-133/FAFF-134 — the CLI eval driver: drives faff-tidy's judgement pass via
// `claude -p` headless, with per-run CLAUDE_CONFIG_DIR isolation so a rep never writes the parent
// session's ~/.claude.json (ADR 0003 infra finding). Returns raw stdout for envelope parse.
//
// Two presets over ONE code path (FAFF-132):
//   - frontier: `claude -p` against api.anthropic.com (the default).
//   - local:    the SAME `claude -p` invocation with ollama's Anthropic-Messages-API env
//               redirect (ANTHROPIC_BASE_URL=<ollama host>, AUTH_TOKEN=ollama, API_KEY="")
//               + --model. No new transport — ollama speaks the Anthropic API natively.
//
// FAFF-133 — load the REAL skills into the isolated run. The empty CLAUDE_CONFIG_DIR gave the
// spawned `claude` NO faff skills, so the eval measured an improvised vanilla-model judgement, not
// the shipped faff-tidy prose. Both presets now default to `--bare --plugin-dir <repo>/plugin`:
//   - --plugin-dir loads the repo's OWN plugin (skills as shipped in the commit under test,
//     namespaced /faff:faff-tidy) — the only way to load a local plugin; project .claude/skills is
//     NOT auto-loaded in -p mode, and no settings.json key exists for it.
//   - --bare skips hooks / CLAUDE.md / plugin-sync but still resolves --plugin-dir skills, keeping
//     the run clean + host-independent (and stops the repo Stop-hook firing inside the nested run).
// Pass pluginDir: null for a vanilla (skill-less) baseline.
//
// FAFF-134 — loading the plugin didn't change the measurement on its own: the prompt never invoked
// the skill, so the model improvised the rubric (smoke scored dupe 1.00 skill-less). The prompt now
// carries faff-tidy's REAL classification rubric, read verbatim from the same pluginDir's SKILL.md
// (loadTidyJudgementProse). pluginDir null still = the improvise baseline (the control).
//
// ⚠ NOT exercised in CI — eval/ is excluded from the `node --test` globs. Running a driver for
// real (~240 reps) is FAFF-131's human-supervised job. The orchestrator (run-evals.mjs) takes
// the driver as an argument, so tests inject a mock and never reach a real spawn. `buildInvocation`
// (and the *Opts factories) are PURE (no spawn/fs/clock), so a test may import this module to
// assert wiring with zero I/O.
//
// Zero-dependency: node builtins only.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// FAFF-138 — the isolated CLAUDE_CONFIG_DIR (ADR-0003) also strips the OAuth credential file, so a
// frontier `claude -p` lands "Not logged in". Forward ONLY the credential file into the per-rep
// cfgDir (mutable state stays isolated). Frontier-only: the local lane points at the ollama host, so
// it must NOT copy the real Anthropic credential to a third-party endpoint (forwardCreds: false).
// Best-effort: a missing creds file (e.g. ANTHROPIC_API_KEY env auth) is fine — leave it.
const CREDENTIALS_FILE = ".credentials.json";
export function forwardCredentials(cfgDir, { forwardCreds, credentialsSource } = {}, { copyFile = copyFileSync, chmod = chmodSync, env = process.env } = {}) {
  if (!forwardCreds) return null;
  const src = join(credentialsSource ?? env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), CREDENTIALS_FILE);
  const dst = join(cfgDir, CREDENTIALS_FILE);
  try {
    copyFile(src, dst);
    chmod(dst, 0o600); // copyFileSync doesn't preserve mode — lock the copy to owner-only (the cfgDir is already 0700)
    return dst;
  } catch {
    return null; // best-effort — no creds file to forward (API-key env auth still works)
  }
}

// The repo's own plugin (FAFF-121 relocated it to ./plugin). cli-driver.mjs lives in eval/, so the
// repo root is one level up. Using the repo plugin — not the host's installed copy — makes the eval
// measure the skills AS SHIPPED in the commit under test (reproducible).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PLUGIN_DIR = join(REPO_ROOT, "plugin");

// FAFF-134 — the eval prompt carries faff-tidy's REAL classification rubric (verbatim from the
// shipped SKILL.md) so the model applies it instead of improvising one. The rubric is section "1. The
// mess" of faff-tidy/SKILL.md (dupe / vague / spec-health stale/superseded). Anchored on stable
// section headers; fail-loud if either moves (a refactor must consciously re-point this).
const TIDY_RUBRIC_START = "### 1. The mess (needs action)";
const TIDY_RUBRIC_END = "### 2. Ready to pick up";

// Read faff-tidy's classification rubric verbatim from the plugin under test. Returns the section
// text (incl. its START header). Throws (fail-loud) if the skill file or anchors are missing.
export function loadTidyJudgementProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-tidy", "SKILL.md");
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`loadTidyJudgementProse: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(TIDY_RUBRIC_START);
  if (start === -1) throw new Error(`loadTidyJudgementProse: START anchor not found in ${skillPath}: "${TIDY_RUBRIC_START}"`);
  const end = md.indexOf(TIDY_RUBRIC_END, start + TIDY_RUBRIC_START.length);
  if (end === -1) throw new Error(`loadTidyJudgementProse: END anchor not found in ${skillPath}: "${TIDY_RUBRIC_END}"`);
  return md.slice(start, end).trim();
}

// FAFF-140 — the eval prompt also carries faff's SYNTHESIS-GLOSS contract (verbatim from the shipped
// rendering adaptor). FAFF-134 injected only the classification section, so a `gloss` case had no
// criteria and the model improvised a health-summary instead of a one-line synthesis. Anchored on
// stable section headers in faffidavit-rendering/SKILL.md; fail-loud if either moves.
const SYNTH_GLOSS_START = "## Synthesis — the issue-gloss contract";
const SYNTH_GLOSS_END = "## Tabular data: markdown tables vs definition lists";
export function loadSynthesisGlossProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faffidavit-rendering", "SKILL.md");
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`loadSynthesisGlossProse: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(SYNTH_GLOSS_START);
  if (start === -1) throw new Error(`loadSynthesisGlossProse: START anchor not found in ${skillPath}: "${SYNTH_GLOSS_START}"`);
  const end = md.indexOf(SYNTH_GLOSS_END, start + SYNTH_GLOSS_START.length);
  if (end === -1) throw new Error(`loadSynthesisGlossProse: END anchor not found in ${skillPath}: "${SYNTH_GLOSS_END}"`);
  return md.slice(start, end).trim();
}

// FAFF-140 — the full judgement criteria the eval measures, verbatim from the shipped skills:
// classification (faff-tidy "The mess") + the synthesis-gloss contract (faffidavit-rendering).
export function loadJudgementCriteria(pluginDir = DEFAULT_PLUGIN_DIR) {
  return `${loadTidyJudgementProse(pluginDir)}\n\n${loadSynthesisGlossProse(pluginDir)}`;
}

// Exported (FAFF-135) so the live driver shares the single source of the envelope contract.
// FAFF-137 — output-ONLY hardening: reasoning models (e.g. qwen3.6) otherwise emit a long reasoning
// preamble in the content before the block, which dominates wall time and risks a num_predict cap
// truncating the block away. Force-fit terseness via the instruction (the answer stays intact); the
// "exactly that tag, not ```json" line also lifts format-adherence (FAFF-137 classify-fallback).
export const EVAL_MODE_INSTRUCTION =
  "Run faff-tidy's judgement pass over this fixture internally, then OUTPUT ONLY one fenced code " +
  "block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "classifications": { "dupe": [..], "vague": [..], "stale": [..], "superseded": [..] }, ' +
  '"ordering": ["<issue-id>", ..], "gloss": { "<issue-id>": "<one-line gloss>" } } — include only the fields your ' +
  "judgement produced, using the fixture's issue ids. Output NOTHING except that single block: no reasoning, " +
  "no preamble, no prose, nothing before or after it.";

// `judgementProse` (when present) is faff's verbatim judgement criteria — classification (faff-tidy)
// + the synthesis-gloss contract (FAFF-140) — prepended so the model applies the shipped rules.
// Absent (the --no-plugin baseline) → the bare improvise-it prompt (the control).
function renderFixturePrompt(c, judgementProse = null) {
  const rubric = judgementProse
    ? `Apply faff's judgement + synthesis criteria below — these are the skills' own rules, verbatim:\n\n${judgementProse}\n\n---\n\n`
    : "";
  return (
    `${rubric}Run faff-tidy's judgement pass on the following backlog fixture and answer: ${c.question}\n\n` +
    `Fixture (FAFF-89 tracker shape):\n${JSON.stringify(c.fixture, null, 2)}`
  );
}

// Rough token proxy for the spike's cost column; FAFF-131 can replace with claude -p's reported usage.
export const estimateTokens = (s) => Math.ceil(String(s ?? "").length / 4);

// FAFF-144 — the full eval prompt for a case (criteria + fixture + the envelope instruction),
// factored out of makeCliDriver so any driver (claude -p OR a direct ollama POST) builds it the same.
export function buildEvalPrompt(evalCase, criteria = null) {
  return `${renderFixturePrompt(evalCase, criteria)}\n\n${EVAL_MODE_INSTRUCTION.replace("<ID>", evalCase.id)}`;
}

// PURE: resolve the exact { bin, args, env } to spawn. No spawn, no fs, no clock — so a test can
// import this and assert preset wiring (--model / --bare / --plugin-dir / ollama env) with zero I/O.
export function buildInvocation(opts, prompt, cfgDir) {
  const { bin = "claude", model = null, env = {}, bare = false, pluginDir = null } = opts ?? {};
  const args = [
    "-p",
    prompt,
    ...(model ? ["--model", model] : []),
    ...(bare ? ["--bare"] : []),
    ...(pluginDir ? ["--plugin-dir", pluginDir] : []),
  ];
  return { bin, args, env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: cfgDir } };
}

// Generic factory. opts: { bin, model, baseUrl, env, bare, pluginDir }. The closure spawns;
// importing this does not.
export function makeCliDriver(opts = {}) {
  // FAFF-134/FAFF-140: load faff's judgement criteria once (classification + synthesis gloss) from
  // the same pluginDir the run loads skills from. pluginDir null (the --no-plugin baseline) → no
  // criteria → the model improvises (the control).
  const judgementProse = opts.pluginDir ? loadJudgementCriteria(opts.pluginDir) : null;
  return async function cliDriver(evalCase, repIndex) {
    const cfgDir = mkdtempSync(join(tmpdir(), `faff-eval-${evalCase.id}-${repIndex}-`));
    try {
      forwardCredentials(cfgDir, opts); // FAFF-138: frontier auth survives the isolation; local skips
      const prompt = buildEvalPrompt(evalCase, judgementProse);
      const inv = buildInvocation(opts, prompt, cfgDir);
      const res = spawnSync(inv.bin, inv.args, {
        env: inv.env, // isolation (CLAUDE_CONFIG_DIR) + any preset redirect — no parent ~/.claude.json write
        cwd: cfgDir, // FAFF-138: clean cwd → no project CLAUDE.md/hooks pulled in (replaces --bare's isolation)
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      if (res.error) throw new Error(`cli driver (${inv.bin}): ${res.error.message}`);
      // rawText is captured (a string) — the cfgDir is no longer needed; the malformed-output snippet
      // (recorded by run-evals on an envelope error) is the errored-rep diagnostic, not the cfgDir.
      return { rawText: res.stdout ?? "", tokens: estimateTokens(res.stdout) };
    } finally {
      // FAFF-139: remove the per-rep cfgDir (+ its forwarded credential copy) — never leave 200+
      // dirs with OAuth creds in tmp. Best-effort; runs on success AND on throw.
      try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  };
}

// PURE opts resolvers (separated from the spawning factory so the preset defaults — including the
// repo plugin + --bare — are unit-testable without spawning).

// Preset: frontier — `claude -p` against the Anthropic API. Loads the repo skills by default
// (FAFF-133); pass pluginDir: null for a vanilla skill-less baseline. forwardCreds: true (FAFF-138)
// so the real OAuth credential reaches the isolated cfgDir.
// bare: false — FAFF-138: `--bare` is incompatible with OAuth-credential auth (it only honors
// env-token auth, which is why the local lane works under it). Frontier reads `.credentials.json`,
// so it must NOT pass `--bare`; isolation comes from the fresh CLAUDE_CONFIG_DIR + clean spawn cwd
// (project hooks/CLAUDE.md aren't pulled in). `--plugin-dir` alone still loads the skills.
export function frontierOpts({ bin = "claude", bare = false, pluginDir = DEFAULT_PLUGIN_DIR, forwardCreds = true } = {}) {
  return { bin, bare, pluginDir, forwardCreds };
}
export function frontierDriver(args = {}) {
  return makeCliDriver(frontierOpts(args));
}

// Preset: local — the SAME `claude -p` path with ollama's Anthropic-API env redirect + --model.
// `baseUrl` is REQUIRED — there is deliberately no localhost default (ollama is served over Tailscale).
export function localOpts({ baseUrl, model, bin = "claude", bare = true, pluginDir = DEFAULT_PLUGIN_DIR } = {}) {
  if (!baseUrl) throw new Error("localDriver requires a baseUrl (the ollama host); no localhost default");
  return {
    bin,
    model,
    baseUrl,
    bare,
    pluginDir,
    forwardCreds: false, // FAFF-138 SECURITY: never copy the real Anthropic credential to the ollama host
    env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_API_KEY: "" },
  };
}
export function localDriver(args = {}) {
  return makeCliDriver(localOpts(args));
}
