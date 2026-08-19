# FAFF-876 — Reconcile the run-close bundle anchor path

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-876.
> build-tier: complex

_Revised 2026-08-19 — narrow refresh folding in the human resolution comment of 2026-08-19 ("Human decision: read the anchor directory that exists"), which unparked this spec and adjudicated the spec-review churn it was parked on. The human adopted the existing **Option B** and confirmed the two round-2 blockers as reviewer misfires. Folded in verbatim: (1) run-close publication reads `.faff/anchors/<rid>/` directly — the publish side changes, not `anchor-run`; (2) unsafe paths and symlinks now **fail publication loudly** (throw), never silently skipped, with a test for **each**; (3) directory mtime is the **accepted** fallback timestamp; (4) **no** wrapper `run-close` directory is introduced; (5) TOCTOU hardening is **out of scope** for the current single-owner runner. The boundary key, remote refs, and issue-level resolution stay unchanged. (Earlier revision, 2026-08-19: folded the round-1 infosec objection — creation-side walk reuses the FAFF-865 `isSafeAnchorRelPath` guard and `fs.lstatSync`.)_

This spec addresses FAFF-876: the run-close recovery bundle never publishes because the two sides of the boundary disagree on where the run anchor lives on disk. It is written for the build agent that will apply the fix and for human reviewers gating the change. The artifact is a single, localized bug fix in the bundle-publish path plus the regression tests that would have caught it.

## 1. WHY — Problem and Principles

**The load-bearing model.** A recovery bundle is assembled by reading a directory of already-minted anchor bytes off disk and packaging them into an immutable, write-once object. The *identity* of that bundle (`boundary_kind` + `boundary_key`) and the *on-disk location* of the anchor bytes it reads are two separate things that must resolve to the same directory. This bug is a disagreement between those two: the identity says `run-close`, but the run-level anchor tree has no `run-close` directory — the identity constant must not be conflated with a path segment.

**Problem statement.** After an L4 run, `faff events anchor-run` mints the run anchor at `.faff/anchors/<rid>/` (a `summary.md` plus one subdirectory per admitted issue), while `faff bundle publish --boundary-kind run-close` reads `.faff/anchors/<rid>/run-close/` — a directory that is never created. `buildBundle` therefore finds an empty anchor and throws `no anchor found … publish must run AFTER the anchor mint`, so the run-close recovery bundle silently never publishes. This change makes the publish side resolve the run-level anchor at the path the mint side actually writes, so the bundle publishes.

**Design principles.**

**Preserve the ADR-0109 discovery path.** ADR 0109 and the FAFF-796 spec deliberately chose to reuse the existing `.faff/anchors/<run>/` tree as the run-anchor discovery path, and the governance-check leg and the `.gitignore` carve-out are both keyed on it. The mint side is the earlier, ADR-anchored source of truth for the tree shape. The fix must not move or wrap that tree; the publish side is the one carrying the incorrect assumption and is the side that changes. (Confirmed by the human decision: do **not** introduce a wrapper `run-close` directory.)

**Keep `boundary_key` an identity constant, not a path segment.** The pinned invariant `boundary_kind "run-close" ⇒ boundary_key === "run-close"` (asserted in `validateIdentityForHandle` and `buildBundle`) and the git-remote ref name `refs/faff/bundles/<rid>/seg-<N>/run-close` both stay exactly as they are. Only the filesystem resolution of *where the anchor bytes live* changes — the run-close boundary reads the run-anchor root directly, it does not append its key as a directory.

