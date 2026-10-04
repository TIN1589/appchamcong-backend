import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { io as ClientSocket, type Socket as ClientSocketType } from 'socket.io-client';
import { initSocketServer } from './index.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

describe('Socket.io Server Handshake & Rooms (§3.3 SRS v1.1)', () => {
  let server: http.Server;
  let port: number;

  const validUserId = '11111111-1111-1111-1111-111111111111';
  const storeId = 1;

  const validToken = jwt.sign(
    { sub: validUserId, storeId, role: 'staff', type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );

  beforeAll(async () => {
    server = http.createServer();
    initSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === 'object' && addr) {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('1. Từ chối kết nối khi không có token (UNAUTHORIZED)', async () => {
    const client: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
      transports: ['websocket'],
      autoConnect: false,
    });

    const connectErrorPromise = new Promise<string>((resolve) => {
      client.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    client.connect();
    const errorMsg = await connectErrorPromise;
    client.disconnect();

    expect(errorMsg).toBe('UNAUTHORIZED');
  });

  it('2. Từ chối kết nối khi token sai secret', async () => {
    const badToken = jwt.sign(
      { sub: validUserId, storeId, role: 'staff', type: 'access' },
      'wrong-secret-12345678901234567890123456789012',
      { expiresIn: '1h' },
    );

    const client: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
      auth: { token: badToken },
      transports: ['websocket'],
      autoConnect: false,
    });

    const connectErrorPromise = new Promise<string>((resolve) => {
      client.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    client.connect();
    const errorMsg = await connectErrorPromise;
    client.disconnect();

    expect(errorMsg).toBe('UNAUTHORIZED');
  });

  it('3. Kết nối thành công với JWT hợp lệ và nhận sự kiện presence:update', async () => {
    const client: ClientSocketType = ClientSocket(`http://localhost:${port}`, {
      auth: { token: validToken },
      transports: ['websocket'],
      autoConnect: false,
    });

    const presencePromise = new Promise<{ userId: string; online: boolean }>((resolve) => {
      client.on('presence:update', (data) => {
        resolve(data);
      });
    });

    client.connect();
    const presenceData = await presencePromise;
    client.disconnect();

    expect(presenceData.userId).toBe(validUserId);
    expect(presenceData.online).toBe(true);
  });
});
