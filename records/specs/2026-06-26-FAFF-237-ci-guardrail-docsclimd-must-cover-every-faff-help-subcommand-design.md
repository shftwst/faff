# Spec — CI guardrail: `docs/guide/cli.md` must cover every `faff` subcommand

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · confidence: high.

This is the buildable design for a deterministic check that fails CI when the CLI reference doc (`docs/guide/cli.md`) drifts out of sync with the bundled `faff` CLI's actual subcommand set. It mirrors the just-merged `faff lint-refs` (FAFF-238) as its sibling pattern.

## 1. WHY — Problem and Principles

**The load-bearing model:** the CLI's true subcommand set is the dispatch table in `bin/faff`'s `main()`; the doc is a hand-maintained restatement of it. Two lists with no mechanical link drift apart silently. This check makes the doc's coverage a gated, deterministic property — same input, same pass/fail — so staleness fails the build instead of waiting for someone to notice.

**Problem statement:** the CLI reference doc silently rotted to 11 of 25 subcommands (root-caused by FAFF-236) because doc upkeep was a separate, skippable manual step. The drift recurred immediately: FAFF-238 added `lint-refs` to the CLI but not to the doc, so the current tree documents 23 of 24 subcommands. A CI guardrail removes the reliance on discipline.

**Design principles:**

- **Single source of truth for the command set.** The check reads the CLI's command names from the same structure the dispatcher uses — a `COMMANDS` name→handler registry — never by re-parsing `--help` prose or scraping source text with a regex.
- **Deterministic tools over prose** (governing tenet). Mirrors how `validate-adapters` and `lint-refs` gate conformance in CI.
- **Fail loud, name the offender.** On drift, print the exact missing / orphaned command name(s).

## 2. OUT OF SCOPE

- Config-key and slot coverage (v1 = CLI reference only).
- Per-flag / per-argument doc coverage.
- Keeping `USAGE` and the dispatch table in sync with each other.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Canonical command set | The set of subcommand names the CLI actually dispatches (excludes the `-h` / `--help` / `help` aliases). |
| Documented command set | The set of subcommand names extracted from `docs/guide/cli.md`. |
| Missing | A command in the canonical set absent from the documented set (doc is behind the CLI). |
| Orphaned | A command in the documented set absent from the canonical set. |

**The subcommand registry (new single source of truth).** Replace the `if (sub === "X") return cmdX(rest)` chain in `main()` with a name→handler map both the dispatcher and the new check read. The canonical command set is then exactly `Object.keys(COMMANDS)`.

**Command interface (mirrors `lint-refs`):** `faff lint-cli-doc [--root DIR] [--selftest] [--json]` — exit codes `0` in sync · `1` drift · `2` usage / unreadable doc.

## 4. HOW — Behavior

`cmdLintCliDoc` is a pure function over two derived sets: `canonical = Set(Object.keys(COMMANDS))` and `documented = parseDocumentedCommands(docs/guide/cli.md)`. `missing = canonical \ documented`, `orphaned = documented \ canonical`. Empty union → PASS exit 0; else name each and exit 1.

**Doc parsing.** Commands are documented as the first inline-backtick span opening a markdown table row's first column. Extract the first command-shaped token (`^\|\s*` + backtick + `([a-z][a-z-]*)`), dedupe to base commands. Anchored to the row's leading span so `--flags`, `.faffrc.yaml`, `records/adr/` spans never match.

## 5. DONE — Definition of Done

- A new `faff lint-cli-doc` subcommand exists, registered in the `COMMANDS` map, with `--root`, `--selftest`, `--json`, exit codes 0/1/2.
- `main()` dispatches through the `COMMANDS` registry; canonical set = `Object.keys(COMMANDS)`.
- A subcommand present in the CLI but absent from the doc fails, naming it (`✗ missing: <name>`).
- A command documented but not exposed by the CLI fails, naming it (`✗ orphaned: <name>`).
- `.github/workflows/validate.yml` runs `faff lint-cli-doc --selftest` then `faff lint-cli-doc`, beside the `lint-refs` steps.
- `test/lint-cli-doc.test.mjs` exists (mirroring `test/lint-refs.test.mjs`).
- `docs/guide/cli.md` gains a `lint-refs` row and a `lint-cli-doc` row, so the check exits 0 against the merged tree.

## ADR promotion intent

- **Subcommand registry as the single source of truth** — `main()` dispatches through a `COMMANDS` name→handler map, and `Object.keys(COMMANDS)` becomes the canonical subcommand set.
