// ===========================================================================
// === region:factory — container-check — FAFF-42: assert the ADR-0010 blast-radius boundary. ===
// faff owns NO sandbox (ADR 0010); the boundary for an autonomous run is a
// host-isolated CONTAINER, not faff. This is the thin ASSERTION layer — detect
// whether that container is present and say so; it never enforces. PURE given
// (env, fsq) readings: no tracker, no network — parity with next/eligible.
// Reads ONLY standard runtime signals (Docker/Podman marker files, the k8s
// service-host var, the systemd `container=` convention); faff invents no
// marker and requires no container cooperation. NEVER parses /proc/1/cgroup
// (empty `0::/` under cgroup v2 — no container hint). The autonomous-entry
// preflight (gateway → Autonomous Mode Contract) calls this and WARNS by
// default — never blocks — escalating to abort only under the opt-in
// autonomous.require_container=block knob.
//
// FAFF-333 — hostSocketProbe (below) is a SEPARATE pure detector for a DIFFERENT
// axis: containment ("is there a boundary?", above) vs. boundedness ("is the
// boundary sound?"). A mounted HOST docker socket inside the cage is root-
// equivalent host control (ADR-0041 decision 3) — a `contained` containerCheck
// verdict can still be sitting behind an unbounded engine. Kept as its own
// function (not folded into containerCheck) so containerCheck's own contract/
// selftest/exit-code stay untouched; `container-check`'s CLI output below just
// SURFACES it as an additional `host_socket` field + warning line (exit
// unchanged) — the binding refuse lives on the lights-out path (lights-out.js).
// ===========================================================================

// Truthy in the shell-env sense: present and not one of the falsey tokens.

const fs = require("node:fs");

function envTruthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false" && s !== "no";
}

// Pure detection. `env` is a KEY→VALUE map; `fsq` is an injectable reader
//   { exists(path)->bool, readEnviron(path)->string }.
// Precedence: the first decisive signal wins. Returns { result, basis }; result
// is "contained" | "not_confirmed", basis names which rule fired (honest message).
function containerCheck(env, fsq) {
  env = env || {};
  if (env.KUBERNETES_SERVICE_HOST !== undefined && String(env.KUBERNETES_SERVICE_HOST) !== "") {
    return { result: "contained", basis: "k8s" };
  }
  if (fsq.exists("/.dockerenv")) return { result: "contained", basis: "dockerenv" };
  if (fsq.exists("/run/.containerenv")) return { result: "contained", basis: "containerenv" };
  // /proc/1/environ is NUL-separated KEY=VALUE; the adapter returns "" on any read error.
  const pid1 = fsq.readEnviron("/proc/1/environ") || "";
  const kv = pid1.split("\0").find((t) => t.startsWith("container="));
  if (kv) return { result: "contained", basis: "pid1-container=" + (kv.slice("container=".length) || "?") };
  if (envTruthy(env.container)) return { result: "contained", basis: "env-container" };
  return { result: "not_confirmed", basis: "no-signal" };
}

// The real-fs adapter the CLI uses (the selftest injects a synthetic one). This
// is where the "never throws on read errors" guarantee lives: a missing path or a
// permission error becomes a no-signal, never an exception.
function realFsq() {
  return {
    exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    readEnviron: (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } },
    // FAFF-379: additive wrappers the worktree-isolation floor probe reuses — a
    // failed stat/access becomes a no-signal (false), never an exception. Harmless
    // to existing callers (containerCheck reads only exists/readEnviron).
    isDirectory: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    writable: (p) => { try { fs.accessSync(p, fs.constants.W_OK); return true; } catch { return false; } },
  };
}

// FAFF-333 — the two well-known HOST docker socket paths. /var/run is typically a
// symlink to /run on most distros; both are checked, cheap and belt-and-suspenders.
// Deliberately EXCLUDES rootless paths (/run/user/<uid>/docker.sock, podman's
// $XDG_RUNTIME_DIR/podman/podman.sock) — those are the RECOMMENDED bounded posture
// (ADR-0041 decision 3) and must never false-positive as a host-socket violation.
const HOST_SOCKET_PATHS = ["/var/run/docker.sock", "/run/docker.sock"];

// Pure detection, same injectable `fsq` shape as containerCheck. Recall-biased over
// the canonical paths only — it does not consult DOCKER_HOST and does not chase a
// socket mounted at a non-canonical path (out of faff's threat model; the cage
// itself, not this probe, is the real boundary — see the region banner above).
function hostSocketProbe(fsq) {
  for (const p of HOST_SOCKET_PATHS) {
    if (fsq.exists(p)) return { present: true, path: p };
  }
  return { present: false, path: null };
}

const { parseArgs, usageError } = require("./argv");
// FAFF-655 — `--gate` joins the surface flags: the binding admission verdict a
// workflow gates on, additive to the default reading (which is untouched).
const CONTAINER_CHECK_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--gate": { arity: 0 } } };

