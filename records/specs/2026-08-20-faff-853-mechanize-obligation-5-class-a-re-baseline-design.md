# Spec — FAFF-853: `faff integrity-digest rebaseline` (Class-A re-baseline as a deterministic verb)

> Spec: faffter-dark-nlspec · 2026-08-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-853.

This spec is the buildable artifact for **FAFF-853**. Its audience is the build agent that will implement the verb and the human reviewer gating the custody-hardening change. It adds one new action to the existing `integrity-digest` CLI, tightens one guard on the corrective consumer, updates the obligation-5 prose that today hand-chains the sequence, and records the decision in a new ADR. It touches four surfaces: `plugin/skills/faff/bin/lib/integrity-digest.js`, `plugin/skills/faff/bin/lib/corrective.js`, `plugin/skills/faff/SKILL.md` (obligation 5), and `records/adr/`.

## 1. WHY — Problem and Principles

**The load-bearing model.** The concurrency contract's obligation 5 makes a trusted orchestrator hold ONE run-grain integrity manifest in its own conversation context across an untrusted build dispatch, and re-verify on return. When the orchestrator itself legitimately writes a bracketed member (e.g. `corrective author` adds a `corrective/<seq>-<issue>.json`), it must fold that write into the held baseline `M → M′` without ever laundering a pre-existing tamper into the new baseline. Today that fold is **prose the executor hand-chains** — snapshot → write → verify-old → snapshot-candidate → intended-content check — and the FAFF-843 spec-review caught a timing hole in exactly this hand-chaining. This ticket replaces the prose fold with a single deterministic CLI verb that performs the whole sequence as one atomic operation.

**Problem statement.** The Class-A re-baseline in obligation 5 is prose-only: the sequential executor manually orders five steps, and a mis-ordered or skipped step silently corrupts the custody chain (a tamper landing between two reads enters the candidate baseline). This change mechanizes the sequence as `faff integrity-digest rebaseline`, so the executor calls one verb that either emits a clean `M′` or refuses, never a partially-correct hand-chain.

**Design principles:**

- **Never-silently-clean.** The verb mirrors `verifyAndRecord`'s posture (`integrity-digest.js:224-308`): it emits `M′` (the "proceed" signal) on stdout **only** when every step passed. Any integrity failure exits non-zero with the failure named and **no `M′` on stdout**; any precondition/usage failure fails loud. A caller that reads stdout and gets a manifest can trust the fold ran clean end-to-end.
- **A re-baseline never launders a pre-existing tamper.** The verify-of-the-old-baseline step must name **exactly** the one member this write touched and nothing else. Any other named member is tamper and refuses — a tamper already on disk before the write can never be absorbed into `M′`.
- **The verb mechanizes the INPUTS to verify, not the authority fold.** It composes the candidate baseline `M′` deterministically; it does not touch `foldCorrectiveAuthority`'s five-branch table (`corrective.js:249-264`, ADR-0114). Downstream, `M′` is consumed by an ordinary `verify --manifest -` / the fold exactly as any hand-built baseline is.
- **The adversarial hollow-verify limit is inherent, not an open question.** A manifest carries no temporal witness, so a hollow snapshot taken at consumption is bit-for-bit indistinguishable from an honest pre-dispatch one. ADR-0114 rules `events.jsonl` out of the corrective consumer's surface and agent-dispatch events are not emitted for a single build dispatch, so no mechanical, adversarial-proof hollow-verify guard is achievable. The verb closes the **false-tamper** and **negligent-hollow** directions only; the adversarial backstop stays the obligation-5 on-return verify plus container isolation. This is a stated design boundary, carried honestly, not a punt.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/integrity-digest.js` | Node.js (CommonJS) | Home of the new verb; already exports `buildManifest`, `diffAgainstManifest`, `sha256`, `MANIFEST_VERSION` (`:451-455`) |
| `verifyAndRecord` (`integrity-digest.js:224-308`) | Node.js | In-module precedent for an ATOMIC multi-step op with never-silently-clean exit semantics (FAFF-784) |
| `corrective.js` (`cmdCorrectiveAuthor` `:416-504`, `cmdCorrectiveCheck` `:508-631`) | Node.js | Author emits the written file's `sha256` (`:494`/`:500`); check consumes `--manifest` and folds authority |
| `correctiveIntegrityDirs` (`corrective-integrity.js`) | Node.js | The single roster resolver: `corrective/` + `run-ledger.json` (+ per-issue files when `issue` set; + `events.jsonl` when `opts.events`) |
| `plugin/skills/faff/SKILL.md` obligation 5 (`:1165`) | Prose contract | The five-step Class-A sequence this verb replaces |
| ADR-0078 (Proposed), ADR-0114 (Accepted) | ADR | 0078 fixes the bracket+re-baseline sequence; 0114 fixes the authority fold |

