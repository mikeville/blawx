import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile as nodeWriteFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEventsJsonl, summarizeProtocol } from '../scripts/run-voxel-pilot.mjs';
import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from '../src/semantic-guide.js';
import {
  buildSemanticNamingPrompt,
  createSemanticNamingSummary,
  parseSemanticNamingResult,
} from '../src/semantic-guide-summary.js';
import { runCodex } from './codex-provider.js';
import {
  CONSENSUS_NAMING_STAGE_ENVELOPE,
  NAMING_POLICY,
  NAMING_PHASE_POLICIES,
  NAMING_STAGE_ENVELOPE,
  PARALLEL_FIXED_NAMING_POLICY,
  PARALLEL_FIXED_NAMING_STAGE_ENVELOPE,
  createNamingApiRequest,
  createNamingStageReservation,
  createParallelFixedNamingStageReservation,
  estimateNamingUsageCost,
  validateNamingImages,
} from './naming-budget.js';
import {
  renderSemanticGuideChapters,
  renderSemanticGuideImages,
  renderSemanticGuideReferenceChapters,
} from './semantic-guide-render.js';
import { buildSemanticCaptionPrompt, parseSemanticCaptionResult } from './semantic-caption.js';
import { buildSemanticReferenceCaptionPrompt } from './semantic-reference-caption.js';
import { buildSemanticConsensusPrompt } from './semantic-consensus.js';
import { refineSemanticLabelDetails } from '../src/semantic-label-details.js';
import { createLocalSemanticProposal } from '../src/semantic-local-grouping.js';
import { generalizeSemanticAnnotation } from '../src/semantic-local-consensus.js';
import { buildFastSemanticCaptionPrompt } from './semantic-fast-caption.js';
import { buildSemanticOverviewCaptionPrompt } from './semantic-overview-caption.js';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from './private-data-root.js';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');
const RUNTIME = 'codex-cli-subscription';
const TIMING_SCOPE = 'Private receipt setup, provider inference, protocol parsing, and semantic annotation validation; excludes HTTP body parsing and browser application';
const FINGERPRINT = /^[a-f0-9]{64}$/;
const STATIC_FILE = /^[a-zA-Z0-9_-]+\.json$/;
const CAPTION_MAX_SECTIONS = 12;
const LEGACY_STRATEGY = 'legacy-two-stage';
const CONSENSUS_STRATEGY = 'consensus-v1';
const PARALLEL_FIXED_STRATEGY = PARALLEL_FIXED_NAMING_POLICY.strategy;
const PARALLEL_GROUPING_VERSION = PARALLEL_FIXED_NAMING_POLICY.groupingVersion;
const PARALLEL_CACHE_IDENTITY = `${PARALLEL_FIXED_STRATEGY}:grouping-${PARALLEL_GROUPING_VERSION}`;

export const SEMANTIC_GUIDE_SETTINGS = Object.freeze({
  requestedModel: NAMING_POLICY.model,
  reasoningEffort: NAMING_POLICY.reasoningEffort,
  requestedServiceTier: NAMING_POLICY.serviceTier,
  timeoutMs: 90_000,
  applicationRetries: 0,
  cliTransportRetriesControlled: false,
  task: 'semantic-guide-section-naming',
  namingPolicy: 'broad-when-ambiguous-v1',
  maxSections: 64,
  output: 'json-only',
  phases: NAMING_PHASE_POLICIES,
  stageEnvelope: NAMING_STAGE_ENVELOPE,
  maxApiCostUsd: NAMING_POLICY.maxCostUsd,
  pricingAsOf: NAMING_POLICY.pricingAsOf,
});

export const CONSENSUS_SEMANTIC_GUIDE_SETTINGS = Object.freeze({
  ...SEMANTIC_GUIDE_SETTINGS,
  namingPolicy: CONSENSUS_STRATEGY,
  phases: CONSENSUS_NAMING_STAGE_ENVELOPE.phases,
  stageEnvelope: CONSENSUS_NAMING_STAGE_ENVELOPE,
  maxApiCostUsd: CONSENSUS_NAMING_STAGE_ENVELOPE.ceilingUsd,
});

export const PARALLEL_FIXED_SEMANTIC_GUIDE_SETTINGS = Object.freeze({
  ...SEMANTIC_GUIDE_SETTINGS,
  namingPolicy: PARALLEL_FIXED_STRATEGY,
  strategy: PARALLEL_FIXED_STRATEGY,
  groupingVersion: PARALLEL_GROUPING_VERSION,
  cacheIdentity: PARALLEL_CACHE_IDENTITY,
  phases: PARALLEL_FIXED_NAMING_STAGE_ENVELOPE.phases,
  stageEnvelope: PARALLEL_FIXED_NAMING_STAGE_ENVELOPE,
  maxApiCostUsd: PARALLEL_FIXED_NAMING_STAGE_ENVELOPE.ceilingUsd,
});

export class SemanticGuideError extends Error {
  constructor(code, message, requestId = null) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}

function safeText(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]?\s*[^\s"']+/gi, '$1 [REDACTED]');
}

function writeFile(path, data, options = {}) {
  return nodeWriteFile(path, data, { ...options, mode: PRIVATE_FILE_MODE });
}

function assertFingerprint(value) {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) {
    throw new TypeError('fingerprint must be 64 lowercase hexadecimal characters.');
  }
  return value;
}

export function buildSemanticGuidePrompt(rawInputs, options) {
  return buildSemanticNamingPrompt(rawInputs, options);
}

function parseEnvelope(value, fingerprint) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Cached semantic guide must be an object.');
  if (!value.annotation || typeof value.annotation !== 'object' || Array.isArray(value.annotation)) {
    throw new TypeError('Cached semantic guide must contain an annotation.');
  }
  if (!value.metadata || typeof value.metadata !== 'object' || Array.isArray(value.metadata)) {
    throw new TypeError('Cached semantic guide must contain metadata.');
  }
  if (value.annotation.fingerprint !== fingerprint) throw new RangeError('Cached annotation fingerprint does not match.');
  return { annotation: value.annotation, metadata: value.metadata };
}

function packetReceipt(inputs, images) {
  const packet = inputs.map(createSemanticNamingSummary);
  const serialized = JSON.stringify({ packet, images });
  return {
    packet,
    projectionVersion: packet[0].version,
    projectionHash: createHash('sha256').update(serialized).digest('hex'),
  };
}

