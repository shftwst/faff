# FAFF-382 — Grafts honour the checked lights-out worktree root

> Spec: faffter-dark-nlspec · 2026-07-07 · interactive · confidence: high.
> Trimmed to **dedup + assert**. The `worktree_root` / `FAFF_WORKTREE_ROOT` override is essentially unused (the global `~/.faff/worktrees/<repo>` default is the norm), so the env-only cross-dispatch case has no real operator — that deferred work (FAFF-400) is cancelled. This spec single-sources the resolver and makes the FAFF-379-verified property *bind* via a local-resolution assert.

This spec is for the build agent that will wire graft to the FAFF-379 lights-out isolation floor. It closes the "verified root nothing consumes" residual FAFF-379 named in its own Out-of-Scope: the L4 preflight proves the configured worktree root sits outside the repo and is creatable, but nothing forces a build's worktree to actually land under it.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-379's preflight verifies the resolved worktree root is strictly outside the repo tree and creatable — but nothing downstream consumes that verified property, so a build worktree that lands *outside* the checked root (a hook bug, drift, a stale worktree from an old root) builds anyway. Separately, the env→config→default precedence that resolves the root is currently inlined in *two* places (the hook and the preflight), so the two can silently drift. This change makes the verified property **bind** — a build asserts, fail-closed, that its worktree actually landed under the resolved root — and **single-sources** the precedence so the hook, the preflight, and the new assert all resolve identically.

**Problem statement.** Today the FAFF-379 check is verified-but-unconsumed, and its resolution precedence is duplicated. This change adds one canonical resolver (`faff worktree-root`), refactors the two inlined copies onto it, and has graft assert that its created worktree is under the resolved root — refusing (autonomous) or warning (interactive) on any divergence.

