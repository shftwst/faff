# FAFF-1400: Harden the evidence and integrity-digest hashers against a symlink swap between lstat and read

> Spec: faffter-dark-nlspec · 2026-10-24 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-1400.

This spec is for the build agent and human reviewers. It closes the window in which both file hashers check a path with `lstat` and then read it again by path, so a same-uid process can swap the regular file for a symlink in between and have the hasher digest the symlink's target.

## 1. WHY

**The load-bearing model.** A hash is only as trustworthy as the open that produced its bytes. Today each hasher asks the filesystem twice: once "is this a regular file?" (`lstat` on the path) and once "give me the bytes" (`readFileSync` on the same path, which follows symlinks). The answer to the first question can go stale before the second is asked. The fix is to ask once: open the path with `O_NOFOLLOW`, `fstat` the descriptor, and hash bytes read from that same descriptor. The classification and the bytes then come from one kernel object, and a symlink at open time is refused rather than followed.

**Problem statement.** `faff evidence return` / `verify-return` and `faff integrity-digest snapshot` / `verify` / `rebaseline` both run `lstat` then a by-path read. A same-uid lane can replace a member file with a symlink to a lane-stable copy after the `lstat` and before the read, so the hasher reports the copy's digest and a tamper reads as clean. This change makes every content read in both hashers a single no-follow descriptor read, with identical classification in both, so the obligation 6 digest agreement (`faff evidence return` and `faff integrity-digest hash` report the same leaf sha256) still holds.

**Design principles.**

