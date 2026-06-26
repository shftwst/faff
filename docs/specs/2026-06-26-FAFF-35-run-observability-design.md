# Spec — FAFF-35 (slice 1 of N): Structured run-event log — the timeline substrate for run observability

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: high. Full spec on Linear FAFF-35.

> **Narrowed to slice 1 (human-confirmed 2026-06-26).** FAFF-35 is broad ("what a human can see, in-flight & morning"). This slice specs only the **fixed contract**: the run-event schema + its append-only emission. The in-flight push surface, the morning rendering producer, and tamper-evidence are deferred follow-on slices (see Out of scope). Answers the ticket's open question — run observability is **not** folded into `faff-wtf`; it's the structured surface `faff-wtf`/beep-boop/FAFF-225 will *consume*.

## 1. WHY — Problem and Principles

**The load-bearing model.** A trustworthy lights-out run needs a **timeline** of what it did — and faff has none. Today the run-ledger is a *terminal snapshot* (`admitted → outcomes`), and everything else is prose (`summary.md`, `.faff/logs/*.md`); there is no structured record of *how the run unfolded*. This slice adds one: an **append-only JSONL event log** at `.faff/runs/<run-id>/events.jsonl`, written by the orchestrator at each meaningful pipeline transition, with the envelope (`schema`/`run_id`/`seq`/`ts`) owned by a pure `faff events` CLI. It is the *substrate*, not the surface — the in-flight view and the morning report are later producers that *read* this log.

**Not folded into `faff-wtf`.** `faff-wtf` is a *pull* report that re-derives state from the live tracker + git on every call; it reads a beep-boop `summary.md` only to link to it, never to consume run state. There is no structured run-event stream for it (or anything else) to read. This slice creates exactly that missing surface; `faff-wtf`, beep-boop's summary, and the FAFF-225 L4 runner become its **consumers** — consumption is out of scope here (slice 1 only *produces* the trail).

**Problem statement.** A human (and downstream machinery) cannot reconstruct what an unattended run *did* over time — only its end state — so there is nothing to render in-flight or in the morning, and FAFF-106 (escaped-effect detection) and FAFF-107 (log redaction) have no structured stream to read. This slice emits a structured, append-only event timeline alongside the existing ledger. It absorbs the run-event-schema kernel orphaned when FAFF-101 (audit-event schema) was cancelled — the *observability* half; the *forensics/tamper-evidence* half stays deferred.

**Design principles:**

- **Substrate, not surface.** Slice 1 produces a machine-readable trail and nothing human-facing. Any rendering/notification belongs to a later producer; building it here breaks the slice line and the slot framing (fixed contract = schema; swappable = transport).
- **`seq` orders, `ts` annotates.** Sandbox wall-clocks are unreliable (the gateway clock hazard), so ordering must not depend on `ts`. A monotonic per-run `seq` is the authoritative order; `ts` is best-effort annotation only. A consumer that sorts by `ts` is wrong.
- **Single-writer in slice 1.** Only the orchestrator appends events — the transitions *it* observes (admit, dispatch, outcome). This matches the lane model (the orchestrator holds the ledger; build subagents return only a terminal token) and the FAFF-60 granularity rule (meaningful transitions, never per-file/per-test/per-CI-poll micro-actions). It also makes `seq` race-free by construction. Build-*internal* events from concurrent subagents are a deliberately deferred slice.
- **Append-only, never read-modify-write.** Each event is one appended line. This sidesteps the known run-ledger load-modify-save race hazard entirely.
- **Deterministic tool over prose.** The schema, `seq` assignment, `ts` stamping, and validation live in a pure, dependency-free, `--selftest`-able `faff events` CLI (mirroring `faff contract`/`profile`/`fixtures`); the orchestrator only decides *when* to emit — which is the pipeline phases it already knows.

**Reference context:**

| System | Relevance |
|---|---|
| `.faff/runs/<run-id>/run-ledger.json` | The terminal snapshot this complements. Events = timeline; ledger = end state. Slice 1 writes alongside it, never replaces it. |
| `plugin/skills/faff/bin/faff` (`contract`, `profile`, `fixtures`, `budget check`) | The pure-CLI pattern (schema + validate + `--selftest`, exit 0/1/2) the `faff events` subcommand mirrors. |
| `plugin/skills/faff-beep-boop/SKILL.md` (pipeline, run-ledger, owner stamp) | The orchestrator that emits the events; the emission points map to its existing phases. |
| `.faff/calibration/*` | The existing append-only-JSON precedent. |
| `plugin/skills/faff/SKILL.md` → Agent Lanes; logging hard-floor | The lane model (single-writer rationale) and the always-written floor the event log joins. |

