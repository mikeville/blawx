-- Owner-facing dashboard projection. Preserve future-dated test fixtures in
-- the audit view, but keep them out of the normal monitoring surface.

create view blawx_private.monitoring_dashboard
with (security_invoker = true)
as
select *
from blawx_private.monitoring_daily
where utc_day <= (clock_timestamp() at time zone 'UTC')::date;

revoke all on table blawx_private.monitoring_dashboard
  from public, anon, authenticated, service_role;

comment on view blawx_private.monitoring_dashboard is
  'Owner-only launch dashboard for real current and historical days; future-dated test fixtures stay in monitoring_daily only.';
