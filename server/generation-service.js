import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expandLoftProgram } from '../src/loft-program.js';
import { validateVoxels } from '../src/voxels.js';
import { parseEventsJsonl, summarizeProtocol } from '../scripts/run-voxel-pilot.mjs';
import { PROVIDER_SETTINGS, TIMING_SCOPE, buildCodexArgs, runCodex } from './codex-provider.js';
import { normalizeSubject, substituteSubject } from './prompt-template.js';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from './private-data-root.js';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

export class GenerationError extends Error {
  constructor(code, message, requestId, details = {}) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

function safeText(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]?\s*[^\s"']+/gi, '$1 [REDACTED]');
}

export function createGenerationService({
  root = DEFAULT_ROOT,
  dataRoot,
  allowTestDataRoot = false,
  provider = runCodex,
  id = randomUUID,
  now = () => new Date(),
} = {}) {
  let active = null;
  const runsDir = join(resolvePrivateDataRoot({ sourceRoot: root, dataRoot, allowTestDataRoot }), 'generation');
  const templatePath = join(root, 'server', 'prompts', 'voxel-loft.txt');

  async function generate(input, { signal } = {}) {
    const prompt = normalizeSubject(input);
    if (active) throw new GenerationError('busy', 'Another generation is already running.', null);
    const requestId = id();
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      throw new GenerationError('unavailable', 'Could not create a safe generation receipt.', null);
    }
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', relayAbort, { once: true });
    if (signal?.aborted) relayAbort();
    const runDir = join(runsDir, requestId);
    active = { requestId, controller };
    const startedAt = now().toISOString();
    const serviceStartedNs = process.hrtime.bigint();
    let sourcePrompt = null;
    let outcome = null;
    let record = null;
    let runDirectoryCreated = false;
    try {
      await ensurePrivateDirectory(runsDir);
      await mkdir(runDir, { recursive: false, mode: 0o700 });
      runDirectoryCreated = true;
      const template = await readFile(templatePath, 'utf8');
      sourcePrompt = substituteSubject(template, prompt);
      await Promise.all([
        writeFile(join(runDir, 'prompt.txt'), sourcePrompt, { flag: 'wx', mode: PRIVATE_FILE_MODE }),
        writeFile(join(runDir, 'settings.json'), `${JSON.stringify(PROVIDER_SETTINGS, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE }),
      ]);
      outcome = await provider(sourcePrompt, { signal: controller.signal, timeoutMs: PROVIDER_SETTINGS.timeoutMs });
      const parsed = parseEventsJsonl(outcome.stdout ?? '');
      const protocol = summarizeProtocol(parsed.events);
      let sourceProgram = null;
      let model = null;
      let diagnostics = null;
      let validationError = null;
      try {
        if (!outcome.finalRaw || outcome.finalTruncated) throw new Error('Generator did not return a complete bounded final response.');
        sourceProgram = JSON.parse(outcome.finalRaw);
        model = expandLoftProgram(sourceProgram, {
          id: requestId, prompt, method: 'voxel-loft', provenance: 'generated',
        });
        diagnostics = validateVoxels(model);
        if (!diagnostics.valid) throw new Error('Generated voxel model failed schema validation.');
      } catch (error) { validationError = error.message; }

      const generationMs = Number(process.hrtime.bigint() - serviceStartedNs) / 1e6;
      const status = outcome.cancelled ? 'cancelled'
        : outcome.timedOut ? 'timed-out'
        : (!outcome.launchError && outcome.exit?.code === 0 && !outcome.stdinError && !outcome.outputLimitExceeded &&
          parsed.malformedLines.length === 0 && protocol.toolUseViolations.length === 0 && !validationError) ? 'generated-schema-valid'
          : 'failed';
      record = {
        requestId, prompt, startedAt, finishedAt: now().toISOString(), status,
        settings: PROVIDER_SETTINGS, runtime: 'codex-cli-subscription', generationMs,
        timingScope: TIMING_SCOPE, requestedModel: PROVIDER_SETTINGS.requestedModel,
        actualModel: protocol.model, requestedServiceTier: PROVIDER_SETTINGS.requestedServiceTier,
        actualServiceTier: protocol.serviceTier, usage: protocol.usage,
        applicationRetries: 0, cliTransportRetriesControlled: false,
        launch: { command: 'codex', args: buildCodexArgs('<isolated-temp>/final.json') },
        authUnavailable: Boolean(outcome.authUnavailable), providerDurationMs: outcome.generationMs,
        authPreflightMs: outcome.preflightMs ?? null,
        exit: outcome.exit, timedOut: outcome.timedOut, cancelled: outcome.cancelled,
        launchError: safeText(outcome.launchError), stdinError: safeText(outcome.stdinError),
        stdoutBytes: outcome.stdoutBytes, stdoutTruncated: outcome.stdoutTruncated,
        stderrBytes: outcome.stderrBytes, stderrTruncated: outcome.stderrTruncated,
        finalTruncated: outcome.finalTruncated, malformedEventLines: parsed.malformedLines,
        protocolToolUseViolations: protocol.toolUseViolations, validationError, diagnostics,
        qualityPass: null,
      };
      await Promise.all([
        writeFile(join(runDir, 'events.jsonl'), outcome.stdout ?? '', { flag: 'wx', mode: PRIVATE_FILE_MODE }),
        writeFile(join(runDir, 'stdout.log'), outcome.stdout ?? '', { flag: 'wx', mode: PRIVATE_FILE_MODE }),
        writeFile(join(runDir, 'stderr.log'), safeText(outcome.stderr), { flag: 'wx', mode: PRIVATE_FILE_MODE }),
        writeFile(join(runDir, 'final.json'), outcome.finalRaw ?? '', { flag: 'wx', mode: PRIVATE_FILE_MODE }),
        writeFile(join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE }),
      ]);

      if (outcome.launchError) throw new GenerationError('unavailable', 'Codex CLI is unavailable.', requestId);
      if (outcome.authUnavailable) throw new GenerationError('unavailable', 'ChatGPT authentication is unavailable.', requestId);
      if (status === 'cancelled') throw new GenerationError('cancelled', 'Generation was cancelled.', requestId);
      if (status === 'timed-out') throw new GenerationError('timeout', 'Generation exceeded the 90 second limit.', requestId);
      if (outcome.exit?.code !== 0 || outcome.stdinError) {
        const authFailure = /not logged in|login required|authentication failed|unauthorized|credential[^\n]*(?:missing|invalid|expired)/i.test(outcome.stderr ?? '');
        throw new GenerationError(authFailure ? 'unavailable' : 'generator-failed', authFailure ? 'ChatGPT authentication is unavailable.' : 'Generator failed.', requestId);
      }
      if (validationError || parsed.malformedLines.length || protocol.toolUseViolations.length || outcome.outputLimitExceeded) {
        throw new GenerationError('invalid-output', 'Generator returned an invalid result.', requestId);
      }
      model.meta = {
        ...(model.meta ?? {}), runtime: 'codex-cli-subscription', generationMs,
        timingScope: TIMING_SCOPE, requestedModel: PROVIDER_SETTINGS.requestedModel,
        actualModel: protocol.model, usage: protocol.usage,
        limitations: 'Raw cubic voxels; schema validity does not establish visual quality or physical buildability.',
      };
      await writeFile(join(runDir, 'model.json'), `${JSON.stringify({ sourceProgram, model }, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE });
      return {
        requestId, prompt, model, sourceProgram, diagnostics,
        metadata: {
          runtime: 'codex-cli-subscription', generationMs, timingScope: TIMING_SCOPE,
          requestedModel: PROVIDER_SETTINGS.requestedModel, actualModel: protocol.model,
          reasoningEffort: PROVIDER_SETTINGS.reasoningEffort,
          requestedServiceTier: PROVIDER_SETTINGS.requestedServiceTier, actualServiceTier: protocol.serviceTier,
          usage: protocol.usage, applicationRetries: 0, cliTransportRetriesControlled: false, qualityPass: null,
        },
      };
    } catch (error) {
      if (!record && runDirectoryCreated) {
        record = {
          requestId, prompt, startedAt, finishedAt: now().toISOString(),
          status: controller.signal.aborted ? 'cancelled-before-launch' : 'failed-before-launch',
          settings: PROVIDER_SETTINGS, runtime: 'codex-cli-subscription',
          failure: safeText(error.message), qualityPass: null,
        };
        await writeFile(join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE });
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', relayAbort);
      if (active?.requestId === requestId) active = null;
    }
  }

  return { generate, cancel: () => active?.controller.abort(), isBusy: () => Boolean(active) };
}
