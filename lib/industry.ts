// Industry groups (readable bands over TOL 2008 codes) and the target profile:
// what the user is looking for, in their own words, and the TOL codes,
// organisation keywords and titles that follow from it.

export type GroupId =
  | "metal"
  | "electrical"
  | "plastics"
  | "food"
  | "wood"
  | "construction"
  | "logistics"
  | "maritime"
  | "wholesale"
  | "other_industrial"
  | "energy"
  | "software"
  | "services"
  | "finance"
  | "retail"
  | "health"
  | "media"
  | "hospitality"
  | "other"
  | "not_matched"
  | "abroad";

export type Group = { id: GroupId; label: string; short: string; grey?: boolean; rule: string };

/** Order is the order of the bands in the network drawing. */
export const GROUPS: Group[] = [
  { id: "metal", label: "Metal and machinery", short: "Metal", rule: "TOL 24, 25, 28, 29, 30 (not boats), 33 (not ship repair)" },
  { id: "electrical", label: "Electrical and electronics", short: "Electrical", rule: "TOL 26, 27" },
  { id: "plastics", label: "Plastics and chemicals", short: "Plastics", rule: "TOL 19–22" },
  { id: "food", label: "Food", short: "Food", rule: "TOL 01–03, 10–12" },
  { id: "wood", label: "Wood and building products", short: "Wood", rule: "TOL 16, 17, 23, 31" },
  { id: "construction", label: "Construction", short: "Construction", rule: "TOL 41–43" },
  { id: "logistics", label: "Logistics and transport", short: "Logistics", rule: "TOL 49, 51–53" },
  { id: "maritime", label: "Maritime", short: "Maritime", rule: "TOL 301, 3315, 50" },
  { id: "wholesale", label: "Wholesale", short: "Wholesale", rule: "TOL 46" },
  { id: "other_industrial", label: "Other industrial", short: "Other industrial", rule: "TOL 05–09, 13–15, 18, 32" },
  { id: "energy", label: "Energy and utilities", short: "Energy", rule: "TOL 35–39" },
  { id: "software", label: "Software and IT", short: "Software", rule: "TOL 62–63" },
  { id: "services", label: "Professional services and consulting", short: "Services", rule: "TOL 69–71, 73–74" },
  { id: "finance", label: "Finance and insurance", short: "Finance", rule: "TOL 64–66" },
  { id: "retail", label: "Retail", short: "Retail", rule: "TOL 47" },
  { id: "health", label: "Health and care", short: "Health", rule: "TOL 86–88" },
  { id: "media", label: "Media and creative", short: "Media", rule: "TOL 58–60, 90" },
  { id: "hospitality", label: "Hospitality", short: "Hospitality", rule: "TOL 55–56" },
  { id: "other", label: "Other industries", short: "Other", rule: "Any other line of business in PRH" },
  { id: "not_matched", label: "Not matched", short: "Not matched", grey: true, rule: "No single company in PRH for this name" },
  { id: "abroad", label: "Abroad", short: "Abroad", grey: true, rule: "Foreign company form or a known international company, not in PRH" },
];

export const GROUP: Record<GroupId, Group> = Object.fromEntries(GROUPS.map((g) => [g.id, g])) as Record<GroupId, Group>;

/** TOL code (e.g. "28300") -> industry group. */
export function groupForTol(tol: string | undefined): GroupId {
  if (!tol || !/^\d{2}/.test(tol)) return "other";
  const d = Number(tol.slice(0, 2));
  if (tol.startsWith("301") || tol.startsWith("3315") || d === 50) return "maritime";
  if ([24, 25, 28, 29, 30, 33].includes(d)) return "metal";
  if (d === 26 || d === 27) return "electrical";
  if (d >= 19 && d <= 22) return "plastics";
  if ((d >= 1 && d <= 3) || (d >= 10 && d <= 12)) return "food";
  if ([16, 17, 23, 31].includes(d)) return "wood";
  if (d >= 41 && d <= 43) return "construction";
  if (d === 49 || (d >= 51 && d <= 53)) return "logistics";
  if (d === 46) return "wholesale";
  if ((d >= 5 && d <= 9) || (d >= 13 && d <= 15) || d === 18 || d === 32) return "other_industrial";
  if (d >= 35 && d <= 39) return "energy";
  if (d === 62 || d === 63) return "software";
  if ((d >= 69 && d <= 71) || d === 73 || d === 74) return "services";
  if (d >= 64 && d <= 66) return "finance";
  if (d === 47) return "retail";
  if (d >= 86 && d <= 88) return "health";
  if ((d >= 58 && d <= 60) || d === 90) return "media";
  if (d === 55 || d === 56) return "hospitality";
  return "other";
}

