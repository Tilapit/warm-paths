import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Everything runs offline against a throwaway data dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vnet-"));
process.env.DATA_DIR = dir;
process.env.APP_TODAY = "2026-10-24";
process.env.PRH_OFFLINE = "1";

const { parseConnections } = await import("../lib/ingest.ts");
const { isoDate } = await import("../lib/normalize.ts");
const { buildNetwork, mergeNetworks, fitFor, approachFor, signalPoints, isOyj } = await import("../lib/network.ts");
const { analyseTitle, isStrongRole } = await import("../lib/roles.ts");
const { groupForTol, industryRule, looksForeign } = await import("../lib/industry.ts");
const DEMO_PROFILE = (await import("../lib/profile.ts")).demoProfile();
const { decide, strictKey, looseKey } = await import("../lib/prh.ts");
const { radarScore, rankIndustries, peopleForTheme, addReactions, getRadar } = await import("../lib/queries.ts");
const { signalsFromPage } = await import("../lib/signals.ts");
const { analyse } = await import("../lib/analysis.ts");
type Owner = import("../lib/store.ts").Owner;
type Resolved = import("../lib/matching.ts").Resolved;
type PrhCompany = import("../lib/prh.ts").PrhCompany;

const HEAD = 'Notes:\n"When exporting your connection data, you may notice that some of the email addresses are missing."\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\n';
const csv = (rows: string[]) => HEAD + rows.join("\n") + "\n";
const owner = (id: string, name: string): Owner => ({ id, name, file: `${id}.csv`, original: `${id}.csv`, importedAt: "2026-10-24T10:00:00Z", rows: 0, accepted: 0, skipped: 0, noCompany: 0, noUrl: 0, demo: true });

const co = (businessId: string, name: string, tol: string, extra: Partial<PrhCompany> = {}): PrhCompany => ({ businessId, name, otherNames: [], tol, industry: `Industry ${tol}`, town: "TAMPERE", registrationDate: "2000-01-01", active: true, situations: [], formCode: "16", ...extra });
const res = (raw: string, status: Resolved["status"], company?: PrhCompany, foreign = false): Resolved => ({ raw, key: looseKey(raw), status, company, candidates: company ? [company] : [], note: "", by: "rule", foreign });

const YOU = csv([
  "Laura,Mäkelä,https://www.linkedin.com/in/laura-makela-1a2b3c4d,,Lunawood,Operations Director,12 Apr 2019",
  "Mika,Laine,https://www.linkedin.com/in/mika-laine,,Lunawood Oy,Production Planner,01 Mar 2024",
  "Mikko,Korhonen,https://www.linkedin.com/in/mikko-korhonen-11,,Reaktor,Software Developer,05 May 2021",
  "Mikko,Korhonen,https://www.linkedin.com/in/mikko-korhonen-22,,Hydroline,CFO,05 May 2022",
  'Anna,Virtanen,,,"Kumera Drives Oy","Head of Production, Gearboxes 🚀",10 Oct 2025',
  "Sara,Holm,https://www.linkedin.com/in/sara-holm,,Spotify AB,Engineer,10 Oct 2025",
]);
const CO = csv([
  "Laura,Mäkelä,https://www.linkedin.com/in/Laura-Makela-1a2b3c4d/,,Lunawood,Operations Director,02 Feb 2023",
  "Anna,Virtanen,,,Kumera Drives Oy,\"Head of Production, Gearboxes 🚀\",01 Jan 2020",
]);

