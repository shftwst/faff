# Spec — FAFF-690: Close the FAFF-435 frontier re-audit findings in merge-floor and runcheck

> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: high. Full spec on Linear FAFF-690.
> Revised 2026-08-08 — F1's original ledger-fold approach was rejected on an infosec blocker (a coordinated ledger+events rewrite forges a matching fold); F1 now sources the autonomy level from the head-sha-pinned committed anchor. Spec-review iteration 2 confirmed the approach holds (infosec crux closed) with one architectural revise-minor (403≠404 on the Contents-API fallback + document the `contents:read` token scope), applied in place — see F1's resolver + the assumptions.

This is the build spec for **FAFF-690**, addressed to the coding agent who will implement it and the human/adversarial reviewers who gate it. It closes the four mechanically-reproducible gate-subversion paths the 2026-08-02 FAFF-435 frontier audit (Codex seat, GPT-5.6-sol, commit `7f9513c…`) found in faff's own L4 merge-floor and runcheck backstop. Every citation was verified against `HEAD` (the audited commit has zero diff against the implicated files). **This is the revised spec: F1's original approach (wiring `verifyChain`'s `ledger_fold` into merge-gate) was rejected on an infosec blocker and has been rewritten.** The spec is deliberately concrete at the function/line level — the audit lineage penalised vague, unimplemented deliverables, so a build against it must be mechanically checkable.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's autonomous merge gate makes a trust decision — "may this run merge, and under how many gates" — and the most dangerous input to that decision is the **autonomy level** (`L1`…`L4`), because a higher level demands strictly more gates (an L4 merge additionally requires a fresh, code-blind holdout verdict and a corrective-integrity attestation). Today merge-gate reads that level from `.faff/runs/<run-id>/run-ledger.json` on the **live, writable** filesystem the build lane it is policing also writes to. Write access cannot be revoked from a live L4 lane that legitimately updates its own ledger, so any control here must rest on an input the build lane **cannot silently rewrite** — not on the live ledger, and not on any tamper-evidence that lives in the same writable directory. The events.jsonl hash chain does **not** qualify: it is self-consistent by construction, so an attacker on the shared substrate rewrites `run-ledger.json` L4→L1 *and* appends one fresh valid `ledger-write` (its `prev` = the current last line's hash; its `data.ledger_sha256` = the tampered ledger's hash) and `verifyChain` returns `verified` / `ledger_fold:"match"`. `chain-head.json` is likewise just another re-mintable file in that same directory. The input that *does* qualify already exists and ships today: the **committed per-PR anchor** (FAFF-568/623). At graft Step 9b (`faff-graft/SKILL.md:431`) every PR carrying a run dir commits `.faff/anchors/<basename(run-dir)>/<ISSUE>/run-ledger.json` (a byte-copy of the minted ledger, carrying its `level`) via the `!.faff/anchors/` carve-out (`.gitignore:22`), then `git add` + commit + push **with the PR head**. Once pushed, that blob is git content-addressed and immutable at the head sha: `git show <headSha>:.faff/anchors/<run>/<ISSUE>/run-ledger.json` returns the original `level` no matter what the local live ledger now says. Changing it requires a **new commit → a new head sha → a forced re-run of the required, branch-protection-gated `governance-check` CI check → a visible PR-diff change**. This spec makes merge-gate resolve the governing level from that head-sha-pinned anchor instead of the live ledger.

**Problem statement.** The merge floor and the runcheck backstop today trust the live-writable ledger's level, an unread contract input, an already-merged short-circuit, and a malformed-ledger read *without binding to any input the build lane cannot rewrite*, so a lane sharing the run substrate can downgrade an L4 merge to L1 (even with a coordinated events-chain append), sneak a violated-integrity floor past the contract selftest, mint success evidence for an unevaluated merge, or silence the owning session's Stop-hook backstop by corrupting the ledger. This change binds each path to head-sha-pinned committed evidence (F1), a live contract leg (F2), a re-derived retrospective floor (F3), and content-independent ownership (F4), and lands direct regression fixtures reproducing all four attacks — including the coordinated-append attacker that defeated F1's first approach.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Bind trust to head-sha-pinned committed evidence, never to the live writable substrate or to tamper-evidence co-located with it.** The autonomy level governing a merge is resolved from the committed anchor at the observed PR head sha. The live `run-ledger.json`, the events chain, and `chain-head.json` are all rewritable by the lane under audit and must never be the trust root for the level. This is the principle F1's first approach violated.

- **Fail closed on absent or unverifiable evidence.** No committed anchor, an unreadable/malformed anchor, an integrity leg that cannot prove `asserted`, or a malformed owned ledger → refuse or block. Never coerce an unprovable input to a passing value. The permissive-in-the-unsafe-direction default is exactly finding F2 and must not be reintroduced.

- **The committed anchor is a floor the live substrate can only match, never raise.** A live ledger claiming a *higher* level than the anchor never lifts the resolved level (that would relocate the same trust-boundary bug back onto the live substrate). The anchor value governs.

- **Scope the anchor-level requirement to the merge trust boundary.** Only merge-gate's level consumption (F1) and, as defence-in-depth, the required `governance-check` merge-floor leg (F1b) derive level from the anchor. The many unrelated ledger readers are untouched.

- **Foreign-session safety is untouchable.** F4 is scoped to the *owned + malformed* intersection; every FAFF-235 foreign-session behaviour survives byte-for-byte.

**Relied-upon, already-shipped preconditions** (NOT build work in this ticket — F1 depends on them being live, which is verified):

| Precondition | Where | What F1 relies on |
|---|---|---|
| FAFF-568/623 committed per-PR anchor | `faff-graft/SKILL.md:431`; `.gitignore:22` | graft commits+pushes `.faff/anchors/<run>/<ISSUE>/run-ledger.json` (+ events.jsonl + merge-floor files) with the PR head; immutable at head sha |
| `faff events anchor` | `events.js` (`anchor` sub-verb, `--dest`) | byte-copies the run ledger into the anchor dir |
| FAFF-562 required CI check | branch-protection ruleset on `main` since 2026-07-26 (`required_status_checks` = validate, governance-check, env-rootless) | changing the committed anchor forces a new head sha and re-runs the gating `governance-check` |
| `governance-check` anchor legs | `governance-check.js:133-201` (`evaluateMergeFloorLeg`/`evaluateIntegrityLeg`), `:221` (`evaluateAnchorDir`) | independent CI-side re-validation of the committed anchor at the PR head sha (the gap F1b closes: `level` defaults L3, `:511`, never derived from the anchor) |

**Reference context** — systems this change touches or reuses:

| System | Location | Relevance |
|---|---|---|
| merge-gate PR path level resolution | `merge-gate.js:774-783` | F1: reads level from the LIVE ledger (`tryReadLedger`) — the bug |
| merge-gate `--local` path level resolution | `merge-gate.js:580-586` | F1: same live-ledger trust, no-remote path |
| `resolveGateLevel` | `contract-defs.js:1609-1614` | F1: the pure resolver the mismatch guard uses (retained, re-pointed to the anchor level) |
| `gh pr view` head sha + `ghRepoSlug` + `observeCi` + `gitRun` | `merge-gate.js:811-817`, `:254-276`, `:493-497` | F1: head sha the anchor is pinned to; `gitRun`/`ghJson` are the read tools |
| `resolveIntegrity` | `merge-gate.js:319-329`, `:809` | F1/F3: keyed on `level`; must move after anchor-level resolution |
| already-MERGED short-circuit | `merge-gate.js:819-823` | F3: writes success evidence before the floor |
| run-dir readers | `merge-gate.js:333`, `:344`, `:392` | F3: retrospective floor legs |
| `computeIntegrityFloor` / `decideFloor` | `contract-defs.js:1616-1632`, `:1587-1599` | F2: contract that drops the integrity leg |
| `evaluateAnchorDir` / merge-floor leg | `governance-check.js:221`, `:133-145`, `:511` | F1b: derive level from the anchor's own ledger |
| runcheck Stop hook + `runIsOwned` + `readLedger` | `runcheck.js:157-172`, `:203-206`, `:99-105`; `shared-infra.js:232` | F4: the two silent-swallow points; `readLedger` throws on parse AND read errors |

**Scope statement.** A security-hardening pass entirely inside faff's own L4 merge-floor and runcheck backstop; no product surface changes, no new user-facing verb.

---

## 2. OUT OF SCOPE

- **Chain-verification / anchor-level reads in every ledger reader.** *Excluded because:* only the L4 merge trust decision matters; `corrective.js`/`economics.js`/`disposition.js`/`budget.js`/`audit.js` do not gate merges. *Extension point:* wire the anchor read at that specific consumption site, mirroring F1.

- **Re-commissioning the FAFF-435 adversarial audit re-run.** *Excluded because:* re-running a fresh adversarial pass is a human/team action, not mechanically assertable by a spec's ACs. It stays on the ticket's Done list as a follow-up to trigger *after* this ships — **not** a DoD item this spec's tests satisfy.

- **Making the run substrate unwritable / sandboxing the live ledger.** *Excluded because:* contradicts the trust-binding principle — an L4 lane writes its own ledger. F1 defends by sourcing trust elsewhere, not by locking the lane out.

- **A new anchor format or a signed/notarised anchor.** *Excluded because:* the existing committed-at-head-sha anchor is sufficient — its immutability is git's, and mutating it is gated + visible. *Extension point:* if the git-visibility residual (below) ever needs closing, a signature over the anchor blob verified against a key outside the repo is the extension.

- **FAFF-566 injection-through-trusted-content.** Out of the audit's own scope boundary.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Committed anchor | `.faff/anchors/<basename(run-dir)>/<ISSUE>/run-ledger.json`, a byte-copy of the minted ledger committed + pushed with the PR head (graft Step 9b). Immutable at a given head sha. |
| Attested level | The `level` field read from the committed anchor at the observed PR head sha. The **only** value permitted to govern a merge's autonomy level. |
| Anchor-missing | A PR carries a run dir but no committed anchor blob exists at the head sha for `<run>/<ISSUE>` — the fail-closed condition (mirrors the Action's `anchor-missing-for-run-dir`). |
| Retrospective floor | For an already-merged PR: AC + review + (at L4) holdout + integrity, re-derived from persisted artifacts, **excluding live CI** (the forge gated CI at merge time). |
| Owned + malformed | F4's intersection: this session provably owns the run via a signal needing no ledger content, AND the ledger fails to parse/audit. |

**The integrity enum** (the four states `resolveIntegrity`, `merge-gate.js:319-329`, produces; the values `decideFloor` keys on):

```
ENUM FloorIntegrity: "asserted" | "unasserted-ok" | "unasserted-refuse" | "violated"
  # "violated"          → declaration exists but failed verification → blocks at EVERY level
  # "unasserted-refuse" → no declaration on a run resolved as L4       → blocks (defence-in-depth)
  # "asserted" | "unasserted-ok"                                       → never block
```

**F1 — anchor-level resolution (new helper + reordering + two consumption-site edits):**

```
RECORD AnchorLevel:
  level: FloorLevel | null       # the attested governing level, or null if unresolved
  status: "ok" | "anchor-missing" | "anchor-malformed" | "anchor-unreadable"   # -unreadable = read denied (403/narrow token), distinct from -missing (404/absent)
  source: string                 # "git-show" | "contents-api" | null — for the emitted diagnostic

PROCEDURE resolveAnchorLevel(cwd, repo, runDir, issue, headSha) -> AnchorLevel
  # PURE beyond one git/gh read. Reads the head-sha-pinned committed blob, never the live ledger.
```

**F2 — integrity added to the fixed contract.** New enum beside the existing floor enums (`contract-defs.js:1570-1574`):

```
CONST FLOOR_INTEGRITY = ["asserted", "unasserted-ok", "unasserted-refuse", "violated"]
```

`computeIntegrityFloor` (`contract-defs.js:1616`) gains one validated, level-aware field (§4).

**F1b — governance-check level derivation.** `evaluateAnchorDir` (`governance-check.js:221`) derives `level` from the anchor's own `run-ledger.json` rather than the `--level` flag default.

**F3 / F4** introduce no new types (§4).

**Design decisions** are collected in §6; each explore-flagged ambiguity is resolved there with a `**Chosen:**` (or `**Punt:**`) marker.

---

## 4. HOW — Behaviour

### F1 — a writable ledger cannot reduce an L4 merge decision

**Summary:** merge-gate resolves the governing autonomy level from the committed anchor at the observed PR head sha, not from the live writable ledger. A live rewrite of `run-ledger.json` (even with a coordinated valid events-chain append) therefore has no effect on the level; the attacker would have to push a new commit to change the anchor, which changes the head sha, re-runs the required `governance-check`, and is visible in the PR diff.

**The new resolver** (in `merge-gate.js`, using the existing `gitRun`/`ghJson` helpers):

```
PROCEDURE resolveAnchorLevel(cwd, repo, runDir, issue, headSha):
  anchorPath := ".faff/anchors/" + basename(runDir) + "/" + issue + "/run-ledger.json"
  # PRIMARY: local git object store — merge-gate runs from the checkout/worktree that
  # just pushed headSha, so the blob object is present.
  r := gitRun(cwd, ["show", headSha + ":" + anchorPath])
  IF r.ok:
    parsed := tryParseJson(r.stdout); source := "git-show"
  ELSE:
    # FALLBACK: pure-remote merge-gate path with no local object for headSha.
    api := ghJson(["api", "repos/" + repo + "/contents/" + anchorPath + "?ref=" + headSha, "--jq", ".content"])
    IF api failed:
      # Distinguish a genuinely-absent anchor (HTTP 404) from a read DENIED (HTTP 403 / a narrow token
      # lacking `contents:read`) — both fail closed (exit 2), but the operator remedy differs, so the
      # status must not conflate them (the revise-minor from spec-review iteration 2).
      IF api.httpStatus == 403 OR api is a permission/auth error:
        RETURN { level: null, status: "anchor-unreadable", source: "contents-api" }
      RETURN { level: null, status: "anchor-missing", source: null }   # 404 / empty / not-found
    parsed := tryParseJson(base64decodeStripNewlines(api.data)); source := "contents-api"
  IF parsed failed:                       RETURN { level: null, status: "anchor-malformed", source }
  IF parsed.level NOT in FLOOR_LEVELS:    RETURN { level: null, status: "anchor-malformed", source }
  RETURN { level: parsed.level, status: "ok", source }
```

**PR-path reordering** (`cmdMergeGate`). Today the order is: live-ledger level (`:777-783`) → integrity (`:809`) → repo slug (`:811`) → `gh pr view` head sha (`:815-817`) → MERGED short-circuit (`:819`) → floor (`:825+`). The head sha is resolved *after* the level, so anchor resolution (which needs the head sha) requires this reorder:

```
1. arg validation + human-flag fence            # unchanged (:771-795)
2. repo := ghRepoSlug(repoFlag)                  # MOVED UP from :811-812; refuse exit 2 if unresolved
3. hv := gh pr view <pr> --json headRefOid,headRefName,state,url   # MOVED UP from :815-817
   headSha := hv.data.headRefOid                 # refuse exit 2 on identity failure (unchanged check)
4. anchor := resolveAnchorLevel(cwd, repo, runDir, issue, headSha)      # REPLACES live-ledger read (:777-779)
   IF anchor.status != "ok":
     # Remedy differs by status: anchor-missing/anchor-malformed → re-anchor (graft Step 9b);
     # anchor-unreadable → the pure-remote invocation's forge token lacks `contents:read` for the
     # anchor path (grant the scope, or run merge-gate from a checkout that has the head-sha object so
     # the primary `git show` path is used). Never fall back to the live ledger for level.
     write "faff merge-gate: no trusted committed anchor level for run <basename(runDir)> issue <issue> at head <headSha> "
           + "(" + anchor.status + ") — "
           + (anchor.status == "anchor-unreadable"
                ? "the forge token cannot read .faff/anchors/…/run-ledger.json (grant contents:read, or invoke from a checkout with the head-sha object)"
                : "re-anchor (graft Step 9b) so the PR carries .faff/anchors/…/run-ledger.json, or merge at the forge")
           to stderr
     RETURN 2                                     # FAIL-CLOSED: never fall back to the live ledger
   ledgerLevel := anchor.level
5. { level, mismatch } := resolveGateLevel(ledgerLevel, flagLevel)     # UNCHANGED resolver
   IF mismatch:                                   # FAFF-424 guard, now anchor-vs-flag
     write "faff merge-gate: --level <flagLevel> contradicts the committed anchor level <ledgerLevel> "
           + "at head <headSha>; the anchor governs — drop --level or pass --level <ledgerLevel>" to stderr
     RETURN 2
6. integrity := resolveIntegrity(runDir, issue, level)   # MOVED DOWN from :809 — needs the anchor level
7. IF hv.data.state == "MERGED":  alreadyMergedReconcile(...)          # F3 (below)
8. ci := observeCi(...); floor := {…, level, holdout: level=="L4"?…, integrity: integrity.state}
   decideFloor(floor); execute-or-refuse          # unchanged (:825+)
```

`resolveGateLevel` (`contract-defs.js:1609-1614`) is unchanged and retained: the level fed to it is now the **anchor** level, and the mismatch leg now guards a `--level` flag that contradicts the *anchor* (not the live ledger). The live `tryReadLedger`/`ledger.level` read at the level-resolution site is **removed** — the live ledger is no longer a level source on this path.

**`--local`-path change** (`cmdMergeGateLocal`, `:580-586`). No PR/`gh`; resolve the branch head sha from the local tree (`git rev-parse <branch>`, where `branch` is resolved at `:588` — reorder so the branch resolves before the level) and read the anchor via `git show <sha>:<anchorPath>` (local object store; no API fallback). Same `anchor.status != "ok"` → refuse exit 2, same anchor-vs-`--level` mismatch guard. The live-ledger level read at `:580-582` is removed.

**Chosen design decisions** (explore ambiguities 1-3, 5):
- *Level source (ambiguity 1):* the committed anchor at the observed head sha, read via `git show` (primary) / Contents API `?ref=<headSha>` (fallback). The FAFF-424 `--level` mismatch guard is retained, re-pointed to the anchor.
- *No-anchor fallback (ambiguity 2):* **refuse, exit 2**, naming the missing anchor. merge-gate NEVER falls back to the live ledger for level (that reopens the hole). The remedy is to re-anchor (re-run graft Step 9b so the PR carries the anchor) or merge at the forge — the same fail-closed posture the `no-ci-coverage`/`not-ready` legs already take, and the same condition the Action flags as `anchor-missing-for-run-dir`. An operator `--level` override is deliberately NOT offered as an escape here (it would be a build-lane-writable downgrade lever); the escape is re-anchoring, which produces committed evidence.
- *Anchor-vs-live / the floor (ambiguity 3):* the anchor is the governing **floor** and always wins; a live ledger claiming a *higher* level never raises the resolved level. Since `lights-out` is the sole mint path and always mints `level:"L4"` (`lights-out.js:957`) with no in-run escalation code path, the anchor and a genuine live ledger agree at L4; a downgrade attack lowers the *live* ledger while the anchor stays L4, so the resolved level stays L4 and the L4 holdout+integrity legs fire. A legitimately-changed run is re-anchored before merge (below).
- *Staleness caveat (ambiguity 5):* the anchor reflects **what the PR carries**, not the live run — the same documented limitation as `governance-check`'s snapshot-divergence (`docs/guide/governance-check.md`). **Chosen:** accept it; merge-gate governs on the anchor as-committed, and any legitimate post-anchor change requires re-anchoring (re-running Step 9b) before merge-gate. For `level` specifically this is a non-issue (level is mint-only and never legitimately changes mid-run); the caveat is stated so a future level-escalation feature knows it must re-anchor.

**Failure modes:**
- *The failure:* a genuine PR refuses with `anchor-missing` because merge-gate ran from a checkout lacking the head sha object AND the Contents API call failed (auth/outage). *How you'd know:* exit 2 naming `anchor-missing` on a PR whose anchor is visibly committed. *What it means:* narrow — the primary `git show` covers the graft/checkout case; the API fallback covers pure-remote; a double-failure is a transient tool outage (indeterminate), correctly fail-closed (refuse, retry), never a silent merge.
- *The failure:* the anchor read is spoofable if `basename(runDir)` merge-gate computes differs from what graft committed. *How you'd know:* `anchor-missing` on a run that WAS anchored. *What it means:* both use `basename(run_dir)` over the same run dir; verified identical. Proceed.

**Anti-pattern:** falling back to `tryReadLedger(runDir).level` when the anchor is missing/malformed. Why: that is the exact hole — the live ledger is the attacker-writable substrate. Missing/malformed anchor → refuse.

**Anti-pattern:** trusting the events chain or `chain-head.json` as the level's integrity root. Why: both are self-consistent-by-construction and re-mintable in the same writable dir (the coordinated-append attack that rejected F1's first approach). Only the head-sha-pinned committed blob is trustworthy.

### F1b — governance-check derives level from the anchor (defence-in-depth)

**Summary:** the required, branch-protection-gated `governance-check` merge-floor leg derives `level` from the anchor's own committed `run-ledger.json`, so the CI check and merge-gate consult the same head-sha-pinned truth and cannot disagree — an L4-anchored PR then has its holdout leg enforced by CI independently of whether merge-gate is invoked.

In `evaluateAnchorDir` (`governance-check.js:221`, today `level = "L3"` default from the `--level` flag at `:511`):

```
1. anchorLevel := (read <dir>/run-ledger.json; if parseable AND .level in FLOOR_LEVELS) ? .level : null
2. effectiveLevel := anchorLevel ?? levelFlag         # anchor governs; flag only when the anchor has no usable level
3. pass effectiveLevel into evaluateMergeFloorLeg(dir, ".", effectiveLevel)   # unchanged leg; now L4-aware for L4 anchors
```

**Chosen (ambiguity 4): in scope, bounded.** This is the same class of fix as F1a — replacing a caller-supplied/live input with head-sha-pinned committed evidence — and it is CI-tooling/bug-class (the check trusting a caller `--level` input rather than the committed ledger it already re-reads), not a prose autonomous-posture flip, so it is not in the eval-sweep-gated class. It only *strengthens*: an L4-anchored PR that produced a `meets-spec` holdout still passes; one that didn't (and shouldn't merge) now fails the required check. Non-L4/legacy/anchor-without-level anchors keep today's `--level`-flag behaviour (fail-closed to the flag, unchanged). The anchor's ledger is the committed byte-copy, so deriving level from it is as trustworthy as F1a's read.