// FAFF-655 — the injection seam is a defaulted `deps` param: production supplies
// nothing (defaults are the real adapters), the selftest passes synthetic
// { env, fsq } to drive the command over fabricated state and read the exit code.
// Mirrors the (env, fsq) seam containerCheck/hostSocketProbe already have, lifted
// to the command entry point — no global state, no process.env monkey-patching.
function cmdContainerCheck(args, { env = process.env, fsq = realFsq() } = {}) {
  if (args.includes("--selftest")) return containerCheckSelftest();
  const { values, errors } = parseArgs(args, CONTAINER_CHECK_SPEC);
  if (errors.length) return usageError(errors, "usage: faff container-check [--json] [--gate]");
  const json = !!values["--json"];
  const gate = !!values["--gate"];
  const { result, basis } = containerCheck(env, fsq);
  const hostSocket = hostSocketProbe(fsq);

  if (gate) {
    // FAFF-655 — the composite admission verdict. ADR-0095's two criteria, ANDed:
    // the run is `contained` AND no canonical host engine socket is reachable. The
    // load-bearing case is contained-WITH-host-socket → refuse: a contained job
    // that still reaches the host socket is root-equivalent host control (ADR-0041
    // decision 3) and is not admissible — which the default reading only WARNS
    // about. Pure (env, fsq); deliberately does NOT read autonomous.engine_bounded
    // (that downgrade is lights-out.js's, the L4 path) — `--gate` is the strict
    // floor a CI workflow gates on. "Work scoped to this checkout" is not a
    // criterion (ADR-0095 excluded it as not faff-checkable) — two criteria, not three.
    const containedOk = result === "contained";
    const noHostSocket = !hostSocket.present;
    const pass = containedOk && noHostSocket;
    const reasons = [];
    if (!containedOk) reasons.push(`containment not confirmed (${basis})`);
    if (!noHostSocket) reasons.push(`host docker socket present at ${hostSocket.path}`);
    if (json) {
      console.log(JSON.stringify({
        verdict: pass ? "pass" : "fail",
        contained: containedOk,
        basis,
        host_socket: hostSocket,
        criteria: { contained: containedOk, no_host_socket: noHostSocket },
      }));
    } else {
      console.log(pass ? "pass" : `fail — ${reasons.join("; ")}`);
    }
    return pass ? 0 : 1;
  }

  // Default surface reading — UNCHANGED exit-code contract (FAFF-333): containment
  // decides the exit code, a present host socket only WARNS. Existing callers keep
  // their contract; the binding semantics live only behind the opt-in `--gate`.
  if (json) {
    console.log(JSON.stringify({ result, basis, host_socket: hostSocket }));
  } else {
    console.log(`${result} (basis: ${basis})`);
    // FAFF-333: mode-agnostic warn (fires wherever container-check is invoked, incl.
    // interactive) — containment (exit code) is UNCHANGED; the binding refuse for
    // this axis lives on the lights-out path only (lights-out.js), never here.
    if (hostSocket.present) {
      console.log(`WARNING: host docker socket present at ${hostSocket.path} — root-equivalent host control voids host isolation regardless of containment (ADR-0041 decision 3); a bounded rootless nested engine is required`);
    }
  }
  return result === "contained" ? 0 : 1;
}

