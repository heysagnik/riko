-- Row-level security: every tenant-scoped table carries a policy that only
-- admits rows where app.tenant_id (set per-transaction via withTenant)
-- matches tenant_id. Tenant id is the better-auth organization id (text),
-- so no uuid cast here. The better-auth-owned tables (user, session,
-- account, verification, organization, member, invitation) are written by
-- better-auth's own connection, outside withTenant, and are intentionally
-- not RLS-scoped here.
--
-- FORCE ROW LEVEL SECURITY is deliberately not applied: this app currently
-- runs API and worker through a single Postgres role, and the worker's
-- polling jobs scan cases across all tenants by design. FORCE would block
-- that role entirely (RLS applies to the table owner too under FORCE)
-- unless a second, restricted role is provisioned for the API and given
-- non-owner grants. Until that role split exists, RLS + policy here is
-- defense-in-depth; the real enforcement is the explicit tenantId filter
-- present on every query.
do $$
declare
  t text;
begin
  foreach t in array array[
    'connections', 'sender_identities', 'customers', 'payments',
    'cases', 'case_events', 'agent_actions', 'outreach'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.tenant_id'', true)) with check (tenant_id = current_setting(''app.tenant_id'', true))',
      t
    );
  end loop;
end $$;
