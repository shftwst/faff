# FAFF-386 — Andon light: push alerting for run-critical events

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-386.

This spec defines the andon light — faff's push-notification channel for run-critical events — for the build agent and human reviewers. It answers the open question FAFF-35 (run observability, Done) deliberately left behind: the pull surface exists (`events.jsonl`, run ledger, `/faff-wtf`); nothing *tells* the human when a run parks, trips Sentry, or breaches budget at 3am.

## 1. WHY — Problem and Principles

**The load-bearing model:** every run-critical moment already lands in one place — the run's append-only `events.jsonl` (hard-floor artifact, single-writer, monotonic `seq`). So push notification is not a new detection system; it is a **cursor-based pump over the existing event log**: a deterministic CLI reads events since the last-notified `seq`, classifies each against a small run-critical set, and POSTs one skimmable notification per critical event to a configured webhook. The orchestrator invokes the pump at the checkpoints where it already runs `faff sentry check` / `faff budget check` — no daemon, no new writer, no second source of truth.

**Problem statement:** the notification model is entirely pull — a human learns a run parked, breached budget, or tripped Sentry only by reading the morning `/faff-wtf`. A run that dies at 3am waits silently until someone polls the board. This change pushes those events to the human over a channel-agnostic webhook, without them polling.

**Design principles:**

**Fail-open, never load-bearing.** Notification failure must never affect the run. A down webhook, a bad URL, a timeout — the pump logs it and exits 0; the pipeline's correctness machinery (park protocol, ledger, runcheck, Sentry) is untouched. An implementation where a notify error can park an issue or halt a queue is wrong.

**Deterministic classification, thin transport.** Which events are run-critical, dedupe, and payload construction are a pure function of the event log + config — testable, reproducible, in the CLI. The LLM is nowhere in the loop. The transport is a dumb formatter + HTTP POST behind config.

**Configurable, not opinionated — the channel is the human's config value, not faff's taste call.** faff ships a channel-agnostic HTTP POST; the human points it at ntfy, Slack, Discord, or anything else that accepts a webhook by setting one URL. Off by default: no URL configured → the andon is dark and makes zero network calls.

