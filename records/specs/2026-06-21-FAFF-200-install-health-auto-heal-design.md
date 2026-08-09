# Spec — FAFF-200: Install-health auto-heal — wire `faff doctor` at skill entry, add a skill-owned repair command, and normalize divergent hook paths

> Spec: faffter-dark-nlspec · 2026-06-21 · interactive · confidence: high. Full spec on Linear FAFF-200.

_Revised 2026-06-21 — AC #3 (hooks-ensure path normalization) re-instated as a built deliverable at the maintainer's direction (the prior draft dropped it). The open Punt is now closed (Chosen: normalize)._

Three deliverables: a `faff sync` CLI subcommand, a gateway-prose doctor-at-entry install-health check, and a `hooks-ensure` path-normalization pass. The faff CLI is a single dependency-free Node script and must stay that way.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-190 was meant to make stale copy-installs self-correcting, but it shipped **only the detector** (`faff doctor`) and was closed Done — its fix-sketch listed symlink/`faff sync`/warn and only the warn landed. So the bug recurred on 2026-06-21: a `/faff-tidy` ran against `~/.claude/skills/` holding 23 stale real-dir copies (newest skill `faffter-noon-adr` absent, CLI never on PATH), silently executing stale prose with the deterministic seams invisible — fixed by a remembered `bash scripts/link-skills.sh --global --replace` incantation. Separately, the same install left the `prepcheck` Stop-hook wired to an **absolute repo path** while `runcheck` used the portable `~/.claude/skills/faff/bin/faff` symlink path — harmless today (both resolve the same binary) but brittle to a repo move. This change closes the loop: run the existing detector at entry, give the repair a skill-owned home, and normalize divergent stored hook paths.

**Design principles.**

- **Never silently mutate `~/.claude`.** Re-linking the global skills dir is a side-effect *outside a PR* and effectively irreversible within a run (it deletes real dirs). Any auto-heal is **interactive-offer-only**; autonomous/beep-boop logs and surfaces but never prompts or mutates — mirrors the first-run `.faffrc` offer. Auto-relinking in autonomous mode is rejected.
- **Deterministic tools over prose, reuse the tested mechanism.** The repair already exists and is exercised: `scripts/link-skills.sh --global --replace`. `faff sync` is a thin deterministic wrapper, not a reimplementation.
- **The CLI stays dependency-free.** `bin/faff` imports only Node built-ins. `faff sync` may use `child_process.spawnSync` (already used at bin/faff:897) but adds no npm dependency.

## 2. OUT OF SCOPE

- Reimplementing skill-linking in Node (`link-skills.sh` already does it; extension point `cmdSyncNative()` for a bash-less target).
- Auto-running `faff sync` (or any relink) in autonomous mode — excluded permanently.
- Changing what `faff doctor` detects, or how `hooks-ensure` detects *presence*.
- A persistent "offer declined" memory for the doctor-at-entry offer (a stale install is still stale next session).

## 3. WHAT — Vocabulary, Types, Interfaces

