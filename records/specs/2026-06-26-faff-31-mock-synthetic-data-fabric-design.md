# FAFF-31 — Fixtures fabric: dataset-manifest schema + `faff fixtures` CLI (slice 1 of 2)

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: medium.
> Slice 1 of 2. The **generation strategy** (the producer that fills a dataset from a manifest) is the deferred slice (`fixtures` slot, blockedBy this). This slice ships the manifest schema + `faff fixtures` CLI + a trivial reference generator only.

Build spec for FAFF-31 slice 1. It defines the **fixtures manifest** — a structured, reproducible description of a synthetic dataset to seed into a provisioned env — as a fixed, CLI-validated contract, plus the read path and a trivial deterministic reference generator. It does **not** ship a rich generation strategy (that's a `fixtures`-slot producer's job). This is the data half of the L4 evaluator substrate: it unblocks FAFF-34 (code-blind holdout evaluator) by giving it a dataset it can poke through a running env, without the evaluator ever seeing how the data was made.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the *manifest* is the product, not the generator. The L4 holdout evaluator (FAFF-34) must exercise a built feature against realistic data in a provisioned env (FAFF-30) and compare runs in a clean room — but it must stay **code-blind**: it sees the running env and the spec, never the generation code. That only works if "what data exists" is a fixed, machine-readable, *reproducible* contract independent of how the bytes get produced.

**Design principles:**

- **The manifest is the contract; the generator is a slot.** Schema defined + validated by the `faff` CLI (deterministic-tools-over-prose, mirroring `faff profile` / `faff contract`). The data-generation *strategy* is a separate slot occupant (next slice).
- **Synthetic by construction, so no PII.** v1 generates synthetic data from a seed; it never masks or samples real/production data.
- **Determinism is provisioned, not assumed.** Same seed → byte-identical dataset, every run, on every machine. Mirrors `seed-repo.mjs` (FAFF-90).
- **Human intent outranks machine inference.** Config-asserted value wins over a stored one, field-by-field, computed on read — the storage split + conflict-authority rule of ADR 0013.
- **Degrade cleanly on absence.** "No manifest yet" and "sparse manifest" are valid states, never errors.

## 2. OUT OF SCOPE

- Masked-real / production-data sampling (imports PII handling + Security-track dep).
- Any rich generation strategy (the producer) — deferred `fixtures` slot.
- Auto-discovery of the target schema from a codebase (declared input in v1).
- Loading the dataset into a live env (the FAFF-30 ⊕ FAFF-34 seam).
- Schema migration / cross-entity referential integrity (a producer concern).
- Multi-mode override merge (only human-override-vs-stored, field-wholesale).

## 3. WHAT — Manifest schema

```
RECORD FixturesManifest:
  schema: int                  # currently 1; REQUIRED
  authored_at: Timestamp       # ISO-8601; REQUIRED
  authored_by: string          # REQUIRED
  seed: string                 # REQUIRED — determinism root
  target_schema: TargetSchema  # REQUIRED
  volumes: Map<string,int>     # entity-name → row count; keys MUST be entities; counts >= 0
  dataset_path: string         # default ".faff/fixtures/dataset"
  prefs: Map<string,string>    # override block only
  notes: List<string>

RECORD TargetSchema: entities: List<Entity>   # REQUIRED, non-empty
RECORD Entity: name (REQUIRED, unique); fields: List<Field> (REQUIRED, non-empty)
RECORD Field:  name (REQUIRED, unique within entity); type (REQUIRED, ∈ FIELD_TYPES)
ENUM FIELD_TYPES: { "string", "int", "bool", "timestamp", "uuid" }
```

`FIELD_TYPES` is the deliberately small v1 primitive set; versioned + additive (growth is non-breaking).

**Storage + override** (identical to FAFF-26 / ADR 0013):

- Stored manifest → `.faff/fixtures/manifest.json` (machine-owned, gitignored).
- Human override → optional `fixtures:` block in `.faffrc.yaml`.
- Effective manifest = stored ⊕ override, override winning field-by-field, computed on read.
- Realised dataset → `dataset_path` (default `.faff/fixtures/dataset`).

**Design decisions:** synthetic-only v1 (no PII); determinism by seed; declared target schema; ADR-0013 storage split; generator emits `faff-contract:fixtures-manifest`, orchestrator validates via `faff fixtures validate`; CLI noun `fixtures` (human taste call).

**Punt:** whether v1 `FIELD_TYPES` + flat per-entity `volumes` suffice for FAFF-34's first real eval target. Believed sufficient; versioned + additive so growth is non-breaking. A human should confirm against FAFF-34's first concrete target before the producer slice. **Non-blocking for this slice.**

## 4. HOW — Behavior

Three CLI surfaces under a new top-level `faff fixtures`, mirroring `faff profile`:

1. `faff fixtures validate [--file PATH]` — exit 0 valid / 1 invalid+reasons / 2 malformed.
2. `faff fixtures show` — effective (stored ⊕ override); exit 3 when none.
3. `faff fixtures realise [--file PATH] [--out DIR]` — the trivial reference generator; deterministically realises a dataset from `seed` into `dataset_path`/`--out`; exit 0 / 1 invalid / 2 malformed.

`faff fixtures --selftest` — in-memory validator-table selftest.

**Determinism mechanics:** a self-contained seeded PRNG over a hash of `manifest.seed`, dependency-free (`node:*` only). MUST NOT touch `Date.now()`, `Math.random()`, `crypto.randomUUID()`, mtime, or the network for any generated value.

## 8. DONE

- Hand-authored manifest validates, realises, and reads via `faff fixtures show`.
- No realised value is PII (synthetic-by-construction).
- Required fields enforced; `schema != 1` → invalid; dup entity/field, empty fields, bad type → invalid; dangling/negative volumes → invalid; sparse manifest valid.
- `validate`/`show`/`realise` exit codes per §4; override wins per field with a note.
- Two `realise` runs → byte-identical; no wall-clock/`Math.random`/`crypto.randomUUID`/network value; malformed stored manifest → exit 2.
- Covered by `test/fixtures.test.mjs` under `node --test`, offline.

confidence: medium