**Minimal payload to an untrusted sink.** The webhook endpoint is a third party. Notifications carry issue IDs, event class, and one-line summaries only — never spec bodies, diffs, code, or transcript content.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/faff` (`cmdEvents`, ~line 9312; `EVENT_TYPES` ~line 9323) | The event log this pumps: schema-1 `RunEvent`, closed type vocabulary, `faff events append/read`. |
| `plugin/skills/faff/bin/faff` (`cmdSentry` ~line 10254, `cmdBudget` ~line 2413) | The report-only checks whose trip/breach payloads become notifications; both always exit 0 — the same posture the pump adopts. |
| `plugin/skills/faff-beep-boop/SKILL.md` (step 8.1 between-units checkpoint) | The existing chokepoint where sentry + budget checks fire after every prep/build return and wave boundary — the pump's call site. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Existing zero-dependency `node:http`/`node:https` transport precedent (retries, timeouts, no npm deps). |
| `test/events.test.mjs`, `test/sentry.test.mjs`, `test/helpers/run-cli.mjs` | Test layout the new `test/andon.test.mjs` follows (`node --test`, spawn the CLI, fixture run dirs). |
| `docs/guide/cli.md`, `.faffrc.example.yaml` | Docs surfaces the build must extend (CI `lint-cli-doc` fails a COMMANDS entry with no docs row). |

**Scope statement:** this is the push half of run observability — a new `faff andon` subcommand in the governance region of the existing dependency-free CLI, plus two one-line orchestrator prose hooks; it sits downstream of the shipped event log (FAFF-35), Sentry (FAFF-49), and budget (FAFF-36) substrate.

## 2. OUT OF SCOPE

- **Email / SMTP transport** — needs credentials, a relay, and non-trivial delivery machinery that contradicts the zero-dependency CLI; every push-style candidate the ticket names is reachable by HTTP POST. Extension point: a new `format` preset plus transport branch in `cmdAndon`, or a swappable transport producer (below).
- **OS desktop notifications** — the run host is typically headless/remote (tmux over SSH, container); a host-local toast notifies nobody. Extension point: an `osascript`/`notify-send` format preset in `cmdAndon` if ever wanted.
- **A `notify` transport slot (swappable producer skill)** — the transport here is ~50 lines of mechanical POST; a slot is a skill-level seam and is not earned yet. Extension point: if a real deploy-grade notifier appears, wrap `faff andon send` behind a slot the same way `ship` wraps merge mechanics.
- **Two-way control (ack / unpark-by-reply)** — inbound authority is Sentry-2 corrective-authority territory with its own integrity gates; the andon is strictly outbound. Extension point: FAFF-278/FAFF-373's channel model.
- **Digest/batching windows, quiet hours, per-class routing to different URLs** — v1 is one URL, one critical set, per-event sends with a flood cap. Extension point: `andon.*` config keys.
- **Incident records / postmortem loop** — FAFF-393 consumes the same classification later; this ticket only emits notifications.
- **Notifying interactive sessions** — the pump call sites are the autonomous orchestrator's; an interactive human is already watching.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| andon | The push channel as a whole — production-line andon light: it turns on when the line needs a human. |
| run-critical event | An event a human should learn about without polling: a park, a Sentry trip, a budget breach (and, opt-in, run-end). |
| pump | One invocation of `faff andon pump`: read new events since the cursor, classify, send, advance. |
| cursor | The last event `seq` the pump has fully processed, persisted per run. |
| class | The notification taxonomy: `park` \| `sentry-trip` \| `budget-breach` \| `run-end`. |

**Configuration (`.faffrc.yaml`, new top-level block; all keys optional; read via `faff config get andon.<key>` only):**

```
RECORD AndonConfig:
  url: string?                 # webhook URL; UNSET => andon disabled entirely (no-op, no network)
  format: enum = generic       # generic | ntfy | slack | discord — payload shaping preset
  token: string?               # sent as `Authorization: Bearer <token>` when set (ntfy/self-hosted auth)
  events: list<string> = ["park", "sentry-trip", "budget-breach"]   # the run-critical set; add "run-end" to opt in
```

`.faffrc.yaml` is gitignored, so `url`/`token` (both secret-bearing) have an acceptable home there — same posture as the existing `faffter_dark.adversarial` block. Timeout (5s), retry count (1), and the flood cap (10) are built-in constants, not config keys — a user has no basis to tune them (same rule as the calibration thresholds).

**New event type (additive vocabulary extension, schema stays 1):** `sentry-trip` joins `EVENT_TYPES` (not issue-scoped; `data` carries the sentry `verdicts` + `intervention`). The orchestrator appends it at the checkpoint where `faff sentry check` returns `tripped: true`. Existing readers filter by type, so an unknown-to-them type is inert — no schema bump needed. The other two classes need no new types: `park` events exist, and every `budget-checkpoint` event already embeds the full `BudgetState` (`data.breached`).

**Pump state (per run, written only by the pump — the same single-writer process as the event log):**

```
RECORD AndonState:                      # .faff/runs/<run-id>/andon-state.json
  cursor: int = 0                       # first unprocessed seq
  notified: list<string>                # dedupe keys already sent (see dedupe rule)
  failures: list<{ ts, seq, error }>    # send failures, for the morning surface
```

**Notification payload (the `generic` format; presets reshape this, never extend it):**

```
RECORD AndonNotification:
  run_id: string
  class: park | sentry-trip | budget-breach | run-end
  issue: string?                        # for park
  title: string                         # one line, e.g. "faff run-20260707: FAFF-386 parked"
  body: string                          # <= ~3 skimmable lines: cause one-liner / breached dims / trip signal
  ts: ISO-8601
  seq: int                              # source event seq (traceability back to events.jsonl)
