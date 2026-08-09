# FAFF-657 — Take the two GitHub-hosted readings with the committed probe

> Spec: faffter-dark-nlspec · 2026-07-27 · interactive · confidence: medium. Refreshed 2026-08-02 (in place, prep). Full spec on Linear FAFF-657.

> **Refreshed 2026-08-02 (interactive, in place).** The readings are now taken and the blocker (FAFF-664) is merged and live-verified, so the sections below that describe *dispatching* the probe are now historical context. Three things change; everything else in the spec stands, and its instruction to re-derive every count from `probe.sh` (never from a list) holds in full.
>
> **1. The readings are taken — the remaining work is assembly, not dispatch.** Both shapes were dispatched against `main` on 2026-08-02 and the artifacts downloaded:
> - `hosted-container` — Actions run 30768490911, image `buildpack-deps@sha256:877e9e4d949edfbcbedabc3a2d7ab593955fee5d6d0777adf3a991eb30c750d8`, bundle complete at 3/3.
> - `hosted-direct` — run 30768797917, bundle complete at 4/4, self-test **euid 1001, 11 passed, 0 skipped, 0 failed** (the non-root, zero-skipped reading the acceptance owes).
>
> Both carry `probe_sha256 40166f33ba093cf0f1d95a3d4ca311a7435f46647d3827e807eaeac7bbb052b7`, byte-identical to the committed `probe.sh`. The attempts-ledger starting point is those two runs plus the earlier `job-surface-probe` runs named in FAFF-664 — including the `debian:bookworm-slim` dispatches that failed the tool-presence check because git is absent (the image finding, confirmed again live). The seven files are staged verbatim on branch `faff-664-probe-transcripts`, to be committed at the path in point 3.
>
> **2. `resolve_digest` step 4 is narrowed — never commit the token or the egress IP.** Step 4b as written ("their complete output, including the response headers") would write an anonymous bearer token and the resolving machine's public egress IP (`docker-ratelimit-source`) into a permanently public file. Neither adds to checkability — the digest is content-addressed. Record only: (a) both commands exactly as run; (b) the resolved digest; (c) the manifest content-type; (d) the UTC timestamp; (e) the by-digest re-verification command. Name the anonymous token and the `docker-ratelimit-source` address as **deliberately withheld**, not silently dropped. This supersedes step 4b for every provenance note. (The digest is already resolved, so this bears on how RESULTS.md records it, not on a fresh resolution.)
>
> **3. Commit path is `records/spikes/2026-07-26-FAFF-654/`** — alongside `probe.sh` and `RESULTS.md`, per the acceptance. The transcripts currently on branch `faff-664-probe-transcripts` under `records/spikes/2026-08-02-FAFF-664/` are to be re-committed verbatim at the FAFF-654 path; the FAFF-664-dir copy was a holding spot and is superseded.
>
> **Still open, unchanged by this refresh:** the spec-review gate never returned `approve` (recorded separately, human-overridden); the build proceeds under that same override. `RESULTS.md` must still carry the observation table, `columns_identical`, `worktree_changed_by_checkout` per column (both shapes used real git — no REST fallback), the `unobtained` lines, and the `unreadable(open-failed)` / `unreadable(read-failed)` cases recorded as **not observed this run** (POSIX sh has no fixture for either — both self-tests say so), with `unreadable(not-readable-by-euid)` demonstrated by the hosted-direct euid-1001 self-test. Cite `env-rootless` alongside the `hosted-direct` column. The form constraint (no mechanism recommended) and the advisory word-list check both hold. Re-derive `exceptions_are_complete` from `probe.sh` — seven emit sites, not five (FAFF-661).

This spec is for the build agent that dispatches the FAFF-654 probe, collects what it read, and commits that as a findings record. It is also for the human reviewing that commit. The instrument is merged and unchanged; everything below is about dispatching it honestly and writing down what came back.

## 1. WHY — problem and principles

**The load-bearing model: this ticket produces a record, and a record's only value is that its contents were observed.** Every mechanism here exists to keep a green job from producing a confident, wrong artifact. A workflow that succeeds while measuring nothing is the specific failure this work has to avoid, because the resulting file is permanently public, is cited by FAFF-646, and looks identical to a real one.

**Problem.** `job-surface-probe` is on the default branch (workflow ID 321180550) with zero runs, and `RESULTS.md` carries `observation_table: empty` with every reading cell absent. Nobody knows what a GitHub-hosted Actions job exposes, and the ADR that decides what bounds a faff run on a CI runner has no measurements under it. This ticket dispatches the instrument twice, commits the bytes it produced, and fills the record.

### Design principles

**A green job is not evidence.** The workflow exits zero on almost everything: the probe exits zero unconditionally by design, the tool-presence check prints `(absent)` without failing, and `actions/checkout@v4` falls back to a REST tarball when git is missing. Every acceptance criterion in this spec is written so that it could not be satisfied by a run that measured nothing. If a criterion could be met by a green job with an empty or fabricated reading, it is the wrong criterion. **A criterion that reduces to "the string X does not appear" fails this test on its own** — an empty file satisfies it — so every such criterion here also asserts what the file must contain.

**The committed bytes are the job's bytes.** Downloaded artifact files are committed with no retyping, no reflowing, no whitespace tidying, no filename changes. Any file that did not come out of the artifact bundle is labelled as such and its origin stated.

**The record states what was observed and nothing else.** No line concludes anything about whether a mechanism is safe, sufficient, or recommended. FAFF-646 draws the conclusions. The form constraint FAFF-654 defined does most of this mechanically; the `notes` field is the one free-prose class and gets read by eye.

**Credential reachability, and content only through seven content-emitting sites.** The probe records metadata plus an open-for-read result, and emits **no digest of any measured file, ever** — a truncated digest of a constrained-format credential file is a content oracle against a permanently public artifact. It does emit bytes obtained from measured files, and the complete set is **seven** sites, derived by enumerating every continuation-block emitter and every verbatim-value emit in `probe.sh` rather than by reading `RESULTS.md`'s list:

| # | Site | What it emits | Where in the instrument | In FAFF-654's list? |
|---|---|---|---|---|
| 1 | The mount table | every line of `/proc/self/mounts`, verbatim | `probe.sh:334` | yes — `exception_1` |
| 2 | The pid-1 environ key names | names only, never values, under `names` mode | `probe.sh:398-403` | yes — `exception_2` |
| 3 | The pid-1 `container` value | the value of that one variable, **in full** | `probe.sh:405-406` | yes — `exception_3` |
| 4 | Long-listing lines, including `workdir.listing` and `home.entries` | mode, numeric uid and gid, size, name | `probe.sh:59`, `:453`, `:467` | yes — `exception_4` |
| 5 | `faff container-check` stdout | JSON and plain, when a `faff` binary is on PATH | `probe.sh:513-519` | yes — `exception_5` |
| 6 | The pid-1 cgroup file | every line of `/proc/1/cgroup`, verbatim | `probe.sh:420`, classified at `:417` | **no** |
| 7 | The pid-1 comm file | every line of `/proc/1/comm`, verbatim | `probe.sh:424`, classified at `:422` | **no** |

**Sites 6 and 7 are not in `RESULTS.md`'s exception list, and its `exceptions_are_complete` line is therefore false as merged.** Both files are world-readable on any Linux, so both blocks print on every run of every shape — there is no configuration under which a transcript lacks them. Neither is high-value (`/proc/1/comm` is a process name; `/proc/1/cgroup` is a cgroup path that may carry a container ID), and that is not why this matters. It matters because a record whose defence rests on an enumerated guarantee must not state a guarantee its own instrument breaks, and FAFF-646 will cite that file. This is FAFF-654's error as merged, not one this ticket introduces — but this ticket is the one that fills the file, so it is recorded here and filed as FAFF-661 rather than quietly patched in passing. **Every bound this spec states is seven, not five**, and the by-eye read below covers all seven.

**Site 3 is the one this ticket has to plan around, because no dispatch input suppresses it.** The mode branch at `probe.sh:399-404` closes before the `container=` extraction at `405-406`, so `environ_keys: count` withholds the key *names* and leaves that *value* printed in full. `/proc/1/environ` is itself classified at `probe.sh:396`, so the value is content from a measured file by any reading — and by the same test, so are sites 6 and 7. Any statement in this spec that the probe emits no values would be false, and the by-eye pre-commit read covers all seven sites rather than the key-name block alone, plus three environment-value sites that are not file bytes at all.

