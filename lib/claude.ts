// "Possible angle": one sentence, written by Claude from the facts in the
// analysis and the user's goal, only when ANTHROPIC_API_KEY is set. Claude
// gets the role and company facts of one person, never their name, and never
// changes the fit or the ranking. Without a key the template from
// lib/analysis.ts is used.
import Anthropic from "@anthropic-ai/sdk";
import type { Analysis } from "./analysis.ts";

export function claudeAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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

export async function writeAngle(a: Analysis, goal = ""): Promise<{ text: string; by: "claude" | "template"; error?: string }> {
  if (!claudeAvailable()) return { text: a.angle.text, by: "template" };
  const client = new Anthropic();
  try {
    const params = {
      model: ANGLE_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" as const },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You suggest one possible angle: why this person could help the user with their goal. " +
        "Write one sentence in English, under 35 words, from their role and company. " +
        "Use only the facts given. Do not invent numbers, systems, problems or events. Do not mention headcount or revenue. No buzzwords. Return only the sentence.",
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

export async function writeDraft(ctx: DraftContext, names: DraftNames): Promise<{ text: string; model: string } | { error: string }> {
  if (!claudeAvailable()) return { error: "No ANTHROPIC_API_KEY set. Use Write in Claude instead." };
  const client = new Anthropic();
  try {
    const params = {
      model: ANGLE_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" as const },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You draft one short LinkedIn message for the user. Follow the rules and the tone exactly and use only the facts given. " +
        "Write [FIRST_NAME] for the recipient's first name. Do not sign the message: the sender adds their own name. Return only the message text, no subject line, no quotes, no notes.",
      messages: [{ role: "user" as const, content: draftPrompt(ctx, names) }],
    };
    const msg = (await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0])) as Anthropic.Beta.BetaMessage;
    if (msg.stop_reason === "refusal") return { error: "Claude declined to write this one." };
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const parts = names.name.split(/\s+/);
    const back = (s: string) => s.replaceAll("[FIRST_NAME]", parts[0] ?? "").replaceAll("[LAST_NAME]", parts.slice(1).join(" ")).replaceAll("[SENDER]", names.sender);
    return text ? { text: back(text), model: msg.model } : { error: "Empty reply" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
