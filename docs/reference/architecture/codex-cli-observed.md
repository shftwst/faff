# Codex CLI — what was actually observed

**codex-cli 0.145.0**, macOS 14.1.2 arm64, ChatGPT seat auth. Observed 2026-07-28 under FAFF-665.

For the current product judgement, see [Harness support](../../guide/harness-support.md). This page preserves the dated observation and should not be read as a current support promise.

This page exists because three committed documents reasoned at length about codex's behaviour without anyone having run it — `docs/reference/architecture/harness-coupling.md`, ADR-0090, and FAFF-593's spec, which recorded in its own assumptions that `--sandbox` was *"a shared option not directly sighted in the excerpt"*. Everything below was seen, not inferred.

**Cite this page as a repo path when a document needs a Codex-side source.** It is a dated snapshot of one version, not a contract — codex will move, and a claim sourced here carries the version it was true for.

## Permission surface

Two orthogonal axes, not one switch. There is **no `--full-auto` flag** in this version, on either `codex` or `codex exec`.

| Axis | Flag | Values |
|---|---|---|
| Approval policy | `-a, --ask-for-approval` | `untrusted`, `on-request`, `never` |
| Sandbox mode | `-s, --sandbox` | `read-only`, `workspace-write`, `danger-full-access` |

Also `--dangerously-bypass-approvals-and-sandbox` (skip both) and `--dangerously-bypass-hook-trust` — codex has a hook system with persisted trust.

`codex doctor` reports the two as separate dimensions in its own state (`restricted fs + restricted network · approval OnRequest`), so the single `--sandbox` value is the CLI's presentation rather than the underlying model. The mechanism is per-platform: an `execve wrapper helper` on macOS, a `linux helper` slot (`none` on this host) elsewhere.

**Permissions are the cage's to grant, not faff's to configure.** This page records what a cage can permit so an operator can build one; it is not a mapping table for faff to consume. See ADR-0010.

## Flags `buildCodexArgv` relies on

All present and behaving as assumed:

| Flag | Observed meaning |
|---|---|
| `--json` | Print events to stdout as JSONL |
| `--ephemeral` | Run without persisting session files to disk |
| `--skip-git-repo-check` | Allow running outside a Git repository |
| `-m, --model` | Model the agent should use |
| `-` (prompt arg) | Instructions read from stdin |

## Event stream

### A read-only producer call

`codex exec --json --ephemeral --skip-git-repo-check --sandbox read-only -m <model> -`, prompt `Reply with exactly the word: PONG`. Exit 0, clean stderr.

```
{"type":"thread.started","thread_id":"019fa991-…"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}
{"type":"turn.completed","usage":{"input_tokens":14775,"cached_input_tokens":12032,"cache_write_input_tokens":0,"output_tokens":6,"reasoning_output_tokens":0}}
```

### A write-capable call that used tools

`codex exec --json --sandbox workspace-write -m <model> -` in a fresh `git init` repo, prompt asking it to create a file. Exit 0, file created.

```
{"type":"thread.started","thread_id":"019fa9eb-…"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I'll create the requested file…"}}
{"type":"item.started","item":{"id":"item_1","type":"file_change","changes":[{"path":"…/hello.txt","kind":"add"}],"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"file_change","changes":[{"path":"…/hello.txt","kind":"add"}],"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Created hello.txt."}}
{"type":"turn.completed","usage":{"input_tokens":32104,"cached_input_tokens":28160,"cache_write_input_tokens":0,"output_tokens":96,"reasoning_output_tokens":0}}
```

Three things a single-message capture cannot show, all of which this one does:

- **A working turn emits more than one `agent_message`.** Taking the *last* is what gives the answer rather than the preamble — `parseCodexEvents` does, and returned `"Created hello.txt."` against this stream.
- **`item.started` exists** as a distinct event type, and items carry a `status` that transitions `in_progress` → `completed`.
- **`file_change` items report edits as structured data** — a `changes[]` array of `{path, kind}` — rather than leaving a caller to diff the tree.

## Token usage

`turn.completed.usage` carries five fields:

```
input_tokens, cached_input_tokens, cache_write_input_tokens,
output_tokens, reasoning_output_tokens
```

`sumCodexUsage` reads three of them and subtracts `cached_input_tokens` out of `input_tokens`. Verified against both captures: `14775 − 12032 = 2743` and `32104 − 28160 = 3944`.

