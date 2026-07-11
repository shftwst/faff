// ===========================================================================
// === region:factory — lights-out — FAFF-225: the L4 lights-out entry point / runner. ===
//
// COMPOSITION, NOT MECHANISM. The runner (a) runs a fail-closed BASIC preflight
// over v1's launch preconditions, (b) on pass MINTS an L4 run-ledger with strict
// defaults carrying `armed: Map<Guardrail, State>`, (c) renders + PERSISTS a banner
// derivable 1:1 from `armed`, (d) emits a run-start event. It re-implements NO
// guardrail logic — every guardrail decision traces to a CLI-contract reachability
// probe at launch (the wrapped run then calls each contract at its boundary; that
// loop is the orchestrator prose layer's job — the CLI owns the gate + the mint).
//
// FAIL-CLOSED EVERYWHERE: ambiguity, absence, or any non-live guardrail/precondition
// refuses to go lights-out. There is no keystone-absent reduced mode. The cage
// (`--dangerously-skip-permissions`, host isolation) is the container's job — the
// runner detects and refuses, it never self-grants nor weakens the host.
//
// Pure core (lightsOutPreflight) + thin I/O wrapper (cmdLightsOut) + --selftest,
// mirroring container-check / budget / events / sentry.
// ===========================================================================

// The 8 shipped guardrail contracts the runner composes, in banner order. Each id
// pairs with the CLI contract that backs it (label only — the runner OWNS no copy
// of the logic) and the subcommand whose --selftest is its reachability probe
// (null ⇒ resolved differently: container from container-check's own verdict).
// `enforced` (FAFF-305): true iff an orchestrator step actually INVOKES this
// guardrail in the loop — distinct from `probe`/armed reachability (the contract
// answers --selftest). All 8 guardrails are now enforced: the per-run holdout
// phase (beep-boop, sibling to runcheck) invokes the env→evaluate chain via the
// call-site-agnostic holdout step (faffter-noon-env-compose provisions, faffter-noon-evaluate
// judges code-blind), so `holdout` earns enforced:true and the banner reads 8/8. Derived
// fail-closed via strict === true (see lightsOutEnforced) — a new entry without an
// explicit enforced:true reads as not-enforced, never silently counted.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { AT_CEILING_OUTCOMES, envelopeFrom } = require("./budget");
const { DEFAULTS, loadConfig } = require("./config");
const { containerCheck, realFsq } = require("./container-check");
const { correctiveIntegrityProbe } = require("./corrective-integrity");
const { eventLineCount } = require("./events");
const { atomicWriteLedger } = require("./heartbeat");
const { dig, findRoot, mainWorktreeRoot } = require("./shared-infra");

const LIGHTS_OUT_GUARDRAILS = [
  { id: "admissibility", contract: "faff admissible --lights-out",          probe: "admissible", enforced: true },
  { id: "spec_review",   contract: "faff contract spec-review-verdict",     probe: "contract",   enforced: true },
  { id: "terminating",   contract: "faff run-done",                         probe: "run-done",   enforced: true },
  { id: "budget",        contract: "faff budget check",                     probe: "budget",     enforced: true },
  { id: "observability", contract: "faff events",                           probe: "events",     enforced: true },
  { id: "kill_switch",   contract: "faff sentry check",                     probe: "sentry",     enforced: true },
  { id: "holdout",       contract: "faff holdout / faff prdr coverage",     probe: "holdout",    enforced: true },
  { id: "container",     contract: "faff container-check",                  probe: null,         enforced: true },
];
const LIGHTS_OUT_GUARDRAIL_IDS = LIGHTS_OUT_GUARDRAILS.map((g) => g.id);
const GUARDRAIL_STATES = new Set(["live", "degraded", "absent"]);
const LIGHTS_OUT_FLOOR_KEYS = ["no_execute", "worktree_isolation", "autonomous_contract"];
// FAFF-379 — each floor entry's honesty mode. `worktree_isolation` is a genuine
// runtime probe (checkWorktreeIsolation); `no_execute` and `autonomous_contract` are
// STATIC invariants of the shipped code — no runtime probe can re-verify "my own code
// derives no command from free text". The banner labels which is which so the surface
// never implies a live check that cannot run. The preflight loop still fails closed on
// ALL three (a static entry reading non-true is a wiring-bug backstop) — honesty is a
// presentation property, never a weakening of when the preflight refuses.
const FLOOR_MODES = { no_execute: "static", worktree_isolation: "checked", autonomous_contract: "static" };
const FLOOR_LABELS = { no_execute: "no-execute", worktree_isolation: "worktree-isolation", autonomous_contract: "autonomous-contract" };

// FAFF-379 — the real `worktree_isolation` floor probe. Pure over the injected `fsq`
// (the same seam containerCheck uses), side-effect-free (stat/access only — NEVER a
// mkdir; `--check` mints nothing). Proves the resolved worktree root is (a) strictly
// OUTSIDE the repo working tree and (b) creatable/usable — the nearest existing
// ancestor is a writable directory. Every failure path RETURNS a fail-closed verdict
// ({holds:false, detail}); it never throws (an fsq error is caught → fail-closed).
function checkWorktreeIsolation(rawRoot, repoRoot, fsq) {
  try {
    const resolved = path.resolve(String(rawRoot == null ? "" : rawRoot));
    const repo = path.resolve(String(repoRoot == null ? "" : repoRoot));
    // Segment-aware containment (never a bare string startsWith): path.relative is ""
    // when equal, and a non-"../"/non-absolute path when `resolved` is strictly inside.
    const rel = path.relative(repo, resolved);
    const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (inside) {
      return { holds: false, detail: `worktree root '${resolved}' is inside the repo working tree — builds would collide with the orchestrating checkout` };
    }
    // Walk to the nearest existing ancestor (terminates at the filesystem root).
    let anchor = resolved;
    while (!fsq.exists(anchor)) {
      const parent = path.dirname(anchor);
      if (parent === anchor) break; // filesystem root — always exists
      anchor = parent;
    }
    if (fsq.exists(anchor) && !fsq.isDirectory(anchor)) {
      return { holds: false, detail: `worktree root '${resolved}' collides with a non-directory at '${anchor}'` };
    }
    if (!fsq.writable(anchor)) {
      return { holds: false, detail: `worktree root '${resolved}' is not creatable — nearest existing ancestor '${anchor}' is not writable` };
    }
    return { holds: true, detail: null };
  } catch (e) {
    return { holds: false, detail: `worktree isolation check failed: ${e && e.message ? e.message : String(e)}` };
  }
}

// FAFF-382 — the single canonical worktree-root resolver. The env→config→default
// precedence that decides where a build's worktree lands was inlined in two places (the
// setup-worktree.sh hook and the lights-out preflight below); this is the one source all
// three consumers — hook, preflight, and the graft Step-3 assert — now call, so they never
// drift (gateway → Worktree policy declares any divergence a bug). Pure over (repoRoot,
// env, cfg): env/config are used VERBATIM (no <repo> suffix — matches the hook); ONLY the
// default appends basename(repoRoot). An empty/whitespace env or config value is treated as
// absent (falls through), never resolved to "" (which would root at "/").
function resolveWorktreeRoot(repoRoot, env, cfg) {
  const e = (env && env.FAFF_WORKTREE_ROOT != null) ? String(env.FAFF_WORKTREE_ROOT) : "";
  if (e.trim() !== "") return { root: e, source: "env" };
  const c = dig(cfg || {}, "worktree_root");
  if (c != null && String(c).trim() !== "") return { root: String(c), source: "config" };
  const home = (env && env.HOME) ? String(env.HOME) : "~";
  const base = path.basename(path.resolve(String(repoRoot == null ? "" : repoRoot)));
  return { root: path.join(home, ".faff/worktrees", base), source: "default" };
}

