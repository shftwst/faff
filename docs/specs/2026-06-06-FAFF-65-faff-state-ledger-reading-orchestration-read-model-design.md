# faff state — ledger-reading orchestration read-model (CLI)

This is the build spec for **FAFF-65**, the deferred local read-model sibling to `faff next` (FAFF-63). Audience: the build agent that will add a `state` subcommand to `skills/faff/bin/faff`, and the human reviewers gating the PR. It tells you what `faff state <issue>` must read, what it must emit, and how it composes with the now-shipped `faff next` engine.

## Already shipped against this surface

Related Done work on the same surface (the `faff` CLI + the run-ledger). None **supersedes** this ticket — `faff state` is the read-model FAFF-63 explicitly deferred, and it does not yet exist (verified: no `state` subcommand, no `cmdState`, no dispatch entry in `skills/faff/bin/faff`). Premise holds.

| Done ticket | What it shipped | Relation to FAFF-65 |
|---|---|---|
| **FAFF-63** (Done) | `faff next` — a **pure** transition function (`--status/--spec/--held/--parked/--blocked` → `{next,reason}`). Explicitly deferred `faff state`. | This ticket is that deferral. `faff state` produces the inputs `faff next` consumes. |
| **FAFF-64** (Done) | Wired the five consumers (beep-boop, prep, graft, tidy, gateway) to consult `faff next`; documented the shared state→flags mapping in the gateway. | Defines the **exact flag vocabulary** (`status/spec/held/parked/blocked`) `faff state` must emit so it slots into the same mapping. May later consume `faff state` on the autonomous path. |
| **runcheck** (shipped in the same CLI) | Reads `.faff/runs/<run-id>/run-ledger.json`, audits admitted-vs-outcomes completeness. | Precedent for ledger reading. `faff state` **reuses** its ledger helpers but does **not** subsume it (different shape — see OQ3). |

## 1. WHY — Problem and Principles

**Problem statement.** `faff next` is pure: the caller must already know the issue's `(status, spec, held, parked, blocked)` before it can compute the next step. On the autonomous / git-only path that state has to be assembled by hand from local sources every time, in prose, with no deterministic, testable contract. `faff state <issue>` makes that assembly a mechanical CLI read-model so the local slice can get an issue's resolved state without an MCP round-trip.

**Design principles** (each would cause an otherwise-valid implementation to be rejected):

- **Local-only, best-effort — the tracker stays source of truth.** The CLI has **no MCP/tracker access** (inherited from FAFF-63). `faff state` reads only local sources; it can never observe tracker status or labels. Every field it emits is therefore a **hint** that the interactive path overrides with authoritative tracker data. A field it cannot resolve locally is emitted as a typed "unknown", never guessed.
- **Deterministic tool, not prose.** Same local filesystem + same git state ⇒ same JSON, every run. This is exactly the deterministic-tools-over-prose tenet the run-ledger / `runcheck` / `faff next` line embodies. No LLM judgement in the subcommand.
- **Pure-adjacent, not pure.** Unlike `faff next` (a pure function of its flags), `faff state` deliberately *does* read the filesystem and shell `git` — that is its whole job. It still performs **no mutation** and makes **no network call**.
- **Emit `faff next`'s vocabulary, don't re-implement its table.** `faff state` produces the *inputs* to the transition function; it must never compute `{next}` itself. The two compose; neither absorbs the other.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `skills/faff/bin/faff` (`cmdNext`, `nextStep`) | Node (CommonJS) | The pure engine whose flag vocabulary `faff state` must emit. Sibling subcommand. |
| `skills/faff/bin/faff` (`findRoot`, `latestRunDir`, `loadConfig`, `resolveSpecDocsPath`) | Node | Existing helpers `faff state` **reuses** verbatim — repo-root discovery, latest run dir, config + spec-docs-path resolution. |
| `skills/faff/bin/faff` (`auditRun`, `TERMINAL_STATES`) | Node | `runcheck`'s ledger reader. `faff state` shares the ledger-parse path but answers a per-issue question, not a run-completeness one. |
| `.faff/runs/<run-id>/run-ledger.json` | JSON | `{run_id, admitted[], outcomes{issue→terminal}, discovered_scope_filed}`. The ledger source for the parked / terminal-outcome hint. |
| `.faff/runs/<run-id>/<ISSUE>/park.md` | Markdown | Per-issue park record. **Note the real layout** — run-scoped (`<run-id>/<ISSUE>/`), not `.faff/runs/<issue>/` as the ticket loosely wrote. |
| `<spec-docs-path>/*-<issue>-*.md` (default `docs/specs/`) | Markdown | Committed spec. Holds the `confidence:` line `faff state` parses for `--spec`. |
| `.faff/specs/<issue>.md` | Markdown | Git-only-mode spec store (Spec-discovery location 4). |

