import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { apiRouter } from './routes/index.js';
import { attachUser, devModeEnabled } from './auth/index.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { purgeExpired } from './auth/sessions.js';
import { disconnect } from './db.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    // Session cookie must ride along, which means the origin cannot be "*".
    credentials: true,
  })
);

app.use(attachUser);
app.use('/api', apiRouter);
app.use(notFound);
app.use(errorHandler);

// Expired rows are also dropped on sight during lookup; this just stops the
// table growing without bound from sessions nobody ever returns to.
const SWEEP_MS = 1000 * 60 * 60;
const sweep = setInterval(() => {
  purgeExpired().catch((err) => console.error('session sweep failed', err));
}, SWEEP_MS);
sweep.unref();

const server = app.listen(PORT, () => {
  console.log(`  API   http://localhost:${PORT}/api/health`);
  if (devModeEnabled()) {
    console.log('  WARN  DEV_MODE is ON — anyone can impersonate any account. Fake data only.');
  } else {
    console.log('  auth  real sessions only (DEV_MODE off)');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(sweep);
    server.close();
    await disconnect();
    process.exit(0);
  });
}
