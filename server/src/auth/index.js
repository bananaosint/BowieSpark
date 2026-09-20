// The one module that decides who a request is from. Routes read `req.user`
// and know nothing about cookies, passwords or dev mode.
import { prisma } from '../db.js';
import { SESSION_COOKIE, resolveSession } from './sessions.js';
import { STUDENT_EMAIL_DOMAIN, STAFF_EMAIL_DOMAIN } from '../lib/constants.js';

const DEV_USER_HEADER = 'x-dev-user-id';

// Dev mode is an ENV decision, never a request-time one. When it is off the
// impersonation header is not merely rejected — it is never read, and the
// /api/dev routes are not mounted at all.
export function devModeEnabled() {
  return process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
}

// ------------------------------------------------------------------ domains

export function domainOf(email) {
  return String(email ?? '').trim().toLowerCase().split('@')[1] ?? '';
}

// Role is derived from the email domain. It is NEVER taken from client input —
// otherwise signup would be a self-service privilege escalation.
export function roleForEmail(email) {
  const domain = domainOf(email);
  if (domain === STUDENT_EMAIL_DOMAIN) return 'student';
  if (domain === STAFF_EMAIL_DOMAIN) return 'teacher';
  return null;
}

export function isAllowedEmail(email) {
  return roleForEmail(email) !== null;
}

// Students self-activate. Staff do not: there is no email verification in v1,
// so anyone could type principal@austinisd.org and claim a teacher account.
// Staff signups land inactive until an admin turns them on.
export function activatesImmediately(role) {
  return role === 'student';
}

// ----------------------------------------------------------- request wiring

export async function attachUser(req, _res, next) {
  try {
    req.user = null;
    req.viaDevMode = false;

    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      req.user = await resolveSession(token);
    }

    // Dev-view impersonation. Only consulted when DEV_MODE is on, and only
    // when no real session is already in play, so it can never silently
    // override a genuine login.
    if (!req.user && devModeEnabled()) {
      const id = req.get(DEV_USER_HEADER);
      if (id) {
        req.user = await prisma.user.findFirst({ where: { id, active: true } });
        req.viaDevMode = Boolean(req.user);
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'forbidden',
        message: `This action requires: ${roles.join(' or ')}.`,
      });
    }
    next();
  };
}

// Admins can do everything teachers can, org-wide (build sheet §2).
export const requireTeacher = requireRole('teacher', 'admin');
export const requireAdmin = requireRole('admin');

export function publicUser(user) {
  if (!user) return null;
  const { id, email, role, displayName, active, createdAt } = user;
  return { id, email, role, displayName, active, createdAt };
}
