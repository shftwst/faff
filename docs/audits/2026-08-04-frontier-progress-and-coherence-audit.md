# Frontier progress-and-coherence audit — 2026-08-04

**What this audit is.** The regular frontier read of the faff suite and its satellites, held in one sustained context by a single frontier reasoner (Fable 5). It does two jobs at once: it **re-reads the whole system for prose↔mechanism drift** (the FAFF-323 method), and it **measures state and progress against the two prior deep audits** — `2026-07-04-faff-323-whole-system-coherence.md` and `2026-07-20-l4-capabilities-audit.md`, plus the targeted `2026-08-02-FAFF-435-l4-gate-subversion.md`. The comparison is the point: what did the July findings turn into, what shipped, and what drifted back.

**The load-bearing model is unchanged.** faff's correctness rests on prose-orchestrated skills agreeing with the deterministic contracts and CLI gates they claim to invoke, agreeing with the ADR log that records the decisions, and agreeing with the cage that bounds the blast radius. Each PR reviews one seam; nothing routinely reviews the seams between the seams — least of all the seam between faff and `shftwst/claude-box` (the cage) or between faff and its `faff-labs` control experiments. This audit is that review.

**Method.** Whole-system read first (the 1,127-line gateway in full, the contract surface, the 95-ADR log, the CLI module map), then deterministic verification of every candidate finding against ground truth — `--selftest` tables, CLI-source reads at named line numbers, the live label manifest, the ADR-status sweep, and a mechanical cross-check of every `faff-contract:<name>` named in prose against the dispatcher. Four background readers held slices in parallel — the cage repo, the `faff-labs` control tree, the FAFF-435 gate-subversion findings against current code, and the tracker — and every load-bearing claim each returned was re-verified here against a file, a selftest, or a commit before it entered this document. The sharpest findings (the gate-subversion set) were re-read line-by-line in `contract-defs.js` / `merge-gate.js` / `runcheck.js` rather than taken on report. **Severity:** *defect* (behaviour diverges from a load-bearing claim now) · *drift* (two claims disagree; behaviour latent or context-dependent) · *observation* (worth-confirming asymmetry).

**Scope note (tracker axis).** The live tracker MCP disconnected and reconnected mid-session behind an approval gate that this run could not clear, so axis 3 (deps↔prose, open-set sweep) is **partially covered**: it rests on direct fetches taken before the cutoff (FAFF-127, FAFF-128), the two prior audits' full sweeps (69 and ~114 open issues), and the `CHANGELOG.md` FAFF-NNN→commit mapping — not on a fresh full-backlog enumeration. Named here per the FAFF-323 edge-case rule rather than left implicit.

---

## The system has roughly doubled since July

| Surface | FAFF-323 (07-04) | L4 audit (07-20) | Now (08-04) |
|---|---|---|---|
| `SKILL.md` files | 29 (6,299 ln) | ~30 | 30 (7,091 ln) |
| Gateway (`faff/SKILL.md`) | 1,015 ln | — | 1,127 ln |
| ADRs | 41 | 0034–0080 | **95** |
| Contract schemas | 14 | — | **22** |
| CLI | 12,116-ln monolith | ~30.7k ln / 67 modules | 281-ln entrypoint + **74 modules** = 38,151 ln |
| `faff contract` dispatcher names | 14 | — | 22 |

`main` is at `39b98ba` (2026-08-04 11:15). **50 commits since the L4 audit**; faff `0.12.0` released 2026-08-02. The CLI monolith the first audit named "the CLI's remaining ~12k lines" is gone — FAFF-441 split it into a dispatch shell plus 74 region-aligned modules under `bin/lib/` (ADR-0052). This is a healthier, larger, and — on the contract surface — measurably more coherent system than either July snapshot. It also has one trust-critical hole that has not moved in the eight days it has been known.

---

## Progress since July — the scorecard

**FAFF-323's fifteen follow-ons (T1–T15): the load-bearing ones shipped and hold.** Verified against ground truth, not the tracker:

