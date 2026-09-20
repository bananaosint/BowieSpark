-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CutoffConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "cutoffRule" TEXT NOT NULL DEFAULT 'T-0',
    "bellTime" TEXT NOT NULL DEFAULT '09:30',
    "updatedAt" DATETIME NOT NULL,
    "sessionId" TEXT,
    "setByAdminId" TEXT,
    CONSTRAINT "CutoffConfig_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CutoffConfig_setByAdminId_fkey" FOREIGN KEY ("setByAdminId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CutoffConfig" ("cutoffRule", "id", "scope", "sessionId", "setByAdminId", "updatedAt") SELECT "cutoffRule", "id", "scope", "sessionId", "setByAdminId", "updatedAt" FROM "CutoffConfig";
DROP TABLE "CutoffConfig";
ALTER TABLE "new_CutoffConfig" RENAME TO "CutoffConfig";
CREATE UNIQUE INDEX "CutoffConfig_sessionId_key" ON "CutoffConfig"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
