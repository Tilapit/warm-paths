// "Possible angle": one sentence, written by Claude from the facts in the
// analysis and the user's goal, only when ANTHROPIC_API_KEY is set. Claude
// gets the role and company facts of one person, never their name, and never
// changes the fit or the ranking. Without a key, the local model writes it
// when OLLAMA_MODEL is set (lib/ollama.ts), checked against the facts
// (lib/model-check.ts); otherwise, or when its text fails the check, the
// template from lib/analysis.ts is used. "Draft here" works the same way.
import Anthropic from "@anthropic-ai/sdk";
import type { Analysis } from "./analysis.ts";
import { checkWritten } from "./model-check.ts";
import { ollamaChat, ollamaEnabled, ollamaModel, type ModelDeps } from "./ollama.ts";
import { MAX_CHARS } from "./voice.ts";

export function claudeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Who writes angles and drafts: Claude with a key, else the local model when set, else the templates. */
export type Writer = "claude" | "local" | "template";
export function writer(): Writer {
  return claudeAvailable() ? "claude" : ollamaEnabled() ? "local" : "template";
}

/** How a saved angle or a draft names its model: "ollama:<model>" for the local one. */
export const localModelId = () => `ollama:${ollamaModel()}`;

/**
 * Asks the local model, checks the text against the facts, and asks once
 * more with the reason when it fails. Returns the text or why there is none.
 */
async function writeLocal(system: string, user: string, facts: string, maxChars: number, deps: ModelDeps, tidy = (s: string) => s): Promise<{ text: string } | { error: string }> {
  let prompt = user;
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ollamaChat(system, prompt, deps);
    if ("error" in r) return r;
    const text = tidy(r.text.replace(/^["“]|["”]$/g, "").trim());
    const check = checkWritten(text, facts, maxChars);
    if (check.ok) return { text };
    why = check.why;
    prompt = `${user}\n\nYour last answer was rejected: ${why}. Write it again using only the facts given.`;
  }
  return { error: `The local model's text was not used: ${why}` };
}

export const ANGLE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/** The facts Claude may use. Exported so the UI can show exactly what was sent. */
export function angleFacts(a: Analysis, goal = ""): string {
  return [
    `The user's goal (their words): ${goal || "not set"}`,
    `Title (LinkedIn): ${a.title || "empty"}`,
    `Company (PRH): ${a.company.name}${a.company.industry ? `, ${a.company.industry}` : ""}${a.company.tol ? ` (TOL ${a.company.tol})` : ""}`,
    `Industry group: ${a.company.groupLabel}`,
    ...a.reasons.filter((r) => r.kind === "role" || r.kind === "signal").map((r) => `${r.label}: ${r.text}`),
    `Fit: ${a.fitLabel}. ${a.fitWhy}`,
    "Unknown: headcount, revenue, current systems.",
  ].join("\n");
}

const ANGLE_SYSTEM =
  "You suggest one possible angle: why this person could help the user with their goal. " +
  "Write one sentence in English, under 35 words, from their role and company. " +
  "Use only the facts given. Do not invent numbers, systems, problems or events. Do not mention headcount or revenue. No buzzwords. Return only the sentence.";

