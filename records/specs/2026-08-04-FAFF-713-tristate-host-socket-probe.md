# Spec — FAFF-713: tri-state host-socket probe (probe error → refuse)

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-713.

## 1. WHY — problem and principle

`faff container-check --gate` (FAFF-655) is the strict admission floor: admit iff *contained* AND *no host engine socket reachable*. Its host-socket half reads presence through `realFsq.exists`, which collapses **any** stat/access error to `false`. So a host socket that is *present but unreadable* — e.g. behind a permission-denied path component — reads as **absent**, which the gate maps toward **admit**. For a strict floor that is the wrong direction: refuse-on-doubt is the safe default, and a probe that cannot *determine* the socket's state must not be read as "no socket, admit." Narrow in practice (`fs.existsSync` rarely surfaces the error, and a socket the job can't stat is plausibly one it can't reach) — filed as a deliberate hardening.

## 2. WHAT — design (the load-bearing decisions)

**Chosen: introduce the tri-state at the `fsq` boundary — a new `probePath` adapter that never collapses an error into "absent".** `realFsq.exists` cannot express the distinction (`fs.existsSync` returns a bool and swallows `EACCES`). Add `realFsq.probePath(p)` returning `"present" | "absent" | "error"`, errno-classified and never-throwing:

```js
probePath: (p) => {
  try { fs.statSync(p); return "present"; }
  catch (e) { return (e && e.code === "ENOENT") ? "absent" : "error"; }
}
```

`statSync` follows symlinks (correct — `/var/run/docker.sock` is typically a symlink to the real socket; we care about the reachable socket, and a broken symlink correctly yields `ENOENT` → absent → admit). A clean `ENOENT` (parent searchable, path genuinely gone) is confirmed **absent**; anything else — `EACCES` on a non-searchable parent, `ENOTDIR`, `ELOOP` — is **error** (could-not-determine). Note these non-`ENOENT` codes can occasionally mean "genuinely absent but un-stattable"; bucketing them to `error` → refuse is the **intended conservative fail-safe** for a strict floor, not a misclassification — a future reader should not "fix" them to `absent`. `realFsq.exists` stays exactly as-is; nothing else migrates.

