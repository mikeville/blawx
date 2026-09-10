-- Anonymous request monitoring for public launch.
--
-- Only hourly decision counts are retained. No prompt, IP address, connection
-- hash, user agent, request ID, or other visitor-level value is stored here.

create table blawx_private.request_event_rollups (
  utc_hour timestamptz not null,
  event_kind text not null check (event_kind in (
    'generation_disabled',
    'daily_attempt_limit',
    'daily_spend_limit',
    'monthly_spend_limit',
    'concurrency_limit',
    'idempotency_conflict',
    'already_finalized'
  )),
  event_count bigint not null default 1 check (event_count > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (utc_hour, event_kind)
);

alter table blawx_private.request_event_rollups enable row level security;
revoke all on table blawx_private.request_event_rollups
  from public, anon, authenticated, service_role;

create or replace function blawx_private.increment_request_event(
  p_event_kind text,
  p_now timestamptz
)
returns void
language sql
set search_path = ''
set statement_timeout = '2s'
as $$
  insert into blawx_private.request_event_rollups (
    utc_hour,
    event_kind,
    event_count,
    updated_at
  )
  values (
    date_trunc('hour', p_now, 'UTC'),
    p_event_kind,
    1,
    p_now
  )
  on conflict (utc_hour, event_kind) do update
  set event_count = blawx_private.request_event_rollups.event_count + 1,
      updated_at = excluded.updated_at;
$$;

revoke all on function blawx_private.increment_request_event(text, timestamptz)
  from public, anon, authenticated, service_role;

-- Preserve the existing reservation contract while recording every rejected
-- decision in the same transaction that makes it. Existing attempt and spend
-- rows remain the source of truth for admitted/provider requests and cost.
create or replace function public.blawx_reserve_generation(
  p_request_id uuid,
  p_connection_hash bytea,
  p_now timestamptz default clock_timestamp()
)
returns table (
  accepted boolean,
  decision text,
  reservation_id uuid,
  reservation_state text,
  attempts_used integer,
  attempts_remaining integer,
  reserved_micros bigint,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_config blawx_private.launch_config%rowtype;
  v_attempt blawx_private.generation_attempts%rowtype;
  v_expired blawx_private.generation_attempts%rowtype;
  v_usage integer := 0;
  v_active integer := 0;
  v_day date;
  v_month date;
  v_day_spend blawx_private.period_spend%rowtype;
  v_month_spend blawx_private.period_spend%rowtype;
begin
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  if p_now is null then
    raise exception 'now_required' using errcode = '22023';
  end if;

  if p_connection_hash is null or octet_length(p_connection_hash) <> 32 then
    raise exception 'connection_hash_must_be_32_bytes' using errcode = '22023';
  end if;

  v_day := (p_now at time zone 'utc')::date;
  v_month := date_trunc('month', p_now at time zone 'utc')::date;

  select *
  into v_config
  from blawx_private.launch_config
  where singleton = true
  for update;

  if not found then
    raise exception 'launch_config_missing' using errcode = '55000';
  end if;

  for v_expired in
    select attempts.*
    from blawx_private.generation_attempts as attempts
    where attempts.state = 'reserved'
      and attempts.lease_expires_at <= p_now
    order by attempts.created_at, attempts.request_id
    for update
  loop
    update blawx_private.period_spend as spend
    set reserved_micros = spend.reserved_micros - v_expired.reserved_micros,
        actual_micros = spend.actual_micros + v_expired.reserved_micros,
        updated_at = p_now
    where (spend.period_kind = 'day' and spend.period_start = v_expired.utc_day)
       or (spend.period_kind = 'month' and spend.period_start = v_expired.utc_month);

    update blawx_private.generation_attempts as attempts
    set state = 'unknown',
        actual_micros = attempts.reserved_micros,
        failure_code = 'lease_expired',
        finalized_at = p_now,
        updated_at = p_now
    where attempts.request_id = v_expired.request_id;
  end loop;

  select *
  into v_attempt
  from blawx_private.generation_attempts as attempts
  where attempts.request_id = p_request_id;

  if found then
    select coalesce(attempt_count, 0)
    into v_usage
    from blawx_private.connection_daily_usage
    where connection_hash = p_connection_hash
      and utc_day = v_day;

    if v_attempt.connection_hash <> p_connection_hash then
      perform blawx_private.increment_request_event('idempotency_conflict', p_now);
      return query select
        false,
        'idempotency_conflict'::text,
        p_request_id,
        v_attempt.state,
        v_usage,
        greatest(v_config.daily_attempt_limit - v_usage, 0),
        v_attempt.reserved_micros,
        v_attempt.lease_expires_at;
      return;
    end if;

    if not (v_attempt.state = 'reserved' and v_attempt.lease_expires_at > p_now) then
      perform blawx_private.increment_request_event('already_finalized', p_now);
    end if;
    return query select
      (v_attempt.state = 'reserved' and v_attempt.lease_expires_at > p_now),
      case
        when v_attempt.state = 'reserved' and v_attempt.lease_expires_at > p_now
          then 'already_reserved'
        else 'already_finalized'
      end,
      p_request_id,
      v_attempt.state,
      v_usage,
      greatest(v_config.daily_attempt_limit - v_usage, 0),
      v_attempt.reserved_micros,
      v_attempt.lease_expires_at;
    return;
  end if;

  if not v_config.generation_enabled then
    perform blawx_private.increment_request_event('generation_disabled', p_now);
    return query select
      false,
      'generation_disabled'::text,
      p_request_id,
      null::text,
      0,
      v_config.daily_attempt_limit::integer,
      v_config.request_reserve_micros,
      null::timestamptz;
    return;
  end if;

  insert into blawx_private.connection_daily_usage (
    connection_hash,
    utc_day,
    attempt_count,
    updated_at
  )
  values (p_connection_hash, v_day, 0, p_now)
  on conflict (connection_hash, utc_day) do nothing;

  select attempt_count
  into v_usage
  from blawx_private.connection_daily_usage
  where connection_hash = p_connection_hash
    and utc_day = v_day
  for update;

  if v_usage >= v_config.daily_attempt_limit then
    perform blawx_private.increment_request_event('daily_attempt_limit', p_now);
    return query select
      false,
      'daily_attempt_limit'::text,
      p_request_id,
      null::text,
      v_usage,
      0,
      v_config.request_reserve_micros,
      null::timestamptz;
    return;
  end if;

  insert into blawx_private.period_spend (period_kind, period_start, updated_at)
  values ('day', v_day, p_now), ('month', v_month, p_now)
  on conflict (period_kind, period_start) do nothing;

  perform 1
  from blawx_private.period_spend
  where (period_kind = 'day' and period_start = v_day)
     or (period_kind = 'month' and period_start = v_month)
  order by period_kind, period_start
  for update;

  select *
  into v_day_spend
  from blawx_private.period_spend
  where period_kind = 'day' and period_start = v_day;

  select *
  into v_month_spend
  from blawx_private.period_spend
  where period_kind = 'month' and period_start = v_month;

  if v_day_spend.actual_micros
       + v_day_spend.reserved_micros
       + v_config.request_reserve_micros
       > v_config.daily_cap_micros then
    perform blawx_private.increment_request_event('daily_spend_limit', p_now);
    return query select
      false,
      'daily_spend_limit'::text,
      p_request_id,
      null::text,
      v_usage,
      greatest(v_config.daily_attempt_limit - v_usage, 0),
      v_config.request_reserve_micros,
      null::timestamptz;
    return;
  end if;

  if v_month_spend.actual_micros
       + v_month_spend.reserved_micros
       + v_config.request_reserve_micros
       > v_config.monthly_cap_micros then
    perform blawx_private.increment_request_event('monthly_spend_limit', p_now);
    return query select
      false,
      'monthly_spend_limit'::text,
      p_request_id,
      null::text,
      v_usage,
      greatest(v_config.daily_attempt_limit - v_usage, 0),
      v_config.request_reserve_micros,
      null::timestamptz;
    return;
  end if;

  select count(*)::integer
  into v_active
  from blawx_private.generation_attempts as attempts
  where attempts.state = 'reserved'
    and attempts.lease_expires_at > p_now;

  if v_active >= v_config.concurrency_limit then
    perform blawx_private.increment_request_event('concurrency_limit', p_now);
    return query select
      false,
      'concurrency_limit'::text,
      p_request_id,
      null::text,
      v_usage,
      greatest(v_config.daily_attempt_limit - v_usage, 0),
      v_config.request_reserve_micros,
      null::timestamptz;
    return;
  end if;

  update blawx_private.connection_daily_usage
  set attempt_count = attempt_count + 1,
      updated_at = p_now
  where connection_hash = p_connection_hash
    and utc_day = v_day
  returning attempt_count into v_usage;

  update blawx_private.period_spend as spend
  set reserved_micros = spend.reserved_micros + v_config.request_reserve_micros,
      updated_at = p_now
  where (spend.period_kind = 'day' and spend.period_start = v_day)
     or (spend.period_kind = 'month' and spend.period_start = v_month);

  insert into blawx_private.generation_attempts (
    request_id,
    connection_hash,
    utc_day,
    utc_month,
    reserved_micros,
    lease_expires_at,
    created_at,
    updated_at
  )
  values (
    p_request_id,
    p_connection_hash,
    v_day,
    v_month,
    v_config.request_reserve_micros,
    p_now + make_interval(secs => v_config.lease_seconds),
    p_now,
    p_now
  )
  returning * into v_attempt;

  return query select
    true,
    'reserved'::text,
    p_request_id,
    v_attempt.state,
    v_usage,
    greatest(v_config.daily_attempt_limit - v_usage, 0),
    v_attempt.reserved_micros,
    v_attempt.lease_expires_at;
end;
$$;

revoke all on function public.blawx_reserve_generation(uuid, bytea, timestamptz)
  from public, anon, authenticated;
grant execute on function public.blawx_reserve_generation(uuid, bytea, timestamptz)
  to service_role;

create view blawx_private.monitoring_daily
with (security_invoker = true)
as
with days as (
  select attempts.utc_day
  from blawx_private.generation_attempts as attempts
  union
  select (events.utc_hour at time zone 'UTC')::date
  from blawx_private.request_event_rollups as events
  union
  select spend.period_start
  from blawx_private.period_spend as spend
  where spend.period_kind = 'day'
),
attempt_metrics as (
  select
    attempts.utc_day,
    count(*)::bigint as admitted_requests,
    count(*) filter (where attempts.provider_started_at is not null)::bigint as provider_requests,
    count(*) filter (where attempts.state = 'succeeded')::bigint as succeeded_requests,
    count(*) filter (where attempts.state = 'failed')::bigint as failed_requests,
    count(*) filter (where attempts.state = 'unknown')::bigint as unknown_requests,
    count(*) filter (where attempts.state = 'cancelled')::bigint as cancelled_before_provider
  from blawx_private.generation_attempts as attempts
  group by attempts.utc_day
),
event_metrics as (
  select
    (events.utc_hour at time zone 'UTC')::date as utc_day,
    coalesce(sum(events.event_count) filter (
      where events.event_kind in (
        'generation_disabled',
        'daily_attempt_limit',
        'daily_spend_limit',
        'monthly_spend_limit',
        'concurrency_limit'
      )
    ), 0)::bigint as gated_requests,
    coalesce(sum(events.event_count) filter (
      where events.event_kind = 'daily_attempt_limit'
    ), 0)::bigint as daily_rate_limited_requests,
    coalesce(sum(events.event_count) filter (
      where events.event_kind in ('daily_spend_limit', 'monthly_spend_limit')
    ), 0)::bigint as budget_gated_requests,
    coalesce(sum(events.event_count) filter (
      where events.event_kind = 'concurrency_limit'
    ), 0)::bigint as concurrency_gated_requests,
    coalesce(sum(events.event_count) filter (
      where events.event_kind = 'generation_disabled'
    ), 0)::bigint as kill_switch_gated_requests,
    coalesce(sum(events.event_count) filter (
      where events.event_kind in ('idempotency_conflict', 'already_finalized')
    ), 0)::bigint as replayed_or_conflicting_requests
  from blawx_private.request_event_rollups as events
  group by (events.utc_hour at time zone 'UTC')::date
),
connection_metrics as (
  select
    usage.utc_day,
    count(*) filter (
      where usage.attempt_count >= config.daily_attempt_limit
    )::bigint as connections_at_current_daily_limit
  from blawx_private.connection_daily_usage as usage
  cross join blawx_private.launch_config as config
  where config.singleton = true
  group by usage.utc_day
)
select
  days.utc_day,
  coalesce(spend.actual_micros, 0) as actual_spend_micros,
  (coalesce(spend.actual_micros, 0)::numeric / 1000000)::numeric(14, 6) as actual_spend_usd,
  coalesce(attempts.admitted_requests, 0) as admitted_requests,
  coalesce(attempts.provider_requests, 0) as provider_requests,
  coalesce(attempts.succeeded_requests, 0) as succeeded_requests,
  coalesce(attempts.failed_requests, 0) as failed_requests,
  coalesce(attempts.unknown_requests, 0) as unknown_requests,
  coalesce(attempts.cancelled_before_provider, 0) as cancelled_before_provider,
  coalesce(events.gated_requests, 0) as gated_requests,
  coalesce(events.daily_rate_limited_requests, 0) as daily_rate_limited_requests,
  coalesce(events.budget_gated_requests, 0) as budget_gated_requests,
  coalesce(events.concurrency_gated_requests, 0) as concurrency_gated_requests,
  coalesce(events.kill_switch_gated_requests, 0) as kill_switch_gated_requests,
  coalesce(events.replayed_or_conflicting_requests, 0) as replayed_or_conflicting_requests,
  coalesce(connections.connections_at_current_daily_limit, 0) as connections_at_current_daily_limit
from days
left join blawx_private.period_spend as spend
  on spend.period_kind = 'day'
 and spend.period_start = days.utc_day
left join attempt_metrics as attempts
  on attempts.utc_day = days.utc_day
left join event_metrics as events
  on events.utc_day = days.utc_day
left join connection_metrics as connections
  on connections.utc_day = days.utc_day;

revoke all on table blawx_private.monitoring_daily
  from public, anon, authenticated, service_role;

comment on table blawx_private.request_event_rollups is
  'Anonymous hourly counts of reservation rejections; stores no prompt, IP, connection hash, request ID, or user agent.';
comment on view blawx_private.monitoring_daily is
  'Owner-only daily launch dashboard combining spend, admitted/provider outcomes, anonymous gates, and connections at the current daily limit.';
