# PRD Artifact + Lifecycle — the Product-Axis Counterpart to the ADR

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: high. Full spec on Linear FAFF-252.

**Artifact:** design spec for **FAFF-252**. **Audience:** the build agent implementing the `faff prd` CLI + the PRD artifact, and reviewers. This is the **root** of the PRD/PRDR spine — it ships the durable product-requirements artifact at container altitude and the CLI to manage it, mirroring the already-shipped `faff adr` machinery and deferring admissibility (FAFF-253), born-verifiable freeze (FAFF-254), supersession (FAFF-245), and machine authoring (FAFF-251) to their tickets.

## 1. WHY — Problem and Principles

**The load-bearing model:** faff already has a **decision-axis** durable artifact — the ADR (`docs/adr/NNNN-slug.md`, the `faff adr` CLI). It has **no product-axis** counterpart. A PRD is exactly that: the durable *what & why* at **container** (initiative/project) altitude, the immutable root-ends a lights-out run is bounded by. This ticket builds the PRD artifact + `faff prd` CLI as a **structural mirror** of the ADR machinery — same storage/CLI/validation shape, different axis and altitude.

**Problem statement.** faff plans containers but attaches no durable product-requirements doc to them, so product intent is buried per-ticket and invisible to the next slice serving the same goal — and L4 has no immutable "ends" to bound a run. This adds a committed PRD artifact at container altitude plus the CLI to scaffold, list, validate, and link it.

**Design principles.**

- **Mirror the ADR, don't reinvent.** The ADR CLI/storage/validation pattern is shipped and tested; the PRD reuses its *shape*. Any divergence without a stated product-axis reason is wrong.
- **Lean, format-flexible, no rigid schema.** A PRD is the Atlassian *what/why, never how* one-pager; `prd validate` checks presence (metadata + non-empty body), **never** section conformance. Resist bloat.
- **faff consumes before it authors (level-scaled).** L1–2 **link** an existing PRD (never author — "never be the PM"); L3 **author** a lean one-pager; L4 **author+freeze**. The artifact supports all three; this ticket builds the plumbing, not the per-level enforcement gradient.
- **The CLI writes; the caller commits.** Exactly like `faff adr new`, `faff prd new` writes `docs/prd/…` and returns the path — it does **not** commit, branch, or decide *who* authors.

**Scope statement.** The root artifact + CLI of the PRD layer — every downstream slice reads or extends what this writes.

## 2. OUT OF SCOPE

- **PRD-admissibility gate.** Why: FAFF-253. Extension point: a future `faff prd validate --admissible` / a `prd-readiness` contract over this artifact.
- **Born-verifiable stop-conditions + L4 freeze *enforcement*.** Why: FAFF-254. Extension point: the `Status: Frozen` field + `## Acceptance criteria` exist here as plumbing; FAFF-254 makes them machine-checkable + enforces immutability.
- **PRDR supersedable decomposition.** Why: FAFF-245 / `design/prdrs.md`. Extension point: the PRD is the root; PRDRs cite it. No supersession here (a PRD is 1-per-container and decays; PRDRs fix decay).
- **Machine/loop authoring (L3 propose / L4 self-define).** Why: FAFF-251. Extension point: `faff prd new` is the write primitive a machine author later drives.
- **Authoring host + commit orchestration** — *who* calls `faff prd new`, *when*, and *how* it's committed. Why: a genuine open product question + the same CLI-writes/orchestrator-commits separation the ADR has. Extension point: `design/planning-loop.md` + FAFF-251.
- **Intake PRD-as-input adapter.** Why: an input adapter, not where PRDs live. Extension point: a future `intake` adapter reads this artifact.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| **PRD** | A durable product-requirements doc (*what & why*) bound to one tracker **container** (initiative or project). |
| **Container** | An initiative or project — the altitude a PRD attaches to (a spec attaches to an issue). |
| **PRD mode** | `linked` (consume external PRD) or `authored` (faff-written repo markdown). |
| **PRD status** | `Draft` / `Active` / `Frozen` / `Stale` — the living→frozen lifecycle field. |

