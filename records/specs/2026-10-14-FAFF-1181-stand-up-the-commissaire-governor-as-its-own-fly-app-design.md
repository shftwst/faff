# FAFF-1181: Stand up the Commissaire governor as its own Fly app for unattended L3 runs

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1181.

Revised on 2026-10-14 with the operator's decisions (resolution comment of the same date): the Fly governor is a Tier 3 option that leaves every lower tier unchanged; always on; `--listen` without an allow list is refused only on a non-loopback address; `pin --fly-app`; the shared GitHub App key is provisioned on the governor's volume. One further review round on 2026-10-14 (architectural, infosec, QA) raised three minor, factual objections, all fixed: bounded DNS re-resolves and refusal lines without `--socket-group-access`, the runner app's network placement as an operator task with checks, and a fixed operator checklist in the `pin --fly-app` PR body. Earlier history: five adversarial review rounds on 2026-10-13 did not converge (objections per round: 6, 3, 6, 8, 5) and the ticket was parked on three decisions, now settled. Aligned on 2026-10-14 with the final FAFF-1220 and FAFF-1218 specs, with no design change: the App key file is `github-app.pem`, the `github_app` block carries the `OWNER/NAME@branch` `repos` bindings both tickets read, the operator proves the key with `commissaire governor status` after deploy (Fly has no `governor install` to mint a test token), and the governor needs outbound HTTPS to `api.github.com` when the App is configured. The pre-build Fly network gate was confirmed by the operator on 2026-10-14 on a stated basis (section 3, "Fly network basis"): isolation between custom private networks is documented, and same-network source-address spoofing is moot because the network holds only the governor and the runner.

This spec is for the build agent and the operator (the maintainer) who will provision Fly. It defines the committed deployment config for a Fly-hosted governor, the governor and `pin` changes a network placement needs, the runbook, and which steps are human tasks. It follows ADR 0135, decisions 2, 3 and 6.

## 1. Why

**The model.** Today the Fly L3 runner (`fly-ci-l3-runner`) signs its own grants in-process, so it holds the key that authorises its merges. Moving the signing key into a separate Fly app, whose volume the runner cannot reach, is what makes the runner's governed merges count as independent (ADR 0135 decision 7: "separate machine: yes"). The runner asks that app for grants over Fly's private network; the governor generates its key on its own volume and never exports it.

**Problem.** Everything the governor needs is merged (FAFF-1177 process, FAFF-1179 client with a `host:port` endpoint, FAFF-1178/1212/1219 verification and strict mode, FAFF-1216/1217 local install and pin), but only for a governor on the same host. Three gaps stop a Fly placement:

- The governor's TCP listener (`governor start --listen host:port`) has no caller check at all (`governor.ts`: "TCP has no SO_PEERCRED — its caller auth is FAFF-1181").
- `commissaire governor pin` refuses a TCP governor with `remote-governor-unsupported`, and `identify` is refused on TCP (`op-unix-only`), so there is no supported way to pin a remote governor's key.
- There is no committed Fly config or runbook.

**Design principles.**

**Progressive governance.** The Fly governor is one more opt-in tier. A repository that never deploys it, and every runner that never points at it, behaves exactly as before this ticket. Nothing below Tier 3 may come to require Fly, a GitHub App, a user-provided key or a network allow list.

**The key never leaves the governor app.** It is generated on first start on a volume attached only to the governor app, never set from outside as a secret (ADR 0135, human 236415f8).

**No new runner credential.** ADR 0135 decision 3 rejects a client certificate or token for the runner: it would authenticate the runner without constraining what it asks for. Caller restriction on Fly is network placement and app identity.

**The runner's own Fly access must not reach the governor app.** If the runner can deploy to, SSH into, or attach volumes of the governor app, the separation is fiction.

