// LinkedIn Member Data Portability API (EU DMA), Member Snapshot, the
// CONNECTIONS domain only: a member's first-degree connections, the same
// people as LinkedIn's Connections.csv. The token is the member's own
// self-serve token (scope r_dma_portability_self_serve), read from
// LINKEDIN_DMA_TOKEN. It is never printed, logged or stored, and nothing but
// CONNECTIONS is fetched. Emails are dropped before anything is stored.
// Docs: https://learn.microsoft.com/linkedin/dma/member-data-portability/shared/member-snapshot-api
import fs from "node:fs";
import path from "node:path";
import { sourcesDir } from "./store.ts";
import { isoDate } from "./normalize.ts";

export const DMA_URL = "https://api.linkedin.com/rest/memberSnapshotData";
/** The only version this endpoint accepts; any other fails with 426 NONEXISTENT_VERSION. */
export const DMA_VERSION = "202312";
const MAX_TRIES = 6;

export class DmaError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

type Row = Record<string, unknown>;
type Res = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<Res>;

/** Seconds or an HTTP date, as in Retry-After. */
function retryAfterMs(v: string | null): number | undefined {
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s)) return Math.min(120_000, Math.max(0, s * 1000));
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : Math.min(120_000, Math.max(0, t - Date.now()));
}

const brief = (body: string) => body.replace(/\s+/g, " ").slice(0, 200);

/**
 * Every page of the member's CONNECTIONS snapshot. `start` counts pages
 * (0, 1, 2, …); LinkedIn says there is no more data with "No data found for
 * this memberId", and its `total` is not reliable, so the loop runs until
 * that answer. 429 and 5xx are retried with Retry-After or a growing pause;
 * 401 stops at once.
 */
export async function fetchConnections(opts: { token: string; fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; maxPages?: number; onPage?: (page: number, rows: number) => void }): Promise<{ rows: Row[]; pages: number; retries: number }> {
  const get = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers = { Authorization: `Bearer ${opts.token}`, "Linkedin-Version": DMA_VERSION };
  const rows: Row[] = [];
  let retries = 0;
  let pages = 0;
  for (let start = 0; start < (opts.maxPages ?? 5000); start++) {
    const url = `${DMA_URL}?q=criteria&domain=CONNECTIONS&start=${start}`;
    let res: Res;
    let body: string;
    for (let attempt = 1; ; attempt++) {
      res = await get(url, { headers });
      body = await res.text();
      if (res.status !== 429 && res.status < 500) break;
      if (attempt >= MAX_TRIES) throw new DmaError(`LinkedIn kept answering ${res.status} on page ${start + 1}; stopped after ${attempt} tries. Try again later.`, res.status);
      retries++;
      await sleep(retryAfterMs(res.headers.get("retry-after")) ?? Math.min(60_000, 2000 * 2 ** (attempt - 1)));
    }
    if (res.status === 200) {
      let page: { elements?: { snapshotDomain?: string; snapshotData?: Row[] }[]; paging?: { links?: { rel?: string }[] } };
      try {
        page = JSON.parse(body);
      } catch {
        throw new DmaError(`LinkedIn's answer on page ${start + 1} was not JSON: ${brief(body)}`, 200);
      }
      const data = (page.elements ?? []).filter((e) => !e.snapshotDomain || e.snapshotDomain === "CONNECTIONS").flatMap((e) => e.snapshotData ?? []);
      rows.push(...data);
      pages++;
      opts.onPage?.(pages, data.length);
      // An empty page with no next link is the end too; never loop forever.
      if (!data.length && !page.paging?.links?.some((l) => l.rel === "next")) break;
      await sleep(250);
      continue;
    }
    if (res.status === 404 && /no data found/i.test(body)) {
      if (start === 0) throw new DmaError("LinkedIn has no CONNECTIONS snapshot for this member yet. It builds the snapshot after the token is created, which can take a while; try again later.", 404);
      break;
    }
    if (res.status === 401) throw new DmaError("LinkedIn rejected the token (401): it has expired or been revoked. Create a new one with LinkedIn's OAuth Token Generator (scope r_dma_portability_self_serve) and put it in .env.local as LINKEDIN_DMA_TOKEN.", 401);
    if (res.status === 403) throw new DmaError("LinkedIn refused access (403). The token's app needs the Member Data Portability API (Member) product and the r_dma_portability_self_serve scope, and the member must be in the EEA or Switzerland.", 403);
    if (res.status === 426) throw new DmaError(`LinkedIn refused the API version (426): this endpoint only accepts Linkedin-Version ${DMA_VERSION}.`, 426);
    throw new DmaError(`LinkedIn answered ${res.status} on page ${start + 1}: ${brief(body)}`, res.status);
  }
  return { rows, pages, retries };
}

// ---------- rows -> the Connections.csv model ----------

export type DmaConnection = { first: string; last: string; url: string; company: string; position: string; connectedOn: string };

// Keys as LinkedIn's CSV names them, plus spellings an API might use; compared folded.
const ALIASES: Record<keyof DmaConnection | "email", string[]> = {
  first: ["first name", "firstname"],
  last: ["last name", "lastname"],
  url: ["url", "profile url", "profileurl", "public profile url"],
  company: ["company", "company name", "companyname"],
  position: ["position", "title", "job title"],
  connectedOn: ["connected on", "connectedon", "connection date", "connectedat"],
  email: ["email address", "email", "emailaddress"],
};
const fold = (k: string) => k.toLowerCase().replace(/[^a-z]+/g, " ").trim();
const KEY_OF = new Map(Object.entries(ALIASES).flatMap(([field, names]) => names.map((n) => [fold(n), field as keyof DmaConnection | "email"] as const)));

