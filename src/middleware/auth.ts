/**
 * JWT auth middleware — verify access token và attach user vào req [10-backend.md]
 * RBAC: requireRole('admin') hoặc requireRole('staff', 'admin')
 */
import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthorizedError, ForbiddenError, AppError, ErrorCode } from '../lib/errors.js';
import type { UserRole } from '../types/db.js';

// Extend Express Request để thêm user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        storeId: number;
        role: UserRole;
        mustChangePassword: boolean;
      };
    }
  }
}

export interface JwtPayload {
  sub: string;      // user id
  storeId: number;
  role: UserRole;
  mustChangePassword: boolean;
  type: 'access';
}

/**
 * Verify access token từ Authorization header hoặc httpOnly cookie
 * Ưu tiên cookie (httpOnly, bảo mật hơn) [20-frontend.md]
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  let token: string | undefined;

  // 1. Thử httpOnly cookie trước
  const cookieToken = req.cookies['access_token'] as string | undefined;
  if (cookieToken) {
    token = cookieToken;
  }

  // 2. Fallback: Authorization header Bearer
  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    next(new UnauthorizedError(ErrorCode.UNAUTHORIZED, 'Vui lòng đăng nhập'));
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    if (payload.type !== 'access') {
      next(new UnauthorizedError(ErrorCode.TOKEN_INVALID, 'Token không hợp lệ'));
      return;
    }

    req.user = {
      id: payload.sub,
      storeId: payload.storeId,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError(ErrorCode.TOKEN_EXPIRED, 'Phiên đăng nhập hết hạn'));
      return;
    }
    next(new UnauthorizedError(ErrorCode.TOKEN_INVALID, 'Token không hợp lệ'));
  }
}

/**
 * RBAC: chỉ cho phép role trong danh sách
 * Phải dùng sau authenticate middleware
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('Bạn không có quyền thực hiện thao tác này'));
      return;
    }

    next();
  };
}

/**
 * Chặn endpoint nếu user chưa đổi mật khẩu lần đầu [10-backend.md]
 * Chỉ cho phép access /api/auth/change-password
 */
export function requirePasswordChanged(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }

  if (req.user.mustChangePassword) {
    next(
      new AppError(
        ErrorCode.MUST_CHANGE_PASSWORD,
        'Vui lòng đổi mật khẩu trước khi sử dụng hệ thống',
        403,
      ),
    );
    return;
  }

  next();
}

/**
 * Ownership check: Staff chỉ được thao tác với data của mình [10-backend.md]
 * Admin bypass
 */
export function requireOwnershipOrAdmin(
  getUserIdFromReq: (req: Request) => string,
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }

    if (req.user.role === 'admin') {
      next();
      return;
    }

    const targetUserId = getUserIdFromReq(req);
    if (req.user.id !== targetUserId) {
      next(new ForbiddenError('Bạn chỉ có thể xem dữ liệu của mình'));
      return;
    }

    next();
  };
}
