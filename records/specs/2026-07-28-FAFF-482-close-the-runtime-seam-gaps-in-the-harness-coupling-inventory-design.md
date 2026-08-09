**Revised 2026-07-28 — supersedes both spec comments above.** This is the refresh the challenge above asked for. Two review iterations on top of it: the first returned `revise` with four objections (a major infosec one — the previous draft had handed credential scope to the environment along with sandbox and network, when faff's own code decides it; a major QA one — the re-grounded session-context row asserted Codex behaviour with no locator, contradicting the spec's own source rule; and two minor ones), the second returned `approve` with zero objections.

Substantive changes since the approved version: the four passages the challenge named are corrected so the spawn method asserts the environment meets the floor rather than carrying sandbox knobs; **credential scope is split back out as faff's own**, anchored to `engine-codex.js`'s `childEnv` injection and `cli-driver.mjs`'s per-lane forwarding, with its own vocabulary entry, failure mode, scenario and acceptance item; the session-context-file row is re-grounded against the completed refactor (root `AGENTS.md` as single source, `CLAUDE.md` as pointer, `.agents/` empty) and still reads `adapter`, but on the repo-observable property that *which file a harness auto-loads is per-harness* — so it now asserts nothing about Codex at all; and the voice-clause defect the refactor introduced is recorded against FAFF-663 rather than carried as an open question. The methodology critique on the first spec comment still stands.

---

# FAFF-482 — Close the runtime-seam gaps in the harness-coupling inventory

> Spec: faffter-dark-nlspec · 2026-07-28 · interactive · confidence: high. Full spec on Linear FAFF-482.

This spec covers a documentation deliverable: extending `docs/reference/architecture/harness-coupling.md` with the five runtime seams FAFF-592 left unclassified, so that every Claude-Code mechanic faff's *run loop* leans on has a settled Codex mapping. Audience: the build agent that edits the doc, and the human reviewer checking each classification against the codebase.

FAFF-482 was originally scoped as the whole Claude-Code-to-Codex seam mapping. Most of that scope has since landed — FAFF-592 committed the eight-row disposition table, FAFF-593 landed the codex spawn transport, FAFF-604 landed the telemetry read. **This spec covers only the remaining delta.** The hooks seam (Stop hooks and PreToolUse fences) is fully answered by the committed table's two down-stack rows and is explicitly not re-opened here.

## 1. WHY — Problem and Principles

**The load-bearing model: faff's only working Codex path is deliberately hands-off, and every unmapped runtime seam needs the opposite.** `faff engine call` spawns Codex as `codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m <model> -` (`plugin/skills/faff/bin/lib/engine-codex.js`, `buildCodexArgv`). Read-only sandbox, no repo, throwaway working directory, no session accretion. That posture is correct for what it serves — the `methodology` and `intake` producers, which are pure-data-in and whose whole job is to return text. It is exactly wrong for every seam still unmapped: a concurrent build child needs a writable worktree, a headless whole-session run needs to make commits and open a pull request, and a tracker MCP call needs network the read-only sandbox may not grant. The unmapped seams are not five unrelated puzzles. They are one question — *what does a Codex child with hands look like, and what does faff have to check before it spawns one?* — asked five times.

**Problem statement.** `docs/reference/architecture/harness-coupling.md` classifies eight coupling seams and is the inventory FAFF-483 must trace its interface against, but five runtime mechanics faff actually depends on have no row at all: concurrent build fan-out, headless whole-session entry, tracker MCP access, skill-to-skill chaining handoff, and the session context file. FAFF-483 cannot scope a harness-abstraction interface over seams that aren't in the inventory, and the doc's own extension rule states plainly that a seam with no row is an unclassified coupling and a gap. This change adds the five missing rows plus the per-seam detail the harder ones need in order to be scopable.

### Design principles

**One inventory, or the tracing rule dies.** The committed doc closes with a rule FAFF-483 depends on: every seam the harness-abstraction interface names must trace to exactly one row of that table. A second document splits the inventory in two and makes "exactly one row" unenforceable — the next reader has to know which of two pages to check, and the two drift. Everything this ticket produces lands in the one file.

**Classify against evidence in this repo, not against a hoped-for Codex.** Every existing row is anchored to a concrete artifact — a file, a hook list, an ADR, a config key. The new rows keep that discipline for the faff side. On the Codex side there is no binary on this machine to observe (see the Assumptions section), so a Codex-side claim carries its source in one of three permitted forms (defined in the WHAT section) and never poses as an observation. FAFF-593's own module header already sets this precedent: it records that no codex binary was installed and names the observable that would reveal drift.

**A disposition is a judgement about what faff already has, and it is checked against the file, not against the intent.** Two of this spec's five original disposition proposals were wrong because they rested on what a path was assumed to contain rather than what it contains — and the session-context-file row had to be re-derived a second time after the repo's session-context files were refactored out from under it. `portable` in the committed vocabulary means *no work needed*; the moment a seam requires a per-harness registration file or a per-harness pointer file, the work exists and the term is `adapter`. Each row therefore states, in its evidence cell, the specific property that forces its term — so a reviewer checks the reasoning, not just the spelling.

**Sandbox and network reach belong to the environment, not to faff.** Where a seam needs a child with write access or network reach, those are properties of the environment the agent runs in — a container with the relevant CLI installed, a CI runner, a claude-box-style sibling project. faff states what an environment must satisfy, tests it, and refuses when it does not. That is the posture the lights-out runner already takes: *"The cage (`--dangerously-skip-permissions`, host isolation) is the container's job — the runner detects and refuses, it never self-grants nor weakens the host"* (`plugin/skills/faff/bin/lib/lights-out.js`). Rows that touch this seam describe a check, never a set of knobs.

**Credential scope is faff's, and faff's own code says so.** The environment provides that credentials exist on the host; *which credential crosses into which child* is decided in faff's code, per call and per lane. `plugin/skills/faff/bin/lib/engine-codex.js` reads the value of the env var a backend declares in `api_key_env` and injects that value into the child as `OPENAI_API_KEY` (`const childEnv = apiKey ? { ...env, OPENAI_API_KEY: apiKey } : env;`). `eval/cli-driver.mjs`'s `forwardCredentials` copies the OAuth credential file into a run's config directory only when the lane asks for it — the frontier lane asks, and the local lane, pointed at an ollama host, does not. That is not a property faff asserts about the environment; it is a decision faff makes. So a row at this seam states the credential invariant as faff's own to preserve, and never files it under what the environment supplies.

**Security properties that live at a seam are part of the seam.** Where the Claude-side mechanic carries an invariant — a credential that must not travel to a particular endpoint, a config directory that must not be shared — that invariant is part of what a Codex mapping has to reproduce. A row that describes only the mechanical shape of a seam lets a faithful mapping silently drop the invariant riding inside it.

**A spike may return "no mapping" and that is a result, not a failure.** The ticket's completion condition allows a recorded hard blocker in place of a mapping. A row that honestly says no Codex analogue exists, names what would have to change, and names the ticket that owns it, is more useful to FAFF-483 than an invented mapping.

**Do not re-litigate the four dispositions.** `portable` / `adapter` / `down-stack` / `drop` is a closed set, chosen in FAFF-592 over FAFF-477's original two-way backend-swappable-versus-runtime-bound split because two terms cannot express "enforcement moves to CI" or "delete the mechanic". The new rows use the existing four terms.

### Reference context

| Artifact | Kind | Relevance |
|---|---|---|
| `docs/reference/architecture/harness-coupling.md` | Markdown | The inventory this change edits. Eight rows, a four-term disposition vocabulary, a closing "how to extend" rule. |
| `plugin/skills/faff/bin/lib/engine-codex.js` | Node | The only working Codex call path in faff. `buildCodexArgv` fixes the read-only spawn posture; `childEnv` injects the api-key backend's declared secret **value** into the child as `OPENAI_API_KEY`; the module header records that no live binary was observed. |
| `records/adr/0090-engine-transport-gains-a-spawn-family-codex-extending-adr-0054-s-per-lane-transp.md` | ADR | Frames the read-only posture as *"The child gets no hands"* — least privilege on a pure-data-in producer, not a blast-radius boundary. |
| `plugin/skills/faff/bin/lib/lights-out.js` | Node | The L4 preflight. Refuses when the environment does not meet its contract, and states outright that the cage is the container's job, never the runner's to grant. |
| `plugin/skills/faff/bin/lib/container-check.js` | Node | The containment probe. Warns by default and never blocks, escalating to abort only under the opt-in `autonomous.require_container=block` knob. |
| `plugin/skills/faff/bin/lib/engine.js` | Node | Owns the engine-call lane allowlist — `methodology` and `intake` only. The build lane is not routable through it today. |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | Skill prose | The concurrent build executor. Multiple Agent-tool build subagents in flight, one worktree each, capped by `concurrency_max`, rebase-before-merge, `TerminalToken{ issue, outcome, pr }`. |
| `plugin/skills/faff/SKILL.md` | Skill prose | The gateway. Owns "Sibling-skill invocation" (producer dispatch versus chaining handoff) and, at the tracker-autodetect paragraph, the git-only fallback when no tracker MCP is present. |
| `docs/guide/unattended.md` | Markdown | Documents the headless entry as `FAFF_RUN_DIR="$FAFF_RUN_DIR" claude -p "/faff-beep-boop"` wrapped by `faff disposition`. |
| `eval/cli-driver.mjs` | Node | The eval frontier driver. `buildInvocation` emits `claude -p`; `forwardCredentials` copies the OAuth credential file into the per-repetition config dir at mode `0600`, and faff decides **per lane** whether it travels at all — the frontier lane forwards, the local lane does not. |
| Root `AGENTS.md` and root `CLAUDE.md` | Markdown | The session context files, recently refactored. `AGENTS.md` is now the single 60-line source — contributor guidance plus the full writing-style half. `CLAUDE.md` is a 3-line pointer at it. See the session-context-file row below, and read both before writing that row. |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | Node | The hooks seam — already classified down-stack in two committed rows. Cited here only to mark it out of scope. |

