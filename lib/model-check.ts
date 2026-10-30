// Checks on what the local model writes, before anyone sees it. A text may
// use only what it was given: a number, a link, a bracketed placeholder or a
// capitalised name (a person, a company, a place) that is not in the facts is
// rejected, and so is any mention of where a fact came from (lib/voice.ts).
// Pure: no model, no disk.
import { fold } from "./normalize.ts";
import { NEVER } from "./voice.ts";

/** The placeholders the app fills in itself after the reply. */
export const PLACEHOLDERS = ["[FIRST_NAME]", "[LAST_NAME]", "[SENDER]"];

// Capitalised words a message may use without a fact: greetings, "I", months and days.
const ALWAYS = new Set(
  "i im id ive ill linkedin hi hello hey dear thanks thank best regards cheers hei moi terve kiitos terveisin hej tack halsningar ok january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday".split(" "),
);

// The same place or language in English, Finnish and Swedish: one in the facts allows the others.
const SAME = [
  ["finland", "finnish", "suomi", "suome", "suomalai", "finsk"],
  ["sweden", "swedish", "ruotsi", "ruotsa", "sverige", "svensk"],
  ["helsinki", "helsingfors"],
];

// Things a message may say only when a fact says so: the facts mention a post
// only when the person reacted to one. Meetings, mutual friends and
// congratulations never come from the facts.
const CLAIMS: { re: RegExp; unless?: RegExp; what: string }[] = [
  { re: /\b(post|posts|postau\w*|julkaisu\w*|inlägg\w*)\b/i, unless: /\bpost\b/i, what: "a post" },
  { re: /\b(we met|met at|tapasimme|tapasin|vi träffades|träffade)\b/i, what: "a meeting" },
  { re: /\b(mutual|yhteinen tuttu\w*|yhteise\w* tutu\w*|gemensam\w*)\b/i, what: "a mutual contact" },
  { re: /\b(congrat\w*|onnittel\w*|onnea|grattis|gratulerar)\b/i, what: "congratulations" },
];

const words = (s: string) => fold(s).replace(/[’']/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * What `text` uses that `facts` does not have, as found in the text; empty
 * when it uses only the facts. A word inflected from a fact word ("Ventures"
 * → "Venturesilla") counts as the fact. A capitalised word that starts a
 * sentence is not checked: it may be any ordinary word.
 */
export function notInFacts(text: string, facts: string): string[] {
  const known = new Set(words(facts));
  for (const group of SAME) if ([...known].some((w) => group.some((g) => w.startsWith(g)))) for (const g of group) known.add(g);
  const knownList = [...known];
  const isKnown = (w: string) => known.has(w) || ALWAYS.has(w) || knownList.some((k) => k.length >= 3 && w.startsWith(k) && w.length - k.length <= 5);
  const out = new Set<string>();
  for (const m of text.matchAll(/\[[^\]\n]*\]/g)) if (!PLACEHOLDERS.includes(m[0])) out.add(m[0]);
  const plain = PLACEHOLDERS.reduce((s, p) => s.replaceAll(p, " "), text);
  const factsFolded = fold(facts);
  for (const m of plain.matchAll(/https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/gi)) if (!factsFolded.includes(fold(m[0]))) out.add(m[0]);
  for (const m of plain.matchAll(/\p{N}+/gu)) if (!known.has(m[0])) out.add(m[0]);
  for (const m of plain.matchAll(/[\p{L}][\p{L}’'-]*/gu)) {
    if (!/^\p{Lu}/u.test(m[0])) continue;
    const before = plain.slice(0, m.index);
    const prev = before.trimEnd();
    if (!prev || /\n\s*$/.test(before) || /[.!?:;"“”–—-]$/.test(prev)) continue; // starts a sentence or a line
    if (words(m[0]).some((w) => !isKnown(w))) out.add(m[0]);
  }
  return [...out];
}

export type TextCheck = { ok: true } | { ok: false; why: string };

/** A draft or an angle from the local model: facts only, nothing about sources, not too long. */
export function checkWritten(text: string, facts: string, maxChars: number): TextCheck {
  if (!text.trim()) return { ok: false, why: "it was empty" };
  if (text.length > maxChars) return { ok: false, why: `it was ${text.length} characters, over ${maxChars}` };
  const source = text.match(NEVER);
  if (source) return { ok: false, why: `it mentioned "${source[0]}", which a message never says` };
  for (const c of CLAIMS) if (c.re.test(text) && !(c.unless && c.unless.test(facts))) return { ok: false, why: `it mentioned ${c.what} ("${text.match(c.re)![0]}"), which the facts do not` };
  const extra = notInFacts(text, facts);
  if (extra.length) return { ok: false, why: `it used ${extra.map((x) => `"${x}"`).join(", ")}, not in the facts` };
  return { ok: true };
}
