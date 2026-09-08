import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const modulePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'mockups', 'feed', 'round2', 'prepare-data.mjs');

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'blawx-round2-prepare-'));
  const rootDir = join(parent, 'source');
  const examples = join(rootDir, 'public', 'examples');
  await mkdir(examples, { recursive: true });
  await writeFile(join(examples, 'index.json'), `${JSON.stringify([{ shape: 1, url: '/examples/shape-01.json' }])}\n`);
  await writeFile(join(examples, 'shape-01.json'), `${JSON.stringify({
    version: 1,
    kind: 'voxels',
    cells: [
      { x: 0, y: 0, z: 0, color: 'orange' },
      { x: 1, y: 0, z: 0, color: 'orange' },
    ],
    meta: { subject: 'synthetic arch' },
  })}\n`);
  return { parent, rootDir, outputDirectory: join(parent, 'private-output') };
}

test('round2 preparer is import-safe and requires an explicit output directory', async () => {
  const prepared = await import(modulePath);
  assert.equal(typeof prepared.prepareRound2Data, 'function');
  await assert.rejects(prepared.prepareRound2Data(), /Explicit outputDirectory/);
});

test('round2 preparer preserves conversion behavior in a new private directory and never overwrites it', async () => {
  const prepared = await import(modulePath);
  const paths = await fixture();
  const lines = [];
  const result = await prepared.prepareRound2Data({
    rootDir: paths.rootDir,
    outputDirectory: paths.outputDirectory,
    sets: [{ id: 'synthetic', shape: 1 }],
    log: line => lines.push(line),
  });
  assert.equal(result.outputDirectory, paths.outputDirectory);
  assert.equal(result.manifest.length, 1);
  assert.equal(result.manifest[0].parts, 1);
  assert.deepEqual(await readdir(paths.outputDirectory), ['manifest.json', 'synthetic.json']);
  assert.equal((await stat(paths.outputDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(paths.outputDirectory, 'manifest.json'))).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(join(paths.outputDirectory, 'synthetic.json'), 'utf8'));
  assert.equal(saved.brickModel.bricks.length, 1);
  assert.equal(saved.provenance.source, '/examples/shape-01.json');
  assert.match(lines[0], /1 parts/);
  const original = await readFile(join(paths.outputDirectory, 'manifest.json'));
  await assert.rejects(prepared.prepareRound2Data({
    rootDir: paths.rootDir,
    outputDirectory: paths.outputDirectory,
    sets: [{ id: 'synthetic', shape: 1 }],
  }), (error) => error?.code === 'EEXIST');
  assert.deepEqual(await readFile(join(paths.outputDirectory, 'manifest.json')), original);
});

test('round2 preparer rejects in-source and Git-worktree outputs before reading models', async () => {
  const prepared = await import(modulePath);
  const paths = await fixture();
  await assert.rejects(
    prepared.prepareRound2Data({ rootDir: paths.rootDir, outputDirectory: join(paths.rootDir, 'generated') }),
    /outside the application source tree/,
  );
  const repoOutput = join(paths.parent, 'other-repo', 'output');
  await mkdir(join(paths.parent, 'other-repo', '.git'), { recursive: true });
  await assert.rejects(
    prepared.prepareRound2Data({ rootDir: paths.rootDir, outputDirectory: repoOutput }),
    /outside every Git worktree/,
  );
});
