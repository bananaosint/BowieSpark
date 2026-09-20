import { Router } from 'express';
import { prisma } from '../db.js';
import { decodeDays, sessionRunsOn } from '../lib/days.js';
import { DAY_CODES } from '../lib/constants.js';
import { isValidDateKey, todayKey, dayCodeFor } from '../lib/dates.js';
import { requireAuth } from '../middleware/auth.js';

export const sessionsRouter = Router();

export function serializeSession(session, enrolledCount = 0) {
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    prerequisites: session.prerequisites,
    capacity: session.capacity,
    recurrenceType: session.recurrenceType,
    days: decodeDays(session.days),
    enrolledCount,
    seatsLeft: Math.max(0, session.capacity - enrolledCount),
    isFull: enrolledCount >= session.capacity,
    teacher: session.teacher
      ? { id: session.teacher.id, displayName: session.teacher.displayName }
      : null,
    subjectTag: session.subjectTag
      ? { id: session.subjectTag.id, name: session.subjectTag.name }
      : null,
  };
}

// GET /api/sessions?date=YYYY-MM-DD&subjectTagId=...
// Read-only browse. Signing up is feature work, not skeleton.
sessionsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const date = req.query.date ? String(req.query.date) : todayKey();
    if (!isValidDateKey(date)) {
      return res.status(400).json({ error: 'bad_request', message: 'date must be YYYY-MM-DD.' });
    }
    const dayCode = dayCodeFor(date);

    const sessions = await prisma.session.findMany({
      where: {
        active: true,
        ...(req.query.subjectTagId ? { subjectTagId: String(req.query.subjectTagId) } : {}),
      },
      include: { teacher: true, subjectTag: true },
      orderBy: [{ subjectTag: { sortOrder: 'asc' } }, { title: 'asc' }],
    });

    // Recurrence is expanded here rather than stored as occurrence rows.
    // Weekend dates have no dayCode, so nothing runs.
    const running = dayCode ? sessions.filter((s) => sessionRunsOn(s, dayCode)) : [];

    const counts = await prisma.enrollment.groupBy({
      by: ['sessionId'],
      where: { date, sessionId: { in: running.map((s) => s.id) } },
      _count: { _all: true },
    });
    const countBy = new Map(counts.map((c) => [c.sessionId, c._count._all]));

    res.json({
      date,
      dayCode,
      isSchoolDay: Boolean(dayCode),
      sessions: running.map((s) => serializeSession(s, countBy.get(s.id) ?? 0)),
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: { teacher: true, subjectTag: true },
    });
    if (!session) return res.status(404).json({ error: 'not_found', message: 'No such session.' });

    const date = isValidDateKey(String(req.query.date)) ? String(req.query.date) : todayKey();
    const enrolledCount = await prisma.enrollment.count({ where: { sessionId: session.id, date } });
    res.json({ date, session: serializeSession(session, enrolledCount) });
  } catch (err) {
    next(err);
  }
});

export { DAY_CODES };
