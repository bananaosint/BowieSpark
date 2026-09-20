// End-to-end API checks against a running server.
//
//   npm run dev        (in one terminal)
//   npm test           (in another)
//
// Deliberately dependency-free — plain fetch, so it needs nothing installed
// beyond what the app already uses. It drives the REAL API with REAL logins
// rather than mocking, because the things most worth protecting here are
// authorization boundaries, and a mock cannot tell you those still hold.
//
// It writes to the database and cleans up after itself, but it expects the
// seeded dataset. If anything looks wrong, `npm run db:seed` and re-run.

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';
const PW = process.env.DEMO_PASSWORD ?? 'FitBeta2026!';

let pass = 0;
let fail = 0;
const failures = [];

function ck(label, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}  ${detail}`);
    console.log(`  ✗ ${label}  ${detail}`);
  }
}
const section = (name) => console.log(`\n${name}`);

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (!res.ok) {
    throw new Error(
      `Could not sign in as ${email} (${res.status}). Is the server running and the database seeded?`
    );
  }
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { user } = await res.json();
  return {
    user,
    async call(path, options = {}) {
      const r = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', Cookie: cookie, ...options.headers },
        ...(options.body && typeof options.body !== 'string'
          ? { body: JSON.stringify(options.body) }
          : {}),
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        /* some responses have no body */
      }
      return { status: r.status, body };
    },
  };
}

// --------------------------------------------------------------------------

const avery = await login('anguyen@stu.austinisd.org');
const bo = await login('bfitzgerald@stu.austinisd.org');
const cowlin = await login('cowlin@austinisd.org');
const okonkwo = await login('okonkwo@austinisd.org');
const admin = await login('fit.admin@austinisd.org');

const week = (await avery.call('/me/week')).body;
const monday = week.days[0].date;
const wednesday = week.days[2].date;

section('AUTHENTICATION');
{
  const anon = await fetch(`${BASE}/me/week`);
  ck('anonymous request is refused', anon.status === 401, String(anon.status));

  const bad = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'anguyen@stu.austinisd.org', password: 'wrong-password' }),
  });
  ck('wrong password is refused', bad.status === 401);
  const badBody = await bad.json();
  const missing = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@stu.austinisd.org', password: 'wrong-password' }),
  });
  const missingBody = await missing.json();
  // Identical responses, or the login form becomes an account-enumeration oracle.
  ck(
    'unknown account and wrong password are indistinguishable',
    badBody.message === missingBody.message && bad.status === missing.status,
    `${badBody.message} vs ${missingBody.message}`
  );

  const outsider = await fetch(`${BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'someone@gmail.com',
      password: 'correcthorsebattery',
      displayName: 'Outsider',
    }),
  });
  ck('signup is gated to school domains', outsider.status === 400);
}

section('STUDENT — self-scheduling');
{
  const sessions = (await avery.call(`/sessions?date=${monday}`)).body.sessions;
  const target = sessions.find((s) => !s.isFull && !s.pastCutoff);

  const r = await avery.call('/enrollments', {
    method: 'POST',
    body: { sessionId: target.id, date: monday },
  });
  ck('a student can sign up', r.status === 200, String(r.status));

  const other = sessions.find((s) => s.id !== target.id && !s.isFull && !s.pastCutoff);
  await avery.call('/enrollments', { method: 'POST', body: { sessionId: other.id, date: monday } });
  const rows = (await avery.call('/enrollments/history?limit=200')).body.enrollments.filter(
    (e) => e.date === monday
  );
  // @@unique([studentId, date]) — switching must replace, never accumulate.
  ck('changing your mind replaces the pick, never adds one', rows.length === 1, `${rows.length} rows`);

  ck(
    'a past date is refused',
    (await avery.call('/enrollments', { method: 'POST', body: { sessionId: other.id, date: '2020-01-06' } })).status >= 400
  );
  ck(
    'a weekend is refused',
    (await avery.call('/enrollments', { method: 'POST', body: { sessionId: other.id, date: '2026-09-26' } })).status >= 400
  );
  ck(
    'an impossible date is refused',
    (await avery.call(`/sessions?date=2026-02-30`)).status === 400
  );

  ck('a student can cancel', (await avery.call(`/enrollments/${monday}`, { method: 'DELETE' })).status === 200);
  ck('cancelling twice is a clean 404', (await avery.call(`/enrollments/${monday}`, { method: 'DELETE' })).status === 404);
}

section('STUDENT — a teacher assignment is locked');
{
  const w = (await bo.call('/me/week')).body;
  const wed = w.days.find((d) => d.date === wednesday);
  ck('the assigned day is flagged', wed?.isOverridden === true);
  ck('  ...and reported as locked', wed?.locked === true);
  ck('  ...with a reason the UI can use', wed?.lockReason === 'teacher_override', wed?.lockReason);

  const running = (await bo.call(`/sessions?date=${wednesday}`)).body.sessions[0];
  const attempt = await bo.call('/enrollments', {
    method: 'POST',
    body: { sessionId: running.id, date: wednesday },
  });
  ck('the student cannot switch out of it', attempt.status === 409, String(attempt.status));
  ck('the student cannot delete it', (await bo.call(`/enrollments/${wednesday}`, { method: 'DELETE' })).status >= 400);
}

