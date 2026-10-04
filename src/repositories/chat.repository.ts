import { query, withTransaction } from '../db/client.js';

export interface ConversationRecord {
  id: string;
  store_id: number;
  type: 'direct' | 'store_group';
  name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ConversationWithDetails extends ConversationRecord {
  unread_count?: number;
  last_message?: {
    id: string;
    sender_id: string;
    sender_name: string;
    content: string;
    created_at: Date;
  } | null;
  members: Array<{
    user_id: string;
    full_name: string;
    avatar_url?: string | null;
    role: string;
  }>;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string;
  content: string;
  created_at: Date;
}

export const chatRepository = {
  /**
   * Tìm hoặc tạo group chat toàn cửa hàng
   */
  async getOrCreateStoreGroup(storeId: number): Promise<ConversationRecord> {
    const existing = await query<ConversationRecord>(
      `SELECT * FROM conversations
       WHERE store_id = $1 AND type = 'store_group'
       LIMIT 1`,
      [storeId],
    );
    if (existing.rows[0]) return existing.rows[0];

    return withTransaction(async (client) => {
      const convRes = await client.query<ConversationRecord>(
        `INSERT INTO conversations (store_id, type, name)
         VALUES ($1, 'store_group', 'Nhóm Cửa Hàng')
         RETURNING *`,
        [storeId],
      );
      const conv = convRes.rows[0]!;

      // Thêm toàn bộ nhân viên active vào nhóm
      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id)
         SELECT $1, id FROM users
         WHERE store_id = $2 AND is_active = true
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conv.id, storeId],
      );

      return conv;
    });
  },

  /**
   * Tìm hoặc tạo hội thoại 1-1 giữa 2 nhân viên
   */
  async getOrCreateDirectConversation(storeId: number, userA: string, userB: string): Promise<ConversationRecord> {
    const existing = await query<ConversationRecord>(
      `SELECT c.* FROM conversations c
       JOIN conversation_members m1 ON c.id = m1.conversation_id AND m1.user_id = $1
       JOIN conversation_members m2 ON c.id = m2.conversation_id AND m2.user_id = $2
       WHERE c.store_id = $3 AND c.type = 'direct'
       LIMIT 1`,
      [userA, userB, storeId],
    );
    if (existing.rows[0]) return existing.rows[0];

    return withTransaction(async (client) => {
      const convRes = await client.query<ConversationRecord>(
        `INSERT INTO conversations (store_id, type)
         VALUES ($1, 'direct')
         RETURNING *`,
        [storeId],
      );
      const conv = convRes.rows[0]!;

      await client.query(
        `INSERT INTO conversation_members (conversation_id, user_id)
         VALUES ($1, $2), ($1, $3)
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [conv.id, userA, userB],
      );

      return conv;
    });
  },

  /**
   * Kiểm tra user có phải là thành viên của cuộc hội thoại không
   */
  async isMember(conversationId: string, userId: string): Promise<boolean> {
    const res = await query(
      `SELECT 1 FROM conversation_members
       WHERE conversation_id = $1 AND user_id = $2
       LIMIT 1`,
      [conversationId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * Lưu tin nhắn mới vào DB
   */
  async saveMessage(conversationId: string, senderId: string, content: string): Promise<MessageRecord> {
    return withTransaction(async (client) => {
      const msgRes = await client.query<MessageRecord>(
        `INSERT INTO messages (conversation_id, sender_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, conversation_id, sender_id, content, created_at`,
        [conversationId, senderId, content],
      );

      // Cập nhật updated_at của conversation để sắp xếp danh sách gần nhất
      await client.query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [conversationId],
      );

      const msg = msgRes.rows[0]!;

      // Lấy thêm sender_name
      const userRes = await client.query<{ full_name: string }>(
        `SELECT full_name FROM users WHERE id = $1`,
        [senderId],
      );
      msg.sender_name = userRes.rows[0]?.full_name ?? 'Nhân viên';

      return msg;
    });
  },

  /**
   * Lấy lịch sử tin nhắn của một cuộc hội thoại có phân trang
   */
  async listMessages(conversationId: string, limit = 50, beforeDate?: Date): Promise<MessageRecord[]> {
    const conditions = ['m.conversation_id = $1'];
    const params: unknown[] = [conversationId, limit];

    if (beforeDate) {
      conditions.push('m.created_at < $3');
      params.push(beforeDate);
    }

    const res = await query<MessageRecord>(
      `SELECT m.id, m.conversation_id, m.sender_id, u.full_name AS sender_name, m.content, m.created_at
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY m.created_at DESC
       LIMIT $2`,
      params,
    );

    // Đảo ngược mảng để client hiển thị từ cũ tới mới
    return res.rows.reverse();
  },

  /**
   * Lấy danh sách hội thoại của một user
   */
  async listUserConversations(storeId: number, userId: string): Promise<ConversationWithDetails[]> {
    const convsRes = await query<ConversationRecord>(
      `SELECT c.* FROM conversations c
       JOIN conversation_members cm ON c.id = cm.conversation_id
       WHERE c.store_id = $1 AND cm.user_id = $2
       ORDER BY c.updated_at DESC`,
      [storeId, userId],
    );

    const results: ConversationWithDetails[] = [];

    for (const c of convsRes.rows) {
      // 1. Lấy tin nhắn cuối
      const lastMsgRes = await query<{
        id: string;
        sender_id: string;
        sender_name: string;
        content: string;
        created_at: Date;
      }>(
        `SELECT m.id, m.sender_id, u.full_name AS sender_name, m.content, m.created_at
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = $1
         ORDER BY m.created_at DESC
         LIMIT 1`,
        [c.id],
      );

      // 2. Lấy danh sách thành viên
      const membersRes = await query<{
        user_id: string;
        full_name: string;
        role: string;
      }>(
        `SELECT cm.user_id, u.full_name, u.role
         FROM conversation_members cm
         JOIN users u ON cm.user_id = u.id
         WHERE cm.conversation_id = $1`,
        [c.id],
      );

      results.push({
        ...c,
        last_message: lastMsgRes.rows[0] ?? null,
        members: membersRes.rows,
      });
    }

    return results;
  },

  /**
   * Cập nhật thời điểm đọc tin cuối
   */
  async markRead(conversationId: string, userId: string): Promise<void> {
    await query(
      `UPDATE conversation_members
       SET last_read_at = NOW()
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
  },
};