**Scope.** This is the last piece of the FAFF-477 audit's deliverable half. It gates FAFF-483 (the harness-abstraction interface) and feeds FAFF-479 (route the build lane through another harness), which is the ticket that actually makes a Codex child do a build.

## 2. OUT OF SCOPE

- **The hooks seam — Stop hooks and PreToolUse fences.** Why excluded: fully answered at full depth by the committed table's two down-stack rows, anchored to `hooks-ensure.js`, the `governance-check` required CI check, and ADR-0043's forge-side merge floor. Re-specifying it would produce a duplicate classification, not new information. Extension point: those two existing rows, if the enforcement floor ever moves.
- **Deciding the sandbox mode and network reach a write-capable child runs under.** Why excluded: those are not faff's to pick — they are properties of the environment the child runs in; faff states the floor, checks it, and refuses when it is not met. This doc states what is at stake so FAFF-483 defines a check rather than a knob panel; it neither picks nor configures the values. **Credential scope is not excluded on those grounds**, because it is not the same kind of thing: faff's own code decides which credential enters which child (`engine-codex.js`'s `childEnv`, `cli-driver.mjs`'s per-lane forwarding), so the rows state that decision and the invariant riding on it. What *is* excluded on the credential side is which credential mechanism is sanctioned — FAFF-478's question, not this doc's. Extension point: FAFF-605 for the per-level environment floor and its check, FAFF-662 for operator guidance on building and verifying such an environment, FAFF-478 for the credential mechanism.
- **Changing `buildCodexArgv`'s spawn flags.** Why excluded: `--sandbox read-only` there is least privilege on faff's own pure-data-in producer — a child that only returns text declining capabilities it has no use for (`records/adr/0090-…`, "The child gets no hands"). It is not the boundary that bounds a build child, and nothing in this doc argues for widening it. A build lane gets a different call path, not a loosened producer path. Extension point: FAFF-479, which is where a build-lane spawn is written.
- **Implementing any of the mappings.** Why excluded: FAFF-482 is a spike whose deliverable is a document. Writing a Codex build driver is FAFF-479; the per-level environment floor and its check are FAFF-605; the eval-lane routing is FAFF-480. Extension point: each named follow-on ticket, referenced from its row.
- **Defining the harness-abstraction interface itself.** Why excluded: that is FAFF-483, which this ticket gates. This doc supplies the seam list that interface must cover, not the interface. Extension point: FAFF-483.
- **Repairing the gateway's voice clause, which now points at a deleted file.** Why excluded: the clause names `.agents/STYLE.md` (`plugin/skills/faff/SKILL.md`, "Voice clause"), the session-context refactor moved those rules into root `AGENTS.md`, and the clause's own fallback is "File absent → skip this instruction" — so every producer dispatch now drops the house voice without saying so. A grep for `agents/STYLE.md` across `plugin/skills/` returns exactly four files: the gateway itself, `faffter-dark-concurrency-parallel/SKILL.md`, `faffter-noon-concurrency-sequential/SKILL.md` — the *default* concurrency occupant, so the path most runs take — and `faffidavit-rendering/SKILL.md`. That is a live defect in skill prose, not a seam classification, and fixing it inside a documentation ticket would put a prompt change in a doc-only pull request. FAFF-663 owns it. Extension point: FAFF-663, covering those four files plus the engine-lane fork that appends the style source's contents to the payload.
- **Re-checking the codex-switch runbook's session-context paragraph.** Why excluded: `records/superpowers/faff-codex-switch-runbook.md` used to derive the session-context row's `adapter` term from the two files diverging, under a heading addressed to the agent about to build this ticket. That page has since been corrected (2026-07-28): the paragraph is re-grounded on which file a harness auto-loads, and it now says outright to ignore any older description of the row that mentions divergence or quotes the two files' line counts. Nothing is left to repair. It stays excluded because it is a personal working note rather than repo evidence — no added row may cite it as a source. Extension point: that runbook's session-context paragraph, if the row is ever re-derived again.
- **Running a live `codex` binary to verify the mapping.** Why excluded: no codex binary exists on this machine, and FAFF-593 already shipped its transport on the same documentation-sourced basis with a named drift observable. Live verification belongs where a live run happens anyway — FAFF-479's acceptance. Extension point: FAFF-479's "verify against a real codex binary before merging" condition.
- **Subscription-seat auth and terms-of-service posture.** Why excluded: owned by FAFF-478 (the spike) and FAFF-481 (wiring the chosen auth). A seam mapping can name that a Codex child needs credentials without deciding which credential mechanism is sanctioned. Extension point: FAFF-478.
- **Widening the engine-call lane allowlist.** Why excluded: `engine.js` allows `methodology` and `intake` only, deliberately — those are the pure-data-in producers. Adding the build lane is a code change with its own ticket (FAFF-479), not a doc edit. Extension point: the lane allowlist in `engine.js`.

## 3. WHAT — the shape of the change

### Vocabulary

| Term | Definition |
|---|---|
| **Runtime seam** | A place faff depends on a harness mechanic *while a run is executing* — spawning a child, entering a session headlessly, calling a tool, transferring control between skills — as opposed to a config-lane seam that only shapes how a call is parameterised. |
| **Hands** | Write access to a working tree plus the ability to run commands in it. The distinguishing property of a build child versus a producer child. |
| **Environment floor** | The set of properties an environment must have for faff to run at a given autonomy level — what the container, runner, or sibling cage supplies. faff asserts the floor is met and refuses when it is not; it never configures the environment to meet it. |
| **Credential scope** | Which credentials faff puts into a given child, decided in faff's own code per call and per lane. Distinct from the environment floor: the environment supplies that credentials exist, faff decides which ones travel. |
| **No mapping** | The recorded outcome when a seam has no Codex analogue and no shim short of building one. The ticket's "hard blocker". Expressed in a row's evidence cell as a sentence opening with the literal words `No mapping:` and closing with the ticket that owns the gap — never as a fifth disposition term. |
| **Sourced Codex claim** | A sentence about Codex behaviour that carries a locator of one of the three permitted forms below. Anything without one is not a claim this doc may make. |

### The permitted forms of a Codex-side source

Every sentence in the added content that asserts something about Codex carries exactly one of these, inline, at the end of the sentence or clause:

| Form | Example | Minimum bar |
|---|---|---|
| A repo path | `(plugin/skills/faff/bin/lib/engine-codex.js, buildCodexArgv)` | The path exists in this repo. |
| A named upstream artifact with its file locator | `(codex-rs exec/src/cli.rs)` or a full documentation URL | Names the file or the URL, not the project. |
| A ticket whose committed spec carries the citation | `(per FAFF-593's spec)` | The ticket exists and its spec is attached. |

**Not acceptable, and checkable as such:** "per the Codex docs", "upstream supports this", "Codex's CLI offers", or any bare product-name attribution with no file, URL, or ticket. The check is mechanical — every added sentence containing the word "Codex" in an asserting mood ends its clause with one of the three forms.

A row that can carry its argument without a Codex-side claim at all is the stronger row, and the session-context row below is written that way deliberately.

### The five rows to add

Each lands in the existing seam table in `docs/reference/architecture/harness-coupling.md`, in the same four-column shape (Seam / Today (Claude Code) / Disposition / Evidence and follow-on) the eight committed rows use.

```
RECORD SeamRow:
  seam: Text                # bold lead, names the mechanic — not a ticket id, not a code name
  today: Text               # what the Claude Code path is, anchored to a file or a documented command
  disposition: portable | adapter | down-stack | drop   # closed set, unchanged from FAFF-592
  evidence: Text            # concrete artifact(s) + the property forcing the term
                            # + follow-on ticket + any "No mapping: … <ticket>" sentence

  CONSTRAINT disposition is exactly one of the four committed terms
  CONSTRAINT disposition equals the value this spec assigns below, unless the departure
             is justified in writing against the committed vocabulary's own wording
  CONSTRAINT evidence names at least one path, command, ADR, or config key that exists in the repo
  CONSTRAINT evidence names the property that forces the assigned term
  CONSTRAINT every Codex-side claim carries one of the three permitted source forms
  CONSTRAINT any "No mapping:" sentence ends with the ticket that owns the gap
```

**The dispositions below are normative, not advisory.** The build agent writes these values. It may depart from one only by recording, in the pull request, the sentence from the committed vocabulary that forces a different term — a departure is a reviewable claim, not a free choice.

