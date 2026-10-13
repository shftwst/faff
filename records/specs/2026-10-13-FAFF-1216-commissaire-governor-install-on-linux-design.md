# FAFF-1216: `commissaire governor install` for a separate OS user on Linux

> Spec: faffter-dark-nlspec · 2026-10-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1216.

Revised on 2026-10-12: folds in the operator's resolution of the three open decisions (comment "Resolution: the three open spec decisions"). Scope is now the shared core plus Linux; macOS moved to FAFF-1251. See "Changes since the 2026-10-10 spec" at the end. A second operator resolution (comment "Resolution: how the human reaches the governor's socket") adds a read-only admin caller: install records the human who ran it, who may call only `identify`, and a dedicated `commissaire-clients` group owns the socket directory. Spec review rounds 6 to 10 ran on 2026-10-12 after the reviewer spend limit was raised; every round's objections were fixed in place, but the loop reached its round cap without an approval. The operator then settled the park (comment "Resolution: review-forced removals and the build path"): both removed flags stay removed, and the ticket goes to build without further review rounds. The round 10 fixes have not been re-reviewed; the build's code review is the next check on them.

This spec is the build contract for FAFF-1216. It covers `commissaire governor install` and its `uninstall` sibling on Linux: a root-run command that sets up a Commissaire governor as its own hidden system user, behind a systemd service, with a key directory, socket directory and program copy the runner's user cannot tamper with. It also records the runner's routes to root-equivalent power, so the governor never over-claims independence.

## 1. Why

A governed run counts toward Gate 1 only across a boundary the runner cannot cross (ADR 0135, decision 7). `commissaire governor start` under the runner's own user is not that boundary: the runner can read or replace the signing key. `install` creates the boundary once, under the human's `sudo`, by running the governor as a separate OS user whose key directory, socket directory and program copy the runner's user cannot write.

Today an operator has no supported way to do this. The account, service, key directory, socket directory and allow list must be created by hand, and nothing records whether the runner can escalate around the boundary.

**Design principles.**

- **Commissaire never invokes `sudo`.** The human runs `sudo ... commissaire governor install`. The command refuses unless it is already root and never uses `sudo`, `doas` or any other escalation to gain privilege. The one `sudo` call it makes is the escape-route check's read-only query `sudo -n -l -U <runner>`, run while already root, which grants nothing.
- **The plan is data; execution is injected.** The command computes an ordered plan (account attributes, unit text, directory operations, install-copy manifest, post-condition asserts) as pure values, then hands it to an injectable executor. Tests assert against the plan without root.
- **Fail closed, never over-claim.** A step that cannot complete safely aborts with a specific message. A check that cannot run is recorded as failed.
- **Root never runs or installs runner-writable code.** Install refuses to run from a runner-writable copy of itself, and copies the governor only from a root-owned clone of a release tag.
- **The runner's user is named explicitly.** Under `sudo`, `process.getuid()` is 0. The runner's user comes from `--runner-user`, with no fallback, and is resolved against the account database. `SUDO_USER` names the human running install, who becomes the admin user.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` (+ committed `.js`) | CLI dispatch: `COMMISSAIRE_DISPATCH`, `REQUIRED_FLAGS_BY_CANONICAL`, `COMMISSAIRE_SPEC.flags`, `parseCommissaireArgs`, `usage()` gain `governor install` and `governor uninstall` |
| `plugin/skills/faff/bin/lib/governor.ts` (+ `.js`) | `governorStart`, `openState`, `parseGovernorConfig` / `loadGovernorConfig` (FAFF-1211: `<keyDir>/governor-config.json`, mode 0600, owned by the governor's own uid, `{ allow_uids }`; unknown keys ignored today), `handleAdmit` (builds the admission payload `{ producer_id, contract_revision, admitted_scope, pk_fingerprint, admitted_at, custody }`), socket default `<keyDir>/governor.sock` chmod 0600 |
| `plugin/skills/faff/bin/lib/peer-cred.ts` + `peer-cred-helper.py` | Peer uid read through a Python helper at `TRUSTED_PYTHON_PATHS = ["/usr/bin/python3"]`; the `.py` file is not a `require` |
| `plugin/skills/faff/bin/lib/commissaire-governor-client.ts` | Runner side (FAFF-1179): reads the socket path from `COMMISSAIRE_GOVERNOR` or `commissaire.governor` in the rc |
| `plugin/skills/faff/bin/lib/shared-infra.js` | `ensureOwnerOnlyDir` / `writeOwnerOnlyJson` (FAFF-1195): leaf-only 0700, no chown, no ancestor check; `cliPosixGuard()` |
| `plugin/skills/faff/bin/lib/gates.js` | `localOs()` returns `macos`, `windows` or `linux` |
| `records/adr/0135-commissaire-governor-runs-out-of-process-opt-in-with-pinned-keys.md` | Decisions 2, 7 and 9: account attributes, key-dir paths, `DynamicUser=` rejected, socket "restricted to the runner's group" as a second layer behind peer credentials, the sudo and `docker` caveats, the faff checkout being the runner's read-write directory |
| `records/spikes/2026-10-06-faff-1109/RESULTS.md` part 3 | Multi-user Docker test precedent (`node:20` + `useradd` + `runuser`) |
| Release tags on `https://github.com/shftwst/faff.git` | release-please tags of the form `faff--vX.Y.Z` (latest `faff--v0.41.0`) |

## 2. Out of scope

- **macOS.** FAFF-1251 (operator decision, 2026-10-12): the `dscl` account, the launchd daemon, macOS paths and the `admin` group check. On macOS this ticket's install exits 2 with "macOS install is tracked in FAFF-1251". The plan types below already carry the macOS fields so FAFF-1251 adds only `planMacos` and its tests.
- **`commissaire governor pin` and `status`, and the `identify` operation.** FAFF-1217 owns both commands and the read-only `identify` operation they call; it reads `runner_checks` from the `identify` reply and `pin` refuses when `independent` is false. This spec writes the record, admits the human as an admin caller, and restricts admin callers to the operations in `ADMIN_OPS` (`identify`). Extension point: FAFF-1217 adds `case "identify"` to `dispatchOp`; until it lands, an admin caller's `identify` gets the existing `unknown-op` reply.
- **The peer-credential check itself.** FAFF-1211 (Done). Install only writes the allowed uid.
- **Fly and host-launched governors.** FAFF-1181 and FAFF-1215.
- **Native Windows.** `cliPosixGuard` refuses win32; WSL2 uses the Linux path.
- **Strict mode, the pin-change rule, the GitHub status check.** FAFF-1219, FAFF-1218, FAFF-1220.
- **How later readers weigh `runner_checks`.** FAFF-1182 (Gate 1 counting) and `audit verify` decide whether an admission's install-time `runner_checks` is enough or a fresh host check is needed. This ticket records `checked_at` so they can tell its age. Extension point: the admission payload's `runner_checks` copy.
- **Publishing to npm.** The published package as an install source is a possible later option, not built here.

**Changes to shipped code.** This ticket amends `governor.ts` from FAFF-1177 and FAFF-1211 in three places: the opt-in `--socket-group-access` flag with its two rate caps; the optional `runner_checks` key, validated in `parseGovernorConfig` and copied by `handleAdmit` into the admission payload; and the optional `admin_uids` key, which the Unix-listener guard admits for `ADMIN_OPS` only. All three are opt-in: without the flag and the keys the governor behaves exactly as today, and the existing `test/governor-peer-cred.test.mjs` and governor tests keep every assertion; the only edits allowed are call sites that build the caller set, which move from `Set<uid>` to the `Map<uid, CallerRole>` the admin caller needs, with every existing uid mapped to `runner`. Admission payloads carry a copy of `runner_checks` as evidence for later readers of a run; FAFF-1217's `pin` and `status` read it from the governor's `identify` reply instead, because no run exists when the human pins. The operator settled the shape on 2026-10-12.

