// The team's network as one model: every owner's LinkedIn export merged by
// profile URL (never by name), company names matched in PRH, titles read
// against the target profile, and a deterministic score for ranking.
import crypto from "node:crypto";
import fs from "node:fs";
import { parseConnections } from "./ingest.ts";
import { daysBetween, profileKey, today } from "./normalize.ts";
import { ownerText, readOwners, sourcesSignature, type Owner } from "./store.ts";
import { pruneEngaged, readState, stateSignature, type Reaction, type State, type StatusEntry } from "./state.ts";
import { BY_ID, matchJob, resolveName, startMatching, type Resolved } from "./matching.ts";
import { analyseTitle, isStrongRole, type RoleInfo } from "./roles.ts";
import { groupForTol, isExcluded, keywordIn, requiresEmployer, targetRule, type GroupId, type IndustryRule, type Profile } from "./industry.ts";
import { addDays, loadSignals, signalsFile, SIGNAL_TYPES, type CompanySignal, type SignalSet } from "./signals.ts";
import { looseKey, type MatchStatus, type PrhCompany } from "./prh.ts";
import { effectiveProfile, profileSignature, type ProfileSource } from "./profile.ts";
import { headlineParts, nameKey, postsWithin, REACTION_DAYS } from "./reactions.ts";

export type Fit = "strong" | "possible";
/** direct: a decision-maker who fits. ask_intro: works at a target company, does not decide. */
export type Approach = "direct" | "ask_intro" | "skip";

export type KnownBy = { owner: string; ownerName: string; connectedOn: string; file: string; row: number };

/** A follow-up is due this many days after "sent" with no reply recorded. */
export const FOLLOW_UP_DAYS = 7;
/** A snooze lasts this many days unless the team says otherwise. */
export const SNOOZE_DAYS = 90;
/** For this many days after anyone at a company was contacted, others there rank lower. */
export const COOLDOWN_DAYS = 30;

/**
 * What the team's status means for recommendations today, the same for the
 * whole team and every list (This week, find_people, people_for_theme).
 * - sent: hidden; a follow-up is due 7 days later if no reply is recorded.
 * - replied, meeting, not_fit: hidden for good.
 * - snoozed: hidden until the snooze ends.
 * - cooldown: someone else at the company was contacted in the last 30 days.
 */
export type Outreach = {
  hidden: boolean;
  followUpOn?: string;
  followUpDue?: boolean;
  until?: string;
  cooldown?: { on: string; id: string; name: string };
};
export type ScorePart = { label: string; points: number; why: string };

export type Contact = {
  id: string;
  name: string;
  url: string;
  company: string;
  position: string;
  /** Every teammate who has this person in their export, earliest first. */
  knownBy: KnownBy[];
  /** Suggested sender: the teammate who connected first. */
  sender: KnownBy;
  match: Resolved | null;
  companyId: string | null;
  group: GroupId;
  rule: IndustryRule | null;
  role: RoleInfo;
  fit: Fit | null;
  /** What keeps a fit at Possible at most: "company match not confirmed", "early-stage, likely small". */
  caps: string[];
  /** At a target company that is not in the Employer Register (no regular employees): never a fit while the filter is on. */
  tooSmall: boolean;
  approach: Approach;
  /** Other people the team knows at the same company. */
  colleagues: number;
  signals: CompanySignal[];
  reactions: Reaction[];
  status?: StatusEntry;
  outreach: Outreach;
  score: number;
  parts: ScorePart[];
};

export type CompanyEntry = {
  /** Business ID when matched in PRH, otherwise "x-" and a hash of the name. */
  id: string;
  businessId?: string;
  name: string;
  rawNames: string[];
  status: MatchStatus;
  prh?: PrhCompany;
  group: GroupId;
  rule: IndustryRule | null;
  contactIds: string[];
  signals: CompanySignal[];
};

