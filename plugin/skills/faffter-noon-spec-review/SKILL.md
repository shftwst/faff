---
name: faffter-noon-spec-review
description: "Default `spec_review` slot occupant — the passthrough scaffold for FAFF-9's spec-stage review. Emits an `approve` spec-review verdict with no objections so the seam round-trips end-to-end; the real four-lens reviewer lands in FAFF-266. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-noon-spec-review

The default occupant of the **`spec_review`** slot — the passthrough scaffold that exists so the spec-stage-review seam works end-to-end before the real reviewer is built (FAFF-265, the spine of FAFF-9).

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

## What it does

It does **not** review anything. It unconditionally emits an `approve` verdict with no objections, exercising the producer-emits / consumer-parses path so `faff config get slots.spec_review` → invoke → emit block → `faff contract spec-review-verdict` round-trips on day one.

The real behaviour — the four lenses (architectural, infosec, methodology, QA) run as an L1–L3 single-pass checklist, with the `reject-approach` backward edge — is **FAFF-266**, which upgrades this same occupant in place (the slot default never changes).

## Output (the contract artifact)

Emit exactly one fenced block as the producer's output — the consumer (`faff-prep`, FAFF-266) locates it, `JSON.parse`s it, and pipes it to `faff contract spec-review-verdict` (the sole source of contract data):

```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```

The fixed verdict shape (`approve` / `revise` / `reject-approach` / `needs-human`, plus `objections: [{ lens, severity }]`) and its validation live in the gateway's contract-as-code surface (`faff contract spec-review-verdict`). A swapped-in reviewer (e.g. FAFF-267's adversarial occupant) conforms by emitting the same block.
