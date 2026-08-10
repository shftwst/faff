# FAFF-723 — faff doctor usage string: `--target DIR`

> Spec: faffter-dark-nlspec · 2026-08-10 · autonomous · confidence: high. Full spec on Linear FAFF-723.

This spec addresses Linear issue **FAFF-723** — a cosmetic bug in the `faff doctor` parse-error usage string. It is written for the build agent implementing the one-line fix and for human reviewers gating it. Because the fix is fully determined by the codebase, the spec is deliberately lite: every decision is `**Chosen:**`, with no open questions.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff doctor`'s `--target` flag takes a **directory to scan**; the tokens `live` / `intoWorktree` are *link-classification states* returned by a different helper (`classifyGlobalLink`) and have nothing to do with what `--target` accepts. The usage string on the parse-error path conflates the two — it advertises `--target live|intoWorktree` as if those were the flag's legal values.

**Problem statement.** When `parseArgs` rejects `faff doctor`'s arguments, `cmdDoctor` prints `usage: faff doctor [--target live|intoWorktree] [--root DIR] [--json]`, which misdescribes `--target` as taking one of two enum-like tokens. In reality `--target` takes a directory path (it flows straight into `resolveDoctorScanSet` as a scan root), and `docs/guide/cli.md` already documents it correctly as `--target DIR`, so the CLI's own error line is the single source that disagrees with the guide. This change corrects that one token to `--target DIR`.

**Design principle.**

**Minimal, literal, string-only.** This is a documented pre-existing bug that FAFF-676 named explicitly OUT OF SCOPE. The fix must touch exactly one string literal and nothing else — no change to `DOCTOR_SPEC`, `parseArgs`, arg semantics, exit codes, or output channels. Any implementation that alters behaviour is wrong by construction. **Chosen:** edit only the `--target live|intoWorktree` token.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js:866` | JavaScript | The `cmdDoctor` parse-error branch holding the incorrect usage string |
| `plugin/skills/faff/bin/lib/gates.js:490-501` | JavaScript | `classifyGlobalLink` — returns `dangling`/`intoWorktree`/`live`; the source the leaked tokens actually belong to |
| `docs/guide/cli.md` | Markdown | Already documents `--target DIR` correctly; the target of parity |
| `test/doctor.test.mjs:108-112` | JavaScript | The sole usage-error test; asserts exit code `2` only, not message text |

**Scope statement.** This sits entirely inside `cmdDoctor`'s parse-error branch in the faff CLI's gates module — a leaf string fix with no callers depending on the string's content.

## 2. OUT OF SCOPE

- **The `[--json]` token** — Excluded because it is correct and was added to this usage string after the ticket was filed. Why excluded: touching it risks regressing an accurate token. Extension point: none needed; preserve it verbatim in `gates.js:866`.
- **`--root DIR` token** — Excluded; already correct. Why excluded: no bug there. Extension point: n/a.
- **Reworking the usage-error mechanism / `usageError` helper** — Excluded; the plumbing works. Why excluded: this ticket is a copy fix, not a refactor. Extension point: `usageError` in `gates.js` if error-formatting ever needs rework (separate issue).
- **Any `--target` semantics or `DOCTOR_SPEC` change** — Excluded; the flag already behaves correctly. Why excluded: FAFF-676 owned the scan-set behaviour and this ticket is strictly the leftover string bug. Extension point: `resolveDoctorScanSet` / `DOCTOR_SPEC` for future scan-set work.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Usage string | The single-line `usage: …` synopsis passed to `usageError` and emitted when `parseArgs` returns errors. |
| `--target` | A `faff doctor` flag whose value is a **directory path** to scan for faff skill links. |
| `live` / `intoWorktree` | Link-classification states returned by `classifyGlobalLink`; NOT legal `--target` values. Their appearance in the usage string is the bug. |

**The change.** One string literal at `gates.js:866`.

```
BEFORE: "usage: faff doctor [--target live|intoWorktree] [--root DIR] [--json]"
AFTER:  "usage: faff doctor [--target DIR] [--root DIR] [--json]"
```

Only the `--target` token's placeholder changes: `live|intoWorktree` → `DIR`. The `[--root DIR]` and `[--json]` tokens, the `usage: faff doctor ` prefix, and the surrounding `usageError(errors, …)` call are unchanged.