- **One open decides.** The check that gates hashing and the bytes that get hashed come from the same descriptor. Reject any implementation that keeps a by-path `lstat` or `stat` as the authority for "regular file" and then reads by path, however short the gap.
- **Never degrade to following.** If the platform cannot open without following, the hasher fails loud (a fault, exit 2). It never falls back to a plain open, because a silent fallback restores the exact hole this ticket closes.
- **Same primitive, same answer.** Both hashers read through one shared primitive, so their classification of a path and the bytes they hash cannot drift apart. The hash functions themselves stay where they are (Node `crypto` in `evidence.js`; the absolute-path external hasher in `integrity-digest.js`).
- **No new verdict vocabulary.** A race outcome maps onto an existing classification (`not-regular-file`, absent, a symlink record, or a fault). No new result string, park cause, manifest field or manifest version.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/evidence.js` (`lstatOrNull`, `hashRegularFile`, `evidenceReturn`, `verifyReturn`, selftest digests) | JavaScript, region governance | The evidence-return hasher. Landed on main with FAFF-1397 (#1124). |
| `plugin/skills/faff/bin/lib/integrity-digest.js` (`digestLeaf`, `walkLeaves`, `snapshotMember`, `diffAgainstManifest`) | JavaScript, region factory | The integrity-digest leaf hasher. |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript | Region direction lint: governance must not require factory; factory may require governance; shared-infra requires no local module. |
| `plugin/skills/faff/bin/lib/ac-id.js`, `finding-id.js` | JavaScript, region governance | Precedent for a helper-only governance module ("one code home") required from both regions. |
| `plugin/skills/faff/bin/lib/shared-infra.js` (`cliPosixGuard`) | JavaScript | The CLI refuses native Windows at entry (FAFF-580). |
| `plugin/skills/faff/references/l4.md` obligation 6 | Prose | Requires `verify-return` to compute the same leaf sha256 `faff integrity-digest hash` reports. |
| `test/evidence-return.test.mjs`, `test/integrity-digest.test.mjs` | JavaScript tests | Existing static-symlink coverage; new race and agreement tests land here. |

**Callers affected by the integrity-digest change** (all through `buildManifest` / `diffAgainstManifest`, none through a direct file read of their own):

| Caller | Entry point | What it does with a throw |
|---|---|---|
| `faff integrity-digest snapshot` / `verify` | `cmdIntegrityDigest` | Exit 2, never a silent verified |
| `faff integrity-digest verify --record-result` (merge-gate custody verdict, l4.md obligation 7 step b′) | `verifyAndRecord` | Records `verification-unavailable`, exit 2 |
| `faff integrity-digest rebaseline` (obligation 5 re-baseline) | `rebaselineFold` | Refuses with code 2, emits no manifest |
| Corrective authority fold | `corrective.js` around line 577 | Becomes `{ held: true, error }`, never empty diffs |
| Bundle seal (anchor bundles) | `bundle-seal-core.js` `buildManifest` | Propagates; seal fails |
| Bundle verify | `bundle.js` `diffAgainstManifest` over a temp materialisation | Propagates |

`faff integrity-digest hash` reads stdin, not a path, and `merge-gate-floor.js` uses only the byte-level `sha256`; neither changes.

**Scope statement.** A hardening of the file-read step inside the two existing hashers; it changes no CLI surface, verdict shape, manifest shape or region assignment.

## 2. OUT OF SCOPE

- **Intermediate path components (a parent directory swapped for a symlink).** `O_NOFOLLOW` protects only the final component. A same-uid lane that replaces `<run_dir>/<issue>/` or `<run_dir>/corrective/` (or a subdirectory found by `walkLeaves`) with a symlink after it was checked can still redirect a no-follow open through the new parent; `walkLeaves`' `readdirSync` on a swapped subdirectory likewise lists the target. **Why excluded:** Node 20 has no `openat` or descriptor-relative `readdir`, so a real fix needs a different mechanism (a per-component no-follow walk with device and inode checks, or a platform helper) and its own design. **Extension point:** the new shared read primitive (section 3) is where a descriptor-anchored walk would live; `evidence.js` `guardWriterPaths` and `integrity-digest.js` `walkLeaves` are the two callers. Record it as concrete discovered scope at build time (graft records it in `discovered-scope.json`; the orchestrator files it); do not fold it into this one.
- **Other by-path reads of evidence-adjacent files.** `merge-gate-floor.js` reads `custody-verdict.json`, `ac-checklist.json`, `review-verdict.json`, `holdout.json` and `lane-boundary.json` by path; `evidence.js` reads `run-ledger.json` in `claimFromLedger`. **Why excluded:** none of these is the leaf hasher this ticket names, and each has its own trust argument. **Extension point:** each can adopt the same shared primitive later.
- **Symlink targets recorded via `readlinkSync`.** A symlink member's recorded target is metadata, not a content read; a re-pointed link already reads as tamper. **Why excluded:** no bytes are hashed through it. **Extension point:** none needed.
- **A manifest record for special files (FIFO, socket, device).** **Why excluded:** that is a manifest schema change (`MANIFEST_VERSION` d1); this ticket refuses such files with a fault instead. **Extension point:** `snapshotMember` and `leafEq` in `integrity-digest.js`.
- **Native Windows.** **Why excluded:** the CLI is POSIX-only (`cliPosixGuard`), and Node exposes no `O_NOFOLLOW` constant on Windows. The primitive fails loud there for in-process use; no Windows path is built.

## 3. WHAT

**Vocabulary.**

| Term | Definition |
|---|---|
| No-follow open | Opening a path read-only with `O_NOFOLLOW` (refuse a symlink in the final component) and `O_NONBLOCK` (never wait on a FIFO), taken from `fs.constants`. |
| Leaf read | One no-follow open, an `fstat` of that descriptor, and, for a regular file only, reading its full bytes from that descriptor. The descriptor is always closed. |
| Pre-check | Any `lstat` or `stat` of the path made before the leaf read. Allowed for routing (for example, to send a symlink to `readlinkSync` or a directory to `walkLeaves`), never as the authority for "regular file". |
| Swap window | The time between a pre-check and the read. After this change no content read depends on a pre-check, so the window no longer reaches the bytes. |

**The shared primitive.** A new helper-only module in `plugin/skills/faff/bin/lib/`, banner `region:governance`, requiring only `node:fs` (and `node:path` if needed). `evidence.js` requires it (governance to governance, legal) and `integrity-digest.js` requires it (factory to governance, legal, the `ac-id.js` precedent). It hashes nothing.

```
ENUM LeafKind:
  regular        # fstat says regular file; bytes were read from this descriptor
  symlink        # final component is a symlink (open refused; confirmed by lstat)
  directory      # fstat says directory
  other          # fstat says FIFO, socket, character or block device
  absent         # ENOENT, or ENOTDIR on a parent component

