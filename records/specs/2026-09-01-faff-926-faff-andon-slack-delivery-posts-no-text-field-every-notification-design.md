# FAFF-926 — `faff andon` Slack delivery omits top-level `text`; every notification rejected `HTTP 400 no_text`

> Spec: faffter-dark-nlspec · 2026-08-28 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-926.
> build-tier: standard

**Slot:** spec (nlspec) · **Region:** factory · **Module:** `plugin/skills/faff/bin/lib/andon.js` · **Tests:** `test/andon.test.mjs`

A renderer defect: the andon POST body sent to the live Slack webhook has **no top-level `text`**, so Slack rejects every notification with `HTTP 400 no_text`. The channel is healthy; the payload shape is wrong. This spec makes every Slack-bound andon payload carry a guaranteed non-empty top-level `text`, and adds an operator-run end-to-end delivery probe (`faff andon send --check`) that posts a real message and reports the HTTP result. The run path stays fail-open.

---

## 1. WHY

- **Observed failure.** The live `.faffrc.yaml` (lines 132–140) sets `andon.url` to a Slack incoming webhook (`https://hooks.slack.com/services/…`) and sets **no `andon.format`**. Slack incoming webhooks require a top-level `text` (or `blocks`); a POST without one returns `HTTP 400 no_text`. Every andon notification from this box is silently lost (fail-open swallows the non-2xx into `andon-state.json` failures and exits 0), so nobody is being paged for parks, sentry trips, or budget breaches.

