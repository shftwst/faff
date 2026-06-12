# Spec — FAFF-89: Mock-tracker fixture format + loader

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Full spec on Linear FAFF-89.

This is the buildable nlspec for **FAFF-89 — Mock-tracker fixture format + loader**, the first concrete artefact of the "Deterministic test substrate" project under the *"faff's skills are verified, not assumed"* initiative. Audience: the build agent implementing it, and the human reviewers gating the PR. It builds directly on **ADR 0002** (`docs/adr/0002-skill-test-architecture.md`), which is the parent decision record — read it alongside this spec. FAFF-89 delivers the **fixture schema + an in-memory loader/query model**; it does *not* wire that model into a running skill (that is FAFF-93, the skill-run harness). The seam between the two is made explicit below.

---

## 1. WHY — Problem and Principles

**Problem statement.** faff's LLM-driven skills (wtf / tidy / prep / graft) decide based on **live tracker state** fetched via the configured tracker MCP, so there is no way to assert "given *this* backlog, the skill produces *that* seam output" — the state is never the same twice. ADR 0002 fixed *how* to assert (at deterministic seams) and *what runner* (`node:test`, zero-dependency), but left the mock-tracker itself unbuilt. This issue delivers a **deterministic, in-memory stand-in for the tracker** — a fixture format covering issues / projects / initiatives / blocker relations / labels / comments, plus a loader that exposes it as a queryable model — so a skill test can pin tracker state and assert against known seam outputs.

**Design principles.**

**Zero new dependencies — `node:*` only.** ADR 0002's runner decision is zero-install: no `package.json`, no lockfile, no third-party module. The loader and fixtures must honour this end to end — fixtures are plain JSON loaded with `node:fs`, the model is plain JS objects/Maps, and the only test-time import is `node:test`/`node:assert`. **Anti-pattern:** reaching for a schema-validation library (ajv, zod) or a YAML parser. Why: it reintroduces exactly the install/lockfile burden the zero-install decision exists to kill — validation is hand-written against the type definitions in section 3.

**Faithful to MCP result shapes, not to the live MCP.** The fixture models the *shapes a tracker MCP returns* (issue with id/title/state/labels/relations/comments, project, initiative, label, comment) closely enough that a skill consuming the model cannot tell mock from real. It does **not** reimplement the Linear MCP wire protocol, transport, or tool-call surface — it is a data model, not a server. **Anti-pattern:** hardcoding `mcp__…__Linear`-style tool names or Linear-only field encodings into the fixture or loader. Why: faff is tracker-agnostic by principle (skills "autodetect from the available MCP, don't hardcode") and the gateway already reads tracker-neutral concepts (state *category* `cancelled`, `blockedBy`, relations, comments); the fixture must stay at that neutral shape so it can back GitHub/Jira mocks later.

**Deterministic by construction.** The same fixture loaded twice must yield byte-identical query results, in stable order, with no clock/random/network input. This is the property the whole substrate rests on (ADR 0002 §5 seam contract).

**The loader is a model, not an injector.** FAFF-89 owns the in-memory queryable model. *How* that model reaches a running skill (harness feeds it as "fetched state" vs a mock MCP server process) is FAFF-93's call. Keeping the loader injection-mechanism-agnostic is a hard boundary, not a convenience — see OUT OF SCOPE and the FAFF-89/FAFF-93 split in RATIONALE.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `docs/adr/0002-skill-test-architecture.md` | Markdown (ADR) | Parent decision: assert-at-seam, `node:test` runner, zero-dep, the seam contract this satisfies |
| `test/helpers/run-cli.mjs` | ESM `.mjs`, `node:child_process` | Established helper pattern (zero-dep, ESM, exported funcs); the fixture loader is its sibling helper |
| `test/cli-next-seam.test.mjs` | ESM `.mjs`, `node:test` | Reference fixture proving the seam/runner; the `*.test.mjs` + `node:test` style to match |
| `test/contract-golden.test.mjs` | ESM `.mjs`, `node:test` | Golden-from-JSON pattern (`test/golden/contracts/cases.json`); precedent for committed JSON fixtures + deep-equal asserts |
| `test/golden/contracts/` | JSON | Precedent location for committed fixture data under `test/` |
| `skills/faff/SKILL.md` | Markdown | Tracker-neutral state vocabulary the model must mirror (state category, blockedBy, relations, comments, labels) |
| `skills/faff/bin/faff` (`state`, `next`, `eligible`) | Node, zero-dep | The CLI is a **pure function** consuming flags, **no MCP** — the architectural constraint the loader must not violate (section HOW) |

