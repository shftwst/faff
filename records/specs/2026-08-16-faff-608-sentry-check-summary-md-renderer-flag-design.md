# Spec — `faff sentry check --summary-md FILE` renderer flag + adopter CI note

_Attached by faff-prep (autonomous, run `run-20260816-204351-beepboop-list-7978f2`). Reduced breadcrumb scope per the 2026-08-16 rescope. Confidence: high · spec-review: approve._

---

# FAFF-608 — `faff sentry check --summary-md FILE` renderer flag + adopter CI note

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-608.

This spec covers the reduced breadcrumb scope of FAFF-608 (rescoped by a human on 2026-08-16). The audience is the build agent and human reviewers. It adds one renderer flag to an existing CLI verb and one paragraph of adopter documentation. The original CI-workflow watchdog build is retired and out of scope — see OUT OF SCOPE and the 2026-08-13 / 2026-08-16 tracker comments.

## 1. WHY — Problem and Principles

**The load-bearing model:** the sentry verdict already exists as a machine object (`faff sentry check --json`); what is missing is a human-legible markdown rendering of it that a CI job (or any watchdog) can drop into a job summary. The verb should own that rendering, exactly as `faff governance-check` already owns its own `--summary-md` rendering — so a local terminal readout and a CI summary never drift.

**Problem statement:** an adopter who wants to surface the sentry's derailment verdict over their own CI today has only `--json` (machine-shaped) or the default text output (not a stable artifact contract). There is no verb-owned markdown renderer, so any CI integration would re-implement the rendering in shell and drift from the source of truth. This change adds a `--summary-md FILE` flag that renders the same verdict as markdown, and a docs paragraph telling adopters how to wire it.

**Design principles:**

- **The verb owns rendering.** The markdown is produced by `faff sentry check` itself, not by a caller's shell — the same rule `governance-check --summary-md` already embodies, so local and CI output are byte-identical.
- **Never perturb the exit contract.** The summary write is a pure side-artifact. A write failure, or the flag's mere presence, must never change `sentry check`'s exit code or its verdict — mirroring `governance-check`, where the summary append is wrapped in try/catch and only warns on stderr.
- **Reuse the shipped remedy wording.** The tripped-verdict remedy commands the summary names are taken verbatim from `sentrycheck.js`'s `trippedNotice` (Inspect / abort-resumably), so the CLI has one home for that wording, not two that can drift.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governance-check.js` (`renderGovernanceCheckSummaryMd`, `--summary-md` handling ~L550, L631, L696) | JavaScript (Node) | The exact pattern to mirror: pure render function + arity-1 flag + try/catch appendFileSync warning |
| `plugin/skills/faff/bin/lib/sentry.js` (`cmdSentry` check branch, payload built ~L996) | JavaScript (Node) | Where the new flag and render call are added; the `payload` object is the render input |
| `plugin/skills/faff/bin/lib/sentrycheck.js` (`trippedNotice`, L110–117) | JavaScript (Node) | Source of the remedy-command wording the tripped summary names |
| `docs/guide/unattended.md` (`## An L3 watcher in CI`, L119–135) | Markdown | Home for the one-paragraph adopter note |
| `docs/guide/cli.md` (the `sentry <check\|abort>` row, L113) | Markdown | Flag grammar updated to include `[--summary-md FILE]` on `check` |

**Scope statement:** this is a small addition to the supervisory CLI surface (`faff sentry check`) plus an adopter-facing docs note; it changes no detection math and no scheduling topology.

## 2. OUT OF SCOPE

- **The CI-workflow watchdog build (retired).** — A bespoke sibling workflow job / `schedule:` topology reading the heartbeat artifact. **Why excluded:** the watchdog capability already ships via the detached `sentry-poller`, and how a watchdog is scheduled over the heartbeat is an adopter/deployment concern, not a framework feature (2026-08-13 design review; 2026-08-16 rescope). **Extension point:** an adopter wires their own watchdog per the docs note added here, calling `faff sentry check --json`/`--summary-md` on their own substrate.
- **ADR-0065 changes.** — No amendment/supersede of the advisory-watchdog ADR. **Why excluded:** the reduced scope introduces no new CI locus or acting authority. **Extension point:** n/a — the four prior park questions are moot at this scope.
- **Andon wiring for this flag.** — The summary renderer does not page andon. **Why excluded:** andon paging is already owned by `sentrycheck.js`/`sentry-poller.js` on the acting predicate; a renderer is surfacing-only. **Extension point:** FAFF-472 tracks andon for the tripped verdict.
- **Indeterminate (exit 3) markdown.** — The fail-closed indeterminate path is not rendered to the summary file. **Why excluded:** see the HOW decision below — the indeterminate path returns before a verdict payload exists and stays stderr-only, consistent with `governance-check` writing a summary only where a verdict was computed. **Extension point:** `sentryIndeterminate()` in `sentry.js` if a future ticket wants an indeterminate summary block.

## 3. WHAT — Types and Interfaces

**The flag.** A new arity-1 (file-path) flag on the existing `SENTRY_SPEC`:

