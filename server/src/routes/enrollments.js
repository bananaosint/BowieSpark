import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/index.js';
import { serializeSession } from './sessions.js';
import { sessionRunsOn } from '../lib/days.js';
import { isValidDateKey, todayKey, dayCodeFor } from '../lib/dates.js';
import { effectiveCutoff, isPastCutoff, describeCutoff } from '../lib/cutoff.js';

export const enrollmentsRouter = Router();

const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 200;

// Which cutoff governs a given session. Exported so that anything else needing
// the same answer shares this copy: signup, cancel and switch below already
// all depend on it, and a second copy of the global-vs-per-session precedence
// rule would inevitably drift from this one.
export async function resolveCutoffFor(sessionId) {
  const [globalConfig, sessionConfig] = await Promise.all([
    prisma.cutoffConfig.findFirst({ where: { scope: 'global', sessionId: null } }),
    // findUnique rejects an undefined filter, so "no session, just the global
    // rule" has to short-circuit rather than fall through to a query.
    sessionId ? prisma.cutoffConfig.findUnique({ where: { sessionId } }) : null,
  ]);
  // Argument order matters: (global, session) — flipped, the global config
  // would quietly win over a per-session override.
  return effectiveCutoff(globalConfig, sessionConfig);
}

// ------------------------------------------------------------------- signup

