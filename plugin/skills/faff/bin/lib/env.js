// ===========================================================================
// === region:factory — env — FAFF-270: live compose provisioning, hardened + tested. ===
//   env compose-gen [--profile FILE] [--out PATH] [--project NAME]   PURE: infra-profile → compose file + ProvisionPlan (stdout)
//   env up   [--plan FILE | --profile FILE] [--project NAME] [--sla-secs N] [--poll-secs N]   docker: compose up -d + health-wait
//   env seed [--plan FILE] [--manifest FILE]                                docker: fixtures realise + load per seed_targets
//   env down [--project NAME]                                               docker: compose down -v (idempotent teardown)
//   env --selftest                                                          pure compose-gen cases (no docker)
// compose-gen is the deterministic, docker-FREE core (unit-tested, byte-identical: no wall-clock, no
// random). The live verbs (up/seed/down) are thin docker orchestration the faffter-noon-env-compose
// producer calls; their integration tests are docker-gated (skip when docker absent). An unprovisionable
// datastore kind (no DATASTORE_TABLE entry) is REPORTED in plan.unprovisionable[] — never silently
// skipped — so the producer fails loud rather than ship an incomplete env. FAFF-30 fixed the env-handle
// contract; FAFF-270 makes its §4.1 procedure real. Seed-loader breadth (FAFF-270 resolved scope):
// sql-load = postgres/mysql/sqlite; mongoimport = mongo; command-replay = redis; object-upload = minio (S3).
// ===========================================================================
// `env` = dev/test container environment (synthetic, ephemeral, local) — without it the official
// postgres/mysql images refuse to boot (no password set), so the env never reaches healthy. Trust /
// empty-password auth is intentional: this is a throwaway local stand-in, never a real datastore.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, requireFlags, usageError } = require("./argv");
const ENV_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--root": { arity: 1 },
  "--manifest": { arity: 1 }, "--out": { arity: 1 }, "--plan": { arity: 1 }, "--poll-secs": { arity: 1 },
  "--profile": { arity: 1 }, "--project": { arity: 1 }, "--sla-secs": { arity: 1 },
}, positionals: { min: 0, max: null, name: "verb" } };
// FAFF-628 — declared grammar. `up`/`compose-gen` resolve --project from the infra profile when
// omitted (optional); `seed`/`down` enforce it/--plan unconditionally today — migrated below.
const ENV_SURFACE = {
  kind: "subcommand_dispatch",
  spec: ENV_SPEC,
  subcommands: {
    "compose-gen": { required_flags: [] },
    up: { required_flags: [] },
    seed: { required_flags: ["--plan"] },
    down: { required_flags: ["--project"] },
  },
};
const { ENTRYPOINT, findRoot } = require("./shared-infra");

const DATASTORE_TABLE = {
  postgres: { image: "postgres:16-alpine", port: 5432,  probe: "pg_isready -U postgres", seed_strategy: "sql-load", file_based: false, env: { POSTGRES_HOST_AUTH_METHOD: "trust" } },
  mysql:    { image: "mysql:8",            port: 3306,  probe: "mysqladmin ping -h 127.0.0.1", seed_strategy: "sql-load", file_based: false, env: { MYSQL_ALLOW_EMPTY_PASSWORD: "yes", MYSQL_DATABASE: "app" } },
  sqlite:   { image: null,                 port: null,  probe: null,              seed_strategy: "sql-load", file_based: true },
  redis:    { image: "redis:7-alpine",     port: 6379,  probe: "redis-cli ping",  seed_strategy: "command-replay", file_based: false },
  mongo:    { image: "mongo:7",            port: 27017, probe: "mongosh --eval 'db.runCommand({ping:1})'", seed_strategy: "mongoimport", file_based: false },
  // S3-compatible object store (FAFF-273). MinIO refuses to boot without a `command:` (`server /data`)
  // — the one datastore that needs the renderCompose `command:` capability. Dev/test root creds are
  // throwaway (never real, never persisted to tracker/PR — FAFF-30 §7). Probe via the image's own
  // curl on the engine-native readiness endpoint. `s3` is accepted as an alias in composeGen.
  minio:    { image: "minio/minio", port: 9000, probe: "curl -f http://localhost:9000/minio/health/ready", seed_strategy: "object-upload", file_based: false, env: { MINIO_ROOT_USER: "faffdev", MINIO_ROOT_PASSWORD: "faffdevsecret" }, command: "server /data --console-address :9001" },
};
const ENV_APP_PORT = 8080;
const ENV_DEFAULT_SLA_SECS = 60;
const ENV_DEFAULT_POLL_SECS = 2;

// Deterministic FNV-1a short hash → stable project-name component (no wall-clock, no random).
function envShortHash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// FAFF-303: reconcile the synthesized app service against the repo's own compose.
// All the file I/O lives in `cmdEnv`; everything below is pure (string/data in, data out)
// so `composeGen` stays byte-deterministic. The extractor fails CLOSED to null on any
// shape it doesn't recognise (recall-biased: degrade to profile defaults, never crash).
// ---------------------------------------------------------------------------
function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Strip a YAML inline comment (` #…`) that is not inside a quoted scalar.
function stripYamlInlineComment(line) {
  let q = null;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (q) { if (ch === q) q = null; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === "#" && (k === 0 || /\s/.test(line[k - 1]))) return line.slice(0, k);
  }
  return line;
}

