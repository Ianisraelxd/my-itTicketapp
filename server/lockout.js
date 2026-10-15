// Progressive lockout: every time an account is locked again without a successful sign-in in between, the
// lock gets longer. A person who mistyped once is back in a few minutes; someone hammering the account
// is slowed to a crawl, and from the 4th lock the admins are told.
//
//   5 wrong passwords in a row         -> a 10 second cooldown (the page shows a countdown)
//   10 wrong passwords                 -> lock level 1, then every further 5 wrong passwords lock again
//   a correct sign-in, or 24 hours without a mistake, starts again from level 0

export const COOLDOWN_AFTER = 5;
export const COOLDOWN_SECONDS = 10;
export const LOCK_AFTER = 10; // wrong passwords in a row before the first lock
export const RELOCK_AFTER = 5; // wrong passwords after a lock before the next one
export const FORGET_AFTER_HOURS = 24;
export const ALERT_FROM_LEVEL = 4; // admins are notified from this lock onwards

// level 1, 2, 3 ... in minutes; the last value is used for every level after it
const LOCK_MINUTES = [5, 15, 60, 360, 1440];

/** Minutes the account stays locked at this lock level (1 = first lock). */
export function lockMinutes(level) {
  const index = Math.min(Math.max(level, 1), LOCK_MINUTES.length) - 1;
  return LOCK_MINUTES[index];
}

/** "5 minutes", "1 hour", "24 hours" */
export function describeMinutes(minutes) {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * What a wrong password does to an account.
 * @param {{failed_logins: number, lock_level: number, last_failed_at: Date|string|null}} account
 * @param {number} now  ms since 1970 (injectable for tests)
 * @returns {{action: "none"|"cooldown"|"lock", failed: number, level: number, minutes?: number}}
 */
export function onWrongPassword(account, now = Date.now()) {
  let level = Number(account.lock_level) || 0;
  let failed = Number(account.failed_logins) || 0;
  const last = account.last_failed_at ? new Date(account.last_failed_at).getTime() : 0;
  // An old story is forgotten: a mistake after a quiet day starts fresh.
  if (last && now - last > FORGET_AFTER_HOURS * 3600 * 1000) {
    level = 0;
    failed = 0;
  }
  failed += 1;
  if (failed >= LOCK_AFTER) {
    level += 1;
    // After a lock the counter restarts half-way, so it takes RELOCK_AFTER more mistakes to lock again.
    return { action: "lock", failed: LOCK_AFTER - RELOCK_AFTER, level, minutes: lockMinutes(level) };
  }
  if (failed === COOLDOWN_AFTER) return { action: "cooldown", failed, level };
  return { action: "none", failed, level };
}
