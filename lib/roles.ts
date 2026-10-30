// What a LinkedIn title says about someone's role. Pure and deterministic:
// the same title and profile always give the same answer.
import { fold } from "./normalize.ts";

export type Level = "exec" | "director" | "manager" | "board" | "other";
export type Area = "ceo" | "operations" | "production" | "finance" | "technology" | "sales" | "people" | "quality" | "other";

export type RoleInfo = {
  title: string;
  decisionMaker: boolean;
  level: Level;
  area: Area;
  /** The profile term that matched, e.g. "production". */
  matched?: string;
  /** Plain sentence: what the title says they decide. */
  decides: string;
  /** Why the title (or the company's form) never counts as a decision-maker, e.g. "a student or trainee title". */
  notDecider?: string;
  /** Can realistically introduce you to who decides, by seniority: 0 = no, 1 specialist … 4 senior. */
  intro: number;
};

const t = (s: string) => ` ${fold(s).toLowerCase().replace(/[^a-z0-9&/+]+/g, " ").trim()} `;
const has = (title: string, re: RegExp) => re.test(title);

// Finnish compounds: "tuotantojohtaja" is a director, "tuotantopäällikkö" a manager,
// "työnjohtaja" (foreman) and "puheenjohtaja" (chair) are not directors.
const NOT_JOHTAJA = new Set(["tyonjohtaja", "puheenjohtaja", "varapuheenjohtaja"]);
const hasJohtaja = (x: string) => x.split(" ").some((w) => w.endsWith("johtaja") && !NOT_JOHTAJA.has(w));

// "Partner" alone owns the firm (a fund, a law or consulting firm);
// "business partner", "partner manager" and the like are roles, not owners.
const NOT_BEFORE_PARTNER = "business|channel|hr|people|finance|financial|it|technology|tech|strategic|alliance|alliances|sales|solution|solutions|delivery|learning|talent|marketing|customer|trading|knowledge|program|service|services|cloud|integration|reseller|ecosystem|commercial|implementation|account";
const NOT_AFTER_PARTNER = "manager|management|success|marketing|sales|relations|program|programs|ecosystem|development|lead|alliances|account|accounts|engagement|enablement|onboarding|operations|network|integrations|solutions|support|specialist|coordinator|executive|channel";
const PARTNER = `(?<!(?:${NOT_BEFORE_PARTNER}) )partners?(?! (?:${NOT_AFTER_PARTNER}) )`;
// An investor's own titles: they decide when the profile asks for them, like a manager.
// "Principal Engineer" and "Investor Relations" are not.
const INVESTOR = "principal(?! (?:engineer|consultant|scientist|architect|designer|developer|product|software|data|analyst|specialist|researcher|research|lecturer|investigator|program|technical|solutions|ux|security|cloud|counsel) )|investors?(?! relations )|business angel|bisnesenkeli|[a-z]*sijoittaja|[a-z]*investerare";

function level(x: string): Level {
  if (has(x, / (vice president|vp|svp|evp) /)) return "director";
  if (has(x, / (ceo|coo|cfo|cto|cio|cdo|cmo|chro|cpo|toimitusjohtaja|varatoimitusjohtaja|vd|managing director|general manager|president|founder|co founder|cofounder|(?<!(product|process|service|business|system|data|content) )owner(?! relations)|omistaja|yrittaja|operatiivinen johtaja|operativ direktor|deputy ceo|managing partner|general partner|founding partner) /)) return "exec";
  if (has(x, / chief [a-z ]*officer /)) return "exec";
  if (has(x, new RegExp(` ${PARTNER} `))) return "director";
  if (has(x, / (board member|board professional|hallituksen jasen|hallituksen puheenjohtaja|chairman|chair of the board|styrelseledamot|styrelseordforande) /)) return "board";
  if (has(x, / (director|[a-z]*direktor|head of|head) /) || hasJohtaja(x)) {
    // "Head Brewer" is a craft title, not head of a function.
    if (has(x, / head (brewer|chef|coach) /) && !has(x, / head of /)) return "other";
    return "director";
  }
  if (has(x, / (manager|[a-z]*paallikko|[a-z]*chef|lead|leader|esimies|supervisor|superintendent) /)) return "manager";
  if (has(x, new RegExp(` (?:${INVESTOR}) `))) return "manager";
  return "other";
}

