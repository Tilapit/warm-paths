// No Node imports: this runs in the middleware (Edge runtime) too.
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A request that would change data, sent by another website open in the same
 * browser (a form or a no-cors fetch to localhost). Browsers mark these with
 * Sec-Fetch-Site and Origin; scripts and curl send neither and stay allowed,
 * since only this machine can reach the server.
 */
export function crossSiteWrite(req: Request): boolean {
  if (SAFE.has(req.method.toUpperCase())) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== req.headers.get("host");
  } catch {
    return true;
  }
}