### F2 — the `integrity-floor` contract consumes its integrity leg

**Summary:** `computeIntegrityFloor` validates `extraction.integrity` against the enum and forwards it into the record `decideFloor` receives, with a level-aware fail-closed default for an absent key, so the leg can never again be dead code and the contract matches the runtime.

In `computeIntegrityFloor` (`contract-defs.js:1616-1632`), after the `holdout` validation and before building `f`:

```
1. integrity := e.integrity
2. IF integrity == undefined:
     integrity := (e.level == "L4") ? "unasserted-refuse" : "unasserted-ok"   # mirrors resolveIntegrity (merge-gate.js:326)
3. ELSE IF integrity NOT in FLOOR_INTEGRITY:
     RETURN fail-loud: 'integrity <x> not in {asserted,unasserted-ok,unasserted-refuse,violated}'
4. f := { ...existing fields..., integrity }     # integrity now REACHES decideFloor
```

`decideFloor` (`:1587-1599`) is unchanged — its `violated` (`:1596`) and `unasserted-refuse` (`:1597`) blockers become reachable through the contract for the first time.

**Chosen (ambiguity 5): level-aware fail-closed default, not permissive.** Absent `integrity` at L4 → `unasserted-refuse` (blocks), exactly what `resolveIntegrity` produces at L4; below L4 → `unasserted-ok` (no-op). This is the opposite polarity from a permissive default and is the point of F2.

