import { query, withTransaction } from '../db/client.js';
import type { User, RefreshToken } from '../types/db.js';
import { createHash } from 'crypto';

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export const authRepository = {
  async findByEmail(email: string, storeId: number): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE email = $1 AND store_id = $2 AND is_active = true',
      [email, storeId],
    );
    return result.rows[0] ?? null;
  },

  async findById(userId: string): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [userId],
    );
    return result.rows[0] ?? null;
  },

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

  async revokeToken(rawToken: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1',
      [hashToken(rawToken)],
    );
  },

  async revokeAllUserTokens(userId: string): Promise<void> {
    await query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
      [userId],
    );
  },

  async deleteExpiredTokens(): Promise<number> {
    const result = await query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked = true RETURNING id',
    );
    return result.rowCount ?? 0;
  },

  async changePassword(userId: string, newPasswordHash: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET password_hash = $1, must_change_password = false, updated_at = NOW()
         WHERE id = $2`,
        [newPasswordHash, userId],
      );
      await client.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
        [userId],
      );
    });
  },
};
