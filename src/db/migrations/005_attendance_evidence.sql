-- Migration 005: Bổ sung cấu hình cửa hàng và evidence kiểm toán chấm công chống gian lận
BEGIN;

-- 1. Bổ sung cấu hình chấm công vào bảng stores
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS max_gps_accuracy_m INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS checkin_window_before_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS wifi_ip_allowlist TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_max_gps_accuracy_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_max_gps_accuracy_check CHECK (max_gps_accuracy_m > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_grace_period_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_grace_period_check CHECK (grace_period_minutes >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stores_checkin_window_check') THEN
    ALTER TABLE stores ADD CONSTRAINT stores_checkin_window_check CHECK (checkin_window_before_minutes >= 0);
  END IF;
END;
$$;

-- Cập nhật store mặc định
UPDATE stores
SET
  max_gps_accuracy_m = COALESCE(max_gps_accuracy_m, 100),
  grace_period_minutes = COALESCE(grace_period_minutes, 5),
  checkin_window_before_minutes = COALESCE(checkin_window_before_minutes, 30),
  wifi_ip_allowlist = COALESCE(wifi_ip_allowlist, '{}')
WHERE id = 1;

-- 2. Bổ sung evidence và audit trail vào bảng attendances
ALTER TABLE attendances
  ADD COLUMN IF NOT EXISTS gps_accuracy_m DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS ip VARCHAR(45),
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS original_checkin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_checkout_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_source_check') THEN
    ALTER TABLE attendances ADD CONSTRAINT attendances_source_check CHECK (source IN ('self', 'adjustment'));
  END IF;
END;
$$;

-- Indexes phục vụ tra cứu audit và danh sách vi phạm/flagged
CREATE INDEX IF NOT EXISTS idx_attendances_flagged ON attendances(store_id, flagged);
CREATE INDEX IF NOT EXISTS idx_attendances_source ON attendances(source);

COMMIT;
