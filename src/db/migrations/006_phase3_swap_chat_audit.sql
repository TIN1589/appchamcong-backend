-- Migration 006: Schema cho Phase 3 (Đổi ca, Chợ ca, Realtime Chat, Audit Log & Cờ an ninh)
-- Tuân thủ [A1] trong 00-project-context.md:
-- 1. conversations, conversation_members, messages: Phục vụ tính năng Chat 1-1 và Group Chat toàn cửa hàng.
-- 2. audit_log: Bảng kiểm toán an ninh bắt buộc theo rule security.md §6.
-- 3. store_networks: Quản lý IP tin cậy bằng kiểu CIDR của Postgres theo rule security.md §4.
-- 4. Hoàn thiện swap_requests: Hỗ trợ Shift Pool (Chợ ca) và đổi ca 1-1.
-- 5. Bổ sung cờ attendances (flags TEXT[], needs_review BOOLEAN) theo rule security.md §5.1.
-- 6. Bổ sung face_enrolled_consent_at vào users theo rule security.md §5.2.

BEGIN;

-- 1. CẬP NHẬT BẢNG ATTENDANCES: CỜ AN NINH & CẦN DUYỆT (security.md §5.1)
ALTER TABLE attendances
  ADD COLUMN IF NOT EXISTS flags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_attendances_needs_review ON attendances(store_id, needs_review);

-- 2. CẬP NHẬT BẢNG USERS: CONSENT SINH TRẮC HỌC (security.md §5.2)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS face_enrolled_consent_at TIMESTAMPTZ;

-- 3. BẢNG MẠNG TIN CẬY STORE_NETWORKS (security.md §4)
CREATE TABLE IF NOT EXISTS store_networks (
  id          SERIAL PRIMARY KEY,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  cidr        CIDR NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_networks_lookup ON store_networks(store_id, is_active);

DROP TRIGGER IF EXISTS trg_store_networks_updated_at ON store_networks;
CREATE TRIGGER trg_store_networks_updated_at
  BEFORE UPDATE ON store_networks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. BẢNG AUDIT LOG (security.md §6)
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- 5. CẬP NHẬT BẢNG SWAP_REQUESTS (Hỗ trợ Shift Pool và Đổi ca 1-1)
ALTER TABLE swap_requests
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'swap',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swap_requests_type_check') THEN
    ALTER TABLE swap_requests ADD CONSTRAINT swap_requests_type_check CHECK (type IN ('swap', 'pool'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_swap_requests_type_status ON swap_requests(store_id, type, status);
CREATE INDEX IF NOT EXISTS idx_swap_requests_receiver ON swap_requests(receiver_id, status);

-- 6. BẢNG HỘI THOẠI & TIN NHẮN REALTIME CHAT (conversations, conversation_members, messages) [A1]
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  type        VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'store_group')),
  name        VARCHAR(100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_store ON conversations(store_id, type);

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at    TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

COMMIT;
