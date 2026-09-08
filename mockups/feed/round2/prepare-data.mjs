// Explicit one-time local snapshots for mockups. Never calls a generator.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertToBricks } from '../../../src/construction.js';
import { createAssemblyPlan } from '../../../src/assembly.js';
import { PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../../../server/private-data-root.js';
import { SETS } from '../shared.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SAFE_SOURCE = /^\/examples\/[a-zA-Z0-9._-]+\.json$/;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

export async function prepareRound2Data({
  rootDir = ROOT,
  outputDirectory,
  sets = SETS,
  log = console.log,
} = {}) {
  if (!outputDirectory) throw new Error('Explicit outputDirectory is required.');
  const folder = resolvePrivateDataRoot({ sourceRoot: rootDir, dataRoot: outputDirectory });
  await mkdir(dirname(folder), { recursive: true, mode: 0o700 });
  await mkdir(folder, { recursive: false, mode: 0o700 });

  const index = JSON.parse(await readFile(join(rootDir, 'public', 'examples', 'index.json'), 'utf8'));
  const manifest = [];
  for (const set of sets) {
    if (!SAFE_ID.test(set.id)) throw new Error('Set IDs must contain only lowercase letters, digits, and hyphens.');
    const source = index.find(entry => Number(entry.shape) === set.shape)?.url;
    if (!source) throw new Error(`Shape ${set.shape} is unavailable.`);
    if (!SAFE_SOURCE.test(source)) throw new Error(`Shape ${set.shape} has an unsafe source path.`);
    const bytes = await readFile(join(rootDir, 'public', source));
    const rawModel = JSON.parse(bytes);
    const converted = convertToBricks({ rawModel, adjustments: false });
    const assemblyPlan = createAssemblyPlan({ brickModel: converted.brickModel, rawModel });
    const brickModel = { ...converted.brickModel, bricks: assemblyPlan.bricks };
    const provenance = {
      sourceShape: set.shape,
      source,
      prompt: rawModel.meta.subject,
      sourceSha256: createHash('sha256').update(bytes).digest('hex'),
      preparation: 'Local baseline ordinary-brick conversion and recorded assembly plan for layout exploration. No repairs, refinement or model calls.',
      physicalValidation: false,
    };
    await writeFile(
      join(folder, `${set.id}.json`),
      JSON.stringify({ brickModel, assemblyPlan, provenance }),
      { flag: 'wx', mode: PRIVATE_FILE_MODE },
    );
    manifest.push({
      id: set.id,
      ...provenance,
      parts: brickModel.bricks.length,
      steps: assemblyPlan.steps.length,
      unresolvedSteps: assemblyPlan.stats.unresolvedStepCount,
    });
    log(`${set.id}: ${brickModel.bricks.length} parts, ${assemblyPlan.steps.length} source operations`);
  }
  await writeFile(
    join(folder, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: PRIVATE_FILE_MODE },
  );
  return { outputDirectory: folder, manifest };
}

export async function runCli(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node mockups/feed/round2/prepare-data.mjs --output-dir /private/new-directory');
    return null;
  }
  const outputIndex = args.indexOf('--output-dir');
  if (outputIndex === -1 || !args[outputIndex + 1] || args.length !== 2) {
    throw new Error('Usage: node mockups/feed/round2/prepare-data.mjs --output-dir /private/new-directory');
  }
  return prepareRound2Data({ outputDirectory: resolve(args[outputIndex + 1]) });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