## 3. What

**Vocabulary.**

| Term | Definition |
|---|---|
| Governor account | The hidden, no-login system user the governor runs as: `commissaire` |
| Runner user | The OS user that runs faff day to day; named by `--runner-user` |
| Key directory | Root-created, governor-owned, 0700 directory holding the key and `governor-config.json`: `/var/lib/commissaire` |
| Socket directory | Governor-owned directory, group `commissaire-clients`, mode 2750, holding `governor.sock`: `/var/lib/commissaire-socket` |
| Admin user | The human who runs install under sudo; named by `--admin-user`, default `SUDO_USER`. Admitted to the socket for `identify` only, so `pin` and `status` (FAFF-1217) can run from their account |
| Client group | `commissaire-clients`: a system group install creates whose only members are the runner user and the admin user; it owns the socket directory |
| Install copy | Version-pinned, root-owned copy of the governor's program files, taken from a release tag |
| Release clone | Root-owned temporary clone of a release tag that the install copy is built from |
| Escape-route check | Whether the runner user can reach root-equivalent power through sudo or the `docker` group |

**CLI surface.**

```
commissaire governor install   --runner-user <name> --from-tag <tag> [--admin-user <name>]
                               [--key-dir D] [--socket-dir D] [--install-prefix D] [--node P]
                               [--json]
commissaire governor uninstall [--purge-key] [--json]
commissaire governor start     ... [--socket-group-access]     # new flag; used only by the installed service
```

- `--runner-user`: required for install, with no fallback. `SUDO_USER` names the human who ran sudo, which is the admin user, never the runner.
- `--admin-user`: the human admitted for `identify`; default `SUDO_USER`. Install refuses (exit 2) when neither is set, when it resolves to uid 0, to the runner user, or to the governor account.
- `--from-tag`: required for install. A release tag matching `^faff--v[0-9]+\.[0-9]+\.[0-9]+$`.
- There is no flag for the clone source. Install always clones `RELEASE_REPO_URL`, the constant `https://github.com/shftwst/faff.git` in `governor-install.ts` (see "Release clone").
- `--key-dir`, `--socket-dir`, `--install-prefix`: override defaults (tests, non-standard layouts).
- `--node P`: the Node interpreter the service runs; default `process.execPath`. Must pass the interpreter check in section 4.
- `--purge-key`: uninstall only; also remove the key directory.

**Plan types** (language-agnostic):

```
ENUM Platform: macos | linux

RECORD GovernorAccount: platform, user_name, group_name, uid, gid, shell, home, real_name, hidden

RECORD DirPlan: path, owner, group, mode, parents_to_verify   # every ancestor must be root-owned

RECORD InstallCopyPlan:
  dest                      # <prefix>/<version>/
  version                   # sha256 over the sorted (rel_path, sha256) manifest
  source_tag, source_commit # the --from-tag value and the commit it resolved to in the release clone
  files: List<{ rel_path, sha256 }>   # closures of bin/commissaire and lib/governor.js, plus peer-cred-helper.py
  node: String              # interpreter path, verified root-owned

RECORD ServicePlan: platform, path, text, bootstrap_ops

RECORD RunnerChecks:        # see "Runner checks record"
  schema, runner_user, runner_uid, platform, socket_group,
  docker_group, sudo_rules, sudo_absent, admin_group, independent,
  checked_at, install_version, source_tag

RECORD InstallPlan: platform, account, key_dir: DirPlan, socket_dir: DirPlan, install_copy, service,
                    allow_uids: List<Int>, admin_uids: List<Int>, client_group: { name, members: List<String> },
                    runner_checks, ops: List<Op>

ENUM Op: create_account | create_group | set_group_members | create_dir | chown | chmod | write_file
       | copy_file | remove | service_op | assert

INTERFACE Executor:
  run(op) -> OpResult
  probe(cmd) -> { stdout, stderr, exit }   # read-only queries
```

**Runner checks record.** The `runner_checks` object install writes into `governor-config.json`, and that the governor copies verbatim into every admission payload:

```
runner_checks: {
  "schema": 1,
  "runner_user": "alice",              # String, the resolved --runner-user
  "runner_uid": 1000,                  # Int >= 0
  "platform": "linux",                 # "linux" | "macos"
  "socket_group": "commissaire-clients", # String, group name of the socket directory
  "docker_group": false,               # Bool, true = runner is in the docker group (fails the check)
  "sudo_rules": false,                 # Bool, true = sudo or doas grants the runner a rule, or the probe errored (fails)
  "sudo_absent": false,                # Bool, true = neither sudo nor doas found; sudo_rules is then false
  "admin_group": null,                 # Bool | null; null on Linux, set by FAFF-1251 on macOS (true fails)
  "independent": true,                 # Bool = NOT sudo_rules AND NOT docker_group AND admin_group != true
  "checked_at": "2026-10-12T04:00:00Z",# ISO-8601 UTC
  "install_version": "<sha256 hex>",   # the install copy's manifest version
  "source_tag": "faff--v0.42.0"        # the --from-tag value
}
```

Validation in `parseGovernorConfig`: `runner_checks` is optional. When present it must have exactly these thirteen keys with these types, `schema` must be 1, `platform` and the booleans must be in their sets, `sudo_absent: true` requires `sudo_rules: false`, `platform: "linux"` requires `admin_group: null`, and `independent` must equal the formula. Any violation makes `loadGovernorConfig` return an error and `governor start` exit 2, the same path a malformed `allow_uids` takes today. The record is a claim the governor repeats, not something it measures: it states what install observed at `checked_at`. It is an install-time snapshot and is never refreshed. `governor-config.json` sits in the 0700 key directory owned by the `commissaire` account, so the runner cannot rewrite the record without root, and a runner with root defeats every local control (ADR 0135 decision 7's sudo caveat). Group membership that changes after install is not covered by the record: FAFF-1217's `pin` checks the runner's root-equivalent groups live from the group database, and `status` prints `checked_at` so its age is visible. Only the sudo fact rests on the snapshot.

**Install result** (printed; the `--json` shape): `platform`, `account`, `key_dir`, `socket_path`, `install_copy { dest, version, source_tag, source_commit }`, `allow_uids`, `admin_uids`, `client_group { name, members }`, `runner_checks`, `pk_fingerprint`, and `next_steps`: set `commissaire.governor: <socket_path>` in the runner's `.faffrc.yaml` (or `COMMISSAIRE_GOVERNOR`); start a new login session for the runner and the admin user so `commissaire-clients` membership applies; then run `/opt/commissaire/<version>/bin/commissaire governor pin --socket <socket_path> --runner-user <runner> --repo <OWNER/NAME>` as the admin user, from the install copy, never a checkout (FAFF-1217's `pin` also refuses a runner-writable copy of itself).

**Design decision: command split.** **Chosen:** two dispatch keys, `governor install` and `governor uninstall`, mirroring `start` and `rotate`. A `--remove` flag would hide a destructive path behind a flag.

## 4. How

