// ===========================================================================
// === region:factory — hooks-ensure — idempotently register faff's Stop-hook command set into ===
// .claude/settings.json (FAFF-192). The deterministic, repeatable replacement
// for the per-install manual settings edit. Sibling of gitignore-ensure:
// non-destructive, byte-stable no-op when present, fail-loud (exit 2) on
// malformed JSON. Never registers a hook the resolved bin can't serve — a Stop
// command that exits 2 blocks every session end. FAFF-434 extends the same
// registrar to a SECOND hook event (PreToolUse, the merge-fence) alongside the
// Stop set — see FAFF_PRE_TOOL_USE_HOOKS below.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { findRoot } = require("./shared-infra");

// FAFF-471: sentrycheck joins the Stop family as ADR-0065's cheap assist watchdog
// locus — a staleness-triggered `faff sentry check` consult on any session's
// turn-end, gated by the FAFF-205 ownership/liveness shape (never a re-derived
// predicate). planStopHooks/isPresent/normalization all generalise over this list
// already; nothing else in this registrar changes.
const FAFF_STOP_HOOKS = ["runcheck", "prepcheck", "sentrycheck"];
// FAFF-434: the PreToolUse hook set — currently just the raw-gh-pr-merge fence.
// A distinct list from FAFF_STOP_HOOKS because it registers under a different
// settings.json event array (hooks.PreToolUse, matcher-scoped to Bash) with a
// different group shape ({matcher, hooks}, not the Stop set's bare {hooks}).
const FAFF_PRE_TOOL_USE_HOOKS = ["merge-fence"];
// The full served-probe set resolveHookBin/probeServes must clear together — a
// resolved bin that can't serve every hook (Stop OR PreToolUse) is not fit to
// register any of them under the single canonical bin path.
const FAFF_ALL_HOOKS = [...FAFF_STOP_HOOKS, ...FAFF_PRE_TOOL_USE_HOOKS];

// Token identity: a Stop command "invokes faff's <sub> --hook" if, split on
// whitespace, some token's basename is `faff`, the subcommand token is present,
// and `--hook` is present. Path-agnostic, so a differently-resolved path or an
// env-prefixed invocation still counts as present — never duplicated/clobbered.
function commandInvokesFaffHook(command, sub) {
  if (typeof command !== "string") return false;
  const toks = command.trim().split(/\s+/);
  return toks.some((t) => path.basename(t) === "faff") && toks.includes(sub) && toks.includes("--hook");
}

// Every Stop-hook command string across a settings object (defensive against shape drift).
function stopCommands(settings) {
  const stop = settings && settings.hooks && settings.hooks.Stop;
  if (!Array.isArray(stop)) return [];
  const out = [];
  for (const group of stop) {
    const hooks = group && group.hooks;
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) if (h && typeof h.command === "string") out.push(h.command);
  }
  return out;
}

// FAFF-434: sibling of stopCommands for the PreToolUse event array — same
// defensive shape-drift handling, different settings.json key.
function preToolUseCommands(settings) {
  const pre = settings && settings.hooks && settings.hooks.PreToolUse;
  if (!Array.isArray(pre)) return [];
  const out = [];
  for (const group of pre) {
    const hooks = group && group.hooks;
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) if (h && typeof h.command === "string") out.push(h.command);
  }
  return out;
}

// Dispatches to whichever event's command array the given sub registers under —
// FAFF_PRE_TOOL_USE_HOOKS members read PreToolUse, everything else (the Stop set)
// reads Stop. commandInvokesFaffHook itself stays event-agnostic (token identity only).
function isPresent(sub, settings) {
  const cmds = FAFF_PRE_TOOL_USE_HOOKS.includes(sub) ? preToolUseCommands(settings) : stopCommands(settings);
  return cmds.some((c) => commandInvokesFaffHook(c, sub));
}