**Scope statement.** This sits inside the gateway-owned `concurrency` slot contract (obligation 5): it hardens the custody chain's re-baseline bookkeeping arm, one layer below the authority fold and entirely above the merge floor.

## 2. OUT OF SCOPE

- **Class-B direct-edit re-baseline** — the orchestrator's own in-session edit of `run-ledger.json` (obligation 5's Class B) has no CLI-reported hash and must be composed from the held baseline-verified copy. The verb takes a caller-reported post-write `sha256`, which Class B does not have. **Extension point:** a future `rebaseline --held-copy <file|->` mode that recomputes the member from a supplied baseline-verified copy instead of a reported hash, in `cmdIntegrityDigest`.
- **Multi-member atomic writes** — a single write that touches more than one bracketed member. v1 folds exactly one touched member per invocation. **Extension point:** a repeatable `--written-path`/`--reported-sha256` pair set in `INTEGRITY_DIGEST_SPEC`.
- **The adversarial hollow-verify guard** — inherently unachievable (see WHY); explicitly not attempted. **Extension point:** none in this module — the backstop is the obligation-5 on-return verify + container isolation, owned elsewhere.
- **Changing the authority fold** — `foldCorrectiveAuthority`'s branch table (`corrective.js:249-264`) is untouched. **Extension point:** ADR-0114's fold contract, if a new basis is ever admitted.
- **Merge-gate / merge-floor behaviour** — obligation 4 is character-identical. **Extension point:** none; this is detection ahead of consumption only.
- **`events.jsonl` re-baselining** — event appends are exempt under the prefix rule (`diffAgainstManifest` `:161-164`) and need no re-baseline. **Extension point:** none; the prefix rule already tolerates appends.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Held baseline `M` | The run-grain manifest the orchestrator holds in conversation context, taken by `snapshot --run-dir <dir> --events` (`--issue` omitted) |
| Candidate `M′` | The post-write manifest the verb emits; byte-shape-identical to any `buildManifest` output, differing from `M` only in the one touched member |
| Touched member | The single member the reported write added or changed (a `corrective/<file>` sub-path, or a top-level leaf like `run-ledger.json`) |
| Class A write | A CLI-mediated trusted write that reports the `sha256` of the bytes it wrote (`corrective author` is the concrete v1 case) |
| Negligent hollow verify | A verify against a hollow/empty manifest that trivially reports clean, "verifying" nothing — catchable; distinct from an adversarial hollow, which is not |

**The `rebaseline` action.** Extends `cmdIntegrityDigest`'s dispatch (`integrity-digest.js:310-362`), which today rejects any action other than `snapshot|verify|hash` at `:321`.

```
COMMAND faff integrity-digest rebaseline
  --run-dir DIR            # required; the run directory
  --manifest <json|file|-> # required; the held baseline M (stdin "-" is the trusted path)
  --written-path PATH      # required; the just-written file, abs or runDir-relative
  --reported-sha256 HEX    # required; 64-hex; the writer's reported sha256 of the written bytes
  --events                 # optional; roster includes events.jsonl (match how M was taken)
  --issue ID               # optional; per-issue grain (match how M was taken); run-grain omits it
  --json                   # optional; machine-readable failure output

  STDOUT (exit 0 only): M′ as a single-line JSON manifest, nothing else
  EXIT 0  clean fold — M′ emitted
  EXIT 1  integrity failure — tamper paths / mismatch named on stderr (or --json), NO M′
  EXIT 2  usage/precondition failure — malformed manifest, roster mismatch, bad flags,
          unresolvable hasher (fail-loud); NO M′
```