**Reaching the TCP listener is equivalent to being the runner.** `admit` takes no credential and derives the producer key deterministically from the run id (`handleAdmit` in `governor.ts`), and the governor advances a run's head from any verified incoming ledger. So any caller that can reach the listener can obtain any run's `K_producer` and move any run's head, which forges producer records or parks the real runner with `ledger-not-extending-head`. The only acceptable callers are the runner app's machines; everything below exists to make that true.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governor.ts` | TypeScript | `governor start` (`--key-dir`, `--socket`, `--listen`), `parseListen`, the unauthenticated TCP listener, `identify`, `admin_uids`, the key and log files |
| `plugin/skills/faff/bin/lib/commissaire-governor-client.ts` | TypeScript | `parseEndpoint` accepts `host:port`; `COMMISSAIRE_GOVERNOR` and `commissaire.governor` select the governor |
| `plugin/skills/faff/bin/lib/governor-admin.ts` | TypeScript | `pin` and `status`; `remote-governor-unsupported` refusal and the TCP caveat in `status` |
| `plugin/skills/faff/bin/lib/governor-install.ts` | TypeScript | The local install pattern (install copy from a release tag, owner-only key dir) this mirrors |
| `plugin/skills/faff/bin/lib/commissaire-verify.ts`, `commissaire-trust.ts`, `merge-gate.js` | TypeScript, JavaScript | Grant verification and the trust-file read; unchanged by this ticket |
| `fly-ci-l3-runner` (`drain.sh`, `entrypoint.sh`) | Shell, out of repo | The live L3 runner. It runs `claude -p` inside a `docker --rm` cage on a Fly machine; it is not in this repository |
| `operations/ci/` | YAML, shell | Existing committed reference config for the runner side |
| `docs/guide/unattended.md` | Markdown | The operator runbook this ticket extends |
| `records/adr/0135-…-pinned-keys.md` | ADR | Decisions 2, 3, 6 and 7 |

**Scope.** The Fly placement of the governor and the code it needs; the counted L3 proof itself is FAFF-1182.

## Architecture proposal

```faff-contract:architecture-proposal
{ "chosen_architecture": "One single-machine, always-on Fly app (`commissaire-governor`) built from a release-tag checkout, running `commissaire governor start` as a non-root `commissaire` user with its key directory on a Fly volume attached only to that app, listening on the machine's private 6PN address with no public IP or Fly proxy service, and reached by the existing fly-ci-l3-runner over Fly's private network at `<app>.internal`.",
  "rationale": "The ticket requires a separate Fly app whose secrets and volume the runner cannot reach, a key generated inside the machine and kept on a volume, and a runner that reaches it over the network. The governor is already a plain Node process (ADR 0135, human c76c0d54) with a `--listen` TCP listener and a client that accepts `host:port`, so the smallest production-grade placement is that same process in its own Fly app on the private network. No public exposure keeps the TCP listener off the internet; the volume keeps the key inside the app; always-on keeps each caller's real source address for the app-identity check.",
  "adr_candidates": [
    { "title": "The Fly governor is reached only over the private network", "decision": "No public IP and no `[[services]]` section; the governor listens on its 6PN address and the runner connects to `<app>.internal`", "rationale": "The TCP listener has no transport security or peer credentials, so it must never be reachable from outside Fly's private network" },
    { "title": "Remote governor keys are pinned from an identify reply read inside the governor machine", "decision": "`pin --fly-app` runs the operator's `fly ssh console` to call `identify` over the governor's local Unix socket and reads the reply from that process directly", "rationale": "`identify` stays Unix-only and no runner-writable file sits between the governor and the pin PR" },
    { "title": "Amend ADR 0135 decision 2: the Fly governor is always on", "decision": "One always-on machine instead of starting on request and stopping when idle", "rationale": "Start on request routes connections through the Fly proxy, which hides the caller's real source address that the app-identity check needs" } ],
  "assumptions": [ "no infra profile (faff profile show exit 3); proposal is against the ticket and the code alone", "Fly app-scoped deploy tokens exist and the runner app's machines hold no token that can reach the governor app", "a container started inside the runner's Fly machine can resolve `.internal` names and reach 6PN IPv6 addresses" ],
  "recommendation": "build" }
```

### ADR promotion intent

- The Fly governor is reached only over the private network (section 3, Network placement).
- Remote governor keys are pinned from an identify reply read inside the governor machine (section 3, Pinning a remote governor).
- Amendment to ADR 0135 decision 2: the Fly governor is always on (section 3, Availability).

## 2. Out of scope

- **The counted proof run.** FAFF-1182 shows on a real run that the runner cannot grant itself a merge and updates the custody claim. Extension point: this ticket ends with one governed L3 merge whose grant verifies against the pinned key; FAFF-1182 consumes that.
- **Changing the live `fly-ci-l3-runner`.** Its `drain.sh` and `entrypoint.sh` are outside this repository (the FAFF-782 boundary). Extension point: the runbook names the one setting the operator adds there (`COMMISSAIRE_GOVERNOR`), and `operations/ci/` reference wrappers show it.
- **What the governor does with the GitHub App.** FAFF-1220 (the governor-posted status check) and FAFF-1218 (approval for trust-file changes) define the App's use and its key-file layout. This ticket only provisions that one key on the Fly volume (section 3, The GitHub App key on Fly).
- **`status` querying a TCP governor.** `status` keeps reporting `socket: "not-configured"` with its TCP caveat. Extension point: `statusCore` in `governor-admin.ts`, once a remote identify path exists.
- **macOS and claude-box placements.** FAFF-1251 and FAFF-1215.
- **A second governor region or high availability.** One machine; an unreachable governor already fails closed (FAFF-1179).
- **Persisting per-run governor state across restarts.** The governor keeps admissions and each run's last head in memory (`governor.ts`), so a restart (a redeploy, or Fly replacing the machine) loses them: a run already in flight is then refused `producer-not-admitted` on its next request and parks through the client's existing `governor-admission-lost` path (FAFF-1179), while every later run admits normally. That is fail-closed and the same as a local governor restart today. Extension point: persist the admissions and last-head maps to the key directory in `governor.ts`, a separate ticket if parked runs after redeploys become a nuisance. The runbook tells the operator to redeploy between firings.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Governor app | The new Fly app running `commissaire governor start`, default name `commissaire-governor` |
| Runner app | The existing `fly-ci-l3-runner` Fly app |
| 6PN | Fly's private IPv6 network between apps in one organisation (or one custom private network) |
| `<app>.internal` | Fly's private DNS name resolving to an app's machines' 6PN addresses |
| Custom private network | A 6PN network created with `fly apps create --network <name>`; apps on different networks cannot reach each other |
| Loopback listen address | A `--listen` host of `localhost`, any address in `127.0.0.0/8`, or `::1` |

### Progressive tiers

Commissaire governance is layered. Each tier is opt-in, and this ticket adds only Tier 3's Fly placement.

| Tier | What it needs | What this ticket changes |
|---|---|---|
| 0, ungoverned | Nothing | Nothing |
| 1, in-process | `commissaire contract admit`; the key pair is generated automatically. No trust file, governor, GitHub App, Fly app or user-provided key | Nothing |
| 2, local governor | `governor install` and `pin` (FAFF-1216/1217), serving on a Unix socket or a loopback TCP address | Nothing: a loopback `--listen` without `--listen-allow-dns` starts and behaves exactly as today |
| 3, Fly governor | The governor app, its volume, the private network, `--listen-allow-dns`, `pin --fly-app`; optionally the shared GitHub App key | Everything in this spec |

**Chosen:** with no Fly governor configured, Tiers 0 to 2 behave byte for byte as they do on `main` before this ticket: the same `merge-gate`, `pr-create` and branch-delete results and arguments, the same `governor start` behaviour on a Unix socket or a loopback TCP address (no new flag required, no new stderr or log line), and the same `pin` and `identify` behaviour on a Unix socket. Tests pin each (section 8). Every new behaviour in this spec is reached only through `--listen-allow-dns`, a non-loopback `--listen`, `pin --fly-app` or the new `identify` CLI verb.

**Chosen** (operator, 2026-10-14): a failed trust-file read keeps failing closed at every tier that reads it. A trust file that is absent on the base branch is not a failure (no pins, strict mode off), but a read that errors, for example a `gh` failure, still refuses a governed grant with `trust-file-invalid`, because without the read nothing can show strict mode is off. This ticket changes no trust-file read.

### Committed files

```
operations/fly/governor/
  fly.toml                 # app config: one machine, one volume mount, NO [[services]], NO http_service
  Dockerfile               # node + python3 + the faff plugin tree from the build context; non-root user commissaire
  entrypoint.sh            # as root: create/repair the key dir on the volume, then exec governor start as commissaire
  governor-config.json     # admin_uids: [0] only (operator's fly ssh session); allow_uids: [] (no local runner)
  README.md                # pointer to the runbook section
