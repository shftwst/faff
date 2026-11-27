# Read both review-entry inputs in the same tool call

The reviewer slot and live verification posture are independent reads at the same pre-PR boundary. Keep both existing CLI resolvers and return both outputs before invoking the skill. The command continues to support per-invocation verification flags.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `For Phase-2 criticals retain round 1 or the resumed` | changed: Graft obtains the reviewer and live verification posture in the same Bash call, then resolves the occupant and forwards the existing payload. |
| `Interactive verification opt-in (attended sessions, advisory, never acting).` | changed: The entry command is shared by both modes; the following attendedness and acting rules remain in place. |
| `verification resolve --json` | changed: Run the existing verification resolver immediately after the slot lookup, with only the applicable verification flags. |