function imageReceipt(images, prefix) {
  validateNamingImages(images);
  return images.map((image, index) => ({
    file: `${prefix}-view-${index + 1}.png`,
    sha256: createHash('sha256').update(image.png).digest('hex'),
    bytes: image.png.length,
    width: image.width,
    height: image.height,
    view: image.view,
  }));
}

function aggregateUsage(values) {
  const result = {};
  for (const usage of values.filter(Boolean)) for (const [key, value] of Object.entries(usage)) {
    if (Number.isFinite(value)) result[key] = (result[key] ?? 0) + value;
  }
  return Object.keys(result).length ? result : null;
}

function inspectOutcome(outcome, parseFinal) {
  const parsed = parseEventsJsonl(outcome?.stdout ?? '');
  const protocol = summarizeProtocol(parsed.events);
  const actualModel = protocol.model ?? outcome?.actual?.model ?? null;
  const actualServiceTier = protocol.serviceTier ?? outcome?.actual?.serviceTier ?? null;
  const providerMismatch = actualModel && !compatibleActualModel(actualModel)
    ? `Provider reported incompatible model ${safeText(actualModel)}.`
    : actualServiceTier && actualServiceTier !== NAMING_POLICY.serviceTier
      ? `Provider reported incompatible service tier ${safeText(actualServiceTier)}.`
      : null;
  let value = null;
  let validationError = null;
  try {
    if (!outcome?.finalRaw || outcome.finalTruncated) throw new Error('Annotator did not return a complete bounded final response.');
    if (providerMismatch) throw new Error(providerMismatch);
    value = parseFinal(outcome.finalRaw);
  } catch (error) { validationError = safeText(error.message); }
  const cancelled = Boolean(outcome?.cancelled);
  const successful = !cancelled && !outcome?.launchError && !outcome?.authUnavailable && outcome?.exit?.code === 0
    && !outcome?.stdinError && !outcome?.outputLimitExceeded && !outcome?.timedOut && !outcome?.finalTruncated
    && parsed.malformedLines.length === 0 && protocol.toolUseViolations.length === 0 && !validationError;
  return {
    value, parsed, protocol, actualModel, actualServiceTier, providerMismatch, validationError,
    cancelled, successful,
  };
}

function stageFailure(outcome, inspection, requestId) {
  if (outcome?.launchError || outcome?.authUnavailable) {
    return new SemanticGuideError('unavailable', 'Semantic annotation is unavailable.', requestId);
  }
  if (inspection.cancelled) return new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
  if (outcome?.timedOut) return new SemanticGuideError('timeout', 'Semantic annotation exceeded the 90 second limit.', requestId);
  if (outcome?.exit?.code !== 0 || outcome?.stdinError) {
    const authenticationFailure = /not logged in|login required|authentication failed|unauthorized|credential[^\n]*(?:missing|invalid|expired)/i
      .test(outcome?.stderr ?? '');
    if (authenticationFailure) {
      return new SemanticGuideError('unavailable', 'Semantic annotation authentication is unavailable.', requestId);
    }
    return new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
  }
  return new SemanticGuideError('invalid-output', 'Semantic annotator returned an invalid result.', requestId);
}

function validActualUsageCost(outcome, protocol, runtime) {
  const usage = protocol.usage ?? outcome.actual?.usage;
  if (runtime !== 'openai-api' || !usage) return null;
  if (Number.isFinite(outcome.actual?.estimatedCostUsd)) {
    return {
      estimatedCostUsd: outcome.actual.estimatedCostUsd,
      pricingAsOf: outcome.actual.pricingAsOf ?? NAMING_POLICY.pricingAsOf,
      basis: 'Conservative API equivalent using reported tokens and worst-case cache-write rates; not an invoice.',
    };
  }
  try {
    const estimatedCostUsd = estimateNamingUsageCost(usage);
    return Number.isFinite(estimatedCostUsd) ? {
      estimatedCostUsd,
      pricingAsOf: NAMING_POLICY.pricingAsOf,
      basis: 'Conservative API equivalent using reported tokens and worst-case cache-write rates; not an invoice.',
    } : null;
  } catch { return null; }
}

