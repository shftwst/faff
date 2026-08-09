# Harden merge-gate anchor-unreadable detection + remedy accuracy

> Spec: faffter-dark-nlspec · 2026-08-09 · autonomous · confidence: high. Full spec on Linear FAFF-747.

This spec addresses FAFF-747 for the build agent and human reviewers. It hardens two message-only accuracy items in the merge-gate's pure-remote anchor-level resolver (`resolveAnchorLevel` in `plugin/skills/faff/bin/lib/merge-gate.js`), surfaced by FAFF-690's pre-PR adversarial review. Neither item changes the fail-closed security outcome — both branches still refuse with exit 2 — they only make the *diagnostics* correct so an operator hitting a token-scope wall is pointed at the right fix.

## 1. WHY — Problem and Principles

**The load-bearing model.** When merge-gate reads the committed anchor ledger over the GitHub Contents API and the read fails, it must decide *why* it failed: a 403 (the token is too narrow to read the file — remediable by widening the token) versus a 404 (the file genuinely isn't there — remediable by re-anchoring). Today that decision is inferred from `gh`'s human-readable stderr text, which is not a reliable carrier of the HTTP status.

**Problem statement.** `resolveAnchorLevel`'s Contents-API fallback distinguishes `anchor-unreadable` from `anchor-missing` by regex-matching `gh` stderr plus a dead `api.status === 403` check (`api.status` is the `gh` *process* exit code — always 1 for any HTTP error, never an HTTP status). `gh` stderr wording drifts across versions, locales, and GitHub Enterprise, so the class — and therefore the remedy hint shown to the operator — can be misdetected. Separately, the `anchor-unreadable` remedy names only `contents:read` (the fine-grained-PAT / GitHub-App permission) and omits the classic-PAT `repo` scope, misdirecting a classic-PAT operator.

**Design principles.**

- **Fail-closed outcome is invariant.** Both classes already refuse (exit 2). This change may only alter which *status string and remedy* are reported; it must never turn a refuse into a pass, nor change the exit code on any path. An implementation that widens what merges is wrong by construction.
- **Discriminate on structured signal, not prose.** The class must be decided from the real HTTP status, not from stderr wording that is not part of any contract.
- **Unknown status fails safe to `anchor-missing`.** `anchor-unreadable` is the narrower, more specific claim (a token-scope problem); when the real status is anything other than a clear 403, the resolver falls back to the generic `anchor-missing`. Both refuse, so this never affects safety — it only avoids over-claiming a token-scope problem the operator may not have.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` — `resolveAnchorLevel` | Node (dependency-free) | The F1 resolver whose Contents-API fallback branch is edited |
| `plugin/skills/faff/bin/lib/merge-gate.js` — `anchorRefusal` | Node | Builds the status-keyed refusal message whose `anchor-unreadable` remedy string is corrected |
| `plugin/skills/faff/bin/lib/merge-gate.js` — `ghJson` | Node | Existing `gh` runner (`spawnSync`, JSON.parse of stdout); the new status probe reuses the same `spawnSync("gh", …)` idiom |
| `test/merge-gate-controlflow.test.mjs` | Node test (`node --test`) | Drives the real CLI with a stub `gh` on PATH; the new discrimination test extends its stub |

**Scope statement.** One resolver branch and one message string in the merge floor's pure-remote anchor read; nothing else in the merge-gate pipeline moves.

## 2. OUT OF SCOPE

- **The mainline `git show` anchor read.** — Why excluded: it reads the local git object store, never the forge, so it has no HTTP status and no token-scope failure mode. Extension point: the `r.ok` branch of `resolveAnchorLevel` (unchanged).
- **The `--local` path (`repo === null`).** — Why excluded: there is no forge to consult, so it already returns `anchor-missing` terminally with no API call. Extension point: the trailing `else` branch of `resolveAnchorLevel` (unchanged).
- **A full migration to GraphQL structured errors.** — Why excluded: the ticket offers it as an *alternative*; reading the HTTP status line is the smaller, lower-risk change that fully satisfies the accuracy requirement. Extension point: `resolveAnchorLevel` could later swap its transport, but not in this issue.
- **`anchor-malformed` classification.** — Why excluded: unaffected — malformed content is decided after a successful read, downstream of the failure branch this touches. Extension point: the post-parse `FLOOR_LEVELS` check (unchanged).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| anchor-unreadable | Status returned when the forge token exists but lacks scope to read the committed anchor ledger — HTTP 403. Distinct from -missing because the operator remedy differs. |
| anchor-missing | Status returned when the anchor ledger is genuinely absent (HTTP 404) or the status cannot be determined. The fail-safe class. |
| HTTP status line | The `HTTP/<ver> <code> <reason>` line `gh api -I`/`--include` prints as the first response-header line, on both success and error responses. |

**The status probe (behaviour, language-agnostic).** On the Contents-API error branch, before classifying, read the real HTTP status by issuing a headers-only request for the same resource and parsing the numeric status code out of the response's status line:

```
FUNCTION anchor_http_status(repo, anchorPath, headSha) -> integer | null:
  run: gh api -I "repos/<repo>/contents/<anchorPath>?ref=<headSha>"   # -I ⇒ response headers only
  # gh exits non-zero on an HTTP error but still writes the status line to stdout; capture stdout regardless of exit.
  match the FIRST line matching /^HTTP\/[\d.]+\s+(\d{3})\b/ (multiline) against the captured stdout
  RETURN the captured 3-digit code as an integer, or null if no status line is present
```

**Design decision — how to read the real HTTP status.**

- **Options:** (a) a second `gh api -I` (headers-only) probe on the already-failed branch; (b) change the primary read to `gh api --include` and parse headers + body from one call; (c) migrate to GraphQL structured errors.
- Option (b) forces the mainline success path to strip prepended headers before JSON-parsing the content body — invasive on the hot path for no safety gain. Option (c) is a transport rewrite well beyond a message-only fix.
- **Chosen:** Option (a) — issue a lightweight `gh api -I` probe **only inside the existing `!api.ok` failure branch**, leaving the mainline full-contents fetch and the `git show` path byte-for-byte unchanged. Minimal blast radius, and the extra call happens only on an already-failing (refuse-bound) path where latency is irrelevant.

**Design decision — status → class mapping.**

- **Chosen:** `403 → anchor-unreadable`; `404 → anchor-missing`; **any other code, or an unparseable/absent status line → `anchor-missing`** (fail-safe to the generic class). The stderr regex and the dead `api.status === 403` check are removed as the discriminator — the status code is now the sole signal. (An unrelated `gitRun`/`ghJson` failure still cannot reach here without first failing `api.ok`, so the probe runs only when a real HTTP error occurred.)

**Design decision — the `anchor-unreadable` remedy string.**

- **Chosen:** the remedy in `anchorRefusal` names **both** scope families: the classic-PAT `repo` (or `public_repo` for public repos) scope **and** the fine-grained-PAT / GitHub-App `contents:read` permission, alongside the existing "or invoke from a checkout with the head-sha object" escape. No other remedy branch changes.

## 4. HOW — Behavior

**Approach.** Replace the body of the `if (!api.ok)` branch in `resolveAnchorLevel` so that, instead of matching stderr, it calls the status probe and maps the code:

```
PROCEDURE on_contents_api_failure(repo, anchorPath, headSha):
  1. code := anchor_http_status(repo, anchorPath, headSha)
  2. IF code == 403:
       RETURN { level: null, status: "anchor-unreadable", source: "contents-api" }
  3. ELSE:                                  # 404, any other code, or null
       RETURN { level: null, status: "anchor-missing", source: null }
```

**Edge cases and error handling.**

- **Probe itself fails to emit a status line** (network error, `gh` missing, empty stdout) → `code` is null → `anchor-missing`. Fail-safe: both classes refuse; the resolver never passes.
- **A non-403 forbidden-shaped response** (e.g. a 401) → not 403 → `anchor-missing`. Acceptable: it still refuses; over-claiming `anchor-unreadable` for a non-403 is precisely the imprecision being removed.
- **`api.status === 403` dead check** → deleted; it could never be true (process exit code, not HTTP status).

**Failure modes.**

- **The failure:** some `gh` build or GitHub Enterprise variant prints no `HTTP/…` status line under `-I`. **How you'd know:** the discrimination test's 403 case would classify as `anchor-missing`. **What it means:** proceed — the outcome is still a correct refuse; only the (secondary) remedy hint degrades to the generic one, which is the safe direction.

**Anti-pattern:** re-introducing any stderr-text match as the discriminator. Why: stderr wording is not a contract and drifts across `gh` versions, locales, and GHE — the exact brittleness this issue removes.

**Anti-pattern:** switching the mainline success read to `--include` to save a call. Why: it complicates base64-content parsing on the hot path for a branch that only matters when the read has already failed.

## Scenarios

```
Given a pure-remote merge-gate invocation whose forge token lacks contents read scope
When the Contents-API anchor read returns HTTP 403 (even if gh stderr wording is unrecognised or misleading)
Then resolveAnchorLevel returns status "anchor-unreadable" and the caller refuses with exit 2
```

```
Given a pure-remote merge-gate invocation whose committed anchor ledger is absent
When the Contents-API anchor read returns HTTP 404
Then resolveAnchorLevel returns status "anchor-missing" and the caller refuses with exit 2
```

```
Given an anchor-unreadable refusal
When anchorRefusal builds the remedy message
Then the message names both the classic-PAT repo/public_repo scope and the fine-grained/App contents:read permission
```

## 5. DESIGN DECISION RATIONALE

**How should 403 vs 404 be discriminated?** Options: stderr regex (status quo), real HTTP status via `-I`, GraphQL errors. **Chosen:** real HTTP status via a headers-only `gh api -I` probe on the failure branch — structured, version-stable, minimal. Stderr regex rejected as brittle (the reported defect); GraphQL rejected as over-scoped for a message-only fix.

**Where should the probe live?** Options: replace the mainline read with `--include`; add a probe on the failure branch. **Chosen:** failure branch only — keeps the success path and `git show` path untouched, and the extra call lands only on a refuse-bound path.

**What does an indeterminate status map to?** Options: keep last-known, `anchor-unreadable`, `anchor-missing`. **Chosen:** `anchor-missing` — the generic fail-safe class; never over-claim a token-scope problem, and both classes refuse anyway.

**Which scopes does the remedy name?** **Chosen:** both classic-PAT `repo`/`public_repo` and fine-grained/App `contents:read`, so neither operator population is misdirected.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** `gh api -I` (or `--include`) prints the HTTP status line to stdout on both success and HTTP-error responses in the `gh` versions faff targets. Validation: the discrimination test drives the real code path through a stub `gh` that emits the status line, asserting the mapping; a real `gh` is not required in CI.

## 7. DONE — Definition of Done

### From WHY
- [ ] The fail-closed outcome is unchanged: both `anchor-unreadable` and `anchor-missing` still cause the caller to refuse with exit 2; no path newly passes.
- [ ] The mainline `git show` path and the `--local` (`repo === null`) path are byte-for-byte unchanged.

### From WHAT / HOW (behaviour)
- [ ] 403 vs 404 is discriminated by the real HTTP status code (read via `gh api -I`/`--include`), not by `gh` stderr text.
- [ ] The dead `api.status === 403` check and the stderr regex are removed as the discriminator.
- [ ] An indeterminate / unparseable / non-403 status maps to `anchor-missing`.
- [ ] The `anchor-unreadable` remedy string in `anchorRefusal` names both classic-PAT `repo` (or `public_repo`) and fine-grained/App `contents:read`.

### From tests
- [ ] A test asserts that a 403 response classifies as `anchor-unreadable` and a 404 as `anchor-missing`, driven by the HTTP status line — including a case where `gh` stderr wording is unrecognised or misleading, proving the discrimination is status-driven, not stderr-driven.
- [ ] A test asserts the `anchor-unreadable` remedy message contains both scope families.
- [ ] The existing merge-gate control-flow and money-fixture tests still pass.

**Integration smoke test:**

```
Run `node --test test/merge-gate-controlflow.test.mjs`:
  - the unreadable-mode fixture yields an anchor-unreadable refusal (exit 2) whose message names both scopes
  - the missing-mode fixture yields an anchor-missing refusal (exit 2)
```

confidence: high
spec-review: approve

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes — a single 1–3 hour unit: one resolver branch plus one message string in `resolveAnchorLevel`/`anchorRefusal`, with a focused test. Not splittable; the two items share the same failure branch and ship together.
- **Workstream fit?** Fits "T5 — proven in anger" — a real-use hardening of the merge floor surfaced by FAFF-690's adversarial review.
- **Deps surfaced?** No implicit deps. Relates to FAFF-690 (Done), which built the resolver being hardened; no blocker edge needed.
- **Risk profile?** Low — message-only on a fail-closed path; no external-dep or novel-integration risk. No de-risking spike warranted.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