// In-memory selftest over synthetic (env, fsq) fixtures — mirrors the eligible /
// next selftest shape (per-case ok/FAIL + a RESULT line, non-zero on any fail).
function containerCheckSelftest() {
  const mkFsq = (present, environ) => ({
    exists: (p) => present.has(p),
    readEnviron: () => environ || "",
  });
  const CASES = [
    // [env, present-paths, environ, want-result, want-basis, label]
    [{ KUBERNETES_SERVICE_HOST: "10.0.0.1" }, [], "", "contained", "k8s", "k8s in-pod"],
    [{}, ["/.dockerenv"], "", "contained", "dockerenv", "docker marker (claude-box)"],
    [{}, ["/run/.containerenv"], "", "contained", "containerenv", "podman marker"],
    [{}, [], "HOME=/root\0container=systemd-nspawn", "contained", "pid1-container=systemd-nspawn", "pid1 container= convention"],
    [{ container: "lxc" }, [], "", "contained", "env-container", "truthy env container"],
    [{}, [], "", "not_confirmed", "no-signal", "bare host (no signal)"],
    [{ KUBERNETES_SERVICE_HOST: "x" }, ["/.dockerenv"], "", "contained", "k8s", "k8s precedence over docker"],
    [{ KUBERNETES_SERVICE_HOST: "" }, [], "", "not_confirmed", "no-signal", "empty k8s var is no signal"],
    [{ container: "false" }, [], "", "not_confirmed", "no-signal", "falsey env container ignored"],
    [{ container: "0" }, [], "", "not_confirmed", "no-signal", "zero env container ignored"],
  ];
  let fail = 0;
  for (const [env, present, environ, wantR, wantB, label] of CASES) {
    const { result, basis } = containerCheck(env, mkFsq(new Set(present), environ));
    const ok = result === wantR && basis === wantB;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → ${result}/${basis} (want ${wantR}/${wantB})`);
  }
  // never-throws (real adapter): reads of absent paths return falsey, no exception.
  try {
    const rf = realFsq();
    if (rf.exists("/no/such/marker/xyz") !== false) { console.log("FAIL real exists(absent) ≠ false"); fail++; }
    if (rf.readEnviron("/no/such/environ/xyz") !== "") { console.log("FAIL real readEnviron(absent) ≠ \"\""); fail++; }
  } catch { console.log("FAIL real adapter threw on an absent path"); fail++; }

  // FAFF-333 — hostSocketProbe fixture table: bare / var-run / run / both-present
  // (first path wins when both exist).
  const HS_CASES = [
    // [present-paths, want-present, want-path, label]
    [[], false, null, "bare (no socket)"],
    [["/var/run/docker.sock"], true, "/var/run/docker.sock", "var-run socket present"],
    [["/run/docker.sock"], true, "/run/docker.sock", "run socket present"],
    [["/var/run/docker.sock", "/run/docker.sock"], true, "/var/run/docker.sock", "both present → first path wins"],
  ];
  for (const [present, wantPresent, wantPath, label] of HS_CASES) {
    const { present: p, path: pth } = hostSocketProbe(mkFsq(new Set(present)));
    const ok = p === wantPresent && pth === wantPath;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} host-socket: ${label} → present=${p}/path=${pth} (want ${wantPresent}/${wantPath})`);
  }
  // never-throws (real adapter), same guarantee as containerCheck above.
  try {
    const hs = hostSocketProbe(realFsq());
    if (hs.present !== false || hs.path !== null) {
      // Not a failure per se (a real host socket may genuinely be present on this
      // machine) — only assert it didn't throw and returned the well-formed shape.
      if (typeof hs.present !== "boolean" || (hs.path !== null && typeof hs.path !== "string")) {
        console.log("FAIL hostSocketProbe(realFsq()) returned a malformed shape"); fail++;
      }
    }
  } catch { console.log("FAIL hostSocketProbe(realFsq()) threw"); fail++; }

  // FAFF-655 — COMMAND-LEVEL exit-code assertions. The cases above exercise the pure
  // functions; these drive cmdContainerCheck itself over the injection seam and assert
  // the RETURNED exit code (a gate whose exit code is untested is decoration). `capture`
  // swaps console.log for a collector so the driven command's output doesn't pollute the
  // selftest log and can be asserted (the --json shape row).
  const capture = (args, env, present) => {
    const log = console.log; const lines = [];
    console.log = (...a) => lines.push(a.join(" "));
    let code;
    try { code = cmdContainerCheck(args, { env, fsq: mkFsq(new Set(present), "") }); }
    finally { console.log = log; }
    return { code, out: lines.join("\n") };
  };
  const GATE_CASES = [
    // [args, env, present-paths, want-code, label]
    [["--gate"], {}, ["/.dockerenv"], 0, "gate: contained + no socket → admit (0)"],
    [["--gate"], {}, ["/.dockerenv", "/var/run/docker.sock"], 1, "gate: contained + HOST SOCKET → refuse (1) [the load-bearing row]"],
    [["--gate"], {}, [], 1, "gate: not_confirmed + no socket → refuse (1)"],
    [["--gate"], {}, ["/run/docker.sock"], 1, "gate: not_confirmed + host socket → refuse (1)"],
    [["--gate"], { KUBERNETES_SERVICE_HOST: "10.0.0.1" }, [], 0, "gate: k8s contained + no socket → admit (0)"],
    // legacy contract unchanged: bare command still ADMITS contained-with-socket (warn only)
    [[], {}, ["/.dockerenv", "/var/run/docker.sock"], 0, "bare: contained + socket → 0 (unchanged FAFF-333 contract)"],
    [[], {}, [], 1, "bare: not_confirmed → 1 (unchanged contract)"],
  ];
  for (const [args, env, present, wantCode, label] of GATE_CASES) {
    const { code } = capture(args, env, present);
    const ok = code === wantCode;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → exit ${code} (want ${wantCode})`);
  }
  // the composite --json shape names both criteria (so a reader sees WHY it refused).
  {
    const { code, out } = capture(["--gate", "--json"], {}, ["/.dockerenv", "/var/run/docker.sock"]);
    let j = null; try { j = JSON.parse(out); } catch { /* j stays null → FAIL below */ }
    const ok = code === 1 && j && j.verdict === "fail" && j.contained === true
      && j.criteria && j.criteria.contained === true && j.criteria.no_host_socket === false
      && j.host_socket && j.host_socket.present === true && typeof j.basis === "string";
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} gate --json composite shape (verdict=fail, contained=true, no_host_socket=false) → ${out}`);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${CASES.length + HS_CASES.length + GATE_CASES.length + 1} cases + never-throws x2, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { cmdContainerCheck, containerCheck, containerCheckSelftest, envTruthy, hostSocketProbe, HOST_SOCKET_PATHS, realFsq };
