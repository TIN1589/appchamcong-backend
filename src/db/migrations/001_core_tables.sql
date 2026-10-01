BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE user_role AS ENUM ('admin', 'staff');
CREATE TYPE shift_status AS ENUM ('open', 'assigned', 'completed', 'cancelled');
CREATE TYPE attendance_status AS ENUM ('present', 'late', 'early_leave', 'absent', 'pending');
CREATE TYPE swap_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE leave_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE payroll_status AS ENUM ('draft', 'finalized');

CREATE TABLE stores (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  address     TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  radius_m    INTEGER NOT NULL DEFAULT 50,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id                INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  email                   VARCHAR(255) NOT NULL,
  password_hash           TEXT NOT NULL,
  role                    user_role NOT NULL DEFAULT 'staff',
  full_name               VARCHAR(100) NOT NULL,
  phone                   VARCHAR(20),
  hourly_rate             BIGINT NOT NULL DEFAULT 0,
  ot_rate_multiplier      NUMERIC(4,2) NOT NULL DEFAULT 1.5,
  leave_balance           INTEGER NOT NULL DEFAULT 12,
  must_change_password    BOOLEAN NOT NULL DEFAULT TRUE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  face_descriptor         JSONB,
  telegram_chat_id        VARCHAR(50),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_store_unique UNIQUE (store_id, email)
);

CREATE INDEX idx_users_store ON users(store_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(store_id, role);

-- Bảng riêng phục vụ lưu hash và thu hồi refresh token khi đăng xuất hoặc xoay token
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at) WHERE NOT revoked;

-- Bảng mẫu ca làm việc giúp quản lý khởi tạo nhanh các ca định kỳ hàng tuần
CREATE TABLE shift_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  color       VARCHAR(7) NOT NULL DEFAULT '#6C4CF1',
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_templates_name_store_unique UNIQUE (store_id, name)
);

CREATE INDEX idx_shift_templates_store ON shift_templates(store_id);

CREATE TABLE shift_template_segments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT shift_template_seg_order CHECK (start_time < end_time)
);

CREATE INDEX idx_shift_tpl_segments_template ON shift_template_segments(template_id);

CREATE TABLE shifts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  template_id  UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,
  status       shift_status NOT NULL DEFAULT 'open',
  work_date    DATE NOT NULL,
  notes        TEXT,
  created_by   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shifts_store_date ON shifts(store_id, work_date);
CREATE INDEX idx_shifts_assigned ON shifts(assigned_to);
CREATE INDEX idx_shifts_status ON shifts(store_id, status);
CREATE INDEX idx_shifts_work_date ON shifts(work_date);

-- Bảng phân đoạn thời gian phục vụ ca gãy và ca làm việc nhiều khung giờ
CREATE TABLE shift_segments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id     UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  sort_order   SMALLINT NOT NULL DEFAULT 0,
  CONSTRAINT shift_seg_order CHECK (starts_at < ends_at),
  CONSTRAINT shift_seg_max_duration CHECK (
    EXTRACT(EPOCH FROM (ends_at - starts_at)) <= 14 * 3600
  )
);

CREATE INDEX idx_shift_segments_shift ON shift_segments(shift_id);
CREATE INDEX idx_shift_segments_time ON shift_segments(starts_at, ends_at);

CREATE TABLE attendances (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  shift_id        UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status          attendance_status NOT NULL DEFAULT 'pending',
  checkin_at      TIMESTAMPTZ,
  checkin_lat     DOUBLE PRECISION,
  checkin_lng     DOUBLE PRECISION,
  checkin_accuracy DOUBLE PRECISION,
  checkin_face_ok BOOLEAN,
  checkin_distance_m DOUBLE PRECISION,
  checkout_at     TIMESTAMPTZ,
  checkout_lat    DOUBLE PRECISION,
  checkout_lng    DOUBLE PRECISION,
  checkout_accuracy DOUBLE PRECISION,
  checkout_face_ok BOOLEAN,
  checkout_distance_m DOUBLE PRECISION,
  actual_minutes  INTEGER,
  ot_minutes      INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE swap_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id        INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  requester_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requester_shift UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  receiver_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  receiver_shift  UUID REFERENCES shifts(id) ON DELETE SET NULL,
  status          swap_status NOT NULL DEFAULT 'pending',
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

CREATE TABLE leaves (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days_count    INTEGER NOT NULL,
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

CREATE TABLE payroll (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id              INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  month                 SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                  SMALLINT NOT NULL CHECK (year >= 2024),
  base_hours            INTEGER NOT NULL DEFAULT 0,
  ot_hours              INTEGER NOT NULL DEFAULT 0,
  base_pay_vnd          BIGINT NOT NULL DEFAULT 0,
  ot_pay_vnd            BIGINT NOT NULL DEFAULT 0,
  deductions_vnd        BIGINT NOT NULL DEFAULT 0,
  allowances_vnd        BIGINT NOT NULL DEFAULT 0,
  total_vnd             BIGINT NOT NULL,
  status                payroll_status NOT NULL DEFAULT 'draft',
  notes                 TEXT,
  finalized_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_unique_period UNIQUE (user_id, month, year)
);

CREATE INDEX idx_payroll_store ON payroll(store_id);
CREATE INDEX idx_payroll_user ON payroll(user_id);
CREATE INDEX idx_payroll_period ON payroll(store_id, year, month);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
