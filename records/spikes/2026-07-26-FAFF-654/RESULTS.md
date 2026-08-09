# FAFF-654 — what a GitHub-hosted Actions job exposes

## Provenance

record_for: FAFF-654
consumed_by: FAFF-646
instrument: probe.sh
instrument_version: 1
observation_table: four shapes obtained — hosted-direct, hosted-container, selfhosted-direct and selfhosted-container; the Signal roster below carries a value column per shape, each cell taken verbatim from that shape's transcript. Every classification is relative to that transcript's probe_euid (see euid_caveat)
selfhosted_substrate: fly.io Machine (Firecracker microVM) — evidenced in both self-hosted transcripts by the fly overlay rootfs (none / overlay lowerdir=/lower/dev/vda:/lower/dev/vdc) and, on the direct shape, the /dev/vdb /.fly-upper-layer ext4 mount. The Machine is built from ubuntu:24.04 plus actions-runner 2.336.0 plus dockerd on the vfs storage driver; size shared-cpu-2x / 2gb, region lhr. Its image lives in a private registry (registry.fly.io/fly-ci-runner-probe), so the image digest is not publicly re-pullable and is not recorded here; the reading is reproducible-in-kind from those build inputs rather than by digest. The self-hosted shapes were probed with --environ-keys count where the hosted shapes used names — a deliberate per-shape difference: only the environ_keys reading's presentation changes (a count with names withheld rather than the key names), the key set pid 1 carries is otherwise the same
euid_caveat: the search and read tests call access(2), which grants both to uid 0 almost everywhere, so undecidable(ancestor-not-searchable) and unreadable(not-readable-by-euid) may be structurally unreachable on a shape whose job runs as root; every classification in a transcript is relative to that transcript's probe_euid
empty_definition: present("empty") means the read succeeded and obtained no bytes; it is not a claim that the file is empty
cgroup_decisiveness: non-decisive — container-check.js:9-10 records that the detector never parses /proc/1/cgroup because it is empty under cgroup v2 and carries no container hint
writable_proxy: connecting to a unix socket requires write permission, so the writable test is a necessary-condition proxy for connectability and never proof
canonical_vs_rootless: the canonical and rootless socket paths are two separately-labelled groups and are never merged; HOST_SOCKET_PATHS excludes the rootless paths deliberately, because they are the recommended bounded posture and must never read as a violation

## Column status

