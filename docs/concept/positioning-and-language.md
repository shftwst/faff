---
sidebar_position: 7
---

# Names and language

This page records how the product names map to the software people can use
today. It is mainly a reference for contributors; readers should not have to
learn a naming transition before they can understand the product.

## Product names

**SuperDomestique** is the product name. It covers the complete system for
planning, delivering, and governing increasingly independent software work.

**Commissaire** is the governance system within SuperDomestique. It records and
checks evidence, applies deterministic rules, and controls progress at named
boundaries.

**`faff`** is the current technical name. It remains in the repository URL,
plugin, CLI, commands, configuration, paths, package names, and run records.

The clearest introduction for readers arriving through an old link is:

> SuperDomestique (formerly known as `faff`)

After that introduction, use SuperDomestique for the product, Commissaire for
the governance system, and `faff` for literal technical names. There is no need
to repeat the transition on every page.

Commissaire currently lives as a logical code region in the `faff` repository.
It is not a separate package, process, service, or security boundary. A future
change to packaging or technical identifiers needs its own compatibility plan.

## Product position

SuperDomestique helps teams reduce scheduled human attention one workload at a
time. The short form is "safe to stop watching". That phrase always refers to a
named trust level and its supporting controls. It does not promise defect-free
output or remove human judgement where evidence is insufficient.

Treat delivery and governance as equal parts of the product:

- the delivery system does the work;
- Commissaire checks whether the work may continue or land.

## Evidence language

Use the status recorded by the dated
[public trust-claim audit](https://github.com/shftwst/faff/blob/main/docs/audits/2026-08-07-FAFF-732-public-trust-claims.md):

- **enforced** means a named mechanism applies the rule;
- **attested** means the system reports the condition but the boundary does not
  independently force it;
- **demonstrated** means a recorded run has shown the behaviour;
- **planned** means the work has not shipped;
- **unsupported** means the available evidence does not support the claim.

The audit is a dated record. Update it when the evidence changes instead of
quietly strengthening copy elsewhere.

## Writing rules

- Lead with the reader's job and the working product, not the naming history.
- Describe autonomy per workload and per level.
- Put evidence or a clear limit beside material trust claims.
- Use `faff` exactly for commands and other technical identifiers.
- Keep historical ADRs, specifications, audits, and captured output under the
  names used when they were written.
- Avoid presenting the product as a project-management shortcut, a chore
  remover, or unqualified full autonomy.

[ADR 0096](https://github.com/shftwst/faff/blob/main/docs/adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md)
records the naming decision. The [July 2026 positioning brief](https://github.com/shftwst/faff/blob/main/docs/superpowers/specs/2026-07-20-docs-positioning-design.md)
still governs the evidence-first position, trust-per-level model, two-part
information architecture, and public tone.
