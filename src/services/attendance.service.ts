import { attendanceRepository } from '../repositories/attendance.repository.js';
import { isWithinStoreRadius } from './distance.js';
import { verifyFaceMatch, FACE_MATCH_THRESHOLD } from './faceVerification.service.js';
import { calcMetrics } from './metrics.service.js';
import { BadRequestError, ErrorCode } from '../lib/errors.js';
import { type Clock, systemClock } from '../lib/clock.js';

export interface CheckinInput {
  userId: string;
  storeId: number;
  shiftId: string;
  segmentId?: string | undefined;
  coords: {
    lat: number;
    lng: number;
    accuracy?: number | undefined;
  };
  faceDescriptor: number[];
  ip?: string | undefined;
  userAgent?: string | undefined;
  clock?: Clock | undefined;
}

export interface CheckoutInput {
  userId: string;
  storeId: number;
  shiftId: string;
  segmentId?: string | undefined;
  coords: {
    lat: number;
    lng: number;
    accuracy?: number | undefined;
  };
  faceDescriptor: number[];
  ip?: string | undefined;
  userAgent?: string | undefined;
  clock?: Clock | undefined;
}

export const attendanceService = {
  /**
   * Xử lý Check-in:
   * 1. So khớp khuôn mặt Euclidean <= 0.6
   * 2. Kiểm tra toạ độ GPS Haversine <= radius_m (50m) & accuracy <= max_gps_accuracy_m (100m)
   * 3. Gắn cờ flagged = true nếu IP ngoài allowlist WiFi
   * 4. Kiểm tra ca và cửa sổ check-in [starts_at - 30', ends_at)
   * 5. Tính toán trễ/đúng giờ qua calcMetrics() (ân hạn 5 phút)
   * 6. Lưu bản ghi (bắt lỗi unique 23505 chống double-submit)
   */
  async checkin(input: CheckinInput) {
    const now = (input.clock ?? systemClock)();

    // 1. Kiểm tra mẫu khuôn mặt đã đăng ký
    const template = await attendanceRepository.getFaceTemplate(input.userId);
    if (!template) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_NO_DESCRIPTOR,
        'Nhân viên chưa đăng ký mẫu khuôn mặt. Vui lòng đăng ký trước khi chấm công',
      );
    }

    const faceCheck = verifyFaceMatch(template.descriptor, input.faceDescriptor, FACE_MATCH_THRESHOLD);
    if (!faceCheck.isMatch) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_FACE_MISMATCH,
        'Xác thực khuôn mặt không trùng khớp với dữ liệu đã đăng ký',
      );
    }

    // 2. Kiểm tra cấu hình cửa hàng (GPS, WiFi)
    const storeConfig = await attendanceRepository.getStoreConfig(input.storeId);

    // Kiểm tra độ chính xác GPS
    if (
      input.coords.accuracy !== undefined &&
      input.coords.accuracy > storeConfig.max_gps_accuracy_m
    ) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_GPS_INACCURATE,
        'Độ chính xác GPS không đủ (vui lòng bật định vị chính xác cao trên thiết bị)',
      );
    }

    // Kiểm tra khoảng cách Haversine
    let distanceM = 0;
    if (storeConfig.lat !== null && storeConfig.lng !== null) {
      const storeCoords = { lat: storeConfig.lat, lng: storeConfig.lng };
      const radiusCheck = isWithinStoreRadius(input.coords, storeCoords, storeConfig.radius_m);
      distanceM = radiusCheck.distanceM;
      if (!radiusCheck.isWithin) {
        throw new BadRequestError(
          ErrorCode.ATTENDANCE_GPS_TOO_FAR,
          `Vị trí chấm công cách quán ${Math.round(distanceM)}m, vượt quá bán kính cho phép (${storeConfig.radius_m}m)`,
        );
      }
    }

    // Gắn cờ IP allowlist WiFi
    let flagged = false;
    if (storeConfig.wifi_ip_allowlist && storeConfig.wifi_ip_allowlist.length > 0) {
      if (!input.ip || !storeConfig.wifi_ip_allowlist.includes(input.ip)) {
        flagged = true;
      }
    }

    // 3. Kiểm tra phân ca & khung thời gian
    const segment = await attendanceRepository.findSegmentDetails(
      input.shiftId,
      input.segmentId,
      input.userId,
    );
    if (!segment) {
      throw new BadRequestError(
        ErrorCode.SHIFT_NOT_FOUND,
        'Ca làm việc không tồn tại hoặc không được phân công cho bạn',
      );
    }

    // Cửa sổ check-in: [starts_at - 30', ends_at)
    const windowBeforeMs = (storeConfig.checkin_window_before_minutes ?? 30) * 60000;
    const windowStart = new Date(segment.starts_at.getTime() - windowBeforeMs);
    const windowEnd = segment.ends_at;

    if (now < windowStart) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_TOO_EARLY,
        `Chưa đến thời gian cho phép check-in (chỉ mở trước ca ${storeConfig.checkin_window_before_minutes ?? 30} phút)`,
      );
    }

    if (now >= windowEnd) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_WINDOW_CLOSED,
        'Ca làm việc đã kết thúc, không thể check-in vào ca này',
      );
    }

    // Kiểm tra đã check-in chưa
    const existing = await attendanceRepository.findBySegmentAndUser(
      segment.segment_id,
      input.userId,
    );
    if (existing && existing.checkin_at) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_ALREADY_CHECKED_IN,
        'Nhân viên đã check-in cho ca này rồi',
      );
    }

    // 4. Tính toán late_minutes qua calcMetrics()
    const metrics = calcMetrics({
      shiftType: segment.shift_type,
      startsAt: segment.starts_at,
      endsAt: segment.ends_at,
      checkinAt: now,
      gracePeriodMinutes: storeConfig.grace_period_minutes,
    });

    // 5. Lưu vào cơ sở dữ liệu
    const record = await attendanceRepository.createCheckin({
      store_id: input.storeId,
      shift_id: segment.shift_id,
      segment_id: segment.segment_id,
      user_id: input.userId,
      status: metrics.status,
      checkin_at: now,
      checkin_lat: input.coords.lat,
      checkin_lng: input.coords.lng,
      checkin_accuracy: input.coords.accuracy,
      checkin_face_ok: true,
      checkin_face_distance: faceCheck.distance,
      checkin_distance_m: distanceM,
      late_minutes: metrics.lateMinutes,
      gps_accuracy_m: input.coords.accuracy,
      ip: input.ip,
      user_agent: input.userAgent,
      source: 'self',
      flagged,
    });

    // 6. Response an toàn: KHÔNG để lộ face_distance hay phần trăm
    return {
      id: record.id,
      shift_id: record.shift_id,
      segment_id: record.segment_id,
      checkin_at: record.checkin_at,
      status: record.status,
      late_minutes: record.late_minutes,
      distance_m: Math.round(distanceM),
      verified: true,
      flagged: record.flagged,
      message: 'Đã xác thực và chấm công vào thành công',
    };
  },

  /**
   * Xử lý Check-out:
   * 1. So khớp khuôn mặt
   * 2. Kiểm tra GPS
   * 3. Tính early_leave và actual_minutes qua calcMetrics()
   * 4. Cập nhật bản ghi bằng UPDATE ... WHERE checkout_at IS NULL
   */
  async checkout(input: CheckoutInput) {
    const now = (input.clock ?? systemClock)();

    // 1. Kiểm tra mẫu khuôn mặt
    const template = await attendanceRepository.getFaceTemplate(input.userId);
    if (!template) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_NO_DESCRIPTOR,
        'Nhân viên chưa đăng ký mẫu khuôn mặt',
      );
    }

    const faceCheck = verifyFaceMatch(template.descriptor, input.faceDescriptor, FACE_MATCH_THRESHOLD);
    if (!faceCheck.isMatch) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_FACE_MISMATCH,
        'Xác thực khuôn mặt không trùng khớp',
      );
    }

    // 2. Kiểm tra GPS
    const storeConfig = await attendanceRepository.getStoreConfig(input.storeId);
    if (
      input.coords.accuracy !== undefined &&
      input.coords.accuracy > storeConfig.max_gps_accuracy_m
    ) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_GPS_INACCURATE,
        'Độ chính xác GPS không đủ (vui lòng bật định vị chính xác cao)',
      );
    }

    let distanceM = 0;
    if (storeConfig.lat !== null && storeConfig.lng !== null) {
      const storeCoords = { lat: storeConfig.lat, lng: storeConfig.lng };
      const radiusCheck = isWithinStoreRadius(input.coords, storeCoords, storeConfig.radius_m);
      distanceM = radiusCheck.distanceM;
      if (!radiusCheck.isWithin) {
        throw new BadRequestError(
          ErrorCode.ATTENDANCE_GPS_TOO_FAR,
          `Vị trí chấm công cách quán ${Math.round(distanceM)}m, vượt quá bán kính cho phép (${storeConfig.radius_m}m)`,
        );
      }
    }

    // Gắn cờ IP WiFi
    let flagged = false;
    if (storeConfig.wifi_ip_allowlist && storeConfig.wifi_ip_allowlist.length > 0) {
      if (!input.ip || !storeConfig.wifi_ip_allowlist.includes(input.ip)) {
        flagged = true;
      }
    }

    // 3. Tìm ca và segment
    const segment = await attendanceRepository.findSegmentDetails(
      input.shiftId,
      input.segmentId,
      input.userId,
    );
    if (!segment) {
      throw new BadRequestError(ErrorCode.SHIFT_NOT_FOUND, 'Ca làm việc không tồn tại');
    }

    // 4. Tìm bản ghi check-in hiện hữu
    const existing = await attendanceRepository.findBySegmentAndUser(
      segment.segment_id,
      input.userId,
    );
    if (!existing || !existing.checkin_at) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_NOT_CHECKED_IN,
        'Nhân viên chưa check-in nên không thể check-out',
      );
    }
    if (existing.checkout_at) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_ALREADY_CHECKED_OUT,
        'Nhân viên đã check-out ca này rồi',
      );
    }

    // 5. Tính toán metrics qua calcMetrics()
    const metrics = calcMetrics({
      shiftType: segment.shift_type,
      startsAt: segment.starts_at,
      endsAt: segment.ends_at,
      checkinAt: existing.checkin_at,
      checkoutAt: now,
      gracePeriodMinutes: storeConfig.grace_period_minutes,
      approvedOtMinutes: existing.ot_minutes,
    });

    // 6. Cập nhật checkout
    const updated = await attendanceRepository.updateCheckout({
      id: existing.id,
      checkout_at: now,
      checkout_lat: input.coords.lat,
      checkout_lng: input.coords.lng,
      checkout_accuracy: input.coords.accuracy,
      checkout_face_ok: true,
      checkout_face_distance: faceCheck.distance,
      checkout_distance_m: distanceM,
      early_leave_minutes: metrics.earlyLeaveMinutes,
      actual_minutes: metrics.actualMinutes,
      ot_minutes: metrics.otMinutes,
      status: metrics.status,
      flagged,
    });

    if (!updated) {
      throw new BadRequestError(
        ErrorCode.ATTENDANCE_ALREADY_CHECKED_OUT,
        'Bản ghi đã được check-out hoặc không tồn tại',
      );
    }

    // 7. Response an toàn
    return {
      id: updated.id,
      shift_id: updated.shift_id,
      segment_id: updated.segment_id,
      checkout_at: updated.checkout_at,
      actual_minutes: updated.actual_minutes,
      early_leave_minutes: updated.early_leave_minutes,
      ot_minutes: updated.ot_minutes,
      status: updated.status,
      distance_m: Math.round(distanceM),
      verified: true,
      flagged: updated.flagged,
      message: 'Đã xác thực và chấm công ra thành công',
    };
  },

  /**
   * Đăng ký khuôn mặt lần đầu từ JWT (User tự đăng ký)
   */
  async enrollFace(userId: string, storeId: number, descriptor: number[], consent: boolean) {
    if (!consent) {
      throw new BadRequestError(
        ErrorCode.VALIDATION_ERROR,
        'Bắt buộc đồng ý cam kết thu thập dữ liệu sinh trắc học theo quy định',
      );
    }

    // Chỉ cho phép enroll lần đầu
    const existing = await attendanceRepository.getFaceTemplate(userId);
    if (existing) {
      throw new BadRequestError(
        ErrorCode.FACE_ALREADY_ENROLLED,
        'Tài khoản đã đăng ký mẫu khuôn mặt. Vui lòng liên hệ Quản lý nếu cần đặt lại',
      );
    }

    const saved = await attendanceRepository.saveFaceTemplate(storeId, userId, descriptor);
    return {
      success: true,
      message: 'Đăng ký mẫu khuôn mặt thành công',
      consent_at: saved.consent_at,
    };
  },

  /**
   * Admin đặt lại mẫu khuôn mặt để nhân viên enroll lại
   */
  async resetFace(userId: string) {
    await attendanceRepository.deleteFaceTemplate(userId);
    return {
      success: true,
      message: 'Đã đặt lại mẫu khuôn mặt thành công. Nhân viên có thể đăng ký lại',
    };
  },

  /**
   * Admin xoá vĩnh viễn mẫu khuôn mặt khi nhân viên nghỉ việc
   */
  async deleteFace(userId: string) {
    const deleted = await attendanceRepository.deleteFaceTemplate(userId);
    return {
      success: deleted,
      message: deleted
        ? 'Đã xoá vĩnh viễn mẫu khuôn mặt khỏi hệ thống'
        : 'Không tìm thấy mẫu khuôn mặt để xoá',
    };
  },

  /**
   * Kiểm tra trạng thái đã đăng ký khuôn mặt hay chưa
   */
  async getFaceStatus(userId: string) {
    const template = await attendanceRepository.getFaceTemplate(userId);
    return {
      enrolled: !!template,
      consent_at: template?.consent_at ?? null,
    };
  },

  /**
   * Truy vấn danh sách chấm công (RBAC: Staff xem của mình, Admin xem toàn store)
   */
  async listAttendances(filter: {
    storeId: number;
    userId?: string | undefined;
    fromDate?: string | undefined;
    toDate?: string | undefined;
    status?: string | undefined;
    flagged?: boolean | undefined;
  }) {
    return attendanceRepository.listAttendances(filter);
  },
};