hosted-direct: obtained — Actions run 30768797917, container_image none, probe_euid 1001, captured_at 2026-08-02T21:51:12Z; validate.yml's env-rootless job is this same shape and independently corroborates part of this column (see the env-rootless note below)
hosted-container: obtained — Actions run 30768490911, container_image buildpack-deps@sha256:877e9e4d949edfbcbedabc3a2d7ab593955fee5d6d0777adf3a991eb30c750d8, probe_euid 0, captured_at 2026-08-02T21:42:55Z; the shape carrying the new information. This column has no independent corroboration
selfhosted-direct: obtained — self-hosted job on shftwst/fly-ci-runner-probe, container_image none, probe_euid 1001, captured_at 2026-08-03T19:43:37Z, on a fly.io Machine (Firecracker microVM; see selfhosted_substrate). This column has no independent corroboration
selfhosted-container: obtained — self-hosted job on shftwst/fly-ci-runner-probe, container_image buildpack-deps@sha256:877e9e4d949edfbcbedabc3a2d7ab593955fee5d6d0777adf3a991eb30c750d8, probe_euid 0, captured_at 2026-08-03T19:42:24Z, on a fly.io Machine (Firecracker microVM; see selfhosted_substrate). This column has no independent corroboration
hosted-direct-after-removal: obtained — a second reading on the hosted-direct shape (probe_euid 1001, captured_at 2026-08-02T21:51:13Z, same Actions run 30768797917 as the hosted-direct column) after a same-job removal of the canonical sockets, not a fifth shape; socket_removal.performed reads present(same-job removal, performed before this probe run), socket_removal.kind reads same-job, both socket.canonical entries read absent with is_socket/readable/writable no, and attest.canonical_socket_present reads no
selfhosted-direct-after-removal: obtained — a second reading on the selfhosted-direct shape (probe_euid 1001, captured_at 2026-08-03T19:43:37Z, same self-hosted job on shftwst/fly-ci-runner-probe) after the canonical sockets were removed, not a fifth shape; both socket.canonical entries read absent with is_socket/readable/writable no, and attest.canonical_socket_present reads no. socket_removal.performed and socket_removal.kind read unmeasurable_here on this shape — the frozen instrument (probe_version 1) carries no self-hosted removal branch — so the removal is evidenced by the change in the socket.canonical.* readings between this reading and the selfhosted-direct column, not by the socket_removal.* metadata
columns_identical: no — the two columns differ. euid-driven (probe_euid 0 in hosted-container, 1001 in hosted-direct): containment.proc1.environ and containment.proc1.environ_keys read present under euid 0 and unreadable(not-readable-by-euid) under euid 1001; containment.proc1.container_value reads absent under euid 0 (the environ was read and carried no container key) and unreadable(not-readable-by-euid) under euid 1001. Independent of euid: mounts.table line count (24 vs 32), socket.rootless.podman (absent vs unmeasurable_here on the unset XDG_RUNTIME_DIR), containment./.dockerenv (absent vs present("empty")), containment.proc1.comm (systemd vs tail), workdir.path, workdir.parent, workdir.checkout, home.path, home.entries, and the explanatory text on socket_removal.performed and socket_removal.kind. containment.proc1.cgroup.decisiveness reads non-decisive on both, though the verbatim cgroup line differs (0::/init.scope vs 0::/)
columns_identical.selfhosted: no — the two self-hosted columns differ. euid-driven (probe_euid 1001 in selfhosted-direct, 0 in selfhosted-container): the three containment.proc1.* readings read unreadable(not-readable-by-euid) under euid 1001 and readable under euid 0 — environ present(read-ok), environ_keys present(5 keys, names withheld), container_value absent. Substrate-driven: the container shape carries container markers the direct shape does not — containment./.dockerenv present("empty") vs absent, containment.proc1.cgroup 0::/docker/<id> vs 0::/, containment.proc1.comm tail vs init, and mounts.table 40 lines (including the bind-mounted /run/docker.sock) vs 23. workdir and home paths also differ (/__w and /github/home on the container shape, /home/runner/actions-runner/_work and /home/runner on the direct shape). The socket.canonical.* readings, the attest.* group and socket.rootless.podman read the same on both
worktree_changed_by_checkout.hosted-direct: no — one level deep the pre-checkout listing names {faff} and the transcript's workdir.listing names {faff}; the two name sets are equal
worktree_changed_by_checkout.hosted-container: no — one level deep the pre-checkout listing names {faff} and the transcript's workdir.listing names {faff}; the two name sets are equal
worktree_changed_by_checkout.selfhosted-direct: no — one level deep the pre-checkout listing names {fly-ci-runner-probe} and the transcript's workdir.listing names {fly-ci-runner-probe}; the two name sets are equal
worktree_changed_by_checkout.selfhosted-container: no — one level deep the pre-checkout listing names {fly-ci-runner-probe} and the transcript's workdir.listing names {fly-ci-runner-probe}; the two name sets are equal
worktree_changed_by_checkout.derivation: yes when the set of entry names one level deep differs between the pre-checkout file and the transcript's work-directory listing; no when those two sets are equal; names only, not byte equality and not owner or mode
actions_runner_controller: unmeasured — needs a cluster and a controller install, outside this timebox; not derivable from this repository; carried as the open punt on FAFF-654 and to be filed as its own ticket. The two self-hosted shapes here run on a fly.io Machine, where containment.env.KUBERNETES_SERVICE_HOST reads absent; the Kubernetes/ARC shape is a different substrate and stays unmeasured, not a gap in this record

## Token coverage

Table: selftest-coverage — 10 signals — shapes: hosted-direct, hosted-container

| case | token | non-root run | euid 0 run |
|---|---|---|---|
| a | present | exercised | exercised |
| b | absent | exercised | exercised |
| c | undecidable | exercised | skipped |
| d | absent | exercised | exercised |
| e | unreadable | exercised | skipped |
| f | undecidable | exercised | exercised |
| g | unmeasurable_here | exercised | exercised |
| h | present | exercised | exercised |
| i | absent | exercised | exercised |
| j | present | exercised | exercised |

