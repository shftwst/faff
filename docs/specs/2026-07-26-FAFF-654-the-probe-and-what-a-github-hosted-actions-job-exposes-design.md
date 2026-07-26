# FAFF-654 — The probe, and what a GitHub-hosted Actions job exposes

> Spec: faffter-dark-nlspec · 2026-07-26 · interactive · confidence: medium. Full spec on Linear FAFF-654.

The self-hosted columns and all their provisioning live on FAFF-656, which is `blockedBy` this ticket and carries the `blocks FAFF-646` edge. What remains is in-repo, deterministic, and decides nothing.

**Amendment applied 2026-07-26** (human tie-break at the review loop cap): the read step, its rationale, the coverage statement, and three acceptance items were corrected against measurement. See §4.

## 1. WHY — problem and principles

**The load-bearing model.** A CI job is not one environment; it is a point in a two-axis space, and faff reads the two axes with two separate detectors. The first axis is **containment** — is the job's process tree inside a container at all — which `containerCheck` answers from marker files and environment variables. The second is **host reach** — can the job talk to the machine's engine socket and to the runner's own files — which `hostSocketProbe` answers from two canonical paths. The axes are orthogonal by design and the repo says so in `container-check.js`'s own region banner: a `contained` verdict can still sit behind an unbounded engine.

**What the host-socket refusal actually does, stated correctly.** On the lights-out path, a present host socket refuses — *unless* the operator has set `autonomous.engine_bounded: true`, which downgrades the refusal to a `degrades[]` warn and proceeds. Both branches are at `lights-out.js:346–357`, and the selftest at `:1393–1400` asserts the attested case proceeds, carries the warn, and carries no refusal. The refusal is unconditional with respect to *containment*; it is conditional on an operator attestation. That attestation is the seam FAFF-646 is most likely to reach for, and nothing in this repo has ever recorded the facts an operator would need to make it honestly on a CI runner.

**Problem.** FAFF-646 has to say what bounds a faff run on a CI runner, and its only evidence is inference from reading `actions/runner` source — which is how the assumption that forced the re-slice got through. Nothing in this repo has ever printed a mount table, `/proc/1/environ`, or a runner work-directory listing from inside a job. This ticket builds the instrument and takes the two GitHub-hosted readings, so FAFF-646 cites observations.

### Design principles

**The record must make it hard to conclude anything, and the defence must be form.** The re-slice happened because a brief asserted a mechanism as premise and every downstream step inherited it — review included, because review inherits the premise too. So the defence cannot be discipline, and it cannot be a word list either: a word list is discipline with vocabulary stapled on, and it is trivially bypassed by a sentence that names no banned word ("the direct shape shows a present socket; the container shape shows none"). The defence here is a **grammar constraint on the observation table**: every cell in it must match the probe's own value grammar, so a cell can carry a reading and cannot carry a sentence. Section 4 states exactly which lines that constraint decides mechanically and which one line class it does not.

**Absence, failure-to-read, and undecidability are three different observations, and the shell must be able to tell them apart or the record must not claim it can.** `realFsq()` in `container-check.js` deliberately collapses a permission error into a no-signal, because for a fail-closed gate that is right. The probe is not a gate and must not inherit the collapse — but it also must not merely forbid it. Section 4 gives the mechanism, in POSIX `sh`, and names precisely where the mechanism runs out. The distinction is only worth as much as the self-test can demonstrate, so section 4 also states, per fixture, which cases a given euid can exercise and which token no fixture reaches at all.

**A path the probe never actually tested must never read as a measurement.** The value grammar has a token for "it may exist; this methodology could not obtain it here", and every signal built from an environment variable that can be unset routes to that token rather than walking a mangled path to a confident `absent`.

**The probe records reachability, never contents, and never a digest of a credential.** A truncated digest of a constrained-format credential file is a content oracle: it lets anyone confirm a guessed or leaked value offline, forever, against a public artifact. The finding wanted is "the job could open it", and that needs an open-and-read result, a mode, and a uid/gid. No digest at all.

**FAFF-656 must be able to run this instrument unchanged, on a different machine, possibly from a different repository — and be able to show that it did.** Portability is this ticket's design problem, not FAFF-656's. Every environment-specific input is an argument, never an edit; and the probe carries a self-test mode so a new host can demonstrate the instrument works there before any reading is taken.

### Reference context

| Thing in the repo | What it is | Why it matters here |
|---|---|---|
| `plugin/skills/faff/bin/lib/container-check.js` (179 lines) | `containerCheck`, `hostSocketProbe`, `realFsq` | Defines the exact signals to measure and their precedence; `HOST_SOCKET_PATHS` at `:75` is the two canonical paths |
| `plugin/skills/faff/bin/lib/lights-out.js:346–357` | Host-socket refusal and its attested-bounded downgrade | The consumer of both axes; the attestation branch is why the probe carries an attestation-evidence group |
| `plugin/skills/faff/bin/lib/config.js:859–880` | The four credential-shape constants and `secretScanLeaf` | The three-branch scan the pre-commit check ports |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js:180`, `sentry-poller.js:398`, `regions.js:197–205` | The `--selftest` flag convention and its region-level runner | The name this probe's self-test mode uses |
| `docs/spikes/2026-07-10-faff-411/` | A spike committed as a directory: its own code, its raw machine output, and `RESULTS.md` | The layout this ticket's findings record follows |
| `.github/workflows/validate.yml:9`, `governance.yml:27` | `permissions: contents: read` at workflow level | Every existing workflow pins one; the new one does too |

**Scope.** This is the front of the FAFF-646 chain: it produces the instrument and the two hosted columns, FAFF-656 produces the two self-hosted columns and unblocks FAFF-646, and FAFF-646 writes the ADR. It touches no shipped CLI surface.

## 2. OUT OF SCOPE

- **Any recommendation about how faff should run in CI.** Excluded because that is FAFF-646's whole job. *Extension point:* FAFF-646's ADR, citing this directory.
- **Everything about a self-hosted runner** — the throwaway host, the scratch repository, the registration token, the persistent work-directory reading, the runner's own credential files, the before-the-job socket removal, the teardown. Excluded because it is different substrate and a different unit of work. *Extension point:* FAFF-656, which adds its jobs to this ticket's workflow and its transcripts to this ticket's directory.
- **A `faff` subcommand for any of this.** Excluded because a new command in `COMMANDS` obliges a row in `docs/guide/cli.md` — gated by `faff lint-cli-doc` — and a permanent support surface for a throwaway instrument. *Extension point:* `container-check.js` already holds the detection primitives if a durable surface is ever wanted.
- **Changing `HOST_SOCKET_PATHS` or any detection precedence.** Excluded because this ticket observes the current detector; a detector that moves mid-measurement makes columns incomparable. *Extension point:* FAFF-646, if the observations justify it.
- **Closing the `cmdContainerCheck` coverage gap.** The selftest exercises the pure functions but not the command wrapper. Excluded as another ticket's work; the probe happens to invoke the command end-to-end and records what it printed. *Extension point:* FAFF-655.
- **Measuring an actions-runner-controller pod on Kubernetes.** Excluded on timebox; see the punt in section 7.
- **Making the self-test reproduce a live engine socket.** Excluded because POSIX `sh` cannot create a unix socket and a FIFO stands in badly — opening one for read with no writer blocks, and there is no portable timeout. The consequence is a named, permanent coverage gap in section 4 rather than a fixture.

## 3. WHAT — vocabulary, shapes, and the record

### Vocabulary

| Term | Meaning here |
|---|---|
| Shape | One combination of runner hosting and job containerisation the probe runs on; a column in the table |
| Signal | One thing the probe reads — a path, a variable, a listing; a row in the table |
| Reading | One shape's observed value for one signal, expressed in the value grammar below |
| Findings record | The committed directory holding the probe, the raw transcripts, and the observation table |
| Attestation evidence | The readings an operator would need to set `autonomous.engine_bounded: true` honestly — not a verdict on whether they should |
| Constructible path | A path all of whose variable parts resolved to a non-empty value; a path with an unset part is not constructible and is never tested |

### The shapes

```
ENUM Shape:
  hosted-direct       # GitHub-hosted runner, no job container key
  hosted-container    # GitHub-hosted runner, job under a container key
  # selfhosted-direct and selfhosted-container are FAFF-656's, same instrument,
  # same directory, same table — declared here so the columns are named up front.