/**
 * Reacted to a team post, in no one's network. Only the pasted name and
 * headline; the company comes from the headline and is matched in PRH like
 * any other, with the same fit rules. The action is a connection request
 * from whoever wrote the post.
 */
export type EngagedPerson = {
  id: string;
  name: string;
  headline: string;
  degree?: "1st" | "2nd" | "3rd";
  posts: { post: string; postDate: string; author?: string; authorName?: string }[];
  title: string;
  /** The company as the headline says it, and its PRH match. */
  companyRaw: string;
  company: string;
  match: Resolved | null;
  group: GroupId;
  rule: IndustryRule | null;
  role: RoleInfo;
  fit: Fit | null;
  caps: string[];
  tooSmall: boolean;
  /** Whose post: the teammate who sends the connection request. */
  sender?: string;
  senderName?: string;
  status?: StatusEntry;
  hidden: boolean;
};

export type Network = {
  owners: Owner[];
  demo: boolean;
  profile: Profile;
  /** Where the profile came from: the user's file, the demo's, or none yet. */
  profileSource?: ProfileSource;
  today: string;
  contacts: Contact[];
  byId: Map<string, Contact>;
  companies: Map<string, CompanyEntry>;
  names: Map<string, Resolved>;
  signals: SignalSet | null;
  signalsByCompany: Map<string, CompanySignal[]>;
  /** Reacted to a team post, not in any network: ranked by fit. */
  engaged: EngagedPerson[];
  stats: NetworkStats;
};

export type NetworkStats = {
  rows: number;
  contacts: number;
  knownByTwo: number;
  noCompany: number;
  names: Record<MatchStatus | "foreign", number>;
  companies: { matched: number; total: number };
  decisionMakers: number;
  inProfile: number;
  fits: number;
  strong: number;
};

const hash = (s: string, n = 10) => crypto.createHash("sha1").update(s).digest("hex").slice(0, n);
const MATCHED = (s?: MatchStatus) => s === "verified" || s === "inferred";

// ---------- score ----------

/** Points per fact. The score orders the list; it is a heuristic, not a probability. */
export const WEIGHTS = {
  strong: 40,
  possible: 20,
  verified: 10,
  level: { exec: 15, director: 10, board: 6, manager: 4, other: 0 },
  signalPerWeight: 4,
  signalExtraType: 2,
  team: 8,
  colleague: 3,
  colleagueMax: 9,
  recent: 3,
  /** Reacted to a teammate's post in the last 90 days: 5 for one post, +2 per further post, at most 9. */
  reacted: 5,
  reactedExtra: 2,
  reactedMax: 9,
};

/** Signal points for a company: 4 x the weight of its strongest signal, +2 per extra type. */
export function signalPoints(signals: CompanySignal[]): { points: number; why: string } {
  if (!signals.length) return { points: 0, why: "" };
  const types = [...new Set(signals.map((s) => s.type))].sort((a, b) => SIGNAL_TYPES[b].weight - SIGNAL_TYPES[a].weight);
  const points = SIGNAL_TYPES[types[0]].weight * WEIGHTS.signalPerWeight + (types.length - 1) * WEIGHTS.signalExtraType;
  return { points, why: types.map((t) => SIGNAL_TYPES[t].label).join(", ") };
}