**Scope statement.** The fixed-contract foundation of L4 run observability: a structured run-event log + the `faff events` CLI that writes and validates it, which FAFF-225/106/107 and the deferred rendering/transport slices build on.

## 2. OUT OF SCOPE

- **In-flight push / notify (webhooks, mid-run notifications)** — *Why:* the push-vs-pull product call is deferred; the schema serves both. *Extension:* a transport producer that tails `events.jsonl` and pushes.
- **Morning rendering / report producer** — *Why:* slice 1 is the substrate, not the human surface. *Extension:* a rendering producer over `events.jsonl`; `faff-wtf` becomes a consumer.
- **Build-*internal* events (gate-result, review-verdict, pr-opened) from inside build subagents** — *Why:* they require a concurrent multi-writer story (parallel `concurrency` executor) and are micro-actions at the orchestrator's granularity. *Extension:* a granular-events slice adding a writer-id + arrival-order strategy over atomic `O_APPEND`.
- **Tamper-evidence / signed logs** — *Why:* this was FAFF-101's explicit later increment (now cancelled); it's forensics/integrity, not observability. *Extension:* a future hardening slice over the same log.
- **Replacing or deriving the run-ledger from events** — *Why:* the ledger is the authoritative terminal snapshot today; unifying is a simplification, not this slice. *Extension:* a later slice could derive `outcomes` from `issue-outcome` events.
- **Cross-run aggregation / cost dashboards** — *Why:* per-run substrate only. *Extension:* a consumer that reads many runs' logs.
- **Consuming the log anywhere (`faff-wtf`, beep-boop summary, FAFF-225 runner)** — *Why:* slice 1 only produces it. *Extension:* each consumer is its own change.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| **Run-event log** | The append-only JSONL file `.faff/runs/<run-id>/events.jsonl`, one `RunEvent` per line, in append (≈ `seq`) order. |
| **RunEvent** | One structured record of a meaningful pipeline transition during a run. |
| **Envelope** | The CLI-owned fields of a `RunEvent` (`schema`, `run_id`, `seq`, `ts`) the caller does not supply. |
| **Payload** | The caller-supplied semantic fields (`phase`, `type`, `issue?`, `data?`). |

```
ENUM Phase: { run, tidy, prep, build }     # the pipeline phase the event belongs to

ENUM EventType:                            # versioned + additive; closed for slice 1
  { run-start, run-end,                    # phase run — lifecycle
    tidy-done,                             # phase tidy
    issue-admitted,                        # phase run — issue entered the build queue
    prep-start, prep-done,                 # phase prep
    build-start,                           # phase build — graft subagent dispatched
    issue-outcome,                         # phase build — terminal disposition (from the returned token)
    discovered-scope-filed,                # phase run — a discovery ticket was filed
    budget-checkpoint,                     # phase run — a BudgetState snapshot
    park }                                 # phase prep|build — an issue was parked

RECORD RunEvent:
  schema: int          # == 1; REQUIRED; CLI-owned
  run_id: string       # REQUIRED; CLI-owned (from --run); must match the run dir
  seq: int             # REQUIRED; CLI-owned; monotonic per run, 0-based, gap-free
  ts: Timestamp        # REQUIRED; CLI-owned; ISO-8601 best-effort wall-clock at append (annotation only)
  phase: Phase         # REQUIRED; caller-supplied
  type: EventType      # REQUIRED; caller-supplied; must be in EventType
  issue: string?       # OPTIONAL; present iff the event is issue-scoped (e.g. "FAFF-35")
  data: object?        # OPTIONAL; type-specific payload (e.g. issue-outcome → {outcome}, budget-checkpoint → BudgetState)

  CONSTRAINT schema == 1
  CONSTRAINT type ∈ EventType ; phase ∈ Phase
  CONSTRAINT issue-scoped types (issue-admitted, prep-*, build-start, issue-outcome, park) REQUIRE issue
  CONSTRAINT issue-outcome.data.outcome ∈ run-ledger outcome vocabulary
              { shipped, pr-open, parked, errored, routed-out, unreached-budget, claimed-by-peer }
```

**`data` by type** (loose by design — `validate` checks the envelope + the issue-presence constraint, not every payload shape; payloads grow additively):