**Guard the creation-side walk to parity with the verify side — fail loud, never skip.** Widening `readAnchorDir` to walk the whole run-anchor root, base64-encode it into the `anchors` member, and push it to a write-once git-remote ref broadens what an unguarded walk could sweep in. Today the creation-side `walk()` uses `fs.statSync` (which follows symlinks) with no path-escape check, while the FAFF-865 `isSafeAnchorRelPath` guard lives only on the verify/materialisation side (`bundle.js:297`). A symlink or traversal-crafted name planted under `.faff/anchors/<rid>/` before publish could otherwise be followed, read, and exfiltrated into the pushed bundle. This fix therefore brings the creation-side walk to parity: it reuses the existing `isSafeAnchorRelPath` from `shared-infra` and switches to `fs.lstatSync` (no symlink follow). Per the human decision, an unsafe rel-path **or** a symlink entry makes publication **fail loudly** — `readAnchorDir` throws an error naming the offending entry, aborting the publish. It is **not** silently skipped: a planted-entry anchor tree is a fault the operator must see, not a subset the bundle quietly omits. This hardening applies to the shared `walk()`, so `issue-merge-floor` inherits the same loud-fail behaviour.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/bundle.js` | Node.js (CommonJS) | `readAnchorDir` / `buildBundle` — the side that changes |
| `plugin/skills/faff/bin/lib/events.js` | Node.js (CommonJS) | `anchor-run` / `mintIssueAnchor` — the mint side (read-only reference; unchanged) |
| `test/bundle.test.mjs` | Node.js (ESM test) | Where the regression tests land |
| `records/adr/0109-*.md`, `records/specs/2026-08-15-FAFF-796-*.md` | Markdown | The ADR + spec that fix the canonical tree shape |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node.js (CommonJS) | Exports `isSafeAnchorRelPath` (FAFF-865) — the path-escape guard the walk reuses |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown | The production call site (anchor-run then bundle publish --boundary-kind run-close) |

**Scope statement.** This sits in the Phase-0 git-only recovery-bundle path: the leg between `anchor-run` (mint) and `bundle publish` (package) for the run-level `run-close` boundary.

## 2. OUT OF SCOPE

- **Changing `anchor-run`'s output tree.** — Excluded because the mint side is the ADR-0109-anchored source of truth and other consumers (governance-check leg, `.gitignore` carve-out) depend on `.faff/anchors/<rid>/`. Extension point: `events.js` `cmdEvents` `anchor-run` branch — untouched by this issue.
- **A wrapper `run-close` directory under `<rid>/`.** — Excluded by explicit human decision: do not introduce a wrapper directory. It would reintroduce the two-source-of-truth split this fix removes and double-store the run anchor.
- **TOCTOU hardening of the anchor read.** — Excluded per the human decision: TOCTOU hardening is not required for the current single-owner runner. The `lstat`-then-`read` window is accepted under the local single-owner trust boundary; if a future multi-owner runner lands, hardening (e.g. open-then-fstat) is that change's concern, not this fix's.
- **The git-remote store layer (`gitRemoteBundleStore`, `refs/faff/bundles/…`).** — Excluded because it is downstream of the throw and never reached today; it works correctly for `issue-merge-floor` through the same code. Extension point: `bundle.js` `gitRemoteBundleStore` — unchanged.
- **The bundle-verify / classify path.** — Excluded because verify reads member bytes from the store, not the filesystem anchor dir, so it is unaffected by where `readAnchorDir` looks. Extension point: `classifyBundle` — unchanged.
- **The `issue-merge-floor` boundary resolution.** — Excluded because `.faff/anchors/<rid>/<issue>/` already resolves correctly; the fix must leave that path byte-for-byte identical (it does inherit the hardened, loud-failing shared `walk()`).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| run anchor | The run-level tamper-evident tree minted by `anchor-run` at `.faff/anchors/<rid>/`: a `summary.md` plus one subdir per admitted issue. |
| boundary_kind | The identity enum selecting the kind of safe boundary: `issue-merge-floor` or `run-close`. |
| boundary_key | The identity token distinguishing boundaries of a kind: the issue id for `issue-merge-floor`, the pinned constant `run-close` for `run-close`. |
| anchor dir | The on-disk directory `readAnchorDir` walks to collect the bytes a bundle carries. The subject of this fix. |

**The resolution rule (the WHAT of the fix).**

```
FUNCTION anchor_dir_for(root, run_id, boundary_kind, boundary_key):
  IF boundary_kind == "run-close":
    RETURN <root>/.faff/anchors/<run_id>/            # the run-anchor root itself
  ELSE:                                              # "issue-merge-floor"
    RETURN <root>/.faff/anchors/<run_id>/<boundary_key>/
