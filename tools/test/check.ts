// Tiny assertion helpers for the Node tests in tools/test.
let failed = 0, passed = 0;
export function check(ok: unknown, msg: string) {
  if (ok) passed++;
  else { failed++; console.log('FAIL ' + msg); }
}
export function eq<T>(a: T, b: T, msg: string) {
  check(a === b, `${msg}: ${String(a)} !== ${String(b)}`);
}
export function done() {
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
