/**
 * Access eligibility rule, shared by the login callback and per-request
 * auth so the two never drift. A user may use the product if EITHER:
 *   - they pass the open bar: human-verified on Ethos AND score >= MIN_SCORE, or
 *   - they're on the manual allowlist (an override for anyone below the bar).
 *
 * The allowlist half is checked separately (it needs a DB call); this module
 * owns the score/verification half and the threshold constant.
 */
export const MIN_SCORE = 1800;

export function meetsScoreVerificationBar(input: {
  score?: number | null;
  humanVerificationStatus?: string | null;
}): boolean {
  return (
    input.humanVerificationStatus === "VERIFIED" &&
    typeof input.score === "number" &&
    input.score >= MIN_SCORE
  );
}
