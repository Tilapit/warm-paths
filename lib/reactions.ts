// Reactions to the team's LinkedIn posts. Nothing is scraped: a teammate
// opens a post's reactions list on LinkedIn, selects it, copies and pastes
// it here (or drops a screenshot into Claude, which passes the names on).
// Names are matched to the merged network. One match is stored, as
// inferred. Ties are broken by the company in the headline and by the
// degree marker against the post's author; what is still open goes to a
// short review. Names that match no one are returned once and never stored.
import { fold, companyKey, daysBetween } from "./normalize.ts";
import type { Contact, Network } from "./network.ts";
import { shortName } from "./analysis.ts";

export type Degree = "1st" | "2nd" | "3rd";
export type ParsedReaction = { name: string; headline?: string; degree?: Degree };

/** Only reactions to posts from the last 90 days count in the score; "recently" is 30 days. */
export const REACTION_DAYS = 90;
export const RECENT_DAYS = 30;

// ---------- parsing LinkedIn's copied list ----------

const REACTION_WORDS = /^(all|like|likes|celebrate|support|love|insightful|funny|curious|reactions?|comments?|reposts?)(\s*[·:]?\s*\d[\d,. ]*)?$/i;
const BUTTONS = /^(\+\s*)?(connect|follow|following|message|pending|unfollow|view profile|send message|invite|remove|more|close|dismiss|load more|show more results)$/i;
const NOISE = /^(status is \w+|verified|premium|linkedin member|open to work|hiring|author|edited|reacted|[·•∙|]|\d[\d,. ]*|reactions? \(\d+\)|\d[\d,]* reactions?|\(?(she|he|they|hän)\s*\/\s*\w+\)?)$/i;
const DEGREE = /^(?:[·•∙⋅|-]\s*)?(1st|2nd|3rd\+?)(?:\s+degree(?:\s+connection)?)?$/i;
const INLINE_DEGREE = /^(.*?)\s*[·•∙⋅]\s*(1st|2nd|3rd\+?)(?:\s+degree(?:\s+connection)?)?$/i;
const VIEW = /^view\s+(.+?)['’]s?\s+(?:profile|graphic link)$/i;
// "3,731 followers" under a name means the line above it is a company page, not a person.
const FOLLOWERS = /^\d[\d,. ]*\s*[km]?\s+(followers?|seuraajaa|följare)$/i;

/**
 * "Dr. Aino Kallio, CSCP (she/her) 🌱" -> "Aino Kallio". LinkedIn names carry
 * no commas but credentials; what follows " | " or " – " and anything in
 * brackets is a tagline. The same cleaning runs on the network's names, so
 * both sides of a match are read alike.
 */
export function cleanName(s: string): string {
  return s
    .split(",")[0]
    .split(/\s[|–—]\s|\s-\s/)[0]
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, " ")
    .replace(/^(dr|mr|mrs|ms|prof|ing)\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The key two spellings of one name share: folded, letters only. */
export const nameKey = (s: string) => fold(cleanName(s)).replace(/[^a-z]+/g, " ").trim();

function looksLikeName(s: string): boolean {
  const n = cleanName(s);
  if (!n || n.length > 60 || /\d|@|\||:|https?:|\bat\b|\bja\b|\band\b/i.test(n)) return false;
  const words = n.split(" ");
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || /^(van|von|de|der|den|af|da|di|la|le|du|dos|das|del|della|e|y|el|al|bin|ibn|ter|ten|zu|op)$/i.test(w) || /^(al|el|bin|ibn|d)[-'’]\p{Lu}/u.test(w));
}

/** Name-shaped whatever the capitals: used only right before a degree marker or a repeat. */
function looseName(s: string): boolean {
  const n = cleanName(s);
  if (!n || n.length > 60 || /\d|@|\||:|https?:|\b(at|ja|and|och)\b/i.test(n)) return false;
  const w = n.split(" ");
  return w.length >= 2 && w.length <= 6 && w.every((x) => /^[\p{L}'’.-]+$/u.test(x));
}

type Tok = { kind: "name" | "view" | "degree" | "noise" | "text" | "followers"; value: string; degree?: Degree };

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const deg = (d: string) => (d.toLowerCase().startsWith("1") ? "1st" : d.toLowerCase().startsWith("2") ? "2nd" : "3rd") as Degree;
    let m: RegExpMatchArray | null;
    if (FOLLOWERS.test(line)) out.push({ kind: "followers", value: line });
    else if ((m = line.match(VIEW))) out.push({ kind: "view", value: m[1] });
    else if ((m = line.match(DEGREE))) out.push({ kind: "degree", value: line, degree: deg(m[1]) });
    else if (REACTION_WORDS.test(line) || BUTTONS.test(line) || NOISE.test(line)) out.push({ kind: "noise", value: line });
    else if ((m = line.match(INLINE_DEGREE)) && looksLikeName(m[1])) {
      out.push({ kind: "name", value: m[1] });
      out.push({ kind: "degree", value: m[2], degree: deg(m[2]) });
    } else out.push({ kind: looksLikeName(line) ? "name" : "text", value: line });
  }
  return out;
}

/**
 * Reads the text LinkedIn gives when you select and copy a post's reactions
 * list: each person's name (often twice, or with "View … profile"), a degree
 * marker ("· 1st"), a headline, and button text. Also takes a plain list of
 * names, one per line.
 */
export function parseReactions(text: string): ParsedReaction[] {
  return readReactions(text).entries;
}

/** The same, plus the lines that were read as nobody (shown once, so a missed person is visible). */
export function readReactions(text: string): { entries: ParsedReaction[]; unread: string[]; companyPages: string[] } {
  // A company page reacts too: its name, then "N followers". Both lines go; it is counted, never matched.
  const all = tokens(text).filter((x) => x.kind !== "noise");
  const companyPages: string[] = [];
  const t = all.filter((x, i) => {
    if (x.kind === "followers") return false;
    if (all[i + 1]?.kind === "followers") {
      companyPages.push(x.value);
      return false;
    }
    return true;
  });
  const unread: string[] = [];
  const same = (a: string, b: string) => nameKey(a) === nameKey(b);
  const out: ParsedReaction[] = [];
  let cur: ParsedReaction | null = null;
  const push = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  const repeats = t.some((x, i) => x.kind === "name" && (t[i + 1]?.kind === "name" || t[i + 1]?.kind === "view") && same(x.value, t[i + 1].value));
  if (repeats || t.some((x) => x.kind === "degree" || x.kind === "view")) {
    // A name is a name-like line followed by its repeat, its "View … profile" line or a degree marker.
    const isName = (i: number) => {
      const a = t[i];
      if (a.kind === "view") return true;
      const b = t[i + 1];
      const repeat = !!b && b.kind !== "degree" && same(a.value, b.value);
      if (a.kind === "text") return looseName(a.value) && !!b && (b.kind === "degree" || repeat);
      return a.kind === "name" && !!b && (b.kind === "degree" || repeat);
    };
    // While still on a person's name lines, the same name again is a repeat;
    // after their marker or headline it is the next person with that name.
    let inName = false;
    for (let i = 0; i < t.length; i++) {
      const x = t[i];
      const c = cur as ParsedReaction | null;
      if (c && inName && x.kind !== "degree" && same(c.name, x.value)) continue;
      if (isName(i)) {
        push();
        cur = { name: cleanName(x.value) };
        inName = true;
      } else if (x.kind === "degree") {
        if (c && !c.degree) c.degree = x.degree;
        inName = false;
      } else {
        if (c && !c.headline && x.kind !== "view") c.headline = x.value;
        else if (x.kind !== "view") unread.push(x.value);
        inName = false;
      }
    }
  } else {
    // A plain list: every name-like line is a person, other lines are their headline.
    for (const x of t) {
      if (x.kind === "name" || x.kind === "view") {
        if (cur && same((cur as ParsedReaction).name, x.value)) continue;
        push();
        cur = { name: cleanName(x.value) };
      } else if (cur && !(cur as ParsedReaction).headline) (cur as ParsedReaction).headline = x.value;
      else unread.push(x.value);
    }
  }
  push();
  // The same person twice in one paste counts once.
  const seen = new Set<string>();
  const entries = out.filter((r) => {
    const k = `${nameKey(r.name)}|${r.headline ?? ""}`;
    if (!nameKey(r.name) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { entries, unread, companyPages };
}

// ---------- matching ----------

export type Candidate = { id: string; name: string; title: string; company: string; knownBy: string[] };
export type Matched = { entry: ParsedReaction; contactId: string; how: "name" | "name_company" | "name_degree" };
export type Review = { entry: ParsedReaction; candidates: Candidate[] };
/** none: no one of this name in the networks. degree: someone is, but the degree marker says it is someone else. */
export type Unmatched = { entry: ParsedReaction; why: string; kind: "none" | "degree" };
export type MatchResult = { matched: Matched[]; review: Review[]; unmatched: Unmatched[] };

const companyNames = (c: Contact) => [c.company, c.match?.company?.name, c.match?.company ? shortName(c.match.company.name) : undefined].filter((x): x is string => !!x);

/** True when the headline names the contact's company ("COO at Testilogistiikka"). */
export function headlineNames(headline: string | undefined, c: Contact): boolean {
  if (!headline) return false;
  const h = ` ${companyKey(headline)} `;
  return companyNames(c).some((n) => {
    const k = companyKey(n);
    return k.length >= 3 && h.includes(` ${k} `);
  });
}

export const candidateOf = (c: Contact): Candidate => ({ id: c.id, name: c.name, title: c.position, company: c.match?.company && !c.match.foreign ? shortName(c.match.company.name) : c.company, knownBy: c.knownBy.map((k) => k.ownerName) });

/**
 * Name first. LinkedIn's degree marker is relative to whoever copied the list
 * (`viewer`): "1st" keeps only people they know, "2nd"/"3rd" only people they
 * do not, even with a single candidate (a stranger with the same name). With
 * several left, the company in the headline decides; otherwise review.
 */
export function matchReactions(net: Network, entries: ParsedReaction[], opts: { viewer?: string } = {}): MatchResult {
  const index = new Map<string, Contact[]>();
  for (const c of net.contacts) {
    const k = nameKey(c.name);
    if (!k) continue;
    const list = index.get(k);
    if (list) list.push(c);
    else index.set(k, [c]);
  }
  const res: MatchResult = { matched: [], review: [], unmatched: [] };
  for (const entry of entries) {
    let cands = index.get(nameKey(entry.name)) ?? [];
    let how: Matched["how"] = "name";
    if (!cands.length) {
      res.unmatched.push({ entry, why: "Not in the team's networks", kind: "none" });
      continue;
    }
    if (opts.viewer && entry.degree) {
      const knows = (c: Contact) => c.knownBy.some((k) => k.owner === opts.viewer);
      const kept = cands.filter((c) => (entry.degree === "1st" ? knows(c) : !knows(c)));
      if (!kept.length) {
        res.unmatched.push({ entry, why: "Same name as someone in your networks, but the degree marker says it is someone else", kind: "degree" });
        continue;
      }
      if (kept.length < cands.length) how = "name_degree";
      cands = kept;
    }
    if (cands.length > 1 && entry.headline) {
      const byCo = cands.filter((c) => headlineNames(entry.headline, c));
      if (byCo.length === 1) {
        cands = byCo;
        how = "name_company";
      }
    }
    if (cands.length === 1) res.matched.push({ entry, contactId: cands[0].id, how });
    else res.review.push({ entry, candidates: cands.map(candidateOf) });
  }
  return res;
}

/** Distinct posts this person reacted to within `days` of today. */
export function postsWithin(c: Pick<Contact, "reactions">, today: string, days: number): number {
  return new Set(c.reactions.filter((r) => daysBetween(r.postDate ?? r.at.slice(0, 10), today) <= days).map((r) => `${r.post}|${r.postDate ?? ""}`)).size;
}

// ---------- people who reacted but are in no one's network ----------

/**
 * "Head of Operations at Esimerkki Oy", "CTO @ Esimerkki", "CEO | Esimerkki
 * Oy | Investor", "Tuotantojohtaja – Esimerkki Oy": the title and the company
 * as written. No company when the headline does not say one plainly.
 */
export function headlineParts(headline?: string): { title: string; company: string } {
  const h = (headline ?? "").replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!h) return { title: "", company: "" };
  let m = h.match(/^(.+?)\s+(?:at|@|bei|chez|på|i)\s+(.+)$/i) ?? h.match(/^(.+?)\s*@\s*(.+)$/);
  if (!m) m = h.match(/^(.+?)\s+[|–—]\s+(.+)$/) ?? h.match(/^(.+?)\s+-\s+(.+)$/);
  if (!m) return { title: h, company: "" };
  // "Esimerkki Oy | Investor | Speaker": the company is the first part after the title.
  const company = m[2].split(/\s+[|–—•·]\s+|,\s+/)[0].trim();
  return { title: m[1].trim(), company: company.length >= 2 && company.length <= 80 ? company : "" };
}

/** A stable id for someone engaged but not connected: their name and headline, never a URL (we have none). */
export function engagedId(name: string, headline?: string): string {
  let h = 0;
  for (const ch of `${nameKey(name)}|${(headline ?? "").toLowerCase().trim()}`) h = (Math.imul(h, 31) + ch.codePointAt(0)!) | 0;
  return `e-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
