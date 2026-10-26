// Signal radar: PRH registered notices (trade register entries) that often mean
// a company is changing: a reason to get in touch now. Read from the docs at
// https://avoindata.prh.fi (OpenAPI: /opendata-registerednotices-api/v3/schema).
//
// GET /opendata-registerednotices-api/v3/?entryCode=<code>
//     &noticeRegistrationDateStart=<yyyy-mm-dd>&noticeRegistrationDateEnd=<yyyy-mm-dd>&page=<n>
// returns 50 companies per page, across all companies, each with its main line
// of business and the matching notices. So the radar needs no per-company
// requests: one pass per entry code over the last 90 days, filtered here.
//
// Company level only. Notices name no people in this API, and nothing about
// people outside the team's networks is stored.
import fs from "node:fs";
import path from "node:path";
import { cacheDir, politeGet, readCache, registersOf, writeCache } from "./prh.ts";
import { today } from "./normalize.ts";

const KREK = "https://avoindata.prh.fi/opendata-registerednotices-api/v3";

export type SignalType = "md_change" | "new_money" | "merger" | "board_change";

/** Entry codes from /description?code=EC. Weights are defaults; the radar sorts by them. */
export const SIGNAL_TYPES: Record<SignalType, { label: string; short: string; weight: number; codes: string[] }> = {
  md_change: { label: "Managing director changed", short: "New MD", weight: 3, codes: ["TOIM"] },
  new_money: { label: "New money: share issue or capital increase", short: "New money", weight: 3, codes: ["ANTIP", "KOROI", "OANTI", "OANKO"] },
  merger: { label: "Merger or demerger", short: "Merger", weight: 2, codes: ["SULLOP", "SULSUU", "JAKLOP", "JAKSUU"] },
  board_change: { label: "Board changed", short: "Board", weight: 2, codes: ["HAL"] },
};

/** A merger notice is a merger (SUL codes) or a demerger (JAK codes); the label says which when the codes do. */
export function signalLabel(s: Pick<CompanySignal, "type" | "entryCodes">): string {
  if (s.type !== "merger") return SIGNAL_TYPES[s.type].label;
  const sul = s.entryCodes.some((c) => c.startsWith("SUL"));
  const jak = s.entryCodes.some((c) => c.startsWith("JAK"));
  return sul && !jak ? "Merger" : jak && !sul ? "Demerger" : SIGNAL_TYPES.merger.label;
}

export type CompanySignal = {
  businessId: string;
  company: string;
  tol?: string;
  industry?: string;
  town?: string;
  /** When the company itself was registered. */
  registered?: string;
  /** In the Employer Register (YTJ registeredEntries); undefined in a radar fetched before it was kept. */
  employer?: boolean;
  type: SignalType;
  /** Date PRH registered the notice. */
  date: string;
  recordNumber: string;
  entryCodes: string[];
};

export type SignalSet = { fetchedAt: string; start: string; end: string; complete: boolean; pages: number; signals: CompanySignal[]; snapshot?: boolean };

// Bankruptcy, liquidation and restructuring are not a reason to get in touch.
const EXCLUDED_SITUATIONS = new Set(["KONK", "SELTILA", "SANE"]);
const EXCLUDED_CODES = new Set(["KONALK", "SELA", "SELAS", "SELM", "SELO", "POISTO"]);
// Housing and property companies change boards every spring; never an employer worth a signal.
const IGNORED_FORMS = new Set(["2", "10"]);

type Desc = { languageCode: string; description?: string };
const en = (d?: Desc[]) => d?.find((x) => x.languageCode === "3")?.description ?? d?.find((x) => x.languageCode === "1")?.description;

export const signalsFile = () => path.join(cacheDir(), "signals.json");

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Drops what the radar does not use (old addresses, registers other than VAT and employer) before caching. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compactPage(raw: any) {
  return {
    totalResults: raw?.totalResults ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    companies: (raw?.companies ?? []).map((c: any) => ({
      businessId: c.businessId,
      names: c.names,
      mainBusinessLine: c.mainBusinessLine,
      companyForms: c.companyForms,
      companySituations: c.companySituations,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addresses: (c.addresses ?? []).filter((a: any) => a.type === 1).slice(0, 1),
      publicNotices: c.publicNotices,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registeredEntries: (c.registeredEntries ?? []).filter((e: any) => e.register === "6" || e.register === "7").map((e: any) => ({ register: e.register, type: e.type, registrationDate: e.registrationDate, endDate: e.endDate })),
      status: c.status,
      tradeRegisterStatus: c.tradeRegisterStatus,
    })),
  };
}

