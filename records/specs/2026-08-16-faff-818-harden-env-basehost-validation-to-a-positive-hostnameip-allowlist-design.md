# Spec — FAFF-818: Harden `env` `base.host` validation to a positive hostname/IP allowlist

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-818.

This is a buildable nlspec for Linear issue **FAFF-818**. It hardens one module-internal validator (`envValidateBaseHost`) in the `env` compose-gen library from a denylist to a positive charset allowlist. The change is small, deterministic, single-function, and born-verifiable through the existing `faff env --selftest` oracle.

## 1. WHY — Problem and Principles

**Load-bearing model.** `base.host` is an operator/transport-supplied string that `composeGen` interpolates *unescaped* into evaluator-reachable endpoint URLs (`${scheme}://${base.host}:${port}${path}` in `envResolveEndpoint`). It is a trust boundary; the only correct way to guard a trust boundary that feeds URL string-interpolation is a **positive allowlist** of the characters an authority component may contain — not a denylist that must anticipate every hostile character.

**Problem statement.** FAFF-791 shipped `envValidateBaseHost` as a *denylist* — it rejects the URL-structural injection vectors it thought of (scheme `://`, userinfo `@`, path `/`, query `?`, fragment `#`, embedded port `:`), but FAFF-791's own adversarial review (nvidia/glm-5.2) noted the denylist still **permits** spaces, control characters, `%`, `_`, and other non-authority bytes that form a malformed or smuggling-prone URL. This change tightens the bare-host branch to a positive charset allowlist (`[A-Za-z0-9.-]`), so anything not in the authority charset is rejected by construction rather than by enumeration.

**Design principles.**

- **Positive over negative.** The bare-host branch must accept only known-good characters and reject everything else. A new hostile character must fail *because it was never allowed*, not because someone added a new denylist rule. An implementation that patches the denylist with more `includes()` checks instead of flipping to an allowlist does not satisfy the ticket.
- **Byte-identical default path.** The default `base = { host: "localhost" }` must still validate, so every existing generated plan and compose file is unchanged.
- **Preserve the return contract.** The function returns `null` when valid or a reason string when not; the caller (`composeGen`) throws `env compose-gen: invalid base.host — <reason>`. The contract shape (`null | string`) is unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/env.js` `envValidateBaseHost` (lines 349–363) | JavaScript (Node, no deps) | The validator being tightened |
| `plugin/skills/faff/bin/lib/env.js` `composeGen` (line 436–437) | JavaScript | Sole caller; throws on non-null reason before resolving any surface |
| `plugin/skills/faff/bin/lib/env.js` `envResolveEndpoint` (line 368–370) | JavaScript | The injection sink — interpolates `base.host` into the endpoint URL |
| `plugin/skills/faff/bin/lib/env.js` `envSelftest` FAFF-791 block (lines 939–963) | JavaScript | The pure, docker-free oracle; extended by this change |

**Scope statement.** This sits at the FAFF-791 endpoint-surface seam in `env` compose-gen; it hardens the input validation that gates that seam, one function deep, with no change to plan/compose output or to any caller.

## 2. OUT OF SCOPE

- **Full RFC 1123 / IDNA hostname validation** — label-length caps (≤63), total-length caps (≤253), leading/trailing-hyphen rules, and Punycode are beyond the injection-hardening this ticket asks for and risk rejecting legitimate operator input. Extension point: a future stricter validator replaces the bare-host regex.
- **IPv6 zone identifiers (`%eth0`) and non-bracketed IPv6** — a compose endpoint routes to a bracketed literal (`[::1]`); zone-scoped link-local addresses are not a compose endpoint concern, and `%` is deliberately rejected. Extension point: the bracketed-IPv6 sub-regex.
- **The cross-machine transport that first supplies a real non-`localhost` base (FAFF-817)** — not yet built; this ticket lands the guard independently as defence-in-depth ahead of it.
- **Adding `envValidateBaseHost` to `module.exports`** — it is module-internal today and fully exercised via `composeGen`/`envSelftest`; exporting it would widen the module's public surface for no consumer.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Bare host | A hostname or IPv4/dotted literal supplied without brackets, e.g. `localhost`, `10.0.0.5`, `db-1.internal` |
| Bracketed IPv6 literal | An IPv6 address wrapped in `[ ]`, e.g. `[::1]` — the only accepted form carrying `:` |
| Authority charset | The characters permitted in a bare host: letters, digits, dot, hyphen — `[A-Za-z0-9.-]` |

**Interface (unchanged signature).**

```
FUNCTION envValidateBaseHost(host) -> null | string     # module-internal
  # null      => host is a valid bare host or bracketed IPv6 literal
  # string    => human-readable reason the host is rejected
