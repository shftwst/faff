"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partitionBuildQueue = partitionBuildQueue;
exports.cmdBuildQueuePartition = cmdBuildQueuePartition;
// === region:factory — build-queue-partition: group admitted work from caller-supplied facts ===
const planning_graph_ts_1 = require("./planning-graph.js");
const argv = require("./argv");
const { readValidateInput } = require("./ratified-scope");
function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return Object.fromEntries(Object.entries(value));
}
function array(value, label) {
    if (!Array.isArray(value))
        throw new Error(`${label} must be an array`);
    return value;
}
function text(value, label) {
    if (typeof value !== "string" || value.trim() === "")
        throw new Error(`${label} must be non-empty text`);
    return value;
}
function issueId(value) {
    const id = text(value, "issue ID");
    if (/[\s\x00-\x1f]/u.test(id))
        throw new Error("issue ID must be a single token");
    return id;
}
function paths(value, label, directory) {
    const items = array(value, label).map(raw => {
        const candidate = text(raw, label).replace(/^(?:\.\/)+/, "");
        const canonical = directory ? candidate.replace(/\/+$/, "") : candidate;
        if (/^[A-Za-z]:|[\\\x00-\x1f]/.test(canonical) || canonical.split("/").some(part => part === "" || part === "." || part === "..")) {
            throw new Error(`${label} must contain repository-relative paths without traversal`);
        }
        return canonical;
    });
    return [...new Set(items)].sort();
}
function strings(value, label) {
    return [...new Set(array(value, label).map(item => text(item, label)))].sort();
}
function edge(row) {
    const producer = issueId(row.producer);
    const consumer = issueId(row.consumer);
    if (producer === consumer)
        throw new Error("producer and consumer must differ");
    return { producer, consumer };
}
function readFacts(input) {
    const row = object(input, "facts");
    const issues = array(row.issues, "issues").map(value => {
        const issue = object(value, "issue");
        return {
            id: issueId(issue.id),
            files: paths(issue.files, "files", false),
            directories: paths(issue.directories, "directories", true),
            surfaces: strings(issue.surfaces, "surfaces"),
            scope_tags: strings(issue.scope_tags, "scope_tags"),
            blocked_by: [...new Set(array(issue.blocked_by, "blocked_by").map(issueId))].sort(),
        };
    });
    const ids = new Set(issues.map(issue => issue.id));
    if (ids.size !== issues.length)
        throw new Error("duplicate issue ID in issues");
    if (issues.some(issue => issue.blocked_by.includes(issue.id)))
        throw new Error("issue cannot block itself");
    const inferred = array(row.inferred, "inferred").map(value => {
        const match = object(value, "inference");
        const { match_kind, confidence } = match;
        if (match_kind !== "id_reference" && match_kind !== "paraphrase")
            throw new Error("invalid inference match_kind");
        if (confidence !== "firm" && confidence !== "ambiguous")
            throw new Error("invalid inference confidence");
        return { ...edge(match), match_kind, confidence, evidence: text(match.evidence, "inference evidence") };
    });
    const nonBlocking = array(row.non_blocking, "non_blocking").map(value => edge(object(value, "non-blocker")));
    const uncertain = new Set(array(row.uncertain_collisions, "uncertain_collisions").map(value => {
        const pair = array(value, "uncertain collision");
        if (pair.length !== 2)
            throw new Error("uncertain collision needs two issue IDs");
        const left = issueId(pair[0]);
        const right = issueId(pair[1]);
        if (left === right || !ids.has(left) || !ids.has(right))
            throw new Error("uncertain collision must name two distinct queued issues");
        return pairKey(left, right);
    }));
    return { issues, inferred, nonBlocking, uncertain };
}
function compare(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
function edgeKey(producer, consumer) {
    return JSON.stringify([producer, consumer]);
}
function pairKey(left, right) {
    return left < right ? edgeKey(left, right) : edgeKey(right, left);
}
function common(left, right) {
    for (let l = 0, r = 0; l < left.length && r < right.length;) {
        const step = compare(left[l] ?? "", right[r] ?? "");
        if (step === 0)
            return left[l];
        if (step < 0)
            l++;
        else
            r++;
    }
    return undefined;
}
function collision(left, right) {
    const file = common(left.files, right.files);
    if (file !== undefined)
        return { kind: "file", value: file };
    let deepest;
    let depth = 0;
    const orientations = [[left, right], [right, left]];
    for (const [source, target] of orientations) {
        for (const directory of source.directories) {
            const prefix = directory + "/";
            if (!target.directories.some(path => path === directory || path.startsWith(prefix)) &&
                !target.files.some(path => path === directory || path.startsWith(prefix)))
                continue;
            const segments = directory.split("/").length;
            if (deepest === undefined || segments > depth || (segments === depth && directory < deepest)) {
                deepest = directory;
                depth = segments;
            }
        }
    }
    if (deepest !== undefined)
        return { kind: "directory", value: deepest };
    const surface = common(left.surfaces, right.surfaces);
    if (surface !== undefined)
        return { kind: "surface", value: surface };
    const tag = common(left.scope_tags, right.scope_tags);
    return tag === undefined ? undefined : { kind: "scope-tag", value: tag };
}
function dependencyComponents(ids, edges) {
    return (0, planning_graph_ts_1.directedComponents)((0, planning_graph_ts_1.graph)(ids, edges.map(({ producer, consumer }) => [producer, consumer])), (0, planning_graph_ts_1.graph)(ids, edges.map(({ producer, consumer }) => [consumer, producer])));
}
function orderGroup(componentsByDependency, dependencies) {
    const componentFor = new Map();
    const members = new Map();
    for (const component of componentsByDependency) {
        const [lead] = component;
        if (lead === undefined)
            continue;
        members.set(lead, component);
        for (const id of component)
            componentFor.set(id, lead);
    }
    const edges = (0, planning_graph_ts_1.graph)([...members.keys()]);
    const incoming = new Map([...members.keys()].map(id => [id, 0]));
    for (const { producer, consumer } of dependencies) {
        const from = componentFor.get(producer);
        const to = componentFor.get(consumer);
        if (from === undefined || to === undefined || from === to || edges.get(from)?.has(to))
            continue;
        edges.get(from)?.add(to);
        incoming.set(to, (incoming.get(to) ?? 0) + 1);
    }
    const available = [...members.keys()].filter(id => incoming.get(id) === 0).sort((a, b) => compare(b, a));
    const ordered = [];
    for (let id = available.pop(); id !== undefined; id = available.pop()) {
        for (const member of members.get(id) ?? [])
            ordered.push(member);
        let ready = false;
        for (const child of edges.get(id) ?? []) {
            const waiting = (incoming.get(child) ?? 0) - 1;
            incoming.set(child, waiting);
            if (waiting === 0) {
                available.push(child);
                ready = true;
            }
        }
        if (ready)
            available.sort((a, b) => compare(b, a));
    }
    return ordered;
}
function byLead(left, right) {
    return compare(left[0] ?? "", right[0] ?? "");
}
function partitionBuildQueue(input) {
    const { issues, inferred, nonBlocking, uncertain } = readFacts(input);
    issues.sort((a, b) => compare(a.id, b.id));
    const ids = issues.map(issue => issue.id);
    const admitted = new Map(issues.map(issue => [issue.id, issue]));
    const parent = new Map(ids.map(id => [id, id]));
    const size = new Map(ids.map(id => [id, 1]));
    const collisions = [];
    const dependencies = new Map();
    const overrides = new Set(nonBlocking.map(rule => edgeKey(rule.producer, rule.consumer)));
    const audit = new Map();
    function root(id) {
        let next = parent.get(id);
        while (next !== undefined && next !== id) {
            parent.set(id, parent.get(next) ?? next);
            id = next;
            next = parent.get(id);
        }
        return id;
    }
    function link(left, right) {
        let a = root(left);
        let b = root(right);
        if (a === b)
            return false;
        if ((size.get(a) ?? 0) < (size.get(b) ?? 0))
            [a, b] = [b, a];
        parent.set(b, a);
        size.set(a, (size.get(a) ?? 0) + (size.get(b) ?? 0));
        return true;
    }
    for (const { id, blocked_by } of issues) {
        for (const blocker of blocked_by) {
            if (admitted.has(blocker)) {
                dependencies.set(edgeKey(blocker, id), { producer: blocker, consumer: id, source: "declared" });
                link(blocker, id);
            }
        }
    }
    for (const [index, left] of issues.entries()) {
        for (let j = index + 1; j < issues.length; j++) {
            const right = issues[j];
            if (right === undefined)
                continue;
            const key = edgeKey(left.id, right.id);
            const reason = collision(left, right);
            const why = reason ?? (uncertain.has(key) ? { kind: "uncertain" } : undefined);
            // A witness only needs to explain a new connection. Repeated path pairs would make the log quadratic.
            if (why && link(left.id, right.id))
                collisions.push({ left: left.id, right: right.id, ...why });
        }
    }
    for (const match of inferred) {
        const { producer, consumer } = match;
        const producerIssue = admitted.get(producer);
        const consumerIssue = admitted.get(consumer);
        if (!producerIssue || !consumerIssue)
            continue;
        const key = edgeKey(producer, consumer);
        const shared = collision(producerIssue, consumerIssue);
        if (dependencies.get(key)?.source === "declared" || (shared && shared.kind !== "scope-tag"))
            continue;
        const disposition = overrides.has(key) ? "human-non-blocker" : match.confidence === "firm" ? "serialised" : "ambiguous";
        const row = { ...match, disposition };
        audit.set(JSON.stringify(row), row);
        if (disposition === "serialised") {
            dependencies.set(key, { producer, consumer, source: "inferred" });
            link(producer, consumer);
        }
    }
    const relation = [...dependencies.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
    const serial = dependencyComponents(ids, relation);
    const inferredOnly = dependencyComponents(ids, relation.filter(edge => edge.source === "inferred"));
    const independents = [];
    const groups = [];
    const componentByMember = new Map();
    for (const component of serial)
        for (const member of component)
            componentByMember.set(member, component);
    const edgesByProducer = new Map();
    for (const edge of relation) {
        const list = edgesByProducer.get(edge.producer) ?? [];
        list.push(edge);
        edgesByProducer.set(edge.producer, list);
    }
    const linkedGroups = new Map();
    for (const id of ids) {
        const lead = root(id);
        const group = linkedGroups.get(lead) ?? [];
        group.push(id);
        linkedGroups.set(lead, group);
    }
    for (const group of linkedGroups.values()) {
        const [lead] = group;
        if (lead === undefined)
            continue;
        if (group.length === 1)
            independents.push(lead);
        else {
            const groupComponents = new Set();
            for (const id of group) {
                const component = componentByMember.get(id);
                if (component !== undefined)
                    groupComponents.add(component);
            }
            groups.push(orderGroup(groupComponents, group.flatMap(id => edgesByProducer.get(id) ?? [])));
        }
    }
    return {
        independents,
        groups: groups.sort(byLead),
        dependencies: relation,
        collisions,
        inferred: [...audit.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value),
        inferred_cycles: inferredOnly.filter(component => component.length > 1).sort(byLead),
        ordering_cycles: serial.filter(component => component.length > 1).sort(byLead),
    };
}
function cmdBuildQueuePartition(args) {
    const usage = "usage: faff build-queue-partition --facts FILE|-";
    const { values, errors } = argv.parseArgs(args, { flags: { "--facts": { arity: 1 } } });
    if (errors.length)
        return argv.usageError(errors, usage);
    const source = values["--facts"];
    if (typeof source !== "string")
        return argv.usageError([{ code: "missing-flag", detail: "--facts is required" }], usage);
    try {
        const facts = readValidateInput(source === "-" ? null : source);
        if (!facts.ok)
            throw new Error("facts exceed one MiB");
        const input = JSON.parse(facts.text);
        process.stdout.write(JSON.stringify(partitionBuildQueue(input)) + "\n");
        return 0;
    }
    catch (error) {
        const detail = error instanceof SyntaxError ? "invalid JSON" : error instanceof Error ? error.message : "invalid facts";
        process.stderr.write(`faff build-queue-partition: ${detail}\n`);
        return 2;
    }
}
