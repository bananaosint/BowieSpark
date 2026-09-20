// .env is gitignored (it will hold real secrets later), so a fresh clone has
// no DATABASE_URL and `prisma migrate` aborts before it can create the db.
// Seeding .env from the committed .env.example makes the README quick start
// work on a clean checkout without ever committing a secret.
//
// Runs automatically via the `pre*` hooks in package.json.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(serverDir, '.env');
const examplePath = join(serverDir, '.env.example');

if (existsSync(envPath)) {
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error('server/.env.example is missing — cannot create server/.env.');
  process.exit(1);
}

copyFileSync(examplePath, envPath);
console.log('Created server/.env from .env.example (local defaults, not committed).');