docs/guide/unattended.md   # new section: "Run the governor as its own Fly app"
```

**Chosen:** the deployment config lives under `operations/fly/governor/`, beside the existing runner reference config in `operations/ci/`, as the ticket's Done list requires.

### The image and process

```
RECORD GovernorImage:
  base: a Debian-slim Node 20+ image          # matches the adopter floor (AGENTS.md)
  packages: python3                           # peer-cred helper for the local Unix socket (identify for the operator)
  user: commissaire (fixed uid, e.g. 10001)   # the governor never runs as root
  code: /opt/commissaire/<source_commit>/     # the plugin tree copied from the build context, root-owned, read-only
  link: /opt/commissaire/current/bin/commissaire -> the installed commissaire binary (root-owned)
  label org.opencontainers.image.revision = <source_commit>

RECORD GovernorMachine:
  volume: commissaire_data mounted at /data   # attached only to the governor app
  key_dir: /data/commissaire                  # owned by commissaire, mode 0700
  command: governor start --key-dir /data/commissaire --listen $GOVERNOR_LISTEN --listen-allow-dns $GOVERNOR_ALLOW_DNS
  env: GOVERNOR_LISTEN = fly-local-6pn:7650 (default; parseListen splits on the last colon, no brackets)
       GOVERNOR_ALLOW_DNS = <runner-app>.internal (set in fly.toml [env]; required)
  availability: always on, one machine (auto_stop off)
  public_ips: none
  services: none
