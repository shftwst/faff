# FAFF-234 — Heartbeat ticks inside long in-issue sub-steps (deterministic `faff heartbeat` primitive)

> Spec: faffter-dark-nlspec · 2026-06-26 · autonomous · confidence: high. Full spec on Linear FAFF-234.

This is the build spec for FAFF-234, a hardening follow-up to FAFF-205. Audience: the build agent implementing the change, and the human reviewers gating it. It specifies a deterministic CLI primitive for refreshing the run-ledger liveness heartbeat and wires that primitive into faff-graft's long, quiet sub-steps so a slow-but-live build never ages out the staleness window.

## 1. WHY — Problem and Principles

**The load-bearing model.** Runcheck judges a run *live* (`held`) when its ledger's `owner.last_heartbeat` is fresher than `STALE_SECS` (default 900s). Liveness therefore tracks **whoever last wrote the heartbeat**, not wall-clock activity — so a live build that simply isn't *writing the heartbeat* for 15 minutes looks dead. The fix is to make the heartbeat tick on **wall-clock cadence from inside the slow sub-steps**, via a single deterministic write primitive.

**Problem statement.** Today the heartbeat is written by the orchestrator agent hand-editing the ledger JSON, mandated only in prose, and the only place that prose covers a long quiet phase is beep-boop's orchestrator-side "review/merge wait" — but builds now run as **isolated subagents** (FAFF-201), and a build subagent running a multi-minute adversarial review or gate ladder has *no* mandate (and no tool) to tick the heartbeat mid-step. So a single ~10-minute graft (FAFF-229: build + adversarial review; longer still once L4 holdout eval lands) can let the heartbeat age past 900s → the run reads stale → a foreign session's Stop hook treats a live run as abandoned (false-block / tempting-but-wrong "reconcile as dead").

**Design principles.**

**Deterministic tools over prose for a load-bearing signal.** The heartbeat gates a safety mechanism (the Stop hook). Its write must be a tested CLI primitive with identical behaviour run-to-run, not an agent hand-rolling a read-modify-write of the ledger. Reject any design that leaves the heartbeat write as free-form prose.

**Ticks fire only at agent-controlled boundaries.** A synchronous LLM/tool call blocks the agent loop; an agent cannot emit a heartbeat *while* a call is in flight, and there is no background thread inside an agent turn. Reject any "periodic ticker / timer" design — ticks are emitted at the sub-step boundaries the agent reaches between calls (entry to review, between adversarial phases, between gate-ladder checks, before/after holdout).

**Liveness stays owner-emitted on-disk state.** Per ADR 0008, liveness is never inferred from worktree mtimes or out-of-band probes. The heartbeat write stays an explicit on-disk write by the run's own agents; the read path (`runIsHeld`) is unchanged.

**Scope statement.** This sits one layer under the FAFF-205 liveness contract: it does not change *what* `held` means, only *how reliably the heartbeat keeps arriving* during a live-but-quiet build.

## 2. OUT OF SCOPE

- **Auto-scaling the staleness window** — the primary fix (boundary ticks on wall-clock cadence) removes the staleness risk without a variable window. Extension point: `heartbeatStaleSecs()` already centralises the threshold.
- **Parallel-executor concurrent ledger-write serialization** — multiple build subagents sharing one ledger is FAFF-82 / concurrency-slot territory. Extension point: a dedicated single-value `.faff/runs/<id>/heartbeat` file.
- **Changing `runIsHeld` / the ownership model / the Stop-hook decision** — the read and gate paths are correct (FAFF-205/233/235); this change only improves write cadence.
- **A general ledger-mutation API** — only `owner.last_heartbeat` needs a tool; a generic writer invites unscoped mutation.

## 3. WHAT — Vocabulary, Types, and Interfaces

New CLI surface — `faff heartbeat`:

```
faff heartbeat [RUN_DIR]            # refresh owner.last_heartbeat = now on the resolved run
  RUN_DIR   optional; resolution order: explicit arg → $FAFF_RUN_DIR → latest run under .faff/runs
  exit 0    heartbeat written (and prints nothing, or the ISO ts on --json)
  exit 0    soft no-op: no ledger / no owner / owner.status != "running"
  exit 2    malformed ledger JSON (loud; never silently swallowed)
  --json    print { "run_dir", "last_heartbeat", "written": true|false }
```

The ledger `owner` object is unchanged (no schema change); `last_heartbeat` is the only field this primitive writes.

**Chosen (write locus):** field-merge on `run-ledger.json` — matches the ticket scope + ADR 0007.
**Chosen (refresh mechanism):** the `faff heartbeat` CLI primitive — the heartbeat gates a safety mechanism, so its write must be deterministic and tested.
**Chosen (caller trust):** no ownership proof; guard only on `owner.status === "running"` + a resolvable run dir. The Stop hook calls `runcheck`, never `heartbeat`; the only callers are the run's own agents. `RUN_DIR` is passed explicitly.

## 4. HOW — Behavior

Add `cmdHeartbeat(args)` beside `cmdRuncheck`, plus a small `applyHeartbeat` field-merge + `atomicWriteLedger` helper (the missing write counterpart to `readLedger`). Wire one dispatch line. Then update the heartbeat-refresh prose in beep-boop, the two concurrency executors, and faff-graft to call `faff heartbeat` at the boundaries each controls.

```
PROCEDURE cmd_heartbeat(args):
  1. run_dir := resolve(arg[0]) OR env.FAFF_RUN_DIR OR latest_run_dir()
  2. IF no run_dir OR no run-ledger.json → soft no-op (exit 0, written:false)
  3. ledger := readLedger(run_dir)            # may throw → exit 2 (malformed, loud)
  4. IF !ledger.owner OR owner.status != "running": soft no-op (exit 0, written:false)
  5. owner.last_heartbeat := now_iso()         # mutate ONLY this field on the re-read object
  6. atomic_write(run-ledger.json, ledger)     # tmp + rename (no torn file)
  7. exit 0 (written:true)
```

Wiring (prose, in the skills): faff-graft ticks before/after the gate ladder (Step 7.5) and at review entry / between adversarial phases / after, plus holdout before/after (Step 9). The orchestrator + both concurrency executors replace the hand-rolled ledger edit with `faff heartbeat`, passing `RUN_DIR` to dispatched build subagents.

## 8. DONE — Definition of Done

- `faff heartbeat [RUN_DIR]` exists, dispatched, in USAGE; resolves arg → `$FAFF_RUN_DIR` → latest; `--json` prints `{ run_dir, last_heartbeat, written }`.
- A tick sets `owner.last_heartbeat = now` and leaves every other field byte-identical; `done`/missing-owner/missing-ledger → soft no-op exit 0 written:false; malformed → exit 2; write is atomic + re-reads before mutating.
- faff-graft Step 7.5 + Step 9 and the orchestrator + both concurrency executors refresh via `faff heartbeat`.
- A test proves a tick keeps a long-quiet run `held`, a `done`-owner tick is a no-op, the write is field-scoped; `node --test`, `lint-refs`, `lint-cli-doc`, `adr validate` pass.
- An ADR records the single sanctioned heartbeat write path, extending ADR 0007/0008.

confidence: high
