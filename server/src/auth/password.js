// Password hashing via node:crypto scrypt — no dependency, no native build.
// scrypt is an OWASP-accepted password KDF; these parameters (N=16384, r=8,
// p=1) are the recommended interactive-login baseline.
//
// Stored format: scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>
// The parameters live in the string so they can be raised later without
// invalidating existing passwords — verify reads whatever each row was made
// with, and `needsRehash` flags the stale ones.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

// scrypt needs maxmem above roughly 128 * N * r; the default 32MB is too low.
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain) {
  assertUsable(plain);
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(plain.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64'),
    Buffer.from(hash).toString('base64'),
  ].join('$');
}

export async function verifyPassword(plain, stored) {
  // A user row with no password (OAuth-only, or not yet set) must never verify.
  if (typeof plain !== 'string' || typeof stored !== 'string' || !stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  let expected;
  try {
    expected = Buffer.from(hashB64, 'base64');
    const salt = Buffer.from(saltB64, 'base64');
    const actual = await scryptAsync(plain.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    });
    // Constant-time: a length-dependent early return would leak information.
    return timingSafeEqual(Buffer.from(actual), expected);
  } catch {
    return false;
  }
}

// True when a stored hash was made with weaker parameters than we now use.
export function needsRehash(stored) {
  if (typeof stored !== 'string') return true;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}

// Deliberately minimal: a length floor and a ban on the handful of passwords
// that show up in every breach corpus. Composition rules ("one symbol!") push
// people toward predictable substitutions without adding real entropy.
const OBVIOUS = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'iloveyou123',
  'letmein123',
]);

export function validatePassword(plain) {
  if (typeof plain !== 'string' || plain.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (plain.length > 200) {
    return { ok: false, message: 'Password must be under 200 characters.' };
  }
  if (OBVIOUS.has(plain.toLowerCase())) {
    return { ok: false, message: 'That password is too common. Pick something else.' };
  }
  return { ok: true };
}

function assertUsable(plain) {
  const check = validatePassword(plain);
  if (!check.ok) {
    const err = new Error(check.message);
    err.status = 400;
    err.code = 'weak_password';
    throw err;
  }
}
