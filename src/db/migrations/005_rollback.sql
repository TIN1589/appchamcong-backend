-- Rollback Migration 005
BEGIN;

DROP INDEX IF EXISTS idx_attendances_source;
DROP INDEX IF EXISTS idx_attendances_flagged;

ALTER TABLE attendances
  DROP CONSTRAINT IF EXISTS attendances_source_check,
  DROP COLUMN IF EXISTS original_checkout_at,
  DROP COLUMN IF EXISTS original_checkin_at,
  DROP COLUMN IF EXISTS flagged,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS ip,
  DROP COLUMN IF EXISTS gps_accuracy_m;

ALTER TABLE stores
  DROP CONSTRAINT IF EXISTS stores_checkin_window_check,
  DROP CONSTRAINT IF EXISTS stores_grace_period_check,
  DROP CONSTRAINT IF EXISTS stores_max_gps_accuracy_check,
  DROP COLUMN IF EXISTS wifi_ip_allowlist,
  DROP COLUMN IF EXISTS checkin_window_before_minutes,
  DROP COLUMN IF EXISTS grace_period_minutes,
  DROP COLUMN IF EXISTS max_gps_accuracy_m;

COMMIT;
