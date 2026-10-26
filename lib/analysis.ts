// The analysis of one person: reasons with their source, what we don't know,
// fit, approach and a possible angle. Every sentence is built from facts in
// the model; nothing here is guessed.
import type { Provenance } from "./types.ts";
import { GROUP, isExcluded, ruleLabel, type GroupId } from "./industry.ts";
import { isStrongRole } from "./roles.ts";
import { SIGNAL_TYPES, signalLabel } from "./signals.ts";
import { ytjUrl } from "./prh.ts";
import { STATUS_LABEL, type Status } from "./state.ts";
import type { Approach, Contact, Fit, Network } from "./network.ts";

export type Pill = "LinkedIn title" | "PRH" | "PRH/YTJ" | "PRH notices" | "Your network" | "LinkedIn" | "Your team" | "Reaction";

export type Reason = { kind: "role" | "company" | "signal" | "network" | "team" | "reaction"; label: string; text: string; source: Pill; provenance: Provenance; link?: string };
export type MissingFact = { label: string; text: string };

export type Analysis = {
  id: string;
  name: string;
  firstName: string;
  url: string;
  title: string;
  company: {
    id: string | null;
    name: string;
    raw: string;
    businessId?: string;
    link?: string;
    industry?: string;
    tol?: string;
    town?: string;
    group: GroupId;
    groupLabel: string;
    matchStatus: string;
    matchNote: string;
  };
  fit: Fit | null;
  fitLabel: string;
  fitWhy: string;
  approach: Approach;
  approachLabel: string;
  approachWhy: string;
  knownBy: { owner: string; ownerName: string; connectedOn: string }[];
  sender: { ownerName: string; connectedOn: string; why: string };
  reasons: Reason[];
  missing: MissingFact[];
  angle: { text: string; by: "template" | "claude"; note: string };
  score: number;
  parts: { label: string; points: number; why: string }[];
  status: Status;
  statusLabel: string;
  statusBy?: string;
  statusAt?: string;
};

export const FIT_LABEL: Record<Fit, string> = { strong: "Strong fit", possible: "Possible fit" };
export const APPROACH_LABEL: Record<Approach, string> = { direct: "Talk directly", ask_intro: "Ask for an intro", skip: "Skip for now" };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

/** "Oy Lunawood Ltd" -> "Lunawood" for running text. */
export function shortName(n: string): string {
  // Any capitals: "OY Bahn Express AB" -> "Bahn Express".
  let s = n.replace(/^(Oy|Ab)\s+/i, "");
  while (/\s+(Oyj|Oy|Ab|Abp|Ltd|Plc|Ltd\.)$/i.test(s)) s = s.replace(/\s+(Oyj|Oy|Ab|Abp|Ltd|Plc|Ltd\.)$/i, "");
  return s.replace(/,$/, "").trim() || n;
}

const lc = (s?: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : "");

/**
 * One sentence on why this person could matter for the user's goal, from the
 * facts in the model and the goal as the user wrote it. Labelled Inferred.
 */
export function templateAngle(c: Contact, companyName: string, industry: string | undefined, goal: string): string {
  const first = c.name.split(" ")[0];
  const where = industry ? `${companyName} (${lc(industry)})` : companyName;
  const forGoal = goal ? ` for your goal ("${goal.length > 120 ? `${goal.slice(0, 117)}…` : goal}")` : "";
  if (c.approach === "ask_intro") return `${first} works at ${where} and could point you to the right person there${forGoal}.`;
  return `As ${c.position || "someone"} at ${where}, ${first} could be worth a conversation${forGoal}.`;
}

