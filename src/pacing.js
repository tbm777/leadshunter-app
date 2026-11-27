// Send pacing: how many forms a campaign may start right now.
// Pure functions (no database), so a whole day can be simulated in tests.

export const BATCH = 40;        // most forms in one runner job
export const MIN_BATCH = 5;     // wait to gather at least this many, so small limits don't start a job every 10 minutes
export const TOOL_CAP = 1000;   // default forms per day across the whole tool

/**
 * Warm-up for a sender profile: forms per day by days since its first send.
 * Roughly 100/day the first week, rising to the full limit after four weeks.
 */
export function rampCap(daysSinceFirst) {
  if (daysSinceFirst == null) return 100;          // never sent: day 1
  if (daysSinceFirst < 7) return 100;
  if (daysSinceFirst < 14) return 250;
  if (daysSinceFirst < 21) return 500;
  if (daysSinceFirst < 28) return 750;
  return Infinity;
}

/**
 * Forms a campaign may start now so that its daily limit is spread evenly across the sending window.
 * nowH, startH and endH are hours of the day in Pacific time (nowH with a fraction, e.g. 9.5 = 9:30).
 * The allowance includes the current 10-minute slot; it catches up after a pause but never bursts.
 */
export function paceAllowance({ limit, sent, startH, endH, nowH }) {
  if (!(endH > startH) || nowH < startH || nowH >= endH || sent >= limit) return 0;
  const span = endH - startH;
  const f = Math.min(1, (nowH - startH + 1 / 6) / span);
  const target = Math.min(limit, Math.ceil(limit * f));
  const due = target - sent;
  if (due <= 0) return 0;
  // Gather a worthwhile batch, unless the window is about to close or the day's limit is reached.
  const lastSlot = endH - nowH <= 1 / 6 + 1e-9;
  if (due < MIN_BATCH && target < limit && !lastSlot) return 0;
  return Math.min(due, BATCH);
}

/** The most a campaign may send now, given every limit that applies. */
export function allowedNow({ pace, campaignLeft, senderLeft, toolLeft }) {
  return Math.max(0, Math.min(pace, campaignLeft, senderLeft, toolLeft));
}