- `issue-outcome` → `{ outcome: <ledger outcome> }`
- `budget-checkpoint` → a `BudgetState` (`faff budget check` output)
- `discovered-scope-filed` → `{ count }` or `{ new_issue }`
- others → optional free `{}`.

**CLI surface** — a new `faff events` subcommand, pure (no tracker, no network), mirroring `faff contract`/`profile`:

```
faff events append --run <run-id> [--ts <iso>]   # stdin: {phase,type,issue?,data?}; CLI fills schema/run_id/seq/ts;
                                                  # validates, appends one line. exit 0 ok ·1 invalid ·2 malformed ·3 run-dir-missing
faff events validate [--file PATH]                # validate a JSONL stream (or stdin) line-by-line. exit 0 all-valid ·1 violations(line#) ·2 malformed
faff events read --run <run-id> [--type T] [--issue I] [--json]   # thin reader/filter for consumers. exit 0 · 3 no events
faff events --selftest                            # in-memory table over synthetic (payload, fs) fixtures
```

**Design decisions:**

- **Chosen:** append-only JSONL at `.faff/runs/<run-id>/events.jsonl`, **not** extra arrays inside `run-ledger.json`. Append-only avoids the ledger's read-modify-write race; JSONL is the natural one-event-per-line stream and matches the `calibration/*` append precedent.
- **Chosen:** the CLI owns the envelope (`schema`/`run_id`/`seq`/`ts`); the caller supplies only `{phase, type, issue?, data?}`. Less for the orchestrator to get wrong; `seq`/`ts` have a single source.
- **Chosen:** `seq` (monotonic, gap-free, assigned as the current line count) is authoritative order; `ts` is best-effort annotation. Sidesteps the sandbox-clock hazard.
- **Chosen:** single-writer (orchestrator) in slice 1; `EventType` is closed and orchestrator-observable. Build-internal events are deferred. Makes `seq` race-free and honours the FAFF-60 granularity rule.
- **Chosen:** `events.jsonl` is a logging **hard-floor** artifact (always written, even under `logging: essential`) — it is machine-consumed by FAFF-106/107 and the deferred consumers, like `run-ledger.json`.

## 4. HOW — Behavior

**Architecture.** A pure `faff events` CLI owns the file and the schema; the beep-boop orchestrator calls `faff events append` at the pipeline transitions it already sequences. Build subagents do **not** write events in slice 1 (they return their terminal token; the orchestrator emits `issue-outcome` from it).

```
PROCEDURE append(run_id, payload, ts_override):
  dir := ".faff/runs/" + run_id
  IF NOT exists(dir):                      return exit 3 ("run dir missing — initialise the run first")
  parse payload JSON; parse error →        return exit 2
  validate_payload(payload):               # phase∈Phase, type∈EventType, issue-presence, schema-fillable
     violation →                           return exit 1 (names the violation)
  path := dir + "/events.jsonl"
  seq  := count_lines(path)                # 0 if absent; single-writer ⇒ no race
  ts   := ts_override ?? now_iso()         # best-effort wall-clock; --ts for deterministic tests
  event := { schema:1, run_id, seq, ts, ...payload }
  append_line(path, JSON.stringify(event) + "\n")   # O_APPEND, single line
  return exit 0

PROCEDURE validate(stream):
  seen_seq := -1
  for (line, n) in stream:
     parse → malformed: collect "line n: malformed"; continue
     check schema==1, phase∈Phase, type∈EventType, issue-presence, outcome-vocab → collect violations
     (advisory) if seq present and seq != seen_seq+1: note "non-contiguous seq"; seen_seq := seq
  violations non-empty → exit 1 (line-numbered) ; else exit 0
```

**Emission points (orchestrator / beep-boop).** Each maps to an existing phase boundary — no new pipeline structure:

| Transition | Event |
|---|---|
| Run begins (after run dir + ledger init) | `run-start` (phase run) |
| Tidy pass returns | `tidy-done` (phase tidy) |
| Issue enters the build queue | `issue-admitted` (phase run, issue) |
| Prep-queue prep of an issue start/finish | `prep-start` / `prep-done` (phase prep, issue) |
| Graft subagent dispatched | `build-start` (phase build, issue) |
| Graft subagent returns its token | `issue-outcome` (phase build, issue, `data.outcome`) |
| A discovery ticket is filed | `discovered-scope-filed` (phase run) |
| Budget checkpoint (e.g. each wave / at-ceiling) | `budget-checkpoint` (phase run, `data` = BudgetState) |
| An issue is parked | `park` (phase prep\|build, issue) |
| Run ends | `run-end` (phase run) |

