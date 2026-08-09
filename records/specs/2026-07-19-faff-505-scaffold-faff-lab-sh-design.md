# scaffold-faff-lab.sh — the sixth external-verification rung

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: medium · spec-review: approve. Full spec on Linear FAFF-505.

This spec is for the build agent standing up `verification/external-verification/scaffold-faff-lab.sh` and the accompanying `README.md` update. It defines a self-contained bash scaffolder that stands up the **faff-lab SUT** — the long-lived public gallery deliverable — as a git-only-first repo a lights-out run can be pointed at. Audience: the implementer, and the human reviewer checking it honours ADR 0070 and the committed faff-lab PRD.

## 1. WHY — Problem and Principles

**The load-bearing model:** the external-verification suite is a set of *scaffold scripts*, each of which stands up one throwaway SUT repo faff is pointed **at** (faff is the tool; the SUT is the subject). faff-lab is the first rung that is a **real, long-lived deliverable** rather than a throwaway — so its setpoint (the PRD) and its tracker decision (ADR 0070) are already committed to the faff repo, and this scaffold's job is to *copy* that committed setpoint into a fresh SUT rather than heredoc a fresh copy.

**Problem statement.** The suite has five rungs (P1–P5), all throwaway git-only SUTs; there is no rung that stands up faff-lab, the gallery site that is both L4's proving ground and the collation surface for its results. Without a scaffold-script entry artifact of the same shape as P1–P5, `faff lights-out` / `/faff-beep-boop` cannot be pointed at faff-lab. This change adds that sixth rung.

**Design principles.**

- **Mirror P2 exactly, deviate only where faff-lab's nature forces it.** `scaffold-p2-task-api.sh` is the closest prior art (the other PRD-driven rung). Every structural convention — `SUT_ROOT` param, `FORCE=1` non-empty refusal, `FAFF_ROOT` resolved at script-top before the `cd`, `git init`, secret-leak guard, `hooks-ensure`, initial commit — is copied. The deviations (PRD copied not heredoc'd; `.faff/` committed not gitignored) are the only places faff-lab's real-deliverable nature overrides the P2 template, and each is called out as a `**Chosen:**` below.
- **The PRD is singly-sourced and immutable.** The committed `verification/external-verification/faff-lab/PRD.md` is *the* setpoint. The scaffold copies it verbatim; it never re-authors or edits it, and the run never edits it.
- **Never cite a command that does not exist.** The scaffold's RUNBOOK uses only the real `faff` admission surface. It must not propagate the fictional `faff prd new --from` / `faff prd admit` forms (the subject of FAFF-507) — those never existed.
- **Secrets are never committed.** Any deploy or backend credentials are referenced by env-var name only; the scaffold provisions no secret into the repo.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `verification/external-verification/scaffold-p2-task-api.sh` | bash | The template this mirrors exactly (PRD-driven rung, git-only, adversarial dials) |
| `verification/external-verification/scaffold-p3-landing-page.sh` | bash | Deploy-shaped precedent; `env: faffter-noon-env-compose` local stand-in |
| `verification/external-verification/faff-lab/PRD.md` | markdown | The committed setpoint the scaffold copies verbatim |
| `records/adr/0070-faff-lab-tracker-vs-git-only.md` | markdown | The tracker decision (git-only-first) the `.faffrc.yaml` must reflect |
| `verification/external-verification/faff-lab/README.md` | markdown | Already documents the real admission flow the RUNBOOK reuses |
| `verification/external-verification/authoring-and-admitting-a-prd.md` | markdown | The real `faff prd` / `faff prdr` / `prd-readiness` verb surface |
| `verification/external-verification/README.md` | markdown | The suite index whose "five rungs" framing becomes six |

**Scope statement.** This adds one scaffold script plus a suite-index table row to the external-verification suite; it does not build faff-lab itself, and changes no faff CLI behaviour.

## 2. OUT OF SCOPE

- **Building the faff-lab gallery site.** — The scaffold stands up an empty SUT the *lights-out run* then builds against the PRD. Extension point: the run itself, driven from the scaffolded `RUNBOOK.md`.
- **Re-authoring or editing the faff-lab PRD.** — The PRD is committed and immutable (FAFF-504, ADR 0070). Extension point: `verification/external-verification/faff-lab/PRD.md` is edited only by a human, never here.
- **Provisioning a Linear container / `tracking.*` tracker keys.** — ADR 0070 chose git-only-first. Extension point: the documented tracker-upgrade path (add a `tracking:` block with `project_id`/`team_key`, drop `automation_default`) taken once the loop is proven.
- **Committing deploy secrets or real paid-infra provisioning.** — Secrets are never committed; live paid infra is out of the scaffold's remit. Extension point: operator-supplied deploy credentials at run time, referenced by env-var name.
- **Fixing the P2 runbook's fiction-command citation.** — That is FAFF-507's job. This spec only ensures the *new* script does not repeat the fiction. Extension point: FAFF-507.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| SUT | Subject under test — the fresh repo faff is pointed at |
| Rung | One scaffold script + its SUT; "first failure rung" is the binding constraint the suite surfaces |
| Setpoint | The immutable human-authored PRD the run is measured against |
| git-only-first | ADR 0070's decision: run the first loop with no Linear provisioning, upgrade to a tracker later |

