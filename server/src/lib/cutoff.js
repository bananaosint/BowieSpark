// When does a student stop being able to change their pick?
//
// Rule grammar (stored on CutoffConfig.cutoffRule):
//   "T-0"        lock at the bell on the session date — the default, i.e. you
//                can change your mind right up until FIT starts
//   "T-1@21:00"  lock at 9pm the night before
//   "T-2@17:00"  lock at 5pm two days before
//
// All times are school-local. A FIT day is a local calendar date, so the
// server is assumed to run in the school's timezone; see README.
import { fromDateKey, isValidDateKey } from './dates.js';

const RULE = /^T-(\d+)(?:@(\d{1,2}):(\d{2}))?$/i;

export function parseCutoffRule(rule) {
  const match = RULE.exec(String(rule ?? '').trim());
  if (!match) return null;
  const daysBefore = Number(match[1]);
  if (match[2] === undefined) return { daysBefore, hour: null, minute: null };
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  return { daysBefore, hour, minute };
}

export function parseTimeOfDay(value, fallback = { hour: 9, minute: 30 }) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return { hour, minute };
}

// The exact instant a given date's picks freeze.
export function lockTimeFor(dateKey, rule, bellTime) {
  if (!isValidDateKey(dateKey)) return null;
  const parsed = parseCutoffRule(rule);
  if (!parsed) return null;

  const at = new Date(fromDateKey(dateKey));
  at.setDate(at.getDate() - parsed.daysBefore);

  // "T-0" with no time means "until the bell"; anything else carries its own.
  const time =
    parsed.hour === null ? parseTimeOfDay(bellTime) : { hour: parsed.hour, minute: parsed.minute };
  at.setHours(time.hour, time.minute, 0, 0);
  return at;
}

export function isPastCutoff(dateKey, rule, bellTime, now = new Date()) {
  const at = lockTimeFor(dateKey, rule, bellTime);
  // An unparseable rule must not silently throw scheduling wide open.
  if (!at) return true;
  return now.getTime() >= at.getTime();
}

// Per-session config wins over the global one (build sheet §4: scope is
// global | per_session). Falls back to the documented defaults if an admin
// has not configured anything yet.
export function effectiveCutoff(globalConfig, sessionConfig) {
  const chosen = sessionConfig ?? globalConfig ?? null;
  return {
    cutoffRule: chosen?.cutoffRule ?? 'T-0',
    bellTime: chosen?.bellTime ?? '09:30',
    scope: sessionConfig ? 'per_session' : 'global',
  };
}

export function describeCutoff(rule, bellTime) {
  const parsed = parseCutoffRule(rule);
  if (!parsed) return 'Signup cutoff is misconfigured.';
  const time =
    parsed.hour === null
      ? parseTimeOfDay(bellTime)
      : { hour: parsed.hour, minute: parsed.minute };
  const clock = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  if (parsed.daysBefore === 0) {
    return parsed.hour === null
      ? `Locks at the bell (${clock}) on the day.`
      : `Locks at ${clock} on the day.`;
  }
  if (parsed.daysBefore === 1) return `Locks at ${clock} the night before.`;
  return `Locks at ${clock}, ${parsed.daysBefore} days before.`;
}
