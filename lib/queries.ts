// Read and write operations shared by the web app and the MCP server. All
// ranking and filtering is here, in code; an LLM only picks the arguments.
import { analyse, fmtDate, shortName, type Analysis } from "./analysis.ts";
import { GROUP, GROUPS, groupForTol, isExcluded, requiresEmployer, targetRule, type GroupId } from "./industry.ts";
import { matchTerm } from "./roles.ts";
import { SIGNAL_TYPES, addDays, signalLabel, type CompanySignal, type SignalType } from "./signals.ts";
import { addEngaged, addReactionRows, setStatus, type Engaged, STATUS_LABEL, type Reaction, type Status } from "./state.ts";
import { daysBetween, fold, isoDate } from "./normalize.ts";
import { candidateOf, cleanName, engagedId, headlineParts, matchReactions, nameKey, postsWithin, readReactions, RECENT_DAYS, type ParsedReaction } from "./reactions.ts";
import { COOLDOWN_DAYS, contactsFor, isOyj, loadNetwork, SNOOZE_DAYS, type Contact, type Fit, type Network } from "./network.ts";
import { ytjUrl } from "./prh.ts";
import { templateMessage, voiceFor, MESSAGE_RULES, type MessageType } from "./voice.ts";

export const appUrl = (p: string) => `${(process.env.APP_BASE_URL || "http://localhost:3100").replace(/\/$/, "")}${p}`;

/** Resolves an owner given by id or name ("You", "co-founder"). */
export function ownerId(net: Network, owner?: string): string | undefined {
  if (!owner) return undefined;
  const o = fold(owner).toLowerCase().trim();
  return net.owners.find((x) => x.id === o || fold(x.name).toLowerCase() === o)?.id ?? "__none__";
}

/** Accepts group ids ("metal") or labels ("Metal and machinery", "logistics"). */
export function groupIds(list?: string[]): GroupId[] | undefined {
  if (!list?.length) return undefined;
  const out = new Set<GroupId>();
  for (const x of list) {
    const k = fold(x).toLowerCase().trim();
    for (const g of GROUPS) if (g.id === k || fold(g.label).toLowerCase().includes(k) || k.includes(g.id)) out.add(g.id);
  }
  return [...out];
}

export type PersonSummary = {
  id: string;
  name: string;
  title: string;
  company: string;
  businessId?: string;
  group: string;
  fit: Fit | null;
  approach: string;
  score: number;
  reasons: string[];
  knownBy: string[];
  suggestedSender: string;
  signals: string[];
  status: string;
  /** Sent, waiting for a reply: when a follow-up is due. */
  followUp?: string;
  snoozedUntil?: string;
  /** "Colleague contacted 20 Oct (Arttu Lehto)": others at the company rank lower for 30 days. */
  cooldown?: string;
  url: string;
  linkedin: string;
};

export function summary(net: Network, c: Contact): PersonSummary {
  const a = analyse(net, c);
  return {
    id: c.id,
    name: c.name,
    title: c.position,
    company: a.company.name,
    businessId: a.company.businessId,
    group: GROUP[c.group].label,
    fit: c.fit,
    approach: c.approach,
    score: c.score,
    reasons: a.reasons.map((r) => `${r.text} [${r.source}, ${r.provenance}]`),
    knownBy: c.knownBy.map((k) => `${k.ownerName} (${fmtDate(k.connectedOn)})`),
    suggestedSender: c.sender.ownerName,
    signals: [...new Set(c.signals.map((s) => SIGNAL_TYPES[s.type].label))],
    status: STATUS_LABEL[c.status?.status ?? "none"],
    ...(c.outreach.followUpOn ? { followUp: `${c.outreach.followUpDue ? "Due since" : "Due on"} ${fmtDate(c.outreach.followUpOn)}` } : {}),
    ...(c.outreach.until && c.outreach.hidden ? { snoozedUntil: c.outreach.until } : {}),
    ...(c.outreach.cooldown ? { cooldown: cooldownText(c) } : {}),
    url: appUrl(`/people/${c.id}`),
    linkedin: c.url,
  };
}

/** "Colleague contacted 20 Oct (Arttu Lehto)". */
export function cooldownText(c: Contact): string {
  const cd = c.outreach.cooldown;
  return cd ? `Colleague contacted ${dayMonth(cd.on)} (${cd.name})` : "";
}

// ---------- industries ----------

export type IndustryRow = {
  group: GroupId;
  label: string;
  contacts: number;
  decisionMakers: number;
  strong: number;
  possible: number;
  knownByTwo: number;
  companiesWithSignal: number;
  score: number;
  top: PersonSummary[];
};

/** Score per industry: 3 per strong fit, 1 per possible, 2 per fit known by two teammates, 2 per company with a signal. */
export function rankIndustries(net: Network, opts: { owner?: string } = {}): IndustryRow[] {
  const contacts = contactsFor(net, ownerId(net, opts.owner));
  const rows = GROUPS.filter((g) => !g.grey).map((g) => {
    const cs = contacts.filter((c) => c.group === g.id);
    const fits = cs.filter((c) => c.fit && c.status?.status !== "not_fit");
    const companiesWithSignal = new Set(cs.filter((c) => c.signals.length && c.rule).map((c) => c.companyId)).size;
    const strong = fits.filter((c) => c.fit === "strong").length;
    const possible = fits.length - strong;
    const knownByTwo = fits.filter((c) => c.knownBy.length > 1).length;
    return {
      group: g.id,
      label: g.label,
      contacts: cs.length,
      decisionMakers: cs.filter((c) => c.role.decisionMaker).length,
      strong,
      possible,
      knownByTwo,
      companiesWithSignal,
      score: strong * 3 + possible + knownByTwo * 2 + companiesWithSignal * 2,
      top: fits.slice(0, 3).map((c) => summary(net, c)),
    };
  });
  return rows.sort((a, b) => b.score - a.score || b.contacts - a.contacts);
}

// ---------- people ----------