// FAFF-382 — the `--assert` containment predicate: is `candidate` STRICTLY under `root`?
// The same segment-aware test checkWorktreeIsolation uses (path.relative, never a bare
// startsWith), minus the equal case — a worktree must be UNDER the root, not equal to it.
// Pure, no I/O.
function isStrictlyUnderRoot(root, candidate) {
  const r = path.resolve(String(root == null ? "" : root));
  const c = path.resolve(String(candidate == null ? "" : candidate));
  const rel = path.relative(r, c);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// `faff worktree-root [--assert PATH] [--root DIR] [--json] [--selftest]` — resolve the
// worktree root, or assert a path is under it. The single resolver the hook + preflight +
// graft all call.
function cmdWorktreeRoot(args) {
  if (args.includes("--selftest")) return worktreeRootSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const json = args.includes("--json");
  // Resolve --root to the MAIN checkout: called from a linked worktree (the graft
  // Step-3 assert runs with cwd = the worktree), findRoot() returns the worktree, whose
  // basename is the branch dir — not the repo. mainWorktreeRoot maps it back to the main
  // checkout so the default `<repo>` suffix matches what the hook (always handed the main
  // cwd) computes; a null (main checkout / non-git) leaves --root unchanged.
  const root0 = get("--root") || findRoot();
  const root = mainWorktreeRoot(root0) || root0;
  const assertPath = get("--assert");
  const [cfg] = loadConfig(root);
  const resolved = resolveWorktreeRoot(root, process.env, cfg);
  if (assertPath != null) {
    const under = isStrictlyUnderRoot(resolved.root, assertPath);
    if (json) {
      console.log(JSON.stringify({ root: resolved.root, source: resolved.source, asserted_path: assertPath, under_root: under }));
    } else if (!under) {
      process.stderr.write(`worktree '${assertPath}' is not under the resolved root '${resolved.root}'\n`);
    }
    return under ? 0 : 1;
  }
  if (json) console.log(JSON.stringify({ root: resolved.root, source: resolved.source }));
  else console.log(resolved.root);
  return 0;
}

// In-memory selftest over synthetic (repoRoot, env, cfg) fixtures — mirrors the
// container-check / eligible selftest shape (per-case ok/FAIL + a RESULT line).
function worktreeRootSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { fail++; console.log(`FAIL ${label}`); } else console.log(`ok   ${label}`); };
  // Precedence — env wins, then config, then the repo-suffixed default; env/config verbatim.
  const rEnv = resolveWorktreeRoot("/repo", { FAFF_WORKTREE_ROOT: "/wt/env", HOME: "/home/u" }, { worktree_root: "/wt/cfg" });
  check("env wins, verbatim (no <repo> suffix)", rEnv.source === "env" && rEnv.root === "/wt/env");
  const rCfg = resolveWorktreeRoot("/repo", { HOME: "/home/u" }, { worktree_root: "/wt/cfg" });
  check("config when no env, verbatim", rCfg.source === "config" && rCfg.root === "/wt/cfg");
  const rDef = resolveWorktreeRoot("/home/u/code/myrepo", { HOME: "/home/u" }, {});
  check("default = HOME/.faff/worktrees/<basename> (only default appends <repo>)",
    rDef.source === "default" && rDef.root === "/home/u/.faff/worktrees/myrepo");
  const rEmptyEnv = resolveWorktreeRoot("/repo/sub", { FAFF_WORKTREE_ROOT: "", HOME: "/home/u" }, {});
  check("empty env falls through to default", rEmptyEnv.source === "default" && rEmptyEnv.root === "/home/u/.faff/worktrees/sub");
  const rBlankCfg = resolveWorktreeRoot("/r", { HOME: "/h" }, { worktree_root: "   " });
  check("whitespace-only config ignored → default", rBlankCfg.source === "default");
  // Containment — strictly under, segment-aware.
  check("strictly under: <root>/br", isStrictlyUnderRoot("/wt/root", "/wt/root/br") === true);
  check("nested under: <root>/a/b", isStrictlyUnderRoot("/wt/root", "/wt/root/a/b") === true);
  check("root itself is NOT strictly under", isStrictlyUnderRoot("/wt/root", "/wt/root") === false);
  check("sibling outside is not under", isStrictlyUnderRoot("/wt/root", "/wt/other") === false);
  check("parent is not under", isStrictlyUnderRoot("/wt/root", "/wt") === false);
  check("prefix-not-segment is not under (/wt/root2)", isStrictlyUnderRoot("/wt/root", "/wt/root2") === false);
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FAFF-298 — dial-coherence. Refuse dial COMBINATIONS that pass every single-dial
// check but are jointly reckless for an unattended (L4) run. Pure, no I/O; its
// refusals fold into lightsOutPreflight's existing array, so the banner, the
// persisted ledger, and the exit code carry them with no new plumbing. By the time
// this runs the basic preflight has already proven each dial individually valid, so
// its sole job is the JOINT incoherence the per-dial probes structurally cannot see.
// Appetite is NOT a dimension here — L4 forces `appetite: full` (level-scoped,
// owned by FAFF-308), so there is nothing to ceiling and this pass never reads it.
//
// Adversarial-occupant allowlists — name-based, fail-closed on the unknown. The
// capability-vs-name question (an occupant self-declaring its adversariality) is a
// Punt: a future contract would supersede these sets. isAdversarial(null|unknown) is
// false, so a null/unknown occupant refuses fail-closed rather than slipping through.
const ADVERSARIAL_REVIEW_OCCUPANTS = new Set(["faffter-dark-adversarial-review"]);
const ADVERSARIAL_SPEC_REVIEW_OCCUPANTS = new Set(["faffter-dark-spec-review"]);
// Vetted-by-construction recipe names — the FAFF-18 forward-compat seam. `recipe` IS
// live-readable from user config today (cmdLightsOut reads `dig(cfg, "recipe")` and
// feeds it straight into this dial) — it is NOT inert. The set is intentionally EMPTY
// pending FAFF-18: a non-null recipe not in this set falls THROUGH to Rules A+B below
// (never an auto-pass), so today every recipe name is adjudicated on its own dial, not
// vetted by name. Re-populate an entry ONLY once the FAFF-377 contract is satisfied —
// either the name corresponds to a schema that guarantees-by-construction it sets
// adversarial review + fail-closed gates, or this seam is upgraded to verify-not-trust.
// A bare name added here without that would bypass the L4 second-opinion gate.
const VETTED_RECIPES = new Set();

// Pure: is `occupant` a known adversarial occupant of `kindSet`? Fail-closed on
// null/unknown (returns false) — the caller treats that as a refusal.
function isAdversarial(occupant, kindSet) {
  return occupant != null && kindSet.has(occupant);
}

// Pure: adjudicate the assembled dial tuple, returning CoherenceRefusal[] ({gate,
// detail}). Empty ⇒ coherent. A non-null vetted recipe short-circuits to coherent.
// Otherwise: Rule (A) — L4 needs an adversarial review AND spec_review occupant;
// Rule (B) — gates.fallback must be fail-closed. Fail-closed throughout: an unknown
// occupant or an unrecognised gates.fallback token refuses, never proceeds.
function dialCoherence(dial) {
  const d = dial || {};
  if (d.recipe != null && VETTED_RECIPES.has(d.recipe)) return [];
  const refusals = [];
  const slots = d.slots || {};
  // Rule (A) — the adversarial second-opinion machinery is a keystone of L4's trust
  // model; a single-model reviewer silently removes it.
  if (!isAdversarial(slots.review, ADVERSARIAL_REVIEW_OCCUPANTS)) {
    refusals.push({
      gate: "dial-coherence:adversarial-review",
      detail: `L4 lights-out requires an adversarial review occupant; '${slots.review == null ? "" : slots.review}' is not one — the second-opinion gate would be a single-model pass`,
    });
  }
  if (!isAdversarial(slots.spec_review, ADVERSARIAL_SPEC_REVIEW_OCCUPANTS)) {
    refusals.push({
      gate: "dial-coherence:adversarial-spec-review",
      detail: `L4 lights-out requires an adversarial spec_review occupant; '${slots.spec_review == null ? "" : slots.spec_review}' is the single-pass default — the approach-challenge would not be adversarial`,
    });
  }
  // Rule (B) — the engineering gate ladder must fail closed under lights-out; advisory
  // lets a repo with no declared gates pass silently. Any non-fail-closed token refuses.
  if (d.gates_fallback !== "fail-closed") {
    refusals.push({
      gate: "dial-coherence:gates-fallback",
      detail: `gates.fallback is '${d.gates_fallback == null ? "" : d.gates_fallback}' — an unattended run needs fail-closed engineering gates; advisory lets a repo with no declared gates pass silently`,
    });
  }
  return refusals;
}