```

**Chosen:** measure both hosted shapes here, not just `hosted-direct`. The second column costs one workflow job and is what separates the effect of the job container key from the effect of host persistence. Without it, any difference FAFF-656 finds between a hosted and a self-hosted containerised reading has two possible causes and no way to tell them apart. No workflow in this repository declares a job-level container key today, so this is also the first instance of that key here.

### The value grammar

Every reading is exactly one of these six tokens. The grammar is the record's form defence: a table cell that does not match it is a defect.

```
ENUM Value:
  present(<detail>)              # observed and read; detail is opaque verbatim text
  absent                         # constructible, every ancestor searchable, leaf tested false
  unreadable(<class>)            # exists, open-or-read did not succeed; class per section 4
  undecidable(<why>)             # the shell cannot tell absent from unreadable here
  impossible_on_shape(<why>)     # the thing cannot exist on this shape
  unmeasurable_here(<why>)       # it may exist; this methodology cannot obtain it on this shape
```

**Chosen:** split a single `not_applicable` into `impossible_on_shape` and `unmeasurable_here`. They are different facts, and the case that matters most is the second: the `hosted-container` socket-removal reading is not impossible on that shape — a host-side removal before the job may well be possible on some runner; it is this methodology that cannot reach a hosted runner's VM before the job container starts.

The `unreadable` classes are `not-readable-by-euid`, `open-failed` and `read-failed`; `present` carries the literal detail `empty` when a read succeeded and obtained no bytes. Section 4 defines all four and says which of them any fixture can reach.

**Anti-pattern:** omitting a key when there is nothing to report. Why: the columns stop lining up and a reader cannot tell a missing measurement from an absent signal, which is the distinction the whole record turns on.

### The record the probe emits

One text stream per run, one `key: value` per line, fixed key set in fixed order, every key on every shape.

```
RECORD ProbeOutput:
  header:  ProvenanceHeader
  signals: OrderedList<Reading>

RECORD ProvenanceHeader:
  probe_version:    String        # hand-bumped if the probe changes mid-measurement
  probe_cksum:      String        # cksum of the probe file: CRC + byte length
  probe_sha256:     String | unmeasurable_here(no-digest-tool)
  probe_bytes:      Integer       # always obtainable; the fallback identity check
  shape:            Shape
  source_repository: String       # which repository's workflow produced this reading
  probe_euid:       Integer       # see the euid caveat in section 4 — readings are relative to it
  captured_at:      Timestamp
  runner_os, runner_arch: String
  container_image:  String | "none"   # verbatim, digest-pinned where set
  environ_keys_mode: "names" | "count"
  notes:            String        # provenance only, never findings; the one free-prose field
```

**Anti-pattern:** emitting JSON only. Why: the transcripts are read by humans comparing columns, and a plain-text diff between two shapes is how they will be read.

### The signal set

**Mounts.** The mount table verbatim, as one `present(...)` block.

**Canonical engine sockets.** The two paths in `HOST_SOCKET_PATHS` at `container-check.js:75`, each with existence, whether it is a socket, its long-listing line verbatim, separately readable and writable test results, and a sibling `_dangling_symlink: yes | no` key.

**Chosen:** keep a dangling symlink classifying `absent`, and add the `_dangling_symlink` sibling key for the two canonical socket paths only. `absent` is the operationally correct answer to "is a socket reachable there", and folding a fourth state into the token would change a grammar shared by every key for the benefit of two of them. But for the canonical docker socket specifically, a symlink pointing at nothing is a genuinely distinct state — engine stopped and socket unlinked, rather than never installed — and it is exactly the sort of thing FAFF-646 would want separated. One symlink test separates them, so the fact is recorded beside the token rather than inside it. The rootless paths do not get the sibling key: their `absent` is the expected reading and a dangling one there says nothing FAFF-646 asked about.

**Rootless engine sockets, as their own labelled group.** The per-uid docker socket under `/run/user`, the podman socket under the XDG runtime directory, plus `DOCKER_HOST`.

**Chosen:** report the canonical and rootless sockets as two separately-labelled groups, never one list. `HOST_SOCKET_PATHS` excludes the rootless paths deliberately (`container-check.js:72–74`) because they are the recommended bounded posture under ADR-0041 decision 3 and must never read as a violation. A table listing all four together invites exactly the misreading the exclusion exists to prevent.

**Attestation evidence.** A labelled group answering: is a canonical socket present at all; if so, is our euid in a position to connect to it; and is there a rootless socket alongside. Nothing in this group is a verdict.

**Chosen:** add this group. `lights-out.js:351–357` proceeds on an operator's `engine_bounded` word, and no signal set here has ever recorded what would let FAFF-646 reason about whether that word could be given honestly on a runner. The group records facts only — whether this is a bounded engine is not answerable from inside the job at all, and the record says so rather than implying it.

**Chosen:** approximate connectability with the writable test rather than a connect attempt. POSIX `sh` cannot open a unix socket; connecting to one requires write permission, and the writable test calls `access(2)`, so this is a genuine necessary-condition proxy. It is recorded as a proxy, labelled as one, and never as proof. An open-for-read attempt on a live socket fails with ENXIO, so a healthy socket reads `unreadable(open-failed)` — the expected reading, not a finding.

**Containment signals.** `/.dockerenv`, `/run/.containerenv`, the `KUBERNETES_SERVICE_HOST` and `container` environment variables, `/proc/1/environ`, plus `/proc/1/cgroup` and pid 1's `comm`.

**Chosen:** record `/proc/1/cgroup` as a raw reading and mark it non-decisive in the table, citing `container-check.js:9–10` — the banner states the detector never parses it because it is empty under cgroup v2 and carries no container hint. Recording it is fine; presenting it as decisive in a record FAFF-646 will cite is not.

**Chosen:** from `/proc/1/environ`, emit key *names* only plus the full value of the `container` key, behind an `--environ-keys=names|count` flag defaulting to `names`. The key-name enumeration is itself a disclosure surface the prefix scan is blind to by design. On a hosted runner pid 1 is the VM's init, so names are safe and are the useful reading. On a self-hosted host pid 1 may be the runner service, and FAFF-656 may need to restrict it — the flag means FAFF-656 restricts by argument rather than by editing the instrument, which is what keeps "same instrument" true.

**The work directory.** The runner work path as seen inside the job, the running workflow's own checkout location within it, and a listing exactly one level deep with type and numeric owner per entry. No descent. On a hosted runner this is expected to be near-empty by construction — a per-job VM — and the reading is worth having precisely as the baseline FAFF-656's persistent reading is compared against.

**Reachability of the invoking user's home.** Existence, long-listing line, and open-and-read result for the home directory and for each entry one level inside it. Names and metadata only, never contents, never a digest.

**Chosen:** record reachability as long-listing output plus an open-and-read result, with no digest of any kind. The numeric long listing is POSIX-specified and gives mode, numeric uid and gid, and size without `stat`, whose format flags differ across GNU, BSD and busybox. The line is recorded verbatim as opaque provenance rather than parsed, so implementation variance in field layout costs nothing.

**Socket removal.** On `hosted-direct`, a same-job removal reading, explicitly labelled as a same-job removal. On `hosted-container`, `unmeasurable_here("hosted runner: the job container is started before any step runs, so no step can act on the host before it exists")`.

**Derived cross-check.** Where a `faff` binary is on PATH: `faff container-check --json` stdout and exit code, and the plain output so the warning line is captured. Where not: `impossible_on_shape("no faff binary on PATH")` for those keys and every raw signal still present.

### The findings record on disk

```
docs/spikes/2026-07-26-FAFF-654/
  probe.sh                       # the instrument, committed, the only one
  RESULTS.md                     # provenance + the observation table + column status; nothing else
  hosted-direct.txt              # raw probe transcripts, verbatim
  hosted-container.txt
  selftest-hosted-direct.txt     # self-test output, verbatim
  selftest-hosted-container.txt
  precheckout-hosted-direct.txt  # the pre-checkout work-directory listing
  precheckout-hosted-container.txt
