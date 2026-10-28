# Pinned run variables and recorded outcomes

The in-spec-ratification fixture checks compare lens outcomes across variants that must differ in
**exactly** the `(ratified: human)` suffix. A pass whose runs used different backends or context is
not evidence the tag caused the difference, so the pin is recorded here, one file per fixture
directory, alongside the fixtures it pins. A later re-run reproduces this pin; a reviewer checks it
without re-deriving it.

## The pin

| Variable | Pinned value |
|---|---|
| Date run | 2026-10-19 |
| Backend identity | `openai` / `z-ai/glm-5.3-flash` via `https://openrouter.ai/api/v1`, served as `chain[0]` |
| Chain length | 1 — a single-element `--backends-json`, so no fallback can serve a different model mid-set |
| `--timeout` | 240s (scope-test passes: 180s) |
| `--max-tokens` | 2000 (scope-test passes: 600) |
| `--deadline` | 270s (scope-test passes: 200s) |
| `--context` file set | empty — no context file on any run |
| `## Ratified scope` presence | absent on every run, deliberately: the in-spec clause must defer on the tag alone |
| Lens | `architectural` only — one design lens is enough for the claim under test |
| `--system-dir` | the occupant's own directory, so each run reads the `refute-<lens>.md` under test |
| `--diff-kind` | `prose` |
| Transport | `build-lens-requests.mjs` → `fan-out.mjs` → `review-call.mjs`, reused verbatim |

## Reproducing a run

```bash
SR=plugin/skills/faffter-dark-spec-review
D=$SR/eval/in-spec-ratification
node "$SR/build-lens-requests.mjs" --lenses architectural \
  --backends-json <single-element chain, pinned above> --timeout 240 --max-tokens 2000 --deadline 270 \
  --system-dir "$SR" --diff "$D/<variant>.md" --raw-dir <scratch>/raw --round 1 > requests.json
node plugin/skills/faffter-dark-adversarial-review/fan-out.mjs --requests requests.json --strategy serial
```

## Recorded outcomes

| Check | Fixture | Outcome |
|---|---|---|
| Item 1 — no regression | `spec-decision-untagged.md` | Two `major` architectural objections. The one under test: "the design duplicates an existing per-run persistence mechanism the spec itself names" — a decision-level re-argument of the file-vs-sidecar choice, gating. |
| Item 2 — defers to observation | `spec-decision-tagged.md` | The same file-vs-sidecar objection appears only as an `observation` that cites the tagged line ("rejected by the ratified `(ratified: human)` tag on Decision 1, so the file-vs-sidecar choice itself is settled"). The separate *implementation*-level concurrency objection stayed `major`, so the downgrade was scoped to the ratified decision rather than blanket. |
| Item 3 — `critical` never deferred | `spec-decision-critical.md` | Raised at `critical` with the tag present, and the lens stated the rule back: "a `critical` is never deferred by the tag". |
| Item 4 — scope test declines an implementation objection | `scope-test-objections.json` → `implementation-level` | `classification=implementation-level, ratify_offered=no`. |
| Item 5 — the fail-safe middle | `scope-test-objections.json` → `ambiguous-mixed` | `classification=ambiguous, ratify_offered=no`. |
| Positive control for items 4–5 | `scope-test-objections.json` → `decision-level` | `classification=decision-level, ratify_offered=yes` — so the test is not a constant "no". |
| Contract-extraction check | untagged vs tagged | Marker extraction is identical and `faff contract spec-readiness` output is byte-identical: `{"confidence":"high","decisions":[{"classification":"closed"},{"classification":"closed"}],"markers_valid":true,"violations":[]}`. The only difference between the two files is the suffix text itself. |
| Register round-trip | `decisions-fixture.md` | `faff ratified-scope --assemble --root <dir holding docs/decisions.md>` emits the `### Ratified tradeoffs (docs/decisions.md)` subsection naming the entry; `--validate` returns `{"valid":true,"problems":[]}`. The `ratified-scope.js` and `decisions.js` selftests both still pass. |

## Honest bound

Each row is one stochastic sample from a probabilistic lens, not a proof. What the pin buys is
**attributability**: the item-1/item-2 pair differs in one suffix under otherwise-identical
conditions, so the downgrade is the tag's effect rather than lens variance. A re-run that
contradicts a row is a real signal about the clause's prompt text, not noise to discard.
