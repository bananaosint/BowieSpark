import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import { apiRouter } from './routes/index.js';
import { attachUser, devAuthEnabled } from './middleware/auth.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { disconnect } from './db.js';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(express.json());
app.use(morgan('dev'));
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  })
);

app.use(attachUser);
app.use('/api', apiRouter);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`  API   http://localhost:${PORT}/api/health`);
  if (devAuthEnabled()) {
    console.log('  WARN  dev auth shim is ON — any x-dev-user-id is trusted. Fake data only.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await disconnect();
    process.exit(0);
  });
}
