# faff gates run: stop the whole-suite UNIT rung from misreporting a green suite as errored

> Spec: faffter-dark-nlspec · 2026-09-03 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-984.

This spec is for the build agent implementing FAFF-984, and for the human reviewer of that PR. It fixes how `faff gates run`'s rung runner classifies a slow whole-suite test rung so that a suite which is green when run standalone can never be reported as `errored` → needs-human. It touches one function, `runRung` in `plugin/skills/faff/bin/lib/gates.js`, which is shared with FAFF-981 — the scope split between the two is stated explicitly so the two builds serialise cleanly.

## 1. WHY — Problem and Principles

**The load-bearing model.** `runRung` runs each gate command with `spawnSync` and then classifies the result into `pass` / `fail` / `errored` from a single line: `if (res.error || res.status === 127) status = "errored"`. `spawnSync` sets `res.error` for three unrelated reasons — a genuine launch failure (command not found / ENOENT), a stdout buffer overflow (ENOBUFS), and a timeout kill (ETIMEDOUT / the child killed by SIGTERM after the `timeout` option elapsed). All three collapse into `errored`, and `runLadder` turns any `errored` rung into a `needs-human` signal. So a rung that timed out is indistinguishable from a rung whose tool is missing, and a green-but-slow suite becomes a false hold.

**Problem statement.** The Step-7.5 gate-ladder whole-suite UNIT rung on this repo's ~4226-test suite runs long (~517s observed and growing) and is at risk of being killed by `runRung`'s hardcoded 600s `spawnSync` timeout, after which it reports `errored` → needs-human even though the identical command run standalone exits 0. This spec raises and makes that timeout configurable so a green suite completes, and classifies a timeout kill distinctly from a genuine tool crash so it is diagnosable rather than opaque.

