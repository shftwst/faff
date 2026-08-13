# Informational andon messages for run lifecycle events

> Spec: faffter-dark-nlspec · 2026-08-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-781.
> build-tier: complex

## Already shipped against this surface

Related, not superseding — this feature extends them:

- **FAFF-386** (Done) — the andon pump + delivery path this reuses.
- **FAFF-35** (Done) — the `events.jsonl` substrate the new classes read.
- **FAFF-472** (Done) — wired the sentry-trip verdict into the andon; the same classifier this extends.

No Done ticket delivers informational lifecycle andon messages — the premise holds.

This spec defines an additive extension to `faff andon` (FAFF-386) that lets an operator opt into *informational* notifications for run lifecycle events — the run's admitted ticket set, and individual ticket starts — alongside the existing run-critical alerts. The audience is the build agent implementing the change and the human reviewing the PR.

## 1. WHY — Problem and Principles

**The load-bearing model:** the andon is not a set of notify call-sites — it is a *cursor-based pump* that reads the run's existing `events.jsonl`, classifies each new event against a closed set, and POSTs one deduped notification per distinct condition (records/adr/0102). Adding a new notification class means teaching the pure classifier one more event type; it needs no new call-site, no new state, and no new substrate.

**Problem statement.** `faff andon` pushes run-critical alerts (park, sentry-trip, budget-breach) and an optional run-end ping, but ignores the lifecycle events that show what the run admitted and when ticket work began. Today an operator who wants that progress must open the run log. This change surfaces those two moments as opt-in andon messages.

**Design principles.**

- **Additive-only, defaults untouched.** The existing default event set (`park`, `sentry-trip`, `budget-breach`) and the run-end opt-in must be byte-for-byte unchanged. An operator who never configures the new classes sees exactly today's behaviour. Reject any implementation that alters `ANDON_DEFAULT_EVENTS` or the run-critical classification.
- **Minimal payload to an untrusted sink.** A webhook endpoint is untrusted. Informational payloads carry issue IDs, the run id, a class, and one-line summaries only — never spec bodies, diffs, code, or transcript content. This is the same non-leak invariant the run-critical classes already hold.
- **One substrate.** The pump classifies only against `events.jsonl` (records/adr/0102). The lifecycle events it needs (`issue-admitted`, `prep-start`, `build-start`) already exist in the log — this change reads them, it never adds a new event type or a second source.
- **Fail-open, unchanged.** Informational sends obey the existing fail-open transport: a webhook failure is recorded in `andon-state.json` and the pump still exits 0. Notification outcome never gates a run.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/andon.js` | Node (CJS) | The pump — `classifyEvent`, `buildNotification`, `formatPayload`, `resolveAndonConfig`, `runPump`. All changes land here. |
| `plugin/skills/faff/bin/lib/governance-profile.js` | Node (CJS) | `DELIVERY_PROFILE.event_types` / `issue_scoped_types` — already declares `issue-admitted`, `prep-start`, `build-start`. No change needed; read-only reference. |
| `plugin/skills/faff-beep-boop/SKILL.md` | Prose (orchestrator) | Emits the lifecycle events (steps 3/4/6) and calls `faff andon pump` at every between-units checkpoint + run-end. Doc-only touch. |
| `test/andon.test.mjs` + `andonSelftest()` | Node test | Where the new classifier/payload/dedupe coverage lands. |
| `.faffrc.example.yaml` (`andon:` block) + `docs/guide/cli.md` (`andon` row) | Docs | The config surface + CLI reference for the new classes. |

**Scope statement.** This sits entirely inside the andon pump — a classifier/config/payload extension over the FAFF-386 delivery path, consuming the FAFF-35 event substrate.

## 2. OUT OF SCOPE

- **New event types.** — The three lifecycle events already exist in `DELIVERY_PROFILE`. *Why excluded:* the substrate is sufficient; adding a type would violate the one-substrate principle. *Extension point:* `governance-profile.js` `DELIVERY_PROFILE.event_types`, only if a genuinely new lifecycle moment is later needed.
- **`prep-done` / `issue-outcome` / per-issue completion messages.** — This ticket is scoped to admission and *starts*. *Why excluded:* completion is a distinct concern and outcome is already partly covered by park/run-end. *Extension point:* the same `classifyEvent` switch, adding a `prep-done`/`issue-outcome` class later by the identical pattern.
- **New pump call-sites / real-time delivery.** — Informational messages are delivered at the existing pump ticks (between-units checkpoints + run-end). *Why excluded:* reuse the existing delivery path and semantics; a per-event pump would change delivery timing and cost. *Extension point:* beep-boop could add a pump call immediately after `build-start` if lower latency is ever wanted.
- **Per-class formatting / priority customisation via config.** — Informational classes get a fixed low priority. *Why excluded:* the format presets already reshape per class; a user-tunable priority map is unjustified surface. *Extension point:* `ntfyPriority` / `formatPayload`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Informational class | An andon class that reports lifecycle progress rather than a run-critical condition. This ticket adds three: `admitted`, `prep-start`, `build-start`. |
| Run-critical class | The existing set: `park`, `sentry-trip`, `budget-breach`, `run-end`. Behaviour unchanged. |
| Admission summary | A single run-level notification listing the run's admitted ticket IDs, built from all `issue-admitted` events present in the log. |
| Dedupe key | The per-run key the pump's `notified` set collapses on, so a repeated/persisting condition notifies once. |

**Class + event-type mapping (the new rows).**

```
ENUM AndonClass (additive members):
  admitted      # from event type "issue-admitted"  — run-level, one summary
  prep-start    # from event type "prep-start"       — issue-scoped
  build-start   # from event type "build-start"      — issue-scoped