function compatibleActualModel(value) {
  return value === NAMING_POLICY.model || /^gpt-5\.6-luna-\d{4}-\d{2}-\d{2}$/.test(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function createSemanticGuideService({
  root = DEFAULT_ROOT,
  provider = runCodex,
  renderImages = renderSemanticGuideImages,
  renderChapters = renderSemanticGuideChapters,
  renderReferenceChapters = renderSemanticGuideReferenceChapters,
  id = randomUUID,
  now = () => new Date(),
  isGenerationBusy = () => false,
  allowExperimentalInference = false,
  strategy = LEGACY_STRATEGY,
  reserveBudget = async (reservation) => ({ ...reservation, kind: 'prospective-envelope' }),
  dataRoot,
  allowTestDataRoot = false,
} = {}) {
  if (typeof allowExperimentalInference !== 'boolean') {
    throw new TypeError('allowExperimentalInference must be a boolean.');
  }
  if (![LEGACY_STRATEGY, CONSENSUS_STRATEGY, PARALLEL_FIXED_STRATEGY].includes(strategy)) {
    throw new RangeError('Semantic naming strategy must be legacy-two-stage, consensus-v1, or parallel-fixed-v1.');
  }
  if (typeof reserveBudget !== 'function') throw new TypeError('reserveBudget must be a function.');
  const settings = strategy === CONSENSUS_STRATEGY
    ? CONSENSUS_SEMANTIC_GUIDE_SETTINGS
    : strategy === PARALLEL_FIXED_STRATEGY
      ? PARALLEL_FIXED_SEMANTIC_GUIDE_SETTINGS
      : SEMANTIC_GUIDE_SETTINGS;
  let active = null;
  const semanticRunsDir = join(
    resolvePrivateDataRoot({ sourceRoot: root, dataRoot, allowTestDataRoot }),
    'semantic-guides',
  );
  const cacheDir = join(semanticRunsDir, 'cache');
  const staticDir = join(root, 'public', 'semantic-guides');

  const cacheFilename = (fingerprint) => strategy === CONSENSUS_STRATEGY
    ? `${fingerprint}.${CONSENSUS_STRATEGY}.json`
    : strategy === PARALLEL_FIXED_STRATEGY
      ? `${fingerprint}.${PARALLEL_FIXED_STRATEGY}.grouping-${PARALLEL_GROUPING_VERSION}.json`
      : `${fingerprint}.json`;

  async function lookup(fingerprint) {
    assertFingerprint(fingerprint);
    try {
      const cached = parseEnvelope(await readJson(join(cacheDir, cacheFilename(fingerprint))), fingerprint);
      const staleParallelIdentity = strategy === PARALLEL_FIXED_STRATEGY && (
        cached.metadata.strategy !== PARALLEL_FIXED_STRATEGY
        || cached.metadata.groupingVersion !== PARALLEL_GROUPING_VERSION
        || cached.metadata.cacheIdentity !== PARALLEL_CACHE_IDENTITY
      );
      if (!staleParallelIdentity) return cached;
    } catch {}
    if (strategy === PARALLEL_FIXED_STRATEGY) {
      try {
        const consensus = parseEnvelope(
          await readJson(join(cacheDir, `${fingerprint}.${CONSENSUS_STRATEGY}.json`)),
          fingerprint,
        );
        if (consensus.metadata.namingPolicy === CONSENSUS_STRATEGY) {
          return {
            annotation: consensus.annotation,
            metadata: { ...consensus.metadata, cacheReusedFrom: CONSENSUS_STRATEGY },
          };
        }
      } catch {}
      return null;
    }
    if (strategy !== LEGACY_STRATEGY) return null;
    let index;
    try { index = await readJson(join(staticDir, 'index.json')); }
    catch { return null; }
    if (!index || index.version !== 1 || !index.entries || typeof index.entries !== 'object' || Array.isArray(index.entries)) return null;
    const filename = index.entries[fingerprint];
    if (typeof filename !== 'string' || !STATIC_FILE.test(filename)) return null;
    try { return parseEnvelope(await readJson(join(staticDir, filename)), fingerprint); }
    catch { return null; }
  }

  async function persistCache(fingerprint, envelope, requestId) {
    await ensurePrivateDirectory(cacheDir);
    const filename = cacheFilename(fingerprint);
    const temporary = join(cacheDir, `.${filename}.${requestId}.tmp`);
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, join(cacheDir, filename));
  }

  async function inferGuide(input, { signal, proposalReplay = null } = {}) {
    if (active || isGenerationBusy()) throw new SemanticGuideError('busy', 'Another local model request is already running.');
    const requestId = id();
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      throw new SemanticGuideError('unavailable', 'Could not create a safe semantic annotation receipt.');
    }
    const controller = new AbortController();
    const relayAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', relayAbort, { once: true });
    if (signal?.aborted) relayAbort();
    let settleActive;
    const settled = new Promise((resolveSettled) => { settleActive = resolveSettled; });
    active = { requestId, controller, settled };

    const runDir = join(semanticRunsDir, requestId);
    const startedAt = now().toISOString();
    const startedNs = process.hrtime.bigint();
    const stages = {};
    let compact = null;
    let proposal = null;
    let finalAnnotation = null;
    let captionAnnotation = null;
    let consensusAnnotation = null;
    let proposalBudget = null;
    let captionBudget = null;
    let proposalImages = [];
    let proposalImageMetadata = [];
    let captionImages = [];
    let captionImageMetadata = [];
    let proposalPrompt = null;
    let captionPrompt = null;
    let consensusPrompt = null;
    let proposalOutcome = null;
    let captionOutcome = null;
    let consensusOutcome = null;
    let consensusBudget = null;
    let overviewAnnotation = null;
    let isolatedAnnotation = null;
    let overviewOutcome = null;
    let isolatedOutcome = null;
    let overviewBudget = null;
    let isolatedBudget = null;
    let localConsensus = null;
    let parallelPreparationMs = null;
    let parallelProviderWallMs = null;
    let budgetReservation = null;
    let recordWritten = false;

    const providerSettings = {
      requestedModel: NAMING_POLICY.model,
      reasoningEffort: NAMING_POLICY.reasoningEffort,
      requestedServiceTier: NAMING_POLICY.serviceTier,
    };
    const writeOutcome = async (phase, outcome) => Promise.all([
      writeFile(join(runDir, `${phase}-events.jsonl`), outcome?.stdout ?? '', { flag: 'wx' }),
      writeFile(join(runDir, `${phase}-stdout.log`), outcome?.stdout ?? '', { flag: 'wx' }),
      writeFile(join(runDir, `${phase}-stderr.log`), safeText(outcome?.stderr), { flag: 'wx' }),
      writeFile(join(runDir, `${phase}-final.json`), outcome?.finalRaw ?? '', { flag: 'wx' }),
    ]);
    const stageReceipt = (phase, outcome, inspection, budget, images, extra = {}) => ({
      phase,
      ...extra,
      status: inspection.cancelled ? 'cancelled' : inspection.successful ? 'valid'
        : outcome?.timedOut ? 'timed-out' : 'failed',
      budget,
      images,
      requestedModel: NAMING_POLICY.model,
      actualModel: inspection.actualModel,
      reasoningEffort: NAMING_POLICY.reasoningEffort,
      requestedServiceTier: NAMING_POLICY.serviceTier,
      actualServiceTier: inspection.actualServiceTier,
      usage: inspection.protocol.usage ?? outcome?.actual?.usage ?? null,
      usageCostEstimate: validActualUsageCost(
        outcome ?? {}, inspection.protocol, outcome?.runtime === 'openai-api' ? 'openai-api' : RUNTIME,
      ),
      runtime: outcome?.runtime === 'openai-api' ? 'openai-api' : RUNTIME,
      providerDurationMs: outcome?.generationMs ?? null,
      authPreflightMs: outcome?.preflightMs ?? null,
      authUnavailable: Boolean(outcome?.authUnavailable),
      exit: outcome?.exit ?? null,
      timedOut: Boolean(outcome?.timedOut),
      cancelled: Boolean(inspection.cancelled),
      launchError: safeText(outcome?.launchError),
      stdinError: safeText(outcome?.stdinError),
      outputLimitExceeded: Boolean(outcome?.outputLimitExceeded),
      stdoutBytes: outcome?.stdoutBytes ?? Buffer.byteLength(outcome?.stdout ?? ''),
      stdoutTruncated: Boolean(outcome?.stdoutTruncated),
      stderrBytes: outcome?.stderrBytes ?? Buffer.byteLength(outcome?.stderr ?? ''),
      stderrTruncated: Boolean(outcome?.stderrTruncated),
      finalTruncated: Boolean(outcome?.finalTruncated),
      apiResponse: outcome?.apiResponse ?? null,
      providerMismatch: inspection.providerMismatch,
      malformedEventLines: inspection.parsed.malformedLines,
      protocolToolUseViolations: inspection.protocol.toolUseViolations,
      validationError: inspection.validationError,
    });

    try {
      if (settings.stageEnvelope.maxCostUsd > settings.maxApiCostUsd) {
        throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
      }
      if (input.protectedRanges.length > CAPTION_MAX_SECTIONS) {
        throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
      }
      await ensurePrivateDirectory(semanticRunsDir);
      await mkdir(runDir, { recursive: false, mode: 0o700 });
      if (strategy === CONSENSUS_STRATEGY || strategy === PARALLEL_FIXED_STRATEGY) {
        const requestedReservation = strategy === CONSENSUS_STRATEGY
          ? createNamingStageReservation(requestId)
          : createParallelFixedNamingStageReservation(requestId);
        budgetReservation = await reserveBudget(requestedReservation);
        if (!budgetReservation || typeof budgetReservation !== 'object'
          || budgetReservation.requestId !== requestId
          || budgetReservation.strategy !== strategy
          || (strategy === PARALLEL_FIXED_STRATEGY
            && budgetReservation.groupingVersion !== PARALLEL_GROUPING_VERSION)
          || !Number.isFinite(budgetReservation.amountUsd)
          || budgetReservation.amountUsd < settings.stageEnvelope.maxCostUsd) {
          throw new SemanticGuideError('unavailable', 'Semantic annotation budget is unavailable.', requestId);
        }
      }
      await Promise.all([
        writeFile(join(runDir, 'input.json'), `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx' }),
        writeFile(join(runDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx' }),
        ...(budgetReservation ? [writeFile(
          join(runDir, 'budget-reservation.json'),
          `${JSON.stringify(budgetReservation, null, 2)}\n`,
          { flag: 'wx' },
        )] : []),
      ]);
      if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);

      if (strategy === PARALLEL_FIXED_STRATEGY) {
        if (proposalReplay) throw new TypeError('Parallel fixed naming uses its local range planner and does not accept proposal replay.');
        proposal = createLocalSemanticProposal(input);
        stages.localGrouping = {
          phase: 'local-grouping', status: 'valid', runtime: 'deterministic-local',
          version: PARALLEL_GROUPING_VERSION,
          ranges: proposal.sections.map(({ startStepId, endStepId }) => [startStepId, endStepId]),
        };

        [captionImages, proposalImages] = await Promise.all([
          renderReferenceChapters(input, proposal),
          renderImages(input),
        ]);
        if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
        if (!Array.isArray(captionImages) || captionImages.length < 1 || captionImages.length > NAMING_POLICY.maxImages
          || !Array.isArray(proposalImages) || proposalImages.length !== NAMING_POLICY.maxImages) {
          throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
        }
        captionImageMetadata = imageReceipt(captionImages, 'isolated');
        proposalImageMetadata = imageReceipt(proposalImages, 'overview');
        captionPrompt = buildFastSemanticCaptionPrompt(input, proposal, captionImages);
        proposalPrompt = buildSemanticOverviewCaptionPrompt(input, proposal, proposalImages);
        const fixedRangePacket = {
          version: PARALLEL_FIXED_STRATEGY,
          groupingVersion: PARALLEL_GROUPING_VERSION,
          fingerprint: input.fingerprint,
          ranges: proposal.sections.map(({ startStepId, endStepId }) => [startStepId, endStepId]),
          isolatedImages: captionImageMetadata,
          overviewImages: proposalImageMetadata,
        };
        compact = {
          packet: fixedRangePacket,
          projectionVersion: PARALLEL_CACHE_IDENTITY,
          projectionHash: createHash('sha256').update(JSON.stringify(fixedRangePacket)).digest('hex'),
        };
        ({ budget: isolatedBudget } = createNamingApiRequest(captionPrompt, {
          images: captionImages, phase: 'captions',
        }));
        ({ budget: overviewBudget } = createNamingApiRequest(proposalPrompt, {
          images: proposalImages, phase: 'proposal',
        }));
        const combinedRequestMaxCostUsd = isolatedBudget.maxCostUsd + overviewBudget.maxCostUsd;
        if (combinedRequestMaxCostUsd > PARALLEL_FIXED_NAMING_STAGE_ENVELOPE.maxCostUsd) {
          throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
        }
        stages.isolated = {
          phase: 'isolated', providerPhase: 'captions', status: 'prepared', budget: isolatedBudget,
          images: captionImageMetadata, requestedModel: NAMING_POLICY.model,
          reasoningEffort: NAMING_POLICY.reasoningEffort,
          requestedServiceTier: NAMING_POLICY.serviceTier, usage: null,
        };
        stages.overview = {
          phase: 'overview', providerPhase: 'proposal', status: 'prepared', budget: overviewBudget,
          images: proposalImageMetadata, requestedModel: NAMING_POLICY.model,
          reasoningEffort: NAMING_POLICY.reasoningEffort,
          requestedServiceTier: NAMING_POLICY.serviceTier, usage: null,
        };
        await Promise.all([
          writeFile(join(runDir, 'local-proposal-annotation.json'), `${JSON.stringify(proposal, null, 2)}\n`, { flag: 'wx' }),
          writeFile(join(runDir, 'isolated-prompt.txt'), captionPrompt, { flag: 'wx' }),
          writeFile(join(runDir, 'overview-prompt.txt'), proposalPrompt, { flag: 'wx' }),
          writeFile(join(runDir, 'compact-packet.json'), `${JSON.stringify(compact, null, 2)}\n`, { flag: 'wx' }),
          ...captionImageMetadata.map((image, index) => writeFile(join(runDir, image.file), captionImages[index].png, { flag: 'wx' })),
          ...proposalImageMetadata.map((image, index) => writeFile(join(runDir, image.file), proposalImages[index].png, { flag: 'wx' })),
        ]);
        if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);

        parallelPreparationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
        const providerStartedNs = process.hrtime.bigint();
        const providerCalls = [
          Promise.resolve().then(() => provider(captionPrompt, {
            signal: controller.signal,
            timeoutMs: settings.timeoutMs,
            settings: providerSettings,
            images: captionImages,
            phase: 'captions',
            semanticRole: 'isolated',
          })),
          Promise.resolve().then(() => provider(proposalPrompt, {
            signal: controller.signal,
            timeoutMs: settings.timeoutMs,
            settings: providerSettings,
            images: proposalImages,
            phase: 'proposal',
            semanticRole: 'overview',
          })),
        ];
        const settledProviders = await Promise.allSettled(providerCalls);
        parallelProviderWallMs = Number(process.hrtime.bigint() - providerStartedNs) / 1e6;
        const rejectedOutcome = (reason) => ({
          exit: null, timedOut: false, cancelled: controller.signal.aborted,
          launchError: safeText(reason instanceof Error ? reason.message : reason),
          authUnavailable: false, stdinError: null, outputLimitExceeded: false,
          stdout: '', stdoutBytes: 0, stdoutTruncated: false,
          stderr: '', stderrBytes: 0, stderrTruncated: false,
          finalRaw: null, finalTruncated: false,
        });
        isolatedOutcome = settledProviders[0].status === 'fulfilled'
          ? settledProviders[0].value : rejectedOutcome(settledProviders[0].reason);
        overviewOutcome = settledProviders[1].status === 'fulfilled'
          ? settledProviders[1].value : rejectedOutcome(settledProviders[1].reason);
        const isolatedInspection = inspectOutcome(
          isolatedOutcome, (raw) => parseSemanticCaptionResult(input, proposal, raw),
        );
        const overviewInspection = inspectOutcome(
          overviewOutcome, (raw) => parseSemanticCaptionResult(input, proposal, raw),
        );
        if (controller.signal.aborted) {
          isolatedInspection.cancelled = true;
          overviewInspection.cancelled = true;
        }
        isolatedAnnotation = isolatedInspection.successful ? isolatedInspection.value : null;
        overviewAnnotation = overviewInspection.successful ? overviewInspection.value : null;
        stages.isolated = stageReceipt(
          'isolated', isolatedOutcome, isolatedInspection, isolatedBudget, captionImageMetadata,
          { providerPhase: 'captions' },
        );
        stages.overview = stageReceipt(
          'overview', overviewOutcome, overviewInspection, overviewBudget, proposalImageMetadata,
          { providerPhase: 'proposal' },
        );
        await Promise.all([
          writeOutcome('isolated', isolatedOutcome),
          writeOutcome('overview', overviewOutcome),
        ]);
        if (controller.signal.aborted) {
          throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
        }
        if (!isolatedInspection.successful || isolatedInspection.cancelled) {
          throw stageFailure(isolatedOutcome, isolatedInspection, requestId);
        }
        if (!overviewInspection.successful || overviewInspection.cancelled) {
          throw stageFailure(overviewOutcome, overviewInspection, requestId);
        }

        localConsensus = generalizeSemanticAnnotation(input, overviewAnnotation, isolatedAnnotation);
        consensusAnnotation = localConsensus.annotation;
        stages.localConsensus = {
          phase: 'local-consensus', status: 'valid', runtime: 'deterministic-local',
          decisions: localConsensus.decisions,
        };
        const refined = refineSemanticLabelDetails(input, consensusAnnotation);
        finalAnnotation = refined.annotation;
        stages.localRefinement = {
          phase: 'local-refinement', status: 'valid', runtime: 'deterministic-local',
          changes: refined.changes, evidence: refined.evidence,
        };

        const currentUsage = aggregateUsage([stages.isolated.usage, stages.overview.usage]);
        const usageComplete = Boolean(stages.isolated.usage && stages.overview.usage);
        const runtime = isolatedOutcome?.runtime === 'openai-api' || overviewOutcome?.runtime === 'openai-api'
          ? 'openai-api' : RUNTIME;
        const annotationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
        const requestBudget = {
          stageEnvelope: settings.stageEnvelope,
          isolated: isolatedBudget,
          overview: overviewBudget,
          combinedRequestMaxCostUsd,
          prospectiveMaxCostUsd: settings.stageEnvelope.maxCostUsd,
          reservation: budgetReservation,
        };
        const metadata = {
          requestId,
          namingPolicy: settings.namingPolicy,
          strategy,
          groupingVersion: PARALLEL_GROUPING_VERSION,
          cacheIdentity: PARALLEL_CACHE_IDENTITY,
          runtime,
          requestedModel: NAMING_POLICY.model,
          actualModel: stages.overview.actualModel ?? stages.isolated.actualModel ?? null,
          usage: currentUsage,
          usageComplete,
          stageUsage: { isolated: stages.isolated.usage, overview: stages.overview.usage },
          requestBudget,
          usageCostEstimate: validActualUsageCost(
            { actual: { usage: currentUsage } }, { usage: currentUsage }, runtime,
          ),
          annotationMs,
          timings: {
            preparationMs: parallelPreparationMs,
            providerWallMs: parallelProviderWallMs,
            totalMs: annotationMs,
          },
          applicationRetries: 0,
          cacheHit: false,
          reasoningEffort: NAMING_POLICY.reasoningEffort,
          requestedServiceTier: NAMING_POLICY.serviceTier,
          actualServiceTier: stages.overview.actualServiceTier ?? stages.isolated.actualServiceTier ?? null,
          timingScope: TIMING_SCOPE,
          budgetScope: 'The two-vision $0.0093512 prospective API envelope is reserved before either concurrent provider entry. Reported subscription usage is recorded separately and is not an invoice.',
        };
        const finalProjectionHash = createHash('sha256').update(JSON.stringify({
          groupingVersion: PARALLEL_GROUPING_VERSION,
          proposalRanges: proposal.sections.map(({ startStepId, endStepId }) => [startStepId, endStepId]),
          isolatedImages: captionImageMetadata,
          overviewImages: proposalImageMetadata,
          isolatedLabels: isolatedAnnotation.sections.map((section) => section.label),
          overviewLabels: overviewAnnotation.sections.map((section) => section.label),
          consensusLabels: consensusAnnotation.sections.map((section) => section.label),
        })).digest('hex');
        const record = {
          requestId,
          input,
          startedAt,
          finishedAt: now().toISOString(),
          status: 'semantic-annotation-valid',
          settings,
          ...metadata,
          compactPacket: compact.packet,
          projectionVersion: compact.projectionVersion,
          projectionHash: finalProjectionHash,
          stages,
          proposalAnnotation: proposal,
          isolatedAnnotation,
          overviewAnnotation,
          consensusAnnotation,
          finalAnnotation,
          failure: null,
        };
        await Promise.all([
          writeFile(join(runDir, 'annotation.json'), `${JSON.stringify(finalAnnotation, null, 2)}\n`, { flag: 'wx' }),
          writeFile(join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' }),
        ]);
        recordWritten = true;
        if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
        const envelope = { annotation: finalAnnotation, metadata };
        await persistCache(input.fingerprint, envelope, requestId);
        return envelope;
      }

      if (proposalReplay) {
        if (!proposalReplay || typeof proposalReplay !== 'object' || Array.isArray(proposalReplay)
          || typeof proposalReplay.finalRaw !== 'string'
          || !proposalReplay.metadata || typeof proposalReplay.metadata !== 'object' || Array.isArray(proposalReplay.metadata)
          || !proposalReplay.provenance || typeof proposalReplay.provenance !== 'object' || Array.isArray(proposalReplay.provenance)) {
          throw new TypeError('Proposal replay must contain finalRaw, metadata, and provenance.');
        }
        proposal = parseSemanticNamingResult([input], proposalReplay.finalRaw)[0];
        stages.proposal = {
          phase: 'proposal', status: 'replayed-valid', replayed: true,
          usage: proposalReplay.metadata.usage ?? null,
          usageScope: 'Previously recorded proposal usage; excluded from this run aggregate.',
          metadata: structuredClone(proposalReplay.metadata),
          provenance: structuredClone(proposalReplay.provenance),
        };
        await Promise.all([
          writeFile(join(runDir, 'proposal-final.json'), proposalReplay.finalRaw, { flag: 'wx' }),
          writeFile(join(runDir, 'proposal-replay.json'), `${JSON.stringify({
            metadata: proposalReplay.metadata, provenance: proposalReplay.provenance,
          }, null, 2)}\n`, { flag: 'wx' }),
        ]);
      } else {
        proposalImages = await renderImages(input);
        if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
        if (!Array.isArray(proposalImages) || proposalImages.length !== NAMING_POLICY.maxImages) {
          throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
        }
        proposalImageMetadata = imageReceipt(proposalImages, 'proposal');
        proposalPrompt = buildSemanticGuidePrompt(input, { views: proposalImages.map((image) => image.view) });
        compact = packetReceipt([input], proposalImageMetadata);
        await Promise.all([
          writeFile(join(runDir, 'proposal-prompt.txt'), proposalPrompt, { flag: 'wx' }),
          writeFile(join(runDir, 'compact-packet.json'), `${JSON.stringify(compact, null, 2)}\n`, { flag: 'wx' }),
          ...proposalImageMetadata.map((image, index) => writeFile(join(runDir, image.file), proposalImages[index].png, { flag: 'wx' })),
        ]);
        stages.proposal = {
          phase: 'proposal', status: 'prepared', replayed: false, budget: null,
          images: proposalImageMetadata, requestedModel: NAMING_POLICY.model,
          reasoningEffort: NAMING_POLICY.reasoningEffort,
          requestedServiceTier: NAMING_POLICY.serviceTier,
          usage: null,
        };
        ({ budget: proposalBudget } = createNamingApiRequest(proposalPrompt, { images: proposalImages, phase: 'proposal' }));
        stages.proposal.budget = proposalBudget;
        proposalOutcome = await provider(proposalPrompt, {
          signal: controller.signal,
          timeoutMs: SEMANTIC_GUIDE_SETTINGS.timeoutMs,
          settings: providerSettings,
          images: proposalImages,
          phase: 'proposal',
        });
        const inspection = inspectOutcome(
          proposalOutcome,
          (raw) => parseSemanticNamingResult([input], raw)[0],
        );
        if (controller.signal.aborted) inspection.cancelled = true;
        stages.proposal = stageReceipt('proposal', proposalOutcome, inspection, proposalBudget, proposalImageMetadata, { replayed: false });
        await writeOutcome('proposal', proposalOutcome);
        if (!inspection.successful || inspection.cancelled) throw stageFailure(proposalOutcome, inspection, requestId);
        proposal = inspection.value;
      }

      captionImages = strategy === CONSENSUS_STRATEGY
        ? await renderReferenceChapters(input, proposal)
        : await renderChapters(input, proposal);
      if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
      if (!Array.isArray(captionImages) || captionImages.length < 1 || captionImages.length > NAMING_POLICY.maxImages) {
        throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
      }
      captionImageMetadata = imageReceipt(captionImages, 'captions');
      captionPrompt = strategy === CONSENSUS_STRATEGY
        ? buildSemanticReferenceCaptionPrompt(input, proposal, captionImages)
        : buildSemanticCaptionPrompt(input, proposal, captionImages);
      await Promise.all([
        writeFile(join(runDir, 'captions-prompt.txt'), captionPrompt, { flag: 'wx' }),
        ...captionImageMetadata.map((image, index) => writeFile(join(runDir, image.file), captionImages[index].png, { flag: 'wx' })),
      ]);
      stages.captions = {
        phase: 'captions', status: 'prepared', budget: null,
        images: captionImageMetadata, requestedModel: NAMING_POLICY.model,
        reasoningEffort: NAMING_POLICY.reasoningEffort,
        requestedServiceTier: NAMING_POLICY.serviceTier,
        usage: null,
      };
      ({ budget: captionBudget } = createNamingApiRequest(captionPrompt, { images: captionImages, phase: 'captions' }));
      stages.captions.budget = captionBudget;
      const combinedRequestMaxCostUsd = (proposalBudget?.maxCostUsd ?? 0) + captionBudget.maxCostUsd;
      if (combinedRequestMaxCostUsd > NAMING_POLICY.maxCostUsd) {
        throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
      }
      captionOutcome = await provider(captionPrompt, {
        signal: controller.signal,
        timeoutMs: SEMANTIC_GUIDE_SETTINGS.timeoutMs,
        settings: providerSettings,
        images: captionImages,
        phase: 'captions',
      });
      const captionInspection = inspectOutcome(
        captionOutcome,
        (raw) => parseSemanticCaptionResult(input, proposal, raw),
      );
      if (controller.signal.aborted) captionInspection.cancelled = true;
      stages.captions = stageReceipt('captions', captionOutcome, captionInspection, captionBudget, captionImageMetadata);
      await writeOutcome('captions', captionOutcome);
      if (!captionInspection.successful || captionInspection.cancelled) {
        throw stageFailure(captionOutcome, captionInspection, requestId);
      }
      captionAnnotation = captionInspection.value;
      finalAnnotation = captionAnnotation;

      if (strategy === CONSENSUS_STRATEGY) {
        consensusPrompt = buildSemanticConsensusPrompt(input, proposal, {
          proposalLabels: proposal.sections.map((section) => section.label),
          captionLabels: captionAnnotation.sections.map((section) => section.label),
        });
        await writeFile(join(runDir, 'consensus-prompt.txt'), consensusPrompt, { flag: 'wx' });
        stages.consensus = {
          phase: 'consensus', status: 'prepared', budget: null, images: [],
          requestedModel: NAMING_POLICY.model,
          reasoningEffort: NAMING_POLICY.reasoningEffort,
          requestedServiceTier: NAMING_POLICY.serviceTier,
          usage: null,
        };
        ({ budget: consensusBudget } = createNamingApiRequest(consensusPrompt, { phase: 'consensus' }));
        stages.consensus.budget = consensusBudget;
        consensusOutcome = await provider(consensusPrompt, {
          signal: controller.signal,
          timeoutMs: settings.timeoutMs,
          settings: providerSettings,
          images: [],
          phase: 'consensus',
        });
        const consensusInspection = inspectOutcome(
          consensusOutcome,
          (raw) => parseSemanticCaptionResult(input, proposal, raw),
        );
        if (controller.signal.aborted) consensusInspection.cancelled = true;
        stages.consensus = stageReceipt(
          'consensus', consensusOutcome, consensusInspection, consensusBudget, [],
        );
        await writeOutcome('consensus', consensusOutcome);
        if (!consensusInspection.successful || consensusInspection.cancelled) {
          throw stageFailure(consensusOutcome, consensusInspection, requestId);
        }
        consensusAnnotation = consensusInspection.value;
        const refined = refineSemanticLabelDetails(input, consensusAnnotation);
        finalAnnotation = refined.annotation;
        stages.localRefinement = {
          phase: 'local-refinement', status: 'valid', runtime: 'deterministic-local',
          changes: refined.changes, evidence: refined.evidence,
        };
      }

      const currentUsage = aggregateUsage([
        proposalReplay ? null : stages.proposal.usage,
        stages.captions.usage,
        stages.consensus?.usage,
      ]);
      const usageComplete = proposalReplay
        ? Boolean(stages.captions.usage && (strategy !== CONSENSUS_STRATEGY || stages.consensus?.usage))
        : Boolean(stages.proposal.usage && stages.captions.usage
          && (strategy !== CONSENSUS_STRATEGY || stages.consensus?.usage));
      const runtime = consensusOutcome?.runtime === 'openai-api' || captionOutcome.runtime === 'openai-api'
        || proposalOutcome?.runtime === 'openai-api' ? 'openai-api' : RUNTIME;
      const annotationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
      const requestBudget = {
        stageEnvelope: settings.stageEnvelope,
        proposal: proposalBudget,
        captions: captionBudget,
        consensus: consensusBudget,
        combinedRequestMaxCostUsd: combinedRequestMaxCostUsd + (consensusBudget?.maxCostUsd ?? 0),
        reservation: budgetReservation,
      };
      const metadata = {
        requestId,
        namingPolicy: settings.namingPolicy,
        strategy,
        runtime,
        requestedModel: NAMING_POLICY.model,
        actualModel: stages.consensus?.actualModel
          ?? stages.captions.actualModel ?? stages.proposal.actualModel ?? null,
        usage: currentUsage,
        usageComplete,
        stageUsage: {
          proposal: stages.proposal.usage,
          captions: stages.captions.usage,
          ...(strategy === CONSENSUS_STRATEGY ? { consensus: stages.consensus?.usage ?? null } : {}),
          proposalReplayed: Boolean(proposalReplay),
        },
        requestBudget,
        usageCostEstimate: validActualUsageCost(
          { actual: { usage: currentUsage } }, { usage: currentUsage }, runtime,
        ),
        annotationMs,
        applicationRetries: 0,
        cacheHit: false,
        reasoningEffort: NAMING_POLICY.reasoningEffort,
        requestedServiceTier: NAMING_POLICY.serviceTier,
        actualServiceTier: stages.consensus?.actualServiceTier
          ?? stages.captions.actualServiceTier ?? stages.proposal.actualServiceTier ?? null,
        timingScope: TIMING_SCOPE,
        budgetScope: strategy === CONSENSUS_STRATEGY
          ? 'The full three-phase prospective API envelope is reserved before provider entry. Subscription CLI hidden input and output are not strictly capped.'
          : 'The one-cent ceiling applies to the combined paid API request envelopes. Subscription CLI hidden input and output are not strictly capped.',
      };
      const finalProjectionHash = createHash('sha256').update(JSON.stringify({
        compactPacket: compact?.packet ?? null,
        proposalImages: proposalImageMetadata,
        proposalRanges: proposal.sections.map(({ startStepId, endStepId }) => [startStepId, endStepId]),
        captionImages: captionImageMetadata,
        captionLabels: captionAnnotation?.sections.map((section) => section.label) ?? null,
        consensusLabels: consensusAnnotation?.sections.map((section) => section.label) ?? null,
      })).digest('hex');
      const record = {
        requestId,
        input,
        startedAt,
        finishedAt: now().toISOString(),
        status: 'semantic-annotation-valid',
        settings,
        ...metadata,
        compactPacket: compact?.packet ?? null,
        projectionVersion: compact?.projectionVersion ?? createSemanticNamingSummary(input).version,
        projectionHash: finalProjectionHash,
        stages,
        proposalAnnotation: proposal,
        captionAnnotation,
        consensusAnnotation,
        finalAnnotation,
        failure: null,
      };
      await Promise.all([
        writeFile(join(runDir, 'proposal-annotation.json'), `${JSON.stringify(proposal, null, 2)}\n`, { flag: 'wx' }),
        writeFile(join(runDir, 'annotation.json'), `${JSON.stringify(finalAnnotation, null, 2)}\n`, { flag: 'wx' }),
        writeFile(join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' }),
      ]);
      recordWritten = true;

      if (controller.signal.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
      const envelope = { annotation: finalAnnotation, metadata };
      await persistCache(input.fingerprint, envelope, requestId);
      return envelope;
    } catch (error) {
      if (!recordWritten) {
        const annotationMs = Number(process.hrtime.bigint() - startedNs) / 1e6;
        const currentUsage = strategy === PARALLEL_FIXED_STRATEGY
          ? aggregateUsage([stages.isolated?.usage, stages.overview?.usage])
          : aggregateUsage([
            proposalReplay ? null : stages.proposal?.usage,
            stages.captions?.usage,
            stages.consensus?.usage,
          ]);
        const usageComplete = strategy === PARALLEL_FIXED_STRATEGY
          ? Boolean(stages.isolated?.usage && stages.overview?.usage)
          : proposalReplay
            ? Boolean(stages.captions?.usage
              && (strategy !== CONSENSUS_STRATEGY || stages.consensus?.usage))
            : Boolean(stages.proposal?.usage && stages.captions?.usage
              && (strategy !== CONSENSUS_STRATEGY || stages.consensus?.usage));
        try {
          await ensurePrivateDirectory(runDir);
          await writeFile(join(runDir, 'record.json'), `${JSON.stringify({
            requestId,
            input,
            startedAt,
            finishedAt: now().toISOString(),
            status: controller.signal.aborted ? 'cancelled' : 'failed',
            settings,
            stageEnvelope: settings.stageEnvelope,
            budgetReservation,
            proposalBudget,
            captionBudget,
            overviewBudget,
            isolatedBudget,
            stages,
            proposalAnnotation: proposal,
            captionAnnotation,
            isolatedAnnotation,
            overviewAnnotation,
            consensusAnnotation,
            usage: currentUsage,
            usageComplete,
            stageUsage: strategy === PARALLEL_FIXED_STRATEGY
              ? {
                isolated: stages.isolated?.usage ?? null,
                overview: stages.overview?.usage ?? null,
              }
              : {
                proposal: stages.proposal?.usage ?? null,
                captions: stages.captions?.usage ?? null,
                ...(strategy === CONSENSUS_STRATEGY ? { consensus: stages.consensus?.usage ?? null } : {}),
                proposalReplayed: Boolean(proposalReplay),
              },
            strategy,
            ...(strategy === PARALLEL_FIXED_STRATEGY ? {
              groupingVersion: PARALLEL_GROUPING_VERSION,
              cacheIdentity: PARALLEL_CACHE_IDENTITY,
            } : {}),
            annotationMs,
            ...(strategy === PARALLEL_FIXED_STRATEGY ? {
              timings: {
                preparationMs: parallelPreparationMs,
                providerWallMs: parallelProviderWallMs,
                totalMs: annotationMs,
              },
            } : {}),
            failure: safeText(error.message),
            applicationRetries: 0,
          }, null, 2)}\n`, { flag: 'wx' }).catch(() => {});
        } catch {}
      }
      if (error instanceof SemanticGuideError) throw error;
      if (controller.signal.aborted) {
        throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.', requestId);
      }
      throw new SemanticGuideError('annotator-failed', 'Semantic annotator failed.', requestId);
    } finally {
      signal?.removeEventListener('abort', relayAbort);
      if (active?.requestId === requestId) active = null;
      settleActive();
    }
  }

  async function annotate(rawInput, { signal, ...unknown } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('Single semantic annotation does not accept cache policy options.');
    const input = validateSemanticGuideInput(rawInput);
    if (signal?.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.');
    const cached = await lookup(input.fingerprint);
    if (signal?.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.');
    if (cached) {
      try {
        return { annotation: validateSemanticGuideAnnotation(input, cached.annotation), metadata: { ...cached.metadata, cacheHit: true } };
      } catch {}
    }
    if (!allowExperimentalInference) {
      throw new SemanticGuideError(
        'unavailable',
        'New section naming is paused pending semantic accuracy validation.',
      );
    }
    return inferGuide(input, { signal });
  }

  async function annotateFromProposal(rawInput, proposalReplay, { signal, ...unknown } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('Unknown proposal replay options.');
    const input = validateSemanticGuideInput(rawInput);
    if (signal?.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.');
    const cached = await lookup(input.fingerprint);
    if (signal?.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.');
    if (cached) {
      try {
        return { annotation: validateSemanticGuideAnnotation(input, cached.annotation), metadata: { ...cached.metadata, cacheHit: true } };
      } catch {}
    }
    if (!allowExperimentalInference) {
      throw new SemanticGuideError(
        'unavailable',
        'New section naming is paused pending semantic accuracy validation.',
      );
    }
    return inferGuide(input, { signal, proposalReplay });
  }

  async function annotateBatch(rawInputs, { signal, refresh = false, ...unknown } = {}) {
    if (Object.keys(unknown).length) throw new TypeError('Unknown semantic batch options.');
    if (typeof refresh !== 'boolean') throw new TypeError('refresh must be a boolean.');
    if (!Array.isArray(rawInputs) || rawInputs.length !== 2) throw new RangeError('Semantic batches require exactly two inputs.');
    const inputs = rawInputs.map((input) => validateSemanticGuideInput(input));
    if (inputs[0].fingerprint === inputs[1].fingerprint) throw new RangeError('Semantic batch fingerprints must be distinct.');
    if (signal?.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.');

    if (!refresh) {
      const cached = await Promise.all(inputs.map((input) => lookup(input.fingerprint)));
      if (signal?.aborted) throw new SemanticGuideError('cancelled', 'Semantic annotation was cancelled.');
      const validated = cached.map((receipt, index) => {
        if (!receipt) return null;
        try {
          return { annotation: validateSemanticGuideAnnotation(inputs[index], receipt.annotation), metadata: { ...receipt.metadata, cacheHit: true } };
        } catch { return null; }
      });
      if (validated.every(Boolean)) return validated;
    }
    throw new SemanticGuideError(
      'annotator-failed',
      'Uncached semantic batches exceed the four-image request limit.',
    );
  }

  async function cancelAndWait({ timeoutMs = 1_000 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw new RangeError('Semantic cancellation wait must be a non-negative duration.');
    }
    const task = active;
    if (!task) return true;
    task.controller.abort(new DOMException('Yielded to raw generation.', 'AbortError'));
    if (timeoutMs === 0) return false;
    let timer;
    const timedOut = new Promise((resolveTimedOut) => {
      timer = setTimeout(() => resolveTimedOut(false), timeoutMs);
    });
    const settled = task.settled.then(() => true);
    try { return await Promise.race([settled, timedOut]); }
    finally { clearTimeout(timer); }
  }

  return {
    annotate,
    annotateFromProposal,
    annotateBatch,
    lookup,
    isBusy: () => Boolean(active) || Boolean(isGenerationBusy()),
    isInferenceBusy: () => Boolean(active),
    cancel: () => active?.controller.abort(),
    cancelAndWait,
  };
}
