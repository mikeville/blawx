-- Durable exact-match generation cache.
--
-- Raw generation output and its source program stay server-only. Public feed
-- endpoints can later expose a validated projection without granting browser
-- roles direct access to this table.

create table blawx_private.generation_results (
  id uuid primary key,
  cache_key text not null
    check (cache_key ~ '^[0-9a-f]{64}$'),
  generation_version text not null
    check (char_length(generation_version) between 1 and 128),
  normalized_prompt text not null
    check (char_length(normalized_prompt) between 1 and 500),
  prompt text not null
    check (char_length(prompt) between 1 and 500),
  raw_model jsonb not null
    check (jsonb_typeof(raw_model) = 'object' and octet_length(raw_model::text) <= 5000000),
  source_program jsonb not null
    check (jsonb_typeof(source_program) = 'object' and octet_length(source_program::text) <= 2000000),
  diagnostics jsonb not null
    check (jsonb_typeof(diagnostics) = 'object' and octet_length(diagnostics::text) <= 250000),
  metadata jsonb not null
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 250000),
  provider_result_id text
    check (provider_result_id is null or char_length(provider_result_id) between 1 and 128),
  visible boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint generation_results_attempt_fkey foreign key (id)
    references blawx_private.generation_attempts (request_id)
);

create unique index generation_results_visible_cache_idx
  on blawx_private.generation_results (cache_key)
  where visible;
create index generation_results_visible_recent_idx
  on blawx_private.generation_results (created_at desc, id desc)
  where visible;

alter table blawx_private.generation_results enable row level security;
revoke all on table blawx_private.generation_results
  from public, anon, authenticated, service_role;

create or replace function public.blawx_find_cached_result(
  p_cache_key text,
  p_generation_version text
)
returns table (
  result_id uuid,
  prompt text,
  created_at timestamptz,
  raw_model jsonb,
  source_program jsonb,
  diagnostics jsonb,
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
    results.raw_model,
    results.source_program,
    results.diagnostics,
    results.metadata
  from blawx_private.generation_results as results
  where results.cache_key = p_cache_key
    and results.generation_version = p_generation_version
    and results.visible
  limit 1;
$$;

create or replace function public.blawx_save_generation_result(
  p_result_id uuid,
  p_cache_key text,
  p_generation_version text,
  p_normalized_prompt text,
  p_prompt text,
  p_raw_model jsonb,
  p_source_program jsonb,
  p_diagnostics jsonb,
  p_metadata jsonb,
  p_provider_result_id text,
  p_now timestamptz default clock_timestamp()
)
returns table (
  result_id uuid,
  prompt text,
  created_at timestamptz,
  raw_model jsonb,
  source_program jsonb,
  diagnostics jsonb,
  metadata jsonb
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if p_result_id is null or p_now is null then
    raise exception 'result_id_and_now_required' using errcode = '22023';
  end if;
  if p_cache_key is null or p_cache_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_cache_key' using errcode = '22023';
  end if;
  if p_generation_version is null or char_length(p_generation_version) not between 1 and 128 then
    raise exception 'invalid_generation_version' using errcode = '22023';
  end if;
  if p_normalized_prompt is null or char_length(p_normalized_prompt) not between 1 and 500
     or p_prompt is null or char_length(p_prompt) not between 1 and 500 then
    raise exception 'invalid_prompt' using errcode = '22023';
  end if;
  if jsonb_typeof(p_raw_model) is distinct from 'object'
     or jsonb_typeof(p_source_program) is distinct from 'object'
     or jsonb_typeof(p_diagnostics) is distinct from 'object'
     or jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception 'result_json_must_be_objects' using errcode = '22023';
  end if;
  if octet_length(p_raw_model::text) > 5000000
     or octet_length(p_source_program::text) > 2000000
     or octet_length(p_diagnostics::text) > 250000
     or octet_length(p_metadata::text) > 250000 then
    raise exception 'result_json_too_large' using errcode = '22023';
  end if;
  if p_provider_result_id is not null
     and char_length(p_provider_result_id) not between 1 and 128 then
    raise exception 'invalid_provider_result_id' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from blawx_private.generation_attempts as attempts
    where attempts.request_id = p_result_id
      and attempts.state = 'succeeded'
  ) then
    raise exception 'successful_attempt_required' using errcode = '55000';
  end if;

  insert into blawx_private.generation_results (
    id,
    cache_key,
    generation_version,
    normalized_prompt,
    prompt,
    raw_model,
    source_program,
    diagnostics,
    metadata,
    provider_result_id,
    created_at,
    updated_at
  )
  values (
    p_result_id,
    p_cache_key,
    p_generation_version,
    p_normalized_prompt,
    p_prompt,
    p_raw_model,
    p_source_program,
    p_diagnostics,
    p_metadata,
    p_provider_result_id,
    p_now,
    p_now
  )
  on conflict (cache_key) where visible do nothing;

  return query
  select
    results.id,
    results.prompt,
    results.created_at,
    results.raw_model,
    results.source_program,
    results.diagnostics,
    results.metadata
  from blawx_private.generation_results as results
  where results.cache_key = p_cache_key
    and results.generation_version = p_generation_version
    and results.visible
  limit 1;
end;
$$;

revoke all on function public.blawx_find_cached_result(text, text)
  from public, anon, authenticated;
revoke all on function public.blawx_save_generation_result(
  uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.blawx_find_cached_result(text, text)
  to service_role;
grant execute on function public.blawx_save_generation_result(
  uuid, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, timestamptz
) to service_role;

comment on table blawx_private.generation_results is
  'Server-only exact raw-generation cache. Derived bricks, instructions, and section labels use separate versioned computations.';
comment on function public.blawx_find_cached_result(text, text) is
  'Server-only exact cache lookup; cache hits consume no generation attempt or spend reservation.';