const LUNA = co("0606363-5", "Oy Lunawood Ltd", "16239");
const HYDRO = co("2417546-2", "Hydroline Oy", "28120");
const KUMERA = co("1536748-9", "Kumera Drives Oy", "28150");
const REAKTOR = co("1234567-8", "Reaktor Innovations Oy", "62010");
const resolved = new Map<string, Resolved>([
  ["Lunawood", res("Lunawood", "verified", LUNA)],
  ["Lunawood Oy", res("Lunawood Oy", "verified", LUNA)],
  ["Reaktor", res("Reaktor", "inferred", REAKTOR)],
  ["Hydroline", res("Hydroline", "verified", HYDRO)],
  ["Kumera Drives Oy", res("Kumera Drives Oy", "verified", KUMERA)],
  ["Spotify AB", res("Spotify AB", "none", undefined, true)],
]);
const signals = {
  fetchedAt: "2026-10-24T00:00:00Z",
  start: "2026-07-26",
  end: "2026-10-24",
  complete: true,
  pages: 1,
  signals: [
    { businessId: "2417546-2", company: "Hydroline Oy", tol: "28120", type: "md_change" as const, date: "2026-10-01", recordNumber: "2026/1", entryCodes: ["TOIM"] },
    { businessId: "9999999-9", company: "Stranger Konepaja Oy", tol: "25620", type: "new_money" as const, date: "2026-10-20", recordNumber: "2026/2", entryCodes: ["KOROI"] },
  ],
};
const emptyState = { version: 2 as const, status: {}, overrides: {}, reactions: [], angles: {} };
const net = buildNetwork({
  networks: [
    { owner: owner("you", "You"), text: YOU },
    { owner: owner("cofounder", "Co-founder"), text: CO },
  ],
  resolved,
  state: emptyState,
  profile: DEMO_PROFILE,
  signals,
  today: "2026-10-24",
});
const byName = (n: string) => net.contacts.filter((c) => c.name === n);

test("LinkedIn export: preamble skipped, dates parsed, quoted commas and emoji kept", () => {
  const { records, report } = parseConnections(YOU);
  assert.equal(report.rows, 6);
  assert.equal(records.length, 6);
  assert.equal(records[4].position, "Head of Production, Gearboxes 🚀");
  assert.equal(isoDate("12 Apr 2026"), "2026-04-12");
});

test("the 57-row story file and the three mock exports parse every row", () => {
  for (const [file, n] of [["Connections-small.csv", 57], ["Connections.csv", 1500], ["Connections-cofounder.csv", 860], ["Connections-board.csv", 300]] as const) {
    const { records, report } = parseConnections(fs.readFileSync(path.join(process.cwd(), "data/demo", file), "utf8"), file);
    assert.equal(report.rows, n, file);
    assert.equal(records.length, n, file);
    assert.ok(records.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.connectedOn) && r.connectedOn <= "2026-10-24"), file);
  }
});

test("merge: same profile URL is one person known by both owners, earliest connection sends", () => {
  const [laura] = byName("Laura Mäkelä");
  assert.equal(byName("Laura Mäkelä").length, 1, "URL case and trailing slash do not split a person");
  assert.deepEqual(laura.knownBy.map((k) => k.owner), ["you", "cofounder"]);
  assert.equal(laura.sender.ownerName, "You", "You connected in 2019, the co-founder in 2023");
});

test("merge: a name alone never merges, rows without a URL stay separate", () => {
  assert.equal(byName("Mikko Korhonen").length, 2, "two Mikko Korhonens at different companies");
  assert.equal(byName("Anna Virtanen").length, 2, "no URL, so the same name in two exports is two contacts");
  const { drafts } = mergeNetworks([{ owner: owner("you", "You"), text: YOU }]);
  assert.equal(drafts.length, 6);
});