**How the seven were found, because the method is the point.** Every continuation-block emitter in the instrument is either a `printf '  | %s\n'` loop or a pipe into `emit_block` (`probe.sh:40-44`). There are seven such call sites — `:334`, `:403`, `:420`, `:424`, `:453`, `:467`, `:519` — plus the one verbatim-value emit at `:405-406`. Sites 4 collapses two of those loops (`:453`, `:467`) because both are `ls` output under one exception. Two earlier drafts of this spec bounded the guarantee at five by reading `RESULTS.md`'s list instead of the instrument, and both were wrong in the same direction. Anyone checking this table should re-run the enumeration, not re-read the list.

**Attempts are part of the record.** A record showing only the run that worked is a different artifact from one that states its attempts. If more than one dispatch happens, all of them are named.

### Reference context

| File | What it is | Relevance |
|---|---|---|
| `records/spikes/2026-07-26-FAFF-654/probe.sh` | POSIX sh, 561 lines | The instrument. Merged at a53e995. Not in scope to change. |
| `records/spikes/2026-07-26-FAFF-654/RESULTS.md` | Findings record, 129 lines | The scaffold this ticket fills. Its `exception_1` … `exception_5` lines cover five of the seven sites above; its `exceptions_are_complete` line is false by sites 6 and 7. |
| `.github/workflows/job-surface-probe.yml` | Dispatch-only workflow | Two jobs, gated on the `shape` input. Not in scope to change. |
| `records/specs/2026-07-26-FAFF-654-…-design.md` | FAFF-654's design spec | Authors the value grammar, the form constraint (line 419) and its acceptance item (line 591), and the caption template. The amendment below names it explicitly. |
| `plugin/skills/faff/bin/lib/config.js` lines 859-880 | Credential-scan constants | Module-private, so they cannot be imported. The pre-commit scan reads them from here at scan time; this spec holds no copy. |
| `.github/workflows/validate.yml` line 299, `env-rootless` | An existing green job | Independently corroborates part of the `hosted-direct` column. |

**Scope.** This is the measurement half of FAFF-654's original scope, split out because a `workflow_dispatch` workflow does not fire until its file is on the default branch. FAFF-656 owns the two self-hosted columns with the same instrument.

## 2. OUT OF SCOPE

- **Changing `job-surface-probe.yml`.** Excluded for the reason that split this ticket out of FAFF-654 in the first place. A dispatch-only workflow has to be registered on the default branch before it can be dispatched at all; once registered, a run *can* select a different ref and use that ref's copy of the file, so a branch edit is not literally unrunnable. But a reading taken that way came from a workflow that is not on `main` and that the same PR is still free to change in review — which reproduces exactly the loop FAFF-654 got stuck in, a merge floor resting on a reading taken with an instrument the same change is still moving. Extension point: `.github/workflows/job-surface-probe.yml`, in a ticket that merges before its reading is taken.
- **Changing `probe.sh`.** Excluded for a different reason: `probe_sha256` is what proves a transcript came from the committed instrument, and FAFF-656 takes its two columns with the same one. Changing it mid-measurement makes the columns incomparable for a reason nothing in the record would show. Extension point: a new ticket against `probe.sh` with `PROBE_VERSION` incremented.
- **Making the tool-presence check fail the job.** A real defect (see the decision below), but the fix is a workflow edit and inherits the reason above. Extension point: `.github/workflows/job-surface-probe.yml`, the `Tool presence check` step in `hosted-container`.
- **Correcting `RESULTS.md`'s `exceptions_are_complete` line from five sites to seven.** The line is false as merged (sites 6 and 7 of the section-1 table, `probe.sh:420` and `:424`). It is filed as **FAFF-661** rather than fixed in passing here, because it corrects a structural guarantee FAFF-654 authored and FAFF-646 will cite, and a correction to a merged claim deserves its own review rather than riding inside a set of readings. This spec states the true bound of seven everywhere it asserts one, and the record this ticket writes cites FAFF-661 beside the exception list so a reader is not left with the false count. The two can land in either order; whichever is second reconciles against the first. Extension point: `records/spikes/2026-07-26-FAFF-654/RESULTS.md`, the `Structural guarantee` section.
- **Giving the probe a way to suppress the pid-1 `container` value.** Named as exception 3 above. The unmodified instrument has no such path, and adding one is a `probe.sh` edit. Extension point: `probe.sh:405-406`, folded into the `environ_keys` mode branch.
- **Running the job container as a non-root user.** The workflow's `container:` key carries `image:` only, with no `options:`, so the container's euid is whatever the image's default `USER` is. FAFF-654's failure-modes section already settled the posture: an euid-0 container column is not a defect, the two columns are not comparable on the permission axis, and the record carries the euid on every column so a reader sees it before the rows.
- **The self-hosted columns.** Owned by FAFF-656. `RESULTS.md` keeps their `owned_by` lines untouched.
- **`actions_runner_controller`.** Needs a cluster and a controller install. It stays `unmeasured` with its existing reason, and is FAFF-654's carried punt.
- **Any conclusion about what faff should do with these readings.** Owned by FAFF-646.

## 3. WHAT — vocabulary, artifacts, and the record's shape

### Vocabulary

| Term | Meaning here |
|---|---|
| Shape | One of the four measured environments. This ticket takes `hosted-direct` and `hosted-container`. |
| Column | One transcript's worth of readings in the observation table. Three columns here — `hosted-direct-after-removal` is a second reading on the `hosted-direct` shape, not a fifth shape. |
| Value grammar | The six tokens the probe emits: `present(…)`, `absent`, `unreadable(…)`, `undecidable(…)`, `impossible_on_shape(…)`, `unmeasurable_here(…)`. |
| Key line | A transcript line whose first character is not a space. Its key is the text before the first colon-space. |
| Continuation line | A transcript line beginning with two spaces and a pipe. Never a key. |
| Attempt | One dispatch of `job-surface-probe`, whether or not its transcript is committed. |

### Files this ticket commits

All into `records/spikes/2026-07-26-FAFF-654/`, flat.

```
RECORD artifact_files:                        # byte-copies from the artifact bundles
  precheckout-hosted-direct.txt
  selftest-hosted-direct.txt
  hosted-direct.txt
  hosted-direct-after-removal.txt
  precheckout-hosted-container.txt
  selftest-hosted-container.txt
  hosted-container.txt

RECORD log_derived_files:                     # extracted from the run log, not uploaded
  toolcheck-hosted-container-<image-slug>.txt   # one per hosted-container attempt
  checkout-hosted-container-<image-slug>.txt    # one per hosted-container attempt
  checkout-hosted-direct.txt                    # one, from the hosted-direct run
    # <image-slug> is the image reference with / : @ replaced by -, digest truncated
    # to the first 12 hex characters. Names by image, never by attempt number.

  CONSTRAINT every log_derived_file carries a header naming its origin
  CONSTRAINT no file is edited after download or extraction
```

### The observation table

The table `RESULTS.md` currently records as `empty`.

```
Caption (matches FAFF-654's fixed template exactly):
  Table: observations — 40 signals — shapes: hosted-direct, hosted-direct-after-removal, hosted-container

Columns:  | signal | hosted-direct | hosted-direct-after-removal | hosted-container |
Rows:     the 41 signals of the signal-roster table, in roster order,
          minus attest.writable_is_a_proxy  ->  40 rows
```

**Row set.** Exactly the roster, in roster order, so the two tables read against each other line by line. One exclusion: `attest.writable_is_a_proxy` (`probe.sh:380`), whose value is a fixed caveat sentence the probe emits identically on every shape. It is not a reading, and a sentence is precisely what the form constraint bans from a cell. Its exclusion is stated as its own column-status line so it is not silently dropped.

**Cell rule.** Each cell carries that key's value from that column's transcript, verbatim, with no truncation and no tidying. For a key whose value is followed by a continuation block (`mounts.table`, `containment.proc1.environ_keys`, `containment.proc1.cgroup`, `containment.proc1.comm`, `workdir.listing`, `home.entries`, `crosscheck.container_check_plain`), the cell carries the key line's value only — `present(37 lines)` and so on — and the block stays in the transcript, which is the authority.

### Cell vocabulary, derived by enumerating the emit sites

FAFF-654's design spec (line 419) constrains every observation-table cell to a value-grammar token, a signal name, a shape name, or the literal `non-decisive`. That constraint does not cover everything `probe.sh` actually emits, so the closed vocabulary below is derived **by walking every `emit` call in `probe.sh` for all 40 tabulated roster keys, across all three columns** — not by inspecting one class of key and generalising. The next person checks it the same way: list the `emit` sites, group them by the shape of the value each can produce, and confirm nothing falls outside the list.

