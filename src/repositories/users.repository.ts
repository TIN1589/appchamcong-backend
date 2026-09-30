/**
 * Users repository — CRUD nhân viên [10-backend.md]
 */
import { query } from '../db/client.js';
import type { User, SafeUser, UserRole, PaginatedResult, PaginationParams } from '../types/db.js';

function toSafeUser(user: User): SafeUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash, face_descriptor, ...safe } = user;
  return safe;
}

export const usersRepository = {
  /** Tìm user theo id (thuộc cùng store) */
  async findById(userId: string, storeId: number): Promise<User | null> {
    const result = await query<User>(
      'SELECT * FROM users WHERE id = $1 AND store_id = $2',
      [userId, storeId],
    );
    return result.rows[0] ?? null;
  },

  /** List users trong store, có phân trang [10-backend.md] */
  async findAll(
    storeId: number,
    pagination: PaginationParams,
    filters?: { role?: UserRole; isActive?: boolean },
  ): Promise<PaginatedResult<SafeUser>> {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['store_id = $1'];
    const params: unknown[] = [storeId];
    let paramIdx = 2;

    if (filters?.role !== undefined) {
      conditions.push(`role = $${paramIdx++}`);
      params.push(filters.role);
    }
    if (filters?.isActive !== undefined) {
      conditions.push(`is_active = $${paramIdx++}`);
      params.push(filters.isActive);
    }

    const where = conditions.join(' AND ');

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM users WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const usersResult = await query<User>(
      `SELECT * FROM users WHERE ${where}
       ORDER BY full_name ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return {
      data: usersResult.rows.map(toSafeUser),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /** Tạo user mới (Admin tạo, không self-register) [10-backend.md] */
  async create(data: {
    storeId: number;
    email: string;
    passwordHash: string;
    role: UserRole;
    fullName: string;
    phone?: string;
    hourlyRate?: number;
    leaveBalance?: number;
  }): Promise<SafeUser> {
    const result = await query<User>(
      `INSERT INTO users (
        store_id, email, password_hash, role, full_name, phone,
        hourly_rate, leave_balance, must_change_password
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
      RETURNING *`,
      [
        data.storeId,
        data.email.toLowerCase().trim(),
        data.passwordHash,
        data.role,
        data.fullName,
        data.phone ?? null,
        data.hourlyRate ?? 0,
        data.leaveBalance ?? 12,
      ],
    );
    const user = result.rows[0];
    if (!user) throw new Error('Insert user failed');
    return toSafeUser(user);
  },

  /** Cập nhật thông tin user */
  async update(
    userId: string,
    storeId: number,
    data: Partial<{
      fullName: string;
      phone: string | null;
      hourlyRate: number;
      leaveBalance: number;
      isActive: boolean;
      telegramChatId: string | null;
    }>,
  ): Promise<SafeUser | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.fullName !== undefined) { sets.push(`full_name = $${idx++}`); params.push(data.fullName); }
    if (data.phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(data.phone); }
    if (data.hourlyRate !== undefined) { sets.push(`hourly_rate = $${idx++}`); params.push(data.hourlyRate); }
    if (data.leaveBalance !== undefined) { sets.push(`leave_balance = $${idx++}`); params.push(data.leaveBalance); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
    if (data.telegramChatId !== undefined) { sets.push(`telegram_chat_id = $${idx++}`); params.push(data.telegramChatId); }

    if (sets.length === 0) return null;

    params.push(userId, storeId);
    const result = await query<User>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx++} AND store_id = $${idx}
       RETURNING *`,
      params,
    );
    const user = result.rows[0];
    return user ? toSafeUser(user) : null;
  },

  /** Lưu face descriptor [A7] */
  async saveFaceDescriptor(userId: string, storeId: number, descriptor: number[]): Promise<void> {
    await query(
      'UPDATE users SET face_descriptor = $1, updated_at = NOW() WHERE id = $2 AND store_id = $3',
      [JSON.stringify(descriptor), userId, storeId],
    );
  },

  /** Lấy face descriptor để so sánh [A7] */
  async getFaceDescriptor(userId: string, storeId: number): Promise<number[] | null> {
    const result = await query<{ face_descriptor: number[] | null }>(
      'SELECT face_descriptor FROM users WHERE id = $1 AND store_id = $2 AND is_active = true',
      [userId, storeId],
    );
    return result.rows[0]?.face_descriptor ?? null;
  },

  /** Giảm leave_balance trong transaction (Phase 2) */
  async decreaseLeaveBalance(
    userId: string,
    storeId: number,
    days: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PoolClient generic
    client: any,
  ): Promise<void> {
    await client.query(
      `UPDATE users
       SET leave_balance = leave_balance - $1
       WHERE id = $2 AND store_id = $3 AND leave_balance >= $1`,
      [days, userId, storeId],
    );
  },

  /** Check email đã tồn tại trong store */
  async emailExists(email: string, storeId: number): Promise<boolean> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE email = $1 AND store_id = $2',
      [email.toLowerCase().trim(), storeId],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  },
};