- **D1** (gateway missing the `spec_review` slot + fixed spec-review-verdict contract) → **fixed** (FAFF-335). The `spec_review` slot is in the gateway slot table (`faff/SKILL.md:221`), the `grounding` slot with it (`:222`), and `faff contract spec-review-verdict --selftest` passes 21 cases. *(One residual on the grounding half — see F2 below.)*
- **D2/D3** (label manifest refused tags the lenses instruct) → **fixed**. `faff labels --names` now returns **seven** labels, and the gateway's prose set (`faff/SKILL.md:831`) matches the CLI byte-for-byte: `faff-automate`, `faff-automation-hold`, `faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`, `faff-awaiting-review`, `faff-repeat-parked`. `faff-repeat-parked` was minted (FAFF-336); `faff-methodology-fill` was repointed to `faff-chain-gap-fill` (whose description was widened). No prose site names a label the manifest lacks.
- **D4** (unpinned beep-boop run-id; `latestRunDir` naked lexical sort) → **fixed**. beep-boop pins `run-YYYYMMDD-HHMMSS-beepboop-<mode>` as canonical (`faff-beep-boop/SKILL.md:338`); `latestRunDir` sorts by mtime descending and requires a `run-ledger.json` (`shared-infra.js:212-226`) — the `cands.sort()[len-1]` the first audit caught live is gone. faff-wtf's enrichment no longer keys off a `beep-boop` substring glob.
- **D5 / R4** (beep-boop Stop-hook + token-attribution prose) → **fixed** (FAFF-338). The Stop-hook prose now states warn-not-block directly ("a foreign, not-held run … WARNs, never blocks"; "legacy ledger with no owner … warned, not blocked — the pre-FAFF-235 hard block on this path is gone", `faff-beep-boop/SKILL.md:397`), and token accounting is keyed off `$CLAUDE_CODE_SESSION_ID` / `childOwningSession` with "mtime ≥ run start is only a cheap pre-filter … never the attribution gate (FAFF-229)" (`:84`).
- **R1** ("L4 not built yet") → **fixed**. The phrase appears nowhere in the gateway or README; L4 is consistently framed as a shipped **preview** (`faff/SKILL.md:21,26`; `README.md:31`).
- **R3** (two owners for the review-iteration cap) → **fixed** (FAFF-341); `review-iteration-cap.js` is the single owner.
- **R5** (ADR status rot + the 0034/0039 inversion) → **partly fixed, and regressed** (FAFF-342 accepted 18 shipped-but-Proposed ADRs and fixed the inversion — 0034 and 0039 are both Accepted now — and shipped an `adr validate` advisory). But the rot has **returned at larger scale** — see **Finding 2**.

**The L4 audit's finish-line items: real, uneven progress.**

- **events.jsonl tamper-evidence — SHIPPED.** This is the headline. The L4 audit named the per-line hash-chained `events.jsonl` with a git-anchored head as "the one governance property nobody surveyed — faff included — has shipped," and "the cheapest remaining differentiator." It is now built: FAFF-564 (schema-2 prev-hash links + ledger-write fold), FAFF-568 (anchor + verify in `governance-check`), FAFF-623 (extend the anchor to the merge-floor leg). `verifyChain` exists in `events.js`, `faff events --selftest` passes the chain verification, and `governance-check.js` carries an integrity leg. The differentiator landed.
- **CI-runner cage admission — SHIPPED, just.** ADR-0095 (Accepted 2026-08-03) settles what bounds a faff run on a CI runner; FAFF-646/655 shipped `faff container-check --gate` (the composite admission verdict), FAFF-651 a worked cage + socket trap, FAFF-643/606 the L3/L4 reference workflows. All landed 2026-08-03/04 — the cage workstream the L4 experiment was gated on has only just cleared.
- **Subscription-seat auth — SHIPPED** (ADR-0092 Accepted; FAFF-478/481 headless `seat_token_env`).
- **Docusaurus docs site — SHIPPED** (FAFF-508; `website/` is a live Docusaurus project).
- **Governance-check binding, the three proofs (FAFF-381 cage-acceptance-in-anger, FAFF-310 greenfield unattended, FAFF-435 clean re-audit), and the SUT evidence copy-over — NOT done.** The empirical column is still thin and first-party. FAFF-435 came back **`mechanical-subverted`** (see Finding 1); FAFF-381 has never run (confirmed in the design specs and the cage repo); the `external-verification/` tree holds the new `faff-labs` control framework but **no scored comparative arm** (see Finding 5).

