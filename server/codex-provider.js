import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const PROVIDER_SETTINGS = Object.freeze({
  requestedModel: 'gpt-6-astra',
  reasoningEffort: 'low',
  requestedServiceTier: 'fast',
  timeoutMs: 90_000,
  applicationRetries: 0,
  cliTransportRetriesControlled: false,
});

export const TIMING_SCOPE = 'App receipt setup, ChatGPT auth preflight, CLI generation, and shape validation; excludes HTTP body parsing and browser load/render';
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 256 * 1024;
const MAX_FINAL_BYTES = 1024 * 1024;

const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'skill_search', 'view_image',
  'image_generation', 'hooks', 'goals', 'memories', 'multi_agent', 'code_mode_host',
  'unbounded_connection_retries',
];

export function createChildEnvironment(environment = process.env) {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'CODEX_HOME',
    'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME',
    'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'SystemRoot', 'WINDIR', 'PATHEXT', 'ComSpec',
  ];
  const childEnv = {};
  for (const key of allowed) {
    if (typeof environment[key] === 'string' && environment[key]) childEnv[key] = environment[key];
  }
  return childEnv;
}

export function buildCodexArgs(finalPath) {
  return [
    'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--json', '--color', 'never',
    '-c', 'forced_login_method="chatgpt"',
    '-c', 'web_search="disabled"', '--enable', 'skip_host_skill_discovery',
    ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
    '--model', PROVIDER_SETTINGS.requestedModel,
    '-c', `model_reasoning_effort="${PROVIDER_SETTINGS.reasoningEffort}"`,
    '--enable', 'fast_mode', '-c', 'service_tier="fast"',
    '-C', join(finalPath, '..'), '-o', finalPath, '-',
  ];
}

function appendBounded(state, chunk, limit) {
  const buffer = Buffer.from(chunk);
  state.totalBytes += buffer.length;
  const available = Math.max(0, limit - state.storedBytes);
  if (available) {
    state.chunks.push(buffer.subarray(0, available));
    state.storedBytes += Math.min(buffer.length, available);
  }
  if (state.totalBytes > limit) state.truncated = true;
}

function killProcessGroup(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
}

async function checkChatGptLogin({ spawn, signal, timeoutMs }) {
  if (signal?.aborted) return { cancelled: true };
  let child;
  try {
    child = spawn('codex', ['login', 'status'], {
      stdio: ['ignore', 'pipe', 'pipe'], env: createChildEnvironment(),
    });
  } catch (error) { return { launchError: error.message }; }
  let text = '';
  child.stdout.on('data', (chunk) => { text += chunk.toString('utf8').slice(0, 4096 - text.length); });
  child.stderr.on('data', (chunk) => { text += chunk.toString('utf8').slice(0, 4096 - text.length); });
  const abort = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const exit = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ code: null, error: error.message }));
    child.once('close', (code) => resolve({ code }));
  });
  clearTimeout(timer);
  signal?.removeEventListener('abort', abort);
  if (signal?.aborted) return { cancelled: true };
  if (timedOut) return { timedOut: true, stderr: text };
  if (exit.error) return { launchError: exit.error };
  if (exit.code !== 0 || !/Logged in using ChatGPT/i.test(text)) return { authUnavailable: true, stderr: text };
  return {};
}

