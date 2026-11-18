// === region:factory — classify a complete batch of supplied issue observations ===
const { parseArgs, usageError } = require("./argv");
const { readStdinCapped, VALIDATE_MAX_BYTES } = require("./ratified-scope");

type Row = Record<string, unknown>;
type Id = string | number;
type Source = "github" | "linear";
const usage = "usage: faff tracker facts --source linear|github < batch.json";
const spec = { flags: { "--source": { arity: 1, enum: ["linear", "github"] } }, positionals: { max: 0 } };

function record(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function id(value: unknown): Id {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error("use a nonempty string or safe integer ID consistently across issues, edges and queue");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function archived(row: Row): boolean {
  return row.archived === true || !!text(row.archivedAt ?? row.archived_at);
}

function linear(row: Row) {
  const state = row.state ?? row.status;
  const category = text(record(state) ? state.type ?? state.stateCategory : undefined) || text(row.stateCategory ?? row.statusType);
  const name = text(record(state) ? state.name : state);
  if (category) return { cancelled: ["canceled","cancelled"].includes(category), done: category === "completed" };
  return { cancelled: ["canceled","cancelled","duplicate","won't fix"].includes(name), done: name === "done" };
}

function github(row: Row) {
  const closed = text(row.state) === "closed";
  const reason = text(row.state_reason ?? row.stateReason);
  const pr = record(row.pull_request) ? row.pull_request : row;
  const merged = text(row.state) === "merged" || pr.merged === true || !!text(pr.merged_at ?? pr.mergedAt);
  const cancelled = closed && reason === "not_planned";
  if (merged && cancelled) throw new Error("conflicting merge and closure observations");
  return { cancelled, done: merged || (closed && reason === "completed") };
}

function issueFacts(source: Source, batch: unknown) {
  if (!record(batch) || batch.complete !== true || !Array.isArray(batch.issues)) {
    throw new Error("expected complete:true and an issues array from a completed read");
  }
  const classify = source === "linear" ? linear : github;
  const seen = new Set<Id>();
  const done = new Set<Id>();
  const hidden = new Set<Id>();
  for (const issue of batch.issues) {
    if (!record(issue)) throw new Error("expected an issue object");
    const key = id(issue.id);
    if (seen.has(key)) throw new Error("duplicate issue ID " + key);
    seen.add(key);
    const status = classify(issue);
    const project = issue.project;
    if (project != null && !record(project)) throw new Error("supply project status as an object");
    if (archived(issue) || status.cancelled || (project && (archived(project) || project.cancelled === true || classify(project).cancelled))) {
      hidden.add(key);
    }
    if (status.done) done.add(key);
  }
  const edges = batch.edges === undefined ? [] : batch.edges;
  const queue = batch.queue === undefined ? [] : batch.queue;
  if (!Array.isArray(edges) || !Array.isArray(queue)) throw new Error("edges and queue must be arrays");
  const inQueue = new Set(queue.map(id));
  const blocked = new Set<Id>();
  const live_edges: [Id, Id][] = [];
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) throw new Error("expected [issue, blocker] edge");
    const from = id(edge[0]), target = id(edge[1]);
    if (!seen.has(from)) throw new Error("missing source issue for edge " + from);
    if (hidden.has(from) || done.has(target)) continue;
    live_edges.push([from, target]);
    if (!inQueue.has(target)) blocked.add(from);
  }
  return { hidden: [...hidden], done: [...done], live_edges, blocked: [...blocked] };
}

export function cmdIssueFacts(args: string[]): number {
  const { values, errors } = parseArgs(args, spec);
  if (errors.length || !values["--source"]) return usageError(errors, usage);
  try {
    const input = readStdinCapped(VALIDATE_MAX_BYTES);
    if (input.over) throw new Error("batch exceeds one MiB");
    const batch: unknown = JSON.parse(input.text);
    process.stdout.write(JSON.stringify(issueFacts(values["--source"], batch)) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write("faff tracker facts: " + (error instanceof Error ? error.message : String(error)) + "\n");
    return 2;
  }
}
