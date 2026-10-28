# Lights-out mint catches a refused ledger write and leaves no run directory behind

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high · build-tier: standard · spec-review: accept (judge, L3-provisional). Full spec on Linear FAFF-1306.

> Revised on 2026-10-27: (1) added a born-verifiable `## Scenarios` block and a checklist `## Done` so the DoD is machine-gradeable (the prior spec carried prose ACs only and was refused by `faff admissible --lights-out` with 0 scenarios / 0 DONE items); (2) named the concrete in-process `cmdLightsOut` + export-stub test mechanism (the mint is behind the L4 preflight, so a bare-CLI tmp-root test cannot reach it); (3) replaced Decision 5's inaccurate "FAFF-1305 owns the lights-out genesis orphan" rationale with an honest, bounded genesis-orphan limitation surfaced for human routing. Design decisions 1–8 (the fix itself) are otherwise unchanged.

## Why

`mintLightsOut` (`plugin/skills/faff/bin/lib/lights-out.js`) claims a fresh run directory and then performs two ledger-chain writes with **no** error handling:

```
const mintWriteRes = mutateLedgerUnderLock(runDir, () => ledger);   // ~line 1200
...
emitGenesisRunStart(runDir, { level: "L4" });                        // ~line 1211
```

A ledger **schema refusal** (`isLedgerSchemaError`) or a **lock-acquisition failure** (`LEDGER_LOCKED`, thrown by `fs-lock.js`) throws straight out of `faff lights-out` as an **uncaught stack trace**, and the just-claimed run directory is orphaned under `.faff/runs/`. The operator sees a crash instead of a structured refusal, and a stale empty run dir accumulates.

The L3 sibling `init-self-drain` (`run-ledger.js`, ~lines 487–537) already handles exactly this: it classifies a schema refusal (exit 1) separately from a lock/other write failure (exit 3), discards the run directory it created on a failed ledger write via the shared `discardUnmintedRunDir` helper (FAFF-1280), and treats a genesis-emit failure as a fail-closed refusal (exit 3). `mintLightsOut` — the L4 mint — has no equivalent. This ticket ports that proven shape to the lights-out mint.

## What (scope)

In scope: the ledger-write and genesis-emit region of `mintLightsOut` only. The fix wraps those two writes so a failure returns the file's standard `--json` refusal shape (`{ proceed: false, level: "L4", error }`) with a named message and a refusal exit code, and removes the run directory this call created when (and only when) the ledger never landed — the same "only a directory this call created" rule FAFF-1280 established.

Out of scope: the genesis-failure "live ledger left behind" cleanup is owned by the open sibling **FAFF-1305** ("init-self-drain and init-interactive leave a live ledger behind when the genesis event fails"); this ticket matches `init-self-drain`'s current genesis behaviour rather than diverging from it.

## Already shipped against this surface

- **FAFF-1280** (Done, 2026-10-15) — "Leave no run directory behind when a run-ledger mint is refused." Added `discardUnmintedRunDir` and wired it into the `run-ledger init-interactive` and `init-self-drain` verbs **only**. FAFF-1306 is the explicit remaining delta: the same rule for the lights-out (L4) mint.
- **FAFF-1281** (Done) — "Take the run-ledger lock around bundle-recover's ledger restore." Adjacent lock-safety work; not overlapping.
- **FAFF-1305** (Backlog, related, not superseding) — "init-self-drain and init-interactive leave a live ledger behind when the genesis event fails." Owns the genesis-leaves-a-live-ledger cleanup **for the init verbs**. Its scope, as written, does **not** cover the lights-out mint, so FAFF-1306's genesis path inherits the same (pre-existing, sibling-shared) orphan rather than a fix — see Decision 5's genesis-orphan limitation, which surfaces this for human routing (extend FAFF-1305, file a generalising follow-up, or accept the bounded gap). Informs — does not block — this ticket.

Premise verdict: **still holds** — no Done ticket covers the lights-out mint path.

## How

### Decision 1 — wrap the two mint writes, emitting the file's `--json` refusal shape

