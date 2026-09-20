import { Router } from 'express';
import { authRouter } from './auth.js';
import { sessionsRouter } from './sessions.js';
import { subjectTagsRouter } from './subjectTags.js';
import { meRouter } from './me.js';
import { devRouter } from './dev.js';
import { devModeEnabled } from '../auth/index.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'bowiespark-api', devMode: devModeEnabled() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/sessions', sessionsRouter);
apiRouter.use('/subject-tags', subjectTagsRouter);

// Not merely guarded — not mounted at all unless DEV_MODE is on.
if (devModeEnabled()) {
  apiRouter.use('/dev', devRouter);
}
