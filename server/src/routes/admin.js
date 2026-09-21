// Admin tools (build sheet §5): the subject-tag vocabulary, the wording
// students are shown, the signup cutoff, accounts, and usage analytics.
import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAdmin, publicUser } from '../auth/index.js';
import { revokeAllForUser } from '../auth/sessions.js';
import { parseCutoffRule, describeCutoff, effectiveCutoff } from '../lib/cutoff.js';
import { sessionRunsOn } from '../lib/days.js';
import { isValidDateKey, todayKey, toDateKey, fromDateKey, dayCodeFor } from '../lib/dates.js';
import { ROLES, ATTENDANCE_STATUSES, POLICY_KEYS } from '../lib/constants.js';

export const adminRouter = Router();

// Everything below can lock people out or rewrite school-wide policy, so the
// guard sits on the router rather than on each handler — a route added later
// cannot forget it.
adminRouter.use(requireAdmin);

const MAX_TAG_NAME = 40;
const MAX_POLICY_VALUE = 1000;
const MAX_DISPLAY_NAME = 80;
// Enough to cover a school year; the point is to bound the school-day list
// (and the IN clause built from it) that /analytics expands in memory.
const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
// The build sheet wants the worst offenders, not a roster dump.
const UNSCHEDULED_LIMIT = 100;

const CUTOFF_GRAMMAR =
  'cutoffRule must be "T-0" (locks at the bell on the day) or "T-1@21:00" ' +
  '(locks at 21:00 the night before), and bellTime must be HH:MM.';

// parseTimeOfDay() in lib/cutoff.js silently falls back to 09:30 on garbage —
// correct for the rule engine, useless for validating admin input, which would
// otherwise accept "banana" and store the default. Normalized to HH:MM so rows
// stay uniform whatever an admin types.
function normalizeBellTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function serializeTag(tag) {
  return {
    id: tag.id,
    name: tag.name,
    sortOrder: tag.sortOrder,
    active: tag.active,
    createdAt: tag.createdAt,
    sessionCount: tag._count?.sessions ?? 0,
  };
}