| Row to add | Claude Code mechanic today | Disposition | The property that forces that term |
|---|---|---|---|
| **Concurrent build fan-out** | `faffter-dark-concurrency-parallel` runs up to `concurrency_max` Agent-tool build subagents at once, each in its own worktree, each returning a `TerminalToken{ issue, outcome, pr }`. | **adapter** | The concurrency moves out of a harness feature and into faff's own orchestration, behind a documented mapping — and the child needs hands, which faff's producer spawn does not give and which the environment, not faff, supplies. |
| **Headless session entry** | `claude -p "<prompt>"` as a whole-session one-shot — the unattended drain in `docs/guide/unattended.md` and the eval frontier driver's `buildInvocation` in `eval/cli-driver.mjs`, whose `forwardCredentials` copies the OAuth credential into the per-repetition config dir at mode `0600`, frontier lane only. | **adapter** | Entry command, run-directory threading, exit-code contract and per-repetition credential isolation are all per-harness; each needs a mapped equivalent, none is free. |
| **Tracker MCP access** | The agent calls whatever tracker MCP the harness surfaces; faff autodetects it and falls back to git-only mode when absent (`plugin/skills/faff/SKILL.md`, the tracker-autodetect paragraph). The CLI itself never touches MCP. | **adapter** | MCP servers are registered per harness — Codex registers them in its `config.toml` (per FAFF-477's planning package as filed in `verification/reports/tracker-filing-plan.md`). A registration file that must be written per harness is a documented mapping, which is the vocabulary's own definition of `adapter`, not "no work needed". Miss the registration and faff degrades silently into git-only mode rather than failing. |
| **Skill-to-skill chaining handoff** | The chaining half of the gateway's Sibling-skill invocation convention: control *transfers* to a sibling that takes over the conversation, invoked via the Skill tool (`plugin/skills/faff/SKILL.md`, "Producer dispatch vs chaining handoff — the transport"). | **drop** | The Skill tool has no analogue outside a harness that offers a skill-invocation tool, and the job it does is carried out by prose instead: the running agent reads the sibling's `SKILL.md` and follows it inline. That is the committed definition of `drop` — "the harness mechanic is removed; its job moves into skill-step prose or the CLI" — and the same shape as the committed WorktreeCreate row. The *other* half of the convention, Agent-tool producer dispatch, is already classified in the committed Subagent dispatch row; see it rather than this row. |
| **Session context file** | Root `AGENTS.md` (60 lines) is the single source of session guidance — contributor standards (skill-authoring, the Glossary pointer, the not-faff-config rule) plus the full writing-style half (voice, positioning language, claims discipline, banned words). Root `CLAUDE.md` is a 3-line file whose only content is a pointer at it. | **adapter** | The *content* is single-sourced and carries nothing harness-specific — but **which file a harness auto-loads is per-harness**, and that is the seam. The repo demonstrates it against itself: Claude Code does not auto-load `AGENTS.md`, and that is the only reason the 3-line `CLAUDE.md` exists. The committed vocabulary's `portable` is "harness-independent already; no work needed", and any harness that does not read the root convention natively needs its own pointer file written — so the work exists and "no work needed" is false. A per-harness pointer file is exactly the "documented mapping" `adapter` names, the same shape as the tracker-MCP row's per-harness registration. Follow-on: FAFF-662, operator guidance on building and verifying an environment faff will run in, including a non-Claude one. |

Four of the five land on `adapter` and one on `drop`. The count survived a re-derivation: the session-context-file row was re-checked against the four-term vocabulary after the repo single-sourced its session guidance into root `AGENTS.md`, and it still reads `adapter` — but for a different and much cheaper reason than before. It is no longer two files whose diverging contents must be kept in a known relationship; it is one source plus a thin pointer file for each harness that does not read the root convention natively. The doc states the count as a finding: not one runtime seam is free. Four need a mapped equivalent before a Codex run loop exists, and the fifth — the chaining handoff — does not survive the swap at all; its harness mechanic goes away and skill prose does the work instead.

### The detail section to add

Three of the five rows carry a design question a one-line row cannot hold — enough of one that FAFF-483 could not scope from the row alone. They get a short subsection each, in the same file, under a new heading after the seam table.

```
RECORD SeamDetail:
  seam: Text                    # matches a row's seam name exactly, no separate naming scheme
  what_codex_offers: Text       # the analogue, with its source in a permitted form
  what_is_missing: Text         # the delta faff must supply, or the recorded "No mapping: … <ticket>"
  what_the_environment_supplies: Text  # required where the mapping needs a child with hands:
                                       # writable checkout, session persistence, sandbox, network —
                                       # what the environment provides and what faff checks
  what_faff_decides: Text       # required on the same subsections: credential scope, and the
                                # invariant riding on it, named to faff's own code
  what_faff_483_must_name: Text # the one sentence FAFF-483 scopes from
```

Detail subsections are written for: concurrent build fan-out, headless session entry, skill-to-skill chaining handoff. Tracker MCP access and the session context file are one-line rows with no subsection — their mapping is a registration-file difference and a pointer-file difference respectively, each fully expressible in an evidence cell, and a subsection for them would be bloat.

Thirteen decisions shape the change above — where the output lands, one inventory versus two, which sense of "fan-out", whether headless entry earns a row, how a hard blocker is recorded, who owns the posture a child with hands needs and who owns its credentials, whether the session context file is in scope and how it classifies after the refactor, what to do about the gateway voice clause the refactor broke, whether the repo owner's tracker comment is reconciled back and what that implies for the tracker row's term, how the tracing rule is made enforceable from both sides, what the skill-routing seam actually classifies once producer dispatch is set aside, who performs the cold-read check, and whether a documentation-sourced mapping is enough to close a spike. Each is settled with its options and rationale in **Design decision rationale** below, which is the single home for them; they are not restated here.

## 4. HOW — producing the change

### Approach

This is a single-file documentation edit with a verification pass in front of it. The build agent re-grounds each claim against the repo, writes the rows with the dispositions this spec assigns, writes the detail subsections, and checks the result against the doc's own extension rule.

```
PROCEDURE extend_harness_coupling_inventory:
  1. Read docs/reference/architecture/harness-coupling.md in full — the four-term
     vocabulary, all eight rows, and the closing extension rule.
  2. FOR each of the five seams named in WHAT:
     a. Confirm the Claude Code mechanic in the repo at the anchor named in
        the Reference context table, by opening the file and reading it. If an
        anchor has moved, update the anchor to its current location; do not park.
     b. Write the disposition this spec assigns for that seam. Do NOT re-decide
        it from scratch. To depart, record in the pull request the sentence of
        the committed four-term vocabulary that forces a different term; a
        departure without that sentence is a review failure, not a judgement call.
     c. Write, in the evidence cell, the property that forces the assigned term.
     d. IF the seam carries a security invariant on the Claude side (a credential
        that must not reach a particular endpoint, a config directory that must
        not be shared), state the invariant in the evidence cell in terms of what
        must remain true, not only the mechanism that happens to implement it
        today. Credential scope is faff's own decision — name the code that makes
        it (engine-codex.js's childEnv injection, cli-driver.mjs's per-lane
        forwarding), never the environment.
     e. IF the seam needs a child with hands, state that the writable checkout,
        the persisted session, the write-permitting sandbox and the network reach
        come from the environment, and that faff's part is an assertion the
        environment meets the floor for the level being run at plus a refusal
        when it does not. Do NOT write the doc as though faff configures a
        sandbox. Do NOT extend that sentence to cover credentials — step d owns
        those, and they are faff's.
     f. IF no Codex analogue is found for the seam:
        - Write the evidence cell opening with "No mapping:", stating what
          would have to change, and closing with the ticket that owns the gap —
          the same "Follow-on: FAFF-xxx" shape the committed rows use.
        - Still assign one of the four terms for faff's own response.
     g. Write the row in the existing four-column shape.
  3. Insert the five rows into the seam table, after the eight existing rows.
     Preserve the committed rows byte-for-byte, with exactly one permitted
     exception (step 4).
  4. Append one cross-reference sentence to the END of the committed
     subagent-dispatch row's Evidence cell, naming the concurrent-build-fan-out
     row. That row's Seam, Today, and Disposition cells are untouched, its
     existing evidence text is untouched, and no other committed row changes at
     all. This is the only edit to committed content this ticket may make.
  5. Add the detail section after the seam table, with one subsection each for
     concurrent build fan-out, headless session entry, and skill-to-skill
     chaining handoff. Each subsection states what Codex offers (with its
     source), what faff must supply, and the one sentence FAFF-483 scopes from.
     The fan-out and headless-entry subsections additionally state what the
     environment supplies and what faff checks, and — separately — that
     credential scope is faff's own (see below).
  6. Leave the closing "How to extend" section last in the file and unedited.
  7. Self-check, mechanically:
     a. every new row's evidence names a path, command, ADR, or config key that
        exists in the repo;
     b. every sentence asserting Codex behaviour ends its clause with one of the
        three permitted source forms;
     c. the disposition column contains only the four committed terms, and the
        five new rows carry the values this spec assigns (or a recorded departure);
     d. every "No mapping:" sentence ends with a ticket id;
     e. no sentence in the added content describes faff as setting a sandbox mode
        or a network posture for a child, AND no sentence describes credential
        scope as something the environment supplies;
     f. no sentence implies buildCodexArgv's --sandbox read-only is a blast-radius
        boundary or that any follow-on ticket changes it;
     g. each of the five seams named in the original FAFF-482 scope resolves to
        either a new row or a named existing row (see the DONE section).
  8. Dispatch the cold-read check to a clean-context reviewer per the decision
     below. Do not self-certify it.
```

### What each detail subsection must settle

**Concurrent build fan-out.** Claude Code's mechanic is the Agent tool launched several times in one turn, with the orchestrator awaiting all of them. Codex's exec mode is a one-shot child (`plugin/skills/faff/bin/lib/engine-codex.js`, `buildCodexArgv`; transport per FAFF-593's spec), so the analogue is the orchestrator spawning several `codex exec` children itself and awaiting all their exits — the concurrency moves from a harness feature into faff's own orchestration. The delta to state: faff's producer spawn gives its child no hands at all, so the fan-out mapping depends on a build child that has them, and faff does not spawn one today.

**What the environment supplies, stated in the subsection:** a build child needs a writable checkout, persisted session state, a sandbox that permits writes, and network reach. None of that is faff's to configure. It is a property of the environment the agent runs in: a container with the CLI installed, a CI runner, a claude-box-style sibling. What the spawn method FAFF-483 defines carries is an **assertion that the environment meets the floor for the autonomy level being run at**, and a refusal when it does not — the same posture `lights-out.js` already takes for L4. FAFF-483 defines a check, not a set of knobs. FAFF-605 owns the per-level floor and its check; FAFF-662 owns the operator guidance for building and verifying such an environment, including a non-Claude one.

**What faff decides, stated separately in the same subsection:** which credentials cross into the child. A child returning a `pr` in its `TerminalToken` has to push a branch and open the pull request, so it needs forge credentials on top of whatever provider credential its model access needs — and faff's own code is what puts them there. `engine-codex.js` reads the value of the env var a backend names in `api_key_env` and sets it in the child's environment as `OPENAI_API_KEY`; nothing about that is the container's call. The environment provides that a credential exists on the host; faff picks which ones a given child gets. The subsection says so plainly, so FAFF-483's interface owns credential scope rather than assuming it away.

**Headless session entry.** `codex exec` is the direct analogue and faff already spawns it, so the transport question is settled. The delta to state is what a whole-session headless run needs that a producer call does not: a working repository rather than `--skip-git-repo-check` with a temp directory, persisted session artifacts rather than `--ephemeral`, a run directory threaded through to the child, and a process exit code the wrapper can gate on — the contract `faff disposition` fills for the Claude path (`docs/guide/unattended.md`).

**The eval call site carries a security invariant, and the subsection states it as an invariant, not as a mechanism.** `eval/cli-driver.mjs` gives each repetition its own `CLAUDE_CONFIG_DIR` so a repetition never writes the parent session's config, and `forwardCredentials` then copies the OAuth credential file into that per-repetition directory and chmods the copy to `0600`. Crucially it does that for the frontier lane only: the local lane redirects the Anthropic Messages API at an ollama host, and the code's own rule is that the real credential must not be copied into a run pointed at a third-party endpoint. The invariant to carry into any Codex mapping is therefore two-part and both parts must survive: **per-repetition config isolation**, and **never forward a provider credential into a run whose endpoint is not that provider's**. A mapping that reproduces the isolation and drops the second half looks correct and is not. The subsection also names whether a Codex equivalent of per-repetition isolation is known or is an open item for FAFF-480.

**What the environment supplies for a headless build child, and what faff still decides.** The unattended drain's whole job is to commit, push, and merge, so a Codex equivalent needs the same environment properties the fan-out child does — a writable checkout, persisted session state, a sandbox permitting writes, and network reach. Those the environment provides and faff checks. The credentials are the other half, and they are not the environment's call: `cli-driver.mjs` decides per lane which credential travels, forwarding the OAuth file for the frontier lane and withholding it from the local lane pointed at an ollama host. Every additional credential a headless child carries is one more thing the "never forward a provider credential into a run whose endpoint belongs to a different provider" rule applies to — and that rule lives in faff's own spawn path, so it is FAFF-483's interface that has to preserve it. FAFF-479 and FAFF-480 own the two lanes; FAFF-662 owns the guidance for standing the environment up.

**Skill-to-skill chaining handoff.** Two neighbouring classifications already exist and this subsection touches neither: the `SKILL.md` artifact is portable in the committed skills-and-frontmatter row, and Agent-tool producer dispatch is `adapter` in the committed subagent-dispatch row, with the engine fork as its portable transport. The subsection opens by pointing at both rather than restating them, so a reader arriving here knows immediately which question is left. The question left is the chaining half — the gateway's Chaining-pattern gates (prep→graft, jot→prep/plot, graft→prep/wtf), where control *transfers* to a sibling that takes over the conversation, invoked via the Skill tool precisely so a subagent does not run it in a throwaway context and discard the new driver (`plugin/skills/faff/SKILL.md`, Sibling-skill invocation). Outside a harness offering a skill-invocation tool there is no equivalent call: the mechanic goes away and its job moves into prose, with the running agent reading the sibling's `SKILL.md` and following it inline in the same context. The subsection states what that costs in practice — a handoff that was a single tool call becomes an instruction the agent has to obey, so the chain point stops being enforced by the harness and becomes something the prose has to make unmissable — and names what FAFF-483 scopes from: the interface needs no chaining primitive, but every gateway chain gate needs a prose form that reads as an instruction rather than a suggestion. This subsection needs neither an environment sentence nor a credential sentence — transferring control between skills is not a hands question and moves no secret.

### Anti-patterns

**Anti-pattern:** creating `design/harness-agnostic-runtime.md` because the ticket says so. Why: no `design/` root exists, FAFF-592 already redirected the equivalent path into `docs/reference/architecture/`, and a second inventory breaks the tracing rule FAFF-483 depends on.

**Anti-pattern:** treating the WHAT table's dispositions as suggestions and re-deriving each term from the four committed definitions. Why: two of the original five proposals were wrong because the derivation was done against an assumption about a file rather than against the file. The terms in that table are the checked answers; a departure is a written claim against the vocabulary's own wording, reviewable as such.

**Anti-pattern:** writing the doc as though faff configures the child's sandbox or its network reach — "the spawn method carries sandbox mode and network posture". Why: that puts cage configuration inside faff's own interface, which is the opposite of the posture the runner already takes. `lights-out.js` says it plainly: the cage is the container's job, and the runner detects and refuses rather than self-granting. The honest sentence is that the environment supplies the posture and faff asserts the floor is met.

**Anti-pattern:** carrying that same reasoning one step too far and handing credential scope to the environment as well. Why: faff's own code decides which credential enters which child — `engine-codex.js` injects the declared env var's value as `OPENAI_API_KEY`, and `cli-driver.mjs` forwards the OAuth credential for the frontier lane while withholding it from the local one. A doc that files credential scope under "the environment supplies this" tells FAFF-483 the invariant sits outside its interface, and two files of faff's own code say otherwise.

**Anti-pattern:** describing `buildCodexArgv`'s `--sandbox read-only` as the boundary that bounds faff's blast radius, or as something a follow-on ticket will loosen. Why: ADR-0090 frames it as "The child gets no hands" — least privilege on a producer that only returns text and has no use for the capability. Treating it as a containment boundary invites a future reader to widen it in place instead of giving the build lane its own call path.

**Anti-pattern:** rewriting, re-ordering, or re-classifying committed rows. Why: other committed specs cite those rows by name — FAFF-595's spec points at the WorktreeCreate row, and FAFF-593's records having updated the subagent-dispatch row. The single permitted exception is the appended cross-reference sentence in step 4, which adds a pointer and changes no classification.

**Anti-pattern:** describing a seam's mechanism where the mechanism is carrying an invariant — "per-repetition `CLAUDE_CONFIG_DIR` isolation" as the whole story of the eval driver. Why: an implementer can reproduce that sentence exactly and still copy a provider credential into a run pointed at someone else's endpoint. State what must remain true, then the mechanism that happens to achieve it today.

**Anti-pattern:** asserting Codex behaviour in the present indicative without a source — "Codex spawns children with write access", "Codex reads `AGENTS.md` at session start". Why: no codex binary exists on this machine, so every such sentence is a documentation claim wearing an observation's clothes. The repo's own style rule is that hedging qualifies while evidence quantifies; the honest form names the source in one of the three permitted shapes, and the stronger form finds an argument that needs no Codex-side claim at all.

**Anti-pattern:** adding a fifth disposition term for hard blockers. Why: the four terms describe faff's response to a seam, not the search result. A fifth term would make the closed set ambiguous for every future reader and for FAFF-483's tracing rule.

**Anti-pattern:** restating the governing principle in each new row. Why: the doc states it once above the table deliberately, and the committed rows carry evidence rather than philosophy. New rows match.

### Failure modes

**The mapping is paper, and a live Codex binary contradicts it.** Every Codex-side claim here comes from documentation and from codex-rs sources pinned in FAFF-593's spec, not from a run. How you would know: the first real `codex exec` invocation on a build lane fails on a flag this doc claimed exists, or the sandbox refuses a write this doc assumed the environment would grant. What it means: not abandonment — the doc is the scoping input for FAFF-483, and FAFF-479 already carries "verify against a real codex binary before merging as done" as its own acceptance condition. It does mean the rows must be written so a wrong Codex claim invalidates one cell rather than the row's disposition, which is exactly what the source-form rule buys — and it is why the session-context row is written to need no Codex claim at all.

**A disposition is wrong and every shape check still passes.** This already happened twice: two of the five original proposals classified a seam by what a file was assumed to contain, and the session-context-file row's evidence went stale when the repo single-sourced its session guidance into root `AGENTS.md` after this spec was first approved. How you would know: a reviewer opens the file named in the evidence cell and the property the cell claims is not there. What it means: the mitigation is in the procedure and in DONE — the dispositions are pinned to specific values, each row must name the property forcing its term, and step 2a requires opening the anchor rather than trusting the reference table. A shape-only gate on a doc whose entire deliverable is judgements is not a gate. The session-context row is the one to re-open the files for first, because its underlying files changed most recently.

**A security invariant is reproduced as a mechanism and lost.** The eval driver's credential rule is one line of comment next to a `copyFileSync`. How you would know: a Codex mapping that specifies "isolated config dir per repetition" and says nothing about which endpoint the credential may reach. What it means: the invariant is stated in the headless-entry row and its subsection as a *must remain true* sentence, and the cold-read check asks for it directly.

**Credential scope gets filed under the environment and quietly leaves faff's interface.** The environment genuinely owns sandbox and network reach, and the same sentence shape reads naturally with "and the credentials" appended to it. How you would know: FAFF-483's author reads the two subsections, concludes credential scoping is the container's problem, and writes an interface with no place to say which secret a child receives — while `engine-codex.js` goes on injecting `OPENAI_API_KEY` and `cli-driver.mjs` goes on deciding per lane. What it means: the environment list and the faff-decides list are written as two separate statements in each subsection, never one list, and the self-check has a rule for exactly this.

**Two seams converge on the same missing thing: a Codex child with hands.** Two of the three detail subsections reduce to the same "what is missing" sentence. How you would know: read both subsections' missing-capability sentences side by side and they say the same thing. What it means: the convergence is a real property of the mapping and belongs in the doc — it tells FAFF-483 that the first interface method to define is spawning a child with hands. What it does **not** mean is that faff has to build a cage. The writable checkout, the network reach and the write-permitting sandbox are the environment's to provide; faff's part is asserting the floor is met for the level being run at and refusing when it is not. Credential scope is the standing exception and stays faff's. Nor does the requirement gate anything: FAFF-605 defines the per-level floor and its check at Medium priority and blocks no ticket. At L1–L3 a human is in the loop and `container-check`'s existing warning is proportionate — it warns and never blocks, escalating to abort only under the opt-in `autonomous.require_container=block` knob (`plugin/skills/faff/bin/lib/container-check.js`). At L4 the lights-out preflight already refuses when the environment does not meet its contract (`plugin/skills/faff/bin/lib/lights-out.js`). Recording the requirement, whose it is, and where the check lives is the deliverable.

**The rows are true but too thin to scope from.** The completion condition is that FAFF-483 can be scoped from this doc, which is a judgement about a downstream reader. How you would know: FAFF-483's own prep opens the page and finds it must re-derive the concurrent-fan-out mapping from scratch. What it means: the detail section is the mitigation, and its sufficiency test is the clean-context cold read decided below — deliberately not performed by the agent that wrote the page.

**The inventory grows past the point anyone reads it.** Thirteen rows plus a detail section is a longer page than the one-page inventory FAFF-592 deliberately produced. How you would know: the detail section grows longer than the table it annotates. What it means: hold the depth rule FAFF-592 set — one page of evidence-anchored rows, follow-on work referenced by ticket. Detail subsections are three or four short paragraphs, not per-seam design documents, and only three of five seams get one.

## 5. SCENARIOS

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given docs/reference/architecture/harness-coupling.md on main after this change
When a reader searches the seam table for concurrent build fan-out, headless
     session entry, tracker MCP access, skill-to-skill chaining handoff, and
     the session context file
Then each is found as exactly one row, each carries exactly one of the four
     committed disposition terms, and no seam appears in more than one row
```

```
Given the five new rows
When a reviewer checks the disposition column against this spec's WHAT table
Then concurrent build fan-out, headless session entry, tracker MCP access and
     the session context file each read "adapter", skill-to-skill chaining
     handoff reads "drop", or the pull request carries a written departure
     quoting the committed vocabulary sentence that forces the different term
```

```
Given the skill-to-skill-chaining-handoff row
When a reader asks why it is "drop" and not "adapter" like its neighbours
Then the row states that the Skill tool has no analogue outside a harness
     offering skill invocation and that its job moves into skill prose — the
     running agent reading and following the sibling's SKILL.md inline — and
     it points at the committed Subagent dispatch row for the producer-dispatch
     half rather than restating that row's classification
```

```
Given the session-context-file row
When a reader asks what makes it an adapter rather than portable
Then the row states that the session guidance is single-sourced in root
     AGENTS.md and that the seam is which file a harness auto-loads, not what
     the guidance says — Claude Code does not auto-load AGENTS.md, which is the
     only reason the 3-line CLAUDE.md exists — and names writing that
     per-harness pointer file as the work "no work needed" would have to be
     free of, all without asserting anything about Codex
```

```
Given the concurrent-build-fan-out and headless-session-entry subsections
When a reader asks what a write-capable Codex child needs and who provides it
Then each subsection states that the writable checkout, the persisted session,
     the write-permitting sandbox and the network reach are properties of the
     environment the child runs in; that what faff's spawn method carries is an
     assertion the environment meets the floor for the autonomy level being run
     at, plus a refusal when it does not; and names FAFF-605 as owner of the
     per-level floor and its check and FAFF-662 as the operator guidance for
     building and verifying such an environment
```

```
Given the concurrent-build-fan-out and headless-session-entry subsections
When a reader asks who decides which credentials a child receives
Then both subsections answer that faff does — naming engine-codex.js's
     injection of the declared api_key_env value as OPENAI_API_KEY and
     cli-driver.mjs's per-lane forwarding — and neither lists credentials among
     the things the environment supplies
```

```
Given the whole added content
When a reader looks for what faff itself configures about a child's sandbox
Then they find nothing — no added sentence describes faff setting a sandbox
     mode or a network posture, and no added sentence describes buildCodexArgv's
     --sandbox read-only as a blast-radius boundary or as something a follow-on
     ticket loosens
```

```
Given a seam among the five for which the build agent finds no Codex analogue
When that row is written
Then its evidence cell opens with the literal words "No mapping:", states what
     would have to change, ends with the ticket that owns the gap, and its
     disposition column still carries one of the four committed terms
```

- Every one of the eight rows committed by FAFF-592 is unchanged byte-for-byte, with the single exception of one cross-reference sentence appended to the subagent-dispatch row's evidence cell; that row's Seam, Today and Disposition cells and its pre-existing evidence text are unchanged.
- No new file is created in `design/`, and this change adds no seam classification anywhere outside `docs/reference/architecture/harness-coupling.md`.
- The added content keeps the committed doc's depth rule — the detail section is shorter than the seam table it annotates.

## 6. DESIGN DECISION RATIONALE

**Where does FAFF-482's output live?**
Options: the ticket's `design/harness-agnostic-runtime.md`; a new page under `docs/reference/architecture/`; an edit to the existing `docs/reference/architecture/harness-coupling.md`. The ticket's path predates FAFF-592, which redirected FAFF-477's equivalent provisional `design/` path into `docs/reference/architecture/` and never created a `design/` root. A third option would leave the repo with one documentation root for eight seams and another for five.
**Chosen:** edit `docs/reference/architecture/harness-coupling.md` — the ticket's path is stale, and the doc's own extension rule already anticipates added rows.

**One inventory or two?**
Options: a runtime-scoped companion page cross-linked to the coupling table; or new rows in the one table. The companion page is tidier to write and matches the original framing, but the committed doc's closing rule is that every seam FAFF-483 names traces to exactly one row of that table, and two tables make "exactly one row" unverifiable.
**Chosen:** one inventory, extended in place. Cross-document drift between two seam lists is the specific failure this avoids.

**Which sense of "fan-out"?**
Options: single-producer Agent-tool dispatch; concurrent multi-build execution; both. Single-producer dispatch is already a committed row and FAFF-593 landed its transport, so treating that as the answer would close the ticket over work already done. Concurrent execution — `concurrency_max` simultaneous worktree-isolated build subagents — has no row anywhere in the repo.
**Chosen:** concurrent build fan-out, as a new row distinct from the committed subagent-dispatch row, with the two cross-referenced in both directions per the decision below.

**How is the tracing rule made enforceable from both sides?**
The committed subagent-dispatch row is titled more broadly than its content: it says "subagent dispatch" and describes producer dispatch only. Once a separate concurrent-build-fan-out row exists, a FAFF-483 author starting from the committed row's title lands on a row that answers a narrower question than its title promises, with no pointer onward. Options: rely on a distinctive new-row title alone; carve a narrow exception to the byte-for-byte rule so the committed row can gain a pointer; retitle the committed row. Retitling breaks the citations other committed specs make by name. A distinctive new title stops the two rows being confused but does nothing for the reader who starts at the committed row and stops there — the stranding is the actual failure, and only a pointer closes it.
**Chosen:** both, with the exception drawn as narrowly as it can be. The new row is titled "Concurrent build fan-out", which cannot be read as the committed "Subagent dispatch"; and the sole permitted edit to committed content in this ticket is appending one cross-reference sentence to the end of the subagent-dispatch row's evidence cell. No committed Seam, Today, or Disposition cell changes, no existing evidence text is rewritten, and no other committed row is touched at all. The byte-for-byte rule holds everywhere else and is stated that way in DONE.

**What does the skill-routing seam actually classify, once producer dispatch is set aside?**
The first draft made this one row covering the whole Sibling-skill invocation convention, disposition `adapter`. That row was doing two jobs badly. Its producer-dispatch half is already a committed row — Subagent dispatch, `adapter`, evidence the engine fork — so the new row was restating a committed classification and borrowing its term, the same reader-stranding the narrow byte-for-byte exception above exists to fix for the fan-out row. Its chaining half is the part with no row anywhere, and it does not classify the same way. Options for that half: `adapter`, on the reading that prose is a documented mapping; or `drop`. `adapter` in the committed vocabulary is "stays, but behind a swappable seam — a config-selected backend or a documented mapping table", and nothing here stays: the Skill tool does not exist outside a harness that offers skill invocation, and no config key selects a replacement. `drop` is "the harness mechanic is removed; its job moves into skill-step prose or the CLI", which is the case sentence for sentence — the mechanic is gone and the running agent reads the sibling's `SKILL.md` and follows it inline. The committed WorktreeCreate row is the same shape already committed: a Claude-Code hook whose job graft's skill step does directly, classified `drop` with the hook demoted to optional enhancement.
**Chosen:** split the row and keep only the chaining half, titled "Skill-to-skill chaining handoff" so it cannot be read as the committed "Subagent dispatch", classified **drop** against the vocabulary sentence quoted above. The producer-dispatch half is cross-referenced to the committed row, never restated. This is why the added rows are four `adapter` and one `drop` rather than five `adapter`.

**Does headless `claude -p` earn its own row?**
Options: fold it into subagent dispatch as another spawned child; give it a row. It differs in kind — it is the session rather than a child within one, it drives the whole delivery loop, its process exit code is the contract `faff disposition` exists to fill, and its eval call site carries a credential invariant no producer dispatch has.
**Chosen:** its own row, covering both the unattended drain and the eval driver, carrying the credential invariant explicitly, with FAFF-479 and FAFF-480 named as the per-lane follow-ons.

**How is a hard blocker recorded when the vocabulary has no term for one?**
Options: add a fifth disposition term; record it in the evidence cell. A fifth term would mix two axes — what faff does about a seam versus whether an analogue was found — in a set whose whole value is being closed and unambiguous for FAFF-483's tracing rule. A convention with no owner named is also how a gap goes quiet.
**Chosen:** the four terms stay closed; a hard blocker is a `No mapping:` sentence in the evidence cell naming the change required and **ending with the ticket that owns it**, matching the `Follow-on: FAFF-605` convention the committed rows already use.

**Who owns the posture a Codex child with hands runs under — faff's interface, or the environment? And does credential scope go with it?**
An earlier version of this spec had the fan-out and headless-entry subsections state that faff's spawn method "must carry three things the current one does not: sandbox mode, network posture, and credential scope", with a follow-on ticket deciding the values. Options: faff's spawn interface carries all three parameters and a ticket picks the values; the environment supplies all three and faff's interface carries only an assertion that it did; or the two are split. The first reads naturally — the caller passes what the child needs — and it is wrong for sandbox and network: it makes faff a cage configurator, which is exactly the coupling ADR-0010 exists to prevent, and it bakes one particular sibling project's shape into faff's own interface. The repo answers that half in code and does not equivocate: `plugin/skills/faff/bin/lib/lights-out.js` states that the cage — `--dangerously-skip-permissions`, host isolation — is the container's job, and that the runner detects and refuses rather than self-granting or weakening the host. `container-check.js` is the same posture one rung down: it probes, warns, and never blocks by default. The second option then over-corrects, and the same repo says so just as plainly. `plugin/skills/faff/bin/lib/engine-codex.js` reads the value of the env var a backend declares in `api_key_env` and injects it into the child as `OPENAI_API_KEY` — faff's code, choosing a secret for a child. `eval/cli-driver.mjs`'s `forwardCredentials` copies the OAuth credential into a run's config directory for the frontier lane and deliberately withholds it from the local lane pointed at an ollama host — faff's code, choosing per lane. The environment provides that credentials exist; faff decides which ones cross into which child, and that decision *is* the "never forward a provider credential into a run whose endpoint belongs to a different provider" invariant this doc insists a Codex mapping must preserve. Filing it under the environment would tell FAFF-483 the invariant sits outside its interface while two files of faff's own code keep enforcing it.
**Chosen:** split them. The environment supplies the writable checkout, the persisted session, the sandbox mode and the network reach; faff's spawn method carries an assertion that the environment meets the floor for the autonomy level being run at, and refuses when it does not — so FAFF-483 defines a **check**, not a set of knobs, and FAFF-605 owns the per-level floor and its check while FAFF-662 owns operator guidance for building and verifying such an environment. **Credential scope stays faff's**, stated in each affected subsection as a separate sentence from the environment list and anchored to `engine-codex.js`'s `childEnv` injection and `cli-driver.mjs`'s per-lane forwarding, so FAFF-483's interface owns it. FAFF-605 gates nothing — at L1–L3 a human is in the loop and `container-check`'s warning is proportionate, at L4 the lights-out preflight already blocks — and the credential invariant is therefore not routed to its check; it is a property of the spawn path FAFF-483 defines. This decision changes no code: `buildCodexArgv`'s `--sandbox read-only` is least privilege on faff's own pure-data-in producer, framed that way by ADR-0090 ("The child gets no hands") and by FAFF-593's spec — a child that only returns text declining a capability it has no use for, not a blast-radius boundary. It stays, and the doc says nothing that implies otherwise.

**Does the session context file belong here, how does it classify after the refactor, and can the row carry its argument without a Codex-side claim?**
Options on scope: leave it out as scope creep; add it. It is a genuine runtime coupling with no row and it appears in the repo owner's own seam list on the ticket — include it. The term is the part that had to be re-derived. When this spec was first written the repo had `CLAUDE.md` carrying twenty lines of contributor guidance and `.agents/AGENTS.md` carrying three lines that pointed at `.agents/STYLE.md`, and the row was `adapter` because the two files diverged and keeping them in a known relationship was the maintained work. That arrangement no longer exists. The repo now has one 60-line root `AGENTS.md` carrying the contributor guidance *and* the writing-style rules, a 3-line root `CLAUDE.md` whose only content is a pointer at it, and an empty `.agents/` directory. So the term was re-derived from the committed four-term vocabulary rather than carried forward. The case for `portable` is real and worth stating: the content is single-sourced and nothing in it is Claude-specific, so on a swap no content moves. The case against is what the vocabulary actually says. `portable` is *"Works on any harness implementing the Agent Skills open standard, or is harness-independent already; no work needed."* Two clauses fail. `AGENTS.md` at the repo root is not part of the Agent Skills standard — that standard governs `SKILL.md`, which is a separate committed row — and the seam is not the content but **which file a harness auto-loads**, which is per-harness by construction. That last point is provable inside this repo without saying anything about any other tool: Claude Code does not auto-load `AGENTS.md`, and the 3-line `CLAUDE.md` exists for no other reason, so any harness that does not read the root convention natively needs its own pointer file written. That is work, so "no work needed" is false. `adapter` is *"Stays, but behind a swappable seam — a config-selected backend or a documented mapping table"*: the guidance stays put and a per-harness pointer file is the documented mapping, the same shape as the tracker-MCP row's per-harness `config.toml` registration, which this spec already classifies `adapter` on that reasoning. Classifying a pointer file `portable` and a registration file `adapter` would make the vocabulary mean two things. That leaves how the row phrases its forcing property. Options: rest it on "Codex reads `AGENTS.md` at the repo root", cited to `verification/reports/tracker-filing-plan.md`'s FAFF-482 entry, which records the mapping as "AGENTS.md ↔ CLAUDE.md" — the same source form the tracker-MCP row already uses; or rest it on the repo-observable fact above, which needs no Codex-side claim. The filed-plan line is real and citable, but it is a two-token shorthand carrying a lot of weight, and a row that depends on no Codex claim cannot be invalidated by a live binary behaving unexpectedly.
**Chosen:** include it, classified **adapter** against the `portable` sentence quoted above, with the forcing property stated in its repo-observable form — Claude Code does not auto-load `AGENTS.md`, which is the only reason the pointer file exists, so a harness that does not read the root convention natively needs one written. The row therefore asserts nothing about Codex and needs no locator. Any *other* added sentence that does name Codex's session-context behaviour is optional, and if written must carry `(per FAFF-477's planning package as filed in verification/reports/tracker-filing-plan.md)`, whose FAFF-482 entry records "AGENTS.md ↔ CLAUDE.md" — the permitted ticket-plus-repo-path form, identical to the tracker-MCP row's. The row's evidence names the pointer file as the work, points at FAFF-662 as the follow-on, and drops the old divergence framing entirely, which no longer describes the repo. The count is unchanged at four `adapter` and one `drop`; the reason behind one of the four is not. Reconciling the two files' contents is no longer out of scope for this ticket — it is done, and the row records the arrangement that resulted.

**The refactor broke the gateway's voice clause. Is fixing it this ticket's job?**
The gateway defines one line stamped into every producer dispatch that writes durable prose: *"House voice: read `.agents/STYLE.md` at the repo root (worktree included) … File absent → skip this instruction"* (`plugin/skills/faff/SKILL.md`, Voice clause). A grep for `agents/STYLE.md` across `plugin/skills/` returns exactly four files — the gateway, `faffter-dark-concurrency-parallel/SKILL.md` and `faffter-noon-concurrency-sequential/SKILL.md` (both quoting the clause verbatim into their build dispatches, and the sequential one is the default concurrency occupant, so it is the path most runs take), and `faffidavit-rendering/SKILL.md`, which references the gateway as canonical source. `.agents/STYLE.md` is gone and its rules now live in root `AGENTS.md`. Because the clause carries its own absent-file fallback, nothing errors and nothing parks — every producer dispatch and every build subagent now writes durable prose with no voice guidance, silently. That is a live defect and it is not small. It is also not a seam classification: fixing it means editing skill prose in four files plus the engine-lane fork that appends the style source's contents to the payload, and putting a prompt change inside a documentation-only pull request buries it where a reviewer of *this* ticket is not looking for it. Options: fix it here; leave it unmentioned; record it as an open item needing a human to choose an owner; or record it against an owner that now exists. Leaving it unmentioned is the one clearly wrong answer — a defect this spec's own author found and did not write down is a defect nobody finds. Fixing it here mixes a prompt change into a doc-only change. The only question that ever needed a human was who owns it, and that question has since been answered: FAFF-663 is filed for the stale voice-clause path, carrying the corrected four-file list.
**Chosen:** exclude the fix from this ticket and record it against FAFF-663, which owns the stale voice-clause path across all four files plus the engine-lane fork. No human decision is left open — the ticket exists, the affected files are enumerated in Out of scope, and this ticket touches no skill prose.

**Is the repo owner's tracker comment reconciled back into the doc, and what does it imply for the tracker row?**
The 2026-07-23 comment on FAFF-482 lists mappings richer than what FAFF-592 committed — MCP server registration via Codex's `config.toml`, the native OS sandbox mapping to faff's blast-radius posture, synchronous command hooks only. Options: leave the comment as the record; fold its unlanded items into the new rows. Leaving it means the fuller mapping stays in a ticket comment no reader of the architecture doc will find. The registration point also decides the tracker row's term: an initial reading called tracker MCP `portable` because faff's CLI never touches MCP, but the seam is not the CLI — it is whether the agent can reach a tracker at all, and that turns on a per-harness registration file. That is the vocabulary's `adapter` by its own wording, and the stakes are concrete: faff's documented behaviour when no tracker MCP is present is to fall back to git-only mode (`plugin/skills/faff/SKILL.md`, tracker-autodetect paragraph), so a missed registration degrades quietly instead of failing.
**Chosen:** fold the unlanded items into the rows where they belong — MCP registration into the tracker-MCP row's evidence, with the row classified `adapter` and the git-only fallback named as the failure mode of a missed registration; and the sandbox point as a cross-reference from the concurrent-fan-out row to the existing permission-and-appetite row, which already names FAFF-605. The sandbox item is folded in as an environment property under the decision above, not as a faff-side parameter. Every folded claim carries its source in a permitted form; nothing is copied in unattributed.

**Who performs the cold-read check?**
The ticket's completion condition is that a reader can scope FAFF-483 from the page alone. Options: keep it as a definition-of-done item the build agent certifies; drop it from DONE and hand it to FAFF-483's prep as an intake signal; give it to a clean-context reviewer. The first is self-grading — the agent that just wrote the page is the one reader in the world who cannot judge whether the page stands without the spec, and this spec's own failure-modes section says so. The second is honest but late: FAFF-483 discovering the gap is the failure, not the check. The repo already runs clean-context subagent review for exactly this class of judgement.
**Chosen:** a clean-context reviewer performs it — a subagent given only the path to `docs/reference/architecture/harness-coupling.md` and the three questions in the smoke procedure, having seen neither this spec nor FAFF-482's comments. Its verdict is the definition-of-done item. If no clean-context reviewer can be run in the build environment, the item is **not** self-certified: it is recorded on the ticket as unverified and handed to FAFF-483's prep as an intake signal, and the ticket says which of the two happened.

**Is a documentation-sourced mapping enough to close a spike?**
Options: require a live `codex exec` observation before the doc counts as answered; accept a sourced documentation mapping. No codex binary is installed on this machine. FAFF-593 shipped a whole transport on the same basis, recording the absence and naming the observable that would reveal drift, and FAFF-479 already carries live-binary verification as its own acceptance condition — the ticket where a live run happens anyway.
**Chosen:** a sourced documentation mapping closes FAFF-482, where "sourced" means one of the three permitted forms in the WHAT section rather than an unspecified gesture at upstream. Live verification stays FAFF-479's acceptance condition, and this doc says so in the rows that depend on it. At the time of writing, no `codex` binary is present in this environment; revisit if one becomes available before the build runs.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:**

None. The one question that was open — who owns the gateway's stale voice-clause path after the session-context refactor deleted `.agents/STYLE.md` — has an owner: FAFF-663, filed for that path with the corrected four-file list (`plugin/skills/faff/SKILL.md`, `faffter-dark-concurrency-parallel/SKILL.md`, `faffter-noon-concurrency-sequential/SKILL.md`, `faffidavit-rendering/SKILL.md`) plus the engine-lane fork. The exclusion and the affected files are recorded in Out of scope so FAFF-663 has a starting point; this ticket touches no skill prose.

The one other genuinely uncertain area — what a live Codex binary will actually do — is handled by the sourcing discipline and by FAFF-479's live-verification acceptance condition rather than by blocking this document.

**Assumptions:**

**Assumes:** the repo anchors named in the Reference context table exist as described — `docs/reference/architecture/harness-coupling.md` with its eight rows and four-term vocabulary, `plugin/skills/faff/bin/lib/engine-codex.js` with `buildCodexArgv`'s read-only spawn posture and the `childEnv` injection of the declared `api_key_env` value as `OPENAI_API_KEY`, `records/adr/0090-…`'s "the child gets no hands" framing, `plugin/skills/faff/bin/lib/lights-out.js`'s refuse-never-self-grant posture and `container-check.js`'s warn-by-default containment probe, `plugin/skills/faff/bin/lib/engine.js` with a `methodology`/`intake` lane allowlist, `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` with the `concurrency_max` cap, rebase-before-merge and the `{ issue, outcome, pr }` token, the gateway's Sibling-skill-invocation section and its tracker-autodetect git-only fallback, `docs/guide/unattended.md`'s `claude -p` headless snippet, `eval/cli-driver.mjs`'s `buildInvocation` and its `forwardCredentials` per-lane rule (frontier forwards, local does not), and the post-refactor session-context arrangement: a 60-line root `AGENTS.md` carrying contributor guidance plus the writing-style rules, a 3-line root `CLAUDE.md` whose only content is a pointer at it, and an empty `.agents/` directory. Validation: before writing each row, open the named path and read the mechanic — do not classify from this table alone; classifying from an assumed file content is precisely what produced two wrong dispositions in the first draft and one stale session-context row after it. Two specific checks for the session-context row, because its files moved most recently: confirm root `AGENTS.md` exists and read its line count, and confirm `.agents/` holds neither `AGENTS.md` nor `STYLE.md`. Two more for the credential claims, because a row states them as faff's own decision: open `engine-codex.js` and confirm the `childEnv` line injects the declared env var's value, and open `cli-driver.mjs` and confirm `forwardCredentials` is gated on a per-lane flag. Note that at the time of writing, root `AGENTS.md` is untracked and the `.agents/` deletions are unstaged, so a build agent starting from a fresh clone or a worktree cut before the refactor commit will see the *old* arrangement; if the working tree does not match the description above, re-derive the row's disposition against the four-term vocabulary from what is actually there and record which arrangement it saw. If any other anchor has moved, update the row's anchor to its current location and continue; do not park on a moved anchor.

**Assumes:** the Codex-side facts the mapping rests on are as recorded in the sources cited — codex-rs `exec/src/exec_events.rs` and `exec/src/cli.rs` as pinned in FAFF-593's spec, the Agent Skills open standard for `SKILL.md` portability, and Codex's `config.toml` for MCP server registration as filed in `verification/reports/tracker-filing-plan.md`. The session-context row rests on none of these: its forcing property is repo-observable and asserts nothing about Codex, by the decision above. Validation: no `codex` binary is available in this environment, so this cannot be validated by execution. The build agent validates by citing the source in one of the three permitted forms rather than asserting the behaviour, and treats any claim it cannot source that way as a `No mapping:` entry with an owning ticket rather than an assumption. Where a row can be argued from repo-observable facts instead, prefer that and drop the Codex claim entirely. Do not park on the absent binary — the sourcing discipline is the mitigation, and FAFF-479 owns the live check.

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/reference/architecture/harness-coupling.md` contains a row for each of the five previously unclassified runtime seams: concurrent build fan-out, headless session entry, tracker MCP access, skill-to-skill chaining handoff, session context file.
- [ ] Each of the five seams named in FAFF-482's original scope resolves to either a new row or a named existing row, and the ticket records which: subagent fan-out → the new concurrent-build-fan-out row plus the committed subagent-dispatch row for the producer case; Stop and pre-tool hooks → the committed Stop-hooks and PreToolUse-fences rows, no new row; skill and command routing → the new skill-to-skill-chaining-handoff row for the control transfer, plus the committed subagent-dispatch row for producer dispatch and the committed skills-and-frontmatter row for the `SKILL.md` artifact; MCP tracker access → the new tracker-MCP-access row; headless `claude -p` → the new headless-session-entry row.
- [ ] The doc records that the two seams needing a Codex child with hands — concurrent build fan-out and headless session entry — converge on the same requirement, states that the environment provides the writable checkout, persisted session, write-permitting sandbox and network reach while faff checks them, names FAFF-605 as owner of the per-level floor and its check, and states that this gates nothing: a human is in the loop at L1–L3 where `container-check` warns without blocking, and the lights-out preflight already refuses at L4.
- [ ] No row for the Stop-hooks or PreToolUse-fence seams is added, and neither committed row is edited.

### From WHAT (classification content)
- [ ] The five added rows carry the dispositions this spec assigns — `adapter` for concurrent build fan-out, headless session entry, tracker MCP access and the session context file; `drop` for skill-to-skill chaining handoff — or the pull request records, per row that departs, the sentence of the committed four-term vocabulary that forces a different term.
- [ ] The doc states the split as a finding: no runtime seam is free, four need a mapped equivalent, and the chaining handoff loses its harness mechanic to skill prose.
- [ ] Each added row's evidence cell names the specific property that forces its disposition, not only the artifact it points at.
- [ ] The session-context-file row describes the post-refactor arrangement — root `AGENTS.md` as the single source, root `CLAUDE.md` as a pointer file for a harness that does not auto-load `AGENTS.md` — and names *which file a harness auto-loads* as the per-harness property that forces `adapter`. It states that property in its repo-observable form (Claude Code does not auto-load `AGENTS.md`, which is the only reason the pointer file exists) and therefore asserts nothing about Codex. It makes no claim that the two files carry diverging content, and it names FAFF-662 as the follow-on.
- [ ] The tracker-MCP-access row names per-harness MCP registration (Codex's `config.toml`) as the mapping, and names faff's git-only fallback as what a missed registration degrades into.

### From WHAT (shape)
- [ ] Every added row's disposition column contains exactly one of `portable`, `adapter`, `down-stack`, `drop`; no fifth term exists anywhere in the file.
- [ ] Every added row's evidence cell names at least one path, command, ADR, or config key that exists in the repo.
- [ ] Every sentence in the added content asserting Codex behaviour ends its clause with a repo path, a named upstream file or URL, or a ticket id; no bare product-name attribution appears. Any sentence naming Codex's session-context behaviour carries `(per FAFF-477's planning package as filed in verification/reports/tracker-filing-plan.md)` or is not written at all.
- [ ] The eight rows committed by FAFF-592 are unchanged byte-for-byte, except for one cross-reference sentence appended to the end of the subagent-dispatch row's evidence cell; that row's Seam, Today and Disposition cells and its pre-existing evidence text are unchanged, and no other committed row differs at all.
- [ ] A detail section follows the seam table with exactly three subsections: concurrent build fan-out, headless session entry, skill-to-skill chaining handoff. Tracker MCP access and the session context file have rows only.

### From HOW (behaviour)
- [ ] `design/harness-agnostic-runtime.md` is not created, and no `design/` directory exists in the repo after this change.
- [ ] This change creates no second harness-seam inventory: every row and detail subsection it adds lands in `docs/reference/architecture/harness-coupling.md`, and it creates no other page that classifies harness seams. (Pre-existing pages that mention the disposition terms in passing — `verification/reports/tracker-filing-plan.md` quotes them in a filed ticket body — are untouched and are not a second inventory.)
- [ ] The concurrent-build-fan-out row cross-references the committed subagent-dispatch row by name, and the committed row carries the reciprocal pointer added in step 4.
- [ ] The headless-session-entry row names both `docs/guide/unattended.md` and `eval/cli-driver.mjs` as call sites, and names FAFF-479 and FAFF-480 as the per-lane follow-ons.
- [ ] The headless-session-entry row and its subsection state the eval driver's credential invariant as two properties that must remain true — per-repetition config isolation, and no provider credential forwarded into a run whose endpoint belongs to a different provider — rather than only describing the isolated config directory.
- [ ] The concurrent-build-fan-out and headless-session-entry subsections each state that the writable checkout, persisted session, write-permitting sandbox and network reach a build child needs are properties of the environment it runs in; that faff's spawn method carries an assertion the environment meets the floor for the level being run at plus a refusal when it does not; and that FAFF-483 defines that check rather than a set of knobs. FAFF-605 is named as owner of the per-level floor and its check, FAFF-662 as the operator guidance for building and verifying such an environment.
- [ ] The same two subsections state, in a sentence separate from the environment list, that credential scope is faff's own decision — anchored to `engine-codex.js`'s `childEnv` injection of the declared `api_key_env` value as `OPENAI_API_KEY` and `cli-driver.mjs`'s per-lane forwarding — and name it as something FAFF-483's interface owns. Credentials appear nowhere in the added content's list of what the environment supplies, and the "never forward a provider credential into a foreign endpoint" invariant is not routed to FAFF-605's check.
- [ ] No sentence in the added content describes faff as configuring a child's sandbox mode or network posture, and no sentence describes `buildCodexArgv`'s `--sandbox read-only` as a blast-radius boundary or as something a follow-on ticket loosens.
- [ ] The concurrent-build-fan-out detail subsection names which parts of the parallel executor's contract survive a harness swap unchanged — per-issue worktree isolation, the `concurrency_max` cap, rebase-before-merge, and the `{ issue, outcome, pr }` return token.
- [ ] The skill-to-skill-chaining-handoff row and its detail subsection cover the chaining half only, cite the committed subagent-dispatch row for producer dispatch and the committed skills-and-frontmatter row for the `SKILL.md` artifact rather than restating either, and name the prose form of a chain gate as what FAFF-483 scopes from.
- [ ] No skill prose is edited by this ticket; the stale `.agents/STYLE.md` voice-clause path is left to FAFF-663, and the pull request says so rather than fixing it in passing.
- [ ] The file's closing "How to extend" section is last in the file and unedited.

### From HOW (edge cases)
- [ ] Any seam for which no Codex analogue was found carries an evidence cell opening with `No mapping:`, stating the required change and ending with the ticket that owns the gap, while still carrying one of the four disposition terms.
- [ ] Any anchor found to have moved during the write is updated to its current location, and the row still names a path that exists.
- [ ] If the working tree does not show the post-refactor session-context arrangement (root `AGENTS.md` as single source, `.agents/` empty), the session-context row's disposition is re-derived against the four-term vocabulary from what the tree actually contains, and the pull request records which arrangement was seen.

### From the ticket's completion condition
- [ ] A clean-context reviewer — given only the path to `docs/reference/architecture/harness-coupling.md` and the three questions in the smoke procedure, having seen neither this spec nor FAFF-482's comments — reports that the page answers all three for the concurrent-build-fan-out seam. If no clean-context reviewer can be run, this item is recorded on the ticket as unverified and handed to FAFF-483's prep as an intake signal; it is never certified by the agent that wrote the page.

### Integration smoke test

The single end-to-end path — a cold reader can trace one runtime seam from the inventory to its scoping consequence. Run by a reviewer with no prior context, never by the author.

```
PROCEDURE cold_read_smoke:
  PRECONDITION: the reader has seen neither this spec nor FAFF-482's comments,
  and is given only the file path.
  1. Open docs/reference/architecture/harness-coupling.md.
  2. Find the concurrent-build-fan-out row in the seam table.
  3. Read its disposition and follow its evidence cell to the named files.
  4. Read its detail subsection.
  5. ASSERT the reader can state, without leaving the page:
     a. what runs the parallel builds under Claude Code today,
     b. what would run them under Codex,
     c. the one capability faff's children do not have yet, who supplies it,
        what faff does about it, which ticket owns the check, and — separately —
        who decides which credentials that child receives.
  6. REPORT a/b/c verbatim back to the build agent.
  If any of a/b/c cannot be answered from the page alone, the doc has not met
  the ticket's completion condition and the subsection needs the missing sentence.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"}]}
```