**Fixture consequences** (all mechanical, all in this ticket, `contract-defs.js:1647-1665`):
- The 13 sub-L4 fixtures omit `integrity` → default `unasserted-ok` (no-op) → `wantExit` unchanged; verify each still passes.
- `l4-holdout-meets-spec` (`:1657`, `wantExit:0`) gains explicit `integrity:"asserted"` (else the L4 default would flip it to exit 1).
- `l4-holdout-missing` (`:1658`), `l4-holdout-blocked` (`:1659`) stay `wantExit:1`; give them explicit `integrity:"asserted"` so the holdout leg remains the only blocker (isolation).
- New fixtures: `l4-integrity-absent-refuses` (L4, else green, no `integrity` → exit 1); `integrity-violated-refuses-at-L3` (L3, else green, `integrity:"violated"` → exit 1); `l4-integrity-unasserted-refuse` (L4, else green, `integrity:"unasserted-refuse"` → exit 1); `l4-integrity-asserted-ok` (L4, holdout meets-spec, `integrity:"asserted"` → exit 0); `fail-loud-bad-integrity` (`integrity:"maybe"` → exit 2).

### F3 — already-merged reconciliation proves the floor before writing success evidence

**Summary:** the already-MERGED short-circuit (`merge-gate.js:819-823`) re-derives the retrospective floor (AC, review, at-L4 holdout, integrity) from persisted artifacts and only writes `merge-record.json` + returns `merge-ok` when it passes; otherwise it returns `refuse` (exit 1) and writes no success evidence. It still never spawns `gh pr merge` (idempotency preserved).