`cache_write_input_tokens` and `reasoning_output_tokens` are **not read anywhere in faff**, and were `0` in both observations — including the 32k-input tool-using turn. So whether they are additive or already inside the fields faff reads is **undetermined**; nothing here settles it. FAFF-666 owns that question.

**A codex call carries a substantial fixed input cost.** A two-line prompt cost 14,775 input tokens, of which 12,032 were cached — so roughly 2,700 fresh tokens of codex's own preamble before any user content. Budget and economics should expect that floor per call.

## Auth and state

`CODEX_HOME` (default `~/.codex`) is the analogue of `CLAUDE_CONFIG_DIR`, and holds:

- `auth.json` — auth storage mode `File`, ChatGPT tokens stored, no API key. The seat is a **file-based token at a known path**, not an environment variable.
- Four SQLite databases: state, logs, goals, memories.
- Rollout files (session records).

`codex login status` exits `0` when logged in — the contract `engine-codex.js`'s seat probe assumes.

**Per-repetition isolation therefore means isolating `CODEX_HOME`**, and the credential rule that rides it is the same one `eval/cli-driver.mjs` enforces on the Claude side: never copy a provider credential into a run whose endpoint belongs to a different provider.

## Skill loading

Codex auto-loads skills, and it reads **both** `~/.agents/skills/` and `~/.codex/skills/`. Neither location appears in `codex --help`, `codex exec --help`, or `config.toml` — the same way `AGENTS.md` is read with no flag and no help entry — so this was established by observation rather than by reading the interface.

**The probe.** Two skills were planted, one per candidate directory, each described only as *"Use when the user says the word plugh."* The prompt was the single word `plugh` — no skill names, no paths, nothing to search for. The reply:

> I'm using the `grue` and `zork` skills because "plugh" explicitly triggers both. I'll read their instructions, then follow them in order.

It named both skills and their trigger condition from nothing but the trigger word. That can only come from pre-loaded skill metadata: the progressive-disclosure model, where name and description sit in context and the body is fetched on activation. The `sed` that followed is the body fetch, and it happened *after* identification.

**A probe that names the skill proves nothing.** An earlier attempt put the skill names in the prompt. The agent read both files with a shell command and returned a codeword, which demonstrates only that a model can `cat` a file it was told about. Any future re-probe must withhold the names.

**Why this matters to faff.** At the time of observation, `scripts/link-skills.sh --global` installed into `~/.claude/skills` alone, so a globally installed faff was invisible to codex. FAFF-672 and FAFF-676 later updated the installer and `faff doctor`; repo-local and marketplace visibility gaps remain. Both changes rest on this observation.

`docs/reference/architecture/harness-coupling.md` classifies the skills seam `portable` on the strength of the Agent Skills open standard. That is true of the **artifact** — a `SKILL.md` needs no change to be read by another harness — and silent on the **install location**, which is per-harness and is where the work actually is.

## Per-project trust

`~/.codex/config.toml` carries a per-project trust model keyed by absolute path:

```toml
[projects."/path/to/repo"]
trust_level = "trusted"
```

Observed: a `workspace-write` run in a **fresh, unregistered** temp path succeeded and wrote its file, so this did not gate `codex exec` with an explicit sandbox. What it governs beyond that is unobserved.

## Capabilities not exercised, worth knowing about

- `-o, --output-last-message <FILE>` — writes the agent's final message straight to a file. That is what `parseCodexEvents` reconstructs from the stream, so it is a more robust path to the same value.
- `--output-schema <FILE>` — a JSON Schema constraining the model's final response.
- `-C, --cd <DIR>` and `--add-dir <DIR>` — working root, and additional writable directories.
- `--ignore-user-config` — skips `config.toml`; auth still uses `CODEX_HOME`.
- `codex mcp` manages external MCP servers; `codex mcp-server` runs codex *as* an MCP server over stdio.
- `codex sandbox` runs arbitrary commands inside a codex-provided sandbox.
- `codex doctor` diagnoses installation, config, auth and runtime health.
- `codex apply` applies the agent's latest diff via `git apply`.
- `codex exec resume` / `fork`, and an experimental `exec-server` / `app-server` daemon with a control socket.
- `--oss` with `--local-provider` (lmstudio, ollama).

Unresolved: `codex doctor` reported one active rollout with source `exec` despite the run passing `--ephemeral` ("run without persisting session files to disk"). It may have been from an earlier interactive session; not established either way.

## Wire protocol

`codex doctor` reports `wire API: responses` — codex speaks OpenAI's Responses API. faff's existing openai-compatible HTTP engine family is **not** a drop-in substitute for the spawn path.
