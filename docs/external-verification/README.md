# faff — external-verification SUT scaffolders

These scripts each scaffold one **subject under test** (SUT) — a fresh, isolated repo that
faff is pointed *at* (faff is the tool; the SUT is the subject). They are the runnable
companion to [`design/faff-external-verification-brief.md`](../../design/faff-external-verification-brief.md),
which explains *why* each project exists and *what behaviour* it instruments.

The point of the suite: faff's newest lanes — **architecture → env → evaluate** — are
structurally un-dogfoodable (faff has no runtime to stand up or judge), so they shipped with
zero real-world miles. Each SUT exercises a specific slice, and **the rung at which faff first
fails is the binding constraint** — the next roadmap priority.

## The five rungs

| Script | SUT | Behaviours | Autonomy | Tracker |
|---|---|---|---|---|
| `scaffold-p1-link-shortener.sh` | Verifiable greenfield micro-service | B1 B2 B3 B6 | lights-out eligible | git-only |
| `scaffold-p2-task-api.sh` | PRD-driven multi-increment app | B5 B6 B8 | lights-out + `--converge` | git-only (upgrade to tracker noted) |
| `scaffold-p3-landing-page.sh` | Fuzzy-quality deliverable | B4 (honest boundary) | lights-out eligible | git-only |
| `scaffold-p4-stripe-testmode.sh` | Real consequences / external state | B7 (safety floor) | **gated — L2/L3 only** | git-only |
| `scaffold-p5-brownfield.sh` | Messy legacy repo + vague ask | all, under ambiguity | **gated — L1–L3** | git-only |

## How to run

Each script is self-contained. `SUT_ROOT` defaults to a **sibling `faff-suts/<slug>` directory
next to the faff repo** — resolved from the script's own location, never `$HOME` (which is
container-ephemeral). So the zero-arg invocation lands the SUT at `<faff-repo>/../faff-suts/<slug>`:

```bash
bash docs/external-verification/scaffold-p1-link-shortener.sh
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
