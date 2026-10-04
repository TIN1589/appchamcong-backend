import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface TelegramSendOptions {
  parseMode?: 'HTML' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  maxRetries?: number;
}

export interface TelegramMessageResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
}

export class TelegramService {
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly adminChatId?: string | undefined;

  constructor(token?: string, adminChatId?: string) {
    const botToken = token ?? env.TELEGRAM_BOT_TOKEN;
    this.enabled = Boolean(botToken && botToken.trim().length > 0);
    this.baseUrl = this.enabled ? `https://api.telegram.org/bot${botToken?.trim()}` : '';
    this.adminChatId = adminChatId ?? env.TELEGRAM_ADMIN_CHAT_ID;
  }

  /**
   * Kiểm tra Bot đã được cấu hình token hay chưa
   */
  public isConfigured(): boolean {
    return this.enabled;
  }

  /**
   * Gửi tin nhắn Telegram với cơ chế timeout (5s) và retry có giới hạn (exponential backoff).
   * Tuyệt đối không throw exception làm gián đoạn tiến trình gọi.
   */
  public async sendMessage(
    chatId: string | null | undefined,
    text: string,
    options?: TelegramSendOptions,
  ): Promise<boolean> {
    if (!chatId || chatId.trim().length === 0) {
      logger.debug({ textSnippet: text.slice(0, 50) }, '[Telegram] Bỏ qua gửi tin: Không có chatId');
      return false;
    }

    if (!this.enabled) {
      logger.debug(
        { chatId, textSnippet: text.slice(0, 50) },
        '[Telegram Mock/Noop] TELEGRAM_BOT_TOKEN chưa cấu hình, bỏ qua gửi tin thực tế',
      );
      return true;
    }

    const maxRetries = options?.maxRetries ?? 2;
    const parseMode = options?.parseMode ?? 'HTML';
    const disablePreview = options?.disableWebPagePreview ?? true;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 5000);

