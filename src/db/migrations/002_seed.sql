-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002: Seed Data
-- 1 Admin + 3 Staff demo + 1 Store + shift templates + demo shifts
-- Password hash: bcrypt("Admin@1234!", cost=12) — THAY ĐỔI KHI PRODUCTION
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Store mặc định ────────────────────────────────────────────────────────
INSERT INTO stores (id, name, address, lat, lng, radius_m)
VALUES (
  1,
  'Quán Demo F&B',
  '123 Nguyễn Huệ, Quận 1, TP.HCM',
  10.7769,   -- lat Bến Nhà Rồng (demo)
  106.7009,  -- lng
  50
) ON CONFLICT DO NOTHING;

-- ── Admin user ───────────────────────────────────────────────────────────
-- Password: Admin@1234! (bcrypt cost=12)
-- must_change_password = TRUE — bắt đổi password lần đầu [10-backend.md]
INSERT INTO users (
  id, store_id, email, password_hash, role, full_name, phone,
  hourly_rate, leave_balance, must_change_password
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  1,
  'admin@chamcong.local',
  -- Hash này được tạo bằng: bcrypt.hashSync('Admin@1234!', 12)
  -- Chạy script: node scripts/gen-hash.js để tạo hash mới
  '$2b$12$placeholder_hash_will_be_replaced_by_migration_script',
  'admin',
  'Quản lý',
  '0900000000',
  50000,  -- 50,000 đ/giờ
  12,
  TRUE
) ON CONFLICT (store_id, email) DO NOTHING;

-- ── Staff demo ────────────────────────────────────────────────────────────
INSERT INTO users (
  id, store_id, email, password_hash, role, full_name, phone,
  hourly_rate, leave_balance, must_change_password
)
VALUES
  (
    '00000000-0000-0000-0000-000000000002',
    1, 'nguyen.an@chamcong.local',
    '$2b$12$placeholder_hash_will_be_replaced_by_migration_script',
    'staff', 'Nguyễn Văn An', '0911111111', 30000, 12, TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    1, 'tran.binh@chamcong.local',
    '$2b$12$placeholder_hash_will_be_replaced_by_migration_script',
    'staff', 'Trần Thị Bình', '0922222222', 30000, 12, TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    1, 'le.cuong@chamcong.local',
    '$2b$12$placeholder_hash_will_be_replaced_by_migration_script',
    'staff', 'Lê Văn Cường', '0933333333', 30000, 10, TRUE
  )
ON CONFLICT (store_id, email) DO NOTHING;

-- ── Shift Templates ──────────────────────────────────────────────────────
INSERT INTO shift_templates (id, store_id, name, color, created_by)
VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    1, 'Ca sáng', '#6C4CF1',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000002',
    1, 'Ca chiều', '#4F6BFF',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000003',
    1, 'Ca tối', '#2CA7FF',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    'aaaaaaaa-0000-0000-0000-000000000004',
    1, 'Ca gãy (trưa-tối)', '#FF6FA8',
    '00000000-0000-0000-0000-000000000001'
  )
ON CONFLICT (store_id, name) DO NOTHING;

-- Segments cho từng template
INSERT INTO shift_template_segments (template_id, start_time, end_time, sort_order)
VALUES
  -- Ca sáng: 07:00-12:00
  ('aaaaaaaa-0000-0000-0000-000000000001', '07:00', '12:00', 0),
  -- Ca chiều: 12:00-17:00
  ('aaaaaaaa-0000-0000-0000-000000000002', '12:00', '17:00', 0),
  -- Ca tối: 17:00-22:00
  ('aaaaaaaa-0000-0000-0000-000000000003', '17:00', '22:00', 0),
  -- Ca gãy: 10:00-14:00 & 17:00-22:00 [A6]
  ('aaaaaaaa-0000-0000-0000-000000000004', '10:00', '14:00', 0),
  ('aaaaaaaa-0000-0000-0000-000000000004', '17:00', '22:00', 1);

COMMIT;
