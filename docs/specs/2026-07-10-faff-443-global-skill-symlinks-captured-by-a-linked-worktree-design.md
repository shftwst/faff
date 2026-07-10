# nlspec — FAFF-443: Global skill symlinks captured by a linked worktree

> Spec: faffter-dark-nlspec · 2026-07-10 · interactive · confidence: medium. Full spec on Linear FAFF-443.

**Artifact:** implementation spec for FAFF-443 (Bug), in the FAFF-200 install-wiring family. **Audience:** the build agent implementing the fix, and the human/spec-review reviewers gating it. The spec is self-contained — buildable from this document plus the named files.

---

## 1. WHY — Problem and Principles

**Load-bearing model.** A `--global` skill install is a *machine-wide, long-lived* pointer: `~/.claude/skills/*` and `~/.local/bin/faff` are meant to resolve for every session on the box, indefinitely. A git *linked worktree* is the opposite — an *ephemeral, disposable* checkout. `scripts/link-skills.sh` has zero git-awareness: it derives its link SOURCE purely from where the script file physically sits (`SCRIPT_DIR`). So when `--global` is run from inside a worktree, the durable global install is pointed at a throwaway directory. The fix is to make the *global* install-locus git-aware: a machine-wide install must be sourced from the stable main checkout, never a worktree, and the health check must see when it isn't.

**Problem statement.** Today `bash scripts/link-skills.sh --global`, run from a linked worktree, points all ~30 global skill symlinks (and the `~/.local/bin/faff` CLI link) at *that worktree's* `plugin/skills/*`; when the worktree is later removed every global link dangles and skills fail mid-session with "Unknown skill". The change makes `--global` resolve its source to the main checkout (with a notice) and makes `faff doctor` flag an already-captured global link *while it is still live*, before removal breaks it.

**Design principles.**

- **The global locus is git-aware; the local locus is not.** Repo-local mode (`link-skills.sh` with no `--global`) SHOULD link a worktree's own skills into that worktree's own `.claude/skills` — that is correct and unchanged. Only `--global` is machine-wide and therefore wrong when sourced from a worktree. Every behavioural change here is gated on `GLOBAL=1`.
- **Fix at the single chokepoint.** The retarget lives in `link-skills.sh` because both the direct invocation *and* `faff sync` (which shells out to the same script) flow through it — one bash-layer fix covers both by construction.
- **Loud, not silent, not refusing.** A global-from-worktree install is never what anyone intends, so "do the right thing" (retarget) beats refusing (dead-ends the human) — but it must announce the retarget, never do it silently.
- **Detection is retroactive; prevention is prospective.** The `doctor` warning catches installs *already* captured (before this fix existed); the `link-skills.sh` retarget prevents *new* captures. The done-signal needs both.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `scripts/link-skills.sh` | bash | The link producer; source of the capture (lines 43-47, 75-79, 84-88, 237/249/262/297). Needs its own git-common-dir logic — cannot call Node. |
| `plugin/skills/faff/bin/faff` `cmdDoctor` (9070-9137) | Node | The health check; per-skill loop (9091-9109) never reads *where* a symlink points. Detection home. |
| `mainWorktreeRoot(root)` (bin/faff:323-331) | Node | `git rev-parse --git-common-dir` → returns the main checkout for a linked worktree, `null` on main/bare/non-repo. Reused directly by `cmdDoctor`; **mirrored** (not called) in bash. |
| `resolveSyncScript` / `cmdSync` (9148-9202) | Node | `faff sync` → `bash <script> --global --replace`. Left unchanged (see Decision 2). |
| `faff/SKILL.md` doctor-at-entry preamble (71-83) | prose | Interactive-only `faff sync` offer on a non-clean doctor — the self-heal path the exit code feeds. |

**Scope.** A hardening of the FAFF-200 install-wiring family: closes the worktree-as-global-source foot-gun in the one script that owns skill linking, plus its health check.

---

## 2. OUT OF SCOPE

