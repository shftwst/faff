# FAFF-524 — SUT scaffolder setup — L4 dials, box env, PRD placement, adversarial backend definition

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-524.
> **Refreshed 2026-07-16 (autonomous)** — folded operator resolution (comment "Resolution (operator, 2026-07-16)"): no open human decisions remained (dial-home already Chosen); the one sequencing Assumes is now **satisfied** — **FAFF-522 has SHIPPED (PR #403)**, flipping the `gates.fallback` default to `fail-closed`, so the explicit `gates.fallback: fail-closed` leg is now a restated default and is **DROPPED** from the P1/P2/P3 heredocs (mechanical). Re-rated **medium → high** (Assumes discharged, build-ready).

This spec is for the build agent that hardens the four external-verification SUT scaffolders (`verification/external-verification/scaffold-p{1..5}-*.sh`) so a freshly-scaffolded System-Under-Test can actually complete a lights-out (L4) run end-to-end. It also serves human reviewers deciding the one open posture question (where a SUT's L4 dials live). The scaffolders are dogfooding infrastructure: each stands up a throwaway repo that exercises faff against a non-faff product.

## Refresh (operator resolution, 2026-07-16)

The single sequencing Assumes is discharged:

- **FAFF-522 SHIPPED (PR #403)** — `gatesFallbackPolicy` now returns `fail-closed` by **default**. Therefore the explicit `gates.fallback: fail-closed` line the P1/P2/P3 heredocs carried is a **restated default** and is **DROPPED** in this ticket. Build step: confirm `gatesFallbackPolicy` (`gates.js`) defaults to `fail-closed` and `faff lights-out --check` still passes on a heredoc *without* the explicit line, then remove the leg. The two *remaining* L4 dials (`review: faffter-dark-adversarial-review`, `spec_review: faffter-dark-spec-review`) are real config choices and **stay explicit**.
- No other open decisions — items 1–4 (dial-home, box env, PRD placement, backend definition) were already settled and are unchanged.

## 1. WHY — Problem and Principles

**Load-bearing model.** A SUT is *lights-out-by-identity*: its whole reason to exist is to be run unattended, so everything an L4 run needs at runtime must be present in the scaffolded repo *by construction* — the L4 dials, the API-key env file, a `faff prd list`-discoverable PRD, and a resolvable adversarial-review backend definition. Today FAFF-513 planted the three L4 *dials* but left three runtime holes: no box-env keys, no discoverable PRD, and an adversarial `review` slot pointing at a backend that is never defined — so the adversarial gate cannot fire and a plan-from-PRD run cannot find its leash.

**Problem statement.** FAFF-513 made P1/P2/P3 clear `faff lights-out --check` dial-coherence, but a scaffolded SUT still cannot run lights-out: the adversarial-review backend is unconfigured (`faff adversarial-backends` → exit 3), its API keys are absent (no `.env.claude-box`), and P2's PRD sits at the repo root where `faff prd list` never scans. This change closes those runtime holes and settles where a SUT's committed L4 posture belongs.

**Design principles.**

**Secrets are gitignored before they are written, never after.** `.env.claude-box` carries live API keys (`NVIDIA_API_KEY`, `GEMINI_API_KEY`). Every scaffolder ends with `git add -A && git commit`. The `.gitignore` entry for `.env.claude-box` MUST be written *before* the file is copied in, so no ordering ever stages a secret (mirrors the faff-root posture, `.gitignore:24`, and the FAFF-315 leak fix). This principle rejects any implementation that copies the env file first and relies on a later gitignore edit.

**A SUT's L4 posture is durable, shareable identity — not a private operator overlay.** ADR-0067 sends faff's *own* repo's L4 dials to the gitignored `.faffrc.local.yaml` overlay because faff is a shared library repo whose committed base is the default for many interactive contributors; imposing fail-closed/adversarial-everything on all of them is wrong. A SUT has no such contributor population — its committed config *is* its identity manifest, the scaffolder itself commits it, and its dials are exactly the "durable, shareable behaviour: slots, appetite, tracking paths, adversarial-backend routing" ADR-0067 assigns to the committed base. This principle rejects mirroring faff's overlay split into the SUTs.

**Emit the legacy backend shape now; the namespace migration is a separate ticket.** This ticket writes the adversarial backend definition in the *current* `faffter_dark.adversarial` shape so a P1 lights-out run is resolvable today, before the `backends:` namespace exists (FAFF-529 reshapes it post-FAFF-523). This principle rejects introducing the new `backends:` shape here — it would couple this fix to FAFF-523.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `verification/external-verification/scaffold-p{1,2,3}-*.sh` | Bash | The L4-eligible scaffolders this change edits (dials, env, PRD, backend) |
| `verification/external-verification/scaffold-p{4,5}-*.sh` | Bash | Gated SUTs — no L4 dials; env/backend out of scope, PRD stays at root |
| faff-root `.faffrc.yaml` `faffter_dark.adversarial` | YAML | The legacy-shape backend block the SUT blocks mirror (provider/model/host/api_key_env) |
| faff-root `.env.claude-box`, `.gitignore:24` | env / gitignore | The secret file to copy + the gitignore posture to mirror |
| `plugin/skills/faff/bin/lib/prd.js` (`prdDir`, `listPrds`) | JS | `faff prd list` scans `resolvePrdDocsPath` → `docs/prd/` only |
| `plugin/skills/faff/bin/lib/config.js:334` (`resolvePrdDocsPath`) | JS | Default `docs/prd`; overridable via `tracking.prd_docs_path` |
| `plugin/skills/faff/bin/lib/adversarial-backends.js:108` | JS | Emits exit 3 when `faffter_dark.adversarial` (or its host) is unset |
| `plugin/skills/faff/bin/lib/gates.js:145` (`gatesFallbackPolicy`) | JS | `gates.fallback` default is now `fail-closed` (FAFF-522 SHIPPED, PR #403) |
| `plugin/skills/faff/bin/lib/lights-out.js:251` | JS | Dial-coherence checks the literal `fail-closed` token inline |
| `test/scaffolder-lights-out-dials.test.mjs` | JS (node:test) | FAFF-513's static heredoc lint — extend it with the new invariants |

**Scope statement.** This sits in the external-verification dogfooding harness; it changes only the scaffolder shell scripts and their guarding lint — no change to faff's runtime CLI or to the SUTs' application code.

## 2. OUT OF SCOPE

- **The `backends:` namespace migration** — the legacy `faffter_dark.adversarial` block emitted here is reshaped later. *Why excluded:* the new namespace doesn't exist until FAFF-523; emitting it now couples this fix to that refactor. *Extension point:* FAFF-529 migrates both faff's own block and the SUT blocks to `backends:` + egress markers.
- **Flipping `gates.fallback`'s default to `fail-closed`** — that was FAFF-522 and has now **SHIPPED** (PR #403). *Why excluded:* it is a separate ticket, now done. *Consequence for this ticket:* the now-restated default lets this ticket **drop** the explicit `gates.fallback: fail-closed` leg from the heredocs (see §4).
- **`.env.claude-box` for P4/P5** — the gated SUTs use `faffter-noon-review` (single-model, no external keys). *Why excluded:* the driving need (adversarial-backend auth) is absent for them. *Extension point:* if a gated SUT ever adopts an external backend, the same copy+gitignore step applies to its scaffolder.
- **Elevating P1/P3/P5 briefs to `docs/prd/` PRDs** — they enter via `/faff-jot` → `/faff-prep` (architecture-led) or a vague ask, not plan-from-PRD. *Why excluded:* only a plan-from-PRD L4 run needs `faff prd list` discovery. *Extension point:* if P1/P3 are later driven plan-from-PRD, promote their brief to `docs/prd/<name>.md` with an admissible DoD.
- **The `FAFF_INTEGRITY_BOUNDARY` corrective-integrity leg** — operator-supplied at cage launch (FAFF-514), never scaffolded. *Why excluded:* not a config the scaffolder can satisfy. *Extension point:* an automating cage sets it via `faff integrity-boundary`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| SUT | System-Under-Test — a scaffolded throwaway repo that exercises faff against a non-faff product |
| L4-eligible SUT | P1/P2/P3 — labelled lights-out eligible; carries the L4 dials |
| Gated SUT | P4/P5 — deliberately autonomous-OFF; run interactively, no L4 dials |
| Box env | `.env.claude-box` — the claude-box secret file (`NVIDIA_API_KEY`, `GEMINI_API_KEY`, `CLAUDE_BOX_EXTRA_VARS`, `CLAUDE_BOX_EXTRA_MOUNTS`) |
| Legacy backend shape | The current `faffter_dark.adversarial:` YAML block (provider/model/host/api_key_env), pre-`backends:` namespace |
| Plan-from-PRD SUT | A SUT whose L4 run starts from a PRD admitted by the run-start `prd-readiness` gate (P2) |

**The four scaffolder-setup fixes (this ticket's WHAT).**

```
RECORD ScaffolderSetup:                # applied per L4-eligible scaffolder (P1/P2/P3)
  l4_dial_home: PATH                   # DECIDED: committed .faffrc.yaml (§6) — not an overlay
  gates_fallback_leg: DROPPED          # FAFF-522 SHIPPED → fail-closed is the default → explicit leg removed
  box_env: COPIED + GITIGNORED         # .env.claude-box copied from faff root; gitignored FIRST
  adversarial_block: EMITTED           # legacy faffter_dark.adversarial shape, keys via box env
  prd_placement: BRIEF | DOCS_PRD      # P2 → docs/prd/task-api.md; P1/P3 stay root briefs
```

**Per-SUT classification (the decided mapping).**

| SUT | Class | L4 dials | `.env.claude-box` | Adversarial block | Doc location |
|---|---|---|---|---|---|
| P1 link-shortener | brief-for-architecture, L4-eligible | yes | copy + gitignore | emit (legacy) | `BRIEF.md` at root (jot-led) |
| P2 task-api | L4 plan-from-PRD | yes | copy + gitignore | emit (legacy) | `docs/prd/task-api.md` + `tracking.container` |
| P3 landing-page | fuzzy brief, L4-eligible | yes | copy + gitignore | emit (legacy) | `BRIEF.md` at root (jot-led) |
| P4 stripe-testmode | gated PRD, interactive | no (untouched) | no | no | `PRD.md` at root (untouched) |
| P5 brownfield | gated vague-ask brief | no (untouched) | no | no | `BRIEF.md` at root (untouched) |

**The L4 dials after this ticket.** FAFF-513 planted three (`review`, `spec_review`, `gates.fallback: fail-closed`). With FAFF-522 shipped, `gates.fallback: fail-closed` is now the default, so the explicit line is **removed**; the two remaining explicit dials are `review: faffter-dark-adversarial-review` and `spec_review: faffter-dark-spec-review`. Dial-coherence (`faff lights-out --check`) is satisfied by the default `fail-closed` policy with no explicit line.

**The legacy adversarial backend block to emit** (mirrors faff-root `.faffrc.yaml`, public backends only — no private ollama/tailscale host, so no overlay is needed):

```
faffter_dark:
  adversarial:                         # PRIMARY = chain element 0
    provider: nvidia
    model: <a served nvidia model id>
    host: https://integrate.api.nvidia.com/v1
    api_key_env: NVIDIA_API_KEY        # resolved from .env.claude-box at call time (name only, never the key)
    timeout: 480
    fallbacks:
      - provider: gemini
        model: <a served gemini model id>
        host: https://generativelanguage.googleapis.com/v1beta/openai
        api_key_env: GEMINI_API_KEY    # also from .env.claude-box
```

**Box-env copy source resolution** (the scaffolder must locate the faff root from its own path, not a hardcoded path):

```
FAFF_ROOT = realpath( dirname(BASH_SOURCE[0]) / ".." / ".." )   # scaffolder lives in verification/external-verification/
SRC       = FAFF_ROOT / ".env.claude-box"
```

**Design decisions.** All decisions carry canonical markers, collected in §6 / §7:
- SUT L4 dial home → **Chosen** (committed `.faffrc.yaml`).
- Adversarial backend shape → **Chosen** (legacy `faffter_dark.adversarial`).
- PRD placement per SUT → **Chosen** (P2 only → `docs/prd/`).
- `.env.claude-box` copy-not-mount + absence handling → **Chosen**.
- Dropping the `gates.fallback` leg → **Chosen** (FAFF-522 shipped; the leg is now a restated default and is removed).

## 4. HOW — Behavior

**Architecture and approach.** Each L4-eligible scaffolder is a bash script that `cat >`s a `.gitignore`, a `.faffrc.yaml`, and a brief/PRD into a fresh `$SUT_ROOT`, then `git add -A && git commit`. The four fixes edit those heredocs and add a copy step. Ordering is load-bearing: gitignore (with `.env.claude-box`) → config heredocs → copy box env → commit.

**Behaviour summary.** After scaffolding, a P1/P2/P3 SUT resolves its adversarial backend (`faff adversarial-backends` → exit 0), authenticates it from `.env.claude-box` (never committed), and — for P2 — exposes its PRD to `faff prd list`.

```
PROCEDURE scaffold_l4_eligible_sut(SUT_ROOT):
  1. mkdir + cd SUT_ROOT; git init
  2. WRITE .gitignore INCLUDING the line `.env.claude-box`   # BEFORE any secret is present
  3. WRITE .faffrc.yaml with:
     a. the existing slots (methodology/spec/architecture/env/evaluator)
     b. review: faffter-dark-adversarial-review           # unchanged L4 dial
     c. spec_review: faffter-dark-spec-review             # unchanged L4 dial
     d. (NO explicit gates.fallback line — FAFF-522 SHIPPED, fail-closed is the default)
     e. the faffter_dark.adversarial legacy block         # item 4
     f. (P2 only) tracking.container: task-api            # item 3
  4. WRITE brief/PRD:
     a. P1/P3 → BRIEF.md at repo root (unchanged location)
     b. P2    → docs/prd/task-api.md (moved from root PRD.md), with a **Container:** metadata line
  5. COPY $FAFF_ROOT/.env.claude-box → ./.env.claude-box
     a. IF source missing: WARN and continue (do NOT fail the scaffold)  # see edge cases
  6. faff gitignore-ensure; faff hooks-ensure  (unchanged)
  7. git add -A && git commit   # .env.claude-box is gitignored → never staged
```

**Edge cases and error handling.**

- **`.env.claude-box` absent at the faff root** — it is gitignored, so a fresh clone or a contributor without box access won't have it. The scaffolder MUST warn (`.env.claude-box not found at <FAFF_ROOT> — the SUT's adversarial-review backend will refuse until you supply it`) and continue, exactly like the existing `gitignore-ensure`/`hooks-ensure` soft-fail legs. It MUST NOT abort — the SUT is still usable for the non-adversarial lanes.
- **`gates.fallback` leg, post-FAFF-522** — FAFF-522 has SHIPPED, so `fail-closed` is the default; the explicit `gates.fallback: fail-closed` line is dropped. Before removing it, confirm `gatesFallbackPolicy` returns `fail-closed` by default and `faff lights-out --check` still passes on a heredoc without the line (it does — dial-coherence checks the effective policy, which is now `fail-closed` by default).
- **`spec_review` / `review` adversarial legs** — these are real config choices (not safe defaults) and stay explicit.
- **PRD header for `faff prd list` discovery** — `listPrds` matches `^#\s*PRD\s*[—-]\s*<title>` and reads `**Container:**` via `adrField`; P2's existing header `# PRD — Task API …` already matches, so moving the file to `docs/prd/task-api.md` makes it discoverable. Add a `**Container:** task-api` metadata line so `tracking.container` and the PRD agree.

**Failure modes.**

- **The failure:** the box-env copy is added but ordered after `git add -A`, or the `.gitignore` line is forgotten — a live `NVIDIA_API_KEY` is committed into the SUT's history. **How you'd know:** `git log -p` in a scaffolded SUT shows `.env.claude-box`; `git status` never listed it as ignored. **What it means:** abandon that ordering — the gitignore line must precede the copy and the copy must precede the commit; a lint asserting `.env.claude-box` is gitignored-and-untracked in a scaffolded tree catches it.
- **The failure:** the adversarial block is emitted but names a model id the provider no longer serves, so `faff adversarial-backends` exits 0 yet the live call 404s at run time — the gate looks armed but is dead. **How you'd know:** a lights-out run's adversarial review returns a provider "model not found", not a verdict. **What it means:** narrow — pin model ids that mirror a currently-served faff-root value; this ticket makes the gate *resolvable*, not *guaranteed-live* (liveness is a run-time property, surfaced by the run, not the scaffolder).
- **The failure:** the committed-`.faffrc.yaml` dial-home decision is wrong for how operators actually run SUTs (they expect an overlay like faff's own repo). **How you'd know:** an operator reports surprise that the SUT's L4 posture is in git / asks where the overlay is. **What it means:** proceed — the ADR-0067 base-criteria argument (§6) is dispositive for a lights-out-by-identity repo the scaffolder itself commits; revisit only if the tracker owner overrides.

**Anti-pattern:** hardcoding the faff-root path when copying `.env.claude-box`. Why: the scaffolder is run standalone from arbitrary cwd; resolve `FAFF_ROOT` from `BASH_SOURCE` so it works wherever the repo lives.

**Anti-pattern:** emitting the `backends:` shape "to save a later migration". Why: that namespace doesn't exist until FAFF-523 and would make this fix depend on it — the two-phase split (Comment C) exists precisely to keep FAFF-524 independent.

**Anti-pattern:** re-adding an explicit `gates.fallback: fail-closed` line "for clarity". Why: FAFF-522 made it the default; an explicit restated default is exactly the leg this ticket removes.

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a freshly-scaffolded P1 (or P2/P3) SUT
When `faff adversarial-backends` is run in the SUT root
Then it exits 0 and prints a primary-first chain whose element 0 is the nvidia backend
     (before this change it exited 3 — unconfigured)
```

```
Given a freshly-scaffolded P1/P2/P3 SUT
When `git status --ignored` is inspected after the scaffolder's commit
Then `.env.claude-box` is present on disk AND listed as ignored AND absent from `git ls-files`
```

```
Given a freshly-scaffolded P2 SUT
When `faff prd list` is run in the SUT root
Then the task-api PRD is listed (it lives at docs/prd/task-api.md), and `tracking.container` resolves to its container
```

```
Given a freshly-scaffolded P1/P2/P3 SUT whose .faffrc.yaml carries NO explicit gates.fallback line
When `faff lights-out --check` runs
Then dial-coherence passes — the effective gates.fallback policy is fail-closed by default (FAFF-522), so the explicit leg is correctly absent
```

- The remaining L4 dials (`slots.review`, `slots.spec_review`) MUST remain present in P1/P2/P3 `.faffrc.yaml`; the `gates.fallback: fail-closed` line MUST be **absent** (default now covers it) — `faff lights-out --check` dial-coherence stays clean.
- P4/P5 `.faffrc.yaml` MUST remain unchanged: none of the L4 dials, no adversarial block, no `.env.claude-box`.

## 6. Design Decision Rationale

**Where does a SUT's committed L4 posture live — `.faffrc.yaml` (committed) or `.faffrc.local.yaml` (gitignored overlay)?**
- *Committed `.faffrc.yaml`* — pro: a SUT is lights-out-by-identity with no shared-contributor population; its dials are the "durable, shareable behaviour … adversarial-backend routing" ADR-0067 explicitly assigns to the committed base; the scaffolder itself runs `git add -A && git commit`, so an overlay would be gitignored and the SUT's own L4 identity would vanish from git — losing the recoverability/diffability ADR-0067 exists to provide; the block is secret-free (`api_key_env` is a name, keys come from `.env.claude-box`) and uses only public backends (no private host), so none of ADR-0067's overlay triggers apply. Con: diverges cosmetically from faff's own repo, which uses the overlay (FAFF-468).
- *Overlay `.faffrc.local.yaml`* — pro: mirrors faff's own two-file posture. Con: faff's overlay choice is driven by the shared-library concern (don't impose L4 on interactive contributors) that a SUT does not have; a gitignored overlay is never committed by the scaffolder, so a scaffolded SUT would ship with no L4 posture at all.
- **Chosen:** committed `.faffrc.yaml` — the ADR-0067 base-file criteria (durable, shareable, secret-free, public-host) all hold for a SUT, and the scaffolder-commits-the-repo fact makes the overlay actively wrong here (it would erase the posture from git). FAFF-468's overlay signpost is the right answer for faff's *own* shared repo, not for a lights-out-by-identity SUT.

**Drop the explicit `gates.fallback: fail-closed` leg? (was Assumes on FAFF-522 — resolved 2026-07-16)**
- FAFF-522 has **SHIPPED** (PR #403): `gatesFallbackPolicy` now defaults to `fail-closed`. An explicit `gates.fallback: fail-closed` line is therefore a restated default that adds noise and a maintenance point without changing behaviour.
- **Chosen:** drop the explicit leg from the P1/P2/P3 heredocs. Build-time guard: confirm the default is `fail-closed` and `faff lights-out --check` passes without the line before removing it. The two remaining dials (`review`, `spec_review`) are non-default choices and stay explicit.

**Which adversarial-backend shape does the scaffolder emit — legacy `faffter_dark.adversarial` or the new `backends:` namespace?**
- *Legacy* — pro: exists today; `faff adversarial-backends` reads it now; unblocks a P1 lights-out run before FAFF-523. Con: FAFF-529 will migrate it.
- *`backends:`* — pro: no later migration. Con: the namespace doesn't exist until FAFF-523; emitting it couples this fix to that refactor.
- **Chosen:** legacy `faffter_dark.adversarial` — the two-phase split (Comment C) keeps FAFF-524 independent of FAFF-523; FAFF-529 reshapes it later. At the time of writing the `backends:` namespace does not exist.

**Which SUTs get a `docs/prd/` PRD versus a root brief?**
- **Chosen:** only P2 → `docs/prd/task-api.md` + `tracking.container: task-api`. P2 is the sole plan-from-PRD SUT (it drives `/faff-plot` + `--converge` + the run-start `prd-readiness` gate), and `faff prd list` scans `docs/prd/` only, so a root PRD is invisible to that gate. P1/P3 enter via `/faff-jot` (architecture-led) and P5 via a vague ask; their briefs stay at root. P4 has a PRD but runs interactively (gated), does its `prd-readiness` check by hand, and needs no `faff prd list` discovery — its `PRD.md` stays at root, untouched.

**Copy or mount `.env.claude-box`; and what on absence?**
- **Chosen:** copy (per operator) into the SUT dir and gitignore it before copying; on a missing source, warn-and-continue (mirrors the existing `gitignore-ensure`/`hooks-ensure` soft-fail legs) — the file is gitignored so a fresh clone legitimately lacks it, and the SUT is still usable for non-adversarial lanes.

## 7. Open Questions and Assumptions

**Open Questions.** None. (The dial-home question is settled Chosen; the FAFF-522 sequencing Assumes is discharged — 522 shipped, the leg is dropped. A tracker-owner override of the dial-home is the only thing that would reopen anything.)

**Assumptions.**

- **Assumes (DISCHARGED 2026-07-16):** FAFF-522 lands (flipping the `gates.fallback` default from `advisory` to `fail-closed`) before the `gates.fallback: fail-closed` leg is dropped. → **Satisfied:** FAFF-522 SHIPPED (PR #403); the leg is dropped in this ticket. *Validation:* confirm `gatesFallbackPolicy` (`gates.js`) returns `fail-closed` by default and `faff lights-out --check` passes on a heredoc without the explicit line.
- **Assumes:** the faff-root `.env.claude-box` continues to carry `NVIDIA_API_KEY` and `GEMINI_API_KEY` under those names. *Validation:* the emitted `api_key_env` values must match the env var names actually present in `.env.claude-box` (`grep -oE '^[A-Z_]+' .env.claude-box`).
- **Assumes:** the nvidia/gemini model ids mirrored into the SUT block are still served. *Validation:* mirror a currently-served id from faff-root `.faffrc.yaml`; liveness is a run-time property surfaced by the run, not asserted by the scaffolder.

## 8. DONE — Definition of Done

### From WHY
- [ ] A freshly-scaffolded P1/P2/P3 SUT can resolve its adversarial-review backend (`faff adversarial-backends` exit 0) — the FAFF-513 runtime hole is closed.

### From WHAT (config posture + classification)
- [ ] P1/P2/P3 `.faffrc.yaml` retains the two explicit L4 dials (`review: faffter-dark-adversarial-review`, `spec_review: faffter-dark-spec-review`) and carries **no** explicit `gates.fallback` line (fail-closed is the default post-FAFF-522) — dial-home is the committed base, not an overlay.
- [ ] `faff lights-out --check` passes on the P1/P2/P3 heredocs with the `gates.fallback` line removed.
- [ ] P4/P5 `.faffrc.yaml` unchanged: none of the L4 dials, no adversarial block, no `.env.claude-box` copy.

### From WHAT (adversarial backend definition — item 4)
- [ ] P1/P2/P3 `.faffrc.yaml` emits a `faffter_dark.adversarial` legacy-shape block with `provider`/`model`/`host`/`api_key_env` for an nvidia primary and a gemini fallback; `api_key_env` values name env vars present in `.env.claude-box`.
- [ ] `faff adversarial-backends` in a scaffolded P1/P2/P3 root exits 0 and emits a primary-first chain (element 0 = nvidia).

### From WHAT (box env — item 2)
- [ ] P1/P2/P3 `.gitignore` contains `.env.claude-box`, written before the file is copied.
- [ ] Each P1/P2/P3 scaffolder copies `$FAFF_ROOT/.env.claude-box` (root resolved from `BASH_SOURCE`, not hardcoded) into the SUT dir; on a missing source it warns and continues (non-fatal).
- [ ] In a scaffolded P1/P2/P3 tree, `.env.claude-box` is present on disk, listed by `git status --ignored`, and absent from `git ls-files` and `git log --all -- .env.claude-box`.

### From WHAT (PRD placement — item 3)
- [ ] P2's PRD is emitted at `docs/prd/task-api.md` (not root `PRD.md`) and `faff prd list` in the SUT root lists it.
- [ ] P2 `.faffrc.yaml` sets `tracking.container: task-api`, matching the PRD's `**Container:**` line.
- [ ] P1/P3/P5 briefs stay at root and P4's `PRD.md` stays at root (classification honoured).
- [ ] P2's RUNBOOK/BRIEF prose references to `PRD.md` are updated to the new `docs/prd/task-api.md` path (including the "PRD.md commit must be UNTOUCHED" and "paste BRIEF.md + PRD.md" lines), so the runbook still points at the real file.

### From HOW (gates.fallback leg — resolved)
- [ ] The `gates.fallback: fail-closed` leg is **removed** from the P1/P2/P3 heredocs (FAFF-522 shipped; it is a restated default), verified by `faff lights-out --check` passing without it.
- [ ] Scaffolder ordering is gitignore → config → copy env → commit, verified by the no-secret-committed check above.

### From tests
- [ ] `test/scaffolder-lights-out-dials.test.mjs` (or a sibling static lint) is extended to assert, for P1/P2/P3 heredocs: the two explicit dials present, **no** explicit `gates.fallback` line, `.env.claude-box` gitignored, a `faffter_dark.adversarial` block present, and (P2) the `docs/prd/` PRD + `tracking.container`; and for P4/P5: none of the above — so a future scaffolder edit that regresses any invariant fails loud in CI (mirrors FAFF-513's lint).

**Integration smoke test:**

```
PROCEDURE smoke():
  1. SUT_ROOT=/tmp/faff-sut-p1 bash verification/external-verification/scaffold-p1-link-shortener.sh
  2. cd $SUT_ROOT
  3. assert `faff adversarial-backends` exit 0 AND chain[0].provider == "nvidia"
  4. assert `git status --ignored` lists .env.claude-box AND `git ls-files` does not
  5. assert `faff lights-out --check` passes with no explicit gates.fallback line in .faffrc.yaml
  6. (P2) assert `faff prd list` includes the task-api PRD at docs/prd/task-api.md
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