const AREAS: [Area, RegExp][] = [
  ["ceo", / (ceo|toimitusjohtaja|varatoimitusjohtaja|vd|managing director|general manager|president|founder|co founder|cofounder|(?<!(product|process|service|business|system|data|content) )owner(?! relations)|omistaja|yrittaja|deputy ceo) /],
  ["operations", / (coo|operations|operational|operatiivinen|operativ|supply chain|toimitusketju[a-z]*|logistics|logistiikka[a-z]*|drift[a-z]*|kunnossapito[a-z]*|maintenance) /],
  ["production", / (production|tuotanto[a-z]*|tuotannon[a-z]*|produktion[a-z]*|manufacturing|valmistus[a-z]*|plant|tehdas[a-z]*|tehtaan[a-z]*|factory|works) /],
  ["finance", / (cfo|finance|financial|talous[a-z]*|ekonomi[a-z]*|controller|kirjanpit[a-z]*|accounting) /],
  ["technology", / (cto|cio|cdo|technology|teknologia[a-z]*|tekninen|technical|r&d|tuotekehitys[a-z]*|engineering|it|digital|digitalisaatio[a-z]*|tietohallinto[a-z]*|data|ai|software|ohjelmisto[a-z]*) /],
  ["sales", / (sales|myynti[a-z]*|commercial|kaupallinen|export|vienti[a-z]*|marketing|markkinointi[a-z]*|business development|salj[a-z]*|account) /],
  ["people", / (hr|henkilosto[a-z]*|people|talent) /],
  ["quality", / (quality|laatu[a-z]*) /],
];

function area(x: string): Area {
  for (const [a, re] of AREAS) if (re.test(x)) return a;
  return "other";
}

// Profile terms also match their Finnish and Swedish forms.
const SYNONYMS: Record<string, string[]> = {
  ceo: ["ceo", "toimitusjohtaja", "vd"],
  founder: ["founder", "co founder", "cofounder", "perustaja"],
  production: ["production", "tuotanto[a-z]*", "tuotannon[a-z]*", "produktion[a-z]*", "manufacturing"],
  operations: ["operations", "operational", "operatiivinen", "operativ"],
  director: ["director", "[a-z]*direktor"],
  "managing director": ["managing director", "toimitusjohtaja", "vd"],
  partner: [PARTNER],
  investor: ["investors?(?! relations )", "business angel", "bisnesenkeli", "[a-z]*sijoittaja", "[a-z]*investerare"],
};

const JUNIOR = / (assistant|avustaja|intern|internship|trainee|harjoittelija|worker|[a-z]*tyontekija|operator|coordinator|[a-z]*koordinaattori|specialist|[a-z]*asiantuntija|planner|[a-z]*suunnittelija|engineer|[a-z]*insinoori|student|opiskelija|analyst|technician|[a-z]*teknikko|junior|summer) /;

// Never a decision-maker, whatever the level says: students and trainees,
// student and association boards ("Board 2026", "Hallitus 2025"), event roles.
const STUDENT = / ([a-z]*opiskelija|student|students|trainee|[a-z]*harjoittelija|intern|internship|thesis|thesis worker|diplomityo[a-z]*|opinnayte[a-z]*|kesatyo[a-z]*) /;
const BOARD_WORD = / (board|hallitus|hallituksen|hallituksessa|styrelse[a-z]*) /;
const YEAR = / (19|20)\d\d /;
const EVENTS = / head of events? /;

function notDecider(x: string): string | undefined {
  if (STUDENT.test(x)) return "a student or trainee title";
  if (BOARD_WORD.test(x) && YEAR.test(x)) return "a board year in the title: a student or association board";
  if (EVENTS.test(x)) return "an events role";
  return undefined;
}