**Scope statement.** This is the **tracker-state half** of the test substrate: an in-memory, queryable model of tracker state plus its on-disk fixture format, sitting under `test/` beside the existing helpers — consumed later by the FAFF-93 skill-run harness and reused by CLI-coverage/golden tests (FAFF-91/92/96).

---

## 2. OUT OF SCOPE

- **The injection mechanism into a live skill run.** — Wiring the model so a *running skill* sees it as its fetched tracker state (harness-fed state vs mock MCP server process vs cassette replay). **Why excluded:** that is the skill-run harness's job (FAFF-93) and depends on FAFF-93's decision about how skill decisions are captured; FAFF-89 must not pre-empt it. **Extension point:** FAFF-93 imports the loader's public query API (section 3) and adapts it to whichever boundary it chooses; the loader exposes a tracker-MCP-shaped query surface precisely so FAFF-93 can wrap it without changes here.
- **A running mock MCP *server* (process/transport).** — A spawnable process that speaks the MCP tool-call protocol. **Why excluded:** the model is sufficient for in-process tests and ADR 0002's seam contract; a server is one *possible* FAFF-93 injection choice, not a FAFF-89 deliverable. **Extension point:** a future `test/mock-tracker/server.mjs` would import this loader's query API and expose it over a transport.
- **Record/replay cassettes from a live tracker.** — Capturing real MCP responses and replaying them. **Why excluded:** rejected as the fidelity mechanism (see RATIONALE) — couples fixtures to a live account and produces opaque, hard-to-edit blobs. **Extension point:** if ever wanted, a recorder would emit fixtures in *this* schema (the schema is the durable artefact regardless of how a fixture is authored).
- **Tracker mutation / write-back.** — Modelling `save_issue`/status-move side effects against the fixture. **Why excluded:** ADR 0002 asserts mutations at the *seam* (the skill's attempted MCP call args), not by mutating mock state; the model is read-only. **Extension point:** a future mutation-recording wrapper around the query API, if a skill test needs to assert post-mutation state rather than the mutation call itself.
- **Seeded git repo / worktree fixtures (FAFF-90).** — The local-filesystem half (git branches, `.faff/runs`, committed specs) that `faff state` reads. **Why excluded:** that is a separate substrate ticket; FAFF-89 is tracker state only. **Extension point:** FAFF-90; the two compose at the FAFF-93 harness, which gives a skill both a fixture and a seeded repo.
- **Full tracker field coverage (every Linear field).** — Cycles, milestones, attachments, documents, sub-issue trees beyond parent/child id, assignees, estimates. **Why excluded:** the issue scopes the set to issues / projects / initiatives / blocker relations / labels / comments; over-modelling slows authoring and risks Linear-specific fields leaking in against the agnostic principle. **Extension point:** the type definitions in section 3 are additively extensible — a new optional field on `Issue` plus a query method; add only when a skill test needs it.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Fixture | A committed JSON file describing one complete tracker state (a backlog snapshot): the entities and their relations. |
| Loader | The zero-dep ESM module that reads a fixture file (or object), validates it, and returns a **Tracker model**. |
| Tracker model | An in-memory, read-only, queryable representation of one fixture — the object a test (and later FAFF-93) calls query methods on. |
| Query method | A function on the model that returns tracker-MCP-shaped results (e.g. list issues, get issue, list comments) deterministically. |
| Seam-shaped result | A query return value whose shape mirrors what a tracker MCP returns for the equivalent call, so a skill can't distinguish it. |
| State category | The tracker-neutral lifecycle bucket of a status (`backlog` / `unstarted` / `started` / `completed` / `cancelled`), mirroring Linear's state `type`. |

**Type definitions.** Fixture entities. All ids are opaque strings (human-readable in fixtures, e.g. `"FAFF-89"`); relations are by id. Field names mirror tracker-MCP result shapes (camelCase, as Linear's MCP returns).

```
RECORD Fixture:
  version: Int                 # schema version; loader rejects unknown majors. Start at 1.
  issues: List<Issue>          # may be empty
  projects: List<Project>      # may be empty
  initiatives: List<Initiative># may be empty
  labels: List<Label>          # the label catalog; issue.labels reference these by name
  comments: List<Comment>      # all comments across all issues, each carrying its issueId

  CONSTRAINT every id within a collection is unique
  CONSTRAINT every relation/reference id resolves to a known entity (see loader validation)

RECORD Issue:
  id: String                   # e.g. "FAFF-89"; unique; immutable
  title: String
  state: String                # workflow state NAME, e.g. "Backlog", "Todo", "In Progress", "Done", "Cancelled"
  stateCategory: StateCategory # tracker-neutral bucket (mirrors Linear state `type`)
  labels: List<String>         # label NAMES; each must exist in Fixture.labels
  priority: Int?               # 0=none,1=urgent,2=high,3=normal,4=low (Linear convention); optional
  projectId: String?           # FK to Project.id; optional (issue may be project-less)
  relations: IssueRelations    # blocker graph + related links (see below)

RECORD IssueRelations:
  blocks: List<String>         # issue ids this issue blocks
  blockedBy: List<String>      # issue ids blocking this issue
  relatedTo: List<String>      # non-directional related issue ids
  # parent/sub-issue: parentId on Issue is sufficient for now (see OUT OF SCOPE: sub-issue trees)

RECORD Project:
  id: String                   # unique
  name: String
  state: String                # e.g. "planned", "started", "completed", "cancelled" (Linear project state)
  initiativeIds: List<String>  # FKs to Initiative.id; may be empty
  priority: Int?               # optional, same convention as Issue.priority

RECORD Initiative:
  id: String                   # unique
  name: String
  status: String?              # e.g. "Active", "Planned"; optional

RECORD Label:
  name: String                 # unique; the catalog key issues reference
  color: String?               # optional hex, e.g. "#4ea7fc"
  description: String?         # optional

RECORD Comment:
  id: String                   # unique
  issueId: String              # FK to Issue.id — which issue this comment is on
  body: String                 # markdown; faff-prep specs live here, so body fidelity matters
  createdAt: String            # ISO-8601; FIXED in the fixture (never `now()`), preserves determinism + ordering

ENUM StateCategory: backlog | unstarted | started | completed | cancelled
```

**Loader / model interface.** Public ESM exports of `test/helpers/mock-tracker.mjs` (sibling to `run-cli.mjs`). The model's query methods are the **seam** consumers bind to.

```
INTERFACE mock-tracker (module):

  loadFixture(source): TrackerModel
    # source: an absolute path to a .json fixture, OR an already-parsed fixture object.
    # Reads (node:fs, utf8) + JSON.parse if given a path; validates; returns a frozen model.
    # THROWS FixtureError (with a precise message) on any validation failure — fail loud, never partial.

  TrackerModel (read-only; methods return DEEP COPIES so callers can't mutate shared state):
    listIssues(filter?): List<IssueResult>      # filter: { state?, stateCategory?, labels?, projectId? }; AND-combined
    getIssue(id): IssueResult | null            # null when absent (mirrors a not-found get)
    listProjects(filter?): List<ProjectResult>  # filter: { initiativeId? }
    getProject(id): ProjectResult | null
    listInitiatives(): List<InitiativeResult>
    listLabels(): List<LabelResult>
    listComments(issueId): List<CommentResult>  # all comments on one issue, ordered by createdAt asc then id asc

  # *Result types are the seam-shaped views: an IssueResult carries its resolved labels (name+color),
  # its relations, and its project reference — the shape a skill expects back from get_issue/list_issues.
```

**Design decisions (resolved inline; full rationale in section 5).**

- **Fixture on-disk format: JSON, not YAML.** **Chosen:** JSON. The repo has zero-dep precedent (`test/golden/contracts/cases.json` parsed with `node:fs` + `JSON.parse`); YAML would need a parser dependency, violating the zero-install principle. JSON's verbosity is acceptable for committed fixtures reviewed as diffs.
- **Determinism of ordering: loader-enforced stable sort, fixtures author-ordered for readability.** **Chosen:** the model sorts every list result by a defined key (issues by id asc; comments by `createdAt` asc then id asc; labels/projects/initiatives by id/name asc) so output order never depends on fixture authoring order or JSON key order. Fixtures stay human-ordered for review.
- **Validation: hand-written, fail-loud, in the loader.** **Chosen:** the loader validates structurally (required fields, id uniqueness, referential integrity of every FK) and throws `FixtureError` with a precise path/message. No schema library (zero-dep principle). A malformed fixture must fail at load, not surface as a confusing test failure later.
- **The fidelity mechanism (the ADR 0002 punt — this spec's central decision).** **Chosen:** **hand-written JSON fixtures + an in-memory query model** — see RATIONALE for the full framing of the three options and why recorded cassettes and a test-mode MCP server are rejected for FAFF-89.

---

## 4. HOW — Behavior

**Architecture and approach.** One new module, `test/helpers/mock-tracker.mjs`, plus committed fixtures under `test/fixtures/tracker/*.json` and at least one self-test `test/mock-tracker.test.mjs`. The module is the test-side analog of the step the gateway describes for live runs: *"the agent maps fetched tracker state → flags."* In production the agent fetches via the configured MCP; in tests the loader supplies the same shapes from a fixture. **Crucially, the loader does not touch the `faff` CLI** — the CLI is a pure function over flags with no MCP access, and the tracker boundary is between the *skill-agent and the MCP*, not inside the CLI. So the loader serves the skill-agent layer (via FAFF-93), never the CLI. This is the architectural constraint that rules out "a loader that intercepts inside the CLI."

```
PROCEDURE loadFixture(source):
  1. IF source is a string path:
     a. text := fs.readFileSync(source, "utf8")          # node:fs, absolute path
     b. raw  := JSON.parse(text)                          # JSON.parse error → wrap as FixtureError(parse)
  2. ELSE: raw := source                                  # already an object
  3. validate(raw):                                       # fail-loud, see below
  4. build indexes: Map<id → entity> for issues/projects/initiatives, Map<name → label>,
     Map<issueId → List<Comment>>
  5. RETURN Object.freeze(model bound to those indexes)   # read-only; methods deep-copy on return
```

**Behavior summary (validate):** confirm the fixture is internally consistent before any query can run, so every failure is a clear load-time error, not a downstream mystery.

```
PROCEDURE validate(raw):
  1. raw.version present and == 1               ELSE FixtureError("unsupported fixture version <v>")
  2. each of issues/projects/initiatives/labels/comments is an Array (missing → treat as [])
  3. within each collection, ids/names are unique ELSE FixtureError("duplicate id <id> in <collection>")
  4. referential integrity (every reference resolves) ELSE FixtureError("<entity> <id>: dangling <field> -> <target>"):
     a. issue.projectId            → a known Project.id (when present)
     b. issue.labels[*]            → known Label.name
     c. issue.relations.blocks/blockedBy/relatedTo[*] → known Issue.id
     d. issue.parentId             → known Issue.id (when present)
     e. project.initiativeIds[*]   → known Initiative.id
     f. comment.issueId            → known Issue.id
  5. each Issue has a valid stateCategory ∈ ENUM ELSE FixtureError("issue <id>: bad stateCategory <v>")
```

**Behavior summary (query):** return tracker-MCP-shaped results, filtered and deterministically ordered, as deep copies.

```
PROCEDURE listIssues(filter):
  1. rows := all issues
  2. IF filter.state:         keep rows where issue.state === filter.state
  3. IF filter.stateCategory: keep rows where issue.stateCategory === filter.stateCategory
  4. IF filter.projectId:     keep rows where issue.projectId === filter.projectId
  5. IF filter.labels:        keep rows where every name in filter.labels ∈ issue.labels   # AND semantics
  6. sort rows by id ascending                                # stable, fixture-order-independent
  7. RETURN rows.map(toIssueResult)                           # deep copy; resolve labels to {name,color}

PROCEDURE listComments(issueId):
  1. rows := commentsByIssue.get(issueId) ?? []               # unknown issue → [] (not an error: mirrors empty thread)
  2. sort rows by (createdAt asc, then id asc)
  3. RETURN rows.map(deepCopy)
```

**Symmetry to the live consumer.** The gateway requires that a spec-discovery pass fetch comments via the tracker's list-comments tool (descriptions alone are invalid output). `listComments` exists so a fixture-backed prep/tidy test can exercise that exact path: a fixture issue with a spec comment must be classifiable as "has spec," proving the mock reaches the same seam the live MCP does.

**Edge cases and error handling.**
- **Empty collections.** A fixture may omit any collection (treated as `[]`). `listIssues()` on an empty fixture returns `[]`, not an error. Boundary: the minimal valid fixture is `{ "version": 1 }`.
- **Unknown id on `get*`.** Returns `null` (mirrors a not-found fetch) — *terminal-but-not-error*; the caller decides.
- **Unknown issueId on `listComments`.** Returns `[]` (an issue with no thread is normal). Distinct from `getIssue(unknown) → null`.
- **Dangling reference in fixture.** **Terminal load error** — `FixtureError`, thrown by `loadFixture`, never deferred to query time. Rationale: a fixture with a broken link is an authoring bug; surfacing it at load makes it a one-line fix, not a confusing assertion failure three tests later.
- **Mutation attempt on a result.** Results are deep copies, so a caller mutating a returned object cannot corrupt the shared model; a second identical query returns pristine data. (The model itself is `Object.freeze`d.)
- **Error categories.** All fixture-shape problems are **terminal** `FixtureError`s at load (fix the fixture). Missing-entity *queries* are **not** errors (`null`/`[]`). There are no retryable errors — nothing here touches network or clock.

**Anti-pattern:** routing the fixture through the `faff` CLI (e.g. trying to make `faff state`/`faff next` read it). Why: the CLI is a pure function with no MCP/tracker access by design; the tracker seam is the skill-agent↔MCP boundary, not inside the CLI, so the loader serves the agent layer (FAFF-93), never the CLI.

**Anti-pattern:** putting `createdAt: new Date().toISOString()` (or any `now()`/random) anywhere in the loader or fixtures. Why: it breaks the byte-identical-twice property that the entire substrate rests on; comment timestamps are fixed literals in the fixture.

**Anti-pattern:** returning live references to the model's internal objects from query methods. Why: a consumer (or a buggy skill under test) could mutate shared state and make later assertions in the same run depend on earlier ones — non-determinism by the back door. Always deep-copy on return.

---

## 5. DESIGN DECISION RATIONALE

**Which mock-tracker fidelity mechanism? (The ADR 0002 punt — the central decision.)**

ADR 0002 §"Open (handed downstream)" hands FAFF-89 the choice of *Mock-MCP fidelity*: **hand-written fixtures vs recorded cassettes vs a test-mode MCP server**, to be decided "using the seam contract" — *"the mock returns deterministic responses for a given fixture state, injected at the skill→MCP boundary, such that a skill run over a fixed fixture yields identical seam outputs every time."*

- **Hand-written JSON fixtures + in-memory query model** — *Pros:* zero-dependency (plain JSON + `node:fs`); fully deterministic by construction (no clock/network/account); reviewable as diffs; trivially editable to craft the exact backlog a test needs (a cycle, a stale blocker, an issue-with-spec-comment); tracker-agnostic shape. *Cons:* fixtures are authored by hand, so they could drift from real MCP shapes if no one keeps them faithful (mitigated by the explicit shape mapping in section 3 and the agnostic principle).
- **Recorded cassettes (capture live MCP responses, replay)** — *Pros:* high fidelity to a real tracker at capture time; less hand-authoring. *Cons:* requires a live tracker account to (re)record — a network/credentials dependency the zero-install ethos forbids in CI; cassettes are opaque blobs, hard to review or hand-edit to construct a precise adversarial backlog; re-recording on schema change is a hidden maintenance tax; couples the test substrate to a specific live workspace's data.
- **Test-mode MCP server (a spawnable process speaking the protocol)** — *Pros:* highest realism — exercises the actual tool-call boundary. *Cons:* it is *infrastructure*, not a fixture: a process, a transport, lifecycle management — far beyond "a fixture schema + loader," and its very existence presumes FAFF-93's injection decision (which boundary the skill is pointed at), which is explicitly not FAFF-89's to make. It also still needs *some* state source underneath — i.e. a fixture model — so it is strictly additive on top of this work, not an alternative to it.

**Chosen:** **hand-written JSON fixtures + an in-memory query model** — it is the only option that satisfies the zero-dependency principle and full determinism with no live account, while staying narrowly within FAFF-89's mandate (schema + loader) and leaving FAFF-93's injection decision open. The other two are framed as future extension points (OUT OF SCOPE): a server would wrap this model; a recorder would emit *this* schema. The fixture schema is the durable artefact in every scenario, so building it first is correct regardless of how fixtures are later authored or served.

**On-disk format — JSON vs YAML?** Options: JSON (zero-dep, verbose) vs YAML (terser, needs a parser). **Chosen:** JSON — matches the existing `test/golden/contracts/cases.json` precedent and the zero-install principle; a YAML parser is a dependency the substrate exists to avoid. *Temporal anchor:* at the time of writing, Node has no stable built-in YAML parser; revisit only if that changes and terseness becomes a real authoring pain.

**Where does the loader live, and what shape?** Options: a new top-level `tools/` dir vs under `test/helpers/`. **Chosen:** `test/helpers/mock-tracker.mjs`, beside `run-cli.mjs` — the loader is test infrastructure, ESM `.mjs`, zero-dep, exactly the established helper pattern; ADR 0002 says the test architecture is "purely repo-side tooling" under `test/`.

**Validation — library vs hand-rolled?** Options: ajv/zod (declarative, dependency) vs hand-written checks. **Chosen:** hand-written, fail-loud — preserves zero-dep and gives precise, fixture-authoring-friendly error messages keyed to the offending entity/field.

**Result mutability — share vs deep-copy?** Options: return internal refs (fast) vs deep copies (safe). **Chosen:** deep copies — determinism and test isolation outrank the negligible perf cost of small fixtures; shared refs invite cross-test state bleed.

---

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. The one genuinely-deferred decision — *how the model is injected into a running skill* — is **not** FAFF-89's to make; it is owned by FAFF-93 and recorded as a scope boundary (section 2), not a punt this spec must resolve. There are no `**Punt:**` markers: every decision within FAFF-89's mandate is closed.

**Assumptions.**

- **Assumes:** ADR 0002's runner/seam decisions are in force — `node:test`/`node:assert`, tests under `test/`, run via `node --test`, CI step present. *Validation:* `grep -n "node --test" .github/workflows/validate.yml` returns the step (confirmed at spec time: line 53), and `test/cli-next-seam.test.mjs` uses `node:test` — if either is absent, stop and reconcile with ADR 0002 before building.
- **Assumes:** the tracker-neutral state vocabulary the model mirrors (state *category* `backlog/unstarted/started/completed/cancelled`, `blockedBy`, relations, comments, labels) matches what faff's skills consume. *Validation:* `skills/faff/SKILL.md` describes reading the state-category field (`type`/`stateCategory`) and both-direction blocker links and per-issue comments — confirm those concepts still appear before finalizing field names; if the skills have moved to different field names, align the `*Result` shapes to them.
- **Assumes:** the FAFF-93 skill-run harness will consume this loader's public query API (`loadFixture` + the `TrackerModel` methods) as its fixture source. *Validation:* not checkable until FAFF-93 exists — keep the query API tracker-MCP-shaped and free of test-only coupling so FAFF-93 can wrap it unchanged. If FAFF-93's spec later demands a different surface, that is an additive change to this module, not a redesign of the fixture schema.

---

## 7. DONE — Definition of Done

### From WHY
- [ ] A skill test can load a fixture and assert seam outputs against known tracker state without any live tracker, network, or clock input.
- [ ] No `package.json`, lockfile, or third-party dependency is added; the module imports only `node:*`.
- [ ] Fixtures and results use tracker-neutral, MCP-shaped fields (no hardcoded MCP tool names, no Linear-only encodings).
- [ ] Loading the same fixture twice yields byte-identical query results in stable order.

### From WHAT (types and interfaces)
- [ ] `Fixture` JSON matches the section-3 schema (version + issues/projects/initiatives/labels/comments).
- [ ] `Issue` carries id, title, state, stateCategory, labels (names), optional priority/projectId/parentId, and `relations` (blocks/blockedBy/relatedTo).
- [ ] `Project` carries id, name, state, initiativeIds, optional priority; `Initiative` carries id, name, optional status; `Label` carries name + optional color/description; `Comment` carries id, issueId, body, fixed `createdAt`.
- [ ] `loadFixture(path|object)` returns a frozen `TrackerModel`; the module exports `loadFixture` and `FixtureError`.
- [ ] `TrackerModel` exposes `listIssues(filter?)`, `getIssue(id)`, `listProjects(filter?)`, `getProject(id)`, `listInitiatives()`, `listLabels()`, `listComments(issueId)`.
- [ ] Each `*Result` is a deep copy with relations and resolved labels ({name, color}) — the shape a skill expects back from the equivalent MCP call.

### From WHAT (decisions)
- [ ] On-disk fixture format is JSON loaded via `node:fs` + `JSON.parse`.
- [ ] The fidelity mechanism is hand-written JSON fixtures + in-memory model (no cassette, no server) — matching the `**Chosen:**` decision.

### From HOW (behaviour)
- [ ] `loadFixture` validates required fields, id/name uniqueness, and referential integrity of every FK (projectId, labels, relations, parentId, initiativeIds, comment.issueId) and throws `FixtureError` with a precise message on failure.
- [ ] `listIssues` filters by state / stateCategory / projectId / labels (labels AND-combined) and returns issues sorted by id ascending.
- [ ] `listComments(issueId)` returns that issue's comments sorted by createdAt asc then id asc.
- [ ] `getIssue`/`getProject` return `null` for unknown ids; `listComments` returns `[]` for an unknown issueId.
- [ ] The loader never reads/writes through the `faff` CLI and performs no network/clock/random access.

### From HOW (edge cases)
- [ ] The minimal valid fixture `{ "version": 1 }` loads and all list queries return `[]`.
- [ ] A fixture with a dangling reference fails at `loadFixture` time with a `FixtureError`, not at query time.
- [ ] An unknown fixture `version` is rejected with a `FixtureError`.
- [ ] Mutating a returned result does not affect a subsequent identical query (deep-copy / freeze proven).
- [ ] A fixture issue carrying a spec comment is retrievable via `listComments` such that a prep/tidy-style "has spec" check can pass off the mock (parity with the live list-comments seam).

### From scope boundaries
- [ ] No injection-into-a-running-skill, no mock MCP server, no cassette recorder, no tracker mutation/write-back, and no git/worktree fixtures are introduced (those are FAFF-93 / FAFF-90 / explicitly out of scope).

**Integration smoke test** (the "plumbing is connected" path):

```
PROCEDURE smoke:
  1. fixture := a committed test/fixtures/tracker/*.json with:
       - 2 issues: ISS-A (state "Todo", stateCategory unstarted, label "faff-automate", blockedBy [ISS-B]),
                   ISS-B (state "Done",  stateCategory completed),
       - 1 project linking ISS-A, 1 initiative, the "faff-automate" label, 1 comment on ISS-A (a spec body)
  2. model := loadFixture(absolute path to fixture)
  3. ASSERT model.getIssue("ISS-A").relations.blockedBy deep-equals ["ISS-B"]
  4. ASSERT model.listIssues({ stateCategory: "unstarted" }) returns exactly [ISS-A]
  5. ASSERT model.listComments("ISS-A") has length 1 and its body matches the fixture (has-spec path works)
  6. ASSERT model.listComments("ISS-B") deep-equals []   # empty thread, not an error
  7. ASSERT loadFixture(a fixture with issue.relations.blockedBy=["NOPE"]) throws FixtureError  # fail-loud
```

If this one test passes, the schema, loader, validation, query, ordering, and deep-copy guarantees are all connected.

---

## 8. APPENDICES

### Appendix A — Reference fixture skeleton (illustrative, JSON)

```
{
  "version": 1,
  "labels": [
    { "name": "faff-automate", "color": "#4ea7fc", "description": "automation-eligible" }
  ],
  "initiatives": [ { "id": "INIT-1", "name": "faff's skills are verified, not assumed", "status": "Active" } ],
  "projects": [ { "id": "PROJ-1", "name": "Deterministic test substrate", "state": "started", "initiativeIds": ["INIT-1"], "priority": 2 } ],
  "issues": [
    { "id": "ISS-A", "title": "Build a thing", "state": "Todo", "stateCategory": "unstarted",
      "labels": ["faff-automate"], "priority": 3, "projectId": "PROJ-1",
      "relations": { "blocks": [], "blockedBy": ["ISS-B"], "relatedTo": [] } },
    { "id": "ISS-B", "title": "Prereq", "state": "Done", "stateCategory": "completed",
      "labels": [], "projectId": "PROJ-1",
      "relations": { "blocks": ["ISS-A"], "blockedBy": [], "relatedTo": [] } }
  ],
  "comments": [
    { "id": "C-1", "issueId": "ISS-A", "body": "# Spec — ...\nconfidence: high", "createdAt": "2026-01-01T00:00:00.000Z" }
  ]
}
```

This appendix is illustrative only; the section-3 type definitions are authoritative.

---

confidence: high
