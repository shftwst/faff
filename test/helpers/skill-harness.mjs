// FAFF-93 — Skill-run harness: drive a skill in test mode, capture decisions.
//
// The runner that composes the two halves of the deterministic test substrate —
// FAFF-89's mock-tracker (`./mock-tracker.mjs`) and FAFF-90's seeded repo
// (`./seed-repo.mjs`) — injects them into a "skill run", drives the skill, and
// captures its decisions at the deterministic seams into a structured, frozen
// DecisionRecord. That record is the explicit FAFF-93 -> FAFF-95 contract.
//
// Design (per the FAFF-93 spec + ADR 0002):
//   - Driver-agnostic: a skill is driven through a small SkillDriver interface.
//     The default `scriptedDriver` (a deterministic replay of a fixed seam script)
//     is the sole CI-gating path — no LLM, no network, no key, no clock. A live
//     driver (FAFF-122 spike) is a future occupant of the same interface and
//     produces the SAME record shape.
//   - Capture binds to seams, never to prose: CLI calls, tracker reads served,
//     tracker mutations ATTEMPTED, routing verdicts, bucket membership, rendering
//     invocations. No free-text reasoning is ever an assertable field.
//   - One unified seamLog is the source of truth; the typed lists (trackerReads,
//     mutations, cliCalls, verdicts, renderings) and the buckets map are VIEWS over
//     it, so cross-seam ordering (CLI-before-verdict, read-before-bucket) is always
//     recoverable. `seq` is the only ordering authority.
//   - Mutations are recorded as ATTEMPTS, not applied: the FAFF-89 model is read-only
//     by its own spec, and ADR 0002 asserts mutations at the attempt seam.
//   - Granularity is ids/counts/surface, not full entity bodies (those live in the
//     fixture / FAFF-96 goldens).
//   - The harness records decisions but asserts NONE and holds no ordering/priority
//     opinion — that is FAFF-95 / the methodology. It is a recorder, not a judge.
//   - Zero-dependency: node:* + the sibling helpers only.

import { runCli } from "./run-cli.mjs";

/** Thrown for harness/driver misuse (unknown tracker method, malformed action). Fail loud. */
export class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = "HarnessError";
  }
}

// The FAFF-89 model's read surface. A driver may only read through these.
const READ_METHODS = new Set([
  "listIssues",
  "getIssue",
  "listProjects",
  "getProject",
  "listInitiatives",
  "listLabels",
  "listComments",
]);

// Adapt the record's uniform args-object to the FAFF-89 model's positional signatures,
// so `ctx.tracker[method](args)` is uniform for both the scripted and any future live
// driver while the underlying model keeps its native call shape.
function callModel(model, method, args) {
  switch (method) {
    case "listIssues":
      return model.listIssues(args ?? {});
    case "getIssue":
      return model.getIssue(args?.id);
    case "listProjects":
      return model.listProjects(args ?? {});
    case "getProject":
      return model.getProject(args?.id);
    case "listInitiatives":
      return model.listInitiatives();
    case "listLabels":
      return model.listLabels();
    case "listComments":
      return model.listComments(args?.issueId);
    default:
      // Unreachable from the port (it only wires READ_METHODS); defensive.
      throw new HarnessError(`unknown tracker read method: ${JSON.stringify(method)}`);
  }
}

// resultCount records "number of entities returned" — not the bodies. A list -> its
// length; a single get -> 1 when present, 0 when null.
function resultCount(result) {
  if (Array.isArray(result)) return result.length;
  return result == null ? 0 : 1;
}

/**
 * The seq/seamLog authority. Every seam gets a single monotonic `seq` pushed onto one
 * log; the typed lists and the buckets map are filtered views built at assemble time.
 * FAFF-95 may reuse this.
 * @returns {object} a Recorder.
 */
export function makeRecorder() {
  const seamLog = [];
  let seq = 0;

  // Push one seam; the payload carries its own `seq` (so a typed-view entry is
  // self-describing) and the SeamEvent carries {seq, kind, payload}.
  const push = (kind, fields) => {
    const payload = { seq, ...fields };
    seamLog.push({ seq, kind, payload });
    seq += 1;
    return payload;
  };

  const recordRead = (method, args, count) =>
    push("trackerRead", { method, args: args ?? {}, resultCount: count });
  const recordMutation = (op, issue = null, args = {}) =>
    push("mutation", { op, issue: issue ?? null, args: args ?? {} });
  const recordCli = (argv, stdout, exit) =>
    push("cliCall", { argv, stdout, exit });
  const recordVerdict = (issue, token, source) =>
    push("verdict", { issue, token, source });
  const recordBucket = (name, issues) =>
    push("bucket", { name, issues });
  // FAFF-97: `routes` (optional) names the emit/write this render is the final
  // normalise pass for, so a routing matcher can bind render->emit mechanically.
  // Omitted from the payload when undefined, so the {seq, surface} shape is unchanged
  // for the common (terminal) case — back-compat with existing rendering assertions.
  const recordRendering = (surface, routes) =>
    push("rendering", routes === undefined ? { surface } : { surface, routes });

  const assemble = (skill, driverKind) => {
    const view = (kind) => seamLog.filter((e) => e.kind === kind).map((e) => e.payload);
    const buckets = {};
    for (const e of seamLog) {
      if (e.kind === "bucket") buckets[e.payload.name] = e.payload.issues;
    }
    return {
      skill,
      driver: driverKind,
      trackerReads: view("trackerRead"),
      mutations: view("mutation"),
      cliCalls: view("cliCall"),
      verdicts: view("verdict"),
      buckets,
      renderings: view("rendering"),
      seamLog,
    };
  };

  return {
    recordRead,
    recordMutation,
    recordCli,
    recordVerdict,
    recordBucket,
    recordRendering,
    assemble,
    // The subset a driver sees as ctx.record (reads/CLI flow through ctx.tracker/ctx.cli).
    publicApi() {
      return { recordMutation, recordVerdict, recordBucket, recordRendering };
    },
  };
}

