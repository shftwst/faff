# ADR 0097 — Plugin-root doctor scan is authoritative for the invoking harness, not additive with the global pair

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-09
- **Issue:** FAFF-675

## Context

`faff doctor` runs on every faff invocation through the gateway's install-health preamble, and its exit code decides whether the user is offered a repair (`faff sync`, whose only fix is `bash scripts/link-skills.sh … (from the main checkout)`). `resolveDoctorScanSet` (`plugin/skills/faff/bin/lib/gates.js`) picks the scan set: an explicit `--target` wins outright; otherwise, when `$CLAUDE_PLUGIN_ROOT` is set, the scan set short-circuits to the single directory `$CLAUDE_PLUGIN_ROOT/skills` and the home/global pair (`~/.claude/skills`, `~/.agents/skills`) is never consulted. FAFF-676 built the multi-target home/global scan deliberately leaving this plugin-root branch single-target, naming FAFF-675 as the ticket to resolve it.

A marketplace-plugin install places faff's skills as real (copied) directories under `$CLAUDE_PLUGIN_ROOT/skills`, not symlinks — `scanDoctorDirectory` classified every one of them as a COPY fault and `cmdDoctor` returned exit 1 with the unrunnable `link-skills.sh` repair (the plugin user has no checkout to run it from). Fixing that false failure (the report-side carve-out this ticket ships) still leaves one question unresolved in the code: is the plugin root an *alternative* target to the global directories, or an *addition* to them? A plugin machine could, in principle, also carry a global (`~/.claude/skills`) install that some other harness depends on — folding both into one scan would surface that. Keeping the short-circuit hides it. The ticket required this answered in writing, not left implicit.

## Decision

**The plugin root is an alternative to the global directories, authoritative for the invoking harness — not an addition.** `$CLAUDE_PLUGIN_ROOT` names where *the running harness* loads its skills from, so it is the correct and sufficient scan target for "is the harness that invoked `faff doctor` healthy?" — exactly the question this doctor invocation is answering. Whether that same machine *also* carries a global install that some *other* harness (e.g. a dev-linked Codex session) needs is a cross-harness discoverability question, not a health question about *this* invocation; it is FAFF-685's charter (making plugin skills discoverable to codex), not this ticket's.

The short-circuit in `resolveDoctorScanSet` therefore stays exactly as FAFF-676 left it: `--target` wins outright, else the plugin-root branch returns its single directory and nothing else, else the multi-target home/global default applies. This keeps `expectCopies` — the new signal this ticket threads through to tell the copy-classifier a plugin-root scan's copies are expected, not faults — a sound scan-set-wide boolean, because its one `true` branch stays single-element by construction. A runtime invariant at `resolveDoctorScanSet`'s return site asserts exactly that coupling and throws if it is ever violated.

This is a decision about the install shape as designed, not as observed in the field — there is no live marketplace-plugin distribution today. **FAFF-685 is the named revisit trigger.** If FAFF-685's install-side fix changes what a plugin machine can see or needs to report, or if a real deployment surfaces a case where a plugin machine's global directories genuinely need auditing in the same breath, that is where this decision gets re-opened — including, if warranted, switching `expectCopies` from a scan-set-wide boolean to per-directory `{directory, expectCopies}` records as the precondition for making the plugin-root branch multi-element.

## Consequences

- `faff doctor` on a plugin machine reports on the plugin root only; a global install on the same machine that some other harness relies on is invisible to this invocation. That is intentional — cross-harness discoverability is out of scope here and belongs to FAFF-685.
- `expectCopies` stays a single boolean carried out of `resolveDoctorScanSet` rather than a per-directory record, because its sole `true` branch is provably single-element. The invariant assert is the mechanical guard that keeps this true: a future change making the plugin-root branch multi-element without first moving to per-directory records fails loudly (a thrown error) instead of silently mis-classifying a real copy fault as an expected install.
- `dedupeByResolvedPath` and the FAFF-676 agreement test are unaffected — the scan set the plugin-root branch returns is still exactly one path.
- `faff doctor --json`'s `plugin_root` field names the short-circuited directory when this branch fires, and `null` otherwise, giving a bug report or a divergent-verdict investigation something to point at instead of requiring the reader to reverse-engineer `resolveDoctorScanSet` from an environment they cannot see.
- Reopening this decision (alternative → additive) is FAFF-685's to make, informed by how the install-side fix actually ships; this record is the pointer a future reader meets at the `pluginRootEnv` branch of `resolveDoctorScanSet`.
