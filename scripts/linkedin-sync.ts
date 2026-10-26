// Fetches one member's connections from LinkedIn's Member Data Portability
// API (EU DMA, CONNECTIONS only) with their own token, LINKEDIN_DMA_TOKEN in
// .env.local, and imports them as that teammate, as a Connections.csv would.
// Prints counts and field coverage only: never a name, never the token.
//
//   npm run linkedin:sync -- --owner "Friend" --dry-run    fetch and count, store nothing
//   DATA_DIR=data-mine npm run linkedin:sync -- --owner "Friend"    import, then PRH lookups
//   ... --no-lookups    import only; the app looks the companies up later
import path from "node:path";
import { coverageLines, DmaError, fetchConnections, saveSyncRecord, toConnections, toCsv } from "../lib/linkedin-dma.ts";
import { importNetwork } from "../lib/store.ts";
import { ensureMatching, loadNetwork } from "../lib/network.ts";
import { lookupEstimate, matchingDone } from "../lib/matching.ts";
import { fmtWait } from "../lib/estimate.ts";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const value = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};
const stop = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

const dry = has("--dry-run");
const owner = value("--owner")?.trim();
const token = process.env.LINKEDIN_DMA_TOKEN?.trim();
if (!token) stop("No LINKEDIN_DMA_TOKEN in the environment or in .env.local.");
if (!dry && !owner) stop('Say whose connections these are: --owner "Name".');
// The demo lives in data/; a real network imported there would replace it.
if (!dry && !process.env.DATA_DIR) stop("Set DATA_DIR for a real import, e.g. DATA_DIR=data-mine, so the demo in data/ is never touched.");
const dataDir = path.resolve(process.env.DATA_DIR || "data");

console.log(`LinkedIn Member Data Portability API: CONNECTIONS only, Linkedin-Version 202312.${dry ? " Dry run: nothing is stored." : ` Importing into ${dataDir} as "${owner}".`}`);
let fetched: Awaited<ReturnType<typeof fetchConnections>>;
try {
  fetched = await fetchConnections({ token: token!, onPage: (n, rows) => process.stdout.write(`\rPage ${n}: ${rows} rows`) });
} catch (e) {
  process.stdout.write("\n");
  stop(e instanceof DmaError ? e.message : `Could not reach LinkedIn: ${e instanceof Error ? e.message : String(e)}`);
}
process.stdout.write("\n");
const { connections, coverage } = toConnections(fetched!.rows);
console.log(`${fetched!.pages} page${fetched!.pages === 1 ? "" : "s"}${fetched!.retries ? `, ${fetched!.retries} polite retries` : ""}.`);
for (const line of coverageLines(coverage)) console.log(line);
if (dry) {
  console.log("Dry run: nothing stored. Without --dry-run (and with DATA_DIR set) these are imported.");
  process.exit(0);
}

let imported: ReturnType<typeof importNetwork>;
try {
  imported = importNetwork(owner!, toCsv(connections), { original: "LinkedIn API (CONNECTIONS)" });
} catch (e) {
  stop(`Nothing imported: ${e instanceof Error ? e.message : String(e)}`);
}
saveSyncRecord({ at: new Date().toISOString(), owner: owner!, pages: fetched!.pages, coverage });
const o = imported!;
console.log(`Imported ${o.accepted.toLocaleString("en-US")} of ${o.rows.toLocaleString("en-US")} as "${o.name}": ${o.skipped} skipped (no name), ${o.noCompany} without a company, ${o.noUrl} without a profile URL. No emails stored.`);
if (has("--no-lookups")) {
  console.log(`PRH lookups not started. The app starts them when it opens with DATA_DIR=${process.env.DATA_DIR}.`);
  process.exit(0);
}

// As in the app: only company names go to PRH, cached, three at a time.
const net = await loadNetwork();
const est = await lookupEstimate(connections.map((c) => c.company));
console.log(`PRH: ${est.names.toLocaleString("en-US")} company names, ${est.toLookUp.toLocaleString("en-US")} not looked up yet, ${fmtWait(est.seconds)}. Ctrl-C is safe: what is done stays cached and the app goes on later.`);
const job = ensureMatching(net);
const tick = setInterval(() => process.stdout.write(`\rPRH: ${job.done.toLocaleString("en-US")}/${job.total.toLocaleString("en-US")} names`), 2000);
await matchingDone();
clearInterval(tick);
const s = (await loadNetwork()).stats;
console.log(`\nPRH done: ${s.names.verified} matched, ${s.names.inferred} close (check), ${s.names.ambiguous} with several candidates, ${s.names.none} not in PRH${job.failed ? `, ${job.failed} failed (retried next time)` : ""}.`);
// Never a bare count: why they failed, and a few company names to try by hand.
const reasons = Object.entries(job.failures).sort((a, b) => b[1].count - a[1].count);
if (reasons.length) {
  console.log("Failed lookups, by reason:");
  for (const [reason, f] of reasons) console.log(`  ${String(f.count).padStart(5)}  ${reason}`);
  const examples = reasons.flatMap(([, f]) => f.examples).slice(0, 5);
  console.log(`  For example: ${examples.join(", ")}`);
  if (job.lastError) console.log(`  Last error: ${job.lastError}`);
}
console.log(`${s.contacts.toLocaleString("en-US")} people, ${s.decisionMakers} decision-makers, ${s.fits} who fit (${s.strong} strong).`);