**`--written-path` normalization.** Accept an absolute path under `runDir` or a runDir-relative path; **normalize to the runDir-relative rel FIRST**, then guard. Ordering is load-bearing: `relWithinRunDir` (`integrity-digest.js:138-141`) rejects *any* absolute path (`path.isAbsolute(rel) → not within`), so an absolute `--written-path` must be converted to a rel via `path.relative(runDir, resolve(writtenPath))` **before** the guard runs — never `path.join(runDir, writtenPath)` (which silently ignores an absolute second arg, the footgun). Apply `relWithinRunDir` to the resulting rel; a `..`-escaping rel then fails it → exit 2. The surviving rel resolves to either a top-level member key in `M.members`, or a `<sub>` inside a `dir` member's `files` map (the `corrective` case).

**Arg-spec change.** Add to `INTEGRITY_DIGEST_SPEC.flags` (`integrity-digest.js:183-190`): `"--written-path": { arity: 1 }`, `"--reported-sha256": { arity: 1 }`. No positional change (`action` stays the one positional).

**Manifest shape — unchanged.** `M′` is `{ version, grain, members }` exactly as `buildManifest` produces (`:128-132`). The verb adds **no field**. `MANIFEST_VERSION` stays `"d1"`.

**`corrective.js` — negligent-hollow guard.** In `cmdCorrectiveCheck`'s `--manifest` branch (`:545-568`), before the fold, tighten the current shape-only check (`:555-558`, which validates only `typeof members === "object" && !== null`) to also require the roster's two always-present core members.

**Design decisions (each concluded with a marker; collected in §6):**

- **Verb signature and inputs** — **Chosen:** old baseline via `--manifest <json|file|->` (stdin the trusted path), plus `--written-path` and `--reported-sha256`, on `--run-dir` with optional `--events`/`--issue` to match how `M` was taken. Mirrors `verify`'s `--manifest` shape (`:338-341`) and reuses `readManifestArg` (`:176-180`).
- **Verb scope** — **Chosen:** v1 folds exactly one Class-A touched member identified by a single reported `sha256`; Class-B direct edits and multi-member writes are out of scope (see §2).
- **Negligent-hollow guard** — **Chosen:** the guard lives in BOTH places: `cmdCorrectiveCheck` gets a default-on core-roster check (members must contain `corrective` and `run-ledger.json`), and the `rebaseline` verb enforces full roster-set equality against the computed expected roster.
- **`MANIFEST_VERSION`** — **Chosen:** do NOT bump; stays `"d1"`. The members shape is unchanged — the verb adds no field — so a bump would falsely signal a shape change and churn the `:382` selftest and every `d1` literal for zero compatibility benefit.
- **ADR action** — **Chosen:** author a new ADR (next sequential number, assigned by the `adr` producer at graft time) that promotes ADR-0078 Proposed→Accepted and extends ADR-0114 without touching its branch table; the build edits ADR-0078's Status line to Accepted with an amendment note citing the new ADR + FAFF-853.

## 4. HOW — Behavior

**Architecture and approach.** The verb is a thin orchestration of four already-exported primitives — `diffAgainstManifest` (verify-old + post-write check), `buildManifest` (snapshot candidate), `sha256`/the `hash` primitive (intended-content compare), and emit-`M′`-on-all-pass — wired with `verifyAndRecord`'s never-silently-clean exit posture. Because the caller (`corrective author`) has **already performed the write** before invoking the verb, the verb runs the four post-write steps of obligation 5's five-step sequence; step 2 ("perform the write") belongs to the caller.