test("fit: strong needs a senior title matching a target role, in a non-lower-priority target industry", () => {
  const rule = industryRule("28120", DEMO_PROFILE);
  const lower = industryRule("35110", DEMO_PROFILE);
  assert.ok(rule && !rule.lowerPriority);
  assert.ok(lower?.lowerPriority);
  const roles = DEMO_PROFILE.roles;
  assert.equal(fitFor(analyseTitle("Production Director", roles), rule, [], roles), "strong");
  assert.equal(fitFor(analyseTitle("Tuotantojohtaja", roles), rule, [], roles), "strong");
  assert.equal(fitFor(analyseTitle("COO", roles), rule, [], roles), "strong");
  assert.equal(fitFor(analyseTitle("CFO", roles), rule, [], roles), "possible", "senior, not a target role");
  assert.equal(fitFor(analyseTitle("CFO", roles), rule, [], []), "strong", "no target roles: any senior title");
  assert.equal(fitFor(analyseTitle("Production Manager", roles), rule, [], roles), "possible", "manager level");
  assert.equal(fitFor(analyseTitle("Production Director", roles), lower, [], roles), "possible", "lower-priority industry");
  assert.equal(fitFor(analyseTitle("Production Planner", roles), rule, [], roles), null, "matches a word, decides nothing");
  assert.equal(fitFor(analyseTitle("Production Director", roles), null, [], roles), null, "not a target industry");
  assert.equal(byName("Laura Mäkelä")[0].fit, "strong");
  assert.equal(byName("Mikko Korhonen").find((c) => c.position === "CFO")!.fit, "possible");
});

test("approach: direct for fits, ask_intro at a target company, skip otherwise", () => {
  const rule = industryRule("16239", DEMO_PROFILE);
  assert.equal(approachFor("strong", rule), "direct");
  assert.equal(approachFor(null, rule), "ask_intro");
  assert.equal(approachFor(null, null), "skip");
  assert.equal(byName("Mika Laine")[0].approach, "ask_intro");
  assert.equal(byName("Mikko Korhonen").find((c) => c.position.startsWith("Software"))!.approach, "skip");
});

test("titles: Finnish and Swedish forms, foremen, owners and craft titles", () => {
  const r = (t: string) => analyseTitle(t, DEMO_PROFILE.roles);
  assert.ok(isStrongRole(r("Tehtaanjohtaja")));
  assert.ok(isStrongRole(r("Produktionsdirektör")));
  assert.ok(isStrongRole(r("Operatiivinen johtaja")));
  assert.equal(r("Työnjohtaja").decisionMaker, false);
  assert.notEqual(r("Product Owner").level, "exec");
  assert.equal(r("Head Brewer").decisionMaker, false);
  assert.equal(r("Tuotantotyöntekijä").decisionMaker, false);
  assert.equal(r("Chief Digital Officer").decisionMaker, true, "C-level always counts");
  assert.equal(r("").decisionMaker, false);
});

test("industry groups: every TOL maps to a readable group, boats go to maritime", () => {
  assert.equal(groupForTol("28300"), "metal");
  assert.equal(groupForTol("30120"), "maritime");
  assert.equal(groupForTol("33150"), "maritime");
  assert.equal(groupForTol("50200"), "maritime");
  assert.equal(groupForTol("33122"), "metal");
  assert.equal(groupForTol("10710"), "food");
  assert.equal(groupForTol("16239"), "wood");
  assert.equal(groupForTol("46642"), "wholesale");
  assert.equal(groupForTol("52250"), "logistics");
  // The groups the broad profile needs, so "Other industries" is not one big cloud.
  assert.equal(groupForTol("62010"), "software");
  assert.equal(groupForTol("70220"), "services");
  assert.equal(groupForTol("64190"), "finance");
  assert.equal(groupForTol("47110"), "retail");
  assert.equal(groupForTol("86230"), "health");
  assert.equal(groupForTol("59110"), "media");
  assert.equal(groupForTol("90010"), "media");
  assert.equal(groupForTol("56101"), "hospitality");
  assert.equal(groupForTol("35110"), "energy");
  assert.equal(groupForTol("85100"), "other");
  assert.equal(groupForTol(undefined), "other");
  const groups = new Map(net.contacts.map((c) => [c.name + c.position, c.group]));
  assert.equal(groups.get("Sara HolmEngineer"), "abroad");
  assert.ok(looksForeign("Bolt Technology OÜ", "bolt technology ou"));
  assert.ok(!looksForeign("Oy Sisu Auto Ab", "sisu auto"), "Finland-Swedish Ab is not foreign");
  // Every contact is in exactly one group, so column counts add up.
  assert.equal(net.contacts.length, net.contacts.filter((c) => c.group).length);
});

