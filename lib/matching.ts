// Company names -> PRH companies. The model only ever reads the cache
// (offline), so a page never waits for PRH; a background job fills the cache
// and bumps `generation` so the next model load picks the new matches up.
import fs from "node:fs";
import path from "node:path";
import { getCompany, looseKey, matchCompany, PrhError, stats, type MatchStatus, type PrhCompany } from "./prh.ts";
import { hasForeignForm, knownInternational, looksForeign } from "./industry.ts";
import type { Override } from "./state.ts";
import { COLD_SECONDS_PER_NAME } from "./estimate.ts";

export type Resolved = {
  raw: string;
  /** looseKey of the name: overrides are stored under it. */
  key: string;
  status: MatchStatus;
  company?: PrhCompany;
  candidates: PrhCompany[];
  note: string;
  by: "rule" | "you";
  /** Not in PRH and the name looks international (company form or a known brand). */
  foreign: boolean;
  /** Answered by the demo snapshot because the cache has no answer yet. */
  snapshot?: boolean;
  /** The company's cache entry predates the register fields (Employer Register, VAT): fetched again when PRH is reachable. */
  stale?: boolean;
};

const memo = new Map<string, Resolved>();

type Snap = Record<string, { status: MatchStatus; note: string; company?: PrhCompany; candidates: PrhCompany[] }>;
let snapshot: Snap | null = null;
/** PRH decisions for the demo's company names (data/demo/prh-matches.json). */
function demoSnapshot(): Snap {
  if (snapshot) return snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(process.env.DEMO_DIR || path.join(process.cwd(), "data", "demo"), "prh-matches.json"), "utf8")) as Snap;
  } catch {
    snapshot = {};
  }
  return snapshot;
}

export function clearMatchMemo() {
  memo.clear();
}

export async function resolveName(raw: string, override?: Override, opts: { demo?: boolean } = {}): Promise<Resolved> {
  const key = looseKey(raw);
  if (override?.notFinnish) return { raw, key, status: "none", candidates: [], note: "You marked this as not a Finnish company", by: "you", foreign: true };
  if (override?.businessId) {
    const c = await getCompany(override.businessId, { offline: true });
    if (c) return { raw, key, status: "verified", company: c, candidates: [c], note: "You picked this company in PRH", by: "you", foreign: false, ...(c.registers ? {} : { stale: true }) };
  }
  const hit = memo.get(raw);
  if (hit && hit.status !== "pending") return hit;
  let m: { status: MatchStatus; note: string; company?: PrhCompany; candidates: PrhCompany[] } = await matchCompany(raw, { offline: true });
  // Demo networks fall back to the shipped snapshot, so the demo never waits for PRH.
  const snap = m.status === "pending" && opts.demo ? demoSnapshot()[raw] : undefined;
  if (snap) m = snap;
  // "Amazon" may be Amazon Oy in Espoo or Amazon in Seattle: an exact match on
  // a well-known international name is only a close match, and a close match is abroad.
  const intl = knownInternational(key);
  if (intl && m.status === "verified") m = { ...m, status: "inferred", note: "Same name as a well-known international company, so taken to be that one. If they work for the Finnish company, pick it in Settings." };
  const r: Resolved = {
    raw,
    key,
    status: m.status,
    company: m.company,
    candidates: m.candidates,
    note: m.note,
    by: "rule",
    // "Spotify AB" is the Swedish company even if a Finnish subsidiary is close.
    // An international name is the international company, even when a Finnish one has the same name ("Amazon Oy" in Espoo); the team can pick the Finnish one in Settings.
    foreign: ((m.status === "none" || m.status === "ambiguous") && looksForeign(raw, key)) || (m.status === "inferred" && (hasForeignForm(raw) || intl)),
    snapshot: !!snap,
    ...(m.company && !m.company.registers ? { stale: true } : {}),
  };
  if (!snap) memo.set(raw, r);
  return r;
}

/** A job item that is a business ID, not a company name. */
export const BY_ID = "businessId:";

export type MatchJob = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  requests: number;
  startedAt?: string;
  finishedAt?: string;
  seconds?: number;
  generation: number;
  lastError?: string;
  /** Failed lookups by reason ("HTTP 403", "not JSON", …), with up to five company names each. */
  failures: Record<string, { count: number; examples: string[] }>;
};

const G = globalThis as unknown as { __vnMatchJob?: MatchJob };

export function matchJob(): MatchJob {
  return (G.__vnMatchJob ??= { running: false, total: 0, done: 0, failed: 0, requests: 0, generation: 0, failures: {} });
}

/**
 * Looks the given names up in PRH in the background, in the order given
 * (callers put names with decision-makers first). Three workers; the PRH
 * client keeps at most three requests in flight and backs off on 429.
 */
export function startMatching(names: string[]): MatchJob {
  const job = matchJob();
  if (job.running || !names.length) return job;
  const t0 = Date.now();
  const r0 = stats.requests;
  Object.assign(job, { running: true, total: names.length, done: 0, failed: 0, requests: 0, startedAt: new Date().toISOString(), finishedAt: undefined, seconds: undefined, lastError: undefined, failures: {} });
  const queue = [...names];
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      try {
        // "businessId:…" refreshes a company the team picked by hand.
        if (n.startsWith(BY_ID)) await getCompany(n.slice(BY_ID.length));
        else await matchCompany(n);
        memo.delete(n);
      } catch (e) {
        job.failed++;
        job.lastError = e instanceof Error ? e.message : String(e);
        const reason = e instanceof PrhError ? e.reason : e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        const f = (job.failures[reason] ??= { count: 0, examples: [] });
        f.count++;
        if (f.examples.length < 5) f.examples.push(n);
      }
      job.done++;
      job.requests = stats.requests - r0;
      job.generation++;
    }
  };
  void Promise.all([worker(), worker(), worker()]).then(() => {
    job.running = false;
    job.finishedAt = new Date().toISOString();
    job.seconds = Math.round((Date.now() - t0) / 100) / 10;
    job.requests = stats.requests - r0;
    job.generation++;
  });
  return job;
}

/** The pace of a running or finished job once it has done 30 names, else the measured cold pace. */
export function secondsPerName(): number {
  const job = matchJob();
  const elapsed = job.running && job.startedAt ? (Date.now() - Date.parse(job.startedAt)) / 1000 : job.seconds;
  return elapsed && job.done >= 30 ? elapsed / job.done : COLD_SECONDS_PER_NAME;
}

/** How long the PRH lookups for these company names will take, from what is cached now. */
export async function lookupEstimate(names: string[], opts: { demo?: boolean } = {}): Promise<{ names: number; toLookUp: number; seconds: number }> {
  const uniq = [...new Set(names.filter(Boolean))];
  let toLookUp = 0;
  for (const n of uniq) {
    const r = await resolveName(n, undefined, opts);
    if (r.status === "pending" || r.snapshot) toLookUp++;
  }
  return { names: uniq.length, toLookUp, seconds: Math.round(toLookUp * secondsPerName()) };
}

/** Resolves when the running job (if any) has finished. For scripts and tests. */
export async function matchingDone(): Promise<MatchJob> {
  const job = matchJob();
  while (job.running) await new Promise((r) => setTimeout(r, 200));
  return job;
}