**Edge cases:**

- **Missing run dir:** `append` → exit 3 (fail-loud). The orchestrator creates `.faff/runs/<run-id>/` at run-start (it already writes the ledger there) before the first event; `append` never silently creates a stray dir.
- **Empty / absent `events.jsonl`:** first `append` → `seq = 0` and creates the file. `read` on an absent/empty log → exit 3 (no events), not an error.
- **`ts` from a wrong clock:** harmless — consumers order by `seq`. `--ts` injects a fixed stamp for deterministic `--selftest`/tests.
- **Unknown `type` / `phase`:** `append` and `validate` → invalid (exit 1) — the enum is closed for slice 1; growth is a schema-additive change.
- **Issue-scoped type without `issue`:** invalid (exit 1) naming the missing field.
- **Concurrent append (parallel `concurrency` executor):** not reachable in slice 1 — only the single orchestrator process appends (subagents emit no events). The multi-writer case is out of scope (see §2).

**Failure modes:**

- **The failure:** the orchestrator forgets to emit at a transition, so the timeline has holes (`seq` stays gap-free but a phase is missing). **How you'd know:** `validate`'s advisory non-contiguous-`seq` check stays clean, yet a run with known builds shows no `build-start` — a consumer/test asserting "every admitted issue has a `build-start` and an `issue-outcome`" fails. **What it means:** proceed — completeness is the orchestrator's contract; the DONE smoke test pins the core set, further coverage grows with consumers.
- **The failure:** events and ledger diverge (an `issue-outcome` event disagrees with `run-ledger.json` `outcomes`). **How you'd know:** a cross-check (events' final `issue-outcome` per issue == ledger `outcomes[issue]`) mismatches. **What it means:** narrow — in slice 1 both are written by the orchestrator from the *same* returned token, so they agree by construction; the cross-check is a guard, and unifying (ledger derived from events) is the named extension.

**Anti-pattern:** ordering or de-duping events by `ts`. Why: `ts` is best-effort wall-clock under an unreliable sandbox clock; `seq` is the only authoritative order.
**Anti-pattern:** having build subagents append events in slice 1. Why: it reintroduces the concurrent-`seq` race and exceeds the single-writer scope; the orchestrator emits `issue-outcome` from the returned token instead.
**Anti-pattern:** emitting per-file/per-test/per-CI-poll events. Why: violates the FAFF-60 meaningful-transition granularity rule — noise, not signal.

## 5. Scenarios

```
Given a run dir .faff/runs/run-X/ with no events yet
When  faff events append --run run-X is given {phase:"run", type:"run-start"}
Then  events.jsonl has one line with schema 1, run_id "run-X", seq 0, a ts, and the payload; exit 0
```
```
Given an existing events.jsonl with 3 lines (seq 0,1,2)
When  a 4th event is appended
Then  it is assigned seq 3 (current line count), gap-free; exit 0
```
```
Given an issue-scoped type (issue-outcome) with no issue field
When  faff events append validates it
Then  exit 1 naming the missing issue field; nothing is appended
```
```
Given an events.jsonl whose 2nd line has an unknown type
When  faff events validate reads it
Then  exit 1 reporting "line 2: type not in EventType"
```
```
Given faff events append --run run-Y where .faff/runs/run-Y/ does not exist
When  it runs
Then  exit 3 (run dir missing); no file or directory is created
```

Non-functional assertions:
- `faff events` is pure, dependency-free (`node:*`), offline, `--selftest`-covered; it reads/writes only the run dir and never calls the tracker or network.
- `seq` is monotonic and gap-free under the single-writer regime; ordering never depends on `ts`.
- `events.jsonl` is written regardless of `logging: essential` (hard-floor).

## 6. DESIGN DECISION RATIONALE

