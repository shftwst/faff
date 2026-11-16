import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = value => Object.keys(value).sort().join(',');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaults = { route: null, args: [], offer: false, config_actions: [], resume_original: false, level_command: null };

export function gradeGateway(response, oracle) {
  if (!record(oracle) || oracle.schema !== 1 || !record(oracle.expected) || !Object.keys(oracle.expected).length) throw new Error('empty or invalid oracle');
  const ids = Object.keys(oracle.expected);
  const result = { status: 'fail', total: ids.length, passed: 0, failed: ids.length, errors: [], cases: [] };
  if (!record(response) || keys(response) !== 'answers' || !Array.isArray(response.answers)) {
    result.errors.push('expected exactly an answers array');
    return result;
  }
  const answers = new Map();
  for (const item of response.answers) {
    if (!record(item) || keys(item) !== 'args,config_actions,id,level_command,offer,resume_original,route' || typeof item.id !== 'string') {
      result.errors.push('malformed answer');
      continue;
    }
    if (!ids.includes(item.id)) result.errors.push(`unexpected case ${item.id}`);
    if (answers.has(item.id)) result.errors.push(`duplicate case ${item.id}`);
    answers.set(item.id, item);
  }
  for (const id of ids) {
    const expected = { ...defaults, ...oracle.expected[id] };
    const actual = answers.get(id);
    const differences = Object.keys(defaults).filter(field => !actual || !equal(actual[field], expected[field]));
    result.cases.push({ id, pass: differences.length === 0, differences, ...(differences.length ? { expected, actual: actual ?? null } : {}) });
    if (!differences.length) result.passed++;
  }
  result.failed = result.total - result.passed;
  if (!result.failed && !result.errors.length) result.status = 'pass';
  return result;
}

export function gradeDecisions(response, oracle) {
  if (!record(oracle) || oracle.schema !== 1 || !record(oracle.expected) || !Object.keys(oracle.expected).length) throw new Error('empty or invalid oracle');
  const ids = Object.keys(oracle.expected);
  const result = { status: 'fail', total: ids.length, passed: 0, failed: ids.length, errors: [], cases: [] };
  if (!record(response) || keys(response) !== 'answers' || !Array.isArray(response.answers)) {
    result.errors.push('expected exactly an answers array');
    return result;
  }
  const answers = new Map();
  for (const item of response.answers) {
    if (!record(item) || keys(item) !== 'id,value' || typeof item.id !== 'string') {
      result.errors.push('malformed answer');
      continue;
    }
    if (!ids.includes(item.id)) result.errors.push(`unexpected case ${item.id}`);
    if (answers.has(item.id)) result.errors.push(`duplicate case ${item.id}`);
    answers.set(item.id, item.value);
  }
  for (const id of ids) {
    const expected = oracle.expected[id];
    const actual = answers.get(id);
    const pass = answers.has(id) && isDeepStrictEqual(actual, expected);
    result.cases.push({ id, pass, ...(pass ? {} : { expected, actual: actual ?? null }) });
    if (pass) result.passed++;
  }
  result.failed = result.total - result.passed;
  if (!result.failed && !result.errors.length) result.status = 'pass';
  return result;
}

export function measureSkillSources(root) {
  const files = [];
  const skills = join(root, 'plugin/skills');
  for (const dir of readdirSync(skills, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const base = join(skills, dir.name);
    for (const item of readdirSync(base, { withFileTypes: true })) {
      const paths = item.isFile() && item.name === 'SKILL.md' ? [`${dir.name}/SKILL.md`]
        : item.isDirectory() && item.name === 'references' ? readdirSync(join(base, item.name)).filter(n => n.endsWith('.md')).map(n => `${dir.name}/references/${n}`) : [];
      for (const path of paths) {
        const bytes = readFileSync(join(skills, path));
        const characters = bytes.toString('utf8').length;
        files.push({ path: `plugin/skills/${path}`, bytes: bytes.length, characters, estimated_tokens: Math.ceil(characters / 4), sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { schema: 1, token_estimator: 'ceil(UTF-16 character count / 4) per file, summed; estimates, not provider usage', total_bytes: files.reduce((sum, f) => sum + f.bytes, 0), estimated_tokens: files.reduce((sum, f) => sum + f.estimated_tokens, 0), files };
}

export function measureLoadSets(source, manifest) {
  if (!record(manifest) || manifest.schema !== 1 || !Array.isArray(manifest.sets) || !manifest.sets.length) throw new Error('empty or invalid load manifest');
  const byPath = new Map(source.files.map(file => [file.path, file]));
  return manifest.sets.map(set => {
    if (!record(set) || typeof set.name !== 'string' || !set.name || !Array.isArray(set.files) || !set.files.length) throw new Error('empty or invalid load set');
    const files = [...new Set(set.files)];
    let bytes = 0, estimated_tokens = 0;
    for (const path of files) {
      const file = byPath.get(path);
      if (!file) throw new Error(`missing load dependency: ${path}`);
      bytes += file.bytes;
      estimated_tokens += file.estimated_tokens;
    }
    return { name: set.name, files, bytes, estimated_tokens };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [operation, a, b, out] = process.argv.slice(2);
  let result;
  if (operation === 'measure' && a && !out) result = measureSkillSources(resolve(a));
  else if (operation === 'loads' && a && b) result = measureLoadSets(measureSkillSources(resolve(a)), JSON.parse(readFileSync(b, 'utf8')));
  else if (operation === 'grade-gateway' && a && b) result = gradeGateway(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8')));
  else if (operation === 'grade-decisions' && a && b) result = gradeDecisions(JSON.parse(readFileSync(a, 'utf8')), JSON.parse(readFileSync(b, 'utf8')));
  else throw new Error('usage: skill-diet.mjs measure ROOT [OUT] | loads ROOT MANIFEST [OUT] | grade-gateway|grade-decisions RESPONSE ORACLE [OUT]');
  const text = JSON.stringify(result, null, 2) + '\n';
  const destination = operation === 'measure' ? b : out;
  if (destination) writeFileSync(destination, text, { flag: 'wx' });
  else process.stdout.write(text);
  if (result.status === 'fail') process.exitCode = 1;
}
