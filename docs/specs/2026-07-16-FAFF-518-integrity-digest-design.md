# FAFF-518 — faff integrity-digest snapshot/verify: a custody-based tamper-detection CLI pair over the evidence set

> Spec: faffter-noon-spec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-518.

Turns FAFF-518's decided rule into a buildable change: a deterministic `faff integrity-digest snapshot|verify` CLI pair that a trusted dispatcher uses to hold a per-file digest manifest of the evidence set in its own conversation context across an untrusted dispatch, and detect tampering before the evidence is consumed.

## 1. WHY — Problem and Principles

**Load-bearing model.** Under single-session subscription economics the real read-only mount (FAFF-517) is deferred, but one mechanical boundary *does* exist in-session: subagent context isolation. A trusted dispatcher can hold a cryptographic digest of the evidence set in its own conversation context across an untrusted subagent dispatch — custody the subagent structurally cannot read or alter — and detect tampering before the evidence is consumed. **Custody replaces signatures**, which is exactly why this survives ADR-0039's signature rejection: signatures need an on-disk key a same-uid build lane can read; custody lives in a *context*, not the filesystem. **Detection-before-consumption gates as effectively as prevention** — the FAFF-354 recompute-and-compare detective precedent applied to the FAFF-278 forge surface.

**Problem statement.** The evidence set is defined in one place (`correctiveIntegrityDirs`, `corrective-integrity.js:157`): `run-ledger.json`, `corrective/`, per-issue `ac-checklist.json`/`review-verdict.json`/`holdout.json`, opt-in `events.jsonl`. Today nothing lets a dispatcher freeze that set and later prove it wasn't rewritten by the lane it dispatched. This ships that freeze/verify primitive.

**Design principles.**
- **Custody, never a key.** The digest is emitted to stdout for the caller to hold in context; nothing is ever written to an on-disk key, and no signatures are produced (ADR-0039).
- **Detective, not preventive.** verify recomputes and compares (FAFF-354 pattern); it never mutates the evidence, never blocks a write.
- **A distinct, honestly-labelled trust class.** The verdict introduces `digest-verified` — a trust class distinct from the mount-asserted `FAFF_INTEGRITY_BOUNDARY` basis. It **NEVER** feeds `FAFF_INTEGRITY_BOUNDARY` (that attests a kernel mount; conflating them is the lying-attestation failure ADR-0061 forbids).
- **Same-uid tool-poisoning mitigated, not eliminated.** Hashing invokes the absolute root-owned `/usr/bin/sha256sum` (never PATH resolution, never repo-local tooling) — mitigation, honestly labelled.

**Reference context.**

| System | Where | Relevance |
|---|---|---|
| Evidence-set definition | `corrective-integrity.js:157` `correctiveIntegrityDirs(runDir, issue, opts)` | The single source of the member set; snapshot/verify walk exactly this (never a second hand-written list). |
| Trust-gate bases | `corrective-integrity.js:96-137` `correctiveIntegrityProbe`/`integrityGate` | The mount-asserted basis vocabulary the new `digest-verified` class sits *beside*, never inside (this ticket). |
| spawnSync precedent | `post-merge.js:102`, `stage.js` | `spawnSync` with an absolute binary is the house pattern for shelling a tool deterministically. |
| CLI-seam test | `test/helpers/run-cli.mjs` + `*.test.mjs`; the `--selftest` + `RESULT: PASS` convention (`corrective-integrity.js`) | The standalone-CLI test shape this follows. |

**Scope statement.** A deterministic CLI pair + its `digest-verified` verdict vocabulary. It ships the primitive; the executor bracketing that *consumes* it is FAFF-520.

## 2. OUT OF SCOPE
- **Folding `verify` into `integrityGate` as a basis.** (open question 2) **Chosen:** deferred to the consumer FAFF-520 — this ticket ships the standalone CLI + verdict only, so the novel custody-detection risk lands first, cleanly (matching the jot intent "deterministic CLI first"). Extension point: `integrityGate` gains a `digest-verified` basis when 520 wires the executor bracket.
- **Anything touching `FAFF_INTEGRITY_BOUNDARY` or the mount-asserted basis semantics** — a hard boundary (ADR-0061); the digest class is separate by construction.
- **The real read-only mount** (FAFF-517, deferred) and the executor dispatch bracketing (FAFF-520, blocked-by this).
- **Byte-exact vs prefix events.jsonl semantics finalisation** — this ships prefix-preserving; FAFF-519's write-authority decision may later simplify to byte-exact (noted, not gated here).

