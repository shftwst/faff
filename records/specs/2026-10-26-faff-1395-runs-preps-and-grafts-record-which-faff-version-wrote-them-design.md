# FAFF-1395: Runs, preps and grafts record which faff version wrote them

> Spec: faffter-dark-nlspec · 2026-10-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1395.

*Revision 3, 2026-10-24: spec-review round 1 applied (a location check so a copied `bin/lib` never borrows a host checkout's version; only a resolved version is memoised; resume stays pure; the one-PR decision is settled now). Revision 2: methodology critique applied. The Commissaire admission stamp is deferred to FAFF-1282's facade v0.4 (operator decision); writer and schema land together; rebase note for FAFF-1257; DONE line for the marketplace check.*

This spec is for the build agent implementing FAFF-1395 and for the people reviewing it. It adds one resolver for the faff plugin release version, a `faff version` command that exposes it, and an optional `faff_version` field on every durable record a run, prep or graft writes, including the spec provenance stamp.

## 1. WHY

**The mechanism.** One pure function reads `version` from `plugin/.claude-plugin/plugin.json` (today `0.42.0`) and returns it, or the literal `unknown` when the file cannot be read. Every writer asks that one function and stamps the answer as `faff_version`. No writer reads `plugin.json` itself, and no writer ever fails because the version is unknown. This is the same "one resolver, many sinks" shape `faff harness identify` already uses for harness and model (`harness.js:605-628`).

**Problem.** faff records which harness and model produced a run ledger, a prep marker, a merge record and a spec stamp, but not which faff release did. When a run, prep or graft goes wrong, nobody can tell from the artifacts whether release 0.41.0 or 0.42.0 produced it, so a regression cannot be traced to the release that introduced it. This change makes the release version a recorded fact on each of those artifacts.

**Design principles.**

**Never throw for provenance.** Version resolution is provenance, not a gate. A missing, malformed or foreign `plugin.json` yields `unknown`, and the write continues exactly as it would have. Reject any implementation where a version fault can stop a ledger write, an evidence write or a Commissaire admission.

**Additive only.** Every schema change is a new optional property. No `required` array changes, no `schema_version` bump, no change to any existing field. Files written before this change must validate and read exactly as they do today. This is also what lets the governance-check base-commit leg accept the PR head's schemas as candidates (`evidence.js:299-384`).

**Release version only.** The value is the plugin release version, such as `0.42.0`. It is never a commit SHA, a content hash, `package.json`'s `0.0.0`, or the governor install's `install_version` (a sha256 of the file closure). The operator settled this on 2026-10-24.

**No new dependencies for governance code.** The resolver is required by governance modules (events, evidence, effects, heartbeat). `faff regions check` forbids governance modules from requiring factory modules, and the standalone Commissaire binary's DENYLIST (`test/commissaire-standalone.test.mjs:28`) includes `harness`. So the resolver cannot live in `harness.js`; it must be its own module that requires only Node built-ins.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/harness.js:605-740` | JavaScript | `harnessIdentify` resolver, fail-quiet wrapper and `faff harness identify [--json]` (always exit 0); the pattern to mirror |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js:188-206` | JavaScript | Existing sink: lazy resolver call, injectable identity, field omitted on fault |
| `plugin/.claude-plugin/plugin.json` | JSON | Version source; `{"name":"faff","version":"0.42.0",...}`; bumped by release-please with `.release-please-manifest.json` |
| `plugin/skills/faff/bin/lib/heartbeat.js:355-420` | JavaScript | `mutateLedgerUnderLock`, the shared ledger serialiser that validates against the closed run-ledger schema |
| `plugin/skills/faff/bin/lib/evidence.js:299-384` | JavaScript | Additive schema-change classifier used by `--candidate-schemas` and the governance-check base leg |
| `plugin/skills/faff/contracts/evidence-v0.3/` and `verification/evidence/v0.3/` | JSON Schema | The closed v0.3 schemas; the two trees are byte-identical today and must stay so |
| `plugin/skills/faff/bin/lib/governor-install.ts:616-645` | TypeScript | Governor install copies only the `require()` closure of `bin/commissaire`, so `plugin.json` is absent there |
| `plugin/skills/faff/references/kernel.md:455` | Markdown | Canonical provenance stamp format |
| `plugin/skills/faff-prep/SKILL.md:60-100` | Markdown | Stamp population, detection fixture and prep marker shape |
| `plugin/skills/faff-beep-boop/SKILL.md:425-432` | Markdown | Ledger `owner` block description and prose enrichment |

**Scope.** This sits beside harness identity in faff's provenance layer: it adds a third provenance fact (release) to the artifacts that already carry the other two, plus the evidence records that carry none today.

## 2. OUT OF SCOPE

- **Commit SHA or dirty-tree marker.** Why excluded: the operator ruled release version only. Extension point: a second resolver field (for example `faff_commit`) in the new `faff-version.js` module.
- **Governor-signed Commissaire records** (an admission or decision signed by a remote governor in governor-client mode, `commissaire.ts:652-700`). Why excluded: the client checks a governor record against its own closed v0.3 schema (`governorRecordConforms`, `commissaire.ts:215`), so a newer governor that adds `payload.faff_version` would have its admission refused by every older client. That is a fail-closed outage for governed runs whenever the governor is upgraded first. Extension point: `governor.ts` admit, once clients that accept the field are the deployed floor; at that point the governor install would also need a version source (its `install-manifest.json` already records `source_tag`, for example `faff--v0.42.0`).
- **Producer-HMAC'd Commissaire records** (declare, observe, reconcile, request) and Commissaire-signed decision verdicts. Why excluded: the ledger and genesis event already tie the run (and so its Commissaire chain, by `run_id`) to a release; repeating it per effect adds bytes to every signed record for no new information. Extension point: `appendProducerRecords` and `appendCommissaireRecord` in `commissaire.ts`.
- **The in-process Commissaire admission record** (`payload` of the seq-0 `admission` in `declared-effects.jsonl`). Why excluded: the published facade schema `verification/commissaire-facade/v0.3/schema/admission.schema.json` closes `payload` with `additionalProperties: false` and lists exactly five keys, and v0.3 is digest-pinned and frozen. Stamping the admission would make every new admission fail the schema external verifiers check against (FAFF-977, FAFF-1224), the same defect FAFF-1282 tracks for `payload.custody`. The run stays traceable to a release: the ledger `owner` and the genesis event carry `faff_version` and share `run_id` with the Commissaire chain. The operator chose this deferral on 2026-10-24. Extension point: FAFF-1282's facade v0.4 lists `faff_version` beside `custody`, then the in-process admit stamps it (`commissaire.ts`, the `appendCommissaireRecord` call near `:768`).
- **Transient coordination files**: heartbeat sidecars, `.faff/inflight/` markers, build-claim git refs, decision-capture counters, resume-store `hold.json`, and the `park-reconsider` marker rewrite. Why excluded: they coordinate live processes and are deleted or superseded; they are not the record of what a run produced. (`park-reconsider` rewrites an existing prep marker in place and preserves its keys, so a stamped marker keeps its field.) Extension point: each file's own writer.
- **Spec-review scratch files** (`round-<n>.json`, `collated.json`, `dispositions.json` written by faff-prep prose). Why excluded: they are scratch inputs; the durable result, `spec-review-verdict.json`, is stamped by the CLI writer. Extension point: faff-prep SKILL.md spec-review section.
- **Rendered markdown** (run summary, ADR template `Provenance:` line). Why excluded: rendered from the ledger and events, which now carry the field. Extension point: `bundle-seal-core.js` and `adr.js:533`.
- **Older faff reading newer files.** Why excluded: the ticket requires new code to read old files, not the reverse. An older faff that resumes a ledger stamped by a newer faff will see `owner.faff_version` as an unknown key (see Failure modes). Extension point: none needed; documented only.
- **A `faff --version` top-level flag.** Why excluded: `main()` in `bin/faff` deliberately special-cases only help aliases, and `lint-cli-doc` keys off `COMMANDS`. A subcommand covers the need. Extension point: `bin/faff` `main()`.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| release version | The `version` string in `plugin/.claude-plugin/plugin.json`, such as `0.42.0`. |
| version resolver | The single function `resolveFaffVersion` that every writer calls to get the release version. |
| sink | Any writer that stamps `faff_version` into an artifact. |
| stamp position | Where in an artifact the field goes: top level, inside `owner`, inside event `data`, or inside a signed `payload`. |

### Types

```
ENUM FaffVersionSource:
  plugin-json      # read and validated from plugin.json
  default          # nothing usable found; version is "unknown"

RECORD FaffVersion:
  version: String   # "<major>.<minor>.<patch>" with optional "-<prerelease>", or the literal "unknown"
  source: FaffVersionSource
  CONSTRAINT source = default  <=>  version = "unknown"

CONSTANT PLUGIN_JSON_PATH = resolve(<directory of faff-version.js>, "../../../../.claude-plugin/plugin.json")
  # bin/lib -> bin -> faff -> skills -> plugin, then .claude-plugin/plugin.json.
  # Note: three levels up from bin/lib lands in plugin/skills/, which is wrong.

CONSTANT VERSION_PATTERN = ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$
```

### The new module

A new module `plugin/skills/faff/bin/lib/faff-version.js` (plain JavaScript; no TypeScript emit needed) exports:

```
INTERFACE faff-version:
  resolveFaffVersion(opts?) -> FaffVersion
    opts.readFile?: (path) -> String     # injectable for tests; default fs.readFileSync(path, "utf8")
    opts.path?: String                   # default: four levels above moduleDir, then .claude-plugin/plugin.json
    opts.moduleDir?: String              # injectable for tests; default realpath of the module's own directory
    # a resolved version is memoised per process when called with no opts; never throws
  stampFaffVersion(doc, version) -> Object
    # returns a new object with faff_version inserted directly after schema_version
    # (or first, when doc has no schema_version); never mutates doc
  cmdVersion(args) -> exit code
  versionSelftest() -> exit code
```

It requires only `node:fs` and `node:path`. It carries a region banner, is registered in the `regions.js` class map as `governance` (governance modules will require it), and has a runnable `--selftest` in `REGION_SELFTEST_ARGV`.

### The CLI

```
faff version [--json] [--selftest]
  plain:  prints the version alone, e.g. "0.42.0" or "unknown"
  --json: prints {"version":"0.42.0","source":"plugin-json"}
  exit:   0 always (except --selftest, which exits non-zero on a failed case, and a usage error, which exits 2)
```

`version` is added to `COMMANDS` in `bin/faff`, gets a row in `docs/guide/cli.md` under "Config & install health" (enforced by `lint-cli-doc`), and is covered by its selftest entry (enforced by `lint-cli-coverage`).

### Field name and stamp position per artifact family

The field is named `faff_version` in every JSON artifact. Its value is always `resolveFaffVersion().version`, so `unknown` is written rather than omitted. Writing `unknown` keeps "this writer knew about the field but could not resolve it" distinct from "this file predates the field" (field absent).

| Artifact | Writer | Stamp position | Refresh rule | Schema change |
|---|---|---|---|---|
| `run-ledger.json` | `buildInteractiveLedger`, `buildSelfDrainLedger` (`run-ledger.js`), `mintLightsOut` (`lights-out.js:1187`), `applyResumeToLedger` (`resume.js:151`) | `owner.faff_version` | Set when an owner block is minted; a resume writes the resuming faff's version into the new `owner` and the old owner (with its version) moves to `owner_history` unchanged | Optional `faff_version: string` under `owner` and under `owner_history.items` |
| `events.jsonl` genesis `run-start` | `emitGenesisRunStart` (`events.js:713`) | `data.faff_version` | Written once; the record is hash-chained and never rewritten | Optional `faff_version: string` under `run-start` `data` |
| `ac-checklist.json` | `anchoredAcChecklist` (`evidence.js:664`) | top level, after `schema_version` | Per write | Optional top-level property |
| `review-verdict.json` | `anchoredTerminalReview` (`:766`), `writeCollatedReviewVerdict` (`:1041`) | top level, after `schema_version` | Per write | Optional, `review-verdict-anchored` |
| `review-rounds/round-<n>.json` | `recordReviewRound` (`:981`) | top level, after `schema_version` | Write-once file | Optional, `review-round` |
| `spec-review-verdict.json` | `anchoredSpecReview` (`:587`) | top level, after `schema_version` | Per write | Optional, `spec-review-verdict-anchored` |
| `build-progress.json`, `landing-progress.json` | `writeRunState` stamp (`effects.js:450`) | top level, after `schema_version` | Every write restamps with the current writer's version (last writer wins) | Optional, both schemas |
| `holdout.json` | `holdout-record.js` (both the `top` document and `failClosed`) | top level, after `schema_version` | Per write | Optional, `holdout-anchored` |
| `merge-record.json` | `writeMergeRecord` (`merge-gate-floor.js:188`) | top level, beside `harness`/`model` | Write-once | None (schema-less) |
| `custody-verdict.json` | `integrity-digest.js` (`base` at `:396`) | top level, after `schema_version` | Per write | None (schema-less) |
| judge-trail `manifest.json` | `judge-trail.js` `manifestCore` (`:293`) | top level, after `schema_version` | Write-once | None (schema-less) |
| `.faff/provenance/<ISSUE>.json` | `cmdIntakeRecord` (`intake-provenance.js:302`) | top level, beside `schema` | Every intake-record write restamps; the no-downgrade path (a `backfill` over a genuine record) writes nothing, so that marker keeps whatever it had | None; `PROVENANCE_SCHEMA` stays `2` |
| `.faff/prep/<ISSUE>.json` prep marker | faff-prep prose (`SKILL.md:92-100`) | top level, beside `harness`/`model` | Written once at produce time, like `harness`/`model` | None (schema-less) |
| Spec provenance stamp | faff-prep prose, format in `kernel.md:455` | New segment `faff <version>` between `<harness>/<model>` and `confidence:` | Refreshed on every re-stamp | None |

**Chosen:** the field name `faff_version` everywhere, with the stamp positions above. `faff` is the current technical identifier (AGENTS.md product-name rules), it reads clearly next to `schema_version`, and it matches the existing `owner.harness`/`owner.model` and `data.level` placements in the ledger and genesis.

### JSON Schema fragment

Every schema addition is this exact property, so the base-leg additive checker sees a new optional, typed, closed property under an already-closed object:

```
"faff_version": {
  "type": "string",
  "description": "faff plugin release version that wrote this document (FAFF-1395); \"unknown\" when unresolved; absent on documents written before FAFF-1395"
}
```

**Chosen:** `type: string` with no `pattern`. The resolver already guarantees the format, and a `pattern` would turn any future widening of the version format into a non-additive schema change.

### Spec stamp format

Before:

```
> Spec: <producer> · <date> · <mode> · <harness>/<model> · confidence: <level>. Full spec on <tracker> <ISSUE-ID>.
```

After:

```
> Spec: <producer> · <date> · <mode> · <harness>/<model> · faff <version> · confidence: <level>. Full spec on <tracker> <ISSUE-ID>.
```

Example: `> Spec: faffter-dark-nlspec · 2026-10-24 · autonomous · claude-code/claude-opus-5-5 · faff 0.42.0 · confidence: high. Full spec on Linear FAFF-1395.` When unresolved, the segment reads `faff unknown`; it is never omitted. Detection still anchors on `^> Spec:` only, so `provenance_present` is unaffected. The version is provenance and is never added to the `faff-contract:spec-readiness` JSON.

**Chosen:** the segment `faff <version>` directly after `<harness>/<model>`. It groups the three "who produced this" facts together, and the leading word `faff` makes the segment self-describing in a line that is otherwise positional.

## 4. HOW

### Resolution

`resolveFaffVersion` reads one file, checks it is faff's own manifest, and checks the version shape. Anything else degrades to `unknown`.

```
PROCEDURE resolveFaffVersion(opts):
  1. IF opts is empty AND a memoised result exists: RETURN it
  2. dir := opts.moduleDir OR realpath(<directory of faff-version.js>)
     IF the last four path segments of dir are not exactly skills/faff/bin/lib:
       RETURN {version: "unknown", source: "default"}
  3. path := opts.path OR resolve(dir, "../../../../.claude-plugin/plugin.json")
  4. TRY text := (opts.readFile OR readFileUtf8)(path)
     ON ANY ERROR: RETURN {version: "unknown", source: "default"}
  5. TRY obj := JSON.parse(text)
     ON ANY ERROR: RETURN {version: "unknown", source: "default"}
  6. IF obj is not a plain object
        OR obj.name != "faff"
        OR typeof obj.version != "string"
        OR NOT VERSION_PATTERN.matches(obj.version):
       RETURN {version: "unknown", source: "default"}
  7. result := {version: obj.version, source: "plugin-json"}
     IF opts is empty: memoise(result)
     RETURN result
  # Only a resolved version is memoised: a transient read failure is retried on the next call
  # rather than frozen as "unknown" for the rest of the process. Injected test calls never memoise.
```

Two checks keep a copied tree from borrowing another tree's version:

- **Location check (step 2).** The resolver only trusts `plugin.json` when the module itself sits at `skills/faff/bin/lib` inside a plugin tree, which is the layout every supported install keeps (repo checkout, symlinked install after realpath, marketplace copy). A copied `bin/lib` anywhere else (a holdout env's `ctx/lib/`, a vendored copy, a governor install at `/opt/commissaire/<hash>/`) fails this check and records `unknown`, however deep it is nested under a faff checkout. This replaces any reliance on how deep a copy happens to sit.
- **Name check (step 6).** Even at the right location, the manifest must name `faff`, so a different plugin's tree never stamps its own version as faff's.

### Install shapes

| Install shape | Does `plugin.json` resolve? | Recorded value |
|---|---|---|
| Repo checkout (contributor) | Yes | e.g. `0.42.0` |
| `scripts/link-skills.sh` symlinked install | Yes: Node resolves `__dirname` through the symlink to the real path in the main checkout | The main checkout's version |
| Marketplace plugin install (`$CLAUDE_PLUGIN_ROOT/skills/faff/bin/faff`) | Expected yes, if Claude Code copies `./plugin` whole (see Assumptions) | e.g. `0.42.0` |
| Governor install (`/opt/commissaire/<hash>/`) | No: closure copies only `require()` targets and `RUNTIME_ASSETS` | `unknown` (and governor-signed records are out of scope anyway) |
| governance-check base leg (`git archive` of `plugin/skills/faff` only) | No | `unknown`; this leg only validates, it writes no stamped artifact |
| Pinned single-file `bin/faff` curled by governance-check | No | `unknown` |

**Chosen:** the governor install does not gain `plugin.json` as a runtime asset. The governor writes no stamped record in this ticket, and `plugin.json` sits outside the clone root `closureManifest` reads from (`readInside` aborts on paths outside it), so adding it would mean changing the install layout for no consumer.

### Writer changes

Pure builders take the version as a parameter, and their callers pass `resolveFaffVersion().version`. This keeps builders pure and testable, the same way `writeMergeRecord` takes an injectable identity.

```
PROCEDURE stamp a schema_version-carrying evidence document:
  1. Build the document exactly as today (same keys, same order)
  2. doc := stampFaffVersion(doc, resolveFaffVersion().version)
     # key order becomes: schema_version, faff_version, <existing keys in existing order>
  3. Validate against the schema (unchanged step; the schema now allows faff_version)
  4. Write (unchanged)
```

```
PROCEDURE ledger owner mint (buildInteractiveLedger, buildSelfDrainLedger, mintLightsOut):
  1. owner := { status, session_id, pid, started_at, last_heartbeat, faff_version: <passed-in version> }
  2. Everything else unchanged

PROCEDURE applyResumeToLedger(ledger, ctx):
  1. Push the prior owner object to owner_history as today (byte-for-byte, including any faff_version it has)
  2. New owner := { status, epoch, session_id, pid, started_at, last_heartbeat, faff_version: ctx.faffVersion }
     # ctx.faffVersion is supplied by every caller from resolveFaffVersion(); applyResumeToLedger stays pure
     # and never resolves it itself. When a caller omits it, the new owner has no faff_version (a caller bug a test catches).
```

```
PROCEDURE emitGenesisRunStart(runDir, { level } = {}):
  1. record := { schema: 2, run_id, seq, ts, prev, phase: "run", type: "run-start" }
  2. record.data := { faff_version: resolveFaffVersion().version }
  3. IF level is defined: record.data.level := level
     # data key order: level first when present, then faff_version, i.e. build as { level?, faff_version }
  4. Append (unchanged)
```

So the L2 genesis now carries `data: {faff_version}` where it previously carried no `data`, and L3/L4 carry `data: {level, faff_version}`. Readers of `data.level` compare `=== "L4"` (`spec-judge-casefile.js:380`), so an L2 genesis with `data` but no `level` reads exactly as before.

No Commissaire module changes: `commissaire.ts`, its emit and `build-manifest.json` are untouched, and so is every `verification/commissaire-facade/` file.

The merge record, custody verdict, judge-trail manifest and intake provenance marker set `faff_version` from the resolver at write time. `writeMergeRecord` gains an injectable `faffVersion` argument after `githubActor`, defaulting to the resolver.

### Skill-prose sinks

The three prose files change together, in one commit:

- **`plugin/skills/faff/references/kernel.md:455`**: the stamp format gains `· faff <version> ·` after `<harness>/<model>`, resolved from `faff version --json` `.version`, rendering `unknown` when unresolved and never omitted; and the version, like harness/model, is provenance and never enters the `faff-contract:spec-readiness` JSON.
- **`plugin/skills/faff-prep/SKILL.md`**: the stamp bullet list gains `faff <version> := faff version --json` (the resolver's `.version`); the refresh rule re-resolves it on every re-stamp; the detection fixture line shows the new segment; the prep marker JSON example gains `"faff_version": "<v.version>"` with one sentence that it comes from the same resolver and is absent on older markers, which `prepcheck` never depends on.
- **`plugin/skills/faff-beep-boop/SKILL.md:425-432`**: the `owner` field list notes `faff_version` is written by the CLI mint (never by prose), and the enrichment step merges `harness`/`model` into the existing `owner` block without dropping `faff_version`.

These files are checked by `faff validate-adapters` (line caps, paragraph length, duplicated blocks); keep edits within the existing sentences where possible. faff-prep must resolve the version via the CLI only, never by reading `plugin.json` itself.

### Documentation

- `docs/guide/cli.md`: one `version` row.
- `contracts/evidence-v0.3/evidence-documents.md` and `logs.md`: name `faff_version` on each document, as optional.
- Every schema and doc edit under `plugin/skills/faff/contracts/evidence-v0.3/` is mirrored byte-for-byte into `verification/evidence/v0.3/`; `diff -rq` between them must stay empty.

**Chosen:** no edit to any top-level `plugin/skills/faff/contracts/*.schema.json`. The bundle manifest's `contract_schema_versions` hashes only that top-level set (`bundle-seal-core.js:203-220`), so this change leaves it, and every bundle `contract_fingerprint`, unchanged. (The ticket brief expected it to change; the code shows it covers only top-level contract schemas, not `evidence-v0.3/schema/**`.)

### Edge cases

| Case | Behaviour |
|---|---|
| `plugin.json` missing, unreadable, not JSON, not an object | `unknown`, source `default`, no stderr noise, write proceeds |
| `name` is not `faff` | `unknown` |
| `version` missing, non-string, empty, or not matching `VERSION_PATTERN` (e.g. `"latest"`, `"0.42"`) | `unknown` |
| `version` is `"0.43.0-rc.1"` | Recorded as `0.43.0-rc.1` |
| Old file without `faff_version` | Validates against the new schema (field optional) and reads as today; no reader requires the field |
| Ledger minted before this change, mutated by new faff | `owner` has no `faff_version`; ordinary mutations do not add it (only a mint or resume writes an owner block). A resume moves the old owner to `owner_history` unchanged and the new owner carries the field |
| `faff version` with an unknown flag | Usage error, exit 2 (the "always exit 0" rule covers resolution, not bad arguments) |
| Resolver called from a copied `bin/lib` (holdout env, vendored copy), at any depth under a faff checkout | The location check fails (the module is not at `skills/faff/bin/lib`), so `unknown` |
| First read of `plugin.json` fails transiently, a later read succeeds | The first call returns `unknown` (not memoised); the later call returns and memoises the version |

### Failure modes

- **The failure:** an older faff (pre-FAFF-1395) mutates a ledger or evidence document a newer faff wrote, for example an operator rolls back the plugin mid-run and resumes. Its closed schema sees `owner.faff_version` as an unknown key; `applyResumeToLedger` moves that owner into `owner_history`, the changed path is attributed to the current write, and `mutateLedgerUnderLock` refuses in enforce mode. **How you'd know:** a `LEDGER_SCHEMA` error naming `owner_history` on resume after a downgrade. **What it means:** proceed; downgrade-resume is not a supported path, and the fix is to resume with the newer faff. Record it in the release note for this change.
- **The failure:** a consumer repo's governance-check base commit pins an older faff while anchors are written by a newer faff, and the PR does not also carry the newer schemas as candidates. **How you'd know:** the "Evidence schema (base commit)" leg reports `fail` with an unknown-property violation on `faff_version`. **What it means:** proceed; the same is true of any additive field, and the guide already says the base leg accepts head schemas only where they are additive. No change here.
- **The failure:** the marketplace install does not place `.claude-plugin/plugin.json` four levels above `bin/lib`. **How you'd know:** `faff version --json` reports `source: "default"` in a marketplace install. **What it means:** narrow; the field still writes (`unknown`), and a follow-up adds a second lookup location such as `$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json`.

**Anti-pattern:** reading `plugin.json` in any writer or skill other than through `resolveFaffVersion` / `faff version`. Why: two readers drift (one fixes the path, the other does not), which is exactly the divergence the harness resolver was introduced to stop.

**Anti-pattern:** loosening an exact-shape test (`deepEqual` to `ok`, exact key list to `includes`) to make the new field pass. Why: those tests pin the document shape on purpose. Update each to the new exact shape instead.

**Anti-pattern:** omitting `faff_version` when the version is unknown. Why: absence means "written before FAFF-1395"; `unknown` means "written after, but unresolved". Collapsing them loses the distinction this ticket exists to record.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo checkout whose plugin/.claude-plugin/plugin.json has "version": "0.42.0"
When the operator runs `faff version --json`
Then stdout is {"version":"0.42.0","source":"plugin-json"} and the exit code is 0
```

```
Given faff-version.js resolves a plugin.json path that does not exist (as in a governor install)
When `faff run-ledger init-interactive` mints a run
Then run-ledger.json has owner.faff_version "unknown", the events.jsonl genesis has data {"faff_version":"unknown"}, the mint exits 0, and `faff events verify` passes on the chain
```

```
Given a run ledger minted by faff 0.42.0 whose owner.faff_version is "0.42.0"
When faff 0.43.0 resumes the run
Then owner_history ends with the prior owner including faff_version "0.42.0", and the new owner has faff_version "0.43.0"
```

```
Given an anchor directory committed before FAFF-1395, whose documents have schema_version but no faff_version
When `faff evidence validate <anchor-dir> --require-evidence-schema` runs with the new schemas
Then the status is the same as before this change
```

```
Given a run admitted to Commissaire in-process after this change
When `commissaire audit verify` runs and the seq-0 admission is validated against verification/commissaire-facade/v0.3/schema/admission.schema.json
Then both pass, and the admission payload carries exactly the five v0.3 keys
```

- The spec stamp written by faff-prep reads `... · <harness>/<model> · faff <version> · confidence: <level>. ...`, and `provenance_present` is true for it.

## 6. DESIGN DECISION RATIONALE

**Should `faff version` expose the resolver?**
Options: (a) a `faff version [--json]` subcommand; (b) add `faff_version` to `faff harness identify --json`; (c) no CLI, code-only resolver.
(b) would put the version in a module the Commissaire binary may not require, and mixes two facts with different sources. (c) leaves the prose sinks (stamp, prep marker) with no way to ask without reading `plugin.json` themselves.
**Chosen:** (a), always exit 0 on resolution, mirroring `faff harness identify`; plain output is the bare version so it is usable in shell.

**What does the stamp read when `plugin.json` cannot be found?**
Options: (a) the literal `unknown`; (b) omit the segment or field; (c) fall back to another source such as `package.json` or the governor `source_tag`.
(b) loses the before/after distinction and breaks the stamp's positional reading. (c) `package.json` is `0.0.0` and never bumped; `source_tag` exists only in governor installs, which stamp nothing in this ticket.
**Chosen:** (a) `unknown`, the same convention as `model: unknown` in harness identity.

**Is the new field an additive schema change under the strict v0.3 schemas?**
Options: (a) optional `faff_version` property, `schema_version` unchanged; (b) required property with a `schema_version` bump to 2; (c) no schema change, strip the field before validation.
(b) breaks every existing anchor and fails the base-commit leg. (c) writes documents that do not validate.
**Chosen:** (a). The classifier at `evidence.js:299-384` accepts exactly this shape.

**Where does the field go in the ledger?**
Options: (a) top-level `faff_version` set at mint; (b) `owner.faff_version` per owner epoch; (c) both.
A resume can run under a different release than the mint, and `owner_history` already records per-epoch harness and model.
**Chosen:** (b). The mint version is the earliest owner's (`owner_history[0]`, or `owner` when there is no history).

**Where does the field go in the genesis event?**
Options: (a) `data.faff_version`; (b) a new top-level envelope key on the `run-start` record.
Envelope keys are common to every event type; `data` is the per-type payload and already holds `level` for the same record.
**Chosen:** (a), accepting that the L2 genesis gains a `data` object; the two tests pinning "no data key" are updated to the new exact shape.

**Do Commissaire records carry the version, and which ones?**
Options: (a) every record; (b) the in-process admission record only, inside the signed payload; (c) admission in both in-process and governor-client modes; (d) none, join by `run_id` to the ledger.
(a) adds bytes to every signed record for no new fact. (c) makes older clients refuse a newer governor's admission (closed client-side schema check). (d) leaves the operator's named Commissaire scope to a later facade version.
**Chosen:** (d) for this ticket, by operator decision on 2026-10-24. (b) was the first choice, but the published facade v0.3 closes the admission `payload`, so a stamped admission fails external verification. The admission stamp moves to FAFF-1282's facade v0.4 (OUT OF SCOPE above); the ledger and genesis carry the version under the same `run_id`.

**Should the governor install ship `plugin.json`?**
**Chosen:** no, for the reasons in "Install shapes".

**Where does the resolver live?**
Options: (a) inside `harness.js`; (b) a new dependency-free module `faff-version.js`.
`harness` is on the standalone Commissaire DENYLIST and is a factory module; governance modules may not require it.
**Chosen:** (b), classed `governance` in `regions.js`.

**Where in evidence documents does the field sit?**
Options: (a) directly after `schema_version`; (b) last key.
Both change the tests that pin full key lists. (a) keeps document-level metadata together at the top, which is where a reader looks.
**Chosen:** (a).

**One ticket or a split?**
Options: (a) one spec; (b) split into "resolver, CLI and CLI-written artifacts" and "skill-prose sinks".
The prose sinks are three small edits that depend on `faff version` existing; splitting adds a dependency link and a second review for little isolation. The CLI side is mechanical repetition of one stamp across known writers.
**Chosen:** (a), one ticket, built in two commits: first the resolver, CLI, schemas and CLI writers with their tests; second the three prose files. Each writer lands in the same commit as its schema change, so a schema and its writer never disagree on a commit (FAFF-1261 makes the mint refuse a writer/schema gap). FAFF-1257 is changing `recordReviewRound`, `writeCollatedReviewVerdict` and their schemas in both mirrored trees; if it merges first, rebase onto it and re-run the `diff -rq` check, which is the only guard against a `faff_version` property dropped from one tree. This is settled now, not at review: one ticket, one PR, two commits. Review that finds the diff large asks for a clearer commit, never a second ticket.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None. The three questions on the ticket are settled in section 6.

### Assumptions

- **Assumes:** a marketplace plugin install keeps `.claude-plugin/plugin.json` at `$CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json`, so it is four levels above `skills/faff/bin/lib/`. Validation: before starting, confirm `.claude-plugin/marketplace.json` names `source: "./plugin"` (it does today) and, if a marketplace install is available, run `faff version --json` there. If it reports `source: "default"`, the build still proceeds (the field writes `unknown`) and the gap is filed as the follow-up named under Failure modes.

## 8. DONE

### From WHY
- [ ] In a repo checkout, the `faff_version` written by `faff run-ledger init-interactive` (into `owner` and the genesis `data`), `faff evidence write ac-checklist`, `faff evidence write review-verdict --terminal-only` and `writeMergeRecord` each equals the `version` in `plugin/.claude-plugin/plugin.json`.
- [ ] No writer other than `faff-version.js` reads `plugin.json` (a repository search for `claude-plugin` under `plugin/skills/*/bin` finds only that module).

### From WHAT (types and interfaces)
- [ ] `faff version` prints the bare version (`0.42.0` in this checkout) and exits 0.
- [ ] `faff version --json` prints `{"version":"<v>","source":"plugin-json"}` and exits 0; with an unresolvable path it prints `{"version":"unknown","source":"default"}` and exits 0.
- [ ] `faff version --bogus` exits 2.
- [ ] `version` is a `COMMANDS` entry, has a `docs/guide/cli.md` row, and `faff lint-cli-doc` and `faff lint-cli-coverage` pass.
- [ ] `faff-version.js` requires only `node:fs` and `node:path`, carries a region banner, is classed `governance` in `regions.js`, and `faff regions check` passes.
- [ ] `faff version --selftest` covers: valid version, prerelease version, missing file, non-JSON, non-object, wrong `name`, missing `version`, non-string `version`, `"0.42"`, `"0.42.0-"`, a module directory not ending in `skills/faff/bin/lib` (gives `unknown` even beside a valid `plugin.json`), a failed read not being memoised, and injected calls not changing the memoised value.
- [ ] Each of these schemas gains exactly the optional `faff_version` string property and nothing else: `run-ledger` (`owner` and `owner_history.items`), `events/run-start` (`data`), `ac-checklist`, `review-verdict-anchored`, `review-round`, `spec-review-verdict-anchored`, `build-progress`, `landing-progress`, and `holdout-anchored`.
- [ ] `classifySchemaChange(base, head)` reports every one of those schema diffs as additive (no reasons).
- [ ] `diff -rq verification/evidence/v0.3 plugin/skills/faff/contracts/evidence-v0.3` prints nothing.
- [ ] No file matching `plugin/skills/faff/contracts/*.schema.json` (top level) is changed, so `contract_schema_versions` is unchanged.

### From HOW (behaviour)
- [ ] Evidence documents carry `faff_version` as the second key, directly after `schema_version`, and still validate.
- [ ] `build-progress.json` and `landing-progress.json` carry the current writer's version after every write.
- [ ] L2 genesis `data` is exactly `{"faff_version":"<v>"}`; L3 and L4 genesis `data` is exactly `{"level":"L3"|"L4","faff_version":"<v>"}`; `faff events verify` passes on each.
- [ ] A resume keeps the prior owner byte-for-byte in `owner_history` and writes the resuming version into the new `owner`.
- [ ] `owner.faff_version` survives every later ledger write in the run through to the terminal `status: "done"` write.
- [ ] `merge-record.json`, `custody-verdict.json`, the judge-trail `manifest.json` and `.faff/provenance/<ISSUE>.json` carry `faff_version`; `PROVENANCE_SCHEMA` is still `2`; the intake-record no-downgrade path still writes nothing.
- [ ] A run admitted to Commissaire in-process after this change has a seq-0 admission whose `payload` carries exactly the five v0.3 keys and validates against `verification/commissaire-facade/v0.3/schema/admission.schema.json`; `commissaire audit verify` exits 0 on it.
- [ ] `git diff --stat` shows no change to `commissaire.ts`, `commissaire.js`, `build-manifest.json` or anything under `verification/commissaire-facade/`.
- [ ] The governor-client admit path is unchanged: it appends the governor's record verbatim and adds no field.
- [ ] `kernel.md:455`, faff-prep SKILL.md (stamp bullets, refresh rule, detection fixture, prep marker example) and faff-beep-boop SKILL.md (owner field list, enrichment merge) describe the new segment and field, and `faff validate-adapters` passes.

### From HOW (edge cases and back-compat)
- [ ] With `plugin.json` absent, every CLI writer above still writes successfully and stamps `unknown`.
- [ ] Every committed anchor under `.faff/anchors/` and every `schema/examples/*.example.json` still validates with the new schemas.
- [ ] A ledger without `owner.faff_version` is mutated by the new CLI with no schema error and no added field (unless the write is a mint or resume).
- [ ] The signed fixture `test/fixtures/commissaire/secret-free-replay/declared-effects.jsonl` is not regenerated or edited, and the tests that replay it pass unchanged.

### Tests (repository test floor)
- [ ] `test/run-ledger-init-self-drain.test.mjs` (the "no data field at all" case near line 276) and `test/run-ledger-init-interactive.test.mjs` (near line 95) assert the new exact L2 genesis `data` shape instead of an absent `data`.
- [ ] `test/evidence-write.test.mjs` exact-text and exact-key assertions (near lines 47, 55, 92 and 110) assert the new exact shapes, including `faff_version` as the second key.
- [ ] Any other test that fails on the new field is updated to the new exact shape, never loosened; the PR description lists each updated assertion.
- [ ] New tests cover: the resolver table above, ledger mint and resume stamping, genesis stamping at L2/L3/L4, each evidence writer, and the additive classification of each changed schema.
- [ ] The full test suite and `faff regions selftest` pass.
- [ ] The PR description records the result of `faff version --json` on a marketplace plugin install, or, when none is available or it reports `source: "default"`, links the follow-up ticket filed for a second lookup location.

### Integration smoke test

```
1. In a temp repo with this checkout's faff on PATH:
   a. faff version --json                        -> {"version":"0.42.0","source":"plugin-json"}
   b. faff run-ledger init-interactive --issue FAFF-1 ...
   c. read run-ledger.json                       -> owner.faff_version == "0.42.0"
   d. read events.jsonl genesis run-start        -> data == {"faff_version":"0.42.0"}
   e. echo '{"all_verified":true}' | faff evidence write ac-checklist --run-dir <run> --issue FAFF-1
   f. read ac-checklist.json                     -> keys: schema_version, faff_version, all_verified
   g. validate ac-checklist.json against the bundled ac-checklist schema -> no violations
   h. faff events verify --run-dir <run>         -> pass
2. Copy plugin/skills/faff to a temp tree with no .claude-plugin/plugin.json four levels above bin/lib,
   and repeat steps 1a-1h with that copy's bin/faff
   -> every faff_version reads "unknown", faff version --json reports source "default",
      and every command exits as in step 1
```

confidence: high

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}]}
```

_Agent-authored (faff-prep, interactive)._
