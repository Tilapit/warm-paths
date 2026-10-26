// Fetches the signal radar (PRH registered notices, last 90 days) into
// data/cache/prh/signals.json. Safe to stop and re-run: pages are cached.
// Usage: node scripts/fetch-signals.mjs [--days 90]
import { refreshSignals } from "../lib/signals.ts";
import { stats } from "../lib/prh.ts";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 90;
const t0 = Date.now();
const set = await refreshSignals({ days, log: (s) => console.log(new Date().toISOString().slice(11, 19), s) });
console.log(`${set.signals.length} signals, ${set.pages} pages, complete: ${set.complete}, ${stats.requests} requests (${stats.retries} retries), ${Math.round((Date.now() - t0) / 1000)} s`);
