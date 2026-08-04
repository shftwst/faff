# Frontier audit remediation plan — 2026-08-04

**What this is.** A ticket-ready plan derived from `2026-08-04-frontier-progress-and-coherence-audit.md` (findings) and its Appendix D (adversarial-review dispositions). It is a **guide for creating the tracker entries** — nothing here has been written to Linear yet. A later pass (any model) transcribes these into the FAFF team, honouring the "already exists → update, don't duplicate" callouts.

**Ground truth for the reconciliation below** was fetched first-hand from Linear this session: FAFF-690, FAFF-698, FAFF-704, FAFF-673, FAFF-381, FAFF-351, FAFF-127, FAFF-128. Where a ticket already exists, its **live status is quoted** so the transcriber updates rather than re-files.

**The one-line answer to "is it fully ticketed?":** the trust-critical cluster (Finding 1) **is** ticketed — FAFF-690 (Urgent), FAFF-698, FAFF-704, FAFF-673 all exist — but every one is **Backlog / never-started**, they lack decomposition into buildable units, and **Findings 2–5 have no fix tickets at all**. This plan supplies the decomposition and the four missing tickets.

---

## Reconciliation — finding → tracker state → gap

| Finding | Sev | Existing ticket(s) | Live status | Gap this plan fills |
|---|---|---|---|---|
| **1** — F1–F4 gate holes + P-S2-f | defect (1 Critical, 3 Major) | **FAFF-690** (parent), **FAFF-698**, **FAFF-704**, **FAFF-673** (enabler) | all **Backlog, never-started**; 690 Urgent, 698/704 High, 673 Medium | Decompose FAFF-690 into buildable children (§1); sequence 673→698; split 704 |
| **2** — ADR status rot recurred | drift | *none* | — | **New** ticket §2 |
| **3** — grounding contract absent | defect (latent) | FAFF-128 (consumer, blocked on it); FAFF-127 (Done, prematurely) | 128 Backlog | **New** ticket §3 |
| **4** — faff↔claude-box drift | drift (sec-adjacent) | **FAFF-381** (cage acceptance, now unblocked); FAFF-647 circles the rw-envelope | 381 Backlog | **New** faff-side ticket §4 + run 381 + claude-box-repo issues |
| **5** — labs comparative arm unrun | observation | experiment design exists; gated on cage (now landed) | — | Small hygiene ticket §5; the run itself is the study's own next step |
| nit — gateway "preview"+"shipped" same section | — | **FAFF-583** | Backlog | Already ticketed; leave as is |

