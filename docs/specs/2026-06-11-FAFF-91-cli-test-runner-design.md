# Spec — FAFF-91: CLI test runner — exercise faff subcommands, assert output/exit

> Spec by faffter-dark-nlspec · adaptor faffidavit-spec · 2026-06-11 · autonomous · confidence: high.

A reusable `node:test` helper (`test/helpers/run-cli.mjs`) that invokes a `faff` subcommand as a child process and returns `{ stdout, stderr, code }` — the deterministic seam FAFF-92's CLI unit tests build on. Per ADR 0002. Zero-dependency.

## 1. WHY
The CLI carries inline `--selftest` fixtures but no reusable harness to invoke a subcommand with arbitrary args and assert its observable output/exit from outside. FAFF-92 needs that base.

## 2. OUT OF SCOPE
- The actual CLI coverage tests (config/next/state/validate-adapters) — FAFF-92.
- Mock-tracker substrate — FAFF-89.
- Wiring `node --test` into CI — already done by FAFF-88.

## 3. WHAT
- `runCli(args, opts?) -> { stdout, stderr, code }` exported from `test/helpers/run-cli.mjs`. **Chosen:** child process (`spawnSync('node', [binPath, ...args])`) — exercises the real entrypoint + exit codes, isolates process state. **Chosen:** returns raw `{stdout,stderr,code}` (assertion lives in the test). **Chosen:** `opts.cwd` provisions a fixture dir for config/git-dependent subcommands; defaults to repo root.

## 4. HOW
`spawnSync('node', [faffBin, ...args], { cwd, input, encoding:'utf8' })` → `{ stdout, stderr, code: status }`. Self-test asserts a deterministic round-trip (success: `next --status todo --spec high` → exit 0 + `graft` token) + a failure case (unknown subcommand → non-zero), on the token not the reason.

## 7. DONE
- [x] `test/helpers/run-cli.mjs` exports `runCli(args, opts)` returning `{stdout,stderr,code}`, invoking the CLI as a child process honouring `opts.cwd`/`opts.input`.
- [x] A `node:test` self-test asserts a success round-trip (exit 0 + verdict token) and a failure case (non-zero exit), on the structured token not the reason.
- [x] `node --test` runs green on Node ≥ 18.

confidence: high
