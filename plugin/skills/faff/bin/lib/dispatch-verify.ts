// === region:factory — verify run custody before member evidence ===
import { readFileSync } from "node:fs";

const { parseArgs, usageError } = require("./argv");
const { MANIFEST_VERSION, memberRels, diffAgainstManifest } = require("./integrity-digest");
const { guardWriterPaths, claimFromStdin, verifyReturn } = require("./evidence");

const usage = "usage: faff dispatch verify-member --run-dir DIR --issue ID --return JSON|null < held-manifest";
const spec = {
  flags: { "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--return": { arity: 1 } },
  positionals: { min: 0, max: 0 },
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runDifferences(dir: string): string[] {
  const manifest: unknown = JSON.parse(readFileSync(0, "utf8"));
  if (!object(manifest) || manifest.version !== MANIFEST_VERSION || manifest.grain !== "run" || !object(manifest.members)) {
    throw new Error("expected the held run-grain manifest on stdin");
  }
  const roster: string[] = memberRels(dir, null, true);
  const members = manifest.members;
  if (Object.keys(members).length !== roster.length || !roster.every((key) => {
    const member = members[key];
    return Object.hasOwn(members, key) && object(member) && typeof member.present === "boolean";
  })) {
    throw new Error("incomplete run-grain manifest with events");
  }
  return diffAgainstManifest(dir, manifest);
}

function unavailable(scope: "run" | "member", issue: string, err: unknown): number {
  const reason = err instanceof Error ? err.message : String(err);
  const label = scope === "run" ? "integrity-digest" : "evidence-return";
  console.log(JSON.stringify({ scope, issue, verdict: "unavailable", park_cause: label + " verification unavailable — " + reason.split("\n")[0], tampered_paths: [] }));
  return 2;
}

export function cmdVerifyMember(args: string[]): number {
  const { values, errors } = parseArgs(args, spec);
  const dir = values["--run-dir"], issue = values["--issue"];
  if (errors.length || !dir || !issue || values["--return"] === undefined) return usageError(errors, usage);
  try {
    const paths = runDifferences(dir);
    if (paths.length) {
      console.log(JSON.stringify({ scope: "run", issue, verdict: "tampered", park_cause: "integrity-digest tampered — " + paths.join(", "), tampered_paths: paths }));
      return 1;
    }
  } catch (err) {
    return unavailable("run", issue, err);
  }
  try {
    const issueDir = guardWriterPaths(dir, issue);
    const claim = claimFromStdin(values["--return"], issue);
    const { verdict, park_cause, tampered_paths, evidence_persisted } = verifyReturn(issueDir, issue, claim);
    console.log(JSON.stringify({ scope: "member", issue, verdict, park_cause, tampered_paths, evidence_persisted }));
    return verdict === "agree" ? 0 : 1;
  } catch (err) {
    return unavailable("member", issue, err);
  }
}