```

**Behavioural contract after the change.**

- accepts: `"localhost"` (default; must remain valid — byte-identical plans), `"10.0.0.5"` (dotted IPv4), `"db-1.example.com"` (letters/digits/dot/hyphen), `"[::1]"` (bracketed IPv6 — existing positive sub-check kept).
- rejects (non-null reason): `""` (empty), a space (`"bad host"`), a control char / tab, `%` (`"a%b"`, `"1.2.3.4%eth0"`), `_` (`"a_b"`), the FAFF-791 vectors (`"http://evil/"`, `"1.2.3.4/admin"`, `"user@host"`, `"host:8080"`, `"a?b"`, `"a#b"`), and malformed bracketed IPv6 (`"[:::]x"`).

**Design decision — reason-string granularity.** The scheme/userinfo/path/query/fragment/port `includes()` checks become **subsumed** by the positive charset test (every character they reject is already outside `[A-Za-z0-9.-]`).

**Chosen:** Collapse the bare-host denylist checks into a single positive charset test with one reason string that names the allowed form. The non-empty check and the bracketed-IPv6 branch (with its `malformed bracketed IPv6 literal` reason) are retained verbatim.

## 4. HOW — Behavior

**Approach.** Rewrite only the body of `envValidateBaseHost`. Keep the non-empty guard first, keep the bracketed-IPv6 branch (its `/^\[[0-9A-Fa-f:]+\]$/` sub-check is *already* a positive allowlist and must stay), and replace the entire scheme/userinfo/path/query/fragment/port denylist for the bare-host branch with one positive charset assertion. Nothing else in the file changes except the added selftest assertions (§8).

```
PROCEDURE envValidateBaseHost(host):
  1. IF host is not a string OR host is empty:
       RETURN "must be a non-empty string"
  2. IF host starts with "[":                       # bracketed IPv6 branch (UNCHANGED)
       a. IF host does NOT fully match /^\[[0-9A-Fa-f:]+\]$/:
            RETURN "malformed bracketed IPv6 literal"
       b. RETURN null
  3. IF host does NOT fully match /^[A-Za-z0-9.-]+$/:   # positive allowlist (REPLACES the denylist)
       RETURN "must be a bare hostname or IP literal — only [A-Za-z0-9.-], or a bracketed IPv6 as [::1]"
  4. RETURN null
