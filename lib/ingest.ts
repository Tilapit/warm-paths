// LinkedIn's Connections.csv parser. Returns clean records plus a report of
// what was accepted and why rows were skipped, so the import can show
// coverage honestly. It tolerates what happens to the file on the way: a
// byte order mark, Windows line ends, the "Notes:" preamble or none, columns
// reordered or added, quoted headers, and Excel's semicolon re-save with
// Finnish dates. An older export without the URL column still imports; its
// people just cannot be merged with teammates'.
import Papa from "papaparse";
import type { ImportReport } from "./types.ts";
import { isoDate, profileKey } from "./normalize.ts";

type Row = Record<string, string>;

export type ConnectionRow = { first: string; last: string; url: string; email: string; company: string; position: string; connectedOn: string; row: number };

/** Header names as LinkedIn writes them, plus the forms they take after a re-save. */
const COLUMNS: Record<Exclude<keyof ConnectionRow, "row">, string[]> = {
  first: ["first name"],
  last: ["last name"],
  url: ["url", "profile url", "linkedin url"],
  email: ["email address", "email"],
  company: ["company"],
  position: ["position", "title"],
  connectedOn: ["connected on"],
};
const REQUIRED = ["first", "last", "company", "position"] as const;

const header = (h: string) => h.replace(/^﻿/, "").trim().replace(/^"|"$/g, "").trim().toLowerCase();

/** LinkedIn "Get a copy of your data" → Connections.csv. */
export function parseConnections(text: string, file = "Connections.csv") {
  const report: ImportReport = { kind: "connections", file, rows: 0, accepted: 0, warnings: [] };
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  // The header may come after LinkedIn's "Notes:" preamble, or first, and
  // its columns may be in any order.
  const start = lines.slice(0, 50).findIndex((l) => {
    const cells = l.split(/[,;\t]/).map(header);
    return cells.includes("first name") && cells.includes("last name");
  });
  if (start < 0) {
    report.warnings.push("No 'First Name' header found. Is this LinkedIn's Connections.csv?");
    return { records: [] as ConnectionRow[], report };
  }
  const res = Papa.parse<Row>(lines.slice(start).join("\n"), { header: true, skipEmptyLines: "greedy", transformHeader: header, delimitersToGuess: [",", ";", "\t"] });
  const rows = res.data;
  report.rows = rows.length;
  const have = new Set(res.meta.fields ?? []);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, names.find((n) => have.has(n))])) as Record<keyof typeof COLUMNS, string | undefined>;
  const missing = REQUIRED.filter((k) => !col[k]).map((k) => COLUMNS[k][0].replace(/\b\w/g, (c) => c.toUpperCase()));
  if (missing.length) {
    report.warnings.push(`Missing columns: ${missing.join(", ")}`);
    return { records: [] as ConnectionRow[], report };
  }
  if (!col.url) report.warnings.push("No URL column (an older export?). These people cannot be merged with teammates' connections.");
  if (!col.connectedOn) report.warnings.push("No 'Connected On' column, so the suggested sender cannot use connection dates.");
  const get = (r: Row, k: keyof typeof COLUMNS) => {
    const c = col[k];
    return c ? (r[c] ?? "").trim() : "";
  };
  const records: ConnectionRow[] = [];
  let noUrl = 0;
  let noName = 0;
  let badDate = 0;
  rows.forEach((r, i) => {
    const first = get(r, "first");
    const last = get(r, "last");
    if (!first && !last) {
      noName++;
      return;
    }
    const url = get(r, "url");
    if (!profileKey(url)) noUrl++;
    const rawDate = get(r, "connectedOn");
    const connectedOn = isoDate(rawDate);
    if (rawDate && !connectedOn) badDate++;
    records.push({ first, last, url, email: get(r, "email"), company: get(r, "company"), position: get(r, "position"), connectedOn, row: start + i + 2 });
  });
  if (noName) report.warnings.push(`${noName} rows have no name and were skipped.`);
  if (noUrl && col.url) report.warnings.push(`${noUrl} connections have no profile URL, so they cannot be merged with teammates' connections.`);
  if (badDate) report.warnings.push(`${badDate} 'Connected On' dates were not understood and are left empty.`);
  report.accepted = records.length;
  return { records, report };
}

/**
 * The same file with every Email Address value empty. The column, the rows
 * and their order stay, so row numbers (citations) do not change; the
 * preamble before the header is kept as it was. `blanked` counts the values
 * removed. A file without an email column comes back unchanged.
 */
export function blankEmails(text: string): { text: string; blanked: number } {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = text.slice(bom.length);
  const lines = body.split(/\r\n|\r|\n/);
  const start = lines.slice(0, 50).findIndex((l) => {
    const cells = l.split(/[,;\t]/).map(header);
    return cells.includes("first name") && cells.includes("last name");
  });
  if (start < 0) return { text, blanked: 0 };
  // The preamble's own bytes, line ends included, up to the header line.
  const parts = body.split(/(\r\n|\r|\n)/);
  const pre = parts.slice(0, start * 2).join("");
  const rest = parts.slice(start * 2).join("");
  const newline = /\r\n/.test(rest) ? "\r\n" : /\r/.test(rest) && !/\n/.test(rest) ? "\r" : "\n";
  const res = Papa.parse<string[]>(rest, { delimitersToGuess: [",", ";", "\t"] });
  const rows = res.data;
  const at = (rows[0] ?? []).map(header).findIndex((h) => COLUMNS.email.includes(h));
  if (at < 0) return { text, blanked: 0 };
  let blanked = 0;
  for (const r of rows.slice(1)) {
    if (r[at]?.trim()) {
      r[at] = "";
      blanked++;
    }
  }
  if (!blanked) return { text, blanked: 0 };
  // Papa reads a final newline as one empty row; keep it as a newline.
  const trailing = rows.length > 1 && rows.at(-1)!.length === 1 && rows.at(-1)![0] === "";
  const out = Papa.unparse(trailing ? rows.slice(0, -1) : rows, { delimiter: res.meta.delimiter, newline });
  return { text: bom + pre + out + (trailing ? newline : ""), blanked };
}
