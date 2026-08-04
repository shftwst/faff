# Spec — FAFF-719: stream the headless watcher's live output (the away-from-keyboard view)

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-719.

## 1. WHY — problem and principle

The watchers give a **durable, post-hoc** record — the run-ledger, `events.jsonl`, and `faff disposition`'s exit + `--json`. What they don't give is a **live** view of a running unattended drain: the "watch it from your phone while away" case. That live view is a **harness capability, not a faff feature** — Claude Code's `claude -p --output-format stream-json --verbose` emits the run turn-by-turn, and faff runs *inside* the harness, so whatever it emits can be streamed. It matters most on the Actions-free fly path, where a bare Machine has no Actions UI already tailing step logs. The rig doc should tell an operator how to wire it, and be clear it complements — never replaces — the durable observability.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: the deliverable is a "Watching a run live" section in `docs/guide/self-hosted-rig.md`, placed after the window-budget section.** The rig doc is the operator-facing home an adopter is already reading when they stand the factory up; the section sits alongside the other operational concerns (auth, posture, window budget). It is prose + a one-line command, not a new mechanism.

**Chosen: the live view is `claude -p --output-format stream-json --verbose` on the drain step — a harness flag, stated as such.** The section shows adding the streaming flags to the `claude -p` call in the watcher / cron wrapper, and states plainly it is a **harness** capability (swap `claude -p` for your harness's equivalent — a Codex harness streams its own way); faff adds nothing here beyond running inside the harness. No `faff` surface is introduced.

**Chosen: the section names the durable/live split explicitly.** The **stream** is the live view (watch now); the **run-ledger + `faff disposition`** are the durable view (audit later). Complementary, not a replacement — a reader must not mistake the stream for the record of what happened; the ledger + disposition exit are what a morning review reads. Scope the "lost when you close it" caveat to the **self-exposed fly stream** specifically — on the Actions path the step's stdout is durably captured in the Actions run log, so it is only the tee-it-yourself fly stream that is ephemeral. This mirrors the framing the disposition section already uses.

**Chosen: two surfaces, per trigger.** On the **GitHub Actions** path the Actions UI already tails step logs live — nothing extra to do. On the **Actions-free fly path** (a bare Machine, no UI) the operator must **expose the stream themselves**: tee `--output-format stream-json` to a file the machine serves, a socket, or a small viewer (the away-from-keyboard pattern). The section says which surface applies where, so an adopter on either path knows what to do.

**Assumes:** the rig doc and the reference workflows are on `main` (they are); the Actions-free path itself is FAFF-716's to build — this section references it as the place the self-exposed stream matters, without depending on it existing (the streaming flag stands alone on any harness invocation).

## 3. HOW — acceptance

- `docs/guide/self-hosted-rig.md` gains a "Watching a run live" section (after the window-budget section) covering:
  - the durable-vs-live split (stream = live/now; ledger + `faff disposition` = durable/audit);
  - the one-line how: `--output-format stream-json --verbose` on the drain step's `claude -p`;
  - Actions path (UI tails it) vs Actions-free fly path (expose the stream yourself — tee to a served file/socket/viewer);
  - the harness-level caveat (swap `claude -p` for your harness; faff adds nothing).
- No new faff surface; no product mandated beyond the example harness (named as an example).
- `docs/guide/` prose stays ref-free (no `FAFF-NNN`/`ADR-NNN` — the Actions-free path referenced by description, workflows by path); `faff lint-refs` passes.
- `node --test` green (docs-only).

### Scenarios

```
Given an operator running the L3/L4 watcher on a bare fly Machine (no Actions UI)
When they read "Watching a run live"
Then they learn to add --output-format stream-json --verbose to the drain and tee it to a served file/socket, and that the ledger + disposition remain the durable record.
```

```
Given a reader who might mistake the live stream for the audit record
When they read the section
Then the durable-vs-live split is explicit: the self-exposed fly stream is ephemeral (Actions logs are captured); the ledger + faff disposition exit are what the morning review reads.
```

## 4. DONE — definition of done

- [ ] "Watching a run live" section added to `docs/guide/self-hosted-rig.md` after the window-budget section.
- [ ] The `--output-format stream-json --verbose` one-liner shown on the drain step; named as a harness capability (swap-your-harness caveat).
- [ ] Durable-vs-live split stated (stream = live; ledger + `faff disposition` = durable).
- [ ] Actions path (UI tails it) vs Actions-free path (expose it yourself) both covered.
- [ ] No new faff surface; example harness named as an example, no product mandated.
- [ ] `docs/guide/` ref-free (`faff lint-refs` passes); `node --test` green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
