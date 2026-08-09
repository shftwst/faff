# Spec — FAFF-715: widen the scaffolder-spawn timeout so the re-scaffold leak test stops flaking under load

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-715.

## 1. WHY — problem and principle

`test/scaffolder-lights-out-dials.test.mjs:165` (`re-scaffold over a stale .git … does NOT leak it into the new commit`) runs the **real** scaffolder via `spawnSync("bash", [scriptPath], { timeout: 30_000 })`. Measured on an **idle** box, the **first** of its three parameterised runs takes **~22.4s** (cold git/filesystem); the next two ~3s. Under the concurrent full `node --test` suite on a contended `validate` runner, that cold first spawn exceeds the 30s ceiling → `result.status` comes back null (spawn timeout) → `assert.equal(result.status, 0)` fails spuriously (`not ok 2317`), always green on re-run. This is the FAFF-635 class: a real-process integration test whose fixed deadline is too tight for a loaded runner, not a logic bug. FAFF-524 already hardened this test's git-identity + `PATH`, so the timeout ceiling is the sole remaining flake vector.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: raise the `spawnSync` timeout from `30_000` to `120_000` ms.** A cold first run is ~22s idle; under N-way concurrent CI load that can plausibly reach 2–3×, so a 120s ceiling (~5–6× the observed cold worst case) is the FAFF-635 sizing rationale — generous on a healthy run (a fast run returns immediately and spends none of it), tight enough that a **genuinely hung** scaffolder still trips it. Name the constant with a comment citing the observed cold-start cost + concurrent-load reason so a future reader does not "tighten" it back.

**Chosen: keep the `assert.equal(result.status, 0, …)` assertion exactly as is.** The widened window is the *only* change — a real hang (or a non-zero scaffolder exit) still fails the test. This is what keeps the fix from being a mask: it does not retry, does not quarantine, does not weaken any leak assertion (`ls-files` / `ls-tree HEAD` still assert the secret never leaks). A slower-tolerant test, never a blind one.

**Chosen: no whole-check quarantine, no `flaky-register` entry, no unconditional retry.** The register keys on the *check* name (`validate`), which would mask genuine failures across the whole suite; the fix belongs in the test at subtest granularity, which this is.

**Assumes:** the 30s ceiling is the live flake cause (confirmed by the 22.4s cold measurement against a 30s cap); the three parameterised runs share the same spawn call (they do — one `spawnSync` inside the `for (name of ELIGIBLE)` body), so the single constant covers all three. Scope is this one `spawnSync` call — no other timeout in the file is touched.

## 3. HOW — acceptance

- `test/scaffolder-lights-out-dials.test.mjs` — the re-scaffold integration test's `spawnSync("bash", …)` `timeout` raised `30_000 → 120_000`, with an explanatory comment (observed cold-start ~22s + concurrent-load headroom, FAFF-635 sizing).
- The `assert.equal(result.status, 0, …)` and both leak assertions (`ls-files`, `ls-tree HEAD`) are unchanged.
- No `operations/ci/flaky-register.json` entry; no retry; no whole-check quarantine.
- `node --test test/scaffolder-lights-out-dials.test.mjs` green; the full `node --test` suite green.

### Scenarios

```
Given the re-scaffold integration test runs as part of the concurrent full suite on a contended runner
When the first (cold) scaffolder spawn takes ~40–60s
Then it completes within the 120s ceiling and the test passes — no spurious spawn-timeout failure.
```

```
Given a genuinely hung or broken scaffolder (never returns / non-zero exit)
When the test runs
Then it still fails (the 120s ceiling trips, or result.status ≠ 0) — the fix widens tolerance, it does not mask a real break.
```

## 4. DONE — definition of done

- [ ] `spawnSync` timeout raised `30_000 → 120_000` in the re-scaffold integration test, with a rationale comment.
- [ ] `result.status === 0` + both leak assertions unchanged (no mask).
- [ ] No flaky-register entry / retry / whole-check quarantine.
- [ ] `node --test` (targeted file + full suite) green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
