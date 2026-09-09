const RPC_NAMES = Object.freeze({
  reserve: 'blawx_reserve_generation',
  markStarted: 'blawx_mark_provider_started',
  cancelBeforeProvider: 'blawx_cancel_before_provider',
  finalize: 'blawx_finalize_generation',
  status: 'blawx_launch_status',
  claimAlerts: 'blawx_claim_spend_alerts',
  finishAlert: 'blawx_finish_spend_alert',
  findCachedResult: 'blawx_find_cached_result',
  saveGenerationResult: 'blawx_save_generation_result',
  listVisibleResults: 'blawx_list_visible_results',
  getVisibleResult: 'blawx_get_visible_result',
});

async function readRpcResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('supabase_unreadable_response');
  }
  if (!response.ok) throw new Error('supabase_rpc_failed');
  return payload;
}

export function createSupabaseLaunchStore({ projectUrl, secretKey, fetchImpl = fetch }) {
  const url = new URL(projectUrl);
  if (url.protocol !== 'https:') throw new Error('supabase_url_must_be_https');
  if (typeof secretKey !== 'string' || !secretKey.trim()) throw new Error('supabase_secret_missing');
  if (typeof fetchImpl !== 'function') throw new Error('supabase_fetch_missing');

  async function rpc(name, body, { signal } = {}) {
    const response = await fetchImpl(`${url.origin}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: secretKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    return readRpcResponse(response);
  }

  return {
    async reserve({ requestId, connectionHash, now, signal }) {
      const rows = await rpc(RPC_NAMES.reserve, {
        p_request_id: requestId,
        p_connection_hash: connectionHash,
        p_now: now.toISOString(),
      }, { signal });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('supabase_invalid_reservation');
      return rows[0];
    },
    async markProviderStarted({ requestId, now, signal }) {
      return rpc(RPC_NAMES.markStarted, {
        p_request_id: requestId,
        p_now: now.toISOString(),
      }, { signal });
    },
    async cancelBeforeProvider({ requestId, failureCode, now, signal }) {
      return rpc(RPC_NAMES.cancelBeforeProvider, {
        p_request_id: requestId,
        p_failure_code: failureCode,
        p_now: now.toISOString(),
      }, { signal });
    },
    async finalize({ requestId, outcome, actualMicros, resultId, failureCode, now, signal }) {
      const rows = await rpc(RPC_NAMES.finalize, {
        p_request_id: requestId,
        p_outcome: outcome,
        p_actual_micros: actualMicros ?? null,
        p_result_id: resultId ?? null,
        p_failure_code: failureCode ?? null,
        p_now: now.toISOString(),
      }, { signal });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('supabase_invalid_finalization');
      return rows[0];
    },
    async status({ now = new Date(), signal } = {}) {
      const rows = await rpc(RPC_NAMES.status, { p_now: now.toISOString() }, { signal });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('supabase_invalid_status');
      return rows[0];
    },
    async claimAlerts({ claimToken, now = new Date(), limit = 10, signal } = {}) {
      const rows = await rpc(RPC_NAMES.claimAlerts, {
        p_claim_token: claimToken,
        p_now: now.toISOString(),
        p_limit: limit,
      }, { signal });
      if (!Array.isArray(rows)) throw new Error('supabase_invalid_alert_claim');
      return rows;
    },
    async finishAlert({ id, claimToken, sent, failureCode = null, now = new Date(), signal } = {}) {
      return rpc(RPC_NAMES.finishAlert, {
        p_id: id,
        p_claim_token: claimToken,
        p_sent: sent,
        p_failure_code: failureCode,
        p_now: now.toISOString(),
      }, { signal });
    },
    async findCachedResult({ cacheKey, generationVersion, signal } = {}) {
      const rows = await rpc(RPC_NAMES.findCachedResult, {
        p_cache_key: cacheKey,
        p_generation_version: generationVersion,
      }, { signal });
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('supabase_invalid_cache_lookup');
      return rows[0] ?? null;
    },
    async saveGenerationResult({
      resultId,
      cacheKey,
      generationVersion,
      normalizedPrompt,
      prompt,
      rawModel,
      sourceProgram,
      diagnostics,
      metadata,
      providerResultId,
      now = new Date(),
      signal,
    } = {}) {
      const rows = await rpc(RPC_NAMES.saveGenerationResult, {
        p_result_id: resultId,
        p_cache_key: cacheKey,
        p_generation_version: generationVersion,
        p_normalized_prompt: normalizedPrompt,
        p_prompt: prompt,
        p_raw_model: rawModel,
        p_source_program: sourceProgram,
        p_diagnostics: diagnostics,
        p_metadata: metadata,
        p_provider_result_id: providerResultId,
        p_now: now.toISOString(),
      }, { signal });
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error('supabase_invalid_cache_save');
      return rows[0];
    },
    async listVisibleResults({ cursorCreatedAt = null, cursorId = null, limit = 10, signal } = {}) {
      const rows = await rpc(RPC_NAMES.listVisibleResults, {
        p_cursor_created_at: cursorCreatedAt,
        p_cursor_id: cursorId,
        p_limit: limit,
      }, { signal });
      if (!Array.isArray(rows)) throw new Error('supabase_invalid_result_list');
      return rows;
    },
    async getVisibleResult({ resultId, signal } = {}) {
      const rows = await rpc(RPC_NAMES.getVisibleResult, { p_result_id: resultId }, { signal });
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('supabase_invalid_result_read');
      return rows[0] ?? null;
    },
  };
}