const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v.trim() : String(v).trim());

/** "12 Apr 2024", an ISO date or epoch milliseconds; LinkedIn's own form is kept for the parser. */
function dateText(v: unknown): string {
  if (typeof v === "number" && v > 1e11) return new Date(v).toISOString().slice(0, 10);
  return text(v);
}

export type Coverage = {
  rows: number;
  /** Per field: rows with a value. */
  first: number;
  last: number;
  url: number;
  /** URLs that are LinkedIn profile URLs: the only way people merge. */
  profileUrl: number;
  company: number;
  position: number;
  connectedOn: number;
  /** Connected On values the app can read as a date. */
  connectedOnDates: number;
  /** Rows that had an email: never kept. */
  emailsDropped: number;
  /** Other keys LinkedIn sent (names only, no values). */
  otherKeys: string[];
};

export function toConnections(rows: Row[]): { connections: DmaConnection[]; coverage: Coverage } {
  const cov: Coverage = { rows: rows.length, first: 0, last: 0, url: 0, profileUrl: 0, company: 0, position: 0, connectedOn: 0, connectedOnDates: 0, emailsDropped: 0, otherKeys: [] };
  const other = new Set<string>();
  const connections = rows.map((r) => {
    const c: DmaConnection = { first: "", last: "", url: "", company: "", position: "", connectedOn: "" };
    for (const [k, v] of Object.entries(r)) {
      const field = KEY_OF.get(fold(k));
      if (!field) {
        other.add(k);
        continue;
      }
      if (field === "email") {
        if (text(v)) cov.emailsDropped++;
        continue;
      }
      if (!c[field]) c[field] = field === "connectedOn" ? dateText(v) : text(v);
    }
    for (const f of ["first", "last", "url", "company", "position", "connectedOn"] as const) if (c[f]) cov[f]++;
    if (/linkedin\.com\/in\//i.test(c.url)) cov.profileUrl++;
    if (isoDate(c.connectedOn)) cov.connectedOnDates++;
    return c;
  });
  cov.otherKeys = [...other].sort();
  return { connections, coverage: cov };
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The same columns as LinkedIn's Connections.csv, without the email. */
export function toCsv(connections: DmaConnection[]): string {
  const head = "First Name,Last Name,URL,Company,Position,Connected On";
  return [head, ...connections.map((c) => [c.first, c.last, c.url, c.company, c.position, c.connectedOn].map(csvCell).join(","))].join("\n") + "\n";
}

const pct = (n: number, of: number) => (of ? `${Math.round((1000 * n) / of) / 10}%` : "-");

/** Counts only, never a name or a value. */
export function coverageLines(c: Coverage): string[] {
  const row = (label: string, n: number, note = "") => `  ${label.padEnd(14)} ${n.toLocaleString("en-US").padStart(7)}  ${pct(n, c.rows).padStart(6)}${note}`;
  return [
    `${c.rows.toLocaleString("en-US")} connections came back. Fields with a value:`,
    row("First Name", c.first),
    row("Last Name", c.last),
    row("URL", c.url, c.url !== c.profileUrl ? `  (${c.profileUrl.toLocaleString("en-US")} are linkedin.com/in/ profile URLs)` : ""),
    row("Company", c.company),
    row("Position", c.position),
    row("Connected On", c.connectedOn, c.connectedOn !== c.connectedOnDates ? `  (${c.connectedOnDates.toLocaleString("en-US")} read as dates)` : ""),
    `  Emails: ${c.emailsDropped ? `${c.emailsDropped.toLocaleString("en-US")} rows had one; dropped, never stored` : "none came back"}.`,
    `  Other keys: ${c.otherKeys.length ? c.otherKeys.join(", ") : "none"}.`,
    ...(c.profileUrl < c.rows ? [`  Without a profile URL, ${(c.rows - c.profileUrl).toLocaleString("en-US")} people cannot merge with a teammate's network: they stay separate.`] : []),
  ];
}

// ---------- status for Settings ----------

export type SyncRecord = { at: string; owner: string; pages: number; coverage: Coverage };
const syncFile = () => path.join(sourcesDir(), "linkedin-sync.json");

/** What the last import into this data dir got: counts and field coverage, no names. */
export function saveSyncRecord(r: SyncRecord) {
  fs.mkdirSync(sourcesDir(), { recursive: true });
  fs.writeFileSync(syncFile(), JSON.stringify(r, null, 2));
}

export function dmaStatus(): { connected: boolean; expires?: string; lastSync?: SyncRecord } {
  const expires = isoDate(process.env.LINKEDIN_DMA_TOKEN_EXPIRES) || undefined;
  let lastSync: SyncRecord | undefined;
  try {
    lastSync = JSON.parse(fs.readFileSync(syncFile(), "utf8")) as SyncRecord;
  } catch {
    lastSync = undefined;
  }
  return { connected: !!process.env.LINKEDIN_DMA_TOKEN?.trim(), ...(expires ? { expires } : {}), ...(lastSync ? { lastSync } : {}) };
}
