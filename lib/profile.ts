// The user's profile on disk. config/profile.json holds what the user set;
// DATA_DIR/profile.json, when there is one, overrides it for that data
// folder. Nothing is built in: with no file, the profile is empty and the app
// and the skill ask what the user is looking for. The demo has its own
// invented profile (data/demo/profile.json), used only while the demo
// networks are loaded and the user has not set one.
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./store.ts";
import { EMPTY_PROFILE, mapIndustries, normaliseProfile, profileIsEmpty, type IndustryMapping, type IndustryRule, type Profile } from "./industry.ts";

export type ProfileSource = "data" | "config" | "demo" | "empty";

const configFile = () => path.join(process.cwd(), "config", "profile.json");
const dataFile = () => path.join(dataDir(), "profile.json");
const demoFile = () => path.join(process.env.DEMO_DIR || path.join(process.cwd(), "data", "demo"), "profile.json");

function readFile(file: string): Profile | null {
  try {
    return normaliseProfile(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Where a save goes: the data folder's file when DATA_DIR is set or that file exists, else config/profile.json. */
export function profileFile(): string {
  return process.env.DATA_DIR || fs.existsSync(dataFile()) ? dataFile() : configFile();
}

/** What the user set, or the empty profile. Never the demo's. */
export function readProfile(): { profile: Profile; source: ProfileSource } {
  const d = readFile(dataFile());
  if (d) return { profile: d, source: "data" };
  const c = readFile(configFile());
  if (c) return { profile: c, source: "config" };
  return { profile: { ...EMPTY_PROFILE }, source: "empty" };
}

export function demoProfile(): Profile {
  return readFile(demoFile()) ?? { ...EMPTY_PROFILE };
}

/**
 * The profile the model uses. The demo's while only demo networks are
 * loaded and the user has said nothing.
 */
export function effectiveProfile(demo: boolean): { profile: Profile; source: ProfileSource } {
  const own = readProfile();
  if (!demo || !profileIsEmpty(own.profile)) return own;
  const d = demoProfile();
  if (profileIsEmpty(d)) return own;
  // Once the user changes the not-target list, theirs is the whole list.
  return { profile: { ...d, excluded: own.profile.excluded?.length ? own.profile.excluded : d.excluded }, source: "demo" };
}

export function profileSignature(): string {
  return [dataFile(), configFile()].map((f) => {
    try {
      return String(fs.statSync(f).mtimeMs);
    } catch {
      return "-";
    }
  }).join("/");
}

/** Saves the whole profile. Returns it as stored. */
export function writeProfile(p: Profile): Profile {
  const clean = normaliseProfile(p);
  const file = profileFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean, null, 2) + "\n");
  return clean;
}

/** Changes only the fields given; the rest stays. */
export function updateProfile(patch: Partial<Profile>): Profile {
  const cur = readProfile().profile;
  return writeProfile({ ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) });
}

/** A change in the user's words: fields replace, `add` and `remove` change lists. Industries may be plain language. */
export type ProfileInput = {
  goal?: string;
  roles?: string[];
  /** Plain language ("venture capital", "logistics") or TOL codes ("62", "10-33"). */
  industries?: string[];
  /** Exact TOL rules, as edited in Settings. Replaces the list. */
  industryRules?: IndustryRule[];
  keywords?: string[];
  /** Organisation names or business IDs, or both as stored. */
  excluded?: (string | { businessId?: string; name: string })[];
  ask?: string;
  tone?: string;
  signature?: string;
  requireEmployer?: boolean;
  add?: { roles?: string[]; industries?: string[]; keywords?: string[]; excluded?: string[] };
  remove?: { roles?: string[]; industries?: string[]; keywords?: string[]; excluded?: string[] };
  /** Start over from an empty profile before applying the rest. */
  clear?: boolean;
};

const ID = /^\d{7}-\d$/;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const org = (s: string | { businessId?: string; name: string }) =>
  typeof s !== "string" ? normaliseProfile({ excluded: [s] }).excluded![0] : ID.test(s.trim()) ? { businessId: s.trim(), name: s.trim() } : { name: s.trim() };

/**
 * Applies a change and saves it. Returns the profile as stored and how each
 * plain-language industry was read, so the user can check it.
 */
export function applyProfileInput(input: ProfileInput, base?: Profile): { profile: Profile; industries: IndustryMapping[] } {
  const cur = input.clear ? { ...EMPTY_PROFILE } : base ?? readProfile().profile;
  const next: Profile = { ...cur };
  const mapping: IndustryMapping[] = [];
  const rulesFor = (list: string[]) => {
    const m = mapIndustries(list.filter((s) => s.trim()));
    mapping.push(...m);
    return m.flatMap((x) => ("rules" in x ? x.rules : []));
  };
  const uniqRules = (rs: Profile["industries"]) => rs.filter((r, i) => rs.findIndex((x) => x.code === r.code) === i);
  for (const k of ["goal", "ask", "tone", "signature"] as const) if (typeof input[k] === "string") next[k] = input[k]!;
  if (typeof input.requireEmployer === "boolean") next.requireEmployer = input.requireEmployer;
  if (input.roles) next.roles = input.roles;
  if (input.keywords) next.keywords = input.keywords;
  if (input.industryRules) next.industries = normaliseProfile({ industries: input.industryRules }).industries;
  if (input.industries) next.industries = uniqRules(rulesFor(input.industries));
  if (input.excluded) next.excluded = input.excluded.filter((s) => (typeof s === "string" ? s.trim() : s?.name || s?.businessId)).map(org);
  const a = input.add ?? {};
  if (a.roles) next.roles = [...next.roles, ...a.roles.filter((r) => !next.roles.some((x) => same(x, r)))];
  if (a.keywords) next.keywords = [...next.keywords, ...a.keywords.filter((r) => !next.keywords.some((x) => same(x, r)))];
  if (a.industries) next.industries = uniqRules([...next.industries, ...rulesFor(a.industries)]);
  if (a.excluded) next.excluded = [...(next.excluded ?? []), ...a.excluded.filter((s) => s.trim() && !(next.excluded ?? []).some((x) => same(x.name, s) || x.businessId === s.trim())).map(org)];
  const r = input.remove ?? {};
  if (r.roles) next.roles = next.roles.filter((x) => !r.roles!.some((y) => same(x, y)));
  if (r.keywords) next.keywords = next.keywords.filter((x) => !r.keywords!.some((y) => same(x, y)));
  if (r.industries) {
    const codes = new Set(rulesFor(r.industries).map((x) => x.code));
    next.industries = next.industries.filter((x) => !codes.has(x.code) && !r.industries!.some((y) => same(x.label, y)));
  }
  if (r.excluded) next.excluded = (next.excluded ?? []).filter((x) => !r.excluded!.some((y) => same(x.name, y) || x.businessId === y.trim()));
  return { profile: writeProfile(next), industries: mapping };
}
