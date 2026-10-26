import Link from "next/link";
import { notFound } from "next/navigation";
import { loadNetwork } from "@/lib/network.ts";
import { getCompany } from "@/lib/queries.ts";
import { fmtDate } from "@/lib/analysis.ts";
import { ytjUrl } from "@/lib/prh.ts";
import { FitTag, MatchPill } from "@/components/ui";
import { ExcludeButton } from "@/components/ExcludeButton";

export const dynamic = "force-dynamic";

export default async function Company({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const net = await loadNetwork();
  const co = getCompany(net, { business_id: decodeURIComponent(id) });
  // A company on the radar that no one in the team knows: PRH facts from the notices only.
  const radarOnly = !co ? net.signals?.signals.filter((s) => s.businessId === decodeURIComponent(id)) ?? [] : [];
  if (!co && !radarOnly.length) notFound();
  if (!co) {
    const s = radarOnly[0];
    return (
      <main className="page" style={{ maxWidth: 820 }}>
        <h1>{s.company}</h1>
        <p className="lede">
          {s.industry} (TOL {s.tol}){s.town ? `, ${s.town.charAt(0)}${s.town.slice(1).toLowerCase()}` : ""} · {s.businessId} ·{" "}
          <a href={ytjUrl(s.businessId)} target="_blank" rel="noreferrer">
            PRH
          </a>
        </p>
        <h2>Registered changes, last 90 days</h2>
        <ul className="reasons">
          {radarOnly.map((x) => (
            <li key={x.recordNumber + x.type}>
              <span>
                {x.type === "md_change" ? "Managing director changed" : x.type === "new_money" ? "New money: share issue or capital increase" : x.type === "merger" ? "Merger or demerger" : "Board changed"} · registered {fmtDate(x.date)} · notice {x.recordNumber}
              </span>
              <span className="pill">PRH notices</span>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ marginTop: 16 }}>No one in the team&apos;s networks works here. Headcount: missing, not in PRH open data.</p>
      </main>
    );
  }
  const excluded = !!net.profile.excluded?.some((x) => x.businessId === co.businessId);
  return (
    <main className="page" style={{ maxWidth: 900 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{co.name}</h1>
        <div className="row" style={{ gap: 8 }}>
          {co.businessId ? <ExcludeButton businessId={co.businessId} name={co.name} excluded={excluded} /> : null}
          <MatchPill status={co.matchStatus} />
        </div>
      </div>
      {excluded ? <p className="small muted" style={{ marginTop: 6 }}>Marked as not a target company: its people are not on the list.</p> : null}
      {co.prh ? (
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Line of business</dt>
          <dd>
            {co.prh.industry} (TOL {co.prh.tol}) · {co.group}
            {co.inProfile ? <span className="pill accent" style={{ marginLeft: 8 }}>In your profile</span> : null}
          </dd>
          <dt>Business ID</dt>
          <dd>
            {co.businessId} ·{" "}
            <a href={co.prh.source} target="_blank" rel="noreferrer">
              PRH
            </a>
          </dd>
          <dt>Form</dt>
          <dd>
            {co.prh.form}
            {co.prh.formCode === "17" ? <span className="small muted"> · listed companies are often large groups</span> : null}
          </dd>
          <dt>Town</dt>
          <dd>{co.prh.town ? co.prh.town.charAt(0) + co.prh.town.slice(1).toLowerCase() : "—"}</dd>
          <dt>Registered</dt>
          <dd>{co.prh.registered ? fmtDate(co.prh.registered) : "—"}</dd>
          <dt>Employer Register</dt>
          <dd>
            {co.prh.registers ? (
              <>
                {co.prh.registers.employer ? `Yes${co.prh.registers.employerSince ? `, since ${fmtDate(co.prh.registers.employerSince)}` : ""}` : "No: no regular employees registered"} <span className="pill">PRH/YTJ</span>
                <span className="small muted"> · VAT register: {co.prh.registers.vat ? "yes" : "no"}</span>
              </>
            ) : (
              <>
                <span className="pill missing">Missing</span> <span className="small muted">not looked up yet; fetched from PRH/YTJ with the next lookups</span>
              </>
            )}
          </dd>
          <dt>Headcount</dt>
          <dd>
            <span className="pill missing">Missing</span> <span className="small muted">not in PRH open data</span>
          </dd>
          <dt>Names in your networks</dt>
          <dd className="small">{co.namesInNetwork.join(" · ")}</dd>
        </dl>
      ) : (
        <p className="lede">Not matched to a Finnish company. Names in your networks: {co.namesInNetwork.join(" · ")}.</p>
      )}
      <div className="section">
        <h2>Registered changes, last 90 days</h2>
        {co.signals.length ? (
          <ul className="reasons">
            {co.signals.map((s) => (
              <li key={s.notice + s.type}>
                <span>
                  {s.type} · registered {fmtDate(s.date)} · notice {s.notice}
                </span>
                <span className="pill">PRH notices</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None of the tracked types (managing director, board, new money, merger).</p>
        )}
      </div>
      <div className="section">
        <h2>Who the team knows here ({co.people.length})</h2>
        <div className="stack">
          {co.people.map((p) => (
            <Link key={p.id} href={`/people/${p.id}`} className="prow">
              <span className="top-line">
                <span className="name">{p.name}</span>
                <FitTag fit={p.fit} />
              </span>
              <span className="small muted">{p.title || "No title"}</span>
              <span className="small" style={{ color: "var(--text-2)" }}>
                Known by {p.knownBy.join(", ")}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
