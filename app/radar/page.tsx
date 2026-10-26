import Link from "next/link";
import { loadNetwork } from "@/lib/network.ts";
import { getRadar } from "@/lib/queries.ts";
import { GROUPS } from "@/lib/industry.ts";
import { SIGNAL_TYPES, type SignalType } from "@/lib/signals.ts";
import { fmtDate } from "@/lib/analysis.ts";

export const dynamic = "force-dynamic";

type SP = { type?: string; group?: string; known?: string; days?: string };

export default async function Radar({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const net = await loadNetwork();
  const types = sp.type && sp.type in SIGNAL_TYPES ? [sp.type as SignalType] : undefined;
  const r = getRadar(net, { types, industries: sp.group ? [sp.group] : undefined, known: sp.known === "known" || sp.known === "unknown" ? sp.known : undefined, days: sp.days ? Number(sp.days) : undefined, limit: 200 });
  const link = (patch: Partial<SP>) => {
    const q = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/radar${q.size ? `?${q}` : ""}`;
  };
  const seg = (key: keyof SP, opts: [string, string][]) => (
    <div className="seg" role="group">
      {opts.map(([v, label]) => (
        <Link key={v} href={link({ [key]: v })} aria-current={(sp[key] ?? "") === v ? "true" : undefined}>
          {label}
        </Link>
      ))}
    </div>
  );
  return (
    <main className="page wide">
      <h1>Signal radar</h1>
      <p className="lede">
        Companies in your industries where the trade register shows a change that often means a need for help: a new managing director, new money, a merger or a new board. Warm rows first: someone in the team knows a person there.
        {r.window ? ` Notices registered ${fmtDate(r.window.start)} to ${fmtDate(r.window.end)}, fetched ${fmtDate(r.window.fetchedAt.slice(0, 10))}.` : ""}
      </p>
      {!r.window ? (
        <p className="card">
          No notices fetched yet. Run <code>node scripts/fetch-signals.mjs</code> (about 6 minutes, cached).
        </p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            {seg("known", [["", "All"], ["known", "Someone we know"], ["unknown", "No one yet"]])}
            {seg("type", [["", "Any change"], ...Object.entries(SIGNAL_TYPES).map(([k, v]) => [k, v.short] as [string, string])])}
            {seg("days", [["", "90 days"], ["30", "30 days"]])}
          </div>
          <div className="row small" style={{ marginBottom: 14, gap: 6 }}>
            <span className="muted">Industry:</span>
            <Link href={link({ group: "" })} className={!sp.group ? "chip" : "link"}>
              All
            </Link>
            {GROUPS.filter((g) => !g.grey && g.id !== "other").map((g) => (
              <Link key={g.id} href={link({ group: g.id })} className={sp.group === g.id ? "chip" : "link"}>
                {g.label}
              </Link>
            ))}
          </div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            {r.total.toLocaleString("en-US")} companies, {r.warm} where the team knows someone. Showing {r.rows.length}. Score: weight of each change type (MD and new money 3, merger and board 2), less for older notices.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Industry</th>
                  <th>Change</th>
                  <th>Latest</th>
                  <th>Who we know there</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.businessId}>
                    <td>
                      <Link href={`/companies/${x.businessId}`}>{x.company}</Link>
                      <div className="xs faint">
                        {x.town ? x.town.charAt(0) + x.town.slice(1).toLowerCase() + " · " : ""}
                        <a href={x.source} target="_blank" rel="noreferrer" className="faint">
                          {x.businessId}
                        </a>
                      </div>
                    </td>
                    <td className="small">
                      {x.groupLabel}
                      <div className="xs faint">{x.industry}</div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {[...new Set(x.signals.map((s) => s.type))].map((t) => (
                          <span key={t} className={`pill${t === "md_change" || t === "new_money" ? " accent" : ""}`}>
                            {SIGNAL_TYPES[t].short}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="small num" style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(x.latest)}
                    </td>
                    <td className="small">
                      {x.known.length ? (
                        x.known.slice(0, 3).map((k) => (
                          <div key={k.id}>
                            <Link href={`/people/${k.id}`}>{k.name}</Link> {k.role ? <span className={k.role === "decision-maker" ? "pill accent" : "pill"}>{k.role}</span> : null} <span className="muted">· {k.title || "no title"} · {k.knownBy.join(", ")}</span>
                          </div>
                        ))
                      ) : (
                        <span className="faint">No one yet</span>
                      )}
                    </td>
                    <td className="num">{x.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Company-level data from PRH registered notices (CC BY 4.0). Bankruptcies, liquidations, restructurings and housing companies are left out. Business Finland funding decisions are not included: no open dataset with a clear licence was found.
          </p>
        </>
      )}
    </main>
  );
}