**Chosen: `hostSocketProbe` returns `{ present, path, state }`, with `present` unchanged for existing consumers.** It switches from `fsq.exists` to `fsq.probePath` and returns the tri-state `state`, but keeps `present` a boolean that is **true only on a confirmed-present canonical socket** — so both `absent` and `error` keep `present: false`, exactly as today (where an error already collapsed to false). Every existing `.present` reader (the bare command's warning, `lights-out.js`) is therefore behaviourally unchanged unless it opts into `state`. Loop semantics: a `present` on any canonical path wins immediately (`{present:true, path, state:"present"}`); otherwise, if any path was `error` the result is `{present:false, path:<first error path>, state:"error"}`, else `{present:false, path:null, state:"absent"}`. `probePath` never throws (mirrors the existing never-throws discipline; a selftest asserts it).

**Chosen: `--gate` admits only on a confirmed-absent socket, and its refuse-reason names the indeterminate case honestly.** The gate's `noHostSocket` becomes `hostSocket.state === "absent"` — so a `present` **or** an `error` state refuses. That is the whole fix: can't-determine → refuse, fail-safe. The composite `--gate --json` gains the `state` field (`host_socket: { present, path, state }`) and `criteria.no_host_socket` reflects the confirmed-absent test. The gate's human refuse-reason must **branch on state** rather than always saying "present": `state:"present"` → "host docker socket present at `<path>`", `state:"error"` → "host docker socket present-or-unreadable at `<path>`" (it is indeterminate, not confirmed present). The bare `container-check` command is untouched in exit code — it still exits on containment alone; its socket **warning** likewise fires only on `state:"present"` (an `error` is not a confirmed-present socket, so bare output is unchanged — same as today).

**Chosen: `lights-out.js` refuses on `error` too, respecting the `engine_bounded` downgrade (settles the shared-seam open question).** The L4 preflight is *stricter* than `--gate`, so it must not be *laxer* on this axis. Treat `state: "error"` the same as a present socket for the existing refuse/degrade branches — a single `socketConcern = present || (state === "error")`:

- `socketConcern && engineBounded !== true` → **refuse** (present-or-indeterminate host socket, not attested bounded) — the existing refusal, now also covering can't-determine.
- `socketConcern && engineBounded === true` → **degrade** to warn (the operator's `autonomous.engine_bounded:true` attestation is their explicit override; it still applies — an operator who attests a bounded engine at the canonical path has taken responsibility whether or not the probe could stat it).

So both strict paths (`--gate` and lights-out) refuse-on-doubt, consistently; the operator's attestation escape is unchanged. The refuse-detail message names the indeterminate case ("host docker socket present-or-unreadable at …").

**Chosen: the threat model is unchanged — rootless paths stay excluded.** `HOST_SOCKET_PATHS` is untouched (`/var/run/docker.sock`, `/run/docker.sock` only; rootless paths still excluded per FAFF-333). The tri-state is purely about the *determinability* of those canonical paths, never about widening what counts as a host socket.

**Chosen: the selftest drives the `error` state and asserts the new refusals — including the lights-out branch, which the existing harness already supports.** `mkFsq` **must** gain a `probePath` (not optional): once `hostSocketProbe` calls `fsq.probePath` instead of `fsq.exists`, every existing fixture that reaches `hostSocketProbe` would throw `probePath is not a function` without it. Thread a third `errorSet` argument through `mkFsq(present, environ, errorSet)` and the `capture(args, env, present, errorSet)` helper, **defaulted empty** so the existing 2-/3-arg call sites (CASES / HS_CASES / GATE_CASES) stay green; `probePath(p)` returns `error` if `p ∈ errorSet`, else `present` if `p ∈ present-set`, else `absent`. Cases, at minimum:

- `hostSocketProbe` fixture table gains an **error** row (a path in the error-set → `{present:false, path:<that>, state:"error"}`) alongside the existing bare/present rows.
- command-level: **contained + socket-error + `--gate` → exit 1** (verdict fail, `criteria.no_host_socket:false`) — the load-bearing new refuse.
- command-level: contained + socket-error, **bare** command → exit 0 (unchanged legacy contract — an error is not a present socket for the default reading).
- `probePath(realFsq())` never-throws assertion (mirrors the existing `exists`/`hostSocketProbe` never-throws checks).
- **lights-out (its existing selftest surface supports this — no hedge):** `lights-out.js`'s preflight selftest already drives `lightsOutPreflight(armedProbes({ hostSocketPresent: true, … }))` for the refuse and attested-degrade cases. Add two parallel rows over `hostSocketState: "error"` — `armedProbes({ hostSocketState: "error" })` → **host-socket refuse**, and `armedProbes({ hostSocketState: "error", engineBounded: true })` → **host-socket degrade** — so the new branch ships tested.

**Assumes:** FAFF-655's `--gate` + the `(env, fsq)` injection seam are on `main` (they are); `lights-out.js`'s host-socket refuse + `engine_bounded` downgrade are the current shape.

## 3. HOW — acceptance

- `realFsq.probePath(p)` added: `"present" | "absent" | "error"`, errno-classified (`ENOENT` → absent, else-error), never throws. `realFsq.exists` unchanged.
- `hostSocketProbe` returns `{ present, path, state }`; `present` true only on confirmed-present (both `absent` and `error` keep `present:false`) — existing `.present` consumers behaviourally unchanged.
- `--gate` admits only when `state === "absent"`; a `present` or `error` state refuses. `--gate --json` includes `host_socket.state`. The gate refuse-reason branches on state ("present at …" vs "present-or-unreadable at …"). Bare `container-check` exit-code + warning behaviour unchanged (warning fires only on `state:"present"`).
- `lights-out.js` refuses on `state:"error"` (fail-safe), with `engine_bounded:true` still downgrading to warn; refuse-detail names the indeterminate case.
- `HOST_SOCKET_PATHS` unchanged; rootless paths still excluded.
- selftest drives the `error` state and asserts: `hostSocketProbe` error row; contained+error+`--gate` → exit 1; bare contained+error → exit 0; `probePath` never-throws; and the two lights-out `armedProbes({hostSocketState:"error"})` rows (refuse; degrade with `engineBounded:true`).
- `node --test` green; `faff container-check --selftest` green.

### Scenarios

```
Given a host socket present at /var/run/docker.sock but behind a permission-denied parent (probePath → error)
When faff container-check --gate runs in a contained cage
Then it exits 1 (fail) — can't-determine is refused, not admitted.
```

```
Given a genuinely absent socket (probePath → absent) in a contained cage with no host socket
When faff container-check --gate runs
Then it exits 0 (pass) — confirmed-absent admits, unchanged.
```

```
Given a lights-out L4 preflight and a socket probe that returns error
When engine_bounded is unset → the preflight refuses (host-socket, indeterminate);
When engine_bounded:true → it degrades to warn (operator attestation still applies).
```

## 4. DONE — definition of done

- [ ] `realFsq.probePath` added (tri-state, errno-classified, never-throws); `realFsq.exists` unchanged.
- [ ] `hostSocketProbe` returns `{ present, path, state }`; `present` semantics unchanged for existing consumers.
- [ ] `--gate` admits only on `state === "absent"`; present/error refuse; `--gate --json` carries `host_socket.state`; refuse-reason branches on state ("present" vs "present-or-unreadable"); bare command unchanged (warns only on confirmed-present).
- [ ] `lights-out.js` refuses on `state:"error"`; `engine_bounded:true` still downgrades; refuse-detail names the indeterminate case.
- [ ] `HOST_SOCKET_PATHS` unchanged (rootless still excluded).
- [ ] selftest: `hostSocketProbe` error row; contained+error+`--gate` → exit 1; bare contained+error → exit 0; `probePath` never-throws; two lights-out `hostSocketState:"error"` rows (refuse; degrade with `engineBounded:true`). `mkFsq`/`capture` gain a defaulted-empty `errorSet` arg.
- [ ] `node --test` green; `faff container-check --selftest` green.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
