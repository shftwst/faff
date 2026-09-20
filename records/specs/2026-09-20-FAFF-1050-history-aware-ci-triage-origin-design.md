# FAFF-1050 — History-aware CI-triage origin: stop an intermittently-flaky main check reading as `origin=mine`

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1050.

> This spec is for the build agent implementing the fix, and for human reviewers of that PR. It defines the design and the definition of done for making `faff ci-triage`'s `origin` axis consider a check's *recent history* on main, not just main's HEAD.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff ci-triage` decides `origin` (is this red check *mine* or *main's*?) by comparing the PR's failing checks against **main's HEAD** check-runs at one instant. For a check that fails *intermittently* on main, main's HEAD is usually green, so the coincidence "main's HEAD happens to be green right now" reads the PR's failure as `origin=mine`. The fix widens the observation window from a single point (HEAD) to a short *recent history* of the check on main.

**Problem statement.** Today a red PR check whose real cause is an intermittent main-side flake reads `origin=mine`, routing toward a code `fix-attempt` or a needs-human park blamed on the PR author. The `main-was-red` branch — which exists precisely so a build is not blamed for a broken baseline and spends no fix attempt — is unreachable for the single most common real-world shape (an intermittent main flake), which is exactly when the distinction is load-bearing. This change makes `origin` consider the check's recent failure rate on main so an intermittent flake classifies `main-was-red`.

**Design principles.**

- **The classification core stays pure and unit-tested.** Origin determination is a pure function today (`classifyOrigin`); the history-aware version stays a pure function over supplied data, with the network fetch confined to the impure shell. Any implementation that folds fetching into the classifier is rejected.
- **Never worse than today, fail-safe direction.** If recent history can't be read, the classifier falls back to today's HEAD-only comparison — so the change never regresses the current behaviour, and an unreadable main still fails closed to `unknown` exactly as now. Widening `main-was-red` biases toward `park-needs-human` (a human looks), which is the safe direction: it never merges past a failure and never spends a fix attempt on a baseline it didn't break.
- **Per-check, never per-repo.** `main-was-red` is decided per failing check name (a main flake on a *different* check leaves this PR's check `mine`), preserving the existing invariant.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/ci-triage.js` | Node | The impure shell + pure classifiers being changed (`classifyOrigin`, `runCiTriage`) |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node | `deriveTriageAction` + the `ci-triage` contract/schema; the `evidence` shape gains fields |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node | Source of `ghJson` / `ghRepoSlug`; `isFailingRun`'s FAIL vocabulary mirrors `classifyHeadShaChecks` |
| `operations/ci/flaky-register.json` | JSON | Considered as a history source and **rejected** (see Design Decision Rationale) |
| `plugin/skills/faff-graft/SKILL.md` | Markdown | Step 10 CI-red triage — the sole consumer of the verdict; `main-was-red` → park-needs-human naming the check |

**Scope statement.** This sits inside the FAFF-391 flaky-vs-real CI triage core, refining only its `origin` axis and the evidence it surfaces; it changes no other axis and no downstream routing table.

## 2. OUT OF SCOPE

- **A `.faffrc` override for the window/threshold.** Excluded — the constants are chosen defensibly below and match the existing `QUARANTINE_THRESHOLD = 3` in-module-constant pattern; a config knob is a later refinement. **Extension point:** promote the two constants in `ci-triage.js` to `faff config get` reads (`ci_triage.main_history_window` / `.main_history_fail_threshold`).
- **Recording main-side run outcomes into the flaky register.** Excluded — the register's schema and append discipline (PR-side `transient` events only) are unchanged. **Extension point:** a new `main-history` carrier or a register schema extension, behind the same `readFlakyRegister` seam.
- **Extracting a specific failing-test id (finer flaky signature).** Unchanged from FAFF-391 — signature stays the check-run name. **Extension point:** `flakySignature(checkName)` in `ci-triage.js`.
- **Changing `transience` or `fault_domain`.** Untouched; only `origin` and `evidence` change.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Main HEAD comparison | Today's origin read: the PR's failing check names intersected with main's *current head* failing check names |
| Recent main history | The last N completed runs of a given check on main (by commit), and how many of them failed |
| History fail threshold | The failing-count over the window at/above which a check reads `main-was-red` |

**Types.**

```
RECORD MainHistoryEntry:          # per check-name, over the window
  check_name: String
  window: Int                     # number of completed main runs actually observed (<= N)
  failures: Int                   # count of those runs whose conclusion is failing (isFailingRun)

RECORD OriginEvidence (added to verdict.evidence):
  main_recent_window: Int | null      # N actually observed for the checks considered; null if history unreadable
  main_recent_failures: {String: Int} | null   # per-failing-check failing counts over the window; null if unreadable
```

**Interfaces.**

```
# PURE — extends today's classifyOrigin. mainRuns is main's HEAD runs (today's input);
# history is the recent-history map. threshold is the fail-count bar.
FUNCTION classifyOrigin(failingNames, mainRuns, history, threshold) -> "mine" | "main-was-red" | "unknown"

# IMPURE (shell) — fetch the recent history for a set of check names off origin/main.
FUNCTION fetchMainHistory(repo, checkNames, N, repoRoot) -> { MainHistoryEntry } | null
```

**Design decision — data source for recent history.** Fetch it **live** from GitHub, reusing the existing check-runs API and the `isFailingRun` vocabulary. The committed flaky register is *not* a valid source: it only ever appends events when `transience === "transient"` (a PR-side re-run confirmed a flake) keyed by check-name signature — it stores no main-branch run outcomes at all, so it cannot answer "how often did this check fail on main recently." **Chosen:** live fetch over the last N main commits.

**Design decision — window and threshold.** **Chosen:** window `N = 10` most-recent completed main runs of the check; classify `main-was-red` when `failures >= 2` (`MAIN_HISTORY_WINDOW = 10`, `MAIN_HISTORY_FAIL_THRESHOLD = 2`). Rationale: the ticket states a single recent failure is too eager and 3-of-8 is clearly enough; `>= 2` excludes a one-off while catching an intermittent flake (3/8 trips comfortably).

**Design decision — composition with today's HEAD read.** **Chosen:** a failing check reads `main-was-red` when it is failing on main's HEAD **OR** its recent-history failures cross the threshold; otherwise `mine`; `unknown` only when main is entirely unreadable (HEAD null **and** history null), exactly as today. This strictly widens `main-was-red` and never narrows it.

## 4. HOW — Behavior

**Architecture and approach.** `runCiTriage` already reads main's HEAD check-runs. After computing `failingNames`, the shell additionally fetches recent history for those names via `fetchMainHistory`, then calls the extended `classifyOrigin(failingNames, mainRuns, history, MAIN_HISTORY_FAIL_THRESHOLD)`. The per-check failing counts and window go into `verdict.evidence` so the operator sees the basis (folds in the ticket's conservative "surface the rate" option). `deriveTriageAction` is unchanged — a `main-was-red` origin already routes to `park-needs-human`.