RECORD LeafRead:
  kind: LeafKind
  bytes: Buffer | null        # non-null iff kind == regular

INTERFACE readLeafNoFollow(abs: AbsolutePath, constants = fs.constants) -> LeafRead
  # constants is a test-only seam; production callers never pass it
  # throws a plain Error (callers wrap it in their own fault type) when:
  #   - O_NOFOLLOW or O_NONBLOCK in the constants object is not a number (dropping either
  #     silently reopens a hole: following a symlink, or blocking on a FIFO)
  #   - open fails for any reason other than the absent and symlink cases
  #   - fstat or the read fails
```

**Caller-visible behaviour, per hasher.** Unchanged for every path that is stable during the call. For a path that changes kind during the call, the outcome is the one a pre-check taken at open time would have produced:

| Leaf read result | `faff evidence return` | `faff evidence verify-return` row | `integrity-digest` member or sub-leaf |
|---|---|---|---|
| `regular` | `{present:true, sha256}` | hashed, `match` / `hash-mismatch` | `{sha256}` |
| `symlink` | fault: `<name> is not a regular file`, exit 2 | `not-regular-file`, `disk_sha256: null` | symlink record `{symlink:true, target}`; diff reports `symlink swapped` |
| `directory` or `other` | fault: `<name> is not a regular file`, exit 2 | `not-regular-file`, `disk_sha256: null` | fault (throw), so snapshot / verify / rebaseline exit 2 and custody records `verification-unavailable` |
| `absent` | `{present:false, sha256:null}` | `disk_present:false`, then the existing presence rules | top-level member `{present:false}`; sub-leaf under a directory is skipped (existing "vanished mid-walk" rule) |
| throws | fault, exit 2 | fault, exit 2 | throw, exit 2 / `verification-unavailable` |

Design decisions for this section:

- **Where the shared code lives.** Options: a new governance helper module required by both; two private copies, one per file; adding the function to `shared-infra.js`. Copies are what the ticket warns against (they drift, and obligation 6 depends on agreement). `shared-infra.js` would also satisfy the lint, but it is a grab-bag of roots and ledgers, and the repo's pattern for a single-purpose shared primitive is a named governance module. **Chosen:** a new governance helper module, required by both hashers.
- **Open flags.** `O_RDONLY | O_NOFOLLOW` alone would block forever on a FIFO planted at a member path (today's `readFileSync` already hangs there). **Chosen:** `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`; `O_NONBLOCK` has no effect on regular-file reads, and a FIFO is then refused as `other` after `fstat`.
- **Platform without `O_NOFOLLOW` or `O_NONBLOCK`.** On Windows `fs.constants.O_NOFOLLOW` is undefined, and `undefined | flags` silently drops it; a missing `O_NONBLOCK` is dropped the same way and brings back the FIFO hang. **Chosen:** the primitive throws when either constant is not a number; it never opens without both.

## 4. HOW

**Approach.** Both hashers stop reading by path. Every place that today hashes `fs.readFileSync(abs)` calls `readLeafNoFollow(abs)` and acts on its `kind`. A pre-check may stay where it routes work (a symlink to `readlinkSync`, a directory to `walkLeaves`), but hashing happens only on a `regular` result, and only on the bytes that result carries.

Read sites to convert (verified on main at `61e84b13`):

| File | Site | Today |
|---|---|---|
| `evidence.js` | `hashRegularFile`, called from `evidenceReturn`, `verifyReturn` and the selftest digests | `lstatOrNull` then `readFileSync(abs)` |
| `integrity-digest.js` | `snapshotMember`, events branch | `lstatSync` then `readFileSync(abs)` |
| `integrity-digest.js` | `snapshotMember`, directory branch, per sub-leaf from `walkLeaves` | `lstatSync` in the walk, then `readFileSync(f.abs)` |
| `integrity-digest.js` | `snapshotMember`, plain-file branch | `lstatSync` then `readFileSync(abs)` |
| `integrity-digest.js` | `diffAgainstManifest`, events prefix check | a second `readFileSync` after `snapshotMember` |
| `integrity-digest.js` | `digestLeaf` | `lstatSync` then `readFileSync`; has no caller and is not exported |

**The leaf read.** Summary: open once without following, let the descriptor say what the file is, and read only a regular file.

```
PROCEDURE readLeafNoFollow(abs):
  1. IF constants.O_NOFOLLOW or constants.O_NONBLOCK is not a number: THROW "no-follow non-blocking open unsupported on this platform"
  2. TRY open abs with O_RDONLY | O_NOFOLLOW | O_NONBLOCK
     ON error e:
       a. IF e.code in {ENOENT, ENOTDIR}: RETURN { kind: absent, bytes: null }
       b. lstat abs (no follow); IF it reports a symlink: RETURN { kind: symlink, bytes: null }
          # errno-independent: Linux and macOS report ELOOP, other POSIX systems use other codes
       c. IF that lstat fails with ENOENT: RETURN { kind: absent, bytes: null }
       d. THROW naming abs and e.code
  3. fstat the descriptor
  4. IF regular file: read all bytes from the descriptor; RETURN { kind: regular, bytes }
     ELSE IF directory: RETURN { kind: directory, bytes: null }
     ELSE: RETURN { kind: other, bytes: null }
  5. ALWAYS close the descriptor (on every path out of steps 3 and 4)
