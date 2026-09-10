export function isDeveloperMode(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).has('dev');
}
