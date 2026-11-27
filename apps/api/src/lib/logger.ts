import pino from 'pino';
import { env, isProd } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'athena-api' },
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash'],
  ...(isProd ? {} : { transport: undefined }),
});