```

**Chosen:** a directory under `docs/spikes/` following `2026-07-10-faff-411/`, not an ADR. It matches the established layout — that spike commits its own code beside its raw output and `RESULTS.md`. The website builds only `docs/guide` and `docs/concept`, so nothing here is published. And an ADR ends in a Decision section, which is a space that wants filling; FAFF-646's ADR is the right place for a decision and this artifact has nowhere to put one. `RESULTS.md` also drops FAFF-411's `Headline` section, which is the one place prose could state a finding.

**Chosen:** one shared directory and one table, owned by this ticket, which FAFF-656 extends. `RESULTS.md` carries a per-column `status` line: `obtained` for the two hosted columns, `owned_by: FAFF-656` for the two self-hosted ones. Not `unobtained` — they are not missing from this ticket, they are not this ticket's. A separate FAFF-656 record would give FAFF-646 two tables to reconcile.

## 4. HOW — behaviour

### Telling absent from unreadable in POSIX `sh`

`[ -e p ]` is false for both ENOENT and EACCES on an ancestor, so the test alone cannot distinguish them. The distinction is recovered by testing the ancestors first, and by taking the open and the read as two separate signals at the end.

```
PROCEDURE classify(path_template):
  0. Resolve the variable parts of path_template.
     IF any variable part is unset or empty:
        return unmeasurable_here("<VAR> unset: path not constructible")
     # the path is never assembled from a missing part and never tested
  1. Split the resolved path into its ancestor directories, root first.
  2. FOR each ancestor d, in order:
     a. IF NOT [ -d d ]:
        - IF [ -e d ]: return undecidable("ancestor-not-a-directory:" + d)
        - ELSE: return absent          # a genuinely missing ancestor is decisive
     b. IF NOT [ -x d ]: return undecidable("ancestor-not-searchable:" + d)
  3. # every ancestor exists and is searchable, so [ -e ] is now decisive
     IF NOT [ -e path ]: return absent
  4. IF NOT [ -r path ]: return unreadable("not-readable-by-euid")
  5. IF [ -d path ]: return present(<the detail this key calls for>)
     # a directory's readability is expressed by its listing, not a byte read;
     # a read on a directory returns EISDIR on Linux and would misclassify it
  6. Probe the OPEN on its own: redirect the path into a no-op command in a subshell,
     with stderr discarded. Its status alone answers whether the open succeeded.
     a. IF it failed: return unreadable("open-failed")   # e.g. ENXIO on a live socket
  7. Read the FIRST BYTE into a scratch file, so the reader's own status survives:
     the one-byte read with an output-file operand, both streams discarded.
     rc := the reader's exit status
     n  := the character count of the scratch file
     Remove the scratch file before returning.
     a. IF rc is non-zero:  return unreadable("read-failed")
     b. IF n is 0:          return present("empty")
     c. return present(<the detail this key calls for>)
