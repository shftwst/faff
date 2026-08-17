# FAFF-840 — `faff env compose-gen --profile` accepts the contract-fenced form `faff profile mine` emits

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-840.

## Why

`faff profile mine` prints the mined infra profile wrapped in a `faff-contract:infra-profile` fence by default (`bin/lib/profile.js`, `cmdProfile` → `mine`, which emits the fenced block unless `--json` is passed). `faff env compose-gen --profile <file>` reads that file and does a bare `JSON.parse` (`bin/lib/env.js`, `resolveProfile`), so a fenced file fails with `malformed profile JSON in <file>` and exits 2.

The cage-engine acceptance runbook (`docs/reference/cage-engine-acceptance.md`, lines 32–33) documents the pipe as `faff profile mine > profile.json` then `faff env compose-gen --profile profile.json …`. That pipe fails as written — the default `profile mine` output is fenced, so `compose-gen` rejects it. During the 2026-08-16 FAFF-381 in-cage run the fence lines had to be stripped by hand before `compose-gen` accepted the file (audit finding 4, `verification/audits/2026-08-16-FAFF-381-cage-engine-acceptance-run.md`). The two faff commands the docs present as composable do not compose.

Reproduced on the current binary: `faff profile mine > p.json && faff env compose-gen --profile p.json` exits 2; `faff profile mine --json > p.json && faff env compose-gen --profile p.json` exits 0. The same latent inconsistency exists on `faff profile validate` (the gateway's orchestrator validate-then-write step for the miner's output): `faff profile validate --file <fenced>` also exits 2 today, while the raw form validates.

## What

Make the profile-file read path **fence-tolerant**: transparently accept both the contract-fenced form (`faff profile mine`) and the raw-JSON form (`faff profile mine --json`) everywhere faff reads a stored/handed infra profile, so the documented pipe works unchanged and neither output mode of the miner is a trap.

**Chosen:** Strip an optional single leading `faff-contract:infra-profile` fence before parsing, rather than adding a new output mode or only fixing the docs. This is the ticket's preferred option and the only one that makes the already-documented `profile mine | compose-gen` pipe work as written; a raw-JSON mode already exists (`--json`) so adding one is moot, and a docs-only fix leaves the two commands non-composable. The miner's fence is the human/consumer-fold display form and the raw JSON is the pipe form — tolerating both at the consumer removes the footgun without changing what `mine` emits.

**Chosen:** Introduce one small shared helper in `bin/lib/profile.js` — `parseProfileInput(raw)` — that returns the parsed object from either form: if `raw` (trimmed) opens with the exact `faff-contract:infra-profile` fence marker, take the fenced body up to the closing fence and `JSON.parse` that; otherwise `JSON.parse(raw)` directly. Export it and reuse it at every profile-read site rather than duplicating a strip regex. The codebase already keeps contract-block handling at the consumer (`reconcile.js`, `gates.js` locate-and-parse their own block); a single exported helper keeps the fence knowledge in one place and avoids `env.js` re-implementing the miner's fence shape.

**Chosen:** Reuse the helper at all three consumer sites that parse a profile file:
- `env.js` `resolveProfile` — the `--profile <file>` read (covers `compose-gen`, `up`, `seed`, all of which route through `resolveProfile`).
- `env.js` `resolveProfile` — the default `.faff/infra-profile.json` read (so a profile written in fenced form by `faff profile mine > .faff/infra-profile.json` is also accepted).
- `profile.js` `cmdProfile` → `validate` — so the miner's default fenced output validates, closing the identical inconsistency on the gateway-documented miner → `profile validate` → write pipe.

