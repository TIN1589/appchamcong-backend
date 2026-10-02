import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query } from '../db/client.js';
import { shiftsRepository } from '../repositories/shifts.repository.js';
import { shiftsService } from './shifts.service.js';
import { ConflictError } from '../lib/errors.js';

describe('Validation chống trùng giờ ca làm việc (Rule A1 - A4)', () => {
  const TEST_DATE = '2028-05-10'; // Ngày test độc lập tránh đụng dữ liệu thực
  const STORE_ID = 1;
  let testUserId: string;
  let adminId: string;
  let sangTemplateId: string;
  let chieuTemplateId: string;
  let toiTemplateId: string;
  let gayTemplateId: string;

  beforeAll(async () => {
    // 1. Lấy hoặc tạo user test
    const userRes = await query<{ id: string }>(
      "SELECT id FROM users WHERE store_id = $1 AND role = 'staff' LIMIT 1",
      [STORE_ID],
    );
    testUserId = userRes.rows[0]?.id ?? '00000000-0000-0000-0000-000000000002';

    const adminRes = await query<{ id: string }>(
      "SELECT id FROM users WHERE store_id = $1 AND role = 'admin' LIMIT 1",
      [STORE_ID],
    );
    adminId = adminRes.rows[0]?.id ?? '00000000-0000-0000-0000-000000000001';

    // 2. Lấy các template chuẩn từ DB
    const tplRes = await query<{ id: string; name: string }>(
      'SELECT id, name FROM shift_templates WHERE store_id = $1',
      [STORE_ID],
    );
    for (const t of tplRes.rows) {
      const lower = t.name.toLowerCase();
      if (lower.includes('gãy') || lower.includes('gay')) {
        gayTemplateId = t.id;
      } else if (lower.includes('sáng') || lower.includes('sang')) {
        sangTemplateId = t.id;
      } else if (lower.includes('chiều') || lower.includes('chieu')) {
        chieuTemplateId = t.id;
      } else if (lower.includes('tối') || lower.includes('toi')) {
        toiTemplateId = t.id;
      }
    }

    // Dọn sạch dữ liệu ngày test trước khi chạy
    await query('DELETE FROM shifts WHERE work_date = $1', [TEST_DATE]);
  });

  afterAll(async () => {
    // Dọn sạch sau test
    await query('DELETE FROM shifts WHERE work_date = $1', [TEST_DATE]);
  });

  it('A4.1: Sáng (07:00–12:00) + Gãy (10:00–14:00, 17:00–22:00) -> TRÙNG GIỜ (10:00–12:00)', async () => {
    // Tạo ca sáng cho nhân viên
    const sangShift = await shiftsService.createFromTemplate(STORE_ID, adminId, {
      templateId: sangTemplateId,
      workDate: TEST_DATE,
      assignedTo: testUserId,
    });

    expect(sangShift).toBeDefined();

    // Thử tạo/gán tiếp ca gãy cho cùng nhân viên trong cùng ngày
    const gaySegments = [
      {
        startsAt: new Date(Date.UTC(2028, 4, 10, 3, 0)), // 10:00 VN
        endsAt: new Date(Date.UTC(2028, 4, 10, 7, 0)),   // 14:00 VN
      },
      {
        startsAt: new Date(Date.UTC(2028, 4, 10, 10, 0)), // 17:00 VN
        endsAt: new Date(Date.UTC(2028, 4, 10, 15, 0)),   // 22:00 VN
      },
    ];

    const overlapResult = await shiftsRepository.hasOverlap(
      testUserId,
      TEST_DATE,
      gaySegments,
      STORE_ID,
    );

    expect(overlapResult.hasOverlap).toBe(true);
    expect(overlapResult.message).toContain('đã có Ca sáng');
    expect(overlapResult.message).toContain('07:00–12:00');
    expect(overlapResult.message).toContain('cùng ngày');

    // Gọi qua service cũng phải reject với ConflictError và đúng câu thông báo lỗi
    await expect(
      shiftsService.createFromTemplate(STORE_ID, adminId, {
        templateId: gayTemplateId,
        workDate: TEST_DATE,
        assignedTo: testUserId,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('A4.2: Chiều (12:00–17:00) + Tối (17:00–22:00) -> KHÔNG TRÙNG GIỜ (liền kề lúc 17:00)', async () => {
    // Xóa ca cũ
    await query('DELETE FROM shifts WHERE work_date = $1', [TEST_DATE]);

    // Tạo ca chiều cho nhân viên (12:00 - 17:00)
    await shiftsService.createFromTemplate(STORE_ID, adminId, {
      templateId: chieuTemplateId,
      workDate: TEST_DATE,
      assignedTo: testUserId,
    });

    // Thử gán ca tối (17:00 - 22:00 VN)
    const toiSegments = [
      {
        startsAt: new Date(Date.UTC(2028, 4, 10, 10, 0)), // 17:00 VN
        endsAt: new Date(Date.UTC(2028, 4, 10, 15, 0)),   // 22:00 VN
      },
    ];

    const overlapResult = await shiftsRepository.hasOverlap(
      testUserId,
      TEST_DATE,
      toiSegments,
      STORE_ID,
    );

    // Ca liền kề: 12:00–17:00 và 17:00–22:00 KHÔNG tính là trùng
    expect(overlapResult.hasOverlap).toBe(false);

    // Cho phép tạo thành công không bị từ chối
    const toiShift = await shiftsService.createFromTemplate(STORE_ID, adminId, {
      templateId: toiTemplateId,
      workDate: TEST_DATE,
      assignedTo: testUserId,
    });
    expect(toiShift.id).toBeDefined();
  });

  it('A4.3: Gãy (10:00–14:00, 17:00–22:00) + Tối (17:00–22:00) -> TRÙNG GIỜ (đoạn 17:00–22:00)', async () => {
    // Xóa ca cũ
    await query('DELETE FROM shifts WHERE work_date = $1', [TEST_DATE]);

    // Tạo ca gãy cho nhân viên
    await shiftsService.create(STORE_ID, adminId, {
      workDate: TEST_DATE,
      assignedTo: testUserId,
      segments: [
        { startTime: '10:00', endTime: '14:00' },
        { startTime: '17:00', endTime: '22:00' },
      ],
    });

    // Thử gán ca tối (17:00 - 22:00)
    const toiSegments = [
      {
        startsAt: new Date(Date.UTC(2028, 4, 10, 10, 0)), // 17:00 VN
        endsAt: new Date(Date.UTC(2028, 4, 10, 15, 0)),   // 22:00 VN
      },
    ];

    const overlapResult = await shiftsRepository.hasOverlap(
      testUserId,
      TEST_DATE,
      toiSegments,
      STORE_ID,
    );

    expect(overlapResult.hasOverlap).toBe(true);
    expect(overlapResult.message).toContain('17:00–22:00');
    expect(overlapResult.message).toContain('cùng ngày');

    // Thử tạo qua service với toiTemplateId phải bị reject
    await expect(
      shiftsService.createFromTemplate(STORE_ID, adminId, {
        templateId: toiTemplateId,
        workDate: TEST_DATE,
        assignedTo: testUserId,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('A4.4: Chiều (12:00–17:00) + Gãy (10:00–14:00, 17:00–22:00) -> TRÙNG GIỜ (đoạn 12:00–14:00)', async () => {
    // Xóa ca cũ
    await query('DELETE FROM shifts WHERE work_date = $1', [TEST_DATE]);

    // Tạo ca chiều cho nhân viên
    await shiftsService.createFromTemplate(STORE_ID, adminId, {
      templateId: chieuTemplateId,
      workDate: TEST_DATE,
      assignedTo: testUserId,
    });

    // Thử tạo ca gãy cùng ngày -> phải bị reject do chồng đoạn 12:00-14:00
    await expect(
      shiftsService.createFromTemplate(STORE_ID, adminId, {
        templateId: gayTemplateId,
        workDate: TEST_DATE,
        assignedTo: testUserId,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('A4.5: Ca gãy ở hai ngày khác nhau -> CHO PHÉP (không bị trùng)', async () => {
    const OTHER_DATE = '2028-05-11';
    await query('DELETE FROM shifts WHERE work_date IN ($1, $2)', [TEST_DATE, OTHER_DATE]);

    // Tạo ca gãy ngày 1
    const shiftDay1 = await shiftsService.createFromTemplate(STORE_ID, adminId, {
      templateId: gayTemplateId,
      workDate: TEST_DATE,
      assignedTo: testUserId,
    });
    expect(shiftDay1.id).toBeDefined();

    // Tạo ca gãy ngày 2 cho cùng nhân viên -> thành công
    const shiftDay2 = await shiftsService.createFromTemplate(STORE_ID, adminId, {
      templateId: gayTemplateId,
      workDate: OTHER_DATE,
      assignedTo: testUserId,
    });
    expect(shiftDay2.id).toBeDefined();

    await query('DELETE FROM shifts WHERE work_date = $1', [OTHER_DATE]);
  });
});