unfixturable.open-failed: no self-test case exists; POSIX sh cannot create a unix socket, mknod needs root, and a FIFO blocks on open with no portable timeout
unfixturable.read-failed: no self-test case exists; no portable way to fail a read after a successful open
unfixturable.evidence_rule: for each of these two tokens this record either names the transcript and key that demonstrated it, or records that it was not observed in this run; the bare claim that it is demonstrated by transcript is not sufficient on its own
unfixturable.open-failed.observed: demonstrated — named by transcript and key. It reads on socket.canonical./var/run/docker.sock and socket.canonical./run/docker.sock in both hosted-container.txt and hosted-direct.txt (a live socket opens with ENXIO, which classifies open-failed). This is a field reading, not a fixtured self-test case: both committed self-tests print "no fixture — POSIX sh cannot create a socket; a FIFO blocks on open" for this token, so it has no controlled ground-truth case — but the evidence rule is satisfied by naming the transcript and key above, which four field readings across the two shapes do
unfixturable.read-failed.observed: not observed on any committed shape. Both committed self-tests print "no fixture — no portable way to fail a read after a successful open" for this token, and it appears in no field reading in any of the seven transcripts, so it has no demonstration on any shape in this run
euid_permission_tokens.observed: unreadable(not-readable-by-euid) is demonstrated by the hosted-direct self-test at euid 1001, which reports 11 passed, 0 skipped, 0 failed and exercises cases c and e. The hosted-container self-test at euid 0 reports 9 passed, 2 skipped, 0 failed, skipping cases c (undecidable, ancestor-not-searchable) and e (unreadable, not-readable-by-euid) because access(2) grants search and read to uid 0 regardless. The token also appears as a field reading on containment.proc1.environ, containment.proc1.environ_keys and containment.proc1.container_value in the hosted-direct column

## Structural guarantee