**Behaviour summary.** Given the held baseline `M` and a claim "I wrote member `P` and its bytes hash to `H`", the verb proves on disk that (a) `M` still holds for every member except `P`, (b) `P` is the only thing that moved, and (c) `P`'s on-disk content really is `H` — and only then emits the folded `M′`.

```
PROCEDURE rebaseline(runDir, M, writtenRel, reportedSha, events, issue):
  # -- preconditions (all exit 2 on failure; fail loud, never emit M′) --
  1. Parse M via readManifestArg; JSON.parse. Malformed → exit 2.
  2. Assert M.members is a non-null object AND its key set == memberRels(runDir, issue, events)
     (the expected roster). Mismatch/empty → exit 2 ("roster mismatch — hollow or wrong-grain baseline").
  3. Normalize writtenRel (abs→rel via path.relative FIRST); reject if it escapes runDir → exit 2.
  4. Assert reportedSha matches /^[0-9a-f]{64}$/ → else exit 2.

  # -- step: verify-old + post-write check (one diffAgainstManifest call) --
  5. diffs = diffAgainstManifest(runDir, M)   # may THROW (unresolvable hasher / unreadable member)
        on throw → exit 2 ("verification unavailable — <message>")   # never a clean fold
  6. Reduce diffs to the set of named member paths. The touched member writtenRel MUST appear
     (as an added/changed entry); every OTHER named path is tamper.
       - writtenRel absent from diffs        → exit 1 ("written member <writtenRel> not observed on disk")
       - any diff path != writtenRel present  → exit 1 ("tampered — <those paths>")   # never laundered

  # -- step: snapshot candidate --
  7. Mprime = buildManifest(runDir, issue, events)   # same roster, same MANIFEST_VERSION "d1"

  # -- step: intended-content check --
  8. recorded = leaf sha256 for writtenRel in Mprime
       (top-level member: Mprime.members[rel].sha256;
        dir sub-file:      Mprime.members[dir].files[sub].sha256)
     IF recorded is absent (member became a symlink/dir/absent) OR recorded != reportedSha
        → exit 1 ("intended-content mismatch — recorded <recorded> != reported <reportedSha>")

  # -- all passed --
  9. stdout <- JSON.stringify(Mprime) + "\n"; exit 0
```

**Why one `diffAgainstManifest` covers both verify-old and post-write check.** Because the write already landed, a single diff of `M` against disk simultaneously (a) proves `M` still holds elsewhere and (b) names exactly what moved. Step 6's "exactly the touched member" assertion is obligation 5's post-write-check requirement verbatim. For a new `corrective/<file>`, the diff reads `corrective/<file> (added)`; the verb matches on the path portion, ignoring the ` (added)`/` (removed)` suffix.

**Intended-content check — two hashers, one algorithm.** `corrective author` computes its reported `sha256` via Node's `crypto` over the exact written bytes (`corrective.js:494`); `buildManifest` records the member's `sha256` via the module's shelled root-owned hasher (`integrity-digest.js:57-64`) over the same on-disk bytes. Both are SHA-256 of identical bytes → identical hex, so the equality check in step 8 is valid.

**Negligent-hollow guard — `cmdCorrectiveCheck`.** Before the fold (`corrective.js:555`), after the existing shape check, add: if `M.members` lacks either `"corrective"` or `"run-ledger.json"` (the two members `correctiveIntegrityDirs(runDir)` always returns, grain-invariant), refuse with exit 2 (`"faff corrective check: --manifest is hollow — missing core roster member(s)"`). An empty-members manifest `{version:"d1",grain:"run",members:{}}` — which today passes the `typeof` check and reaches branch 3 `custody-trusted` having verified nothing — now refuses. This is default-on: no legitimate baseline omits these members, so no real caller is affected.

**Edge cases and error handling:**

