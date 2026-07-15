# FAFF-466: Wire sentry check's content reads through integrityGate's 'detection' consumer + cover events.jsonl

> Spec: faffter-dark-nlspec · 2026-07-15 · autonomous · confidence: high. Full spec on Linear FAFF-466.

**Artifact:** Design for wiring `cmdSentry check`'s ledger/events content reads through `integrityGate`'s `detection` consumer, narrowed to the buildable mechanical half after the 2026-07-15 human SPLIT decision.
**Audience:** implementer (human or agent), spec reviewer.
**Resolves:** the FAFF-324 re-examination's named (not filed) follow-up guard on ADR-0034; consumes the FAFF-373/FAFF-325 `integrityGate` mechanism already shipped.
**Scope narrowed 2026-07-15:** the `reconcile-only` enforcement decision (formerly §7's Punt) has been SPLIT OUT to follow-up spike **FAFF-511** per the human resolution. This ticket ships only the clean mechanical half — asserted-true wiring + `detection_trust` annotation — with predicate evaluation byte-identical to today for both dispositions.

---

## 1. WHY — Problem and Principles

**Load-bearing model:** `integrityGate`'s `detection` consumer disposition (`trusted` when asserted, `reconcile-only` when not) has existed since FAFF-373 shipped, but nothing in `bin/lib/sentry.js` ever calls it — confirmed dead code by a structural regression test (`test/sentry.test.mjs`, "structural guard"). The `trusted` half is a clean, mechanical wire-up that mirrors an existing pattern byte-for-byte. This ticket ships exactly that wire-up plus the visible `detection_trust` annotation; the question of what enforcement teeth the `reconcile-only` case should grow is owned by FAFF-511 and is deliberately out of scope here.

**Problem statement:** FAFF-324's re-examination demonstrated (7 hermetic probes) that every trip-capable Sentry-1 predicate — budget-breach, wall-clock-runaway, fix-review-thrash, repeated-identical-failure — is suppressible by a same-uid build lane rewriting `run-ledger.json` / `events.jsonl` on disk before `sentry check` reads them. The one un-subvertable trust channel this codebase has (FAFF-325's pid-1-sourced `FAFF_INTEGRITY_BOUNDARY` declaration) is already wired for two of `integrityGate`'s three consumers (`corrective`, `merge-floor`) but not the third (`detection`) — the one Sentry-1's kill-switch actually needs.

**Design principles:**
- **Never a direct `require` of the factory-region gate module from `sentry.js`.** `sentry.js` is `region:governance`; `corrective-integrity.js` is `region:factory`. ADR-0042's region-direction rule already forces `sentryReadCorrectiveAuthority` (the existing `corrective`-consumer caller) through a **child spawn** of `corrective-integrity --consumer corrective --run-dir <dir> --json`, never an in-process `require`. The `detection` consumer must be reached the identical way.
- **`correctiveIntegrityDirs`'s shape for `corrective`/`merge-floor` callers must not change.** Any extension for the detection call site is additive and opt-in, never a change to the existing 2- or 5-entry return shape those callers depend on (`merge-gate.js`'s `resolveIntegrity`, `corrective.js`).
- **A pure, frequently-invoked CLI cannot silently acquire network I/O.** `sentry check` is invoked at every between-units checkpoint of an autonomous run (`faff-beep-boop` — after every build return, before every launch in parallel mode, at every wave boundary) — potentially dozens of times per run. Its documented design (ADR-0034, the file header) is a pure evaluator: it reads only the on-disk orchestrator surface (`run-ledger.json`, `events.jsonl`, the heartbeat file) plus one child call to `faff budget check`. It never shells to `gh`, never calls an MCP tool, never re-derives tracker/forge state. Preserving that invariant is precisely why the enforcement question is deferred to FAFF-511 rather than answered inline here.

**Reference context:**