## 3. WHAT — Vocabulary, Types, Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Manifest | The per-file digest map the caller holds in context: `{version, grain, members: [{path, sha256\|absent}]}`. |
| Custody | The manifest living in the trusted dispatcher's conversation context — unreadable/unwritable by the dispatched subagent. |
| `digest-verified` | The verify verdict when every member's recomputed digest matches the manifest (events.jsonl prefix-matches). Its own trust class, never `mount-asserted`. |

**The CLI surface.**

```
faff integrity-digest snapshot --run-dir DIR [--issue ID] [--events] [--json]
  # walks correctiveIntegrityDirs(DIR, issue, {events}); per member computes sha256 via
  # /usr/bin/sha256sum (absolute); emits the manifest JSON to stdout for the caller to hold.
faff integrity-digest verify --run-dir DIR [--issue ID] [--events] --manifest <json|-> [--json]
  # recomputes the same set, compares against the caller-supplied manifest, emits a verdict.
faff integrity-digest --selftest
```
- Exit: `0` printed (snapshot) / `0` `digest-verified` (verify) / `1` `tampered` (verify, naming the mismatched path(s)) / `2` bad input (unknown flag; missing `--run-dir`; `--issue`/`--events` semantics as the emitter; unreadable `--manifest`).

**Design decisions.**
- **Manifest format** (open question 1). **Chosen:** a **per-file digest map** (each member's `{path, sha256}`), NOT a rolled-up single digest — the AC requires verify to say *which* path mismatched, which a rolled digest cannot. Grain (per-run vs launch) is selected by the same `correctiveIntegrityDirs(runDir, issue, {events})` params the FAFF-514 emitter uses — one member-set resolver, reused.
- **A missing member is recorded, not skipped.** snapshot records `absent` for a member path that doesn't exist yet; verify flags a member that *appeared* (absent→present) or *disappeared* (present→absent) as tampering — a freeze must catch additions/deletions, not just content edits.
- **events.jsonl is prefix-preserving.** append-only by construction (`events.js`), so verify treats a member named `events.jsonl` as matching iff the on-disk bytes **start with** the snapshotted bytes (a legitimate append extends the prefix); a truncation or rewrite (not a prefix) → tampered. Every other member is byte-exact.
- **Hashing.** `spawnSync("/usr/bin/sha256sum", [absPath])`, absolute path only; a `sha256sum` spawn failure (binary absent) is fail-loud exit 2 (never a silent "verified").

## 4. HOW — Behaviour

```
PROCEDURE snapshot(runDir, issue, events):
  members := correctiveIntegrityDirs(runDir, issue, {events})   # the single resolver
  for each m in members: manifest.members.push({ path: rel(m), sha256: exists(m) ? sha256(m) : null })
  print JSON { version:"d1", grain: issue?"run-dir":"run-dir", members }   # to stdout, caller holds it

PROCEDURE verify(runDir, issue, events, manifest):
  cur := snapshot(runDir, issue, events).members    # recompute the same set
  diffs := []
  for each recorded in manifest.members:
     found := cur[recorded.path]
     if recorded.path endswith "events.jsonl":
        ok := found present AND on-disk-bytes startsWith snapshotted-bytes   # prefix-preserving (via stored length+prefix-digest, see below)
     else: ok := found.sha256 === recorded.sha256   # byte-exact; absent<->present is a mismatch
     if not ok: diffs.push(recorded.path)
  verdict := diffs.empty ? "digest-verified" : { "tampered", paths: diffs }
  exit diffs.empty ? 0 : 1
```

**events.jsonl prefix mechanic.** To verify a prefix without holding the whole file, snapshot records for `events.jsonl` its `{length, sha256_of_first_length_bytes}`; verify reads the current file's first `length` bytes and compares that digest (and asserts the current length ≥ recorded length). A shortened file (length <) or a changed prefix → tampered; a longer file with an unchanged prefix → verified.

**Trust-class boundary.** The verdict vocabulary is its own (`digest-verified` / `tampered`); nothing in this change reads or writes `FAFF_INTEGRITY_BOUNDARY`, calls `integrityGate`, or touches the mount-asserted basis. A grep-able invariant test asserts the module never references `FAFF_INTEGRITY_BOUNDARY`.

**Failure modes.**
- **Tool poisoning of a PATH `sha256sum`.** Mitigated by the absolute `/usr/bin/sha256sum`; a same-uid attacker replacing the root-owned binary is out of this control's reach (honestly labelled — mitigation, not elimination).
- **A legitimate append read as tampering.** The events.jsonl prefix rule prevents it; every other member is genuinely immutable across a dispatch (evidence writes, per FAFF-519's expected decision, sit above the dispatch cut).

**Anti-patterns.**
- Feeding a `digest-verified` verdict into `FAFF_INTEGRITY_BOUNDARY` or `integrityGate` here — the lying-attestation failure (ADR-0061); that wiring is FAFF-520's.
- A rolled-up single digest — loses the which-path AC.
- A second hand-written member list — always walk `correctiveIntegrityDirs`.

## 5. Scenarios
```
Given a snapshot manifest of a run dir's evidence set
When a member file (e.g. run-ledger.json) is edited, then `integrity-digest verify --manifest <that>`
Then exit 1, verdict tampered, naming run-ledger.json
```
```
Given a snapshot, then a legitimate APPEND to events.jsonl, then verify
Then exit 0 digest-verified (the append extends the recorded prefix)
```
```
Given a snapshot, then events.jsonl is TRUNCATED or its prefix rewritten, then verify
Then exit 1 tampered naming events.jsonl
```
```
Given a clean round-trip (snapshot then verify, no change)
Then exit 0 digest-verified — with no skill in the loop (standalone CLI seam)
```
- Hashing invokes `/usr/bin/sha256sum` by absolute path (asserted by the selftest's spawn arg).
- The module never references `FAFF_INTEGRITY_BOUNDARY` (grep-invariant test).

## 6. Design Decision Rationale
- **Per-file map vs rolled digest:** the which-path AC forces per-file. **Chosen:** per-file.
- **Fold into integrityGate now vs in 520:** folding now couples the novel primitive to the consumer's bracketing and risks a premature basis in the trust gate. **Chosen:** standalone CLI + verdict only; 520 wires the basis. Keeps the novel-risk slice clean and independently testable.
- **events.jsonl prefix vs byte-exact:** append-only by construction, so byte-exact would false-flag every legitimate append. **Chosen:** prefix-preserving (length + prefix-digest); FAFF-519 may later simplify to byte-exact if evidence writes are frozen above the cut.
- **Absolute sha256sum:** PATH resolution is same-uid poisonable. **Chosen:** `/usr/bin/sha256sum` absolute, fail-loud if absent.

## 7. Open Questions and Assumptions
**Open questions:** none — both ticket open questions closed as Chosen (§2, §3).
**Assumptions:**
- **Assumes:** `/usr/bin/sha256sum` exists on the run host (Linux standard). Validation: the selftest asserts the spawn arg is the absolute path; a missing binary is exit 2 fail-loud, never a silent pass.
- **Assumes:** evidence members other than `events.jsonl` are not legitimately rewritten across a dispatch (FAFF-519's write-authority decision confirms the freeze set). Validation: if 519 lands a different freeze set, verify's per-member rule is the one place to adjust.

## 8. DONE — Definition of Done
- [ ] `integrity-digest` registered (COMMANDS + REGION_MAP factory + REGION_SELFTEST_ARGV + one cli.md row; `lint-cli-doc`/`regions` clean).
- [ ] `snapshot` walks `correctiveIntegrityDirs`, emits the per-file manifest JSON; `verify --manifest` recomputes + compares, exit 0 `digest-verified` / 1 `tampered` naming the path(s).
- [ ] A tampered member (edit) → verify exit 1 naming it; a clean round-trip → exit 0.
- [ ] events.jsonl: a legitimate append → verified; a truncate/prefix-rewrite → tampered.
- [ ] Hashing via `/usr/bin/sha256sum` absolute path; a spawn failure is exit 2 fail-loud.
- [ ] The verdict vocabulary is its own trust class; the module never references `FAFF_INTEGRITY_BOUNDARY` and never calls `integrityGate` (grep-invariant + no-import test).
- [ ] `--selftest` (house convention) + `test/integrity-digest.test.mjs` (CLI seam via `runCli`) + a validate.yml selftest step.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
