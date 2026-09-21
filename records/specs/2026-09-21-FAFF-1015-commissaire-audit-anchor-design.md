# Commissaire-native run-close anchor mint (`commissaire audit anchor`)


> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1015.

This spec addresses FAFF-1015. It is written for the build agent that will implement the change and for the human reviewers who gate it. It defines a new `commissaire audit anchor` CLI action that lets an external consumer mint a per-issue anchor directory through the standalone `commissaire` facade alone — closing the one governance leg that still forces a call to the `faff` binary. (Revised 2026-09-13 after spec-review round 1: the default-`--dest` rationale is corrected, edge behaviours for `findRoot()`/`basename` are defined, and the born-verifiability of the DoD is tightened.)

## 1. WHY — Problem and Principles

**The load-bearing model.** The audit bundle a consumer seals with `commissaire audit seal` is built from an *anchor directory* — a byte-copied, chain-head-witnessed snapshot of a run's evidence (`events.jsonl`, `run-ledger.json`, chain-head witness, and any merge-floor / public-key files present). Today the only shipped way to mint that directory is the flight-recorder verb `faff events anchor` (per-issue) or `faff events anchor-run` (run-level). Both live under the `faff` bin, so the "every governance leg is served by the standalone `commissaire` binary" claim has exactly one hole: the anchor mint.

**Problem statement:** an external consumer that wants a sealed audit bundle must shell out to `faff` for the anchor leg, and `faff events anchor-run` is unusable to an unreviewed external run at all — its self-verify runs `governance-check`, whose merge-floor leg demands `ac-checklist.json` and `review-verdict.json` for a `shipped` issue, which the demo must not forge. This change adds a Commissaire-facing action that mints one per-issue anchor by dispatching into the *same shared core* the flight-recorder verbs use, without the `anchor-run` self-verify.

**Design principles:**