export type PeopleFilter = {
  industries?: string[];
  tol_prefixes?: string[];
  roles?: string[];
  fit?: "strong" | "possible" | "any";
  known_by?: string;
  has_signal?: boolean;
  /** Reacted to a teammate's post in the last 30 days. */
  reacted?: boolean;
  town?: string;
  approach?: string;
  status?: Status;
  /** Also people the team already contacted, snoozed or marked not a fit (for lookups). */
  include_contacted?: boolean;
  limit?: number;
};

export function findPeople(net: Network, f: PeopleFilter = {}): { total: number; people: PersonSummary[] } {
  const groups = groupIds(f.industries);
  const town = f.town ? fold(f.town).toLowerCase() : "";
  let cs = contactsFor(net, ownerId(net, f.known_by));
  cs = cs.filter((c) => {
    // The one rule for recommendations: contacted, snoozed and not-a-fit people stay out unless asked for.
    if (c.outreach.hidden && !f.include_contacted && !f.status) return false;
    if (f.fit === "strong" && c.fit !== "strong") return false;
    if (f.fit === "possible" && c.fit !== "possible") return false;
    if ((!f.fit || f.fit === "any") && !c.fit && !f.roles?.length && !f.approach) return false;
    if (groups && !groups.includes(c.group)) return false;
    if (f.tol_prefixes?.length && !f.tol_prefixes.some((p) => c.match?.company?.tol?.startsWith(p.replace(/\D/g, "")))) return false;
    if (f.roles?.length && !f.roles.some((r) => matchTerm(c.position, r))) return false;
    if (f.has_signal && !c.signals.length) return false;
    if (f.reacted && !postsWithin(c, net.today, RECENT_DAYS)) return false;
    if (town && !fold(c.match?.company?.town ?? "").toLowerCase().includes(town)) return false;
    if (f.approach && c.approach !== f.approach) return false;
    if (f.status && (c.status?.status ?? "none") !== f.status) return false;
    return true;
  });
  return { total: cs.length, people: cs.slice(0, Math.min(f.limit ?? 20, 100)).map((c) => summary(net, c)) };
}

export type ThemePerson = PersonSummary & { themeApproach: "invite" | "ask_intro" | "skip"; why: string };

/** The LLM maps a theme to industries; this only filters and orders. */
export function peopleForTheme(net: Network, args: { theme: string; industries: string[]; roles?: string[]; limit?: number }): { theme: string; industries: string[]; total: number; people: ThemePerson[] } {
  const groups = groupIds(args.industries) ?? [];
  const cs = net.contacts.filter((c) => groups.includes(c.group) && !c.outreach.hidden && (!args.roles?.length || c.role.decisionMaker || args.roles.some((r) => matchTerm(c.position, r))));
  const people = cs
    .map((c) => {
      const inRoles = args.roles?.length ? args.roles.some((r) => matchTerm(c.position, r)) : c.role.decisionMaker;
      const themeApproach: ThemePerson["themeApproach"] = c.rule && inRoles && c.role.decisionMaker ? "invite" : c.rule ? "ask_intro" : "skip";
      const why = themeApproach === "invite" ? `Decision-maker at ${c.match?.company ? shortName(c.match.company.name) : c.company}` : themeApproach === "ask_intro" ? "Works at a target company; can point you to who decides" : "Outside your target industries";
      return { ...summary(net, c), themeApproach, why };
    })
    .filter((p) => p.themeApproach !== "skip")
    .sort((a, b) => (a.themeApproach === b.themeApproach ? Number(!!a.cooldown) - Number(!!b.cooldown) || b.score - a.score : a.themeApproach === "invite" ? -1 : 1));
  return { theme: args.theme, industries: groups.map((g) => GROUP[g].label), total: people.length, people: people.slice(0, Math.min(args.limit ?? 20, 100)) };
}

// ---------- this week ----------

export type WeekPick = PersonSummary & { kind: "signal" | "reaction" | "fit"; why: string; sender: string; prompt: string };