// The injected agent<->MCP boundary: reads delegate to the FAFF-89 model AND record a
// TrackerRead; writes ONLY record a Mutation (never applied). Unknown method names fail
// loud as a HarnessError when called (a Proxy stands in for the live MCP's open surface).
function makeTrackerPort(model, recorder) {
  const base = {};
  for (const method of READ_METHODS) {
    base[method] = (args = {}) => {
      const result = callModel(model, method, args);
      recorder.recordRead(method, args, resultCount(result));
      return result;
    };
  }
  // Attempted writes — recorded at the seam, not applied to the read-only model.
  base.setStatus = (issue, args = {}) => recorder.recordMutation("setStatus", issue, args);
  base.addLabel = (issue, args = {}) => recorder.recordMutation("addLabel", issue, args);
  base.removeLabel = (issue, args = {}) => recorder.recordMutation("removeLabel", issue, args);
  base.addComment = (issue, args = {}) => recorder.recordMutation("addComment", issue, args);
  base.createIssue = (args = {}) => recorder.recordMutation("createIssue", null, args);

  return new Proxy(base, {
    get(target, prop) {
      if (prop in target || typeof prop === "symbol") return target[prop];
      // Unknown method: return a thunk that fails loud when the driver calls it.
      return () => {
        throw new HarnessError(`unknown tracker method: ${JSON.stringify(String(prop))}`);
      };
    },
  });
}

/**
 * The default, deterministic driver: replay a fixed list of seam actions against the
 * injected context. No LLM, no network, no clock/random — the sole CI-gating path.
 * @param {Array<object>} script ordered list of ScriptActions (tagged unions).
 * @returns {{kind: "scripted", drive: (ctx: object) => void}}
 */
export function scriptedDriver(script) {
  if (!Array.isArray(script)) {
    throw new HarnessError("scriptedDriver: script must be an array of actions");
  }
  return {
    kind: "scripted",
    drive(ctx) {
      for (const action of script) {
        if (action == null || typeof action !== "object") {
          throw new HarnessError(`scriptedDriver: malformed action ${JSON.stringify(action)}`);
        }
        if ("read" in action) {
          const { method, args = {} } = action.read;
          ctx.tracker[method](args);
        } else if ("cli" in action) {
          ctx.cli(action.cli);
        } else if ("mutate" in action) {
          const { op, issue = null, args = {} } = action.mutate;
          ctx.record.recordMutation(op, issue, args);
        } else if ("verdict" in action) {
          const { issue, token, source } = action.verdict;
          ctx.record.recordVerdict(issue, token, source);
        } else if ("bucket" in action) {
          const { name, issues } = action.bucket;
          ctx.record.recordBucket(name, issues);
        } else if ("render" in action) {
          const { surface, routes } = action.render;
          ctx.record.recordRendering(surface, routes);
        } else {
          throw new HarnessError(
            `scriptedDriver: unknown action kind in ${JSON.stringify(action)}`,
          );
        }
      }
    },
  };
}

/**
 * Drive a skill against the substrate and return the captured DecisionRecord.
 *
 * Wires the tracker port (reads -> config.tracker; writes -> recorded mutations) and the
 * CLI seam (cwd/--root -> config.repo.root), invokes config.driver with that injected
 * context, then returns the assembled, frozen DecisionRecord. Synchronous for a sync
 * driver; returns a Promise when the driver's drive() is async.
 *
 * @param {object} config { skill, tracker, repo, driver?, flags? }
 *   - skill: string identifying the driven skill (provenance).
 *   - tracker: a loaded FAFF-89 model (loadFixture(...)).
 *   - repo: a FAFF-90 seedRepo(...) result ({ root, worktreePath, teardown }).
 *   - driver: a SkillDriver; defaults to an empty scripted driver.
 *   - flags: optional, skill-specific, opaque to the harness.
 * @returns {object|Promise<object>} a frozen DecisionRecord.
 */
export function runSkill(config) {
  if (config == null || typeof config !== "object") {
    throw new HarnessError("runSkill: config object is required");
  }
  const { skill, tracker, repo, driver = scriptedDriver([]), flags } = config;
  if (tracker == null || typeof tracker.listIssues !== "function") {
    throw new HarnessError("runSkill: config.tracker must be a loaded FAFF-89 model");
  }
  if (repo == null || typeof repo.root !== "string") {
    throw new HarnessError("runSkill: config.repo must be a FAFF-90 seedRepo result");
  }
  if (driver == null || typeof driver.drive !== "function") {
    throw new HarnessError("runSkill: config.driver must implement drive(ctx)");
  }

  const recorder = makeRecorder();
  const trackerPort = makeTrackerPort(tracker, recorder);
  const cli = (argv) => {
    const r = runCli(argv, { cwd: repo.root });
    recorder.recordCli(argv, r.stdout, r.code); // map runCli's `code` -> the record's `exit`
    return r;
  };
  const ctx = {
    tracker: trackerPort,
    cli,
    record: recorder.publicApi(),
    config: { skill, flags },
  };

  const driverKind = driver.kind === "live" ? "live" : "scripted";
  const result = driver.drive(ctx);
  if (result != null && typeof result.then === "function") {
    return result.then(() => Object.freeze(recorder.assemble(skill, driverKind)));
  }
  return Object.freeze(recorder.assemble(skill, driverKind));
}
