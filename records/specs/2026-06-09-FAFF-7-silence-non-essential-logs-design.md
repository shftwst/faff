# FAFF-7 — Config knob to silence non-essential faff logs

> Spec: faffter-dark-nlspec · 2026-06-09 · interactive · adaptor: faffidavit-spec · confidence: high. (Punt resolved interactively 2026-06-09.)

## WHY
Every faff sub-skill invocation writes a prose narrative log to `.faff/logs/YYYY-MM-DD/HHMMSS-<skill>.md` (writers: jot, prep, graft, map, wtf, tidy) — real output-token spend on a long unattended run, with no off switch. Boundary correction: a subset of `logs/` IS machine-consumed within a pass, so "all narrative logs are audit-only" is not literally true; the silence boundary is drawn precisely.

## WHAT
A single top-level `.faffrc.yaml` key, read via the existing `faff config` resolver, that stops generation of the per-invocation narrative log while a hard floor of machine-consumed artifacts is always written. Default preserves today's behaviour.

- **Chosen:** knob = binary `logging: full | essential` (top-level scalar). Slots into the resolver with zero parser work (`faff config get logging -d full`).
- **Chosen:** `essential` writes nothing for the narrative (not even a breadcrumb).
- **Chosen:** does NOT touch beep-boop's `summary.md` (per-run, not per-invocation) — stays on the floor.
- **Chosen — hard-floor always-write list (silencing NEVER suppresses):** `run-ledger.json`; `automation-verdicts.md` + standalone `HHMMSS-tidy-verdicts.md`; `calibration/*`; `slot-validation.md`; per-issue `runs/<id>/ISSUE-XX/graft.md`·`prep.md`·`conflict-analysis.md`·`discovered-scope.json`; `summary.md`; and `HHMMSS-tidy.md` (load-bearing within a pass — wtf/map read its backlog-diagnostics block same-pass).
- **Chosen — silenced set = the per-invocation narrative `HHMMSS-<skill>.md` for `<skill>` ∈ {jot, prep, graft, map, wtf}** — every narrative writer EXCEPT tidy's `HHMMSS-tidy.md`.
- **Chosen — standalone-tidy `HHMMSS-tidy.md` stays on the floor unconditionally** (resolved 2026-06-09): even when tidy runs alone with no consumer that pass. One simple invariant, audit-safe.
- **Chosen:** mode-aware floor — `runs/<id>/…` resume artifacts always written (live under `runs/`, not `logs/`); the knob only gates the `logs/`-tree narrative file.
- **Chosen:** "silence" = don't-generate (no Write call), not generate-then-discard.

## HOW
1. **Schema + resolver — no parser change.** Add `logging: full | essential` (default `full`) to the gateway schema block + `.faffrc.example.yaml`. CLI already resolves arbitrary top-level scalars via `faff config get logging -d full` (verified: unset → default, exit 3). No `bin/faff` change. Reads stay CLI-only (FAFF-50).
2. **Gateway logging rule = the single gate.** In `skills/faff/SKILL.md` §`.faff/ logging directory`, add: before writing the per-invocation narrative log, resolve `faff config get logging -d full`; when `essential`, skip that Write entirely. The gate applies ONLY to the narrative `logs/` file; everything under `runs/`, `calibration/`, the verdict caches, and `HHMMSS-tidy.md` is the unconditional hard floor. List the floor explicitly.
3. **Per-skill log-write steps reference the gate** — jot, prep, graft, map, wtf gain a "subject to the gateway logging gate" clause; `faff-tidy`'s `HHMMSS-tidy.md` write does NOT (floor).
4. **Autonomous wording** — gateway §Autonomous Mode Contract: the narrative `logs/` file obeys the gate; resume-critical `runs/` artifacts are written regardless.

**Assumes:** the resolver's top-level-scalar path is the intended extension point; no known-key allowlist gates `faff config get` (verified). Suite-wide single global key (per-skill granularity out of scope).

## DONE
- [ ] `logging: full | essential` documented in the gateway schema + `.faffrc.example.yaml`; default `full`.
- [ ] `faff config get logging -d full` returns `essential` when set, `full` (exit 3) when absent — no parser change.
- [ ] Gateway §logging carries the gate rule + explicit hard-floor list, naming `HHMMSS-tidy.md` as floor.
- [ ] jot/prep/graft/map/wtf narrative-write steps reference the gate; tidy's does not.
- [ ] essential: an invocation produces NO `HHMMSS-<skill>.md` for jot/prep/graft/map/wtf.
- [ ] floor preserved under essential: run-ledger, verdict caches, calibration/*, slot-validation.md, summary.md, per-issue runs/… artifacts, and HHMMSS-tidy.md (incl. standalone) still written.
- [ ] default unchanged: `logging` unset/`full` → every narrative log written as today.
- [ ] CLI-only resolution (passes the `validate-adapters` lint).