- **FAFF-442 worktree-registry churn** — the harness skill-registry churn on worktree add/remove. *Why:* orthogonal defect, separately ticketed. *Extension point:* FAFF-442.
- **In-session skill-registry reload after a repair** — after `faff sync`/`link-skills.sh` re-points the global links, an already-running Claude Code session does not re-scan `~/.claude/skills`. *Why:* a Claude Code harness limitation, not fixable from faff. *Extension point:* none in-repo; note only — a repaired install takes effect on the next session start.
- **Stale worktree copy of `link-skills.sh` run by `faff sync`** — if `faff sync` runs from a worktree whose checked-out `link-skills.sh` predates this fix, the retarget code is absent and the capture recurs. *Why:* self-correcting once the worktree refreshes, and `doctor` still catches it retroactively. *Extension point:* Decision 2 residual; caught by the `doctor` intoWorktree warning.
- **A per-invocation opt-out flag to force worktree-sourced global links** — *Why:* that is the anti-pattern this ticket removes; no demand. *Extension point:* a future `--allow-worktree-source` flag on `link-skills.sh` if a real use-case appears.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| main checkout | The repository's primary working tree — the one whose `.git` is a directory. |
| linked worktree | A secondary working tree (`git worktree add`); its `.git` is a *file* containing `gitdir: …`. |
| capture | A `--global` install whose symlinks resolve into a linked worktree's `plugin/skills`. |
| intoWorktree | Doctor's third symlink state: a symlink that is **live** but points into a linked worktree (fragile). |

**link-skills.sh — new behaviour surface (bash).**

```
# After arg parse, once GLOBAL is known and BEFORE skill discovery / BIN_SRC derivation:
FUNCTION resolve_global_source(REPO_ROOT) -> (src_root, notice?):
  # Only invoked when GLOBAL==1.
  common_dir = `git -C REPO_ROOT rev-parse --git-common-dir` (2>/dev/null)
  IF git failed OR common_dir empty:            # not a repo / no git
     RETURN (REPO_ROOT, none)                    # fail-safe: today's behaviour
  IF common_dir not absolute: common_dir = resolve(REPO_ROOT, common_dir)
  IF basename(common_dir) != ".git":             # bare/odd layout
     RETURN (REPO_ROOT, none)
  main = dirname(common_dir)
  IF main == REPO_ROOT:                           # already the main checkout
     RETURN (REPO_ROOT, none)                     # no-op, no notice
  RETURN (main, "worktree detected — sourcing global links from main checkout: <main>")
```

- `mainWorktreeRoot` equivalence: `resolve_global_source` returns a non-`REPO_ROOT` root **iff** git considers `REPO_ROOT` a linked worktree — the same predicate as `mainWorktreeRoot(root) != null` (bin/faff:323-331), reimplemented in bash because the script cannot call Node.
- On retarget, `SRC_DIR`, `SKILLS_ROOT`-derived discovery, **and** `BIN_SRC` must all be re-derived from the retargeted source (BIN_SRC is currently set at line 47, before the arg loop — it must be re-derived after the retarget, or its derivation moved past it).

**cmdDoctor — third symlink state (Node).**

```
ENUM SkillLinkState: live_main | intoWorktree | dangling | copy   # was: live | dangling | copy
```

```
RECORD DoctorCounters:
  copies: int
  dangling: int
  intoWorktree: int        # NEW — folded into the non-clean exit
```

**Design decision markers** are collected in §6; each concludes with a `**Chosen:**` marker.

---

## 4. HOW — Behavior

### 4.1 link-skills.sh — git-aware `--global` source

**Summary:** when `--global` is set, resolve the link source to the main checkout before discovering skills, announcing the retarget; leave every other mode byte-for-byte unchanged.

```
PROCEDURE link_skills_main:
  1. Parse flags (unchanged, lines 50-73).
  2. Compute SCRIPT_DIR, REPO_ROOT as today (43-44).
  3. IF GLOBAL == 1:
       a. (src_root, notice) = resolve_global_source(REPO_ROOT)
       b. IF src_root != REPO_ROOT:
            - SKILLS_ROOT = src_root/plugin/skills
            - IF NOT dir-exists(SKILLS_ROOT):        # main lacks plugin/skills
                 print error "main checkout has no plugin/skills at <SKILLS_ROOT>"; exit 1
            - SRC_DIR = SKILLS_ROOT
            - print notice
       c. ELSE: SKILLS_ROOT/SRC_DIR as today (main checkout, non-repo, or bare)
     ELSE (local mode): SRC_DIR = REPO_ROOT/plugin/skills   # unchanged
  4. BIN_SRC = SRC_DIR/faff/bin/faff                        # re-derived post-retarget
  5. Discover SKILL_DIRS from SRC_DIR (84-88), link / --replace / --unlink / --status
     / --prune exactly as today — they now operate on the retargeted SRC_DIR.
```

