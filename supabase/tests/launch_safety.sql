-- Run after the launch_safety_controls migration inside a disposable transaction.
-- The fixed 2099 dates isolate this test data from real launch periods.

do $test$
declare
  r record;
  ok boolean;
  h1 bytea := decode(repeat('11', 32), 'hex');
  h2 bytea := decode(repeat('22', 32), 'hex');
  h3 bytea := decode(repeat('33', 32), 'hex');
  h4 bytea := decode(repeat('44', 32), 'hex');
  h5 bytea := decode(repeat('55', 32), 'hex');
  h6 bytea := decode(repeat('66', 32), 'hex');
begin
  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000001', h1, '2099-01-15 12:00:00+00');
  if r.accepted or r.decision <> 'generation_disabled' then
    raise exception 'default kill switch test failed: %', row_to_json(r);
  end if;

  update blawx_private.launch_config set generation_enabled = true where singleton;

  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000101', h1, '2099-01-15 12:00:00+00');
  if not r.accepted or r.decision <> 'reserved' or r.attempts_used <> 1 then
    raise exception 'first reservation failed: %', row_to_json(r);
  end if;

  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000101', h1, '2099-01-15 12:00:01+00');
  if not r.accepted or r.decision <> 'already_reserved' or r.attempts_used <> 1 then
    raise exception 'idempotency failed: %', row_to_json(r);
  end if;

  select public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000101', '2099-01-15 12:00:02+00') into ok;
  if not ok then raise exception 'mark provider failed'; end if;

  select * into r from public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000101', 'succeeded', 100000,
    'result-101', null, '2099-01-15 12:00:03+00');
  if not r.finalized or r.decision <> 'finalized' or r.charged_micros <> 100000 then
    raise exception 'finalize failed: %', row_to_json(r);
  end if;

  perform public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000102', h1, '2099-01-15 12:01:00+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000102', '2099-01-15 12:01:01+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000102', 'succeeded', 100000,
    'result-102', null, '2099-01-15 12:01:02+00');
  perform public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000103', h1, '2099-01-15 12:02:00+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000103', '2099-01-15 12:02:01+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000103', 'succeeded', 100000,
    'result-103', null, '2099-01-15 12:02:02+00');

  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000104', h1, '2099-01-15 12:03:00+00');
  if r.accepted or r.decision <> 'daily_attempt_limit' or r.attempts_used <> 3 then
    raise exception 'daily attempt ceiling failed: %', row_to_json(r);
  end if;

  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000201', h2, '2099-01-16 12:00:00+00');
  if not r.accepted then raise exception 'concurrency reservation one failed'; end if;
  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000202', h3, '2099-01-16 12:00:01+00');
  if not r.accepted then raise exception 'concurrency reservation two failed'; end if;
  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000203', h4, '2099-01-16 12:00:02+00');
  if r.accepted or r.decision <> 'concurrency_limit' then
    raise exception 'concurrency ceiling failed: %', row_to_json(r);
  end if;

  select public.blawx_cancel_before_provider(
    '00000000-0000-0000-0000-000000000201', 'local_setup_failed',
    '2099-01-16 12:00:03+00') into ok;
  if not ok then raise exception 'pre-provider cancellation failed'; end if;

  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000203', h4, '2099-01-16 12:00:04+00');
  if not r.accepted or r.decision <> 'reserved' then
    raise exception 'concurrency release failed: %', row_to_json(r);
  end if;

  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000202', '2099-01-16 12:00:05+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000202', 'failed', 50000,
    null, 'provider_error', '2099-01-16 12:00:06+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000203', '2099-01-16 12:00:05+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000203', 'failed', 50000,
    null, 'provider_error', '2099-01-16 12:00:06+00');

  if (select attempt_count from blawx_private.connection_daily_usage
      where connection_hash = h2 and utc_day = '2099-01-16') <> 0 then
    raise exception 'cancelled attempt was not refunded';
  end if;

  update blawx_private.launch_config
  set daily_cap_micros = 200000, monthly_cap_micros = 1000000000
  where singleton;
  perform public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000301', h5, '2099-01-17 12:00:00+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000301', '2099-01-17 12:00:01+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000301', 'succeeded', 200000,
    'result-301', null, '2099-01-17 12:00:02+00');
  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000302', h6, '2099-01-17 12:01:00+00');
  if r.accepted or r.decision <> 'daily_spend_limit' then
    raise exception 'daily spend ceiling failed: %', row_to_json(r);
  end if;

  update blawx_private.launch_config
  set daily_cap_micros = 1000000, monthly_cap_micros = 200000
  where singleton;
  perform public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000401', h5, '2099-02-01 12:00:00+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000401', '2099-02-01 12:00:01+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000401', 'succeeded', 200000,
    'result-401', null, '2099-02-01 12:00:02+00');
  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000402', h6, '2099-02-01 12:01:00+00');
  if r.accepted or r.decision <> 'monthly_spend_limit' then
    raise exception 'monthly spend ceiling failed: %', row_to_json(r);
  end if;

  update blawx_private.launch_config
  set daily_cap_micros = 1000000, monthly_cap_micros = 1000000
  where singleton;
  perform public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000501', h5, '2099-03-01 00:00:00+00');
  select * into r from public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000502', h6, '2099-03-01 00:03:00+00');
  if not r.accepted then
    raise exception 'post-expiry reservation failed: %', row_to_json(r);
  end if;
  if (select state from blawx_private.generation_attempts
      where request_id = '00000000-0000-0000-0000-000000000501') <> 'unknown' then
    raise exception 'expired lease was not charged unknown';
  end if;
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000502', '2099-03-01 00:03:01+00');
  perform public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000502', 'succeeded', 10000,
    'result-502', null, '2099-03-01 00:03:02+00');

  perform public.blawx_reserve_generation(
    '00000000-0000-0000-0000-000000000601', h5, '2099-04-01 00:00:00+00');
  perform public.blawx_mark_provider_started(
    '00000000-0000-0000-0000-000000000601', '2099-04-01 00:00:01+00');
  select * into r from public.blawx_finalize_generation(
    '00000000-0000-0000-0000-000000000601', 'succeeded', 300000,
    'result-601', null, '2099-04-01 00:00:02+00');
  if not r.finalized or r.decision <> 'accounting_breach' or r.generation_enabled then
    raise exception 'accounting breach shutdown failed: %', row_to_json(r);
  end if;
end
$test$;
