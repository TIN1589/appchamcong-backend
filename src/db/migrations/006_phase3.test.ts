import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query } from '../client.js';

describe('Migration 006 Schema Validation (Phase 3 Core Tables & Security)', () => {
  const STORE_ID = 1;
  const TEST_USER_ID = '00000000-0000-0000-0000-000000000002'; // Nguyễn Văn An

  beforeAll(async () => {
    await query('SELECT 1');
  });

  afterAll(async () => {
    // Dọn dẹp dữ liệu test trong các bảng mới nếu có
    await query(`DELETE FROM audit_log WHERE action = 'TEST_ACTION'`);
    await query(`DELETE FROM store_networks WHERE description = 'Test Network'`);
  });

  it('1. Bảng audit_log: chèn và đọc bản ghi kiểm toán thành công', async () => {
    const res = await query<{ id: string; action: string; ip_address: string }>(
      `INSERT INTO audit_log (user_id, action, detail, ip_address)
       VALUES ($1, 'TEST_ACTION', '{"test": true}'::jsonb, '127.0.0.1'::inet)
       RETURNING id, action, host(ip_address) AS ip_address`,
      [TEST_USER_ID],
    );

    expect(res.rows.length).toBe(1);
    expect(res.rows[0]?.action).toBe('TEST_ACTION');
    expect(res.rows[0]?.ip_address).toBe('127.0.0.1');
  });

  it('2. Bảng store_networks: hỗ trợ tra cứu CIDR với toán tử <<=', async () => {
    await query(
      `INSERT INTO store_networks (store_id, cidr, description, is_active)
       VALUES ($1, '192.168.1.0/24'::cidr, 'Test Network', true)`,
      [STORE_ID],
    );

    const matchRes = await query<{ id: number }>(
      `SELECT id FROM store_networks
       WHERE store_id = $1 AND is_active AND '192.168.1.50'::inet <<= cidr LIMIT 1`,
      [STORE_ID],
    );
    expect(matchRes.rows.length).toBe(1);

    const noMatchRes = await query<{ id: number }>(
      `SELECT id FROM store_networks
       WHERE store_id = $1 AND is_active AND '10.0.0.1'::inet <<= cidr LIMIT 1`,
      [STORE_ID],
    );
    expect(noMatchRes.rows.length).toBe(0);
  });

  it('3. Bảng conversations, conversation_members, messages: cấu trúc quan hệ toàn vẹn', async () => {
    // Tạo conversation
    const convRes = await query<{ id: string }>(
      `INSERT INTO conversations (store_id, type, name)
       VALUES ($1, 'store_group', 'Nhóm Test')
       RETURNING id`,
      [STORE_ID],
    );
    const convId = convRes.rows[0]!.id;

    // Thêm member
    await query(
      `INSERT INTO conversation_members (conversation_id, user_id)
       VALUES ($1, $2)`,
      [convId, TEST_USER_ID],
    );

    // Gửi message
    const msgRes = await query<{ id: string; content: string }>(
      `INSERT INTO messages (conversation_id, sender_id, content)
       VALUES ($1, $2, 'Xin chào toàn quán!')
       RETURNING id, content`,
      [convId, TEST_USER_ID],
    );
    expect(msgRes.rows[0]?.content).toBe('Xin chào toàn quán!');

    // Cascade delete conversation xoá cả members và messages
    await query(`DELETE FROM conversations WHERE id = $1`, [convId]);
    const checkMsg = await query(`SELECT id FROM messages WHERE conversation_id = $1`, [convId]);
    expect(checkMsg.rows.length).toBe(0);
  });

  it('4. Bảng swap_requests: ràng buộc loại type = swap hoặc pool', async () => {
    const columns = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'swap_requests' AND column_name IN ('type', 'expires_at', 'claimed_at')`,
    );
    expect(columns.rows.map((r) => r.column_name)).toContain('type');
    expect(columns.rows.map((r) => r.column_name)).toContain('expires_at');
    expect(columns.rows.map((r) => r.column_name)).toContain('claimed_at');
  });

  it('5. Bảng attendances: có cột flags và needs_review', async () => {
    const columns = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'attendances' AND column_name IN ('flags', 'needs_review')`,
    );
    expect(columns.rows.map((r) => r.column_name)).toContain('flags');
    expect(columns.rows.map((r) => r.column_name)).toContain('needs_review');
  });

  it('6. Bảng users: có cột face_enrolled_consent_at', async () => {
    const columns = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'face_enrolled_consent_at'`,
    );
    expect(columns.rows.length).toBe(1);
  });
});
