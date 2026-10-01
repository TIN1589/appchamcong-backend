-- 1. DROP TRIGGERS VÀ BẢNG adjustment_requests
DROP TRIGGER IF EXISTS trg_adjustment_requests_updated_at ON adjustment_requests;
DROP TABLE IF EXISTS adjustment_requests;
DROP TYPE IF EXISTS adjustment_status;
DROP TYPE IF EXISTS adjustment_type;

-- 2. DROP TRIGGERS VÀ BẢNG face_templates
DROP TRIGGER IF EXISTS trg_face_templates_updated_at ON face_templates;
DROP TABLE IF EXISTS face_templates;

-- 3. HOÀN NGUYÊN BẢNG attendances
DROP INDEX IF EXISTS idx_attendances_user_checkin;
DROP INDEX IF EXISTS idx_attendances_store_checkin;
DROP INDEX IF EXISTS idx_attendances_shift_user;
DROP INDEX IF EXISTS idx_attendances_segment;

ALTER TABLE attendances DROP CONSTRAINT IF EXISTS attendances_segment_user_unique;
ALTER TABLE attendances DROP COLUMN IF EXISTS early_leave_minutes;
ALTER TABLE attendances DROP COLUMN IF EXISTS late_minutes;
ALTER TABLE attendances DROP COLUMN IF EXISTS checkout_face_distance;
ALTER TABLE attendances DROP COLUMN IF EXISTS checkin_face_distance;
ALTER TABLE attendances DROP COLUMN IF EXISTS segment_id;

-- Khôi phục ràng buộc unique cũ theo shift_id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_shift_user_unique') THEN
    ALTER TABLE attendances ADD CONSTRAINT attendances_shift_user_unique UNIQUE (shift_id, user_id);
  END IF;
END;
$$;

-- 4. HOÀN NGUYÊN BẢNG stores
ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_radius_positive;
