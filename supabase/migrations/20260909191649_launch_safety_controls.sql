-- Blawx public-launch safety controls.
--
-- Internal ledgers live outside the exposed Data API schema. The only remote
-- entry points are four SECURITY DEFINER functions in public, and those are
-- executable by service_role only. The service-role/secret key must remain in
-- the Netlify server environment and must never be sent to the browser.

create schema if not exists blawx_private;

revoke all on schema blawx_private from public, anon, authenticated, service_role;

create table blawx_private.launch_config (
  singleton boolean primary key default true check (singleton),
  generation_enabled boolean not null default false,
  daily_attempt_limit smallint not null default 3
    check (daily_attempt_limit between 1 and 100),
  daily_cap_micros bigint not null default 200000000
    check (daily_cap_micros >= 0),
  monthly_cap_micros bigint not null default 1000000000
    check (monthly_cap_micros >= 0),
  request_reserve_micros bigint not null default 200000
    check (request_reserve_micros > 0),
  concurrency_limit smallint not null default 2
    check (concurrency_limit between 1 and 100),
  lease_seconds integer not null default 120
    check (lease_seconds between 30 and 600),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (request_reserve_micros <= daily_cap_micros),
  check (request_reserve_micros <= monthly_cap_micros)
);

create table blawx_private.connection_daily_usage (
  connection_hash bytea not null check (octet_length(connection_hash) = 32),
  utc_day date not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (connection_hash, utc_day)
);

