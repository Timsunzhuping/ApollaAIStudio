/** Minimal 5-field cron (min hour dom month dow), UTC. Supports * , lists, ranges, and steps. */

function matchField(field: string, value: number, min: number, max: number): boolean {
  for (const part of field.split(',')) {
    if (part === '*') return true;
    if (part.includes('/')) {
      const [rangeRaw, stepRaw] = part.split('/');
      const step = Number(stepRaw);
      if (!Number.isFinite(step) || step <= 0) continue;
      let lo = min;
      let hi = max;
      if (rangeRaw && rangeRaw !== '*') {
        if (rangeRaw.includes('-')) {
          const p = rangeRaw.split('-').map(Number);
          lo = p[0] ?? min;
          hi = p[1] ?? max;
        } else {
          lo = Number(rangeRaw);
          hi = max;
        }
      }
      for (let v = lo; v <= hi; v += step) if (v === value) return true;
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (value >= lo! && value <= hi!) return true;
    } else if (Number(part) === value) {
      return true;
    }
  }
  return false;
}

export function cronMatches(cron: string, d: Date): boolean {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`invalid cron (need 5 fields): ${cron}`);
  return (
    matchField(f[0]!, d.getUTCMinutes(), 0, 59) &&
    matchField(f[1]!, d.getUTCHours(), 0, 23) &&
    matchField(f[2]!, d.getUTCDate(), 1, 31) &&
    matchField(f[3]!, d.getUTCMonth() + 1, 1, 12) &&
    matchField(f[4]!, d.getUTCDay(), 0, 6)
  );
}

/** Next matching minute strictly after `from` (scans up to ~367 days). */
export function nextRun(cron: string, from: Date): Date | undefined {
  const d = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000);
  for (let i = 0; i < 367 * 24 * 60; i++) {
    if (cronMatches(cron, d)) return new Date(d);
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return undefined;
}