**Architecture.** A new factory-region module `governor-install.ts` (with its committed `.js` emit, ADR-0132) exports `governorInstall(flags, deps?)` and `governorUninstall(flags, deps?)` (`deps` is a test seam: `releaseRepoUrl` and the host probes, never reachable from the CLI), wired into `COMMISSAIRE_DISPATCH` through a lazy `require("./governor-install")`, as `governor start` lazily requires `./governor`. A platform-independent core holds argument handling, the root and self-custody guards, the release clone, the escape-route check and the plan-to-result flow. `planLinux` builds the Linux plan; on `macos` the core exits 2 pointing at FAFF-1251, which adds `planMacos` behind the same seam.

**Design decision: platform scope.** **Chosen** (operator decision, 2026-10-12): this ticket ships the shared core, the plan seam and Linux; macOS is FAFF-1251, blocked by this ticket and by the FAFF-1211 macOS peer-credential verification. CI runs Linux only and the macOS caller check is not yet demonstrated outside a manual procedure.

**Design decision: pure plan plus injected executor.** **Chosen:** compute the complete `InstallPlan` from read-only probes before any mutation, then execute it through the `Executor` seam. Every create-or-verify choice (create the account or verify it, re-chown or abort) is made at plan time from the probes. Post-conditions such as "re-read after create" are `assert` ops in the plan: they re-read and compare, and a mismatch aborts. No op branches or re-plans. Unit text, the asserts, the directory plans and the manifest are unit-testable without root.

**Design decision: standalone closure.** **Chosen:** the lazy require keeps `governor-install` out of `bin/commissaire`'s static import closure, which `test/commissaire-standalone.test.mjs` guards.

### Root guard, self-custody guard and runner user

```
PROCEDURE governorInstall(flags):
  1. win32 is refused by cliPosixGuard at bin/commissaire.
  2. IF process.getuid() != 0: stderr "commissaire governor install must be run as root"; return 2
  3. platform := localOs(); IF platform == "macos": stderr "macOS install is tracked in FAFF-1251"; return 2
  3a. IF --from-tag is absent or does not match ^faff--v[0-9]+\.[0-9]+\.[0-9]+$: stderr "from-tag must be a release tag (faff--vX.Y.Z)"; return 2
      # before the guard, so the printed bootstrap only ever carries a validated tag
  4. selfCustodyCheck(tag)                           # see below; abort on failure
  5. runnerUser := --runner-user                      # required; never SUDO_USER
  6. runnerUid, runnerGid := resolveUser(runnerUser)   # null: "no such user: <name>"; return 2
     IF runnerUser is empty OR runnerUid == 0: stderr "pass --runner-user <name>: the non-root user that runs faff"; return 2
     IF runnerUid < UID_MIN (from /etc/login.defs, default 1000):
       stderr "runner-user <name> is a system account"; return 2     # no override: see the design decision below
  6a. adminUser := --admin-user OR SUDO_USER; adminUid := resolveUser(adminUser)
     IF adminUser is empty: stderr "pass --admin-user <name>: the human who will run governor pin"; return 2
     IF adminUid is null: "no such user: <name>"; return 2
     IF adminUid == 0 OR adminUid == runnerUid OR adminUser == "commissaire":
       stderr "admin-user must be a human account other than root, the runner and the governor"; return 2
  7. preflight(flags)                                  # tools, python3, interpreter
  8. clone := releaseClone(flags.from_tag)
  9. runner_checks := escapeCheck(...)                 # before any mutation
 10. plan := planLinux(..., clone, runner_checks); execute(plan); abort on first failed op with its message
 11. remove the release clone
 12. fingerprint := learnFingerprint(keyDir)
 13. print InstallResult; return 0 when fingerprint is set, else return 1   # the service did not prove itself live
```

`resolveUser`: `getent passwd <name>` (fields 3 and 4), with `id -u` / `id -g` as fallback. Node has no passwd API.

**Design decision: system-account runners.** **Chosen** (operator decision, 2026-10-12, keeping the spec-review round 8 removal of `--allow-system-runner`): install refuses a runner user below `UID_MIN` with no override flag. A system UID is often shared by several services, so it is not one actor, and `runner_checks` has no field to say otherwise. An operator who runs faff under a service account creates a dedicated regular user for it instead.

**Self-custody guard.** Install is the one moment root runs Commissaire code, so it must not run code the runner can edit. `selfCustodyCheck` takes the `realpath` of the running module's directory (`__dirname`) and of `bin/commissaire`, and requires every file in that directory and every ancestor directory to be root-owned and not group- or world-writable. Otherwise it aborts with `install-code-not-root-owned: <path>` and prints the bootstrap:

```
sudo git clone --depth 1 --branch <tag> https://github.com/shftwst/faff.git /root/commissaire-<tag>
sudo /usr/bin/node /root/commissaire-<tag>/plugin/skills/faff/bin/commissaire governor install \
     --runner-user <name> --from-tag <tag>
```

So `sudo ~/.local/bin/commissaire governor install` from a dev checkout refuses. The interpreter running install is checked by the same rule as the service interpreter (Preflight).

**Design decision: self-custody guard.** **Chosen:** refuse to run install from a runner-writable copy. The `--from-tag` decision closes what root *installs*; this guard closes what root *runs* while installing, since a runner-edited install could skip `--from-tag` entirely. **Honest limit:** the guard protects a human who runs the wrong copy by mistake; a copy the runner has already edited can delete the guard. An edited copy cannot pass the guard by itself, because making files root-owned needs root, which the runner does not have; the risk is only a human running an edited copy that no longer contains the guard. The guarantee therefore rests on the human running a root-owned copy, which the printed bootstrap gives, and the docs state it. The guard is a safety net for an honest mistake, not a control against an edited copy; the control is the bootstrap, and the spec claims nothing stronger.

### Preflight

- **Tools.** `useradd`, `userdel`, `systemctl`, `getent`, `git`. Missing tool: abort naming it.
- **Python helper.** The governor reads peer uids through `/usr/bin/python3` (`TRUSTED_PYTHON_PATHS`). Without it, `governor start` refuses every caller with `peer-credentials-unreadable`. Install probes `/usr/bin/python3 -c "import socket, struct"` and aborts with `python3-missing` when it fails.
- **Interpreter.** The service must not run a Node binary the runner can replace. Install resolves the interpreter (`--node`, else `process.execPath`) through `realpath` and requires the file and every ancestor directory to be root-owned and not group- or world-writable. Otherwise it aborts with `interpreter-not-root-owned: <path>` and suggests `--node` with a system Node. This rejects nvm installs.

**Design decision: interpreter custody.** **Chosen:** verify the interpreter is root-owned and refuse otherwise, with `--node` as the override. Copying the Node binary into the install copy would not cover its shared libraries, so copying gives a false guarantee.

### Release clone (install-copy source)

```
PROCEDURE releaseClone(tag, repoUrl := RELEASE_REPO_URL):   # the CLI always passes the default
  1. IF tag does not match ^faff--v[0-9]+\.[0-9]+\.[0-9]+$: abort "from-tag must be a release tag (faff--vX.Y.Z)"
  2. IF repoUrl is not RELEASE_REPO_URL and does not start with file:// : abort   # file:// only via the exported function (tests)
  3. dir := mkdtemp under /root (root:root, 0700); verify /root is root-owned and 0700 or stricter
  4. run as root with a replaced, not inherited, environment, and with -c http.sslVerify=true -c protocol.allow=never -c protocol.https.allow=always: exactly PATH=/usr/sbin:/usr/bin:/sbin:/bin,
     HOME=/root, LC_ALL=C, GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=/dev/null, GIT_TERMINAL_PROMPT=0
     (so GIT_CONFIG_COUNT/KEY/VALUE, GIT_SSL_*, proxy and askpass variables from the caller never reach git):
       git clone --depth 1 --branch <tag> --no-recurse-submodules -c core.hooksPath=/dev/null <repoUrl> <dir>
  5. source_commit := git -C <dir> rev-parse HEAD
     verify git -C <dir> rev-parse refs/tags/<tag>^{commit} == source_commit, else abort
  6. return { dir, source_tag: tag, source_commit }
```