no_byte_emitting_code_path: the probe has no code path that prints the bytes of a file it classified; every file-facing key emits a token, a long-listing line, or a name
exception_1: the mount table, printed verbatim
exception_2: the pid-1 environ key names, never values, under the names mode. A name is not a credential — no value is emitted — but the scan cannot catch a secret-shaped name either, because a block continuation line has no key-value separator for the generic branch to split on. The defence here is the mode flag plus the operator attestation below, not the scan. The names default is safe on a hosted runner, where pid 1 is the VM's init; FAFF-656 runs where that argument does not hold and must choose the mode deliberately
exception_3: the value of the container key from the pid-1 environ, printed in full
exception_4: long-listing lines, carrying mode, numeric uid and gid, size and name
exception_5: faff container-check stdout, both JSON and plain
exception_6: the /proc/1/cgroup continuation block — every line of /proc/1/cgroup, verbatim. Emitted at probe.sh:420 by an inline `while … printf '  | %s'` loop, classified at :417. /proc/1/cgroup is world-readable on any Linux, so this block prints on every run of every shape; under cgroup v2 the content is normally the single line 0::/, though a container runtime can carry a cgroup path embedding a container id. It is an exception by the record's own test — a file the probe classifies whose bytes it then prints — identical to exception_3
exception_7: the /proc/1/comm continuation block — every line of /proc/1/comm, verbatim (the name of pid 1's executable). Emitted at probe.sh:424 by an inline `while … printf '  | %s'` loop, classified at :422; world-readable, so it prints on every run of every shape, and it is an exception by the same test
exceptions_are_complete: seven, the complete set — nothing else in the probe writes bytes obtained from a measured file
exceptions_enumeration_method: the set was derived from the instrument, not this list — enumerate probe.sh's continuation-block emit sites (every pipe into emit_block at probe.sh:40-44, plus every inline `while … printf '  | %s'` loop), which are the seven sites probe.sh:334, :403, :420, :424, :453, :467, :519. Check any future edit against those emit sites, never by counting the entries above: the entries do not map one-to-one to the sites — exception_4 (long-listing lines) covers two sites (:453 and :467), and exception_3 (the pid-1 container value) is a single-value emit at :406 rather than a continuation block. Checking the list against itself is how the earlier count of five survived FAFF-654's twelve review passes
scan_is_a_backstop: the pre-commit scan is a backstop on the guarantee above and is not the guarantee itself
scan_gap_1: a prefix-less credential under a key name outside the credential key-name gate, or one containing a dot, colon or slash, is not caught
scan_gap_2: the generic high-entropy branch is close to inert against this record's own format, because every value line is a grammar token carrying parentheses that fall outside its permitted characters, and the verbatim blocks have no key-value separator to split on; it is carried for FAFF-656, which handles a credential class of exactly that shape

## Signal roster

Table: signal-roster — 41 signals — shapes: hosted-direct, hosted-container, selfhosted-direct, selfhosted-container

Each cell is the value or token that signal carries in that shape's transcript, verbatim. hosted-direct ran at probe_euid 1001, hosted-container at probe_euid 0, selfhosted-direct at probe_euid 1001, selfhosted-container at probe_euid 0; every classification is relative to that column's probe_euid (see euid_caveat).

| signal | hosted-direct | hosted-container | selfhosted-direct | selfhosted-container |
|---|---|---|---|---|
| mounts.table | present(24 lines) | present(32 lines) | present(23 lines) | present(40 lines) |
| socket.canonical./var/run/docker.sock | unreadable(open-failed) | unreadable(open-failed) | unreadable(open-failed) | unreadable(open-failed) |
| socket.canonical./var/run/docker.sock.is_socket | yes | yes | yes | yes |
| socket.canonical./var/run/docker.sock._dangling_symlink | no | no | no | no |
| socket.canonical./var/run/docker.sock.readable | yes | yes | yes | yes |
| socket.canonical./var/run/docker.sock.writable | yes | yes | yes | yes |
| socket.canonical./run/docker.sock | unreadable(open-failed) | unreadable(open-failed) | unreadable(open-failed) | unreadable(open-failed) |
| socket.canonical./run/docker.sock.is_socket | yes | yes | yes | yes |
| socket.canonical./run/docker.sock._dangling_symlink | no | no | no | no |
| socket.canonical./run/docker.sock.readable | yes | yes | yes | yes |
| socket.canonical./run/docker.sock.writable | yes | yes | yes | yes |
| socket.rootless.docker | absent | absent | absent | absent |
| socket.rootless.podman | absent | unmeasurable_here(XDG_RUNTIME_DIR unset: path not constructible) | unmeasurable_here(XDG_RUNTIME_DIR unset: path not constructible) | unmeasurable_here(XDG_RUNTIME_DIR unset: path not constructible) |
| env.DOCKER_HOST | absent | absent | absent | absent |
| attest.canonical_socket_present | yes | yes | yes | yes |
| attest.canonical_socket_writable_by_euid | yes | yes | yes | yes |
| attest.writable_is_a_proxy | writable is a necessary-condition proxy for connectability, never proof | writable is a necessary-condition proxy for connectability, never proof | connecting to a unix socket requires write permission, so the writable test is a necessary-condition proxy for connectability, never proof | connecting to a unix socket requires write permission, so the writable test is a necessary-condition proxy for connectability, never proof |
| attest.rootless_socket_present | no | no | no | no |
| containment.env.KUBERNETES_SERVICE_HOST | absent | absent | absent | absent |
| containment./.dockerenv | absent | present("empty") | absent | present("empty") |
| containment./run/.containerenv | absent | absent | absent | absent |
| containment.proc1.environ | unreadable(not-readable-by-euid) | present(read-ok) | unreadable(not-readable-by-euid) | present(read-ok) |
| containment.proc1.environ_keys | unreadable(not-readable-by-euid) | present(5 keys) | unreadable(not-readable-by-euid) | present(5 keys, names withheld) |
| containment.proc1.container_value | unreadable(not-readable-by-euid) | absent | unreadable(not-readable-by-euid) | absent |
| containment.env.container | absent | absent | absent | absent |
| containment.proc1.cgroup | present(read-ok): 0::/init.scope | present(read-ok): 0::/ | present(read-ok): 0::/ | present(read-ok): 0::/docker/6bc988d4174b6bcd0f5ba7b9acd0788efca3d35949a8e9422defc285ffd2f631 |
| containment.proc1.cgroup.decisiveness | non-decisive | non-decisive | non-decisive | non-decisive |
| containment.proc1.comm | present(read-ok): systemd | present(read-ok): tail | present(read-ok): init | present(read-ok): tail |
| workdir.path | present(/home/runner/work/faff) | present(/__w/faff) | present(/home/runner/actions-runner/_work/fly-ci-runner-probe) | present(/__w/fly-ci-runner-probe) |
| workdir.parent | present(drwxr-xr-x 6 1001 1001 4096 Aug  2 21:51 /home/runner/work) | present(drwxr-xr-x 6 1001 1001 4096 Aug  2 21:42 /__w) | present(drwxrwxr-x 7 1001 1001 4096 Aug  3 19:43 /home/runner/actions-runner/_work) | present(drwxrwxr-x 7 1001 1001 4096 Aug  3 19:39 /__w) |
| workdir.checkout | present(/home/runner/work/faff/faff) | present(/__w/faff/faff) | present(/home/runner/actions-runner/_work/fly-ci-runner-probe/fly-ci-runner-probe) | present(/__w/fly-ci-runner-probe/fly-ci-runner-probe) |
| workdir.listing | present(2 entries, one level) | present(2 entries, one level) | present(2 entries, one level) | present(2 entries, one level) |
| home.path | present(drwxr-x--- 11 1001 1001 4096 Aug  2 21:51 /home/runner) | present(drwxr-xr-x 2 1001 1001 4096 Aug  2 21:42 /github/home) | present(drwxr-x--- 1 1001 1001 4096 Aug  3 16:10 /home/runner) | present(drwxrwxr-x 2 1001 1001 4096 Aug  3 19:40 /github/home) |
| home.entries | present(15 entries, one level) | present(1 entries, one level) | present(5 entries, one level) | present(1 entries, one level) |
| socket_removal.performed | unmeasurable_here(hosted runner: the VM is created per job, so no earlier step and no earlier job can act on the host before this one starts) | unmeasurable_here(hosted runner: the job container is started before any step runs, so no step can act on the host before it exists) | unmeasurable_here(no removal was performed, and this methodology cannot say what host-side hook this shape has) | unmeasurable_here(no removal was performed, and this methodology cannot say what host-side hook this shape has) |
| socket_removal.kind | unmeasurable_here(hosted runner: no host-side hook before the job) | unmeasurable_here(hosted runner: no host-side hook before the job container starts) | unmeasurable_here(shape not known to this instrument: no claim made about its host-side hooks) | unmeasurable_here(shape not known to this instrument: no claim made about its host-side hooks) |
| socket_removal./var/run/docker.sock.after | unmeasurable_here(no removal was performed on this shape) | unmeasurable_here(no removal was performed on this shape) | unmeasurable_here(no removal was performed on this shape) | unmeasurable_here(no removal was performed on this shape) |
| socket_removal./run/docker.sock.after | unmeasurable_here(no removal was performed on this shape) | unmeasurable_here(no removal was performed on this shape) | unmeasurable_here(no removal was performed on this shape) | unmeasurable_here(no removal was performed on this shape) |
| crosscheck.container_check_json | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) |
| crosscheck.container_check_exit | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) |
| crosscheck.container_check_plain | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) | impossible_on_shape(no faff binary on PATH) |