**Design decision — placeholder wording.** `--target DIR` (matching `--root DIR` and the guide) vs. an alternative like `--target PATH`. **Chosen:** `--target DIR` — it matches the existing `[--root DIR]` token on the same line and the exact wording in `docs/guide/cli.md`, giving CLI↔guide parity with zero new vocabulary.

## 4. HOW — Behaviour

**Approach.** Single-token string edit; no control-flow, arg-parsing, or output change.

```
PROCEDURE fix_doctor_usage_string:
  1. Open plugin/skills/faff/bin/lib/gates.js
  2. In cmdDoctor's parse-error branch (currently line 866), locate the
     usageError(...) call whose second argument is the usage string.
  3. Replace the substring "--target live|intoWorktree" with "--target DIR".
  4. Leave every other token ("usage: faff doctor ", "[--root DIR]", "[--json]")
     and the usageError call itself byte-for-byte unchanged.
```

**Edge cases.** None new. The parse-error branch fires exactly as before (same `errors.length` condition, same exit code `2` via `usageError`); only the emitted text differs.

**Anti-pattern:** Reflowing or "tidying" the whole usage string. Why: it risks dropping `[--json]` or diverging from `docs/guide/cli.md`; the fix is one token.

## 5. Scenarios

The behavioural objective (parse-error handling) is trivial and its observable is a fixed string, so per the complexity bar only the corrected-text objective earns a scenario.

```
Given a `faff doctor` invocation whose arguments fail parseArgs (e.g. an unknown flag)
When cmdDoctor takes the parse-error branch
Then the emitted usage line reads exactly "usage: faff doctor [--target DIR] [--root DIR] [--json]"
And it contains neither "live" nor "intoWorktree"
And the process still exits 2
```

## 6. Design Decision Rationale

**Which token(s) to change?**
- Change only `--target live|intoWorktree` → `--target DIR`: minimal, corrects exactly the bug, preserves the correct `[--root DIR]` and `[--json]`. Con: none.
- Rewrite the whole usage string: unnecessary churn, risks regressing correct tokens.

**Chosen:** change only the `--target` token to `--target DIR` — smallest correct edit, achieves CLI↔guide parity.

**Placeholder metavariable — `DIR` vs `PATH`?**
- `DIR`: matches `[--root DIR]` on the same line and the guide verbatim.
- `PATH`: introduces a second metavariable convention for no gain.

**Chosen:** `DIR` — consistency with the existing line and the documented guide.

**Add a test assertion on the usage text?**
- The existing usage-error test (`test/doctor.test.mjs:108-112`) asserts exit code `2` only, not message content, so it does not fail on the current bug and does not require a change.
- Optionally tighten it to also assert the corrected text.

**Chosen:** optionally add one assertion (`assert.match(r.out_or_err, /\[--target DIR\]/)` and a negative match on `intoWorktree`) to lock the fix; not required for correctness since no existing assertion contradicts it. Confirm which stream (`stdout`/`stderr`) `usageError` writes to before asserting on it, mirroring how the surrounding tests read `run(...)`'s result.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.**

- **Assumes:** the usage string at `gates.js:866` is still `usage: faff doctor [--target live|intoWorktree] [--root DIR] [--json]` at build time. Validation: `grep -n "usage: faff doctor" plugin/skills/faff/bin/lib/gates.js` before editing; if the line has drifted again, apply the same single-token substitution wherever it now lives.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff doctor`'s parse-error usage line no longer contains `live` or `intoWorktree`.
- [ ] The CLI usage line matches `docs/guide/cli.md`'s `--target DIR` wording.

### From WHAT / HOW
- [ ] `gates.js:866` (or wherever the line now lives) reads `usage: faff doctor [--target DIR] [--root DIR] [--json]` exactly.
- [ ] `[--root DIR]` and `[--json]` tokens are preserved unchanged.
- [ ] No change to `DOCTOR_SPEC`, `parseArgs`, `--target` semantics, exit codes, or output channels.

### From Scenarios / tests
- [ ] A parse-error `faff doctor` invocation still exits `2`.
- [ ] The existing doctor test suite (`test/doctor.test.mjs`) passes; if a usage-text assertion is added, it asserts the corrected string and a negative match on `intoWorktree`.

**Integration smoke test.**

```
1. Run `faff doctor --bogusflag`
2. Observe: exit code 2, and the usage line printed reads
   "usage: faff doctor [--target DIR] [--root DIR] [--json]"
   with no occurrence of "live" or "intoWorktree".
```