- **Verified root cause (differs from the ticket's own stated diagnosis).** The resolution path was run against the live config shape and read from code:
  - `resolveAndonConfig` (andon.js:96) resolves an unset/unknown `format` to **`"generic"`** — `format: ANDON_FORMATS.includes(format) ? format : "generic"`. With no `andon.format` key, `dig(...)` returns `undefined`, so format = `"generic"`.
  - `formatPayload("generic", notif)` (andon.js:217) returns `JSON.stringify(notif)` — the raw record `{run_id,class,title,body,ts,seq,issue?}` — with **no top-level `text`**.
  - Both delivery paths POST through `formatPayload(config.format, …)`: `runPump` (andon.js:355) and `send` (andon.js:426). **Both fail** on the live box.
  - The ticket asserts "`format: slack` resolves correctly." **This is factually wrong for the current box config: format resolves to `generic`, not `slack`.** A fix that only hardens the `slack` branch would leave the live box still returning `no_text`. The fix MUST stop the actual live configuration (Slack URL + `format` unset) from failing.

- **Secondary latent defect.** The `slack` branch (andon.js:212) emits `{ text: "${notif.title}\n${notif.body}" }`. When both `title` and `body` are empty this yields `"\n"` — whitespace-only, which Slack also rejects as `no_text`. There is no non-empty guard.

- **Diagnosis was by-hand.** Confirming the failure required a human to reconstruct the payload and curl the webhook. AC2 makes that a first-class command.

---

## 2. OUT OF SCOPE

- **FAFF-867 (Canceled)** — dead-webhook `404` is a *different* failure mode (channel gone, not payload malformed). The new `--check` probe partially discharges its "surface a persistently-failing channel" ask, but reviving/redesigning dead-channel handling is out of scope.
- **FAFF-386 (Done)** — the andon channel itself.
- **FAFF-472** — sentry→andon wiring (`sentry-poller.js`, `sentrycheck.js`). Unchanged; they call `andon pump` / `andon send` as-is.
- **The pump machinery** — cursor/dedupe/flood-cap/rollup/fail-open state in `runPump`. Do not redesign. This spec touches only payload *shape* and adds one diagnostic flag.
- **`ntfy` / `discord` / non-Slack `generic` presets** — untouched. `generic` stays "the record verbatim" for arbitrary sinks.
- **New config keys, new event classes, new dependencies.** None. `node:http`/`node:https` built-ins only.
- **Blocking the run on delivery failure.** The pump/send exit code stays 0 regardless of transport outcome (ADR 0101).

---

## 3. WHAT — vocabulary, types, decisions

### 3.1 Vocabulary

| Term | Meaning |
|---|---|
| **notification record** | The pure `{run_id, class, title, body, ts, seq, issue?}` object from `buildNotification` (pump path) or assembled inline (send path). |
| **preset** | A `formatPayload(format, notif)` output `{ body, headers }` — reshapes the record for one sink (`generic`/`ntfy`/`slack`/`discord`). |
| **Slack-bound** | A payload whose effective format is `slack` — either `format: slack` explicitly, or format unset **and** the webhook host is Slack-shaped (see D1). |
| **fallback text** | A guaranteed-non-empty string used as Slack's top-level `text` when title+body are empty (see D2). |
| **probe** | `faff andon send --check` — posts one real diagnostic message end-to-end and reports the HTTP status + body. Distinct from the offline `--selftest`. |
| **raw-status post** | A transport call that resolves `{ ok, statusCode, body }` for *every* HTTP response (including non-2xx), instead of rejecting non-2xx (see D4). |

### 3.2 Design decisions (each closes on a canonical marker)

**D1 — How the live box (Slack URL, `format` unset) stops returning `no_text`.**
Candidates: (A) infer `format→slack` from a Slack-shaped host when format is unset; (B) inject a top-level `text` into *every* payload including `generic`; (C) combination.
- (B) alone muddies `generic`'s contract ("the record verbatim" for arbitrary sinks — asserted by the existing selftest at andon.js:496) and hands Slack a `generic`-shaped blob rather than the purpose-built `slack` payload.
- (A) alone routes the live box into the `slack` preset — the correct Slack shape — but leaves the empty-title/body hole (D2).

**Chosen:** C — when `andon.format` is **unset** and the webhook host is Slack-shaped, `resolveAndonConfig` infers `format = "slack"`; independently, the `slack` preset is hardened to always emit non-empty `text` (D2). An **explicit** `format` (including explicit `generic`) is always obeyed — inference fires only on an unset key. This fixes the live box by routing it to the real Slack shape while preserving `generic`'s verbatim contract for every other sink. Rejected (B)-only and (A)-only for the reasons above.

**D2 — The non-empty `text` guarantee for the `slack` preset.**
The preset must never emit whitespace-only `text`.
**Chosen:** compute `text` as the non-empty lines of `[title, body]` joined by newline; if that is empty/whitespace-only, fall back to `faff <run_id>: <class>` (e.g. `faff <run-id>: sentry-trip`); if `run_id`/`class` are also absent, fall back to a fixed literal `"faff andon notification"`. The result is guaranteed non-empty and non-whitespace. Applies to every Slack-bound payload (pump, send, probe, rollup). — This directly satisfies AC1.

**D3 — Probe command surface.**
Candidates: a `--check` flag on `send`; a new `send --check` alias verb; a new `doctor` subcommand.
**Chosen:** a `--check` (arity 0) flag on the existing `send` subcommand. Rationale: it reuses `send`'s config resolution + POST path, adds no new subcommand vocabulary, and reads naturally (`faff andon send --check`). It is added to `ANDON_SPEC.flags` (so the parser accepts it and the FAFF-628 drift-guard sees it). No change to `ANDON_SURFACE.subcommands.send.required_flags`, and **no** new `--selftest`-style entry in `regions.js` (line 416 stays `["andon","--selftest"]` — the probe is online, not the offline selftest). Rejected the `doctor` subcommand: new second-token vocabulary for what is a mode of `send`.

**D4 — Surfacing the HTTP result cleanly.**
`realPost` today *rejects* non-2xx as `Error("HTTP <code>: <body>")` (andon.js:238) — the status code and body are stringified into a message, awkward to report. The probe needs the status + body as data.
**Chosen:** add a raw-status transport variant (e.g. `realPostRaw`, or a `{ acceptAnyStatus: true }` option to `realPost`) that resolves `{ ok: statusCode∈[200,300), statusCode, body }` for **every** response, and rejects only on transport-level errors (DNS/connect/timeout). The probe uses this variant. The existing `realPost` (used by `runPump`/normal `send`) is **unchanged** — its reject-on-non-2xx behaviour is what drives the fail-open failure-recording, and changing it is out of scope. — Keeps the pump path untouched.

**D5 — Probe exit code (and no-url case).**
AC3 says the run path (`pump`, ordinary `send`) MUST stay fail-open (`return 0`). The probe is a diagnostic, not the run path, so it MAY signal the operator via exit code.
**Chosen:** `faff andon send --check` exits **0** on a 2xx delivery, and **non-zero (1)** on a non-2xx HTTP response, a transport error, or `andon.url` unset (nothing to check is a failed check). Ordinary `send` and `pump` exit codes are **unchanged** (always 0). The `--json` variant still prints a structured result before exiting. — A probe that returned 0 on `no_text` would defeat its purpose.

---

## 4. HOW — behaviour

### 4.1 Config resolution — `resolveAndonConfig` (D1)

Only the `format` line changes; everything else (url/token/events) is untouched.

```
FUNCTION resolveAndonConfig(root):
    data      = loadConfig(root)
    url       = trimmed_nonempty(dig(data,"andon.url")) or null
    rawFormat = dig(data, "andon.format")            # may be absent/undefined
    token     = trimmed_nonempty(dig(data,"andon.token")) or null
    events    = <unchanged: filter configured events to ANDON_CLASSES, else defaults>

    IF rawFormat is one of ANDON_FORMATS:
        format = rawFormat                            # explicit — always obeyed
    ELSE IF rawFormat is absent/unset AND url is a Slack-shaped webhook:
        format = "slack"                              # inference (D1)
    ELSE:
        format = "generic"                            # unchanged default

    RETURN { url, format, token, events }
```

- **Slack-shaped host** = the URL parses and its host equals `hooks.slack.com` (case-insensitive) — or, more permissively, ends with `.slack.com`. **Chosen:** match host `== "hooks.slack.com"` OR host ends with `.slack.com`; a malformed/unparseable URL is not Slack-shaped (falls through to `generic`). Keep the check pure and dependency-free (`new URL(url)` in a try, as `realPost` already does at andon.js:228).
- **"unset" vs "unknown":** inference fires only when the key is genuinely absent (`undefined`). A present-but-garbage `format: "banana"` is treated as before → `generic` (an operator who typed a format string, however wrong, has not asked for host inference). **Assumes:** `dig` returns `undefined` (not `null`/`""`) for an absent key — confirmed by `resolveAndonConfig`'s existing `ANDON_FORMATS.includes(format)` guard already relying on this.

### 4.2 Slack preset — `formatPayload` `slack` branch (D2)

```
FUNCTION slackText(notif):
    parts = [notif.title, notif.body] filtered to trimmed-non-empty strings
    joined = parts joined by "\n"
    IF joined is non-empty (after trim): RETURN joined
    IF notif.run_id and notif.class: RETURN "faff " + notif.run_id + ": " + notif.class
    RETURN "faff andon notification"

# in formatPayload, format == "slack":
RETURN { body: JSON.stringify({ text: slackText(notif) }),
         headers: { "content-type": "application/json" } }
```

- `slackText` is pure and total (never throws, never empty). Used by the pump path, the `send` path, the rollup payload, and the probe.
- The rollup notification (andon.js:370) always has non-empty `title`/`body`, so it is unaffected in practice — but routing it through the same guarded branch is correct by construction.
- `generic`, `ntfy`, `discord` branches: **unchanged.**

### 4.3 The probe — `faff andon send --check` (D3, D4, D5)

Dispatch order matters: `--check` must be handled **before** `requireFlags`, because a probe does not require `--class/--title/--body`.

```
IF sub == "send":
    asJson = has "--json"
    IF has "--check":
        config = resolveAndonConfig(root)
        IF config.url is null:
            report "andon: not configured (no andon.url) — nothing to check"
            RETURN 1                                   # D5
        notif = synthesizeProbeNotification(root, flags)   # see below
        { body, headers } = formatPayload(config.format, notif)
        authHeaders = config.token ? { authorization: "Bearer "+token } : {}
        TRY:
            res = realPostRaw(config.url, body, {…headers, …authHeaders}, ANDON_TIMEOUT_MS)
            IF asJson: print JSON { check:true, ok:res.ok, statusCode:res.statusCode, body:truncate(res.body) }
            ELSE:      print "andon check: HTTP "+res.statusCode+(res.ok?" ok":" FAILED")+" — "+truncate(res.body)
            RETURN res.ok ? 0 : 1                       # D5
        CATCH e (transport error — DNS/connect/timeout):
            IF asJson: print JSON { check:true, ok:false, error:String(e.message) }
            ELSE:      print "andon check: transport error — "+e.message
            RETURN 1                                     # D5
    # ...existing (non-check) send path unchanged, still ends `return 0` (fail-open)
```

- **`realPostRaw`** (D4): identical to `realPost` except the `res.on("end")` handler resolves `{ ok: (statusCode>=200 && <300), statusCode, body: data }` for *all* status codes, and rejects only on `req.on("error")` / timeout. `realPost` stays as-is (no probe uses its reject-on-non-2xx behaviour; the pump/send fail-open path still does). Export `realPostRaw` for tests.
- **`synthesizeProbeNotification`:** if the operator supplied `--class/--title/--body`, honour them; otherwise synthesize a clearly-labelled diagnostic record with a fixed title (`"faff andon --check"`) and body (`"end-to-end delivery probe — <ISO ts>"`), `ts: now`, `seq: null`. The `class` field is only used for `ntfy` priority and the Slack fallback text.
- **Payload minimisation (ADR 0102 / minimisation principle):** the probe body carries only a fixed title + timestamp — no spec/diff/transcript content.
- **`truncate`**: cap reported body at ~200 chars (mirrors `realPost`'s existing `data.slice(0,200)` at andon.js:238) so a large error page doesn't flood the terminal.

### 4.4 Surface declaration (FAFF-628 drift-guard)

- Add `"--check": { arity: 0 }` to `ANDON_SPEC.flags`.
- Update `ANDON_USAGE` to include `send --check`.
- `ANDON_SURFACE.subcommands.send.required_flags` — **unchanged** (`["--class","--title","--body"]` still required for a *non*-check send; the drift-guard only asserts each required name is a member of the accepted-flag set, which holds).
- `cli-surface.js` consumes `ANDON_SURFACE` directly (line 22/43) and computes the surface at selftest time; there is **no committed golden snapshot** to update (verified). `cliSurfaceSelftest` stays green (bijection + pinned classifications + required-flags-membership all still hold).
- `regions.js` line 416 (`"andon": ["andon","--selftest"]`) — **unchanged** (no new offline selftest entry).

### 4.5 Failure modes

| Condition | Behaviour |
|---|---|
| Slack URL, `format` unset (the live box) | format inferred → `slack` → payload carries non-empty `text` → Slack 200. |
| Explicit `format: generic` + Slack URL | obeyed → `generic` (operator's explicit choice; not our bug to override). |
| Slack-bound, empty title AND body | `slackText` falls back to `faff <run_id>: <class>` then to literal — never `no_text`. |
| `--check`, url unset | print "not configured", exit 1. |
| `--check`, HTTP non-2xx (e.g. still `no_text`) | print `HTTP <code> FAILED — <body>`, exit 1. |
| `--check`, transport error/timeout | print transport error, exit 1. |
| `--check`, HTTP 2xx | print `HTTP 200 ok`, exit 0. |
| ordinary `pump`/`send`, any transport outcome | exit **0** (fail-open, unchanged). |
| malformed `andon.url` | not Slack-shaped → `generic` (unchanged); probe surfaces the transport error and exits 1. |

---

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

**S1 — Live-box shape (the bug).** *Given* `andon.url` is a `hooks.slack.com` webhook and `andon.format` is unset, *When* `andon pump` or `andon send` posts any configured class, *Then* the POST body is `{"text": "<non-empty>"}` with `content-type: application/json`, and (against a loopback server asserting a non-empty top-level `text`) the server sees non-empty `text` and can return 200 — never `no_text`.

**S2 — Explicit generic is obeyed.** *Given* `andon.format: generic` explicitly set with a Slack URL, *When* a notification posts, *Then* the body is the verbatim JSON record (no inference), preserving the `generic` contract.

**S3 — Empty title+body fallback.** *Given* a Slack-bound notification whose `title` and `body` are both empty, *When* `formatPayload("slack", notif)` runs, *Then* the emitted `text` is non-empty and non-whitespace (the `faff <run_id>: <class>` fallback).

**S4 — Probe on a healthy channel.** *Given* a configured webhook and a loopback server returning 200, *When* `faff andon send --check` runs, *Then* it posts one real message, prints the HTTP status, and exits 0.

**S5 — Probe on a `no_text`-rejecting channel.** *Given* a loopback server returning `400 no_text`, *When* `faff andon send --check` runs, *Then* it prints `HTTP 400 … no_text` and exits **1** (diagnostic surfaces the failure).

**S6 — Probe with url unset.** *Given* no `andon.url`, *When* `faff andon send --check` runs, *Then* it prints "not configured" and exits **1**; no network call is made.

**S7 — Fail-open unchanged.** *Given* a refusing endpoint, *When* `andon pump` (or ordinary `andon send`) runs, *Then* the failure is recorded and the command exits **0** (ADR 0101), and the pump cursor-hold/dedupe/flood-cap behaviour is unchanged.

**Non-functional assertions:**
- N1 — Zero new dependencies; `node:http`/`node:https` built-ins only.
- N2 — `--check` payload carries only a fixed title + timestamp; no spec/diff/transcript content (minimisation).
- N3 — `cli-surface --selftest` and `andon --selftest` both stay green after the surface addition.
- N4 — `realPost` (the pump/send transport) is behaviourally unchanged; only `realPostRaw` is added.

---

## 6. DESIGN DECISION RATIONALE

- **D1 (Chosen C — infer-on-unset + harden slack).** The live box's real defect is *routing* (`generic` for a Slack sink) compounded by a *shape* gap. Inference on an unset key fixes routing for the exact reported configuration without overriding any explicit operator choice; hardening fixes the shape for all Slack-bound payloads. Rejected (B)-only because injecting `text` into `generic` breaks the "verbatim record" contract other sinks rely on (and the existing selftest at andon.js:496); rejected (A)-only because it leaves the empty title+body `no_text` hole (andon.js:212).
- **D2 (Chosen — total non-empty fallback).** Slack's `no_text` triggers on missing *or* whitespace-only `text`. A total, pure `slackText` is the smallest change that makes `no_text` structurally impossible for Slack-bound payloads.
- **D3 (Chosen — `--check` flag on `send`).** Reuses `send`'s config + transport, adds no subcommand vocabulary, needs no `required_flags` change, and keeps the offline `--selftest` convention distinct from the online probe.
- **D4 (Chosen — `realPostRaw`).** The probe needs the status code + body as *data*; `realPost` deliberately rejects non-2xx to feed fail-open failure recording. Splitting the raw-status read into a new function leaves the pump/send path untouched (N4).
- **D5 (Chosen — probe exits non-zero on failure).** A diagnostic that returned 0 on `no_text` would hide the very failure it exists to catch. The run path's fail-open (`return 0`) is preserved separately (ADR 0101 / S7).

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

- **Assumes:** `dig(data,"andon.format")` returns `undefined` for an absent key (relied on by the unset-vs-explicit distinction) — consistent with the existing `ANDON_FORMATS.includes(format)` guard.
- **Assumes:** Slack incoming webhooks accept `{"text": "<non-empty>"}` with `content-type: application/json` and return `200 ok` — the standard Slack incoming-webhook contract; the fix targets exactly this.
- **Assumes:** matching host `hooks.slack.com`/`*.slack.com` is sufficient for Slack detection; no other Slack webhook host is in use in this deployment.
- **Punt:** the exact synthetic `class`/title used by `--check`'s default probe notification (`run-end` vs a fixed literal) — either satisfies AC2; pick whichever keeps `buildNotification`/`formatPayload` total. Needs no human, an implementation-time choice.

---

## 8. DONE — testable checklist (mirrors the body 1:1)

1. **[D1]** `resolveAndonConfig`: `andon.format` **unset** + `andon.url` host `hooks.slack.com` (or `*.slack.com`) ⇒ `format === "slack"`. *(new selftest + test)*
2. **[D1]** Explicit `andon.format` (incl. `generic`) is obeyed regardless of URL host. *(test — S2)*
3. **[D1]** Unset format + non-Slack URL ⇒ `format === "generic"` (unchanged). *(existing selftest stays green — N3)*
4. **[D2]** `formatPayload("slack", …)` always emits non-empty, non-whitespace `text`; empty title+body ⇒ `faff <run_id>: <class>` fallback. *(selftest — S3)*
5. **[D2/S1]** Against a loopback server, pump/send on the live-box shape produce a POST whose parsed body has a non-empty top-level `text`; server returns 200, never `no_text`. *(test)*
6. **[D3]** `--check` added to `ANDON_SPEC.flags` (arity 0); `ANDON_USAGE` updated; `ANDON_SURFACE.subcommands.send.required_flags` unchanged; `cli-surface --selftest` green. *(N3)*
7. **[D3]** `regions.js` andon selftest entry unchanged (no new offline selftest). *(inspection)*
8. **[D4]** `realPostRaw` resolves `{ok,statusCode,body}` for 2xx **and** non-2xx; rejects only on transport error; `realPost` behaviour unchanged. *(test — N4)*
9. **[D3/D5/S4]** `faff andon send --check` against a 200 loopback: posts one real message, reports HTTP 200, exits 0.
10. **[D5/S5]** `--check` against a `400 no_text` loopback: reports the failure, exits 1.
11. **[D5/S6]** `--check` with `andon.url` unset: prints "not configured", exits 1, no network call.
12. **[AC3/S7]** Ordinary `pump` and `send` still exit 0 on a refusing endpoint; cursor-hold/dedupe/flood-cap unchanged. *(existing tests stay green)*
13. **[N1]** No new dependencies (`node:http`/`https` only).
14. **[N2]** `--check` payload carries only a fixed title + timestamp (no spec/diff/transcript content).

---

## Already shipped against this surface

- **FAFF-386** (Done) — the andon channel itself. Delivers the pump/send/format machinery this spec repairs; does not deliver the `no_text` fix.
- **FAFF-472** — sentry→andon wiring. Consumes `andon send`/`pump`; unaffected.
- **FAFF-867** (Canceled) — dead-webhook `404`, a different failure mode. Not superseding. The `--check` probe partially discharges its canceled "surface a persistently-failing channel" ask.

Premise still holds — no Done ticket delivers the payload `text` fix or a delivery probe. Proceed.

confidence: high