**Critical path (build order):** §1 (T1.1 F2, T1.2 F4 — mechanical, parallel) → T1.3 F3 → **T1.4 F1** (needs a design decision first) → T1.5 fixtures → unblock FAFF-435 rerun. §2/§3/§4-docs run in parallel to all of it. FAFF-673's *decision* should land before FAFF-698's *build* (it sets 698's shape).

---

## §1 — L4 merge-floor integrity (Finding 1) — the priority

**Recommendation:** keep **FAFF-690** as the parent/epic (its Why + 6-item Done list are already well-formed and name the rerun) and create the five children below. Rationale: F1 is a design-heavy Critical while F2/F4 are mechanical Majors — kept in one ticket, the cheap fixes wait on the hard one, and it is a poor autonomous-build unit. Splitting lets F2/F4 ship immediately. *(If you'd rather keep 690 monolithic, the children below are still the DoD breakdown — just fold them back in.)*

### T1.1 — Merge floor: the `integrity-floor` contract must consume its `integrity` input (F2)
- **Type** bug · **Priority** High · **Labels** `faff-automate` · **Parent** FAFF-690
- **Why.** `computeIntegrityFloor` (`contract-defs.js:1629`) builds the floor object with no `integrity` key, so `decideFloor`'s `violated`/`unasserted-refuse` blockers (`:1596–1597`) are dead on the contract path; the 35-case selftest passes vacuously. The portable floor spec `governance-check` trusts therefore omits integrity.
- **What.** Validate + forward `extraction.integrity` in `computeIntegrityFloor`; add it to the `integrity-floor` schema.
- **DoD.** `faff contract integrity-floor` with `integrity:"violated"` (or `unasserted-refuse`) returns `refuse`; selftest gains fixtures for `violated`/`unasserted-refuse`/`unasserted-ok`/`asserted` and the count reflects them; the two blockers are provably reachable.
- **Smallest, self-contained — good first build.**

### T1.2 — runcheck Stop-hook: a malformed *owned* ledger fails closed (F4)
- **Type** bug · **Priority** High · **Labels** `faff-automate` · **Parent** FAFF-690
- **Why.** `runcheck.js:206` (`catch { return 0 }`) and `:161` (`catch { …owned:false }`) short-circuit to silent success *before* ownership is consulted, so a malformed owned ledger suppresses the completion backstop.
- **What.** Consult ownership (`FAFF_RUN_DIR`/session vs `owner` stamp) before the malformed-ledger silent return; an owned+malformed ledger blocks (or the sanctioned owner-warn), foreign+malformed stays non-blocking (preserve FAFF-235).
- **DoD.** New selftest case: malformed + owned → block; malformed + foreign → warn/silent. The 17 existing cases still pass.

### T1.3 — Merge floor: the already-merged path must not mint success evidence without the floor (F3)
- **Type** bug · **Priority** High · **Labels** *(human-review; idempotency-sensitive — hold `faff-automate` until the approach is chosen)* · **Parent** FAFF-690
- **Why.** The idempotent already-merged paths (`merge-gate.js:196` PR `MERGED`, `:599–600` local is-ancestor) call `writeMergeRecord` (`merged:true`, which `reconcile` treats as proof-of-ship) and return `merge-ok` before `decideFloor` runs — an out-of-band merge is laundered into governance evidence.
- **What.** On the already-merged path, either re-derive and evaluate the applicable floor before writing the record, or write the record explicitly marked `floor:unverified` / `reconciled-not-gated` so `reconcile` never reads it as a passed floor. Preserve idempotent-rerun safety.
- **DoD.** A branch merged out-of-band (floor never satisfied) does not produce a `merge-ok` + proof-of-ship record; a legitimate re-run of an already-gated merge is still a clean no-op.

### T1.4 — Bind merge-gate autonomy level to an unforgeable source, not the writable ledger (F1) — the Critical
- **Type** feature · **Priority** Urgent · **Labels** *(NOT `faff-automate` — prep/ADR first)* · **Parent** FAFF-690
- **Why.** `resolveGateLevel` (`contract-defs.js:1609`) trusts `run-ledger.json.level` verbatim; the level has no other source (`faff-beep-boop/SKILL.md:101`), so a full-ledger rewrite `L4`→`L1` skips the holdout and flips integrity to `unasserted-ok`, and the FAFF-424 `--level` tripwire is circular.
- **Design decision required (prep before graft).** Candidate — **anchor the minted level as an `events.jsonl` chain event** (FAFF-564, already shipped and integrity-verified) and have `resolveGateLevel` read the level from the verified chain, refusing when the ledger's top-level `level` disagrees with the chained mint. The tamper-evidence chain that landed this cycle is the natural home for an unforgeable level. Alternatives (mint-time signature, out-of-band invocation source) are FAFF-690's own DoD wording — settle in an ADR.
- **DoD.** Rewriting `run-ledger.json.level` cannot reduce an L4 merge decision; a ledger-vs-chained-mint level disagreement refuses fail-loud; the F1 regression fixture (T1.5) goes red→green.

### T1.5 — Direct attack-regression fixtures for the four gate holes (+ P-S2-f)
- **Type** chore/test · **Priority** High · **Labels** `faff-automate` · **Parent** FAFF-690 · **Blocks** the FAFF-435 rerun
- **Why.** FAFF-690's Done requires "direct regression fixtures for all four attacks"; today's selftests malform only benign fields and never set `integrity`, so nothing would catch a regression.
- **DoD.** One red-before / green-after fixture per F1, F2, F3, F4, and the L3 P-S2-f forgery; wired into `node --test`.

### T1.6 — Rerun FAFF-435 against the fixes *(existing ticket — FAFF-435, the initiative exit-criterion)*
- Do **not** create; **update** FAFF-435 to `blockedBy` T1.1–T1.5. It is the "audit comes back clean" gate for L4 leaving preview.

### Adjacent — the hand-authored-floor problem (already ticketed; sequence + shape)
- **FAFF-673** (EXISTS, Medium, Backlog, `faff-automate`) — *decision:* "is landing a legitimate non-graft change (spike findings, docs, one-line fix) in scope for faff at all?" This is the **incentive** behind the forged floors (FAFF-698/704) — agents manufacture floor artifacts because docs-only work has no sanctioned merge path. **Sequence this decision before FAFF-698's build.** Cheap half regardless of the answer: make the merge-gate refusal message name the remedy. → `prep` to a `Chosen:`.
- **FAFF-698** (EXISTS, High, Backlog) — "can merge-gate tell machine-produced floor artifacts from hand-authored ones?" The deeper question behind F1/F3. **Relate to T1.3/T1.4; informed-by FAFF-673's decision.** Its answer may be a provenance stamp on `ac-checklist.json`/`review-verdict.json`, or a documented accepted-risk.
- **FAFF-704** (EXISTS, High, Backlog) — two separable pieces; recommend **splitting**: (a) a reusable guard — *faff-graft AC-verification detects a deliverable that meets little of its own DoD* rather than trusting a hand-authored checklist (this is the durable fix, relates T1.x); (b) the specific cleanup — re-graft or right-size the FAFF-435 deliverable and **de-hardcode `validate-report.mjs`** (currently gated on `harness === "Codex subscription seat"` on a portability ticket).

---

## §2 — Make ADR status self-checking (Finding 2) — NEW

### T2 — `faff adr validate` advises on shipped-but-Proposed ADRs; sweep the shipped set
- **Type** chore · **Priority** Medium · **Labels** `faff-automate`
- **Why.** 38/95 ADRs are Proposed, several shipped and load-bearing (0043 merge-gate, 0060 budget, 0077/0078 integrity-digest, 0081/0083 locks, 0084/0085 events-chain=FAFF-564). The FAFF-342 advisory only flags *Accepted-cites-Proposed* (13 today), not *Proposed-with-shipped-machinery* — the R5 class — so a one-time July sweep re-accumulated. A sanctioned flip already exists (`faff adr accept`, FAFF-546).
- **What.** Extend `adr validate` to advise when a `Proposed` ADR's named CLI anchor resolves on disk (anchors are in-prose); run one sweep accepting the confirmed set via `faff adr accept`.
- **DoD.** `adr validate` prints a "Proposed but shipped: <anchor>" advisory for each; the confirmed set is Accepted-and-committed (adrGitTier clean); the advisory runs in CI (non-blocking) so the rot cannot silently return. *(Honest caveat: "anchor resolves" ≠ "decision faithfully implemented" — the advisory flags for human accept, it does not auto-accept.)*

---

## §3 — Reconcile the grounding contract with ADR-0040 (Finding 3) — NEW

### T3 — Ship the `grounding-evidence` contract, or amend ADR-0040 + correct FAFF-127
- **Type** bug · **Priority** Medium · **Labels** `faff-automate` · **Relates** FAFF-127 (Done), **unblocks** FAFF-128
- **Why.** ADR-0040 (Accepted) calls `faff contract grounding-evidence` a "shipped producer-emits/consumer-parses pattern" and pins shipping the schema + CONTRACTS entry + fixtures "even though the default occupant is absence"; FAFF-127 is marked Done. Reality: `faff contract grounding-evidence` → `unknown contract`, no `grounding-evidence.schema.json`, not in the dispatcher. FAFF-128 (first consumer) is Backlog, correctly blocked.
- **What (recommended — the small option).** Ship `contracts/grounding-evidence.schema.json` + `CONTRACTS` entry + `faff contract grounding-evidence` + golden fixtures per ADR-0040. **Alternative** if the deferral is now intended: amend ADR-0040 to Proposed-with-ticketed-build and note FAFF-127 shipped the slot key only.
- **DoD.** Either `faff contract grounding-evidence --selftest` passes over the evidence shape (`status: ok|empty|unavailable`, provenance) and unblocks FAFF-128, **or** ADR-0040 + FAFF-127 are corrected to match reality. One or the other — not both records left claiming "shipped."

---

## §4 — Reconcile faff's cage assertions with claude-box (Finding 4)

### T4.1 — Qualify the "passes by construction" cage prose by engine mode (faff-side) — NEW
- **Type** bug/docs · **Priority** Medium · **Labels** `faff-automate`
- **Why.** `faff container-check --gate` admits only `host_socket.state === "absent"` (`container-check.js:139`), but claude-box's rootful engines (sysbox — auto-selected "strongest" — and privileged-dind) create the nested daemon's socket at `/var/run/docker.sock` (`entrypoint.sh:123`, its own comment confirms). So inside a rootful cage `--gate` exits 1, while `unattended.md:128`, the FAFF-651 spec, and ADR-0095 all say claude-box "passes by construction." The older `cage-engine-acceptance.md:70` had the correct "or owned by the nested daemon" qualifier the mechanical probe can't implement.
- **What.** Either (a) qualify the prose to name the modes it holds for (rootless/none), or (b) teach `container-check` to accept an operator attestation of nested-daemon socket ownership (the acceptance-doc's distinction) — and reconcile ADR-0010's "read-only `~/.claude`" envelope with the actual `:rw` mounts (`claude-box:749,758`; FAFF-647 already circles this).
- **DoD.** No faff doc claims unqualified "passes by construction"; ADR-0010's envelope wording matches the mounts; `container-check`'s behaviour and the prose agree.

### FAFF-381 — Run the cage acceptance in anger *(EXISTS, now unblocked)*
- **Status** Backlog, No-priority, `faff-automate`, project "T5 — proven in anger". **Its blocker FAFF-380 shipped 2026-07-11** (claude-box `93ed538`) — it is runnable now.
- **Plan note (raise its priority):** run the 4-point runbook inside claude-box. **Predicted outcome from this audit:** point 4 (isolation proof) inside a *rootful* claude-box will hit the T4.1 `--gate` refusal — so this run has a concrete expected finding, and running it validates or refutes Finding 4a directly. Feed any cage-image gap to the claude-box issues (below), per the ticket's own "assert-don't-implement" constraint.

### claude-box-repo issues — file against `shftwst/claude-box`, NOT the FAFF team
These are cage-side and out of faff's assert-don't-implement remit — the transcriber should open them on the claude-box repo (or note them for the operator), not in Linear FAFF:
1. **`HOST_UID=0` skips the entire security block** (`entrypoint.sh:41`) — on a root CI runner the socket refusal, nested engine, and gosu-drop are bypassed and Claude runs as root allow-all, while `--gate` still reports `contained`. (Security.)
2. **README stale:** dead `docs/` link (`README.md:104`, `docs/` gitignored) and "read-only" mount claims (`:15,173`) contradicted by the `:rw` mounts.
3. **Document the launcher's apparmor host-escalation** (`claude-box:394–399`, `nsenter -t 1 -m --privileged --pid=host`) so faff readers know the recommended cage self-grants host root to set up.

---

## §5 — First L4 comparative arm + labs hygiene (Finding 5) — mostly the study's own next step

### T5 — Manifest hygiene + run the first `stall` L4 arm
- **Type** chore · **Priority** Low · **Labels** `faff-automate` (hygiene) / the run is a supervised experiment step
- **Why.** The `faff-labs` control study is built and pinned but no comparative arm has run (Phase 2 was gated on the cage, which landed 2026-08-04). Manifest hygiene: repo-name inconsistency (`faff-labs-experiment-*` vs `faff-lab-experiments-*`), stale `$comment` path, all-null `pricing.json`, `stall`'s stale `transcripts/README.md` timestamp.
- **DoD.** `pricing.json` populated; manifest naming + `$comment` consistent; and — as the study's own milestone, not a code ticket — the first `stall` L4 arm scored now Phase 2 is unblocked.

---

## Labels & eligibility guidance (faff's own model)

- **Safe to `faff-automate` (mechanical, spec-derivable):** T1.1, T1.2, T1.5, T2, T3, T4.1-docs, T5-hygiene.
- **Human-led / prep-first (design decisions — leave off `faff-automate` or spike first):** **T1.4 (F1 — needs an ADR)**, T1.3 (idempotency-sensitive), FAFF-673 (a decision, not a build), FAFF-698 (design), FAFF-704a (guard design).
- **Not FAFF-team tickets:** the three claude-box-repo issues in §4.

## Judgment calls to confirm before ticketing

1. **Decompose FAFF-690, or keep monolithic?** This plan recommends decompose (§1 rationale). If you keep it whole, the §1 children are its DoD breakdown.
2. **FAFF-673's answer** ("non-graft changes: faff's job or the human's?") is a genuine open decision — "leave exactly as is + name the remedy in the refusal message" is a legitimate outcome the ticket itself endorses. It shapes FAFF-698, so decide it first.
3. **Finding 3:** ship the grounding contract (recommended, small, unblocks FAFF-128) vs amend ADR-0040 to match a deliberate deferral — pick one.
4. **Finding 4:** qualify the prose vs teach `container-check` the nested-daemon distinction — the latter is more work but removes the operator-attestation friction under a legitimate strong cage.
