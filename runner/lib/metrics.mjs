// Aggregate timing and outcome stats for a job. Only counts and durations: never lead data (the logs are public).
export function summarize(values) {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, p50: q(0.5), p95: q(0.95), max: v.at(-1), mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length) };
}

export class Metrics {
  constructor(kind) { this.kind = kind; this.t0 = Date.now(); this.series = {}; this.counts = {}; this.groups = {}; }
  time(name, ms) { (this.series[name] ||= []).push(Math.round(ms)); }
  count(name, key, by = 1) { const c = (this.counts[name] ||= {}); c[key] = (c[key] || 0) + by; }
  /** Per-group tally, e.g. outcomes by form tool. */
  group(name, key, field) { const g = ((this.groups[name] ||= {})[key] ||= {}); g[field] = (g[field] || 0) + 1; }
  toJSON(extra = {}) {
    const stages = Object.fromEntries(Object.entries(this.series).map(([k, v]) => [k, summarize(v)]));
    // Raw durations (rounded to 0.1 s, capped) let the scorecard compute exact percentiles across jobs.
    const raw = Object.fromEntries(Object.entries(this.series).filter(([k]) => !k.endsWith('_results')).map(([k, v]) => [k, v.slice(0, 400).map(x => Math.round(x / 100))]));   // durations only
    return { kind: this.kind, wall_ms: Date.now() - this.t0, stages, counts: this.counts, groups: this.groups, raw, ...extra };
  }
}