section('TEACHER — may only act on their OWN sessions');
{
  const mine = (await cowlin.call('/teacher/sessions')).body.sessions;
  ck('a teacher sees their own sessions', mine.length > 0);
  ck(
    '  ...and only their own',
    mine.every((s) => s.teacher?.id === cowlin.user.id),
    'a session belonging to someone else appeared'
  );

  const theirs = (await okonkwo.call('/teacher/sessions')).body.sessions.find(
    (s) => s.title === 'Chemistry Makeup Labs'
  );
  const denied = (s) => s === 403 || s === 404;

  ck('cannot read another teacher roster', denied((await cowlin.call(`/teacher/sessions/${theirs.id}/roster?date=${wednesday}`)).status));
  ck('cannot edit another teacher session', denied((await cowlin.call(`/teacher/sessions/${theirs.id}`, { method: 'PATCH', body: { title: 'Hijacked' } })).status));
  ck('cannot delete another teacher session', denied((await cowlin.call(`/teacher/sessions/${theirs.id}`, { method: 'DELETE' })).status));
  ck('cannot assign INTO another teacher session', denied((await cowlin.call(`/teacher/sessions/${theirs.id}/override`, { method: 'POST', body: { studentIds: [avery.user.id], date: wednesday } })).status));

  const after = (await okonkwo.call('/teacher/sessions')).body.sessions.find((s) => s.id === theirs.id);
  ck('  ...and nothing was mutated by the attempts', after.title === 'Chemistry Makeup Labs', after.title);
}

section('TEACHER — session validation');
{
  const tags = (await cowlin.call('/subject-tags')).body.subjectTags;
  const base = {
    title: 'Test Session',
    subjectTagId: tags[0].id,
    capacity: 5,
    recurrenceType: 'daily',
    days: [],
    description: 'short',
    prerequisites: '',
  };
  const post = (over) => cowlin.call('/teacher/sessions', { method: 'POST', body: { ...base, ...over } });

  ck('the 50-word description cap is enforced', (await post({ description: Array(60).fill('word').join(' ') })).status === 400);
  ck('capacity must be positive', (await post({ capacity: 0 })).status === 400);
  ck('specific_days needs at least one day', (await post({ recurrenceType: 'specific_days', days: [] })).status === 400);

  const made = await post({ title: 'Test Session (cleanup)' });
  ck('a valid session is created', made.status === 201, String(made.status));
  ck('  ...owned by its creator', made.body?.session?.teacher?.id === cowlin.user.id);
  if (made.body?.session?.id) {
    ck('  ...and can be archived', (await cowlin.call(`/teacher/sessions/${made.body.session.id}`, { method: 'DELETE' })).status === 200);
  }
}

section('CAPACITY — a signup rush cannot oversell a session');
{
  const tags = (await cowlin.call('/subject-tags')).body.subjectTags;
  const made = await cowlin.call('/teacher/sessions', {
    method: 'POST',
    body: {
      title: 'Capacity Race (cleanup)',
      subjectTagId: tags[0].id,
      capacity: 3,
      recurrenceType: 'daily',
      days: [],
      description: 'x',
      prerequisites: '',
    },
  });
  const sid = made.body.session.id;

  const handles = ['anguyen', 'bfitzgerald', 'cortiz', 'dpatel', 'esokolov', 'fgallagher', 'gabara', 'htanaka'];
  const students = await Promise.all(handles.map((h) => login(`${h}@stu.austinisd.org`)));
  // All eight at once, which is the case a sequential test would never catch.
  const results = await Promise.all(
    students.map((s) => s.call('/enrollments', { method: 'POST', body: { sessionId: sid, date: monday } }))
  );

  const seated = (await cowlin.call(`/teacher/sessions/${sid}/roster?date=${monday}`)).body.roster.length;
  ck('never exceeds capacity under concurrency', seated <= 3, `${seated} seated in a 3-seat session`);
  ck('  ...and still fills every seat', seated === 3, String(seated));
  ck('  ...losers get a clean 409, not a 500', results.every((r) => r.status === 200 || r.status === 409), results.map((r) => r.status).join(','));

  for (const s of students) await s.call(`/enrollments/${monday}`, { method: 'DELETE' });
  await cowlin.call(`/teacher/sessions/${sid}`, { method: 'DELETE' });
}

