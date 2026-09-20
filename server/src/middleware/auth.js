// ---------------------------------------------------------------------------
// DEV AUTH SHIM — the single module boundary real auth will replace.
//
// The build sheet (§6) specifies Auth.js for domain-gated email/password plus
// Google OAuth. `@auth/express` is still beta, so v1's skeleton does NOT ship
// real auth. Instead the client names a seeded user via the `x-dev-user-id`
// header and the server trusts it — acceptable only because the database
// holds nothing but fake data.
//
// Replacing this file with a real session lookup is the whole migration: every
// route reads `req.user` and knows nothing about how it got there.
// ---------------------------------------------------------------------------
import { prisma } from '../db.js';
import { STUDENT_EMAIL_DOMAIN, STAFF_EMAIL_DOMAIN } from '../lib/constants.js';

const DEV_USER_HEADER = 'x-dev-user-id';

export function devAuthEnabled() {
  return process.env.DEV_AUTH_ENABLED === 'true';
}

// Domain gating lives here (not in a route) so it survives the auth swap.
export function isAllowedEmail(email, role) {
  const domain = String(email).toLowerCase().split('@')[1];
  if (!domain) return false;
  return role === 'student'
    ? domain === STUDENT_EMAIL_DOMAIN
    : domain === STAFF_EMAIL_DOMAIN;
}

export async function attachUser(req, _res, next) {
  try {
    if (!devAuthEnabled()) {
      req.user = null;
      return next();
    }
    const id = req.get(DEV_USER_HEADER);
    req.user = id
      ? await prisma.user.findFirst({ where: { id, active: true } })
      : null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'unauthenticated',
      message: devAuthEnabled()
        ? `Send a seeded user id in the ${DEV_USER_HEADER} header. GET /api/dev/users lists them.`
        : 'Authentication required.',
    });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: 'forbidden', message: `Requires role: ${roles.join(' or ')}.` });
    }
    next();
  };
}
