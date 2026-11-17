# Extract the qualified rendering rewrite

## Scope and source binding

Port the historically qualified rendering-v2.md rewrite (SHA256 74545fd22fc8451da92bf1ea2f0686940faaa1183453c2402c617131882176e4, 11,288 bytes) onto main cd633ecf. Main had 19 overlapping paragraph/rationale trims from the original a8509086 source. Independent overlap review found their operational meaning retained: universal scope, contract-free rendering, normalise authority, fixed/fresh voice reads, whole-output grounding plus contextual humanisation, concrete-source honesty, table thresholds and separator rules. The historical qualification remains bounded artifact and policy-decision evidence; no new workflow parity claim or model run is made.

One approved integration-only compatibility delta restores the current-main synthesis heading verbatim, preserving the existing eval source loader without code/test changes. Reversing only that heading reproduces the qualified candidate byte for byte. Integrated SHA256 9c9fc6eae6ca1de5032d4cb0b3bd495defe578642906ba86d81a803243b87f0c is 11,291 bytes, saving 9,842 bytes against main. No harness, archive, new mandatory read or runtime helper is imported.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `description: "Default rendering_` | changed: same rule, concise |
| `The default adaptor for renderin` | changed: same rule, concise |
| `Every sub-skill that emits user-` | changed: same rule, concise |
| `yaml slots: rendering_adaptor: f` | changed: same rule, concise |
| `## No internal contract — a pure` | changed: same rule, concise |
| `routing_adaptor translates into ` | changed: same rule, concise |
| `## Why an adaptor, not a produce` | changed: same rule, concise |
| `faffter-noon-spec produces a spe` | changed: same rule, concise |
| `- Define (reference): the visual` | changed: same rule, concise |
| `- Validate / normalise (invokabl` | changed: same rule, concise |
| `## Scope — all human-facing faff` | changed: same rule, concise |
| `Apply all rules to all human-fac` | changed: same rule, concise |
| `Voice (casual-but-credible, clai` | changed: same rule, concise |
| `Injection. Every durable-prose d` | changed: same rule, concise |
| `Swapping the voice. Edit AGENTS.` | changed: same rule, concise |
| `Fold, not a sibling. Voice and f` | changed: same rule, concise |
| `Enumerable content must be skimm` | changed: same rule, concise |
| `- 3+ items → a list. Any enumera` | changed: same rule, concise |
| `- Bold-lead bullets for scannabl` | changed: same rule, concise |
| `- Prose density cap. A prose blo` | changed: same rule, concise |
| `This rule governs tracker descri` | changed: same rule, concise |
| `Token economy is part of underst` | changed: same rule, concise |
| `- No preamble/postamble. Drop th` | changed: same rule, concise |
| `- Don't restate the ticket/reque` | changed: same rule, concise |
| `- Don't narrate what the output ` | changed: same rule, concise |
| `- No hedge/qualifier padding. Cu` | changed: same rule, concise |
| `This does not sacrifice the When` | changed: same rule, concise |
| `Scope: same as Scope — all human` | changed: same rule, concise |
| `When output describes structure ` | changed: same rule, concise |
| `Test: if a reader can point at t` | changed: same rule, concise |
| `Callers pick from this catalogue` | changed: same rule, concise |
| `(a) Cycle bracket (3+ items inli` | changed: same rule, concise |
| `Used for any dep cycle, any coll` | changed: same rule, concise |
| `(b) Cycle box (4+ edges or branc` | changed: same rule, concise |
| `Used when the cycle has 4+ edges` | changed: same rule, concise |
| `(c) Queue partition grid` | changed: same rule, concise |
| `ISSUE-XX [ISSUE-A → ISSUE-B] src` | changed: same rule, concise |
| `Used in queue/build-summary rend` | changed: same rule, concise |
| `(d) Workstream lane` | changed: same rule, concise |
| `Initiative — Audit-lite reliabil` | changed: same rule, concise |
| `(e) Gate fire-status table` | changed: same rule, concise |
| `\| Gate \| Currently fireable? \| N` | changed: same rule, concise |
| `## When prose still wins` | changed: same rule, concise |
| `Three carve-outs where prose sta` | changed: same rule, concise |
| `1. The synthesis gloss itself (s` | changed: same rule, concise |
| `2. Diagnosis lines — "Recommenda` | changed: same rule, concise |
| `3. TL;DR — a skim-in-10-seconds ` | changed: same rule, concise |
| `When output explains a mechanism` | changed: same rule, concise |
| `- Hoist, don't write. This rule ` | changed: same rule, concise |
| `- Mechanism, then method, then s` | changed: same rule, concise |
| `- Carve-out unchanged. TL;DR sti` | changed: same rule, concise |
| `Every issue rendered in any faff` | changed: same rule, concise |
| `1. Tracker ID — breadcrumb for t` | changed: same rule, concise |
| `2. One-sentence plain-English gl` | changed: same rule, concise |
| `3. Unlock-chain consequence (onl` | changed: same rule, concise |
| `The contract governs how issues ` | changed: same rule, concise |
| `ISSUE-XX — Pino instrumentation ` | changed: same rule, concise |
| `In tight tabular contexts (queue` | changed: same rule, concise |
| `ISSUE-XX Pino instrumentation — ` | changed: same rule, concise |
| `In high-density visualisations (` | changed: same rule, concise |
| `The first appearance of each iss` | changed: same rule, concise |
| `- Granularity is per-whole-outpu` | changed: same rule, concise |
| `- This does not supersede the Hu` | changed: same rule, concise |
| `Grounding once is the mechanical` | changed: same rule, concise |
| `In order of preference:` | changed: same rule, concise |
| `1. The spec's one-line summary i` | changed: same rule, concise |
| `2. The issue title plus the firs` | changed: same rule, concise |
| `3. The issue title plus the desc` | changed: same rule, concise |
| `The skill paraphrases — does not` | changed: same rule, concise |
| `Write the gloss as a delivery le` | changed: same rule, concise |
| `Banned in user-facing output:` | changed: same rule, concise |
| `\| Banned form \| Why \| Use instea` | changed: same rule, concise |
| `\| "principle 6", "principle 4", ` | changed: same rule, concise |
| `\| "ADR-N" \| ADR ID is a stable i` | changed: same rule, concise |
| `\| "trigger 4", "criterion 3", "g` | changed: same rule, concise |
| `\| "PRs 3-N", "PR A..E", "step 5 ` | changed: same rule, concise |
| `\| "SHF-307a..e", "SHF-XX/YY/ZZ" ` | changed: same rule, concise |
| `\| "the faff-parked label was alr` | changed: same rule, concise |
| `Allowed:` | changed: same rule, concise |
| `- Real tracker IDs (ISSUE-XX, #P` | changed: same rule, concise |
| `- Short self-explanatory categor` | changed: same rule, concise |
| `- Principle / ADR / criterion re` | changed: same rule, concise |
| `Surface the concrete (the positi` | changed: same rule, concise |
| `- Surface, don't invent. Promote` | changed: same rule, concise |
| `Test: if a reader who has never ` | changed: same rule, concise |
| `Why this matters: every finding,` | changed: same rule, concise |
| `Reserved for issues with ≥2 dire` | changed: same rule, concise |
| `- ✅ "Once this lands, the three ` | changed: same rule, concise |
| `- ❌ "Unlocks 3 issues."` | changed: same rule, concise |
| `If the unlock chain is just 1 is` | changed: same rule, concise |
| `If the spec is genuinely ambiguo` | changed: same rule, concise |
| `> _Spec ambiguous: extend the ex` | changed: same rule, concise |
| `A reliable-but-thin gloss beats ` | changed: same rule, concise |
| `Glosses generated for a given is` | changed: same rule, concise |
| `Every faff sub-skill that names ` | changed: same rule, concise |
| `Long-cell markdown tables break ` | changed: same rule, concise |
| `Scope: all human-facing terminal` | changed: same rule, concise |
| `Drop the markdown table when any` | changed: same rule, concise |
| `1. Any cell exceeds ~30 characte` | changed: same rule, concise |
| `2. Any cell contains multi-sente` | changed: same rule, concise |
| `3. Total table width (cells + se` | changed: same rule, concise |
| `When none of these fire, markdow` | changed: same rule, concise |
| `Use definition-list / key:value ` | changed: same rule, concise |
| `\| Ticket \| Title \| State \| Scope` | changed: same rule, concise |
| `Rewritten:` | changed: same rule, concise |
| `Ticket: SHF-X Title: Prompt subs` | changed: same rule, concise |
| `Use unicode ─ × 40, not markdown` | changed: same rule, concise |
| `A wall of small visuals is the s` | changed: same rule, concise |
| `- Cycle visualisations: at most ` | changed: same rule, concise |
| `- Queue partition grid: at most ` | changed: same rule, concise |
| `- Workstream lane: at most 7 ini` | changed: same rule, concise |
| `Run as a final pass over draft o` | changed: same rule, concise |
| `Checks: markdown tables that bre` | changed: same rule, concise |
| `Output: either a list of violati` | changed: same rule, concise |
| `## Rules` | changed: same rule, concise |
| `- The catalogue is closed. A ski` | changed: same rule, concise |
| `- The visualisation/prose split ` | changed: same rule, concise |
| `- These rules govern user-facing` | changed: same rule, concise |
| `- Validation reports or normalis` | changed: same rule, concise |