test("signals: scoring by type weight, company signals reach its contacts", () => {
  assert.equal(signalPoints([]).points, 0);
  const one = signalPoints([signals.signals[0]]);
  assert.equal(one.points, 12, "MD change: weight 3 x 4");
  assert.equal(radarScore([{ type: "md_change", date: "2026-10-20" }], "2026-10-24"), 3);
  assert.equal(radarScore([{ type: "md_change", date: "2026-08-01" }, { type: "board_change", date: "2026-10-20" }], "2026-10-24"), 3.5);
  const cfo = byName("Mikko Korhonen").find((c) => c.position === "CFO")!;
  assert.equal(cfo.signals.length, 1);
  assert.ok(cfo.parts.some((p) => p.label === "Signal"));
  const radar = getRadar(net);
  assert.equal(radar.rows[0].company, "Hydroline Oy", "warm rows first");
  assert.equal(radar.rows[0].known.length, 1);
  assert.equal(radar.rows[1].known.length, 0);
});

test("signals: notices pages filter types, dates, housing companies and bankruptcies", () => {
  const page = {
    companies: [
      { businessId: { value: "1" }, names: [{ name: "A Oy", type: "1", version: 1 }], mainBusinessLine: { type: "25620" }, companyForms: [{ type: "16", version: 1 }], publicNotices: [{ registrationDate: "2026-10-01", recordNumber: "r1", entryCodes: ["TOIM"] }] },
      { businessId: { value: "2" }, names: [{ name: "As Oy B", type: "1", version: 1 }], companyForms: [{ type: "2", version: 1 }], publicNotices: [{ registrationDate: "2026-10-01", recordNumber: "r2", entryCodes: ["TOIM"] }] },
      { businessId: { value: "3" }, names: [{ name: "C Oy", type: "1", version: 1 }], companyForms: [{ type: "16", version: 1 }], companySituations: [{ type: "KONK" }], publicNotices: [{ registrationDate: "2026-10-01", recordNumber: "r3", entryCodes: ["TOIM"] }] },
      { businessId: { value: "4" }, names: [{ name: "D Oy", type: "1", version: 1 }], companyForms: [{ type: "16", version: 1 }], publicNotices: [{ registrationDate: "2026-01-01", recordNumber: "r4", entryCodes: ["TOIM"] }] },
      { businessId: { value: "5", registrationDate: "2026-09-01" }, names: [{ name: "New Oy", type: "1", version: 1 }], companyForms: [{ type: "16", version: 1 }], publicNotices: [{ registrationDate: "2026-09-02", recordNumber: "r5", entryCodes: ["TOIM"] }] },
    ],
  };
  const out = signalsFromPage("md_change", page, "2026-07-26", "2026-10-24");
  // "5" was founded in the window: its first MD is not a change.
  assert.deepEqual(out.map((s) => s.businessId), ["1"]);
});

test("PRH matching: exact = verified, holding company does not collide, close = inferred, several = ambiguous", () => {
  const search = (companies: PrhCompany[]) => [{ query: "x", fetchedAt: "", totalResults: companies.length, companies }];
  assert.equal(strictKey("Oy Sisu Auto Ab"), "sisu auto");
  assert.equal(decide("Hydroline", search([HYDRO, co("1", "Hydroline Group Oy", "70100")])).status, "verified");
  assert.equal(decide("Hydroline Group", search([co("1", "Hydroline Group Oy", "70100")])).status, "verified");
  assert.equal(decide("Kyrö Distillery Company", search([co("2502509-5", "Rye Rye Oy", "11010", { otherNames: [{ name: "Kyrö Distillery Company Oy", kind: "previous" }] })])).status, "inferred");
  assert.equal(decide("Teerenpeli", search([co("1", "Teerenpeli Panimo & Tislaamo Oy", "11010"), co("2", "Teerenpeli Ravintolat Oy", "56101")])).status, "ambiguous");
  assert.equal(decide("Nowhere", search([])).status, "none");
  const pending = co("3", "Vahterus Oy", "28290", { active: false, registrationDate: undefined });
  assert.equal(decide("Vahterus", search([co("0839356-6", "Vahterus Oy", "28290"), pending])).status, "verified", "pending registrations are ignored");
});

