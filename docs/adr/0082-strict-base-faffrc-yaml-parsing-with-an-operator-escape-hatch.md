# ADR 0082 — Strict base .faffrc.yaml parsing with an operator escape hatch

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-22
- **Issue:** FAFF-577

## Context

faff's two-file config resolution treats its halves asymmetrically. The machine-local overlay (`.faffrc.local.yaml`) fails loud on malformed content — the committed-config posture work made it strict because a half-applied overlay silently reverting to base values is the silent-default failure FAFF-50 was minted to kill. The committed base (`.faffrc.yaml`) was deliberately left lenient as back-compat: `parseYamlSubset` never throws, so a base file that is a top-level sequence or wholly mis-indented parses to `{}`, and every configured value — including budget spend ceilings and sentry kill-switch thresholds — resolves from built-in defaults with no signal anywhere. The stakes have risen since that carve-out: the governance readers (`readGovernanceConfig` in `budget.js`) now resolve spend and kill-switch ceilings from the same file, so a mangled base degrades the safety machinery itself, silently. An external adversarial critique (2026-07-21, appendix row 4) flagged the gap; FAFF-577 is the re-decision.

Complications that shape the answer: several call sites wrap `loadConfig` in try/catch and degrade (a throw alone could be re-silenced); the sentry poller fault-caps on non-zero exits from `faff sentry check`, so a strict exit there would kill the watchdog whose ceilings strictness protects; and `faff config check` must be able to describe the fault without aborting on it.

## Decision

The base becomes strict at both config chokepoints — `loadConfig` (factory) and `readGovernanceConfig` (governance) — using one shared detection: `parseConfigMapStrict(filePath, errorName)` in `shared-infra.js`, generalised from the overlay's `parseOverlayStrict`, which becomes a thin wrapper over it (one implementation, one shared detection limit). A malformed base — unreadable, parses to a non-map, or parses to an empty map while holding meaningful content — writes a one-line stderr warning **at the chokepoint, before the throw**, so a catching caller can degrade behaviour but never re-silence the failure; then throws `base-parse-error {file, detail}`. The `faff config` and governance CLI entries exit 2 on it, mirroring the existing `overlay-parse-error` and legacy-filename postures.

The escape hatch is the env var `FAFF_CONFIG_BASE_LENIENT=1` (warn-and-proceed-on-`{}` at both chokepoints) — env var, not a config key, because the config file is the broken artifact; per the `FAFF_APPETITE` / `FAFF_WORKTREE_ROOT` precedent. Two carve-outs keep the protective surfaces alive: `faff config check` reports the malformed base as an `error`-severity finding (exit 1) and never strict-aborts; `faff sentry check` catches the error, proceeds on built-in default thresholds, and flags `config_malformed: true` in its payload so the poller stays alive and the degradation is visible. The L4 lights-out preflight refuses to mint while the hatch is set — a lights-out run never starts with governance-read leniency armed.

This supersedes the base-lenient carve-out retained when the overlay was made strict (the two-file committed-config posture's storage and precedence decisions are unchanged). `parseYamlSubset` itself stays forgiving — strictness is the chokepoints' policy, not the parser's, because the parser is shared by surfaces that legitimately read partial or foreign documents.

## Consequences

- A repo whose base has been silently malformed all along stops working until the file is fixed: faff commands exit non-zero, naming the file and the remedy. This is the intended behaviour break; the hatch, the remedy line, and the CHANGELOG entry are the mitigation.
- No future config consumer may re-introduce silent leniency on the base: any new read path goes through the strict chokepoints, and loudness carve-outs (like sentry's) must degrade loud — visible flag, warning fired — never silent.
- The hatch is for limping, not living: it warns on every read and blocks an L4 mint, so a forgotten `FAFF_CONFIG_BASE_LENIENT` is discoverable by design.
- Absent, empty, and comment-only base files remain silently valid (`{}` / defaults) — only meaningful content that fails to parse as a mapping changes behaviour.
- The detection inherits the overlay's known limit: a bare scalar line without a colon parses as a one-key map and is not flagged. One shared implementation means one shared limit, covered as a deliberate negative test; tightening it is per-key validation territory, out of scope here.
- Catching call sites (`state.js`, `validate-adapters.js`, `engine.js`, `fixtures.js`, `profile.js`) keep their degraded-but-defined behaviour with no per-site edits — the chokepoint warning has already fired by the time they catch.
