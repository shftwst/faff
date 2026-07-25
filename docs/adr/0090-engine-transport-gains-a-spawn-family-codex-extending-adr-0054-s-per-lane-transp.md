# ADR 0090 — Engine transport gains a spawn family (codex) extending ADR-0054's per-lane transport fork

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-25
- **Issue:** FAFF-593

## Context

The per-lane transport fork (ADR-0054: the lane value's shape selects the dispatch vehicle) has three branches: Agent-token → in-harness subagent, `engine:<name>` → out-of-session HTTP one-shot, and the not-yet-built tool-needing `claude -p` branch. Every `engine:<name>` resolution so far lands on an HTTP family (ollama or openai-compatible) — a transport the operator must host themselves. Cross-harness L2/L3 needs one portable producer-dispatch transport that doesn't require hosting anything: Codex ships a headless mode (`codex exec`: task in, structured JSONL out) that a ChatGPT seat covers as sanctioned product usage, and its login state travels with the codex CLI itself (`$CODEX_HOME/auth.json`), independent of which harness faff runs on. Without an engine family for it, faff cannot dispatch a producer onto that seat at all.

## Decision

The fork gains a fourth branch: a **spawned child process**, with the `codex` provider family as its first occupant. `faff engine call` on a codex-resolved lane spawns `codex exec --json` — prompt (system, blank line, user) on stdin, JSONL events on stdout, the final agent message as the producer block — via `spawnSync` with parse-after-exit, in `plugin/skills/faff/bin/lib/engine-codex.js`.

The branch changes the transport and nothing else:

- **Inherited unchanged:** the fail-loud exit taxonomy, the `methodology | intake` lane allowlist, and the no-retry/no-fallback posture — every failure (missing binary, not logged in, unparseable stream, non-zero child exit) is a named non-zero exit; the caller never re-dispatches on the session model.
- **Auth vocabulary reused:** the codex seat is `auth: subscription-seat` — no new `chatgpt-seat` literal; the provider field already names whose seat. Unlike the Anthropic seat (bound to the ambient interactive session, per the `backends:` substrate decision, ADR-0076), the codex seat admits on any harness.
- **The child gets no hands:** `--sandbox read-only`, `--ephemeral`, `--skip-git-repo-check`, and a throwaway temp cwd removed after the run.
- **Seat probe:** `codex login status` runs before the spawn. It upgrades error quality (a named auth failure before the expensive spawn), never outcome — classification of the child's own failure still stands behind it.
- **Parse-after-exit, not streaming:** nothing consumes events mid-flight today; the parser keeps the full event list (usage fields included) as the seam for the spend-source read (FAFF-604).

## Consequences

- A future spawn-family occupant (another headless CLI) extends this branch, not a new fork: it gets a `bin_path`-shaped Backend record, a pre-spawn probe if one is cheap and stable, and the same exit taxonomy. The argv builder is the seam for the permission/appetite mapping onto sandbox modes (FAFF-605).
- Config-level invariants now differ by family: a codex backend has no `host` (a present one is refused at read), and realizability for it is matrix admission only — binary existence is a dispatch-time fact. Residency is unaffected: a hostless codex backend derives `egress: external`, so a `requires: local` chain correctly refuses it.
- The build shipped without a codex binary on the machine: event/flag shapes are pinned from codex-rs source, not observed output. The named drift observable is exit 7 "no agent message" on a manually-verified-good run; the fix is localized to `parseCodexEvents` by design. Live re-pinning is an open needs-human item.
- `subscription-seat` is no longer synonymous with "the current harness's ambient session" — admission is provider-aware. Anything reasoning about seat portability must consult the provider, not the auth value alone.