| Value shape a cell can carry | Roster signals that produce it | Emit sites |
|---|---|---|
| The six grammar tokens, detail verbatim | 27 signals | throughout |
| The literal `yes` or `no` | 11 — the four sub-keys on each canonical socket (`.is_socket`, `._dangling_symlink`, `.readable`, `.writable`), plus `attest.canonical_socket_present`, `attest.canonical_socket_writable_by_euid`, `attest.rootless_socket_present` | `probe.sh:344-350`, `346` via `dangling_symlink`, `374`, `379`, `385` |
| The literal `non-decisive` | 1 — `containment.proc1.cgroup.decisiveness` | `probe.sh:418` |
| The literal `same-job` | 1 — `socket_removal.kind`, on the after-removal column only; the other columns carry `unmeasurable_here(…)` there | `probe.sh:479` |
| A fixed caveat sentence | 1 — `attest.writable_is_a_proxy`, **excluded from the table** | `probe.sh:380` |

**The closed cell vocabulary is therefore: the six grammar tokens with their details verbatim, plus the literals `yes`, `no`, `non-decisive`, and `same-job`.** Nothing else appears at any emit site for any tabulated key.

**The amendment, and where it is recorded.** `yes`, `no`, and `same-job` are additions to the constraint as FAFF-654's design spec states it. `RESULTS.md` records them as an explicit amendment naming the amended document and line — `records/specs/2026-07-26-FAFF-654-…-design.md`, the form constraint at line 419 and its acceptance item at line 591 — the twelve signals the amendment affects (eleven carrying `yes`/`no`, one carrying `same-job`; the already-admitted `non-decisive` signal is not among them), the enumeration method above, and the reason. A back-reference is filed into that design spec as discovered scope, so a reader arriving from the authoring document is not left with an unqualified constraint the artifact no longer satisfies. FAFF-646 may cite either document, which is why the pointer has to run both ways.

### `RESULTS.md` fields this ticket must change

| Field | From | To |
|---|---|---|
| `observation_table` | `empty — no shape obtained yet…` | a statement that it is filled, with the row count and the one exclusion |
| `hosted-direct` | `unobtained — owned_by FAFF-657` | the run identifier and the committed transcript filename |
| `hosted-container` | `unobtained — owned_by FAFF-657` | same |
| `hosted-direct-after-removal` | `unobtained — owned_by FAFF-657` | same |
| `columns_identical` | `unobtained` | `yes` or `no`, plus the divergence detail on `no` |
| `worktree_changed_by_checkout.hosted-direct` | `unobtained` | `yes` or `no` |
| `worktree_changed_by_checkout.hosted-container` | `unobtained` | `yes` or `no` |
| `unfixturable.open-failed.observed` | `not yet observed…` | the transcript and key, or a statement that it was not observed in this run |
| `unfixturable.read-failed.observed` | `not yet observed…` | same |
| The four `NOT YET SATISFIED` operator attestations | future tense | satisfied, with the evidence pasted in |
| The `env-rootless` note | `When the hosted-direct column is filled…` | present tense, with the citation made |

`selfhosted-direct`, `selfhosted-container`, and `actions_runner_controller` are not touched.

## 4. HOW — behaviour

### The overall path

```
PROCEDURE take_the_readings:
  1. Resolve the image digest and attest the resolution
  2. Dispatch hosted-container on the digest-pinned stock minimal image
  3. Read the tool-presence and checkout-method captures; if the toolset is
     short, pick a replacement image and dispatch again
  4. Dispatch hosted-direct
  5. Download both artifact bundles; extract the log-derived captures
  6. Run the pre-commit checks over every file
  7. Commit the files by explicit path
  8. Derive the table and the status fields; update RESULTS.md; commit
```

The containerised shape goes first because `env-rootless` already corroborates part of the direct column, and no workflow in this repository has ever declared a job-level container key. If the day runs short, the container reading is the one to keep.

### Step 1 — resolve the image digest

The `image` dispatch input defaults to the bare tag `debian:bookworm-slim`, which is runnable but not reproducible. A digest-pinned reference is required for any reading that enters the record. There is no Docker daemon guaranteed on the machine running this, so the resolution goes through the registry's own HTTP API.

```
PROCEDURE resolve_digest(repository, tag):
  1. Obtain an anonymous pull token from auth.docker.io for
     scope repository:library/<repository>:pull
  2. Request the manifest for <tag> from registry-1.docker.io, sending Accept
     headers for both the OCI image index and the Docker manifest-list media types
  3. Read the Docker-Content-Digest response header — this is the multi-arch
     index digest, which is what the runner should be pinned to so it can still
     select its own architecture
  4. Record VERBATIM into the RESULTS.md notes:
     a. both commands exactly as run
     b. their complete output, including the response headers
     c. the UTC timestamp of the resolution
     d. the re-verification command a later reader runs: the same manifest
        request with the DIGEST in place of the tag, which returns the same
        bytes for as long as the manifest exists
  5. Pass <repository>@<digest> as the workflow's image input
```

**What makes this checkable later, stated without overclaiming.** Re-running the tag lookup next year answers a different question, because tags move. Two things carry the weight: the digest is content-addressed, so requesting it by digest either returns the same manifest or fails, with nothing in between; and the run log's `Initialize containers` step reports the digest of the image the runner actually pulled.

There are **two** independent sources here, not three. The transcript's `container_image` line is not a third: `job-surface-probe.yml:201` passes the dispatch input straight through as `PROBE_CONTAINER_IMAGE` and `probe.sh:315` echoes it unchanged, so that line is a copy of the string the local resolution produced. It is still worth checking, because it catches a dispatch that silently used the tag default — but it is evidence about what was *asked for*, not about what was *pulled*, and the record says so. A record whose thesis is checkable provenance must not overstate its own.

**Anti-pattern:** pasting only the digest into the notes. Why: a digest with no stated origin is a number nobody can check, which is the reason the requirement exists.

**Anti-pattern:** describing the transcript's `container_image` line as independent corroboration. Why: it is a passthrough of the input, so agreeing with the input is the only thing it can do.

### Step 2 and 3 — the image, the tool check, and the checkout method

The `hosted-container` job checks 23 tools before checkout: `sh ls id cksum dd mktemp wc tr cut sed sort head grep date uname dirname cat chmod mkdir ln rm git tar`. The step prints `(absent)` for a missing tool and does not exit non-zero, so a short result does not fail the job — it proceeds to `actions/checkout@v4`, which without git falls back to a REST tarball download.

**The criterion for the image:** every one of the 23 tools resolves to a path, and the image is glibc-based, because `actions/checkout` injects its own Node runtime. `git` in particular is not a nicety — its absence changes the *checkout mechanism*, so the container column's work-directory listing would be the result of a tarball extraction while the direct column's is the result of a clone. That would make `columns_identical` and both `worktree_changed_by_checkout` fields answers to two different questions.

**The procedure is measured, not assumed.** `git` is Priority: optional in Debian and is quite likely absent from a stock `debian:bookworm-slim`, but "quite likely" is not a reading. So the first `hosted-container` dispatch goes out on the digest-pinned `debian:bookworm-slim` precisely to obtain the tool-presence evidence for the stock minimal image, and the outcome decides the rest:

```
PROCEDURE choose_image:
  1. Dispatch hosted-container with debian@<resolved-digest>
  2. Extract the Tool presence check output and the checkout step's output
     from the run log (see the capture procedure below)
  3. IF the tool capture carries 23 lines, one per declared tool in the
     workflow's declared order, and every one resolves to a path:
     a. This attempt's transcript is the committed hosted-container column
     b. The record states the image and that the check came back complete
  4. OTHERWISE — any (absent) line, any missing line, any short capture:
     a. Do NOT weaken the check and do NOT accept the transcript
     b. Choose a replacement on the criterion above; buildpack-deps:bookworm-scm
        is the leading candidate — an official Docker Hub image, glibc-based,
        carrying the SCM toolchain including git on a Debian bookworm base
     c. Resolve its digest by the same procedure and attest it the same way
     d. Dispatch again; its transcript is the committed hosted-container column
     e. Both attempts appear in the attempts ledger, and both attempts' tool
        and checkout captures are committed
```

**No transcript key distinguishes the two checkout mechanisms, and that costs something.** `workdir.listing` lists `$RUNNER_WORKSPACE` (`probe.sh:428, 449-453`), which on a hosted runner is the *parent* of the checkout directory; `.git` lives under `$GITHUB_WORKSPACE`, which the probe emits only as a path string (`probe.sh:440-441`) and never lists. So no committed transcript, on any shape, under either mechanism, contains a `.git` entry — and no other transcript key varies with the mechanism either. This matters because the image decision is the one place a wrong answer silently degrades both derived fields, and the transcript cannot corroborate it.

