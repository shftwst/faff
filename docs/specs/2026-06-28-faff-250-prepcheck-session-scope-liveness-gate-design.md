# Spec: prepcheck session-scope + liveness gate (FAFF-250)

> Spec: faffter-dark-nlspec · 2026-06-28 · autonomous · confidence: high. Full spec on Linear FAFF-250.

This is the build spec for **FAFF-250**, addressed to the build agent and human reviewers. It ports the already-shipped `runcheck` session-scope + liveness fix (FAFF-205 → FAFF-233/235) onto the `prepcheck` Stop hook, so a parallel beep-boop run's in-flight prep markers no longer false-block an unrelated session at its Stop.

## 1. WHY — Problem and Principles

**Load-bearing model.** A Stop hook fires at the end of *every* session, including sessions that have nothing to do with the work a marker records. The only safe thing a Stop hook may hard-block on is work the **current session owns** or work that is **genuinely abandoned**. Everything else is someone else's live in-flight state and must be left alone (at most a non-blocking warning). `runcheck` already learned this; `prepcheck` has not.

**Problem statement.** `faff prepcheck --hook` audits every `.faff/prep/<ISSUE>.json` marker globally and emits a hard `{decision:"block"}` if *any* marker is `spec_produced && !attached`. A parallel `/faff-beep-boop` drain legitimately holds such markers mid-prep, so an unrelated session — which never produced that spec — is hard-blocked at Stop by foreign live work. This change gives `prepcheck` the same per-marker ownership + liveness gate `runcheck` has, so it blocks only on its own open markers or genuinely-abandoned ones.

**Design principles.**

- **Mirror runcheck exactly — do not invent a parallel model.** The ownership signals (`FAFF_RUN_DIR` / `FAFF_SESSION_ID`), the staleness window default (900s), the warn-vs-block ternary, and the "pid recorded but never consulted" rule (FAFF-233) are reused verbatim in shape. Divergence is a defect, not a feature.
- **Pure-function CLI invariant.** `prepcheck` must never call the tracker. Every signal it needs comes from the marker file, the optionally-referenced run ledger, and the process env. (Same invariant runcheck and the current prepcheck both hold.)
- **Fail safe to "don't hard-block a stranger."** Any ambiguity — a legacy marker with no owner, an unparseable ledger, a missing env signal — resolves toward *warn, never hard-block* (the FAFF-235 stance). A false warn costs a line of stderr; a false block strands an innocent session.
- **Don't lean on a signal known to go stale.** The marker is written once at produce and once at attach — it is never refreshed mid-prep, so a heartbeat field *on the marker* would age out during long sub-steps exactly like the ledger heartbeat did (the FAFF-234 confound). Liveness must come from signals that stay fresh.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (deps-free) | Hosts `runcheck` (the precedent: `runIsOwned` / `runIsHeld` / `runcheckHookDecision` / staleness consts) and `prepcheck` (`isPrepMarkerOpen` / `auditPrepMarkers` / `cmdPrepcheck`) — both edited here |
| `test/runcheck-gate.test.mjs` | Node test | The test shape to mirror for the new prepcheck gate |
| `test/prepcheck.test.mjs` | Node test | Existing prepcheck tests — extended, not replaced |
| `plugin/skills/faff-prep/SKILL.md` | Prose (skill) | Writes the marker at produce time — must be updated to stamp `owner` |
| `faff heartbeat` (FAFF-234, shipped) | Node | Keeps the *run ledger* `last_heartbeat` fresh during long sub-steps — the signal prepcheck delegates to for run-owned markers |

**Scope.** A robustness fix to one Stop hook's decision logic plus the marker schema it reads and the prep-side stamp that populates it. No change to what prepcheck is *for* (catching produced-but-unattached specs).

## 2. OUT OF SCOPE

