import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASE_URL = 'https://microsoft-trellis-2.hf.space';
export const LIMITS = Object.freeze({ image: 5 * 1024 * 1024, response: 20 * 1024 * 1024, glb: 50 * 1024 * 1024, stageMs: 180_000, globalMs: 360_000 });
const IMAGE_MAX_SIDE = 4096;
const IMAGE_MAX_PIXELS = 16_777_216;
const AUTHENTICATED_PROVIDER_COST = Object.freeze({ amountUsd: null, basis: 'Authenticated Hugging Face account quota; provider cost and remaining quota are unreported.' });
export const TRELLIS_PROBE_PLAN = Object.freeze({
  subject: 'cat', trials: 1, retries: 0, baseUrl: BASE_URL, sessionCount: 1, uploads: 1,
  calls: ['start_session', 'preprocess_image', 'image_to_3d', 'extract_glb'],
  settings: { resolution: 512, seed: 0, randomizeSeed: false, sparseStructure: [7.5, 0.7, 12, 5], shapeSlat: [7.5, 0.5, 12, 3], textureSlat: [1, 0, 12, 3], export: [null, 100000, 1024] },
  stageDeadlineMs: LIMITS.stageMs, globalDeadlineMs: LIMITS.globalMs,
  providerCost: { amountUsd: 0, basis: 'Official free anonymous demo only; actual quota and availability are not assumed.' },
  output: 'downloaded GLB only; no voxel conversion or publication',
});

