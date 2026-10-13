# FAFF-1217: `commissaire governor pin` and `commissaire governor status`

> Spec: faffter-dark-nlspec · 2026-10-13 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1217.

> Revised 2026-10-12 after five spec-review rounds and the operator's resolution of the two open questions (comment "Resolution: the two open spec decisions"). The human runs both commands from their own account with `--runner-user`; `pin` is Unix-socket only; the install record is FAFF-1216's `runner_checks`. A second operator resolution (comment "Resolution: how the human reaches the governor's socket") settles the last open question: FAFF-1216 admits the human who ran install as a read-only admin caller, limited to `identify`, through a dedicated `commissaire-clients` socket group.

> Spec review rounds 6 to 8 (2026-10-12 and 2026-10-13, a fresh window after the operator's decisions): rounds 6 and 7 objections fixed in place (interpreter and `git`/`gh` custody, the `host_checks` definition, a self-contained container test, the peer-uid oracle, the key directory bound to the governor account's home). Round 8 brought a new security objection, so the loop stopped and the ticket was parked with two open security questions.

> Resolved 2026-10-13 by the operator (comment "Resolution: the round-8 security questions"): `pin` accepts a runner checks record of any age and shows `checked_at` and its age in the PR body; `pin` requires `--repo OWNER/NAME` and refuses `repo-mismatch` when `origin` names a different repository. The operator also ruled that this spec builds without further review rounds: the human ruling replaces the non-converging review loop, and the build's code review checks the fixes made after round 8.

This spec is for the build agent and the human reviewing FAFF-1217. It adds two commands to the standalone `commissaire` binary (`plugin/skills/faff/bin/commissaire`, also reachable as `faff commissaire …`): `governor pin`, which proposes a governor's key fingerprint for the trust file through a pull request, and `governor status`, which reports whether a governor's runs can count as independent evidence.

## 1. Why

A governor's runs count for Gate 1 (FAFF-832) only when its key fingerprint is listed in `governor_key_fingerprints` in the base branch's `.commissaire/trust.toml`, and three further conditions hold: the trust file is read from a remote base branch, the base branch requires a pull request, and the runner acts under its own GitHub identity (ADR 0135, decisions 6 and 7; FAFF-1109 comment 862cf5f5). `pin` is the only supported way to propose a fingerprint. It refuses a governor whose independence it can disprove from facts on the host, and puts the rest in front of the human who approves the PR. `status` tells the operator which conditions hold, so a run that will not count is visible before it starts.

**Problem.** Today the governor (FAFF-1177) has `start` and `rotate` only. Nothing reads its public key over the socket, nothing writes a pin, and nothing checks the counting conditions. An operator has to hand-edit the trust file and has no way to tell whether a run will count.

### Design principles

**Fail closed on every check.** A check that cannot complete (no `gh`, an API error, an unreadable reply) reports `unknown`, and `unknown` counts as not met. `pin` refuses rather than pins when any of its own checks is inconclusive.

**The human runs the checks, about the runner.** The human installs the governor, pins it and approves the PR (ADR 0135). `pin` and `status` therefore run from the human's own account, and every independence check is about the runner's account, named by `--runner-user`. A check the runner could steer (its checkout, its `PATH`, a copy of the code it can edit) is refused rather than trusted.

**Commissaire stands alone.** The new code must not import faff's config reader or `merge-gate.js`, and must pass the standalone binary's import-independence guard (`test/commissaire-standalone.test.mjs`). It carries its own `gh` and `git` calls, as `commissaire-trust.ts` already does.

**Trust host facts over governor claims.** Anything the governor says about itself (its runner checks record, its key path) is a claim. Where `pin` can check a fact independently, through the kernel or the file system, it checks the fact. Creating a second OS user needs root, so a governor that the kernel shows running as a different, non-root system user was set up by someone with root or a root-equivalent group. `pin` checks the runner's membership of root-equivalent groups directly from the group database (section 4, `pin` step 5); sudo rights cannot be checked without calling sudo, so that one fact stays with the runner checks record (ADR 0135, decision 7, the sudo caveat).

