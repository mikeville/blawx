-- Run after all launch migrations. Every mutation is rolled back.
begin;

do $test$
declare
  v_hash bytea := decode(repeat('77', 32), 'hex');
  v_row record;
  v_count integer;
begin
  update blawx_private.launch_config
  set generation_enabled = true
  where singleton = true;

  perform public.blawx_reserve_generation(
    '00000000-0000-4000-8000-000000000701', v_hash, '2099-06-01 00:00:00+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-4000-8000-000000000701', '2099-06-01 00:00:01+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-4000-8000-000000000701', 'succeeded', 100000,
    '00000000-0000-4000-8000-000000000701', null, '2099-06-01 00:00:02+00');

  select * into v_row from public.blawx_save_generation_result(
    '00000000-0000-4000-8000-000000000701', repeat('a', 64), 'raw-version-1',
    'tiny lighthouse', 'Tiny Lighthouse',
    '{"version":1,"kind":"voxels","cells":[{"x":0,"y":0,"z":0,"color":"red"}]}'::jsonb,
    '{"ops":[["b",0,0,0,1,1,1,"R"]]}'::jsonb,
    '{"valid":true}'::jsonb,
    '{"runtime":"mock"}'::jsonb,
    'resp-cache-test', '2099-06-01 00:00:03+00'
  );
  if v_row.result_id <> '00000000-0000-4000-8000-000000000701' then
    raise exception 'saved cache row did not return';
  end if;

  select * into v_row from public.blawx_find_cached_result(repeat('a', 64), 'raw-version-1');
  if v_row.result_id <> '00000000-0000-4000-8000-000000000701'
     or v_row.source_program->'ops' is null then
    raise exception 'exact cache lookup failed';
  end if;

  select count(*) into v_count
  from public.blawx_find_cached_result(repeat('a', 64), 'raw-version-2');
  if v_count <> 0 then raise exception 'stale generation version was reused'; end if;

  select * into v_row
  from public.blawx_list_visible_results(null, null, 10);
  if v_row.result_id <> '00000000-0000-4000-8000-000000000701'
     or v_row.generation_version <> 'raw-version-1' then
    raise exception 'public feed projection failed';
  end if;

  select * into v_row
  from public.blawx_get_visible_result('00000000-0000-4000-8000-000000000701');
  if v_row.result_id <> '00000000-0000-4000-8000-000000000701'
     or v_row.raw_model->>'kind' <> 'voxels' then
    raise exception 'public detail projection failed';
  end if;

  if has_function_privilege('anon', 'public.blawx_find_cached_result(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.blawx_find_cached_result(text,text)', 'execute')
     or has_function_privilege(
       'anon',
       'public.blawx_save_generation_result(uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,timestamptz)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.blawx_list_visible_results(timestamptz,uuid,integer)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.blawx_get_visible_result(uuid)',
       'execute'
     ) then
    raise exception 'browser role can execute a generation cache RPC';
  end if;
end
$test$;

rollback;
