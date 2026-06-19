# FAFF-182 — Make all config defaults CLI-enforced

> Spec: faffter-dark-nlspec · 2026-06-19 · autonomous · confidence: high. Full spec on Linear FAFF-182.

A central `DEFAULTS` registry in the CLI makes `faff config get <key>` default-aware, so neither a slot occupant nor a scalar default is supplied by prose via `-d`.

## Scope of THIS PR (the deterministic core)
- `DEFAULTS` registry (slots.* + logging/concurrency_max/automation_default/appetite) in the CLI.
- `config get <key>` returns the registry default for an unset registry key (exit 0); non-registry keys unchanged (+ `-d`).
- `config defaults [--selftest]` prints/asserts the registry.
- Prose sweep: drop `-d <default>` on registry keys across skills.
- Tests (registry, default-aware get, exit-0-not-3 regression).

## Narrowed to a follow-up (higher-risk, critique-flagged splittable)
- Dispatch-site prose sweep (drop the default *skill name* at each "invoke the slot" site) + the validate-adapters lint forbidding `-d` on a registry key / a literal default skill at a dispatch site. The lint has real false-positive risk (doc mention ≠ dispatch) and deserves its own careful pass. Filed as a peer ticket.

confidence: high
