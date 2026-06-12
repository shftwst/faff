// FAFF-89 — Mock-tracker fixture format + loader.
//
// A deterministic, in-memory stand-in for the tracker MCP: load a committed JSON
// fixture (one backlog snapshot) and query it through a tracker-MCP-shaped model.
// The tracker boundary faff's skills read is the skill-agent <-> MCP seam; this
// model serves that layer (via the FAFF-93 harness), NOT the `faff` CLI (which is
// a pure function over flags with no MCP access — see the spec's HOW anti-pattern).
//
// Design (per spec + ADR 0002):
//   - Zero-dependency: node:* only. Validation is hand-written (no ajv/zod), fixtures
//     are plain JSON (no YAML parser).
//   - Deterministic by construction: every list result is stably sorted by a defined
//     key, so output never depends on fixture authoring order. No clock/random/network.
//   - Fail-loud: any structural problem throws FixtureError at load, never at query time.
//   - Read-only: the model is frozen; query methods return deep copies so a caller
//     (or a buggy skill under test) cannot mutate shared state.

import { readFileSync } from "node:fs";

/** Thrown for any fixture-shape problem (bad version, dup id, dangling ref, bad enum). */
export class FixtureError extends Error {
  constructor(message) {
    super(message);
    this.name = "FixtureError";
  }
}

const STATE_CATEGORIES = new Set([
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
]);

// Deterministic, locale-independent string order (code-unit compare, not localeCompare).
function byString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function asArray(raw, key) {
  if (raw[key] == null) return []; // a fixture may omit any collection
  if (!Array.isArray(raw[key])) throw new FixtureError(`${key} must be an array`);
  return raw[key];
}

function uniqueOrThrow(ids, collection) {
  const seen = new Set();
  for (const id of ids) {
    if (typeof id !== "string" || id === "") {
      throw new FixtureError(`${collection}: every entry needs a non-empty string id/name`);
    }
    if (seen.has(id)) throw new FixtureError(`duplicate id ${id} in ${collection}`);
    seen.add(id);
  }
  return seen;
}

// Confirm the fixture is internally consistent before any query can run, so every
// failure is a clear load-time error rather than a downstream mystery.
function validate(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new FixtureError("fixture must be an object");
  }
  if (raw.version !== 1) {
    throw new FixtureError(`unsupported fixture version ${JSON.stringify(raw.version)}`);
  }

  const issues = asArray(raw, "issues");
  const projects = asArray(raw, "projects");
  const initiatives = asArray(raw, "initiatives");
  const labels = asArray(raw, "labels");
  const comments = asArray(raw, "comments");

  const issueIds = uniqueOrThrow(issues.map((i) => i.id), "issues");
  const projectIds = uniqueOrThrow(projects.map((p) => p.id), "projects");
  const initiativeIds = uniqueOrThrow(initiatives.map((i) => i.id), "initiatives");
  const labelNames = uniqueOrThrow(labels.map((l) => l.name), "labels");
  uniqueOrThrow(comments.map((c) => c.id), "comments");

  for (const issue of issues) {
    if (!STATE_CATEGORIES.has(issue.stateCategory)) {
      throw new FixtureError(
        `issue ${issue.id}: bad stateCategory ${JSON.stringify(issue.stateCategory)}`,
      );
    }
    if (issue.projectId != null && !projectIds.has(issue.projectId)) {
      throw new FixtureError(`issue ${issue.id}: dangling projectId -> ${issue.projectId}`);
    }
    for (const name of issue.labels ?? []) {
      if (!labelNames.has(name)) {
        throw new FixtureError(`issue ${issue.id}: dangling label -> ${name}`);
      }
    }
    const rel = issue.relations ?? {};
    for (const field of ["blocks", "blockedBy", "relatedTo"]) {
      for (const target of rel[field] ?? []) {
        if (!issueIds.has(target)) {
          throw new FixtureError(`issue ${issue.id}: dangling ${field} -> ${target}`);
        }
      }
    }
    if (issue.parentId != null && !issueIds.has(issue.parentId)) {
      throw new FixtureError(`issue ${issue.id}: dangling parentId -> ${issue.parentId}`);
    }
  }

  for (const project of projects) {
    for (const initId of project.initiativeIds ?? []) {
      if (!initiativeIds.has(initId)) {
        throw new FixtureError(`project ${project.id}: dangling initiativeId -> ${initId}`);
      }
    }
  }

  for (const comment of comments) {
    if (!issueIds.has(comment.issueId)) {
      throw new FixtureError(`comment ${comment.id}: dangling issueId -> ${comment.issueId}`);
    }
  }

  return { issues, projects, initiatives, labels, comments };
}

