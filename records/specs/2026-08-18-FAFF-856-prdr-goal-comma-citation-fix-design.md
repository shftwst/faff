# PRDR goal citations survive an internal comma — JSON-array storage for the `PRD-goals:` field

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high · spec-review: approve (human tie-break — carried objections resolved 2026-08-17) · build-tier: complex. Full spec on Linear FAFF-856.

_Revised 2026-08-17 (interactive re-prep) — folded the human tie-break on the two carried spec-review objections: (1) `prdrValidate` stays lenient/presence-only (no malformed-citation flag); (2) pinned the exact `new --prd-goals` stderr to mirror the coverage guard and made non-string coercion an explicit scenario. The core JSON-array design was unchallenged in review and is unchanged. Supersedes the parked spec above._

This spec addresses **FAFF-856**. Audience: the build agent implementing the fix, and the human reviewers gating it. It describes a contained parser/serializer change in `plugin/skills/faff/bin/lib/prdr.js` so that a PRD goal whose own text contains a comma can be cited and covered.

## 1. WHY — Problem and Principles

**Load-bearing model.** A PRDR record cites the PRD goals it serves in a single-line metadata field, `- **PRD-goals:** …`. Today the comma is doing *two jobs at once*: it is the separator **between** goals on write, and the `split(",")` token on read. Those two jobs are irreconcilable when a goal's own prose contains a comma — the reader cannot tell "one goal with a comma" from "two goals". The fix is to separate the roles: make the stored delimiter a structure a goal string can never collide with (a JSON array), so any character — commas included — is safely contained inside a goal element.

**Problem statement.** PRDR goal citations are comma-joined into the `PRD-goals:` field and read back with `goalsRaw.split(",")` in `prdr.js` (`listPrdrs`, line 77). A goal whose text contains a comma fragments into pieces on read, none of which equals the original goal string; since `faff prdr coverage` matches goals by exact string, that goal can never be marked covered. The P1 link-shortener drain sat permanently at 4/5 coverage for exactly this reason (Finding 3, 2026-08-17) — the one persistence goal ("Codes survive an api container restart, proving the datastore is real…") was the only goal with an internal comma and the only one that stayed uncovered.

**Design principles.**

- **No data migration.** ADR 0111 (FAFF-815) deliberately kept the citation change migration-free — the colon-anchored reader lets the legacy singular `PRD-goal:` and plural `PRD-goals:` coexist. This fix holds that line: the read path stays lenient and back-compatible; no existing record is rewritten.
- **Single-line storage is a hard constraint.** The field reader `adrField` (== `readField`, `bin/lib/fields.js:23`) matches a *single line*. A "one goal per line" scheme would require changing that shared reader (used by ADR, PRD, and PRDR). The chosen format must fit on one line.
- **Consistency with the CLI surface.** The `coverage` / `yagni` / `distance` / `admit` verbs already accept `--prd-goals` as a **JSON array** (JSON.parse, must be `Array`). The stored field should use the same representation, not a second bespoke one.
- **Record-don't-judge (the reader stays lenient).** The read path never rejects or throws on a malformed citation field; it degrades to a best-effort legacy split. Format enforcement is not a reader concern, and — per the resolved objection below — not a `prdrValidate` concern either.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/prdr.js` | The file being changed — `listPrdrs` (read), `prdrTemplate` (write), `new` handler, `prdrValidate`, `--selftest` |
| `plugin/skills/faff/bin/lib/fields.js` (`readField`) | Single-line field reader (FAFF-850); `adrField` is a thin alias. Read-only here |
| `records/adr/0111-…prd-goals…md` | The decision that made citation a comma-separated set; this fix amends its delimiter |
| FAFF-850 | Sibling parse hardening (blank-field over-read); precedent for a scoped `prdr.js` field-parse fix + selftest cases |

**Scope statement.** A storage-format and parse fix inside the PRDR record layer of the faff CLI; it does not touch the YAGNI/coverage/admission *logic*, which already consumes parsed goal arrays.

## 2. OUT OF SCOPE

