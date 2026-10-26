import Link from "next/link";
import { loadNetwork } from "@/lib/network.ts";
import { peopleForTheme } from "@/lib/queries.ts";
import { GROUPS } from "@/lib/industry.ts";

export const dynamic = "force-dynamic";

export default async function Themes({ searchParams }: { searchParams: Promise<{ theme?: string; g?: string | string[]; roles?: string }> }) {
  const sp = await searchParams;
  const groups = Array.isArray(sp.g) ? sp.g : sp.g ? [sp.g] : [];
  const net = await loadNetwork();
  const roles = sp.roles?.split(",").map((s) => s.trim()).filter(Boolean);
  const r = groups.length ? peopleForTheme(net, { theme: sp.theme ?? "", industries: groups, roles, limit: 60 }) : null;
  return (
    <main className="page">
      <h1>Who should we invite?</h1>
      <p className="lede">For a roundtable, an event or a theme. Pick the industries yourself (in Claude, it picks them from the theme). The list and its order come from code. Nothing is sent.</p>
      <form className="card stack" style={{ maxWidth: 820 }}>
        <label className="field">
          <span>Theme or event</span>
          <input name="theme" defaultValue={sp.theme ?? ""} placeholder="Logistics roundtable in November" />
        </label>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 6 }}>
            Industries
          </legend>
          <div className="row" style={{ gap: "6px 14px" }}>
            {GROUPS.filter((g) => !g.grey && g.id !== "other").map((g) => (
              <label key={g.id} className="small">
                <input type="checkbox" name="g" value={g.id} defaultChecked={groups.includes(g.id)} /> {g.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Roles (optional, comma-separated; default: decision-makers)</span>
          <input name="roles" defaultValue={sp.roles ?? ""} placeholder="operations, logistics, tuotantojohtaja" />
        </label>
        <div>
          <button className="btn primary">Find people</button>
        </div>
      </form>
      {r ? (
        <div className="section">
          <h2>
            {r.total} people{r.theme ? ` for "${r.theme}"` : ""}
          </h2>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Invite: a decision-maker in {r.industries.join(", ")}. Ask for an intro: works at a target company, does not decide.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Approach</th>
                  <th>Name</th>
                  <th>Title · company</th>
                  <th>Why</th>
                  <th>Sender</th>
                </tr>
              </thead>
              <tbody>
                {r.people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.themeApproach === "invite" ? <span className="pill accent">Invite</span> : <span className="pill">Ask for an intro</span>}</td>
                    <td>
                      <Link href={`/people/${p.id}`}>{p.name}</Link>
                    </td>
                    <td className="small">
                      {p.title} · {p.company}
                    </td>
                    <td className="small muted">{p.why}</td>
                    <td className="small">{p.suggestedSender}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </main>
  );
}