- **Reuse the one core, fork nothing.** The mint must call `mintIssueAnchor` (the shared byte-copy core in `events.js`) directly — never a second byte-copy, witness format, or floor-file list. This is the same composition rule FAFF-796 established when `anchor` and `anchor-run` were unified onto that core.
- **No self-verify, no merge-floor gate.** The whole point of the new action is to mint *without* the `governance-check` self-verify that `anchor-run` runs, because an external consumer legitimately has no `ac-checklist.json` / `review-verdict.json` and must not forge them. The mint carries whatever floor files happen to be present (best-effort, as `mintIssueAnchor` already does) and asserts nothing about them.
- **Region direction stays factory → governance.** `commissaire.js` is region `factory`; `events.js` is region `governance`. Factory requiring governance is the allowed direction, and `commissaire.js` already `require("./events")`. The mint must reuse that existing edge, so `faff regions check` and the `require-graph` test stay green with no new dependency.
- **This action mints ONE per-issue anchor subdir — it is not a run-close bundle builder.** A single invocation produces `<dest>/{events.jsonl, run-ledger.json, chain-head.json, …}` for one issue. Whether that subdir is later assembled (with sibling issue subdirs and a `summary.md`) into a sealable run-close anchor tree is the *consumer's* job and `audit seal`'s job — out of scope here (see §2). This action asserts nothing about seal composition.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` — `mintIssueAnchor` | Node (CJS) | The shared per-issue anchor mint core this action dispatches into; already exported. Returns `{ ok, head, copiedFloorFiles, effectsAnchored }` or `{ ok:false, code, message }`. |
| `plugin/skills/faff/bin/lib/events.js` — `computeChainHead` | Node (CJS) | Produces the `head` object: `{ head_seq, head_sha256, line_count, schema_floor }` (verified in `events.js`). |
| `plugin/skills/faff/bin/lib/events.js` — `events anchor` CLI | Node (CJS) | The per-issue mint call site whose `--issue` shape guard and exit-code mapping this action mirrors. |
| `plugin/skills/faff/bin/lib/commissaire.js` — ADR-0123 dispatch | Node (CJS) | Where the new `audit anchor` canonical key, required-flags, and usage line are registered. |
| `plugin/skills/faff/bin/lib/commissaire.js` — `cmdAuditVerify` | Node (CJS) | The model for a thin `audit`-namespace subcommand with JSON stdout + a clean exit contract. |
| `plugin/skills/faff/bin/lib/bundle-seal-core.js` — `readAnchorDir` | Node (CJS) | The eventual consumer of the *assembled* anchor tree; for a run-close bundle it reads the ROOT `<root>/.faff/anchors/<run_id>/` (summary.md + every per-issue subdir), which is why a single mint is only one subdir of that tree. |
| `test/commissaire.test.mjs` — `require-graph` test | Node (test) | Must keep passing; its allowlist already includes `./events`. |

**Scope statement:** this sits in the Commissaire external-facade surface (ADR-0123 object-verb grammar), extending the `audit` object namespace that already carries `seal` / `export` / `verify`.

## 2. OUT OF SCOPE

- **A run-level `audit anchor-run` equivalent.** — Why excluded: this ticket closes the per-issue leg the FAFF-360 demo needs; the run-level sibling carries the self-verify semantics an external consumer specifically cannot satisfy. — Extension point: a future `commissaire audit anchor-run` canonical key in `COMMISSAIRE_DISPATCH`, dispatching a loop over `mintIssueAnchor` with an explicitly *optional* verify.
- **`audit seal` reading / composing the minted anchor.** — Why excluded: assembling per-issue subdirs (+ `summary.md`) into a sealable run-close tree and reading it is `audit seal`'s / the consumer's concern (`readAnchorDir` reads the whole `<run_id>/` root). This action only writes one subdir. — Extension point: FAFF-360's demo spec drives the mint→assemble→seal flow. **No DONE item or scenario here asserts seal consumption.**
- **Porting the FAFF-958 ledger-fold drift precondition.** — Why excluded: `events anchor`'s drift refusal reads via the unexported `eventsLedgerFold`, so porting it would touch `events.js`, and it presumes a faff-written ledger-write chain the external consumer's run may not have. — Extension point: if drift-detection is later wanted here, export `eventsLedgerFold` from `events.js` and gate before the `mintIssueAnchor` call, mirroring the `events anchor` block.
- **Changing `mintIssueAnchor` itself, or the anchor byte format.** — Why excluded: the core is already correct and shared; this action only adds a caller. — Extension point: `mintIssueAnchor` in `events.js` if the anchor contents ever change (a cross-cutting change affecting all three callers).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Per-issue anchor subdir | What one `audit anchor` invocation writes: byte-copied `events.jsonl` + `run-ledger.json` (+ optional effects ledger/witness, merge-floor files, public key) plus a CLI-computed `chain-head.json` witness, for a single issue. |
| Run-close anchor tree | The tree a `run-close` bundle seals from: `<root>/.faff/anchors/<run_id>/` containing `summary.md` + one per-issue subdir. **Assembled from many per-issue subdirs; this action mints one of them.** |
| Self-verify | The `anchor-run` step that spawns `governance-check` over each minted subdir; deliberately **not** run by this action. |
| Valid `events.jsonl` record | One JSON object per physical line carrying at least `run_id`, `seq`, `ts`, `phase`, `type` (the envelope `faff events append` writes / `events --selftest` accepts); `mintIssueAnchor` requires `events.jsonl` to exist and be non-empty, never a specific schema. |

**CLI surface:**

```
commissaire audit anchor --run-dir DIR --issue ISSUE [--dest DIR] [--root R]
```

- `--run-dir DIR` — required. The source run directory to snapshot. Must be an existing directory (`requireRunDir` gate).
- `--issue ISSUE` — required. The per-issue subdir to mint. Validated against the bare-issue-id token shape (below) before any read, so a malformed value cannot walk the read path outside `--run-dir`.
- `--dest DIR` — optional. The anchor subdir to write. When omitted it defaults to the conventional per-issue placement under the run anchor root (below).
- `--root R` — optional. Repo root used **only** to resolve the default `--dest`; ignored when `--dest` is explicit. When absent, `findRoot()` resolves it.

All four flags already exist in `COMMISSAIRE_SPEC.flags` and the `parseCommissaireArgs` `single` set — no new flag plumbing is required.

**Default `--dest` (conventional placement, not a composition guarantee).** When `--dest` is omitted, the anchor is written to `<root>/.faff/anchors/<basename(--run-dir)>/<issue>` — the conventional slot a per-issue subdir occupies *within* a run-close anchor tree, and the exact path FAFF-360 mints to by hand. It is a convenience default, **not** an assertion that a single mint yields a sealable tree (that needs every issue's subdir + `summary.md`; see §2). Two guards make the default safe:

- **No resolvable root** — `--dest` omitted, `--root` omitted, and `findRoot()` returns null/no root (the external consumer outside any repo — the exact FAFF-828 cohort): exit `2` with a diagnostic instructing the consumer to pass `--dest` explicitly. Never crash on an unhandled `findRoot()` result.
- **Unsafe run-id segment** — if `basename(--run-dir)` is not a safe path segment (`.`, `..`, empty, or contains a separator), the default would escape `.faff/anchors/`: exit `2` with the same "pass `--dest`" diagnostic. An explicit `--dest` bypasses both guards and is used verbatim.

**`--issue` token shape (mirrors `events anchor`, defence-in-depth):**

```
VALID_ISSUE := /^[A-Za-z0-9][A-Za-z0-9._-]*$/  AND  not containing ".."
```

**Output (JSON to stdout, one line — consistent with `audit verify` / `seal` / `export`):**

```
RECORD AuditAnchorOutput:
  minted: Boolean                 # true on success
  issue: String                   # the --issue value
  dest: String                    # the resolved anchor subdir
  head: { head_seq, head_sha256, line_count, schema_floor }   # the object computeChainHead returns (verified shape)
  copied_floor_files: Array<String>   # mintIssueAnchor's copiedFloorFiles (may be empty)
  effects_anchored: Boolean       # mintIssueAnchor's effectsAnchored
