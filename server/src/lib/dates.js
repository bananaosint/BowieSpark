// Calendar dates are "YYYY-MM-DD" strings throughout. See schema.prisma.
import { DAY_CODES } from './constants.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  // The shape check alone would accept 2026-02-30, which Date silently rolls
  // forward to March 2nd — a student's pick would land on the wrong day.
  // Round-trip it and require the components to survive unchanged.
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(y, m - 1, d);
  return (
    probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
  );
}

export function toDateKey(date) {
  // Local-date components, NOT toISOString() — that shifts to UTC and can
  // report the wrong school day for anyone west of Greenwich.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey() {
  return toDateKey(new Date());
}

// Sunday=0 in JS; map onto our Mon–Fri codes, null for weekends.
export function dayCodeFor(dateKey) {
  const idx = fromDateKey(dateKey).getDay();
  return idx >= 1 && idx <= 5 ? DAY_CODES[idx - 1] : null;
}

// The Mon–Fri school week containing `dateKey`. Weekend dates roll forward
// to the coming Monday so the homescreen always shows a usable week.
export function schoolWeekOf(dateKey) {
  const date = fromDateKey(dateKey);
  const dow = date.getDay();
  const offsetToMonday = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  const monday = new Date(date);
  monday.setDate(date.getDate() + offsetToMonday);

  return DAY_CODES.map((code, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { dayCode: code, date: toDateKey(d) };
  });
}