```

**Ordering matters.** The bracket branch (step 2) must run *before* the charset test (step 3): `[` and `:` are not in `[A-Za-z0-9.-]`, so a bracketed IPv6 literal would be wrongly rejected if the charset test ran first.

**Anti-pattern:** Adding more `host.includes("<char>")` denylist lines to cover spaces/control/`%`/`_` — it reproduces the exact enumeration weakness this ticket exists to remove.

**Anti-pattern:** A loosely-anchored charset test (e.g. `/[A-Za-z0-9.-]/` or non-anchored `test`) — an unanchored regex matches if *any* character is valid, so `"bad host"` would pass. The regex must be fully anchored (`^...+$`).

**Failure mode — the allowlist rejects a host an operator legitimately needs.** `[A-Za-z0-9.-]` excludes `_` and `%`. How you'd know: `composeGen` throws `invalid base.host` for a host the transport (FAFF-817) actually supplies, failing loud at the boundary. This is the correct, intended behaviour for a routable endpoint authority; a real legitimate need is a *new* ticket to widen the allowlist deliberately, not a reason to weaken it now. Narrow, don't abandon.

## 5. Scenarios — born-verifiable main objectives

All scenarios verified through `faff env --selftest` (the pure in-file oracle; zero holdouts).

```
Given the default base { host: "localhost" }
When composeGen resolves the plan
Then validation passes and the generated plan/compose is byte-identical to pre-change output
```
```
Given a bare host of only letters/digits/dot/hyphen (e.g. "10.0.0.5", "db-1.example.com")
When composeGen validates base.host
Then envValidateBaseHost returns null and the plan resolves
```
```
Given a bracketed IPv6 literal "[::1]"
When composeGen validates base.host
Then envValidateBaseHost returns null and the endpoint resolves to http://[::1]:<port>
```
```
Given a host containing any non-authority character — a space ("bad host"), a control char, a percent ("a%b"), or an underscore ("a_b")
When composeGen validates base.host
Then envValidateBaseHost returns a non-null reason and composeGen throws before any endpoint is resolved (no plan leaked)
```
```
Given each FAFF-791 vector still in the malformed set ("http://evil/", "1.2.3.4/admin", "user@host", "host:8080", "", "a?b", "a#b", "[:::]x")
When composeGen validates base.host
Then it still throws with no plan leaked (no regression)
```

## 6. Design Decision Rationale

**Land this now independently, or defer it to FAFF-817?**
- *Defer with FAFF-817:* co-locates the guard with its first real consumer, but leaves the seam under-guarded in the interim and couples a small self-contained hardening to unbuilt, larger work.
- *Land now as defence-in-depth:* the guard is valuable the moment any non-default base can be supplied, is fully testable in isolation via `faff env --selftest`, and a human has already promoted FAFF-818 to `faff-automate` as its own standalone ticket.
- **Chosen:** Land now, independently, as defence-in-depth. The ticket's open question is closed. (decides: any)

**Keep the six specific denylist reason strings, or collapse to one positive-charset reason?**
- *Keep them:* `http://evil` yields `must not carry a scheme` — but the checks are now redundant with the charset backstop and reintroduce the enumeration mindset the ticket removes.
- *Collapse:* one anchored charset test + one reason string naming the allowed form. No test asserts the specific old strings (verified: the malformed selftest loop only checks that it *threw* with no plan leaked), so collapsing keeps every case green.
- **Chosen:** Collapse to a single positive charset test + one reason string; retain the non-empty guard and the bracketed-IPv6 branch verbatim. (decides: any)

## 7. Open Questions and Assumptions

**Open Questions.** None — the ticket's sole open question (land now vs with FAFF-817) is closed to *land now* above.

**Assumptions.** None requiring external knowledge; every fact (caller, oracle, export status, reason-string non-dependence) is verified against the repo.

## 8. DONE — Definition of Done

The machine oracle for the whole checklist: **`node plugin/skills/faff/bin/faff env --selftest` exits 0** (run from repo root; pure/docker-free, exercises the repo's `env.js` directly).

**From WHY / WHAT (validator contract)**
- [ ] `envValidateBaseHost` still returns `null` for `"localhost"`, `"10.0.0.5"`, and `"[::1]"`.
- [ ] `envValidateBaseHost` returns a non-null reason for a space (`"bad host"`), a control char / tab, `%` (`"a%b"`), and `_` (`"a_b"`).
- [ ] The default `base = { host: "localhost" }` path produces a byte-identical plan/compose (existing determinism + FAFF-791 default assertions remain green).
- [ ] The function signature and return contract (`null | string`) are unchanged, and it remains module-internal (not added to `module.exports`).

**From HOW (behaviour)**
- [ ] The bare-host branch is a single anchored positive charset test `/^[A-Za-z0-9.-]+$/` — the scheme/userinfo/path/query/fragment/port `includes()` denylist lines are removed.
- [ ] The bracketed-IPv6 branch (`/^\[[0-9A-Fa-f:]+\]$/` with its `malformed bracketed IPv6 literal` reason) and the non-empty guard are retained verbatim, with the bracket branch evaluated before the charset test.
- [ ] `composeGen` still throws `env compose-gen: invalid base.host — <reason>` before resolving any surface for every rejected host (no plan leaked).

**From HOW (edge cases / regression)**
- [ ] Every host in the existing FAFF-791 malformed loop (`"http://evil/"`, `"1.2.3.4/admin"`, `"user@host"`, `"host:8080"`, `""`, `"a?b"`, `"a#b"`, `"[:::]x"`) still throws with no plan leaked.
- [ ] The FAFF-791 selftest block is extended so the newly-rejected classes (space, control char, `%`, `_`) each assert throw-with-no-plan-leak, and at least one bracketed-IPv6 accept case remains.

**Integration smoke test**
```
1. Add a space host ("bad host"), a control-char host, "a%b", and "a_b" to the malformed loop's host array in envSelftest (FAFF-791 block, ~line 959).
2. Confirm an accept case for a dotted-hyphen host and for "[::1]" (existing) passes.
3. Run: node plugin/skills/faff/bin/faff env --selftest
4. Expect: prints "env --selftest: ok" and exits 0.
```

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery — issue-critique (read-only diagnostic; does not gate promotion).*

- **Right-sized? (Principle 4)** — No issues. Single-function change plus in-file selftest assertions; one independent concern, well inside a 1–3 day unit, not a split candidate and not an always-ships-together fragment (§6 argues standalone defence-in-depth value). The `build-tier: complex` marker reflects security-reasoning care, not scope size.
- **Workstream fit? (Principles 1 + 5)** — No issues. Project "Outward L4 evidence is reproducible and honestly bounded" is outcome-named; an un-allowlisted `base.host` can silently redirect where L4 evidence is gathered, so hardening it keeps that evidence honestly bounded. Same seam as its shipped sibling FAFF-791.
- **Deps surfaced? (Principle 6)** — No issues. FAFF-791 (Done) is the satisfied prerequisite seam; FAFF-817 (unbuilt) is a downstream consumer, not a blocker. Direction of dependence stated and correct; rightly no blocker edges.
- **Risk profile? (Principle 7)** — No issues; no de-risking spike warranted. Pure docker-free oracle exercises every accept/reject class, default `localhost` path asserted byte-identical, no novel integration. The one live risk (allowlist rejecting a legitimately-needed host once FAFF-817 supplies real bases) is reasoned through in §4.

confidence: high
build-tier: complex
spec-review: approve
