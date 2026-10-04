import { query } from '../db/client.js';

export interface CreateAuditLogInput {
  userId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export const auditRepository = {
  async log(input: CreateAuditLogInput): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_log (user_id, action, detail, ip_address)
         VALUES ($1, $2, $3, $4::inet)`,
        [
          input.userId ?? null,
          input.action,
          input.detail ? JSON.stringify(input.detail) : null,
          input.ipAddress ? input.ipAddress.replace(/^::ffff:/, '') : null,
        ],
      );
    } catch {
      // Ghi log kiểm toán không được làm gián đoạn transaction nghiệp vụ nếu có lỗi kết nối phụ
    }
  },
};
