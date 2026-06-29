# Spec — FAFF-289: Run-reconstruction forensics view (`faff audit <run>`)

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-289.

This is the buildable spec for **FAFF-289**, addressed to the build agent and human reviewers. It specifies a new read-only `faff audit <run-id>` CLI subcommand that reconstructs what a completed unattended run did, by correlating three substrates faff already writes to disk.

## 1. WHY — Problem and Principles

**Load-bearing model:** a finished faff run already leaves three separate on-disk records — a **timeline** (`events.jsonl`), a **final-state ledger** (`run-ledger.json`), and **per-issue intake proofs** (`provenance/<ISSUE>.json`). Each answers part of "what happened", none answers the whole. `faff audit` is the **join**: it reads all three for one run and emits a single who/what/why reconstruction. It records nothing new — it only reads and correlates.

**Problem.** Today, reconstructing what an overnight run did means hand-reading three JSON/JSONL files and mentally joining them by issue id. There's no single command that says "run X admitted these issues, each entered via Y, did Z, and ended N." This is the forensics half of the audit project; the recorder shipped (FAFF-35), the playback didn't.

**Design principles:**

- **Read-only and deterministic.** No writes, no network, no tracker, no LLM, no live recomputation. Same files in ⇒ same output out. This is the *deterministic tools over prose* tenet — `audit` is a pure function of on-disk state.
- **Degrade, don't crash.** A run dir is often incomplete (crashed mid-run, a missing provenance marker, no `run-end`). The command reconstructs from whatever substrates exist and **reports the gaps** as coherence findings rather than erroring out. A forensic tool is most needed exactly when a run went wrong.
- **Reuse the shipped audit core.** Ledger coherence (undispatched / invalid-outcome / clean) is already computed by `auditLedger()` — call it, don't reimplement.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` `cmdEvents` / events reader (~7741) | Node | Timeline reader to reuse for loading `events.jsonl` |
| `plugin/skills/faff/bin/faff` `readLedger` (~823) / `auditLedger` (~830) | Node | Ledger load + coherence core to reuse verbatim |
| `plugin/skills/faff/bin/faff` `cmdRuncheck` (~956) | Node | Pattern for a ledger-consuming read command |
| `.faff/provenance/<ISSUE>.json` (FAFF-212/220) | JSON | Per-issue intake proof to join in |

**Scope statement.** `faff audit` sits beside `faff runcheck` and `faff events read` as a third read-side view over `.faff/runs/<id>/` — the only one that joins all three substrates per run.

## 2. OUT OF SCOPE

- **Escaped-side-effect detection** — *Why:* that's the detection half, FAFF-106 (a declared-effects ledger + escape signal). *Extension point:* a future `audit` could surface FAFF-106's escape signals once they exist, but this issue only reconstructs what's already recorded.
- **Tamper-evidence / signing** — *Why:* consciously deferred (append-only sufficient for v1, ADR-0010). `audit` trusts the files as-is. *Extension point:* a later `--verify` flag could check a signature once the trail is signed.
- **Live spend recomputation** — *Why:* live token spend needs the run's transcript (may be gone post-run) and a non-deterministic read; `audit` must stay deterministic. *Extension point:* `faff budget check` already owns live recomputation. `audit` surfaces only the budget envelope + `budget-checkpoint` events recorded in the run.
- **Cross-run correlation** — *Why:* one run per invocation keeps v1 thin. *Extension point:* a future `faff audit --since` over multiple run dirs.
- **Recovery / rollback** — *Why:* FAFF-37, separate L4 project.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Run dir | `<root>/.faff/runs/<run-id>/` — holds `events.jsonl` + `run-ledger.json` for one run |
| Reconstruction | The joined per-run record `audit` emits |
| Issue rollup | The per-admitted-issue join: provenance + its events + its ledger outcome |
| Coherence finding | A discrepancy between substrates (undispatched, invalid outcome, events↔ledger mismatch, missing substrate) |

**Command surface:**

```
faff audit <run-id> [--root DIR] [--issue ISSUE] [--json] [--selftest]
```

