import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../auth/index.js';

export const subjectTagsRouter = Router();

// Admin-editable per build sheet §3 — deliberately a table, never an enum.
// Write endpoints (add/rename/reorder) are v1 feature work.
subjectTagsRouter.get('/', requireAuth, async (_req, res, next) => {
  try {
    const tags = await prisma.subjectTag.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true },
    });
    res.json({ subjectTags: tags });
  } catch (err) {
    next(err);
  }
});
