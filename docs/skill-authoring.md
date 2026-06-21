# Skill-authoring charter

The standard every faff skill prompt (`SKILL.md`) is written to: **lean, deduplicated, skimmable.** This doc is the single home for that ethos and is written *as* the ethos — terse, bulleted, factual — so it is its own worked example.

It is faff's **contributor guidance**, not faff config. The faff CLI reads config only via `faff config` (the `.faffrc.yaml` path); this charter and the repo-root `CLAUDE.md` that loads it are never a config source.

## Why it exists

- A skill prompt is loaded into context on every use. Bloat is paid every run: slower, costlier, harder to follow.
- The lean/dedup/skimmable passes are only durable if there's a written standard new work is held to — otherwise the ethos rots and the next prompt re-grows the cruft.
- The machine-checkable subset is enforced by `faff validate-adapters` (a CI gate). The rest is review guidance — taste a tool can't measure.

## Principles (taste — review guidance, not linted)

- **Lean.** Say it once, at the altitude it belongs. Cut anything the runtime reader doesn't need to act correctly.
- **Deduplicated.** Shared prose has **one canonical home** (the gateway, `faff/SKILL.md`); every other skill *references* it, never copies. Single-source per FAFF-115.
- **Skimmable.** Bullets and tables over walls of prose. A reader should grasp the shape by scanning, not by close reading.
- **Runtime prompt, not changelog.** State the *rule*, forward. War-stories — "this fixes a real failure", "bit us twice", run-ids, transcript breadcrumbs — belong in git history, ADRs, or `design/`, not the prompt. A reference is *load-bearing* only when the reader must follow it to act (a contract anchor, a section pointer); decorative issue-tags are cruft.

## Lint rules (mechanical — enforced by `faff validate-adapters`)

Run over every `SKILL.md`. A violation prints `FAIL <name> (<category>) ✗ <label>` and exits non-zero. Thresholds are calibrated against the post-FAFF-114–119 tree as **lenient ceilings** (ratchet down as prose is leaned), not tight targets — same philosophy as the advisory `eval/size-census.mjs` prompt-size gate.

| Category | Rule | Threshold |
|---|---|---|
| `line cap` | per-file `SKILL.md` line count | 600 lines; gateway (`faff`) hub override 1000 |
| `paragraph` | longest single prose line (≈ one paragraph) | 200 words — nudge bullets over prose |
| `stray marker` | transcript run-ids + retrospective war-story idioms | zero tolerance (load-bearing `FAFF-NN`/section anchors are **not** matched) |
| `duplicated block` | identical run of significant lines across 2+ skills | 6 significant lines — single-source it instead |

**Honest limits.** These catch the realistic drift (a skill ballooning, a wall-of-text paragraph, copied prose, a stray breadcrumb). They do **not** measure taste, skimmability, or whether a kept reference is genuinely load-bearing — that stays human/agent review judgement. The stray-marker rule is deliberately narrow (precise idioms, not a blanket issue-tag ban) to avoid false-positiving the load-bearing `FAFF-NN` anchors the tree legitimately carries.

## For new slot skills

`faffter-dark-authoring-adaptors` scaffolds new adaptors/producers/methodologies **to** this charter — write to it from the start rather than retrofitting.