**Chosen:** add a local refusal emitter inside `mintLightsOut` mirroring the resume path's `emitRefuse` (`lights-out.js` ~line 1235), and wrap the `mutateLedgerUnderLock` + `emitGenesisRunStart` region in it:

```
const emitMintRefuse = (code, msg) => {
  if (json) process.stdout.write(JSON.stringify({ proceed: false, level: "L4", error: msg }) + "\n");
  else process.stderr.write(msg + "\n");
  return code;
};
```

Rationale: `{ proceed: false, level: "L4", error }` is the file-wide refusal shape already used at the supplied-id claim branch (line 1096) and every preflight refusal (lines 802/814/829/844/859), and it is exactly what AC1 requires under `--json`. This is the one deliberate divergence from `init-self-drain`, which writes a bare stderr line and no JSON object: lights-out has a `--json` contract and its callers parse `proceed`, so the mint must honour it.

### Decision 2 — classify the ledger-write failure exactly as init-self-drain

**Chosen:** catch around `mutateLedgerUnderLock` and branch on the error, mirroring `run-ledger.js` lines 507–519:

- `isLedgerSchemaError(e)` → `emitMintRefuse(1, "faff lights-out: " + e.message + " — no ledger minted")`
- any other throw (includes `LEDGER_LOCKED`, detected by `e.code === "LEDGER_LOCKED"` for the message only) → `emitMintRefuse(3, …)`
- a non-throwing `!mintWriteRes.written` (null-mutate abort / epoch yield — never armed on a fresh mint, handled for uniformity) → `emitMintRefuse(3, …)`

Rationale: identical taxonomy to the sibling verb — schema refusal is a caller/data fault (exit 1), a lock/contention failure is an environmental fail-closed (exit 3). `isLedgerSchemaError` and the `LEDGER_LOCKED` sentinel are already in scope: `lights-out.js` line 52 imports `{ isLedgerSchemaError, mutateLedgerUnderLock }` from `./heartbeat`.

### Decision 3 — genesis-failure exit code (resolves the ticket's open question)

**Chosen:** a genesis-emit failure returns **exit 3**. Wrap `emitGenesisRunStart(runDir, { level: "L4" })` in a try/catch; any throw → `emitMintRefuse(3, "faff lights-out: could not append the genesis run-start event in " + runDir + (err ? ": " + err.message : "") + " (ledger written, no chain) — mint NOT reported successful")`.

Rationale: this is the open question "which exit code a genesis failure should use for lights-out." `init-self-drain` already sets the precedent — genesis failure there returns exit 3 (`run-ledger.js` line 536) — because a genesis failure is a write-the-chain failure of the same environmental class as lock contention, not a schema refusal (exit 1). Matching exit 3 keeps the two mints' refusal codes aligned and keeps exit 1 meaning "schema refusal" alone across the suite.

### Decision 4 — error detection on the genesis leg

**Chosen:** treat **any** throw from `emitGenesisRunStart` as a genesis failure; no error-type discrimination. The emit either lands the genesis chain or it does not. Mirrors `init-self-drain` (`genesisFailed = true` on any catch, `run-ledger.js` lines 531–537).

### Decision 5 — cleanup rule (reuse FAFF-1280's helper; discard only an un-landed dir)

**Chosen:** structure the ledger write as init-self-drain does — a `landed` flag set true after a successful write, with a `finally` that discards only when the ledger did not land:

```
let mintWriteRes, landed = false;
try {
  try { mintWriteRes = mutateLedgerUnderLock(runDir, () => ledger); }
  catch (e) { /* Decision 2 branches → return via emitMintRefuse */ }
  if (!mintWriteRes.written) return emitMintRefuse(3, …);
  landed = true;
} finally {
  if (!landed) discardUnmintedRunDir(runDir, "lights-out");
}
```

