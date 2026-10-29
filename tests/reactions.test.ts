import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Offline, against a throwaway data dir. Every person is invented.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vnet-react-"));
process.env.DATA_DIR = dir;
process.env.APP_TODAY = "2026-10-24";
process.env.PRH_OFFLINE = "1";

const { parseReactions, matchReactions, cleanName } = await import("../lib/reactions.ts");
const { crossSiteWrite } = await import("../lib/csrf.ts");
const { buildNetwork } = await import("../lib/network.ts");
const DEMO_PROFILE = (await import("../lib/profile.ts")).demoProfile();
const { looseKey } = await import("../lib/prh.ts");
const { addReactions } = await import("../lib/queries.ts");
const { analyse } = await import("../lib/analysis.ts");
type Owner = import("../lib/store.ts").Owner;
type Resolved = import("../lib/matching.ts").Resolved;
type PrhCompany = import("../lib/prh.ts").PrhCompany;

const fx = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const HEAD = "First Name,Last Name,URL,Email Address,Company,Position,Connected On\n";
const IN = "https://www.linkedin.com/" + "in/";
const owner = (id: string, name: string): Owner => ({ id, name, file: `${id}.csv`, original: `${id}.csv`, importedAt: "2026-10-24T10:00:00Z", rows: 0, accepted: 0, skipped: 0, noCompany: 0, noUrl: 0, demo: true });
const co = (businessId: string, name: string, tol: string): PrhCompany => ({ businessId, name, otherNames: [], tol, industry: `Industry ${tol}`, town: "TAMPERE", registrationDate: "2000-01-01", active: true, situations: [], formCode: "16" });
const res = (raw: string, company: PrhCompany): Resolved => ({ raw, key: looseKey(raw), status: "verified", company, candidates: [company], note: "", by: "rule", foreign: false });

const YOU = HEAD + [
  `Laura,Mäkelä,${IN}laura-makela,,Lunawood,Operations Director,12 Apr 2019`,
  `Mika,Laine,${IN}mika-laine,,Lunawood Oy,Production Planner,01 Mar 2024`,
  `Mikko,Korhonen,${IN}mikko-korhonen-11,,Reaktor,Software Developer,05 May 2021`,
  `Anna,Virtanen,${IN}anna-virtanen,,Kumera Drives Oy,Head of Production,10 Oct 2025`,
  `Sara,Holm,${IN}sara-holm,,Spotify AB,Engineer,10 Oct 2025`,
].join("\n");
const CO = HEAD + [`Mikko,Korhonen,${IN}mikko-korhonen-22,,Hydroline,CFO,05 May 2022`].join("\n");
const LUNA = co("0606363-5", "Oy Lunawood Ltd", "16239");
const resolved = new Map<string, Resolved>([
  ["Lunawood", res("Lunawood", LUNA)],
  ["Lunawood Oy", res("Lunawood Oy", LUNA)],
  ["Reaktor", res("Reaktor", co("1234567-8", "Reaktor Innovations Oy", "62010"))],
  ["Hydroline", res("Hydroline", co("2417546-2", "Hydroline Oy", "28120"))],
  ["Kumera Drives Oy", res("Kumera Drives Oy", co("1536748-9", "Kumera Drives Oy", "28150"))],
]);
const build = (reactions: import("../lib/state.ts").Reaction[] = []) =>
  buildNetwork({
    networks: [
      { owner: owner("you", "You"), text: YOU },
      { owner: owner("cofounder", "Co-founder"), text: CO },
    ],
    resolved,
    state: { version: 2, status: {}, overrides: {}, reactions, angles: {} },
    profile: DEMO_PROFILE,
    signals: null,
    today: "2026-10-24",
  });
const net = build();
const idOf = (name: string, company: string) => net.contacts.find((c) => c.name === name && c.company === company)!.id;

