import pino from 'pino';
import { env, isProd } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'athena-api' },
  // Session tokens travel in Cookie on the way in and Set-Cookie on the way out; neither reaches the logs.
  redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash'],
  ...(isProd ? {} : { transport: undefined }),
});
