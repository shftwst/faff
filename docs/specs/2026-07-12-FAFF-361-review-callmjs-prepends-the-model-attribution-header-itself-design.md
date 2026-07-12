# Spec — FAFF-361: `review-call.mjs` prepends the model-attribution header itself

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-361.
>
> **Spec designation (human decision, tidy 2026-07-10):** this issue carried two divergent spec
> comments (2026-07-05 02:44 and 02:54) with contradictory Chosen decisions. **This, the 02:54
> spec, is authoritative** — `[chain] … → advancing` note shape, `attributionHeader` function,
> `winnerIndex` returned from `runReviewChain`. The 02:44 spec (`formatAttribution`, reused
> unreshaped advance notes, `chainIndex` derived from `failureClasses.length` rather than a new
> `winnerIndex` field) is struck; build agents must ignore it. The retained `spec-review: approve`
> (2026-07-05 03:02) post-dates and covers this 02:54 version.

*This is the build spec for FAFF-361. Audience: the build agent implementing the change, and the human reviewer gating it. It turns a droppable lens-prose rule ("name your model") into a mechanical guarantee of the transport.*

## 1. WHY — Problem and Principles

**The load-bearing idea:** attribution should be emitted by the *tool that knows the answer* — `review-call.mjs` already holds the winning backend object (`provider`, `model`, `hostSource`) and the chain index — not asked of the *model via prose*, which any custom `--system` lens silently overrides.

**Problem statement.** The adversarial-review skill's *lens prose* mandates the model name itself as the output's first line (`## Adversarial findings — <provider>/<model>`); an operator who supplies a custom `--system` file drops that instruction and ships unattributed findings — as happened three times on 2026-07-04, forcing the serving backend to be reconstructed by inference. This change makes `review-call.mjs` prepend the header itself, so no lens author can drop it.

**Design principles.**

