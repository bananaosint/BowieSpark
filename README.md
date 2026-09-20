# FIT & Club Scheduling Platform

Student self-scheduling for Flexible Instruction Time and club signups, built
for a ~3,000-student AISD high school. See `buildplan.txt` for the full spec.

**Status: v1 complete, running on fake data.** Everything in build sheet §3 is
built and working — accounts, self-scheduling, cutoffs, teacher overrides,
attendance, admin configuration and analytics. No real student data has ever
touched it.

## Quick start

Needs **Node.js 20 or newer** and nothing else — no database server to install,
no global packages. Check with `node --version`; if it's missing or older, get it
from <https://nodejs.org> (the LTS build). npm ships with Node.

```bash
npm install
npm run db:migrate     # creates server/prisma/dev.db from the schema
npm run db:seed        # loads the fake dataset
npm run dev            # API on :4000, client on :5173
```

Then open <http://localhost:5173>.

`npm run setup` does install + migrate + seed in one go. `Ctrl+C` stops both
halves. `npm run db:reset` wipes the database and reloads the fake data.

`server/.env` is gitignored, so a fresh clone has no `DATABASE_URL` and Prisma
would abort. `server/scripts/ensure-env.js` runs automatically ahead of
`db:migrate`, `db:seed`, `db:reset` and `dev`, copying `.env.example` into place
the first time. Nothing secret is committed — the example holds local defaults
only.

### Signing in

Every seeded account uses the password **`FitBeta2026!`**:

| Who | Email | Shows off |
| --- | --- | --- |
| Student | `anguyen@stu.austinisd.org` | the week view, browsing, signing up |
| Student | `bfitzgerald@stu.austinisd.org` | a locked teacher-assigned day |
| Teacher | `cowlin@austinisd.org` | sessions, roster, overrides, attendance |
| Admin | `fit.admin@austinisd.org` | configuration and analytics |

### Dev view vs user view

The striped red bar at the top switches between them.

- **User view** (the default) is the real thing: sign in with an email and
  password, get a real server-side session.
- **Dev view** lets you jump between seeded accounts with no password, for
  checking how the app looks to each role without logging in and out.

Dev view only exists when the **server** says so — `DEV_MODE=true` in
`server/.env`. With it off, `/api/dev/*` is not mounted at all, the
impersonation header is never read, and the toggle does not render. It is an
environment decision, not something the browser can turn on.

## Layout

```
server/            Express API
  prisma/
    schema.prisma  the v1 data model (build sheet §4)
    seed.js        fake dataset — no real student data, ever
  scripts/         ensure-env.js, run automatically before db commands
  src/
    auth/          password hashing, sessions, the domain gate
    routes/        auth, me, sessions, enrollments, teacher, admin, dev
    lib/           cutoff engine, dates, days, constants, rate limiting
client/            React SPA (Vite)
  src/pages/       LoginPage, StudentHome, SchedulePage, TeacherHome, AdminHome
  src/components/  SessionCard, SessionForm, RosterPanel, DevBar
  src/lib/         api.js (the only place fetch is called), auth.jsx
```

## What's built

**Students** sign in with a `@stu.austinisd.org` address, see their Mon–Fri
week, browse sessions by subject tab, search by teacher, sign up, change their
mind until the cutoff, and review current and past schedules with attendance.
A teacher-assigned day shows only that session, locked, with the admin-editable
notice explaining why.

**Teachers** create and edit their own sessions (capacity, recurrence, a
50-word description, display-only prerequisites), see the roster for any date,
take attendance, and assign students directly into their sessions.

**Admins** do everything teachers do org-wide, plus manage subject tabs, the
policy wording, the signup cutoff, accounts, and an analytics dashboard
covering usage by subject and teacher, attendance, no-show rate and students
who repeatedly fail to schedule.