```

**Chosen:** the image is built from a clean checkout of a release tag in the operator's own account (the runbook says how), mirroring FAFF-1216's "never run from a working tree" rule. Fly's remote builder receives that checkout as build context; the image records the commit.

**Chosen:** the image's `governor-config.json` is the only source of the caller allow lists and of any GitHub App settings; the entrypoint copies it onto the volume on every start, replacing any previous copy. Changing who may call the governor, or enabling the App, is therefore a redeploy from a reviewed release tag, never an edit on the volume, which only root inside the machine (the operator's `fly ssh` session) could make and which would leave no record. The runbook says so.

**Chosen:** the entrypoint runs as root only to create `/data/commissaire` (owner `commissaire`, mode 0700) on a fresh volume, refuses to start if the directory or any entry in it is owned by anyone else, then drops to `commissaire` and execs `governor start`. The governor mints its key on first start (existing `openState`).

**Chosen:** the governor listens on the machine's 6PN address only (`fly-local-6pn`, which Fly maps in `/etc/hosts`), port 7650. `fly.toml` has no `[[services]]` or `http_service` section and the app has no public IP, so nothing outside the private network can reach the listener.

**Anti-pattern:** adding a `[[services]]` block or allocating a public IP "to make the runner reach it". Why: the TCP listener has no transport security or peer credentials; public exposure lets anyone request grants.

**Anti-pattern:** setting the signing key as a Fly secret. Why: ADR 0135 rejects a key set from outside; it must be generated inside the machine.

### Availability

**Chosen** (operator, 2026-10-14): one always-on machine (shared-cpu-1x, 256 MB, `auto_stop_machines` off). Connections arrive directly on 6PN with their real source address, which the app-identity check needs. Starting on request through a Flycast address would route connections through the Fly proxy, hiding the source address and requiring PROXY-protocol parsing at a security boundary. This departs from ADR 0135 decision 2's "starting on request and stopping when idle"; the build records an amendment note on ADR 0135 citing this ticket. An unreachable governor fails closed either way (FAFF-1179).

### Network placement and caller restriction

The runner reaches the governor at `COMMISSAIRE_GOVERNOR=<governor-app>.internal:7650` (FAFF-1179's `host:port` form).

**Chosen:** the governor restricts TCP callers by both network placement and app identity, as the ticket's Done list ("the governor accepts only the runner by network placement and app identity") and ADR 0135 decision 3 ("On Fly, network placement and app identity") already require:
- **Placement.** The runner app and the governor app share one custom private network that no other app joins.
- **App identity.** A new `governor start --listen-allow-dns <runner-app>.internal` flag (a DNS name, resolved for both AAAA and A records, or a literal IP address): on each TCP connection the governor resolves that name (cached for 30 seconds) and closes, before reading the request, any connection whose source address is not among the runner app's 6PN addresses, logging the refusal. A buildable change in `governor.ts`.

**Chosen** (operator, 2026-10-14): `governor start --listen <host:port>` on a **non-loopback** host without `--listen-allow-dns` exits 2 with a message naming both flags, unless `--listen-unrestricted` is also passed, in which case it starts with no caller check and logs one `tcp-unrestricted` line at start. On a **loopback** host (`localhost`, `127.0.0.0/8`, `::1`), `--listen` without `--listen-allow-dns` starts exactly as today: no caller check, no new stderr or log line, no new flag needed. Reaching a non-loopback listener is equivalent to being the runner, so an unchecked one is never the silent default; a loopback listener is reachable only from the same machine, which is Tier 2's existing boundary.

Placement alone is not enough: because reaching the listener hands out any run's producer key (see the design principles), it would fail silently the first time another app joined the network.

**Chosen:** (operator, 2026-10-14) Fly network basis; the pre-build gate is satisfied on this basis.
- **Isolation between networks is documented.** "Apps on separate 6PNs can never communicate unless explicitly configured to do so." ([Custom private networks](https://docs.fly.io/networking/custom-private-networks)). "The Fly.io platform won't forward packets between different 6PNs, unless you explicitly allow it" ([Private networking](https://docs.fly.io/networking/private-networking)). Fly enforces this with BPF access control ([Incoming! 6PN private networks](https://fly.io/blog/incoming-6pn-private-networks/)). An app's network is fixed at creation: "You can't add an existing app to a custom 6PN or change an app's 6PN."
- **Source-address validation within one network is not documented.** Fly's documentation does not say whether one machine can send packets carrying another machine's 6PN address on the same network.
- **That gap is moot here.** The custom network holds only the governor app and the runner app. The only addresses a runner machine could fake are other runner machines', which `--listen-allow-dns` already allows, so faking an address gains nothing. The allow-list check therefore rests on placement for everything outside the runner app, not on per-machine source validation.
- **Two operator conditions keep it moot,** both checked human tasks below: no other app is ever created on that network, and the runner app's machines hold no Fly token that could create one (or deploy to, SSH into, or manage the governor app). If either ever fails, the identity check stops being a control and this ticket is re-prepped.

Passive capture is not a separate threat here: 6PN traffic between Fly hosts travels inside Fly's WireGuard mesh, and an app cannot observe another machine's packets (see the assumptions).

### Pinning a remote governor

Today `pin` refuses a TCP endpoint (`remote-governor-unsupported`) and `identify` answers only on the Unix socket. The image's `governor-config.json` lists uid 0 in `admin_uids`, so an operator's `fly ssh console` session (root inside the governor machine only) can call `identify` over the machine's local Unix socket.

**Chosen** (operator, 2026-10-14): `pin --fly-app <app>`. `pin` runs the operator's own `fly` binary itself, as `fly ssh console -a <app> -C "/opt/commissaire/current/bin/commissaire governor identify --json"` (a fixed path the image provides as a symlink to the installed version; the app name must match `^[a-z0-9-]+$` or `pin` exits 2, and the arguments go to `fly` as an argument array, never through a shell), and reads the reply straight from that process's stdout; no file is written or read in between, so nothing the runner can write sits between the governor and the PR. The `fly` binary goes through the same custody check `pin` already applies to `git` and `gh` (refused `code-runner-writable` when the runner can write it or any directory above it). `pin` then:
- checks that `pk_fingerprint` equals `pkFingerprint(pk)`, the SHA-256 of the SPKI-DER public key that `verifyGrant` and the trust file use (`producer-auth.ts`), never a hash of other bytes;
- skips the host-fact checks that describe a local governor (peer uid, key directory, runner groups, `runner_checks`, and the "invoking user can read the key file" check, which has no meaning across machines); their remote equivalent is the operator-attested checklist below, chiefly that the runner app holds no Fly token that can SSH into the governor app;
- keeps the repository, base-branch and branch-protection checks, and opens the usual PR.

The PR body names the Fly app, the image's source commit (from the `identify` reply's install version, or the image label read in the same SSH session), and prints the exact `fly ssh console` command a reviewer can run to read the same fingerprint independently before approving. It also prints this fixed checklist, verbatim, as unticked boxes for the approving human to tick, because `pin` cannot observe these Fly facts itself:
  - The runbook records the Fly documentation on isolation between custom private networks and the operator's 2026-10-14 basis for the same-network question (only the governor and runner apps on the network).
  - `fly ips list -a <app>` shows no public address.
  - The governor app and the runner app share one custom private network that no other app is on.
  - The runner app's machines hold no Fly token that can deploy to, SSH into, or manage volumes of the governor app.
  - The governor was deployed from a clean checkout of a release tag.

This also adds a `commissaire governor identify --json` CLI verb: a thin client that sends `identify` over the local Unix socket and prints the reply as JSON. Without `--fly-app`, `pin` behaves exactly as today.

**Anti-pattern:** reading the identify reply from a file the operator saved. Why: a file in the checkout or under the operator's home can be replaced by the runner with a reply for its own key pair, and a 64-hex fingerprint in a PR gives the approver no way to tell the difference.

### The GitHub App key on Fly

FAFF-1220 and FAFF-1218 give the governor one GitHub App, shared between them. It is optional: with no App configured, the governor behaves as it does without this section.

**Assumes:** FAFF-1220's App layout (its spec, section 3, The Governor App): an optional `github_app` block in `governor-config.json` with `app_id`, `installation_id`, `private_key_file` (a bare file name inside the key directory, `github-app.pem` by convention) and `repos`, a non-empty list of `OWNER/NAME@branch` governed bindings that FAFF-1218 reads too; the key file must be a regular file, mode 0600, owned by the governor's account and not a symlink, or `governor start` exits 2; with no block, the App feature is off. Validate: read FAFF-1220's merged code before building this section; if its layout differs, follow FAFF-1220 and adjust only the provisioning steps below.

**Chosen:** on Fly the App private key is a file on the governor's volume, never a Fly secret:
- **Placement.** The operator copies the key to `/data/commissaire/github-app.pem` with `fly ssh sftp` (or `fly ssh console`) as root, then sets owner `commissaire` and mode 0600. The entrypoint's existing rule refuses to start if any entry in the key directory is owned by anyone else, and FAFF-1220's config check stops `governor start` on a symlink or a wrong mode, so a mis-placed key file stops the machine rather than being served.
- **Why not a Fly secret.** A Fly secret is set from outside, stored in Fly's secret store, and exposed as an environment variable to every process in the machine; a 0600 file on the volume is readable only by the governor's account and by root in the operator's own SSH session. Both are reachable only by whoever can manage the governor app, which the runner must never be able to do.
- **Order.** The key file goes onto the volume first; the `github_app` block (the App and installation ids, `private_key_file: "github-app.pem"`, and the `repos` bindings) is then added to the image's `governor-config.json` and deployed from a release tag. Until both are present, the governor runs without the App.
- **Proof.** Fly has no `governor install`, so nothing mints a test token at setup the way FAFF-1220's install does. After deploying the block, the operator runs `commissaire governor status --repo OWNER/NAME --base <branch>` in a `fly ssh console` session (root is the admin caller, uid 0) and confirms `github_app: configured` and `app_token: ok`, plus the ruleset fields FAFF-1220 reports; any `failed` or `unknown` is fixed before relying on the status check.
- **Rotation.** Generate a new key in the App's GitHub settings, copy it over the old file the same way, restart the machine (`fly machine restart`), confirm `app_token: ok` as above, then delete the old key in GitHub.
- **Removal.** Remove the `github_app` block (redeploy), then delete the file from the volume.

### Human tasks and buildable work

| Step | Who |
|---|---|
| Committed config under `operations/fly/governor/`, the entrypoint, the runbook section, the ADR 0135 amendment note | Agent (this ticket's build) |
| Code: the `--listen-allow-dns` source-address check, the non-loopback `--listen` rule and `--listen-unrestricted`, `pin --fly-app` and the `identify` CLI verb | Agent |
| Tests for the above, the lower-tier tests in section 8, and a local container test of the image | Agent |
| Before any build: confirm the Fly network basis. **Done** (operator, 2026-10-14): isolation between custom private networks is documented; same-network spoofing is moot because only the governor and runner apps are on the network (section 3, "Fly network basis"). The build copies the cited sources into the runbook | Operator (satisfied) |
| Keep the custom network to exactly two apps: never create any other app on it, and check this before every redeploy (the runbook gives the command); this condition keeps the same-network spoofing question moot | Operator |
| Create the custom private network's two members: the governor app (`fly apps create --network <name>`) and the runner app on the same network. An app's network is fixed when it is created, so if `fly-ci-l3-runner` is on the default organisation network it is recreated on the custom network. Then confirm both apps report the same network and that no other app is on it (the runbook gives the commands) | Operator |
| Create the governor app's volume and an app-scoped deploy token held by the operator; allocate no IP addresses | Operator |
| After deploy, confirm `fly ips list -a <governor-app>` shows no public address | Operator |
| Confirm the runner app's machines hold no Fly token that can reach the governor app or create an app on its network; this condition keeps the same-network spoofing question moot | Operator |
| `fly deploy` from a clean release-tag checkout | Operator |
| Run `pin --fly-app`, cross-check the fingerprint with the printed `fly ssh console` command, approve and merge the pin PR | Operator |
| Give the runner's cage a path to the governor (IPv6 on the cage network, or the relay in `drain.sh`) and set `COMMISSAIRE_GOVERNOR` in the out-of-repo `fly-ci-l3-runner` | Operator |
| Optional, when FAFF-1220 or FAFF-1218 is in use: copy the GitHub App key onto the volume as `github-app.pem`, deploy the `github_app` config, then confirm `app_token: ok` with `commissaire governor status` | Operator |
| Trigger one L3 firing and check the governed merge and the governor log | Operator, with the runbook's verification commands |

## 4. How

### First start on a fresh volume

```
PROCEDURE entrypoint():
  1. AS root: IF /data is not a mounted volume → exit 1 "no volume at /data"
  2. IF /data/commissaire is absent → create it, owner commissaire, mode 0700
  3. IF /data/commissaire is a symlink, not a directory, not owned by commissaire, or not mode 0700 → exit 1 naming it
  4. IF any entry under /data/commissaire is owned by anyone but commissaire → exit 1 naming it
  5. Copy /opt/commissaire/<commit>/operations/fly/governor/governor-config.json to /data/commissaire/governor-config.json
     owned by commissaire, mode 0600, replacing any previous copy
  6. listen := $GOVERNOR_LISTEN, default "fly-local-6pn:7650"; allow := $GOVERNOR_ALLOW_DNS, required
     IF allow is unset or empty → exit 1 "GOVERNOR_ALLOW_DNS must name the runner app (e.g. fly-ci-l3-runner.internal)"
     IF either value contains characters outside [A-Za-z0-9.:_-] → exit 1 naming it
  7. exec (as commissaire) node /opt/commissaire/<commit>/plugin/skills/faff/bin/commissaire governor start \
       --key-dir /data/commissaire --listen "$listen" --listen-allow-dns "$allow"
