// probe15: the anti-overthinking system prompt — the one untested lever left
// after probes 9-14. Same prompt-v2 packet as probe8/probe10, same runtime
// profile as probe10 (claude-sonnet-5, thinking adaptive, default effort,
// max_tokens 8192), plus ONE change: a system prompt asking for bounded,
// single-pass deliberation. Hypothesis: the raw-API thinking runaway (8k-cap
// blowouts, 85-100s calls, $0.10-0.20/term) is tamed toward the
// subscription-harness profile (probe8: clean answers, modest deliberation).
//
// Protocol (identical to probe10/probe14): single shot, then
// retry-feedback.ts --max-depth=6 on the draft; if not mechanically clean,
// one retry with the deterministic feedback as a follow-up turn. Final
// response lands in responses/, first drafts in responses-call1/, per-call
// tokens + thinking/text split + wall-clock in usage.json.
//
// Usage: npx tsx scripts/run-probe15-sysprompt.ts
//   Reads ANTHROPIC_API_KEY from env or ../api/.dev.vars. Re-runnable:
//   skips nouns whose responses/<slug>.txt already exists.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent, setGlobalDispatcher } from 'undici';

// Long thinking phases can exceed undici's default idle timeouts.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

const ROOT = join(import.meta.dirname, '..');
const RUNS = join(ROOT, 'runs');
const RUN_ID = 'probe15-16char-sysprompt';
const SOURCE_RUN = 'probe8-16char-nomask';
const MODEL = 'claude-sonnet-5';

// --- Key loading: env, then ../api/.dev.vars ---
if (!process.env.ANTHROPIC_API_KEY) {
  const devVars = join(ROOT, '..', 'api', '.dev.vars');
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error('ANTHROPIC_API_KEY not set (env or ../api/.dev.vars)');
  process.exit(1);
}

// The experimental variable. Everything else matches probe10 byte-for-byte.
// Asks for bounded single-pass deliberation, NOT no thinking — probes 9/13
// proved zero-thinking fails; probe10/12 proved unbounded thinking runs away.
const SYSTEM_PROMPT = `You are a voxel-grid authoring service inside a production pipeline. Requests are machine-generated and your response is parsed by a deterministic validator — only the three view blocks matter, in exactly the format the request specifies.

Latency and token spend are user-facing costs here. Think only as much as the task needs: plan the object's design briefly, then write the rows carefully in a single pass, checking each row's width and each block's row count as you write. Do not re-derive or re-verify the whole design repeatedly — one careful pass plus a quick dimension check is enough. When in doubt, write the answer directly.`;

const runDir = join(RUNS, RUN_ID);
mkdirSync(join(runDir, 'prompts'), { recursive: true });
mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
mkdirSync(join(runDir, 'responses'), { recursive: true });
writeFileSync(join(runDir, 'sysprompt.md'), SYSTEM_PROMPT + '\n');

const slugs = readdirSync(join(RUNS, SOURCE_RUN, 'prompts'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort();
for (const slug of slugs) {
  copyFileSync(join(RUNS, SOURCE_RUN, 'prompts', `${slug}.md`), join(runDir, 'prompts', `${slug}.md`));
}

const manifest = {
  id: RUN_ID,
  label: 'probe15 16³ · no mask, prompt v2 — anti-overthinking system prompt',
  date: '2026-07-20',
  pipeline:
    "probe8's prompt v2 rerun at probe10's exact API profile (claude-sonnet-5, thinking adaptive, default effort, max_tokens 8192) with one change: an anti-overthinking system prompt (sysprompt.md) asking for bounded single-pass deliberation. Single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6), strict lift. A/B vs probe10 (no system prompt): does a system prompt tame the raw-API thinking runaway toward subscription-harness levels? Per-call tokens, thinking/text char split, and wall-clock in usage.json.",
  conditions: {
    grid: '16',
    encoding: 'char',
    model: MODEL,
    prompt: 'full-authorship v2 (byte-identical to probe8) + anti-overthinking system prompt',
    source: 'none — noun only',
    method:
      'single-shot + 1 deterministic-feedback retry; direct API, adaptive thinking, default effort, max_tokens 8192, system prompt (sysprompt.md) — live spend on ANTHROPIC_API_KEY, signed off 2026-07-20',
  },
};
writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');

type Msg = { role: 'user' | 'assistant'; content: string };

type CallRecord = {
  noun: string;
  call: 1 | 2;
  ms: number;
  in: number;
  out: number;
  thinkingChars: number;
  textChars: number;
  stopReason: string | null;
};

async function chat(messages: Msg[]): Promise<{ text: string; rec: Omit<CallRecord, 'noun' | 'call'> }> {
  const t0 = performance.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);

  let text = '';
  let thinkingChars = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk as Uint8Array, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '') continue;
      const evt = JSON.parse(data) as {
        type: string;
        message?: { usage?: { input_tokens?: number } };
        delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string };
        usage?: { output_tokens?: number };
      };
      if (evt.type === 'message_start') inputTokens = evt.message?.usage?.input_tokens ?? 0;
      if (evt.type === 'content_block_delta') {
        if (evt.delta?.type === 'text_delta') text += evt.delta.text ?? '';
        if (evt.delta?.type === 'thinking_delta') thinkingChars += (evt.delta.thinking ?? '').length;
      }
      if (evt.type === 'message_delta') {
        if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
      }
    }
  }
  return {
    text,
    rec: {
      ms: Math.round(performance.now() - t0),
      in: inputTokens,
      out: outputTokens,
      thinkingChars,
      textChars: text.length,
      stopReason,
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
    console.log(`${slug}: clean first draft (${draft.rec.ms} ms, ${draft.rec.out} out, ~${draft.rec.thinkingChars} thinking chars)`);
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
