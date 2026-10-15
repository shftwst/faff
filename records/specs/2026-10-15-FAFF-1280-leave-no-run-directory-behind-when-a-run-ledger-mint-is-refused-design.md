# Leave no run directory behind when a run-ledger mint is refused (FAFF-1280)

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1280.

This spec is for the build agent picking up FAFF-1280 and for its reviewers. It makes a refused `faff run-ledger init-interactive` or `init-self-drain` remove the empty run directory it created, so a refused mint leaves nothing under `.faff/runs/`.

## 1. WHY

**The idea the rest depends on.** Both verbs create the run directory first and then write the ledger through the shared serialiser (`mutateLedgerUnderLock`, FAFF-1258). When the serialiser refuses, nothing has been written into the directory yet: the lock file is unlinked in `withFileLock`'s `finally`, and the genesis event is only emitted after a successful ledger write. So the directory is empty, and the fix is to remove that empty directory, and only it, whenever the ledger did not land.

**Problem.** Today a refused mint (exit 1 on `LEDGER_SCHEMA`, `LEDGER_SCHEMA_VERSION` or `LEDGER_SCHEMA_UNAVAILABLE`, or exit 3 on a lock failure) leaves an empty `.faff/runs/<run-id>/`. Reproduced on main (4839e550) with a plugin copy missing `contracts/evidence-v0.3/anchor-manifest.json`: both verbs exit 1 with `no ledger minted` and leave `.faff/runs/RUN-A/` and `.faff/runs/RUN-B/` empty. This change removes the directory on every exit where the ledger did not land.

**Premise correction.** The ticket says the refused mint also leaves a genesis `events.jsonl` and that ambient resolution can pick the directory up as a live run. On main neither holds for these exits: `emitGenesisRunStart` runs only after a written ledger, and both ambient resolvers (`latestRunDir` in `shared-infra.js`, `guardCandidateDir` in `run-ledger.js`) skip a directory without `run-ledger.json`. The real costs are:

- a retry of `init-self-drain --id X` after a refusal exits 3 (`run dir already exists`) instead of minting;
- empty directories accumulate in `.faff/runs/` and break the stated invariant in `state.js` that `runDirsNewestFirst(root)[0]` equals `latestRunDir(root)`;
- the mint does not meet the rule FAFF-1261 sets for the anchor mint: a refused mint writes nothing.

**Design principles.**

- **Remove only what this invocation created.** A directory that existed before the call (possible for `init-interactive --id <existing>`, whose `mkdirSync` is recursive) is never removed.
- **Never delete content.** Removal is a non-recursive `rmdir`. If the directory is not empty, it stays and the mint says so on stderr.
- **Exit codes and messages stay as they are.** The cleanup adds at most one stderr line and never changes the exit code.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/run-ledger.js` `initInteractive` (~268), `initSelfDrain` (~391) | JS | The two mints this changes |
| `plugin/skills/faff/bin/lib/heartbeat.js` `mutateLedgerUnderLock` (~345), `isLedgerSchemaError` (~330) | JS | The serialiser whose refusal triggers cleanup; unchanged |
| `plugin/skills/faff/bin/lib/fs-lock.js` `withFileLock` (~78) | JS | Unlinks the lock file in `finally`, so a refused write leaves the directory empty |
| `plugin/skills/faff/bin/lib/shared-infra.js` `latestRunDir` (~243) | JS | Ambient resolver; already skips ledger-less directories |
| `test/run-ledger-serialiser.test.mjs` (~228) | JS test | The plugin-copy-without-manifest pattern that forces `LEDGER_SCHEMA_UNAVAILABLE` |

**Scope.** A cleanup at the two run-ledger mint sites; no change to the serialiser, the ledger shape, the lock, or any reader.

## 2. OUT OF SCOPE

- **`init-self-drain` genesis failure (ledger written, no chain, exit 3).** Why excluded: the ledger has landed, so cleanup would mean deleting a written ledger, and that directory is ambient-resolvable with a `running` L3 owner that trips the higher-level guard on the next mint. Whether to delete it or mark it abandoned is a separate decision. Extension point: the `landed` flag in `initSelfDrain`; a follow-up ticket is recommended.
- **`init-interactive` genesis failure.** Why excluded: same as above; today `emitGenesisRunStart` throwing there is uncaught. Extension point: the same place in `initInteractive`.
- **`faff lights-out` mint (`mintLightsOut`).** Why excluded: the ticket names the two run-ledger verbs; `mintLightsOut` does not catch serialiser errors at all, so it needs its own refusal shape first. Extension point: `discardUnmintedRunDir` is exported so `mintLightsOut` can call it after `claimRunDir`.
- **Removing an empty `.faff/runs/` or `.faff/` created by the same call.** Why excluded: an empty parent is not a run and nothing resolves it; the AC concerns entries under `.faff/runs/`.
- **Ledger locking.** Why excluded: FAFF-1281 owns the lock around bundle-recover's restore; this change takes no lock and edits no lock code.
- **Switching `init-interactive` to an exclusive `mkdir`.** Why excluded: it changes successful-mint behaviour for an existing `--id`, which the AC keeps unchanged.

## 3. WHAT

**Vocabulary.**

| Term | Meaning |
|---|---|
| Refused mint | Any return or throw from `initInteractive` / `initSelfDrain` after the run directory was created and before `mutateLedgerUnderLock` returned `written: true` |
| Created by this call | `init-self-drain`: the exclusive `mkdirSync(runDir)` succeeded. `init-interactive`: the recursive `mkdirSync` returned a value other than `undefined` (Node returns the first directory it created, which may be an ancestor such as `.faff/`, and `undefined` when nothing was created). Use this return value, not an `existsSync` check beforehand, which races |
| Landed | `mutateLedgerUnderLock` returned `{ written: true }` |

**New helper (exported from `run-ledger.js`).**

```
FUNCTION discardUnmintedRunDir(runDir, command) -> void
  # command: "init-interactive" | "init-self-drain", used in the stderr prefix
  1. rmdir(runDir), non-recursive
  2. ON ENOENT: return silently
  3. ON any other error (ENOTEMPTY, EPERM, ...):
       stderr "faff run-ledger <command>: could not remove <runDir> (<error code>); it holds no ledger\n"
       return  # never throws, never changes the caller's exit code