// Pure: derive each guardrail's armed State ∈ {live|degraded|absent} from the probe
// results — NEVER from config presence alone (a configured-but-unreachable contract
// is degraded/absent, never silently live). `reachable[id]` is the contract probe;
// `container` is container-check's verdict; `specReviewSlot` is the slots.spec_review
// configured+reachable boolean (a live contract but a down slot ⇒ degraded).
function lightsOutArmed(probes) {
  const reach = (probes && probes.reachable) || {};
  const armed = {};
  for (const id of LIGHTS_OUT_GUARDRAIL_IDS) {
    if (id === "container") {
      armed[id] = probes.container === "contained" ? "live" : "absent";
    } else if (id === "spec_review") {
      // contract unreachable ⇒ absent; contract live but slot down ⇒ degraded; both ⇒ live.
      armed[id] = !reach[id] ? "absent" : (probes.specReviewSlot ? "live" : "degraded");
    } else {
      armed[id] = reach[id] ? "live" : "absent";
    }
  }
  return armed;
}

// Pure: derive each guardrail's enforced flag — true iff an orchestrator step
// INVOKES it in the loop. A STATIC property of the shipped pipeline (which steps
// exist), not of probe results, so it takes no probes (contrast lightsOutArmed,
// which is probe-derived). Fail-closed via strict === true: a missing / non-`true`
// flag reads false, so a new guardrail without an explicit enforced:true is never
// silently counted as enforced. Reported by the banner + ledger, never gated on.
function lightsOutEnforced(guardrails = LIGHTS_OUT_GUARDRAILS) {
  const enforced = {};
  for (const g of guardrails) enforced[g.id] = g.enforced === true;
  return enforced;
}

// Pure: the refuse-to-start decision over v1's preconditions + the armed guardrail
// set. Returns { proceed, refusals:[{gate,detail}], armed, enforced, banner, floor }. Proceed
// iff EVERY guardrail is `live`, the review + spec_review slots are reachable, a
// budget ceiling is set, and every floor assertion holds. Any miss refuses.
function lightsOutPreflight(probes) {
  const armed = lightsOutArmed(probes);
  const enforced = lightsOutEnforced();
  const floor = (probes && probes.floor) || {};
  const refusals = [];

  // Per-guardrail reachability (keystones included). Anything not `live` refuses —
  // a reachability fault, fail-closed; there is no designed keystone-absent mode.
  for (const id of LIGHTS_OUT_GUARDRAIL_IDS) {
    if (armed[id] === "live") continue;
    if (id === "container") {
      refusals.push({ gate: "guardrail:container", detail: "container-check not_confirmed — go lights-out only inside the host-isolation container (claude-box); the cage is the container's job, faff refuses to self-grant or weaken it" });
    } else {
      refusals.push({ gate: `guardrail:${id}`, detail: `${id} not live (${armed[id]}) — its CLI contract failed the launch reachability probe; fail-closed, no reduced mode` });
    }
  }
  // Basic preconditions (NOT rich dial-coherence — reckless level+appetite+slots+gates
  // adjudication is a deferred follow-on; v1 does cheap reachability/presence probes).
  if (!probes.reviewReachable)
    refusals.push({ gate: "review-slot", detail: "review slot unreachable (configured-but-unreachable == absent) — the second-opinion gate must refuse, never silently pass+skip" });
  if (!probes.specReviewSlot)
    refusals.push({ gate: "spec_review-slot", detail: "spec_review slot not configured + reachable — spec admission gating would be skipped" });
  if (!probes.budgetCeilingSet)
    refusals.push({ gate: "budget-ceiling", detail: "count-cap only (or no ceiling) — a count is not an L4 governor; set a spend/time ceiling: budget.tokens, budget.until / --until, or budget.cost with price_per_mtok > 0. max_attempts may stay as an extra backstop." });
  // FAFF-364 — a malformed budget.until / --until must never mint a ledger carrying
  // it: fires REGARDLESS of other ceilings (a clean budget.tokens ceiling does NOT
  // excuse garbage until). When malformed until is the run's ONLY ceiling, the
  // budget-ceiling refusal above ALSO fires (until resolves to null there too) —
  // both refusals present, each naming its own remedy.
  if (probes.budgetUntilInvalid != null)
    refusals.push({ gate: "budget-until-invalid", detail: `budget.until / --until '${probes.budgetUntilInvalid}' is not a valid HH:MM (00-23:00-59) — fix budget.until in .faffrc.yaml or the --until flag` });
  // Floor assertions — must hold in-container; a failed assertion refuses the run.
  // The refuse condition is UNCHANGED (fail-closed on any non-true value, static or
  // checked). FAFF-379: a checked entry that failed carries a specific per-key reason
  // in probes.floor_detail; use it when present, else the existing generic message
  // (backward-compatible — synthetic-probe callers pass no detail).
  const floorDetail = (probes && probes.floor_detail) || {};
  for (const k of LIGHTS_OUT_FLOOR_KEYS) {
    if (floor[k] !== true) {
      const specific = floorDetail[k];
      const detail = (typeof specific === "string" && specific.length > 0)
        ? specific
        : `floor assertion '${k}' does not hold — refuse (no-execute / worktree isolation / Autonomous Mode Contract must all hold)`;
      refusals.push({ gate: `floor:${k}`, detail });
    }
  }
  // Dial-coherence (FAFF-298) — refuse jointly-reckless dial COMBINATIONS the single-
  // dial checks above structurally cannot see. Runs only when the wrapper supplied an
  // assembled dial profile (cmdLightsOut always does); its refusals fold into the
  // array so proceed / banner / ledger / exit reflect them with no new plumbing.
  if (probes && probes.dial) {
    for (const r of dialCoherence(probes.dial)) refusals.push(r);
  }

  const proceed = refusals.length === 0;
  const banner = renderLightsOutBanner(armed, floor, proceed, probes, enforced);
  return { proceed, refusals, armed, enforced, banner, floor };
}

// Pure: render the human-facing banner — the trust contract. Derivable 1:1 from
// `armed` + `enforced` (every guardrail id, its reachability state, AND its
// enforcement flag appears), so a human can confirm an L4 run without re-deriving
// config — and never reads a bare "live" that conflates reachable with enforced
// (FAFF-305). Persisted into the ledger, not just printed. `enforced` is the
// fail-closed {id: boolean} map from lightsOutEnforced(); a 4-arg call leaves it
// undefined and every line degrades to "reachable-only" (the documented failure
// mode the selftest catches), never throwing.
function renderLightsOutBanner(armed, floor, proceed, probes, enforced) {
  const mark = (s) => (s === "live" ? "●" : s === "degraded" ? "◐" : "○");
  const enf = enforced || {};
  const lines = [];
  lines.push(`faff lights-out — L4 run banner`);
  lines.push(`  level: L4   container: ${probes && probes.container === "contained" ? "contained" : "refused"}`);
  lines.push(`  guardrails (${LIGHTS_OUT_GUARDRAILS.length}):`);
  for (const g of LIGHTS_OUT_GUARDRAILS) {
    const st = armed[g.id];
    const enfTok = enf[g.id] === true ? "enforced" : "reachable-only";
    lines.push(`    ${mark(st)} ${g.id.padEnd(14)} reachable:${String(st).padEnd(9)} ${enfTok.padEnd(14)} (${g.contract})`);
  }
  const fl = floor || {};
  // FAFF-379: each floor entry carries its honesty mode (checked vs static) so the
  // surface never presents a static invariant as a live check.
  const floorParts = LIGHTS_OUT_FLOOR_KEYS.map((k) => `${FLOOR_LABELS[k]} ${fl[k] ? "✓" : "✗"} ${FLOOR_MODES[k]}`);
  lines.push(`  floor: ${floorParts.join("  ·  ")}`);
  if (proceed) {
    const total = LIGHTS_OUT_GUARDRAILS.length;
    const enforcedN = LIGHTS_OUT_GUARDRAIL_IDS.filter((id) => enf[id] === true).length;
    const notEnforced = LIGHTS_OUT_GUARDRAIL_IDS.filter((id) => enf[id] !== true);
    const base = `ARMED — ${enforcedN}/${total} enforced`;
    const status = notEnforced.length
      ? `${base}; ${notEnforced.length} reachable-but-not-enforced: ${notEnforced.join(", ")}`
      : base;
    lines.push(`  status: ${status}`);
  } else {
    const allLive = LIGHTS_OUT_GUARDRAIL_IDS.every((id) => armed[id] === "live");
    lines.push(`  status: REFUSED — preflight not satisfied${allLive ? "" : " (a guardrail is not live)"}`);
  }
  return lines.join("\n");
}

