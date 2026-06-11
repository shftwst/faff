---
name: faffidavit-ship
description: "Default `ship_adaptor` — translates a ship producer's native delivery result (gh/CI/deploy exit + logs) into the fixed shipped/not-ready/failed outcome and validates conformance, failing safe to failed. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffidavit-ship

The default **adaptor** for the `ship_adaptor` slot. It translates a `ship` producer's native delivery result — a `gh`/CI/deploy tool's exit status and logs — into faff-core's fixed delivery-outcome contract (the three outcomes faff-graft routes on), and **validates** conformance on demand. A `faffidavit-*` skill: it both *defines* its dialect and *checks* conformance, so it's invokable rather than a passive document.

```yaml
slots:
  ship_adaptor: faffidavit-ship   # the default — explicit for clarity
```

## Internal contract (fixed — see gateway)

The delivery-outcome contract itself is a faff-core invariant and lives in the gateway (_Core contracts and adaptor slots → Delivery outcome_), **not** here. Fixed there, and unaffected by swapping this slot:

- the three outcomes — `shipped` / `not-ready:<reason>` / `failed:<reason>` — and their semantics,
- the **two-tier gate** (the non-delegable integrity floor asserted by graft + the producer's own deploy-readiness tier),
- the coercion rule (a result this adaptor can't map normalises to `failed:<reason>`, never silently to `shipped`), and
- faff-graft's proceed / park-retry-later / fail branch on those three outcomes.

This skill does not get to change any of that. What it owns is the *envelope and translation* — how a `ship` producer's native result is shaped and parsed into those fixed outcomes. That is what makes the slot swappable: a deploy-capable producer plugs in behind a different adaptor, and faff-graft still routes on the same three outcomes.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-graft` reads the gateway on entry), so when you run as the `ship_adaptor` slot it is already in context. If you are invoked **standalone** (normalising a delivery result on demand), **Read the sibling `faff/SKILL.md` → _Core contracts and adaptor slots → Delivery outcome_ now** before mapping. Refer back to it; the recap below is non-normative and the gateway wins on any conflict.

## The three outcomes (non-normative recap for translation)

The adaptor must map every producer's native result onto exactly one of these. The authoritative definition is the gateway's; this table recaps it so the mapping is unambiguous (gateway wins on any conflict):

| Outcome | Meaning | What the caller does |
|---|---|---|
| `shipped` | Integrity floor + deploy-readiness passed; the PR merged/deployed; deploy-side cleanup done. | Proceed — chained issues unblock; graft reclaims the worktree. |
| `not-ready:<reason>` | Deploy-readiness deferred the merge **without merging**. Not a defect. | Park retry-later. PR stays open and mergeable. |
| `failed:<reason>` | Merge conflict or deploy error. | Treat as a post-build failure: one fix attempt if obvious, else park. |

Coercion direction (also fixed in the gateway): in doubt, **never** map to `shipped`. Only an actually-confirmed merge/deploy is `shipped`; an unconfirmable success, a readiness deferral, or an error maps to `not-ready` or `failed`. This adaptor preserves that direction; it never relaxes it.

## Adaptor (this skill's dialect)

The envelope every `ship` producer in this slot returns:

```
outcome: shipped | not-ready | failed
reason: [required for not-ready and failed; omit or empty for shipped]
```

- `outcome:` is the first line, exactly one of the three words.
- `not-ready` and `failed` **must** carry a `reason:` — a short, specific cause (`merge conflict on main`, `deploy window closed`, `migration not applied`). `shipped` carries none.
- The reason is for the human and the park comment: it states *what* deferred or failed, specifically enough to act on.
- **Delivery-precondition blocks are `not-ready`, with a namespaced reason.** A mechanical precondition the producer refused to merge past (push denied, missing token scope, disabled merge method, Actions-policy block) maps to `not-ready:precondition:<kind> — <detail>; remedy: <remedy>`, where `<kind>` ∈ `push` / `token-scope` / `merge-method` / `actions-policy`. This is a **reason convention inside the existing `not-ready` outcome**, not a new outcome — the `precondition:` prefix keeps it routable (graft surfaces the remedy in the retry-later park comment; `/faff-wtf` can read the `<kind>`) without growing the closed three-outcome vocabulary. A precondition block is **never** mapped to `failed` (no error/conflict — it is a one-time-remedy deferral) and **never** to `needs-human` (that is the review verdict's change-judgement channel, not a delivery outcome).

When a delegated (third-party) producer emits something other than this envelope — a raw `gh` exit code, a deploy tool's JSON, a log tail — the adaptor's translation job is to map its native output onto an `outcome:` line + reason, picking the outcome that honours the fixed semantics and coercion direction above. A clean merge/deploy exit → `shipped`; a precondition the producer refused to merge past → `not-ready:precondition:<kind>` (or a deploy-readiness deferral → `not-ready:<reason>`); an error, a non-zero exit, a timeout, or an unconfirmable result → `failed:<reason>`.

## Validate — wired to the contract script (FAFF-79)

Validation is **conformance by construction** (FAFF-21): this adaptor does **not** prose-check the envelope. It **extracts** the producer's native delivery result into a structured candidate, hands that to the deterministic **contract script**, and returns the script's output. **The contract script `faff contract delivery-outcome` is the sole source of contract data** — this adaptor never builds the contract data itself, never decides `conformant` / `violations`. That delegation is what `faff validate-adapters` checks (the wiring-check).

**The split — artifact-preferred (FAFF-76 Decision 2; the artifact branch lit up for ship by FAFF-108):**

The adaptor obtains the **extraction JSON** by one of two paths, **in precedence order** — the producer's emitted artifact first, prose extraction only as a fallback:

- **(1) Producer-emitted artifact — preferred, fully deterministic, no LLM.** If the producer's output carries a single fenced block tagged `faff-contract:delivery-outcome` (emitted as the last output by the `ship` producer that ran the merge/deploy — see the artifact convention in `docs/adr/0001-contract-as-code-foundations.md`), the adaptor **locates it by that info-string and `JSON.parse`s its body** into the `{ "outcome", "reason", "corroborated" }` extraction JSON below — the producer ran the merge and read its exit, so it declares the outcome and corroboration directly (no inference). There is **no `provenance_present`** field — that is spec-specific; the delivery-outcome extraction is exactly `{ outcome, reason, corroborated }`.
  - **Present + valid** (parses + carries `outcome` + `corroborated`) → use it.
  - **Present + malformed** (not JSON, or missing those fields / wrong shape) → **fail-loud** (the extraction is unparseable → the script exits 2, never a phantom `shipped`). **Do not** silently fall back to prose — a corrupt artifact is producer breakage, surfaced not masked. The fallback trigger is *absence*, never *corruption*.
- **(2) Prose extraction — fallback, the LLM seam, only when no artifact is present** (the translation seam below).

Either path yields the **same** extraction JSON, piped to the contract script unchanged. The artifact is the script's **input**, never a second source of contract data — the script stays the sole source. The script's `corroborated:false`-shipped → `failed` coercion is unchanged and applies identically on **both** paths.

**The split (the translation seam) — the prose-extraction fallback (path 2):**

- **This adaptor (extraction — the translation judgement, only when no artifact is present):** read the producer's native result (a `gh` exit, deploy-tool JSON, a log tail) into an **extraction JSON** —
  ```
  { "outcome": "<verbatim shipped|not-ready|failed, or whatever the producer emitted>",
    "reason": "<short cause; may be empty>",
    "corroborated": <bool — does the native result actually confirm a merge/deploy> }
  ```
  Mapping a foreign deploy tool's output onto a candidate outcome + reason + corroboration is the adaptor's job.
- **The contract script (all conformance computation — deterministic):** validates `outcome` against the closed enum and, when it isn't one of the three, **coerces to `failed`** (never `shipped` — the safe target, FAFF-76 Decision 3); coerces an `outcome:shipped` with `corroborated:false` to `failed` (an unconfirmed success is not shipped); flags `not-ready`/`failed` with no reason; emits the canonical contract data. It **fails loud** only on an unparseable extraction (an un-readable result still coerces to `failed`, never a phantom `shipped`).

**Invocation + signal mapping:**

```
echo '<extraction JSON>' | faff contract delivery-outcome
```

| Script exit | Meaning |
|---|---|
| 0 | conformant: `conformant:true`, `violations:[]` (the script's stdout) |
| 1 | non-conformant (incl. coerced-to-`failed`): `violations` name the cause |
| 2 | fail-loud: the extraction is unparseable / not an object |

The contract data faff-graft Step 10 routes on is **the script's stdout, verbatim**. The **two-tier gate** (the non-delegable integrity floor + the producer's deploy-readiness tier) is gateway/graft semantics — the script neither runs nor weakens it.

## Rules

- The vocabulary is closed at three outcomes — that closure is fixed in the gateway, not here. A producer needing a fourth outcome is misusing the contract; fold it into one of the three.
- This adaptor owns the envelope and the translation; it does not own the deploy-readiness check, the merge/deploy mechanism, or deploy-side cleanup (those belong to the producer in the `ship` slot), nor the outcome semantics, the integrity floor, or the routing (those are fixed in the gateway / owned by faff-graft).
- Validation reports or normalises; it never changes a result's substance, only its conformance to the envelope — and it always fails safe toward `failed`, never toward a phantom `shipped`.
