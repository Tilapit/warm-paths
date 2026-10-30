// Profile suggestions from the local model: from the user's goal, target
// roles, organisation keywords and plain-language industries, in English,
// Finnish and Swedish. Only the goal goes to the model. Nothing is saved
// here: the user ticks what they want, it goes into the form, and the
// profile changes only when they save it. Industries are mapped to TOL
// codes by code (mapIndustries), never by the model.
import { fold } from "./normalize.ts";
import { mapIndustries, type IndustryMapping, type Profile } from "./industry.ts";
import { jsonObject, ollamaChat, type ModelDeps } from "./ollama.ts";

// Roles and keywords come as {en, fi, sv}: asked for as one flat list, the
// model gives English only.
export const SUGGEST_SYSTEM = [
  "You help someone set up a profile for finding people in their LinkedIn network. From their goal, propose:",
  '- roles: job titles of people who could help them, each as {"en": English, "fi": Finnish, "sv": Swedish} (for example {"en": "sales director", "fi": "myyntijohtaja", "sv": "försäljningsdirektör"});',
  '- keywords: single words that often appear in the names of the organisations they are after, each as {"en", "fi", "sv"} (for example, for logistics: {"en": "logistics", "fi": "logistiikka", "sv": "logistik"});',
  '- industries: those organisations\' lines of business, in plain English words (e.g. "venture capital"), never codes;',
  "- noEmployeesOk: true when such organisations often have no employees of their own (funds, for example), otherwise false.",
  "Generic terms only: never the name of a person or of a specific organisation. At most 8 roles, 8 keywords and 6 industries, each at most four words.",
  'Return only JSON: {"roles":[{"en":"","fi":"","sv":""}],"keywords":[{"en":"","fi":"","sv":""}],"industries":[""],"noEmployeesOk":false}',
].join("\n");

const FIELDS = ["roles", "keywords", "industries", "noEmployeesOk"];
const LANGS = ["en", "fi", "sv"];
const MAX_ITEMS = 12;
// A plain term: letters, spaces, hyphens, apostrophes and "&". No digits, links or addresses.
const TERM = /^\p{L}[\p{L}' &-]*$/u;
// Ends like an organisation's name: Oy, AB, Ltd and so on.
const ORG_FORM = /\b(oy|oyj|ab|abp|ky|ay|ry|tmi|ltd|llc|inc|gmbh|plc|corp|as|aps|bv|sa|ag)$/i;

const key = (s: string) => fold(s).replace(/[^a-z0-9]+/g, " ").trim();

export type Suggestion = {
  roles: string[];
  keywords: string[];
  /** Mapped to TOL codes by code, as on save. */
  industries: Extract<IndustryMapping, { rules: unknown }>[];
  /** Industries with no TOL group: offered as keywords instead. */
  industryKeywords: string[];
  /** The model thinks the Employer Register filter would hide the organisations they want. */
  noEmployeesOk: boolean;
  /** Items left out: not a plain term, an organisation or a person's name, or already in the profile. */
  left: number;
};

export type SuggestContext = {
  profile: Profile;
  /** People's, teammates' and companies' names in the networks: never a suggestion. */
  names: string[];
};

/**
 * The model's reply, checked: exactly the expected fields, lists of plain
 * terms, nothing that names a person or an organisation. A wrong shape
 * rejects the whole reply; a wrong item is left out and counted.
 */
export function checkSuggestion(reply: unknown, ctx: SuggestContext): { suggestion: Suggestion } | { error: string } {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return { error: "not a JSON object" };
  const o = reply as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => !FIELDS.includes(k));
  if (extra.length) return { error: `unexpected field ${extra.map((k) => `"${k}"`).join(", ")}` };
  // roles and keywords: [{en, fi, sv}], each a string; industries: [string].
  const terms = (v: unknown) =>
    Array.isArray(v) && v.every((x) => x && typeof x === "object" && !Array.isArray(x) && Object.entries(x).every(([k, w]) => LANGS.includes(k) && typeof w === "string"));
  for (const l of ["roles", "keywords"]) if (!terms(o[l])) return { error: `"${l}" is not a list of {"en", "fi", "sv"} terms` };
  if (!Array.isArray(o.industries) || !o.industries.every((x) => typeof x === "string")) return { error: '"industries" is not a list of words' };
  if (o.noEmployeesOk !== undefined && typeof o.noEmployeesOk !== "boolean") return { error: '"noEmployeesOk" is not true or false' };
  // Each term in its three languages, in that order, so the form shows them together.
  const flat = (v: unknown) => (v as Record<string, string>[]).slice(0, MAX_ITEMS).flatMap((x) => LANGS.map((l) => x[l] ?? "").filter((w) => w.trim()));

  const names = new Set(ctx.names.map(key).filter(Boolean));
  let left = 0;
  const clean = (items: string[], have: string[]) => {
    const seen = new Set(have.map(key));
    const out: string[] = [];
    for (const raw of items) {
      const t = raw.replace(/\s+/g, " ").trim();
      const k = key(t);
      const plain = t.length >= 2 && t.length <= 40 && t.split(" ").length <= 4 && TERM.test(t) && !ORG_FORM.test(t);
      if (!plain || names.has(k) || seen.has(k)) {
        left++;
        continue;
      }
      seen.add(k);
      out.push(t);
    }
    return out;
  };
  const p = ctx.profile;
  const over = (v: unknown[]) => Math.max(0, v.length - MAX_ITEMS);
  left += over(o.roles as unknown[]) + over(o.keywords as unknown[]) + over(o.industries as unknown[]);
  const roles = clean(flat(o.roles), p.roles);
  const keywords = clean(flat(o.keywords), p.keywords).map((k) => k.toLowerCase());
  const haveCodes = new Set(p.industries.map((r) => r.code));
  const industries: Suggestion["industries"] = [];
  const industryKeywords: string[] = [];
  for (const m of mapIndustries(clean((o.industries as string[]).slice(0, MAX_ITEMS), []))) {
    if ("unmapped" in m) {
      if (!keywords.includes(m.input.toLowerCase()) && !p.keywords.includes(m.input.toLowerCase())) industryKeywords.push(m.input.toLowerCase());
    } else if (m.rules.some((r) => !haveCodes.has(r.code)) && !industries.some((x) => x.label === m.label)) {
      industries.push(m);
    }
  }
  return { suggestion: { roles, keywords, industries, industryKeywords, noEmployeesOk: o.noEmployeesOk === true, left } };
}

/** Asks the local model, once more if the reply has the wrong shape. Only the goal is sent. */
export async function suggestProfile(goal: string, ctx: SuggestContext, deps: ModelDeps = {}): Promise<{ suggestion: Suggestion } | { error: string }> {
  if (!goal.trim()) return { error: "Write your goal first." };
  let user = `Goal (their words): ${goal.trim()}`;
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ollamaChat(SUGGEST_SYSTEM, user, deps);
    if ("error" in r) return r;
    const obj = jsonObject(r.text);
    const checked = obj ? checkSuggestion(obj, ctx) : { error: "no JSON object in the answer" };
    if ("suggestion" in checked) return checked;
    last = checked.error;
    user = `${user}\n\nYour last answer was rejected (${last}). Return only the JSON object, with exactly the four fields in the shape given.`;
  }
  return { error: `The local model's answer was rejected: ${last}.` };
}