- **Un-fragmenting legacy bare-comma records whose goal contained a comma** — inherently lossy; only records written by the fixed writer are guaranteed to round-trip. Extension point: a one-off migration script over an existing `docs/prdr/` tree.
- **Widening the cited set on the under-citation admit path** — ADR 0111 already deferred this writer; unchanged. Extension point: `prdrAccept`.
- **Changing coverage/YAGNI/admission semantics** — those verbs already take JSON arrays; the bug is purely the record round-trip. Extension point: `contract-defs.js`.
- **Multi-line field storage / changing `readField`** — violates the single-line principle and touches the shared ADR/PRD reader. Extension point: `bin/lib/fields.js`.
- **Strict citation-format validation in `prdrValidate`** — see the resolved design decision in Section 3; `prdrValidate` stays presence-only. Extension point: `prdrValidate`.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Citation field | The `- **PRD-goals:** …` (or legacy `- **PRD-goal:** …`) metadata line in a PRDR record |
| Goal set | The ordered list of goal strings a PRDR cites — `prd_goals[]` |
| Legacy format | A citation field storing a bare comma-joined string (pre-change) or the singular `PRD-goal:` line |
| Canonical format | A citation field storing a JSON array string (post-change writer output) |

**Parsed record shape (unchanged public shape).**

```
RECORD PrdrEntry (subset):
  prd_goals: List<String>   # trimmed, empties dropped; may be []
  prd_goal:  String         # primary = prd_goals[0] ?? ""  (legacy single-goal consumers)
```

**Field serialization contract (new).**

```
# Canonical write (prdrTemplate):
- **PRD-goals:** ["Codes survive an api container restart, proving the datastore is real."]

# Legacy read still accepted (no migration):
- **PRD-goals:** g1, g2, g3        # bare comma-joined  -> ["g1","g2","g3"]
- **PRD-goal:**  only              # legacy singular    -> ["only"]
```

**Design decision — storage format.** Options: (a) JSON array on the single field line; (b) one goal per line; (c) an alternate single-char delimiter. (b) needs shared-reader surgery; (c) only relocates the collision. **Chosen:** JSON array string on the single `PRD-goals:` field line, with a lenient reader that falls back to legacy comma-split. Amends ADR 0111's comma-delimiter mechanism; architecturally significant (durable record-format decision).

**Design decision — author-facing input for a multi-goal set.** The comma can no longer double as the author's separator. **Chosen:** accept a `--prd-goals` JSON-array flag on `new` (parity with the `coverage`/`yagni`/`distance` verbs), and keep single `--prd-goal` writing a one-element array; both serialize through `prdrTemplate` as a JSON array.

**Design decision — malformed-citation validation posture (resolved 2026-08-17, human tie-break).** A round-2 review objection asked whether `prdrValidate` should flag a citation field that is present but parses to neither a JSON array nor a legacy comma list. **Chosen:** `prdrValidate` stays **presence-only** — it continues to flag only a missing/empty citation field (`missing PRD-goal(s) citation field`) and emits **no** new problem for a malformed-format citation. Rationale: it matches ADR 0111's deliberate migration-free/lenient stance, is consistent with how `prdrValidate` treats every other field (presence, not internal format — even a vacuous `_TODO_` DoD validates presence-only), keeps the reader and the validator aligned (both lenient), and holds the change to the actual bug. Stricter format validation is explicitly an out-of-scope extension point (Section 2).

## 4. HOW — Behavior

**Approach.** Three coordinated edits in `prdr.js`, plus selftest cases: the read path becomes format-tolerant; the write path emits the canonical JSON array; `new` gains an explicit set input. `prdrValidate` is deliberately **not** changed (Section 3).

**Read path — `listPrdrs` (currently lines 76–77).**

