# Warm Paths

> **About this version:** built in two days for Velho's challenge at the
> Aaltoes Prompt Operations Hackathon (Oct 2026), where it won first place.
> This is a generic version: Velho's own target profile, message voice,
> examples and data have been removed.

Who in your LinkedIn network could help with what you are looking for, and
why. You say what you want in your own words ("find people at VC funds, I'm
looking for an analyst role", "sell route planning to logistics companies",
"speakers for a robotics meetup"); Warm Paths ranks your connections for it,
by code, on your machine. Claude is the main way to use it: it reads your
profile, asks what you are looking for when it is empty, and writes the
messages.

## What it does

- **Your network, ranked for your goal.** Your LinkedIn Connections export
  (and your teammates', merged by profile URL, never by name). Company names
  are matched to the Finnish trade register (PRH) to get each company's line
  of business and whether it has employees. Each person gets a fit (strong,
  possible or none) against your profile: target roles, industries,
  organisation keywords, organisations to leave out.
- **This week.** Five people to reach, chosen by code: strong fits first,
  recent reactions and company changes first, nobody already contacted, one
  per company.
- **Follow-ups.** Tell Claude (or click) that you sent a message; a week
  without a reply puts the person under "Follow-up due".
- **Ask for an intro.** People at your target organisations who do not
  decide but can introduce you.
- **Reactions.** Paste who reacted to your LinkedIn post: people you know get
  a signal; people you don't are kept apart as "Engaged, not connected"
  (connection request suggested, deleted after 90 days).
- **Radar.** Finnish companies that match your profile and just registered a
  new managing director, new money, a merger or a board change. Warm rows
  first: someone you know works there.
- **Messages.** Short, one clear ask, facts only, never saying where a fact
  came from, in your tone and with your signature. Claude writes them; the
  app has templates for when there is no API key. Nothing is ever sent from
  the app.

Ranking, filtering and fit are plain TypeScript with unit tests, so the same
data always gives the same list and every reason can be traced. Claude only
reads results, writes text and, after you confirm, changes your profile or
records a status.

## 5-minute setup with demo data

```sh
git clone https://github.com/Tilapit/warm-paths.git
cd warm-paths
npm install
APP_TODAY=2026-10-24 npm run dev        # http://localhost:3100
```

Click **Load demo data**. The demo is three invented networks (You 1,500,
Co-founder 860, Board member 300) at real Finnish and international
companies, with an invented profile (`data/demo/profile.json`). It works
offline: PRH matches and the radar ship as snapshots. `APP_TODAY` freezes
"today" so the demo reads the same every time.

Then use your own data. Keep it in a folder outside the repo: an absolute
`DATA_DIR`, for example

```sh
DATA_DIR="$HOME/warm-paths-data" npm run dev
```

The default `data/` folder is gitignored, but it still sits inside a public
repo: one `git add -f`, a changed `.gitignore` or `git clean -x` (which
deletes ignored files) is enough to publish or lose it, and tools that pack
or index the whole folder pick it up. Outside the repo, git cannot see it at
all, and it survives a fresh clone. The networks, statuses, PRH cache and
your profile all go there. In `.env.local`, write the path out in full: `~`
is not expanded there.

1. LinkedIn → Settings → Data privacy → Get a copy of your data →
   Connections. LinkedIn emails a zip with `Connections.csv`.
2. Settings → Networks: import it (and each teammate's, with their name). A
   real network replaces the demo.
3. The app asks what you are looking for. Write it in your own words; the
   optional fields (roles, industries, keywords, the ask, tone, signature)
   can wait. Or tell Claude (below).
4. Company names are looked up in PRH in the background (about 0.5 s per
   name). Settings → PRH matches to check: names that did not match exactly
   wait for you to pick. Nothing is guessed.

Optional: `ANTHROPIC_API_KEY` in `.env.local` lets the app itself write the
"Possible angle" and "Draft here" texts. Without it, templates are used.

Your profile is saved in `config/profile.json` (or `DATA_DIR/profile.json`
when you run with another data folder, as above); `config/profile.json` is
gitignored. `docs/example-profile.md` shows one.

## Tell Claude what you're looking for

The skill (`claude/warm-paths/SKILL.md`) makes Claude start from your
profile. With an empty one, it asks:

> **You:** Who in my network should I talk to this week?
>
> **Claude:** *(get_profile: empty)* First, what are you looking for? A job,
> customers, investors, advice? Say it in your own words.
>
> **You:** Find people at VC funds. I'm looking for an analyst role.
>
> **Claude:** Here's a profile for that. Shall I save it?
> - Goal: "Find people at VC funds. I'm looking for an analyst role."
> - Roles: partner, principal, investment director, head of talent
> - Industries: venture capital
> - Keywords in the organisation's name: ventures, capital
> - The ask: 20 minutes of advice on getting into VC
> - Tone: friendly and direct, in English
>
> **You:** Yes. Sign as "– Alex".
>
> **Claude:** *(set_profile)* Saved. "Venture capital" maps to TOL 6431,
> 6499 and 6630 (funds, other financial services, fund management): check
> that fits. *(this_week)* Your five for this week: …
>
> **You:** Add angel investors.
>
> **Claude:** I'd add the role "angel investor" and the keyword "angels".
> OK? *(set_profile with `add`)* Done; the list follows the new profile.

You can change direction any time ("switch to selling to logistics
companies") and Claude proposes the new profile before saving it.

## Connecting to Claude

The app is an MCP server at `/api/mcp`. Tools: `get_profile`,
`set_profile`, `this_week`, `follow_ups`, `set_status`, `rank_industries`,
`find_people`, `people_for_theme`, `get_person`, `get_company`,
`get_radar`, `message_context`, `add_reactions`.

**Claude Code**

```sh
claude mcp add --transport http warm-paths http://localhost:3100/api/mcp
mkdir -p ~/.claude/skills && cp -r claude/warm-paths ~/.claude/skills/
```

**claude.ai and Claude Desktop** connect from Anthropic's cloud, so they need
a public URL and a token:

```sh
npm run skill:zip                       # dist/warm-paths-skill.zip: upload it under Skills
export MCP_TOKEN=$(openssl rand -hex 24)
npm run build
npm start                               # terminal 1: production server on 127.0.0.1:3100
npm run tunnel                          # terminal 2: Cloudflare quick tunnel; prints the URL and header
```

In claude.ai: Customize → Connectors → Add custom connector, the printed URL,
Authentication "No sign in", Request header `Authorization: Bearer <token>`.
With `MCP_TOKEN` set, only `/api/mcp` answers through the tunnel; every page
answers only on your machine.

## Privacy

- **Stays on your machine** (gitignored): your exports (`data/sources/`),
  PRH responses (`data/cache/`), statuses (`data/state.json`) and your
  profile.
- **Goes out:** only company names and business IDs, to PRH open data. With
  an API key, one person's role and company facts and your goal go to the
  Claude API; their name is replaced by a placeholder and put back locally,
  and your signature is added locally.
- **Never:** no scraping, no emails stored (the Email column is blanked on
  import), nothing sent to anyone from the app. People merge by profile URL
  only. Reactors you are not connected to are stored only as pasted and
  deleted after 90 days unless you set a status.
- **Deleting:** Settings → Delete my data, or one network at a time.
- **Not in git:** `npm install` sets up hooks (`npm run hooks`) that refuse
  a commit holding personal data, and a push when any commit in it does, even
  one a later commit cleaned up. CI checks the files on every push and every
  commit of a pull request. They look for a LinkedIn Connections header,
  email addresses in .csv, .json and .txt files, LinkedIn profile URLs, and
  any `profile.json` or `state.json`. Invented data is skipped: `data/demo/`,
  `tests/fixtures/` and `scripts/generate-mock-connections.mjs`. This is a
  backstop that catches common file shapes, not every piece of personal
  data: a name and title pasted into a note, a screenshot or a renamed
  export can get through. Keeping real data outside the repo
  (above) is what keeps it out. Run it yourself with
  `npm run check:personal-data`.

Sources: your LinkedIn Connections export (or LinkedIn's Member Data
Portability API with your own token, `npm run linkedin:sync`), and PRH YTJ
and registered notices open data (CC BY 4.0, https://avoindata.prh.fi).

## Develop

```sh
npm test            # node test runner, offline
npx tsc --noEmit
node scripts/fetch-signals.mjs          # refresh the radar (about 6 minutes)
```

`CLAUDE.md` has the product rules and a code map.