function errorText(error) { return String(error?.stack ?? error?.message ?? error).slice(0, 4000); }
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1e6; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function json(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function validateHfToken(token) {
  if (typeof token !== 'string' || !/^hf_[A-Za-z0-9]{8,}$/.test(token)) throw new Error('Authenticated mode requires a valid HF_TOKEN.');
  return token;
}
function redactString(value, token) { return token ? value.split(token).join('[REDACTED]') : value; }
function redactBytes(bytes, token) {
  if (!token) return bytes;
  const copy = Buffer.from(bytes);
  const needle = Buffer.from(token);
  for (let at = copy.indexOf(needle); at !== -1; at = copy.indexOf(needle, at + needle.length)) copy.fill(42, at, at + needle.length);
  return copy;
}

export function createAuthenticatedFetch(fetchImpl, token) {
  const credential = validateHfToken(token);
  return async (url, options = {}) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.origin !== new URL(BASE_URL).origin) throw new Error(`Refusing to send HF_TOKEN outside ${BASE_URL}.`);
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${credential}`);
    return fetchImpl(url, { ...options, headers, redirect: 'error' });
  };
}

export async function loadHfToken({ rootDir = ROOT, env = process.env, readFileImpl = readFile } = {}) {
  if (env.HF_TOKEN !== undefined) return validateHfToken(env.HF_TOKEN);
  let contents;
  try { contents = await readFileImpl(join(rootDir, '.env'), 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') throw new Error('Authenticated mode requires HF_TOKEN in the server environment or project .env.'); throw error; }
  return validateHfToken(parseEnv(contents).HF_TOKEN);
}

export function validateImageRecord(record, bytes) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Image record must be a JSON object.');
  for (const key of ['prompt', 'source', 'imageSha256']) if (typeof record[key] !== 'string' || !record[key].trim()) throw new Error(`Image record ${key} must be a nonempty string.`);
  if (!/\bcat\b/i.test(record.prompt)) throw new Error('Image record prompt must describe the fixed cat subject.');
  if (record.imageGenerationMs !== null && (!Number.isFinite(record.imageGenerationMs) || record.imageGenerationMs < 0)) throw new Error('Image record imageGenerationMs must be null or a nonnegative number.');
  if (!/^[a-f0-9]{64}$/i.test(record.imageSha256)) throw new Error('Image record imageSha256 must be a SHA-256 hex digest.');
  const actual = sha256(bytes);
  if (actual !== record.imageSha256.toLowerCase()) throw new Error(`Image SHA-256 mismatch: expected ${record.imageSha256.toLowerCase()}, got ${actual}.`);
  return { prompt: record.prompt, source: record.source, imageSha256: actual, imageGenerationMs: record.imageGenerationMs };
}

export async function inspectPngWithPillow(path, { spawnImpl = spawn } = {}) {
  const code = `from PIL import Image\nimport json,sys\np=sys.argv[1]\nwith Image.open(p) as im:\n im.verify()\nwith Image.open(p) as im:\n if im.width < 1 or im.height < 1 or im.width > 4096 or im.height > 4096 or im.width * im.height > 16777216: raise ValueError('image dimensions exceed bounds')\n a=im.getchannel('A') if 'A' in im.getbands() else None\n print(json.dumps({'format': im.format, 'width': im.width, 'height': im.height, 'hasAlpha': a is not None, 'alphaMin': a.getextrema()[0] if a else 255}))`;
  return await new Promise((resolvePromise, reject) => {
    const child = spawnImpl('python3', ['-c', code, path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (chunk) => { out = (out + chunk).slice(0, 4097); if (out.length > 4096) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { err = (err + chunk).slice(0, 4096); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Pillow PNG inspection exceeded 10 seconds.')); }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status) => {
      clearTimeout(timer);
      if (status !== 0) reject(new Error(`Pillow PNG inspection failed: ${err.trim() || `exit ${status}`}`));
      else { try { resolvePromise(JSON.parse(out)); } catch { reject(new Error('Pillow PNG inspection returned invalid JSON.')); } }
    });
  });
}

async function readBoundedResponse(response, maxBytes, signal) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await raceAbort(response.arrayBuffer(), signal));
    if (bytes.byteLength > maxBytes) throw Object.assign(new Error(`Response exceeds ${maxBytes} bytes.`), { partialBytes: bytes.slice(0, maxBytes) });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  const abort = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Aborted.')), { once: true }));
  try {
    while (true) {
      const result = await Promise.race([reader.read(), abort]);
      if (result.done) break;
      const chunk = result.value;
      if (size + chunk.byteLength > maxBytes) {
        const keep = Math.max(0, maxBytes - size); if (keep) chunks.push(chunk.slice(0, keep));
        await Promise.race([reader.cancel(), Promise.resolve()]).catch(() => {});
        throw Object.assign(new Error(`Response exceeds ${maxBytes} bytes.`), { partialBytes: concat(chunks) });
      }
      chunks.push(chunk); size += chunk.byteLength;
    }
    return concat(chunks);
  } catch (error) {
    error.partialBytes ??= concat(chunks); throw error;
  }
}
function concat(chunks) { const length = chunks.reduce((n, x) => n + x.byteLength, 0); const all = new Uint8Array(length); let at = 0; for (const x of chunks) { all.set(x, at); at += x.byteLength; } return all; }
function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Aborted.'));
  return Promise.race([promise, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Aborted.')), { once: true }))]);
}

export function parseGradioQueueSse(raw, targetEventId) {
  const normalized = raw.replace(/\r\n/g, '\n');
  const messages = [];
  for (const block of normalized.split('\n\n')) {
    if (!block.trim()) continue;
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) continue;
    try { messages.push(JSON.parse(data.join('\n'))); }
    catch { throw new Error('Malformed JSON in Gradio queue event.'); }
  }
  const completed = messages.filter(({ msg }) => msg === 'process_completed');
  if (completed.length !== 1) throw new Error(completed.length ? 'Gradio queue stream has multiple completion messages.' : 'Gradio queue stream ended without process_completed.');
  const terminal = completed[0];
  if (terminal.event_id !== targetEventId) throw new Error(`Gradio completion event_id mismatch: expected ${targetEventId}, got ${String(terminal.event_id)}.`);
  if (terminal.success !== true) {
    const detail = terminal.output?.error ?? terminal.output;
    throw Object.assign(new Error(`Gradio job failed: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`), { messages });
  }
  if (!Array.isArray(terminal.output?.data)) throw new Error('Successful Gradio completion omitted output.data.');
  return { data: terminal.output.data, messages };
}

function fileData(value) {
  if (Array.isArray(value)) for (const item of value) { const found = fileData(item); if (found) return found; }
  if (value && typeof value === 'object') {
    if (typeof value.url === 'string' || typeof value.path === 'string') return value;
    for (const item of Object.values(value)) { const found = fileData(item); if (found) return found; }
  }
  return null;
}
export function validateOutputUrl(value) {
  const item = fileData(value); if (!item) throw new Error('GLB response did not contain FileData.');
  const candidate = item.url ?? item.path;
  const url = new URL(candidate, BASE_URL);
  if (url.origin !== BASE_URL || !url.pathname.startsWith('/gradio_api/file=')) throw new Error(`Rejected output URL outside the official Gradio file route: ${url.href}`);
  return url.href;
}

export function validateGradioFileData(value, label = 'Gradio response') {
  const item = fileData(value);
  if (!item) throw new Error(`${label} did not contain FileData.`);
  for (const candidate of [item.url, item.path]) {
    if (typeof candidate !== 'string') continue;
    if (candidate.startsWith('//')) throw new Error(`Rejected ${label} protocol-relative path: ${candidate}`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !candidate.startsWith('http://') && !candidate.startsWith('https://')) throw new Error(`Rejected ${label} path scheme: ${candidate}`);
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      const url = new URL(candidate);
      if (url.origin !== BASE_URL || !url.pathname.startsWith('/gradio_api/file=')) throw new Error(`Rejected ${label} FileData URL: ${url.href}`);
    }
  }
  return item;
}

async function request(fetchImpl, url, options, maxBytes, signal) {
  if (signal.aborted) throw signal.reason ?? new Error('Aborted.');
  const response = await raceAbort(fetchImpl(url, { ...options, redirect: 'error', signal }), signal);
  const bytes = await readBoundedResponse(response, maxBytes, signal);
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status} from ${new URL(url).pathname}.`), { httpStatus: response.status, partialBytes: bytes });
  return bytes;
}