**Chosen** (operator decision, 2026-10-12): the install copy comes from a root-owned clone of a release tag from the remote, never from a working tree. The clone ignores system and user git config and hooks, so a runner-edited `~/.gitconfig` cannot redirect it. It trusts GitHub and branch protection on the release branch, and needs network access at install. The host's identity is checked by TLS against the system CA store: the replaced environment removes `GIT_SSL_NO_VERIFY`, `GIT_SSL_CAINFO` and proxy variables, and `-c http.sslVerify=true` with `protocol.allow=never` (https only) overrides anything else, so a DNS redirect fails the TLS check rather than serving another repository. The tag-equals-HEAD check only guards against a moved tag within that clone; it is not a provenance check and the spec does not claim one. Unsigned tags are an accepted residual risk of the operator's 2026-10-12 decision; `source_commit` is printed so the human can check it, and its comparison is advisory. **Chosen** (operator decision, 2026-10-12, keeping the spec-review round 6 removal of `--repo-url`): the clone source is a code constant with no CLI flag or environment override. The runner is the party this install guards against, and the practical way it shapes an install is by suggesting the command line the human pastes; a `--repo-url` flag would let a suggested fork URL pass every other check (the tag, the root-owned clone, the honest manifest) and install runner-authored code as the key holder. Tests call `releaseClone(tag, repoUrl)` directly with a `file://` bare repository; that parameter is not reachable from `COMMISSAIRE_DISPATCH`, the same seam pattern FAFF-1217 uses for its `deps`. Installing from a fork means building `commissaire` from that fork, which changes the constant in reviewed code. **Anti-pattern:** reading the clone URL from the running checkout's `origin` remote, which the runner controls. **Anti-pattern:** an environment variable that relaxes the https rule at runtime, which any caller could set.

### Account

```
nologin := first existing of /usr/sbin/nologin, /sbin/nologin (abort if neither)
useradd --system --user-group --shell <nologin> --home-dir /var/lib/commissaire --no-create-home commissaire
assert: getent passwd commissaire shows the nologin shell and that home
```

**Chosen** (ADR 0135, decision 2): these attributes exactly. A system-range UID and a nologin shell keep the account out of AccountsService and display-manager greeters. **Anti-pattern:** a login shell or unlocked password "to debug", which reopens the boundary.

### Key directory

```
PROCEDURE provisionDir(plan: DirPlan):
  1. FOR each ancestor A from "/" to the parent of plan.path: IF owner(A) != root OR A is group/world-writable: ABORT naming A
  1a. IF plan.path exists: IF it is not a real directory (symlink or other) OR owner(plan.path) NOT IN {root, plan.owner}: ABORT naming it
      FOR each entry E in it: IF owner(E) NOT IN {root, plan.owner} OR E is group/world-writable: ABORT naming E
      # a runner cannot pre-seed a key: it cannot create root- or commissaire-owned files
  2. mkdir as root if absent; chown plan.owner:plan.group; chmod plan.mode
```

Key directory `/var/lib/commissaire`: owner and group `commissaire`, mode 0700. Install never writes the key; the governor mints it on first start (FAFF-1177 `openState`).

**Chosen:** install provisions the directory with an ancestor check, since `ensureOwnerOnlyDir` neither chowns nor checks ancestors.

### Governor config (allow list and runner checks)

Install writes `<keyDir>/governor-config.json` as `{ "allow_uids": [<runner uid>], "admin_uids": [<admin uid>], "runner_checks": { ... } }`, mode 0600, **owned by the governor account**. Install replaces the file rather than merging into it, and prints any uids it removed from either list: one governor serves one runner user (ADR 0135, decision 2), and a merged list would keep a stale uid that a later account can be assigned. FAFF-1211's `loadGovernorConfig` refuses to start when the file's owner is not the governor's own uid or its mode is not 0600. (The FAFF-1211 code comment and manual-verification note say "root-owned"; the code requires the governor's uid, and a root-owned 0600 file would be unreadable to the governor. The build fixes the comment.)

**Chosen:** `allow_uids` holds the single runner uid, per FAFF-1211, replaced on each install.

`parseGovernorConfig` gains `admin_uids`: optional, absent reads as `[]`, otherwise an array of non-negative integers validated exactly like `allow_uids`. A uid present in both lists is a config error (`loadGovernorConfig` returns an error and `governor start` exits 2), so a uid has exactly one role.

### Admin caller

The operator decided (2026-10-12, comment "Resolution: how the human reaches the governor's socket") that the human runs `pin` and `status` from their own account (FAFF-1217), so the human must reach the socket without being able to request anything that signs.

```
CONST ADMIN_OPS := { "identify" }                  # defined in governor.ts; FAFF-1217 adds the op itself

ENUM CallerRole: runner | admin

PROCEDURE guardUnixConnection(state, callers: Map<uid, CallerRole>, reader, socket):   # amends FAFF-1211
  1. result := reader.readPeerUid(socket)           # unchanged: unreadable -> peer-credentials-unreadable
  2. role := callers.get(result.uid)                # built at start: allow_uids -> runner, admin_uids -> admin
     IF role is absent -> refuse caller-not-allowed (unchanged, logged by appendConnectLog)
  3. onConnection(state, socket, result.uid, role)

PROCEDURE handleRequest(state, request, peerUid?, role?):                               # amends FAFF-1211
  1. IF request is not a record -> refuse malformed-request
  2. IF role == admin AND request.op NOT IN ADMIN_OPS -> reply { ok: false, reason: "op-not-permitted-for-admin", op }
     ELSE reply := dispatchOp(state, request)
  3. appendLog(state, request, reply, peerUid, role)   # the log line gains caller_role
```

- The role check runs before `dispatchOp`, so an admin caller never reaches `handleAdmit`, `handleAuthorize` or `handleConclude`, and nothing it sends is written to governor state.
- A runner caller keeps every operation, as today. The TCP listener is unchanged: no peer check and no role (FAFF-1181).
- The selftest path (no socket, no role) behaves as today.
- `identify`'s request and reply shape belong to FAFF-1217, which adds the op. This ticket only gates who may send it. Its reply carries the install-time `runner_checks` snapshot; FAFF-1217 uses it for the sudo fact only and checks group membership live, as its spec states.
- The admin and runner are different accounts by construction: install refuses an admin user that resolves to the runner's uid (above), and `governor start` refuses a config where one uid is in both `allow_uids` and `admin_uids`. `identify` returns only public material, the key fingerprint and the `runner_checks` record, which the runner can already obtain over its own connection, so the admin role gives the human no secret and gives the runner nothing new.
- If the runner can act as the human's account (shared login, a writable shell profile, sudo), separating the OS accounts proves nothing and the run is not independent. That is ADR 0135 decision 7's condition, which FAFF-1217 checks as host facts before it pins; this ticket does not claim otherwise.

**Chosen:** a second uid list with a fixed operation allow list. It keeps FAFF-1217's "reads the key over its socket" and the kernel peer-credential check, and leaves "one governor serves one runner" intact for every operation that signs.

**Chosen:** `ADMIN_OPS` is a code constant, never configuration. Widening what a human may ask the governor is a reviewed code change.

