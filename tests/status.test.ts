import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The team's statuses as one rule for every recommendation. Offline, against
// a throwaway data dir; every person is invented.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vnet-status-"));
process.env.DATA_DIR = dir;
process.env.APP_TODAY = "2026-10-24";
process.env.PRH_OFFLINE = "1";

const { buildNetwork, applyOutreach, loadNetwork } = await import("../lib/network.ts");
const DEMO_PROFILE = (await import("../lib/profile.ts")).demoProfile();
const { looseKey } = await import("../lib/prh.ts");
const { thisWeek, findPeople, peopleForTheme, followUps, recordStatus } = await import("../lib/queries.ts");
const { loadDemoWithReactions } = await import("../lib/demo.ts");
const { readState } = await import("../lib/state.ts");
type Owner = import("../lib/store.ts").Owner;
type Resolved = import("../lib/matching.ts").Resolved;
type PrhCompany = import("../lib/prh.ts").PrhCompany;

const owner = (id: string, name: string): Owner => ({ id, name, file: `${id}.csv`, original: `${id}.csv`, importedAt: "2026-10-24T10:00:00Z", rows: 0, accepted: 0, skipped: 0, noCompany: 0, noUrl: 0, demo: true });
const co = (businessId: string, name: string, tol: string): PrhCompany => ({ businessId, name, otherNames: [], tol, industry: `Industry ${tol}`, town: "TAMPERE", registrationDate: "2000-01-01", active: true, situations: [], formCode: "16" });
const res = (raw: string, company: PrhCompany): Resolved => ({ raw, key: looseKey(raw), status: "verified", company, candidates: [company], note: "", by: "rule", foreign: false });

// Three strong fits and four possible ones (a CFO decides, but not on operations), each at their own invented company.
const HEAD = "First Name,Last Name,URL,Email Address,Company,Position,Connected On\n";
const IN = "https://www.linkedin.com/" + "in/";
const people = [
  ["Aino", "Aalto", "Operations Director"],
  ["Ville", "Vainio", "COO"],
  ["Sanna", "Salo", "Tuotantojohtaja"],
  ["Pekka", "Peltola", "CFO"],
  ["Riikka", "Rinne", "CFO"],
  ["Oskari", "Ojala", "CFO"],
  ["Tiina", "Toivonen", "CFO"],
];
const text = HEAD + people.map(([f, l, t], i) => `${f},${l},https://www.linkedin.com/in/${f.toLowerCase()}-${l.toLowerCase()}-st,,Testikonepaja ${i} Oy,${t},01 Mar 2024`).join("\n");
const resolved = new Map(people.map((_, i) => [`Testikonepaja ${i} Oy`, res(`Testikonepaja ${i} Oy`, co(`500000${i}-${i}`, `Testikonepaja ${i} Oy`, "28150"))]));
const small = (status: Record<string, import("../lib/state.ts").StatusEntry> = {}) =>
  buildNetwork({ networks: [{ owner: owner("you", "You"), text }], resolved, state: { version: 2, status, overrides: {}, reactions: [], angles: {} }, profile: DEMO_PROFILE, signals: null, today: "2026-10-24" });

test("this week: strong fits always first; a possible fit only when fewer than five strong ones are left", () => {
  const net = small();
  assert.equal(net.contacts.filter((c) => c.fit === "strong").length, 3);
  const week = thisWeek(net);
  assert.equal(week.length, 5);
  assert.deepEqual(week.map((w) => w.fit), ["strong", "strong", "strong", "possible", "possible"]);
  // One strong fit marked sent: two strong ones are left, so three possible fits fill the five, after them.
  const sent = net.contacts.find((c) => c.position === "COO")!;
  const at = "2026-10-20T09:00:00.000Z";
  const week2 = thisWeek(small({ [sent.id]: { status: "sent", at, by: "You", history: [{ status: "sent", at, by: "You" }] } }));
  assert.deepEqual(week2.map((w) => w.fit), ["strong", "strong", "possible", "possible", "possible"]);
  assert.ok(!week2.some((w) => w.id === sent.id));
});

