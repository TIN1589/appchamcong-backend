import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramService } from './telegram.service.js';

describe('TelegramService (Unit Tests)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('1. Khởi tạo & Cấu hình (Configuration)', () => {
    it('Chế độ no-op / mock khi không có token (isConfigured = false)', async () => {
      const service = new TelegramService('');
      expect(service.isConfigured()).toBe(false);

      // Khi không cấu hình token, sendMessage trả về true (mock) và không gọi fetch
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const result = await service.sendMessage('123456', 'Hello world');
      expect(result).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Bỏ qua gửi tin nhắn khi chatId rỗng hoặc undefined', async () => {
      const service = new TelegramService('fake_token_123');
      expect(service.isConfigured()).toBe(true);

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      expect(await service.sendMessage(null, 'test')).toBe(false);
      expect(await service.sendMessage('', 'test')).toBe(false);
      expect(await service.sendMessage('   ', 'test')).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. Gửi tin nhắn & Xử lý phản hồi API', () => {
    it('Gửi tin nhắn thành công qua Telegram Bot API (HTTP 200, ok: true)', async () => {
      const service = new TelegramService('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 101 } }),
      });

      const success = await service.sendMessage('999888777', '<b>Tin nhắn thử nghiệm</b>');
      expect(success).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const [url, requestInit] = (global.fetch as any).mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage');
      const body = JSON.parse(requestInit.body);
      expect(body.chat_id).toBe('999888777');
      expect(body.text).toBe('<b>Tin nhắn thử nghiệm</b>');
      expect(body.parse_mode).toBe('HTML');
    });

    it('Không retry vô ích khi gặp lỗi 403 (User blocked bot) hoặc 400 (Bad request)', async () => {
      const service = new TelegramService('fake_token');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }),
      });

      const success = await service.sendMessage('blocked_user', 'Xin chào', { maxRetries: 2 });
      expect(success).toBe(false);
      // Chỉ gọi đúng 1 lần, không retry
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('Tự động retry có giới hạn (exponential backoff) khi API lỗi 500 hoặc rớt mạng', async () => {
      const service = new TelegramService('fake_token');

      // Giả lập 2 lần đầu lỗi mạng/500, lần thứ 3 thành công
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          return {
            ok: false,
            status: 502,
            json: async () => ({ ok: false, error_code: 502, description: 'Bad Gateway' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, result: { message_id: 202 } }),
        };
      });

      const success = await service.sendMessage('user_chat_id', 'Thử lại kết nối', { maxRetries: 2 });
      expect(success).toBe(true);
      expect(attempts).toBe(3);
    });

    it('Không throw ngoại lệ khi kết nối sập hoàn toàn (trả về false an toàn)', async () => {
      const service = new TelegramService('fake_token');

      global.fetch = vi.fn().mockRejectedValue(new Error('Network connection refused ECONNREFUSED'));

      const success = await service.sendMessage('user_chat_id', 'Mạng lỗi', { maxRetries: 1 });
      expect(success).toBe(false);
    });
  });

  describe('3. Template nghiệp vụ & HTML Escaping', () => {
    it('notifyShiftReminder: Format đầy đủ nội dung nhắc ca và escape ký tự nhạy cảm', async () => {
      const service = new TelegramService('fake_token');
      let sentText = '';

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        const payload = JSON.parse(init.body);
        sentText = payload.text;
        return { ok: true, json: async () => ({ ok: true }) };
      });

      await service.notifyShiftReminder({
        chatId: '12345',
        userName: 'Nguyễn Văn <Quản lý & Test>',
        workDate: '2026-10-10',
        timeRange: 'Ca Sáng (08:00 - 12:00)',
        storeName: 'Chi nhánh "Phố Cổ"',
      });

      expect(sentText).toContain('NHẮC LỊCH LÀM VIỆC SẮP TỚI');
      // Kiểm tra escape ký tự HTML
      expect(sentText).toContain('&lt;Quản lý &amp; Test&gt;');
      expect(sentText).toContain('&quot;Phố Cổ&quot;');
      expect(sentText).toContain('Ca Sáng (08:00 - 12:00)');
      expect(sentText).toContain('2026-10-10');
    });

    it('notifySwapRequested: Gửi thông báo cho người nhận đơn', async () => {
      const service = new TelegramService('fake_token');
      const messages: string[] = [];

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        messages.push(JSON.parse(init.body).text);
        return { ok: true, json: async () => ({ ok: true }) };
      });

      await service.notifySwapRequested({
        receiverChatId: 'rec_123',
        requesterName: 'Nhân viên A',
        receiverName: 'Nhân viên B',
        targetShiftInfo: '2026-10-12 (12:00 - 17:00)',
        myShiftInfo: '2026-10-11 (08:00 - 12:00)',
        reason: 'Có việc gia đình',
      });

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const userMsg = messages[0];
      expect(userMsg).toContain('BẠN CÓ YÊU CẦU ĐỔI CA MỚI');
      expect(userMsg).toContain('Nhân viên A');
      expect(userMsg).toContain('Có việc gia đình');
    });

    it('notifyShiftPoolClaimed: Thông báo thành công cho người nhượng', async () => {
      const service = new TelegramService('fake_token');
      let msg = '';

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        msg = JSON.parse(init.body).text;
        return { ok: true, json: async () => ({ ok: true }) };
      });

      await service.notifyShiftPoolClaimed({
        requesterChatId: 'req_888',
        requesterName: 'Lê Văn C',
        claimerName: 'Phạm Thị D',
        workDate: '2026-10-15',
        timeRange: '08:00 - 12:00',
      });

      expect(msg).toContain('CA NHƯỢNG CỦA BẠN ĐÃ CÓ NGƯỜI NHẬN');
      expect(msg).toContain('Lê Văn C');
      expect(msg).toContain('Phạm Thị D');
    });

    it('notifyMissingCheckout: Cảnh báo quên check-out với mã bản ghi', async () => {
      const service = new TelegramService('fake_token', 'admin_channel_123');
      let alert = '';

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        alert = JSON.parse(init.body).text;
        return { ok: true, json: async () => ({ ok: true }) };
      });

      await service.notifyMissingCheckout({
        userName: 'Trần Văn E',
        workDate: '2026-10-04',
        timeRange: '12:00 - 17:00',
        attendanceId: 'att-uuid-999',
      });

      expect(alert).toContain('CẢNH BÁO: PHÁT HIỆN QUÊN CHECK-OUT');
      expect(alert).toContain('Trần Văn E');
      expect(alert).toContain('<code>att-uuid-999</code>');
      expect(alert).toContain('missing_checkout');
    });

    it('notifySecurityAlert: Bắn cảnh báo bảo mật hệ thống tới kênh Admin', async () => {
      const service = new TelegramService('fake_token', 'admin_channel_123');
      let alert = '';

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        alert = JSON.parse(init.body).text;
        return { ok: true, json: async () => ({ ok: true }) };
      });

      await service.notifySecurityAlert({
        action: 'LOGIN_LOCKED',
        performedBy: 'Hệ thống Auth',
        detail: 'Tài khoản admin@quan.com bị khóa do sai mật khẩu 5 lần',
        ip: '192.168.1.100',
      });

      expect(alert).toContain('CẢNH BÁO BẢO MẬT HỆ THỐNG');
      expect(alert).toContain('LOGIN_LOCKED');
      expect(alert).toContain('admin@quan.com');
    });
  });
});
