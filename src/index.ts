/**
 * Entry point — khởi động server với graceful shutdown [10-backend.md]
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';

async function main(): Promise<void> {
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, nodeEnv: env.NODE_ENV },
      `🚀 chamcong-backend started on port ${env.PORT}`,
    );
  });

  // ── Graceful shutdown [10-backend.md] ─────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutting down gracefully...');
    server.close(async () => {
      try {
        await db.end();
        logger.info('Database pool closed');
      } catch (err) {
        logger.error({ err }, 'Error closing database pool');
      }
      process.exit(0);
    });

    // Force exit nếu không tắt trong 10s
    setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // Unhandled rejection — log và không crash (production)
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    if (env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });
}

void main();