## Notes

notes: This is the one free-prose line class in this record. Every other line above is a provenance field, a table row, a caption matching the fixed template, a column-status line, or a heading, and every table cell is a value-grammar token, a signal name, a shape name, or the literal non-decisive marker. The advisory word-list check runs over this section specifically and its hits are recorded here with a reason each.

notes: The two hosted shapes have now been dispatched under FAFF-657 and their readings fill the observation table above; the two self-hosted shapes remain owned_by FAFF-656 and are still absent. FAFF-657 is a separate ticket from the instrument build for a structural reason, not a timebox one: a dispatch-only workflow does not fire until its file is on the default branch, so no session that builds the workflow can also dispatch it. Where a shape is still unobtained its reading cells stay absent from this file rather than filled with a placeholder, because a placeholder in an observation table is indistinguishable from a measurement.

notes: validate.yml's env-rootless job is already the hosted-direct shape and has been green for months. It independently establishes part of that column: the runner carries docker.service and docker.socket units, the runner user has passwordless sudo able to stop host services and write kernel sysctls, the XDG runtime directory is unset by default with no live systemd user session, and a same-job socket removal works without falling back to a host daemon. It calls no containment check and says nothing about a containerised job. The hosted-direct column is now filled, and this record cites that job beside it (.github/workflows/validate.yml, the env-rootless job): one column, hosted-direct, has independent corroboration for part of its content, and the other, hosted-container, has none.