create table blawx_private.period_spend (
  period_kind text not null check (period_kind in ('day', 'month')),
  period_start date not null,
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  actual_micros bigint not null default 0 check (actual_micros >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (period_kind, period_start),
  check (period_kind = 'day' or extract(day from period_start) = 1)
);

create table blawx_private.generation_attempts (
  request_id uuid primary key,
  connection_hash bytea not null check (octet_length(connection_hash) = 32),
  utc_day date not null,
  utc_month date not null check (extract(day from utc_month) = 1),
  state text not null default 'reserved'
    check (state in ('reserved', 'succeeded', 'failed', 'unknown', 'cancelled')),
  reserved_micros bigint not null check (reserved_micros > 0),
  actual_micros bigint check (actual_micros >= 0),
  lease_expires_at timestamptz not null,
  provider_started_at timestamptz,
  finalized_at timestamptz,
  result_id text check (result_id is null or char_length(result_id) between 1 and 128),
  failure_code text check (
    failure_code is null
    or (
      char_length(failure_code) between 1 and 64
      and failure_code ~ '^[a-z0-9][a-z0-9_-]*$'
    )
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (state = 'reserved' and actual_micros is null and finalized_at is null)
    or (state <> 'reserved' and actual_micros is not null and finalized_at is not null)
  ),
  check (state <> 'cancelled' or (actual_micros = 0 and provider_started_at is null))
);

create table blawx_private.spend_alerts (
  id bigint generated always as identity primary key,
  alert_key text not null unique
    check (char_length(alert_key) between 1 and 128),
  threshold_percent smallint not null check (threshold_percent between 1 and 100),
  period_kind text not null check (period_kind in ('day', 'month')),
  period_start date not null,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index generation_attempts_active_lease_idx
  on blawx_private.generation_attempts (lease_expires_at)
  where state = 'reserved';

create index generation_attempts_created_at_idx
  on blawx_private.generation_attempts (created_at desc);

create index spend_alerts_unsent_idx
  on blawx_private.spend_alerts (created_at)
  where sent_at is null;

alter table blawx_private.launch_config enable row level security;
alter table blawx_private.connection_daily_usage enable row level security;
alter table blawx_private.period_spend enable row level security;
alter table blawx_private.generation_attempts enable row level security;
alter table blawx_private.spend_alerts enable row level security;

revoke all on all tables in schema blawx_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema blawx_private from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema blawx_private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema blawx_private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema blawx_private
  revoke execute on functions from public, anon, authenticated, service_role;

insert into blawx_private.launch_config (singleton)
values (true)
on conflict (singleton) do nothing;

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

  -- Expired work no longer occupies concurrency, but its full reservation is
  -- charged as unknown. Unknown provider outcomes are never silently refunded.
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

create or replace function public.blawx_mark_provider_started(
  p_request_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_started boolean;
begin
  if p_request_id is null or p_now is null then
    raise exception 'request_id_and_now_required' using errcode = '22023';
  end if;

  perform 1
  from blawx_private.launch_config
  where singleton = true
  for update;

  update blawx_private.generation_attempts
  set provider_started_at = coalesce(provider_started_at, p_now),
      updated_at = p_now
  where request_id = p_request_id
    and state = 'reserved'
    and lease_expires_at > p_now
  returning true into v_started;

  return coalesce(v_started, false);
end;
$$;

create or replace function public.blawx_cancel_before_provider(
  p_request_id uuid,
  p_failure_code text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_attempt blawx_private.generation_attempts%rowtype;
begin
  if p_request_id is null or p_now is null then
    raise exception 'request_id_and_now_required' using errcode = '22023';
  end if;

  if p_failure_code is null
     or char_length(p_failure_code) not between 1 and 64
     or p_failure_code !~ '^[a-z0-9][a-z0-9_-]*$' then
    raise exception 'invalid_failure_code' using errcode = '22023';
  end if;

  perform 1
  from blawx_private.launch_config
  where singleton = true
  for update;

  select *
  into v_attempt
  from blawx_private.generation_attempts
  where request_id = p_request_id
  for update;

  if not found or v_attempt.state <> 'reserved' then
    return false;
  end if;

  if v_attempt.provider_started_at is not null then
    raise exception 'provider_already_started' using errcode = '55000';
  end if;

  update blawx_private.period_spend
  set reserved_micros = reserved_micros - v_attempt.reserved_micros,
      updated_at = p_now
  where (period_kind = 'day' and period_start = v_attempt.utc_day)
     or (period_kind = 'month' and period_start = v_attempt.utc_month);

  update blawx_private.connection_daily_usage
  set attempt_count = attempt_count - 1,
      updated_at = p_now
  where connection_hash = v_attempt.connection_hash
    and utc_day = v_attempt.utc_day;

  update blawx_private.generation_attempts
  set state = 'cancelled',
      actual_micros = 0,
      failure_code = p_failure_code,
      finalized_at = p_now,
      updated_at = p_now
  where request_id = p_request_id;

  return true;
end;
$$;

create or replace function public.blawx_finalize_generation(
  p_request_id uuid,
  p_outcome text,
  p_actual_micros bigint default null,
  p_result_id text default null,
  p_failure_code text default null,
  p_now timestamptz default clock_timestamp()
)
returns table (
  finalized boolean,
  decision text,
  reservation_state text,
  charged_micros bigint,
  generation_enabled boolean
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_config blawx_private.launch_config%rowtype;
  v_attempt blawx_private.generation_attempts%rowtype;
  v_charge bigint;
  v_breach boolean := false;
begin
  if p_request_id is null or p_now is null then
    raise exception 'request_id_and_now_required' using errcode = '22023';
  end if;

  if p_outcome is null or p_outcome not in ('succeeded', 'failed', 'unknown') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;

  if p_actual_micros is not null and p_actual_micros < 0 then
    raise exception 'actual_micros_must_be_nonnegative' using errcode = '22023';
  end if;

  if p_result_id is not null and char_length(p_result_id) not between 1 and 128 then
    raise exception 'invalid_result_id' using errcode = '22023';
  end if;

  if p_failure_code is not null and (
    char_length(p_failure_code) not between 1 and 64
    or p_failure_code !~ '^[a-z0-9][a-z0-9_-]*$'
  ) then
    raise exception 'invalid_failure_code' using errcode = '22023';
  end if;

  select *
  into v_config
  from blawx_private.launch_config
  where singleton = true
  for update;

  select *
  into v_attempt
  from blawx_private.generation_attempts
  where request_id = p_request_id
  for update;

  if not found then
    return query select false, 'not_found'::text, null::text, 0::bigint,
      v_config.generation_enabled;
    return;
  end if;

  if v_attempt.state <> 'reserved' then
    return query select
      false,
      'already_finalized'::text,
      v_attempt.state,
      v_attempt.actual_micros,
      v_config.generation_enabled;
    return;
  end if;

  if v_attempt.provider_started_at is null and p_outcome <> 'unknown' then
    raise exception 'provider_not_marked_started' using errcode = '55000';
  end if;

  v_charge := case
    when p_outcome = 'unknown' then v_attempt.reserved_micros
    else coalesce(p_actual_micros, v_attempt.reserved_micros)
  end;
  v_breach := v_charge > v_attempt.reserved_micros;

  update blawx_private.period_spend
  set reserved_micros = reserved_micros - v_attempt.reserved_micros,
      actual_micros = actual_micros + v_charge,
      updated_at = p_now
  where (period_kind = 'day' and period_start = v_attempt.utc_day)
     or (period_kind = 'month' and period_start = v_attempt.utc_month);

  update blawx_private.generation_attempts
  set state = p_outcome,
      actual_micros = v_charge,
      result_id = p_result_id,
      failure_code = case
        when v_breach then 'reservation_exceeded'
        else p_failure_code
      end,
      finalized_at = p_now,
      updated_at = p_now
  where request_id = p_request_id;

  if v_breach then
    update blawx_private.launch_config
    set generation_enabled = false,
        updated_at = p_now
    where singleton = true;

    v_config.generation_enabled := false;
  end if;

  return query select
    true,
    case when v_breach then 'accounting_breach' else 'finalized' end,
    p_outcome,
    v_charge,
    v_config.generation_enabled;
end;
$$;

create or replace function public.blawx_launch_status(
  p_now timestamptz default clock_timestamp()
)
returns table (
  generation_enabled boolean,
  daily_attempt_limit smallint,
  daily_cap_micros bigint,
  monthly_cap_micros bigint,
  request_reserve_micros bigint,
  concurrency_limit smallint,
  utc_day date,
  day_reserved_micros bigint,
  day_actual_micros bigint,
  utc_month date,
  month_reserved_micros bigint,
  month_actual_micros bigint,
  active_reservations bigint
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select
    config.generation_enabled,
    config.daily_attempt_limit,
    config.daily_cap_micros,
    config.monthly_cap_micros,
    config.request_reserve_micros,
    config.concurrency_limit,
    (p_now at time zone 'utc')::date,
    coalesce(day_spend.reserved_micros, 0),
    coalesce(day_spend.actual_micros, 0),
    date_trunc('month', p_now at time zone 'utc')::date,
    coalesce(month_spend.reserved_micros, 0),
    coalesce(month_spend.actual_micros, 0),
    (
      select count(*)
      from blawx_private.generation_attempts as attempts
      where attempts.state = 'reserved'
        and attempts.lease_expires_at > p_now
    )
  from blawx_private.launch_config as config
  left join blawx_private.period_spend as day_spend
    on day_spend.period_kind = 'day'
   and day_spend.period_start = (p_now at time zone 'utc')::date
  left join blawx_private.period_spend as month_spend
    on month_spend.period_kind = 'month'
   and month_spend.period_start = date_trunc('month', p_now at time zone 'utc')::date
  where config.singleton = true;
$$;

revoke all on function public.blawx_reserve_generation(uuid, bytea, timestamptz)
  from public, anon, authenticated;
revoke all on function public.blawx_mark_provider_started(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.blawx_cancel_before_provider(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.blawx_finalize_generation(uuid, text, bigint, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.blawx_launch_status(timestamptz)
  from public, anon, authenticated;

grant execute on function public.blawx_reserve_generation(uuid, bytea, timestamptz)
  to service_role;
grant execute on function public.blawx_mark_provider_started(uuid, timestamptz)
  to service_role;
grant execute on function public.blawx_cancel_before_provider(uuid, text, timestamptz)
  to service_role;
grant execute on function public.blawx_finalize_generation(uuid, text, bigint, text, text, timestamptz)
  to service_role;
grant execute on function public.blawx_launch_status(timestamptz)
  to service_role;

comment on schema blawx_private is
  'Private launch quota, spend, lease, and alert ledgers. Never expose through the Data API.';
comment on table blawx_private.generation_attempts is
  'One idempotent reservation per fresh provider attempt; stores only a 32-byte HMAC connection identifier, never a raw IP address.';
comment on function public.blawx_reserve_generation(uuid, bytea, timestamptz) is
  'Server-only atomic launch gate: kill switch, three-per-connection/day, spend reservations, and concurrency lease.';
