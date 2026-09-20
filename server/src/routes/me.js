import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/index.js';
import { serializeSession } from './sessions.js';
import { POLICY_KEYS } from '../lib/constants.js';
import { isValidDateKey, todayKey, schoolWeekOf } from '../lib/dates.js';

export const meRouter = Router();

meRouter.get('/', requireAuth, (req, res) => {
  const { id, email, role, displayName } = req.user;
  res.json({ user: { id, email, role, displayName } });
});

// GET /api/me/week?date=YYYY-MM-DD
// The student homescreen (build sheet §3): today's FIT plus the rest of the
// week, with teacher-override days flagged so the UI can lock them.
meRouter.get('/week', requireAuth, async (req, res, next) => {
  try {
    const anchor = req.query.date ? String(req.query.date) : todayKey();
    if (!isValidDateKey(anchor)) {
      return res.status(400).json({ error: 'bad_request', message: 'date must be YYYY-MM-DD.' });
    }

    const week = schoolWeekOf(anchor);
    const dates = week.map((d) => d.date);

    const [enrollments, notice] = await Promise.all([
      prisma.enrollment.findMany({
        where: { studentId: req.user.id, date: { in: dates } },
        include: { session: { include: { teacher: true, subjectTag: true } } },
      }),
      prisma.policyText.findUnique({
        where: { key: POLICY_KEYS.TEACHER_OVERRIDE_NOTICE },
      }),
    ]);

    // Safe to key by date alone: @@unique([studentId, date]) guarantees at
    // most one enrollment per student per day.
    const byDate = new Map(enrollments.map((e) => [e.date, e]));

    // Seat counts are per session PER DATE, so they have to be fetched here
    // rather than defaulted — the student reading this is themselves enrolled,
    // so the true count is never zero.
    const counts = await prisma.enrollment.groupBy({
      by: ['sessionId', 'date'],
      where: {
        date: { in: dates },
        sessionId: { in: [...new Set(enrollments.map((e) => e.sessionId))] },
      },
      _count: { _all: true },
    });
    const countBy = new Map(
      counts.map((c) => [`${c.sessionId}|${c.date}`, c._count._all])
    );

    res.json({
      today: todayKey(),
      overrideNotice: notice?.value ?? null,
      days: week.map(({ dayCode, date }) => {
        const enrollment = byDate.get(date);
        const isOverride = enrollment?.status === 'teacher_override';
        return {
          date,
          dayCode,
          isToday: date === todayKey(),
          // An override day shows ONLY the assigned session — the UI must not
          // offer alternates for it.
          isOverridden: isOverride,
          locked: Boolean(enrollment?.locked) || isOverride,
          enrollment: enrollment
            ? {
                id: enrollment.id,
                status: enrollment.status,
                session: serializeSession(
                  enrollment.session,
                  countBy.get(`${enrollment.sessionId}|${enrollment.date}`) ?? 0
                ),
              }
            : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});