The substitute is a second log-derived capture. `actions/checkout@v4` reports in its own step log which path it took — a git fetch or an archive download — so that step's output is extracted for **both** shapes and committed, and the record states the mechanism each column's checkout used. Two columns compared across two different checkout mechanisms is a real confound, and this is what makes it visible rather than invisible.

**Is a tool-presence check that prints absence without failing adequate here?** No. A job whose deliverable is a record of what was observed should not be able to go green having measured a short toolset — that is the same silent-failure shape FAFF-654 spent twelve review passes removing from the instrument. The fix is a workflow edit and inherits the out-of-scope reason above, so the gap is closed by two committed captures that can each fail loudly instead, and by a line in the record stating that the check is non-gating in the committed workflow. The compensation is re-examined explicitly in the decision section below, because an earlier draft of it rested on one criterion an empty file satisfied and one that could never fire.

**Anti-pattern:** accepting a tool capture on the strength of "it contains no `(absent)`". Why: an empty capture contains no `(absent)` either, and an empty capture is a realistic outcome — the extraction matches a step name in the log, and the step never runs if the container fails to start.

### Step 4 — dispatch hosted-direct

One dispatch, `shape: hosted-direct`, `environ_keys: names`. The `image` input is inert on this job and is left at its default. This job runs as the unprivileged runner user, so it is the run that supplies the non-root self-test demonstration the acceptance requires.

### Step 5 — collect

```
PROCEDURE collect(run_id, artifact_name, shape):
  1. gh run watch <run_id> until the run concludes
  2. gh run download <run_id> --name <artifact_name> into a scratch directory
  3. Verify the file set matches the workflow's declared upload paths exactly
  4. gh run view <run_id> --log  ->  capture_from_log for each step below
  5. Do not edit any file

PROCEDURE capture_from_log(run_id, step_name, target_file):
  1. Locate the step's lines in the log by its declared name
  2. IF the step does not appear at all -> HARD STOP. The step did not run.
     Do not write an empty file, do not proceed to commit, and record the
     run in the attempts ledger as not yielding a capture.
  3. Write the step's lines to target_file with the log's own prefixes intact
  4. Prepend a header naming the run identifier, the run URL, the step name,
     the extraction command, and one line stating the file is log-derived

Captures taken:
  hosted-container run  ->  "Tool presence check"        ->  toolcheck-hosted-container-<slug>.txt
  hosted-container run  ->  "Run actions/checkout@v4"    ->  checkout-hosted-container-<slug>.txt
  hosted-direct run     ->  "Run actions/checkout@v4"    ->  checkout-hosted-direct.txt
```

**The checkout step's log name.** The two checkout steps are declared bare — `- uses: actions/checkout@v4` at `job-surface-probe.yml:72` and `:180`, with no `name:` key — so GitHub labels them `Run actions/checkout@v4` in the log rather than by a name the workflow chose. That is the exact string `capture_from_log` matches on, quoted here for the same reason `"Tool presence check"` is: a step name guessed rather than read is how a capture silently targets nothing. The failure is safe-direction — a wrong name hard-stops at procedure step 2 rather than writing a fabricated file — so a mistake here costs a cycle, not a record.

**What the tool capture must contain.** Twenty-three lines, one per declared tool, in the order the workflow's loop declares them, each carrying the tool name followed by the path `command -v` resolved. Every path is absolute. If a tool resolves to a bare name rather than a path — possible if the container's shell provides it as a builtin — that is recorded and reasoned about in the notes rather than treated as either a pass or a failure, because it is a third thing.

**On the standing of a log-derived capture.** It does not carry the same standing as an artifact byte-copy, and the record says so rather than presenting the two as equivalent. An artifact file was written by the job and uploaded by the job; a log capture came back through GitHub's log pipeline, which prefixes each line with a job, step, and timestamp. The prefixes stay — stripping them is editing, and the point of the file is that it is what the log said.

### Step 6 — the pre-commit checks

All of these run before any commit, over every file about to be staged.

**The three-branch credential scan.** Its constants live in `plugin/skills/faff/bin/lib/config.js` lines 859-880 and are module-private, so they cannot be imported and must be read from the source at scan time. **This spec deliberately does not reproduce them.** A copy pasted here would be a second thing that can drift, in a document whose own instruction is that reading the source is the only check — and it would be the copy a builder reaches for first. Open the file and read all four constants there.

The four are: a list of known credential prefixes matched as substrings; one known pattern for a chat-platform token family; a key-name gate naming the words that make a key suspicious, with an exemption for names ending in the environment-variable suffix; and a generic high-entropy value pattern with a minimum length. Their values are in the source and nowhere else.

```
PROCEDURE credential_scan(file):
  1. For each known prefix, search the WHOLE FILE for it as a substring
     anywhere in a line. Any hit -> stop, commit nothing, escalate.
  2. Same for the known regex.
  3. For each key line, split on the first colon-space into key and value.
     IF key matches the key-name gate AND does not end _env
     AND value matches the generic value pattern -> stop, escalate.
  4. For each continuation line inside the pid-1 environ key-name block:
     the line is a bare NAME with no separator, so branch 3 cannot reach it.
     Apply the key-name gate to the name itself and flag any hit for the
     by-eye review below. A name is not a credential, so this flags rather
     than blocks.
```

**Anti-pattern:** calling `secretScanLeaf` per line and treating a null return as clean. Why: it anchors at character zero of the value, so it gives a false all-clear on exactly the file it was added to protect. The scan above matches anywhere in the line for that reason.

