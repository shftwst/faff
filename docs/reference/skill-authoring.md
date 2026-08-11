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
- **Runtime prompt, not changelog — and self-contained.** State the *rule*, forward. War-stories — "this fixes a real failure", "bit us twice", run-ids, transcript breadcrumbs — belong in git history, ADRs, or `design/`, not the prompt. Prose the reader *executes* (`SKILL.md`) or *publicly consumes* (`docs/guide/`) carries **no** `FAFF-NN`/`ADR` reference: a ticket or ADR is the reasoning that *produced* a rule, never something the reader follows, so a ref there is either decorative (delete it) or smuggling meaning the prose should state outright (inline the rule, then delete the ref) — there is **no** "load-bearing external ref" in this prose. The only cross-references that stay are **within-prose anchors** (`gateway → Section`, sibling skill names like `faff/SKILL.md`) — the dedup mechanism, pointing at prose in the same corpus. `docs/` outside `docs/guide/` (ADRs, specs, this charter, design notes) is the reasoning corpus and *is* ref-permitted: enforced prose inlines *from* it, it never points *into* it.

## Lint rules (mechanical — enforced by `faff validate-adapters`)

Run over every `SKILL.md`. A `FAIL <name> (<category>) ✗ <label>` line exits non-zero; a `WARN`/`RATCHET` line is advisory — it surfaces the violation without failing the build (see **Honest limits** below). The shared `line cap` (600) is a lenient ceiling, calibrated against the post-FAFF-114–119 tree. The two hub files — the gateway (`faff`) and the beep-boop orchestration hub — instead run a **downward ratchet**: each one's baseline is set to its own exact committed line count (zero headroom), so any growth FAILs and any shrink prints a non-failing `RATCHET` advisory nudging the baseline down to lock the reduction in. Those baseline numbers live only in code (`SKILL_LINE_BASELINE` in `validate-adapters.js`) and are never restated here — a volatile per-file number quoted in prose is exactly the drift vector that once let this doc and the code disagree (FAFF-584).

| Category | Rule | Threshold |
|---|---|---|
| `line cap` | per-file `SKILL.md` line count | 600 lines (shared ceiling); the two hub files (`faff`, `faff-beep-boop`) instead ratchet downward from their own committed size — see above |
| `paragraph` | longest single prose line (≈ one paragraph) | 200 words. Plain prose FAILs; a bold-lead bullet (`- **…`/`* **…`, the house mega-bullet style) over cap WARNs instead, so the house style is no longer exempt (FAFF-584) |
| `anchor` / `ambiguous anchor` | a `→ **Section**` cross-reference resolves to a real heading somewhere in the corpus; a heading text is not repeated within one file | WARN on a target with no matching heading, or on a within-file duplicate heading. Resolves *existence*, not nesting (FAFF-584) |
| `stray marker` | transcript run-ids + retrospective war-story idioms | zero tolerance (section anchors are not matched; `FAFF-NN`/`ADR` refs are banned **separately** — see below) |
| `duplicated block` | identical run of significant lines across 2+ skills | 6 significant lines — single-source it instead |

**External-artifact refs — banned, enforced by `faff lint-refs`.** Separate from the `validate-adapters` table above (which lints only the slot-skills): `faff lint-refs` scans prose the reader *executes* or *publicly consumes* — `plugin/skills/**/SKILL.md` and `docs/guide/**` — and fails CI on any `FAFF-NN` ticket tag, `ADR NNNN` citation, or numbered `records/adr/` pointer, naming `file:line ✗ match`. It does **not** touch `docs/` outside `docs/guide/` (the reasoning corpus — ADRs, specs, this charter — is ref-permitted, and `records/adr/**` *must* keep its supersession back-refs for `faff adr validate`), and it never flags within-prose anchors. (Currently enforced on `docs/guide/`; the `SKILL.md` surface is being swept ref-free, then enabled.)

**Honest limits.** The `validate-adapters` rules catch the realistic drift (a skill ballooning, a wall-of-text paragraph, copied prose, a stray war-story idiom, a broken cross-reference). They do **not** measure taste or skimmability — that stays human/agent review judgement. The `stray marker` rule is deliberately narrow (precise idioms, not a blanket ban); ticket/ADR refs are not its job — `faff lint-refs` owns that ban. The two hub files' zero-headroom ratchet has its own honest limit: `validate-adapters` is a **stateless** linter — it reads the working tree, never git history — so it cannot mechanically stop a contributor from hand-raising a `SKILL_LINE_BASELINE` value to fit growth instead of leaning the file. The real gate is that such a raise is a conspicuous, reviewable line in the diff, not a silent pass; a git-history check that asserts baselines never increase across commits is deferred (FAFF-584).

## Eval coverage — born with the ticket

A judgement seam ships with its eval coverage; the net never plays catch-up (the FAFF-145 / ADR-0004 lesson — every seam used to ship first and the evals chased).

- **Declare the seam.** Every slot skill carries a `judgement_seam:` frontmatter key (sibling to `name` / `user-invocable`): a comma list of the grader `KIND`(s) its LLM-judgement seam owns — or `none` for an asserted-deterministic skill. An alternate occupant declares its slot sibling's KIND(s) (the slot-sibling relaxation), not `none`.
- **Register the coverage in the same change.** A ticket that introduces or changes a judgement seam registers a grader `KIND` + ≥1 case fixture (`eval/cases/<kind>-NNN.json`) + the `eval/seam-registry.json` row — all autonomous-doable. It must **not** require a recorded baseline value: accepting the baseline is the one human-supervised, CI-excluded step (ADR-0004), so the gate would otherwise block every autonomous build.
- **The mechanical backstop.** `faff validate-adapters` gates the structural half: a registry **surface** with no `judgement_seam:` declaration fails (C1); a `covered` KIND with zero cases fails (C2); a `designed` KIND with zero cases and an unrowed slot-skill are loud advisories that flip to a hard fail the instant a row is registered. "Did the ticket actually need a seam" stays review judgement — intent isn't statically inferable.

## For new slot skills

`faffter-dark-authoring-adaptors` scaffolds new adaptors/producers/methodologies **to** this charter — write to it from the start rather than retrofitting.