// ---------- target profile ----------

/** A TOL rule: a range of two-digit divisions ("10-33") or a code prefix ("2811"). */
export type IndustryRule = { code: string; label: string; lowerPriority?: boolean };

/**
 * What the user is looking for. Nothing is built in: an empty profile means
 * the user has not said yet (config/profile.json, or DATA_DIR/profile.json).
 */
export type Profile = {
  /** In the user's words: "find people at VC funds, I'm looking for an analyst role". */
  goal: string;
  /** Titles that matter for the goal: "partner", "head of talent", "toimitusjohtaja". */
  roles: string[];
  /** Target industries as TOL rules. Empty: any industry. */
  industries: IndustryRule[];
  /** Words in an organisation's name that make it a target whatever its industry: "ventures", "capital". */
  keywords: string[];
  /** Organisations that are not a target: a business ID from PRH, or a name. */
  excluded?: { businessId?: string; name: string }[];
  /** What the user asks for in a message: "a 20-minute call", "advice", "an intro". */
  ask: string;
  /** How messages read: "friendly and direct, Finnish". */
  tone: string;
  /** How messages end: "– Alex". */
  signature: string;
  /** Hide companies not in the Employer Register (no regular employees). On unless set to false. */
  requireEmployer?: boolean;
};

export const EMPTY_PROFILE: Profile = { goal: "", roles: [], industries: [], keywords: [], excluded: [], ask: "", tone: "", signature: "" };

/** The Employer Register filter: on by default. */
export const requiresEmployer = (p: Pick<Profile, "requireEmployer">) => p.requireEmployer !== false;

/** Nothing said yet: no goal, roles, industries or keywords. Excluded organisations alone do not count. */
export function profileIsEmpty(p: Partial<Profile> | null | undefined): boolean {
  return !p || (!p.goal?.trim() && !p.roles?.length && !p.industries?.length && !p.keywords?.length);
}

/** Any shape read from a file or a request, as a Profile. Unknown fields are dropped. */
export function normaliseProfile(x: unknown): Profile {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const list = (v: unknown, n = 60) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((s) => String(s).trim()).filter(Boolean).slice(0, n);
  const industries = (Array.isArray(o.industries) ? o.industries : [])
    .map((r) => (typeof r === "string" ? { code: r, label: r } : (r as IndustryRule)))
    .map((r) => ({ code: String(r?.code ?? "").replace(/[\s.]/g, ""), label: String(r?.label || r?.code || "").slice(0, 60), ...(r?.lowerPriority ? { lowerPriority: true } : {}) }))
    .filter((r) => /^\d{2}-\d{2}$|^\d{2,5}$/.test(r.code));
  const excluded = (Array.isArray(o.excluded) ? o.excluded : [])
    .map((e) => (typeof e === "string" ? { name: e } : (e as { businessId?: string; name?: string })))
    .map((e) => ({ ...(e?.businessId && /^\d{7}-\d$/.test(e.businessId) ? { businessId: e.businessId } : {}), name: String(e?.name ?? e?.businessId ?? "").trim().slice(0, 120) }))
    .filter((e) => e.name || e.businessId);
  return {
    goal: str(o.goal, 1000),
    roles: list(o.roles),
    industries,
    keywords: list(o.keywords).map((k) => k.toLowerCase()),
    excluded,
    ask: str(o.ask, 200),
    tone: str(o.tone, 300),
    signature: str(o.signature, 120),
    ...(typeof o.requireEmployer === "boolean" ? { requireEmployer: o.requireEmployer } : {}),
  };
}

/**
 * Plain-language industries and the TOL 2008 codes they mean. The first word
 * list that matches wins; the user sees the mapping and can correct it.
 */