```
PROCEDURE alreadyMergedReconcile(runDir, issue, pr, headSha, level, integrity):
  1. reasons := []
  2. IF NOT readAcComplete(runDir, issue):            reasons.push("ACs not all verified")
  3. rv := readReviewVerdict(runDir, issue)
     IF rv != "pass":                                 reasons.push("review verdict is " + rv)
  4. IF level == "L4":
       h := readHoldout(runDir, issue)
       IF h != "meets-spec":                          reasons.push("L4 holdout: " + h)
  5. IF integrity.state == "violated":                reasons.push("corrective-artifact integrity violated")
     IF integrity.state == "unasserted-refuse":       reasons.push("corrective-artifact integrity unasserted at L4")
  6. IF reasons is empty:
       writeMergeRecord(runDir, issue, pr, headSha, integrity.display)
       RETURN emit({ verdict:"merge-ok", merged:true, blockers:[],
                     ci_state:"not-observed-already-merged",       # DISTINCT sentinel, never fed to decideFloor
                     head_sha:headSha, integrity:integrity.display, note:"already merged" }, 0)
  7. RETURN emit({ verdict:"refuse", merged:true, blockers:reasons,
                   ci_state:"not-observed-already-merged",
                   head_sha:headSha, integrity:integrity.display,
                   note:"already merged but merge-floor not satisfied — no success evidence written" }, 1)
     # NO writeMergeRecord — no success evidence for an unproven merge
```