export function scoreContact(c: Pick<Contact, "fit" | "match" | "role" | "knownBy" | "colleagues" | "signals" | "reactions">, now: string): ScorePart[] {
  const parts: ScorePart[] = [];
  if (c.fit) parts.push({ label: "Fit", points: c.fit === "strong" ? WEIGHTS.strong : WEIGHTS.possible, why: c.fit === "strong" ? "Strong fit" : "Possible fit" });
  if (c.match?.status === "verified") parts.push({ label: "Company match", points: WEIGHTS.verified, why: "Company verified in PRH" });
  const lv = WEIGHTS.level[c.role.level];
  if (c.role.decisionMaker && lv) parts.push({ label: "Role", points: lv, why: `${c.role.level} level title` });
  const sig = signalPoints(c.signals);
  if (sig.points) parts.push({ label: "Signal", points: sig.points, why: sig.why });
  if (c.knownBy.length > 1) parts.push({ label: "Team", points: WEIGHTS.team, why: `Known by ${c.knownBy.length} teammates` });
  if (c.colleagues) parts.push({ label: "Network", points: Math.min(WEIGHTS.colleagueMax, c.colleagues * WEIGHTS.colleague), why: `${c.colleagues} other connection${c.colleagues > 1 ? "s" : ""} at the company` });
  const latest = c.knownBy.map((k) => k.connectedOn).filter(Boolean).sort().at(-1);
  if (latest && daysBetween(latest, now) <= 365) parts.push({ label: "Recent", points: WEIGHTS.recent, why: "Connected in the last year" });
  const posts = postsWithin(c, now, REACTION_DAYS);
  if (posts) parts.push({ label: "Reacted", points: Math.min(WEIGHTS.reactedMax, WEIGHTS.reacted + (posts - 1) * WEIGHTS.reactedExtra), why: `Reacted to ${posts} of the team's posts in the last ${REACTION_DAYS} days` });
  return parts;
}

/** A fit with a cap (see fitCaps) is Possible at most; so is an organisation found only by a keyword outside PRH. */
export function fitFor(role: RoleInfo, rule: IndustryRule | null, caps: string[] = [], roles: string[] = []): Fit | null {
  if (!role.decisionMaker || !rule) return null;
  return !caps.length && !rule.lowerPriority && rule.code !== "keyword-abroad" && isStrongRole(role, roles) ? "strong" : "possible";
}

/** An organisation not in PRH is a target only by a keyword in its name, and never Strong. */
export function keywordRule(profile: Profile, name: string): IndustryRule | null {
  if (!name || isExcluded(profile, undefined, [name])) return null;
  const kw = keywordIn([name], profile);
  return kw ? { code: "keyword-abroad", label: `"${kw}" in the name (not in PRH)` } : null;
}

/** Registered less than this many days ago: early-stage, likely small. */
export const EARLY_STAGE_DAYS = 730;
/** PRH company forms whose people are never counted as decision-makers: non-profit association (ry), foundations. */
export const NON_PROFIT_FORMS = new Set(["6", "18", "39"]);

/** In the Employer Register (PRH/YTJ): true, false, or undefined when the cache predates the field. */
export function employerOf(match: Resolved | null): boolean | undefined {
  return match?.company && !match.foreign ? match.company.registers?.employer : undefined;
}

/**
 * What keeps someone at a matched company from being a Strong fit, from PRH
 * facts only. "no employees registered" counts only when the Employer
 * Register filter is off; with it on, those people are not a fit at all.
 */
export function fitCaps(match: Resolved | null, now: string): string[] {
  if (!match?.company || match.foreign) return [];
  const caps: string[] = [];
  if (match.status === "inferred") caps.push("company match not confirmed");
  if (employerOf(match) === false) caps.push("no employees registered");
  const reg = match.company.registrationDate;
  if (reg && daysBetween(reg, now) < EARLY_STAGE_DAYS) caps.push("early-stage, likely small");
  return caps;
}

/** ask_intro only for a title that can realistically introduce (`RoleInfo.intro`). */
export function approachFor(fit: Fit | null, rule: IndustryRule | null, role?: Pick<RoleInfo, "intro">): Approach {
  return fit ? "direct" : rule && (!role || role.intro > 0) ? "ask_intro" : "skip";
}

// ---------- build (pure) ----------

export type BuildInput = {
  networks: { owner: Owner; text: string }[];
  resolved: Map<string, Resolved>;
  state: State;
  profile: Profile;
  signals: SignalSet | null;
  today: string;
};

type Draft = { key: string; name: string; url: string; company: string; position: string; knownBy: KnownBy[]; importedAt: string };

