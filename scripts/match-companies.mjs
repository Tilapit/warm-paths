// Matches every company name in the loaded networks against PRH YTJ and
// reports how long it took. Loads the demo networks first if nothing is loaded.
// Usage: node scripts/match-companies.mjs [--demo]
import { loadNetwork, ensureMatching } from "../lib/network.ts";
import { matchingDone } from "../lib/matching.ts";
import { loadDemo, readOwners } from "../lib/store.ts";

if (process.argv.includes("--demo") || !readOwners().length) loadDemo();
const t0 = Date.now();
let net = await loadNetwork();
console.log(`${net.stats.contacts} contacts from ${net.stats.rows} rows, ${net.names.size} distinct company names, ${net.stats.names.pending} not in the cache yet`);
const job = ensureMatching(net);
const tick = setInterval(() => process.stdout.write(`\r${job.done}/${job.total} names, ${job.requests} requests`), 2000);
await matchingDone();
clearInterval(tick);
net = await loadNetwork();
const s = net.stats;
console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s, ${job.requests} PRH requests, ${job.failed} failed${job.lastError ? ` (${job.lastError})` : ""}`);
console.log("Names:", s.names);
console.log(`Companies matched: ${s.companies.matched} of ${s.companies.total}. Decision-makers: ${s.decisionMakers}. In profile: ${s.inProfile}. Fits: ${s.fits} (${s.strong} strong). Known by 2+: ${s.knownByTwo}.`);
