// Pure decision logic for the weekly Diapri price-list job (no I/O, unit-tested).
// The job runs Friday 10:00 IST and then hourly; these helpers decide whether a
// run can stop early, whether a listing counts as new, and when to warn the owner.

export const ALERT_MISSING_FROM_HOUR_IST = 18;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Date parts in India time (the server runs in UTC). */
export function istParts(now) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { ymd: ist.toISOString().slice(0, 10), dow: ist.getUTCDay(), hour: ist.getUTCHours() };
}

/** Key for the current list week: the IST date of the most recent Friday (today if Friday). */
export function weekKey(now) {
  const { dow } = istParts(now);
  const daysSinceFriday = (dow + 2) % 7; // Fri=0, Sat=1, ... Thu=6
  return istParts(new Date(now.getTime() - daysSinceFriday * DAY_MS)).ymd;
}

/** Stored state, reset when a new week begins (last_seen carries over). */
export function stateForWeek(prev, week) {
  if (prev && prev.week === week) return { ...prev };
  return { week, loaded: false, alertedLoaded: false, alertedMissing: false, last_seen: prev?.last_seen || null };
}

/** Already loaded this week ⇒ later hourly runs exit immediately. */
export function shouldStop(state) {
  return Boolean(state?.loaded);
}

/** Same newest file (id + modified time) as the last run ⇒ nothing new, skip the download. */
export function listingUnchanged(listed, lastSeen) {
  return Boolean(listed && lastSeen && listed.id === lastSeen.id && listed.modified === lastSeen.modified);
}

/** A parsed list is new only if its printed date moves forward (strict). */
export function dateAdvanced(detectedDate, storedDate) {
  if (!detectedDate) return false;
  return !storedDate || detectedDate > storedDate;
}

/** One "still not uploaded" message per week, from 18:00 IST. */
export function shouldAlertMissing(state, hourIST) {
  return !state.loaded && !state.alertedMissing && hourIST >= ALERT_MISSING_FROM_HOUR_IST;
}

/** The weekly list is printed with that Friday's date, so stored data dated on/after it means this week is done. */
export function listIsCurrent(storedDate, week) {
  return Boolean(storedDate) && storedDate >= week;
}
