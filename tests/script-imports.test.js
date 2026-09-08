import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CLI modules import from module stdin without argv[1] or side effects', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'script-imports-'));
  const modules = readdirSync(path.join(projectRoot, 'scripts'))
    .filter(name => name.endsWith('.mjs')).sort()
    .map(name => pathToFileURL(path.join(projectRoot, 'scripts', name)).href);
  try {
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd: directory,
      encoding: 'utf8',
      input: `${modules.map(url => `await import(${JSON.stringify(url)});`).join('\n')}\nconsole.log('imported');\n`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'imported\n');
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true });
  }
});
