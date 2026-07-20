// probe14: probe8's full-authorship prompt v2, byte-identical, run against
// xAI grok-4.5 over the API. Cross-vendor A/B against probe8 (Sonnet 5,
// subscription, 10/10 clean) and probe10 (Sonnet 5, API): does the
// full-authorship route hold up on a non-Anthropic frontier model, and does
// the ~5k-thinking-token requirement (probes 9-11) look task-intrinsic or
// Sonnet-specific?
//
// Protocol (identical to probe8/probe10): single shot, then
// retry-feedback.ts --max-depth=6 on the draft; if not mechanically clean,
// one retry with the deterministic feedback appended as a follow-up turn.
// Final response lands in responses/, first drafts in responses-call1/,
// per-call tokens + wall-clock in usage.json.
//
// Usage: npx tsx scripts/run-probe14-grok.ts
//   Reads: XAI_API_KEY (env or project .env). Re-runnable: skips nouns whose
//   responses/<slug>.txt already exists.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';

// grok-4.5 can reason for minutes without emitting SSE bytes; undici's default
// 300s headers/body idle timeouts both trip on that, so disable them.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

const ROOT = join(import.meta.dirname, '..');
const RUNS = join(ROOT, 'runs');
const RUN_ID = 'probe14-16char-grok45';
const SOURCE_RUN = 'probe8-16char-nomask';
const MODEL = 'grok-4.5';

// --- Minimal .env loader (same pattern as gen-silhouettes.ts) ---
{
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
const KEY = process.env.XAI_API_KEY;
if (!KEY) {
  console.error('XAI_API_KEY not set (env or project .env)');
  process.exit(1);
}

const runDir = join(RUNS, RUN_ID);
mkdirSync(join(runDir, 'prompts'), { recursive: true });
mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
mkdirSync(join(runDir, 'responses'), { recursive: true });

// Prompts are copied verbatim from probe8 — the A/B is model-only.
const slugs = readdirSync(join(RUNS, SOURCE_RUN, 'prompts'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort();
for (const slug of slugs) {
  copyFileSync(join(RUNS, SOURCE_RUN, 'prompts', `${slug}.md`), join(runDir, 'prompts', `${slug}.md`));
}

const manifest = {
  id: RUN_ID,
  label: 'probe14 16³ · no mask, prompt v2 — grok-4.5 cross-vendor A/B',
  date: '2026-07-20',
  pipeline:
    "probe8's prompt v2 rerun byte-identical against xAI grok-4.5 (chat completions API, default reasoning, max_tokens 16384). Single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6), strict lift. Cross-vendor A/B vs probe8 (subscription Sonnet, 10/10 clean) and probe10 (API Sonnet): is full-authorship quality model-general, and is the thinking-token requirement task-intrinsic? Per-call tokens + wall-clock in usage.json.",
  conditions: {
    grid: '16',
    encoding: 'char',
    model: MODEL,
    prompt: 'full-authorship v2 (byte-identical to probe8)',
    source: 'none — noun only',
    method:
      'single-shot + 1 deterministic-feedback retry; direct xAI API calls, default reasoning, max_tokens 16384 — live spend on XAI_API_KEY, signed off 2026-07-20',
  },
};
writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');

type Msg = { role: 'user' | 'assistant'; content: string };

type CallRecord = {
  noun: string;
  call: 1 | 2;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number | null;
  finishReason: string | null;
};

// Streamed: a long reasoning phase on a non-streaming request trips
// undici's 300s headers timeout, so read SSE chunks instead.
async function chat(messages: Msg[]): Promise<{ text: string; rec: Omit<CallRecord, 'noun' | 'call'> }> {
  const t0 = performance.now();
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 16384,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 500)}`);

  let text = '';
  let finishReason: string | null = null;
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  } = {};
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, '').trim();
      if (!line.startsWith('data:') || data === '' || data === '[DONE]') continue;
      const evt = JSON.parse(data) as {
        choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
        usage?: typeof usage;
      };
      text += evt.choices?.[0]?.delta?.content ?? '';
      if (evt.choices?.[0]?.finish_reason) finishReason = evt.choices[0].finish_reason;
      if (evt.usage) usage = evt.usage;
    }
  }
  return {
    text,
    rec: {
      ms: Math.round(performance.now() - t0),
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
      finishReason,
    },
  };
}

/** "OK" or the deterministic feedback message for the retry turn. */
function validate(slug: string): string {
  return execFileSync('npx', ['tsx', 'scripts/retry-feedback.ts', join(runDir, 'responses-call1', `${slug}.txt`), '--max-depth=6'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
}

const usagePath = join(runDir, 'usage.json');
const usage: CallRecord[] = existsSync(usagePath) ? JSON.parse(readFileSync(usagePath, 'utf8')) : [];

for (const slug of slugs) {
  const finalPath = join(runDir, 'responses', `${slug}.txt`);
  if (existsSync(finalPath)) {
    console.log(`${slug}: already done, skipping`);
    continue;
  }
  const prompt = readFileSync(join(runDir, 'prompts', `${slug}.md`), 'utf8');

  const draft = await chat([{ role: 'user', content: prompt }]);
  writeFileSync(join(runDir, 'responses-call1', `${slug}.txt`), draft.text);
  usage.push({ noun: slug, call: 1, ...draft.rec });
  writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');

  const verdict = validate(slug);
  if (verdict === 'OK') {
    copyFileSync(join(runDir, 'responses-call1', `${slug}.txt`), finalPath);
    console.log(`${slug}: clean first draft (${draft.rec.ms} ms, ${draft.rec.completionTokens} out)`);
    continue;
  }

  const retry = await chat([
    { role: 'user', content: prompt },
    { role: 'assistant', content: draft.text },
    { role: 'user', content: verdict },
  ]);
  writeFileSync(finalPath, retry.text);
  usage.push({ noun: slug, call: 2, ...retry.rec });
  writeFileSync(usagePath, JSON.stringify(usage, null, 2) + '\n');
  console.log(`${slug}: retried (draft ${draft.rec.ms} ms + retry ${retry.rec.ms} ms)`);
}

console.log(`done → runs/${RUN_ID}/`);