// Reachability probe for a CLI-backed guardrail: spawn THIS binary's `<sub> --selftest`
// and treat exit 0 as live. A genuine probe (it executes the contract), not a config
// read — a stale binary lacking `sentry`/`holdout` fails here and the run refuses.
function probeContractReachable(binPath, sub) {
  try {
    const r = spawnSync(process.execPath, [binPath, sub, "--selftest"], { encoding: "utf8", timeout: 20000 });
    return r.status === 0;
  } catch { return false; }
}

function resolveSlotOccupant(cfg, name) {
  const v = dig(cfg, `slots.${name}`);
  if (v != null && String(v).trim() !== "") return String(v).trim();
  return DEFAULTS[`slots.${name}`] || null;
}

// FAFF-312 — L4 run-governance helpers (pure). ----------------------------------
// Pure: does the envelope carry a SPEND/TIME ceiling — the only dimension that can
// govern an UNBOUNDED L4 run? `tokens` and `until` always count; `cost` only when
// priced (`price_per_mtok > 0`), because an unpriced cost ceiling never breaches
// (envelopeFrom already nulls it) and a vacuous ceiling must not satisfy a
// fail-closed precondition. `max_attempts` (a count) is DELIBERATELY excluded: a
// tally is an L3 cost idiom, uncorrelated with project size or doneness, and
// stalling a healthy run at attempt N defeats the point of L4 — so it is legal as
// an extra backstop but never sufficient as the sole L4 ceiling. Replaces the old
// any-dimension `Object.values(ceilings).some(v != null)`.
function spendTimeCeilingSet(envelope) {
  const c = (envelope && envelope.ceilings) || {};
  return c.tokens != null
      || c.until != null
      || (c.cost != null && envelope && envelope.price_per_mtok > 0);
}

// Pure: the MINT-TIME at_ceiling default for a lights-out (L4) run — `escalate`
// when config leaves it unset, the explicit configured value (coerced like
// envelopeFrom) otherwise. Level-scoped: it lives HERE (applied at mint into the
// run-ledger envelope), NOT in the level-blind DEFAULTS registry — so L3 budget
// semantics and `config defaults --selftest` are untouched, and `faff budget check
// --run-dir` reads the minted value back via envelopeFromLedger. Rationale: a
// backstop binding on an unbounded run is an anomaly that must surface as a
// structured needs-human (run-done's fixed floor rung), never a silent stop
// mid-project — but an explicit `stop` is a legitimate "quietly end the night at
// the ceiling" choice and human-explicit config outranks the level default.
function mintAtCeiling(cfg) {
  const raw = dig(cfg, "budget.at_ceiling");
  if (raw == null) return "escalate";                 // L4 mint-time default (unset)
  const v = String(raw).trim().toLowerCase();
  // A recognised explicit value is honoured verbatim; an UNRECOGNISED one (a typo like
  // `escalte`) fails safe toward `escalate`, NOT `stop`. This is where the level-scoped
  // L4 default legitimately diverges from envelopeFrom's level-blind unknown→stop: at L4 a
  // silent stop mid-project is the exact failure this model exists to prevent, so a typo'd
  // at_ceiling must surface as a structured escalation rather than quietly downgrade.
  return AT_CEILING_OUTCOMES.has(v) ? v : "escalate";
}

// The L4 run-start PRD-admissibility gate (a beep-boop prose-layer pre-step) resolves the PRD's
// creative-licence envelope and hands it to the mint via `--prd-creative-licence`. It is stored in the
// minted ledger so the downstream YAGNI/scope-strictness gate can read it. Pure resolver: null == no
// flag (no PRD gate ran); "broad"/"tight" pass; an off-vocabulary value is NOT ok (fail loud, never a
// silent null — the fail-safe stance of the prd-readiness contract it rides beside).
function prdCreativeLicenceFromFlag(value) {
  if (value == null) return { value: null, ok: true };
  if (value === "broad" || value === "tight") return { value, ok: true };
  return { value: null, ok: false };
}