**Scope statement.** `faff state` is the local read-model half of the CLI orchestration substrate: `faff next` decides, `faff state` observes (locally). It sits beside them in the one bundled `faff` Node entrypoint.

## 2. OUT OF SCOPE

- **Tracker / MCP reads.** — Status, labels (`faff-automation-hold`, `faff-parked`), and `blockedBy` relations as the tracker holds them are **out of scope**: the CLI has no MCP. *Why excluded:* the FAFF-63 boundary — the CLI is local-only. *Extension point:* the **agent** supplies authoritative values on the interactive path and overrides the hints; that mapping lives in the gateway's state→flags shared rule (FAFF-64), not in this subcommand.
- **Computing the next step.** — `faff state` never emits `{next}`. *Why excluded:* that is `faff next`'s job; duplicating the table would split the source of truth FAFF-63 centralised. *Extension point:* composition (OQ2) — the agent (or a future pipe) feeds `faff state` output into `faff next`.
- **A Unix `state | next` stdin pipe on `faff next`.** — Adding stdin-JSON parsing to `faff next`. *Why excluded:* it would make the pure engine read I/O, breaking FAFF-63's purity. *Extension point:* if wanted later, add a `faff next --from-state -` reader as a separate, opt-in flag on `next` — a new ticket, not this one.
- **Subsuming `runcheck`.** — Replacing or folding `runcheck`'s run-completeness audit. *Why excluded:* OQ3 — different question (per-issue state vs whole-run completeness). *Extension point:* both already share the ledger-parse helpers; that sharing is the integration, not a merge.
- **Caching / a state file.** — Writing resolved state anywhere. *Why excluded:* the gateway "always pull fresh" rule + stable-config-only rule — local state is recomputed each call, never persisted. *Extension point:* none; this is a hard rule.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Hint | A field `faff state` resolves from local sources, known to be best-effort and overridable by authoritative tracker data. |
| `unknown` | The explicit value for a field no local source can resolve (e.g. tracker status). Distinct from a resolved value and from `false`. |
| Resolved state | The full JSON object `faff state` emits for one issue. |

**Invocation.**

```
faff state <issue> [--json] [--root DIR]
```

