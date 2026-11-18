-- ===========================================================================
-- Cash Flow 13 — database-enforced company separation (same design as
-- best-books/backend/prisma/sql/01_security.sql).
--
--   1. The API connects as cf13_app: not the owner, no BYPASSRLS.
--   2. Every company table has FORCE ROW LEVEL SECURITY keyed on
--      app.tenant_id, set per transaction by the API (set_config(..., true)).
--   3. A query with no company set FAILS instead of returning everything.
--   4. The audit trail is append-only.
--
-- Run with the owner connection after `prisma migrate deploy`. Idempotent.
-- ===========================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cf13_app') THEN CREATE ROLE cf13_app LOGIN; END IF;
END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO cf13_app', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO cf13_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cf13_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cf13_app;
REVOKE CREATE ON SCHEMA public FROM cf13_app;
REVOKE ALL ON _prisma_migrations FROM cf13_app;

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
  v := current_setting('app.tenant_id', true);
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'app.tenant_id is not set: refusing to run an unscoped query' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v::uuid;
END $$;

CREATE OR REPLACE FUNCTION apply_tenant_rls(tbl regclass, col text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (%I = current_tenant_id()) WITH CHECK (%I = current_tenant_id())', tbl, col, col);
END $$;

SELECT apply_tenant_rls('tenants', 'id');
SELECT apply_tenant_rls('memberships', 'tenant_id');
SELECT apply_tenant_rls('branding', 'tenant_id');
SELECT apply_tenant_rls('plans', 'tenant_id');
SELECT apply_tenant_rls('audit', 'tenant_id');
SELECT apply_tenant_rls('api_keys', 'tenant_id');
SELECT apply_tenant_rls('invitations', 'tenant_id');
SELECT apply_tenant_rls('budget_settings', 'tenant_id');
SELECT apply_tenant_rls('budget_cycles', 'tenant_id');
SELECT apply_tenant_rls('budget_submissions', 'tenant_id');
SELECT apply_tenant_rls('budget_actuals', 'tenant_id');

-- Sign-in happens before a company is chosen: this is the one way to learn
-- which companies an account belongs to. It returns only that account's rows.
CREATE OR REPLACE FUNCTION account_memberships(acc uuid)
RETURNS TABLE (tenant_id uuid, slug text, name text, name_ar text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name, t.name_ar, m.role
  FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.account_id = acc AND t.status <> 'closed'
  ORDER BY t.created_at
$$;
REVOKE ALL ON FUNCTION account_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_memberships(uuid) TO cf13_app;

-- A company slug must be unique across all companies, which no company may see.
CREATE OR REPLACE FUNCTION slug_taken(s text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE slug = s)
$$;
REVOKE ALL ON FUNCTION slug_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION slug_taken(text) TO cf13_app;

-- An API key arrives before any company is known. This is the one way to resolve it, and it answers only for the exact hash.
CREATE OR REPLACE FUNCTION api_key_lookup(h text)
RETURNS TABLE (id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.tenant_id FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
  WHERE k.hash = h AND k.revoked_at IS NULL AND k.expires_at > now() AND t.status <> 'closed'
$$;
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO cf13_app;

-- An invitation link arrives before any company is chosen. Resolves only the exact token hash, only while still open.
-- (the department column was added later: the return type changed, so the old function is dropped first)
DROP FUNCTION IF EXISTS invite_lookup(text);
CREATE OR REPLACE FUNCTION invite_lookup(h text)
RETURNS TABLE (id uuid, tenant_id uuid, email text, role text, tenant_name text, department text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.tenant_id, i.email, i.role, t.name, i.department FROM invitations i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token_hash = h AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() AND t.status <> 'closed'
$$;
REVOKE ALL ON FUNCTION invite_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invite_lookup(text) TO cf13_app;

CREATE OR REPLACE FUNCTION audit_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'the audit trail cannot be changed or deleted' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS audit_append_only ON audit;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();