test("reactions parser: LinkedIn's copied list with repeats, markers, headlines and buttons", () => {
  const r = parseReactions(fx("reactions-linkedin.txt"));
  assert.deepEqual(
    r.map((x) => [x.name, x.degree ?? null, x.headline ?? null]),
    [
      ["Laura Mäkelä", "1st", "Operations Director at Lunawood"],
      ["Mikko Korhonen", "2nd", "CFO | Hydroline"],
      ["Production Manager", "3rd", "Production Manager"],
      ["Sara Holm", "1st", "Engineer at Spotify AB"],
      ["Anna Virtanen", "1st", "Head of Production, Gearboxes"],
      ["Erkki Esimerkki", "2nd", "Plant Manager"],
      ["Mika Laine", "1st", "Production Planner at Lunawood Oy"],
    ],
  );
});

test("reactions parser: a plain list of names, one per line", () => {
  assert.deepEqual(parseReactions("Laura Mäkelä\nMikko Korhonen\n\nAnna Virtanen\n").map((x) => x.name), ["Laura Mäkelä", "Mikko Korhonen", "Anna Virtanen"]);
  assert.equal(cleanName("Dr. Aino Kallio, CSCP (she/her) 🌱"), "Aino Kallio");
  assert.equal(cleanName("Aino Kallio | AI & automation"), "Aino Kallio");
  assert.equal(cleanName("Aino Kallio (Virtanen)"), "Aino Kallio");
  assert.equal(cleanName("Juha-Pekka Nieminen"), "Juha-Pekka Nieminen");
});

test("reactions matcher: name, company in the headline, degree marker, review and unmatched", () => {
  const m = matchReactions(net, [
    { name: "Laura Mäkelä" },
    { name: "Mikko Korhonen", headline: "CFO | Hydroline" },
    { name: "Mikko Korhonen", degree: "1st" },
    { name: "Mikko Korhonen" },
    { name: "Nobody Here" },
  ], { viewer: "you" });
  assert.deepEqual(m.matched.map((x) => [x.entry.name, x.contactId, x.how]), [
    ["Laura Mäkelä", idOf("Laura Mäkelä", "Lunawood"), "name"],
    ["Mikko Korhonen", idOf("Mikko Korhonen", "Hydroline"), "name_company"],
    ["Mikko Korhonen", idOf("Mikko Korhonen", "Reaktor"), "name_degree"],
  ]);
  assert.equal(m.review.length, 1);
  assert.equal(m.review[0].candidates.length, 2);
  assert.deepEqual(m.unmatched.map((x) => x.entry.name), ["Nobody Here"]);
});

test("reactions: stored with a weight in the score, a Reaction reason; names in no network kept apart as engaged", () => {
  const r = addReactions(net, { post: "Kolme oppia pilotista", postDate: "2026-10-14", author: "You", text: fx("reactions-linkedin.txt") });
  assert.equal(r.unmatched.length, 2, "Production Manager and Erkki Esimerkki are in no network");
  // "· 2nd" on your own post rules out the Mikko you know: the co-founder's Mikko at Hydroline.
  assert.ok(r.matched.some((x) => x.name === "Mikko Korhonen" && x.person.id === idOf("Mikko Korhonen", "Hydroline") && x.how === "name_degree"));
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  const names = state.reactions.map((x: { name: string }) => x.name);
  assert.ok(!names.includes("Erkki Esimerkki"), "a name in no network is never a reaction on someone");
  // It is kept apart, with only what the list showed (Settings → Engaged, not connected).
  const erkki = state.engaged.find((e: { name: string }) => e.name === "Erkki Esimerkki");
  assert.ok(erkki && !("url" in erkki) && !("email" in erkki));
  // Pasting the same post again stores nothing new.
  assert.equal(addReactions(net, { post: "Kolme oppia pilotista", postDate: "2026-10-14", author: "You", text: fx("reactions-linkedin.txt") }).saved, 0);
  // A second post: 5 points for one post, +2 for the second.
  const second = { post: "Hackathon", postDate: "2026-10-21", contactId: idOf("Laura Mäkelä", "Lunawood"), name: "Laura Mäkelä", at: "2026-10-22T08:00:00Z", how: "name" as const };
  const n2 = build([...state.reactions, second]);
  const laura = n2.byId.get(idOf("Laura Mäkelä", "Lunawood"))!;
  assert.equal(laura.parts.find((p) => p.label === "Reacted")?.points, 7);
  const a = analyse(n2, laura);
  const reasons = a.reasons.filter((x) => x.kind === "reaction");
  assert.equal(reasons.length, 2);
  assert.equal(reasons[0].source, "Reaction");
  assert.match(reasons[1].text, /Reacted to your post "Kolme oppia pilotista" on 14 Oct 2026/);
  // Reactions older than 90 days no longer count.
  const old = build([{ ...second, postDate: "2026-06-01" }]).byId.get(laura.id)!;
  assert.equal(old.parts.find((p) => p.label === "Reacted"), undefined);
});

