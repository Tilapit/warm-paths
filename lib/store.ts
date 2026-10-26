// Where the team's networks live on disk. One LinkedIn Connections.csv per
// owner in data/sources/networks/, listed in data/sources/owners.json.
// Everything under data/sources, data/cache and data/state.json is gitignored.
// DATA_DIR moves all of it (networks, state, PRH cache) elsewhere, e.g.
// DATA_DIR=data-mine for real networks next to the demo.
import fs from "node:fs";
import path from "node:path";
import { blankEmails, parseConnections } from "./ingest.ts";
import { slug } from "./normalize.ts";

export const dataDir = () => path.resolve(process.env.DATA_DIR || "data");
export const sourcesDir = () => path.join(dataDir(), "sources");
const networksDir = () => path.join(sourcesDir(), "networks");
const ownersFile = () => path.join(sourcesDir(), "owners.json");
const demoDir = () => process.env.DEMO_DIR || path.join(process.cwd(), "data", "demo");

export type Owner = {
  id: string;
  name: string;
  file: string;
  /** The name of the file as uploaded. */
  original: string;
  importedAt: string;
  rows: number;
  accepted: number;
  skipped: number;
  noCompany: number;
  noUrl: number;
  demo: boolean;
};

export const DEMO_NETWORKS = [
  { id: "you", name: "You", file: "Connections.csv" },
  { id: "cofounder", name: "Co-founder", file: "Connections-cofounder.csv" },
  { id: "board", name: "Board member", file: "Connections-board.csv" },
];

export function readOwners(): Owner[] {
  try {
    return JSON.parse(fs.readFileSync(ownersFile(), "utf8")) as Owner[];
  } catch {
    return [];
  }
}

function writeOwners(owners: Owner[]) {
  fs.mkdirSync(sourcesDir(), { recursive: true });
  fs.writeFileSync(ownersFile(), JSON.stringify(owners, null, 2));
}

export function ownerText(o: Owner): string {
  return fs.readFileSync(path.join(networksDir(), o.file), "utf8");
}

/** File signature for the model cache. */
export function sourcesSignature(): string {
  const owners = readOwners();
  return owners
    .map((o) => {
      try {
        return `${o.id}:${fs.statSync(path.join(networksDir(), o.file)).mtimeMs}`;
      } catch {
        return `${o.id}:-`;
      }
    })
    .join("|");
}

/**
 * Stores one owner's Connections.csv. Re-uploading for the same owner name
 * replaces their file. Throws when the file is not a LinkedIn export.
 */
export function importNetwork(name: string, text: string, opts: { demo?: boolean; id?: string; original?: string } = {}): Owner {
  const ownerName = name.trim() || "You";
  const { records, report } = parseConnections(text, opts.original ?? "Connections.csv");
  if (!report.rows || !records.length) throw new Error(report.warnings[0] ?? "No connections found in this file.");
  const owners = readOwners();
  const existing = owners.find((o) => o.name.toLowerCase() === ownerName.toLowerCase());
  let id = opts.id ?? existing?.id ?? (slug(ownerName) || "owner");
  if (!existing) for (let i = 2; owners.some((o) => o.id === id); i++) id = `${slug(ownerName) || "owner"}-${i}`;
  const owner: Owner = {
    id,
    name: ownerName,
    file: `${id}.csv`,
    original: opts.original ?? "Connections.csv",
    importedAt: new Date().toISOString(),
    rows: report.rows,
    accepted: records.length,
    skipped: report.rows - records.length,
    noCompany: records.filter((r) => !r.company).length,
    noUrl: records.filter((r) => !/linkedin\.com\/in\//i.test(r.url)).length,
    demo: !!opts.demo,
  };
  fs.mkdirSync(networksDir(), { recursive: true });
  // No emails are stored: the column stays, its values are blanked.
  fs.writeFileSync(path.join(networksDir(), owner.file), blankEmails(text).text);
  const others = owners.filter((o) => o.id !== id);
  // A real network replaces the invented demo networks; mixing them would confuse.
  const keep = owner.demo ? others : others.filter((o) => !o.demo);
  for (const o of others) if (!keep.includes(o)) fs.rmSync(path.join(networksDir(), o.file), { force: true });
  writeOwners([...keep, owner]);
  return owner;
}

export function deleteOwner(id: string) {
  const owners = readOwners();
  const o = owners.find((x) => x.id === id);
  if (!o) return;
  fs.rmSync(path.join(networksDir(), o.file), { force: true });
  writeOwners(owners.filter((x) => x.id !== id));
}

/** One click: the three invented networks from data/demo. Replaces whatever is loaded. */
export function loadDemo(): Owner[] {
  fs.rmSync(sourcesDir(), { recursive: true, force: true });
  for (const d of DEMO_NETWORKS) {
    const text = fs.readFileSync(path.join(demoDir(), d.file), "utf8");
    importNetwork(d.name, text, { demo: true, id: d.id, original: d.file });
  }
  return readOwners();
}

/**
 * Deletes the team's networks, their decisions and the PRH lookups made for
 * their company names. The signal radar snapshot is public register data,
 * not derived from anyone's network, and is kept.
 */
export function deleteAllData() {
  fs.rmSync(sourcesDir(), { recursive: true, force: true });
  fs.rmSync(path.join(dataDir(), "state.json"), { force: true });
  fs.rmSync(path.join(dataDir(), "cache", "prh", "ytj"), { recursive: true, force: true });
}
