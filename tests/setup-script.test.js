import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const setupSource = join(repositoryRoot, 'setup.sh');

function makeHarness(t, major) {
  const root = mkdtempSync(join(tmpdir(), 'blawx setup path with spaces '));
  const project = join(root, 'project with spaces');
  const bin = join(root, 'mock bin');
  const log = join(root, 'npm-arguments.txt');

  writeFileSync(join(root, 'placeholder'), '');
  spawnSync('/bin/mkdir', ['-p', project, bin], { encoding: 'utf8' });
  copyFileSync(setupSource, join(project, 'setup.sh'));
  writeFileSync(join(project, 'package-lock.json'), '{}\n');
  writeFileSync(join(bin, 'node'), `#!/bin/sh
if [ "$1" = "-p" ]; then
  printf '%s\\n' "${major}"
elif [ "$1" = "--version" ]; then
  printf '%s\\n' "v${major}.0.0"
else
  exit 97
fi
`);
  writeFileSync(join(bin, 'npm'), `#!/bin/sh
printf '%s\\n' "$@" > "$BLAWX_SETUP_TEST_LOG"
`);
  chmodSync(join(project, 'setup.sh'), 0o755);
  chmodSync(join(bin, 'node'), 0o755);
  chmodSync(join(bin, 'npm'), 0o755);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  return {
    log,
    project,
    env: {
      ...process.env,
      BLAWX_SETUP_TEST_LOG: log,
      PATH: `${bin}:/usr/bin:/bin`,
    },
  };
}

test('setup is side-effect-bounded and uses the pinned install command', () => {
  const source = readFileSync(setupSource, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env sh\n/);
  assert.match(source, /set -eu/);
  assert.equal(source.match(/npm ci --ignore-scripts --no-audit --no-fund/g)?.length, 1);
  assert.doesNotMatch(source, /npm install|curl|wget|sudo|codex/);
  assert.doesNotMatch(source, /^\s*npm run dev/m);
});

test('setup accepts Node 22 in a path containing spaces without running real npm', (t) => {
  const harness = makeHarness(t, 22);
  const result = spawnSync('/bin/sh', [join(harness.project, 'setup.sh')], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: harness.env,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(harness.log, 'utf8').trim().split('\n'), [
    'ci',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ]);
  assert.match(result.stdout, /Setup complete/);
});

test('setup rejects a different Node major before npm runs', (t) => {
  const harness = makeHarness(t, 20);
  const result = spawnSync('/bin/sh', [join(harness.project, 'setup.sh')], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: harness.env,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node\.js 22 is required; found v20\.0\.0/);
  assert.equal(existsSync(harness.log), false);
});