// Pure planner — no I/O. present/served are subcommand-name lists; binInvocation(sub)
// builds the command string to register. Mirrors gitignoreEnsure's pure-core shape.
// FAFF-200: also normalizes a PRESENT faff Stop-hook whose stored command diverges
// from the canonical binInvocation form (e.g. a hand-wired absolute-repo path) to that
// canonical form — single source of truth, idempotent (canonical → no rewrite). Presence
// detection (commandInvokesFaffHook) stays path-agnostic; this only rewrites the stored
// string of an already-present hook, so a divergent-but-equivalent path is healed.
function planStopHooks(settings, present, served, binInvocation) {
  const P = new Set(present), S = new Set(served);
  const added = FAFF_STOP_HOOKS.filter((s) => !P.has(s) && S.has(s));
  const already = FAFF_STOP_HOOKS.filter((s) => P.has(s));
  const skipped_stale = FAFF_STOP_HOOKS.filter((s) => !P.has(s) && !S.has(s));
  const next = JSON.parse(JSON.stringify(settings ?? {}));
  if (added.length) {
    if (!next.hooks || typeof next.hooks !== "object") next.hooks = {};
    if (!Array.isArray(next.hooks.Stop)) next.hooks.Stop = [];
    let group = next.hooks.Stop.find((g) => g && Array.isArray(g.hooks));
    if (!group) { group = { hooks: [] }; next.hooks.Stop.push(group); }
    for (const s of added) group.hooks.push({ type: "command", command: binInvocation(s) });
  }
  // Normalization pass over the settings being written: rewrite any present faff
  // Stop-hook command that differs from canonical. Just-added hooks are already
  // canonical, so they no-op here; a second run finds everything canonical → [].
  const normalized = [];
  const stop = next.hooks && Array.isArray(next.hooks.Stop) ? next.hooks.Stop : [];
  for (const group of stop) {
    const hooks = group && Array.isArray(group.hooks) ? group.hooks : [];
    for (const h of hooks) {
      if (!h || typeof h.command !== "string") continue;
      for (const s of FAFF_STOP_HOOKS) {
        if (commandInvokesFaffHook(h.command, s) && h.command.trim() !== binInvocation(s)) {
          h.command = binInvocation(s);
          if (!normalized.includes(s)) normalized.push(s);
        }
      }
    }
  }
  return { added, already, skipped_stale, normalized, nextSettings: next };
}

// FAFF-434: sibling of planStopHooks for the PreToolUse event — same idempotent
// add/normalize shape, targeting hooks.PreToolUse instead of hooks.Stop. The
// PreToolUse group carries a matcher ("Bash" — the fence only ever needs to see
// Bash tool_input), unlike the matcher-less Stop groups.
function planPreToolUseHooks(settings, present, served, binInvocation) {
  const P = new Set(present), S = new Set(served);
  const added = FAFF_PRE_TOOL_USE_HOOKS.filter((s) => !P.has(s) && S.has(s));
  const already = FAFF_PRE_TOOL_USE_HOOKS.filter((s) => P.has(s));
  const skipped_stale = FAFF_PRE_TOOL_USE_HOOKS.filter((s) => !P.has(s) && !S.has(s));
  const next = JSON.parse(JSON.stringify(settings ?? {}));
  if (added.length) {
    if (!next.hooks || typeof next.hooks !== "object") next.hooks = {};
    if (!Array.isArray(next.hooks.PreToolUse)) next.hooks.PreToolUse = [];
    let group = next.hooks.PreToolUse.find((g) => g && g.matcher === "Bash" && Array.isArray(g.hooks));
    if (!group) { group = { matcher: "Bash", hooks: [] }; next.hooks.PreToolUse.push(group); }
    for (const s of added) group.hooks.push({ type: "command", command: binInvocation(s) });
  }
  const normalized = [];
  const pre = next.hooks && Array.isArray(next.hooks.PreToolUse) ? next.hooks.PreToolUse : [];
  for (const group of pre) {
    const hooks = group && Array.isArray(group.hooks) ? group.hooks : [];
    for (const h of hooks) {
      if (!h || typeof h.command !== "string") continue;
      for (const s of FAFF_PRE_TOOL_USE_HOOKS) {
        if (commandInvokesFaffHook(h.command, s) && h.command.trim() !== binInvocation(s)) {
          h.command = binInvocation(s);
          if (!normalized.includes(s)) normalized.push(s);
        }
      }
    }
  }
  return { added, already, skipped_stale, normalized, nextSettings: next };
}

function readJsonOrEmpty(p) {
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8")); // throws on malformed → caller maps to exit 2
}

