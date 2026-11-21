# Graft foreground gates and verification options

Shorten the foreground rationale, review-mode signals and the three advisory verification options.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Foreground posture (governs Steps 7–9b, both modes, non-negotiable). Every build/gate/test` | changed: remove incident and lint commentary while keeping the blocking-call and turn-end instructions. |
| `- autonomous — graft's own run mode, not a signal to resolve afresh: true whenever graft is` | changed: preserve signal sources, defaults, review escalation and independent ledger-based outage policy. |
| `- lights_out — the same $lights_out boolean (level:"L4") graft already resolved once for the` | changed: preserve signal sources, defaults, review escalation and independent ledger-based outage policy. |
| `It short-circuits to all-off for any unattended run (a declared-unattended config, or an L4` | changed: defer attendedness to verification resolve and preserve the attended-only opt-ins. |
| `- spec_review pins the full four-lens adversarial spec-review set for this build: select lenses` | changed: preserve the full lens set, optional second opinion, holdout steps and report-only result. |
| `- code_review runs the adversarial code-review second opinion as a normal Step-9 review pass.` | changed: preserve the full lens set, optional second opinion, holdout steps and report-only result. |
| `- holdout pre-accepts the Step-6 holdout OFFER for this attended build, so the RUN fires at` | changed: preserve the full lens set, optional second opinion, holdout steps and report-only result. |
