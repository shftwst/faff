# Extract the adversarial-review prose reduction

Reduce the runtime prompt from 74,289 to 22,259 bytes, saving 52,030 bytes
and 12,859 estimated tokens (18,424 to 5,565). Estimates use
`ceil(UTF-16 code units / 4)` per complete file.

The skill is byte-identical to the historical measured candidate at
`a523734d` (SHA256 `5ae8d0dd3b6181adbe23996eb321dccda4e9257c5d956360236436747e6dd9ba`).
Main's intervening provider removal is retained in the optional configuration
reference. Existing helpers continue to own transport, retries, deadlines,
mandatory-review classification, fixture caps and output validation.
The eval loader stops at the next peer heading so the reviewer receives only
its lens, followed by the existing fixture guidance and fixture paths.

Historical bounded Opus evidence is linked from the PR. Raw scores were
49/50 per arm; the recorded symmetric assessments were 50/50 per arm.
Three candidate samples retain native error diagnostics for permitted
read-only probes of not-yet-written output files. The evidence uses controlled
provider responses and a stub primary reviewer; it does not establish full
workflow or statistical equivalence. No experiment harness or run evidence
is included here.

## Rule inventory

Caller obligations remain in the named skill sections. Helper implementation
explanations are reduced; operator settings move to the optional
`docs/reference/adversarial-backends.md` reference. Existing helper tests and
the loader boundary test accompany the PR validation. Each row quotes a
removed passage; coverage alone does not establish semantic equivalence.

