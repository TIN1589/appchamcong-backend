-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 001 Rollback
-- Version: 001
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop triggers
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'stores','users','shift_templates','shifts',
    'attendances','swap_requests','leaves','payroll'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS set_updated_at();

-- Drop tables theo thứ tự ngược (FK dependencies)
DROP TABLE IF EXISTS payroll;
DROP TABLE IF EXISTS leaves;
DROP TABLE IF EXISTS swap_requests;
DROP TABLE IF EXISTS attendances;
DROP TABLE IF EXISTS shift_segments;
DROP TABLE IF EXISTS shifts;
DROP TABLE IF EXISTS shift_template_segments;
DROP TABLE IF EXISTS shift_templates;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS stores;

-- Drop types
DROP TYPE IF EXISTS payroll_status;
DROP TYPE IF EXISTS leave_status;
DROP TYPE IF EXISTS swap_status;
DROP TYPE IF EXISTS attendance_status;
DROP TYPE IF EXISTS shift_status;
DROP TYPE IF EXISTS user_role;

COMMIT;
