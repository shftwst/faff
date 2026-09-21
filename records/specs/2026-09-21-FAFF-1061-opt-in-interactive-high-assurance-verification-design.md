# FAFF-1061 — Opt-in interactive high-assurance verification

> Spec: faffter-dark-nlspec · 2026-09-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1061.
> Revised 2026-09-19 (interactive): corrected the acting axis to unattended-vs-interactive (not L4-vs-not-L4); the floor is computed and surfaced at interactive, and the holdout leg detects a cage to set verdict trust. Settled: verification.* namespace, single resolver, holdout in v1 behind cage-trust, interactive floor-block reports only; re-rated high.

Let a hands-on operator at an interactive (attended) session run faff's high-assurance verification (code-blind holdout, adversarial spec-review, adversarial code-review) on their own work, computing and surfacing the real floor verdict, while the machine never acts on it. Audience: the build agent, and the human reviewers gating the change.

## 1. WHY — Problem and Principles

**Two orthogonal axes, currently fused.** "Verification confidence" is how hard the work was checked (holdout, adversarial reviews) and what the resulting floor verdict is. "Acting authority" is whether the machine merges, parks, or refuses on that floor unattended. Today the high-assurance verification only runs inside the L4 lights-out mint, so the only way to get the floor is to also hand faff full unattended authority.