- **A `faff prep-heartbeat` primitive (continuous marker refresh).** — *Why excluded:* the chosen liveness design (ledger-delegation + marker mtime) needs no new heartbeat path on the marker; adding one would re-import the FAFF-234 confound. *Extension point:* if mtime + ledger-delegation prove insufficient in practice, a `cmdPrepHeartbeat` mirroring `cmdHeartbeat` would write `owner.last_heartbeat` on the marker.
- **Changing runcheck.** — *Why excluded:* runcheck already has this gate; this issue only brings prepcheck up to parity. *Extension point:* `runcheck` code in the same file.
- **FAFF-234's "emit heartbeats during long sub-steps" work.** — *Why excluded:* that is the *run ledger's* fix and is tracked separately; prepcheck only *consumes* the ledger liveness it produces. *Extension point:* FAFF-234.
- **Cross-host liveness (a marker owned by a process on another machine).** — *Why excluded:* runcheck's model is same-host best-effort; pid is not consulted anyway. *Extension point:* `prepIsHeld` could gain a host check if faff ever runs distributed.
- **Migrating / backfilling existing ownerless markers.** — *Why excluded:* a legacy marker with no `owner` is treated as unowned → warn-not-block (the FAFF-235 legacy analogue), which is the safe behaviour with no migration needed. *Extension point:* none required.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **Owned marker** | A prep marker whose `owner` matches the current session (run-dir match or session-id match) |
| **Foreign marker** | A prep marker owned by a different (or no) session |
| **Held** | A foreign marker whose owner is judged still live (run ledger held, or marker mtime fresh) |
| **Open marker** | `spec_produced === true && attached !== true && disposition !== "parked"` (unchanged from today) |
| **Legacy marker** | A marker with no `owner` field (written before this change) → treated as unowned |

**Marker schema (extended).** The `owner` object is **additive and optional** — its absence means legacy/unowned. It mirrors the run-ledger owner stamp, minus `status`/`last_heartbeat` (the marker carries no heartbeat by design — see HOW).

```
RECORD PrepMarker:
  issue: string                 # e.g. "FAFF-250"
  spec_produced: boolean
  attached: boolean
  mode: "tracker" | "git-only"
  ts: ISO-8601 string
  disposition?: "parked"        # by-design non-attach
  owner?: Owner                 # NEW — absent ⇒ legacy/unowned

RECORD Owner:                   # mirrors the run-ledger owner stamp
  session_id?: string           # from FAFF_SESSION_ID at produce time
  run_dir?: string              # from FAFF_RUN_DIR at produce time (beep-boop runs only)
  pid?: number                  # from process.pid — RECORDED, never consulted in the decision (FAFF-233)
```

**Decision: marker `owner` stamp vs run-dir association (Open Question 1).** The marker carries an `owner` object **whose fields include `run_dir`** — it is not a choice between "owner field" and "run-dir association"; it is both, because the two serve different jobs. `session_id` answers *ownership* (is this my marker?); `run_dir` additionally lets a beep-boop marker *delegate its liveness* to its run ledger. An interactive marker has a `session_id` but no `run_dir` and falls back to mtime liveness. **Chosen:** add an `owner: { session_id, run_dir, pid }` object to the prep marker, stamped at produce time, with `run_dir` as a field of it (not a separate association mechanism). Rationale in §6.

**New / changed CLI surfaces.**

```
faff prepcheck --hook [--recover]    # gate; --recover forces block on a foreign abandoned marker (NEW flag)
faff prepcheck --selftest            # extended to cover the new ownership/liveness branches
faff prepcheck                       # plain report — unchanged (lists open issues, exit 3 if any)
```

Env consumed (all already defined by runcheck; reused, not invented):

```
FAFF_SESSION_ID                 # ownership match (session_id)
FAFF_RUN_DIR                    # ownership match (run_dir) + ledger liveness root
FAFF_RUN_HEARTBEAT_STALE_SECS   # staleness window for ledger-delegated liveness (runcheck's existing knob)
FAFF_PREP_MARKER_STALE_SECS     # NEW — staleness window for the marker-mtime liveness floor; default 900
```

