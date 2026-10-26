// MCP server: the user's (or team's) network as tools for their own Claude.
// Ranking and filtering are code in lib/queries.ts; Claude picks the arguments
// and writes the text. No tool sends anything to anyone. Every result item has
// a `url` into the web app.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadNetwork } from "./network.ts";
import { GROUPS, profileIsEmpty } from "./industry.ts";
import { applyProfileInput, readProfile } from "./profile.ts";
import { MESSAGE_TYPES } from "./voice.ts";
import { addReactions, appUrl, canIntroduce, engagedNotConnected, findPeople, followUps, getCompany, getPerson, getRadar, messageContext, peopleForTheme, rankIndustries, recordStatus, thisWeek } from "./queries.ts";
import type { SignalType } from "./signals.ts";

const SOURCES = "All data comes from the team's own LinkedIn Connections exports, the Finnish trade register (PRH open data, CC BY 4.0) and the team's own feedback in the app. Nothing is scraped and nothing is sent to anyone.";
// The one rule every recommendation follows, said the same way in each tool.
const RULE = "Team-wide statuses decide who is recommended: 'sent' is hidden (a follow-up is due after 7 days without a reply, see follow_ups), 'replied', 'meeting' and 'not_fit' are never recommended again, 'snoozed' is hidden until the snooze ends, and when anyone at a company was contacted in the last 30 days the others there rank lower and carry a 'cooldown' note.";
const INDUSTRIES = GROUPS.filter((g) => !g.grey).map((g) => `${g.id} (${g.label})`).join(", ");

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] });
const notFound = (what: string) => ({ content: [{ type: "text" as const, text: `${what} not found.` }], isError: true });