```
PROCEDURE classifyOrigin(failingNames, mainRuns, history, threshold):
  1. headReadable := mainRuns != null
     historyReadable := history != null
  2. IF NOT headReadable AND NOT historyReadable: RETURN "unknown"   # today's fail-closed
  3. mainHeadFailing := headReadable ? set(failingCheckNames(mainRuns)) : {}
  4. FOR each name in failingNames:
       a. IF mainHeadFailing has name: RETURN "main-was-red"                     # today's HEAD hit
       b. IF historyReadable AND history[name].failures >= threshold: RETURN "main-was-red"
  5. RETURN "mine"
```

```
PROCEDURE fetchMainHistory(repo, checkNames, N, repoRoot):   # best-effort; null on failure
  1. shas := git log origin/main -n N --format=%H   (in repoRoot)   # bounded to N commits
     IF the git call fails: RETURN null
  2. counts := { name: {failures:0, window:0} for name in checkNames }
  3. FOR each sha in shas:
       runs := ghJson(check-runs for sha)          # same API shape as the HEAD read
       IF NOT ok: CONTINUE                          # skip an unreadable commit, keep going
       failingHere := set(failingCheckNames(runs))
       FOR each name in checkNames:
         counts[name].window += 1
         IF failingHere has name: counts[name].failures += 1
  4. IF every counts[name].window == 0: RETURN null   # nothing observed -> unreadable
  5. RETURN counts
```

**Edge cases.**

