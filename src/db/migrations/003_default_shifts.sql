-- Migration 003: Ca mặc định (Default Rostering) và Ràng buộc Phân công Ca (§1 SRS v1.1 Delta)
-- 1. Bảng cấu hình ca mặc định theo thứ trong tuần của nhân viên
CREATE TABLE IF NOT EXISTS staff_default_shifts (
  id                 SERIAL PRIMARY KEY,
  store_id           INTEGER NOT NULL DEFAULT 1 REFERENCES stores(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday            SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  shift_template_id  UUID NOT NULL REFERENCES shift_templates(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_staff_default_shifts UNIQUE (user_id, weekday, shift_template_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_default_shifts_user ON staff_default_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_default_shifts_store ON staff_default_shifts(store_id);

DROP TRIGGER IF EXISTS trg_staff_default_shifts_updated_at ON staff_default_shifts;
CREATE TRIGGER trg_staff_default_shifts_updated_at
  BEFORE UPDATE ON staff_default_shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 2. Bổ sung cột source và chuẩn hóa status trên bảng phân ca (shifts)
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_source_check') THEN
    ALTER TABLE shifts ADD CONSTRAINT shifts_source_check CHECK (source IN ('default', 'manual', 'swap'));
  END IF;
END;
$$;

-- Mở rộng status hỗ trợ các trạng thái mới: scheduled, leave_approved, swapped_out
ALTER TABLE shifts ALTER COLUMN status TYPE TEXT;
ALTER TABLE shifts ALTER COLUMN status SET DEFAULT 'scheduled';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_status_check') THEN
    ALTER TABLE shifts ADD CONSTRAINT shifts_status_check
      CHECK (status IN ('open', 'assigned', 'scheduled', 'leave_approved', 'swapped_out', 'completed', 'cancelled'));
  END IF;
END;
$$;

-- 3. Backfill dữ liệu cũ: ca đã phân công chuyển về source = 'manual', status = 'scheduled'
UPDATE shifts
SET source = 'manual', status = 'scheduled'
WHERE status = 'assigned' OR (assigned_to IS NOT NULL AND status NOT IN ('completed', 'cancelled'));

-- 4. Unique index ngăn trùng lặp ca cùng ngày cho 1 nhân viên theo template
CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_user_day_shift
  ON shifts (assigned_to, work_date, template_id)
  WHERE assigned_to IS NOT NULL AND template_id IS NOT NULL;

-- 5. View shift_assignments tương thích đặc tả DDL
CREATE OR REPLACE VIEW shift_assignments AS
  SELECT
    id,
    store_id,
    template_id AS shift_template_id,
    assigned_to AS user_id,
    status,
    work_date,
    notes,
    source,
    created_by,
    created_at,
    updated_at
  FROM shifts;
