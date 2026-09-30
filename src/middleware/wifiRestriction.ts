/**
 * WiFi restriction middleware [A3]
 * Chặn request nếu IP không nằm trong ALLOWED_IPS (khi WIFI_RESTRICTION=true)
 * Default: tắt. Bật bằng WIFI_RESTRICTION=true trong .env
 */
import { type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError, ErrorCode } from '../lib/errors.js';

/**
 * Parse CIDR notation đơn giản (IPv4)
 * VD: 192.168.1.0/24 → check xem IP có trong subnet không
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split('/');
  if (!network || !prefixStr) return ip === cidr;

  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNum(ip);
  const networkNum = ipToNum(network);
  if (ipNum === null || networkNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (networkNum & mask);
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

/**
 * Parse danh sách IPs/CIDRs từ env string
 * "192.168.1.0/24,203.0.113.50" → ['192.168.1.0/24', '203.0.113.50']
 */
function parseAllowedIps(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const allowedIps = parseAllowedIps(env.ALLOWED_IPS);

export function wifiRestrictionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Nếu tắt feature → cho qua
  if (!env.WIFI_RESTRICTION) {
    next();
    return;
  }

  // Bỏ qua /health — cần thiết cho docker healthcheck
  if (req.path === '/health') {
    next();
    return;
  }

  const clientIp = req.ip ?? req.socket.remoteAddress ?? '';
  // Bỏ IPv6 prefix '::ffff:'
  const normalizedIp = clientIp.replace(/^::ffff:/, '');

  const allowed = allowedIps.some(
    (cidr) => cidr === normalizedIp || ipInCidr(normalizedIp, cidr),
  );

  if (!allowed) {
    next(
      new AppError(
        ErrorCode.WIFI_RESTRICTED,
        'Vui lòng kết nối WiFi quán để sử dụng hệ thống',
        403,
      ),
    );
    return;
  }

  next();
}