```

Format presets: `generic` → POST the record as JSON; `ntfy` → plain-text `body` with `Title:` and `Priority:` headers (`sentry-trip`/`budget-breach` → urgent, `park` → high, `run-end` → default); `slack` → `{"text": "<title>\n<body>"}`; `discord` → `{"content": ...}`.

**CLI surface:**

- `faff andon pump --run-dir <dir> [--json]` — the one orchestrator-facing verb. Exit 0 always (including disabled / nothing-new / send-failed); exit 2 on usage error only, mirroring `sentry check` / `budget check`. `--json` emits `{ disabled, sent, failed, skipped, cursor }`.
- `faff andon send --class <c> --title <t> --body <b> [--issue <i>]` — direct one-shot send bypassing the event log (the escape hatch for callers outside a run dir, e.g. the lights-out runner's own fatal errors). Same config, formats, exit posture.
- Registered in `COMMANDS` (single source of truth), documented in `docs/guide/cli.md`, `--selftest`-covered like sibling governance commands.

**Design decisions** (rationale collected in section 6): **Chosen:** cursor-pump over events.jsonl invoked at existing chokepoints (no daemon) · **Chosen:** channel-agnostic HTTP webhook with format presets, off unless `andon.url` set · **Chosen:** the run-critical set is `park`, `sentry-trip`, `budget-breach`, with `run-end` opt-in · **Chosen:** classification/transport split inside one subcommand · **Chosen:** transport lives in the faff binary on `node:http(s)` built-ins · **Chosen:** secrets in gitignored `.faffrc` · **Chosen:** at-least-once delivery with per-run dedupe + flood cap · **Chosen:** minimal payload.

## 4. HOW — Behavior

The pump reads new events, classifies, dedupes, sends, and advances the cursor only past what it fully handled.

```
PROCEDURE andon_pump(run_dir):
  1. config := read andon.* via the config resolver
     IF config.url unset: print { disabled: true }; EXIT 0        # zero network, zero state writes
  2. state := read andon-state.json (absent => { cursor: 0, notified: [], failures: [] })
  3. events := parse events.jsonl lines with seq >= state.cursor
     a. a malformed line: skip it, count it in --json output, never abort
  4. FOR each event, in seq order:
     a. classify:
        - type == "park"                                   => class park (dedupe key "park:<issue>:<seq>")
        - type == "sentry-trip"                            => class sentry-trip (key "sentry:<sorted signal names>")
        - type == "budget-checkpoint" AND data.breached≠[] => class budget-breach (key "budget:<sorted breached dims>")
        - type == "run-end"                                => class run-end (key "run-end")
        - anything else                                    => not critical; advance past it
     b. IF class not in config.events, OR key in state.notified: advance past it
     c. build AndonNotification; format per config.format; POST (5s timeout, 1 retry, https or http per URL)
     d. on success: append key to state.notified; advance cursor to seq+1
        on failure: record in state.failures; STOP advancing (cursor stays => at-least-once retry next pump)
  5. flood cap: max 10 sends per pump; if more critical events remain, send ONE rollup
     notification ("...and N more run-critical events — see the run log") covering them,
     mark their keys notified, advance past them
  6. write andon-state.json; print --json report; EXIT 0
