// Finds files that look like personal data: a LinkedIn Connections export, an
// email address, a LinkedIn profile URL, or a profile or state file. A
// backstop for commits and CI, not a full detector. Pure: no git, no disk.
//
// Every pattern is written with escapes (\x20, \x40, \.) so this file never
// matches itself. Excerpts are masked, because CI logs are public.

export type Rule = "connections-header" | "email" | "linkedin-url" | "data-file";
export type FileInput = { path: string; content: string | Uint8Array };
/** line is 1-based; 0 means the whole file (a rule on the name). */
export type Hit = { path: string; line: number; rule: Rule; excerpt: string };

/** Invented data that is meant to be committed. */
export const EXCLUDED = ["data/demo/", "tests/fixtures/"];

const DATA_FILES = new Set(["profile.json", "state.json"]);
const EMAIL_FILES = /\.(csv|json|txt)$/i;
// Cells that together make the Connections header, in any order.
const HEADER_CELLS = ["first\x20name", "last\x20name", "connected\x20on"];
const KNOWN_CELLS = new Set([...HEADER_CELLS, "url", "email\x20address", "company", "position"]);
const EMAIL = /[A-Za-z0-9._%+-]+\x40(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}/g;
const RESERVED_DOMAIN = /(?:^|\.)example\.(?:com|org|net)$|\.(?:invalid|test)$/i;
const PROFILE_URL = /linkedin\.com\/in\/[\p{L}\p{N}%_-]+/giu;

const posix = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

export const isExcluded = (p: string) => EXCLUDED.some((dir) => posix(p).startsWith(dir));

/** a*** for a word; keeps nothing past its first character. */
const maskWord = (s: string) => (s ? `${[...s][0]}***` : "");

/** The first letter of the name and of the domain, and the top-level domain: a***@d***.fi */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("\x40");
  const labels = domain.split(".");
  return `${maskWord(local)}\x40${maskWord(labels[0])}.${labels[labels.length - 1]}`;
}

/** The first letter of the profile name: .../in/<name> -> .../in/n*** */
export function maskProfileUrl(url: string): string {
  const i = url.toLowerCase().indexOf("/in/") + 4;
  return url.slice(0, i) + maskWord(url.slice(i));
}

const cells = (line: string) =>
  line.replace(/^﻿/, "").replace(/"/g, "").toLowerCase().split(/[,;\t]/).map((c) => c.trim());

function isHeader(line: string): boolean {
  const c = cells(line);
  return HEADER_CELLS.every((h) => c.includes(h));
}

/** The header with any column LinkedIn does not use masked. */
const maskHeader = (line: string) => cells(line).map((c) => (KNOWN_CELLS.has(c) ? c : maskWord(c))).join(",");

const isBinary = (b: Uint8Array) => b.subarray(0, 8000).includes(0);

/** Text, or null for a binary file. UTF-16 (Excel's "Unicode text") is decoded. */
function asText(content: string | Uint8Array): string | null {
  if (typeof content === "string") return content;
  if (content[0] === 0xff && content[1] === 0xfe) return new TextDecoder("utf-16le").decode(content);
  if (content[0] === 0xfe && content[1] === 0xff) return new TextDecoder("utf-16be").decode(content);
  return isBinary(content) ? null : new TextDecoder().decode(content);
}

export function findPersonalData(files: FileInput[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const p = posix(file.path);
    if (isExcluded(p)) continue;
    const name = p.slice(p.lastIndexOf("/") + 1);
    if (DATA_FILES.has(name.toLowerCase())) hits.push({ path: p, line: 0, rule: "data-file", excerpt: name });
    const text = asText(file.content);
    if (text === null) continue;
    const emails = EMAIL_FILES.test(name);
    text.split("\n").forEach((raw, i) => {
      const line = raw.replace(/\r$/, "");
      if (isHeader(line)) hits.push({ path: p, line: i + 1, rule: "connections-header", excerpt: maskHeader(line).slice(0, 120) });
      if (emails)
        for (const [m] of line.matchAll(EMAIL))
          if (!RESERVED_DOMAIN.test(m.slice(m.indexOf("\x40") + 1))) hits.push({ path: p, line: i + 1, rule: "email", excerpt: maskEmail(m) });
      for (const [m] of line.matchAll(PROFILE_URL)) hits.push({ path: p, line: i + 1, rule: "linkedin-url", excerpt: maskProfileUrl(m) });
    });
  }
  return hits;
}
