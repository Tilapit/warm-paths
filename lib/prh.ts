// PRH open data (Finnish Patent and Registration Office), read from the docs
// at https://avoindata.prh.fi (OpenAPI: /opendata-ytj-api/v3/schema). One
// endpoint is used here: GET /opendata-ytj-api/v3/companies?name=<name>, and
// ?businessId=<id> when the founder picks a company by hand. Every response is
// stored in data/cache/prh, so a re-run never hits PRH again. At most three
// requests are in flight, with a pause between starts and back-off on 429.
// Registered notices (the signal radar) are in lib/signals.ts.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fold } from "./normalize.ts";
import { dataDir } from "./store.ts";

const YTJ = "https://avoindata.prh.fi/opendata-ytj-api/v3";
const GAP_MS = Number(process.env.PRH_GAP_MS || 250);

export function cacheDir(): string {
  return path.join(dataDir(), "cache", "prh");
}

export const ytjUrl = (businessId: string) => `https://tietopalvelu.ytj.fi/yritys/${businessId}`;

export type PrhCompany = {
  businessId: string;
  name: string;
  /** Current parallel and auxiliary names, and previous names. */
  otherNames: { name: string; kind: "parallel" | "auxiliary" | "previous" }[];
  formCode?: string;
  form?: string;
  /** TOL main line of business code, e.g. "28300". */
  tol?: string;
  industry?: string;
  industryFi?: string;
  registrationDate?: string;
  town?: string;
  website?: string;
  active: boolean;
  /** Restructuring, liquidation or bankruptcy codes (SANE, SELTILA, KONK). */
  situations: string[];
  /**
   * From YTJ's registeredEntries: in the Employer Register (register 7, a
   * company with regular employees) and the VAT register (6), with the date
   * each entry started. Undefined in a cache written before they were kept.
   */
  registers?: Registers;
};

export type Registers = { employer: boolean; employerSince?: string; vat: boolean; vatSince?: string };

/** Cache format. 2 keeps registeredEntries; an older search is re-fetched when PRH is reachable. */
export const CACHE_VERSION = 2;
export type PrhSearch = { query: string; fetchedAt: string; totalResults: number; companies: PrhCompany[]; v?: number };

// ---------- HTTP with a polite queue and a disk cache ----------

