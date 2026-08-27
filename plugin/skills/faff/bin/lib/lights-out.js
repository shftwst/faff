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

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { AT_CEILING_OUTCOMES, byModelClassTotal, closeSpanDeltaByModel, envelopeFrom, measureTokensByClass, measureTokensByModelClass } = require("./budget");
const { unmeteredFleetEngines } = require("./backends");
const { DEFAULTS, loadConfig } = require("./config");
const { containerCheck, hostSocketProbe, realFsq } = require("./container-check");
const { isSafeRunId } = require("./contain");
const { correctiveIntegrityProbe } = require("./corrective-integrity");
const { appendRecordUnderLock } = require("./events");
const { recoveryClaimStore, resolveBundleStoreName } = require("./bundle");
const { mutateLedgerUnderLock, overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { applyResumeToLedger, classifyReEnterable, reconstructResumePlan, renderResumeBanner, runResumeEvent } = require("./resume");
const { dig, findRoot, homeDir, mainWorktreeRoot, readLedger } = require("./shared-infra");

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
  const home = homeDir(env);
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
const WORKTREE_ROOT_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--assert": { arity: 1 } } };

function cmdWorktreeRoot(args) {
  if (args.includes("--selftest")) return worktreeRootSelftest();
  const { values, errors } = parseArgs(args, WORKTREE_ROOT_SPEC);
  if (errors.length) return usageError(errors, "usage: faff worktree-root [--assert PATH] [--root DIR] [--json]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const json = !!values["--json"];
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
      detail: `L4 lights-out requires an adversarial spec_review occupant; '${slots.spec_review == null ? "" : slots.spec_review}' is the single-pass default — the approach-challenge would not be adversarial — fix slots.spec_review in .faffrc.local.yaml (set: faffter-dark-spec-review)`,
    });
  }
  // Rule (B) — the engineering gate ladder must fail closed under lights-out; advisory
  // lets a repo with no declared gates pass silently. Any non-fail-closed token refuses.
  if (d.gates_fallback !== "fail-closed") {
    refusals.push({
      gate: "dial-coherence:gates-fallback",
      detail: `gates.fallback is '${d.gates_fallback == null ? "" : d.gates_fallback}' — an unattended run needs fail-closed engineering gates; advisory lets a repo with no declared gates pass silently — fix gates.fallback in .faffrc.local.yaml (set: fail-closed)`,
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

// FAFF-333 — resolve the operator's host-socket boundedness attestation from config,
// FAIL-CLOSED: only an explicit affirmative attests; every other value (false, "false",
// "yes", "1", a typo, unset) leaves the host-socket refuse in force. A bare `=== true`
// alone would silently drop a quoted `engine_bounded: "true"` — the hand-rolled YAML
// parser returns the STRING "true" for a quoted scalar, so `"true" === true` is false —
// into refuse despite the operator doing exactly what the docs said. So accept the
// string spelling too (trimmed, case-insensitive), while staying strict on everything
// unrecognised. Lives here (the impure config-reading wrapper's helper) so the pure
// lightsOutPreflight keeps taking a clean resolved boolean in `probes.engineBounded`.
function engineBoundedFromConfig(cfg) {
  const raw = dig(cfg, "autonomous.engine_bounded");
  return raw === true || String(raw).trim().toLowerCase() === "true";
}

// Pure: the refuse-to-start decision over v1's preconditions + the armed guardrail
// set. Returns { proceed, refusals:[{gate,detail}], armed, enforced, banner, floor,
// degrades }. Proceed iff EVERY guardrail is `live`, the review + spec_review slots
// are reachable, a budget ceiling is set, every floor assertion holds, AND (FAFF-428)
// a token-dependent ceiling's meter is measurable OR the posture is `warn` (which
// proceeds but populates `degrades`). Any other miss refuses.
function lightsOutPreflight(probes) {
  const armed = lightsOutArmed(probes);
  const enforced = lightsOutEnforced();
  const floor = (probes && probes.floor) || {};
  const refusals = [];
  const degrades = [];

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
  // FAFF-333 — host-socket boundedness (ADR-0041 decision 3): a mounted HOST docker
  // socket inside the cage is root-equivalent host control and voids ADR-0010 host
  // isolation, even when container-check itself reports `contained` (containment and
  // boundedness are orthogonal axes — see container-check.js's hostSocketProbe). This
  // is POSITIVE evidence of an unbounded posture, so it REFUSES unconditionally on the
  // lights-out path — no knob softens it, except the operator's own attestation that
  // the same-path socket is actually a BOUNDED nested engine (autonomous.engine_bounded:
  // true), which downgrades this refusal to a warn WITHOUT waiving the containment
  // requirement above.
  // FAFF-713 — a probe that cannot DETERMINE the socket's state (hostSocketState:
  // "error", e.g. a permission-denied path component) is treated the same as a present
  // socket here: the L4 preflight is stricter than `--gate`, so it must not be laxer on
  // this axis. `socketConcern` = present-or-indeterminate; engine_bounded still downgrades.
  const socketConcern = probes.hostSocketPresent || probes.hostSocketState === "error";
  const socketWhat = probes.hostSocketState === "error" ? "present-or-unreadable" : "present";
  if (socketConcern && probes.engineBounded !== true) {
    refusals.push({
      gate: "host-socket",
      detail: `host docker socket ${probes.hostSocketPath || "docker.sock"} ${socketWhat} — voids ADR-0010 host isolation (ADR-0041 decision 3); move to a bounded nested engine (rootless dind/podman/sysbox), or set autonomous.engine_bounded:true to attest a bounded engine at this path`,
    });
  } else if (socketConcern && probes.engineBounded === true) {
    degrades.push({
      gate: "host-socket",
      detail: `host docker socket ${probes.hostSocketPath || "docker.sock"} ${socketWhat} but attested bounded (autonomous.engine_bounded:true) — proceeding on the operator's word; the containment requirement above is unaffected`,
    });
  }
  // Basic preconditions (NOT rich dial-coherence — reckless level+appetite+slots+gates
  // adjudication is a deferred follow-on; v1 does cheap reachability/presence probes).
  if (!probes.reviewReachable)
    refusals.push({ gate: "review-slot", detail: "review slot unreachable (configured-but-unreachable == absent) — the second-opinion gate must refuse, never silently pass+skip" });
  if (!probes.specReviewSlot)
    refusals.push({ gate: "spec_review-slot", detail: "spec_review slot not configured + reachable — spec admission gating would be skipped" });
  if (!probes.budgetCeilingSet)
    refusals.push({ gate: "budget-ceiling", detail: "count-cap only (or no ceiling) — a count is not an L4 governor; set a spend ceiling: budget.cost (dollars — priced per-model x per-class from the ADR-0048 map by default, the recommended L4 governor), or budget.tokens / budget.until. max_attempts may stay as an extra backstop." });
  // FAFF-577 — a lights-out run must never start with governance-read leniency
  // armed: FAFF_CONFIG_BASE_LENIENT downgrades a malformed base (budget/sentry
  // ceilings included) to warn-and-proceed-on-defaults, which is exactly the silent
  // degradation an unattended run cannot absorb. Refuse the mint outright; the
  // hatch is for limping interactively, not living lights-out.
  if (probes.configBaseLenientSet)
    refusals.push({ gate: "config-base-lenient", detail: "FAFF_CONFIG_BASE_LENIENT is set — governance-read leniency must not be armed for a lights-out run (a malformed .faffrc.yaml would silently degrade budget/sentry ceilings to defaults mid-run). Unset the env var and fix .faffrc.yaml (git diff / git checkout .faffrc.yaml). (FAFF-577)" });
  // FAFF-364 — a malformed budget.until / --until must never mint a ledger carrying
  // it: fires REGARDLESS of other ceilings (a clean budget.tokens ceiling does NOT
  // excuse garbage until). When malformed until is the run's ONLY ceiling, the
  // budget-ceiling refusal above ALSO fires (until resolves to null there too) —
  // both refusals present, each naming its own remedy.
  if (probes.budgetUntilInvalid != null)
    refusals.push({ gate: "budget-until-invalid", detail: `budget.until / --until '${probes.budgetUntilInvalid}' is not a valid HH:MM (00-23:00-59) — fix budget.until in .faffrc.yaml or the --until flag` });
  // FAFF-446 — budget.price_per_mtok is REMOVED (the ADR-0048 map is the sole
  // pricing source now). Refusing an L4 mint here carries NO fail-open risk (a
  // refusal blocks the mint outright; it can never mask an in-flight breach the
  // way a `budget check` non-zero exit could — that surface instead degrades to a
  // warning, see cmdBudget), so this is the one call site where the honest,
  // anti-divergence hard-refuse is unconditionally the right posture: an L4 run
  // must not launch under stale config that no longer means what it appears to.
  if (probes.budgetPriceRemoved != null)
    refusals.push({ gate: "budget-price-per-mtok-removed", detail: `budget.price_per_mtok ('${probes.budgetPriceRemoved}') is removed (FAFF-446) — unset it in .faffrc.yaml; budget.cost prices from the ADR-0048 map by default (set budget.price_per_mtok_by_model to override specific models)` });
  // FAFF-604 — a dollar ceiling cannot see an engine whose spend is unobservable
  // (`telemetry: none`). Counting it as zero would report "under budget" on a
  // figure that never saw its spend, so the mint refuses rather than launch an
  // unattended run under a ceiling that silently does not cover part of the fleet.
  // This is the hard half of the refusal pair: mint-time refusal is free of the
  // fail-open risk that keeps `budget check` on a warning (a refusal blocks the
  // mint outright, it can never mask an in-flight breach) — the same reasoning
  // FAFF-446 applied directly above. The two remedies are named, not implied.
  if (Array.isArray(probes.budgetUnmeteredEngines) && probes.budgetUnmeteredEngines.length)
    refusals.push({ gate: "budget-telemetry-unobservable", detail: `budget.cost is set but engine(s) ${probes.budgetUnmeteredEngines.join(", ")} declare telemetry: none — their spend is unobservable and a dollar ceiling cannot see it. Remedy: use budget.window instead of budget.cost, or waive explicitly with budget.allow_unmetered: [${probes.budgetUnmeteredEngines.join(", ")}]` });
  // FAFF-325 / FAFF-525 — the L4 admission side of the corrective-integrity Punt-1 disposition.
  // An absent pid-1 FAFF_INTEGRITY_BOUNDARY declaration (`no-declaration`) DEGRADES to an advisory,
  // it no longer refuses: the cage cannot enforce the matching read-only mount yet (FAFF-517
  // deferred), so demanding the declaration to clear the gate would coerce a lying attestation —
  // the probe asserts `true` from the pid-1 declaration alone (ADR-0061 assert-don't-implement), so
  // a declaration with no real mount is exactly the false attestation ADR-0061 forbids. A truthful
  // softer basis (the FAFF-518 digest custody bracket, made unconditional per L4 run by FAFF-520
  // obligation 5) is the mount-free integrity floor that makes this safe. A VIOLATION basis
  // (env-injection/malformed/dir-mismatch — a declaration exists but failed verification) still
  // REFUSES, naming the specific fault; violation is NEVER level-graded and NEVER degraded — absence
  // is not violation. `probes.correctiveIntegrityBasis` is the FAFF-325 probe's `.basis`, computed
  // ONCE in cmdLightsOut (no run-dir exists yet at admission time, so dir-mismatch can never fire
  // here — only no-declaration / env-injection / malformed; per-issue dir coverage is checked later,
  // at the merge-floor consumer, which is UNCHANGED — it still refuses on absence). "asserted" (or an
  // absent/undefined probe result, for callers of this pure function that predate FAFF-325) never
  // fires here; when FAFF-517 lands, the mount-asserted basis remains the strongest and admits as today.
  if (probes.correctiveIntegrityBasis === "no-declaration") {
    degrades.push({ gate: "corrective-integrity", detail: "no FAFF_INTEGRITY_BOUNDARY declaration in pid-1 environ — proceeding on the FAFF-518 digest custody floor (unconditional per L4 run, FAFF-520 obligation 5). For the stronger mount-asserted basis, compose the value with `faff integrity-boundary` once the cage read-only-mounts the integrity dirs (FAFF-517)" });
  } else if (probes.correctiveIntegrityBasis && probes.correctiveIntegrityBasis !== "asserted") {
    refusals.push({ gate: "corrective-integrity", detail: `corrective-artifact integrity attestation failed verification (basis: ${probes.correctiveIntegrityBasis}) — the FAFF_INTEGRITY_BOUNDARY declaration is present but invalid` });
  }
  // FAFF-428 — the L4 spend governor must be MEASURABLE, not merely configured. A
  // token-dependent ceiling (tokens, or an armed cost per FAFF-427) whose meter is
  // estimate-only (transcripts unreadable) either refuses (default posture) or
  // proceeds with a loud `degrades` entry (explicit `warn` opt-in). An until-only /
  // count-only governor needs no token meter and is untouched by this gate.
  // `probes.meteringMeasurable` absent (an older caller of this pure function) is
  // tolerated as measurable — additive-probe tolerance; the shipped cmdLightsOut
  // always supplies it.
  const meteringMeasurable = probes.meteringMeasurable !== undefined ? !!probes.meteringMeasurable : true;
  if (probes.tokenDependentCeiling && !meteringMeasurable) {
    if (probes.estimateOnlyPosture === "warn") {
      degrades.push({
        gate: "budget-metering",
        detail: "budget metering degraded: estimate-only (attempts x est_tokens_per_attempt) — token/cost ceiling figures may under-report ~10x",
      });
    } else {
      refusals.push({
        gate: "budget-metering",
        detail: "budget meter is estimate-only (transcripts unreadable: session id unset, transcript dir missing, or session file absent) — a token/cost ceiling cannot be measured, only estimated (~10x under-report); fix transcript availability, or set budget.on_estimate_only: warn to accept degraded metering",
      });
    }
  }
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
  const banner = renderLightsOutBanner(armed, floor, proceed, probes, enforced, degrades);
  return { proceed, refusals, armed, enforced, banner, floor, degrades };
}

// Pure: render the human-facing banner — the trust contract. Derivable 1:1 from
// `armed` + `enforced` (every guardrail id, its reachability state, AND its
// enforcement flag appears), so a human can confirm an L4 run without re-deriving
// config — and never reads a bare "live" that conflates reachable with enforced
// (FAFF-305). Persisted into the ledger, not just printed. `enforced` is the
// fail-closed {id: boolean} map from lightsOutEnforced(); a 4-arg call leaves it
// undefined and every line degrades to "reachable-only" (the documented failure
// mode the selftest catches), never throwing.
function renderLightsOutBanner(armed, floor, proceed, probes, enforced, degrades = []) {
  const mark = (s) => (s === "live" ? "●" : s === "degraded" ? "◐" : "○");
  const enf = enforced || {};
  const lines = [];
  // FAFF-351 — L4 is shipped-and-reachable but not yet proven on a real end-to-end
  // holdout run, so the banner carries a "(preview)" caveat on the runtime surface an
  // operator actually confirms an L4 run against (mirrors the gateway levels table's L4
  // row + guarantee table). Dropped when FAFF-435's frontier holdout run passes.
  lines.push(`faff lights-out — L4 (preview) run banner`);
  // FAFF-624: convergence is level-forced at L4 — a constant of the L4 surface (like the level
  // token itself), rendered unconditionally on every banner, derived from no probe. It never
  // reads the convergence config knob; the mint-time dial_profile.convergence stamp carries
  // the same constant into the ledger (see assembleLightsOutPreflight below).
  lines.push(`  level: L4 (preview)   container: ${probes && probes.container === "contained" ? "contained" : "refused"}   convergence: forced`);
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
    // FAFF-428 — a warn-posture proceed still surfaces its metering degrade loudly,
    // mirroring the REFUSED list's rendering (gate: detail), one line per entry.
    if (degrades && degrades.length) {
      lines.push(`  degraded (proceeding):`);
      for (const d of degrades) lines.push(`    ⚠ ${d.gate}: ${d.detail}`);
    }
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
// govern an UNBOUNDED L4 run? `tokens` and `until` always count. `cost` counts
// when it is PRICEABLE — and FAFF-427 makes a dollar ceiling priceable by
// default: under `pricing:"map"` the ADR-0048 map (built-in, plus the
// costliest-known-rate fallback for an unpriced model) always has SOME price to
// apply, so `budget.cost` alone (no `price_per_mtok` needed) is now a sufficient
// L4 governor — the recommended one. Under `pricing:"flat"` the legacy rule
// still applies (`price_per_mtok > 0` required). A raw/synthetic envelope that
// carries no `pricing` field at all (this function's own selftest constructs a
// few by hand, and a future caller may too) falls back to the pre-FAFF-427 rule
// (price_per_mtok > 0) — so a caller not yet updated to stamp `pricing` degrades
// to old, still-correct-if-conservative behaviour rather than a false positive.
// `max_attempts` (a count) is DELIBERATELY excluded: a tally is an L3 cost idiom,
// uncorrelated with project size or doneness, and stalling a healthy run at
// attempt N defeats the point of L4 — so it is legal as an extra backstop but
// never sufficient as the sole L4 ceiling. Replaces the old any-dimension
// `Object.values(ceilings).some(v != null)`.
function spendTimeCeilingSet(envelope) {
  const c = (envelope && envelope.ceilings) || {};
  if (c.tokens != null || c.until != null) return true;
  return costArmed(envelope);
}

// FAFF-428 — is `budget.cost` an ARMED (priceable) ceiling? Split out of
// spendTimeCeilingSet's cost branch (byte-identical logic, same precedence) so a
// SECOND consumer — the budget-metering measurability gate below — can ask "is cost
// priceable" without re-deriving the FAFF-427 pricing rule. `pricing:"map"` always has
// SOME price (the ADR-0048 map + costliest-known-rate fallback); `pricing:"flat"`
// requires an explicit `price_per_mtok > 0`; no `pricing` field at all (a raw/synthetic
// envelope) falls back to the pre-FAFF-427 rule.
function costArmed(envelope) {
  const c = (envelope && envelope.ceilings) || {};
  if (c.cost == null) return false;
  const pricing = envelope && envelope.pricing;
  if (pricing === "map") return true;
  if (pricing === "flat") return envelope.price_per_mtok > 0;
  return !!(envelope && envelope.price_per_mtok > 0);
}

// FAFF-428 — is there a TOKEN-DEPENDENT ceiling armed: one whose breach test needs the
// token meter? `tokens` always counts; an armed `cost` (costArmed above) always counts
// too, since under FAFF-427 map pricing a dollar ceiling prices from token counts. An
// `until`-only (or count-only) governor needs no token meter and is deliberately
// EXCLUDED — a clock is honestly measurable without transcripts, so gating it on
// meter availability would refuse a legitimately-governed run for no reason.
function tokenDependentCeilingArmed(envelope) {
  const c = (envelope && envelope.ceilings) || {};
  return c.tokens != null || costArmed(envelope);
}

// FAFF-428 — the L4 estimate-only-metering posture: what happens when a token-dependent
// ceiling is armed but the meter can't resolve real transcripts. Pure, level-scoped
// local resolver (the `mintAtCeiling` precedent below) — NOT registered in the
// level-blind `DEFAULTS` registry, since the key is consumed only on the L4 path.
// Unset → `refuse` (the fail-closed L4 default: a governor whose instrument is broken
// must refuse, never quietly govern fiction). An unrecognised value ALSO fails safe
// toward `refuse` — the opposite fail-safe direction from `mintAtCeiling`'s typo rule,
// because here `refuse` (not `warn`) is the safe/default posture.
function estimateOnlyPosture(cfg) {
  const raw = dig(cfg, "budget.on_estimate_only");
  if (raw == null) return "refuse";
  const v = String(raw).trim().toLowerCase();
  return (v === "refuse" || v === "warn") ? v : "refuse";
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

// FAFF-515 (ADR-0072): the admitted root PRD's container identity, handed by the same run-start PRD
// gate via `--prd-root-container` and persisted beside `prd_creative_licence` — the durable referent
// the FAFF-494 caller asserts `contained_under_accepted_prd` from (ledger record ∧ `faff contain`).
// Pure resolver, same fail-safe stance as the licence flag: no flag == no PRD gate ran → null record
// (downstream signal false → container-create stays gated); the container flag WITHOUT the licence
// flag means the gate didn't actually run → fail loud, never a silent null; an empty/blank value is
// equally fail-loud (a referent that names nothing cannot anchor containment).
function prdRootContainerFromFlags(container, licence) {
  if (container == null) return { value: null, ok: true };
  if (licence == null) return { value: null, ok: false };
  const v = String(container).trim();
  if (!v) return { value: null, ok: false };
  return { value: v, ok: true };
}

const LIGHTS_OUT_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--check": { arity: 0 },
  "--root": { arity: 1 }, "--id": { arity: 1 }, "--resume": { arity: 1 },
  "--max": { arity: 1 }, "--until": { arity: 1 },
  "--prd-creative-licence": { arity: 1 }, "--prd-root-container": { arity: 1 },
  "--slot-unreachable": { arity: 1, repeatable: true },
} };

function cmdLightsOut(args) {
  if (args.includes("--selftest")) return lightsOutSelftest();
  const parsed = parseArgs(args, LIGHTS_OUT_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff lights-out [--id RUN-ID | --resume RUN-ID] [--check] [--max N] [--until ISO] [--prd-creative-licence broad|tight] [--prd-root-container C] [--slot-unreachable NAME]... [--json] [--root DIR]");
  const values = parsed.values;
  const json = !!values["--json"];
  const checkOnly = !!values["--check"];
  const get = (f) => {
    const v = values[f];
    if (v === undefined) return null;
    return Array.isArray(v) ? (v.length ? v[0] : null) : v;
  };
  const root = get("--root") || findRoot();
  // --slot-unreachable <name> (repeatable): the prose layer passes the result of its
  // real skill-liveness probe; tests use it to drive the configured-but-down refusal.
  const unreachable = new Set(Array.isArray(values["--slot-unreachable"]) ? values["--slot-unreachable"] : (values["--slot-unreachable"] !== undefined ? [values["--slot-unreachable"]] : []));

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

  // FAFF-515 (ADR-0072): the admitted root PRD's container referent rides beside the licence flag.
  // The container flag without the licence flag is a mint refusal (the PRD gate didn't run, so there
  // is no admissibility verdict this referent could be anchored to) — fail loud, never a silent null.
  const prdRoot = prdRootContainerFromFlags(get("--prd-root-container"), get("--prd-creative-licence"));
  if (!prdRoot.ok) {
    const raw = get("--prd-root-container");
    const msg = `lights-out: --prd-root-container requires --prd-creative-licence (the run-start PRD gate's verdict) and a non-empty container (got ${JSON.stringify(raw)})`;
    if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 2;
  }

  const [cfg] = loadConfig(root);
  const binPath = process.argv[1];

  // FAFF-527: --resume <run-id> re-enters an EXISTING run's ledger instead of minting a
  // new one. Mutually exclusive with --id (a resume never renames). The resume path
  // re-fires the SAME preflight assembly below, so it shares the mint's guardrail wiring.
  const resumeId = get("--resume");
  if (resumeId != null) {
    if (get("--id") != null) {
      const msg = "lights-out: --resume and --id are mutually exclusive (a resume continues an existing run-id, never renames a mint)";
      if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", error: msg }) + "\n");
      else process.stderr.write(msg + "\n");
      return 2;
    }
    return resumeLightsOut({ root, cfg, binPath, json, checkOnly, get, unreachable, resumeId });
  }

  // FAFF-757: validate a supplied --id at the same consume site it was previously used
  // unvalidated (path.join(root, ".faff", "runs", runId) at the eventual mkdirSync) — before
  // any preflight probing runs, so a malformed id fails loud without wasting the (possibly
  // slow) guardrail assembly, and mints nothing. isSafeRunId is the same exported predicate
  // guarding `--record`'s traversal risk in contain.js.
  const suppliedId = get("--id");
  if (suppliedId != null && !isSafeRunId(suppliedId)) {
    const msg = `lights-out: --id "${suppliedId}" is not a safe run-id (no path separators, no ".." segments, no control characters) — nothing minted`;
    if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", error: msg }) + "\n");
    else process.stderr.write(msg + "\n");
    return 2;
  }

  // FAFF-527: the preflight assembly (all 8 guardrails + the floor + dial coherence) is
  // shared verbatim between the mint path and the `--resume` re-fire, so a resumed run is
  // judged against the CURRENT config/environment exactly as a fresh mint is. One home for
  // the probe wiring means the two can never drift.
  const A = assembleLightsOutPreflight(root, cfg, binPath, get, unreachable);
  const { pf, envelope, metering, correctiveAuthority, dial_profile, container, floor } = A;

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
    if (json) process.stdout.write(JSON.stringify({ proceed: true, level: "L4", container, corrective_authority: correctiveAuthority, armed: pf.armed, enforced: pf.enforced, banner: pf.banner, checked: true, degrades: pf.degrades }) + "\n");
    else { console.log(pf.banner); console.log(`\nPreflight PASS (--check: no run minted).`); }
    return 0;
  }

  return mintLightsOut({ root, cfg, json, get, pf, envelope, metering, correctiveAuthority, dial_profile, floor, prdLicence, prdRoot });
}

// FAFF-527 — the shared preflight assembly: build every guardrail/floor/dial probe from
// the CURRENT config + environment and run the pure preflight core. Returns everything
// both the mint path and the resume re-fire consume. Extracted verbatim from the mint
// path (byte-for-byte the same probe wiring) so mint/resume never diverge.
function assembleLightsOutPreflight(root, cfg, binPath, get, unreachable) {
  // Container preflight (the containerisation ADR / claude-box): WARN→BLOCK on the
  // lights-out path only — L1–L3 keep today's warn-don't-block behaviour.
  const container = containerCheck(process.env, realFsq()).result;

  // FAFF-333 — host-socket boundedness probe (ADR-0041 decision 3), a DIFFERENT axis
  // from the containment check above: a mounted HOST docker socket is root-equivalent
  // host control regardless of whether containerCheck reports contained. Unconditional
  // refuse on THIS path unless the operator attests the same-path socket is a bounded
  // nested engine (autonomous.engine_bounded) — resolved fail-closed by engineBoundedFromConfig.
  const hostSocket = hostSocketProbe(realFsq());
  const engineBounded = engineBoundedFromConfig(cfg);

  // FAFF-373/325: ONE probe call, TWO consumers — the capability record below (never gated
  // on: `available` once a declaration is genuinely asserted, `channel-D-only` otherwise) AND
  // the corrective-integrity admission REFUSAL in lightsOutPreflight (via probes.correctiveIntegrityBasis
  // below). No run-dir exists yet at admission time (minted only AFTER this preflight decision),
  // so required-dirs is empty here — dir-mismatch can only be detected later, per-issue, at the
  // merge-floor consumer (cmdMergeGate). asserted:true (basis "asserted") records `available`;
  // any unasserted basis records `channel-D-only`.
  const correctiveProbe = correctiveIntegrityProbe(process.env, realFsq(), []);
  const correctiveAuthority = correctiveProbe.asserted ? "available" : "channel-D-only";

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

  // FAFF-428 — sample the meter ONCE at preflight (never a guess): a token-dependent
  // ceiling needs a working meter, not merely a set one. `runStartMs: null` is the
  // documented degenerate path (no run has started yet) — the session-id match alone
  // decides measurability. The SAME sample also becomes the mint-time metering record
  // below (one sample, two uses — never a second, possibly-divergent read).
  const metering = measureTokensByClass({ cwd: root, env: process.env, runStartMs: null });
  const meteringMeasurable = metering.source === "transcript";
  const onEstimateOnlyPosture = estimateOnlyPosture(cfg);
  const tokenDependentCeiling = tokenDependentCeilingArmed(envelope);

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
  // FAFF-428: forward the metering-measurability probe + resolved posture + whether
  // a token-dependent ceiling is armed, so the preflight can refuse/degrade estimate-
  // only metering under a real ceiling.
  // FAFF-446: forward the resolved envelope's price_per_mtok_removed flag so the
  // preflight can hard-refuse a still-configured removed knob at mint time.
  const probes = {
    container, reachable, reviewReachable, specReviewSlot, budgetCeilingSet,
    budgetUntilInvalid: envelope.until_invalid, budgetPriceRemoved: envelope.price_per_mtok_removed,
    // FAFF-604 — only a DOLLAR ceiling is blind to an unmetered engine; a
    // token/window ceiling meters what it can see and labels the rest, so the
    // probe is armed solely when budget.cost is configured.
    budgetUnmeteredEngines: envelope.ceilings.cost != null
      ? unmeteredFleetEngines(cfg, envelope.allow_unmetered) : [],
    // FAFF-577 — the escape hatch armed (set, non-empty) refuses the mint: a
    // lights-out run must never start with governance-read leniency armed.
    configBaseLenientSet: !!process.env.FAFF_CONFIG_BASE_LENIENT,
    floor, floor_detail: floorDetail, dial: coherenceDial,
    meteringMeasurable, estimateOnlyPosture: onEstimateOnlyPosture, tokenDependentCeiling,
    // FAFF-325 — reuse the ONE probe call above; never a second, possibly-divergent read.
    correctiveIntegrityBasis: correctiveProbe.basis,
    // FAFF-333 — reuse the ONE hostSocketProbe call above; never a second, possibly-
    // divergent read. engineBounded is the operator's own attestation (default false).
    hostSocketPresent: hostSocket.present, hostSocketPath: hostSocket.path, hostSocketState: hostSocket.state, engineBounded,
  };
  const pf = lightsOutPreflight(probes);

  // FAFF-308: appetite is level-scoped — at L4 the runner forces `full` unconditionally,
  // ignoring config `appetite` (choosing L4 IS handing over the reins; appetite is not an
  // operator dial here). The level-scoping is recorded at mint time in the ledger, which the
  // `resolveAppetite` brace then reads so every consumer sees `full`.
  const appetite = "full";
  // FAFF-624: convergence is level-forced too, mirroring the appetite forcing directly above —
  // the mint-time record of WHY the within-run convergence loop runs (level-forced), never a
  // consultable boolean. This file must never read the convergence config knob to decide anything;
  // the value is inert at L4 by design (FAFF-534's named anti-pattern). The config-side brace
  // (config.js's resolveConvergence) is the read-chokepoint half of the same guarantee.
  const convergence = "forced";
  const dial_profile = {
    appetite,
    convergence,
    slots: { review: reviewOccupant, spec_review: specReviewOccupant },
    gates: resolveSlotOccupant(cfg, "gates"),
  };

  return { pf, envelope, metering, correctiveAuthority, dial_profile, container, floor };
}

// FAFF-757: bounded retry count for the auto-mint re-mint loop below — small because
// the exclusive create is already the guarantee; entropy just needs to win once. Practically
// unreachable (would require MAX_REMINT_ATTEMPTS-in-a-row entropy collisions), so exhaustion
// is a loud throw, not a policy decision.
const MAX_REMINT_ATTEMPTS = 5;

// FAFF-757: the exclusive-create claim — the directory create IS the uniqueness test, so no
// separate lock artifact is needed. A non-recursive mkdirSync of the leaf is atomic: it throws
// EEXIST iff the name is already taken, which is the collision signal itself (no check-then-create
// TOCTOU). `runsParent` (<root>/.faff/runs) must already exist — callers ensure it first.
//
// supplied:false (auto-mint) — a collision re-mints with a fresh crypto.randomBytes suffix
//   appended AFTER baseId's descriptive tail (preserves sortRunDirsByMtimeDesc's mtime-primary
//   ordering and the STRAY_TRANSCRIPT \b match), bounded retry; exhaustion throws loud.
// supplied:true (a caller-owned --id) — a collision NEVER re-mints (that would silently orphan
//   the caller's handle) — throws loud, directory untouched, pointing the caller at --resume.
//
// Deliberately clock-free and side-effect-minimal beyond the one mkdirSync per attempt, so it is
// testable in isolation: pre-create a directory, call this with its exact base id, and assert.
function claimRunDir(runsParent, baseId, { supplied }) {
  const tryCreate = (id) => {
    try {
      fs.mkdirSync(path.join(runsParent, id)); // non-recursive → atomic; EEXIST iff taken
      return id;
    } catch (e) {
      if (e.code !== "EEXIST") throw e; // a real fs fault (EACCES/ENOSPC/...) stays loud, unchanged
      return null;
    }
  };

  const clean = tryCreate(baseId);
  if (clean != null) return path.join(runsParent, clean);

  // EEXIST — the name is taken.
  if (supplied) {
    throw new Error(`lights-out: run-id "${baseId}" already exists under ${runsParent} — use --resume ${baseId} to re-enter it (never re-minted, never shared)`);
  }
  for (let attempt = 0; attempt < MAX_REMINT_ATTEMPTS; attempt++) {
    const candidate = `${baseId}-${crypto.randomBytes(3).toString("hex")}`; // entropy strictly AFTER the descriptive tail
    const won = tryCreate(candidate);
    if (won != null) return path.join(runsParent, won);
  }
  throw new Error(`lights-out: could not mint a unique run dir after ${MAX_REMINT_ATTEMPTS} attempts under ${runsParent} (base id "${baseId}")`);
}

// FAFF-527: the mint tail — extracted from cmdLightsOut so the resume path can reuse the
// shared assembly above WITHOUT re-minting a new run. Mints the strict-defaults L4
// run-ledger, persists the banner, emits the run-start event.
function mintLightsOut({ root, cfg, json, get, pf, envelope, metering, correctiveAuthority, dial_profile, floor, prdLicence, prdRoot }) {
  // PROCEED: mint the strict-defaults L4 run-ledger, persist the banner, emit run-start.
  // FAFF-312: apply the level-scoped mint-time at_ceiling default (escalate-when-unset,
  // explicit-config-verbatim) into the ledger envelope. envelopeFromLedger reads it back
  // for `faff budget check --run-dir`, so an L4 backstop breach surfaces as `escalate`
  // (Sentry budget-breach + run-done's fixed floor) rather than a silent stop mid-project.
  envelope.at_ceiling = mintAtCeiling(cfg);
  const nowIso = new Date().toISOString();
  const stamp = nowIso.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-"); // YYYYMMDD-HHMMSS

  // FAFF-757: the create is now exclusive (claimRunDir), never the old silent
  // `mkdirSync(runDir, { recursive: true })` — a same-second collision is detected and
  // reacted to per mint path, rather than absorbed into a shared, corrupted ledger.
  const runsParent = path.join(root, ".faff", "runs");
  fs.mkdirSync(runsParent, { recursive: true }); // idempotent; parent only, never the leaf

  // FAFF-757: a supplied --id is already validated by cmdLightsOut (isSafeRunId, before
  // preflight) — mintLightsOut only claims it. supplied:true never re-mints on collision.
  const suppliedId = get("--id");
  let runId, runDir;
  if (suppliedId != null) {
    try {
      runDir = claimRunDir(runsParent, suppliedId, { supplied: true });
      runId = suppliedId;
    } catch (e) {
      if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", error: e.message }) + "\n");
      else process.stderr.write(e.message + "\n");
      return 2;
    }
  } else {
    const baseId = `run-${stamp}-lights-out`; // byte-identical to today's id absent a collision
    runDir = claimRunDir(runsParent, baseId, { supplied: false });
    runId = path.basename(runDir);
  }

  // FAFF-427: best-effort per-model baseline snapshot, additive alongside the
  // envelope — the `budget.cost` map-pricing rule subtracts THIS from later
  // per-model totals to get the run's own delta. It MUST be measured with the
  // SAME file-selection window `budget check` uses at check time — i.e.
  // `runStartMs = this run's start` (owner.started_at, == nowMs here), NOT null.
  // With null the mtime pre-filter is skipped, so a same-session PRIOR run's
  // child transcripts land in the baseline; but at check time those children are
  // pre-filtered OUT (mtime < run start), so the two file sets diverge and the
  // subtraction undercounts this run's spend (a governor must never undercount).
  // Passing the run-start instant makes mint and check select identically.
  // Absent/estimate-degraded (no resolvable transcript at mint) simply omits the
  // field — `budget check` falls back to its pro-rata degrade, never a crash.
  const modelBaseline = measureTokensByModelClass({ cwd: root, env: process.env, runStartMs: Date.parse(nowIso) });
  const budgetBlock = { envelope };
  if (modelBaseline.source === "transcript") {
    budgetBlock.tokens_at_start_by_model_class = Object.fromEntries(modelBaseline.by_model);
    // FAFF-558: additionally write the derived scalar alongside the per-model map —
    // purely additive belt-and-braces alignment for scalar-reading consumers
    // (audit.js/economics.js, the beep-boop ledger docs). Not load-bearing: `budget
    // check`'s read-side derivation already falls back to `byModelClassTotal` of the
    // per-model map above when this scalar is absent, so this write changes no
    // behaviour — it only keeps the two fields from ever disagreeing.
    budgetBlock.tokens_at_start = byModelClassTotal(Object.fromEntries(modelBaseline.by_model));
  }
  // FAFF-560: persist the ambient CLAUDE_CODE_SESSION_ID at mint time as the run's
  // "owning" measuring session — the one whose <sid>.jsonl transcript this run's
  // spend accrues to (the SAME session modelBaseline above was just measured
  // against). `budget check` prefers this over a possibly-drifted ambient session
  // id after a mid-run compaction/hand-off. Deliberately the Claude Code session-id
  // namespace (not FAFF_SESSION_ID, faff's own run-session id used for
  // owner.session_id below) — that namespace does not name a transcript file.
  // Written unconditionally; null (ambient unset at mint) is stored verbatim and
  // read back identically to absent (both falsy → fall through to ambient).
  budgetBlock.measure_session_id = process.env.CLAUDE_CODE_SESSION_ID || null;
  // FAFF-428 — record the metering state at mint, from the SAME sample taken for the
  // preflight probe above (never a second, possibly-divergent read). `degraded` is
  // true only when the budget-metering gate actually fired in warn-posture (a clean
  // measurable mint always records degraded:false).
  budgetBlock.metering = {
    source_at_mint: metering.source,
    degraded: pf.degrades.some((d) => d.gate === "budget-metering"),
  };

  const ledger = {
    run_id: runId,
    level: "L4",
    armed: pf.armed,
    enforced: pf.enforced,
    banner: pf.banner,
    budget: budgetBlock,
    budget_ceiling: envelope.ceilings,
    dial_profile,
    prd_creative_licence: prdLicence.value,
    prd_root_container: prdRoot.value,
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
  // FAFF-575: the mint routes through the same locked core as every other ledger
  // mutation (uniformity — a just-minted run dir cannot contend, so the cost is one
  // uncontended lock cycle, and no second unlocked write path survives to decay). The
  // trivial mutate ignores the fresh read (initial creation); a LEDGER_LOCKED throw
  // here is impossible in practice and would surface as the mint failure it is.
  const mintWriteRes = mutateLedgerUnderLock(runDir, () => ledger);

  // Emit the run-start event onto the observability timeline substrate (FAFF-574: through
  // the shared lock-guarded core — the seq is minted from the log's tail under the lock).
  appendRecordUnderLock(runDir, (seq, _prevRecord, prevHash) => ({ schema: 2, run_id: runId, seq, ts: nowIso, prev: prevHash, phase: "run", type: "run-start" }));

  if (json) {
    // FAFF-679: ledger_sha256_before is always null on a mint (nothing existed to bracket
    // yet) — carried anyway so a mint is byte-consistent with every other Class-A writer.
    process.stdout.write(JSON.stringify({ proceed: true, level: "L4", run_id: runId, run_dir: runDir, container: "contained", corrective_authority: correctiveAuthority, armed: pf.armed, enforced: pf.enforced, dial_profile, banner: pf.banner, degrades: pf.degrades, ledger_sha256_before: mintWriteRes.before_sha256, ledger_sha256_after: mintWriteRes.after_sha256 }) + "\n");
  } else {
    console.log(pf.banner);
    console.log(`\nPreflight PASS — L4 run minted: ${runDir}`);
    // FAFF-308: export FAFF_APPETITE=full on the handoff so downstream shells fast-path the
    // level-scoped `full` without a ledger read (belt; the FAFF_RUN_DIR ledger is the brace).
    console.log(`Launch the unattended drain with this run armed:  FAFF_APPETITE=full FAFF_RUN_DIR=${runDir} /faff-beep-boop`);
  }
  return 0;
}

// FAFF-527 — the resume impure shell (spec §4). Steps 1–4 are side-effect-free; the
// first write is step 5, so `--check` runs 1–4 and prints the plan. Returns the CLI exit.
function resumeLightsOut({ root, cfg, binPath, json, checkOnly, get, unreachable, resumeId }) {
  const emitRefuse = (code, msg, extra) => {
    if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", resume: resumeId, error: msg, ...(extra || {}) }) + "\n");
    else process.stderr.write(msg + "\n");
    return code;
  };

  // STEP 1a: resolve run_dir; a missing dir or unparseable ledger is fail-loud (exit 2,
  // ledger untouched) — never reconstruct a ledger from the events stream.
  const runDir = path.join(root, ".faff", "runs", resumeId);
  if (!fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    return emitRefuse(2, `lights-out --resume: no run-ledger.json under ${runDir} (unknown run-id, or a corrupt/absent ledger — never reconstructed from events)`);
  }
  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) { return emitRefuse(2, `lights-out --resume: malformed ledger in ${runDir}: ${e.message} (fail-loud; the ledger is the single source of truth)`); }

  // STEP 1b: classify re-enterability. Overlay the dedicated heartbeat file over the
  // ledger field, then use runIsHeld to distinguish a live (fresh) from a dead (stale)
  // running owner — the SAME liveness read every other seam uses (no second constant).
  const { runIsHeld } = require("./runcheck");
  const clone = JSON.parse(JSON.stringify(ledger));
  overlayHeartbeat(clone, readHeartbeatFile(runDir));
  const held = runIsHeld(clone, Date.now(), process.env);
  // FAFF-896 read-side backstop: a frozen-fresh running owner whose only event since the
  // last run-resume is that run-resume, aged past the deadclaim grace, is provably dead —
  // reclaim it instead of trusting heartbeat age alone (covers the hard-kill case the
  // same-session resumecheck Stop hook cannot fire on). Flows into the UNCHANGED FAFF-575
  // epoch fence + FAFF-863 claim write path below.
  const { resumeProvablyDead } = require("./resumecheck");
  const provablyDead = resumeProvablyDead(runDir, Date.now(), process.env);
  const cls = classifyReEnterable(ledger, { held, provablyDead });
  if (!cls.reEnterable) return emitRefuse(2, `lights-out --resume: ${cls.refuseReason}`, { state: cls.state });
  const priorState = cls.state;

  // STEP 1c: v1 is sequential-executor only — a parallel concurrency slot refuses (the
  // worktree-contention + merge-race reconstruction is out of scope; see the spec).
  const concurrency = resolveSlotOccupant(cfg, "concurrency");
  if (concurrency && /parallel/i.test(concurrency)) {
    return emitRefuse(2, `lights-out --resume: the configured concurrency slot '${concurrency}' is parallel; v1 resume is sequential-executor only (unset slots.concurrency or select the sequential default to resume)`, { state: priorState });
  }

  // STEP 2: RE-FIRE the full mint preflight against CURRENT config/environment. Any
  // refusal leaves the ledger untouched (mirrors the mint refuse path).
  const A = assembleLightsOutPreflight(root, cfg, binPath, get, unreachable);
  const { pf } = A;
  if (!pf.proceed) {
    if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", resume: resumeId, state: priorState, refusals: pf.refusals, banner: pf.banner }) + "\n");
    else { console.log(pf.banner); console.log(`\nREFUSED — resume preflight not satisfied (ledger untouched):`); for (const r of pf.refusals) console.log(`  ✗ ${r.gate}: ${r.detail}`); }
    return 1;
  }

  // STEP 2b: escalated-budget gate — a budget-escalated re-entry must not silently
  // continue under the same ceiling. Re-resolve the envelope from config (done in the
  // assembly) and confront accumulated spend; still at/over → refuse, naming the key.
  if (priorState === "escalated" && typeof ledger.stop_reason === "string" && ledger.stop_reason.startsWith("budget-escalated")) {
    const stillOver = resumeBudgetStillOverCeiling(binPath, runDir, A.envelope);
    if (stillOver.over) {
      return emitRefuse(1, `lights-out --resume: accumulated spend still at/over the budget ceiling (${stillOver.breached.join(", ") || "budget"}) — raise budget.* in .faffrc and re-run --resume (the human's fix is the config edit; resume never auto-inherits headroom it cannot prove)`, { state: priorState });
    }
  }

  // STEP 4 (pre-write): gather forge/artifact evidence and reconstruct the plan (pure).
  const evidence = gatherResumeEvidence(runDir, root, ledger, binPath);
  const plan = reconstructResumePlan(ledger, evidence);
  const priorEpoch = Number((ledger.owner && ledger.owner.epoch) || 0);
  const wipCommit = ledger.abort && ledger.abort.wip_commit ? ledger.abort.wip_commit : null;
  const banner = renderResumeBanner(resumeId, priorState, priorEpoch + 1, plan, wipCommit);

  // --check: steps 1–4 + print, NO writes (ledger + events byte-identical).
  if (checkOnly) {
    if (json) process.stdout.write(JSON.stringify({ proceed: true, level: "L4", resume: resumeId, state: priorState, checked: true, plan, banner }) + "\n");
    else { console.log(pf.banner); console.log("\n" + banner); console.log("\nResume PASS (--check: no ledger write)."); }
    return 0;
  }

  // STEP 3: budget close-out + re-baseline (shape (a)) — close the prior open span into a
  // measured delta, open a new span baselined at the resume instant. Never closes at zero.
  const nowIso = new Date().toISOString();
  const sessionId = process.env.FAFF_SESSION_ID || null;
  const budgetSessions = closeAndOpenBudgetSessions(ledger, runDir, root, nowIso);

  // STEP 4b: recovery-claim acquisition (FAFF-863) — a write-once ref on the git-remote bundle
  // store gating THIS continuation boundary against a cross-box double-continue. `claims` stays
  // null under the default `local` bundle store, and every claim call below is then skipped
  // outright — a success no-op, since single-box resume is already serialised by the run-dir
  // exclusive-create and there is no cross-box surface to gate. The claim keys on
  // { run_id, run_segment_id: priorEpoch + 1 } — the segment STEP 5 is about to install, and the
  // SAME id every racing executor computes from the (still-unmutated) pre-read ledger.
  const claimSegmentId = priorEpoch + 1;
  const claimIdentity = { run_id: resumeId, run_segment_id: claimSegmentId };
  const claims = resolveBundleStoreName(root) === "git-remote" ? recoveryClaimStore(root) : null;
  let claimSha = null;
  if (claims) {
    const ownerSnapshot = { status: "running", epoch: claimSegmentId, session_id: sessionId, pid: process.pid, started_at: nowIso, last_heartbeat: nowIso };
    let claimResult = claims.acquire(claimIdentity, ownerSnapshot);
    if (!claimResult.acquired && claimResult.reason === "exists") {
      // A claim already exists — reclaimIfStale judges it via the run-ledger's own runIsHeld
      // predicate (reused, not reimplemented) and only lands a lease-matched CAS if it is
      // genuinely stale; a live claim refuses here (reason "held"), never overwritten.
      const reclaim = claims.reclaimIfStale(claimIdentity, ownerSnapshot, process.env);
      claimResult = reclaim.reclaimed
        ? { acquired: true, sha: reclaim.sha }
        : { acquired: false, reason: reclaim.reason, holder: reclaim.holder, detail: reclaim.detail };
    }
    if (!claimResult.acquired) {
      const holderOwner = claimResult.holder && claimResult.holder.owner;
      const livenessNote = claimResult.reason === "held" ? "held (fresh heartbeat)"
        : claimResult.reason === "lease-lost" ? "lease lost to a concurrent reclaimer"
        : claimResult.reason === "store_unavailable" ? "the claim store is unreachable — refusing rather than continuing unguarded"
        : (claimResult.reason || "refused");
      return emitRefuse(2, `lights-out --resume: recovery claim ${claimIdentity.run_id}/seg-${claimSegmentId} refused (${livenessNote})${holderOwner ? ` — held by session ${holderOwner.session_id}, epoch ${holderOwner.epoch}` : ""}${claimResult.detail ? `: ${claimResult.detail}` : ""} — refusing to continue (cross-box double-continue guard, FAFF-863)`, { state: priorState });
    }
    claimSha = claimResult.sha;
  }

  // Read-after-write head-confirm (FAFF-863 "the safety pin"), run immediately before STEP 5's
  // owner-state write: re-read the claim ref head and proceed only if it still points at OUR
  // claim commit. This — never the staleness verdict above — is the actual mutex: it closes the
  // one race a mistimed reclaim could otherwise open (a still-live executor discovers here that a
  // reclaimer superseded it and refuses, so exactly one of the two ever reaches the epoch bump).
  if (claims) {
    const confirm = claims.confirmHead(claimIdentity, claimSha);
    if (!confirm.confirmed) {
      return emitRefuse(2, `lights-out --resume: recovery claim ${claimIdentity.run_id}/seg-${claimSegmentId} head-confirm failed (${confirm.reason || "mismatch"}) — a concurrent executor superseded the claim; refusing to continue (cross-box double-continue guard, FAFF-863)`, { state: priorState });
    }
  }

  // STEP 5: WRITE the re-entry (first side effect) — owner history + new epoch owner +
  // abort→history + cleared stop_reason + resume[] + budget.sessions. FAFF-575: the
  // takeover transform is applied to the FRESH ledger read inside the locked critical
  // section (never the step-1 copy — a concurrent writer's landed mutation between the
  // early read and this write is preserved), and the epoch fence is checked in that
  // same section against the pre-read owner block, so a concurrent resume that took
  // over first makes this one yield instead of clobbering.
  let epoch = null;
  let writeRes;
  try {
    writeRes = mutateLedgerUnderLock(runDir, (fresh) => {
      // The takeover derives ONLY from the under-lock read. A resume is never a mint:
      // a ledger that vanished between the step-1 read and lock acquisition is a fault
      // to refuse loudly (below, via the null-mutate abort), never a stale snapshot to
      // resurrect — and a null fresh also skips the fence, so falling back to the
      // pre-lock copy here would bypass the takeover guard entirely.
      if (!fresh) return null;
      const applied = applyResumeToLedger(fresh, { nowIso, sessionId, pid: process.pid, priorState, plan, budgetSessions });
      epoch = applied.epoch;
      return applied.ledger;
    }, { epoch: priorEpoch, session_id: (ledger.owner && ledger.owner.session_id) || null });
  } catch (e) {
    // A busy ledger lock is retryable by construction — same refuse shape as the
    // concurrent-takeover yield below; the operator re-runs --resume.
    if (e && e.code === "LEDGER_LOCKED") return emitRefuse(1, `lights-out --resume: ${e.message} — retry the resume`, { state: priorState });
    throw e;
  }
  if (writeRes.yielded) return emitRefuse(1, `lights-out --resume: a concurrent resume already took over ${resumeId} — yielding (no write)`, { state: priorState });
  if (!writeRes.written) return emitRefuse(1, `lights-out --resume: run-ledger.json vanished at lock time in ${runDir} — nothing written; re-run --resume`, { state: priorState });

  // Append the run-resume event, continuing the existing seq stream (no second run-start).
  // FAFF-574: through the shared lock-guarded core — seq minted from the log's tail under
  // the lock; run-resume carries its extra fields via runResumeEvent(id, seq, …).
  appendRecordUnderLock(runDir, (seq, _prevRecord, prevHash) => runResumeEvent(resumeId, seq, nowIso, priorState, { ...plan, epoch }, prevHash));

  // STEP 6: HAND OFF exactly as mint does. FAFF-679: the before/after ledger digest
  // pair (Class A of the gateway's mid-bracket write rule).
  if (json) {
    process.stdout.write(JSON.stringify({ proceed: true, level: "L4", resume: resumeId, run_id: resumeId, run_dir: runDir, epoch, state: priorState, plan, banner, ledger_sha256_before: writeRes.before_sha256, ledger_sha256_after: writeRes.after_sha256 }) + "\n");
  } else {
    console.log(banner);
    console.log(`\nRe-entered L4 run (epoch ${epoch}): ${runDir}`);
    console.log(`Continue the unattended drain:  FAFF_APPETITE=full FAFF_RUN_DIR=${runDir} /faff-beep-boop`);
  }
  return 0;
}

// FAFF-527 — dry budget confrontation for the escalated-budget gate. Shells the SAME
// `faff budget check` the governor uses for the ACCUMULATED SPEND (never a re-derived
// counter), then confronts it against the RE-RESOLVED ceiling (the envelope the resume
// preflight resolved from CURRENT config — not the ledger's stored ceiling), so a human
// who raised budget.* in .faffrc gets the headroom their edit granted (the escalation-
// re-entry contract).
//
// FAIL-CLOSED on ambiguity (the house rule, applied to the budget axis this run escalated
// on): an unreadable/indeterminate meter is NOT proof of headroom. When budget check can't
// produce a spend figure (non-zero exit, no stdout, an `indeterminate` outcome, or a parse
// fault) the gate refuses (`over:true, breached:["budget:indeterminate"]`) rather than
// waving the run through — an unknowable spend on a run that already hit its ceiling must
// not silently create headroom. The human re-runs after the transient clears (recoverable),
// which is the safe direction against resuming a still-over run whose meter can't prove it.
function resumeBudgetStillOverCeiling(binPath, runDir, envelope) {
  try {
    const r = spawnSync(process.execPath, [binPath, "budget", "check", "--run-dir", runDir, "--json"], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return { over: true, breached: ["budget:indeterminate"] };
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    if (out.indeterminate === true || out.outcome === "indeterminate") return { over: true, breached: ["budget:indeterminate"] };
    const ceilings = (envelope && envelope.ceilings) || {};
    const spent = out.spent || {};
    const breached = [];
    if (typeof ceilings.tokens === "number" && typeof spent.tokens === "number" && spent.tokens >= ceilings.tokens) breached.push("tokens");
    if (typeof ceilings.cost === "number" && typeof spent.cost === "number" && spent.cost >= ceilings.cost) breached.push("cost");
    return { over: breached.length > 0, breached };
  } catch { return { over: true, breached: ["budget:indeterminate"] }; }
}

// FAFF-527 — the impure evidence gatherer for reconstruction (spec §4 step 4). Per
// admitted issue, reads the durable per-issue artifacts and confronts the forge, so the
// pure reconstructResumePlan can classify. Fail-closed by construction: a shipped claim we
// cannot prove merged (no gh, no merge-record) reconciles to `claimed-shipped-unmerged`
// and parks; never a silent skip.
function gatherResumeEvidence(runDir, root, ledger, binPath) {
  const ev = {};
  const admitted = Array.isArray(ledger.admitted) ? ledger.admitted : [];
  const outcomes = (ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  for (const issue of admitted) {
    const e = {};
    const issueDir = path.join(runDir, issue);
    if (outcomes[issue] === "shipped") {
      const recorded = readJsonSafe(path.join(issueDir, "merge-record.json"));
      e.recorded = recorded && recorded.head_sha ? { pr: recorded.pr ?? null, head_sha: recorded.head_sha, merged: true } : null;
      e.observed = observeForgeMerge(recorded);
    } else if (outcomes[issue] === undefined) {
      // in-flight when the run died — is it at a resumable boundary? The review-hold signal
      // is the ON-DISK twin of the `faff-awaiting-review` label: FAFF-403 writes the
      // `.faff/resume/<issue>/` store (and `review-progress.json`) at the SAME time it applies
      // the label, so the store's presence is the label's local proxy — the impure shell reads
      // it without a tracker round-trip. (reconstructResumePlan also honours an `awaitingReview`
      // evidence key for a future caller that does read the label directly; the shell supplies
      // the on-disk `resumeStore` twin instead.)
      e.resumeStore = fs.existsSync(path.join(root, ".faff", "resume", issue))
        || fs.existsSync(path.join(issueDir, "review-progress.json"));
      const bp = readJsonSafe(path.join(issueDir, "build-progress.json"));
      const complete = !!(bp && bp.build && bp.build.status === "complete");
      e.buildComplete = complete;
      if (complete && bp.build.branch) e.branchExists = branchExistsOnForge(bp.build.branch);
      if (ledger.abort && ledger.abort.wip_commit && ledger.abort.issue === issue) e.wipCommit = ledger.abort.wip_commit;
    }
    ev[issue] = e;
  }
  return ev;
}

// Observe a PR's live merge state from the forge (best-effort). Returns the reconcile
// `observed` shape { pr_merged, merged_head_sha }. No merge-record or no gh ⇒ not-merged
// (fail-closed → the issue parks rather than skipping unproven).
function observeForgeMerge(recorded) {
  if (!recorded || recorded.pr == null) return { pr_merged: false, merged_head_sha: null };
  try {
    const r = spawnSync("gh", ["pr", "view", String(recorded.pr), "--json", "state,mergeCommit"], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return { pr_merged: false, merged_head_sha: null };
    const j = JSON.parse(r.stdout);
    const merged = j.state === "MERGED";
    return { pr_merged: merged, merged_head_sha: merged && j.mergeCommit ? j.mergeCommit.oid : null };
  } catch { return { pr_merged: false, merged_head_sha: null }; }
}

// Does a build-complete-recorded branch still resolve on the forge? A gh/git failure is
// fail-closed to "missing" (the issue parks rather than a silent duplicate rebuild).
function branchExistsOnForge(branch) {
  try {
    const r = spawnSync("git", ["ls-remote", "--heads", "origin", branch], { encoding: "utf8" });
    return r.status === 0 && typeof r.stdout === "string" && r.stdout.trim() !== "";
  } catch { return false; }
}

// FAFF-527 — budget close-out + re-baseline (spec §4 step 3, shape (a)). Closes the prior
// open span into a measured per-model delta and opens a fresh span baselined at the resume
// instant. The close-out follows the spec's three-rung fallback, never granting headroom on
// unknown spend:
//   1. transcript resolvable  → the real per-model delta (close_source "transcript").
//   2. else a durable budget observation (a `budget-checkpoint` event carrying a spend
//      figure) → that figure (close_source "last-observation"). In v1 the checkpoint event
//      carries only {breached, outcome} and no token total, so this rung finds nothing and
//      is a no-op today (the spec Assumptions price this in) — it is wired so a future
//      spend-bearing observation is honoured without a shape change.
//   3. else → close_source "degraded", recorded honestly (NOT a fabricated figure): the
//      degraded close is surfaced on the ledger span (close_source "degraded") and the
//      escalated-budget gate fails closed on an unreadable meter (resumeBudgetStillOverCeiling),
//      so an unknowable prior spend can never SILENTLY grant headroom — the protection is
//      the fail-closed gate + visible degrade, per the spec's "preflight lattice" mechanism,
//      never an invented number.
function closeAndOpenBudgetSessions(ledger, runDir, root, nowIso) {
  const budget = (ledger.budget && typeof ledger.budget === "object") ? ledger.budget : {};
  // Existing sessions, or synthesize span 0 from the mint baseline + minting session.
  let sessions = Array.isArray(budget.sessions) ? budget.sessions.slice() : null;
  if (!sessions) {
    sessions = [{
      session_id: (ledger.owner && ledger.owner.session_id) || null,
      baseline_by_model_class: (budget.tokens_at_start_by_model_class && typeof budget.tokens_at_start_by_model_class === "object") ? budget.tokens_at_start_by_model_class : {},
      closed_delta_by_model_class: null, closed_at: null, close_source: null,
    }];
  }
  // Close the current open span (the last with a null delta).
  const openIdx = (() => { for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i] && sessions[i].closed_delta_by_model_class == null) return i; return -1; })();
  if (openIdx >= 0) {
    const open = sessions[openIdx];
    const priorStart = (ledger.owner && ledger.owner.started_at) ? Date.parse(ledger.owner.started_at) : null;
    let closed = null, closeSource = "degraded";
    // Rung 1: transcript.
    try {
      const env = open.session_id ? { ...process.env, CLAUDE_CODE_SESSION_ID: open.session_id } : process.env;
      const m = measureTokensByModelClass({ cwd: root, env, runStartMs: Number.isFinite(priorStart) ? priorStart : null });
      if (m.source === "transcript") { closed = closeSpanDeltaByModel(open.baseline_by_model_class, m.by_model); closeSource = "transcript"; }
    } catch { /* fall through to rung 2/3 */ }
    // Rung 2: a durable budget observation (no-op in v1 — checkpoints carry no token total).
    if (closed == null) {
      const obs = lastDurableBudgetObservation(runDir);
      if (obs) { closed = obs; closeSource = "last-observation"; }
    }
    // Rung 3: degraded — recorded honestly as an empty delta with close_source "degraded"
    // (never a fabricated figure); headroom is denied by the fail-closed escalated-budget
    // gate + the visible degrade marker, not by inventing a number.
    if (closed == null) closed = {};
    sessions[openIdx] = { ...open, closed_delta_by_model_class: closed, closed_at: nowIso, close_source: closeSource };
  }
  // Open the new span, baselined at the resume instant with the resuming session's sid.
  let newBaseline = {};
  try {
    const m = measureTokensByModelClass({ cwd: root, env: process.env, runStartMs: Date.parse(nowIso) });
    if (m.source === "transcript") newBaseline = Object.fromEntries(m.by_model);
  } catch { /* empty baseline degrade */ }
  sessions.push({
    session_id: process.env.CLAUDE_CODE_SESSION_ID || null,
    baseline_by_model_class: newBaseline, closed_delta_by_model_class: null, closed_at: null, close_source: null,
  });
  return sessions;
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// FAFF-527 — the last durable budget observation for the close-out's rung 2: the most
// recent `budget-checkpoint` event that carries a per-model spend figure. In v1 these
// events carry only {breached, outcome} (no token total), so this returns null and rung 2
// is a documented no-op (spec Assumptions) — it is shaped to honour a future spend-bearing
// observation (`data.spent_by_model_class`) the moment one is emitted, with zero call-site
// change. Returns a `{model:{classes}}` map or null.
function lastDurableBudgetObservation(runDir) {
  try {
    const p = path.join(runDir, "events.jsonl");
    if (!fs.existsSync(p)) return null;
    const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "");
    for (let i = lines.length - 1; i >= 0; i--) {
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      if (e && e.type === "budget-checkpoint" && e.data && e.data.spent_by_model_class && typeof e.data.spent_by_model_class === "object") {
        return e.data.spent_by_model_class;
      }
    }
  } catch { /* degrade to null */ }
  return null;
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
  // FAFF-351 — the L4 preview caveat rides the banner headline + level line.
  check("banner headline carries the L4 (preview) caveat", happy.banner.includes("L4 (preview) run banner"));
  check("banner level line carries the L4 (preview) caveat", happy.banner.includes("level: L4 (preview)"));
  // FAFF-624 — convergence is level-forced at L4, rendered unconditionally on the same level
  // line as a constant of the L4 surface (never derived from a probe, never gated on any dial).
  check("banner level line carries convergence: forced", happy.banner.includes("convergence: forced"));

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

  // FAFF-333 — host socket present (unattested) → REFUSE, unconditionally, even though
  // every other guardrail (incl. container containment) is otherwise happy-path green.
  const hostSocketRefuse = lightsOutPreflight(armedProbes({ hostSocketPresent: true, hostSocketPath: "/var/run/docker.sock" }));
  check("host socket present (unattested) refuses", hostSocketRefuse.proceed === false);
  check("host-socket refusal names its gate + the path + ADR-0041",
    (() => { const r = hostSocketRefuse.refusals.find((r) => r.gate === "host-socket");
      return !!r && r.detail.includes("/var/run/docker.sock") && /ADR-0041/.test(r.detail); })());
  // Attested bounded (autonomous.engine_bounded:true) → downgrades to a warn, proceeds —
  // the containment requirement (container: "contained" from armedProbes()) still applies.
  const hostSocketAttested = lightsOutPreflight(armedProbes({ hostSocketPresent: true, hostSocketPath: "/var/run/docker.sock", engineBounded: true }));
  check("host socket present + engine_bounded:true proceeds", hostSocketAttested.proceed === true);
  check("host socket present + engine_bounded:true carries a degrades[] warn naming host-socket",
    hostSocketAttested.degrades.some((d) => d.gate === "host-socket"));
  check("host socket present + engine_bounded:true never carries a host-socket refusal",
    !hostSocketAttested.refusals.some((r) => r.gate === "host-socket"));
  // FAFF-713 — a probe that CAN'T DETERMINE the socket (hostSocketState:"error") is
  // fail-safe: refuse when unattested, degrade when engine_bounded:true (same as present).
  const hostSocketErrRefuse = lightsOutPreflight(armedProbes({ hostSocketState: "error", hostSocketPath: "/var/run/docker.sock" }));
  check("host socket state:error (unattested) refuses", hostSocketErrRefuse.proceed === false);
  check("host-socket error refusal names the indeterminate case + the path",
    (() => { const r = hostSocketErrRefuse.refusals.find((r) => r.gate === "host-socket");
      return !!r && r.detail.includes("/var/run/docker.sock") && /present-or-unreadable/.test(r.detail); })());
  const hostSocketErrAttested = lightsOutPreflight(armedProbes({ hostSocketState: "error", hostSocketPath: "/var/run/docker.sock", engineBounded: true }));
  check("host socket state:error + engine_bounded:true degrades (proceeds)", hostSocketErrAttested.proceed === true);
  check("host socket state:error + engine_bounded:true carries a host-socket degrade, no refusal",
    hostSocketErrAttested.degrades.some((d) => d.gate === "host-socket") && !hostSocketErrAttested.refusals.some((r) => r.gate === "host-socket"));
  // Socket absent (the byte-for-byte-unchanged default, since armedProbes() supplies no
  // hostSocketPresent key at all) → the happy path above already proves this: `happy`
  // has proceed:true and zero refusals with hostSocketPresent left unset entirely.
  check("socket absent (unset) is byte-for-byte unchanged — happy path carries no host-socket refusal",
    !happy.refusals.some((r) => r.gate === "host-socket"));

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
  // FAFF-427: the remedy now LEADS with budget.cost (dollars, the recommended
  // default L4 governor — priced from the ADR-0048 map with no price_per_mtok
  // needed), naming budget.tokens/budget.until as the alternatives.
  check("budget-ceiling refusal names the spend remedy, leading with budget.cost",
    noBudget.refusals.find((r) => r.gate === "budget-ceiling").detail.includes("spend ceiling") &&
    /budget\.cost/.test(noBudget.refusals.find((r) => r.gate === "budget-ceiling").detail) &&
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

  // FAFF-577 — the FAFF_CONFIG_BASE_LENIENT hatch armed refuses the mint outright.
  const hatchArmed = lightsOutPreflight(armedProbes({ configBaseLenientSet: true }));
  check("config-base-lenient hatch armed refuses",
    hatchArmed.proceed === false && hatchArmed.refusals.some((r) => r.gate === "config-base-lenient"));
  check("config-base-lenient refusal names the hatch + remedy",
    /FAFF_CONFIG_BASE_LENIENT/.test(hatchArmed.refusals.find((r) => r.gate === "config-base-lenient").detail) &&
    /\.faffrc\.yaml/.test(hatchArmed.refusals.find((r) => r.gate === "config-base-lenient").detail));
  check("hatch unset (the common case) never fires config-base-lenient",
    !happy.refusals.some((r) => r.gate === "config-base-lenient"));

  // FAFF-446 — a still-configured budget.price_per_mtok hard-refuses the L4 mint
  // (no fail-open risk at this call site, unlike `budget check`'s warn-and-ignore).
  const priceRemoved = lightsOutPreflight(armedProbes({ budgetPriceRemoved: "3" }));
  check("a still-configured budget.price_per_mtok refuses the mint",
    priceRemoved.proceed === false && priceRemoved.refusals.some((r) => r.gate === "budget-price-per-mtok-removed"));
  check("budget-price-per-mtok-removed refusal names the raw value",
    priceRemoved.refusals.find((r) => r.gate === "budget-price-per-mtok-removed").detail.includes("'3'"));
  check("null budgetPriceRemoved (the common/unset case) never fires budget-price-per-mtok-removed",
    !happy.refusals.some((r) => r.gate === "budget-price-per-mtok-removed"));

  // FAFF-604 — a dollar ceiling that cannot see part of the fleet refuses the L4
  // mint (the hard half of the pair; `budget check` warns instead, to avoid the
  // fail-open the non-zero exit would cause).
  const unmetered = lightsOutPreflight(armedProbes({ budgetUnmeteredEngines: ["lan"] }));
  check("an unmetered engine under a dollar ceiling refuses the mint",
    unmetered.proceed === false && unmetered.refusals.some((r) => r.gate === "budget-telemetry-unobservable"));
  check("budget-telemetry-unobservable refusal names the engine AND both remedies",
    /lan/.test(unmetered.refusals.find((r) => r.gate === "budget-telemetry-unobservable").detail)
    && /budget\.window/.test(unmetered.refusals.find((r) => r.gate === "budget-telemetry-unobservable").detail)
    && /allow_unmetered/.test(unmetered.refusals.find((r) => r.gate === "budget-telemetry-unobservable").detail));
  check("an empty unmetered list (fully metered fleet, or no cost ceiling) never fires the gate",
    !happy.refusals.some((r) => r.gate === "budget-telemetry-unobservable")
    && !lightsOutPreflight(armedProbes({ budgetUnmeteredEngines: [] })).refusals.some((r) => r.gate === "budget-telemetry-unobservable"));

  // FAFF-325 / FAFF-525 — the L4 admission side of the Punt-1 disposition: no declaration now
  // DEGRADES to an advisory (does not refuse — the mount is unenforceable yet, FAFF-517, so
  // demanding the declaration would coerce a lying attestation; the FAFF-518 digest custody floor
  // is the truthful mount-free basis); a violation basis STILL refuses, naming the fault; "asserted"
  // (or an absent/undefined probe result, the happy-path fixture's default) never fires here.
  check("happy path (no correctiveIntegrityBasis set) never fires corrective-integrity",
    !happy.refusals.some((r) => r.gate === "corrective-integrity") && !happy.degrades.some((d) => d.gate === "corrective-integrity"));
  const noDecl = lightsOutPreflight(armedProbes({ correctiveIntegrityBasis: "no-declaration" }));
  check("no-declaration does NOT refuse admission (advisory-only)",
    !noDecl.refusals.some((r) => r.gate === "corrective-integrity"));
  check("no-declaration degrades to an advisory corrective-integrity entry",
    noDecl.degrades.some((d) => d.gate === "corrective-integrity"));
  check("no-declaration keeps proceed true (absent other refusals)", noDecl.proceed === true);
  check("no-declaration advisory names the digest floor and points at the future mount basis (FAFF-518/517)",
    /digest custody floor/.test(noDecl.degrades.find((d) => d.gate === "corrective-integrity").detail)
    && /faff integrity-boundary/.test(noDecl.degrades.find((d) => d.gate === "corrective-integrity").detail));
  for (const basis of ["env-injection", "malformed", "dir-mismatch"]) {
    const viol = lightsOutPreflight(armedProbes({ correctiveIntegrityBasis: basis }));
    check(`violation basis '${basis}' refuses admission, naming the fault`,
      viol.proceed === false && viol.refusals.some((r) => r.gate === "corrective-integrity" && r.detail.includes(basis)));
  }
  const declAsserted = lightsOutPreflight(armedProbes({ correctiveIntegrityBasis: "asserted" }));
  check("asserted basis never fires corrective-integrity",
    !declAsserted.refusals.some((r) => r.gate === "corrective-integrity"));

  // FAFF-312 — spend/time ceiling predicate: a count-cap alone is NOT an L4 governor.
  // Driven both on hand-built envelopes (to exercise the guard directly) and on real
  // envelopeFrom output (the path cmdLightsOut actually takes).
  check("spend/time: tokens-only is a ceiling",
    spendTimeCeilingSet({ ceilings: { tokens: 100, until: null, max_attempts: null, cost: null }, price_per_mtok: 0 }) === true);
  check("spend/time: until-only is a ceiling",
    spendTimeCeilingSet({ ceilings: { until: "07:00", tokens: null, max_attempts: null, cost: null }, price_per_mtok: 0 }) === true);
  check("spend/time: max_attempts-only is NOT a ceiling",
    spendTimeCeilingSet({ ceilings: { max_attempts: 40, tokens: null, until: null, cost: null }, price_per_mtok: 0 }) === false);
  check("spend/time: pricing:flat + priced cost is a ceiling",
    spendTimeCeilingSet({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, price_per_mtok: 3, pricing: "flat" }) === true);
  check("spend/time: pricing:flat + unpriced cost is NOT a ceiling (vacuous — the legacy dead zone, only under explicit flat pricing)",
    spendTimeCeilingSet({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, price_per_mtok: 0, pricing: "flat" }) === false);
  check("spend/time: NO `pricing` field at all (hand-built envelope) falls back to the pre-FAFF-427 rule — unpriced cost refuses",
    spendTimeCeilingSet({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, price_per_mtok: 0 }) === false);
  check("spend/time: pricing:map + a cost ceiling IS a ceiling even with price_per_mtok:0 (FAFF-427 — the map always has SOME price)",
    spendTimeCeilingSet({ ceilings: { cost: 5, tokens: null, until: null, max_attempts: null }, price_per_mtok: 0, pricing: "map" }) === true);
  check("spend/time: pricing:map + NO cost ceiling configured is still NOT a ceiling",
    spendTimeCeilingSet({ ceilings: { cost: null, tokens: null, until: null, max_attempts: null }, price_per_mtok: 0, pricing: "map" }) === false);
  check("spend/time: max_attempts alongside tokens IS a ceiling",
    spendTimeCeilingSet({ ceilings: { max_attempts: 40, tokens: 100, until: null, cost: null }, price_per_mtok: 0 }) === true);
  check("spend/time (real envelope): count-only refuses",
    spendTimeCeilingSet(envelopeFrom({ budget: { max_attempts: 40 } }, {})) === false);
  check("spend/time (real envelope): tokens proceeds",
    spendTimeCeilingSet(envelopeFrom({ budget: { tokens: 5_000_000 } }, {})) === true);
  // FAFF-427: `envelopeFrom` now stamps `pricing:"map"` when no explicit
  // price_per_mtok is set, and the map ALWAYS has some price to apply — so a
  // real envelope with `budget.cost` set and no `price_per_mtok` now PROCEEDS
  // (the ADR-0048 map-priced dollar ceiling is the new default, recommended L4
  // governor). The old "unpriced cost refuses" case only survives for the
  // explicit-flat-zero-price hand-built shape above.
  check("spend/time (real envelope): budget.cost alone (no price_per_mtok) now PROCEEDS — the default map-priced dollar ceiling",
    spendTimeCeilingSet(envelopeFrom({ budget: { cost: 5, price_per_mtok: 0 } }, {})) === true);
  check("spend/time (real envelope): --until flag proceeds",
    spendTimeCeilingSet(envelopeFrom({}, { until: "07:00" })) === true);
  // FAFF-364 — a malformed --until never satisfies the spend/time governor: it
  // resolves to a null ceiling (until_invalid set instead), the exact case the
  // budget-until-invalid preflight gate exists to catch on its own.
  check("spend/time (real envelope): malformed --until does NOT satisfy the governor",
    spendTimeCeilingSet(envelopeFrom({}, { until: "garbage" })) === false);

  // ---- FAFF-428: the L4 spend governor must be MEASURABLE, not merely configured ----

  // estimateOnlyPosture: unset → refuse, warn honoured, unrecognised → refuse (fail-safe).
  check("estimateOnlyPosture: unset → refuse (L4 default)", estimateOnlyPosture({}) === "refuse");
  check("estimateOnlyPosture: no budget block → refuse", estimateOnlyPosture({ budget: {} }) === "refuse");
  check("estimateOnlyPosture: explicit warn honoured", estimateOnlyPosture({ budget: { on_estimate_only: "warn" } }) === "warn");
  check("estimateOnlyPosture: explicit refuse honoured", estimateOnlyPosture({ budget: { on_estimate_only: "refuse" } }) === "refuse");
  check("estimateOnlyPosture: case/whitespace tolerant", estimateOnlyPosture({ budget: { on_estimate_only: "  WARN  " } }) === "warn");
  check("estimateOnlyPosture: unrecognised value (typo) fails safe to refuse, NOT warn",
    estimateOnlyPosture({ budget: { on_estimate_only: "wrn" } }) === "refuse");

  // costArmed / tokenDependentCeilingArmed — the token-dependent-ceiling test the
  // budget-metering gate keys off. tokens always counts; cost only when armed
  // (FAFF-427 pricing); until/max_attempts alone never count.
  check("costArmed: pricing:map + cost set is armed", costArmed({ ceilings: { cost: 5 }, pricing: "map" }) === true);
  check("costArmed: pricing:flat + price>0 is armed", costArmed({ ceilings: { cost: 5 }, pricing: "flat", price_per_mtok: 3 }) === true);
  check("costArmed: pricing:flat + price 0 is NOT armed", costArmed({ ceilings: { cost: 5 }, pricing: "flat", price_per_mtok: 0 }) === false);
  check("costArmed: no cost ceiling at all is NOT armed", costArmed({ ceilings: { cost: null }, pricing: "map" }) === false);
  check("tokenDependentCeilingArmed: tokens set is armed", tokenDependentCeilingArmed({ ceilings: { tokens: 100, cost: null }, pricing: "map" }) === true);
  check("tokenDependentCeilingArmed: armed cost is armed", tokenDependentCeilingArmed({ ceilings: { tokens: null, cost: 5 }, pricing: "map" }) === true);
  check("tokenDependentCeilingArmed: until-only is NOT armed (a clock needs no token meter)",
    tokenDependentCeilingArmed({ ceilings: { tokens: null, cost: null, until: "07:00" }, pricing: "map" }) === false);
  check("tokenDependentCeilingArmed: max_attempts-only is NOT armed",
    tokenDependentCeilingArmed({ ceilings: { tokens: null, cost: null, max_attempts: 40 }, pricing: "map" }) === false);

  // lightsOutPreflight: default posture (refuse) with an armed token-dependent ceiling
  // and an estimate-only meter → refuses with gate budget-metering, no degrades.
  const meteringRefuse = lightsOutPreflight(armedProbes({ tokenDependentCeiling: true, meteringMeasurable: false }));
  check("budget-metering: estimate-only + token-dependent ceiling + default posture refuses",
    meteringRefuse.proceed === false && meteringRefuse.refusals.some((r) => r.gate === "budget-metering"));
  check("budget-metering refusal names the fix + the warn opt-out",
    meteringRefuse.refusals.find((r) => r.gate === "budget-metering").detail.includes("budget.on_estimate_only: warn"));
  check("budget-metering refuse path carries no degrades", meteringRefuse.degrades.length === 0);

  // Explicit warn posture: same estimate-only + token-dependent ceiling now PROCEEDS,
  // with a degrades[] entry naming budget-metering (the loud degrade, never silent).
  const meteringWarn = lightsOutPreflight(armedProbes({
    tokenDependentCeiling: true, meteringMeasurable: false, estimateOnlyPosture: "warn",
  }));
  check("budget-metering: warn posture proceeds despite estimate-only metering",
    meteringWarn.proceed === true && !meteringWarn.refusals.some((r) => r.gate === "budget-metering"));
  check("budget-metering: warn posture populates degrades[] naming the gate",
    meteringWarn.degrades.some((d) => d.gate === "budget-metering"));
  check("budget-metering: warn-posture banner carries a DEGRADED line",
    /degraded \(proceeding\)/.test(meteringWarn.banner) && meteringWarn.banner.includes("budget-metering"));

  // A MEASURABLE meter never fires the gate, regardless of posture or ceiling shape —
  // the happy path (armedProbes' default) already proves this implicitly, restated here
  // explicitly against a token-dependent ceiling.
  const meteringOk = lightsOutPreflight(armedProbes({ tokenDependentCeiling: true, meteringMeasurable: true }));
  check("budget-metering: measurable meter + token-dependent ceiling proceeds clean",
    meteringOk.proceed === true && meteringOk.degrades.length === 0
    && !meteringOk.refusals.some((r) => r.gate === "budget-metering"));

  // An until-only (or absent) token-dependent-ceiling flag never fires the gate, even
  // with an estimate-only meter and the default refuse posture — a clock needs no meter.
  const meteringUntilOnly = lightsOutPreflight(armedProbes({ tokenDependentCeiling: false, meteringMeasurable: false }));
  check("budget-metering: no token-dependent ceiling never fires the gate (until/count-only governor)",
    meteringUntilOnly.proceed === true && meteringUntilOnly.degrades.length === 0
    && !meteringUntilOnly.refusals.some((r) => r.gate === "budget-metering"));

  // Additive-probe tolerance: an older caller of this pure function that never set
  // `meteringMeasurable` at all is tolerated as measurable — never a surprise refusal.
  const meteringAbsentProbe = lightsOutPreflight(armedProbes({ tokenDependentCeiling: true }));
  check("budget-metering: absent meteringMeasurable probe tolerated as measurable (additive-probe rule)",
    meteringAbsentProbe.proceed === true && !meteringAbsentProbe.refusals.some((r) => r.gate === "budget-metering"));

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

  // FAFF-515 — --prd-root-container flag → ledger prd_root_container resolution (rides the licence flag).
  check("prd root: absent flag → null record (no PRD gate ran)", prdRootContainerFromFlags(null, null).ok === true && prdRootContainerFromFlags(null, null).value === null);
  check("prd root: container + licence → value persisted", prdRootContainerFromFlags("Top of the loop", "broad").ok === true && prdRootContainerFromFlags("Top of the loop", "broad").value === "Top of the loop");
  check("prd root: container WITHOUT licence → not ok (mint refusal, never a silent null)", prdRootContainerFromFlags("Top of the loop", null).ok === false && prdRootContainerFromFlags("Top of the loop", null).value === null);
  check("prd root: blank container → not ok (a referent naming nothing anchors nothing)", prdRootContainerFromFlags("  ", "tight").ok === false);

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

  // FAFF-527: fold the resume pure-core selftest under the same CLI --selftest path so
  // CI's `lights-out --selftest` exercises the re-entry classification / plan / ledger math.
  const { resumeSelftest } = require("./resume");
  if (resumeSelftest() !== 0) failed++;

  if (failed) { console.log(`lights-out --selftest: FAIL (${failed} failed)`); return 1; }
  console.log("lights-out --selftest: ok");
  return 0;
}


// FAFF-820: gatherResumeEvidence is exported (read-only — no ledger/owner-state write)
// so bundle-recover.js's preview_resume can reuse the SAME evidence gatherer
// resumeLightsOut uses, rather than fork a second read of build-progress.json/
// merge-record.json/the forge. observeForgeMerge/branchExistsOnForge stay private —
// gatherResumeEvidence is the one call-site that needs them.
module.exports = { ADVERSARIAL_REVIEW_OCCUPANTS, ADVERSARIAL_SPEC_REVIEW_OCCUPANTS, FLOOR_LABELS, FLOOR_MODES, GUARDRAIL_STATES, LIGHTS_OUT_FLOOR_KEYS, LIGHTS_OUT_GUARDRAILS, LIGHTS_OUT_GUARDRAIL_IDS, MAX_REMINT_ATTEMPTS, VETTED_RECIPES, checkWorktreeIsolation, claimRunDir, cmdLightsOut, cmdWorktreeRoot, costArmed, dialCoherence, engineBoundedFromConfig, estimateOnlyPosture, gatherResumeEvidence, isAdversarial, isStrictlyUnderRoot, lightsOutArmed, lightsOutEnforced, lightsOutPreflight, lightsOutSelftest, mintAtCeiling, prdCreativeLicenceFromFlag, prdRootContainerFromFlags, probeContractReachable, renderLightsOutBanner, resolveSlotOccupant, resolveWorktreeRoot, spendTimeCeilingSet, tokenDependentCeilingArmed, worktreeRootSelftest };