| Prose rule | Disposition |
|---|---|
| `yaml adversarial: provider: vllm` | changed: configuration example moves to the optional operator reference |
| `openai vllm openrouter nvidia deepseek gemini` | changed: supported transports remain in the optional operator reference |
| `description: "Adversarial second-opinion code review for the` | changed: compact wording, same caller obligation |
| `Two-phase code review: standard structural review (delegated to` | changed: compact wording, same caller obligation |
| `Plugs into the review slot — replaces the default review, not` | changed: compact wording, same caller obligation |
| `Configure in .faff/config.yaml:` | changed: remove redundant configuration example |
| `yaml slots: review: faffter-dark-adversarial-review` | changed: remove redundant configuration example |
| `## When it runs` | changed: compact wording, same caller obligation |
| `Invoked by faff-graft Step 9 as the configured review skill.` | changed: compact wording, same caller obligation |
| `Runs the full faffter-noon-review five-pass review (AC` | changed: compact wording, same caller obligation |
| `Only runs if Phase 1 returned the approving verdict. Sends the` | changed: compact wording, same caller obligation |
| `## Input` | changed: compact wording, same caller obligation |
| `Faff-graft provides:` | changed: compact wording, same caller obligation |
| `- The full diff: git diff main...HEAD` | changed: compact wording, same caller obligation |
| `- The spec (from the issue comment)` | changed: compact wording, same caller obligation |
| `- The Phase 1 review result (for context, not for agreement —` | changed: compact wording, same caller obligation |
| `- From the second review pass on, the prior findings: the` | changed: compact wording, same caller obligation |
| `- The autonomous signal — a boolean, true on any unattended run` | changed: compact wording, same caller obligation |
| `- The lights_out signal — a boolean, true only on a lights-out` | changed: compact wording, same caller obligation |
| `## Output` | changed: compact wording, same caller obligation |
| `Phase 1 returns a hard signal (canonical semantics: faff` | changed: compact wording, same caller obligation |
| `Phase 2 returns a soft signal — findings only, no verdict. The` | changed: compact wording, same caller obligation |
| `## Adversarial findings — <provider>/<model> (chain[<i>], host:` | changed: compact wording, same caller obligation |
| `Severities: critical, major, minor, observation — but these are` | changed: compact wording, same caller obligation |
| `When there are no findings, emit exactly one section: ###` | changed: compact wording, same caller obligation |
| `The spec-refuter prompts speak a narrower closed grammar` | changed: remove parser implementation details from the caller prompt |
| `The header is harness-authored, not model prose — the lens` | changed: retain caller provenance rule, remove helper implementation explanation |
| `Refuted findings arrive pre-downgraded. Before this output` | changed: retain caller handling, remove unchanged helper algorithm |
| `Fixture-data findings arrive capped. When fixture paths are` | changed: retain caller handling, remove unchanged helper algorithm |
| `The adversarial findings are raised back to the implementor` | changed: compact wording, same caller obligation |
| `1. Consider each finding — read it, understand the concern` | changed: compact wording, same caller obligation |
| `2. Prove or disprove with conviction — check the code, the` | changed: compact wording, same caller obligation |
| `3. Log each disposition — record every finding and its` | changed: compact wording, same caller obligation |
| `4. Fix if necessary — if any finding is valid and actionable,` | changed: compact wording, same caller obligation |
| `5. Re-run primary review — if fixes were made, re-run Phase 1` | changed: compact wording, same caller obligation |
| `On an interactive (L2) run the adversarial review never` | changed: compact wording, same caller obligation |
| `This soft-signal design reflects that the adversarial model may` | changed: compact wording, same caller obligation |
| `The occupant that assembles the final` | changed: compact wording, same caller obligation |
| `\| Field \| Phase 1 (standard) \| Phase 2 (adversarial) \|` | changed: compact wording, same caller obligation |
| `\| source \| "standard" \| "adversarial" \|` | changed: compact wording, same caller obligation |
| `\| severity \| the primary pass's severity (if it assigns one) \|` | changed: compact wording, same caller obligation |
| `\| model \| the primary reviewer handle \| the harness-authored` | changed: compact wording, same caller obligation |
| `\| refutation \| (none) \| the auto-refutation evidence line, or a` | changed: compact wording, same caller obligation |
| `\| disposition \| best-known at emit (usually open) \| best-known` | changed: compact wording, same caller obligation |
| `\| disposition_rationale \| the reasoning behind the disposition,` | changed: compact wording, same caller obligation |
| `disposition here is the best-known value at verdict-emit time —` | changed: compact wording, same caller obligation |
| `## Review lens` | changed: compact wording, same caller obligation |
| `This is NOT a repeat of the primary review. The adversarial` | changed: compact wording, same caller obligation |
| `1. Specification gaming — does the code technically satisfy the` | changed: compact wording, same caller obligation |
| `- Trivial implementations that pass ACs without delivering value` | changed: compact wording, same caller obligation |
| `- Edge cases acknowledged in the spec but handled with no-ops` | changed: compact wording, same caller obligation |
| `- Tests that assert implementation details rather than behaviour` | changed: compact wording, same caller obligation |
| `2. Implicit assumptions — what does the code assume that` | changed: compact wording, same caller obligation |
| `- Ordering assumptions (events arrive in sequence, config loads` | changed: compact wording, same caller obligation |
| `- Size/cardinality assumptions (fits in memory, single item,` | changed: compact wording, same caller obligation |
| `- Environment assumptions (file exists, network reachable,` | changed: compact wording, same caller obligation |
| `3. Failure mode blindness — what happens when things go wrong?` | changed: compact wording, same caller obligation |
| `- Missing error paths (what if this throws? what if this` | changed: compact wording, same caller obligation |
| `- Partial failure (3 of 5 items succeed — what state are we in?)` | changed: compact wording, same caller obligation |
| `- Resource leaks (opened but not closed on error path)` | changed: compact wording, same caller obligation |
| `4. Security surface — changes that expand the attack surface:` | changed: compact wording, same caller obligation |
| `- New user input without validation/sanitisation` | changed: compact wording, same caller obligation |
| `- Changed auth/authz boundaries` | changed: compact wording, same caller obligation |
| `- Secrets in code, logs, or error messages` | changed: compact wording, same caller obligation |
| `- SQL/command/template injection vectors` | changed: compact wording, same caller obligation |
| `5. Concurrency and ordering — race conditions the happy-path` | changed: compact wording, same caller obligation |
| `- Shared mutable state without synchronisation` | changed: compact wording, same caller obligation |
| `- Time-of-check to time-of-use gaps` | changed: compact wording, same caller obligation |
| `- Event ordering assumptions in async flows` | changed: compact wording, same caller obligation |
| `Carried findings. When a section reports the same defect, in` | changed: compact wording, same caller obligation |
| `When this lens finds nothing — this text is the --system prompt` | changed: compact wording, same caller obligation |
| `The network call is made only by the bundled review-call.mjs` | changed: compact wording, same caller obligation |
| `The skill supports any LLM backend. Configure which one it` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `Fallback chain. The scalar block above is the primary backend.` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `- Value is a JSON-string — a quoted JSON array of backend` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `- Each fallback is self-contained (its own provider/model/host` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `- No silent weakening — an all-failed chain is never more` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `Per-backend context-window preflight. A chain is tried` | changed: remove implementation narrative, retain caller obligations |
| `- Window-targeted trim of the shared prefix — once, pre-chain,` | changed: remove implementation narrative, retain caller obligations |
| `- Deterministic over-window advance. Before dispatching any` | changed: remove implementation narrative, retain caller obligations |
| `- Loud surfacing, always on. Whenever the backend that served` | changed: remove implementation narrative, retain caller obligations |
| `- Opt-in and back-compatible. A backend with no declared window` | changed: remove implementation narrative, retain caller obligations |
| `- An over-window skip carries the same terminal class the 400` | changed: remove implementation narrative, retain caller obligations |
| `- The token estimate is deliberately conservative (a` | changed: remove implementation narrative, retain caller obligations |
| `Transport families (helper-internal — how review-call.mjs` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `\| Provider \| Transport \| Host \| Auth \| Notes \|` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `\| anthropic \| native (/v1/messages, named-event SSE) \| host =` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `An unknown provider exits 2 (loud), never a silent pass. (A` | changed: compact wording, same caller obligation |
| `Anti-pattern: hand-rolling the backend request. Reconstructing` | changed: compact wording, same caller obligation |
| `reasoning_off — set true for a reasoning model that streams` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `reasoning_extra — a per-backend object merged verbatim onto the` | changed: move operator reference out of runtime loading and remove unchanged helper internals |
| `Caveat — reasoning-off trades detection depth (measured). The` | changed: remove historical experiment narrative, retain the quality limit |
| `The key principle is independence from the primary model. If` | changed: compact wording, same caller obligation |
| `Backend call — the bundled review-call.mjs helper (do not` | changed: compact wording, same caller obligation |
| `Assemble the chain mechanically — never JSON.parse` | changed: compact wording, same caller obligation |
| `# Per-consumer: which per-consumer chain this call selects. Set` | changed: remove repeated comments around the same invocation |
| `The call is wrapped in a bounded, killable single-shot` | changed: remove process implementation explanation, preserve mandatory invocation |
| `- exit 0 — $backends_json holds the primary-first JSON array` | changed: compact wording, same caller obligation |
| `- exit 3 — adversarial is unset, or its host is unset (the` | changed: compact wording, same caller obligation |
| `- exit 2 — the configured adversarial.fallbacks value is not` | changed: compact wording, same caller obligation |
| `Pass --run-dir "$run_dir" whenever faff-graft forwarded a` | changed: compact wording, same caller obligation |
| `- --system = the review lens above (the five categories), then` | changed: compact wording, same caller obligation |
| `- --fixture-path = one flag per resolved prefix ($fixture_args` | changed: compact wording, same caller obligation |
| `- --context = every file the diff touches — so the reviewer can` | changed: compact wording, same caller obligation |
| `- --diff = git diff main...HEAD written to a file.` | changed: compact wording, same caller obligation |
| `- Wire shape. review-call.mjs places the shared context+diff` | changed: remove unchanged helper wire-layout explanation |
| `- --deadline = the total wall-clock budget in seconds` | changed: remove retry-budget algorithm explanation, retain caller settings |
| `- Every listed backend is explicitly configured, so` | changed: compact wording, same caller obligation |
| `Exit code → Phase-2 outcome (mechanical — the helper decides,` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| exit \| meaning \| interactive (L2) \| autonomous (L3/L4) \|` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 0 \| findings on stdout \| parse ## Adversarial findings,` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 2 \| usage error, a genuinely unknown provider (not one of` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 4 \| configured model not served by the host (config fault —` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 5 / timeout \| provider unreachable, --host-source config — an` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 6 \| provider unreachable, --host-source default — the` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 7 \| auth failed (cloud 401/403, or the api_key_env var is` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 8 \| deadline exceeded — the total --deadline wall-clock` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 9 \| mandatory chain-outage — a MANDATORY (L4 lights-out)` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 10 \| malformed (substantive-garble only) — the winning` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 11 \| no-findings-content — the winning backend's output is` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `\| 12 \| rate-limited — a backend returned HTTP 429. A` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `A transient transport fault during streaming (HTTP 5xx, a` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `That total is divided per-backend: each backend gets deadline /` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `The malformed/no-findings boundary (deterministic, not` | changed: compact exit table and remove unchanged classifier implementation narrative |
| `On an autonomous run where the exit is 5 (every backend in the` | changed: compact wording, same caller obligation |
| `- Emit a loud skip header in place of the normal findings block:` | changed: compact wording, same caller obligation |
| `## Adversarial findings — SKIPPED (all backends unreachable)` | changed: compact wording, same caller obligation |
| `- Set the contract block to { "signal": "pass", "findings": [],` | changed: compact wording, same caller obligation |
| `On an interactive exit 5 the behaviour is unchanged: pass + a` | changed: compact wording, same caller obligation |
| `This annotation path and the Autonomous-run escalation below` | changed: compact wording, same caller obligation |
| `### MANDATORY chain-outage (L4 lights-out — fail closed)` | changed: compact wording, same caller obligation |
| `On a lights-out (L4) run the adversarial second opinion is` | changed: compact wording, same caller obligation |
| `- The helper derives mandatory-ness itself from the run ledger` | changed: compact wording, same caller obligation |
| `- When the review resolves mandatory (ledger-derived or` | changed: compact wording, same caller obligation |
| `- On exit 9, author the availability signal (a KNOWN` | changed: compact wording, same caller obligation |
| `Why this keys off lights_out, not autonomous (intentional` | changed: compact wording, same caller obligation |
| `When faff-graft forwards $run_dir + <ISSUE> (autonomous L3/L4` | changed: compact wording, same caller obligation |
| `- Honour a resume hint. If graft invoked with "skip Phase-1,` | changed: compact wording, same caller obligation |
| `- After a Phase-1 approving verdict: faff review-progress write` | changed: compact wording, same caller obligation |
| `- Before the review-call.mjs call: faff review-progress write` | changed: compact wording, same caller obligation |
| `- On the call's resolution, map the exit → the phase2 status:` | changed: compact wording, same caller obligation |
| `The checkpoint is a hint — graft reconciles it against` | changed: compact wording, same caller obligation |
| `Returns Phase 1's hard signal (canonical semantics: faff` | changed: compact wording, same caller obligation |
| `After the output above, append one fenced code block — tagged` | changed: compact wording, same caller obligation |
| `faff-contract:review-verdict { "signal": "<Phase 1's verdict —` | changed: compact wording, same caller obligation |
| `- Phase 1's verdict only — except on the autonomous path, where` | changed: compact wording, same caller obligation |
| `- Finding fields (all optional, non-gating): each finding,` | changed: compact wording, same caller obligation |
| `- Phase-2 adversarial hypotheses never drive the hard verdict.` | changed: compact wording, same caller obligation |
| `- adversarial_outcome is OPTIONAL and additive — include it` | changed: compact wording, same caller obligation |
| `- escalated_criticals is OPTIONAL and additive — same` | changed: compact wording, same caller obligation |
| `- the approving verdict may carry zero findings; every other` | changed: compact wording, same caller obligation |
| `- Do not include provenance_present — that field is` | changed: compact wording, same caller obligation |
| `- One block, at the very end, machine-only. Always emit it — a` | changed: compact wording, same caller obligation |
| `On any autonomous run (L3 overnight or L4 lights-out), a` | changed: compact wording, same caller obligation |
| `- Escalation threshold — a single named set.` | changed: compact wording, same caller obligation |
| `- When it fires — all three must hold: Phase 1 returned pass` | changed: compact wording, same caller obligation |
| `- What it emits. Set the block's signal to needs-human, and` | changed: compact wording, same caller obligation |
| `- Fail-safe direction. When the autonomous signal is false,` | changed: compact wording, same caller obligation |
| `On an interactive (L2) run — autonomous false — this section is` | changed: compact wording, same caller obligation |
| `The contract preserves a finding's optional enrichment but` | changed: compact wording, same caller obligation |
| `{ "severity": "critical", "location": "path/to/file.js:120",` | changed: compact wording, same caller obligation |
| `This is additive and contract-safe: the contract validator` | changed: compact wording, same caller obligation |
| `On a later round of the same build's dialogue loop, graft may` | changed: compact wording, same caller obligation |
| `This same adversarial engine is also called by faff-graft Step` | changed: compact wording, same caller obligation |
| `## PRDR YAGNI Phase-2 challenge` | changed: compact wording, same caller obligation |
| `This same adversarial engine is also called by the upper-gate` | changed: compact wording, same caller obligation |
| `BEHAVIOUR PRDR YAGNI Phase-2 challenge (the prdr-yagni seam):` | changed: compact wording, same caller obligation |
| `This is the prdr-yagni seam (judgement_seam above); it feeds` | changed: compact wording, same caller obligation |
| `Anti-pattern: routing the YAGNI Phase-2 challenge through the` | changed: compact wording, same caller obligation |
| `When this engine challenges a loop-authored PRDR (the` | changed: compact wording, same caller obligation |
| `- Never agree with the primary review by default. Actively look` | changed: compact wording, same caller obligation |
| `- Never invent requirements. Every finding must trace to the` | changed: compact wording, same caller obligation |
| `- Keep findings actionable. "This might be a problem" is not a` | changed: compact wording, same caller obligation |
| `- The local LLM may produce lower-quality output than the` | changed: compact wording, same caller obligation |
