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
import { scheduleRouter } from './routes/schedule.js';
import { attendanceRouter } from './routes/attendance.js';
import { faceRouter } from './routes/face.js';
import { adjustmentRouter } from './routes/adjustment.js';
import { swapRouter, shiftPoolRouter } from './routes/swap.js';
import { chatRouter } from './routes/chat.js';
import { telegramRouter } from './routes/telegram.js';
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
  app.use('/api/schedule', scheduleRouter);
  app.use('/schedule', scheduleRouter);
  app.use('/api/schedules', scheduleRouter);
  app.use('/schedules', scheduleRouter);
  app.use('/api/attendances', attendanceRouter);
  app.use('/attendances', attendanceRouter);
  app.use('/api/face', faceRouter);
  app.use('/api/adjustments', adjustmentRouter);
  app.use('/adjustments', adjustmentRouter);
  app.use('/api/swaps', swapRouter);
  app.use('/swaps', swapRouter);
  app.use('/api/shift-pool', shiftPoolRouter);
  app.use('/shift-pool', shiftPoolRouter);
  app.use('/api/chat', chatRouter);
  app.use('/chat', chatRouter);
  app.use('/api/telegram', telegramRouter);
  app.use('/telegram', telegramRouter);

  app.use(notFoundHandler);

  app.use(errorHandler);

  return app;
}