**Script contract.** `scaffold-faff-lab.sh` is invoked exactly as its siblings:

```
SUT_ROOT=<target dir> bash verification/external-verification/scaffold-faff-lab.sh
```

```
INTERFACE scaffold-faff-lab.sh:
  env SUT_ROOT   : target repo dir       # default ~/workspace/faff-suts/faff-lab
  env FORCE      : "1" overrides the non-empty-dir refusal   # default unset
  precondition   : refuse (exit 1) if SUT_ROOT is non-empty and FORCE != 1
  effect         : writes .gitignore, .faffrc.yaml, docs/prd/faff-lab.md (copied),
                   BRIEF.md, RUNBOOK.md; wires hooks; makes the initial commit
  FAFF_ROOT      : resolved from BASH_SOURCE BEFORE the cd into SUT_ROOT
```

**Seeded files.**

- `docs/prd/faff-lab.md` — **copied verbatim** from `$FAFF_ROOT/verification/external-verification/faff-lab/PRD.md` (not heredoc'd). It lands under `docs/prd/` (not the repo root) so `faff prd list` discovers it and the L4 run-start `prd-readiness` gate fires — the PRD's `- **Container:** faff-lab` line (already present) matches `tracking.container: faff-lab` in the config.
- `.faffrc.yaml` — the git-only-first lights-out config (see HOW).
- `.gitignore` — mirrors P2's, but **must not** ignore `.faff/` (see the `.faff/` decision in HOW).
- `BRIEF.md` — the run-facing brief: what faff-lab is, the stack direction, deploy posture (local-first), how the work enters.
- `RUNBOOK.md` — the operator runbook + the real-deliverable scoring rubric.

**Design decisions** are collected in §6; each tradeoff below concludes with its canonical marker there.

## 4. HOW — Behaviour

**Architecture.** The script is linear, `set -euo pipefail`, structurally identical to `scaffold-p2-task-api.sh`:

```
PROCEDURE scaffold_faff_lab:
  1. FAFF_ROOT := realpath(dirname(BASH_SOURCE)/../..)   # BEFORE any cd
  2. SLUG := "faff-lab"; SUT_ROOT := ${SUT_ROOT:-~/workspace/faff-suts/faff-lab}
  3. IF SUT_ROOT exists AND non-empty AND FORCE != 1: echo refusal; exit 1
  4. mkdir -p SUT_ROOT; cd SUT_ROOT; git init -q
  5. write .gitignore            # NOTE: does NOT list .faff/  (see Chosen: commit .faff/)
  6. write .faffrc.yaml          # git-only-first lights-out config
  7. mkdir -p docs/prd; cp "$FAFF_ROOT/verification/external-verification/faff-lab/PRD.md" docs/prd/faff-lab.md
  8. write BRIEF.md, RUNBOOK.md
  9. copy .env.claude-box from FAFF_ROOT if present (gitignored first); warn+continue if absent
  10. resolve "$faff"; run "$faff" hooks-ensure   # NOT gitignore-ensure (see Chosen: commit .faff/)
  11. secret-leak guard: git rm --cached --ignore-unmatch .env.claude-box
  12. git add -A; git commit -q -m "chore: scaffold faff-lab SUT (faff external-verification rung 6)"
  13. echo next-steps
```

**The `.faff/` deviation from P2.** The faff-lab PRD's acceptance criteria include *"The faff-lab repository MUST commit its `.faff/` directory rather than gitignoring it."* This directly contradicts the P1–P5 convention of running `faff gitignore-ensure`. So this scaffold:

- writes a `.gitignore` that does **not** list `.faff/` (it still lists `node_modules/`, `dist/`, `*.log`, `.env.claude-box`);
- **does not** call `faff gitignore-ensure` (which would add `.faff/` to `.gitignore`);
- still calls `faff hooks-ensure` (hooks are orthogonal to the `.faff/` commit posture).

**Anti-pattern:** calling `faff gitignore-ensure` "for parity with P2". Why: it would gitignore `.faff/`, violating a hard PRD acceptance criterion for this SUT.

**The `.faffrc.yaml` shape.** git-only-first (ADR 0070), adversarial L4 dials, agile lens, scaled budget:

```yaml
# faff config — SUT faff-lab (sixth rung). git-only-first (ADR 0070), agile lens, lights-out.
tracking:
  container: faff-lab            # matches docs/prd/faff-lab.md's **Container:** line for faff prd list
slots:
  methodology: faffter-dark-methodology-agile-delivery
  spec: faffter-dark-nlspec
  architecture: faffter-noon-architecture
  env: faffter-noon-env-compose
  evaluator: faffter-noon-evaluate
  review: faffter-dark-adversarial-review     # L4 dial: adversarial second-opinion
  spec_review: faffter-dark-spec-review       # L4 dial: adversarial spec_review
appetite: high
automation_default: opt-out
intake_gate: warn
budget:
  max_attempts: 40               # predictable count backstop (excluded from the L4 spend gate)
  tokens: 200000000              # ~2.5x P2's 80M — multi-page site + deploy pipeline is larger
  at_ceiling: escalate           # a loud stop, not a silent drain, when a ceiling is hit
  # cost: 60   # optional budget.cost (dollars, ADR-0048 map) is the recommended L4 spend governor
backends:
  # (identical named-backend block to P2/P3: nvidia-glm, gemini-gemma, ollama-local)
faffter_dark:
  adversarial:
    refs: [nvidia-glm, gemini-gemma, ollama-local]
```

The `backends:` + `faffter_dark.adversarial.refs` block is copied verbatim from P2/P3 (the adversarial `review`/`spec_review` dials need it to resolve, and it clears `faff lights-out --check` dial-coherence). `tracking.container` is *not* a tracker binding — it only names the container for `faff prd list` discovery, so it is fully consistent with git-only-first.

**The RUNBOOK's admission flow** reuses the real surface already documented in `verification/external-verification/faff-lab/README.md`: Layer 1 is the `prd` slot → `faff-contract:prd-readiness` → `faff contract prd-readiness` auto-gate (fires because the PRD is registered under `docs/prd/`); Layer 2 is `faff prdr new` / `faff prdr admit`. The RUNBOOK must **not** cite `faff prd new --from` or a `faff prd admit` verb — neither exists (FAFF-507). It points at `authoring-and-admitting-a-prd.md` exactly as P2's RUNBOOK does.

**The scoring rubric — the real-deliverable inversion.** P1–P5 score *"did the behaviour occur and did faff respect its boundary"*, explicitly **not** "did it build the thing". faff-lab inverts this: it is a real deliverable, so its rubric scores **"did the real deliverable ship"** — each PRD acceptance criterion verified against the built (locally-served) site, plus the L4 boundary checks the suite always applies. The rubric is derived 1:1 from the PRD's MUST criteria (filter, search, most-recent-first ordering, card contents, config reveal/copy, no-config-affordance, per-category tabs, per-tab brief, cross-tab isolation, no visitor add-run control, prominent repo links, `.faff/` committed, dark+light, lowercase "faff", automated deploy) plus: PRD byte-identical after the run, admission gates fired.

**Failure modes.**

- **The failure:** the copied PRD drifts from the committed source (someone edits the SUT copy, or the copy step silently no-ops). Then the run is measured against the wrong setpoint. **How you'd know:** `diff docs/prd/faff-lab.md $FAFF_ROOT/verification/external-verification/faff-lab/PRD.md` is non-empty after scaffold. **What it means:** proceed only on a clean diff; the `cp` is the single source-of-truth link.
- **The failure:** `faff gitignore-ensure` is reintroduced "for parity" and silently re-ignores `.faff/`, violating the PRD. **How you'd know:** `.faff/` appears in the SUT's `.gitignore`, or is untracked after a run. **What it means:** the `.faff/`-commit criterion fails in scoring — abandon the gitignore-ensure call.
- **The failure:** the live-deploy question (see the Punt) is answered wrongly and the first run either burns time provisioning paid infra or is scored as "not shipped" for a criterion it was never meant to satisfy on pass one. **How you'd know:** the run stalls on secret/infra provisioning, or the rubric's deploy row can't be scored. **What it means:** the human resolves the Punt before the first run; the scaffold ships local-first regardless.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fresh empty SUT_ROOT
When scaffold-faff-lab.sh runs
Then the repo contains docs/prd/faff-lab.md (byte-identical to the committed source), .faffrc.yaml,
     BRIEF.md, RUNBOOK.md, a wired Stop-hook, and one initial commit
```

```
Given a non-empty SUT_ROOT and FORCE unset
When scaffold-faff-lab.sh runs
Then it prints a refusal to stderr and exits 1, writing nothing
```

```
Given the scaffolded SUT
When its .gitignore and tracked file set are inspected
Then .faff/ is NOT gitignored (PRD acceptance criterion), while .env.claude-box IS gitignored and unstaged
```

- The README's suite table lists **six** rungs, faff-lab's row noting it is a permanent deliverable unlike P1–P5.
- The RUNBOOK cites no non-existent `faff prd` verb (`--from` / `admit`).

## 6. DESIGN DECISION RATIONALE

**How is the PRD seeded into the SUT?** Heredoc (P2's mechanism) vs copy the committed file. Heredoc would duplicate the setpoint and let the two drift. **Chosen:** copy verbatim from `verification/external-verification/faff-lab/PRD.md` — the faff-lab README mandates single-sourcing, and the PRD is a real committed document (unlike P2's, which only ever lived in a heredoc).

**Where does the PRD land in the SUT?** Repo-root `PRD.md` (P4's shape) vs `docs/prd/<container>.md` (P2's post-FAFF-524 shape). A root file is invisible to `faff prd list`, so the L4 auto-gate never fires. **Chosen:** `docs/prd/faff-lab.md`, matching the PRD's existing `Container: faff-lab` line to `tracking.container`, so the run-start prd-readiness gate fires for real.

**Is `.faff/` gitignored?** P1–P5 run `faff gitignore-ensure` (ignores `.faff/`) vs commit `.faff/`. The faff-lab PRD has a hard MUST: commit `.faff/`. **Chosen:** commit `.faff/` — write a `.gitignore` that omits it and skip `gitignore-ensure`. This is the deliberate, PRD-forced deviation from the P2 template.

**Tracker binding?** Dedicated Linear container up front vs git-only-first. **Chosen:** git-only-first per ADR 0070 — no `tracking.*` tracker keys, only `tracking.container` (a discovery key, not a binding), `automation_default: opt-out` as the autonomous on-switch. The tracker upgrade is a documented reversible follow-up.

**Budget numbers?** P2 uses `max_attempts: 16` / `tokens: 80000000`. faff-lab is a larger deliverable (multi-page site + deploy pipeline). **Chosen:** `max_attempts: 40`, `tokens: 200000000` (~2.5x P2), `at_ceiling: escalate` — a founded scale-up, deliberately generous, and a cheap reversible edit if the first run shows it wrong (ADR 0070's "a wrong call is a cheap edit" logic applies). `max_attempts` is a count backstop excluded from the L4 spend gate; `budget.cost` is noted (commented) as the recommended real governor.

**Scoring rubric shape?** Reuse P1–P5's "did the behaviour occur / boundary respect" rubric vs a real-deliverable rubric. **Chosen:** a real-deliverable rubric scoring "did it ship" against the PRD's MUST acceptance criteria 1:1, plus the standard L4 boundary checks (PRD untouched, admission gates fired) — this is what the ticket's "did the real deliverable ship, not just did the behaviour occur" framing requires, and the PRD's concrete MUSTs make it born-verifiable.

**Admission-flow commands?** The fictional `faff prd new --from` / `faff prd admit` (as some earlier runbooks cite) vs the real surface. **Chosen:** the real surface only — Layer 1 `faff contract prd-readiness`, Layer 2 `faff prdr new` / `faff prdr admit`, pointing at `authoring-and-admitting-a-prd.md`. Propagating the fiction is explicitly forbidden (FAFF-507).

**Deploy posture on the first proving run?** Real automated live deploy on pass one (needs paid-infra + secret provisioning the scaffold must not commit) vs local-first with deploy deferred. **Chosen (direction):** local-first — `env: faffter-noon-env-compose` (a local docker-compose stand-in, matching P2/P3), the deploy *automation* built into the deliverable but validated locally/in-CI on pass one; secrets never committed. This is grounded in ADR 0070's git-only-first minimalism, the ticket's own "note local-first for deploys" instruction, and the P2/P3 env-slot precedent. **The residual is a Punt** (below): whether the first proving run must nonetheless perform a real live public deploy to satisfy the PRD's hard "no manual deploy step" acceptance criterion, or whether that live cutover legitimately defers to the tracker-upgrade follow-up.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** Does the *first* faff-lab proving run have to perform a real live public deploy (Netlify/Fly, requiring operator-supplied deploy secrets and paid-infra provisioning the scaffold must not commit), or is "automated deploy pipeline built and locally/CI-validated, live cutover deferred to the tracker-upgrade follow-up" a legitimate pass-one outcome? The PRD makes automated deploy a hard MUST; ADR 0070's git-only-first minimalism and the ticket both lean local-first-with-deploy-deferred — but the point at which live-cutover becomes mandatory is a genuine product call precedent does not settle (no prior rung deploys a long-lived site). **Not load-bearing for this script** — the scaffold ships local-first (`env: faffter-noon-env-compose`, secrets never committed) either way; this only tunes how the RUNBOOK rubric scores the deploy criterion on pass one and whether the run is expected to provision deploy secrets. (decides: product)

**Assumptions.**

- **Assumes:** `verification/external-verification/faff-lab/PRD.md`, `verification/external-verification/faff-lab/README.md`, and `records/adr/0070-faff-lab-tracker-vs-git-only.md` are present and committed (FAFF-504). Validate: `test -f` each before the `cp`; the copy step depends on the PRD existing at that path.
- **Assumes:** the P2/P3 `backends:` + `faffter_dark.adversarial` block and the `.env.claude-box` copy mechanism are current. Validate: diff the block against `scaffold-p2-task-api.sh` / `scaffold-p3-landing-page.sh` at build time and copy the live shape (do not hand-transcribe stale model ids).
- **Assumes:** `faff hooks-ensure`, `faff gitignore-ensure` (deliberately NOT used here), and the `faff prd` / `faff prdr` / `faff contract prd-readiness` surface are as documented in `authoring-and-admitting-a-prd.md`. Validate: `faff prd --help` / `faff prdr --help` before writing the RUNBOOK verbs.

## 8. DONE — Definition of Done

### From WHY
- [ ] `verification/external-verification/scaffold-faff-lab.sh` exists, is executable, and mirrors P2's structural conventions (SUT_ROOT, FORCE refusal, FAFF_ROOT-before-cd, git init, secret-leak guard, hooks-ensure, initial commit).

### From WHAT (seeded files)
- [ ] Running against a fresh `SUT_ROOT` yields: `docs/prd/faff-lab.md` (byte-identical to the committed source), `.faffrc.yaml`, `BRIEF.md`, `RUNBOOK.md`, a wired Stop-hook, and one initial commit.
- [ ] `docs/prd/faff-lab.md` is a verbatim copy of `verification/external-verification/faff-lab/PRD.md` (`diff` empty), not a heredoc.

### From HOW (behaviour)
- [ ] A non-empty `SUT_ROOT` without `FORCE=1` is refused (stderr message + exit 1); `FORCE=1` overrides.
- [ ] The SUT's `.gitignore` does **not** list `.faff/`, and `gitignore-ensure` is not called (PRD `.faff/`-commit criterion).
- [ ] `.env.claude-box` is gitignored and forced out of the index (never committed).
- [ ] `.faffrc.yaml` is valid (`faff config path` in the SUT resolves it), reflects git-only-first (no tracker `project_id`/`team_key`; `tracking.container: faff-lab`; `automation_default: opt-out`), carries the scaled budget (`max_attempts: 40`, `tokens: 200000000`, `at_ceiling: escalate`), the six slots, and the adversarial dials + backends block.
- [ ] The scaffolded PRD is admissible: the `prd` slot's `faff-contract:prd-readiness` block piped to `faff contract prd-readiness` exits 0 (`admissible`).

### From HOW (RUNBOOK + rubric)
- [ ] `RUNBOOK.md` cites only the real admission surface (`faff contract prd-readiness`, `faff prdr new`/`admit`); it contains no `faff prd new --from` and no `faff prd admit`.
- [ ] `RUNBOOK.md` ends with a real-deliverable scoring rubric derived 1:1 from the PRD's MUST acceptance criteria, plus PRD-untouched + admission-gate-fired boundary checks, and notes local-first-for-deploys / secrets-never-committed.

### From the README update
- [ ] `verification/external-verification/README.md`'s "five rungs" framing becomes six, with a table row for `scaffold-faff-lab.sh` noting faff-lab is a permanent deliverable unlike P1–P5.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. SUT=$(mktemp -d)/faff-lab
  2. SUT_ROOT=$SUT bash verification/external-verification/scaffold-faff-lab.sh
  3. ASSERT files exist: $SUT/{.faffrc.yaml,BRIEF.md,RUNBOOK.md,docs/prd/faff-lab.md}
  4. ASSERT diff $SUT/docs/prd/faff-lab.md verification/external-verification/faff-lab/PRD.md is empty
  5. ASSERT .faff/ not in $SUT/.gitignore ; git -C $SUT log --oneline shows one commit
  6. ASSERT (cd $SUT && SUT_ROOT=$SUT bash <scaffold>) refuses without FORCE=1
```
