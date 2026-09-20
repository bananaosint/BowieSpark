import { Router } from 'express';
import { prisma } from '../db.js';
import { devModeEnabled, publicUser } from '../auth/index.js';

export const devRouter = Router();

// Belt and braces: routes/index.js only mounts this router when DEV_MODE is
// on, and it re-checks per request so a hot-reloaded env change cannot leave
// an impersonation endpoint live.
devRouter.use((_req, res, next) => {
  if (!devModeEnabled()) return res.status(404).json({ error: 'not_found' });
  next();
});

// The roster behind the dev-view user switcher.
devRouter.get('/users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { active: true },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });
    res.json({
      users: users.map(publicUser),
      warning: 'DEV_MODE is enabled. Any account can be impersonated. Fake data only.',
    });
  } catch (err) {
    next(err);
  }
});
