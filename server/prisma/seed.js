// Seeds the fake dataset for the v1 beta. Build sheet §4 is explicit that no
// real student PII goes near v1 — every name and address below is invented.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { encodeDays } from '../src/lib/days.js';
import { schoolWeekOf, todayKey } from '../src/lib/dates.js';
import {
  POLICY_KEYS,
  STUDENT_EMAIL_DOMAIN,
  STAFF_EMAIL_DOMAIN,
} from '../src/lib/constants.js';

const prisma = new PrismaClient();

const SUBJECT_TAGS = [
  'Math',
  'Science',
  'English',
  'LOTEs',
  'Fine Arts',
  'Electives',
  'Other',
];

const TEACHERS = [
  ['Ms. Cowlin', 'cowlin'],
  ['Mr. Delacroix', 'delacroix'],
  ['Dr. Okonkwo', 'okonkwo'],
  ['Ms. Raintree', 'raintree'],
  ['Mr. Vasquez', 'vasquez'],
];

const STUDENTS = [
  ['Avery Nguyen', 'anguyen'],
  ['Bo Fitzgerald', 'bfitzgerald'],
  ['Camila Ortiz', 'cortiz'],
  ['Dev Patel', 'dpatel'],
  ['Elena Sokolov', 'esokolov'],
  ['Finn Gallagher', 'fgallagher'],
  ['Grace Abara', 'gabara'],
  ['Hiro Tanaka', 'htanaka'],
];

// [title, teacherIndex, subjectTag, capacity, recurrence, days, prerequisites]
const SESSIONS = [
  ['Algebra II Reteach', 0, 'Math', 12, 'daily', [], ''],
  ['AP Calc Problem Set Lab', 0, 'Math', 8, 'specific_days', ['TUE', 'THU'], 'Must be enrolled in AP Calculus AB or BC'],
  ["Cowlin's Cosmic Study Lab", 0, 'Science', 20, 'daily', [], ''],
  ['Chemistry Makeup Labs', 2, 'Science', 6, 'specific_days', ['WED'], 'Must have a missing lab to make up'],
  ['Essay Workshop', 1, 'English', 15, 'specific_days', ['MON', 'WED'], ''],
  ['Silent Reading Room', 1, 'English', 30, 'daily', [], ''],
  ['Spanish III Conversation', 3, 'LOTEs', 10, 'specific_days', ['TUE', 'THU'], 'Spanish II or equivalent'],
  ['FILM CLUB!!', 4, 'Fine Arts', 25, 'specific_days', ['FRI'], ''],
  ['Jazz Band Sectionals', 4, 'Fine Arts', 14, 'specific_days', ['MON', 'TUE', 'WED', 'THU'], 'Must be enrolled in Band'],
  ['Robotics Build Time', 2, 'Electives', 16, 'daily', [], ''],
  ['Yearbook Production', 3, 'Electives', 12, 'specific_days', ['MON', 'THU'], ''],
  ['Open Study Hall', 3, 'Other', 40, 'daily', [], ''],
];

async function main() {
  console.log('Seeding fake data...');

  // Wipe in FK-safe order so re-seeding is repeatable.
  await prisma.attendance.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.cutoffConfig.deleteMany();
  await prisma.session.deleteMany();
  await prisma.subjectTag.deleteMany();
  await prisma.policyText.deleteMany();
  await prisma.user.deleteMany();

  const tags = {};
  for (const [i, name] of SUBJECT_TAGS.entries()) {
    tags[name] = await prisma.subjectTag.create({
      data: { name, sortOrder: i },
    });
  }

  const admin = await prisma.user.create({
    data: {
      email: `fit.admin@${STAFF_EMAIL_DOMAIN}`,
      role: 'admin',
      displayName: 'Ana Reyes (Admin)',
    },
  });

  const teachers = [];
  for (const [displayName, handle] of TEACHERS) {
    teachers.push(
      await prisma.user.create({
        data: { email: `${handle}@${STAFF_EMAIL_DOMAIN}`, role: 'teacher', displayName },
      })
    );
  }

  const students = [];
  for (const [displayName, handle] of STUDENTS) {
    students.push(
      await prisma.user.create({
        data: { email: `${handle}@${STUDENT_EMAIL_DOMAIN}`, role: 'student', displayName },
      })
    );
  }

  const sessions = [];
  for (const [title, tIdx, tag, capacity, recurrenceType, days, prerequisites] of SESSIONS) {
    sessions.push(
      await prisma.session.create({
        data: {
          title,
          teacherId: teachers[tIdx].id,
          subjectTagId: tags[tag].id,
          capacity,
          recurrenceType,
          days: encodeDays(days),
          prerequisites,
          description: `${title} — a seeded demo session for the FIT beta. Replace with real copy once teachers start creating their own.`,
        },
      })
    );
  }

  await prisma.policyText.create({
    data: {
      key: POLICY_KEYS.TEACHER_OVERRIDE_NOTICE,
      value:
        'Teacher assigned — attendance is mandatory. Missing it results in an automatic referral.',
      updatedById: admin.id,
    },
  });

  await prisma.cutoffConfig.create({
    data: { scope: 'global', cutoffRule: 'T-0', setByAdminId: admin.id },
  });

  // Enrollments across the current school week. @@unique([studentId, date])
  // means at most one per student per day, so we walk days and hand out one
  // pick each — deterministic, so re-seeding gives the same demo state.
  const week = schoolWeekOf(todayKey());
  const dailySessions = sessions.filter((s) => s.recurrenceType === 'daily');

  let created = 0;
  for (const [dayIdx, { date }] of week.entries()) {
    for (const [sIdx, student] of students.entries()) {
      // Leave a couple of students unscheduled each day — the "failed to
      // schedule" case the admin analytics will eventually surface.
      if ((sIdx + dayIdx) % 4 === 0) continue;
      const session = dailySessions[(sIdx + dayIdx) % dailySessions.length];
      await prisma.enrollment.create({
        data: {
          sessionId: session.id,
          studentId: student.id,
          date,
          status: 'self_selected',
          locked: false,
        },
      });
      created++;
    }
  }

  // One teacher override, so the locked/override UI path has real data.
  // Upsert, not create: an override REPLACES that day's self-selected pick.
  const overrideStudent = students[1];
  const overrideDate = week[2].date;
  const overrideSession = sessions.find((s) => s.title === 'Chemistry Makeup Labs');
  await prisma.enrollment.upsert({
    where: { studentId_date: { studentId: overrideStudent.id, date: overrideDate } },
    update: {
      sessionId: overrideSession.id,
      status: 'teacher_override',
      locked: true,
      overrideById: teachers[2].id,
    },
    create: {
      sessionId: overrideSession.id,
      studentId: overrideStudent.id,
      date: overrideDate,
      status: 'teacher_override',
      locked: true,
      overrideById: teachers[2].id,
    },
  });

  console.log(
    `  ${SUBJECT_TAGS.length} subject tags, ${teachers.length} teachers, ` +
      `${students.length} students, ${sessions.length} sessions, ~${created} enrollments`
  );
  console.log(`  Override demo: ${overrideStudent.displayName} on ${overrideDate}`);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
