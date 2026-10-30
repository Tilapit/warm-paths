import { ensureMatching, loadNetwork } from "@/lib/network.ts";
import { matchJob } from "@/lib/matching.ts";
import { ENGAGED_DAYS, listPosts, readState } from "@/lib/state.ts";
import { appUrl } from "@/lib/queries.ts";
import { mcpToken } from "@/lib/access.ts";
import { fmtDate } from "@/lib/analysis.ts";
import { DemoButton, UploadForm } from "@/components/FirstRun";
import { DeleteAll, DeleteEngaged, DeleteOwner, MatchReview, ProfileEditor, type Review } from "@/components/SettingsParts";
import { MatchProgress } from "@/components/MatchProgress";
import { ReactionsPanel } from "@/components/ReactionsPanel";
import { dmaStatus } from "@/lib/linkedin-dma.ts";
import { ollamaModel, ollamaStatus } from "@/lib/ollama.ts";
import { claudeAvailable } from "@/lib/claude.ts";

export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const { owner } = await searchParams;
  const net = await loadNetwork();
  ensureMatching(net);
  const state = readState();
  // Names that need a look: one close candidate, several, or a Finnish-looking name with no match.
  const byKey = new Map<string, Review>();
  const people = new Map<string, { n: number; dms: number }>();
  for (const c of net.contacts) {
    if (!c.company) continue;
    const p = people.get(c.company) ?? { n: 0, dms: 0 };
    p.n++;
    if (c.role.decisionMaker) p.dms++;
    people.set(c.company, p);
  }
  for (const r of net.names.values()) {
    const picked = state.overrides[r.key];
    const look = picked ? true : r.status === "inferred" ? !r.foreign : r.status === "ambiguous" ? !r.foreign : r.status === "none" ? !r.foreign && r.by === "rule" : false;
    if (!look) continue;
    const p = people.get(r.raw) ?? { n: 0, dms: 0 };
    const it = byKey.get(r.key) ?? {
      name: r.raw,
      names: [],
      status: picked ? "picked" : r.status,
      note: picked ? (picked.notFinnish ? "You marked it as not Finnish" : `You picked ${r.company?.name ?? picked.businessId}`) : r.note,
      people: 0,
      dms: 0,
      candidates: r.candidates.slice(0, 6).map((c) => ({ businessId: c.businessId, name: c.name, industry: c.industry, tol: c.tol, town: c.town })),
      pick: picked?.businessId,
    };
    it.names.push(r.raw);
    it.people += p.n;
    it.dms += p.dms;
    byKey.set(r.key, it);
  }
  const reviews = [...byKey.values()].sort((a, b) => (a.status === "picked" ? 1 : 0) - (b.status === "picked" ? 1 : 0) || b.dms - a.dms || b.people - a.people);
  const needLook = reviews.filter((r) => r.status !== "picked");
  const s = net.stats;
  const job = matchJob();
  const token = !!mcpToken();
  // Whether a LinkedIn token is set; the token itself never leaves the server.
  const dma = dmaStatus();
  // Whether a local model is set and answers. Asked only when OLLAMA_MODEL is set.
  const local = await ollamaStatus();
  const pct = (n: number, of: number) => `${of ? Math.round((100 * n) / of) : 0}%`;
  return (
    <>
      <MatchProgress initial={{ ...job }} />
      <main className="page" style={{ maxWidth: 1000 }}>
        <h1>Settings</h1>
        <p className="lede">Networks, your profile, PRH matches to check, export and the Claude connector. Everything here stays on this machine.</p>

        <section className="section" id="networks">
          <h2>Networks</h2>
          <p className="small muted" style={{ marginBottom: 10 }}>
            One LinkedIn Connections.csv per teammate. People are merged by profile URL only, never by name.
          </p>
          {net.owners.length ? (
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>File</th>
                    <th className="num">Rows</th>
                    <th className="num">Imported</th>
                    <th className="num">Skipped</th>
                    <th className="num">No company</th>
                    <th className="num">No profile URL</th>
                    <th>Imported</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {net.owners.map((o) => (
                    <tr key={o.id}>
                      <td>
                        {o.name}
                        {o.demo ? <span className="pill amber" style={{ marginLeft: 6 }}>invented people</span> : null}
                      </td>
                      <td className="small muted">{o.original}</td>
                      <td className="num">{o.rows.toLocaleString("en-US")}</td>
                      <td className="num">{o.accepted.toLocaleString("en-US")}</td>
                      <td className="num">{o.skipped}</td>
                      <td className="num">{o.noCompany}</td>
                      <td className="num">{o.noUrl}</td>
                      <td className="small">{fmtDate(o.importedAt.slice(0, 10))}</td>
                      <td>
                        <DeleteOwner id={o.id} name={o.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="small" style={{ marginBottom: 10 }}>
            {s.contacts.toLocaleString("en-US")} people after merging {s.rows.toLocaleString("en-US")} rows; {s.knownByTwo} known by two or more of you. Company names: {s.names.verified} matched exactly, {s.names.inferred} close (check), {s.names.ambiguous} with several candidates, {s.names.none} not in PRH ({s.names.foreign} look international), {s.names.skipped} not a company
            {s.names.pending ? `, ${s.names.pending} still being looked up` : ""}.
          </p>
          <div className="card stack">
            <UploadForm defaultOwner={net.owners.length ? "Co-founder" : "You"} compact />
            <div className="row small muted">
              <span>A real network replaces the demo networks.</span>
              <DemoButton label={net.demo ? "Reload demo data" : "Load demo data instead"} />
            </div>
          </div>
        </section>

        <section className="section" id="reactions">
          <h2>Post reactions</h2>
          <p className="small muted" style={{ marginBottom: 10, maxWidth: 820 }}>
            Who reacted to the team&apos;s LinkedIn posts. Each match is a signal on the person: it shows in their analysis and adds 5 points to the ranking, +2 for each further post (posts from the last 90 days). Nothing is scraped: on LinkedIn, open the post&apos;s reactions, select the list, copy and paste it here. Or drop a screenshot into Claude, which calls add_reactions.
          </p>
          <ReactionsPanel owners={net.owners.map((o) => ({ id: o.id, name: o.name }))} posts={listPosts(state)} today={net.today} owner={owner} />
        </section>

        <section className="section" id="engaged">
          <h2>Engaged, not connected ({net.engaged.length})</h2>
          <p className="small muted" style={{ marginBottom: 10, maxWidth: 820 }}>
            People who reacted to a team post but are in no one&apos;s network. Stored: only the name, the headline as copied, LinkedIn&apos;s degree marker and the post (label, date, whose post). No profile URL, no email, nothing looked up about the person; the company in the headline is matched in PRH like any company. Deleted automatically {ENGAGED_DAYS} days after the post unless the team set a status on them.
          </p>
          {net.engaged.length ? (
            <>
              <div className="table-wrap" style={{ marginBottom: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Headline</th>
                      <th>Fit</th>
                      <th>Post</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {net.engaged.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.name}
                          {e.degree ? <span className="muted small"> · {e.degree}</span> : null}
                        </td>
                        <td className="small">{e.headline || "—"}</td>
                        <td className="small">{e.fit ? (e.fit === "strong" ? "Strong fit" : "Possible fit") : e.tooSmall ? "Too small" : "—"}</td>
                        <td className="small muted">
                          {e.posts.map((p) => `${p.post} (${fmtDate(p.postDate)})`).join("; ")}
                        </td>
                        <td>
                          <DeleteEngaged id={e.id} label="Delete" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DeleteEngaged label="Delete all engaged" />
            </>
          ) : (
            <p className="small muted">No one yet. Save a post&apos;s reactions: names not in your networks land here.</p>
          )}
        </section>

        <section className="section" id="profile">
          <h2>Profile</h2>
          <p className="small muted" style={{ marginBottom: 10, maxWidth: 820 }}>
            What you are looking for, in your own words. It decides who counts as a fit and how messages read. Saved in {net.profileSource === "data" ? "the data folder's profile.json" : "config/profile.json"}; Claude can change it too (get_profile, set_profile).
          </p>
          <ProfileEditor profile={net.profile} demo={net.profileSource === "demo"} localModel={ollamaModel() || undefined} />
        </section>

        <section className="section" id="matches">
          <h2>PRH matches to check ({needLook.length})</h2>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Exact names are matched automatically. These were not: pick the right company, enter its business ID, or mark the name as not Finnish. Names with decision-makers first. Nothing is guessed.
          </p>
          <MatchReview items={reviews.slice(0, 80)} />
          {reviews.length > 80 ? <p className="small muted" style={{ marginTop: 8 }}>{reviews.length - 80} more with fewer people.</p> : null}
        </section>

        <section className="section" id="export">
          <h2>Export</h2>
          <p className="small" style={{ marginBottom: 8 }}>
            Everyone at an organisation your profile targets, with fit, approach, who knows them and status. For your CRM. No emails are stored or exported.
          </p>
          <a className="btn" href="/api/export.csv">
            Download CSV
          </a>
        </section>

        <section className="section" id="mcp">
          <h2>Connect to Claude</h2>
          <p className="small" style={{ marginBottom: 10, maxWidth: 820 }}>
            The same data as an MCP connector, so you can ask in your own Claude: &quot;who should I reach this week?&quot; or &quot;switch to people at logistics companies&quot;. Ranking and filtering stay in this app; Claude picks the filters and writes the text, on your own subscription. Nothing is sent to anyone.
          </p>
          <p className="small" style={{ marginBottom: 4 }}>
            Setting up the connector (commands, token, tunnel) is under <a href="#advanced">Advanced</a>.
          </p>
          <div className="card stack" style={{ marginTop: 16, maxWidth: 820 }}>
            <b>The skill</b>
            <span className="small">It tells Claude to start from your profile (and to ask what you are looking for when it is empty), which tool to use when, the message rules and the privacy rules.</span>
            <div className="row">
              <a className="btn small" href="/api/skill.zip">
                Download warm-paths-skill.zip
              </a>
              <span className="small muted">
                Or <code>npm run skill:zip</code> (writes dist/warm-paths-skill.zip).
              </span>
            </div>
            <span className="small muted">claude.ai: upload the zip in the Skills settings (Settings → Capabilities in Anthropic&apos;s guide; it needs a paid plan with code execution on). Claude Code: copy claude/warm-paths to ~/.claude/skills/.</span>
          </div>
        </section>

        <details className="section advanced" id="advanced">
          <summary>
            <h2>Advanced</h2>
            <span className="small muted">Command-line import, the local model, the Claude connector and its token.</span>
          </summary>
          <h3>LinkedIn import from the command line</h3>
          <div className="card stack" id="linkedin" >
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b style={{ fontWeight: 600 }}>LinkedIn data portability API (EU)</b>
              <span className={dma.connected ? "pill green" : "pill"}>{dma.connected ? `LinkedIn connected (${dma.expires ? `token expires ${fmtDate(dma.expires)}` : "token expiry not set"})` : "Not connected"}</span>
            </div>
            <p className="small muted">
              Instead of a CSV, a teammate in the EEA or Switzerland can fetch their own connections with LinkedIn&apos;s Member Data Portability API (CONNECTIONS only), using a token they made in LinkedIn&apos;s OAuth Token Generator. The token goes in <code>.env.local</code> as <code>LINKEDIN_DMA_TOKEN</code> and is never shown, logged or stored by the app.
              {dma.connected && !dma.expires ? " Add LINKEDIN_DMA_TOKEN_EXPIRES=YYYY-MM-DD, the date the token tool shows, to see here when it runs out." : ""}
            </p>
            {dma.lastSync ? (
              <p className="small">
                Last import into this data folder: {fmtDate(dma.lastSync.at.slice(0, 10))}, {dma.lastSync.coverage.rows.toLocaleString("en-US")} connections as {dma.lastSync.owner}. Profile URL in {pct(dma.lastSync.coverage.profileUrl, dma.lastSync.coverage.rows)}, company in {pct(dma.lastSync.coverage.company, dma.lastSync.coverage.rows)}, position in {pct(dma.lastSync.coverage.position, dma.lastSync.coverage.rows)}, connected on in {pct(dma.lastSync.coverage.connectedOn, dma.lastSync.coverage.rows)}.
              </p>
            ) : null}
            <pre className="code">{`npm run linkedin:sync -- --owner "Name" --dry-run\nDATA_DIR=data-mine npm run linkedin:sync -- --owner "Name"`}</pre>
            <p className="xs faint">The first line only counts what came back; the second imports into data-mine/, next to this demo, and looks the companies up in PRH.</p>
          </div>

          <h3 id="local-model">Local model</h3>
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b style={{ fontWeight: 600 }}>Ollama, on this machine</b>
              <span className={local.enabled && local.ok ? "pill green" : local.enabled ? "pill amber" : "pill"}>{local.enabled ? (local.ok ? `${local.model} answers` : "Set, not answering") : "Off"}</span>
            </div>
            <p className="small muted">
              Optional. A model running in Ollama on this machine can suggest roles, industries and keywords from your goal (Profile above; you choose what to keep), and write the &quot;Possible angle&quot; and &quot;Draft here&quot; texts {claudeAvailable() ? "when no ANTHROPIC_API_KEY is set (one is set now, so Claude writes them)" : "instead of the templates"}. Its text is checked against the facts and replaced by the template when it uses anything else. It never decides who fits or the order. Only an address on this machine is used.
            </p>
            {local.enabled ? (
              <p className="small">
                {local.model} at {local.url}.{local.error ? <span style={{ color: "var(--amber)" }}> {local.error}</span> : null}
              </p>
            ) : null}
            <pre className="code">{`# .env.local\nOLLAMA_MODEL=qwen3.6:35b\n# OLLAMA_URL=http://127.0.0.1:11434   (the default; only this machine)`}</pre>
          </div>

          <h3 id="connector">Claude connector</h3>
          <p className="small" style={{ marginBottom: 14 }}>
            Token: {token ? <span className="pill green">on</span> : <span className="pill">off</span>}{" "}
            <span className="muted">{token ? "Claude needs the header below. Pages answer only on this machine." : "The connector is for this machine only. Set MCP_TOKEN before you open a tunnel."}</span>
          </p>
          <div className="grid2">
            <div className="card stack">
              <div className="row" style={{ gap: 8 }}>
                <b>Claude Code</b>
                <span className="pill green">Tested</span>
              </div>
              <pre className="code">claude mcp add --transport http warm-paths {appUrl("/api/mcp")}{token ? ' \\\n  --header "Authorization: Bearer $MCP_TOKEN"' : ""}</pre>
              <span className="small muted">Then ask, for example: &quot;Using Warm Paths, who should I reach this week?&quot;. Write in Claude on a person copies a ready prompt.</span>
            </div>
            <div className="card stack">
              <div className="row" style={{ gap: 8 }}>
                <b>claude.ai and Claude Desktop</b>
                <span className="pill amber">Untested</span>
              </div>
              <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                <li>
                  A token, the same in both terminals: <code>export MCP_TOKEN=$(openssl rand -hex 24)</code>
                </li>
                <li>
                  The production server, not the dev server: <code>npm run build</code>, then terminal 1: <code>npm start</code>. Terminal 2: <code>npm run tunnel</code> (needs <code>cloudflared</code>; it prints the public URL and the header).
                </li>
                <li>
                  claude.ai: Customize → Connectors → + Add → Add custom connector. Name: Warm Paths. URL: the printed one, ending in /api/mcp. Authentication: No sign in. Request headers: <code>Authorization</code> with the value <code>Bearer &lt;token&gt;</code>.
                </li>
                <li>Claude Desktop uses the same connectors once you are signed in. Claude connects from Anthropic&apos;s cloud, which is why the URL must be public. Without a tunnel, Claude Desktop can also reach this machine through <code>npx -y mcp-remote {appUrl("/api/mcp")} --header &quot;Authorization: Bearer …&quot;</code> in its config file.</li>
                <li>Ctrl-C stops the tunnel. Through it, only /api/mcp answers, and only with the token.</li>
              </ol>
            </div>
          </div>
        </details>

        <section className="section" id="delete">
          <h2>Delete my data</h2>
          <p className="small" style={{ marginBottom: 10 }}>
            Deletes every network, every status and the PRH lookups made for your company names. Your profile stays; edit or clear it above. Only company names were ever sent to PRH; one person&apos;s role and company facts, and your goal, go to Claude only when an API key is set.
          </p>
          <DeleteAll />
        </section>
      </main>
    </>
  );
}