const SHORT_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MON[Number(iso.slice(5, 7)) - 1]}`;

/** The prompt "Write in Claude" copies: the user's own Claude, with the connector, writes the message. */
export function claudePrompt(c: Pick<Contact, "name" | "id" | "approach">): string {
  return `Using Warm Paths, write a LinkedIn message to ${c.name} (${c.id}), approach ${c.approach === "ask_intro" ? "ask_intro" : "direct"}.`;
}

/** A registered change as words: "a new managing director", "a demerger". */
function changeText(s: CompanySignal): string {
  if (s.type === "md_change") return "a new managing director";
  if (s.type === "board_change") return "a board change";
  if (s.type === "new_money") return "a share issue or capital increase";
  return `a ${signalLabel(s).toLowerCase()}`;
}

/** One sentence on why this person, this week: what changed at which company and when, a reaction, or the fit alone. */
export function weekWhy(net: Network, c: Contact): { kind: WeekPick["kind"]; why: string } {
  const company = c.match?.company && !c.match.foreign ? shortName(c.match.company.name) : c.company;
  const title = c.position.length > 60 ? `${c.position.slice(0, 59).trim()}…` : c.position;
  const role = title ? `${title.charAt(0).toUpperCase()}${title.slice(1)}` : "Decision-maker";
  const sig = c.signals.filter((s) => daysBetween(s.date, net.today) <= 30).sort((a, b) => SIGNAL_TYPES[b.type].weight - SIGNAL_TYPES[a.type].weight || b.date.localeCompare(a.date))[0];
  if (sig) return { kind: "signal", why: `${company} registered ${changeText(sig)} on ${dayMonth(sig.date)} (PRH).` };
  const r = c.reactions.filter((x) => daysBetween(x.postDate ?? x.at.slice(0, 10), net.today) <= RECENT_DAYS).sort((a, b) => (b.postDate ?? b.at).localeCompare(a.postDate ?? a.at))[0];
  if (r) {
    const author = r.author ? net.owners.find((o) => o.id === r.author)?.name : undefined;
    return { kind: "reaction", why: `Reacted to ${!author || author === "You" ? "your" : `${author}'s`} post on ${dayMonth(r.postDate ?? r.at.slice(0, 10))}. ${role} at ${company}.` };
  }
  return { kind: "fit", why: fitReason(c, role, company) };
}

/** "Alice and Bob", "Alice, Bob and Carol". */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The strongest reason from code alone, when nothing is fresh: role, the
 * industry, the size signal PRH has (Employer Register since when, early
 * stage, a listed company; never a headcount), and who knows them.
 * "CEO at Silta: software and IT, employer since 2015. Known by Mikael and Friend."
 */
export function fitReason(c: Contact, role: string, company: string): string {
  const prh = c.match?.company && !c.match.foreign ? c.match.company : undefined;
  const reg = prh?.registers;
  const size =
    prh?.formCode === "17"
      ? "listed (Oyj)"
      : c.caps.includes("early-stage, likely small")
        ? "early-stage"
        : reg?.employer
          ? `employer since ${reg.employerSince?.slice(0, 4) ?? "registered"}`
          : "";
  const what = [c.group === "other" || c.group === "not_matched" || c.group === "abroad" ? prh?.industry?.toLowerCase() : GROUP[c.group].label.toLowerCase(), size].filter(Boolean).join(", ");
  const names = c.knownBy.map((k) => (k.ownerName === "You" ? "you" : k.ownerName));
  const known = names.length > 1 ? `Known by ${andList(names)}.` : `Known by ${names[0]}${c.colleagues ? `, with ${c.colleagues} more you know there` : ""}.`;
  const head = `${role} at ${company}${what ? `: ${what}` : ""}.`;
  // Long industry names make the line too long; the role, company and who knows them stay.
  return `${head.length > 95 ? `${role} at ${company}.` : head} ${known}`;
}

/** At most this many of This week for each suggested sender: five spread over the team, at least one each. */
export function weekPerSender(owners: number, n = 5): number {
  return Math.max(1, Math.ceil(n / Math.max(1, owners)));
}

/**
 * Five people for this week, chosen by code. Strong fits always come before
 * possible fits: a possible fit appears only when fewer than five strong ones
 * are left. Within each, people with a registered change or a reaction in the
 * last 30 days first, and anyone whose colleague was contacted in the last 30
 * days last. Contacted, snoozed and not-a-fit people are out (`outreach`). One
 * per company; while it works, at most two per industry. For the whole team,
 * at most weekPerSender() for each suggested sender, always: the list is
 * shorter rather than break that. With an owner, only that teammate's
 * network, senders spread while it works.
 */
export function thisWeek(net: Network, n = 5, owner?: string): WeekPick[] {
  const fresh = (c: Contact) => c.signals.some((s) => daysBetween(s.date, net.today) <= 30);
  const reacted = (c: Contact) => postsWithin(c, net.today, RECENT_DAYS) > 0;
  const timely = (c: Contact) => fresh(c) || reacted(c);
  const cool = (c: Contact) => !!c.outreach.cooldown;
  const week = (c: Contact) => c.score + (fresh(c) ? 12 : 0) + (reacted(c) ? 10 : 0) + (c.fit === "strong" ? 10 : 0);
  // At an equal score, an Oyj (usually a large group) after the rest.
  const order = (a: Contact, b: Contact) => Number(a.fit !== "strong") - Number(b.fit !== "strong") || Number(cool(a)) - Number(cool(b)) || week(b) - week(a) || Number(isOyj(a)) - Number(isOyj(b)) || a.name.localeCompare(b.name, "fi");
  const pool = contactsFor(net, ownerId(net, owner))
    .filter((c) => c.fit && !c.outreach.hidden)
    .sort(order);
  const perSender = weekPerSender(net.owners.length, n);
  // The whole team's list keeps its promise of at most perSender for each
  // sender, even if that leaves it short. A teammate's own list only spreads
  // senders while it can.
  const capped = !owner && net.owners.length > 1;
  const picks: Contact[] = [];
  const take = (from: Contact[], pred: (c: Contact) => boolean, strict: boolean) => {
    const c = from.find((x) => {
      if (picks.includes(x) || !pred(x)) return false;
      if (x.companyId && picks.some((p) => p.companyId === x.companyId)) return false;
      const senderFull = picks.filter((p) => p.sender.owner === x.sender.owner).length >= perSender;
      if (capped && senderFull) return false;
      if (!strict) return true;
      return picks.filter((p) => p.group === x.group).length < 2 && !senderFull;
    });
    if (c) picks.push(c);
    return !!c;
  };
  for (const fit of ["strong", "possible"] as const) {
    const tier = pool.filter((c) => c.fit === fit);
    // One slot each for a fresh change and a reaction, then the rest of the
    // timely ones, then the others; anyone whose colleague was just contacted
    // last. A reason to write now comes before the spread.
    if (fit === "strong") {
      take(tier, (c) => fresh(c) && !cool(c), true);
      take(tier, (c) => reacted(c) && !cool(c), true);
    }
    for (const pred of [(c: Contact) => timely(c) && !cool(c), (c: Contact) => !cool(c), () => true]) {
      while (picks.length < n && take(tier, pred, true));
      while (picks.length < n && take(tier, pred, false));
    }
  }
  return picks.sort(order).map((c) => ({ ...summary(net, c), ...weekWhy(net, c), sender: c.sender.ownerName, prompt: claudePrompt(c) }));
}

export type IntroPick = PersonSummary & { why: string; sender: string; prompt: string };

/**
 * People at companies in your industries who are not decision-makers: they
 * can introduce you to who decides: a working role (specialist, manager,
 * lead, sales, consultant, engineer), never front-line, temporary or student
 * staff. A second, smaller group under This week, chosen by code: companies
 * where the team knows no decision-maker who fits first (an intro is the only
 * way in), then seniority, then a fresh registered change, then the score. One per company; contacted and snoozed people are out.
 */
export function canIntroduce(net: Network, n = 3, owner?: string): { total: number; people: IntroPick[] } {
  const pool = contactsFor(net, ownerId(net, owner)).filter((c) => c.approach === "ask_intro" && !c.outreach.hidden);
  const hasFit = new Set(net.contacts.filter((c) => c.fit && c.companyId).map((c) => c.companyId));
  const fresh = (c: Contact) => c.signals.some((s) => daysBetween(s.date, net.today) <= 30);
  const order = (a: Contact, b: Contact) =>
    Number(hasFit.has(a.companyId)) - Number(hasFit.has(b.companyId)) ||
    b.role.intro - a.role.intro || Number(!!a.rule?.lowerPriority) - Number(!!b.rule?.lowerPriority) || Number(!!a.outreach.cooldown) - Number(!!b.outreach.cooldown) || Number(fresh(b)) - Number(fresh(a)) || b.score - a.score || Number(isOyj(a)) - Number(isOyj(b)) || a.name.localeCompare(b.name, "fi");
  const picks: Contact[] = [];
  for (const c of [...pool].sort(order)) {
    if (picks.length >= n) break;
    if (c.companyId && picks.some((p) => p.companyId === c.companyId)) continue;
    picks.push(c);
  }
  return {
    total: pool.length,
    people: picks.map((c) => {
      const company = c.match?.company && !c.match.foreign ? shortName(c.match.company.name) : c.company;
      const title = c.position ? `${c.position.charAt(0).toUpperCase()}${c.position.slice(1, 60)}` : "No title";
      const why = `${title} at ${company}. ${hasFit.has(c.companyId) ? "Can introduce you to who decides." : "No decision-maker who fits is known there: ask who decides."}`;
      return { ...summary(net, c), why, sender: c.sender.ownerName, prompt: claudePrompt(c) };
    }),
  };
}

export type EngagedPick = { id: string; name: string; title: string; company: string; fit: Fit | null; degree?: string; post: string; postDate: string; why: string; action: "Send a connection request"; sender?: string };

/**
 * Reacted to a team post but in no one's network, ranked by fit (the same
 * rules as everyone else). The action is always a connection request from
 * whoever wrote the post, never a message. With an owner, only their posts.
 */
export function engagedNotConnected(net: Network, n = 5, owner?: string): { total: number; people: EngagedPick[] } {
  const id = ownerId(net, owner);
  const pool = net.engaged.filter((e) => !e.hidden && !e.tooSmall && (!id || e.sender === id));
  return {
    total: pool.length,
    people: pool.slice(0, n).map((e) => {
      const p = [...e.posts].sort((a, b) => b.postDate.localeCompare(a.postDate))[0];
      const where = e.company ? ` at ${shortName(e.company)}` : "";
      const what = e.fit ? `${e.fit === "strong" ? "Strong" : "Possible"} fit` : e.role.decisionMaker ? "Decision-maker, not in your industries" : "Not a decision-maker title";
      return {
        id: e.id,
        name: e.name,
        title: e.title,
        company: e.company ? shortName(e.company) : "",
        fit: e.fit,
        ...(e.degree ? { degree: e.degree } : {}),
        post: p.post,
        postDate: p.postDate,
        why: `Reacted to ${p.authorName ? (p.authorName === "You" ? "your" : `${p.authorName}'s`) : "a team"} post on ${dayMonth(p.postDate)}. ${e.title || "No title"}${where}. ${what}.`,
        action: "Send a connection request" as const,
        ...(e.senderName ? { sender: e.senderName } : {}),
      };
    }),
  };
}

export type FunnelStep = { label: string; count: number; href: string; rest?: { count: number; label: string; href: string } };

const isFound = (c: Contact) => !!c.match?.company && !c.match.foreign && (c.match.status === "verified" || c.match.status === "inferred");

/** Which /people?step= list each funnel step links to. */
export const FUNNEL_STEPS = ["all", "found", "unmatched", "industries", "other", "employer", "small", "fits", "nodm", "intro"] as const;
export type FunnelList = (typeof FUNNEL_STEPS)[number];

/** The people behind one funnel step, in rank order. */
export function funnelPeople(net: Network, step: FunnelList, owner?: string): Contact[] {
  const all = contactsFor(net, ownerId(net, owner));
  if (step === "all") return all;
  if (step === "found") return all.filter(isFound);
  if (step === "unmatched") return all.filter((c) => !isFound(c));
  if (step === "industries") return all.filter((c) => isFound(c) && c.rule);
  if (step === "other") return all.filter((c) => isFound(c) && !c.rule);
  if (step === "employer") return all.filter((c) => isFound(c) && c.rule && !c.tooSmall);
  if (step === "small") return all.filter((c) => c.tooSmall);
  if (step === "fits") return all.filter((c) => c.fit);
  if (step === "nodm") return all.filter((c) => isFound(c) && c.rule && !c.tooSmall && !c.fit);
  return all.filter((c) => c.approach === "ask_intro");
}

/**
 * People → company found in PRH → in your industries → with employees
 * registered (while that filter is on) → decision-makers who fit, with what
 * drops out at each step. Counts are people, from code.
 */
export function funnel(net: Network, owner?: string): FunnelStep[] {
  const n = (s: FunnelList) => funnelPeople(net, s, owner).length;
  const notTarget = funnelPeople(net, "other", owner).filter((c) => isExcluded(net.profile, c.match!.company!.businessId, [c.match!.company!.name, c.company])).length;
  const fmt = (x: number) => x.toLocaleString("en-US");
  const id = ownerId(net, owner);
  const q = (href: string) => (id ? `${href}${href.includes("?") ? "&" : "?"}owner=${encodeURIComponent(id)}` : href);
  const steps: FunnelStep[] = [
    { label: "people", count: n("all"), href: "/people?step=all" },
    { label: "company found in PRH", count: n("found"), href: "/people?step=found", rest: { count: n("unmatched"), label: `${fmt(n("unmatched"))} not found: no company, no single match or abroad`, href: "/people?step=unmatched" } },
    { label: "a target in your profile", count: n("industries"), href: "/people?step=industries", rest: { count: n("other"), label: `${fmt(n("other"))} elsewhere${notTarget ? ` or not a target (${fmt(notTarget)})` : ""}`, href: "/people?step=other" } },
    // Only while the Employer Register filter is on (Settings → Profile).
    ...(requiresEmployer(net.profile) ? [{ label: "with employees registered", count: n("employer"), href: "/people?step=employer", rest: { count: n("small"), label: `${fmt(n("small"))} too small: no employees registered`, href: "/people?step=small" } }] : []),
    { label: "decision-makers who fit", count: n("fits"), href: "/people?step=fits", rest: { count: n("nodm"), label: `${fmt(n("nodm"))} not decision-makers, ${fmt(n("intro"))} of them can introduce`, href: "/people?step=intro" } },
  ];
  return steps.map((f) => ({ ...f, href: q(f.href), ...(f.rest ? { rest: { ...f.rest, href: q(f.rest.href) } } : {}) }));
}

// ---------- status: what the team did ----------

export type FollowUp = PersonSummary & { sentOn: string; sentBy: string; followUpOn: string; daysSinceSent: number };

/**
 * People marked sent at least 7 days ago with no reply recorded, oldest
 * first. A nudge for whoever sent, not a new recommendation. With an owner,
 * only what that teammate sent.
 */
export function followUps(net: Network, owner?: string): { today: string; total: number; people: FollowUp[]; note: string } {
  const id = ownerId(net, owner);
  const name = id ? net.owners.find((o) => o.id === id)?.name ?? "__none__" : undefined;
  const people = net.contacts
    .filter((c) => c.outreach.followUpDue && (!name || c.status?.by === name))
    .sort((a, b) => a.status!.at.localeCompare(b.status!.at))
    .map((c) => {
      const sentOn = c.status!.at.slice(0, 10);
      return { ...summary(net, c), sentOn, sentBy: c.status!.by, followUpOn: c.outreach.followUpOn!, daysSinceSent: daysBetween(sentOn, net.today) };
    });
  return {
    today: net.today,
    total: people.length,
    people,
    note: "Marked sent at least 7 days ago with no reply recorded. Follow up, or record how it went: replied, meeting, not_fit or snoozed.",
  };
}

/** What a status means for recommendations, in one sentence. */
export function statusMeaning(c: Contact): string {
  const s = c.status?.status ?? "none";
  const o = c.outreach;
  if (s === "sent") return o.followUpDue ? `Won't be recommended while waiting for a reply; a follow-up has been due since ${fmtDate(o.followUpOn!)}.` : `Won't be recommended while waiting for a reply; follow-up due on ${fmtDate(o.followUpOn!)} if no reply is recorded.`;
  if (s === "replied" || s === "meeting" || s === "not_fit") return "Won't be recommended again.";
  if (s === "snoozed") return o.hidden ? `Hidden from recommendations until ${fmtDate(o.until!)}.` : `The snooze ended on ${fmtDate(o.until!)}; back in recommendations.`;
  if (s === "to_contact") return "Marked to contact; stays in recommendations.";
  return "No status: in recommendations as usual.";
}

export const STATUS_IDS = ["none", "to_contact", "sent", "replied", "meeting", "not_fit", "snoozed"] as const satisfies readonly Status[];

/**
 * Records what the team did with a person, as the app's status buttons do,
 * with the time and the teammate (default: the suggested sender). Snoozes
 * last 90 days unless `snooze_days` says otherwise. Nothing is sent.
 */
export async function recordStatus(net: Network, a: { person_id: string; status: Status; owner?: string; note?: string; snooze_days?: number }) {
  const c = net.byId.get(a.person_id);
  if (!c) return { error: `No person with id ${a.person_id}.` };
  const id = a.owner ? ownerId(net, a.owner) : c.sender.owner;
  const by = net.owners.find((o) => o.id === id)?.name;
  if (!by) return { error: `No teammate called "${a.owner}". Teammates: ${net.owners.map((o) => o.name).join(", ")}.` };
  const until = a.status === "snoozed" ? addDays(net.today, Math.round(a.snooze_days ?? SNOOZE_DAYS)) : undefined;
  const note = a.note?.trim().slice(0, 500) || undefined;
  setStatus(c.id, a.status, by, { note, until });
  const after = (await loadNetwork()).byId.get(c.id) ?? c;
  const company = summary(net, c).company;
  const colleagues = a.status === "sent" || a.status === "replied" || a.status === "meeting" ? c.colleagues : 0;
  return {
    person: { id: c.id, name: c.name, company, url: appUrl(`/people/${c.id}`) },
    status: a.status,
    label: STATUS_LABEL[a.status],
    by,
    at: after.status?.at ?? new Date().toISOString(),
    ...(note ? { note } : {}),
    ...(until ? { until } : {}),
    ...(after.outreach.followUpOn ? { followUpOn: after.outreach.followUpOn } : {}),
    means: statusMeaning(after) + (colleagues ? ` The ${colleagues} other${colleagues > 1 ? "s" : ""} the team knows at ${company} rank lower for ${COOLDOWN_DAYS} days.` : ""),
  };
}

export function getPerson(net: Network, id: string): (Analysis & { appUrl: string }) | null {
  const c = net.byId.get(id);
  return c ? { ...analyse(net, c), appUrl: appUrl(`/people/${c.id}`) } : null;
}

// ---------- companies ----------

export function findCompany(net: Network, q: { business_id?: string; name?: string }) {
  if (q.business_id) return net.companies.get(q.business_id.trim()) ?? null;
  if (q.name) {
    const k = fold(q.name).toLowerCase().trim();
    const all = [...net.companies.values()];
    return all.find((c) => fold(c.name).toLowerCase() === k || c.rawNames.some((r) => fold(r).toLowerCase() === k)) ?? all.find((c) => fold(c.name).toLowerCase().includes(k)) ?? null;
  }
  return null;
}

export function getCompany(net: Network, q: { business_id?: string; name?: string }) {
  const co = findCompany(net, q);
  if (!co) return null;
  const people = co.contactIds.map((id) => net.byId.get(id)!).sort((a, b) => b.score - a.score);
  return {
    id: co.id,
    name: co.name,
    businessId: co.businessId,
    namesInNetwork: co.rawNames,
    matchStatus: co.status,
    prh: co.prh ? { form: co.prh.form, formCode: co.prh.formCode, tol: co.prh.tol, industry: co.prh.industry, town: co.prh.town, registered: co.prh.registrationDate, website: co.prh.website, registers: co.prh.registers ?? null, source: ytjUrl(co.prh.businessId) } : null,
    group: GROUP[co.group].label,
    inProfile: !!co.rule,
    headcount: "Missing: not in PRH open data",
    signals: co.signals.map((s) => ({ type: SIGNAL_TYPES[s.type].label, date: s.date, notice: s.recordNumber, source: ytjUrl(s.businessId) })),
    people: people.map((c) => summary(net, c)),
    url: appUrl(`/companies/${co.id}`),
  };
}

// ---------- radar ----------

export type RadarRow = {
  businessId: string;
  company: string;
  group: GroupId;
  groupLabel: string;
  tol?: string;
  industry?: string;
  town?: string;
  signals: { type: SignalType; label: string; date: string; recordNumber: string }[];
  latest: string;
  score: number;
  /** "decision-maker": fits, talk directly. "can introduce": a role that can introduce (see introRank). Neither: no label. */
  known: { id: string; name: string; title: string; fit: Fit | null; role?: "decision-maker" | "can introduce"; knownBy: string[]; url: string }[];
  source: string;
  url: string;
};

/** Weight of each signal type, x1 within 30 days, x0.75 within 60, x0.5 older. One count per type. */
export function radarScore(signals: { type: SignalType; date: string }[], now: string): number {
  const best = new Map<SignalType, number>();
  for (const s of signals) {
    const age = (Date.parse(now) - Date.parse(s.date)) / 86_400_000;
    const f = age <= 30 ? 1 : age <= 60 ? 0.75 : 0.5;
    best.set(s.type, Math.max(best.get(s.type) ?? 0, SIGNAL_TYPES[s.type].weight * f));
  }
  return Math.round([...best.values()].reduce((a, b) => a + b, 0) * 100) / 100;
}

export type RadarFilter = { types?: SignalType[]; industries?: string[]; days?: number; known?: "known" | "unknown"; limit?: number; owner?: string };

export function getRadar(net: Network, f: RadarFilter = {}): { window: { start: string; end: string; fetchedAt: string } | null; total: number; warm: number; rows: RadarRow[] } {
  if (!net.signals) return { window: null, total: 0, warm: 0, rows: [] };
  const groups = groupIds(f.industries);
  const since = f.days ? addDays(net.today, -f.days) : net.signals.start;
  const owner = ownerId(net, f.owner);
  const sizeRule = requiresEmployer(net.profile);
  // Companies the team marked as not a target stay off the radar too.
  const byCo = new Map<string, CompanySignal[]>();
  for (const s of net.signals.signals) {
    if (s.date < since) continue;
    if (f.types?.length && !f.types.includes(s.type)) continue;
    if (!targetRule(net.profile, s.tol, [s.company]) || isExcluded(net.profile, s.businessId, [s.company])) continue;
    // The same size rule as the list: no employees registered, not a lead.
    if (sizeRule && (s.employer ?? net.companies.get(s.businessId)?.prh?.registers?.employer) === false) continue;
    const list = byCo.get(s.businessId);
    if (list) list.push(s);
    else byCo.set(s.businessId, [s]);
  }
  let rows: RadarRow[] = [];
  for (const [businessId, sigs] of byCo) {
    const first = sigs[0];
    const lower = targetRule(net.profile, first.tol, [first.company])?.lowerPriority;
    const group = groupForTol(first.tol);
    if (groups && !groups.includes(group)) continue;
    const co = net.companies.get(businessId);
    const known = (co?.contactIds ?? [])
      .map((id) => net.byId.get(id)!)
      .filter((c) => !owner || c.knownBy.some((k) => k.owner === owner))
      // Decision-makers first, then who can introduce by seniority, then the rest.
      .sort((a, b) => Number(!a.fit) - Number(!b.fit) || Number(b.approach === "ask_intro") - Number(a.approach === "ask_intro") || b.role.intro - a.role.intro || b.score - a.score)
      .map((c) => ({ id: c.id, name: c.name, title: c.position, fit: c.fit, ...(c.fit ? { role: "decision-maker" as const } : c.approach === "ask_intro" ? { role: "can introduce" as const } : {}), knownBy: c.knownBy.map((k) => k.ownerName), url: appUrl(`/people/${c.id}`) }));
    const uniq = new Map<string, CompanySignal>();
    for (const s of sigs) if (!uniq.has(`${s.type}|${s.recordNumber}`)) uniq.set(`${s.type}|${s.recordNumber}`, s);
    const list = [...uniq.values()].sort((a, b) => b.date.localeCompare(a.date));
    rows.push({
      businessId,
      company: first.company,
      group,
      groupLabel: GROUP[group].label,
      tol: first.tol,
      industry: first.industry,
      town: first.town,
      signals: list.map((s) => ({ type: s.type, label: SIGNAL_TYPES[s.type].label, date: s.date, recordNumber: s.recordNumber })),
      latest: list[0].date,
      // Lower-priority industries count half.
      score: radarScore(list, net.today) * (lower ? 0.5 : 1),
      known,
      source: ytjUrl(businessId),
      url: appUrl(`/companies/${businessId}`),
    });
  }
  if (f.known === "known") rows = rows.filter((r) => r.known.length);
  if (f.known === "unknown") rows = rows.filter((r) => !r.known.length);
  // At an equal score, an Oyj (usually a large group) after the rest.
  const oyj = (r: RadarRow) => Number((net.companies.get(r.businessId)?.prh?.formCode ?? (/\boyj\b/i.test(r.company) ? "17" : "")) === "17");
  rows.sort((a, b) => (b.known.length ? 1 : 0) - (a.known.length ? 1 : 0) || b.score - a.score || oyj(a) - oyj(b) || b.latest.localeCompare(a.latest));
  return {
    window: { start: since, end: net.signals.end, fetchedAt: net.signals.fetchedAt },
    total: rows.length,
    warm: rows.filter((r) => r.known.length).length,
    rows: rows.slice(0, Math.min(f.limit ?? 50, 500)),
  };
}

// ---------- messages ----------

// Made-up people and companies on purpose: facts come from `facts`, never from an example.
const EXAMPLES: Record<MessageType, string[]> = {
  direct: ["Hi Maria! How are things at Example Labs? Would you have time for a 20-minute call in the next couple of weeks? – Alex"],
  ask_intro: ["Hi Tom! How are things at Sample Freight? Who would be the right person there to talk to about planning? I'd be grateful for an intro. – Alex"],
  reaction_followup: ["Hi Anna! Thanks for reacting to my post on hiring analysts. Would you have time for a short call next week? – Alex"],
  follow_up: ["Hi Laura! Coming back to my earlier message. Would you have time for a short call at some point? Have a good week! – Alex"],
  event_invite: ["Hi Matti! How are things at Test Logistics? I'm getting a few people together for breakfast in November to talk about route planning. Would you like to join? – Alex"],
};

/** An automatic post label ("Mikael's post, 22 Oct 2026") says nothing about the topic. */
const autoLabel = (p: string) => /^(your|a|.+'s) post, \d/i.test(p);

/** The type that fits this person now: a follow-up when one is due, a reaction to thank for, an intro, or direct. */
export function messageTypeFor(net: Network, c: Contact): MessageType {
  if (c.outreach.followUpDue) return "follow_up";
  if (postsWithin(c, net.today, RECENT_DAYS)) return "reaction_followup";
  return c.approach === "ask_intro" ? "ask_intro" : "direct";
}

export function messageContext(net: Network, args: { person_id: string; type?: MessageType; theme?: string }) {
  const c = net.byId.get(args.person_id);
  if (!c) return null;
  const a = analyse(net, c);
  const type = args.type ?? messageTypeFor(net, c);
  const firstName = c.name.split(" ")[0];
  const company = a.company.businessId || a.company.raw ? a.company.name : "";
  const reaction = [...c.reactions].sort((x, y) => (y.postDate ?? y.at).localeCompare(x.postDate ?? x.at))[0];
  const ownPost = !!reaction && reaction.author === c.sender.owner;
  const postTopic = reaction && !autoLabel(reaction.post) ? reaction.post : undefined;
  // What the message may use. Registered changes, scores and sources are left
  // out on purpose: they decided who and when, and never appear in the text.
  const facts = [
    `First name: ${firstName}`,
    c.position ? `Title: ${c.position}` : null,
    company ? `Company: ${company}${a.company.industry ? ` (${a.company.industry.toLowerCase()})` : ""}` : null,
    type === "reaction_followup" && reaction ? `They reacted to ${ownPost ? "the sender's own" : "the team's"} LinkedIn post${postTopic ? ` about "${postTopic}"` : ""}${reaction.postDate ? ` on ${fmtDate(reaction.postDate)}` : ""}. This may be mentioned.` : null,
    type === "follow_up" && c.status ? `The sender wrote to them on ${fmtDate(c.status.at.slice(0, 10))}; no reply yet.` : null,
    `Sender: ${c.sender.ownerName}.`,
    args.theme ? `Theme or event: ${args.theme}` : null,
    net.profile.goal ? `What the sender is looking for (their goal, in their words): ${net.profile.goal}` : null,
  ].filter(Boolean) as string[];
  return {
    person: { id: c.id, name: c.name, url: appUrl(`/people/${c.id}`) },
    type,
    sender: c.sender.ownerName,
    facts,
    mustNotUse: ["Where any fact came from (trade register, PRH, notices, LinkedIn data)", "Registered changes: new managing director, board, share issue, capital, merger", "Scores, fit, 'our analysis'", "Headcount and revenue (unknown)"],
    rules: MESSAGE_RULES,
    voice: voiceFor(net.profile),
    examples: EXAMPLES[type],
    // The app's own draft, used when no API key is set.
    template: templateMessage({ type, firstName, company, ask: net.profile.ask, signature: net.profile.signature, postTopic, ownPost, theme: args.theme }),
    note: "Write the message from these facts, following `rules`, in the user's tone with their ask and signature (`voice`). Under 500 characters. The server never calls an LLM and never sends anything.",
  };
}

// ---------- reactions ----------

export type ReactionInput = {
  post: string;
  /** YYYY-MM-DD, the day the post went out. Default today. */
  postDate?: string;
  /** Owner id or name of whose post it was. */
  author?: string;
  /** Whose LinkedIn the list was copied from: the "1st"/"2nd" markers are relative to them. Default: the author. */
  copiedBy?: string;
  /** The reactions list as copied from LinkedIn. */
  text?: string;
  /** People read from a screenshot. */
  entries?: ParsedReaction[];
  names?: string[];
  /** Names a teammate resolved in the review: the person they confirmed. */
  picks?: { name: string; person_id: string }[];
  /** false: match only, store nothing. */
  save?: boolean;
};

/**
 * Parses and matches reactions to one of the team's posts, and stores the
 * matches (as inferred) and the picks. Names in review are stored only once
 * someone picks; names with no match are returned once and never stored.
 */
/** More than this share of names ruled out by the degree marker alone: "Copied from" is probably wrong. */
export const COPIED_BY_WARN = 0.2;

export function addReactions(net: Network, input: ReactionInput) {
  const own = (x?: string) => {
    const id = x ? ownerId(net, x) : undefined;
    return id && id !== "__none__" ? id : undefined;
  };
  const authorId = own(input.author);
  const viewer = own(input.copiedBy) ?? authorId;
  const seen = new Set<string>();
  const read = input.text ? readReactions(input.text) : { entries: [], unread: [], companyPages: [] };
  const all: ParsedReaction[] = [...(input.entries ?? []), ...read.entries, ...(input.names ?? []).map((n) => ({ name: cleanName(n) }))];
  const entries = all.filter((e) => {
    const k = `${nameKey(e.name)}|${e.headline ?? ""}`;
    if (!nameKey(e.name) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const res = matchReactions(net, entries, { viewer });
  // Rejected only by the degree marker: when that is more than a fifth of the
  // names, "Copied from" is probably wrong. Suggest the teammate whose
  // network the markers fit best.
  const offByDegree = res.unmatched.filter((u) => u.kind === "degree");
  const name = (id?: string) => net.owners.find((o) => o.id === id)?.name;
  let copiedByWarning: { share: number; text: string; suggest?: { id: string; name: string } } | undefined;
  if (viewer && entries.length && offByDegree.length / entries.length > COPIED_BY_WARN) {
    const fits = net.owners
      .filter((o) => o.id !== viewer)
      .map((o) => {
        const r = matchReactions(net, offByDegree.map((u) => u.entry), { viewer: o.id });
        return { o, n: r.matched.length + r.review.length };
      })
      .sort((a, b) => b.n - a.n)[0];
    const suggest = fits?.n ? { id: fits.o.id, name: fits.o.name } : undefined;
    const share = Math.round((100 * offByDegree.length) / entries.length);
    copiedByWarning = {
      share,
      suggest,
      text: `${offByDegree.length} of ${entries.length} names (${share}%) are people your networks know, but LinkedIn's "1st"/"2nd" says otherwise if the list was copied from ${name(viewer)}'s LinkedIn.${suggest ? ` It fits ${suggest.name}'s network better: set "Copied from" to ${suggest.name} and match again.` : ` Check "Copied from".`}`,
    };
  }
  // A pick must be someone with that name: a pick never moves a reaction to another person.
  const ignoredPicks: { name: string; person_id: string; why: string }[] = [];
  const picks = (input.picks ?? []).filter((p) => {
    const c = net.byId.get(p.person_id);
    const why = !c ? "No person with this id" : nameKey(c.name) !== nameKey(p.name) ? "The picked person does not have this name" : "";
    if (why) ignoredPicks.push({ ...p, why });
    return !why;
  });
  const picked = new Set(picks.map((p) => nameKey(p.name)));
  const at = new Date().toISOString();
  const postDate = isoDate(input.postDate) || net.today;
  // No label: "Mikael's post, 24 Oct 2026".
  const authorName = net.owners.find((o) => o.id === authorId)?.name;
  const base = { post: input.post.trim() || `${authorName ? (authorName === "You" ? "Your" : `${authorName}'s`) : "A"} post, ${fmtDate(postDate)}`, postDate, author: authorId, at };
  // Two people of one name can both react: a pick never drops another
  // match; only the same person twice is collapsed.
  const rows: Reaction[] = [];
  for (const r of [
    ...res.matched.map((m) => ({ ...base, contactId: m.contactId, name: m.entry.name, how: m.how })),
    ...picks.map((p) => ({ ...base, contactId: p.person_id, name: cleanName(p.name), how: "picked" as const })),
  ])
    if (!rows.some((x) => x.contactId === r.contactId)) rows.push(r);
  const saved = input.save === false ? 0 : rows.length ? addReactionRows(rows) : 0;
  // Not in anyone's network: kept apart as "Engaged, not connected", with only
  // what the list showed. Names ruled out by "1st" are not: "Copied from" is
  // probably wrong for them.
  const engagedRows: Engaged[] = res.unmatched
    .filter((u) => u.kind === "none")
    .map((u) => ({ id: engagedId(u.entry.name, u.entry.headline), name: cleanName(u.entry.name), ...(u.entry.headline ? { headline: u.entry.headline.slice(0, 200) } : {}), ...(u.entry.degree ? { degree: u.entry.degree } : {}), post: base.post, postDate, ...(authorId ? { author: authorId } : {}), at }));
  const engagedSaved = input.save === false ? 0 : engagedRows.length ? addEngaged(engagedRows) : 0;
  const person = (id: string) => {
    const c = net.byId.get(id)!;
    return { id, name: c.name, title: c.position, company: candidateOf(c).company, fit: c.fit, url: appUrl(`/people/${id}`) };
  };
  return {
    post: base.post,
    postDate,
    author: authorId ? net.owners.find((o) => o.id === authorId)?.name : undefined,
    read: entries.length,
    stored: input.save !== false,
    saved,
    matched: rows.map((r) => ({ name: r.name, how: r.how, person: person(r.contactId) })),
    review: res.review.filter((r) => !picked.has(nameKey(r.entry.name))).map((r) => ({ name: r.entry.name, headline: r.entry.headline, degree: r.entry.degree, candidates: r.candidates.map((c) => ({ ...c, url: appUrl(`/people/${c.id}`) })) })),
    copiedBy: name(viewer),
    unmatched: res.unmatched.filter((u) => u.kind === "none").map((u) => ({ name: u.entry.name, why: u.why })),
    // The same people, saved apart (when stored) as engaged, not connected: name, headline, degree, post.
    engaged: { saved: engagedSaved, people: engagedRows.map((e) => ({ id: e.id, name: e.name, headline: e.headline, degree: e.degree, company: headlineParts(e.headline).company || undefined })) },
    // Same name as someone in the networks, but the degree marker against "Copied from" says otherwise. Not stored.
    degreeMismatch: offByDegree.map((u) => ({ name: u.entry.name, degree: u.entry.degree })),
    ...(copiedByWarning ? { copiedByWarning } : {}),
    // Lines of the paste read as nobody: shown once, so a missed person can be spotted. Not stored.
    unread: read.unread.slice(0, 50),
    // Company pages that reacted ("Ultrahack", "3,731 followers"): skipped, never matched to a person.
    companyPages: read.companyPages.length,
    ...(ignoredPicks.length ? { ignoredPicks } : {}),
    note: "Names in 'unmatched' are not in the team's networks: on save they are kept as 'Engaged, not connected' (name, headline, degree, post only; deleted after 90 days unless a status is set). Names in 'degreeMismatch' are not stored. 'degreeMismatch' are names someone in the networks has, ruled out only by LinkedIn's degree marker against copiedBy; with copiedByWarning, ask who copied the list and match again. Names in 'review' are stored only after someone picks the right person. 'unread' lists lines read as nobody; check them for a missed person.",
  };
}
