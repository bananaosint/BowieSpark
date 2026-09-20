import { Router } from 'express';
import { prisma } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  needsRehash,
} from '../auth/password.js';
import {
  SESSION_COOKIE,
  createSession,
  revokeSession,
  revokeAllForUser,
  cookieOptions,
} from '../auth/sessions.js';
import {
  roleForEmail,
  activatesImmediately,
  requireAuth,
  publicUser,
  devModeEnabled,
} from '../auth/index.js';
import { rateLimit, clientIp, reset as resetLimit } from '../lib/rateLimit.js';
import { STUDENT_EMAIL_DOMAIN, STAFF_EMAIL_DOMAIN } from '../lib/constants.js';

export const authRouter = Router();

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

// Deliberately identical for "no such user" and "wrong password" — differing
// responses turn the login form into an account-enumeration oracle.
const BAD_CREDENTIALS = 'Email or password is incorrect.';

// A throwaway hash compared against when the email doesn't exist, so a missing
// account costs the same time as a wrong password.
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'ZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXloYXNoZHVtbXlo';

const loginLimiter = rateLimit({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keyFn: (req) => `login:${clientIp(req)}:${normalizeEmail(req.body?.email)}`,
  message: 'Too many sign-in attempts. Wait a few minutes and try again.',
});

// Deliberately loose. A whole school sits behind a handful of NAT'd public
// IPs, so a tight per-IP signup cap would lock out an entire class the moment
// rollout started — the limit exists only to stop a runaway script, not to
// police legitimate volume. The real defences against bulk account creation
// are the email domain gate and, in v2, email verification.
const signupLimiter = rateLimit({
  limit: 60,
  windowMs: 60 * 60 * 1000,
  keyFn: (req) => `signup:${clientIp(req)}`,
  message: 'Too many accounts created from this network. Try again later.',
});

// --------------------------------------------------------------------- info

// Lets the sign-in screen explain the domain rule without hardcoding it twice.
authRouter.get('/config', (_req, res) => {
  res.json({
    studentDomain: STUDENT_EMAIL_DOMAIN,
    staffDomain: STAFF_EMAIL_DOMAIN,
    devMode: devModeEnabled(),
  });
});

// ------------------------------------------------------------------- signup

authRouter.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const displayName = String(req.body?.displayName ?? '').trim();

    // Role comes from the email domain, never from the request body.
    const role = roleForEmail(email);
    if (!role) {
      return res.status(400).json({
        error: 'bad_domain',
        message: `Use your school address — @${STUDENT_EMAIL_DOMAIN} for students, @${STAFF_EMAIL_DOMAIN} for staff.`,
      });
    }
    if (!displayName || displayName.length > 80) {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Enter your name (80 characters max).' });
    }
    const strength = validatePassword(password);
    if (!strength.ok) {
      return res.status(400).json({ error: 'weak_password', message: strength.message });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Safe to confirm here: the address is already public within the school,
      // and an unhelpful error would just generate support requests.
      return res
        .status(409)
        .json({ error: 'email_taken', message: 'That email already has an account. Sign in instead.' });
    }

    const active = activatesImmediately(role);
    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        role,
        active,
        passwordHash: await hashPassword(password),
      },
    });

    // Staff accounts wait for an admin — no session is issued.
    if (!active) {
      return res.status(202).json({
        user: publicUser(user),
        pendingApproval: true,
        message:
          'Staff accounts need an administrator to activate them before first sign-in.',
      });
    }

    const { token, maxAgeMs } = await createSession(user.id, {
      userAgent: req.get('user-agent'),
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------------- login

authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== 'string') {
      return res
        .status(400)
        .json({ error: 'bad_request', message: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always run a comparison, even with no user, so timing is flat.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: 'bad_credentials', message: BAD_CREDENTIALS });
    }
    if (!user.active) {
      return res.status(403).json({
        error: 'inactive_account',
        message: 'This account is not active yet. An administrator needs to approve it.',
      });
    }

    // Transparently upgrade a hash made with older parameters.
    if (needsRehash(user.passwordHash)) {
      await prisma.user
        .update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
        .catch(() => {});
    }

    resetLimit(`login:${clientIp(req)}:${email}`);
    const { token, maxAgeMs } = await createSession(user.id, {
      userAgent: req.get('user-agent'),
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------- logout

authRouter.post('/logout', async (req, res, next) => {
  try {
    await revokeSession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------- me

authRouter.get('/me', (req, res) => {
  res.json({
    user: publicUser(req.user),
    viaDevMode: Boolean(req.viaDevMode),
    devMode: devModeEnabled(),
  });
});

// ---------------------------------------------------------- change password

authRouter.post('/password', requireAuth, async (req, res, next) => {
  try {
    // Dev-mode impersonation must not be able to set someone's real password.
    if (req.viaDevMode) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Cannot change a password while impersonating in dev mode.',
      });
    }

    const current = req.body?.currentPassword;
    const next_ = req.body?.newPassword;

    const fresh = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!(await verifyPassword(current, fresh?.passwordHash ?? DUMMY_HASH))) {
      return res
        .status(401)
        .json({ error: 'bad_credentials', message: 'Current password is incorrect.' });
    }
    const strength = validatePassword(next_);
    if (!strength.ok) {
      return res.status(400).json({ error: 'weak_password', message: strength.message });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await hashPassword(next_) },
    });

    // Every other device is signed out, then this one gets a fresh session.
    await revokeAllForUser(req.user.id);
    const { token, maxAgeMs } = await createSession(req.user.id, {
      userAgent: req.get('user-agent'),
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions(maxAgeMs));
    res.json({ ok: true, message: 'Password changed. Other devices were signed out.' });
  } catch (err) {
    next(err);
  }
});