Steps 2-5 are the run-substrate legs of `decideFloor`, re-derived through merge-gate's **own** readers (the same functions `governance-check.js`'s `evaluateMergeFloorLeg` calls — no forked rule).

**Chosen answers (ambiguity 4 + QA minors):**
- *Applicable floor:* the retrospective run-substrate floor (AC + review + at-L4 holdout + integrity), re-derived from persisted artifacts. Not a fresh live evaluation.
- *CI re-observation:* **excluded.** CI on a merged PR is unobservable, and the forge's branch protection already required CI-green to permit the merge — the same forge-side backstop the floor already leans on (`merge-gate.js:42-46`). The skip is made **observably distinct** from a stale-CI-evaluation bug: the branch emits `ci_state:"not-observed-already-merged"` (a display-only sentinel, never passed to `decideFloor`), so a test asserting this value proves the skip was intentional, not an accidental `n/a` from a broken CI read. **An already-MERGED PR whose CI would now read red/failed is still `merge-ok` iff the retrospective floor passes** — CI is deliberately not consulted, because the forge already gated it at merge time and the code is already on `main`.
- *L4 holdout:* **yes** (step 4) — an already-merged L4 PR with no fresh, run-scoped `meets-spec` holdout returns `refuse` and mints no success evidence.

**Anti-pattern:** `require("./governance-check")` from `merge-gate.js`. Why: `governance-check.js:38` already requires `./merge-gate`; the reverse import cycles. Re-derive inline with merge-gate's own `readAcComplete`/`readReviewVerdict`/`readHoldout`.

### F4 — a malformed owned ledger fails closed at the Stop-hook boundary