function cmdLightsOut(args) {
  if (args.includes("--selftest")) return lightsOutSelftest();
  const json = args.includes("--json");
  const checkOnly = args.includes("--check");
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();
  // --slot-unreachable <name> (repeatable): the prose layer passes the result of its
  // real skill-liveness probe; tests use it to drive the configured-but-down refusal.
  const unreachable = new Set();
  for (let i = 0; i < args.length; i++) if (args[i] === "--slot-unreachable" && args[i + 1]) unreachable.add(args[i + 1]);

  // PRD creative-licence forward-carry: the run-start PRD gate passes the validator's verdict token
  // here; it lands in the ledger. Validate before any preflight/mint so a bad value fails loud (exit 2)
  // and mints nothing (fail-safe — an unrecognised token never silently degrades to null).
  const prdLicence = prdCreativeLicenceFromFlag(get("--prd-creative-licence"));
  if (!prdLicence.ok) {
    const raw = get("--prd-creative-licence");
    const msg = `lights-out: --prd-creative-licence must be "broad" or "tight" (got ${JSON.stringify(raw)})`;
    if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 2;
  }

  const [cfg] = loadConfig(root);
  const binPath = process.argv[1];

  // Container preflight (the containerisation ADR / claude-box): WARN→BLOCK on the
  // lights-out path only — L1–L3 keep today's warn-don't-block behaviour.
  const container = containerCheck(process.env, realFsq()).result;

  // FAFF-373: corrective-integrity CAPABILITY RECORD (not a guardrail, not a refuse
  // path) — derive whether corrective authority is available from the fail-safe probe.
  // No asserted boundary exists in this ticket, so this is always "channel-D-only";
  // recorded on the minted ledger / JSON output only, never gated on.
  const correctiveAuthority = correctiveIntegrityProbe(process.env, realFsq()).asserted ? "available" : "channel-D-only";

  // Per-guardrail contract reachability probes (genuine, not config presence).
  const reachable = {};
  for (const g of LIGHTS_OUT_GUARDRAILS) {
    if (g.probe === null) { reachable[g.id] = container === "contained"; continue; }
    reachable[g.id] = probeContractReachable(binPath, g.probe);
  }

  // Slots: configured occupant + the prose-supplied liveness (default reachable when
  // the slot resolves to a non-empty occupant; --slot-unreachable forces absent).
  const reviewOccupant = resolveSlotOccupant(cfg, "review");
  const specReviewOccupant = resolveSlotOccupant(cfg, "spec_review");
  const reviewReachable = !!reviewOccupant && !unreachable.has("review");
  const specReviewSlot = !!specReviewOccupant && !unreachable.has("spec_review");

  // Budget ceiling (FAFF-312): a SPEND/TIME dimension is required — a count-cap
  // (`max_attempts`) alone is NOT an L4 governor. tokens/until always count; cost
  // only when priced. Flags override config.
  const envelope = envelopeFrom(cfg, { until: get("--until"), max_attempts: get("--max") });
  const budgetCeilingSet = spendTimeCeilingSet(envelope);

  // Floor assertions (FAFF-379) — a checked/static split, not one kind of thing.
  // `no_execute` + `autonomous_contract` are STATIC invariants of the shipped code:
  // nothing external can runtime-verify "the runner derives no command from free text",
  // so they are asserted true and labelled `static` on the banner. `worktree_isolation`
  // is a real CHECKED probe: checkWorktreeIsolation proves the resolved worktree root is
  // strictly outside the repo tree and creatable/usable, side-effect-free (stat/access,
  // no mkdir). A failing check refuses with its specific reason via floor_detail; the
  // preflight loop still fails closed on all three.
  // FAFF-382: single-sourced via resolveWorktreeRoot (the same resolver the setup-worktree
  // hook and the graft Step-3 assert now call), so preflight/hook/graft never drift. Its
  // default is the repo-suffixed placement root (~/.faff/worktrees/<repo>) — the check now
  // verifies where worktrees actually land, not the parent directory.
  const { root: worktreeRoot } = resolveWorktreeRoot(root, process.env, cfg);
  const isolation = checkWorktreeIsolation(worktreeRoot, root, realFsq());
  const floor = {
    no_execute: true,
    worktree_isolation: isolation.holds,
    autonomous_contract: true,
  };
  const floorDetail = {};
  if (!isolation.holds) floorDetail.worktree_isolation = isolation.detail;

  // Dial-coherence profile (FAFF-298) — the tuple dialCoherence adjudicates. Appetite
  // is deliberately absent (L4 forces `appetite: full`, level-scoped — FAFF-308); this
  // reads only the two resolved occupant names, gates.fallback, and any vetted recipe.
  const gatesFallback = dig(cfg, "gates.fallback") || DEFAULTS["gates.fallback"];
  const recipeRaw = dig(cfg, "recipe");
  const recipe = recipeRaw != null && String(recipeRaw).trim() !== "" ? String(recipeRaw).trim() : null;
  const coherenceDial = {
    level: "L4",
    slots: { review: reviewOccupant, spec_review: specReviewOccupant },
    gates_fallback: gatesFallback,
    recipe,
  };

  // FAFF-364: forward the resolved envelope's until_invalid flag so the preflight
  // can refuse a malformed until at mint time — never carried into a run-ledger.
  const probes = { container, reachable, reviewReachable, specReviewSlot, budgetCeilingSet, budgetUntilInvalid: envelope.until_invalid, floor, floor_detail: floorDetail, dial: coherenceDial };
  const pf = lightsOutPreflight(probes);

  // FAFF-308: appetite is level-scoped — at L4 the runner forces `full` unconditionally,
  // ignoring config `appetite` (choosing L4 IS handing over the reins; appetite is not an
  // operator dial here). The level-scoping is recorded at mint time in the ledger, which the
  // `resolveAppetite` brace then reads so every consumer sees `full`.
  const appetite = "full";
  const dial_profile = {
    appetite,
    slots: { review: reviewOccupant, spec_review: specReviewOccupant },
    gates: resolveSlotOccupant(cfg, "gates"),
  };

  // REFUSE (fail-closed): print the banner + refusals, mint nothing, emit no work.
  if (!pf.proceed) {
    if (json) {
      process.stdout.write(JSON.stringify({ proceed: false, level: "L4", container, corrective_authority: correctiveAuthority, armed: pf.armed, enforced: pf.enforced, refusals: pf.refusals, banner: pf.banner }) + "\n");
    } else {
      console.log(pf.banner);
      console.log(`\nREFUSED — lights-out preflight not satisfied:`);
      for (const r of pf.refusals) console.log(`  ✗ ${r.gate}: ${r.detail}`);
    }
    return 1;
  }

  // --check: would-proceed, but mint nothing (a side-effect-free preflight probe).
  if (checkOnly) {
    if (json) process.stdout.write(JSON.stringify({ proceed: true, level: "L4", container, corrective_authority: correctiveAuthority, armed: pf.armed, enforced: pf.enforced, banner: pf.banner, checked: true }) + "\n");
    else { console.log(pf.banner); console.log(`\nPreflight PASS (--check: no run minted).`); }
    return 0;
  }

  // PROCEED: mint the strict-defaults L4 run-ledger, persist the banner, emit run-start.
  // FAFF-312: apply the level-scoped mint-time at_ceiling default (escalate-when-unset,
  // explicit-config-verbatim) into the ledger envelope. envelopeFromLedger reads it back
  // for `faff budget check --run-dir`, so an L4 backstop breach surfaces as `escalate`
  // (Sentry budget-breach + run-done's fixed floor) rather than a silent stop mid-project.
  envelope.at_ceiling = mintAtCeiling(cfg);
  const nowIso = new Date().toISOString();
  const stamp = nowIso.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-"); // YYYYMMDD-HHMMSS
  const runId = get("--id") || `run-${stamp}-lights-out`;
  const runDir = path.join(root, ".faff", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });

  const ledger = {
    run_id: runId,
    level: "L4",
    armed: pf.armed,
    enforced: pf.enforced,
    banner: pf.banner,
    budget: { envelope },
    budget_ceiling: envelope.ceilings,
    dial_profile,
    prd_creative_licence: prdLicence.value,
    corrective_authority: correctiveAuthority,
    container: "contained",
    floor,
    admitted: [],
    outcomes: {},
    owner: {
      status: "running",
      session_id: process.env.FAFF_SESSION_ID || null,
      pid: process.pid,
      started_at: nowIso,
      last_heartbeat: nowIso,
    },
  };
  atomicWriteLedger(runDir, ledger);

  // Emit the run-start event onto the observability timeline substrate.
  const eventsPath = path.join(runDir, "events.jsonl");
  const seq = eventLineCount(eventsPath);
  const evt = { schema: 1, run_id: runId, seq, ts: nowIso, phase: "run", type: "run-start" };
  fs.appendFileSync(eventsPath, JSON.stringify(evt) + "\n");

  if (json) {
    process.stdout.write(JSON.stringify({ proceed: true, level: "L4", run_id: runId, run_dir: runDir, container: "contained", corrective_authority: correctiveAuthority, armed: pf.armed, enforced: pf.enforced, dial_profile, banner: pf.banner }) + "\n");
  } else {
    console.log(pf.banner);
    console.log(`\nPreflight PASS — L4 run minted: ${runDir}`);
    // FAFF-308: export FAFF_APPETITE=full on the handoff so downstream shells fast-path the
    // level-scoped `full` without a ledger read (belt; the FAFF_RUN_DIR ledger is the brace).
    console.log(`Launch the unattended drain with this run armed:  FAFF_APPETITE=full FAFF_RUN_DIR=${runDir} /faff-beep-boop`);
  }
  return 0;
}

