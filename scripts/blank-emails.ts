// Blanks the Email Address values in every network CSV already stored in the
// data folder (DATA_DIR, default data/). The column and the rows stay, so row
// numbers do not change. New imports are blanked when they are stored.
//   node --experimental-strip-types scripts/blank-emails.ts
//   DATA_DIR=data-mine node --experimental-strip-types scripts/blank-emails.ts
import fs from "node:fs";
import path from "node:path";
import { blankEmails, parseConnections } from "../lib/ingest.ts";
import { sourcesDir } from "../lib/store.ts";

const dir = path.join(sourcesDir(), "networks");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".csv")) : [];
if (!files.length) console.log(`No network CSVs in ${dir}.`);
for (const f of files) {
  const file = path.join(dir, f);
  const before = fs.readFileSync(file, "utf8");
  const { text, blanked } = blankEmails(before);
  if (!blanked) {
    console.log(`${f}: no email values.`);
    continue;
  }
  // Same people, same rows: refuse to write anything else.
  const a = parseConnections(before).records.map((r) => `${r.row}|${r.url}|${r.company}|${r.position}`);
  const b = parseConnections(text).records.map((r) => `${r.row}|${r.url}|${r.company}|${r.position}`);
  if (a.join("\n") !== b.join("\n")) {
    console.error(`${f}: rows would change; left as it was.`);
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(file, text);
  console.log(`${f}: ${blanked} email values blanked, ${b.length} rows unchanged.`);
}