**The by-eye read — ten sites.** Seven emit bytes from a measured file (the enumeration in section 1; five of them are FAFF-654's named exceptions and two are not in that list at all); three more are environment values, which are not file bytes and are read anyway. In every committed transcript, read and confirm before commit:

1. **The mount table block** — device and mount paths only, nothing carrying credential material in a path.
2. **The pid-1 environ key-name block** — key names only, no value material. `RESULTS.md` already names this as the site the scan cannot cover, because a continuation line has no key-value separator for the generic branch to split on.
3. **`containment.proc1.container_value`** — the value of pid 1's `container` variable, printed in full and not suppressible by any dispatch input. Read it. On a Docker-run job container this key is commonly `absent`, but that is an expectation, not a reading.
4. **Every long-listing line**, including `home.entries` — entry names under `$HOME` are names, not contents, but they are still published permanently.
5. **`crosscheck.container_check_plain`** — expected `impossible_on_shape(no faff binary on PATH)` on both hosted shapes, since neither job installs faff. If it is present instead, read the block.
6. **`containment.proc1.cgroup`'s block** (`probe.sh:420`) — every line of `/proc/1/cgroup`, verbatim. Under cgroup v2 this is normally the single line `0::/`; under a container runtime it can carry a cgroup path embedding a container ID. Not in FAFF-654's exception list, and printed on every run regardless.
7. **`containment.proc1.comm`'s block** (`probe.sh:424`) — every line of `/proc/1/comm`, verbatim: the name of pid 1's executable. Not in FAFF-654's exception list, and printed on every run regardless.

**Three more sites, which are not file bytes at all and are read anyway.** The seven above are the complete set of sites emitting bytes from a measured file. Three other roster signals print a value in full without reading a file, so nothing the record claims about *file* bytes is affected — but the by-eye read exists because this artifact is permanently public, and that reason does not care which class a published value came from:

8. **`env.DOCKER_HOST`** (`probe.sh:363`) — printed in full when set. On a hosted runner it is normally unset, but if a socket path or a remote endpoint is there, it is published.
9. **`containment.env.KUBERNETES_SERVICE_HOST`** (`probe.sh:390`) — printed in full when set. A cluster address is not a credential, and is still an address.
10. **`containment.env.container`** (`probe.sh:412`) — the value of the ambient `container` variable, printed in full. Distinct from item 3, which reads the same variable out of pid 1's environ.

None of the last three is reachable by the credential scan's key-name gate, because each is a fixed key name the gate does not match. So the read covers ten sites — seven file-bytes and three environment values — and the operator attestation records all ten.

**`faff stage-guard --worktree . --mode assert`** runs before every commit, and staging is by explicit path. Never `git add -A`.

**The `notes` field, read by eye.** Read the whole field's content for findings language and run the advisory word-list check over it. Record every hit and the reason it was left in, or remove it.

### Step 7 and 8 — derive the fields

**`worktree_changed_by_checkout.<shape>`** — the derivation is already stated in the record and this spec does not restate it differently: yes when the set of entry names one level deep differs between the pre-checkout file and the transcript's work-directory listing; no when those two sets are equal; names only, not byte equality and not owner or mode.

```
PROCEDURE derive_worktree_changed(precheckout_file, transcript):
  1. From precheckout_file, skip the four preamble lines, take the remaining
     long-listing lines, and for each take the entry NAME: everything after
     the eighth whitespace-delimited field, and for a symlink line the part
     before the " -> ". Collect as a set.
  2. From the transcript's workdir.listing continuation block, take the same.
  3. yes when the sets differ, no when they are equal.
  4. IF the pre-checkout listing is an error message rather than a listing
     (the step redirects stderr and swallows failure), the field records
     undecidable with the reason, and does not guess.
```

Either answer is a valid reading. Both listings target `$RUNNER_WORKSPACE`, which is the parent of the checkout directory, so what this field detects is a change one level up from the worktree — on `hosted-direct` the runner pre-creates the repository directory there, so `no` is a plausible and legitimate result. **Anti-pattern:** re-dispatching to obtain a more interesting value. Why: that makes the field a statement about which run was kept, not about what checkout did.

**`columns_identical`** — the record gives no derivation for this field, so this spec defines one.

```
PROCEDURE derive_columns_identical:
  1. Participants: the three transcripts that are the observation table's
     three columns — hosted-direct.txt, hosted-direct-after-removal.txt,
     hosted-container.txt. The record's note that this field "requires two
     hosted transcripts" is a minimum, not a cap; three columns satisfy it.
  2. From each, extract the ordered sequence of KEY NAMES: every line whose
     first character is not a space, taking the text before the first
     colon-space. Continuation lines are excluded.
  3. Compare KEY NAMES ONLY, never values. Values differ between shapes by
     definition — that is what the table is for. What this field asserts is
     that the columns line up, which is a statement about the instrument.
  4. identical means: same length, same order, element-for-element equal.
     Order is included deliberately, so a reordering defect is visible.
  5. columns_identical: yes  when all three sequences are equal.
     columns_identical: no   otherwise — and then the record additionally
       states the symmetric difference of key names and the first index at
       which the sequences diverge, and does not present the table's columns
       as comparable.
```

A `no` here is a finding about `probe.sh`, not about the shapes. It would be discovered scope for a separate ticket, and the record would state it plainly.

**The two unfixturable tokens.** Search both committed probe transcripts for `unreadable(open-failed)` and for `unreadable(read-failed)`. For each token, the record names the transcript and the key that carries it, or states that it was not observed in this run. The bare claim that it is demonstrated by transcript is not sufficient, which the record already says.

**The attempts ledger.** A `notes` line listing every dispatch of `job-surface-probe` made for this ticket: run identifier, run URL, shape input, image input, `environ_keys` input, outcome, and whether its transcript is committed with the reason. The workflow had zero runs before this ticket, so a reader can check the ledger against the complete run history with `gh run list --workflow job-surface-probe` and see that nothing was omitted. The record states that property, because it is what makes the ledger checkable rather than merely present.

### The `environ_keys` mode

`names` on both shapes, taken deliberately for each, with a different reason on each — the record states both rather than one inherited argument.

- **`hosted-direct` — `names`.** Pid 1 is the VM's init on a hosted runner, so its environment is the machine's, not the job's. This is the argument `RESULTS.md` already records.
- **`hosted-container` — `names`, and the record does not reuse the argument above.** Pid 1 inside a job container is the container's own entrypoint, started by the runner with the environment the runner passed at container creation. That environment is job-scoped, so the argument for `names` is different: the key-name block emits names and not values; whether the runner passes the job's environment into the container is one of the more informative readings this column can produce, and `count` would discard it; and the block is read by eye before commit.
- **What `count` does and does not do.** It replaces the key-name block with a count. It does **not** suppress `containment.proc1.container_value`, because the mode branch closes at `probe.sh:404` and the `container=` extraction runs at `405-406` regardless. Any plan that treats `count` as a way to remove value material from a transcript is wrong about the instrument.
- **The escalation rule, with its limit stated.** If the by-eye read finds a key name that is itself credential-shaped — matching the key-name gate and embedding what looks like a value rather than naming one — the transcript is not committed. Re-dispatch with `environ_keys: count`, commit that transcript instead, and record the reason and the discarded attempt in the ledger. If instead the by-eye read finds material in `containment.proc1.container_value` that must not be published, **the unmodified instrument offers no dispatch input that removes it.** That is a hard stop: commit nothing from that run, escalate to a human, and file the instrument change (a `probe.sh` edit folding that extraction into the mode branch) as discovered scope.

### Failure modes

- **The container job goes green having checked out via the tarball fallback.** The tool check prints `(absent)` for git and does not fail; checkout succeeds anyway. *How you'd know:* the committed tool capture carries an `(absent)` line for git, and the committed checkout capture shows the archive-download path rather than a git fetch. No transcript key shows it — that is why the checkout capture exists. *What it means:* replace the image and dispatch again. Do not commit the transcript.

- **A capture is empty because its step never ran.** The container failed to start, so no step produced output. *How you'd know:* the extraction hard-stops on the step being absent from the log rather than writing an empty file; and the tool capture's own criterion is 23 lines with paths, not the absence of a string. *What it means:* the run yielded no reading. Record it in the ledger and dispatch again.

- **The image resolved to a digest is not the image the job pulled.** A tag moves between the local resolution and the dispatch, or the dispatch used the tag default. *How you'd know:* the run log's `Initialize containers` digest disagrees with the notes' resolved digest — that is the one independent comparison. The transcript's `container_image` line agreeing proves only that the input carried the digest. *What it means:* nothing is committed; resolve again and re-dispatch.

- **Both hosted runs come back at euid 0.** *How you'd know:* both transcripts read `probe_euid: 0` and both self-test outputs report two skipped cases. *What it means:* the directory carries no non-root demonstration at all and the acceptance is unmet — record it as unmet, do not gloss it. `hosted-direct` runs as the unprivileged runner user, so this is not the expected outcome; if it happens, something about the shape is not what the record assumes.

- **A self-test that greens without running its cases.** The self-test returns zero whenever its failure count is zero, which an empty run also satisfies. *How you'd know:* the assertion counts. A non-root run reports 11 passed, 0 skipped, 0 failed; an euid-0 run reports 9 passed, 2 skipped, 0 failed. Any other combination is not a self-test that passed. *What it means:* do not commit; investigate before dispatching again.

- **The job ran an instrument other than the committed one.** *How you'd know:* the transcript's `probe_sha256` does not equal `sha256sum` of `records/spikes/2026-07-26-FAFF-654/probe.sh` at the commit the run checked out. *What it means:* the reading is about an unknown instrument. Do not commit it.

- **`dd` was missing, so every read-step classification is unreliable.** The probe says so itself rather than letting a whole column read `read-failed`. *How you'd know:* the transcript's `probe_dd` line does not read `present`. *What it means:* the transcript is not a reading. Replace the image and dispatch again.

- **The pid-1 `container` value carries something that should not be published.** No dispatch input suppresses it. *How you'd know:* the by-eye read of that key, which is why it is item 3 of the ten-site read rather than something the scan covers. *What it means:* hard stop and escalate; the fix is an instrument change, not a re-dispatch.

- **The table implies a conclusion the record does not state.** A table can recommend by what it puts side by side, and no constraint on cells prevents that. *How you'd know:* it does not surface mechanically — this is what the by-eye read of the `notes` field and the reviewer are for. *What it means:* FAFF-654's design already names this as a real reduction rather than a guarantee, and the record should not claim otherwise.

## 5. Scenarios

> 4 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the hosted-container job has run
When the committed tool-presence capture is read
Then it carries 23 lines, one per tool the workflow's loop declares, in that
     order, each naming the tool and the path command -v resolved for it,
     and none reading (absent)
```

```
Given both hosted shapes have run
When the two committed checkout captures are read
Then each states which mechanism actions/checkout used, and RESULTS.md records
     the mechanism per column, so a reader can see whether the two columns were
     checked out the same way
```

```
Given both hosted shapes have been dispatched and their artifacts downloaded
When the key-name sequences of the three committed probe transcripts are compared
Then columns_identical records yes only if all three sequences are equal in
     length, order and element, and records no with the divergence detail otherwise
```

- The committed transcripts MUST each carry a `probe_sha256` value equal to the SHA-256 of `records/spikes/2026-07-26-FAFF-654/probe.sh` at the commit the run checked out.
- No committed file MUST contain a digest of any file the probe classified, and MUST contain no bytes from a measured file beyond the seven sites enumerated in section 1.
- The record MUST NOT describe the transcript's `container_image` line as independent evidence of which image was pulled.
- Every dispatch of `job-surface-probe` made for this ticket MUST appear in the attempts ledger, and the ledger MUST reconcile against the workflow's complete run history.

## 6. Design decision rationale

**How is a Docker Hub tag resolved to a digest without a Docker daemon, and how is the resolution attested?**
Options: a local `docker` command (needs a daemon, not guaranteed); `skopeo` or `crane` (extra tooling, likely absent); the registry HTTP API over `curl` (no tooling beyond curl, and the response is the registry's own answer).
**Chosen:** the registry HTTP API over `curl`, with the anonymous pull token and both manifest-index Accept headers, reading the `Docker-Content-Digest` header — attested by pasting both commands, their complete output, and the UTC timestamp into the notes, plus the by-digest re-verification command a later reader runs. `skopeo inspect docker://…` and `crane digest` are named as fallbacks. The corroboration is the run log's `Initialize containers` digest, and that is the only independent source; the transcript's `container_image` line is a passthrough of the dispatch input (`job-surface-probe.yml:201` → `probe.sh:315`) and is kept as a check on what was asked for, not on what was pulled. Rationale: content addressing is what makes the digest checkable, pasting the command with its output is what turns it into evidence, and counting a passthrough as a third witness would be the record overstating its own provenance.

**Which image, on what criterion, and how does the record state what was used?**
Options: keep `debian:bookworm-slim` digest-pinned and accept a tarball checkout; assume git is absent and go straight to a fatter image; measure first, then decide.
**Chosen:** measure first. Dispatch `hosted-container` on the digest-pinned `debian:bookworm-slim` to obtain the tool-presence reading for the stock minimal image; if the check comes back complete, that transcript is the column. If it comes back short, replace the image — `buildpack-deps:bookworm-scm` is the leading candidate, being an official glibc-based Docker Hub image carrying git on a Debian bookworm base — and dispatch again. Rationale: the ticket says the image is replaced rather than the check weakened, and git's presence decides the checkout *mechanism*, which decides whether the two columns' work-directory readings answer the same question. Asserting git's absence without looking would put an unverified premise into a record whose whole point is that its contents were observed. At the time of writing, `git` is Priority: optional in Debian, so a short result is expected — but expected is not observed. The record states the image used, the criterion, and that the tool-driven choice makes this column a reading of a job container carrying a full toolchain, not a claim about minimal job containers generally.

**No transcript key distinguishes a git checkout from a REST-tarball checkout. What replaces the check?**
Options: infer it from `workdir.listing`; accept the gap silently; capture the checkout step's own log output.
**Chosen:** capture the checkout step from the run log for both shapes, commit both, and state the mechanism per column in the record. Rationale: the inference does not work — `workdir.listing` lists `$RUNNER_WORKSPACE` (`probe.sh:428, 449-453`), the parent of the checkout directory, so `.git` is never in it on any shape under either mechanism, and an earlier draft of this spec required a `.git` entry that could not appear. Accepting the gap silently is worse than capturing it, because the image decision is exactly where a wrong answer degrades both derived fields, and two columns checked out by different mechanisms is a confound a reader of the record has to be able to see.

**Is a tool-presence check that prints absence without failing adequate, and does the compensation hold?**
Options: accept it; weaken the criterion to match it; edit the workflow now; compensate here and file the fix.
**Chosen:** compensate here and file the fix, with the compensation rewritten. The first version of it rested on two criteria that did not hold — "the capture contains zero `(absent)`", which an empty file satisfies, and a `.git` transcript check that could never fire. Both are replaced: the capture must carry 23 lines with resolved paths, the extraction hard-stops rather than writing an empty file when the step is absent from the log, and the checkout capture takes over the mechanism check. Rationale: the compensation was the reason keeping the workflow out of scope was acceptable, so with both halves gone the boundary would not have been defensible. With both halves working — two committed captures that each fail loudly — it is. The workflow fix, making the step collect the absent tools and exit non-zero, is filed as its own ticket.

**What does `columns_identical` compare?**
Options: key names only; names and values; the two shape transcripts; all three columns.
**Chosen:** ordered key-name sequences, values excluded, over all three observation-table columns. Rationale: values differ between shapes by construction — that is what the table is for — so comparing them would make the field always read `no` and say nothing. The instrument goes to some trouble never to skip a key ("the columns must line up"), and this field is the check on that. Including order catches a reordering defect a set comparison would miss. Three columns rather than two because the observation table has three, and the record's "requires two hosted transcripts" is a minimum.

**How is log-derived output captured, and what standing does it carry?**
Options: leave it in the log and attest by hand; screenshot; extract via `gh run view --log` and commit.
**Chosen:** extract and commit as labelled files, prefixes intact, each with a header naming the run, the URL, the step, the extraction command, and its log-derived standing — and with a hard stop when the step is absent rather than an empty file. Rationale: an unrecorded observation is an assertion. These files do not carry the same standing as artifact byte-copies — the job wrote and uploaded those; these came back through the log pipeline — and the record says so rather than presenting the two as equivalent. Prefixes stay because stripping them is editing.

**Which transcript is committed when there are multiple attempts, and what does the record say about the rest?**
Options: commit only the successful run and say nothing; commit every attempt's transcript; commit one per column and name every attempt.
**Chosen:** one committed transcript per column, plus an attempts ledger naming every dispatch with its inputs, outcome, and whether it was committed and why. Every attempt's tool and checkout captures are committed, because those are the evidence behind an image replacement. Rationale: a record that silently shows only the run that worked is a different artifact from one that states its attempts, and the workflow's zero prior runs mean the ledger is checkable against the complete run history — which is the property that makes it evidence rather than a claim.

**What `environ_keys` mode, on each shape?**
Options: `names` everywhere by inheritance; `count` everywhere for safety; per-shape.
**Chosen:** `names` on both, argued separately, with the mode's actual reach stated. On `hosted-direct`, pid 1 is the VM's init and its environment is the machine's. On `hosted-container`, pid 1 is the container's own entrypoint with a job-scoped environment, so the record does not reuse the first argument — the case there is that the key-name block emits names and not values, that whether the runner passes the job environment into the container is one of the column's more informative readings, and that the block is read by eye. Rationale: taking the default by inheritance on a shape where the stated reason does not hold is how a record acquires an argument nobody checked. And the mode is not a general value-suppression switch: `probe.sh:399-404` closes before the `container=` extraction at `405-406`, so `count` leaves that value printed in full. The escalation rule therefore has two branches — one that `count` fixes, and one that it does not, which is a hard stop and an instrument change rather than a re-dispatch.

**What shape is the observation table?**
Options: leave the cell rule to the builder; a per-shape column layout; the roster as rows and the columns as shapes.
**Chosen:** rows are the 41 roster signals in roster order minus one, columns are the three hosted columns, cells carry the transcript's value verbatim (key line only for multi-line keys), and the caption matches FAFF-654's fixed template with N=40. Rationale: keying the rows to the roster in roster order means the two tables read against each other line by line and a missing row is visible. `attest.writable_is_a_proxy` is excluded because its value is a fixed caveat sentence, not a reading, and a sentence in a cell is what the form constraint exists to prevent; the exclusion gets its own status line so it is not a silent drop.

**FAFF-654's form constraint does not admit everything the probe emits into a cell. What is the closed vocabulary, and how was it derived?**
Options: extend the vocabulary by inspecting the classes of key that look non-conforming; enumerate every emit site and read the answer off the enumeration.
**Chosen:** enumerate. Walking every `emit` call in `probe.sh` for all 40 tabulated keys across all three columns gives the complete set: the six grammar tokens, plus `yes`, `no` (11 signals), `non-decisive` (1), and `same-job` (1, `probe.sh:479`, on the after-removal column only). The method is written into `RESULTS.md` beside the amendment so the next person can check it the same way. Rationale: an earlier draft derived the extension from the `yes`/`no` class alone and missed `same-job`, which would have left the table breaking the constraint on one cell of forty and a builder improvising a second unrecorded amendment. The method was the defect, not just the miss. The constraint's stated purpose is that a cell can carry a reading and cannot carry a sentence, and four closed literals preserve it exactly — none can carry a clause any more than `absent` can.

**Where is the amendment recorded?**
Options: in `RESULTS.md` only; in FAFF-654's design spec only; in both, with a pointer each way.
**Chosen:** record it in `RESULTS.md` naming the amended document and its line numbers, and file the back-reference into FAFF-654's design spec as discovered scope. Rationale: the constraint is authored in the design spec (line 419, acceptance at line 591) and applied in `RESULTS.md`, and FAFF-646 may cite either. Recording it only where it is applied leaves a reader arriving from the authoring document with an unqualified constraint the artifact no longer satisfies — which is the same class of problem as a record whose provenance is unstated.

**Does anything here change `probe.sh` or the workflow?**
**Chosen:** no, for two different reasons that should not be conflated. The workflow is excluded because a reading taken against a branch copy came from a workflow that is not on `main` and that the same PR is still free to change — the loop FAFF-654 got stuck in, where a merge floor rests on a reading taken with an instrument the change is still moving. (Once a dispatch-only workflow is registered on the default branch, a run *can* select another ref, so the constraint is about what the reading would be worth, not about what the platform permits.) `probe.sh` is excluded because `probe_sha256` is what proves a transcript came from the committed instrument and FAFF-656 takes its columns with the same one. Three follow-ups are expected: the tool-check exit status, folding the `container=` extraction into the `environ_keys` mode branch, and the design-spec back-reference.

## 7. Open questions and assumptions

### Open questions

None. Every decision above closed. The follow-up tickets named are discovered scope, not blockers on this work.

### Assumptions

**Assumes:** the Docker Hub registry API returns a `Docker-Content-Digest` header for a manifest request carrying the OCI-index and Docker-manifest-list Accept headers, against an anonymous pull token from `auth.docker.io`. *Validate:* run the two commands before dispatching anything and confirm a `sha256:` digest comes back. If the response shape differs, fall back to `skopeo inspect docker://debian:bookworm-slim` or `crane digest debian:bookworm-slim` and record whichever command was used. The record's checkability does not depend on which produced the digest, only on the command and its output being pasted.

**Assumes:** `actions/checkout@v4` reports in its own step log which mechanism it used, distinguishably enough for an operator reading the capture to say whether it fetched with git or downloaded an archive. *Validate:* read the `hosted-direct` run's checkout capture first — that job runs with git present, so it establishes what the git path looks like in the log before the container capture has to be interpreted. If the log does not distinguish the two, the checkout capture cannot carry the mechanism check; say so in the record, and treat the tool capture's `git` line as the sole evidence rather than pretending to two sources.

**Assumes:** `gh` is authenticated with `workflow` and `repo` scopes, so `gh workflow run`, `gh run watch`, `gh run view --log` and `gh run download` all work. *Validate:* `gh auth status` before starting. This held when the ticket was prepared.

**Assumes:** `job-surface-probe.yml` is on the default branch and dispatchable, with zero runs recorded against it. *Validate:* `gh workflow list` shows it active, and `gh run list --workflow job-surface-probe` returns nothing. The zero-runs property is load-bearing for the attempts ledger being checkable against the complete run history — if runs already exist, the ledger states its starting point instead.

**Assumes:** the credential-scan constants are still at `plugin/skills/faff/bin/lib/config.js` lines 859-880, and are still the four described above — a prefix list, a chat-token pattern, a key-name gate, and a generic value pattern. *Validate:* open the file and read all four before running the scan, and if the line numbers have moved or a fifth branch has appeared, use what is there and record the discrepancy. This spec holds no copy of the values, so there is nothing here to compare against and nothing here to go stale — the source is the only authority.

**Assumes:** `actions/upload-artifact@v4`'s `if-no-files-found: error` setting means a run that produced no transcript fails rather than uploading an empty bundle. *Validate:* confirm the artifact bundle's file list matches the workflow's declared upload paths exactly after each download.

## 8. DONE

### From WHY

- [ ] No committed file contains a digest of any file the probe classified.
- [ ] No committed file contains bytes from a measured file beyond the seven sites enumerated in section 1, and the record names all seven where it states the guarantee — never five, which is the count `RESULTS.md` carries and which the instrument breaks.
- [ ] `RESULTS.md` cites FAFF-661 beside its exception list, so a reader of the record is not left with the false count of five while that correction is outstanding.
- [ ] No line added to `RESULTS.md` states a conclusion about whether a mechanism is safe, sufficient, or recommended.
- [ ] Every file downloaded from an artifact bundle is committed with its original filename and byte-identical content.

### From WHAT (artifacts and the record's shape)

- [ ] The seven artifact files are committed to `records/spikes/2026-07-26-FAFF-654/`, flat, unedited.
- [ ] One tool-presence capture and one checkout capture per `hosted-container` attempt, and one checkout capture for the `hosted-direct` run, are committed — each with a header naming the run identifier, run URL, step name, extraction command, and its log-derived standing.
- [ ] `RESULTS.md` carries the observation table with caption exactly `Table: observations — 40 signals — shapes: hosted-direct, hosted-direct-after-removal, hosted-container`.
- [ ] The table's 40 rows are the signal roster in roster order, minus `attest.writable_is_a_proxy`, whose exclusion is stated as its own status line with its reason.
- [ ] Every cell is one of the six grammar tokens with detail verbatim, or the literal `yes`, `no`, `non-decisive`, or `same-job`.
- [ ] The cell-vocabulary amendment is recorded in `RESULTS.md` naming `records/specs/2026-07-26-FAFF-654-…-design.md`, its form constraint at line 419 and acceptance item at line 591, the twelve signals the amendment affects (eleven carrying `yes`/`no`, one carrying `same-job`; the already-admitted `non-decisive` signal is not among them), the emit-site enumeration method, and the reason.
- [ ] A back-reference to that amendment is filed against FAFF-654's design spec as discovered scope.
- [ ] For each multi-line key, the cell carries the key line's value only and the continuation block remains in the transcript.

### From HOW (the digest)

- [ ] The notes carry both resolving commands verbatim, their complete output including response headers, the UTC timestamp, and the by-digest re-verification command.
- [ ] The digest in the notes matches what the run log's `Initialize containers` step reports as pulled.
- [ ] The committed `hosted-container` transcript's `container_image` value matches the digest-pinned reference passed as the dispatch input, and the record describes that agreement as a check on the input rather than as independent evidence of what was pulled.

### From HOW (the image, the tool check, the checkout method)

- [ ] The committed tool-presence capture for the committed `hosted-container` attempt carries 23 lines, one per tool the workflow's loop declares, in that order, each naming the tool and the path `command -v` resolved, with no line reading `(absent)`.
- [ ] Any tool that resolved to a bare name rather than an absolute path is recorded in the notes with the reasoning, rather than counted as either a pass or a failure.
- [ ] Both checkout captures are committed, and `RESULTS.md` states which checkout mechanism each column used — or states that the log did not distinguish them, per the assumption above.
- [ ] `RESULTS.md` states that no transcript key distinguishes the two checkout mechanisms on any shape, so a reader knows why the checkout captures exist.
- [ ] `RESULTS.md` states which image was used, the criterion it satisfies, and that the tool-driven choice makes this column a reading of a container carrying a full toolchain rather than a claim about minimal job containers.
- [ ] A follow-up ticket is filed to make the tool-presence step exit non-zero when any tool is absent, and `RESULTS.md` carries one line stating the check is non-gating in the committed workflow.

### From HOW (derived fields)

- [ ] `columns_identical` records `yes` or `no`, derived from the ordered key-name sequences of the three committed probe transcripts, key names only.
- [ ] On `no`, the record additionally states the symmetric difference of key names and the first divergent index, and does not present the columns as comparable.
- [ ] `worktree_changed_by_checkout.hosted-direct` and `.hosted-container` each record `yes` or `no`, derived per the record's stated rule — entry names one level deep, names only — and the record notes that both listings target the parent of the checkout directory.
- [ ] `unfixturable.open-failed.observed` names the transcript and key that carried the token, or states it was not observed in this run. Same for `unfixturable.read-failed.observed`.
- [ ] `RESULTS.md` cites `validate.yml`'s `env-rootless` job alongside the `hosted-direct` column, in present tense, so a reader sees which column has independent corroboration for part of its content and which does not.
- [ ] `observation_table` no longer reads `empty`, and the three `unobtained — owned_by FAFF-657` column-status lines carry run identifiers and committed transcript filenames.
- [ ] `selfhosted-direct`, `selfhosted-container`, and `actions_runner_controller` are unchanged.

### From HOW (the environ mode)

- [ ] Each shape's `environ_keys` choice is recorded with its own reason, and the `hosted-container` reason does not reuse the VM-init argument.
- [ ] `RESULTS.md` states that `environ_keys: count` withholds the key names and does not suppress `containment.proc1.container_value`, and that the unmodified instrument offers no input that does.

### From HOW (the by-eye read and the pre-commit checks)

- [ ] All ten sites are read by eye in every committed transcript — the seven file-bytes sites (mount table, pid-1 environ key-name block, `containment.proc1.container_value`, every long-listing line including `home.entries`, `crosscheck.container_check_plain`, `containment.proc1.cgroup`, `containment.proc1.comm`) plus the three environment-value sites (`env.DOCKER_HOST`, `containment.env.KUBERNETES_SERVICE_HOST`, `containment.env.container`) — and the operator attestation records each.
- [ ] The three-branch credential scan ran over every committed file with prefix branches matching anywhere in a line, and returned zero hits.
- [ ] The four credential-scan constants were read from `config.js` at scan time rather than from any copy, and the attestation records what was read there and whether the line numbers still hold.
- [ ] `faff stage-guard --worktree . --mode assert` passed before every commit, and every commit staged by explicit path.
- [ ] The `notes` field content was read by eye for findings language, and every advisory word-list hit is recorded with the reason it was left in or removed.

### From HOW (attempts and instrument identity)

- [ ] The attempts ledger names every dispatch made for this ticket with run identifier, run URL, shape, image, `environ_keys`, outcome, and whether its transcript is committed with the reason.
- [ ] The ledger reconciles against `gh run list --workflow job-surface-probe`, and the record states that this reconciliation is what makes the ledger checkable.
- [ ] Both committed transcripts carry `probe_dd: present`.
- [ ] Both committed transcripts' `probe_sha256` equals the SHA-256 of `records/spikes/2026-07-26-FAFF-654/probe.sh` at the commit the run checked out.
- [ ] The committed `hosted-direct` self-test output's final line reads 11 passed, 0 skipped, 0 failed.
- [ ] The committed `hosted-container` self-test output's final line reads 11 passed, 0 skipped, 0 failed, or 9 passed, 2 skipped, 0 failed with `probe_euid: 0` on that column.
- [ ] Every column's `probe_euid` appears in `RESULTS.md` before the table rows.
- [ ] `probe.sh` and `job-surface-probe.yml` are unmodified in the diff.

### Integration smoke test

```
PROCEDURE smoke:
  1. gh workflow run job-surface-probe -f shape=hosted-direct -f environ_keys=names
  2. gh run watch <run_id>                          -> conclusion success
  3. gh run download <run_id> --name probe-hosted-direct
  4. The bundle contains exactly four files
  5. hosted-direct.txt line 1 reads "probe_version: 1"
  6. hosted-direct.txt probe_sha256 equals sha256sum of the committed probe.sh
  7. hosted-direct.txt probe_euid is non-zero
  8. selftest-hosted-direct.txt final line reads 11 passed, 0 skipped, 0 failed
  9. capture_from_log finds the checkout step and writes a non-empty capture
  -> the workflow, the artifact path, the log-capture path, and the
     instrument's identity are all connected
```

---

## Self-review findings and resolutions

Findings 1-8 are the second pass, run after the spec-review gate returned `reject-approach`. Finding 9 came from the third gate pass, after a second reviewer enumerated the continuation-block emitters independently. All are weighted toward checking claims against `probe.sh`'s actual emit sites rather than against the draft, which is where every failure in this spec has come from.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| 1 | blocker | The spec claimed the probe emits no values, and built an escalation rule and a DONE item on it. `probe.sh:405-406` emits pid 1's `container` variable in full, and the mode branch closes at `404`, so `environ_keys: count` does not suppress it. `/proc/1/environ` is classified at `396`, so this is content from a measured file. `RESULTS.md`'s `exception_3` already said so. | Principle restated with a table of emit sites; escalation rule split into two branches, one `count` fixes and one it cannot, the second a hard stop plus discovered scope; DONE item split into an absolute digest half and a bounded bytes half. **This resolution was itself still wrong**, because it took the bound from `RESULTS.md`'s list of five rather than from the instrument — see finding 9. |
| 2 | blocker | The `.git` DONE item and the tarball-fallback detector were both unsatisfiable. `workdir.listing` lists `$RUNNER_WORKSPACE` (`probe.sh:428, 449-453`), the parent of the checkout directory; `.git` sits under `$GITHUB_WORKSPACE`, which the probe emits only as a path string (`440-441`). No transcript key varies with the checkout mechanism on any shape. | Replaced with a checkout-step log capture taken for both shapes and committed, plus an explicit statement in the record that no transcript key distinguishes the mechanisms. The log wording is marked `**Assumes:**` with the `hosted-direct` capture read first to establish what the git path looks like. |
| 3 | major | "Zero occurrences of `(absent)`" is satisfied by an empty file, and an empty capture is a realistic outcome — the extraction matches a step name, and the step does not run if the container fails to start. This is the exact criterion shape the spec's own first design principle forbids. | The capture criterion is now positive: 23 lines, one per declared tool, in declared order, each with a resolved path. The extraction hard-stops when the step is absent from the log rather than writing an empty file. The principle itself now states the rule, so the next criterion written under it inherits it. |
| 4 | major | The cell-vocabulary extension was derived by inspecting the `yes`/`no` class and generalising, and missed `socket_removal.kind: same-job` (`probe.sh:479`) — one cell of forty still breaking the constraint. | Redone by walking every `emit` call for all 40 tabulated keys across all three columns. The enumeration is in the spec as a table, the method is written into `RESULTS.md` beside the amendment, and the rationale names the method as the defect rather than the miss. |
| 5 | major | Both halves of the compensation for the deliberately-unfixed tool check were removed by findings 2 and 3, which would have left the out-of-scope boundary undefended. | Re-examined explicitly in its own rationale entry. With the capture criterion positive and the checkout capture in place, both halves work again, and the decision says so rather than assuming the boundary still holds. |
| 6 | minor | The digest attestation was described as three independent sources. `job-surface-probe.yml:201` → `probe.sh:315` makes `container_image` a passthrough of the input. | Corrected to two, with the passthrough kept as a check on what was asked for and a scenario forbidding the record from describing it otherwise. |
| 7 | minor | The amendment was recorded only in `RESULTS.md`, while the constraint is authored in FAFF-654's design spec at line 419 with acceptance at 591. | The amendment now names that document and both lines, and a back-reference into it is filed as discovered scope with its own DONE item. |
| 8 | minor | The out-of-scope rationale for the workflow rested on `probe_sha256` and column comparability, neither of which covers a workflow edit. The reviewer's decisive reason — the dispatch circularity — is better, but stating it as "a workflow change cannot take effect until it lands on `main`" would itself be an unchecked claim: once registered, a dispatch can select another ref and use that ref's file. | Used the circularity reason, stated accurately: the constraint is what the reading would be worth, not what the platform permits. The two files are now excluded for two different reasons rather than one that only fits `probe.sh`. |
| 9 | major | The bytes guarantee was **still** overstated after finding 1 fixed it, by two emit sites. `probe.sh:420` prints every line of `/proc/1/cgroup` verbatim and `:424` does the same for `/proc/1/comm`; both files are classified (`:417`, `:422`) and both are world-readable, so both blocks appear in every transcript on every shape. Two acceptance criteria bounded the guarantee at five and were therefore unsatisfiable by any run. The spec listed all seven continuation-block keys at the observation-table cell rule and never connected that list to the guarantee. | Bound restated as seven everywhere it is asserted, with the enumeration and the method by which it was derived written into section 1. By-eye read extended to ten sites (seven file-bytes, three environment values). `RESULTS.md`'s `exceptions_are_complete` line is false as merged; that is FAFF-654's error, not this revision's, and it is filed as FAFF-661 with an out-of-scope entry rather than patched in passing. |

Two `blocker` findings landed, which forecloses a `high` self-rating outright under the inherited rating cap, independently of the four `major` findings alongside them. Rating held at `medium`.

**The pattern across three passes is worth stating, because it is the risk this spec is about.** Findings 1 and 9 are the same defect found twice: a guarantee about emitted bytes, bounded by reading a *list* rather than by enumerating the *instrument*. Finding 4 is the same shape in a different guarantee, and the count corrected between passes two and three (23 tools, not 24) is the same shape again — a number asserted rather than counted. Each fix was correct about the site it named and wrong about the boundary, because each took the boundary from prose. Three of the four were found by review rather than by self-review. A builder working from this spec should treat every count and every "complete set" in it as re-derivable from `probe.sh` and re-derive it, rather than trusting that this pass finally got it right.

**Prep amendment, 2026-07-27.** The credential-scan constants were originally transcribed into this spec verbatim. That copy is removed: the spec's own instruction is that reading the source is the only check against drift, and a pasted copy would be both a second thing that can drift and the one a builder reaches for first. The section now describes the four branches and points at the source.

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
