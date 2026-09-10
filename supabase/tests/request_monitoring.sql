-- Run after all launch migrations. Every mutation is rolled back.
begin;

do $test$
declare
  v_hash bytea := decode(repeat('88', 32), 'hex');
  v_other_hash bytea := decode(repeat('99', 32), 'hex');
  v_row record;
  v_columns text[];
begin
  update blawx_private.launch_config
  set generation_enabled = false,
      daily_attempt_limit = 1,
      daily_cap_micros = 200000000,
      monthly_cap_micros = 1000000000,
      concurrency_limit = 10
  where singleton = true;

  select * into v_row from public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000801', v_hash, '2099-07-01 12:01:00+00');
  if v_row.decision <> 'generation_disabled' then
    raise exception 'disabled request was not rejected';
  end if;

  update blawx_private.launch_config
  set generation_enabled = true
  where singleton = true;

  select * into v_row from public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000802', v_hash, '2099-07-01 12:02:00+00');
  if not v_row.accepted then raise exception 'first request was not admitted'; end if;

  select * into v_row from public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000803', v_hash, '2099-07-01 12:03:00+00');
  if v_row.decision <> 'daily_attempt_limit' then
    raise exception 'daily limit request was not rejected';
  end if;

  update blawx_private.launch_config
  set concurrency_limit = 1
  where singleton = true;

  select * into v_row from public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000804', v_other_hash, '2099-07-01 12:03:30+00');
  if v_row.decision <> 'concurrency_limit' then
    raise exception 'concurrency request was not rejected';
  end if;

  update blawx_private.launch_config
  set daily_cap_micros = 200000,
      monthly_cap_micros = 1000000000,
      concurrency_limit = 10
  where singleton = true;
  insert into blawx_private.period_spend (
    period_kind, period_start, reserved_micros, actual_micros, updated_at
  ) values (
    'day', '2099-07-02', 0, 100000, '2099-07-02 12:00:00+00'
  ) on conflict (period_kind, period_start) do update
  set reserved_micros = excluded.reserved_micros,
      actual_micros = excluded.actual_micros,
      updated_at = excluded.updated_at;

  select * into v_row from public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000805', v_other_hash, '2099-07-02 12:01:00+00');
  if v_row.decision <> 'daily_spend_limit' then
    raise exception 'daily spend request was not rejected';
  end if;

  update blawx_private.launch_config
  set daily_cap_micros = 200000000,
      monthly_cap_micros = 200000
  where singleton = true;
  insert into blawx_private.period_spend (
    period_kind, period_start, reserved_micros, actual_micros, updated_at
  ) values (
    'month', '2099-08-01', 0, 100000, '2099-08-01 12:00:00+00'
  ) on conflict (period_kind, period_start) do update
  set reserved_micros = excluded.reserved_micros,
      actual_micros = excluded.actual_micros,
      updated_at = excluded.updated_at;

  select * into v_row from public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000806', v_other_hash, '2099-08-01 12:01:00+00');
  if v_row.decision <> 'monthly_spend_limit' then
    raise exception 'monthly spend request was not rejected';
  end if;

  select * into v_row
  from blawx_private.monitoring_daily
  where utc_day = '2099-07-01';

  if v_row.admitted_requests <> 1
     or v_row.gated_requests <> 3
     or v_row.daily_rate_limited_requests <> 1
     or v_row.concurrency_gated_requests <> 1
     or v_row.kill_switch_gated_requests <> 1
     or v_row.connections_at_current_daily_limit <> 1 then
    raise exception 'daily monitoring totals are incorrect: %', row_to_json(v_row);
  end if;

  if (select event_count from blawx_private.request_event_rollups
      where utc_hour = '2099-07-02 12:00:00+00' and event_kind = 'daily_spend_limit') <> 1
     or (select event_count from blawx_private.request_event_rollups
      where utc_hour = '2099-08-01 12:00:00+00' and event_kind = 'monthly_spend_limit') <> 1 then
    raise exception 'budget gate rollups are incorrect';
  end if;

  if exists (
    select 1
    from blawx_private.monitoring_dashboard
    where utc_day = '2099-07-01'
  ) then
    raise exception 'future-dated test traffic leaked into the owner dashboard';
  end if;

  select array_agg(columns.column_name order by columns.ordinal_position)
  into v_columns
  from information_schema.columns as columns
  where columns.table_schema = 'blawx_private'
    and columns.table_name = 'request_event_rollups';

  if v_columns <> array['utc_hour', 'event_kind', 'event_count', 'updated_at'] then
    raise exception 'anonymous rollup columns changed: %', v_columns;
  end if;

  if has_table_privilege('anon', 'blawx_private.request_event_rollups', 'select')
     or has_table_privilege('authenticated', 'blawx_private.request_event_rollups', 'select')
     or has_table_privilege('service_role', 'blawx_private.request_event_rollups', 'select')
     or has_table_privilege('anon', 'blawx_private.monitoring_daily', 'select')
     or has_table_privilege('authenticated', 'blawx_private.monitoring_daily', 'select')
     or has_table_privilege('anon', 'blawx_private.monitoring_dashboard', 'select')
     or has_table_privilege('authenticated', 'blawx_private.monitoring_dashboard', 'select') then
    raise exception 'non-owner role can read private monitoring data';
  end if;
end
$test$;

rollback;