```

**Chosen:** take the open attempt and the byte count as two separate signals rather than reading both out of one exit status. A single status cannot carry both — measured, the one-byte read exits 1 for a missing path, an unreadable file, a procfs file whose open succeeds, and a directory, and exits 0 for both an empty file and a file with bytes. And a pipeline cannot carry the reader's status at all in POSIX `sh` — measured, a failing read piped into the counter reports success with zero bytes. So the open is probed by redirection, the read goes to a scratch file, and the counter supplies the count. Four outcomes from POSIX parts, with no error text parsed and no byte printed.

**Chosen:** the scratch file rather than a pipe, and it is not stylistic. The pipeline reports its last command's status, and POSIX `sh` has no portable way to reach further back — so the failing case reads as success. That is the exact silent-wrong-answer this classifier exists to prevent.

**The no-content property is preserved.** The character counter emits a count and never the byte; the scratch file is removed before the function returns and is never printed. The five-exception guarantee below needs no sixth entry.

**Chosen:** `present("empty")` means *the read succeeded and obtained no bytes* — not *the file is empty*. Where a kernel refuses at read time with an error, step 7a catches it and the key reads `unreadable(read-failed)`. Where one instead returns success with zero bytes, `present("empty")` is the honest reading, and the token's stated meaning is what stops it being read as content. `RESULTS.md` states this definition once, in provenance.

**Chosen:** the directory short-circuit at step 5 stays and is load-bearing — measured, the one-byte read on a directory exits 1, so without it every directory would misclassify as unreadable.

Step 2a's `absent` is honest: if an ancestor is itself searchable-up-to-that-point and genuinely missing, the leaf cannot exist. Step 2b is the case `[ -e ]` alone would have silently called `absent`, and it gets its own token naming the directory that blocked the walk.

**Chosen:** step 0, an unconstructible path returns `unmeasurable_here` and is never tested. The podman socket path built from the XDG runtime directory, with that variable unset — the common case in a non-login Actions shell — assembles to a bare path that walks cleanly and lands on `absent`. That would record a rootless podman socket as observed-absent when no path was ever tested. Every signal built from a variable takes the same route:

| Signal | Variable part | Reading when unset |
|---|---|---|
| Rootless podman socket | the XDG runtime directory | `unmeasurable_here("... unset: path not constructible")` |
| Rootless docker socket | euid from `id -u` | `unmeasurable_here("id -u failed: path not constructible")` |
| Invoking user's home | `HOME` | `unmeasurable_here("HOME unset: path not constructible")` |
| Runner work directory | `RUNNER_WORKSPACE`, then `GITHUB_WORKSPACE` | `unmeasurable_here("no runner workspace variable set: path not constructible")` |

The work-directory row matters beyond Actions: when the probe is hand-run off a runner, both variables are unset, and the honest reading is that the methodology had no work directory to look at — not that the runner's work directory was absent.

**The euid caveat, stated rather than hidden.** The search and read tests call `access(2)`, which grants both to uid 0 almost everywhere. Inside a container image the job commonly runs as root, so `undecidable(ancestor-not-searchable)` and `unreadable(not-readable-by-euid)` may both be structurally unreachable, and a path a non-root job could not have decided will read `absent` or `present`. That is a property of the reading, not a defect, and it is why `probe_euid` is a header field: every classification in a transcript is relative to it. `RESULTS.md` states this once, as provenance.

**Anti-pattern:** using `stat` to recover an errno. Why: it is not POSIX, and its format flags differ across GNU, BSD and busybox — a probe that has to run in a minimal container image cannot depend on it.

**Anti-pattern:** parsing the text of an error message to classify a failure. Why: the wording is implementation- and locale-dependent, so the classification would silently change with the image.

**Anti-pattern:** using a byte-count flag on `head` for the step 7 read. Why: that flag is not in POSIX `head`, and busybox and GNU differ on what they report when the read fails, which puts the classification back on parsed behaviour rather than an exit status.

### The probe

**What it does:** reads a fixed list of signals and prints them in a fixed order, on any Linux machine with a POSIX shell, depending on nothing from GitHub Actions or from faff.

**Chosen:** a POSIX `sh` script at `docs/spikes/2026-07-26-FAFF-654/probe.sh`. Node is out because the containerised shape runs under an image the measurement picks, and requiring a Node runtime narrows the image choice for readings that are file and `/proc` reads a shell does natively. Inline workflow steps are out because they cannot be hand-run off Actions and a step edited between shapes silently stops being the same instrument. Requiring a POSIX shell already rules out a distroless image, so the remaining question is only which shell-carrying image.

```
PROCEDURE probe(shape_label, environ_keys_mode):
  1. Print the provenance header. probe_cksum from cksum over the script; probe_sha256
     from a digest tool if one is on PATH, else unmeasurable_here("no-digest-tool");
     probe_bytes always. probe_euid from id -u.
  2. FOR each signal key in the fixed order:
     a. Classify per the procedure above and print `key: <value token>`.
     b. Never skip a key. Never let a failed read end the run.
  3. IF a faff binary is on PATH: run faff container-check --json and plain, printing
     stdout and exit code under keys marked as a derived cross-check.
     ELSE: print those keys as impossible_on_shape("no faff binary on PATH").
  4. Exit 0 unconditionally.
```

**Chosen:** the probe always exits 0 and never aborts on a failed read. A non-zero exit fails the workflow job and loses the transcript from the shape whose reading was most interesting — an unreadable file is a finding, not an error. This mirrors the never-throws discipline of `realFsq()` while keeping the distinction `realFsq()` collapses.

**Chosen:** identity by `cksum` first, a strong digest opportunistically, byte count always. `cksum` is POSIX-specified and present in coreutils and busybox, so it is a far smaller ask of a container image. It is weak against an adversary and strong enough for the actual question, which is "did the same bytes run" — nobody is attacking this artifact, and the strong digest is recorded too wherever a tool exists.

**Anti-pattern:** having the probe compare shapes, compute a verdict, or print anything conditional on what it found. Why: the probe becomes where the conclusion lives, drawn by whoever wrote the script rather than by the reader of the table.

### Portability, made verifiable here

**Chosen:** the probe carries a `--selftest` mode, spelled to match the repo's existing convention. It is this ticket's answer to FAFF-656 running the instrument unchanged on a machine this ticket never sees.

```
PROCEDURE selftest:
  1. Build a fixture tree under a temp directory:
     a. a file that exists, is readable, and has bytes
     b. a path that genuinely does not exist
     c. a file inside a directory with mode 0000
     d. a dangling symlink
     e. a mode-0000 file inside a searchable directory
     f. a path whose ancestor is a regular file
     g. a key template naming a variable the selftest explicitly unsets
     h. an empty file, created by truncating redirection
     i. a path under a genuinely missing ancestor directory
     j. a directory
  2. Run classify() over each and assert the token it returns:
     a -> present(...)
     b -> absent
     c -> undecidable(ancestor-not-searchable:...)
     d -> absent, with the dangling-symlink sibling key reading yes
     e -> unreadable(not-readable-by-euid)
     f -> undecidable(ancestor-not-a-directory:...)
     g -> unmeasurable_here(... unset: path not constructible)
     h -> present("empty")
     i -> absent, via the ancestor walk rather than the leaf test
     j -> present(...), via the directory short-circuit
  3. IF euid is 0, cases (c) and (e) cannot fire: print each as
     unmeasurable_here("euid 0: access(2) grants search and read regardless")
     and do NOT fail on them.
  4. Print one line per case naming the case, the expected token, the observed token,
     and PASS / FAIL / SKIPPED-EUID-0; then a summary line reading
     `selftest: <n> passed, <n> skipped (euid <e>), <n> failed`.
  5. Exit non-zero on any FAIL. A SKIPPED case is never a FAIL.
