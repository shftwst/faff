# FAFF-556 — git-only queue-state via stable item-keys

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-556.

spec-review: approve

## Why

In git-only mode (no tracker MCP) the `/faff-beep-boop` orchestrator has no queue to read, so it cannot assemble the `queue_empty` / `all_parked` booleans that `faff run-done` consumes — a naïve `run-done --run-dir X` therefore self-reports `work-remaining` forever (parent FAFF-551, finding F2). The parent decided the robust source is **durable item-keys emitted at ticket-creation, matched exactly against the run-ledger** — not best-effort fuzzy slug-matching, which drifts the moment a roadmap line or spec title is reworded.

This slice delivers two things: (1) a stable item-key that git-only creation paths (`/faff-plot` roadmaps, `/faff-jot` captures) stamp onto every buildable work item, and (2) `faff queue-state`, a pure CLI that diffs those keys against `run-ledger.json` by exact match and emits `{ queue_empty, all_parked }`. It does **not** wire the result into `run-done` — that is the sibling slice FAFF-559 (§8.5 run-done wiring), which consumes this. FAFF-557 (PRD-checklist) is independent.

## What

### 1. The stable item-key ("gitkey")

**Chosen: minted-once, persisted, never recomputed from mutable content — format `gk-<YYYYMMDD>-<r>`** where `<r>` is a 6-character lowercase base36 (`0-9a-z`) suffix drawn from `crypto.randomBytes`. Example: `gk-20260719-k3n7p2`.

Rationale for each property:
- **Not derived from the title.** A content-hash of the roadmap line would change the instant the line is reworded — the exact failure mode FAFF-551 rejected. The key is minted once at creation and stored; rewording the visible text never touches it. This is what "deterministic and stable across a reworded roadmap line / renamed spec" (AC 3) means: the *read* path is deterministic (re-reading returns the persisted key) and `queue-state`'s matching is a pure exact string compare — the *mint* is random precisely so it is decoupled from mutable prose.
- **Filesystem-safe.** Lowercase alphanumerics + hyphens only, so it doubles as the `.faff/specs/<key>.md` filename (see store B) with no escaping.
- **Namespaced.** The `gk-` prefix keeps a git-only key visually distinct from a real tracker id (`FAFF-556`) in logs and `.faff/specs/` listings, and prevents any accidental collision with a tracker-id-shaped filename.
- **Date-sortable + collision-resistant.** The `YYYYMMDD` segment gives rough chronological ordering in a directory listing; the 36^6 ≈ 2.2 billion daily suffix space makes collision negligible without any registry read, keeping the mint a pure function.

**Chosen: the mint lives in a shared CLI helper, not per-skill prose** — `faff queue-state new-key` (implemented in the new `bin/lib/queue-state.js`). Both `/faff-plot` and `/faff-jot` shell out to it. This is the decision-(c) answer: a single format authority is the "deterministic tools over prose" tenet applied — LLM-authored keys in two separate skill prompts would drift in format, prefix, or length. `new-key` reads nothing (pure emit), so it stays a pure CLI.

### 2. Where the key is stored (per store)

**Chosen (store A — intake roadmap): trailing HTML-comment marker on each buildable checklist line** — `- [ ] Build the auth module <!-- gitkey:gk-20260719-k3n7p2 -->`.
- Mirrors faff's existing marker convention (the gateway's `<!-- faff-review-findings:<id> -->`), so the parsing idiom is already house-standard.
- Renders invisibly in Markdown, so the human still reads clean roadmap prose, and rewording the visible text leaves the trailing marker intact (AC 3).
- **Only buildable leaf items carry a key.** For a `/faff-plot` roadmap that is the first-slice **epic** lines; container lines (initiatives, projects) are not work items and get no key. For a `/faff-jot` capture it is each shaped ticket line. This keeps the key set equal to the set of things that can reach a ledger outcome.

**Chosen (store B — spec store): the key *is* the spec filename** — `.faff/specs/<gitkey>.md`. No new frontmatter or body field.
- The git-only spec store is already `.faff/specs/<issue-id>.md` (gateway → Spec discovery, location 4). **Chosen: in git-only mode the gitkey *is* the `<issue-id>`** — the existing `<issue-id>` filename slot is simply filled by the gitkey. So `queue-state` reads the spec key by globbing `.faff/specs/*.md` and stripping `.md`; no file is opened, no YAML is parsed.
- Frontmatter was rejected: it would duplicate the filename, add a parse step, and create a second source of truth that could disagree with the filename. The filename is the single authoritative location.