test("reactions: picking one of two same-name people keeps the other's automatic match", () => {
  const r = addReactions(net, {
    post: "Two Mikkos",
    postDate: "2026-10-20",
    entries: [{ name: "Mikko Korhonen", headline: "CFO at Hydroline" }, { name: "Mikko Korhonen", headline: "Passionate about people" }],
    picks: [{ name: "Mikko Korhonen", person_id: idOf("Mikko Korhonen", "Reaktor") }],
  });
  assert.deepEqual(r.matched.map((m) => [m.person.id, m.how]).sort(), [[idOf("Mikko Korhonen", "Hydroline"), "name_company"], [idOf("Mikko Korhonen", "Reaktor"), "picked"]].sort());
  assert.equal(r.review.length, 0);
});

test("demo: two posts' reactions are seeded out of the box", async () => {
  const { loadDemoWithReactions } = await import("../lib/demo.ts");
  const { loadNetwork } = await import("../lib/network.ts");
  fs.rmSync(path.join(dir, "state.json"), { force: true });
  await loadDemoWithReactions();
  const demo = await loadNetwork();
  const reacted = demo.contacts.filter((c) => c.reactions.length);
  assert.ok(reacted.length >= 35, `reacted: ${reacted.length}`);
  assert.ok(reacted.some((c) => c.reactions.length === 2), "some reacted to both posts");
  assert.ok(reacted.some((c) => c.fit), "some who fit reacted");
  assert.equal(new Set(demo.contacts.flatMap((c) => c.reactions.map((r) => r.post))).size, 2);
});