```

**Anti-pattern:** running the governor as root "because the volume is root-owned". Why: root inside the machine is the operator's `fly ssh` session; the governor process should hold only what it needs.

### Starting the TCP listener

```
PROCEDURE governor_start_listen(flags):
  1. IF --listen is absent → behave exactly as today (Unix socket only)
  2. {host, port} := parseListen(--listen)
  3. loopback := host == "localhost" OR host is an IPv4 address in 127.0.0.0/8 OR host is "::1"
  4. IF --listen-allow-dns given → start with the caller check below (any host)
  5. ELSE IF loopback → start exactly as today: no caller check, no new stderr or log line
  6. ELSE IF --listen-unrestricted given → start with no caller check, log one { op: "tcp-unrestricted", listen } line
  7. ELSE → exit 2 "governor start: --listen on a non-loopback address needs --listen-allow-dns <runner-app>.internal (or --listen-unrestricted)"
```

### Caller restriction

```
PROCEDURE on_tcp_connection(socket):
  1. src := socket.remoteAddress (normalise ::ffff: forms)
  2. allowed := cached addresses for the --listen-allow-dns value: its AAAA and A records, or the literal address itself
     (refresh if older than 30 s; a failed lookup keeps no cache)
  2a. IF src NOT IN allowed AND the cache was not refreshed by this connection → resolve again now, bypassing the cache
      (a runner machine started since the last lookup is then found)
  3. IF src NOT IN allowed → log { op: "tcp-refused", source: src } (rate-limited as the Unix refusals are) and destroy the socket
     before reading any request
  4. ELSE handle as today (no role, so identify stays refused with op-unix-only)
