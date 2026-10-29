import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { parseConnections } = await import("../lib/ingest.ts");
const { isoDate } = await import("../lib/normalize.ts");
const { mergeNetworks } = await import("../lib/network.ts");
const { analyseTitle } = await import("../lib/roles.ts");
const DEMO_PROFILE = (await import("../lib/profile.ts")).demoProfile();
type Owner = import("../lib/store.ts").Owner;

// Fixtures in tests/fixtures have exact bytes (BOM, CRLF); every person is invented.
const fx = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const IN = "https://www.linkedin.com/" + "in/";
const parse = (name: string) => parseConnections(fx(name), name);
const owner = (id: string): Owner => ({ id, name: id, file: `${id}.csv`, original: `${id}.csv`, importedAt: "2026-10-24T10:00:00Z", rows: 0, accepted: 0, skipped: 0, noCompany: 0, noUrl: 0, demo: true });

test("import: BOM, CRLF and the Notes preamble as LinkedIn ships it", () => {
  const { records, report } = parse("bom-crlf-notes.csv");
  assert.equal(records.length, 3);
  assert.equal(report.rows, 3);
  assert.deepEqual(report.warnings, []);
  assert.equal(records[0].first, "Aino");
  assert.equal(records[0].connectedOn, "2024-04-12");
  // No carriage return leaks into the last column.
  assert.ok(records.every((r) => !/\r/.test(r.connectedOn) && !/\r/.test(r.position)));
});

test("import: the same people with or without the preamble", () => {
  const a = parse("bom-crlf-notes.csv").records.map(({ row, ...r }) => r);
  const b = parse("no-notes-lf.csv").records.map(({ row, ...r }) => r);
  assert.deepEqual(a, b);
});

test("import: reordered and extra columns are read by name", () => {
  const { records, report } = parse("reordered-extra.csv");
  assert.equal(records.length, 2);
  assert.deepEqual(report.warnings, []);
  assert.equal(records[0].first, "Aino");
  assert.equal(records[0].last, "Kallio");
  assert.equal(records[0].company, "Esimerkki Konepaja Oy");
  assert.equal(records[0].position, "Tuotantojohtaja");
  assert.equal(records[0].url, `${IN}aino-kallio-3f2a`);
  assert.equal(records[1].connectedOn, "2023-01-03");
});

test("import: quoted commas, quotes and newlines stay inside their field", () => {
  const { records } = parse("quoted-multiline.csv");
  assert.equal(records.length, 3);
  assert.equal(records[0].company, "Esimerkki Konepaja Oy, Tampere");
  assert.equal(records[0].position, "Tuotantojohtaja, Operations");
  assert.equal(records[1].position, "Head of Logistics\nand Warehousing");
  assert.equal(records[1].connectedOn, "2023-01-03");
  assert.equal(records[2].company, 'Malliteollisuus "Pro" Ab');
  assert.equal(records[2].position, 'COO | "Lean" fan');
});

test("import: empty company, emoji, a very long title, a nameless row and a non-LinkedIn URL", () => {
  const { records, report } = parse("edge-values.csv");
  assert.equal(report.rows, 5);
  assert.equal(records.length, 4, "the row with no name is skipped");
  assert.ok(report.warnings.some((w) => /1 rows have no name/.test(w)));
  assert.ok(report.warnings.some((w) => /1 connections have no profile URL/.test(w)));
  assert.equal(records[0].company, "");
  assert.equal(records[1].first, "Ville 🚀");
  assert.match(records[1].position, /🔧/);
  assert.ok(records[2].position.length > 500);
  const t0 = performance.now();
  const role = analyseTitle(records[2].position, DEMO_PROFILE.roles);
  assert.ok(performance.now() - t0 < 50, "a long title is read quickly");
  assert.equal(role.decisionMaker, true);
  // The non-LinkedIn URL cannot merge; the person stays on their own.
  const { drafts } = mergeNetworks([{ owner: owner("a"), text: fx("edge-values.csv") }, { owner: owner("b"), text: fx("edge-values.csv") }]);
  assert.equal(drafts.filter((d) => d.name === "Kari Mäki").length, 2);
  assert.equal(drafts.filter((d) => d.name === "Aino Kallio").length, 1);
});

test("import: Excel's semicolon re-save with quoted headers and Finnish dates", () => {
  const { records, report } = parse("excel-semicolon-fi.csv");
  assert.deepEqual(report.warnings, []);
  assert.equal(records.length, 3);
  assert.equal(records[0].first, "Aino");
  assert.equal(records[0].connectedOn, "2024-04-12");
  assert.equal(records[1].company, "Testilogistiikka Oy; Vantaa");
  assert.equal(records[1].connectedOn, "2023-01-03");
  assert.equal(records[2].connectedOn, "2025-11-28");
});

test("import: an older export without URLs imports, and nobody merges by name", () => {
  const { records, report } = parse("old-no-url.csv");
  assert.equal(records.length, 2);
  assert.ok(report.warnings.some((w) => /No URL column/.test(w)));
  const { drafts } = mergeNetworks([{ owner: owner("a"), text: fx("old-no-url.csv") }, { owner: owner("b"), text: fx("old-no-url.csv") }]);
  assert.equal(drafts.length, 4);
});

test("import: a file that is not a connections export gives a clear warning", () => {
  const { records, report } = parse("not-connections.csv");
  assert.equal(records.length, 0);
  assert.match(report.warnings[0], /First Name/);
});

test("dates: LinkedIn, ISO, Finnish and slash forms; impossible dates are empty", () => {
  assert.equal(isoDate("24 Oct 2026"), "2026-10-24");
  assert.equal(isoDate("2026-10-24"), "2026-10-24");
  assert.equal(isoDate("24.10.2026"), "2026-10-24");
  assert.equal(isoDate("10/24/2026"), "2026-10-24");
  assert.equal(isoDate("24/10/2026"), "2026-10-24");
  assert.equal(isoDate("31.2.2026"), "");
  assert.equal(isoDate("12.4.26"), "2026-04-12");
  assert.equal(isoDate("12-Apr-26"), "2026-04-12");
  assert.equal(isoDate("12 April 2026"), "2026-04-12");
  assert.equal(isoDate("soon"), "");
});
