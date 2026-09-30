/**
 * Structured logger dùng pino [10-backend.md]
 * Log có request id, không log password/token/face descriptor
 */
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Redact sensitive fields — KHÔNG log password/token/face descriptor [10-backend.md]
  redact: {
    paths: [
      'password',
      'password_hash',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'access_token',
      'refresh_token',
      'face_descriptor',
      'faceDescriptor',
      'descriptor',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  // Pretty print chỉ ở dev — dùng spread để tránh exactOptionalPropertyTypes lỗi
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;