```

**Design decisions:**

- Whether to port the FAFF-958 ledger-fold drift precondition. **Chosen:** do **not** port it — dispatch straight into `mintIssueAnchor` after argument-shape validation only, matching the ticket's RCA ("dispatching into `mintIssueAnchor` (without the `anchor-run` self-verify)") and keeping `events.js` untouched.
- The default `--dest`. **Chosen:** keep an optional default of `<root>/.faff/anchors/<basename(--run-dir)>/<issue>` (the FAFF-360-consistent conventional placement) with the two safety guards above, rather than requiring `--dest`. Rationale: the ticket brackets `--dest` optional and the FAFF-360 workaround wants the no-`--dest` ergonomics; the guards remove the `findRoot()`-null and `basename('..')` edge cases the round-1 review surfaced, and the corrected framing drops the false "mint→seal composes with no `--dest`" claim.
- Output shape. **Chosen:** emit one line of JSON (`AuditAnchorOutput`), consistent with the machine-facing `audit verify` / `seal` / `export` verbs.

## 4. HOW — Behavior

**Architecture and approach.** Add one handler `cmdAuditAnchor(flags)` to `commissaire.js`, register it under the canonical key `"audit anchor"`, and dispatch it into `mintIssueAnchor`. Import `mintIssueAnchor` by adding it to the *existing* `const { … } = require("./events")` destructure at the top of `commissaire.js` — no new require edge.

```
PROCEDURE cmdAuditAnchor(flags):
  1. runDir := requireRunDir(flags, "audit anchor")      # missing → stderr + return 3; not-a-dir → return 3
     IF runDir is null: return 3
  2. issue := flags["--issue"]
     IF issue absent: stderr "audit anchor: --issue <id> is required"; return 2
     IF issue does not match VALID_ISSUE (or contains ".."):
        stderr "audit anchor: --issue <value> is not a valid issue id"; return 2
  3. dest := flags["--dest"]
     IF dest absent:
        root := flags["--root"] OR findRoot()
        IF root is null/empty:                            # external consumer outside any repo
           stderr "audit anchor: cannot resolve a repo root for the default --dest; pass --dest explicitly"; return 2
        seg := basename(runDir)
        IF seg is one of {"", ".", ".."} OR seg contains a path separator:
           stderr "audit anchor: --run-dir basename is not a safe path segment; pass --dest explicitly"; return 2
        dest := join(root, ".faff", "anchors", seg, issue)
  4. result := mintIssueAnchor(runDir, issue, dest)
  5. IF NOT result.ok:
        stderr "audit anchor: " + result.message
        return (result.code == "no-events") ? 3 : 2      # dest-mkdir / pk-unreadable / pk-secret-material → 2
  6. print JSON.stringify({ minted:true, issue, dest, head:result.head,
                            copied_floor_files:result.copiedFloorFiles, effects_anchored:result.effectsAnchored })
  7. return 0
