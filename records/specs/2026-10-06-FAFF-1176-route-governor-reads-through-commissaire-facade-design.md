# FAFF-1176: Route the runner's governor reads through the Commissaire facade, with no behaviour change

> Spec: faffter-dark-nlspec · 2026-10-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1176.

This spec is for the agent that builds FAFF-1176 and for the humans who review its pull request. It adds one read verb to the Commissaire facade and one exported key resolver, and moves every runner read of governor or producer key files behind them. Every on-disk state leads to the same decision as today; the one deliberate change is that a failed status call now stops the step (section 1, "What changes").

Revised 2026-10-06 (second revision) to the human decision in comment 08c09091: a failed `commissaire contract status` call stops the step with a named error, uniformly, with no per-site fallback. This replaces the per-site fault policy added after spec-review round 1. The round-3 minors are folded in, and the round-4 minors (the counted phrase on lines 560 and 647; the prep-time inventory of skill text) are fixed. Spec-review round 5 reviewed that text. The two round-5 text fixes (one physical line per skill-file insertion; the fail-loudly rule wins on mixed output) are applied per the human decision in comment dcb4ad5c, which also accepts the spec for build with no further review round.

## 1. Why

**The model.** `commissaire.ts` becomes the only code that knows where Commissaire's key material lives on disk. Everything else asks it: the two skills ask the new read verb `commissaire contract status` whether a run is governed, and `merge-gate.js` asks a new exported resolver for the chokepoint key. When a later ticket moves `SK_commissaire` out of the run directory, it changes those two answers inside one module and nothing else.

**Problem.** Today `faff-graft/SKILL.md` (9 lines) and `faff-beep-boop/SKILL.md` (1 line) decide whether a run is governed by checking that `<run_dir>/commissaire/governor/governor.json` exists, and `resolveGrantByEffectKind` in `merge-gate.js` opens `commissaire/producer/pk.json` through the imported `pkFileOf` and `producerDirOf` helpers. Moving the signing key (FAFF-1177, FAFF-1178, FAFF-1179) would therefore mean editing two skill prompts and a merge-gate leg in the same change as the custody move. This ticket moves those reads behind the facade first, under today's in-process custody, so that later change stays inside `commissaire.ts`.

**Design principles.**

**Same decision for every on-disk state.** For every state of the run directory, including malformed files, each caller reaches the decision it reaches today. Where a cleaner reading would change an edge case (for example a `pk.json` that parses to JSON `null`), keep today's outcome. FAFF-1170's malformed-record parity tests set the precedent: no new null-to-deny branch. FAFF-1178 is the ticket that changes how the chokepoint key is trusted; this ticket must not do that work early.

**A failed status call fails closed, the same way everywhere.** This is a human decision (comment 08c09091). The skills replace an in-process file check, which cannot fail, with a subprocess call, which can. Any failure of that call stops the step with the error `commissaire-status-failed`. No site reads a failure as "governed" or as "not governed".

**Record shapes do not change.** No ledger record, `governor.json`, `pk.json`, producer file or anchor changes shape. The status verb is a read projection, not a record.

**No new require edges.** `commissaire.ts` keeps its current local requires, so `test/commissaire.test.mjs`'s require allowlist and the standalone import-independence walk pass unchanged.

**What changes.** Three things differ from today, and nothing else:

