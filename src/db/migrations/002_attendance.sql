-- Migration 002: Bổ sung cấu trúc Chấm công & Xử lý ngoại lệ (Phase 2)
-- Lý do thêm bảng ngoài 6 bảng cốt lõi theo [A1]:
-- 1. adjustment_requests: Đã được liệt kê rõ trong [A1]. Lưu trữ và theo dõi quy trình duyệt đơn xin điều chỉnh công (quên check-in/out, đi trễ/về sớm do công vụ, làm thêm giờ OT).
-- 2. face_templates: Lưu trữ mẫu vector đặc trưng 128 chiều (descriptor) và ghi nhận thời điểm nhân viên xác nhận đồng ý (consent_at) để đảm bảo tuân thủ quyền riêng tư dữ liệu sinh trắc học theo SRS §3.2.

-- 1. CẤU HÌNH TỌA ĐỘ VÀ BÁN KÍNH QUÁN (stores)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_radius_positive') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_radius_positive CHECK (radius_m > 0);
  END IF;
END;
$$;

UPDATE stores
SET
  lat = COALESCE(lat, 10.7769),
  lng = COALESCE(lng, 106.7009),
  radius_m = COALESCE(radius_m, 50)
WHERE id = 1;


-- 2. CẬP NHẬT BẢNG ATTENDANCES
-- Gỡ bỏ ràng buộc unique theo shift_id cũ để hỗ trợ ca gãy (1 ca nhiều segment)
ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_shift_user_unique;

-- Bổ sung liên kết tới segment cụ thể của ca
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS segment_id UUID NOT NULL REFERENCES shift_segments(id) ON DELETE RESTRICT;

-- Bổ sung khoảng cách khuôn mặt (Euclidean distance tính bởi server so với descriptor đã enroll)
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS checkin_face_distance DOUBLE PRECISION;
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS checkout_face_distance DOUBLE PRECISION;

-- Bổ sung số phút trễ và về sớm tính toán theo khung giờ ca
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS late_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendances ADD COLUMN IF NOT EXISTS early_leave_minutes INTEGER NOT NULL DEFAULT 0;

-- Ràng buộc unique: mỗi nhân viên chỉ có 1 bản ghi chấm công trên 1 segment của ca
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_segment_user_unique') THEN
    ALTER TABLE attendances ADD CONSTRAINT attendances_segment_user_unique UNIQUE (segment_id, user_id);
  END IF;
END;
$$;

-- Indexes tối ưu hóa truy vấn chấm công theo tuần và theo ca/segment
CREATE INDEX IF NOT EXISTS idx_attendances_segment ON attendances(segment_id);
CREATE INDEX IF NOT EXISTS idx_attendances_shift_user ON attendances(shift_id, user_id);
CREATE INDEX IF NOT EXISTS idx_attendances_store_checkin ON attendances(store_id, checkin_at);
CREATE INDEX IF NOT EXISTS idx_attendances_user_checkin ON attendances(user_id, checkin_at);


-- 3. BẢNG MẪU KHUÔN MẶT (face_templates) [A1]
CREATE TABLE IF NOT EXISTS face_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  descriptor  JSONB NOT NULL,
  consent_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT face_templates_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_face_templates_store ON face_templates(store_id);
CREATE INDEX IF NOT EXISTS idx_face_templates_user ON face_templates(user_id);

DROP TRIGGER IF EXISTS trg_face_templates_updated_at ON face_templates;
CREATE TRIGGER trg_face_templates_updated_at
  BEFORE UPDATE ON face_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 4. BẢNG ĐƠN ĐIỀU CHỈNH CÔNG (adjustment_requests) [A1]
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adjustment_type') THEN
    CREATE TYPE adjustment_type AS ENUM (
      'forgot_checkin',
      'forgot_checkout',
      'forgot_both',
      'official_late_early',
      'overtime'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'adjustment_status') THEN
    CREATE TYPE adjustment_status AS ENUM (
      'pending',
      'approved',
      'rejected'
    );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS adjustment_requests (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id              INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  shift_id              UUID REFERENCES shifts(id) ON DELETE SET NULL,
  segment_id            UUID REFERENCES shift_segments(id) ON DELETE SET NULL,
  attendance_id         UUID REFERENCES attendances(id) ON DELETE SET NULL,
  request_type          adjustment_type NOT NULL,
  reason                TEXT NOT NULL,
  proposed_checkin_at   TIMESTAMPTZ,
  proposed_checkout_at  TIMESTAMPTZ,
  proposed_minutes      INTEGER,
  status                adjustment_status NOT NULL DEFAULT 'pending',
  reviewed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           TIMESTAMPTZ,
  admin_note            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adj_requests_store ON adjustment_requests(store_id);
CREATE INDEX IF NOT EXISTS idx_adj_requests_user ON adjustment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_adj_requests_status ON adjustment_requests(store_id, status);
CREATE INDEX IF NOT EXISTS idx_adj_requests_created ON adjustment_requests(store_id, created_at);

DROP TRIGGER IF EXISTS trg_adjustment_requests_updated_at ON adjustment_requests;
CREATE TRIGGER trg_adjustment_requests_updated_at
  BEFORE UPDATE ON adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
