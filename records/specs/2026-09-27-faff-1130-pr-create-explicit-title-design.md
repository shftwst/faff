# FAFF-1130 — faff pr-create needs an explicit --title in a non-TTY session

> Spec: faffter-dark-nlspec · 2026-09-27 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1130.

`faff pr-create` (graft's Step-9b PR-open) fails in an agent (non-TTY) session when no `--title` is passed, and graft's Step-9b prose says the title is "implicit". Both rest on the same false premise: that `gh pr create` derives a title from the head commit. It does not, headless.

## Root cause (verified this prep)

`cmdPrCreate` (`plugin/skills/faff/bin/lib/merge-gate.js:1748`) builds `ghArgs = ["pr","create","--body-file",bodyFile]` and appends `--title` only `if (title)` (`:1749`). The comment at `:1702` states the gh invocation is "byte-for-byte Step 9b's (`--body-file` + optional `--title`)". With no `--title`, `gh pr create` in a non-interactive shell exits non-zero: "must provide `--title` and `--body` (or `--fill` …) when not running interactively" — no PR is opened.

Graft's Step-9b prose (`faff-graft/SKILL.md`) compounds it: it says the title "derives from the head commit's subject … Only when `pr_title` genuinely diverges … does this step add an explicit title." Two problems: (1) the implicit derivation is unavailable headless (gh demands `--title`/`--fill`); (2) even if available, the **head commit at PR-open time is the Step-9b anchor chore** ("chore(<issue>): anchor run evidence for PR"), committed just before `gh pr create` — so an implicit title would name the PR after the anchor, not the build.

Observed live: opening PR #960 for FAFF-1126 needed a manual `--title` retry after the title-less call failed.

## What to build and why

**Chosen:** Graft Step-9b **always** passes an explicit `--title` to `faff pr-create`, resolved from the issue via the existing `pr_title` convention (`faff conventions get pr_title`, the same resolver Step 9b already references) — never relying on gh's implicit derivation and never on the head commit (which is the anchor chore). Rationale: graft knows the conventional `<type>(<issue>): <title>` deterministically from the ticket + convention (exactly as Step 4 resolves `commit_subject`), so it does not depend on commit ordering or a TTY. This changes Step-9b from "add `--title` only on divergence" to "always supply it".

**Chosen:** `cmdPrCreate` no longer emits a `gh pr create` that fails headless for a missing title — defense-in-depth for any caller that omits `--title`. When `--title` is absent it fails **loud with a clear remedy** ("pass --title; gh requires it in a non-interactive session") rather than shelling a title-less `gh pr create` that dumps gh's usage text and opens nothing. Rationale: a fail-loud with the remedy is honest and actionable; the raw gh usage dump on a non-zero exit is neither. (The build may instead choose a titled fallback — gh `--fill` or a CLI-side derivation from the branch's newest non-faff-chore commit subject — **only if** it verifiably composes with `--body-file` in gh and yields the build title, not the anchor/spec commit; if that's uncertain, the fail-loud-with-remedy is the safe choice. Either way, no silent title-less gh call survives.)

**Chosen:** Update the Step-9b prose so it no longer claims an implicit title works in an agent session — state forward that the caller must supply `--title` (resolved from the build change via `pr_title`/`commit_subject`), and drop the "only on divergence" phrasing.

**Assumes:** `faff pr-create`'s only caller is graft Step-9b (verified: `cmdPrCreate` is invoked from the graft flow; no other skill opens PRs). So tightening the title requirement breaks no other path. Verified this prep against the merge-gate exports + grep.

**Assumes:** the `pr_title` convention resolver (`faff conventions get pr_title`) already exists and yields a conventional subject; this ticket wires graft to always use it, not to build a new resolver. Verified this prep (Step 9b already references it).

**Punt:** the exact `cmdPrCreate` fallback mechanism (hard fail-loud vs gh `--fill` vs CLI-side build-commit derivation) is left to the build to pin against gh's actual `--body-file` compatibility — the spec fixes the class (no silent title-less headless gh call) and mandates the graft-always-passes-`--title` primary; the CLI half's exact shape is an implementation choice within that. `(decides: implementation)`

## Acceptance criteria

1. Graft Step-9b always passes `--title` to `faff pr-create`, resolved via the `pr_title` convention from the issue/build change (not the head anchor commit), in both `push_at_build_complete` configs.
2. `cmdPrCreate` never shells a `gh pr create` that fails in a non-TTY session solely for a missing title: with `--title` absent it either fails loud with an actionable remedy naming `--title`, or opens a titled PR by a verified-headless fallback — never the raw gh usage dump with no PR.
3. The graft Step-9b prose no longer implies an implicit/head-commit title works in an agent session; it states the caller supplies `--title`.
4. A test covers `cmdPrCreate` with no `--title` in a non-TTY context: it asserts the chosen behaviour (fail-loud-with-remedy, or a titled open) — never a bare gh-usage failure — without opening a real PR (the gh call is stubbed/guarded as the existing pr-create tests do).
5. A test covers `cmdPrCreate` **with** `--title`: the title is forwarded to the gh args unchanged.
6. The full suite stays green; `validate-adapters` and `lint-refs` pass (any SKILL line-cap baseline bump applied).

confidence: high
build-tier: mechanical

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    {"marker": "chosen", "topic": "Graft Step-9b always passes an explicit --title resolved via the pr_title convention (not the head anchor commit)"},
    {"marker": "chosen", "topic": "cmdPrCreate never emits a silent title-less headless gh pr create — fail loud with remedy (or a verified titled fallback)"},
    {"marker": "chosen", "topic": "Update Step-9b prose to drop the implicit-title claim"},
    {"marker": "assumes", "topic": "faff pr-create's only caller is graft Step-9b"},
    {"marker": "assumes", "topic": "the pr_title convention resolver already exists"},
    {"marker": "punt", "topic": "exact cmdPrCreate fallback mechanism (fail-loud vs --fill vs derivation) left to the build against gh --body-file compatibility"}
  ]
}
```
