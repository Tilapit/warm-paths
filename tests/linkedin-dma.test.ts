import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// LinkedIn's Member Snapshot API, CONNECTIONS, against hand-made pages of
// the documented response shape. Every person is invented; the token is fake
// and no request leaves this process.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vnet-dma-"));
process.env.DATA_DIR = dir;
process.env.PRH_OFFLINE = "1";

const { fetchConnections, toConnections, toCsv, coverageLines, DmaError, DMA_VERSION, dmaStatus, saveSyncRecord } = await import("../lib/linkedin-dma.ts");
const { parseConnections } = await import("../lib/ingest.ts");
const { importNetwork, readOwners, ownerText } = await import("../lib/store.ts");

const TOKEN = "fake-token-for-tests-0000";
const fx = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
type Reply = { status: number; body: string; headers?: Record<string, string> };
/** A fake fetch: answers from `replies` in order and records every request. */
function fake(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers });
    const r = replies.shift() ?? { status: 404, body: fx("dma-no-data.json") };
    return { status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => r.body };
  };
  return { fetch, calls };
}
const noWait = async () => {};

test("linkedin: pages through CONNECTIONS until 'No data found', with the version the docs require", async () => {
  const f = fake([
    { status: 200, body: fx("dma-connections-page-0.json") },
    { status: 200, body: fx("dma-connections-page-1.json") },
    { status: 404, body: fx("dma-no-data.json") },
  ]);
  const r = await fetchConnections({ token: TOKEN, fetch: f.fetch, sleep: noWait });
  assert.equal(r.rows.length, 4);
  assert.equal(r.pages, 2);
  assert.deepEqual(
    f.calls.map((c) => c.url),
    [0, 1, 2].map((s) => `https://api.linkedin.com/rest/memberSnapshotData?q=criteria&domain=CONNECTIONS&start=${s}`),
  );
  for (const c of f.calls) {
    assert.equal(c.headers["Linkedin-Version"], DMA_VERSION);
    assert.equal(DMA_VERSION, "202312");
    assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`);
  }
});

test("linkedin: retries 429 and 5xx politely, stops on 401 with a clear message that never holds the token", async () => {
  const waits: number[] = [];
  const f = fake([
    { status: 429, body: "", headers: { "retry-after": "3" } },
    { status: 503, body: "busy" },
    { status: 200, body: fx("dma-connections-page-1.json") },
    { status: 404, body: fx("dma-no-data.json") },
  ]);
  const r = await fetchConnections({ token: TOKEN, fetch: f.fetch, sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.rows.length, 1);
  assert.equal(r.retries, 2);
  assert.equal(waits[0], 3000, "Retry-After in seconds");
  assert.ok(waits[1] >= 2000, "then a growing pause");

  const expired = fake([{ status: 401, body: '{"message":"Invalid access token"}' }]);
  await assert.rejects(fetchConnections({ token: TOKEN, fetch: expired.fetch, sleep: noWait }), (e: InstanceType<typeof DmaError>) => {
    assert.equal(e.status, 401);
    assert.match(e.message, /expired or been revoked/);
    assert.ok(!e.message.includes(TOKEN));
    return true;
  });
  assert.equal(expired.calls.length, 1, "no retry on 401");

  const always = fake(Array.from({ length: 10 }, () => ({ status: 500, body: "down" })));
  await assert.rejects(fetchConnections({ token: TOKEN, fetch: always.fetch, sleep: noWait }), /kept answering 500/);
  assert.equal(always.calls.length, 6, "gives up after six tries");

  await assert.rejects(fetchConnections({ token: TOKEN, fetch: fake([{ status: 404, body: fx("dma-no-data.json") }]).fetch, sleep: noWait }), /no CONNECTIONS snapshot for this member yet/);
  await assert.rejects(fetchConnections({ token: TOKEN, fetch: fake([{ status: 426, body: "NONEXISTENT_VERSION" }]).fetch, sleep: noWait }), /only accepts Linkedin-Version 202312/);
});

test("linkedin: rows map into the Connections.csv model, emails dropped, and the coverage says which fields came back", async () => {
  const pages = [fx("dma-connections-page-0.json"), fx("dma-connections-page-1.json")].map((b) => JSON.parse(b).elements[0].snapshotData).flat();
  const { connections, coverage } = toConnections(pages);
  assert.deepEqual(coverage, { rows: 4, first: 4, last: 4, url: 3, profileUrl: 3, company: 3, position: 4, connectedOn: 3, connectedOnDates: 3, emailsDropped: 1, otherKeys: ["Note"] });
  const csv = toCsv(connections);
  assert.ok(!/@|Email/.test(csv), "no email anywhere");
  // The same parser as an uploaded Connections.csv reads it, quotes and all.
  const { records, report } = parseConnections(csv, "LinkedIn API (CONNECTIONS)");
  assert.equal(records.length, 4);
  assert.equal(records[1].company, "Testilogistiikka Oy, Vantaa");
  assert.equal(records[1].position, 'Head of Logistics, "Lean"');
  assert.equal(records[0].connectedOn, "2024-04-12");
  assert.ok(report.warnings.some((w) => /no profile URL/.test(w)));
  // Counts and field names only, never a name or a value.
  const lines = coverageLines(coverage).join("\n");
  for (const p of pages) for (const v of Object.values(p)) if (String(v).length > 3) assert.ok(!lines.includes(String(v)), `printed a value: ${v}`);
  assert.match(lines, /URL\s+3\s+75%/);
  assert.match(lines, /1 rows had one; dropped, never stored/);

  // Imported as the teammate, into DATA_DIR, without emails; Settings sees counts only.
  const o = importNetwork("Friend", csv, { original: "LinkedIn API (CONNECTIONS)" });
  assert.equal(readOwners()[0].name, "Friend");
  assert.ok(ownerText(o).startsWith("First Name,Last Name,URL,Company,Position,Connected On"));
  assert.ok(fs.existsSync(path.join(dir, "sources", "networks", o.file)), "inside DATA_DIR");
  saveSyncRecord({ at: "2026-10-25T09:00:00.000Z", owner: "Friend", pages: 2, coverage });
  delete process.env.LINKEDIN_DMA_TOKEN;
  assert.equal(dmaStatus().connected, false);
  process.env.LINKEDIN_DMA_TOKEN = TOKEN;
  process.env.LINKEDIN_DMA_TOKEN_EXPIRES = "2026-12-24";
  const st = dmaStatus();
  assert.deepEqual([st.connected, st.expires, st.lastSync?.coverage.rows], [true, "2026-12-24", 4]);
  assert.ok(!JSON.stringify(st).includes(TOKEN), "the status never carries the token");
  delete process.env.LINKEDIN_DMA_TOKEN;
});
