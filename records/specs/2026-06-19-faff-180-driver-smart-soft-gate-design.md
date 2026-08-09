# Judgement-eval gate: selectable drivers (smart · local · frontier)

> Spec: faffter-dark-nlspec · 2026-06-19 · autonomous · confidence: high. Full spec on Linear FAFF-180.

Build spec for **FAFF-180**. Makes the judgement-eval gate proportionate and safe to run anywhere by making the **driver** a first-class selectable knob: cheap **soft local**, multi-hour **frontier** hard gate, and a **smart** router — all explicitly addressable, `smart` the default.

## WHY
The full frontier reverify is ~780–1,950 `claude -p` runs (multi-hour) — disproportionate for a small prose diff, so it gets waived (PR #118). Fix: a proportionate gate without losing the heavy one.

**Principles.** (1) Every mode stays, explicitly selectable. (2) Soft local / hard frontier — hardness attaches to the driver. (3) No death loop — driver resolved once; unavailable local = soft-skip, never re-resolve/retry. (4) No silent frontier cost in CI — smart *recommends* frontier, never auto-runs it.

## WHAT — `--driver smart | local | frontier` (default `smart`)
- **`local`** — scoped kinds × low reps, ollama. **Soft/advisory: always exits 0.** Unavailable → skip-soft exit 0. Regression → warn (drift), exit 0.
- **`frontier`** — full sweep, `claude -p`. **Hard:** exits nonzero on regression. The real gate.
- **`smart`** (default) — routes via diff-surface heuristic + local preflight: prose/small → local soft; substantive → local soft + "frontier recommended" notice (never auto-runs frontier). Inherits the hardness of what it ran.

## HOW
- Extend `resolveDriver` to accept `smart` (default). Add a gate dispatcher: `frontier` → existing hard `gateAgainst`; `local`/`smart` → `softLocalGate`.
- `softLocalGate(argv)`: cheap `preflightLocal()` (reachability probe, one shot). Unavailable (unconfigured or unreachable) → log "skipped: local model unavailable", exit 0 — no retry, no re-route, no frontier fallback. Reachable → run scoped local eval, diff vs baseline, print advisory drift report, **exit 0 always**.
- `smart` heuristic over the diff surface (file list): prose-only/small/no contract+CLI+grader → local; else substantive → local soft + recommend frontier. Never auto-runs frontier.
- Driver resolved **once** (idempotent); the loop is structurally impossible.

## DONE
- [ ] `--driver smart|local|frontier`, default `smart`; `local`/`frontier` keep existing semantics, `smart` added.
- [ ] `local`/`smart`→local always exit 0 (advisory, never blocks); `frontier` is the only nonzero-on-regression path.
- [ ] `smart` routes via heuristic + preflight; substantive → recommends frontier, never auto-runs.
- [ ] Cheap preflight; unavailable → soft-skip exit 0; resolved once, no retry/re-route loop, no silent frontier fallback (test asserts single-shot).
- [ ] Advisory diff-surface heuristic; documented waive-with-rationale.
- [ ] Smoke case-set scoped + verified vs grader KINDS.
- [ ] eval README documents the three drivers + the soft/anti-loop/no-CI-frontier guarantees.

## ASSUMPTIONS
- FAFF-129 (local fidelity) / FAFF-183 (full preflight hardening) are enhancements, not blockers — the soft gate degrades gracefully without them. Validates by passing scenarios with the local model deliberately unavailable.