- **Ledger-write failure** → `landed` stays false → `discardUnmintedRunDir` removes the (empty) dir → AC1/AC2 "leaves no run directory" satisfied. `claimRunDir` exclusive-creates the leaf, so the returned `runDir` is always a directory this call created — the FAFF-1280 "only a directory this call created" rule holds without an extra pre-existence check.
- **Genesis failure** → `landed` is already true → **no discard**; the directory legitimately holds a written `run-ledger.json`. `discardUnmintedRunDir` is non-recursive by design (FAFF-1280) and must never delete a dir that holds a ledger. FAFF-1306 matches `init-self-drain`'s current behaviour (return 3, the dir with ledger-but-no-genesis remains) rather than diverging from the sibling mint.

  **Genesis-orphan limitation (known, bounded, deliberately out of scope).** The dir this leaves holds a `level: "L4"`, `owner.status: "running"` ledger with no genesis chain. That is exactly the state `isLiveHigherLevel` keys on (`run-ledger.js`), so until a human clears it, `run-ledger init-self-drain` / `init-interactive` on that box refuse with the live-higher-level downgrade guard (`run-ledger.js` ~line 446 / ~line 314). **This is not a regression introduced here** — `init-self-drain` leaves the identical orphan on its own genesis failure **today** (`run-ledger.js` ~lines 540–542 return 3 with the ledger-bearing dir intact), so FAFF-1306 faithfully mirrors the sibling rather than introducing a new bug class. Cleaning it up **in this ticket** is deliberately rejected: it would mean removing a ledger-bearing directory — exactly what FAFF-1280's non-recursive helper refuses by design — and would make the lights-out genesis path diverge from the two init verbs it is meant to match. The correct home for the fix is a **single follow-up that generalises genesis-orphan cleanup across all three mints** (`init-interactive`, `init-self-drain`, `lights-out`); the existing sibling **FAFF-1305** owns this for the init verbs, and its scope should extend to (or a sibling follow-up should cover) the lights-out mint — this spec does **not** claim FAFF-1305 as-scoped already covers lights-out. Surfaced here for the human to route (extend FAFF-1305, file a generalising follow-up, or accept the bounded, recoverable gap); not filed autonomously.

**Assumes:** `discardUnmintedRunDir` is already exported from `run-ledger.js` (confirmed, `module.exports` line 815). `lights-out.js` already lazy-requires `run-ledger.js` (for `resolveMintBaseSha`, line 1154) with a documented no-cycle guarantee, so a lazy `const { discardUnmintedRunDir } = require("./run-ledger")` at the use site is cycle-safe.

### Decision 6 — generalise the shared helper's message prefix

**Chosen:** `discardUnmintedRunDir`'s stderr message currently hardcodes `faff run-ledger ${command}:` (`run-ledger.js` line 276). Change the template to `faff ${command}:` and pass the fuller label at each site: `"run-ledger init-interactive"` and `"run-ledger init-self-drain"` at the two existing sites (keeping their messages byte-identical) and `"lights-out"` at the new site, so the lights-out path reports `faff lights-out: could not remove …` rather than a wrong `faff run-ledger lights-out:` prefix.

Rationale: the helper's only non-`ENOENT` error branch is near-unreachable (rmdir of an empty dir), but the prefix must still be correct for the one path that reaches it; the per-site label keeps existing output unchanged.

### Decision 7 — `recordRunnerIdentity` stays outside the refusal path

**Chosen:** leave `recordRunnerIdentity` (`lights-out.js` line 1216) exactly as-is — best-effort, wrapped in its own swallowing try/catch, running only after a successful genesis emit. It never throws out and never blocks a mint, so it is untouched and never part of a refusal branch. A genesis failure returns before reaching it (correct — identity recording after a broken chain is meaningless).

### Decision 8 — the auto-mint `claimRunDir` at line 1102 is out of scope

