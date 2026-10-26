// How long PRH lookups take, shared by the server and the import screen.

/**
 * Seconds per company name not yet in the cache, from the demo's cold run:
 * 545 names in 4 min 45 s, three requests in flight, one start every 250 ms.
 */
export const COLD_SECONDS_PER_NAME = 0.53;

/** "under a minute", "about 9 minutes", "about 1.5 hours". */
export function fmtWait(seconds: number): string {
  if (seconds < 45) return "under a minute";
  if (seconds < 90) return "about a minute";
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} minutes`;
  return `about ${(seconds / 3600).toFixed(1)} hours`;
}
