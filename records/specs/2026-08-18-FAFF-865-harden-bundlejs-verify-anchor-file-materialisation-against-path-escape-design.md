# Harden bundle.js verify anchor-file materialisation against path escape

> Spec: faffter-dark-nlspec · 2026-08-18 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-865.

This spec covers FAFF-865, a low-severity, single-concern defence-in-depth hardening of `bundle.js`'s verify path. It is written for the build agent implementing the fix and the human reviewers gating it. The change is small: relocate an existing path-safety guard to a shared leaf module and apply it at a second, currently-unguarded materialisation site — no new runnable surface, no architecture proposal.

## 1. WHY — Problem and Principles

**The load-bearing model.** Recovery bundles carry an `anchors` member whose `files` map is `{ relative-path → base64-bytes }`. Both the recover path (persistent) and the verify path (throwaway) reconstruct real files by joining each key onto a base directory with `path.join(baseDir, rel)`. `path.join` does not contain: a key of `../escape` or `/etc/thing` resolves *outside* the base directory. A forged bundle can therefore steer a write outside the intended tree. FAFF-820 already closed this on the persistent recover write with `isSafeAnchorRelPath`; the verify path has the identical `path.join`-over-keys loop with no such guard.

**Problem statement.** `bundle.js`'s `classifyBundle()` materialises `parsed.anchors.files` into a scratch temp dir via unguarded `path.join(anchorTmp, rel)`, so a hand-forged bundle with an escaping key can write outside that temp dir transiently. This ticket applies the same `..`/absolute-key rejection FAFF-820 added — before any file is written — so the verify path matches the recover path's containment posture. Severity is low because the write lands in a discarded temp dir and sits inside FAFF-819's CLEAN trust model (push access to `refs/faff/bundles/*` is already trusted; a CLEAN verdict carries no external signature), and `mintIssueAnchor` only ever emits flat known filenames.

**Design principles.**

**Single guard, one home.** The rejection logic must exist in exactly one place. `bundle-recover.js` already imports `bundle.js`, so `bundle.js` importing `bundle-recover.js` to reuse the guard would create a circular dependency (see Design Decision Rationale). Reuse is achieved by relocating the guard to a shared leaf module both already import, not by copying it or cross-importing.

**Validate-all-before-write-any.** Every key is checked before *any* file is written, mirroring `reconstructProjection`'s ordering. A bad key partway through the map must never leave an escaped write already on disk. In the verify path this means rejecting during pre-materialisation validation, before the `withTempDir` block runs.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/bundle.js` | Node.js | Verify path; `classifyBundle()` holds the unguarded materialisation (~L292–313) |
| `plugin/skills/faff/bin/lib/bundle-recover.js` | Node.js | Source of the guard `isSafeAnchorRelPath` (L282–285), exported (L903), used by `reconstructProjection` (L306–310) |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node.js | Leaf module (no internal `require("./…")`); already imported by both files; already requires `node:path` (L14) — the relocation home |
| `test/bundle.test.mjs` | Node.js | `bundle verify` verdict-ladder tests; imports `classifyBundle` |
| `test/bundle-recover.test.mjs` | Node.js | Imports both modules (not the guard symbol today); reconstructProjection additive-copy tests |

**Scope statement.** This is a leaf hardening inside the FAFF-819/820 recovery-bundle verify+recover subsystem — it changes where one guard lives and adds one call site; it does not touch the verdict ladder's semantics for well-formed bundles.

## 2. OUT OF SCOPE