**Chosen:** leave the unguarded auto-mint `claimRunDir(runsParent, baseId, { supplied: false })` (line 1102) unchanged. `claimRunDir` exclusive-creates each candidate leaf and only throws when every candidate already exists (someone else's dirs) or on a pre-create fs fault (`EACCES`/`ENOSPC`) — in neither case has it left behind a directory **this** call created, so it cannot orphan a run dir. The supplied-`--id` branch (line 1093) is already guarded (exit 2). The ticket's ACs concern refused ledger/genesis writes, not claim failures; wrapping claim failures in a `--json` refusal is a separate, lower-value robustness item and is deliberately excluded to keep the fix minimal and matched to its stated surface.

### Emit model

**Assumes:** `lights-out.js` and `run-ledger.js` are plain JavaScript modules with no committed `.ts` emit (confirmed — only `producer-auth.ts`/`commissaire.ts` are TS per AGENTS.md). No `npm run build` step is required; edits land directly in the `.js` sources.

## Scenarios

> Test mechanism (shared by scenarios 1–4). `mintLightsOut` is not exported and sits behind the full L4 preflight, so the mint is **not** reachable by running the `faff lights-out` CLI on a bare temp root (the preflight — `containerCheck`, dial-coherence, budget-metering — refuses first). Drive it the way the existing suite already does: call the **exported `cmdLightsOut`** in-process against **the full proceed-path fixture `test/lights-out.test.mjs`'s `tmpRoot()` helper writes**, reused verbatim rather than a hand-enumerated subset — it supplies every provision the preflight needs together: the injected `KUBERNETES_SERVICE_HOST` so `containerCheck` resolves `contained`; `slots.review: faffter-dark-adversarial-review` + `slots.spec_review: faffter-dark-spec-review` and `gates.fallback: fail-closed` so the dial-coherence gate (FAFF-298) admits the proceed path; a `budget.tokens` ceiling **with `on_estimate_only: warn`** so the budget-metering gate (FAFF-428) degrades-and-proceeds rather than refusing on the absent transcript; and `autonomous.engine_bounded: true` so the host-socket gate downgrades to a warn. Intercept the two writes with the **fresh-process export-stub** technique `test/run-ledger-mint-refusal.test.mjs` uses for the sibling verb: stub `heartbeat.mutateLedgerUnderLock` / `events.emitGenesisRunStart` on their module exports in a fresh `node -e` process **before** `lights-out.js` is required (it destructures both at require time), then invoke `cmdLightsOut({ json: true, … })` against that `tmpRoot()` fixture. `cmdLightsOut` returns the exit code and writes the `--json` payload to stdout, so each assertion below is a captured return-code + captured-stdout check, not a black-box CLI run. The invocation must thread the full COMMANDS registry into cmdLightsOut's second parameter so all seven CLI-backed guardrails read present (FAFF-899 floor) and the preflight is admitted to the mint rather than refusing before `mintLightsOut` is reached.

### Scenario: schema-refused ledger write is a structured exit-1 refusal that leaves no run directory
Given the in-process harness above with `heartbeat.mutateLedgerUnderLock` stubbed to throw an `isLedgerSchemaError`-tagged error
When `cmdLightsOut` runs with `json: true` against the temp root
Then it returns exit `1`, its captured stdout is a single JSON object `{ "proceed": false, "level": "L4", "error": <non-empty string> }`, and no run directory remains under `<root>/.faff/runs/`

### Scenario: lock-acquisition failure is a named exit-3 refusal that leaves no run directory
Given the in-process harness above with `heartbeat.mutateLedgerUnderLock` stubbed to throw an error whose `code === "LEDGER_LOCKED"`
When `cmdLightsOut` runs with `json: true` against the temp root
Then it returns exit `3`, its captured stdout is the `{ "proceed": false, "level": "L4", "error": <named message, not a stack trace> }` refusal shape, and no run directory remains under `<root>/.faff/runs/`

### Scenario: genesis-emit failure is an exit-3 refusal that keeps the ledger-bearing directory
Given the in-process harness above with `heartbeat.mutateLedgerUnderLock` left intact (the ledger write succeeds) and `events.emitGenesisRunStart` stubbed to throw
When `cmdLightsOut` runs with `json: true` against the temp root
Then it returns exit `3`, its captured stdout is the `{ "proceed": false, "level": "L4", "error": <named message> }` refusal shape, and the claimed run directory still exists and still contains its written `run-ledger.json` (not removed — see Decision 5's genesis-orphan limitation)

### Scenario: a successful lights-out mint is unchanged
Given the in-process harness above with no stubbed failures
When `cmdLightsOut` runs with `json: true` against the temp root
Then it returns exit `0`, its captured stdout carries `"proceed": true` and `"level": "L4"`, and the claimed run directory exists containing a valid `run-ledger.json` and a genesis `events.jsonl` chain

### Scenario: the discard message prefix is generalised without changing the existing two sites
Given `discardUnmintedRunDir` invoked directly (the exported helper) for `init-interactive` and `init-self-drain`, each forced to a non-`ENOENT` discard failure by stubbing `fs.rmdirSync` to throw `EPERM` (or by pointing it at a non-empty dir to raise `ENOTEMPTY`), exactly as `test/run-ledger-mint-refusal.test.mjs` already does
When each existing site emits its discard stderr message, and `discardUnmintedRunDir(runDir, "lights-out")` is forced to the same failure
Then the `init-interactive` and `init-self-drain` captured stderr are byte-identical to the pre-change output (`faff run-ledger init-interactive: …` / `faff run-ledger init-self-drain: …`) and the lights-out site's captured stderr is prefixed `faff lights-out:` (never `faff run-ledger lights-out:`)

## Done (acceptance criteria)

- [ ] **ac-1** — a schema-refused ledger write in a lights-out mint exits `1`, writes a named message, emits `{ proceed: false, level: "L4", error }` under `--json`, and leaves no run directory under `.faff/runs/` (tmp-root test added, asserting exit code, JSON shape, and run-dir absence)
- [ ] **ac-2** — a `LEDGER_LOCKED` lock-acquisition failure in a lights-out mint exits `3` with a named refusal (not an uncaught stack trace) and the same `--json` refusal shape, and leaves no run directory (tmp-root test added)
- [ ] **ac-3** — a genesis-emit failure in a lights-out mint exits `3` with a named refusal and the `--json` refusal shape, and the ledger-bearing run directory is not removed (in-process `cmdLightsOut` test with `emitGenesisRunStart` stubbed to throw, matching `init-self-drain`'s genesis path; the retained orphan is Decision 5's documented, out-of-scope limitation)
- [ ] **ac-4** — a successful lights-out mint is byte-for-byte unchanged: exit `0`, `proceed: true` / `level: "L4"` JSON payload, same banner, and a run dir holding `run-ledger.json` plus the genesis `events.jsonl` chain (tmp-root success test added)
- [ ] **ac-5** — `discardUnmintedRunDir`'s message template is generalised to `faff <command>:`; the `init-interactive` and `init-self-drain` sites emit byte-identical stderr to today and the new lights-out site reports a `faff lights-out:` prefix (assertion/test added)

### Verification surface

- The mint path is impure and sits behind the full L4 preflight, so it is exercised **in-process via the exported `cmdLightsOut`**, not via the `faff lights-out` CLI on a bare root (which the preflight refuses before the mint). Reuse the two already-established harnesses: `test/lights-out.test.mjs`'s **`tmpRoot()` proceed-path fixture verbatim** (injected `KUBERNETES_SERVICE_HOST` → `containerCheck: contained`; `slots.review`/`slots.spec_review` adversarial occupants + `gates.fallback: fail-closed` for dial-coherence; a `budget.tokens` ceiling **with `on_estimate_only: warn`** for budget-metering; `autonomous.engine_bounded: true` for the socket gate — the complete set the preflight needs, not a partial enumeration) to reach the mint, and `test/run-ledger-mint-refusal.test.mjs`'s fresh-process export-stub technique (`runStubbed`) to intercept `heartbeat.mutateLedgerUnderLock` / `events.emitGenesisRunStart` before `lights-out.js` is required. Assert the returned exit code, captured `--json` `proceed:false` stdout, and run-dir absence/presence per scenario. AC5's discard-prefix is asserted by invoking the exported `discardUnmintedRunDir` directly and forcing a non-`ENOENT` failure (`fs.rmdirSync` stubbed to `EPERM`, or a non-empty dir → `ENOTEMPTY`), exactly as `test/run-ledger-mint-refusal.test.mjs` already does for the two existing sites. The `--selftest` harness (`lightsOutSelftest`) still covers the pure preflight table and is unchanged.

confidence: high
spec-review: accept (judge, L3-provisional)

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues. One cohesive concern — error handling for the two mint writes in a single function, plus a one-line generalisation of a shared helper's message prefix. A single 1–3 day unit; no split, no merge.
- **Workstream fit?** Minor note. The work sits in the run-ledger-mint hardening thread with Done sibling FAFF-1280 and open sibling FAFF-1305. Its tracker parent is FAFF-1255 (anchored-evidence), a thematic mismatch, but parentage does not affect buildability — surfaced for the human, not blocking.
- **Deps surfaced?** No issues. FAFF-1280 (the helper it reuses) is Done. FAFF-1305 is a related sibling the spec deliberately does **not** depend on — it defers the genesis-leaves-a-live-ledger cleanup to FAFF-1305 rather than requiring it. No implicit blocker is missing.
- **Risk profile?** No issues. The fix ports a proven, already-tested sibling pattern (init-self-drain) into an adjacent function; no novel integration, no external dependency. No de-risking spike warranted.

## Spec-review (adversarial, L3)

Re-reviewed across three adversarial rounds after the admissibility-floor refresh (lenses: architectural · infosec · QA; methodology skipped by lens-selection; refuter transport, backends served live throughout):

- **Round 1 — reject-approach.** architectural/major: Decision 5 deferred the genesis-failure live-ledger cleanup to FAFF-1305, whose scope is the init verbs only, so the lights-out orphan was unowned. QA/major + minor: the scenarios drove `faff lights-out` end-to-end past the L4 preflight on a bare root with no stubbing seam named. → Revised: honest, bounded genesis-orphan limitation (no false FAFF-1305 ownership claim; surfaced for human routing); scenarios + Verification surface rewritten to the concrete in-process `cmdLightsOut` + `tmpRoot()` + export-stub mechanism.
- **Round 2 — revise.** architectural CLEAR (genesis-orphan framing accepted); one QA/minor: the named harness config was an incomplete subset of `tmpRoot()`. → Fixed by referencing the full fixture verbatim.
- **Round 3 — reject-approach (churn).** architectural/minor + QA/minor: the in-process harness must also thread faff's COMMANDS registry into `cmdLightsOut`'s second parameter (FAFF-899 floor), else the preflight refuses before the mint. churn + non-convergence → would-be-park.
- **Spec-review judge (L3, blinded two-phase, per-proposition).** p-01 **UPHOLD_REVIEW** — correction applied in place (the COMMANDS-registry-threading sentence, now in the Test-mechanism preamble). p-02 **AFFIRM_SPEC** — the correction already satisfied it. Admit roll-up: `admit: true`, level L3, zero parked / unresolved / PRD-boundary, no floor veto.

Retained as `spec-review: accept (judge, L3-provisional)` — a provisional L3 admit: a later human comment classified as a challenge re-parks/reverts via Live-thread reconciliation. The genesis-orphan scope question (Decision 5) is surfaced for human routing but did not block admission.

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen", "topic": "wrap the two mint writes with a --json refusal emitter" },
    { "marker": "chosen", "topic": "classify ledger-write failure (schema exit 1 / lock/other exit 3 / !written exit 3)" },
    { "marker": "chosen", "topic": "genesis-failure exit code = 3 (resolves open question)" },
    { "marker": "chosen", "topic": "genesis error detection: any throw is a failure" },
    { "marker": "chosen", "topic": "discard only an un-landed dir; genesis-failure dir left for FAFF-1305" },
    { "marker": "assumes", "topic": "discardUnmintedRunDir exported + lazy require is cycle-safe" },
    { "marker": "chosen", "topic": "generalise the shared helper message prefix to faff <command>" },
    { "marker": "chosen", "topic": "recordRunnerIdentity stays best-effort, outside the refusal path" },
    { "marker": "chosen", "topic": "auto-mint claimRunDir (line 1102) out of scope" },
    { "marker": "assumes", "topic": "plain .js modules; no .ts emit rebuild needed" }
  ]
}
```