test("analysis: reasons carry sources, headcount is always missing", () => {
  const laura = byName("Laura Mäkelä")[0];
  const a = analyse(net, laura);
  assert.deepEqual(a.reasons.map((r) => r.source), ["LinkedIn title", "PRH", "Your network", "Your team"]);
  assert.equal(a.reasons[1].provenance, "verified");
  assert.ok(a.missing.some((m) => m.label === "Headcount"));
  assert.equal(a.angle.by, "template");
  assert.ok(a.angle.text.includes("Lunawood"));
});

test("industries and themes: ranking is code, approach per person", () => {
  const rows = rankIndustries(net);
  assert.equal(rows[0].group, "metal");
  const theme = peopleForTheme(net, { theme: "Wood industry breakfast", industries: ["Wood and building products"] });
  assert.equal(theme.people[0].name, "Laura Mäkelä");
  assert.equal(theme.people[0].themeApproach, "invite");
  assert.equal(theme.people.find((p) => p.name === "Mika Laine")?.themeApproach, "ask_intro");
});

test("reactions: a unique name is stored, a duplicate name goes to review, an unknown name is not stored", () => {
  const r = addReactions(net, { post: "Post about AI in sawmills", names: ["Laura Mäkelä", "Mikko Korhonen", "Nobody Here"] });
  assert.deepEqual(r.matched.map((m) => m.name), ["Laura Mäkelä"]);
  assert.deepEqual(r.review.map((x) => x.name), ["Mikko Korhonen"]);
  assert.equal(r.review[0].candidates.length, 2);
  assert.deepEqual(r.unmatched.map((x) => x.name), ["Nobody Here"]);
  const state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  assert.equal(state.reactions.length, 1);
});

test("demo loads with one call and works offline from the shipped snapshots", async () => {
  const { loadDemo } = await import("../lib/store.ts");
  const { loadNetwork } = await import("../lib/network.ts");
  const owners = loadDemo();
  assert.deepEqual(owners.map((o) => o.name), ["You", "Co-founder", "Board member"]);
  assert.ok(owners.every((o) => o.demo));
  const net = await loadNetwork();
  assert.equal(net.demo, true);
  assert.equal(net.stats.rows, 2660);
  assert.ok(net.stats.contacts > 2200 && net.stats.contacts < 2400, `merged by URL: ${net.stats.contacts}`);
  assert.equal(net.stats.names.pending, 0, "every demo company name is answered by the cache or the snapshot");
  assert.ok(net.stats.fits > 50);
  assert.ok(net.signals && net.signals.signals.length > 1000, "radar snapshot loaded");
  assert.ok(net.contacts.every((c) => c.group), "every contact is in one group");
});

test("PRH matching: generic words are dropped for a second search, which can only give a close match", async () => {
  const { matchCompany, writeCache, hash, coreName } = await import("../lib/prh.ts");
  assert.equal(coreName("RELEX Solutions"), "RELEX");
  assert.equal(coreName("Sisu Axles"), "Sisu Axles");
  writeCache("ytj", hash("RELEX Solutions"), { query: "RELEX Solutions", fetchedAt: "", totalResults: 0, companies: [] });
  writeCache("ytj", hash("RELEX"), { query: "RELEX", fetchedAt: "", totalResults: 1, companies: [co("1963444-1", "RELEX Oy", "62100")] });
  const m = await matchCompany("RELEX Solutions", { offline: true });
  assert.equal(m.status, "inferred");
  assert.equal(m.company?.businessId, "1963444-1");
  const p = await matchCompany("Uncached Name Oy", { offline: true });
  assert.equal(p.status, "pending", "never guesses before PRH has answered");
});