// Reads through effectiveCutoff() so the documented defaults live in exactly
// one place, even for a school that has never saved a config.
function serializeCutoff(config) {
  const { cutoffRule, bellTime } = effectiveCutoff(config, null);
  return {
    id: config?.id ?? null,
    scope: config?.scope ?? 'global',
    cutoffRule,
    bellTime,
    description: describeCutoff(cutoffRule, bellTime),
    configured: Boolean(config),
    // The per-session Remove control keys off this. Omitting it left the
    // button rendering but pointing at `undefined`.
    sessionId: config?.sessionId ?? null,
    setByAdminId: config?.setByAdminId ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}

// ------------------------------------------------------------- subject tags

// Admin-editable per build sheet §3 — a table, never an enum. Inactive tags
// are included: they still hold existing sessions and must be revivable.
adminRouter.get('/subject-tags', async (_req, res, next) => {
  try {
    const tags = await prisma.subjectTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { sessions: true } } },
    });
    res.json({ subjectTags: tags.map(serializeTag) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/subject-tags', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name || name.length > MAX_TAG_NAME) {
      return res.status(400).json({
        error: 'bad_request',
        message: `Tag name is required and must be ${MAX_TAG_NAME} characters or fewer.`,
      });
    }

    let sortOrder;
    if (req.body?.sortOrder !== undefined && req.body?.sortOrder !== null) {
      sortOrder = Number(req.body.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'sortOrder must be a whole number, 0 or greater.' });
      }
    }

    // The unique index is exact-case and SQLite's `=` is case-sensitive, so
    // "math" next to "Math" would sail through the database. There are a
    // handful of tags — comparing them in JS is the cheap, correct check.
    const existing = await prisma.subjectTag.findMany({ select: { name: true, sortOrder: true } });
    if (existing.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      return res
        .status(409)
        .json({ error: 'name_taken', message: `There is already a subject tag called "${name}".` });
    }

    if (sortOrder === undefined) {
      sortOrder = existing.reduce((max, tag) => Math.max(max, tag.sortOrder), -1) + 1;
    }

    try {
      const tag = await prisma.subjectTag.create({ data: { name, sortOrder } });
      res.status(201).json({ subjectTag: serializeTag(tag) });
    } catch (err) {
      // Backstop for two admins adding the same tag at once.
      if (err.code === 'P2002') {
        return res
          .status(409)
          .json({ error: 'name_taken', message: `There is already a subject tag called "${name}".` });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Declared before the /:id handlers so "reorder" is never read as an id.
adminRouter.put('/subject-tags/reorder', async (req, res, next) => {
  try {
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'orderedIds must be an array of tag ids.' });
    }

    const tags = await prisma.subjectTag.findMany({ select: { id: true } });
    const known = new Set(tags.map((tag) => tag.id));
    const given = new Set(orderedIds);

    // A partial list would leave the tags it omits sharing sortOrder values
    // with the reordered ones, so the whole set has to be named exactly once.
    if (given.size !== orderedIds.length || given.size !== known.size || orderedIds.some((id) => !known.has(id))) {
      return res.status(400).json({
        error: 'bad_request',
        message: `orderedIds must list every existing tag exactly once (${known.size} expected).`,
      });
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.subjectTag.update({ where: { id }, data: { sortOrder: index } })
      )
    );

    const reordered = await prisma.subjectTag.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { sessions: true } } },
    });
    res.json({ subjectTags: reordered.map(serializeTag) });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/subject-tags/:id', async (req, res, next) => {
  try {
    const tag = await prisma.subjectTag.findUnique({ where: { id: req.params.id } });
    if (!tag) return res.status(404).json({ error: 'not_found', message: 'No such subject tag.' });

    const data = {};

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > MAX_TAG_NAME) {
        return res.status(400).json({
          error: 'bad_request',
          message: `Tag name is required and must be ${MAX_TAG_NAME} characters or fewer.`,
        });
      }
      const clash = await prisma.subjectTag.findMany({
        where: { id: { not: tag.id } },
        select: { name: true },
      });
      if (clash.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
        return res
          .status(409)
          .json({ error: 'name_taken', message: `There is already a subject tag called "${name}".` });
      }
      data.name = name;
    }

    if (req.body?.sortOrder !== undefined) {
      const sortOrder = Number(req.body.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'sortOrder must be a whole number, 0 or greater.' });
      }
      data.sortOrder = sortOrder;
    }

    if (req.body?.active !== undefined) {
      if (typeof req.body.active !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'active must be true or false.' });
      }
      data.active = req.body.active;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Nothing to update. Send name, sortOrder or active.',
      });
    }

    try {
      const updated = await prisma.subjectTag.update({
        where: { id: tag.id },
        data,
        include: { _count: { select: { sessions: true } } },
      });
      res.json({ subjectTag: serializeTag(updated) });
    } catch (err) {
      // Same race as the create path — a rename must not land as a 500 here
      // when the identical collision returns 409 from POST.
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: 'name_taken',
          message: `There is already a subject tag called "${data.name}".`,
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/subject-tags/:id', async (req, res, next) => {
  try {
    const tag = await prisma.subjectTag.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { sessions: true } } },
    });
    if (!tag) return res.status(404).json({ error: 'not_found', message: 'No such subject tag.' });

    // Session.subjectTag has no cascade — deleting a tag in use would fail at
    // the database anyway, and even if it didn't, it would orphan real
    // sessions. Deactivating hides it from the create form and keeps history.
    if (tag._count.sessions > 0) {
      return res.status(409).json({
        error: 'tag_in_use',
        message:
          `"${tag.name}" is used by ${tag._count.sessions} session(s), so it cannot be deleted. ` +
          'Set it inactive instead — it will disappear from new sessions and keep the existing ones.',
        sessionCount: tag._count.sessions,
      });
    }

    try {
      await prisma.subjectTag.delete({ where: { id: tag.id } });
    } catch (err) {
      // Backstop for a session created against this tag between the count
      // above and the delete. SQLite raises the FK violation as P2003; the
      // answer is the same 409 the pre-check gives, not a 500.
      if (err.code === 'P2003') {
        return res.status(409).json({
          error: 'tag_in_use',
          message:
            `"${tag.name}" was just used by a new session, so it cannot be deleted. ` +
            'Set it inactive instead.',
        });
      }
      throw err;
    }
    res.json({ ok: true, deletedId: tag.id });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------- policy text