**The human merges the pin.** `pin` opens a pull request; it never merges one, and the PR body says a human must approve it (FAFF-1109 comment 71b55ac3). Neither command calls `sudo`.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governor.ts` | TypeScript | Governor server: `dispatchOp` (admit, authorize, conclude), `guardUnixConnection` (refuses any uid not in `allow_uids` before an op is read; FAFF-1216 adds `admin_uids` and the `ADMIN_OPS` role gate), `loadGovernorConfig`, `KEY_FILE_NAME = "governor-key.json"` |
| `plugin/skills/faff/bin/lib/commissaire-trust.ts` | TypeScript | `readTrustFile` (local `git show` or remote `gh api contents`), `parseTrustToml`, `validateSchema1`; governance region |
| `plugin/skills/faff/bin/lib/commissaire-governor-client.ts` | TypeScript | `parseEndpoint`, `governorRequest` (newline-delimited JSON over a Unix socket or TCP, run in a subprocess) |
| `plugin/skills/faff/bin/lib/peer-cred.ts` | TypeScript | `makePeerCredReader().readPeerUid(socket)`: the kernel-reported uid at the other end of a Unix socket, through the trusted Python helper (FAFF-1211) |
| `plugin/skills/faff/bin/lib/producer-auth.ts` | TypeScript | `pkFingerprint` (SHA-256 of the SPKI-DER key, lowercase hex) |
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript | `COMMISSAIRE_DISPATCH` table, where `governor start` and `governor rotate` are wired |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `faff branch-protection-check` already calls `gh api repos/{repo}/rules/branches/{branch}`; `githubActorMatches` strips a trailing `[bot]`. Pattern reference only, not imported |
| FAFF-1216 spec, "Runner checks record" | Spec | The `runner_checks` object in `governor-config.json`, validated at governor start |
| `records/adr/0135-commissaire-governor-runs-out-of-process-opt-in-with-pinned-keys.md` | Markdown | Decisions 2, 6, 7, 9 and 11 |

**Scope.** These are operator commands on the Commissaire side of ADR 0135's ownership line; the governor itself, the install command and the verify function are separate tickets.

## 2. Out of scope

- **Creating the governor's OS user, service and runner checks record.** That is `commissaire governor install`: FAFF-1216 (Linux) and FAFF-1251 (macOS). Extension point: the `runner_checks` object FAFF-1216 adds to `governor-config.json`.
- **macOS governors.** FAFF-1216 covers Linux only; macOS install is FAFF-1251. Until FAFF-1251 lands there is no supported macOS governor to pin: `pin` refuses `platform-unsupported` on macOS, and `status` runs but reports `host_checks: "unknown"` with a caveat. Extension point: `ROOT_EQUIVALENT_GROUPS.macos` (already defined here) and the platform check in `pin` step 2, which FAFF-1251 lifts.
- **Remote governors over TCP** (the Fly governor). FAFF-1181 owns TCP caller authentication and extends `pin` once it exists (operator decision, 2026-10-12). Extension point: the transport check in `pin` step 2.
- **Verifying grants against the pins.** That is FAFF-1178's verify function.
- **The pin-change approval rule** (refusing an unattended merge that touches the trust file). That is FAFF-1218.
- **Gate 1 counting of real runs and the `independence: not-counted` field on run evidence.** That is FAFF-1182. `status` is a pre-flight report; it does not decide whether a run counts and does not write run evidence.
- **Key rotation.** `governor rotate` already exists (FAFF-1177); unpinning the old fingerprint is a hand-made, human-approved PR.
- **Lifting the claude-box refusal.** That follows FAFF-1209 and FAFF-1215 in the claude-box repository.
- **A faff wrapper (`faff governor pin`).** ADR 0135 allows one; `faff commissaire governor pin` already reaches the same handler.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Runner user | The OS account the runner (the agent) runs as, named by `--runner-user`. Every independence check is about this account |
| Invoker | The OS user running `pin` or `status`: the human, from their own account. Never the runner user and never root |
| Runner checks record | FAFF-1216's `runner_checks` object in `governor-config.json`: who the runner is and whether its `docker` group, sudo and (macOS) `admin` group checks passed, summarised as `independent`. The governor loads it at start and returns it from `identify` |
| Admin caller | FAFF-1216's `admin_uids` entry for the human who ran install (`--admin-user`, default `SUDO_USER`). The governor admits that uid on its Unix socket for the operations in FAFF-1216's `ADMIN_OPS` only, which is `identify`; anything else is refused `op-not-permitted-for-admin` |
| Counting conditions | The three conditions from FAFF-1109 comment 862cf5f5: remote base branch, branch protection requiring a PR, separate runner identity |
| Custody label | `custody: governor` when a governor endpoint is configured (by `--socket` or `COMMISSAIRE_GOVERNOR`), whether or not it answers, because a configured governor that cannot be reached stops the run rather than falling back (ADR 0135, decision 1; FAFF-1179). `custody: in-process` only when no endpoint is configured |

### Commands

```
commissaire governor pin    --socket PATH --runner-user NAME --repo OWNER/NAME [--base BRANCH] [--dry-run]
commissaire governor status [--socket PATH] [--runner-user NAME] [--repo OWNER/NAME] [--base BRANCH] [--runner-login LOGIN]
```

- The governor endpoint comes from `--socket`, else the `COMMISSAIRE_GOVERNOR` environment variable, parsed with the existing `parseEndpoint`. There is no guessed default path, because FAFF-1216 owns where an installed governor's socket lives.
- FAFF-1216's install prints the exact first command for the human: `/opt/commissaire/<version>/bin/commissaire governor pin --socket <socket_path> --runner-user <runner> --repo <OWNER/NAME>`, run as its admin user from the install copy, with `<OWNER/NAME>` left for the human to fill in (install does not know the repository). `COMMISSAIRE_GOVERNOR` is set only in the runner's configuration, so the human normally passes `--socket`.
- `--runner-user` names the runner's OS account. `pin` requires it (usage error, exit 2, without it). For `status` it is optional; absent, `host_checks` is `unknown "runner-user-not-given"`.
- `--repo OWNER/NAME` names the target repository. `pin` requires it (usage error, exit 2, without it); `status` takes it optionally. It must match `^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*$` with no `..`, the same rule as FAFF-1178's `audit verify --repo`; anything else is a usage error, exit 2, before any socket, `git` or `gh` call.
- `origin` must agree with it. `git remote get-url origin` is parsed to `OWNER/NAME` (HTTPS and SSH forms) and compared with `--repo` ignoring case (GitHub owner and repository names are case-insensitive). Only `github.com` and `ssh.github.com` hosts are accepted; another host or an SSH host alias (`git@github-work:…`) is treated as unparseable, so `pin` refuses `repo-mismatch` and the detail suggests an `https://github.com/OWNER/NAME` or `git@github.com:OWNER/NAME` origin. A different repository → `pin` refuses `repo-mismatch`, naming both; `status` reports `remote_base` not-met `repo-mismatch`. No `origin` remote → `pin` refuses `no-remote-base`; `status` reports `remote_base` not-met `no-remote-base`. When `status` gets no `--repo`, it uses `origin`'s repository, as before. Every `gh` call passes `--repo OWNER/NAME` explicitly.
- `--base` defaults to the repository's default branch from `gh repo view OWNER/NAME --json defaultBranchRef`.
- `--dry-run` on `pin` runs every check and prints the trust-file text it would commit, without creating a branch or PR.
- Both commands print one JSON object on stdout whenever they get past argument parsing. A usage error (missing endpoint, missing `--runner-user` or `--repo` on `pin`, a malformed `--repo`, unknown flag) prints a message on stderr and nothing on stdout, exit 2, as every other `commissaire` verb does today; the parity test covers it.

**Decision: who runs `pin` and `status`.** **Chosen** (operator decision, 2026-10-12): the human, from their own account, with `--runner-user` naming the runner's account. `pin` mechanically enforces it: it refuses `invoked-as-root` (uid 0) and `invoked-as-runner` (the invoker's uid is the runner user's uid). The root-equivalent group check and the runner checks comparison apply to the runner user, so a human administrator (in `admin` on macOS, often `docker` or `sudo` on Linux) is no longer refused for their own groups.