test("status rule: sent is hidden and due for a follow-up after 7 days; replied, meeting and not_fit never return; a snooze ends", () => {
  const net = small();
  const [a, b, c, d, e] = net.contacts;
  const entry = (status: import("../lib/state.ts").Status, at: string, until?: string) => ({ status, at, by: "You", ...(until ? { until } : {}), history: [{ status, at, by: "You" }] });
  const n2 = small({
    [a.id]: entry("sent", "2026-10-20T09:00:00.000Z"),
    [b.id]: entry("sent", "2026-10-10T09:00:00.000Z"),
    [c.id]: entry("replied", "2026-10-01T09:00:00.000Z"),
    [d.id]: entry("not_fit", "2025-01-01T09:00:00.000Z"),
    [e.id]: entry("snoozed", "2026-10-01T09:00:00.000Z", "2026-11-01"),
  });
  const o = (id: string) => n2.byId.get(id)!.outreach;
  assert.deepEqual(o(a.id), { hidden: true, followUpOn: "2026-10-27", followUpDue: false });
  assert.equal(o(b.id).followUpDue, true, "sent 14 days ago, no reply: due");
  assert.equal(o(c.id).hidden, true);
  assert.equal(o(d.id).hidden, true, "not a fit, long ago: still never");
  assert.deepEqual([o(e.id).hidden, o(e.id).until], [true, "2026-11-01"]);
  for (const list of [thisWeek(n2).map((p) => p.id), findPeople(n2, { limit: 100 }).people.map((p) => p.id), peopleForTheme(n2, { theme: "Lean", industries: ["metal"] }).people.map((p) => p.id)])
    for (const id of [a.id, b.id, c.id, d.id, e.id]) assert.ok(!list.includes(id));
  assert.deepEqual(followUps(n2).people.map((p) => p.id), [b.id], "a follow-up is a nudge, not a recommendation");
  assert.equal(findPeople(n2, { include_contacted: true, limit: 100 }).total, 7, "lookups can still find everyone");
  // The snooze ends on its day.
  applyOutreach(n2.contacts, "2026-11-01");
  assert.equal(n2.byId.get(e.id)!.outreach.hidden, false);
});

test("cooldown: a colleague contacted in the last 30 days puts the others at the company lower, with a note", () => {
  // Two people at one company; the colleague had a meeting on 20 Oct.
  const t = HEAD + [`Aino,Aalto,${IN}aino-aalto-cd,,Yhteinen Oy,Operations Director,01 Mar 2024`, `Ville,Vainio,${IN}ville-vainio-cd,,Yhteinen Oy,COO,01 Mar 2024`, `Sanna,Salo,${IN}sanna-salo-cd,,Toinen Oy,COO,01 Mar 2024`].join("\n");
  const r = new Map([
    ["Yhteinen Oy", res("Yhteinen Oy", co("6000000-6", "Yhteinen Oy", "28150"))],
    ["Toinen Oy", res("Toinen Oy", co("6000001-4", "Toinen Oy", "28150"))],
  ]);
  const base = buildNetwork({ networks: [{ owner: owner("you", "You"), text: t }], resolved: r, state: { version: 2, status: {}, overrides: {}, reactions: [], angles: {} }, profile: DEMO_PROFILE, signals: null, today: "2026-10-24" });
  const aino = base.contacts.find((c) => c.name === "Aino Aalto")!;
  const ville = base.contacts.find((c) => c.name === "Ville Vainio")!;
  const history = [
    { status: "sent" as const, at: "2026-10-06T09:00:00.000Z", by: "You" },
    { status: "meeting" as const, at: "2026-10-20T09:00:00.000Z", by: "You" },
  ];
  const net = buildNetwork({ networks: [{ owner: owner("you", "You"), text: t }], resolved: r, state: { version: 2, status: { [aino.id]: { ...history[1], history } }, overrides: {}, reactions: [], angles: {} }, profile: DEMO_PROFILE, signals: null, today: "2026-10-24" });
  const v = net.byId.get(ville.id)!;
  assert.deepEqual(v.outreach.cooldown, { on: "2026-10-20", id: aino.id, name: "Aino Aalto" });
  const found = findPeople(net, {}).people;
  assert.equal(found.at(-1)!.id, ville.id, "ranks after the others");
  assert.equal(found.at(-1)!.cooldown, "Colleague contacted 20 Oct (Aino Aalto)");
  // 31 days later the cooldown is over.
  applyOutreach(net.contacts, "2026-11-21");
  assert.equal(net.byId.get(ville.id)!.outreach.cooldown, undefined);
});

