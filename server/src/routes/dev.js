import { Router } from 'express';
import { prisma } from '../db.js';
import { devAuthEnabled } from '../middleware/auth.js';

export const devRouter = Router();

// Dev-only user switcher. Disappears with the auth shim — see middleware/auth.js.
devRouter.use((_req, res, next) => {
  if (!devAuthEnabled()) {
    return res.status(404).json({ error: 'not_found' });
  }
  next();
});

devRouter.get('/users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      select: { id: true, email: true, role: true, displayName: true },
    });
    res.json({ users, warning: 'Dev auth shim is enabled. Fake data only.' });
  } catch (err) {
    next(err);
  }
});
