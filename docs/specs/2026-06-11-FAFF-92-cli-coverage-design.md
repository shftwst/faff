# Spec — FAFF-92: Cover config / faff next / state / validate-adapters

> Spec by faffter-dark-nlspec · adaptor faffidavit-spec · 2026-06-11 · autonomous · confidence: high.

`node:test` coverage of the CLI's decision logic beyond the inline `--selftest`, written against FAFF-91's `runCli` helper. Per ADR 0002. The `node --test` CI step already landed with FAFF-88.

## 1. WHY
The CLI's load-bearing decision logic — `.faffrc` precedence/defaults, the `faff next` transition, `faff state`, `validate-adapters` — was only covered by inline `--selftest` paths. This adds external coverage exercising the real entrypoint + fixture provisioning.

## 2. OUT OF SCOPE
- The runner helper (FAFF-91). Contract golden tests (FAFF-96). Mock-tracker/skill-level tests (FAFF-89/93).

## 3. WHAT
- **config** — precedence via a fixture `.faffrc.yaml` (`config get` → value), default fallback (`-d` + exit 3 when absent). **Chosen:** provision via `runCli`'s `opts.cwd` temp dirs.
- **next** — representative transitions (backlog/none→prep, todo/high→graft, todo/none→prep, done→done); pure function.
- **state** — read-model shape for an unknown issue (status `unknown`, issue echoed).
- **validate-adapters** — PASS on the shipped slot set (exit 0).
- **Chosen:** exercise through the entrypoint (`runCli`), asserting tokens/exit, not reason prose.

## 4. HOW
`test/cli-coverage.test.mjs` provisions temp `.faffrc.yaml` dirs for config, invokes each subcommand via `runCli`, and asserts the structured seam. CI already runs `node --test` (FAFF-88).

## 7. DONE
- [x] `config` precedence (fixture → value) + default (`-d` → FALLBACK, exit 3) covered.
- [x] `next` representative transitions covered (token asserted).
- [x] `state` read-model shape for an unknown issue covered.
- [x] `validate-adapters` PASS on the shipped set (exit 0) covered.
- [x] `node --test` green; assertions on tokens/exit, not reason prose.
- [ ] **Deferred:** a deliberately non-conformant `validate-adapters` fixture (→ non-zero). The shipped-set PASS is covered; the synthetic-bad-skill fixture is a follow-up (it needs a crafted slot-named non-conformant SKILL.md) — noted honestly rather than faked.

confidence: high
