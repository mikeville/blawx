-- Run after all launch/cache migrations inside a disposable transaction.

do $test$
declare
  v_row record;
  v_actual_before bigint;
  v_actual_after bigint;
  h1 bytea := decode(repeat('91', 32), 'hex');
  h2 bytea := decode(repeat('92', 32), 'hex');
  request_id uuid := '00000000-0000-4000-8000-000000000901';
begin
  update blawx_private.launch_config
  set generation_enabled = true,
      daily_cap_micros = 200000000,
      monthly_cap_micros = 1000000000,
      concurrency_limit = 10
  where singleton;

  perform public.blawx_reserve_generation(request_id, h1, '2099-09-01 12:00:00+00');
  perform public.blawx_mark_provider_started(request_id, '2099-09-01 12:00:01+00');

  select * into v_row from public.blawx_poll_generation(request_id, h1);
  if v_row.request_state <> 'reserved' or v_row.result_id is not null then
    raise exception 'pending poll failed: %', row_to_json(v_row);
  end if;

  if exists (select 1 from public.blawx_poll_generation(request_id, h2)) then
    raise exception 'connection-bound poll exposed another connection''s request';
  end if;

  select * into v_row from public.blawx_complete_generation(
    request_id,
    91000,
    repeat('9', 64),
    'raw-async-v1',
    'wacky pipe organ',
    'wacky pipe organ',
    '{"version":1,"kind":"voxels","cells":[{"x":0,"y":0,"z":0,"color":"red"}]}'::jsonb,
    '{"ops":[["b",0,0,0,1,1,1,"R"]]}'::jsonb,
    '{"valid":true}'::jsonb,
    '{"runtime":"test"}'::jsonb,
    'resp_async_901',
    '2099-09-01 12:00:31+00'
  );
  if v_row.result_id <> request_id or v_row.prompt <> 'wacky pipe organ' then
    raise exception 'atomic completion failed: %', row_to_json(v_row);
  end if;

  select * into v_row from public.blawx_poll_generation(request_id, h1);
  if v_row.request_state <> 'succeeded'
     or v_row.result_id <> request_id
     or v_row.raw_model->>'kind' <> 'voxels'
     or v_row.metadata->>'runtime' <> 'test' then
    raise exception 'completed poll failed: %', row_to_json(v_row);
  end if;

  select actual_micros into v_actual_before
  from blawx_private.period_spend
  where period_kind = 'day' and period_start = '2099-09-01';

  perform public.blawx_complete_generation(
    request_id,
    91000,
    repeat('9', 64),
    'raw-async-v1',
    'wacky pipe organ',
    'wacky pipe organ',
    '{"version":1,"kind":"voxels","cells":[{"x":0,"y":0,"z":0,"color":"red"}]}'::jsonb,
    '{"ops":[["b",0,0,0,1,1,1,"R"]]}'::jsonb,
    '{"valid":true}'::jsonb,
    '{"runtime":"test"}'::jsonb,
    'resp_async_901',
    '2099-09-01 12:00:32+00'
  );

  select actual_micros into v_actual_after
  from blawx_private.period_spend
  where period_kind = 'day' and period_start = '2099-09-01';
  if v_actual_after <> v_actual_before then
    raise exception 'idempotent completion charged twice';
  end if;

  if has_function_privilege('anon',
       'public.blawx_complete_generation(uuid,bigint,text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,timestamptz)',
       'execute')
     or has_function_privilege('authenticated',
       'public.blawx_poll_generation(uuid,bytea)',
       'execute') then
    raise exception 'async generation functions exposed to browser roles';
  end if;
end
$test$;
