# ADR 0137 — Remote governor keys are pinned from an identify reply read inside the governor machine

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-14
- **Issue:** FAFF-1181
## Context

ADR 0135 decision 6 pins a governor's key by a PR that adds its fingerprint to the trust file on the base branch, and `commissaire governor pin` writes that PR. Today `pin` refuses a TCP endpoint, and `identify` answers only on the local Unix socket. A Fly governor runs on another machine, so `pin` needs a way to learn its key (FAFF-1181).

The fingerprint in the PR is what a human approver trusts. Anything the runner can write between the governor and that PR is a way to swap in the runner's own key. A saved `identify` reply in the checkout or the operator's home directory is such a file, and a 64-hex fingerprint gives the approver no way to tell the swap from the real one.

## Decision

`commissaire governor pin --fly-app <app>` runs the operator's own `fly ssh console -a <app> -C "/opt/commissaire/current/bin/commissaire governor identify --json"`. The arguments go to `fly` as an array, never through a shell, and the app name must match `^[a-z0-9-]+$`. `pin` reads the reply straight from that subprocess's stdout. No file sits in between.

`pin` then:

- checks that `pk_fingerprint` equals `pkFingerprint(pk)`;
- skips the host-fact checks that describe a local governor (peer uid, key directory, runner groups, install checks);
- keeps the repository, base-branch and branch-protection checks; and
- opens the usual PR, with a fixed operator checklist of Fly facts it cannot observe and a command the reviewer can run to read the same fingerprint independently.

`identify` stays Unix-socket only. A new `governor identify --json` verb is a thin local client for it. Without `--fly-app`, `pin` behaves as today.

## Consequences

- The approver's cross-check is independent of `pin`: the reviewer runs the printed command and compares fingerprints.
- The checklist moves the remote equivalents of the local host checks to the human. The main one is that the runner app holds no Fly token that can SSH into the governor app.
- `pin` depends on the operator's `fly` binary and Fly SSH reaching an app with no public IP. The runbook has a check to run once after deploy.
- The `fly` binary goes through the same custody check as `git` and `gh`, and is refused when the runner can write it.
- Reading a saved identify file is rejected, and a future "pin from file" option would reopen this decision.
