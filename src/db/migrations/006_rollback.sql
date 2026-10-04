-- Rollback Migration 006

BEGIN;

DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversation_members CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;

DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS store_networks CASCADE;

ALTER TABLE swap_requests
  DROP CONSTRAINT IF EXISTS swap_requests_type_check,
  DROP COLUMN IF EXISTS type,
  DROP COLUMN IF EXISTS expires_at,
  DROP COLUMN IF EXISTS claimed_at;

ALTER TABLE users
  DROP COLUMN IF EXISTS face_enrolled_consent_at;

ALTER TABLE attendances
  DROP COLUMN IF EXISTS flags,
  DROP COLUMN IF EXISTS needs_review;

COMMIT;