- **`failingNames` empty** — no history fetch (nothing to classify); origin path unchanged.
- **Main HEAD readable but history unreadable** — history returns null; classifier uses HEAD only (today's behaviour). Evidence `main_recent_*` are null.
- **A commit in the window has no run for the check** — it counts toward `window` but not `failures` (an absent run is not a failure).
- **`git log origin/main` unavailable / no `origin/main`** — `fetchMainHistory` returns null; HEAD-only path; never throws.

**Failure modes.**

- **The failure:** `N = 10` commits is too short a window to observe a genuinely rare flake (fails 1-in-30), so it still reads `mine`. **How you'd know:** a `main-was-red`-shaped incident recurs with `main_recent_failures[check] < 2` in the persisted `ci-triage.json`. **What it means:** widen `N` (or lower threshold) — the surfaced evidence is exactly what makes this diagnosable, which is why it is recorded even when the verdict stays `mine`.
- **The failure:** history fetch cost (up to N extra check-runs API calls per triage pass) is unacceptable in the landing loop. **How you'd know:** the 25-minute landing-loop deadline is pressured by triage latency. **What it means:** the fetch is bounded (N=10, best-effort, skips unreadable commits) and only runs when there are failing checks; if still too costly, cache per run-dir. Named, not pre-optimised.

**Anti-pattern:** folding the network fetch into `classifyOrigin`. Why: it destroys the pure/unit-tested classifier the module's whole discipline rests on. **Anti-pattern:** reading the flaky register for main history. Why: the register holds no main-run outcomes — only PR-side `transient` signatures — so it would silently answer the wrong question.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a PR whose check `validate-macos` is failing
  And main's HEAD is green for `validate-macos`
  And `validate-macos` failed on 3 of the last 10 completed runs on main
When faff ci-triage classifies origin
Then origin is `main-was-red` and action is `park-needs-human` naming the check
```

```
Given a PR whose check `validate-macos` is failing
  And main's HEAD is green for `validate-macos`
  And `validate-macos` failed on 0 of the last 10 completed runs on main
When faff ci-triage classifies origin
Then origin is `mine` (a clean recent history does not manufacture main-was-red)
```

```
Given a PR whose check `build` is failing
  And main's HEAD check-runs are unreadable (null) and git log origin/main fails (history null)
When faff ci-triage classifies origin
Then origin is `unknown` (fail-closed, exactly as today)
```

- The recorded `ci-triage.json` verdict MUST carry `evidence.main_recent_failures` (per failing check) and `evidence.main_recent_window` whenever history was readable.

## 6. Design Decision Rationale

**Which of the ticket's directions to take?** Options: (1) history-aware `main-was-red`; (2) keep HEAD as the verdict but surface the recent rate to the operator only. **Chosen: (1), with (2)'s surfaced rate folded into the verdict evidence.** Option 2 alone changes no routing, so it does not fix the actual bug — the misclassification still routes `origin=mine`. Option 1 is the load-bearing fix and biases toward the safe direction (`park-needs-human`). Recording the rate in evidence gives option 2's operator-visibility for free.

**Window and threshold?** Options: `>=1/8` (too eager per the ticket), rate-based `>=0.375` (matches 3/8 but brittle at small windows), fixed count over a fixed window. **Chosen: `failures >= 2` over `N = 10`.** Simple, matches the ticket's anchors (1 too eager, 3/8 enough), robust at a small window, mirrors the existing integer-constant style.

**History source?** Options: the committed flaky register (ticket's option 3), live GitHub fetch. **Chosen: live fetch.** The register records only PR-side `transient` events keyed by signature (`ci-triage.js` appends solely when `transience === "transient"`); it has no main-run history, so option 3 rests on a mistaken premise. Documented here so it is not re-proposed.

**Composition with today's HEAD read?** **Chosen: OR (HEAD-red OR history-over-threshold).** Strictly widens `main-was-red`, preserves per-check semantics and the `unknown` fail-closed case; guarantees "never worse than today."

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. (The window/threshold constants are a defensible engineering choice with a named `.faffrc` extension point; not escalated.)

**Assumptions.**

- **Assumes:** `git log origin/main` and the `gh api .../commits/<sha>/check-runs` endpoint are reachable in the triage environment — the same reachability `runCiTriage` already relies on for the HEAD read. *Validation:* the existing HEAD read (`gh api .../commits/<mainHeadSha>/check-runs`) already exercises this path; `fetchMainHistory` degrades to null (HEAD-only) if either is unavailable, so absence is tolerated, not fatal.

## Already shipped against this surface

Related-but-not-superseding — the premise holds, this is reader context only:

- **FAFF-391** (Done, 2026-07-14, project "Faff learns from being run") — *built* the flaky-vs-real CI triage this refines, including the HEAD-only `classifyOrigin` / `main-was-red` read. This ticket refines that origin axis; it does not redo FAFF-391's work. Reading `plugin/skills/faff/bin/lib/ci-triage.js` confirms `classifyOrigin` still reads only main's HEAD, so the premise is load-bearing.
- **FAFF-841 / FAFF-844** (Done) — built the bounded landing loop that *consumes* the ci-triage verdict (graft Step 10). Neither changes how `origin` is computed; they route on it.
- **FAFF-1049** (related) — the intermittent `validate-macos` flake that exposed this bug; not the fix.

No Done ticket delivers a history-aware origin. Proceed unchanged.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issue. A single 1–2 day unit: one module's pure classifier extended, one bounded impure fetch added, one evidence field threaded through the contract, and the selftest widened. Not two independent concerns — the fetch, the classifier, and the evidence surfacing are one change.
- **Workstream fit?** No issue. Cohesive with the FAFF-391 CI-triage core it refines; outcome-named (stop misclassifying intermittent main flakes).
- **Deps surfaced?** No issue. No implicit blocker — FAFF-391 (the surface) is Done; FAFF-1049 (the exposing flake) and FAFF-1039 (the exposing build) are related, not blocking. No blocker link is missing.
- **Risk profile?** No de-risking spike needed. The change is a pure-function extension plus a bounded best-effort fetch, ships via PR (revertible), and its behavioural change biases toward the safe direction (`park-needs-human`, a human looks) with a HEAD-only fallback that guarantees "never worse than today."

## 8. DONE — Definition of Done

### From WHY
- [ ] An intermittently-flaky main check (green at HEAD, failing ≥2 of last 10 main runs) classifies `origin=main-was-red`, not `mine`.
- [ ] Behaviour is never worse than today: an unreadable main HEAD **and** unreadable history still yields `origin=unknown`.

### From WHAT (types and interfaces)
- [ ] `classifyOrigin` takes `(failingNames, mainRuns, history, threshold)` and remains a pure function (no network).
- [ ] `MAIN_HISTORY_WINDOW = 10` and `MAIN_HISTORY_FAIL_THRESHOLD = 2` exist as module constants and are exported for the selftest.
- [ ] `verdict.evidence` gains `main_recent_window` (int|null) and `main_recent_failures` (map|null), threaded through `computeCiTriage`'s evidence rebuild and registered in the `ci-triage` contract schema in `contract-defs.js`.

### From HOW (behaviour)
- [ ] A failing check that is green at main HEAD but ≥ threshold over the window reads `main-was-red`.
- [ ] A failing check green at HEAD and < threshold over the window reads `mine`.
- [ ] A failing check red at main HEAD still reads `main-was-red` (today's path preserved), per-check.
- [ ] `fetchMainHistory` is bounded to N commits, skips unreadable commits, returns null when nothing was observed, and never throws.
- [ ] History fetch runs only when `failingNames` is non-empty.

### From HOW (edge cases)
- [ ] A window commit with no run for the check counts toward `window`, not `failures`.
- [ ] `git log origin/main` failure → `fetchMainHistory` null → HEAD-only classification, evidence `main_recent_*` null.

### From Scenarios / selftest
- [ ] `ciTriageSelftest` covers: main-was-red via history (green HEAD), mine on clean history, mine on a single one-off, main-was-red still via HEAD, and unknown when both unreadable — all pure, no network.

**Integration smoke test:**
```
Construct failingNames=["validate-macos"], mainRuns=[] (HEAD green),
history={ "validate-macos": {failures:3, window:8} }, threshold=2
=> classifyOrigin(...) === "main-was-red"
=> deriveTriageAction("unknown","unknown","main-was-red") === "park-needs-human"
```

confidence: high
build-tier: complex
spec-review: approve