| Artifact | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | `correctiveIntegrityProbe` + `integrityGate` + `correctiveIntegrityDirs` — the mechanism this ticket wires in. `detection` consumer: line ~135, `reconcile-only` disposition. |
| `plugin/skills/faff/bin/lib/sentry.js` | `cmdSentry` (`check` subcommand, ~L554), `sentryReadEvents` (L451, raw `fs.readFileSync` of `events.jsonl`), `sentryReadCorrectiveAuthority` (L496, the spawn pattern to mirror), ledger read via `readLedger`/`resolveLedgerOrFault` (`shared-infra.js`). |
| `plugin/skills/faff/bin/lib/merge-gate.js` | `resolveIntegrity` (L266) — the `merge-floor` consumer's consumption pattern (in-process `require`, legal because both files are `region:factory`). Read for contrast, not reuse — `sentry.js` cannot follow this exact shape (region mismatch). |
| `plugin/skills/faff/bin/lib/reconcile.js` | `region:governance` (same region as `sentry.js`), pure core over an already-assembled `ReconcileInput`. Its own header: "It never re-observes that evidence itself: the caller assembles a ReconcileInput ... via MCP." Relevant to FAFF-511's deferred decision, not to this ticket's build. |
| `docs/adr/0034-*.md` | The FAFF-324 amendment; its "Follow-up guard" section is this ticket's direct source. Its "reconcile inline at check time" instruction is the open call now owned by FAFF-511. |
| `test/sentry.test.mjs` (L488–729) | The 7 hermetic forgery-vector probes + the structural dead-wiring guard this ticket's build must update. |

**Scope statement:** This is a security-hardening wire-up inside the existing Sentry-1 kill-switch (FAFF-49) and the existing FAFF-373/325 integrity mechanism — it adds no new trust primitive, changes no predicate behaviour, and makes the detection posture visible on the output. The enforcement decision for the unasserted case is FAFF-511.

---

## 2. OUT OF SCOPE

| Name | Why excluded | Extension point |
|---|---|---|
| Deciding/building what `sentry check` DOES on `reconcile-only` (the common, unasserted case) | SPLIT OUT by the 2026-07-15 human decision — it is an architecture call, not a wiring task, and is now owned by its own spike | **FAFF-511** (leaning option iii: a narrow, network-free reconciliation subset) |
| Building a network-capable reconcile-evidence-gathering step inside `sentry.js` | Would break `sentry check`'s pure-evaluator/no-network invariant; and is one of the options FAFF-511 must weigh, not a settled design | FAFF-511 |
| Closing the heartbeat-**file** residual (vector 4b/5) | The ticket itself explicitly says name-but-not-solve: FAFF-355 grants the build lane legitimate write access to `<run-dir>/heartbeat` for real liveness ticking, so a read-only mount would break genuine ticks | FAFF-355 / FAFF-511 |
| Changing `merge-floor`'s or `corrective`'s consumption of `integrityGate` | Out of this ticket's named scope; both are already wired and unaffected by this change | N/A |
| A cryptographic or signature-based trust channel | ADR-0061 already rejected this (a shared-uid secret is itself forgeable) | N/A |

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**New function — `sentryReadDetectionIntegrity(runDir)`** (in `sentry.js`, mirrors `sentryReadCorrectiveAuthority`):

```
FUNCTION sentryReadDetectionIntegrity(runDir) -> { trusted, disposition, basis }:
  spawn: corrective-integrity --consumer detection --run-dir <runDir> --json
  ON clean reply: return { trusted: reply.trusted, disposition: reply.disposition, basis: reply.basis }
  ON any non-OK child: return { trusted: false, disposition: "reconcile-only", basis: "read-fault" }
```

**Extended `correctiveIntegrityDirs` signature** — additive third parameter, existing two-arg call sites byte-identical:

```
FUNCTION correctiveIntegrityDirs(runDir, issue?, opts?: { events?: bool }) -> string[]
  # unchanged base return; opts.events === true appends events.jsonl
```

The `detection` call site in `cmdSentry` is the only caller that ever passes `{ events: true }`.

**New field on `sentry check`'s JSON output** (additive): `"detection_trust": { "trusted": bool, "disposition": "trusted" | "reconcile-only", "basis": string }`.

---

## 4. HOW — Behavior

