-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 001: Core Tables
-- Version: 001
-- Description: 6 bảng cốt lõi + shift_segments + shift_templates + refresh_tokens
-- Rollback: migration 001_rollback.sql
--
-- Bảng thêm ngoài 6 cốt lõi và lý do [A1]:
--   shift_segments   → ca gãy cần nhiều segment thời gian [A6]
--   shift_templates  → Admin tạo ca nhanh từ template
--   refresh_tokens   → JWT refresh token rotation, revoke được [10-backend.md]
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Đảm bảo các extension cần thiết (uuid và exclusion constraint trùng ca [A6])
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ──────────────────────────────────────────────────────────────────────────
-- ENUM types
-- ──────────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('admin', 'staff');
CREATE TYPE shift_status AS ENUM ('open', 'assigned', 'completed', 'cancelled');
CREATE TYPE attendance_status AS ENUM ('present', 'late', 'early_leave', 'absent', 'pending');
CREATE TYPE swap_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE payroll_status AS ENUM ('draft', 'finalized');

-- ──────────────────────────────────────────────────────────────────────────
-- 1. stores (mặc định 1 store, cột store_id cho scale [A1])
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE stores (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  address     TEXT,
  lat         DOUBLE PRECISION,           -- vĩ độ quán (cho Haversine [A7])
  lng         DOUBLE PRECISION,           -- kinh độ quán
  radius_m    INTEGER NOT NULL DEFAULT 50, -- bán kính cho phép check-in (m)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. users — bảng cốt lõi #1
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id                INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  email                   VARCHAR(255) NOT NULL,
  password_hash           TEXT NOT NULL,
  role                    user_role NOT NULL DEFAULT 'staff',
  full_name               VARCHAR(100) NOT NULL,
  phone                   VARCHAR(20),
  -- Lương lưu VND dạng integer (bigint) — cấm float [10-backend.md]
  hourly_rate             BIGINT NOT NULL DEFAULT 0,  -- đồng/giờ
  ot_rate_multiplier      NUMERIC(4,2) NOT NULL DEFAULT 1.5, -- hệ số OT
  leave_balance           INTEGER NOT NULL DEFAULT 12, -- ngày phép còn lại/năm
  -- Onboarding
  must_change_password    BOOLEAN NOT NULL DEFAULT TRUE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  -- face-api.js descriptor [A7]: Float32Array[128] lưu dạng JSON array
  face_descriptor         JSONB,
  telegram_chat_id        VARCHAR(50),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_store_unique UNIQUE (store_id, email)
);

CREATE INDEX idx_users_store ON users(store_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(store_id, role);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. refresh_tokens (JWT rotation)
--    Lý do bảng riêng: revoke 1 token cụ thể khi logout/compromise
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,  -- SHA-256 của token raw, không lưu raw
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
-- Auto-cleanup tokens hết hạn (cleanup job chạy định kỳ)
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE NOT revoked;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. shift_templates — template ca để Admin tạo nhanh
--    Lý do: Admin thường tạo lại cùng loại ca mỗi tuần [A1]
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE shift_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,  -- VD: "Ca sáng", "Ca gãy chiều-tối"
  color       VARCHAR(7) NOT NULL DEFAULT '#6C4CF1',  -- hex color cho UI
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_templates_name_store_unique UNIQUE (store_id, name)
);

CREATE INDEX idx_shift_templates_store ON shift_templates(store_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. shift_template_segments — time segments của template
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE shift_template_segments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  start_time  TIME NOT NULL,   -- VD: '10:00'
  end_time    TIME NOT NULL,   -- VD: '14:00'
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT shift_template_seg_order CHECK (start_time < end_time)
);

CREATE INDEX idx_shift_tpl_segments_template ON shift_template_segments(template_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 6. shifts — bảng cốt lõi #2
--    Ca làm việc cụ thể theo ngày
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE shifts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  template_id  UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = ca trống
  status       shift_status NOT NULL DEFAULT 'open',
  work_date    DATE NOT NULL,  -- ngày làm (theo Asia/HCM) [A5]
  notes        TEXT,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shifts_store_date ON shifts(store_id, work_date);
CREATE INDEX idx_shifts_assigned ON shifts(assigned_to);
CREATE INDEX idx_shifts_status ON shifts(store_id, status);
CREATE INDEX idx_shifts_work_date ON shifts(work_date);

-- ──────────────────────────────────────────────────────────────────────────
-- 7. shift_segments — time slots của 1 shift [A6]
--    Ca gãy = 1 shift + nhiều segment
--    VD: 10:00-14:00 & 17:00-22:00 → 2 segments trong 1 shift
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE shift_segments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id     UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  -- lưu timestamptz đầy đủ để tính overlap chính xác [A5][A6]
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT shift_seg_order CHECK (starts_at < ends_at),
  -- Không có ca qua đêm [A5]: ends_at cùng ngày UTC-7 với starts_at
  -- Enforced at application layer
  CONSTRAINT shift_seg_max_duration CHECK (
    EXTRACT(EPOCH FROM (ends_at - starts_at)) <= 14 * 3600  -- max 14h/segment
  )
);