```
FLAG --summary-md FILE
  arity: 1                       # a filesystem path
  applies to: sentry check       # (abort ignores it — check is the verdict-producing sub-verb)
  absent  => unchanged behaviour (no summary written)
  present => after the verdict payload is built, append rendered markdown to FILE
```

**The render function.** A pure function mirroring `renderGovernanceCheckSummaryMd`, taking the already-built `check` payload and returning a markdown string:

```
FUNCTION renderSentryCheckSummaryMd(payload) -> string
  # payload is the exact object cmdSentry builds for `check`:
  #   { run_dir, verdicts:[{signal, severity}], intervention, tripped,
  #     thresholds, authority, detection_trust, config_malformed }
  # returns markdown ending in a single trailing newline (governance-check parity)
```

Rendered content (proportionate — a heading, a verdict line, an optional verdicts table, optional remedy lines):

```
# faff sentry check

**run:** <payload.run_dir or "(no run resolved)">
**verdict:** <one of>
    ✅ no derailment — intervention: continue          # verdicts empty
    ⚠️ <N> verdict(s) — intervention: <intervention>   # verdicts present, not tripped
    ❌ TRIP — intervention: <intervention>              # tripped === true

# when payload.config_malformed:
> ⚠️ base config malformed — thresholds are built-in defaults (config_malformed)

# when verdicts non-empty, a table:
| signal | severity |
|---|---|
| <v.signal> | <v.severity> |   # one row per verdict

# when payload.tripped, remedy lines (wording verbatim from trippedNotice):
**Nothing was acted on.** Inspect: `faff sentry check --run-dir <run_dir>`;
abort resumably: `faff sentry abort --run-dir <run_dir> --worktree <path>`
```

## 4. HOW — Behavior

**Architecture.** Three touch points in `sentry.js` plus two docs edits. The render function is a top-level pure function (placed near `sentryIndeterminate`, as `renderGovernanceCheckSummaryMd` sits near its callers). The flag is declared once in `SENTRY_SPEC.flags`. The write happens in the `check` branch of `cmdSentry`, immediately after the `payload` object is constructed (sentry.js ~L996), guarded exactly as governance-check guards its own write.

```
PROCEDURE cmdSentry check-branch (added steps, after `payload` is built ~L996):
  1. (existing) build `payload`
  2. IF values["--summary-md"] is set:
     a. TRY: fs.appendFileSync(summaryMdPath, renderSentryCheckSummaryMd(payload))
     b. CATCH e: process.stderr.write(
          "faff sentry check: warning — could not write --summary-md: " + e.message + "\n")
        # never re-thrown; never changes exit code
  3. (existing) IF asJson: print JSON; ELSE print the text summary
  4. (existing) return 0
```

**Ordering — the write composes with `--json`, it is not gated by it.** The summary append runs whether or not `--json` was passed, mirroring `governance-check` (which appends independently of its own `--json`). So `--json` and `--summary-md FILE` together emit machine JSON to stdout AND the markdown artifact to FILE in one call.

**Placement relative to the indeterminate path.** The exit-3 indeterminate reply (`sentryIndeterminate`, called at sentry.js L914 / L937) returns **before** step 1 above — there is no verdict `payload` at that point. The summary write therefore never fires on the indeterminate path, which stays stderr-only (non-`--json`) or JSON-only (`--json`), unchanged.

**Failure modes:**

- **The failure:** the summary render drifts from the source-of-truth remedy wording, so a CI reader sees stale/incorrect remedy commands. **How you'd know:** the selftest render-fixture assertion (added — see DONE) would fail if the remedy string stops matching `trippedNotice`'s shape. **What it means:** proceed — the shared-wording principle plus the selftest fixture guard this.
- **The failure:** an unwritable `--summary-md` path silently aborts the whole verdict. **How you'd know:** a caller sees a non-zero exit or no stdout verdict on a bad path. **What it means:** abandon that approach — the try/catch (step 2b) is exactly what prevents it; the write is best-effort by construction.

**Anti-pattern:** rendering the markdown in the caller's shell (awk/echo over `--json`). Why: it re-implements the rendering outside the verb and drifts from `trippedNotice`; the whole point of `--summary-md` is that the verb owns rendering.

## 5. SCENARIOS

```
Given a resolvable run whose sentry verdict is tripped (intervention: abort)
When `faff sentry check --run-dir <dir> --summary-md OUT.md` runs
Then OUT.md MUST contain the "❌ TRIP" verdict line, a verdicts table naming the tripped signal(s),
     and the remedy commands `faff sentry check --run-dir <dir>` and `faff sentry abort --run-dir <dir> --worktree <path>`
     (wording matching sentrycheck.js trippedNotice), AND the command's exit code MUST be 0 (report-only, unchanged)
```

```
Given a `--summary-md` path that cannot be written (e.g. a non-existent parent directory)
When `faff sentry check --summary-md /no/such/dir/OUT.md` runs on any resolvable run
Then the command MUST still emit its normal verdict (stdout text or JSON) and exit with its normal code,
     writing only a non-blocking stderr warning about the failed summary write
```