/** Merges owners' rows by profile URL. Rows without a URL stay separate. */
export function mergeNetworks(networks: { owner: Owner; text: string }[]): { drafts: Draft[]; rows: number } {
  const byKey = new Map<string, Draft>();
  let rows = 0;
  for (const { owner, text } of networks) {
    const { records } = parseConnections(text, owner.original);
    rows += records.length;
    for (const r of records) {
      const pk = profileKey(r.url);
      const key = pk || `nourl:${owner.id}:${r.row}`;
      const kb: KnownBy = { owner: owner.id, ownerName: owner.name, connectedOn: r.connectedOn, file: owner.original, row: r.row };
      const d = byKey.get(key);
      if (!d) {
        byKey.set(key, { key, name: `${r.first} ${r.last}`.trim(), url: r.url, company: r.company, position: r.position, knownBy: [kb], importedAt: owner.importedAt });
        continue;
      }
      if (!d.knownBy.some((k) => k.owner === owner.id)) d.knownBy.push(kb);
      // The newest export has the current title.
      if (owner.importedAt > d.importedAt && (r.company || r.position)) Object.assign(d, { company: r.company, position: r.position, importedAt: owner.importedAt });
    }
  }
  for (const d of byKey.values()) d.knownBy.sort((a, b) => (a.connectedOn || "9").localeCompare(b.connectedOn || "9"));
  return { drafts: [...byKey.values()], rows };
}

export function indexSignals(set: SignalSet | null): Map<string, CompanySignal[]> {
  const m = new Map<string, CompanySignal[]>();
  for (const s of set?.signals ?? []) {
    const list = m.get(s.businessId);
    if (list) list.push(s);
    else m.set(s.businessId, [s]);
  }
  return m;
}

