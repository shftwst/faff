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

When a delegated (third-party) producer emits something other than this envelope — a raw `gh` exit code, a deploy tool's JSON, a log tail — the adaptor's translation job is to map its native output onto an `outcome:` line + reason, picking the outcome that honours the fixed semantics and coercion direction above. A clean merge/deploy exit → `shipped`; a precondition the producer refused to merge past → `not-ready:<reason>`; an error, a non-zero exit, a timeout, or an unconfirmable result → `failed:<reason>`.

## Validate — wired to the contract script (FAFF-79)

Validation is **conformance by construction** (FAFF-21): this adaptor does **not** prose-check the envelope. It **extracts** the producer's native delivery result into a structured candidate, hands that to the deterministic **contract script**, and returns the script's output. **The contract script `faff contract delivery-outcome` is the sole source of contract data** — this adaptor never builds the contract data itself, never decides `conformant` / `violations`. That delegation is what `faff validate-adapters` checks (the wiring-check).

**The split (the translation seam):**

- **This adaptor (extraction — the translation judgement):** read the producer's native result (a `gh` exit, deploy-tool JSON, a log tail) into an **extraction JSON** —
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
