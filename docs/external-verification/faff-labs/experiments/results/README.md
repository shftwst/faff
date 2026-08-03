# faff-labs experiments — results

Scorecards for the faff-L4-vs-one-shot study. Design and rationale: [`../l4-experiment-design.md`](../l4-experiment-design.md).

## Link, never copy

The control codebases are **not vendored here** — each lives in its own repo and is referenced, pinned to a commit, by [`controls.manifest.json`](controls.manifest.json). The scoring rig resolves a control by name → repo@SHA and fetches it (`gh`/`git`) at scoring time. Same for each L4-built arm (its own repo, added to the manifest when built). A pinned SHA freezes the exact state, so the comparison is reproducible without a giant monorepo. The repos are being made public; until then a reproducer needs read access.

Why not git submodules: churn and clone-recursive pain for no gain — a JSON manifest + `gh` fetch is lighter and just as reproducible.

## Layout (as results land)

```
results/
  controls.manifest.json   # control (and later L4-arm) repos, pinned @ SHA + key paths
  pricing.json             # dated advertised-API rate card per token type (design §5.A.4); filled at scoring time
  <exp>-scorecard.md       # per experiment: control vs each L4 arm across the mechanical axes + blind-judged score + $ premium
  aggregate.md             # the headline table: win/tie/loss per axis, median $ premium, independent-catch count, null columns included
```

Nothing here is committed until an arm is actually scored — the manifest + this note are the scaffolding.
