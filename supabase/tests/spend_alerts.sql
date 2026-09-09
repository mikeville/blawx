-- Run after both launch migrations. Every mutation is rolled back.
begin;

delete from blawx_private.spend_alerts;

do $test$
declare
  v_id bigint;
  v_token uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_wrong_token uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_count integer;
  v_finished boolean;
begin
  update blawx_private.launch_config
  set daily_cap_micros = 200000000,
      monthly_cap_micros = 1000000000
  where singleton = true;

  insert into blawx_private.period_spend (
    period_kind, period_start, reserved_micros, actual_micros, updated_at
  ) values (
    'day', '2099-05-17', 100000000, 0, '2099-05-17 12:00:00+00'
  ) on conflict (period_kind, period_start) do update
  set reserved_micros = excluded.reserved_micros,
      actual_micros = excluded.actual_micros,
      updated_at = excluded.updated_at;

  select count(*) into v_count
  from blawx_private.spend_alerts
  where alert_key = 'spend_threshold:day:2099-05-17:50';
  if v_count <> 1 then raise exception '50 percent alert was not queued exactly once'; end if;

  update blawx_private.period_spend
  set reserved_micros = 190000000,
      updated_at = '2099-05-17 12:01:00+00'
  where period_kind = 'day' and period_start = '2099-05-17';

  select count(*) into v_count
  from blawx_private.spend_alerts
  where period_kind = 'day' and period_start = '2099-05-17';
  if v_count <> 3 then raise exception 'expected deduplicated 50, 80, and 95 percent alerts, got %', v_count; end if;

  select claimed.id into v_id
  from public.blawx_claim_spend_alerts(v_token, '2099-05-17 12:02:00+00', 1) as claimed;
  if v_id is null then raise exception 'claim returned no alert'; end if;

  select public.blawx_finish_spend_alert(
    v_id, v_wrong_token, true, null, '2099-05-17 12:02:01+00'
  ) into v_finished;
  if v_finished then raise exception 'wrong claim token acknowledged an alert'; end if;

  select public.blawx_finish_spend_alert(
    v_id, v_token, true, null, '2099-05-17 12:02:02+00'
  ) into v_finished;
  if not v_finished then raise exception 'valid claim acknowledgement failed'; end if;

  if (select sent_at is null from blawx_private.spend_alerts where id = v_id) then
    raise exception 'acknowledged alert was not marked sent';
  end if;

  if has_function_privilege('anon', 'public.blawx_claim_spend_alerts(uuid,timestamptz,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.blawx_claim_spend_alerts(uuid,timestamptz,integer)', 'execute')
     or has_function_privilege('anon', 'public.blawx_finish_spend_alert(bigint,uuid,boolean,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.blawx_finish_spend_alert(bigint,uuid,boolean,text,timestamptz)', 'execute') then
    raise exception 'browser role can execute an alert queue RPC';
  end if;
end
$test$;

rollback;