export async function writeAngle(a: Analysis, goal = "", deps: ModelDeps = {}): Promise<{ text: string; by: Writer; error?: string }> {
  const w = writer();
  if (w === "template") return { text: a.angle.text, by: "template" };
  if (w === "local") {
    const facts = angleFacts(a, goal);
    const r = await writeLocal(ANGLE_SYSTEM, facts, facts, 300, deps);
    return "text" in r ? { text: r.text, by: "local" } : { text: a.angle.text, by: "template", error: r.error };
  }
  const client = new Anthropic();
  try {
    const params = {
      model: ANGLE_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" as const },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: ANGLE_SYSTEM,
      messages: [{ role: "user" as const, content: angleFacts(a, goal) }],
    };
    // `fallbacks` re-runs a declined request on another model inside the same call.
    const msg = (await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0])) as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === "refusal") return { text: a.angle.text, by: "template", error: "Claude declined; showing the template" };
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return text ? { text, by: "claude" } : { text: a.angle.text, by: "template", error: "Empty reply" };
  } catch (e) {
    return { text: a.angle.text, by: "template", error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- "Draft here" ----------

type DraftContext = { type: string; facts: string[]; mustNotUse: string[]; rules: string[]; examples: string[]; voice?: { tone: string; ask: string } };
/** The names to keep on this machine: the person's, the sender's and the other teammates'. */
export type DraftNames = { name: string; sender: string; owners: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (w: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, flags);

/**
 * What a draft request sends: the message context with every name masked.
 * The person's first name becomes [FIRST_NAME], the rest of their name
 * [LAST_NAME] (also inside a company or title, e.g. a sole trader named after
 * them), the sender [SENDER] and other teammates "a teammate". The server
 * puts the names back into the reply, so no name leaves this machine.
 */
export function draftPrompt(ctx: DraftContext, n: DraftNames): string {
  const parts = n.name.split(/\s+/).filter((w) => w.length > 1);
  const mask = (line: string) => {
    let s = line;
    for (const o of [...n.owners].sort((a, b) => b.length - a.length)) if (o.trim()) s = s.replace(word(o, "gu"), o === n.sender ? "[SENDER]" : "a teammate");
    parts.forEach((w, i) => (s = s.replace(word(w, "giu"), i === 0 ? "[FIRST_NAME]" : "[LAST_NAME]")));
    return s;
  };
  const facts = ctx.facts.map((f) => (f.startsWith("Name: ") ? "Name: [FIRST_NAME] [LAST_NAME] (write [FIRST_NAME] where their first name goes)" : mask(f)));
  return [
    `Message type: ${ctx.type}`,
    "Facts (use only these):",
    ...facts.map((f) => `- ${f}`),
    "Do not use:",
    ...ctx.mustNotUse.map((f) => `- ${mask(f)}`),
    "Rules:",
    ...ctx.rules.map((f) => `- ${f}`),
    ...(ctx.voice?.tone ? [`Tone (the user's words): ${ctx.voice.tone}`] : []),
    ...(ctx.voice?.ask ? [`The ask: ${ctx.voice.ask}`] : []),
    "Examples about made-up companies (for style only, never for facts):",
    ...ctx.examples.map((f) => `- ${f}`),
  ].join("\n");
}

const DRAFT_SYSTEM =
  "You draft one short LinkedIn message for the user. Follow the rules and the tone exactly and use only the facts given. " +
  "Write [FIRST_NAME] for the recipient's first name. Do not sign the message: the sender adds their own name. Return only the message text, no subject line, no quotes, no notes.";

/**
 * What a local draft may use: the facts, the ask and the tone, names masked
 * as in the prompt. Not the examples: they are about made-up companies, for
 * style only.
 */
export function draftFacts(ctx: DraftContext, n: DraftNames): string {
  return draftPrompt({ ...ctx, examples: [], mustNotUse: [], rules: [] }, n);
}

/** A sign-off the local model added anyway ("Best,\n[SENDER]"): the app adds the user's signature itself. */
export const dropSignOff = (s: string) => s.replace(/(?:\n+|(?<=[.!?…]))\s*(?:[\p{L} ]{1,30}[,!]?\s*)?[-–—]*\s*\[SENDER\]\s*$/u, "").trim();

// The local model is smaller than Claude: the rules it most often breaks, said once more.
const LOCAL_DRAFT_SYSTEM = `${DRAFT_SYSTEM} Do not claim anything the facts do not say: no post you saw, no meeting, no mutual contact, no congratulations. Do not end with a sign-off or a name.`;

export async function writeDraft(ctx: DraftContext, names: DraftNames, deps: ModelDeps = {}): Promise<{ text: string; model: string } | { error: string }> {
  const parts = names.name.split(/\s+/);
  const back = (s: string) => s.replaceAll("[FIRST_NAME]", parts[0] ?? "").replaceAll("[LAST_NAME]", parts.slice(1).join(" ")).replaceAll("[SENDER]", names.sender);
  const w = writer();
  if (w === "template") return { error: "No ANTHROPIC_API_KEY or OLLAMA_MODEL set. Use Write in Claude instead." };
  if (w === "local") {
    const r = await writeLocal(LOCAL_DRAFT_SYSTEM, draftPrompt(ctx, names), draftFacts(ctx, names), MAX_CHARS, deps, dropSignOff);
    return "text" in r ? { text: back(r.text), model: localModelId() } : r;
  }
  const client = new Anthropic();
  try {
    const params = {
      model: ANGLE_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" as const },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: DRAFT_SYSTEM,
      messages: [{ role: "user" as const, content: draftPrompt(ctx, names) }],
    };
    const msg = (await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0])) as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === "refusal") return { error: "Claude declined to write this one." };
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return text ? { text: back(text), model: msg.model } : { error: "Empty reply" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
