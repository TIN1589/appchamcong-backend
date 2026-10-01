import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'crypto';

import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { checkDbConnection } from './db/client.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { shiftsRouter } from './routes/shifts.js';
import { wifiRestrictionMiddleware } from './middleware/wifiRestriction.js';

export function createApp(): express.Application {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'", 'wss:'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({
        requestId: req.headers['x-request-id'],
      }),
      autoLogging: {
        ignore: (req) => req.url === '/health',
      },
    }),
  );

  app.use(compression());

  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use(cookieParser());

  app.use(wifiRestrictionMiddleware);

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      message: { code: 'RATE_LIMITED', message: 'Quá nhiều request. Thử lại sau.' },
    }),
  );

  app.get('/health', async (_req, res) => {
    const dbOk = await checkDbConnection();
    const status = dbOk ? 'ok' : 'degraded';
    res.status(dbOk ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '1.0.0',
      db: dbOk ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/shifts', shiftsRouter);

  app.use(notFoundHandler);

  app.use(errorHandler);

  return app;
}