**Anti-pattern:** adding the admin uid to `allow_uids`. Why: the admin user could then request admissions and grants, and the governor would no longer serve exactly one runner.

**Design decision: how admission records state the runner checks.** **Chosen** (operator decision, 2026-10-12): an optional `runner_checks` object in `governor-config.json`, in the shape under "Runner checks record". `parseGovernorConfig` validates it; `handleAdmit` adds `runner_checks` to the admission payload, deep-equal to the loaded object, and omits the key when the config has none. In-process admissions and governors started without `runner_checks` produce payloads byte-identical to today's.

### Socket directory

The governor's default socket is `<keyDir>/governor.sock`, chmod 0600, inside the 0700 key directory. A separate runner user can neither traverse the directory nor open the socket, so a default install would refuse every call before peer credentials are read. ADR 0135 says the socket file is "restricted to the runner's group" as a second layer behind peer credentials.

```
socket_dir := /var/lib/commissaire-socket
ensureGroup(commissaire-clients, system); setGroupMembers(commissaire-clients, [runnerUser, adminUser])
# the group has no password and no gshadow administrators, so changing its members needs root
provisionDir(owner: commissaire, group: commissaire-clients, mode: 2750)
service starts: governor start --key-dir <keyDir> --socket <socket_dir>/governor.sock --socket-group-access
```

Every member of `commissaire-clients` can now connect, and each connection costs the governor a `/usr/bin/python3` spawn to read the peer uid, plus a `governor-log.jsonl` line when refused (`appendConnectLog`, unbounded today). Install sets the group's members to exactly the runner user and the admin user, replacing any others and printing who it removed. Group membership applies from the member's next login session, which the printed next steps say. Two bounds apply under `--socket-group-access` only:

- **Spawn rate.** At most 20 peer-credential reads per second, one global token bucket shared by every connection on the Unix listener, with no priority by caller (the caller is unknown until the read). A connection over the limit is closed before any spawn and counted; when a minute in which any were closed ends, the governor writes one line `{ "event": "spawn-limited", "count": <connections closed by the cap that minute>, "window_start", "window_end" }` to `governor-log.jsonl`. The runner's call then fails closed through FAFF-1179's unreachable path and the client's existing retry applies; only a member of `commissaire-clients` can cause this, and those members are the runner and the admin. A flood therefore costs at most a parked run (FAFF-1179's bounded retry ends in a park, never a grant); it can never produce a grant, and the admin flooding the socket is the human delaying their own runner.
- **Log rate.** At most 60 refused-connect lines per minute. When a minute in which lines were suppressed closes, the governor writes one line `{ "event": "refusals-suppressed", "count": <refused connections in that minute whose line was not written>, "window_start": <ISO-8601>, "window_end": <ISO-8601> }`; a minute with nothing suppressed writes no summary.

A runner makes a few governor calls per governed effect, far below 20 per second, so the cap only bites on a flood. A flood can therefore delay the runner's own calls, which then fail closed through FAFF-1179's unreachable path; it cannot exhaust the host or fill the log partition.

Mode 2750 gives `commissaire-clients` read and search on the directory and no write, so a member can open `governor.sock` but cannot create, rename, replace or unlink anything in the directory; only the `commissaire` account can, which is also the account that binds the socket. The governor's existing stale-socket `unlink` before `listen` therefore races nobody. Connecting needs write on the socket file itself (0660), never on the directory. The setgid bit makes the socket inherit the directory's group. `governor start` gains a `--socket-group-access` flag: with it, the socket is chmod 0660 and the two bounds apply; without it, behaviour is unchanged (0600). Only the installed service passes the flag, so the default in-key-dir socket, operator-run `governor start` and the FAFF-1215 host-launched governor keep an owner-only socket. The flag is not a capability: anyone may run `governor start --socket-group-access` from the install copy, but that process runs as its caller, cannot read the `commissaire` account's 0700 key directory, and cannot write the socket directory, so it can only serve its own key on a socket of its own. FAFF-1217's `pin` refuses such a governor (`governor-same-user`) because the kernel reports its uid.

**Chosen** (operator decision, 2026-10-12): a separate governor-owned socket directory with a dedicated `commissaire-clients` group holding only the runner user and the admin user, mode 2750, and a 0660 socket enabled by an explicit `--socket-group-access` flag. The runner's primary group would have left the human outside the socket. File modes decide who may connect; the peer-credential guard and the role decide what each caller may ask. `runner_checks.socket_group` records the group on every admission record. FAFF-1251 picks the macOS group name.

### Install copy

```
PROCEDURE provisionInstallCopy(clone):
  1. root := <clone.dir>/plugin/skills/faff
  2. files := union of
       - the static require closure of bin/commissaire (lib/commissaire.js, lib/shared-infra.js and
         everything they require at load time), and
       - the static require closure of every module COMMISSAIRE_DISPATCH requires lazily (lib/governor.js,
         lib/governor-install.js, and FAFF-1217's lib/governor-admin.js once it exists), and
       - non-require assets the closure reads at runtime: lib/peer-cred-helper.py
  3. version := sha256 over the sorted (rel_path, sha256) manifest
  4. dest := /opt/commissaire/<version>/
  5. copy as root; root:root; dirs 0755, files 0644 (bin/commissaire 0755); ancestors checked root-owned
  6. write <dest>/install-manifest.json (root-owned, 0644) with files, version, source_tag, source_commit
```

**Chosen:** the content hash is the version. It identifies the files; provenance comes from the release clone, recorded as `source_tag` and `source_commit`. Re-install with a different tag lands in a new `<version>` directory and the service is re-pointed. Install then removes every version directory except the current one and the one the service ran immediately before this install ("previous"); when the reinstall lands in the same `<version>`, current and previous are the same directory and only it is kept; uninstall removes all of them after the service is gone. **Anti-pattern:** pointing the service at `~/.local/bin`, a checkout, or a runner-owned Node.

### Service

```
/etc/systemd/system/commissaire-governor.service (root:root, 0644)
  [Service]
  User=commissaire
  ExecStart=<node> /opt/commissaire/<version>/bin/commissaire governor start --key-dir /var/lib/commissaire --socket /var/lib/commissaire-socket/governor.sock --socket-group-access
  StateDirectory=commissaire
  StateDirectoryMode=0700
  ReadWritePaths=/var/lib/commissaire-socket
  ProtectSystem=strict
  ProtectHome=yes
  NoNewPrivileges=yes
  PrivateTmp=yes
  Restart=on-failure
  [Install]
  WantedBy=multi-user.target
bootstrap: systemctl daemon-reload; systemctl enable --now commissaire-governor.service
```

**Chosen** (ADR 0135, decision 2): static user with the listed hardening, not `DynamicUser=`. `ProtectSystem=strict` makes the filesystem read-only except `StateDirectory=` and `ReadWritePaths=`, so the socket directory must be listed. `StateDirectory=commissaire` resolves to the key directory; install and systemd agree on owner and mode.

### Escape-route check