**Honest read of the evidence (important for scoping).** The cited FAFF-980 build reported `duration_ms=517176` (~517s), which is *below* the current 600s ceiling — so on that specific build the timeout almost certainly did not fire, and the `errored` was most likely the stdout buffer overflow that FAFF-981 owns (thousands of TAP lines from 4226 tests exceed `spawnSync`'s 1 MB default `maxBuffer`). FAFF-984 is therefore not a duplicate of that one incident: its distinct, load-bearing contribution is (a) the 600s ceiling is dangerously marginal for a 517s-and-growing suite and will fire soon, so it must be raised and made configurable, and (b) a real timeout must be classified distinctly from a crash. The buffer-overflow axis stays FAFF-981's.

**Design principles.**

- **Distinguish indeterminate from broken.** A timeout means "the ladder could not conclude", not "the tool is missing". The classification must preserve that difference even though both currently route through `errored`. This is the whole point of the ticket, not a nicety.
- **Follow the in-repo precedent, do not invent one.** The timeout-vs-spawn-error discrimination already exists in this same directory: `classifySentryConsult` in `plugin/skills/faff/bin/lib/sentrycheck.js` (around lines 74–97) treats `res.error.code === "ETIMEDOUT"` and a set `res.signal` with no `res.error` as Node's timeout path. Reuse that shape.
- **No cross-slice contract churn for a routing fix.** The reported harm is fixable within the fixed `faff-contract:quality-gates` enums; do not widen them for it (see the WHAT decision on rung status).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` | Node (CommonJS) | `runRung` (lines 418–433) is the sole edit locus; `readGatesConfig` (455–473) is where a new knob is read; `gatesSelftest` (728+) is where the regression test lives |
| `plugin/skills/faff/bin/lib/sentrycheck.js` | Node | `classifySentryConsult` is the timeout-classification precedent to mirror |
| `plugin/skills/faff/bin/lib/contract-defs.js` | Node | `GATE_RUNG_STATUSES = ["pass","fail","skipped","errored"]` and the quality-gates validator — the fixed enum this spec must stay within |
| `plugin/skills/faff/bin/lib/post-merge.js` (line 108), `merge-gate.js` (line 1014) | Node | The two non-graft callers of `runRung`/`runLadder`; the fix reaches them with no call-site change |

**Scope statement.** This is a localized correctness fix to the quality-gate ladder's rung runner; it changes no contract, no CLI surface, and no caller.

## 2. OUT OF SCOPE

- **The stdout `maxBuffer` / ENOBUFS overflow axis** — excluded because it is FAFF-981's ticket, which fixes the same `runRung` classification line for the buffer-overflow cause. Extension point: the `ENOBUFS` branch of the `res.error` classification in `runRung`; FAFF-984 must leave that branch clean for FAFF-981 (see Assumptions).
- **Speeding up or sharding the actual test suite** — excluded because that is FAFF-987 (the root-cause 10-minute-suite ticket). FAFF-984 raises the rung's tolerance and fixes its classification; it does not make the suite faster. Extension point: the CI workflow and `test/` layout, addressed by FAFF-987.
- **Sharding the whole-suite rung inside `runRung`** — one of the ticket's three suggested options, excluded here: splitting the suite belongs with FAFF-987's parallelisation, and raising-plus-classifying resolves the reported harm without the added complexity of in-runner sharding. Extension point: `discoverRungs` / rung selection in `gates.js`.
- **Extending the `faff-contract:quality-gates` rung-status enum** (e.g. adding `timed-out`) — excluded; see the WHAT decision below.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| rung | one discovered gate command (FORMAT / LINT / TYPECHECK / STATIC_ANALYSIS / UNIT / OTHER) the ladder runs |
| timeout kill | the child process terminated by `spawnSync`'s `timeout` option (Node sets `res.error` with `code === "ETIMEDOUT"` and/or `res.signal` set, `res.status === null`) |
| errored | the rung outcome meaning "could not conclude pass/fail" — routed to `needs-human` by `runLadder` |

**The new config knob.** `readGatesConfig` gains one numeric key, read with the existing present-ness-guarded `num()` pattern:

```
gates.rung_timeout_ms: <positive integer>   # optional; absent/malformed → default
```

`runRung` currently takes only `(rung, root)`; it needs the resolved timeout. Resolve it inside `runRung` by calling `readGatesConfig(root)` (already the config reader `runLadder` uses), or thread the value in from `runLadder`. Either is acceptable; the value must come from `readGatesConfig`, not a second hand-read.

**The rung result shape (unchanged fields, one new internal field).** `runRung` returns `{ kind, name, command, status, duration_ms, detail }`. This spec adds an optional internal `reason` field to the returned object for a timeout kill (e.g. `reason: "timed-out"`), and makes `detail` name the timeout and the elapsed/limit ms. `reason` is internal to the `GatesOutcome`; it is **not** added to the `faff-contract:quality-gates` extraction (`gatesContractExtraction` still emits only `{ kind, status }`).

**Design decision — the rung timeout value and knob.** The 600s (`10 * 60 * 1000`) hardcoded ceiling is marginal for a 517s-and-growing green suite. Options: leave it and only reclassify; raise the constant; raise it *and* make it configurable.
**Chosen:** raise the ceiling and make it configurable via `gates.rung_timeout_ms`, defaulting to `1800000` (30 minutes). Rationale: a generous default lets today's green suite finish comfortably while the root-cause speed-up (FAFF-987) is pending, and configurability means the ceiling can be tuned per repo without a code change if the suite keeps growing. The default is a large multiple of the observed 517s, not unbounded, so a genuinely hung command still terminates.

**Design decision — how to classify a timeout kill at the contract boundary.** A distinct rung status such as `timed-out` would be cleaner semantically, but `GATE_RUNG_STATUSES` is fixed at `{pass, fail, skipped, errored}` in `contract-defs.js` and mirrored in `quality-gates.schema.json` (both `additionalProperties: false`); adding a value would require changing both files plus every contract consumer.
**Chosen:** keep the `faff-contract:quality-gates` rung-status enum unchanged — a timed-out rung still reports `status: "errored"` at the contract boundary. The distinctness lives in the returned object's internal `reason: "timed-out"` and in the human-facing `detail`, not in a new contract status. Rationale: a timeout is genuinely indeterminate (we cannot claim the suite is green), so `errored` is the correct contract-level status; the reported harm — a green suite being killed — is fixed by the raised timeout, and the diagnosability is fixed by `reason`/`detail`, neither of which needs a cross-slice contract change.

**Design decision — does a timed-out rung still force `needs-human`?**
**Chosen:** yes. A genuine timeout at the raised 30-minute ceiling still routes to `needs-human` via the existing `errored` fold in `runLadder` — an unfinished suite must never read as green. What changes is only that the `reason`/`detail` make it a diagnosable, retry-worthy timeout rather than an opaque crash. A retry-on-timeout path is a possible future extension, not built here (extension point: `runLadder`'s `errored` handling, gates.js ~660).

## 4. HOW — Behavior

**Approach.** One function changes: `runRung`. Read the configured timeout, pass it to `spawnSync`, and after the call detect the Node timeout path before the blanket `errored` assignment, following the `classifySentryConsult` precedent.

```
PROCEDURE runRung(rung, root):
  1. timeout_ms := readGatesConfig(root).rung_timeout_ms   # default 1_800_000 when absent/malformed
  2. started := now()
  3. TRY res := spawnSync(rung.command, { cwd: root, shell: true, encoding: "utf8", timeout: timeout_ms })
     CATCH e: return { ...rung, status: "errored", duration_ms: now()-started, detail: tail_of(e.message) }
  4. duration_ms := now() - started
  5. tail := last 500 chars of (res.stderr + res.stdout)
  6. timed_out := (res.error AND res.error.code === "ETIMEDOUT")
                  OR (res.signal AND NOT res.error)          # Node's timeout path (sentrycheck precedent)
  7. IF timed_out:
        return { ...rung, status: "errored", reason: "timed-out",
                 duration_ms, detail: "timed out after " + duration_ms + "ms (limit " + timeout_ms + "ms); " + tail }
  8. IF res.error OR res.status === 127:                     # genuine launch failure / tool missing (UNCHANGED)
        return { ...rung, status: "errored", duration_ms, detail: tail }
  9. status := res.status === 0 ? "pass" : "fail"
 10. return { ...rung, status, duration_ms, detail: tail }
```

**Precedence note.** Step 6 must be evaluated *before* step 8, because a timeout sets `res.error` (ETIMEDOUT) and would otherwise be caught by the existing `res.error` branch and lose its distinct reason. The 127 / ENOENT branch (step 8) is unchanged so a genuine command-not-found still classifies exactly as today.

**Config read.** In `readGatesConfig`, add `rung_timeout_ms` alongside the existing knobs using the present-ness-guarded `num()` helper (the same guard used for `max_rungs_per_kind` / `partial_threshold`, which the code comment at gates.js:461 explains):

```
let rung_timeout_ms = 1_800_000;
const rt = Math.floor(num("gates.rung_timeout_ms"));
if (Number.isFinite(rt) && rt >= 1) rung_timeout_ms = rt;
```

**Edge cases and error handling.**
- Absent, empty, non-numeric, zero, or negative `gates.rung_timeout_ms` → the 30-minute default (the `num()` guard already yields `NaN` for absent/empty, and the `>= 1` check rejects zero/negative).
- A `spawnSync` that throws at launch (step 3 catch) stays `errored` with no `reason` — unchanged.
- A command that exits non-zero within the timeout stays `fail` — unchanged.
- The `detail` tail is still capped at the existing 500-char slice; the timeout prefix is added ahead of it.

**Failure modes — how the approach could be wrong, and how you'd notice.**
- **The 30-minute default is still too low** if FAFF-987 never lands and the suite keeps growing. *How you'd know:* builds start reporting `reason: "timed-out"` at the raised ceiling. *What it means:* raise `gates.rung_timeout_ms` in `.faffrc` (now possible without a code change) and prioritise FAFF-987.
- **The real recurring symptom was the buffer overflow, not the timeout** (the 517s < 600s evidence). *How you'd know:* even after this ships, the UNIT rung still reports `errored` with an ENOBUFS-shaped `detail` and a `duration_ms` under the ceiling. *What it means:* FAFF-981 (not this ticket) is the fix for that path; this spec deliberately does not touch it. Both must ship to fully close the false-hold class.
- **A future caller passes its own `killSignal`**, which would make "res.signal set with no error" ambiguous. *How you'd know:* a non-timeout SIGTERM misclassified as timed-out. *What it means:* today no `runRung` caller sets `killSignal` (same assumption sentrycheck.js documents for its own module); if that changes, tighten step 6 to require the ETIMEDOUT code.

## Assumptions

- **Assumes:** FAFF-981 (rung stdout over 1 MB overflows `spawnSync` `maxBuffer` and misclassifies as `errored`) is a sibling fix to the **same** `runRung` function and has **not** shipped. FAFF-984 scopes strictly to the timeout axis (the `ETIMEDOUT` / `SIGTERM` branch and the timeout ceiling) and does not touch the `maxBuffer` option or an `ENOBUFS` branch. Because both edits land in the same function around the `if (res.error || res.status === 127)` classification, the two builds **must be serialised** — whichever ships second rebases onto the first. If FAFF-981 has already shipped by build time, rebase FAFF-984's timeout branch onto its refactored classification rather than reintroducing a raw `res.error` check; if it has not, FAFF-984's change must leave the `res.error` (non-timeout) branch intact so FAFF-981 can add its `ENOBUFS` handling cleanly.

## Acceptance criteria

- The UNIT / whole-suite rung timeout is no longer a hardcoded 600s: `runRung` uses a timeout resolved from `gates.rung_timeout_ms` via `readGatesConfig`, defaulting to `1800000` ms (30 min). A `.faffrc` `gates.rung_timeout_ms: N` value is honoured; an absent, empty, non-numeric, zero, or negative value falls back to the default.
- A rung killed by the `spawnSync` timeout is classified with a distinct internal `reason: "timed-out"` and a `detail` that names the timeout and the elapsed/limit ms, detected via `res.error.code === "ETIMEDOUT"` or a set `res.signal` with no `res.error` (the `classifySentryConsult` precedent) — distinguishing it from a genuine spawn error / command-not-found.
- A genuine command-not-found (127) or spawn-launch failure still classifies as `errored` with no `reason` — the existing `gatesSelftest` case "errored rung → needs-human not fail" (gates.js ~773) still passes unchanged.
- At the `faff-contract:quality-gates` boundary the rung status stays within `{pass, fail, skipped, errored}`: a timed-out rung reports `errored`, so `contract-defs.js` and `quality-gates.schema.json` are untouched and the quality-gates validator/selftest is unchanged.
- A new regression case in `gatesSelftest()` drives a rung whose command sleeps past a small configured `gates.rung_timeout_ms` (e.g. a fixture `.faffrc.yaml` with `gates.rung_timeout_ms: 500` and a `sleep 5` command) and asserts the rung is classified with `reason: "timed-out"` (not a bare crash) and a timeout-shaped `detail`; a companion case asserts a fast command under a generous timeout still passes.
- The fix reaches all three consumers with no call-site change — `faff gates run` (graft Step 7.5), `runLadder` (merge-gate.js:1014), and `runRung` (post-merge.js:108) — verified through the existing `runLadder`/`runRung` selftest coverage.

confidence: high
spec-review: approve
build-tier: standard
