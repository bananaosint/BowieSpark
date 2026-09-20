import { Router } from 'express';
import { sessionsRouter } from './sessions.js';
import { subjectTagsRouter } from './subjectTags.js';
import { meRouter } from './me.js';
import { devRouter } from './dev.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'bowiespark-api' });
});

apiRouter.use('/me', meRouter);
apiRouter.use('/sessions', sessionsRouter);
apiRouter.use('/subject-tags', subjectTagsRouter);
apiRouter.use('/dev', devRouter);
