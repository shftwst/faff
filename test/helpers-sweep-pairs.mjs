// Shared pair enumeration for the validator-extension sweep: every (schema, data) pair a
// contract or verification schema is exercised with today, keyed by a stable id.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..");
const CONTRACTS = join(REPO, "plugin", "skills", "faff", "contracts");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function sweepPairs() {
  const pairs = [];
  const schemaFor = (name) => join(CONTRACTS, `${name}.schema.json`);

  const cases = readJson(join(REPO, "test", "golden", "contracts", "cases.json"));
  cases.forEach((c, i) => {
    if (c.expectStdout === undefined || !existsSync(schemaFor(c.contract))) return;
    pairs.push({ id: `golden:${c.contract}:${c.name}:${i}`, schemaPath: schemaFor(c.contract), data: c.expectStdout });
  });

  const exDir = join(CONTRACTS, "examples");
  for (const f of readdirSync(exDir).sort()) {
    const m = f.match(/^(.+?)\.(good|bad|example)\.json$/);
    if (m && existsSync(schemaFor(m[1]))) {
      pairs.push({ id: `example:${f}`, schemaPath: schemaFor(m[1]), data: readJson(join(exDir, f)) });
    }
  }

  const vdir = join(REPO, "verification");
  const schemas = walk(vdir).filter((p) => p.endsWith(".schema.json") && !p.includes("/v0.3/"));
  for (const schemaPath of schemas) {
    const dir = join(dirname(schemaPath), "examples");
    if (!existsSync(dir)) continue;
    const base = schemaPath.split("/").pop().replace(".schema.json", "");
    for (const p of walk(dir)) {
      const f = p.split("/").pop();
      const isNeg = p.includes("/negative/") && p.endsWith(".json");
      if (f === `${base}.example.json` || isNeg) {
        pairs.push({ id: `verification:${relative(REPO, schemaPath)}:${relative(REPO, p)}`, schemaPath, data: readJson(p) });
      }
    }
  }
  return pairs;
}