```

**Behavior summary — why dedupe keys, not just the cursor:** breach state *persists*: once budget is breached, every later `budget-checkpoint` event also carries `breached ≠ []`, and a tripped sentry stays tripped at every later checkpoint. The cursor alone would notify the same breach at every checkpoint (a 3am notification storm). The per-run dedupe key collapses each persisting condition to one notification per distinct condition (a *new* breached dimension set or *new* trip signal set still notifies). Parks key on issue+seq — two parks of two issues are two notifications, correctly.

**Orchestrator wiring (prose, two sites):**

1. `/faff-beep-boop` step 8.1 (the between-units checkpoint): after the existing `faff sentry check` / `faff budget check` calls — and after appending a `sentry-trip` event when `tripped: true` first observed — run `faff andon pump --run-dir "$run_dir"`. One added line each; the pump's cursor makes repeated calls idempotent.
2. Run end (after the `run-end` event append, before the summary): run the pump once more so terminal parks and the opt-in run-end ping flush.

The lights-out runner inherits both for free (it drives beep-boop). No other skill changes.

**Edge cases and error handling:**

- **Disabled** (no `andon.url`): complete no-op — no state file created, no network. The one un-notifiable gap is deliberate: faff never conjures a channel the human didn't configure.
- **Send failure** (timeout, non-2xx, DNS): retryable once in-call; then recorded in `state.failures`, cursor held, exit 0. Next pump retries. Terminal for the event only if the flood-cap rollup covers it.
- **Absent/empty events.jsonl**: `{ sent: 0 }`, exit 0.
- **`http://` URLs**: allowed (LAN ntfy is a real deployment); the docs row notes that a public webhook should be https and that the URL+token are secrets.
- **Concurrent pumps**: not designed for — the pump runs in the orchestrator's single-writer lane, same guarantee as `events append`. State writes are atomic (tmp+rename, the `atomicWriteLedger` pattern).
- **Mid-run enable** (human sets `andon.url` during a run): first pump starts from cursor 0; the flood cap bounds the catch-up burst to 10 + rollup.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The andon can't alert about its own death.** A down webhook at 3am means silence — indistinguishable from a quiet run. How you'd know: `state.failures` is non-empty and the morning `/faff-wtf`/run summary surfaces "andon: N sends failed" from the pump's `--json` reports in the run log. What it means: accepted for v1 — the pull surface remains the backstop; a heartbeat-style "run started" ping (add `run-start` to `andon.events`) is the cheap operator mitigation.
- **Chokepoint-gated latency.** The pump fires only when the orchestrator reaches a checkpoint; a build subagent hung for 2h delays the park notification 2h. How you'd know: the `sentry-trip` for `wall-clock-runaway` fires at the *next* checkpoint... which is the same gate. What it means: true push-on-occurrence needs a supervisor process outside the orchestrator (Sentry-2 territory) — out of scope, named so the reader doesn't mistake this for real-time.
- **Orchestrator forgets to append `sentry-trip`.** Classification then never sees trips. How you'd know: `test/andon.test.mjs` covers classification, but the prose seam is unenforced — the audit trail (`faff audit`) showing a tripped run with no `sentry-trip` event. What it means: acceptable prose seam v1, same trust level as every other beep-boop event append.

**Anti-pattern:** blocking or failing the run on notification outcome. Why: the andon is telemetry, not a gate; the park/ledger/runcheck machinery is the correctness layer.
**Anti-pattern:** re-deriving trip/breach state inside the pump (re-running sentry/budget checks). Why: two sources of truth drift; the event log is the substrate — if it isn't in events.jsonl, the andon doesn't know it.

## 5. SCENARIOS

```
Given a run dir with andon.url set and an events.jsonl containing a park event for FAFF-123
When faff andon pump --run-dir runs
Then exactly one POST lands whose payload names FAFF-123, class park, and the run id
  And andon-state.json's cursor sits past the park event
```

```
Given the previous scenario has completed
When faff andon pump runs again with no new events
Then zero POSTs are made and the exit code is 0
```

```
Given five budget-checkpoint events all carrying breached: ["tokens"]
When the pump processes all five
Then exactly one budget-breach notification is sent
```

```
Given a webhook endpoint that refuses connections
When the pump processes a park event
Then the exit code is still 0, the cursor does not advance, and the failure is recorded
  And a later pump against a recovered endpoint delivers the park notification
```

```
Given no andon.url in config
When the pump runs on a run dir full of critical events
Then no network connection is attempted and no state file is written
```

Assertions (non-functional): notification payloads contain no spec/diff/code/transcript content — IDs, class, and one-liners only · a pump over 50 critical events makes at most 11 POSTs (10 + rollup) · `faff andon` adds no npm dependency (node built-ins only).

## 6. DESIGN DECISION RATIONALE