// Parse a flow sequence of scalars: ["CMD-SHELL", "node -e \"…\""] or ['a','b'] or [a, b].
// Honours YAML quoting so commas/quotes inside a quoted element don't split it: double-quoted
// strings unescape `\"` / `\\`; single-quoted strings unescape `''`.
function parseFlowSeq(s) {
  const inner = s.slice(1, -1);
  const items = [];
  let cur = "", q = null, sawToken = false;
  for (let k = 0; k < inner.length; k++) {
    const ch = inner[k];
    if (q === '"') {
      if (ch === "\\" && k + 1 < inner.length) { const n = inner[++k]; cur += (n === '"' || n === "\\") ? n : ("\\" + n); }
      else if (ch === '"') q = null;
      else cur += ch;
    } else if (q === "'") {
      if (ch === "'" && inner[k + 1] === "'") { cur += "'"; k++; }
      else if (ch === "'") q = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") { q = ch; sawToken = true; }
    else if (ch === ",") { items.push(cur); cur = ""; sawToken = false; }
    else if (/\s/.test(ch)) { /* skip unquoted whitespace */ }
    else { cur += ch; sawToken = true; }
  }
  if (q) throw new Error("unterminated quote in flow sequence");
  if (sawToken || items.length) items.push(cur);
  return items;
}

// Minimal block-style YAML parser for the common docker-compose subset: nested maps,
// block sequences, "key: value", "- item", quoted scalars, and a flow sequence of scalars
// (for healthcheck.test). Does NOT support anchors/aliases, merge keys, flow maps, or
// multiline scalars — it THROWS on those so the caller falls back to profile defaults.
function parseComposeSubset(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw)) continue;
    const stripped = stripYamlInlineComment(raw);
    if (/^\s*$/.test(stripped)) continue;
    const indent = stripped.match(/^ */)[0].length;
    if (/^\t/.test(stripped) || /\t/.test(stripped.slice(0, indent))) throw new Error("tab indentation unsupported");
    lines.push({ indent, body: stripped.slice(indent).replace(/\s+$/, "") });
  }
  let i = 0;
  const parseScalar = (s) => {
    s = s.trim();
    if (s === "" || s === "~" || s === "null") return s === "" ? "" : null;
    const c = s[0], e = s[s.length - 1];
    if (c === '"' && e === '"') return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (c === "'" && e === "'") return s.slice(1, -1).replace(/''/g, "'");
    if (c === "[" && e === "]") return parseFlowSeq(s);
    if (c === "{" || c === "[") throw new Error("flow collection unsupported");
    return s;
  };
  const parseNode = (minIndent) => {
    if (i >= lines.length || lines[i].indent < minIndent) return null;
    const baseIndent = lines[i].indent;
    if (lines[i].body.startsWith("- ")) {
      const arr = [];
      while (i < lines.length && lines[i].indent === baseIndent && lines[i].body.startsWith("- ")) {
        const rest = lines[i].body.slice(2);
        if (/^[^\s"'][^:]*:(\s|$)/.test(rest)) {        // inline-map sequence item: "- key: value"
          lines[i] = { indent: baseIndent + 2, body: rest };
          arr.push(parseNode(baseIndent + 2));
        } else { i++; arr.push(parseScalar(rest)); }
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length && lines[i].indent === baseIndent && !lines[i].body.startsWith("- ")) {
      const m = lines[i].body.match(/^([^:]+):(.*)$/);
      if (!m) throw new Error("unparseable line: " + lines[i].body);
      const key = m[1].trim(), valuePart = m[2].trim();
      i++;
      if (valuePart === "") {
        obj[key] = (i < lines.length && lines[i].indent > baseIndent) ? parseNode(lines[i].indent) : null;
      } else { obj[key] = parseScalar(valuePart); }
    }
    return obj;
  };
  return parseNode(lines.length ? lines[0].indent : 0) || {};
}

// Map a compose service image to a known DATASTORE_TABLE kind (postgres/mysql/redis/mongo), else null.
function envDatastoreKindForImage(image) {
  if (typeof image !== "string" || !image) return null;
  const repo = image.toLowerCase().split(":")[0].split("/").pop();
  for (const kind of Object.keys(DATASTORE_TABLE)) {
    const spec = DATASTORE_TABLE[kind];
    if (!spec.image) continue;
    if (repo === spec.image.split(":")[0] || repo === kind) return kind;
  }
  return null;
}

function normalisePorts(ports) {
  if (!Array.isArray(ports)) return [];
  const out = [];
  for (const p of ports) {
    if (typeof p === "string" && p) out.push(p);
    else if (p && typeof p === "object" && p.target != null) {
      out.push(p.published != null ? `${p.published}:${p.target}` : `${p.target}:${p.target}`);
    }
  }
  return out;
}

function normaliseEnv(env) {
  const out = {};
  if (Array.isArray(env)) {
    for (const e of env) {
      if (typeof e !== "string") continue;
      const eq = e.indexOf("=");
      if (eq === -1) out[e] = ""; else out[e.slice(0, eq)] = e.slice(eq + 1);
    }
  } else if (env && typeof env === "object") {
    for (const k of Object.keys(env)) out[k] = env[k] == null ? "" : String(env[k]);
  }
  return out;
}

// Rewrite a host inside an env value when it exactly equals a repo-compose datastore service name,
// to the generated kind-name (so e.g. DATABASE_URL resolves on the generated compose network).
function realignDbHost(value, renames) {
  let v = String(value);
  for (const repoName of Object.keys(renames)) {
    const kind = renames[repoName];
    if (repoName === kind) continue;
    const re = new RegExp("(^|[@/=:])" + escapeRegExp(repoName) + "(?=[:/]|$)", "g");
    v = v.replace(re, (_m, pfx) => pfx + kind);
  }
  return v;
}

// Best-effort path out of a healthcheck test (display only).
function healthPathFromTest(test) {
  if (test == null) return null;
  const s = Array.isArray(test) ? test.join(" ") : String(test);
  const m = s.match(/https?:\/\/[^\s"']*?(\/[^\s"':]*)/);
  if (m) return m[1];
  const m2 = s.match(/\s(\/[A-Za-z0-9_\-./]+)/);
  return m2 ? m2[1] : null;
}

// Extract an AppOverride from repo-compose text, or null (no single buildable app / unrecognised shape).
function extractAppOverride(text) {
  let doc;
  try { doc = parseComposeSubset(text); } catch { return null; }
  const services = doc && doc.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) return null;
  const names = Object.keys(services);
  const appNames = names.filter(n => services[n] && services[n].build != null);
  if (appNames.length !== 1) return null;                     // 0 or >1 buildable app → OUT OF SCOPE
  const appName = appNames[0], app = services[appName];
  let build_context = ".", dockerfile = "Dockerfile";
  if (typeof app.build === "string") { build_context = app.build || "."; }
  else if (app.build && typeof app.build === "object") {
    if (typeof app.build.context === "string" && app.build.context) build_context = app.build.context;
    if (typeof app.build.dockerfile === "string" && app.build.dockerfile) dockerfile = app.build.dockerfile;
  }
  const db_service_renames = {};
  // FAFF-303: capture each repo datastore service's own env (the auth vars that create the
  // role/db/password the app's connection string binds to), keyed by the GENERATED kind name
  // composeGen will synthesize — so composeGen can merge it onto the generated datastore.
  const db_env = {};
  for (const n of names) {
    if (n === appName) continue;
    const kind = envDatastoreKindForImage(services[n] && services[n].image);
    if (kind) { db_service_renames[n] = kind; db_env[kind] = normaliseEnv(services[n] && services[n].environment); }
  }
  const rawEnv = normaliseEnv(app.environment), environment = {};
  for (const k of Object.keys(rawEnv)) environment[k] = realignDbHost(rawEnv[k], db_service_renames);
  const healthcheck_test = (app.healthcheck && typeof app.healthcheck === "object" && app.healthcheck.test != null)
    ? app.healthcheck.test : null;
  return {
    build_context, dockerfile, ports: normalisePorts(app.ports), environment,
    healthcheck_test, health_path: healthPathFromTest(healthcheck_test),
    app_service_name: appName, db_service_renames, db_env,
  };
}

// Image-aware default app probe — only used when the repo declares NO app healthcheck. Never curl.
function envImageAwareProbe(profile, appPorts, healthPath) {
  const segs = String((Array.isArray(appPorts) && appPorts[0]) || "").split(":");
  const port = segs[segs.length - 1] || String(ENV_APP_PORT);
  const url = `http://localhost:${port}${healthPath || "/health"}`;
  const runtimes = Array.isArray(profile && profile.runtimes) ? profile.runtimes : [];
  const isNode = runtimes.some(r => /node/i.test(typeof r === "string" ? r : ((r && r.name) || "")));
  return isNode
    ? ["CMD-SHELL", `node -e "require('http').get('${url}',function(r){process.exit(r.statusCode<400?0:1)}).on('error',function(){process.exit(1)})"`]
    : ["CMD-SHELL", `wget -qO- ${url} || exit 1`];
}

// Locate + read the repo's own compose (file I/O — kept out of the pure composeGen). Returns AppOverride | null.
function envResolveAppOverride(root) {
  for (const name of ["docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    let text; try { text = fs.readFileSync(p, "utf8"); } catch { return null; }
    try { return extractAppOverride(text); } catch { return null; }
  }
  return null;
}

// Deterministic compose-file renderer. Stable key order, no timestamps, no random — byte-identical
// across runs for the same services. (No `version:` key — modern compose infers it.)
function renderCompose(services) {
  const lines = ["services:"];
  for (const s of services) {
    lines.push(`  ${s.name}:`);
    if (s.built_from) {
      lines.push("    build:");
      lines.push(`      context: ${s.build_context || "."}`);   // relative; `env up` passes --project-directory <root>
      lines.push(`      dockerfile: ${s.built_from}`);
    } else {
      lines.push(`    image: ${s.image}`);
    }
    // FAFF-273: optional `command:` — some images (MinIO) refuse to boot without a server arg.
    // Only emitted when the datastore spec sets one, so every existing datastore stays byte-identical.
    if (s.command) lines.push(`    command: ${JSON.stringify(String(s.command))}`);
    if (s.ports && s.ports.length) {
      lines.push("    ports:");
      for (const p of s.ports) lines.push(`      - "${p}"`);
    }
    if (s.env && Object.keys(s.env).length) {
      lines.push("    environment:");
      for (const k of Object.keys(s.env)) lines.push(`      ${k}: ${JSON.stringify(String(s.env[k]))}`);
    }
    if (s.health_check && (s.health_check.raw_test != null || s.health_check.path)) {
      lines.push("    healthcheck:");
      if (s.health_check.raw_test != null) {
        // App reconciled from a repo compose: emit its healthcheck verbatim (list preserved as a
        // YAML flow list, string wrapped as CMD-SHELL). Never an unconditional curl probe.
        const rt = s.health_check.raw_test;
        if (Array.isArray(rt)) lines.push(`      test: ${JSON.stringify(rt.map(String))}`);
        else lines.push(`      test: ["CMD-SHELL", ${JSON.stringify(String(rt))}]`);
      } else {
        // No override: app keeps today's probe (byte-identical), datastores emit their probe verbatim.
        const probe = s.name === "app"
          ? `curl -fsS http://localhost:${ENV_APP_PORT}${s.health_check.path} || exit 1`
          : s.health_check.path;
        lines.push(`      test: ["CMD-SHELL", ${JSON.stringify(probe)}]`);
      }
      lines.push(`      interval: ${ENV_DEFAULT_POLL_SECS}s`);
      lines.push("      timeout: 5s");
      lines.push("      retries: 30");
    }
    // FAFF-303: long-form depends_on (the only shape that waits on health). Stable-ordered.
    if (s.depends_on && Object.keys(s.depends_on).length) {
      lines.push("    depends_on:");
      for (const dep of Object.keys(s.depends_on).sort()) {
        lines.push(`      ${dep}:`);
        lines.push(`        condition: ${s.depends_on[dep].condition || "service_started"}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

// FAFF-791: the base host is operator/transport-supplied and gets string-interpolated into
// evaluator-reachable endpoint URLs, so it is a trust boundary — validate it before resolving any
// surface, never pass it through. A bare host or IP only: no scheme, userinfo, path, query, fragment,
// or embedded port; an IPv6 literal must be bracketed ([::1]); non-empty. Returns null when valid, or
// a reason string. The default "localhost" passes trivially, so the default path is unaffected.
function envValidateBaseHost(host) {
  if (typeof host !== "string" || host.length === 0) return "must be a non-empty string";
  if (host.includes("://")) return "must not carry a scheme";
  if (host.includes("@")) return "must not carry userinfo";
  if (host.includes("/")) return "must not carry a path";
  if (host.includes("?")) return "must not carry a query";
  if (host.includes("#")) return "must not carry a fragment";
  if (host.startsWith("[")) {
    // bracketed IPv6 literal: only hex digits and colons inside, nothing after the closing bracket
    if (!/^\[[0-9A-Fa-f:]+\]$/.test(host)) return "malformed bracketed IPv6 literal";
    return null;
  }
  if (host.includes(":")) return "must not carry an embedded port (bracket IPv6 literals as [::1])";
  return null;
}

// FAFF-791: resolve a per-service relative surface (scheme, host-published port, path) against a base
// host into the absolute endpoint the handle carries. With base.host="localhost" and path="" this
// reproduces the pre-change inline strings exactly; a non-default base re-bases the same surface.
function envResolveEndpoint(base, surface) {
  return `${surface.scheme}://${base.host}:${surface.port}${surface.path}`;
}

// PURE: (profile, projectName, outPath) → { plan, compose }. No docker, no I/O. Deterministic.
// Maps profile.datastores via DATASTORE_TABLE; an unknown kind is REPORTED in unprovisionable[]
// (the producer fails loud), never silently skipped. sqlite is file-based: a seed target, no service.
function composeGen(profile, projectName, outPath, appOverride = null, base = { host: "localhost" }) {
  const datastores = Array.isArray(profile && profile.datastores) ? profile.datastores : [];
  const deployTargets = Array.isArray(profile && profile.deploy_targets) ? profile.deploy_targets : [];
  // FAFF-303: per-kind repo datastore env to reconcile onto the generated datastore service.
  // {} when there is no repo compose (appOverride null) → merge is a no-op → byte-identical.
  const dbEnv = (appOverride && appOverride.db_env) || {};
  const services = [], seed_targets = [], unprovisionable = [], notes = [];
  for (const ds of datastores) {
    const rawKind = ds && typeof ds.kind === "string" ? ds.kind : "";
    // FAFF-273: `s3` is an alias for the MinIO S3-compatible store; provision it as `minio`.
    const kind = rawKind === "s3" ? "minio" : rawKind;
    const spec = DATASTORE_TABLE[kind];
    if (!spec) { unprovisionable.push(rawKind || JSON.stringify(ds)); continue; }
    if (spec.file_based) {
      seed_targets.push({ service: `${kind}-file`, strategy: "sql-load", kind, file_based: true });
      continue;
    }
    // default-then-repo: the repo's POSTGRES_USER/DB/PASSWORD (etc.) win, the trust default is
    // kept unless overridden, so the wired role+db are created and the app can still authenticate.
    const mergedEnv = { ...(spec.env || {}), ...(dbEnv[kind] || {}) };
    services.push({
      name: kind, image: spec.image, ports: [`${spec.port}:${spec.port}`],
      command: spec.command || null,                    // FAFF-273: threaded to renderCompose (MinIO needs a server arg)
      env: Object.keys(mergedEnv).length ? mergedEnv : null,
      health_check: { name: kind, path: spec.probe, expected_status: 0 },
    });
    seed_targets.push({ service: kind, strategy: spec.seed_strategy, kind, file_based: false });
    if (spec.seed_strategy === "mount") notes.push(`${kind} provisioned but unseeded (${spec.followup || "loader pending"})`);
  }
  const containerImage = deployTargets.find(d => d && d.kind === "container-image");
  if (containerImage) {
    const app = {
      name: "app", built_from: (typeof containerImage.evidence === "string" && containerImage.evidence) ? containerImage.evidence : "Dockerfile",
      ports: [`${ENV_APP_PORT}:${ENV_APP_PORT}`],
      health_check: { name: "app", path: "/health", expected_status: 200 },
    };
    // FAFF-303: when the repo ships its own compose, the real app contract (port, env, build
    // context/dockerfile, healthcheck) wins over the profile-shaped defaults. appOverride is null
    // when there is no repo compose, so this whole block is skipped and output stays byte-identical.
    if (appOverride) {
      if (appOverride.dockerfile) app.built_from = appOverride.dockerfile;
      if (appOverride.build_context) app.build_context = appOverride.build_context;
      if (Array.isArray(appOverride.ports) && appOverride.ports.length) app.ports = appOverride.ports;
      if (appOverride.environment && Object.keys(appOverride.environment).length) app.env = appOverride.environment;
      const hp = appOverride.health_path || "/health";
      app.health_check = (appOverride.healthcheck_test != null)
        ? { name: "app", path: hp, expected_status: 200, raw_test: appOverride.healthcheck_test }
        : { name: "app", path: hp, expected_status: 200, raw_test: envImageAwareProbe(profile, app.ports, hp) };
      // FAFF-303: order the app behind every generated datastore that has a healthcheck, so a
      // connect-at-boot app doesn't race the store. `services` holds only datastores here (app is
      // pushed below). Gated on appOverride → no depends_on when null → byte-identical.
      const deps = {};
      for (const s of services) if (s.health_check) deps[s.name] = { condition: "service_healthy" };
      if (Object.keys(deps).length) app.depends_on = deps;
    }
    services.push(app);
  }
  // FAFF-791: build a per-service RELATIVE surface (scheme, host-published port, path) and resolve it
  // against a base host that DEFAULTS to localhost. Under the default the resolved endpoints are
  // byte-identical to the pre-change inline strings; a transport can later inject a non-default base
  // to re-base the same surfaces off-host, with no change to the handle's shape.
  const baseErr = envValidateBaseHost(base && base.host);
  if (baseErr) throw new Error(`env compose-gen: invalid base.host — ${baseErr}`);
  const surfaces = services.map(s => ({
    service: s.name,
    // FAFF-273: the app and the S3-compatible store (minio) speak HTTP; other datastores are raw tcp.
    scheme: (s.name === "app" || s.name === "minio") ? "http" : "tcp",
    port: (s.ports[0] || "").split(":")[0],
    path: "",
  }));
  const endpoints = {};
  for (const surface of surfaces) endpoints[surface.service] = envResolveEndpoint(base, surface);
  // endpoint precedence: app → first non-file-based datastore → first file-based store (file path) → ""
  // (a file-based store is a local path, never routed through the resolver — see FAFF-791 scope).
  let endpoint = "";
  if (endpoints["app"]) endpoint = endpoints["app"];
  else if (services.length) endpoint = endpoints[services[0].name];
  else if (seed_targets.length) endpoint = `file://${path.join(path.dirname(outPath), seed_targets[0].service + ".sqlite")}`;
  const health_checks = services.map(s => s.health_check);
  const plan = { schema: 1, project_name: projectName, compose_file: outPath,
    services, surfaces, base, endpoint, endpoints, health_checks, seed_targets, unprovisionable, notes };
  return { plan, compose: renderCompose(services) };
}

function envDockerAvailable() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 30000 });
  return r.status === 0;
}

// FAFF-371: name the effective engine context in unreachable-engine errors, so a mis-set rootless
// socket path is diagnosable from the message alone. Never used to *resolve* an engine — every
// docker call inherits the ambient environment untouched (no fallback to the default socket).
function envEngineContext() {
  return process.env.DOCKER_HOST ? `DOCKER_HOST=${process.env.DOCKER_HOST}` : "default socket";
}

// FAFF-371: teardown resolves the same compose context `up` used when the default generated file
// exists (composeFile non-null); --remove-orphans covers a stale/other-project file at that path
// (label-scoped to the project, so it removes exactly what the -p-only form would have). No file →
// the label-based form, unchanged. Pure (argv only) so --selftest covers both shapes.
function envDownArgs(root, project, composeFile) {
  if (composeFile) return ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "down", "-v", "--remove-orphans"];
  return ["compose", "-p", project, "down", "-v"];
}

// Parse `docker compose ps --format json` (array OR newline-delimited objects).
function envParsePs(stdout) {
  const t = (stdout || "").trim();
  if (!t) return [];
  if (t[0] === "[") { try { return JSON.parse(t); } catch { return []; } }
  return t.split("\n").map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function envAllHealthy(stdout, plan) {
  const rows = envParsePs(stdout);
  if (!rows.length) return false;
  const byName = {};
  for (const r of rows) byName[r.Service || r.Name] = r;
  for (const s of plan.services) {
    const r = byName[s.name];
    if (!r) return false;
    const health = r.Health || "";
    const state = r.State || r.Status || "";
    if (health) { if (health !== "healthy") return false; }
    else if (!/running|up/i.test(state)) return false;
  }
  return true;
}

// Build portable INSERTs from realised per-entity JSON. All columns TEXT (a representative seed,
// not a schema migration); per-engine identifier quoting via `q`.
function envBuildSql(datasetDir, q) {
  if (!fs.existsSync(datasetDir)) return "";
  const files = fs.readdirSync(datasetDir).filter(f => f.endsWith(".json"));
  const stmts = [];
  for (const f of files) {
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(datasetDir, f), "utf8")); } catch { continue; }
    if (!Array.isArray(rows) || !rows.length) continue;
    const table = f.replace(/\.json$/, "");
    const cols = Object.keys(rows[0]);
    stmts.push(`CREATE TABLE IF NOT EXISTS ${q(table)} (${cols.map(c => `${q(c)} TEXT`).join(", ")});`);
    for (const row of rows) {
      const vals = cols.map(c => "'" + String(row[c] === null || row[c] === undefined ? "" : row[c]).replace(/'/g, "''") + "'");
      stmts.push(`INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${vals.join(", ")});`);
    }
  }
  return stmts.join("\n") + (stmts.length ? "\n" : "");
}

// Deliver the realised dataset into one sql-load target (postgres COPY-shaped via psql / mysql / sqlite file).
function envSqlLoad(root, project, target, datasetDir, composeFile) {
  if (target.kind === "sqlite") {
    const sql = envBuildSql(datasetDir, (s) => '"' + String(s).replace(/"/g, '""') + '"');
    if (!sql) return true;
    const dbPath = path.join(root, ".faff", "env", "sqlite", `${target.kind}.sqlite`);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const r = spawnSync("sqlite3", [dbPath], { input: sql, encoding: "utf8" });
    return r.status === 0;
  }
  if (target.kind === "postgres") {
    const sql = envBuildSql(datasetDir, (s) => '"' + String(s).replace(/"/g, '""') + '"');
    if (!sql) return true;
    const r = spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "exec", "-T",
      "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], { input: sql, encoding: "utf8" });
    return r.status === 0;
  }
  if (target.kind === "mysql") {
    const sql = envBuildSql(datasetDir, (s) => "`" + String(s).replace(/`/g, "``") + "`");
    if (!sql) return true;
    const r = spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "exec", "-T",
      "mysql", "mysql", "-uroot", "app"], { input: sql, encoding: "utf8" });
    return r.status === 0;
  }
  return false;
}

// Deliver the realised dataset into the provisioned mongo service: one collection per entity, each
// realised <entity>.json (a JSON array from `fixtures realise`) piped into `mongoimport --jsonArray`
// on stdin (--db app, matching the mysql precedent). Empty arrays are skipped; an empty/absent
// dataset dir is a no-op → true, mirroring envSqlLoad's "nothing to load" path. Returns true iff
// every non-empty import exited 0.
function envMongoImport(root, project, target, datasetDir, composeFile) {
  if (!fs.existsSync(datasetDir)) return true;
  const files = fs.readdirSync(datasetDir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(datasetDir, f), "utf8")); } catch { continue; }
    if (!Array.isArray(rows) || !rows.length) continue;          // skip empty arrays — nothing to import
    const collection = f.replace(/\.json$/, "");
    const r = spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "exec", "-T",
      "mongo", "mongoimport", "--db", "app", "--collection", collection, "--jsonArray", "--quiet"],
      { input: JSON.stringify(rows), encoding: "utf8" });
    if (r.status !== 0) return false;
  }
  return true;
}

// Deliver the realised dataset into the provisioned redis service via command-replay: one hash per
// entity row, key `<entity>:<id-or-index>`, fields = the row's columns, emitted as inline HSET
// commands and replayed on stdin through `redis-cli --pipe`. Empty arrays / zero-column rows are
// skipped; an empty/absent dataset dir is a no-op → true, mirroring envMongoImport. Returns true
// iff the pipe exited 0.
// NOTE (FAFF-271): the hash-per-row value shape is an autonomous modeling choice — redis has no
// single native shape (string-JSON / hash / sorted-set all defensible). The born-verifiable test
// only asserts a non-empty keyspace, so the exact scheme can be adjusted without breaking the DoD.
function envRedisLoad(root, project, target, datasetDir, composeFile) {
  if (!fs.existsSync(datasetDir)) return true;
  const files = fs.readdirSync(datasetDir).filter(f => f.endsWith(".json"));
  // inline-command double-quoting: redis parses \\, \", \n, \r, \t inside double quotes.
  const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
  const cmds = [];
  for (const f of files) {
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(datasetDir, f), "utf8")); } catch { continue; }
    if (!Array.isArray(rows) || !rows.length) continue;          // skip empty arrays — nothing to load
    const entity = f.replace(/\.json$/, "");
    rows.forEach((row, idx) => {
      const cols = Object.keys(row);
      if (!cols.length) return;                                  // HSET needs >=1 field/value pair
      const id = row.id === null || row.id === undefined ? idx : row.id;
      const pairs = cols.map(c => `${q(c)} ${q(row[c] === null || row[c] === undefined ? "" : row[c])}`).join(" ");
      cmds.push(`HSET ${q(`${entity}:${id}`)} ${pairs}`);
    });
  }
  if (!cmds.length) return true;                                 // nothing to load
  const r = spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", composeFile, "exec", "-T",
    "redis", "redis-cli", "--pipe"], { input: cmds.join("\n") + "\n", encoding: "utf8" });
  return r.status === 0;
}