CREATE INDEX idx_shift_segments_shift ON shift_segments(shift_id);
-- Index cho overlap check [A6]
CREATE INDEX idx_shift_segments_time ON shift_segments(starts_at, ends_at);

-- ──────────────────────────────────────────────────────────────────────────
-- 8. attendances — bảng cốt lõi #3
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE attendances (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  shift_id        UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          attendance_status NOT NULL DEFAULT 'pending',
  -- Check-in
  checkin_at      TIMESTAMPTZ,
  checkin_lat     DOUBLE PRECISION,
  checkin_lng     DOUBLE PRECISION,
  checkin_accuracy DOUBLE PRECISION,  -- GPS accuracy (m)
  checkin_face_ok BOOLEAN,            -- kết quả so descriptor [A7]
  checkin_distance_m DOUBLE PRECISION, -- khoảng cách tới quán (Haversine)
  -- Check-out
  checkout_at     TIMESTAMPTZ,
  checkout_lat    DOUBLE PRECISION,
  checkout_lng    DOUBLE PRECISION,
  checkout_accuracy DOUBLE PRECISION,
  checkout_face_ok BOOLEAN,
  checkout_distance_m DOUBLE PRECISION,
  -- Tính giờ (phút, integer)
  actual_minutes  INTEGER,            -- NULL cho đến khi checkout
  ot_minutes      INTEGER NOT NULL DEFAULT 0,
  -- Phạt (VND integer)
  deduction_vnd   BIGINT NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendances_shift_user_unique UNIQUE (shift_id, user_id)
);

CREATE INDEX idx_attendances_store ON attendances(store_id);
CREATE INDEX idx_attendances_user ON attendances(user_id);
CREATE INDEX idx_attendances_shift ON attendances(shift_id);
CREATE INDEX idx_attendances_status ON attendances(store_id, status);
CREATE INDEX idx_attendances_checkin ON attendances(checkin_at);

-- ──────────────────────────────────────────────────────────────────────────
-- 9. swap_requests — bảng cốt lõi #4
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE swap_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requester_shift UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  receiver_id     UUID REFERENCES users(id) ON DELETE SET NULL,   -- NULL = đăng lên pool
  receiver_shift  UUID REFERENCES shifts(id) ON DELETE SET NULL,
  status          swap_status NOT NULL DEFAULT 'pending',
  -- Thời điểm tạo request — dùng để kiểm ≥48h [A5]
  reason          TEXT,
  admin_note      TEXT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_swap_store ON swap_requests(store_id);
CREATE INDEX idx_swap_requester ON swap_requests(requester_id);
CREATE INDEX idx_swap_receiver ON swap_requests(receiver_id);
CREATE INDEX idx_swap_status ON swap_requests(store_id, status);

-- ──────────────────────────────────────────────────────────────────────────
-- 10. leaves — bảng cốt lõi #5
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE leaves (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days_count    INTEGER NOT NULL,   -- số ngày nghỉ (= end_date - start_date + 1)
  reason        TEXT,
  status        leave_status NOT NULL DEFAULT 'pending',
  admin_note    TEXT,
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_dates_order CHECK (start_date <= end_date),
  CONSTRAINT leave_days_positive CHECK (days_count > 0)
);

CREATE INDEX idx_leaves_store ON leaves(store_id);
CREATE INDEX idx_leaves_user ON leaves(user_id);
CREATE INDEX idx_leaves_status ON leaves(store_id, status);
CREATE INDEX idx_leaves_dates ON leaves(user_id, start_date, end_date);

-- ──────────────────────────────────────────────────────────────────────────
-- 11. payroll — bảng cốt lõi #6
--    Chốt lương idempotent: unique(user_id, month, year) [10-backend.md]
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE payroll (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id              INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  month                 SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                  SMALLINT NOT NULL CHECK (year >= 2024),
  -- Tất cả tiền VND, integer [10-backend.md]
  base_hours            INTEGER NOT NULL DEFAULT 0,   -- phút chuẩn
  ot_hours              INTEGER NOT NULL DEFAULT 0,   -- phút OT
  base_pay_vnd          BIGINT NOT NULL DEFAULT 0,
  ot_pay_vnd            BIGINT NOT NULL DEFAULT 0,
  deductions_vnd        BIGINT NOT NULL DEFAULT 0,
  allowances_vnd        BIGINT NOT NULL DEFAULT 0,
  total_vnd             BIGINT NOT NULL,              -- computed, stored
  status                payroll_status NOT NULL DEFAULT 'draft',
  notes                 TEXT,
  finalized_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotent: cùng user + tháng + năm chỉ 1 bản ghi [10-backend.md]
  CONSTRAINT payroll_unique_period UNIQUE (user_id, month, year)
);

CREATE INDEX idx_payroll_store ON payroll(store_id);
CREATE INDEX idx_payroll_user ON payroll(user_id);
CREATE INDEX idx_payroll_period ON payroll(store_id, year, month);

-- ──────────────────────────────────────────────────────────────────────────
-- Auto-update updated_at trigger
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Áp dụng trigger cho mọi bảng có updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'stores','users','shift_templates','shifts',
      'attendances','swap_requests','leaves','payroll'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t, t
    );
  END LOOP;
END;
$$;

COMMIT;
