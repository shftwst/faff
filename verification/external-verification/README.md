# faff — external-verification SUT scaffolders

These scripts each scaffold one **subject under test** (SUT) — a fresh, isolated repo that
faff is pointed *at* (faff is the tool; the SUT is the subject). Each project exercises a
specific behaviour and provides its own runbook and scoring material.

The point of the suite: faff's newest lanes — **architecture → env → evaluate** — are
structurally un-dogfoodable (faff has no runtime to stand up or judge), so they shipped with
zero real-world miles. Each SUT exercises a specific slice, and **the rung at which faff first
fails is the binding constraint** — the next roadmap priority.

## The six rungs

| Script | SUT | Behaviours | Autonomy | Tracker |
|---|---|---|---|---|
| `scaffold-p1-link-shortener.sh` | Verifiable greenfield micro-service | B1 B2 B3 B6 | lights-out eligible | git-only |
| `scaffold-p2-task-api.sh` | PRD-driven multi-increment app | B5 B6 B8 | lights-out + `--converge` | git-only (upgrade to tracker noted) |
| `scaffold-p3-landing-page.sh` | Fuzzy-quality deliverable | B4 (honest boundary) | lights-out eligible | git-only |
| `scaffold-p4-stripe-testmode.sh` | Real consequences / external state | B7 (safety floor) | **gated — L2/L3 only** | git-only |
| `scaffold-p5-brownfield.sh` | Messy legacy repo + vague ask | all, under ambiguity | **gated — L1–L3** | git-only |
| `scaffold-faff-lab.sh` | **Permanent** public gallery deliverable (unlike P1–P5, not throwaway) | "did the real deliverable ship" + L4 boundary | lights-out + `--converge` | git-only-first ([ADR 0070](../../records/adr/0070-faff-lab-tracker-vs-git-only.md), upgrade path noted) |

Rungs P1–P5 are **throwaway** SUTs — scaffolded, scored, discarded. `scaffold-faff-lab.sh` (rung 6)
is different: faff-lab is a **long-lived, real deliverable** (the public gallery site, itself
faff-built), so its setpoint (`faff-lab/PRD.md`) and tracker decision (ADR 0070) are committed to
this repo, and the scaffold *copies* the committed PRD into the SUT rather than heredoc'ing it. Its
score is **"did the real deliverable ship"**, not just "did the behaviour occur". See
[`faff-lab/README.md`](faff-lab/README.md).

## How to run

Each script is self-contained. `SUT_ROOT` defaults to a **sibling `faff-suts/<slug>` directory
next to the faff repo** — resolved from the script's own location, never `$HOME` (which is
container-ephemeral). So the zero-arg invocation lands the SUT at `<faff-repo>/../faff-suts/<slug>`:

```bash
bash verification/external-verification/scaffold-p1-link-shortener.sh
# → ../faff-suts/p1-link-shortener   (override with an absolute SUT_ROOT=/path if you must)
```

It will: create the repo, write `.faffrc.yaml` + `BRIEF.md` + `RUNBOOK.md` (+ a PRD for P2/P4 —
P2's lands at `docs/prd/task-api.md` so `faff prd list` can discover it, P4's stays a root
`PRD.md`; + a seeded legacy app for P5), auto-gitignore `.faff/` via `faff gitignore-ensure` and
wire faff's Stop hooks via `faff hooks-ensure` (never a hand-edited `settings.json`), and make the
initial commit. P1/P2/P3 (the lights-out-eligible SUTs) also copy `.env.claude-box` from the faff
root (gitignored first, so it's never staged) and emit a `faffter_dark.adversarial` backend block,
so their adversarial-review gate can actually resolve. It **refuses** to scaffold into a non-empty
dir unless you pass `FORCE=1`.

See [`authoring-and-admitting-a-prd.md`](authoring-and-admitting-a-prd.md) for the current verb
surface P2/P4's RUNBOOKs use to author + admit their PRD leash.

### What the loop is fed (the measurement boundary — FAFF-547)

The suite measures a boundary: *does faff build exactly what was asked, respect its scope ceiling,
and punt what it cannot judge?* That measurement is only valid if the loop under test never sees the
operator's description of the failure modes the suite exists to catch — pasting that in is
teaching-to-the-test (the observer changes the observed). So operator framing (the "the interesting
behaviour is…" intent, the scoring/`DONE` rubric, the `[verifiable]`/`[SUBJECTIVE — must punt]`
tags) is kept structurally out of everything the loop is fed:

- **PRD-less SUTs (P1, P3)** — the loop is fed `BRIEF.md`, which is a **neutral build brief**: stack
  preference, what to build, scenarios (subjective ones intact but with their answer-announcing tags
  stripped), out-of-scope — and nothing else. The intent framing and the completion/scoring rubric
  live in the **operator-only `RUNBOOK.md`** (never pasted).
- **PRD-backed SUTs (P2, P4)** — the loop is fed the **PRD alone** (`docs/prd/task-api.md` for P2,
  `PRD.md` for P4), never `BRIEF.md`. The one load-bearing datum a brief carried for the loop — its
  `## Stack preference` (the architecture proposer reads it) — is relocated **into the PRD**, kept to
  a stack-only line so it doesn't widen the PRD's measured creative-licence. `BRIEF.md` is recast as
  **operator-only orientation** carrying a "do NOT paste — the loop is fed the PRD" banner.

**Note the `BRIEF.md` role overload:** it is a loop-facing neutral brief for P1/P3 but an operator-
only, never-pasted doc for P2/P4. Each RUNBOOK's loop-entry line names exactly what to paste; follow
it rather than the filename. (A `test/scaffolder-lights-out-dials.test.mjs` paste-hygiene guard
enforces this structurally.)

Then open a **new Claude Code session with cwd = the SUT repo** (the faff skills are global and
the `faff` CLI is on PATH, so they operate on the SUT and read its local `.faffrc.yaml`) and
follow that SUT's `RUNBOOK.md`.

## Two deliberate choices, with rationale

- **Hooks via `faff hooks-ensure`, not a hand-written `settings.json`.** Install wiring must be
  skill-owned and repeatable; a hardcoded `faff` path in a committed `settings.json` rots.
- **Token ceilings are tens of millions, not single-digit.** `faff budget check` sums
  `cache_read` tokens; subagent + orchestrator cache-reads dominate, so a 4 M ceiling breaches
  *before any build lands* (logged: 17 M actual vs 4 M ceiling → 0 builds). For L4 lights-out the
  budget-ceiling gate deliberately excludes `max_attempts` (a count is not an L4 governor); the
  real spend governors are `budget.cost` (dollars, priced from the ADR-0048 map — FAFF-427, the
  recommended default), `budget.tokens`, and `budget.until`. `max_attempts` may stay wired as an
  optional extra backstop only.

## Scoring

Each `RUNBOOK.md` ends with a per-project rubric. The score is **"did the behaviour occur and
did faff respect its boundary"**, *not* "did it build the thing." For P3 and P4 a **pass is
correct escalation / parking**, not autonomous completion. Record the **first failure rung** and
take it back to faff's backlog through the front door (`/faff-jot`).
