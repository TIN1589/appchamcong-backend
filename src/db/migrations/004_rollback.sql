-- Rollback Migration 004
BEGIN;

ALTER TABLE shift_segments DROP CONSTRAINT IF EXISTS uq_shift_segments_time;
ALTER TABLE shift_template_segments DROP CONSTRAINT IF EXISTS uq_shift_template_segments_time;
ALTER TABLE shifts DROP CONSTRAINT IF EXISTS shifts_shift_type_check;
ALTER TABLE shifts DROP COLUMN IF EXISTS shift_type;
ALTER TABLE shift_templates DROP CONSTRAINT IF EXISTS shift_templates_shift_type_check;
ALTER TABLE shift_templates DROP COLUMN IF EXISTS shift_type;

COMMIT;