        const response = await fetch(`${this.baseUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId.trim(),
            text,
            parse_mode: parseMode,
            disable_web_page_preview: disablePreview,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = (await response.json()) as TelegramMessageResponse;

        if (response.ok && data.ok) {
          logger.debug({ chatId, attempt }, '[Telegram] Gửi tin nhắn thành công');
          return true;
        }

        // Lỗi 403 (User blocked bot) hoặc 400 (Bad request / Chat not found): Không cần retry vô ích
        if (data.error_code === 403 || data.error_code === 400) {
          logger.warn(
            { chatId, errorCode: data.error_code, desc: data.description },
            '[Telegram] Gửi tin thất bại do người dùng chặn bot hoặc chat_id không hợp lệ',
          );
          return false;
        }

        logger.warn(
          { chatId, attempt, status: response.status, desc: data.description },
          '[Telegram] API trả về mã lỗi không thành công',
        );
      } catch (err: unknown) {
        logger.warn(
          { chatId, attempt, err: err instanceof Error ? err.message : String(err) },
          '[Telegram] Ngoại lệ kết nối hoặc timeout khi gọi API',
        );
      }

      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    logger.error({ chatId }, '[Telegram] Gửi tin nhắn thất bại sau toàn bộ số lần thử lại');
    return false;
  }

  /**
   * Gửi tin nhắn tới kênh quản trị (Admin Chat / Owner Channel)
   */
  public async sendAdminAlert(text: string): Promise<boolean> {
    const adminChatId = this.adminChatId ?? env.TELEGRAM_ADMIN_CHAT_ID;
    if (!adminChatId) {
      logger.debug('[Telegram] TELEGRAM_ADMIN_CHAT_ID chưa cấu hình, bỏ qua cảnh báo admin');
      return false;
    }
    return this.sendMessage(adminChatId, text);
  }

  // ==========================================
  // TEMPLATES THÔNG BÁO NGHIỆP VỤ
  // ==========================================

  /**
   * 1. Thông báo nhắc ca làm việc sắp bắt đầu
   */
  public async notifyShiftReminder(params: {
    chatId: string;
    userName: string;
    workDate: string;
    timeRange: string;
    storeName?: string | undefined;
  }): Promise<boolean> {
    const message = [
      '⏰ <b>NHẮC LỊCH LÀM VIỆC SẮP TỚI</b>',
      '',
      `👤 Nhân viên: <b>${this.escapeHtml(params.userName)}</b>`,
      `📅 Ngày làm: <b>${params.workDate}</b>`,
      `⏱ Khung giờ: <b>${params.timeRange}</b>`,
      params.storeName ? `📍 Chi nhánh: <b>${this.escapeHtml(params.storeName)}</b>` : '',
      '',
      '⚠️ <i>Vui lòng chuẩn bị và có mặt đúng giờ. Đừng quên mở app để Check-in trong bán kính 50m!</i>',
    ]
      .filter(Boolean)
      .join('\n');

    return this.sendMessage(params.chatId, message);
  }

  /**
   * 2. Thông báo khi có yêu cầu đổi ca 1-1 mới
   */
  public async notifySwapRequested(params: {
    receiverChatId?: string | null | undefined;
    requesterName: string;
    receiverName: string;
    targetShiftInfo: string;
    myShiftInfo: string;
    reason?: string | null | undefined;
  }): Promise<void> {
    const userMsg = [
      '🔄 <b>BẠN CÓ YÊU CẦU ĐỔI CA MỚI</b>',
      '',
      `👤 Người gửi: <b>${this.escapeHtml(params.requesterName)}</b>`,
      `➡️ Muốn đổi lấy ca của bạn: <b>${this.escapeHtml(params.targetShiftInfo)}</b>`,
      `⬅️ Bằng ca của họ: <b>${this.escapeHtml(params.myShiftInfo)}</b>`,
      params.reason ? `💬 Lý do: <i>${this.escapeHtml(params.reason)}</i>` : '',
      '',
      '👉 <i>Vui lòng vào ứng dụng để xem chi tiết và phản hồi đơn đổi ca này.</i>',
    ]
      .filter(Boolean)
      .join('\n');

    if (params.receiverChatId) {
      void this.sendMessage(params.receiverChatId, userMsg);
    }

    // Đồng thời bắn thông báo đến kênh Admin để theo dõi
    const adminMsg = [
      '📋 <b>THÔNG BÁO ĐỔI CA 1-1 MỚI</b>',
      `• Người gửi: ${this.escapeHtml(params.requesterName)}`,
      `• Người nhận: ${this.escapeHtml(params.receiverName)}`,
      `• Ca xin đổi: ${this.escapeHtml(params.targetShiftInfo)}`,
      params.reason ? `• Lý do: ${this.escapeHtml(params.reason)}` : '',
      '⏳ <i>Đang chờ người nhận phản hồi trước khi trình Quản lý duyệt.</i>',
    ]
      .filter(Boolean)
      .join('\n');

    void this.sendAdminAlert(adminMsg);
  }

  /**
   * 3. Thông báo khi có ca mới đưa lên Chợ ca (Shift Pool)
   */
  public async notifyShiftPoolCreated(params: {
    requesterName: string;
    workDate: string;
    timeRange: string;
    reason?: string | null | undefined;
  }): Promise<void> {
    const alertMsg = [
      '🏷 <b>CA MỚI TRÊN CHỢ CA (SHIFT POOL)</b>',
      '',
      `👤 Người nhượng: <b>${this.escapeHtml(params.requesterName)}</b>`,
      `📅 Ngày làm việc: <b>${params.workDate}</b>`,
      `⏱ Khung giờ: <b>${params.timeRange}</b>`,
      params.reason ? `💬 Lý do: <i>${this.escapeHtml(params.reason)}</i>` : '',
      '',
      '👉 <i>Nhân viên có lịch rảnh vui lòng truy cập ứng dụng để nhận ca!</i>',
    ]
      .filter(Boolean)
      .join('\n');

    void this.sendAdminAlert(alertMsg);
  }

  /**
   * 4. Thông báo khi một ca trên Chợ ca đã có người nhận (Claimed)
   */
  public async notifyShiftPoolClaimed(params: {
    requesterChatId?: string | null | undefined;
    requesterName: string;
    claimerName: string;
    workDate: string;
    timeRange: string;
  }): Promise<void> {
    const msgToRequester = [
      '🎉 <b>CA NHƯỢNG CỦA BẠN ĐÃ CÓ NGƯỜI NHẬN</b>',
      '',
      `Xin chào <b>${this.escapeHtml(params.requesterName)}</b>,`,
      `Ca làm việc ngày <b>${params.workDate}</b> (${params.timeRange}) của bạn đã được nhân viên <b>${this.escapeHtml(params.claimerName)}</b> nhận thành công!`,
      '',
      '✅ <i>Lịch làm việc của bạn đã được giải phóng trên hệ thống.</i>',
    ].join('\n');

    if (params.requesterChatId) {
      void this.sendMessage(params.requesterChatId, msgToRequester);
    }

    const adminMsg = [
      '✅ <b>CHỢ CA: NHẬN CA THÀNH CÔNG</b>',
      `• Ca ngày: ${params.workDate} (${params.timeRange})`,
      `• Người nhượng: ${this.escapeHtml(params.requesterName)}`,
      `• Người nhận: ${this.escapeHtml(params.claimerName)}`,
      '<i>Đã tự động cập nhật phân ca vào PostgreSQL.</i>',
    ].join('\n');

    void this.sendAdminAlert(adminMsg);
  }

  /**
   * 5. Thông báo kết quả xét duyệt đơn đổi ca (Approved/Rejected)
   */
  public async notifySwapReviewed(params: {
    recipientChatId?: string | null | undefined;
    recipientName: string;
    status: 'approved' | 'rejected';
    adminName: string;
    note?: string | null | undefined;
  }): Promise<void> {
    const isApproved = params.status === 'approved';
    const statusText = isApproved ? 'CHẤP THUẬN ✅' : 'TỪ CHỐI ❌';

    const msg = [
      `📢 <b>KẾT QUẢ XÉT DUYỆT ĐỔI CA</b>`,
      '',
      `Xin chào <b>${this.escapeHtml(params.recipientName)}</b>,`,
      `Đơn đổi ca của bạn đã được Quản lý <b>${this.escapeHtml(params.adminName)}</b> xem xét: <b>${statusText}</b>`,
      params.note ? `📝 Ghi chú: <i>${this.escapeHtml(params.note)}</i>` : '',
      '',
      isApproved
        ? '✅ <i>Lịch làm việc tuần đã được cập nhật lại tương ứng.</i>'
        : '⚠️ <i>Lịch làm việc giữ nguyên theo phân công ban đầu.</i>',
    ]
      .filter(Boolean)
      .join('\n');

    if (params.recipientChatId) {
      void this.sendMessage(params.recipientChatId, msg);
    }
  }

  /**
   * 6. Cảnh báo an ninh & Chấm công bất thường (missing_checkout)
   */
  public async notifyMissingCheckout(params: {
    userName: string;
    workDate: string;
    timeRange: string;
    attendanceId: string;
  }): Promise<void> {
    const alertMsg = [
      '⚠️ <b>CẢNH BÁO: PHÁT HIỆN QUÊN CHECK-OUT</b>',
      '',
      `👤 Nhân viên: <b>${this.escapeHtml(params.userName)}</b>`,
      `📅 Ngày làm: <b>${params.workDate}</b> (${params.timeRange})`,
      `🆔 Bản ghi công: <code>${params.attendanceId}</code>`,
      '',
      '🚨 <i>Đã quá 2 tiếng kể từ khi kết thúc ca mà chưa ghi nhận Check-out!</i>',
      '📌 <i>Bản ghi đã được tự động gắn cờ <code>missing_checkout</code> và khóa tính lương cho đến khi Quản lý duyệt giải trình.</i>',
    ].join('\n');

    void this.sendAdminAlert(alertMsg);
  }

  /**
   * 7. Cảnh báo bảo mật hệ thống (Audit Security Actions)
   */
  public async notifySecurityAlert(params: {
    action: string;
    performedBy?: string;
    detail?: string;
    ip?: string;
  }): Promise<void> {
    const alertMsg = [
      '🚨 <b>CẢNH BÁO BẢO MẬT HỆ THỐNG</b>',
      '',
      `Hành động: <code>${this.escapeHtml(params.action)}</code>`,
      params.performedBy ? `Thực hiện bởi: <b>${this.escapeHtml(params.performedBy)}</b>` : '',
      params.ip ? `Địa chỉ IP: <code>${this.escapeHtml(params.ip)}</code>` : '',
      params.detail ? `Chi tiết: <i>${this.escapeHtml(params.detail)}</i>` : '',
      `Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    ]
      .filter(Boolean)
      .join('\n');

    void this.sendAdminAlert(alertMsg);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export const telegramService = new TelegramService();
