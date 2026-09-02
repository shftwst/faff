# Spec — FAFF-965: `faff config check` false-warns on `capture` (known-namespaces allowlist missing a key faff reads)

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-965.

This is a buildable spec for **FAFF-965** — *`faff config check` false-warns on `capture`: the known-namespaces allowlist is missing a key faff reads*. Audience: the build agent implementing the fix, and the human reviewers gating it. It is a design doc (WHY / WHAT / HOW-at-design-level / DONE), not a step-by-step.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff config check`'s known-key lint (Check 9, FAFF-794) decides whether a top-level `.faffrc.yaml` key is a real namespace or a probable typo by testing membership in a single set, `WRITABLE_NAMESPACES`. That set answers a *different* question — "which namespaces may `config set` write into" — and is being reused to answer "which namespaces does faff recognise at all". Those two questions have different answers: faff reads some namespaces via `dig(config, "<ns>.…")` that `config set` was never taught to write. Every such read-only namespace is, to the lint, an unrecognised typo.

**Problem statement.** The repo's own `.faffrc.yaml` ships `capture: { decision_kernel: "on" }` (added by FAFF-949), which `decision-capture.js` reads and honours — yet `faff config check` calls it "an unrecognised top-level key (probable typo)" that "resolves to the default", and exits 1. The checker is defaming a live, obeyed key. This change widens the lint's notion of "recognised" to include the read-only namespaces faff genuinely reads, and adds a guard so a future read-only namespace can't silently reintroduce the same false warning.

**Design principles.**

**Preserve the writable-versus-recognised distinction.** `WRITABLE_NAMESPACES` has a precise, tested meaning: the namespaces `config set` may write and that must appear in `.faffrc.example.yaml` (asserted by `configSetSelftest`). The fix must not dilute that meaning by folding read-only namespaces into it — doing so would make `config set capture.decision_kernel on` succeed and would break the example-drift invariant. The lint's recognised set is a *superset* of the writable set, not the same set.

**Close the drift class, not just the instance.** The root cause is a maintenance coupling: a config *read* was added in one file, the lint's allowlist in another was not updated, and nothing tied them together. Patching only `capture` leaves the identical latent bug in `provenance` (read by `harness.js`, missing from the set, dormant only because no rc sets it today). The durable fix registers every currently-read namespace and adds a deterministic guard that fails loud when a new read appears unregistered.

**A lint may never hard-fail on an unknown key.** Existing forward-compat contract: known-key findings are always `severity: "warn"`, so a not-yet-allowlisted key degrades signal but never blocks. Any guard added here runs at `--selftest`/CI time against the *source*, not against a user's runtime config — it must not change the runtime lint's warn-only posture.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js` (`WRITABLE_NAMESPACES` ~L942; `knownKeyLint` ~L1574; call sites ~L1685; `configSetSelftest` ~L1280; `configCheckSelftest` ~L1594+) | dependency-free Node | The lint, the set it abuses, and the two selftest harnesses this change edits |
| `plugin/skills/faff/bin/lib/decision-capture.js:234` | Node | Reads `dig(data, "capture.decision_kernel") === "on"` — the read the lint doesn't recognise |
| `plugin/skills/faff/bin/lib/harness.js:668,685` | Node | Reads `dig(cfgData, "provenance.harness")` / `"provenance.model")` — the second, dormant instance |
| `plugin/skills/faff/.faffrc.example.yaml` + `configSetSelftest` example-drift check | YAML + Node | The invariant that keeps `WRITABLE_NAMESPACES` honest; must stay intact |

**Scope statement.** This sits entirely inside `config.js`'s config-check surface; it changes what the lint recognises and adds a guard, and touches no runtime read path in `decision-capture.js` or `harness.js`.

## 2. OUT OF SCOPE