```

**Registration (single-source tables + usage):**

```
PROCEDURE register:
  a. COMMISSAIRE_DISPATCH["audit anchor"] := (flags) => cmdAuditAnchor(flags)
  b. REQUIRED_FLAGS_BY_CANONICAL["audit anchor"] := ["--run-dir", "--issue"]
  c. usage(): add the "audit anchor  --run-dir DIR --issue I [--dest DIR] [--root R]" line
  d. NO COMMISSAIRE_ALIASES entry — this is a new verb with no legacy flat spelling
```

`buildCommissaireSubcommands()` derives `COMMISSAIRE_SURFACE.subcommands` from `REQUIRED_FLAGS_BY_CANONICAL`, so step (b) is the single source that also feeds required-flag validation — no separate surface edit.

**Behavior summary.** Validate arguments, resolve a safe default destination (or refuse with a clear diagnostic), byte-copy the run's evidence into the anchor subdir via `mintIssueAnchor` with a freshly-computed chain-head witness, and report the result as JSON. No signing, no verification, no merge-floor assertion.

**Edge cases and error handling:**

- **Missing/non-directory `--run-dir`** → `3` via `requireRunDir` (the `audit`-namespace convention, matching `cmdSealBundle`/`cmdAuditExport`).
- **Missing or malformed `--issue`** → `2`, diagnostic to stderr, nothing written.
- **Default `--dest` with no resolvable root** → `2`, "pass `--dest`" diagnostic, nothing written.
- **Default `--dest` with an unsafe `--run-dir` basename** (`.`/`..`/empty/separator) → `2`, "pass `--dest`" diagnostic, nothing written.
- **`no-events`** (no `events.jsonl` in the run dir) → `3`, mirroring `events anchor`.
- **`dest-mkdir` failure, `pk-unreadable`, `pk-secret-material`** → `2` (a loud mint failure); `mintIssueAnchor`'s message is surfaced. The `pk-secret-material` refusal is the core's fail-closed guard: it fires when `commissaire/producer/pk.json` carries any field beyond exactly `{ pk, pk_fingerprint }`.
- **Floor files absent** (external consumer with no `ac-checklist.json` / `review-verdict.json`) → success; `copied_floor_files` is `[]`. This is the deliberate difference from `anchor-run`.

**Anti-pattern:** running `governance-check` (or any self-verify) over the minted dir. Why: it re-introduces the merge-floor requirement this action exists to avoid, breaking the external-consumer case.

**Anti-pattern:** re-implementing the byte-copy or chain-head witness inside `commissaire.js`. Why: it forks the anchor format away from `events anchor` / `anchor-run`; the mint must be `mintIssueAnchor` verbatim.

**Anti-pattern:** adding a second `require()` of a non-governance module to reach the core. Why: `commissaire.js` already imports `./events`; adding `mintIssueAnchor` to that destructure keeps the require-graph allowlist satisfied. A new edge to a factory/skill module would fail `faff regions check` and the require-graph test.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir with a valid events.jsonl + run-ledger.json but NO ac-checklist.json / review-verdict.json
When `commissaire audit anchor --run-dir DIR --issue FAFF-1 --dest OUT` is run
Then it exits 0, OUT/chain-head.json exists, OUT/events.jsonl is a byte-for-byte copy of the source events.jsonl, OUT contains no ac-checklist.json / review-verdict.json, and stdout parses as AuditAnchorOutput with minted:true
```

```
Given a run dir at <root>/.faff/runs/RUN-X and no --dest flag, with --root <root>
When `commissaire audit anchor --run-dir <root>/.faff/runs/RUN-X --issue FAFF-1 --root <root>` is run
Then the anchor subdir is written to exactly <root>/.faff/anchors/RUN-X/FAFF-1/ (chain-head.json + events.jsonl present) — asserting the write LOCATION only, not that any seal reads it
```