**The acting axis is unattended-vs-interactive, NOT L4-vs-not-L4.** L3 is also unattended (a self-drain over a pre-approved list, autonomy reined in via appetite, versus L4's appetite-full-from-a-seed-PRD). FAFF-717 already keys its acting decision (the Sentry `abort` kill-switch) on the declared-unattended signal (`autonomous.unattended` / the `autonomous` boolean), not the mint — `actsOnSentryAbort(ledger, cfg)` acts iff L4 **or** declared-unattended. This ticket applies the same axis to the verification floor.

**The matrix (this ticket is the top row only).**

```
mode                     | floor verification | acts on floor (auto-merge/park/refuse)?
-------------------------|--------------------|------------------------------------------
interactive (attended)   | opt-in             | NO  — advisory: compute + surface, human acts   <- FAFF-1061
unattended, not L4 (L3)  | opt-in             | YES when opted in — floor becomes binding       <- FAFF-1040
unattended, L4 (lights)  | required (always)  | YES — refuses/parks on a non-green floor         <- existing
```

**Problem statement.** A power user in an interactive session, deliberately without unattended authority, cannot get the floor (holdout / adversarial-review) signal on their own build. The verification legs are read-only by nature; nothing structural stops them running under an interactive ledger, and nothing stops the floor being computed and shown. This change adds independently opt-in-able verification legs for interactive sessions that run the machinery, compute the real floor, and surface it — while every acting surface stays gated on the unattended signal, untouched.

**Design principles.**

**Verification advises at interactive; only the unattended path acts.** Enabling a leg at an interactive session runs it, computes the floor (including holdout), and surfaces the verdict. It must not auto-merge, auto-park, or refuse; the human drives every gate. The acting consumers (the merge-gate auto-merge interlock, the autonomous auto-park, the L4 floor-refuse) stay gated on the unattended signal exactly as today.

**Compute the floor, do not suppress it.** "Advisory" means the operator gets the real pass/block floor verdict (holdout folded through `decideFloor`), not a narrative substitute. The difference from unattended is who acts, not whether the floor is known.

**Config is fail-safe-off, mirroring FAFF-717.** Each new leaf defaults to `"false"`, resolved fail-closed via `literalTrue`. A config fault can never switch verification on, and can never regress an existing unattended run (whose signal short-circuits before any interactive-verification config read).

**Reference context.**

| Surface | File | Relevance |
|---|---|---|
| Sentry abort resolver (acting axis precedent) | `plugin/skills/faff/bin/lib/sentry.js` (`actsOnSentryAbort`, `declaredUnattendedFromConfig`) | Acts iff L4 OR declared-unattended — the exact attended-vs-unattended axis this reuses |
| Config defaults + namespaces | `plugin/skills/faff/bin/lib/config.js` (`DEFAULTS`, `WRITABLE_NAMESPACES`, `resolveAppetite`, `resolveConvergence`) | Where the new leaves live; the L4-only escalations that stay untouched |
| Merge floor (pure) | `plugin/skills/faff/bin/lib/contract-defs.js` (`decideFloor`, `resolveGateLevel`) | Compute the holdout floor for surfacing; keep the acting consumer gated on the unattended signal |
| Merge-gate floor inputs / interlock | `plugin/skills/faff/bin/lib/merge-gate.js` (`readHoldout`, auto-merge interlock) | Read the holdout when a leg ran; the auto-merge interlock stays unattended-gated |
| Lens selection | `plugin/skills/faff/bin/lib/admissibility.js` (`selectLenses`, `cmdSpecReviewLenses`) | `faff spec-review-lenses --level` pins the full four-lens set |
| Holdout call sites (prose gate) | `plugin/skills/faff-beep-boop/SKILL.md` (§10b), `plugin/skills/faff-graft/SKILL.md` | "L4 lights-out signal only" gate to widen to an interactive opt-in |
| Cage / evaluator | `plugin/skills/faff/bin/lib/eval-holdout-live`, `test/eval-holdout-live.test.mjs` | Detect a cage to stamp holdout verdict trust (physically-blind vs attested-preview) |
| Graft forwarded signals | `plugin/skills/faff-graft/SKILL.md` (`autonomous`, `lights_out`) | The interactive opt-in is a third, verification-only signal; it never flips these |

## 2. OUT OF SCOPE

- **Any grant of unattended acting authority.** The acting axis (`autonomous.unattended`) is FAFF-717's and stays untouched; enabling a verification leg never flips `autonomous`/`lights_out`.
- **The unattended-L3 binding-floor opt-in (the matrix middle row).** Whether an unattended L3 run may opt into a *binding* floor is FAFF-1040's decision. FAFF-1061 only builds the interactive/advisory top row, and names the boundary so both compose on one unattended-keyed acting gate.
- **Resolving FAFF-597 evaluator physical code-blindness enforcement.** FAFF-1061 detects a cage and stamps the verdict's trust level; it does not itself build or physically enforce the cage.
- **New verification lenses, evaluators, or occupants.** Reuses the shipped legs unchanged.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| Verification leg | One of the three opt-in-able machines: holdout evaluator, adversarial spec-review, adversarial code-review |
| Floor verdict | `decideFloor`'s meets-spec / blocked result (holdout folded in), computed and surfaced at interactive |
| Advise-only | The floor is computed and shown; no acting consumer (auto-merge / park / refuse) fires |
| Acting signal | The unattended signal (`autonomous` true, i.e. L4 or declared-unattended L3) that gates every acting consumer — unchanged by this ticket |
| Cage-trust | Holdout verdict trust: physically-blind when a cage is detected, attested-preview otherwise |

**Config leaves.** Three fail-closed boolean leaves, one per leg, under the new top-level `verification.*` namespace:

```
verification.holdout        # opt in the code-blind holdout evaluator leg at an interactive session
verification.spec_review    # opt in the adversarial (full-lens) spec-review leg
verification.code_review    # opt in the adversarial code-review second-opinion leg
(all default "false", resolved via literalTrue, fail-closed)
```

## 4. HOW — Behaviour

**The verification resolver (config-read, mirrors FAFF-717's read half; no acting disjunct). Single resolver, consulted at all three call sites.**

```
PROCEDURE resolveInteractiveVerification(ledger, cfg):
  1. IF unattended(ledger, cfg):  RETURN all-false   # unattended path runs/gates its own floor; not this resolver
  2. IF no ledger / no attended run: RETURN all-false
  3. RETURN { holdout: literalTrue(dig(cfg,"verification.holdout")),
              spec_review: literalTrue(dig(cfg,"verification.spec_review")),
              code_review: literalTrue(dig(cfg,"verification.code_review")) }
# It reads config only. It never sets/escalates level, never flips autonomous/lights_out.
# ONE resolver read at all three call sites (holdout gate, spec-review lens-pin, code-review),
# so the three surfaces cannot drift independently.
```

**Per-leg wiring.**

- **Holdout.** Widen the "L4 lights-out signal only" prose gate so it also fires on an interactive opt-in. Run the same chain (architecture-proposal, `slots.env` standup, `slots.evaluator` code-blind evaluate, `faff contract holdout-verdict`, teardown on every path), **fold the verdict through `decideFloor`**, and surface the floor result. Detect a cage and stamp the verdict trust: cage present -> physically code-blind (high trust); no cage -> attested code-blind (FAFF-597 preview caveat). The genuine no-op is only the zero-born-verifiable case, not "interactive".
- **Adversarial spec-review.** Already level-agnostic by occupant choice; when `spec_review` is opted in, pin the full four-lens adversarial set via `faff spec-review-lenses`. Verdict advisory; contract unchanged.
- **Adversarial code-review.** When `code_review` is opted in, run the adversarial pass and surface its verdict; keep outage behaviour advisory (exit-5), never the unattended exit-9.

**Level-independent UX.** The interactive opt-in is available whether the attended ledger is L2 or an attended L3. It fires either as a **standing config posture** (the `verification.*` leaves, always run on this operator's interactive builds) or a **per-invocation ask** (a `--verify` / `--verify-<leg>` graft flag for a single build). This is a UX choice within interactive, not an L2-vs-L3 distinction.

**The acting invariant (load-bearing).**

```
INVARIANT the acting consumers gate on the UNATTENDED signal, unchanged:
          - merge-gate auto-merge interlock: fires only when unattended
          - autonomous auto-park: fires only when unattended
          - L4 floor-refuse: unchanged (lights-out mandatory floor)
INVARIANT decideFloor MAY compute the holdout floor at an opted-in interactive run,
          FOR SURFACING; an interactive floor-block is REPORTED, never flips the PR to draft,
          and triggers NO auto-merge and NO auto-park.
INVARIANT resolveAppetite returns "full" ONLY for a live L4 ledger; an interactive
          verification opt-in never mints/escalates a ledger, so appetite is unchanged.
INVARIANT resolveConvergence, eligibility, and the four autonomous parks are untouched.
```

**No-standup-target degradation.** Zero born-verifiable criteria (a CLI/skills repo such as faff itself) -> the holdout leg no-ops with the recorded nothing-to-evaluate caveat, surfaced "not applicable", never a block or error. This is separate from cage-trust: a no-cage run with real criteria still runs, carrying the attested-preview caveat.

**Anti-patterns.** Minting an L4 ledger (or flipping `lights_out`/`autonomous`) to obtain the machinery. Letting an interactive floor-block reach the auto-merge interlock, the auto-park, or a PR-to-draft flip. Reusing `actsOnSentryAbort`'s acting disjunct on the *verification-run* resolver (running a leg is not acting on it).

## 5. DESIGN DECISION RATIONALE

- **Acting axis** — **Chosen:** the acting gate is the unattended signal (mirroring FAFF-717), not `level === "L4"`. Interactive advises; unattended acts; lights-out makes the unattended floor mandatory.
- **Compute vs suppress the floor at interactive** — **Chosen:** compute the real floor (holdout through `decideFloor`) and surface it; only the acting consumers are withheld.
- **Holdout trust** — **Chosen:** detect a cage and stamp verdict trust (physically-blind vs attested-preview); the FAFF-597 preview caveat is the no-cage branch, not a blanket status.
- **Config namespace** — **Chosen:** a new top-level `verification.*` namespace (added to `WRITABLE_NAMESPACES` and `.faffrc.example.yaml`). Rationale: this is a non-autonomous posture, so co-locating under `autonomous.*` would re-fuse the axis just split; the schema addition is small and honest.
- **One resolver or three** — **Chosen:** a single `resolveInteractiveVerification` consulted at all three call sites. Rationale: the three sites are not one chokepoint, so one resolver prevents wiring-drift.
- **Holdout v1 inclusion** — **Chosen:** include the holdout leg in v1 behind the cage-trust stamp; the no-cage branch carries the FAFF-597 preview caveat. Rationale: cage-trust makes the verdict trustworthy when caged and honestly caveated when not, so deferral is unnecessary.
- **Interactive floor-block signal** — **Chosen:** purely report the floor verdict; do not flip the PR to draft. Rationale: drafting is itself an action, and the interactive contract is that the human drives every state change.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none remaining — the four architecture calls are settled in Design Decision Rationale (verification.* namespace, single resolver, holdout in v1 behind cage-trust, floor-block reports only).

- **Assumes:** `slots.spec_review = faffter-dark-spec-review` and `slots.review = faffter-dark-adversarial-review` are configured (adversarial behaviour is occupant-choice). Validate before assuming.
- **Assumes:** interactive graft mints an attended ledger (`faff run-ledger init-interactive`, L2) so there is a run to attach the posture to. Validate.
- **Assumes:** cage presence is detectable at runtime (the evaluator/eval-holdout-live surface). Validate the detection seam before relying on the trust stamp.

## 7. DONE — Definition of Done

**From WHY:** an interactive (attended) session can run each verification leg, compute the real floor (holdout folded through `decideFloor`), and surface it, with no auto-merge, no auto-park, and no PR-to-draft flip; the acting consumers remain gated on the unattended signal.

**Config + resolver:** three fail-closed boolean leaves exist under `verification.*` (default `"false"`, `literalTrue`, echoed in `config get`); typo/non-boolean resolves false (unit test); the single resolver returns per-leg booleans for an attended run and all-false for unattended/absent; `verification` is added to `WRITABLE_NAMESPACES` and documented in `.faffrc.example.yaml`.

**Behaviour:** holdout opted in on an attended born-verifiable run computes and surfaces the floor with a cage-trust stamp; spec_review opted in pins the full four-lens set (contract unchanged); code_review opted in keeps outage at exit-5 advisory; the opt-in works as a standing posture or a per-invocation flag, independent of L2-vs-attended-L3.

**Acting invariant:** an interactive floor-block is reported only — no auto-merge, no auto-park, no PR-to-draft flip (verified against an attended ledger); the merge-gate auto-merge interlock and autonomous auto-park stay gated on the unattended signal (byte-identical with the leaves on vs off); `resolveAppetite` never returns `"full"` on an attended run; eligibility and the four parks unchanged.

**Trust + degradation:** a cage-present run stamps the holdout verdict physically-blind; a no-cage run carries the attested-preview caveat; a zero-born-verifiable run no-ops with the nothing-to-evaluate caveat, never a block or error.

confidence: high
spec-review: approve
build-tier: complex
