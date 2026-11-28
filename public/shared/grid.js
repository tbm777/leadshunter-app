// Search grid math, shared by the browser (estimates), the Worker (task creation) and tests.
const KM_PER_DEG = 111.32;

/** City "size" radius in km from population: ~3 km for small towns, up to 25 km for the largest metros. */
export function cityRadiusKm(pop) {
  return Math.max(3, Math.min(25, 0.012 * Math.sqrt(pop || 0)));
}

/**
 * Grid spacing for a circle of radius rKm. A map search returns at most about 20 businesses, so each search covers a
 * fairly wide area (typically 15-20 results back); the runner splits any search that comes back full into four smaller
 * ones, so dense downtowns are still covered completely without wasting searches on quiet suburbs.
 */
export function spacingKm(rKm) {
  return Math.max(5, Math.min(14, rKm / 2.5));
}

export function zoomFor(spacing) {
  return spacing <= 4 ? 14 : spacing <= 10 ? 13 : 12;
}

/** Points covering a circle on a square lattice. Returns [lat, lon, spacingKm]. */
export function pointsForCircle(lat, lon, rKm) {
  // A town (up to ~8 km across in radius, about 450,000 people) is covered by one wider search centred on it, reaching
  // 3 km past its edge: one search returns up to ~20 businesses, and a full one is split by the runner, so small towns
  // no longer cost five tiny searches that mostly return the same few businesses.
  if (rKm <= 8) { const S = (rKm + 3) / 0.75; return [[lat, lon, S]]; }
  const S = spacingKm(rKm);
  const n = Math.ceil(rKm / S);
  const dLat = S / KM_PER_DEG;
  const dLon = S / (KM_PER_DEG * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const pts = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (Math.hypot(i * S, j * S) <= rKm + S * 0.5) pts.push([lat + j * dLat, lon + i * dLon, S]);
    }
  }
  return pts;
}

/**
 * Build search cells for a list of circles and search terms.
 * Overlapping points from neighbouring circles are merged.
 * Each cell: [lat, lon, radius_m, zoom, termIdx, country].
 */
export function buildCells(circles, termCount) {
  const seen = new Set();
  const pts = [];
  for (const c of circles) {
    for (const p of pointsForCircle(c.lat, c.lon, c.r)) {
      const key = Math.round(p[0] / (p[2] / KM_PER_DEG / 2)) + ':' + Math.round(p[1] / (p[2] / KM_PER_DEG / 2));
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push([p[0], p[1], p[2], c.country || 'US']);
    }
  }
  const cells = [];
  // Place by place (largest cities come first), every term at each place: a search that stops at its lead limit
  // has then covered the biggest areas with all terms.
  for (const [lat, lon, S, cc] of pts) {
    for (let t = 0; t < termCount; t++) cells.push([+lat.toFixed(5), +lon.toFixed(5), Math.round(S * 750), zoomFor(S), t, cc]);
  }
  return cells;
}

/** Split a saturated cell into four smaller ones (used by the runner in dense areas). */
export function splitCell([lat, lon, radiusM, zoom, t, cc]) {
  const S = radiusM / 750 / 2; // new spacing in km
  const off = S / 2;
  const dLat = off / KM_PER_DEG;
  const dLon = off / (KM_PER_DEG * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const r = Math.round(S * 750);
  const z = Math.min(17, zoom + 1);
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => [+(lat + a * dLat).toFixed(5), +(lon + b * dLon).toFixed(5), r, z, t, cc]);
}
