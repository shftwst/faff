# FAFF-183 — Harden faffter-dark-adversarial-review for real LLM backends

> Spec: faffter-dark-nlspec · 2026-06-19 · autonomous · confidence: high. Full spec on Linear FAFF-183.

Make the adversarial review's backend call deterministic and robust via a bundled helper, instead of agent-hand-rolled prose that breaks on real ollama backends.

## Why

A live run (FAFF-181 retro) hit five failures, each worked around by hand: (1) no model **preflight** → a name typo silently degrades to `pass`; (2) **thinking models** return empty `content`; (3) long single responses **drop the connection**; (4) no **token budget**/truncation handling; (5) **diff-only context** makes the reviewer hallucinate "this heading doesn't exist." Per *deterministic-tools-over-prose*, the fix is a **bundled helper script**, not more prose.

## What

`plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (dependency-free node), with pure helpers (`buildChatPayload`/`modelServed`/`accumulateNdjson`/`assembleUserMessage`) + injectable transport (getFn/streamFn) so CI makes zero live calls.

- **Preflight** `/api/tags`: model-not-served → exit 4 (→ `needs-human`); host unreachable → exit 5 (→ `pass`+skip).
- **think:false**, **stream:true** (NDJSON accumulation), `num_predict` default 2000 + one truncation retry at 2×.
- **`--context`** = the gateway + touched files (folded into the user message), so the reviewer verifies existence/structure instead of hallucinating from a diff-only view.

**Decisions:** bundled helper (not prose); preflight fail-loud (`needs-human`, never silent pass) for model-not-served; gateway+touched-files as context; output names `provider/model`.

## Out of scope

- New `.faffrc` keys (runtime, not config). Non-ollama provider deep hardening. FAFF-182/184/185.

## DONE

- [x] `review-call.mjs`: preflight (exit 4/5), think:false, streaming, num_predict+truncation retry, `--context` folding.
- [x] Skill prose invokes the helper; exit 4→needs-human, 5/timeout→pass+skip; passes gateway+touched files; output names `provider/model`.
- [x] No new `.faffrc` keys; `validate-adapters` clean.
- [x] Tests (pure + mocked-transport, no live model); `node --test` green.

confidence: high