```

- `ANDON_CLASSES` gains `admitted`, `prep-start`, `build-start` (so `resolveAndonConfig` accepts them in the `events:` list).
- `ANDON_DEFAULT_EVENTS` is **unchanged** — the informational classes are opt-in.

**Dedupe keys (the pure `classifyEvent` output `key`).**

```
issue-admitted  ->  { cls: "admitted",    key: "admitted" }              # one run-level key — collapses to a single summary
prep-start      ->  { cls: "prep-start",  key: "prep-start:<issue>" }    # one per issue
build-start     ->  { cls: "build-start", key: "build-start:<issue>" }   # one per issue
```

An `issue-admitted` / `prep-start` / `build-start` event missing its `issue` field is unclassifiable and returns `null` (mirrors the existing `park`-with-no-issue rule) — except `admitted`, whose *key* is run-level but which still requires the source event to be well-formed with an `issue` (the summary needs the ID to list).

**Notification payloads (minimal).**

```
admitted:    { run_id, class:"admitted", title:"faff <run>: <N> ticket(s) admitted",
               body:"admitted: <ID>, <ID>, ..." , ts, seq:null }        # NO issue field — run-level
prep-start:  { run_id, class:"prep-start",  issue:<ID>, title:"faff <run>: <ID> prep started",  body:"stage: prep",  ts, seq }
build-start: { run_id, class:"build-start", issue:<ID>, title:"faff <run>: <ID> build started", body:"stage: build", ts, seq }
```

Each start notification identifies the run, the ticket, and the lifecycle stage (per the acceptance criteria). The admission notification identifies the run and lists its admitted tickets. No other fields — the minimal-payload invariant.

**Config surface (`.faffrc` `andon.events`).** Unchanged shape — a flow-list of class names, filtered against `ANDON_CLASSES`. An operator opts in by adding any of the three new names:

```yaml
andon:
  events: ["park", "sentry-trip", "budget-breach", "admitted", "build-start"]
```

**Design decision — one admission summary vs one message per `issue-admitted`.** A message per admitted ticket is noisy (one POST per ticket on a large queue) and answers a run-level question ("what did this run take on?") with per-item fragments. A single summary is one skimmable message. **Chosen:** one run-level admission summary keyed `admitted`, its body built from every `issue-admitted` event in the log at pump time.

**Design decision — ticket start means prep, build, or both.** The operator's interest differs (some watch prep throughput, some only care when code starts). Rather than pick one, expose both as independently opt-in classes. **Chosen:** two distinct classes, `prep-start` and `build-start`, each selected independently via `andon.events`; the payload's `stage` disambiguates. "Both" is the operator's choice — list both names.

**Design decision — default-enabled, run-end opt-in, or separate default.** Existing configs must stay compatible and quiet runs must stay quiet. **Chosen:** informational classes are opt-in (absent from `ANDON_DEFAULT_EVENTS`), following the run-end precedent. A config with no `events:` key keeps today's exact default set.

## 4. HOW — Behavior

**Architecture.** Three pure functions change; the pump loop gains one small aggregation branch; nothing else moves.

1. **`classifyEvent`** — add the three cases above, returning `{cls, key}` or `null` (issue-less start → `null`).
2. **`resolveAndonConfig`** — no logic change; it already filters `andon.events` against `ANDON_CLASSES`, so extending `ANDON_CLASSES` is sufficient to accept the new names. `ANDON_DEFAULT_EVENTS` stays as-is.
3. **`buildNotification`** — add the three cases producing the minimal payloads above. For `admitted`, the body is derived from a passed-in list of admitted IDs (see the aggregation below), keeping the function pure.
4. **`ntfyPriority`** — the three informational classes return `default` (they are not urgent; matches the run-end priority). No change to park/trip/breach priorities.
5. **`runPump`** — when it classifies an `issue-admitted` event whose `admitted` key is not yet notified, it assembles the admission summary from all `issue-admitted` events in the batch it read, then builds/sends one notification. `prep-start`/`build-start` flow through the existing per-event send path unchanged (their keys already dedupe per issue, and the existing flood-cap + rollup already bounds a noisy queue).

**The admission-summary aggregation (the one ambiguity point).**

```
PROCEDURE classify_and_send(event, config, notified):
  1. classified = classifyEvent(event)
  2. IF classified is null: advance cursor, continue          # not notification-worthy
  3. { cls, key } = classified
  4. IF cls not in config.events OR notified.has(key): advance cursor, skip++, continue
  5. IF cls == "admitted":
     a. admittedIds = [ e.issue FOR e IN batch WHERE e.type == "issue-admitted" ]   # all admitted events in this pump's read
     b. notif = buildNotification(run, seq, now, "admitted", { data: { admitted: admittedIds } })
  6. ELSE:
     a. notif = buildNotification(run, event.seq, now, cls, event)
  7. send(notif) with the existing postWithRetry + fail-open cursor-hold semantics