**Decision: which copy of the code and which checkout `pin` may run from.** A human running the runner's checkout, or a `commissaire` the runner can edit, would run runner-controlled code and git hooks under the human's account, which defeats the decision above. **Chosen:** `pin` refuses `code-runner-writable` when any file of its own require closure, or any directory above it, can be written by the runner user, and likewise when the Node interpreter running it (`realpath(process.execPath)`) or any directory above that can be written by the runner user (detail names the interpreter path; the install copy's `#!/usr/bin/env node` resolves `node` from the human's `PATH`, so this is checked, not assumed). This mirrors FAFF-1216's interpreter-custody preflight. Shared libraries the interpreter loads are not enumerated, the same honest limit FAFF-1216 states, and `repo-runner-writable` when the repository's `.git` directory or any directory above it can be written by the runner user. Both use one predicate, `runnerCanWrite(path, runner)`: true when the path is owned by the runner's uid, or is group-writable with a group in the runner's groups, or is world-writable. The refusal detail says to run the installed copy (FAFF-1216's `/opt/commissaire/<version>/`) from the human's own clone. Every `git` call additionally runs with `-c core.hooksPath=/dev/null`. `status` reports the same two facts as caveats instead of refusing.

**Decision: how `pin` and `status` read the governor's key.** Options: (a) a new read-only `identify` operation on the socket; (b) call `admit` and read `pk` from its reply; (c) read the key directory from disk. Option (b) writes an admission record and mints run state, which a read must not do. Option (c) fails by design: the key directory is mode `0700` and owned by the governor's account.
**Chosen:** (a) a new `identify` operation in `governor.ts`'s `dispatchOp`, answered on the Unix socket only (operator decision, 2026-10-12) and logged like every other operation. On the TCP listener `identify` returns `{ ok: false, reason: "op-unix-only" }`, so the unauthenticated TCP listener never discloses the key path or the runner checks record. This ticket owns the operation; FAFF-1216 owns who may call it.

**Decision: how the human's account reaches the socket.** **Chosen** (operator decision, 2026-10-12, comment "Resolution: how the human reaches the governor's socket"): FAFF-1216's read-only admin caller. Install records the human as `admin_uids` in `governor-config.json` and adds them, with the runner, to the `commissaire-clients` group that owns the socket directory. The FAFF-1211 peer-credential guard admits the human's uid with the admin role, and FAFF-1216's role gate allows that role only the operations in `ADMIN_OPS` (`identify`). The human therefore reads the key over the socket with the kernel peer check intact, and cannot request an admission or grant.

```
RECORD IdentifyRequest:
  op: "identify"                     # no other fields

RECORD IdentifyReply:
  ok: true
  pk: string                         # PEM public key
  pk_fingerprint: string             # 64 lowercase hex
  key_file: string                   # absolute path of governor-key.json (a claim; pin checks it against the account's home directory)
  runner_checks: RunnerChecks | null # the object loadGovernorConfig loaded; null when governor-config.json has none
```

`runner_checks` is never malformed in a reply: FAFF-1216's `parseGovernorConfig` refuses to start a governor whose `runner_checks` is malformed. `pin` and `status` still validate the reply's shape, and a mistyped field is `identify-invalid`.

### Output records

```
RECORD PinResult:
  pinned: "opened-pr" | "already-pinned" | "dry-run" | "refused"
  pk_fingerprint: string | null
  reason: RefusalReason | null       # set only when refused
  detail: string | null
  pr_url: string | null              # set only when opened-pr
  branch: string | null

RECORD StatusResult:
  custody: "governor" | "in-process"
  socket: "answers" | "refused:<reason>" | "unreachable" | "invalid-reply" | "not-configured"
  transport: "unix" | "tcp" | null
  governor_uid: integer | null       # kernel-reported uid of the governor process (unix only)
  runner_user: string | null
  host_checks: "passed" | "failed:<RefusalReason>" | "unknown"   # pin steps 4 to 7, without the key-file open
  pk_fingerprint: string | null
  pinned_on_base: "yes" | "no" | "unknown"
  trust_source: "remote-base" | "local-ref" | null
  runner_checks: RunnerChecks | null
  install_result: "passed" | "failed" | "missing" | "unknown"
  counting:
    remote_base:        Condition
    branch_protection:  Condition
    runner_identity:    Condition
  ready_to_count: boolean            # pre-flight only; see status step 9, the one definition
  caveats: string[]                  # always includes the bypass-actor caveat

RECORD Condition:
  state: "met" | "not-met" | "unknown"
  reason: string | null              # e.g. "no-remote-base", "repo-mismatch", "base-not-protected", "runner-identity-not-separate", "gh-unavailable"

ENUM RefusalReason:
  governor-unreachable, governor-refused, identify-invalid, fingerprint-mismatch,
  invoked-as-root, invoked-as-runner, runner-user-unknown, runner-root-equivalent,
  code-runner-writable, repo-runner-writable, platform-unsupported, remote-governor-unsupported,
  governor-same-user, governor-is-root, governor-not-system-user, key-dir-untrusted,
  key-readable-by-invoker, key-read-check-inconclusive,
  install-record-missing, install-check-failed,
  base-not-protected, base-protection-unknown,
  no-remote-base, repo-mismatch, base-moved, trust-file-invalid, git-failed, gh-failed, pr-head-mismatch
```

Exit codes: `pin` exits 0 for `opened-pr`, `already-pinned` and `dry-run`, 1 for `refused`, 2 for a usage error. `status` exits 0 whenever it produced a `StatusResult`, including one with unmet conditions. On an invalid trust file `status` prints `{ "error": "trust-file-invalid", "detail": "<reader message with line number>" }` on stdout and exits 2; a usage error exits 2 with stderr only.

### Trust-file text read

**Decision: where `pin` gets the trust file's text.** `readTrustFile` returns parsed values only, and its `git show` and `gh api contents` readers are private to `commissaire-trust.ts`. Options: a second reader inside the new module (duplicates the 404 handling and reads the base twice), or one new export from `commissaire-trust.ts`.
**Chosen:** add `readTrustFileText({ repoDir, ref, transport, repoSlug })` to `commissaire-trust.ts`, returning `Result<{ present: boolean; text: string | null; source: TrustSource }, TrustFileError>` from the existing private readers. `readTrustFile` is refactored to call it and then parse, with no change to its behaviour or output (the existing `commissaire-trust` tests stay green unchanged). `pin` reads the text once and derives both the "already pinned" check and the edit from those same bytes.

## 4. How

### `identify` on the governor

Add `case "identify"` to `dispatchOp`. The reply takes `pk` and `pk_fingerprint` from the loaded state, `key_file` from `path.join(keyDir, KEY_FILE_NAME)` resolved to an absolute path, and `runner_checks` from the config `loadGovernorConfig` already reads (FAFF-1216 adds the field). The op is answered only on a connection accepted through the Unix listener, for both the runner role and FAFF-1216's admin role; the TCP path returns `op-unix-only`. The human's uid reaches it as an admin caller: FAFF-1216's guard admits `admin_uids` and its role gate passes `identify` (in `ADMIN_OPS`) through to `dispatchOp`. This ticket does not change the guard or the role gate.

### Reading the governor's uid from the kernel

Add a peer-reading variant of the client's socket call: `governorRequestWithPeer(endpoint, request, timeouts)` in `commissaire-governor-client.ts`, Unix endpoints only. In the same subprocess that connects, it calls `makePeerCredReader().readPeerUid(socket)` on the connected client socket before writing the request, and returns `{ ok, reply, peer_uid }` or `{ unreachable, detail }`. `SO_PEERCRED` and `LOCAL_PEERCRED` report the server's credentials when read on the client end, so this is the kernel's answer to "which user runs the process I am talking to". A peer read that fails is `unreachable` with detail `peer-credentials-unreadable`; it never falls back to an unchecked call.

### Resolving the runner user

`lookupRunner(name)` resolves `--runner-user` through the system user and group databases: `id -u -- NAME` and `id -Gn -- NAME` run from `/usr/bin/id` with an empty environment, giving the uid and every group name including the primary group. An unknown name or a failed lookup refuses `runner-user-unknown` in `pin` and makes `host_checks` `unknown` in `status`.

### `pin`

Summary: confirm the code, the checkout and the governor are out of the runner's reach, then propose the fingerprint in a pull request against the remote base branch.

```
PROCEDURE governor_pin(flags):
  1. endpoint := --socket or COMMISSAIRE_GOVERNOR; absent, or --runner-user absent, or --repo absent or malformed → usage error, exit 2
  2. IF platform is macOS → refuse platform-unsupported (detail "macOS governor install is tracked in FAFF-1251")
     IF endpoint is TCP → refuse remote-governor-unsupported (detail "pinning a remote governor is FAFF-1181")
  3. Invoker and runner:
       invoker uid == 0 → refuse invoked-as-root
       runner := lookupRunner(--runner-user); failure → refuse runner-user-unknown
       invoker uid == runner.uid → refuse invoked-as-runner
       runnerCanWrite(any file of pin's require closure or an ancestor directory, runner) → refuse code-runner-writable
       runnerCanWrite(realpath(process.execPath) or an ancestor directory, runner) → refuse code-runner-writable (detail names the interpreter)
       git, gh := the absolute paths PATH resolves them to, realpath'd; runnerCanWrite(either or an ancestor, runner)
         → refuse code-runner-writable (detail names the binary); every later git and gh call uses these absolute paths
       runnerCanWrite(the repository's .git or an ancestor directory, runner) → refuse repo-runner-writable
  4. { reply, peer_uid } := governorRequestWithPeer(endpoint, { op: "identify" })
       unreachable → refuse governor-unreachable
       reply.ok false → refuse governor-refused (detail = reply.reason: caller-not-allowed when the invoker
                        is not the install's admin user, unknown-op from a governor older than this ticket)
       missing or mistyped fields → refuse identify-invalid
     IF pkFingerprint(reply.pk) != reply.pk_fingerprint → refuse fingerprint-mismatch
  5. Runner groups (host facts): runner.groups ∩ ROOT_EQUIVALENT_GROUPS[platform] non-empty
       → refuse runner-root-equivalent (detail names each group)
     ROOT_EQUIVALENT_GROUPS, a constant in governor-admin.ts:
       linux: docker, lxd, incus-admin, libvirt, disk, sudo, wheel, root
       macos: admin, wheel          # used once FAFF-1251 lifts step 2's platform check
  6. Governor user (kernel facts, not the reply):
       peer_uid == 0 → refuse governor-is-root
       peer_uid == runner.uid or peer_uid == invoker uid → refuse governor-same-user
       peer_uid >= the system-range limit → refuse governor-not-system-user
         (UID_MIN from /etc/login.defs, 1000 when absent)
  7. Key directory (file-system facts):
       dir := dirname(reply.key_file); lstat(dir) without following links
       dir != the home directory of peer_uid in the passwd database (getent passwd, field 6) → refuse key-dir-untrusted
         (FAFF-1216 creates the governor account with --home-dir set to its key directory, so the path is checked
         against a host fact, not taken from the reply)
       dir is not a real directory, or is not owned by peer_uid, or its mode is not 0700 → refuse key-dir-untrusted
       any ancestor of dir is not owned by root, or is group- or world-writable → refuse key-dir-untrusted
       open reply.key_file with read-only, non-blocking and no-follow flags:
         succeeds → refuse key-readable-by-invoker
         EACCES or EPERM → passes
         anything else → refuse key-read-check-inconclusive
  8. Runner checks record (a claim; trusted only after steps 5 to 7, since a second system user needs root):
       reply.runner_checks null → refuse install-record-missing
       runner_checks.runner_user != --runner-user, or runner_checks.runner_uid != runner.uid
         → refuse install-check-failed (detail "install-runner-mismatch")
       runner_checks.platform != "linux" → refuse install-check-failed (detail "install-platform-mismatch")
       runner_checks.independent false → refuse install-check-failed
         (detail names each failing field: docker_group true, sudo_rules true, admin_group true)
  9. Resolve the repository and base (section 3). No git remote named origin → refuse no-remote-base.
     origin's OWNER/NAME != --repo (case ignored) → refuse repo-mismatch (detail names both). Every later gh call uses --repo.
     Branch protection on base, by status step 6: not-met → refuse base-not-protected; unknown → refuse base-protection-unknown.
     A pin on a base the runner can push to proves nothing, since the runner could edit the trust file directly.
     read := readTrustFileText(transport "remote")
       read error from gh → refuse gh-failed (detail carries the reader message)
       text present → parse it with parseTrustToml + validateSchema1; failure → refuse trust-file-invalid (line number in detail)
 10. IF fingerprint already in the parsed governorKeyFingerprints → result already-pinned, exit 0, no branch
 11. newText := insert_fingerprint(read.text or none, fingerprint)
     Re-parse newText with parseTrustToml + validateSchema1; failure → refuse trust-file-invalid
 12. IF --dry-run → print newText in detail, result dry-run, exit 0
 13. Open the PR (below). In the worktree, before writing: if the checked-out file's bytes differ from read.text
     (or its presence differs) → refuse base-moved and ask the human to re-run. git or gh failure → refuse git-failed / gh-failed.
     Remove any branch it created locally on every refusal. If the push succeeded and gh pr create then failed,
     delete the remote branch (git push origin --delete <branch>); if that delete also fails, name the branch in detail.
```

**Decision: how `pin` judges independence when the governor describes itself.** The runner checks record and key path come from the governor, so a governor run by the party being vetted could describe itself however it likes. **Chosen:** check host facts first (steps 5 to 7): the runner is in no root-equivalent group, the kernel-reported uid of the governor process is a non-root system account distinct from the runner and the invoker, and the key directory is a real `0700` directory owned by that uid under root-owned, non-writable parents. Without root, sudo or a root-equivalent group, the runner cannot create such a user or directory. The runner checks record (step 8) is then trusted for the one fact `pin` cannot observe without calling sudo: whether `sudo -l -U <runner>` lists a rule, or whether `doas.conf` permits the runner (FAFF-1216 checks both and reports either in `sudo_rules`; the field name is unchanged). A runner with working sudo defeats every local check, as ADR 0135 states. The PR body separates the two (below), so the human sees which lines `pin` checked and which the governor reported.

**Decision: how old a runner checks record `pin` accepts.** The record is an install-time snapshot (FAFF-1216), and the sudo fact is the one fact `pin` cannot check live. A runner that gains a sudo rule after install would still be pinned as independent. Options: (a) accept any age and show it; (b) refuse `install-check-stale` past a fixed limit. **Chosen** (operator decision, 2026-10-13): (a). `pin` accepts a record of any age and puts `checked_at` and its age in whole days (`now - checked_at`, floored; a `checked_at` in the future or unparseable shows as `age unknown`) on the first line of "Reported by the governor". The human approving the pin PR is the control for this fact, and FAFF-1182 can still refuse stale records when it counts runs. Accepted risk: a sudo rule granted to the runner after install is not visible to `pin`.

**Decision: whether `pin` trusts the `origin` remote to name the repository.** The repository, its branch protection and the PR target all come from the human's clone's `origin`. A runner can suggest `git clone <fork>`, and a fork it administers can carry real branch protection, so `pin` would open a PR in the wrong repository and exit 0. Options: (a) require `--repo OWNER/NAME` and refuse `repo-mismatch` when `origin` differs; (b) keep `origin` and print the target. **Chosen** (operator decision, 2026-10-13): (a). The target repository becomes an explicit, visible part of the command the human runs, the same reasoning that removed `--repo-url` from FAFF-1216. `origin` must still agree, because the push and the temporary worktree go through it.

**Decision: which groups count as root-equivalent.** ADR 0135 names `docker` (Linux) and `admin` (macOS) and states that "the same holds for any root-equivalent path on the machine". `lxd`, `incus-admin` and `libvirt` give a root shell through a privileged container or VM; `disk` gives raw block-device access; `sudo` and `wheel` grant sudo by default on Debian-family and Red Hat-family systems and on macOS. **Chosen:** the constant above, applied to the runner user's groups including its primary group. Extending it is a reviewed code change, never configuration.

**Decision: what stops a claude-box host governor being pinned.** FAFF-1215's default is that claude-box keeps its own same-user governor, with no `commissaire governor install` and therefore no runner checks record. **Chosen:** no separate claude-box detector. Such a governor fails step 6 (`governor-same-user`) and step 8 (`install-record-missing`).

**Decision: how `pin` edits the trust file.** Options: rewrite the whole file from the parsed config, or edit the text in place. A rewrite drops the comments that name each pinned key's governor, which the ADR keeps TOML for. **Chosen:** edit in place, then re-parse to prove the result is valid.

```
PROCEDURE insert_fingerprint(text, fp):
  1. IF text is none → return
       "schema = 1\n\n# SHA-256 of each pinned governor's SPKI-DER public key, lowercase hex.\n" +
       "governor_key_fingerprints = [\n  \"<fp>\",  # <host> governor uid <peer_uid>, pinned <date>\n]\n"
  2. IF text has a governor_key_fingerprints entry (a single-line array is first rewritten to the multi-line form,
     one entry per line in the same order; a comment that trailed the single line moves to its own line directly above the array):
       insert "  \"<fp>\",  # <host> governor uid <peer_uid>, pinned <date>" as a new line before the array's closing "]"
  3. ELSE append the multi-line array from step 1 at the end of the file
  4. Leave every line outside the fingerprint array byte-identical, including comment lines before and after it.
     Inside a multi-line array, existing lines and their comments are unchanged. The one permitted reformat is step 2's:
     a single-line array becomes one entry per line and its trailing comment moves directly above it; when that happens
     the PR body says so in one line ("Reformatted the single-line governor_key_fingerprints array to one entry per line;
     no existing fingerprint changed"), so the reviewer sees why the diff touches the existing pin

  <host> is os.hostname() of the machine running pin (pin is Unix-socket only, so this is the governor's host),
  reduced to [A-Za-z0-9.-], at most 63 characters, "unknown-host" when empty. <date> is the UTC date, YYYY-MM-DD.
  Nothing from the governor's reply is written into the file except the fingerprint, which step 4 has already
  matched against the key and which is 64 lowercase hex characters.
```

**Decision: how `pin` creates the branch and PR.** Options: switch branches in the human's checkout, or use a temporary worktree. Switching branches disturbs whatever the human has open. **Chosen:** a temporary `git worktree` created from `origin/<base>` after `git fetch origin <base>`, in a directory under the system temp dir. In it: write the file, `git add`, `git commit --signoff` (the human's git identity; the DCO check needs the trailer), `git push -u origin commissaire/pin-<first 12 hex of fp>`, then `gh pr create --repo OWNER/NAME --base <base> --head <branch>` with the title and body below. Every `git` call carries `-c core.hooksPath=/dev/null`. The worktree is removed in every outcome.

