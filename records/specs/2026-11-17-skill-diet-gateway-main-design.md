# Extract the qualified gateway skill reduction

## Scope and binding

Install only the gateway skill bytes accepted at cf227e03f451d9b3c1e28bbe399c474647b66927 and retained at a523734da3865a10e24239a606663b050a90cbc9. Current origin/main831d5dff883595820fef57bb2446574a2d42a8aa gateway bytes exactly equal the original measured baseline, so there are no intervening skill changes to reconcile. No model rerun, new behaviour, extraction machinery or evaluation archive is included.

Gateway source SHA256 changes from 5d2d4afc4fe71f2b48d1007804d420bfd94f22a576bdbb554e578803de01744d to 122858afa54cc46458ec6a2ad646b73a62a63791c95a71dba731905fbe6ee3d2. Routing, first-run accept/decline/autonomous branches, named enforcement and preview limits remain. Line ratchet and byte allowance only move down. Existing checks cover decline CLI effects and source structure; historical model evidence remains in its original commits, with its original bounded claims.

Saves 7,152 runtime bytes and 1,764 estimated tokens (3,222 to 1,458),
using `ceil(UTF-16 code units / 4)` per complete file.

## Rule inventory

Routing, first-run handling and the trust tables retain the caller rules.
Existing decline-parity, adapter and prose-size tests cover the relevant CLI
effects and source checks. The historical model evidence remains separate.

| Prose rule | Disposition |
|---|---|
| `description: "Gateway — routes to the right faff sub-skill. Use` | changed: compact wording; same caller rule |
| `# Faff` | changed: compact wording; same caller rule |
| `Faff (n.): the tedious palaver around the actual engineering.` | changed: compact wording; same caller rule |
| `Under the hood it's a harness: a set of Claude Code skills` | changed: compact wording; same caller rule |
| `The levels aren't a faff feature. They're how far you've` | changed: compact wording; same caller rule |
| `\| Level \| You're \| Loop run by \| What keeps it honest \|` | changed: compact wording; same caller rule |
| `\| L1 · as the loop \| the engineer \| you \| well… you \|` | changed: compact wording; same caller rule |
| `\| L2 · in the loop \| a step inside it \| the agent \| your nod` | changed: compact wording; same caller rule |
| `\| L3 · on the loop \| watching from the sofa \| the agent \|` | changed: compact wording; same caller rule |
| `\| L4 · out of the loop (preview) \| off down the pub \| the` | changed: compact wording; same caller rule |
| `- L1 · as the loop. You write the code, your usual IDE agents` | changed: compact wording; same caller rule |
| `- L2 · in the loop. /faff-graft drives the build for one issue` | changed: compact wording; same caller rule |
| `- L3 · on the loop. /faff-beep-boop chews through the ready` | changed: compact wording; same caller rule |
| `- L4 · out of the loop. Lights-out, shipped as a preview: faff` | changed: compact wording; same caller rule |
| `#### What's mechanical, what's model-compliance` | changed: compact wording; same caller rule |
| `The "what keeps it honest" column names a mix: some guarantees a` | changed: compact wording; same caller rule |
| `\| Level \| Mechanically enforced (named artifact) \|` | changed: compact wording; same caller rule |
| `\| L1 \| none — you run every step; no safety is delegated to a` | changed: compact wording; same caller rule |
| `\| L2 \| spec-attachment (the prepcheck Stop-hook blocks` | changed: compact wording; same caller rule |
| `\| L3 \| the per-run ledger + runcheck Stop-hook ("enforced` | changed: compact wording; same caller rule |
| `\| L4 (preview) \| the fail-closed lights-out preflight (refuses` | changed: compact wording; same caller rule |
| `The honest axis across all four rungs: decreasing scheduled` | changed: compact wording; same caller rule |
| `Two knobs cut across all four levels. They're not levels` | changed: compact wording; same caller rule |
| `- Slots decide what runs at each stage (a beefier spec, a` | changed: compact wording; same caller rule |
| `- Appetite (for Destruction) sets how much rope the pipeline` | changed: compact wording; same caller rule |
| `## Routing` | changed: compact wording; same caller rule |
| `This is the gateway. Invoke the right sub-skill:` | changed: compact wording; same caller rule |
| `\| Command \| Triggers \|` | changed: compact wording; same caller rule |
| `\| /faff-jot \| "New project", "kick off", "start something",` | changed: compact wording; same caller rule |
| `\| /faff-plot \| "Plan this out", "decompose this app", "break` | changed: compact wording; same caller rule |
| `\| /faff-wtf \| "Where to focus", "What should I work on?",` | changed: compact wording; same caller rule |
| `\| /faff-map \| "Roadmap", "where are we going", "explain the` | changed: compact wording; same caller rule |
| `\| /faff-tidy \| "Tidy the backlog", "clean up", "groom", "mess"` | changed: compact wording; same caller rule |
| `\| /faff-prep ISSUE-XX \| "Prep this", "spec this out", "what` | changed: compact wording; same caller rule |
| `\| /faff-graft ISSUE-XX \| "Work on", "Start this", "take on",` | changed: compact wording; same caller rule |
| `\| /faff-beep-boop \| "Run overnight", "fire and forget", "chew` | changed: compact wording; same caller rule |
| `\| /faff-onboard \| "Set up faff", "onboard", "first run", "no` | changed: compact wording; same caller rule |
| `When any faff entry resolves config and finds no` | changed: compact wording; same caller rule |
| `> No faff config found. Set up faff for this repo now? (y/n)` | changed: compact wording; same caller rule |
| `- Soft-offer, not a gate. Declining is fine — the command` | changed: compact wording; same caller rule |
| `- On accept → invoke the faff-onboard skill via the Skill tool` | changed: compact wording; same caller rule |
| `- On decline → write a minimal stub .faff/config.yaml via faff` | changed: compact wording; same caller rule |
| `- Autonomous/beep-boop runs never emit the offer. Onboarding and` | changed: compact wording; same caller rule |
| `The offer is a single gateway-level check (per the gateway-load` | changed: compact wording; same caller rule |
| `## Routing fallbacks` | changed: compact wording; same caller rule |
| `If the user invokes /faff with no further context, run /faff-wtf` | changed: compact wording; same caller rule |
| `If the user says something that maps to a specific sub-skill,` | changed: compact wording; same caller rule |