test("this week: five by code, nobody contacted, one per company, senders spread, a prompt for Claude", async () => {
  const { thisWeek, claudePrompt } = await import("../lib/queries.ts");
  const { loadNetwork } = await import("../lib/network.ts");
  const { setStatus } = await import("../lib/state.ts");
  const demo = await loadNetwork();
  const week = thisWeek(demo);
  assert.equal(week.length, 5);
  assert.ok(week.some((w) => w.kind === "signal"), "a fresh registered change");
  assert.ok(week.some((w) => w.kind === "reaction"), "a reaction");
  assert.equal(new Set(week.map((w) => w.businessId ?? w.company)).size, 5, "one per company");
  const senders = new Map<string, number>();
  for (const w of week) senders.set(w.sender, (senders.get(w.sender) ?? 0) + 1);
  // The promise on the page: at most two for each sender, always.
  assert.ok(Math.max(...senders.values()) <= 2, `at most two for each sender: ${[...senders.entries()]}`);
  assert.ok(week.every((w) => w.fit === "strong"), "strong fits before possible ones: the demo has more than five");
  assert.ok(week.every((w) => w.why.length > 10 && w.why.length < 140));
  // Within the limit a reason to write now wins: a pick with no fresh change or
  // reaction only where that sender has no one timely left.
  const { weekWhy } = await import("../lib/queries.ts");
  const picked = new Set(week.map((w) => w.id));
  const companies = new Set(week.map((w) => demo.byId.get(w.id)!.companyId));
  for (const w of week.filter((x) => x.kind === "fit")) {
    const left = demo.contacts.filter((c) => c.fit === "strong" && !c.outreach.hidden && c.sender.ownerName === w.sender && !picked.has(c.id) && !companies.has(c.companyId) && weekWhy(demo, c).kind !== "fit");
    assert.equal(left.length, 0, `${w.sender} still had someone timely: ${left.map((c) => c.id)}`);
  }
  assert.ok(week.filter((w) => w.kind !== "fit").length >= 3, `mostly timely: ${week.map((w) => w.kind)}`);
  for (const w of week.filter((x) => x.kind === "signal")) assert.match(w.why, /^.+ registered (a new managing director|a board change|a share issue or capital increase|a merger|a demerger|a merger or demerger) on \d{1,2} [A-Z][a-z]{2} \(PRH\)\.$/);
  assert.equal(week[0].prompt, claudePrompt(demo.byId.get(week[0].id)!));
  assert.match(week[0].prompt, /^Using Warm Paths, write a LinkedIn message to .+ \([0-9a-f]{10}\), approach (direct|ask_intro)\.$/);
  // Marked as sent: off the list next time.
  setStatus(week[0].id, "sent", "You");
  const next = thisWeek(await loadNetwork());
  assert.ok(!next.some((w) => w.id === week[0].id));
});

test("demo: the demo profile marks large groups as not a target; This week per teammate", async () => {
  const { thisWeek, getRadar } = await import("../lib/queries.ts");
  const { loadNetwork } = await import("../lib/network.ts");
  const demo = await loadNetwork();
  assert.equal(demo.profileSource, "demo");
  const marked = new Set((demo.profile.excluded ?? []).map((x) => x.businessId));
  for (const id of ["1927400-1", "0109823-0", "2553019-8", "0128631-1"]) assert.ok(marked.has(id), `${id} marked`);
  assert.ok(!demo.contacts.some((c) => c.fit && c.companyId && marked.has(c.companyId)), "nobody at a marked company is on the list");
  assert.ok(!getRadar(demo).rows.some((r) => marked.has(r.businessId)), "nor on the radar");
  assert.ok(!thisWeek(demo).some((w) => w.businessId && marked.has(w.businessId)));
  for (const o of demo.owners) {
    const w = thisWeek(demo, 5, o.id);
    assert.equal(w.length, 5, `${o.name}: five`);
    assert.ok(w.every((p) => demo.byId.get(p.id)!.knownBy.some((k) => k.owner === o.id)), `${o.name}'s five are in their network`);
  }
});

test("draft here: the request to Claude carries no name", async () => {
  const { draftPrompt } = await import("../lib/claude.ts");
  const { messageContext } = await import("../lib/queries.ts");
  const { loadNetwork } = await import("../lib/network.ts");
  const demo = await loadNetwork();
  const c = demo.contacts.find((x) => x.fit === "strong")!;
  const names = { name: c.name, sender: c.sender.ownerName, owners: demo.owners.map((o) => o.name) };
  const sent = draftPrompt(messageContext(demo, { person_id: c.id, type: "direct" })!, names);
  for (const part of c.name.split(" ")) assert.ok(!sent.includes(part), `no "${part}"`);
  for (const o of ["Co-founder", "Board member"]) assert.ok(!sent.includes(o), `no teammate "${o}"`);
  assert.match(sent, /\[FIRST_NAME\]/);
  // A sole trader named after the person: masked inside the company too.
  const own = draftPrompt({ type: "direct", facts: ["Name: Aino Kallio", "Company: Aino Kallio Tmi, consulting", "Sender: Mikael, connected 1 Jan 2024; also known by Mikko."], mustNotUse: ["Current role: downloaded (Mikael, Mikko)"], rules: [], examples: [] }, { name: "Aino Kallio", sender: "Mikael", owners: ["Mikael", "Mikko"] });
  assert.ok(!/Aino|Kallio|Mikael|Mikko/.test(own), own);
});

