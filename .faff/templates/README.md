# Template overrides

Committed template overrides for this repository live here. Files faff reads:

- `adr.md`: the ADR section list, read through `faff adr format`.
- `native-templates.yaml`: the tracker-native template map, written by `faff native-map set`.
- `<type>.md` (`bug`, `feature`, `spike`, `chore`, `epic`, `default`): the ticket field list for `/faff-jot` and `/faff-plot`.

The location is resolved by `faff config templates-path`. No overrides are set here, so every consumer uses its built-in default.
