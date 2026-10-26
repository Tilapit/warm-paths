// Writes data/demo/reactions/: two posts' worth of reactions, as the text
// LinkedIn gives when you select and copy a post's reactions list. The people
// are invented: most come from the mock networks, a few are in none of them,
// and a few share a name with someone else in the networks.
//
// Seeded and deterministic. Usage: node scripts/make-demo-reactions.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = path.join(process.cwd(), "data", "demo", "reactions");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vn-react-"));
process.env.PRH_OFFLINE = "1";
process.env.APP_TODAY = "2026-10-24";
const { loadDemo } = await import("../lib/store.ts");
const { loadNetwork } = await import("../lib/network.ts");
const { nameKey } = await import("../lib/reactions.ts");

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261014);
const pick = (a) => a[Math.floor(rnd() * a.length)];

loadDemo();
const net = await loadNetwork();
const byName = new Map();
for (const c of net.contacts) byName.set(nameKey(c.name), [...(byName.get(nameKey(c.name)) ?? []), c]);
const unique = (c) => byName.get(nameKey(c.name)).length === 1;
const knows = (c, o) => c.knownBy.some((k) => k.owner === o);
const used = new Set();
function take(list, n) {
  const out = [];
  const pool = list.filter((c) => !used.has(c.id));
  while (out.length < n && pool.length) {
    const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    used.add(c.id);
    out.push(c);
  }
  return out;
}
const company = (c) => c.company || "";
function headline(c, mode = Math.floor(rnd() * 10)) {
  const t = c.position || "";
  if (!t) return company(c) ? `Working at ${company(c)}` : "";
  if (!company(c) || mode === 9) return t;
  return mode < 5 ? `${t} at ${company(c)}` : `${t} | ${company(c)}`;
}

// People in none of the networks (invented), with headlines naming made-up companies.
const OUTSIDERS = [
  ["Kerttu Vainikainen", "Operations Manager at Esimerkkivalimo Oy"],
  ["Tapio Rönkkö", "Plant Manager | Malliteräs Oy"],
  ["Linnea Ek", "Supply Chain Developer at Testihuolinta Ab"],
  ["Oskari Peltomaa", "Tuotantopäällikkö, Kuvitteellinen Konepaja Oy"],
  ["Sanni Heiskari", "Helping manufacturers turn data into decisions"],
];
for (const [n] of OUTSIDERS) if (byName.has(nameKey(n))) throw new Error(`${n} is in the networks; pick another invented name`);

const dupes = [...byName.values()].filter((l) => l.length > 1 && l.every((c) => c.company)).sort((a, b) => nameKey(a[0].name).localeCompare(nameKey(b[0].name)));
const fitsOf = (o) => net.contacts.filter((c) => c.fit && unique(c) && knows(c, o));
const othersOf = (o) => net.contacts.filter((c) => !c.fit && unique(c) && knows(c, o) && c.position && c.company);

function block(name, head, degree, variant) {
  const lines = [name];
  if (variant < 0.65) lines.push(name);
  else lines.push(`View ${name}’s profile`);
  if (degree === "1st") lines.push(variant < 0.4 ? "· 1st" : variant < 0.8 ? "• 1st" : "1st degree connection");
  else if (degree === "2nd") lines.push("· 2nd", "2nd degree connection");
  else lines.push("· 3rd+");
  if (head) lines.push(head);
  if (degree !== "1st") lines.push(pick(["Connect", "Follow", "+ Follow"]));
  else if (variant > 0.85) lines.push("Message");
  return lines.join("\n");
}

function post({ file, label, date, author, fits, others, otherOwners, outsiders, dupeTie, dupeOpen, also = [] }) {
  const people = [
    ...also.map((c) => [c, "1st"]),
    ...take(fitsOf(author), fits).map((c) => [c, "1st"]),
    ...take(othersOf(author), others).map((c) => [c, "1st"]),
    ...take(net.contacts.filter((c) => unique(c) && !knows(c, author) && c.position && c.company), otherOwners).map((c) => [c, "2nd"]),
  ];
  const blocks = people.map(([c, d]) => {
    let name = c.name;
    const v = rnd();
    // A few display names carry credentials, pronouns or an emoji, as on LinkedIn.
    if (v < 0.06) name = `${name}, CSCP`;
    else if (v < 0.1) name = `${name} (they/them)`;
    else if (v < 0.13) name = `${name} 🌱`;
    return block(name, headline(c), d, rnd());
  });
  for (const [n, h] of outsiders) blocks.push(block(n, h, rnd() < 0.5 ? "2nd" : "3rd", rnd()));
  // Same name as someone else in the networks: one with the company in the headline (the tie breaks), one without (goes to review).
  for (const [c] of dupeTie.map((l) => [l[0]])) blocks.push(block(c.name, `${c.position || "Manager"} at ${company(c)}`, knows(c, author) ? "1st" : "2nd", rnd()));
  for (const l of dupeOpen) blocks.push(block(l[0].name, "Passionate about people and growth", "2nd", rnd()));
  // LinkedIn lists reactions roughly newest first; shuffle deterministically.
  for (let i = blocks.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  }
  const n = blocks.length;
  const like = Math.round(n * 0.7);
  const cele = Math.round(n * 0.18);
  const head = ["Reactions", "All", String(n), "Like", String(like), "Celebrate", String(cele), "Insightful", String(n - like - cele)].join("\n");
  fs.writeFileSync(path.join(OUT, file), head + "\n\n" + blocks.join("\n\n") + "\n");
  return { file, label, date, author, people: n, inNetworks: people.length + dupeTie.length };
}

fs.mkdirSync(OUT, { recursive: true });
const p1 = post({ file: "post-1.txt", label: "Three lessons from a production planning pilot", date: "2026-10-14", author: "you", fits: 9, others: 10, otherOwners: 4, outsiders: OUTSIDERS.slice(0, 3), dupeTie: dupes.slice(0, 1), dupeOpen: dupes.slice(1, 2) });
// Some of the same people react again, so two posts count more than one.
const again = net.contacts.filter((c) => used.has(c.id) && c.fit && knows(c, "cofounder")).slice(0, 3);
const p2 = post({ file: "post-2.txt", label: "What we learned building a planning tool in a weekend", date: "2026-10-21", author: "cofounder", fits: 5, others: 7, otherOwners: 3, outsiders: OUTSIDERS.slice(3), dupeTie: dupes.slice(2, 3), dupeOpen: [], also: again });
fs.writeFileSync(path.join(OUT, "posts.json"), JSON.stringify([p1, p2].map(({ file, label, date, author }) => ({ file, label, date, author })), null, 2) + "\n");
console.log(p1, p2);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
