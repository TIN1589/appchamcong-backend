/**
 * Auth service — business logic cho auth flow [10-backend.md]
 */
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { env } from '../config/env.js';
import { authRepository } from '../repositories/auth.repository.js';
import { AppError, ErrorCode, UnauthorizedError } from '../lib/errors.js';
import type { JwtPayload } from '../middleware/auth.js';
import type { SafeUser, UserRole } from '../types/db.js';

const BCRYPT_ROUNDS = 12;  // [10-backend.md]: cost ≥ 12

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

function generateAccessToken(user: {
  id: string;
  storeId: number;
  role: UserRole;
  mustChangePassword: boolean;
}): string {
  const payload: JwtPayload = {
    sub: user.id,
    storeId: user.storeId,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    type: 'access',
  };
  // jwt.sign types: secret là string | Buffer, không phải undefined
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
  } as jwt.SignOptions);
}

function generateRefreshToken(): string {
  // 48 bytes = 64 chars base64url — đủ entropy
  return randomBytes(48).toString('base64url');
}

function parseExpiresIn(expiresIn: string): Date {
  const now = Date.now();
  const match = /^(\d+)([smhd])$/.exec(expiresIn);
  if (!match?.[1] || !match[2]) {
    return new Date(now + 7 * 24 * 60 * 60 * 1000);  // default 7d
  }
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return new Date(now + value * (multipliers[unit] ?? 86_400_000));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSafeUserFromRow(user: any): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, face_descriptor, ...safe } = user as { password_hash: string; face_descriptor: unknown; [key: string]: unknown };
  return safe as SafeUser;
}

export const authService = {
  /**
   * Đăng nhập: verify email + password, tạo token pair
   * Backend là nguồn sự thật — không tin thông tin từ client [10-backend.md]
   */
  async login(
    email: string,
    password: string,
    storeId: number,
  ): Promise<{ user: SafeUser; tokens: TokenPair }> {
    const user = await authRepository.findByEmail(email.toLowerCase().trim(), storeId);

    if (!user) {
      // Timing attack protection: vẫn hash để tốn thời gian
      await bcrypt.hash('dummy', BCRYPT_ROUNDS);
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        'Email hoặc mật khẩu không đúng',
        401,
      );
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        'Email hoặc mật khẩu không đúng',
        401,
      );
    }

    const tokens = await authService.createTokenPair({
      id: user.id,
      storeId: user.store_id,
      role: user.role,
      mustChangePassword: user.must_change_password,
    });

    return { user: toSafeUserFromRow(user), tokens };
  },

  /** Tạo access + refresh token pair và lưu refresh token vào DB */
  async createTokenPair(user: {
    id: string;
    storeId: number;
    role: UserRole;
    mustChangePassword: boolean;
  }): Promise<TokenPair> {
    const accessToken = generateAccessToken(user);
    const rawRefreshToken = generateRefreshToken();
    const expiresAt = parseExpiresIn(env.JWT_REFRESH_EXPIRES_IN);

    await authRepository.saveRefreshToken(user.id, rawRefreshToken, expiresAt);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    };
  },

  /** Refresh: rotate token — revoke cũ, tạo mới [10-backend.md] */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const stored = await authRepository.findRefreshToken(rawRefreshToken);
    if (!stored) {
      throw new UnauthorizedError(
        ErrorCode.TOKEN_INVALID,
        'Refresh token không hợp lệ hoặc đã hết hạn',
      );
    }

    // Revoke token cũ ngay lập tức (rotation)
    await authRepository.revokeToken(rawRefreshToken);

    const user = await authRepository.findById(stored.user_id);
    if (!user) {
      throw new UnauthorizedError(ErrorCode.USER_NOT_FOUND, 'User không tồn tại');
    }

    return authService.createTokenPair({
      id: user.id,
      storeId: user.store_id,
      role: user.role,
      mustChangePassword: user.must_change_password,
    });
  },

  /** Logout: revoke refresh token */
  async logout(rawRefreshToken: string): Promise<void> {
    await authRepository.revokeToken(rawRefreshToken);
  },

  /** Đổi mật khẩu lần đầu hoặc tự nguyện [10-backend.md] */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await authRepository.findById(userId);
    if (!user) {
      throw new AppError(ErrorCode.USER_NOT_FOUND, 'User không tồn tại', 404);
    }

    // Nếu là lần đầu bắt buộc đổi, vẫn check password cũ
    const passwordOk = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordOk) {
      throw new AppError(
        ErrorCode.INVALID_CREDENTIALS,
        'Mật khẩu hiện tại không đúng',
        401,
      );
    }

    if (currentPassword === newPassword) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Mật khẩu mới phải khác mật khẩu cũ',
        400,
      );
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await authRepository.changePassword(userId, newHash);
  },
};
