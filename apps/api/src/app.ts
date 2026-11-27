import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Container } from './container';
import { logger } from './lib/logger';
import { authenticate } from './middleware/authenticate';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { requestContext } from './middleware/request-context';
import { apiRouter } from './routes';

export function createApp(c: Container, allowedOrigins: string[]) {
  const app = express();
  app.disable('x-powered-by');
  // Cloudflare -> OpenLiteSpeed -> Caddy -> API. The gateway resolves the visitor address and forwards only
  // that, so trusting private-network hops yields the real client IP.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    }),
  );
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));
  app.use(cookieParser());
  app.use(originCheck(allowedOrigins));
  app.use(authenticate(c.sessions));

  // Generous global ceiling keyed by session (or IP when anonymous): a classroom behind one NAT stays unaffected.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 1200,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (req) => (req as express.Request).auth?.sessionId ?? ipKeyGenerator(req.ip ?? '0.0.0.0'),
    }),
  );

  // Every API response is per-user: never stored by the CDN or the browser. Routes may override.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/v1', apiRouter(c));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