```
PROCEDURE parse_citation(text):
  1. raw := adrField(text, "PRD-goals") ?? adrField(text, "PRD-goal")
  2. IF raw is null OR trimmed-empty: return []              # preserves FAFF-850 blank-field behaviour
  3. TRY parsed := JSON.parse(raw)
       IF parsed is an Array:
         return parsed.map(el -> String(el).trim()).filter(non-empty)   # canonical path; comma-in-goal safe
     CATCH (SyntaxError) / parsed is not an Array:
       fall through                                          # never propagate the throw
  4. return raw.split(",").map(trim).filter(Boolean)         # legacy fallback (bare comma / singular)
```

- **`JSON.parse` is always inside try/catch** — a throw is caught and routed to the legacy split, never propagated; a malformed/pathological value degrades to the split and never crashes `listPrdrs`. (Threat-model note: PRDR records are committed repo markdown, not network input; defensive robustness, not a trust boundary.)
- Each element is coerced via `String(el).trim()` so a non-string element (e.g. a number or `null` inside the array) becomes a trimmed string; empties dropped (matches `filter(Boolean)`).
- The JSON branch fires only when the field parses to a JSON **array**; a JSON string/number/object falls through to the legacy split.
- Blank-field handling (FAFF-850) preserved by the early empty return.

**Write path — `prdrTemplate` (line 103) + `new` handler.**

```
render_citation_field(goals): return `- **PRD-goals:** ${JSON.stringify(goals)}`
```

- `prdrTemplate`'s `prdGoal` param becomes a goal **array** (or normalizes a single string to `[string]`), always JSON-stringifying an array.
- `new` builds the array: `--prd-goals <json>` when present, else `[--prd-goal value]`.
- **`new --prd-goals` guard — pin the stderr to mirror the sibling verbs.** A malformed value exits 2 and writes no record, with the **exact** stderr strings the `coverage`/`yagni`/`distance` guards already use, only the verb name differing:
  - parse failure → `faff prdr new: --prd-goals is not valid JSON: <e.message>`
  - valid JSON but not an array → `faff prdr new: --prd-goals must be a JSON array of strings`

**Edge cases.** Blank → `[]`; legacy singular → one-element set; JSON array with empty string → dropped by filter; a non-string array element → coerced via `String(el).trim()`; a legacy bare `[...]`-looking goal → **Anti-pattern:** don't hand-write a raw JSON array while relying on comma-split semantics (pick one format per field). **Anti-pattern:** changing `readField`/`adrField` to multi-line — shared by ADR/PRD.

## 5. SCENARIOS

```
Given a PRDR authored by the fixed writer whose sole cited goal is
      "Codes survive an api container restart, proving the datastore is real."
When the record is read back by listPrdrs
Then prd_goals has exactly one element equal to that full string (not two fragments)
```
```
Given a legacy record storing a bare comma-joined "g1, g2, g3" in PRD-goals
When listPrdrs reads it
Then prd_goals == ["g1","g2","g3"]   (legacy fallback preserved, no migration)
```
```
Given a PRDR with a blank PRD-goals field
When listPrdrs reads it
Then prd_goals == [] and prd_goal == ""   (FAFF-850 not regressed)
```
```
Given `faff prdr new` invoked with a --prd-goals value that is not valid JSON
When the command runs
Then it exits 2, writes no record, and stderr contains "faff prdr new: --prd-goals is not valid JSON:"
```
```
Given `faff prdr new` invoked with a --prd-goals value that is valid JSON but not an array (e.g. '{"a":1}' or '123')
When the command runs
Then it exits 2, writes no record, and stderr contains "faff prdr new: --prd-goals must be a JSON array of strings"
```
```
Given a canonical PRD-goals field holding an array with a non-string element, e.g. ["ok", 42, null, " padded "]
When listPrdrs reads it
Then prd_goals == ["ok", "42", "padded"]   (each element String()-coerced and trimmed; empty/nullish dropped)
```
```
Given a legacy PRD-goals field holding a pathological/unterminated JSON-looking value
When listPrdrs reads it
Then it does not throw — it falls back to the legacy split and returns a best-effort goal list
```

## 6. DESIGN DECISION RATIONALE