- **Deterministic tools over prose (faff's own tenet).** A rule that must always hold belongs in the tool, not in an overridable prompt. Attribution is now a property of the transport's stdout, not of model compliance.
- **Prepend-only, zero semantic drift.** The header is added *only* on the success path (exit 0) and *only* prepended — it must not alter any exit code, the `content` body, stderr provenance, or the byte output of any non-success path.
- **Reuse, never fork.** `review-call.mjs` is shared by two consumers; the change lands in the one file both use, and must remain safe for both.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (zero-dep) | The transport being changed; `main()` + `runReviewChain()` |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Consumer 1 (code-review); holds the droppable rule |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` + `aggregate.mjs` | prose + Node | Consumer 2 (spec-review refuters); `aggregate.mjs` reads assembled JSON, not raw stdout |
| `test/adversarial-call.test.mjs` | Node `--test` | Existing selftest to extend (mocked transport, zero live calls) |

**Scope statement.** A localised hardening of the adversarial/spec-review transport's output contract — attribution provenance moves from the LLM seam into the deterministic helper.

**Note (build-time, FAFF-194/FAFF-405 baseline).** This spec's line-number anchors are stale — `origin/main` at build time already includes FAFF-194 (deterministic guards for machine-checkable adversarial findings + output-format enforcement, #321) and FAFF-405 (`unavailable` as a first-class review-verdict signal, #319), both of which touched `review-call.mjs` and `test/adversarial-call.test.mjs` substantially. The build re-locates every anchor (the OK-branch stdout write, `runReviewChain`'s per-skip log call and its exit-0 return, the `EXIT` enum, `tag`/`hostSource` construction) against the current file rather than trusting the spec's original line numbers.

## 2. OUT OF SCOPE

- **A parametrised `--attribution-label` flag** (so spec-review could render `## Refutation —` instead of `## Adversarial findings —`). *Why excluded:* the unconditional adversarial-labelled header is harmless provenance for the spec-review refuter (the refuter agent reads it as text; `aggregate.mjs` never sees raw stdout). *Extension point:* add an optional `--attribution-label` arg to `parseArgs`/`main` and thread it into `attributionHeader()` if a future consumer wants a semantically-tailored label.
- **Changing the full-chain-outage `SKIPPED` header** (exit-5 autonomous, SKILL-authored). *Why excluded:* that path emits no helper stdout, so the prepend never fires there. *Extension point:* `Full-chain outage annotation` in the adversarial SKILL.
- **Restructuring the existing exhausted/success stderr log lines.** *Why excluded:* only the *per-skipped-backend advancement* note is in the ticket's remit. *Extension point:* the `log()` sink in `runReviewChain`.
- **Attribution for the Phase-1 (primary) review.** *Why excluded:* Phase-1 runs in-session under a known model; the attribution gap is specific to the out-of-process adversarial/refuter transport.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Winner | The chain backend that produced findings (exit 0) — the object `runReviewChain` returns as `winner` |
| Winner index | The 0-based position of the winner in the chain (`chain[0]` = primary) |
| Host-source | Provenance of the host: `config` (explicitly configured) or `default` (localhost fallback, FAFF-213) |
| Attribution header | The single line prepended to stdout naming who served the response |

**The winner-index surfacing (change to the chain return shape).**

```
RECORD ChainResult:                # runReviewChain return — existing fields unchanged
  exit: Int
  content?: String                 # present on exit 0
  truncated?: Bool
  winner?: Backend                 # present on exit 0 — { provider?, model, host, hostSource, ... }
  winnerIndex?: Int                # NEW — present on exit 0; the 0-based chain position of `winner`
  failureClasses: List<Int>
```

**Chosen:** Add `winnerIndex: i` to the exit-0 return of `runReviewChain` (the loop index `i` is already in scope at that return). Rationale: all other header fields already live on `winner`; only the chain position needs surfacing, and the loop index is the ground truth. Non-OK returns are unchanged (no `winnerIndex`).

**The attribution header (new pure function).**

```
FUNCTION attributionHeader(winner: Backend, index: Int) -> String:
  provider := winner.provider OR "ollama"     # mirror the tag logic: omitted provider ⇒ ollama
  host_src := winner.hostSource OR "config"    # back-compat default
  RETURN "## Adversarial findings — " + provider + "/" + winner.model
         + " (chain[" + index + "], host: " + host_src + ")"
```

- Example output: `## Adversarial findings — nvidia/z-ai/glm-5.2 (chain[0], host: config)`.
- `winner.model` may contain slashes (`z-ai/glm-5.2`) — emit verbatim, no escaping.
- Pure (no I/O), exported, unit-tested directly.

**Design decision — the cross-consumer header shape.**

- *Option A — unconditional literal `## Adversarial findings —` header.* Matches the ticket example; makes the code-review consumer's `## Adversarial findings` parse anchor transport-guaranteed instead of model-guaranteed; harmless provenance for the spec-review refuter.
- *Option B — parametrised `--attribution-label`.* More surface; reintroduces a per-consumer setting (though a CLI flag, not droppable lens prose).
- *Option C — neutral machine-readable line (`<!-- served-by: … -->`).* Semantically cleaner for spec-review, but then the code-review `## Adversarial findings` anchor would still depend on the model — defeating the determinism win.

**Chosen:** Option A — an unconditional `## Adversarial findings —` header via a named constant prefix. It satisfies the ticket verbatim, improves the code-review anchor's determinism, and is verified harmless for the spec-review consumer (`aggregate.mjs` reads assembled JSON, never raw stdout).

**Design decision — the per-skipped-backend stderr note.**

**Chosen:** Reshape the existing advancement log line in `runReviewChain` from `advancing: <tag> failed (<status>: <detail>) (exit <n>)` to the greppable `[chain] <provider>/<model> <reason> → advancing` form named in the ticket, keeping it in the same `log()` sink. Rationale: the capability already exists; the ticket asks for a specific, greppable format. The `exhausted:` terminal line and the success-after-skips line are left as-is (out of scope). Any existing test assertion on the old format is updated to the new shape.

**Design decision — model self-naming duplication.**

**Chosen:** Update the default adversarial lens prose so the model no longer self-names — the header becomes the sole `## Adversarial findings` line, avoiding a double header. A custom lens that *still* self-names produces harmless duplication (two headers; the consumer parses the first). Rationale: the ticket explicitly moves the naming burden off the lens.

## 4. HOW — Behavior

**Architecture.** Three edits to `review-call.mjs`, one prose edit each to two SKILLs, and test additions. No new dependencies, no new flags.

**Behaviour summary.** On a successful adversarial/refuter call, stdout gains a deterministic first line naming who served it; on every failure path, stdout and exit codes are byte-for-byte unchanged, and each skipped backend still prints a greppable advancement note to stderr.

```
PROCEDURE main(argv) [exit-0 branch only — the change]:
  res := runReviewChain(chain, shared)
  IF res.exit == OK:
     a. IF res.truncated: stderr.write("[note] response truncated …")   # unchanged
     b. header := attributionHeader(res.winner, res.winnerIndex)         # NEW
     c. stdout.write(header + "\n\n" + (res.content OR "").trim() + "\n") # header prepended
     d. RETURN OK
  # every other exit branch: UNCHANGED (no header, same stderr, same code)
```

```
PROCEDURE runReviewChain(chain, shared) [two touch-points]:
  ... loop ...
     on a non-OK backend that is not the last:
        log("[chain] " + tag + " " + reason + " → advancing")   # RESHAPED note
     on OK at index i:
        RETURN { exit: OK, content, truncated, winner: chain[i], winnerIndex: i, failureClasses }  # winnerIndex NEW
```

- `reason` is a short cause token derived from the result (`unreachable` / `transport-failed` / `not-served` / `auth` / `unset-key` / `invalid`) — enough to say *why* it was skipped without dumping the full detail string. The existing `(exit <n>)` detail may be retained after the arrow if useful, but the `[chain] <tag> <reason> → advancing` prefix is the asserted contract.

**Edge cases and error handling.**

- **Single-backend legacy path (no `--backends-json`).** Chain length 1; on OK, `winnerIndex` = 0, `winner.provider` may be `undefined` → header renders `ollama/<model>`; `winner.hostSource` is `config` or `default`. Header still emitted.
- **Provider omitted.** `attributionHeader` falls back to `ollama`, mirroring the existing `tag` logic — never emits `undefined/<model>`.
- **Truncated content.** Header precedes the (possibly partial) content; the truncation note stays on stderr. Order: stdout = header + content; stderr = truncation note.
- **Non-OK exits (2/4/5/6/7/8).** No header, no `winnerIndex`, unchanged stdout/stderr/exit — the prepend is strictly inside the exit-0 branch.

**Failure modes.**

- **The failure:** the reshaped stderr note breaks a downstream grep/log-scraper that matched the old `advancing:` prefix. **How you'd know:** a run-log tool that counted skips shows zero after the change. **What it means:** grep for `advancing:`-format consumers before shipping; the only in-repo consumer is the one test assertion (updated here). Proceed.
- **The failure:** a custom lens still instructs self-naming → two `## Adversarial findings` headers confuse the code-review disposition parse. **How you'd know:** a finding appears under an empty first section. **What it means:** harmless per the ticket (consumer parses the first header); the default lens is de-mandated so the default path is clean. Proceed.

**Anti-pattern:** emitting the header inside `runReviewChain` (into `content`). Why: it would pollute the `content` body that callers may re-use and double-count on any content-length logic; the header belongs at the `main()` stdout boundary, outside `content`.

**Anti-pattern:** gating the header behind a "is this the code-review consumer?" check. Why: the helper cannot know its caller, and the whole point is an unconditional guarantee.

## 5. SCENARIOS

```
Given a stubbed chain whose primary backend (index 0) returns findings (exit 0)
When main() writes to stdout
Then the first line is "## Adversarial findings — <provider>/<model> (chain[0], host: config)"
 And the model's finding body follows unchanged after a blank line
```

```
Given a stubbed chain whose primary fails transiently and whose fallback (index 1) returns findings
When main() writes to stdout
Then the attribution header names the fallback's provider/model and reads "(chain[1], host: config)"
 And stderr carries a "[chain] <primary-provider>/<primary-model> <reason> → advancing" note for the skipped primary
```

```
Given a single-backend (legacy, no --backends-json) ollama call with provider omitted, host-source default, that returns findings
When main() writes to stdout
Then the header renders "## Adversarial findings — ollama/<model> (chain[0], host: default)"
```

```
Given any non-OK chain outcome (unreachable / not-served / auth / deadline)
When main() returns
Then stdout, stderr, and the exit code are byte-for-byte identical to pre-change behaviour (no header)
```

## 6. DESIGN DECISION RATIONALE

**How does the helper know who served the winning response?**
- `runReviewChain` already returns `winner` (the full backend object) on exit 0; the loop index `i` is the winner's chain position. **Chosen:** surface `winnerIndex: i` and read `provider`/`model`/`hostSource` off `winner` — no new plumbing, ground-truth source.

**Where is the header emitted?**
- Options: inside `runReviewChain` (into `content`) vs at the `main()` stdout boundary. **Chosen:** `main()`, prepended to stdout outside `content` — keeps `content` a clean body and confines the change to the success branch.

**What header shape serves both consumers?**
- See §3. **Chosen:** unconditional `## Adversarial findings — <provider>/<model> (chain[<i>], host: <source>)` via a named constant — matches the ticket, makes the code-review anchor deterministic, harmless for spec-review (verified against `aggregate.mjs`, which reads assembled JSON not raw stdout).

**Keep or reshape the advancement stderr note?**
- **Chosen:** reshape to `[chain] <tag> <reason> → advancing` (greppable, ticket-named); update any existing test assertion. Rejected: leave as-is (fails the ticket's explicit format ask).

**Remove the model self-naming mandate?**
- **Chosen:** yes — de-mandate it in the default lens so the transport header is the sole one; document duplication from a rogue custom lens as harmless.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. (The cross-consumer shape, the note format, and the self-naming duplication are all resolved as **Chosen:** above.)

**Assumptions.**

- **Assumes:** `aggregate.mjs` consumes assembled Refutation JSON (built by the refuter agent from the model's stdout), never the raw `review-call.mjs` stdout. *Validated:* confirmed by reading `aggregate.mjs` (`readInput` parses a Refutations JSON array/object; §Aggregation in `faffter-dark-spec-review/SKILL.md` shows the agent assembles the JSON). A leading header line therefore cannot break aggregation.
- **Assumes:** the only in-repo consumer of the old `advancing:` stderr format is `test/adversarial-call.test.mjs`. *Validate:* `grep -rn "advancing" plugin/ test/` before shipping; update any other match.

## 8. DONE — Definition of Done

### From WHY
- [ ] With a custom `--system` file, an exit-0 adversarial run still emits the attribution header (the rule no longer lives in droppable lens prose).

### From WHAT (types and interfaces)
- [ ] `runReviewChain` returns `winnerIndex` (0-based) on exit 0; non-OK returns omit it and are otherwise unchanged.
- [ ] `attributionHeader(winner, index)` is a pure, exported function returning `## Adversarial findings — <provider>/<model> (chain[<index>], host: <hostSource>)`, with `provider` defaulting to `ollama` and `hostSource` to `config` when absent.

### From HOW (behaviour)
- [ ] On exit 0, `main()` writes the header as the first stdout line, a blank line, then the trimmed `content`.
- [ ] The header is emitted at the `main()` boundary, not folded into `content` (a caller reading `res.content` sees no header).
- [ ] Each skipped backend prints a `[chain] <provider>/<model> <reason> → advancing` note to stderr.
- [ ] The default adversarial lens prose no longer mandates the model self-name; it documents the header as transport-guaranteed. `faffter-dark-spec-review/SKILL.md` notes the same guarantee for refuters.

### From HOW (edge cases / back-compat)
- [ ] Single-backend legacy path with provider omitted + host-source `default` renders `## Adversarial findings — ollama/<model> (chain[0], host: default)`.
- [ ] Every non-OK exit path (2/4/5/6/7/8) produces byte-for-byte-unchanged stdout, stderr, and exit code (no header).

### From tests
- [ ] `test/adversarial-call.test.mjs` adds: header present+correct on a stubbed OK primary (chain[0]); header names the fallback + `chain[1]` when index-0 fails and a fallback wins; `[chain] … → advancing` stderr note captured via the injected `log` on a forced element-0 failure; `attributionHeader` unit cases (provider-omitted → `ollama`, host-source `default`, slash-bearing model).
- [ ] Any existing assertion on the old `advancing:` format is updated to the new `[chain] …` shape.
- [ ] `node --test test/adversarial-call.test.mjs` passes; no live model calls.

**Eval coverage.** No LLM-judgement seam is introduced or changed (the header is a deterministic string); no grader `KIND` or eval case required.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Build a 2-element chain: primary → { status: "transport-failed" }, fallback → { status: "ok", content: "### major: x" }
  2. Run main(["--backends-json", f, "--system", s, "--diff", d], { runReviewFn: scripted })
  3. Assert stdout line 1 == "## Adversarial findings — <fallback.provider>/<fallback.model> (chain[1], host: config)"
  4. Assert stderr contains "[chain] " + primary.provider + "/" + primary.model + " ... → advancing"
  5. Assert exit == 0
```

---

confidence: high
