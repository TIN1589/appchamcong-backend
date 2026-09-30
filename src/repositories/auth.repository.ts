/**
 * Auth repository — DB queries cho auth flow
 * Không có business logic ở đây [10-backend.md]
 */
import { query, withTransaction } from '../db/client.js';
import type { User, RefreshToken } from '../types/db.js';
import { createHash } from 'crypto';

// Hash raw refresh token trước khi lưu DB
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export const authRepository = {
  /** Tìm user theo email trong cùng store */
  async findByEmail(email: string, storeId: number): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE email = $1 AND store_id = $2 AND is_active = true',
      [email, storeId],
    );
    return result.rows[0] ?? null;
  },

  /** Tìm user theo id */
  async findById(userId: string): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [userId],
    );
    return result.rows[0] ?? null;
  },

  /** Lưu refresh token (hash) */
  async saveRefreshToken(
    userId: string,
    rawToken: string,
    expiresAt: Date,
  ): Promise<void> {
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hashToken(rawToken), expiresAt],
    );
  },

  /** Tìm và validate refresh token */
  async findRefreshToken(rawToken: string): Promise<RefreshToken | null> {
    const result = await query<RefreshToken>(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1
         AND revoked = false
         AND expires_at > NOW()`,
      [hashToken(rawToken)],
    );
    return result.rows[0] ?? null;
  },

  /** Revoke 1 token cụ thể (logout) */
  async revokeToken(rawToken: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1',
      [hashToken(rawToken)],
    );
  },

  /** Revoke TẤT CẢ token của user (logout all devices) */
  async revokeAllUserTokens(userId: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
      [userId],
    );
  },

  /** Xóa token cũ đã hết hạn (cleanup, chạy định kỳ) */
  async deleteExpiredTokens(): Promise<number> {
    const result = await query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = true RETURNING id',
    );
    return result.rowCount ?? 0;
  },

  /** Đổi mật khẩu + clear must_change_password + revoke all tokens trong 1 transaction */
  async changePassword(userId: string, newPasswordHash: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $1, must_change_password = false, updated_at = NOW()
         WHERE id = $2`,
        [newPasswordHash, userId],
      );
      // Revoke tất cả token cũ sau đổi mật khẩu
      await client.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
        [userId],
      );
    });
  },
};
