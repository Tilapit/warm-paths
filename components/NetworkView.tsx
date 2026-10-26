"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { NetworkDrawing, type DGroup, type DNode, type DOwner } from "./NetworkDrawing";
import { PersonAnalysis, type PersonPayload } from "./PersonAnalysis";
import { FitTag } from "./ui";
import { WriteInClaude } from "./WriteInClaude";
import type { EngagedPick, FunnelStep, IntroPick, WeekPick } from "@/lib/queries.ts";

export type ViewNode = DNode & { co: string; via: string[]; st: string; sg: number; hd: boolean; cd: string };

const fmt = (n: number) => n.toLocaleString("en-US");
const NUM = ["no", "one", "two", "three", "four", "five"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const popcount = (k: number) => {
  let c = 0;
  for (; k; k &= k - 1) c++;
  return c;
};
/** "Transport and logistics" -> "transport and logistics"; "TOL 46" stays. */
const lower = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

type Week = Pick<WeekPick, "id" | "name" | "title" | "company" | "fit" | "status" | "kind" | "why" | "sender" | "prompt" | "cooldown">;
type Intro = Pick<IntroPick, "id" | "name" | "title" | "company" | "why" | "sender" | "prompt" | "cooldown">;
type Intros = { total: number; people: Intro[] };
type Due = { id: string; name: string; title: string; company: string; sentOn: string; sentBy: string; followUpOn: string };

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

export function NetworkView(props: {
  nodes: ViewNode[];
  groups: DGroup[];
  owners: DOwner[];
  profile: { goal: string; demo: boolean; roles: string[]; keywords: string[]; main: string[]; lower: string[] };
  matched: number;
  noCompany: number;
  initial?: string;
  /** This week for the whole team, and for each teammate's network. */
  week: Week[];
  weekBy: Week[][];
  /** Not decision-makers at target companies who can introduce: the team's, and each teammate's. */
  intro: Intros;
  introBy: Intros[];
  /** Reacted to a team post, in no one's network. */
  engaged: { total: number; people: EngagedPick[] };
  engagedBy: { total: number; people: EngagedPick[] }[];
  /** People → company found in PRH → in your industries → decision-makers who fit. */
  funnel: FunnelStep[];
  funnelBy: FunnelStep[][];
  /** Sent a week ago or more with no reply recorded: the team's, and what each teammate sent. */
  follow: Due[];
  followBy: Due[][];
}) {
  const { nodes, groups, owners } = props;
  const [owner, setOwner] = useState(-1);
  const [selected, setSelected] = useState<string | null>(props.initial ?? null);
  const [person, setPerson] = useState<PersonPayload | null>(null);
  // Hovering an industry only highlights it; clicking it lists its decision-makers.
  const [hoverGroup, setHoverGroup] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [reacted, setReacted] = useState(false);
  // A person hovered in the panel lights up in the drawing.
  const [focus, setFocus] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const side = useRef<HTMLElement>(null);

  const bit = owner >= 0 ? 1 << owner : 0;
  const vis = useMemo(() => nodes.filter((n) => !bit || n.k & bit), [nodes, bit]);
  const fits = useMemo(() => vis.filter((n) => n.f), [vis]);
  // Server order: strong, possible, "not a fit" last, then score. People the
  // team already contacted or snoozed go after the rest of the list.
  const ranked = useMemo(() => [...fits.filter((n) => !n.nf && !n.hd), ...fits.filter((n) => !n.nf && n.hd)], [fits]);
  const reactedList = useMemo(() => [...vis.filter((n) => n.rx > 0 && !n.nf && !n.hd), ...vis.filter((n) => n.rx > 0 && !n.nf && n.hd)], [vis]);
  const inIndustry = useMemo(() => (picked === null ? [] : ranked.filter((n) => n.g === picked)), [ranked, picked]);
  // Industries with people in your profile: the ones the drawing has a node for.
  const targets = useMemo(() => new Set(nodes.filter((n) => n.ip && !groups[n.g].grey).map((n) => n.g)), [nodes, groups]);
  const week = owner >= 0 ? props.weekBy[owner] ?? [] : props.week;
  // The code keeps each sender to this many while it can; the blurb says so only when it held.
  const perSender = Math.max(1, Math.ceil(5 / Math.max(1, owners.length)));
  const balanced = owners.length > 1 && week.every((w) => week.filter((x) => x.sender === w.sender).length <= perSender);
  const follow = owner >= 0 ? props.followBy[owner] ?? [] : props.follow;
  const intro = owner >= 0 ? props.introBy[owner] ?? { total: 0, people: [] } : props.intro;
  const engaged = owner >= 0 ? props.engagedBy[owner] ?? { total: 0, people: [] } : props.engaged;
  const steps = owner >= 0 ? props.funnelBy[owner] ?? [] : props.funnel;
  const list = picked !== null ? inIndustry : reacted ? reactedList : null;
  // The drawing labels and lights the top of the list on the right.
  const listIds = useMemo(() => (list ? list.filter((n) => n.f && !n.hd).slice(0, 5).map((n) => n.id) : week.map((w) => w.id)), [list, week]);

  /** When the panel sits below the drawing, bring it into view. */
  function reveal() {
    if (side.current && window.matchMedia("(max-width: 1023px)").matches) side.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function choose(id: string) {
    setSelected(id);
    setFocus(null);
    reveal();
  }

  function back() {
    setSelected(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("p");
    window.history.replaceState(null, "", url);
  }

  function pick(g: number | null, fromTable = false) {
    setPicked(g);
    if (g === null) return;
    setReacted(false);
    setFocus(null);
    back();
    if (window.matchMedia("(max-width: 1023px)").matches) reveal();
    else if (fromTable) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleReacted() {
    setReacted(!reacted);
    if (!reacted) {
      setPicked(null);
      back();
    }
  }

  useEffect(() => {
    if (!selected) {
      setPerson(null);
      return;
    }
    let live = true;
    fetch(`/api/people/${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => live && setPerson(p))
      .catch(() => {});
    const url = new URL(window.location.href);
    url.searchParams.set("p", selected);
    window.history.replaceState(null, "", url);
    return () => {
      live = false;
    };
  }, [selected]);

  // Escape clears a picked industry.
  useEffect(() => {
    if (picked === null) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !selected && setPicked(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [picked, selected]);

  const counts = useMemo(() => {
    const present = new Set(vis.filter((n) => targets.has(n.g)).map((n) => n.g));
    return { contacts: vis.length, groups: present.size, fits: fits.length };
  }, [vis, fits, targets]);

  const industries = useMemo(() => {
    const rows = groups
      .map((g, i) => {
        const cs = vis.filter((n) => n.g === i);
        const f = cs.filter((n) => n.f && !n.nf);
        const strong = f.filter((n) => n.f === 2).length;
        const two = f.filter((n) => n.k & (n.k - 1)).length;
        const sig = new Set(cs.filter((n) => n.sig && n.ip).map((n) => n.co)).size;
        return { i, label: g.label, scored: targets.has(i), people: cs.length, fit: f.length, strong, possible: f.length - strong, two, sig, score: strong * 3 + (f.length - strong) + two * 2 + sig * 2 };
      })
      .filter((r) => r.people);
    const k = sort.key as keyof (typeof rows)[number];
    return rows.sort((a, b) => (a.scored !== b.scored ? (a.scored ? -1 : 1) : ((a[k] as number) - (b[k] as number)) * sort.dir || b.people - a.people));
  }, [groups, vis, sort, targets]);
  const maxScore = Math.max(1, ...industries.map((r) => r.score));
  const th = (key: string, label: string, num = true) => (
    <th className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : -1 })}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  const row = (n: ViewNode) => (
    <button key={n.id} type="button" className={`prow${n.nf || n.hd ? " dim" : ""}`} onClick={() => choose(n.id)} onMouseEnter={() => setFocus(n.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(n.id)} onBlur={() => setFocus(null)}>
      <span className="top-line">
        <span className="name">{n.n}</span>
        <FitTag fit={n.f === 2 ? "strong" : n.f === 1 ? "possible" : null} status={n.st} />
      </span>
      <span className="small muted">
        {n.t || "No title"} · {n.c}
      </span>
      <span className="small" style={{ color: "var(--text-2)" }}>
        Sender: {n.via[0]}
        {n.via.length > 1 ? ` · ${n.via.length} of you know them` : ""}
        {n.sg ? ` · ${n.sg > 1 ? `${n.sg} registered changes` : "registered change"}` : ""}
        {n.rx ? " · reacted to a post" : ""}
      </span>
      {n.cd && !n.hd ? <span className="small cooldown">Colleague contacted {day(n.cd)}</span> : null}
    </button>
  );

  const backLabel = picked !== null ? groups[picked].label : reacted ? "Reacted recently" : "This week";
  const pickedPeople = picked === null ? 0 : vis.filter((n) => n.g === picked).length;

  return (
    <div className="netpage">
      <header className="net-head">
        <h1>{props.profile.goal ? <>Who in your network could help with: {props.profile.goal}</> : "Who in your network could help"}</h1>
        <p className="profile-line" title={props.profile.lower.length ? `Lower priority: ${props.profile.lower.map(lower).join(", ")}` : undefined}>
          {props.profile.demo ? <span className="pill amber" style={{ marginRight: 6 }}>Demo profile</span> : null}
          Profile: {props.profile.roles.length ? props.profile.roles.join(", ") : "decision-makers"}
          {props.profile.main.length ? ` in ${props.profile.main.map(lower).join(", ")}` : props.profile.keywords.length ? "" : " in any industry"}
          {props.profile.keywords.length ? `${props.profile.main.length ? ", or" : ""} at organisations named ${props.profile.keywords.map((k) => `"${k}"`).join(", ")}` : ""} ·{" "}
          <Link href="/settings#profile" className="link">
            Edit
          </Link>
        </p>
        <ol className="funnel" aria-label="From people to decision-makers who fit">
          {steps.map((f, i) => (
            <li key={f.label}>
              {i ? <span className="funnel-arrow" aria-hidden="true">→</span> : null}
              <span className="funnel-step">
                <Link href={f.href} className="funnel-count">
                  {fmt(f.count)} {f.label}
                </Link>
                {f.rest ? (
                  <Link href={f.rest.href} className="xs faint funnel-rest">
                    {f.rest.label}: see which
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
        <div className="toolbar">
          <span className="small muted">Whose network</span>
          <div className="seg" role="group" aria-label="Whose network">
            <button type="button" aria-pressed={owner < 0} onClick={() => setOwner(-1)}>
              Whole team
            </button>
            {owners.map((o, i) => (
              <button key={o.id} type="button" aria-pressed={owner === i} onClick={() => setOwner(i)}>
                {o.name}
              </button>
            ))}
          </div>
          {reactedList.length || reacted ? (
            <button type="button" className="chip-toggle" aria-pressed={reacted} onClick={toggleReacted} title={reacted ? "Showing who reacted to the team's posts in the last 30 days. Click to go back to This week." : "Show who reacted to the team's posts in the last 30 days"}>
              <i className={reacted ? "lg-reacted" : "lg-off"} />
              Reacted recently · {reactedList.length}
            </button>
          ) : (
            <Link href={`/settings${owner >= 0 ? `?owner=${encodeURIComponent(owners[owner].id)}` : ""}#reactions`} className="link small">
              Add post reactions
            </Link>
          )}
        </div>
        <p className="hint">
          <span className="wide-only">Start with a name on the right, or click an industry to see its decision-makers.</span>
          <span className="narrow-only">Start with a name below, or tap an industry to see its decision-makers.</span>
        </p>
      </header>

      <section className="net-draw" aria-label="Your team's network">
        <NetworkDrawing nodes={nodes} groups={groups} owners={owners} owner={owner} listIds={listIds} selected={selected} onSelect={choose} hoverGroup={hoverGroup} onHoverGroup={setHoverGroup} picked={picked} onPick={(g) => pick(g)} counts={counts} showReacted={reacted} focusId={focus} />
        <div className="legend-row">
          <div className="legend">
            {reacted ? (
              <span>
                <i className="lg-reacted" />
                Reacted recently
              </span>
            ) : picked !== null ? (
              <span>
                <i className="lg-picked" />
                {groups[picked].label}
              </span>
            ) : (
              <span>
                <i className="lg-lit" />
                This week
              </span>
            )}
            <span>
              <i className="lg-fit" />
              Decision-maker who fits
            </span>
            <span>
              <i className="lg-other" />
              Someone you know
            </span>
          </div>
          <HowItWorks matched={props.matched} total={nodes.length} rows={nodes.reduce((a, n) => a + popcount(n.k), 0)} noCompany={props.noCompany} />
        </div>
      </section>

      <aside className="side net-side" aria-label="Who to reach" ref={side}>
        {person && selected ? (
          <PersonAnalysis data={person} onBack={back} backLabel={backLabel} />
        ) : picked !== null ? (
          <>
            <div className="panel-head">
              <h2>{groups[picked].label}</h2>
              <button type="button" className="chip-x" onClick={() => pick(null)} title="Clear the industry and show This week again">
                × Clear
              </button>
            </div>
            <p className="small muted" style={{ marginBottom: 14 }}>
              {inIndustry.length
                ? `${inIndustry.length} decision-maker${inIndustry.length === 1 ? "" : "s"} · ${inIndustry.filter((n) => n.f === 2).length} strong. Strong fits first, then by score; the first five are named in the drawing.`
                : `None of the ${fmt(pickedPeople)} people here has a decision-maker title that fits.`}
            </p>
            {inIndustry.slice(0, 12).map(row)}
            {inIndustry.length > 12 ? (
              <p className="small" style={{ marginTop: 8 }}>
                <Link href={`/people?industry=${groups[picked].id}`} className="link">
                  Show all {inIndustry.length} →
                </Link>
              </p>
            ) : null}
          </>
        ) : reacted ? (
          <>
            <div className="panel-head">
              <h2>Reacted recently</h2>
              <button type="button" className="chip-x" onClick={toggleReacted} title="Show This week again">
                × Clear
              </button>
            </div>
            <p className="small muted" style={{ marginBottom: 14 }}>
              {reactedList.length} reacted to one of the team&apos;s posts in the last 30 days, matched by name from the pasted reactions list. Fits first.
            </p>
            {reactedList.slice(0, 12).map(row)}
            <p className="small" style={{ marginTop: 8 }}>
              <Link href="/people?reacted=1" className="link">
                Show all {reactedList.length} who reacted →
              </Link>
            </p>
          </>
        ) : (
          <div className="week">
            <h2>This week</h2>
            <p className="small muted" style={{ marginBottom: 12 }}>
              {owner >= 0
                ? `${cap(NUM[week.length] ?? String(week.length))} ${week.length === 1 ? "person" : "people"} in ${owners[owner].name === "You" ? "your" : `${owners[owner].name}'s`} network to reach now, picked by fixed rules, not AI: a fresh registered change or a reaction first, nobody already contacted.`
                : `${cap(NUM[week.length] ?? String(week.length))} ${week.length === 1 ? "person" : "people"} to reach now, picked by fixed rules, not AI: a fresh registered change or a reaction first, nobody already contacted${balanced ? `, at most ${NUM[perSender] ?? perSender} for each sender` : ""}.`}
            </p>
            {week.map((w) => (
              <div key={w.id} className="prow week-card" onMouseEnter={() => setFocus(w.id)} onMouseLeave={() => setFocus(null)}>
                <button type="button" className="prow-open" onClick={() => choose(w.id)}>
                  <span className="top-line">
                    <span className="name">{w.name}</span>
                    <FitTag fit={w.fit} status={w.status === "To contact" ? "to_contact" : undefined} />
                  </span>
                  <span className="small muted">
                    {w.title || "No title"} · {w.company}
                  </span>
                  <span className={`small why ${w.kind}`}>{w.why}</span>
                  {w.cooldown ? <span className="small cooldown">{w.cooldown}</span> : null}
                </button>
                <span className="row small" style={{ justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                  <span className="muted">Suggested sender: {w.sender}</span>
                  <WriteInClaude prompt={w.prompt} className="link small" />
                </span>
              </div>
            ))}
            {!week.length ? <p className="small muted">Nobody left to reach: everyone who fits has a status.</p> : <p className="xs faint">Write in Claude copies a prompt for your own Claude, which writes the message. Nothing is sent from this app.</p>}
            {engaged.people.length ? (
              <div className="intros">
                <h3>
                  Engaged, not connected ·{" "}
                  <Link href="/settings#engaged" className="link">
                    {fmt(engaged.total)}
                  </Link>
                </h3>
                <p className="xs faint" style={{ marginBottom: 8 }}>
                  Reacted to a team post, in no one&apos;s network. Ranked by fit from their headline. Send a connection request, not a message.
                </p>
                {engaged.people.map((e) => (
                  <div key={e.id} className="prow intro-card">
                    <span className="top-line">
                      <span className="name">{e.name}</span>
                      {e.fit ? <FitTag fit={e.fit} /> : <span className="pill">{e.degree ?? "Not connected"}</span>}
                    </span>
                    <span className="small muted">{e.why}</span>
                    <span className="row xs" style={{ justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                      <span className="muted">Send a connection request{e.sender ? `: ${e.sender}` : ""}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {intro.people.length ? (
              <div className="intros">
                <h3>
                  Ask for an intro ·{" "}
                  <Link href="/people?step=intro" className="link" title="Everyone at a target organisation who is not a decision-maker">
                    {fmt(intro.total)} can introduce
                  </Link>
                </h3>
                <p className="xs faint" style={{ marginBottom: 8 }}>
                  Not decision-makers, at organisations your profile targets. Companies where you know no one who decides come first.
                </p>
                {intro.people.map((w) => (
                  <div key={w.id} className="prow intro-card" onMouseEnter={() => setFocus(w.id)} onMouseLeave={() => setFocus(null)}>
                    <button type="button" className="prow-open" onClick={() => choose(w.id)}>
                      <span className="top-line">
                        <span className="name">{w.name}</span>
                        <span className="pill">Can introduce</span>
                      </span>
                      <span className="small muted">{w.why}</span>
                      {w.cooldown ? <span className="small cooldown">{w.cooldown}</span> : null}
                    </button>
                    <span className="row xs" style={{ justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                      <span className="muted">Suggested sender: {w.sender}</span>
                      <WriteInClaude prompt={w.prompt} className="link xs" />
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {follow.length ? (
              <div className="follow-ups">
                <h3>
                  Follow-up due · {follow.length}
                </h3>
                <p className="xs faint" style={{ marginBottom: 8 }}>
                  Sent a week ago or more, no reply recorded. Not new recommendations: follow up, or record how it went.
                </p>
                {follow.map((f) => (
                  <button key={f.id} type="button" className="prow" onClick={() => choose(f.id)} onMouseEnter={() => setFocus(f.id)} onMouseLeave={() => setFocus(null)}>
                    <span className="top-line">
                      <span className="name">{f.name}</span>
                      <span className="pill amber">Follow-up due</span>
                    </span>
                    <span className="small muted">
                      {f.title || "No title"} · {f.company}
                    </span>
                    <span className="small" style={{ color: "var(--text-2)" }}>
                      Sent {day(f.sentOn)} by {f.sentBy}; due since {day(f.followUpOn)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <p className="small" style={{ marginTop: 8 }}>
              <Link href="/people" className="link">
                Show all {fits.length} decision-makers who fit →
              </Link>
            </p>
          </div>
        )}
        {selected && !person ? <p className="muted small">Loading…</p> : null}
      </aside>

      <section className="net-table section" aria-label="By industry">
        <h2>By industry</h2>
        <p className="small muted" style={{ marginBottom: 10 }}>
          Click a row to list its decision-makers. Score is code: 3 per strong fit, 1 per possible fit, 2 per fit known by two or more of you, 2 per target company with a registered change in the last 90 days.
        </p>
        <div className="table-wrap">
          <table className="industries">
            <thead>
              <tr>
                {th("label", "Industry", false)}
                {th("people", "People")}
                {th("fit", "Who fit")}
                {th("strong", "Strong")}
                {th("two", "Known by 2+")}
                {th("sig", "Signals")}
                {th("score", "Score")}
              </tr>
            </thead>
            <tbody>
              {industries.map((r) => (
                <tr key={r.i} className={r.scored ? (picked === r.i ? "pickable picked" : "pickable") : "unscored"} onClick={r.scored ? () => pick(picked === r.i ? null : r.i, true) : undefined} onMouseEnter={() => r.scored && setHoverGroup(r.i)} onMouseLeave={() => setHoverGroup(null)}>
                  <td>
                    {r.scored ? (
                      <button type="button" className="row-link" aria-pressed={picked === r.i} onClick={(e) => {
                        e.stopPropagation();
                        pick(picked === r.i ? null : r.i, true);
                      }}>
                        {r.label}
                      </button>
                    ) : (
                      r.label
                    )}
                  </td>
                  <td className="num">{fmt(r.people)}</td>
                  <td className="num">{r.fit}</td>
                  <td className="num">{r.strong}</td>
                  <td className="num">{r.two}</td>
                  <td className="num">{r.sig}</td>
                  <td style={{ minWidth: 120 }}>
                    {!r.scored ? (
                      <span className="faint xs">not scored</span>
                    ) : (
                      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                        <div className="bar" style={{ flex: 1 }}>
                          <div style={{ width: `${(100 * r.score) / maxScore}%` }} />
                        </div>
                        <span className="num xs muted">{r.score}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** The long explanation, out of the way until asked for. */
function HowItWorks({ matched, total, rows, noCompany }: { matched: number; total: number; rows: number; noCompany: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="how" ref={box}>
      <button type="button" className="link small" aria-expanded={open} aria-controls="how-it-works" onClick={() => setOpen(!open)}>
        How this works
      </button>
      {open ? (
        <div className="popover" id="how-it-works" role="dialog" aria-label="How this works">
          <ul>
            <li>
              <b>Left to right:</b> your team, the people you know (one dot each, grouped by their company&apos;s industry), the industries, and the people who fit your profile. Every line is a real LinkedIn connection.
            </li>
            <li>
              <b>Industries</b> come from the trade register (PRH): {fmt(matched)} of {fmt(total)} people are matched to one Finnish company by name. Nothing is guessed: a name with no single match stays unmatched until you pick one in <Link href="/settings#matches">Settings</Link>.
              {noCompany ? ` ${noCompany} have no company in LinkedIn.` : ""}
            </li>
            <li>
              <b>Fit</b> is code: a decision-maker title at an organisation your profile targets (by industry or a keyword in its name). Brighter blue is a strong fit: a senior title that matches one of your target roles.
            </li>
            <li>
              <b>This week</b> is up to five people picked by code: fresh registered changes and reactions first, nobody already contacted, no sender with more than their share. Below it, a few people who do not decide but can introduce you.
            </li>
            <li>
              Someone two of you know is one dot, merged by profile URL: {fmt(rows)} connections are {fmt(total)} people. Hover a dot for who it is; Ctrl or ⌘ + scroll zooms.
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
