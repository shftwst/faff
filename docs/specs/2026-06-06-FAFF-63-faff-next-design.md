# FAFF-63 — faff next: deterministic legal-next-step

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high. Full spec on Linear FAFF-63.

## WHY
Skill→skill sequencing was decided from prose. Move the what-comes-next decision into a
deterministic, testable CLI function (the run-ledger/runcheck pattern generalised).

## WHAT / HOW (skills/faff/bin/faff + validate.yml)
- New `faff next` subcommand: a PURE transition function. Inputs via flags
  (--status, --spec none|low|medium|high, --held, --parked, --blocked); output JSON {next,reason}.
  next ∈ none|done|skip-held|needs-human|blocked|prep|graft.
- Transition table (precedence): cancelled/duplicate→none; done→done; held→skip-held;
  parked→needs-human; spec none→prep; low/medium→needs-human; high+blocked→blocked;
  high (backlog/todo/in-progress/in-review)→graft. (blocked only gates graft, never prep.)
- `faff next --selftest` runs the table (17 cases incl. precedence) and exits non-zero on
  mismatch; wired into the FAFF-48 validate.yml CI gate.
- Pure: no tracker/MCP/ledger access — the caller passes state. Never executes the step or
  enforces the gate (FAFF-57). `faff state` (ledger read-model) deferred.

## DONE
- [x] faff next flags + {next,reason} JSON; table implemented exactly; precedence honoured.
- [x] Bad --status/--spec → loud error exit 2.
- [x] --selftest covers every row (17/17 PASS); wired into validate.yml.
- [x] USAGE + header updated; validate-adapters + config still pass.
- [x] Pure (no tracker/ledger). faff state deferred.
- [x] Diff limited to skills/faff/bin/faff + .github/workflows/validate.yml.
