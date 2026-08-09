# nlspec — FAFF-220: Provenance schema 1→2 — `initiated` audit field

> Split B of FAFF-217 (scope-containment) — the additive provenance-record migration. Independent of Split A (`faff contain`, FAFF-219). Full design on FAFF-217's spec comment. Confidence: high.

**Artifact:** an additive migration to the FAFF-212 provenance record in `plugin/skills/faff/bin/faff`. **Audience:** the build agent and human reviewers ratifying the additive-migration approach.

## 1. WHY

The initiation mode (interactive vs autonomous) is FAFF-217's audit breadcrumb, promoted from the spoofable `faff-jot-intake` / `faff-chain-gap-fill` labels (FAFF-209: *the label alone is NOT provenance*) to a structured field in FAFF-212's provenance record. **Audit only — never the containment gate** (that is FAFF-217's write-side refusal, built in FAFF-219/221). This split lands the record-shape migration in isolation so the schema bump and reader-grandfathering ship on their own risk curve, independent of the net-new ancestry-walk.

## 2. OUT OF SCOPE

- **The `faff contain` primitive / subtree-membership walk** — FAFF-219.
- **Wiring the autonomous filing chokepoints + outward-new-root surfacing** — FAFF-221.
- **Any change to `intakeVerdict` / `intakecheck` behaviour.** This migration is additive to the record only; the verdict function and the gate are untouched. AUDIT-ONLY invariant: `initiated` is referenced in **no** verdict/gate function.
- **Stamping `initiated` from the real run-mode at the create paths** (jot/plot → interactive; beep-boop/tidy → autonomous). The *field + the writer flag + the accessor* land here; the create-path wiring that chooses the mode is FAFF-221's chokepoint work. This ticket gives FAFF-221 the `--initiated` flag to call.

## 3. WHAT

**Schema bump.** `PROVENANCE_SCHEMA` 1 → 2 (`bin/faff:1033`).

**Closed mode set.** A new `INITIATED_MODE = new Set(["interactive", "autonomous"])`, mirroring `INTAKE_VIA` (`bin/faff:1034`).

**Record shape (additive).** `.faff/provenance/<ISSUE>.json` gains an optional `initiated: "interactive" | "autonomous"` key. Absent ⇒ omit the key (never write `initiated: null`). v1 (schema:1) markers, which have no key, read back as `initiated → null` with no error.

**Writer flag.** A new optional value-flag `--initiated <mode>` on `intake-record`:
- Added to `INTAKE_VALUE_FLAGS` so `parseIntakeArgs` consumes its value.
- Validated against `INITIATED_MODE` → invalid value exits **2** writing nothing (parity with `--via`).
- Absent ⇒ the key is omitted from the written marker (never `initiated: null`).
- Merge-preserves an existing `initiated` (load-or-init keeps prior value when the flag is not passed).

**Pure accessor.** `initiatedOf(marker)` → `"interactive" | "autonomous" | null`. Centralises the grandfather rule: returns the recorded value when it is a member of `INITIATED_MODE`, else `null` (covers absent key, schema:1 markers, malformed/unknown values). No side effects, no fs.

**Label demotion (text only).** Reword the `faff-jot-intake` / `faff-chain-gap-fill` `CONTROL_LABELS` descriptions to mark them cosmetic / grandfather hints — the load-bearing signal is now the `initiated` field. No behavioural change (the labels still exist; only their descriptions change).

## 4. HOW

- `PROVENANCE_SCHEMA = 2`. Every fresh write stamps `schema: 2`; re-reads of schema:1 markers are unaffected (the reader never asserts a schema value).
- `INITIATED_MODE` declared next to `INTAKE_VIA`.
- `parseIntakeArgs`: `INTAKE_VALUE_FLAGS` gains `--initiated`. A dangling `--initiated` (value is another flag / absent) is caught by the existing `danglingValueFlag` path → exit 2 in `cmdIntakeRecord`.
- `cmdIntakeRecord`: after the `--via` validation, if `--initiated` is present, validate against `INITIATED_MODE` (invalid → stderr + exit 2, nothing written, parity with `--via`). On the marker write, set `marker.initiated` only when a valid mode was supplied; when absent, **do not** set the key (load-or-init merge preserves any existing value). The descriptor mirrors the same conditional.
- `initiatedOf(marker)`: `const v = marker && marker.initiated; return INITIATED_MODE.has(v) ? v : null;`
- `intakeVerdict` / `cmdIntakecheck` are **not touched** — `initiated` never enters a verdict or gate path.
- Selftests: extend `INTAKE_RECORD_SELFTEST_CASES` (or add a sibling) to cover `--initiated` validation (valid interactive/autonomous accepted, bogus rejected, absent omitted) and add an `initiatedOf` grandfather table (v2 value → itself, schema:1/absent → null, bogus → null).

## 5. SCENARIOS

```
Given intake-record FAFF-X --via jot --initiated interactive
Then the marker has { schema: 2, intake:{via:jot}, initiated: "interactive" } and initiatedOf → "interactive"
```
```
Given intake-record FAFF-X --via jot --initiated autonomous
Then the marker has initiated: "autonomous"
```
```
Given intake-record FAFF-X --via jot --initiated bogus
Then exit 2, nothing written (parity with an invalid --via)
```
```
Given intake-record FAFF-X --via jot   (no --initiated)
Then the marker omits the initiated key entirely (never initiated: null); initiatedOf → null
```
```
Given a legacy v1 marker { schema: 1, intake:{via:jot} }
Then it reads back without error and initiatedOf → null (grandfathered)
```
```
Given an existing marker with initiated:"interactive", re-run intake-record --via backfill (no --initiated)
Then the existing initiated is merge-preserved
```

**Non-functional assertions:**
- The schema bump is additive — a v1 marker is read without error, `initiated` resolves to null.
- `intakecheck` / `intakeVerdict` behaviour is byte-identical to FAFF-212 (selftest still passes).
- `initiated` appears in **no** verdict/gate function (audit-only invariant).

## 6. DESIGN DECISIONS

- **`--initiated` flag, not a separate verb** — parity with `--via`; FAFF-221 calls it from the chokepoints with the real run-mode. The flag does not *choose* the mode (the create path does); it only records what it is told.
- **Omit the key when absent, never `initiated: null`** — keeps schema:1 and "mode-unknown" markers indistinguishable on disk (both have no key); `initiatedOf` is the single normaliser to `null`.
- **`initiatedOf` accessor centralises the grandfather rule** — one place returns `null` for absent / schema:1 / malformed, so readers never re-implement the rule and the audit-only invariant is easy to assert.

## 7. OPEN QUESTIONS

None blocking — additive migration.

## 8. DONE

- [ ] `PROVENANCE_SCHEMA` bumped 1→2.
- [ ] `INITIATED_MODE = {interactive, autonomous}` closed set added (mirrors `INTAKE_VIA`).
- [ ] `--initiated` value-flag on `intake-record`: added to `INTAKE_VALUE_FLAGS`; validated against the set → exit 2 on invalid (parity with `--via`); absent → key omitted (never `initiated: null`); merge-preserves existing.
- [ ] `initiatedOf(marker)` pure accessor returns the recorded mode or null (grandfathers absent / schema:1 / malformed).
- [ ] v1 (schema:1) markers read back with `initiated → null`, no error.
- [ ] `intakeVerdict` / `intakecheck` behaviour unchanged (existing selftest passes).
- [ ] `faff-jot-intake` / `faff-chain-gap-fill` CONTROL_LABELS descriptions reworded cosmetic/grandfather (text only).
- [ ] `intake-record` / `intakecheck` selftests extended for `--initiated` + `initiatedOf`.
- [ ] AUDIT-ONLY invariant: `initiated` referenced in no verdict/gate function.

confidence: high