- On a host where the status verb fails (a stale or missing emit, a Node runtime fault, a crash, or a call that does not return within 30 seconds), the step stops with `commissaire-status-failed`. Today's file check has no failure state.
- Each governed-run check now starts a Node process (about 100 to 250 ms on the maintainer's machine for a `node` start), up to ten times in one graft.
- The merge, pr-create and grant code paths are unchanged; only where `merge-gate.js` gets its `pk.json` record from moves.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` (and its committed `.js` emit) | TypeScript | Home of the new verb, the resolver and the internal governor accessor. `governorDirOf`, `producerDirOf`, `governorFileOf`, `pkFileOf` at lines 120 to 124; `verifyAuthLeg` at 324; `cmdAdmit` at 562; `cmdAdmitRequired` at 624; dispatch tables at 958, 974 and 988; `usage()` at 508; exports at 1256 |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveGrantByEffectKind` at 959 reads `pk.json` at line 980 through `commissairePkFile(commissaireProducerDir(runDir))`; import at line 48 |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | 954 lines. Nine lines name `<run_dir>/commissaire/governor/governor.json`: 164, 286, 298, 300, 414, 558, 560, 623, 647. Line 164 is a bullet in the "Mint the interactive run substrate" list |
| `plugin/skills/faff-beep-boop/SKILL.md` | Skill prose | 776 lines. One line names it: 442 (run-start admit skip) |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | `SKILL_LINE_BASELINE` at line 65: faff-graft 955, faff-beep-boop 777. Growth above the baseline fails; a shrink prints a ratchet advisory |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript, governance region | `mintIssueAnchor` (declared at line 1474; the next top-level declaration is `function eventsSelftest` at 1555) builds `commissaire/producer/pk.json` by path at line 1530 to byte-copy the public key into a per-PR anchor (FAFF-976) |
| `test/commissaire-standalone.test.mjs` | Test | Import-independence walk from `bin/commissaire` and `lib/commissaire.js` |
| `test/commissaire.test.mjs` | Test | Require allowlist at about line 276; imports `pkFileOf`, `governorFileOf`, `governorDirOf`, `producerDirOf` |
| ADR-0123 | Decision record | Noun-verb grammar `commissaire <object> <action>`; objects `contract`, `effect`, `verdict`, `audit` |
| ADR-0132 and repo `AGENTS.md` | Decision record | The committed `.js` emit beside each `.ts` is the governed artifact; rebuild with `cd plugin/skills/faff && npm install && npm run build` |

Line numbers and counts are from origin/main `35dae0a1` (2026-10-06). The build re-reads them on whatever main holds at graft time.

**Scope.** This is the first slice of the out-of-process governor set (FAFF-1109 decides the shape; FAFF-1177, FAFF-1178 and FAFF-1179 move the key). It blocks FAFF-1178 and FAFF-1179, and is blocked by FAFF-1180.

## 2. Out of scope

- **Trusting a pinned key at the chokepoint.** Why excluded: FAFF-1178 owns verifying grants against a committed fingerprint; today the resolver keeps reading key and fingerprint from the same `pk.json`. Extension point: the body of the new resolver in `commissaire.ts`.
- **Moving `SK_commissaire` out of the run directory, or any custody value other than `in-process`.** Why excluded: FAFF-1109 decides the process shape and FAFF-1177 builds it. Extension point: the internal governor accessor and the status verb's `custody` field.
- **The anchor's public-key copy in `events.js`.** Why excluded: `events.js` is in the governance region and `commissaire.ts` is in the factory region, so `events.js` may not require `commissaire.ts`; and the copied path is the committed anchor layout that FAFF-976 tests and CI re-verification read, which the key move does not change (the published public key stays in the producer directory). Extension point: `mintIssueAnchor` in `events.js`, if a later ticket moves the published key.
- **Shared typed identities.** Why excluded: FAFF-1180 moves the `OpaqueId`, `ProducerId` and `ContractRevisionId` brands into `bin/lib/ids.ts`. This ticket uses no identity brand. Extension point: none needed; the build rebases on whatever main holds.
- **Publishing the status output in `verification/commissaire-facade/`.** Why excluded: the facade reference publishes record schemas, and the status output is not a record. Extension point: a later `v0.3` if an external consumer needs it.
- **Rewording the RFC documents.** Why excluded: `docs/rfc/.../STATE-AUTHORITY-MAP-v5.md` and `docs/guide/verify-run-evidence.md` describe the on-disk layout, which is unchanged. Extension point: the ticket that moves the key.
- **A new run stop-reason token.** Why excluded: faff-beep-boop reuses the FAFF-1140 run-start failure path (section 3). Extension point: `faff disposition`'s escalate-class tokens, if operators need to tell the two causes apart.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Governed run | A run directory whose governor file exists at `governorFileOf(governorDirOf(runDir, override))`. This is the exact predicate the skills use today. |
| Governor material | The governor file: `{ sk, pk, pk_fingerprint, master_secret }`, written by `contract admit`. Secret. |
| Chokepoint key record | The parsed contents of the producer directory's `pk.json`: `{ pk, pk_fingerprint }`, public. |
| Custody | Where `SK_commissaire` is held. Today the only value is `in-process`: the runner process holds it in its own run directory. |
| Governed-run check | The single skill instruction that calls the status verb and either returns governed / not governed or stops with `commissaire-status-failed`. |
| Status failure | Any of: the verb exits non-zero; it has not returned within 30 seconds; its stdout is anything other than exactly one parseable JSON object with a boolean `governed` (mixed output, extra lines or a second object included), whatever `"governed"` appears to say. |

### The read verb

```
commissaire contract status --run-dir DIR [--governor-dir D] [--json]
faff commissaire contract status --run-dir DIR [--governor-dir D] [--json]

RECORD StatusOutput:                 # printed as one JSON line on stdout
  governed: Boolean                  # true iff the governor file exists (fs.existsSync), whatever its contents
  custody: "in-process" | null       # "in-process" when governed; null when not
  pk_fingerprint: String | null      # governor file's pk_fingerprint when it parses to an object
                                     #   carrying a string pk_fingerprint; else null
  CONSTRAINT keys are exactly { governed, custody, pk_fingerprint }; no other field is ever printed

EXIT:
  0  --run-dir names an existing directory (governed or not)
  2  --run-dir missing, or not an existing directory (message on stderr, nothing on stdout)
```

- `--json` is accepted and changes nothing: the verb always prints JSON, as `contract admit-required` does.
- `--governor-dir` mirrors `contract admit` and `audit verify`. The skills never pass it.
- The verb writes nothing, appends no ledger record, takes no lock, makes no network call and never prints `sk` or `master_secret`.

**Chosen:** the verb name `contract status`. ADR-0123's `contract` object owns admission, and "is this run admitted and with what key" is a question about that admission. `audit` holds evidence operations over a finished trail, and `effect` holds per-effect operations. No flat alias is added: the flat verbs exist to keep FAFF-828's original spellings working, and `audit verify`, `audit export` and `audit anchor` were also added without one.

**Chosen:** `governed` is file existence, not "parses as governor material" and not `hasGovernanceContext` (any `schema:3` ledger record). File existence is what both skills test today, so admit-skip and every producer-half step make the same decision on every on-disk state, including a present-but-corrupt governor file. `custody` follows `governed`, so a corrupt governor file reports `in-process`; nothing consumes `custody` yet, and FAFF-1177 owns its meaning once a second value exists.

**Chosen:** `pk_fingerprint` comes from the governor file, never from `pk.json`. FAFF-978 made the governor file the authoritative public key and `pk.json` the producer-writable copy. The skills do not consume this field; it is reported so FAFF-1178 has a facade-owned place to read the fingerprint.

**Chosen:** the status verb applies addendum decision 4's freeze as not applicable. The freeze bars new governed effect kinds and new adjudication modules. This verb reads existing state, adds no effect kind to `KIND_AUTHOR` or the admit scope, writes no record and decides nothing.

### The chokepoint key resolver

```
FUNCTION readChokepointKeyRecord(runDir: String, producerDir?: String)
    -> { ok: true, record: unknown } | { ok: false }
  # exported from commissaire.ts
  1. path := pkFileOf(producerDirOf(runDir, producerDir))
  2. TRY parse JSON from path
       ON read error or JSON parse error -> RETURN { ok: false }
  3. RETURN { ok: true, record: <the parsed value, unvalidated> }
```

`merge-gate.js` replaces lines 979 to 981 with:

```
key := readChokepointKeyRecord(runDir)
IF NOT key.ok: RETURN "absent-or-invalid"
pkRec := key.record
# lines 982 to 985 unchanged: pkRec.pk and pkRec.pk_fingerprint are read exactly as today
```

and its import at line 48 drops `pkFileOf: commissairePkFile` and `producerDirOf: commissaireProducerDir` and adds `readChokepointKeyRecord`.

**Chosen:** return the parsed value unvalidated and leave the `pkRec.pk` reads in `merge-gate.js`. Today a `pk.json` that parses to JSON `null` makes `pkRec.pk` throw a `TypeError` out of `resolveGrantByEffectKind`; `cmdMergeGateLocal` (line 1283), `cmdMergeGate` (line 1614) and `cmdPrCreate` (line 1772) do not catch it, while `mergeCoveredBySchema3Grant` and `prCreateCoveredBySchema3Grant` do. A resolver that validated the shape would turn that throw into `absent-or-invalid` on the uncaught paths, which is a behaviour change. FAFF-1178 rewrites this resolver to verify against a pinned key and may tighten it then.

**Chosen:** keep `pkFileOf`, `producerDirOf`, `governorFileOf` and `governorDirOf` exported. `test/commissaire.test.mjs` imports them and must pass unchanged. After this ticket no production module outside `commissaire.ts` and `events.js`'s anchor copy uses them or builds the paths they return.

### The internal governor accessor

Inside `commissaire.ts`, the governor-file reads go through one module-private function:

```
FUNCTION readGovernorRecord(runDir, governorDirOverride?) -> GovernedRecord | null
  RETURN parseGovernedRecord(readJson(governorFileOf(governorDirOf(runDir, governorDirOverride))))
```

| Call site | Today | After |
|---|---|---|
| `verifyAuthLeg` (line 326) | `parseGovernedRecord(readJson(governorFileOf(governorDirOf(runDir, governorDir))))` | `readGovernorRecord(runDir, governorDir)` |
| `cmdRequestDecision` (line 691) | same expression with `strFlag(flags, "--governor-dir")` | `readGovernorRecord(runDir, strFlag(flags, "--governor-dir"))` |
| `cmdTerminalVerdict` (line 803) | same expression | `readGovernorRecord(runDir, strFlag(flags, "--governor-dir"))` |
| new `cmdContractStatus` | none | `fs.existsSync(governorFileOf(governorDirOf(runDir, override)))` and `readGovernorRecord` |

`cmdAdmit` is not touched: its refusal check (line 578), its write (line 596) and the selftest's direct read (line 1186) stay exactly as they are.

**Chosen:** add `readGovernorRecord`. It replaces three identical expressions inside the module, gives FAFF-1177 one function to change instead of three, and adds no require and no exported name.

### Skill prose: one governed-run check, failing closed

Both skills state the check once, in one sentence that is identical byte for byte in both files, and every governed step refers to it. The sentence (the build copies it verbatim; `<run dir>` is literal text, because each skill already names its run-directory variable in the surrounding prose):

```
Governed-run check: run `"$faff" commissaire contract status --run-dir <run dir>`. If the call exits non-zero, has not returned within 30 seconds, or its stdout is anything other than exactly one parseable JSON object with a boolean `governed`, stop with the error `commissaire-status-failed` and take neither the governed nor the ungoverned path, whatever `"governed"` appears to say; otherwise the run is governed when that object's `governed` is `true` and not governed when it is `false`.
```

Where each skill places it, and what a stop means there:

```
faff-graft
  new bullet, inserted directly above line 164 in the "Mint the interactive run substrate" list:
    - **Is this run governed? (used by every governed step in this skill; `<run dir>` is "$run_dir")**
      <the sentence> In this skill a `commissaire-status-failed` stop is a needs-human park
      (park protocol), naming the error and the call's exit code or "timeout" or "unparseable output".
  line 164 (admit skip):
    "Skip when governor material already exists (`<run_dir>/commissaire/governor/governor.json`
     present — ...)" becomes "Skip when the governed-run check reports governed (...)"
  lines 286, 298, 300, 414, 558, 560, 623, 647:
    "governor material is present at `<run_dir>/commissaire/governor/governor.json`"
    becomes "the governed-run check reports governed"
    lines 560 and 647 each carry two clauses: "When the run is governed — governor material present
     at `<run_dir>/commissaire/governor/governor.json`" becomes "When the governed-run check reports
     governed", and "(no governor material)" becomes "(the governed-run check reports not governed)".
     So every one of the nine lines contains the phrase "the governed-run check reports governed".

faff-beep-boop
  line 442 (run-start admit skip): the governor.json clause becomes
    "the governed-run check reports governed (`<run dir>` is "$FAFF_RUN_DIR"). <the sentence> Here a `commissaire-status-failed` stop fails the run start closed through the
     same path a governance-required admit failure takes below (park event, andon pump,
     owner.status "done", stop_reason "governance-admit-failed", admitted []), with the error named
     in the run log."
```

**Each insertion is one physical line.** The placement block above wraps the new faff-graft bullet and the faff-beep-boop replacement for display only. In the files, the faff-graft bullet (its bold label, the sentence and the park clause) is a single line, and the faff-beep-boop edit stays within line 442. Every site edit replaces text inside its existing line. That is what the line-count expectation below rests on, and the line baselines stand (human decision, comment dcb4ad5c).

**The fail-loudly rule wins.** The sentence parses before it reads: the stop rule is applied first, and `governed` is read only from a single parsed JSON object. Output that merely contains `"governed":true` (a warning line before the JSON, two lines, a second object) is a status failure, not a governed run (human decision, comment dcb4ad5c).

The named error carries only a reason class (`exit <n>`, `timeout` or `unparseable output`), never the verb's stderr text, so nothing from a run-dir path or a defective emit is copied into a tracker comment.

**Chosen:** a status failure stops the step at every site, with the one error name `commissaire-status-failed` (human decision, comment 08c09091). There is no per-site fallback: no site reads a failure as governed or as not governed. Each skill's existing stop mechanism carries the stop (a needs-human park in faff-graft, the FAFF-1140 run-start failure in faff-beep-boop).

**Chosen:** state the check once per skill and refer to it by name at each site, rather than repeating the full rule ten times. One sentence is one thing to test and one thing to change when custody moves.

**Chosen:** expected line counts after the edits, relative to main at graft time: faff-graft grows by exactly one line (the new definition bullet; every site edit replaces text within its existing line), and faff-beep-boop does not change. On `35dae0a1` that is faff-graft 955 and faff-beep-boop 776. Set `SKILL_LINE_BASELINE` to the two resulting counts: faff-graft 955 (unchanged on `35dae0a1`) and faff-beep-boop 776 (lowered from 777 to lock the existing shrink). If main has moved, apply the same deltas (+1, +0) to main's counts.

### Mechanical check of the skill prose

A new test, `test/commissaire-status-skill-sites.test.mjs`, reads both `SKILL.md` files from disk and asserts, with plain string operations and no judgement:

```
CANONICAL := the governed-run check sentence above, as a string constant in the test

FOR file IN [faff-graft/SKILL.md, faff-beep-boop/SKILL.md]:
  1. count of CANONICAL in file == 1
  2. count of lines containing "the governed-run check reports governed" == SITES[file]
       # SITES = { faff-graft: 9, faff-beep-boop: 1 }
  3. file contains none of: "governor.json", "governor material",
       "commissaire-status-fault", "run the bracket"
  4. every line containing "commissaire contract status" also contains CANONICAL
       # the verb is called only through the one check, never ad hoc
FOR every other plugin/skills/*/SKILL.md:
  5. file contains neither "governor.json" nor "commissaire contract status"
```

If a later ticket adds a governed step, it updates `SITES`; the test makes that a visible, reviewed change.

Inventory at prep time (origin/main `35dae0a1`), so the checks force no edits beyond the ten listed lines: "governor material" and "governor.json" occur in faff-graft only on lines 164, 286, 298, 300, 414, 558, 560, 623 and 647, and in faff-beep-boop only on line 442; "commissaire contract status" occurs nowhere; no other `plugin/skills/*/SKILL.md` contains any of the three strings. If main has moved by graft time, the build re-runs the same inventory and treats any new occurrence as an eleventh site to convert, not as text to reword around.

## 4. How

### Build order

```
PROCEDURE build_faff_1176():
  1. Rebase on origin/main after FAFF-1180 merges. commissaire.ts may then import brands from ids.ts;
     build on that file as it stands. Nothing in this ticket uses an identity brand.
  2. In commissaire.ts:
     a. add readGovernorRecord (module-private) and switch the three call sites in the table
     b. add and export readChokepointKeyRecord
     c. add cmdContractStatus
     d. register "contract status" in COMMISSAIRE_DISPATCH and REQUIRED_FLAGS_BY_CANONICAL (["--run-dir"]);
        no COMMISSAIRE_ALIASES entry; COMMISSAIRE_SPEC needs no new flag (--run-dir, --governor-dir and
        --json already exist); COMMISSAIRE_SURFACE.subcommands picks the verb up automatically, because
        buildCommissaireSubcommands derives it from REQUIRED_FLAGS_BY_CANONICAL
     e. add the verb's line to usage() and update the header comment's subcommand list
  3. cd plugin/skills/faff && npm install && npm run build; commit the regenerated commissaire.js
  4. merge-gate.js: switch the import and the pk.json read as in section 3
  5. faff-graft and faff-beep-boop SKILL.md: the governed-run check and the ten site edits;
     set SKILL_LINE_BASELINE as in section 3
  6. docs/guide/cli.md: add `commissaire contract status` to the example list in "Commissaire as its own CLI"
  7. add the new tests (section 5 and Done); run the full suite, faff regions check, faff validate-adapters
```

### cmdContractStatus

```
PROCEDURE cmdContractStatus(flags):
  1. runDir := requireRunDir(flags, "contract status")
     IF null: RETURN 2                     # requireRunDir already wrote the stderr message
  2. override := strFlag(flags, "--governor-dir")
  3. governed := fs.existsSync(governorFileOf(governorDirOf(runDir, override)))
  4. IF governed:
       gov := readGovernorRecord(runDir, override)      # null when unreadable or not an object
       fp  := (gov AND typeof gov.pk_fingerprint === "string") ? gov.pk_fingerprint : null
       out := { governed: true, custody: "in-process", pk_fingerprint: fp }
     ELSE:
       out := { governed: false, custody: null, pk_fingerprint: null }
  5. print JSON.stringify(out) on one line; RETURN 0
```

The handler must not throw on any file state: `readJson` already returns `null` on read or parse failure. Property names are written in that order. The verb does only two synchronous file reads, so it returns in the time `node` takes to start; the 30-second limit in the governed-run check exists for a broken host, not for normal operation.

**Anti-pattern:** spreading or copying the governor record into the output. Why: it carries `sk` and `master_secret`; the output is built from three named fields only.

**Anti-pattern:** reporting `governed` from `hasGovernanceContext` or from a successful parse. Why: either changes the admit-skip decision for a run with a corrupt governor file or with ledger records but no governor file, which the skills treat today by file existence alone.

**Anti-pattern:** a site that catches a status failure and continues on either branch. Why: the human decision makes every failure a stop; the skill-site test rejects the old per-site wording.

### Edge cases

```
STATE                                           STATUS OUTPUT                    SKILL ACTION (today -> after)
run dir present, no commissaire/ dir            {false, null, null}              not governed -> not governed
governor file present, valid                    {true, "in-process", "<fp>"}     governed -> governed
governor file present, empty or invalid JSON    {true, "in-process", null}       governed -> governed
governor file present, no pk_fingerprint        {true, "in-process", null}       governed -> governed
run dir missing                                 exit 2                           not governed -> stop (commissaire-status-failed)
verb exits non-zero for any other reason        exit n                           (no such state) -> stop
verb prints unparseable output                  -                                (no such state) -> stop
verb has not returned in 30 seconds             -                                (no such state) -> stop
```

The run-dir-missing row cannot arise at any of the ten sites: faff-graft and faff-beep-boop both mint the run directory before the first check.

Resolver parity, per `pk.json` state, for `resolveGrantByEffectKind` on a governed run that has a covering verdict:

```
pk.json STATE                         TODAY                         AFTER
missing / unreadable                  "absent-or-invalid"           "absent-or-invalid"
invalid JSON                          "absent-or-invalid"           "absent-or-invalid"
parses to null                        TypeError thrown              TypeError thrown
parses to an object, valid key        chokepointPermit result       same
parses to an object, swapped key      chokepointPermit result       same (FAFF-1178 changes this)
```

### Failure modes

- **The failure:** a skill site is reworded so it no longer refers to the check, or calls the verb directly with its own fallback. **How you'd know:** `test/commissaire-status-skill-sites.test.mjs` fails on the site count, the forbidden phrases or the direct-call rule. **What it means:** fix the line; the test also guards later tickets.
- **The failure:** the emit drifts from the source because the build step was skipped. **How you'd know:** the standalone and verb tests read the committed `.js`, so `contract status` is missing and they fail; on a live host every governed step stops with `commissaire-status-failed` instead of proceeding. **What it means:** rebuild and commit the emit. The stop is the intended, visible outcome.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run directory on which `faff commissaire contract admit` succeeded
When `faff commissaire contract status --run-dir <dir> --json` runs
Then it exits 0 and prints exactly {"governed":true,"custody":"in-process","pk_fingerprint":<the pk_fingerprint field of admit's JSON output>}
And stdout contains neither "sk" nor "master_secret" as a key
```

```
Given a freshly minted interactive run directory with no Commissaire material
When the same command runs
Then it exits 0 and prints {"governed":false,"custody":null,"pk_fingerprint":null}
```

```
Given a path that does not exist, and separately a path to a regular file
When `faff commissaire contract status --run-dir <path>` runs for each
Then each exits 2 with a message on stderr and nothing on stdout
```

```
Given an admitted run whose governor material was written with `contract admit --governor-dir <G>`
When `faff commissaire contract status --run-dir <dir> --governor-dir <G>` runs
Then it reports governed true and the fingerprint admit printed
And without --governor-dir the same run reports governed false
```

```
Given any run directory
When the verb runs once with --json and once without
Then the two stdout byte strings are identical
```

- Both `SKILL.md` files contain the governed-run check sentence exactly once, faff-graft refers to it at nine sites and faff-beep-boop at one, and neither names `governor.json`.
- No production module under `plugin/skills/faff/bin/lib/` other than `commissaire.ts`, `commissaire.js` and the anchor copy in `events.js` names `pk.json`, `governor.json`, `pkFileOf`, `producerDirOf`, `governorFileOf` or `governorDirOf`.
- The merge, pr-create and branch-delete grant results are identical before and after the change for every `pk.json` state in the parity table.

## 6. Design decision rationale

**Which verb name?** Options: `contract status`; `audit status`; a flat `status`. `audit` groups evidence operations over a finished trail, and a flat verb would grow the top level, which ADR-0123 set out to stop. **Chosen:** `contract status`. The question is about the run's admission, which the `contract` object owns.

**What does `governed` mean?** Options: governor file exists; governor file parses; any `schema:3` ledger record. Only the first matches what both skills test today. **Chosen:** governor file exists.

**Where does the reported fingerprint come from?** Options: the governor file; `pk.json`; both with a cross-check. **Chosen:** the governor file. FAFF-978 made it authoritative, and a cross-check is `audit verify`'s job.

**Should the resolver validate the key record?** Options: return `{ pk, pk_fingerprint }` validated; return the parsed value unvalidated. Validating turns today's uncaught `TypeError` on a `null` record into a fail-closed result, which is safer but is a behaviour change on three uncaught call paths. **Chosen:** unvalidated, for exact parity; FAFF-1178 owns the hardening.

**What about the `pk.json` path in `events.js`?** Options: route it through `commissaire.ts` (illegal: governance may not require factory); move the path helpers into a governance module such as `producer-auth.ts` (moves the custody seam out of `commissaire.ts`, against the ticket's intent); leave it with a recorded reason. **Chosen:** leave it. It copies the published public key into the anchor layout that FAFF-976 tests and CI read; the custody move changes where the secret key lives, not that layout. The seam test permits it as the one exception.

**How does a skill handle a failed status call?** Options considered across review rounds: read every failure as not governed (lets a broken verb skip governance steps silently, round-1 infosec major); split the handling per site (a second change inside a refactor, round-3 methodology major); stop the step everywhere. **Chosen:** stop the step everywhere with `commissaire-status-failed`; this is the human decision in comment 08c09091.

**One shared check or ten inline rules?** **Chosen:** one sentence per skill, referenced by name at each site, checked byte for byte by a test.

**Which beep-boop stop path?** Options: a new stop-reason token; the existing FAFF-1140 run-start failure path. **Chosen:** the existing path, so `faff disposition` already escalates it; the run log names the actual error.

**Add an internal governor accessor?** **Chosen:** `readGovernorRecord` only, for the three identical read expressions; `cmdAdmit` is left as is.

**Does addendum decision 4's freeze apply?** **Chosen:** no. The verb adds no governed effect kind and no adjudication module.

**Flat alias?** **Chosen:** none, matching the `audit` verbs added after FAFF-828.

## 7. Open questions and assumptions

**Open questions.** None.

**Assumptions.**

- **Assumes:** the build host has Node 22.18 or later and can run `npm install` under `plugin/skills/faff/` to fetch `typescript` and `@types/node` from the committed `package.json`. Validation: `node --version`; `cd plugin/skills/faff && npm install && npm run build` exits 0 before editing.

## 8. Done

### From why
- [ ] No `plugin/skills/*/SKILL.md` names `commissaire/governor/governor.json` or "governor material".
- [ ] `merge-gate.js` no longer imports `pkFileOf` or `producerDirOf` from `./commissaire` and builds no `pk.json` path.
- [ ] The PR description lists the three changes in "What changes" (section 1) and no others.

### From what (verb)
- [ ] `faff commissaire contract status --run-dir DIR` and `commissaire contract status --run-dir DIR` print one JSON line with exactly the keys `governed`, `custody`, `pk_fingerprint`, and exit 0, for an admitted run and for an ungoverned run.
- [ ] Admitted run: `governed:true`, `custody:"in-process"`, `pk_fingerprint` equal to the `pk_fingerprint` field of `contract admit`'s output.
- [ ] Ungoverned run: `governed:false`, `custody:null`, `pk_fingerprint:null`.
- [ ] Missing `--run-dir`, a path that does not exist, or a path to a regular file: exit 2, empty stdout.
- [ ] `--json` is accepted and stdout is byte-identical with and without it.
- [ ] `--governor-dir D` reads `D/governor.json` (scenario in section 5).
- [ ] `"contract status"` is a `COMMISSAIRE_DISPATCH` key with required flags `["--run-dir"]`, has no `COMMISSAIRE_ALIASES` entry, and appears in `usage()` and in `COMMISSAIRE_SURFACE.subcommands`.

### From what (resolver and accessor)
- [ ] `readChokepointKeyRecord` is exported from `commissaire.ts` and returns `{ ok: false }` for a missing or unparseable `pk.json`, else `{ ok: true, record }` with the parsed value.
- [ ] `verifyAuthLeg`, request-decision and terminal-verdict read the governor file only through `readGovernorRecord`; `cmdAdmit` is unchanged.
- [ ] `commissaire.ts` adds no local require; `test/commissaire.test.mjs`'s require allowlist is unchanged.

### From what (skill prose)
- [ ] `test/commissaire-status-skill-sites.test.mjs` exists, holds the governed-run check sentence as a string constant identical to section 3, and passes all five checks in "Mechanical check of the skill prose".
- [ ] `SKILL_LINE_BASELINE` is faff-graft = main's faff-graft count + 1 and faff-beep-boop = main's faff-beep-boop count (955 and 776 on `35dae0a1`), and `faff validate-adapters` exits 0 with no ratchet advisory for either file.

### From how (behaviour and parity)
- [ ] A test covers every status row of the edge-case table that the verb itself produces (the first five rows), including a governor file that is empty and one that is an object with no `pk_fingerprint`.
- [ ] A test covers every row of the resolver parity table through the exported `resolveCommissaireDecisionGrant`, `resolvePrCreateGrant` and `resolveBranchDeleteGrant`. For a `pk.json` containing `null`, all three throw `TypeError` (none catches it), and `mergeCoveredBySchema3Grant` and `prCreateCoveredBySchema3Grant` return `false` (both catch it), before and after the change.
- [ ] A seam test scans `plugin/skills/faff/bin/lib/*.js` and fails on any occurrence of `pk.json`, `governor.json`, `pkFileOf`, `producerDirOf`, `governorFileOf` or `governorDirOf` (import destructuring and comments included) outside `commissaire.ts` and `commissaire.js`. In `events.js`, occurrences are permitted only between the line that starts `function mintIssueAnchor(` and the next line that starts, at column 0, with `function `, `async function ` or `module.exports`; any occurrence outside that range fails. At prep time the only occurrences outside `commissaire.*` are in that range and in the `merge-gate.js` import and read this ticket removes, so the test needs no other string edits.
- [ ] Status output never contains `sk` or `master_secret`: a test asserts the key set exactly.
- [ ] For an admitted run, a test asserts stdout is byte-equal to `{"governed":true,"custody":"in-process","pk_fingerprint":"<fp>"}` followed by a newline, so the one JSON object the governed-run check parses is pinned by the test, not only by the key order in the procedure.
- [ ] The existing `test/commissaire*.test.mjs`, `test/merge-gate*.test.mjs` and `test/pr-create-chokepoint.test.mjs` pass with no edits.
- [ ] `faff commissaire --selftest` passes.

### From how (docs and guards)
- [ ] `docs/guide/cli.md` lists `commissaire contract status`.
- [ ] `commissaire.js` is rebuilt from `commissaire.ts` and committed; `faff regions check` exits 0.
- [ ] `test/commissaire-standalone.test.mjs` (import-independence walk and runtime spawn guard) passes.
- [ ] Every commit carries `Signed-off-by`.

### Integration smoke test

```
1. dir := new temp run dir
2. faff commissaire contract status --run-dir dir         -> {"governed":false,"custody":null,"pk_fingerprint":null}
3. faff commissaire contract admit --run-dir dir --producer P1 --contract-revision r1 --scope merge  -> note pk_fingerprint
4. commissaire contract status --run-dir dir --json        -> {"governed":true,"custody":"in-process","pk_fingerprint":<noted>}
5. declare + authorize a merge for unit U, then resolveCommissaireDecisionGrant(dir, U, "main") -> "valid-grant"
6. remove dir/commissaire/producer/pk.json; resolveCommissaireDecisionGrant(dir, U, "main") -> "absent-or-invalid"
7. node --test test/commissaire-status-skill-sites.test.mjs -> pass
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4).** No issues. One 1 to 3 day unit: the verb, the resolver and the skill edits ship together because the skill edits need the verb. The failure rule is one sentence per skill, not a second policy.
- **Workstream fit (principles 1 and 5).** No issues. It sits in "Governed execution is compared with a strong one-shot control" beside FAFF-1178 and FAFF-1179, which it blocks.
- **Surfaced dependencies (principle 6).** No issues. FAFF-1180, which edits `commissaire.ts` in parallel, is now linked as blocking this ticket.
- **Risk profile (principle 7).** No issues. No new integration or external dependency; the parity tables and the skill-site test bound the behaviour risk.

confidence: high
build-tier: complex
spec-review: accepted by human decision (comments 08c09091 and dcb4ad5c) after round 5; no reviewer approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
