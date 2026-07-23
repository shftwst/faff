// FAFF-538 — shared here-doc extraction for the external-verification scaffolder lints.
//
// Promoted verbatim (behaviour-preserving) out of scaffolder-lights-out-dials.test.mjs so the
// two scaffolder-lint test files (dial-coherence + cli-surface-drift) share one extraction
// regex rather than keeping two independent copies — a second copy of the regex is itself a
// drift risk (the repo's shared-logic-has-one-home value). Zero-dependency; per ADR 0002.

/**
 * Extract the body of the first `cat > <target> <<'EOF' ... EOF` here-doc in a scaffolder script
 * that materialises the given target path. Returns null if no such here-doc is present.
 * @param {string} scriptText  the full scaffolder shell source
 * @param {string} target      the here-doc's target path, e.g. ".faffrc.yaml" or "RUNBOOK.md"
 * @returns {string | null}    the here-doc body, or null when absent
 */
export function extractHeredoc(scriptText, target) {
  const re = new RegExp(`cat > ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} <<'EOF'\\n([\\s\\S]*?)\\nEOF`);
  const m = scriptText.match(re);
  return m ? m[1] : null;
}