```

**Chosen:** build every fixture inside the temp tree rather than using a system path. A path under the fixture tree is self-contained, so each case behaves identically on a host with an unusual filesystem layout and the selftest keeps its no-dependency property.

**Chosen: `unreadable(open-failed)` and `unreadable(read-failed)` get no fixture, and the gap is stated rather than left silent.** Reaching the first needs a file whose readable test passes and whose open then fails — in practice a unix socket returning ENXIO, or a device node. POSIX `sh` cannot create a socket, `mknod` needs root and a specific device, and the obvious stand-in, a FIFO, is worse than nothing because opening one for read with no writer blocks and there is no portable timeout to bound it. No portable fixture makes a read fail after a successful open either.

So both tokens are exercised only in the field, and possibly not even there. **Measured during the amendment: pid 1's environ — the canonical example of open-succeeds-read-fails — fails at *open* on the machine tested, not at read.** So `unreadable(read-failed)` may have no field demonstration at all. `RESULTS.md` states this: every self-test case is fixtured; two tokens have no case at all; and for each of them the record either names the transcript and key that demonstrated it, or records that it was not observed in this run.

**What each euid can actually demonstrate.** This is the honest coverage statement, and it is what `RESULTS.md` carries:

| Case | Token | Non-root run | euid 0 run |
|---|---|---|---|
| a | `present(...)` | exercised | exercised |
| b | `absent` (leaf test) | exercised | exercised |
| c | `undecidable(ancestor-not-searchable)` | exercised | skipped — access grants search |
| d | `absent` + dangling sibling | exercised | exercised |
| e | `unreadable(not-readable-by-euid)` | exercised | skipped — access grants read |
| f | `undecidable(ancestor-not-a-directory)` | exercised | exercised |
| g | `unmeasurable_here(unset)` | exercised | exercised |
| h | `present("empty")` | exercised | exercised |
| i | `absent` (ancestor walk) | exercised | exercised |
| j | `present(...)` (directory short-circuit) | exercised | exercised |
| — | `unreadable(open-failed)` | no fixture — see above | no fixture |
| — | `unreadable(read-failed)` | no fixture — see above | no fixture |

**Chosen:** the portability guarantee rests on at least one committed **non-root** self-test run, and the criterion says so. Under euid 0 the two permission cases skip, which is not a demonstration of the tokens this spec's central principle is about. `hosted-direct` is expected to run as a non-root user, so the directory as a whole should carry one non-root run; that is an expectation checked at run time, not an assertion. If both hosted runs come back at euid 0, `RESULTS.md` records that no non-root demonstration was obtained on this ticket and FAFF-656 must obtain one before relying on the instrument.

**Dismissed:** re-running the self-test as an unprivileged user inside the containerised job to close the euid-0 gap. It would work, but it adds a run-day dependency on a privilege-dropping tool being present in whichever image is chosen and on an unprivileged account existing in it — precisely the class of snag a half-day timebox cannot absorb, for a gap the `hosted-direct` run already covers.

### Getting the two readings

A new `.github/workflows/job-surface-probe.yml`, dispatch-only, with a required `shape` input and one job per hosted shape gated on it. It does not join `validate.yml` and does not run on pull requests — `validate.yml` runs on every PR and push to main, and a probe there is cost and noise on every change. It is kept after the run so the transcripts stay reproducible.

**Chosen:** this workflow declares only hosted-runner jobs and no self-hosted label. FAFF-656 adds its jobs when it has a host to point them at. A committed job whose label matches nothing is a small lie in the repository, and with the split there is no reason to tell it.

**Chosen:** `permissions: contents: read` at workflow level, matching `validate.yml:9` and `governance.yml:27`. A workflow whose entire purpose is to enumerate what a job can reach must not run on the repository default.

**Chosen:** the container image is pinned by digest, and the named trust source is recorded: the digest is resolved by the operator from the official `debian:bookworm-slim` tag on the day, with the resolving command and its output pasted into the provenance notes and the tag recorded alongside the digest. A digest with no stated origin is unverifiable later; a digest plus the command that produced it can be re-run.

**Chosen:** every committed file is produced by the job and retrieved as a workflow artifact, never retyped. Each job writes the probe stdout, the self-test stdout, and the pre-checkout listing to files under the runner temp directory, then uploads all three under the shape's name. The operator downloads the artifact and commits the files verbatim into the spike directory. This is what makes the criteria checkable by someone who was not present: the committed bytes are the job's bytes.

**Chosen: the pre-checkout listing is its own committed file per shape, not a key in the probe transcript.** The record model is one text stream per probe run with a fixed key set, and the probe runs after checkout — so the earlier listing has no key it could occupy without breaking the fixed key set. Its own file keeps both properties: the transcript stays one probe run, and the earlier reading is a committed artifact rather than a workflow log line that expires. The file opens with a fixed four-line preamble the workflow step writes:

```
precheckout_shape: <shape>
precheckout_command: <the exact command run, verbatim>
precheckout_captured_at: <timestamp>
precheckout_euid: <id -u>
```

followed by the listing verbatim.

**Chosen:** `RESULTS.md` carries a per-column `worktree_changed_by_checkout: yes | no` line, derived as follows: it is `yes` when the set of entry names one level deep differs between the pre-checkout file and the probe transcript's work-directory listing; `no` when those two sets are equal. Names only — not byte equality, not owner or mode, which move for reasons unrelated to checkout. Stating the derivation is what makes the field checkable by a reader who was not present.

### Keeping credentials out of the committed transcripts

**The primary defence is structural: the probe has no code path that prints the bytes of a file it classified.** Every file-facing key emits a token, a long-listing line, or a name. That guarantee has exactly five exceptions, and they are the complete list:

1. the mount table, printed verbatim;
2. the `/proc/1/environ` key *names* (never values), under the names mode;
3. the value of the `container` key from `/proc/1/environ`, printed in full;
4. long-listing lines, which carry mode, numeric uid and gid, size and name;
5. `faff container-check` stdout, both JSON and plain.

Nothing else in the probe writes bytes obtained from a measured file. The scan below is a backstop on that guarantee, not the guarantee itself.

```
PROCEDURE commit_scan(files):
  1. FOR each line of each committed file in the spike directory:
     a. Match each known-prefix value from config.js:859-862 ANYWHERE in the line —
        the ten values as listed at that location, read by eye and copied.
     b. Match each pattern from config.js:864 as a pattern, not a fixed string.
     c. Split the line at the first key-value separator. IF the key part matches the
        repo's credential key-name pattern and does not end in _env, AND the value part
        matches the repo's generic high-entropy value pattern, flag it.
  2. IF any hit: stop, do not commit, fix the probe so that key emits metadata rather
     than content, re-run that shape, rescan.
  3. Commit only after a clean scan.
