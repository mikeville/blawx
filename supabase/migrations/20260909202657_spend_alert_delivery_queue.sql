-- Durable, server-only spend alert queue.
--
-- Threshold events are created in the same transaction that changes spend.
-- A later Netlify worker may claim them in small batches and deliver through a
-- separately configured notification provider. No browser role can read or
-- mutate this queue.

alter table blawx_private.spend_alerts
  alter column threshold_percent drop not null,
  add column alert_kind text not null default 'spend_threshold'
    check (alert_kind in ('spend_threshold', 'usage_unknown', 'accounting_breach')),
  add column amount_micros bigint not null default 0
    check (amount_micros >= 0),
  add column cap_micros bigint not null default 0
    check (cap_micros >= 0),
  add column claimed_at timestamptz,
  add column claim_token uuid,
  add column delivery_attempts smallint not null default 0
    check (delivery_attempts between 0 and 5),
  add column last_attempt_at timestamptz,
  add column last_failure_code text
    check (
      last_failure_code is null
      or (
        char_length(last_failure_code) between 1 and 64
        and last_failure_code ~ '^[a-z0-9][a-z0-9_-]*$'
      )
    ),
  add column dead_lettered_at timestamptz,
  add constraint spend_alerts_kind_threshold_check check (
    (alert_kind = 'spend_threshold' and threshold_percent is not null)
    or (alert_kind <> 'spend_threshold' and threshold_percent is null)
  ),
  add constraint spend_alerts_claim_pair_check check (
    (claimed_at is null and claim_token is null)
    or (claimed_at is not null and claim_token is not null)
  ),
  add constraint spend_alerts_terminal_state_check check (
    not (sent_at is not null and dead_lettered_at is not null)
  );

drop index if exists blawx_private.spend_alerts_unsent_idx;
create index spend_alerts_pending_idx
  on blawx_private.spend_alerts (created_at, id)
  where sent_at is null and dead_lettered_at is null;

create or replace function blawx_private.queue_spend_threshold_alerts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cap bigint;
  v_total bigint;
  v_threshold smallint;
  v_thresholds smallint[];
begin
  select case
    when new.period_kind = 'day' then config.daily_cap_micros
    else config.monthly_cap_micros
  end
  into v_cap
  from blawx_private.launch_config as config
  where config.singleton = true;

  v_total := new.reserved_micros + new.actual_micros;
  v_thresholds := case
    when new.period_kind = 'day' then array[50, 80, 95, 100]::smallint[]
    else array[25, 50, 75, 90, 100]::smallint[]
  end;

  if v_cap is null or v_cap <= 0 or v_total <= 0 then
    return new;
  end if;

  foreach v_threshold in array v_thresholds loop
    if v_total::numeric * 100 >= v_cap::numeric * v_threshold then
      insert into blawx_private.spend_alerts (
        alert_key,
        alert_kind,
        threshold_percent,
        period_kind,
        period_start,
        amount_micros,
        cap_micros,
        created_at
      )
      values (
        format('spend_threshold:%s:%s:%s', new.period_kind, new.period_start, v_threshold),
        'spend_threshold',
        v_threshold,
        new.period_kind,
        new.period_start,
        v_total,
        v_cap,
        new.updated_at
      )
      on conflict (alert_key) do nothing;
    end if;
  end loop;

  return new;
end;
$$;

create trigger queue_spend_threshold_alerts
after insert or update of reserved_micros, actual_micros
on blawx_private.period_spend
for each row
execute function blawx_private.queue_spend_threshold_alerts();

create or replace function blawx_private.queue_attempt_alerts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cap bigint;
  v_kind text;
begin
  if new.state = 'unknown' and old.state is distinct from 'unknown' then
    v_kind := 'usage_unknown';
  elsif new.actual_micros > new.reserved_micros
        and coalesce(old.actual_micros, 0) <= old.reserved_micros then
    v_kind := 'accounting_breach';
  else
    return new;
  end if;

  select config.daily_cap_micros
  into v_cap
  from blawx_private.launch_config as config
  where config.singleton = true;

  insert into blawx_private.spend_alerts (
    alert_key,
    alert_kind,
    threshold_percent,
    period_kind,
    period_start,
    amount_micros,
    cap_micros,
    created_at
  )
  values (
    format('%s:%s', v_kind, new.request_id),
    v_kind,
    null,
    'day',
    new.utc_day,
    coalesce(new.actual_micros, new.reserved_micros),
    coalesce(v_cap, 0),
    new.updated_at
  )
  on conflict (alert_key) do nothing;

  return new;