export function buildNetwork(input: BuildInput, signalsByCompany = indexSignals(input.signals)): Network {
  const { profile, state } = input;
  const { drafts, rows } = mergeNetworks(input.networks);
  const companies = new Map<string, CompanyEntry>();
  const contacts: Contact[] = drafts.map((d) => {
    const id = hash(d.key);
    const match = d.company ? input.resolved.get(d.company) ?? null : null;
    let companyId: string | null = null;
    let group: GroupId = "not_matched";
    let rule: IndustryRule | null = null;
    if (match && MATCHED(match.status) && match.company && !match.foreign) {
      companyId = match.company.businessId;
      group = groupForTol(match.company.tol);
      const names = [match.company.name, d.company];
      rule = isExcluded(profile, match.company.businessId, names) ? null : targetRule(profile, match.company.tol, names);
    } else if (match && match.status !== "skipped") {
      companyId = `x-${hash(match.key || d.company.toLowerCase(), 8)}`;
      if (match.foreign) group = "abroad";
      // Not in PRH (abroad, or no single match): a target only by a keyword in its name.
      rule = keywordRule(profile, d.company);
    }
    if (companyId) {
      let co = companies.get(companyId);
      if (!co) {
        const matched = !!match && MATCHED(match.status) && !!match.company && !match.foreign;
        co = {
          id: companyId,
          businessId: matched ? match!.company!.businessId : undefined,
          name: matched ? match!.company!.name : d.company,
          rawNames: [],
          status: match!.status,
          prh: matched ? match!.company : undefined,
          group,
          rule,
          contactIds: [],
          signals: matched ? signalsByCompany.get(companyId) ?? [] : [],
        };
        companies.set(companyId, co);
      }
      if (!co.rawNames.includes(d.company)) co.rawNames.push(d.company);
      if (match!.status === "verified") co.status = "verified";
      co.contactIds.push(id);
    }
    let role = analyseTitle(d.position, profile.roles);
    // An association or a foundation: nobody there decides for it as a business would.
    if (match?.company && !match.foreign && NON_PROFIT_FORMS.has(match.company.formCode ?? "")) role = { ...role, decisionMaker: false, decides: "", notDecider: "an association or foundation in PRH", intro: 0 };
    const caps = rule ? fitCaps(match, input.today) : [];
    // Not in the Employer Register: no regular employees, so nobody to sell to and no one to introduce.
    const tooSmall = !!rule && requiresEmployer(profile) && employerOf(match) === false;
    const fit = tooSmall ? null : fitFor(role, rule, caps, profile.roles);
    return {
      id,
      name: d.name,
      url: d.url,
      company: d.company,
      position: d.position,
      knownBy: d.knownBy,
      sender: d.knownBy[0],
      match,
      companyId,
      group,
      rule,
      role,
      fit,
      caps,
      tooSmall,
      approach: tooSmall ? "skip" : approachFor(fit, rule, role),
      colleagues: 0,
      signals: companyId ? companies.get(companyId)!.signals : [],
      reactions: state.reactions.filter((r) => r.contactId === id),
      status: state.status[id],
      outreach: { hidden: false },
      score: 0,
      parts: [],
    };
  });
  for (const c of contacts) {
    if (c.companyId) c.colleagues = companies.get(c.companyId)!.contactIds.length - 1;
    c.parts = scoreContact(c, input.today);
    c.score = c.parts.reduce((n, p) => n + p.points, 0);
  }
  applyOutreach(contacts, input.today);
  contacts.sort(rankOrder);
  const names: Record<MatchStatus | "foreign", number> = { verified: 0, inferred: 0, ambiguous: 0, none: 0, skipped: 0, pending: 0, foreign: 0 };
  for (const r of input.resolved.values()) {
    names[r.status]++;
    if (r.foreign) names.foreign++;
  }
  const fits = contacts.filter((c) => c.fit);
  const engaged = buildEngaged(input, contacts);
  return {
    owners: input.networks.map((n) => n.owner),
    demo: input.networks.length > 0 && input.networks.every((n) => n.owner.demo),
    profile,
    today: input.today,
    contacts,
    byId: new Map(contacts.map((c) => [c.id, c])),
    companies,
    names: input.resolved,
    signals: input.signals,
    signalsByCompany,
    engaged,
    stats: {
      rows,
      contacts: contacts.length,
      knownByTwo: contacts.filter((c) => c.knownBy.length > 1).length,
      noCompany: contacts.filter((c) => !c.company).length,
      names,
      companies: { matched: [...companies.values()].filter((c) => c.businessId).length, total: companies.size },
      decisionMakers: contacts.filter((c) => c.role.decisionMaker).length,
      inProfile: contacts.filter((c) => c.rule).length,
      fits: fits.length,
      strong: fits.filter((c) => c.fit === "strong").length,
    },
  };
}

