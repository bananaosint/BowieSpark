import { PrismaClient } from '@prisma/client';

// Single client for the process. `node --watch` restarts the whole process,
// so the usual globalThis-caching dance isn't needed here.
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnect() {
  await prisma.$disconnect();
}
