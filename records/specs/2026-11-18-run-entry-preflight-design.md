# Compose autonomous entry probes

`faff run preflight` reads the current local configuration and calls the existing container, socket, GitHub auth and default-branch protection probes in one process. The standalone CLIs call the same probes and retain their output and exits. The composed command reports failed or uncertain findings with one actionable message each, and redacts known credentials. Default policies warn. Explicit block policies apply to unconfirmed containment, unconfirmed branch protection and rejected credentials. Auth uncertainty and a present socket remain warnings. A config fault returns exit 2 before probing.

The entry check owns no run mint, ledger edit, hook change, tracker call or forge write. `run open`, `run trigger` and `run checkpoint` already own the file-native identity, readiness and budget paths, and the lights-out floor stays separate. The caller owns stopping or continuing, any needs-human handoff, and carrying findings into the existing log and reporting surfaces. Doctor and its separate reporting path are unchanged.

## Measurement

Compared with `a3fa5446`, loaded skill prose shrinks by 2,393 bytes, about 590 estimated tokens. The success fixture makes the same four read-only `gh` calls in the same order. Three original CLI invocations returned 499 bytes of stdout. The composed invocation returned 37 bytes. Across 25 fresh Node 22 iterations per arm, the median was 105.1 ms separate and 46.0 ms composed. The probes used an offline scripted forge and no new configuration invocations were counted in the baseline. No live network latency or provider savings were measured.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `runs faff github-auth-check once at autonomous entry` | One composed entry call reuses the auth probe once. | test/run-entry-preflight.test.mjs | changed: compose with the other entry probes |
| `prepend the kickoff line to .faff/runs/<run-id>/summary.md` | Caller surfaces the structured auth-failed message before Methodology and in the condensed post. | test/run-entry-preflight.test.mjs | changed: use the message returned by the probe composition |
| `GITHUB-AUTH: GitHub auth invalid` | The authored message still names rejected auth and the credential repair. | test/run-entry-preflight.test.mjs | changed: render in the CLI |
| `abort here (needs-human, naming the credential + fix)` | Explicit block exits before mint. The caller shows the cause. Default warn continues to existing delivery checks. | test/run-entry-preflight.test.mjs | changed: use the structured block result |
| `add one advisory line` | Indeterminate auth yields one advisory, remains non-blocking and surfaces in the existing log and WTF. | test/run-entry-preflight.test.mjs | changed: use the message returned by the CLI |
| `this probes the push credential directly` | GitHub's configured runner credential remains the probe source. Read-only probes precede build queue minting. | test/run-entry-preflight.test.mjs | changed: call existing auth in-process |
| `Each runs once at autonomous entry` | The existing probes are composed once. Logs and WTF remain caller-owned. Interactive calls are unchanged. | test/run-entry-preflight.test.mjs | changed: one CLI invocation |
| `missing boundary + basis` | The container finding carries the basis and optional block. | test/run-entry-preflight.test.mjs | changed: use structured findings |
| `on the default branch (effective-rules API` | The existing effective default-branch rules check retains ruleset support and reports unknown rules according to its knob. | test/run-entry-preflight.test.mjs | changed: call existing branch probe in-process |
| `indeterminate (gh missing / network)` | An indeterminate GitHub probe stays advisory even in block policy. | test/run-entry-preflight.test.mjs | changed: use structured findings |
| `always continue (no block knob here)` | Host socket remains warning-only at entry. The stricter lights-out floor remains separate. | test/run-entry-preflight.test.mjs, test/lights-out.test.mjs | kept |
| `authed — no line added; nothing changes.` | Confirmed authentication adds no finding or summary line. | test/run-entry-preflight.test.mjs | kept |
| `\| Preflight \| Probe \| On failure \|` | The command owns the fixed probe and failure associations. | test/run-entry-preflight.test.mjs | changed: encode policy composition |