// First `faff` on PATH (no shell), else null.
function whichFaff() {
  for (const d of (process.env.PATH || "").split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, "faff");
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

// Does `bin` serve `<sub>`? Probe `<bin> <sub> --hook` against an empty throwaway
// root (read-only, no side effects). An un-served subcommand hits main()'s
// "unknown subcommand" path → exit 2; anything else (incl. a clean 0) counts served.
// input:"" pins stdin to an immediately-closed empty pipe — harmless for the
// positional-arg hooks (runcheck/prepcheck never read stdin) and load-bearing for
// merge-fence (FAFF-434), whose --hook reads stdin: without it, an unspecified
// stdio pipe with nothing written can leave a synchronous stdin read hanging for
// the full probe timeout instead of resolving to the empty-stdin exit-0 case.
function probeServes(bin, sub, probeRoot) {
  try {
    const r = spawnSync(bin, [sub, "--hook", "--root", probeRoot], { encoding: "utf8", timeout: 5000, input: "" });
    if (r.error) return false; // couldn't even run the bin (missing / not executable)
    // The ONLY "not served" signal is main()'s unknown-subcommand path (exit 2 + that message).
    // Anything else — including a clean exit 0 — means the bin recognises the subcommand.
    return !(r.status === 2 && /unknown subcommand/i.test(r.stderr || ""));
  } catch { return false; }
}

// Canonical hook-bin preference, most-portable first (FAFF-200 — so a normalized or
// freshly-registered hook survives a repo move instead of pinning an absolute repo path):
//   1. an on-PATH `faff` that serves the whole set (stable across worktrees);
//   2. the standard install location — `$CLAUDE_PLUGIN_ROOT/skills/faff/bin/faff` (plugin)
//      or `~/.claude/skills/faff/bin/faff` (dev-linked symlink) — when it exists and serves
//      the set (this path tracks the install, not the checkout, so it outlives a repo move);
//   3. the running binary's own real path (last resort; serves the set by construction).
// FAFF-434: "the set" is FAFF_ALL_HOOKS (Stop + PreToolUse combined) — a bin that can
// serve runcheck/prepcheck but not merge-fence is not fit to be the one canonical bin.
function resolveHookBin(probeRoot) {
  const onPath = whichFaff();
  if (onPath && FAFF_ALL_HOOKS.every((s) => probeServes(onPath, s, probeRoot))) return onPath;
  const installed = process.env.CLAUDE_PLUGIN_ROOT
    ? path.join(process.env.CLAUDE_PLUGIN_ROOT, "skills", "faff", "bin", "faff")
    : path.join(process.env.HOME || "", ".claude", "skills", "faff", "bin", "faff");
  try {
    if (fs.existsSync(installed) && FAFF_ALL_HOOKS.every((s) => probeServes(installed, s, probeRoot))) return installed;
  } catch { /* fall through to the running binary */ }
  try { return fs.realpathSync(process.argv[1]); } catch { return process.argv[1]; }
}

function cmdHooksEnsure(args) {
  if (args.includes("--selftest")) return hooksEnsureSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();
  const asJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const target = path.join(root, ".claude", "settings.json");
  const local = path.join(root, ".claude", "settings.local.json");
  const existed = fs.existsSync(target);

  let targetObj, localObj;
  try { targetObj = readJsonOrEmpty(target); }
  catch (e) { process.stderr.write(`faff hooks-ensure: malformed ${target}: ${e.message}\n`); return 2; }
  try { localObj = readJsonOrEmpty(local); }
  catch (e) { process.stderr.write(`faff hooks-ensure: malformed ${local}: ${e.message}\n`); return 2; }

  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-hooks-probe-"));
  let bin, served;
  try {
    bin = resolveHookBin(probeRoot);
    served = FAFF_ALL_HOOKS.filter((s) => probeServes(bin, s, probeRoot));
  } finally {
    try { fs.rmSync(probeRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  // FAFF-434: two independent event arrays (Stop, PreToolUse), planned in sequence —
  // the PreToolUse plan is composed on TOP OF the Stop plan's nextSettings (not the
  // original targetObj), so a single write carries both sets of changes atomically.
  const stopPresent = FAFF_STOP_HOOKS.filter((s) => isPresent(s, targetObj) || isPresent(s, localObj));
  const preToolUsePresent = FAFF_PRE_TOOL_USE_HOOKS.filter((s) => isPresent(s, targetObj) || isPresent(s, localObj));
  const stopPlan = planStopHooks(targetObj, stopPresent, served, (s) => `${bin} ${s} --hook`);
  const preToolUsePlan = planPreToolUseHooks(stopPlan.nextSettings, preToolUsePresent, served, (s) => `${bin} ${s} --hook`);

  const added = [...stopPlan.added, ...preToolUsePlan.added];
  const already = [...stopPlan.already, ...preToolUsePlan.already];
  const normalized = [...stopPlan.normalized, ...preToolUsePlan.normalized];
  const skipped_stale = [...stopPlan.skipped_stale, ...preToolUsePlan.skipped_stale];

  const willWrite = !dryRun && (added.length > 0 || normalized.length > 0);
  if (willWrite) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(preToolUsePlan.nextSettings, null, 2) + "\n");
  }

  for (const s of skipped_stale) {
    process.stderr.write(
      `faff hooks-ensure: WARNING — resolved faff (${bin}) does not serve '${s}'; skipped to avoid a ` +
      `session-blocking hook. Fix the install, then re-run: bash scripts/link-skills.sh --global --replace\n`);
  }

  const result = { path: target, created: willWrite && !existed, bin, added, already, normalized, skipped_stale };
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (added.length || normalized.length) {
    const parts = [];
    if (added.length) parts.push(`${dryRun ? "would add" : "added"} ${added.join(", ")}`);
    if (normalized.length) parts.push(`${dryRun ? "would normalize" : "normalized"} ${normalized.join(", ")}`);
    console.log(`${dryRun ? "[dry-run] " : ""}${parts.join("; ")} → ${target}`);
  } else {
    const note = already.length ? `already present (${already.join(", ")})` : "nothing to add";
    console.log(`${target} — faff hooks ${note}; no change`);
  }
  return 0;
}

// Selftest drives the pure planner over in-memory cases (no filesystem), as the
// park-history / eligible / prepcheck selftests do.
// [label, settings, present, served, +added, =already, skip, ~normalized] (canonical inv = "faff <sub> --hook")
// FAFF-471: sentrycheck joined FAFF_STOP_HOOKS as the third member — every case
// below carries it through served/present/added/skip so the table stays exact
// against the live three-member planner (a stale two-member fixture would pass
// vacuously by under-covering the new member, not by testing it).
const HOOKS_ENSURE_SELFTEST_CASES = [
  ["empty + all three served", {}, [], ["runcheck", "prepcheck", "sentrycheck"], ["runcheck", "prepcheck", "sentrycheck"], [], [], []],
  ["runcheck present (divergent path), prepcheck+sentrycheck served",
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "/x/bin/faff runcheck --hook" }] }] } },
    ["runcheck"], ["runcheck", "prepcheck", "sentrycheck"], ["prepcheck", "sentrycheck"], ["runcheck"], [], ["runcheck"]],
  ["all three present, canonical → no-op",
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "faff runcheck --hook" }, { type: "command", command: "faff prepcheck --hook" }, { type: "command", command: "faff sentrycheck --hook" }] }] } },
    ["runcheck", "prepcheck", "sentrycheck"], ["runcheck", "prepcheck", "sentrycheck"], [], ["runcheck", "prepcheck", "sentrycheck"], [], []],
  ["stale bin serves none", {}, [], [], [], [], ["runcheck", "prepcheck", "sentrycheck"], []],
  ["present-but-unserved counts present (not skipped); sentrycheck unserved → skipped",
    {}, ["prepcheck"], ["runcheck"], ["runcheck"], ["prepcheck"], ["sentrycheck"], []],
  ["present-but-divergent-path → normalized (prepcheck); runcheck+sentrycheck added",
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "/abs/repo/path/faff prepcheck --hook" }] }] } },
    ["prepcheck"], ["runcheck", "prepcheck", "sentrycheck"], ["runcheck", "sentrycheck"], ["prepcheck"], [], ["prepcheck"]],
  ["sentrycheck present (divergent path), others served",
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "/y/bin/faff sentrycheck --hook" }] }] } },
    ["sentrycheck"], ["runcheck", "prepcheck", "sentrycheck"], ["runcheck", "prepcheck"], ["sentrycheck"], [], ["sentrycheck"]],
];

