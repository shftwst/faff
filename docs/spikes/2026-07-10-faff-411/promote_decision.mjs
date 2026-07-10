// FAFF-411 spike scratch — PURE promote decision.
//
// promote_decision(armOpus, armSonnet, params)
//   -> { verdict: 'promote' | 'hold' | 'inconclusive', score, per_lever_reasons }
//
// The deterministic decision function from the spec §3. Its `promote_model` param
// block IS the future controller's objective + action surface. No I/O — pure over
// two ArmResults. Same inputs -> same verdict, always.
//
// Arm shape (both arms):
//   { n, cost_per_attempted, park_rate, rework_rate, needs_human_rate, gate_regime }
//   - n                : attempted-issue count for the arm
//   - cost_per_attempted: tokens (or $) per ATTEMPTED issue (counts waste, not just wins)
//   - park_rate        : 0..1 fraction parked / abandoned
//   - rework_rate      : 0..1 fraction needing an iterate/fix cycle
//   - needs_human_rate : 0..1 fraction escalated to a human
//   - gate_regime      : categorical tag for the gate strictness the arm ran under
//                        (fidelity parity: comparing across regimes is not admissible)
//
// The fidelity levers (park/rework/needs_human/gate_regime) are the VETO in veto mode:
// a cheaper model that ships more waste is not a win. cost_per_attempted is the value
// lever that must actually improve to justify a promote.

// Lever taxonomy.
const VALUE_LEVERS = ['cost_per_attempted'];
const FIDELITY_LEVERS = ['park_rate', 'rework_rate', 'needs_human_rate'];
// gate_regime is a categorical parity lever, handled separately.

export const DEFAULT_PROMOTE_MODEL = Object.freeze({
  min_n_per_arm: 8, // below this, no arm is trustworthy -> inconclusive
  mode: 'veto', // 'veto' (fidelity can hard-block) | 'score' (weighted sum only)
  levers: Object.freeze({
    // cost: sonnet must be cheaper per ATTEMPTED issue by at least this fraction to count.
    cost_per_attempted: Object.freeze({ direction: 'lower_better', improve_by: 0.15, weight: 1.0 }),
    // fidelity: sonnet may not REGRESS beyond `tolerance` (absolute rate delta). Veto if it does.
    park_rate: Object.freeze({ direction: 'lower_better', tolerance: 0.05, weight: 2.0, veto: true }),
    rework_rate: Object.freeze({ direction: 'lower_better', tolerance: 0.1, weight: 1.5, veto: true }),
    needs_human_rate: Object.freeze({ direction: 'lower_better', tolerance: 0.05, weight: 2.0, veto: true }),
    // gate_regime: parity required. Mismatch => not comparable => veto in veto mode.
    gate_regime: Object.freeze({ direction: 'match', weight: 0, veto: true }),
  }),
});

function num(x) {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/**
 * @returns {{verdict:'promote'|'hold'|'inconclusive', score:number|null, per_lever_reasons:Array}}
 */
export function promote_decision(armOpus = {}, armSonnet = {}, params = {}) {
  const pm = {
    ...DEFAULT_PROMOTE_MODEL,
    ...(params.promote_model || params),
    levers: {
      ...DEFAULT_PROMOTE_MODEL.levers,
      ...((params.promote_model && params.promote_model.levers) || params.levers || {}),
    },
  };

  const reasons = [];

  // --- Gate 0: sufficient N per arm ---------------------------------------
  const nOpus = num(armOpus.n);
  const nSonnet = num(armSonnet.n);
  if (nOpus === null || nSonnet === null || nOpus < pm.min_n_per_arm || nSonnet < pm.min_n_per_arm) {
    reasons.push({
      lever: 'min_n_per_arm',
      opus: nOpus,
      sonnet: nSonnet,
      threshold: pm.min_n_per_arm,
      pass: false,
      reason: `insufficient N (opus=${nOpus}, sonnet=${nSonnet}, need >= ${pm.min_n_per_arm} per arm)`,
    });
    return { verdict: 'inconclusive', score: null, per_lever_reasons: reasons };
  }

  let vetoed = false;
  let weightedScore = 0; // + favours promote, - favours hold

  // --- gate_regime parity -------------------------------------------------
  const grSpec = pm.levers.gate_regime;
  if (grSpec) {
    const match = armOpus.gate_regime === armSonnet.gate_regime;
    reasons.push({
      lever: 'gate_regime',
      opus: armOpus.gate_regime ?? null,
      sonnet: armSonnet.gate_regime ?? null,
      pass: match,
      reason: match
        ? 'gate regimes match — arms comparable'
        : 'gate regimes differ — arms not comparable',
    });
    if (!match && grSpec.veto && pm.mode === 'veto') vetoed = true;
  }

  // --- fidelity levers ----------------------------------------------------
  for (const lever of FIDELITY_LEVERS) {
    const spec = pm.levers[lever];
    if (!spec) continue;
    const o = num(armOpus[lever]);
    const s = num(armSonnet[lever]);
    if (o === null || s === null) {
      reasons.push({ lever, opus: o, sonnet: s, pass: false, reason: `missing ${lever} on an arm` });
      if (spec.veto && pm.mode === 'veto') vetoed = true;
      continue;
    }
    const delta = s - o; // >0 means sonnet WORSE (higher park/rework/human rate)
    const regressed = delta > (spec.tolerance ?? 0);
    reasons.push({
      lever,
      opus: o,
      sonnet: s,
      delta: round(delta),
      tolerance: spec.tolerance,
      pass: !regressed,
      reason: regressed
        ? `sonnet regressed ${lever} by ${round(delta)} > tolerance ${spec.tolerance}`
        : `sonnet within ${lever} tolerance (delta ${round(delta)})`,
    });
    // Score: reward improvement (delta<0), penalise regression, weighted.
    weightedScore += -delta * (spec.weight ?? 1);
    if (regressed && spec.veto && pm.mode === 'veto') vetoed = true;
  }

  // --- value lever(s): cost ----------------------------------------------
  let costImproved = false;
  for (const lever of VALUE_LEVERS) {
    const spec = pm.levers[lever];
    if (!spec) continue;
    const o = num(armOpus[lever]);
    const s = num(armSonnet[lever]);
    if (o === null || s === null || o === 0) {
      reasons.push({ lever, opus: o, sonnet: s, pass: false, reason: `missing/zero ${lever} on an arm` });
      continue;
    }
    const rel = (o - s) / o; // >0 means sonnet cheaper (improvement fraction)
    const improved = rel >= (spec.improve_by ?? 0);
    if (improved) costImproved = true;
    reasons.push({
      lever,
      opus: o,
      sonnet: s,
      improvement_frac: round(rel),
      improve_by: spec.improve_by,
      pass: improved,
      reason: improved
        ? `sonnet ${round(rel * 100)}% cheaper per attempt (>= ${spec.improve_by} required)`
        : `sonnet only ${round(rel * 100)}% cheaper per attempt (< ${spec.improve_by} required)`,
    });
    weightedScore += rel * (spec.weight ?? 1);
  }

  const score = round(weightedScore);

  // --- verdict ------------------------------------------------------------
  let verdict;
  if (pm.mode === 'veto') {
    if (vetoed) verdict = 'hold';
    else verdict = costImproved ? 'promote' : 'hold';
  } else {
    // score mode: purely the weighted sum, no hard veto.
    verdict = score > 0 ? 'promote' : 'hold';
  }

  return { verdict, score, per_lever_reasons: reasons };
}

function round(x) {
  return Math.round(x * 1e4) / 1e4;
}
