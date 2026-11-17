import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function consumeSpecReviewArtifact(root, text, cwd) {
  const blocks = [...text.matchAll(/^```faff-contract:spec-review-verdict\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)];
  if (blocks.length !== 1) return { pass: false, problem: 'one-contract-block-required' };
  let producer;
  try { producer = JSON.parse(blocks[0][1]); } catch { return { pass: false, problem: 'invalid-contract-json' }; }
  const call = (args, input) => {
    const result = spawnSync(process.execPath, [join(root, 'plugin/skills/faff/bin/faff'), ...args], {
      cwd, input: JSON.stringify(input), encoding: 'utf8', timeout: 15000,
      env: { ...process.env, FAFF_RUN_DIR: '' },
    });
    let value = null;
    try { value = JSON.parse(result.stdout); } catch { /* Retain the CLI output for diagnosis. */ }
    return { exit_code: result.status, stdout: result.stdout, stderr: result.stderr, value };
  };
  const contract = call(['contract', 'spec-review-verdict'], producer);
  const valid = contract.exit_code === 0 && contract.value?.violations?.length === 0;
  const route = valid && producer.verdict === 'reject-approach' ? call(['spec-review', 'route'], contract.value) : null;
  return { pass: valid && (!route || route.exit_code === 0), producer_value: producer, contract, route };
}
