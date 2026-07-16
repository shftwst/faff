# FAFF-514 — faff owns the integrity boundary's content: the `faff integrity-boundary` emitter + ADR-0061 amendment

> Spec: faffter-dark-nlspec · 2026-07-15 · interactive · confidence: high. Full spec on Linear FAFF-514.

The faff side of the integrity-boundary source-of-truth inversion — a canonical-boundary emitter subcommand, a companion ADR, and doc swaps. The cage half (read-only mount + attestation) is FAFF-517.

## 1. WHY
faff already reads `FAFF_INTEGRITY_BOUNDARY=<version>:<dir1>,<dir2>,...` from pid-1's environ and asserts the named dirs cover its forge surface (FAFF-325). Inversion: faff *emits* the canonical (version, dir-set) so the cage/hand-operator composes the declaration from faff instead of hand-writing faff-internal dir names — a future dir-set addition becomes a faff-only change (FAFF-466 adding events.jsonl was that drift once). faff owns the declaration's CONTENT; the cage owns its TRUTH (the mount); the launcher owns SETTING it. Assert-don't-implement stands: faff never provisions a mount, never sets the declaration, never verifies :ro.

## 2. OUT OF SCOPE
Any cage-side implementation (FAFF-517); the --init attestation-channel decision (FAFF-516); version gating in the reader; declared-vs-expected equality auditing; verifying :ro is real; the evaluator-cage analogue.

## 3. WHAT
New subcommand `faff integrity-boundary [--root DIR] [--run-dir DIR [--issue ID] [--events]] [--json] [--selftest]`:
- Default (launch grain): prints exactly `v1:<abs-root>/.faff/runs` (the stable ancestor; coverage math accepts ancestors, per-run paths can't exist at cage launch).
- `--run-dir DIR`: prints `v1:` + `correctiveIntegrityDirs(DIR, issue, {events}).join(",")`.
- `--json`: `{version, mode, dirs, declaration}`.
- Exit 0 printed; 2 bad input (unknown flag, unresolvable/nonexistent root, --issue/--events without --run-dir, comma in any emitted path).

**Root resolution — strict, never guessed.** `--root` must name an existing dir; without it, walk up for the first `.git`/`.faff`/`.faffrc.yaml` ancestor, exit 2 on no marker. Deliberately tightens findRoot (which falls back to a guessed path); findRoot untouched.

**Version.** faff owns `INTEGRITY_BOUNDARY_VERSION = "v1"`, emits it; the reader stays ungated (an arbitrary token still asserts). Bump only on an incompatible meaning change.

**No equality assertion.** Too-narrow is already `dir-mismatch`; equality would reject over-broad, reversing ADR-0061's trust stance. Coverage-only stands.

**Module home:** the emitter lives in `corrective-integrity.js` (region:factory), riding `correctiveIntegrityDirs` directly.

## 4. HOW
The round-trip property (selftested): a pid-1 environ fixture carrying the default print for root R makes `correctiveIntegrityProbe` return `asserted:true` against `correctiveIntegrityDirs(join(R,".faff","runs","any-id"), issue, {events})` for all issue×events combinations; the per-run print equals the declaration of exactly that set. Emitter and reader are the same function → cannot drift. Comma in any path fails loud.

Reader-side: the `lights-out.js` no-declaration remedy names `faff integrity-boundary` as the composer (its selftest fixture updates with it). Trust math ships byte-identical.

Companion ADR (0074): amends ADR-0061 with the content-origin/boundary-origin split, records the no-equality + ungated-version decisions, names the open FAFF-516 --init channel conflict; ADR-0061 gains an `**Amended:**` forward-pointer.

Docs: `unattended.md` names both attestation postures (cage-automated later; hand-composed via the emitter today) + the engine-cage --init caveat; the three scaffolder reminder lines point at the emitter (the literal token `FAFF_INTEGRITY_BOUNDARY` stays in each); one `cli.md` row.

Anti-patterns: emitting a default/fallback declaration anywhere in faff (converts the attestation into a switch — a lying attestation); the emitter reading/validating pid-1 environ (origin and reader must stay separate authorities).

## 5. Scenarios
- In a repo with a marker at R: `faff integrity-boundary` → `v1:R/.faff/runs`, exit 0.
- A pid-1 fixture = the default print for R → `correctiveIntegrityProbe` asserts over the full per-issue, events-on surface.
- `--run-dir D --issue FAFF-9 --events` → `v1:` + the six correctiveIntegrityDirs paths, comma-joined.
- A root containing a comma → exit 2, nothing on stdout.
- No marker + no --root → exit 2, nothing on stdout (never a guess).
- Reader version-ungated: an arbitrary version token still asserts.
- corrective-integrity --selftest passes unmodified (trust math unchanged).

## 8. DONE
- `integrity-boundary` in COMMANDS + one cli.md row; `lint-cli-doc` exit 0.
- Default prints exactly `v1:<abs-root>/.faff/runs`.
- Strict root resolution: `--root` must exist; no marker exits 2 with nothing on stdout.
- `--run-dir [--issue] [--events]` prints the exact correctiveIntegrityDirs join; `--issue`/`--events` without `--run-dir` exit 2.
- `--json` emits `{version, mode, dirs, declaration}`.
- Comma in any emitted path exits 2.
- `INTEGRITY_BOUNDARY_VERSION` exported constant, only place the token is written.
- Round-trip selftest passes (all four issue×events combos assert; arbitrary version tokens still assert).
- `--selftest` added as a validate.yml step; `test/integrity-boundary.test.mjs` covers the CLI seam.
- The `lights-out.js` no-declaration remedy names the emitter (fixture updated).
- Companion ADR (0074) amends ADR-0061; `adr validate` exit 0.
- `unattended.md` both postures + --init caveat; the three scaffolder lines point at the emitter; the token stays in each; scaffolder test passes.
- Reader trust math byte-identical (`corrective-integrity --selftest` unmodified).

confidence: high
spec-review: approve (architectural/infosec/QA clean)
