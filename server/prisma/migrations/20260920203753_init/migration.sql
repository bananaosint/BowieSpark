-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SubjectTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "capacity" INTEGER NOT NULL,
    "recurrenceType" TEXT NOT NULL DEFAULT 'daily',
    "days" TEXT NOT NULL DEFAULT '[]',
    "prerequisites" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "teacherId" TEXT NOT NULL,
    "subjectTagId" TEXT NOT NULL,
    CONSTRAINT "Session_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_subjectTagId_fkey" FOREIGN KEY ("subjectTagId") REFERENCES "SubjectTag" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'self_selected',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "overrideById" TEXT,
    CONSTRAINT "Enrollment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enrollment_overrideById_fkey" FOREIGN KEY ("overrideById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "recordedById" TEXT,
    CONSTRAINT "Attendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CutoffConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "cutoffRule" TEXT NOT NULL DEFAULT 'T-0',
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT,
    "setByAdminId" TEXT,
    CONSTRAINT "CutoffConfig_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CutoffConfig_setByAdminId_fkey" FOREIGN KEY ("setByAdminId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyText" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "PolicyText_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectTag_name_key" ON "SubjectTag"("name");

-- CreateIndex
CREATE INDEX "SubjectTag_sortOrder_idx" ON "SubjectTag"("sortOrder");

-- CreateIndex
CREATE INDEX "Session_teacherId_idx" ON "Session"("teacherId");

-- CreateIndex
CREATE INDEX "Session_subjectTagId_idx" ON "Session"("subjectTagId");

-- CreateIndex
CREATE INDEX "Session_active_idx" ON "Session"("active");

-- CreateIndex
CREATE INDEX "Enrollment_sessionId_date_idx" ON "Enrollment"("sessionId", "date");

-- CreateIndex
CREATE INDEX "Enrollment_date_idx" ON "Enrollment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_studentId_date_key" ON "Enrollment"("studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_enrollmentId_key" ON "Attendance"("enrollmentId");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "Attendance_status_idx" ON "Attendance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CutoffConfig_sessionId_key" ON "CutoffConfig"("sessionId");