**Summary:** at both silent-swallow points, when the ledger cannot be parsed/audited **but this session provably owns the run via a signal needing no ledger content** (the `FAFF_RUN_DIR` env pointer resolving-equal to the hook's `runDir`), the hook hard-blocks instead of returning success. Foreign and ownership-unprovable cases stay exactly as today.

New predicate (the env-pointer clause of `runIsOwned`, extracted to work with **no** ledger object):

```
PROCEDURE ownedByEnvPointer(runDir, env):
  RETURN !!(env.FAFF_RUN_DIR && runDir && resolve(env.FAFF_RUN_DIR) == resolve(runDir))
```

**Point 1 — `runcheckHookDecision` auditLedger catch** (`runcheck.js:160-161`; the object parsed but `auditLedger` threw, e.g. `outcomes` non-object at `:35`):

```
try { result := auditLedger(ledger, ledger.run_id ?? basename(runDir)) }
catch {
  owned := runIsOwned(ledger, runDir, env)          # object present → both clauses usable
  IF owned:  RETURN { block:true, warn:false, reason: malformedOwnedReason(runDir), owned:true, held:false }
  RETURN { block:false, warn:false, owned:false, held:false }   # foreign/unprovable → silent (unchanged)
}
```

**Point 2 — hook entry readLedger catch** (`runcheck.js:205-206`; JSON did not parse OR the file was unreadable — `readLedger` (`shared-infra.js:232`) does `JSON.parse(fs.readFileSync(...))`, so both throw here; there is NO ledger object):

```
let ledger
try { ledger := readLedger(runDir) }
catch {
  IF ownedByEnvPointer(runDir, process.env):
    console.log(JSON.stringify({ decision:"block", reason: malformedOwnedReason(runDir) }))
    RETURN 0     # exit 0; the block PAYLOAD on stdout is the Stop-hook block mechanism (parity with :213)
  RETURN 0       # foreign/unprovable (no env pointer) → silent (unchanged)
}
```

`malformedOwnedReason(runDir)` — a distinct string: `"faff runcheck: the owned run ledger at <runDir> is malformed/unreadable — the completion backstop cannot confirm the build queue drained; fix or remove the ledger before stopping (owned session, fail-closed)."`

**Chosen (ownership signal):** on a *parse/read* failure (point 2) ownership is established **only** via `ownedByEnvPointer` (no parsed `owner` to match on session id); on an *audit* failure (point 1) full `runIsOwned` is used (the object parsed). This is the strongest ownership signal available at each point without trusting tampered content.

**Foreign-session invariant (must hold):** a non-owner (no `FAFF_RUN_DIR` match, and — at point 1 — no `owner.session_id` match) on a malformed ledger returns silent, exactly as today. No added path can hard-block a non-owner.

**Failure mode:** *the block payload with exit 0 doesn't actually block the Stop hook.* *How you'd know:* the shipped block path (`:213`) uses exactly this shape (`console.log({decision:"block",…})` then `return 0`), so parity is proven by the live mechanism. Proceed.

---

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run whose committed anchor (.faff/anchors/<run>/<ISSUE>/run-ledger.json at the PR head sha) records level L4, and whose LIVE run-ledger.json has been rewritten to L1 AND had a fresh valid ledger-write appended to events.jsonl (the coordinated-append attack)
When faff merge-gate runs on that PR with no --level flag
Then it resolves level L4 from the committed anchor (ignoring the live ledger entirely), enforces the L4 holdout + integrity legs, and — with the holdout absent — refuses (exit 1) naming the L4 holdout; the live tamper has no effect
```

```
Given a PR that carries a run dir but no committed anchor at the head sha (anchor-missing)
When faff merge-gate runs on it
Then it refuses (exit 2) naming the missing anchor, and never reads the live ledger for level and never merges
```

```
Given an anchor recording L4 and an explicit --level L3 on the invocation
When faff merge-gate runs
Then it refuses (exit 2) with the mismatch error naming the anchor level L4 (the anchor governs; a flag may only agree)
```

```
Given an integrity-floor extraction with integrity:"violated" at any level, or absent integrity at level L4
When faff contract integrity-floor evaluates it (and under --selftest)
Then it refuses (exit 1) with the integrity blocker — the leg is live, not dead code
```

```
Given a PR already in state MERGED whose retrospective run-substrate floor is NOT satisfied (e.g. AC incomplete, or L4 holdout missing)
When faff merge-gate runs against it
Then it returns refuse (exit 1) with the failing legs as blockers, ci_state "not-observed-already-merged", writes NO merge-record.json, and never spawns gh pr merge
```

```
Given a PR already in state MERGED whose retrospective floor IS satisfied, and whose live CI would now read red (irrelevant — not observed)
When faff merge-gate runs against it
Then it returns merge-ok (exit 0, note "already merged", ci_state "not-observed-already-merged"), writes merge-record.json, and never spawns gh pr merge (CI is deliberately not re-observed; the forge gated it at merge time)
```

```
Given a run this session owns (FAFF_RUN_DIR resolves-equal to the run dir) whose run-ledger.json is corrupt (unparseable JSON, or outcomes a non-object)
When the runcheck Stop hook fires in that session
Then it emits a {decision:"block"} payload naming the malformed owned ledger, instead of silently returning success
```

- **Non-functional:** the coordinated-append attacker (rewrite live ledger + append valid chain record) MUST be closed, not residual — the only residual attack on the level is pushing a new commit that changes the committed anchor, which changes the head sha, re-runs the required governance-check, and is visible in the PR diff.
- Each of the four findings lands a **direct regression fixture** reproducing its original subversion and asserting the closure.

---

## 6. Design Decision Rationale

**F1 — trust root for the autonomy level.** Options: (a) live `run-ledger.json` (status quo — the bug); (b) the events.jsonl `ledger_fold` / `chain-head.json` (F1's rejected first approach); (c) the committed per-PR anchor at the observed head sha. (a) is attacker-writable. (b) is self-consistent-by-construction and re-mintable in the same writable dir — the coordinated-append attacker defeats it, and `chain-head.json` is just another re-mintable local file. **Chosen:** (c) — the anchor blob is git content-addressed and immutable at the head sha; mutating it forces a new head sha, re-runs the required branch-protection-gated `governance-check`, and shows in the PR diff. Rejected (b) is documented so it is not re-proposed.

**F1 — no-anchor fallback (ambiguity 2).** Options: (a) fall back to the live ledger; (b) refuse exit 2; (c) allow an operator `--level` override under a real TTY. (a) reopens the exact hole. (c) makes `--level` a downgrade lever the build lane can set. **Chosen:** (b) — refuse, naming the missing anchor; the remedy is re-anchoring (committed evidence), mirroring the Action's `anchor-missing-for-run-dir` and the existing `no-ci-coverage` fail-closed posture.

**F1 — anchor-vs-live and escalation (ambiguity 3).** **Chosen:** the anchor is the governing floor and always wins; a live ledger claiming higher never raises it. Justified by the verified invariant that `lights-out` is the sole mint path, always `level:"L4"` (`:957`), with no in-run escalation path — so anchor and genuine live agree, and a downgrade only lowers the (ignored) live copy. A future escalation feature must re-anchor before merge.

**F1 — read mechanism.** **Chosen:** `git show <headSha>:<anchorPath>` via the existing `gitRun` (primary, covers the graft/checkout case), with `gh api …/contents/<path>?ref=<headSha>` via `ghJson` (fallback, pure-remote). Both tools already exist in `merge-gate.js`; no new dependency.

**F1b — governance-check level derivation (ambiguity 4).** Options: in-scope vs named follow-up. **Chosen:** in scope, bounded — same fix class as F1a (committed evidence over a caller/live input), CI-tooling/bug-class (not an eval-gated prose posture flip), only strengthens, and makes the required CI check and merge-gate consult the same pinned truth so they cannot disagree.

**F1 — staleness (ambiguity 5).** **Chosen:** accept the snapshot-divergence limitation (documented, mirroring `docs/guide/governance-check.md`); re-anchor before merge for any legitimate post-anchor change. Non-issue for `level` (mint-only).

**F2 — integrity default (ambiguity 5, F2).** Options: hard-required (breaks 16 fixtures + omitting callers), permissive (is the vulnerability), level-aware fail-closed. **Chosen:** level-aware fail-closed — matches `resolveIntegrity` runtime semantics, leaves the 13 sub-L4 fixtures untouched, needs explicit `integrity` only on the 3 L4 fixtures, and makes the leg fire.

**F3 — applicable floor + CI exclusion (ambiguity 4, F3 + QA).** **Chosen:** retrospective run-substrate floor (AC/review/at-L4 holdout/integrity), CI excluded (forge branch-protection already gated it), skip made observable via the `not-observed-already-merged` sentinel so it is distinguishable from a stale-CI bug; success evidence conditional on the floor.

**F4 — fail-closed on owned+malformed.** **Chosen:** establish ownership by a content-independent signal (`FAFF_RUN_DIR` env pointer) and hard-block only on the owned+malformed intersection; foreign/unprovable stay silent. `prepcheck`'s `tryReadLedger` fails safe toward not-holding, so there is no pattern to copy — this is designed here.

**Audit re-run (ambiguity 6).** **Chosen:** out of scope for born-verifiable ACs; a human-triggered follow-up on the ticket's Done list.

**Retired punt — whole-ledger deletion.** F1's first approach left "delete the live ledger entirely" as a punt. With level sourced from the committed anchor, deleting the live `run-ledger.json` is irrelevant to level resolution (the anchor governs; an absent live ledger no longer downgrades to a flag/L3 default because the live ledger is no longer consulted for level). **Retired** — no longer a punt.

---

## 7. Open Questions and Assumptions

**Open Questions:** none. (F1's approach is verified against shipped mechanisms; every ambiguity is resolved with a Chosen; the prior whole-ledger-deletion punt is retired.)

**Assumptions** (each with a validation instruction):

- **Assumes** the committed anchor exists at the PR head sha for every PR that reaches merge-gate carrying a run dir (graft Step 9b ran and pushed). *Validation:* confirmed live at `faff-graft/SKILL.md:431` + `.gitignore:22`; when it does not hold, F1's fail-closed no-anchor refusal (exit 2) is the correct behaviour, so a missing anchor never fails open.
- **Assumes** the repo has branch protection requiring `governance-check` (FAFF-562). *Validation:* confirmed in the `main` ruleset since 2026-07-26 (`required_status_checks` = validate, governance-check, env-rootless). **Caveat for F3:** on a repo with **no** branch protection enabled, the forge did NOT gate CI at merge time, so F3's "CI-green-by-construction" assumption does not hold — F3's retrospective floor still enforces AC/review/holdout/integrity, but cannot assume CI was green. This is a documented limitation, stated in the F3 DoD; it does not weaken the run-substrate legs.
- **Assumes** `merge-gate` runs from a checkout/worktree whose git object store contains the observed head sha (the common graft/ship path). *Validation:* the head sha was just pushed from that worktree; the Contents-API fallback covers the pure-remote path. Run the F1 integration fixture (seeded local repo + committed anchor + stubbed `gh pr view`) to confirm `git show` resolves the blob.
- **Assumes** the pure-remote invocation's forge token carries `contents:read` for the anchor path (only the Contents-API fallback needs it; the primary `git show` path does not). *Validation:* the fallback distinguishes HTTP 403 (`anchor-unreadable` → remedy: grant the scope, or run from a checkout with the head-sha object) from HTTP 404 (`anchor-missing` → remedy: re-anchor), so a narrow-token pure-remote run fails closed with the correct remedy rather than a misdirecting "re-anchor" message. The mainline L4 graft/ship flow uses `git show` and is unaffected. (spec-review iteration-2 revise-minor, applied.)
- **Assumes** the four states in `FLOOR_INTEGRITY` are exactly what `resolveIntegrity` can emit. *Validation:* confirmed against `merge-gate.js:319-329`; re-grep before finalising the enum.
- **Assumes** a Stop-hook block is signalled by a `{decision:"block",…}` line on stdout with exit 0. *Validation:* confirmed against the shipped block path `runcheck.js:213`.

---

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] The governing autonomy level in merge-gate is resolved from the committed anchor at the observed head sha; the live `run-ledger.json` and the events chain are never a level source (diff-confirmed: the `tryReadLedger(...).level` level read is removed from both consumption sites).
- [ ] Only merge-gate (F1) and `governance-check` (F1b) derive level from the anchor; unrelated ledger readers are unchanged (diff-confirmed).

### From HOW — F1 (behaviour)
- [ ] The coordinated-append attack (live ledger rewritten L4→L1 + a fresh valid `ledger-write` appended) → `faff merge-gate` (no `--level`) resolves L4 from the anchor and refuses (exit 1) naming the L4 holdout; the live tamper has no effect.
- [ ] A PR carrying a run dir with no committed anchor at the head sha → exit 2 naming the missing anchor; no live-ledger fallback; no merge.
- [ ] An unreadable/malformed anchor blob → exit 2 (`anchor-malformed`).
- [ ] A clean L4 run (anchor L4, live consistent, floor satisfied) → merges as a genuine L4 merge (no regression); an equivalent clean L3-anchored run behaves as before.
- [ ] An explicit `--level` contradicting the anchor level → exit 2 with the mismatch error naming the anchor level.
- [ ] Both the PR path (`cmdMergeGate`) and the `--local` path (`cmdMergeGateLocal`) source level from the committed anchor (PR path: `git show` primary + Contents-API fallback; `--local`: `git show <branch-head>` local only), with identical fail-closed behaviour.
- [ ] The PR-path reorder is correct: repo slug + `gh pr view` head sha resolve before anchor-level resolution, and `resolveIntegrity` resolves after it (using the anchor level).

### From HOW — F1b (behaviour)
- [ ] `evaluateAnchorDir` derives `level` from the anchor's own `run-ledger.json` (`.level` in `FLOOR_LEVELS`), falling back to the `--level` flag only when the anchor has no usable level; an L4-anchored PR with no `meets-spec` holdout FAILs the merge-floor leg; a non-L4/legacy anchor is unchanged from today.

### From HOW — F2 (behaviour)
- [ ] `computeIntegrityFloor` validates `integrity` against `FLOOR_INTEGRITY` (bad value → fail-loud exit 2) and forwards it into `f`.
- [ ] Absent `integrity` defaults to `unasserted-refuse` at L4 (blocks) and `unasserted-ok` below L4 (no-op).
- [ ] `faff contract integrity-floor` refuses (exit 1) for `integrity:"violated"` (any level) and for absent/`unasserted-refuse` integrity at L4.
- [ ] The 13 sub-L4 fixtures pass unchanged; the 3 L4 fixtures carry explicit `integrity`; the 5 new integrity fixtures are added and green under `--selftest`.

### From HOW — F3 (behaviour)
- [ ] An already-MERGED PR on an unsatisfied retrospective floor → exit 1 refuse, blockers name the failing legs, `ci_state:"not-observed-already-merged"`, NO `merge-record.json`, no `gh pr merge`.
- [ ] An already-MERGED PR on a satisfied retrospective floor → exit 0 merge-ok (note "already merged", `ci_state:"not-observed-already-merged"`), `merge-record.json` written, no `gh pr merge`.
- [ ] An already-MERGED PR whose live CI would read red but whose retrospective floor passes → still exit 0 merge-ok (CI not observed) — a born-verifiable test asserts both `ci_state:"not-observed-already-merged"` and that no CI-observation path ran on this branch.
- [ ] At L4, an already-MERGED PR with no fresh `meets-spec` holdout → refuse.
- [ ] F3 re-derives inline via merge-gate's own readers; `merge-gate.js` does not `require("./governance-check")`.
- [ ] The no-branch-protection caveat is documented at the F3 change site (retrospective floor cannot assume CI was green when the repo has no branch protection).

### From HOW — F4 (behaviour)
- [ ] A corrupt ledger this session owns via `FAFF_RUN_DIR` → the hook emits a `{decision:"block"}` payload naming the malformed owned ledger, at both the parse/read-throw point (`:206`) and the audit-throw point (`:161`).
- [ ] A corrupt ledger in a FOREIGN session (no env-pointer match, no `owner.session_id` match) → silent, unchanged.
- [ ] Every existing `RUNCHECK_SELFTEST_CASES` case still passes (foreign held/warn/silent semantics byte-identical).

### From WHAT (regression fixtures — supersession, not accretion)
- [ ] **F1:** `test/merge-gate.test.mjs:116` ("a MATCHING forged --level L1 is accepted … residual gap is the caller's discipline") is **superseded** — rewritten so a live-ledger level (forged, no matching committed anchor) is **refused** (exit 2, `anchor-missing`), with its comment updated to state the trust root is now the committed anchor.
- [ ] **F1:** the FAFF-424 controlflow tests that seed a live ledger via `writeLedger()` and expect the level derived from it (`test/merge-gate-controlflow.test.mjs:217-291`, incl. the `--check-only` mismatch case at `:283`) are **superseded** — reworked to seed a committed anchor (init a temp git repo, commit `.faff/anchors/<run>/<ISSUE>/run-ledger.json` at a sha, stub `gh pr view` → that sha) so they exercise anchor-sourced level; a live-ledger-only fixture now asserts `anchor-missing` refusal.
- [ ] **F1 (money fixture):** a coordinated-append regression fixture — committed anchor level L4 at the head sha, then the live `run-ledger.json` rewritten to L1 **and** a fresh valid `ledger-write` appended — asserts merge-gate resolves L4 and enforces the L4 holdout (refuse), proving the append is inert.
- [ ] **F3:** `test/merge-gate-controlflow.test.mjs:184-193` (already-MERGED short-circuits before decideFloor, seeding a refuse floor) is **superseded** — rewritten so a refuse floor + already-merged → exit 1, no `merge-record.json`; a companion asserts merge-ok floor → exit 0 + record; `test/merge-gate-controlflow.test.mjs:519-526` (merge-ok floor already-MERGED zero-effect-ledger) still passes.
- [ ] **F2:** the `violated` and absent-at-L4 fixtures land in the `integrity-floor` fixture table.
- [ ] **F4:** `RUNCHECK_SELFTEST_CASES` gains an owned+malformed (`outcomes:[]`, `FAFF_RUN_DIR` match) → block case and a foreign+malformed → silent case; **and** a CLI/integration test in `test/runcheck-gate.test.mjs` covers the parse/read-throw owned-block path the pure selftest cannot reach — it spawns `faff runcheck --hook` (via the repo's `runCli` helper) with `FAFF_RUN_DIR` set to a run dir whose `run-ledger.json` is unparseable, and asserts a `{decision:"block"}` payload on stdout; a foreign variant (no `FAFF_RUN_DIR`) asserts silent.

### Follow-up (not a DoD item this spec's tests satisfy)
- [ ] (Human/team) Re-run the FAFF-435 adversarial audit against the merged fixes and update `verification/audits/…/audit-report.json`.

**Integration smoke test** (the "plumbing is connected" path):

```
PROCEDURE smoke():
  1. init a temp git repo; mint/seed a run dir; write .faff/anchors/<run>/<ISSUE>/run-ledger.json {level:"L4"},
     git add (carve-out) + commit → capture headSha
  2. seed the live run dir: AC=complete, review=pass, fresh meets-spec holdout, integrity asserted
  3. stub gh: `pr view` → { headRefOid: headSha, state: "OPEN" }; run
     `faff merge-gate --pr <n> --issue X --run-dir D --repo R --json` (no --level)
     → level resolved L4 from the committed anchor, holdout evaluated, verdict merge-ok
  4. rewrite the LIVE run-ledger.json level → "L1" and append a fresh valid ledger-write to events.jsonl
  5. re-run step 3 → still resolves L4 from the anchor; delete the live holdout first → refuse (exit 1)
     naming the L4 holdout, proving the live tamper + coordinated append are inert
```

## Methodology critique

- **Right-sized:** one coherent security-hardening unit (1–3 days) — the four findings are a single audit's residue in one trust surface (merge-floor + the runcheck backstop), and F1/F1b/F2/F3 share the "bind trust to committed/validated evidence, fail closed" spine, so splitting would fragment one theme. F4 is small and adjacent (the same run-ledger trust surface). No merge-with-sibling and no split indicated.
- **Workstream fit:** directly serves the ticket's project (T5 — proven in anger): FAFF-435 cannot report a clean hardened-L4 result until these close, so this is the load-bearing item on that exit criterion.
- **Dependencies:** relies only on **already-shipped, verified** mechanisms (FAFF-568/623 committed anchor, FAFF-562 required check) — named as preconditions, not unfinished blockers, so no `blockedBy` edge is needed. The FAFF-435 audit re-run is a downstream human follow-up, correctly out of this ticket's DoD.
- **Risk:** the material risk is git-reference/trust-boundary handling (F1). It is made observable by the coordinated-append "money fixture" + the anchor-missing/-unreadable/-malformed cases, so no separate de-risking spike is warranted.

confidence: high

spec-review: approve (iteration 2 — approach confirmed sound; the sole revise-minor, 403≠404 on the Contents-API fallback + `contents:read` scope doc, applied in place)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
