# Spec — FAFF-757: Harden run-id minting against same-second collisions

> Spec: faffter-dark-nlspec · 2026-08-09 · interactive · confidence: high. Full spec on Linear FAFF-757.

This spec directs the build agent fixing FAFF-757. It hardens the L4 run-directory mint in `plugin/skills/faff/bin/lib/lights-out.js` so two same-machine runs of the same mode started in the same UTC second can never silently share one run directory and corrupt its `run-ledger.json` / `events.jsonl`.

## 1. WHY — Problem and Principles

**The load-bearing model.** A run directory's *name* is currently also its *uniqueness claim*, but the claim is never enforced. The mint builds a name from a one-second-resolution timestamp and then creates the directory with `mkdirSync(..., { recursive: true })` — a call that succeeds silently when the directory already exists. So a name collision is not detected; it is absorbed, and two runs proceed as if they each own a directory that in fact they share. The fix makes the directory-create *exclusive* (a collision throws instead of succeeding) and then decides, per mint path, what to do with that throw.

**Problem statement.** Today two runs of the same mode entering `mintLightsOut` in the same UTC second compute an identical id (`run-<YYYYMMDD-HHMMSS>-lights-out`), and `recursive: true` lets the second `mkdirSync` succeed against the first's directory — after which both write the same ledger and event log, corrupting both. This change replaces the silent create with an exclusive one and reacts to a collision deterministically: auto-mint re-mints a distinct id, a caller-supplied id fails loud.

**Design principles.**

**The directory create is the exclusivity primitive — do not add a second lock artifact.** A non-recursive `mkdirSync` of the leaf is itself atomic: it throws `EEXIST` if the name is taken. That throw *is* the collision signal. A separate lock file (the `fs-lock` `wx` idiom) to guard a create that is already atomic would be redundant machinery.

**Preserve the newest-run resolver's ordering contract.** `latestRunDir` / `sortRunDirsByMtimeDesc` (`shared-infra.js:193-226`) order run directories by directory mtime descending, with a lexical-name tie-break the header itself calls "never load-bearing," and never parse the id's internal shape. The fix must keep exactly one directory per run and place any new id segment *after* the timestamp, so both mtime ordering and the tie-break are undisturbed.

**Two runs must never share a directory — the only acceptable outcomes are two directories or a loud failure.** Silent sharing is the defect; every branch resolves to one of those two states, never back to sharing.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/lights-out.js:899-910` | Node.js | `mintLightsOut` — the single auto-mint site and the `--id` consumer being hardened |
| `plugin/skills/faff/bin/lib/shared-infra.js:193-226` | Node.js | `sortRunDirsByMtimeDesc` / `latestRunDir` — the ordering contract to leave intact |
| `plugin/skills/faff/bin/lib/contain.js:74-81` | Node.js | `isSafeRunId` (exported) — the traversal/control-char predicate to validate `--id` with |
| `plugin/skills/faff/bin/lib/fs-lock.js:43-85` | Node.js | The `wx` exclusive-create idiom — the *rejected* mechanism, kept as reference |
| `plugin/skills/faff-beep-boop/SKILL.md:340` | Prose | beep-boop's L3 prose-constructed `-beepboop-<mode>` id — the second mint surface |
| `plugin/skills/faff/bin/lib/validate-adapters.js:60` | Node.js | `STRAY_TRANSCRIPT` lint — its `\b` after `beepboop\|lights-out` tolerates a trailing suffix |

**Scope statement.** A mint-side hardening of the L4 run-directory creation path and its one prose sibling; it does not touch the resolve-side stat-race work (FAFF-578) in `latestRunDir`.

## 2. OUT OF SCOPE

- **Unifying all run-id minting inside the CLI** (beep-boop stops constructing ids in prose; a CLI owns both name and exclusive create). Why: larger refactor of beep-boop's L3 ledger-ownership model, and the bounded fix already closes the collision on every path. Extension point: a future `faff run-mint`-style subcommand reusing the exclusive-create helper this ticket extracts.
- **The `--resume` re-entry path (`lights-out.js:1013-1021`).** Why: resume requires a pre-existing directory and never creates one — no collision risk.
- **FAFF-578's resolve-side stat-race.** Why: that hardens *reading* the newest run under churn; this hardens *writing* a unique run. `latestRunDir` is the shared seam both respect.
- **Serialising ledger/events writes.** Why: already lock-serialised under `run-ledger.json.lock` / `events.jsonl.lock`; only the dir/id mint is unguarded.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Auto-mint | No `--id`; the CLI derives the id from the clock (`run-<stamp>-lights-out`). |
| Supplied-id mint | A caller passes `--id <run-id>`; the CLI must honour that exact id. |
| Base id | The collision-free-common-case id, byte-identical to today's format. |
| Re-mint | Deriving a fresh distinct id after an exclusive-create collision on the auto-mint path. |

**The exclusive-create helper (new, extracted for testability).**

```
FUNCTION claim_run_dir(runs_parent, base_id, { supplied }) -> runDir:
  # runs_parent is <root>/.faff/runs ; ensured to exist by the caller
  # supplied = true -> caller-owned --id ; false -> auto-mint
  # returns the absolute path of the exclusively-created directory, or throws