- `<run-id>` — required positional; resolves to `<root>/.faff/runs/<run-id>/`.
- `--root DIR` — project root override (default `findRoot()`), per CLI convention.
- `--issue ISSUE` — narrow the reconstruction to a single admitted issue's rollup (run-level summary still shown).
- `--json` — emit the machine object (below); default is aligned human text.
- `--selftest` — in-memory table, `ok`/`FAIL` lines + `RESULT:` summary, exit 0/1.

**Reconstruction object (the `--json` shape):**

```
RECORD Reconstruction:
  run_id: string
  run_dir: string                       # resolved path
  lifecycle: RECORD:
    started_at: ISO-8601 | null         # from run-start event, else ledger.owner.started_at
    ended_at: ISO-8601 | null           # from run-end event; null => no clean end
    duration_secs: number | null        # ended_at - started_at; null if either missing
    complete: bool                      # true iff a run-end event exists
    phases_seen: List<phase>            # distinct phases present, in first-seen order
    owner: { status, session_id?, started_at?, last_heartbeat? } | null   # from ledger
  issues: List<IssueRollup>             # one per admitted issue (union issues seen in events)
  budget: RECORD:
    envelope: object | null             # ledger.budget.envelope verbatim
    tokens_at_start: number | null
    checkpoints: List<{ seq, ts, data }>  # budget-checkpoint events, in seq order
  coherence: RECORD:                    # from auditLedger + the cross-substrate checks
    clean: bool
    undispatched: List<issue>           # admitted, no ledger outcome
    invalid_outcomes: List<{issue, outcome}>   # outcome not in TERMINAL_STATES
    mismatches: List<{issue, ledger_outcome, event_outcome}>   # ledger vs last issue-outcome event
    missing_substrates: List<"events"|"ledger">   # which core files were absent
  discovered_scope_filed: number | null # from ledger

RECORD IssueRollup:
  issue: string
  provenance: { via, ts, reason?, initiated? } | { absent: true }   # from provenance/<issue>.json
  events: List<{ seq, ts, phase, type, data? }>   # this issue's events in seq order
  outcome: terminal-state | null        # ledger.outcomes[issue]
  park_cause: string | null             # from the issue's park event data, if any
```

**Design decisions** (full rationale in §6):

- **Chosen:** run-id resolves directly to `<root>/.faff/runs/<run-id>/`; no fuzzy/prefix matching in v1.
- **Chosen:** the issue set is the **union** of `ledger.admitted` and issues appearing in events — so an issue that produced events but never made the ledger (and vice-versa) still surfaces, flagged in coherence.
- **Chosen:** coherence is always computed and reported; `audit` does **not** gate on it (exit stays 0 for a readable run).

## 4. HOW — Behavior

**Architecture.** One new `cmdAudit(args)` registered as `"audit"` in `COMMANDS`. It: parses flags → resolves run dir → loads the substrates via the existing readers → builds the `Reconstruction` → renders (text or JSON). It reuses `readLedger`, `auditLedger`, and the events reader; it adds only the cross-substrate join and rendering.

```
PROCEDURE cmdAudit(args):
  1. Parse flags (run-id positional; --root, --issue, --json, --selftest).
  2. IF --selftest: run table; return 0/1.
  3. IF no run-id: stderr "faff audit: <run-id> required"; return 2.
  4. runDir := <root>/.faff/runs/<run-id>
     IF runDir does not exist: stderr "faff audit: no run dir for <run-id>"; return 3.
  5. events := load events.jsonl if present, else [] (record "events" in missing_substrates)
     ledger := readLedger(runDir) if present, else null (record "ledger" in missing_substrates)
     IF both absent: stderr "faff audit: <run-id> has no events or ledger"; return 3.
  6. Build lifecycle (run-start/run-end events; fall back to ledger.owner for started_at).
  7. issueSet := union(ledger.admitted ?? [], distinct issue from issue-scoped events)
     For each issue: build IssueRollup (provenance file read, events filtered by issue in seq order,
       ledger outcome, park_cause from its park event's data).
     IF --issue: filter to that one (still build run summary); empty => note + exit 3.
  8. Build budget (ledger.budget envelope + tokens_at_start + budget-checkpoint events).
  9. coherence := auditLedger(ledger) + cross-checks:
       - mismatches: per issue, compare ledger.outcomes[issue] vs its last issue-outcome event data.outcome
       - missing_substrates as recorded above
 10. Render: --json => JSON.stringify(Reconstruction); else aligned human text; return 0.
```

