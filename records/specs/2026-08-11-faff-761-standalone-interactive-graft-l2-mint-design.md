# nlspec — FAFF-761: Standalone interactive `/faff-graft` mints its own L2 run-ledger + events chain so the merge-gate anchor is satisfiable

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-761.

This spec addresses Linear bug **FAFF-761**. Its audience is the build agent that will implement the fix and the human reviewers who gate it. It resolves the ticket's three candidate directions to the pre-decided **direction (a)**: a directly-invoked `/faff-graft ISSUE-XX` (interactive, no `beep-boop` orchestrator) mints a minimal, honest single-issue **L2** `run-ledger.json` + `events.jsonl` chain into its own fresh run dir, so the *existing* Step 9b `faff events anchor` succeeds and `faff merge-gate` accepts the committed anchor — closing the friction where only a human could merge at the forge, without weakening the fail-closed merge floor.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff merge-gate` will only merge a PR that carries a *committed, verified anchor* at the PR head sha: a byte-copy of the build's `events.jsonl` + `run-ledger.json` (plus per-issue AC/review markers) under `.faff/anchors/<run-id>/<issue>/`, minted by `faff events anchor` at graft Step 9b and re-verified by the governance-check `integrity` + `merge_floor` legs. `resolveAnchorLevel` reads the anchored ledger's `level`, requires it be a `FLOOR_LEVELS` member, and **refuses (exit 2) fail-closed on any miss** — it never falls back to a live ledger (FAFF-690 F1). The anchor's whole substrate — `events.jsonl` and `run-ledger.json` — is today minted *only* by the orchestrator lane (`faff-beep-boop`'s `concurrency` slot, or `faff lights-out` at L4). A directly-invoked interactive graft has **no run dir of its own**, so it mints neither. Step 9b's `faff events anchor` then exits 3 ("no events.jsonl — nothing to anchor"), no anchor is committed, and merge-gate refuses. The fix is to give interactive graft the *same* substrate the anchor already knows how to copy — an honest L2 ledger + genesis chain — so the existing anchor + gate path just works.

**Problem statement.** Status quo: interactive `/faff-graft` reaches the merge-confidence gate with no `events.jsonl`/`run-ledger.json`, so Step 9b anchors nothing and `faff merge-gate --execute` exits 2 (`anchor-missing`), forcing a human forge-merge that the `merge-fence` PreToolUse hook otherwise blocks (observed on FAFF-758 / PR #582, 2026-08-09). The pain: the FAFF-568/623 promise that "a human-triggered build's evidence is just as worth anchoring" is unsatisfiable for a standalone build, so the sanctioned mechanical merge path is unreachable interactively. This change makes interactive graft mint that evidence itself.

**Design principles:**

**Satisfy the floor, never weaken it.** The fix must make the anchor *exist and verify*, not carve a no-anchor path. `resolveAnchorLevel`, `anchorRefusal`, `decideFloor`, and the governance-check legs stay byte-unchanged. A genuinely missing or malformed anchor must still exit 2. Nothing the interactive lane does may become an agent-reachable route around the floor (this is the FAFF-673 / operator-decision constraint: the no-full-floor merge path stays human-only).

**Reuse the anchor, don't parallel it.** Per the FAFF-623 rule "reuse the anchor, don't parallel it," the fix must feed the *existing* `.faff/anchors/…` surface via the *existing* `faff events anchor`. It must not invent a second evidence surface, a second merge path, or a second gate.

**Honest by construction; the CLI owns every hash.** The minted ledger's `level` is `L2` because the build genuinely ran interactively — never operator-settable at merge time. Every chain hash (genesis `prev`, each link, the `chain-head.json` witness) is CLI-computed, never hand-written or caller-supplied. The interactive session is the trusted writer (ADR-0077: interactive top-level graft "legitimately writes every class directly" — there is no dispatch cut above it), so a hand-minted-but-honestly-shaped L2 chain is exactly the trusted-side write the class model already sanctions.

**Deterministic tools over prose.** The L2 mint is a small CLI verb (the L2 sibling of `faff lights-out`'s L4 mint), not graft prose hand-writing JSON. A verb makes the ledger shape, the genesis event, and the `level` constant single-sourced and testable, and keeps prose from drifting into a second minting rule.

## 2. OUT OF SCOPE

- **Any change to `resolveAnchorLevel`, `anchorRefusal`, `decideFloor`, or the merge-gate `--level`/`--interactive` branches.** The fix satisfies the floor by producing honest inputs, not by relaxing the gate.
- **Direction (b): a sanctioned no-orchestrator / no-anchor interactive merge path.** Foreclosed by FAFF-673 + the 2026-08-08 operator decision.
- **Direction (c): scoping the FAFF-568/623 interactive-anchor promise to "orchestrator-only."** Regresses FAFF-623.
- **The rich beep-boop event timeline.** A genesis `run-start` (+ a close `issue-outcome`) is the honest minimal chain.
- **Autonomous / dispatched-lane minting** (beep-boop `concurrency`, `lights-out`). Those already mint their substrate.
- **Relocating interactive graft's evidence writes to a trusted side.** Interactive graft *is* the trusted side.
- **Full budget governance / sentry-poller / holdout machinery for interactive L2.**

## 3. WHAT — Vocabulary, Types, and Interfaces

**The new CLI verb (the L2 mint):**

```
COMMAND faff run-ledger init-interactive
  FLAGS:
    --issue <ISSUE-ID>    # required; must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/ and contain no ".."
    --root <DIR>          # optional; defaults to findRoot()
    --id <RUN-ID>         # optional; overrides the derived run-id (tests / determinism)
    --json                # optional; machine-readable emission
    --selftest            # optional; in-memory selftest, mirrors lights-out/events

  BEHAVIOR: mint a fresh interactive run dir with an honest L2 ledger + genesis chain.
  LEVEL: writes level:"L2" UNCONDITIONALLY. There is NO flag that sets/raises/lowers level.
  GUARD (CLI-level, merge-floor defense-in-depth): if FAFF_RUN_DIR (or --root's newest run dir)
        already resolves a LIVE run dir whose run-ledger.json carries a level > L2 (L3/L4) with
        owner.status:"running", REFUSE (exit 3) + emit an events observe of the refusal.
  EXIT: 0 on mint; 2 on a bad --issue / usage error; 3 on the live-higher-level guard;
        never mints a partial dir on error.
  STDOUT (non-json): the absolute run dir path.
  STDOUT (--json): { proceed:true, level:"L2", run_id, run_dir,
                     ledger_sha256_before:null, ledger_sha256_after:<hash> }
```

**The minted `run-ledger.json` (minimal honest L2 shape):** `run_id`, `level:"L2"` (CONSTANT), `admitted:[<issue>]`, `outcomes:{}` (EMPTY at mint), `budget:{envelope:{ceilings:{},at_ceiling:"stop"}}`, `owner:{status:"running",session_id,pid,started_at,last_heartbeat}`.

**The minimal `events.jsonl` chain:** Genesis at mint `{schema:2, run_id, seq:0, ts, prev:SHA-256(run_id), phase:"run", type:"run-start"}`; Close at Step 10 terminal (LIVE dir only, post-anchor) `{schema:2, run_id, seq:N, ts, prev:<SHA-256 of prev physical line>, phase:"build", type:"issue-outcome", issue:<issue>, data:{outcome:<terminal>}}`.

## 4. HOW — Behavior

Interactive graft gains one early step — mint its own run dir — and one late step — record the terminal outcome. After the Step-2 admission gates pass and before the worktree/evidence work, a standalone interactive graft mints `run-YYYYMMDD-HHMMSS-graft-<issue>` with an honest L2 ledger + genesis chain, exports `FAFF_RUN_DIR`/`FAFF_SESSION_ID`, and proceeds. Step 9b anchors that substrate; merge-gate reads `level:"L2"` from the committed anchor and merges. At the merge terminal, graft writes `outcomes[issue]` + `owner.status:"done"` to the *live* ledger (the already-committed anchor stays an honest pre-merge snapshot).

An autonomous/dispatched graft (FAFF_RUN_DIR already set) skips the mint. Defense-in-depth: the verb's own live-higher-level guard refuses (exit 3) when the newest run dir already resolves a live L3/L4 run.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fresh repo with no pre-existing run dir, and a spec-ready ISSUE-XX
When a human runs /faff-graft ISSUE-XX interactively through build → review pass → PR open (Step 9b)
Then a committed anchor exists at the PR head under .faff/anchors/run-YYYYMMDD-HHMMSS-graft-ISSUE-XX/ISSUE-XX/
  carrying events.jsonl + run-ledger.json (level "L2") + chain-head.json
And faff merge-gate --pr … --execute exits 0 and merges through the sanctioned path
```

- The minted `run-ledger.json` MUST carry `level:"L2"` and MUST NOT expose any flag or path by which an operator can set a different `level`.

## 6. Design Decision Rationale

**Chosen:** direction (a) — mint a minimal honest L2 chain. Only direction that satisfies (never weakens) the fail-closed floor while removing the friction.

**Chosen:** the CLI verb `faff run-ledger init-interactive`, the L2 sibling of `faff lights-out`'s L4 mint (`faff run-start` is a pure predicate and is deliberately not overloaded).

**Chosen:** run-id `run-YYYYMMDD-HHMMSS-graft-<issue>` (UTC); minted at run-start, `FAFF_RUN_DIR`/`FAFF_SESSION_ID` exported.

**Chosen:** minimal honest ledger; `outcomes[issue]` + `owner.status:"done"` written only at the genuine terminal.

**Chosen:** a genesis `run-start` at mint plus an `issue-outcome` close at the terminal on the live dir. Every hash is CLI-computed.

**Chosen (infosec):** the verb asserts a CLI-level guard — refuses (exit 3) + observes when FAFF_RUN_DIR (or the newest run dir) already resolves a live L3/L4 run, so an interactive L2 mint can never silently downgrade a live higher-level run.

## 8. DONE — Definition of Done

- Standalone `/faff-graft` reaches Step 9b, `faff events anchor` exits 0.
- The run completes its merge through `faff merge-gate --pr … --execute` (exit 0).
- `faff run-ledger init-interactive --issue <ISSUE>` creates the run dir with `run-ledger.json` + genesis `events.jsonl`, prints the path (+ `--json`), exits 0.
- Rejects a non-bare-issue-id `--issue` with exit 2 and mints no partial dir.
- `--selftest` validates the minted ledger shape + genesis chain.
- CLI-level guard: a live L3/L4 run present → exit 3 + refusal observe, no L2 dir; none present → mint proceeds — proven by a test.
- Minted ledger has `level:"L2"`, `admitted:[<issue>]`, `outcomes:{}`, `owner` block; no flag sets a different level.
- Genesis event `{schema:2, seq:0, prev:SHA-256(run_id), phase:"run", type:"run-start"}`; `faff events verify` reports verified.
- Interactive graft mints + exports before worktree create; autonomous skips.
- Step 9b resolves `$run_dir` from the mint's `FAFF_RUN_DIR`, never `latestRunDir`.
- At terminal, `outcomes[<issue>]` + `owner.status:"done"` written to the live ledger, plus a `ledger-write` event (and an `issue-outcome` close on shipped).
- `resolveAnchorLevel` over the committed anchor returns `{level:"L2", status:"ok"}`.
- A missing/malformed anchor still makes `faff merge-gate` exit 2 — proven by a test.
- `resolveAnchorLevel`, `anchorRefusal`, `decideFloor`, and the merge-gate `--level`/`--interactive` branches unchanged.
- governance-check integrity + merge_floor legs pass on the anchored L2 chain.
- E2E test: standalone-interactive-graft → mint → Step-9b anchor → merge-gate accept (exit 0).
- Negative test: missing/malformed anchor still exits 2.
- Immutability/sequencing test: committed anchor carries `outcomes:{}` while live carries `outcomes[<issue>]` + `owner.status:"done"`; anchor sha256 unchanged.
- Terminal-state matrix test: `parked` and `errored` terminals write the correct outcome; an abandoned mid-build leaves `owner.status:"running"`.

confidence: high
spec-review: approve
