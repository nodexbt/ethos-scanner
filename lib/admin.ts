/**
 * Admin profile IDs can delete/share/modify any investigation regardless
 * of ownership. Comma-separated in env, read fresh on every call so
 * updates take effect without a redeploy.
 */
export function getAdminProfileIds(): number[] {
  return (process.env.ETHOS_ADMIN_PROFILE_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export function isAdminProfileId(profileId: number): boolean {
  return getAdminProfileIds().includes(profileId);
}