- The `--summary-md` markdown for a given verdict is byte-identical to what the same verdict renders locally vs in CI (the verb-owns-rendering invariant, asserted by the render function being the single source).

## 6. DESIGN DECISION RATIONALE

**Render only on the exit-0 verdict path; leave the indeterminate exit-3 path stderr/JSON-only.**
Options: (a) render a summary for every terminal state including indeterminate; (b) render only where a verdict payload exists. The indeterminate path returns early (before the payload is built) and is a deliberate fail-closed "could not characterize" state; `governance-check --summary-md` likewise writes only where its verdict object exists. **Chosen:** (b) — render only on the exit-0 verdict path. Rationale: matches the governance-check precedent, keeps the change additive to one code region, and avoids inventing a summary shape for a state the sentry deliberately refuses to characterize. Adding an indeterminate summary later is a clean, isolated extension at `sentryIndeterminate`.

**Write composes with `--json` rather than being mutually exclusive.**
Options: (a) `--summary-md` only when not `--json`; (b) always append the summary when the flag is present, independent of `--json`. **Chosen:** (b) — independent of `--json`, mirroring governance-check. Rationale: a CI job commonly wants both a machine artifact (JSON) and a human summary in one invocation; gating them against each other would force two calls.

**Remedy wording is reused from `trippedNotice`, not re-authored.**
Options: (a) write fresh remedy prose in the renderer; (b) name the same commands `trippedNotice` already names. **Chosen:** (b) — the summary names `faff sentry check --run-dir <dir>` and `faff sentry abort --run-dir <dir> --worktree <path>`, the commands `sentrycheck.js`'s `trippedNotice` already surfaces. Rationale: one home for the remedy wording; the ticket explicitly asks the flag to name the remedy commands from `trippedNotice`. (The strings are named per that source; a selftest fixture guards drift. A shared exported constant is a possible later refactor but is not required for this breadcrumb — the two loci render for different sinks.)

**Best-effort write (try/catch + stderr warning), never a gate.**
**Chosen:** wrap `appendFileSync` in try/catch and warn on stderr, never re-throwing and never changing the exit code — byte-for-byte the governance-check guard. Rationale: a surfacing artifact must never be able to fail the supervisory verdict.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the scope is fully determined by the rescope comment and the governance-check precedent.

**Assumptions:**

- **Assumes:** `renderGovernanceCheckSummaryMd` + its `--summary-md` handling in `governance-check.js` remain the house pattern for a verb-owned summary renderer. _Validation:_ the build agent reads `governance-check.js` ~L550/L631/L696 before writing the mirror; if that pattern has moved, mirror the current form.
- **Assumes:** `sentrycheck.js`'s `trippedNotice` (L110–117) remains the canonical remedy-command wording. _Validation:_ the build agent reads `trippedNotice` and matches its command strings; the selftest fixture asserts the match.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff sentry check --summary-md FILE` writes a markdown rendering of the same verdict `--json` reports, with the verb (not a caller shell) owning the rendering.
- [ ] The flag never changes `sentry check`'s exit code or verdict (a write failure only warns on stderr).

### From WHAT (interface)
- [ ] `--summary-md` is declared arity-1 in `SENTRY_SPEC.flags`; absent leaves behaviour unchanged.
- [ ] `renderSentryCheckSummaryMd(payload)` is a pure function taking the `check` payload and returning markdown ending in a single trailing newline.

### From HOW (behaviour)
- [ ] With the flag set, the rendered markdown is appended to FILE after the verdict payload is built, guarded by try/catch with a non-blocking stderr warning on failure.
- [ ] The summary write runs independently of `--json` (both may be passed in one invocation).
- [ ] The render shows: a `**run:**` line, a verdict line (✅ no derailment / ⚠️ N verdict(s) / ❌ TRIP with intervention), a verdicts table when verdicts are present, a `config_malformed` note when set, and remedy lines (verbatim from `trippedNotice`) only when tripped.
- [ ] The indeterminate (exit 3) path writes no summary file and is otherwise unchanged.

### From HOW (docs)
- [ ] `docs/guide/unattended.md` (`## An L3 watcher in CI`) gains a one-paragraph adopter note: to surface the sentry over your own CI, consult `faff sentry check --json` (or `--summary-md FILE` for a job summary) from a watchdog job/sidecar on your substrate; the always-on-runner reference is the shipped `sentry-poller`.
- [ ] `docs/guide/cli.md`'s `sentry <check|abort>` row grammar includes `[--summary-md FILE]` on `check`.

### From tests
- [ ] `faff sentry --selftest` gains a `renderSentryCheckSummaryMd` fixture pass: a tripped payload renders the TRIP line + verdicts table + the two remedy commands matching `trippedNotice`; a clean payload renders the ✅ line and no remedy lines.

**Integration smoke test:**

```
1. Resolve or synthesize a run dir with a tripped sentry verdict.
2. Run: faff sentry check --run-dir <dir> --summary-md /tmp/out.md
3. Assert exit 0, and /tmp/out.md contains "❌ TRIP" and "faff sentry abort --run-dir".
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