export async function runCodex(prompt, { signal, spawn = nodeSpawn, timeoutMs = PROVIDER_SETTINGS.timeoutMs } = {}) {
  const tempCwd = await mkdtemp(join(tmpdir(), 'blawx-app-generation-'));
  const finalPath = join(tempCwd, 'final.json');
  const stdout = { chunks: [], storedBytes: 0, totalBytes: 0, truncated: false };
  const stderr = { chunks: [], storedBytes: 0, totalBytes: 0, truncated: false };
  let child = null;
  let timedOut = false;
  let cancelled = signal?.aborted ?? false;
  let launchError = null;
  let stdinError = null;
  let outputLimitExceeded = false;
  const startedNs = process.hrtime.bigint();

  try {
    const preflightStartNs = process.hrtime.bigint();
    const preflight = await checkChatGptLogin({ spawn, signal, timeoutMs: Math.min(timeoutMs, 5_000) });
    const preflightMs = Number(process.hrtime.bigint() - preflightStartNs) / 1e6;
    cancelled ||= Boolean(preflight.cancelled);
    launchError = preflight.launchError ?? null;
    if (preflight.timedOut) {
      return {
        exit: { code: null, signal: null }, timedOut: true, cancelled: false,
        launchError: null, authUnavailable: false, stdinError: null, outputLimitExceeded: false,
        stdout: '', stdoutBytes: 0, stdoutTruncated: false,
        stderr: preflight.stderr ?? '', stderrBytes: Buffer.byteLength(preflight.stderr ?? ''), stderrTruncated: false,
        finalRaw: null, finalTruncated: false, preflightMs,
        generationMs: Number(process.hrtime.bigint() - startedNs) / 1e6,
      };
    }
    if (preflight.authUnavailable) {
      return {
        exit: { code: null, signal: null }, timedOut: false, cancelled: false,
        launchError: null, authUnavailable: true, stdinError: null, outputLimitExceeded: false,
        stdout: '', stdoutBytes: 0, stdoutTruncated: false,
        stderr: preflight.stderr ?? '', stderrBytes: Buffer.byteLength(preflight.stderr ?? ''), stderrTruncated: false,
        finalRaw: null, finalTruncated: false, preflightMs,
        generationMs: Number(process.hrtime.bigint() - startedNs) / 1e6,
      };
    }
    if (!cancelled && !launchError) {
      try {
        child = spawn('codex', buildCodexArgs(finalPath), {
          cwd: tempCwd,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: createChildEnvironment(),
        });
      } catch (error) {
        launchError = error.message;
      }
    }

    const abort = () => { cancelled = true; killProcessGroup(child); };
    signal?.addEventListener('abort', abort, { once: true });
    let exit = { code: null, signal: null };
    if (child) {
      child.on('error', (error) => { launchError = error.message; });
      child.stdin.on('error', (error) => { stdinError = error.message; });
      child.stdout.on('data', (chunk) => {
        appendBounded(stdout, chunk, MAX_STDOUT_BYTES);
        if (stdout.truncated) { outputLimitExceeded = true; killProcessGroup(child); }
      });
      child.stderr.on('data', (chunk) => appendBounded(stderr, chunk, MAX_STDERR_BYTES));
      child.stdin.end(prompt);
      const remainingMs = Math.max(1, timeoutMs - Number(process.hrtime.bigint() - startedNs) / 1e6);
      const timer = setTimeout(() => { timedOut = true; killProcessGroup(child); }, remainingMs);
      exit = await new Promise((resolve) => child.once('close', (code, childSignal) => resolve({ code, signal: childSignal })));
      clearTimeout(timer);
      child = null;
    }
    signal?.removeEventListener('abort', abort);

    let finalRaw = null;
    let finalTruncated = false;
    try {
      const handle = await open(finalPath, 'r');
      try {
        const stats = await handle.stat();
        finalTruncated = stats.size > MAX_FINAL_BYTES;
        const value = Buffer.alloc(Math.min(stats.size, MAX_FINAL_BYTES));
        const { bytesRead } = await handle.read(value, 0, value.length, 0);
        finalRaw = value.subarray(0, bytesRead).toString('utf8');
      } finally { await handle.close(); }
    } catch {}
    return {
      exit, timedOut, cancelled, launchError, authUnavailable: false, stdinError, outputLimitExceeded,
      stdout: Buffer.concat(stdout.chunks).toString('utf8'), stdoutBytes: stdout.totalBytes, stdoutTruncated: stdout.truncated,
      stderr: Buffer.concat(stderr.chunks).toString('utf8'), stderrBytes: stderr.totalBytes, stderrTruncated: stderr.truncated,
      finalRaw, finalTruncated, preflightMs,
      generationMs: Number(process.hrtime.bigint() - startedNs) / 1e6,
    };
  } finally {
    killProcessGroup(child);
    await rm(tempCwd, { recursive: true, force: true });
  }
}
