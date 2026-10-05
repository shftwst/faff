#!/usr/bin/env node
// FAFF-1170 — the boundary-contract check. A TypeScript-compiler-API AST walk over the converted
// cluster sources that enforces three structural properties `tsc` alone cannot:
//
//   (1) NO unchecked type assertion of ANY form outside the allow-list — fail on any `x as T`
//       (AsExpression), `<T>x` (TypeAssertion), `x!` (NonNullExpression), or `x satisfies T`
//       (SatisfiesExpression). The node list is exhaustive over TypeScript's type-assertion forms
//       on purpose: `x!` asserts away null/undefined with no runtime check, and `x satisfies T`
//       narrows for the checker without a cast node — both are exactly the "unchecked cast crosses
//       an input boundary" pattern this control prohibits. The ONLY allow-listed sites are the brand
//       validator mints (asProducerId / asContractRevisionId / tryAsProducerId / tryAsContractRevisionId),
//       where the single sanctioned `as <Brand>` follows the runtime isNonEmptyString check.
//   (2) NO `any` at a named boundary reader — fail if readJson / readStdinJson / readLedgerEntries /
//       parseGovernedRecord / parseAdmissionRecord declares (or omits, defaulting to) an `any` return.
//   (3) the cross-module producer-auth require is TYPED — a `require("./producer-auth")` must be bound
//       to a `const …: ProducerAuthApi` AND the module must `import type … from "./producer-auth"`, so
//       the brand flow cannot silently degrade to `any`.
//
// Run directly it scans the two real cluster sources and exits 0 (clean) / 1 (violations) / 2 (the
// typescript compiler API is not installed — run `npm install` under plugin/skills/faff). The test
// (test/check-no-boundary-cast.test.mjs) imports checkSources + resolveTypescript and drives it over
// planted-violation fixtures; it self-skips when typescript is unavailable (e.g. the CI unit matrix,
// which never installs the build-time toolchain).

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const REAL_SOURCES = [
  path.join(PLUGIN, "bin", "lib", "producer-auth.ts"),
  path.join(PLUGIN, "bin", "lib", "commissaire.ts"),
];

const VALIDATOR_MINTS = new Set(["asProducerId", "asContractRevisionId", "tryAsProducerId", "tryAsContractRevisionId"]);
const BOUNDARY_READERS = new Set(["readJson", "readStdinJson", "readLedgerEntries", "parseGovernedRecord", "parseAdmissionRecord"]);

// Resolve the TypeScript compiler API from the plugin's build-time devDependencies. Returns null
// (never throws) when it is not installed, so the caller can self-skip rather than crash.
export function resolveTypescript() {
  try {
    const req = createRequire(path.join(PLUGIN, "package.json"));
    return req("typescript");
  } catch {
    return null;
  }
}

function enclosingFunctionName(node, ts) {
  let p = node.parent;
  while (p) {
    if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && p.name && ts.isIdentifier(p.name)) {
      return p.name.text;
    }
    // A function expression / arrow assigned to `const name = …`
    if ((ts.isFunctionExpression(p) || ts.isArrowFunction(p)) && p.parent && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) {
      return p.parent.name.text;
    }
    p = p.parent;
  }
  return null;
}

function returnTypeOf(node) {
  // FunctionDeclaration | FunctionExpression | ArrowFunction all carry `.type` for the return annotation.
  return node.type || null;
}

// Walk one source file's AST, appending any violations to `out` keyed by the file's display name.
export function checkSourceText(rel, text, ts) {
  const out = [];
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);

  let paImportType = false;
  let paTypedRequire = false;
  let paUntypedRequire = false;

  const visit = (node) => {
    // (1) assertion nodes — allow only inside a brand validator mint.
    const isAssertion =
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node);
    if (isAssertion) {
      const fn = enclosingFunctionName(node, ts);
      if (!fn || !VALIDATOR_MINTS.has(fn)) {
        const kind = ts.isAsExpression(node) ? "as-expression"
          : ts.isTypeAssertionExpression(node) ? "angle-bracket-assertion"
          : ts.isNonNullExpression(node) ? "non-null-assertion (!)"
          : "satisfies-expression";
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        out.push(`${rel}:${line}: unchecked ${kind} outside the brand validator mints — no cast may cross an input boundary`);
      }
    }

    // (2) named boundary readers must not return `any` (and must annotate a return type).
    let readerName = null;
    let fnNode = null;
    if (ts.isFunctionDeclaration(node) && node.name && ts.isIdentifier(node.name) && BOUNDARY_READERS.has(node.name.text)) {
      readerName = node.name.text; fnNode = node;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && BOUNDARY_READERS.has(node.name.text) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      readerName = node.name.text; fnNode = node.initializer;
    }
    if (readerName && fnNode) {
      const rt = returnTypeOf(fnNode);
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      if (!rt) out.push(`${rel}:${line}: boundary reader ${readerName} has no explicit return type — it must not be inferred \`any\``);
      else if (rt.kind === ts.SyntaxKind.AnyKeyword) out.push(`${rel}:${line}: boundary reader ${readerName} returns \`any\` — a boundary reader must return \`unknown\` or a validated type`);
    }

    // (3) the cross-module producer-auth require must be typed.
    if (ts.isImportDeclaration(node) && node.importClause && node.importClause.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./producer-auth") {
      paImportType = true;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require"
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "./producer-auth") {
      const vd = node.parent;
      if (vd && ts.isVariableDeclaration(vd) && vd.type && /\bProducerAuthApi\b/.test(vd.type.getText(sf))) paTypedRequire = true;
      else paUntypedRequire = true;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Property (3) only binds a module that actually requires producer-auth (the consumer, commissaire).
  if (paTypedRequire || paUntypedRequire) {
    if (paUntypedRequire) out.push(`${rel}: require("./producer-auth") is not bound to a \`const …: ProducerAuthApi\` — the cross-module brand flow must not degrade to \`any\``);
    if (!paImportType) out.push(`${rel}: a require("./producer-auth") exists with no \`import type … from "./producer-auth"\` — the brand types must be imported`);
  }
  return out;
}

import { readFileSync } from "node:fs";

export function checkSources(filePaths, ts) {
  const violations = [];
  for (const fp of filePaths) {
    const rel = path.relative(REPO, fp);
    const text = readFileSync(fp, "utf8");
    violations.push(...checkSourceText(rel, text, ts));
  }
  return { violations };
}

function main() {
  const ts = resolveTypescript();
  if (!ts) {
    process.stderr.write("check-no-boundary-cast: the typescript compiler API is not installed — run `npm install` under plugin/skills/faff\n");
    return 2;
  }
  const files = process.argv.slice(2);
  const targets = files.length ? files.map((f) => path.resolve(f)) : REAL_SOURCES;
  const { violations } = checkSources(targets, ts);
  if (violations.length) {
    for (const v of violations) process.stderr.write(`check-no-boundary-cast: ${v}\n`);
    process.stderr.write(`check-no-boundary-cast: ${violations.length} boundary-contract violation(s)\n`);
    return 1;
  }
  console.log(`check-no-boundary-cast: clean (${targets.length} source(s))`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