// FAFF-434: the PreToolUse-event sibling of HOOKS_ENSURE_SELFTEST_CASES, driving
// planPreToolUseHooks instead of planStopHooks — same [label, settings, present,
// served, +added, =already, skip, ~normalized] shape.
const HOOKS_ENSURE_PRE_TOOL_USE_SELFTEST_CASES = [
  ["empty + served → added", {}, [], ["merge-fence"], ["merge-fence"], [], [], []],
  ["present, canonical → no-op",
    { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "faff merge-fence --hook" }] }] } },
    ["merge-fence"], ["merge-fence"], [], ["merge-fence"], [], []],
  ["present, divergent path → normalized",
    { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/abs/repo/path/faff merge-fence --hook" }] }] } },
    ["merge-fence"], ["merge-fence"], [], ["merge-fence"], [], ["merge-fence"]],
  ["stale bin serves nothing → skipped", {}, [], [], [], [], ["merge-fence"], []],
];

function hooksEnsureSelftest() {
  let fail = 0;
  const inv = (s) => `faff ${s} --hook`;
  for (const [label, settings, present, served, wAdded, wAlready, wSkip, wNorm] of HOOKS_ENSURE_SELFTEST_CASES) {
    const p = planStopHooks(settings, present, served, inv);
    const ok = JSON.stringify(p.added) === JSON.stringify(wAdded)
      && JSON.stringify(p.already) === JSON.stringify(wAlready)
      && JSON.stringify(p.skipped_stale) === JSON.stringify(wSkip)
      && JSON.stringify(p.normalized) === JSON.stringify(wNorm ?? []);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → +${JSON.stringify(p.added)} =${JSON.stringify(p.already)} ~${JSON.stringify(p.normalized)} skip${JSON.stringify(p.skipped_stale)}`);
  }
  for (const [label, settings, present, served, wAdded, wAlready, wSkip, wNorm] of HOOKS_ENSURE_PRE_TOOL_USE_SELFTEST_CASES) {
    const p = planPreToolUseHooks(settings, present, served, inv);
    const ok = JSON.stringify(p.added) === JSON.stringify(wAdded)
      && JSON.stringify(p.already) === JSON.stringify(wAlready)
      && JSON.stringify(p.skipped_stale) === JSON.stringify(wSkip)
      && JSON.stringify(p.normalized) === JSON.stringify(wNorm ?? []);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} PreToolUse: ${label} → +${JSON.stringify(p.added)} =${JSON.stringify(p.already)} ~${JSON.stringify(p.normalized)} skip${JSON.stringify(p.skipped_stale)}`);
  }
  // structural: adding into {} builds one Stop group carrying the three command hooks
  const built = planStopHooks({}, [], ["runcheck", "prepcheck", "sentrycheck"], inv).nextSettings;
  const cmds = (((built.hooks || {}).Stop || [])[0] || {}).hooks || [];
  const structOk = cmds.length === 3 && cmds.every((h) => h.type === "command" && /faff (runcheck|prepcheck|sentrycheck) --hook/.test(h.command));
  if (!structOk) fail++;
  console.log(`${structOk ? "ok  " : "FAIL"} structural: {} → Stop group with 3 command hooks`);
  // structural: adding into {} builds one Bash-matcher PreToolUse group carrying the fence
  const builtPre = planPreToolUseHooks({}, [], ["merge-fence"], inv).nextSettings;
  const preCmds = (((builtPre.hooks || {}).PreToolUse || [])[0] || {}).hooks || [];
  const preGroup = ((builtPre.hooks || {}).PreToolUse || [])[0] || {};
  const structPreOk = preGroup.matcher === "Bash" && preCmds.length === 1 && preCmds[0].type === "command" && /faff merge-fence --hook/.test(preCmds[0].command);
  if (!structPreOk) fail++;
  console.log(`${structPreOk ? "ok  " : "FAIL"} structural: {} → Bash-matcher PreToolUse group carrying merge-fence`);
  // identity: token match ignores path / env prefix, requires --hook
  const idCases = [
    ["/abs/faff prepcheck --hook", "prepcheck", true],
    ["FOO=1 /x/faff prepcheck --hook", "prepcheck", true],
    ["faff prepcheck", "prepcheck", false],
    ["faff runcheck --hook", "prepcheck", false],
    ["faff merge-fence --hook", "merge-fence", true],
    ["/abs/faff merge-fence --hook", "merge-fence", true],
    ["faff merge-fence", "merge-fence", false],
    ["faff sentrycheck --hook", "sentrycheck", true],
    ["/abs/faff sentrycheck --hook", "sentrycheck", true],
    ["FOO=1 /x/faff sentrycheck --hook", "sentrycheck", true],
    ["faff sentrycheck", "sentrycheck", false],
    ["faff runcheck --hook", "sentrycheck", false],
  ];
  for (const [cmd, sub, want] of idCases) {
    const got = commandInvokesFaffHook(cmd, sub);
    if (got !== want) fail++;
    console.log(`${got === want ? "ok  " : "FAIL"} identity '${cmd}' ~ ${sub} → ${got} (want ${want})`);
  }
  const total = HOOKS_ENSURE_SELFTEST_CASES.length + HOOKS_ENSURE_PRE_TOOL_USE_SELFTEST_CASES.length + 2 + idCases.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { FAFF_ALL_HOOKS, FAFF_PRE_TOOL_USE_HOOKS, FAFF_STOP_HOOKS, HOOKS_ENSURE_PRE_TOOL_USE_SELFTEST_CASES, HOOKS_ENSURE_SELFTEST_CASES, cmdHooksEnsure, commandInvokesFaffHook, hooksEnsureSelftest, isPresent, planPreToolUseHooks, planStopHooks, preToolUseCommands, probeServes, readJsonOrEmpty, resolveHookBin, stopCommands, whichFaff };