// Who can realistically introduce you to the person who decides: people with
// a working role in the company's business, never front-line or temporary staff.
const NO_INTRO = / (cashier|kassa[a-z]*|kassatyontekija|store|shop|myymala[a-z]*|retail assistant|sales associate|seasonal|kausi[a-z]*|summer|kesa[a-z]*|trainee|intern|internship|student|[a-z]*opiskelija|thesis|[a-z]*harjoittelija|production worker|worker|[a-z]*tyontekija) /;
const INTRO: [number, RegExp][] = [
  [4, / (director|[a-z]*direktor|[a-z]*johtaja|head|vp|vice president|partner|founder|owner|board|hallituksen) /],
  [3, / (manager|[a-z]*paallikko|lead|leader|team lead|esimies|supervisor) /],
  [2, / (senior|principal|sales|myynti[a-z]*|account|consultant|[a-z]*konsultti|advisor|architect) /],
  [1, / (specialist|[a-z]*asiantuntija|engineer|[a-z]*insinoori|developer|kehittaja|planner|[a-z]*suunnittelija|analyst|analyytikko|coordinator|[a-z]*koordinaattori|controller|buyer|purchaser|[a-z]*ostaja) /],
];

/** 0 when the title cannot realistically introduce; otherwise its seniority, 1 (specialist) to 4 (senior). */
export function introRank(title: string): number {
  const x = t(title || "");
  if (!title || NO_INTRO.test(x) || notDecider(x)) return 0;
  return INTRO.find(([, re]) => re.test(x))?.[0] ?? 0;
}

export function matchTerm(title: string, term: string): boolean {
  const x = t(title);
  const k = fold(term).toLowerCase().trim();
  if (!k) return false;
  if (k === "johtaja") return hasJohtaja(x);
  const forms = SYNONYMS[k] ?? [k.replace(/[^a-z0-9&/+]+/g, " ").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")];
  return forms.some((f) => new RegExp(` ${f} `).test(x));
}

const DECIDES: Record<Area, (l: Level) => string> = {
  ceo: () => "Runs the company: sets priorities and signs off investments.",
  operations: (l) => (l === "manager" ? "Manages operations: shapes how work, logistics and systems run; usually recommends rather than signs off." : "Leads operations: decides how work, logistics and systems run day to day."),
  production: (l) => (l === "manager" ? "Manages production: shapes how production is planned and run; usually recommends rather than signs off." : "Leads production: decides on processes, planning and the tools behind them."),
  finance: () => "Runs finance: signs off spending, reporting and ERP decisions.",
  technology: () => "Leads technology: decides on systems, data and development.",
  sales: () => "Leads sales: decides how the company sells, quotes and serves customers.",
  people: () => "Leads HR: takes part in management decisions on people and ways of working.",
  quality: () => "Leads quality: decides on quality processes and the data behind them.",
  other: (l) => (l === "board" ? "Board role: takes part in strategic decisions." : "Management role: takes part in decisions in their area."),
};

/** Reads a title against the profile's target roles. */
export function analyseTitle(title: string, roles: string[]): RoleInfo {
  const x = t(title || "");
  const lv = title ? level(x) : "other";
  const ar = title ? area(x) : "other";
  const matched = title ? roles.find((r) => matchTerm(title, r)) : undefined;
  // A matching word is not enough: "Production Planner" and "Operations
  // Specialist" match "production" and "operations" but decide nothing.
  const senior = lv === "exec" || lv === "director";
  // C-level, owner and director titles always count, whatever the profile says;
  // a manager or board title counts when it matches one of the profile's roles.
  const not = title ? notDecider(x) : undefined;
  const decisionMaker = !not && (senior || (!!matched && lv !== "other" && (lv === "board" || !JUNIOR.test(x))));
  return {
    title,
    decisionMaker,
    level: lv,
    area: lv === "board" && ar === "other" ? "other" : ar,
    matched,
    decides: decisionMaker ? DECIDES[ar](lv) : "",
    ...(not ? { notDecider: not } : {}),
    intro: introRank(title),
  };
}

/**
 * Strong-fit roles: a senior title (exec or director level) that matches one
 * of the profile's target roles; with no target roles, any senior title.
 */
export function isStrongRole(r: RoleInfo, roles: string[] = []): boolean {
  if (!r.decisionMaker || (r.level !== "exec" && r.level !== "director")) return false;
  return !roles.length || !!r.matched;
}

export const LEVEL_RANK: Record<Level, number> = { exec: 4, director: 3, board: 2, manager: 1, other: 0 };