- **Promoting `capture`/`provenance` to first-class writable config.** Not this issue — adding them to `WRITABLE_NAMESPACES`, giving them `DEFAULTS` entries, and documenting them in `.faffrc.example.yaml` so `config set`/`config get` handle them. Why excluded: that is a semantic upgrade of read-only keys to full config citizens, larger than fixing a false warning and carrying its own migration of `decision-capture.js`'s hardcoded off-default into `DEFAULTS`. Extension point: a future issue adds the namespace to `WRITABLE_NAMESPACES`, a `DEFAULTS["capture.decision_kernel"]` scalar, and an example stanza — at which point it moves out of the read-only set defined here.
- **Value-shape validation of `capture.decision_kernel`.** Not this issue — the lint inspects top-level key *names* only (FAFF-794 §2); it will not warn on `decision_kernel: "yes"` vs `"on"`. Why excluded: out of the known-key lint's charter. Extension point: a dedicated value-lint check in `computeConfigCheck`.
- **A general schema-source-of-truth registry unifying `DEFAULTS`, `WRITABLE_NAMESPACES`, and reads.** Not this issue — deriving all three from one declaration. Why excluded: read-only namespaces have no `DEFAULTS` entry, so a single derivation is not available cheaply; the guard here achieves the same drift-safety without the refactor. Extension point: a future consolidation could replace the guard with derivation.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Writable namespace | A top-level namespace `config set` may write; member of `WRITABLE_NAMESPACES`; must appear in `.faffrc.example.yaml`. |
| Read-only namespace | A top-level namespace faff *reads* via `dig(config, "<ns>.…")` but `config set` does not write and `DEFAULTS` does not register (today: `capture`, `provenance`). |
| Recognised namespace | Any namespace the known-key lint treats as valid: the union of writable and read-only. Not a typo. |

**The set the lint consumes.**

```
SET WRITABLE_NAMESPACES          # unchanged; config set's write-guard + example-drift invariant
SET READ_ONLY_NAMESPACES = { "capture", "provenance" }   # new; recognised-but-not-writable
DERIVED RECOGNISED_NAMESPACES = WRITABLE_NAMESPACES ∪ READ_ONLY_NAMESPACES   # new; the lint's set
```

- `READ_ONLY_NAMESPACES` carries a charter comment stating what it is (namespaces read via `dig` but not `config set`-writable and not in `DEFAULTS`) and the invariant that binds it (every such namespace the source reads must be a member — asserted by the new guard).
- The lint call sites (`computeConfigCheck`, ~L1685-1686) pass `RECOGNISED_NAMESPACES` instead of `WRITABLE_NAMESPACES`. `config set`'s write-guard (~L1099) and `configSetSelftest`'s example-drift check (~L1287) keep using `WRITABLE_NAMESPACES` untouched.