export const INDUSTRY_WORDS: { words: string[]; label: string; codes: string[]; note?: string }[] = [
  { words: ["venture capital", "vc", "vc fund", "private equity", "pe fund", "investment fund", "fund management", "asset management", "angel", "pääomasijoit"], label: "Funds and investment", codes: ["6430", "6499", "6630"], note: "6499 also holds some listed groups' parent companies; keywords such as \"ventures\" or \"capital\" catch funds registered elsewhere." },
  { words: ["holding"], label: "Holding companies", codes: ["642"] },
  { words: ["bank", "banking", "pankki"], label: "Banking", codes: ["641"] },
  { words: ["insurance", "vakuutus"], label: "Insurance", codes: ["65"] },
  { words: ["finance", "financial", "fintech", "rahoitus"], label: "Finance and insurance", codes: ["64-66"] },
  { words: ["game", "games", "gaming", "pelit"], label: "Games", codes: ["5821", "6201"] },
  { words: ["software", "saas", "it", "tech", "technology", "ohjelmisto"], label: "Software and IT", codes: ["62-63"] },
  { words: ["telecom", "telecommunications", "tele"], label: "Telecommunications", codes: ["61"] },
  { words: ["media", "publishing", "film", "tv", "radio", "kustannus"], label: "Media and publishing", codes: ["58-60"] },
  { words: ["advertising", "marketing", "agency", "pr", "mainonta", "markkinointi"], label: "Advertising and marketing", codes: ["73"] },
  { words: ["legal", "law", "law firm", "laki", "asianajo"], label: "Legal", codes: ["691"] },
  { words: ["accounting", "audit", "tilitoimisto", "kirjanpito"], label: "Accounting and audit", codes: ["692"] },
  { words: ["consulting", "consultancy", "management consulting", "konsultointi"], label: "Management consulting", codes: ["702"] },
  { words: ["engineering", "architecture", "insinööri", "arkkitehti"], label: "Architecture and engineering", codes: ["71"] },
  { words: ["professional services", "services", "asiantuntija"], label: "Professional services", codes: ["69-71", "73-74"] },
  { words: ["research", "r&d", "tutkimus"], label: "Research and development", codes: ["72"] },
  { words: ["recruiting", "recruitment", "staffing", "hr", "rekrytointi", "henkilöstö"], label: "Recruiting and staffing", codes: ["78"] },
  { words: ["real estate", "property", "kiinteistö"], label: "Real estate", codes: ["68"] },
  { words: ["construction", "building", "rakentaminen", "rakennus"], label: "Construction", codes: ["41-43"] },
  { words: ["logistics", "transport", "transportation", "freight", "logistiikka", "kuljetus"], label: "Transport and logistics", codes: ["49-53"] },
  { words: ["maritime", "shipping", "merenkulku"], label: "Maritime", codes: ["50", "301", "3315"] },
  { words: ["wholesale", "tukkukauppa"], label: "Wholesale", codes: ["46"] },
  { words: ["retail", "e-commerce", "ecommerce", "shop", "vähittäiskauppa"], label: "Retail", codes: ["47"] },
  { words: ["food", "food and beverage", "beverage", "elintarvike"], label: "Food and beverages", codes: ["10-11"] },
  { words: ["agriculture", "farming", "forestry", "maatalous", "metsätalous"], label: "Agriculture and forestry", codes: ["01-03"] },
  { words: ["metal", "machinery", "machine building", "konepaja", "metalli"], label: "Metal and machinery", codes: ["24-25", "28"] },
  { words: ["electronics", "electrical", "elektroniikka"], label: "Electrical and electronics", codes: ["26-27"] },
  { words: ["automotive", "vehicles", "autot"], label: "Vehicles", codes: ["29", "45"] },
  { words: ["chemicals", "plastics", "kemia", "muovi"], label: "Chemicals and plastics", codes: ["19-22"] },
  { words: ["pharma", "pharmaceutical", "lääke"], label: "Pharmaceuticals", codes: ["21"] },
  { words: ["wood", "paper", "forest industry", "puu", "paperi"], label: "Wood and paper", codes: ["16-17"] },
  { words: ["manufacturing", "industry", "industrial", "teollisuus", "valmistus"], label: "Manufacturing", codes: ["10-33"] },
  { words: ["energy", "utilities", "power", "energia"], label: "Energy", codes: ["35"] },
  { words: ["water", "waste", "recycling", "jäte", "kierrätys"], label: "Water and waste", codes: ["36-39"] },
  { words: ["mining", "kaivos"], label: "Mining", codes: ["05-09"] },
  { words: ["health", "healthcare", "care", "medical", "terveys"], label: "Health and care", codes: ["86-88"] },
  { words: ["education", "school", "training", "koulutus"], label: "Education", codes: ["85"] },
  { words: ["hospitality", "hotel", "hotels", "restaurant", "restaurants", "ravintola", "hotelli"], label: "Hospitality", codes: ["55-56"] },
  { words: ["culture", "arts", "creative", "kulttuuri"], label: "Arts and culture", codes: ["90-91"] },
  { words: ["sports", "recreation", "urheilu"], label: "Sports and recreation", codes: ["93"] },
  { words: ["security", "facility services", "cleaning", "vartiointi", "siivous"], label: "Security and facility services", codes: ["80-81"] },
  { words: ["public sector", "government", "julkinen"], label: "Public administration", codes: ["84"] },
  { words: ["non-profit", "nonprofit", "association", "ngo", "järjestö", "yhdistys"], label: "Associations", codes: ["94"] },
  { words: ["sme", "smes", "all", "any", "every company", "all companies", "pk-yritykset"], label: "Any line of business", codes: ["01-82", "85-93", "95-96"] },
];