```

**Chosen:** remove the empty directory after a refusal, not validate before creating it. Validating first would need a second entry into the serialiser's steps 3 to 6, and the lock-failure exits would still need cleanup. One helper covers every refusal.

**Chosen:** a non-recursive `rmdir`. The directory is empty on every refusal path, so a non-empty directory means something else wrote into it, and that content is not this mint's to delete.

## 4. HOW

Summary: record whether this call created the directory and whether the ledger landed; on every exit where it created the directory and the ledger did not land, call `discardUnmintedRunDir`.

```
PROCEDURE mint(runDir, command):
  # init-interactive
  created := mkdirSync(runDir, recursive) returned a non-undefined path
  # init-self-drain (after its existing EEXIST refusal, which returns before this point)
  created := true

  landed := false
  TRY:
    res := mutateLedgerUnderLock(runDir, () => ledger)        # unchanged call
    landed := res.written
    existing exits stay as they are: schema refusal -> 1, written:false -> 3,
      LEDGER_LOCKED or other error -> 3 (self-drain) or rethrow (interactive)
  FINALLY:
    IF created AND NOT landed: discardUnmintedRunDir(runDir, command)
  # genesis emit, runner identity and stdout follow only when landed, exactly as today
```

The `FINALLY` scope ends at the ledger write. The genesis emit and later steps sit outside it, so a genesis failure is not cleaned up (out of scope).

**Ordering of stderr.** The existing refusal line prints first, then the cleanup line if removal failed. Both go to stderr; stdout stays empty on refusal, so `export FAFF_RUN_DIR="$(faff run-ledger ...)"` still captures nothing.

**Edge cases.**

- `init-interactive --id <existing dir>`: `created` is false; a refusal leaves the directory and its contents untouched.
- Lock file left behind (the `unlinkSync` in `withFileLock` is best-effort): `rmdir` fails `ENOTEMPTY`, the directory stays, one stderr line names it. It holds no ledger, so no resolver finds it.
- A non-schema error rethrown by `init-interactive` (for example `LEDGER_LOCKED`): cleanup runs, then the error propagates as today.
- Two concurrent `init-interactive` calls with the same `--id`: if the first is refused and removes the empty directory just before the second writes its ledger, the second fails loudly on the missing directory. Nothing is deleted and nothing reports success, so this is accepted rather than closed with an exclusive `mkdir` (see OUT OF SCOPE).
- `resolveMintBaseSha` runs before the write and writes nothing, so it does not affect emptiness.

**Anti-pattern:** `fs.rmSync(runDir, { recursive: true })`. Why: it would delete content another writer put in the directory and would remove a pre-existing `--id` directory's contents.

**Anti-pattern:** cleaning up inside `mutateLedgerUnderLock`. Why: the serialiser serves every ledger write; only the mint knows it created the directory.

## Scenarios

```
Given a plugin install whose contracts/evidence-v0.3/anchor-manifest.json is missing
  and a repo with no .faff/runs/RUN-B
When `faff run-ledger init-self-drain --id RUN-B --root <repo>` runs
Then it exits 1 with the existing "no ledger minted" line, and .faff/runs/RUN-B does not exist
And when the manifest is restored and the same command runs again, it exits 0 and mints RUN-B
```

```
Given .faff/runs/RUN-A already exists and holds a file keep.txt
  and the manifest is missing