An item flows through both stores under **one** key: `/faff-plot` mints `K` and writes `<!-- gitkey:K -->` on the epic line → when that item is prepped, its spec lands at `.faff/specs/K.md` (same `K`, reused as the git-only issue-id) → build admits `K` into the ledger. The same `K` therefore appears in both stores; `queue-state` de-dupes the union by exact key.

### 3. `faff queue-state` (new pure CLI, new `bin/lib/queue-state.js`)

Two subverbs under one command (co-locating format ownership in one module):

- **`faff queue-state new-key`** — print one freshly-minted gitkey to stdout, exit 0. Pure (no FS/tracker/network). The mint helper §1 calls out to.
- **`faff queue-state derive [--run-dir DIR] [--root DIR] [--json]`** — the differ. Emits `{ queue_empty, all_parked, ... }` for the orchestrator (FAFF-559) to pipe into `run-done`.

**Derive algorithm:**
1. **Collect the item-key set** = union of every `<!-- gitkey:K -->` marker across `<root>/.faff/intake/*.md`, and every filename stem of `<root>/.faff/specs/*.md`. De-dupe by exact string. `<root>` defaults to `findRoot()`; `--root` overrides.
2. **Read the ledger** at `<run-dir>/run-ledger.json` (resolve `--run-dir` → `$FAFF_RUN_DIR` → latest under `.faff/runs`, reusing shared-infra's `readLedger` / `latestRunDir`). Take `outcomes{}` (key → terminal state).
3. **Classify each item-key**: *terminal* iff it appears in `outcomes` with a value in the active governance profile's `terminal_states` (`shipped`, `pr-open`, `parked`, `errored`, `routed-out`, `unreached-budget`). Reuse the profile via `activeProfile()` (the same set `runcheck` reads) so the two never drift and `$FAFF_GOVERNANCE_PROFILE` overrides are honoured. A key absent from `outcomes`, or present with a non-terminal value, is *pending*.
4. **Emit booleans (fail-safe toward not-empty):**
   - Any pending item → `{ queue_empty: false, all_parked: false }` (work remains). AC 2.
   - All items terminal **and** every terminal outcome is `parked` → `{ queue_empty: false, all_parked: true }` (the "all-parked" drain face `run-done` distinguishes as reason `all-parked`).
   - All items terminal with at least one non-`parked` terminal (something shipped) → `{ queue_empty: true, all_parked: false }` (reason `drained`). AC 1.
   - **Empty item set** (zero keys found) → `{ queue_empty: false, all_parked: false }` with `reason: "no-item-keys"` — fail-safe: an empty store is far more likely a mis-detection (wrong root, unpopulated store) than a genuinely complete run, and `run-done`'s `work-remaining → continue` is the safe direction.
5. **Payload shape** (parity with `run-done`'s rich verdict): `{ queue_empty, all_parked, items_total, items_terminal, items_pending: [<key>...], reason }`. JSON to stdout.

**Purity & exit codes (parity with `faff next` / `run-done`):**
- No tracker, no network, no writes; reads only the two stores + the run-ledger under `--root`/`--run-dir`.
- Report-only exit 0 (verdict in the payload, not the exit code).
- A **missing** ledger → exit 0 with `queue_empty:false` (a run that recorded no outcomes yet simply isn't drained — valid state, not an error).
- A **malformed** ledger (present but unparseable) → exit 2, loud (parity with `runcheck`; never a silent "not derailed").
- Unknown subverb / bad flag → exit 2.
- `--selftest` drives the pure classifier over the case table (drained / all-parked / mixed-terminal / one-pending / empty-set / missing-ledger / malformed-ledger / key-format round-trip), exit non-zero on any failure.

### 4. Skill-prose changes (key emission)

- **`/faff-plot` git-only path** (`plugin/skills/faff-plot/SKILL.md`, Tracker-less mode): when writing the roadmap skeleton to `.faff/intake/<date>-<slug>-roadmap.md`, mint a gitkey via `faff queue-state new-key` for **each first-slice epic (buildable leaf)** line and append `<!-- gitkey:K -->` to it. Containers (initiatives/projects) get none.
- **`/faff-jot` git-only path** (`plugin/skills/faff-jot/SKILL.md`, Tracker-less mode): when writing the shaped checklist to `.faff/intake/<date>-<slug>.md`, mint a gitkey per shaped-ticket line and append the same marker.
- **Gateway note** (`plugin/skills/faff/SKILL.md`, Spec discovery location 4 / git-only): state that in git-only mode the gitkey *is* the item's stable id and the `.faff/specs/<issue-id>.md` filename slot — one sentence, so prep/graft reading `<issue-id>` resolve it to the gitkey with no other change.
- Both skill edits obey the skill-authoring standard (lean, one home for shared prose — reference `faff queue-state new-key`, never restate the key format).

### 5. Docs & lint

- Add the `queue-state` row to `docs/guide/cli.md` (or `lint-cli-doc` fails CI) and a matching USAGE block in `bin/faff`.
- Register `cmdQueueState` in the `COMMANDS` map and require the module in `bin/faff`.
- The module carries a `region:factory` banner (a pure computation command, sibling of `run-done`/`next`), so `faff regions check` passes.

## How (build shape — non-prescriptive)

1. New `bin/lib/queue-state.js`: `cmdQueueState(args)` dispatching `new-key` / `derive`, a pure `mintKey()`, a pure `deriveQueueState({ itemKeys, outcomes, terminalStates })` core (the selftest exercises this directly, no FS), plus thin FS collectors for the two stores. Reuse `findRoot`, `readLedger`, `latestRunDir` from `shared-infra`, and `activeProfile().terminal_states` from `governance-profile`.
2. Wire into `bin/faff` (require + `COMMANDS` entry + USAGE).
3. `docs/guide/cli.md` row.
4. Skill-prose edits (§4).
5. Selftest table + run `faff queue-state --selftest`, `faff regions check`, `faff lint-cli-doc`.

Implementation-level TDD cycles and exact code are the implementer's to plan from this design.

## Reference context

- Consumer of the output: `faff run-done` (`bin/lib/run-done.js`) — `normalizeRunSignals` already reads `queue_empty` / `all_parked` booleans; its `work-remaining` rung is `!(queue_empty || all_parked)` and `clean-complete` distinguishes reason `drained` (queue_empty) vs `all-parked`. This spec's booleans are defined to match those two faces exactly.
- Ledger shape: `{ admitted: [key...], outcomes: { key: terminalState }, ... }` at `.faff/runs/<run-id>/run-ledger.json`; terminal vocabulary from `governance-profile.js` `DELIVERY_PROFILE.terminal_states`.
- Marker idiom precedent: the gateway's `<!-- faff-review-findings:<id> -->` create-or-update convention.
- Git-only stores: `/faff-plot` → `.faff/intake/<date>-<slug>-roadmap.md`; `/faff-jot` → `.faff/intake/<date>-<slug>.md`; specs → `.faff/specs/<issue-id>.md` (gateway Spec discovery location 4).

## Scope boundary (not this slice)

- **Wiring `queue-state` into the beep-boop §8.5 / `run-done` call is FAFF-559**, which blocks on this. This slice ships the CLI + key emission + format only.
- **Which stores/keys are "in scope for this run"** (e.g. excluding a stale pre-run intake file) is the orchestrator's assembly concern, handled by FAFF-559's wiring, not by this pure differ. `queue-state derive` is deliberately a stateless diff over the stores + ledger it is pointed at — it takes `--root`/`--run-dir` so the caller controls scope. Clean primitive/wiring split, not an open question.
- PRD-satisfaction reading is FAFF-557 (independent).

## Acceptance criteria

1. Given a git-only run where every roadmap/spec item's gitkey appears in `run-ledger.json` `outcomes` with a non-`parked` terminal state, `faff queue-state derive` reports `queue_empty: true, all_parked: false`.
2. A gitkey absent from `outcomes`, or present with a non-terminal value, yields `queue_empty: false` (fail-safe toward not-empty).
3. When every item's outcome is `parked`, `queue-state derive` reports `queue_empty: false, all_parked: true`.
4. An empty item set (no intake markers, no specs) yields `queue_empty: false` with `reason: "no-item-keys"`.
5. A missing ledger → `queue_empty: false`, exit 0; a malformed (present-but-unparseable) ledger → exit 2, loud.
6. `faff queue-state new-key` emits a `gk-<YYYYMMDD>-<6×base36>` key; two successive calls differ; the format is filesystem-safe and usable verbatim as a `.faff/specs/<key>.md` filename.
7. Key emission is stable across a reworded roadmap line and a renamed spec: rewording the visible checklist text (marker untouched) and the exact-match derive both continue to resolve the same key.
8. `faff queue-state` is pure — no tracker or network access — and is documented in `docs/guide/cli.md` (`lint-cli-doc` passes); `faff regions check` and `faff queue-state --selftest` pass.

## Open questions / assumptions

- **Assumes:** `shared-infra`'s `readLedger` / `latestRunDir` / `findRoot` and `governance-profile`'s `activeProfile().terminal_states` exist and are importable (verified present at prep — `plugin/skills/faff/bin/lib/shared-infra.js` exports both; `governance-profile.js` exports `activeProfile` / `DELIVERY_PROFILE`).
- No open Punt.

confidence: high