- `<issue>` — the issue identifier (e.g. `FAFF-65`). **Required.** Matching against local paths is **case-insensitive** (branches lowercase the id; specs/run-dirs may use either case).
- `--json` — emit the resolved-state JSON object (the default and only machine format; a bare `faff state <issue>` also prints JSON, mirroring `faff next` which is JSON-only). A human-skimmable table is **not** required (the run renders via the rendering adaptor; the CLI stays JSON).
- `--root DIR` — override repo-root discovery (mirrors `cmdConfig`'s `--root`); defaults to `findRoot()`.

**Output record.** The object keys deliberately mirror the **`faff next` flag vocabulary** (FAFF-64's shared mapping) so the agent maps field→flag 1:1, plus provenance fields:

```
RECORD ResolvedState:
  issue: String                       # the queried id, echoed verbatim
  status: "unknown"                   # ALWAYS "unknown" — local sources cannot observe tracker status
  spec: "none" | "low" | "medium" | "high"   # from Spec-discovery + confidence parse
  spec_source: String | null          # path the spec was read from, or null when spec="none"
  held: "unknown"                     # ALWAYS "unknown" — the hold label is tracker-only
  parked: Boolean                     # true iff a local park record is the issue's latest signal (see HOW)
  parked_source: String | null        # path to the park.md that set parked=true, else null
  blocked: "unknown"                  # ALWAYS "unknown" — blockedBy is a tracker relation
  branch: String | null               # a local git branch matching the issue, else null
  worktree: String | null             # a worktree path for that branch, else null
  ledger_outcome: String | null       # latest run-ledger terminal outcome for the issue, else null
  ledger_run: String | null           # the run-id that outcome came from, else null
```

**Design decision — what does `faff state` resolve vs leave `unknown`?** The CLI is local-only, so each field is assigned to exactly one authority:

| Field | Local source (if resolvable) | Emitted as |
|---|---|---|
| `status` | none — tracker only | always `"unknown"` |
| `spec` | Spec-discovery hit → parse `confidence:` | `none`/`low`/`medium`/`high` |
| `held` | none — `faff-automation-hold` is a tracker label | always `"unknown"` |
| `parked` | latest `<run>/<ISSUE>/park.md` (see HOW precedence) | `true`/`false` |
| `blocked` | none — `blockedBy` is a tracker relation | always `"unknown"` |
| `branch`/`worktree` | `git branch --list` / `git worktree list` | path or `null` |
| `ledger_outcome` | latest run-ledger `outcomes[<issue>]` | string or `null` |

**Chosen:** emit `status`, `held`, and `blocked` as the literal string `"unknown"` rather than omitting them, so a consumer sees every `faff next` flag slot accounted for and knows exactly which three the agent must fill authoritatively. Rationale: an omitted key is ambiguous (not-resolved vs not-applicable); an explicit `"unknown"` is self-documenting and keeps the record shape fixed. The two locally-resolvable signals that map to `faff next` flags are `spec` (the rating) and `parked` (the boolean); `branch`/`worktree`/`ledger_outcome` are provenance beyond the flag set.

**Design decision — composition with `faff next` (OQ2: pipe vs flags).**

Options considered:
- *A — true Unix pipe* `faff state FAFF-65 | faff next`: requires `faff next` to grow stdin-JSON parsing, breaking FAFF-63's purity (the engine would read I/O and would have to invent precedence when piped fields are `"unknown"`).
- *B — agent-mediated mapping*: `faff state` emits JSON; the agent (already reading the gateway's state→flags rule) reads the JSON, overrides the three `"unknown"` fields with authoritative tracker values on the interactive path (or leaves the autonomous/git-only path to use the hints), then calls `faff next` with explicit flags.

**Chosen:** B — agent-mediated mapping for v1. It keeps `faff next` pure (FAFF-63's load-bearing property), and it is honest about the boundary: because `status/held/blocked` are always `"unknown"` locally, a blind pipe could never produce a correct `faff next` call without the agent filling them anyway. The literal pipe is recorded as an extension point (`faff next --from-state -`, a separate ticket) — not built here. The ticket's `state | next` sketch is satisfied *semantically* (the output is `faff next`'s vocabulary) without coupling the two binaries.

**Design decision — relationship to `runcheck` (OQ3: does it subsume runcheck's ledger reads?).**

**Chosen:** No. `faff state` **reuses** the ledger-reading code (`latestRunDir`, the `JSON.parse` of `run-ledger.json`, and `TERMINAL_STATES` for validating the outcome it reports) but answers a **different question** — "what is this one issue's latest local state?" vs `runcheck`'s "did this whole run dispatch its admitted queue?". Refactor the shared read into a small helper both call (e.g. `readLedger(runDir)`); do **not** route `runcheck` through `faff state` or vice-versa. Rationale: merging them would couple a per-issue read to a per-run audit and bloat both; sharing the parse helper is the right amount of reuse (DRY without conflation).

## 4. HOW — Behaviour

**Architecture.** `cmdState(args)` is a new dispatch arm beside `cmdNext`, reusing the file's existing helpers. It resolves the repo root, then independently resolves each field from its assigned source, assembles the `ResolvedState` record, prints it as JSON, and exits 0. It never throws on a missing source — a missing ledger, missing spec, or non-git tree yields `null`/`unknown` for the affected fields, never a crash (mirroring the fail-safe posture of `faff next` and `runcheck --hook`).

```
PROCEDURE cmdState(args):
  1. Parse args: issue (first positional, required → error exit 2 if absent), --root, --json (no-op flag; JSON is default).
  2. root = --root value, else findRoot().
  3. spec, spec_source     = resolveSpec(root, issue)
  4. parked, parked_source = resolveParked(root, issue)
  5. branch, worktree      = resolveGit(root, issue)
  6. ledger_outcome, ledger_run = resolveLedgerOutcome(root, issue)
  7. Assemble ResolvedState with status/held/blocked = "unknown".
  8. console.log(JSON.stringify(record)); return 0.
```

**Behaviour summary — resolveSpec:** find the issue's spec the way Spec-discovery location 3/4 do, then read its confidence rating; emit `none` when absent.

```
PROCEDURE resolveSpec(root, issue):
  1. specDir = resolveSpecDocsPath(root, loadConfig(root)[0], create=false)   # reuse existing helper
  2. candidates = files in <root>/<specDir> matching /-<issue>-.*\.md$/i       # FAFF-63 style: *-<issue>-*.md
  3. APPEND <root>/.faff/specs/<issue>.md (case-insensitive) if it exists      # git-only store (location 4)
  4. IF no candidates: RETURN ("none", null)
  5. pick the most-recently-modified candidate (mtime)                          # Spec-discovery "prefer most recent"
  6. text = read it
  7. m = first match of /confidence:\s*\**\s*(high|medium|low)\b/i in text      # tolerant: handles `confidence: high`,
  8. IF m: RETURN (m.group.toLowerCase(), pickedPath)                           #   "> ... confidence: high.", `confidence: high`
  9. ELSE:  RETURN ("high", pickedPath)   # spec present but rating unparseable → see edge case below
```

**Anti-pattern:** parsing only a bare line `^confidence:\s*(\w+)$`. Why: real committed specs carry the rating inline in a banner (`> Spec: … · confidence: high.`) and backtick-wrapped (`` `confidence: high` ``) — observed across `docs/specs/`. The regex must be tolerant of leading markup and a trailing period; anchor on the word `confidence:` not on line start.

**Behaviour summary — resolveParked:** the issue is locally parked iff its latest run-scoped `park.md` is the most recent run signal for it. v1 keeps this simple and run-recency-based.

```
PROCEDURE resolveParked(root, issue):
  1. runsDir = <root>/.faff/runs ; IF absent RETURN (false, null)
  2. For each run dir (sorted DESC — run-ids are date-prefixed, lexical == chronological, newest first):
       parkPath = <runDir>/<ISSUE>/park.md   (case-insensitive dir match on the issue id)
       IF parkPath exists: RETURN (true, parkPath)         # newest run with a park record wins
  3. RETURN (false, null)
```

- **Chosen:** "latest run wins" precedence — scan runs newest-first and report the first `park.md` found. Rationale: an older park followed by a newer run that grafted the issue should *not* report parked; but a newer-run park is current. Run-id lexical sort gives chronological order for free (same invariant `latestRunDir` relies on). A fuller "was it later shipped?" cross-check against `ledger_outcome` is deliberately not done in v1 (see edge cases).

**Behaviour summary — resolveGit:** find a local branch and worktree for the issue; tolerate a non-git tree.

```
PROCEDURE resolveGit(root, issue):
  1. branches = `git -C root branch --list --format=%(refname:short)`   (spawnSync; on non-zero/throw → RETURN (null,null))
  2. branch = first branch whose name contains the issue id, case-insensitive
              (Linear branch form is "<num>-<slug>", e.g. faff-65-…; also matches "faff-65")
  3. worktree = from `git -C root worktree list --porcelain`, the worktree whose checked-out
                branch == branch (else null)
  4. RETURN (branch || null, worktree || null)
```

- **Anti-pattern:** shelling `git` without guarding for "not a git repo" / git absent. Why: `faff state` must run in a `.faff`-only tree (git-only-mode repos still have `.git`, but a bare `.faff` sandbox may not). Treat any git failure as "no branch/worktree", never a crash.

**Behaviour summary — resolveLedgerOutcome:** report the issue's most-recent run-ledger terminal outcome.

```
PROCEDURE resolveLedgerOutcome(root, issue):
  1. For each run dir newest-first with a run-ledger.json:
       data = readLedger(runDir)            # shared helper, also used by runcheck's auditRun
       outcome = data.outcomes[issue]       (exact id key; outcomes are keyed by issue id)
       IF outcome present: RETURN (outcome, data.run_id ?? basename(runDir))
  2. RETURN (null, null)
```

**Edge cases and error handling.**

- **No `<issue>` arg** → loud error to stderr + exit 2 (mirrors `faff next`'s bad-flag exit 2). Every other missing input is non-fatal.
- **Spec present, confidence unparseable** → `spec = "high"` with `spec_source` set, AND a one-line note to **stderr** (`faff state: spec found but no confidence line; defaulting to high`). **Chosen:** default-high-with-warning over default-none. Rationale: a committed/attached spec exists, so "no spec → prep" (`none`) would be wrong; `faff next` treats `high` as build-eligible, which matches "a spec is present". The stderr note keeps it honest. (Alternative — emit `spec: "unknown"` — rejected: `faff next` has no `unknown` spec value, so it would not map onto the flag vocabulary, defeating the read-model's purpose.)
- **Malformed `run-ledger.json`** → skip that run (try the next older one), never crash — same tolerance as `runcheck --hook`'s try/catch.
- **Multiple specs match** → most-recent mtime wins (Spec-discovery rule); the others are ignored (not an error).
- **`ledger_outcome` says shipped but a `park.md` exists in an older run** → `parked` is decided purely by run-recency (resolveParked), so a newer ship-run with no park record yields `parked=false` correctly; `ledger_outcome` is reported independently as provenance. v1 does not attempt to reconcile the two — both are emitted; the agent/tracker arbitrates.

**Wiring & guardrails.**
- Add `if (sub === "state") return cmdState(rest);` to `main`, and a `state` line to `USAGE` and the header comment block.
- `faff validate-adapters` and `faff config` behaviour must remain unchanged (the diff is additive to one file).
- No new dependencies (CommonJS + `node:fs`/`node:path` + `node:child_process` for git, all built-in).

## 5. DESIGN DECISION RATIONALE

**Should `faff state` emit `{next}` or just the inputs?**
- Options: (a) emit the next step too (one call does everything); (b) emit only inputs, leave `{next}` to `faff next`.
- **Chosen:** (b) inputs only — **rationale:** FAFF-63 centralised the transition table; a second computation site would be a correctness fork. `faff state` observes, `faff next` decides.

**How to represent tracker-only fields locally?**
- Options: omit them; emit `false`; emit `"unknown"`.
- **Chosen:** `"unknown"` — **rationale:** omitting is ambiguous and `false` is a lie (we don't know it's not held/blocked). `"unknown"` is self-documenting and flags exactly which three fields the agent must fill from the tracker.

**Composition mechanism (pipe vs flags).**
- **Chosen:** agent-mediated flags, pipe as a future opt-in on `next` — **rationale:** preserves `faff next` purity; a blind pipe can't be correct while `status/held/blocked` are locally `"unknown"`. (Full options in §3.)

**Subsume runcheck?**
- **Chosen:** No — share the ledger-parse helper, keep the two subcommands distinct (per-issue vs per-run). (Full options in §3.)

**Parked precedence.**
- **Chosen:** latest-run-wins, run-id lexical order — **rationale:** reuses the `latestRunDir` chronological invariant; avoids a heavier ledger cross-check in v1.

Temporal anchor: at the time of writing, committed specs in `docs/specs/` carry the confidence rating in three observed shapes (bare line, banner blockquote, backtick-wrapped) — the tolerant regex is sized to those; revisit if the spec banner format changes.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None block the build — all three ticket open-questions are resolved above with grounded Chosen calls (field authority table in §3; composition = agent-mediated in §3/§5; runcheck = not subsumed in §3/§5).

**Assumptions.**

- **Assumes:** the run-ledger schema is `{run_id, admitted[], outcomes:{<issue> → <terminal-state>}, …}` with outcomes keyed by issue id. *Validate:* read any `.faff/runs/*/run-ledger.json` and confirm `outcomes` is an object keyed by issue ids (confirmed against `2026-06-05-beep-boop-23-08-49`).
- **Assumes:** `resolveSpecDocsPath`, `loadConfig`, `findRoot`, `latestRunDir` exist and are reusable in the same file. *Validate:* present in `skills/faff/bin/faff` today.
- **Assumes:** `git` is invokable when a branch/worktree exists. *Validate:* guarded — git absence yields `null`, not an error.

## 7. DONE — Definition of Done

### From WHY
- [ ] `faff state <issue>` resolves an issue's local state without any MCP/tracker call (local sources only).
- [ ] Same filesystem + git state ⇒ identical JSON across runs (deterministic; no LLM, no mutation, no network).

### From WHAT (interface)
- [ ] `faff state <issue> [--json] [--root DIR]`; bare invocation prints JSON; missing `<issue>` → stderr error + exit 2.
- [ ] Output object carries `issue, status, spec, spec_source, held, parked, parked_source, blocked, branch, worktree, ledger_outcome, ledger_run`.
- [ ] `status`, `held`, `blocked` are always the literal `"unknown"`.
- [ ] `spec` ∈ `none|low|medium|high` and maps 1:1 onto the `faff next --spec` vocabulary; `parked` is a boolean mapping onto `--parked`.

### From HOW (behaviour)
- [ ] `spec` resolved via Spec-discovery (committed `<spec-docs-path>/*-<issue>-*.md` + git-only `.faff/specs/<issue>.md`), most-recent-mtime wins; confidence parsed by a tolerant regex (handles bare line, banner blockquote, and backtick-wrapped forms).
- [ ] Spec present but confidence unparseable → `spec="high"` + spec_source set + stderr note.
- [ ] `parked=true` iff the newest run dir with a `<run-id>/<ISSUE>/park.md` has one (run-id lexical = chronological, newest-first); `parked_source` is that path.
- [ ] `branch`/`worktree` from `git branch --list` / `git worktree list`, issue-id case-insensitive match; git failure → `null`, never a crash.
- [ ] `ledger_outcome`/`ledger_run` from the newest run-ledger whose `outcomes` keys the issue; malformed ledger is skipped, not fatal.

### From HOW (composition & reuse)
- [ ] `faff state` does **not** compute `{next}` (no transition-table re-implementation); its output is `faff next`'s input vocabulary.
- [ ] The ledger read is a shared helper used by both `cmdState` and `runcheck`'s `auditRun`; `runcheck` is not subsumed and its behaviour is unchanged.
- [ ] `faff next --selftest`, `faff config …`, and `faff validate-adapters` all still pass (additive diff to one file).

### From scope
- [ ] No tracker/MCP read; no state file written; no new dependency; `main`/USAGE/header updated with the `state` arm.

**Integration smoke test:**
```
GIVEN an issue with a committed docs/specs/*-FAFF-65-*.md (confidence: high) and no park.md
  faff state FAFF-65
    → JSON with spec="high", spec_source=<that path>, parked=false,
      status="unknown", held="unknown", blocked="unknown"
  AND the agent maps {spec,parked} + authoritative tracker {status,held,blocked}
      into `faff next` flags → faff next returns a coherent {next} (plumbing connected).
```

confidence: high

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Per-issue critique through the agile-delivery lens (`issue-critique`).

- **Right-sized? (principle 4) — No issue.** One cohesive 1–3 day unit: add a single `state` subcommand (with three small private resolvers) to one existing file plus its dispatch/USAGE wiring. Not splittable into independent shippable concerns — the resolvers only make sense together as the read-model. Not a merge candidate either.
- **Workstream fit? (principles 1 + 5) — No issue.** Sits in *Configurability & contract framework*, alongside its siblings `faff next` (FAFF-63) and the wiring (FAFF-64). Outcome-cohesive: the local CLI orchestration substrate. Correctly placed.
- **Deps surfaced? (principle 6) — Minor.** The ticket carries `relatedTo` FAFF-63 and FAFF-64 (both Done) but **no `blockedBy` link** — correctly, since both are already Done, so there is nothing left to block on. The real dependency (the helpers in `skills/faff/bin/faff`) is an in-file code dependency, not a ticket relation. No action: the relation graph is honest as-is.
- **Risk profile? (principle 7) — Low, no de-risking spike needed.** No novel integration or external dependency: it reads local files and shells `git`, reusing helpers that already ship. The only judgement calls were the three open questions, all resolved in-spec with grounded Chosen calls. No spike warranted.
