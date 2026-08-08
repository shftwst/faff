import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const guidePath = 'docs/concept/positioning-and-language.md';
const briefPath = 'docs/superpowers/specs/2026-07-20-docs-positioning-design.md';
const adrPath = 'docs/adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md';
const auditPath = 'docs/audits/2026-08-07-FAFF-732-public-trust-claims.md';
const ledgerPath = 'docs/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json';
const architectureAdrPath = 'docs/adr/0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md';
const repositoryBlobPrefix = 'https://github.com/shftwst/faff/blob/main/';
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function linesOutsideFences(markdown) {
  let fenced = false;
  return markdown.split('\n').filter((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

function slugifyHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function relativeLinks(path, markdown = read(path)) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => target.startsWith(repositoryBlobPrefix) || !/^(?:[a-z]+:|#|\/)/i.test(target))
    .map((target) => ({ source: path, target }));
}

function resolvedLink({ source, target }) {
  const repositoryTarget = target.startsWith(repositoryBlobPrefix);
  const [filePart, fragment] = (repositoryTarget ? target.slice(repositoryBlobPrefix.length) : target).split('#', 2);
  const absolute = repositoryTarget ? resolve(root, filePart) : resolve(root, dirname(source), filePart);
  const relative = absolute.slice(root.length + 1);
  return { absolute, relative, fragment };
}

function paragraphs(markdown) {
  const outside = linesOutsideFences(markdown).join('\n');
  return outside
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith('#') && !/^\[[^\]]+\]\([^)]+\)$/.test(paragraph))
    .filter((paragraph) => paragraph.split(/\s+/).length >= 12);
}

