# FAFF-1211 — macOS peer-credential read: manual verification procedure

CI runs on Linux, where the governor's real `SO_PEERCRED` read is exercised end to end by
`test/governor-peer-cred.test.mjs` ("linux real-peer …"). The macOS `LOCAL_PEERCRED` / `struct xucred`
decode has no precedent in this repo (the FAFF-1109 spike's macOS run was single-uid), so it is carried
as an Assumption (spec §7) and demonstrated by the procedure below on a real macOS host before the macOS
path is relied on in production. CI itself uses the stubbed reader for the cross-platform guard tests.

## Prerequisites

- A macOS host with `python3` at a trusted absolute path (`/usr/bin/python3`; the system / Xcode CLT
  Python). `TRUSTED_PYTHON_PATHS` in `plugin/skills/faff/bin/lib/peer-cred.ts` must contain that path.
- A second local user account (for the intruder half), or at minimum the ability to run a client
  process as the same user (for the served half).

## Procedure

### 1. Same-user served read (the decode is correct)

1. From a checkout, run a one-off Node harness that mirrors the governor's wiring:
   ```
   node -e '
     const net = require("node:net");
     const { makePeerCredReader } = require("./plugin/skills/faff/bin/lib/peer-cred.js");
     const reader = makePeerCredReader();
     const s = "/tmp/faff-peercred-macos.sock";
     const srv = net.createServer({ allowHalfOpen: true }, (sock) => {
       console.log("read:", JSON.stringify(reader.readPeerUid(sock)), "my uid:", process.getuid());
       sock.destroy(); srv.close();
     });
     srv.listen(s, () => { const c = net.connect(s); c.on("error", () => {}); });
   '
   ```
2. **Expect:** `read: {"ok":true,"uid":<N>,...}` where `<N>` equals `id -u` for the running user.
   A wrong uid, or `peer-credentials-unreadable`, means the `struct xucred` offsets are wrong for this
   macOS release — narrow the decode in `peer-cred-helper.py`'s `read_darwin` before shipping. Do not
   ship an unproven macOS read; a wrong decode that happened to pass an allow-list check would be worse
   than a refusal.

### 2. Multi-user intruder refusal (the gate holds across users)

1. As the governor's own user, hand-write a root-owned `governor-config.json` (mode `0600`) in the
   `0700` key dir listing only the allowed runner's uid.
2. Start the governor (`commissaire governor start --key-dir <dir>`).
3. Connect from the allowed uid → the admit reply is normal and the log line carries `peer_uid`.
4. Connect from the *second* user's uid → `{ ok: false, reason: "caller-not-allowed" }` before the
   request is read, and a connect log line records that uid.

## Record the result

Append the observed uids and replies to this file (or a dated sibling) when the procedure is run, so the
macOS assumption has a dated evidence trail, mirroring the FAFF-1109 spike RESULTS.