**Text rendering (default — skimmable).** A run header (id, started/ended/duration or "incomplete", phases, owner status), then a one-line-per-issue table (`ISSUE  via/initiated  outcome  [park cause]`), then a budget line (envelope ceilings + checkpoint count), then a coherence block (`clean` or the itemised findings). Lists, never run-on prose.

**Edge cases and error handling:**

- **Missing run dir** → exit 3 (file-not-found class).
- **Run dir present, both core files missing** → exit 3.
- **Only one core substrate present** → reconstruct from it, list the other in `missing_substrates`, exit 0.
- **No `run-end` event** → `lifecycle.complete=false`, `ended_at=null`, `duration_secs=null`; text shows "incomplete / no clean end".
- **Provenance file absent for an issue** → `provenance:{absent:true}` (legacy/never-stamped), not an error.
- **Malformed `events.jsonl` line** → skip-and-note unparseable lines as a coherence finding; never crash the whole reconstruction.
- **`--issue` names an issue not in the run** → exit 3 with a clear message.

**Failure modes:**

- **The failure:** events↔ledger join is keyed on issue id; if a run ever recorded an issue under inconsistent ids, rollups would split. **How you'd know:** the same logical issue appears twice in `issues` with complementary halves (events-only + ledger-only). **What it means:** proceed — the union + coherence findings make it *visible* rather than hidden, which is the forensic goal.
- **The failure:** treating a still-running run as "complete" because a stale ledger says `owner.status=done`. **How you'd know:** `complete=false` (no run-end) while owner says done — surfaced as a coherence finding. **What it means:** proceed; report both signals, don't adjudicate liveness (that's `runcheck`'s job).

**Anti-pattern:** recomputing live token spend inside `audit`. Why: it needs the transcript and is non-deterministic — it would break the read-only/deterministic guarantee and duplicate `faff budget check`.

**Anti-pattern:** exiting non-zero on an incoherent-but-readable run. Why: forensics must still produce the reconstruction precisely when the run is broken; coherence is *reported*, not gated.

## 5. SCENARIOS

```
Given a completed run dir with events.jsonl, run-ledger.json, and provenance markers
When `faff audit <run-id>` runs
Then it prints the run lifecycle, one rollup per admitted issue (provenance via/initiated + outcome),
     a budget summary, and "coherence: clean", exiting 0
```

```
Given a run dir whose ledger lists an admitted issue with no recorded outcome (undispatched)
When `faff audit <run-id> --json` runs
Then coherence.undispatched contains that issue, coherence.clean is false, and exit is still 0
```

```
Given a run dir with events.jsonl but no run-ledger.json
When `faff audit <run-id>` runs
Then it reconstructs from events, lists "ledger" in missing_substrates, and exits 0 (not 3)
```

```
Given a run-id with no directory under .faff/runs/
When `faff audit <run-id>` runs
Then it writes "faff audit: no run dir for <run-id>" to stderr and exits 3
```

```
Given an issue whose last issue-outcome event disagrees with its ledger outcome
When `faff audit <run-id>` runs
Then coherence.mismatches names {issue, ledger_outcome, event_outcome}
```

*Constraint (non-functional):* `audit` performs no writes, no network calls, and no tracker/LLM access — pure reads under `<root>/.faff/`.

## 6. DESIGN DECISION RATIONALE

**How should `<run-id>` resolve to a directory?**
- Options: (a) exact `.faff/runs/<run-id>/`; (b) prefix/fuzzy match against existing run dirs.
- (b) is friendlier but non-deterministic when prefixes collide and invites ambiguity.
- **Chosen:** (a) exact resolution — deterministic, simple; a `--latest`/prefix convenience can come later.

**What is the issue set — ledger.admitted, or events too?**
- Options: (a) ledger.admitted only; (b) union of admitted + issues seen in events.
- (a) hides an issue that produced events but never reached the ledger — exactly a forensic case worth seeing.
- **Chosen:** (b) union, with the difference surfaced in coherence.