```

A DNS failure refuses every TCP caller (fail closed); the runner then fails closed too (FAFF-1179), and the run surfaces `governor-unreachable`.

**Chosen:** the TCP listener with `--listen-allow-dns` bounds its own work, independently of `--socket-group-access` (whose `makeConnectionBounds` the Fly governor does not enable, and whose token bucket counts helper spawns, not DNS lookups):
- **Forced re-resolves.** Step 2a runs at most once every 5 seconds across all connections; a connection that arrives while that limit is spent is checked against the existing cache only.
- **Refusal lines.** `tcp-refused` lines share a per-minute cap (60 lines), after which one `refusals-suppressed` line per minute records the count, the same shape the Unix refusal cap uses.

### Failure modes

- **The failure:** the runner's `docker --rm` cage cannot reach 6PN IPv6 or resolve `.internal` (Docker's default bridge has no IPv6). **How you'd know:** the first L3 firing stops at run start with `governance-admit-failed` and `governor_unreachable: true`. **What it means:** the operator must give the cage a path to 6PN; this is an out-of-repo runner change, so the ticket's last Done item cannot pass until it is made. The runbook documents two ways: enable IPv6 on the cage's Docker network, or run a small TCP relay in `drain.sh` on the runner machine (outside the cage, inside the runner app's own trust domain) that listens on the Docker bridge address and forwards to `<governor-app>.internal:7650`, with `COMMISSAIRE_GOVERNOR` pointing at the relay. Under the source-address check the relay's connections arrive from the runner machine's own 6PN address, so they are still accepted.
- **The failure:** Fly token scoping cannot keep the runner away from the governor app (for example the runner machines carry an org-scoped token). **How you'd know:** `fly tokens list` or the runner's environment shows a token whose scope includes the governor app. **What it means:** remove that token from the runner; if the runner genuinely needs org-wide Fly access, the governor needs a separate organisation, which also breaks the shared private network, and this design needs revisiting.
- **The failure:** `fly-local-6pn` is not resolvable in the image. **How you'd know:** `governor start` exits with a listen error at boot. **What it means:** bind to the address from `/etc/hosts` explicitly; documented in the runbook.
- **The failure:** the GitHub App key file on the volume has the wrong owner, mode or type. **How you'd know:** the machine stops at start, the entrypoint or `governor start` naming the file. **What it means:** `chown commissaire` and `chmod 0600` it (replacing any symlink with the file itself) from the operator's SSH session, then restart.
- **The failure:** the governor machine cannot reach `api.github.com` once the App is configured. **How you'd know:** `commissaire governor status` reports `app_token: failed`, and governed merges are refused `github-unreachable` (FAFF-1220). **What it means:** fail closed by design; the operator checks the machine's outbound connectivity, or removes the `github_app` block to return to running without the App.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the governor app deployed with a fresh volume
When the machine starts
Then /data/commissaire holds governor-key.json (mode 0600) owned by commissaire in a 0700 directory,
And the governor listens only on the machine's 6PN address, and the app has no public IP and no services
```

