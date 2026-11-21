# Plan autonomous discovered-scope filing

Beep-boop's discovered work and tidy's autonomous chain gaps use one local plan. The command binds the proposed parent and relationship to the mandate, runs containment before appetite and reuses the configured self-intake decision. A self-intake proposal identifies its own lane, keeps the optional relationship and omits the automation label. Vague, withheld or genuinely outward work stays surface-only. A failed containment check never emits a create proposal.

The connector still fetches fresh destination ancestry and team facts. The caller chooses the mandate and relationship, supplies the effective appetite and methodology fact, authors the issue, and judges semantic duplicates. The caller writes through the existing tracker MCP and waits for acknowledgement before stamping the new issue or updating bookkeeping. A plan has no new issue ID and makes no tracker or forge calls. With `--record`, it writes only the existing local gate record types and preserves their audit inputs. Rehome, retry ambiguity and interactive sanction remain in their existing paths.

## Measurement

Compared with `a3fa5446`, loaded prompts shrink by 8,054 bytes, about 1,982 tokens. For 25 interleaved fresh Node 22 iterations per arm, the contained fixture used one call both ways and returned 89 bytes for the old containment verdict versus 248 for the plan. Median elapsed time was 20.7 ms and 37.3 ms respectively. For the same-team self-intake fixture the plan replaced two calls with one, returned 298 bytes where the old probes returned 334, and took 39.9 ms median versus 49.2 ms. The local facts payloads were 203 and 204 bytes. Using the file path avoids resending those bytes to the command. The contained path's extra output and startup can offset static savings over many items. No tracker, native model or hosted timings were used.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Containment check (runs before the appetite gate; this is chokepoint #1)` | CLI walks fresh supplied ancestry first and preserves the outward floor. | test/discovered-scope-plan.test.mjs | changed: compose the existing recorded check |
| `vague items → never filed. Aggregate for the run summary` | Vague items surface immediately without probe or write. | test/discovered-scope-plan.test.mjs | changed: issue the surface result directly |
| `which reaches this gate having already passed the same-team structural check inside the procedure` | Contained or reclassified facts still go through resolved appetite and methodology. | test/discovered-scope-plan.test.mjs | changed: the plan combines the fixed decisions |
| `the recorded relationship link to the originating issue` | The plan binds supplied placement and link, and the caller authors provenance and stamps after acknowledgement. | test/discovered-scope-plan.test.mjs | changed: output planned fields without writing |
| `the filed count to the ledger's informational discovered_scope_filed field` | The caller records only acknowledged creates. The CLI leaves the ledger untouched. | test/discovered-scope-plan.test.mjs | changed: clarify the acknowledgement boundary |
| `This is one of the two autonomous-by-construction tracker-create paths` | Both autonomous filers use the planner. Interactive callers retain sanction. | | changed: one execution path |
| `PROCEDURE autonomous_file_check(mandate, candidate, run_id, phase)` | The CLI uses the same probes, outward carve-out, evidence and missing-record failure. | test/discovered-scope-plan.test.mjs, test/contain.test.mjs, test/self-intake.test.mjs | changed: execute the fixed sequence in one local process |
| `Ancestry is fetched fresh at filing time` | Caller still obtains ancestry at filing time through discovery. | | changed: feed fresh facts into the plan |
| `a cycle, or an unknown/absent parentId` | Existing containment primitive still handles these cases and mandate equality. | test/contain.test.mjs, test/discovered-scope-plan.test.mjs | kept |
| `Containment is a precondition, not a replacement for appetite` | Plan applies appetite only after the containment/self-intake route. The supplied observations are bound for later audit. | test/discovered-scope-plan.test.mjs | changed: combine the fixed decisions |
| `auto-create vs surface is governed by the appetite dial` | Tidy still distinguishes human-sanctioned and autonomous creation, using the same plan only for the latter. | test/discovered-scope-plan.test.mjs | changed: invoke the shared route |
| `Log every created ticket id + sub-type + source spec line` | Caller logs the same fields from acknowledged creates. | | changed: make the tracker acknowledgement explicit |
| `auto-create is appetite-gated (gateway` | Autonomous tidy follows the shared plan above. The log payload and separate consolidated/priority comments remain. | | changed: remove repeated procedure |
| `not a floor edit — contain.js is byte-identical` | The small CLI adapter change suppresses standalone text during composition. The verdict and audit behaviour are retained. | test/contain.test.mjs, test/self-intake.test.mjs | changed: describe the unchanged floor |
| `3. Gate per item:` | Each candidate has its own disposition and reason. | test/discovered-scope-plan.test.mjs | changed: consume the plan result |