- **Signing / authenticating CLEAN bundles** — Why excluded: FAFF-819's trust model explicitly treats push access as the trust boundary; adding signatures is a separate trust-model change. Extension point: FAFF-819's CLEAN verdict computation in `contract-defs.js` (`computeBundleVerdict`).
- **Symlink / hardlink escape via anchor contents** — Why excluded: the materialisation writes file *bytes* at computed paths; it does not follow or create links. A link-based escape is a distinct threat. Extension point: the materialisation loop in `classifyBundle()` and `reconstructProjection()`.
- **Byte-content validation of anchor files** — Why excluded: this ticket guards the *path*, not the payload; content integrity is already covered by the digest recompute (L279–289). Extension point: the tamper-primitive block in `classifyBundle()`.
- **Re-guarding other `path.join`-over-untrusted-keys sites elsewhere in the codebase** — Why excluded: FAFF-865 is scoped to the `bundle.js` verify site called out by the FAFF-820 review. Extension point: a future audit ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Anchor files map | `parsed.anchors.files`: object of `{ relPath: base64String }` carried in a bundle's `anchors` member |
| Safe rel-path | A non-empty, non-absolute string with no `..` path segment — the only keys allowed to be joined onto a base dir |
| Verify path | `classifyBundle()` in `bundle.js`, which materialises anchor files into a throwaway temp dir to run tamper primitives |
| Leaf module | A `lib/` module with no internal `require("./…")` dependencies (e.g. `shared-infra.js`) — safe to import from anywhere without cycle risk |

**The guard (relocated, unchanged behaviour).**

```
FUNCTION isSafeAnchorRelPath(rel) -> Boolean:
  # true iff rel is a non-empty, non-absolute string with no ".." segment
  IF type(rel) != string OR rel == "" OR isAbsolute(rel): RETURN false
  RETURN NOT any(segment == ".." for segment in rel.split("/"))
```

Behaviour is byte-for-byte the current `bundle-recover.js` L282–285 implementation. Only its *home* changes.

**Interfaces touched.**

- `shared-infra.js` module exports — **gains** `isSafeAnchorRelPath` (new export from its `module.exports` object, L661).
- `bundle-recover.js` module exports — **retains** `isSafeAnchorRelPath` in its `module.exports` (L900–903) by re-exporting the relocated symbol, so any current/future consumer of `bundle-recover.js`'s export surface is unaffected.
- `bundle.js` imports — **gains** `isSafeAnchorRelPath` in its existing `require("./shared-infra")` destructure (L24).

**Design decision — where the guard lives.**

**Chosen:** Relocate `isSafeAnchorRelPath` into `shared-infra.js` (a leaf module already imported by both `bundle.js` and `bundle-recover.js`, and already requiring `node:path`); re-export it from `bundle-recover.js` to preserve that module's public surface. Rationale and rejected alternatives in Design Decision Rationale below. `(decides: architecture)`

## 4. HOW — Behavior

**Approach.** Three edits, no behavioural change for well-formed bundles:

1. **Move the guard.** Cut `isSafeAnchorRelPath` (function body, unchanged) from `bundle-recover.js` into `shared-infra.js`; add it to `shared-infra.js`'s `module.exports`. `shared-infra.js` already requires `node:path`, so `path.isAbsolute` resolves with no new import.
2. **Re-export for stability.** In `bundle-recover.js`, import `isSafeAnchorRelPath` from `./shared-infra` and keep it in `bundle-recover.js`'s `module.exports` so its export surface is unchanged. `reconstructProjection`'s existing call site keeps working unchanged.
3. **Guard the verify path.** In `bundle.js`, import `isSafeAnchorRelPath` from `./shared-infra`, and add a validate-all-keys loop in `classifyBundle()` *before* the `withTempDir` materialisation block, returning a MALFORMED verdict on the first unsafe key.

**Behaviour summary.** `classifyBundle()` already validates the `anchors.files` *shape* (L275–277) before materialising. The new loop extends that pre-materialisation gate to validate each *key* is a safe rel-path, so an escaping key is rejected with a verdict before `withTempDir` ever runs.

**Placement — the new gate in `classifyBundle()`:**

```
PROCEDURE classifyBundle(read):
  ... existing member presence / status / JSON-parse checks ...
  IF anchors shape invalid:
    RETURN bundleVerdict("MALFORMED", identity, "anchors")     # existing, L275-276

  ... existing digest recompute + tamper-ref checks (L279-289) ...

  # NEW — validate EVERY anchor key before materialising ANY file:
  FOR rel IN keys(parsed.anchors.files):
    IF NOT isSafeAnchorRelPath(rel):
      RETURN bundleVerdict("MALFORMED", identity, "anchors-unsafe-path")

  tamperResult = withTempDir((tmp) => { ... existing materialise + tamper primitives ... })
  ...
```