```

`readAnchorDir` gains the `boundary_kind` argument so it can apply this rule; its recursive `walk()` (hardened below) captures `summary.md` plus every per-issue subdir file under the run-anchor root.

**Design decisions.**

Which side owns the canonical boundary name (the ticket's open question)?

| Option | Pros | Cons |
|---|---|---|
| A: `anchor-run` mints `<rid>/run-close/` | `readAnchorDir`'s current `<rid>/<key>/` formula needs no change | Breaks the ADR-0109 discovery path; ripples into the governance-check leg + `.gitignore` carve-out; moves the earlier, ADR-anchored source of truth to satisfy the later side |
| B: `bundle publish` resolves `<rid>/` directly for run-close | Localized to one file; preserves the ADR-0109 tree that the mint side, governance-check, and gitignore already agree on; identity constant stays pinned | `readAnchorDir` must know the boundary_kind (one extra argument) |

**Chosen:** Option B — the publish side resolves `.faff/anchors/<rid>/` directly for the `run-close` boundary. The `<rid>/` run-anchor tree is the canonical shape (ADR 0109, FAFF-796); `boundary_key === "run-close"` remains an identity constant, not a path segment. This is the settled decision: the human resolution comment of 2026-08-19 adopted Option B explicitly ("read the anchor directory that exists") — the Option A/B question is closed and must not be re-opened.

## 4. HOW — Behavior

**Architecture and approach.** The change is confined to `bundle.js`. `readAnchorDir` takes the `boundary_kind` and resolves the anchor dir per the rule in §3; `buildBundle` passes `identity.boundary_kind` through at its single call site. Everything downstream — member assembly, `last_safe_boundary`, digesting, the store `put()` — is unchanged and simply now receives a non-empty anchor for the run-close case.

```
PROCEDURE readAnchorDir(root, run_id, boundary_kind, boundary_key):
  1. IF boundary_kind == "run-close":
        dir = join(root, ".faff", "anchors", run_id)
     ELSE:
        dir = join(root, ".faff", "anchors", run_id, boundary_key)
  2. files = {}
  3. walk(dir, ""):                          # HARDENED — was stat + no guard
        for each entry name under d, relPath = rel ? rel/name : name:
          st = lstat(entry)                  # lstat, NOT stat — never follow a symlink
          IF st.isSymbolicLink() OR NOT isSafeAnchorRelPath(relPath):
             THROW Error("unsafe anchor entry: " + relPath)   # fail LOUD — abort publish, never skip
          ELSE IF st.isDirectory(): recurse
          ELSE: files[relPath] = base64(readFileSync(entry))
  4. RETURN { dir, relDir: relative(root, dir), files }