```

**`evidence.js` behaviour.** `evidenceReturn` and `verifyReturn` take presence, regular-ness and bytes from one leaf read per evidence file, per the table in section 3. `RESULT_CAUSE`, `park_cause` strings, `tampered_paths` and exit codes are unchanged. A leaf-read throw becomes the existing `WriterFault` (`cannot hash <name>: <code>`), exit 2.

**`integrity-digest.js` behaviour.**

- `snapshotMember` may keep its `lstat` to route a symlink member to `readlinkSync` and a directory member to `walkLeaves`. Every content read goes through the leaf read.
- When the leaf read returns `symlink` where the pre-check saw a file, record `{symlink:true, target: readlinkSync(abs)}` as if the pre-check had seen the link. If that `readlinkSync` fails, throw (fail loud, exit 2). Never hash.
- When it returns `directory` or `other` where a file was expected, throw naming the path and "not a regular file". Callers already turn a throw into exit 2, `verification-unavailable`, a refused rebaseline, or a `{held:true, error}` corrective fold.
- The events prefix check in `diffAgainstManifest` reads through the leaf read. Reusing the bytes from the `snapshotMember` read for the same call is preferred over a second open; if a second open stays, it goes through the leaf read and a non-`regular` result is handled per the table.
- Delete `digestLeaf`. It has no callers, is not exported, and keeps an unguarded lstat-then-read alive.
- Manifests for stable trees are byte-identical to today's: same members, same record shapes, `MANIFEST_VERSION` stays `d1`.

**Digest agreement.** Both hashers hash the `bytes` of the same kind of leaf read, so for a stable regular file `faff evidence return`'s sha256, the per-issue `integrity-digest snapshot` member sha256 for the same file, and `faff integrity-digest hash` over the file's bytes are equal.

**Anti-pattern:** keeping `lstat(abs).isFile()` as the gate and only swapping `readFileSync(abs)` for an `O_NOFOLLOW` open. Why: it narrows the window but leaves "regular file" decided by a stale stat, so a regular file swapped for a FIFO or directory still reaches a read.

**Anti-pattern:** `fs.constants.O_NOFOLLOW || 0`, `O_NONBLOCK || 0`, or any default that opens without either flag. Why: without the first it silently follows symlinks; without the second a FIFO blocks the custody path forever.

**Anti-pattern:** catching the leaf-read fault inside `integrity-digest.js` and recording the member as absent or clean. Why: a hash that could not be computed must never read as verified; callers own the fail-closed mapping.

**Edge cases.**

- **Swap file to symlink after the pre-check:** open refuses; outcome per the `symlink` row.
- **Swap file to FIFO, socket or directory after the pre-check:** `fstat` says not regular; outcome per the `directory or other` row; no blocking read.
- **Removed after the pre-check:** `absent` row.
- **Swapped back to a regular file after an `ELOOP` open:** step 2b's `lstat` no longer sees a symlink and step 2d throws (exit 2). Correct: something changed the path twice during one call.
- **File grows or shrinks during the read:** the bytes hashed are what the descriptor read returned, as today; prefix and digest checks then judge them.
- **Descriptor leak:** every exit from the leaf read closes the descriptor, including a read error.

**Failure modes of the approach.**

- **The failure:** `O_NOFOLLOW` does not cover parent components, so the hardening can look complete while a parent-directory swap still redirects the read. **How you'd know:** a test that swaps `<run_dir>/<issue>` for a symlink to a directory holding identical files still verifies clean. **What it means:** expected, and named in OUT OF SCOPE; file the follow-up rather than widen this ticket.
- **The failure:** the race test passes because it never reached the window (for example, the stub is installed on a different `fs` object from the one the module uses). **How you'd know:** the same test, run against the pre-change module, also passes. **What it means:** the test is vacuous; the build agent must confirm the new race tests fail on the pre-change code before relying on them.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an issue dir whose review-verdict.json is a regular file holding bytes A
And a claim carrying the digest of bytes B, held in a file elsewhere
When verify-return's pre-check sees the regular file and the path is then replaced by a symlink to the B file before the read
Then the review-verdict.json row is not-regular-file, and never match
And the verdict is mismatch with <issue>/review-verdict.json in tampered_paths
And the digest of bytes B never appears as disk_sha256
```