```

Contract:
- Clean create → returns `join(runs_parent, base_id)`, created id **byte-identical** to `base_id`.
- `supplied: false` + collision → re-mints with an entropy suffix and retries; distinct directory guaranteed or a loud throw on (effectively impossible) exhaustion.
- `supplied: true` + collision → throws loud; never re-mints, never shares.

**Id shapes.**

```
auto_clean   # run-<YYYYMMDD-HHMMSS>-lights-out                (unchanged; common case)
auto_remint  # run-<YYYYMMDD-HHMMSS>-lights-out-<entropy>      (only on collision)
beepboop     # run-<YYYYMMDD-HHMMSS>-beepboop-<mode>-<entropy> (prose path)

CONSTRAINT: timestamp stays the leading sortable segment; any <entropy> strictly AFTER
            the descriptive tail, so sortRunDirsByMtimeDesc ordering and the
            STRAY_TRANSCRIPT \b match both hold.
```

**Design decisions.**

**Exclusivity mechanism.** **Chosen:** non-recursive `mkdirSync(runDir)` (with `.faff/runs` ensured first) — the run directory *is* the resource whose name must be unique, so its own atomic create is the exclusivity token; `EEXIST` is the collision signal, no separate lock artifact needed.

**Collision policy per mint path.** **Chosen:** auto-mint re-mints on `EEXIST` (fresh entropy suffix, bounded retry) so `faff lights-out` never fails on a benign same-second race; a supplied `--id` fails loud on `EEXIST` (non-zero exit, dir untouched, message pointing at `--resume`) — a caller reusing an id is an error or a genuine re-entry that must go through `--resume`, and silently re-minting a caller's id breaks the downstream reference they hold.

**Entropy source.** **Chosen:** a short `crypto.randomBytes` hex suffix after the descriptive tail, fresh per retry. Rationale in §6.

**`--id` validation.** **Chosen:** run a supplied `--id` through `isSafeRunId` at mint and fail loud on rejection — closes a latent path-traversal gap at the same consume site.

**beep-boop prose scope.** **Chosen (bounded):** add an entropy suffix to the prose-constructed id at `SKILL.md:340`; the deeper CLI-unification is Out of Scope (§2).

## 4. HOW — Behavior

**Architecture.** `mintLightsOut` keeps computing `nowIso` and the timestamped base id as today. The one change at the create step: ensure the `.faff/runs` parent exists, then delegate the leaf create to `claim_run_dir`, which applies the per-path policy. `--id` is validated before it reaches `claim_run_dir`. Everything downstream of the returned `runDir` (ledger write, banner, run-start event, budget baseline) is unchanged and uses whatever id `claim_run_dir` returned.

```
PROCEDURE mint_dir(root, suppliedId):
  1. runs_parent = join(root, ".faff", "runs")
  2. mkdirSync(runs_parent, { recursive: true })      # idempotent; parent only
  3. IF suppliedId present:
     a. IF NOT isSafeRunId(suppliedId): fail loud (usage error, nothing minted)
     b. runDir = claim_run_dir(runs_parent, suppliedId, { supplied: true })
  4. ELSE:
     a. base = "run-" + stamp + "-lights-out"          # byte-identical to today
     b. runDir = claim_run_dir(runs_parent, base, { supplied: false })
  5. RETURN runDir