```
PROCEDURE escapeCheck(user, uid):
  docker_group := member(user, "docker")   # no docker group: false (rootless Docker passes)
  sudo_rules, sudo_absent := escalationRules(user)   # sudo and doas
  admin_group  := null                      # Linux
  any probe that errors records its flag as true
  independent  := NOT sudo_rules AND NOT docker_group AND admin_group != true

PROCEDURE escalationRules(user):
  sudo := first of /usr/bin/sudo, /usr/local/bin/sudo, /bin/sudo, /usr/sbin/sudo, /usr/local/sbin/sudo,
          or `command -v sudo` under PATH=/usr/sbin:/usr/bin:/sbin:/bin:/usr/local/sbin:/usr/local/bin
  doas := the same search for doas
  IF doas found:
    conf := /etc/doas.conf, else /usr/local/etc/doas.conf
    IF conf missing or unreadable -> RETURN (true, false)                     # fail closed
    IF any non-comment `permit` rule names the user or one of its groups (`:group`) -> RETURN (true, false)
  IF sudo not found: RETURN (false, doas not found)
  run `LC_ALL=C sudo -n -l -U <user>` as root
  exit 0 AND stdout contains "may run the following commands" -> (true, false)
  exit 0 AND stdout contains "is not allowed to run sudo"     -> (false, false)
  anything else (other output, non-zero exit, timeout)          -> (true, false)
  # a rule restricted by host, time or command list is still listed, so it counts as a rule;
  # a sudoers syntax error or unreadable sudoers lands in "anything else" and fails closed
```

**Chosen** (ADR 0135, decision 7): any sudo rule fails the check, not only NOPASSWD; `docker` membership fails it; a missing `docker` group passes. A host with neither `sudo` nor `doas` passes this leg, and `sudo_absent` is true only then; `doas` (the default on Alpine and other minimal hosts) is checked from its config file, failing closed when that file cannot be read. The record's `sudo_rules` therefore means "sudo or doas grants the runner a rule"; the field name stays for the shape the operator settled. Other root routes (setuid binaries, capabilities, polkit rules) are not enumerated; the check is a floor (see Failure modes). A probe that errors fails closed. Install completes either way and prints the result. `pin` (FAFF-1217) refuses when `independent` is false.

### Learning the fingerprint

```
PROCEDURE learnFingerprint(keyDir):
  poll for <keyDir>/governor-key.json (bounded, 30 s)
  read as root, take its pk_fingerprint field
  on timeout: pk_fingerprint null, with `systemctl status commissaire-governor` to inspect; install exits 1
```

**Chosen:** read the key file as root. The socket is not an option because root is not on the allow list, and the service's stdout goes to journald.

### Uninstall

```
PROCEDURE governorUninstall(flags):
  1. root guard; self-custody guard
  2. systemctl disable --now commissaire-governor.service; rm the unit; systemctl daemon-reload
  3. write allow_uids [] and admin_uids [] in governor-config.json, keeping runner_checks out
  4. IF --purge-key: remove the key directory
     ELSE: chown -R root:root the key directory and its contents, keep modes (0700 dir, 0600 files)
  5. remove the socket directory, then groupdel commissaire-clients
  6. userdel commissaire (and its group)
  7. remove all install-copy directories
  any failed step aborts uninstall before the account is removed, so the key never belongs to a deleted uid
```

**Chosen:** keep the key directory by default, owned by root. Leaving it owned by the deleted governor uid would hand the signing key and root secret to whichever account is next assigned that uid. Re-install re-chowns the directory to the recreated account. The key file is unchanged, so earlier grants still verify.

### Idempotency

Re-running install converges. Existing account: verify shell and home, abort on mismatch. Existing `commissaire-clients` group: verify it is a system group, then set its members to exactly the runner and admin users. Existing directory: verify owner, mode and ancestors, re-chown and re-chmod when root-owned but wrong, abort when a non-root user owns an ancestor. Existing service: re-point at the current install copy and restart. Existing install copy with a matching manifest: reuse. Each choice is made at plan time from the probes. Converged means: a second install with the same flags and tag exits 0 and leaves `governor-config.json`, the unit file, the `commissaire-clients` membership and the install copy byte-identical (apart from `runner_checks.checked_at`), and never touches the key file. **Chosen:** abort on a non-root-owned resource rather than adopting it.

### Dispatch wiring (`commissaire.ts`)

```
COMMISSAIRE_DISPATCH        + "governor install", "governor uninstall" (lazy require)
REQUIRED_FLAGS_BY_CANONICAL + "governor install": ["--runner-user", "--from-tag"]; "governor uninstall": []
COMMISSAIRE_SPEC.flags      + --runner-user, --admin-user, --from-tag, --socket-dir, --install-prefix, --node (arity 1);
                              --purge-key, --socket-group-access (arity 0)
parseCommissaireArgs        value flags into the `single` set; booleans as booleans
usage()                     two new lines, and --socket-group-access on the start line
```

Rebuild and commit the emits (`cd plugin/skills/faff && npm install && npm run build`).

### Failure modes

- **The escape-route probe under-reports** (sudo access granted in a way `sudo -l -U` misses, or a `docker`-equivalent group under another name). The check is a floor, not a proof; ADR 0135 decision 7 says sudo configuration is out of reach without sudo. Unrunnable probes fail closed, and the record is presented as a claim.
- **The closure walk misses a runtime asset** (a lazy require or a non-require file like `peer-cred-helper.py`). The container test catches it by running `governor start` from the install copy and completing an admit from the runner user.
- **The human runs install from a runner-edited copy.** The self-custody guard refuses an unedited runner-writable copy; an edited copy can delete the guard. Documented under "Self-custody guard"; the printed bootstrap avoids it.
- **The interpreter's shared libraries are runner-writable** while the binary is root-owned. The ancestor check covers the binary's own tree only; a system Node from a root-owned prefix avoids this.
- **The runner checks go stale after install** (a later `docker` membership or sudo rule). **How you'd know:** FAFF-1217's live group check or `status`'s `checked_at` age. **What it means:** re-run install to refresh the record; how stale a record a run may carry is FAFF-1182's call (section 2).
- **No network at install.** The release clone fails and install aborts before any mutation.
- **Group membership not yet active.** The runner or admin user still in a login session from before install gets `EACCES` on connect. The next steps say to start a new session; FAFF-1217's `status` reports it as `socket: unreachable`.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a Linux host with no commissaire account, /usr/bin/python3 present, a root-owned Node,
  install code in a root-owned clone, and runner user "alice" not in docker and with no sudo rules