### API

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/auth/signup` `/login` `/logout` `/password` | accounts |
| GET | `/api/auth/me` `/config` | current user, domain rules |
| GET | `/api/me/week` | the student homescreen |
| GET | `/api/sessions` `/api/sessions/:id` | browse, with seat counts and cutoff state |
| GET | `/api/subject-tags` | the subject tabs |
| POST/DELETE/GET | `/api/enrollments` `/:date` `/history` | sign up, cancel, history |
| GET/POST/PATCH/DELETE | `/api/teacher/sessions…` | own sessions, roster, override |
| GET/POST | `/api/teacher/attendance` `/students` | attendance, student lookup |
| GET/POST/PATCH/PUT/DELETE | `/api/admin/…` | tags, policy, cutoff, users, analytics |
| GET | `/api/dev/users` | dev view only; absent unless `DEV_MODE=true` |

## Decisions worth knowing

**Auth is self-rolled, not Auth.js.** The build sheet (§6) names Auth.js, but
`@auth/express` is still beta and this is something students will depend on.
Passwords use **scrypt** from `node:crypto` — no dependency, no native build —
with the parameters stored in the hash string so they can be raised later
without invalidating anyone's password. Sessions are server-side rows; the
cookie carries a 256-bit random token and only its SHA-256 hash is stored, so a
database leak does not hand over live sessions. Everything auth-related sits
behind `server/src/auth/`, so adding "Sign in with Google" later means adding a
provider there, not reworking the app.

**Role comes from the email domain, never from the request body** — otherwise
signup would be self-service privilege escalation. Students self-activate;
**staff accounts land inactive until an admin approves them**, because there is
no email verification in v1 and anyone could type a staff address.

**Teachers can only act on their own sessions.** One `loadOwnedSession()` helper
guards every teacher route, so the rule cannot be forgotten in one endpoint. A
teacher may assign any student, but only *into* a session they own, and can
never read or change another teacher's session, roster or attendance. Admins act
org-wide, per §2.

**One pick per student per day**, enforced by `@@unique([studentId, date])`. A
teacher override *replaces* the student's self-selected row via upsert — the two
never coexist. The spec implies this but never says it; the constraint makes it
true.

**Capacity is checked after the write, inside the transaction.** Counting before
writing leaves a window where two students both read "one seat left" and both
take it — the signup rush the build sheet flags. SQLite serialises writers, so
the loser sees the winner's row and rolls its own seat back. Firing 8 students
at a 3-seat session at once yields exactly 3 enrolments.

**The cutoff lock is computed, not stored.** `Enrollment.locked` is only written
by the override path, so reading it raw would report a past-cutoff pick as still
changeable and the UI would offer a button the server refuses. Both the week
view and the browse list derive it from the cutoff rule, so a session closes in
the UI at the same moment it closes on the server.

**Calendar dates are `"YYYY-MM-DD"` strings, not `DateTime`.** A FIT day is a
local school-calendar date, not an instant. Text keeps the per-day unique index
exact and stops timezone drift moving a pick to the wrong day. The server is
assumed to run in the school's timezone.

**SQLite has no array columns** (verified against Prisma 6.19), so
`Session.days` is a JSON string behind `server/src/lib/days.js`. Enums *are*
supported but stored as plain `TEXT` with no `CHECK` constraint — the value set
is enforced by the Prisma client, so raw SQL could write an invalid value.

**Recurrence expands at read time.** There are no occurrence rows; what runs on
a date is derived from `recurrenceType` + `days`.

## House style

White ground, `#B3B3B3` linework, `#B71C1C` carrying the UI, set in
`client/src/styles.css`. Fixed light; no dark variant.

`#B3B3B3` on white is ~2.1:1 contrast, far under the 4.5:1 WCAG AA floor, so the
silver is used only for rules, borders and ornament — never to set type.
`#B71C1C` is ~6.6:1 and passes AA both ways, so it carries text and the
interactive states. Status is never conveyed by colour alone. Type uses system
stacks; no web font is loaded, which keeps one item off a district privacy
review.

## Not built (v2 / v3)

Google OAuth · SIS roster sync · attendance write-back · auto-routing rules ·
deeper analytics · email verification. Hall passes are out of scope
indefinitely — the school keeps using Enriching Students for that.

A teacher cannot *undo* an override — v1 scope is assign-only, by choice. That
would have left a mis-assignment permanent, so an admin can clear any
enrollment (`DELETE /api/admin/enrollments/:id`, surfaced as **Clear** on the
roster), freeing the student to choose again. Give teachers the same power if
the admin round-trip proves annoying in practice.

## Before this goes anywhere real

- [ ] `DEV_MODE=false` and `NODE_ENV=production` — non-negotiable
- [ ] Real DPA signed with AISD before any real student data (Texas SB 820)
- [ ] `app.set('trust proxy', 1)` behind nginx, or rate limiting sees every
      request as coming from 127.0.0.1
- [ ] Load-test the signup rush against SQLite at 3,000 students; Postgres is a
      Prisma connector change, not a rewrite
- [ ] TLS, firewall and a process manager on the VPS (build sheet §5)
- [ ] Scrub `buildplan.txt` of anything you would not hand to district IT

## Known advisories

`npm audit` reports three high findings, all one chain:
`prisma → @prisma/config → deepmerge-ts`. Prisma 7 pins the same version, so
there is no upgrade path today. It is a **devDependency** used by the CLI at
migrate/generate time and never ships to production.