// In-memory selftest of the pure preflight core over synthetic probe fixtures —
// the proceed/refuse table, the armed-state derivation, and the banner 1:1 property.
function lightsOutSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`lights-out --selftest FAIL: ${label}\n`); failed++; } };
  const allReach = () => { const r = {}; for (const id of LIGHTS_OUT_GUARDRAIL_IDS) r[id] = true; return r; };
  const okFloor = { no_execute: true, worktree_isolation: true, autonomous_contract: true };
  // Coherent default dial (FAFF-298): adversarial review + spec_review, fail-closed
  // gates, no recipe — so the happy path proceeds. A fixture overrides `dial` to drive
  // the reckless-combination cases.
  const coherentDial = () => ({
    level: "L4",
    slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-dark-spec-review" },
    gates_fallback: "fail-closed",
    recipe: null,
  });
  const armedProbes = (over = {}) => ({
    container: "contained", reachable: allReach(), reviewReachable: true,
    specReviewSlot: true, budgetCeilingSet: true, floor: { ...okFloor }, dial: coherentDial(), ...over,
  });

  // Happy path: every guardrail live, all preconditions met → proceed, all-8-live.
  const happy = lightsOutPreflight(armedProbes());
  check("happy path proceeds", happy.proceed === true && happy.refusals.length === 0);
  check("all 8 guardrails live", LIGHTS_OUT_GUARDRAIL_IDS.every((id) => happy.armed[id] === "live"));
  check("armed covers exactly the 8 guardrails", Object.keys(happy.armed).length === 8);

  // Banner is derivable 1:1 from armed: every guardrail id + state appears.
  for (const id of LIGHTS_OUT_GUARDRAIL_IDS) check(`banner names ${id}`, happy.banner.includes(id));
  check("banner reports ARMED on proceed", /ARMED/.test(happy.banner));

  // FAFF-305 — enforced map: reported alongside armed, fail-closed via strict === true.
  check("preflight returns an enforced map", happy.enforced && typeof happy.enforced === "object");
  check("enforced map covers exactly the 8 guardrails", Object.keys(happy.enforced || {}).length === 8);
  check("holdout is now enforced (the per-run holdout phase invokes the env→evaluate chain)", happy.enforced.holdout === true);
  check("all 8 guardrails are enforced",
    LIGHTS_OUT_GUARDRAIL_IDS.every((id) => happy.enforced[id] === true));
  check("enforced count is 8/8",
    LIGHTS_OUT_GUARDRAIL_IDS.filter((id) => happy.enforced[id] === true).length === 8);
  // Strict === true: a truthy-but-not-true flag (1) reads as NOT enforced (fail-closed);
  // a missing flag reads false; only an exact `true` counts.
  const strict = lightsOutEnforced([
    { id: "exact", enforced: true },
    { id: "truthy", enforced: 1 },
    { id: "string", enforced: "true" },
    { id: "missing" },
  ]);
  check("strict === true: exact true is enforced", strict.exact === true);
  check("strict === true: truthy-non-true (1) is NOT enforced", strict.truthy === false);
  check("strict === true: string 'true' is NOT enforced", strict.string === false);
  check("strict === true: missing flag is NOT enforced (fail-closed)", strict.missing === false);
  // proceed is UNCHANGED by enforcement (it turns only on reachability — banner honesty only).
  check("proceed unchanged by enforcement (banner honesty only)", happy.proceed === true);

  // Banner: status line states enforcement; no guardrail line shows a bare "live".
  check("proceed-path status line reads 8/8 enforced with no trailing clause",
    happy.banner.includes("ARMED — 8/8 enforced") && !happy.banner.includes("reachable-but-not-enforced"));
  const guardrailLines = happy.banner.split("\n").filter((l) => /^ {4}[●◐○] /.test(l));
  check("every guardrail line carries a reachability token",
    guardrailLines.length === 8 && guardrailLines.every((l) => /reachable:/.test(l)));
  check("every guardrail line carries an enforcement token (no bare live)",
    guardrailLines.every((l) => /\b(enforced|reachable-only)\b/.test(l)));
  check("holdout line shows reachable:live with enforced token",
    guardrailLines.some((l) => /\bholdout\b/.test(l) && /reachable:live/.test(l) && /\benforced\b/.test(l)));

  // Status line generalises: an all-enforced table yields N/N with no trailing clause.
  const allEnf = {}; for (const id of LIGHTS_OUT_GUARDRAIL_IDS) allEnf[id] = true;
  const allEnfBanner = renderLightsOutBanner(happy.armed, okFloor, true, armedProbes(), allEnf);
  check("all-enforced status line reads N/N with no trailing clause",
    allEnfBanner.includes(`ARMED — ${LIGHTS_OUT_GUARDRAIL_IDS.length}/${LIGHTS_OUT_GUARDRAIL_IDS.length} enforced`) &&
    !allEnfBanner.includes("reachable-but-not-enforced"));

  // Container not_confirmed → refuse, container guardrail absent, banner REFUSED.
  const bare = lightsOutPreflight(armedProbes({ container: "not_confirmed", reachable: { ...allReach(), container: false } }));
  check("bare host refuses", bare.proceed === false);
  check("container guardrail absent on bare host", bare.armed.container === "absent");
  check("bare-host refusal names container gate", bare.refusals.some((r) => r.gate === "guardrail:container"));
  check("banner reports REFUSED on bare host", /REFUSED/.test(bare.banner));
  // FAFF-305: the REFUSED status line is unchanged (a guardrail-not-live suffix), and
  // per-guardrail lines still carry the enforcement token on the refuse path too.
  check("REFUSED status line unchanged", bare.banner.includes("REFUSED — preflight not satisfied (a guardrail is not live)"));
  check("refuse-path guardrail lines still carry enforcement token",
    bare.banner.split("\n").filter((l) => /^ {4}[●◐○] /.test(l)).every((l) => /\b(enforced|reachable-only)\b/.test(l)));

  // Review slot unreachable → refuse (configured-but-down == absent, never pass+skip).
  const noReview = lightsOutPreflight(armedProbes({ reviewReachable: false }));
  check("unreachable review slot refuses", noReview.proceed === false && noReview.refusals.some((r) => r.gate === "review-slot"));

  // spec_review slot down but its contract live → degraded armed-state + refuse.
  const downSpecReview = lightsOutPreflight(armedProbes({ specReviewSlot: false }));
  check("spec_review slot down → degraded", downSpecReview.armed.spec_review === "degraded");
  check("spec_review slot down refuses", downSpecReview.proceed === false && downSpecReview.refusals.some((r) => r.gate === "spec_review-slot"));

  // No budget ceiling → refuse (no unbounded lights-out run).
  const noBudget = lightsOutPreflight(armedProbes({ budgetCeilingSet: false }));
  check("no budget ceiling refuses", noBudget.proceed === false && noBudget.refusals.some((r) => r.gate === "budget-ceiling"));
  check("budget-ceiling refusal names the spend/time remedy",
    noBudget.refusals.find((r) => r.gate === "budget-ceiling").detail.includes("spend/time") &&
    /budget\.tokens|budget\.until/.test(noBudget.refusals.find((r) => r.gate === "budget-ceiling").detail));

  // FAFF-364 — a malformed budget.until/--until refuses REGARDLESS of other ceilings:
  // a clean budgetCeilingSet:true (e.g. a valid budget.tokens) does not excuse it.
  const badUntilWithTokens = lightsOutPreflight(armedProbes({ budgetUntilInvalid: "25:00" }));
  check("malformed until refuses even with a clean tokens ceiling set",
    badUntilWithTokens.proceed === false && badUntilWithTokens.refusals.some((r) => r.gate === "budget-until-invalid"));
  check("budget-until-invalid refusal names the raw value",
    badUntilWithTokens.refusals.find((r) => r.gate === "budget-until-invalid").detail.includes("25:00"));
  check("budget-ceiling gate does NOT also fire when a clean ceiling is set alongside a bad until",
    !badUntilWithTokens.refusals.some((r) => r.gate === "budget-ceiling"));

  // Malformed until as the ONLY ceiling → BOTH budget-ceiling and budget-until-invalid fire.
  const badUntilOnly = lightsOutPreflight(armedProbes({ budgetCeilingSet: false, budgetUntilInvalid: "garbage" }));
  check("malformed-until-as-only-ceiling: budget-ceiling fires",
    badUntilOnly.refusals.some((r) => r.gate === "budget-ceiling"));
  check("malformed-until-as-only-ceiling: budget-until-invalid ALSO fires",
    badUntilOnly.refusals.some((r) => r.gate === "budget-until-invalid"));

  // A null budgetUntilInvalid (the common/valid case) never fires the gate.
  check("null budgetUntilInvalid never fires budget-until-invalid",
    !happy.refusals.some((r) => r.gate === "budget-until-invalid"));

  // FAFF-312 — spend/time ceiling predicate: a count-cap alone is NOT an L4 governor.
  // Driven both on hand-built envelopes (to exercise the guard directly) and on real
  // envelopeFrom output (the path cmdLightsOut actually takes).
  check("spend/time: tokens-only is a ceiling",
    spendTimeCeilingSet({ ceilings: { tokens: 100, until: null, max_attempts: null, cost: null }, price_per_mtok: 0 }) === true);
  check("spend/time: until-only is a ceiling",
    spendTimeCeilingSet({ ceilings: { until: "07:00", tokens: null, max_attempts: null, cost: null }, price_per_mtok: 0 }) === true);
  check("spend/time: max_attempts-only is NOT a ceiling",
    spendTimeCeilingSet({ ceilings: { max_attempts: 40, tokens: null, until: null, cost: null }, price_per_mtok: 0 }) === false);
  check("spend/time: priced cost is a ceiling",
    spendTimeCeilingSet({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, price_per_mtok: 3 }) === true);
  check("spend/time: unpriced cost is NOT a ceiling (vacuous)",
    spendTimeCeilingSet({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, price_per_mtok: 0 }) === false);
  check("spend/time: max_attempts alongside tokens IS a ceiling",
    spendTimeCeilingSet({ ceilings: { max_attempts: 40, tokens: 100, until: null, cost: null }, price_per_mtok: 0 }) === true);
  check("spend/time (real envelope): count-only refuses",
    spendTimeCeilingSet(envelopeFrom({ budget: { max_attempts: 40 } }, {})) === false);
  check("spend/time (real envelope): tokens proceeds",
    spendTimeCeilingSet(envelopeFrom({ budget: { tokens: 5_000_000 } }, {})) === true);
  check("spend/time (real envelope): unpriced cost refuses",
    spendTimeCeilingSet(envelopeFrom({ budget: { cost: 5, price_per_mtok: 0 } }, {})) === false);
  check("spend/time (real envelope): --until flag proceeds",
    spendTimeCeilingSet(envelopeFrom({}, { until: "07:00" })) === true);
  // FAFF-364 — a malformed --until never satisfies the spend/time governor: it
  // resolves to a null ceiling (until_invalid set instead), the exact case the
  // budget-until-invalid preflight gate exists to catch on its own.
  check("spend/time (real envelope): malformed --until does NOT satisfy the governor",
    spendTimeCeilingSet(envelopeFrom({}, { until: "garbage" })) === false);

  // FAFF-312 — mint-time at_ceiling default: escalate-when-unset, explicit honoured.
  check("mint at_ceiling: unset → escalate (L4 default)", mintAtCeiling({}) === "escalate");
  check("mint at_ceiling: no budget block → escalate", mintAtCeiling({ budget: {} }) === "escalate");
  check("mint at_ceiling: explicit stop honoured verbatim", mintAtCeiling({ budget: { at_ceiling: "stop" } }) === "stop");
  check("mint at_ceiling: explicit escalate honoured", mintAtCeiling({ budget: { at_ceiling: "escalate" } }) === "escalate");
  check("mint at_ceiling: explicit narrow honoured", mintAtCeiling({ budget: { at_ceiling: "narrow" } }) === "narrow");
  check("mint at_ceiling: unrecognised value (typo) fails safe to escalate, NOT stop", mintAtCeiling({ budget: { at_ceiling: "escalte" } }) === "escalate");

  // --prd-creative-licence flag → ledger prd_creative_licence resolution.
  check("prd licence: absent flag → null (no PRD gate ran)", prdCreativeLicenceFromFlag(null).ok === true && prdCreativeLicenceFromFlag(null).value === null);
  check("prd licence: broad → broad", prdCreativeLicenceFromFlag("broad").ok === true && prdCreativeLicenceFromFlag("broad").value === "broad");
  check("prd licence: tight → tight", prdCreativeLicenceFromFlag("tight").ok === true && prdCreativeLicenceFromFlag("tight").value === "tight");
  check("prd licence: off-vocabulary → not ok (fail loud, never a silent null)", prdCreativeLicenceFromFlag("wide").ok === false && prdCreativeLicenceFromFlag("wide").value === null);

  // Keystone (sentry) probe fails → refuse, no reduced mode.
  const noSentry = lightsOutPreflight(armedProbes({ reachable: { ...allReach(), kill_switch: false } }));
  check("keystone kill_switch probe fail → absent", noSentry.armed.kill_switch === "absent");
  check("keystone probe failure refuses (no reduced mode)", noSentry.proceed === false && noSentry.refusals.some((r) => r.gate === "guardrail:kill_switch"));

  // Holdout keystone probe fails → refuse.
  const noHoldout = lightsOutPreflight(armedProbes({ reachable: { ...allReach(), holdout: false } }));
  check("keystone holdout probe failure refuses", noHoldout.proceed === false && noHoldout.refusals.some((r) => r.gate === "guardrail:holdout"));

  // Floor assertion failure → refuse.
  const noFloor = lightsOutPreflight(armedProbes({ floor: { ...okFloor, no_execute: false } }));
  check("floor assertion failure refuses", noFloor.proceed === false && noFloor.refusals.some((r) => r.gate === "floor:no_execute"));

  // ---- FAFF-379: worktree_isolation is a CHECKED floor entry (real probe); the ----
  // other two are STATIC invariants. Synthetic-floor refuse + floor_detail passthrough
  // + banner mode tokens + the pure checkWorktreeIsolation probe over an injected fsq.
  const noWtFloor = lightsOutPreflight(armedProbes({ floor: { ...okFloor, worktree_isolation: false } }));
  check("worktree_isolation floor failure refuses with its named gate",
    noWtFloor.proceed === false && noWtFloor.refusals.some((r) => r.gate === "floor:worktree_isolation"));
  check("floor refusal without floor_detail keeps the generic message",
    /does not hold/.test(noWtFloor.refusals.find((r) => r.gate === "floor:worktree_isolation").detail));
  // floor_detail passthrough: a supplied per-key detail becomes the refusal detail verbatim.
  const wtDetail = "worktree root '/x/wt' is inside the repo working tree — synthetic";
  const detailFloor = lightsOutPreflight(armedProbes({
    floor: { ...okFloor, worktree_isolation: false }, floor_detail: { worktree_isolation: wtDetail },
  }));
  check("floor_detail passthrough: refusal detail equals the supplied string",
    detailFloor.refusals.find((r) => r.gate === "floor:worktree_isolation").detail === wtDetail);
  // Banner: worktree-isolation renders `checked`, the two statics render `static`.
  check("banner floor line marks worktree-isolation checked and the others static",
    /worktree-isolation ✓ checked/.test(happy.banner)
    && /no-execute ✓ static/.test(happy.banner)
    && /autonomous-contract ✓ static/.test(happy.banner));

  // Direct checkWorktreeIsolation over a synthetic fsq (no real filesystem touched).
  const isoFsq = (existing, writableSet) => ({
    exists: (p) => existing.has(p),
    isDirectory: (p) => existing.has(p),        // every existing synthetic path is a dir unless overridden
    writable: (p) => writableSet.has(p),
    readEnviron: () => "",
  });
  const repoR = "/repo";
  const insideV = checkWorktreeIsolation("/repo/wt", repoR, isoFsq(new Set(["/repo"]), new Set(["/repo"])));
  check("checkWorktreeIsolation: inside-repo root refuses", insideV.holds === false && /inside the repo/.test(insideV.detail));
  check("checkWorktreeIsolation: repo root itself refuses",
    checkWorktreeIsolation("/repo", repoR, isoFsq(new Set(["/repo"]), new Set(["/repo"]))).holds === false);
  // segment-aware: a sibling sharing a name prefix is NOT inside (bare startsWith would misfire).
  check("checkWorktreeIsolation: sibling sharing a name prefix is outside",
    checkWorktreeIsolation("/repository/wt", repoR, isoFsq(new Set(["/repository"]), new Set(["/repository"]))).holds === true);
  const okV = checkWorktreeIsolation("/outside/wt", repoR, isoFsq(new Set(["/outside"]), new Set(["/outside"])));
  check("checkWorktreeIsolation: writable outside root with nonexistent leaf holds", okV.holds === true && okV.detail === null);
  const roV = checkWorktreeIsolation("/outside/wt", repoR, isoFsq(new Set(["/outside"]), new Set()));
  check("checkWorktreeIsolation: non-writable ancestor refuses", roV.holds === false && /not writable/.test(roV.detail));
  const fileFsq = { exists: (p) => p === "/outside", isDirectory: () => false, writable: () => true, readEnviron: () => "" };
  const ndV = checkWorktreeIsolation("/outside/wt", repoR, fileFsq);
  check("checkWorktreeIsolation: non-directory ancestor refuses", ndV.holds === false && /non-directory/.test(ndV.detail));
  const throwFsq = { exists: () => { throw new Error("boom"); }, isDirectory: () => true, writable: () => true, readEnviron: () => "" };
  const thrownV = checkWorktreeIsolation("/outside/wt", repoR, throwFsq);
  check("checkWorktreeIsolation: fsq throw is caught → fail-closed", thrownV.holds === false && /boom/.test(thrownV.detail));

  // Every derived armed state is in the closed vocabulary.
  check("armed states are in {live,degraded,absent}", LIGHTS_OUT_GUARDRAIL_IDS.every((id) => GUARDRAIL_STATES.has(happy.armed[id]) && GUARDRAIL_STATES.has(bare.armed[id])));

  // ---- Dial-coherence (FAFF-298) -----------------------------------------
  // The coherent default dial proceeds (folded into the happy path above too).
  check("coherent dial proceeds (no coherence refusals)",
    happy.proceed === true && !happy.refusals.some((r) => r.gate.startsWith("dial-coherence:")));

  // Rule (A) — a non-adversarial review occupant refuses with its named gate; every
  // basic precondition still passes so the ONLY refusal is the coherence one.
  const reckReview = lightsOutPreflight(armedProbes({
    dial: { ...coherentDial(), slots: { review: "faffter-noon-review", spec_review: "faffter-dark-spec-review" } },
  }));
  check("Rule A: non-adversarial review refuses",
    reckReview.proceed === false && reckReview.refusals.some((r) => r.gate === "dial-coherence:adversarial-review"));
  check("Rule A: review refusal is the only refusal (basic checks all pass)",
    reckReview.refusals.length === 1);

  // Rule (A) — a non-adversarial spec_review occupant refuses with its named gate.
  const reckSpecReview = lightsOutPreflight(armedProbes({
    dial: { ...coherentDial(), slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-noon-spec-review" } },
  }));
  check("Rule A: non-adversarial spec_review refuses",
    reckSpecReview.proceed === false && reckSpecReview.refusals.some((r) => r.gate === "dial-coherence:adversarial-spec-review"));

  // Rule (B) — gates.fallback = advisory refuses with its named gate.
  const reckGates = lightsOutPreflight(armedProbes({
    dial: { ...coherentDial(), gates_fallback: "advisory" },
  }));
  check("Rule B: advisory gates.fallback refuses",
    reckGates.proceed === false && reckGates.refusals.some((r) => r.gate === "dial-coherence:gates-fallback"));

  // Edge: an unrecognised gates.fallback token refuses fail-closed (inequality).
  const reckGatesTypo = lightsOutPreflight(armedProbes({
    dial: { ...coherentDial(), gates_fallback: "fail-clsoed" },
  }));
  check("Edge: unrecognised gates.fallback token refuses fail-closed",
    reckGatesTypo.refusals.some((r) => r.gate === "dial-coherence:gates-fallback"));

  // Edge: null / unknown occupant names refuse fail-closed, not a silent pass.
  check("Edge: null review occupant refuses fail-closed",
    dialCoherence({ slots: { review: null, spec_review: "faffter-dark-spec-review" }, gates_fallback: "fail-closed" })
      .some((r) => r.gate === "dial-coherence:adversarial-review"));
  check("Edge: unknown (bespoke) review occupant refuses fail-closed",
    dialCoherence({ slots: { review: "my-custom-reviewer", spec_review: "faffter-dark-spec-review" }, gates_fallback: "fail-closed" })
      .some((r) => r.gate === "dial-coherence:adversarial-review"));

  // isAdversarial classifier: false for null/unknown, true for an allowlisted name.
  check("isAdversarial(null) is false", isAdversarial(null, ADVERSARIAL_REVIEW_OCCUPANTS) === false);
  check("isAdversarial(unknown) is false", isAdversarial("nope", ADVERSARIAL_REVIEW_OCCUPANTS) === false);
  check("isAdversarial(allowlisted) is true", isAdversarial("faffter-dark-adversarial-review", ADVERSARIAL_REVIEW_OCCUPANTS) === true);

  // FAFF-377: VETTED_RECIPES is empty, so a recipe name alone never short-circuits —
  // an otherwise-reckless dial still yields refusals even with a recognised recipe name.
  check("named recipe does NOT short-circuit a reckless dial",
    dialCoherence({ recipe: "mature-prod", slots: { review: "faffter-noon-review", spec_review: "faffter-noon-spec-review" }, gates_fallback: "advisory" }).length > 0);
  const vettedProceed = lightsOutPreflight(armedProbes({
    dial: { level: "L4", recipe: "mature-prod", slots: { review: "faffter-dark-adversarial-review", spec_review: "faffter-dark-spec-review" }, gates_fallback: "fail-closed" },
  }));
  check("recipe name + a coherent dial proceeds (via Rules A+B, not the name)", vettedProceed.proceed === true);

  // Edge: a non-vetted recipe string falls THROUGH to the standalone rules (no auto-pass).
  check("non-vetted recipe falls through to the standalone rules",
    dialCoherence({ recipe: "made-up-recipe", slots: { review: "faffter-noon-review", spec_review: "faffter-noon-spec-review" }, gates_fallback: "advisory" }).length > 0);

  // FAFF-377 trip-wire: VETTED_RECIPES must stay empty until FAFF-18 satisfies the
  // re-population contract (schema guarantees-by-construction, or verify-not-trust).
  check("VETTED_RECIPES empty until FAFF-18", VETTED_RECIPES.size === 0);

  // Assertion: every coherence refusal carries a `dial-coherence:` gate and a non-empty detail.
  const allCoherenceRefusals = [...reckReview.refusals, ...reckSpecReview.refusals, ...reckGates.refusals]
    .filter((r) => r.gate.startsWith("dial-coherence:"));
  check("coherence refusals are greppable + have non-empty detail",
    allCoherenceRefusals.length >= 3 && allCoherenceRefusals.every((r) => /^dial-coherence:/.test(r.gate) && typeof r.detail === "string" && r.detail.length > 0));

  // preflight with NO dial supplied skips coherence (internal callers only; the
  // wrapper always supplies one) — proves the guard, not a silent coherence pass.
  const noDial = lightsOutPreflight({ container: "contained", reachable: allReach(), reviewReachable: true, specReviewSlot: true, budgetCeilingSet: true, floor: { ...okFloor } });
  check("no-dial preflight proceeds (coherence guard skips absent dial)",
    noDial.proceed === true && !noDial.refusals.some((r) => r.gate.startsWith("dial-coherence:")));

  if (failed) { console.log(`lights-out --selftest: FAIL (${failed} failed)`); return 1; }
  console.log("lights-out --selftest: ok");
  return 0;
}


module.exports = { ADVERSARIAL_REVIEW_OCCUPANTS, ADVERSARIAL_SPEC_REVIEW_OCCUPANTS, FLOOR_LABELS, FLOOR_MODES, GUARDRAIL_STATES, LIGHTS_OUT_FLOOR_KEYS, LIGHTS_OUT_GUARDRAILS, LIGHTS_OUT_GUARDRAIL_IDS, VETTED_RECIPES, checkWorktreeIsolation, cmdLightsOut, cmdWorktreeRoot, dialCoherence, isAdversarial, isStrictlyUnderRoot, lightsOutArmed, lightsOutEnforced, lightsOutPreflight, lightsOutSelftest, mintAtCeiling, prdCreativeLicenceFromFlag, probeContractReachable, renderLightsOutBanner, resolveSlotOccupant, resolveWorktreeRoot, spendTimeCeilingSet, worktreeRootSelftest };
