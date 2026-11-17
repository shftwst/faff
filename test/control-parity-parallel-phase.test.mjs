import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const runner = resolve(import.meta.dirname, '../verification/experiments/2026-11-16-skill-diet/run-mcp-workflow-samples-v5.py');
const python = String.raw`import ast
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import threading
import unittest


import sys
RUNNER = Path(sys.argv.pop(1)).resolve()
TREE = ast.parse(RUNNER.read_text())
FUNCTION = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == 'run_phase')
ENVIRONMENT = {'ThreadPoolExecutor': ThreadPoolExecutor, 'as_completed': as_completed, 're': re}
exec(compile(ast.Module(body=[FUNCTION], type_ignores=[]), str(RUNNER), 'exec'), ENVIRONMENT)
RUN_PHASE = ENVIRONMENT['run_phase']


class ParallelPhase(unittest.TestCase):
    def samples(self):
        return [{'name': f'baseline-{index}', 'arm': 'baseline'} for index in range(1, 6)]

    def test_all_five_start_concurrently_and_each_runs_once(self):
        barrier = threading.Barrier(5, timeout=5)
        calls = []
        lock = threading.Lock()

        def work(sample):
            with lock:
                calls.append(sample['name'])
            barrier.wait()

        samples = self.samples()
        result = RUN_PHASE(samples, work)
        self.assertEqual(result['status'], 'pass')
        self.assertEqual(sorted(calls), sorted(row['name'] for row in samples))
        self.assertEqual(list(result['samples']), [row['name'] for row in samples])

    def test_failure_preserves_all_original_results_and_never_retries(self):
        barrier = threading.Barrier(5, timeout=5)
        calls = []
        lock = threading.Lock()

        def work(sample):
            with lock:
                calls.append(sample['name'])
            barrier.wait()
            if sample['name'] == 'baseline-3':
                raise RuntimeError('deliberate registered sample failure')

        result = RUN_PHASE(self.samples(), work)
        self.assertEqual(result['status'], 'fail')
        self.assertEqual(len(calls), 5)
        self.assertEqual(len(set(calls)), 5)
        self.assertEqual(sum(row['status'] == 'pass' for row in result['samples'].values()), 4)
        self.assertEqual(result['samples']['baseline-3']['error'], 'deliberate registered sample failure')

    def test_invalid_phase_launches_nothing(self):
        for samples in [[], self.samples()[:-1], self.samples() + [self.samples()[0]], [self.samples()[0]] * 5,
                        [*self.samples()[:-1], {'name': 'candidate-1', 'arm': 'candidate'}],
                        [*self.samples()[:-1], {'name': '../baseline-1', 'arm': 'baseline'}],
                        [*self.samples()[:-1], {'name': 'unexpected', 'arm': 'unknown'}]]:
            with self.subTest(samples=samples):
                calls = []
                with self.assertRaises(ValueError):
                    RUN_PHASE(samples, calls.append)
                self.assertEqual(calls, [])

    def test_system_exit_is_a_retained_sample_failure(self):
        barrier = threading.Barrier(5, timeout=5)
        calls = []
        lock = threading.Lock()

        def work(sample):
            with lock:
                calls.append(sample['name'])
            barrier.wait()
            if sample['name'] == 'baseline-2':
                raise SystemExit('output appeared before worker start')

        result = RUN_PHASE(self.samples(), work)
        self.assertEqual(result['status'], 'fail')
        self.assertEqual(len(set(calls)), 5)
        self.assertEqual(len(result['samples']), 5)
        self.assertEqual(result['samples']['baseline-2']['error'], 'output appeared before worker start')


if __name__ == '__main__':
    unittest.main()
`;

for (const name of ['test_all_five_start_concurrently_and_each_runs_once', 'test_failure_preserves_all_original_results_and_never_retries', 'test_invalid_phase_launches_nothing', 'test_system_exit_is_a_retained_sample_failure']) {
  test(name, () => {
    const result = spawnSync('python3', ['-c', python, runner, 'ParallelPhase.' + name], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}