// A few requests in flight, starts spaced GAP_MS apart. PRH answers in about a
// second, so one at a time would make a cold 1,500-row import take 15 minutes.
const CONCURRENCY = Number(process.env.PRH_CONCURRENCY || 3);
let active = 0;
let nextStart = 0;
const waiting: (() => void)[] = [];
export const stats = { requests: 0, retries: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire() {
  if (active < CONCURRENCY) active++;
  else await new Promise<void>((r) => waiting.push(r));
  const now = Date.now();
  const at = Math.max(now, nextStart);
  nextStart = at + GAP_MS;
  if (at > now) await transport.sleep(at - now);
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/** A failed PRH request. `reason` is short and groups well in a summary: "HTTP 403", "not JSON", "network (ECONNRESET)". */
export class PrhError extends Error {
  reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

type Res = { status: number; ok: boolean; headers: { get(name: string): string | null }; text(): Promise<string> };
/** What politeGet talks to. Tests swap in a fake fetch and an instant sleep. */
export const transport = {
  // A request that hangs fails after 30 s and is retried like any network error.
  fetch: (url: string, init: { headers: Record<string, string> }): Promise<Res> => fetch(url, { ...init, signal: AbortSignal.timeout(Number(process.env.PRH_TIMEOUT_MS || 30_000)) }),
  sleep,
};

const TRIES = 5;
const brief = (body: string) => body.replace(/\s+/g, " ").trim().slice(0, 120);
const netCode = (e: unknown) => {
  const c = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  return c || (e instanceof Error ? e.message : String(e));
};

/**
 * GET with retries for what is temporary: 408, 429, any 5xx, a network error,
 * and a 200 whose body is not JSON (a maintenance or gateway page). Other 4xx
 * fail at once. Every failure is a PrhError with a reason.
 */
export async function politeGet(url: string): Promise<unknown> {
  await acquire();
  try {
    for (let attempt = 1; ; attempt++) {
      stats.requests++;
      let failure: PrhError;
      let retryAfter: string | null = null;
      try {
        const res = await transport.fetch(url, { headers: { accept: "application/json", "user-agent": "warm-paths (open source; github.com/Tilapit/warm-paths)" } });
        if (res.status === 404) return null;
        const body = await res.text();
        if (res.ok) {
          try {
            return JSON.parse(body);
          } catch {
            failure = new PrhError("not JSON", `PRH answered ${res.status} with a body that is not JSON: ${brief(body)}`);
          }
        } else {
          failure = new PrhError(`HTTP ${res.status}`, `PRH answered ${res.status}: ${brief(body)}`);
          if (res.status !== 408 && res.status !== 429 && res.status < 500) throw failure;
          retryAfter = res.headers.get("retry-after");
        }
      } catch (e) {
        if (e instanceof PrhError) throw e;
        failure = new PrhError(`network (${netCode(e)})`, `Could not reach PRH: ${netCode(e)}`);
      }
      if (attempt >= TRIES) {
        failure.message += ` (after ${attempt} tries)`;
        throw failure;
      }
      stats.retries++;
      const after = (Number(retryAfter) || 2 ** (attempt - 1) * 3) * 1000;
      nextStart = Math.max(nextStart, Date.now() + after);
      await transport.sleep(after);
    }
  } finally {
    release();
  }
}

export function readCache<T>(sub: string, key: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir(), sub, `${key}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeCache(sub: string, key: string, value: unknown) {
  const dir = path.join(cacheDir(), sub);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(value));
}

export const hash = (s: string) => crypto.createHash("sha1").update(s.toLowerCase()).digest("hex").slice(0, 16);

// ---------- YTJ company search ----------

type Desc = { languageCode: string; description?: string };
const en = (d?: Desc[]) => list<Desc>(d).find((x) => x.languageCode === "3")?.description ?? list<Desc>(d).find((x) => x.languageCode === "1")?.description;
const fi = (d?: Desc[]) => list<Desc>(d).find((x) => x.languageCode === "1")?.description;
/** A field PRH documents as a list; anything else counts as empty, so one odd company never fails a search. */
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : []);

// REK codes: 6 VAT liability, 7 Employer register. REK_KDI entry types: 7_41
// and 7_42 are "Registered", 6_80…6_V80 kinds of VAT liability, x_99 an
// incorrect line. An entry with an end date has ended.
type Entry = { register?: string; type?: string; registrationDate?: string | null; endDate?: string | null };
export function registersOf(entries: unknown, today = new Date().toISOString().slice(0, 10)): Registers {
  const live = list<Entry>(entries).filter((e) => e && (!e.endDate || e.endDate > today) && e.type !== "99");
  const since = (es: Entry[]) => es.map((e) => e.registrationDate ?? "").filter(Boolean).sort()[0] || undefined;
  const employer = live.filter((e) => e.register === "7" && (e.type === "41" || e.type === "42"));
  const vat = live.filter((e) => e.register === "6");
  return { employer: employer.length > 0, ...(employer.length && since(employer) ? { employerSince: since(employer) } : {}), vat: vat.length > 0, ...(vat.length && since(vat) ? { vatSince: since(vat) } : {}) };
}

/** Keeps only what the app uses, so the cache stays small. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compact(c: any): PrhCompany {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const names: any[] = list(c.names);
  const current = names.filter((n) => n.version === 1 && !n.endDate);
  const official = current.find((n) => n.type === "1") ?? names.find((n) => n.type === "1") ?? names[0];
  const otherNames: PrhCompany["otherNames"] = [];
  for (const n of names) {
    if (n === official) continue;
    const kind = n.version !== 1 || n.endDate ? "previous" : n.type === "2" ? "parallel" : "auxiliary";
    otherNames.push({ name: n.name, kind });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = list<any>(c.companyForms).find((f) => f.version === 1 && !f.endDate) ?? list<any>(c.companyForms)[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addr = list<any>(c.addresses).find((a) => a.type === 1) ?? list<any>(c.addresses)[0];
  return {
    businessId: c.businessId?.value,
    name: official?.name ?? "",
    otherNames,
    formCode: form?.type,
    form: en(form?.descriptions),
    tol: c.mainBusinessLine?.type,
    industry: en(c.mainBusinessLine?.descriptions),
    industryFi: fi(c.mainBusinessLine?.descriptions),
    registrationDate: c.registrationDate ?? undefined,
    town: list<{ languageCode: string; city?: string }>(addr?.postOffices).find((p) => p.languageCode === "1")?.city ?? list<{ city?: string }>(addr?.postOffices)[0]?.city,
    website: c.website?.url,
    // Registered and not ended. A pending registration has no registration date yet.
    active: !c.endDate && !!c.registrationDate && c.status !== "1" && c.status !== "5" && c.tradeRegisterStatus !== "2" && c.tradeRegisterStatus !== "4",
    situations: list<{ type: string; endDate?: string }>(c.companySituations).filter((s) => !s.endDate).map((s) => s.type),
    registers: registersOf(c.registeredEntries),
  };
}

/** One YTJ name search (first page, up to 100 results), cached. */
export async function searchYtj(query: string, opts: { offline?: boolean } = {}): Promise<PrhSearch | null> {
  const key = hash(query);
  const cached = readCache<PrhSearch>("ytj", key);
  // Offline, an older cache entry still answers; online it is fetched again for the new fields.
  if (cached && (opts.offline || cached.v === CACHE_VERSION)) return cached;
  if (opts.offline) return null;
  const raw = (await politeGet(`${YTJ}/companies?name=${encodeURIComponent(query)}`)) as { totalResults: number; companies: unknown[] } | null;
  const result: PrhSearch = { query, fetchedAt: new Date().toISOString(), totalResults: raw?.totalResults ?? 0, companies: list(raw?.companies).filter((c) => c && typeof c === "object").map(compact), v: CACHE_VERSION };
  writeCache("ytj", key, result);
  return result;
}

// ---------- Matching a LinkedIn company name to a PRH company ----------

export type MatchStatus = "verified" | "inferred" | "ambiguous" | "none" | "skipped" | "pending";

export type PrhMatch = {
  name: string;
  key: string;
  status: MatchStatus;
  company?: PrhCompany;
  candidates: PrhCompany[];
  note: string;
  queries: string[];
};

const NOT_A_COMPANY = /^(self[- ]?employed|freelancer?|freelance|stealth( mode| startup)?|open to work|retired|student|opiskelija|between jobs|confidential|various|n\/?a|none|-|private|independent( consultant)?|itsenäinen ammatinharjoittaja|yrittäjä)$/i;
const LEGAL = /(^|\s)(oyj|oy|ab|abp|ltd\.?|limited|plc|inc\.?|corp\.?|corporation|ky|ay|tmi|osakeyhtiö|aktiebolag)(?=\s|$|,)/gi;
// Company forms that are never an employer worth matching (housing companies, property companies).
const IGNORED_FORMS = new Set(["2", "10"]);

/** "Oy Sisu Auto Ab" -> "Sisu Auto": the search text PRH gets. */
export function searchText(name: string): string {
  return name
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(LEGAL, " ")
    .replace(/[,|]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FORMS = new Set(["oy", "oyj", "ab", "abp", "ky", "ay", "tmi", "ltd", "limited", "plc", "inc", "corp", "corporation", "osakeyhtio", "aktiebolag", "llc", "gmbh"]);

/** "Oy Sisu Auto Ab" -> "sisu auto". Legal forms are dropped only at either end. */
export function strictKey(name: string): string {
  const w = fold(name).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  while (w.length > 1 && FORMS.has(w[0])) w.shift();
  while (w.length > 1 && FORMS.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}

/** strictKey without a trailing "Group": "Sarlin Group Oy Ab" -> "sarlin". */
export function looseKey(name: string): string {
  const w = strictKey(name).split(" ");
  while (w.length > 1 && (w[w.length - 1] === "group" || FORMS.has(w[w.length - 1]))) w.pop();
  return w.join(" ");
}

function namesOf(c: PrhCompany) {
  const official = [c.name, ...c.otherNames.filter((n) => n.kind === "parallel").map((n) => n.name)];
  const other = c.otherNames.filter((n) => n.kind !== "parallel").map((n) => n.name);
  return { official, other };
}

const contains = (a: string, b: string) => b.length >= 4 && ` ${a} `.includes(` ${b} `);

/**
 * Pure matching rule, separated so tests can run it on recorded responses.
 * Exact normalised name = verified (strict first, so "Hydroline" does not
 * collide with its holding company "Hydroline Group"). One close candidate =
 * inferred. Several, or none = unmatched. Never guesses.
 */
export function decide(name: string, results: PrhSearch[]): Omit<PrhMatch, "queries"> {
  const strict = strictKey(name);
  const loose = looseKey(name);
  const key = loose;
  const seen = new Map<string, PrhCompany>();
  for (const r of results) for (const c of r.companies) if (c.businessId && c.active && c.registrationDate && !IGNORED_FORMS.has(c.formCode ?? "")) seen.set(c.businessId, c);
  const all = [...seen.values()];
  for (const [tier, k, fn] of [["strict", strict, strictKey], ["loose", loose, looseKey]] as const) {
    const exact = all.filter((c) => namesOf(c).official.some((n) => fn(n) === k));
    if (exact.length === 1) return { name, key, status: "verified", company: exact[0], candidates: exact, note: tier === "strict" ? "Exact name match in the trade register" : "Exact name match, apart from \"Group\"" };
    if (exact.length > 1) return { name, key, status: "ambiguous", candidates: exact, note: `${exact.length} registered companies have this name` };
  }
  const fuzzy = all.filter((c) => {
    const n = namesOf(c);
    return n.other.some((o) => looseKey(o) === loose) || n.official.map(looseKey).some((o) => contains(o, loose) || contains(loose, o));
  });
  if (fuzzy.length === 1) {
    const c = fuzzy[0];
    const why = namesOf(c).other.some((o) => looseKey(o) === loose) ? "matches an auxiliary or previous name" : "name is close, not identical";
    return { name, key, status: "inferred", company: c, candidates: fuzzy, note: `One candidate: ${why}. Check it.` };
  }
  if (fuzzy.length > 1) return { name, key, status: "ambiguous", candidates: fuzzy.slice(0, 12), note: `${fuzzy.length} possible companies. Pick the right one.` };
  const total = results.reduce((n, r) => Math.max(n, r.totalResults), 0);
  return { name, key, status: "none", candidates: [], note: total > 100 ? "Name too common to match without a business ID" : "No registered Finnish company with this name" };
}

/** One company by business ID (for a match the founder picks by hand), cached. */
export async function getCompany(businessId: string, opts: { offline?: boolean } = {}): Promise<PrhCompany | null> {
  const id = businessId.trim();
  if (!/^\d{7}-\d$/.test(id)) return null;
  const cached = readCache<PrhSearch>("ytj", hash(`businessId:${id}`));
  if (cached && (opts.offline || cached.v === CACHE_VERSION)) return cached.companies[0] ?? null;
  if (opts.offline) return null;
  const raw = (await politeGet(`${YTJ}/companies?businessId=${encodeURIComponent(id)}`)) as { totalResults: number; companies: unknown[] } | null;
  const result: PrhSearch = { query: `businessId:${id}`, fetchedAt: new Date().toISOString(), totalResults: raw?.totalResults ?? 0, companies: list(raw?.companies).filter((c) => c && typeof c === "object").map(compact), v: CACHE_VERSION };
  writeCache("ytj", hash(`businessId:${id}`), result);
  return result.companies[0] ?? null;
}

const GENERIC = /\s+(solutions|technologies|technology|finland|suomi|group|services|systems|company|industries|international|holding|nordic|europe|global|ltd|oy)$/i;

/** "RELEX Solutions" -> "RELEX", "Varjo Technologies Finland" -> "Varjo". */
export function coreName(base: string): string {
  let s = base.trim();
  while (GENERIC.test(s) && s.replace(GENERIC, "").trim().length >= 3) s = s.replace(GENERIC, "").trim();
  return s;
}

/** Looks a LinkedIn company name up in YTJ. Never guesses: see decide(). */
export async function matchCompany(name: string, opts: { offline?: boolean } = {}): Promise<PrhMatch> {
  const key = looseKey(name);
  const base = searchText(name);
  if (!key || !base || NOT_A_COMPANY.test(name.trim()) || base.length < 2) {
    return { name, key, status: "skipped", candidates: [], note: "Not a company name", queries: [] };
  }
  const queries = [base];
  const results: PrhSearch[] = [];
  const first = await searchYtj(base, opts);
  if (!first) return { name, key, status: "pending", candidates: [], note: "Not looked up in PRH yet", queries: [] };
  results.push(first);
  // A short or common name returns hundreds of hits in register order, so the
  // right company may not be on the first page. Narrow with the legal form.
  if (first.totalResults > 100) {
    for (const q of [`${base} Oy`, `Oy ${base}`, `${base} Oyj`, `${base} Ab`]) {
      const r = await searchYtj(q, opts);
      if (!r) {
        if (decide(name, results).status !== "verified") return { name, key, status: "pending", candidates: [], note: "Not looked up in PRH yet", queries };
        continue;
      }
      queries.push(q);
      results.push(r);
      if (decide(name, results).status === "verified") break;
    }
  }
  // "RELEX Solutions", "Varjo Technologies Finland": people add generic words
  // the register name may not have. Search again without them; anything found
  // this way can only be a close match (inferred), never verified.
  const core = coreName(base);
  if (core !== base && core.length >= 3 && decide(name, results).status === "none") {
    const r = await searchYtj(core, opts);
    if (!r) return { name, key, status: "pending", candidates: [], note: "Not looked up in PRH yet", queries };
    queries.push(core);
    const d = decide(core, [r]);
    if (d.status === "verified" || d.status === "inferred") {
      return { name, key, status: "inferred", company: d.company, candidates: d.candidates, note: `One candidate without "${base.slice(core.length).trim()}": check it.`, queries };
    }
    if (d.status === "ambiguous") return { ...d, name, key, queries };
  }
  return { ...decide(name, results), queries };
}
