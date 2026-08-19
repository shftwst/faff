# nlspec — FAFF-858: one top-level L4 ledger, reused end-to-end

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-858.

This spec is the buildable design for **FAFF-858** — "L4 plan branch mints a fresh ledger instead of adopting the handed-off `FAFF_RUN_DIR`." It is written for the build agent that will implement the change and for the human reviewers gating it. It **replaces** the earlier "adopt the armed ledger" design: per the binding architecture decision of 2026-08-19 ("one top-level L4 ledger"), there is **no adopt verb, no `armed` owner marker, and no epoch-takeover** for this work. The drain simply **reuses** the inherited ledger.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** Under the L4 lights-out signal there must be exactly **one** run-ledger for the whole run: the operator mints it once in cage-1, hands its directory off through `FAFF_RUN_DIR`, and every downstream actor — `faff-beep-boop`, a nested `/faff-plot --autonomous`, the disposition read — points at *that same directory*. Nothing downstream mints a second ledger. What a later stage *discovers* about the run (the PRD's creative licence, the resolved root container) is written **onto** that one ledger through a narrow, lock-guarded field update, never by minting again.

**Problem statement.** Today `faff-beep-boop` §0a step 7 calls `faff lights-out` **again** — a fresh mint — in *both* the `plan` and `drain` branches (and the `plan` branch first invokes `/faff-plot --autonomous`, which self-mints its *own* L4 ledger), so the cage-1 run-dir the operator captured is never the ledger that actually drains. The consequences are that `faff disposition --run-dir "$run_dir"` on the captured dir returns nothing, orphan `owner.status:"running"` ledgers pile up, and "read the newest ledger" is unsafe because several unclosed ledgers coexist. This change makes the inherited `FAFF_RUN_DIR` the single ledger everywhere, records discovered PRD facts onto it under the lock, and makes both the reuse and the disposition read fail loud rather than guess.

**Design principles** (each would cause an otherwise-valid implementation to be rejected):

**One mint per run.** `faff lights-out` is the *only* mint. `faff-beep-boop` §0a and a nested plot Ignition must never call `faff lights-out` (nor any re-mint path) when a valid inherited L4 ledger exists. A second `owner.status:"running"` ledger for the same run is the exact defect this closes.

**Discovered facts are written, not re-minted.** The PRD creative-licence and root container are resolved *after* the operator's blind mint, so they land on the existing ledger through the single locked mutation core (`mutateLedgerUnderLock`), never by creating a new ledger that happens to also carry them.

**Fail loud on a bad handoff; never guess.** A set-but-invalid or foreign `FAFF_RUN_DIR` aborts loudly instead of silently minting over it or dropping to L3. The operator-facing disposition read keeps only the explicit `--run-dir` → `$FAFF_RUN_DIR` precedence and **removes** the newest-ledger fallback — no "read the newest `*-lights-out`" guess of any kind.

**Reuse is not takeover.** The drain (and nested plot) share the *same* run identity and the *same* owner as the operator's mint; they do not bump the owner epoch and do not go through the `--resume` re-entry path. The FAFF-527 epoch-takeover primitive stays reserved for a genuine same-run re-entry, which this work does not introduce.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` (§0a, ~L138) | Skill prose | Primary fix site — the two mint branches at step 7 |
| `plugin/skills/faff/bin/lib/lights-out.js` (`mintLightsOut` L959, ledger L1037-1060) | JavaScript | The one mint; the two PRD-flag validators to reuse |
| `plugin/skills/faff/bin/lib/heartbeat.js` (`mutateLedgerUnderLock` L307, `ownerEpochFenceStale` L262) | JavaScript | The single locked mutation core the narrow update builds on |
| `plugin/skills/faff/bin/lib/disposition.js` (`cmdDisposition` L295-304) | JavaScript | The `latestRunDir` fallback to remove |
| `plugin/skills/faff-plot/SKILL.md` (Ignition, ~L188) | Skill prose | Nested-reuse vs standalone-mint decision |
| `plugin/skills/faff/bin/lib/config.js` (`resolveAppetite` L497, `resolveConvergence` L536) | JavaScript | Readers that must keep reading the single live ledger |
| `plugin/skills/faff/bin/lib/run-ledger.js` (`isLiveHigherLevel` L87) | JavaScript | Mint-guard reader — confirm unaffected |
| `docs/guide/unattended.md` (disposition contract L101-110; "Going lights-out" L161) | Markdown | The doc surface to update |

**Scope statement.** This sits at the L4 lights-out run-start seam — the boundary between the operator's mint and the unattended drain — and touches only how that one ledger is reused and read, not how it is minted or what preflight it must pass.

---

## 2. OUT OF SCOPE

- **The adopt verb / `armed` owner marker / handoff-token / epoch-takeover adoption mechanism** — explicitly discarded by the 2026-08-19 human decision. Extension point: none — this punt is closed; do not reintroduce it in `lights-out.js` or `resume.js`.
- **Auto-closing an un-drained or refused inherited ledger** (leaving it `owner.status:"running"`). Why excluded: ledger lifecycle-close is its own decision. Extension point: **FAFF-797** ("Decide + implement ledger auto-close for a merged-but-unclosed run"). This spec leaves the single ledger's close semantics unchanged.
- **The broken run-dir capture snippet in `unattended.md`** (the `sed`/`jq` idiom that can yield an empty `FAFF_RUN_DIR`). Why excluded: that is a shell-idiom fix, tracked separately. Extension point: **FAFF-807**. Note the interaction below (an *empty* `FAFF_RUN_DIR` is indistinguishable from unset and stays the L3 path; only a *non-empty* invalid value faults).
- **Same-run re-entry / resume of a failed or aborted run** (`faff lights-out --resume`). Why excluded: reuse is not re-entry. Extension point: **FAFF-527** and the existing `resumeLightsOut` path — untouched here.
- **`resolveAppetite` honouring a stale/done L4 ledger** (FAFF-378). Why excluded: a separate liveness bug; reuse does not change owner/liveness semantics. Extension point: FAFF-378.
- **Changing the `prd`/coverage/run-start signal producers** or the ladder taxonomy. Why excluded: this change is pure wiring around an unchanged `faff run-start` verdict. Extension point: the run-start contract.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Inherited ledger | The one L4 run-ledger the operator minted in cage-1, whose directory is exported as `FAFF_RUN_DIR` to the drain. |
| Reuse | Pointing a downstream actor at the inherited ledger as its own run ledger, sharing run-id and owner — no mint, no epoch bump, no resume. |
| Narrow PRD update | A lock-guarded write of *only* `prd_creative_licence` and/or `prd_root_container` onto an already-minted ledger. |
| Foreign `FAFF_RUN_DIR` | A non-empty `FAFF_RUN_DIR` that does not resolve to a valid L4 lights-out ledger (see the validity classifier). |
| Lights-out run-id shape | A run-id of the form `run-<YYYYMMDD-HHMMSS>-lights-out`, optionally with a `-<hex6>` collision suffix. |

**The inherited-ledger validity classifier.** A new pure resolver decides what a given `FAFF_RUN_DIR` means for §0a. It returns exactly one of three outcomes:

```
ENUM InheritedRunDirVerdict:
  not-l4          # no L4 signal — skip §0a, run the unchanged L3 path
  inherited-l4    # a valid L4 lights-out ledger to reuse
  fault           # invalid/foreign FAFF_RUN_DIR — fail loud, drain nothing

FUNCTION classify_inherited_run_dir(env, root) -> { verdict, runDir?, ledger?, reason }:
  raw := env.FAFF_RUN_DIR
  IF raw is unset OR raw is the empty string:
      RETURN { verdict: not-l4, reason: "no FAFF_RUN_DIR" }        # unchanged L3 path
  IF NOT exists(join(raw, "run-ledger.json")):
      RETURN { verdict: fault, reason: "FAFF_RUN_DIR names a dir with no run-ledger.json" }
  ledger := parse(raw/run-ledger.json)  OR-ON-PARSE-ERROR:
      RETURN { verdict: fault, reason: "FAFF_RUN_DIR ledger is unreadable/unparseable" }
  IF ledger.level != "L4":
      RETURN { verdict: not-l4, reason: "inherited ledger is not L4" }   # legit nested L3
  IF NOT matches_lights_out_shape(ledger.run_id OR basename(raw)):
      RETURN { verdict: fault, reason: "L4 ledger is not a lights-out mint (foreign run-dir)" }
  RETURN { verdict: inherited-l4, runDir: raw, ledger }
```

- `matches_lights_out_shape(id)` accepts `^run-\d{8}-\d{6}-lights-out(-[0-9a-f]{6})?$` — the byte-identical mint id (`lights-out.js:989`) plus the `claimRunDir` collision suffix (`lights-out.js:948-949`).
- **"Foreign" is defined precisely** as: `FAFF_RUN_DIR` set non-empty **and** (the dir has no ledger, **or** the ledger is unparseable, **or** the ledger is `level:"L4"` but its run-id is not the lights-out shape). A *readable non-L4* ledger is **not** foreign — it is the legitimate nested-L3 case and yields `not-l4` (preserving today's level-gated §0a skip, `SKILL.md:160`). An empty-string `FAFF_RUN_DIR` is indistinguishable from unset and stays `not-l4` (the FAFF-807 empty-capture symptom is out of scope here).
- Contrast with today: `guardCandidateDir`/`readLedgerSafe` (`run-ledger.js:104,113`) and `resolveAppetite` (`config.js:518`) are **fail-safe-to-ignore** — a foreign/malformed ledger is silently skipped. This classifier is the *opposite* for the §0a seam: a non-empty invalid value faults.

**Design decision — is a readable non-L4 `FAFF_RUN_DIR` a fault or a skip?** Options: (a) fault on any non-empty `FAFF_RUN_DIR` that is not a valid L4 lights-out ledger; (b) fault only on unreadable/foreign-L4, treat a readable non-L4 ledger as the legit nested-L3 skip. Option (a) is louder but regresses any L3 `faff-beep-boop` that runs inside a shell carrying an inherited L3 `FAFF_RUN_DIR` (the level-gated skip at `SKILL.md:160` exists precisely for that), and `resolveAppetite`/`resolveConvergence` already tolerate a non-L4 `FAFF_RUN_DIR` by design. **Chosen:** Option (b) — fault only on invalid/foreign-L4; a readable non-L4 ledger is `not-l4` (skip §0a). This keeps the fail-loud surface tight to genuinely bad L4 handoffs and cannot break an L3 run.

**The narrow PRD-record command.** A new `faff` subcommand `faff run-record-prd` writes the discovered PRD facts onto the inherited ledger through the single locked core. It reuses the existing mint-side validators verbatim.

```
faff run-record-prd [--run-dir DIR] --prd-creative-licence broad|tight
                     [--prd-root-container C] [--json]

  --run-dir DIR              default: $FAFF_RUN_DIR; required to resolve (else exit 3)
  --prd-creative-licence     validated by prdCreativeLicenceFromFlag (lights-out.js:641):
                             only "broad"/"tight" else fail loud (exit 2)
  --prd-root-container C      validated by prdRootContainerFromFlags (lights-out.js:654):
                             requires --prd-creative-licence; non-empty; else fail loud (exit 2)
  --json                     machine-readable result

Exit contract:
  0  written, or idempotent no-op (same values already on the ledger)
  2  bad flag value, or the resolved ledger is not level:"L4"
  3  no ledger resolvable (no --run-dir / $FAFF_RUN_DIR, or its run-ledger.json is absent)
  4  owner-epoch fence yielded (a newer owner moved on) — loud, nothing written
```

The lib function behind it:

```
FUNCTION record_prd_on_ledger(runDir, { licence, rootContainer }):
  # validation read (outside the lock) captures the owner to fence against
  pre := classify_inherited_run_dir({ FAFF_RUN_DIR: runDir }, root)
  IF pre.verdict != inherited-l4: fail loud per exit contract
  expectedOwner := { epoch: pre.ledger.owner.epoch ?? 0,
                     session_id: pre.ledger.owner.session_id }
  RETURN mutateLedgerUnderLock(runDir, (fresh) => {
           IF fresh.level != "L4": THROW  # loud; never write onto a non-L4 ledger
           IF licence != null:        fresh.prd_creative_licence = licence
           IF rootContainer != null:  fresh.prd_root_container   = rootContainer
           RETURN fresh
         }, expectedOwner)
```

- The write goes through **`mutateLedgerUnderLock`** (`heartbeat.js:307`) — the one critical section every production ledger mutation uses — so it read-merge-writes under `run-ledger.json.lock` and cannot clobber a concurrent write.
- The **`expectedOwner` fence** (`ownerEpochFenceStale`, `heartbeat.js:262`) is passed with the owner *read from the validated inherited ledger*. On a never-resumed operator mint the epoch is absent (→ default 0) and `session_id` is the minted value; the under-lock fresh read matches, so the write proceeds. If a genuine `--resume` advanced the epoch between validation and write, the fence **yields loudly** (no write) — this is how a foreign process cannot stamp the ledger. `session_id` matches because the value is read from the ledger, not from the drain process's own environment.
- **Idempotent:** writing the same licence/container is a byte-stable re-write; re-running the command is safe (the plan branch may write the root container from plot *and* the licence from beep-boop in either order).

**Design decision — new command vs a `lights-out --record-prd` flag.** Options: fold the field write into `faff lights-out` behind a flag, or a dedicated verb. Folding it risks the exact confusion this ticket fixes (an operator/agent believing `lights-out` = mint), and `lights-out`'s `cmdLightsOut` is already a mint/resume dispatcher. **Chosen:** a dedicated `faff run-record-prd` in the `run-*` lifecycle family (alongside `run-start`, `run-outward`, `run-done`), reusing `prdCreativeLicenceFromFlag`/`prdRootContainerFromFlags` and `mutateLedgerUnderLock` — narrow, single-purpose, and impossible to mistake for a mint.

---

## 4. HOW — Behavior

### `faff-beep-boop` §0a — reuse the inherited ledger (both branches)

**Summary.** §0a stops minting entirely. It first classifies `FAFF_RUN_DIR`; on `inherited-l4` it runs the existing signal assembly (steps 1–6, unchanged), then at step 7 it *records* the discovered PRD facts onto the inherited ledger and falls through — no `faff lights-out` call in either branch.

The §0a guard (`SKILL.md:140`) changes from "detect `level:"L4"` then mint" to:

```
PROCEDURE beep_boop_section_0a(env, root):
  v := classify_inherited_run_dir(env, root)
  1. IF v.verdict == fault:
       print v.reason loudly to stderr; EXIT non-zero; drain nothing.   # fail-loud handoff
  2. IF v.verdict == not-l4:
       skip §0a entirely; continue to step 1 (tidy) as an ordinary L3 run.  # unchanged
  3. # v.verdict == inherited-l4 — reuse mode. runDir := v.runDir (the ONE ledger)
     assemble RunTriggerSignals (steps 1-6, unchanged reads)
     verdict := faff run-start --signals { ... }        # unchanged decision owner
     BRANCH verdict.verdict:
       plan   -> reuse_plan_branch(runDir, creative_licence, container)
       drain  -> reuse_drain_branch(runDir, creative_licence, container)
       refuse -> record + surface verdict.reason; STOP §0a; drain nothing (see refuse below)
```

**`drain` branch** (was: `faff lights-out --prd-creative-licence <value>`):

```
PROCEDURE reuse_drain_branch(runDir, creative_licence, container):
  1. IF creative_licence != null OR (PRD present AND container != null):
       faff run-record-prd --run-dir runDir
            --prd-creative-licence <creative_licence>
            [--prd-root-container <container>]   # only when a PRD container was resolved
       # a non-zero exit here is fail-loud: STOP, surface, drain nothing
  2. # no PRD / no-prd-nothing-to-plan: creative_licence == null -> skip the record (no-op)
  3. fall through to step 1 (tidy) and the ordinary pipeline, driven by runDir
```

**`plan` branch** (was: invoke plot which self-mints, then mint a SECOND ledger):

```
PROCEDURE reuse_plan_branch(runDir, creative_licence, container):
  1. invoke /faff-plot --autonomous against the resolved target
     # plot INHERITS the same FAFF_RUN_DIR and REUSES runDir (nested Ignition, below) —
     #   it self-mints NOTHING; it records the resolved root container onto runDir.
  2. re-read coverage (same call as step 6), logged for the run record
  3. IF creative_licence != null:
       faff run-record-prd --run-dir runDir --prd-creative-licence <creative_licence>
                           [--prd-root-container <container>]
  4. # NO faff lights-out here — the "mint the build run's own ledger / never reuse plot's
  #   decompose-pass ledger" instruction is DELETED. There is one ledger: runDir.
  5. fall through to step 1 (tidy) -> prep queue -> build, in this same run (converge, don't stop)
```

**Anti-pattern:** calling `faff lights-out` (mint) anywhere in §0a. Why: it re-creates the exact orphan-ledger defect — a second `owner.status:"running"` ledger the operator's captured run-dir is not.

**Anti-pattern:** `env -u FAFF_RUN_DIR faff lights-out ...` exploratory probes inside the drain (the P1 finding). Why: each mints a spare orphan ledger. The build agent must not introduce or leave such probes; the reuse path needs no mint.

### `/faff-plot --autonomous` Ignition — nested reuse vs standalone mint

**Summary.** Plot's Ignition (`faff-plot/SKILL.md:195`) currently *always* self-mints. It must first classify `FAFF_RUN_DIR`; when a valid inherited L4 ledger exists (the nested case, e.g. invoked by beep-boop's plan branch) it **reuses** that ledger and records the resolved target onto it; only when none exists (the standalone case, bare `/faff-plot --autonomous`) does it self-mint as today.

```
PROCEDURE plot_ignition(env, root):
  resolve TargetRef {container, repo, source}     # unchanged, live reads
  resolve SelfRef; compute outward signal         # unchanged
  v := classify_inherited_run_dir(env, root)
  IF v.verdict == fault:
       REFUSE ignition loudly (zero writes); surface; STOP.     # foreign handoff
  IF v.verdict == inherited-l4:
       runDir := v.runDir                          # NESTED: reuse, no self-mint
       IF TargetRef.container != null:
           faff run-record-prd --run-dir runDir
                --prd-creative-licence <inherited or resolved licence>
                --prd-root-container <TargetRef.container>
           # records prd_root_container onto the ONE ledger; requires the licence flag —
           # pass the inherited ledger's prd_creative_licence if already set, else the
           # run-start-resolved value (never mint to carry it)
  ELSE:  # not-l4 — STANDALONE
       runDir := self-mint an L4 run-ledger via the existing lights-out preflight  # unchanged
  assert via faff run-start --signals { target_resolved, outward, ... }   # unchanged
  # proceed to the gate->verdict seam using runDir as prd_root_container's ledger
```

- Plot **inherits `FAFF_RUN_DIR` directly** (the plainest mechanism — `config.js:502` documents that `FAFF_RUN_DIR` is inherited by beep-boop subagents). No `.faff/plot-rundir` pointer is introduced (it does not exist in the codebase; it appears only in FAFF-858 comments).
- **Edge — recording the root container requires a licence flag.** `prdRootContainerFromFlags` (`lights-out.js:654`) rejects a container without a licence. In the nested case plot passes the licence already known to the run (the inherited ledger's `prd_creative_licence` if set, else the run-start-resolved value). If neither is available, plot **skips the record** (leaves `prd_root_container` as-is) rather than fail — the gate→verdict seam still resolves the target from live reads. This skip is **born-verifiable, not a silent drop:** plot exits Ignition **cleanly (no non-zero exit, no `run-record-prd` call)** and emits one observable skip line — `plot: prd_root_container record skipped — no creative-licence resolved yet` — to the plot Ignition log (`.faff/runs/<runDir>/plot-decompose.log.md`) and stderr, so a reviewer can tell "deliberately skipped" from "wrote nothing by mistake." A skip and a successful record are distinguishable by the presence of that log line plus the ledger's `prd_root_container` (unchanged on skip, set on record).

### `faff disposition` — drop the newest-ledger fallback

**Summary.** `cmdDisposition` keeps only the explicit `--run-dir` → `$FAFF_RUN_DIR` precedence and removes the `latestRunDir(root)` fallback; when neither is supplied it fails explicitly.

```
# disposition.js:300, was:
#   const runDir = explicit || process.env.FAFF_RUN_DIR || latestRunDir(root);
# becomes:
const runDir = explicit || process.env.FAFF_RUN_DIR || null;
# the existing guard at :301 then fires:
if (!runDir || !exists(runDir/run-ledger.json)):
    stderr("faff disposition: no run dir / no run-ledger.json (pass --run-dir DIR)"); return 3;
```

- The explicit `--run-dir`-honoured-as-is behaviour (`disposition.js:296-298`) and the malformed-ledger exit 2 (`:308-310`) are **unchanged**. Only the newest-ledger guess is removed. The `root` local is now used only by `findRoot()` for the read helpers; drop it from the resolution line (keep wherever else it is still consumed, or remove if unused, to satisfy lint).
- **Anti-pattern:** replacing `latestRunDir` with a newest-`*-lights-out` glob. Why: the human decision forbids *any* newest-ledger guess; the issue's alternative fix ("read the newest `*-lights-out` automatically") is explicitly rejected.

### Edge cases and error handling

- **`FAFF_RUN_DIR` unset/empty** → `not-l4` → unchanged L3 path (no fault). Preserves faff's own nightly L3 self-drain.
- **`FAFF_RUN_DIR` set, dir/ledger absent or unparseable** → `fault` → §0a and plot Ignition fail loud; disposition returns exit 3.
- **`FAFF_RUN_DIR` set to a readable non-L4 ledger** → `not-l4` (legit nested L3), not a fault.
- **`FAFF_RUN_DIR` set to an L4 ledger with a non-lights-out run-id** → `fault` (foreign).
- **Concurrent resume during the drain** → `run-record-prd`'s owner-epoch fence yields loudly (exit 4), nothing written; the resumed owner's ledger is untouched.
- **`refuse` verdict with a pre-minted inherited ledger** → §0a records and surfaces the closed `reason` for `/faff-wtf` and stops without draining. The inherited ledger is the operator's single mint; §0a does not close it (lifecycle-close is FAFF-797). This is not the historical orphan-pile-up — there is exactly one ledger, the one the operator chose to mint.

### Failure modes

- **The failure:** the owner-epoch fence rejects a *legitimate* reuse write because the drain process's `session_id` differs from the minted owner's. **How you'd know:** `run-record-prd` exits 4 ("owner epoch/session moved on") on a normal handoff with no resume in play. **What it means:** the fix passes `expectedOwner` read from the *ledger* (not the drain's env), so `session_id` matches by construction — if this fires, the implementation wrongly sourced `session_id` from the environment; narrow the fence to the ledger-read owner.
- **The failure:** a discovered PRD fact is written to the ledger but the downstream YAGNI/scope gate never sees it (wrong field name / write after the gate reads). **How you'd know:** the scope-strictness gate behaves as if `prd_creative_licence` is null during the drain even though the ledger shows the value. **What it means:** confirm `run-record-prd` runs at step 7 *before* tidy/build (it does) and writes the exact fields `prd_creative_licence`/`prd_root_container` (`lights-out.js:1046-1047`).
- **The failure:** removing the disposition fallback breaks a documented operator idiom that relied on "newest." **How you'd know:** the `unattended.md` disposition example returns exit 3. **What it means:** the documented idiom already passes `--run-dir "$FAFF_RUN_DIR"` (`unattended.md:110`), so it is unaffected; if a doc still relies on the fallback, update it (see Assumptions).

---

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an operator mints an L4 ledger A (FAFF_RUN_DIR=A) and launches `FAFF_RUN_DIR=A /faff-beep-boop`
  that takes the `drain` branch
When the run completes
Then `faff disposition --run-dir A` returns A's real drain disposition (not "nothing"),
  and exactly one L4 ledger with owner.status:"running" existed for the run (no second mint under .faff/runs)
```

```
Given the `plan` branch runs (verdict coverage-thin) with FAFF_RUN_DIR=A
When /faff-plot --autonomous is invoked and returns, and the branch falls through to build
Then no `faff lights-out` mint occurred in §0a or in plot Ignition,
  and plot recorded prd_root_container onto ledger A rather than self-minting a new ledger
```

```
Given FAFF_RUN_DIR=A is a valid L4 lights-out ledger with prd_creative_licence:null
When `faff run-record-prd --run-dir A --prd-creative-licence tight --prd-root-container faff-x` runs
Then A.prd_creative_licence == "tight" and A.prd_root_container == "faff-x",
  the write went through mutateLedgerUnderLock, and re-running the same command is a byte-stable no-op (exit 0)
```

- **Non-functional assertion:** the narrow PRD update mutates only `prd_creative_licence` and `prd_root_container`; all other ledger fields (owner, admitted, budget, run_id) are byte-unchanged across the write.
- **holdout:** A readable non-L4 `FAFF_RUN_DIR` (e.g. an L3 ledger) MUST yield the `not-l4` skip, not a fault — a legitimate nested-L3 `faff-beep-boop` still runs unchanged.

---

## 6. Design Decision Rationale

**Is a readable non-L4 `FAFF_RUN_DIR` a fault or a skip?** Fault-on-anything-non-L4 is louder but regresses nested L3 and contradicts `resolveAppetite`'s existing tolerance. **Chosen:** fault only on invalid/foreign-L4; a readable non-L4 ledger is the `not-l4` skip.

**New command vs `lights-out --record-prd` flag for the narrow update.** A flag on `lights-out` reinforces the "lights-out = the way to get a ledger" confusion at the root of this bug. **Chosen:** a dedicated `faff run-record-prd` reusing the mint-side validators and `mutateLedgerUnderLock`.

**§0a reuse in both branches, no re-mint.** Minting again (either branch) is the defect. Reusing `FAFF_RUN_DIR` and recording discovered facts is the whole fix. **Chosen:** delete both step-7 `faff lights-out` calls; record via `run-record-prd`; fall through on `runDir`.

**Plot Ignition nested-reuse vs always-self-mint.** Always-self-mint produces the second/third ledger in the plan branch. **Chosen:** classify `FAFF_RUN_DIR`; reuse when inherited-L4 (nested), self-mint only when standalone.

**Disposition fallback.** Keeping `latestRunDir` (or a `*-lights-out` glob) violates "never guess the newest." **Chosen:** explicit `--run-dir` → `$FAFF_RUN_DIR` only; fail exit 3 otherwise.

**Refuse path with a pre-minted ledger.** The old "mint nothing so no orphan" rationale is moot (§0a no longer mints). **Chosen:** surface the reason and stop; leave the single inherited ledger untouched (close is FAFF-797).

**Doc surface.** The issue says "update RUN-L4.md," but `find . -iname 'RUN-L4*'` returns nothing. **Assumes:** the doc surface is `docs/guide/unattended.md` (the headless disposition contract, ~L101-110, and "Going lights-out (L4)", ~L161).

---

## 7. Open Questions and Assumptions

**Open Questions.** None. The six binding decisions of 2026-08-19 close the adoption-mechanism question; the remaining choices above are all **Chosen:**.

**Assumptions.**

- **`docs/guide/unattended.md` is the doc surface** (no `RUN-L4.md` exists). *Validation:* run `find . -iname 'RUN-L4*'` — if it returns nothing (as at authoring time), update `unattended.md`; if a `RUN-L4.md` has since appeared, update that instead.

---

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] No `faff lights-out` (mint) call remains in `faff-beep-boop` §0a (either branch) or in `/faff-plot --autonomous` nested Ignition; a plan-branch run leaves exactly one `owner.status:"running"` L4 ledger under `.faff/runs`.
- [ ] `resolveAppetite`, `resolveConvergence` (`config.js:497,536`), and `isLiveHigherLevel` (`run-ledger.js:87`) still resolve the single live inherited ledger correctly under reuse (same owner, running, held) — confirmed by test, no change to their inputs.

### From WHAT (validity classifier)
- [ ] `classify_inherited_run_dir` returns `not-l4` for unset/empty `FAFF_RUN_DIR`.
- [ ] Returns `inherited-l4` for a readable `level:"L4"` ledger whose run-id matches `^run-\d{8}-\d{6}-lights-out(-[0-9a-f]{6})?$`.
- [ ] Returns `fault` for a non-empty `FAFF_RUN_DIR` with an absent or unparseable ledger, or an L4 ledger whose run-id is not the lights-out shape.
- [ ] Returns `not-l4` (not `fault`) for a readable non-L4 ledger.

### From WHAT (narrow PRD-record command)
- [ ] `faff run-record-prd --run-dir A --prd-creative-licence tight` sets `A.prd_creative_licence == "tight"` and exits 0; re-run is a byte-stable no-op exit 0.
- [ ] `--prd-root-container` without `--prd-creative-licence` fails loud exit 2 (reuses `prdRootContainerFromFlags`).
- [ ] An off-vocabulary licence value fails loud exit 2 (reuses `prdCreativeLicenceFromFlag`).
- [ ] The write goes through `mutateLedgerUnderLock`; only `prd_creative_licence`/`prd_root_container` change, all other fields byte-unchanged.
- [ ] A resolved ledger that is not `level:"L4"` fails loud exit 2 (never writes onto a non-L4 ledger).
- [ ] `run-record-prd` passes `expectedOwner = {epoch, session_id}` read from the validated ledger; a superseded owner yields (exit 4), nothing written. (Confirm against `ownerEpochFenceStale`, `heartbeat.js:262`.)
- [ ] No `--run-dir` and no `$FAFF_RUN_DIR` → exit 3.

### From HOW (beep-boop §0a)
- [ ] §0a `fault` → exit non-zero, drain nothing; `not-l4` → skip §0a (unchanged L3); `inherited-l4` → reuse mode on `runDir`.
- [ ] `drain` branch records the licence (and root container when a PRD container was resolved) via `run-record-prd`, then falls through — no mint.
- [ ] `plan` branch invokes plot, re-reads coverage, records the licence via `run-record-prd`, and falls through on the inherited `runDir` — no mint; the "mint the build run's own ledger / never reuse plot's decompose-pass ledger" instruction is removed.
- [ ] No `env -u FAFF_RUN_DIR faff lights-out` exploratory-probe mint is introduced or left in the drain.

### From HOW (plot Ignition)
- [ ] Nested Ignition (`inherited-l4`) reuses `runDir`, self-mints nothing, and records `prd_root_container` (with the run's licence) via `run-record-prd`.
- [ ] Standalone Ignition (`not-l4`) self-mints via the existing lights-out preflight, unchanged.
- [ ] Nested Ignition with a resolved container but **no** creative-licence available → plot exits Ignition cleanly (no non-zero exit, no `run-record-prd` call), leaves `prd_root_container` unchanged, and emits the observable skip line (`prd_root_container record skipped — no creative-licence resolved yet`) to the plot Ignition log + stderr — the skip is distinguishable from a successful record by that log line plus the unchanged ledger field.
- [ ] `fault` at Ignition → refuse loudly, zero writes.

### From HOW (disposition)
- [ ] `cmdDisposition` no longer calls `latestRunDir`; with no `--run-dir`/`$FAFF_RUN_DIR` it exits 3 with the "pass --run-dir DIR" message.
- [ ] Explicit `--run-dir`-honoured-as-is and malformed-ledger exit 2 behaviours are unchanged.

### From HOW (refuse)
- [ ] On a `refuse` verdict, §0a surfaces the closed reason and stops without draining; the single inherited ledger is left untouched (no mint, no close).

### From Assumptions
- [ ] `find . -iname 'RUN-L4*'` checked; `docs/guide/unattended.md` updated to describe the reuse (one ledger, no second mint) — the "Going lights-out (L4)" hand-off and the disposition contract reflect that the captured `FAFF_RUN_DIR` is the ledger that drains.

### Integration smoke test
```
1. faff lights-out --json  -> capture run_dir A (prd_creative_licence:null)
2. FAFF_RUN_DIR=A /faff-beep-boop  (drain branch, PRD present -> licence "tight")
3. assert: A.prd_creative_licence == "tight"; run-record-prd wrote it; no ledger B minted
4. faff disposition --run-dir A  -> returns A's drain disposition (not exit 3, not "nothing")
5. env: set FAFF_RUN_DIR to a dir with no ledger, run §0a guard -> fails loud, drains nothing
```

---

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery · agile-delivery lens (issue-critique). Advisory; does not block promotion.

- **Right-sized?** At the top of the band but coherent. Build-tier complex, five surfaces (two SKILL.md prose sites, `disposition.js`, a new `run-record-prd` command + its `classify_inherited_run_dir` resolver, docs), yet every piece converges on one outcome — the single reused L4 ledger. The new command exists only to serve the reuse and would ship no standalone user value if split out, so keeping it whole is correct. Watch the estimate: complex + 3 code sites + prose in two skills is a genuine 2-3 day unit.
- **Workstream fit?** Cohesive — one outcome ("one top-level L4 ledger, reused end-to-end"), no bundled second concern; OUT OF SCOPE cleanly fences off adopt/epoch-takeover (FAFF-527), auto-close (FAFF-797), the capture-snippet fix (FAFF-807), and the appetite-resolver liveness bug (FAFF-378). No project grouping was supplied, so container placement can't be judged; the ticket's own scope is single-outcome.
- **Deps surfaced?** No issues. All four related tickets are named and Done (FAFF-807, FAFF-527, FAFF-797, FAFF-378) — no missing blocker links. One live coupling to confirm during build: the refuse-path leaves the inherited ledger `owner.status:"running"` and defers close to FAFF-797 — confirm FAFF-797's auto-close actually covers the un-drained/refused inherited ledger this spec now leaves open.
- **Risk profile?** Real risk, well de-risked in-spec — no separate spike needed. The sharp edges (owner-epoch/`session_id` fence rejecting legitimate reuse writes; fault-on-foreign-`FAFF_RUN_DIR` regressing nested-L3 runs) are front-loaded with explicit failure-mode analysis, the Option (b) readable-non-L4 skip, holdout scenarios, and an integration smoke test.

confidence: high
build-tier: complex
spec-review: approve