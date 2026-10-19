# Spec — FAFF-1132: Bound judge-trail objection storage (write-cap + two-phase truncation)

> Spec: faffter-dark-nlspec · 2026-09-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1132.

This is a buildable nlspec for issue **FAFF-1132** (parent FAFF-1019, slice 2 of 2), for the build agent and human reviewers. It adds a hard, measured storage bound to the per-round objection blob that sibling slice **FAFF-1131** (Done, merged PR #963) began writing into the durable judge-trail. The only source file changed is `plugin/skills/faff/bin/lib/judge-trail.js` (region:factory) and its test `test/judge-trail.test.mjs` — the same scope as FAFF-1131.

## 1. WHY — Problem and Principles

**The load-bearing model:** the durable judge-trail's per-issue `objections-by-round.json` is an ascending-by-round array whose LAST entry is the *standing residue* — the latest in-window round the judge actually ruled on. Bounding this blob therefore means dropping whole rounds **from the front** (oldest, down-weighted history) while always keeping the tail intact, and staging only fully-serialized valid JSON — never a byte-sliced fragment.

**Problem statement.** FAFF-1131 made the trail retain *every* in-window round's objections verbatim in a new `objections-by-round.json` member, which grows unbounded on a long convergence (a pathological 10-round × 6-objection run is ~43.5 KB today, and an adversarial or runaway corpus has no ceiling at all). This slice adds a hard, justified byte cap and a two-phase (no-torn-write) truncation path so the durable trail can never blow up the trail subtree, while never dropping the residue the judge ruled on.

**Design principles** (each would cause an otherwise-valid implementation to be rejected):

- **The mint stays best-effort — a cap breach truncates and proceeds, never errors.** The mint is best-effort at run close: `mint()` returns `{ok:false,code:1,message}` on hard failure without a partial ref, and a throwing `buildIssueSubtree` just skips that one issue (`judge-trail.js` lines 325-326). Nothing on the accept / merge / park path depends on the trail. Truncation is pure array-slicing on in-memory data — it must never throw, never error the mint, never gate run-close.
- **The standing residue is never dropped.** The residue is the last (highest-round) entry of the ascending array (`spec-judge-evidence.js` `readStandingResidue`, lines 442-452: latest in-window round wins). Truncation drops from the FRONT only and always retains at least the last entry — even when that single entry alone exceeds the cap.
- **No torn write.** The blob is decided as a fitted set of whole rounds, then serialized once to complete valid JSON and staged as a single buffer. A serialized-JSON string is NEVER byte-sliced mid-structure (that would stage invalid JSON — the exact failure the two-phase requirement exists to prevent).
- **The member stays a bare ascending array.** `judge-history --rounds` reads the member with `Array.isArray(rec.objections_by_round)` (`judge-trail.js` line 601) and `JSON.parse` (lines 559-560). Wrapping the member in an object to carry a truncation marker would silently break that reader. The truncation marker lives in the manifest instead.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/judge-trail.js` (region:factory) | Node.js | The ONLY source file changed: `buildIssueSubtree` serializes the blob (line 240); `mint` stages it two-phase (lines 266-364) |
| `plugin/skills/faff/bin/lib/spec-judge-evidence.js` | Node.js | Defines the standing residue as the latest in-window round — the tail that must never be dropped |
| `plugin/skills/faff/bin/lib/ratified-scope.js` | Node.js | Prior-art measured caps: `VALIDATE_MAX_BYTES = 1048576` (1 MiB, "~1000x headroom"), `RESOLUTION_VALUE_CAP = 300` |
| `test/judge-trail.test.mjs` | Node.js (node:test) | The test surface; FAFF-1131 tests at lines 407-513 are the pattern to extend |

**Scope.** A hard write-cap on one member of one factory module's per-issue subtree; it changes neither the accept path nor any reader's contract beyond two additive manifest fields.

## Already shipped against this surface

- **FAFF-1131 — per-round objection retention (Done, merged PR #963).** Added `collectObjectionsByRound(specReviewDir)` (ascending `{round, window_start, objections}`, in-window rounds only, objections verbatim), the `objections-by-round.json` member and its manifest pointer, `judge-history --rounds`, and bumped `SCHEMA_VERSION` 1→2. This slice **bounds** that feature; it is the premise, not superseded. FAFF-1131 explicitly deferred the storage-growth question to here.

## 2. OUT OF SCOPE

- **Raw per-lens response bodies (FAFF-928).** Excluded because FAFF-1131's spec already ruled it out of this member's scope. Extension point: a separate future member under the per-issue subtree in `buildIssueSubtree`, with its own cap.
- **Capping the other members** (`objections.json`, `rulings.json`, `spec.txt`). Excluded because only `objections-by-round.json` grows with convergence length; the others are bounded by proposition count or a single spec text. Extension point: the same `fitObjectionsByRound`-style helper generalised per member in `buildIssueSubtree`.
- **Retroactively re-bounding already-minted trails.** Excluded because the mint is write-once per run_id (`judge-trail.js` lines 302-317) and never rewrites an existing ref. Extension point: a one-off `faff judge-trail rebound` maintenance command.
- **Per-objection field-length caps (à la `RESOLUTION_VALUE_CAP`).** Excluded: the corpus-level byte cap is sufficient and objections are retained verbatim by FAFF-1131's contract. Extension point: a secondary per-objection truncation inside `collectObjectionsByRound`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Standing residue | The latest in-window round's objections — the LAST entry of the ascending `objections-by-round.json` array; the residue the judge ruled on. Must never be dropped. |
| Fitted set | The suffix of the ascending round array retained after front-dropping so the serialized blob fits the cap (or a single-round floor is hit). |
| Two-phase | Phase 1: decide the fitted set (drop whole rounds from the front). Phase 2: serialize the fitted set once to complete valid JSON and stage that single buffer. |

**The new named constant.**

```
CONSTANT OBJECTIONS_BLOB_WRITE_CAP = 262144   # 256 KiB, in bytes
```

**The fitting helper** (new, pure, exported for direct unit test — mirrors how `collectObjectionsByRound` is exported):

```
FUNCTION fitObjectionsByRound(rounds, cap) -> { fitted, dropped }
  # rounds: the ascending [{ round, window_start, objections }, ...] from collectObjectionsByRound
  #         (last entry = standing residue)
  # cap:    OBJECTIONS_BLOB_WRITE_CAP (bytes)
  # fitted: the retained suffix (a bare array, same element shape, still ascending)
  # dropped: count of whole rounds removed from the FRONT (>= 0)
  CONSTRAINT fitted is always a (possibly full) SUFFIX of rounds   # tail preserved
  CONSTRAINT rounds non-empty => fitted non-empty AND last(fitted) === last(rounds)  # residue kept
  CONSTRAINT byteLen(serialize(fitted)) <= cap  OR  fitted.length === 1  # cap met, or single-round floor
```

`serialize(x)` is exactly `JSON.stringify(x, null, 2) + "\n"` measured as UTF-8 bytes — the identical serialization `buildIssueSubtree` writes at line 240 (this is what makes Phase 1's measurement match Phase 2's staged bytes).

**Two additive manifest fields** (written in `manifestCore` in `buildIssueSubtree`, so they fall inside the `witness_sha` envelope and are observable via `judge-history --json`):

```
RECORD manifestCore (additions only):
  objections_by_round_truncated: boolean       # dropped > 0
  objections_by_round_dropped_rounds: integer  # the `dropped` count from fitObjectionsByRound
```

**Schema version.** `SCHEMA_VERSION` 2 → **3**.

**Design decisions** (each closed below in DESIGN DECISION RATIONALE):

- Bound by BYTES, not a fixed last-N round window. **Chosen:** byte-bound (the cap subsumes "last-N").
- Cap value. **Chosen:** `262144` (256 KiB).
- Drop direction. **Chosen:** front-drop (oldest first), tail always preserved.
- Torn-write avoidance. **Chosen:** serialize-the-fitted-set-then-stage; never byte-slice.
- Single residue round over cap. **Chosen:** retain it whole; let the blob exceed the cap in that one pathological case.
- Observability + schema. **Chosen:** manifest truncation marker (`truncated` + `dropped_rounds`), bump `SCHEMA_VERSION` to 3.

## 4. HOW — Behavior

**Approach.** All work is confined to `buildIssueSubtree` and one new pure helper. `collectObjectionsByRound` is unchanged — it still returns the full ascending array. Between collecting and serializing, `buildIssueSubtree` passes the array through `fitObjectionsByRound`, writes the fitted array as the member, and stamps the two manifest fields. The mint's staging path (`stageIssueFiles`, `write-tree`, `commit-tree`, push/update-ref) is untouched — it already stages whole buffers via `git hash-object -w --stdin` + `update-index --cacheinfo`; the fitted blob is just a (possibly shorter) whole buffer.

**Phase 1 — decide the fitted set** (front-drop whole rounds until the serialized blob fits, always keeping the last entry):

```
PROCEDURE fitObjectionsByRound(rounds, cap):
  1. IF rounds is empty: RETURN { fitted: [], dropped: 0 }      # serialize([]) = "[]\n", trivially under cap
  2. start := 0
  3. LOOP:
     a. candidate := rounds[start ..]                           # suffix: drop `start` rounds from the front
     b. size := utf8ByteLength(JSON.stringify(candidate, null, 2) + "\n")
     c. IF size <= cap: BREAK                                    # fits
     d. IF candidate.length == 1: BREAK                          # single residue round floor — keep it whole even if size > cap
     e. start := start + 1
  4. RETURN { fitted: rounds[start ..], dropped: start }
```

**Phase 2 — serialize once and stage** (inside `buildIssueSubtree`, replacing the current line 240):

```
PROCEDURE buildIssueSubtree(... objectionsByRound ...):
  1. fit := fitObjectionsByRound(objectionsByRound, OBJECTIONS_BLOB_WRITE_CAP)
  2. files["objections-by-round.json"] := Buffer(JSON.stringify(fit.fitted, null, 2) + "\n", utf8)   # the ONE staged buffer
  3. manifestCore.objections_by_round_truncated     := fit.dropped > 0
  4. manifestCore.objections_by_round_dropped_rounds := fit.dropped
  5. manifestCore.schema_version := 3
  6. ... unchanged: witness_sha over manifestCore, write manifest.json, return { manifest, files }
```

The byte-length measured in Phase 1 step 3b is the byte-length of the exact string staged in Phase 2 step 2 — measurement and write are the same serialization, so a fitted blob that measured `<= cap` is staged verbatim. No substring/slice of a serialized string ever occurs.

**Edge cases.**

- **Empty array** (no in-window rounds): `fitted = []`, `dropped = 0`, blob `"[]\n"`, `truncated = false`. Unchanged from today.
- **Whole corpus already under cap** (the realistic 2-5 round case, ~15 KB): loop breaks at `start = 0`, `fitted = rounds`, `dropped = 0`, `truncated = false`. No behavioural change vs FAFF-1131 for normal runs — the regression guard.
- **Corpus over cap, multiple rounds:** front rounds dropped until fit; residue (last entry) always retained; `dropped > 0`, `truncated = true`, blob `<= cap`.
- **Single residue round alone exceeds cap** (pathological giant single round): loop breaks at step 3d with `candidate.length == 1`; that round is staged whole; `dropped = 0`, `truncated = false`, and the blob legitimately exceeds `cap`. This honours the never-drop-the-residue principle; the alternative (dropping or slicing the residue) is forbidden.

**Failure modes.**

- **The cap is set too low and silently amputates real convergence history.** How you'd know: the realistic-corpus regression test (5×4 ≈ 14.6 KB) would show `truncated = true` / `dropped > 0`. What it means: narrow — the cap is measured at ~17× the realistic and ~6× the pathological size specifically so a normal run never truncates; a truncated realistic run means the constant is wrong, not the algorithm.
- **A future edit wraps the member in an object to carry the marker inline.** How you'd know: the existing FAFF-1131 `judge-history --rounds` test (line 407) would stop printing per-round lines because `Array.isArray` (line 601) turns false. What it means: abandon that approach — the marker belongs in the manifest (as specced), keeping the member a bare array.
- **Measuring a different serialization than is written** (e.g. compact JSON in Phase 1, pretty in Phase 2). How you'd know: a fitted blob measured `<= cap` is written larger than `cap`. What it means: proceed only once Phase 1 and Phase 2 share the identical `JSON.stringify(x, null, 2) + "\n"` expression — assert `byteLen <= cap` on the actually-staged member, not on a recomputed value.

**Anti-patterns.**

- **Anti-pattern:** byte-slicing the serialized JSON string to fit the cap. Why: stages torn, invalid JSON — the exact failure two-phase exists to prevent.
- **Anti-pattern:** dropping from the tail / end of the array. Why: the tail is the standing residue; dropping it violates the never-drop-the-residue principle.
- **Anti-pattern:** wrapping `objections-by-round.json` in `{ truncated, rounds: [...] }`. Why: breaks `judge-history --rounds`' `Array.isArray` read; the marker goes in the manifest.
- **Anti-pattern:** throwing / returning `{ok:false}` from the mint when a corpus exceeds the cap. Why: the mint is best-effort; a cap breach truncates and proceeds.

## 5. Scenarios — born-verifiable main objectives

```
Given a run whose objections-by-round corpus, serialized as JSON.stringify(x, null, 2) + "\n", exceeds OBJECTIONS_BLOB_WRITE_CAP across several rounds
When the trail is minted (faff judge-trail mint) and read back (faff judge-history --rounds --json)
Then the staged objections-by-round.json is <= OBJECTIONS_BLOB_WRITE_CAP bytes, parses as a valid JSON array, its last entry's round equals the highest original round (the standing residue), its first retained round is greater than the original first round, and the manifest reports objections_by_round_truncated:true with objections_by_round_dropped_rounds equal to the number of front rounds removed
```

```
Given a run with a single in-window round whose objections alone serialize to more than OBJECTIONS_BLOB_WRITE_CAP bytes
When the trail is minted
Then that round is retained whole (fitted length 1, equal to the standing residue), the mint returns ok:true / minted:true (never errors), and the manifest reports objections_by_round_truncated:false with objections_by_round_dropped_rounds:0
```

- The staged `objections-by-round.json` remains a bare JSON array at every truncation level, so `judge-history --rounds` (`Array.isArray` at line 601) still enumerates per-round lines.
- A realistic 5-round × 4-objection corpus (~14.6 KB) mints with `objections_by_round_truncated:false`, `dropped_rounds:0`, and a member byte-length identical to the un-fitted serialization (no truncation on normal runs).
- Every minted manifest carries `schema_version:3`.

## 6. Design Decision Rationale

**Bound by bytes, or by a fixed last-N-round window?**
- *Fixed last-N:* simple count, but round sizes vary wildly (one objection ~640 B; a 6-objection round ~4 KB), so N can't express a storage bound — small-N over-truncates rich runs, large-N under-bounds adversarial ones.
- *Byte-bound:* drops oldest rounds until the serialized blob fits; a runaway corpus is bounded regardless of how the bytes are distributed across rounds.
- **Chosen:** byte-bound. The write-cap directly bounds storage and subsumes the "last-N" question — FAFF-1131 deferred exactly this to a measured byte cap.

**What cap value?**
- Measured real sizes: one objection ~640 B; a 4-objection round ~2.6 KB; a realistic 5×4 corpus ~14.6 KB; a pathological 10×6 long convergence ~43.5 KB. Typical convergence is 2-5 rounds.
- Prior art in this codebase: `ratified-scope.js` `VALIDATE_MAX_BYTES = 1048576` (1 MiB, "a real block is a few hundred bytes to a few KiB; 1 MiB is ~1000x headroom"); `gates.js` `MAX_RUNG_STDOUT_BYTES = 64 MiB`; `build-judge-casefile.js` `DIFF_SLICE_MAX_BYTES = 20000`.
- 256 KiB = 262144 bytes gives ~17× headroom over the realistic corpus and ~6× over the pathological one, so no normal or even long-but-sane run truncates; yet it bounds a genuinely runaway/adversarial corpus (hundreds of rounds, or a crafted giant objection) at a quarter of the established 1 MiB precedent.
- **Chosen:** `OBJECTIONS_BLOB_WRITE_CAP = 262144` (256 KiB) — measured against the real ~15 KB / ~44 KB sizes above, ~4× tighter than the 1 MiB `VALIDATE_MAX_BYTES` precedent. (Rejecting the round-3 draft's unjustified 4 MiB: 4 MiB is ~92× the pathological size and gives no meaningful bound.)

**Drop from the front or the tail?**
- The array is ascending by round; `readStandingResidue` defines the residue as the latest in-window round = the LAST entry. Dropping the tail drops the residue the judge ruled on.
- **Chosen:** front-drop (oldest / down-weighted history first); the tail is always preserved.

**How is the torn-write avoided?**
- *Byte-slice a serialized string to `cap`:* fast but stages structurally-invalid JSON.
- *Decide whole rounds, then serialize once:* the staged buffer is always complete valid JSON.
- **Chosen:** two-phase serialize-then-stage. Phase 1 decides the fitted set of whole rounds by measuring the exact `JSON.stringify(x, null, 2) + "\n"`; Phase 2 serializes that set once and stages the single buffer via the existing `hash-object`/`update-index` path.

**What if even the standing-residue round alone exceeds the cap?**
- *Drop / slice the residue:* violates the never-drop-the-residue principle.
- *Per-round secondary cap:* adds complexity and would still have to truncate objection text mid-structure.
- *Retain the residue whole, allow the blob to exceed the cap in this one case:* keeps the residue intact; the overflow is bounded to a single round and observable (the reader sees one oversize round).
- **Chosen:** retain the single residue round whole even when it alone exceeds the cap; `dropped_rounds:0`, `truncated:false`, blob may exceed cap. This is the only case where the blob can exceed the cap, and it exists solely to honour the never-drop-the-residue principle.

**How does a reader tell a bounded trail from a complete one, and does the schema bump?**
- *No marker:* a reader can't distinguish a truncated trail from a naturally short one — fails the "observable truncation outcome" requirement.
- *Marker inside the member:* breaks `judge-history --rounds`' `Array.isArray` read.
- *Marker in the manifest:* the manifest is the metadata surface, sits inside the `witness_sha` envelope, and is returned by `judge-history --json`; adding fields is backward-tolerant (a reader ignorant of them treats absent as not-truncated).
- **Chosen:** add `objections_by_round_truncated` (boolean) + `objections_by_round_dropped_rounds` (integer) to `manifestCore`, and bump `SCHEMA_VERSION` 2 → 3. The bump mirrors FAFF-1131's 1→2 precedent for a member-semantics change and cleanly signals that cap-enforcement is present (a v2 trail is unbounded-by-construction; a v3 trail is capped). The bump is informational — no reader gates on `schema_version`, so v2 and v3 both read.

## 7. Open Questions and Assumptions

**Open Questions.** None — every decision above is closed with a `**Chosen:**`.

**Assumptions.**

- **Assumes:** `collectObjectionsByRound` returns the array strictly ascending by round with the standing residue last. Validate: confirmed at `judge-trail.js` lines 148-163 (`roundFilesInDir` order, `f.n >= windowStart`) and `spec-judge-evidence.js` lines 442-452 (latest wins) — re-read before building.
- **Assumes:** the mint stages whole member buffers and does not re-serialize `objections-by-round.json` anywhere but line 240. Validate: confirmed — `stageIssueFiles` (lines 266-275) hashes the buffer from `files[...]` as-is; the only writer is `buildIssueSubtree` line 240.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] A cap breach truncates and the mint still returns `{ok:true, minted:true}` — no throw, no `{ok:false}`, no gating of run-close (test asserts mint result on an over-cap corpus).
- [ ] The standing residue (last / highest-round entry) is present in the staged member in every truncation case, including single-round-over-cap.
- [ ] `objections-by-round.json` is a bare JSON array at every truncation level; `JSON.parse` yields an array (no torn write).

### From WHAT (constant, helper, schema)
- [ ] `OBJECTIONS_BLOB_WRITE_CAP === 262144` exists as a named constant in `judge-trail.js`.
- [ ] `fitObjectionsByRound(rounds, cap)` is exported and returns `{ fitted, dropped }` where `fitted` is a suffix of `rounds`, `last(fitted) === last(rounds)` for non-empty input, and `byteLen(JSON.stringify(fitted, null, 2) + "\n") <= cap` unless `fitted.length === 1`.
- [ ] Minted manifests carry `schema_version: 3`.
- [ ] Minted manifests carry `objections_by_round_truncated` (boolean) and `objections_by_round_dropped_rounds` (integer).

### From HOW (behaviour)
- [ ] Over-cap multi-round corpus: staged `objections-by-round.json` byte-length `<= OBJECTIONS_BLOB_WRITE_CAP`; `truncated:true`; `dropped_rounds` equals the number of front rounds removed; first retained round > original first round; last retained round == original last round.
- [ ] Single-round-over-cap: the one round is retained whole (`fitted.length === 1`), `truncated:false`, `dropped_rounds:0`, mint `ok:true`; blob may exceed cap.
- [ ] Realistic under-cap corpus (~14.6 KB): `truncated:false`, `dropped_rounds:0`, and the member equals the un-fitted serialization (regression guard — no change for normal runs).
- [ ] Empty corpus: member is `"[]\n"`, `truncated:false`, `dropped_rounds:0`.

### From HOW (reader compatibility)
- [ ] The FAFF-1131 `judge-history --rounds` behaviour still holds on a truncated trail: the member reads as an array and per-round lines print (no `Array.isArray` regression).
- [ ] `witnessSha` verifies on a v3 manifest with the two new fields (recompute-on-read still matches; the existing tamper-suspect test remains green).

### Integration smoke test
```
1. initRepo(root); seed a run dir with an issue whose spec-review has enough in-window rounds
   (each with a verbose objection) that JSON.stringify(fullArray, null, 2)+"\n" > 262144 bytes.
2. runCli(["judge-trail", "mint", "--run-dir", runDir, "--root", root, "--json"]) -> ok:true, minted:true.
3. runCli(["judge-history", "--run", runId, "--rounds", "--json", "--root", root]) -> records[0]:
   a. Buffer.byteLength(the raw objections-by-round.json blob, "utf8") <= 262144.
   b. JSON.parse(blob) is an Array; last element .round == highest seeded round.
   c. manifest.schema_version == 3; manifest.objections_by_round_truncated == true;
      manifest.objections_by_round_dropped_rounds == (seeded rounds - retained rounds).
```
No LLM-judgement seam is introduced or changed, so no eval-coverage DONE item applies (this is deterministic array-fitting).

confidence: high
build-tier: complex
