import { createServer } from 'node:http';
import { env, isProd } from './config/env';
import { createApp } from './app';
import { createContainer } from './container';
import { pool } from './db/client';
import { runMigrations } from './db/migrate';
import { startJobs } from './jobs';
import { logger } from './lib/logger';
import { attachSocketServer } from './realtime/socket';

async function main() {
  if (isProd) await runMigrations();
  const container = createContainer();
  const allowedOrigins = [env.APP_ORIGIN, ...(isProd ? [] : ['http://localhost:3900', 'http://127.0.0.1:3900'])];
  const app = createApp(container, allowedOrigins);
  const server = createServer(app);
  attachSocketServer(server, container, allowedOrigins);
  const stopJobs = startJobs(container);

  server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Athena API listening'));

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