```

`isSafeAnchorRelPath` is the same guard imported from `shared-infra` and already applied on the verify side (`bundle.js:297`, FAFF-865) — reused here, not reinvented. At the `buildBundle` call site (`bundle.js:147`), change `readAnchorDir(root, identity.run_id, identity.boundary_key)` to pass `identity.boundary_kind` as well.

**Behavior summary.** For `run-close`, `readAnchorDir` now walks the run-anchor root, so `files` contains `summary.md` and every `<ISSUE>/…` file the run minted; `buildBundle`'s empty-anchor guard passes and the bundle assembles and publishes. A symlink or traversal-crafted entry anywhere under the walked root aborts the publish with a loud, named error before any bytes are bundled.

**Edge cases and error handling.**

- **`chain-head.json` at the run-anchor root — dir-mtime fallback (accepted).** `buildBundle` derives `last_safe_boundary.ts` from `statSync(anchor.dir + "/chain-head.json").mtime` (`bundle.js:163-166`), falling back to the anchor dir's own mtime on `catch`. The run-anchor root has no run-level `chain-head.json` (those are per-issue), so the run-close case takes that fallback to the directory mtime. This is the **accepted** behaviour: the human decision explicitly accepts directory mtime as the fallback timestamp. It is an intended `catch` fallback, not a swallowed error — the DONE checklist asserts it so the fallback is exercised, not assumed.
- **Anchor genuinely absent (publish before mint).** If `.faff/anchors/<rid>/` does not exist or is empty, `walk()` returns `files: {}` and `buildBundle` throws the existing `no anchor found …` error. Preserved — a real pre-mint publish still fails loud.
- **`issue-merge-floor` resolution unchanged.** The `else` branch is byte-identical to today's `path.join(root, ".faff", "anchors", run_id, boundary_key)`, so every existing `issue-merge-floor` publish resolves to the same directory as before. It does inherit the hardened shared `walk()` (lstat + `isSafeAnchorRelPath` + loud fail), which for a well-formed anchor tree (no symlinks, no escaping names) yields the identical files map — the guard only changes behaviour on a malicious/planted entry, which it now rejects loudly, exactly the intended fix.

**Anti-pattern:** Special-casing on `boundary_key === "run-close"` instead of `boundary_kind`. Why: `boundary_key` is a free token that could in principle collide with an issue-shaped key; the `boundary_kind` enum is the authoritative selector and is already validated against `BUNDLE_BOUNDARY_KINDS`.

**Anti-pattern:** Silently skipping an unsafe/symlink entry instead of failing loud. Why: a planted entry under `.faff/anchors/` is a security-relevant fault the operator must see; quietly omitting it would let a tampered anchor tree publish a subset bundle that looks clean. The human decision mandates loud failure.

**Anti-pattern:** Making `anchor-run` also write a `run-close/` directory "to be safe". Why: it reintroduces the two-source-of-truth split this fix removes and would double-store the run anchor (explicitly excluded by the human decision).

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 run whose anchor-run has minted .faff/anchors/<rid>/ (summary.md + per-issue subdirs)
When `faff bundle publish --boundary-kind run-close --boundary-key run-close` runs for that run
Then the bundle assembles from the run-anchor root and publishes successfully (no "no anchor found" throw)
```

- The `issue-merge-floor` publish path MUST remain unchanged in its *resolution*: an existing `issue-merge-floor` publish resolves `.faff/anchors/<rid>/<issue>/` exactly as before (the shared walk gains the loud-failing path-escape guard, which is the intended hardening, not a resolution change).

## 6. DESIGN DECISION RATIONALE

**Which side owns the canonical boundary name?**

- **Option A — `anchor-run` mints `<rid>/run-close/`.** Pro: no change to the bundle side's path formula. Con: it moves the ADR-0109 discovery path that the mint side, the governance-check leg, and the `.gitignore` carve-out already agree on, to satisfy the later side; it makes the earlier, ADR-anchored contract yield to the newer one.
- **Option B — `bundle publish` resolves `<rid>/` directly.** Pro: localized to `bundle.js`; preserves the canonical `<rid>/` tree; keeps `boundary_key === "run-close"` as a pure identity constant. Con: one extra argument threaded into `readAnchorDir`.

**Chosen:** Option B. At the time of writing, ADR 0109 (git-only anchor shape) and the FAFF-796 spec pin `.faff/anchors/<run>/` as the run-anchor tree, minted 2026-08-15; the `run-close` boundary-key vocabulary was introduced later by FAFF-819 (2026-08-17) and is the side carrying the mistaken `<rid>/run-close/` assumption. The earlier, ADR-anchored, multiply-depended-on contract wins; the publish side changes. This decision was ratified by the human resolution comment of 2026-08-19 and is closed.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ticket's open question (which side owns the canonical name) is closed by the Chosen decision above, ratified by the human resolution of 2026-08-19. The round-2 spec-review points that previously parked this spec were adjudicated by that same human decision as reviewer misfires (the dir-mtime fallback is accepted, not a swallowed error; demanding literal test code in a spec is a category error — tests are materialised at build). TOCTOU hardening is explicitly out of scope for the current single-owner runner.

**Assumptions.**