**Design decision — where recognised-but-read-only keys live.** Options: reuse `WRITABLE_NAMESPACES` (one set, minimal diff) versus a separate `READ_ONLY_NAMESPACES` the lint unions in. Reuse is smaller but makes `config set capture.decision_kernel on` succeed for a key with no `DEFAULTS` entry (so `config get` wouldn't resolve it — a get/set asymmetry) and breaks `configSetSelftest`'s "example ⊇ writable" invariant unless `capture`/`provenance` are also added to the example, over-documenting read-only keys as if writable. The separate set keeps each set answering exactly one question. **Chosen:** a separate `READ_ONLY_NAMESPACES`, with the lint consuming the union — the writable-vs-recognised distinction is load-bearing (it backs `config set`'s refusal message and the example-drift guard) and must survive the fix.

**Design decision — fix `capture` only, or `capture` and `provenance` together.** A source scan of `dig(<config>, "<ns>.…")` reads yields exactly two namespaces absent from the recognised set today: `capture` and `provenance`. `provenance` does not false-warn yet only because no rc sets it; the same warning fires the instant one does. **Chosen:** register both `capture` and `provenance` now — they are one bug with two instances, and shipping the fix while knowingly leaving the second instance latent contradicts the close-the-drift-class principle at trivial marginal cost.

## 4. HOW — Behavior

**Architecture and approach.** Two edits and one guard, all within `config.js`:

1. Define `READ_ONLY_NAMESPACES` and `RECOGNISED_NAMESPACES` (the union) near `WRITABLE_NAMESPACES`.
2. Repoint the two `knownKeyLint(...)` calls in `computeConfigCheck` from `WRITABLE_NAMESPACES` to `RECOGNISED_NAMESPACES`. Nothing else in the lint changes: flat-dotted detection, per-file attribution, and the warn-only severity are unaffected; the "Known namespaces:" help text now lists the union (so `capture`/`provenance` appear).
3. Add a drift guard as a `--selftest` case that scans the CLI source and asserts every read namespace is recognised.

**The lint decision, after the change.**

```
PROCEDURE classify_top_key(topKey, RECOGNISED_NAMESPACES):
  1. IF topKey contains ".":  (flat-dotted mistake — unchanged)
     a. prefix := segment before first "."
     b. IF prefix ∈ RECOGNISED_NAMESPACES: warn "flat dotted key — you likely meant a nested map"
        ELSE:                              warn "flat dotted key with unrecognised namespace"
  2. ELSE IF topKey ∉ RECOGNISED_NAMESPACES: warn "unrecognised top-level key (probable typo) … Known namespaces: <sorted union>"
  3. ELSE: silent (recognised)
```

With `capture` ∈ `RECOGNISED_NAMESPACES`, step 2 no longer fires for the repo's own `capture:` stanza; `config check` on faff's own repo emits no known-key finding for it, and (absent other findings) exits 0.

**The drift guard.** A behavioural summary: prove at CI time that the recognised set covers every namespace the code actually reads, so the FAFF-949-class drift (a read added, the set not updated) fails loud instead of shipping a false warning.

```
PROCEDURE recognised_namespaces_drift_selftest():
  1. Read the sibling bin/lib/*.js source files as text.
  2. Regex-extract every occurrence of  dig( IDENT , "NS.…" )  where:
       - IDENT ∈ a small, explicit CONFIG_DOC_IDENTS allowlist
         (the blessed variable names that hold a resolved config document —
          observed today: cfg, cfgData, data, mergedDoc, d, parsed),
       - NS is the top-level segment before the first ".".
  3. exceptions := an explicit, commented set of (IDENT, NS) pairs deliberately
     excluded — a blessed ident that, at a specific call, holds non-config data.
  4. read := { NS from step 2 } minus exceptions.
  5. missing := read \ RECOGNISED_NAMESPACES
  6. ASSERT missing is empty, naming any offenders in the failure message.
```

The guard lives beside the existing `--selftest` cases (`configSetSelftest`'s example-drift check is the sibling pattern; `configCheckSelftest` around ~L1594+ is the natural host). It is deterministic, in-process, dependency-free — matching the module-selftest idiom run in CI via `faff validate-adapters`.

**Design decision — drift guard, or hand-maintenance alone.** Options: rely on human diligence to update the set whenever a read is added (the status quo that failed here), versus the source-scan guard above. The guard cannot be perfectly sound — it is a heuristic over source text (see Failure Modes) — but its two error directions are both benign: a false positive fails the selftest at authoring time, cheaply self-correcting (the author adds the namespace to the recognised set or to `exceptions`); a false negative simply misses a case, no worse than today's zero coverage. The guard is therefore strictly positive-value, and this self-hosting repo's charter favours deterministic guards over diligence. **Chosen:** add the source-scan `--selftest` guard alongside the two-namespace registration; the ticket's own "cheap guard" suggestion and the codebase's single-source-of-truth bias both point here.

**Failure modes.**

- **The failure:** the guard's `CONFIG_DOC_IDENTS` heuristic mis-scopes — a blessed identifier holds non-config data at some call (false positive), or a config read uses an un-blessed variable name or a helper wrapper the regex doesn't see (false negative). **How you'd know:** a false positive shows up immediately as a `recognised_namespaces_drift_selftest` failure naming a "namespace" that is not a config namespace; a false negative shows up as a real `config check` false-warn slipping through despite a green selftest. **What it means:** proceed — a false positive is resolved by adding the pair to `exceptions` (with a comment), a false negative is caught by the same user-facing symptom that opened this ticket and is no regression from today. Do not chase perfect soundness; the guard's job is to make the *common* drift path loud, not to statically prove config-read coverage.
- **The failure:** future code reads config via a fundamentally different accessor than `dig(config, "…")` (e.g. destructured or a new helper), silently outside the guard's reach. **How you'd know:** the guard passes yet a new read-only namespace false-warns. **What it means:** narrow — extend the scan pattern when that accessor appears; it does not exist in the current source.

**Anti-pattern:** adding `capture`/`provenance` to `WRITABLE_NAMESPACES` to make the warning stop. Why: it silently makes them `config set`-writable and forces them into `.faffrc.example.yaml` to satisfy the example-drift check, over-promoting read-only keys and conflating the two sets the fix exists to keep distinct.

**Anti-pattern:** writing the guard to scan for *any* `dig(...)` call regardless of first argument. Why: `dig` is a general nested getter used on non-config objects too; an unscoped scan floods the guard with false positives and makes it untrustworthy. The `CONFIG_DOC_IDENTS` allowlist is the point.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the repo's own .faffrc.yaml containing `capture: { decision_kernel: "on" }`
When `faff config check` runs
Then no known-key finding is emitted for `capture`, and (absent other findings) the process exits 0
```

```
Given a config document with `provenance: { harness: "x" }`
When the known-key lint runs
Then `provenance` is treated as recognised (no "unrecognised top-level key" warning)
```

- The known-key lint's "Known namespaces:" help text lists the full recognised union, including `capture` and `provenance`, in sorted order.

## 6. Design Decision Rationale

**Where do recognised-but-read-only namespaces live?**
- *Reuse `WRITABLE_NAMESPACES`:* smallest diff. Cons: makes `config set capture.decision_kernel on` succeed for a key with no `DEFAULTS` (get/set asymmetry); breaks `configSetSelftest`'s example-drift invariant unless the keys are also over-documented in the example.
- *Separate `READ_ONLY_NAMESPACES`, lint unions:* one extra set + union. Cons: two sets to hold in mind, resolved by charter comments.
- **Chosen:** separate `READ_ONLY_NAMESPACES` with the lint consuming `WRITABLE_NAMESPACES ∪ READ_ONLY_NAMESPACES` — preserves the tested writable-vs-recognised distinction that backs `config set`'s refusal path and the example-drift guard.

**Fix `capture` only, or `capture` and `provenance`?**
- *`capture` only:* matches the literal ticket repro. Cons: knowingly leaves the identical latent bug in `provenance`.
- *Both:* one extra set member. A source scan proves these are the only two missing today.
- **Chosen:** both — one bug, two instances; marginal cost is a single string.

**Drift guard, or hand-maintenance?**
- *Hand-maintenance:* zero new code. Cons: it is exactly what failed here.
- *Source-scan `--selftest` guard:* deterministic CI signal. Cons: heuristic over source text, imperfectly sound — mitigated by a blessed-identifier allowlist and an explicit exceptions list; both error directions are benign.
- **Chosen:** the guard — strictly positive-value and aligned with the repo's deterministic-guard charter.

At the time of writing, the two namespaces read but unrecognised are exactly `capture` and `provenance`; the guard is what keeps that list current without manual vigilance.

## 7. Open Questions and Assumptions

**Open Questions.** None — all decisions are closed above.

**Assumptions.** None — every claim (the abused set, the two call sites, the two reads, the exit-1 behaviour, `config set`'s write-guard, the example-drift selftest) is verified against the current source and needs no external validation.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff config check` on faff's own repo (`.faffrc.yaml` with `capture: { decision_kernel: "on" }`) emits no known-key finding for `capture`.
- [ ] `WRITABLE_NAMESPACES`'s membership, `config set`'s write-guard (~L1099), and `configSetSelftest`'s example-drift check are unchanged (no read-only namespace added to the writable set or the example).

### From WHAT (types and interfaces)
- [ ] `READ_ONLY_NAMESPACES = { "capture", "provenance" }` exists with a charter comment stating it is read-via-`dig`, not `config set`-writable, not in `DEFAULTS`.
- [ ] The lint consumes the union `WRITABLE_NAMESPACES ∪ READ_ONLY_NAMESPACES`; both `knownKeyLint` call sites in `computeConfigCheck` pass the union, not `WRITABLE_NAMESPACES`.

### From HOW (behaviour)
- [ ] A config doc with a top-level `provenance:` key produces no "unrecognised top-level key" warning.
- [ ] The known-key lint's "Known namespaces:" message lists the full recognised union (including `capture` and `provenance`) sorted.
- [ ] A known-key `configCheckSelftest` case asserts a `capture:` stanza yields no known-key finding (and exit 0 absent other findings).

### From HOW (drift guard)
- [ ] A `--selftest` case scans `bin/lib/*.js` for `dig(<blessed-ident>, "<ns>.…")` reads and asserts each namespace is in the recognised union; it passes on the current source.
- [ ] The guard uses an explicit `CONFIG_DOC_IDENTS` allowlist and an explicit `exceptions` list, each commented.
- [ ] Injecting a read of an unregistered namespace via a blessed identifier makes the guard fail, naming the offending namespace.

### From HOW (posture unchanged)
- [ ] Known-key findings remain `severity: "warn"`; no unknown key hard-fails `config check`.

**Integration smoke test.**

```
1. In a fixture repo whose .faffrc.yaml has `capture: { decision_kernel: "on" }` and no other faults:
   run `faff config check` → no `capture` known-key finding, exit 0.
2. Run config.js's `--selftest` (via the module selftest / `faff validate-adapters`)
   → the new drift guard and the new known-key case both PASS.
```

confidence: high
build-tier: complex
spec-review: approve

## Methodology critique

`Methodology: faffter-dark-methodology-agile-delivery`

Per-issue critique of **FAFF-965** ("`faff config check` false-warns on `capture`") against its spec, through four axes: right-sizing (P4), workstream fit (P1 + P5), surfaced deps (P6), risk profile (P7). Posture: surface-only — advisory, does not block promotion.

**Finding 1 — Right-sizing (Principle 4): contains a cleanly separable, value-first increment.** The spec bundles two structurally independent concerns: (A) the instance fix — a new `READ_ONLY_NAMESPACES` set + `RECOGNISED_NAMESPACES` union and repointing the two `knownKeyLint` call sites (a near-trivial edit that fully resolves the reported false-warn), and (B) the drift guard — a source-scanning `--selftest` (the larger, more involved half). (A) ships the observable user value on its own with zero dependence on (B). The combined scope still reads as a single 1–3 day unit, so a hard split is optional, not required — but sequence (A) before (B) inside the build so the fix isn't gated on the guard's heuristic bedding in.

**Finding 2 — Risk profile (Principle 7): low overall; the one novel surface is already de-risked in-spec.** The change lives entirely inside `config.js`'s config-check surface, keeps the lint warn-only, and touches no runtime read path. The only unproven element is the drift guard's regex-over-source heuristic — and the spec already contains it (blessed-identifier allowlist + explicit `exceptions` list; both error directions analysed as benign). No de-risking spike warranted.

**Finding 3 — Surfaced dependencies (Principle 6): clean — related-not-blocking is correct.** FAFF-794 and FAFF-949 are linked as related, not blockers; both are already delivered, so a blocker edge would be dishonest. The FAFF-949 coupling (a read added in one file, the allowlist in another not updated) is precisely the drift the guard exists to close — the related link doubles as the guard's rationale.

**Finding 4 — Workstream fit (Principles 1 + 5): cohesive single outcome; project-less Backlog is the correct home.** One outcome, with `OUT OF SCOPE` explicitly fencing off promotion to writable config, value-shape validation, and a schema registry. Leave it loose unless a standing config-check-correctness outcome project exists to home it.

**Overall.** Right-sized (one optional value-first split), low-risk with its single novel surface already contained, honestly linked, cohesively scoped. The lens's only actionable opinion is the sequencing nudge in Findings 1 + 2: ship the trivial namespace registration first, prove the source-scan guard second.