*Scope note.* The original spec also threaded the orchestrator-resolved root onto every `BuildDispatch` to catch a cross-dispatch env-only divergence. That is **dropped**: the `worktree_root` / `FAFF_WORKTREE_ROOT` override is essentially unused in practice — the `~/.faff/worktrees/<repo>` default is the norm and works well (no git-in-git, greps don't leak worktree hits, supports code-blindness) — so the env-only case has no real operator. The assert below therefore resolves the root **locally** (the same `faff worktree-root` the hook uses), which catches a worktree landing outside the checked root for any reason, without threading anything through the dispatch.

**Design principles:**

- **Single-sourced resolution — one resolver, no third copy.** The gateway's Worktree policy states the precedence once and declares that any divergence between graft, beep-boop, and concurrency "is a bug." That precedence is currently inlined in the hook (`setup-worktree.sh`) and the FAFF-379 preflight (`bin/faff`). This fix introduces one canonical resolver the hook, the preflight, and graft all call — no third inlined copy.
- **Fail-closed on escape.** A build worktree is *either* under the resolved root *or* the build refuses loudly (autonomous) / warns (interactive).

## 2. OUT OF SCOPE

- **The env-only cross-dispatch propagation / placement case (was FAFF-382's threading; FAFF-400 — cancelled).** The env/config override is essentially unused; the default is the norm. The assert resolves locally and needs no threaded root.
- **Changing the resolver precedence or the default location itself.** The `FAFF_WORKTREE_ROOT` → `.faffrc worktree_root` → `~/.faff/worktrees/<repo>` precedence stays; this fix only *centralises* it.
- **Removing worktree-root configurability altogether.** The test suite depends on `FAFF_WORKTREE_ROOT`, and the ADR-0041 per-lane-cage roadmap is a plausible future consumer. The knob stays.

## 3. WHAT — Interfaces

**New CLI surface — `faff worktree-root`.** One canonical resolver + a containment assertion. Pure over the filesystem for the assert (stat only, no mkdir), consistent with `checkWorktreeIsolation`.

```
COMMAND faff worktree-root [--assert PATH] [--root DIR] [--json] [--selftest]

  (no --assert)  Resolve and print the worktree root for the repo at --root (default: cwd).
                 Precedence: FAFF_WORKTREE_ROOT  ->  .faffrc worktree_root  ->  ~/.faff/worktrees/<basename(repoRoot)>
                 A set env/config value is used AS-IS (no <repo> suffix appended — matches the hook).
                 Only the default branch appends <repo>. Exit 0.

  --assert PATH  Exit 0 iff PATH is strictly UNDER the resolved root (segment-aware containment,
                 the same test checkWorktreeIsolation uses: path.relative(root, PATH) is non-empty,
                 does not start with ".." and is not absolute). Else exit 1 with a reason on stderr
                 naming PATH and the resolved root.

  --root DIR     Repo working-tree root (for the <repo> basename + config lookup). NOT the worktree root.

  --json         { "root": "<resolved>", "source": "env|config|default" }  (and, with --assert,
                 "asserted_path", "under_root": bool).

  --selftest     Runs the precedence + containment + default-suffix table; exit 0/1.
```

No `BuildDispatch` change and no concurrency-executor change.

## 4. HOW — Behavior

**Two coordinated edits, both pointing at one resolver:**

1. **Add `faff worktree-root`** (`bin/faff`) — the canonical resolver + `--assert`. Register in `COMMANDS`, `USAGE`, `REGION_MAP` (region `factory`), `REGION_SELFTEST_ARGV` (`["worktree-root","--selftest"]`), and `docs/guide/cli.md` (else `lint-cli-doc` and `regions check` fail CI).

2. **Refactor the two inlined copies to call it, and add the graft assert.** The hook (`setup-worktree.sh`) replaces its inline precedence block with a call to `faff worktree-root` (resolved via `${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff`, with the graceful literal-default fallback if the binary is unresolvable). The FAFF-379 preflight (`bin/faff`) replaces its inline `const worktreeRoot = …` with the shared in-process resolver that `worktree-root` wraps. This aligns the default-prefix mismatch by construction (the preflight now checks `~/.faff/worktrees/<repo>`, the actual placement root). Graft Step 3 gains the post-entry assert.

**Resolver — pseudocode.**

```
PROCEDURE resolve_worktree_root(repoRoot, env, cfg):
  1. IF env.FAFF_WORKTREE_ROOT is set and non-empty: RETURN { root: it, source: "env" }
  2. IF cfg.worktree_root is set and non-empty:        RETURN { root: it, source: "config" }
  3. RETURN { root: join(HOME, ".faff/worktrees", basename(repoRoot)), source: "default" }
     # env/config used verbatim; ONLY the default appends <repo> (matches the hook).
```

**Assert — pseudocode.**

```
PROCEDURE assert_under_root(candidatePath, repoRoot, env, cfg):
  1. root <- resolve_worktree_root(repoRoot, env, cfg).root
  2. rel  <- path.relative(root, candidatePath)
  3. under <- rel != "" AND NOT rel.startsWith("..") AND NOT isAbsolute(rel)
  4. IF under: exit 0
  5. ELSE: stderr("worktree '<candidatePath>' is not under the resolved root '<root>'"); exit 1
```

**Graft Step 3 — the new assert (append to "Check for Existing Worktree").** After the worktree exists and the session has entered it (existing `EnterWorktree` + auto-hook flow, unchanged), before Step 4 commits the spec:

```
PROCEDURE graft_step3_assert(mode):
  1. actual <- `git rev-parse --show-toplevel`   # cwd is now the worktree
  2. faff   <- resolve faff binary (gateway -> Resolver)
  3. run:  "$faff" worktree-root --assert "<actual>"   # resolves the root LOCALLY (env/config/default)
  4. IF exit 0 (under root): proceed to Step 4.
  5. IF exit != 0 (worktree outside the resolved root):
       - autonomous: REFUSE fail-closed, PRE-BUILD (parked, no spec commit, logged to graft.md).
       - interactive: WARN with the same message and continue (parity with the eligibility WARN).
```

Because graft and the hook now call the *same* `faff worktree-root`, the normal case passes; the assert fires only when the created worktree genuinely sits outside the resolved root — the FAFF-379-verified property finally binding.

**Edge cases:**

- **`faff worktree-root` unresolvable in graft** → skip the assert (log the skip), never hard-fail graft.
- **`git rev-parse --show-toplevel` fails** → pre-existing graft failure, not this assert's concern; skip.
- **Re-entered existing worktree** → assert the existing worktree path the same way; a pre-fix worktree outside the resolved root surfaces the refuse/warn.

**Failure modes:**

- **The assert is a no-op / mis-wired** → a worktree outside the root still builds silently. Guard: the integration test feeding an outside path expects exit 1; a pass means the assert is dead (blocker).
- **The preflight-default alignment weakens the FAFF-379 check** → the FAFF-379 lights-out tests (`test/lights-out.test.mjs`) must stay green unchanged. If any flips, revert the alignment and keep only the resolver dedup + assert.

## 5. SCENARIOS

```
Given  a build whose created worktree sits OUTSIDE the resolved worktree root (a hook bug or drift),
When   graft Step 3 runs `faff worktree-root --assert` against the created worktree path,
Then   the assert exits non-zero and autonomous graft refuses pre-build (interactive warns).
```

```
Given  a normally-created worktree under the resolved root,
When   graft asserts the created worktree,
Then   the assert exits 0 and the build proceeds unchanged.
```

```
Given  the hook, the FAFF-379 preflight, and `faff worktree-root` in any one repo + env + config state,
When   each resolves the worktree root,
Then   all three return the identical path (single source of truth).
```

## 6. DESIGN DECISION RATIONALE

- **Fix surface — resolver dedup + graft assert; drop the BuildDispatch threading.** The threading existed only to catch a cross-dispatch env-only divergence, and that config is essentially unused. **Chosen:** dedup + a local-resolution assert; drop threading and both concurrency-executor edits.
- **"Honour" = structural post-hoc assert** (created worktree path under the resolved root), fail-closed, resolving locally via the same `faff worktree-root` the hook uses. **Chosen.**
- **One resolver.** Add `faff worktree-root`; refactor both existing copies (hook + preflight) to call it; graft calls it too. **Chosen.**
- **Align the default-prefix mismatch** (preflight `~/.faff/worktrees` vs hook `~/.faff/worktrees/<repo>`). **Chosen** — the resolver's default is the repo-suffixed path and the preflight adopts it. Guarded by the FAFF-379 tests staying green.
- **ADR?** A wiring/correctness/hygiene fix, not a new cross-slice architectural decision. **Chosen:** no ADR.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

None. Every decision is closed; the trim removed the one Punt (env-only cross-dispatch → cancelled FAFF-400) and the one Assumes (orchestrator env inheritance).

## 8. DONE — Definition of Done

**From WHY**
- [ ] A build whose worktree lands outside the resolved isolation root no longer builds silently — autonomous graft refuses pre-build (naming the resolved root), interactive graft warns.

**From WHAT (CLI)**
- [ ] `faff worktree-root` prints the resolved root with precedence env → config → default `~/.faff/worktrees/<basename(repoRoot)>`; env/config verbatim, only default appends `<repo>`.
- [ ] `faff worktree-root --assert PATH` exits 0 iff PATH is strictly under the resolved root (segment-aware), else exit 1 with a reason naming PATH and the root.
- [ ] `worktree-root` registered in `COMMANDS`, `USAGE`, `REGION_MAP` (factory), `REGION_SELFTEST_ARGV`; `faff regions check` and `faff worktree-root --selftest` pass.
- [ ] `docs/guide/cli.md` documents `worktree-root`; `faff lint-cli-doc` passes.

**From HOW (single-source refactor)**
- [ ] `setup-worktree.sh` resolves the root via `faff worktree-root` (with its graceful literal-default fallback), not an inline precedence block.
- [ ] The FAFF-379 preflight resolves via the same shared resolver; hook, preflight, and `faff worktree-root` return identical paths for the same repo/env/config.
- [ ] The FAFF-379 lights-out tests (`test/lights-out.test.mjs`) stay green unchanged after the preflight-default alignment.

**From HOW (graft assert)**
- [ ] Graft Step 3 gains the post-entry assert (local resolution); autonomous refuses fail-closed (logged), interactive warns and continues.
- [ ] `git rev-parse --show-toplevel` is the created-worktree source; a missing `faff` binary skips the assert (logged), never hard-fails graft.
- [ ] A re-entered pre-existing worktree outside the resolved root surfaces the refuse/warn.

**Scope guard**
- [ ] No `BuildDispatch` field is added and neither concurrency executor is edited.

**Eval coverage**
- [ ] No LLM-judgement seam is introduced — no grader `KIND`/eval-case row required.

**Integration smoke test:**

```
1. In a temp git repo, resolve <root> = `faff worktree-root`.
2. Create a worktree at <root>/br, run: faff worktree-root --assert <root>/br  -> expect exit 0.
3. Create a worktree OUTSIDE <root> (a sibling temp dir), run the same assert -> expect exit 1.
4. Assert the hook, the FAFF-379 preflight, and `faff worktree-root` all return the same <root>.
```