**Ordering note.** The new loop may be placed either immediately after the anchors-shape check (L277) or immediately before `withTempDir` (L291). Either satisfies "before any file is written." Placing it directly before `withTempDir` keeps the guard visually adjacent to the loop it protects. **Chosen:** immediately before the `withTempDir` block — the guard reads as the precondition of the materialisation it defends.

**Cause string.**

**Chosen:** `"anchors-unsafe-path"` for the new rejection, distinct from the existing `"anchors"` (shape) cause. Rationale: the two failures are different (malformed shape vs. hostile key); a distinct cause lets the test assert the *guard* fired rather than coincidentally hitting the shape check, and aids operator diagnosis. Rejected: reusing `"anchors"` — cheaper but collapses two distinct rejections into one indistinguishable cause. `bundleVerdict(verdict, identity, cause)` takes a free-form cause string (L227), so a new value needs no schema change.

**Edge cases.**
- **Empty `files` map** — the loop iterates zero times, falls through to `withTempDir`, unchanged from today. (`reconstructProjection` separately requires `events.jsonl`; the verify path does not, so an empty map here is not this ticket's concern.)
- **Non-string / non-object value under a safe key** — out of scope for this guard; the guard checks the *key* only, exactly as `reconstructProjection` does. Byte handling is unchanged.
- **First-unsafe-key short-circuit** — the loop returns on the first offending key (matches `reconstructProjection`'s throw-on-first ordering); no partial temp dir is created because the return precedes `withTempDir`.

**Anti-pattern:** `bundle.js` doing `require("./bundle-recover")` to reuse the guard. Why: `bundle-recover.js` already requires `./bundle` (L40), so this creates a circular import — the exact constraint that forces relocation to a leaf module.

**Anti-pattern:** copying the guard body into `bundle.js`. Why: violates the single-guard-one-home principle; the two copies drift.

**Anti-pattern:** deleting `isSafeAnchorRelPath` from `bundle-recover.js`'s `module.exports`. Why: it is a published export (L903); dropping it is a needless surface break. Re-export instead.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a hand-built bundle whose anchors.files map carries a "../escape" key
When classifyBundle materialises the verify path
Then it returns a MALFORMED verdict (cause "anchors-unsafe-path") and no file is written outside the intended temp dir
```

```
Given a well-formed bundle whose anchors.files keys are all flat known filenames
When classifyBundle runs
Then the verdict is unchanged from today (CLEAN for an untampered fixture) — no regression
```

- The relocation is behaviour-preserving: `isSafeAnchorRelPath` returns identical results for the same inputs from its new home, and `bundle-recover.js`'s export surface still resolves the symbol.

## 6. DESIGN DECISION RATIONALE

**Where should the reused guard live, given the circular-import constraint?**

`bundle-recover.js` already `require`s `./bundle` (L40, and lazily L666), so `bundle.js` cannot `require("./bundle-recover")` for the guard without a cycle.

- **Option A — Relocate to `shared-infra.js` (leaf), re-export from `bundle-recover.js`.** Pros: `shared-infra.js` has zero internal `require("./…")` (a true leaf), is *already* imported by both `bundle.js` (L24) and `bundle-recover.js` (L38), and *already* requires `node:path` (L14) so `path.isAbsolute` needs no new import; single copy; no cycle; `bundle-recover.js`'s public export preserved via re-export. Cons: touches three files.
- **Option B — Lazy `require("./bundle-recover")` inside `classifyBundle()`.** Pros: two files touched, guard stays put. Cons: a lazy in-function require to dodge a top-level cycle is a code smell; leaves the guard's home coupled to a non-leaf module; less clean for future readers.
- **Option C — Copy the guard into `bundle.js`.** Pros: simplest diff. Cons: two divergent copies of a security guard — the explicit thing the ticket says to avoid ("reuse the exact guard rather than a second copy").

**Chosen:** Option A — relocate to `shared-infra.js`, re-export from `bundle-recover.js`. It is the only option that is both single-copy and cycle-free, and it exploits infrastructure (`shared-infra.js` already imported by both, already requiring `node:path`) that is already present. At the time of writing, `shared-infra.js` is a verified leaf (no internal `require("./…")`); if that ever changes, re-evaluate.

**What cause string should the new rejection carry?** Covered in HOW — **Chosen:** `"anchors-unsafe-path"`, distinct from the shape-check `"anchors"`.

**Where in `classifyBundle()` should the gate sit?** Covered in HOW — **Chosen:** immediately before the `withTempDir` materialisation block.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all decisions are closed.

**Assumptions.**

- **Assumes:** `shared-infra.js` remains a leaf module (no internal `require("./…")`) at build time. Validate: `grep -n 'require("\./' plugin/skills/faff/bin/lib/shared-infra.js` returns no matches before relocating.
- **Assumes:** `shared-infra.js` requires `node:path` (needed for `path.isAbsolute`). Validate: confirm `const path = require("node:path")` is present (currently L14); if absent, add it.
- **Assumes:** no consumer other than `reconstructProjection` and the test surface depends on `isSafeAnchorRelPath`'s *location* (only its `bundle-recover.js` export identity). Validate: `grep -rn "isSafeAnchorRelPath" plugin/ test/` before moving; the re-export keeps every existing import path resolving.

## 8. DONE — Definition of Done

### From WHY
- [ ] `bundle.js`'s verify path rejects an escaping anchor key before any file is written outside the intended temp dir (defence-in-depth parity with FAFF-820's recover path).

### From WHAT (types and interfaces)
- [ ] `isSafeAnchorRelPath` lives in `shared-infra.js` and is listed in its `module.exports`, with behaviour byte-identical to the prior `bundle-recover.js` implementation.
- [ ] `bundle-recover.js` still exports `isSafeAnchorRelPath` (via re-export from `./shared-infra`); its `module.exports` surface is unchanged.
- [ ] `bundle.js` imports `isSafeAnchorRelPath` from `./shared-infra`.
- [ ] No second copy of the guard body exists (single home).

### From HOW (behaviour)
- [ ] `classifyBundle()` validates every `parsed.anchors.files` key with `isSafeAnchorRelPath` before the `withTempDir` block.
- [ ] An unsafe key yields `bundleVerdict("MALFORMED", identity, "anchors-unsafe-path")`.
- [ ] `reconstructProjection` in `bundle-recover.js` still uses the guard and behaves unchanged.

### From HOW (edge cases)
- [ ] An empty `files` map still reaches `withTempDir` (no false rejection).
- [ ] The guard short-circuits on the first unsafe key, before any temp-dir write.

### From Scenarios (tests in `test/bundle.test.mjs`)
- [ ] A hand-built bundle with a `../escape` anchors.files key → MALFORMED, and no escaped file exists on disk after verify.
- [ ] A hand-built bundle with an absolute anchors.files key → MALFORMED, and no file exists at the absolute path after verify.
- [ ] A well-formed fixture bundle still classifies as it does today (CLEAN for an untampered fixture) — no regression.
- [ ] Existing `bundle-recover.test.mjs` and `bundle.test.mjs` suites pass unchanged (export/import paths still resolve).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Build a valid CLEAN bundle from a fixture run dir + anchor (as bundle.test.mjs does today).
  2. Assert classifyBundle(read) verdict == CLEAN.                         # no regression
  3. Mutate the anchors member: add key "../escape" -> base64("x"); re-sign digests so ONLY the path is hostile.
  4. Assert classifyBundle(read) verdict == MALFORMED, cause "anchors-unsafe-path".
  5. Assert no file exists at <tmp-parent>/escape.                         # nothing escaped
```

confidence: high
build-tier: complex