```

```
PROCEDURE claim_run_dir(runs_parent, base_id, { supplied }):
  1. TRY mkdirSync(join(runs_parent, base_id))          # non-recursive → atomic
     ON success: RETURN that path
     ON error e where e.code != "EEXIST": rethrow         # real fs fault stays loud
  2. # EEXIST — the name is taken
     IF supplied: throw loud("run-id <base_id> already exists — use --resume to re-enter")
  3. FOR attempt IN 1..MAX_REMINT:                        # MAX_REMINT small, e.g. 5
        candidate = base_id + "-" + randomHex()           # entropy AFTER the tail
        TRY mkdirSync(join(runs_parent, candidate))
           ON success: RETURN that path
           ON EEXIST: continue
           ON other error: rethrow
     throw loud("could not mint a unique run dir after N attempts")   # effectively unreachable
```

**Edge cases.** Auto-mint fallback chain: clean → success; `EEXIST` → re-mint → success; exhaustion → loud throw. Supplied `--id` unsafe → fail loud, nothing created. Supplied `--id` safe + collides → loud `EEXIST`-class failure, existing dir untouched, message names `--resume`. Non-`EEXIST` fs error (`EACCES`/`ENOSPC`) → rethrown unchanged (this ticket narrows only the `EEXIST` outcome).

**Failure modes.**
- **The failure:** a reviewer assumes prose entropy on the beep-boop path is as strong as the CLI's exclusive create. It is not — the prose path gains collision *avoidance* (distinct names) but not *detection* (no `EEXIST` check on an agent `mkdir`). **How you'd know:** the prose-format collision test shows two distinct dirs under normal entropy but can't demonstrate a *detected* re-mint. **What it means:** proceed — avoidance stops the corruption on the L3 path; the L4 path is fully detected; the residual is documented, not hidden.
- **The failure:** entropy in the wrong position (before the timestamp, or replacing the tail) breaks the resolver tie-break or the `STRAY_TRANSCRIPT` lint. **How you'd know:** the resolver ordering assertion flips, or `faff validate-adapters` stops flagging a pasted run-id. **What it means:** narrow — suffix strictly after the descriptive tail; asserted in Scenarios + DONE.

**Anti-pattern:** re-minting a caller-supplied `--id` on collision — it silently orphans the caller's handle and re-creates the ambiguity this ticket removes.
**Anti-pattern:** keeping `recursive: true` + a pre-check `existsSync` — check-then-create is not atomic; the exclusive create is the only race-free form.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given two auto-mint runs of the same mode entering the mint in the same UTC second
When each claims its run directory
Then two distinct run directories exist under .faff/runs, neither sharing a ledger or event log
```

```
Given a caller supplies --id naming a run directory that already exists
When the mint tries to claim it
Then the command exits non-zero, the existing directory is left untouched, and the message points at --resume
```

- The common single-run auto-mint case produces an id byte-identical to `run-<stamp>-lights-out` (no suffix without a collision).
- `sortRunDirsByMtimeDesc` returns the two colliding-second directories in a stable order, and `latestRunDir` resolves a single newest directory — unchanged for the non-colliding population.

## 6. Design Decision Rationale

**Exclusivity.** `fs-lock` `wx` is a proven idiom but adds a separate lock file with stale-takeover semantics built for serialising repeated access — more than a one-shot name claim needs. **Chosen:** non-recursive `mkdirSync` — the directory itself is the unique resource; its atomic create throws `EEXIST` with no extra artifact.

**Collision policy.** Auto-mint fail-loud would break `faff lights-out` on a benign race; supplied-id re-mint would silently change a caller's handle. **Chosen:** auto-mint re-mints (bounded, entropy); supplied `--id` fails loud → `--resume`. Each honours who owns the id.

**Entropy source.** Sub-second ms is still a truncation, not a guarantee; `process.pid` repeats if one process re-mints twice; `crypto.randomBytes` is collision-resistant per attempt, readable, and already an in-tree idiom (`heartbeat.js`, `queue-state.js`, `sentry-poller.js`). **Chosen:** a short `crypto.randomBytes` hex suffix, fresh per retry, after the tail. The exclusive create is the guarantee; entropy just makes the first retry almost always succeed.