```
ENUM PrdMode:   linked | authored
ENUM PrdStatus: Draft | Active | Frozen | Stale   # Frozen-enforcement is FAFF-254

RECORD Prd:
  container_id: String        # the initiative/project id this PRD governs (1:1)
  container_slug: String      # filename key — kebab of the container name
  mode: PrdMode
  status: PrdStatus = Draft
  date: Date                  # "as-scoped on"
  url: String?                # set IFF mode == linked
  body: Markdown?             # set IFF mode == authored
  CONSTRAINT mode == linked   => url present, body absent
  CONSTRAINT mode == authored => body present (file on disk), url absent
  CONSTRAINT one PRD per container_id  (filename keyed by slug, not a global number)
```

**On-disk form (authored mode).** `<prd_docs_path>/<container-slug>.md` — keyed by **container slug, not an ADR-style global number** (one PRD per container; supersession is PRDRs' job). Metadata header mirrors the ADR's, then the lean Atlassian body:

```markdown
# PRD — <container name>

- **Container:** <initiative|project> <container-id>
- **Status:** Draft | Active | Frozen | Stale
- **Date:** YYYY-MM-DD  (as-scoped on)
- **Mode:** authored

## Problem / objective
## Goals & success metrics
## Non-goals
## Users
## Requirements            _(MoSCoW or P0/P1/P2; lean)_
## Acceptance criteria     _(release/done — born-verifiable enforcement is FAFF-254)_
## Open questions
```

**CLI surface — `faff prd` (mirror `faff adr`).**

```
faff prd path <container>                 # resolve <prd_docs_path>/<slug>.md
faff prd new  <container> [--title T] [--date D] [--status S]   # scaffold authored PRD -> prints path
faff prd link <container> --url <URL>     # linked mode: record an external PRD line for the container
faff prd list [--json]                    # container / status / date / mode / path-or-url
faff prd validate                         # lenient: metadata present (Container/Status/Date), body non-empty
```

`new` refuses to overwrite an existing file (append-only safety, like `adr`).

**Design decisions.**
- **Filename key:** **Chosen** per-container slug (`docs/prd/<container-slug>.md`), not a global `NNNN` — one PRD per container; supersession is PRDRs' job.
- **Storage:** **Chosen** committed `docs/prd/` via a new `tracking.prd_docs_path` (mirroring `spec_docs_path`'s resolver + default rule). Rejected `.faff/prd/` (ephemeral), tracker-only.
- **Container-link mechanism:** **Chosen** the PRD metadata cites `Container: <id>`; `link`/`new` emit a `**PRD:** <path-or-url>` line for the container description. **Assumes** the tracker MCP can edit a container description (the CLI emits the line; the caller applies it — degrade-not-fail).
- **Granularity:** **Chosen** any container altitude — `<container>` is an initiative **or** project id.

## 4. HOW — Behavior

A new `cmdPrd`, structurally cloned from `cmdAdr`: `prdDir()` (resolve `tracking.prd_docs_path`, default `docs/prd/`), `prdSlug(name)` (kebab), `prdTemplate(...)`, `prdValidate()` (lenient), `listPrds()`, plus `prd link`/`prd path` (the container-axis additions). Deterministic, dependency-free.

```
PROCEDURE prd_new(container, opts):
  1. slug := prdSlug(container);  dir := prdDir()
  2. path := dir/<slug>.md
  3. IF path exists -> ERROR "PRD exists; edit in place" (exit 1)   # append-only safety
  4. write prdTemplate(container, date := opts.date||today, status := opts.status||Draft, mode := authored)
  5. print path  (and the "**PRD:** <path>" line for the caller to apply to the container)

PROCEDURE prd_link(container, url):
  1. emit a "**PRD:** <url>" line for the container description (idempotent by the caller)
  2. the CLI itself makes NO tracker call — it prints the line; the orchestrator applies it (degrade-not-fail)

PROCEDURE prd_validate():
  FOR each docs/prd/*.md: check metadata (Container, Status in enum, Date ISO) + >=1 non-empty "## " section
  exit 0 if all pass; exit 1 listing offenders   # NEVER checks which sections — format-flexible
```

**Edge cases.**
- No `docs/` dir -> `prdDir()` follows the `spec_docs_path` default rule (create `docs/`, use `docs/prd/`).
- `prd new` on existing PRD -> error, never overwrite.
- `linked` + `authored` for one container -> `validate` flags it; url/body mutually exclusive.
- `Status: Frozen` -> recorded, **not enforced** (FAFF-254 enforces).

**Failure mode.** The container-link relies on the orchestrator editing a container description. The CLI emitting the line (never calling the tracker itself) keeps it degrade-not-fail: the committed file half always ships; the link is a printed line the caller applies.

**Anti-patterns.** Enforcing a rigid section schema in `validate` (re-inflates bloat). Committing inside `prd new` (orchestrator-agnostic like `adr new`).

## 5. Scenarios

```
Given a container with no PRD
When `faff prd new <container>` runs
Then docs/prd/<slug>.md is created from the lean template and its path printed; running it again errors without overwriting
```
```
Given an external PRD URL
When `faff prd link <container> --url <URL>` runs
Then it prints a "**PRD:** <URL>" line for the container and exits 0 (the CLI makes no tracker call)
```
```
Given a docs/prd/ PRD missing its Status field
When `faff prd validate` runs
Then it exits 1 naming the missing metadata — but never flags which "## " sections are present (format-flexible)
```

Assertion: `faff prd` introduces **no** change to existing `faff adr` / spec behaviour — additive sibling.

## 6. Design Decision Rationale

- **Filename key.** Global `NNNN` vs per-container slug -> **Chosen** per-container slug (one PRD per container; supersession is PRDRs').
- **Storage.** **Chosen** `docs/prd/` via `tracking.prd_docs_path`. Rejected `.faff/` (ephemeral), tracker-only.
- **CLI shape.** **Chosen** mirror `faff adr` — `path`/`new`/`list`/`validate` + container-axis `link`; drop `next-number` (no series) + `supersede` (PRDRs).
- **Validate strictness.** **Chosen** lenient presence, never section conformance.
- **Container link.** **Chosen** the CLI emits a `**PRD:**` line; the caller applies it (degrade-not-fail). Rejected a faff-side container store.
- **Granularity.** **Chosen** any container altitude.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. (Authoring host + commit orchestration is deliberately **out of scope** — §2 — not punted; the CLI is orchestrator-agnostic exactly as `faff adr` is.)

**Assumptions.**
- **Assumes** the tracker MCP can **edit a container (project/initiative) description** (Linear `save_project`/`save_initiative`) — but the CLI never depends on it: it emits the `**PRD:**` line for the caller. *Validate:* confirm before wiring an orchestrator that applies the line.
- **Assumes** the shipped **`faff adr` machinery** (`bin/faff` `cmdAdr`) is the code blueprint — `prd*` parallels `adr*`.
- **Assumes** the **`resolveSpecDocsPath` resolver + default rule** is reusable for `prd_docs_path`.

## 8. DONE — Definition of Done

### From WHY
- [ ] A container can carry a durable PRD (committed `docs/prd/<slug>.md` or a printed link line); existing `faff adr`/spec behaviour unchanged (additive sibling).

### From WHAT (config + storage)
- [ ] `tracking.prd_docs_path` is a recognised key (added to `TRACKING_KEYS`), default `docs/prd/` via the `spec_docs_path`-style resolver.
- [ ] On-disk PRD has the metadata header (`Container`/`Status`/`Date`/`Mode`) + lean Atlassian sections; `PrdMode`/`PrdStatus` as specified.
- [ ] Filename keyed by container slug (`<slug>.md`), one per container.

### From WHAT/HOW (CLI)
- [ ] `faff prd path <container>` prints the resolved path.
- [ ] `faff prd new <container>` scaffolds + prints the path; **errors without overwriting**.
- [ ] `faff prd link <container> --url <URL>` prints the `**PRD:**` line; exit 0; makes no tracker call.
- [ ] `faff prd list [--json]` lists container/status/date/mode/path-or-url.
- [ ] `faff prd validate` checks metadata presence + non-empty body (exit 0/1); **never** checks section shape.

### From HOW (edge cases)
- [ ] `Frozen` recorded but not enforced (→ FAFF-254).
- [ ] `prd new` never overwrites; `validate` flags url+body collision.
- [ ] `faff prd --selftest` covers new/list/validate/link/path + the no-overwrite + collision cases.

**Integration smoke test.**
```
1. faff prd new <container>        -> creates docs/prd/<slug>.md, prints path, exit 0
2. faff prd new <container>        -> exit 1 (no overwrite)
3. faff prd validate              -> exit 0; remove Status line -> exit 1 naming the file
4. faff prd list --json           -> one entry, mode=authored, status=Draft
5. faff prd link <c> --url U       -> prints "**PRD:** U", exit 0
```
