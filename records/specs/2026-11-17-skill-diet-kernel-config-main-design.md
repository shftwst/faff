# Extract the qualified kernel configuration reduction

## Scope and source binding

Port only the previously qualified configuration/slot/dispatch compression from kernel-v1.md: SHA256 edb4d21e3b7382f519be945fa8b8a465e8c6d83f27ba1beb5c0d3798300b5331, identical to a523734d runtime kernel. The original a8509086 baseline is 95,418 bytes; main831d5dff is 94,998 bytes. Main replaces only the later Interactive next-step offer introductory paragraph, a nonoverlapping 420-byte reduction. A clean three-way merge preserves that exact paragraph. Reversing it reconstructs the qualified candidate byte for byte.

Merged kernel SHA256 aa76c16a0d51ee966c3e77cf5df8564834966173f08dd2100da174b82c97ac89 is 83,652 bytes, saving 11,346 bytes against main. No core-contract rewrite, new helper, mandatory read, operator-document dependency or historical evidence archive is imported. Existing consumers and lint check the port; historical measurement remains bounded configuration execution and separate policy decisions, not full caller workflows.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `All faff sub-skills read their configuration from a two-file model under .faff/, resolved via the faff co` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- Two files. .faff/config.yaml is the base — durable, shareable behaviour, recommended committed (git is ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- Missing keys fall back to faff's built-in default. No file at all → all defaults, and, in interactive e` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- Template files are exempt — any name containing .example is never counted or loaded. faff config check ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `CLAUDE.md is no longer a faff config source. It remains the consuming project's own documentation — sub-s` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Resolver. The bundled faff CLI — a dependency-free Node CLI (a thin shebang entrypoint plus modules under` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- faff config path — print each resolved config file on its own line, base first (exit 3 only when neithe` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- faff config get <dotted.key> [-d DEFAULT] — print a scalar value from the merged document (e.g. faff co` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- faff config spec-docs-path [--create] — print the spec-docs directory with the default rule already app` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- faff config resolved — echo the resolved non-default config (both file paths — config: + config local:,` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Resolving the faff executable (canonical — sub-skills reference this). Invoke it as bare faff — the link/` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `then call "$faff" config …. The same CLI hosts faff runcheck (the beep-boop ledger audit) and faff valida` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `It parses the documented YAML subset with a built-in parser — no dependencies.` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `CLI-only config access (load-bearing). Every config read — slots, appetite, tracking., the spec-docs path` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- No hand-reading. No sub-skill, and no agent acting for one, reads the rc file by hand — no shell-readin` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- Why. Hand-reading silently dropped configured slots twice — an agent shell-read a bare-named rc file, f` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- Enforced mechanically. faff validate-adapters fails any skill SKILL.md that shell-reads the rc file dir` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Full schema (every key optional unless noted; shown with example values):` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `yaml # .faff/config.yaml — faff configuration tracking: tracker: linear # linear \| github \| jira \| … (aut` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Stable config only — never mutable state. The config holds stable identifiers and preferences (project id` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Faff auto-detects which issue tracker MCP servers are available and adapts accordingly — tracking.tracker` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `### Slots (optional delegation)` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Faff delegates specialised work to configured skills. Slots live under the slots: key in the config. All ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `yaml slots: intake: superpowers:brainstorming # used by faff-jot for new-work discovery, optional spec: g` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `The spec, review, gates, and ship producers each emit their contract data as a faff-contract:<name> artif` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Descriptor blocks are a distinct class. Not every faff-contract: block pipes to a faff contract <name> va` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Each slot has a built-in default when unset. The default skill owns its own behaviour contract — see that` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| Slot \| Default when unset \| Purpose \|` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| intake \| faffter-noon-intake \| Runs new-work discovery for /faff-jot and emits a discovery brief. A pro` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| spec \| faffter-noon-spec \| Produces the spec (lite nlspec arc). A producer doing-skill. \|` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| adr \| faffter-noon-adr \| Authors the Nygard ADR body (Context/Decision/Consequences) at faff-graft Step` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| architecture \| faffter-noon-architecture \| Generative architecture/infra proposer: reads the brief/spec` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| env \| faffter-noon-env-compose \| Environment provisioner: reads the architecture proposal + infra profi` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| transport \| faffter-noon-transport-private-network \| Evaluator→SUT reachability resolver, composed unde` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| evaluator \| faffter-noon-evaluate \| Code-blind holdout evaluator (the EVALUATE box). Given a spec + a r` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| prd \| faffter-noon-prd \| Code-blind PRD-admissibility producer for the L4 run-start gate: given only a ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| concurrency \| faffter-noon-concurrency-sequential \| Build-pass executor for faff-beep-boop — consumes t` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| review \| faffter-noon-review \| Pre-PR review inside faff-graft. Emits its faff-contract:review-verdict ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| gates \| _(none — built-in graft-step)_ \| Engineering-quality gate ladder at faff-graft Step 7.5: runs t` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| methodology \| faffter-noon-methodology-thematic \| A diagnostic lens over backlog/build state. Sub-skill` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| routing_adaptor \| faffidavit-routing \| Adaptor over the fixed automation-routing contract (six verdicts` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| rendering_adaptor \| faffidavit-rendering \| Pure adaptor (no internal contract — rendering is human-faci` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| ship \| faffter-noon-ship \| Delivery producer inside faff-graft Step 10 — runs deploy-readiness, merges/` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `\| profile \| _(none — built-in repo-miner: faff profile mine)_ \| Infra-profile acquirer: scans the repo fo` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `review and ship are not user-invokable slash commands. They are internal phases of faff-graft, with optio` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Slots choose what skill runs at a stage; the dispatch: tree chooses what model and effort a dispatch runs` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Each lane dispatch.<lane> takes a model and an effort; the registry holds no defaults, so an unset positi` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- dispatch.build — the concurrency executors' build subagents and graft Step 7's bare executor, resolved ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- dispatch.prep_explore — faff-prep's explore and clean-context-verify subagents.` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- dispatch.spec / spec_review / methodology / intake / architecture / adr — the interactive prep / jot / ` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `- eval.model / eval.effort — the eval harness's own eval: block, not a dispatch lane (ADR-0133). The mode` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Rules: resolution is CLI-only, and every dispatch site calls faff dispatch resolve <lane>, never faff con` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
| `Effort is applied only where a transport carries it: faff engine call applies the lane's effort and refus` | changed: same qualified configuration/slot/dispatch rule, compressed wording |