- **Malformed / non-JSON `--manifest`** → exit 2 (usage), matching `verify` (`:341`).
- **`hasher unresolvable` mid-fold** → `diffAgainstManifest`/`buildManifest` throw; the verb maps the throw to exit 2 "verification unavailable" and emits no `M′` — a fold that cannot be computed must never read as clean (the `verifyAndRecord` `verification-unavailable` posture, `:259-261`).
- **Touched member is a `symlink`/`dir`/absent in `M′`** → no `sha256` leaf to compare → exit 1 (a file→symlink swap at the write path is tamper, consistent with `diffAgainstManifest` `:159-160`).
- **`events.jsonl` named in diffs** → an append verifies clean (prefix rule) and never appears; a truncation/rewrite appears and, being a non-touched member, is tamper → exit 1.
- **Reported member unchanged on disk** (write was a no-op / file pre-existed identically) → writtenRel absent from diffs → exit 1 (the claimed write is not observable).

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure:** the verb's "one diff covers verify-old and post-write" fusion assumes the caller writes exactly once between `M` and the invocation. If a second trusted writer (e.g. the detached sentry poller's `sentry abort`, ADR-0078 amendment) lands a legitimate `run-ledger.json` edit inside the same window, the verb sees TWO moved members and refuses the corrective re-baseline as tamper. **How you'd know:** the verb exits 1 naming `run-ledger.json` alongside the expected `corrective/<file>` on an otherwise-honest run; the executor parks with an `integrity-digest tampered` cause that names a member nobody adversarial touched. **What it means:** narrow — v1 folds one touched member per invocation (§2); a concurrent second trusted write is a known limit, re-baselined by its own separate invocation. The executor prose must sequence trusted writes through the verb one at a time, not batch them.
- **The failure:** the negligent-hollow guard catches an empty/wrong-grain manifest but, as WHY states, cannot catch an adversarial hollow (a well-formed full-roster snapshot taken at consumption instead of pre-dispatch). **How you'd know:** you would not — that is the inherent limit; there is no on-disk signal. **What it means:** proceed — the adversarial direction is explicitly out of scope, backstopped by the on-return verify + container isolation, not by this verb.

**Anti-patterns:**

- **Anti-pattern:** catching `diffAgainstManifest`'s throw and defaulting to empty diffs / a clean fold. Why: it flips an uncomputable verify into a false `M′`, exactly the branch-2 laundering `foldCorrectiveAuthority` guards against (`corrective.js:243-248`). A throw maps to exit 2, never exit 0.
- **Anti-pattern:** emitting anything other than `M′` on stdout on exit 0, or emitting `M′` on any non-zero exit. Why: the caller trusts stdout-manifest ⟺ clean fold; mixing diagnostics into stdout breaks that contract. Diagnostics go to stderr (or `--json` on stderr).
- **Anti-pattern:** passing `--manifest <writable-path>` instead of stdin. Why: a same-uid lane could rewrite that file to match its forgery, hollowing the basis (`corrective.js:272-275`). Stdin (`-`) or inline JSON only.
- **Anti-pattern:** bumping `MANIFEST_VERSION` "because the verb is new". Why: the members shape is unchanged; a bump falsely signals incompatibility and churns every `d1` reference.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a held baseline M taken with `snapshot --run-dir R --events` and a corrective file
      just written by `corrective author` at R/corrective/0001-FAFF-9.json with reported sha256 H
When  `faff integrity-digest rebaseline --run-dir R --manifest - --written-path corrective/0001-FAFF-9.json
      --reported-sha256 H --events` runs (M on stdin)
Then  it exits 0 and emits M′ on stdout, where M′.members["corrective"].files["0001-FAFF-9.json"].sha256 == H
      and every other member equals M's
```

```
Given the same M, but between snapshot and rebaseline a second member R/run-ledger.json was also
      changed on disk (not the declared written path)
When  the rebaseline verb runs for the corrective file
Then  it exits 1, names run-ledger.json as tampered, and emits NO manifest on stdout
      (a pre-existing/other-member change is never laundered into M′)