```
Given a held integrity-digest manifest recording run-ledger.json with the digest of bytes B
And run-ledger.json on disk now holds tampered bytes A, with an external copy of bytes B elsewhere
When verify's pre-check sees the regular file and the path is then replaced by a symlink to the B copy before the read
Then verify reports run-ledger.json as "symlink swapped" and exits 1, and never reports digest-verified
```

- For a stable regular file, `faff evidence return`'s `ac_checklist.sha256`, the per-issue snapshot's `<issue>/ac-checklist.json` sha256, and `faff integrity-digest hash` over the file's bytes MUST be equal.
- With `O_NOFOLLOW` or `O_NONBLOCK` absent from the constants object, the leaf read MUST throw and MUST NOT open the path.

## 6. DESIGN DECISION RATIONALE

**Should the descriptor or a pre-check decide "regular file"?**
- Pre-check gate plus no-follow open: smallest diff, but the gate is still stale and FIFO and directory swaps still reach a read.
- Descriptor decides, pre-check only routes: one source of truth, closes every final-component swap.

**Chosen:** the descriptor decides; a pre-check may route but never authorises a hash. This is what the ticket's suggested fix (open with `O_NOFOLLOW`, `fstat`, hash from the descriptor) asks for.

**How should a failed no-follow open be classified as a symlink?**
- Match `ELOOP` only: Linux and macOS return it, but other POSIX systems differ, and the code would encode a platform detail.
- Confirm with an `lstat` after any non-absent open failure: errno-independent; the `lstat` reads no content, so its own staleness is harmless.

**Chosen:** confirm with `lstat`. CI runs only on `ubuntu-latest`, so macOS errno behaviour is not exercised there; this removes the dependency on it.

**What should integrity-digest record when a file became a symlink mid-call?**
- Throw (exit 2, `verification-unavailable`): fail-closed but reports "could not verify" for what is a detectable tamper.
- Record a symlink record, as a pre-check at open time would have: the diff then names it `symlink swapped`, exit 1, the same outcome as the static swap the selftest already covers.

**Chosen:** record the symlink record; throw only if the `readlinkSync` that follows fails.

**What should integrity-digest do with a directory or special file where a file was expected?**
- Add a manifest record kind: a schema change to d1, outside this ticket.
- Throw: fail-closed through every existing caller, and removes today's FIFO hang.

**Chosen:** throw.

**What about the dead `digestLeaf`?**
- Convert it: keeps unused code.
- Delete it: nothing calls or exports it.

**Chosen:** delete it.

**How is the race tested deterministically?**
- A real concurrent swap loop: flaky, and a pass proves little.
- A swap-on-first-touch stub: wrap `lstatSync` and `openSync` on the `node:fs` module object. On the first call of either that names the target path, swap the file for a symlink (or FIFO) at the moment that makes the swap profitable: after a real `lstat` returns (so a pre-check sees the regular file), or before delegating an `open` (so an implementation with no pre-check opens the swapped path). Every later call delegates unchanged. This reproduces "the swap landed between any check and the read" every time, whichever valid implementation is built, with no timing.