test("set_status: the same record as the app's buttons, with time and teammate, and what it means", async () => {
  fs.rmSync(path.join(dir, "state.json"), { force: true });
  await loadDemoWithReactions();
  let net = await loadNetwork();
  const p = thisWeek(net)[0];
  const r = await recordStatus(net, { person_id: p.id, status: "sent", owner: "Co-founder", note: "LinkedIn message" });
  assert.ok(!("error" in r));
  if ("error" in r) return;
  assert.equal(r.by, "Co-founder");
  assert.match(r.followUpOn!, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.means, /^Won't be recommended while waiting for a reply; follow-up due on \d{1,2} [A-Z][a-z]{2} \d{4}/);
  const saved = readState().status[p.id];
  assert.deepEqual([saved.status, saved.by, saved.note, saved.history.length], ["sent", "Co-founder", "LinkedIn message", 1]);
  net = await loadNetwork();
  assert.ok(!thisWeek(net).some((w) => w.id === p.id), "the app stops recommending them");
  const snooze = await recordStatus(net, { person_id: p.id, status: "snoozed" });
  assert.ok(!("error" in snooze) && snooze.until === "2027-01-22" && /until 22 Jan 2027/.test(snooze.means), "90 days by default");
  const done = await recordStatus(await loadNetwork(), { person_id: p.id, status: "meeting" });
  assert.ok(!("error" in done) && done.means.startsWith("Won't be recommended again."));
  assert.ok("error" in (await recordStatus(net, { person_id: p.id, status: "sent", owner: "Nobody" })));
  assert.ok("error" in (await recordStatus(net, { person_id: "nope", status: "sent" })));
});

test("demo: a follow-up is due and a colleague was contacted, out of the box", async () => {
  const net = await loadNetwork();
  const due = followUps(net);
  assert.deepEqual(due.people.map((p) => [p.name, p.sentOn, p.sentBy, p.followUpOn, p.daysSinceSent]), [["Lasse Järvinen", "2026-10-14", "You", "2026-10-21", 10]]);
  assert.equal(followUps(net, "Co-founder").total, 0, "only what that teammate sent");
  const metal = findPeople(net, { industries: ["metal"], limit: 100 }).people;
  assert.ok(metal.some((p) => p.cooldown === "Colleague contacted 20 Oct (Arttu Lehto)"));
  assert.ok(!metal.some((p) => p.name === "Arttu Lehto" || p.name === "Lasse Järvinen"));
});

test("MCP: find people, record that the message was sent, ask again: the person is gone", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildMcpServer } = await import("../lib/mcp.ts");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await buildMcpServer().connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { ...r, data: r.isError ? null : JSON.parse(r.content[0].text) };
  };
  const tools = (await client.listTools()).tools.map((t) => t.name);
  for (const t of ["set_status", "follow_ups", "this_week", "find_people"]) assert.ok(tools.includes(t), t);
  const ask = { industries: ["food"], fit: "strong", limit: 10 };
  const first = (await call("find_people", ask)).data.people[0];
  const set = await call("set_status", { person_id: first.id, status: "sent", owner: "You" });
  assert.equal(set.data.status, "sent");
  assert.match(set.data.means, /follow-up due on/);
  const again = (await call("find_people", ask)).data.people;
  assert.ok(!again.some((p: { id: string }) => p.id === first.id), "gone from recommendations");
  const lookup = (await call("find_people", { ...ask, include_contacted: true })).data.people;
  assert.equal(lookup.find((p: { id: string }) => p.id === first.id)?.status, "Sent");
  assert.ok(!(await call("this_week", {})).data.people.some((p: { id: string }) => p.id === first.id));
  assert.equal((await call("follow_ups", { owner: "You" })).data.total, 1, "the demo's own follow-up; this one is due in 7 days");
  assert.equal((await call("set_status", { person_id: first.id, status: "sent", owner: "Nobody" })).isError, true);
  await client.close();
});