PR title: `chore(commissaire): pin governor key <first 12 hex>`. PR body, in this order:

- the target repository (`--repo`) and base branch;
- the full fingerprint;
- "Checked by `commissaire governor pin`": the host, the runner user and its uid, the governor's uid and that it differs from the runner's and the invoker's, the runner's groups checked against the root-equivalent list, and the key directory's owner and mode;
- "Reported by the governor": first a line giving `checked_at` and the record's age in days (operator decision, 2026-10-13), then the runner checks record's `docker_group`, `sudo_rules`, `sudo_absent`, `independent`, `checked_at`, `install_version` and `source_tag`, inside a fenced code block, each value reduced to printable ASCII without backticks and capped at 64 characters, so governor-supplied text cannot add markdown or links to the review page;
- the reformat line from `insert_fingerprint` step 4, when it applied;
- the sentence "A human must approve this PR. It changes `.commissaire/trust.toml`, so the runner must not merge it."

The branch name `commissaire/pin-<first 12 hex>` is predictable. A squatted branch makes the push fail and `pin` refuse `git-failed`, which is fail-closed.

### `status`

Summary: report every input to the counting decision, each with a state and a reason, and never stop at the first failure.

```
PROCEDURE governor_status(flags):
  1. endpoint absent → custody in-process, socket not-configured; skip to step 3
     endpoint present → custody governor in every outcome below
  2. Unix endpoint: identify with governorRequestWithPeer, then the fingerprint check of pin step 4.
     TCP endpoint: transport tcp, socket not queried, host_checks "unknown" (remote governors are FAFF-1181),
       unless an invoker check failed first, in which case host_checks is that failure, as for every endpoint.
       ok → socket answers; take pk_fingerprint, runner_checks and governor_uid
            host_checks := pin step 3's invoker and runner checks (invoked-as-root, runner-user-unknown, invoked-as-runner),
              then steps 5, 6 and 7 without the key-file open → "passed" or "failed:<reason>"
              (step 3's code-runner-writable and repo-runner-writable checks never enter host_checks; step 8 adds them as caveats, and when `git`, `gh` or the repository is runner-writable `status` skips the calls that would use it and reports the affected counting conditions `unknown` with reason `git-runner-writable`, `gh-runner-writable` or `repo-runner-writable`)
              --runner-user absent or unresolvable → "unknown"; macOS → "unknown"
       refused → socket "refused:<reason>"
       unreachable → socket unreachable
       reply missing or mistyping fields, or fingerprint-mismatch → socket "invalid-reply"
     every outcome other than ok leaves pk_fingerprint and governor_uid null and host_checks "unknown",
       except that the invoker checks run first, before any socket call: when one fails, host_checks is
       "failed:invoked-as-root" or "failed:invoked-as-runner" whatever the socket outcome
  3. install_result := from the reply's runner_checks, by pin step 8: passed, failed, or missing (null);
     unknown when there was no reply, or when --runner-user is absent (nothing to compare against)
  4. Remote base: readTrustFile(transport "remote")
       read succeeds (file present or absent) → remote_base met, trust_source remote-base
       no remote configured, or gh fails → remote_base not-met "no-remote-base" (no remote) or unknown "gh-unavailable";
         then readTrustFile(transport "local") for display only, trust_source local-ref
       trust-file-invalid on either read → print the error object (section 3) and exit 2
  5. pinned_on_base := yes when the identified governor's own pk_fingerprint is in the remote read's governor_key_fingerprints,
     no when it is not; unknown when only a local read succeeded or there is no identified governor
  6. Branch protection: gh api repos/{repo}/rules/branches/{base}
       array containing a rule with type "pull_request" → met
       array without one → not-met "base-not-protected"
       error, 404, or non-array body → unknown "rules-unreadable"
  7. Runner identity:
       runner := --runner-login; absent → unknown "runner-login-not-given"
       human := gh api user .login under the ambient gh credential; failure → unknown "human-login-unreadable"
       normalise every login: strip a trailing "[bot]", then lowercase (GitHub logins are case-insensitive)
       runner equals human → not-met "runner-identity-not-separate"
       pin_change_approvers not available from a remote read → unknown "approvers-unreadable"
       runner in pin_change_approvers → not-met "runner-is-pin-approver"
       otherwise → met
  8. caveats += "The rules endpoint hides bypass actors from non-admin callers, so status cannot prove the runner's identity has no bypass. Check bypass lists by hand (FAFF-1213)."
     caveats += "runner_identity is judged from --runner-login as given; a run counts only on its recorded GitHub actor (FAFF-1182)."
     caveats += "host_checks does not try to open the key file; commissaire governor pin does."
     when pinned_on_base is the only input that keeps ready_to_count false: caveats += "Only the pin is missing: merge the pin PR on the base branch."
     on macOS: caveats += "macOS governors are not supported until FAFF-1251."
     when code-runner-writable or repo-runner-writable would refuse pin: a caveat naming the path
  9. ready_to_count := custody governor AND transport unix AND host_checks passed AND install_result passed
              AND pinned_on_base yes AND all three counting conditions met
```