- **Storage format:** **Chosen** JSON array on the single field line, lenient reader with legacy comma-split fallback. Amends ADR 0111. The CLI verbs already parse `--prd-goals` as JSON, so this unifies the representation.
- **`new` author input:** **Chosen** a `--prd-goals` JSON-array flag for explicit sets; `--prd-goal` retained writing a one-element array.
- **Malformed-citation validation:** **Chosen** `prdrValidate` stays presence-only (no malformed-format flag) — reader and validator stay aligned and lenient, matching ADR 0111 and the presence-only treatment of every other field. Human tie-break, 2026-08-17.
- **Migrate legacy records?** **Chosen** no — reader stays back-compatible (ADR 0111's migration-free stance); legacy comma-in-goal records remain best-effort, only fixed-writer output is guaranteed.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. (The round-2 validation-posture question is resolved in Section 3.)

**Assumptions:** `**Assumes:**` the `coverage`/`yagni`/`distance`/`admit` verbs consume the `prd_goals` array from `listPrdrs` (not the raw field) and match by exact string — confirmed during explore (`prdr.js` ~lines 492, 536); no change needed there.

## 8. DONE — Definition of Done

**From WHY** — [ ] A PRDR whose single cited goal contains an internal comma round-trips write→read as exactly one goal equal to the original string.

**From WHAT (format)** — [ ] `prdrTemplate` emits `- **PRD-goals:** <json-array>`. [ ] `new` accepts `--prd-goals <json>` (array-of-strings; exit 2 on malformed) and still accepts `--prd-goal` (written as a one-element array).

**From HOW (read behaviour)** — [ ] `listPrdrs` parses a JSON-array field into `prd_goals` (trimmed, empties dropped). [ ] A non-JSON/non-array field falls back to `split(",")` (legacy bare-comma + singular `PRD-goal:` still parse). [ ] A malformed/pathological JSON value does not throw — caught and routed to the legacy split. [ ] Elements coerced via `String(el).trim()`. [ ] Blank field → `prd_goals == []`, `prd_goal == ""`. [ ] `prd_goal` stays `prd_goals[0] ?? ""`.

**From HOW (author input + stderr)** — [ ] `new` with a non-JSON `--prd-goals` exits 2, writes no record, stderr contains `faff prdr new: --prd-goals is not valid JSON:`. [ ] `new` with a non-array JSON `--prd-goals` exits 2, writes no record, stderr contains `faff prdr new: --prd-goals must be a JSON array of strings`.

**From WHAT (validation posture)** — [ ] `prdrValidate` remains presence-only: it still flags a missing/empty citation but emits **no** new problem for a malformed-format citation field (reader and validator stay aligned).

**From HOW (tests)** — [ ] `--selftest` gains a comma-in-goal round-trip case. [ ] Adds the non-string-element coercion case and both `new --prd-goals` exit-2 stderr cases. [ ] Retains a green legacy bare-comma multi-goal case. [ ] Existing FAFF-850 blank-field + FAFF-815 plural/legacy cases stay green (adjust authoring only if the writer change requires it, preserving assertions). [ ] `faff prdr --selftest` exits 0.

**Integration smoke test**
```
1. faff prdr new "Persistence" --container api --prd-goal "Codes survive a restart, proving the datastore is real"
2. faff prdr list --json  ->  prd_goals == ["Codes survive a restart, proving the datastore is real"]  (length 1)
3. faff prdr coverage --prd-goals '["Codes survive a restart, proving the datastore is real"]'  ->  that goal is covered
```

## Methodology critique (agile-delivery)

- **Right-sized?** One file (`prdr.js`) + its `--selftest`; read fix, write flag, and cases ship together. No issues — one 1–3 day unit, do not split.
- **Workstream fit?** Continues the citation-as-set line of FAFF-815 (ADR 0111) and FAFF-850; single cohesive outcome. No issues.
- **Deps surfaced?** FAFF-815 + FAFF-850 named as Related (both Done); leans on ADR 0111 + the existing `--prd-goals` JSON surface, both cited. No issues.
- **Risk profile?** The lenient no-migration fallback is the real risk (parse-disambiguation), contained to one pure function — no spike needed; pin the JSON-vs-legacy boundary in the selftest.