```
Given the runner app with COMMISSAIRE_GOVERNOR=<governor-app>.internal:7650
When an L3 firing admits a run and requests a merge grant
Then the admission record says custody "governor", the grant verifies with verifyGrant against the pinned fingerprint as "pinned",
And the governor's log on the volume shows the admit and authorize requests
```

```
Given a local governor started with --listen 127.0.0.1:7650 and no --listen-allow-dns
When it starts and a local client admits a run
Then it starts and serves exactly as before this ticket, with no new flag, stderr line or log line
```

```
Given governor start with --listen 0.0.0.0:7650 and neither --listen-allow-dns nor --listen-unrestricted
When it starts
Then it exits 2 naming both flags and serves nothing
```

- The governor's signing key never appears in a Fly secret, an image layer or a log line.

## 6. Design decision rationale

**Where does the config live?** **Chosen:** `operations/fly/governor/`, as the ticket specifies, beside `operations/ci/`.

**How is the image built?** **Chosen:** `fly deploy` from a clean release-tag checkout by the operator, so no CI credential can deploy the governor and the image records the commit.

**What user runs the governor?** **Chosen:** a fixed non-root `commissaire` uid; root only in the entrypoint's directory setup.

**How is the listener exposed?** **Chosen:** 6PN address only, no public IP, no services.

**How are TCP callers restricted?** **Chosen:** placement on a custom private network plus the `--listen-allow-dns` source-address check. Rejected: placement alone, which leaves any run's producer key available to any app later added to the network.

**Always on or start on request?** **Chosen** (operator): always on, because start on request hides the source address the identity check needs.

**What does `--listen` do without an allow list?** **Chosen** (operator): refuse on a non-loopback address unless `--listen-unrestricted`; unchanged on loopback, so Tier 2 keeps working.

**How is the remote key pinned?** **Chosen** (operator): `pin --fly-app`. Rejected: a hand-written trust-file PR, which skips `pin`'s checks; and reading a saved identify file, which the runner could replace.

**Where does the GitHub App key live on Fly?** **Chosen:** a 0600 file, `github-app.pem`, on the governor's volume. Rejected: a Fly secret, which is exposed to every process in the machine as an environment variable.

## 7. Open questions and assumptions

**Open questions.** None.

**Assumptions.**

- **Assumes:** Fly supports app-scoped deploy tokens, and the runner app's machines carry no Fly token that can deploy to, SSH into, or manage volumes of the governor app. Validate: the operator lists the runner's secrets and environment and `fly tokens list` before deploying; the runbook has the commands.
- **Assumes:** a container started by `drain.sh` inside the runner's Fly machine can resolve `<app>.internal` and connect to a 6PN IPv6 address. Validate: from the runner's cage, `getent ahosts <governor-app>.internal` and a TCP connect to port 7650, before the first L3 firing.
- **Assumes:** `fly-local-6pn` resolves inside a Fly machine to the machine's own 6PN address. Validate: `getent hosts fly-local-6pn` in a `fly ssh console` session.
- **Assumes:** 6PN traffic between machines is carried inside Fly's WireGuard mesh and an app cannot observe packets addressed to another app's machines. Validate against Fly's current private-networking documentation; if it does not hold, the TCP path needs transport encryption, which reopens the "no new credential" decision.
- **Chosen:** (operator, 2026-10-14) the app-identity check does not rely on Fly enforcing source addresses within a network, which Fly does not document. It relies on the network holding only the governor and the runner, so a faked source can only be another runner machine's (section 3, "Fly network basis").
- **Assumes:** the operator's `fly ssh console -a <governor-app>` reaches the governor machine (Fly's SSH service works for an app with no public IP and no services). Validate: run it once after deploy; the runbook includes the command. `pin --fly-app` and the PR cross-check depend on it.
- **Assumes:** custom private networks (`fly apps create --network`) isolate apps on different networks from each other and still provide `.internal` DNS within the network. Isolation confirmed by the operator on 2026-10-14 from Fly's documentation (section 3, "Fly network basis"); `.internal` DNS within the network is validated after deploy with `getent ahosts <governor-app>.internal` from the runner.
- **Assumes:** FAFF-1220's GitHub App layout, as stated in section 3 (The GitHub App key on Fly).
- **Assumes:** a Fly machine with no public IP can still open outbound HTTPS connections to `api.github.com`, which the governor needs only when the `github_app` block is configured. Validate: after deploy, `commissaire governor status` from a `fly ssh console` session reports `app_token: ok`.

## 8. Done

### From why
- [ ] The governor runs as its own always-on Fly app whose volume and secrets the runner app cannot reach; the runbook records how the operator checked that.
- [ ] The runbook records the cited Fly documentation on isolation between custom private networks and the operator's 2026-10-14 basis for the same-network question (only the governor and runner apps on the network); the pre-build gate is satisfied (operator).
- [ ] `fly ips list` for the governor app shows no public address after deploy, and the runbook includes that check (operator).
- [ ] The governor app and the runner app are on the same custom private network and no other app is on it; the runbook includes the commands that show this and says to re-check before every redeploy (operator).
- [ ] The runner app's machines hold no Fly token that can deploy to, SSH into or manage the governor app, or create an app on its network; the runbook includes the commands that show this (operator).
- [ ] The governor is never placed on the default organisation network; the runbook says so and explains that every app in the organisation could otherwise reach the listener.
- [ ] ADR 0135 carries an amendment note for decision 2 (always on), citing this ticket.