section('CUTOFF — the UI verdict matches the server');
{
  const restore = (await admin.call('/admin/cutoff')).body.global;

  await admin.call('/admin/cutoff', { method: 'PUT', body: { cutoffRule: 'T-0', bellTime: '09:30' } });
  let mon = (await avery.call('/me/week')).body.days.find((d) => d.date === monday);
  ck('T-0: the coming Monday is open', mon.pastCutoff === false);

  // T-2 for Monday closes on Saturday, which has already passed.
  await admin.call('/admin/cutoff', { method: 'PUT', body: { cutoffRule: 'T-2@17:00', bellTime: '09:30' } });
  mon = (await avery.call('/me/week')).body.days.find((d) => d.date === monday);
  ck('T-2: the same day now reports closed', mon.pastCutoff === true);
  ck('  ...and locked', mon.locked === true);

  const browse = (await avery.call(`/sessions?date=${monday}`)).body.sessions;
  ck('  ...and every session in the list agrees', browse.every((s) => s.pastCutoff === true));
  const refused = await avery.call('/enrollments', { method: 'POST', body: { sessionId: browse[0].id, date: monday } });
  ck('  ...and the server refuses, matching what the UI showed', refused.status === 409 && refused.body.error === 'past_cutoff');

  ck('a nonsense cutoff rule is rejected', (await admin.call('/admin/cutoff', { method: 'PUT', body: { cutoffRule: 'whenever', bellTime: '09:30' } })).status === 400);

  await admin.call('/admin/cutoff', {
    method: 'PUT',
    body: { cutoffRule: restore?.cutoffRule ?? 'T-0', bellTime: restore?.bellTime ?? '09:30' },
  });
}

section('ADMIN');
{
  ck('lists subject tags', Array.isArray((await admin.call('/admin/subject-tags')).body?.subjectTags));

  const made = await admin.call('/admin/subject-tags', { method: 'POST', body: { name: 'TestTagCleanup' } });
  ck('creates a tag', made.status === 201 || made.status === 200, String(made.status));
  ck('rejects a duplicate name regardless of case', (await admin.call('/admin/subject-tags', { method: 'POST', body: { name: 'testtagcleanup' } })).status === 409);
  const tagId = made.body?.subjectTag?.id ?? made.body?.id;
  if (tagId) ck('  ...and an unused tag can be deleted', (await admin.call(`/admin/subject-tags/${tagId}`, { method: 'DELETE' })).status === 200);

  const inUse = (await admin.call('/admin/subject-tags')).body.subjectTags.find((t) => t.name === 'Math');
  ck('a tag still in use cannot be deleted', (await admin.call(`/admin/subject-tags/${inUse.id}`, { method: 'DELETE' })).status === 409);

  // Without these an admin can lock the entire school out of its own system.
  ck('an admin cannot deactivate themselves', (await admin.call(`/admin/users/${admin.user.id}`, { method: 'PATCH', body: { active: false } })).status === 409);
  ck('an admin cannot demote themselves', (await admin.call(`/admin/users/${admin.user.id}`, { method: 'PATCH', body: { role: 'student' } })).status === 409);

  const a = (await admin.call('/admin/analytics')).body;
  ck('analytics returns usage by subject', Array.isArray(a?.usageBySubject));
  ck('  ...an attendance breakdown', Boolean(a?.attendanceBreakdown));
  ck('  ...and who is failing to schedule', Array.isArray(a?.unscheduledStudents));
}

section('ADMIN — can undo a teacher override, nobody else can');
{
  const dev = await login('dpatel@stu.austinisd.org');
  const day = (await dev.call('/me/week')).body.days.find((d) => !d.isOverridden)?.date ?? monday;
  const mine = (await cowlin.call(`/teacher/sessions?date=${day}`)).body.sessions.find((s) => s.runsOnDate !== false);

  await cowlin.call(`/teacher/sessions/${mine.id}/override`, { method: 'POST', body: { studentIds: [dev.user.id], date: day } });
  const row = (await cowlin.call(`/teacher/sessions/${mine.id}/roster?date=${day}`)).body.roster.find(
    (r) => r.student?.id === dev.user.id
  );
  ck('the assignment lands', Boolean(row));

  ck('the teacher cannot undo it', (await cowlin.call(`/admin/enrollments/${row.enrollmentId}`, { method: 'DELETE' })).status === 403);
  ck('the student cannot undo it', (await dev.call(`/enrollments/${day}`, { method: 'DELETE' })).status >= 400);
  ck('the admin can', (await admin.call(`/admin/enrollments/${row.enrollmentId}`, { method: 'DELETE' })).status === 200);

  const after = (await dev.call('/me/week')).body.days.find((d) => d.date === day);
  ck('  ...and the student is free to choose again', !after.isOverridden && !after.enrollment);
}

section('ROLE BOUNDARIES');
{
  ck('a student cannot reach teacher tools', (await avery.call('/teacher/sessions')).status === 403);
  ck('a student cannot reach admin tools', (await avery.call('/admin/users')).status === 403);
  ck('a teacher cannot reach admin tools', (await cowlin.call('/admin/users')).status === 403);
  // Build sheet §2: admins get the teacher toolkit org-wide.
  ck('an admin CAN reach teacher tools', (await admin.call('/teacher/sessions')).status === 200);
}

// --------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
  console.log('\nIf these look like leftover state, run `npm run db:seed` and try again.');
}
process.exit(fail ? 1 : 0);