**Should incoherence change the exit code?**
- Options: (a) always exit 0 for a readable run; (b) exit 1 when incoherent.
- A gate is useful for CI but conflicts with "always produce the reconstruction"; mixing them risks a script treating a *reported* problem as a *crash*.
- **Chosen:** (a) for v1. **Punt:** an opt-in `--strict` (exit 1 on incoherence) for CI use — needs a human call on whether that's wanted now.

**Should budget spend be recomputed?**
- **Chosen:** no — surface ledger envelope + `budget-checkpoint` events only; live recompute stays in `faff budget check` (keeps `audit` deterministic).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:**

- **Punt:** `--strict` exit-1-on-incoherence flag — include in v1 or defer? Default behaviour (always exit 0, report coherence) is unaffected either way; this only adds an opt-in CI gate. Non-blocking — v1 ships without it unless a reviewer wants it now.

**Assumptions:**

- **Assumes:** `readLedger` and `auditLedger` are callable as in-process helpers within the binary (explore confirms ~lines 823/830). *Validation:* grep the binary for both before building; if `auditLedger` isn't cleanly reusable, factor the shared core rather than copy it.
- **Assumes:** the events reader exposes a way to load+parse `events.jsonl` to records (explore confirms reader ~7741). *Validation:* reuse the existing parse path; if it's entangled with CLI arg handling, extract a `readEvents(runDir)` helper mirroring `readLedger`.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff audit <run-id>` exists, reads only on-disk state under `<root>/.faff/`, and writes/calls nothing external (read-only/deterministic verified by test).

### From WHAT (surface + types)
- [ ] Command registered as `"audit"` in `COMMANDS`; accepts `<run-id>`, `--root`, `--issue`, `--json`, `--selftest`.
- [ ] `--json` emits the `Reconstruction` object with the specified fields (lifecycle, issues[], budget, coherence, discovered_scope_filed).
- [ ] Each `IssueRollup` joins provenance (via/initiated or `absent`), the issue's events in seq order, ledger outcome, and park cause.

### From HOW (behaviour)
- [ ] Issue set is the union of `ledger.admitted` and issues seen in events.
- [ ] Lifecycle: `duration_secs` from run-start→run-end; `complete=false` and null end when no run-end.
- [ ] Budget surfaces ledger envelope + tokens_at_start + budget-checkpoint events; never recomputes live spend.
- [ ] Coherence reuses `auditLedger` and adds events↔ledger `mismatches` + `missing_substrates`.
- [ ] Default text output is skimmable (lists/tables, no run-on prose).

### From HOW (edge cases)
- [ ] Missing run dir → exit 3; both core files missing → exit 3; one substrate missing → exit 0 with `missing_substrates`.
- [ ] Absent provenance file → `{absent:true}`, not an error.
- [ ] Malformed events line → noted as a coherence finding, reconstruction still produced.
- [ ] `--issue` not in run → exit 3 with message.

### From conventions
- [ ] `--selftest` in-memory table passes (exit 0); `RESULT:` summary line present.
- [ ] USAGE row added; `docs/guide/cli.md` row added; `faff lint-cli-doc` passes.
- [ ] `test/audit.test.mjs` covers: clean run, undispatched, missing-ledger, missing-run-dir, events↔ledger mismatch, `--issue` filter, `--json` shape.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Build a temp run dir: write a 3-event events.jsonl (run-start, issue-admitted+issue-outcome=shipped, run-end),
     a matching run-ledger.json (admitted:[FAFF-1], outcomes:{FAFF-1:shipped}), a provenance/FAFF-1.json (via:jot, initiated:autonomous).
  2. Run `faff audit <run> --json`.
  3. Assert: lifecycle.complete=true, duration_secs>0, issues[0].issue=="FAFF-1",
     issues[0].provenance.via=="jot", issues[0].outcome=="shipped", coherence.clean==true, exit 0.
```

## 9. APPENDICES

*(none needed — the type notation in §3 and procedures in §4 are self-contained.)*

confidence: high