**How does the notification learn about events — daemon, per-site calls, or a log pump?** A watcher daemon is a new long-lived process faff doesn't have (disproportionate). Per-event-type call sites (`faff andon notify --type park ...` sprinkled through prose) multiply seams and can't dedupe. **Chosen:** cursor-pump over `events.jsonl` at the existing checkpoints — the log is already hard-floor, single-writer, and complete for the critical set once `sentry-trip` is added; one prose line per chokepoint; idempotent by cursor.

**Which channel first — email, Slack/Discord webhook, ntfy, OS notification?** Three of the four are one HTTP POST apart; email and OS toasts are the structural outliers (SMTP infra / headless host). Picking a named service would be faff choosing the human's taste. **Chosen:** channel-agnostic HTTP POST + format presets (`generic`/`ntfy`/`slack`/`discord`), destination and enablement owned by config, dark by default. *(Autonomous resolve-attempt: grounded in the configurable-not-opinionated tenet + the zero-dependency CLI constraint; if the human wants email-first, comment and re-prep — the transport branch is the extension point.)*

**Which events are run-critical?** The ticket names park / Sentry fire / budget breach, and asks about a fully-down adversarial chain. The first three map 1:1 onto existing signals (`park` events; `tripped: true`; `breached ≠ []`). A fully-down adversarial chain already escalates to needs-human/park under the shipped autonomous-gate rules, so it arrives through the `park` class — a fourth class would double-count it. **Chosen:** `park` + `sentry-trip` + `budget-breach` default; `run-end` (and even `run-start`) opt-in via `andon.events`; no adversarial-specific class.

**Split channel-transport from event-classification?** **Chosen:** yes — classification/dedupe/payload is a pure, loopback-testable function; transport is a formatter + POST swap-point (presets now, a slot later if earned). Both live in one subcommand: a second artifact for 50 lines of POST is not worth the seam.

**Where does the HTTP code live — the binary or a sibling helper like review-call.mjs?** review-call.mjs is skill-scoped because the adversarial reviewer is a swappable slot occupant; the andon is core governance (the same boundary as ledger, events, budget, sentry — all in the binary). **Chosen:** inline in the binary on `node:http`/`node:https` built-ins — the first outbound-network code in the binary, contained to `cmdAndon`, zero new dependencies, testable against an in-test loopback server. The pure-function invariant stays per-command (runcheck/label/eligible unchanged); the docs mark `andon` as the one network-touching command.

**Delivery semantics?** Exactly-once needs an acked protocol a webhook doesn't give. **Chosen:** at-least-once — cursor advances only past delivered (or rollup-covered) events; dedupe keys stop persisting-condition storms; flood cap 10+rollup stops pathological bursts. Duplicate delivery on a crash between POST and state write is acceptable (a duplicate ping beats a lost park).

**Secrets handling?** **Chosen:** `andon.url`/`andon.token` in gitignored `.faffrc.yaml` (existing precedent for secret-bearing config); never echoed into logs, notifications, or `--json` output (the report prints send counts, not the URL). At the time of writing there is no faff-wide secrets store; if one appears, these keys migrate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** `events.jsonl` is written on every autonomous run regardless of `logging: essential` (hard floor). *Validate:* confirmed in `cmdEvents` + real run dirs; re-check the hard-floor note in the beep-boop skill before building.
- **Assumes:** beep-boop step 8.1 is the single between-units checkpoint where sentry/budget already fire. *Validate:* read `plugin/skills/faff-beep-boop/SKILL.md` step 8.1 before adding the pump line.
- **Assumes:** adding a member to `EVENT_TYPES` is additive for all readers (`events read`, `sentryReadEvents`, `faff audit` filter by type). *Validate:* grep each reader for type-exhaustive switches before extending; none found at spec time.

## 8. DONE — Definition of Done