**Chosen:** the swap-on-first-touch stub, run in-process and restored after each test. The fixture makes the swap profitable to an attacker: the on-disk file holds bytes A, the symlink target holds bytes B, and the claim or held manifest carries B's digest. The pre-change code follows the link and reports a clean `match` or `digest-verified`. The fixed code always opens the already-swapped path, so it refuses the link (`not-regular-file`, `symlink swapped`) or, for a FIFO swap, classifies it as not regular. The assertion is "never clean, and B's digest never appears as the on-disk digest". Because the stub only reaches code that calls `fs.lstatSync` and `fs.openSync` through the `node:fs` module object at call time, the new module and both hashers must call them that way (never a destructured binding captured at load), and every race test asserts its stub fired (a call counter of at least one for the target path, and the path changed kind after the call), so a test that never reached the window fails instead of passing vacuously. The race tests drive only entry points main already exports (`cmdEvidence` in-process with captured stdout for the evidence half; `buildManifest`, `diffAgainstManifest` and `verifyAndRecord` for integrity-digest), so the same test file loads and runs unchanged against the pre-change modules. No export is added for testing. `fs.constants` properties are non-writable, so the "missing constant" tests pass a constants object into the leaf read through an optional parameter (the injectable-dependency idiom `resolveHasher` and `atomicWriteVerdictBytes` already use).

**Should the parent-directory race be fixed here?**
- Fix here: needs a mechanism Node 20 does not provide directly; widens a Low-priority hardening into a design task.
- Exclude and file a ticket: keeps this ticket to the named window and records the residual risk.