// Deliver the realised dataset into the provisioned MinIO (S3-compatible) service via object-upload:
// bucket-per-entity, one object per row keyed `<id-or-index>.json`, body = the row JSON. Transport is a
// throwaway `minio/mc` client sidecar joined to the compose network (`<project>_default`) — the
// minio/minio server image is not a guaranteed `mc` host, so seeding runs from a dedicated client image
// (this is why an object store is its own slice). `mc mb --ignore-existing local/<entity>` creates the
// bucket, then one `mc pipe local/<entity>/<key>` per row streams the row JSON on stdin. Empty arrays are
// skipped; an empty/absent dataset dir is a no-op → true (mirrors envMongoImport/envRedisLoad). Returns
// true iff every bucket-create + object-put exited 0.
function envObjectUpload(root, project, target, datasetDir, composeFile) {
  if (!fs.existsSync(datasetDir)) return true;
  const files = fs.readdirSync(datasetDir).filter(f => f.endsWith(".json"));
  const network = `${project}_default`;
  // Dev/test throwaway creds (match DATASTORE_TABLE.minio env) — runtime-only, never persisted.
  const mcHost = "http://faffdev:faffdevsecret@minio:9000";
  const mc = (mcArgs, input) => spawnSync("docker", ["run", "--rm", "-i", "--network", network,
    "-e", `MC_HOST_local=${mcHost}`, "minio/mc", ...mcArgs],
    input === undefined ? { encoding: "utf8" } : { input, encoding: "utf8" });
  for (const f of files) {
    let rows; try { rows = JSON.parse(fs.readFileSync(path.join(datasetDir, f), "utf8")); } catch { continue; }
    if (!Array.isArray(rows) || !rows.length) continue;          // skip empty arrays — nothing to upload
    const entity = f.replace(/\.json$/, "");
    if (mc(["mb", "--ignore-existing", `local/${entity}`]).status !== 0) return false;
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const id = (row && row.id !== null && row.id !== undefined) ? row.id : idx;
      if (mc(["pipe", `local/${entity}/${id}.json`], JSON.stringify(row)).status !== 0) return false;
    }
  }
  return true;
}