Including `validate` is the same one-line helper reuse and the same root defect (the miner's default output is not consumable by its own documented validator); the gateway frames `faff profile validate` as the orchestrator step that validates the miner's block before writing `.faff/infra-profile.json`. Leaving it raw-only would fix half of one documented pipe.

**Chosen:** Keep failure behaviour and messages unchanged for genuinely malformed input. A file that is neither valid raw JSON nor a well-formed `faff-contract:infra-profile` fence still exits 2 with the existing site-specific messages (`malformed profile JSON in <file>`, `malformed .faff/infra-profile.json`, `malformed profile input (invalid JSON)`). Fence tolerance is strictly additive: it only changes the outcome for input beginning with the exact infra-profile fence marker; every input that parses today parses identically. No regression to the error surface, and no risk of mis-stripping an arbitrary JSON document that merely contains backticks.

**Assumes:** the miner's emitted fence shape is stable — opening line exactly the `faff-contract:infra-profile` fence, the pretty-printed JSON body, then a closing fence line (`profile.js` `mine`). The helper keys off that exact opening marker; if the miner's fence label ever changes, the helper's marker constant changes with it (single source in `profile.js`).

### Out of scope

- Changing what `faff profile mine` emits (both `--json` and fenced default stay exactly as they are).
- A general "strip any fenced code block" parser — only the `faff-contract:infra-profile` marker is recognised.
- Other `faff-contract:*` consumers (`quality-gates`, `review-verdict`, …) — they have their own locate-and-parse paths and are not touched here.

## How

1. Add `parseProfileInput(raw)` to `bin/lib/profile.js` and export it. Behaviour: trim-start; if it opens with the `faff-contract:infra-profile` fence, slice the body between that opening fence line and the next closing fence line and `JSON.parse` the body; else `JSON.parse(raw)`. It throws on unparseable input exactly as `JSON.parse` does today, so callers keep their existing try/catch and error messages.
2. In `env.js` `resolveProfile`, replace the two `JSON.parse(...)` calls (the `--profile` file read and the `.faff/infra-profile.json` default read) with `parseProfileInput(...)`, importing it from `./profile`. Keep the surrounding try/catch and the two distinct stderr messages / exit-2 returns unchanged.
3. In `profile.js` `cmdProfile` → `validate`, replace `JSON.parse(raw)` with `parseProfileInput(raw)`; keep the `malformed profile input (invalid JSON)` message and exit 2.
4. Add self-test coverage: extend `env --selftest` with a case feeding the fenced form through the compose-gen profile read and asserting it parses to the same object as the raw form; extend `profile --selftest` with a `parseProfileInput` case covering fenced input, raw input, and a malformed-input throw.
5. Update `docs/reference/cage-engine-acceptance.md` so the narrative reflects that `faff profile mine > profile.json` now feeds `compose-gen` directly (drop any implication that a manual fence strip is needed). No command change is required there — the pipe now works as already written.

## Done

- `faff profile mine --root <repo> > p.json && faff env compose-gen --profile p.json` exits 0 and emits a compose file + ProvisionPlan (previously exit 2 with `malformed profile JSON in p.json`).
- `faff profile mine --json --root <repo> > p.json && faff env compose-gen --profile p.json` still exits 0 — the raw form is unaffected (no regression).
- `faff profile mine --root <repo> > .faff/infra-profile.json && faff env compose-gen` (no `--profile`, default-path read) exits 0.
- `faff profile validate` accepts the fenced form: `faff profile mine --root <repo> > p.json && faff profile validate --file p.json` exits 0 (previously exit 2).
- A file that is neither valid raw JSON nor a valid `faff-contract:infra-profile` fence still exits 2 with the existing malformed message at each of the three sites.
- `faff env --selftest` and `faff profile --selftest` pass, including the new fenced-input cases.
- The `docs/reference/cage-engine-acceptance.md` pipe runs as written end-to-end with no manual fence strip.

## Reference context

- `bin/lib/profile.js` — `cmdProfile` (`mine` emits the fence, `validate` parses), `mineRepo`, `profileSelftest`, `module.exports`.
- `bin/lib/env.js` — `resolveProfile` (the `--profile` read + `.faff/infra-profile.json` default read, both bare `JSON.parse`), the `compose-gen` handler, `envSelftest`.
- `docs/reference/cage-engine-acceptance.md` — lines 32–33 (the documented `profile mine` → `compose-gen` pipe).
- `verification/audits/2026-08-16-FAFF-381-cage-engine-acceptance-run.md` — finding 4 (origin of this ticket).
- Prior art for consumer-side contract-block handling: `bin/lib/reconcile.js`, `bin/lib/gates.js`.

## Already shipped against this surface

Scanned Done tickets in project "Outward L4 evidence is reproducible and honestly bounded". FAFF-836 (env `base.host` wiring) and FAFF-791 (location-independent endpoint) touched `env.js` but neither the profile-file parse path nor the miner's fence handling; FAFF-381 is the acceptance run that surfaced this finding, not a fix for it. No Done ticket delivers or supersedes this fix — premise holds, proceed.

## Methodology critique

Agile-delivery lens (issue-critique):
- **Right-sized?** Yes — a single, self-contained defect fix in two CLI modules plus self-tests and a one-line doc touch; well under a 1–3 day unit. No split warranted.
- **Workstream fit?** Yes — sits squarely in the "Outward L4 evidence is reproducible" project: it makes the documented cage-acceptance pipe reproducible without a manual hand-edit.
- **Deps surfaced?** No hidden dependency. Relates to FAFF-381 (surfacer) and FAFF-371/FAFF-791 (env slot), none blocking.
- **Risk profile?** Low — additive, fence-only parsing change behind existing try/catch, guarded by deterministic self-tests; no external dependency, no schema or API change.

## Spec-review

Single-pass, four lenses (architectural / infosec / methodology / QA), level L3 / appetite high. Verdict: **approve** — no objections. Architectural: the helper's home in `profile.js` (where the fence is emitted) is the natural single source and introduces no circular import (`profile.js` does not depend on `env.js`). Infosec: local file parse only, no new attack surface, no `eval`. Methodology: right-sized, in-project, the `validate` extension is cohesive same-helper work that always ships together. QA: DoD is born-verifiable (exit codes + self-tests) and covers the regression (raw form) and negative (malformed → exit 2) cases.

confidence: high
build-tier: mechanical
spec-review: approve
