/**
 * Script chạy kiểm thử thực tế và thu thập bằng chứng cho Phase 3
 * Thực thi trực tiếp trên Express App và PostgreSQL thật
 */
import request from 'supertest';
import { createApp } from '../src/app.js';
import { query } from '../src/db/client.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import fs from 'fs';
import path from 'path';

interface EvidenceRecord {
  testCaseId: string;
  name: string;
  endpoint: string;
  method: string;
  status: number;
  expectedStatus: number;
  result: 'PASS' | 'FAIL';
  requestBody?: unknown;
  responseBody: unknown;
  dbVerification?: unknown;
}

async function runEvidence(): Promise<void> {
  const app = createApp();
  const evidenceList: EvidenceRecord[] = [];

  const STORE_ID = 1;
  const USER_A = '00000000-0000-0000-0000-000000000002'; // Nguyễn Văn An (staff)
  const USER_B = '00000000-0000-0000-0000-000000000003'; // Trần Thị Bình (staff)
  const ADMIN_ID = '00000000-0000-0000-0000-000000000001'; // Admin

  const tokenA = jwt.sign(
    { sub: USER_A, storeId: STORE_ID, role: 'staff', type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );

  const tokenB = jwt.sign(
    { sub: USER_B, storeId: STORE_ID, role: 'staff', type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );

  const tokenAdmin = jwt.sign(
    { sub: ADMIN_ID, storeId: STORE_ID, role: 'admin', type: 'access' },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );

  console.log('=== BẮT ĐẦU CHẠY KIỂM THỬ THỰC TẾ PHASE 3 ===\n');

  // Dọn dẹp dữ liệu cũ của test
  await query(`DELETE FROM messages WHERE content LIKE 'EVIDENCE_%'`);
  await query(`DELETE FROM swap_requests WHERE reason LIKE 'EVIDENCE_%'`);
  await query(`DELETE FROM shift_segments WHERE shift_id IN (SELECT id FROM shifts WHERE notes LIKE 'EVIDENCE_%')`);
  await query(`DELETE FROM shifts WHERE notes LIKE 'EVIDENCE_%'`);

  // 1. Tạo 2 ca test:
  // Ca 1: Cách hiện tại 40 tiếng (< 48h)
  const dateShort = new Date(Date.now() + 40 * 3600 * 1000);
  const dateShortStr = dateShort.toISOString().slice(0, 10);
  const sShortRes = await query<{ id: string }>(
    `INSERT INTO shifts (store_id, assigned_to, work_date, status, shift_type, source, notes, created_by)
     VALUES ($1, $2, $3, 'scheduled', 'REGULAR', 'manual', 'EVIDENCE_SHORT_40H', $4)
     RETURNING id`,
    [STORE_ID, USER_A, dateShortStr, ADMIN_ID],
  );
  const shiftShortId = sShortRes.rows[0]!.id;
  await query(
    `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
     VALUES ($1, $2, $3, 0)`,
    [shiftShortId, dateShort.toISOString(), new Date(dateShort.getTime() + 4 * 3600 * 1000).toISOString()],
  );

  // Ca 2: Cách hiện tại 70 tiếng (>= 48h) nhưng chọn ngày độc lập trong tương lai (2029-06-15) để không đụng lịch seed
  const dateValidAStr = '2029-06-15';
  const dateValidA = new Date('2029-06-15T01:00:00.000Z');
  const sValidARes = await query<{ id: string }>(
    `INSERT INTO shifts (store_id, assigned_to, work_date, status, shift_type, source, notes, created_by)
     VALUES ($1, $2, $3, 'scheduled', 'REGULAR', 'manual', 'EVIDENCE_VALID_70H_A', $4)
     RETURNING id`,
    [STORE_ID, USER_A, dateValidAStr, ADMIN_ID],
  );
  const shiftValidAId = sValidARes.rows[0]!.id;
  await query(
    `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
     VALUES ($1, $2, $3, 0)`,
    [shiftValidAId, dateValidA.toISOString(), new Date(dateValidA.getTime() + 4 * 3600 * 1000).toISOString()],
  );

  // Ca 3: Của User B, cùng tuần với Ca 2 (2029-06-16)
  const dateValidBStr = '2029-06-16';
  const dateValidB = new Date('2029-06-16T01:00:00.000Z');
  const sValidBRes = await query<{ id: string }>(
    `INSERT INTO shifts (store_id, assigned_to, work_date, status, shift_type, source, notes, created_by)
     VALUES ($1, $2, $3, 'scheduled', 'REGULAR', 'manual', 'EVIDENCE_VALID_70H_B', $4)
     RETURNING id`,
    [STORE_ID, USER_B, dateValidBStr, ADMIN_ID],
  );
  const shiftValidBId = sValidBRes.rows[0]!.id;
  await query(
    `INSERT INTO shift_segments (shift_id, starts_at, ends_at, sort_order)
     VALUES ($1, $2, $3, 0)`,
    [shiftValidBId, dateValidB.toISOString(), new Date(dateValidB.getTime() + 4 * 3600 * 1000).toISOString()],
  );

  // --- TC-SWAP-01: Biên 48h (Ca < 48h bị từ chối) ---
  console.log('Chạy TC-SWAP-01: Ca cách < 48h bị từ chối...');
  const res01 = await request(app)
    .post('/api/swaps')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      requester_shift_id: shiftShortId,
      receiver_id: USER_B,
      receiver_shift_id: shiftValidBId,
      reason: 'EVIDENCE_SWAP_UNDER_48H',
    });

  evidenceList.push({
    testCaseId: 'TC-SWAP-01',
    name: 'Đổi ca: vi phạm quy tắc < 48h bị chặn với SWAP_LT_48H',
    endpoint: 'POST /api/swaps',
    method: 'POST',
    status: res01.status,
    expectedStatus: 400,
    result: res01.status === 400 && res01.body.code === 'SWAP_LT_48H' ? 'PASS' : 'FAIL',
    responseBody: res01.body,
  });

  // --- TC-SWAP-06: Chặn đổi ca với chính mình ---
  console.log('Chạy TC-SWAP-06: Chặn đổi ca với chính mình...');
  const res06 = await request(app)
    .post('/api/swaps')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      requester_shift_id: shiftValidAId,
      receiver_id: USER_A,
      receiver_shift_id: shiftValidBId,
      reason: 'EVIDENCE_SWAP_SELF',
    });

  evidenceList.push({
    testCaseId: 'TC-SWAP-06',
    name: 'Đổi ca: Chặn đổi ca với chính mình (SWAP_CANNOT_SWAP_SELF)',
    endpoint: 'POST /api/swaps',
    method: 'POST',
    status: res06.status,
    expectedStatus: 400,
    result: res06.status === 400 && res06.body.code === 'SWAP_CANNOT_SWAP_SELF' ? 'PASS' : 'FAIL',
    responseBody: res06.body,
  });

  // --- TC-POOL-01: Đẩy ca lên Shift Pool ---
  console.log('Chạy TC-POOL-01: Đẩy ca >= 48h lên Chợ ca...');
  const resPool01 = await request(app)
    .post('/api/shift-pool/publish')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      shift_id: shiftValidAId,
      reason: 'EVIDENCE_POOL_PUBLISH',
    });

  const poolRequestId = resPool01.body.data?.id;

  evidenceList.push({
    testCaseId: 'TC-POOL-01',
    name: 'Chợ ca: Nhân viên đưa ca >= 48h lên Shift Pool',
    endpoint: 'POST /api/shift-pool/publish',
    method: 'POST',
    status: resPool01.status,
    expectedStatus: 201,
    result: resPool01.status === 201 && resPool01.body.data?.type === 'pool' ? 'PASS' : 'FAIL',
    responseBody: resPool01.body,
  });

  // --- TC-POOL-04: Chủ ca không được tự nhận ca chợ của mình ---
  console.log('Chạy TC-POOL-04: Chủ ca không được tự nhận lại ca của mình trên chợ...');
  const resPool04 = await request(app)
    .post(`/api/shift-pool/${poolRequestId}/claim`)
    .set('Authorization', `Bearer ${tokenA}`);

  evidenceList.push({
    testCaseId: 'TC-POOL-04',
    name: 'Chợ ca: Chặn chủ ca tự nhận lại ca đã đưa lên chợ',
    endpoint: `POST /api/shift-pool/:id/claim`,
    method: 'POST',
    status: resPool04.status,
    expectedStatus: 400,
    result: resPool04.status === 400 && resPool04.body.code === 'SWAP_CANNOT_SWAP_SELF' ? 'PASS' : 'FAIL',
    responseBody: resPool04.body,
  });

  // --- TC-POOL-02: User B nhận ca từ Shift Pool ---
  console.log('Chạy TC-POOL-02: User B nhận ca từ Shift Pool thành công...');
  const resPool02 = await request(app)
    .post(`/api/shift-pool/${poolRequestId}/claim`)
    .set('Authorization', `Bearer ${tokenB}`);

  // Kiểm tra DB xem ca đã đổi chủ sang User B chưa
  const dbShiftCheck = await query<{ assigned_to: string }>(
    `SELECT assigned_to FROM shifts WHERE id = $1`,
    [shiftValidAId],
  );

  evidenceList.push({
    testCaseId: 'TC-POOL-02',
    name: 'Chợ ca: User B nhận ca từ Shift Pool thành công, DB gán sang User B',
    endpoint: `POST /api/shift-pool/:id/claim`,
    method: 'POST',
    status: resPool02.status,
    expectedStatus: 200,
    result:
      resPool02.status === 200 &&
      resPool02.body.data?.status === 'approved' &&
      dbShiftCheck.rows[0]?.assigned_to === USER_B
        ? 'PASS'
        : 'FAIL',
    responseBody: resPool02.body,
    dbVerification: { assigned_to: dbShiftCheck.rows[0]?.assigned_to },
  });

  // --- TC-SWAP-08: Phân quyền duyệt đơn (Staff gọi bị 403) ---
  console.log('Chạy TC-SWAP-08: Staff gọi endpoint review bị 403...');
  const res08 = await request(app)
    .patch(`/api/swaps/${poolRequestId}/review`)
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ action: 'approve' });

  evidenceList.push({
    testCaseId: 'TC-SWAP-08',
    name: 'RBAC: Nhân viên (staff) gọi endpoint duyệt đổi ca nhận 403 Forbidden',
    endpoint: 'PATCH /api/swaps/:id/review',
    method: 'PATCH',
    status: res08.status,
    expectedStatus: 403,
    result: res08.status === 403 ? 'PASS' : 'FAIL',
    responseBody: res08.body,
  });

  // --- TC-CHAT-01: Lấy danh sách hội thoại ---
  console.log('Chạy TC-CHAT-01: Lấy danh sách hội thoại của user...');
  const resChat01 = await request(app)
    .get('/api/chat/conversations')
    .set('Authorization', `Bearer ${tokenA}`);

  evidenceList.push({
    testCaseId: 'TC-CHAT-01',
    name: 'Chat: Tự động khởi tạo nhóm quán và lấy danh sách hội thoại',
    endpoint: 'GET /api/chat/conversations',
    method: 'GET',
    status: resChat01.status,
    expectedStatus: 200,
    result: resChat01.status === 200 && Array.isArray(resChat01.body.data) ? 'PASS' : 'FAIL',
    responseBody: resChat01.body,
  });

  // --- TC-CHAT-03: Gửi tin nhắn qua REST API ---
  console.log('Chạy TC-CHAT-03: Gửi tin nhắn vào cuộc trò chuyện...');
  const groupConvId = resChat01.body.data?.[0]?.id;
  let resChat03: any = { status: 500, body: {} };

  if (groupConvId) {
    resChat03 = await request(app)
      .post(`/api/chat/conversations/${groupConvId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'EVIDENCE_TEST_MESSAGE: Chúc mọi người ca làm việc vui vẻ!' });

    const dbMsgCheck = await query<{ content: string; sender_id: string }>(
      `SELECT content, sender_id FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [groupConvId],
    );

    evidenceList.push({
      testCaseId: 'TC-CHAT-03',
      name: 'Chat: Gửi tin nhắn thành công, tin nhắn lưu vào PostgreSQL và gán người gửi',
      endpoint: 'POST /api/chat/conversations/:id/messages',
      method: 'POST',
      status: resChat03.status,
      expectedStatus: 201,
      result:
        resChat03.status === 201 &&
        dbMsgCheck.rows[0]?.content.includes('EVIDENCE_TEST_MESSAGE')
          ? 'PASS'
          : 'FAIL',
      responseBody: resChat03.body,
      dbVerification: dbMsgCheck.rows[0],
    });
  }

  // --- DỌN DẸP CUỐI CÙNG ---
  await query(`DELETE FROM messages WHERE content LIKE 'EVIDENCE_%'`);
  await query(`DELETE FROM swap_requests WHERE reason LIKE 'EVIDENCE_%'`);
  await query(`DELETE FROM shift_segments WHERE shift_id IN (SELECT id FROM shifts WHERE notes LIKE 'EVIDENCE_%')`);
  await query(`DELETE FROM shifts WHERE notes LIKE 'EVIDENCE_%'`);

  // Ghi file evidence
  const evidenceDir = path.join(process.cwd(), '../docs/testing/phase-3/evidence');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const logFilePath = path.join(evidenceDir, 'phase3_live_api_evidence.json');
  fs.writeFileSync(logFilePath, JSON.stringify(evidenceList, null, 2), 'utf-8');

  console.log('\n=== KẾT QUẢ KIỂM THỬ THỰC TẾ TRÊN API VÀ POSTGRESQL ===');
  console.table(
    evidenceList.map((e) => ({
      ID: e.testCaseId,
      Tên: e.name.slice(0, 50),
      Method: e.method,
      Status: e.status,
      KỳVọng: e.expectedStatus,
      KếtQuả: e.result,
    })),
  );

  console.log(`\nĐã xuất kết quả minh chứng vào: ${logFilePath}`);
}

void runEvidence();