**Precedence / fallback chain for the source root:** (1) git says linked worktree AND main has `plugin/skills` → **main**, with notice; (2) git says linked worktree BUT main lacks `plugin/skills` → **refuse** (exit 1, loud); (3) main checkout / bare / not-a-repo / git absent → **today's `SCRIPT_DIR`-derived source**, silently (fail-safe).

**Anti-pattern:** retargeting in local (non-`--global`) mode. Why: a worktree's repo-local `.claude/skills` *should* point at that worktree — retargeting it would break local dev-linking.

**Anti-pattern:** resolving the main path from `SCRIPT_DIR` string manipulation instead of `git rev-parse`. Why: worktrees can live anywhere on disk, not at a fixed relative offset from main.

### 4.2 cmdDoctor — flag a live-but-worktree-sourced link

**Summary:** for each live global skill symlink (and the bin/faff link), resolve its target's enclosing checkout and, if that checkout is a linked worktree, report a distinct ⚠ intoWorktree state and fold it into the non-clean exit.

```
PROCEDURE classify_symlink(full):                 # replaces 9095-9104 live/dangling branch
  1. IF NOT existsSync(full): RETURN dangling      # unchanged
  2. TRY: tgt = realpathSync(full)                 # follow to the real dir
     CATCH: RETURN dangling                         # TOCTOU / race → treat as dangling
  3. checkout = resolve(tgt, "..", "..")            # <checkout>/plugin/skills/<skill> → <checkout>
  4. IF mainWorktreeRoot(checkout) != null:         # checkout is a linked worktree
        RETURN intoWorktree
  5. RETURN live_main
```

- **Output line** for intoWorktree: `⚠ <name>  symlink (live → WORKTREE, not main checkout — will dangle when the worktree is removed)`.
- **bin/faff link** (9110-9114): apply the same `realpath → mainWorktreeRoot(enclosing checkout)` test; the enclosing checkout is `resolve(tgt, "..","..","..","..","..")` (`faff→bin→faff→skills→plugin→checkout`). Report ⚠ intoWorktree for it too.
- **Exit / RESULT:** increment an `intoWorktree` counter; include it in the non-clean condition (9124) alongside `copies`/`dangling`. RESULT names it distinctly, e.g. `… + N worktree-sourced link(s) (fragile)`. **Fix hint:** `bash scripts/link-skills.sh --global --replace` *from the main checkout* (or `faff sync`, which now retargets).
- **Self-heal loop:** doctor exit 1 → the interactive doctor-at-entry preamble (`faff/SKILL.md`:71-83) offers `faff sync` → sync runs the (now git-aware) `link-skills.sh --global --replace` → retargets global links to main → re-run doctor → clean. Autonomous mode's existing doctor-non-clean handling is unchanged (a healthy install, links pointing at main, never trips intoWorktree).

### 4.3 Failure modes

- **The failure:** main checkout resolves but has no `plugin/skills` (odd layout, or main on a branch without it) → retarget would link nothing or dangle immediately. **How you'd know:** the post-retarget dir-exists guard (§4.1 step 3b) fires; integration test on a main-without-skills fixture asserts exit 1. **Means:** refuse loudly — proceed only when the target source verifiably exists.
- **The failure:** `git rev-parse --git-common-dir` returns a *relative* path left unresolved → wrong `main` → global links dangle on creation. **How you'd know:** the retarget integration test asserts each resulting link's `realpath` is under `MAIN/plugin/skills`; a relative-path bug makes realpath wrong/absent. **Means:** resolve relative-to-`REPO_ROOT` (mirror bin/faff:328) — narrow, not abandon.
- **The failure:** `doctor`'s `realpathSync` throws on a link racing removal (TOCTOU between `existsSync` and `realpath`). **How you'd know:** dangling-fixture test. **Means:** catch → classify as dangling (§4.2 step 2).
- **The failure:** `faff sync` runs a *stale* (pre-fix) `link-skills.sh` from a worktree → no retarget → capture recurs. **How you'd know:** `doctor` still flags the resulting links as intoWorktree (detection is retroactive). **Means:** accepted residual (OUT OF SCOPE) — caught, not silent.