```

The aggregation reuses the `events` array `runPump` already read via `readEventsSince` — no second file read. Because the pump's `notified` set already holds `key`, once `admitted` is sent the later `issue-admitted` events in the same (or a later) batch match step 4's `notified.has(key)` and are skipped, so the summary is sent exactly once.

**Delivery integration (beep-boop).** No new control flow. `issue-admitted` (step 4), `prep-start` (step 3), and `build-start` (step 6) are already emitted; `faff andon pump` already runs at every between-units checkpoint and at run-end. The informational classes ride those existing invocations: the admission summary is flushed at the first between-units pump (which runs after step-4 admission completes); each start is flushed at the next pump tick after its event lands — the same delivery latency the existing park/breach classes already have. The only beep-boop change is a one-line documentation note that the between-units + run-end pumps also flush opt-in informational classes.

**Edge cases.**

- **Issue-less lifecycle event** → `classifyEvent` returns `null`; the pump advances the cursor and moves on (never a crash), mirroring `park`-with-no-issue.
- **Informational class not opted in** → step 4 skips it and advances the cursor (existing behaviour; no send, no state churn beyond `skipped++`).
- **Flood of starts on a large queue** → the existing `ANDON_FLOOD_CAP` (10) + single rollup applies unchanged; the 11th+ pending informational event collapses into the rollup.
- **Send failure on an informational notification** → the existing fail-open path: record in `failures`, hold the cursor, retry next pump, exit 0.

**Failure modes.**

- **The failure:** the admission summary is partial — it lists fewer tickets than the run admitted, because admission events landed *after* the pump already sent (and deduped) the `admitted` key.
  **How you'd know:** the summary's ticket count is lower than `run-ledger.json`'s admitted count for that run.
  **What it means:** proceed. In beep-boop's step ordering admission (step 4) completes before the first between-units informational pump (step 8.1), so at first send all `issue-admitted` events are already in the log. This is captured as an explicit `**Assumes:**` below; if a future ordering change broke it, the fix is to key the summary on run-end rather than first-sight, not a redesign.

**Anti-pattern:** adding a `faff andon send` call at each lifecycle boundary. Why: it re-introduces the per-site notify pattern records/adr/0102 rejected, multiplies seams, and cannot dedupe a persisting condition — the pump exists precisely to avoid this.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run whose events.jsonl holds three issue-admitted events (FAFF-1, FAFF-2, FAFF-3)
  and andon.events includes "admitted"
When faff andon pump runs
Then exactly one notification is POSTed, class "admitted", body listing FAFF-1, FAFF-2, FAFF-3, with no issue field
```

```
Given a run with andon.events NOT including any informational class (default config)
When faff andon pump processes issue-admitted / prep-start / build-start events
Then zero informational notifications are sent and the run-critical behaviour is byte-for-byte unchanged
```

```
Given andon.events includes "build-start" and two build-start events for FAFF-1 exist (e.g. a respec re-dispatch)
When faff andon pump runs across them
Then exactly one build-start notification for FAFF-1 is sent (dedupe key build-start:FAFF-1)
```

