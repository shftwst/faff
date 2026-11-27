"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.graph = graph;
exports.directedComponents = directedComponents;
exports.cmdPlanningGraph = cmdPlanningGraph;
// === region:factory — observations over supplied live dependency edges ===
const { parseArgs, usageError } = require("./argv");
const { readValidateInput } = require("./ratified-scope");
function compare(left, right) {
    if (typeof left === "number" && typeof right === "number")
        return left - right;
    if (typeof left !== typeof right)
        return typeof left === "number" ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
}
function graph(ids, edges = []) {
    const adjacency = new Map(ids.map(id => [id, new Set()]));
    for (const [from, to] of edges)
        adjacency.get(from)?.add(to);
    return adjacency;
}
function components(adjacency, roots) {
    const seen = new Set();
    const groups = [];
    for (const root of roots) {
        if (seen.has(root))
            continue;
        const group = [];
        const stack = [root];
        for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
            if (seen.has(id))
                continue;
            seen.add(id);
            group.push(id);
            for (const next of adjacency.get(id) ?? [])
                if (!seen.has(next))
                    stack.push(next);
        }
        groups.push(group.sort(compare));
    }
    return groups;
}
function directedComponents(forward, reverse) {
    const seen = new Set();
    const finished = [];
    // Finish each depth-first traversal before walking the transposed graph.
    for (const root of forward.keys()) {
        if (seen.has(root))
            continue;
        const stack = [{ id: root, exiting: false }];
        for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
            if (frame.exiting) {
                finished.push(frame.id);
            }
            else if (!seen.has(frame.id)) {
                seen.add(frame.id);
                stack.push({ id: frame.id, exiting: true });
                for (const next of forward.get(frame.id) ?? [])
                    if (!seen.has(next))
                        stack.push({ id: next, exiting: false });
            }
        }
    }
    return components(reverse, finished.reverse());
}
function exampleCycle(members, blockedBy) {
    const [root] = members;
    if (root === undefined)
        return [];
    const inComponent = new Set(members);
    const parent = new Map([[root, root]]);
    const pending = [root];
    for (const id of pending) {
        for (const blocker of blockedBy.get(id) ?? []) {
            if (blocker === root) {
                const path = [];
                for (let previous = id; previous !== undefined && previous !== root; previous = parent.get(previous)) {
                    path.push(previous);
                }
                return [root, ...path.reverse(), root];
            }
            if (inComponent.has(blocker) && !parent.has(blocker)) {
                parent.set(blocker, id);
                pending.push(blocker);
            }
        }
    }
    throw new Error("cyclic component has no witness");
}
function countDependents(root, dependents) {
    const visited = new Set([root]);
    const pending = [root];
    for (const issue of pending) {
        for (const dependent of dependents.get(issue) ?? []) {
            if (visited.has(dependent))
                continue;
            visited.add(dependent);
            pending.push(dependent);
        }
    }
    return visited.size - 1;
}
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function id(value) {
    if (typeof value === "string" && value.trim())
        return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
        return value;
    throw new Error("expected nonempty string or nonnegative safe integer issue ID");
}
function observe(input, cycles, unlock) {
    if (!record(input) || !Array.isArray(input.issues) || !Array.isArray(input.live_edges)) {
        throw new Error("expected issues and live_edges arrays");
    }
    const ids = input.issues.map(id).sort(compare);
    const active = new Set(ids);
    if (active.size !== ids.length)
        throw new Error("duplicate issue ID");
    const live = [];
    for (const edge of input.live_edges) {
        if (!Array.isArray(edge) || edge.length !== 2)
            throw new Error("expected [issue, blocker] edge");
        const issue = id(edge[0]), blocker = id(edge[1]);
        if (!active.has(issue))
            throw new Error("edge source is outside the active issues");
        if (active.has(blocker))
            live.push([issue, blocker]);
    }
    const dependents = graph(ids, live.map(([issue, blocker]) => [blocker, issue]));
    if (!unlock && input.roots !== undefined)
        throw new Error("roots only apply to --unlock");
    const observations = {};
    if (cycles) {
        // Sort witnesses by ID, including when caller page order changes.
        live.sort(([from, to], [nextFrom, nextTo]) => compare(from, nextFrom) || compare(to, nextTo));
        const blockedBy = graph(ids, live);
        observations.dependency_cycles = directedComponents(blockedBy, dependents)
            .filter(component => component.length > 1 || component.some(issue => blockedBy.get(issue)?.has(issue)))
            .sort(([left], [right]) => left === undefined || right === undefined ? 0 : compare(left, right))
            .map(members => ({ members, witness: exampleCycle(members, blockedBy) }));
    }
    if (unlock) {
        if (input.roots !== undefined && !Array.isArray(input.roots))
            throw new Error("expected a roots array");
        const roots = input.roots?.map(id) ?? ids;
        if (roots.some(root => !active.has(root)))
            throw new Error("root is outside the active issues");
        observations.unlock_counts = [...new Set(roots)].sort(compare).map(root => [root, countDependents(root, dependents)]);
    }
    return observations;
}
const spec = { flags: { "--cycles": { arity: 0 }, "--unlock": { arity: 0 } }, positionals: { max: 0 } };
const usage = `usage: faff planning-graph [--cycles] [--unlock] < facts.json
Example (--unlock): {"issues":["blocker","dependent"],"live_edges":[["dependent","blocker"]],"roots":["blocker"]}`;
function cmdPlanningGraph(args) {
    if (args.length === 1 && args[0] === "--help") {
        console.log(usage);
        return 0;
    }
    const { values, errors } = parseArgs(args, spec);
    const cycles = values["--cycles"] === true, unlock = values["--unlock"] === true;
    if (errors.length || (!cycles && !unlock))
        return usageError(errors, usage);
    try {
        const input = readValidateInput(null);
        if (!input.ok)
            throw new Error("graph exceeds one MiB");
        const data = JSON.parse(input.text);
        process.stdout.write(JSON.stringify(observe(data, cycles, unlock)) + "\n");
        return 0;
    }
    catch (error) {
        process.stderr.write("faff planning-graph: " + (error instanceof Error ? error.message : String(error)) + "\n");
        return 2;
    }
}