**Decision: marker-mtime staleness default.** **Chosen:** default `FAFF_PREP_MARKER_STALE_SECS = 900` (15 min), reusing runcheck's `RUN_HEARTBEAT_STALE_SECS_DEFAULT` value for consistency; overridable via env. A separate constant (not a shared one) because the two windows measure different things (ledger heartbeat age vs marker file age) and may want independent tuning.

## 4. HOW — Behavior

**Architecture.** Three new pure helpers mirroring runcheck's, plus a rewired hook branch. The plain (non-hook) report path is untouched.

```
PROCEDURE prepIsOwned(marker, env):
  o = marker.owner
  IF NOT o: RETURN false                                    # legacy/unowned
  IF env.FAFF_RUN_DIR AND o.run_dir
       AND resolve(env.FAFF_RUN_DIR) == resolve(o.run_dir): RETURN true
  IF o.session_id AND env.FAFF_SESSION_ID
       AND o.session_id == env.FAFF_SESSION_ID:             RETURN true
  RETURN false
```

```
PROCEDURE prepIsHeld(marker, markerMtimeMs, nowMs, env):
  # Tier (a): delegate to the owning run ledger when one is referenced (FAFF-234-fresh signal)
  o = marker.owner
  IF o AND o.run_dir:
     ledger = tryReadLedger(o.run_dir)                       # parse error / missing → null, do not throw
     IF ledger AND runIsHeld(ledger, nowMs, env): RETURN true
  # Tier (b): marker-mtime floor — fresh file ⇒ presumed live
  ageSecs = (nowMs - markerMtimeMs) / 1000
  IF ageSecs <= prepMarkerStaleSecs(env): RETURN true
  RETURN false                                               # no live ledger AND stale mtime ⇒ abandoned
```

**Behavior summary — the hook decision.** For each *open* marker, decide independently: my own open marker hard-blocks (the FAFF-178 backstop is preserved for the owning session); a foreign open marker that is held stays silent; a foreign open marker that is *not* held warns (never hard-blocks) unless `--recover` is set, which forces the block for deliberate human recovery.

```
PROCEDURE prepcheckHookDecision(openMarkers, nowMs, env, opts):
  blockIssues = [];  warnIssues = []
  FOR each m in openMarkers:                                 # openMarkers already filtered by isPrepMarkerOpen
     owned = prepIsOwned(m, env)
     IF owned:
        blockIssues.push(m.issue)                            # my own open marker → block (backstop)
        CONTINUE
     held = prepIsHeld(m, mtime(m), nowMs, env)
     IF held:        CONTINUE                                # foreign + live → silent
     IF opts.recover: blockIssues.push(m.issue)              # foreign + abandoned + --recover → block
     ELSE:            warnIssues.push(m.issue)               # foreign + abandoned → warn, NOT block
  RETURN { block: blockIssues, warn: warnIssues }
```

```
PROCEDURE cmdPrepcheck(--hook branch):
  markers = readPrepMarkers()                                # unchanged loader; tolerates malformed (skips)
  open    = markers.filter(isPrepMarkerOpen)
  d = prepcheckHookDecision(open, Date.now(), process.env, { recover: args.includes("--recover") })
  IF d.block.length: console.log(JSON.stringify({ decision: "block", reason: prepReason(d.block) }))
  ELSE IF d.warn.length: process.stderr.write(`[warn] ${prepReason(d.warn)}\n`)   # non-blocking
  RETURN 0                                                   # block is via payload, never exit code (as today)
```

**Edge cases.**

