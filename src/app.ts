/**
 * Express app setup — tách với index.ts để dễ test (supertest)
 */
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

  // ── Security headers [10-backend.md] ───────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],  // camera
          connectSrc: ["'self'", 'wss:'],  // WebSocket
          workerSrc: ["'self'", 'blob:'],  // Service Worker
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
    }),
  );

  // ── CORS — whitelist only [10-backend.md] ──────────────────────────────
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,  // httpOnly cookie [20-frontend.md]
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  // ── Trust proxy (Caddy) ────────────────────────────────────────────────
  app.set('trust proxy', 1);

  // ── Request ID ────────────────────────────────────────────────────────
  app.use((req, res, next) => {
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  // ── Structured logging ─────────────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({
        requestId: req.headers['x-request-id'],
      }),
      // Không log /health để tránh noise
      autoLogging: {
        ignore: (req) => req.url === '/health',
      },
    }),
  );

  // ── Compression ────────────────────────────────────────────────────────
  app.use(compression());

  // ── Body parsers ───────────────────────────────────────────────────────
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));
  app.use(cookieParser());

  // ── WiFi restriction [A3] ──────────────────────────────────────────────
  app.use(wifiRestrictionMiddleware);

  // ── Rate limiting [10-backend.md] ─────────────────────────────────────
  // Global rate limit
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,  // 15 phút
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      message: { code: 'RATE_LIMITED', message: 'Quá nhiều request. Thử lại sau.' },
    }),
  );



  // ── Health check ───────────────────────────────────────────────────────
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

  // ── API routes ─────────────────────────────────────────────────────────
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/shifts', shiftsRouter);

  // ── 404 handler ────────────────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── Error handler (phải ở cuối cùng) ──────────────────────────────────
  app.use(errorHandler);

  return app;
}