// Seam-shaped issue view: a deep copy carrying resolved labels ({name,color}), its
// relations, and a resolved project reference — the shape a skill expects back from
// get_issue / list_issues.
function toIssueResult(issue, labelsByName, projectsById) {
  const r = structuredClone(issue);
  r.labels = (issue.labels ?? []).map((name) => {
    const l = labelsByName.get(name);
    return { name, color: l && l.color != null ? l.color : null };
  });
  if (!r.relations) r.relations = { blocks: [], blockedBy: [], relatedTo: [] };
  const project = issue.projectId != null ? projectsById.get(issue.projectId) : null;
  r.project = project ? { id: project.id, name: project.name } : null;
  return r;
}

/**
 * Load a fixture into a read-only, queryable tracker model.
 * @param {string|object} source absolute path to a .json fixture, or an already-parsed object.
 * @returns {object} a frozen TrackerModel (query methods return deep copies).
 * @throws {FixtureError} on any validation failure — fail loud, never partial.
 */
export function loadFixture(source) {
  let raw;
  if (typeof source === "string") {
    let text;
    try {
      text = readFileSync(source, "utf8");
    } catch (e) {
      throw new FixtureError(`cannot read fixture at ${source}: ${e.message}`);
    }
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new FixtureError(`invalid JSON in fixture at ${source}: ${e.message}`);
    }
  } else {
    raw = source;
  }

  const data = validate(raw);

  const issuesById = new Map(data.issues.map((i) => [i.id, i]));
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const labelsByName = new Map(data.labels.map((l) => [l.name, l]));
  const commentsByIssue = new Map();
  for (const c of data.comments) {
    if (!commentsByIssue.has(c.issueId)) commentsByIssue.set(c.issueId, []);
    commentsByIssue.get(c.issueId).push(c);
  }

  const model = {
    listIssues(filter = {}) {
      let rows = data.issues.slice();
      if (filter.state != null) rows = rows.filter((i) => i.state === filter.state);
      if (filter.stateCategory != null) {
        rows = rows.filter((i) => i.stateCategory === filter.stateCategory);
      }
      if (filter.projectId != null) rows = rows.filter((i) => i.projectId === filter.projectId);
      if (filter.labels != null) {
        const want = Array.isArray(filter.labels) ? filter.labels : [filter.labels];
        rows = rows.filter((i) => want.every((n) => (i.labels ?? []).includes(n)));
      }
      rows.sort((a, b) => byString(a.id, b.id));
      return rows.map((i) => toIssueResult(i, labelsByName, projectsById));
    },

    getIssue(id) {
      const issue = issuesById.get(id);
      return issue ? toIssueResult(issue, labelsByName, projectsById) : null;
    },

    listProjects(filter = {}) {
      let rows = data.projects.slice();
      if (filter.initiativeId != null) {
        rows = rows.filter((p) => (p.initiativeIds ?? []).includes(filter.initiativeId));
      }
      rows.sort((a, b) => byString(a.id, b.id));
      return rows.map((p) => structuredClone(p));
    },

    getProject(id) {
      const project = projectsById.get(id);
      return project ? structuredClone(project) : null;
    },

    listInitiatives() {
      return data.initiatives
        .slice()
        .sort((a, b) => byString(a.id, b.id))
        .map((i) => structuredClone(i));
    },

    listLabels() {
      return data.labels
        .slice()
        .sort((a, b) => byString(a.name, b.name))
        .map((l) => structuredClone(l));
    },

    listComments(issueId) {
      const rows = (commentsByIssue.get(issueId) ?? []).slice();
      rows.sort((a, b) => byString(a.createdAt, b.createdAt) || byString(a.id, b.id));
      return rows.map((c) => structuredClone(c));
    },
  };

  return Object.freeze(model);
}