- **Legacy marker (no `owner`).** `prepIsOwned` → false; `prepIsHeld` tier (a) skipped (no `run_dir`); falls to mtime. A fresh legacy marker is held (silent); a stale legacy marker is foreign-abandoned → **warn, not block** (the FAFF-235 legacy-ledger analogue). Never a hard-block on a legacy marker the current session doesn't own.
- **Both block and warn issues present.** Block wins precedence for the emitted decision (a block payload is emitted); warn issues are folded into nothing extra (the human is already being stopped). Optionally append warn issues to the block reason — non-load-bearing; either is acceptable.
- **`owner.run_dir` points at a deleted/rotated run dir.** `tryReadLedger` returns null → tier (a) no-op → mtime decides. Never throws.
- **Malformed ledger JSON at `owner.run_dir`.** Same as above — caught, treated as no live ledger (mirrors runcheck's `readLedger`-throws → silent handling).
- **Marker file mtime unreadable (race: deleted between scan and stat).** Treat as stale (age = ∞) → falls to the foreign-abandoned path; since it's also likely no longer open, the realistic outcome is it drops out of `open` first. Must not throw.
- **`disposition:"parked"` or `attached:true` marker.** Filtered out by `isPrepMarkerOpen` before the decision — never reaches ownership/liveness logic (unchanged).

**Failure modes.**

- **The failure:** marker mtime is *also* a stale signal during a single genuinely-long interactive prep (no `run_dir` to delegate to), so a >15-min single prep on the owning session is fine (owned → block regardless of liveness), but a foreign >15-min interactive prep would flip from held→abandoned and warn. **How you'd know:** a warn (not a block) surfaces for a foreign interactive marker that later self-resolves. **What it means:** acceptable — it only ever *warns*, never false-blocks; the FAFF-235 stance holds. Proceed.
- **The failure:** `FAFF_SESSION_ID` not set in the owning session's env at produce time, so the stamp has no `session_id` and an interactive session can't recognise its *own* marker later. **How you'd know:** the owning session warns about its own unattached spec instead of blocking. **What it means:** degrades to warn (safe direction, not a false block); the run-dir path still covers beep-boop. Proceed; note the env dependency in DONE.
- **The failure:** the whole premise — that mtime + ledger-delegation distinguishes live from abandoned — doesn't hold because some third in-flight state ages out both. **How you'd know:** a real produced-but-dropped spec gets only a warn and is silently lost. **What it means:** `--recover` is the escape hatch (forces the block); if it recurs, escalate to a marker heartbeat (the OUT-OF-SCOPE extension). Name it, don't hide it.

**Anti-pattern:** adding a `last_heartbeat` field to the prep marker and refreshing it on a timer. Why: the marker is written twice (produce, attach), never on a timer, so it reproduces the exact FAFF-234 staleness confound this spec exists to avoid — liveness must delegate to the ledger (kept fresh by FAFF-234) or use file mtime, not a self-stale marker field.

**Anti-pattern:** consulting `owner.pid` in the decision. Why: FAFF-233 proved a dead recorded pid wrongly overrides a fresh liveness signal; pid is recorded for forensics only.

**Anti-pattern:** whole-batch block (block if *any* open marker is foreign-abandoned, regardless of the others). Why: markers are issue-scoped and independent — the decision is per-marker, mirroring how runcheck decides per-ledger.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a prep marker owned by the current session (FAFF_SESSION_ID matches owner.session_id), open (spec_produced, !attached)
When `faff prepcheck --hook` runs at Stop
Then it emits {decision:"block"} naming that issue        # owning-session backstop preserved (FAFF-178)
```

```
Given a foreign open marker whose owner.run_dir references a run ledger that is held (status running + fresh heartbeat)
When `faff prepcheck --hook` runs
Then it emits no block and no warn (silent)               # foreign + live → leave it (FAFF-205/235)
```

```
Given a foreign open marker with no live ledger but a file mtime within FAFF_PREP_MARKER_STALE_SECS
When `faff prepcheck --hook` runs
Then it is silent (mtime floor judges it live)            # the observed-confound case: stale ledger HB, fresh mtime
```

```
Given a foreign open marker that is abandoned (no live ledger AND mtime older than the staleness window)
When `faff prepcheck --hook` runs without --recover
Then it writes a one-line [warn] to stderr and emits NO block   # warn, don't block (FAFF-235)
And When the same is run WITH --recover
Then it emits {decision:"block"} for that issue           # deliberate human recovery
```

```
Given a legacy open marker with no owner field, mtime older than the staleness window, not owned by the current session
When `faff prepcheck --hook` runs without --recover
Then it warns, never hard-blocks                          # legacy = unowned, fail-safe
```

```
Given a marker recording owner.pid that is dead, but whose run ledger has a fresh heartbeat
When `faff prepcheck --hook` runs
Then it is held/silent (pid not consulted)                # FAFF-233 invariant
```

## 6. DESIGN DECISION RATIONALE

**Open Question 1 — add `owner`/`session_id` to the marker, or associate markers with the owning run dir?**

- *Marker owner stamp only:* self-contained; works for interactive markers (no run dir); but a marker is never refreshed, so it can't carry liveness.
- *Run-dir association only:* gives liveness for free via the ledger, but interactive `/faff-prep` has no run dir, so its markers couldn't be owned at all.
- *Both — owner object whose fields include run_dir:* `session_id` carries ownership for every marker (interactive included); `run_dir` additionally enables ledger-delegated liveness for beep-boop markers. Exactly mirrors the run-ledger owner stamp, so the helpers are twins of runcheck's.

**Chosen:** add `owner: { session_id, run_dir, pid }` to the prep marker, with `run_dir` a field of the owner object — both mechanisms, each doing the job the other can't. Rationale: it is the only option that covers both interactive and beep-boop markers *and* supplies a non-stale liveness signal, while keeping prepcheck a pure-function mirror of runcheck.

**Open Question 2 — how does the liveness gate avoid the FAFF-234 heartbeat confound?**

- *Marker heartbeat field:* rejected — the marker isn't refreshed during long sub-steps, so it reproduces the confound.
- *Ledger heartbeat only:* the very signal that read stale (17:33) while the run was live (mtimes to 17:49+) in the observed incident — insufficient alone.
- *Marker mtime only:* catches the observed case, but a genuinely-long single foreign prep could age out.
- *Ledger-delegation OR marker mtime (two-tier):* the ledger path reuses FAFF-234's kept-fresh signal for run-owned markers; the mtime floor catches exactly the observed confound (stale ledger HB but fresh file) and covers interactive markers with no ledger. A marker is held if *either* says live.

**Chosen:** two-tier `prepIsHeld` = `(owner.run_dir ⇒ runIsHeld(its ledger))` **OR** `(marker mtime within FAFF_PREP_MARKER_STALE_SECS)`; `pid` recorded but never consulted (FAFF-233). Rationale: belt-and-braces across the two independent freshness signals directly neutralises the documented confound, and reuses the already-fixed ledger heartbeat rather than inventing a second signal that would go stale.

**Chosen:** the hook decision is **per-marker**, mirroring runcheck's per-ledger ternary, with `--recover` as the deliberate-human-recovery override and block-via-payload (never exit code) — consistency with the runcheck gate the codebase already ships.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. Both issue-listed open questions are settled above with `**Chosen:**` decisions, as the issue required.

**Assumptions.**

- **Assumes:** `runIsHeld`, `readLedger` (or its throwing equivalent), and the `RUN_HEARTBEAT_STALE_SECS` env plumbing exist and are exported/reachable within `bin/faff` for `prepIsHeld` to call. *Validation:* grep `bin/faff` for `function runIsHeld` and `function runIsOwned`; confirm they are module-scope functions in the same file (they are, per explore findings) before reusing — if refactored behind a closure, hoist or duplicate the staleness helper.
- **Assumes:** the Stop-hook subprocess inherits `FAFF_SESSION_ID` / `FAFF_RUN_DIR` from the session env (runcheck already relies on this). *Validation:* confirm `faff runcheck --hook` reads these from `process.env` in the same file; the prep stamp and prepcheck read the same vars.
- **Assumes:** `faff-prep` writes the marker at produce time and can read `FAFF_SESSION_ID` / `FAFF_RUN_DIR` / `process.pid` at that moment. *Validation:* the prep marker write is prose-driven in `faff-prep/SKILL.md`; the spec's DONE includes updating that prose to stamp `owner`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A foreign, live, in-flight open prep marker no longer produces a `{decision:"block"}` from `faff prepcheck --hook` (the FAFF-250 regression case).
- [ ] An owning session's own produced-but-unattached spec still hard-blocks at Stop (FAFF-178 backstop preserved).

### From WHAT (schema + surfaces)
- [ ] The prep marker may carry `owner: { session_id, run_dir, pid }`; absence is tolerated as legacy/unowned (no crash, no migration).
- [ ] `faff-prep/SKILL.md` marker-write step stamps `owner` from `FAFF_SESSION_ID` / `FAFF_RUN_DIR` / `process.pid` at produce time (before render), in both interactive and autonomous paths.
- [ ] `faff prepcheck --hook --recover` exists and forces a block on a foreign abandoned marker.
- [ ] `FAFF_PREP_MARKER_STALE_SECS` is read with a 900s default.

### From HOW (behaviour)
- [ ] `prepIsOwned` returns true on run_dir match OR session_id match, false on a marker with no `owner`.
- [ ] `prepIsHeld` returns true when the referenced run ledger is `runIsHeld`, OR when marker mtime is within the staleness window; false only when neither holds.
- [ ] `prepcheckHookDecision` is per-marker: owned+open → block; foreign+held → silent; foreign+not-held+open → warn; `--recover` → block.
- [ ] Block is emitted as a stdout JSON payload; warn is a one-line `[warn] …` on stderr; neither uses the exit code (exit 0 in `--hook`).

### From HOW (edge cases)
- [ ] `owner.pid` is never read in any decision branch (FAFF-233 invariant) — verified by a dead-pid + fresh-heartbeat → silent test.
- [ ] A missing/malformed ledger at `owner.run_dir` is caught (null), falling through to mtime — never throws.
- [ ] A legacy ownerless stale marker warns, never hard-blocks (FAFF-235 analogue).

### From tests
- [ ] `test/prepcheck.test.mjs` extended with node --test cases mirroring `runcheck-gate.test.mjs`: owned-open→block, foreign+held→silent, foreign+mtime-fresh→silent, foreign+abandoned→warn, `--recover`→block, legacy-no-owner→warn, ledger-delegated liveness, pid-not-consulted.
- [ ] `faff prepcheck --selftest` extended to exercise the new ownership/liveness branches and passes.
- [ ] Existing prepcheck tests (block-on-unattached for the owning case, silent-on-attached, parked→no-block, malformed-skipped) still pass.

**Integration smoke test.**

```
1. mkdir a fake run dir with a held ledger (status running, last_heartbeat = now); export FAFF_RUN_DIR to it.
2. Write a prep marker owned by that run_dir, open (spec_produced, !attached).
3. In a DIFFERENT env (unset FAFF_RUN_DIR/FAFF_SESSION_ID), run `faff prepcheck --hook`.
   → expect: no stdout block, no stderr warn (foreign + held → silent).
4. Re-stat the ledger heartbeat to 30 min ago AND touch the marker mtime to 30 min ago; re-run step 3.
   → expect: stderr `[warn] …`, NO stdout block (foreign + abandoned → warn).
5. Re-run step 4 with `--recover`.
   → expect: stdout `{decision:"block", reason: …}` (deliberate recovery).
```

## Methodology critique

(agile-delivery lens, `issue-critique`)

- **Right-sized?** Yes — a single 1–3 day unit: three pure helpers + one rewired branch + a schema-additive stamp + tests, all in one file plus one prose edit. No split warranted; the prep-side stamp and the CLI gate always ship together (the gate is inert without the stamp), so they must not be split.
- **Workstream fit?** Clean — completes the session-scope hardening of the Stop-hook family (`runcheck` done; `prepcheck` is the remaining sibling). Same project ("A newcomer can adopt faff unaided" — fewer spurious blocks).
- **Deps surfaced?** Reuses shipped FAFF-234 (`faff heartbeat` / `runIsHeld`); no blocking dep (FAFF-234's "heartbeat during long sub-steps" improves but is not required for this to be correct, since the mtime floor covers the gap). No missing blocker edge.
- **Risk profile?** Low — mirrors a shipped, tested precedent in the same file; the dominant risk (mtime also going stale) is bounded to *warn, never false-block* and has `--recover` as the escape hatch. No de-risking spike needed.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