### From WHY
- [ ] A run-critical event reaches a configured webhook without the human polling (the ticket's acceptance line): a parked issue in a live run produces a POST at the next checkpoint.
- [ ] With `andon.url` unset, no code path opens a network connection (grep + test).

### From WHAT (types and interfaces)
- [ ] `faff andon pump --run-dir` and `faff andon send` exist in `COMMANDS`, exit 0 on all non-usage outcomes, exit 2 on usage error, support `--json`.
- [ ] `andon.url` / `andon.format` / `andon.token` / `andon.events` resolve via the config CLI with the documented defaults; `.faffrc.example.yaml` gains the block.
- [ ] `sentry-trip` is a valid `EVENT_TYPES` member (schema 1, not issue-scoped) accepted by `faff events append` and inert to existing readers.
- [ ] `andon-state.json` matches the AndonState record and is written atomically.
- [ ] All four format presets produce the documented payload shapes (asserted against a loopback server).

### From HOW (behaviour)
- [ ] Cursor semantics: processed events are never re-sent; an undelivered event is retried on the next pump (at-least-once).
- [ ] Dedupe: a persisting breach/trip across N checkpoint events notifies once; a new breached-dimension set or signal set notifies again.
- [ ] Flood cap: >10 pending critical events → 10 sends + 1 rollup, all marked notified.
- [ ] Fail-open: connection-refused/timeout/non-2xx → exit 0, failure recorded, cursor held.
- [ ] Malformed events.jsonl line → skipped and counted, pump completes.
- [ ] beep-boop SKILL.md step 8.1 + run-end carry the pump invocation and the `sentry-trip` append; `docs/guide/cli.md` gains the `andon` row (CI `lint-cli-doc` green).

### From HOW (edge cases)
- [ ] Mid-run enable starts at cursor 0 and is bounded by the flood cap.
- [ ] Payload-minimisation assertion: no notification field contains more than title/body one-liners + IDs.

**Eval coverage:** no LLM-judgement seam is introduced (classification is deterministic) — no grader KIND required.

**Integration smoke test:** fixture run dir with a park + a breached budget-checkpoint event; in-test `node:http` loopback server; `faff andon pump` → assert exactly two POSTs with correct classes, cursor advanced; second pump → zero POSTs; kill the server, append another park, pump → exit 0, cursor held; restart server, pump → the park arrives.

## Already shipped against this surface

Related Done work — context, none superseding (the push transport is greenfield; grep confirms zero webhook/ntfy/slack/email references in production paths):

- FAFF-35 (Done 2026-06-26) — the pull surface this pushes on top of: `events.jsonl` + `faff events`; explicitly deferred push as its named open question.
- FAFF-49 (Done 2026-06-29) — Sentry derailment detection: defines what a "Sentry fire" is; report-only, notifies nobody.
- FAFF-36 / FAFF-312 (Done) — budget check + its demotion to runaway backstop: defines "budget breach" (`breached ≠ []`).
- FAFF-353 (Done 2026-07-05) — adversarial full-chain outage escalates instead of silent pass+skip — which is why that condition arrives via the `park` class here rather than needing its own.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — one subcommand + one enum member + two one-line prose hooks + tests + docs is a single 1–2 day unit; the spec's out-of-scope list (email, slots, two-way control, digests) is doing the splitting work already.
- **Workstream fit?** The issue sits in the team backlog with no project, but it is squarely lights-out observability/trust work — the natural home is the "Trustworthy lights-out — harden & broaden (post-v1)" outcome. Recommended action: rehome into that project (human confirm — new work lands in plain backlog by design, this is a propose).
- **Deps surfaced?** No issues — every substrate dependency (event log, Sentry, budget) is Done; no blocker edges needed. FAFF-393 (incident loop) and FAFF-394 (scheduled runs) are downstream consumers and are already linked as related, which is the right edge type.
- **Risk profile?** Low — the one external integration (webhook POST) is loopback-testable and fail-open; no de-risking spike warranted. The named residual (chokepoint-gated latency, andon can't report its own death) is accepted-and-documented, not hidden.

## Spec review

- Verdict: **approve** (spec-review gate, `faffter-noon-spec-review` single-pass; lenses fired: architectural / infosec / methodology / QA — fail-safe all-four on a mixed surface; zero objections; `faff contract spec-review-verdict` exit 0).