notes: Operator attestation, image digest — SATISFIED for hosted-container. The workflow takes the container image as a dispatch input; for this reading it was resolved to buildpack-deps@sha256:877e9e4d949edfbcbedabc3a2d7ab593955fee5d6d0777adf3a991eb30c750d8 and passed as that input, and the same digest is recorded on the container_image line of the hosted-container transcript. The digest is content-addressed: re-requesting the manifest by this digest returns the same manifest, so a later reader can re-verify against the digest without trusting this record. The original resolve exchange is not reproduced here and no exact resolve command is stated; the digest is recorded as resolved and confirmed by content address. Two items from that exchange are deliberately withheld — the anonymous registry pull token (a credential-by-shape) and the docker-ratelimit-source header (a source IP address) — because neither contributes to checkability; the digest alone is what a reader re-verifies against. No bearer token and no egress IP is written into this record.

notes: Operator attestation, credential-shape constants — SATISFIED (operator-confirmed 2026-08-02). config.js lines 863 to 870 were read by eye: SECRET_KNOWN_PREFIXES, SECRET_KNOWN_REGEXES, SECRET_KEYNAME_RE and SECRET_GENERIC_VALUE_RE match the scan_gap_1 / scan_gap_2 descriptions above — the key-name gate, the *_env exemption, and the separator-free high-entropy value shape are all as the record states, so the copy has not drifted. They cannot be imported, so this remains a copy to re-read on any future change.

notes: Operator attestation, pid-1 environ key block — SATISFIED (operator-confirmed 2026-08-02). Each committed transcript's environ key-name block was read: hosted-container emits five key names only — CI, GITHUB_ACTIONS, HOME, HOSTNAME, PATH — with no value material and none matching the credential key-name gate; hosted-direct and hosted-direct-after-removal read unreadable(not-readable-by-euid) at euid 1001 and emit no environ block at all. No value material is present in any committed transcript.

notes: Operator attestation, this notes section — SATISFIED (operator-confirmed 2026-08-02). All seven committed transcripts were read for findings language and carry probe grammar output only — value-grammar tokens, signal and shape names, mount-table and long-listing lines — with no findings or recommendation language. It is likewise satisfied for this file as it stands: the content above was read for findings language. The advisory word-list check returns one hit, on the canonical_vs_rootless provenance field. It is left in: the word there reports what ADR-0041 already says about the rootless posture, which is why HOST_SOCKET_PATHS excludes those paths, and it asserts nothing about what faff or FAFF-646 ought to do. This is the over-flagging the word list was expected to produce, which is why it is advisory rather than gating.

notes: Self-hosted probe digest — SATISFIED, self-proving. The probe hashes its own file ($0) and emits probe_sha256; all three self-hosted transcripts (selfhosted-direct, selfhosted-direct-after-removal, selfhosted-container) carry probe_sha256 40166f33ba093cf0f1d95a3d4ca311a7435f46647d3827e807eaeac7bbb052b7, which equals the sha256 of probe.sh in this directory. So each transcript proves the instrument that ran was byte-identical to the committed probe, re-checkable from the committed files with no separate before-teardown step required.

notes: Operator attestation, self-hosted pid-1 environ — SATISFIED by construction. The self-hosted shapes were probed with --environ-keys count, so no pid-1 key names were emitted on either shape (environ_keys reads a count with names withheld under euid 0, and unreadable(not-readable-by-euid) under euid 1001). There is no name block to read, so the name-disclosure concern the mode flag guards does not arise on these shapes.

notes: Operator attestation, self-hosted runner teardown — SATISFIED (operator-confirmed 2026-08-03). The disposable fly.io Machine (id 2870903c4e2478) was destroyed, the fly app fly-ci-runner-probe was destroyed with it (so the runner process and its private image no longer exist), and the runner registration was removed from the scratch repository shftwst/fly-ci-runner-probe. No self-hosted runner remains — live or registered — on any repository. This is an operator attestation, not a checkable artifact.

