-- Server-only read projections for the public feed and detail routes.
-- Browser roles still receive no direct table or RPC access.

create or replace function public.blawx_list_visible_results(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 10
)
returns table (
  result_id uuid,
  prompt text,
  created_at timestamptz,
  generation_version text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'cursor_fields_must_match' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception 'invalid_result_limit' using errcode = '22023';
  end if;

  return query
  select
    results.id,
    results.prompt,
    results.created_at,
    results.generation_version,
    results.metadata
  from blawx_private.generation_results as results
  where results.visible
    and (
      p_cursor_created_at is null
      or (results.created_at, results.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by results.created_at desc, results.id desc
  limit p_limit;
end;
$$;

create or replace function public.blawx_get_visible_result(p_result_id uuid)
returns table (
  result_id uuid,
  prompt text,
  created_at timestamptz,
  generation_version text,
  raw_model jsonb,
  metadata jsonb
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
  select
    results.id,
    results.prompt,
    results.created_at,
    results.generation_version,
    results.raw_model,
    results.metadata
  from blawx_private.generation_results as results
  where results.id = p_result_id
    and results.visible
  limit 1;
$$;

revoke all on function public.blawx_list_visible_results(timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.blawx_get_visible_result(uuid)
  from public, anon, authenticated;

grant execute on function public.blawx_list_visible_results(timestamptz, uuid, integer)
  to service_role;
grant execute on function public.blawx_get_visible_result(uuid)
  to service_role;

comment on function public.blawx_list_visible_results(timestamptz, uuid, integer) is
  'Server-only bounded projection for the public feed; excludes raw model, source program, diagnostics, provider id, and accounting data.';
comment on function public.blawx_get_visible_result(uuid) is
  'Server-only public detail projection; excludes source program, diagnostics, provider id, and accounting data.';
