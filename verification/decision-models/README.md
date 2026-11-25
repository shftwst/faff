# Compare models on review findings

Give two models the same claim and evidence, then measure how often each clears an unsupported claim. Either arm can be a typed decision model or a general LLM. Each chooses `supported`, `contradicted`, or `insufficient`. The evidence is already collected. This experiment measures judgment on that evidence. It does not exercise repository investigation, grant permission to accept risk, or change the workflow.

## Cases

| Corpus | Cases | Evidence and grading |
|---|---:|---|
| [Historical](history-cases.json) | 33 across nine issues | New claims derived from 41 archived findings. Each answer has a written basis and excerpts traceable to [committed blobs and line ranges](history-sources.json). Eight findings were excluded because they duplicated a case or lacked a suitable question and evidence. Historical dispositions are not answer keys. |
| [Controls](controls.json) | 18 across six families | Each family has one case per answer. The replay covers retries, pagination, revision checks, changed test expectations, lease handoff and retry budgets. Each insufficient case admits two implementations with identical visible evidence and opposite outcomes. |

Requires Python 3.10+ on Linux or macOS. The suite uses the Python standard library. Run these commands from this directory.

```sh
python3 -B -m unittest discover -s test
python3 -B build_controls.py
python3 -B verify_history.py
python3 -B suite.py prepare controls.json history-cases.json --out runs/frozen
```

The historical verifier needs the pinned commits in the local Git object database. Inference only needs `packets.json`. The default split has 14 calibration and 37 holdout cases. Related findings from the same issue and variants from the same control family stay together. Preparation shuffles presentation order and binds both arms to the same packet and key hashes. Keep the answer key away from each inference process. Public fixtures can be known to a model, so reserve fresh private cases for a rollout decision.

## Collect two arms

Run each command in a process with the relevant provider credentials. The Claude example runs inside a subscribed Claude Code worker with `CLAUDE_CODE_OAUTH_TOKEN`. The Jev example uses `TYPESAFE_API_KEY`. If the two arms run on different machines, copy the same frozen packets to each and bring the two result files back to the scorer.

```sh
python3 suite.py run --packets runs/frozen/packets.json --out runs/jev.json \
  --provider jev --model jev-1.14.0
python3 suite.py run --packets runs/frozen/packets.json --out runs/opus.json \
  --provider opus --model claude-opus-5-5
python3 suite.py compare --key runs/frozen/key.json --a runs/jev.json --b runs/opus.json \
  --threshold 0.90 > runs/comparison.json
```

Each invocation of `run` requests one decision per case. A full paired run on the bundled corpora makes 102 case submissions before retries. A successful case is checkpointed. Running the same arm again resumes. After a failure or interruption, inspect the receipt and use `--retry-failed` to retry explicitly. An interrupted call may already have incurred usage. Give a changed model, executable or adapter configuration a new result file. Set `--adapter-revision` to distinguish changes behind an unchanged endpoint or launcher.

## Use another model

For a model served by OpenRouter Decisions, set `OPENROUTER_API_KEY` and use its canonical model ID. The adapter passes the same evidence and three choices to the hosted model. Its receipt records the winning probability where supplied, native token counts and reported USD cost. Models that return only a choice receive a direct accuracy score and always escalate in the confidence simulation. Choose another model from the [decision catalog](https://openrouter.ai/api/v1/models?output_modalities=decisions).

```sh
python3 suite.py run --packets runs/frozen/packets.json --out runs/jev-openrouter.json \
  --provider openrouter-decisions --model typesafe/jev-1.14-20261014
python3 suite.py compare --key runs/frozen/key.json --a runs/jev-openrouter.json --b runs/opus.json
```

For an LLM with a Chat Completions endpoint, use the included adapter. Run the command from this directory and replace the endpoint and exact model ID with those served by your provider. For an authenticated endpoint, set `DECISION_CHAT_API_KEY` in the environment. The CLI accepts an argument vector encoded as JSON and runs the adapter in a fresh temporary directory.

```sh
adapter=$(python3 -c 'import json, pathlib, sys; print(json.dumps([sys.executable, str(pathlib.Path("chat_adapter.py").resolve()), "--endpoint", "http://127.0.0.1:8080/v1/chat/completions"]))')
python3 suite.py run --packets runs/frozen/packets.json --out runs/other.json \
  --provider external --model model-version --command "$adapter"
python3 suite.py compare --key runs/frozen/key.json --a runs/other.json --b runs/opus.json
```

For another typed decision API or LLM harness, supply an executable with the same external protocol. One invocation receives one JSON object on stdin. `packet` contains exactly `question`, `options` (three label-to-definition mappings), `claim`, and `evidence` (ordered `id` and `text` pairs).

```text
stdin   {"protocol":1,"model":"model-version","packet":{...}}
stdout  {"model":"model-version","label":"insufficient","confidence":null,"usage":{"requests":1}}
```

Return the model identity from the provider receipt where available. Use null for unavailable confidence. A typed model can return its winning probability as `confidence` and its full label-to-probability mapping as `probabilities`. Keep usage counters in the provider's native units, omit unavailable fields, and pass credentials in the environment. A protocol or provider error should exit nonzero. An `insufficient` response means the model judged the evidence. A failed call has no verdict. Trusted adapters receive no case IDs, groups, split, labels or grading rationales outside the question's answer options. An executable with filesystem access must itself enforce any model/tool isolation.

## Read the comparison

- **False clearance** means predicting `supported` for a contradicted or insufficient claim. The report gives both the fraction of unproved claims cleared and the fraction of clearances that were wrong. A null rate means its denominator was zero.
- **Paired quality** includes each arm's confusion matrix, the cases only one arm got right, disagreement IDs and multiclass Brier score on cases with full probabilities. Calibration and holdout are reported separately, with separate panels for historical and synthetic cases.
- **Fallback** is simulated in both directions. The first model handles a case if it selects a substantive label and reaches the supplied confidence threshold. Otherwise the scorer uses the other model's recorded answer. A model that supplies no confidence still receives a full direct comparison and always escalates under this simulation. Use `compare --split calibration` while choosing the threshold. Freeze it before running `compare --split holdout`. The default 0.90 is illustrative.
- **Economics** includes each arm's observed usage counters, their coverage and attempt counts. Tokens, cache and latency can differ by provider. The simulated fraction of Opus calls avoided applies to this decision in isolation. An end-to-end saving also requires the parent workflow to skip the corresponding turn. This suite provides no production-frequency or monthly billing estimate.

To add a local corpus, pass another JSON list to `prepare`. Each case needs a unique `id`, a `group` shared by related cases, a `claim`, an `evidence` list, an `expected` label, and a `basis` an independent reviewer can check. Use the same group name for related cases in different files. Keep all raw provider output and private corpora outside commits.