---

## 5. Scenarios — born-verifiable main objectives

```
Scenario: --global from a linked worktree sources the main checkout
  Given a repository with a linked worktree (its .git is a FILE)
    And scripts/link-skills.sh + plugin/skills/* present in that worktree
  When `bash scripts/link-skills.sh --global` runs from inside the worktree (HOME set to a temp dir)
  Then every ~/.claude/skills/* symlink resolves (realpath) under the MAIN checkout's plugin/skills
    And NONE resolve under the worktree's plugin/skills
    And ~/.local/bin/faff resolves under the MAIN checkout
    And stdout carries a notice naming the main-checkout retarget
```

```
Scenario: doctor flags a live worktree-sourced global link before it breaks
  Given ~/.claude/skills/<skill> is a LIVE symlink whose target is inside a linked worktree's plugin/skills
  When `faff doctor` runs
  Then it prints a ⚠ intoWorktree line for that skill (distinct from COPY and dangling)
    And RESULT names the worktree-sourced/fragile count
    And it exits non-zero (1)
```

```
Constraint (regression): --global from the MAIN checkout is behaviourally unchanged
  When `bash scripts/link-skills.sh --global` runs from the main checkout
  Then no retarget occurs, no notice prints, and links resolve under main/plugin/skills exactly as before this change.
```

```
Constraint (regression): local (non --global) mode is unchanged
  When `bash scripts/link-skills.sh` (no --global) runs from a worktree
  Then it links the worktree's OWN plugin/skills into the worktree's .claude/skills (no retarget).
```

---

## 6. Design Decision Rationale

**Decision 1 — `link-skills.sh --global` from a worktree: retarget, refuse, or retarget-with-notice?**

- *Refuse (exit non-zero, one-line message):* loud and safe, but dead-ends a human mid-flow and, worse, dead-ends the interactive `faff sync` self-heal (sync would surface a refusal instead of fixing anything).
- *Silent retarget:* does the right thing but hides a machine-wide change.
- *Retarget-with-notice:* resolves the source to the main checkout and announces it.

Global-from-worktree is never an intended state (worktrees are disposable; global is durable), so retargeting is "doing the right thing," not a surprise; the notice keeps it non-silent; and it is the single bash-layer chokepoint that fixes both direct invocation and `faff sync`. It requires a bash `git rev-parse --git-common-dir` block mirroring `mainWorktreeRoot` (bin/faff:324-330) — the Node helper is unreachable from bash. Refusal is retained only for the sub-case where the resolved main verifiably lacks `plugin/skills` (fail-closed).
**Chosen:** retarget-with-notice, with a fail-closed refuse when the resolved main lacks `plugin/skills` — rationale above.

**Decision 2 — Does the fix change `faff sync` / `resolveSyncScript` to force the main checkout's script?**

