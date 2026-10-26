// Writes two snapshots into data/demo, taken from the local cache, so the demo
// works without network access (a fresh clone, PRH down, "Delete my data"):
// - prh-matches.json: the PRH match decision for every company name in the
//   demo exports. Used only for demo networks, only when the cache has no answer.
// - signals-snapshot.json: registered notices of the last 90 days for
//   companies in TOL 01-53. Used only when no signals have been fetched.
import fs from "node:fs";
import path from "node:path";
import { parseConnections } from "../lib/ingest.ts";
import { matchCompany } from "../lib/prh.ts";
import { DEMO_NETWORKS } from "../lib/store.ts";
import { loadSignals } from "../lib/signals.ts";

const dir = path.join(process.cwd(), "data", "demo");
const names = new Set();
for (const d of DEMO_NETWORKS) for (const r of parseConnections(fs.readFileSync(path.join(dir, d.file), "utf8")).records) if (r.company) names.add(r.company);
const out = {};
let pending = 0;
for (const n of [...names].sort()) {
  const m = await matchCompany(n, { offline: true });
  if (m.status === "pending") pending++;
  else out[n] = { status: m.status, note: m.note, company: m.company, candidates: m.candidates.slice(0, 6) };
}
fs.writeFileSync(path.join(dir, "prh-matches.json"), JSON.stringify(out));
console.log(`${Object.keys(out).length} names written, ${pending} not in the cache`);

const set = loadSignals();
if (set) {
  const signals = set.signals.filter((x) => Number(String(x.tol).slice(0, 2)) >= 1 && Number(String(x.tol).slice(0, 2)) <= 53);
  fs.writeFileSync(path.join(dir, "signals-snapshot.json"), JSON.stringify({ ...set, snapshot: true, signals }));
  console.log(`${signals.length} signals written (TOL 01-53, ${set.start} to ${set.end})`);
}
