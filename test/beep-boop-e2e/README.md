# Beep-boop end-to-end tests

Each command installs the selected plugin revision into a fresh Claude Code home and invokes `/faff:faff-beep-boop` once. Both scenarios exercise queue discovery, prep, graft, PR creation, merge, same-run scope discovery, and convergence against a disposable tracker MCP server and local Git forge. Use a Claude worker with Python 3.9+, Git, Node, npm, Claude Code, and an exported `CLAUDE_CODE_OAUTH_TOKEN`. Live invocations use the model subscription and have a two-hour timeout per run.

From the repository root:

```sh
python3 test/beep-boop-e2e/waves.py sequential
python3 test/beep-boop-e2e/waves.py parallel
```

The sequential fixture seeds four tickets. KIT-18 depends on KIT-17, and KIT-19 depends on a human-only decision. Building KIT-17 exposes a batch-normalization bug that should become KIT-21 and land during the same run. The parallel fixture adds three independent tickets and sets a cap of three grafts. The scorer checks the merged behaviour on Git objects, the prerequisite merge before dependent dispatch, the human block, and tracker claim overlap. Sequential expects one active claim and parallel expects two or three. Claim overlap measures implementation through handoff. It does not prove immediate slot refill, optimum wave membership, or continuous worker activity.

Both commands default to the current committed HEAD. Use `--ref TAG_OR_SHA` to compare a release, `--model MODEL` to choose a Claude model, or `--output NEW_DIRECTORY` for a particular artifact location. Each run prints its directory. By default, the fixture repo, Git objects, tracker and forge receipts, and model trace live under the gitignored `runs/` directory beside the harness. `workflow.json` holds the scenario verdict and `score.json` contains supporting observations, including diagnostic checks for alternative scheduling orders. A failing workflow returns a nonzero exit status.

Run the fixture/scorer tests or re-score an existing run without starting Claude:

```sh
python3 -m unittest discover -s test/beep-boop-e2e
python3 test/beep-boop-e2e/wave_outcome.py parallel /path/to/run
```
