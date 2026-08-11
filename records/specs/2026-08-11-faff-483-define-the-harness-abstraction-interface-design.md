**Spec attached 2026-07-28.** Three review passes: the first returned `reject-approach` (six objections across architectural / infosec / QA), the second `revise` (one surviving infosec objection), the third `approve` with zero objections.

Two catches worth recording. The first draft asserted no golden or snapshot test harness exists in the repo — false; `test/contract-golden.test.mjs` with `test/golden/contracts/cases.json` is exactly that (FAFF-96, ADR-0002), and it is a merge gate via `node --test`. Two acceptance criteria rested on that false claim and were unfalsifiable as written; they now pin literal pre-move values captured before the change. The second: the reverse credential sweep both over-matched and under-matched — it would have flagged `integrity-digest.js`'s `sha256` (a hasher spawn carrying a constant `{PATH: "/usr/bin:/bin"}` env, forwarding nothing) while missing `engine-codex.js`'s `runCodexCall`, which spawns the codex child through an *injected default parameter* and is invisible to a name-matching sweep. It flagged a spawn forwarding nothing while missing the one forwarding a seat credential. The sweep is now defined by binding resolution rather than call-site spelling.

Retained at `confidence: medium` — it carries one substantive open decision (whether the tracker-access seam stays prose-bound or earns a faff-owned module). That does not block the build; it blocks FAFF-479 knowing its obligations.

