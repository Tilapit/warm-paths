"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Person = { id: string; name: string; title: string; company: string; fit?: string | null; url?: string };
type Result = {
  post: string;
  postDate: string;
  read: number;
  saved: number;
  matched: { name: string; how?: string; person: Person }[];
  review: { name: string; headline?: string; degree?: string; candidates: (Person & { knownBy: string[] })[] }[];
  unmatched: { name: string; why: string }[];
  /** Same name as someone in the networks, ruled out only by the degree marker against "Copied from". */
  degreeMismatch: { name: string; degree?: string }[];
  companyPages: number;
  copiedBy?: string;
  copiedByWarning?: { share: number; text: string; suggest?: { id: string; name: string } };
  unread: string[];
};
type Post = { post: string; postDate?: string; author?: string; people: number };

const HOW: Record<string, string> = { name: "Name", name_company: "Name and company", name_degree: "Name and degree", picked: "Picked" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

/** Paste a post's reactions list from LinkedIn, check the matches, save. */
export function ReactionsPanel({ owners, posts, today, owner }: { owners: { id: string; name: string }[]; posts: Post[]; today: string; owner?: string }) {
  const router = useRouter();
  const [post, setPost] = useState("");
  const [date, setDate] = useState(today);
  // Whose post: the teammate the Network page was filtered to (said next to it), else the first one.
  const fromFilter = owners.some((o) => o.id === owner);
  const [author, setAuthor] = useState(fromFilter ? owner! : owners[0]?.id ?? "");
  // The "· 1st" markers are relative to whoever copied the list. It follows the
  // post's owner until someone picks another teammate here, never the filter.
  const [copiedBy, setCopiedBy] = useState<string | null>(null);
  const viewer = copiedBy ?? author;
  const nameOf = (id: string) => owners.find((o) => o.id === id)?.name ?? id;
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function send(save: boolean, as?: string) {
    setBusy(true);
    setMsg("");
    // Picks are kept per review entry: two entries can share a name.
    const chosen = (result?.review ?? []).flatMap((r, i) => (picks[i] && picks[i] !== "none" ? [{ name: r.name, person_id: picks[i] }] : []));
    const r = await fetch("/api/reactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ post, postDate: date, author, copiedBy: as ?? viewer, text, picks: save ? chosen : [], save }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(j.error ?? "Failed");
    if (!save) {
      setResult(j);
      setPicks({});
      return;
    }
    // Saved: the unmatched names were shown once and are gone now.
    // One line: what was stored and what was left out.
    setMsg(`${j.saved} stored${j.saved < j.matched.length ? ` (${j.matched.length - j.saved} were already there)` : ""} · ${j.engaged?.saved ?? 0} engaged, not connected${j.degreeMismatch?.length ? ` · ${j.degreeMismatch.length} ruled out by "1st"` : ""} · ${j.companyPages ?? 0} company page${j.companyPages === 1 ? "" : "s"} skipped. Saved to "${j.post}"; they count in the ranking now.`);
    setResult(null);
    setText("");
    setPost("");
    router.refresh();
  }

  async function remove(p: Post) {
    await fetch(`/api/reactions?post=${encodeURIComponent(p.post)}${p.postDate ? `&date=${p.postDate}` : ""}`, { method: "DELETE" });
    router.refresh();
  }

  const toSave = result ? result.matched.length + Object.values(picks).filter((v) => v && v !== "none").length : 0;
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {!result ? (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            send(false);
          }}
        >
          <label className="field">
            <span>Paste the reactions list from LinkedIn</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={"On LinkedIn, open the post's reactions, select the whole list and copy it. Names, '· 1st' markers, headlines and button text are all fine.\n\nAino Kallio\nAino Kallio\n· 1st\nTuotantojohtaja at Esimerkki Oy"} required />
          </label>
          <div className="row small" style={{ alignItems: "end", gap: 10 }}>
            <label className="field">
              <span>Whose post{fromFilter && author === owner ? " (from the Network page)" : ""}</span>
              <select
                value={author}
                onChange={(e) => {
                  setAuthor(e.target.value);
                  setCopiedBy(null);
                }}
              >
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Posted on</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field" style={{ flex: "1 1 220px" }}>
              <span>Label (optional)</span>
              <input value={post} onChange={(e) => setPost(e.target.value)} placeholder="e.g. AI in production planning" />
            </label>
          </div>
          <div className="copied-from">
            <label className="row" style={{ gap: 8 }}>
              <b>Copied from</b>
              <select value={viewer} onChange={(e) => setCopiedBy(e.target.value === author ? null : e.target.value)}>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}&apos;s LinkedIn
                  </option>
                ))}
              </select>
            </label>
            <span className="small muted">
              LinkedIn&apos;s &quot;· 1st&quot; and &quot;· 2nd&quot; are relative to whoever copied the list. {copiedBy ? `Not the post's owner (${nameOf(author)}): check this is right.` : `The post's owner, ${nameOf(author)}, unless you change it.`}
            </span>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || !text.trim()}>
              {busy ? "Matching…" : "Match names"}
            </button>
            <span className="small muted">Nothing is stored until you save.</span>
          </div>
        </form>
      ) : (
        <div className="card stack">
          <div className="small muted">
            &quot;{result.post}&quot;, {day(result.postDate)}: {result.read} people read from the paste{result.companyPages ? `, ${result.companyPages} company page${result.companyPages === 1 ? "" : "s"} skipped` : ""}. Copied from {result.copiedBy}&apos;s LinkedIn.
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Will be stored ({result.matched.length})</h3>
            {result.matched.length ? (
              <ul className="reasons">
                {result.matched.map((m, i) => (
                  <li key={i}>
                    <span>
                      <Link href={`/people/${m.person.id}`}>{m.person.name}</Link>{" "}
                      <span className="small muted">
                        · {m.person.title || "No title"}
                        {m.person.company ? ` · ${m.person.company}` : ""}
                      </span>
                    </span>
                    <span className="pill inferred">{HOW[m.how ?? "name"]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">No one matched on their own.</p>
            )}
          </div>
          {result.review.length ? (
            <div>
              <h3>Check these ({result.review.length})</h3>
              <p className="small muted">Two or more people in your networks have this name, and the headline does not settle it. Pick one, or leave it out.</p>
              {result.review.map((r, i) => (
                <fieldset key={i} className="review">
                  <legend>
                    <b>{r.name}</b>
                    <span className="small muted">
                      {r.degree ? ` · ${r.degree}` : ""}
                      {r.headline ? ` · "${r.headline}"` : ""}
                    </span>
                  </legend>
                  {r.candidates.map((c) => (
                    <label key={c.id} className="small row" style={{ gap: 8 }}>
                      <input type="radio" name={`pick-${i}`} checked={picks[i] === c.id} onChange={() => setPicks({ ...picks, [i]: c.id })} />
                      <span>
                        {c.name} · {c.title || "No title"}
                        {c.company ? ` · ${c.company}` : ""} <span className="muted">· known by {c.knownBy.join(" and ")}</span>
                      </span>
                    </label>
                  ))}
                  <label className="small row" style={{ gap: 8 }}>
                    <input type="radio" name={`pick-${i}`} checked={!picks[i] || picks[i] === "none"} onChange={() => setPicks({ ...picks, [i]: "none" })} />
                    <span>None of these</span>
                  </label>
                </fieldset>
              ))}
            </div>
          ) : null}
          {result.copiedByWarning ? (
            <div className="warn" role="alert">
              <p className="small">{result.copiedByWarning.text}</p>
              {result.copiedByWarning.suggest ? (
                <button
                  type="button"
                  className="btn small"
                  disabled={busy}
                  onClick={() => {
                    const id = result.copiedByWarning!.suggest!.id;
                    setCopiedBy(id === author ? null : id);
                    send(false, id);
                  }}
                >
                  Match again as copied from {result.copiedByWarning.suggest.name}
                </button>
              ) : null}
            </div>
          ) : null}
          {result.degreeMismatch.length ? (
            <div>
              <h3>Same name as someone in your networks, but LinkedIn&apos;s &apos;1st&apos; says otherwise: check &apos;Copied from&apos; ({result.degreeMismatch.length})</h3>
              <p className="small muted">
                Read as copied from {result.copiedBy}&apos;s LinkedIn. Not stored: {result.degreeMismatch.map((u) => `${u.name}${u.degree ? ` (${u.degree})` : ""}`).join(", ")}.
              </p>
            </div>
          ) : null}
          {result.unmatched.length ? (
            <div>
              <h3>Not in your networks: saved as engaged, not connected ({result.unmatched.length})</h3>
              <p className="small muted">
                Kept apart under Settings → Engaged, not connected, with only the name, headline, degree and post; deleted after 90 days unless you set a status: {result.unmatched.map((u) => u.name).join(", ")}.
              </p>
            </div>
          ) : null}
          {result.unread.length ? (
            <div>
              <h3>Lines read as nobody ({result.unread.length})</h3>
              <p className="small muted">Check these for someone the paste did not show as a person. Not stored: {result.unread.slice(0, 12).map((l) => `"${l}"`).join(", ")}{result.unread.length > 12 ? ", …" : ""}.</p>
            </div>
          ) : null}
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !(toSave || result.unmatched.length)} onClick={() => send(true)}>
              {busy ? "Saving…" : `Save ${toSave} reaction${toSave === 1 ? "" : "s"}${result.unmatched.length ? ` and ${result.unmatched.length} engaged` : ""}`}
            </button>
            <button type="button" className="link" onClick={() => setResult(null)}>
              Back
            </button>
          </div>
        </div>
      )}
      {msg ? (
        <p className="small" role="status">
          {msg}
        </p>
      ) : null}
      <div>
        <h3>Posts ({posts.length})</h3>
        {posts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Posted</th>
                  <th>By</th>
                  <th className="num">People</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={`${p.post}|${p.postDate}`}>
                    <td>{p.post}</td>
                    <td className="small">{day(p.postDate)}</td>
                    <td className="small">{owners.find((o) => o.id === p.author)?.name ?? ""}</td>
                    <td className="num">{p.people}</td>
                    <td>
                      <button type="button" className="link small" onClick={() => remove(p)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small muted">No reactions yet.</p>
        )}
      </div>
    </div>
  );
}