- *Change it (resolve sync's script to main):* would break the FAFF-204 cwd-anchored resolution contract locked by `test/sync.test.mjs:98-111` and its fail-loud candidate list, for no correctness gain — because the bash-layer retarget (Decision 1) already makes `faff sync` self-heal: sync runs the worktree's `link-skills.sh --global --replace`, which retargets the source to main.
- *Leave it:* preserves the FAFF-204 contract and its test; the bash-layer fix covers the real trigger (the gateway's interactive sync offer).

The one residual is a worktree whose checked-out `link-skills.sh` predates this fix (its retarget code is absent) — an edge case that is self-correcting on worktree refresh and caught retroactively by the `doctor` intoWorktree warning.
**Chosen:** leave `resolveSyncScript` / `cmdSync` unchanged; the bash-layer retarget makes `faff sync` self-heal without touching the FAFF-204 contract — rationale + named residual above. *(Judgement call a reviewer may wish to revisit — see Confidence.)*

**Decision 3 — `doctor` intoWorktree severity: WARN (exit 0) or non-clean (exit 1)?**

The link is live *now* but is a latent install defect with a known bad outcome (silent dangle on worktree removal, the exact FAFF-200-family failure). `doctor`'s contract is "is the install durable?", and a worktree-sourced global link is not. Exit 1 also closes the self-heal loop: exit 1 → interactive `faff sync` offer → retarget → clean. Blast radius is low: a healthy install (links → main) never trips it. Reported as its own counter/category so the message stays precise (not conflated with COPY/dangling).
**Chosen:** intoWorktree is non-clean (exit 1), reported as a distinct `⚠ fragile` category folded into the existing non-clean exit. Detection lives in `doctor` only (invoked at session entry by the gateway preamble); **not** added to `faff-graft` — that would be scope creep for no extra coverage. *(Severity is a judgement call — see Confidence.)*

**Decision 4 — One slice, or split the `doctor`-warning facet into a sibling?**

Prevention (`link-skills.sh` retarget, prospective) and detection (`doctor` warn, retroactive) are two halves of one defense against a single foot-gun, share the `mainWorktreeRoot` predicate, and are each a small diff + focused test. The agile-methodology lens may argue the `doctor` warning is independently shippable (it catches already-captured installs even before the retarget lands) and belongs in its own ticket. Counter: the done-signal enumerates *all three* behaviours (no-dangle, retarget/refuse, doctor-flag) as one bug's acceptance, and the combined change is right-sized, not large.
**Chosen:** one coherent slice covering `link-skills.sh` + `doctor` (with `faff sync` unchanged) — rationale above; the split counter-argument is recorded for spec-review to weigh.

---

## 7. Open Questions and Assumptions

**Open Questions.** None (`**Punt:**` count: 0). All four design questions are resolved as `**Chosen:**` decisions; two (Decisions 2 and 3) are flagged as judgement calls a reviewer may overturn, but neither blocks the build.

**Assumptions.**

- **Assumes:** `git` is on PATH wherever `link-skills.sh --global` and `faff doctor` run. *Validation:* `command -v git`; if absent, `resolve_global_source` fails safe to today's behaviour and `mainWorktreeRoot` returns null — no crash, so this assumption failing degrades gracefully rather than blocking.
- **Assumes:** a linked worktree's `.git` is a file and `git rev-parse --git-common-dir` resolves to `<main>/.git`. *Validation:* the integration test constructs a real `git init` + `git worktree add`, asserting the FILE layout and the resolved main path.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `link-skills.sh --global` from a linked worktree no longer points global links at the worktree (removing that worktree later leaves `~/.claude/skills/*` intact).

### From WHAT / HOW (link-skills.sh)
- [ ] `--global` from a linked worktree sets the link source to the **main** checkout's `plugin/skills`; every created `~/.claude/skills/*` symlink resolves under main.
- [ ] The `~/.local/bin/faff` CLI link (`BIN_SRC`) is re-derived from the retargeted source and resolves under main.
- [ ] A notice is printed to stdout naming the main-checkout retarget when (and only when) a retarget occurs.
- [ ] `--global` from a linked worktree whose main lacks `plugin/skills` refuses with a clear message and non-zero exit.
- [ ] `--global` from the **main** checkout, from a **non-repo** dir, or with **git absent** behaves exactly as before (no retarget, no notice).
- [ ] Local (non-`--global`) mode from a worktree is unchanged (links the worktree's own skills).
- [ ] The git-common-dir resolution handles a relative common-dir by resolving it relative to `REPO_ROOT`.

### From WHAT / HOW (doctor)
- [ ] `faff doctor` classifies a live global skill symlink whose target is inside a linked worktree as a distinct `⚠` intoWorktree state (separate from COPY and dangling).
- [ ] The same intoWorktree check is applied to the `bin/faff` link.
- [ ] intoWorktree links are counted, named in RESULT as a distinct fragile category with a fix hint, and force a non-zero (1) exit.
- [ ] A `realpathSync` throw during classification is treated as dangling, not a crash.
- [ ] A healthy install (global links → main checkout) reports clean (exit 0) — no false positive.

### From HOW (edge/failure)
- [ ] Relative common-dir, main-without-plugin/skills, and TOCTOU-realpath paths behave per §4.3.

### Integration smoke test
```
1. git init a temp MAIN repo; add scripts/link-skills.sh (copied from repo) +
   plugin/skills/faff/{SKILL.md,bin/faff} + plugin/skills/<demo>/SKILL.md; commit.
2. `git worktree add <wt>` — a real linked worktree (its .git is a FILE).
3. Run `bash <wt>/scripts/link-skills.sh --global` with HOME=<tmpHome>.
4. Assert: realpath(<tmpHome>/.claude/skills/<demo>) is under <MAIN>/plugin/skills
   (NOT under <wt>); stdout contains the retarget notice.
5. Run `faff doctor --target <tmpHome>/.claude/skills` after hand-linking one skill
   into <wt>/plugin/skills; assert ⚠ intoWorktree + exit 1.
```

**Test-harness note:** the repo has no standalone bash-script test today. Both scenarios are driven from a **node `--test`** file (matching `test/doctor.test.mjs` / `test/sync.test.mjs` conventions) that shells out to `bash scripts/link-skills.sh` and constructs a **real** worktree (`.git`-FILE) fixture via `git init` + `git worktree add` — deliberately *not* the `.git`-DIR `mkRepo` layout, which cannot reproduce the capture.

**Eval coverage:** no LLM-judgement seam introduced — none required.

---

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```

---

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Right-sized? (principle 4) — split candidate, spec already flags it.** Decision 4 bundles two structurally independent concerns: (a) the preventive fix in `link-skills.sh --global` (retarget to main via `git-common-dir`, Decisions 1+2) and (b) a new diagnostic state `intoWorktree` in `faff doctor` (Decision 3). Two different files, two different mechanisms (bash preventive fix vs Node diagnostic), each a plausible 1–3 day unit. The retarget ships standalone value (dangling stops); the doctor warning ships standalone value (existing dangles get surfaced). Neither strictly gates the other. **What to do:** genuine judgement call, not a defect — keep together *only if* the stale-copy residual (Decision 2) is a real near-term risk that must ship with the fix; otherwise split the doctor facet into a sibling, noting it reads like FAFF-200 (install-health) detection-surface work.

**Workstream fit? (principles 1, 5) — No issues.** Project-less Backlog is the correct default for a bug with one coherent, currently-actionable outcome. The install-wiring family (FAFF-200/442/this) is cohesive enough to be a real outcome-led project ("install stays healthy") if a later tidy/plot wants it — not this ticket's job.

**Deps surfaced? (principle 6) — one real coordination edge is prose-only.** FAFF-200/442/440 appear as prose notes, no blocker edges. FAFF-442 correctly *not* linked (genuinely orthogonal). But Decision 3 mutates `faff doctor`'s state model, and FAFF-200 (install-health auto-heal) also lives on the doctor detect/repair surface — two tickets independently changing the doctor category set is a load-bearing coordination edge the tracker doesn't encode (append-collision risk; if the doctor facet splits, it plausibly *is* FAFF-200 work). FAFF-440's relation is a bare reference with no stated nature. **What to do:** surface the FAFF-443↔FAFF-200 doctor overlap as an explicit edge (or a note in both specs); either state what FAFF-440's dependency is and link it, or drop the reference.

**Risk profile? (principle 7) — high blast-radius; de-risking present but verify its breadth.** The fix rewrites the exact mechanism (`link-skills.sh --global` source resolution) that, if wrong, points all ~30 global skills at the wrong place or false-refuses a legitimate install. The novel/risky bit is `git rev-parse --git-common-dir` across cases — worktree, plain main checkout (common-dir == git-dir), and the fail-closed refuse when main lacks `plugin/skills`. A worktree-happy-path-only test greenwashes the paths most likely to surprise. Note `doctor`'s `intoWorktree` net does **not** catch a *buggy* retarget that points somewhere other than a worktree — doctor is not a safety net for this fix's own failure mode; the test is the only guard. **What to do:** right shape (de-risking spike inside the slice) — but confirm the fixture covers all three cases (non-worktree main checkout, worktree retarget, refuse-when-bare), treating the refuse/edge cases as load-bearing coverage, not an afterthought.