/** Engaged people from the state, one per person, with their company matched and the fit rules applied. */
export function buildEngaged(input: BuildInput, contacts: Contact[]): EngagedPerson[] {
  const { profile, state } = input;
  const owners = new Map(input.networks.map((n) => [n.owner.id, n.owner.name]));
  const known = new Set(contacts.map((c) => nameKey(c.name)));
  const byId = new Map<string, EngagedPerson>();
  for (const e of state.engaged ?? []) {
    // Imported since: they are a contact now, and the reaction belongs there.
    if (known.has(nameKey(e.name))) continue;
    const post = { post: e.post, postDate: e.postDate, author: e.author, authorName: e.author ? owners.get(e.author) : undefined };
    const have = byId.get(e.id);
    if (have) {
      have.posts.push(post);
      continue;
    }
    const { title, company: companyRaw } = headlineParts(e.headline);
    const match = companyRaw ? input.resolved.get(companyRaw) ?? null : null;
    const matched = !!match && (match.status === "verified" || match.status === "inferred") && !!match.company && !match.foreign;
    const names = matched ? [match!.company!.name, companyRaw] : [companyRaw];
    const excluded = isExcluded(profile, matched ? match!.company!.businessId : undefined, names);
    const rule = excluded ? null : matched ? targetRule(profile, match!.company!.tol, names) : companyRaw ? keywordRule(profile, companyRaw) : null;
    let role = analyseTitle(title, profile.roles);
    if (matched && NON_PROFIT_FORMS.has(match!.company!.formCode ?? "")) role = { ...role, decisionMaker: false, decides: "", notDecider: "an association or foundation in PRH", intro: 0 };
    const caps = rule ? fitCaps(match, input.today) : [];
    const tooSmall = !!rule && requiresEmployer(profile) && employerOf(match) === false;
    const fit = tooSmall ? null : fitFor(role, rule, caps, profile.roles);
    const status = state.status[e.id];
    const s = status?.status;
    byId.set(e.id, {
      id: e.id,
      name: e.name,
      headline: e.headline ?? "",
      degree: e.degree,
      posts: [post],
      title,
      companyRaw,
      company: matched ? match!.company!.name : companyRaw,
      match,
      group: matched ? groupForTol(match!.company!.tol) : "not_matched",
      rule,
      role,
      fit,
      caps,
      tooSmall,
      sender: e.author,
      senderName: post.authorName,
      status,
      hidden: s === "sent" || s === "replied" || s === "meeting" || s === "not_fit" || (s === "snoozed" && input.today < (status?.until ?? addDays(status!.at.slice(0, 10), SNOOZE_DAYS))),
    });
  }
  const rank = (x: EngagedPerson) => (x.fit === "strong" ? 0 : x.fit === "possible" ? 1 : x.role.decisionMaker ? 2 : 3);
  const latest = (x: EngagedPerson) => x.posts.map((p) => p.postDate).sort().at(-1) ?? "";
  return [...byId.values()].sort((a, b) => rank(a) - rank(b) || Number(a.degree === "3rd") - Number(b.degree === "3rd") || latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name, "fi"));
}

/** The last day anyone reached this person (sent, replied or meeting), or "". */
export function contactedOn(status?: StatusEntry): string {
  if (!status) return "";
  const days = [status, ...status.history].filter((h) => h.status === "sent" || h.status === "replied" || h.status === "meeting").map((h) => h.at.slice(0, 10));
  return days.sort().at(-1) ?? "";
}

/** Fills in each contact's `outreach` from the team's statuses, as of `today`. */
export function applyOutreach(contacts: Contact[], today: string) {
  // Who at each company was reached in the last 30 days, latest first.
  const reached = new Map<string, { on: string; id: string; name: string }[]>();
  for (const c of contacts) {
    const on = contactedOn(c.status);
    if (!on || !c.companyId || daysBetween(on, today) > COOLDOWN_DAYS) continue;
    reached.set(c.companyId, [...(reached.get(c.companyId) ?? []), { on, id: c.id, name: c.name }].sort((a, b) => b.on.localeCompare(a.on)));
  }
  for (const c of contacts) {
    const cooldown = c.companyId ? reached.get(c.companyId)?.find((r) => r.id !== c.id) : undefined;
    const s = c.status?.status ?? "none";
    const day = c.status?.at.slice(0, 10) ?? today;
    const o: Outreach = { hidden: false, ...(cooldown ? { cooldown } : {}) };
    if (s === "sent") {
      o.hidden = true;
      o.followUpOn = addDays(day, FOLLOW_UP_DAYS);
      o.followUpDue = today >= o.followUpOn;
    } else if (s === "replied" || s === "meeting" || s === "not_fit") o.hidden = true;
    else if (s === "snoozed") {
      o.until = c.status?.until ?? addDays(day, SNOOZE_DAYS);
      o.hidden = today < o.until;
    }
    c.outreach = o;
  }
}

/** At a public limited company (Oyj) in PRH: usually a large listed group, ranked after the rest at an equal score. */
export function isOyj(c: Pick<Contact, "match">): boolean {
  return !!c.match && MATCHED(c.match.status) && !c.match.foreign && c.match.company?.formCode === "17";
}

/**
 * Strong before possible, "Not a fit" last; within those, people whose
 * colleague was just contacted after the rest; then score; at an equal score
 * an Oyj after the rest; then name.
 */
