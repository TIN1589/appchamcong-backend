import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { shiftsRouter } from './shifts.js';
import { errorHandler } from '../lib/errors.js';
import { shiftsService } from '../services/shifts.service.js';
import type { ShiftWithSegments } from '../repositories/shifts.repository.js';
import jwt from 'jsonwebtoken';

vi.mock('jsonwebtoken', async () => {
  const actual = await vi.importActual<typeof import('jsonwebtoken')>('jsonwebtoken');
  return {
    ...actual,
    default: {
      ...actual,
      verify: vi.fn(),
    },
  };
});

vi.mock('../services/shifts.service.js', () => ({
  shiftsService: {
    create: vi.fn(),
    assign: vi.fn(),
    listByDateRange: vi.fn(),
    getById: vi.fn(),
    delete: vi.fn(),
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    createFromTemplate: vi.fn(),
  },
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/shifts', shiftsRouter);
app.use(errorHandler);

function mockAdmin() {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: 'admin-uuid',
    storeId: 1,
    role: 'admin',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

function mockStaff(userId = 'staff-uuid') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role: 'staff',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

const shiftStub: ShiftWithSegments = {
  id: 'shift-uuid-1',
  store_id: 1,
  work_date: new Date('2026-10-06'),
  status: 'open',
  source: 'manual',
  shift_type: 'REGULAR',
  assigned_to: null,
  template_id: null,
  notes: null,
  created_by: 'admin-uuid',
  created_at: new Date('2026-10-01T00:00:00Z'),
  updated_at: new Date('2026-10-01T00:00:00Z'),
  segments: [
    {
      id: 'seg-1',
      shift_id: 'shift-uuid-1',
      starts_at: new Date('2026-10-06T01:00:00Z'),
      ends_at: new Date('2026-10-06T10:00:00Z'),
      sort_order: 0,
    },
  ],
};

describe('POST /api/shifts — Tạo ca làm việc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RBAC] Staff bị từ chối tạo ca → 403', async () => {
    mockStaff();
    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({
        workDate: '2026-10-06',
        segments: [{ startTime: '08:00', endTime: '17:00' }],
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/quyền/i);
  });

  it('[VALIDATION] Thiếu workDate → 400', async () => {
    mockAdmin();
    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({ segments: [{ startTime: '08:00', endTime: '17:00' }] });

    expect(res.status).toBe(400);
  });

  it('[VALIDATION] Thiếu segments → 400', async () => {
    mockAdmin();
    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({ workDate: '2026-10-06' });

    expect(res.status).toBe(400);
  });

  it('[VALIDATION] segments rỗng [] → 400', async () => {
    mockAdmin();
    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({ workDate: '2026-10-06', segments: [] });

    expect(res.status).toBe(400);
  });

  it('[VALIDATION] workDate format sai → 400', async () => {
    mockAdmin();
    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({
        workDate: '06-10-2026',
        segments: [{ startTime: '08:00', endTime: '17:00' }],
      });

    expect(res.status).toBe(400);
  });

  it('[HAPPY PATH] Admin tạo ca thành công → 201 với shift data', async () => {
    mockAdmin();
    vi.mocked(shiftsService.create).mockResolvedValue(shiftStub);

    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({
        workDate: '2026-10-06',
        segments: [{ startTime: '08:00', endTime: '17:00' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('shift-uuid-1');
    expect(res.body.status).toBe('open');
    expect(res.body.segments).toHaveLength(1);
    expect(shiftsService.create).toHaveBeenCalledOnce();
  });

  it('[HAPPY PATH] Admin tạo ca có ghi chú → service nhận notes', async () => {
    mockAdmin();
    vi.mocked(shiftsService.create).mockResolvedValue({
      ...shiftStub,
      notes: 'Ca đặc biệt cuối tuần',
    });

    const res = await request(app)
      .post('/api/shifts')
      .set('Authorization', 'Bearer dummy')
      .send({
        workDate: '2026-10-06',
        segments: [{ startTime: '08:00', endTime: '17:00' }],
        notes: 'Ca đặc biệt cuối tuần',
      });

    expect(res.status).toBe(201);
    expect(res.body.notes).toBe('Ca đặc biệt cuối tuần');
  });
});

describe('POST /api/shifts/:id/assign — Gán ca cho nhân viên', () => {
  const SHIFT_ID = '550e8400-e29b-41d4-a716-446655440001';
  const STAFF_ID = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RBAC] Staff không được gán ca → 403', async () => {
    mockStaff();
    const res = await request(app)
      .post(`/api/shifts/${SHIFT_ID}/assign`)
      .set('Authorization', 'Bearer dummy')
      .send({ userId: STAFF_ID });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/quyền/i);
  });

  it('[VALIDATION] Thiếu userId → 400', async () => {
    mockAdmin();
    const res = await request(app)
      .post(`/api/shifts/${SHIFT_ID}/assign`)
      .set('Authorization', 'Bearer dummy')
      .send({});

    expect(res.status).toBe(400);
  });

  it('[VALIDATION] userId không phải UUID → 400', async () => {
    mockAdmin();
    const res = await request(app)
      .post(`/api/shifts/${SHIFT_ID}/assign`)
      .set('Authorization', 'Bearer dummy')
      .send({ userId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('[HAPPY PATH] Admin gán ca thành công → 200 với shift assigned', async () => {
    mockAdmin();
    const assignedShift = {
      ...shiftStub,
      status: 'assigned' as const,
      assigned_to: STAFF_ID,
    };
    vi.mocked(shiftsService.assign).mockResolvedValue(assignedShift);

    const res = await request(app)
      .post(`/api/shifts/${SHIFT_ID}/assign`)
      .set('Authorization', 'Bearer dummy')
      .send({ userId: STAFF_ID });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('assigned');
    expect(res.body.assigned_to).toBe(STAFF_ID);
    expect(shiftsService.assign).toHaveBeenCalledWith(SHIFT_ID, 1, STAFF_ID);
  });

  it('[RACE CONDITION] Ca đã được gán bởi request khác → service throw ConflictError → 409', async () => {
    mockAdmin();
    const { ConflictError, ErrorCode } = await import('../lib/errors.js');
    vi.mocked(shiftsService.assign).mockRejectedValue(
      new ConflictError(ErrorCode.SHIFT_NOT_OPEN, 'Ca này không còn trống hoặc không tồn tại'),
    );

    const res = await request(app)
      .post(`/api/shifts/${SHIFT_ID}/assign`)
      .set('Authorization', 'Bearer dummy')
      .send({ userId: STAFF_ID });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/không còn trống/);
  });

  it('[RACE CONDITION] Gán 2 request đồng thời — chỉ 1 thành công, 1 nhận 409', async () => {
    mockAdmin();

    const assignedShift = { ...shiftStub, status: 'assigned' as const, assigned_to: STAFF_ID };
    const { ConflictError, ErrorCode } = await import('../lib/errors.js');
    const conflict = new ConflictError(
      ErrorCode.SHIFT_NOT_OPEN,
      'Ca này không còn trống hoặc không tồn tại',
    );

    vi.mocked(shiftsService.assign)
      .mockResolvedValueOnce(assignedShift)
      .mockRejectedValueOnce(conflict);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/api/shifts/${SHIFT_ID}/assign`)
        .set('Authorization', 'Bearer dummy')
        .send({ userId: STAFF_ID }),
      request(app)
        .post(`/api/shifts/${SHIFT_ID}/assign`)
        .set('Authorization', 'Bearer dummy')
        .send({ userId: '550e8400-e29b-41d4-a716-446655440003' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('GET /api/shifts — Danh sách ca', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[RBAC] Unauthenticated → 401', async () => {
    const res = await request(app).get('/api/shifts');
    expect(res.status).toBe(401);
  });

  it('[HAPPY PATH] Admin xem tất cả ca → 200 với paginated result', async () => {
    mockAdmin();
    const pagedResult = {
      data: [shiftStub],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    };
    vi.mocked(shiftsService.listByDateRange).mockResolvedValue(pagedResult);

    const res = await request(app)
      .get('/api/shifts')
      .set('Authorization', 'Bearer dummy');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('[RBAC] Staff chỉ thấy ca của mình → service được gọi với assignedTo = staff id', async () => {
    const staffId = 'staff-uuid';
    mockStaff(staffId);
    vi.mocked(shiftsService.listByDateRange).mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      totalPages: 0,
    });

    await request(app)
      .get('/api/shifts')
      .set('Authorization', 'Bearer dummy');

    expect(shiftsService.listByDateRange).toHaveBeenCalledWith(
      1,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ page: 1, limit: 50 }),
      expect.objectContaining({ assignedTo: staffId }),
    );
  });
});
