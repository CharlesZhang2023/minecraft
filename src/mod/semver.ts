// Just enough semantic versioning for dependency ranges: '*', '1.2.3', '=1.2', '>=1.0 <2', '^1.4', '~1.4.2',
// '1.x', and alternatives with '||'.

type V = [number, number, number, string];

export function parseVersion(s: string): V | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(s.trim());
  if (!m) return null;
  return [+m[1], +(m[2] ?? 0), +(m[3] ?? 0), m[4] ?? ''];
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
  return cmp(x, y);
}

function cmp(x: V, y: V): number {
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  // a pre-release sorts before its release
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return x[3] < y[3] ? -1 : 1;
}

/** Does `version` satisfy `range`? */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split('||').some((alt) => {
    const parts = alt.trim().split(/\s+/).filter(Boolean);
    return parts.every((p) => test(v, p));
  });
}

function test(v: V, p: string): boolean {
  if (p === '*' || p === 'x' || p === '') return true;
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(p)!;
  const op = m[1] ?? '', body = m[2];
  // x-ranges: 1.x, 1.2.x, 1, 1.2
  const xs = body.split('.');
  const wild = xs.findIndex((s) => s === 'x' || s === 'X' || s === '*');
  const given = wild >= 0 ? wild : xs.length;
  const want = parseVersion(body.replace(/\.[xX*](\.[xX*])*$/, '').replace(/^[xX*]$/, '0'));
  if (!want) return false;
  const c = cmp(v, want);
  switch (op) {
    case '>=': return c >= 0;
    case '<=': return c <= 0;
    case '>': return c > 0;
    case '<': return c < 0;
    case '^': {
      // same left-most non-zero part
      if (c < 0) return false;
      if (want[0] > 0) return v[0] === want[0];
      if (want[1] > 0) return v[0] === 0 && v[1] === want[1];
      return v[0] === 0 && v[1] === 0 && v[2] === want[2];
    }
    case '~': return c >= 0 && v[0] === want[0] && (given < 2 || v[1] === want[1]);
    default:
      // exact, or a prefix when parts were left out ('1.2' matches 1.2.x)
      if (given >= 3) return c === 0;
      return v[0] === want[0] && (given < 2 || v[1] === want[1]);
  }
}