export type IndustryMapping = { input: string; label: string; rules: IndustryRule[]; note?: string } | { input: string; unmapped: true; hint: string };

/** "venture capital", "28", "10-33", "logistics" -> TOL rules, one entry per input so the user can check each. */
export function mapIndustries(inputs: string[]): IndustryMapping[] {
  return inputs.map((raw) => {
    const input = raw.trim();
    const code = input.replace(/[\s.]/g, "").replace("–", "-");
    if (/^\d{2}-\d{2}$|^\d{2,5}$/.test(code)) return { input, label: `TOL ${code}`, rules: [{ code, label: `TOL ${code}` }] };
    const x = input.toLowerCase().replace(/[^\p{L}\p{N}&+ -]/gu, " ").replace(/\s+/g, " ").trim();
    const hit =
      INDUSTRY_WORDS.find((w) => w.words.includes(x)) ??
      // A listed word at a word start in the phrase ("water" in "water treatment", not in "underwater"), or the phrase starting a listed word.
      INDUSTRY_WORDS.find((w) => w.words.some((word) => word.length > 3 && (` ${x}`.includes(` ${word}`) || (x.length > 3 && word.startsWith(x)))));
    if (!hit) return { input, unmapped: true, hint: "No TOL group for this. Give a TOL code, or add it as an organisation keyword instead." };
    return { input, label: hit.label, rules: hit.codes.map((c) => ({ code: c, label: hit.label })), ...(hit.note ? { note: hit.note } : {}) };
  });
}

export function tolMatches(tol: string | undefined, code: string): boolean {
  if (!tol) return false;
  const c = code.replace(/\s/g, "");
  const range = c.match(/^(\d{2})-(\d{2})$/);
  if (range) {
    const d = Number(tol.slice(0, 2));
    return d >= Number(range[1]) && d <= Number(range[2]);
  }
  return /^\d+$/.test(c) && tol.startsWith(c);
}

/** The most specific rule that covers this TOL code, or null when it is outside the profile. */
export function industryRule(tol: string | undefined, profile: Profile): IndustryRule | null {
  const hits = profile.industries.filter((r) => tolMatches(tol, r.code));
  if (!hits.length) return null;
  // A specific prefix ("2811", lower priority) wins over a broad range ("10-33").
  return hits.sort((a, b) => b.code.replace(/-.*/, "").length - a.code.replace(/-.*/, "").length || (a.code.includes("-") ? 1 : -1))[0];
}

