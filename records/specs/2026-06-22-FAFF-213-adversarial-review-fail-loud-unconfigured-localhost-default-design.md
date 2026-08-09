# FAFF-213 — Fail loud when the adversarial-review host is the unconfigured localhost default

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high. Full spec on Linear FAFF-213.

## Why

`review-call.mjs` maps **exit 5 (provider unreachable) → `pass` + skip** at `faffter-dark-adversarial-review/SKILL.md:147` ("don't block the pipeline on a genuine infra outage"). But "unreachable" conflates two opposite causes:

1. A **genuinely-configured** host that's temporarily down (the Tailscale box asleep) → `pass+skip` is correct.
2. A host that is only `http://localhost:11434` **because nothing was configured** — the `review` slot is `faffter-dark-adversarial-review` but `faffter_dark.adversarial.host` is unset, so SKILL.md prose substitutes the documented localhost default (`SKILL.md:110`, `:119`, `:128`) → refused → exit 5 → **silent pass**. The adversarial review was never wired up, yet the gate reports "pass."

Case 2 is the same failure class FAFF-183 already closed for **exit 4** (model-not-served → `needs-human`: *"a misconfigured model must not invisibly disable the review"*, `review-call.mjs:18-20`, `SKILL.md:146`). FAFF-183 hardened against a **misconfigured model**; this extends the identical principle from the model to the **provider config**: an *absent* provider block must not invisibly disable the review either. It currently slips through the exit-5 door.

This is defense-in-depth, **not** a live bug today — the repo's provider IS configured (`faff config get faffter_dark.adversarial.host` → `http://studio.longhair-escalator.ts.net:11434`). It protects a new adopter who sets the `review` slot but forgets the provider block.

## What

Two coordinated halves — the tested tool gains a host-provenance signal and a new exit code; the skill prose stops silently defaulting and maps the new code to `needs-human`.

### Decision 1 — `review-call.mjs` learns whether the host was the unconfigured default

`localhost:11434` is a **legitimate** explicitly-configured host (a local ollama box), so `review-call` cannot infer provenance from the host string alone — the caller must signal it. Add a provenance flag to `parseArgs` and thread it through `main`.

**Chosen:** add `--host-source config|default` (default `config` when the flag is omitted, so existing callers are unchanged). `config` = the host came from an explicit `faffter_dark.adversarial.host`; `default` = the skill fell back to the documented `http://localhost:11434` because the key was unset.

### Decision 2 — a new distinct exit code `6` for "default-host unreachable"

Extend `EXIT` with **`DEFAULT_HOST_UNREACHABLE: 6`**. A new exit code, not a reuse of 4 or 5. Reusing 5 is the bug being fixed; reusing 4 (model-not-served) would be a category error.

| exit | meaning | host-source | outcome |
|---|---|---|---|
| `5` | provider unreachable | `config` (explicit, incl. an explicit localhost) | `pass` + skip — the human's call (unchanged) |
| `6` | provider unreachable | `default` (localhost fallback, nothing configured) | **`needs-human`** — adversarial review configured but no provider set |

An explicitly-configured **localhost** that's down stays `pass+skip` — explicit config is the human's call.

### Decision 3 — the unreachable→exit mapping stays a pure, injectable function

**Chosen:** add a pure exported function `unreachableExit({ hostSource })` returning `EXIT.DEFAULT_HOST_UNREACHABLE` when `hostSource === "default"` else `EXIT.UNREACHABLE`. `runReview` is **unchanged** — it still returns `{ status: "unreachable" }`; the host-source→exit decision lives in `main`.

### Decision 4 — the skill stops silently defaulting; prose maps exit 6 → needs-human

**Chosen:** resolve host provenance from the `faff config get` exit status — `faff config get faffter_dark.adversarial.host` returns non-zero (exit 3) when the key is unset. When unset, the skill passes `--host-source default`; when the key resolves, `--host-source config`. Update the **Exit code → Phase-2 outcome** table to add the exit-6 row → `needs-human`.

### Decision 5 — unit-test coverage in test/adversarial-call.test.mjs

**Chosen:** add node:test assertions for the new pure function and the new `--host-source` parsing — same file, same pure-function style, zero live calls.

## Acceptance criteria

1. `review-call.mjs` exports `EXIT.DEFAULT_HOST_UNREACHABLE === 6`, distinct from `EXIT.NOT_SERVED` (4) and `EXIT.UNREACHABLE` (5).
2. `parseArgs(["--host-source","default"])` yields `hostSource: "default"`; omitting the flag yields `hostSource: "config"` (existing callers unaffected).
3. A pure exported function maps an unreachable result to exit `6` when host-source is `default` and exit `5` when `config` — with no I/O, injectable/testable in the existing style (no live model call).
4. On `runReview` returning `{status:"unreachable"}`, `main` returns exit `6` iff `--host-source default` was passed, else exit `5`; stderr distinguishes the two cases.
5. `faffter-dark-adversarial-review/SKILL.md`'s **Exit code → Phase-2 outcome** table includes an exit-`6` row mapping to `needs-human` ("adversarial review configured but no provider set"); the exit-`5` row remains `pass`+skip and explicitly covers an explicitly-configured localhost that's down.
6. `SKILL.md` host-resolution prose: when `faff config get faffter_dark.adversarial.host` exits non-zero (unset), the skill passes `--host-source default`; when it resolves, `--host-source config`. The skill no longer silently treats an unconfigured-localhost outage as `pass`.
7. `test/adversarial-call.test.mjs` covers AC 1-3 (exit-code distinctness, `--host-source` parse + default, pure unreachable→exit mapping). All existing tests still pass.
8. `node --test test/adversarial-call.test.mjs` is green; no test makes a live model call.

confidence: high
