# Spec — faff next --if-eligible: hypothetical-eligibility transition mode

> producer: faffter-dark-nlspec · adaptor: faffidavit-spec · 2026-06-10 · confidence: high

Reframed onto the eligibility model (FAFF-61/FAFF-98). Read-only advisory `faff next` mode:
"what would this item route to the moment it's blessed (made automation-eligible)?"

## WHAT
- Add `--if-eligible` to `faff next`. When present AND not eligible (`--not-eligible`/`--held`),
  skip the `if (!eligible) return skip-ineligible` short-circuit, fall through the table, return
  `{next, reason, would_be_eligible:true}`. Byte-identical without the flag. No-op when eligible.
  Terminal states (done/cancelled/duplicate) still win. Advisory-only; never grants eligibility, never mutates.

## Chosen
- Flag `--if-eligible` (mirrors `--not-eligible`).
- JSON field `would_be_eligible:true` (only on hypothetical results).
- Advisory-only; live skip-ineligible path untouched.

## DONE
- backlog/none/--not-eligible/--if-eligible → {next:prep, would_be_eligible:true}; without flag → skip-ineligible.
- todo/high/--not-eligible/--if-eligible → graft+would_be_eligible; medium → needs-human; +--blocked → blocked.
- no-op when eligible; terminal wins; live path byte-identical; faff next --selftest passes; validate-adapters passes;
  USAGE + gateway "Next-step transition" document --if-eligible as advisory.