/** Excluded by business ID, or by name when the user gave only a name. */
export function isExcluded(profile: Pick<Profile, "excluded">, businessId: string | undefined, names: string[]): boolean {
  const keys = names.map(loose);
  return (profile.excluded ?? []).some((x) => (x.businessId ? x.businessId === businessId : keys.includes(loose(x.name))));
}

/** The keyword in this organisation's name, or undefined. A word start: "capital" matches "Nordic Capital" and "Capitalia". */
export function keywordIn(names: string[], profile: Pick<Profile, "keywords">): string | undefined {
  const folded = names.map((n) => ` ${loose(n)} `);
  return profile.keywords.find((k) => {
    const w = loose(k);
    return !!w && folded.some((n) => n.includes(` ${w}`));
  });
}

/**
 * Why this organisation is a target, or null. An industry rule from its TOL
 * code; else a keyword in its name; with neither industries nor keywords in
 * the profile, every organisation is ("Any industry").
 */
export function targetRule(profile: Profile, tol: string | undefined, names: string[]): IndustryRule | null {
  const byIndustry = profile.industries.length ? industryRule(tol, profile) : null;
  if (byIndustry) return byIndustry;
  const kw = keywordIn(names, profile);
  if (kw) return { code: "keyword", label: `"${kw}" in the name` };
  if (!profile.industries.length && !profile.keywords.length) return { code: "any", label: "Any industry" };
  return null;
}

const loose = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** Shown as chips: "Manufacturing 10–33". */
export function ruleLabel(r: IndustryRule): string {
  return /^\d/.test(r.code) && !r.label.includes(r.code) ? `${r.label} ${r.code.replace("-", "–")}` : r.label;
}

// ---------- abroad ----------

// Company forms that are not Finnish. "Ltd" and "Plc" are left out: Finnish
// companies use them as the English form of Oy and Oyj. "Ab" counts only
// without "Oy", since Finland-Swedish companies are often "Oy X Ab".
const FOREIGN_FORM = /(^|[\s,])(aktiebolag|oü|ou|as|a\/s|aps|asa|gmbh|ag|se|kg|bv|b\.v\.|nv|sa|sas|sarl|srl|spa|s\.p\.a\.|sp\. z o\.o\.|inc\.?|llc|l\.l\.c\.|pty|kk)$/i;

// Well-known international employers that people list without a company form.
// Used only when PRH has no single Finnish company for the name.
const INTERNATIONAL = new Set(
  ("google|alphabet|microsoft|amazon|aws|amazon web services|apple|meta|facebook|netflix|spotify|klarna|ericsson|volvo|volvo cars|scania|" +
    "h and m|h and m group|ikea|king|epidemic sound|northvolt|bolt|pipedrive|wise|veriff|skype|starship technologies|skeleton technologies|" +
    "zalando|sap|siemens|bosch|robert bosch|n26|celonis|personio|delivery hero|salesforce|nvidia|databricks|stripe|openai|anthropic|" +
    "oracle|ibm|intel|amd|cisco|deloitte|mckinsey|mckinsey and company|bcg|boston consulting group|bain|ey|kpmg|pwc|" +
    "abb|atlas copco|sandvik|electrolux|hilti|philips|shell|bp|unilever|nestle|maersk|novo nordisk|lego|carlsberg|equinor|dnb|" +
    "airbnb|uber|linkedin|github|gitlab|atlassian|shopify|booking com|tesla").split("|"),
);

/** "Spotify AB", "Bolt Technology OÜ", "Siemens AG". */
export function hasForeignForm(name: string): boolean {
  const n = name.trim();
  return FOREIGN_FORM.test(n) || (/(^|\s)ab$/i.test(n) && !/(^|\s)oyj?(\s|$)/i.test(n));
}

/** "Google", "Klarna AB": a well-known international employer. `key` is the matcher's looseKey. */
export function knownInternational(key: string): boolean {
  return INTERNATIONAL.has(key) || INTERNATIONAL.has(key.replace(/ (group|inc|corporation|company)$/, ""));
}

/** `key` is the matcher's looseKey of the name (folded, "&" as "and"). */
export function looksForeign(name: string, key: string): boolean {
  return hasForeignForm(name) || knownInternational(key);
}