export async function runTrellisProbe({ rootDir = ROOT, dataRoot, allowTestDataRoot = false, imagePath, imageRecordPath, fetchImpl = globalThis.fetch, authenticated = false, hfToken, imageInspector = inspectPngWithPillow, now = () => new Date(), uuid = randomUUID, stageMs = LIMITS.stageMs, globalMs = LIMITS.globalMs } = {}) {
  const token = authenticated ? validateHfToken(hfToken) : null;
  const authMode = authenticated ? 'huggingface-token' : 'anonymous';
  const providerCost = authenticated
    ? AUTHENTICATED_PROVIDER_COST
    : TRELLIS_PROBE_PLAN.providerCost;
  const requestFetch = authenticated ? createAuthenticatedFetch(fetchImpl, token) : fetchImpl;
  if (!imagePath || !imageRecordPath) throw new Error('Real run requires --image and --image-record.');
  if (extname(imagePath).toLowerCase() !== '.png') throw new Error('Input image must be a PNG.');
  const imageStats = await stat(imagePath); if (imageStats.size > LIMITS.image) throw new Error(`Input image exceeds ${LIMITS.image} bytes.`);
  const image = await readFile(imagePath);
  if (!image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Input does not have a PNG signature.');
  const record = validateImageRecord(JSON.parse(await readFile(imageRecordPath, 'utf8')), image);
  const inspection = await imageInspector(imagePath);
  if (inspection.format !== 'PNG' || !inspection.hasAlpha || inspection.alphaMin >= 255) throw new Error('Input PNG must contain actual transparency (an alpha value below 255).');
  if (!Number.isInteger(inspection.width) || !Number.isInteger(inspection.height) || inspection.width < 1 || inspection.height < 1 || inspection.width > IMAGE_MAX_SIDE || inspection.height > IMAGE_MAX_SIDE || inspection.width * inspection.height > IMAGE_MAX_PIXELS) throw new Error(`Input PNG dimensions exceed ${IMAGE_MAX_SIDE}px per side or ${IMAGE_MAX_PIXELS} pixels.`);
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const startedAt = now(); const sessionHash = uuid(); const runToken = uuid();
  if (![sessionHash, runToken].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new Error('Could not create safe TRELLIS session and receipt IDs.');
  const runId = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${runToken}`;
  const probeDir = join(resolvePrivateDataRoot({ sourceRoot: rootDir, dataRoot, allowTestDataRoot }), 'trellis-probe');
  const runDir = join(probeDir, runId); await ensurePrivateDirectory(probeDir); await mkdir(runDir, { recursive: false, mode: 0o700 });
  const runPlan = { ...TRELLIS_PROBE_PLAN, authMode, providerCost };
  const copiedInput = join(runDir, `input${extname(imagePath).toLowerCase()}`);
  await copyFile(imagePath, copiedInput, constants.COPYFILE_EXCL); await chmod(copiedInput, PRIVATE_FILE_MODE); await writeFile(join(runDir, 'image-record.json'), redactString(json(record), token), { flag: 'wx', mode: PRIVATE_FILE_MODE }); await writeFile(join(runDir, 'plan.json'), json(runPlan), { flag: 'wx', mode: PRIVATE_FILE_MODE });
  const start = process.hrtime.bigint(); const globalController = new AbortController();
  const globalTimer = setTimeout(() => globalController.abort(new Error(`Global deadline exceeded after ${globalMs}ms.`)), globalMs);
  const receipts = {}; const timings = {}; const eventIds = {}; let requestCount = 0; let jobSubmitted = false; let resultUrl = null; let status = 'failed'; let failure = null;
  const persistRaw = async (name, kind, bytes) => { receipts[`${name}-${kind}`] = `${name}-${kind}.txt`; await writeFile(join(runDir, receipts[`${name}-${kind}`]), redactBytes(bytes, token), { mode: PRIVATE_FILE_MODE }); };
  const stage = async (name, task) => {
    const controller = new AbortController(); const onGlobal = () => controller.abort(globalController.signal.reason); globalController.signal.addEventListener('abort', onGlobal, { once: true });
    if (globalController.signal.aborted) controller.abort(globalController.signal.reason);
    const timer = setTimeout(() => controller.abort(new Error(`${name} deadline exceeded after ${stageMs}ms.`)), stageMs); const at = elapsed(start);
    try { return await task(controller.signal); } finally { clearTimeout(timer); globalController.signal.removeEventListener('abort', onGlobal); timings[name] = { startMs: at, endMs: elapsed(start), durationMs: elapsed(start) - at }; }
  };
  const call = async (name, data) => stage(name, async (signal) => {
    requestCount += 1;
    let postBytes;
    try { postBytes = await request(requestFetch, `${BASE_URL}/gradio_api/call/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, session_hash: sessionHash }) }, LIMITS.response, signal); }
    catch (error) { await persistRaw(name, 'submit-partial', error.partialBytes ?? new Uint8Array()); throw error; }
    await persistRaw(name, 'submit', postBytes); const submitted = JSON.parse(new TextDecoder().decode(postBytes));
    if (typeof submitted.event_id !== 'string' || !submitted.event_id) throw new Error(`${name} submission omitted event_id.`);
    eventIds[name] = submitted.event_id; jobSubmitted = true; requestCount += 1;
    let eventBytes;
    try { eventBytes = await request(requestFetch, `${BASE_URL}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`, { method: 'GET' }, LIMITS.response, signal); }
    catch (error) { await persistRaw(name, 'events-partial', error.partialBytes ?? new Uint8Array()); throw error; }
    await persistRaw(name, 'events', eventBytes); return parseGradioQueueSse(new TextDecoder().decode(eventBytes), submitted.event_id).data;
  });
  try {
    await call('start_session', []);
    const uploaded = await stage('upload', async (signal) => {
      const form = new FormData(); form.append('files', new Blob([image], { type: 'image/png' }), basename(imagePath)); requestCount += 1;
      let bytes;
      try { bytes = await request(requestFetch, `${BASE_URL}/gradio_api/upload`, { method: 'POST', body: form }, LIMITS.response, signal); }
      catch (error) { await persistRaw('upload', 'response-partial', error.partialBytes ?? new Uint8Array()); throw error; }
      await persistRaw('upload', 'response', bytes); return JSON.parse(new TextDecoder().decode(bytes));
    });
    await writeFile(join(runDir, 'upload-result.json'), redactString(json(uploaded), token), { flag: 'wx', mode: PRIVATE_FILE_MODE });
    const uploadedPath = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    if (typeof uploadedPath !== 'string' || !uploadedPath) throw new Error('Upload response must contain one nonempty server path.');
    validateGradioFileData({ path: uploadedPath }, 'upload');
    const inputFile = { path: uploadedPath, url: null, orig_name: basename(imagePath), size: image.byteLength, mime_type: 'image/png', meta: { _type: 'gradio.FileData' } };
    const preprocessed = validateGradioFileData(await call('preprocess_image', [inputFile]), 'preprocess_image');
    await call('image_to_3d', [preprocessed, 0, '512', 7.5, 0.7, 12, 5, 7.5, 0.5, 12, 3, 1, 0, 12, 3]);
    const exported = await call('extract_glb', [null, 100000, 1024]); resultUrl = validateOutputUrl(exported);
    const glb = await stage('download', async (signal) => {
      requestCount += 1;
      try { return await request(requestFetch, resultUrl, { method: 'GET' }, LIMITS.glb, signal); }
      catch (error) { await writeFile(join(runDir, 'result-partial.glb'), redactBytes(error.partialBytes ?? new Uint8Array(), token), { mode: PRIVATE_FILE_MODE }); throw error; }
    });
    await writeFile(join(runDir, 'result.glb'), redactBytes(glb, token), { flag: 'wx', mode: PRIVATE_FILE_MODE }); status = 'downloaded-glb';
  } catch (error) { failure = { message: redactString(errorText(error), token), remoteStatus: jobSubmitted && /deadline|abort/i.test(String(error)) ? 'unknown; submitted job was not cancelled' : null, httpStatus: error.httpStatus ?? null }; }
  finally { clearTimeout(globalTimer); }
  const totalMs = elapsed(start); const outcome = { runId, status, baseUrl: BASE_URL, authMode, sessionHash, requestCount, retries: 0, eventIds, timings, imageGenerationMs: record.imageGenerationMs, probeThroughDownloadMs: totalMs, imagePlusProbeMs: record.imageGenerationMs === null ? null : record.imageGenerationMs + totalMs, resultUrl, providerCost, failure };
  const safeOutcome = JSON.parse(redactString(JSON.stringify(outcome), token));
  await writeFile(join(runDir, 'outcome.json'), json(safeOutcome), { flag: 'wx', mode: PRIVATE_FILE_MODE }); return { outcome: safeOutcome, runDir };
}

export async function runCli({ args = process.argv.slice(2), run = runTrellisProbe, log = console.log, rootDir = ROOT, env = process.env, readFileImpl = readFile } = {}) {
  const authenticated = args.includes('--authenticated');
  if (args.includes('--dry-run')) { log(json({ ...TRELLIS_PROBE_PLAN, authMode: authenticated ? 'huggingface-token' : 'anonymous', ...(authenticated ? { providerCost: AUTHENTICATED_PROVIDER_COST } : {}) }).trim()); return; }
  if (args.includes('--help')) { log('Usage: node scripts/run-trellis-probe.mjs [--authenticated] --dry-run | --live --max-sessions=1 --image input.png --image-record record.json'); return; }
  if (!args.includes('--live') || !args.includes('--max-sessions=1')) throw new Error('Live TRELLIS use requires explicit --live --max-sessions=1.');
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const hfToken = authenticated ? await loadHfToken({ rootDir, env, readFileImpl }) : undefined;
  const result = await run({ rootDir, imagePath: value('--image'), imageRecordPath: value('--image-record'), authenticated, hfToken }); log(json(result.outcome).trim());
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli().catch((error) => { console.error(errorText(error)); process.exitCode = 1; });
