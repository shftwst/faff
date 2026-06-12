# FAFF-93 — Skill-run harness: drive a skill in test mode, capture decisions

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Source: Linear FAFF-93.

> **Revised on 2026-06-11** — live-driver punt resolved with the human: **spike-first on (a)** (spike filed as FAFF-122) and the live path runs **local/on-demand only, never CI-gating**. Rating bumped medium → high.

This is the buildable nlspec for **FAFF-93 — Skill-run harness**, the headline mechanism of the *"Skill-behaviour harness"* project under the *"faff's skills are verified, not assumed"* initiative. Audience: the build agent implementing the harness, and the human reviewers gating the PR. It builds on **ADR 0002** (`docs/adr/0002-skill-test-architecture.md`) and consumes the two just-spec'd siblings it is blocked-by: **FAFF-89** (mock-tracker model, `test/helpers/mock-tracker.mjs`) and **FAFF-90** (seeded-repo, `test/helpers/seed-repo.mjs`). It produces the **captured decision record**; the *assertion model* over that record is **FAFF-95**, and the *first end-to-end test* (candidate faff-tidy) is **FAFF-94** — both consume this. The record shape is the explicit seam between FAFF-93 and FAFF-95 and is defined concretely below.

**This spec's one substantive product punt — the live-LLM driver mechanism — was resolved on 2026-06-11** (spike-first on (a), spike FAFF-122; CI policy local/on-demand only) and the spec is rated **high** accordingly (see OPEN QUESTIONS → Resolved). FAFF-93 ships the deterministic plumbing FAFF-94/95 build on regardless of how the spike lands.

---

## 1. WHY — Problem and Principles

**Problem statement.** faff's behaviour is **prose run by an LLM agent** that fetches tracker state via MCP, shells the `faff` CLI, and then decides (buckets, ordering, routing verdicts, tracker mutations) — so today there is *no* way to assert "given this backlog + repo, the skill produced that decision," because an LLM run is not reproducible and its decisions surface as free-text. FAFF-89 and FAFF-90 built the two halves of a deterministic substrate but **both explicitly deferred to FAFF-93 the question of how that substrate reaches a running skill** and how the skill's decisions are captured. FAFF-93 delivers that missing piece: a harness that **injects** the substrate into a skill run, **drives** the skill in a test mode, and **captures** its decisions at the deterministic seams into a structured, assertable **decision record**.

**Design principles.**

**The CI-gating path must stay zero-dependency, offline, and deterministic — a live LLM never gates CI.** ADR 0002's runner decision is zero-install `node:test`, no network, no key, reproducible. A live LLM in CI needs an API key, network, tokens, and is non-deterministic — it cannot be the thing `node --test` gates on. Therefore the harness's *default, CI-gating* path drives a **scripted/fake agent** (a deterministic stand-in that replays a fixed sequence of seam actions) and asserts the captured record; the *live-LLM* driver path is **local/on-demand only — it never runs in CI** (resolved 2026-06-11; see OPEN QUESTIONS → Resolved). **Anti-pattern:** making `node --test` invoke a live model. Why: it reintroduces exactly the network/key/flakiness/cost the zero-install decision exists to kill, and a flaky CI gate is worse than no gate.

**Capture binds to deterministic seams, never to prose (ADR 0002 §1, inherited).** The record captures only the structured, reproducible artefacts a run emits — CLI invocations (args/stdout/exit), tracker reads served, tracker mutations *attempted*, routing verdicts, bucket membership, rendering-adaptor invocations. Free-text narrative is **never** a captured field a test asserts on. **Anti-pattern:** recording the agent's prose reasoning as an assertable field. Why: it is non-reproducible across runs and re-introduces the exact problem ADR 0002 resolved.