**Chosen:** exclude, and record the parent-component race as discovered scope at build time so it is filed as its own ticket (see OUT OF SCOPE).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:** none. Facts the spec relies on were checked on main at `61e84b13`: FAFF-1397 (#1124) is merged and main's `evidence.js` and `test/evidence-return.test.mjs` are identical to the FAFF-1397 worktree copies; `cliPosixGuard` refuses win32; `fs.constants.O_NOFOLLOW` and `O_NONBLOCK` are numbers on Linux under Node 22, and a no-follow open of a symlink fails with `ELOOP`, of a FIFO succeeds without blocking, and of a directory succeeds with `fstat` reporting a directory.

## 8. DONE

### From WHY
- [ ] Neither `evidence.js` nor `integrity-digest.js` hashes bytes obtained by a by-path `readFileSync` of an evidence or member path; every hashed byte comes from a leaf read whose `fstat` reported a regular file.
- [ ] No new result string, park cause, manifest field or `MANIFEST_VERSION` change is introduced.

### From WHAT
- [ ] A new helper-only module under `plugin/skills/faff/bin/lib/` carries a `region:governance` banner, requires no local module from the factory region, and exports the leaf read with the `LeafRead` shape in section 3.
- [ ] `evidence.js` and `integrity-digest.js` both require that module, and `faff regions check` exits 0.
- [ ] The leaf read opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` and throws without opening when the constants object it is given lacks a numeric `O_NOFOLLOW`, and separately when it lacks a numeric `O_NONBLOCK` (two unit tests, each passing a constants object missing one).
- [ ] Leaf read unit tests: a regular file returns `regular` with its exact bytes; a symlink to a regular file returns `symlink` with null bytes; a directory returns `directory`; a FIFO with no writer returns `other` without blocking; a missing path and a path under a regular file return `absent`.

### From HOW (behaviour)
- [ ] Leaf read called directly on a symlink whose target holds valid JSON returns `symlink` and never the target's bytes.
- [ ] `faff evidence verify-return` (driven through `cmdEvidence`) under the swap-on-first-touch stub on `review-verdict.json` (on-disk bytes A, target and claim bytes B) returns verdict `mismatch` with `review-verdict.json` in `tampered_paths`, a row result of `not-regular-file`, and a `disk_sha256` that is not B's digest.
- [ ] `faff evidence return` (driven through `cmdEvidence`) under the same stub throws the `review-verdict.json is not a regular file` fault; it never returns B's digest.
- [ ] `diffAgainstManifest` under the swap-on-first-touch stub on `run-ledger.json` (held manifest records B's digest, on-disk bytes A, target bytes B) returns an entry for `run-ledger.json`.
- [ ] The same stubbed swap on a sub-leaf of `corrective/` returns an entry naming `corrective/<file>`, and on `events.jsonl` returns an entry for `events.jsonl`.
- [ ] A FIFO at a member path makes `buildManifest` throw a fault naming the path, and `faff integrity-digest snapshot` exits 2 without hanging.
- [ ] `verifyAndRecord` over a held manifest when a member has become a FIFO records `verification-unavailable` and exits 2.
- [ ] `digestLeaf` is removed from `integrity-digest.js`.
- [ ] Each new race test fails when run against the pre-change modules, and fails on its behavioural assertion (the pre-change code reports a clean `match` or `digest-verified`), never on a load error, missing export or `TypeError`. The build agent records each failing assertion message in the PR description.
- [ ] Each race test asserts its swap stub fired (call counter at least one for the target path, and the path changed kind after the call); the new module and both hashers reach `lstatSync` and `openSync` through the `fs` module object, never a destructured binding.

### From HOW (agreement and regressions)
- [ ] For one stable regular `ac-checklist.json`, a test asserts `faff evidence return`'s sha256, the per-issue `faff integrity-digest snapshot` sha256 for `<issue>/ac-checklist.json`, and `faff integrity-digest hash` over the file's bytes are equal.
- [ ] `faff integrity-digest --selftest` and `faff evidence --selftest` pass.
- [ ] `test/evidence-return.test.mjs`, `test/integrity-digest.test.mjs`, `test/corrective.test.mjs`, `test/bundle.test.mjs` and `test/merge-gate-controlflow.test.mjs` pass unchanged apart from added tests.
- [ ] A snapshot of a stable fixture tree is byte-identical before and after the change.

### From OUT OF SCOPE
- [ ] The parent-component (intermediate directory) symlink race is recorded as a `confidence: concrete` entry in `discovered-scope.json` and named in the PR description.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Make a run dir under .faff/runs/ with <issue>/ac-checklist.json and <issue>/review-verdict.json
  2. Run faff evidence return; capture the line L
  3. Run faff integrity-digest snapshot --issue <issue>; confirm its two per-issue sha256 values equal those in L
  4. Pipe L into faff evidence verify-return; expect exit 0, verdict agree
  5. Replace review-verdict.json with a symlink to an identical copy
  6. Pipe L into verify-return again; expect exit 1, review-verdict.json row not-regular-file
  7. Run faff integrity-digest verify against the step 3 manifest; expect exit 1 naming review-verdict.json symlink swapped
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Appetite `high`, read from `.faff/config.yaml`. This critique only surfaces findings; it makes no tracker writes.

**Verdict:** buildable as one ticket. No split, merge or rehome is needed. Two minor sequencing notes and one dependency to wire at build time.

### Right-sized? (principle 4)

No issues.

- **What's there:** one outcome. Every hashed byte comes from a single no-follow descriptor read, in both hashers, through one shared primitive. The spec rates it `build-tier: complex`: a new governance module, two hashers, five live read sites, one dead function to delete, and about 15 DoD checks, including race tests.
- **Why it stays one ticket:** at first look, the `evidence.js` half and the `integrity-digest.js` half seem separable. They aren't independent. Obligation 6 depends on both hashers producing the same leaf digest, and the agreement test spans both. Shipping one half alone would leave the hashers classifying paths differently, which is the drift the ticket exists to prevent.
- **Size note:** this sits at the top of the 1 to 3 day band. Most of the weight is on the `integrity-digest.js` side (six caller paths, plus the new FIFO and directory fault). If the build runs long, look for the overrun there. It does not mean the ticket should have been split.

### Workstream fit? (principles 1 + 5)

No issues.

- **What's there:** no project, Backlog, Low priority, discovered scope from FAFF-1397.
- **Why that's fine:** project-less Backlog is this lens's default landing for discovered work. The ticket has one cohesive outcome: a tamper can't read as clean through a final-component symlink swap. It has no "while we're at it" items. Intermediate directories, other by-path reads, special-file manifest records and Windows are all fenced off in OUT OF SCOPE, each with an extension point.
- **Later, not now:** a future rehome pass could group this with the parent-component follow-up (below) under an outcome such as "evidence digests can't be redirected by a same-uid lane". Two tickets are too thin to form a project today.

### Deps surfaced? (principle 6)

One item to wire at build time, plus one contention note.

- **Parent-component race follow-up (to wire):**
  - **What's there:** the spec has the build record the intermediate-directory symlink race in `discovered-scope.json` as `confidence: concrete`, so the orchestrator files it. That follow-up would build on this ticket's shared primitive ("the new shared read primitive is where a descriptor-anchored walk would live").
  - **Why it matters:** if the follow-up is filed with no link, it can be pulled "ready" before the primitive it extends exists.
  - **What to do:** when the orchestrator files it, set the new ticket `blockedBy` FAFF-1400. Don't add a placeholder link now.
- **FAFF-1397 (`relatedTo`, Done, merged as #1124):** correctly left as a non-blocking relation. The spec checked main at `61e84b13`, which includes #1124.
- **Contention, not a dependency (PR #1086, FAFF-1261, open, last updated 2026-10-20):**
  - **What's there:** #1086 changes `evidence.js` (+39/-4), and it was opened before #1124 landed. Its diff doesn't touch `hashRegularFile` or `lstatOrNull`, so there's no semantic dependency and no blocker link is warranted.
  - **Consequence:** whichever of #1086 and FAFF-1400 merges second may have to resolve a textual conflict in `evidence.js`.
  - **What to do:** if both are queued in the same drain, sequence FAFF-1400 after #1086 lands. If FAFF-1400 is built first, rebase before merging.
- **FAFF-1401 (sibling, test flake):** no overlap. It shares only the FAFF-1397 relation and touches none of the same files.

### Risk profile? (principle 7)

Low. The risky parts are already de-risked in the spec, so no separate spike is needed.

- **Vacuous race tests:** this is the main risk, and the spec names it. A DoD item requires every race test to fail against the pre-change modules, with that check recorded in the PR. I confirmed one precondition on main: both modules call `fs.lstatSync` through the `fs` module object (`evidence.js:1181`, `integrity-digest.js:71/85/103`), not a destructured binding. A stub on `node:fs` will therefore reach the pre-check. Keep that DoD item. It is the falsifier.
- **Behaviour change beyond symlinks:** today, a FIFO at a member path makes the hasher hang. After this change it becomes a fault (exit 2, `verification-unavailable`, refused rebaseline, held corrective fold). That is the right fail-closed direction, and the spec traces it through all six callers. Reviewers should still treat it as an intended user-visible change, not a side effect.
- **Node version (minor):** the spec says the `O_NOFOLLOW`, `O_NONBLOCK`, `ELOOP` and FIFO behaviour was checked on Node 22. CI runs `node-version: 20` (the adopter floor). The constants come from the OS and libuv, so drift is unlikely. The race and FIFO tests will exercise Node 20 in CI anyway. No action unless those tests behave differently there.
- **Residual risk is recorded, not hidden:** the parent-component race stays open after this ships, and the spec says so in OUT OF SCOPE and in a failure mode. That honest bound matches a Low-priority hardening.

### Findings

| # | Principle | Diagnosis | Recommended action |
|---|---|---|---|
| 1 | 6 (surface deps) | The parent-component follow-up FAFF-1400 is set to file at build time would extend this ticket's primitive, but nothing yet guarantees it gets a blocker link. | When the orchestrator files it from `discovered-scope.json`, set it `blockedBy` FAFF-1400. |
| 2 | 2 + 7 (sequencing) | FAFF-1261 (PR #1086) also edits `evidence.js` and predates #1124, so a textual conflict is likely. There is no semantic dependency. | In a shared drain, order FAFF-1400 after #1086, or rebase before merging. Don't add a blocker link. |
| 3 | 7 (risk) | Race-test vacuity is the main way this ticket could look done without being done. The spec already gates on it, and `fs.lstatSync` is reached through the module object, so the stub is feasible. | Keep the "fails on pre-change code" DoD item, and require its evidence in the PR description. |

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