**Contract surface: measurably more coherent than July.** A mechanical sweep of every `faff-contract:<name>` block named in any `SKILL.md` against the dispatcher's known-names list comes back **clean** — every producer-emitted contract resolves to a dispatcher entry, and the three descriptor blocks (`infra-profile`, `intake-record`, `label-op`) are validator-less by design exactly as documented. The FAFF-323 D1 gap (spec-review-verdict named by occupants but absent from the gateway) is closed, and the axis-2 orphans it flagged (O1 architecture slot, O2 prd-readiness) now have live producers and consumers. **The one exception is the grounding contract — Finding 2.**

Deterministic probe base, all green and reproducible: core selftests `next` (23), `eligible` (6), `admissible` (14), `dod`, `contain` (33), `runcheck` (17), `sentry`, `sentrycheck` (17), `regions governance` (13); contract selftests for all 12 script-backed contracts (spec-readiness 10, review-verdict 16, delivery-outcome 12, holdout-verdict 33, quality-gates 21, automation-routing 14, spec-review-verdict 21, integrity-floor 35, prd-readiness 21, prdr-admission 25, run-termination 20, run-trigger 24); `lint-refs`, `lint-cli-doc` (79 subcommands), `validate-adapters` (19 slot skills), `integrity-digest` (19), `events` chain-verify — all pass.

---

## Findings

### Finding 1 — The four FAFF-435 gate-subversion holes are still open at HEAD — **severity: defect (one Critical, three Major)**

- **Artifacts:** `docs/audits/2026-08-02-FAFF-435-l4-gate-subversion.md` (F1–F4, dispositioned to **FAFF-690**, verdict `mechanical-subverted`) **vs** the current code at `39b98ba`, read line-by-line.
- **The result:** all four findings, plus the FAFF-566 L3 forged-floor residual (P-S2-f), **reproduce unchanged**. FAFF-435 ran 2026-08-02 from the Codex/GPT-5.6-sol seat; this audit re-read the same gates with a different frontier model (Fable 5) two days later and confirms none has closed. Independent-model agreement, current anchors:

| # | Sev | Gate | Confirmed at | The hole |
|---|---|---|---|---|
| F1 | Critical | merge-floor / holdout | `contract-defs.js:1609`, `1595`; `merge-gate.js:326` | `resolveGateLevel` returns the ledger `level` verbatim when present. `decideFloor` reads the holdout only at L4 (`f.level === "L4" && …`) and integrity-refuses only when `resolveIntegrity` sets `unasserted-refuse`, which is itself L4-only. A writable `run-ledger.json` rewritten `L4`→`L1` skips the holdout **and** flips absent integrity from refuse to `unasserted-ok`. |
| F2 | Major | merge-floor | `contract-defs.js:1629`, fixtures `1647–1663` | `computeIntegrityFloor` builds the floor object `f` with **no `integrity` key**, so `decideFloor`'s two integrity blockers (`:1596–1597`) are dead on the contract path. Zero of the integrity-floor fixtures set an `integrity` field. The 35-case `--selftest` passes **vacuously on the integrity leg**. |
| F3 | Major | merge-floor | `merge-gate.js:196`, `599–600`, `writeMergeRecord :295` | The idempotent already-merged paths (PR `MERGED`, local `is-ancestor`) call `writeMergeRecord` — which writes `merged:true` evidence that `reconcile` treats as proof-of-ship — and return `merge-ok` **before `decideFloor` is ever called**. An out-of-band merge that bypassed the floor is retroactively laundered into governance evidence. |
| F4 | Major | runcheck | `runcheck.js:206`, `161` | A malformed ledger short-circuits to silent success (`catch { return 0 }` in hook mode; `catch { …owned:false }` one level up, hard-coding `owned:false`) **before ownership is consulted**. A malformed *owned* ledger suppresses the completion backstop. The 17 selftest cases malform only the heartbeat field, never a malformed owned ledger. |
| P-S2-f | (L3) | merge-floor | `merge-gate.js:326` | The corrective-integrity bracket is mandatory only at L4; at L3 an unasserted attestation is `unasserted-ok`, and `decideFloor` blocks only `unasserted-refuse`/`violated`. A same-uid forgery of `review-verdict.json` + `ac-checklist.json` with independently-green CI rides through. Unchanged from FAFF-566. |

