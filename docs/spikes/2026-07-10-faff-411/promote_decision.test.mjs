import test from 'node:test';
import assert from 'node:assert/strict';
import { promote_decision, DEFAULT_PROMOTE_MODEL } from './promote_decision.mjs';

const regime = 'faffter_dark:adversarial+ci';

function arm(over = {}) {
  return {
    n: 12,
    cost_per_attempted: 10_000_000,
    park_rate: 0.1,
    rework_rate: 0.2,
    needs_human_rate: 0.05,
    gate_regime: regime,
    ...over,
  };
}

test('promote_decision is deterministic — identical inputs twice give identical output', () => {
  const o = arm();
  const s = arm({ cost_per_attempted: 6_000_000 });
  const a = promote_decision(o, s);
  const b = promote_decision(o, s);
  assert.deepEqual(a, b);
  assert.ok(['promote', 'hold', 'inconclusive'].includes(a.verdict));
  assert.ok(Array.isArray(a.per_lever_reasons) && a.per_lever_reasons.length > 0);
});

test('below min_n_per_arm on either arm -> inconclusive', () => {
  const r = promote_decision(arm({ n: 3 }), arm({ n: 12 }));
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.score, null);
  assert.equal(r.per_lever_reasons[0].lever, 'min_n_per_arm');
});

test('cheaper sonnet with no fidelity regression -> promote', () => {
  // sonnet 40% cheaper, fidelity equal-or-better
  const r = promote_decision(
    arm(),
    arm({ cost_per_attempted: 6_000_000, park_rate: 0.1, rework_rate: 0.2, needs_human_rate: 0.05 }),
  );
  assert.equal(r.verdict, 'promote');
  const cost = r.per_lever_reasons.find((x) => x.lever === 'cost_per_attempted');
  assert.ok(cost.pass);
});

test('cheaper sonnet but a fidelity regression beyond tolerance -> hold (veto)', () => {
  // 40% cheaper but park_rate jumps 0.1 -> 0.25 (delta 0.15 > tolerance 0.05)
  const r = promote_decision(arm(), arm({ cost_per_attempted: 6_000_000, park_rate: 0.25 }));
  assert.equal(r.verdict, 'hold');
  const park = r.per_lever_reasons.find((x) => x.lever === 'park_rate');
  assert.equal(park.pass, false);
});

test('no meaningful cost improvement -> hold even with clean fidelity', () => {
  const r = promote_decision(arm(), arm({ cost_per_attempted: 9_800_000 })); // ~2% cheaper < 15%
  assert.equal(r.verdict, 'hold');
});

test('gate_regime mismatch vetoes in veto mode (not comparable) -> hold', () => {
  const r = promote_decision(
    arm(),
    arm({ cost_per_attempted: 5_000_000, gate_regime: 'lenient:ci-only' }),
  );
  assert.equal(r.verdict, 'hold');
  const gr = r.per_lever_reasons.find((x) => x.lever === 'gate_regime');
  assert.equal(gr.pass, false);
});

test('score mode ignores hard veto and decides on the weighted sum', () => {
  const params = { promote_model: { ...DEFAULT_PROMOTE_MODEL, mode: 'score' } };
  // Sonnet is clearly better: 50% cheaper per attempt (+0.5), only a 0.02 park
  // regression (−0.04 at weight 2.0). Weighted sum = 0.46 > 0 -> promote.
  // A sign-flipped score would land <= 0 and fail this, unlike a bare "is one of
  // {promote,hold}" check.
  const r = promote_decision(
    arm(),
    arm({ cost_per_attempted: 5_000_000, park_rate: 0.12 }),
    params,
  );
  assert.equal(typeof r.score, 'number');
  assert.ok(r.score > 0, `expected positive score, got ${r.score}`);
  assert.equal(r.verdict, 'promote');
});
