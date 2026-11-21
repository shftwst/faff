// === region:factory — select the existing ADR promotion channel for graft ===
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { loadConfig, resolveAdrDocsPath } = require("./config");
const { dig, findRoot } = require("./shared-infra");
const { parseArgs, usageError } = require("./argv");

const usage = "usage: faff adr promotion-source [--root DIR] (--tracker-intent | --file SPEC)";
export const promotionSourceSpec = { positionals: {max: 0}, flags: {"--root": {arity: 1}, "--tracker-intent": {arity: 0}, "--file": {arity: 1}} };

export function cmdPromotionSource(args: string[], extract: (body: string) => string | null): number {
  const {values, errors} = parseArgs(args, promotionSourceSpec);
  if (errors.length) return usageError(errors, usage);
  if (Boolean(values["--tracker-intent"]) === Boolean(values["--file"])) {
    process.stderr.write(usage + "\n");
    return 2;
  }
  const root = values["--root"] || findRoot();
  const [config] = loadConfig(root);
  if (dig(config, "adr.mode") === "off") {
    console.log('{"source":"off"}');
    return 0;
  }
  const adr_docs_path = resolveAdrDocsPath(root, config, false);
  if (values["--tracker-intent"]) {
    console.log(JSON.stringify({source: "tracker", adr_docs_path}));
    return 0;
  }
  let section: string | null;
  try {
    section = extract(readFileSync(resolve(root, values["--file"]), "utf8"));
  } catch (error) {
    process.stderr.write("faff adr promotion-source: could not read the committed spec: " +
      (error instanceof Error ? error.message : String(error)) + "\n");
    section = null;
  }
  console.log(JSON.stringify(section === null ? {source: "absent"} : {source: "spec", adr_docs_path, section}));
  return 0;
}