export function analyse(net: Network, c: Contact): Analysis {
  const prh = c.match && !c.match.foreign && (c.match.status === "verified" || c.match.status === "inferred") ? c.match.company : undefined;
  const companyName = prh ? shortName(prh.name) : c.company || "No company";
  const co = c.companyId ? net.companies.get(c.companyId) : undefined;
  const reasons: Reason[] = [];
  const missing: MissingFact[] = [];

  // Role, from the LinkedIn title.
  if (c.role.decisionMaker) reasons.push({ kind: "role", label: "Role", text: `"${c.position}". ${c.role.decides}`, source: "LinkedIn title", provenance: "imported" });
  else if (c.role.notDecider) reasons.push({ kind: "role", label: "Role", text: `"${c.position || "No title"}". Not counted as a decision-maker: ${c.role.notDecider}.${c.rule && c.role.intro ? " They could introduce you to someone who decides." : ""}`, source: c.role.notDecider.includes("PRH") ? "PRH" : "LinkedIn title", provenance: c.role.notDecider.includes("PRH") ? "verified" : "imported" });
  else if (c.position) reasons.push({ kind: "role", label: "Role", text: `"${c.position}". The title does not say they decide; ${c.role.intro ? "they could introduce you to someone who does" : "not a role that usually introduces you to who decides"}.`, source: "LinkedIn title", provenance: "imported" });

  // Company, from PRH.
  if (prh) {
    const inProfile = c.rule ? ` In your profile: ${ruleLabel(c.rule)}${c.rule.lowerPriority ? ", lower priority" : ""}.` : " Not a target in your profile.";
    const check = c.match!.status === "inferred" ? ` Matched "${c.company}" by a close name: check it.` : "";
    const early = c.caps.includes("early-stage, likely small") && prh.registrationDate ? ` Registered ${fmtDate(prh.registrationDate)}, under two years ago: early-stage, likely small.` : "";
    reasons.push({
      kind: "company",
      label: "Company",
      text: `${prh.name}: ${prh.industry ?? "line of business not given"}${prh.tol ? ` (TOL ${prh.tol})` : ""}${prh.town ? `, ${prh.town.charAt(0)}${prh.town.slice(1).toLowerCase()}` : ""}.${inProfile}${check}${early}`,
      source: "PRH",
      provenance: c.match!.status === "verified" ? "verified" : "inferred",
      link: ytjUrl(prh.businessId),
    });
  }

  // Employer Register and VAT register, from YTJ's register entries.
  if (prh?.registers) {
    const r = prh.registers;
    reasons.push({
      kind: "company",
      label: "Employer Register",
      text: r.employer
        ? `Employer Register: yes${r.employerSince ? `, since ${fmtDate(r.employerSince)}` : ""}. VAT register: ${r.vat ? "yes" : "no"}.`
        : `Employer Register: no. No regular employees registered${prh.registrationDate ? `; registered ${fmtDate(prh.registrationDate)}` : ""}. VAT register: ${r.vat ? "yes" : "no"}.`,
      source: "PRH/YTJ",
      provenance: c.match!.status === "verified" ? "verified" : "inferred",
      link: ytjUrl(prh.businessId),
    });
  }

  // Registered changes in the last 90 days.
  const byType = new Map<string, (typeof c.signals)[number]>();
  for (const s of c.signals) if (!byType.has(s.type) || byType.get(s.type)!.date < s.date) byType.set(s.type, s);
  for (const s of [...byType.values()].sort((a, b) => SIGNAL_TYPES[b.type].weight - SIGNAL_TYPES[a.type].weight || b.date.localeCompare(a.date))) {
    reasons.push({ kind: "signal", label: "Registered change", text: `${signalLabel(s)}: registered ${fmtDate(s.date)} (notice ${s.recordNumber}).`, source: "PRH notices", provenance: "verified", link: ytjUrl(s.businessId) });
  }

  // Network: colleagues, or when they connected.
  if (c.colleagues && co) {
    const others = co.contactIds.filter((id) => id !== c.id).map((id) => net.byId.get(id)!).sort((a, b) => b.score - a.score);
    const names = others.slice(0, 3).map((o) => `${o.name}${o.position ? ` (${o.position})` : ""}`).join(", ");
    reasons.push({ kind: "network", label: "Network", text: `${c.colleagues} other connection${c.colleagues > 1 ? "s" : ""} at ${companyName}: ${names}${others.length > 3 ? ", …" : ""}.`, source: "Your network", provenance: "imported" });
  } else {
    reasons.push({ kind: "network", label: "Connected", text: `${c.sender.ownerName} connected on ${fmtDate(c.sender.connectedOn)}. No one else the team knows works there.`, source: "LinkedIn", provenance: "imported" });
  }

  // Who in the team knows them.
  if (c.knownBy.length > 1) {
    const list = c.knownBy.map((k) => `${k.ownerName} (${fmtDate(k.connectedOn)})`).join(", ");
    reasons.push({ kind: "team", label: "Team", text: `Known by ${list}.`, source: "Your team", provenance: "verified" });
  }
  // Reactions pasted from LinkedIn, newest post first.
  const HOW: Record<string, string> = { name: "matched by name", name_company: "matched by name and the company in their headline", name_degree: "matched by name and connection degree", picked: "picked by the team" };
  for (const r of [...c.reactions].sort((a, b) => (b.postDate ?? b.at).localeCompare(a.postDate ?? a.at))) {
    const author = r.author ? net.owners.find((o) => o.id === r.author)?.name : undefined;
    const whose = !author || author === "You" ? "your post" : `${author}'s post`;
    reasons.push({ kind: "reaction", label: "Reacted", text: `Reacted to ${whose} "${r.post}"${r.postDate ? ` on ${fmtDate(r.postDate)}` : ""} (${HOW[r.how ?? "name"]}).`, source: "Reaction", provenance: r.how === "picked" ? "imported" : "inferred" });
  }

  // What we don't know.
  missing.push({
    label: "Headcount",
    text: prh?.formCode === "17" ? "Not in PRH open data. It is a public limited company (Oyj, PRH), which is often a large group: check the size." : "Not in PRH open data. Check the size before you reach out.",
  });
  if (!c.position) missing.push({ label: "Title", text: "Empty in the LinkedIn export." });
  if (prh && !prh.registers) missing.push({ label: "Employer Register", text: "Not looked up yet: it is fetched from PRH/YTJ with the next lookups." });
  if (c.match?.status === "inferred" && !c.match.foreign) missing.push({ label: "Company match", text: `Close name only ("${c.company}"). Confirm it under Settings → PRH matches.` });
  if (!prh && c.company) missing.push({ label: "Company", text: c.match?.foreign ? "Not a Finnish company, so PRH has nothing on it." : c.match?.status === "pending" ? "Not looked up in PRH yet." : `"${c.company}" has no single match in PRH. ${c.match?.note ?? ""}`.trim() });
  if (!c.company) missing.push({ label: "Company", text: "Empty in the LinkedIn export." });
  const exports = c.knownBy.map((k) => (k.ownerName === "You" ? "your" : `${k.ownerName}'s`));
  missing.push({ label: "Title today", text: `The title is as it was in ${exports.join(" and ")} LinkedIn export${exports.length > 1 ? "s" : ""}; it may have changed since.` });

  const excluded = isExcluded(net.profile, prh?.businessId, [prh?.name ?? "", c.company].filter(Boolean));
  const roles = net.profile.roles;
  const capped = c.fit === "possible" && c.caps.length && !c.rule?.lowerPriority && isStrongRole(c.role, roles);
  const fitWhy = !c.fit
    ? c.tooSmall
      ? "Not in the Employer Register (PRH/YTJ): no regular employees, so not a fit. This filter can be turned off in Settings → Profile."
      : excluded
      ? "Marked as not a target in your profile."
      : !c.rule
      ? "Not at an organisation your profile targets."
      : c.role.notDecider
        ? `Works at a target company, but not counted as a decision-maker: ${c.role.notDecider}.`
        : "Works at a target company, but the title is not a decision-maker role."
    : c.fit === "strong" || capped
      ? `Senior title${c.role.matched ? ` matching your target role "${c.role.matched}"` : ""}, at ${ruleLabel(c.rule!)}.${capped ? ` Possible at most: ${c.caps.join(", ")}.` : ""}`
      : c.rule?.lowerPriority
        ? `Decision-maker, but ${c.rule.label.toLowerCase()} is lower priority in your profile.`
        : c.role.level === "manager"
          ? "Manager-level title: shapes decisions, rarely signs them off."
          : c.rule?.code === "keyword-abroad"
            ? `Decision-maker at an organisation found by a keyword, not in PRH: Possible at most.`
            : roles.length && !c.role.matched
              ? "Decision-maker, but the title is not one of your target roles."
              : "Decision-maker, not at a senior level.";
  const fitWhyFull = c.fit === "possible" && !capped && c.caps.length ? `${fitWhy} Also: ${c.caps.join(", ")}.` : fitWhy;
  const approachWhy = c.approach === "direct" ? `${c.sender.ownerName === "You" ? "you write" : `${c.sender.ownerName} writes`} to them.` : c.approach === "ask_intro" ? `Ask ${c.name.split(" ")[0]} who the right person is at ${companyName}.` : "No reason to reach out yet.";

  return {
    id: c.id,
    name: c.name,
    firstName: c.name.split(" ")[0],
    url: c.url,
    title: c.position,
    company: {
      id: c.companyId,
      name: companyName,
      raw: c.company,
      businessId: prh?.businessId,
      link: prh ? ytjUrl(prh.businessId) : undefined,
      industry: prh?.industry,
      tol: prh?.tol,
      town: prh?.town,
      group: c.group,
      groupLabel: GROUP[c.group].label,
      matchStatus: c.match?.status ?? "none",
      matchNote: c.match?.note ?? "",
    },
    fit: c.fit,
    fitLabel: c.fit ? FIT_LABEL[c.fit] : "Not on the list",
    fitWhy: fitWhyFull,
    approach: c.approach,
    approachLabel: APPROACH_LABEL[c.approach],
    approachWhy,
    knownBy: c.knownBy.map((k) => ({ owner: k.owner, ownerName: k.ownerName, connectedOn: k.connectedOn })),
    sender: { ownerName: c.sender.ownerName, connectedOn: c.sender.connectedOn, why: "Connected first" },
    reasons,
    missing,
    angle: { text: templateAngle(c, companyName, prh?.industry, net.profile.goal), by: "template", note: "Written from the facts above only. Check before you use it." },
    score: c.score,
    parts: c.parts,
    status: c.status?.status ?? "none",
    statusLabel: STATUS_LABEL[c.status?.status ?? "none"],
    statusBy: c.status?.by,
    statusAt: c.status?.at,
  };
}
