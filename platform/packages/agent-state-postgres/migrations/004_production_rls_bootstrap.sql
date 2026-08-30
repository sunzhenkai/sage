-- RLS 引导层：sage_security schema、请求上下文函数与最小角色集。
-- 必须先于所有在表策略中引用 sage_security.current_tenant_id() 的迁移（005+）执行；
-- 006_production_rls_roles.sql 保留同段幂等引导并施加逐表策略，本文件只承载引导本身。
BEGIN;
CREATE SCHEMA IF NOT EXISTS sage_security;
CREATE OR REPLACE FUNCTION sage_security.current_tenant_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('sage.tenant_id',true),'') $$;
CREATE OR REPLACE FUNCTION sage_security.current_principal_ref() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('sage.principal_ref',true),'') $$;
CREATE OR REPLACE FUNCTION sage_security.set_request_context(p_tenant text,p_principal text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN IF p_tenant IS NULL OR length(trim(p_tenant))=0 OR p_principal IS NULL OR length(trim(p_principal))=0 THEN RAISE EXCEPTION 'INVALID_SECURITY_CONTEXT'; END IF;
 PERFORM set_config('sage.tenant_id',p_tenant,true); PERFORM set_config('sage.principal_ref',p_principal,true); END $$;
REVOKE ALL ON FUNCTION sage_security.set_request_context(text,text) FROM PUBLIC;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_application') THEN CREATE ROLE sage_agent_application NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_reconciler') THEN CREATE ROLE sage_agent_reconciler NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_migration') THEN CREATE ROLE sage_agent_migration NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='sage_agent_break_glass') THEN CREATE ROLE sage_agent_break_glass NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
END $$;
COMMIT;
