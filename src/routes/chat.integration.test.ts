import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { chatRouter } from './chat.js';
import { errorHandler } from '../lib/errors.js';
import { chatService } from '../services/chat.service.js';
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

vi.mock('../services/chat.service.js', () => ({
  chatService: {
    listUserConversations: vi.fn(),
    getOrCreateStoreGroup: vi.fn(),
    getOrCreateDirect: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    markRead: vi.fn(),
  },
}));

// Mock socket/index.js getIO
vi.mock('../socket/index.js', () => ({
  getIO: vi.fn(() => ({
    to: vi.fn().mockReturnThis(),
    emit: vi.fn(),
  })),
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/chat', chatRouter);
app.use(errorHandler);

function mockStaff(userId = 'staff-uuid') {
  vi.mocked(jwt.verify).mockReturnValue({
    sub: userId,
    storeId: 1,
    role: 'staff',
    mustChangePassword: false,
    type: 'access',
  } as unknown as ReturnType<typeof jwt.verify>);
}

describe('Chat Routes Integration Tests (Supertest - Route Layer)', () => {
  const dummyConvId = '11111111-1111-1111-1111-111111111111';
  const dummyUserId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/chat/conversations: Chưa đăng nhập -> 401', async () => {
    const res = await request(app).get('/api/chat/conversations');
    expect(res.status).toBe(401);
  });

  it('GET /api/chat/conversations: Đã đăng nhập -> trả về danh sách hội thoại', async () => {
    mockStaff();
    vi.mocked(chatService.listUserConversations).mockResolvedValueOnce([
      {
        id: dummyConvId,
        store_id: 1,
        type: 'store_group',
        name: 'Nhóm Cửa Hàng',
        created_at: new Date(),
        updated_at: new Date(),
        members: [],
      },
    ]);

    const res = await request(app)
      .get('/api/chat/conversations')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe('Nhóm Cửa Hàng');
  });

  it('GET /api/chat/group: Lấy thông tin nhóm chung của quán -> trả 200', async () => {
    mockStaff();
    vi.mocked(chatService.getOrCreateStoreGroup).mockResolvedValueOnce({
      id: dummyConvId,
      store_id: 1,
      type: 'store_group',
      name: 'Nhóm Cửa Hàng',
      created_at: new Date(),
      updated_at: new Date(),
    });

    const res = await request(app)
      .get('/api/chat/group')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('store_group');
  });

  it('POST /api/chat/direct: Tạo cuộc trò chuyện 1-1 -> trả 200', async () => {
    mockStaff(dummyUserId);
    vi.mocked(chatService.getOrCreateDirect).mockResolvedValueOnce({
      id: dummyConvId,
      store_id: 1,
      type: 'direct',
      name: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const res = await request(app)
      .post('/api/chat/direct')
      .set('Authorization', 'Bearer token')
      .send({ target_user_id: '33333333-3333-3333-3333-333333333333' });

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('direct');
  });

  it('POST /api/chat/conversations/:id/messages: Gửi tin nhắn hợp lệ -> trả 201', async () => {
    mockStaff(dummyUserId);
    vi.mocked(chatService.sendMessage).mockResolvedValueOnce({
      id: 'msg-id',
      conversation_id: dummyConvId,
      sender_id: dummyUserId,
      content: 'Chào buổi sáng!',
      created_at: new Date(),
    });

    const res = await request(app)
      .post(`/api/chat/conversations/${dummyConvId}/messages`)
      .set('Authorization', 'Bearer token')
      .send({ content: 'Chào buổi sáng!' });

    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe('Chào buổi sáng!');
  });

  it('POST /api/chat/conversations/:id/messages: Tin nhắn rỗng -> trả 400', async () => {
    mockStaff(dummyUserId);

    const res = await request(app)
      .post(`/api/chat/conversations/${dummyConvId}/messages`)
      .set('Authorization', 'Bearer token')
      .send({ content: '' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