```

**Chosen:** port all three branches of `secretScanLeaf` (`config.js:870–880`), not just the prefix list, even though the third branch is close to inert against this record's own format. Copying one branch would certify a transcript clean against a list that structurally cannot match a prefix-less credential at all, and FAFF-656 — which handles a runner registration token, exactly that class — inherits this scan.

**Chosen:** copy the values rather than import them, and say plainly what the copy cannot catch. The prefix constant is module-private at `config.js:859` and absent from the exports at `:1556`, so it cannot be required; and the exported `secretScanLeaf` anchors its comparison at the start of the value at `:872`, which never fires on a transcript line where a token sits mid-line after a key name. Matching prefixes anywhere in the line is deliberately stronger than the source's anchored form.

**What the ported scan cannot catch, stated in full:**

- A prefix-less credential under a key name outside the credential key-name gate, or one containing a dot, colon or slash, which the generic value pattern excludes by design.
- **Essentially anything in this record's own format.** The generic-high-entropy branch — the one branch that can fire on a credential with no recognisable prefix — is close to inert here, for two independent reasons. Every value line in a transcript is a grammar token, and every token but `absent` carries parentheses, which fall outside the generic value pattern's permitted characters. And the verbatim blocks that could carry raw material — mount lines, long-listing lines, the pre-checkout listing — have no key-value separator to split on, so branch (c) never reaches its value test at all. The prefix branches do work on this format, because they match anywhere in the line.

So the honest position is: the prefix branches are a real backstop on this record, the generic branch is carried for FAFF-656 rather than earning its place here, and the structural guarantee above with its five named exceptions is what actually keeps credentials out. Calling the scan the guarantee would be an overclaim.

**Anti-pattern:** calling `secretScanLeaf` per line and treating a null return as clean. Why: it anchors at character zero of the value, so it gives a false all-clear on exactly the file it was added to protect.

### What "recommends no mechanism" means, checkably

**Chosen:** rest the defence on one form constraint, demote the word list to advisory, and scope the mechanical claim to the lines it actually decides. The constraint:

> Every line of `RESULTS.md` is one of: a provenance header field, a table row, a table caption, a column-status line, a heading, or the `notes` field's content. Every cell in the observation table matches the value grammar in section 3 — or is a signal name, a shape name, or the literal `non-decisive` marker. Every caption matches the fixed template below.

**Chosen: captions get a fixed template, so the caption class is decidable mechanically rather than by judging grammatical role.**

```
Table: <group-name> — <N> signals — shapes: <shape>[, <shape>]*
```

A caption names what was tabulated and nothing else; the template admits only a lowercase group name, a count, and a comma-separated shape list, so it cannot carry a clause and the question "is this line a caption or a sentence" never arises.

**Chosen: `notes` is the one free-prose class, it is reviewed by eye, and the acceptance says so rather than claiming otherwise.** The field exists to hold pasted provenance — the digest-resolving command and its output, the image-tooling check's output, the record of any fallback taken — and none of that survives a template. So the mechanical claim is scoped: the line-class check decides every line of `RESULTS.md` except the `notes` field's content, and every cell of the observation table. The `notes` content gets two non-mechanical treatments instead: the advisory word-list check runs over it specifically and its hits are recorded with a reason each, and an operator attestation records that it was read.

**Named honestly:** the form constraint does not close the no-recommendation hole either. A table can imply a recommendation by what it puts side by side, and no constraint on cells prevents that. What the constraint buys is that the implication has to be the reader's, made from tokens the instrument produced, rather than the record's, asserted in a sentence. That is a real reduction and not a guarantee, and `RESULTS.md` should not claim otherwise.

### Failure modes

- **The probe reads as root and neither permission token ever fires.** Under a container image the job commonly runs as uid 0, so search and read are granted everywhere and the self-test cases (c) and (e) both skip. *How you'd know:* the `hosted-container` transcript has `probe_euid: 0`, zero `undecidable(ancestor-not-searchable)` and zero `unreadable(not-readable-by-euid)` readings, and its selftest output reports two skipped cases. *What it means:* not a defect — but the two columns are not comparable on that axis, and `RESULTS.md` must carry the euid on every column so a reader sees it before the rows. If *both* hosted runs come back at euid 0, the directory carries no non-root demonstration at all and that must be recorded as an unmet criterion, not glossed.
- **The step 7 byte read hangs on some path.** A FIFO opened for read with no writer blocks, and the reader will sit there. *How you'd know:* a job times out with a partial transcript. *What it means:* the signal set contains no FIFO today, so this is a hazard rather than an expected case — but if it fires, the fix is to test for a FIFO before step 6 and classify it as `present(fifo)` without reading it, not to add a timeout the probe cannot portably obtain.
- **The container image determines the containment reading.** `/.dockerenv` is written by the engine and should be image-independent; `/run/.containerenv` is a podman artifact. *How you'd know:* a containment signal moves when only the image changed. *What it means:* pin and record the image; if it moves, run a second image as a control before recording either reading as a property of containerisation rather than of the image.
- **The image lacks a tool the job needs, rather than one the probe needs.** *How you'd know:* the checkout action fails before the probe ever runs, or falls back to the API tarball and then fails on a missing archiver. *What it means:* this is the run-day snag most likely to eat the timebox, which is why the validation step checks the job's tools as well as the probe's — see the assumption in section 7.
- **`cksum` is missing from the chosen image.** *How you'd know:* the header's `probe_cksum` comes back empty on one shape. *What it means:* fall back to `probe_bytes` for identity, record the fallback in notes, and treat it as a reason to prefer a different image rather than to weaken the criterion.
- **Both hosted columns read identically.** *How you'd know:* the diff of the two transcripts' signal blocks is empty apart from the header. *What it means:* a valid and useful result, not a failed spike — it says the job container key does not move the coordinates FAFF-646 cares about on a hosted runner. It must be *stated*, not left for a reader to notice, which is why `columns_identical` is a computed provenance field rather than an observation.
- **The half day goes.** *How you'd know:* the day ends with fewer than two transcripts. *What it means:* commit the instrument and whatever transcripts exist, mark the missing hosted column's status `unobtained` with the reason, and comment the partial table on the ticket. FAFF-656 stays blocked either way, so a partial hosted record misleads nobody.

## 5. Scenarios

> 4 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a path whose parent directory has mode 0000 and the probe is not running as root
When the transcript is read
Then that key reads undecidable naming the directory that blocked the walk — not absent,
  not unreadable, and not omitted
```

```
Given a signal path built from an environment variable that is unset in the job's shell
When that key is read in the transcript
Then it reads unmeasurable_here naming the variable, and no mangled path was tested —
  not absent
```

```
Given the probe runs on the hosted-container shape
When the socket-removal keys are read
Then they read unmeasurable_here with the reason that the job container is started
  before any step runs — not impossible_on_shape
```

```
Given the two hosted transcripts have been captured
When their signal blocks are compared
Then RESULTS.md carries a computed columns_identical field stating yes or no, so an
  identical pair is recorded as an observation rather than passing silently
```

```
Given an empty file
When the probe classifies it
Then the key reads present("empty") — distinct from absent and from unreadable
```

- Every committed transcript MUST carry the same signal key set in the same order as every other committed transcript, comparable key by key.
- No committed file under `docs/spikes/2026-07-26-FAFF-654/` MUST match any of the three scan branches ported from `config.js:870–880`.
- The probe MUST exit 0 on every shape, including one where every credential-facing read fails.
- Every caption line in `RESULTS.md` MUST match the fixed caption template; the only free-prose lines in the file are the `notes` field's content.
- The work-directory listing MUST be exactly one level deep: no recorded entry contains a path separator, and no entry's children appear.
- For each obtained shape, a pre-checkout listing file MUST exist in the committed directory carrying the four-line preamble and the listing verbatim.

## 6. Design decision rationale