When root runs `commissaire governor install --runner-user alice --from-tag <tag>`
Then system user "commissaire" exists with a nologin shell and home /var/lib/commissaire,
  and /var/lib/commissaire is commissaire-owned, 0700, with root-owned ancestors,
  and governor-config.json is commissaire-owned, 0600, with allow_uids [alice's uid]
    and runner_checks { runner_user "alice", docker_group false, sudo_rules false, independent true, source_tag <tag>, ... },
  and governor-config.json lists admin_uids [<the sudo user's uid>],
  and group commissaire-clients has exactly the members alice and the sudo user,
  and /var/lib/commissaire-socket is commissaire:commissaire-clients, 2750,
  and the systemd unit is enabled and running from /opt/commissaire/<version>/,
  and alice, in a new login session with COMMISSAIRE_GOVERNOR=/var/lib/commissaire-socket/governor.sock,
    runs `/opt/commissaire/<version>/bin/commissaire contract admit --run-dir <tmp run> --producer <id>
    --contract-revision faff-runner-v1 --scope merge`, which exits 0 with a governor admission
    whose payload carries runner_checks deep-equal to the config's,
  and the result prints source_commit and all three next steps
```

```
Given runner user "alice" is in the docker group
When root runs the install
Then runner_checks.docker_group is true and independent is false, and the install completes and prints it
```

```
Given a governor started from a governor-config.json with no runner_checks key
When a runner admits
Then the admission payload has no runner_checks key and is otherwise unchanged
```

```
Given governor-config.json carries runner_checks with independent true but docker_group true
When the governor starts
Then it exits 2 naming runner_checks
```

```
Given a Linux install for alice and a second local user "mallory" outside commissaire-clients
When mallory connects to the governor socket
Then connect() fails with EACCES and the governor log gains no line
```

```
Given the same install and mallory added to commissaire-clients by hand
When mallory connects and sends an admit request
Then the governor replies caller-not-allowed before reading the request, and logs mallory's uid
```

```
Given a Linux install for alice with admin user "hal"
When hal connects to the governor socket and sends { "op": "admit", ... }
Then the governor replies op-not-permitted-for-admin, writes nothing to its state,
  and logs the line with hal's uid and caller_role admin
```

```
Given the same install
When hal sends { "op": "identify" }
Then the reply is not op-not-permitted-for-admin: it is unknown-op while FAFF-1217 is unmerged,
  and FAFF-1217's identify reply after; the test asserts only that the role check let it through
```

```
Given governor-config.json lists the same uid in allow_uids and admin_uids
When the governor starts
Then it exits 2 naming admin_uids
```

```
Given sudo is run by alice herself, from the root-owned release clone printed by the bootstrap
When alice runs `sudo /root/commissaire-<tag>/plugin/skills/faff/bin/commissaire governor install --runner-user alice --from-tag <tag>`
Then it aborts with "admin-user must be a human account other than root, the runner and the governor" and creates nothing
```

```
Given install code under a directory owned by alice
When root runs `commissaire governor install --runner-user alice --from-tag <tag>`
Then it aborts with install-code-not-root-owned naming the path, prints the bootstrap, and creates nothing
```

```
Given --from-tag main
When root runs the install
Then it aborts with "from-tag must be a release tag" before cloning
```

```
Given root's ~/.gitconfig contains a url.<other>.insteadOf rewrite for github.com
When root runs the install
Then the clone ignores it and fetches from https://github.com/shftwst/faff.git
```

```
Given an installed governor for alice
When root runs `commissaire governor uninstall`
Then the service, the commissaire account and the socket directory are gone,
  and the key directory and governor-key.json remain, owned by root, modes 0700 and 0600,
  and governor-config.json lists no uids in allow_uids or admin_uids,
  and group commissaire-clients is gone
When root instead runs `commissaire governor uninstall --purge-key`
Then the key directory is also gone
```

```
Given a host with no sudo binary and alice outside docker
When root runs the install
Then runner_checks.sudo_rules is false, sudo_absent is true, and independent is true
```

```
Given runner user "bob" has no account
When root runs the install with --runner-user bob
Then it aborts with "no such user: bob" and creates nothing
```

```
Given the command is run without root
When `commissaire governor install --runner-user alice --from-tag <tag>` runs
Then it exits 2 saying it must run as root, before any sudo or doas call
```

```
Given the interpreter is under a user-owned nvm directory
When root runs the install
Then it aborts with interpreter-not-root-owned naming the path, and creates nothing
```

- Plan-builder unit tests assert account attributes, nologin resolution, unit text, directory plans, the manifest and the `runner_checks` object, with no root.
- Admin-caller unit tests with a stub peer-credential reader: an admin uid is refused `op-not-permitted-for-admin` for `admit`, `authorize` and `conclude` with no state change; reaches `dispatchOp` for `identify`; a runner uid keeps every operation; an unlisted uid is `caller-not-allowed`; log lines carry `caller_role`.
- `parseGovernorConfig` unit tests: absent `admin_uids` accepted; a non-array or negative `admin_uids` and a uid in both lists rejected; absent `runner_checks` accepted; each wrong type, missing key, extra key, `schema != 1`, `sudo_absent` with `sudo_rules: true`, Linux with non-null `admin_group`, and an `independent` that contradicts the formula rejected.
- Release-clone unit tests with a stub executor: tag pattern refusal, non-https refusal, the exact `git clone` argv and environment, and an abort when the tag's commit differs from `HEAD`.
- Rate caps, as unit tests with an injected clock and a stub peer-credential reader: the 21st connection within one second is closed with no reader call, and that minute's close writes one `spawn-limited` line with count 1; the 61st refused connection within one minute writes no line, and the minute's close writes one `refusals-suppressed` line with count 1; without `--socket-group-access` neither cap applies.
- The install-copy manifest test starts `governor start` from a copy built only from the manifest, so a missing module fails the test.

## 6. Open questions and assumptions

**Open questions.** None. The three earlier Punts were settled by the operator on 2026-10-12.

**Assumptions.**

- **Assumes:** FAFF-1177 and FAFF-1211 as merged: `governor.ts` exports `governorStart`, `openState` and `loadGovernorConfig`; the governor mints its key on first start; the key file carries `pk_fingerprint`. Verified on main at `ba8c778f`.
- **Assumes:** releases are tagged `faff--vX.Y.Z` on `https://github.com/shftwst/faff.git` by release-please, and a tag at or after this ticket's merge contains `governor-install.js`. The container test calls the exported `governorInstall(flags, deps)` with `deps.releaseRepoUrl` set to a local bare repository (`file://`). `deps` defaults to production values and `COMMISSAIRE_DISPATCH` calls `governorInstall(flags)` with no `deps`, the same seam FAFF-1217 uses, so the shipped CLI has no way to pass it.
- **Assumes:** the host provides the tools listed under Preflight; preflight aborts with a named tool otherwise.

## 7. Done

### Command and wiring
- [ ] `governor install` and `governor uninstall` are wired into dispatch, required flags, the flag spec, `parseCommissaireArgs` and `usage()`; `--runner-user` and `--from-tag` are required for install, `--runner-user` never falls back to `SUDO_USER`, and `--admin-user` defaults to `SUDO_USER`.
- [ ] Install refuses an admin user that is missing, root, the runner user or the governor account.
- [ ] The command refuses with exit 2 when not root, and never escalates through `sudo` or `doas` (its only `sudo` call is the escape-route check's `sudo -n -l -U`, made while already root); on macOS it exits 2 pointing at FAFF-1251.
- [ ] The self-custody guard refuses install code or interpreter that is not root-owned, or sits under a group- or world-writable ancestor, and prints the bootstrap.
- [ ] `commissaire.ts`/`.js`, `governor.ts`/`.js` and `governor-install.ts`/`.js` are rebuilt and committed; `faff regions check` passes; `test/commissaire-standalone.test.mjs` passes (lazy require).

### Release clone
- [ ] `--from-tag` must match `^faff--v[0-9]+\.[0-9]+\.[0-9]+$`; install always clones `https://github.com/shftwst/faff.git` and `commissaire governor install --repo-url …` exits 2 as an unknown flag.
- [ ] The release clone's `git` runs with exactly the environment in `releaseClone` step 4; a test sets `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=url.file:///tmp/evil.insteadOf`, `GIT_CONFIG_VALUE_0=https://github.com/` in the caller's environment and shows the clone still targets the constant URL.
- [ ] The clone runs as root into a root-owned 0700 temporary directory under `/root`, ignores system and global git config and hooks, verifies the tag's commit equals `HEAD`, and is removed after install.
- [ ] Install never reads files for the install copy from any path outside the release clone.

### Preflight
- [ ] Install aborts with `python3-missing` when `/usr/bin/python3` cannot import `socket` and `struct`.
- [ ] Install aborts with `interpreter-not-root-owned` when the interpreter or an ancestor is not root-owned or is group- or world-writable.

### Account and directories
- [ ] The account matches section 4, "Account".
- [ ] The key directory is governor-owned, 0700, with verified root-owned ancestors; install never writes the key.
- [ ] `governor-config.json` is governor-owned, 0600, with exactly the runner's uid in `allow_uids`, exactly the admin's uid in `admin_uids` and a valid `runner_checks`; install prints any uids it replaced; `governor start` loads it.
- [ ] Group `commissaire-clients` is a system group whose members are exactly the runner and admin users.
- [ ] The socket directory is governor-owned, group `commissaire-clients`, mode 2750; `governor start --socket-group-access` creates the socket 0660; the runner user can complete an admit over it.
- [ ] An admin caller is refused `op-not-permitted-for-admin` for every operation outside `ADMIN_OPS` before dispatch, with no state change; a uid in both lists makes `governor start` exit 2; log lines carry `caller_role`.

### Install copy and service
- [ ] The install copy holds the require closure plus `peer-cred-helper.py`, root-owned, under `/opt/commissaire/<version>/` with `install-manifest.json` recording `source_tag` and `source_commit`.
- [ ] Install keeps only the current version directory and the one the service ran immediately before it (one directory when they are the same); a test installs tags A, B and C in turn and finds only B and C under `/opt/commissaire/`; uninstall removes all.
- [ ] Install refuses a runner user below `UID_MIN`, with no override flag.
- [ ] The systemd unit matches section 4, "Service", including `ReadWritePaths` for the socket directory, and is enabled and running.

### Runner checks, fingerprint, uninstall
- [ ] The escape-route check records each field per section 4, "Escape-route check": fails closed on an erroring probe, passes a missing `docker` group and an absent `sudo` binary.
- [ ] `parseGovernorConfig` accepts an absent `runner_checks` and rejects every malformed shape listed in section 5; a malformed `runner_checks` makes `governor start` exit 2.
- [ ] With `runner_checks` in `governor-config.json`, every admission payload carries `runner_checks` deep-equal to the loaded object; without it, the payload has no `runner_checks` key and is byte-identical to today.
- [ ] Install prints the fingerprint from the key file, `source_commit` and all three next steps from the install result: the `.faffrc.yaml` endpoint, a new login session for the runner and admin users, and `/opt/commissaire/<version>/bin/commissaire governor pin --socket <socket_path> --runner-user <runner> --repo <OWNER/NAME>` as the admin user (FAFF-1217's `pin` has no default socket path, and `COMMISSAIRE_GOVERNOR` is set only in the runner's configuration). When the key file never appears within 30 seconds, install prints the result with `pk_fingerprint: null` and exits 1.
- [ ] Install aborts, naming the path, when an existing key directory or any entry in it is owned by a user other than root or `commissaire`, or is group- or world-writable; a test pre-seeds a runner-owned `governor-key.json` and sees the abort.
- [ ] An invalid `--from-tag` exits 2 before the self-custody guard runs, so the printed bootstrap never carries an unvalidated tag.
- [ ] Uninstall removes the service, account, socket directory and `commissaire-clients` group, empties `allow_uids` and `admin_uids`, and keeps the key directory re-owned by root unless `--purge-key`.
- [ ] `governor start --socket-group-access` sets the socket to 0660, caps peer-credential reads at 20 per second and refused-connect log lines at 60 per minute with the `refusals-suppressed` line defined under "Socket directory" (count = suppressed refusals in the closed minute); without the flag the socket stays 0600 and existing FAFF-1211 tests pass with no assertion changed (call sites move to the `Map` caller set, as section 2 says).
- [ ] Re-running install with the same flags converges as defined under "Idempotency" (a container test runs it twice and compares the files), and aborts on a non-root-owned resource.

### Tests
- [ ] Plan-builder, `parseGovernorConfig`, release-clone and rate-cap unit tests run without root.
- [ ] A Linux-container test (`node:20` + `useradd` + `runuser`, per the FAFF-1109 precedent) runs a real install from a root-owned clone of a local bare repository, starts the governor from the install copy, admits from the runner user with `runner_checks` on the payload, refuses `admit` from the admin user with `op-not-permitted-for-admin`, and is refused from a third user.

## Changes since the 2026-10-10 spec

- FAFF-1211 merged: `governor-config.json` must be owned by the governor account, not root. Corrected.
- New: the socket directory. The default socket inside the 0700 key directory is unreachable by a separate runner user.
- New: preflight for `/usr/bin/python3` (FAFF-1211's peer-credential helper) and a root-owned interpreter.
- New: `peer-cred-helper.py` is part of the install copy; a require-only closure walk misses it.
- New: install prints the `commissaire.governor` socket setting for the runner (FAFF-1179).
- The fingerprint now comes from the key file's `pk_fingerprint` field.
- Spec review rounds 1 to 4 (2026-10-12): uninstall re-owns the kept key directory to root; install replaces the allow list; the sudo probe is specified; refused-connect logging and peer-credential reads are capped; the 0660 socket is opt-in; the install copy's closure starts at `bin/commissaire`; plan asserts replace re-planning; old install copies are pruned; system-account runner users are refused.
- Second operator resolution (2026-10-12): a read-only admin caller. Install takes `--admin-user` (default `SUDO_USER`), writes `admin_uids`, and creates `commissaire-clients` (runner + admin) as the socket directory's group; the guard restricts admin callers to `ADMIN_OPS`; uninstall removes the group. `--runner-user` no longer falls back to `SUDO_USER`. The text now says FAFF-1217 reads `runner_checks` from the `identify` reply; admission payloads carry the copy.
- Spec review round 10 (2026-10-12), applied after the review loop cap: `--from-tag` is validated before the self-custody guard prints its bootstrap; install exits 1 when the fingerprint never appears; an existing key directory or any entry in it not owned by root or the governor aborts install; cap-closed connections are logged as a per-minute `spawn-limited` count. These fixes have not been re-reviewed.
- Spec review round 9 (2026-10-12): the only `sudo` call is named as a read-only query; the group has no gshadow administrators; existing FAFF-1211 tests keep every assertion with call sites moved to the `Map` caller set; stale runner checks are a named failure mode.
- Spec review round 8 (2026-10-12): `--allow-system-runner` removed (a shared service uid is not one actor and the record could not say so); `pin` is run from the install copy, whose closure now includes every lazily dispatched module; later readers' use of `runner_checks` is FAFF-1182's; the suppression line, version pruning and convergence are defined and tested; three scenarios made decidable.
- Spec review round 7 (2026-10-12): the escape-route check also reads `doas` and searches more sudo paths, failing closed on an unreadable `doas.conf`; the clone forces TLS verification and https only; the rate cap is one global bucket; the `deps` test seam is named; `identify`'s shape is FAFF-1217's.
- Spec review round 6 (2026-10-12): `--repo-url` removed, so the clone source is a code constant (a runner-suggested fork URL would otherwise pass every check), along with the `COMMISSAIRE_TEST_ALLOW_FILE_REPO` escape hatch; the release clone runs git with a replaced environment so `GIT_CONFIG_COUNT` injection cannot redirect it; the socket directory, `--socket-group-access`, admin caller and runner-checks snapshot limits are stated explicitly; the Done item names all three next steps.
- Alignment with FAFF-1217 (2026-10-12): the printed `pin` next step passes `--socket <socket_path>`, since `pin` has no default socket path.
- Third operator resolution (2026-10-12): both review-forced removals (`--repo-url`, `--allow-system-runner`) stay; the ticket is unparked and goes to build without further review rounds, with the round 10 fixes left to the build's code review.
- Operator resolution (2026-10-12): macOS moved to FAFF-1251; the install copy comes from `--from-tag` via a root-owned release clone, with a self-custody guard on the running install code; `runner_checks` is defined field by field, validated at governor start and echoed on admission payloads.

build-tier: complex
confidence: high
spec-review: human-override (operator, 2026-10-12)


```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```