The key file itself cannot be inspected by the invoker: it sits in a `0700` directory owned by the governor account, so the invoker cannot even `lstat` it, and its existence and `0600` mode (FAFF-1195) are the governor's own concern; `pin`'s read-only open only proves the invoker cannot read it. `status` skips only the key-file open, since it reports rather than refuses, and reports the two runner-writable facts as caveats; the invoker, runner-group, uid and key-directory checks run as in `pin`, so `install_result passed` never counts without them. Because the open is skipped, `host_checks: passed` is weaker than a successful `pin`, and `caveats` says so. On macOS, `host_checks` is `unknown`, so `ready_to_count` is false; the human's own `admin` membership never enters it, because only the runner user's groups are checked.

**`branch_protection` and FAFF-1212's `evidence` flag.** FAFF-1212 puts an `evidence` flag on each grant in merge-gate's output, true only for a pinned grant read from a remote base that requires a PR, and makes it the single home of the "only a protected base counts" rule for real runs. `status` runs before any run or merge exists, so there is no grant and no `evidence` to read; its step 6 is the pre-flight check of the same condition and uses the same definition (a rules array containing a `type: "pull_request"` rule, the rule FAFF-1212's `hasPullRequestRule` encodes). Commissaire cannot import `merge-gate.js` (factory region, and Commissaire must not read faff's config), so `status` keeps its own call; a test pins the two definitions to the same fixtures. Whether a real run counts is FAFF-1182's call, from `evidence`.

**`ready_to_count` is a pre-flight indicator, not evidence.** `--runner-login` is whatever the operator passes. `status` answers "would runs count if the runner really acts as this login", and its output says so in `caveats`. Whether a real run counts is decided by FAFF-1182 from the run's recorded GitHub actor (FAFF-1213), never from `status`.

**Decision: where `status` gets the runner's GitHub login.** faff keeps it in `.faffrc.yaml` (`autonomous.runner_github_login`, FAFF-1213), but Commissaire must not read faff's config (ADR 0135, decision 11). **Chosen:** a `--runner-login` flag. Without it the condition is `unknown`, which counts as not met.

**Decision: where the human's login comes from.** **Chosen:** `gh api user` under the ambient `gh` credential of the human running `status`.