- **Why F1 is the sharpest, and why the existing mitigation does not close it.** The run's autonomy level has **no source other than the ledger** the attacker rewrites — "a run is **L4** iff its ledger was `faff lights-out`-minted" (`faff-beep-boop/SKILL.md:101`). The FAFF-424 tripwire (`merge-gate` fail-louds when an explicit `--level` disagrees with the ledger) is therefore circular: a full-ledger rewrite downgrades the `--level` graft would pass too, so nothing disagrees. `run-ledger.json` was added to the corrective-integrity forge surface (`corrective-integrity.js:161`), but that check bites only when an attestation is *required* — which is L4-gated — so downgrading to L1 removes the very requirement that would catch the tampering. The guard is present and bypassable along exactly the path the finding names.
- **The honest read.** This is subversion *of* the gates by an attacker with write access to the run substrate — a strong attacker model, and the same shared-uid substrate the L4 threat model already worries about. It does **not** make the *label* dishonest: the gateway still says L4 is a **preview** (`faff/SKILL.md:21`), and FAFF-351 (retire the preview tag) stays correctly blocked. It does mean the preview's central promise — fail-closed gates an unattended run cannot be steered through — is not yet true against a substrate-write attacker, eight days after that was first written down. F2 additionally means the *portable* floor spec (`faff contract integrity-floor`, what `governance-check` and any external validator trust as the floor's definition) omits integrity entirely, so its green is not evidence the integrity leg holds.
- **Fix/ticket:** this is **FAFF-690**'s scope, which the FAFF-435 record says "adds direct attack regressions before the audit is rerun." The confirmation here is that FAFF-690 is not yet done and should carry, at minimum: a minted-level record independent of the writable ledger (F1); routing the `integrity` input through `computeIntegrityFloor` + adversarial fixtures that set it (F2); evaluating the floor before writing merge-success evidence on the idempotent path, or marking already-merged records as floor-unverified (F3); an ownership check before the malformed-ledger silent-success return, plus a malformed-owned-ledger selftest case (F4); and the L3 integrity-bracket decision from FAFF-566's named follow-up (P-S2-f). → **T1**

### Finding 2 — ADR status rot has returned: 38 of 95 Proposed, several shipped and load-bearing — **severity: drift** (recurrence of FAFF-323 R5)

- **Artifacts:** the `docs/adr/` status sweep (56 Accepted, **38 Proposed**, 1 Superseded) **vs** the shipped machinery each Proposed ADR records.
- **The drift:** FAFF-342 did a one-time sweep in July and added an `adr validate` advisory. But the advisory only flags an **Accepted ADR citing a Proposed one** (it prints 13 such today), which is not the R5 case. The R5 case is a **Proposed ADR whose machinery has shipped and is load-bearing in production paths**, and that set has grown, not shrunk. Confirmed shipped-but-Proposed:
  - **0043** (merge-floor mechanical interlock) → `merge-gate.js` ships and the gateway cites it as canonical. Proposed.
  - **0060** (L4 spend governor "measurable, not merely configured") → `budget.js` ships. Proposed.
  - **0077** (two-class run-artifact write authority) → the gateway quotes it as the canonical ruling (`faff/SKILL.md:620`). Proposed.
  - **0078** (digest-custody bracket as concurrency obligation 5) → `integrity-digest.js` ships, `--selftest` passes 19, and the concurrency contract's obligation 5 is written around it. Proposed — and **not** flagged by the advisory, because nothing Accepted happens to cite it.
  - **0081/0083** (events / ledger advisory locks) → `fs-lock.js` ships. Proposed.
  - **0084/0085** (the events-chain rule + ledger-write fold) → **FAFF-564 shipped this**; `verifyChain` exists and `governance-check` anchors it. Proposed.