/** Pure: one page of the notices API -> signals of one type. Exported for tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function signalsFromPage(type: SignalType, page: any, start: string, end: string): CompanySignal[] {
  const codes = new Set(SIGNAL_TYPES[type].codes);
  const out: CompanySignal[] = [];
  for (const c of page?.companies ?? []) {
    const businessId = c.businessId?.value;
    if (!businessId) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const form = (c.companyForms ?? []).find((f: any) => f.version === 1) ?? c.companyForms?.[0];
    if (IGNORED_FORMS.has(form?.type)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((c.companySituations ?? []).some((s: any) => !s.endDate && EXCLUDED_SITUATIONS.has(s.type))) continue;
    if (c.status === "5" || c.tradeRegisterStatus === "2" || c.tradeRegisterStatus === "4") continue;
    // A company founded in (or just before) the window: its "new managing
    // director" is the first registration, not a change.
    const registered: string | undefined = c.businessId?.registrationDate ?? c.registrationDate;
    if (registered && registered >= addDays(start, -30)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notices: any[] = c.publicNotices ?? [];
    if (notices.some((n) => (n.entryCodes ?? []).some((e: string) => EXCLUDED_CODES.has(e)))) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names: any[] = c.names ?? [];
    const name = (names.find((n) => n.type === "1" && n.version === 1 && !n.endDate) ?? names[0])?.name ?? "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addr = (c.addresses ?? []).find((a: any) => a.type === 1) ?? c.addresses?.[0];
    for (const n of notices) {
      const hit = (n.entryCodes ?? []).filter((e: string) => codes.has(e));
      if (!hit.length || !n.registrationDate || n.registrationDate < start || n.registrationDate > end) continue;
      out.push({
        businessId,
        company: name,
        tol: c.mainBusinessLine?.type,
        industry: en(c.mainBusinessLine?.descriptions),
        town: addr?.postOffices?.find((p: { languageCode: string }) => p.languageCode === "1")?.city ?? addr?.postOffices?.[0]?.city,
        registered,
        ...(Array.isArray(c.registeredEntries) ? { employer: registersOf(c.registeredEntries).employer } : {}),
        type,
        date: n.registrationDate,
        recordNumber: n.recordNumber,
        entryCodes: hit,
      });
    }
  }
  return out;
}

/**
 * Fetches every notice of the four signal types registered in the last `days`
 * days and writes data/cache/prh/signals.json. Each page is cached, so an
 * interrupted run resumes where it stopped.
 */
export async function refreshSignals(opts: { days?: number; end?: string; log?: (s: string) => void; maxPages?: number } = {}): Promise<SignalSet> {
  const end = opts.end ?? today();
  const start = addDays(end, -(opts.days ?? 90));
  const log = opts.log ?? (() => {});
  const all: CompanySignal[] = [];
  let pages = 0;
  let complete = true;
  for (const type of Object.keys(SIGNAL_TYPES) as SignalType[]) {
    for (const code of SIGNAL_TYPES[type].codes) {
      const base = `${KREK}/?entryCode=${code}&noticeRegistrationDateStart=${start}&noticeRegistrationDateEnd=${end}`;
      // v2: pages keep the register entries (Employer Register).
      const key = `${code}_${start}_${end}_v2`;
      const fetchPage = async (n: number) => {
        const cached = readCache<unknown>("notices", `${key}_p${n}`);
        if (cached) return cached;
        const raw = compactPage(await politeGet(n === 1 ? base : `${base}&page=${n}`));
        writeCache("notices", `${key}_p${n}`, raw);
        return raw;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first: any = await fetchPage(1);
      const total = Number(first?.totalResults ?? 0);
      const count = Math.min(Math.ceil(total / 50), opts.maxPages ?? Infinity);
      if (count < Math.ceil(total / 50)) complete = false;
      all.push(...signalsFromPage(type, first, start, end));
      pages++;
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, count - 1) }, (_, i) =>
          fetchPage(i + 2).then(
            (p) => signalsFromPage(type, p, start, end),
            (e) => {
              complete = false;
              log(`${code} page ${i + 2}: ${(e as Error).message}`);
              return [] as CompanySignal[];
            },
          ),
        ),
      );
      for (const r of rest) all.push(...r);
      pages += rest.length;
      log(`${code}: ${total} notices, ${count} pages`);
    }
  }
  // One row per company, type and record.
  const seen = new Set<string>();
  const signals = all
    .filter((s) => {
      const k = `${s.businessId}|${s.type}|${s.recordNumber}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const set: SignalSet = { fetchedAt: new Date().toISOString(), start, end, complete, pages, signals };
  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(signalsFile(), JSON.stringify(set));
  return set;
}

let memo: { file: string; mtime: number; set: SignalSet | null } | null = null;

const snapshotFile = () => path.join(process.env.DEMO_DIR || path.join(process.cwd(), "data", "demo"), "signals-snapshot.json");

/**
 * The last fetched signal set. Without one (a fresh clone), the snapshot
 * shipped in data/demo, which says when it was fetched. Null if neither exists.
 */
export function loadSignals(): SignalSet | null {
  for (const file of [signalsFile(), snapshotFile()]) {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (memo?.file === file && memo.mtime === mtime) return memo.set;
      const set = JSON.parse(fs.readFileSync(file, "utf8")) as SignalSet;
      memo = { file, mtime, set };
      return set;
    } catch {
      continue;
    }
  }
  return null;
}