function normalizeParagraph(paragraph) {
  return paragraph
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

test('claim markers match the pinned FAFF-732 ledger', () => {
  const ledger = JSON.parse(read(ledgerPath));
  assert.equal(ledger.source_commit, '5120f5481e64c759769e76b61955550022f12223');
  const required = new Map([
    ['readme-safe-to-stop-watching', 'attested'],
    ['readme-l3-park-and-ledger', 'enforced'],
    ['l4-completion-claim', 'unsupported'],
  ]);
  const ledgerClaims = new Map(ledger.claims.map(({ id, status }) => [id, status]));
  for (const [id, status] of required) assert.equal(ledgerClaims.get(id), status, `${id} ledger status`);

  const guide = read(guidePath);
  const rawMarkers = [...guide.matchAll(/<!--\s*faff-claim-status:([^:]+):([^\s]+)\s*-->/g)];
  const lines = linesOutsideFences(guide);
  const markerPattern = /^<!-- faff-claim-status:([^:]+):([^\s]+) -->$/;
  const markers = lines.flatMap((line, index) => {
    const match = line.match(markerPattern);
    return match ? [{ id: match[1], status: match[2], index }] : [];
  });
  assert.equal(rawMarkers.length, markers.length, 'claim markers must be exact own-line markers outside code fences');
  assert.equal(markers.length, required.size);
  assert.equal(new Set(markers.map(({ id }) => id)).size, markers.length, 'claim markers must be unique');
  for (const { id, status, index } of markers) {
    assert.equal(required.get(id), status, `known marker ${id}/${status}`);
    assert.equal(ledgerClaims.get(id), status, `ledger-backed marker ${id}/${status}`);
    assert.ok(lines[index + 1]?.trim() && !/^\s*(?:#|[-*>]|<!--)/.test(lines[index + 1]), `${id} must classify the immediately following paragraph`);
  }
});

test('the guide owns the required definitions, sections, and unsettled decisions', () => {
  const guide = read(guidePath);
  for (const heading of ['Current and target identity', 'What Commissaire means today', 'Maturity and evidence', 'Writing guide', 'Unsettled decisions']) {
    assert.match(guide, new RegExp(`^## ${heading}$`, 'm'));
  }
  const definitions = [
    ['Faff', 'current identity'],
    ['SuperDomestique', 'target identity'],
    ['Commissaire', 'target responsibility'],
    ['Governed autonomy', 'current delivery model'],
  ];
  for (const [term, status] of definitions) {
    const pattern = new RegExp(`\\*\\*${term} \\(${status}\\)\\.\\*\\*[^\\n]+ It is not [^\\n]+`);
    assert.match(guide, pattern, `${term} definition must state status and boundary`);
  }
  assert.match(guide, /^Whether Commissaire becomes a separate distribution remains unsettled\.$/m);
  assert.match(guide, /^Whether or when `faff` technical identifiers are renamed remains unsettled\.$/m);
});

test('the required documentation link graph resolves', () => {
  const glossary = read('docs/GLOSSARY.md');
  const briefNotice = read(briefPath).split('<!-- /faff-positioning-supersession:FAFF-733 -->')[0];
  const graphChecks = [
    [guidePath, auditPath], [guidePath, briefPath], [guidePath, architectureAdrPath], [guidePath, adrPath],
    [adrPath, guidePath], [adrPath, briefPath], [adrPath, auditPath], [adrPath, architectureAdrPath],
    ['docs/concept/intro.md', guidePath], ['docs/concept/what-is-faff.md', guidePath],
  ];
  const linksBySource = new Map([
    [guidePath, relativeLinks(guidePath)],
    [adrPath, relativeLinks(adrPath)],
    ['docs/concept/intro.md', relativeLinks('docs/concept/intro.md')],
    ['docs/concept/what-is-faff.md', relativeLinks('docs/concept/what-is-faff.md')],
    [briefPath, relativeLinks(briefPath, briefNotice)],
    ['docs/GLOSSARY.md', relativeLinks('docs/GLOSSARY.md', glossary.split('## Naming decisions')[0])],
  ]);
  for (const [source, target] of graphChecks) {
    assert.ok(linksBySource.get(source).some((link) => resolvedLink(link).relative === target), `${source} must link ${target}`);
  }
  for (const target of [guidePath, adrPath]) {
    assert.ok(linksBySource.get(briefPath).some((link) => resolvedLink(link).relative === target), `brief notice must link ${target}`);
  }
  for (const term of ['Commissaire', 'governed autonomy', 'SuperDomestique']) {
    const row = glossary.split('\n').find((line) => line.startsWith(`| ${term} |`));
    assert.ok(row, `${term} glossary row`);
    assert.ok(relativeLinks('docs/GLOSSARY.md', row).some((link) => resolvedLink(link).relative === guidePath), `${term} must link the guide`);
  }
  assert.match(read(adrPath), /FAFF-733/);

  for (const links of linksBySource.values()) {
    for (const link of links) {
      const { absolute, fragment } = resolvedLink(link);
      const target = readFileSync(absolute, 'utf8');
      if (fragment) {
        const slugs = linesOutsideFences(target)
          .filter((line) => /^#{1,6}\s+/.test(line))
          .map((line) => slugifyHeading(line.replace(/^#{1,6}\s+/, '')));
        assert.ok(slugs.includes(fragment), `${link.target} fragment must resolve`);
      }
    }
  }
});

test('new glossary meanings are one-sentence lookup entries', () => {
  const glossary = read('docs/GLOSSARY.md');
  for (const term of ['SuperDomestique', 'Commissaire', 'governed autonomy']) {
    const row = glossary.split('\n').find((line) => line.startsWith(`| ${term} |`));
    assert.ok(row, `${term} glossary row`);
    const meaning = row.split('|')[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/`/g, '')
      .trim();
    assert.match(meaning, /^[^.!?]+\.$/, `${term} meaning must contain exactly one terminal sentence boundary`);
  }
});

test('consumer pages do not duplicate canonical paragraphs', () => {
  const canonical = new Set(paragraphs(read(guidePath)).map(normalizeParagraph));
  for (const consumer of ['docs/concept/intro.md', 'docs/concept/what-is-faff.md']) {
    for (const paragraph of paragraphs(read(consumer))) {
      assert.ok(!canonical.has(normalizeParagraph(paragraph)), `${consumer} duplicates a canonical paragraph: ${paragraph}`);
    }
  }
});

test('the tracked historical brief preserves its original body byte for byte', () => {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', briefPath], { cwd: root, stdio: 'ignore' });
  const brief = read(briefPath);
  const notice = /^<!-- faff-positioning-supersession:FAFF-733 -->\n> \*\*Status:\*\* [^\n]+\n<!-- \/faff-positioning-supersession:FAFF-733 -->\n\n/;
  const matches = brief.match(notice);
  assert.ok(matches, 'owned supersession notice must start at byte zero');
  assert.equal((brief.match(/<!-- faff-positioning-supersession:FAFF-733 -->/g) || []).length, 1);
  assert.equal((brief.match(/<!-- \/faff-positioning-supersession:FAFF-733 -->/g) || []).length, 1);
  const originalBody = brief.slice(matches[0].length);
  assert.ok(originalBody.startsWith('# Docs positioning'));
  assert.equal(createHash('sha256').update(originalBody).digest('hex'), '577d78f1beb1f72dd0378c960d7773be6c0ad6e1a35319085cb9ee1922a7083a');
});