- So faff's headline new differentiator — the tamper-evidence chain — is recorded across four ADRs, every one of which reads "Proposed," while the code is shipped and CI-gated. A reader treating the ADR log as the decision history is told the merge-floor interlock, the spend governor, the write-authority model, and the tamper-evidence chain are all still proposals.
- **Checked and cleared (not a finding):** ADR-0072's "supersedes ADR-0071 **in part**" is handled coherently — 0071 carries an `**Amended:**` header (the ADR-0004 precedent) and stays Proposed by design because its other rows still stand. This is *not* an 0034/0039-style inversion. ADR-0015 is correctly Superseded by 0055.
- **Fix/ticket:** the durable fix is not another manual sweep — it is a mechanical link from ADR status to shipped machinery, so the rot cannot silently re-accumulate with each ADR batch. Extend `adr validate` from "Accepted cites Proposed" to also advise "Proposed ADR whose named CLI anchor resolves" (the anchors are already in the ADRs' prose), and run one status sweep to accept the shipped set. → **T2**

### Finding 3 — The `grounding` contract that ADR-0040 (Accepted) and FAFF-127 (Done) both claim ships does not exist — **severity: defect**

- **Artifacts:** ADR-0040 (**Accepted**), which states "the occupant emits one `faff-contract:grounding-evidence` block validated by `faff contract grounding-evidence` (the shipped producer-emits / consumer-parses pattern)" and pins, as "the dead-seam obligation this ADR pins … ship `contracts/grounding-evidence.schema.json` + a CONTRACTS entry, and … full fixtures … so the seam is proven by tests **even though the default occupant is absence**"; and FAFF-127 (**Done**, 2026-07-03), whose acceptance includes "consulted through the fixed contract … enforced by the contract, mirroring the `faff-contract:<name>` pattern" — **vs** the code: `faff contract grounding-evidence` returns `unknown contract`, there is **no `grounding-evidence.schema.json`** among the 22 schema files, and the name is absent from the dispatcher's known-names list.
- **The defect:** the slot *key* shipped (the gateway lists `grounding` as no-op-by-absence, `faff/SKILL.md:222`), which satisfies the "slot exists, unset → no-op" half of FAFF-127's acceptance — but the **contract half that ADR-0040 explicitly refused to defer** did not ship. FAFF-127 is marked Done; its only attachment is PR #254, which is the *design settle* (FAFF-322 → ADR-0040), not a contract build. The first consumer (FAFF-128) is still Backlog, which is consistent with the seam being unbuilt. ADR-0040's author anticipated exactly this deferral and ruled it out in writing ("even though the default occupant is absence"), so the gap is a real divergence from the Accepted decision, not a defensible YAGNI.
- **Fix/ticket:** either ship the pinned obligation (the `grounding-evidence` schema + CONTRACTS entry + golden fixtures) and re-open FAFF-127, or, if the deferral is now intended, amend ADR-0040 to Proposed-with-ticketed-build and drop the "shipped … pattern" wording. The `prdr-yagni` contract's `grounding_present` field already forward-references the missing contract, so the seam is not purely hypothetical. → **T3**

### Finding 4 — faff↔claude-box: the cage's reality diverges from faff's assertions about it, in five places — **severity: drift (security-adjacent)**

The cage is a substitutable mechanism faff only ever *asserts* (ADR-0010), so drift here is expected to be one-directional (faff describes claude-box; claude-box never imports faff) — which is precisely why nothing catches it. `shftwst/claude-box` has not changed in 13 days (`HEAD 2367b92`, 2026-07-22) while faff's entire cage-integration workstream (FAFF-651/655/606/609) landed 2026-08-03/04, so the cage now lags the faff-side integration built against it.

- **4a — the mechanical gate refuses the cage's *strongest* posture while faff prose says it "passes by construction."** `faff container-check --gate` admits only a **confirmed-absent** host socket (`container-check.js:139`, `state === "absent"`; `HOST_SOCKET_PATHS = ["/var/run/docker.sock", "/run/docker.sock"]`). But claude-box's **rootful** engines — `sysbox` (which `auto` selects when the host has it, and which claude-box calls its strongest posture) and `privileged-dind` — start a nested dockerd whose own socket sits at exactly `/var/run/docker.sock` (`entrypoint.sh:111–123`). Inside a rootful claude-box, `--gate` sees a present socket and exits 1, and `lights-out` refuses unless the operator sets `autonomous.engine_bounded: true`. faff prose asserts the opposite without the engine-mode qualifier: `unattended.md:128` and `docs/specs/2026-08-04-FAFF-651-…:19` and `docs/adr/0095-…:37` all say claude-box "passes by construction." The older `cage-engine-acceptance.md:70` had the correct qualifier ("absent, **or owned by the nested daemon**") — which the mechanical probe cannot actually implement — and the newer prose dropped it. **Honest framing:** the gate is conservatively *correct* (fail-closed on an ambiguous socket); the prose over-claims by omitting that "passes by construction" holds only for `--engine rootless` / `none`.
- **4b — the cage's security block is skipped entirely when `HOST_UID=0`.** `entrypoint.sh:41` gates the host-socket refusal, the nested-engine start, and the `gosu` privilege-drop behind `[ id -u = 0 ] && [ HOST_UID != 0 ]`; the fallthrough (`:201`) is a bare `exec claude "$@"` **as root**. On a Linux CI runner running as root — exactly the FAFF-651/FAFF-609 self-hosted scenario where claude-box is the named example cage — no socket refusal runs, no nested engine starts, and Claude runs as root with allow-all, while `faff container-check --gate` still reports `contained` off `/.dockerenv`. This is a claude-box bug, but it directly undercuts faff's assertion that the named cage bounds the blast radius.
- **4c — ADR-0010's stated envelope is narrower than the cage's actual envelope.** ADR-0010 states the contract as "the agent can reach only the mounted project and **read-only** `~/.claude` skills/MCP." Reality: those dirs, plus `~/.cache`, `~/.local/bin`, and arbitrary symlink-target repositories, are mounted **rw** (`claude-box:749,758`). FAFF-647's spec already circles this ("inside claude-box it is worse, because there the ambient config is a host bind mount"), and its DoD asks a follow-up **filed against `shftwst/claude-box`** — a repo that carries no tracker artifacts, so the follow-up is invisible from the faff side.
- **4d — the four-point acceptance is enforced on one side only, and point 4 never runs.** `cage-engine-acceptance.md:9` says points 1–3 are continuously enforced by the `env-rootless` lane (it exists, `validate.yml:305`). Point 4 — claude-box's own isolation proof — has no automation in either repo; claude-box's entire CI is `bash -n` on three scripts. And **FAFF-381 (cage acceptance in anger) has never run** — the design specs still call it "the never-run cage acceptance."
- **4e — an undocumented host-escalation on the cage launcher.** Under the `profile`/`profile-cap` apparmor strategies, `claude-box:394–399` runs `docker run --privileged --pid=host --entrypoint nsenter … -t 1 -m` to load an apparmor profile — host-root authority, honestly documented on the claude-box side as launcher-only (never granted to the cage), but mentioned in **no faff doc**. A faff reader trusting "the cage bounds everything" is not told the recommended launcher self-grants host root on apparmor hosts to set the cage up.
- **Also:** claude-box's README is stale against its own code — a dead `docs/` link (`README.md:104`; `docs/` is gitignored) and "read-only" mount claims (`:15,173`) contradicted by the `:rw` mounts since a 2026-05-16 commit.
- **Fix/ticket:** (i) re-qualify the "passes by construction" prose to name the engine modes it holds for, or teach `container-check` to accept an operator attestation of nested-daemon ownership (the acceptance doc's own distinction); (ii) file the `HOST_UID=0` root-fallthrough and the rw-envelope drift against `shftwst/claude-box` and reconcile ADR-0010's envelope wording; (iii) schedule FAFF-381 now that the cage workstream has landed; (iv) note the launcher's apparmor host-escalation in the cage-engine doc. → **T4**

### Finding 5 — The `faff-labs` control experiment is faithfully built and correctly pinned, but every comparative arm is unrun — **severity: observation**

- **Artifacts:** `docs/external-verification/faff-labs/experiments/` (the L4-vs-one-shot design, the pinned `controls.manifest.json`, the rig) **vs** the `results/` tree.
- **State:** the `stall` control (`faff-labs-experiment-stall-frontier-one-shot`) is a clean, protocol-faithful Arm-A capture: the brief was passed verbatim (`prd.md` is byte-identical to faff's committed `stall-prd.md`), the economics wrapper applied verbatim, one session, **0 subagents**, ~47 min, ~411k output tokens, built by `claude-fable-5` in claude-box. Its manifest SHA (`f41c3b270c83`) matches HEAD exactly. It has **no unit tests** — verification is a self-built HTTP harness claiming 49/49 green (the "marks its own homework" property the study exists to test against faff's independent holdout).
- **The gap:** **zero L4 treatment arms have run.** Phase 2 is explicitly gated on the CI-runner cage (`l4-experiment-design.md:110`), which only cleared 2026-08-04. The rig is built for the two control-only axes (gap-fill, cost) and the two comparative axes are deliberately stubbed; `results/pricing.json` ships all-null, so even the control costs render "unpriced." So the L4 audit's central empirical gap — "does faff work on a repo that isn't its own, measured head-to-head against a frontier control" — is **still open**, now with the apparatus fully built and waiting on the just-landed cage. This is progress (the study is designed, pinned, and rigorous) short of the payoff (a scored arm).
- **Minor manifest hygiene:** the control repos are named inconsistently (`faff-labs-experiment-*` for stall/plinth/sealed vs `faff-lab-experiments-*` for six others); the manifest's `$comment` points at a stale `…/design/l4-…` path; `stall`'s `transcripts/README.md` end-timestamp is ~11 min stale against the committed jsonl; `package.json` is `0.4.1` with no matching tag. None affects the pinned evidence; all are citable-artifact tidiness.
- **Fix/ticket:** no faff-repo change required beyond noting the dependency; the actionable item is to run the first `stall` L4 arm now that Phase 2 is unblocked, and to fill `pricing.json` so the control costs resolve. → **T5**

---

## Checked and clear

Candidates probed and dissolved, or genuine coherence wins worth recording:

- **Axis-2 contract surface is coherent.** Every `faff-contract:<name>` named in any `SKILL.md` resolves to a dispatcher entry; the three descriptor blocks are validator-less by design as documented. FAFF-323's D1/O1/O2 orphans are closed. (The one exception is grounding — Finding 3.)
- **The gateway's L4 mechanical-vs-model-compliance split is honest.** The new table (`faff/SKILL.md:32–39`) separates, per rung, what a named artifact enforces from what holds only while the agent complies — and each model-compliance cell cites its own already-flagged limit. This is FAFF-351's honest-labelling discipline landing in the always-loaded gateway; it is a real improvement over the July framing.
- **The FAFF-566 injection probe set holds where it claimed to.** The L4 mechanical vectors remain closed by construction; only the L3 forged-floor residual (P-S2-f) is open, and it is Finding 1's P-S2-f row, unchanged and correctly scoped.
- **`gates.fallback` defaults fail-closed** (FAFF-522; `gates.js:259–266` → `needs-human`) — the secure-by-default merge-floor posture the L4 audit wanted.
- **ADR supersession mechanics are coherent** (0072-amends-0071 via the `**Amended:**` header; 0015 correctly Superseded by 0055) — no acceptance-order inversions of the 0034/0039 kind survive.
- **Provenance-field coverage (21/95 ADRs) is by design**, not rot — FAFF-199 explicitly declined to back-fill pre-FAFF-199 records, and absent Provenance reads as the harder-to-supersede `human` tier.

---

## Cross-repo state at 2026-08-04

| Repo | Role | HEAD | Last change | Health |
|---|---|---|---|---|
| `shftwst/faff` | the product + governance layer | `39b98ba` | 2026-08-04 | Growing fast, contract surface coherent, one Critical gate hole open (F1) |
| `shftwst/claude-box` | the cage (ADR-0010 reference) | `2367b92` | 2026-07-22 | Stable but **13 days behind** the faff-side cage integration; 5 prose↔reality drifts (Finding 4); CI is `bash -n` only |
| `…-stall-frontier-one-shot` | frontier control (Arm A) | `f41c3b2` | 2026-07-20 | Faithful, correctly pinned; the comparative arm against it does not yet exist |

---

## Proposed follow-on tickets

One entry per actionable cluster; the orchestrator files these (containment-checked, appetite-gated, deduped) — this audit records, it does not write the tracker.

1. **T1 — Close the FAFF-435 gate-subversion set (FAFF-690).** A minted-level record independent of the writable ledger (F1); route `integrity` through `computeIntegrityFloor` + adversarial fixtures (F2); evaluate the floor before writing merge-success evidence on the idempotent path (F3); ownership check before the malformed-ledger silent return + a malformed-owned selftest case (F4); decide the L3 integrity-bracket question (P-S2-f). **Trust-critical; blocks FAFF-351.**
2. **T2 — Make ADR status self-checking.** Extend `adr validate` to advise on a Proposed ADR whose named CLI anchor resolves; run one sweep to accept the shipped set (0043, 0060, 0077, 0078, 0081, 0083, 0084, 0085 at least).
3. **T3 — Reconcile the grounding contract with ADR-0040 + FAFF-127.** Ship `grounding-evidence.schema.json` + CONTRACTS entry + fixtures, or amend ADR-0040 to a ticketed-build Proposed and re-open FAFF-127.
4. **T4 — Reconcile faff's cage assertions with claude-box's reality.** Re-qualify "passes by construction" by engine mode (or teach `container-check` the nested-daemon distinction); file the `HOST_UID=0` root-fallthrough and rw-envelope drift against `shftwst/claude-box`; reconcile ADR-0010's envelope wording; schedule FAFF-381; document the launcher's apparmor host-escalation.
5. **T5 — Run the first L4 comparative arm.** Phase 2 is unblocked; run `stall` L4, fill `results/pricing.json`, and fix the manifest naming/`$comment`/timestamp hygiene.

---

## Appendix A — ADR status × shipped-machinery (Finding 2 evidence)

Distribution over 95 ADRs: **56 Accepted, 38 Proposed, 1 Superseded.** The `adr validate` advisory prints 13 Accepted-cites-Proposed pairs (0073→0061, 0080→0043, 0090→0054/0076, 0091→0054/0060/0088/0048/0059/0076/0077, 0092→0076/0067). Proposed-but-shipped-and-load-bearing (the R5 class the advisory does **not** catch), each with its shipped anchor:

| ADR | Records | Shipped anchor | Status |
|---|---|---|---|
| 0043 | merge-floor mechanical interlock | `merge-gate.js` | Proposed |
| 0060 | L4 spend governor measurable | `budget.js` | Proposed |
| 0077 | two-class run-artifact write authority | gateway `faff/SKILL.md:620` | Proposed |
| 0078 | digest-custody bracket = concurrency obligation 5 | `integrity-digest.js` (selftest 19) | Proposed |
| 0081 | events.jsonl advisory lock | `fs-lock.js` | Proposed |
| 0083 | ledger advisory lock | `fs-lock.js` | Proposed |
| 0084 | events.jsonl chain rule | `events.js` `verifyChain` (FAFF-564) | Proposed |
| 0085 | ledger-write event folds into the chain | `events.js` (FAFF-564) | Proposed |

## Appendix B — deterministic probes run (evidence base, all reproducible)

`faff <cmd> --selftest`: next 23 · eligible 6 · admissible 14 · dod ok · contain 33 · runcheck 17 · sentry ok · sentrycheck 17 · regions governance 13 — all PASS. `faff contract <name> --selftest`: spec-readiness 10 · review-verdict 16 · delivery-outcome 12 · holdout-verdict 33 · quality-gates 21 · automation-routing 14 · spec-review-verdict 21 · integrity-floor 35 · prd-readiness 21 · prdr-admission 25 · run-termination 20 · run-trigger 24 — all PASS (F2 notes the integrity-floor selftest passes *vacuously* on the integrity leg). `faff lint-refs` PASS · `faff lint-cli-doc` PASS (79 subcommands) · `faff validate-adapters` PASS (19 slot skills) · `faff integrity-digest --selftest` PASS (19) · `faff events --selftest` ok (chain verify) · `faff adr validate` OK 95 ADRs (13 advisories). Label manifest: `faff labels --names` = the 7-label set. Contract dispatcher: 22 known names, every prose `faff-contract:<name>` resolved (grounding-evidence excepted — Finding 3). `faff container-check --gate` admits only `host_socket.state === "absent"` (`container-check.js:139`).

## Appendix C — coverage and honesty notes

- **Gate-subversion findings were re-read at first hand**, not taken on a subagent's report: `computeIntegrityFloor` / `decideFloor` / `resolveGateLevel` in `contract-defs.js`, both idempotent merge paths and `writeMergeRecord` in `merge-gate.js`, and the two malformed-ledger catches in `runcheck.js`.
- **Axis 3 (tracker) is partially covered.** The live MCP disconnected and reconnected behind an approval gate mid-session; the open-set figures and ticket dispositions here rest on direct pre-cutoff fetches (FAFF-127 Done, FAFF-128 Backlog), the two prior audits' full sweeps, and the CHANGELOG mapping — not a fresh full-backlog enumeration. FAFF-690's live status could not be re-fetched; its scope is read from the FAFF-435 audit record. A follow-up run with tracker access should confirm FAFF-690's state and re-sweep the open set for prose-only dependency edges.
- **Named, not exhaustively read:** the 30 sub-skill `SKILL.md`s were read for gateway-refer-back integrity and contract citations (mechanically swept), not line-by-line for internal prose drift the way the gateway was; the `faff-labs` control repos other than `stall` are private and out of session scope; the CLI's 74 modules were read at the named anchors, not in full.
