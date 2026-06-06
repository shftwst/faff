# Spec — `faff config init`: deterministic `.faffrc.yaml` writer (FAFF-5)

This is the build spec for **FAFF-5**, a new `faff config init` subcommand on the bundled dependency-free `faff` CLI (`skills/faff/bin/faff`). It is written for the build agent who will implement the subcommand, and for human reviewers gating the design. It is the **persistence half** of the first-run bootstrap: FAFF-6 (the conversational bootstrap skill) decides the `tracking` values from connected-MCP + git-remote detection and calls this subcommand to write them. FAFF-5 owns *only* the deterministic write; it sees no MCP and makes no value-discovery decisions.

---

## 1. WHY — Problem and Principles

**Problem statement.** Today nothing writes a `.faffrc.yaml`: the CLI can *resolve and read* config (`config path|get|dump|spec-docs-path|resolved`, shipped by FAFF-50) but has no *write* path, so the first-run bootstrap (FAFF-6) would have to hand-roll YAML in the agent — exactly the prose-shaped, non-deterministic config handling FAFF-50 was created to kill. `faff config init` closes the loop: a deterministic, testable CLI writer that produces or merges a `tracking` block the existing parser reads back, so the agent supplies values and the tool owns the bytes.

**Design principles.**

**Deterministic tool, not prose.** This is the governing tenet (gateway → Governing principles). The same `--set` inputs against the same file state must always produce the same bytes and the same exit code. No value discovery, no MCP, no "smart" inference lives here — that is FAFF-6's job in the orchestrator lane. An implementation that reads the environment or guesses values violates the lane split and must be rejected.

**Non-destructive is a hard floor, not a default.** The command must never overwrite the file blind and never clobber a key the caller did not pass. This governs the whole design: the merge path is a *surgical text edit*, never a parse-then-reserialise. An implementation that round-trips the file through `parseYamlSubset` and re-emits it is incorrect even if it passes the happy-path tests — the parser is lossy (it drops comments, inline annotations, block scalars, and key order, confirmed against the live CLI), so reserialising would silently destroy a user's `slots:` / `appetite:` / comments. Reject any design that reserialises the whole file.

**Round-trip is the contract.** "Valid `.faffrc.yaml`" means exactly "a file the existing `parseYamlSubset` reads back to the values written." The done-signal is defined by the existing reader, not by general YAML correctness. The writer is the missing inverse of the existing `scalar()` reader and must agree with it.

**Scope statement.** A new write-side subcommand sitting beside the read-side `config` family in the one bundled CLI, feeding the FAFF-6 bootstrap that blocks on it.

---

## 2. OUT OF SCOPE

- **Non-`tracking` keys** (`slots.*`, `appetite`, `concurrency_max`, `worktree_root`, any `faffter_dark`/methodology config) — MVP is the `tracking` block only.
- **MCP / tracker / git-remote value discovery** — FAFF-6's orchestrator-lane job.
- **A general-purpose YAML serialiser** — only a flat `tracking` block of string scalars needs emitting.
- **Gitignoring `.faffrc` / `.faff/`** — that is FAFF-67.
- **Removing or editing keys** — `init` only creates or adds/updates values.

---

## 3. WHAT — Command surface

```
faff config init [--root DIR] --set <dotted.key>=<value> [--set ...] [--force] [--dry-run]
faff config init --selftest
```

Exit codes: `0` success (created / merged / clean no-op); `2` usage / refusal (bad `--set`, unknown key, legacy file present, conflict without `--force`, round-trip failure). `init` does not use exit 3.

**Accepted keys (the MVP allowlist).**

```
TRACKING_KEYS = {
  "tracking.tracker", "tracking.team_key", "tracking.repo",
  "tracking.git_host", "tracking.spec_docs_path",
}
```

A bare key (`team_key`) is accepted as sugar and normalised to its `tracking.` form. Any key outside `TRACKING_KEYS` is rejected loudly (exit 2).

**Chosen:** repeated `--set dotted.key=value` flags (testability + determinism), bare keys accepted as `tracking.` sugar.
**Chosen:** allowlist `TRACKING_KEYS`, reject unknown keys with exit 2.

---

## 4. HOW — Behavior

`init` is a new branch inside `cmdConfig` (inherits the existing `--root` parse + `try/catch` that maps `legacy-config-name` → loud stderr + exit 2). Three new pure helpers carry the novel logic: `emitScalar(value)` (inverse of `scalar()`), `mergeTrackingBlock(rawText, sets, force)` (surgical editor), and `cmdConfigInit(args, root)` (orchestration). Only the final `fs.writeFileSync` is impure.

**Merge semantics — Chosen:** set-given-keys with conflict-guard. Write every passed key that is absent; for a passed key already present with a *different* value, refuse and report unless `--force`; identical value is a no-op.

**Emit fidelity — Chosen:** surgical raw-text edit, never parse-then-reserialise (the parser is lossy and would destroy `slots:`/`appetite:`/comments). Create-from-scratch only when no file exists.

**Refuse-second-file — Chosen:** reuse `findConfig`'s `legacy-config-name` throw, propagating to the existing `cmdConfig` catch.

**Round-trip self-verify — Chosen:** parse the written text in-process and assert each set key reads back to `scalar(value)` before writing; abort (exit 2, write nothing) on mismatch.

**emitScalar quoting.** Quote (double-quote, escaping `\` and `"`) when: value is empty; has leading/trailing space; contains ` #`; first non-space char is a YAML indicator; or `scalar(value) !== value` (would coerce to bool/number/null). Otherwise emit bare. **Chosen:** double-quotes only (parser's single-quote handling lacks `''` escaping).

**Create block.** Header `# .faffrc.yaml — faff configuration (written by \`faff config init\`)`, then `tracking:` and 2-space-indented children in canonical `TRACKING_KEYS` order, ending in a single newline.

**Edge cases.** Legacy file present → exit 2, nothing written. `tracking:` present but empty → keys inserted. Conflict without `--force` → exit 2, every conflicting key reported, file untouched. Identical values → idempotent no-op. `--dry-run` → print would-be file, write nothing, still exit 2 on conflict. No `--set` / malformed `--set` / unknown key / round-trip failure → exit 2.

---

## 5. DONE — Definition of Done

- Read-back: after `init --set tracking.team_key=FAFF` in a config-less repo, `config get tracking.team_key` prints `FAFF`, exit 0.
- No MCP / env reads (lane split).
- Repeated `--set`; bare-key sugar; unknown-key exit 2; no-`=`/no-`--set` exit 2; same key twice with differing values exit 2.
- Create path: `tracking:` block with passed keys in canonical order + header, single trailing newline; round-trips via `config dump`.
- Merge path: existing `slots:`/`appetite:`/comments untouched (byte-equal); new key inserts one line; absent block appended; never reserialises.
- Idempotency + conflict: identical re-run no-op; differing value without `--force` exit 2 reporting every conflict; `--force` overwrites only conflicting lines.
- Refuse-second-file: `.faffrc`/`.faffrc.yml` present → exit 2, no `.faffrc.yaml` written.
- Emit fidelity: `true`/`123`/`~`/` #`/leading-trailing-space/indicator-led values quoted; plain values bare; all round-trip.
- `--dry-run` prints, writes nothing, exit 2 on conflict.
- `config init --selftest` runs an in-memory table covering create-fresh, merge-add-key, preservation, idempotent no-op, conflict-refused, conflict-forced, refuse-on-legacy, quoted/bare emit, unknown-key; per-case ok/FAIL + RESULT line, non-zero on failure.
- `init` added to USAGE + the `cmdConfig` usage hint.

confidence: high
