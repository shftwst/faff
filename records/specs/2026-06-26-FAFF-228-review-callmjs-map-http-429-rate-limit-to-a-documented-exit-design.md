# FAFF-228 — review-call.mjs: 429 rate-limits ride the transient-transport retry path (+ correct the timeout-bound doc)

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · confidence: high. Full spec on Linear FAFF-228.

This spec is for the build agent and for human reviewers. It extends the FAFF-227 transient-transport retry in the adversarial-review backend helper `review-call.mjs` to cover HTTP **429 rate-limits**, so a persistent 429 lands on a documented exit instead of the catch-all `EXIT.OTHER` (1) an autonomous orchestrator can't interpret — and corrects a docstring that overstates the `--timeout` bound.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-227 built one mechanism for transient streaming faults: a predicate `isTransientTransport(err)` decides *retry vs terminal*, a bounded `streamWithTransportRetry` loop retries the transient ones, and an exhausted retry surfaces `status: "transport-failed"` which `main()` maps through `unreachableExit({hostSource})` to a documented exit (5 pass+skip / 6 needs-human). That mechanism already exists and already routes correctly. The **only** gap is the predicate's input set: it classifies HTTP **5xx** as transient but treats every **4xx — including 429** — as terminal. A 429 is not a request fault; it is a rate-limit, i.e. *transient infra*, exactly the class the loop was built for. So the fix is to move 429 from the terminal set into the transient set; no new exit code, no new retry machinery.

**Problem statement.** Status quo: a persistent HTTP 429 is classified terminal, rethrows past the retry loop to the top-level `.catch`, and exits `EXIT.OTHER` (1) — unmapped, uninterpretable to an unattended run. Pain: it bit the 2026-06-23 re-review twice (FAFF-36's Phase-2 couldn't run under a sustained ~30-min 429 → exit 1; FAFF-201 fell back to another model on a per-model 429 quota). This change makes 429 a retried transient fault that, if persistent, lands on the same documented exit 5/6 as a down provider.

**Design principles.**

- **No uninterpretable exit on infra (inherited from FAFF-227).** After this change, `EXIT.OTHER` (1) stays reserved for genuine programmer error; *no* transport/infra condition — now including a rate-limit — may end there. Every exit the helper returns must be in the SKILL.md exit→verdict table.
- **Reuse the shipped mechanism; do not build a 429-specific subsystem.** A rate-limit is a transient transport fault — it belongs in the existing predicate + loop, not in a parallel retry path. Prefer the proportionate, minimal change (faff governing principle: proportionate designs).
- **Retry transient, never terminal.** The predicate stays default-terminal: it must flip *only* 429 to transient, leaving 401/403 (auth), other 4xx, usage, and model-not-served terminal. Over-broadening to "any 4xx" would retry real request faults and waste budget.

**Scope statement.** A one-line classification change in `review-call.mjs`, its mirrored unit-test expectation, plus two documentation corrections (SKILL.md exit-table transient-class list + the `--timeout` bound wording) — all inside the adversarial-review backend, no caller affected.

## 2. OUT OF SCOPE

- **Honouring the `Retry-After` header on a 429.** Excluded — the transport rejects surface only the status line, not response headers. Punted (non-blocking).
- **A dedicated transient-transport exit code (e.g. 8).** Excluded — reuse the unreachable path (5/6).
- **Other 4xx classes (401/403/404/400).** Excluded and must stay terminal.
- **A general retry framework / other providers' quirks.** Excluded.
- **An overall wall-clock deadline across all attempts.** Not chosen — the timeout fix here is a doc correction.

## 3. WHAT — predicate change

`isTransientTransport(err)` gains a 429 arm; everything else unchanged. TRUE for `/HTTP 5\d\d/`, dropped socket (`ECONNRESET`/`ETIMEDOUT`/`EPIPE`/"socket hang up"), `timed out`, **and now `/HTTP 429/`**. FALSE otherwise (4xx≠429, auth, usage, model-not-served, unknown).

**Decisions:** classify 429 as transient (rides existing retry → exit 5/6); reuse `TRANSPORT_RETRY` unchanged (no 429-specific policy); punt `Retry-After`; correct the `--timeout` doc rather than add an overall deadline.

## 4. HOW — Behaviour

One classification edit, two doc edits, one test edit. Add `/HTTP 429/` to `isTransientTransport`. No `main()`/`runReview*`/`TRANSPORT_RETRY` changes — 429 inherits the whole path.

- Persistent 429, `--host-source config` → exit 5 (pass+skip); `--host-source default` → exit 6 (needs-human). Never exit 1.
- Transient 429 that clears on retry → status "ok", findings returned.

**Anti-pattern:** broadening to `/HTTP 4\d\d/`. Only 429 among 4xx flips transient.

## 5. SCENARIOS

- 429 once then findings → status "ok" (ollama + openai).
- Persistent 429, `--host-source config` → EXIT.UNREACHABLE (5), never EXIT.OTHER.
- Persistent 429, `--host-source default` → EXIT.DEFAULT_HOST_UNREACHABLE (6), never EXIT.OTHER.
- HTTP 401/404/400 → isTransientTransport false (terminal).

## 8. DONE

- Persistent 429 never exits 1; exits 5/6 like a 5xx.
- Only 429 added to transient set; 401/403/404/400 stay terminal.
- No new exit code / retry subsystem.
- `isTransientTransport(new Error("HTTP 429"))` true; `"HTTP 429: rate limited"` true.
- streamFn throwing 429 once then success → status "ok" (both paths).
- streamFn always 429 → transport-failed; main() → 5 (config) / 6 (default).
- test/adversarial-call.test.mjs: "HTTP 429" moved from the terminal/false list into the transient/true list.
- SKILL.md exit-table lists 429 among the retried transient classes; "no transport/infra exits 1" still holds.
- "capped by `--timeout`" wording corrected (review-call.mjs + SKILL.md): `--timeout` bounds each stream attempt and the inter-retry sleeps; worst-case total wall-clock ~6× `timeoutMs` under stream + truncation + transport-retry composition.

## 7. OPEN QUESTIONS

- **Punt:** honour `429 Retry-After`. Non-blocking — blind backoff is correct today.

confidence: high
