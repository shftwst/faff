import test from 'node:test';
import assert from 'node:assert/strict';
import { tier, tierScore, DEFAULT_PARAMS } from './tier.mjs';

test('tier is deterministic — identical inputs twice give identical bucket', () => {
  const f = { file_count: 3, lines_changed: 120, modules: 1, dep_count: 0, confidence: 'high' };
  const a = tier(f);
  const b = tier(f);
  assert.equal(a, b);
  assert.ok(['mechanical', 'standard', 'complex'].includes(a));
});

test('tier is deterministic with a param override too', () => {
  const f = { file_count: 8, lines_changed: 900, modules: 3, dep_count: 1, confidence: 'medium' };
  const p = { cut: { mechanical: 4, standard: 12 } };
  assert.equal(tier(f, p), tier(f, p));
});

test('a tiny single-file high-confidence change is mechanical', () => {
  const f = { file_count: 1, lines_changed: 20, modules: 1, dep_count: 0, confidence: 'high' };
  // score = 1*1 + 20*0.01 + 1*2 + 0 + confidence(0) = 3.2 <= 8 (mechanical cut)
  assert.equal(tier(f), 'mechanical');
});

test('a mid-size medium-confidence change is standard', () => {
  const f = { file_count: 4, lines_changed: 300, modules: 1, dep_count: 0, confidence: 'medium' };
  // 4 + 3 + 2 + 0 + medium(3) = 12 -> between 8 and 14 -> standard
  const s = tierScore(f);
  assert.ok(s > DEFAULT_PARAMS.cut.mechanical && s <= DEFAULT_PARAMS.cut.standard);
  assert.equal(tier(f), 'standard');
});

test('a big multi-module low-confidence change with a new dep is complex', () => {
  const f = { file_count: 12, lines_changed: 1200, modules: 4, dep_count: 2, confidence: 'low' };
  assert.equal(tier(f), 'complex');
});

test('gate_history bumps an otherwise-mechanical change upward', () => {
  const base = { file_count: 1, lines_changed: 20, modules: 1, dep_count: 0, confidence: 'high' };
  assert.equal(tier(base), 'mechanical');
  const withHistory = { ...base, gate_history: 2 }; // +10
  assert.notEqual(tier(withHistory), 'mechanical');
});

test('lower test_coverage raises the score', () => {
  const covered = { file_count: 3, lines_changed: 100, modules: 1, confidence: 'high', test_coverage: 1 };
  const bare = { ...covered, test_coverage: 0 };
  assert.ok(tierScore(bare) > tierScore(covered));
});

test('unparseable confidence is treated as the default (medium) risk, not high', () => {
  const f = { file_count: 1, lines_changed: 10, modules: 1, dep_count: 0, confidence: 'garbage' };
  const asHigh = { ...f, confidence: 'high' };
  assert.ok(tierScore(f) > tierScore(asHigh));
});
