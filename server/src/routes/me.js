import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/index.js';
import { serializeSession } from './sessions.js';
import { POLICY_KEYS } from '../lib/constants.js';
import { isValidDateKey, todayKey, schoolWeekOf } from '../lib/dates.js';
import { effectiveCutoff, isPastCutoff, describeCutoff } from '../lib/cutoff.js';

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

    // Enrollment.locked is only ever written true by the teacher-override path;
    // nothing sweeps rows as their cutoff passes. Reading the column raw would
    // therefore report locked:false for a pick the server will refuse to
    // change, and the UI would offer a "Change" button that always 409s. So the
    // effective lock is computed here instead of trusted from storage.
    const [globalCutoff, sessionCutoffs] = await Promise.all([
      prisma.cutoffConfig.findFirst({ where: { scope: 'global', sessionId: null } }),
      prisma.cutoffConfig.findMany({
        where: { sessionId: { in: [...new Set(enrollments.map((e) => e.sessionId))] } },
      }),
    ]);
    const cutoffBySession = new Map(sessionCutoffs.map((c) => [c.sessionId, c]));

    res.json({
      today: todayKey(),
      overrideNotice: notice?.value ?? null,
      days: week.map(({ dayCode, date }) => {
        const enrollment = byDate.get(date);
        const isOverride = enrollment?.status === 'teacher_override';

        // A day the student is already in is governed by THAT session's cutoff
        // (it decides whether they may switch out); an empty day is governed by
        // the global rule, since any session could still be picked.
        const cutoff = effectiveCutoff(
          globalCutoff,
          enrollment ? cutoffBySession.get(enrollment.sessionId) : null
        );
        const pastCutoff = isPastCutoff(date, cutoff.cutoffRule, cutoff.bellTime);

        return {
          date,
          dayCode,
          isToday: date === todayKey(),
          // An override day shows ONLY the assigned session — the UI must not
          // offer alternates for it.
          isOverridden: isOverride,
          locked: isOverride || pastCutoff,
          pastCutoff,
          // Why it is locked, so the UI can say so rather than just greying out.
          lockReason: isOverride ? 'teacher_override' : pastCutoff ? 'past_cutoff' : null,
          cutoff: {
            rule: cutoff.cutoffRule,
            bellTime: cutoff.bellTime,
            description: describeCutoff(cutoff.cutoffRule, cutoff.bellTime),
          },
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
