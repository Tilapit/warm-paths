// How outreach messages read. The rules are the same for every user; the
// tone, the ask and the signature come from the user's profile. Signals
// choose who and when; a message never says where a fact came from.
// message_context hands this to Claude; without an API key the app writes
// the same shape from the templates below.
import type { Profile } from "./industry.ts";

export type MessageType = "direct" | "ask_intro" | "reaction_followup" | "follow_up" | "event_invite";
export const MESSAGE_TYPES = ["direct", "ask_intro", "reaction_followup", "follow_up", "event_invite"] as const satisfies readonly MessageType[];

export const MAX_CHARS = 500;

/** The rules every message follows, whatever the goal. */
export const MESSAGE_RULES = [
  "One person writing to someone they know: short, under 500 characters.",
  "Open with a greeting and their first name. A reaction to the sender's own post may be mentioned: they know they did it.",
  "One clear ask, the one in the profile (`ask`), and nothing else.",
  "Facts only: use only the facts given. Never invent a project, a mutual friend, headcount or revenue.",
  "Never mention where information came from: no trade register, PRH, registered notices, new capital, board or managing director changes, scores, fit, 'our analysis' or 'our data'. Signals decide who and when, never what the message says.",
  "Write in the user's tone (`tone`) and end with their signature (`signature`), when the profile has them. No hype, no apologies for asking.",
  "The sender sends it from their own LinkedIn. This app sends nothing.",
];

export type Voice = { rules: string[]; tone: string; ask: string; signature: string; goal: string };

/** The rules plus the user's tone, ask and signature, for Claude. */
export function voiceFor(profile: Profile): Voice {
  return { rules: MESSAGE_RULES, tone: profile.tone, ask: profile.ask, signature: profile.signature, goal: profile.goal };
}

/** Words a message must never contain: where facts came from, scores. English and Finnish. */
export const NEVER = /kaupparekister|trade register|\bPRH\b|\bYTJ\b|registered notice|kirjattiin|rekisteröi|osakeanti|share issue|new capital|uutta rahaa|hallitus(?:ta|een)? vaihtui|toimitusjohtaja vaihtui|fuusio|sulautu|\bmerger\b|pistee?t|\bscore\b|our analysis|our data|analyysimme|datamme/i;

export type TemplateInput = {
  type: MessageType;
  firstName: string;
  /** Short company name, or "" when unknown. */
  company: string;
  /** From the profile: "a 20-minute call". */
  ask?: string;
  signature?: string;
  /** reaction_followup: the post's label, when the team gave it one. */
  postTopic?: string;
  /** reaction_followup: the sender wrote the post ("my post"), else the team did. */
  ownPost?: boolean;
  /** event_invite: the event in a few words. */
  theme?: string;
};

/** The message without an API key, from these facts only. A starting point to edit. */
export function templateMessage(t: TemplateInput): string {
  const hi = `Hi ${t.firstName}!`;
  const how = t.company ? `How are things at ${t.company}?` : "How are things?";
  const ask = t.ask?.trim() || "a short call";
  const sign = t.signature?.trim() ? ` ${t.signature.trim()}` : "";
  if (t.type === "follow_up") return `${hi} Coming back to my earlier message. Would you have time for ${ask} at some point? Have a good week!${sign}`;
  if (t.type === "ask_intro") return `${hi} ${how} Who would be the right person there to talk to? I'd be grateful for an intro, for ${ask}.${sign}`;
  if (t.type === "event_invite") return `${hi} ${how} I'm getting a small group together around ${t.theme ?? "a shared topic"}. Would you like to join?${sign}`;
  if (t.type === "reaction_followup") {
    const post = t.ownPost ? "my post" : "our post";
    return `${hi} Thanks for reacting to ${post}${t.postTopic ? ` on ${t.postTopic}` : ""}. Would you have time for ${ask} in the next couple of weeks?${sign}`;
  }
  return `${hi} ${how} Would you have time for ${ask} in the next couple of weeks?${sign}`;
}

/** Problems with a message against the rules: forbidden words, length. Empty when it is fine. */
export function voiceProblems(text: string): string[] {
  const out: string[] = [];
  const m = text.match(NEVER);
  if (m) out.push(`Mentions "${m[0]}": never say where a fact came from.`);
  if (text.length > MAX_CHARS) out.push(`${text.length} characters; keep it under ${MAX_CHARS}.`);
  return out;
}