**Decision: how tests reach the host-fact checks.** **Chosen:** `governor-admin.ts` exports `governorPin(flags, deps?)` and `governorStatus(flags, deps?)`. `deps` is a record of injectable functions with production defaults: `peerRequest` (defaults to `governorRequestWithPeer`), `request` (`governorRequest`), `getuid`, `platform`, `lookupRunner`, `lstat`, `openNoFollow`, `ancestors`, `runnerCanWrite`, `requireClosure`, `execPath`, `uidMin` (reads `/etc/login.defs`), `runGit`, `runGh`, `hostname` and `now`. The `COMMISSAIRE_DISPATCH` entries call both with no `deps`, so no seam is reachable from the CLI; tests pass stubs, as the FAFF-1211 guard tests pass a stub `PeerCredReader`.

**Decision: where the code lives.** **Chosen:** a new module `plugin/skills/faff/bin/lib/governor-admin.ts` carrying the `// === region:factory — governor-admin — FAFF-1217 … ===` banner (regions are assigned from that banner), required lazily from two new `COMMISSAIRE_DISPATCH` entries (`"governor pin"`, `"governor status"`) with matching entries in the flag table beside `"governor start"`. It requires `commissaire-trust` (governance, allowed from factory), `commissaire-governor-client` (which now also requires `peer-cred` for `governorRequestWithPeer`; update that module's region banner, which lists its reach as budget, shared-infra and producer-auth) and `producer-auth`, and spawns `git`, `gh` and `id` itself through `child_process.spawnSync`, as `commissaire-trust.ts` does. It never requires `merge-gate`, `config` or `budget`.

**Anti-pattern:** calling `runGh` from `merge-gate.js` to pick up the runner's token. Why: it imports faff's config reader into Commissaire, and `pin` and `status` are human commands that should run as the human.

**Anti-pattern:** treating an empty rules array as "unknown". Why: the endpoint returns `[]` for an unprotected branch, so empty means not protected (the same reading as `faff branch-protection-check`).

**Anti-pattern:** checking the invoker's groups. Why: the human who installs and pins is often an administrator; the question is whether the runner can reach the governor's key, so only the runner user's groups decide it.

### Edge cases

- The invoker cannot connect, or connects and is not admitted: `pin` refuses `governor-unreachable` (connect refused by file permissions) or `governor-refused` with detail `caller-not-allowed`; `status` reports `socket: unreachable` or `socket: refused:caller-not-allowed`. A correctly installed governor admits only the admin user FAFF-1216 recorded; any other human gets `caller-not-allowed`. A login session that began before install is not yet in `commissaire-clients` and gets `governor-unreachable` (EACCES) until the user logs in again, as FAFF-1216's next steps say.
- A governor built before this ticket answers `identify` with `unknown-op`: `pin` refuses `governor-refused` with detail `unknown-op`; `status` reports `socket: refused:unknown-op`.
- The trust file is absent on the base branch: `pin` creates it with `schema = 1`; `status` reports `pinned_on_base: no`.
- A PR for the same fingerprint is already open: `git push` or `gh pr create` fails on the existing branch name; `pin` refuses `gh-failed` with the detail and leaves the existing PR alone.
- A governor installed before FAFF-1216 lands (no `runner_checks`): `pin` refuses `install-record-missing`; `status` reports `install_result: missing`.
- `require_pinned_governor = true` with this fingerprint unlisted: unaffected; strict mode is FAFF-1219's concern at verify time.

### Failure modes

- **The failure:** a runner stands up its own governor, or a relay in front of the real one, on the socket path the human passes to `pin`. **How you'd know:** without root the process at the socket runs as the runner's user, so the kernel peer read reports that uid and step 6 refuses `governor-same-user`. A runner in a root-equivalent group is refused at step 5. A runner with sudo defeats every local check, which ADR 0135 states as the sudo caveat; the runner checks record's sudo check and the human's approval are the remaining controls.
- **The failure:** the human runs `pin` from the runner's checkout or a runner-editable `commissaire`. **How you'd know:** `pin` refuses `repo-runner-writable` or `code-runner-writable`, naming the path. **What it means:** run the installed copy from the human's own clone.
- **The failure:** the trusted Python helper is missing (`/usr/bin/python3`), so the peer read fails. **How you'd know:** `pin` refuses `governor-unreachable` with detail `peer-credentials-unreadable`, and the governor itself would already refuse every caller for the same reason (FAFF-1211).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governor whose runner_checks has docker_group true and independent false
When the human runs commissaire governor pin --socket <path> --runner-user runner
Then pin exits 1 with reason install-check-failed and detail naming docker_group
And no branch or PR is created
```

```
Given a governor running under the runner user's own OS account
When the human runs commissaire governor pin --socket <path> --runner-user runner
Then pin exits 1 with reason governor-same-user, decided from the kernel-reported uid and not from the identify reply
```

```
Given a relay process owned by the runner user, listening on the socket path and forwarding to a real separate-user governor
When the human runs commissaire governor pin --socket <relay path> --runner-user runner
Then pin exits 1 with reason governor-same-user
```

```
Given a runner user whose groups include docker, and a human invoker who is in sudo
When the human runs commissaire governor pin --socket <path> --runner-user runner
Then pin exits 1 with reason runner-root-equivalent and detail docker, and the invoker's own groups are not named
```

```
Given the runner user runs commissaire governor pin --socket <path> --runner-user runner
Then pin exits 1 with reason invoked-as-runner before any socket call
```

```
Given the human runs pin from a checkout whose .git directory is owned by the runner user
Then pin exits 1 with reason repo-runner-writable and no git command runs
```

```
Given a configured socket path with nothing listening
When the human runs commissaire governor status --socket <path> --runner-user runner
Then custody is "governor", socket is "unreachable", host_checks and install_result are "unknown", and ready_to_count is false
```

```
Given a governor that answers identify with a reply missing pk_fingerprint
When the human runs commissaire governor status --socket <path> --runner-user runner
Then socket is "invalid-reply", pk_fingerprint is null and ready_to_count is false
```

```
Given a base trust file with governor_key_fingerprints = ["<fp1>"]  # Fly governor on one line
When pin succeeds for a second governor
Then the array is multi-line with <fp1> then the new fingerprint, "# Fly governor" sits on its own line directly above the array, and the file validates
```

```
Given a governor on a separate system user whose identify reply names a key_file in a directory owned by root
When the human runs commissaire governor pin --socket <path> --runner-user runner
Then pin exits 1 with reason key-dir-untrusted
```

```
Given a governor process running as uid 0
When the human runs commissaire governor pin --socket <path> --runner-user runner
Then pin exits 1 with reason governor-is-root
```

```
Given a base branch with a trust file whose multi-line fingerprint array pins one key with a comment on its line, and comment lines above and below the array
When pin succeeds for a second governor
Then the PR's trust file lists both fingerprints, every pre-existing line is byte-identical, and parseTrustToml + validateSchema1 accept it
And the PR body contains "A human must approve this PR"
```

```
Given the identified fingerprint is already listed on the base branch
When the human runs pin
Then pinned is "already-pinned", pin exits 0, and no branch is created
```

```
Given every check passes
When the human runs pin --dry-run
Then pinned is "dry-run", detail holds the new trust-file text, and no branch, commit or PR is created
```

```
Given the push succeeds and gh pr create fails
When pin handles the failure
Then the remote branch is deleted, or named in detail if the delete fails, and pin exits 1 with gh-failed
```

```
Given gh is not on PATH
When the human runs commissaire governor status --socket <path> --runner-user runner --runner-login bot
Then remote_base, branch_protection and runner_identity are "unknown", pinned_on_base is "unknown", ready_to_count is false, and status exits 0
```

```
Given a governor on a separate system user whose key directory is group-writable, a passing runner checks record, and every counting condition met
When the human runs commissaire governor status --socket <path> --runner-user runner --runner-login runner-bot
Then host_checks is "failed:key-dir-untrusted" and ready_to_count is false
```

```
Given the base branch's trust file has an unknown key on line 4
When the human runs commissaire governor status
Then stdout is {"error":"trust-file-invalid","detail":"trust-file-invalid: line 4: …"} and status exits 2
```

```
Given origin points at someone/fork and the human runs pin --repo shftwst/faff
When pin resolves the repository
Then it refuses repo-mismatch naming both repositories, before any branch, push or PR
```

```
Given a runner checks record whose checked_at is 400 days old and every other check passes
When pin opens the PR
Then it exits 0 with opened-pr, and the PR body's "Reported by the governor" section opens with checked_at and "400 days"
```

```
Given pin runs on macOS
Then it exits 1 with reason platform-unsupported naming FAFF-1251, before any socket call
```

- The new module's require graph never reaches a module in the standalone guard's denylist, nor `merge-gate`, `config` or `budget`.

## 6. Design decision rationale

- **Who runs `pin` and `status`?** The runner's account or the human's. **Chosen** (operator, 2026-10-12): the human's, with `--runner-user`; `invoked-as-runner` and `invoked-as-root` enforce it.
- **Which code and checkout may `pin` run from?** Any, or only ones the runner cannot write. **Chosen:** refuse a runner-writable copy or `.git`; hooks disabled on every `git` call.
- **Does `pin` support a remote governor over TCP?** **Chosen** (operator, 2026-10-12): Unix socket only; FAFF-1181 extends it. `identify` is answered on the Unix listener only.
- **How do `pin` and `status` read the key?** A read-only `identify` operation; `admit` writes state and the key directory is unreadable by design. **Chosen:** `identify`.
- **How does the human's account reach the socket?** A read-only admin caller, or a published identity file. **Chosen** (operator, 2026-10-12): FAFF-1216's admin caller, limited to `ADMIN_OPS`, through the `commissaire-clients` group; keeps the kernel peer check.
- **How does `pin` judge a governor that describes itself?** Trust the reply, or check host facts first. **Chosen:** kernel-reported governor uid, the runner's groups and file-system checks on the key directory first; the runner checks record only for the sudo fact.
- **Whose groups are checked?** **Chosen:** the runner user's, including its primary group.
- **Where is the install record?** **Chosen:** FAFF-1216's `runner_checks`, returned by `identify` from the loaded config. `pin` runs before any run exists, so it cannot read it from an admission record.
- **What happens on macOS?** **Chosen:** `pin` refuses `platform-unsupported` until FAFF-1251; `status` reports `host_checks: unknown`.
- **Where does `pin` get the trust file's text?** **Chosen:** `readTrustFileText` in `commissaire-trust.ts`, which `readTrustFile` now calls.
- **How is the trust file edited?** **Chosen:** edit in place and re-parse.
- **How are the branch and PR made?** **Chosen:** temporary worktree from `origin/<base>`, signed-off commit, hooks disabled.
- **How old a runner checks record does `pin` accept?** **Chosen** (operator, 2026-10-13): any age, with `checked_at` and its age in the PR body.
- **Does `pin` trust `origin` to name the repository?** **Chosen** (operator, 2026-10-13): no; `--repo` is required and `repo-mismatch` refuses a different `origin`.
- **Does `status` read FAFF-1212's `evidence`?** **Chosen:** no, there is no grant at pre-flight; its branch-protection check uses the same `pull_request` rule.
- **Where do the logins come from?** **Chosen:** `--runner-login` for the runner; ambient `gh api user` for the human.
- **Where does the code live?** **Chosen:** new factory module `governor-admin.ts` with its own `git`, `gh` and `id` calls.

## 7. Open questions and assumptions

### Open questions

None. The two questions raised by spec-review round 8 were settled by the operator on 2026-10-13 (section 4): any record age, shown in the PR body; `--repo` required with `repo-mismatch`.

The earlier question, how the human reaches the governor's socket, was settled by the operator on 2026-10-12 (FAFF-1216's read-only admin caller).

### Assumptions

**Assumes:** FAFF-1216 lands first (FAFF-1217 is now blocked by it) and adds `runner_checks` to `parseGovernorConfig` and the loaded config, with exactly the shape in FAFF-1216's "Runner checks record": `schema` 1, `runner_user`, `runner_uid`, `platform` (`"linux"` here), `socket_group`, `docker_group`, `sudo_rules`, `sudo_absent`, `admin_group` (`null` on Linux), `independent` (= NOT `sudo_rules` AND NOT `docker_group` AND `admin_group` != true), `checked_at`, `install_version` and `source_tag`; a malformed record makes `governor start` exit 2. FAFF-1216 also adds `admin_uids` to `governor-config.json`, the admin role in `guardUnixConnection`, the `ADMIN_OPS` constant containing `identify`, and the `commissaire-clients` socket group. Validation before build: `grep -n "runner_checks\|admin_uids\|ADMIN_OPS" plugin/skills/faff/bin/lib/governor.ts`. Both specs agree that `pin` reads `runner_checks` from the `identify` reply, because no run exists when the human pins; admission payloads carry a copy.

**Assumes:** FAFF-1177 (Done) and FAFF-1211 (Done) are on `main`: `dispatchOp`, `loadGovernorConfig` and `guardUnixConnection` exist in `governor.ts`. Validation: `grep -n "function dispatchOp\|function loadGovernorConfig\|function guardUnixConnection" plugin/skills/faff/bin/lib/governor.ts`.

**Assumes:** FAFF-1210 (Done) exports `readTrustFile` with `transport: "remote"` and `repoSlug`. Validation: `grep -n "readTrustFile" plugin/skills/faff/bin/lib/commissaire-trust.ts`.

## Already shipped against this surface

- FAFF-1177 (Done): the governor process with `start` and `rotate`; this ticket adds an `identify` operation to it.
- FAFF-1210 (Done): the trust-file parser and base-branch reader, which `pin` and `status` call.
- FAFF-1211 (Done): the peer-credential guard; `identify` goes through it.
- FAFF-1213 (Done): the runner's separate GitHub identity in faff config; `status` takes the login as a flag instead of reading that config.
- FAFF-1179 (Done): `parseEndpoint` and `governorRequest`, reused for the socket call.

None of these delivers `pin` or `status`; the premise holds.

## 8. Done

### From why
- [ ] `commissaire governor pin` and `commissaire governor status` exist in the standalone binary, and `faff commissaire governor pin|status` gives byte-identical output (parity test in `test/commissaire-standalone.test.mjs`).
- [ ] Neither command calls `sudo`; `pin` never merges a PR.

### From what
- [ ] The governor answers `{ "op": "identify" }` on its Unix listener with `pk`, `pk_fingerprint`, absolute `key_file` and `runner_checks` (or `null`), through the peer-credential guard, and logs the request; on TCP it answers `op-unix-only`.
- [ ] `identify` is answered for both a runner caller and a FAFF-1216 admin caller; a test with a stub peer-credential reader shows an admin uid gets an `identify` reply and is still refused `op-not-permitted-for-admin` for `admit`.
- [ ] `pin` and `status` print one JSON object matching `PinResult` / `StatusResult`; exit codes match section 3; `pin` without `--runner-user` or `--repo` is a usage error.
- [ ] A malformed `--repo` (no slash, `..`, a leading `-`, spaces or other characters outside the pattern) is a usage error, exit 2, with no socket, `git` or `gh` call, on both commands.

### From how: `pin`
- [ ] Refuses `invoked-as-root` at uid 0 and `invoked-as-runner` when the invoker's uid is the runner user's, before any socket call.
- [ ] Refuses `runner-user-unknown` when `--runner-user` does not resolve.
- [ ] Refuses `code-runner-writable` and `repo-runner-writable` per section 3, including a runner-writable Node interpreter (`realpath(process.execPath)` or an ancestor), with a test using a stub `runnerCanWrite`; every `git` call carries `-c core.hooksPath=/dev/null`.
- [ ] Refuses `platform-unsupported` on macOS (naming FAFF-1251) and `remote-governor-unsupported` for a TCP endpoint.
- [ ] `governorRequestWithPeer` returns the kernel-reported server uid for a Unix endpoint; a failed peer read is `unreachable` with detail `peer-credentials-unreadable`. A test runs it unconditionally against a same-user governor and expects the invoker's own uid, and the container test runs it against a governor started as a second user and expects that user's uid, which differs from the caller's, so a client that reported its own credentials would fail.
- [ ] Refuses `runner-root-equivalent` when the runner user's groups, primary group included, meet `ROOT_EQUIVALENT_GROUPS`; the invoker's groups are never checked.
- [ ] Refuses `governor-is-root` at peer uid 0, `governor-same-user` when the peer uid equals the runner's or the invoker's, and `governor-not-system-user` outside the system range, using the peer uid and never a reply field.
- [ ] Refuses `key-dir-untrusted` when the key directory is a symlink, not a directory, not owned by the peer uid, not mode `0700`, or has an ancestor not owned by root or group/world-writable.
- [ ] Refuses `key-readable-by-invoker` when the read-only, non-blocking, no-follow open of `key_file` succeeds; refuses `key-read-check-inconclusive` on any outcome other than success or EACCES/EPERM.
- [ ] Refuses `install-record-missing` when `runner_checks` is null, and `install-check-failed` on a runner name, uid or platform mismatch, or `independent` false (detail names each failing field).
- [ ] Refuses `fingerprint-mismatch` when `pkFingerprint(pk)` differs from the reported fingerprint.
- [ ] Refuses `base-not-protected` when the rules array has no `pull_request` rule, and `base-protection-unknown` when the rules read fails.
- [ ] Refuses `repo-mismatch` when `origin` names a different repository from `--repo` (case ignored), naming both; reads, pushes and opens the PR against `--repo`, passing it to every `gh` call. `status` reports `remote_base` not-met `repo-mismatch` in the same case.
- [ ] Refuses `no-remote-base` when no `origin` remote exists, and `gh-failed` when the remote trust read fails.
- [ ] `readTrustFileText` is exported from `commissaire-trust.ts`; `readTrustFile` calls it and the existing `commissaire-trust` tests pass unchanged.
- [ ] Refuses `base-moved` when the worktree's trust file differs from the bytes read in step 9.
- [ ] Returns `already-pinned` with no branch when the fingerprint is listed.
- [ ] Creates the trust file with `schema = 1` when absent; appends the array when the file has no `governor_key_fingerprints`; otherwise inserts in place per `insert_fingerprint`, comments outside the array untouched; the result re-parses and validates.
- [ ] The committed comment line carries only the sanitised local host name, the peer uid and the UTC date; no reply field other than the fingerprint reaches the file.
- [ ] Commits with `--signoff` in a temporary worktree from `origin/<base>`, pushes `commissaire/pin-<12 hex>`, opens the PR with the stated title and a body containing the fingerprint and the "Checked by" facts, the runner checks fields under "Reported by the governor" in a fenced block (printable ASCII, no backticks, at most 64 characters each), and "A human must approve this PR"; the body's first line names the target repository and base, and the "Reported by the governor" section opens with `checked_at` and its age in days (a record of any age is accepted; a future or unparseable `checked_at` shows `age unknown`); the worktree is removed on success and on failure.
- [ ] After a successful push and a failed `gh pr create`, deletes the remote branch, or names it in the detail when the delete fails.
- [ ] `--dry-run` prints the new file text and creates no branch, commit or PR.
- [ ] `governorPin` and `governorStatus` take an optional `deps` record as listed in section 4; the CLI passes none; every refusal above has a unit test driven through stub `deps`.

### From how: `status`
- [ ] Reports custody, socket state, fingerprint, `runner_user`, `pinned_on_base`, `trust_source`, `runner_checks` and `install_result`.
- [ ] `host_checks` runs exactly status step 2's list: pin's invoker checks (`invoked-as-root`, `invoked-as-runner`), runner lookup, runner-group, governor-uid and key-directory checks, without the key-file open; `status` run as root or as the runner gives `failed:invoked-as-root` / `failed:invoked-as-runner`. The two runner-writable checks appear only as caveats. It is `unknown` without `--runner-user`, on macOS, and for a TCP endpoint.
- [ ] Reports `remote_base`, `branch_protection` and `runner_identity` each as met / not-met / unknown with the reasons in section 4; `unknown` never yields `ready_to_count: true`.
- [ ] `branch_protection` is met only when the rules array contains a `pull_request` rule; `[]` is not-met. A test runs the same rules fixtures through `status`'s check and FAFF-1212's `hasPullRequestRule` and expects the same answer.
- [ ] `runner_identity` is not-met when the runner equals the ambient login or is in `pin_change_approvers`; logins compare with `[bot]` stripped and case ignored; missing remote approvers give `unknown "approvers-unreadable"`.
- [ ] `ready_to_count` follows status step 9 exactly and is never true unless `host_checks` and `install_result` are `passed`; a TCP governor never yields `true`.
- [ ] `pinned_on_base` is `yes` only for the identified governor's own fingerprint.
- [ ] `caveats` always contains the bypass-actor, runner-login and key-file-open lines, plus the macOS and runner-writable lines when they apply.
- [ ] `custody` is `governor` whenever an endpoint is configured, including when the socket is refused, unreachable or answers with an invalid reply; `socket` names which.
- [ ] Exits 0 with unmet conditions; on an invalid trust file prints the `trust-file-invalid` error object and exits 2; a usage error prints only to stderr and exits 2.

### From how: placement
- [ ] `governor-admin.ts` carries the factory region banner; `faff regions check` passes; its committed `.js` emit and `build-manifest.json` are regenerated.
- [ ] The standalone import-independence guard passes and the module does not require `merge-gate`, `config` or `budget`.
- [ ] This ticket's own Linux-container test runs the integration smoke test below with three `useradd` users and a hand-built governor setup, without running `governor install`.

### Integration smoke test

```
1. Start a governor on a temp 0700 key dir owned by a second test user, with governor-config.json holding
   allow_uids = [runner uid], admin_uids = [human uid] and a passing runner_checks record for the runner user,
   with the socket in a directory whose group holds the runner and the human (FAFF-1216's commissaire-clients).
2. In a temp repo owned by the human, with a bare "origin" remote and a stub gh on PATH
   (repo view, api contents, api rules, api user, pr create):
   run commissaire governor pin --socket <sock> --runner-user <runner> --repo <OWNER/NAME of the stub> as the human.
3. Expect exit 0, pinned "opened-pr", a pushed branch commissaire/pin-<12 hex> whose trust file validates and lists the fingerprint,
   and a recorded gh pr create call whose body contains "A human must approve this PR".
4. Run commissaire governor status --socket <sock> --runner-user <runner> --runner-login runner-bot with the stub returning
   a pull_request rule and api user "human": expect custody governor, transport unix, governor_uid = the second test user's uid,
   host_checks "passed", install_result "passed", all three conditions met, pinned_on_base "no" (PR unmerged), ready_to_count false.
```

This ticket carries its own Linux-container test (`node:20` with `useradd` and `runuser`, the FAFF-1109 precedent), so its end-to-end verification does not depend on how FAFF-1216 shapes its job. The test creates the governor user, the runner user and the human user with `useradd`, builds the key directory, `governor-config.json` and the socket directory by hand to FAFF-1216's documented modes and owners, and starts the governor with `runuser`; it never runs `governor install`. Outside the container, the peer-uid, runner-lookup and key-directory checks are exercised through injected `deps`, the same pattern the FAFF-1211 guard tests use; the seams are not reachable from the CLI.

confidence: high
build-tier: complex
spec-review: human-override (operator, 2026-10-13)

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```