notes: Self-hosted rig byproduct (for FAFF-609). The rig is a fly.io Machine built from ubuntu:24.04 with docker and actions-runner 2.336.0, registered to a scratch repository, never shftwst/faff. It is run with fly machine run as a standalone Machine, not fly deploy — the deploy release-health wait recreates a slow-booting runner in a loop. The runner is configured --disableupdate (a forced in-place self-update breaks the binary in the immutable image) and runs as a non-root user with HOME=/home/runner. dockerd runs on the vfs storage driver because the Firecracker microVM has no kernel overlay for the container shape to mount. The container shape is dispatched before the direct shape, whose socket-removal step removes the daemon socket. Recorded so FAFF-609 does not re-derive it.

notes: A self-test was run during the build on the author's machine at euid 501, reporting 11 assertions across 10 fixture cases, zero skipped and zero failed. That run is not committed here because local-dev is not one of the four shapes. Two dispatched self-test outputs are now committed: the hosted-direct job ran at euid 1001 and reports 11 passed, 0 skipped, 0 failed, which supplies the committed non-root run the demonstration criterion turns on; the hosted-container job ran at euid 0 and reports 9 passed, 2 skipped, 0 failed, skipping the two permission cases (c and e) because access(2) grants search and read to uid 0. The portability guarantee this instrument offers FAFF-656 now rests on a committed non-root run rather than an uncommitted local one.

notes: Self-hosted substrate, container markers on the direct shape — the disposable fly microVM shows no container markers: containment./.dockerenv absent, containment.env.container absent, containment.proc1.cgroup all controllers at / (0::/), and containment.proc1.comm init. A marker-based container check reads this shape as not-contained.

notes: Self-hosted substrate, host engine socket on both shapes — attest.canonical_socket_present reads yes and attest.canonical_socket_writable_by_euid reads yes on both selfhosted-direct and selfhosted-container; on the container shape the socket is the bind-mounted /run/docker.sock, which also appears as an entry in that shape's 40-line mounts.table. "Contained" and "host-socket-reachable" are independent readings here: the direct shape reads not-contained yet reaches the socket, and the container shape reads contained yet also reaches it.

notes: Self-hosted substrate, socket removal — selfhosted-direct-after-removal reads socket.canonical./var/run/docker.sock and socket.canonical./run/docker.sock as absent (is_socket/readable/writable no) and attest.canonical_socket_present as no, where the selfhosted-direct column reads them present and reachable. socket_removal.performed and socket_removal.kind read unmeasurable_here on a self-hosted shape because the frozen instrument (probe_version 1) has no self-hosted removal branch, so the change is recorded as the difference in the socket.canonical.* readings between the two transcripts rather than in the socket_removal.* metadata.

notes: Self-hosted substrate, _work occupancy — on selfhosted-direct workdir.listing names one entry, this checkout (fly-ci-runner-probe), so _work holds a single tenant in this reading. A shared, long-lived runner would carry the neighbour-checkout question by construction; that is a property of such a runner, inferred and not observed on this single-repo throwaway Machine.

notes: Self-hosted substrate, cgroup version — the fly Machine mounts cgroup v1 hierarchies (net_cls, hugetlb, pids, freezer, cpu,cpuacct, devices, blkio, memory, perf_event, cpuset) alongside a cgroup2 unified mount on the direct shape, where the hosted runners read cgroup v2. This is recorded as a substrate difference.

notes: Self-hosted substrate, crosscheck parity — crosscheck.container_check_json, .container_check_exit and .container_check_plain read impossible_on_shape(no faff binary on PATH) on both self-hosted shapes, matching the two hosted columns; faff is deliberately not installed on any shape, so the crosscheck rows stay comparable across all four.

notes: Self-hosted environ handling — the self-hosted shapes were probed with --environ-keys count, so containment.proc1.environ_keys on selfhosted-container reads present(5 keys, names withheld) and emits no key names. No name or value material from pid 1's environ is present in either self-hosted transcript; on selfhosted-direct the environ reads unreadable(not-readable-by-euid) at euid 1001 and emits nothing.