### Progressive tiers
- [ ] Tier 0 and Tier 1: the existing `merge-gate`, `pr-create`, branch-delete and `commissaire-verify` tests pass with their assertions unchanged.
- [ ] Tier 2: a test starts `governor start --listen 127.0.0.1:<port>` (and one on `[::1]`-style `::1:<port>`) with no `--listen-allow-dns`, admits a run over TCP, and asserts it starts and serves as before, with no new stderr output and no `tcp-unrestricted` or `tcp-refused` log line.
- [ ] Tier 2: a Unix-socket governor and `pin` without `--fly-app` pass their existing FAFF-1216/1217 tests unchanged.
- [ ] A failed trust-file read still refuses a governed grant with `trust-file-invalid` (existing test passes unchanged).

### From what
- [ ] `operations/fly/governor/fly.toml`, `Dockerfile`, `entrypoint.sh` and `governor-config.json` exist; `fly.toml` mounts one volume at `/data`, has no `http_service` and no `[[services]]` section, and keeps the machine running.
- [ ] The image runs the governor as a fixed non-root `commissaire` uid from a root-owned, read-only code tree and records its source commit.
- [ ] `governor-config.json` in the image lists only uid 0 in `admin_uids` and nothing in `allow_uids`, and the entrypoint replaces the volume copy with it on every start.
- [ ] `docs/guide/unattended.md` has a "Run the governor as its own Fly app" section covering every operator step in the human-tasks table, including the token and reachability checks and the GitHub App key placement (`/data/commissaire/github-app.pem`), the `github_app` block with its `repos` bindings, the `app_token: ok` proof, rotation and removal.
- [ ] `governor start --listen-allow-dns` refuses an unlisted source address before reading the request, logs the refusal, and fails closed on a DNS error, covered by a unit test with an injected resolver (allowed source, unlisted source, lookup failure, and a source that appears only on the forced re-resolve).
- [ ] With `--listen-allow-dns`, forced re-resolves happen at most once every 5 seconds and `tcp-refused` lines are capped at 60 a minute with a `refusals-suppressed` count, with or without `--socket-group-access`, covered by a test with an injected resolver and clock.
- [ ] `governor start --listen` on a non-loopback host without `--listen-allow-dns` exits 2 naming both flags; with `--listen-unrestricted` it starts and logs one `tcp-unrestricted` line; each path is tested.
- [ ] `pin --fly-app` validates the app name, runs `fly` with an argument array and the fixed `/opt/commissaire/current` path, reads `identify` from its own `fly ssh console` subprocess (never a file), refuses a runner-writable `fly` binary, verifies `pk_fingerprint == pkFingerprint(pk)`, skips only the local host-fact checks, keeps the repository, base-branch and branch-protection checks, and puts the app name, the source commit, the fixed five-item checklist (verbatim) and the cross-check command in the PR body, asserted by a test on the exact text.
- [ ] `commissaire governor identify --json` prints the `identify` reply from the local Unix socket.

### From how
- [ ] The entrypoint takes `GOVERNOR_LISTEN` (default `fly-local-6pn:7650`) and `GOVERNOR_ALLOW_DNS` (required) from the environment, refuses to start without the latter or with characters outside `[A-Za-z0-9.:_-]` in either, and passes them to `governor start`.
- [ ] The entrypoint creates `/data/commissaire` (owner `commissaire`, mode 0700) on a fresh volume and refuses to start when the directory or any entry in it has another owner, is a symlink, or has another mode.
- [ ] The governor listens only on the 6PN address.

### From scenarios and acceptance criteria
- [ ] A local container test builds the image, starts it with a temporary volume, and asserts the key file, its owner and modes, the listener address, and that `identify` over TCP is refused `op-unix-only`.
- [ ] The runner's cage reaches the governor: from inside a cage started by `drain.sh`, a TCP connect to the configured `COMMISSAIRE_GOVERNOR` succeeds (operator; the runbook gives the command).
- [ ] The governor's fingerprint is pinned in `.commissaire/trust.toml` through a human-approved PR (operator).
- [ ] One real L3 firing on faff's repository produces a governed merge whose grant `verifyGrant` classifies `pinned`, and the governor log shows the request (operator; evidence linked on the ticket).
- [ ] `faff regions check`, the type check and the full test suite pass.

### Integration smoke test

```
1. Build the image locally from a clean checkout; run it with a temp volume at /data, GOVERNOR_LISTEN=::1:7650 and
   GOVERNOR_ALLOW_DNS=::1 (a literal address), so the test's own ::1 source is the allowed caller.
1a. EXPECT the entrypoint to exit 1 naming GOVERNOR_ALLOW_DNS when that variable is unset.
2. EXPECT /data/commissaire/governor-key.json, mode 0600, owner commissaire; directory mode 0700.
3. From a second process in the container's network namespace, COMMISSAIRE_GOVERNOR=::1:7650 commissaire contract admit ... → custody "governor" (parseEndpoint splits on the last colon).
4. Inside the container, as root, commissaire governor identify --json → pk matches the key file and pk_fingerprint equals pkFingerprint(pk).
5. EXPECT a TCP identify request → op-unix-only.
```

confidence: high
build-tier: complex
spec-review: human-override (operator, 2026-10-14)

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```