```
PROCEDURE cmdSentry_check(...):
  1. resolve ledger/events/budget exactly as today (unchanged)
  2. detectionTrust := sentryReadDetectionIntegrity(resolved.runDir)
  3. IF detectionTrust.disposition == "trusted":
       # An honest outer-layer mount makes forgery of run-ledger.json AND
       # events.jsonl structurally impossible for the build lane. Closes
       # vectors 2/3/5/6/7 and the ledger-field half of vector 4 BY
       # CONSTRUCTION (the mount, not new code). Vector 4b untouched (§2).
       proceed to evaluateDerailment exactly as today
  4. IF detectionTrust.disposition == "reconcile-only":
       # Annotate-only, no behaviour change (the Chosen interim disposition;
       # any enforcement teeth are FAFF-511's to design). Continue evaluating
       # exactly as today, but SURFACE the disposition on the output so the
       # posture is visible instead of invisible.
       proceed to evaluateDerailment exactly as today
  5. Attach detectionTrust to the output payload as `detection_trust` (both branches)
```

**Required-dir extension.** The consumer name alone (`--consumer detection`) is enough for `cmdCorrectiveIntegrity` to pass `{ events: true }` into its own internal `correctiveIntegrityDirs` call — no new flag on the spawned command line.

**Failure modes:**
- `sentryReadDetectionIntegrity` throws or the child times out → fail-safe to `reconcile-only`/`read-fault`, never `trusted`.
- A malformed reply → treat as `reconcile-only`, never coerced to `trusted`.
- `events.jsonl` absent (fresh run) → no crash; `dirsCoverAll` handles an unwritten-yet required path the same as any other.

---

## 5. SCENARIOS — Born-verifiable objectives

**Scenario 1** (asserted-true wiring): Given a genuine pid-1 declaration covering both `run-ledger.json` and `events.jsonl`, `sentry check --json`'s `detection_trust.disposition` is `"trusted"`.

**Scenario 2** (unasserted — the common case, Chosen annotate-only disposition): Given no declaration at all, `detection_trust.disposition` is `"reconcile-only"` and every existing predicate's trip behavior is UNCHANGED from pre-this-ticket — pinned explicitly so that when FAFF-511 later adds enforcement teeth it lands as a deliberate, visible diff, not a silent regression.

**Scenario 3** (read-fault fail-safe): Given the spawned `--consumer detection` child fails (non-zero exit / unparseable stdout, via a hermetic test hook mirroring the existing `--budget-json` seam), `detection_trust` is `{trusted:false, disposition:"reconcile-only", basis:"read-fault"}` and `sentry check` still exits 0.

**Scenario 4** (dir-set extension, CLI directly): Given a declaration covering `run-ledger.json` + `corrective/` but NOT `events.jsonl`, `faff corrective-integrity --consumer detection --run-dir <dir> --json` replies `dir-mismatch`/`reconcile-only`, while the SAME declaration queried with `--consumer corrective` is unaffected (that param is detection-only).

---

## 6. DESIGN DECISION RATIONALE

**Reaching the factory-region gate from `sentry.js` without violating ADR-0042.** Options: direct `require` (rejected — violates region direction) vs. child spawn mirroring the existing `corrective`-consumer call. **Chosen:** child spawn — zero new pattern.

