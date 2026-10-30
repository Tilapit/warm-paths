// Optional help from a model on this machine, through Ollama: profile
// suggestions and, when no Anthropic key is set, the "Possible angle" and
// "Draft here" texts. Off unless OLLAMA_MODEL is set. Only an address on this
// machine is used; anything else is refused before a request is made. The
// requests go through node:http, which uses no proxy and follows no redirect.
// The model never sets fit, approach, score or order, and every reply is
// checked in code before it is shown.
import http from "node:http";
import dns from "node:dns/promises";
import { isIP, isIPv4 } from "node:net";

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export const ollamaModel = () => process.env.OLLAMA_MODEL?.trim() ?? "";
export const ollamaEnabled = () => !!ollamaModel();
const timeoutMs = () => Number(process.env.OLLAMA_TIMEOUT_MS) || 120_000;

const isLoopback = (ip: string) => (isIPv4(ip) ? ip.startsWith("127.") : ip === "::1");

export type LocalAddress = { url: URL; ip: string };

/**
 * The Ollama address, when it is on this machine: http to a loopback address
 * (127.x.x.x or ::1), or to localhost when every address it resolves to is
 * one. Requests then go to that address, so a later lookup cannot move them.
 */
export async function localAddress(raw = process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL): Promise<LocalAddress | { error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "OLLAMA_URL is not a URL." };
  }
  const refused = { error: `OLLAMA_URL points to ${url.host}, which is not this machine. Warm Paths only talks to a local model (e.g. ${DEFAULT_OLLAMA_URL}).` };
  if (url.protocol !== "http:") return { error: `OLLAMA_URL must start with http:// and point to this machine (e.g. ${DEFAULT_OLLAMA_URL}).` };
  if (url.username || url.password) return { error: "OLLAMA_URL must not hold a user name or password." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isLoopback(host) ? { url, ip: host } : refused;
  if (host.toLowerCase() !== "localhost") return refused;
  const found = await dns.lookup(host, { all: true }).catch(() => []);
  return found.length && found.every((a) => isLoopback(a.address)) ? { url, ip: found[0].address } : refused;
}

export type Reply = { status: number; text: string };
/** One request to the local model. Tests pass their own. */
export type Transport = (at: LocalAddress, method: "GET" | "POST", path: string, body: string | undefined, timeout: number) => Promise<Reply>;

const httpTransport: Transport = (at, method, path, body, timeout) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: at.ip,
        port: at.url.port || 80,
        path: at.url.pathname.replace(/\/$/, "") + path,
        method,
        headers: { host: at.url.host, ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) },
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`no answer in ${Math.round(timeout / 1000)} s`)));
    req.on("error", reject);
    req.end(body);
  });

export type ModelDeps = { transport?: Transport };

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One chat turn with thinking off and temperature 0. Returns the reply text,
 * or why there is none; never throws.
 */
export async function ollamaChat(system: string, user: string, deps: ModelDeps = {}): Promise<{ text: string } | { error: string }> {
  const model = ollamaModel();
  if (!model) return { error: "No OLLAMA_MODEL set." };
  const at = await localAddress();
  if ("error" in at) return at;
  const body = JSON.stringify({
    model,
    stream: false,
    think: false,
    keep_alive: "10m",
    options: { temperature: 0 },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  try {
    const r = await (deps.transport ?? httpTransport)(at, "POST", "/api/chat", body, timeoutMs());
    const j = (() => {
      try {
        return JSON.parse(r.text) as { message?: { content?: unknown }; error?: unknown };
      } catch {
        return null;
      }
    })();
    if (r.status !== 200) return { error: `The local model answered ${r.status}${typeof j?.error === "string" ? `: ${j.error}` : ""}.` };
    const text = j?.message?.content;
    return typeof text === "string" && text.trim() ? { text: text.trim() } : { error: "The local model sent an empty answer." };
  } catch (e) {
    return { error: `Could not reach the local model: ${why(e)}.` };
  }
}

/** The one JSON object in a reply, also inside a code fence or with a sentence around it; null when there is none. */
export function jsonObject(text: string): Record<string, unknown> | null {
  const s = text.replace(/```(?:json)?/g, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) return null;
  try {
    const v: unknown = JSON.parse(s.slice(a, b + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type OllamaStatus = { enabled: false } | { enabled: true; model: string; url: string; ok: boolean; installed?: boolean; error?: string };

/** For Settings: off, or the model, the address and whether it answers. Short timeout. */
export async function ollamaStatus(deps: ModelDeps = {}): Promise<OllamaStatus> {
  const model = ollamaModel();
  if (!model) return { enabled: false };
  const raw = process.env.OLLAMA_URL?.trim() || DEFAULT_OLLAMA_URL;
  const at = await localAddress(raw);
  if ("error" in at) return { enabled: true, model, url: raw, ok: false, error: at.error };
  try {
    const r = await (deps.transport ?? httpTransport)(at, "GET", "/api/tags", undefined, 2000);
    if (r.status !== 200) return { enabled: true, model, url: raw, ok: false, error: `Ollama answered ${r.status}.` };
    const names = ((JSON.parse(r.text) as { models?: { name?: string }[] }).models ?? []).map((m) => m.name ?? "");
    const installed = names.some((n) => n === model || n === `${model}:latest`);
    return { enabled: true, model, url: raw, ok: installed, installed, ...(installed ? {} : { error: `${model} is not installed: ollama pull ${model}` }) };
  } catch (e) {
    return { enabled: true, model, url: raw, ok: false, error: `Ollama does not answer: ${why(e)}.` };
  }
}
