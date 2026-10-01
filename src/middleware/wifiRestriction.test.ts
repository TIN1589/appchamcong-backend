import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../config/env.js', () => ({
  env: {
    WIFI_RESTRICTION: true,
    ALLOWED_IPS: '192.168.1.0/24,203.0.113.50',
    NODE_ENV: 'test',
    PORT: 3000,
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: 5432,
    POSTGRES_DB: 'test',
    POSTGRES_USER: 'test',
    POSTGRES_PASSWORD: 'test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test_secret_minimum_32_chars_long_yes',
    JWT_REFRESH_SECRET: 'test_refresh_minimum_32_chars_long_y',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    CORS_ORIGIN: 'https://chamcong.local',
    DEFAULT_STORE_ID: 1,
  },
}));

const { wifiRestrictionMiddleware } = await import('../middleware/wifiRestriction.js');

function makeReq(ip: string, path = '/api/users'): Partial<Request> {
  return {
    ip,
    path,
    socket: { remoteAddress: ip } as any,
  };
}

function makeRes(): Partial<Response> {
  return {};
}

describe('wifiRestrictionMiddleware', () => {
  it('allows IP in CIDR range', () => {
    const next = vi.fn() as NextFunction;
    wifiRestrictionMiddleware(
      makeReq('192.168.1.100') as Request,
      makeRes() as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks IP outside CIDR range', () => {
    const next = vi.fn();
    wifiRestrictionMiddleware(
      makeReq('10.0.0.1') as Request,
      makeRes() as Response,
      next as unknown as NextFunction,
    );
    const [err] = next.mock.calls[0] ?? [];
    expect(err).toBeDefined();
     
    expect((err as any).code).toBe('WIFI_RESTRICTED');
  });

  it('allows exact IP match', () => {
    const next = vi.fn() as NextFunction;
    wifiRestrictionMiddleware(
      makeReq('203.0.113.50') as Request,
      makeRes() as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('always allows /health path', () => {
    const next = vi.fn() as NextFunction;
    wifiRestrictionMiddleware(
      makeReq('8.8.8.8', '/health') as Request,
      makeRes() as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('strips IPv6 prefix ::ffff: before checking', () => {
    const next = vi.fn() as NextFunction;
    wifiRestrictionMiddleware(
      makeReq('::ffff:192.168.1.200') as Request,
      makeRes() as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks IP at network boundary (192.168.2.1 not in 192.168.1.0/24)', () => {
    const next = vi.fn();
    wifiRestrictionMiddleware(
      makeReq('192.168.2.1') as Request,
      makeRes() as Response,
      next as unknown as NextFunction,
    );
    const [err] = next.mock.calls[0] ?? [];
    expect(err).toBeDefined();
  });

  it('allows first IP in subnet (192.168.1.0)', () => {
    const next = vi.fn() as NextFunction;
    wifiRestrictionMiddleware(
      makeReq('192.168.1.0') as Request,
      makeRes() as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('allows broadcast IP (192.168.1.255)', () => {
    const next = vi.fn() as NextFunction;
    wifiRestrictionMiddleware(
      makeReq('192.168.1.255') as Request,
      makeRes() as Response,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
