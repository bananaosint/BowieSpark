// Server-side sessions. The cookie carries a 256-bit random token; the
// database stores only its SHA-256 hash, so a leaked database does not hand
// an attacker live sessions. Lookup hashes the presented token and matches.
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';

export const SESSION_COOKIE = 'fit_session';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h — a school day plus slack
// Don't write lastSeenAt on every request; once every 15 minutes is enough to
// tell a live session from an abandoned one without a write per page load.
const TOUCH_AFTER_MS = 1000 * 60 * 15;

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId, { userAgent } = {}) {
  const token = randomBytes(32).toString('base64url');
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
    },
  });
  return { token, maxAgeMs: SESSION_TTL_MS };
}

// Returns the active user for a token, or null. Expired rows are deleted on
// sight so they cannot be resurrected by a clock change.
export async function resolveSession(token) {
  if (!token || typeof token !== 'string') return null;

  const row = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  // A deactivated account must lose access immediately, not at session expiry.
  if (!row.user?.active) {
    await prisma.authSession.deleteMany({ where: { userId: row.userId } }).catch(() => {});
    return null;
  }

  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await prisma.authSession
      .update({ where: { id: row.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  return row.user;
}

export async function revokeSession(token) {
  if (!token) return;
  await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } }).catch(() => {});
}

// Used when a password changes: every other device gets logged out.
export async function revokeAllForUser(userId) {
  await prisma.authSession.deleteMany({ where: { userId } });
}

export async function purgeExpired() {
  const { count } = await prisma.authSession.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

export function cookieOptions(maxAgeMs) {
  const secure = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true, // never readable from JS, so XSS cannot exfiltrate it
    sameSite: 'lax', // blocks cross-site POSTs while keeping normal navigation
    secure, // HTTPS-only in production; plain http breaks this locally
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}