**The harness owns capture + injection + driving; it owns no assertion vocabulary and no decision opinion.** FAFF-93 produces the record; **FAFF-95** owns the matchers (bucket/ordering/verdict/mutation). The harness must not bake in what a "correct" decision is, nor any ordering/priority/sizing opinion (gateway: the orchestration layer owns no ordering opinion — that is the methodology's). It is a recorder, not a judge. **Anti-pattern:** the harness asserting "tidy promoted the right issue." Why: that is FAFF-95's matcher layer reading FAFF-93's record; conflating them couples the mechanism to one skill's semantics.

**Driver-agnostic by construction.** The harness drives a skill through a small **driver interface**; the scripted/fake driver (default) and any future live driver are interchangeable occupants of that interface, producing the *same* record shape. This is what lets FAFF-93 ship and be tested now while the live driver follows the FAFF-122 spike. **Anti-pattern:** hardwiring the Claude Agent SDK / `claude -p` into the harness core. Why: it would couple the reusable plumbing to one key/network-dependent choice and block FAFF-94/95 on it.

**Injection-faithful to the live seam.** In production a skill fetches tracker state via the configured MCP and shells the real `faff` CLI against the real repo. The harness must inject the FAFF-89 model at the **agent↔MCP** boundary (the agent's tracker reads/writes are served from / recorded against the model) and point the CLI at the FAFF-90 seeded repo (real `faff` binary, `--root`/`cwd`), so a captured run exercises the *same* seams as production — not a fiction.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `docs/adr/0002-skill-test-architecture.md` | Markdown (ADR) | Parent: assert-at-seam, `node:test` zero-dep, `test/` layout, and the very punt this spec resolves ("skill-decision capture … structured-output vs transcript scrape vs dedicated test-mode"). |
| `test/helpers/mock-tracker.mjs` (FAFF-89) | ESM, `node:*` only | The tracker half: `loadFixture(path\|obj) -> TrackerModel` with `listIssues/getIssue/listProjects/getProject/listInitiatives/listLabels/listComments`. The harness serves the agent's tracker reads from this and records mutations against it. |
| `test/helpers/seed-repo.mjs` (FAFF-90) | ESM, `node:*` only | The repo half: `seedRepo(spec) -> { root, worktreePath, teardown }`. The harness passes `root` as the CLI's `--root`/cwd. |
| `test/helpers/run-cli.mjs` (FAFF-91) | ESM, `node:child_process` | The established CLI seam: `runCli(args, {cwd,input}) -> { stdout, stderr, code }`, faffBin = `plugin/skills/faff/bin/faff`. The harness's scripted driver and the real-CLI capture reuse this. |
| `test/cli-next-seam.test.mjs` (FAFF-88) | ESM, `node:test` | The reference fixture this generalises: a fixed flag-state → `faff next` → assert the structured verdict token (never the prose reason). The `*.test.mjs` + `node:test` style to match. |
| `plugin/skills/faff/bin/faff` (`next`/`state`/`eligible`/`contract`) | Node, zero-dep | Pure flag-driven functions, **no MCP** — these CLI invocations are themselves prime deterministic seams the harness records. |
| `plugin/skills/faff/SKILL.md` (Agent Lanes; "Next-step transition — consult `faff next`"; "Always pull fresh") | Markdown | Defines the live seams: the agent maps fetched tracker state → flags then calls `faff next`; consults MCP for reads/mutations; routes human-facing output through `rendering_adaptor`. The record mirrors these. |

**Scope statement.** FAFF-93 is the **runner** of the test substrate — it sits under `test/` beside the FAFF-89/90/91 helpers, composes them, and emits the decision record that FAFF-94 (first e2e test) and FAFF-95 (assertion model) and FAFF-97 (rendering-routing assertion) all consume. No new `faff` subcommand, `.faffrc` key, or `.faff/` artefact (consistent with ADR 0002's "purely repo-side tooling").

---

## 2. OUT OF SCOPE

- **The assertion / matcher model over the record.** — Bucket-membership, ordering, routing-verdict, and mutation *matchers* (the `expectBucket(...)` / `expectMutation(...)` vocabulary). **Why excluded:** that is FAFF-95's deliverable; FAFF-93 produces the record, FAFF-95 asserts on it. **Extension point:** FAFF-95 imports the `DecisionRecord` shape (section 3) and builds matchers that read its fields; FAFF-93 must therefore make the record shape stable and documented.
- **The first actual end-to-end behavioural test (candidate faff-tidy).** — A real captured run of a real skill with real expected decisions. **Why excluded:** that is FAFF-94's proof-of-mechanism; FAFF-93 is the mechanism. **Extension point:** FAFF-94 calls `runSkill(...)` (section 3) with a tidy fixture + seeded repo and asserts via FAFF-95 matchers. FAFF-93's own self-test uses a *scripted* driver, not a real skill.
- **The live-LLM driver implementation itself.** — A working Claude-Agent-SDK / `claude -p` driver that actually executes skill prose against the substrate. **Why excluded:** the direction is resolved (spike-first on (a)) but the implementation follows the **FAFF-122 spike**, which measures flakiness/cost/fidelity before the live-driver ticket is cut. **Extension point:** the `SkillDriver` interface (section 3) is the seam the live driver implements later; FAFF-93 ships the interface + a deterministic scripted driver, not the live one.
- **Rendering-output golden assertions / rendering-adaptor conformance.** — Asserting the *content* of rendered output. **Why excluded:** FAFF-97 asserts that skills *route through* the rendering pass; FAFF-96 owns goldens. FAFF-93 only **records that a rendering-adaptor invocation seam occurred** (so FAFF-97 can assert on it). **Extension point:** FAFF-97 reads `record.renderings` (section 3); FAFF-96 diffs rendered bodies.
- **Modelling tracker mutation side-effects (write-back to the fixture).** — Making `save_issue`/status-move actually mutate the FAFF-89 model so later reads in the same run see the change. **Why excluded:** ADR 0002 asserts mutations at the *seam* (the attempted call args), and FAFF-89 declared its model read-only; v1 records the *attempt* and does not re-serve mutated state. **Extension point:** a future opt-in "mutation-applying" wrapper around the model if a multi-step skill test needs read-after-write; the record already carries the attempted mutations to drive it.
- **A new `faff` subcommand or `--test-mode` flag on the CLI.** — A CLI-level test mode. **Why excluded:** the CLI is already a pure, deterministic, capturable seam (`run-cli.mjs` proves it); test-mode belongs to the *agent driver*, not the CLI. **Extension point:** none needed — the CLI seam is captured as-is.
- **CI wiring of FAFF-94's tests into `validate.yml`.** — Adding/altering the CI step. **Why excluded:** ADR 0002 already added the bare `node --test` step (verified: `.github/workflows/validate.yml` line 53), which auto-discovers any new `test/*.test.mjs` — FAFF-93's self-test is picked up automatically with no workflow edit. **Extension point:** none for the live path either — the live driver runs local/on-demand only and never enters CI (resolved 2026-06-11).

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Skill run | One execution of a faff skill (e.g. faff-tidy) against a fixed substrate, driven by the harness, producing one decision record. |
| Driver | The pluggable component that actually *executes* the skill to produce seam actions. The default is the **scripted driver**; a **live driver** is the opt-in occupant. |
| Substrate | The fixed inputs to a run: a FAFF-89 `TrackerModel` (tracker state) + a FAFF-90 seeded repo (`{root,…}`) + run config (which skill, which flags). |
| Seam | A deterministic, structured action a run emits: a tracker read, an attempted tracker mutation, a CLI invocation, a routing verdict, a bucket assignment, or a rendering-adaptor invocation. (ADR 0002 §1.) |
| Decision record | The structured, ordered capture of every seam a run emitted — the FAFF-93→FAFF-95 contract. Free-text-free. |
| Scripted driver | A deterministic stand-in for the LLM: it consumes a fixed **script** (an ordered list of seam actions to take) and performs them against the injected substrate, producing a record. The default CI driver. |
| Live driver | A driver that points a real headless agent at the substrate, capturing the seams it actually emits. Local/on-demand only, key/network-dependent, never CI-gating. (Direction resolved: spike-first on (a) — FAFF-122; see OPEN QUESTIONS → Resolved.) |
| Tracker port | The injected object the driver uses for all tracker reads/writes — backed by the FAFF-89 model for reads, recording every write as an attempted mutation. The agent↔MCP boundary, faithfully stood in. |

**Type definitions.** The **decision record** is the load-bearing contract (FAFF-93→FAFF-95). All fields are plain JSON-serialisable values; no clock/random; ordering is capture order (a monotonically increasing `seq`). Field names are tracker-neutral (gateway: faff is tracker-agnostic).

```
RECORD DecisionRecord:                 # the FAFF-93 -> FAFF-95 contract; one per skill run
  skill: String                        # e.g. "faff-tidy" — which skill was driven
  driver: "scripted" | "live"          # which driver produced this record (provenance)
  trackerReads:   List<TrackerRead>    # every read the run served from the FAFF-89 model, in order
  mutations:      List<Mutation>       # every tracker write ATTEMPTED (not applied), in order
  cliCalls:       List<CliCall>        # every `faff` CLI invocation, in order
  verdicts:       List<Verdict>        # routing verdicts the run asserted (e.g. faff next results it acted on)
  buckets:        Map<String, List<String>>  # bucket name -> ordered issue ids (e.g. "ready" -> ["FAFF-1",...])
  renderings:     List<Rendering>      # rendering-adaptor invocations (FAFF-97 asserts routing-through)
  seamLog:        List<SeamEvent>      # the unified, ordered superset (every seam with a `seq`) — the source of truth

  CONSTRAINT every list ordered by seq ascending; seq unique across the whole record
  CONSTRAINT no field contains free-text agent reasoning that a matcher would assert on

RECORD SeamEvent:                      # the unified ordered log; the typed lists above are views over it
  seq: Int                             # 0-based, monotonic, assignment order — the only ordering source
  kind: "trackerRead" | "mutation" | "cliCall" | "verdict" | "bucket" | "rendering"
  payload: Object                      # one of the typed records below, by kind

RECORD TrackerRead:
  seq: Int
  method: String                       # neutral verb: "listIssues" | "getIssue" | "listComments" | "listProjects" | ...
  args: Object                         # the filter/id passed (e.g. { stateCategory: "unstarted" })
  resultCount: Int                     # number of entities returned (NOT the full bodies — keeps records small & stable)

RECORD Mutation:                       # an ATTEMPTED tracker write — recorded, not applied (v1)
  seq: Int
  op: String                           # neutral op: "setStatus" | "addLabel" | "removeLabel" | "addComment" | "createIssue"
  issue: String?                       # target issue id (null for createIssue)
  args: Object                         # op-specific, e.g. { status: "Todo" } | { label: "faff-automate" } | { body: "..." }

RECORD CliCall:
  seq: Int
  argv: List<String>                   # the args after `faff`, e.g. ["next","--status","todo","--spec","high"]
  stdout: String                       # captured verbatim (structured CLI output — JSON for next/state)
  exit: Int                            # exit code
  # cwd/root is the seeded-repo root, set by the harness; not duplicated per-call

RECORD Verdict:                        # a routing decision the run acted on (e.g. the `faff next`/automation-routing token)
  seq: Int
  issue: String
  token: String                        # e.g. "graft" | "prep" | "skip-ineligible" | "needs-decision-first" | "gap-blocked"
  source: String                       # "faff next" | "automation-routing" | ... — where the token came from

RECORD Rendering:                      # records THAT a rendering-adaptor invocation happened (FAFF-97 asserts routing)
  seq: Int
  surface: String                      # what was rendered, e.g. "tidy-report" | "wtf-briefing"
  # body is NOT asserted here (that's FAFF-96 goldens); presence + surface is the FAFF-97 seam

RECORD RunConfig:                      # the harness input
  skill: String                        # which skill to drive
  tracker: TrackerModel                # a loaded FAFF-89 model (loadFixture(...))
  repo: SeededRepo                     # a FAFF-90 seedRepo(...) result ({ root, worktreePath, teardown })
  driver: SkillDriver                  # defaults to the scripted driver; a live driver is opt-in
  flags: Object?                       # optional skill-invocation flags (skill-specific; opaque to the harness)
```

**Interfaces.** Public ESM exports of `test/helpers/skill-harness.mjs` (sibling to `run-cli.mjs`, `mock-tracker.mjs`, `seed-repo.mjs`). Zero-dep, `node:*` + the sibling helpers only.

```
INTERFACE test/helpers/skill-harness.mjs   # ESM, node:* + sibling helpers only

  EXPORT runSkill(config: RunConfig): DecisionRecord
    # Wires the tracker port (reads -> config.tracker; writes -> recorded mutations) and the CLI seam
    # (cwd/--root -> config.repo.root), invokes config.driver with that injected context, and returns
    # the assembled, frozen DecisionRecord. Synchronous for the scripted driver; a live driver may be async
    # (runSkill returns a Promise when config.driver is async — see the driver interface).

  EXPORT scriptedDriver(script: List<ScriptAction>): SkillDriver
    # The default, deterministic driver. `script` is an ordered list of seam actions; the driver performs
    # each against the injected context (reads via the tracker port, CLI via runCli against repo.root,
    # mutations/verdicts/buckets/renderings recorded). No LLM, no network — pure replay.

  EXPORT makeRecorder(): Recorder        # internal-ish helper FAFF-95 may reuse; assigns seq, builds views from seamLog

  INTERFACE SkillDriver:                  # the pluggable execution seam (scripted now; live later)
    drive(ctx: DriverContext): void | Promise<void>
      # ctx gives the driver: ctx.tracker (read API over the model), ctx.cli(argv) (runs faff in the seeded repo),
      # ctx.record (a Recorder: recordMutation/recordVerdict/recordBucket/recordRendering),
      # and ctx.config (skill, flags). The driver's job is to PRODUCE seams; the harness assembles the record.

  INTERFACE ScriptAction:                 # one entry in a scripted driver's script
    A tagged union mirroring the seam kinds:
      { read:   { method, args } }                 -> performs the tracker read (served from the model), records it
      { cli:    [ ...argv ] }                      -> runs faff in the seeded repo, records the CliCall
      { mutate: { op, issue?, args } }             -> records an attempted Mutation (not applied)
      { verdict:{ issue, token, source } }         -> records a Verdict
      { bucket: { name, issues: [...] } }          -> records a bucket assignment
      { render: { surface } }                      -> records a Rendering
```

**Design decisions (resolved inline; full rationale in section 5).**

- **The drive/capture mechanism — the ADR 0002 punt, this spec's centrepiece.** **Chosen:** FAFF-93 ships the **capture-record shape + harness skeleton + injection wiring + a deterministic scripted driver** as the **default, CI-gating path**, and defines a **`SkillDriver` seam** behind which a live-LLM driver plugs in later. (Landing zone (d) of the brief; full framing in section 5.) **Chosen (2026-06-11, human decision):** the live-driver direction is **spike-first on (a)** — **FAFF-122** prototypes a live headless agent driving faff-tidy over the substrate to measure flakiness/cost/fidelity before the live-driver ticket is cut — and the live path runs **local/on-demand only, never as a CI job** (no secrets, no CI token spend; the scripted driver remains the sole `node --test` gate).
- **Capture granularity — record IDs/counts, not full entity bodies.** **Chosen:** `TrackerRead` records `method`/`args`/`resultCount` (not the returned bodies) and `Rendering` records `surface` (not the body). The record stays small, stable, and diff-reviewable; full bodies live in the fixture (FAFF-89) and goldens (FAFF-96), so duplicating them in the record invites drift.
- **Mutations are recorded as *attempts*, not applied.** **Chosen:** v1 records the attempted write at the seam and does **not** mutate the FAFF-89 model (which is read-only by its own spec). Asserting "the skill *tried* to set status Todo" is the ADR-0002 seam; read-after-write is an explicit OUT OF SCOPE extension.
- **One unified `seamLog` is the source of truth; the typed lists are views.** **Chosen:** every seam gets a single monotonic `seq` in one log, and `trackerReads`/`mutations`/`cliCalls`/etc. are filtered projections of it — so cross-seam ordering (did the CLI call happen *before* the verdict?) is always recoverable and there is one ordering authority.
- **Location & shape: `test/helpers/skill-harness.mjs`, zero-dep, composes the siblings.** **Chosen:** beside the existing helpers, ESM, importing only `node:*` + `mock-tracker.mjs`/`seed-repo.mjs`/`run-cli.mjs` — matching ADR 0002's "purely repo-side tooling under `test/`."

---

## 4. HOW — Behavior

**Architecture and approach.** One new module, `test/helpers/skill-harness.mjs`, plus a self-test `test/skill-harness.test.mjs`. `runSkill(config)` is the entry point. It builds a **DriverContext** that injects the two substrate halves at their faithful seams — tracker reads/writes go through a **tracker port** backed by the FAFF-89 `TrackerModel`; CLI calls go through `runCli` with `cwd`/`--root` set to the FAFF-90 `repo.root` — then hands that context to the configured **driver**. The driver (scripted by default) executes and emits seams via the context's **recorder**; the recorder assigns each a monotonic `seq` into the unified `seamLog` and the harness assembles the typed views into a frozen `DecisionRecord`. The default driver is a deterministic script replay — no LLM, no network — so the whole CI-gating path is reproducible under `node --test`. A live driver implements the same `SkillDriver.drive(ctx)` seam and is selected only when a test opts in (env-gated, local/on-demand only), producing the *same* record shape.

This mirrors the live system exactly: the gateway says *"the agent maps fetched tracker state → flags, then calls `faff next`"* and consults the MCP for reads/mutations and routes human output through the rendering adaptor. The harness stands in the FAFF-89 model for the MCP and the real `faff` CLI against the FAFF-90 repo — the *same* seams, captured.

**Behavior summary (runSkill):** wire the substrate into a driver context, run the driver, assemble and freeze the ordered decision record.

```
PROCEDURE runSkill(config):
  1. recorder := makeRecorder()                       # owns the seamLog + seq counter
  2. trackerPort := makeTrackerPort(config.tracker, recorder)
        # read methods delegate to the FAFF-89 model AND recorder.recordRead(method,args,resultCount)
        # write methods (setStatus/addLabel/.../addComment/createIssue) ONLY recorder.recordMutation(...) (not applied)
  3. cli := (argv) => {                                # the CLI seam, pinned to the seeded repo
        r := runCli(argv, { cwd: config.repo.root })   # real faff binary, real repo
        recorder.recordCli(argv, r.stdout, r.code)
        RETURN r
     }
  4. ctx := { tracker: trackerPort, cli, record: recorder.publicApi(), config: { skill, flags } }
  5. result := config.driver.drive(ctx)               # scripted = sync; live = may return a Promise
  6. IF result is a Promise: AWAIT it                  # runSkill returns a Promise in that case
  7. RETURN Object.freeze(recorder.assemble(config.skill, config.driver.kind))
        # assemble: build typed views (trackerReads/mutations/cliCalls/verdicts/buckets/renderings)
        # by filtering seamLog; set skill + driver provenance; freeze
```

**Behavior summary (scriptedDriver):** deterministically perform a fixed list of seam actions against the injected context — the default CI driver, standing in for the LLM.

```
PROCEDURE scriptedDriver(script).drive(ctx):
  FOR action IN script (in order):
    MATCH action:
      { read:   {method,args} }      -> ctx.tracker[method](args)          # served + recorded by the port
      { cli:    argv }               -> ctx.cli(argv)                       # run + recorded
      { mutate: {op,issue,args} }    -> ctx.record.recordMutation(op,issue,args)
      { verdict:{issue,token,source}}-> ctx.record.recordVerdict(issue,token,source)
      { bucket: {name,issues} }      -> ctx.record.recordBucket(name,issues)
      { render: {surface} }          -> ctx.record.recordRendering(surface)
  # purely deterministic; no clock/random/network. drive() is synchronous. kind == "scripted".
```

```
PROCEDURE makeRecorder():                              # the seq/seamLog authority
  state: seamLog := [], seq := 0
  recordX(...) for X in {Read,Mutation,Cli,Verdict,Bucket,Rendering}:
     push { seq: seq++, kind, payload } onto seamLog
  assemble(skill, driverKind):
     RETURN {
       skill, driver: driverKind,
       seamLog,
       trackerReads: seamLog.filter(kind==trackerRead).map(payload),
       mutations:    seamLog.filter(kind==mutation).map(payload),
       cliCalls:     seamLog.filter(kind==cliCall).map(payload),
       verdicts:     seamLog.filter(kind==verdict).map(payload),
       renderings:   seamLog.filter(kind==rendering).map(payload),
       buckets:      reduce(seamLog.filter(kind==bucket), {} , (m,e)=> m[e.name]=e.issues),
     }
```

**The live-driver seam (deferred implementation, defined interface).** A live driver implements `drive(ctx)` by pointing a real headless agent at the substrate: it must serve the agent's tracker reads/writes through `ctx.tracker` (so they are recorded) and route the agent's `faff` invocations through `ctx.cli` (so they hit the seeded repo and are recorded), then call `ctx.record.*` for the verdicts/buckets/renderings it extracts. *How* it does that — SDK tool-interception vs transcript scrape vs an in-prose structured-output block — is what the **FAFF-122 spike** measures (section 5 / OPEN QUESTIONS → Resolved). FAFF-93 ships the interface and a scripted occupant; it does **not** ship a live occupant.

**Edge cases and error handling.**
- **Unknown tracker read method.** The tracker port only exposes the FAFF-89 model's methods (`listIssues`/`getIssue`/`listProjects`/`getProject`/`listInitiatives`/`listLabels`/`listComments`). A driver calling an unknown method is a **terminal** `HarnessError` — fail loud, not a silent empty result. (Mirrors the fail-loud ethos of the sibling loaders.)
- **CLI non-zero exit.** Recorded verbatim (`exit` ≠ 0 in the `CliCall`) and **not** thrown — a skill legitimately observes a non-zero `faff` exit and decides on it; the record carries it for the matcher to assert. (The CLI seam is observational, like `faff next`'s reference fixture.)
- **Empty record.** A driver that emits no seams yields a `DecisionRecord` with empty lists and `{}` buckets — valid, not an error (mirrors a skill that read nothing). FAFF-95 decides whether empty is an assertion failure.
- **Async live driver.** If `driver.drive` returns a Promise, `runSkill` returns a Promise; the scripted default is synchronous so FAFF-94/95's CI tests stay synchronous and key-free.
- **Determinism of the default path.** With the scripted driver, the *only* inputs are the fixture, the seeded repo, and the script — all fixed — and the real `faff` CLI is itself deterministic; so the record is byte-identical across runs (modulo the seeded-repo temp-root path inside any captured CLI stdout, which the FAFF-90 spec already isolates).
- **Teardown.** `runSkill` does **not** own repo teardown; the test that called `seedRepo` registers `t.after(repo.teardown)` (per FAFF-90). The harness allocates nothing else needing cleanup.
- **Error categories.** Driver-misuse (unknown read method, malformed script action) is **terminal** `HarnessError` at run time. A skill/CLI returning a non-zero exit or empty result is **not** an error — it is recorded data. Nothing here is retryable; nothing touches network on the default path.

**Anti-pattern:** capturing the agent's free-text reasoning into an assertable record field. Why: non-reproducible across runs — re-introduces the exact problem ADR 0002 §1 resolved by asserting at seams.

**Anti-pattern:** letting the default `node --test` path invoke a live model. Why: keys/network/tokens/flakiness — the scripted driver is the CI gate; the live driver is local/on-demand only and never enters CI.

**Anti-pattern:** the harness deciding whether a captured decision is *correct*. Why: that is FAFF-95's matcher layer reading this record; baking judgement in couples the mechanism to one skill's semantics and to an ordering opinion the orchestration layer must not hold (gateway).

**Anti-pattern:** applying recorded mutations back onto the FAFF-89 model in v1. Why: the FAFF-89 model is read-only by its own spec, and ADR 0002 asserts mutations at the *attempt* seam; read-after-write is a deliberate deferred extension.

---

## 5. DESIGN DECISION RATIONALE

**Which drive/capture mechanism? (The ADR 0002 punt — the centrepiece.)**

ADR 0002 §"Open (handed downstream)" hands FAFF-93/95 the *"skill-decision capture for full skill-level tests — structured-output mode vs transcript scrape vs dedicated test-mode."* The unresolved crux is the **driver**: an LLM run is non-reproducible, yet the CI gate must be zero-dep, offline, and deterministic. Four landing zones:

- **(a) Live headless agent** (Claude Agent SDK / `claude -p`) pointed at the substrate, capturing seams. *Pros:* highest fidelity — it actually runs the prose. *Cons:* non-deterministic; needs an API key, network, tokens; flaky; cannot cheaply gate CI.
- **(b) Record/replay cassette** of a captured agent run (seam outputs). *Pros:* deterministic replay in CI. *Cons:* the recording step is the LLM-dependent part and must be refreshed on every skill-prose change — a hidden maintenance tax and a staleness risk; the cassette is exactly what (d)'s scripted driver already is, minus the "captured from a real run" provenance.
- **(c) In-prose structured-output / test-mode** — each skill emits its decisions in a machine-readable block at the seams. *Pros:* deterministic-ish capture without scraping. *Cons:* requires **editing every skill's prose** to carry a test-mode emission (a cross-cutting change to wtf/tidy/prep/graft, far beyond FAFF-93's mandate), still run by an LLM so still non-deterministic in CI, and risks the test-mode output drifting from the real decision path.
- **(d) Narrow FAFF-93 to the capture format + harness skeleton + injection wiring + a deterministic scripted/fake driver, and defer the live-LLM driver behind a `SkillDriver` seam.** *Pros:* ships the reusable plumbing FAFF-94/95/97 build on **now**, fully testable under zero-dep `node --test` with no LLM; keeps the determinism/zero-dep ethos intact for the CI gate; leaves (a)/(b)/(c) as interchangeable future occupants of one interface — the choice between them is *isolated* to the live driver and can be made later without touching the record shape or the consumers. *Cons:* the default path does not *yet* prove a real LLM run; that proof waits on the deferred live driver.

**Chosen:** **(d)** — FAFF-93 delivers the harness skeleton + the `DecisionRecord` shape + the injection wiring (tracker port over the FAFF-89 model; CLI seam over the FAFF-90 repo) + a deterministic **scripted driver** as the **default CI-gating path**, plus the **`SkillDriver` interface** behind which a live driver plugs in. This is the only zone that lets FAFF-93 ship and be CI-gated now while keeping the determinism/zero-dep constraint, and it makes the live-mechanism choice an isolated decision rather than a blocker. **(b)** is subsumed (a cassette is a recorded script); **(c)** is rejected for v1 as out-of-mandate (it edits every skill) and still non-deterministic; **(a)** is the most likely eventual live occupant but cannot be the default gate.

**Resolved (2026-06-11, human decision — formerly the residual punt):**

- **Chosen:** the live-driver direction is **spike-first on (a)** — a de-risking spike, filed as **FAFF-122**, prototypes a live headless agent (Claude Agent SDK / `claude -p`) driving **faff-tidy** over a FAFF-89+FAFF-90 substrate to measure real flakiness, token cost, and seam-capture fidelity before the live-driver ticket is cut. (a) is the most likely eventual occupant and the only zone that proves the prose actually runs; the spike converts its cost/flakiness unknowns into numbers instead of committing blind.
- **Chosen:** the live path runs **local/on-demand only — it never runs in CI**, neither gating nor as an opt-in job. No CI secrets, no CI token spend, no flake exposure; the scripted driver remains the sole `node --test` gate. (If the spike's numbers ever argue for CI presence, that is a new decision for the spike's write-up to propose — the default stands until then.)

Neither decision blocks FAFF-93, FAFF-94, or FAFF-95, all of which run on the scripted driver; FAFF-122 is blocked-by FAFF-93 (it needs the `SkillDriver` seam to exist).

*Temporal anchor:* at the time of writing (2026-06), no in-repo skill emits a structured test-mode block, and there is no live-agent driver in `test/`; the reference fixture (`test/cli-next-seam.test.mjs`) sidesteps the LLM entirely via the CLI's structured stdout — the scripted driver generalises exactly that move to the full seam set.

**Capture granularity — full bodies vs ids/counts?** Options: store every returned entity body in the record (self-contained) vs store `method`/`args`/`resultCount` and `surface` only (lean). **Chosen:** ids/counts/surface — full bodies live in the FAFF-89 fixture and FAFF-96 goldens; duplicating them bloats the record and invites drift between fixture and record. A matcher that needs a body reads the fixture it was given.

**Mutations applied vs recorded?** Options: mutate the FAFF-89 model so later reads see writes (stateful) vs record the attempt only (seam-faithful). **Chosen:** record the attempt — the FAFF-89 model is read-only by its own spec and ADR 0002 asserts at the attempt seam; read-after-write is a deliberate deferred extension, not a v1 need (FAFF-94's tidy candidate asserts *that* a promotion was attempted, not a re-read).

**One unified log vs parallel typed lists?** Options: independent per-kind lists (simple, but cross-seam order lost) vs one `seamLog` with the typed lists as views (one ordering authority). **Chosen:** unified `seamLog` is the source of truth; the typed lists are filtered views — cross-seam ordering (CLI-before-verdict, read-before-bucket) is exactly what behavioural assertions need and must not be inferred.

**Where does the harness live and what shape?** **Chosen:** `test/helpers/skill-harness.mjs`, ESM, zero-dep beyond `node:*` + the three sibling helpers, exporting `runSkill`/`scriptedDriver`/`makeRecorder` + the `SkillDriver` interface — matching the established helper pattern and ADR 0002's "purely repo-side tooling."

---

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The one substantive punt this spec carried — *which live-LLM driver mechanism, and its CI policy* — was **resolved on 2026-06-11** (human decision, interactive prep):

- **Chosen:** spike-first on **(a)** — the de-risking spike is filed as **FAFF-122** (blocked-by FAFF-93), prototyping a live headless agent driving faff-tidy over the substrate to measure flakiness, token cost, and seam-capture fidelity before the live-driver ticket is cut.
- **Chosen:** the live path runs **local/on-demand only — never in CI** (no opt-in job, no secrets); the scripted driver remains the sole CI gate.

Full rationale in section 5 → *Resolved*. This resolution changes nothing in FAFF-93's deliverable (the `SkillDriver` seam + scripted driver were already the chosen shape); it closes the disposition question that previously held this spec at `medium`.

**Assumptions.**

- **Assumes:** the FAFF-89 mock-tracker (`test/helpers/mock-tracker.mjs`, `loadFixture` + `TrackerModel` with `listIssues/getIssue/listProjects/getProject/listInitiatives/listLabels/listComments`) and FAFF-90 seeded-repo (`test/helpers/seed-repo.mjs`, `seedRepo(spec) -> {root,worktreePath,teardown}`) are **built and importable** before FAFF-93 starts (FAFF-93 is blocked-by both; their specs are attached but not yet built). *Validation:* confirm both modules exist and export the named surface (`node -e "import('./test/helpers/mock-tracker.mjs').then(m=>console.log(typeof m.loadFixture))"` and likewise for `seedRepo`); if either is unbuilt, FAFF-93 cannot start — the blocked-by links must clear first.
- **Assumes:** ADR 0002's runner is in force — `node:test`/`node:assert`, tests under `test/`, CI runs bare `node --test` which auto-discovers new `test/*.test.mjs`. *Validation:* `.github/workflows/validate.yml` contains a `node --test` step (verified at spec time: line 53; re-verified at revision time, 2026-06-11) and `test/cli-next-seam.test.mjs` uses `node:test`; if absent, reconcile with ADR 0002 before building.
- **Assumes:** the `faff` CLI seams the harness shells (`next`/`state`/`eligible`/`contract`) remain **pure, flag-driven, no-MCP** functions invoked at `plugin/skills/faff/bin/faff` via the `run-cli.mjs` pattern. *Validation:* `runCli` already points faffBin at `plugin/skills/faff/bin/faff` (verified); re-confirm those subcommands take flags and emit structured stdout (`faff next --status todo --spec high` returns JSON) before wiring `ctx.cli`. If the binary path or seam shape moved, align `run-cli.mjs`/the harness to it (do not hardcode a stale path).
- **Assumes:** the FAFF-89 model stays **read-only** (its spec declares results are deep copies and the model is frozen), so v1's "record mutations as attempts, do not apply" is consistent with it. *Validation:* not re-checkable until FAFF-89 is built; if FAFF-89 later ships a mutation-applying variant, the read-after-write extension (OUT OF SCOPE) becomes available — that is additive, not a redesign of the record shape.

---

## 7. DONE — Definition of Done

### From WHY
- [ ] A skill test can drive a skill (or scripted stand-in) against a FAFF-89 model + FAFF-90 seeded repo and obtain a structured `DecisionRecord` without any live tracker, live LLM, network, key, or clock on the default path.
- [ ] The default, CI-gating path (scripted driver) is fully deterministic and runs under `node --test` with no `package.json`, lockfile, network, or API key; the only imports are `node:*` + the sibling test helpers.
- [ ] The record captures only deterministic seams (CLI calls, tracker reads served, mutations attempted, verdicts, bucket membership, rendering invocations) — no free-text agent reasoning is an assertable field.
- [ ] The harness records decisions but asserts none — no bucket/ordering/verdict/mutation matcher and no ordering/priority/sizing opinion lives in FAFF-93 (those are FAFF-95 / the methodology).

### From WHAT (types and interfaces)
- [ ] `DecisionRecord` matches the section-3 shape: `skill`, `driver`, `trackerReads`, `mutations`, `cliCalls`, `verdicts`, `buckets`, `renderings`, and the unified `seamLog`.
- [ ] Every seam carries a unique, monotonic `seq`; the typed lists are views over `seamLog` and preserve cross-seam ordering.
- [ ] `TrackerRead` carries `method`/`args`/`resultCount` (not full bodies); `Rendering` carries `surface` (not body); `Mutation` carries `op`/`issue?`/`args`; `CliCall` carries `argv`/`stdout`/`exit`; `Verdict` carries `issue`/`token`/`source`.
- [ ] `test/helpers/skill-harness.mjs` is ESM, imports only `node:*` + `mock-tracker.mjs`/`seed-repo.mjs`/`run-cli.mjs`, and exports `runSkill`, `scriptedDriver`, `makeRecorder`, and the `SkillDriver` interface contract.
- [ ] `runSkill(config)` accepts `{ skill, tracker, repo, driver?, flags? }` and returns a frozen `DecisionRecord` (a Promise iff the driver is async).
- [ ] The record's `driver` field records provenance (`"scripted"` for the default driver).

### From WHAT (decisions)
- [ ] FAFF-93 ships the capture-record shape + harness skeleton + injection wiring + scripted driver + the `SkillDriver` seam, and does **not** ship a live-LLM driver (matching the `**Chosen:**` (d) decision; the live driver follows the FAFF-122 spike).
- [ ] Capture granularity is ids/counts/surface, not full entity bodies (matching the `**Chosen:**`).
- [ ] Mutations are recorded as attempts, not applied to the FAFF-89 model (matching the `**Chosen:**`).
- [ ] `seamLog` is the single ordering authority; typed lists are derived views (matching the `**Chosen:**`).

### From HOW (behaviour)
- [ ] `runSkill` injects tracker reads to the FAFF-89 model (recording each as a `TrackerRead`) and tracker writes as recorded `Mutation`s (not applied).
- [ ] `runSkill` runs every `faff` CLI call via `run-cli.mjs` with `cwd`/`--root` set to `config.repo.root`, recording each as a `CliCall` with verbatim `stdout`/`exit`.
- [ ] `scriptedDriver(script)` deterministically performs `read`/`cli`/`mutate`/`verdict`/`bucket`/`render` script actions against the injected context and produces a record with no LLM/network/clock/random.
- [ ] Running the same `{ scripted driver, fixture, seeded repo }` twice yields an identical `DecisionRecord` (modulo the seeded-repo temp-root path that FAFF-90 already isolates).
- [ ] A live driver can implement `SkillDriver.drive(ctx)` and produce the same record shape (interface present and exercised by at least a fake-async driver in the self-test).

### From HOW (edge cases)
- [ ] A driver calling an unknown tracker read method throws a terminal `HarnessError` (fail loud).
- [ ] A non-zero `faff` CLI exit is recorded (`exit` ≠ 0) and **not** thrown.
- [ ] A driver that emits no seams yields a valid empty `DecisionRecord` (empty lists, `{}` buckets) — not an error.
- [ ] An async driver causes `runSkill` to return an awaited Promise; the scripted default keeps `runSkill` synchronous.
- [ ] `runSkill` allocates nothing requiring its own teardown; repo teardown remains the caller's `t.after(repo.teardown)` responsibility.

### From scope boundaries
- [ ] No assertion/matcher vocabulary (FAFF-95), no real end-to-end skill test (FAFF-94), no live-LLM driver implementation (that follows the FAFF-122 spike), no rendering-body golden, no fixture mutation/write-back, and no new `faff` subcommand / `.faffrc` key / `validate.yml` edit are introduced.

**Integration smoke test** (the "plumbing is connected" path — deterministic, scripted, zero-LLM):

```
PROCEDURE smoke_scripted_run:
  1. tracker := loadFixture(absolute path to a fixture with:
                  ISS-A {state "Backlog", stateCategory backlog, label "faff-automate", spec comment},
                  ISS-B {state "Todo",    stateCategory unstarted})
  2. repo := seedRepo({ commits:[{message:"init", files:{"README.md":"x"}}],
                        specs:[{ issue:"ISS-A", location:"committed", body:"# spec\nconfidence: high\n" }] })
  3. driver := scriptedDriver([
        { read:   { method:"listIssues", args:{ stateCategory:"backlog" } } },
        { read:   { method:"listComments", args:{ issueId:"ISS-A" } } },
        { cli:    ["next","--status","backlog","--spec","high"] },
        { verdict:{ issue:"ISS-A", token:"prep", source:"faff next" } },
        { bucket: { name:"ready", issues:["ISS-A"] } },
        { mutate: { op:"setStatus", issue:"ISS-A", args:{ status:"Todo" } } },
        { render: { surface:"tidy-report" } },
     ])
  4. rec := runSkill({ skill:"faff-tidy", tracker, repo, driver })
  5. ASSERT rec.driver === "scripted"
  6. ASSERT rec.trackerReads.map(r=>r.method) deep-equals ["listIssues","listComments"]
  7. ASSERT rec.cliCalls[0].argv deep-equals ["next","--status","backlog","--spec","high"] AND rec.cliCalls[0].exit === 0
  8. ASSERT rec.verdicts[0] deep-equals { seq: <n>, issue:"ISS-A", token:"prep", source:"faff next" }
  9. ASSERT rec.buckets.ready deep-equals ["ISS-A"]
  10. ASSERT rec.mutations[0] deep-equals { seq:<n>, op:"setStatus", issue:"ISS-A", args:{ status:"Todo" } }   # attempt, not applied
  11. ASSERT rec.renderings[0].surface === "tidy-report"
  12. ASSERT rec.seamLog is ordered by seq ascending and its length === 7
  13. ASSERT a second identical runSkill yields a deep-equal record (determinism)
  14. ASSERT runSkill with a script doing { read:{ method:"noSuchMethod" } } throws HarnessError
  15. repo.teardown()
```

If this path passes, the injection (tracker port + CLI seam over the seeded repo), the scripted driver, the recorder/`seq` ordering, the typed views, the mutation-as-attempt rule, the fail-loud guard, and the determinism guarantee are all connected — and FAFF-95 has a stable record to assert on, FAFF-94 a mechanism to drive a real skill, FAFF-97 a `renderings` seam to check routing.

---

## 8. APPENDICES

### Appendix A — Example `DecisionRecord` (illustrative, from the smoke test)

```
{
  "skill": "faff-tidy",
  "driver": "scripted",
  "seamLog": [
    { "seq": 0, "kind": "trackerRead", "payload": { "seq":0, "method":"listIssues", "args":{"stateCategory":"backlog"}, "resultCount":1 } },
    { "seq": 1, "kind": "trackerRead", "payload": { "seq":1, "method":"listComments", "args":{"issueId":"ISS-A"}, "resultCount":1 } },
    { "seq": 2, "kind": "cliCall",     "payload": { "seq":2, "argv":["next","--status","backlog","--spec","high"], "stdout":"{\"next\":\"prep\"}", "exit":0 } },
    { "seq": 3, "kind": "verdict",     "payload": { "seq":3, "issue":"ISS-A", "token":"prep", "source":"faff next" } },
    { "seq": 4, "kind": "bucket",      "payload": { "seq":4, "name":"ready", "issues":["ISS-A"] } },
    { "seq": 5, "kind": "mutation",    "payload": { "seq":5, "op":"setStatus", "issue":"ISS-A", "args":{"status":"Todo"} } },
    { "seq": 6, "kind": "rendering",   "payload": { "seq":6, "surface":"tidy-report" } }
  ],
  "trackerReads": [ /* views over seamLog, kind==trackerRead */ ],
  "mutations":    [ /* ... */ ],
  "cliCalls":     [ /* ... */ ],
  "verdicts":     [ /* ... */ ],
  "buckets":      { "ready": ["ISS-A"] },
  "renderings":   [ /* ... */ ]
}
```

This appendix is illustrative; the section-3 type definitions are authoritative.

---

confidence: high
