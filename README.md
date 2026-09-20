# FIT & Club Scheduling Platform

Student self-scheduling for Flexible Instruction Time and club signups.
See `buildplan.txt` for the full v1 spec.

**Status: skeleton.** The stack runs end to end — React → Vite proxy → Express →
Prisma → SQLite — with the complete v1 data model migrated and seeded. Feature
work (signing up, overrides, attendance, analytics) is deliberately not built yet.

## Quick start

```bash
npm install
npm run db:migrate     # creates server/prisma/dev.db from the schema
npm run db:seed        # loads the fake dataset
npm run dev            # API on :4000, client on :5173
```

`server/.env` is gitignored, so a fresh clone has no `DATABASE_URL` and Prisma
would abort. `server/scripts/ensure-env.js` runs automatically ahead of
`db:migrate`, `db:seed`, `db:reset` and `dev`, copying `.env.example` into place
the first time. Nothing secret is ever committed — the example holds local
defaults only.

Then open <http://localhost:5173>. Use the yellow dev bar at the top to switch
between seeded students, teachers, and the admin.

`npm run setup` does install + migrate + seed in one go.

## Layout

```
server/            Express API
  prisma/
    schema.prisma  the full v1 data model (build sheet §4)
    seed.js        fake dataset — no real student data, ever
  src/
    routes/        read-only API surface
    middleware/    auth.js is the dev auth shim (see below)
    lib/           days / dates / shared constants
client/            React SPA (Vite)
  src/pages/       one per role
  src/lib/api.js   the only place fetch is called
```

## What works right now

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/me` | current user |
| `GET /api/me/week` | student homescreen — the Mon–Fri week, picks, override flags |
| `GET /api/sessions?date=&subjectTagId=` | browse sessions running on a date |
| `GET /api/sessions/:id` | one session |
| `GET /api/subject-tags` | the admin-editable subject tabs |
| `GET /api/dev/users` | dev-only user switcher roster |

In the UI: the weekly strip, subject tabs, session browsing with live seat
counts, and the locked teacher-override day with its policy notice. The
teacher and admin routes are labelled shells.

## House style

White ground, `#B3B3B3` linework, `#B71C1C` carrying the UI — set in one place,
`client/src/styles.css`. The scheme is fixed light; there is no dark variant.

One constraint shaped the whole sheet: **`#B3B3B3` on white measures ~2.1:1
contrast**, far under the 4.5:1 WCAG AA floor for text. So the silver is used
only for rules, borders, frames and ornament, never to set type — secondary copy
uses a darker neutral instead. `#B71C1C` on white measures ~6.6:1 and passes AA
in both directions, so it can carry text, sit under white text, and act as the
interactive color throughout.

Type is a system serif for display and system sans for body. No web font is
loaded: a district privacy review is one less conversation if the app never
calls out to a font CDN.

## Decisions worth knowing

**Auth is a dev shim, not Auth.js.** The build sheet (§6) specifies Auth.js for
domain-gated email/password plus Google OAuth. `@auth/express` is still beta, so
rather than let an unproven dependency block the skeleton, the client names a
seeded user in an `x-dev-user-id` header and the server trusts it. This is only
acceptable because the database holds nothing but invented data.

Everything auth-related lives in `server/src/middleware/auth.js` — including the
`@stu.austinisd.org` / `@austinisd.org` domain gate. Routes read `req.user` and
know nothing about where it came from, so real auth replaces that one file.
**`DEV_AUTH_ENABLED` must be `false` before anything is deployed anywhere.**

**SQLite has no array columns.** Verified against Prisma 6.19: `String[]` is
rejected by the sqlite connector. `Session.days` is therefore a JSON-encoded
string, and every read/write of it goes through `server/src/lib/days.js`.

**SQLite does accept enums** — Prisma stores them as `TEXT`. Note it does *not*
emit a `CHECK` constraint, so the value set is enforced by the Prisma client, not
the database. Raw SQL writes could insert a bad value.

**Calendar dates are `"YYYY-MM-DD"` strings, not `DateTime`.** A FIT day is a
local school-calendar date, not an instant. Storing text keeps
`@@unique([studentId, date])` exact and avoids timezone drift silently moving a
student's pick to the wrong day.

**One pick per student per day**, enforced by that unique index. A teacher
override *replaces* the student's self-selected row for that date via upsert —
the two never coexist. The spec implies this but never says it; the constraint
makes it true.

**Recurrence expands at read time.** There are no materialized occurrence rows —
`GET /api/sessions?date=` derives what runs from `recurrenceType` + `days`.

## Not built yet

Signup/change writes · cutoff enforcement (`CutoffConfig` is seeded but no rule
parser is wired up) · the teacher override tool · attendance capture · admin
management UI for SubjectTags, PolicyText and cutoffs · analytics · real auth.

## Known advisories

`npm audit` reports three high findings, all the same chain:
`prisma → @prisma/config → deepmerge-ts`. Prisma 7 pins the identical version, so
there is no upgrade path today. It is a **devDependency** used by the CLI at
migrate/generate time and never ships to production. Revisit when Prisma
releases a bumped `@prisma/config`.

## Deployment (not done yet)

Per build sheet §5, the target is a Linode VPS: `client/dist` served statically by
nginx, the Express API behind it under `/api` via reverse proxy, kept alive by pm2
or systemd, with Let's Encrypt TLS and a firewall. Because the client only ever
calls relative `/api/...` paths, nothing in the frontend changes between the Vite
dev proxy and that nginx setup.