When `faff run-ledger init-interactive --issue FAFF-1 --id RUN-A --root <repo>` runs
Then it exits 1, and RUN-A and keep.txt are unchanged
```

- A refused mint never removes anything other than the empty directory it created.

## 5. DESIGN DECISION RATIONALE

**Clean up after, or validate before creating the directory?**
- Validate first: no directory on a schema refusal, but adds a second path into the serialiser and still leaves lock-failure exits needing cleanup.
- Clean up after: one helper, every refusal path.

**Chosen:** clean up after, with `discardUnmintedRunDir`.

**Recursive or non-recursive removal?**
- Recursive: always succeeds, can delete content that is not the mint's.
- Non-recursive: fails safe on a non-empty directory.

**Chosen:** non-recursive, with one stderr line when it cannot remove.

**Where do the tests go?**
- Extend `test/run-ledger-init-interactive.test.mjs` and `test/run-ledger-init-self-drain.test.mjs`: FAFF-1261 plans to migrate fixtures in those files, so edits there risk conflicts.
- A new file.

**Chosen:** a new `test/run-ledger-mint-refusal.test.mjs`.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None.

**Assumptions.**

- **Assumes:** `mutateLedgerUnderLock` leaves no file in a fresh run directory when it throws or returns `written: false` (the lock is unlinked in `withFileLock`'s `finally`; `atomicWriteLedger` runs only after validation). Validate: in the new test, assert the directory was empty by checking it no longer exists after the refusal.
- **Assumes:** FAFF-1281 does not move the lock file out of `withFileLock` or add files to the run directory before the ledger write. Validate: read `heartbeat.js` and `fs-lock.js` on the branch base before building.

## 7. DONE

### From WHY
- [ ] After a refused `init-interactive` or `init-self-drain` (forced by a missing `anchor-manifest.json`), no new entry exists under `.faff/runs/`
- [ ] A retry of `init-self-drain --id X` after a refusal, with the schema restored, exits 0

### From WHAT
- [ ] `discardUnmintedRunDir(runDir, command)` is exported from `run-ledger.js`, removes an empty directory, returns silently on `ENOENT`, and on a non-empty directory leaves it and its contents unchanged and writes one stderr line naming the directory and the error code
- [ ] `discardUnmintedRunDir` never throws (unit test with a non-empty directory)

### From HOW
- [ ] Both mints call `discardUnmintedRunDir` on every exit between creating the directory and a landed ledger write, including the `written: false` exit and, for `init-interactive`, before a rethrown error. The `written: false` and `LEDGER_LOCKED` exits are not reachable from the CLI, so test them in-process: replace `mutateLedgerUnderLock` on the `heartbeat.js` exports before requiring `run-ledger.js` (it destructures at require time), with one stub returning `{ written: false }` and one throwing an error with code `LEDGER_LOCKED`; assert the exit code is unchanged and the directory is gone
- [ ] `init-interactive --id <existing dir>` refused: the directory and its contents are unchanged
- [ ] Exit codes and the existing refusal lines are unchanged; stdout is empty on refusal
- [ ] A successful mint is unchanged: the existing `test/run-ledger-init-interactive.test.mjs`, `test/run-ledger-init-self-drain.test.mjs` and `faff run-ledger --selftest` pass unedited

### From Scenarios
- [ ] Both Scenarios pass as tests in the new `test/run-ledger-mint-refusal.test.mjs`

### Integration smoke test

```
1. Copy plugin/skills/faff to a temp dir without node_modules; delete contracts/evidence-v0.3/anchor-manifest.json
2. git init a temp repo
3. <copy>/bin/faff run-ledger init-interactive --issue FAFF-1 --id RUN-A --root <repo>  -> exit 1
4. <copy>/bin/faff run-ledger init-self-drain --id RUN-B --root <repo>                  -> exit 1
5. readdir(<repo>/.faff/runs) is empty
6. Run the real plugin's init-self-drain --id RUN-B --root <repo>                       -> exit 0, RUN-B/run-ledger.json exists
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues. One helper and two call sites plus one test file: well under a day.
- **Workstream fit?** No issues. A follow-up from the FAFF-1258 build under FAFF-1255 (anchor evidence); it serves the same outcome, a refused write leaves nothing behind.
- **Deps surfaced?** No blocker needed. FAFF-1258 (Done) is linked as related. FAFF-1261 plans fixture edits in `test/run-ledger-init-*.test.mjs`; the new tests go in their own file, so the two do not need ordering. FAFF-1281 touches bundle-recover's lock only; this change takes no lock. Two related gaps found during explore sit outside this ticket (genesis-failure leftovers in both verbs, and `mintLightsOut` not catching serialiser refusals); they are named under OUT OF SCOPE and need their own tickets if wanted.
- **Risk profile?** No issues. No new integration; the only risk is deleting the wrong thing, which the non-recursive `rmdir` and the created-by-this-call check close.

confidence: high
build-tier: standard
spec-review: approve