- **copy-install** — a faff skill present at the install target as a real directory (snapshot, doesn't track repo changes). `faff doctor` `✗ … COPY`.
- **dev-linked / live** — a faff skill present as a symlink into the repo. `faff doctor` `✓ … symlink`.
- **install target** — `$CLAUDE_PLUGIN_ROOT/skills` if set, else `~/.claude/skills`.
- **doctor-at-entry** — a new install-health check the gateway-load preamble runs once on entry, dispatching `faff doctor` and acting on its exit code.
- **`faff sync`** — the new skill-owned repair subcommand, a thin wrapper over `link-skills.sh --global --replace`.
- **canonical hook command** — the exact string `hooks-ensure` writes for a fresh Stop-hook (`binInvocation` + subcommand + `--hook`) — the normalization target.

**New CLI surface — `faff sync`.**

```
COMMAND faff sync [--dry-run] [--json] [--script PATH]
  PURPOSE: repair a stale copy-install by re-linking faff skills (+ the CLI) to the repo.
  MECHANISM: locate scripts/link-skills.sh relative to the running bin/faff, then
             spawnSync bash with --global --replace (and --dry-run when asked).
  --dry-run : pass through; report what WOULD change, mutate nothing.
  --json    : emit the structured result object instead of human text.
  --script  : override the resolved script path (testing; defaults to repo-relative path).

RECORD SyncResult:                 # mirrors gitignoreEnsure's result style
  script: String                   # absolute path to the link-skills.sh that ran
  ran: Boolean                     # false on dry-run
  dry_run: Boolean
  exit: Integer                    # the script's exit status
  ok: Boolean                      # exit === 0
  CONSTRAINT script is an existing, readable file before spawn; else fail-loud exit 2
```

**Exit codes (mirror `doctor`/`hooks-ensure`):** `0` ran/dry-ran OK · `1` script ran but reported a non-fatal problem · `2` fail-loud (script missing/unreadable, `bash` unavailable, spawn error).

**Decisions.**
- **Chosen:** `faff sync` shells out to `scripts/link-skills.sh --global --replace` via `spawnSync` — reuse the tested repair, no npm dependency, accept bash-for-this-subcommand.
- **Chosen:** doctor-at-entry is a gateway `SKILL.md` addition dispatching the existing `faff doctor`; code deliverables are `faff sync` + the `hooks-ensure` normalization pass + tests.
- **Chosen:** normalize a divergent present-hook command to the same `binInvocation` `hooks-ensure` computes for a fresh registration (single source of truth). Presence detection (`commandInvokesFaffHook`, path-agnostic) is unchanged; normalization is a separate pass.
- **Chosen (review follow-up):** `binInvocation`/`resolveHookBin` prefers the **portable install location** — `$CLAUDE_PLUGIN_ROOT/skills/faff/bin/faff` (plugin) or `~/.claude/skills/faff/bin/faff` (dev-linked symlink) — over the checkout-absolute realpath when `faff` isn't on PATH, so a normalized **and** a freshly-added hook track the install (surviving a repo move) instead of pinning the checkout path. Order: on-PATH `faff` → install location → running-binary realpath.

## 4. HOW — Behavior

### 4a. `faff sync` (code)

```
PROCEDURE cmdSync(args):
  1. Parse flags: dryRun, asJson, scriptOverride (value after "--script").
  2. Resolve script path: scriptOverride OR realpathSync(process.argv[1]) → up to repo root
     → "scripts/link-skills.sh" (via path.join, no hardcoded absolute).
     IF NOT (exists AND readable): stderr "faff sync: cannot find link-skills.sh at <path>"; return 2.
  3. argv = ["--global","--replace"] + (dryRun ? ["--dry-run"] : []).
  4. r = spawnSync("bash", [scriptPath, ...argv], { stdio: asJson ? "pipe" : "inherit", encoding: "utf8" }).
  5. IF r.error: stderr "faff sync: failed to run <path>: <err>"; return 2.
  6. result = { script, ran: !dryRun, dry_run: dryRun, exit: r.status, ok: r.status === 0 }.
  7. asJson → print JSON; else one-line trailer (ok / "exit <n> — see output above").
  8. Return r.status === 0 ? 0 : (r.status === 2 ? 2 : 1).
```

Wiring: add `if (sub === "sync") return cmdSync(rest);` in `main()` before the unknown-subcommand error; add a `sync` line to `USAGE`, `doctor`-style.

Anti-patterns: reimplementing the symlink/replace loop in `cmdSync` (duplicates `link-skills.sh`); swallowing the script's non-zero exit into 0.

### 4b. Doctor-at-entry install-health offer (gateway prose)

Add an **Install health (doctor-at-entry)** subsection adjacent to gateway *First run*:

```
ON skill entry (the gateway-load preamble), after the .faffrc check:
  Run `faff doctor` once.
  - exit 0 (all symlink/live): silent, continue.
  - exit 2 (cannot read target / no faff skills): silent, continue.
  - exit 1 (one or more COPY installs — stale risk):
      INTERACTIVE: soft-offer (mirrors the .faffrc offer, never a gate):
        "faff skills look stale (copy-installs, not symlinks) — repo changes won't be live. Re-link now? (y/n)"
        - accept → run `faff sync`, then continue.
        - decline → continue on the stale install; do not nag further this turn.
      AUTONOMOUS / beep-boop: NEVER prompt, NEVER run faff sync, NEVER mutate ~/.claude.
        Log the finding and surface it for /faff-wtf, then continue.
```

Prose must: reuse *First run*'s "single gateway-level check … not a snippet copied into every sub-skill" framing; bind autonomous behaviour to the Autonomous Mode Contract; resolve `faff` via *Resolving the `faff` executable* (no hardcoded path); invoke `faff sync` as a CLI call.

### 4c. `hooks-ensure` path normalization (code)

```
In planStopHooks (or a sibling pass), for each Stop-hook subcommand that is PRESENT:
  - canonical = binInvocation + " " + sub + " --hook"
  - IF the present hook's stored command !== canonical (after trim):
      rewrite that hook command to canonical; record under a new `normalized: [sub,...]` outcome.
  - ELSE: leave it (counts as `already`, byte-stable no-op).
Result object gains `normalized`; --json and human output report it.
Idempotency: second run finds every hook canonical → normalized: [] → no write.
Presence semantics (commandInvokesFaffHook) UNCHANGED — still path-agnostic.
```

`--selftest` gains a case: a present-but-divergent-path hook plans a `normalized` rewrite to `binInvocation`; an already-canonical hook plans nothing.

Anti-pattern: making `commandInvokesFaffHook` path-sensitive — that would break presence detection for legitimately-portable forms.

## 5. SCENARIOS

- Stale copy-install + interactive entry + accept → `faff sync` relinks, later `faff doctor` exits 0.
- Stale copy-install + autonomous entry → no prompt, `~/.claude` untouched, finding logged + surfaced for /faff-wtf.
- Healthy install + `faff sync --dry-run` → reports already-linked, mutates nothing (`ran:false`), exit 0.
- Missing/unreadable `link-skills.sh` + `faff sync` → fail loud on stderr naming the script, exit 2.
- settings.json with a present-but-divergent-path hook + `faff hooks-ensure` → rewrites to `binInvocation` (under `normalized`), second run a byte-stable no-op.

Non-functional: `faff sync` adds no npm dependency; `faff doctor` detection + `hooks-ensure` presence semantics unchanged.

## 6. DESIGN DECISION RATIONALE

- **Shell out vs Node port?** **Chosen:** shell out via `spawnSync` — reuses tested replace/relink/CLI-PATH logic, keeps `bin/faff` tiny, single source of truth; bash-for-this-subcommand cost; Windows portability is an out-of-scope extension point (`cmdSyncNative`).
- **Doctor-at-entry locus?** **Chosen:** gateway prose at the single *First run* check-point — no new CLI seam.
- **Autonomous auto-heal?** **Chosen:** never — re-linking mutates `~/.claude` outside any PR; autonomous logs + surfaces only.
- **AC #3 — normalize divergent hook paths?** **Chosen (re-instated):** rewrite a present-but-divergent hook to the canonical `binInvocation`. The matcher is path-agnostic by design (today's divergence harmless), but the `prepcheck` absolute-repo path is brittle to a repo move while the portable form survives — normalization removes that latent fragility. Bounded: presence detection untouched; only the stored string of an already-present hook is rewritten, idempotently.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all decisions closed (the AC #3 Punt resolved to Chosen: normalize at re-prep).

**Assumptions.**
- **Assumes:** `scripts/link-skills.sh` is resolvable relative to the running `bin/faff`. *Validate:* `cmdSync` checks the resolved path exists + is readable, failing loud (exit 2) — a plugin-only install with no repo gets a clear error.
- **Assumes:** `bash` is on PATH at `faff sync` call time. *Validate:* `spawnSync` returns `r.error`; mapped to exit 2.
- **Assumes:** the gateway *First run* framing + *Resolving the `faff` executable* snippet are present, and `hooks-ensure` exposes a `binInvocation`.

## 8. DONE — Definition of Done

**From WHY**
- [ ] A stale copy-install is surfaced at skill entry (interactive offer / autonomous logged + `/faff-wtf`-surfaced) instead of silently running stale prose.
- [ ] The repair is invocable as `faff sync`.
- [ ] A divergent-path Stop-hook is normalized to the portable canonical form.

**From WHAT / HOW (`faff sync`)**
- [ ] `faff sync` dispatched in `main()` + documented in `USAGE` (one line, `doctor`-style); `--json` emits `{ script, ran, dry_run, exit, ok }`.
- [ ] Exit codes: 0 ran/dry-ran OK; 1 non-fatal script problem; 2 fail-loud. No npm dependency added.
- [ ] Resolves `scripts/link-skills.sh` relative to the running binary (no hardcoded absolute); `--dry-run` passes through (`ran:false`, mutates nothing); missing/unreadable script → exit 2 naming the path; script exit mapped through (1→1, 2→2), never swallowed.

**From HOW (doctor-at-entry prose)**
- [ ] Gateway `SKILL.md` gains a single **Install health (doctor-at-entry)** check at the *First run* entry point running `faff doctor` once; exit 0/2 → silent continue; exit 1 → act per mode.
- [ ] Interactive exit 1 → soft-offer; accept runs `faff sync`, decline continues without nagging. Autonomous exit 1 → no prompt, no `faff sync`, no `~/.claude` mutation; log + surface for `/faff-wtf`; bound to the Autonomous Mode Contract.
- [ ] Prose resolves `faff` via *Resolving the `faff` executable* (no hardcoded path); one gateway-level home, not per sub-skill (`faff validate-adapters` stays green).

**From HOW (`hooks-ensure` normalization)**
- [ ] A present-but-divergent-path Stop-hook is rewritten to the canonical `binInvocation`; reported under a new `normalized` outcome + `--json`.
- [ ] An already-canonical hook is a byte-stable no-op; a second run after normalization is also a no-op (idempotent).
- [ ] `commandInvokesFaffHook` presence semantics unchanged; `--selftest` gains a normalization case.

**From DESIGN DECISIONS**
- [ ] `faff sync` shells out (no Node reimplementation).
- [ ] hooks-ensure normalizes to the canonical fresh-hook command, not an independently-derived path.

**From tests**
- [ ] New `test/sync.test.mjs`: dry-run mutates nothing + `ran:false`; `--json` shape; missing-script → exit 2; script-exit pass-through (uses `--script` to point at a stub, no real `~/.claude` mutation).
- [ ] `test/hooks-ensure.test.mjs` gains: present-but-divergent-path hook → normalized rewrite + idempotent second run; already-canonical → no-op; `--selftest` passes.
- [ ] `faff doctor`'s existing tests still pass unchanged.

**Integration smoke test.**
```
1. mkdtemp TARGET; one real-dir copy + one symlink.
2. ASSERT `faff doctor --target TARGET` exits 1, names the copy.
3. `faff sync --dry-run --script <stub>` → exit 0, JSON ran:false, copy STILL a real dir.
4. `faff sync --script <stub>` (stub symlinks the copies) → exit 0; copy now a symlink.
5. ASSERT `faff doctor --target TARGET` now exits 0.
6. Seed settings.json with a present hook at an absolute-repo path; `faff hooks-ensure` → rewrites to binInvocation; rerun → no-op.
```

confidence: high
