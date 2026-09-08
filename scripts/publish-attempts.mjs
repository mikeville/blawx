import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ERROR_SUMMARIES = Object.freeze({
  request: 'API request failed before response headers were received.',
  'response-body': 'API response body could not be read completely.',
  'http-status': 'API request returned an unsuccessful HTTP status.',
  'response-json': 'API response could not be parsed.',
  'response-output': 'API response was incomplete or contained no usable output.',
  'shape-validation': 'API output failed shape validation.',
});

function originalPrompt(record) {
  const match = typeof record.prompt === 'string' ? record.prompt.match(/^USER PROMPT:\s*(.+)$/m) : null;
  return match?.[1]?.trim() || null;
}

function safeMetadataString(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  return /^[\w .,:;/()+\-[\]]+$/.test(value) ? value : null;
}

export function summarizeAttempt(record) {
  if (record.timedOut) return { status: 'timeout', errorSummary: 'Timed out before a usable model was produced.' };
  if (record.publishError) return { status: 'publish-failed', errorSummary: 'Generated model could not be published.' };
  if (record.error) return { status: 'api-failed', errorSummary: API_ERROR_SUMMARIES[record.error.stage] || 'API generation failed.' };
  if (record.launchError || record.stdinError) return { status: 'runtime-failed', errorSummary: 'Generation process failed.' };
  if (record.parseError) return { status: 'parse-failed', errorSummary: 'Response could not be parsed into the requested representation.' };
  if (record.shapeError || record.shapeValidation?.valid === false) return { status: 'shape-failed', errorSummary: 'Parsed response failed shape validation.' };
  if (record.publishedUrl) return { status: 'published', errorSummary: null };
  return { status: record.status || 'unknown', errorSummary: null };
}

export function publicAttempt(record, directory) {
  const summary = summarizeAttempt(record);
  return {
    id: String(record.runId || directory),
    method: record.method || (String(record.promptPath || '').includes('program') ? 'voxel-program' : 'voxel-layers'),
    status: summary.status,
    generationMs: Number.isFinite(record.generationMs) ? record.generationMs : null,
    publishedUrl: typeof record.publishedUrl === 'string' ? record.publishedUrl : null,
    errorSummary: summary.errorSummary,
    createdAt: record.startedAt || null,
    prompt: originalPrompt(record),
    runtime: safeMetadataString(record.runtime),
    requestedModel: safeMetadataString(record.requestedModel),
    actualModel: safeMetadataString(record.actualModel),
    requestedServiceTier: safeMetadataString(record.requestedServiceTier),
    actualServiceTier: safeMetadataString(record.actualServiceTier),
    timingScope: safeMetadataString(record.timingScope),
  };
}

export async function publishAttempts({ runsRoot, outputPath } = {}) {
  if (!runsRoot || !outputPath) throw new Error('Explicit runsRoot and outputPath are required for deliberate schema-allowlisted export.');
  let runDirectories = [];
  try {
    runDirectories = (await readdir(runsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const attempts = [];
  for (const directory of runDirectories) {
    const recordPath = path.join(runsRoot, directory, 'record.json');
    try {
      attempts.push(publicAttempt(JSON.parse(await readFile(recordPath, 'utf8')), directory));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  attempts.sort((a, b) => String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(attempts, null, 2)}\n`);
  return { attempts, outputPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index === -1 ? null : args[index + 1]; };
  const runsRoot = value('--input-runs');
  const outputPath = value('--output');
  const result = await publishAttempts({ runsRoot, outputPath });
  console.log(`Exported ${result.attempts.length} allowlisted attempt record(s) to ${path.resolve(outputPath)}.`);
}