adminRouter.get('/policy-text', async (_req, res, next) => {
  try {
    const rows = await prisma.policyText.findMany({
      orderBy: { key: 'asc' },
      include: { updatedBy: { select: { id: true, displayName: true } } },
    });
    res.json({
      // The editor has to offer keys that have never been written yet, so the
      // set the app actually reads travels with the rows.
      knownKeys: Object.values(POLICY_KEYS),
      policyText: rows.map((row) => ({
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/policy-text/:key', async (req, res, next) => {
  try {
    const key = String(req.params.key ?? '').trim();
    // PolicyText.key is the primary key and is looked up by constant, so a
    // stray space or capital would quietly create a second, unread row.
    if (!/^[a-z0-9_]{1,60}$/.test(key)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'key must be lowercase letters, numbers and underscores (60 characters max).',
      });
    }

    // Trimmed because this is rendered straight into the student's banner,
    // where stray whitespace shows up as an odd gap.
    const value = String(req.body?.value ?? '').trim();
    if (!value) {
      return res.status(400).json({ error: 'bad_request', message: 'value is required.' });
    }
    if (value.length > MAX_POLICY_VALUE) {
      return res.status(400).json({
        error: 'bad_request',
        message: `value must be ${MAX_POLICY_VALUE} characters or fewer.`,
      });
    }

    const row = await prisma.policyText.upsert({
      where: { key },
      create: { key, value, updatedById: req.user.id },
      update: { value, updatedById: req.user.id },
      include: { updatedBy: { select: { id: true, displayName: true } } },
    });

    res.json({
      policyText: {
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------- cutoff

adminRouter.get('/cutoff', async (_req, res, next) => {
  try {
    const [globalConfig, overrides] = await Promise.all([
      prisma.cutoffConfig.findFirst({ where: { scope: 'global' }, orderBy: { id: 'asc' } }),
      prisma.cutoffConfig.findMany({
        where: { sessionId: { not: null } },
        include: {
          session: {
            select: {
              id: true,
              title: true,
              active: true,
              teacher: { select: { id: true, displayName: true } },
            },
          },
        },
      }),
    ]);

    res.json({
      global: serializeCutoff(globalConfig),
      perSession: overrides
        .map((config) => ({ ...serializeCutoff(config), session: config.session }))
        .sort((a, b) => (a.session?.title ?? '').localeCompare(b.session?.title ?? '')),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.put('/cutoff', async (req, res, next) => {
  try {
    const cutoffRule = String(req.body?.cutoffRule ?? '').trim();
    if (!parseCutoffRule(cutoffRule)) {
      return res.status(400).json({ error: 'bad_cutoff_rule', message: CUTOFF_GRAMMAR });
    }
    const bellTime = normalizeBellTime(req.body?.bellTime);
    if (!bellTime) {
      return res.status(400).json({ error: 'bad_cutoff_rule', message: CUTOFF_GRAMMAR });
    }

    const rawSessionId = req.body?.sessionId;
    const sessionId =
      rawSessionId === undefined || rawSessionId === null || rawSessionId === ''
        ? null
        : String(rawSessionId);

    if (sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true, title: true, active: true },
      });
      if (!session) {
        return res.status(404).json({ error: 'not_found', message: 'No such session.' });
      }

      const config = await prisma.cutoffConfig.upsert({
        where: { sessionId },
        create: { scope: 'per_session', cutoffRule, bellTime, sessionId, setByAdminId: req.user.id },
        update: { scope: 'per_session', cutoffRule, bellTime, setByAdminId: req.user.id },
      });
      return res.json({ cutoff: { ...serializeCutoff(config), session } });
    }

    // SQLite treats every NULL as distinct, so @@unique on the nullable
    // sessionId cannot enforce "one global row" — this transaction does:
    // update the oldest and sweep any strays a previous bug left behind.
    const config = await prisma.$transaction(async (tx) => {
      const data = { scope: 'global', cutoffRule, bellTime, sessionId: null, setByAdminId: req.user.id };
      const existing = await tx.cutoffConfig.findFirst({
        where: { scope: 'global' },
        orderBy: { id: 'asc' },
      });
      if (!existing) return tx.cutoffConfig.create({ data });
      await tx.cutoffConfig.deleteMany({ where: { scope: 'global', id: { not: existing.id } } });
      return tx.cutoffConfig.update({ where: { id: existing.id }, data });
    });

    res.json({ cutoff: serializeCutoff(config) });
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/cutoff/:sessionId', async (req, res, next) => {
  try {
    const { count } = await prisma.cutoffConfig.deleteMany({
      where: { sessionId: req.params.sessionId },
    });
    if (count === 0) {
      return res
        .status(404)
        .json({ error: 'not_found', message: 'That session has no cutoff override.' });
    }
    res.json({
      ok: true,
      sessionId: req.params.sessionId,
      message: 'Session now follows the global cutoff.',
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- accounts

adminRouter.get('/users', async (req, res, next) => {
  try {
    const role = req.query.role ? String(req.query.role) : null;
    if (role && !ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: `role must be one of: ${ROLES.join(', ')}.` });
    }
    const q = String(req.query.q ?? '').trim();

    const users = await prisma.user.findMany({
      where: {
        ...(role ? { role } : {}),
        // No mode:'insensitive' here — the sqlite connector rejects that flag,
        // and it isn't needed: SQLite's LIKE is already case-insensitive for
        // ASCII, which is all a school address or display name contains.
        ...(q ? { OR: [{ displayName: { contains: q } }, { email: { contains: q } }] } : {}),
      },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      include: { _count: { select: { sessionsTaught: true, enrollments: true } } },
    });

    res.json({
      users: users.map((user) => ({
        ...publicUser(user),
        sessionCount: user._count.sessionsTaught,
        enrollmentCount: user._count.enrollments,
      })),
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'not_found', message: 'No such user.' });

    const data = {};

    if (req.body?.displayName !== undefined) {
      const displayName = String(req.body.displayName).trim();
      if (!displayName || displayName.length > MAX_DISPLAY_NAME) {
        return res.status(400).json({
          error: 'bad_request',
          message: `displayName is required and must be ${MAX_DISPLAY_NAME} characters or fewer.`,
        });
      }
      data.displayName = displayName;
    }

    if (req.body?.role !== undefined) {
      if (!ROLES.includes(req.body.role)) {
        return res
          .status(400)
          .json({ error: 'bad_request', message: `role must be one of: ${ROLES.join(', ')}.` });
      }
      data.role = req.body.role;
    }

    if (req.body?.active !== undefined) {
      if (typeof req.body.active !== 'boolean') {
        return res
          .status(400)
          .json({ error: 'bad_request', message: 'active must be true or false.' });
      }
      data.active = req.body.active;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'Nothing to update. Send active, role or displayName.',
      });
    }

    const finalRole = data.role ?? target.role;
    const finalActive = data.active ?? target.active;

    // Demoting or switching off your own admin account is how a school ends up
    // with nobody who can turn it back on. Renaming yourself stays allowed.
    if (target.id === req.user.id && (finalRole !== 'admin' || finalActive === false)) {
      return res.status(409).json({
        error: 'cannot_self_modify',
        message:
          'You cannot demote or deactivate your own admin account. Ask another administrator to do it.',
      });
    }

    // Unreachable behind the guard above while the only way in is a logged-in
    // admin, but this is the invariant that actually matters, so it is checked
    // against the database rather than inferred from who is calling.
    // Counting and then writing in two steps is a check-then-act race: two
    // admins demoting each other at the same moment both see a count of 2,
    // both pass, and the school is left with no administrator and no way back
    // in. The count and the write go in one transaction so the loser sees the
    // winner's row.
    const losesLastAdmin =
      target.role === 'admin' && target.active && !(finalRole === 'admin' && finalActive);

    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        if (losesLastAdmin) {
          const activeAdmins = await tx.user.count({ where: { role: 'admin', active: true } });
          if (activeAdmins <= 1) {
            throw Object.assign(new Error('last admin'), { fitLastAdmin: true });
          }
        }
        return tx.user.update({ where: { id: target.id }, data });
      });
    } catch (err) {
      if (err?.fitLastAdmin) {
        return res.status(409).json({
          error: 'last_admin',
          message:
            'This is the last active administrator. Promote someone else to admin first.',
        });
      }
      throw err;
    }

    // A deactivated account must lose access now, not whenever its cookie
    // happens to expire. (A role change needs no revoke — resolveSession reads
    // the user row on every request, so the new role applies immediately.)
    if (data.active === false) await revokeAllForUser(updated.id);

    res.json({ user: publicUser(updated) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- analytics

// ------------------------------------------------------- enrollment repair
//
// A teacher override cannot be undone by the teacher who made it (the scope
// chosen for v1 is assign-only) and must not be undoable by the student. That
// left a mis-assignment permanent: the student locked into the wrong session
// with nobody able to fix it. Admins act org-wide per build sheet §2, so the
// escape hatch lives here.
//
// DELETE /api/admin/enrollments/:id — clear one enrollment, freeing that
// student to choose again for that day.
adminRouter.delete('/enrollments/:id', async (req, res, next) => {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: String(req.params.id ?? '') },
      include: { student: true, session: true },
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'not_found', message: 'No such enrollment.' });
    }

    // Attendance hangs off the enrollment and describes a period that is being
    // erased, so it goes with it rather than being left dangling.
    await prisma.$transaction([
      prisma.attendance.deleteMany({ where: { enrollmentId: enrollment.id } }),
      prisma.enrollment.delete({ where: { id: enrollment.id } }),
    ]);

    res.json({
      ok: true,
      cleared: {
        id: enrollment.id,
        date: enrollment.date,
        status: enrollment.status,
        student: publicUser(enrollment.student),
        sessionTitle: enrollment.session?.title ?? null,
      },
      message:
        enrollment.status === 'teacher_override'
          ? `${enrollment.student.displayName} is no longer assigned on ${enrollment.date} and can choose again.`
          : `${enrollment.student.displayName}'s pick for ${enrollment.date} was cleared.`,
    });
  } catch (err) {
    next(err);
  }
});

function shiftDays(dateKey, delta) {
  const date = fromDateKey(dateKey);
  date.setDate(date.getDate() + delta);
  return toDateKey(date);
}

function bucket(map, key, seed) {
  if (!map.has(key)) map.set(key, seed);
  return map.get(key);
}

// GET /api/admin/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Shaped for the admin dashboard now; the numbers only get interesting once
// real attendance flows in (build sheet §5, v2).
adminRouter.get('/analytics', async (req, res, next) => {
  try {
    const to = req.query.to ? String(req.query.to) : todayKey();
    const from = req.query.from ? String(req.query.from) : shiftDays(to, -(DEFAULT_RANGE_DAYS - 1));

    if (!isValidDateKey(from) || !isValidDateKey(to)) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'from and to must be YYYY-MM-DD.' });
    }
    // Zero-padded ISO dates sort lexicographically, which is also why the
    // range filters below can be plain gte/lte on a string column.
    if (from > to) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'from must be on or before to.' });
    }

    // Rounded, not floored: a DST change makes one of these days 23 hours long.
    const dayCount =
      Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / 86400000) + 1;
    if (dayCount > MAX_RANGE_DAYS) {
      return res.status(400).json({
        error: 'bad_request',
        message: `Pick a range of ${MAX_RANGE_DAYS} days or fewer.`,
      });
    }

    // FIT does not run at weekends, so a missed Saturday is not a missed day.
    const schoolDays = [];
    for (let i = 0; i < dayCount; i += 1) {
      const key = shiftDays(from, i);
      if (dayCodeFor(key)) schoolDays.push(key);
    }

    // "Failed to schedule" can only be said about days that have already gone.
    // A student has not missed next Tuesday — they can still pick it, and the
    // default range deliberately looks forwards as well as back, so counting
    // future days would brand every student a chronic non-scheduler.
    const elapsedSchoolDays = schoolDays.filter((key) => key <= todayKey());

    const [enrollmentsBySession, enrollmentsByStudent, attendanceByStatus, sessions, students] =
      await Promise.all([
        prisma.enrollment.groupBy({
          by: ['sessionId'],
          where: { date: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        // Restricted to school days so a stray weekend row cannot cancel out a
        // genuinely missed Tuesday in the subtraction below.
        elapsedSchoolDays.length
          ? prisma.enrollment.groupBy({
              by: ['studentId'],
              where: { date: { in: elapsedSchoolDays } },
              _count: { _all: true },
            })
          : [],
        prisma.attendance.groupBy({
          by: ['status'],
          where: { date: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        // Inactive sessions included on purpose: enrollments pointing at a
        // since-retired session still happened, and dropping them here would
        // make the usage tables fail to sum to totalEnrollments.
        prisma.session.findMany({
          select: {
            id: true,
            active: true,
            recurrenceType: true,
            days: true,
            teacher: { select: { id: true, displayName: true } },
            subjectTag: { select: { id: true, name: true, sortOrder: true } },
          },
        }),
        prisma.user.findMany({
          where: { role: 'student', active: true },
          select: { id: true, displayName: true, email: true },
        }),
      ]);

    // Recurrence is expanded at read time, so "ran in range" is a question
    // about day codes, and there are at most five of those.
    const dayCodesInRange = [...new Set(schoolDays.map((date) => dayCodeFor(date)))];
    const ranInRange = (session) => dayCodesInRange.some((code) => sessionRunsOn(session, code));

    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const bySubject = new Map();
    const byTeacher = new Map();

    for (const session of sessions) {
      if (!session.active || !ranInRange(session)) continue;
      bucket(bySubject, session.subjectTag.id, {
        subjectTag: session.subjectTag,
        sessionCount: 0,
        enrollmentCount: 0,
      }).sessionCount += 1;
      bucket(byTeacher, session.teacher.id, {
        teacher: session.teacher,
        sessionCount: 0,
        enrollmentCount: 0,
      }).sessionCount += 1;
    }

    let totalEnrollments = 0;
    for (const row of enrollmentsBySession) {
      const count = row._count._all;
      totalEnrollments += count;
      const session = sessionById.get(row.sessionId);
      if (!session) continue;
      bucket(bySubject, session.subjectTag.id, {
        subjectTag: session.subjectTag,
        sessionCount: 0,
        enrollmentCount: 0,
      }).enrollmentCount += count;
      bucket(byTeacher, session.teacher.id, {
        teacher: session.teacher,
        sessionCount: 0,
        enrollmentCount: 0,
      }).enrollmentCount += count;
    }

    // groupBy only returns statuses that occur, so seed all four — a dashboard
    // showing {present: 3} and nothing else reads as missing data, not zero.
    const attendanceBreakdown = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0]));
    for (const row of attendanceByStatus) attendanceBreakdown[row.status] = row._count._all;
    const recordedAttendance = ATTENDANCE_STATUSES.reduce(
      (sum, status) => sum + attendanceBreakdown[status],
      0
    );
    const noShows = attendanceBreakdown.absent + attendanceBreakdown.cut;

    // @@unique([studentId, date]) means this count is a count of DAYS, never of
    // duplicate picks, so the subtraction can never go negative.
    const enrolledDays = new Map(
      enrollmentsByStudent.map((row) => [row.studentId, row._count._all])
    );
    const unscheduled = students
      .map((student) => ({
        student,
        missedDays: elapsedSchoolDays.length - (enrolledDays.get(student.id) ?? 0),
      }))
      .filter((row) => row.missedDays > 0)
      .sort(
        (a, b) =>
          b.missedDays - a.missedDays ||
          a.student.displayName.localeCompare(b.student.displayName)
      );

    res.json({
      range: {
        from,
        to,
        days: dayCount,
        schoolDays: schoolDays.length,
        // Named so the dashboard can say what "missed" was measured against.
        elapsedSchoolDays: elapsedSchoolDays.length,
      },
      totalSessions: sessions.filter((session) => session.active && ranInRange(session)).length,
      // Distinct students who scheduled at least one school day in range.
      totalStudents: enrollmentsByStudent.length,
      totalEnrollments,
      usageBySubject: [...bySubject.values()].sort(
        (a, b) =>
          a.subjectTag.sortOrder - b.subjectTag.sortOrder ||
          a.subjectTag.name.localeCompare(b.subjectTag.name)
      ),
      usageByTeacher: [...byTeacher.values()].sort(
        (a, b) =>
          b.enrollmentCount - a.enrollmentCount ||
          a.teacher.displayName.localeCompare(b.teacher.displayName)
      ),
      attendanceBreakdown,
      recordedAttendance,
      // Guarded: with no attendance yet this would be NaN, which JSON writes
      // as null and the dashboard would render as a blank tile.
      noShowRate: recordedAttendance ? Math.round((noShows / recordedAttendance) * 1000) / 1000 : 0,
      unscheduledStudents: unscheduled.slice(0, UNSCHEDULED_LIMIT),
      unscheduledStudentCount: unscheduled.length,
    });
  } catch (err) {
    next(err);
  }
});
