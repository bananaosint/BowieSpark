import { Router } from 'express';
import { prisma } from '../db.js';
import { serializeSession } from './sessions.js';
import { requireTeacher } from '../auth/index.js';
import { decodeDays, encodeDays, sessionRunsOn } from '../lib/days.js';
import { isValidDateKey, todayKey, dayCodeFor } from '../lib/dates.js';
import {
  ATTENDANCE_STATUSES,
  DAY_CODES,
  DESCRIPTION_WORD_LIMIT,
  RECURRENCE_TYPES,
} from '../lib/constants.js';

export const teacherRouter = Router();

// Mounted once for the whole router rather than per route: every endpoint in
// here is a teacher tool, and a route added later must not be able to forget
// the guard. Admins pass too — build sheet §2 gives them the teacher toolkit
// org-wide.
teacherRouter.use(requireTeacher);

// Thrown by the helpers below so a rejection can come from anywhere in a
// handler; src/middleware/errors.js turns { status, code } into the house
// 4xx envelope, so the shape matches an inline res.status().json().
function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

// THE ownership rule, written once. A teacher may only ever act on a session
// they own; an admin acts org-wide but still gets a 404 for a session that
// does not exist. Every route in this file goes through here — if this
// function is correct, the rule cannot be forgotten in one endpoint.
async function loadOwnedSession(req, sessionId) {
  const id = String(sessionId ?? '');
  const session = id
    ? await prisma.session.findUnique({
        where: { id },
        include: { teacher: true, subjectTag: true },
      })
    : null;

  if (!session) throw httpError(404, 'not_found', 'No such session.');
  if (req.user.role !== 'admin' && session.teacherId !== req.user.id) {
    // Deliberately not a 404: the teacher asked about a real session, they
    // just do not own it, and saying so avoids a support ticket.
    throw httpError(403, 'forbidden', 'That session belongs to another teacher.');
  }
  return session;
}

