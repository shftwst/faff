# ADR 0109 — Tamper-evident committed audit stays PR-only for tracker-backed runs; git-only mode mints a run-summary anchor

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-13
- **Issue:** FAFF-720

## Context

faff's committed, tamper-evident audit is minted only at the PR boundary: `faff events anchor`
runs at faff-graft Step 9b after review passes and a PR opens, byte-copying `events.jsonl` +
`run-ledger.json` + per-issue floor files + a CLI-computed `chain-head.json` witness into
`.faff/anchors/<run>/<issue>/`, re-verified by `governance-check`'s `evaluateAnchorDir` (integrity +
merge_floor legs) from a PR's changed paths (ADR 0077 established the evidence-class write-authority
roster this anchor draws from). A run whose issues park / error / route-out / supersede opens no PR,
so it mints no anchor. Its only record is the tracker (durable, human-legible, not tamper-evident,
not in git history) and the gitignored, ephemeral run-dir. FAFF-596 proposed closing this with an
evidence branch and was deduped into FAFF-623 (the per-PR anchor mechanism), leaving the no-PR case
unresolved. This ticket reopens FAFF-596's question with the sharper "audit stops at the PR
boundary" framing and settles it: does a non-PR run get a committed run-level anchor, and if so,
what shape?

Two readings of "what tamper-evidence is for" are both internally consistent with faff's principles:
binding review evidence to *merged code* (what FAFF-568/623 do — a non-shipping run has no code to
bind, so PR-only is coherent by design) versus making every run's *decisions* non-repudiable (every
run needs an anchor regardless of outcome). Git-only mode (ADR 0075) sharpens the stakes: it has no
tracker fallback at all, so a park/error there leaves zero durable record anywhere — the case the
gap actually bites, independent of which reading wins for the tracker-backed case.

## Decision

**Mode-conditional, not a single uniform shape.** Tamper-evident committed audit stays **PR-only, by
design, for tracker-backed runs**: the tracker record (park label + reason comment + the hard-floor
`summary.md`) plus `faff disposition`'s non-zero exit constitutes the audit record for a run that
opened no PR, and no anchor is minted. Rationale: tamper-evidence binds review evidence to *merged
code* — a non-shipping tracker-backed run has no code for the anchor's claim to bind, so an anchor
would protect a claim that doesn't exist. This affirms FAFF-568/623's binding model rather than
extending it to activity that never merged.

**Git-only mode is the opposite case and is addressed explicitly and unconditionally**: because no
tracker fallback exists there, a park/error would otherwise leave zero durable record anywhere. A
**committed run-level anchor is minted for every git-only run**, regardless of outcome.

**Git-only anchor shape — shape 2 (run-summary commit), not shape 1 (evidence branch).** The
git-only run-level anchor is a single run-summary commit taken at run-close, reusing the existing
`.faff/anchors/<run>/` discovery path rather than a new orphan/side branch — lower machinery, no new
branch object, no new discovery mechanism to teach `governance-check`. This closes FAFF-720's second
Punt as moot: the evidence-branch retention/pruning policy only bites under shape 1, which was not
chosen.

Everything downstream, already settled in the spec and unaffected by which mode applies:

- **Commit moment** — the run-close orchestrator-exit edit (the `owner.status:"done"` + `stop_reason`
  write), the only point that exists on every exit path.
- **Evidence subset** — `run-ledger.json` / `events.jsonl` / `summary.md` byte-copies, per-issue
  `review-verdict.json` / `ac-checklist.json` where present, and a CLI-computed `chain-head.json`
  witness. Never the raw run-dir (FAFF-519) — the same evidence-class roster ADR 0077 already
  established; this decision creates no new write-authority class.
- **Granularity** — per-run, keyed by `run_id`, per-issue subdirs inside — mirroring `faff
  disposition`'s existing run-granularity classification.
- **`governance-check` for a git-only run-level anchor** verifies the same two legs
  `evaluateAnchorDir` already runs for the per-PR anchor — `integrity` (re-hash via `verifyChain`)
  and `merge_floor` (re-validate the per-issue floor files) — with completeness/budget/liveness n/a,
  exactly as today. The one new mechanism is extending `deriveAnchorDirs` discovery beyond a PR's
  changed paths to also enumerate the git-only run-level anchor tree under `.faff/anchors/<run>/`,
  reusing one verifier core rather than forking a second hash-walk (FAFF-621's composition rule).
- **Gitignore carve-out** — shape 2 reuses `.faff/anchors/`, which already carries the `!` negation
  line and selftest; no new carve-out is required.

This decision reopens FAFF-596 (Evidence-branch/artifact convention) and supersedes its shape-1
(evidence-branch) proposal for the case FAFF-596 was actually reasoning about — FAFF-596 was
deduped into FAFF-623 without a final ruling on the no-PR case; this ADR is that ruling, and it
picks shape 2 over FAFF-596's shape 1. FAFF-623 itself (the per-PR anchor mechanism) is unchanged —
the git-only run-level anchor is an additive sibling built on FAFF-623's `deriveAnchorDirs`/
`evaluateAnchorDir` machinery, not a replacement for it.

## Consequences

- A tracker-backed run that parks, errors, routes-out, or supersedes without opening a PR mints **no**
  committed anchor. Its audit trail is the tracker (status + `faff-parked`/park comment + delivery
  outcome) plus `faff disposition`'s non-zero exit — durable and human-legible, but not tamper-evident
  and not in git history. This is the deliberate, recorded governance position, not an unaddressed gap.
- A git-only run mints a committed run-level anchor at run-close on **every** outcome (fully-shipped,
  partially-parked, or all-parked) — the follow-on build must wire the emitter at the single
  orchestrator-exit edit so no exit branch is missed; minting from only some exit paths would
  reintroduce the exact PR-boundary ambiguity this ADR closes.
- `governance-check`'s `deriveAnchorDirs` must grow a second discovery source (the git-only anchor
  tree) alongside its existing PR-changed-paths source; both route through the same
  `evaluateAnchorDir` core.
- The evidence-branch shape (FAFF-596's original proposal, and this spec's shape 1) is rejected for
  now. If a future need reopens the retention/pruning question, it is a fresh Punt, not inherited
  from this record — this ADR does not need to answer it because shape 1 was not chosen.
- **Follow-on build issue filed: FAFF-796** (Backlog, `blockedBy` → FAFF-623): implement the git-only
  emitter (byte-copy the evidence subset + CLI-computed `chain-head.json` witness, commit at
  run-close) + the `governance-check` `deriveAnchorDirs` discovery extension for the git-only anchor
  tree + the gitignore carve-out. FAFF-623 is the blocker because the extension builds directly on
  its `deriveAnchorDirs`/`evaluateAnchorDir` machinery. On the carve-out specifically: this ADR
  already decided shape 2 reuses `.faff/anchors/`'s existing `!` negation line, so FAFF-796's
  carve-out item is a verify-only check (confirm no new committed path escapes the existing
  ignore/selftest), not new gitignore surface — named explicitly in scope so the spec's DONE
  checklist item ("emitter + governance-check leg + gitignore carve-out") is traceable to a concrete
  ticket line rather than silently dropped.
- Tracker-backed mode's PR-only position and git-only mode's unconditional-anchor position are two
  halves of one decision — a future change to either (e.g., deciding tracker-backed runs also need
  a committed record) should re-examine both together, since the rationale ("bind evidence to merged
  code") is what ties them.

confidence: high