- **Where does the timeline live?** Options: extra arrays in `run-ledger.json` (one file) vs a separate append-only JSONL. The ledger is a read-modify-write snapshot with a known race hazard; threading a growing event array through it worsens that. **Chosen:** separate append-only `events.jsonl` — one atomic line per event, no read-modify-write, matches `calibration/*`.
- **Global `seq` vs `ts` ordering?** `ts` is unreliable (sandbox clock). **Chosen:** monotonic `seq` authoritative, `ts` annotation. (Rejected: ordering by `ts` — wrong under clock skew.)
- **Single-writer vs full event capture in slice 1?** Capturing build-internal events needs concurrent multi-writer handling and emits micro-actions. **Chosen:** single-writer orchestrator emission of meaningful transitions; defer build-internal/concurrent events. Race-free `seq`, FAFF-60-aligned granularity, smaller slice.
- **Who owns the envelope?** **Chosen:** the CLI fills `schema`/`run_id`/`seq`/`ts`; the caller supplies only semantics. Single source for the fields most easily got wrong.
- **Closed vs open `EventType`?** **Chosen:** closed enum for slice 1, additively versioned — `validate` can reject typos now; new types land as schema-additive growth. (Rejected: free-form `type` — loses validation value.)
- **New `faff events` subcommand vs reuse `faff contract`?** **Chosen:** dedicated `faff events` — distinct concern (a per-run file writer/reader), clean exit space, independently `--selftest`-able.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — slice 1 is scoped to the substrate; the genuine product calls (push vs pull, what-to-surface-vs-noise, rendering) live in the deferred consumer/transport slices, recorded in §2, not as Punts here.

**Assumptions:**

- **Assumes:** the orchestrator (beep-boop) creates `.faff/runs/<run-id>/` at run-start before the first event. *Validate:* confirm beep-boop initialises the run dir + writes `run-ledger.json` there at run-start (it does); the first `run-start` append follows that.
- **Assumes:** single-writer holds — only the orchestrator process appends in slice 1 (build subagents emit no events). *Validate:* check every emission point in §4 is orchestrator-side; no `faff events append` call is added inside the graft/concurrency subagent path.
- **Assumes:** the bundled `faff` CLI (plain Node) may stamp `ts` via the system clock at append and accept a `--ts` override. *Validate:* `bin/faff` is dependency-free Node with filesystem + `Date` access (per `faff profile`/`fixtures` precedent); add a `--ts` flag for deterministic `--selftest`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A run produces a structured, append-only timeline at `.faff/runs/<run-id>/events.jsonl` distinct from the terminal `run-ledger.json`.
- [ ] Nothing human-facing is added (no rendering, no notification) — substrate only.

### From WHAT (types & interfaces)
- [ ] `RunEvent` validates with CLI-owned `schema=1`/`run_id`/`seq`/`ts` and caller-supplied `phase`/`type`/`issue?`/`data?`; `type`∉`EventType` or `phase`∉`Phase` → invalid.
- [ ] Issue-scoped types (`issue-admitted`, `prep-*`, `build-start`, `issue-outcome`, `park`) require `issue`; `issue-outcome.data.outcome` is in the ledger outcome vocabulary.
- [ ] `faff events append` / `validate` / `read` / `--selftest` exist, pure and dependency-free, with the exit codes specified.

### From HOW (behaviour)
- [ ] `append` assigns `seq` = current line count (0-based, gap-free), stamps `ts` (or `--ts`), and appends exactly one JSON line.
- [ ] The orchestrator emits the §4 event set at the named transitions (at minimum `run-start`, `issue-admitted`, `build-start`, `issue-outcome`, `run-end`).
- [ ] `events.jsonl` is written regardless of `logging: essential`.
- [ ] `validate` reports line-numbered violations and an advisory non-contiguous-`seq` note.

### From HOW (edge cases)
- [ ] `append` to a missing run dir → exit 3, no dir created.
- [ ] First `append` creates the file at `seq 0`; `read` on an absent log → exit 3 (not an error).
- [ ] Issue-scoped type missing `issue` → exit 1; unknown `type`/`phase` → exit 1.
- [ ] Ordering is by `seq`, never `ts`; `--ts` yields deterministic `--selftest` output.

**Integration smoke test:**
```
1. mkdir -p .faff/runs/run-smoke
2. echo '{"phase":"run","type":"run-start"}'              | faff events append --run run-smoke --ts 2026-01-01T00:00:00Z  → exit 0
3. echo '{"phase":"build","type":"issue-outcome","issue":"FAFF-35","data":{"outcome":"shipped"}}' \
                                                           | faff events append --run run-smoke --ts 2026-01-01T00:01:00Z  → exit 0
4. faff events validate --file .faff/runs/run-smoke/events.jsonl   → exit 0
5. assert events.jsonl line 1 has seq 0, line 2 has seq 1; faff events read --run run-smoke --type issue-outcome → the 2nd event
```

confidence: high
