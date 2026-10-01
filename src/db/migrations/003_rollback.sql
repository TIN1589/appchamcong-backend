-- Rollback Migration 003
DROP VIEW IF EXISTS shift_assignments;
DROP INDEX IF EXISTS uq_assignment_user_day_shift;

ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_source_check;
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
ALTER TABLE shifts DROP COLUMN IF EXISTS source;

-- Khôi phục status về enum shift_status
ALTER TABLE shifts ALTER COLUMN status DROP DEFAULT;
UPDATE shifts SET status = 'assigned' WHERE status = 'scheduled' OR status = 'leave_approved' OR status = 'swapped_out';
ALTER TABLE shifts ALTER COLUMN status TYPE shift_status USING status::shift_status;
ALTER TABLE shifts ALTER COLUMN status SET DEFAULT 'open';

DROP TABLE IF EXISTS staff_default_shifts;
