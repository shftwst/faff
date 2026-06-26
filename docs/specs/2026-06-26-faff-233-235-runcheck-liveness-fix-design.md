# FAFF-233 + FAFF-235 — runcheck liveness fix (coupled)

> Spec: interactive · 2026-06-26 · confidence: high. Covers **FAFF-233 (RC1)** and **FAFF-235 (RC3)** — both live in `runcheckHookDecision` / `runIsHeld`, so they ship in one PR (separate PRs would conflict on the same function). Follow-ups to FAFF-205.

## WHY
The `runcheck --hook` Stop gate hard-blocked an unrelated interactive session against a *live* parallel beep-boop run (2026-06-26 incident: a `/faff-graft` session blocked by a drain that was merely mid adversarial-review; the issue shipped fine minutes later). Two coupled defects:

- **RC1 (FAFF-233):** `runIsHeld` lets a dead *recorded* `owner.pid` override a *fresh* heartbeat. The stale-check returns before the pid corroborator, so `ownerPidIsLocalAndDead` only ever runs on a **fresh** heartbeat — and the beep-boop worker pid rolls, so a fresh, actively-heartbeating run is wrongly flipped to `not-held`.
- **RC3 (FAFF-235):** even when a foreign run is genuinely not-held, the gate **hard-blocks** whatever unrelated session ends a turn — un-exitable noise that pushes non-owners toward editing a ledger they don't own.

## WHAT / Decisions
- **Chosen (RC1):** a fresh heartbeat is authoritative — **drop the dead-pid override from `runIsHeld`** (heartbeat-only liveness: `status:running` + within-window heartbeat ⇒ held). The corroborator never *shortened* the window (stale already returns not-held before it ran); it could only harm. Resolves the ticket open question in favour of heartbeat-only.
- **Chosen (RC3):** in `runcheckHookDecision`, a run with undispatched work that is **not owned** and **not held** → `{block:false, warn:true}`. Only **owned** (env/session match) **or** explicit `--recover` → `{block:true}`. `cmdRuncheck --hook` prints the block decision only on `block`; on `warn` it writes one `[warn]` line to stderr (non-blocking, exit 0).
- **Chosen:** add `faff runcheck --recover` — the sanctioned human hard-assert on a chosen/foreign run, replacing "edit the ledger by hand".

## Behaviour (decision table — runcheckHookDecision)
```
owned?  held?  undispatched?  --recover?   →  outcome
 yes     —        yes           —             block   (owning session must finish its run)
  no    yes        —            —             silent  (foreign + live → leave it alone)
  no     no       yes           no            warn    (foreign + not-held → non-blocking notice)
  no     no       yes          yes            block   (deliberate human recovery)
  —       —        no           —             silent  (clean queue)
```

## Scope
`plugin/skills/faff/bin/faff` — `runIsHeld`, `runcheckHookDecision`, `cmdRuncheck` (`--hook` warn emission + `--recover`), and the `runcheck --selftest` table. `faff validate-adapters` + full suite stay green. Several existing selftest cases change `foreign+not-held+undispatched` from block→warn — the intended RC3 contract change.

## DONE
- [ ] Fresh heartbeat + dead/rolled recorded pid → `held` (silent). (RC1)
- [ ] Stale heartbeat still → not-held (abandoned still detectable). (RC1)
- [ ] Foreign + not-held + undispatched → **warn, not block**. (RC3)
- [ ] Owned + undispatched → **block** (backstop preserved). (RC3)
- [ ] `--recover` hard-asserts on undispatched regardless of ownership. (RC3)
- [ ] `runcheck --selftest` covers owning×held×recover; full `node --test` suite + validate-adapters green.
