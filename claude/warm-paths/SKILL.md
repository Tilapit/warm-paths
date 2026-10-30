---
name: warm-paths
description: Use when the user asks who in their LinkedIn network (or their team's) could help with something they are looking for (a job, investors, customers, advice, speakers, an intro), who to reach this week, who to follow up, who to invite to an event, what changed at a Finnish company, or wants a short outreach message, or pastes who reacted to a LinkedIn post, or says what they are looking for or that it changed. Works through the Warm Paths MCP connector.
---

# Warm Paths

The connector holds the user's LinkedIn connections (and teammates', if any),
matched to the Finnish trade register (PRH) and ranked by code against the
user's profile: what they are looking for, in their words. You pick filters
and write text; the user decides everything. Link each item's `url` when you
mention it.

## Start with the profile

1. Call `get_profile` first, every conversation.
2. If `empty` is true, or the goal does not match what the user is asking
   now, ask what they are looking for, in their words. Then propose a
   profile: goal (their sentence), target roles, industries (plain
   language), organisation keywords, organisations to leave out, the ask,
   tone (including language) and signature. Show it as a short list.
3. Call `set_profile` only after they confirm. Show the `industries` mapping
   it returns ("venture capital → TOL 6431, 6499, 6630") and ask them to
   check it; a phrase with no mapping is better as a keyword.
4. If `source` is `demo`, say it is the invented demo profile and offer to
   set theirs.

The user can change the profile any time in plain language: "add angel
investors", "drop the public sector", "switch to selling to logistics
companies". Use `add`/`remove` for small changes and replace fields for a
switch; confirm first, then show what changed. Ranking follows at once.

Example: "people at VC funds, I'm looking for an analyst role" → roles:
partner, principal, head of talent; industries: venture capital; keywords:
ventures, capital; ask: 20 minutes of advice.

## Which tool

| The user wants | Tool |
| --- | --- |
| Who to reach this week | `this_week`, then `follow_ups` |
| "I sent it", "they replied", "meeting booked", "not interested", "later" | `set_status`, after asking |
| Which industries hold the best way in | `rank_industries` |
| People by industry, role, town, fit, who knows them, a recent change | `find_people` |
| Who to invite to an event or theme | `people_for_theme` |
| One person, or one company before a meeting | `get_person`, `get_company` |
| Finnish companies with a new MD, new money, a merger, a new board | `get_radar` |
| A message | `message_context` first, always |
| Who reacted to a post | `add_reactions` |

## Workflows

**Weekly list.** `this_week` gives up to five people, chosen by code. For
each: the one-line `why` (for the user, never for the message), the
suggested sender and the link. Offer a draft each (`message_context`).
Mention `askForIntro` briefly and `engagedNotConnected` (people who reacted
but are not connected: suggest a connection request from whoever wrote the
post, nothing more). Then `follow_ups`.

**Follow-ups.** `sent` 7+ days ago, no reply: suggest a short follow-up
(`type: "follow_up"`) or ask how it went.

**After a message goes out.** Ask first: "Shall I mark <name> as sent?" Only
after a yes, call `set_status` with the status (`sent`, `replied`,
`meeting`, `not_fit`, or `snoozed` with `snooze_days`), `owner` and their
words as `note`. Never assume a draft was sent. `sent` is hidden from lists;
`replied`, `meeting` and `not_fit` never come back; a recent contact at a
company makes the others there rank lower (`cooldown`): say so.

**Ask for an intro.** Find who works at the target (`get_company`,
`find_people`) and draft with `type: "ask_intro"`.

**Event invites.** Map the theme to one to three industries, say which and
why, call `people_for_theme`, split into "invite" and "ask for an intro",
draft with `type: "event_invite"` and the theme.

**Reactions.** Pass a pasted list unchanged as `text`, or a screenshot as
`reactions` (name, headline, degree), with `post_label`, `post_date` and
`author`. Ask about each `review` item, then call again with `picks`.

**Radar.** `get_radar` with `known: "known"` first: who to talk to and who
knows them. Cold rows: suggest asking around.

## Messages

`message_context` returns `facts`, `rules`, `voice` (the user's tone, ask,
signature and goal), examples about made-up companies and a `template`.

- Short: under 500 characters, one person writing to someone they know.
- One clear ask: the profile's `ask`.
- Facts only: use only `facts`; never invent a project, a mutual friend,
  headcount or revenue.
- Never mention where anything came from: no trade register, PRH, notices,
  new capital, board or MD changes, scores, fit or "our analysis". Signals
  decide who and when, never what the message says. A reaction to the
  sender's own post may be mentioned: they know they did it.
- Written in the user's tone and language, ending with their signature.
- Say who sends it. You only draft; nothing is sent by you or the server.

## Privacy

- Data comes only from the users' own LinkedIn exports, PRH open data and
  their input. No scraping, no guessing emails, no looking people up.
- Reactors not in the network are kept only as pasted (name, headline,
  degree, the post) and deleted after 90 days unless a status is set.
- Do not repeat a person's details beyond what the task needs. If asked for
  something the tools lack (headcount, phone, email), say it is not there.
