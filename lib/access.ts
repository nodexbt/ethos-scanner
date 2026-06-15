/**
 * Access eligibility rule, shared by the login callback and per-request
 * auth so the two never drift. A user may use the product if ANY of:
 *   - they hold an Ethos validator NFT (validatorNftCount > 0), or
 *   - they pass the open bar: human-verified on Ethos AND score >= MIN_SCORE, or
 *   - they're on the manual allowlist (an override for anyone else).
 *
 * The allowlist arm is checked separately (it needs a DB call); this module
 * owns the validator + score/verification arms and the threshold constant.
 */
export const MIN_SCORE = 1800;

export function meetsOpenAccessBar(input: {
  score?: number | null;
  humanVerificationStatus?: string | null;
  validatorNftCount?: number | null;
}): boolean {
  // Validators (NFT holders) get in regardless of score/verification.
  if (typeof input.validatorNftCount === "number" && input.validatorNftCount > 0) {
    return true;
  }
  return (
    input.humanVerificationStatus === "VERIFIED" &&
    typeof input.score === "number" &&
    input.score >= MIN_SCORE
  );
}
