const ALERT_KINDS = new Set(['spend_threshold', 'usage_unknown', 'accounting_breach']);
const PERIOD_KINDS = new Set(['day', 'month']);

function validAlert(alert) {
  return alert && typeof alert === 'object'
    && Number.isSafeInteger(alert.id) && alert.id > 0
    && typeof alert.alert_key === 'string' && alert.alert_key.length > 0
    && ALERT_KINDS.has(alert.alert_kind)
    && (alert.threshold_percent == null
      || (Number.isSafeInteger(alert.threshold_percent) && alert.threshold_percent >= 1 && alert.threshold_percent <= 100))
    && PERIOD_KINDS.has(alert.period_kind)
    && /^\d{4}-\d{2}-\d{2}$/.test(alert.period_start)
    && Number.isSafeInteger(alert.amount_micros) && alert.amount_micros >= 0
    && Number.isSafeInteger(alert.cap_micros) && alert.cap_micros >= 0
    && Number.isSafeInteger(alert.delivery_attempts) && alert.delivery_attempts >= 1 && alert.delivery_attempts <= 5;
}

function dollars(micros) {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function formatSpendAlert(alert) {
  if (!validAlert(alert)) throw new Error('invalid_spend_alert');
  if (alert.alert_kind === 'spend_threshold') {
    return Object.freeze({
      subject: `Blawx ${alert.period_kind} spend reached ${alert.threshold_percent}%`,
      text: `Blawx has reserved or recorded ${dollars(alert.amount_micros)} of its ${dollars(alert.cap_micros)} ${alert.period_kind} application ceiling for ${alert.period_start}.`,
      severity: alert.threshold_percent >= 95 ? 'critical' : 'warning',
    });
  }
  if (alert.alert_kind === 'usage_unknown') {
    return Object.freeze({
      subject: 'Blawx recorded unknown provider usage',
      text: `A Blawx request for ${alert.period_start} had unknown provider usage. The application charged its full request reservation and retained the audit record.`,
      severity: 'critical',
    });
  }
  return Object.freeze({
    subject: 'Blawx disabled generation after an accounting breach',
    text: `A Blawx request for ${alert.period_start} cost more than its reservation. The application recorded the charge and switched generation off.`,
    severity: 'critical',
  });
}

function safeFailureCode(error) {
  const candidate = typeof error?.code === 'string' ? error.code.toLowerCase() : 'notification_failed';
  const normalized = candidate.replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
  return /^[a-z0-9]/.test(normalized) ? normalized : 'notification_failed';
}

export async function deliverSpendAlerts({
  store,
  notifier,
  now = () => new Date(),
  claimToken = crypto.randomUUID(),
  limit = 10,
  signal,
} = {}) {
  if (!store || typeof store.claimAlerts !== 'function' || typeof store.finishAlert !== 'function') {
    throw new Error('alert_store_required');
  }
  if (!notifier || typeof notifier.send !== 'function') throw new Error('alert_notifier_required');
  if (typeof claimToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claimToken)) {
    throw new Error('alert_claim_token_invalid');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new Error('alert_limit_invalid');

  const claimed = await store.claimAlerts({ claimToken, now: now(), limit, signal });
  if (!Array.isArray(claimed)) throw new Error('alert_claim_invalid');
  const summary = { claimed: claimed.length, sent: 0, failed: 0 };

  for (const alert of claimed) {
    let sent = false;
    let failureCode = null;
    try {
      const message = formatSpendAlert(alert);
      await notifier.send({ ...message, idempotencyKey: alert.alert_key, signal });
      sent = true;
    } catch (error) {
      failureCode = safeFailureCode(error);
    }

    const finished = await store.finishAlert({
      id: alert.id,
      claimToken,
      sent,
      failureCode,
      now: now(),
      signal,
    });
    if (finished !== true) throw new Error('alert_finish_rejected');
    if (sent) summary.sent += 1;
    else summary.failed += 1;
  }

  return Object.freeze(summary);
}