```

- The verb emits `M′` on stdout **only** on exit 0; on exit 1 and exit 2, stdout carries no manifest (never-silently-clean assertion).
- `faff integrity-digest --selftest` exits 0 with the new `rebaseline` checks included and the existing `MANIFEST_VERSION === "d1"` assertion (`:382`) still passing.

## 6. Design Decision Rationale

**What is the verb's signature and how does it receive the baseline?**
Options: (i) baseline via a file path arg; (ii) baseline via stdin/inline `--manifest`, matching `verify`. A file path is writable by a same-uid lane and hollows the basis (`corrective.js:272-275`). **Chosen:** `--manifest <json|file|->` with stdin the trusted path, plus `--written-path` and `--reported-sha256`, reusing `readManifestArg` (`integrity-digest.js:176-180`) — signature-consistent with `verify` and the corrective consumer.

**How wide is the verb's write coverage in v1?**
Options: (i) fold any number of touched members / any write class; (ii) one Class-A touched member with a single reported hash. Class B has no reported hash and needs the held-copy composition; multi-member widens the diff-matching surface. **Chosen:** one Class-A touched member per invocation; Class-B and multi-member are named extension points (§2), matching the ticket's honest scope (the `corrective author` case).

**Where does the negligent-hollow guard live, and what is its predicate?**
Options: (i) only in the verb; (ii) only in `cmdCorrectiveCheck`; (iii) both. The verb can compute the exact expected roster from its `--run-dir`/`--issue`/`--events`; the consumer cannot always know the grain of the held baseline but can always demand the two grain-invariant core members. **Chosen:** both — the verb enforces full roster-set equality (`memberRels(runDir, issue, events)`); `cmdCorrectiveCheck` enforces the default-on core-members check (`corrective` and `run-ledger.json` present). Default-on is safe: no legitimate baseline omits the core members. This closes the documented latent bug where an empty-members manifest reaches `custody-trusted` (`corrective.js:257-259`).

**Bump `MANIFEST_VERSION` `d1`→`d2`?**
Options: (i) bump to signal a new manifest producer; (ii) keep `d1`. The verb adds no field — `M′` is byte-shape-identical to any `buildManifest` output. **Chosen:** keep `"d1"`. A bump would be a false compatibility signal and would churn the `:382` selftest and every `d1` literal for no benefit. At the time of writing the members shape is unchanged; revisit only if a future member field is added.

**ADR action.**
Options: (i) supersede ADR-0078; (ii) promote ADR-0078 Proposed→Accepted and extend ADR-0114. 0078's decision (the bracket + five-step sequence) is retained and merely mechanized, so supersession would overstate the change; 0114's fold table is untouched because the verb produces the INPUT to verify, not the fold. **Chosen:** author a new ADR (next number, assigned by the `adr` producer at graft time) that records the `rebaseline` mechanization, promotes ADR-0078 to Accepted (the build also edits 0078's Status line + adds an amendment note citing the new ADR + FAFF-853), and extends ADR-0114 without touching its five-branch table; supersedes nothing.

## 7. Open Questions and Assumptions

**Open Questions:** none. The honest-limit (no adversarial-proof hollow-verify guard) is a stated design boundary in WHY, not an open decision.

**Assumptions:**

- **Assumes:** `corrective author` continues to emit the `sha256` of the exact written bytes in its output (`corrective.js:494`/`:500`). Validate: read `cmdCorrectiveAuthor`'s `out` object before building the verb; if the field moved or changed meaning, adjust `--reported-sha256`'s source accordingly.
- **Assumes:** the run-grain held baseline is taken with `--events` and `--issue` omitted per obligation 5 (`SKILL.md:1165`). Validate: confirm the executor's `snapshot` invocation in the obligation-5 prose before wiring the verb's `--events`/`--issue` roster expectation; the verb must be called with flags matching how `M` was taken.
- **Assumes:** `buildManifest`, `diffAgainstManifest`, `sha256`, `MANIFEST_VERSION` remain exported from `integrity-digest.js` (`:451-455`). Validate: check the module exports before importing; all four are the verb's primitives.

## 8. DONE — Definition of Done

### From WHY
- [ ] The obligation-5 Class-A re-baseline is invoked as one `faff integrity-digest rebaseline` call, not a hand-chained prose sequence; `SKILL.md:1165` prose is updated to call the verb and the executor placement prose refers back.
- [ ] The verb emits `M′` on stdout **only** on exit 0; exit 1 and exit 2 emit no manifest on stdout.
- [ ] A re-baseline over a baseline with a pre-existing tamper on any non-written member exits 1 and never emits `M′`.

### From WHAT (interfaces)
- [ ] `cmdIntegrityDigest` dispatches `rebaseline` (the `:321` guard admits it); `--written-path` and `--reported-sha256` are in `INTEGRITY_DIGEST_SPEC` (`:183-190`).
- [ ] `--manifest` accepts `<json|file|->` with stdin as `-`; `--written-path` accepts abs-or-relative (abs→rel via `path.relative` before the guard) and is rejected (exit 2) if it escapes `runDir`; `--reported-sha256` requires 64-hex.
- [ ] `M′` is `{version:"d1", grain, members}` with `MANIFEST_VERSION` still `"d1"`; the `:382` selftest assertion is unchanged.

### From HOW (behaviour)
- [ ] On a clean corrective-author fold, the verb exits 0 and `M′.members["corrective"].files[<file>].sha256 == --reported-sha256`, all other members equal to `M`.
- [ ] Verify-old + post-write check: exactly the `--written-path` member appears in the diff; any other named member → exit 1 with those paths.
- [ ] `--written-path` member absent from the diff → exit 1 ("not observed on disk").
- [ ] Intended-content mismatch (`recorded != reported`, or member became symlink/dir/absent) → exit 1.
- [ ] A `diffAgainstManifest`/`buildManifest` throw (unresolvable hasher / unreadable member) → exit 2 "verification unavailable", no `M′`.

### From HOW (negligent-hollow guard)
- [ ] `cmdCorrectiveCheck` `--manifest` path refuses (exit 2) a manifest missing `corrective` or `run-ledger.json`; an empty-members manifest no longer reaches `custody-trusted`.
- [ ] The `rebaseline` verb refuses (exit 2) a manifest whose member-set != `memberRels(runDir, issue, events)`.

### From WHAT (decisions)
- [ ] `MANIFEST_VERSION` is not bumped (stays `"d1"`); no scattered `d1` literals changed.

### From ADR
- [ ] A new ADR records the `rebaseline` mechanization, promotes ADR-0078 to Accepted (0078's Status line edited + amendment note citing the new ADR + FAFF-853), and extends ADR-0114 without altering its five-branch table.

### Tests / selftest
- [ ] `integrityDigestSelftest` (`:364-449`) adds: clean rebaseline round-trip (exit 0, `M′` folds the new member), tamper-elsewhere (exit 1), intended-content mismatch (exit 1), roster-mismatch/hollow (exit 2); `--selftest` exits 0.
- [ ] `test/integrity-digest.test.mjs` and `test/corrective.test.mjs` cover the verb's exit-code matrix and the corrective-check hollow-refusal (adjacent to the existing stale-manifest guard at `test/corrective.test.mjs:380`).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. mk run dir R with run-ledger.json, corrective/, events.jsonl
  2. M  = `integrity-digest snapshot --run-dir R --events`        # held baseline
  3. out = `corrective author --run-dir R --issue FAFF-9 --op forbid-surface --surface x --cites-signal s --json`
           → writes R/corrective/0001-FAFF-9.json, reports sha256 H
  4. Mp = `integrity-digest rebaseline --run-dir R --manifest - --written-path corrective/0001-FAFF-9.json
           --reported-sha256 H --events`  (M piped on stdin)      # expect exit 0, Mp on stdout
  5. `integrity-digest verify --run-dir R --manifest - --events` (Mp on stdin)  → exit 0 digest-verified
  # if step 4 exits 0 and step 5 verifies clean against the emitted M′, the fold is wired end-to-end
```

confidence: high
spec-review: approve
build-tier: complex