test("a company marked as not a target takes its people off the list", () => {
  const profile = { ...DEMO_PROFILE, excluded: [{ businessId: "0606363-5", name: "Oy Lunawood Ltd" }] };
  const n2 = buildNetwork({ networks: [{ owner: owner("you", "You"), text: YOU }], resolved, state: emptyState, profile, signals, today: "2026-10-24" });
  const laura = n2.contacts.find((c) => c.name === "Laura Mäkelä")!;
  assert.equal(laura.fit, null);
  assert.equal(laura.approach, "skip");
  assert.match(analyse(n2, laura).fitWhy, /not a target/);
});

test("at an equal score an Oyj ranks after the rest; a company marked as not a target leaves the radar", () => {
  // Invented people at invented companies, with the same facts but the company form.
  const rows = csv([
    "Aino,Aalto,https://www.linkedin.com/in/aino-aalto-9f,,Esimerkki Konepaja Oyj,Operations Director,12 Apr 2019",
    "Ville,Wirtanen,https://www.linkedin.com/in/ville-wirtanen-9f,,Testi Konepaja Oy,Operations Director,12 Apr 2019",
  ]);
  const listed = co("3333333-3", "Esimerkki Konepaja Oyj", "28150", { formCode: "17", form: "Public limited company" });
  const r2 = new Map<string, Resolved>([
    ["Esimerkki Konepaja Oyj", res("Esimerkki Konepaja Oyj", "verified", listed)],
    ["Testi Konepaja Oy", res("Testi Konepaja Oy", "verified", co("4444444-4", "Testi Konepaja Oy", "28150"))],
  ]);
  const n3 = buildNetwork({ networks: [{ owner: owner("you", "You"), text: rows }], resolved: r2, state: emptyState, profile: DEMO_PROFILE, signals: null, today: "2026-10-24" });
  const [first, second] = n3.contacts;
  assert.equal(first.score, second.score);
  assert.equal(first.name, "Ville Wirtanen", "by name alone Aino would come first");
  assert.ok(isOyj(second) && !isOyj(first));

  assert.ok(getRadar(net).rows.some((r) => r.businessId === "2417546-2"));
  const n4 = buildNetwork({ networks: [{ owner: owner("you", "You"), text: YOU }], resolved, state: emptyState, profile: { ...DEMO_PROFILE, excluded: [{ businessId: "2417546-2", name: "Hydroline Oy" }] }, signals, today: "2026-10-24" });
  const radar = getRadar(n4);
  assert.ok(!radar.rows.some((r) => r.businessId === "2417546-2"));
  assert.ok(radar.rows.some((r) => r.businessId === "9999999-9"));
});

test("well-known international names are never verified by name alone", async () => {
  const { resolveName } = await import("../lib/matching.ts");
  const { writeCache, hash } = await import("../lib/prh.ts");
  writeCache("ytj", hash("Amazon"), { query: "Amazon", fetchedAt: "", totalResults: 1, companies: [co("1111111-1", "Amazon Oy", "46499")] });
  writeCache("ytj", hash("Stripe"), { query: "Stripe", fetchedAt: "", totalResults: 1, companies: [co("2222222-2", "Stripe Custom Oy", "74991")] });
  const a = await resolveName("Amazon");
  assert.equal(a.status, "inferred");
  assert.equal(a.foreign, true, "an exact match on an international name is abroad too: Amazon Oy in Espoo is not Amazon");
  assert.equal(a.candidates[0].businessId, "1111111-1", "the Finnish company stays a candidate to pick");
  const s = await resolveName("Stripe");
  assert.equal(s.foreign, true, "a close match on an international name is abroad");
});