- The informational payloads MUST contain issue IDs, run id, class, and one-line summaries only — never spec/diff/transcript content.

## 6. DESIGN DECISION RATIONALE

**One admission summary vs per-`issue-admitted` message?** Options: (a) one summary listing all admitted IDs; (b) one message per admitted event. (a) is one skimmable message answering a run-level question; (b) is N POSTs of fragments. **Chosen:** (a) — one run-level summary keyed `admitted`.

**Ticket start = prep, build, or both?** Options: prep-only, build-only, a single "start" class, or two selectable classes. A single class can't say which boundary; a fixed choice denies operators the other. **Chosen:** two independently-opt-in classes (`prep-start`, `build-start`) with the stage in the payload — "both" is opting into both.

**Default state of informational classes?** Options: default-on, follow run-end opt-in, separate default. Default-on breaks "existing configs remain compatible / quiet runs stay quiet". **Chosen:** opt-in, absent from `ANDON_DEFAULT_EVENTS`, mirroring run-end.

**Dedup / grouping of repeated lifecycle events?** Options: new dedup mechanism, or reuse the existing `notified`-set keys + flood-cap. **Chosen:** reuse — per-issue-per-stage keys for starts, one run-level key for admission; the existing `ANDON_FLOOD_CAP` + rollup bounds a noisy run. No new state.

**Priority of informational classes?** Options: inherit a per-class map, or a fixed low priority. **Chosen:** fixed `default` (ntfy), matching run-end — informational, never urgent.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — every open question from the ticket is resolved above with a `**Chosen:**` marker.

**Assumptions:**

- **Assumes:** in beep-boop's step ordering, all `issue-admitted` events (step 4) are appended before the first between-units informational pump (step 8.1) fires, so the admission summary is complete at first send. *Validation:* confirm in `plugin/skills/faff-beep-boop/SKILL.md` that queue admission (step 4) precedes the first build-unit checkpoint pump (step 8.1) — it does today (admission is step 4; the checkpoint procedure that ends in `faff andon pump` is reached at steps 7/8.1, after the first build unit).

## 8. DONE — Definition of Done

### From WHY
- [ ] With no `andon.events` override, the resolved event set is exactly `["park", "sentry-trip", "budget-breach"]` (unchanged) and no informational notification is ever sent.
- [ ] Informational payloads contain only run id, class, issue ID(s), and one-line summary — no spec/diff/transcript content.

### From WHAT (types and interfaces)
- [ ] `ANDON_CLASSES` includes `admitted`, `prep-start`, `build-start`; `ANDON_DEFAULT_EVENTS` is unchanged.
- [ ] `resolveAndonConfig` accepts the three new names in `andon.events` and filters unknown names as before.
- [ ] `classifyEvent` maps `issue-admitted → {admitted, "admitted"}`, `prep-start → {prep-start, "prep-start:<issue>"}`, `build-start → {build-start, "build-start:<issue>"}`, and returns `null` for an issue-less start event.

### From HOW (behaviour)
- [ ] `faff andon pump` sends exactly one `admitted` notification per run, its body listing all admitted ticket IDs, with no `issue` field.
- [ ] `faff andon pump` sends one `prep-start` / `build-start` notification per issue per stage, each naming the run, issue, and stage.
- [ ] `ntfyPriority` returns `default` for all three informational classes; park/sentry-trip/budget-breach priorities are unchanged.
- [ ] A repeated start event for the same issue notifies once (dedupe key holds).
- [ ] An informational send failure records a failure, holds the cursor, and the pump still exits 0 (fail-open unchanged).

### From HOW (edge cases)
- [ ] An informational class not listed in `andon.events` is skipped and the cursor advances (no send).
- [ ] More than `ANDON_FLOOD_CAP` pending informational events collapse into the existing single rollup notification.

### Docs
- [ ] `.faffrc.example.yaml`'s `andon.events` comment documents the three opt-in informational classes.
- [ ] `docs/guide/cli.md`'s `andon` row documents the informational classes and that they are opt-in.
- [ ] `plugin/skills/faff-beep-boop/SKILL.md` notes the between-units + run-end pumps flush opt-in informational classes.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Write events.jsonl with: run-start, issue-admitted(FAFF-1), issue-admitted(FAFF-2), build-start(FAFF-1)
  2. Configure andon.url=<loopback>, andon.events=["admitted","build-start"]
  3. Run faff andon pump --run-dir <dir>
  4. Assert the loopback received: one "admitted" POST listing FAFF-1+FAFF-2, and one "build-start" POST for FAFF-1
  5. Run the pump again → zero new POSTs (dedupe)
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
