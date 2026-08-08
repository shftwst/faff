import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const paths = {
  readme: `${root}README.md`,
  landing: `${root}website/src/pages/index.js`,
  config: `${root}website/docusaurus.config.js`,
  positioning: `${root}docs/concept/positioning-and-language.md`,
  audit: `${root}docs/audits/2026-08-07-FAFF-732-public-trust-claims.md`,
};

const governedAutonomy =
  'Governed autonomy reduces scheduled human attention only when named controls, evidence and failure paths earn trust for a workload.';

for (const [name, path] of Object.entries(paths)) {
  assert.equal(existsSync(path), true, `${name} must resolve from the repository root`);
}

const readme = readFileSync(paths.readme, 'utf8');
const landing = readFileSync(paths.landing, 'utf8').replace(/\s+/g, ' ');
const config = readFileSync(paths.config, 'utf8');

test('README states the governed-autonomy position and current boundaries', () => {
  assert.match(readme, /^# SuperDomestique/m);
  assert.match(readme, /SuperDomestique, currently shipped as `faff`/);
  assert.match(readme, new RegExp(governedAutonomy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(readme, /Commissaire is not a separately shipped component/);
  assert.match(readme, /L3[\s\S]*park[\s\S]*run ledger/i);
  assert.match(readme, /L4 mechanisms exist[\s\S]*remain incomplete/i);
  assert.doesNotMatch(readme, /\*Faff\* \(n\.\):|tedious palaver/i);
});

test('website landing page carries the same product and maturity distinction', () => {
  assert.match(landing, /<h1>SuperDomestique<\/h1>/);
  assert.match(landing, /Currently shipped as <code>faff<\/code>/);
  assert.match(landing, new RegExp(governedAutonomy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(landing, /Commissaire names the governance responsibility/);
  assert.match(landing, /not a separately shipped component or security boundary/);
  assert.match(landing, /L4-complete claim remains incomplete/);
});

test('site brand metadata changes without changing its route surface', () => {
  assert.equal((config.match(/title: 'SuperDomestique'/g) ?? []).length, 2);
  assert.match(config, /tagline: 'Governed autonomous delivery, currently shipped as faff\.'/);
  assert.match(config, /docId: 'adopting-by-change-class'/);
  assert.match(config, /docId: 'positioning-and-language'/);
  assert.match(config, /href: 'https:\/\/github\.com\/shftwst\/faff'/);
  assert.match(landing, /to="\/guide\/adopting-by-change-class"/);
  assert.match(landing, /to="\/concept\/positioning-and-language"/);
});