**Both hosted shapes, or only `hosted-direct`?**
One column is cheaper by a job. Two separate the job container key's effect from host persistence, which is the only thing that makes FAFF-656's columns interpretable.
**Chosen:** both.

**How does the probe tell absent from unreadable?**
The existence test alone collapses them. `stat` is not POSIX and its flags differ across implementations. Parsing error text is locale-dependent. An ancestor-searchability walk recovers the distinction using only POSIX tests, at the cost of being euid-relative.
**Chosen:** the ancestor walk, with `probe_euid` in the header and the root-user limit stated in `RESULTS.md`.

**Does the classifier test open, or read?**
Both, separately. One exit status cannot carry both answers — measured, it splits failed from succeeded, which is orthogonal to the split needed. A pipeline cannot carry the reader's status at all in POSIX `sh`, and reports success on a failing read.
**Chosen:** probe the open by redirection, read the first byte into a scratch file, count the file — with `unreadable(open-failed)`, `unreadable(read-failed)` and `present("empty")` as three distinguishable outcomes, and directories short-circuited before the read.

**What happens to a path built from an unset variable?**
Assembling it anyway produces a path that walks cleanly to a confident `absent` for a thing that was never tested.
**Chosen:** an unconstructible path returns `unmeasurable_here` naming the variable, applied to all four variable-built signals, and never tested.

**Does a dangling symlink deserve its own token?**
For "is a socket reachable there", `absent` is the right answer and a fourth socket state does not belong in a grammar every key shares. But engine-stopped-and-unlinked is a state FAFF-646 would want separated from never-installed.
**Chosen:** keep `absent`, add a `_dangling_symlink` sibling key on the two canonical socket paths only.

**How are home and credential readings recorded?**
Contents are out. A truncated digest of a constrained-format file is a content oracle against a permanently public artifact.
**Chosen:** long-listing plus an open-and-read result, no digest of any measured file. The only digest anywhere is the probe's own, where the file is public by construction and the oracle argument does not apply.

**How is "recommends no mechanism" checked?**
Reviewer judgement is what failed the first time. A word list is judgement with vocabulary attached, is bypassable without using a banned word, and cannot be evaluated mechanically once it asks about grammatical role — and neither can a caption class defined as "a line naming what was run".
**Chosen:** a grammar constraint on the table's cells plus a fixed caption template, with `notes` named as the single by-eye class, the word list demoted to advisory, and the residual hole named in the record rather than papered over.

**Where does the pre-checkout listing live?**
Inside the probe transcript it has no key, because the probe runs after checkout and the key set is fixed. In the workflow log it expires and nobody who was not present can check it.
**Chosen:** its own committed file per shape with a fixed four-line preamble, retrieved as a workflow artifact, and reduced into `RESULTS.md` as a `worktree_changed_by_checkout` column-status line with a stated derivation.

**Digest tool for the probe's own identity?**
A strong digest tool is absent from minimal images. `cksum` is POSIX and ships with busybox.
**Chosen:** `cksum` plus byte count always, a strong digest opportunistically, and the criterion scoped to what was obtained.

**ADR, or a spike directory?**
An ADR ends in a Decision section, and an empty one is an invitation.
**Chosen:** `docs/spikes/2026-07-26-FAFF-654/` following FAFF-411's layout, `RESULTS.md` without a `Headline` section.

**One record here, or a partial one FAFF-656 completes?**
Two records give FAFF-646 two tables to reconcile. One table with per-column status keeps the four columns lined up and makes a missing column visible rather than absent.
**Chosen:** one directory and one table, owned here, extended by FAFF-656 via a `status` line per column.

## 7. Open questions and assumptions

### Open questions

**Punt:** whether an actions-runner-controller pod on Kubernetes is a third shape worth measuring or a variant of the containerised one — needs human (decides: architecture). It is tempting to close by construction on the grounds that `KUBERNETES_SERVICE_HOST` is `containerCheck`'s first precedence rung. That does not hold: the variable comes from service-link injection, which a pod spec can switch off, and with it off under containerd `/.dockerenv` is absent, `/run/.containerenv` is a podman artifact, and pid 1's `container=` is not reliably set — so the same pod could plausibly read `not_confirmed`. That is a real, non-obvious reading and it is not derivable from this repository. Measuring it needs a cluster and a controller install, which is outside a half-day. It belongs on its own Backlog ticket related to FAFF-654 and FAFF-646, carrying that reason, so `RESULTS.md` names a ticket rather than a gap.

**Punt:** whether the advisory word-list check is worth keeping at all once the grammar constraint is in place — needs human (decides: qa). Kept for now because it costs nothing, its hits are reviewed rather than gating, and it is the only automated treatment the `notes` field gets; dropped without argument if it proves to be noise.

### Assumptions

**Assumes:** the image chosen for the containerised job carries what the probe needs *and what the job needs* — a POSIX shell, the listing and id utilities, `cksum`, plus git and an archiver. *Validate:* before the reading, run a presence check for all six inside the image as a workflow step and record the output in the provenance notes. Git and the archiver are for the checkout action, not for the probe: checkout uses git when present and falls back to downloading an API tarball when it is not, which then needs the archiver. It also injects its own Node runtime, so the image must be glibc-compatible — `debian:bookworm-slim` is, which is why it is the named candidate. If `cksum` is missing, the header falls back to `probe_bytes` and the note says so; if the shell is missing the image is not a candidate at all; if git and the archiver are both missing, checkout fails before the probe runs and the image must be replaced.

**Assumes:** no self-hosted runner infrastructure exists in this repository, so this ticket's workflow declares hosted jobs only. *Validate:* grep `.github/` and `scripts/` for a self-hosted label — at the time of writing this returns nothing, and no workflow declares a job-level container key either. If FAFF-609's rig has landed since, that changes nothing here; it changes FAFF-656.

**Assumes:** the four credential-shape constants in `config.js` remain the repo's definitions. *Validate:* open `config.js:859–880` and read all four by eye before scanning, confirming the copied values match. They cannot be imported — the constants are module-private and absent from the exports at `:1556` — so this is a copy that can drift, and reading the source is the only check available.

## 8. DONE

### From WHY — mechanically checkable
- [ ] Every reading in every committed transcript is one of the six value-grammar tokens; no signal key is omitted from any transcript.
- [ ] No committed file under `docs/spikes/2026-07-26-FAFF-654/` matches any of the three scan branches ported from `config.js:870–880`.
- [ ] No committed transcript contains a digest of any measured file; the only digest fields are `probe_cksum` and `probe_sha256` in the header.