function cmdEnv(args) {
  // FAFF-576: fail-closed flag gate — env reads a FIXED set of its own flags (it forwards
  // none to compose), so an unknown flag / missing value exits 2 here before any provisioning.
  const gate = parseArgs(args, ENV_SPEC);
  if (gate.errors.length) return usageError(gate.errors, "usage: faff env <compose-gen|up|seed|down> [--profile P] [--plan F] [--out O] [--manifest F] [--project P] [--poll-secs N] [--sla-secs N] [--root DIR]");
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else rest.push(args[i]);
  }
  root = root || findRoot();
  const cmd = rest[0];
  if (cmd === "--selftest" || rest.includes("--selftest")) return envSelftest();

  const flag = (name) => { const i = rest.indexOf(name); return i !== -1 ? rest[i + 1] : null; };

  const resolveProfile = (label) => {
    const pf = flag("--profile");
    if (pf) {
      let raw; try { raw = fs.readFileSync(pf, "utf8"); }
      catch { process.stderr.write(`faff env ${label}: cannot read --profile ${pf}\n`); return { err: 2 }; }
      try { return { profile: JSON.parse(raw) }; }
      catch { process.stderr.write(`faff env ${label}: malformed profile JSON in ${pf}\n`); return { err: 2 }; }
    }
    const profPath = path.join(root, ".faff", "infra-profile.json");
    if (!fs.existsSync(profPath)) {
      process.stderr.write(`faff env ${label}: no --profile and no .faff/infra-profile.json (run \`faff profile mine --json > .faff/infra-profile.json\`)\n`);
      return { err: 3 };
    }
    try { return { profile: JSON.parse(fs.readFileSync(profPath, "utf8")) }; }
    catch { process.stderr.write(`faff env ${label}: malformed .faff/infra-profile.json\n`); return { err: 2 }; }
  };
  const defaultProject = (profile) =>
    `faff-env-${envShortHash(JSON.stringify(profile.datastores || []) + JSON.stringify(profile.deploy_targets || []))}`;

  if (cmd === "compose-gen") {
    const r = resolveProfile("compose-gen");
    if (r.err) return r.err;
    const project = flag("--project") || defaultProject(r.profile);
    let out = flag("--out") || path.join(".faff", "env", "docker-compose.yml");
    if (!path.isAbsolute(out)) out = path.join(root, out);
    const { plan, compose } = composeGen(r.profile, project, out, envResolveAppOverride(root));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, compose);
    console.log(JSON.stringify(plan, null, 2));   // ProvisionPlan → stdout (producer / `env up` consume it)
    return 0;
  }

  if (cmd === "up") {
    let plan;
    const planFile = flag("--plan");
    if (planFile) {
      try { plan = JSON.parse(fs.readFileSync(planFile, "utf8")); }
      catch { process.stderr.write(`faff env up: cannot read --plan ${planFile}\n`); return 2; }
    } else {
      const r = resolveProfile("up");
      if (r.err) return r.err;
      const project = flag("--project") || defaultProject(r.profile);
      let out = path.join(root, ".faff", "env", "docker-compose.yml");
      const g = composeGen(r.profile, project, out, envResolveAppOverride(root));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, g.compose);
      plan = g.plan;
    }
    if (Array.isArray(plan.unprovisionable) && plan.unprovisionable.length) {
      process.stderr.write(`faff env up: unprovisionable datastore kind(s): ${plan.unprovisionable.join(", ")} — extend DATASTORE_TABLE\n`);
      return 1;
    }
    const project = flag("--project") || plan.project_name;
    if (!envDockerAvailable()) { process.stderr.write(`faff env up: docker unavailable (${envEngineContext()})\n`); return 1; }
    // FAFF-303: --project-directory <root> so a relative build `context: .` resolves to the repo root
    // (not the generated-compose dir, where no Dockerfile exists).
    const upr = spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", plan.compose_file, "up", "-d"],
      { encoding: "utf8", timeout: 5 * 60 * 1000 });
    if (upr.status !== 0) { process.stderr.write(`faff env up: docker compose up failed\n${upr.stderr || ""}`); return 1; }
    const slaSecs = parseInt(flag("--sla-secs") || ENV_DEFAULT_SLA_SECS, 10);
    const pollSecs = Math.max(1, parseInt(flag("--poll-secs") || ENV_DEFAULT_POLL_SECS, 10));
    const retries = Math.max(1, Math.ceil(slaSecs / pollSecs));
    let healthy = plan.services.length === 0;   // nothing to wait on (e.g. sqlite-only) = trivially up
    for (let i = 0; i < retries && !healthy; i++) {
      const ps = spawnSync("docker", ["compose", "--project-directory", root, "-p", project, "-f", plan.compose_file, "ps", "--format", "json"],
        { encoding: "utf8" });
      if (ps.status === 0 && envAllHealthy(ps.stdout, plan)) { healthy = true; break; }
      spawnSync("sleep", [String(pollSecs)]);
    }
    if (!healthy) { process.stderr.write("faff env up: health checks did not pass within SLA\n"); return 1; }
    console.log(`OK — env up (project ${project}); ${plan.services.length} service(s) healthy`);
    return 0;
  }

  if (cmd === "seed") {
    const seedReqErr = requireFlags(gate.values, ENV_SURFACE.subcommands.seed, "env", "seed");
    if (seedReqErr) { process.stderr.write(seedReqErr + " (the ProvisionPlan from compose-gen)\n"); return 2; }
    const planFile = flag("--plan");
    let plan;
    try { plan = JSON.parse(fs.readFileSync(planFile, "utf8")); }
    catch { process.stderr.write(`faff env seed: cannot read --plan ${planFile}\n`); return 2; }
    const datasetDir = path.join(root, ".faff", "fixtures", "dataset");
    const manifest = flag("--manifest");
    if (manifest) {
      const r = spawnSync(process.execPath, [ENTRYPOINT, "fixtures", "realise", "--file", manifest, "--out", datasetDir],
        { encoding: "utf8" });
      if (r.status !== 0) { process.stderr.write(`faff env seed: fixtures realise failed\n${r.stderr || ""}`); return 1; }
    }
    const project = flag("--project") || plan.project_name;
    const needsDocker = (plan.seed_targets || []).some(t => t.strategy === "command-replay" || t.strategy === "object-upload" || (t.strategy === "sql-load" && t.kind !== "sqlite") || t.strategy === "mongoimport");
    if (needsDocker && !envDockerAvailable()) { process.stderr.write(`faff env seed: docker unavailable (${envEngineContext()})\n`); return 1; }
    let errored = false;
    for (const t of (plan.seed_targets || [])) {
      if (t.strategy === "sql-load") {
        if (!envSqlLoad(root, project, t, datasetDir, plan.compose_file)) {
          errored = true; process.stderr.write(`faff env seed: sql-load failed for ${t.kind}\n`);
        }
      } else if (t.strategy === "mongoimport") {
        if (!envMongoImport(root, project, t, datasetDir, plan.compose_file)) {
          errored = true; process.stderr.write(`faff env seed: mongoimport failed for ${t.kind}\n`);
        }
      } else if (t.strategy === "command-replay") {
        if (!envRedisLoad(root, project, t, datasetDir, plan.compose_file)) {
          errored = true; process.stderr.write(`faff env seed: command-replay failed for ${t.kind}\n`);
        }
      } else if (t.strategy === "object-upload") {
        if (!envObjectUpload(root, project, t, datasetDir, plan.compose_file)) {
          errored = true; process.stderr.write(`faff env seed: object-upload failed for ${t.kind}\n`);
        }
      } else if (t.strategy === "mount") {
        console.log(`note — ${t.kind}: dataset mounted, not imported (loader pending)`);
      }
    }
    if (errored) return 1;
    console.log(`OK — env seed (project ${project})`);
    return 0;
  }

  if (cmd === "down") {
    const downReqErr = requireFlags(gate.values, ENV_SURFACE.subcommands.down, "env", "down");
    if (downReqErr) { process.stderr.write(downReqErr + "\n"); return 2; }
    const project = flag("--project");
    if (!envDockerAvailable()) { console.log(`OK — env down (project ${project}); docker unavailable (${envEngineContext()}), nothing to tear down`); return 0; }
    const defaultCompose = path.join(root, ".faff", "env", "docker-compose.yml");
    spawnSync("docker", envDownArgs(root, project, fs.existsSync(defaultCompose) ? defaultCompose : null), { encoding: "utf8", timeout: 2 * 60 * 1000 });
    console.log(`OK — env down (project ${project})`);   // idempotent: down of an absent project is success
    return 0;
  }

  process.stderr.write("faff env: expected one of compose-gen | up | seed | down (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure compose-gen core (no docker). Mirrors the profile/fixtures style.
function envSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`env --selftest FAIL: ${label}\n`); failed++; } };

  const p1 = { datastores: [{ kind: "postgres", evidence: "docker-compose.yml" }], deploy_targets: [{ kind: "container-image", evidence: "Dockerfile" }] };
  const r1 = composeGen(p1, "proj1", "/tmp/x/docker-compose.yml");
  check("pg+app: 2 services", r1.plan.services.length === 2);
  check("pg+app: app built_from Dockerfile", r1.plan.services.some(s => s.name === "app" && s.built_from === "Dockerfile"));
  check("pg+app: postgres sql-load target", r1.plan.seed_targets.some(t => t.kind === "postgres" && t.strategy === "sql-load"));
  check("pg+app: empty unprovisionable", r1.plan.unprovisionable.length === 0);
  check("pg+app: health_checks non-empty", r1.plan.health_checks.length === 2);
  check("pg+app: endpoint is app", r1.plan.endpoint === r1.plan.endpoints["app"]);

  const r1b = composeGen(p1, "proj1", "/tmp/x/docker-compose.yml");
  check("determinism: compose byte-identical", r1.compose === r1b.compose);
  check("determinism: plan identical", JSON.stringify(r1.plan) === JSON.stringify(r1b.plan));

  const r3 = composeGen({ datastores: [{ kind: "cassandra", evidence: "x" }], deploy_targets: [] }, "p3", "/tmp/x/dc.yml");
  check("unknown: cassandra → unprovisionable", r3.plan.unprovisionable.includes("cassandra"));
  check("unknown: no cassandra service", !r3.plan.services.some(s => s.name === "cassandra"));

  const r4 = composeGen({ datastores: [{ kind: "sqlite", evidence: "x" }], deploy_targets: [] }, "p4", "/tmp/x/dc.yml");
  check("sqlite: file_based seed target", r4.plan.seed_targets.some(t => t.kind === "sqlite" && t.file_based === true));
  check("sqlite: no sqlite service", !r4.plan.services.some(s => s.name === "sqlite"));

  const r5 = composeGen({ datastores: [{ kind: "redis", evidence: "x" }], deploy_targets: [] }, "p5", "/tmp/x/dc.yml");
  check("redis: has service", r5.plan.services.some(s => s.name === "redis"));
  check("redis: command-replay seed strategy (not mount)", r5.plan.seed_targets.some(t => t.kind === "redis" && t.strategy === "command-replay"));
  check("redis: no unseeded note", !r5.plan.notes.some(n => /redis/.test(n)));
  check("endpoint: first datastore when no app", r5.plan.endpoint === r5.plan.endpoints["redis"]);

  const r5b = composeGen({ datastores: [{ kind: "mongo", evidence: "x" }], deploy_targets: [] }, "p5b", "/tmp/x/dc.yml");
  check("mongo: has service", r5b.plan.services.some(s => s.name === "mongo"));
  check("mongo: mongoimport seed strategy (not mount)", r5b.plan.seed_targets.some(t => t.kind === "mongo" && t.strategy === "mongoimport"));
  check("mongo: no unseeded note", !r5b.plan.notes.some(n => /mongo/.test(n)));

  // FAFF-273 — S3-compatible object store (MinIO): provision row + object-upload seed + command: line.
  const r5c = composeGen({ datastores: [{ kind: "minio", evidence: "x" }], deploy_targets: [] }, "p5c", "/tmp/x/dc.yml");
  check("minio: has service (minio/minio)", r5c.plan.services.some(s => s.name === "minio" && s.image === "minio/minio"));
  check("minio: object-upload seed strategy (not mount)", r5c.plan.seed_targets.some(t => t.kind === "minio" && t.strategy === "object-upload"));
  check("minio: no unseeded note", !r5c.plan.notes.some(n => /minio/.test(n)));
  check("minio: empty unprovisionable", r5c.plan.unprovisionable.length === 0);
  check("minio: command: server /data emitted in compose", /command: "server \/data --console-address :9001"/.test(r5c.compose));
  check("minio: http endpoint (S3 API, not tcp)", r5c.plan.endpoints.minio === "http://localhost:9000");
  // `s3` is an alias for the MinIO store — provisions as `minio`, no unprovisionable entry.
  const r5d = composeGen({ datastores: [{ kind: "s3", evidence: "x" }], deploy_targets: [] }, "p5d", "/tmp/x/dc.yml");
  check("s3 alias: provisions minio service", r5d.plan.services.some(s => s.name === "minio"));
  check("s3 alias: empty unprovisionable", r5d.plan.unprovisionable.length === 0);
  // The command: line is opt-in — a datastore without a `command` (postgres) never emits one.
  check("no command: for postgres (byte-identical)", !/command:/.test(r1.compose));

  const r6 = composeGen({ datastores: [{ kind: "mysql", evidence: "x" }, { kind: "sqlite", evidence: "y" }], deploy_targets: [] }, "p6", "/tmp/x/dc.yml");
  check("mixed: mysql service + sqlite file target", r6.plan.services.some(s => s.name === "mysql") && r6.plan.seed_targets.some(t => t.kind === "sqlite"));

  // FAFF-303 — app-tier reconciliation against a repo compose (pure cases).
  // (a) appOverride null ⇒ byte-identical to the no-override pg+app render.
  const rNull = composeGen(p1, "proj1", "/tmp/x/docker-compose.yml", null);
  check("override: null ⇒ byte-identical to no-arg", rNull.compose === r1.compose);
  check("override: null ⇒ app keeps curl/:8080 default", /curl -fsS http:\/\/localhost:8080\/health/.test(rNull.compose));

  // (b) an override with port 3000 / env / verbatim healthcheck ⇒ all three reflected, no curl.
  const ov = {
    build_context: ".", dockerfile: "Dockerfile", ports: ["3000:3000"],
    environment: { DATABASE_URL: "postgres://postgres@postgres:5432/app" },
    healthcheck_test: ["CMD-SHELL", "wget -qO- http://localhost:3000/healthz || exit 1"],
    health_path: "/healthz", app_service_name: "api", db_service_renames: { db: "postgres" },
  };
  const rOv = composeGen(p1, "proj1", "/tmp/x/docker-compose.yml", ov);
  const appOv = rOv.plan.services.find(s => s.name === "app");
  check("override: app port from repo (3000)", appOv.ports[0] === "3000:3000");
  check("override: app endpoint host-port 3000", rOv.plan.endpoints.app === "http://localhost:3000");
  check("override: DATABASE_URL wired into app env", appOv.env && appOv.env.DATABASE_URL === "postgres://postgres@postgres:5432/app");
  check("override: healthcheck verbatim, no curl", /wget -qO- http:\/\/localhost:3000\/healthz/.test(rOv.compose) && !/curl/.test(rOv.compose));

  // (b') no repo healthcheck on a node runtime ⇒ synthesized node http probe, never curl.
  const ovNoHc = { build_context: ".", dockerfile: "Dockerfile", ports: ["3000:3000"], environment: {}, healthcheck_test: null, health_path: null, app_service_name: "api", db_service_renames: {} };
  const rNoHc = composeGen({ datastores: [], deploy_targets: [{ kind: "container-image", evidence: "Dockerfile" }], runtimes: [{ name: "node", version: "20" }] }, "pn", "/tmp/x/dc.yml", ovNoHc);
  check("override: no-hc node ⇒ node http probe", /node -e .*require\('http'\)/.test(rNoHc.compose) && !/curl/.test(rNoHc.compose));

  // (c) the extractor lifts the app contract from real compose text + realigns the DB host.
  const composeText = [
    "services:",
    "  api:",
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile",
    "    ports:",
    '      - "3000:3000"',
    "    environment:",
    "      - DATABASE_URL=postgres://postgres@db:5432/app",
    "    healthcheck:",
    '      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/healthz || exit 1"]',
    "  db:",
    "    image: postgres:16-alpine",
  ].join("\n");
  const ex = extractAppOverride(composeText);
  check("extract: single buildable app found", ex && ex.app_service_name === "api");
  check("extract: ports normalised", ex && ex.ports[0] === "3000:3000");
  check("extract: db-host realigned db→postgres", ex && ex.environment.DATABASE_URL === "postgres://postgres@postgres:5432/app");
  check("extract: healthcheck.test verbatim list", ex && Array.isArray(ex.healthcheck_test) && /healthz/.test(ex.healthcheck_test.join(" ")));
  check("extract: db rename mapped", ex && ex.db_service_renames.db === "postgres");

  // (c') two buildable apps ⇒ out of scope ⇒ null (profile fallback, no crash).
  const multiApp = ["services:", "  a:", "    build: .", "  b:", "    build: ."].join("\n");
  check("extract: 0/≥2 buildable apps ⇒ null", extractAppOverride(multiApp) === null);
  check("extract: unparseable ⇒ null", extractAppOverride("\t- not: valid\nflow: {a: 1}") === null);

  // FAFF-303 (rev 2) — DB-tier auth-env reconcile + service ordering (pure cases).
  // (d) db_env lifts the repo postgres auth vars onto the generated postgres service, merged over trust.
  const ovDb = {
    build_context: ".", dockerfile: "Dockerfile", ports: ["3000:3000"],
    environment: { DATABASE_URL: "postgres://linkshortener:pw@postgres:5432/linkshortener" },
    healthcheck_test: ["CMD-SHELL", "wget -qO- http://localhost:3000/healthz || exit 1"],
    health_path: "/healthz", app_service_name: "api", db_service_renames: { db: "postgres" },
    db_env: { postgres: { POSTGRES_USER: "linkshortener", POSTGRES_DB: "linkshortener", POSTGRES_PASSWORD: "pw" } },
  };
  const rDb = composeGen(p1, "projdb", "/tmp/x/dc.yml", ovDb);
  const pgSvc = rDb.plan.services.find(s => s.name === "postgres");
  check("db-env: postgres carries repo POSTGRES_USER", pgSvc.env && pgSvc.env.POSTGRES_USER === "linkshortener");
  check("db-env: postgres carries repo POSTGRES_DB", pgSvc.env && pgSvc.env.POSTGRES_DB === "linkshortener");
  check("db-env: postgres carries repo POSTGRES_PASSWORD", pgSvc.env && pgSvc.env.POSTGRES_PASSWORD === "pw");
  check("db-env: trust default kept (merged, not replaced)", pgSvc.env && pgSvc.env.POSTGRES_HOST_AUTH_METHOD === "trust");
  check("db-env: rendered postgres environment carries POSTGRES_DB", /POSTGRES_DB/.test(rDb.compose));

  // (e) the same override ⇒ the app is ordered behind postgres with a service_healthy condition.
  const appDb = rDb.plan.services.find(s => s.name === "app");
  check("ordering: app depends_on postgres (service_healthy)", appDb.depends_on && appDb.depends_on.postgres && appDb.depends_on.postgres.condition === "service_healthy");
  check("ordering: rendered long-form depends_on", /depends_on:\n      postgres:\n        condition: service_healthy/.test(rDb.compose));

  // (f) appOverride null ⇒ no depends_on, postgres env is the bare trust default (byte-identical pin).
  const appNull = rNull.plan.services.find(s => s.name === "app");
  check("ordering: null ⇒ app has no depends_on", !appNull.depends_on);
  check("ordering: null ⇒ no depends_on in compose", !/depends_on:/.test(rNull.compose));
  const pgNull = rNull.plan.services.find(s => s.name === "postgres");
  check("db-env: null ⇒ postgres env is bare trust", JSON.stringify(pgNull.env) === JSON.stringify({ POSTGRES_HOST_AUTH_METHOD: "trust" }));

  // (g) the extractor lifts the repo datastore service's env into db_env keyed by generated kind.
  const composeTextDb = [
    "services:",
    "  api:",
    "    build: .",
    "    environment:",
    "      - DATABASE_URL=postgres://linkshortener:pw@db:5432/linkshortener",
    "  db:",
    "    image: postgres:16-alpine",
    "    environment:",
    "      POSTGRES_USER: linkshortener",
    "      POSTGRES_DB: linkshortener",
    "      POSTGRES_PASSWORD: pw",
  ].join("\n");
  const exDb = extractAppOverride(composeTextDb);
  check("extract: db_env keyed by generated kind (postgres)", exDb && exDb.db_env.postgres && exDb.db_env.postgres.POSTGRES_USER === "linkshortener");
  check("extract: db_env captures POSTGRES_DB", exDb && exDb.db_env.postgres.POSTGRES_DB === "linkshortener");

  // FAFF-791 — location-independent endpoint surface: base host resolved at compose-gen (default localhost).
  // (a) default base ⇒ endpoints byte-identical to the pre-change inline strings; plan carries surfaces + base.
  const r791def = composeGen(p1, "proj791", "/tmp/x/dc.yml", ov);
  check("base791: default endpoints[app] localhost byte-identical", r791def.plan.endpoints.app === "http://localhost:3000");
  check("base791: default endpoints[postgres] tcp localhost byte-identical", r791def.plan.endpoints.postgres === "tcp://localhost:5432");
  check("base791: plan carries resolved base.host localhost", r791def.plan.base && r791def.plan.base.host === "localhost");
  check("base791: plan carries per-service surface (app http/3000, no path)",
    r791def.plan.surfaces.some(s => s.service === "app" && s.scheme === "http" && s.port === "3000" && s.path === ""));
  check("base791: explicit localhost base ⇒ byte-identical plan to the default",
    JSON.stringify(composeGen(p1, "proj791", "/tmp/x/dc.yml", ov, { host: "localhost" }).plan) === JSON.stringify(r791def.plan));

  // (b) a non-default base re-bases every service's endpoint; scheme + port unchanged.
  const r791reb = composeGen(p1, "proj791", "/tmp/x/dc.yml", ov, { host: "10.0.0.5" });
  check("base791: non-default re-bases app endpoint", r791reb.plan.endpoints.app === "http://10.0.0.5:3000");
  check("base791: non-default re-bases datastore endpoint (tcp scheme + port kept)", r791reb.plan.endpoints.postgres === "tcp://10.0.0.5:5432");
  check("base791: re-base swaps only the host (endpoints == default with host replaced)",
    JSON.stringify(r791reb.plan.endpoints) === JSON.stringify(r791def.plan.endpoints).split("localhost").join("10.0.0.5"));
  check("base791: bracketed IPv6 literal re-bases app endpoint", composeGen(p1, "proj791", "/tmp/x/dc.yml", ov, { host: "[::1]" }).plan.endpoints.app === "http://[::1]:3000");

  // (c) a malformed base fails loud (throws) before any endpoint is resolved — no half-formed URL emitted.
  for (const bad of ["http://evil/", "1.2.3.4/admin", "user@host", "host:8080", "", "a?b", "a#b", "[:::]x"]) {
    let threw = false, planLeaked = null;
    try { planLeaked = composeGen(p1, "proj791", "/tmp/x/dc.yml", ov, { host: bad }); } catch { threw = true; }
    check(`base791: malformed base.host ${JSON.stringify(bad)} fails loud`, threw && planLeaked === null);
  }

  // FAFF-371 — bounded-engine hardenings (pure cases).
  // (h) down argv: default compose file present ⇒ full compose context + --remove-orphans.
  const dArgs = envDownArgs("/r", "proj", "/r/.faff/env/docker-compose.yml");
  check("down argv: -f form carries --project-directory + -f + --remove-orphans",
    JSON.stringify(dArgs) === JSON.stringify(["compose", "--project-directory", "/r", "-p", "proj", "-f", "/r/.faff/env/docker-compose.yml", "down", "-v", "--remove-orphans"]));
  // (h') no default file ⇒ the label-based -p-only form, unchanged.
  check("down argv: no default file ⇒ -p-only fallback",
    JSON.stringify(envDownArgs("/r", "proj", null)) === JSON.stringify(["compose", "-p", "proj", "down", "-v"]));
  // (i) engine context naming: DOCKER_HOST echoed when set, "default socket" when not.
  const prevDockerHost = process.env.DOCKER_HOST;
  process.env.DOCKER_HOST = "unix:///tmp/faff371.sock";
  check("engine context: names DOCKER_HOST when set", envEngineContext() === "DOCKER_HOST=unix:///tmp/faff371.sock");
  delete process.env.DOCKER_HOST;
  check("engine context: default socket when unset", envEngineContext() === "default socket");
  if (prevDockerHost !== undefined) process.env.DOCKER_HOST = prevDockerHost;

  if (failed) return 1;
  console.log("env --selftest: ok");
  return 0;
}


module.exports = { DATASTORE_TABLE, ENV_APP_PORT, ENV_DEFAULT_POLL_SECS, ENV_DEFAULT_SLA_SECS, ENV_SPEC, ENV_SURFACE, cmdEnv, composeGen, envAllHealthy, envBuildSql, envDatastoreKindForImage, envDockerAvailable, envDownArgs, envEngineContext, envImageAwareProbe, envMongoImport, envObjectUpload, envParsePs, envRedisLoad, envResolveAppOverride, envSelftest, envShortHash, envSqlLoad, escapeRegExp, extractAppOverride, healthPathFromTest, normaliseEnv, normalisePorts, parseComposeSubset, parseFlowSeq, realignDbHost, renderCompose, stripYamlInlineComment };
