import { chmod, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

function contains(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

function canonicalCandidate(path) {
  const target = resolve(path);
  let ancestor = target;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (!existsSync(ancestor)) return target;
  return resolve(realpathSync(ancestor), relative(ancestor, target));
}

function hasGitWorktreeAncestor(path) {
  let current = resolve(path);
  while (true) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function defaultPrivateDataRoot({ environment = process.env, operatingSystem = platform(), home = homedir() } = {}) {
  if (environment.BLAWX_PRIVATE_DATA_DIR) return resolve(environment.BLAWX_PRIVATE_DATA_DIR);
  if (operatingSystem === 'darwin') return join(home, 'Library', 'Application Support', 'blawx', 'private');
  if (operatingSystem === 'win32') {
    const base = environment.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(base, 'blawx', 'private');
  }
  return join(environment.XDG_DATA_HOME || join(home, '.local', 'share'), 'blawx', 'private');
}

export function resolvePrivateDataRoot({ sourceRoot, dataRoot, allowTestDataRoot = false } = {}) {
  if (!sourceRoot) throw new TypeError('sourceRoot is required.');
  const source = canonicalCandidate(sourceRoot);
  const requestedTarget = resolve(dataRoot || defaultPrivateDataRoot());
  const target = canonicalCandidate(requestedTarget);
  const controlledTestPath = allowTestDataRoot
    && contains(canonicalCandidate(tmpdir()), source)
    && contains(source, target);
  if (contains(source, target)) {
    if (!controlledTestPath) {
      throw new Error('Private runtime data must be stored outside the application source tree.');
    }
  }
  if (hasGitWorktreeAncestor(target) && !controlledTestPath) {
    throw new Error('Private runtime data must be stored outside every Git worktree.');
  }
  return requestedTarget;
}

export async function ensurePrivateDirectory(path) {
  await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(path, PRIVATE_DIRECTORY_MODE);
  return path;
}
