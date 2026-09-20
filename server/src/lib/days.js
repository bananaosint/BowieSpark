// SQLite has no array column, so Session.days is a JSON-encoded string.
// Every read/write of that field goes through here.
import { DAY_CODES } from './constants.js';

export function encodeDays(days) {
  if (!Array.isArray(days)) return '[]';
  const clean = days
    .map((d) => String(d).toUpperCase())
    .filter((d) => DAY_CODES.includes(d));
  // De-duplicate and keep canonical Mon→Fri order.
  return JSON.stringify(DAY_CODES.filter((d) => clean.includes(d)));
}

export function decodeDays(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((d) => DAY_CODES.includes(d))
      : [];
  } catch {
    // A malformed row should not take down a whole listing.
    return [];
  }
}

// Recurrence is expanded at read time — there are no materialized occurrence
// rows. `daily` means every school day regardless of the days field.
export function sessionRunsOn(session, dayCode) {
  if (!DAY_CODES.includes(dayCode)) return false;
  if (session.recurrenceType === 'daily') return true;
  return decodeDays(session.days).includes(dayCode);
}
