# FAFF-47 — Provision faff control labels (ensure they exist before tagging)

> Spec: faffter-dark-nlspec · 2026-06-06 · confidence: high (manifest locus resolved → CLI). Full spec on Linear FAFF-47.

## WHY
faff applies control labels but nothing ensures they exist first (faff-chain-gap-fill was
hand-created). An unattended run tagging a missing label can fail/mis-tag, so auto-filled
tickets are missed by the next prep pass — breaking the bottom-up tributary.

## WHAT / HOW
- **Canonical manifest = `faff labels` CLI subcommand** (resolved Punt): emits the control-label
  set (name + color + description) as JSON; `--names` for bare names. Single source of truth the
  ensure-rule and FAFF-6 bootstrap both read. The CLI EMITS the set but cannot create tracker
  labels (no MCP) — the create is agent-via-MCP.
- **Gateway shared rule "Control-label provisioning (ensure-before-tag)":** before any path tags
  a control label, ensure it exists (list → create from the manifest entry → tag), idempotently
  ("exists" = no-op). One shared rule; tag sites (jot intake+freeze, plot, tidy parks+chain-gaps,
  beep-boop, graft, prep parks) reference it — pointers added at the park protocol, the chain-gap
  recipe, and jot's create+freeze.
- **Git-only mode:** no-op.
- **FAFF-6 (held): no dependency** — FAFF-47 delivers manifest + runtime ensure-rule standalone;
  FAFF-6 later consumes the same manifest for bulk bootstrap.

## DONE
- [x] `faff labels` manifest defines all 4 control labels (name+color+description).
- [x] Gateway shared ensure-before-tag rule; every tagging path references it.
- [x] "Label exists" = clean no-op (idempotent); git-only = no-op (stated in the rule).
- [x] validate-adapters + config still PASS; manifest names == the 4 canonical labels.
- [x] Diff limited to skills/faff/bin/faff + gateway + tidy + jot.
