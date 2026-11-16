import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
export function consumeArchitectureArtifact(root, text, cwd) {
  const blocks = [...text.matchAll(/^```faff-contract:architecture-proposal\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)];
  if (blocks.length !== 1) return { pass: false, problem: 'one-contract-block-required' };
  let value;
  try { value = JSON.parse(blocks[0][1]); } catch { return { pass: false, problem: 'invalid-contract-json' }; }
  const result = spawnSync(process.execPath, [join(root, 'plugin/skills/faff/bin/faff'), 'contract', 'architecture-proposal'], { cwd, input: JSON.stringify(value), encoding: 'utf8', timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
  let output = null;
  try { output = JSON.parse(result.stdout); } catch { /* The recorded CLI response remains available for diagnosis. */ }
  return { pass: result.status === 0 && output?.violations?.length === 0, exit_code: result.status, stdout: result.stdout, stderr: result.stderr, producer_value: value, value: output };
}