test("review fixes: picks need the person's own name; markers are relative to who copied; a contradicting marker leaves the name unmatched", () => {
  const laura = idOf("Laura Mäkelä", "Lunawood");
  const bad = addReactions(net, { post: "Picks", postDate: "2026-10-20", picks: [{ name: "Totally Different Person", person_id: laura }], save: false });
  assert.equal(bad.matched.length, 0);
  assert.equal(bad.ignoredPicks?.length, 1);
  // "· 2nd" on your own copy: the only Laura is your 1st-degree connection, so it is someone else.
  const m1 = matchReactions(net, [{ name: "Laura Mäkelä", degree: "2nd", headline: "Teacher at Some School" }], { viewer: "you" });
  assert.equal(m1.matched.length, 0);
  assert.match(m1.unmatched[0].why, /degree marker/);
  // The co-founder's post copied by you: "1st" means someone you know.
  const r = addReactions(net, { post: "Copied by you", postDate: "2026-10-20", author: "Co-founder", copiedBy: "You", entries: [{ name: "Mikko Korhonen", degree: "1st" }], save: false });
  assert.deepEqual(r.matched.map((x) => x.person.id), [idOf("Mikko Korhonen", "Reaktor")]);
});

test("review fixes: the parser keeps repeats out of headlines, splits same-name neighbours, reads unusual names", () => {
  assert.deepEqual(parseReactions("Laura Mäkelä\nLaura Mäkelä\nOperations Director at Lunawood\n"), [{ name: "Laura Mäkelä", headline: "Operations Director at Lunawood" }]);
  const two = parseReactions("Mikko Korhonen\nMikko Korhonen\n· 1st\nCFO at Hydroline\nMikko Korhonen\nMikko Korhonen\n· 2nd\nDeveloper at Reaktor\n");
  assert.deepEqual(two.map((x) => [x.degree, x.headline]), [["1st", "CFO at Hydroline"], ["2nd", "Developer at Reaktor"]]);
  const odd = parseReactions("Maria dos Santos\nMaria dos Santos\n· 2nd\nEngineer\naino kallio\n· 1st\nTuotantojohtaja\n");
  assert.deepEqual(odd.map((x) => x.name), ["Maria dos Santos", "aino kallio"]);
  // A line read as nobody is reported, not dropped silently.
  const r = addReactions(net, { post: "Unread", text: "Laura Mäkelä\nLaura Mäkelä\n· 1st\nOperations Director at Lunawood\nSomething odd 123\n", save: false });
  assert.deepEqual(r.unread, ["Something odd 123"]);
});


test("review fixes: other websites cannot write; this app's pages, scripts and reads can", () => {
  const r = (method: string, h: Record<string, string>) => new Request("http://localhost:3100/api/reactions", { method, headers: { host: "localhost:3100", ...h } });
  assert.equal(crossSiteWrite(r("POST", { "sec-fetch-site": "cross-site", origin: "https://evil.example" })), true);
  assert.equal(crossSiteWrite(r("POST", { origin: "http://localhost:3000" })), true);
  assert.equal(crossSiteWrite(r("POST", { "sec-fetch-site": "same-site" })), true);
  assert.equal(crossSiteWrite(r("POST", { "sec-fetch-site": "same-origin", origin: "http://localhost:3100" })), false);
  assert.equal(crossSiteWrite(r("POST", {})), false, "curl and scripts");
  assert.equal(crossSiteWrite(r("GET", { "sec-fetch-site": "cross-site" })), false, "reads are not writes");
});
