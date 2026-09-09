import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  defaultPrivateDataRoot,
  ensurePrivateDirectory,
  resolvePrivateDataRoot,
} from '../server/private-data-root.js';
import { isPrivateRequestPath } from '../vite.config.js';

test('private runtime roots use OS data locations and reject repository storage', async () => {
  assert.equal(
    defaultPrivateDataRoot({ environment: {}, operatingSystem: 'darwin', home: '/Users/example' }),
    '/Users/example/Library/Application Support/blawx/private',
  );
  assert.equal(
    defaultPrivateDataRoot({ environment: { XDG_DATA_HOME: '/data' }, operatingSystem: 'linux', home: '/home/example' }),
    '/data/blawx/private',
  );
  assert.throws(
    () => resolvePrivateDataRoot({ sourceRoot: '/workspace/blawx', dataRoot: '/workspace/blawx/app-runs' }),
    /outside the application source tree/,
  );

  const sourceRoot = await mkdtemp(join(tmpdir(), 'blawx-private-root-test-'));
  const testRoot = join(sourceRoot, 'private-data');
  assert.equal(resolvePrivateDataRoot({ sourceRoot, dataRoot: testRoot, allowTestDataRoot: true }), testRoot);
  assert.throws(
    () => resolvePrivateDataRoot({ sourceRoot: '/opt/blawx', dataRoot: '/opt/blawx/private', allowTestDataRoot: true }),
    /outside the application source tree/,
  );
});

test('private directories are owner-only', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'blawx-private-mode-')), 'nested');
  await ensurePrivateDirectory(root);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
});

test('private runtime roots reject sibling Git worktrees and symlink aliases into them', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'blawx-private-git-test-'));
  const sourceRoot = join(parent, 'source');
  const siblingRepo = join(parent, 'sibling-repo');
  await mkdir(sourceRoot);
  await mkdir(join(siblingRepo, '.git'), { recursive: true });
  assert.throws(
    () => resolvePrivateDataRoot({ sourceRoot, dataRoot: join(siblingRepo, 'private') }),
    /outside every Git worktree/,
  );

  const fileWorktree = join(parent, 'linked-worktree');
  await mkdir(fileWorktree);
  await writeFile(join(fileWorktree, '.git'), 'gitdir: ../metadata/worktrees/example\n');
  assert.throws(
    () => resolvePrivateDataRoot({ sourceRoot, dataRoot: join(fileWorktree, 'private') }),
    /outside every Git worktree/,
  );

  const alias = join(parent, 'repo-alias');
  await symlink(siblingRepo, alias, 'dir');
  assert.throws(
    () => resolvePrivateDataRoot({ sourceRoot, dataRoot: join(alias, 'private') }),
    /outside every Git worktree/,
  );
});

test('Vite private-path guard rejects encoded and nested private material', () => {
  for (const path of [
    '/.env', '/nested/.env.local', '/.git/config', '/artifacts/report.json',
    '/nested/AGENTS.md', '/experiments/raw.json', '/server/prompts/voxel-loft.txt',
    '/certificate.pem', '/%2eenv', '/.codex/config.toml', '/nested/.npmrc',
    '/research-notes.md', '/shape.record.json', '/service-account-dev.json', '/receipts/run.json',
    '/.blawx-private/cache.json', '/app-data/results.sqlite', '/nested/debug.log',
  ]) assert.equal(isPrivateRequestPath(path), true, path);
  for (const path of ['/', '/src/main.js', '/examples/index.json', '/fixtures/example.json']) {
    assert.equal(isPrivateRequestPath(path), false, path);
  }
});

test('public lab describes omitted private attempt records truthfully', async () => {
  const source = await readFile(new URL('../src/lab.js', import.meta.url), 'utf8');
  const sentinel = JSON.parse(await readFile(new URL('../public/examples/attempts.json', import.meta.url), 'utf8'));
  assert.equal(sentinel.status, 'private-records-not-included');
  assert.match(source, /Private generation-attempt records are not included in this public dataset/);
  assert.match(source, /attempts\?\.status === 'private-records-not-included'/);
  assert.doesNotMatch(source, /failed attempts remain in the Generation attempts panel/);
});
