// Pure session-security logic — office-TOTP device gate, deactivation logout,
// and 15-day forced reauth. Kept side-effect-free so the expiry/trust math is
// unit-testable. See SSJ_STABLE_FEATURES.md §19 for the full design writeup.
//
// Device identity (for the TOTP gate) is no longer a localStorage token —
// it's a `ssj_device_id` cookie scoped to Domain=.gemtre.in, set server-side
// by each app's office-totp-check.js/device-check.js proxy, so the same
// browser is recognized across ssjbots/ssj-hr/fms-tracker. See those files.

export const REAUTH_DAYS_DEFAULT = 15;
export const DEVICE_TRUST_DAYS_DEFAULT = 30;
export const SESSION_POLL_MS = 5 * 60 * 1000; // 5 minutes

// Superadmin is exempt from the 15-day reauth clock. Everyone else must have
// authenticated (password login) within `reauthDays`, tracked via user.authAt
// (ms epoch, stamped at login — see App.jsx login()/onLogin).
export function isSessionExpired(user, nowMs, reauthDays = REAUTH_DAYS_DEFAULT) {
  if (user?.role === "superadmin") return false;
  if (!user?.authAt) return true;
  return nowMs - user.authAt > reauthDays * 86400000;
}

// Combines deactivation + reauth expiry — either one forces a logout.
export function shouldForceLogout({ active, user, nowMs, reauthDays = REAUTH_DAYS_DEFAULT }) {
  if (active === false) return true;
  return isSessionExpired(user, nowMs, reauthDays);
}

// Whether a trusted_devices row is still within its trust window.
export function isTrustedUntilValid(trustedUntil, nowMs) {
  if (!trustedUntil) return false;
  return new Date(trustedUntil).getTime() > nowMs;
}
