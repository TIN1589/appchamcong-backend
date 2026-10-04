import { type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export const ErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  MUST_CHANGE_PASSWORD: 'MUST_CHANGE_PASSWORD',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_INACTIVE: 'USER_INACTIVE',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  SHIFT_NOT_FOUND: 'SHIFT_NOT_FOUND',
  SHIFT_ALREADY_ASSIGNED: 'SHIFT_ALREADY_ASSIGNED',
  SHIFT_NOT_OPEN: 'SHIFT_NOT_OPEN',
  SWAP_LT_48H: 'SWAP_LT_48H',
  SWAP_RECEIVER_OVERLAP: 'SWAP_RECEIVER_OVERLAP',
  SWAP_NOT_CURRENT_WEEK: 'SWAP_NOT_CURRENT_WEEK',
  SWAP_NOT_SAME_WEEK: 'SWAP_NOT_SAME_WEEK',
  SWAP_RECEIVER_MAX_SHIFTS: 'SWAP_RECEIVER_MAX_SHIFTS',
  SWAP_CANNOT_SWAP_SELF: 'SWAP_CANNOT_SWAP_SELF',
  SWAP_NOT_OWNER: 'SWAP_NOT_OWNER',
  SWAP_ALREADY_PENDING: 'SWAP_ALREADY_PENDING',
  SWAP_NOT_FOUND: 'SWAP_NOT_FOUND',
  SWAP_INVALID_STATUS: 'SWAP_INVALID_STATUS',
  POOL_SHIFT_NOT_AVAILABLE: 'POOL_SHIFT_NOT_AVAILABLE',
  LEAVE_NOT_FOUND: 'LEAVE_NOT_FOUND',
  LEAVE_INSUFFICIENT_BALANCE: 'LEAVE_INSUFFICIENT_BALANCE',
  ATTENDANCE_ALREADY_CHECKED_IN: 'ATTENDANCE_ALREADY_CHECKED_IN',
  ATTENDANCE_ALREADY_CHECKED_OUT: 'ATTENDANCE_ALREADY_CHECKED_OUT',
  ATTENDANCE_NOT_CHECKED_IN: 'ATTENDANCE_NOT_CHECKED_IN',
  ATTENDANCE_TOO_EARLY: 'ATTENDANCE_TOO_EARLY',
  ATTENDANCE_WINDOW_CLOSED: 'ATTENDANCE_WINDOW_CLOSED',
  ATTENDANCE_GPS_TOO_FAR: 'ATTENDANCE_GPS_TOO_FAR',
  ATTENDANCE_GPS_INACCURATE: 'ATTENDANCE_GPS_INACCURATE',
  ATTENDANCE_FACE_MISMATCH: 'ATTENDANCE_FACE_MISMATCH',
  ATTENDANCE_NO_DESCRIPTOR: 'ATTENDANCE_NO_DESCRIPTOR',
  FACE_ALREADY_ENROLLED: 'FACE_ALREADY_ENROLLED',
  ADJUSTMENT_NOT_FOUND: 'ADJUSTMENT_NOT_FOUND',
  ADJUSTMENT_CANNOT_REVIEW_SELF: 'ADJUSTMENT_CANNOT_REVIEW_SELF',
  ADJUSTMENT_WINDOW_EXPIRED: 'ADJUSTMENT_WINDOW_EXPIRED',
  ADJUSTMENT_DUPLICATE_PENDING: 'ADJUSTMENT_DUPLICATE_PENDING',
  PAYROLL_ALREADY_FINALIZED: 'PAYROLL_ALREADY_FINALIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  WIFI_RESTRICTED: 'WIFI_RESTRICTED',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCodeType,
    public override readonly message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(code: ErrorCodeType, message: string, details?: unknown) {
    super(code, message, 400, details);
    this.name = 'BadRequestError';
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: ErrorCodeType = ErrorCode.UNAUTHORIZED, message = 'Unauthorized') {
    super(code, message, 401);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(ErrorCode.FORBIDDEN, message, 403);
    this.name = 'ForbiddenError';
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(ErrorCode.NOT_FOUND, `${resource} không tìm thấy`, 404);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends AppError {
  constructor(code: ErrorCodeType, message: string) {
    super(code, message, 409);
    this.name = 'ConflictError';
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
   
  _next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? 'unknown';

  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    }));
    logger.warn({ requestId, code: ErrorCode.VALIDATION_ERROR, details }, 'Validation error');
    res.status(400).json({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Dữ liệu không hợp lệ',
      details,
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ requestId, code: err.code, err }, 'Application error');
    } else {
      logger.warn({ requestId, code: err.code, message: err.message }, 'Business error');
    }
    res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
    return;
  }

  logger.error({ requestId, err }, 'Unhandled error');
  res.status(500).json({
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Lỗi hệ thống. Vui lòng thử lại sau.',
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    code: ErrorCode.NOT_FOUND,
    message: `Route ${req.method} ${req.path} không tồn tại`,
  });
}