- **Assumes:** `anchor-run` writes `summary.md` plus one subdir per admitted issue directly under `.faff/anchors/<rid>/`, with no umbrella boundary directory. Validation: confirmed against `events.js` `anchor-run` (dest = `.faff/anchors/<basename(run_dir)>`, `summary.md` copied under `dest`, `mintIssueAnchor` per issue) and against the observed live tree before building.
- **Assumes:** the `run-close ⇒ boundary_key === "run-close"` identity invariant in `validateIdentityForHandle` / `buildBundle` (`bundle.js:84`, `:119`) stays in force. Validation: leave both assertions unchanged; the fix touches only path resolution, not identity validation.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff bundle publish --boundary-kind run-close --boundary-key run-close` succeeds after `anchor-run` on a run with ≥1 admitted issue (no `no anchor found` throw).

### From WHAT (resolution rule)
- [ ] `readAnchorDir` resolves `.faff/anchors/<rid>/` for `boundary_kind == "run-close"` and `.faff/anchors/<rid>/<boundary_key>/` otherwise.
- [ ] The `run-close ⇒ boundary_key === "run-close"` assertions in `validateIdentityForHandle` and `buildBundle` are unchanged.
- [ ] The git-remote ref name `refs/faff/bundles/<rid>/seg-<N>/run-close` is unchanged.

### From HOW (behaviour)
- [ ] The run-close `anchors` member's `files` map includes `summary.md` and every admitted-issue subdir file from the run-anchor root.
- [ ] `buildBundle` passes `identity.boundary_kind` into `readAnchorDir` at its call site.

### From HOW (security hardening — creation-side walk parity, fail loud)
- [ ] The creation-side `readAnchorDir` walk applies `isSafeAnchorRelPath` (reused from `shared-infra`) to every entry's relPath and uses `fs.lstatSync` (does not follow symlinks) — reaching parity with the verify-side guard at `bundle.js:297`.
- [ ] A symlink entry planted under `.faff/anchors/<rid>/` makes publication **fail loudly** (`readAnchorDir` throws, naming the entry); its target bytes never reach the `anchors` files map. Negative test asserts the throw.
- [ ] A `..`-traversal / unsafe-rel-path entry planted under `.faff/anchors/<rid>/` makes publication **fail loudly** (`readAnchorDir` throws, naming the entry); its bytes never reach the `anchors` files map. A **separate** negative test asserts the throw.

### From HOW (edge cases)
- [ ] A run-close publish with no run-level `chain-head.json` derives `last_safe_boundary.ts` from the anchor dir's mtime fallback (no throw) — the accepted fallback.
- [ ] Publishing before the anchor is minted still throws the existing `no anchor found` error.
- [ ] An existing `issue-merge-floor` publish resolves `.faff/anchors/<rid>/<issue>/` as before (regression guard).

### From tests
- [ ] `test/bundle.test.mjs` gains a round-trip case: mint a run anchor (summary.md + ≥1 issue subdir) on a scratch fs, then `buildBundle`/`publishBundle` with `boundary_kind: "run-close"` and assert success + the expected `anchors` files map. This is the case whose absence let the bug ship.
- [ ] `test/bundle.test.mjs` gains **two** negative cases — one for a planted symlink, one for a `..`-traversal-crafted name — each asserting `readAnchorDir`/`buildBundle` throws (loud fail) rather than skipping or bundling the entry.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. On a scratch root, create .faff/anchors/<rid>/summary.md and .faff/anchors/<rid>/FAFF-1/{events.jsonl,run-ledger.json,chain-head.json}
  2. Write a valid run-ledger.json under the run dir
  3. Call buildBundle(runDir, { run_id: <rid>, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 }, root)
  4. ASSERT no throw; manifest.members.anchors present; anchors bytes decode to a files map containing "summary.md" and "FAFF-1/events.jsonl"
  5. Plant a symlink (and, separately, a "../escape" name) under .faff/anchors/<rid>/ and ASSERT step 3 now throws a named "unsafe anchor entry" error
```

confidence: high
spec-review: approve
