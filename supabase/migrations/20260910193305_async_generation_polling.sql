-- Durable completion and connection-bound polling for deferred public builds.
-- The browser receives a short 202 response while generation continues after
-- that response, then polls through Netlify. Private ledger rows and raw source
-- programs remain unavailable to browser database roles.

create or replace function public.blawx_complete_generation(
  p_request_id uuid,
  p_actual_micros bigint,
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
declare
  v_finalization record;
  v_saved record;
begin
  if p_request_id is null or p_now is null then
    raise exception 'request_id_and_now_required' using errcode = '22023';
  end if;

  select *
  into v_finalization
  from public.blawx_finalize_generation(
    p_request_id,
    'succeeded',
    p_actual_micros,
    p_request_id::text,
    null,
    p_now
  );

  if v_finalization.reservation_state <> 'succeeded'
     or v_finalization.decision not in ('finalized', 'accounting_breach', 'already_finalized') then
    raise exception 'successful_finalization_required' using errcode = '55000';
  end if;

  select *
  into v_saved
  from public.blawx_save_generation_result(
    p_request_id,
    p_cache_key,
    p_generation_version,
    p_normalized_prompt,
    p_prompt,
    p_raw_model,
    p_source_program,
    p_diagnostics,
    p_metadata,
    p_provider_result_id,
    p_now
  );

  if v_saved.result_id is null then
    raise exception 'generation_result_not_saved' using errcode = '55000';
  end if;

  update blawx_private.generation_attempts
  set result_id = v_saved.result_id::text,
      updated_at = p_now
  where request_id = p_request_id
    and state = 'succeeded';

  return query select
    v_saved.result_id::uuid,
    v_saved.prompt::text,
    v_saved.created_at::timestamptz,
    v_saved.raw_model::jsonb,
    v_saved.source_program::jsonb,
    v_saved.diagnostics::jsonb,
    v_saved.metadata::jsonb;
end;
$$;

create or replace function public.blawx_poll_generation(
  p_request_id uuid,
  p_connection_hash bytea
)
returns table (
  request_state text,
  failure_code text,
  result_id uuid,
  prompt text,
  created_at timestamptz,
  raw_model jsonb,
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
    attempts.state,
    attempts.failure_code,
    results.id,
    results.prompt,
    results.created_at,
    results.raw_model,
    results.diagnostics,
    results.metadata
  from blawx_private.generation_attempts as attempts
  left join blawx_private.generation_results as results
    on results.id::text = attempts.result_id
   and results.visible
  where attempts.request_id = p_request_id
    and attempts.connection_hash = p_connection_hash
  limit 1;
$$;

revoke all on function public.blawx_complete_generation(
  uuid, bigint, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.blawx_poll_generation(uuid, bytea)
  from public, anon, authenticated;

grant execute on function public.blawx_complete_generation(
  uuid, bigint, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, timestamptz
) to service_role;
grant execute on function public.blawx_poll_generation(uuid, bytea)
  to service_role;

comment on function public.blawx_complete_generation(
  uuid, bigint, text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, timestamptz
) is 'Server-only atomic spend finalization and durable generated-result save.';
comment on function public.blawx_poll_generation(uuid, bytea)
  is 'Server-only connection-bound status read for one deferred generation request.';
