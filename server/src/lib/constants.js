// Shared vocabulary. Enum *values* mirror prisma/schema.prisma exactly —
// if you change one, change both.

export const ROLES = ['student', 'teacher', 'admin'];
export const RECURRENCE_TYPES = ['daily', 'specific_days'];
export const ENROLLMENT_STATUSES = ['self_selected', 'teacher_override'];
export const ATTENDANCE_STATUSES = ['present', 'tardy', 'absent', 'cut'];
export const CUTOFF_SCOPES = ['global', 'per_session'];

// School week. FIT does not run on weekends, so the weekly view is Mon–Fri.
export const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
export const DAY_LABELS = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
};

// Build sheet §3: student accounts are gated to this domain, staff to the
// district staff domain. Validated server-side, never only in the browser.
export const STUDENT_EMAIL_DOMAIN = 'stu.austinisd.org';
export const STAFF_EMAIL_DOMAIN = 'austinisd.org';

export const POLICY_KEYS = {
  TEACHER_OVERRIDE_NOTICE: 'teacher_override_notice',
};

export const DESCRIPTION_WORD_LIMIT = 50;