```
Given no --dest and no --root, invoked with a --run-dir outside any git/faff repo (findRoot resolves nothing)
When `commissaire audit anchor --run-dir /tmp/isolated-run --issue FAFF-1` is run
Then it exits 2 with a diagnostic telling the consumer to pass --dest, and writes nothing
```

```
Given a run dir with no --dest and no --root but invoked from within a repo
When `commissaire audit anchor --run-dir <repo>/.faff/runs/RUN-X --issue FAFF-1` is run
Then findRoot() resolves the repo root and the anchor is written under <repo>/.faff/anchors/RUN-X/FAFF-1/ (the findRoot leg is exercised without an explicit --root)
```

```
Given `--issue "../escape"`
When `commissaire audit anchor --run-dir DIR --issue "../escape"` is run
Then it exits 2 with an invalid-issue-id diagnostic and writes nothing
```

```
Given a run dir with no events.jsonl
When `commissaire audit anchor --run-dir DIR --issue FAFF-1 --dest OUT` is run
Then it exits 3 (no-events) with mintIssueAnchor's "nothing to anchor" message surfaced
```

```
Given a run dir whose commissaire/producer/pk.json carries a field beyond { pk, pk_fingerprint }
When `commissaire audit anchor --run-dir DIR --issue FAFF-1 --dest OUT` is run
Then it exits 2, mintIssueAnchor's pk-secret-material refusal message is surfaced, and no anchor is committed
```

- `commissaire --selftest` exits 0 and its coverage includes an `audit anchor` mint round-trip (a seeded run dir mints an anchor subdir, chain-head.json present, exit 0; and a shipped-issue-no-floor-files mint still exits 0).
- The `commissaire.js` require-graph stays clean: `test/commissaire.test.mjs` `require-graph` test passes unchanged (the only local requires remain the governance cores + `shared-infra` + `bundle-seal-core`, all in its allowlist).

## 5. DESIGN DECISION RATIONALE

**Should the action port the FAFF-958 ledger-fold drift precondition?**
- Port it: detects an unrecorded ledger rewrite; but requires exporting `eventsLedgerFold` (touching `events.js`) and presumes a faff-written `ledger-write` chain an external run may lack.
- **Chosen:** skip it — dispatch straight into `mintIssueAnchor` after argument-shape validation only. Revisit if drift-detection is later required (see §2 extension point).

**Default `--dest`: keep an optional default, or require it?**
- Require it (round-1 architectural suggestion): eliminates `findRoot`/`basename` edges outright, but loses the FAFF-360 no-`--dest` ergonomics and the ticket brackets `--dest` optional.
- **Chosen:** keep the optional default `<root>/.faff/anchors/<basename(run-dir)>/<issue>` **with** the no-resolvable-root and unsafe-basename guards (both → exit 2, "pass `--dest`"), and reframe it honestly as a conventional per-issue placement rather than a seal-composition guarantee. This keeps the ergonomics, closes the round-1 edge-case objections, and drops the false composition claim.

**JSON stdout vs a human console line?**
- **Chosen:** one line of JSON (`AuditAnchorOutput`), consistent with the machine-facing `audit` verbs.

**No alias.** `audit anchor` is a new capability with no FAFF-828 flat spelling, so it gets no `COMMISSAIRE_ALIASES` entry (unlike `seal-bundle` → `audit seal`).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** `mintIssueAnchor` is exported from `events.js`, and `commissaire.js` already `require("./events")`. Validate: `grep -n "mintIssueAnchor" plugin/skills/faff/bin/lib/events.js` shows it in `module.exports`; `commissaire.js` line ~42 destructures from `require("./events")`. (Verified during explore.)
- **Assumes:** `mintIssueAnchor` returns `{ ok:true, head, copiedFloorFiles, effectsAnchored }` on success (with `head` = `{ head_seq, head_sha256, line_count, schema_floor }` from `computeChainHead`) and `{ ok:false, code, message }` on failure, where `code ∈ {"no-events","dest-mkdir","pk-unreadable","pk-secret-material"}`. Validate: read `mintIssueAnchor` and `computeChainHead` in `events.js`. (Verified during explore — the `head` object carries `schema_floor`.)
- **Assumes:** `findRoot` is importable in `commissaire.js`. Validate: it already `require("./shared-infra")` for `ENTRYPOINT, findRoot`. (Verified during explore.)
- **Assumes:** a "valid `events.jsonl` record" for the smoke fixture is one JSON-per-line envelope carrying `run_id`, `seq`, `ts`, `phase`, `type` (per `faff events --selftest`); `mintIssueAnchor` only requires the file to exist and be non-empty. Validate: `events --selftest` cases.