function countWords(text) {
  const trimmed = String(text ?? '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

const has = (body, key) => Object.prototype.hasOwnProperty.call(body ?? {}, key);

// Shared by create and edit. `existing` is null on create (every field is
// read) and the current row on edit (only the keys actually sent are read),
// which is what makes PATCH a partial update without duplicating the rules.
async function readSessionInput(body, existing = null) {
  const patch = existing !== null;
  const data = {};

  if (!patch || has(body, 'title')) {
    const title = String(body?.title ?? '').trim();
    if (!title) {
      throw httpError(400, 'bad_request', 'Give the session a title.');
    }
    if (title.length > 120) {
      throw httpError(400, 'title_too_long', 'Keep the title to 120 characters or fewer.');
    }
    data.title = title;
  }

  if (!patch || has(body, 'description')) {
    const description = String(body?.description ?? '').trim();
    const words = countWords(description);
    if (words > DESCRIPTION_WORD_LIMIT) {
      throw httpError(
        400,
        'description_too_long',
        `That description is ${words} words. Trim it to ${DESCRIPTION_WORD_LIMIT} or fewer.`
      );
    }
    data.description = description;
  }

  // Display-only per build sheet §3 — never a signup gate, so no rules here.
  if (!patch || has(body, 'prerequisites')) {
    data.prerequisites = String(body?.prerequisites ?? '').trim();
  }

  if (!patch || has(body, 'capacity')) {
    const capacity = Number(body?.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
      throw httpError(400, 'bad_capacity', 'Capacity must be a whole number from 1 to 500.');
    }
    data.capacity = capacity;
  }

  // Recurrence and days are validated together: switching an existing session
  // to specific_days without naming days would leave a session that never
  // runs, and days sent alone still have to be checked against the recurrence
  // already on the row.
  if (!patch || has(body, 'recurrenceType') || has(body, 'days')) {
    const recurrenceType = has(body, 'recurrenceType')
      ? String(body?.recurrenceType ?? '')
      : existing?.recurrenceType ?? 'daily';
    if (!RECURRENCE_TYPES.includes(recurrenceType)) {
      throw httpError(
        400,
        'bad_recurrence',
        `recurrenceType must be one of: ${RECURRENCE_TYPES.join(', ')}.`
      );
    }
    data.recurrenceType = recurrenceType;

    if (recurrenceType === 'specific_days') {
      const raw = has(body, 'days') ? body?.days : decodeDays(existing?.days);
      if (!Array.isArray(raw) || raw.length === 0) {
        throw httpError(400, 'bad_days', 'Pick at least one day this session runs.');
      }
      const days = raw.map((day) => String(day).toUpperCase());
      // Checked before encodeDays(), which silently drops anything it does
      // not recognise — a typo would otherwise become an empty day list.
      const unknown = days.filter((day) => !DAY_CODES.includes(day));
      if (unknown.length > 0) {
        throw httpError(
          400,
          'bad_days',
          `Not a school day: ${unknown.join(', ')}. Use ${DAY_CODES.join(', ')}.`
        );
      }
      data.days = encodeDays(days);
    } else {
      // `daily` ignores the field; blanking it stops a stale list resurfacing
      // if the session is later switched back to specific days.
      data.days = encodeDays([]);
    }
  }

  if (!patch || has(body, 'subjectTagId')) {
    const subjectTagId = String(body?.subjectTagId ?? '');
    const tag = subjectTagId
      ? await prisma.subjectTag.findUnique({ where: { id: subjectTagId } })
      : null;
    if (!tag || !tag.active) {
      throw httpError(400, 'bad_subject_tag', 'Pick a subject tag from the list.');
    }
    data.subjectTagId = tag.id;
  }

  return data;
}

function serializeAttendance(attendance, student = null) {
  return {
    id: attendance.id,
    enrollmentId: attendance.enrollmentId,
    date: attendance.date,
    status: attendance.status,
    note: attendance.note ?? null,
    recordedById: attendance.recordedById ?? null,
    updatedAt: attendance.updatedAt,
    ...(student
      ? { student: { id: student.id, displayName: student.displayName, email: student.email } }
      : {}),
  };
}

// Query dates default to today; an explicit one must still be a real date.
function readDateParam(value) {
  const date = value === undefined || value === '' ? todayKey() : String(value);
  if (!isValidDateKey(date)) {
    throw httpError(400, 'bad_request', 'date must be YYYY-MM-DD.');
  }
  return date;
}

// --------------------------------------------------------------- sessions

// GET /api/teacher/sessions?date=YYYY-MM-DD
// The teacher's own management list. Unlike /api/sessions this is NOT
// filtered by recurrence — a teacher managing Friday's film club on a Tuesday
// still needs to see it. `date` only decides which day the counts are for.
teacherRouter.get('/sessions', async (req, res, next) => {
  try {
    const date = readDateParam(req.query.date);
    const dayCode = dayCodeFor(date);

    const sessions = await prisma.session.findMany({
      where: req.user.role === 'admin' ? {} : { teacherId: req.user.id },
      include: { teacher: true, subjectTag: true },
      orderBy: [{ active: 'desc' }, { subjectTag: { sortOrder: 'asc' } }, { title: 'asc' }],
    });

    const counts = await prisma.enrollment.groupBy({
      by: ['sessionId'],
      where: { date, sessionId: { in: sessions.map((s) => s.id) } },
      _count: { _all: true },
    });
    const countBy = new Map(counts.map((c) => [c.sessionId, c._count._all]));

    res.json({
      date,
      dayCode,
      sessions: sessions.map((session) => ({
        ...serializeSession(session, countBy.get(session.id) ?? 0),
        // Soft-deleted sessions stay in this list so their owner can see what
        // became of them; /api/sessions already hides them from students.
        active: session.active,
        runsOnDate: dayCode ? sessionRunsOn(session, dayCode) : false,
      })),
    });
  } catch (err) {
    next(err);
  }
});

teacherRouter.post('/sessions', async (req, res, next) => {
  try {
    const data = await readSessionInput(req.body);

    const session = await prisma.session.create({
      // teacherId is the caller, always. Taking it from the body would let a
      // teacher create sessions in a colleague's name.
      data: { ...data, teacherId: req.user.id },
      include: { teacher: true, subjectTag: true },
    });

    res.status(201).json({ session: { ...serializeSession(session, 0), active: session.active } });
  } catch (err) {
    next(err);
  }
});

teacherRouter.patch('/sessions/:id', async (req, res, next) => {
  try {
    const existing = await loadOwnedSession(req, req.params.id);
    const data = await readSessionInput(req.body, existing);

    if (data.capacity !== undefined) {
      const perDay = await prisma.enrollment.groupBy({
        by: ['date'],
        where: { sessionId: existing.id, date: { gte: todayKey() } },
        _count: { _all: true },
      });
      // Dates are zero-padded ISO strings, so a lexical sort is a
      // chronological one — and a deterministic one, which groupBy order is
      // not: the same request must always name the same conflicting day.
      const conflict = perDay
        .filter((day) => day._count._all > data.capacity)
        .sort((a, b) => a.date.localeCompare(b.date))[0];

      if (conflict) {
        return res.status(409).json({
          error: 'capacity_below_enrolled',
          message: `${conflict._count._all} students are already signed up for ${conflict.date}. Capacity cannot drop below that — remove students first.`,
          date: conflict.date,
          enrolled: conflict._count._all,
        });
      }
    }

    const session = await prisma.session.update({
      where: { id: existing.id },
      data,
      include: { teacher: true, subjectTag: true },
    });
    const enrolledCount = await prisma.enrollment.count({
      where: { sessionId: session.id, date: todayKey() },
    });

    res.json({
      session: { ...serializeSession(session, enrolledCount), active: session.active },
    });
  } catch (err) {
    next(err);
  }
});

// Soft delete only. A hard delete would cascade away every enrollment and
// every attendance record attached to them, destroying the history.
teacherRouter.delete('/sessions/:id', async (req, res, next) => {
  try {
    const existing = await loadOwnedSession(req, req.params.id);

    const future = await prisma.enrollment.count({
      where: { sessionId: existing.id, date: { gte: todayKey() } },
    });
    if (future > 0) {
      return res.status(409).json({
        error: 'has_future_enrollments',
        message: `${future} student${future === 1 ? ' is' : 's are'} still signed up for this session today or later. Move them first.`,
        enrolled: future,
      });
    }

    const session = await prisma.session.update({
      where: { id: existing.id },
      data: { active: false },
      include: { teacher: true, subjectTag: true },
    });

    res.json({ session: { ...serializeSession(session, 0), active: session.active } });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- roster

teacherRouter.get('/sessions/:id/roster', async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req, req.params.id);
    const date = readDateParam(req.query.date);
    const dayCode = dayCodeFor(date);

    const enrollments = await prisma.enrollment.findMany({
      where: { sessionId: session.id, date },
      include: { student: true, attendance: true, overrideBy: true },
      orderBy: { student: { displayName: 'asc' } },
    });

    res.json({
      date,
      dayCode,
      runsOnDate: dayCode ? sessionRunsOn(session, dayCode) : false,
      session: serializeSession(session, enrollments.length),
      roster: enrollments.map((enrollment) => ({
        enrollmentId: enrollment.id,
        student: {
          id: enrollment.student.id,
          displayName: enrollment.student.displayName,
          email: enrollment.student.email,
        },
        status: enrollment.status,
        locked: enrollment.locked,
        assignedBy: enrollment.overrideBy
          ? { id: enrollment.overrideBy.id, displayName: enrollment.overrideBy.displayName }
          : null,
        attendance: enrollment.attendance
          ? {
              status: enrollment.attendance.status,
              note: enrollment.attendance.note ?? null,
              recordedAt: enrollment.attendance.updatedAt,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- override

const skipMessages = {
  not_found: 'No account with that id.',
  not_a_student: 'That account is not a student.',
  inactive_account: 'That account is not active.',
  session_full: 'No seats left for this date.',
  already_enrolled: 'Already in this session for this date — nothing changed.',
};

function overrideResult(studentId, user, reason) {
  return {
    studentId,
    displayName: user?.displayName ?? null,
    assigned: reason === null,
    reason,
    message: reason === null ? 'Assigned.' : skipMessages[reason],
    replaced: null,
  };
}

// POST /api/teacher/sessions/:id/override  { studentIds: [], date }
// Assigns students INTO this session for one date. The @@unique([studentId,
// date]) means this REPLACES whatever the student had picked that day — there
// is no second row, so nothing has to be deleted first.
teacherRouter.post('/sessions/:id/override', async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req, req.params.id);

    const rawIds = req.body?.studentIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Pick at least one student to assign.' });
    }
    // The same id twice is one assignment, not two seats.
    const studentIds = [...new Set(rawIds.map((id) => String(id)))];

    const date = String(req.body?.date ?? '');
    if (!isValidDateKey(date)) {
      return res.status(400).json({ error: 'bad_request', message: 'date must be YYYY-MM-DD.' });
    }
    if (date < todayKey()) {
      return res.status(400).json({
        error: 'date_in_past',
        message: 'That date has already passed — assignments can only be made from today forward.',
      });
    }
    const dayCode = dayCodeFor(date);
    if (!dayCode || !sessionRunsOn(session, dayCode)) {
      return res.status(400).json({
        error: 'session_not_running',
        message: `${session.title} does not run on ${date}.`,
      });
    }
    // A soft-deleted session is gone as far as students are concerned — it is
    // hidden from browse, and DELETE only let it go because nobody was signed
    // up. Assigning into it would resurrect it on a student's week.
    if (!session.active) {
      return res.status(409).json({
        error: 'session_inactive',
        message: `${session.title} has been removed and cannot take new students.`,
      });
    }

    const [students, existingEnrollments, enrolledCount] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: studentIds } } }),
      prisma.enrollment.findMany({
        where: { studentId: { in: studentIds }, date },
        include: { session: { select: { id: true, title: true } } },
      }),
      prisma.enrollment.count({ where: { sessionId: session.id, date } }),
    ]);
    const userBy = new Map(students.map((user) => [user.id, user]));
    // Safe to key by student alone: the date is already pinned by the query,
    // and @@unique([studentId, date]) allows at most one row per student.
    const existingBy = new Map(existingEnrollments.map((e) => [e.studentId, e]));

    // A bad id is that student's problem, not the batch's: collect the
    // skips and keep going.
    const resultBy = new Map();
    const assignable = [];
    for (const studentId of studentIds) {
      const user = userBy.get(studentId);
      const reason = !user
        ? 'not_found'
        : user.role !== 'student'
          ? 'not_a_student'
          : !user.active
            ? 'inactive_account'
            : null;
      if (reason) {
        resultBy.set(studentId, overrideResult(studentId, user, reason));
        continue;
      }
      assignable.push(user);
    }

    // Seat math is done for the whole batch before anything is written: a
    // teacher assigning five students should be told the room does not fit
    // them, not discover afterwards that two of the five silently dropped.
    const needSeat = assignable.filter(
      (user) => existingBy.get(user.id)?.sessionId !== session.id
    );
    if (enrolledCount + needSeat.length > session.capacity) {
      const needsSeat = new Set(needSeat.map((user) => user.id));
      for (const user of assignable) {
        // Someone already sitting in this room is not competing for a seat —
        // telling their teacher "session full" about them would be a lie.
        resultBy.set(
          user.id,
          overrideResult(user.id, user, needsSeat.has(user.id) ? 'session_full' : 'already_enrolled')
        );
      }
      return res.status(409).json({
        error: 'session_full',
        message: `${session.title} seats ${session.capacity} and already has ${enrolledCount} signed up for ${date}. That leaves room for ${Math.max(0, session.capacity - enrolledCount)} more, not ${needSeat.length}.`,
        date,
        capacity: session.capacity,
        enrolledCount,
        seatsNeeded: needSeat.length,
        results: studentIds.map((id) => resultBy.get(id)),
      });
    }

    // One transaction so the batch is all-or-nothing, matching the seat math
    // that was just checked against it.
    const writes = [];
    for (const user of assignable) {
      const previous = existingBy.get(user.id) ?? null;
      writes.push(
        prisma.enrollment.upsert({
          where: { studentId_date: { studentId: user.id, date } },
          update: {
            sessionId: session.id,
            status: 'teacher_override',
            // An override is not a suggestion: the student cannot change it,
            // whatever the cutoff for this date says.
            locked: true,
            overrideById: req.user.id,
          },
          create: {
            studentId: user.id,
            date,
            sessionId: session.id,
            status: 'teacher_override',
            locked: true,
            overrideById: req.user.id,
          },
        })
      );

      if (previous && previous.sessionId !== session.id) {
        // The enrollment row is updated, not replaced, so any attendance the
        // previous teacher had already recorded would follow the student into
        // this session and show up on its roster. Drop it — it describes a
        // period the student is no longer attending.
        writes.push(prisma.attendance.deleteMany({ where: { enrollmentId: previous.id } }));
      }

      const result = overrideResult(user.id, user, null);
      result.replaced =
        previous && previous.sessionId !== session.id
          ? { sessionId: previous.session.id, title: previous.session.title }
          : null;
      resultBy.set(user.id, result);
    }
    await prisma.$transaction(writes);

    const finalCount = enrolledCount + needSeat.length;
    res.json({
      date,
      session: { id: session.id, title: session.title },
      capacity: session.capacity,
      enrolledCount: finalCount,
      seatsLeft: Math.max(0, session.capacity - finalCount),
      assignedCount: assignable.length,
      skippedCount: studentIds.length - assignable.length,
      results: studentIds.map((id) => resultBy.get(id)),
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------- attendance

// POST /api/teacher/attendance  { enrollmentId, status, note? }
// Keyed on the enrollment, which is already one row per student per day, so
// taking attendance twice corrects the record instead of duplicating it.
teacherRouter.post('/attendance', async (req, res, next) => {
  try {
    const enrollmentId = String(req.body?.enrollmentId ?? '');
    if (!enrollmentId) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'enrollmentId is required.' });
    }

    const status = String(req.body?.status ?? '');
    if (!ATTENDANCE_STATUSES.includes(status)) {
      return res.status(400).json({
        error: 'bad_status',
        message: `status must be one of: ${ATTENDANCE_STATUSES.join(', ')}.`,
      });
    }

    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) {
      return res.status(404).json({ error: 'not_found', message: 'No such enrollment.' });
    }
    // Same ownership rule as everywhere else — attendance is a session record.
    await loadOwnedSession(req, enrollment.sessionId);

    // An omitted note leaves the existing one alone; an explicitly empty one
    // clears it.
    const note = has(req.body, 'note')
      ? String(req.body.note ?? '').trim() || null
      : undefined;

    const attendance = await prisma.attendance.upsert({
      where: { enrollmentId: enrollment.id },
      update: {
        status,
        recordedById: req.user.id,
        ...(note !== undefined ? { note } : {}),
      },
      create: {
        enrollmentId: enrollment.id,
        // Denormalized from the enrollment, never from the request: the row
        // must describe the day the student was actually scheduled.
        date: enrollment.date,
        status,
        note: note ?? null,
        recordedById: req.user.id,
      },
    });

    res.json({ attendance: serializeAttendance(attendance) });
  } catch (err) {
    next(err);
  }
});

teacherRouter.get('/attendance', async (req, res, next) => {
  try {
    const sessionId = String(req.query.sessionId ?? '');
    if (!sessionId) {
      return res.status(400).json({ error: 'bad_request', message: 'sessionId is required.' });
    }
    const session = await loadOwnedSession(req, sessionId);
    const date = readDateParam(req.query.date);

    const rows = await prisma.attendance.findMany({
      where: { date, enrollment: { sessionId: session.id } },
      include: { enrollment: { include: { student: true } } },
    });

    res.json({
      date,
      session: { id: session.id, title: session.title },
      attendance: rows
        .map((row) => serializeAttendance(row, row.enrollment.student))
        // Sorted here rather than in the query: ordering by a relation two
        // levels down is more fragile than sorting a single roster's worth.
        .sort((a, b) => a.student.displayName.localeCompare(b.student.displayName)),
    });
  } catch (err) {
    next(err);
  }
});