function log(tool: string, ids: string[] = []) {
  // Ids only, never names.
  console.log(`[mcp] ${new Date().toISOString()} ${tool}${ids.length ? ` ${ids.slice(0, 20).join(",")}` : ""}`);
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "warm-paths", version: "0.4.0" }, { instructions: `Warm Paths: who in the user's (or their team's) LinkedIn networks could help with what they are looking for, and why. Call get_profile first: the profile holds the user's goal in their own words, target roles, industries, organisation keywords, excluded organisations, the ask, tone and signature. If it is empty or unclear, ask the user what they are looking for, propose a profile, show it, and call set_profile only after they confirm. ${SOURCES} Ranking is deterministic code. Link to the 'url' of each item when you mention it. When the user says they sent a message or heard back, ask whether to record it, then call set_status.` });

  const profileShape = {
    goal: z.string().optional().describe("What the user is looking for, in their own words"),
    roles: z.array(z.string()).optional().describe("Target roles or titles, e.g. 'partner', 'head of talent', 'toimitusjohtaja'. Replaces the list."),
    industries: z.array(z.string()).optional().describe("Target industries in plain language ('venture capital', 'logistics') or TOL codes ('62', '10-33'). Replaces the list; mapped to TOL codes."),
    keywords: z.array(z.string()).optional().describe("Words in an organisation's name that make it a target whatever its industry, e.g. 'ventures', 'capital'. Replaces the list."),
    excluded: z.array(z.string()).optional().describe("Organisations that are not a target: names or Finnish business IDs. Replaces the list."),
    ask: z.string().optional().describe("What messages ask for: 'a 20-minute call', 'advice', 'an intro'"),
    tone: z.string().optional().describe("How messages read, including language: 'friendly and direct, in Finnish'"),
    signature: z.string().optional().describe("How messages end: '– Alex'"),
    require_employer: z.boolean().optional().describe("Hide Finnish companies with no employees registered (PRH Employer Register). On by default."),
    add: z.object({ roles: z.array(z.string()).optional(), industries: z.array(z.string()).optional(), keywords: z.array(z.string()).optional(), excluded: z.array(z.string()).optional() }).optional().describe("Add to lists without replacing them"),
    remove: z.object({ roles: z.array(z.string()).optional(), industries: z.array(z.string()).optional(), keywords: z.array(z.string()).optional(), excluded: z.array(z.string()).optional() }).optional().describe("Remove from lists"),
    clear: z.boolean().optional().describe("Start from an empty profile before applying the rest"),
  };

  server.registerTool(
    "get_profile",
    {
      title: "The user's profile",
      description: "What the user is looking for: goal (their words), target roles, industries (TOL rules), organisation keywords, excluded organisations, the ask, tone and signature, plus `empty` and where it is stored. Call this first. With an empty profile, every other tool still works but nothing is ranked as a fit.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const net = await loadNetwork();
      const own = readProfile();
      log("get_profile");
      return json({
        profile: net.profile,
        empty: profileIsEmpty(net.profile),
        source: net.profileSource ?? own.source,
        note: net.profileSource === "demo" ? "The invented demo profile, in use while only demo networks are loaded. set_profile saves the user's own." : undefined,
        url: appUrl("/settings#profile"),
      });
    },
  );

  server.registerTool(
    "set_profile",
    {
      title: "Change the profile",
      description: "Saves the user's profile. Partial: only the fields given change; `add` and `remove` change lists; `clear` starts over. Industries may be plain language and are mapped to TOL codes: the result's `industries` shows each mapping (or that a phrase had none; use a keyword then), so show it to the user. Call only after the user has confirmed the change. Ranking follows the new profile at once.",
      inputSchema: profileShape,
    },
    async (a) => {
      const { require_employer, ...rest } = a;
      const r = applyProfileInput({ ...rest, ...(typeof require_employer === "boolean" ? { requireEmployer: require_employer } : {}) });
      log("set_profile");
      return json({ ...r, url: appUrl("/settings#profile") });
    },
  );

  server.registerTool(
    "rank_industries",
    {
      title: "Rank industries by way in",
      description: `Per industry group (TOL-based): people, decision-makers, strong fits, fits known by two or more teammates, companies with a registered change (PRH, last 90 days), and the top 3 people. Sorted by score = 3 x strong + 1 x possible + 2 x known by two+ + 2 x companies with a signal. Optionally only one owner's network. ${SOURCES}`,
      inputSchema: { owner: z.string().optional().describe("Owner id or name, e.g. 'You' or 'Co-founder'. Omit for the whole team.") },
      annotations: { readOnlyHint: true },
    },
    async ({ owner }) => {
      const net = await loadNetwork();
      const rows = rankIndustries(net, { owner });
      log("rank_industries");
      return json({ industries: rows.map((r) => ({ ...r, url: appUrl("/") })) });
    },
  );

  server.registerTool(
    "this_week",
    {
      title: "This week",
      description: `The five people to reach this week, chosen by code (the same as the app's "This week"): strong fits always before possible ones; within them people with a registered change or a reaction in the last 30 days first; one per company, at most two per industry while it works, and never more than five shared out evenly over the suggested senders (two each for a team of three), even if the list is shorter. ${RULE} Each has a one-line why, the suggested sender and a url. Also engagedNotConnected: people who reacted to a team post but are in no one's network, ranked by fit; the only action is a connection request from whoever wrote the post. Also askForIntro: a smaller second group of people at target organisations who are not decision-makers but can introduce, with how many there are in all. Also says how many follow-ups are due: the weekly review is this_week plus follow_ups. ${SOURCES}`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const net = await loadNetwork();
      const picks = thisWeek(net);
      log("this_week", picks.map((p) => p.id));
      const intro = canIntroduce(net);
      log("this_week", intro.people.map((p) => p.id));
      const engaged = engagedNotConnected(net);
      return json({ people: picks.map(({ prompt, ...p }) => p), askForIntro: { total: intro.total, people: intro.people.map(({ prompt, ...p }) => p) }, engagedNotConnected: { ...engaged, note: "Reacted to a team post but in no one's network. Suggest a connection request from whoever wrote the post, never a message." }, followUpsDue: followUps(net).total });
    },
  );

  server.registerTool(
    "follow_ups",
    {
      title: "Follow-ups due",
      description: `People marked 'sent' at least 7 days ago with no reply recorded, oldest first, with who sent and when. Not new recommendations: a nudge to follow up, or to record how it went with set_status. Optionally only what one teammate sent. ${SOURCES}`,
      inputSchema: { owner: z.string().optional().describe("Owner id or name of who sent, e.g. 'You' or 'Co-founder'. Omit for the whole team.") },
      annotations: { readOnlyHint: true },
    },
    async ({ owner }) => {
      const r = followUps(await loadNetwork(), owner);
      log("follow_ups", r.people.map((p) => p.id));
      return json(r);
    },
  );

  server.registerTool(
    "set_status",
    {
      title: "Record what the team did",
      description: `Records a person's status, the same as the app's status buttons, with the time and the teammate: to_contact, sent (a message went out), replied, meeting, not_fit, or snoozed (hidden for snooze_days, default 90). ${RULE} Returns the new status and what it means. Call it only after the user says what happened, and ask before you do; never assume a message was sent. Nothing is sent to anyone.`,
      inputSchema: {
        person_id: z.string().describe("Person id from another tool"),
        status: z.enum(["to_contact", "sent", "replied", "meeting", "not_fit", "snoozed"]),
        owner: z.string().optional().describe("Who did it: owner id or name, e.g. 'You' or 'Co-founder'. Default: the suggested sender."),
        note: z.string().max(500).optional().describe("A short note in the user's words, kept in the app"),
        snooze_days: z.number().int().min(1).max(365).optional().describe("For 'snoozed': how many days. Default 90."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (a) => {
      const r = await recordStatus(await loadNetwork(), a);
      log("set_status", [a.person_id]);
      return "error" in r ? { content: [{ type: "text" as const, text: r.error! }], isError: true } : json(r);
    },
  );

  server.registerTool(
    "find_people",
    {
      title: "Find people",
      description: `People in the team's networks with fit (strong/possible), approach, reasons with their source, who knows them and the suggested sender (who connected first), registered changes at their company and status. By default only decision-makers who fit; pass roles or approach to widen. ${RULE} Pass include_contacted (or a status) to look up people the team already contacted, snoozed or ruled out. Industries: ${INDUSTRIES}. ${SOURCES}`,
      inputSchema: {
        industries: z.array(z.string()).optional().describe("Industry group ids or labels"),
        tol_prefixes: z.array(z.string()).optional().describe("TOL code prefixes, e.g. ['28', '2511']"),
        roles: z.array(z.string()).optional().describe("Title words, e.g. ['logistics', 'tuotantojohtaja']"),
        fit: z.enum(["strong", "possible", "any"]).optional(),
        known_by: z.string().optional().describe("Owner id or name"),
        has_signal: z.boolean().optional().describe("Only companies with a registered change in the last 90 days"),
        reacted: z.boolean().optional().describe("Only people who reacted to one of the team's posts in the last 30 days"),
        town: z.string().optional().describe("Company town in PRH, e.g. 'Tampere'"),
        approach: z.enum(["direct", "ask_intro", "skip"]).optional(),
        status: z.enum(["none", "to_contact", "sent", "replied", "meeting", "not_fit", "snoozed"]).optional(),
        include_contacted: z.boolean().optional().describe("Also people already contacted, snoozed or marked not a fit. Default false: for lookups, not recommendations."),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const r = findPeople(await loadNetwork(), args);
      log("find_people", r.people.map((p) => p.id));
      return json(r);
    },
  );

  server.registerTool(
    "people_for_theme",
    {
      title: "People for a theme or event",
      description: `For a theme, event or roundtable: people in the given industries with a per-person approach: 'invite' (decision-maker at a target company), 'ask_intro' (works at a target company but does not decide). You map the theme to industries; the tool does not guess. ${RULE} Industries: ${INDUSTRIES}. ${SOURCES}`,
      inputSchema: {
        theme: z.string().describe("The theme or event, in the user's words"),
        industries: z.array(z.string()).min(1).describe("Industry group ids or labels that fit the theme"),
        roles: z.array(z.string()).optional().describe("Optional title words to require for 'invite'"),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const r = peopleForTheme(await loadNetwork(), args);
      log("people_for_theme", r.people.map((p) => p.id));
      return json(r);
    },
  );

  server.registerTool(
    "get_person",
    {
      title: "Person analysis",
      description: `The full analysis of one person: title, PRH company facts, reasons (each with source and provenance: verified, imported, inferred), what we don't know (always headcount), fit and why, approach, who in the team knows them and since when, suggested sender, a template angle (inferred), score parts and status. ${SOURCES}`,
      inputSchema: { id: z.string().describe("Person id from another tool") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const p = getPerson(await loadNetwork(), id);
      log("get_person", [id]);
      return p ? json(p) : notFound(`Person ${id}`);
    },
  );

  server.registerTool(
    "get_company",
    {
      title: "Company brief",
      description: `One company: PRH facts (business ID, line of business, town, form, registration date), registered changes in the last 90 days, and everyone the team knows there with fit. Headcount is not in PRH. ${SOURCES}`,
      inputSchema: { business_id: z.string().optional().describe("Finnish business ID, e.g. 1234567-8"), name: z.string().optional().describe("Company name as people write it") },
      annotations: { readOnlyHint: true },
    },
    async (q) => {
      const net = await loadNetwork();
      const c = getCompany(net, q);
      if (!c && q.business_id) {
        const radar = getRadar(net, { limit: 500 }).rows.find((r) => r.businessId === q.business_id);
        if (radar) return json({ ...radar, people: [], note: "No one in the team's networks works here." });
      }
      log("get_company", c ? [c.id] : []);
      return c ? json(c) : notFound(`Company ${q.business_id ?? q.name}`);
    },
  );

  server.registerTool(
    "get_radar",
    {
      title: "Signal radar",
      description: `Target companies (by the profile) with a registered change in the trade register (PRH notices): md_change (managing director changed), new_money (share issue or capital increase), merger (merger or demerger), board_change. Warm rows first (someone in the team knows a person there, with links), then by score (type weight x recency). Company-level data only. ${SOURCES}`,
      inputSchema: {
        signal_types: z.array(z.enum(["md_change", "new_money", "merger", "board_change"])).optional(),
        industries: z.array(z.string()).optional().describe("Industry group ids or labels"),
        days: z.number().int().min(1).max(90).optional().describe("Only notices registered in the last N days"),
        known: z.enum(["known", "unknown"]).optional().describe("'known': someone in the team knows a person there"),
        owner: z.string().optional().describe("Only people known by this owner count as known"),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = getRadar(await loadNetwork(), { types: a.signal_types as SignalType[] | undefined, industries: a.industries, days: a.days, known: a.known, owner: a.owner, limit: a.limit ?? 25 });
      log("get_radar", r.rows.map((x) => x.businessId));
      return json(r);
    },
  );

  server.registerTool(
    "message_context",
    {
      title: "Facts for a message",
      description: `The facts a message to this person may use, the message rules, the user's tone, ask and signature from the profile (\`voice\`), an example and the app's own \`template\`. Types: direct (a decision-maker), ask_intro (a colleague who can introduce), reaction_followup (reacted to our post: thank them first), follow_up (sent 7+ days ago, no reply), event_invite. Omit type to get the one that fits now. A message reads like one person writing to someone they know and never says where a fact came from (no trade register, PRH, notices, capital, board changes or scores). You write it; the server never calls an LLM and never sends anything.`,
      inputSchema: {
        person_id: z.string(),
        type: z.enum(MESSAGE_TYPES).optional().describe("Omit for the type that fits this person now"),
        theme: z.string().optional().describe("For event_invite: the event or theme"),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = messageContext(await loadNetwork(), a);
      log("message_context", [a.person_id]);
      return r ? json(r) : notFound(`Person ${a.person_id}`);
    },
  );

  server.registerTool(
    "add_reactions",
    {
      title: "Add reactions to a post",
      description:
        "Stores who reacted to one of the team's LinkedIn posts, as a 'reacted' signal on each person. Give the reactions list as the user copied it from LinkedIn (`text`), or people you read from a screenshot the user shared (`reactions`, with headline and degree when visible), or plain `names`. The same parser and matcher as the app: a name with one match in the merged network is stored (inferred); ties are broken by the company in the headline and, with `author` (or `copied_by`), by the 1st/2nd degree marker; a degree marker that rules out the only same-name person leaves the name unmatched; the rest come back in `review` with candidates and are stored only when you pass `picks` after the user confirms. Names in `unmatched` are not in the networks: when stored they are kept apart as 'Engaged, not connected' (name, headline as copied, degree, post only; deleted after 90 days unless a status is set). Never scrape LinkedIn to get these.",
      inputSchema: {
        post_label: z.string().describe("A short label for the post"),
        post_date: z.string().optional().describe("The day the post went out, YYYY-MM-DD. Default today."),
        author: z.string().optional().describe("Whose post: owner id or name, e.g. 'You' or 'Co-founder'"),
        copied_by: z.string().optional().describe("Whose LinkedIn the list was copied or screenshotted from; the '1st'/'2nd' markers are relative to them. Default: the author."),
        text: z.string().max(200_000).optional().describe("The reactions list exactly as copied from LinkedIn"),
        reactions: z
          .array(z.object({ name: z.string(), headline: z.string().optional(), degree: z.enum(["1st", "2nd", "3rd"]).optional() }))
          .max(1000)
          .optional()
          .describe("People read from a screenshot"),
        names: z.array(z.string()).max(1000).optional().describe("Plain names, when nothing else is visible"),
        picks: z.array(z.object({ name: z.string(), person_id: z.string() })).max(200).optional().describe("For names in `review`: the person the user confirmed"),
        dry_run: z.boolean().optional().describe("Match only, store nothing"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (a) => {
      if (!a.text && !a.reactions?.length && !a.names?.length && !a.picks?.length) return { content: [{ type: "text" as const, text: "Give `text`, `reactions`, `names` or `picks`." }], isError: true };
      const r = addReactions(await loadNetwork(), { post: a.post_label, postDate: a.post_date, author: a.author, copiedBy: a.copied_by, text: a.text, entries: a.reactions, names: a.names, picks: a.picks, save: !a.dry_run });
      log("add_reactions", r.matched.map((m) => m.person.id));
      return json(r);
    },
  );

  return server;
}