**`--id` validation.** Currently consumed unvalidated at `lights-out.js:908`; an id with `..` or a separator would create a directory outside `.faff/runs`. **Chosen:** validate via the already-exported `isSafeRunId`, fail loud on rejection.

**Common-case id shape.** Always-append-entropy changes every id and fixture. **Chosen:** keep the base id byte-identical, add the suffix *only* on an actual collision.

**beep-boop prose scope.** (a) rely on CLI fail-loud is a non-starter — the L3 path mints by agent `mkdir`, no CLI throw to catch; (c) CLI-unification is the clean end state but a larger refactor (§2). **Chosen (bounded):** (b) add entropy to the prose id, `run-<stamp>-beepboop-<mode>-<entropy>`, entropy after `<mode>`.

## 7. Open Questions and Assumptions

**Open Questions.** None — all decisions resolved. The deeper CLI-unification is a scoped-out follow-up (§2), not a blocking decision.

**Assumptions.**
- **Assumes:** Node's non-recursive `fs.mkdirSync` throws `EEXIST` when the leaf exists. *Validation:* documented Node contract, already relied on by `fs-lock.js`'s `wx` open; the collision test passing is sufficient.
- **Assumes:** `crypto` and `Date` are available in the mint's runtime. *Validation:* confirmed — `crypto` required in sibling lib files; `Date.now`/`Date.parse` used within `lights-out.js`.
- **Assumes:** the run-id consumers that matter are the named contracts (`latestRunDir`/`sortRunDirsByMtimeDesc` ordering; the `STRAY_TRANSCRIPT` regex) plus `run-ledger.json` / `events.jsonl` filename keys — no consumer *parses* the id's internal shape. *Validation:* the build agent confirms this enumeration is exhaustive (grep run-id readers) before landing, per the methodology critique's de-risking note; FAFF-578's resolver is mtime-based and does not parse the id, so the format change does not couple the two tickets.

## 8. DONE — Definition of Done

### From WHY
- [ ] Two auto-mint runs resolving to the same base id in the same UTC second produce two distinct run directories, never a shared one.
- [ ] A supplied `--id` that collides fails loud (non-zero exit) with the existing directory untouched.

### From WHAT
- [ ] The create-with-policy logic is extracted into a helper callable without the clock or full preflight (testable in isolation).
- [ ] The clean auto-mint id is byte-identical to `run-<stamp>-lights-out`; the re-mint id is that base plus an entropy suffix placed after `-lights-out`.

### From HOW (behaviour)
- [ ] `.faff/runs` is ensured to exist, then the leaf directory is created non-recursively (atomic `EEXIST` on collision).
- [ ] Auto-mint on `EEXIST` re-mints with a fresh `crypto.randomBytes` suffix under a bounded retry; exhaustion throws loud.
- [ ] Supplied `--id` on `EEXIST` throws loud with a message naming `--resume`; never re-minted or shared.
- [ ] A supplied `--id` is run through `isSafeRunId`; a rejection fails loud, creating nothing.
- [ ] Non-`EEXIST` create errors are rethrown unchanged (no new swallowing).

### From HOW (edge cases / resolver contract)
- [ ] `sortRunDirsByMtimeDesc` / `latestRunDir` ordering is unchanged for the non-colliding population; exactly one directory per run.
- [ ] The `--resume` path and the common single-run path are behaviourally unchanged.

### From beep-boop
- [ ] `SKILL.md:340` prose mints `run-<stamp>-beepboop-<mode>-<entropy>` with entropy after `<mode>`; the `-beepboop-<mode>` prefix (hence `STRAY_TRANSCRIPT` matching and mtime ordering) is preserved.

### From tests
- [ ] A new test reproduces the same-second collision and asserts two distinct directories on the auto-mint path.
- [ ] A test asserts a colliding supplied `--id` fails loud with the directory untouched.
- [ ] A test asserts an unsafe supplied `--id` fails loud and creates nothing.

**Integration smoke test.**
```
Pre-create <root>/.faff/runs/run-<S>-lights-out.
claim_run_dir(runs_parent, "run-<S>-lights-out", { supplied: false })
  → a SECOND dir now exists whose name starts "run-<S>-lights-out-".
claim_run_dir(runs_parent, "run-<S>-lights-out", { supplied: true })
  → throws; no further directory created.
```

confidence: high

spec-review: approve