## 7. DONE — Definition of Done

### From WHY
- [ ] An external consumer can mint a per-issue anchor subdir via `commissaire audit anchor` without invoking the `faff` binary.
- [ ] Born-verifiable proxy for "no self-verify": a shipped issue whose run dir lacks `ac-checklist.json` / `review-verdict.json` mints exit 0 (a case `faff events anchor-run` rejects).
- [ ] (Code-review-verified, not born-verifiable) The handler contains no `governance-check` spawn / self-verify call and makes no merge-floor assertion.

### From WHAT (interfaces)
- [ ] `commissaire audit anchor --run-dir DIR --issue ISSUE [--dest DIR] [--root R]` is accepted; `--run-dir` and `--issue` are required.
- [ ] `--issue` is rejected (exit 2) when it fails `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` or contains `..`.
- [ ] On success, one line of JSON matching `AuditAnchorOutput` (`minted`, `issue`, `dest`, `head`, `copied_floor_files`, `effects_anchored`) is printed to stdout; `head` carries `head_seq`, `head_sha256`, `line_count`, `schema_floor`.

### From WHAT (default dest)
- [ ] With no `--dest` and a resolvable root, the anchor is written to `<root>/.faff/anchors/<basename(run-dir)>/<issue>` (root from `--root`, else `findRoot()`).
- [ ] With no `--dest` and no resolvable root → exit 2 with a "pass `--dest`" diagnostic; nothing written.
- [ ] With no `--dest` and an unsafe `--run-dir` basename (`.`/`..`/empty/separator) → exit 2 with a "pass `--dest`" diagnostic; nothing written.
- [ ] An explicit `--dest` is used verbatim (bypasses both guards).

### From HOW (behaviour)
- [ ] The handler calls `mintIssueAnchor` (imported via the existing `require("./events")` destructure). (Code-review-verified: no forked byte-copy or witness.)
- [ ] `"audit anchor"` is registered in `COMMISSAIRE_DISPATCH` and `REQUIRED_FLAGS_BY_CANONICAL` (`["--run-dir","--issue"]`); `usage()` lists it; no `COMMISSAIRE_ALIASES` entry is added.

### From HOW (edge cases)
- [ ] Missing/non-directory `--run-dir` → exit 3 via `requireRunDir`.
- [ ] `no-events` → exit 3 with the core's message surfaced.
- [ ] `dest-mkdir` / `pk-unreadable` / `pk-secret-material` → exit 2 with the core's message surfaced; the `pk-secret-material` fixture is a `commissaire/producer/pk.json` carrying a field beyond `{ pk, pk_fingerprint }`.
- [ ] A shipped issue with no merge-floor files still mints (exit 0).

### From regions/tests
- [ ] `faff regions check` passes (no new require edge; factory→governance only).
- [ ] `test/commissaire.test.mjs` `require-graph` test passes unchanged.
- [ ] `commissaire --selftest` exits 0 and covers an `audit anchor` mint round-trip (seeded run dir mints; shipped-issue-no-floor mint exits 0).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Seed a temp run dir: events.jsonl with >=1 valid envelope record (run_id, seq, ts, phase, type) + run-ledger.json.
  2. Run `commissaire audit anchor --run-dir TMP --issue FAFF-1 --dest OUT`.
  3. Assert exit 0; OUT/chain-head.json and OUT/events.jsonl exist; stdout parses as AuditAnchorOutput with minted:true and head.schema_floor present.
```

confidence: high