// POST /api/enrollments — { sessionId, date }
// Sets the student's single pick for one day. Replacing an earlier pick is the
// same call, because a student has at most one enrollment per date.
enrollmentsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    // Staff do not hold enrollments — a teacher-occupied seat is one nobody can
    // take attendance for. Teachers place students through the override route.
    if (req.user.role !== 'student') {
      return res.status(403).json({
        error: 'students_only',
        message: 'Only student accounts can sign up for FIT. Teachers assign students from the teacher tools.',
      });
    }

    // Read defensively rather than destructuring: express.json() leaves
    // req.body as {} today, but nothing here should depend on a body parser
    // having run upstream — a missing body has to become a 400 below, never a
    // TypeError and a 500. Typed-checked too, so a number or an object lands
    // in the same 400 instead of being coerced into a lookup key.
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const date = req.body?.date;

    if (!sessionId) {
      return res.status(400).json({ error: 'bad_request', message: 'Pick a session to sign up for.' });
    }
    // Not String()-coerced first: a non-string body value should fail here, not
    // become the literal "undefined".
    if (!isValidDateKey(date)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'date must be a real calendar day, written YYYY-MM-DD.',
      });
    }
    // Lexicographic comparison is exact for YYYY-MM-DD. Today is NOT past: the
    // default T-0 rule keeps today open right up until the bell.
    if (date < todayKey()) {
      return res.status(400).json({
        error: 'date_in_past',
        message: 'That day has already happened. Choose an upcoming school day.',
      });
    }
    // Must follow the date validation — fromDateKey on garbage yields an
    // Invalid Date rather than a null day code.
    const dayCode = dayCodeFor(date);
    if (!dayCode) {
      return res.status(400).json({
        error: 'not_a_school_day',
        message: 'FIT only runs Monday through Friday.',
      });
    }

    const [session, existing] = await Promise.all([
      prisma.session.findUnique({
        where: { id: sessionId },
        // serializeSession reports a null teacher/subjectTag without these.
        include: { teacher: true, subjectTag: true },
      }),
      prisma.enrollment.findUnique({
        where: { studentId_date: { studentId: req.user.id, date } },
      }),
    ]);

    if (!session) {
      return res.status(404).json({ error: 'session_not_found', message: 'That session no longer exists.' });
    }
    if (!session.active) {
      return res.status(409).json({
        error: 'session_inactive',
        message: 'That session has been retired and is not taking signups.',
      });
    }
    // Recurrence lives in the session row, not in occurrence records, so
    // "does it run that day" is a computed answer.
    if (!sessionRunsOn(session, dayCode)) {
      return res.status(400).json({
        error: 'session_not_offered',
        message: `${session.title} does not meet on that day.`,
      });
    }
    // A teacher override is an assignment, not a suggestion. Only the teacher
    // who issued it can trade the student back out.
    if (existing?.status === 'teacher_override') {
      return res.status(409).json({
        error: 'locked_by_teacher',
        message: 'A teacher assigned you to a session that day. Ask them if it needs to change.',
      });
    }

    const { cutoffRule, bellTime } = await resolveCutoffFor(session.id);
    if (isPastCutoff(date, cutoffRule, bellTime)) {
      return res.status(409).json({
        error: 'past_cutoff',
        message: `Signups for that day are closed. ${describeCutoff(cutoffRule, bellTime)}`,
      });
    }

    const alreadyHere = existing?.sessionId === session.id;
    const isSwitch = Boolean(existing) && !alreadyHere;

    // Leaving a session is governed by THAT session's cutoff, which a
    // per-session CutoffConfig can set earlier than the one being joined.
    // Without this check a student who can no longer cancel out of a locked
    // session could vacate the seat anyway by "switching" instead — the roster
    // its teacher printed last night would change underneath them. DELETE
    // already enforces this; the two paths have to agree or the rule is
    // decorative.
    if (isSwitch) {
      const previous = await resolveCutoffFor(existing.sessionId);
      if (isPastCutoff(date, previous.cutoffRule, previous.bellTime)) {
        return res.status(409).json({
          error: 'past_cutoff',
          // Names the session being LEFT: otherwise the student reads "closed"
          // while staring at a session that is visibly open.
          message: `You are locked into your current session for that day and cannot switch out of it. ${describeCutoff(previous.cutoffRule, previous.bellTime)}`,
        });
      }
    }

    // Re-confirming the session you are already in must not read as "full" —
    // the seat pushing the count to capacity is the student's own.
    if (!alreadyHere) {
      const taken = await prisma.enrollment.count({ where: { sessionId: session.id, date } });
      if (taken >= session.capacity) {
        return res.status(409).json({
          error: 'session_full',
          message: `${session.title} is full that day. Try another session.`,
        });
      }
    }

    // One row per student per day, so switching sessions updates that row
    // instead of leaving a stale pick behind. overrideById is cleared because a
    // self-selected row must never carry a teacher's fingerprint.
    const upsertArgs = {
      where: { studentId_date: { studentId: req.user.id, date } },
      create: {
        date,
        sessionId: session.id,
        studentId: req.user.id,
        status: 'self_selected',
        locked: false,
      },
      update: {
        sessionId: session.id,
        status: 'self_selected',
        locked: false,
        overrideById: null,
      },
    };

    // The capacity check above is a fast path for the obvious case. It cannot
    // be the only one: between counting and writing there is a window where two
    // students both read "one seat left" and both take it — precisely the
    // "everyone signs up the second the window opens" rush the build sheet
    // calls out. So the real check happens AFTER the write, inside the
    // transaction, where the count includes the seat just taken. SQLite
    // serialises writers, so the loser of a race sees the winner's row and
    // rolls its own seat back.
    //
    // The transaction also covers the attendance cleanup: attendance hangs off
    // the enrollment row, and that row is updated rather than replaced, so a
    // mark the old teacher recorded would otherwise follow the student into the
    // new session. A switch that lost its cleanup halfway would leave exactly
    // that phantom mark behind.
    let enrollment;
    let enrolledCount;
    try {
      ({ enrollment, enrolledCount } = await prisma.$transaction(async (tx) => {
        const row = await tx.enrollment.upsert(upsertArgs);

        if (isSwitch) {
          await tx.attendance.deleteMany({ where: { enrollmentId: existing.id } });
        }

        const taken = await tx.enrollment.count({
          where: { sessionId: session.id, date },
        });

        // `alreadyHere` is excluded: re-confirming a seat the student already
        // holds changes no count, and must not fail because the session is at
        // capacity — they ARE one of the people filling it.
        if (!alreadyHere && taken > session.capacity) {
          throw Object.assign(new Error('capacity exceeded'), { fitSessionFull: true });
        }

        return { enrollment: row, enrolledCount: taken };
      }));
    } catch (err) {
      if (err?.fitSessionFull) {
        return res.status(409).json({
          error: 'session_full',
          message: `${session.title} filled up while you were choosing. Try another session.`,
        });
      }
      throw err;
    }

    // Always 200: this is one per-day slot being set, not a new item in a
    // collection, and the client reacts to the payload rather than the code.
    res.json({
      date,
      enrollment: {
        id: enrollment.id,
        date: enrollment.date,
        status: enrollment.status,
        locked: enrollment.locked,
        session: serializeSession(session, enrolledCount),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------- cancel

// DELETE /api/enrollments/:date — drop the student's pick for one day.
enrollmentsRouter.delete('/:date', requireAuth, async (req, res, next) => {
  try {
    const date = req.params.date;
    if (!isValidDateKey(date)) {
      return res.status(400).json({
        error: 'bad_request',
        message: 'date must be a real calendar day, written YYYY-MM-DD.',
      });
    }
    if (date < todayKey()) {
      return res.status(400).json({
        error: 'date_in_past',
        message: 'That day has already happened and can no longer be changed.',
      });
    }

    const existing = await prisma.enrollment.findUnique({
      where: { studentId_date: { studentId: req.user.id, date } },
    });
    if (!existing) {
      return res.status(404).json({ error: 'not_found', message: 'You have no FIT pick on that day.' });
    }
    if (existing.status === 'teacher_override') {
      return res.status(409).json({
        error: 'locked_by_teacher',
        message: 'A teacher assigned you to a session that day, so it cannot be cancelled here.',
      });
    }

    const { cutoffRule, bellTime } = await resolveCutoffFor(existing.sessionId);
    if (isPastCutoff(date, cutoffRule, bellTime)) {
      return res.status(409).json({
        error: 'past_cutoff',
        message: `That day is locked in. ${describeCutoff(cutoffRule, bellTime)}`,
      });
    }

    // deleteMany rather than delete: a double-tapped Cancel button would
    // otherwise surface Prisma's P2025 to the student as a 500.
    await prisma.enrollment.deleteMany({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ history

// GET /api/enrollments/history?limit=
// Current and past schedule in one list, newest first.
enrollmentsRouter.get('/history', requireAuth, async (req, res, next) => {
  try {
    const requested = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isNaN(requested)
      ? HISTORY_DEFAULT_LIMIT
      : Math.min(Math.max(requested, 1), HISTORY_MAX_LIMIT);

    const enrollments = await prisma.enrollment.findMany({
      where: { studentId: req.user.id },
      // @@unique([studentId, date]) guarantees one row per date, so date alone
      // is already a total ordering — no tiebreak needed.
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        session: { include: { teacher: true, subjectTag: true } },
        attendance: true,
      },
    });

    res.json({
      today: todayKey(),
      limit,
      enrollments: enrollments.map((e) => ({
        id: e.id,
        date: e.date,
        status: e.status,
        locked: e.locked,
        // Deliberately not serializeSession: seat counts are per session PER
        // DATE, and defaulting every historical row to 0 would report a full
        // session as wide open.
        session: {
          id: e.session.id,
          title: e.session.title,
          teacher: e.session.teacher?.displayName ?? null,
          subjectTag: e.session.subjectTag?.name ?? null,
        },
        attendance: e.attendance
          ? { status: e.attendance.status, note: e.attendance.note ?? null }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});
