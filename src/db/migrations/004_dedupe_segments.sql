-- Migration 004: Deduplicate shift segments, add UNIQUE constraints, explicit shift_type
BEGIN;

-- 1. Thêm cột shift_type trên shift_templates và shifts
ALTER TABLE shift_templates
  ADD COLUMN IF NOT EXISTS shift_type TEXT NOT NULL DEFAULT 'REGULAR';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_templates_shift_type_check') THEN
    ALTER TABLE shift_templates
      ADD CONSTRAINT shift_templates_shift_type_check
      CHECK (shift_type IN ('REGULAR', 'SPLIT', 'FLEXIBLE'));
  END IF;
END;
$$;

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS shift_type TEXT NOT NULL DEFAULT 'REGULAR';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shifts_shift_type_check') THEN
    ALTER TABLE shifts
      ADD CONSTRAINT shifts_shift_type_check
      CHECK (shift_type IN ('REGULAR', 'SPLIT', 'FLEXIBLE'));
  END IF;
END;
$$;

-- 2. Backfill shift_type theo tên ca hiện hữu
UPDATE shift_templates
SET shift_type = 'SPLIT'
WHERE name ILIKE '%gãy%' OR name ILIKE '%gay%';

UPDATE shift_templates
SET shift_type = 'FLEXIBLE'
WHERE name ILIKE '%linh hoạt%' OR name ILIKE '%linh hoat%';

UPDATE shifts s
SET shift_type = t.shift_type
FROM shift_templates t
WHERE s.template_id = t.id;

-- 3. Deduplicate shift_template_segments (giữ 1 bản ghi có ctid lớn nhất)
DELETE FROM shift_template_segments a
USING shift_template_segments b
WHERE a.ctid < b.ctid
  AND a.template_id = b.template_id
  AND a.start_time = b.start_time
  AND a.end_time = b.end_time;

-- 4. Unique constraint trên shift_template_segments
ALTER TABLE shift_template_segments
  DROP CONSTRAINT IF EXISTS uq_shift_template_segments_time;

ALTER TABLE shift_template_segments
  ADD CONSTRAINT uq_shift_template_segments_time
  UNIQUE (template_id, start_time, end_time);

-- 5. Deduplicate shift_segments (giữ 1 bản ghi có ctid lớn nhất)
DELETE FROM shift_segments a
USING shift_segments b
WHERE a.ctid < b.ctid
  AND a.shift_id = b.shift_id
  AND a.starts_at = b.starts_at
  AND a.ends_at = b.ends_at;

-- 6. Unique constraint trên shift_segments
ALTER TABLE shift_segments
  DROP CONSTRAINT IF EXISTS uq_shift_segments_time;

ALTER TABLE shift_segments
  ADD CONSTRAINT uq_shift_segments_time
  UNIQUE (shift_id, starts_at, ends_at);

COMMIT;