**Extending the required-dir set without disturbing existing callers.** Options: always include `events.jsonl` in the base return (rejected — changes the shape `merge-gate.js`'s tests assert on) vs. a new optional third parameter. **Chosen:** `correctiveIntegrityDirs(runDir, issue, {events:true})`, additive only.

**What `disposition: "trusted"` means for predicate evaluation.** **Chosen:** no change to predicate logic — the mount makes the content trustworthy by construction; sentry's job is to surface the verification, not compute differently.

**What `disposition: "reconcile-only"` means for predicate evaluation — the common, unasserted case.** **Chosen:** annotate-only, no behaviour change — `sentry check` continues evaluating byte-identically to today and simply surfaces the `reconcile-only` disposition on the output. This is a deliberate, reviewable interim pinned by Scenario 2. Whether (and how) this case grows real enforcement teeth — ADR-0034's "reconcile inline at check time" vs. a network-free subset vs. orchestrator-assembled evidence — is a settled-out-of-scope architecture question owned by **FAFF-511** (human leaning: option iii, a narrow network-free reconciliation subset, keeping `sentry check` a pure evaluator). This spec makes no enforcement decision; it only guarantees the annotation is present and the current behaviour is pinned so FAFF-511's eventual change is a visible diff.

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:**

- **None open in this ticket.** The former Punt — "what should `cmdSentry check` concretely DO when `detection_trust.disposition` is `reconcile-only`" — was RESOLVED-by-split on 2026-07-15: it is now owned by follow-up spike **FAFF-511** (leaning option iii, a narrow network-free reconciliation subset). This ticket's disposition for that case is the **Chosen** annotate-only, no-behaviour-change interim (§6), pinned by Scenario 2. See FAFF-511 for the deferred enforcement decision and its open sub-questions (which predicates are defensible network-free, per-checkpoint cost/latency budget, interaction with the FAFF-355 heartbeat residual).

**Assumptions:**

- **Assumes:** `corrective-integrity.js`'s `CONSUMERS` array already includes `"detection"` and its CLI already accepts `--consumer detection` (confirmed present and selftested, L163/L135). Validate: `faff corrective-integrity --consumer detection --json` returns a `disposition` today, pre-this-change.
- **Assumes:** `test/sentry.test.mjs`'s structural guard test (L688) is the one test this ticket's build must flip from "asserts absence" to "asserts presence." Validate: grep the test file for `SENTRY_SRC` + the `!/correctiveIntegrityProbe|integrityGate/` assertion before editing.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] The `detection` consumer is reachable from `sentry check` via a child spawn only — no `require("./corrective-integrity")` added to `sentry.js`

### From WHAT
- [ ] `sentryReadDetectionIntegrity(runDir)` exists, spawns `corrective-integrity --consumer detection --run-dir <dir> --json`, fails safe to `reconcile-only`/`read-fault` on any non-OK child
- [ ] `correctiveIntegrityDirs(runDir, issue, opts)` accepts additive `{events:true}`; two-arg call shape used by `merge-gate.js`/`corrective.js` is byte-identical (existing selftest assertions on `base.length===2` / `withIssue.length===5` still pass unmodified)
- [ ] `cmdCorrectiveIntegrity` passes `{events:true}` into its internal `correctiveIntegrityDirs` call specifically when `--consumer detection` is given

### From HOW
- [ ] `sentry check --json` gains `detection_trust: {trusted, disposition, basis}` on every invocation that resolves a run-dir
- [ ] Asserted:true → `detection_trust.disposition === "trusted"`, predicate evaluation provably unchanged (Scenario 1)
- [ ] Unasserted (common case) → `detection_trust.disposition === "reconcile-only"`, predicate evaluation BYTE-IDENTICAL to pre-this-ticket (Scenario 2)
- [ ] Read-fault on the spawn → `reconcile-only`/`read-fault`, never `trusted`; `sentry check` still exits 0 (Scenario 3)

### From HOW (edge cases)
- [ ] `events.jsonl` absent causes no crash in the extended `correctiveIntegrityDirs`/`dirsCoverAll` path
- [ ] `test/sentry.test.mjs`'s structural guard (L688) is updated from absence- to presence-assertion, with a cross-reference to **FAFF-511** for the deferred reconcile-only enforcement decision

### Integration smoke test
`faff sentry check --run-dir <a real run-dir with no FAFF_INTEGRITY_BOUNDARY> --json` returns exit 0 with `detection_trust` present, `disposition: "reconcile-only"`, and `verdicts`/`intervention` unchanged from a pre-this-ticket run against the same fixture.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```

---

## Spec-review

*Reviewer: faffter-dark-spec-review — verdict retained: approve.*

The methodology critique on the prior (medium) spec recommended exactly this split (right-sizing, principle 4): ship the clean mechanical half now, spike the reconcile-only enforcement architecture separately. The 2026-07-15 human decision ratified that recommendation and filed FAFF-511. With the sole open Punt removed from this ticket's scope, all four decisions are **Chosen**, every scenario is born-verifiable, and no architectural question remains inside this ticket. Approve → fire-and-forget.

```faff-contract:spec-review-verdict
{ "verdict": "approve",
  "lenses": {
    "architectural": "pass",
    "infosec": "pass",
    "methodology": "pass",
    "qa": "pass" },
  "blocking": [],
  "note": "Narrowed to the buildable mechanical half; reconcile-only enforcement split to FAFF-511. All decisions Chosen, all scenarios born-verifiable." }
```