export function rankOrder(a: Contact, b: Contact): number {
  const f = (c: Contact) => (c.status?.status === "not_fit" ? 3 : c.fit === "strong" ? 0 : c.fit === "possible" ? 1 : 2);
  const cool = (c: Contact) => (c.outreach.cooldown ? 1 : 0);
  return f(a) - f(b) || cool(a) - cool(b) || b.score - a.score || Number(isOyj(a)) - Number(isOyj(b)) || a.name.localeCompare(b.name, "fi");
}

// ---------- load (cached) ----------

type Memo = { sig: string; net: Network };
const G = globalThis as unknown as { __vnNetwork?: Memo; __vnSignalIndex?: { set: SignalSet | null; map: Map<string, CompanySignal[]> } };

function signalsSig(): string {
  try {
    return String(fs.statSync(signalsFile()).mtimeMs);
  } catch {
    return "-";
  }
}

/** The current model. Reads only local files and the PRH cache; never waits for PRH. */
export async function loadNetwork(): Promise<Network> {
  // Engaged people go after 90 days unless the team set a status on them.
  pruneEngaged(today());
  const sig = [sourcesSignature(), stateSignature(), profileSignature(), signalsSig(), matchJob().generation, process.env.APP_TODAY ?? ""].join("#");
  if (G.__vnNetwork?.sig === sig) return G.__vnNetwork.net;
  const owners = readOwners();
  const networks = owners.flatMap((owner) => {
    try {
      return [{ owner, text: ownerText(owner) }];
    } catch {
      return [];
    }
  });
  const state = readState();
  const demo = owners.length > 0 && owners.every((o) => o.demo);
  const { profile, source: profileSource } = effectiveProfile(demo);
  const raws = new Set<string>();
  for (const n of networks) for (const r of parseConnections(n.text).records) if (r.company) raws.add(r.company);
  // The companies engaged people name in their headline are looked up like any other.
  for (const e of state.engaged ?? []) {
    const c = headlineParts(e.headline).company;
    if (c) raws.add(c);
  }
  const resolved = new Map<string, Resolved>();
  await Promise.all([...raws].map(async (raw) => resolved.set(raw, await resolveName(raw, state.overrides[looseKey(raw)], { demo }))));
  const signals = loadSignals();
  if (G.__vnSignalIndex?.set !== signals) G.__vnSignalIndex = { set: signals, map: indexSignals(signals) };
  const net = buildNetwork({ networks, resolved, state, profile, signals, today: today() }, G.__vnSignalIndex.map);
  net.profileSource = profileSource;
  G.__vnNetwork = { sig, net };
  return net;
}

/**
 * Starts the background PRH lookup for names not in the cache yet, names with
 * decision-makers first. Only company names are sent to PRH.
 */
export function ensureMatching(net: Network) {
  if (process.env.PRH_OFFLINE === "1") return matchJob();
  // Snapshot answers (demo only) are refreshed from PRH too when it is reachable.
  // Then names whose cached answer predates the register fields; a company picked by hand by its business ID.
  const names = [...net.names.values()];
  const pending = names.filter((r) => r.status === "pending" || r.snapshot).map((r) => r.raw);
  const stale = names.filter((r) => r.stale && !r.snapshot).map((r) => (r.by === "you" && r.company ? `${BY_ID}${r.company.businessId}` : r.raw));
  if (!pending.length && !stale.length) return matchJob();
  const weight = new Map<string, number>();
  for (const c of net.contacts) if (c.company) weight.set(c.company, (weight.get(c.company) ?? 0) + (c.role.decisionMaker ? 10 : 1));
  const byWeight = (a: string, b: string) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0);
  return startMatching([...pending.sort(byWeight), ...[...new Set(stale)].sort(byWeight)]);
}

export function contactsFor(net: Network, owner?: string): Contact[] {
  return owner ? net.contacts.filter((c) => c.knownBy.some((k) => k.owner === owner)) : net.contacts;
}