### From WHAT — mechanically checkable
- [ ] `docs/spikes/2026-07-26-FAFF-654/` exists and contains `probe.sh`, `RESULTS.md`, and per obtained shape: one probe transcript, one self-test output, and one pre-checkout listing file.
- [ ] Every transcript carries a provenance header with `probe_version`, `probe_cksum`, `probe_sha256`, `probe_bytes`, `shape`, `source_repository`, `probe_euid`, `captured_at`, `runner_os`, `runner_arch`, `container_image`, and `environ_keys_mode`.
- [ ] `probe_cksum` is identical across every transcript obtained, and matches `cksum` over the committed `probe.sh`.
- [ ] The canonical and rootless socket paths appear as two separately-labelled groups in both the transcripts and `RESULTS.md`.
- [ ] Each canonical socket path carries a `_dangling_symlink: yes | no` sibling key; the rootless paths do not.
- [ ] `/proc/1/environ` is reported as key names plus the `container=` value only; no full dump appears in any transcript.
- [ ] `/proc/1/cgroup` appears in the table marked `non-decisive`, with the `container-check.js:9–10` citation in `RESULTS.md`'s provenance.
- [ ] The attestation-evidence group reports, per canonical socket, existence, socket-type, the long-listing line, and readable/writable test results, and states in `RESULTS.md` that the writable test is a proxy for connectability, not proof.
- [ ] Home-directory reachability reports existence, a long-listing line, and an open-and-read result, and no contents.
- [ ] The work-directory listing is exactly one level deep, with type and numeric owner per entry, and identifies the running workflow's own checkout.
- [ ] `RESULTS.md` carries a per-column `status` line: `obtained` for each hosted column captured, `owned_by: FAFF-656` for both self-hosted columns.
- [ ] `RESULTS.md` carries a computed `columns_identical` field and a per-column `worktree_changed_by_checkout` field, the latter derived as the entry-name set difference stated in section 4.

### From HOW — mechanically checkable
- [ ] `probe.sh` is POSIX `sh`, runs with no dependency on the CI system or on faff, and exits 0 on every shape.
- [ ] `classify()` returns `unmeasurable_here` naming the variable for each of the four variable-built signals when its variable is unset, and assembles no path from a missing part.
- [ ] `classify()` probes the open separately from the read, returning `unreadable(open-failed)`, `unreadable(read-failed)` or `present("empty")` as three distinct outcomes; directories short-circuit before the read; the read goes to a scratch file, never a pipe.
- [ ] `RESULTS.md` states in provenance that `present("empty")` means the read succeeded and obtained no bytes, and is not a claim that the file is empty.
- [ ] `probe.sh --selftest` builds all ten fixture cases, asserts each case's token, prints case / expected / observed / status per case plus the passed/skipped/failed summary, exits non-zero on any mismatch, and reports cases (c) and (e) as `unmeasurable_here` rather than failing them when euid is 0.
- [ ] At least one committed self-test output has a non-zero euid and reports zero skipped cases; if none does, `RESULTS.md` records that no non-root demonstration was obtained and names FAFF-656 as owing one.
- [ ] For each of `unreadable(open-failed)` and `unreadable(read-failed)`, `RESULTS.md` either names the transcript and key that demonstrated it, or records that it was not observed in this run. The bare claim that it is demonstrated by transcript is not sufficient on its own.
- [ ] `RESULTS.md` states that both those tokens have no fixture and why no portable fixture exists.
- [ ] `probe.sh` accepts `--environ-keys=names|count` and the shape label as arguments; no shape requires editing the file.
- [ ] `probe.sh` records `faff container-check` JSON output, the plain output, and the exit code where a binary is on PATH, marked as a derived cross-check; and `impossible_on_shape` naming the missing binary where it is not.
- [ ] `.github/workflows/job-surface-probe.yml` exists, is dispatch-only, takes a required `shape` input, gates every job on it, declares `permissions: contents: read`, and is not referenced from `validate.yml`.
- [ ] Every job in that workflow targets a hosted runner; no self-hosted label appears anywhere in it.
- [ ] The containerised job declares a job-level container key with a digest-pinned image, and that image string appears verbatim in that transcript.
- [ ] The containerised job runs the six-tool presence check before checkout and its output is pasted into `RESULTS.md`'s provenance notes.
- [ ] The workflow runs a bare work-directory listing step before checkout, writes it with the four-line preamble to the runner temp directory, and uploads it with the probe transcript and the self-test output; each obtained shape's pre-checkout file is committed verbatim from that artifact.
- [ ] The containerised transcript reports the socket-removal keys as `unmeasurable_here` with the no-host-side-hook reason.
- [ ] The `hosted-direct` same-job removal reading is labelled in `RESULTS.md` as a same-job removal.
- [ ] `RESULTS.md` states the euid caveat once, in provenance, before the table.
- [ ] `RESULTS.md` states the structural no-byte-emitting guarantee together with its five named exceptions, and states the ported scan's coverage gap including that the generic branch is close to inert against this record's format.
- [ ] Every line of `RESULTS.md` other than the `notes` field's content is a provenance field, a table row, a caption matching the fixed template, a column-status line, or a heading; every table cell matches the value grammar, a signal name, a shape name, or `non-decisive`. `RESULTS.md` states that `notes` is the one line class reviewed by eye.
- [ ] `RESULTS.md` has no `Headline` section and no Decision section.
- [ ] `RESULTS.md` names the actions-runner-controller shape as unmeasured and cites the ticket filed for it.

### From the ticket's own acceptance — mechanically checkable
- [ ] A comment on FAFF-654 carries the same observation table as `RESULTS.md` and links the committed directory.
- [ ] No CLI command was added; the command registry and `docs/guide/cli.md` are unchanged and `faff lint-cli-doc` passes.

### Operator attestations — not mechanically checkable, recorded as statements in the provenance notes
- [ ] The operator attests that the copied scan values were read by eye against `config.js:859–880` before the scan was run.
- [ ] The operator attests that the pinned image digest was resolved from the named tag on the day, with the resolving command and its output pasted into the provenance notes.
- [ ] The operator attests that the `/proc/1/environ` key-name block was read before commit and carries no value material.
- [ ] The operator attests that the `notes` field's content was read by eye for findings language, and records the advisory word-list hits, if any, and why each was left in.

### Integration smoke test

```
PROCEDURE smoke:
  1. Run probe.sh --selftest as a non-root user on any Linux box. Assert exit 0, that
     all ten fixture cases printed PASS with their expected token, and that the
     summary line reports zero skipped and zero failed.
  2. Run probe.sh by hand on the same box with an engine socket present.
  3. Assert stdout carries the provenance header, then every signal key in the fixed
     order, each with exactly one value-grammar token.
  4. Assert the canonical-socket group reads unreadable(open-failed) for the live
     socket — the expected healthy reading — and that the rootless group is emitted as
     its own separately-labelled group.
  5. Unset the XDG runtime directory variable and re-run. Assert the podman key reads
     unmeasurable_here naming the variable, and that no key reads absent for it.
  6. Assert the work-directory listing contains no line with a path separator in an
     entry name.
  7. Assert that the only file-derived content in stdout is the five named exceptions.
     Assert no other line contains bytes from any file the probe classified.
  8. Assert the exit code is 0.
```

If that passes, the instrument works and the only remaining variable is which machine it runs on.

confidence: medium
