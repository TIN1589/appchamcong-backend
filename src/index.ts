import http from 'http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { db } from './db/client.js';
import { rosterGenerationService } from './services/rosterGeneration.service.js';
import { startRosterCron, stopRosterCron } from './services/rosterCron.service.js';
import { reminderCronService } from './services/reminderCron.service.js';
import { initSocketServer } from './socket/index.js';

async function main(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  // Khởi tạo Real-time Socket.io server
  initSocketServer(server);

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, nodeEnv: env.NODE_ENV },
      `🚀 chamcong-backend started on port ${env.PORT}`,
    );

    // Bắt đầu cron và chạy catch-up tạo lịch tuần kế tiếp khi khởi động
    void rosterGenerationService.checkAndCatchUpNextWeek(1).catch((err: unknown) => {
      logger.error({ err }, 'Lỗi khi chạy catch-up tạo lịch tuần kế tiếp');
    });
    startRosterCron();
    reminderCronService.startCron();
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutting down gracefully...');
    stopRosterCron();
    reminderCronService.stopCron();
    server.close(async () => {
      try {
        await db.end();
        logger.info('Database pool closed');
      } catch (err) {
        logger.error({ err }, 'Error closing database pool');
      }
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Graceful shutdown timeout, forcing exit');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    if (env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });
}

void main();