**Refreshed 2026-08-05 (autonomous).** FAFF-482 — the blocker this spec scoped from — **landed on 2026-07-29 (PR #502)**: `docs/architecture/harness-coupling.md` is now 74 lines with all five seam rows present, worded and dispositioned as the assumption pinned, so the spec's central assumption is now discharged (was a park-risk when authored). The 2026-08-02 FAFF-695 comment (tracker-connector resolution; `faff tracker probe` now ships) is folded in as context — it reinforces the narrow-register decision and informs the `tracker-access` open question, changing no decision. Approach, register, lint and credential sweep unchanged; retained at `confidence: medium` on the same unchanged tracker-access architecture punt. Full change record in the **Refresh log** section below. Re-review verdict re-earned this refresh (see the retained `spec-review:` line at the spec foot).

---

# FAFF-483 — Define the harness-abstraction interface

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: medium. Full spec on Linear FAFF-483.

This spec defines the harness-abstraction interface: the named artifact that says, for every seam where faff touches its harness, what a driver has to supply and where the Claude Code driver supplies it today. It is written for the build agent that will land it and for the human reviewers who have to agree the shape is right before a Codex driver gets built against it (FAFF-479). It scopes from FAFF-482's per-seam disposition inventory, which **landed on 2026-07-29** (PR #502): `docs/architecture/harness-coupling.md` is now 74 lines with a `## The seams` section carrying all five rows this register anchors on, worded and dispositioned exactly as the ordering assumption pinned. The assumption that was a park-risk when this spec was first written is therefore now discharged (see section 7); the refresh that folded the landed blocker in is logged under **Refresh log** immediately below.

## Refresh log (2026-08-05, autonomous)

This is an in-place autonomous refresh of the 2026-07-28 spec. The approach, the seven-seam register, the lint, the credential sweep and the harness-identity move are all **unchanged** — only the framing that assumed FAFF-482 had not yet landed is updated, plus two annotations folded in. No architectural decision changed.

**What drove the refresh.**

- **FAFF-482 landed (2026-07-29, PR #502) — the blocker shipped.** When this spec was authored, `docs/architecture/harness-coupling.md` was still its original 33 lines and the spec scoped from FAFF-482's *spec* rather than a delivered inventory. FAFF-482 is now Done and the doc is 74 lines. The five rows it added — concurrent build fan-out (`adapter`), headless session entry (`adapter`), tracker MCP access (`adapter`), skill-to-skill chaining handoff (`drop`), session context file (`adapter`) — all landed with the labels and dispositions the ordering assumption pinned, so all seven of this register's `doc_row` anchors resolve within the `## The seams` slice. The Assumes in section 7 is confirmed rather than pending.
- **FAFF-695 design-input comment (2026-08-02) — folded as context, not a challenge.** FAFF-695 (merged, #516) shipped `faff tracker probe` (a pure `pinned | unpinned` classifier reading the `.faffrc tracking.tracker` pin) plus the gateway's "Tracker availability resolution" prose contract. The comment argues for a named "resolve tracker connector" seam whose *pure* half (`tracker probe`) is already carved out, and reads that as a point in favour of narrow seam interfaces. This **reinforces** the register's existing `Chosen` (one flat register of narrow, uniformly-shaped seam records) rather than contradicting it, so it does not re-open a decision. It is relevant to the `tracker-access` seam's open question (whether the seam stays `unbound` or earns a faff-owned binding): `faff tracker probe` is the pure sub-component of a possible future tracker-resolution binding, but it does **not** serve MCP-connector access, so the `tracker-access` seam's binding kind stays `unbound` and the bind/don't-bind call remains FAFF-479's (carried by `open_question`). No register change; the context is recorded here and on the seam's open question for FAFF-479 to weigh.

**Freshness against the codebase.** Every symbol the register binds on still exists by name: `backends.js` `CURRENT_HARNESS` / `portableMatrixAdmits` / `checkRealizable` and the `--harness` flag; `engine.js` `runEngineCall` / `cmdEngine`; `engine-codex.js` `runCodexCall` with its `spawnFn = spawnSync` parameter default; `regions.js` `REGION_MAP`; `lint-cli-doc.js` `parseDocumentedCommands` / `cmdLintCliDoc`; `integrity-digest.js` `sha256` under `SANITIZED_ENV`; the contract-golden harness; `test/backends.test.mjs:15`'s named ESM import of `CURRENT_HARNESS`; and the `eval/` sites `forwardCredentials` / `makeCliDriver` / `makeLiveModel`. The line numbers in the Reference-context table have drifted since 2026-07-28 (`CURRENT_HARNESS` is now defined ~line 270, `runCodexCall` ~line 153) — the register binds on module + export names, not line numbers, so this is cosmetic; the build agent should treat the cited lines as approximate and confirm by symbol.

## Already shipped against this surface

- **FAFF-482 (Done, 2026-07-29, PR #502)** — landed `docs/architecture/harness-coupling.md`'s `## The seams` table (the disposition inventory this register traces every seam to). Related-but-not-superseding: it delivers the *doc* the register anchors on, not the register or its lint. Its landing is what discharges this spec's central assumption.
- **FAFF-695 (merged, #516)** — landed `faff tracker probe` and the gateway "Tracker availability resolution" rule. Related-but-not-superseding: a pure pin-classifier sub-component of the `tracker-access` seam, not the seam's MCP-access binding. Informs the seam's open question (see Refresh log).

No Done ticket delivers the seam register, the `faff harness` CLI, or the harness-golden test — `plugin/skills/faff/bin/lib/harness.js`, `faff harness`, and `test/golden/harness/` do not exist on disk. The premise is intact; this remains a build.

## 1. WHY — problem and principles

**The load-bearing idea: most of faff's harness seams are prose, not code, so the abstraction cannot be a single function signature.** Of the seven seams this interface has to cover, two have a call site inside faff's own code that a driver could be swapped behind. The rest are instructions an agent reads and applies — the gateway's Skill-tool chaining rule, the `SKILL.md` artifact the harness's own skill loader reads, an MCP config file this repo does not even contain. You cannot redirect a caller that is a paragraph. So the interface faff actually needs is a **register**: a declared list of seams, each carrying its binding kind, the doc row that classifies it, and the concrete artifact the Claude Code driver uses. For the code-bound seams that artifact is a module and an exported symbol; for the prose-bound seams it is a file and a section. One register covers both kinds, and a lint proves every declared binding resolves.

**Problem statement.** faff's harness couplings are inventoried as prose in `docs/architecture/harness-coupling.md`, and nothing in the codebase asserts that inventory still matches reality — the one place harness is modelled as a value at all is `plugin/skills/faff/bin/lib/backends.js`, and it models exactly one axis of it. That means a second driver has no checklist of what it must supply, and a refactor can quietly remove the artifact a disposition row points at without anything failing. This ticket lands the register plus a lint that fails loud when a declared binding stops resolving.

### Design principles

**A declared binding that nothing checks is documentation, not an interface.** The whole value of naming these seams in code is that the naming can be falsified. Every register entry must carry at least one check that can fail on its own — an exported symbol that must be present, a file and section header that must exist, or, at minimum, a disposition row that must be found. An entry whose only check duplicates a check the same entry already triggers is not falsifiable twice; it is falsifiable once, and the register must say so plainly rather than dressing one check as two.

**The lint proves seven declared bindings resolve — nothing wider.** It is not a general prose-reference checker. A cross-reference in skill prose that this register does not declare goes on drifting unnoticed: FAFF-663 is a live instance of exactly that drift class, and this lint would still miss it, because that clause is not one of the seven. The register's claim is bounded to what it declares, and the CLI output, the docs and the pull-request description all state it that way.

**No pseudo-code interface for a documented convention.** Where a seam is prose, the register says so and points at the prose. It does not grow a function that no driver implements and no caller invokes. A method with no implementation on any driver is worse than an honest prose pointer, because it reads as a contract while enforcing nothing.

**Compose with the harness value that already exists; do not invent a second vocabulary.** `backends.js` already carries `CURRENT_HARNESS` (defined line 252, exported line 670), `portableMatrixAdmits(harness, provider, auth)` (line 260), and `checkRealizable(cfg, consumer, harness)` (line 282) — and `faff backends realizable` already accepts a `--harness NAME` flag (line 401), so harness is already an externally-supplied parameter, not just an internal constant. The new module takes ownership of that identity; `backends.js` reads it from there. *(Line numbers as of 2026-07-28; drifted since — see the Refresh log. Bind by symbol, not line.)*

**faff states the environment floor and checks it; faff does not own the sandbox.** Per ADR-0010 and the refuse-never-self-grant posture in `lights-out.js`, sandbox mode and network reach belong to the environment. This interface therefore declares which environment signal a seam requires and which shipped contract asserts it. It adds no knob and no new refusal.

### Reference context

*(Line numbers below are as of the 2026-07-28 authoring and have drifted; the register binds on module + export names. Confirm by symbol. — Refresh 2026-08-05.)*

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/backends.js` | Node (CommonJS) | Already models harness as a value: `CURRENT_HARNESS` (defined 252, exported 670), `portableMatrixAdmits` (260), `checkRealizable` (282), the `--harness` flag (401). Harness identity moves out of here. |
| `plugin/skills/faff/bin/lib/lint-cli-doc.js` | Node (CommonJS) | The pattern this register's lint copies twice over: a canonical in-code set compared against a markdown table parsed out of a doc (`parseDocumentedCommands`, line 20), reported bidirectionally; and the in-process `COMMANDS` read, wired as `cmdLintCliDoc(args, COMMANDS)` at `plugin/skills/faff/bin/faff:171`. |
| `test/contract-golden.test.mjs` + `test/golden/contracts/cases.json` | Node (ES module) + JSON | The repo's existing golden harness (FAFF-96, ADR-0002): spawns the `faff` bin, pins exact exit code and deep-equal parsed stdout, cases committed so a deliberate output change lands in the diff. This ticket's byte-for-byte criterion uses a sibling of it. |
| `test/backends.test.mjs` | Node (ES module) | Line 15 imports `CURRENT_HARNESS` as a **named ESM import from a CommonJS module** — the one consumer the harness-identity move can break at load time. |
| `plugin/skills/faff/bin/lib/regions.js` | Node (CommonJS) | The precedent for an in-code map asserted against the dispatch registry, with no suppression mechanism, wired as `cmdRegions(args, COMMANDS)`. New modules must be added to its `REGION_MAP` and its per-module selftest probe list. |
| `plugin/skills/faff/bin/lib/engine-codex.js` | Node (CommonJS) | The headless-session-entry seam's code binding: `runCodexCall` (line 125) and the `childEnv` credential assembly (line 165) spawned with `env: childEnv` (line 184). |
| `plugin/skills/faff/bin/lib/engine.js` | Node (CommonJS) | The subagent-dispatch seam's code binding: `runEngineCall` (line 153) and the `faff engine call` verb. |
| `eval/cli-driver.mjs`, `eval/live-driver.mjs` | Node (ES modules) | Further credential-forwarding call sites: the `forwardCredentials` helper (`cli-driver.mjs:46`), and spawns carrying an `env` option inside `makeCliDriver` (`cli-driver.mjs:911`) and `makeLiveModel` (`live-driver.mjs:190`). Separate module tree — swept and registered, not rewired here. |
| `docs/architecture/harness-coupling.md` | Markdown | The disposition inventory every register seam must trace to. **74 lines on disk (FAFF-482 landed 2026-07-29, PR #502)**, carrying **two** bold-first-cell tables: the four-term disposition vocabulary, and the seam table — which now holds the five rows FAFF-482 added (concurrent build fan-out, headless session entry, tracker MCP access, skill-to-skill chaining handoff, session context file) alongside the earlier rows. All seven of this register's `doc_row` anchors resolve within the `## The seams` slice. |
| `.github/workflows/validate.yml` | YAML | Runs `node --test` over `test/` (line 254), which is what makes both the golden harness and `test/backends.test.mjs` a merge gate rather than a local convenience. |

**Scope statement.** This sits between FAFF-482's disposition inventory (which classifies the seams) and FAFF-479 (which builds a second driver against them): the register is the machine-readable middle layer that turns a doc table into something a build can fail on.

## 2. OUT OF SCOPE

- **A Codex driver, or any second driver.** Why excluded: the ticket says so explicitly, and a second driver is where the real cost sits. Extension point: FAFF-479 adds `"codex"` entries to each register seam's `driver` map.
- **Callable driver functions for the code-bound seams.** Why excluded: with exactly one driver, a dispatch function that always takes the same branch is dead code wearing an abstraction. The register names the existing call sites instead. Extension point: when FAFF-479 adds a second driver entry, the register's `driver` map becomes the dispatch table and the resolver function lands with it.
- **Rewiring the `eval/` credential-forwarding call sites.** Why excluded: `eval/` is a separate ES-module tree with no import path into the CommonJS CLI, so reaching it means a build-system change, not an interface change. They are swept and registered by this ticket, which is what makes a *new* one detectable. Extension point: `eval/cli-driver.mjs`, once the credential-scope seam has more than one driver to serve.
- **Any new refusal on the environment floor.** Why excluded: the refusal already exists in `lights-out.js` and `container-check.js`; adding a second one is duplicated policy with two places to drift. Extension point: the `floor` field on the headless-session-entry register entry, which FAFF-479 reads when it declares Codex's floor.
- **The permission and appetite mapping table.** Why excluded: it already has its own follow-on ticket, FAFF-605, and its own disposition row. Extension point: FAFF-605.
- **Renaming or restructuring `docs/architecture/harness-coupling.md`.** Why excluded: FAFF-482 owns that file and lands first; two tickets editing the same table is a merge conflict for no gain. Extension point: FAFF-482.
- **Widening `test/golden/contracts/cases.json`.** Why excluded: those goldens are scoped by FAFF-96 and ADR-0002 to the `faff contract` scripts, and editing another ticket's committed goldens to carry this ticket's cases muddles both diffs. This ticket adds a sibling golden file instead. Extension point: `test/golden/harness/cases.json`.

## 3. WHAT — vocabulary, types, and the register

### Vocabulary

| Term | Definition |
|---|---|
| Seam | One place where faff's behaviour depends on which harness it is running under. Each seam has exactly one row in the disposition inventory. |
| Binding kind | Where a seam's harness-specific behaviour lives: in faff's own code (`code`), in prose an agent reads and applies (`prose`), or nowhere faff owns at all (`unbound`). |
| Driver binding | For one harness, the concrete artifact that serves a seam: a module plus exported symbols for a code seam, a file plus a section header for a prose seam. An `unbound` seam has none, by definition. |
| Register | The in-code declaration of every seam, its binding kind, its doc row, and its per-harness driver bindings. The interface this ticket delivers. |
| Floor | The environment precondition a seam requires (for example, a confirmed container), named alongside the already-shipped contract that asserts it. faff checks the floor; faff never provides it. |
| Credential scope | The set of call sites where faff hands an environment to a child process that could carry a harness credential. Declared forward and swept in reverse, so a new one shows up. |
| Spawn-family call | A call whose callee resolves, within its own module, to one of Node's child-process entry points — named directly, aliased to a local binding, or supplied as a function parameter whose default is one of them. Resolution is by binding, not by the name at the call site. |
| Forwarding env | A spawn-family call's `env` option value that the sweep cannot prove is a fixed literal. Anything derived from `process.env`, from a parameter, or from another module's value is forwarding; only a provably constant object is not. |

### Types

```
ENUM HarnessId: "claude-code" | "codex"                # closed; unknown value = hard error

ENUM BindingKind: "code" | "prose" | "unbound"         # closed; describes TODAY, not the target state

RECORD CodeBinding:
  module: String            # bin/lib module name, no extension, e.g. "engine-codex"
  exports: List<String>     # non-empty; each must be present on the module's exports

RECORD ProseBinding:
  file: String              # repo-relative path, must exist
  section: String           # a heading or anchor phrase that must appear verbatim in the file

RECORD Floor:
  requires: String          # the environment signal, e.g. "container-confirmed"
  asserted_by: String       # the shipped CLI contract that answers it, e.g. "container-check"

RECORD Seam:
  id: SeamId                # closed enum, see below
  binding: BindingKind
  doc_row: String           # the row's bold label in the seam table of the disposition inventory
  driver: Map<HarnessId, CodeBinding | ProseBinding>   # empty when binding = "unbound"
  floor: Floor?             # present only where the seam asserts an environment precondition
  credential_scope: List<String>?   # "<file>:<outermost enclosing function>" sites, where applicable
  open_question: String?    # the ticket that owns an unresolved design call on this seam

  CONSTRAINT binding = "code"    => every driver value is a CodeBinding, and driver contains "claude-code"
  CONSTRAINT binding = "prose"   => every driver value is a ProseBinding, and driver contains "claude-code"
  CONSTRAINT binding = "unbound" => driver is empty, and open_question is present
```

### The seam register

Seven seams: FAFF-482's five, plus the two committed seams it cross-references. Each traces to one row of the disposition inventory's seam table.

| Seam id | Binding today | Disposition row it traces to | Claude Code driver binding |
|---|---|---|---|
| `subagent-dispatch` | code | Subagent dispatch (on disk today) | `engine.js` — `runEngineCall`, `cmdEngine`; the Agent-tool default path is the gateway's prose fast path, the `engine:<name>` fork is the portable transport |
| `skill-artifact` | prose | Skills + frontmatter (on disk today) | `plugin/skills/*/SKILL.md`, read by the harness's own skill loader |
| `headless-session-entry` | code | Headless session entry (added by FAFF-482) | `engine-codex.js` — `runCodexCall`; carries the floor and the credential scope |
| `concurrent-build-fanout` | prose | Concurrent build fan-out (added by FAFF-482) | `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` — "Concurrency cap" |
| `tracker-access` | unbound | Tracker MCP access (added by FAFF-482) | none — faff owns no artifact for this seam |
| `skill-chaining-handoff` | prose | Skill-to-skill chaining handoff (added by FAFF-482) | `plugin/skills/faff/SKILL.md` — "Chaining pattern" |
| `session-context-file` | prose | Session context file (added by FAFF-482) | `AGENTS.md` at the repo root |

All seven `doc_row` anchors resolve against the landed inventory (FAFF-482, 2026-07-29): the two committed rows plus the five FAFF-482 added. The ordering constraint is now discharged rather than pending — `faff harness check` still enforces it structurally, so a later re-wording of any row surfaces as `no-doc-row` (see the confirmed assumption in section 7).

`tracker-access` is the one seam with no faff-owned artifact of any kind — this repo contains no `.mcp.json` and no tracker module under `bin/lib`, and the per-harness config that grants access lives outside the repo entirely. So it carries binding kind `unbound`, an empty `driver` map, and `open_question: "FAFF-479"`. Its only check is the doc-row check every seam gets. That is deliberately one check named as one: an earlier shape gave it a prose binding anchored on its own disposition row, which asserted the same row the doc-row check already asserts and could only fail once that check had already failed. Section 6 records why the entry stays rather than being dropped.

The environment floor and the credential scope are **fields on `headless-session-entry`, not seams of their own** — both are properties of the spawn method, per FAFF-482's settled dispositions, and neither has a disposition row it could trace to if promoted to a seam. On `headless-session-entry`: `floor = { requires: "container-confirmed", asserted_by: "container-check" }`, and `credential_scope` lists every call site the reverse sweep finds on the tree at build time.

Sites are labelled `<file>:<enclosing function>`, where the enclosing function is the **outermost named function containing the call**, so a spawn inside a returned closure resolves to the exported factory rather than to the closure's own name. The forward check and the reverse sweep then name the same thing, and `credential_scope` is declared from the sweep's output rather than from memory.

Two rules decide what the sweep matches, and both were settled by running them over the tree rather than by reading call sites (section 6 records why):

- **Spawn-family is resolved by binding, not by spelling.** A callee counts if it resolves within its module to `spawn`, `spawnSync`, `exec`, `execSync`, `execFile` or `execFileSync` — including a local alias and a function parameter whose default is one of them. Without this, `runCodexCall` is invisible: it spawns through `spawnFn`, a parameter defaulting to `spawnSync`, and that injection is the house pattern for keeping selftests spawn-free, so any new harness-child spawn would plausibly copy it.
- **A provably constant `env` is not forwarding.** A spawn whose `env` value resolves to a fixed object literal of string literals, with no reference to `process.env`, to a parameter, or to an imported value, forwards no credential and is not a site. This is the whole exclusion: it is proof-shaped, not a mute list, and anything the sweep cannot prove constant stays swept.

Run against the tree as it stands, those two rules yield **four `credential_scope` entries — three the sweep produces, one declared alongside them**:

| Entry | Why it is in scope |
|---|---|
| `plugin/skills/faff/bin/lib/engine-codex.js:runCodexCall` | Two `spawnFn` calls (the seat probe and the exec spawn), both forwarding — one the whole environment, one `childEnv` with the injected key. Reached only through the parameter-default rule. |
| `eval/cli-driver.mjs:makeCliDriver` | Spawns `claude -p` with the invocation env built from `{ ...process.env, … }`. |
| `eval/live-driver.mjs:makeLiveModel` | The same invocation env, same spawn shape, separate driver. |
| `eval/cli-driver.mjs:forwardCredentials` | Declared, not swept: it copies the OAuth credential file onto disk for those spawns to pick up. The sweep cannot see it, which is exactly the bound the field states — so it is registered by hand as a worked example of that bound rather than left out. |

One site that carries an `env` option is deliberately **not** in scope: `integrity-digest.js:sha256` spawns the SHA-256 hasher under `SANITIZED_ENV`, a module-level constant of `{ PATH: … }`. It forwards nothing, it is stripped on purpose, and registering it would make `credential_scope` mean "spawns with an env key" instead of "places a harness credential can leave". The constant-env rule excludes it without anyone having to decide.

The build agent registers what the sweep reports rather than transcribing this table. It is stated here because two earlier drafts of this list were wrong — one declared two sites, one would have failed its own lint on the hasher — so a reviewer should treat a different count as a signal to check the rules, not to edit the table.

### CLI surface

```
faff harness seams [--json] [--root DIR]     # print the register, including the bounded-claim note
faff harness check [--json] [--root DIR]     # assert every declared binding resolves
faff harness --selftest
```

Exit codes: `0` clean, `1` one or more bindings failed to resolve, `2` usage fault. `faff harness check` is the falsifiable half of the interface. Both verbs are dispatched as `cmdHarness(args, COMMANDS)`, matching `lint-cli-doc` and `regions`, so the floor check can read the command registry in process.

## 4. HOW — behaviour

### Architecture

One new dependency-free CommonJS module, `plugin/skills/faff/bin/lib/harness.js`, in the `factory` region. It exports the closed enums, the register, the lint, a `cmdHarness(args, COMMANDS)` argument handler, and a `harnessSelftest`. It requires only `./argv` and `./shared-infra` at load time; anything it needs from a sibling module it requires lazily inside the lint function, so no load-time cycle can form when `backends.js` starts requiring it.

`backends.js` stops defining `CURRENT_HARNESS` and reads it from `harness.js` instead, re-exporting it unchanged so every existing caller is untouched. This is a pure move: no value changes, no signature changes. The fragile edge is not the value but the export mechanics — `test/backends.test.mjs:15` imports `CURRENT_HARNESS` as a named ESM import from a CommonJS module, and Node resolves that statically. Re-exporting a value that arrives via `require("./harness")` changes what that static detection sees, and if detection fails the import throws at module load, before any assertion runs. A passing `--selftest` therefore proves nothing about it; only running the node test suite does.

### The lint

**What it accomplishes:** proves that every artifact the register claims exists actually exists, and that no unregistered credential-forwarding call site has appeared — so a refactor that removes a driver binding, or a new module that quietly forwards credentials into a harness child, fails CI instead of rotting the inventory.

```
PROCEDURE harness_check(root, COMMANDS):
  1. findings = []
  2. Locate the seam table:
     a. Read root/docs/architecture/harness-coupling.md.
     b. Take the text between the "## The seams" heading and the next H2 heading.
     c. IF that heading is absent, OR the slice contains no markdown table:
          findings += { kind: "seam-table-missing" }; SKIP to step 5.
     d. Doc rows = the bold first-cell label of each row in THAT slice only — never the
        disposition-vocabulary table, whose cells are also bold.
  3. FOR each seam in REGISTER:
     a. IF seam.doc_row is not among the doc rows:
          findings += { seam.id, kind: "no-doc-row", detail: seam.doc_row }
     b. FOR each (harness, binding) in seam.driver:      # empty for an unbound seam
        - IF seam.binding = "code":
            i.   Lazily require ./<binding.module>
            ii.  IF the require throws: findings += { seam.id, kind: "module-missing" }
            iii. FOR each name in binding.exports:
                   IF the name is absent from the module's exports:
                     findings += { seam.id, kind: "export-missing", detail: name }
        - IF seam.binding = "prose":
            i.  Read root/binding.file
            ii. IF unreadable: findings += { seam.id, kind: "file-missing" }
            iii.ELSE IF binding.section does not appear verbatim in the text:
                     findings += { seam.id, kind: "section-missing", detail: binding.section }
     c. IF seam.floor is present:
        - IF seam.floor.asserted_by is not a key of COMMANDS:
            findings += { seam.id, kind: "floor-contract-missing" }
     d. FOR each site in seam.credential_scope (if present):        # forward direction
        - Split "<file>:<symbol>"; IF the file is unreadable OR the symbol does not
          appear in it: findings += { seam.id, kind: "credential-site-missing" }
  4. Reverse credential sweep, over plugin/skills/faff/bin/lib/*.js and eval/*.mjs:
     a. Build the module's spawn-family binding set: the child-process entry points it
        imports or requires (spawn, spawnSync, exec, execSync, execFile, execFileSync),
        PLUS every local binding initialised to one of them, PLUS every function
        parameter whose default value is one of them. Resolve transitively.
     b. Find every call whose callee is in that set AND whose options object carries an
        `env` key — shorthand `env` included.
     c. Classify the env value:
        - constant: a fixed object literal whose values are all string literals, OR an
          identifier resolving to exactly that within this module, with no reference to
          process.env, to a parameter, or to an imported/required value.
        - forwarding: anything else, including any value the resolver cannot decide.
     d. SKIP constant sites. They forward nothing; a sanitized-env spawn is not a
        credential site and must never need registering.
     e. For each forwarding site, resolve the OUTERMOST named function containing it.
     f. IF "<file>:<function>" is in no seam's credential_scope:
          findings += { kind: "credential-site-unregistered", detail: the site }
  5. Report every seam-table row with NO register seam as kind "unregistered", severity
     INFORMATIONAL — printed, never counted toward the exit code.
  6. RETURN exit 1 IF findings contains any non-informational entry, ELSE exit 0
```

The reverse sweep is syntactic. It sees an environment handed to a child through a spawn's `env` option, which is how every known harness-child path does it. It does not see a credential reaching a child by any other route — written to a file the child reads (`forwardCredentials` is exactly that, which is why it is registered by hand), or simply inherited because the spawn passes no `env` at all and Node hands the child the parent's. That bound is stated on the `credential_scope` field and printed in the CLI output, because a credential check that implies more coverage than it has is worse than one that states its edge.

Both directions of the classifier fail safe. An `env` value the resolver cannot decide is treated as forwarding, so an unfamiliar shape lands as a finding a human reads rather than a silent pass; and an unresolvable callee is simply not spawn-family, which is the same coverage gap the syntactic bound already declares.

**Anti-pattern:** giving the sweep a list of modules or sites to skip. Why: the difference between narrowing and muting is whether the exclusion has to be argued once in the rules or claimed per case. The constant-env rule excludes the hasher because the hasher provably forwards nothing; a skip list would excuse anything anyone found inconvenient, and `regions.js` already sets the no-suppression precedent for in-code maps asserted against reality.

**Anti-pattern:** making the register-to-doc relationship a strict bijection. Why: the disposition inventory legitimately carries rows that need no driver entry at all — a `portable` seam like the deterministic CLI works everywhere by construction. The inventory's own extension rule is one-directional (a seam the interface names must have a row), so the lint is total in that direction and informational in the other.

**Anti-pattern:** implementing the floor check by spawning the contract and re-deriving whether a container is present. Why: `container-check` is a plain entry in the `COMMANDS` map at `plugin/skills/faff/bin/faff:128`, and `lint-cli-doc` already reads that map in process through `cmdLintCliDoc(args, COMMANDS)`. Running a real container detection inside a CI lint is both slow and environment-dependent, and the precedent for avoiding it is already wired one line away.

### Edge cases and error handling

- **The disposition inventory is missing, or has no `## The seams` section.** Terminal: exit 1 naming the path and which of the two failed, never a silent pass. A register whose doc anchor is gone is exactly the drift this lint exists to catch.
- **A label that exists in both tables.** Cannot resolve against the wrong one: only the `## The seams` slice is parsed, so a seam label colliding with a disposition term (`drop`, `adapter`, `portable`, `down-stack`) is still matched against seam rows alone.
- **A FAFF-482 seam row is missing or reworded.** If any of the five FAFF-482 rows (or the two committed rows) is absent or re-labelled, `faff harness check` reports `no-doc-row` for that seam and exits 1. FAFF-482 has landed (2026-07-29) with all five rows present, so this now guards against a *future* re-wording rather than a not-yet-landed blocker — the same self-enforcing check either way.
- **A register seam declares a harness id outside `HarnessId`.** Hard error at module load, in the closed-enum style the rest of `bin/lib` uses — never a skipped entry.
- **A `prose` seam whose section header is reworded.** Reported as `section-missing`, exit 1. The fix is to update the register, which is the point: the register is a claim about the prose, and rewording the prose invalidates the claim.
- **A new forwarding spawn lands in a swept tree.** Reported as `credential-site-unregistered`, exit 1. The fix is to register it deliberately, which is the only moment anyone is forced to look at a new credential path.
- **A spawn under a fixed sanitized environment.** Not a finding and not registerable — `integrity-digest.js:sha256` under `SANITIZED_ENV` is the live instance, and the selftest pins it as a case that produces no finding, so a later loosening of the constant rule fails visibly.
- **A spawn through an injected or aliased callee.** Matched, because spawn-family is resolved by binding. `runCodexCall`'s `spawnFn` parameter defaults to `spawnSync`, and the selftest pins that shape specifically — a name-only matcher would miss the one site the seam exists for.
- **An `env` value the resolver cannot classify.** Treated as forwarding and reported, exit 1. Registering it or reshaping the call are both fine; passing by default is not.
- **`--json` with findings.** Findings array plus the exit code in the payload; the exit code is unchanged by the flag.

### Failure modes

- **The register is an inventory nobody consults, so it rots in a different way.** How you would know: FAFF-479 lands a Codex driver and the register needs edits that are pure bookkeeping — no branch anywhere reads a `driver` entry. What it means: narrow. The register still earns its keep as the lint's input, but the claim that it is an *interface* rather than a checked manifest would not have survived, and the resolver function should land with FAFF-479 rather than later.
- **The prose-bound seams turn out to be un-portable for reasons the register cannot express.** How you would know: FAFF-479 finds that a `prose` seam needs different *content* per harness, not just a different pointer — which would mean forking skill prose, the exact thing the ticket forbids. What it means: escalate to a human before FAFF-479 proceeds; the register would need a per-harness prose variant concept, which is a materially different design.
- **The env-classifier's "cannot decide means forwarding" default turns out to be the noisy edge.** How you would know: registrations pile up for spawns that plainly carry nothing sensitive, because the value came through a shape the resolver would not follow. What it means: extend the constant proof to cover the shape — never add a skip list, and never flip the default to passing, because a classifier that fails toward silence stops being a credential check. The two match rules above already removed the known noise; this is about a shape nobody has written yet.
- **The section-header anchors make the lint noisy enough that people route around it.** How you would know: the lint fails on ordinary prose edits more than once or twice a quarter. What it means: narrow the anchors to stable heading text rather than sentence fragments.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the register declares subagent-dispatch bound to engine.js with export runEngineCall
When runEngineCall is renamed without updating the register
Then faff harness check exits 1 with an export-missing finding naming runEngineCall
```

```
Given docs/architecture/harness-coupling.md is still its pre-FAFF-482 form, 8 seam rows
When faff harness check runs
Then it exits 1 with a no-doc-row finding for each of the five seams FAFF-482 adds
```

```
Given a new module under plugin/skills/faff/bin/lib spawns a child through a parameter
  whose default is spawnSync, passing an env built from process.env, and appears in
  no seam's credential_scope
When faff harness check runs
Then it exits 1 with a credential-site-unregistered finding naming that file and its
  outermost enclosing function
```

```
Given integrity-digest.js:sha256 spawns the hasher with env set to SANITIZED_ENV,
  a module-level literal of string literals, and is in no credential_scope
When faff harness check runs
Then it raises no finding for that call and exits 0 on the sweep
```

- The register declares no callable member, and no `driver` entry at all, for the seam whose binding kind is `unbound` — asserted structurally, not by review.
- `faff backends realizable --refs claude-sub --harness some-other-harness --json`, against the committed golden fixture, exits 1 with stdout parsing to `{"refuse":true,"reason":"chain-unrealizable"}` — pinned before the `CURRENT_HARNESS` move and asserted after.
- `faff harness check` performs no network access and spawns no child process at all.

## 6. Design decision rationale

**What kind of artifact does this ticket actually deliver, given that most of its seams are prose?**

Three options were on the table. A set of callable driver functions covering all seven seams would mean inventing functions for things that are instructions — a method that no driver implements and no caller invokes. Covering only the two code-backed seams and leaving the prose ones undocumented would satisfy a narrow reading of the ticket while silently dropping three of FAFF-482's five dispositions. A declared register covering all seven, with binding kind as a first-class field and a lint that proves every binding resolves, covers everything the ticket names without pretending prose is code.

**Chosen:** the deliverable is a seam register in `plugin/skills/faff/bin/lib/harness.js` plus a `faff harness check` lint, covering all seven seams with an explicit binding kind — not a set of driver functions. It is falsifiable for every kind, and the register is exactly the checklist FAFF-479 needs.

**Interface granularity: one fat harness object, or several narrow seam interfaces?**

This is the open question stated on the ticket, and settling the artifact question above largely dissolves it. With a register rather than a dispatch object, "fat versus narrow" reduces to whether the register is one flat list or several typed sub-lists. The seams share nothing mechanically — HTTP and subprocess dispatch, process spawn with env plumbing, MCP config registration, nothing at all for the dropped chaining handoff, and a file-load convention — so grouping them by mechanism produces groups of one. Their one shared property is administrative: each is a thing a harness does differently.

**Chosen:** one flat register of narrow, uniformly-shaped seam records, in a single module, with no harness object and no per-seam interface type. The record's `binding` field carries the only distinction that matters, and free functions over the register match the `backends.js` house pattern (`portableMatrixAdmits`, `checkRealizable`) rather than introducing a class where the codebase has none.

**Does the dropped skill-to-skill chaining handoff get an interface member?**

FAFF-482 classifies it `drop`: the harness mechanic is removed and its job moves into skill prose. Including it as a callable member would define a method with no implementation on any driver, contradicting the disposition it traces to. Excluding it entirely would lose the traceability the disposition inventory's extension rule demands.

**Chosen:** it gets a register entry with binding `prose`, anchored on the gateway's "Chaining pattern" section, and no callable member. Registered so it is traceable; not callable, because there is nothing to call.

**How does the tracker-access seam earn a register entry, given that faff owns no artifact for it?**

Anchoring its prose binding on its own disposition row, as an earlier draft did, claims a driver-side check that is really the doc-row check wearing a second hat — it can only fail once the doc-row check has already failed, so it adds no falsifiability and quietly breaks the register's own admission rule. The two honest alternatives are to drop the entry entirely, letting the open question in section 7 carry the traceability on its own, or to name the situation in the type system. Dropping it loses the one thing the disposition inventory's extension rule asks for: a seam the interface names traces to a row, and FAFF-479 reads the register rather than this spec to learn what it owes.

**Chosen:** a third binding kind, `unbound`, with an empty `driver` map and a required `open_question` field naming FAFF-479. The seam keeps exactly one check — the doc-row check — and `faff harness seams` prints it as carrying no driver-side check, so nobody reads assurance into it. The alternative of removing the entry is recorded here so it is not re-proposed: it trades a truthful entry for a silent gap.

**Where does harness identity live?**

`backends.js` owns `CURRENT_HARNESS` today, and it is already reachable from outside via the `--harness` flag on `faff backends realizable`. Leaving it there means the new module either imports from `backends.js` — which is the wrong direction, since backends is a consumer of harness identity rather than its owner — or declares a second constant, which is the duplicated-vocabulary trap.

**Chosen:** `CURRENT_HARNESS` and the new closed `HarnessId` enum live in `harness.js`; `backends.js` requires and re-exports `CURRENT_HARNESS` unchanged, keeping its position in the existing export list at line 670. No signature changes, no value changes.

**How deep does the environment-floor assertion go in this ticket?**

FAFF-482 settled that sandbox mode and network reach belong to the environment, that faff's spawn method carries an assertion the environment meets the floor, and that this is a check rather than a set of knobs. Two sub-questions remain: whether FAFF-483 wires a new refusal, and how the lint confirms the named contract exists. It should wire no refusal: `container-check.js` already detects containment and `lights-out.js` already refuses on it fail-closed. And confirming the contract exists needs no spawn — `container-check` is a key of the `COMMANDS` map at `plugin/skills/faff/bin/faff:128`, and the map is already passed into sibling lints in process.

**Chosen:** the floor is a declared field on the `headless-session-entry` seam naming the required signal and the already-shipped contract that asserts it; the lint confirms `asserted_by` is a key of the `COMMANDS` map passed into `cmdHarness`, with no child process and no re-derivation of the container verdict. FAFF-479 declares Codex's floor in the same field.

**Does the credential-scope field get a reverse sweep, or an honest statement of its limits?**

Declaring two known call sites and asserting they still exist checks the direction that does not matter. Removal is not the risk; a third site appearing is — a new module forwarding credentials into a harness child would pass a forward-only check in silence. That is the reverse of the "unregistered doc row" sweep the lint already performs, and the field exists specifically to make FAFF-482's credential boundary checkable, so a check that only catches removal claims more assurance than it earns. Writing the limitation down instead is honest but leaves the boundary unenforced. Drafting the sweep also settled the question empirically: the two-site list an earlier draft declared was already incomplete, missing an `env`-carrying spawn in `eval/cli-driver.mjs` and another in `eval/live-driver.mjs`.

**Chosen:** a reverse sweep over `plugin/skills/faff/bin/lib/*.js` and `eval/*.mjs` for forwarding spawn-family calls, reporting any unregistered site as a failing finding — plus a stated bound, on the field and in the CLI output, that the sweep is syntactic and does not see credentials reaching a child by other routes. The register's day-one `credential_scope` is whatever the sweep reports, not a hand-written pair. What counts as "forwarding" and as "spawn-family" is the next decision.

**Which spawns does the sweep match, given a sanitized hasher and an injected spawn function?**

A sweep matching call-site names for an `env` key is wrong in both directions on today's tree, and this is a day-one problem rather than a drift risk. It over-matches `integrity-digest.js:sha256`, which spawns the SHA-256 hasher under `SANITIZED_ENV` — `{ PATH: "/usr/bin:/bin" }`, deliberately stripped, no harness anywhere near it. That site belongs to no seam, so it lands as a failing `credential-site-unregistered` finding, and the build agent's only two moves are to register a sanitized hasher into `headless-session-entry.credential_scope`, which empties the field of meaning, or to fail its own DONE criterion. It also under-matches the one site the seam exists for: `runCodexCall` spawns the codex child through `spawnFn`, a parameter defaulting to `spawnSync`, and that injection is the house pattern — the module's own header says the selftest and CI make zero real spawns, and this spec's selftest criterion relies on the same shape.

Three ways to fix the over-match were on the table. Narrowing the swept set to a declared list of harness-child modules is a mute list wearing a scope: the list can be trimmed to make a finding go away, and nothing checks it. Reducing the DONE criterion to what a name-based sweep can see leaves the field's real claim unstated and the hasher still failing. Classifying the `env` value settles it at the cause — the hasher is excluded because it provably forwards nothing, not because someone listed it.

**Chosen:** two rules, both resolved by binding rather than by spelling. A callee is spawn-family if it resolves within its module to a child-process entry point, including through a local alias or a parameter default. An `env` value is forwarding unless it provably resolves to a fixed literal of string literals with no reference to `process.env`, a parameter, or an imported value — undecidable shapes count as forwarding. The swept set stays the whole of `bin/lib` and `eval/*.mjs`, because narrowing by module is the suppression-shaped move and narrowing by rule is not. Run over the tree, this yields the three swept sites in the WHAT table (`runCodexCall`, `makeCliDriver`, `makeLiveModel`) and excludes the hasher, with `forwardCredentials` declared alongside them as the worked example of what a syntactic sweep cannot see.

**How does the lint identify the seam table, given the doc carries two tables of bold labels?**

`docs/architecture/harness-coupling.md` has a disposition-vocabulary table whose first cells are `**portable**`, `**adapter**`, `**down-stack**` and `**drop**`, and a seam table whose first cells are bold seam labels. A parser that takes every bold first cell in the file fails open on a collision: a seam whose label matched a disposition term would resolve against the wrong table and be reported as present when it is not. Matching on the table's header row is one option, but FAFF-482 owns that file and could legitimately reword a column heading. The section heading is the more stable anchor, and the doc's structure is already section-per-table.

**Chosen:** parse only the slice between the `## The seams` heading and the next H2, and fail loud with `seam-table-missing` if that heading is absent or the slice holds no table. A collision then cannot resolve wrongly, and a restructure of the doc fails visibly rather than silently passing every row.

**How is "no behaviour change, byte-for-byte where the CLI is involved" made falsifiable?**

As the ticket words it, this criterion cannot be discharged after the fact — nothing pins the pre-move output, so "byte-identical to before the move" has nothing to compare against. The repo does have the mechanism, though: `test/contract-golden.test.mjs` reads committed cases from `test/golden/contracts/cases.json`, spawns the `faff` bin, and asserts an exact exit code plus deep-equal parsed stdout, precisely to catch shape drift a loosely-authored inline `--selftest` would pass (FAFF-96, ADR-0002). CI runs it under `node --test`. Two ways to use it: widen the contract cases file, or add a sibling. Widening drags this ticket's cases into another ticket's committed goldens and needs the runner's hardcoded `contract <name>` argv generalised anyway. Separately, the `--selftest` runs are the wrong instrument for the move's real hazard, which is a named ESM import of `CURRENT_HARNESS` from a CommonJS module failing at load time.

**Chosen:** a sibling golden — `test/harness-golden.test.mjs` plus `test/golden/harness/cases.json` — in the same shape as the contract goldens, with each case carrying an argv vector and a `.faffrc.yaml` fixture body written to a temp cwd. Cases are captured on the pre-move tree, committed, and asserted after; the harness axis is pinned by a `subscription-seat` backend resolving `{"ok":true}` at exit 0 under `--harness claude-code` and `{"refuse":true,"reason":"chain-unrealizable"}` at exit 1 under `--harness some-other-harness`. The `--selftest` runs stay as a pass/fail check, not a byte-identity claim they cannot support, and `node --test test/backends.test.mjs` joins the done criteria because it holds the only cross-module-system consumer. For the prose-bound seams the criterion is a diff-shaped one — this ticket lands no edit to any `SKILL.md`, to `AGENTS.md`, or to the disposition inventory — which a reviewer checks against the pull request in seconds.

**Does the tracker-access seam ever get a faff-owned code binding?**

The seam has no `bin/lib` module and this repo contains no `.mcp.json`; tracker MCP access is registered in a per-harness config file that lives outside faff entirely. So today it is unambiguously unbound. Whether it should stay that way is a genuine architecture call: leaving it unbound means each harness's operator wires their own tracker access and faff never sees it, which keeps faff out of the credential path but leaves FAFF-479 with a seam it can only document; giving faff a tracker-access module would make the seam driver-swappable but pulls tracker credentials into faff's own scope, which cuts against the credential boundary FAFF-482 just drew.

**Punt:** register `tracker-access` as permanently unbound, or plan a faff-owned tracker-access module that both drivers implement — needs human (decides: architecture). The register entry lands as `unbound` either way, so this does not block the build; it blocks FAFF-479 knowing whether it owes a Codex implementation here, which is why the entry carries `open_question: "FAFF-479"` rather than a promise that someone gets told.

**What happens if FAFF-482 lands differently from its spec?**

*(Authoring-time framing, retained for rationale; discharged 2026-08-05 — see Refresh log and section 7.)* When this decision was written FAFF-482's deliverable did not yet exist on disk — `docs/architecture/harness-coupling.md` was still its original 33 lines with 8 seam rows — so the spec scoped from FAFF-482's approved spec, and any divergence in the five row labels would break this register's `doc_row` anchors. FAFF-482 has since landed (2026-07-29) with all five rows worded as pinned, so the risk this decision guards against is now the *future* re-wording case rather than a not-yet-delivered inventory.

**Assumes:** FAFF-482 lands the five rows its spec pins, with the five dispositions settled there (concurrent build fan-out `adapter`, headless session entry `adapter`, tracker MCP access `adapter`, skill-to-skill chaining handoff `drop`, session context file `adapter`). The divergence is self-detecting rather than silent: `faff harness check` reports `no-doc-row` for any anchor that does not resolve, so a differently-worded row surfaces as a lint failure the build agent fixes by re-anchoring, not as a wrong register nobody notices.

## 7. Open questions and assumptions

### Open questions

**Tracker access — permanently unbound, or a future faff-owned module?** faff has no tracker-access module and this repo has no `.mcp.json`; access is registered per-harness in config outside faff. Keeping it unbound keeps tracker credentials out of faff's scope, consistent with the credential boundary FAFF-482 drew, but leaves FAFF-479 with a seam it can only document rather than implement. Making it a faff-owned module makes it genuinely driver-swappable at the cost of pulling tracker credentials inside. The register entry lands as `unbound` under either answer, so this does not block landing FAFF-483 — it blocks FAFF-479 knowing its obligations, and the obligation to answer it sits on FAFF-479, carried mechanically by the entry's `open_question` field rather than by anyone remembering. Decides: architecture.

*Context for FAFF-479 (folded 2026-08-05 from FAFF-695, merged #516):* `faff tracker probe` now ships as the **pure** half of tracker-connector resolution — a deterministic `pinned | unpinned` classifier over the `.faffrc tracking.tracker` pin — with the harness-specific *discovery* half left as the gateway's "Tracker availability resolution" prose. This does not change the `unbound` classification here (probe classifies the pin; it does not serve MCP-connector access), but it means the faff-owned-module answer to this question would not start from zero: the pure sub-component already exists and the seam could be shaped as "resolve tracker connector" with `tracker probe` behind its deterministic half.

### Assumptions

**FAFF-482's deliverable exists with the five row labels its spec pins. — Confirmed 2026-08-05 (autonomous refresh).** `docs/architecture/harness-coupling.md` is 74 lines and its `## The seams` table carries rows for concurrent build fan-out, headless session entry, tracker MCP access, skill-to-skill chaining handoff, and session context file, worded and dispositioned as pinned; all seven `doc_row` anchors resolve. Validate-before-starting is retained as a defensive check, since the doc can move between now and the build: read `docs/architecture/harness-coupling.md` and re-confirm the five rows under `## The seams`. In the (now unlikely) event the file has regressed to its 33-line pre-FAFF-482 form, park rather than proceeding — the register's `doc_row` anchors would have nothing to bind to. If a row is present but worded differently, do not park: anchor the register on the label actually present and note the divergence in the pull request.

## 8. DONE — definition of done

### From WHY (the problem)

- [ ] `plugin/skills/faff/bin/lib/harness.js` exists, is dependency-free CommonJS, carries exactly one `region:factory` banner, and requires only `./argv` and `./shared-infra` at load time.
- [ ] `plugin/skills/faff/bin/lib/regions.js` has a `"harness": "factory"` entry in `REGION_MAP` and a `"harness": ["harness", "--selftest"]` entry in its per-module selftest probe list; `faff regions check` passes.

### From WHY (the bounded claim)

- [ ] `faff harness check` and `faff harness seams` both print, in text and in the `--json` payload, that the check covers the register's declared bindings only and is not a general prose-reference checker; `docs/guide/cli.md` says the same.

### From WHAT (types and register)

- [ ] `HarnessId` and `BindingKind` are closed enums that fail loud on an unrecognised value, in the style of `AUTH_VALUES` / `EGRESS_VALUES` in `backends.js`; `BindingKind` admits exactly `code`, `prose`, `unbound`.
- [ ] The register declares exactly the seven seams named in the WHAT table, each with `id`, `binding`, and `doc_row`.
- [ ] Every `code` and `prose` seam carries a `driver` map containing a `claude-code` entry of the matching binding record type; the selftest asserts both directions.
- [ ] The `tracker-access` seam carries `binding: "unbound"`, an empty `driver` map, and `open_question: "FAFF-479"`; the selftest asserts an `unbound` seam with a non-empty `driver`, or with no `open_question`, is a hard error.
- [ ] The `headless-session-entry` seam carries `floor = { requires: "container-confirmed", asserted_by: "container-check" }`.
- [ ] `headless-session-entry`'s `credential_scope` lists every site the reverse sweep reports on the tree at build time, labelled `<file>:<outermost enclosing function>`, plus `eval/cli-driver.mjs:forwardCredentials` as a declared non-spawn path; `faff harness check` exits 0 on the sweep. The claim that exit 0 supports is that no forwarding spawn the sweep can resolve is unregistered — not that every credential path is declared, which a syntactic sweep cannot establish.
- [ ] `engine-codex.js:runCodexCall` is among the swept sites, and `integrity-digest.js:sha256` is not registered and raises no finding — the two cases that prove the match rules rather than the plumbing.
- [ ] `faff harness seams` prints the register; `--json` emits it as structured data, with `tracker-access` shown as carrying no driver-side check.

### From WHAT (CLI surface)

- [ ] `faff harness` is registered in the `COMMANDS` map in `plugin/skills/faff/bin/faff`, dispatched as `cmdHarness(args, COMMANDS)`.
- [ ] `docs/guide/cli.md` documents `faff harness` and its subcommands, so `faff lint-cli-doc` reports neither `missing` nor `orphaned` for it.

### From HOW (the lint)

- [ ] `faff harness check` exits 1 with an `export-missing` finding when a declared code binding's exported symbol is absent.
- [ ] `faff harness check` exits 1 with a `section-missing` finding when a declared prose binding's section text is absent from its file.
- [ ] `faff harness check` exits 1 with a `no-doc-row` finding when a seam's `doc_row` label is absent from the seam table.
- [ ] The doc parse reads only the slice between `## The seams` and the next H2; a fixture whose disposition-vocabulary table contains a label matching a register `doc_row` still produces a `no-doc-row` finding for that seam.
- [ ] A missing file, or a present file with no `## The seams` heading, exits 1 with `seam-table-missing` naming the path — never exits 0.
- [ ] `faff harness check` exits 1 with a `credential-site-unregistered` finding when a swept file gains a forwarding spawn that no `credential_scope` entry names.
- [ ] The sweep matches a spawn whose callee is a parameter defaulting to `spawnSync`, and one whose callee is a local alias of it — not only a literal `spawnSync(` by name.
- [ ] The sweep raises no finding for a spawn whose `env` resolves to a module-level object literal of string literals; a fixture in that exact shape exits 0, and the sweep carries no per-site or per-module skip list of any kind.
- [ ] An `env` value the classifier cannot resolve is reported as forwarding, not passed — asserted by a fixture with a computed `env` value that no register entry names.
- [ ] `faff harness check` exits 1 with a `credential-site-missing` finding when a registered site's file or symbol disappears.
- [ ] The floor check resolves `asserted_by` against the `COMMANDS` map in process; `faff harness check` spawns no child process, verified by the selftest's injected spawn function recording zero calls.
- [ ] `faff harness check` reports seam-table rows with no register seam as informational and exits 0 on those alone.

### From HOW (the harness-identity move)

- [ ] `CURRENT_HARNESS` is defined in `harness.js` and re-exported from `backends.js` with an unchanged value and unchanged export name.
- [ ] `test/golden/harness/cases.json` is committed with cases captured on the pre-move tree, and `test/harness-golden.test.mjs` asserts each case's exact exit code and deep-equal parsed stdout, in the shape of `test/contract-golden.test.mjs`.
- [ ] The committed cases include `backends realizable --refs claude-sub --harness claude-code --json` → exit 0, `{"ok":true}`, and `--harness some-other-harness` → exit 1, `{"refuse":true,"reason":"chain-unrealizable"}`, against a fixture declaring `claude-sub` as an `anthropic` backend on `https://api.anthropic.com`.
- [ ] `node --test test/backends.test.mjs` passes — the suite holding the named ESM import of `CURRENT_HARNESS` from a CommonJS module, which is the only consumer the move can break at load time rather than at assert time.
- [ ] `faff backends --selftest` and `faff engine --selftest` (the latter folding `codexSelftest`) both exit 0.

### From HOW (no behaviour change)

- [ ] The pull request contains no edit to any `SKILL.md`, to `AGENTS.md`, to `docs/architecture/harness-coupling.md`, or to `test/golden/contracts/cases.json`.
- [ ] `harnessSelftest` exercises every lint finding kind with injected file readers, an injected module resolver, an injected `COMMANDS` map and an injected spawn function, performing zero real filesystem or network I/O, and is reachable via `faff harness --selftest`.

### From Open Questions

- [ ] The `tracker-access` register entry carries `open_question: "FAFF-479"`, `faff harness seams` prints it, and FAFF-479's ticket description names the unbound-versus-faff-owned call as a decision it must make before implementing that seam.

### Integration smoke test

```
PROCEDURE smoke():
  1. Run `faff harness seams --json`
     → exit 0, payload lists 7 seams; six carry a "claude-code" driver entry,
       tracker-access carries an empty driver map and open_question FAFF-479
  2. Run `faff harness check`
     → exit 0 on a tree where FAFF-482 has landed; every binding resolves and the
       reverse credential sweep reports no unregistered site
  3. Temporarily rename runEngineCall in engine.js; run `faff harness check`
     → exit 1, one export-missing finding naming runEngineCall on subagent-dispatch
  4. Restore; run `node --test test/harness-golden.test.mjs test/backends.test.mjs`
     → exit 0, every pinned case matching its pre-move exit code and stdout
```

confidence: medium
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"punt"},{"marker":"assumes"}]}
```

---

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Risk-aware sequencing — the strongest finding.** The project is named for the loop running under Codex CLI, and its chain runs FAFF-482 → FAFF-483 → FAFF-479: an inventory doc, then a register over that doc, then the driver that actually runs something. Nobody has yet run a faff build step end-to-end under Codex, so all seven seams in this register descend from a spike's reading of the code rather than from a run that broke. Meanwhile `engine-codex.js` already spawns `codex exec --json` today — a real Codex path exists and is untested against the loop. Freezing a seven-seam register into code and a CI lint before that evidence exists means the surprise lands at FAFF-479, after two tickets of preparation are already load-bearing. Recommend a thin de-risking spike ahead of or alongside FAFF-483: drive one real faff step under Codex CLI, note what actually breaks, and check the seam list against that before it becomes a lint.

**Cohesive workstreams — the project cannot meet its own promise.** Project members are FAFF-477 (Done, spike), FAFF-482 (Done, doc), FAFF-483 (Todo, register). FAFF-479 — the only ticket that makes the loop run under Codex — sits outside the project. So the project can go fully Done while the outcome its name promises is untouched. Recommend adding FAFF-479 to the project; without it, "done" for this project means three descriptions of the problem.

**Value by risk — instrumental-only, honestly labelled.** FAFF-483 ships no observable value alone: a lint over one driver, checking anchors nobody is currently breaking. The spec says so itself in its first failure mode. Acceptable for a foundational item, but it argues for sequencing it after a Codex smoke run rather than before, and for keeping the scope at exactly the register the driver needs.

**"Design + first thin implementation seam" — one item, not two.** The design half is already delivered: this spec settles the artifact question, the granularity question the ticket raised, and where harness identity lives. What remains is one build.

**Right-sizing — one honest split, one non-split.** Moving `CURRENT_HARNESS` out of `backends.js` is a pure refactor with its own proof and no dependence on FAFF-482 landing; it could ship today, unblocked, while the register waits. Small enough that merging is defensible, but it is the one piece not parked behind the blocker. Not a split: the code-backed and prose-backed seams are the same record shape and the same lint — splitting by mechanism gives two tickets that must ship together.

**Surfaced dependencies — one missing link, one misplaced check.** FAFF-663 (open, High) is a gateway voice clause pointing at a deleted file, failing silently — precisely the drift class this register exists to catch, and this register would still miss it, because the lint only checks hand-declared anchors. Worth linking as related and being straight about the bounded claim. Separately, a definition-of-done item requiring the tracker-access punt to be "surfaced to a human before FAFF-479 is picked up" cannot be checked when FAFF-483 merges; it belongs on FAFF-479.

**Pickup state.** `faff-jot-intake` + `faff-automate` (automation-eligible), No priority — set a priority deliberately. (Eligibility is set; the earlier critique's "not automation-eligible" note is stale.)