end;
$$;

create trigger queue_attempt_alerts
after update of state, actual_micros
on blawx_private.generation_attempts
for each row
execute function blawx_private.queue_attempt_alerts();

create or replace function public.blawx_claim_spend_alerts(
  p_claim_token uuid,
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 10
)
returns table (
  id bigint,
  alert_key text,
  alert_kind text,
  threshold_percent smallint,
  period_kind text,
  period_start date,
  amount_micros bigint,
  cap_micros bigint,
  delivery_attempts smallint
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
begin
  if p_claim_token is null or p_now is null then
    raise exception 'claim_token_and_now_required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 25 then
    raise exception 'claim_limit_out_of_range' using errcode = '22023';
  end if;

  return query
  with claimable as (
    select alerts.id
    from blawx_private.spend_alerts as alerts
    where alerts.sent_at is null
      and alerts.dead_lettered_at is null
      and alerts.delivery_attempts < 5
      and (
        alerts.claimed_at is null
        or alerts.claimed_at <= p_now - interval '10 minutes'
      )
    order by alerts.created_at, alerts.id
    limit p_limit
    for update skip locked
  )
  update blawx_private.spend_alerts as alerts
  set claimed_at = p_now,
      claim_token = p_claim_token,
      delivery_attempts = alerts.delivery_attempts + 1,
      last_attempt_at = p_now,
      last_failure_code = null
  from claimable
  where alerts.id = claimable.id
  returning
    alerts.id,
    alerts.alert_key,
    alerts.alert_kind,
    alerts.threshold_percent,
    alerts.period_kind,
    alerts.period_start,
    alerts.amount_micros,
    alerts.cap_micros,
    alerts.delivery_attempts;
end;
$$;

create or replace function public.blawx_finish_spend_alert(
  p_id bigint,
  p_claim_token uuid,
  p_sent boolean,
  p_failure_code text default null,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = ''
set statement_timeout = '2s'
as $$
declare
  v_alert blawx_private.spend_alerts%rowtype;
begin
  if p_id is null or p_claim_token is null or p_sent is null or p_now is null then
    raise exception 'alert_finish_arguments_required' using errcode = '22023';
  end if;
  if not p_sent and (
    p_failure_code is null
    or char_length(p_failure_code) not between 1 and 64
    or p_failure_code !~ '^[a-z0-9][a-z0-9_-]*$'
  ) then
    raise exception 'invalid_failure_code' using errcode = '22023';
  end if;

  select *
  into v_alert
  from blawx_private.spend_alerts as alerts
  where alerts.id = p_id
  for update;

  if not found
     or v_alert.sent_at is not null
     or v_alert.dead_lettered_at is not null
     or v_alert.claim_token is distinct from p_claim_token then
    return false;
  end if;

  update blawx_private.spend_alerts as alerts
  set sent_at = case when p_sent then p_now else null end,
      dead_lettered_at = case
        when not p_sent and alerts.delivery_attempts >= 5 then p_now
        else null
      end,
      claimed_at = null,
      claim_token = null,
      last_failure_code = case when p_sent then null else p_failure_code end
  where alerts.id = p_id;

  return true;
end;
$$;

revoke all on function blawx_private.queue_spend_threshold_alerts()
  from public, anon, authenticated, service_role;
revoke all on function blawx_private.queue_attempt_alerts()
  from public, anon, authenticated, service_role;
revoke all on function public.blawx_claim_spend_alerts(uuid, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.blawx_finish_spend_alert(bigint, uuid, boolean, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.blawx_claim_spend_alerts(uuid, timestamptz, integer)
  to service_role;
grant execute on function public.blawx_finish_spend_alert(bigint, uuid, boolean, text, timestamptz)
  to service_role;

comment on function public.blawx_claim_spend_alerts(uuid, timestamptz, integer) is
  'Server-only nonblocking claim for durable spend and accounting alerts.';
comment on function public.blawx_finish_spend_alert(bigint, uuid, boolean, text, timestamptz) is
  'Server-only acknowledgement or bounded retry release for a claimed alert.';
